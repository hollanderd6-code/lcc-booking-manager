#!/usr/bin/env node
'use strict';
/**
 * BUILD EVAL SET v1.3 — Traveler AI V2 Evaluation Set
 * Pipeline: FETCH → FILTER → DEDUP → CLASSIFY → SELECT → BACKFILL → SPLIT → WRITE
 * READ ONLY. No Groq. No DB writes. No RANDOM() at runtime.
 *
 * Usage: DATABASE_URL=... node scripts/build-eval-set.js
 * Output: benchmarks/traveler-v2-eval-set.json
 */

require('dotenv').config();

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

// ─── Constants ────────────────────────────────────────────────────────────────

const GOLDEN_IDS     = [3139, 8786, 6072, 2592, 3749, 6913];
const REGRESSION_IDS = [4626, 9410, 7297, 3259];
const EXCLUDED_IDS   = [...GOLDEN_IDS, ...REGRESSION_IDS];

const TOTAL_CASES       = 40;
const DEV_COUNT         = 25;
const HOLDOUT_COUNT     = 15;
const MAX_PER_PROPERTY  = 6;
const MAX_PER_CONV      = 2;
const JACCARD_THRESHOLD = 0.60;

// Priority order for selection
const PRIORITY_ORDER = [
  'EMERGENCY', 'DISPUTE', 'PAYMENT', 'ACCESS',
  'TIMING', 'EQUIPMENT', 'RULES', 'PRACTICAL', 'AMBIGUOUS', 'SIMPLE',
];

// Backfill order when a category undershoots quota (EMERGENCY excluded)
const BACKFILL_ORDER = [
  'AMBIGUOUS', 'ACCESS', 'TIMING', 'PAYMENT', 'DISPUTE',
  'EQUIPMENT', 'RULES', 'PRACTICAL', 'SIMPLE',
];

// Quotas — MUST sum to TOTAL_CASES
const CATEGORY_QUOTAS = {
  EMERGENCY:  3,
  DISPUTE:    3,
  PAYMENT:    4,
  ACCESS:     5,
  TIMING:     5,
  EQUIPMENT:  4,
  RULES:      3,
  PRACTICAL:  4,
  AMBIGUOUS:  4,
  SIMPLE:     5,
};

const quotaSum = Object.values(CATEGORY_QUOTAS).reduce((a, b) => a + b, 0);
if (quotaSum !== TOTAL_CASES) throw new Error(`BUG: quotas sum ${quotaSum} ≠ ${TOTAL_CASES}`);

// ─── Classifier — semantic, priority-ordered ──────────────────────────────────

function classifyMessage(msg) {
  const s = msg.toLowerCase();

  // EMERGENCY: physical blockage / real safety / infrastructure breakdown
  if (
    /(bloqué[e]?|coincé[e]?).{0,80}(porte|entrée|appartement|dehors|devant|rentrer|entrer)/.test(s) ||
    /(porte|serrure).{0,50}(bloquée?|ne.{0,20}(marche|fonctionne|ouvre|s.ouvre))/.test(s) ||
    /(ne.{0,8}(peut|peux|arrive[sz]?|réussit|suis capable)|impossible).{0,40}(entrer|rentrer|ouvrir|accéder)/.test(s) ||
    /locked out/.test(s) ||
    /fuite (d['']|de )(eau|gaz)/.test(s) ||
    /(incendie|inondation)\b/.test(s) ||
    /(sans|plus de|pas de|coupure d['']?).{0,15}(eau\b|électricité|chauffage)/.test(s) ||
    /panne.{0,25}(chauffage|électricité|chauffe.eau)/.test(s) ||
    /emergency\b|no (hot )?water\b|no heat\b/.test(s)
  ) return 'EMERGENCY';

  // DISPUTE: contested, complained, or cancelled situations
  if (
    /\blitige\b|\bplainte\b|\bcomplaint\b|\bdispute\b/.test(s) ||
    /insatisfait|pas satisfait|not happy|not satisfied/.test(s) ||
    /\bréclamation\b/.test(s) ||
    /(n['']était pas|pas inclus|pas indiqué|not indicated|not (as )?described|not mentioned)/.test(s) ||
    /\bannuler\b|\bannulation\b|\bcancelar\b|\bcancelación\b|\bcancelacion\b|\bcancella/.test(s) ||
    /\bcancel(ed|ling|lation)?\b/.test(s) ||
    /(remboursement|refund).{0,40}(refusé|contesté|réclam|exig|demand)/.test(s)
  ) return 'DISPUTE';

  // PAYMENT: financial requests without dispute
  if (
    /\bfacture\b|\binvoice\b|\breçu\b|\breceipt\b/.test(s) ||
    /\bcaution\b|\bdépôt de garantie\b|\bdeposit\b/.test(s) ||
    /\brembours|\brefund\b/.test(s) ||        // stem catches remboursé/remboursés/remboursement
    /\bpaiement\b|\bpayment\b|\bfacturation\b|\bfactura\b|\bfatura\b/.test(s) ||
    /empreinte bancaire/.test(s)
  ) return 'PAYMENT';

  // ACCESS: how to enter — code, key, lockbox, door (not blocked = EMERGENCY)
  if (
    /(code|digicode).{0,40}(porte|accès|entrée|d['']accès|appartement)/.test(s) ||
    /\bdigicode\b/.test(s) ||
    /boîte.{0,12}(à|aux)\s*cl[eé]|boite.{0,12}cl[eé]s?|\blockbox\b/.test(s) ||
    /(comment|procédure|instruction).{0,40}(entrer|accéder|accès|rentrer)/.test(s) ||
    /(accès|entrée).{0,40}(logement|appartement|studio)/.test(s) ||
    /(\bclé\b|\bclés\b).{0,40}(code|accès|entrer|ouvrir|récupérer|trouver|chercher|où)/.test(s) ||
    /où.{0,30}(clé|serrure|boîte)/.test(s) ||
    /\bllave\b|\bcódigo de acceso\b/.test(s)
  ) return 'ACCESS';

  // TIMING: arrival/departure time questions
  if (
    /(heure|horaire).{0,25}(arriv|départ|check)/.test(s) ||
    /(arriv|départ).{0,25}heure/.test(s) ||
    /early check.?in|late check.?out|late check.?in/.test(s) ||
    /arriver plus tôt|partir plus tard/.test(s) ||
    /(à quelle heure|what time).{0,30}(arriv|check|enter|depart|leave)/.test(s) ||
    /check.?in\b|check.?out\b/.test(s) ||
    /arrivée (tardive|après minuit|très tard|ce soir)/.test(s) ||
    /hora de (llegada|salida)/.test(s) ||
    /arriver.{0,30}\d{1,2}h\d{0,2}/.test(s)   // "arriver avant 22h30"
  ) return 'TIMING';

  // EQUIPMENT: physical items/appliances in the accommodation
  if (
    /\bdraps?\b/.test(s) ||
    /\bserviette/.test(s) ||
    /\boreiller/.test(s) ||
    /\bcouverture/.test(s) ||
    /fer à repasser|sèche.cheveux|sèche.linge|machine à laver|lave.linge/.test(s) ||
    /\bcafetière\b|\bmicro.onde\b/.test(s) ||
    /\blit bébé\b|\bbarbecue\b/.test(s) ||
    /hair dryer|washing machine|dishwasher/.test(s) ||
    /\btowel\b|\bpillow\b|\bblanket\b/.test(s) ||
    /covers?.{0,20}(provided|available|inclus)/.test(s)
  ) return 'EQUIPMENT';

  // RULES: policies — pets, parties, smoking, visitors
  if (
    /animaux? de compagnie|animaux autorisés/.test(s) ||
    /\bchien\b|\bchat\b|\bpet\b|\bdog\b|\bcat\b/.test(s) ||
    /\bfête\b|\bparty\b/.test(s) ||
    // "soirée" only in party/event context, not in farewell "bonne soirée"
    /soirée (prévue|organisée|annoncée|entre amis|ce soir)|organiser (une\s+)?soirée|faire la fête/.test(s) ||
    /\bfumer\b|non.fumeur|\bsmoking\b/.test(s) ||
    /(visite|invit|visiteur|ami).{0,60}(vient|vendr|séjour|confirm|amener|accomp)/.test(s) ||
    /(confirm|amener|accomp).{0,60}(visite|invit|ami\b)/.test(s) ||
    /personnes? supplémentaires|extra (person|guest)/.test(s) ||
    /règlement intérieur|règles.{0,20}(logement|appartement|maison)/.test(s)
  ) return 'RULES';

  // PRACTICAL: location, transport, parking, wifi, building info
  if (
    /\bparking\b|\bgarer\b|\bstationnement\b/.test(s) ||
    /\bmétro\b|\bbus\b|\btram\b|\btransport\b/.test(s) ||
    /(adresse|localisation|immeuble|bâtiment|étage).{0,40}(exacte?|complète?|numéro|trouver|c['']est|est.ce)/.test(s) ||
    /\bimmeuble\b|\bétage\b/.test(s) ||
    /comment (venir|arriver|trouver|rejoindre|accéder à)|how to (get|find|reach|arrive)/.test(s) ||
    /\bwifi\b|wi.fi\b|\binternet\b|\bconnexion\b/.test(s)
  ) return 'PRACTICAL';

  // AMBIGUOUS: requires prior context to be understood
  if (
    /comme convenu|comme discuté|comme prévu|as agreed|as discussed/.test(s) ||
    /(toujours pas|toujours aucun|toujours rien)\b/.test(s) ||
    /aucune nouvelle\b|any (update|news)\b|des nouvelles de\b/.test(s) ||
    /(ça|cela|il).{0,20}ne (marche|fonctionne) (toujours|encore|pas encore)/.test(s) ||
    /et pour (demain|ce soir|aujourd|ce matin|maintenant)\b/.test(s) ||
    /vous avez des nouvelles|un suivi/.test(s)
  ) return 'AMBIGUOUS';

  // SIMPLE: greeting, thanks, acknowledgment — no specific operational request
  return 'SIMPLE';
}

// ─── Language detection ───────────────────────────────────────────────────────

const LANG_PATTERNS = {
  FR: [
    /\ble\b/, /\bla\b/, /\bles\b|\bdes\b/, /\bun\b|\bune\b/,
    /\best\b/, /\bque\b|\bqu['']/, /\bje\b/, /\bdu\b/,
    /\bmerci\b/, /\bbonjour\b|\bbonsoir\b/, /\bvotre\b|\bnotre\b/,
    /\bnous\b|\bvous\b/, /\bpour\b/, /\bavez\b|\bavons\b/,
    /\bcomment\b/, /\bquand\b|\bquelle?\b|\bquel\b/,
    /\bserait\b|\bsont\b|\bsera\b/,
    /\bheure\b|\bheures\b/, /\barrivée?\b/, /\bdépart\b/,
    /\bappartement\b|\blogement\b/, /\bclé\b|\bclés\b/, /\baccès\b/,
    /\bfacture\b/, /\bvoudrais?\b/, /\bpouvez\b|\bpourriez\b/,  // domain-specific FR
  ],
  EN: [
    /\bthe\b/, /\band\b/, /\bfor\b/, /\bwith\b/, /\byou\b/,
    /\bhello\b/, /\bthank\b/, /\bplease\b/, /\btime\b/, /\bhow\b/,
    /\bwhat\b/, /\bwhen\b/, /\bwill\b/, /\bhave\b/, /\bcan\b/,
    /\bour\b/, /\bgood\b/, /\bcheck\b/, /\bwhere\b/, /\bjust\b/,
    /\bkey\b/, /\bare\b/, /\bdoes\b/, /\bmy\b/, /\bwe\b/, /\bneed\b/,
  ],
  ES: [
    /\bgracias\b/, /\bhola\b/, /\bpor favor\b/, /\bestamos\b|\bes que\b/,
    /\blas\b|\blos\b/, /\bllave\b/, /\bhorario\b/,
    /\bllegamos\b|\bllegada\b/, /\bcódigo\b/, /\bapartamento\b/,
    /\bcómo\b/, /\bcancelación\b|\bcancelacion\b/, /\bpara\b/, /\balojamiento\b|\bdel\b/,
  ],
  PT: [
    /\bobrigado\b|\bobrigada\b/, /\bolá\b/, /\bpor favor\b/,
    /\bchegada\b|\bchave\b/, /\bapartamento\b/,
    /\bhorário\b/, /\bfatura\b/, /\bpagamento\b/, /\bpela\b|\bpelo\b/,
  ],
};

function detectLanguage(stored, msg) {
  if (stored && /^[a-z]{2}$/i.test(stored)) return stored.toUpperCase();
  const lower = msg.toLowerCase();

  const scores = {};
  for (const [lang, patterns] of Object.entries(LANG_PATTERNS)) {
    scores[lang] = patterns.filter(p => p.test(lower)).length;
  }

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return 'OTHER';

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [winner, winScore] = entries[0];

  // FR: 1 signal is enough when accented characters are present
  if (winner === 'FR' && winScore >= 1 && /[éèêàâîôûùçëïü]/.test(lower)) return 'FR';

  if (winner === 'EN') {
    // FR wins if it has any signal + accented chars (EN words appear in FR text)
    if (scores.FR >= 1 && /[éèêàâîôûùçëïü]/.test(lower)) return 'FR';
    // Accept EN with ≥2 signals and no competing language
    if (winScore >= 2) return 'EN';
    return 'OTHER';
  }

  if (winScore < 2) return 'OTHER';

  // Tie FR vs EN → FR
  if (entries[0][1] === entries[1][1] &&
      new Set([entries[0][0], entries[1][0]]).has('EN') &&
      new Set([entries[0][0], entries[1][0]]).has('FR')) return 'FR';

  return winner;
}

// ─── Near-duplicate (Jaccard) ─────────────────────────────────────────────────

function normalizeText(t) {
  return t.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function tokenize(t) {
  return new Set(normalizeText(t).split(' ').filter(w => w.length > 2));
}

function jaccard(A, B) {
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

const CONTEXT_KEYWORDS = [
  'comme convenu', 'comme discuté', 'comme prévu', 'au même endroit',
  'toujours pas', 'toujours aucun', 'toujours rien', 'aucune nouvelle',
  'as agreed', 'as discussed', 'still not', 'not yet', 'not working',
  "n'a pas fonctionné", 'code ne fonctionne', 'ça ne marche pas',
  'ça marche pas', 'et pour demain', 'et pour ce soir',
  'any update', 'any news', 'un suivi', 'des nouvelles',
  'même endroit', 'como acordado',
  'pas encore reçu', "n'ai pas encore", "n'avons pas encore",
  "n'avez pas répondu", 'je vous relance',
];

function needsContext(msg) {
  const lower = msg.toLowerCase();
  return CONTEXT_KEYWORDS.some(k => lower.includes(k));
}

// Multi-intent topic signals (each regex = 1 distinct topic)
const MULTI_INTENT_SIGNALS = [
  /heure.{0,20}(arriv|départ)|what time\b|check.?in\b|check.?out\b|hora de (llegada|salida)/,
  /\bserviette|\bdraps?\b|\bcouverture\b|\boreiller\b|\bblanket\b|\btowel\b|\bpillow\b/,
  /\bparking\b|\bgarer\b|\bwifi\b|\binternet\b|\bbus\b|\bmétro\b/,
  /(code|digicode).{0,40}(porte|accès)|\bclé\b|\bboîte.{0,12}cl|\blockbox\b/,
  /\bfacture\b|\bcaution\b|\brembours|\bpaiement\b|\bdeposit\b/,
];

function isMultiIntent(msg) {
  const lower = msg.toLowerCase();
  const pairs = [
    ['early', 'late'], ['arriver plus tôt', 'partir plus tard'],
    ['wifi', 'code'], ['facture', 'caution'], ['parking', 'adresse'],
  ];
  for (const [a, b] of pairs) {
    if (lower.includes(a) && lower.includes(b)) return true;
  }
  if ((msg.match(/\?/g) || []).length >= 2) return true;
  // 2+ distinct topic categories detected in message
  return MULTI_INTENT_SIGNALS.filter(p => p.test(lower)).length >= 2;
}

const SENSITIVE_KW = [
  'urgence', 'urgent', 'bloqué', 'panne', 'fuite', 'incendie',
  'litige', 'annulation', 'remboursement', 'refund', 'cancel',
  'locked out', 'emergency', 'flood',
];

function isSensitive(msg) {
  const lower = msg.toLowerCase();
  return SENSITIVE_KW.some(k => lower.includes(k));
}

// ─── Pre-flight tests (run before DB) ────────────────────────────────────────

function runPreflightTests() {
  let pass = 0; let fail = 0;

  function chk(label, got, expected) {
    if (got === expected) { pass++; }
    else { fail++; console.error(`  FAIL [${label}]: expected=${expected} got=${got}`); }
  }

  // ── Classifier tests ──────────────────────────────────────────────────────

  chk('EMERGENCY blocked door',       classifyMessage('Je suis bloqué devant la porte'), 'EMERGENCY');
  chk('EMERGENCY door not open',      classifyMessage("La porte ne s'ouvre pas"), 'EMERGENCY');
  chk('EMERGENCY locked out EN',      classifyMessage('I am locked out of the apartment'), 'EMERGENCY');
  chk('EMERGENCY water leak',         classifyMessage("Il y a une fuite d'eau dans la salle de bain"), 'EMERGENCY');
  chk('NOT EMERGENCY caution debl',   classifyMessage('Quand la caution de 300 € sera-t-elle débloquée ?'), 'PAYMENT');
  chk('NOT EMERGENCY immeuble',       classifyMessage("Le logement est dans le même immeuble, à quel étage ?"), 'PRACTICAL');

  chk('DISPUTE cancel FR',            classifyMessage('Je souhaite annuler ma réservation'), 'DISPUTE');
  chk('DISPUTE not indicated',        classifyMessage("Ce n'était pas indiqué dans l'annonce, je suis déçu"), 'DISPUTE');
  chk('DISPUTE cancelacion ES',       classifyMessage('Cancelacion del alojamiento, no indicaron las condiciones'), 'DISPUTE');

  // A) remboursés (conjugated form — stem match)
  chk('PAYMENT rembourses stem',      classifyMessage("je voudrais savoir quand les 300 euros seront remboursés s'il vous plaît"), 'PAYMENT');
  chk('PAYMENT facture',              classifyMessage("Pouvez-vous m'envoyer une facture ?"), 'PAYMENT');
  chk('PAYMENT caution quand',        classifyMessage('Quand récupère-t-on la caution ?'), 'PAYMENT');
  chk('PAYMENT deposit EN',           classifyMessage('When will my deposit be returned?'), 'PAYMENT');

  chk('ACCESS code porte',            classifyMessage('Quel est le code de la porte ?'), 'ACCESS');
  chk('ACCESS boite cle',             classifyMessage('Où est la boîte aux clés ?'), 'ACCESS');
  chk('ACCESS comment entrer',        classifyMessage("Comment faire pour entrer dans le logement ?"), 'ACCESS');

  chk('TIMING arriver plus tot',      classifyMessage('Puis-je arriver plus tôt que prévu ?'), 'TIMING');
  chk('TIMING what time EN',          classifyMessage('What time is check in?'), 'TIMING');
  chk('TIMING heure arrivee',         classifyMessage("Bonjour, à quelle heure est l'arrivée ?"), 'TIMING');
  // C) time notation "22h30"
  chk('TIMING arriver avant 22h30',   classifyMessage("Je devrais arriver avant 22h30, je vous préviens en cas de problème. Bonne soirée"), 'TIMING');

  chk('EQUIPMENT covers EN',          classifyMessage('Are covers pillows and towels provided?'), 'EQUIPMENT');
  chk('EQUIPMENT machine laver',      classifyMessage('Y a-t-il une machine à laver ?'), 'EQUIPMENT');
  chk('EQUIPMENT draps',              classifyMessage('Est-ce que les draps sont fournis ?'), 'EQUIPMENT');
  chk('EQUIPMENT seche-cheveux',      classifyMessage('Y a-t-il un sèche-cheveux ?'), 'EQUIPMENT');

  chk('RULES visitor confirm first',  classifyMessage('Je voudrais confirmer la visite de cette amie ce soir'), 'RULES');
  chk('RULES animaux',                classifyMessage('Les animaux de compagnie sont-ils autorisés ?'), 'RULES');
  chk('RULES fumer',                  classifyMessage('Est-il possible de fumer sur le balcon ?'), 'RULES');
  // B) "bonne soirée" in farewell — must NOT trigger RULES
  chk('NOT RULES bonne soiree',       classifyMessage("Thank you so much for your understanding. Merci et bonne soirée!"), 'SIMPLE');
  chk('NOT RULES invitation',         classifyMessage('Merci pour votre invitation, nous étions très bien reçus'), 'SIMPLE');

  chk('PRACTICAL parking',            classifyMessage('Où puis-je me garer à proximité ?'), 'PRACTICAL');
  chk('PRACTICAL adresse exacte',     classifyMessage("Quelle est l'adresse exacte de l'appartement ?"), 'PRACTICAL');
  chk('PRACTICAL wifi',               classifyMessage('Quel est le mot de passe wifi ?'), 'PRACTICAL');

  chk('AMBIGUOUS toujours pas',       classifyMessage('Ça ne marche toujours pas'), 'AMBIGUOUS');
  chk('AMBIGUOUS des nouvelles',      classifyMessage('Vous avez des nouvelles de ma demande ?'), 'AMBIGUOUS');
  chk('AMBIGUOUS comme convenu',      classifyMessage('Comme convenu, nous arrivons à 15h'), 'AMBIGUOUS');

  chk('SIMPLE merci',                 classifyMessage('Merci beaucoup, tout était parfait !'), 'SIMPLE');
  chk('SIMPLE bonsoir',               classifyMessage('Bonsoir, bonne nuit'), 'SIMPLE');

  const classifierTotal = pass + fail;
  const classifierPass  = pass;

  // ── Language tests ────────────────────────────────────────────────────────

  const lcStart = pass + fail;

  chk('FR heure arrivee',            detectLanguage(null, "heure d'arrivée ?"), 'FR');
  chk('FR code acces',               detectLanguage(null, "Le code d'accès de l'appartement"), 'FR');
  chk('FR avant 22h30',              detectLanguage(null, "Je devrais arriver avant 22h30, est-ce possible ?"), 'FR');
  chk('FR envoyer facture',          detectLanguage(null, "Envoyer facture s'il vous plaît"), 'FR');
  chk('ES cancelacion',              detectLanguage(null, 'Cancelacion del alojamiento'), 'ES');
  chk('EN key box',                  detectLanguage(null, 'Where is the key box?'), 'EN');
  chk('EN we need blanket',          detectLanguage(null, 'We need Blanket'), 'EN');
  chk('PT obrigado',                 detectLanguage(null, 'Obrigado pela resposta, a chegada está confirmada'), 'PT');
  chk('OTHER buongiorno IT',         detectLanguage(null, 'Buongiorno, io dovrei arrivare nel pomeriggio'), 'OTHER');
  chk('FR stored override',          detectLanguage('fr', 'Hello where is key'), 'FR');
  chk('EN stored override',          detectLanguage('en', 'Bonjour merci pour le code'), 'EN');

  const langPass  = (pass + fail) - lcStart - fail + pass - classifierPass;  // relative
  const langTotal = (pass + fail) - lcStart;
  // Simpler counts:
  const allPass  = pass;
  const allFail  = fail;
  const langP    = pass - classifierPass;
  const langT    = (pass + fail) - classifierTotal;

  console.log(`[TESTS] Classifier: ${classifierPass}/${classifierTotal}  Language: ${langP}/${langT}`);

  if (fail > 0) {
    console.error(`[TESTS] ${fail} test(s) FAILED — aborting build`);
    process.exit(1);
  }
  return { classifierPass, classifierTotal, langPass: langP, langTotal: langT };
}

// ─── DB Pool ──────────────────────────────────────────────────────────────────

async function getPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  await pool.query('SELECT 1');
  return pool;
}

// ─── Fetch keywords (wide net — classifier is the real gatekeeper) ─────────────

const FETCH_KEYWORDS = {
  EMERGENCY: [
    "bloqué", "bloquée", "impossible d'entrer", "impossible d'ouvrir",
    "ne s'ouvre pas", "porte bloquée", "serrure bloquée", "serrure coincée",
    "fuite d'eau", "fuite de gaz", "incendie", "inondation",
    "sans eau", "sans chauffage", "sans électricité",
    "panne de chauffage", "panne d'électricité", "panne de courant",
    "locked out", "emergency", "no water", "no heat",
  ],
  DISPUTE: [
    "annuler", "annulation", "cancel", "cancelar", "cancelación", "cancella",
    "litige", "plainte", "complaint", "dispute",
    "insatisfait", "pas satisfait", "not happy", "not satisfied",
    "réclamation", "n'était pas indiqué", "pas inclus", "not indicated",
  ],
  PAYMENT: [
    "facture", "invoice", "reçu", "receipt",
    "caution", "dépôt de garantie", "deposit",
    "remboursement", "remboursé", "refund", "paiement", "payment",
    "facturation", "factura", "fatura", "empreinte bancaire",
  ],
  ACCESS: [
    "code d'accès", "code de la porte", "digicode", "boîte à clé",
    "boîte aux clés", "boite à clés", "lockbox",
    "comment entrer", "comment accéder", "instructions accès",
    "où est la clé", "récupérer la clé", "llave", "código acceso",
  ],
  TIMING: [
    "heure d'arrivée", "heure de départ", "heure d'arrivee",
    "early check-in", "late checkout", "arriver plus tôt", "partir plus tard",
    "à quelle heure", "quelle heure", "what time",
    "check-in", "check out", "check in", "arrivée tardive",
    "hora de llegada", "hora de salida",
    "arriver avant", "arriver après", "arriver vers",
  ],
  EQUIPMENT: [
    "draps", "serviettes", "serviette", "oreiller", "couverture",
    "fer à repasser", "sèche-cheveux", "sèche-linge",
    "machine à laver", "lave-linge", "lit bébé", "cafetière",
    "micro-onde", "barbecue",
    "hair dryer", "iron", "washing machine", "dishwasher",
    "towel", "pillow", "blanket", "covers provided",
  ],
  RULES: [
    "animal", "animaux", "chien", "chat", "pet", "dog", "cat",
    "fête", "party",
    "fumer", "non-fumeur", "smoke", "smoking",
    "visite de", "inviter un ami", "visiteur", "accompagner",
    "personnes supplémentaires", "extra person", "extra guest",
    "règlement intérieur", "autorisé",
  ],
  PRACTICAL: [
    "parking", "garer", "stationnement",
    "métro", "bus", "tram", "transport",
    "adresse exacte", "adresse complète", "adresse du logement",
    "localisation", "immeuble", "étage", "bâtiment",
    "comment venir", "comment arriver", "how to get",
    "wifi", "wi-fi", "internet", "connexion",
  ],
  AMBIGUOUS: [
    "comme convenu", "comme discuté", "comme prévu",
    "as agreed", "as discussed",
    "toujours pas", "toujours aucun", "toujours rien",
    "aucune nouvelle", "any update", "any news", "des nouvelles",
    "ça ne marche", "ne fonctionne toujours",
    "et pour demain", "et pour ce soir",
    "vous avez des nouvelles", "un suivi",
  ],
  SIMPLE: [
    "merci beaucoup", "merci !", "merci.",
    "bonsoir !", "bonsoir.", "au revoir", "bonne journée", "bonne soirée",
    "thank you", "thanks!", "hello!", "good morning", "goodbye",
    "gracias", "obrigado", "à bientôt",
    "parfait merci", "super merci", "tout est parfait",
    "ok merci", "d'accord merci", "reçu merci",
  ],
};

// ─── SQL: system-message exclusions ──────────────────────────────────────────

const SYS_EXCL_CLAUSES = [
  'THIS RESERVATION HAS BEEN', 'BOOKING NOTE', 'OTA Commission',
  'Payment Collect', 'Meal Plan', 'IMPORTED BOOKING',
  'test webhook', 'webhook curl', 'ceci est un test',
  'automated test', 'test message',
].map(p => `AND m.message NOT ILIKE '%${p}%'`).join('\n      ');

// ─── Fetch candidates ─────────────────────────────────────────────────────────

async function fetchCandidates(pool, keywords, excludeIds, excludeConvIds, fetchLimit, pickLatest) {
  const exclIds  = [...EXCLUDED_IDS, ...excludeIds];
  const exclConv = [...new Set(excludeConvIds)];

  const kw = keywords.map(k => `m.message ILIKE '%${k.replace(/'/g, "''")}%'`).join('\n      OR ');

  const params = [];
  const idPH   = exclIds.map(id => { params.push(id); return `$${params.length}`; }).join(',');

  let convExcl = '';
  if (exclConv.length > 0) {
    const cPH = exclConv.map(id => { params.push(id); return `$${params.length}`; }).join(',');
    convExcl  = `AND m.conversation_id NOT IN (${cPH})`;
  }

  params.push(fetchLimit);
  const limPH = `$${params.length}`;

  const orderBy = pickLatest
    ? 'ORDER BY m.conversation_id, m.id DESC'
    : 'ORDER BY m.conversation_id, m.id ASC';

  const sql = `
    SELECT DISTINCT ON (m.conversation_id)
      m.id          AS message_id,
      m.conversation_id,
      m.created_at,
      m.message     AS guest_message,
      c.property_id,
      c.language    AS stored_language,
      c.platform,
      c.guest_name,
      p.name        AS property_name
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN properties p ON p.id = c.property_id
    WHERE m.sender_type = 'guest'
      AND m.id NOT IN (${idPH})
      ${convExcl}
      AND LENGTH(m.message) > 15
      AND LENGTH(m.message) < 800
      ${SYS_EXCL_CLAUSES}
      AND (${kw})
    ${orderBy}
    LIMIT ${limPH}
  `;

  const res = await pool.query(sql, params);
  return res.rows.sort((a, b) => a.message_id - b.message_id);
}

// ─── Selection state helpers ──────────────────────────────────────────────────

function makeState() {
  return {
    selected:        [],
    selectedConvCnt: {},
    selectedTokens:  [],
    propCount:       {},
  };
}

function canAdd(state, row) {
  return (state.propCount[String(row.property_id)] || 0) < MAX_PER_PROPERTY &&
         (state.selectedConvCnt[row.conversation_id] || 0) < MAX_PER_CONV;
}

function commit(state, row, cat) {
  const pid = String(row.property_id);
  const cid = row.conversation_id;
  state.propCount[pid]        = (state.propCount[pid]        || 0) + 1;
  state.selectedConvCnt[cid]  = (state.selectedConvCnt[cid]  || 0) + 1;
  state.selectedTokens.push(tokenize(row.guest_message));
  state.selected.push({ ...row, _cat: cat });
}

// ─── Selection: CLASSIFY FIRST, SELECT SECOND ─────────────────────────────────

async function selectCases(pool) {
  const st = makeState();

  function currentExcludeIds()  { return st.selected.map(c => c.message_id); }
  function currentExcludeConvs(){ return Object.keys(st.selectedConvCnt).map(Number); }

  function tryCommit(row, targetCat) {
    const cat = classifyMessage(row.guest_message);
    if (cat !== targetCat) return false;
    const toks = tokenize(row.guest_message);
    if (st.selectedTokens.some(et => jaccard(toks, et) >= JACCARD_THRESHOLD)) return false;
    if (!canAdd(st, row)) return false;
    commit(st, row, cat);
    return true;
  }

  const fillCategory = async (targetCat, quota, pickLatest = false) => {
    const candidates = await fetchCandidates(
      pool, FETCH_KEYWORDS[targetCat],
      currentExcludeIds(), currentExcludeConvs(),
      quota * 20, pickLatest,
    );
    let accepted = 0;
    const rejectedCats = {};
    for (const row of candidates) {
      if (accepted >= quota) break;
      const cat = classifyMessage(row.guest_message);
      if (cat !== targetCat) { rejectedCats[cat] = (rejectedCats[cat] || 0) + 1; continue; }
      if (tryCommit(row, targetCat)) accepted++;
    }
    const rejStr = Object.entries(rejectedCats).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(' ');
    console.log(`  ${targetCat.padEnd(10)} ${accepted}/${candidates.length}  (quota:${quota}${rejStr?`  rej→ ${rejStr}`:''})`);
    return accepted;
  };

  console.log('\n[BUILD-EVAL] Pipeline: CLASSIFY FIRST, SELECT SECOND\n');

  // EMERGENCY: audit-mode — show all candidates with their classify result
  const emergencyPool = await fetchCandidates(
    pool, FETCH_KEYWORDS.EMERGENCY,
    currentExcludeIds(), currentExcludeConvs(),
    CATEGORY_QUOTAS.EMERGENCY * 30, true,
  );
  console.log(`[EMERGENCY FINAL CANDIDATES] ${emergencyPool.length} fetched:`);
  for (const r of emergencyPool) {
    const cat    = classifyMessage(r.guest_message);
    const marker = cat === 'EMERGENCY' ? '✓ EMERGENCY' : `✗ → ${cat}`;
    console.log(`  ID ${r.message_id} conv:${r.conversation_id} [${marker}]`);
    console.log(`    "${r.guest_message}"`);
  }
  console.log('');
  let emergencyAccepted = 0;
  for (const row of emergencyPool) {
    if (emergencyAccepted >= CATEGORY_QUOTAS.EMERGENCY) break;
    if (tryCommit(row, 'EMERGENCY')) emergencyAccepted++;
  }
  console.log(`  EMERGENCY   ${emergencyAccepted}/${emergencyPool.length}  (quota:${CATEGORY_QUOTAS.EMERGENCY})`);

  // Fill remaining categories in priority order
  for (const cat of PRIORITY_ORDER.filter(c => c !== 'EMERGENCY')) {
    await fillCategory(cat, CATEGORY_QUOTAS[cat]);
  }

  // ── Backfill: fill any deficit from BACKFILL_ORDER ──────────────────────────

  const deficitBefore = TOTAL_CASES - st.selected.length;
  if (deficitBefore > 0) {
    console.log(`\n[BACKFILL] Deficit: ${deficitBefore} case(s) — backfill from: ${BACKFILL_ORDER.join(' → ')}`);
    const backfillResults = {};

    for (const bfCat of BACKFILL_ORDER) {
      if (st.selected.length >= TOTAL_CASES) break;
      const need         = TOTAL_CASES - st.selected.length;
      const moreCandidates = await fetchCandidates(
        pool, FETCH_KEYWORDS[bfCat],
        currentExcludeIds(), currentExcludeConvs(),
        need * 30, false,
      );
      let added = 0;
      for (const row of moreCandidates) {
        if (added >= need || st.selected.length >= TOTAL_CASES) break;
        if (tryCommit(row, bfCat)) { added++; backfillResults[bfCat] = (backfillResults[bfCat] || 0) + 1; }
      }
      if (added > 0) console.log(`  BACKFILL +${added} ${bfCat}`);
    }

    const deficitAfter = TOTAL_CASES - st.selected.length;
    if (deficitAfter > 0) console.warn(`  ⚠️  Still short after backfill: ${st.selected.length}/${TOTAL_CASES}`);
  }

  // Category counts report
  console.log(`\n[BUILD-EVAL] Total selected: ${st.selected.length}/${TOTAL_CASES}`);
  const counts = {};
  for (const row of st.selected) counts[row._cat] = (counts[row._cat] || 0) + 1;
  for (const [cat, quota] of Object.entries(CATEGORY_QUOTAS)) {
    const got = counts[cat] || 0;
    if (got !== quota) console.warn(`  ⚠️  ${cat}: ${got}/${quota}`);
  }

  return st.selected;
}

// ─── Split DEV/HOLDOUT (exact 25/15, interleave 5:3 per group of 8) ───────────

function buildSplit(cases) {
  const sorted = [...cases].sort((a, b) => a.message_id - b.message_id);
  return sorted.map((c, i) => ({ ...c, split: (i % 8) < 5 ? 'DEV' : 'HOLDOUT' }));
}

// ─── Fingerprint ──────────────────────────────────────────────────────────────

function computeFingerprint(cases) {
  const payload = [...cases]
    .sort((a, b) => a.evaluation_id.localeCompare(b.evaluation_id))
    .map(c => ({
      evaluation_id: c.evaluation_id, message_id: c.message_id,
      conversation_id: c.conversation_id, property_id: c.property_id,
      created_at: c.created_at, split: c.split,
    }));
  return crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) { console.error('❌ DATABASE_URL absent'); process.exit(1); }

  const testResults = runPreflightTests();

  const pool = await getPool();
  console.log('\n[BUILD-EVAL] DB connected');

  let rawCases;
  try { rawCases = await selectCases(pool); }
  finally { await pool.end(); }

  const sorted = [...rawCases].sort((a, b) => a.message_id - b.message_id).slice(0, TOTAL_CASES);

  const classified = sorted.map((row, i) => ({
    evaluation_id:    `EVAL-${String(i + 1).padStart(3, '0')}`,
    message_id:       row.message_id,
    conversation_id:  row.conversation_id,
    property_id:      String(row.property_id),
    created_at:       row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    category:         row._cat,    // set during selection — never reclassified after
    subcategory:      null,
    language:         detectLanguage(row.stored_language, row.guest_message),
    multi_intent:     isMultiIntent(row.guest_message),
    context_required: needsContext(row.guest_message),
    sensitive:        isSensitive(row.guest_message),
    property_name:    row.property_name || null,
    guest_message:    row.guest_message,
    split:            null,
  }));

  const withSplit   = buildSplit(classified);
  const fingerprint = computeFingerprint(withSplit);

  const dataset = {
    version:             '1.3',
    created_at:          new Date().toISOString(),
    total_cases:         withSplit.length,
    dev_count:           withSplit.filter(c => c.split === 'DEV').length,
    holdout_count:       withSplit.filter(c => c.split === 'HOLDOUT').length,
    selection_method:    'classify-first priority-stratified, deterministic ORDER BY message_id, no random at runtime',
    dataset_fingerprint: fingerprint,
    excluded_calibration_ids: { golden: GOLDEN_IDS, regression: REGRESSION_IDS, all: EXCLUDED_IDS },
    cases: withSplit.map(({ property_name, ...rest }) => rest),
  };

  const outDir  = path.join(__dirname, '..', 'benchmarks');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'traveler-v2-eval-set.json');
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf8');

  // ─── Console report ───────────────────────────────────────────────────────

  const dev     = withSplit.filter(c => c.split === 'DEV');
  const holdout = withSplit.filter(c => c.split === 'HOLDOUT');
  const cats    = {}; const langs = {}; const props = {};
  for (const c of withSplit) {
    cats[c.category]     = (cats[c.category]     || 0) + 1;
    langs[c.language]    = (langs[c.language]    || 0) + 1;
    props[c.property_id] = (props[c.property_id] || 0) + 1;
  }
  const maxProp   = Math.max(...Object.values(props));
  const maxPropId = Object.entries(props).find(([, v]) => v === maxProp)?.[0];
  const dates     = withSplit.map(c => c.created_at).sort();
  const multiCnt  = withSplit.filter(c => c.multi_intent).length;
  const ctxCnt    = withSplit.filter(c => c.context_required).length;

  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  TRAVELER AI V2 — EVALUATION SET v1.3                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  console.log(`Total            : ${withSplit.length}`);
  console.log(`DEV              : ${dev.length}`);
  console.log(`HOLDOUT          : ${holdout.length}`);
  console.log(`Fingerprint      : ${fingerprint}`);
  console.log(`Properties       : ${Object.keys(props).length} distinct  (max ${maxProp} per prop_id ${maxPropId})`);
  console.log(`Oldest / Newest  : ${dates[0]}  /  ${dates[dates.length - 1]}`);

  console.log('\nCategories :');
  for (const cat of PRIORITY_ORDER) {
    const n    = cats[cat] || 0;
    const q    = CATEGORY_QUOTAS[cat];
    const mark = n === q ? '✅' : '⚠️ ';
    console.log(`  ${cat.padEnd(12)} ${n}/${q} ${mark}`);
  }

  console.log('\nLanguages :');
  for (const [l, n] of Object.entries(langs).sort()) console.log(`  ${l}: ${n}`);

  console.log(`\nMulti-intent     : ${multiCnt}`);
  console.log(`Context-required : ${ctxCnt}`);
  console.log(`\nOutput           : ${outPath}`);

  // ── Invariants ─────────────────────────────────────────────────────────────
  const convIds      = withSplit.map(c => c.conversation_id);
  const goldenLeak   = GOLDEN_IDS.some(id => withSplit.some(c => c.message_id === id));
  const regrLeak     = REGRESSION_IDS.some(id => withSplit.some(c => c.message_id === id));
  const catSumOk     = Object.values(cats).reduce((a, b) => a + b, 0) === TOTAL_CASES;
  const msgUnique    = new Set(withSplit.map(c => c.message_id)).size === withSplit.length;
  const convUnique   = new Set(convIds).size === convIds.length;

  let invPass = 0; let invFail = 0;
  function inv(label, ok) {
    if (ok) { invPass++; console.log(`  ✅ ${label}`); }
    else    { invFail++; console.error(`  ❌ ${label}`); }
  }

  console.log('\nDataset invariants :');
  inv(`total=${TOTAL_CASES}`,                 withSplit.length === TOTAL_CASES);
  inv(`DEV=${DEV_COUNT}`,                     dev.length === DEV_COUNT);
  inv(`HOLDOUT=${HOLDOUT_COUNT}`,             holdout.length === HOLDOUT_COUNT);
  inv('category sum=40',                      catSumOk);
  inv('message_id unique',                    msgUnique);
  inv('conversation_id unique',               convUnique);
  inv(`max property ≤ ${MAX_PER_PROPERTY}`,   maxProp <= MAX_PER_PROPERTY);
  inv('no golden leak',                       !goldenLeak);
  inv('no regression leak',                   !regrLeak);

  // ── Case list ──────────────────────────────────────────────────────────────
  console.log('\n── CASE LIST ───────────────────────────────────────────────────────────');
  for (const c of withSplit) {
    console.log(`\n${c.evaluation_id} [${c.split}]  ${c.category}  ${c.language}`);
    console.log(`  message_id:  ${c.message_id}  conv:${c.conversation_id}  prop:${c.property_id} (${c.property_name || '?'})`);
    console.log(`  date: ${c.created_at}  multi:${c.multi_intent}  ctx:${c.context_required}  sensitive:${c.sensitive}`);
    console.log(`  message: "${c.guest_message}"`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(`Classifier tests    : ${testResults.classifierPass}/${testResults.classifierTotal}`);
  console.log(`Language tests      : ${testResults.langPass}/${testResults.langTotal}`);
  console.log(`Dataset invariants  : ${invPass}/${invPass + invFail}`);
  console.log(`Groq called         : NON`);
  console.log(`DB writes           : NON`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  if (invFail > 0) {
    console.error(`❌ ${invFail} invariant(s) failed`);
    process.exit(1);
  }
}

// ─── Entry points ─────────────────────────────────────────────────────────────

module.exports = { classifyMessage, detectLanguage };

if (require.main === module) {
  main().catch(err => { console.error('❌ Fatal:', err.message); process.exit(1); });
}

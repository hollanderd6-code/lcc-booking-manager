'use strict';
/**
 * Tests unitaires — GROQ TRAVELER AI V2
 *
 * Couvre : buildTravelerContextFromRawData, buildTravelerSystemPrompt,
 *          validateTravelerDecision, isolement multi-tenant, shadow mode.
 * Aucun appel Groq réel. Aucun appel DB.
 *
 * Exécution : node tests/traveler_ai_v2.test.js
 */

const assert = require('assert');
const {
  buildTravelerContextFromRawData,
  buildTravelerSystemPrompt,
  validateTravelerDecision,
  callGroqTravelerV2,
  formatBenchmarkReport,
  formatGoldenReport,
  runGoldenSetBenchmark,
  computeContextFingerprint,
  _maskSensitive,
  _safeDiagStr,
  _resolveHistoricalReply,
  _buildFactsProvenance,
  _estimateCallTokens,
  _setDelay,
  VALID_ACTIONS,
  GOLDEN_IDS,
} = require('../services/traveler-ai-v2');

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.then(() => {
        console.log(`  ✅  ${name}`);
        passed++;
      }).catch(err => {
        console.error(`  ❌  ${name}`);
        console.error(`       ${err.message}`);
        failed++;
      });
    } else {
      console.log(`  ✅  ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// Conversation de base pour les tests
function makeConv(overrides = {}) {
  return {
    id: 100,
    property_id: 'prop-1',
    user_id: 42,
    guest_name: 'Test Voyageur',
    platform: 'booking',
    channex_booking_id: 'CHX_001',
    reservation_start_date: '2026-10-01',
    reservation_end_date: '2026-10-05',
    language: 'fr',
    ...overrides,
  };
}

function makeProp(overrides = {}) {
  return {
    id: 'prop-1',
    name: 'Le Test Logement',
    address: '1 Rue de la Paix',
    arrival_time: '15:00',
    departure_time: '11:00',
    access_code: '1234',
    access_instructions: 'Boîte à clés en façade',
    wifi_name: 'TestWifi',
    wifi_password: 'wifipass123',
    practical_info: 'Ascenseur disponible',
    deposit_amount: '200',
    late_checkout_tolerance_minutes: '120',
    early_checkin_tolerance_minutes: '60',
    late_checkout_enabled: false,
    late_checkout_price_per_hour: null,
    late_checkout_max_minutes: null,
    early_checkin_enabled: false,
    early_checkin_price_per_hour: null,
    early_checkin_max_minutes: null,
    welcome_basket_enabled: false,
    welcome_basket_price: null,
    welcome_basket_description: null,
    custom_auto_responses: null,
    ...overrides,
  };
}

function makeWelcomeBook(overrides = {}) {
  return {
    wifiSSID: 'WBWifi',
    wifiPassword: 'wbpass',
    keyboxCode: '9999',
    accessInstructions: 'Badge magnétique',
    parkingInfo: null,      // UNKNOWN par défaut
    equipmentList: null,    // UNKNOWN par défaut
    importantRules: 'Pas de fête',
    transportInfo: 'Métro ligne 4',
    checkoutTime: '11:00',
    checkoutInstructions: 'Laisser les clés sur la table',
    ...overrides,
  };
}

// Timestamp passé (avant check-in du 01/10)
const AT_BEFORE = new Date('2026-09-28T10:00:00Z'); // 3 jours avant

// ─── Série T0 : Sémantique KNOWN_TRUE / UNKNOWN ──────────────────────────────

console.log('\n── Série T0 : KNOWN_TRUE / UNKNOWN / KNOWN_FALSE ────────────────────────────');

test('T01 — parking null → info=null + known=false (UNKNOWN, pas false)', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv(),
    property: makeProp(),
    welcomeBook: makeWelcomeBook({ parkingInfo: null }),
    deposit: { status: 'authorized', amount_cents: 20000 },
    registration: { done: true, guest_country: 'FR', unique_token: null },
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx.parking.info, null, 'null = UNKNOWN, pas false');
  assert.strictEqual(ctx.parking.known, false, 'known=false quand info=null');
});

test('T02 — parking renseigné → info=texte + known=true (KNOWN_TRUE)', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv(),
    property: makeProp(),
    welcomeBook: makeWelcomeBook({ parkingInfo: 'Parking gratuit rue de la Paix' }),
    deposit: { status: 'authorized', amount_cents: 20000 },
    registration: { done: true, guest_country: 'FR', unique_token: null },
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx.parking.info, 'Parking gratuit rue de la Paix');
  assert.strictEqual(ctx.parking.known, true);
});

test('T03 — equipment null → list=null (UNKNOWN — ne pas inventer)', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv(),
    property: makeProp(),
    welcomeBook: makeWelcomeBook({ equipmentList: null }),
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx.equipment.list, null, 'equipmentList null → UNKNOWN');
});

// ─── Série T1 : Contrôle d'accès ─────────────────────────────────────────────

console.log('\n── Série T1 : Code d\'accès — guards de blocage ──────────────────────────────');

test('T04 — caution non payée → access.code=null + blocked_by=deposit', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'booking' }),  // non-Airbnb
    property: makeProp({ deposit_amount: '200' }),
    deposit: { status: 'pending', amount_cents: 20000 },  // non payée
    registration: { done: true, guest_country: 'FR', unique_token: null },
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx.access.code, null, 'code masqué si dépôt non payé');
  assert.strictEqual(ctx.access.blocked_by, 'deposit');
  assert.strictEqual(ctx.deposit.blocks_access, true);
});

test('T05 — caution payée → access.code disponible', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'booking' }),
    property: makeProp({ access_code: '5678', deposit_amount: '200' }),
    deposit: { status: 'authorized', amount_cents: 20000 },
    registration: { done: true, guest_country: 'FR', unique_token: null },
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx.access.code, '5678');
  assert.strictEqual(ctx.access.blocked_by, null);
});

test('T06 — Airbnb : access.code toujours disponible (pas de caution)', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'airbnb' }),
    property: makeProp({ access_code: '4321', deposit_amount: '200' }),
    deposit: { status: 'pending' },  // caution non payée mais Airbnb
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx.access.code, '4321', 'Airbnb → code toujours fourni');
  assert.strictEqual(ctx.guest.is_airbnb, true);
});

test('T07 — enregistrement requis (étranger, non-Airbnb) → access.code=null', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'booking' }),
    property: makeProp({ deposit_amount: '0' }),  // pas de caution
    deposit: null,
    registration: {
      done: false,
      guest_country: 'DE',  // étranger
      unique_token: 'abc123tok',
    },
    atTimestamp: AT_BEFORE,
    baseUrl: 'https://www.boostinghost.fr',
  });
  assert.strictEqual(ctx.access.code, null, 'code masqué si enregistrement requis');
  assert.strictEqual(ctx.access.blocked_by, 'registration');
  assert.strictEqual(ctx.registration.blocks_access, true);
  assert.ok(ctx.access.registration_link?.includes('abc123tok'), 'lien enregistrement présent');
});

test('T08 — voyageur français (FR) → enregistrement non requis', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'booking' }),
    property: makeProp({ deposit_amount: '0' }),
    registration: { done: false, guest_country: 'FR', unique_token: 'tok' },
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx.registration.blocks_access, false, 'FR → pas de blocage');
  assert.strictEqual(ctx.access.blocked_by, null);
});

// ─── Série T2 : Phase du séjour / Calculs temporels ──────────────────────────

console.log('\n── Série T2 : Phase du séjour ────────────────────────────────────────────────');

test('T09 — 3 jours avant check-in → phase=before, daysUntilCheckin=3', () => {
  // AT_BEFORE = 28 sep, check-in = 01 oct → 3 jours
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({
      reservation_start_date: '2026-10-01',
      reservation_end_date: '2026-10-05',
    }),
    property: makeProp(),
    atTimestamp: new Date('2026-09-28T10:00:00Z'),
  });
  assert.strictEqual(ctx.stay.phase, 'before');
  assert.strictEqual(ctx.stay.days_until_checkin, 3);
});

test('T10 — pendant le séjour → phase=during', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({
      reservation_start_date: '2026-10-01',
      reservation_end_date: '2026-10-05',
    }),
    property: makeProp(),
    atTimestamp: new Date('2026-10-03T10:00:00Z'),
  });
  assert.strictEqual(ctx.stay.phase, 'during');
});

test('T11 — après check-out → phase=after', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({
      reservation_start_date: '2026-10-01',
      reservation_end_date: '2026-10-05',
    }),
    property: makeProp(),
    atTimestamp: new Date('2026-10-06T10:00:00Z'),
  });
  assert.strictEqual(ctx.stay.phase, 'after');
});

// ─── Série T3 : validateTravelerDecision ──────────────────────────────────────

console.log('\n── Série T3 : validateTravelerDecision ───────────────────────────────────────');

test('T12 — action valide REPLY → normalisée correctement', () => {
  const d = validateTravelerDecision(JSON.stringify({
    action: 'REPLY',
    reply: 'Bonjour !',
    confidence: 0.9,
    reasoning: 'test',
    tags: ['greeting'],
    requires_human: false,
    hallucination_risk: 'LOW',
  }));
  assert.strictEqual(d.action, 'REPLY');
  assert.strictEqual(d.reply, 'Bonjour !');
  assert.strictEqual(d.confidence, 0.9);
  assert.strictEqual(d.hallucination_risk, 'LOW');
});

test('T13 — action invalide → Error explicite', () => {
  assert.throws(
    () => validateTravelerDecision(JSON.stringify({ action: 'SEND_MESSAGE', reply: 'x', confidence: 0.5 })),
    /action invalide/i,
    'Action non reconnue doit lancer une Error'
  );
});

test('T14 — confidence > 1 → clampé à 1.0', () => {
  const d = validateTravelerDecision(JSON.stringify({
    action: 'REPLY', reply: 'ok', confidence: 2.5,
    reasoning: '', tags: [], requires_human: false, hallucination_risk: 'LOW',
  }));
  assert.strictEqual(d.confidence, 1.0, 'confidence clampée à 1.0');
});

test('T15 — confidence < 0 → clampée à 0.0', () => {
  const d = validateTravelerDecision(JSON.stringify({
    action: 'ESCALATE', reply: null, confidence: -0.3,
    reasoning: '', tags: [], requires_human: true, hallucination_risk: 'HIGH',
  }));
  assert.strictEqual(d.confidence, 0.0);
});

test('T16 — JSON invalide → Error de parsing', () => {
  assert.throws(
    () => validateTravelerDecision('pas du json valide {{{'),
    /JSON invalide/i
  );
});

test('T17 — action LATE_CHECKOUT_REQUEST → préservée (pas auto-confirmée dans la réponse)', () => {
  const d = validateTravelerDecision(JSON.stringify({
    action: 'LATE_CHECKOUT_REQUEST',
    reply: 'Je transmets votre demande',
    confidence: 0.88,
    reasoning: 'Guest asks for late checkout',
    tags: ['late_checkout'],
    requires_human: true,
    hallucination_risk: 'LOW',
  }));
  assert.strictEqual(d.action, 'LATE_CHECKOUT_REQUEST');
  // Le backend décide, pas l'IA — on vérifie que la décision est signalée mais pas appliquée
  assert.strictEqual(d.requires_human, true, 'late checkout doit requérir validation humaine');
});

test('T18 — action EARLY_CHECKIN_REQUEST → préservée (pas auto-confirmée)', () => {
  const d = validateTravelerDecision(JSON.stringify({
    action: 'EARLY_CHECKIN_REQUEST',
    reply: null,
    confidence: 0.75,
    reasoning: 'Early checkin request',
    tags: ['early_checkin'],
    requires_human: true,
    hallucination_risk: 'LOW',
  }));
  assert.strictEqual(d.action, 'EARLY_CHECKIN_REQUEST');
  assert.strictEqual(d.requires_human, true);
});

test('T19 — hallucination_risk inconnu → MEDIUM par défaut', () => {
  const d = validateTravelerDecision(JSON.stringify({
    action: 'REPLY', reply: 'ok', confidence: 0.5,
    reasoning: '', tags: [], requires_human: false,
    hallucination_risk: 'EXTREME',  // invalide
  }));
  assert.strictEqual(d.hallucination_risk, 'MEDIUM', 'valeur inconnue → MEDIUM par défaut');
});

// ─── Série T4 : System Prompt ─────────────────────────────────────────────────

console.log('\n── Série T4 : buildTravelerSystemPrompt ──────────────────────────────────────');

test('T20 — champ non-null visible dans le prompt (KNOWN_TRUE)', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv(),
    property: makeProp({ name: 'Appartement Champs-Élysées', practical_info: 'Code portail 4567' }),
    deposit: { status: 'authorized', amount_cents: 20000 },
    atTimestamp: AT_BEFORE,
  });
  const prompt = buildTravelerSystemPrompt(ctx);
  assert.ok(prompt.includes('Appartement Champs-Élysées'), 'nom logement KNOWN_TRUE visible');
});

test('T21 — champ null → mention UNKNOWN dans le prompt', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv(),
    property: makeProp(),
    welcomeBook: makeWelcomeBook({ equipmentList: null, parkingInfo: null }),
    atTimestamp: AT_BEFORE,
  });
  const prompt = buildTravelerSystemPrompt(ctx);
  assert.ok(prompt.includes('UNKNOWN'), 'champs null marqués UNKNOWN dans le prompt');
  assert.ok(prompt.includes('ne pas inventer'), 'directive anti-hallucination présente');
});

test('T22 — access bloqué → prompt indique le prérequis, pas le code', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'booking' }),
    property: makeProp({ access_code: 'SECRET', deposit_amount: '200' }),
    deposit: { status: 'pending' },
    registration: { done: true, guest_country: 'FR', unique_token: null },
    atTimestamp: AT_BEFORE,
  });
  const prompt = buildTravelerSystemPrompt(ctx);
  assert.ok(!prompt.includes('SECRET'), 'le code d\'accès ne doit PAS apparaître si bloqué');
  assert.ok(prompt.includes('BLOQUÉ'), 'mention du blocage dans le prompt');
});

// ─── Série T5 : Isolation multi-tenant ───────────────────────────────────────

console.log('\n── Série T5 : Isolation multi-tenant ────────────────────────────────────────');

test('T23 — _meta contient les identifiants de la bonne conversation', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ id: 999, property_id: 'prop-XYZ', user_id: 77 }),
    property: makeProp({ id: 'prop-XYZ' }),
    atTimestamp: AT_BEFORE,
  });
  assert.strictEqual(ctx._meta.conversation_id, 999, 'conversation_id correct');
  assert.strictEqual(ctx._meta.property_id, 'prop-XYZ', 'property_id correct');
  assert.strictEqual(ctx._meta.user_id, 77, 'user_id correct');
});

test('T24 — contexte logement A n\'inclut pas les données du logement B', () => {
  // Airbnb (pas de caution) → code toujours résolu → deux logements avec codes distincts
  const ctxA = buildTravelerContextFromRawData({
    conversation: makeConv({ id: 1, property_id: 'prop-A', platform: 'airbnb' }),
    property: makeProp({ id: 'prop-A', name: 'Logement A', access_code: 'CODEA' }),
    atTimestamp: AT_BEFORE,
  });
  const ctxB = buildTravelerContextFromRawData({
    conversation: makeConv({ id: 2, property_id: 'prop-B', platform: 'airbnb' }),
    property: makeProp({ id: 'prop-B', name: 'Logement B', access_code: 'CODEB' }),
    atTimestamp: AT_BEFORE,
  });
  assert.notStrictEqual(ctxA._meta.property_id, ctxB._meta.property_id);
  assert.notStrictEqual(ctxA.access.code, ctxB.access.code, 'codes des deux logements sont distincts');
  assert.strictEqual(ctxA._meta.property_id, 'prop-A');
  assert.strictEqual(ctxB._meta.property_id, 'prop-B');
  assert.strictEqual(ctxA.access.code, 'CODEA');
  assert.strictEqual(ctxB.access.code, 'CODEB');
});

// ─── Série T6 : Module shadow mode ────────────────────────────────────────────

console.log('\n── Série T6 : Shadow mode — aucune fonction de send ─────────────────────────');

test('T25 — le module n\'exporte pas de fonctions d\'envoi de messages', () => {
  const exports = require('../services/traveler-ai-v2');
  const forbidden = ['sendBotMessage', 'transmitToChannex', 'escalateToOwner', 'sendNotification'];
  for (const name of forbidden) {
    assert.strictEqual(
      typeof exports[name], 'undefined',
      `${name} ne doit pas être exporté (shadow mode)`
    );
  }
});

test('T26 — toutes les actions VALID_ACTIONS sont un Set non vide', () => {
  assert.ok(VALID_ACTIONS instanceof Set, 'VALID_ACTIONS est un Set');
  assert.ok(VALID_ACTIONS.size >= 9, 'au moins 9 actions valides');
  assert.ok(VALID_ACTIONS.has('REPLY'), 'REPLY présent');
  assert.ok(VALID_ACTIONS.has('ESCALATE'), 'ESCALATE présent');
  assert.ok(VALID_ACTIONS.has('LATE_CHECKOUT_REQUEST'), 'LATE_CHECKOUT_REQUEST présent');
});

// ─── Série T7 : Masquage données sensibles ────────────────────────────────────

console.log('\n── Série T7 : Masquage données sensibles ─────────────────────────────────────');

test('T27 — _maskSensitive masque les numéros de téléphone 10 chiffres', () => {
  const result = _maskSensitive('Appelez-moi au 0612345678 pour tout renseignement');
  assert.ok(!result.includes('0612345678'), 'numéro masqué');
  assert.ok(result.includes('**********'), 'remplacé par étoiles');
});

test('T28 — _maskSensitive masque les emails', () => {
  const result = _maskSensitive('Contactez test@example.com merci');
  assert.ok(!result.includes('test@example.com'), 'email masqué');
  assert.ok(result.includes('***@***.***'), 'remplacé par masque');
});

test('T29 — _maskSensitive masque les URLs Stripe', () => {
  const result = _maskSensitive('Payez ici : https://checkout.stripe.com/pay/cs_live_abc123');
  assert.ok(!result.includes('cs_live_abc123'), 'token Stripe masqué');
  assert.ok(result.includes('[lien paiement masqué]'), 'remplacement correct');
});

test('T30 — _maskSensitive : null et undefined → inchangés', () => {
  assert.strictEqual(_maskSensitive(null), null);
  assert.strictEqual(_maskSensitive(undefined), undefined);
});

// ─── Série T8 : Association question → réponse historique ────────────────────

console.log('\n── Série T8 : Historical reply matching ──────────────────────────────────────');

test('T31 — _resolveHistoricalReply : premier msg hôte → reply correctement associée', () => {
  const row = { sender_type: 'owner', message: 'Bonjour, oui bien sûr !', is_bot_response: false };
  const { reply, replyType } = _resolveHistoricalReply(row);
  assert.strictEqual(reply, 'Bonjour, oui bien sûr !', 'message hôte retourné');
  assert.strictEqual(replyType, 'HUMAIN', 'sender_type=owner → HUMAIN');
});

test('T32 — _resolveHistoricalReply : premier msg est guest → AUCUNE réponse associée', () => {
  // guest1 → guest2 → host : le host ne répond pas à guest1
  const row = { sender_type: 'guest', message: 'Ah merci ! Et le parking ?', is_bot_response: false };
  const { reply, replyType } = _resolveHistoricalReply(row);
  assert.strictEqual(reply, null, 'pas de reply si suivant est guest');
  assert.strictEqual(replyType, 'AUCUNE', 'replyType AUCUNE');
});

test('T32b — _resolveHistoricalReply : null (aucun message suivant) → AUCUNE', () => {
  const { reply, replyType } = _resolveHistoricalReply(null);
  assert.strictEqual(reply, null);
  assert.strictEqual(replyType, 'AUCUNE');
});

test('T32c — _resolveHistoricalReply : sender_type=system → IA_V1', () => {
  const row = { sender_type: 'system', message: 'Réponse auto V1', is_bot_response: false };
  const { replyType } = _resolveHistoricalReply(row);
  assert.strictEqual(replyType, 'IA_V1');
});

test('T32d — _resolveHistoricalReply : property + is_bot_response=true → IA_AUTO', () => {
  const row = { sender_type: 'property', message: 'Message auto', is_bot_response: true };
  const { replyType } = _resolveHistoricalReply(row);
  assert.strictEqual(replyType, 'IA_AUTO');
});

// ─── Série T9 : Rate limit 429 ────────────────────────────────────────────────

console.log('\n── Série T9 : Rate limit 429 + json_validate_failed — retry ────────────────');

// T33+T34+T49+T50+T51 sont groupés dans un seul test async pour éviter la race
// condition sur global.fetch (plusieurs tests async s'exécuteraient en concurrence).
test('T33+T34+T49+T50+T51 — retry strategy 429 et json_validate_failed séquentiels', async () => {
  _setDelay(() => Promise.resolve());  // pas d'attente réelle en test
  const originalFetch = global.fetch;

  try {
    // ── Scénario C (T33) : 429 + retry-after → 1 retry → succès ─────────
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          status: 429, ok: false,
          headers: { get: (k) => k === 'retry-after' ? '1' : null },
          text: async () => 'rate limit exceeded',
        };
      }
      return {
        status: 200, ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            action: 'NO_REPLY', reply: null, confidence: 0.9,
            reasoning: 'test', tags: [], requires_human: false, hallucination_risk: 'LOW',
          }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      };
    };
    const rC = await callGroqTravelerV2({
      systemPrompt: 'sys', history: [], guestMessage: 'hi',
      apiKey: 'fake-key', label: 'T33-C',
    });
    assert.strictEqual(callCount, 2, 'C: fetch appelé 2 fois (1 + 1 retry)');
    assert.strictEqual(rC.error, null, 'C: pas d\'erreur après retry');
    assert.strictEqual(rC.decision?.action, 'NO_REPLY', 'C: décision correcte après retry');

    // ── Scénario D (T34) : 429 deux fois → erreur dans result, pas d'exception ─
    global.fetch = async () => ({
      status: 429, ok: false,
      headers: { get: () => null },
      text: async () => 'still rate limited',
    });
    const rD = await callGroqTravelerV2({
      systemPrompt: 'sys', history: [], guestMessage: 'hi',
      apiKey: 'fake-key', label: 'T33-D',
    });
    assert.ok(rD.error && rD.error.includes('429'), `D: erreur 429 attendue, obtenu: ${rD.error}`);
    assert.strictEqual(rD.decision, null, 'D: pas de décision');

    // ── Scénario E (T49+T50) : json_validate_failed → retry 1 fois → succès ─
    let callCountE = 0;
    global.fetch = async () => {
      callCountE++;
      if (callCountE === 1) {
        return {
          status: 400, ok: false,
          json: async () => ({
            error: {
              code: 'json_validate_failed',
              message: 'JSON validation failed',
              failed_generation: 'invalid json attempt',
            },
          }),
          text: async () => 'bad request',
        };
      }
      return {
        status: 200, ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            action: 'NO_REPLY', reply: null, confidence: 0.9,
            reasoning: 'retry ok', tags: [], requires_human: false, hallucination_risk: 'LOW',
          }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      };
    };
    const rE = await callGroqTravelerV2({
      systemPrompt: 'sys', history: [], guestMessage: 'hi',
      apiKey: 'fake-key', label: 'T49',
    });
    // T49 : failed_generation capturé
    assert.strictEqual(rE.failed_generation, 'invalid json attempt', 'T49: failed_generation capturé');
    assert.strictEqual(rE.error, null, 'T49: pas d\'erreur après retry réussi');
    assert.strictEqual(rE.decision?.action, 'NO_REPLY', 'T49: décision correcte après retry');
    // T50 : exactement 2 appels fetch
    assert.strictEqual(callCountE, 2, 'T50: fetch appelé exactement 2 fois (1 + 1 retry)');

    // ── Scénario F (T51) : json_validate_failed deux fois → error, pas d'exception ─
    global.fetch = async () => ({
      status: 400, ok: false,
      json: async () => ({
        error: {
          code: 'json_validate_failed',
          message: 'Still invalid',
          failed_generation: 'still broken json',
        },
      }),
      text: async () => 'still bad',
    });
    let didThrowF = false;
    let rF;
    try {
      rF = await callGroqTravelerV2({
        systemPrompt: 'sys', history: [], guestMessage: 'hi',
        apiKey: 'fake-key', label: 'T51',
      });
    } catch (e) {
      didThrowF = true;
    }
    assert.strictEqual(didThrowF, false, 'T51: pas d\'exception propagée vers l\'appelant');
    assert.ok(rF.error && rF.error.includes('400'), `T51: erreur HTTP 400 attendue, obtenu: ${rF.error}`);
    assert.strictEqual(rF.decision, null, 'T51: pas de décision sur double json_validate_failed');
    assert.strictEqual(rF.failed_generation, 'still broken json', 'T51: failed_generation capturé même sur double échec');

  } finally {
    global.fetch = originalFetch;
    _setDelay(null);
  }
});

// ─── Série T10 : Facts provenance ─────────────────────────────────────────────

console.log('\n── Série T10 : Facts provenance ──────────────────────────────────────────────');

test('T35 — _buildFactsProvenance : champs KNOWN_TRUE présents avec source', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'airbnb' }),
    property: makeProp({ arrival_time: '16:00', departure_time: '11:00', practical_info: 'Ascenseur' }),
    atTimestamp: AT_BEFORE,
  });
  const facts = _buildFactsProvenance(ctx);
  const checkin = facts.find(f => f.fact === 'checkin_time');
  assert.ok(checkin, 'checkin_time présent');
  assert.strictEqual(checkin.value, '16:00', 'valeur correcte');
  assert.ok(checkin.source.includes('property.arrival_time'), 'source correcte');
  const practical = facts.find(f => f.fact === 'practical_info');
  assert.ok(practical, 'practical_info présent');
  assert.strictEqual(practical.value, 'Ascenseur');
});

test('T36 — _buildFactsProvenance : champs null exclus', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'airbnb' }),
    property: makeProp({ practical_info: null }),
    welcomeBook: makeWelcomeBook({ parkingInfo: null, equipmentList: null }),
    atTimestamp: AT_BEFORE,
  });
  const facts = _buildFactsProvenance(ctx);
  const parking  = facts.find(f => f.fact === 'parking_info');
  const equipt   = facts.find(f => f.fact === 'equipment_list');
  const practical = facts.find(f => f.fact === 'practical_info');
  assert.strictEqual(parking,   undefined, 'parking_info null → absent de facts_provenance');
  assert.strictEqual(equipt,    undefined, 'equipment_list null → absent');
  assert.strictEqual(practical, undefined, 'practical_info null → absent');
});

test('T37 — _buildFactsProvenance : valeurs sensibles masquées', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'airbnb' }),
    property: makeProp({ access_code: 'SECRET_CODE', wifi_password: 'WIFI_SECRET' }),
    atTimestamp: AT_BEFORE,
  });
  const facts = _buildFactsProvenance(ctx);
  const codeFact = facts.find(f => f.fact === 'access_code');
  const wifiFact = facts.find(f => f.fact === 'wifi_password');
  assert.ok(codeFact, 'access_code présent');
  assert.strictEqual(codeFact.value, '[MASKED]', 'access_code masqué');
  assert.ok(wifiFact, 'wifi_password présent');
  assert.strictEqual(wifiFact.value, '[MASKED]', 'wifi_password masqué');
  // Valeur brute ne doit pas fuiter
  assert.ok(!JSON.stringify(facts).includes('SECRET_CODE'), 'SECRET_CODE ne fuite pas');
  assert.ok(!JSON.stringify(facts).includes('WIFI_SECRET'), 'WIFI_SECRET ne fuite pas');
});

// ─── Série T11 : Rapport — ordre et diagnostic ────────────────────────────────

console.log('\n── Série T11 : formatBenchmarkReport — ordre et diagnostic ──────────────────');

function makeMockResult(caseId, convId) {
  return {
    case_id:         caseId,
    conversation_id: convId,
    property_id:     'prop-test',
    message_at:      new Date('2026-09-01T10:00:00Z'),
    guest_name:      'Voyageur Test',
    platform:        'direct',
    guest_message:   'Bonjour, question test',
    historical_reply: null,
    historical_reply_type: 'AUCUNE',
    decision: {
      action: 'REPLY', reply: 'Bonjour !', confidence: 0.9,
      reasoning: 'test', tags: ['greeting'], requires_human: false, hallucination_risk: 'LOW',
    },
    latency_ms: 1200,
    tokens: { input: 500, output: 100, total: 600 },
    error: null,
    historical_context_limitation: true,
    context: {
      property_name: 'Test Apt', stay_phase: 'before',
      checkin_date: '2026-10-01', checkout_date: '2026-10-05',
      guest_lang: 'fr', access_code_known: false, wifi_known: true,
      parking_known: false, few_shot_count: 2,
    },
    _diag: {
      stored_language: 'fr',
      history_sent_to_model: [
        { role: 'user', content: 'Premier message guest' },
        { role: 'assistant', content: 'Première réponse hôte' },
      ],
      few_shot_sent_to_model: [
        { idx: 1, guest: 'exemple guest', host: 'exemple hôte' },
      ],
      facts_provenance: [
        { fact: 'checkout_time', source: 'property.departure_time', value: '11:00' },
      ],
    },
  };
}

test('T38 — formatBenchmarkReport : CASE-001 avant CASE-002 même si inversés en entrée', () => {
  const r1 = makeMockResult('CASE-001', 1);
  const r2 = makeMockResult('CASE-002', 2);
  const report = formatBenchmarkReport([r2, r1]);  // inversé intentionnellement
  const idx1 = report.indexOf('CASE-001');
  const idx2 = report.indexOf('CASE-002');
  assert.ok(idx1 >= 0, 'CASE-001 présent');
  assert.ok(idx2 >= 0, 'CASE-002 présent');
  assert.ok(idx1 < idx2, `CASE-001 (pos ${idx1}) avant CASE-002 (pos ${idx2})`);
});

test('T39 — formatBenchmarkReport : sections diagnostic présentes', () => {
  const r = makeMockResult('CASE-001', 1);
  const report = formatBenchmarkReport([r]);
  assert.ok(report.includes('HISTORY_SENT_TO_MODEL'), 'section history présente');
  assert.ok(report.includes('FEW_SHOT_SENT_TO_MODEL'), 'section few-shot présente');
  assert.ok(report.includes('FACTS_PROVENANCE'), 'section facts_provenance présente');
  assert.ok(report.includes('STORED_LANGUAGE'), 'stored_language présent');
  assert.ok(report.includes('CURRENT_GUEST_MESSAGE'), 'current_guest_message présent');
  assert.ok(report.includes('FACT   : checkout_time'), 'FACT/SOURCE/VALUE format présent');
  assert.ok(report.includes('SOURCE : property.departure_time'), 'SOURCE affiché');
  assert.ok(report.includes('VALUE  : 11:00'), 'VALUE affiché');
});

// ─── Série T12 : _safeDiagStr — sérialisation sûre ───────────────────────────

console.log('\n── Série T12 : _safeDiagStr — sérialisation sûre ────────────────────────────');

test('T40 — _safeDiagStr : string → inchangée', () => {
  assert.strictEqual(_safeDiagStr('Bonjour voyageur'), 'Bonjour voyageur');
});

test('T41 — _safeDiagStr : number → string', () => {
  assert.strictEqual(_safeDiagStr(42), '42');
  assert.strictEqual(_safeDiagStr(3.14), '3.14');
});

test('T42 — _safeDiagStr : boolean → string', () => {
  assert.strictEqual(_safeDiagStr(true), 'true');
  assert.strictEqual(_safeDiagStr(false), 'false');
});

test('T43 — _safeDiagStr : null/undefined → chaîne vide', () => {
  assert.strictEqual(_safeDiagStr(null), '');
  assert.strictEqual(_safeDiagStr(undefined), '');
});

test('T44 — _safeDiagStr : objet JSONB → JSON string lisible', () => {
  const obj = { amenities: ['wifi', 'parking'], floor: 3 };
  const result = _safeDiagStr(obj);
  assert.strictEqual(typeof result, 'string', 'résultat est une string');
  assert.ok(result.includes('wifi'), 'contenu JSON présent');
  assert.ok(!result.includes('[object Object]'), 'jamais [object Object]');
});

test('T45 — _safeDiagStr : array → JSON string', () => {
  const arr = ['item1', 'item2'];
  const result = _safeDiagStr(arr);
  assert.ok(result.includes('item1'), 'item1 présent');
  assert.ok(result.startsWith('['), 'commence par [');
});

test('T46 — _safeDiagStr : objet circulaire → "[UNSERIALIZABLE]"', () => {
  const circ = {};
  circ.self = circ;
  assert.strictEqual(_safeDiagStr(circ), '[UNSERIALIZABLE]');
});

// ─── Série T13 : BUG 1 fix — null content ne crashe plus ─────────────────────

console.log('\n── Série T13 : BUG 1 fix — null content ne crashe plus ─────────────────────');

test('T47 — _buildFactsProvenance : practical_info objet JSONB → jamais [object Object]', () => {
  const ctx = buildTravelerContextFromRawData({
    conversation: makeConv({ platform: 'airbnb' }),
    property: makeProp({ practical_info: { amenities: ['wifi', 'parking'], floor: 3 } }),
    atTimestamp: AT_BEFORE,
  });
  const facts = _buildFactsProvenance(ctx);
  const practical = facts.find(f => f.fact === 'practical_info');
  assert.ok(practical, 'practical_info présent dans facts');
  assert.ok(!practical.value.includes('[object Object]'), 'jamais [object Object]');
  assert.ok(practical.value.includes('wifi') || practical.value.startsWith('{'), 'valeur JSON sérialisée');
});

test('T48 — null content : _maskSensitive(_safeDiagStr(null)).substring() ne lève jamais', () => {
  let threw = false;
  try {
    const result = _maskSensitive(_safeDiagStr(null)).substring(0, 400);
    assert.strictEqual(result, '', 'null → chaîne vide dans la chaîne complète');
    _maskSensitive(_safeDiagStr(undefined)).substring(0, 400);
    _maskSensitive(_safeDiagStr({ role: 'user', content: null })).substring(0, 400);
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'aucune exception avec null/undefined/objet (BUG 1 fix)');
});

// ─── Série T15 : Budget TPM pré-appel ────────────────────────────────────────

console.log('\n── Série T15 : Budget TPM — _estimateCallTokens ─────────────────────────────');

test('T52 — _estimateCallTokens : estimation conservative (chars/3 + 600)', () => {
  // 300 + 150 + 150 = 600 chars history, 300 sys, 150 msg → total 750 → ceil(750/3)+600 = 250+600 = 850
  const sys  = 'a'.repeat(300);
  const hist = [{ role: 'user', content: 'b'.repeat(150) }, { role: 'assistant', content: 'c'.repeat(150) }];
  const msg  = 'd'.repeat(150);
  const est  = _estimateCallTokens(sys, hist, msg);
  const expected = Math.ceil((300 + 300 + 150) / 3) + 600;  // 250 + 600 = 850
  assert.strictEqual(est, expected, `estimation: ${est}, attendu: ${expected}`);

  // Minimum absolu : inputs vides → 0 chars → ceil(0/3)+600 = 600
  const min = _estimateCallTokens('', [], '');
  assert.strictEqual(min, 600, 'minimum 600 (max_tokens output réservé même avec inputs vides)');

  // Avec history contenant null content → pas d'exception (sécurité _safeDiagStr)
  let threw = false;
  try {
    _estimateCallTokens('sys', [{ role: 'user', content: null }], 'msg');
  } catch (e) {
    threw = true;
  }
  assert.strictEqual(threw, false, 'null content dans history ne crashe pas _estimateCallTokens');
});

// ─── Série T16 : Few-shot metadata dans le rapport ───────────────────────────

console.log('\n── Série T16 : Few-shot metadata — FEW_SHOT_SOURCE dans rapport ───────────────');

test('T53 — formatBenchmarkReport : FEW_SHOT_SOURCE affiche source+sender_type+sender_name', () => {
  const r = makeMockResult('CASE-001', 1);
  r._diag.few_shot_sent_to_model = [
    { idx: 1, guest: 'exemple', host: 'réponse', source: 'this_conv', sender_type: 'owner', sender_name: 'Charles' },
    { idx: 2, guest: 'autre', host: 'autre hôte', source: 'other_conv', sender_type: 'system', sender_name: null },
  ];
  const report = formatBenchmarkReport([r]);
  assert.ok(report.includes('FEW_SHOT_SOURCE:'), 'FEW_SHOT_SOURCE: présent dans rapport');
  assert.ok(report.includes('source=this_conv'), 'source=this_conv affiché');
  assert.ok(report.includes('sender_type=owner'), 'sender_type=owner affiché');
  assert.ok(report.includes('sender_name=Charles'), 'sender_name=Charles affiché');
  assert.ok(report.includes('source=other_conv'), 'source=other_conv affiché');
  assert.ok(report.includes('sender_type=system'), 'sender_type=system affiché');
  // sender_name null → affiche "—"
  assert.ok(report.includes('sender_name=—'), 'sender_name null → "—" affiché');
});

// ─── Série T17 : Golden Set — structure et déterminisme ──────────────────────

console.log('\n── Série T17 : Golden Set — GOLDEN_IDS, ordre, fingerprint ─────────────────');

const fs   = require('fs');
const path = require('path');

test('T54 — GOLDEN_IDS contient exactement 6 message IDs numériques', () => {
  assert.strictEqual(Array.isArray(GOLDEN_IDS), true, 'GOLDEN_IDS est un Array');
  assert.strictEqual(GOLDEN_IDS.length, 6, '6 IDs exactement');
  for (const id of GOLDEN_IDS) {
    assert.strictEqual(typeof id, 'number', `ID ${id} doit être un number`);
  }
});

test('T55 — GOLDEN_IDS ordre exact : 3139, 8786, 6072, 2592, 3749, 6913', () => {
  assert.deepStrictEqual(GOLDEN_IDS, [3139, 8786, 6072, 2592, 3749, 6913]);
});

test('T56 — runGoldenSetBenchmark : aucun RANDOM() ni Math.random', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'traveler-ai-v2.js'), 'utf8');
  const fnStart = src.indexOf('function runGoldenSetBenchmark');
  const fnEnd   = src.indexOf('\nfunction formatBenchmarkReport');
  assert.ok(fnStart >= 0, 'runGoldenSetBenchmark présente dans le source');
  const goldenSrc = fnStart >= 0 ? src.substring(fnStart, fnEnd > fnStart ? fnEnd : undefined) : '';
  assert.ok(!goldenSrc.includes('RANDOM()'),    'RANDOM() absent de runGoldenSetBenchmark');
  assert.ok(!goldenSrc.includes('Math.random'), 'Math.random absent de runGoldenSetBenchmark');
});

test('T57 — runGoldenSetBenchmark : message manquant → MISSING_MESSAGE_ID + continuation', async () => {
  const mockPool = { query: async () => ({ rows: [] }) };
  const results  = await runGoldenSetBenchmark(mockPool, { apiKey: 'fake-key' });

  assert.strictEqual(results.length, 6, '6 résultats retournés même si tous manquants');
  for (let i = 0; i < 6; i++) {
    assert.ok(results[i].error?.includes('MISSING_MESSAGE_ID'),
      `${results[i].case_id}: MISSING_MESSAGE_ID dans error`);
    assert.ok(results[i].error?.includes(String(GOLDEN_IDS[i])),
      `${results[i].case_id}: ID ${GOLDEN_IDS[i]} cité dans l'erreur`);
  }
});

test('T58 — runGoldenSetBenchmark : labels GOLDEN-001 à GOLDEN-006 stables', async () => {
  const mockPool   = { query: async () => ({ rows: [] }) };
  const results    = await runGoldenSetBenchmark(mockPool, { apiKey: 'fake-key' });
  const expected   = ['GOLDEN-001', 'GOLDEN-002', 'GOLDEN-003', 'GOLDEN-004', 'GOLDEN-005', 'GOLDEN-006'];
  for (let i = 0; i < 6; i++) {
    assert.strictEqual(results[i].case_id, expected[i], `position ${i}: case_id correct`);
  }
});

// ─── Série T18 : Context fingerprint ──────────────────────────────────────────

console.log('\n── Série T18 : computeContextFingerprint — déterminisme et isolation ──────');

test('T59 — computeContextFingerprint : contexte identique → fingerprint identique (16 hex)', () => {
  const payload = {
    guestMessage: 'Bonjour, à quelle heure puis-je arriver ?',
    history:      [{ role: 'user', content: 'Premier message' }],
    fewShot:      [{ guest: 'exemple', host: 'réponse' }],
    systemPrompt: 'Vous êtes un assistant hôte.',
  };
  const fp1 = computeContextFingerprint(payload);
  const fp2 = computeContextFingerprint(payload);
  assert.strictEqual(fp1, fp2, 'fingerprint déterministe');
  assert.strictEqual(fp1.length, 16, 'fingerprint = 16 caractères hex');
  assert.ok(/^[0-9a-f]{16}$/.test(fp1), 'format hex valide');
});

test('T60 — computeContextFingerprint : guest message différent → fingerprint différent', () => {
  const base = { guestMessage: 'Message A', history: [], fewShot: [], systemPrompt: 'sys' };
  const fp1  = computeContextFingerprint(base);
  const fp2  = computeContextFingerprint({ ...base, guestMessage: 'Message B entièrement différent' });
  assert.notStrictEqual(fp1, fp2, 'fingerprint change quand guest message change');
});

test('T61 — computeContextFingerprint : history différente → fingerprint différent', () => {
  const base = { guestMessage: 'Test', history: [{ role: 'user', content: 'msg A' }], fewShot: [], systemPrompt: 'sys' };
  const fp1  = computeContextFingerprint(base);
  const fp2  = computeContextFingerprint({ ...base, history: [{ role: 'user', content: 'msg B différent' }] });
  assert.notStrictEqual(fp1, fp2, 'fingerprint change quand history change');
});

test('T62 — computeContextFingerprint : latency/tokens/reply exclus du calcul', () => {
  const base = { guestMessage: 'Test', history: [], fewShot: [], systemPrompt: 'sys' };
  const fp1  = computeContextFingerprint(base);
  // Ces champs non-déterministes sont ignorés car non inclus dans le calcul
  const fp2  = computeContextFingerprint({
    ...base,
    latency_ms:   9999,
    tokens:       { input: 500, output: 100, total: 600 },
    raw_response: '{"action":"REPLY","reply":"Bonjour"}',
  });
  assert.strictEqual(fp1, fp2, 'latency/tokens/reply n\'affectent pas le fingerprint');
});

// ─── Série T19 : Launcher golden mode ─────────────────────────────────────────

console.log('\n── Série T19 : Launcher Render — golden mode ───────────────────────────────');

test('T63 — launcher Render utilise runGoldenSetBenchmark et log MODE=GOLDEN_SET', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'run-traveler-v2-once.js'), 'utf8');
  assert.ok(src.includes('runGoldenSetBenchmark'), 'runGoldenSetBenchmark importé dans le launcher');
  assert.ok(src.includes('GOLDEN_SET'),            'log MODE=GOLDEN_SET présent');
  assert.ok(src.includes('GOLDEN_IDS.length'),     'CASES = GOLDEN_IDS.length affiché');
  assert.ok(!src.includes('runTravelerBenchmark'), 'runTravelerBenchmark plus utilisé dans le launcher');
});

test('T64 — traveler-ai-v2.js : aucune écriture DB dans runGoldenSetBenchmark', () => {
  const src      = fs.readFileSync(path.join(__dirname, '..', 'services', 'traveler-ai-v2.js'), 'utf8');
  const fnStart  = src.indexOf('function runGoldenSetBenchmark');
  const fnEnd    = src.indexOf('\nfunction formatBenchmarkReport');
  assert.ok(fnStart >= 0, 'runGoldenSetBenchmark présente');
  const goldenSrc = src.substring(fnStart, fnEnd > fnStart ? fnEnd : src.length);
  assert.ok(!/\bINSERT\s+INTO\b/i.test(goldenSrc),  'aucun INSERT INTO');
  assert.ok(!/\bUPDATE\s+\w/i.test(goldenSrc),      'aucun UPDATE');
  assert.ok(!/\bDELETE\s+FROM\b/i.test(goldenSrc),  'aucun DELETE FROM');
});

test('T66 — computeContextFingerprint : travelerContext différent → fingerprint différent', () => {
  const base = { guestMessage: 'Test', history: [], fewShot: [], systemPrompt: 'sys' };
  const fp1  = computeContextFingerprint({
    ...base,
    travelerContext: { stay: { checkin_date: '2026-10-01', checkout_date: '2026-10-05' } },
  });
  const fp2  = computeContextFingerprint({
    ...base,
    travelerContext: { stay: { checkin_date: '2026-11-01', checkout_date: '2026-11-05' } },
  });
  assert.notStrictEqual(fp1, fp2, 'fingerprint change si travelerContext change (ex: dates check-in/out)');
});

test('T67 — computeContextFingerprint : travelerContext key-order indépendant (canonique)', () => {
  const base = { guestMessage: 'Test', history: [], fewShot: [], systemPrompt: 'sys' };
  const fp1  = computeContextFingerprint({
    ...base,
    travelerContext: { a: 1, b: 2, stay: { checkin_date: '2026-10-01', wifi: 'TestWifi' } },
  });
  const fp2  = computeContextFingerprint({
    ...base,
    travelerContext: { b: 2, a: 1, stay: { wifi: 'TestWifi', checkin_date: '2026-10-01' } },
  });
  assert.strictEqual(fp1, fp2, 'fingerprint identique même si ordre des clés differ ({a,b} ≡ {b,a})');
});

test('T65 — formatGoldenReport : TOTAL=6, GOLDEN SET SUMMARY, MANUAL REVIEW', () => {
  const mockResults = GOLDEN_IDS.map((id, i) => ({
    case_id:               `GOLDEN-${String(i + 1).padStart(3, '0')}`,
    message_id:            id,
    conversation_id:       null,
    property_id:           null,
    guest_name:            null,
    platform:              null,
    message_at:            new Date('2026-09-01T10:00:00Z'),
    guest_message:         null,
    historical_reply:      null,
    historical_reply_type: null,
    historical_context_limitation: true,
    context:               null,
    context_fingerprint:   null,
    decision:              null,
    latency_ms:            null,
    tokens:                null,
    error:                 `MISSING_MESSAGE_ID: ${id}`,
    _diag:                 null,
  }));
  const report = formatGoldenReport(mockResults);
  assert.ok(report.includes('TOTAL :               6'), 'TOTAL=6 dans le résumé');
  assert.ok(report.includes('GOLDEN SET SUMMARY'),       'section GOLDEN SET SUMMARY présente');
  assert.ok(report.includes('MANUAL REVIEW'),            'section MANUAL REVIEW présente');
  assert.ok(report.includes('GOLDEN-001 : __/5'),        'grille notation GOLDEN-001 présente');
  assert.ok(report.includes('GOLDEN-006 : __/5'),        'grille notation GOLDEN-006 présente');
  assert.ok(report.includes(`MISSING_MESSAGE_ID: ${GOLDEN_IDS[0]}`), 'MISSING_MESSAGE_ID GOLDEN-001 affiché');
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
// Note : les tests async se terminent après ce bloc. Pour les suites async,
// le process.exit est différé.
setImmediate(() => {
  // Attendre la résolution des tests async (microtasks déjà résolues ici)
  setTimeout(() => {
    console.log(`\n── Résultat ──────────────────────────────────────────────────────────────────`);
    console.log(`   ${passed} test(s) réussi(s)  |  ${failed} échec(s)\n`);
    if (failed > 0) process.exit(1);
  }, 50);
});

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
  _maskSensitive,
  _resolveHistoricalReply,
  _buildFactsProvenance,
  _setDelay,
  VALID_ACTIONS,
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

console.log('\n── Série T9 : Rate limit 429 — retry ────────────────────────────────────────');

// T33 et T34 sont groupés dans un seul test async pour éviter la race condition
// sur global.fetch (les deux s'exécuteraient en concurrence sinon).
test('T33+T34 — 429 retry strategy : scénarios C et D séquentiels', async () => {
  _setDelay(() => Promise.resolve());  // pas d'attente réelle en test
  const originalFetch = global.fetch;

  try {
    // ── Scénario C : 429 + retry-after → 1 retry → succès ────────────────
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

    // ── Scénario D : 429 deux fois → erreur dans result, pas d'exception ─
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

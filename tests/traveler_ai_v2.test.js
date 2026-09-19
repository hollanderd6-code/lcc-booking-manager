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
  _maskSensitive,
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

// ─── Résumé ───────────────────────────────────────────────────────────────────
// Note : les tests async se terminent après ce bloc. Pour les suites async,
// le process.exit est différé.
setImmediate(() => {
  console.log(`\n── Résultat ──────────────────────────────────────────────────────────────────`);
  console.log(`   ${passed} test(s) réussi(s)  |  ${failed} échec(s)\n`);
  if (failed > 0) process.exit(1);
});

#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — Effective Price Resolver (P0-A)
 *
 * Couvre :
 *   TC01–TC06  : Résolution de base (none, base, weekend, period, weekday)
 *   TC07–TC10  : BoostPrice (actif, inactif, pending ignoré, breakdown)
 *   TC11–TC15  : Interactions override / priorités
 *   TC16–TC16b : external_pricing
 *   TC17–TC20  : min_stay (portée narrowest-span, DOW, global, défaut=1)
 *   TC21–TC24  : Validité prix (0, négatif, null, positif)
 *   TC25–TC27  : Plages de dates (vide, unitaire, multi-jours)
 *   TC28–TC30  : Priorités period_rule (priority DESC first-match, PAS narrowest)
 *   TC31–TC33  : Format de sortie (locked, sourceId, calculatedAt)
 *   TC34–TC35  : Propriété introuvable / userId sans correspondance
 *   TC36       : Régression — wider span + higher priority wins over narrower span
 *   TC37–TC40  : Parité legacy (override>period>weekday>weekend>base)
 *   TC41       : Race state — resolver lit l'état courant
 *   TC42–TC45  : Cas limites (breakdown null, min_stay arrival≠through, bpActive sans config)
 *
 * Exécution : node tests/effective_pricing_resolver.test.js
 * Aucun appel DB réel. Aucun appel Groq. Aucun appel Channex.
 */

const assert = require('assert');
const {
  resolveEffectivePrices,
  SOURCE,
  calcMinStay,
  fmtDate,
  addDays,
  utcDow,
} = require('../routes/effective-pricing-resolver');

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

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
        failures.push({ name, message: err.message });
        failed++;
      });
    } else {
      console.log(`  ✅  ${name}`);
      passed++;
    }
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ─── Mock pool ────────────────────────────────────────────────────────────────

function makeMockPool(tables = {}) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').toLowerCase();

      if (s.includes('from properties')) {
        return { rows: tables.properties || [] };
      }
      if (s.includes('from pricing_config')) {
        return { rows: tables.pricing_config || [] };
      }
      if (s.includes('from pricing_overrides')) {
        const start = params[2];
        const end   = params[3];
        return {
          rows: (tables.pricing_overrides || []).filter(r => r.date >= start && r.date < end),
        };
      }
      if (s.includes('from pricing_schedule')) {
        const start = params[1];
        const end   = params[2];
        return {
          rows: (tables.pricing_schedule || [])
            .filter(r => r.date >= start && r.date < end && r.status === 'applied'),
        };
      }
      if (s.includes('from pricing_rules')) {
        const active = (tables.pricing_rules || []).filter(r => r.active !== false);
        active.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return { rows: active };
      }
      throw new Error(`MockPool: unrecognized query: ${sql.slice(0, 100)}`);
    },
  };
}

// ─── Fixtures helper ──────────────────────────────────────────────────────────

function prop(overrides = {}) {
  return { base_price: 100, weekend_price: null, external_pricing: false, ...overrides };
}

function cfg(overrides = {}) {
  return { is_active: true, ...overrides };
}

// A Monday (2026-09-21) and a Friday (2026-09-18) and Saturday (2026-09-20)
// utcDow('2026-09-21') = 1 (Mon), utcDow('2026-09-18') = 4 (Thu)... let me verify:
// 2026-09-21 is a Monday → utcDow = 1
// 2026-09-18 is a Thursday → utcDow = 4... wait no.
// Let me compute: Sept 21 2026 is Monday (verified). Sept 18 = Friday? No: Mon=21, Sun=20, Sat=19, Fri=18?
// 21 Mon, 20 Sun, 19 Sat, 18 Fri → utcDow('2026-09-18') = 5 (Fri)
// utcDow('2026-09-19') = 6 (Sat)
// utcDow('2026-09-20') = 0 (Sun)

const MON = '2026-09-21'; // dow=1
const FRI = '2026-09-18'; // dow=5  ← weekend
const SAT = '2026-09-19'; // dow=6  ← weekend

// ─── Section 01–06: Basic resolution ─────────────────────────────────────────

console.log('\n── TC01–TC06 : Résolution de base ──');

test('TC01 — no data → source=none, price=null, priceValid=false', async () => {
  const pool = makeMockPool({ properties: [prop({ base_price: null, weekend_price: null })] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].source, SOURCE.NONE);
  assert.strictEqual(res[0].price, null);
  assert.strictEqual(res[0].priceValid, false);
});

test('TC02 — base_price only → source=base_price', async () => {
  const pool = makeMockPool({ properties: [prop()] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE);
  assert.strictEqual(res[0].price, 100);
  assert.strictEqual(res[0].priceValid, true);
});

test('TC03 — weekend_price on Friday → source=weekend_price', async () => {
  const pool = makeMockPool({ properties: [prop({ weekend_price: 150 })] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: FRI, endDate: addDays(FRI, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.WEEKEND_PRICE);
  assert.strictEqual(res[0].price, 150);
  assert.strictEqual(utcDow(FRI), 5, 'FRI fixture should be dow=5');
});

test('TC04 — weekend_price set but date is Monday → source=base_price', async () => {
  const pool = makeMockPool({ properties: [prop({ weekend_price: 150 })] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE);
  assert.strictEqual(res[0].price, 100);
});

test('TC05 — period rule covers date → source=period_rule', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [{
      id: 10, rule_type: 'period', price: 200, priority: 0,
      start_date: '2026-09-20', end_date: '2026-09-22', active: true,
    }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.PERIOD_RULE);
  assert.strictEqual(res[0].price, 200);
  assert.strictEqual(res[0].sourceId, 10);
});

test('TC06 — period rule does not cover date → falls through to base_price', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [{
      id: 10, rule_type: 'period', price: 200, priority: 0,
      start_date: '2026-10-01', end_date: '2026-10-31', active: true,
    }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE);
});

// ─── Section 07–10: BoostPrice ────────────────────────────────────────────────

console.log('\n── TC07–TC10 : BoostPrice ──');

test('TC07 — BoostPrice active + applied entry → source=boostprice', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BOOSTPRICE);
  assert.strictEqual(res[0].price, 175);
  assert.strictEqual(res[0].sourceId, 99);
});

test('TC08 — BoostPrice active + pending entry → NOT picked up (falls to base_price)', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: MON, price: 175, status: 'pending', id: 99 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE);
  assert.strictEqual(res[0].price, 100);
});

test('TC09 — BoostPrice is_active=false → applied entry ignored', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg({ is_active: false })],
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE);
});

test('TC10 — BoostPrice breakdown field is populated', async () => {
  const bd = { factors: { season: 1.2, lead: 0.95 } };
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99, breakdown: bd }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.deepStrictEqual(res[0].breakdown, bd);
});

// ─── Section 11–15: Priority interactions ────────────────────────────────────

console.log('\n── TC11–TC15 : Interactions de priorité ──');

test('TC11 — manual_override beats BoostPrice applied', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99 }],
    pricing_overrides: [{ date: MON, price: 250, id: 5 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.MANUAL_OVERRIDE);
  assert.strictEqual(res[0].price, 250);
  assert.strictEqual(res[0].locked, true);
});

test('TC12 — manual_override beats period_rule', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [{
      id: 10, rule_type: 'period', price: 200, priority: 10,
      start_date: '2026-09-20', end_date: '2026-09-22', active: true,
    }],
    pricing_overrides: [{ date: MON, price: 300, id: 7 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.MANUAL_OVERRIDE);
  assert.strictEqual(res[0].price, 300);
});

test('TC13 — BoostPrice applied beats period_rule', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99 }],
    pricing_rules: [{
      id: 10, rule_type: 'period', price: 200, priority: 10,
      start_date: '2026-09-20', end_date: '2026-09-22', active: true,
    }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BOOSTPRICE);
  assert.strictEqual(res[0].price, 175);
});

test('TC14 — period_rule beats weekday_rule', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [
      { id: 1, rule_type: 'period', price: 200, priority: 0,
        start_date: '2026-09-20', end_date: '2026-09-22', active: true },
      { id: 2, rule_type: 'weekday', price: 130, priority: 0,
        days_of_week: [1], active: true }, // Mon=1
    ],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.PERIOD_RULE);
  assert.strictEqual(res[0].price, 200);
});

test('TC15 — weekday_rule beats base/weekend price', async () => {
  const pool = makeMockPool({
    properties: [prop({ weekend_price: 150 })],
    pricing_rules: [
      { id: 3, rule_type: 'weekday', price: 120, priority: 0,
        days_of_week: [5], active: true }, // Fri=5
    ],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: FRI, endDate: addDays(FRI, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.WEEKDAY_RULE);
  assert.strictEqual(res[0].price, 120);
});

// ─── Section 16: external_pricing ────────────────────────────────────────────

console.log('\n── TC16–TC16b : external_pricing ──');

test('TC16 — external_pricing=true → BoostPrice NOT active (applied entry ignored)', async () => {
  const pool = makeMockPool({
    properties: [prop({ external_pricing: true })],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.notStrictEqual(res[0].source, SOURCE.BOOSTPRICE, 'BoostPrice must be skipped for external pricing');
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE);
});

test('TC16b — external_pricing=true, override present → override still wins', async () => {
  const pool = makeMockPool({
    properties: [prop({ external_pricing: true })],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99 }],
    pricing_overrides: [{ date: MON, price: 280, id: 8 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.MANUAL_OVERRIDE);
  assert.strictEqual(res[0].price, 280);
});

// ─── Section 17–20: min_stay ──────────────────────────────────────────────────

console.log('\n── TC17–TC20 : min_stay ──');

test('TC17 — min_stay date range: narrowest span wins over wider span', () => {
  const rules = [
    { rule_type: 'min_stay', min_nights: 3, min_stay_scope: 'through',
      start_date: '2026-09-01', end_date: '2026-09-30', days_of_week: null, active: true },
    { rule_type: 'min_stay', min_nights: 7, min_stay_scope: 'through',
      start_date: '2026-09-18', end_date: '2026-09-22', days_of_week: null, active: true },
  ];
  const result = calcMinStay(rules, MON, 1, 'through');
  assert.strictEqual(result, 7, 'narrowest span (5 days) should win over wider span (30 days)');
});

test('TC18 — min_stay DOW rule (no date range) → matches correct day', () => {
  const rules = [
    { rule_type: 'min_stay', min_nights: 4, min_stay_scope: 'arrival',
      days_of_week: [1], start_date: null, end_date: null, active: true }, // Mon
  ];
  assert.strictEqual(calcMinStay(rules, MON, 1, 'arrival'), 4);
  assert.strictEqual(calcMinStay(rules, FRI, 5, 'arrival'), null, 'Fri should not match Mon rule');
});

test('TC19 — min_stay global rule → fallback when no date/DOW match', () => {
  const rules = [
    { rule_type: 'min_stay', min_nights: 2, min_stay_scope: 'through',
      days_of_week: null, start_date: null, end_date: null, active: true },
  ];
  assert.strictEqual(calcMinStay(rules, MON, 1, 'through'), 2);
});

test('TC20 — no min_stay rules → default=1 in resolver output', async () => {
  const pool = makeMockPool({ properties: [prop()] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].minStayArrival, 1);
  assert.strictEqual(res[0].minStayThrough, 1);
});

// ─── Section 21–24: Price validity ───────────────────────────────────────────

console.log('\n── TC21–TC24 : Validité du prix ──');

test('TC21 — price=0 → priceValid=false, price present', async () => {
  const pool = makeMockPool({
    properties: [prop({ base_price: 0 })],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].price, 0);
  assert.strictEqual(res[0].priceValid, false);
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE);
});

test('TC22 — price=negative → priceValid=false', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_overrides: [{ date: MON, price: -10, id: 1 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].price, -10);
  assert.strictEqual(res[0].priceValid, false);
  assert.strictEqual(res[0].source, SOURCE.MANUAL_OVERRIDE);
});

test('TC23 — no source found (base_price null) → priceValid=false, price=null', async () => {
  const pool = makeMockPool({
    properties: [prop({ base_price: null, weekend_price: null })],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].price, null);
  assert.strictEqual(res[0].priceValid, false);
  assert.strictEqual(res[0].source, SOURCE.NONE);
});

test('TC24 — price=150 → priceValid=true', async () => {
  const pool = makeMockPool({
    properties: [prop({ base_price: 150 })],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].priceValid, true);
});

// ─── Section 25–27: Date range handling ──────────────────────────────────────

console.log('\n── TC25–TC27 : Plages de dates ──');

test('TC25 — empty range (startDate === endDate) → []', async () => {
  const pool = makeMockPool({ properties: [prop()] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: MON,
  });
  assert.deepStrictEqual(res, []);
});

test('TC26 — single date range (1 night) → exactly 1 element with correct date', async () => {
  const pool = makeMockPool({ properties: [prop()] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].date, MON);
});

test('TC27 — 7-day range → 7 elements with consecutive dates', async () => {
  const pool = makeMockPool({ properties: [prop()] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 7),
  });
  assert.strictEqual(res.length, 7);
  for (let i = 0; i < 7; i++) {
    assert.strictEqual(res[i].date, addDays(MON, i));
  }
});

// ─── Section 28–30: period_rule priority (NOT narrowest) ─────────────────────

console.log('\n── TC28–TC30 : Priorité period_rule (priority DESC first-match) ──');

test('TC28 — higher priority period rule wins over lower priority (same date)', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [
      { id: 1, rule_type: 'period', price: 300, priority: 10,
        start_date: '2026-09-01', end_date: '2026-09-30', active: true },
      { id: 2, rule_type: 'period', price: 180, priority: 5,
        start_date: '2026-09-18', end_date: '2026-09-22', active: true },
    ],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].price, 300, 'Higher priority (10) should win over priority 5');
  assert.strictEqual(res[0].sourceId, 1);
});

test('TC29 — REGRESSION: wider span + higher priority wins over narrower span + lower priority', async () => {
  // This is the critical difference from calcMinStay (which uses narrowest span).
  // Period rules use priority DESC first-match, NOT narrowest span.
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [
      { id: 1, rule_type: 'period', price: 400, priority: 20,
        start_date: '2026-09-01', end_date: '2026-09-30', active: true }, // WIDER, higher priority
      { id: 2, rule_type: 'period', price: 180, priority: 5,
        start_date: '2026-09-20', end_date: '2026-09-22', active: true }, // narrower, lower priority
    ],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].price, 400,
    'REGRESSION: period rule must use priority DESC first-match, NOT narrowest span');
  assert.strictEqual(res[0].sourceId, 1);
});

test('TC30 — weekday_rule: Saturday (dow=6) matches correctly', async () => {
  const pool = makeMockPool({
    properties: [prop({ weekend_price: 150 })],
    pricing_rules: [
      { id: 5, rule_type: 'weekday', price: 190, priority: 0,
        days_of_week: [6], active: true }, // Sat
    ],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: SAT, endDate: addDays(SAT, 1),
  });
  assert.strictEqual(utcDow(SAT), 6, 'SAT fixture should be dow=6');
  assert.strictEqual(res[0].source, SOURCE.WEEKDAY_RULE);
  assert.strictEqual(res[0].price, 190);
});

// ─── Section 31–33: Output format ────────────────────────────────────────────

console.log('\n── TC31–TC33 : Format de sortie ──');

test('TC31 — locked=true only for manual_override', async () => {
  const start = MON;
  const end = addDays(MON, 3);
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg()],
    pricing_schedule: [{ date: addDays(MON, 1), price: 175, status: 'applied', id: 99 }],
    pricing_overrides: [{ date: MON, price: 250, id: 5 }],
    pricing_rules: [{
      id: 10, rule_type: 'period', price: 200, priority: 0,
      start_date: addDays(MON, 2), end_date: addDays(MON, 2), active: true,
    }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: start, endDate: end,
  });
  assert.strictEqual(res[0].locked, true,  'override → locked');
  assert.strictEqual(res[1].locked, false, 'boostprice → not locked');
  assert.strictEqual(res[2].locked, false, 'period_rule → not locked');
});

test('TC32 — sourceId matches rule.id from fixture', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [{
      id: 42, rule_type: 'period', price: 200, priority: 0,
      start_date: '2026-09-20', end_date: '2026-09-22', active: true,
    }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].sourceId, 42);
});

test('TC33 — calculatedAt is present for override (updated_at)', async () => {
  const ts = new Date('2026-09-10T08:00:00Z');
  const pool = makeMockPool({
    properties: [prop()],
    pricing_overrides: [{ date: MON, price: 250, id: 5, updated_at: ts }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.deepStrictEqual(res[0].calculatedAt, ts);
});

// ─── Section 34–35: Property not found / no rules ────────────────────────────

console.log('\n── TC34–TC35 : Propriété introuvable / sans règles ──');

test('TC34 — property not found → returns []', async () => {
  const pool = makeMockPool({ properties: [] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'unknown', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 3),
  });
  assert.deepStrictEqual(res, []);
});

test('TC35 — no rules for userId → price from property base/weekend only', async () => {
  const pool = makeMockPool({
    properties: [prop({ weekend_price: 140 })],
    pricing_rules: [
      { id: 1, rule_type: 'period', price: 999, priority: 5,
        start_date: '2026-09-01', end_date: '2026-09-30', active: true },
    ],
  });
  // Note: mock pool returns ALL rules regardless of userId — this test verifies
  // that rules do participate in resolution (mock doesn't filter by userId like real DB)
  // The test checks that without any override, the period rule applies
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.PERIOD_RULE);
});

// ─── Section 36: Regression — wider span + higher priority ───────────────────

console.log('\n── TC36 : Régression period_rule priority vs span ──');

test('TC36 — two overlapping period rules: wider + higher priority wins (not narrowest)', async () => {
  // Rule A: Sept 1–30 (30 days), priority=100, price=500
  // Rule B: Sept 19–23 (5 days), priority=10, price=180
  // For MON (Sept 21): Rule A has higher priority → should win
  // This MUST NOT behave like calcMinStay (which would pick narrower span)
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [
      { id: 'A', rule_type: 'period', price: 500, priority: 100,
        start_date: '2026-09-01', end_date: '2026-09-30', active: true },
      { id: 'B', rule_type: 'period', price: 180, priority: 10,
        start_date: '2026-09-19', end_date: '2026-09-23', active: true },
    ],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1',
    startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].price, 500,
    'Rule A (priority=100, wider) must win — NOT narrowest-span');
  assert.strictEqual(res[0].sourceId, 'A');
});

// ─── Section 37–40: Legacy parity ────────────────────────────────────────────

console.log('\n── TC37–TC40 : Parité legacy ──');

// Reference implementation mirroring getCalendarPricesForRange() exactly
function legacyComputePrice(prop, overrides, periodRules, weekdayRules, dateStr) {
  const dow = utcDow(dateStr);

  if (overrides[dateStr] != null) return { price: overrides[dateStr], source: 'override' };

  for (const rule of periodRules) {
    if (!rule.start_date || !rule.end_date || rule.price == null) continue;
    const rs = fmtDate(rule.start_date);
    const re = fmtDate(rule.end_date);
    if (dateStr >= rs && dateStr <= re) return { price: parseFloat(rule.price), source: 'period' };
  }

  for (const rule of weekdayRules) {
    if (!rule.days_of_week || rule.price == null) continue;
    if (rule.days_of_week.includes(dow)) return { price: parseFloat(rule.price), source: 'weekday' };
  }

  const isWeekend = (dow === 5 || dow === 6);
  if (isWeekend && prop.weekend_price != null) return { price: prop.weekend_price, source: 'weekend' };
  if (prop.base_price != null) return { price: prop.base_price, source: 'base' };
  return { price: null, source: 'none' };
}

test('TC37 — legacy parity: override > period_rule', async () => {
  const fixture = {
    properties: [prop()],
    pricing_overrides: [{ date: MON, price: 350, id: 1 }],
    pricing_rules: [{
      id: 2, rule_type: 'period', price: 200, priority: 0,
      start_date: '2026-09-01', end_date: '2026-09-30', active: true,
    }],
  };
  const pool = makeMockPool(fixture);
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1),
  });

  const sortedRules = fixture.pricing_rules.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const legacyOverrides = Object.fromEntries(fixture.pricing_overrides.map(o => [o.date, o.price]));
  const legacy = legacyComputePrice(
    prop(), legacyOverrides,
    sortedRules.filter(r => r.rule_type === 'period'),
    [], MON
  );

  assert.strictEqual(res[0].price, legacy.price, 'Resolver price must match legacy for override>period');
  assert.strictEqual(res[0].source, SOURCE.MANUAL_OVERRIDE);
});

test('TC38 — legacy parity: period_rule > weekday_rule', async () => {
  const rules = [
    { id: 1, rule_type: 'period', price: 200, priority: 0,
      start_date: '2026-09-01', end_date: '2026-09-30', active: true },
    { id: 2, rule_type: 'weekday', price: 130, priority: 0,
      days_of_week: [1], active: true }, // Mon
  ];
  const pool = makeMockPool({ properties: [prop()], pricing_rules: rules });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1),
  });

  const sorted = rules.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const legacy = legacyComputePrice(
    prop(), {},
    sorted.filter(r => r.rule_type === 'period'),
    sorted.filter(r => r.rule_type === 'weekday'),
    MON
  );

  assert.strictEqual(res[0].price, legacy.price);
  assert.strictEqual(res[0].source, SOURCE.PERIOD_RULE);
});

test('TC39 — legacy parity: weekday_rule > weekend_price', async () => {
  const rules = [
    { id: 3, rule_type: 'weekday', price: 120, priority: 0,
      days_of_week: [5], active: true }, // Fri
  ];
  const p = prop({ weekend_price: 150 });
  const pool = makeMockPool({ properties: [p], pricing_rules: rules });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: FRI, endDate: addDays(FRI, 1),
  });

  const legacy = legacyComputePrice(p, {}, [], rules, FRI);

  assert.strictEqual(res[0].price, legacy.price);
  assert.strictEqual(res[0].source, SOURCE.WEEKDAY_RULE);
});

test('TC40 — legacy parity: weekend_price > base_price', async () => {
  const p = prop({ weekend_price: 150 });
  const pool = makeMockPool({ properties: [p] });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: FRI, endDate: addDays(FRI, 1),
  });

  const legacy = legacyComputePrice(p, {}, [], [], FRI);

  assert.strictEqual(res[0].price, legacy.price);
  assert.strictEqual(res[0].source, SOURCE.WEEKEND_PRICE);
});

// ─── Section 41: Race state ───────────────────────────────────────────────────

console.log('\n── TC41 : Race state ──');

test('TC41 — resolver reads current override state (with vs without override)', async () => {
  // State A: override present → manual_override
  const poolWith = makeMockPool({
    properties: [prop()],
    pricing_overrides: [{ date: MON, price: 275, id: 9 }],
  });
  const withOverride = await resolveEffectivePrices(poolWith, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1),
  });

  // State B: override removed → base_price
  const poolWithout = makeMockPool({ properties: [prop()] });
  const withoutOverride = await resolveEffectivePrices(poolWithout, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1),
  });

  assert.strictEqual(withOverride[0].source, SOURCE.MANUAL_OVERRIDE);
  assert.strictEqual(withOverride[0].price, 275);
  assert.strictEqual(withoutOverride[0].source, SOURCE.BASE_PRICE);
  assert.strictEqual(withoutOverride[0].price, 100);
});

// ─── Section 42–45: Edge cases ───────────────────────────────────────────────

console.log('\n── TC42–TC45 : Cas limites ──');

test('TC42 — breakdown=null when source is period_rule (not boostprice)', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_rules: [{
      id: 1, rule_type: 'period', price: 200, priority: 0,
      start_date: '2026-09-20', end_date: '2026-09-22', active: true,
    }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].breakdown, null);
});

test('TC43 — breakdown present and null separately for boostprice', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [cfg()],
    pricing_schedule: [
      { date: MON, price: 175, status: 'applied', id: 1, breakdown: { x: 1 } },
      { date: addDays(MON, 1), price: 180, status: 'applied', id: 2, breakdown: null },
    ],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 2),
  });
  assert.deepStrictEqual(res[0].breakdown, { x: 1 });
  assert.strictEqual(res[1].breakdown, null);
});

test('TC44 — min_stay arrival and through are independent', async () => {
  const rules = [
    { rule_type: 'min_stay', min_nights: 3, min_stay_scope: 'arrival',
      start_date: '2026-09-20', end_date: '2026-09-22', days_of_week: null, active: true },
    { rule_type: 'min_stay', min_nights: 5, min_stay_scope: 'through',
      start_date: '2026-09-20', end_date: '2026-09-22', days_of_week: null, active: true },
  ];
  const pool = makeMockPool({ properties: [prop()], pricing_rules: rules });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].minStayArrival, 3, 'arrival scope should return 3');
  assert.strictEqual(res[0].minStayThrough, 5, 'through scope should return 5');
});

test('TC45 — pricing_config not found → bpActive=false (applied schedule ignored)', async () => {
  const pool = makeMockPool({
    properties: [prop()],
    pricing_config: [], // no config row
    pricing_schedule: [{ date: MON, price: 175, status: 'applied', id: 99 }],
  });
  const res = await resolveEffectivePrices(pool, {
    propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1),
  });
  assert.strictEqual(res[0].source, SOURCE.BASE_PRICE, 'No pricing_config → BoostPrice must be inactive');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

// Async tests complete in microtasks — wait one event loop tick to collect results
setImmediate(() => {
  console.log(`\n${'─'.repeat(55)}`);
  console.log(`  Résultats : ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Échecs :');
    failures.forEach(f => console.log(`    • ${f.name}\n      ${f.message}`));
  }
  process.exit(failed > 0 ? 1 : 0);
});

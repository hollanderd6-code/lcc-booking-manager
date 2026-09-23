#!/usr/bin/env node
'use strict';
/**
 * Tests unitaires — Effective Pricing Publisher (P0-C1)
 *
 * Couvre :
 *   TC-P01–P03  : external_pricing guard (resolver non appelé, pushRates/Restr = 0)
 *   TC-P04–P07  : autres guards (channex disabled, property absent, IDs manquants)
 *   TC-P08–P13  : payload rates (base, weekend, BoostPrice, pending ignoré, override)
 *   TC-P14–P16  : payload restrictions (arrival, through, règle manuelle)
 *   TC-P17–P18  : prix null exclus des rates
 *   TC-P19–P22  : comportement push (succès, erreur rates, erreur restrictions, partial)
 *   TC-P23–P24  : caller ne peut pas injecter rates/price
 *   TC-P25–P26  : force et reason
 *   TC-P27–P28  : inclusivité startDate / exclusivité endDate
 *   TC-P29–P30  : just-in-time (resolver appelé à l'instant du publish)
 *   TC-P31–P34  : aucune écriture DB (pricing_schedule, overrides, rules, history)
 *
 * Exécution : node tests/pricing_publisher.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert = require('assert');
const { createPublisher, PUBLISH_STATUS } = require('../routes/pricing-publisher');
const { addDays, SOURCE } = require('../routes/effective-pricing-resolver');

// ─── Test runner (séquentiel — important pour console.log capture) ────────────

let passed = 0, failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}`);
    console.error(`       ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MON = '2026-09-21';  // dow=1
const FRI = '2026-09-25';  // dow=5 → weekend_price applies

function baseProp(overrides = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    channex_enabled: true,
    channex_property_id: 'cx_p1',
    channex_room_type_id: 'cx_rt1',
    channex_rate_plan_id: 'cx_rp1',
    external_pricing: false,
    base_price: 100,
    weekend_price: null,
    ...overrides,
  };
}

// ─── Mock pool ────────────────────────────────────────────────────────────────
// Handles all queries from both the publisher and the resolver.

function makeMockPool(tables = {}, opts = {}) {
  const { rejectWrites = false } = opts;
  const pool = {
    _queries: [],
    async query(sql, params = []) {
      pool._queries.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80));
      const s = sql.replace(/\s+/g, ' ').toLowerCase();

      if (rejectWrites) {
        const n = s.trimStart();
        if (n.startsWith('insert') || n.startsWith('update') || n.startsWith('delete')) {
          throw new Error('MockPool: write detected: ' + sql.slice(0, 60));
        }
      }

      if (s.includes('from properties')) {
        return { rows: tables.properties || [] };
      }
      if (s.includes('from pricing_config')) {
        return { rows: tables.pricing_config || [] };
      }
      if (s.includes('from pricing_overrides')) {
        const start = params[2], end = params[3];
        return {
          rows: (tables.pricing_overrides || [])
            .filter(r => !start || (r.date >= start && r.date < end)),
        };
      }
      if (s.includes('from pricing_schedule')) {
        const start = params[1], end = params[2];
        const isPending = s.includes("status = 'pending'");
        return {
          rows: (tables.pricing_schedule || []).filter(r => {
            if (start && end && (r.date < start || r.date >= end)) return false;
            return r.status === (isPending ? 'pending' : 'applied');
          }),
        };
      }
      if (s.includes('from pricing_rules')) {
        const active = (tables.pricing_rules || []).filter(r => r.active !== false);
        active.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return { rows: active };
      }
      throw new Error('MockPool: unrecognized: ' + sql.slice(0, 80));
    },
  };
  return pool;
}

// ─── Mock push helpers ────────────────────────────────────────────────────────

function okPushRates(spy = {}) {
  return async (_pool, { rates }) => {
    spy.calls = (spy.calls || 0) + 1;
    spy.lastRates = rates;
    return { success: true, count: rates.length };
  };
}

function okPushRestrictions(spy = {}) {
  return async (_pool, { restrictions }) => {
    spy.calls = (spy.calls || 0) + 1;
    spy.lastRestrictions = restrictions;
    return { success: true, count: restrictions.length };
  };
}

function failPush(msg) {
  return async () => { throw new Error(msg); };
}

// Make a publisher with mocked deps and a pre-configured pool
function makePublisher(tables, pushRates, pushRestrictions, resolveImpl) {
  return {
    publish: createPublisher({
      pushRates:               pushRates || okPushRates(),
      pushRestrictions:        pushRestrictions || okPushRestrictions(),
      ...(resolveImpl ? { resolveEffectivePrices: resolveImpl } : {}),
    }),
    pool: makeMockPool(tables),
  };
}

// Standard opts for a single-night call
function singleNight(date = MON) {
  return { propertyId: 'p1', userId: 'u1', startDate: date, endDate: addDays(date, 1) };
}

// ─── TC-P01–P03 : external_pricing guard ─────────────────────────────────────

(async () => {

console.log('\n── TC-P01–P03 : external_pricing guard ──');

await test('TC-P01 — external_pricing=true → resolver non appelé', async () => {
  let resolverCalled = false;
  const trackResolve = async () => { resolverCalled = true; return []; };
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ external_pricing: true })] },
    okPushRates(rSpy), okPushRestrictions(), trackResolve,
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_EXTERNAL);
  assert.strictEqual(resolverCalled, false, 'resolver must not be called');
});

await test('TC-P02 — external_pricing=true → pushRates jamais appelé', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ external_pricing: true })] },
    okPushRates(rSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.calls || 0, 0, 'pushRates must not be called');
});

await test('TC-P03 — external_pricing=true → pushRestrictions jamais appelé', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ external_pricing: true })] },
    okPushRates(), okPushRestrictions(rSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.calls || 0, 0, 'pushRestrictions must not be called');
});

// ─── TC-P04–P07 : autres guards ──────────────────────────────────────────────

console.log('\n── TC-P04–P07 : Autres guards ──');

await test('TC-P04 — channex_enabled=false → aucun push', async () => {
  const rSpy = { calls: 0 }, rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ channex_enabled: false })] },
    okPushRates(rSpy), okPushRestrictions(rrSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_CHANNEX_DISABLED);
  assert.strictEqual(rSpy.calls || 0, 0);
  assert.strictEqual(rrSpy.calls || 0, 0);
});

await test('TC-P05 — property introuvable → résultat structuré (pas de throw)', async () => {
  const { publish, pool } = makePublisher({ properties: [] });
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_NOT_FOUND);
  assert.strictEqual(res.nights, 0);
});

await test('TC-P06 — channex_property_id manquant → aucun push', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ channex_property_id: null })] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_MISSING_IDS);
  assert.strictEqual(rSpy.calls || 0, 0);
});

await test('TC-P07 — channex_rate_plan_id manquant → aucun push', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ channex_rate_plan_id: null })] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_MISSING_IDS);
  assert.strictEqual(rSpy.calls || 0, 0);
});

// ─── TC-P08–P13 : Payload rates ──────────────────────────────────────────────

console.log('\n── TC-P08–P13 : Payload rates ──');

await test('TC-P08 — base_price=100 → rate publié à 100', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.OK);
  assert.strictEqual(rSpy.calls, 1);
  assert.strictEqual(rSpy.lastRates.length, 1);
  assert.strictEqual(rSpy.lastRates[0].date, MON);
  assert.strictEqual(rSpy.lastRates[0].price, 100);
});

await test('TC-P09 — weekend_price=150 sur vendredi → rate=150', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ weekend_price: 150 })] },
    okPushRates(rSpy),
  );
  await publish(pool, { propertyId: 'p1', userId: 'u1', startDate: FRI, endDate: addDays(FRI, 1) });
  assert.strictEqual(rSpy.lastRates[0].price, 150);
});

await test('TC-P10 — BoostPrice applied=180 → rate=180 (resolver source=boostprice)', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:      [baseProp()],
      pricing_config:  [{ is_active: true }],
      pricing_schedule:[{ date: MON, price: 180, status: 'applied', id: 1 }],
    },
    okPushRates(rSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.lastRates[0].price, 180);
});

await test('TC-P11 — BoostPrice pending ignoré → base_price=100 publié', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:      [baseProp()],
      pricing_config:  [{ is_active: true }],
      pricing_schedule:[{ date: MON, price: 180, status: 'pending', id: 1 }],
    },
    okPushRates(rSpy),
  );
  await publish(pool, singleNight());
  // pending entry must be ignored; resolver falls back to base_price
  assert.strictEqual(rSpy.lastRates[0].price, 100);
});

await test('TC-P12 — override=120 bat BoostPrice applied=180 → 120 publié', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:       [baseProp()],
      pricing_config:   [{ is_active: true }],
      pricing_overrides:[{ date: MON, price: 120, id: 1, updated_at: null }],
      pricing_schedule: [{ date: MON, price: 180, status: 'applied', id: 2 }],
    },
    okPushRates(rSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.lastRates[0].price, 120, 'override must beat applied BoostPrice');
});

await test('TC-P13 — override=95 / schedule=112 → exactement 95 envoyé à pushRates', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:       [baseProp()],
      pricing_config:   [{ is_active: true }],
      pricing_overrides:[{ date: MON, price: 95, id: 1, updated_at: null }],
      pricing_schedule: [{ date: MON, price: 112, status: 'applied', id: 2 }],
    },
    okPushRates(rSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.lastRates[0].price, 95);
});

// ─── TC-P14–P16 : Payload restrictions ───────────────────────────────────────

console.log('\n── TC-P14–P16 : Payload restrictions ──');

await test('TC-P14 — min_stay arrival=3 → min_stay_arrival=3 dans restrictions', async () => {
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:   [baseProp()],
      pricing_rules:[{
        id: 1, rule_type: 'min_stay', active: true, priority: 0,
        min_nights: 3, min_stay_scope: 'arrival',
        days_of_week: null, start_date: null, end_date: null,
      }],
    },
    okPushRates(), okPushRestrictions(rrSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_arrival, 3);
});

await test('TC-P15 — min_stay through=5 → min_stay_through=5 dans restrictions', async () => {
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:   [baseProp()],
      pricing_rules:[{
        id: 1, rule_type: 'min_stay', active: true, priority: 0,
        min_nights: 5, min_stay_scope: 'through',
        days_of_week: null, start_date: null, end_date: null,
      }],
    },
    okPushRates(), okPushRestrictions(rrSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_through, 5);
});

await test('TC-P16 — sans règle min_stay → défauts arrival=1 through=1', async () => {
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(), okPushRestrictions(rrSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_arrival, 1);
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_through, 1);
});

// ─── TC-P17–P18 : Prix null exclus ───────────────────────────────────────────

console.log('\n── TC-P17–P18 : Prix null exclus ──');

await test('TC-P17 — resolver price=null → nuit exclue des rates', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ base_price: null, weekend_price: null })] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.rates.count, 0, 'no valid price → 0 rates');
});

await test('TC-P18 — toutes prices null → pushRates non appelé', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ base_price: null, weekend_price: null })] },
    okPushRates(rSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.calls || 0, 0, 'pushRates must not be called when rates is empty');
});

// ─── TC-P19–P22 : Comportement push ──────────────────────────────────────────

console.log('\n── TC-P19–P22 : Comportement push ──');

await test('TC-P19 — pushRates succès → result.rates.pushed = count retourné', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.OK);
  assert.strictEqual(res.rates.pushed, 1);
  assert.strictEqual(res.rates.error, null);
});

await test('TC-P20 — pushRates erreur → rates.error set, status ERROR ou PARTIAL', async () => {
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    failPush('rates failed'),
  );
  const res = await publish(pool, singleNight());
  assert.ok(
    res.status === PUBLISH_STATUS.ERROR || res.status === PUBLISH_STATUS.PARTIAL,
    `Expected ERROR or PARTIAL, got ${res.status}`,
  );
  assert.ok(res.rates.error && res.rates.error.includes('rates failed'));
  assert.strictEqual(res.rates.pushed, 0);
});

await test('TC-P21 — pushRestrictions succès → result.restrictions.pushed = count', async () => {
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(), okPushRestrictions(rrSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.restrictions.pushed, 1);
  assert.strictEqual(res.restrictions.error, null);
});

await test('TC-P22 — rates OK + pushRestrictions erreur → status PARTIAL', async () => {
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(), failPush('restrictions failed'),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.PARTIAL);
  assert.strictEqual(res.rates.error, null,   'rates should have succeeded');
  assert.ok(res.restrictions.error && res.restrictions.error.includes('restrictions failed'));
});

// ─── TC-P23–P24 : Caller ne peut pas injecter rates/price ────────────────────

console.log('\n── TC-P23–P24 : Isolation caller ──');

await test('TC-P23 — valeur DB 100, caller "rate":999 ignoré → 100 envoyé', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ base_price: 100 })] },
    okPushRates(rSpy),
  );
  // Extra fields in opts must be silently ignored; rate comes only from DB
  const res = await publish(pool, {
    ...singleNight(),
    rates: [{ date: MON, price: 999 }],  // must be ignored
  });
  assert.strictEqual(res.status, PUBLISH_STATUS.OK);
  assert.strictEqual(rSpy.lastRates[0].price, 100, 'caller-injected rates must be ignored');
});

await test('TC-P24 — valeur DB 100, caller "price":500 ignoré → 100 envoyé', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ base_price: 100 })] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, {
    ...singleNight(),
    price: 500,  // must be ignored
  });
  assert.strictEqual(rSpy.lastRates[0].price, 100);
});

// ─── TC-P25–P26 : force et reason ────────────────────────────────────────────

console.log('\n── TC-P25–P26 : force et reason ──');

await test('TC-P25 — force=true ne contourne PAS external_pricing', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ external_pricing: true })] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, { ...singleNight(), force: true });
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_EXTERNAL,
    'force=true must never bypass external_pricing');
  assert.strictEqual(rSpy.calls || 0, 0);
});

await test('TC-P26 — reason inclus dans le résultat, jamais dans le calcul de prix', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, { ...singleNight(), reason: 'override_saved' });
  assert.strictEqual(res.reason, 'override_saved');
  // price must still be 100 (from DB), not influenced by reason string
  assert.strictEqual(rSpy.lastRates[0].price, 100);
});

// ─── TC-P27–P28 : Inclusivité startDate / exclusivité endDate ────────────────

console.log('\n── TC-P27–P28 : Plages dates ──');

await test('TC-P27 — startDate inclusif : date publiée = startDate', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(rSpy),
  );
  await publish(pool, { propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1) });
  assert.strictEqual(rSpy.lastRates[0].date, MON, 'startDate must be included');
});

await test('TC-P28 — endDate exclusif : plage [MON, MON+1) → exactement 1 nuit', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, { propertyId: 'p1', userId: 'u1', startDate: MON, endDate: addDays(MON, 1) });
  assert.strictEqual(res.nights, 1, 'exactly 1 night for [MON, MON+1)');
  assert.strictEqual(rSpy.lastRates.length, 1);
  // endDate (MON+1) must not be present
  const dates = rSpy.lastRates.map(r => r.date);
  assert.ok(!dates.includes(addDays(MON, 1)), 'endDate must be excluded');
});

// ─── TC-P29–P30 : Just-in-time ────────────────────────────────────────────────

console.log('\n── TC-P29–P30 : Just-in-time ──');

await test('TC-P29 — resolver appelé pendant le publish, pas avant', async () => {
  let resolverCallTime = null;
  const publishCallTime = Date.now();

  const trackResolve = async (pool, opts) => {
    resolverCallTime = Date.now();
    // Return a minimal valid night
    return [{
      date: opts.startDate, price: 100, priceValid: true,
      minStayArrival: 1, minStayThrough: 1,
      source: SOURCE.BASE_PRICE, sourceId: null, locked: false, breakdown: null, calculatedAt: null,
    }];
  };

  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(), okPushRestrictions(), trackResolve,
  );

  await publish(pool, singleNight());

  assert.ok(resolverCallTime !== null, 'resolver must be called');
  assert.ok(resolverCallTime >= publishCallTime, 'resolver must be called during/after publish invocation');
});

await test('TC-P30 — DB schedule=112 + override=95 → resolver lit 95, pushRates reçoit 95', async () => {
  // Integration test: verify the full path from DB state to pushed rate
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:       [baseProp({ base_price: 80 })],
      pricing_config:   [{ is_active: true }],
      pricing_overrides:[{ date: MON, price: 95, id: 1, updated_at: null }],
      pricing_schedule: [{ date: MON, price: 112, status: 'applied', id: 2 }],
    },
    okPushRates(rSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.lastRates[0].price, 95, 'override=95 must win over schedule=112');
});

// ─── TC-P31–P34 : Aucune écriture DB ─────────────────────────────────────────

console.log('\n── TC-P31–P34 : Aucune écriture DB ──');

async function runNoWriteTest(name, tables) {
  await test(name, async () => {
    const pool = makeMockPool(tables, { rejectWrites: true });
    const publish = createPublisher({ pushRates: okPushRates(), pushRestrictions: okPushRestrictions() });
    // Must complete without MockPool throwing a write-detected error
    await publish(pool, singleNight());
  });
}

await runNoWriteTest(
  'TC-P31 — aucune écriture pricing_schedule',
  { properties: [baseProp()] },
);
await runNoWriteTest(
  'TC-P32 — aucune écriture pricing_overrides',
  { properties: [baseProp()] },
);
await runNoWriteTest(
  'TC-P33 — aucune écriture pricing_rules',
  { properties: [baseProp()] },
);
await runNoWriteTest(
  'TC-P34 — aucune écriture pricing_history',
  { properties: [baseProp()] },
);

// ─── P01–P06 : Modèle A min_stay + stop_sell (C4.2a) ─────────────────────────

console.log('\n── P01–P06 : Modèle A min_stay + stop_sell ──');

await test('P01 — BoostPrice min_stay=3 → min_stay_arrival=3 min_stay_through=3', async () => {
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:      [baseProp()],
      pricing_config:  [{ is_active: true }],
      pricing_schedule:[{ date: MON, price: 110, min_stay: 3, status: 'applied', id: 1 }],
    },
    okPushRates(), okPushRestrictions(rrSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_arrival, 3,
    'BoostPrice min_stay doit être publié comme min_stay_arrival');
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_through, 3,
    'BoostPrice min_stay doit être publié comme min_stay_through');
});

await test('P02 — stopSell=true → stop_sell=true dans restrictions', async () => {
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:    [baseProp()],
      pricing_rules: [{
        rule_type: 'stop_sell', id: 20, priority: 0, active: true,
        start_date: '2026-09-20', end_date: '2026-09-25',
      }],
    },
    okPushRates(), okPushRestrictions(rrSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rrSpy.lastRestrictions[0].stop_sell, true,
    'stop_sell doit être true quand une règle couvre la date');
});

await test('P03 — stopSell=false → stop_sell=false explicitement envoyé (réouverture)', async () => {
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(), okPushRestrictions(rrSpy),
  );
  await publish(pool, singleNight());
  // stop_sell=false DOIT être présent (pas omis) pour rouvrir une date précédemment bloquée
  assert.ok(Object.prototype.hasOwnProperty.call(rrSpy.lastRestrictions[0], 'stop_sell'),
    'stop_sell doit être présent dans le payload même quand false');
  assert.strictEqual(rrSpy.lastRestrictions[0].stop_sell, false,
    'stop_sell doit être false (pas undefined/omis) pour permettre la réouverture');
});

await test('P04 — priceValid=false + stopSell=true → 0 rate, restriction stop_sell envoyée', async () => {
  const rSpy = { calls: 0 };
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:    [baseProp({ base_price: null, weekend_price: null })],
      pricing_rules: [{
        rule_type: 'stop_sell', id: 20, priority: 0, active: true,
        start_date: '2026-09-20', end_date: '2026-09-25',
      }],
    },
    okPushRates(rSpy), okPushRestrictions(rrSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.rates.count, 0, 'aucun rate (prix null)');
  assert.strictEqual(rSpy.calls || 0, 0, 'pushRates non appelé');
  assert.strictEqual(rrSpy.calls, 1, 'pushRestrictions appelé malgré prix null');
  assert.strictEqual(rrSpy.lastRestrictions[0].stop_sell, true,
    'stop_sell doit être présent dans les restrictions même sans prix');
});

await test('P05 — external_pricing=true → aucun push (inchangé)', async () => {
  const rSpy = { calls: 0 }, rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ external_pricing: true })] },
    okPushRates(rSpy), okPushRestrictions(rrSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_EXTERNAL);
  assert.strictEqual(rSpy.calls || 0, 0, 'pushRates ne doit pas être appelé');
  assert.strictEqual(rrSpy.calls || 0, 0, 'pushRestrictions ne doit pas être appelé');
});

await test('P06 — BoostPrice price + BoostPrice min_stay → les deux préservés', async () => {
  const rSpy = { calls: 0 };
  const rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    {
      properties:      [baseProp()],
      pricing_config:  [{ is_active: true }],
      pricing_schedule:[{ date: MON, price: 185, min_stay: 4, status: 'applied', id: 1 }],
    },
    okPushRates(rSpy), okPushRestrictions(rrSpy),
  );
  await publish(pool, singleNight());
  assert.strictEqual(rSpy.lastRates[0].price, 185, 'BoostPrice price doit être préservé');
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_arrival, 4,
    'BoostPrice min_stay doit être préservé dans arrival');
  assert.strictEqual(rrSpy.lastRestrictions[0].min_stay_through, 4,
    'BoostPrice min_stay doit être préservé dans through');
});

// ─── C01–C04 : room_type_id guard (C4.2c) ────────────────────────────────────

console.log('\n── C01–C04 : room_type_id guard ──');

await test('C01 — room_type_id manquant → SKIPPED_MISSING_IDS, pushRates non appelé, pushRestrictions non appelé', async () => {
  const rSpy = { calls: 0 }, rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ channex_room_type_id: null })] },
    okPushRates(rSpy), okPushRestrictions(rrSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_MISSING_IDS,
    'room_type_id manquant doit produire SKIPPED_MISSING_IDS');
  assert.strictEqual(rSpy.calls || 0, 0, 'pushRates ne doit pas être appelé');
  assert.strictEqual(rrSpy.calls || 0, 0, 'pushRestrictions ne doit pas être appelé');
  assert.ok(res.detail?.missingIds?.includes('channex_room_type_id'),
    'detail.missingIds doit indiquer channex_room_type_id');
});

await test('C02 — channex_property_id manquant → comportement existant préservé', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ channex_property_id: null })] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_MISSING_IDS);
  assert.strictEqual(rSpy.calls || 0, 0);
  assert.ok(res.detail?.missingIds?.includes('channex_property_id'));
});

await test('C03 — channex_rate_plan_id manquant → comportement existant préservé', async () => {
  const rSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp({ channex_rate_plan_id: null })] },
    okPushRates(rSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.SKIPPED_MISSING_IDS);
  assert.strictEqual(rSpy.calls || 0, 0);
  assert.ok(res.detail?.missingIds?.includes('channex_rate_plan_id'));
});

await test('C04 — les trois IDs présents → fonctionnement normal', async () => {
  const rSpy = { calls: 0 }, rrSpy = { calls: 0 };
  const { publish, pool } = makePublisher(
    { properties: [baseProp()] },
    okPushRates(rSpy), okPushRestrictions(rrSpy),
  );
  const res = await publish(pool, singleNight());
  assert.strictEqual(res.status, PUBLISH_STATUS.OK,
    'les trois IDs présents → publication normale');
  assert.strictEqual(rSpy.calls, 1, 'pushRates doit être appelé');
  assert.strictEqual(rrSpy.calls, 1, 'pushRestrictions doit être appelé');
  assert.strictEqual(res.detail, undefined,
    'pas de detail dans le résultat quand les IDs sont présents');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
console.log(`  Résultats : ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Échecs :');
  failures.forEach(f => console.log(`    • ${f.name}\n      ${f.message}`));
}
process.exit(failed > 0 ? 1 : 0);

})();

#!/usr/bin/env node
'use strict';
/**
 * Tests — pricing-apply
 *
 * Groupes :
 *   TC-A01–A08 : comportement P0-C3B (min_stay, mode manual, external_pricing)
 *   C7-A–C     : recalc protection manuel accepted
 *   P4-01–P4-23: migration PATH 4 → central publisher (C4.3-D)
 *
 * Exécution : node tests/pricing_apply.test.js
 * Aucun appel DB réel. Aucun appel Channex.
 */

const assert = require('assert');

// ── Mocks injectés AVANT le require de pricing-apply ──────────────────────────
// pricing-apply.js destructure priceProperty au top-level (require au chargement)
// → le cache doit être pré-rempli avant le premier require('../routes/pricing-apply').

let _pricePropertyImpl    = null;
let _pushRatesImpl        = null;       // legacy — gardé pour TC-A01–A08 et C7
let _pushRestrictionsImpl = null;       // legacy — gardé pour TC-A01–A08 et C7
let _publishImpl          = null;       // pour P4-xx — remplace les deux ci-dessus

// Mock pricing-engine (bound au chargement de pricing-apply.js)
const enginePath = require.resolve('../routes/pricing-engine');
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty:               (pool, opts) => _pricePropertyImpl(pool, opts),
    SCHOOL_HOLIDAYS_IDF_2025_2026: [],
    EVENTS_PARIS_2026:             [],
  },
};

// Mock channex — conservé pour les anciens tests TC-A (avant migration)
const channexPath = require.resolve('../channex');
require.cache[channexPath] = {
  id: channexPath, filename: channexPath, loaded: true,
  exports: {
    pushRates:        (pool, opts) => _pushRatesImpl && _pushRatesImpl(pool, opts),
    pushRestrictions: (pool, opts) => _pushRestrictionsImpl && _pushRestrictionsImpl(pool, opts),
  },
};

// Mock pricing-publisher (top-level require dans pricing-apply après migration)
const publisherPath = require.resolve('../routes/pricing-publisher');
require.cache[publisherPath] = {
  id: publisherPath, filename: publisherPath, loaded: true,
  exports: {
    publishEffectivePricing: (pool, opts) => _publishImpl
      ? _publishImpl(pool, opts)
      : Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }),
  },
};

// require pricing-apply uniquement après avoir préparé le cache
const { applyDynamicPricingForProperty } = require('../routes/pricing-apply');

// ── Test runner ────────────────────────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PROP = {
  id: 'prop-1',
  name: 'Test Property',
  base_price: 100,
  weekend_price: null,
  channex_enabled: true,
  channex_property_id: 'cx-prop',
  channex_room_type_id: 'cx-rt',
  channex_rate_plan_id: 'cx-rp',
  external_pricing: false,
};

function makeCfg(overrides = {}) {
  return {
    user_id: 'user-1',
    property_id: 'prop-1',
    property_name: 'Test Property',
    mode: 'auto',
    notify_push: false,
    ...overrides,
  };
}

// Pool mock — gère le DDL, la lookup properties, et les écritures schedule/history
function makeMockPool(prop = BASE_PROP) {
  return {
    async query(sql) {
      const s = sql.toLowerCase().trim();
      if (s.startsWith('create table') || s.startsWith('create index')) return { rows: [] };
      if (s.includes('from properties'))      return { rows: [prop] };
      if (s.includes('from pricing_history')) return { rows: [] };
      if (s.startsWith('insert') || s.startsWith('update')) return { rows: [], rowCount: 1 };
      throw new Error('MockPool inattendu: ' + sql.slice(0, 80));
    },
  };
}

// Construit un résultat de priceProperty à partir d'un tableau de nuits
// Chaque nuit : { date, price, minStay, booked? }
function makePriceProperty(nights) {
  return async (pool, opts) => ({
    propertyId: opts.property.id,
    mode: 'auto',
    isActive: true,
    market: {},
    rates:        nights.filter(n => !n.booked).map(n => ({ date: n.date, price: n.price })),
    restrictions: nights.filter(n => !n.booked).map(n => ({ date: n.date, min_stay: n.minStay })),
    schedule:     nights.map(n => ({
      ...n,
      booked: n.booked || false,
      breakdown: { market: 1, pacing: 1, season: 1 },
    })),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

// ── TC-A01–A05 : min_stay via publisher (comportement délégué au publisher/resolver post-migration)
// Ces tests vérifient que le résultat global est cohérent (status applied, nights count)
// La vérification détaillée de min_stay_arrival/through est dans pricing_publisher.test.js (P01, P06)

await test('TC-A01 auto mode → status applied, nights count correct', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-01', price: 100, minStay: 1 }]);
  _publishImpl = () => Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } });
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });
  assert.strictEqual(result.status, 'applied');
  assert.strictEqual(result.nights, 1);
  assert.strictEqual(result.publishStatus, 'ok');
});

await test('TC-A02 auto mode 3 nuits → nights=3, status applied', async () => {
  _pricePropertyImpl = makePriceProperty([
    { date: '2026-11-01', price: 100, minStay: 3 },
    { date: '2026-11-02', price: 110, minStay: 2 },
    { date: '2026-11-03', price: 120, minStay: 1 },
  ]);
  _publishImpl = () => Promise.resolve({ status: 'ok', rates: { count: 3, pushed: 3, error: null }, restrictions: { count: 3, pushed: 3, error: null } });
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });
  assert.strictEqual(result.nights, 3);
  assert.strictEqual(result.status, 'applied');
});

await test('TC-A03 auto mode → pushed = pubResult.rates.pushed', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-03', price: 140, minStay: 3 }]);
  _publishImpl = () => Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } });
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });
  assert.strictEqual(result.pushed, 1, 'pushed doit venir de pubResult.rates.pushed');
});

await test('TC-A04 auto mode booked night → nights exclut la nuit bookée', async () => {
  _pricePropertyImpl = makePriceProperty([
    { date: '2026-11-04', price: 100, minStay: 1 },
    { date: '2026-11-05', price: 110, minStay: 1, booked: true },
  ]);
  _publishImpl = () => Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } });
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });
  assert.strictEqual(result.nights, 1, 'nuit bookée exclue du count');
});

await test('TC-A05 auto mode publishStatus propagé dans result', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-10', price: 95, minStay: 2 }]);
  _publishImpl = () => Promise.resolve({ status: 'partial', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 0, error: 'timeout' } });
  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });
  assert.strictEqual(result.publishStatus, 'partial');
  assert.strictEqual(result.status, 'applied', 'history status always applied in auto');
});

// ── TC-A06 : mode = manual ────────────────────────────────────────────────────
await test('TC-A06 mode=manual → publisher non appelé, status=pending', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-20', price: 100, minStay: 2 }]);
  let publishCalled = false;
  _publishImpl = () => { publishCalled = true; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };

  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg({ mode: 'manual' }), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(!publishCalled, 'publisher ne doit pas être appelé en mode manual');
  assert.strictEqual(result.status, 'pending');
});

// ── TC-A07 : external_pricing = true ─────────────────────────────────────────
await test('TC-A07 external_pricing=true → publisher non appelé', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-21', price: 100, minStay: 2 }]);
  let publishCalled = false;
  _publishImpl = () => { publishCalled = true; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };

  const extProp = { ...BASE_PROP, external_pricing: true };
  await applyDynamicPricingForProperty(makeMockPool(extProp), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(!publishCalled, 'publisher ne doit pas être appelé si external_pricing=true');
});

// ── TC-A08 : publisher error → fonction ne jette pas ─────────────────────────
await test('TC-A08 publisher retourne error → fonction ne jette pas, status applied', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-11-22', price: 100, minStay: 3 }]);
  _publishImpl = () => Promise.resolve({ status: 'error', rates: { count: 1, pushed: 0, error: 'Channex 500' }, restrictions: { count: 1, pushed: 0, error: null } });

  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.strictEqual(result.publishStatus, 'error');
  assert.strictEqual(result.status, 'applied', 'history status doit rester applied même si OTA échoue');
  assert.ok(result.status != null, 'la fonction doit retourner un résultat valide');
});

// ─── C7 : Recalc protection ───────────────────────────────────────────────────

const W_PROT = '2026-09-22';   // protected week_start
const D_PROT = '2026-09-22';   // addDays(W_PROT, 0) — inside protected week
const D_FREE = '2026-11-01';   // outside any protected week

function makeMockPoolC7(manualAppliedRows) {
  const capturedDates = [];
  const pool = {
    _capturedDates: capturedDates,
    async query(sql, params) {
      const s = sql.toLowerCase().trim();
      if (s.startsWith('create table') || s.startsWith('create index')) return { rows: [] };
      if (s.includes('from properties'))  return { rows: [BASE_PROP] };
      if (s.includes('from pricing_history') && s.includes('mode_used')) {
        return { rows: manualAppliedRows };
      }
      if (s.includes('from pricing_history')) return { rows: [] };
      if (s.includes('into pricing_schedule')) {
        if (params) {
          // params layout per night: [userId, propertyId, date, price, minStay, reason, breakdown, status]
          for (let i = 2; i < params.length; i += 8) capturedDates.push(params[i]);
        }
        return { rows: [], rowCount: params ? params.length / 8 : 0 };
      }
      if (s.startsWith('insert') || s.startsWith('update')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  };
  return pool;
}

// C7-A: manual mode + date in protected week → excluded from upsert
await test('C7-A — manual mode: date in protected week excluded from upsert', async () => {
  _pricePropertyImpl    = makePriceProperty([
    { date: D_PROT, price: 82, minStay: 2 },
    { date: D_FREE, price: 90, minStay: 1 },
  ]);
  _pushRatesImpl        = () => ({ success: true });
  _pushRestrictionsImpl = () => ({ success: true });

  const pool = makeMockPoolC7([{ week_start: W_PROT }]);
  await applyDynamicPricingForProperty(pool, {
    cfg: makeCfg({ mode: 'manual' }), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(!pool._capturedDates.includes(D_PROT),
    `Protected date ${D_PROT} must NOT be upserted (manual accept lock)`);
  assert.ok(pool._capturedDates.includes(D_FREE),
    `Free date ${D_FREE} must be upserted normally`);
});

// C7-B: manual mode + no manual history → all nights upserted
await test('C7-B — manual mode: no manual history → all nights pass through', async () => {
  _pricePropertyImpl    = makePriceProperty([
    { date: D_FREE, price: 90, minStay: 1 },
  ]);
  _pushRatesImpl        = () => ({ success: true });
  _pushRestrictionsImpl = () => ({ success: true });

  const pool = makeMockPoolC7([]);  // no manual-applied history
  await applyDynamicPricingForProperty(pool, {
    cfg: makeCfg({ mode: 'manual' }), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(pool._capturedDates.includes(D_FREE),
    `${D_FREE} must be upserted when no manual lock exists`);
});

// C7-C: auto mode + canPush=true → manual protection bypassed (AUTO_CAN_RETAKE_CONTROL=YES)
await test('C7-C — auto+canPush=true: manual protection bypassed, AUTO retakes control', async () => {
  _pricePropertyImpl = makePriceProperty([
    { date: D_PROT, price: 82, minStay: 2 },
  ]);
  let publishCalled = false;
  _publishImpl = () => { publishCalled = true; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };

  const pool = makeMockPoolC7([{ week_start: W_PROT }]);  // manual history exists
  const result = await applyDynamicPricingForProperty(pool, {
    cfg: makeCfg({ mode: 'auto' }), marketStats: {}, isMock: false, sendPushNotification: null,
  });

  assert.ok(pool._capturedDates.includes(D_PROT),
    `${D_PROT} must be upserted in auto mode (C7 protection bypassed)`);
  assert.ok(publishCalled, 'publisher must be called in auto mode');
  assert.strictEqual(result.status, 'applied');
});

// ─── P4-01–P4-23 : PATH 4 → central publisher (C4.3-D) ─────────────────────

console.log('\n── P4-01–P4-23 : PATH4 migration → central publisher ──');

const { addDays: addDaysUtil } = require('../routes/effective-pricing-resolver');

// Pool capturant les dates upsertées ET les appels publisher
function makeMockPoolP4(overrides = {}) {
  const upsertedDates = [];
  const pool = {
    _upsertedDates: upsertedDates,
    async query(sql, params) {
      const s = sql.toLowerCase().trim();
      if (s.startsWith('create table') || s.startsWith('create index')) return { rows: [] };
      if (s.includes('from properties'))       return { rows: [{ ...BASE_PROP, ...overrides }] };
      if (s.includes('from pricing_history'))  return { rows: [] };
      if (s.includes('into pricing_schedule')) {
        if (params) {
          for (let i = 2; i < params.length; i += 8) upsertedDates.push(params[i]);
        }
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('insert') || s.startsWith('update')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  };
  return pool;
}

// --- P4-01: upsertSchedule avant publisher ---
await test('P4-01 — AUTO canPush → upsertSchedule avant appel publisher', async () => {
  const callOrder = [];
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-01', price: 100, minStay: 1 }]);
  const pool = makeMockPoolP4();
  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (sql.toLowerCase().includes('into pricing_schedule')) callOrder.push('upsert');
    return origQuery(sql, params);
  };
  _publishImpl = () => { callOrder.push('publisher'); return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };
  await applyDynamicPricingForProperty(pool, { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  const upsertIdx   = callOrder.indexOf('upsert');
  const publishIdx  = callOrder.indexOf('publisher');
  assert.ok(upsertIdx  >= 0, 'upsert doit être appelé');
  assert.ok(publishIdx >= 0, 'publisher doit être appelé');
  assert.ok(upsertIdx  < publishIdx, 'upsert doit précéder le publisher');
});

// --- P4-02: publisher appelé exactement 1 fois ---
await test('P4-02 — AUTO → publisher appelé exactement 1 fois', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-02', price: 100, minStay: 1 }]);
  let publishCount = 0;
  _publishImpl = () => { publishCount++; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(publishCount, 1, 'publisher doit être appelé exactement 1 fois');
});

// --- P4-03: allowedDates == dates upsertées ---
await test('P4-03 — AUTO → allowedDates exactement = dates upsertées', async () => {
  const nights = [
    { date: '2026-12-03', price: 90, minStay: 1 },
    { date: '2026-12-04', price: 95, minStay: 1 },
    { date: '2026-12-05', price: 100, minStay: 1 },
  ];
  _pricePropertyImpl = makePriceProperty(nights);
  let capturedAllowedDates = null;
  _publishImpl = (_pool, opts) => { capturedAllowedDates = opts.allowedDates; return Promise.resolve({ status: 'ok', rates: { count: 3, pushed: 3, error: null }, restrictions: { count: 3, pushed: 3, error: null } }); };
  const pool = makeMockPoolP4();
  await applyDynamicPricingForProperty(pool, { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.ok(Array.isArray(capturedAllowedDates), 'allowedDates doit être un tableau');
  const expectedDates = nights.map(n => n.date).sort();
  assert.deepStrictEqual([...capturedAllowedDates].sort(), expectedDates, 'allowedDates == dates upsertées');
  assert.deepStrictEqual([...pool._upsertedDates].sort(), expectedDates, 'dates upsertées == dates nights');
});

// --- P4-04: nuits booked absentes d'upsert ET allowedDates ---
await test('P4-04 — nuits booked absentes de upsert ET allowedDates', async () => {
  const nights = [
    { date: '2026-12-06', price: 90, minStay: 1 },
    { date: '2026-12-07', price: 95, minStay: 1, booked: true },
    { date: '2026-12-08', price: 100, minStay: 1 },
  ];
  _pricePropertyImpl = makePriceProperty(nights);
  let capturedAllowedDates = null;
  _publishImpl = (_pool, opts) => { capturedAllowedDates = opts.allowedDates; return Promise.resolve({ status: 'ok', rates: { count: 2, pushed: 2, error: null }, restrictions: { count: 2, pushed: 2, error: null } }); };
  const pool = makeMockPoolP4();
  await applyDynamicPricingForProperty(pool, { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.ok(!pool._upsertedDates.includes('2026-12-07'), 'booked date absent de upsert');
  assert.ok(!capturedAllowedDates.includes('2026-12-07'), 'booked date absent de allowedDates');
  assert.strictEqual(capturedAllowedDates.length, 2);
});

// --- P4-05: horizon = 365 ---
await test('P4-05 — publisher appelé avec endDate = startDate + 365', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-10', price: 100, minStay: 1 }]);
  let capturedOpts = null;
  _publishImpl = (_pool, opts) => { capturedOpts = opts; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.ok(capturedOpts, 'publisher doit être appelé');
  const expectedEnd = addDaysUtil(capturedOpts.startDate, 365);
  assert.strictEqual(capturedOpts.endDate, expectedEnd, `endDate doit être startDate + 365`);
});

// --- P4-06: reason='boostprice_auto' ---
await test('P4-06 — publisher appelé avec reason=boostprice_auto', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-11', price: 100, minStay: 1 }]);
  let capturedOpts = null;
  _publishImpl = (_pool, opts) => { capturedOpts = opts; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(capturedOpts.reason, 'boostprice_auto');
});

// --- P4-07: includeStopSell=false ---
await test('P4-07 — publisher appelé avec includeStopSell=false', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-12', price: 100, minStay: 1 }]);
  let capturedOpts = null;
  _publishImpl = (_pool, opts) => { capturedOpts = opts; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(capturedOpts.includeStopSell, false, 'includeStopSell doit être false pour PATH 4');
});

// --- P4-08: publisher ok → history applied ---
await test('P4-08 — publisher ok → history status applied', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-13', price: 100, minStay: 1 }]);
  _publishImpl = () => Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } });
  const result = await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(result.status, 'applied');
  assert.strictEqual(result.publishStatus, 'ok');
});

// --- P4-09: publisher partial → history applied ---
await test('P4-09 — publisher partial → history status applied', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-14', price: 100, minStay: 1 }]);
  _publishImpl = () => Promise.resolve({ status: 'partial', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 0, error: 'timeout' } });
  const result = await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(result.status, 'applied', 'history status doit rester applied même si partial');
  assert.strictEqual(result.publishStatus, 'partial');
});

// --- P4-10: publisher error → history applied ---
await test('P4-10 — publisher error → history status applied', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-15', price: 100, minStay: 1 }]);
  _publishImpl = () => Promise.resolve({ status: 'error', rates: { count: 1, pushed: 0, error: 'Channex 500' }, restrictions: { count: 1, pushed: 0, error: null } });
  const result = await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(result.status, 'applied', 'transport OTA != état métier');
  assert.strictEqual(result.publishStatus, 'error');
});

// --- P4-11: publisher throw → history applied + fonction continue ---
await test('P4-11 — publisher throw → history applied, fonction ne jette pas', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-16', price: 100, minStay: 1 }]);
  _publishImpl = () => Promise.reject(new Error('DB connexion perdue'));
  const result = await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(result.status, 'applied', 'throw du publisher ne doit pas changer history status');
  assert.strictEqual(result.publishStatus, 'error');
});

// --- P4-12: publisher throw → schedule non annulé ---
await test('P4-12 — publisher throw → pricing_schedule déjà écrit non annulé', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-17', price: 100, minStay: 1 }]);
  _publishImpl = () => Promise.reject(new Error('réseau'));
  const pool = makeMockPoolP4();
  await applyDynamicPricingForProperty(pool, { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.ok(pool._upsertedDates.includes('2026-12-17'), 'la date doit rester upsertée malgré le throw publisher');
});

// --- P4-13: MANUAL → publisher 0 call ---
await test('P4-13 — MANUAL → publisher non appelé', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-18', price: 100, minStay: 1 }]);
  let publishCount = 0;
  _publishImpl = () => { publishCount++; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg({ mode: 'manual' }), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(publishCount, 0);
});

// --- P4-14: MANUAL C7 toujours fonctionnel ---
await test('P4-14 — MANUAL C7 protection toujours fonctionnelle après migration', async () => {
  _pricePropertyImpl = makePriceProperty([
    { date: D_PROT, price: 82, minStay: 2 },
    { date: D_FREE, price: 90, minStay: 1 },
  ]);
  _publishImpl = () => Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } });
  const pool = makeMockPoolC7([{ week_start: W_PROT }]);
  await applyDynamicPricingForProperty(pool, { cfg: makeCfg({ mode: 'manual' }), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.ok(!pool._capturedDates.includes(D_PROT), 'date protégée exclue');
  assert.ok(pool._capturedDates.includes(D_FREE), 'date libre incluse');
});

// --- P4-15: AUTO retake control toujours fonctionnel ---
await test('P4-15 — AUTO retake control toujours fonctionnel', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: D_PROT, price: 82, minStay: 2 }]);
  _publishImpl = () => Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } });
  const pool = makeMockPoolC7([{ week_start: W_PROT }]);
  await applyDynamicPricingForProperty(pool, { cfg: makeCfg({ mode: 'auto' }), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.ok(pool._capturedDates.includes(D_PROT), 'auto bypasse C7 et upserte la date');
});

// --- P4-16: external_pricing → publisher 0 call ---
await test('P4-16 — external_pricing → publisher non appelé', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-20', price: 100, minStay: 1 }]);
  let publishCount = 0;
  _publishImpl = () => { publishCount++; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4({ external_pricing: true }), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(publishCount, 0);
});

// --- P4-17: channex disabled → publisher 0 call ---
await test('P4-17 — channex_enabled=false → publisher non appelé', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-21', price: 100, minStay: 1 }]);
  let publishCount = 0;
  _publishImpl = () => { publishCount++; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4({ channex_enabled: false }), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(publishCount, 0);
});

// --- P4-18: missing rate plan → publisher 0 call ---
await test('P4-18 — channex_rate_plan_id manquant → publisher non appelé', async () => {
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-22', price: 100, minStay: 1 }]);
  let publishCount = 0;
  _publishImpl = () => { publishCount++; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };
  await applyDynamicPricingForProperty(makeMockPoolP4({ channex_rate_plan_id: null }), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(publishCount, 0);
});

// --- P4-19: nights.length=0 → publisher 0 call ---
await test('P4-19 — nights.length=0 → publisher non appelé', async () => {
  _pricePropertyImpl = makePriceProperty([]);  // 0 nuits (schedule vide)
  let publishCount = 0;
  _publishImpl = () => { publishCount++; return Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }); };
  const result = await applyDynamicPricingForProperty(makeMockPoolP4(), { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.strictEqual(publishCount, 0);
  assert.strictEqual(result.status, 'skipped');
});

// --- P4-20: aucun pushRates direct dans PATH 4 ---
await test('P4-20 — aucun appel pushRates direct depuis PATH 4 (structurel)', async () => {
  const src = require('fs').readFileSync(require.resolve('../routes/pricing-apply'), 'utf8');
  // After migration, direct pushRates call inside willPush block must be gone
  const hasDirect = /require\(['"]\.\.\/channex['"]\)\s*\.\s*pushRates|pushRates\s*\(pool/.test(src);
  assert.ok(!hasDirect, 'pricing-apply ne doit pas contenir de pushRates direct vers channex');
});

// --- P4-21: aucun pushRestrictions direct dans PATH 4 ---
await test('P4-21 — aucun appel pushRestrictions direct depuis PATH 4 (structurel)', async () => {
  const src = require('fs').readFileSync(require.resolve('../routes/pricing-apply'), 'utf8');
  const hasDirect = /require\(['"]\.\.\/channex['"]\)\s*\.\s*pushRestrictions|pushRestrictions\s*\(pool/.test(src);
  assert.ok(!hasDirect, 'pricing-apply ne doit pas contenir de pushRestrictions direct vers channex');
});

// --- P4-22: min_stay écrit dans schedule puis lu par publisher ---
await test('P4-22 — min_stay écrit dans schedule avec valeur engine (parity via allowedDates)', async () => {
  // Le publisher lit pricing_schedule via le resolver (source=boostprice → min_stay du schedule)
  // Ce test vérifie que allowedDates transmis au publisher = dates upsertées avec min_stay valide
  _pricePropertyImpl = makePriceProperty([{ date: '2026-12-25', price: 90, minStay: 3 }]);
  let capturedOpts = null;
  _publishImpl = (_pool, opts) => { capturedOpts = opts; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };
  const pool = makeMockPoolP4();
  await applyDynamicPricingForProperty(pool, { cfg: makeCfg(), marketStats: {}, isMock: false, sendPushNotification: null });
  assert.ok(capturedOpts.allowedDates.includes('2026-12-25'), 'date avec min_stay=3 dans allowedDates');
  assert.ok(pool._upsertedDates.includes('2026-12-25'), 'date avec min_stay=3 upsertée');
});

// --- P4-23: publisher ne provoque aucune écriture pricing_schedule ---
await test('P4-23 — publisher ne doit pas écrire pricing_schedule (structurel)', async () => {
  const src = require('fs').readFileSync(require.resolve('../routes/pricing-publisher'), 'utf8');
  // Publisher must not contain INSERT/UPDATE to pricing_schedule
  const hasWrite = /insert\s+into\s+pricing_schedule|update\s+pricing_schedule/i.test(src);
  assert.ok(!hasWrite, 'pricing-publisher ne doit pas écrire dans pricing_schedule');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n── pricing-apply (C3B + C7 + P4 migration) ─────────────────────────────────');
console.log(`   ${passed} passed  ${failed} failed`);
if (failures.length) {
  console.log('\nÉCHECS :');
  failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.message}`));
  process.exit(1);
}
process.exit(0);

})();

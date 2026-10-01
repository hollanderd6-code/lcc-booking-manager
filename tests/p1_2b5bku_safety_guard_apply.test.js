#!/usr/bin/env node
'use strict';
/**
 * Tests — Safety Guard P1.2-B5-BK-U (apply level)
 *
 * TEST A: opts omitted / suppressExternalPush=false → publishEffectivePricing called
 * TEST B: suppressExternalPush=true → publishEffectivePricing NOT called; schedule/history written;
 *         externalPushSuppressed marker set; mode_used preserved as 'auto' (not 'manual')
 * TEST C: suppressExternalPush=true → upsertSchedule receives breakdown with version=1
 * TEST K: non-boolean suppressExternalPush values (false/undefined/null/0/'true') never suppress
 *
 * DB_WRITES = 0  NETWORK_CALLS = 0  BRIGHT_DATA = 0
 */

const assert = require('assert');

// ── Mock deps BEFORE requiring pricing-apply ───────────────────────────────────
let _pricePropertyImpl = null;
let _publishImpl       = null;

const enginePath = require.resolve('../routes/pricing-engine');
require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty:                 (pool, opts) => _pricePropertyImpl(pool, opts),
    SCHOOL_HOLIDAYS_IDF_2025_2026: [],
    EVENTS_PARIS_2026:             [],
  },
};

const publisherPath = require.resolve('../routes/pricing-publisher');
require.cache[publisherPath] = {
  id: publisherPath, filename: publisherPath, loaded: true,
  exports: {
    publishEffectivePricing: (pool, opts) => _publishImpl
      ? _publishImpl(pool, opts)
      : Promise.resolve({ status: 'ok', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } }),
  },
};

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

// ── Fixtures ───────────────────────────────────────────────────────────────────
const PROP_CHANNEX = {
  id: 'p1', name: 'Test Logement',
  base_price: 100, weekend_price: null,
  channex_enabled: true, channex_property_id: 'cx-p',
  channex_room_type_id: 'cx-rt', channex_rate_plan_id: 'cx-rp',
  external_pricing: false,
};

function makeCfg(overrides = {}) {
  return { user_id: 'u1', property_id: 'p1', property_name: 'Test Logement', mode: 'auto', notify_push: false, ...overrides };
}

let _scheduleUpsertCalls  = [];
let _historyInsertParams  = null;

function makeMockPool(prop = PROP_CHANNEX) {
  _scheduleUpsertCalls = [];
  _historyInsertParams = null;
  return {
    async query(sql, params) {
      const s = (sql || '').toLowerCase().trim();
      if (s.startsWith('create table') || s.startsWith('create index'))  return { rows: [] };
      if (s.includes('from properties') && !s.includes('pricing_history')) return { rows: [prop] };
      if (s.includes('pricing_history') && !s.startsWith('insert'))       return { rows: [] };
      if (s.includes('insert into pricing_schedule'))  { _scheduleUpsertCalls.push(params); return { rows: [], rowCount: 1 }; }
      if (s.includes('insert into pricing_history'))   { _historyInsertParams = params;      return { rows: [], rowCount: 1 }; }
      if (s.startsWith('insert') || s.startsWith('update')) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
  };
}

// Night with controllable breakdown version
function makeNight(date, version = undefined) {
  return {
    date, price: 100, minStay: 1, booked: false,
    reason: 'test',
    breakdown: { version, market: 0.5, pacing: 0.3, season: 0.2 },
  };
}

function makePriceProperty(nights) {
  return async (pool, opts) => ({
    propertyId: opts.property.id, mode: 'auto', isActive: true, market: {},
    rates:        nights.filter(n => !n.booked).map(n => ({ date: n.date, price: n.price })),
    restrictions: nights.filter(n => !n.booked).map(n => ({ date: n.date, min_stay: n.minStay })),
    schedule:     nights.map(n => ({ ...n, booked: n.booked || false })),
  });
}

// ── TESTS ─────────────────────────────────────────────────────────────────────
(async () => {

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST A: Legacy / default behavior ─────────────────────────────────────');

await test('A1 — suppressExternalPush absent: publishEffectivePricing called', async () => {
  let publishCalls = 0;
  _pricePropertyImpl = makePriceProperty([makeNight('2026-11-01')]);
  _publishImpl = () => { publishCalls++; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };

  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, marketOverride: null, sendPushNotification: null,
  });

  assert.strictEqual(publishCalls, 1, 'publishEffectivePricing must be called when suppressExternalPush absent');
  assert.strictEqual(result.status, 'applied');
  assert.strictEqual(result.externalPushSuppressed, undefined, 'no externalPushSuppressed marker on normal run');
});

await test('A2 — suppressExternalPush=false: publishEffectivePricing still called', async () => {
  let publishCalls = 0;
  _pricePropertyImpl = makePriceProperty([makeNight('2026-11-02')]);
  _publishImpl = () => { publishCalls++; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };

  await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, marketOverride: null, sendPushNotification: null,
    suppressExternalPush: false,
  });

  assert.strictEqual(publishCalls, 1, 'suppressExternalPush=false must NOT suppress publication');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST B: suppressExternalPush=true behavior ────────────────────────────');

await test('B1 — suppressExternalPush=true: publishEffectivePricing NOT called', async () => {
  let publishCalls = 0;
  _pricePropertyImpl = makePriceProperty([makeNight('2026-11-03')]);
  _publishImpl = () => { publishCalls++; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };

  const result = await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false, marketOverride: null, sendPushNotification: null,
    suppressExternalPush: true,
  });

  assert.strictEqual(publishCalls, 0, 'publishEffectivePricing must NOT be called when suppressed');
  assert.strictEqual(result.status, 'pending', 'suppressed run must record status=pending (no rates pushed)');
  assert.strictEqual(result.priceApplied, null, 'priceApplied must be null (no publication occurred)');
  assert.strictEqual(result.externalPushSuppressed, true, 'externalPushSuppressed marker must be present');
});

await test('B2 — suppressExternalPush=true: pricing_schedule still written', async () => {
  _pricePropertyImpl = makePriceProperty([makeNight('2026-11-04')]);
  _publishImpl = null;

  const pool = makeMockPool();
  await applyDynamicPricingForProperty(pool, {
    cfg: makeCfg(), marketStats: {}, isMock: false, marketOverride: null, sendPushNotification: null,
    suppressExternalPush: true,
  });

  assert.ok(_scheduleUpsertCalls.length > 0, 'pricing_schedule must still be written when suppressed');
});

await test('B3 — suppressExternalPush=true: pricing_history written with mode_used=auto (not manual)', async () => {
  _pricePropertyImpl = makePriceProperty([makeNight('2026-11-05')]);
  _publishImpl = null;

  await applyDynamicPricingForProperty(makeMockPool(), {
    cfg: makeCfg({ mode: 'auto' }),
    marketStats: {}, isMock: false, marketOverride: null, sendPushNotification: null,
    suppressExternalPush: true,
  });

  assert.ok(_historyInsertParams, 'pricing_history INSERT must occur');
  // params layout: [user_id, property_id, week_start, price_before, avg7, price_applied,
  //                 median, occupancy, tension, market, pacing, season, self_occ,
  //                 status, mode_used, reason, applied_by, applied_at]
  // mode_used is $15 → params index [14]
  assert.strictEqual(_historyInsertParams[14], 'auto', 'mode_used must remain "auto" — not falsified to "manual"');
  // status is $14 → index [13]
  assert.strictEqual(_historyInsertParams[13], 'pending', 'status should be "pending" when not published');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST C: breakdown.version=1 persisted when suppressed ─────────────────');

await test('C — suppressExternalPush=true: upsertSchedule receives breakdown.version=1', async () => {
  _pricePropertyImpl = makePriceProperty([makeNight('2026-11-06', 1)]);
  _publishImpl = null;

  const pool = makeMockPool();
  await applyDynamicPricingForProperty(pool, {
    cfg: makeCfg(), marketStats: {}, isMock: false, marketOverride: null, sendPushNotification: null,
    suppressExternalPush: true,
  });

  assert.ok(_scheduleUpsertCalls.length > 0, 'pricing_schedule write must occur');
  // upsertSchedule params per night: [userId, propertyId, date, price, minStay, reason, breakdownJson, status]
  // breakdown is index [6] for the first night in the first chunk
  const breakdownJson = _scheduleUpsertCalls[0]?.[6];
  const breakdown = typeof breakdownJson === 'string' ? JSON.parse(breakdownJson) : breakdownJson;
  assert.strictEqual(breakdown?.version, 1, 'breakdown.version must equal 1 in persisted schedule');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── TEST K: non-boolean suppressExternalPush must not suppress ─────────────');

const nonBoolValues = [false, undefined, null, 0, '', 'true', 1];
for (const val of nonBoolValues) {
  const label = val === undefined ? 'undefined' : JSON.stringify(val);
  await test(`K — suppressExternalPush=${label}: does NOT suppress publication`, async () => {
    let publishCalls = 0;
    _pricePropertyImpl = makePriceProperty([makeNight('2026-12-01')]);
    _publishImpl = () => { publishCalls++; return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } }); };

    const callOpts = {
      cfg: makeCfg(), marketStats: {}, isMock: false, marketOverride: null, sendPushNotification: null,
    };
    if (val !== undefined) callOpts.suppressExternalPush = val;

    await applyDynamicPricingForProperty(makeMockPool(), callOpts);

    assert.strictEqual(publishCalls, 1, `suppressExternalPush=${label} must not suppress — only boolean true suppresses`);
  });
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`✅  All ${passed} tests passed\n`);
} else {
  console.log(`❌  ${failed} failed, ${passed} passed`);
  for (const f of failures) console.error(`   • ${f.name}: ${f.message}`);
  process.exit(1);
}

})();

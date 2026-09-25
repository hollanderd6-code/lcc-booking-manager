#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.0-B Market Data Freshness + Trust Resolver
 *
 * Groupes :
 *   MF-01–MF-10 : resolveMarketData — classification de chaque état
 *   MF-11–MF-12 : resolveMarketData — sélection newest row (trust × recency)
 *   MF-13–MF-14 : recalc trigger — bypass P1.0-A fermé
 *   MF-15–MF-19 : priceProperty marketOverride contract
 *   MF-20–MF-21 : mock/stale market ne peut pas atteindre marketMult
 *
 * Exécution : node tests/p1_0b_market_freshness.test.js
 * Aucun appel DB réel. Aucun appel Channex. Aucun appel Apify.
 */

const assert = require('assert');

// ── Résolution de chemins ─────────────────────────────────────────────────────
const resolverPath  = require.resolve('../routes/market-data-resolver');
const enginePath    = require.resolve('../routes/pricing-engine');
const publisherPath = require.resolve('../routes/pricing-publisher');
const applyPath     = require.resolve('../routes/pricing-apply');
const triggerPath   = require.resolve('../routes/pricing-recalc-trigger');
const dpRoutesPath  = require.resolve('../routes/dynamic-pricing-routes');
const cronPath      = require.resolve('../routes/dynamic-pricing-cron');

// ── Test runner ───────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ONE_SEC = 1000;

// now reference used across tests
const NOW = new Date('2026-09-23T12:00:00.000Z');

function scrapedAtAge(ageMs) {
  return new Date(NOW.getTime() - ageMs).toISOString();
}

function makeResolverPool(row) {
  return {
    async query(sql, params) {
      if (sql.toLowerCase().includes('from market_data')) {
        return { rows: row ? [row] : [] };
      }
      throw new Error('ResolverPool inattendu: ' + sql.slice(0, 80));
    },
  };
}

// ── PART 1: resolveMarketData unit tests ─────────────────────────────────────

// Require the REAL resolver — no pricing-engine involved
const { resolveMarketData, MARKET_TTL_DAYS } = require('../routes/market-data-resolver');

(async () => {

console.log('\n── MF-01–MF-10 : resolveMarketData classification ──');

await test('MF-01 live_fresh (<14d) → usable=true, market object with median', async () => {
  const pool = makeResolverPool({
    data_source: 'apify_live',
    scraped_at: scrapedAtAge(7 * 24 * 60 * 60 * 1000),   // 7 days ago
    median_price: 120, occupancy_rate: 0.7, comparable_count: 15, tension_level: 'medium',
    week_start: '2026-09-15',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status,  'live_fresh');
  assert.strictEqual(r.trusted, true);
  assert.strictEqual(r.fresh,   true);
  assert.strictEqual(r.usable,  true);
  assert.ok(r.market !== null, 'market should be non-null');
  assert.strictEqual(parseFloat(r.market.median), 120);
});

await test('MF-02 live_stale (>14d) → usable=false, market=null, push still allowed', async () => {
  const pool = makeResolverPool({
    data_source: 'apify_live',
    scraped_at: scrapedAtAge(15 * 24 * 60 * 60 * 1000),   // 15 days ago
    median_price: 100, occupancy_rate: 0.6, comparable_count: 10, tension_level: 'low',
    week_start: '2026-09-08',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status,  'live_stale');
  assert.strictEqual(r.trusted, true);
  assert.strictEqual(r.fresh,   false);
  assert.strictEqual(r.usable,  false);
  assert.strictEqual(r.market,  null);
  // isMock would be false for stale (trusted=true) → push NOT blocked
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, false, 'stale live must not block push');
});

await test('MF-03 mock fresh → status=mock, trusted=false, usable=false', async () => {
  const pool = makeResolverPool({
    data_source: 'mock',
    scraped_at: scrapedAtAge(ONE_SEC),
    median_price: 80, occupancy_rate: 0.5, comparable_count: 10, tension_level: 'medium',
    week_start: '2026-09-22',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status,  'mock');
  assert.strictEqual(r.trusted, false);
  assert.strictEqual(r.usable,  false);
  assert.strictEqual(r.market,  null);
});

await test('MF-04 mock stale → status=mock, usable=false (freshness irrelevant for untrusted)', async () => {
  const pool = makeResolverPool({
    data_source: 'mock',
    scraped_at: scrapedAtAge(30 * 24 * 60 * 60 * 1000),
    median_price: 80, occupancy_rate: 0.5, comparable_count: 10, tension_level: 'medium',
    week_start: '2026-08-25',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status,  'mock');
  assert.strictEqual(r.usable,  false);
  assert.strictEqual(r.market,  null);
});

await test('MF-05 unknown → status=unknown, trusted=false, usable=false', async () => {
  const pool = makeResolverPool({
    data_source: 'unknown',
    scraped_at: scrapedAtAge(ONE_SEC),
    median_price: 90, occupancy_rate: 0.6, comparable_count: 8, tension_level: 'medium',
    week_start: '2026-09-22',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status,  'unknown');
  assert.strictEqual(r.trusted, false);
  assert.strictEqual(r.usable,  false);
  assert.strictEqual(r.market,  null);
});

await test('MF-06 missing row → status=missing, market=null, push allowed (neutral)', async () => {
  const pool = makeResolverPool(null);
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status,  'missing');
  assert.strictEqual(r.trusted, false);
  assert.strictEqual(r.fresh,   false);
  assert.strictEqual(r.usable,  false);
  assert.strictEqual(r.market,  null);
  // missing → isMock = !trusted && status !== 'missing' = false → push allowed
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, false, 'missing market must not block push');
});

await test('MF-07 age = TTL - 1s → fresh (just inside boundary)', async () => {
  const pool = makeResolverPool({
    data_source: 'apify_live',
    scraped_at: scrapedAtAge(TTL_MS - ONE_SEC),
    median_price: 100, occupancy_rate: 0.6, comparable_count: 12, tension_level: 'medium',
    week_start: '2026-09-09',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.fresh, true,  'TTL-1s must be fresh');
  assert.strictEqual(r.usable, true);
});

await test('MF-08 age = exactly TTL → stale (boundary inclusive)', async () => {
  const pool = makeResolverPool({
    data_source: 'apify_live',
    scraped_at: scrapedAtAge(TTL_MS),
    median_price: 100, occupancy_rate: 0.6, comparable_count: 12, tension_level: 'medium',
    week_start: '2026-09-09',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.fresh,  false, 'exactly TTL must be stale');
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.status, 'live_stale');
});

await test('MF-09 age = TTL + 1s → stale (just over boundary)', async () => {
  const pool = makeResolverPool({
    data_source: 'apify_live',
    scraped_at: scrapedAtAge(TTL_MS + ONE_SEC),
    median_price: 100, occupancy_rate: 0.6, comparable_count: 12, tension_level: 'medium',
    week_start: '2026-09-09',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.fresh,  false, 'TTL+1s must be stale');
  assert.strictEqual(r.status, 'live_stale');
});

await test('MF-10 invalid scraped_at on apify_live → treated as stale (fail-safe), push still allowed', async () => {
  const pool = makeResolverPool({
    data_source: 'apify_live',
    scraped_at: null,
    median_price: 100, occupancy_rate: 0.6, comparable_count: 12, tension_level: 'medium',
    week_start: '2026-09-15',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status,  'live_stale', 'null scraped_at → stale');
  assert.strictEqual(r.trusted, true, 'trusted provenance preserved');
  assert.strictEqual(r.usable,  false);
  assert.strictEqual(r.market,  null);
  // Push not blocked: trusted=true → isMock = !true && status!='missing' = false
  const isMock = !r.trusted && r.status !== 'missing';
  assert.strictEqual(isMock, false, 'stale apify_live must not block push');
});

console.log('\n── MF-11–MF-12 : resolver row selection semantics ──');

await test('MF-11 SQL query has no data_source WHERE filter (resolver selects ANY newest row)', async () => {
  let capturedSql = null;
  const pool = {
    async query(sql, params) {
      if (sql.toLowerCase().includes('from market_data')) {
        capturedSql = sql;
        return { rows: [] };
      }
      throw new Error('unexpected: ' + sql.slice(0, 80));
    },
  };
  await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.ok(capturedSql, 'market_data query must have been issued');
  const lc = capturedSql.toLowerCase();
  assert.ok(!lc.includes("data_source ="), 'query must NOT filter by data_source before selecting newest');
  assert.ok(lc.includes('order by week_start desc'), 'query must order by week_start DESC');
});

await test('MF-12 newer mock row is selected over older live (pool returns mock row → classified as mock)', async () => {
  // If DB returns a mock row (most recent), resolver correctly classifies it as mock,
  // not silently ignored in favour of a hypothetical older live row.
  const pool = makeResolverPool({
    data_source: 'mock',
    scraped_at: scrapedAtAge(ONE_SEC),   // newest: yesterday mock
    median_price: 80, occupancy_rate: 0.5, comparable_count: 10, tension_level: 'medium',
    week_start: '2026-09-22',
  });
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: NOW });
  assert.strictEqual(r.status, 'mock', 'resolver must classify what it gets, not filter to old live');
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
});

// ── PART 2: priceProperty marketOverride contract ─────────────────────────────

console.log('\n── MF-13–MF-17 : priceProperty marketOverride contract ──');

// Require REAL pricing-engine (no mock needed — it has no external requires)
const { priceProperty, marketMult } = require('../routes/pricing-engine');

const BASE_PROP_FOR_ENGINE = {
  id: 'prop-e1',
  base_price: 100,
  weekend_price: null,
};

function makeEnginePool({ trackMarketQuery = false, marketRow = null } = {}) {
  let marketQueried = false;
  const pool = {
    async query(sql, params) {
      const s = sql.toLowerCase().trim();
      if (s.includes('from pricing_config')) {
        return { rows: [{ mode: 'auto', is_active: true, price_min: '50', price_max: '500' }] };
      }
      if (s.includes('from reservations')) return { rows: [] };
      if (s.includes('from market_data')) {
        if (trackMarketQuery) marketQueried = true;
        return { rows: marketRow ? [marketRow] : [] };
      }
      throw new Error('EngineMockPool inattendu: ' + sql.slice(0, 80));
    },
    _wasMarketQueried() { return marketQueried; },
  };
  return pool;
}

await test('MF-13 marketOverride=null → priceProperty does NOT query market_data DB', async () => {
  const pool = makeEnginePool({ trackMarketQuery: true });
  const result = await priceProperty(pool, {
    userId: 'u1', property: BASE_PROP_FOR_ENGINE,
    today: new Date('2026-09-23'), events: [], schoolHolidays: [],
    marketOverride: null,
  });
  assert.strictEqual(pool._wasMarketQueried(), false, 'market_data DB must not be queried when marketOverride=null');
  // All nights should have breakdown.market = 1 (neutral)
  const firstNight = result.schedule[0];
  assert.strictEqual(firstNight.breakdown.market, 1, 'market factor must be 1 when marketOverride=null');
  assert.strictEqual(firstNight.breakdown.marketConfidence, null, 'confidence must be null when no market');
});

await test('MF-14 marketOverride=object with median → priceProperty uses it (does not query DB)', async () => {
  const pool = makeEnginePool({ trackMarketQuery: true });
  const marketObj = { median: 200, occupancy_rate: 0.8, comparable_count: 20, tensionLevel: 'high', tension_level: 'high' };
  const result = await priceProperty(pool, {
    userId: 'u1', property: BASE_PROP_FOR_ENGINE,
    today: new Date('2026-09-23'), events: [], schoolHolidays: [],
    marketOverride: marketObj,
  });
  assert.strictEqual(pool._wasMarketQueried(), false, 'market_data DB must not be queried when marketOverride is supplied');
  assert.strictEqual(result.market, marketObj, 'result.market must be the supplied object');
  // With median=200 >> base=100, market factor should be > 1
  const firstNight = result.schedule[0];
  assert.ok(firstNight.breakdown.market > 1, `market factor should be > 1 when median=${marketObj.median} > base=${BASE_PROP_FOR_ENGINE.base_price}`);
});

await test('MF-15 marketOverride absent → fail-closed error (B4-F engine contract)', async () => {
  // B4-F: legacy DB lookup removed. Missing marketOverride is a programming error.
  const pool = makeEnginePool({ trackMarketQuery: true });
  await assert.rejects(
    () => priceProperty(pool, {
      userId: 'u1', property: BASE_PROP_FOR_ENGINE,
      today: new Date('2026-09-23'), events: [], schoolHolidays: [],
      // marketOverride intentionally absent
    }),
    (err) => {
      assert.ok(err.message.includes('explicit marketOverride'), `Wrong error: ${err.message}`);
      return true;
    }
  );
  assert.strictEqual(pool._wasMarketQueried(), false, 'market_data must NOT be queried — fail-closed before any query');
});

await test('MF-16 marketOverride=undefined → fail-closed error (B4-F engine contract)', async () => {
  // B4-F: undefined is treated same as absent — both are programming errors.
  const pool = makeEnginePool({ trackMarketQuery: true });
  await assert.rejects(
    () => priceProperty(pool, {
      userId: 'u1', property: BASE_PROP_FOR_ENGINE,
      today: new Date('2026-09-23'), events: [], schoolHolidays: [],
      marketOverride: undefined,
    }),
    (err) => {
      assert.ok(err.message.includes('explicit marketOverride'), `Wrong error: ${err.message}`);
      return true;
    }
  );
  assert.strictEqual(pool._wasMarketQueried(), false, 'market_data must NOT be queried');
});

// ── PART 3: mock/stale market never reaches marketMult ────────────────────────

console.log('\n── MF-17–MF-19 : mock/stale market does not reach marketMult ──');

await test('MF-17 null marketOverride → breakdown.market = 1 (neutral — mock scenario)', async () => {
  const pool = makeEnginePool();
  const result = await priceProperty(pool, {
    userId: 'u1', property: BASE_PROP_FOR_ENGINE,
    today: new Date('2026-09-23'), events: [], schoolHolidays: [],
    marketOverride: null,
  });
  for (const night of result.schedule.slice(0, 5)) {
    assert.strictEqual(night.breakdown.market, 1, `breakdown.market must be 1 for mock/stale (date ${night.date})`);
    assert.strictEqual(night.breakdown.marketConfidence, null);
  }
});

await test('MF-18 null marketOverride → breakdown.market = 1 (neutral — stale live scenario)', async () => {
  // Indistinguishable from MF-17 at engine level — both receive marketOverride=null
  const pool = makeEnginePool();
  const result = await priceProperty(pool, {
    userId: 'u1', property: BASE_PROP_FOR_ENGINE,
    today: new Date('2026-09-23'), events: [], schoolHolidays: [],
    marketOverride: null,
  });
  const firstNight = result.schedule[0];
  assert.strictEqual(firstNight.breakdown.market, 1, 'stale live: market factor must be neutral');
});

await test('MF-19 live market object with median >> base → breakdown.market != 1 (signal applied)', async () => {
  const pool = makeEnginePool();
  // median=300 >> base=100 → shift = 300/price_before_market - 1 → large positive shift → market > 1
  const result = await priceProperty(pool, {
    userId: 'u1', property: BASE_PROP_FOR_ENGINE,
    today: new Date('2026-09-23'), events: [], schoolHolidays: [],
    marketOverride: { median: 300, occupancy_rate: 0.8, comparable_count: 25, tension_level: 'high', tensionLevel: 'high' },
  });
  const firstNight = result.schedule[0];
  assert.ok(firstNight.breakdown.market !== 1, 'live market with high median must influence factor');
  assert.ok(firstNight.breakdown.marketConfidence !== null, 'confidence should be set when market is applied');
});

// ── PART 4: applyDynamicPricingForProperty + publisher integration ─────────────

console.log('\n── MF-20–MF-23 : apply → publisher guard (isMock + marketOverride) ──');

// Mock pricing-engine in cache BEFORE requiring apply
// (apply destructures priceProperty at require time)
let _pricePropertyImpl = null;
let _publishCalled     = false;
let _lastEngineOpts    = null;

require.cache[enginePath] = {
  id: enginePath, filename: enginePath, loaded: true,
  exports: {
    priceProperty: async (pool, opts) => {
      _lastEngineOpts = opts;
      return _pricePropertyImpl(pool, opts);
    },
    SCHOOL_HOLIDAYS_IDF_2025_2026: [],
    EVENTS_PARIS_2026: [],
  },
};

require.cache[publisherPath] = {
  id: publisherPath, filename: publisherPath, loaded: true,
  exports: {
    publishEffectivePricing: (pool, opts) => {
      _publishCalled = true;
      return Promise.resolve({ status: 'ok', rates: { count: 1, pushed: 1, error: null }, restrictions: { count: 1, pushed: 1, error: null } });
    },
  },
};

const { applyDynamicPricingForProperty } = require('../routes/pricing-apply');

const BASE_PROP_APPLY = {
  id: 'prop-a1', name: 'Test Apply', base_price: 100, weekend_price: null,
  channex_enabled: true, channex_property_id: 'cx-p', channex_room_type_id: 'cx-rt',
  channex_rate_plan_id: 'cx-rp', external_pricing: false,
};

function makeApplyPool() {
  return {
    async query(sql) {
      const s = sql.toLowerCase().trim();
      if (s.startsWith('create table') || s.startsWith('create index')) return { rows: [] };
      if (s.includes('from properties'))      return { rows: [BASE_PROP_APPLY] };
      if (s.includes('from pricing_history')) return { rows: [] };
      if (s.startsWith('insert') || s.startsWith('update')) return { rows: [], rowCount: 1 };
      throw new Error('ApplyPool inattendu: ' + sql.slice(0, 80));
    },
  };
}

function makeOnNight() {
  return async (pool, opts) => ({
    propertyId: opts.property.id,
    mode: 'auto', isActive: true, market: opts.marketOverride ?? null,
    rates:        [{ date: '2026-11-01', price: 100 }],
    restrictions: [{ date: '2026-11-01', min_stay: 1 }],
    schedule: [{
      date: '2026-11-01', price: 100, minStayArrival: 1, minStayThrough: 1,
      stopSell: false, booked: false, priceValid: true,
      breakdown: { market: 1, marketConfidence: null, pacing: 1, season: 1 },
    }],
  });
}

function makeCfg(overrides = {}) {
  return { user_id: 'u1', property_id: 'prop-a1', property_name: 'Test Apply', mode: 'auto', notify_push: false, ...overrides };
}

await test('MF-20 live_fresh (isMock=false, marketOverride=object) → publisher called', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  const mktObj = { median: 120, occupancy_rate: 0.7, tensionLevel: 'medium' };
  await applyDynamicPricingForProperty(makeApplyPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false,
    marketOverride: mktObj,
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, true, 'publisher must be called for live_fresh');
});

await test('MF-21 live_stale (isMock=false, marketOverride=null) → publisher called, null passed to engine', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  _lastEngineOpts = null;
  await applyDynamicPricingForProperty(makeApplyPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: false,
    marketOverride: null,
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, true, 'publisher must still be called for stale live');
  assert.ok(_lastEngineOpts && 'marketOverride' in _lastEngineOpts, 'marketOverride key must be forwarded to engine');
  assert.strictEqual(_lastEngineOpts.marketOverride, null, 'null marketOverride must reach engine');
});

await test('MF-22 mock (isMock=true, marketOverride=null) → publisher NOT called', async () => {
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  await applyDynamicPricingForProperty(makeApplyPool(), {
    cfg: makeCfg(), marketStats: {}, isMock: true,
    marketOverride: null,
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, false, 'publisher must NOT be called for mock');
});

await test('MF-23 marketOverride absent → forwarded as undefined to engine (B4-F: real engine would throw)', async () => {
  // B4-F: applyDynamicPricingForProperty always forwards marketOverride to priceProperty.
  // Absent caller → marketOverride=undefined forwarded → real priceProperty throws.
  // This test verifies the forwarding via mock (mock does not validate contract).
  _pricePropertyImpl = makeOnNight();
  _publishCalled = false;
  _lastEngineOpts = null;
  await applyDynamicPricingForProperty(makeApplyPool(), {
    cfg: makeCfg(), marketStats: null, isMock: false,
    // marketOverride intentionally absent
    sendPushNotification: null,
  });
  assert.strictEqual(_publishCalled, true, 'publisher still called via mock (real engine would have thrown)');
  assert.ok('marketOverride' in (_lastEngineOpts || {}), 'marketOverride key must now be forwarded to engine (as undefined)');
  assert.strictEqual(_lastEngineOpts.marketOverride, undefined, 'undefined marketOverride forwarded — real priceProperty would fail-closed');
});

// ── PART 5: booking recalc trigger ────────────────────────────────────────────

console.log('\n── MF-24–MF-25 : recalc trigger — P1.0-A bypass closed ──');

// Set up mocks for resolver and apply before requiring trigger
let _capturedApplyArgs = null;

require.cache[resolverPath] = {
  id: resolverPath, filename: resolverPath, loaded: true,
  exports: {
    resolveMarketData: async (pool, opts) => _resolverImpl(pool, opts),
    MARKET_TTL_DAYS: 14,
    MARKET_TTL_MS: 14 * 24 * 60 * 60 * 1000,
  },
};

require.cache[applyPath] = {
  id: applyPath, filename: applyPath, loaded: true,
  exports: {
    applyDynamicPricingForProperty: async (pool, opts) => {
      _capturedApplyArgs = opts;
      return { status: 'pending', nights: 1, pushed: 0 };
    },
    ensureScheduleTable: async () => {},
    upsertSchedule: async () => {},
  },
};

// require trigger AFTER mocks are set
const { schedulePricingRecalc } = require('../routes/pricing-recalc-trigger');

let _resolverImpl = null;

function makeTriggerPool() {
  return {
    async query(sql, params) {
      const s = sql.toLowerCase().trim();
      if (s.includes('from pricing_config')) {
        return { rows: [{ property_id: 'prop-t1', user_id: 'u1', mode: 'auto', is_active: true, property_name: 'Trigger Test' }] };
      }
      throw new Error('TriggerPool inattendu: ' + sql.slice(0, 80));
    },
  };
}

await test('MF-24 booking recalc with mock latest row → isMock=true, publisher blocked', async () => {
  _resolverImpl = async () => ({
    row: { median_price: 100, occupancy_rate: 0.6, tension_level: 'medium', data_source: 'mock' },
    status: 'mock', trusted: false, fresh: false, usable: false,
    ageMs: null, ageDays: null, market: null,
  });
  _capturedApplyArgs = null;

  schedulePricingRecalc(makeTriggerPool(), 'prop-t1', 'u1', { delayMs: 1 });
  await new Promise(r => setTimeout(r, 30));

  assert.ok(_capturedApplyArgs, 'applyDynamicPricingForProperty must have been called');
  assert.strictEqual(_capturedApplyArgs.isMock, true, 'isMock must be true for mock market');
  assert.strictEqual(_capturedApplyArgs.marketOverride, null, 'marketOverride must be null for mock');
});

await test('MF-25 booking recalc with stale live row → isMock=false, push allowed, market neutral', async () => {
  _resolverImpl = async () => ({
    row: { median_price: 110, occupancy_rate: 0.7, tension_level: 'medium', data_source: 'apify_live' },
    status: 'live_stale', trusted: true, fresh: false, usable: false,
    ageMs: 15 * 24 * 60 * 60 * 1000, ageDays: 15, market: null,
  });
  _capturedApplyArgs = null;

  schedulePricingRecalc(makeTriggerPool(), 'prop-t1', 'u1', { delayMs: 1 });
  await new Promise(r => setTimeout(r, 30));

  assert.ok(_capturedApplyArgs, 'applyDynamicPricingForProperty must have been called');
  assert.strictEqual(_capturedApplyArgs.isMock, false, 'stale live must not set isMock=true');
  assert.strictEqual(_capturedApplyArgs.marketOverride, null, 'marketOverride must be null for stale');
});

// ── Résumé ────────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n── Résultats : ${passed} passés / ${total} ──`);
if (failures.length > 0) {
  console.error('\nÉchecs :');
  for (const f of failures) console.error(`  ✗ ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);

})();

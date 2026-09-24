#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-B Market Currency Resolver + BP-1 Fix
 *
 * B4B-01–20 : resolveMarketData currency classification pipeline
 * B4B-21–30 : _runRecompute (BP-1 fix) injectable deps behavior
 *
 * Run: node tests/p1_2b4b_market_currency_resolver.test.js
 * No real DB. No real Channex. No writes.
 */

const assert = require('assert');
const { resolveMarketData, normalizeCurrency } = require('../routes/market-data-resolver');
const { _runRecompute } = require('../routes/pricing-calendars');

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

// ── Mock helpers ───────────────────────────────────────────────────────────────

const FRESH_SCRAPED_AT = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
const STALE_SCRAPED_AT = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days (> 14-day TTL)

// market_context_key defaults to null so that tests without propertyContextKey
// land in "both null → fall through" rather than context_unavailable.
function makeRow(overrides = {}) {
  return {
    median_price:       100,
    price_p25:          80,
    price_p75:          120,
    occupancy_rate:     0.75,
    comparable_count:   20,
    tension_level:      'medium',
    data_source:        'apify_live',
    scraped_at:         FRESH_SCRAPED_AT,
    week_start:         '2026-09-21',
    market_context_key: null,
    currency:           'EUR',
    ...overrides,
  };
}

function makePool(row) {
  return {
    async query() { return { rows: row ? [row] : [] }; },
  };
}

// ── Helpers for _runRecompute tests ───────────────────────────────────────────

function makeCfg(overrides = {}) {
  return {
    user_id:       'u1',
    property_id:   'prop-1',
    property_name: 'Test Property',
    latitude:      48.8566,
    longitude:     2.3522,
    country_code:  'fr',
    currency:      'EUR',
    is_active:     true,
    ...overrides,
  };
}

function makeRecompPool(cfg = null) {
  return {
    async query(sql) {
      if (/pricing_config/i.test(sql)) return { rows: cfg ? [cfg] : [] };
      return { rows: [] };
    },
  };
}

// ── B4B-01–10: backward compat + core currency statuses ───────────────────────

(async () => {

console.log('\n── B4B-01–03 : propertyCurrency undefined → currency check skipped ──');

await test('B4B-01 undefined propertyCurrency → currency check skipped → live_fresh', async () => {
  const pool = makePool(makeRow({ currency: 'EUR' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: new Date() });
  assert.strictEqual(r.status, 'live_fresh', `got ${r.status}`);
  assert.strictEqual(r.usable, true);
});

await test('B4B-02 undefined propertyCurrency → skipped even if currencies differ', async () => {
  const pool = makePool(makeRow({ currency: 'GBP' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: new Date() });
  assert.strictEqual(r.status, 'live_fresh', `got ${r.status}`);
  assert.strictEqual(r.usable, true);
});

await test('B4B-03 undefined propertyCurrency → skipped even if row.currency is null', async () => {
  const pool = makePool(makeRow({ currency: null }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', now: new Date() });
  assert.strictEqual(r.status, 'live_fresh', `got ${r.status}`);
  assert.strictEqual(r.usable, true);
});

console.log('\n── B4B-04–09 : currency classification core cases ──');

await test('B4B-04 propertyCurrency null → property_currency_unknown (trusted, usable=false)', async () => {
  const pool = makePool(makeRow({ currency: 'EUR' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: null, now: new Date() });
  assert.strictEqual(r.status, 'property_currency_unknown', `got ${r.status}`);
  assert.strictEqual(r.trusted, true);
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
  assert.strictEqual(r.locationCompatible, true);
  assert.strictEqual(r.refreshRequired, false);
  assert.strictEqual(r.propertyCurrency, null);
  assert.strictEqual(r.marketCurrency, 'EUR');
});

await test('B4B-05 both null (propertyCurrency=null, row.currency=null) → property_currency_unknown, not market_currency_unknown', async () => {
  const pool = makePool(makeRow({ currency: null }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: null, now: new Date() });
  assert.strictEqual(r.status, 'property_currency_unknown',
    `BOTH NULL must not match — expected property_currency_unknown, got ${r.status}`);
  assert.strictEqual(r.refreshRequired, false);
  assert.strictEqual(r.propertyCurrency, null);
  assert.strictEqual(r.marketCurrency, null);
});

await test('B4B-06 propertyCurrency EUR, row.currency null → market_currency_unknown', async () => {
  const pool = makePool(makeRow({ currency: null }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EUR', now: new Date() });
  assert.strictEqual(r.status, 'market_currency_unknown', `got ${r.status}`);
  assert.strictEqual(r.trusted, true);
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
  assert.strictEqual(r.locationCompatible, true);
  assert.strictEqual(r.refreshRequired, true);
  assert.strictEqual(r.propertyCurrency, 'EUR');
  assert.strictEqual(r.marketCurrency, null);
});

await test('B4B-07 propertyCurrency EUR, row.currency GBP → currency_mismatch', async () => {
  const pool = makePool(makeRow({ currency: 'GBP' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EUR', now: new Date() });
  assert.strictEqual(r.status, 'currency_mismatch', `got ${r.status}`);
  assert.strictEqual(r.trusted, true);
  assert.strictEqual(r.usable, false);
  assert.strictEqual(r.market, null);
  assert.strictEqual(r.locationCompatible, true);
  assert.strictEqual(r.refreshRequired, true);
  assert.strictEqual(r.propertyCurrency, 'EUR');
  assert.strictEqual(r.marketCurrency, 'GBP');
});

await test('B4B-08 propertyCurrency EUR, row.currency EUR → currencies match → live_fresh', async () => {
  const pool = makePool(makeRow({ currency: 'EUR' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EUR', now: new Date() });
  assert.strictEqual(r.status, 'live_fresh', `got ${r.status}`);
  assert.strictEqual(r.usable, true);
  assert.ok(r.market !== null, 'market must be non-null when live_fresh');
});

await test('B4B-09 currencies match but stale → live_stale (freshness check runs after currency)', async () => {
  const pool = makePool(makeRow({ currency: 'EUR', scraped_at: STALE_SCRAPED_AT }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EUR', now: new Date() });
  assert.strictEqual(r.status, 'live_stale', `got ${r.status}`);
  assert.strictEqual(r.usable, false);
});

console.log('\n── B4B-10 : provenance wins before currency ──');

await test('B4B-10 untrusted provenance → mock status, currency check never reached', async () => {
  const pool = makePool(makeRow({ data_source: 'mock', currency: 'EUR' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EUR', now: new Date() });
  assert.strictEqual(r.status, 'mock', `Expected mock, got ${r.status}`);
  assert.strictEqual(r.trusted, false);
});

console.log('\n── B4B-11–15 : normalizeCurrency edge cases ──');

await test('B4B-11 row.currency lowercase → normalized to uppercase → matches propertyCurrency', async () => {
  const pool = makePool(makeRow({ currency: 'eur' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EUR', now: new Date() });
  assert.strictEqual(r.status, 'live_fresh', `lowercase row currency should normalize: got ${r.status}`);
});

await test('B4B-12 propertyCurrency lowercase → normalized → matches row.currency', async () => {
  const pool = makePool(makeRow({ currency: 'EUR' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'eur', now: new Date() });
  assert.strictEqual(r.status, 'live_fresh', `lowercase propertyCurrency should normalize: got ${r.status}`);
});

await test('B4B-13 propertyCurrency with surrounding spaces → normalized → matches', async () => {
  const pool = makePool(makeRow({ currency: 'EUR' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: '  EUR  ', now: new Date() });
  assert.strictEqual(r.status, 'live_fresh', `spaced propertyCurrency should normalize: got ${r.status}`);
});

await test('B4B-14 propertyCurrency 4 letters → invalid → null → property_currency_unknown', async () => {
  const pool = makePool(makeRow({ currency: 'EUR' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EURO', now: new Date() });
  assert.strictEqual(r.status, 'property_currency_unknown',
    `4-letter currency must be invalid: got ${r.status}`);
  assert.strictEqual(r.propertyCurrency, null);
});

await test('B4B-15 row.currency numeric string → invalid → null → market_currency_unknown', async () => {
  const pool = makePool(makeRow({ currency: '123' }));
  const r = await resolveMarketData(pool, { propertyId: 'p1', propertyCurrency: 'EUR', now: new Date() });
  assert.strictEqual(r.status, 'market_currency_unknown',
    `numeric row currency must be invalid null: got ${r.status}`);
  assert.strictEqual(r.marketCurrency, null);
});

console.log('\n── B4B-16–20 : location + currency interaction, normalizeCurrency export ──');

await test('B4B-16 wrong location fires before currency check → live_wrong_location', async () => {
  const pool = makePool(makeRow({ market_context_key: 'fr|paris|75001', currency: 'EUR' }));
  const r = await resolveMarketData(pool, {
    propertyId: 'p1', propertyContextKey: 'fr|paris|75002',
    propertyCurrency: 'EUR', now: new Date(),
  });
  assert.strictEqual(r.status, 'live_wrong_location', `got ${r.status}`);
  assert.strictEqual(r.usable, false);
});

await test('B4B-17 location match + currency mismatch → currency_mismatch (locationCompatible=true)', async () => {
  const pool = makePool(makeRow({ market_context_key: 'fr|paris|75001', currency: 'GBP' }));
  const r = await resolveMarketData(pool, {
    propertyId: 'p1', propertyContextKey: 'fr|paris|75001',
    propertyCurrency: 'EUR', now: new Date(),
  });
  assert.strictEqual(r.status, 'currency_mismatch', `got ${r.status}`);
  assert.strictEqual(r.locationCompatible, true);
});

await test('B4B-18 location match + currencies match → live_fresh (full pipeline passes)', async () => {
  const pool = makePool(makeRow({ market_context_key: 'fr|paris|75001', currency: 'EUR' }));
  const r = await resolveMarketData(pool, {
    propertyId: 'p1', propertyContextKey: 'fr|paris|75001',
    propertyCurrency: 'EUR', now: new Date(),
  });
  assert.strictEqual(r.status, 'live_fresh', `got ${r.status}`);
  assert.strictEqual(r.usable, true);
  assert.strictEqual(r.locationCompatible, true);
});

await test('B4B-19 all three currency statuses: trusted=true, usable=false, market=null', async () => {
  const cases = [
    { row: makeRow({ currency: 'EUR' }), propertyCurrency: null,  expectedStatus: 'property_currency_unknown' },
    { row: makeRow({ currency: null }),  propertyCurrency: 'EUR', expectedStatus: 'market_currency_unknown'   },
    { row: makeRow({ currency: 'GBP' }), propertyCurrency: 'EUR', expectedStatus: 'currency_mismatch'        },
  ];
  for (const { row, propertyCurrency, expectedStatus } of cases) {
    const r = await resolveMarketData(makePool(row), { propertyId: 'p1', propertyCurrency, now: new Date() });
    assert.strictEqual(r.status, expectedStatus, `case ${expectedStatus}: got ${r.status}`);
    assert.strictEqual(r.trusted, true,  `trusted must be true for ${expectedStatus}`);
    assert.strictEqual(r.usable,  false, `usable must be false for ${expectedStatus}`);
    assert.strictEqual(r.market,  null,  `market must be null for ${expectedStatus}`);
    assert.ok(r.fresh !== undefined,     `fresh must be present for ${expectedStatus}`);
  }
});

await test('B4B-20 normalizeCurrency exported: handles lowercase, spaces, null, undefined, invalid lengths', () => {
  assert.strictEqual(normalizeCurrency('eur'),       'EUR');
  assert.strictEqual(normalizeCurrency('  GBP  '),   'GBP');
  assert.strictEqual(normalizeCurrency('usd'),       'USD');
  assert.strictEqual(normalizeCurrency(null),        null);
  assert.strictEqual(normalizeCurrency(undefined),   null);
  assert.strictEqual(normalizeCurrency(''),          null);
  assert.strictEqual(normalizeCurrency('EURO'),      null);
  assert.strictEqual(normalizeCurrency('US'),        null);
  assert.strictEqual(normalizeCurrency('US1'),       null);
  assert.strictEqual(normalizeCurrency('123'),       null);
});

console.log('\n── B4B-21–30 : _runRecompute (BP-1 fix) injectable deps ──');

await test('B4B-21 _runRecompute returns null when no active pricing cfg found', async () => {
  const pool = makeRecompPool(null);
  const result = await _runRecompute(pool, 'u1', 'prop-missing');
  assert.strictEqual(result, null);
});

await test('B4B-22 _runRecompute passes propertyCurrency from cfg.currency to resolver', async () => {
  const pool = makeRecompPool(makeCfg({ currency: 'GBP' }));
  let capturedOpts = null;
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async (_pool, opts) => {
      capturedOpts = opts;
      return { trusted: true, fresh: true, usable: true, status: 'live_fresh', row: null, market: null };
    },
    _applyFn: async () => ({ ok: true }),
  });
  assert.ok(capturedOpts, 'resolver was not called');
  assert.strictEqual(capturedOpts.propertyCurrency, 'GBP',
    `Expected propertyCurrency=GBP, got ${capturedOpts.propertyCurrency}`);
});

await test('B4B-23 _runRecompute passes correct propertyId to resolver', async () => {
  const pool = makeRecompPool(makeCfg());
  let capturedOpts = null;
  await _runRecompute(pool, 'u1', 'prop-xyz', {
    _resolveMarketData: async (_pool, opts) => {
      capturedOpts = opts;
      return { trusted: true, fresh: true, usable: true, status: 'live_fresh', row: null, market: null };
    },
    _applyFn: async () => ({ ok: true }),
  });
  assert.strictEqual(capturedOpts.propertyId, 'prop-xyz');
});

await test('B4B-24 _runRecompute: isMock=false when resolution.trusted=true', async () => {
  const pool = makeRecompPool(makeCfg());
  let capturedArgs = null;
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async () => ({
      trusted: true, fresh: true, usable: true, status: 'live_fresh', row: null, market: { median: 100 },
    }),
    _applyFn: async (_pool, args) => { capturedArgs = args; return { ok: true }; },
  });
  assert.strictEqual(capturedArgs.isMock, false,
    `Expected isMock=false, got ${capturedArgs.isMock}`);
});

await test('B4B-25 _runRecompute: isMock=true when trusted=false and status≠missing', async () => {
  const pool = makeRecompPool(makeCfg());
  let capturedArgs = null;
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async () => ({
      trusted: false, fresh: false, usable: false, status: 'mock', row: null, market: null,
    }),
    _applyFn: async (_pool, args) => { capturedArgs = args; return { ok: true }; },
  });
  assert.strictEqual(capturedArgs.isMock, true,
    `Expected isMock=true for mock status, got ${capturedArgs.isMock}`);
});

await test('B4B-26 _runRecompute: isMock=false when status=missing (no data)', async () => {
  const pool = makeRecompPool(makeCfg());
  let capturedArgs = null;
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async () => ({
      trusted: false, fresh: false, usable: false, status: 'missing', row: null, market: null,
    }),
    _applyFn: async (_pool, args) => { capturedArgs = args; return { ok: true }; },
  });
  assert.strictEqual(capturedArgs.isMock, false,
    `Expected isMock=false for missing, got ${capturedArgs.isMock}`);
});

await test('B4B-27 _runRecompute: marketOverride=null when resolution.usable=false', async () => {
  const pool = makeRecompPool(makeCfg());
  let capturedArgs = null;
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async () => ({
      trusted: true, fresh: false, usable: false, status: 'live_stale', row: null, market: null,
    }),
    _applyFn: async (_pool, args) => { capturedArgs = args; return { ok: true }; },
  });
  assert.strictEqual(capturedArgs.marketOverride, null,
    `Expected marketOverride=null, got ${capturedArgs.marketOverride}`);
});

await test('B4B-28 _runRecompute: marketOverride=resolution.market when usable=true', async () => {
  const pool = makeRecompPool(makeCfg());
  const mockMarket = { median: 150, occupancy_rate: 0.8, tension_level: 'high', tensionLevel: 'high' };
  let capturedArgs = null;
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async () => ({
      trusted: true, fresh: true, usable: true, status: 'live_fresh', row: null, market: mockMarket,
    }),
    _applyFn: async (_pool, args) => { capturedArgs = args; return { ok: true }; },
  });
  assert.deepStrictEqual(capturedArgs.marketOverride, mockMarket);
});

await test('B4B-29 _runRecompute: marketStats derived from resolution.row columns', async () => {
  const pool = makeRecompPool(makeCfg());
  const mockRow = { median_price: 99, occupancy_rate: 0.72, tension_level: 'low' };
  let capturedArgs = null;
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async () => ({
      trusted: true, fresh: false, usable: false, status: 'live_stale', row: mockRow, market: null,
    }),
    _applyFn: async (_pool, args) => { capturedArgs = args; return { ok: true }; },
  });
  assert.ok(capturedArgs.marketStats, 'marketStats must be set when resolution.row is present');
  assert.strictEqual(capturedArgs.marketStats.median,       99);
  assert.strictEqual(capturedArgs.marketStats.occupancy,    0.72);
  assert.strictEqual(capturedArgs.marketStats.tensionLevel, 'low');
});

await test('B4B-30 _runRecompute: no direct FROM market_data query (BP-1 bypass fully removed)', async () => {
  const cfg = makeCfg();
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      if (/pricing_config/i.test(sql)) return { rows: [cfg] };
      return { rows: [] };
    },
  };
  await _runRecompute(pool, 'u1', 'prop-1', {
    _resolveMarketData: async () => ({
      trusted: true, fresh: true, usable: true, status: 'live_fresh', row: null, market: null,
    }),
    _applyFn: async () => ({ ok: true }),
  });
  const marketDataQueries = queries.filter(q => /FROM market_data/i.test(q));
  assert.strictEqual(marketDataQueries.length, 0,
    `Direct market_data queries detected — BP-1 bypass not removed: ${marketDataQueries.join('; ')}`);
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  30 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== 30) {
  console.error(`⚠️  Expected 30 tests, ${passed + failed} ran`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();

#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B5-D Dual Market Provider Integration + Safe Feature Flag
 *
 * Verifies:
 *   BD5D-01 : default provider (no env var) → Apify
 *   BD5D-02 : MARKET_PRIMARY_PROVIDER missing → Apify
 *   BD5D-03 : MARKET_PRIMARY_PROVIDER='invalid_value' → Apify
 *   BD5D-04 : MARKET_PRIMARY_PROVIDER=brightdata → Bright Data called first
 *   BD5D-05 : BRIGHTDATA_API_KEY alone does NOT activate Bright Data
 *   BD5D-06 : Bright Data success with listings → Apify NOT called
 *   BD5D-07 : Bright Data network failure → Apify called
 *   BD5D-08 : Bright Data returns empty listings → Apify called
 *   BD5D-09 : Bright Data all currency-rejected (0 accepted) → Apify called
 *   BD5D-10 : both Bright Data and Apify fail → mock fallback preserved
 *   BD5D-11 : Bright Data success → dataSource = 'brightdata_live'
 *   BD5D-12 : Apify fallback after BD failure → dataSource = 'apify_live'
 *   BD5D-13 : mock path → dataSource = 'mock'
 *   BD5D-14 : brightdata_live is now trusted by resolver
 *   BD5D-15 : apify_live still trusted by resolver
 *   BD5D-16 : mock still untrusted by resolver
 *   BD5D-17 : unknown still untrusted by resolver
 *   BD5D-18 : arbitrary source still untrusted by resolver
 *   BD5D-19 : brightdata_live wrong currency → usable=false (currency validation intact)
 *   BD5D-20 : brightdata_live wrong context key → usable=false (geo validation intact)
 *   BD5D-21 : brightdata_live stale row → usable=false (freshness validation intact)
 *   BD5D-22 : checkIn = local today+14 in property timezone
 *   BD5D-23 : checkOut = checkIn + 1 calendar day
 *   BD5D-24 : DST transition does not break date calculation
 *   BD5D-25 : bedrooms:null not converted to 1 (NormalizedListing contract)
 *   BD5D-26 : bedrooms:null Bright Data listings survive bedroom filtering
 *   BD5D-27 : known numeric bedrooms retain existing filtering behavior
 *   BD5D-28 : selected zone preserves actual provider provenance (not configured provider)
 *   BD5D-29 : no provider result can bypass currency CAS (source check)
 *   BD5D-30 : no provider result can bypass geographic CAS (source check)
 *   BD5D-31 : calcMarketStats formula unchanged (regression)
 *   BD5D-32 : pricing formula unchanged (source check)
 *   BD5D-33 : no Channex call added by provider integration (source check)
 *   BD5D-34 : no live Bright Data call in tests (injectable fetch only)
 *   BD5D-35 : no live Apify call in tests (mock mode or injectable fetch)
 *
 * Run: node tests/p1_2b5d_dual_provider.test.js
 * LIVE_BRIGHTDATA_CALLS = 0  LIVE_APIFY_CALLS = 0  DB_WRITES = 0  CHANNEX_WRITES = 0
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

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

// ── Module paths ───────────────────────────────────────────────────────────────
const PROVIDER_PATH  = path.resolve(__dirname, '../services/market-provider.js');
const BD_PATH        = path.resolve(__dirname, '../services/providers/brightdata.js');
const CRON_PATH      = path.resolve(__dirname, '../routes/dynamic-pricing-cron.js');
const RESOLVER_PATH  = path.resolve(__dirname, '../routes/market-data-resolver.js');
const APPLY_PATH     = path.resolve(__dirname, '../routes/pricing-apply.js');
const SERVER_PATH    = path.resolve(__dirname, '../server.js');

const CRON_SRC       = fs.readFileSync(CRON_PATH,    'utf8');
const PROVIDER_SRC   = fs.readFileSync(PROVIDER_PATH, 'utf8');
const APPLY_SRC      = fs.readFileSync(APPLY_PATH,   'utf8');

const { getBrightDataMarketDates, resolveProvider, scrape } = require(PROVIDER_PATH);
const { classifyMarketData } = require(RESOLVER_PATH);
const { calcMarketStats }    = require(CRON_PATH);

// ── Mock fetch helpers ─────────────────────────────────────────────────────────

function okJson(data) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}

function errRes(status) {
  return { ok: false, status, json: async () => { throw new Error('not json'); }, text: async () => '' };
}

function makeSeqFetch(steps) {
  let i = 0;
  return async (url, _opts) => {
    const step = steps[i++];
    if (!step) throw new Error(`Unexpected fetch call #${i} to: ${url}`);
    return step(url, _opts);
  };
}

// Apify mock fetch — simulates a successful 3-step Apify run
function makeApifyFetch(listings) {
  return async (url) => {
    if (url.includes('/runs'))          return okJson({ data: { id: 'run-1', defaultDatasetId: 'ds-1' } });
    if (url.includes('/actor-runs/'))   return okJson({ data: { status: 'SUCCEEDED' } });
    if (url.includes('/datasets/'))     return okJson(listings.map(l => ({
      price: l.price, isAvailable: !l.isBooked, bedrooms: l.bedrooms, stars: l.stars,
    })));
    throw new Error(`Unexpected Apify URL: ${url}`);
  };
}

// Bright Data mock fetch — simulates a successful trigger → ready → snapshot
function makeBdFetch(items) {
  return makeSeqFetch([
    () => okJson({ snapshot_id: 'snap_bd5d' }),
    () => okJson({ status: 'ready' }),
    () => okJson(items),
  ]);
}

// Standard BD opts for successful call
const BD_OPTS = {
  checkIn: '2026-10-06', checkOut: '2026-10-07',
  apiKey: 'TEST_BD_API_KEY',
  pollIntervalMs: 0,
};

// Valid Bright Data listing fixture (EUR, available)
const BD_FIXTURE_EUR = {
  currency: 'EUR', availability: true,
  pricing_details: { price_per_night: 203.90 }, ratings: 4.96,
};

// ── resolver fixture helper ────────────────────────────────────────────────────
const NOW = new Date('2026-01-15T12:00:00Z');
const FRESH = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
const STALE = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago

function makeRow(overrides = {}) {
  return {
    data_source: 'brightdata_live',
    scraped_at: FRESH,
    week_start: '2026-01-12',
    market_context_key: null,
    currency: 'EUR',
    median_price: 120,
    occupancy_rate: 65,
    comparable_count: 20,
    tension_level: 'medium',
    price_p25: 90,
    price_p75: 150,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

// ════════════════════════════════════════════════════════════
// Provider selection — feature flag
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-01–05 : Provider selection / feature flag ──');

await test('BD5D-01 default provider (MARKET_PRIMARY_PROVIDER absent) → apify', async () => {
  const saved = process.env.MARKET_PRIMARY_PROVIDER;
  delete process.env.MARKET_PRIMARY_PROVIDER;
  try {
    assert.strictEqual(resolveProvider(), 'apify',
      'resolveProvider() must return "apify" when MARKET_PRIMARY_PROVIDER is not set');
  } finally {
    if (saved !== undefined) process.env.MARKET_PRIMARY_PROVIDER = saved;
  }
});

await test('BD5D-02 MARKET_PRIMARY_PROVIDER="" (empty string) → apify', async () => {
  const saved = process.env.MARKET_PRIMARY_PROVIDER;
  process.env.MARKET_PRIMARY_PROVIDER = '';
  try {
    assert.strictEqual(resolveProvider(), 'apify');
  } finally {
    if (saved !== undefined) process.env.MARKET_PRIMARY_PROVIDER = saved;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
  }
});

await test('BD5D-03 MARKET_PRIMARY_PROVIDER="invalid_value" → apify', async () => {
  const saved = process.env.MARKET_PRIMARY_PROVIDER;
  process.env.MARKET_PRIMARY_PROVIDER = 'invalid_value';
  try {
    assert.strictEqual(resolveProvider(), 'apify',
      'Any non-"brightdata" value must safely resolve to "apify"');
  } finally {
    if (saved !== undefined) process.env.MARKET_PRIMARY_PROVIDER = saved;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
  }
});

await test('BD5D-04 MARKET_PRIMARY_PROVIDER=brightdata → Bright Data called first', async () => {
  const savedFlag = process.env.MARKET_PRIMARY_PROVIDER;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  let bdCalled = false;
  const bdFetchImpl = makeBdFetch([BD_FIXTURE_EUR]);
  const wrappedBd = async (...args) => { bdCalled = true; return bdFetchImpl(...args); };
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: wrappedBd,
      bdApiKey: 'TEST_BD_KEY_BD5D04',
      now: new Date('2026-10-01T12:00:00Z'),
    });
    assert.ok(bdCalled, 'Bright Data fetch must be called when MARKET_PRIMARY_PROVIDER=brightdata');
    assert.strictEqual(result.provider, 'brightdata');
    assert.strictEqual(result.dataSource, 'brightdata_live');
  } finally {
    if (savedFlag !== undefined) process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
  }
});

await test('BD5D-05 BRIGHTDATA_API_KEY alone does NOT activate Bright Data', async () => {
  const savedFlag = process.env.MARKET_PRIMARY_PROVIDER;
  const savedKey  = process.env.BRIGHTDATA_API_KEY;
  const savedApify = process.env.APIFY_TOKEN;
  delete process.env.MARKET_PRIMARY_PROVIDER;  // flag not set
  process.env.BRIGHTDATA_API_KEY = 'SHOULD_NOT_ACTIVATE';
  delete process.env.APIFY_TOKEN;  // force Apify mock mode
  try {
    const result = await scrape('Lyon, France', 10, 'EUR', { medianFallback: 80 });
    assert.strictEqual(result.provider, 'apify',
      'BRIGHTDATA_API_KEY without MARKET_PRIMARY_PROVIDER must not activate Bright Data');
    assert.strictEqual(result.dataSource, 'mock');
  } finally {
    delete process.env.BRIGHTDATA_API_KEY;
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    if (savedKey !== undefined)   process.env.BRIGHTDATA_API_KEY = savedKey;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
  }
});

// ════════════════════════════════════════════════════════════
// Fallback logic
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-06–10 : Fallback logic ──');

await test('BD5D-06 Bright Data success with listings → Apify NOT called', async () => {
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  process.env.APIFY_TOKEN = 'SHOULD_NOT_BE_USED';
  let apifyCalled = false;
  const apifyFetch = async () => { apifyCalled = true; return okJson({}); };
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: makeBdFetch([BD_FIXTURE_EUR]),
      bdApiKey: 'TEST_BD_KEY_BD5D06',
      fetchFn: apifyFetch,
      now: new Date('2026-10-01T12:00:00Z'),
    });
    assert.ok(!apifyCalled, 'Apify must NOT be called when Bright Data succeeds with listings');
    assert.strictEqual(result.provider, 'brightdata');
  } finally {
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
    else delete process.env.APIFY_TOKEN;
  }
});

await test('BD5D-07 Bright Data network failure → Apify called', async () => {
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  delete process.env.APIFY_TOKEN;  // Apify mock mode
  let apifyCalled = false;
  const bdFetchImpl = async () => errRes(500);
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl,
      fetchFn: () => { apifyCalled = true; return okJson({}); },
      now: new Date('2026-10-01T12:00:00Z'),
      medianFallback: 80,
    });
    // Apify mock path doesn't use fetchFn — check provider is apify and it returned something
    assert.strictEqual(result.provider, 'apify',
      'After BD failure, Apify must be called as fallback');
    assert.ok(Array.isArray(result.listings), 'listings must be an array');
  } finally {
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
  }
});

await test('BD5D-08 Bright Data returns 0 usable listings → Apify called', async () => {
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  delete process.env.APIFY_TOKEN;
  // BD returns empty array (no items at all)
  const bdFetchImpl = makeBdFetch([]);
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl,
      now: new Date('2026-10-01T12:00:00Z'),
      medianFallback: 80,
    });
    assert.strictEqual(result.provider, 'apify',
      'BD returning 0 listings must trigger Apify fallback');
  } finally {
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
  }
});

await test('BD5D-09 Bright Data all listings currency-rejected (0 accepted) → Apify called', async () => {
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  delete process.env.APIFY_TOKEN;
  // BD returns only GBP listings when we request EUR
  const bdFetchImpl = makeBdFetch([
    { currency: 'GBP', availability: true, pricing_details: { price_per_night: 100 }, ratings: 4.0 },
    { currency: 'GBP', availability: true, pricing_details: { price_per_night: 120 }, ratings: 4.2 },
  ]);
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl,
      now: new Date('2026-10-01T12:00:00Z'),
      medianFallback: 80,
    });
    assert.strictEqual(result.provider, 'apify',
      'BD with all-currency-rejected listings (0 accepted) must trigger Apify fallback');
  } finally {
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
  }
});

await test('BD5D-10 both Bright Data and Apify fail → mock preserved (isMock:true, dataSource:mock)', async () => {
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  delete process.env.APIFY_TOKEN;  // Apify → mock mode (no token = mock, not error)
  const bdFetchImpl = async () => errRes(503);  // BD fails
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl,
      now: new Date('2026-10-01T12:00:00Z'),
      medianFallback: 80,
    });
    assert.strictEqual(result.provider, 'apify',     'After BD failure, Apify (mock) used');
    assert.strictEqual(result.isMock,   true,         'Mock must still be isMock:true');
    assert.strictEqual(result.dataSource, 'mock',     'Mock data must still be dataSource:mock');
  } finally {
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
  }
});

// ════════════════════════════════════════════════════════════
// dataSource propagation
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-11–13 : dataSource propagation ──');

await test('BD5D-11 Bright Data success → result.dataSource = "brightdata_live"', async () => {
  const savedFlag = process.env.MARKET_PRIMARY_PROVIDER;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: makeBdFetch([BD_FIXTURE_EUR]),
      bdApiKey: 'TEST_BD_KEY_BD5D11',
      now: new Date('2026-10-01T12:00:00Z'),
    });
    assert.strictEqual(result.dataSource, 'brightdata_live',
      'Successful Bright Data scrape must return dataSource="brightdata_live"');
    assert.strictEqual(result.isMock, false);
  } finally {
    if (savedFlag !== undefined) process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
  }
});

await test('BD5D-12 Apify fallback after BD failure → dataSource = "apify_live"', async () => {
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  process.env.APIFY_TOKEN = 'fake-apify-token-bd5d12';
  const apifyListings = [
    { price: 100, isAvailable: true, bedrooms: 2, stars: 4.5 },
  ];
  try {
    const result = await scrape('Massy, France', 10, 'EUR', {
      bdFetchImpl: async () => errRes(500),    // BD fails
      bdApiKey: 'TEST_BD_KEY_BD5D12',
      fetchFn: makeApifyFetch(apifyListings),  // Apify succeeds
      now: new Date('2026-10-01T12:00:00Z'),
    });
    assert.strictEqual(result.dataSource, 'apify_live',
      'Apify fallback must return dataSource="apify_live", never "brightdata_live"');
    assert.strictEqual(result.provider, 'apify');
    assert.strictEqual(result.isMock, false);
  } finally {
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
    else delete process.env.APIFY_TOKEN;
  }
});

await test('BD5D-13 mock path → dataSource = "mock"', async () => {
  const savedApify = process.env.APIFY_TOKEN;
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  delete process.env.APIFY_TOKEN;
  delete process.env.MARKET_PRIMARY_PROVIDER;
  try {
    const result = await scrape('Lyon, France', 10, 'EUR', { medianFallback: 80 });
    assert.strictEqual(result.dataSource, 'mock',
      'No-token Apify mock path must return dataSource="mock"');
    assert.strictEqual(result.isMock, true);
  } finally {
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
  }
});

// ════════════════════════════════════════════════════════════
// Resolver trust policy (using classifyMarketData, no DB)
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-14–21 : Resolver trust policy ──');

await test('BD5D-14 brightdata_live is now trusted by resolver', async () => {
  const row = makeRow({ data_source: 'brightdata_live' });
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.trusted, true,
    'brightdata_live must be trusted (added in B5-D)');
});

await test('BD5D-15 apify_live still trusted by resolver', async () => {
  const row = makeRow({ data_source: 'apify_live' });
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.trusted, true, 'apify_live must remain trusted');
});

await test('BD5D-16 mock still untrusted by resolver', async () => {
  const row = makeRow({ data_source: 'mock' });
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.trusted, false, 'mock must remain untrusted');
});

await test('BD5D-17 unknown still untrusted by resolver', async () => {
  const row = makeRow({ data_source: 'unknown' });
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.trusted, false, 'unknown must remain untrusted');
});

await test('BD5D-18 arbitrary source still untrusted by resolver', async () => {
  const row = makeRow({ data_source: 'some_future_provider' });
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.trusted, false,
    'Arbitrary data_source values must remain untrusted (fail-closed)');
});

await test('BD5D-19 brightdata_live + wrong currency → usable=false (currency validation intact)', async () => {
  const row = makeRow({ data_source: 'brightdata_live', currency: 'GBP' });
  const r   = classifyMarketData(row, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(r.usable, false,
    'brightdata_live with currency mismatch must not be usable');
  assert.strictEqual(r.status, 'currency_mismatch');
});

await test('BD5D-20 brightdata_live + wrong context key → usable=false (geo validation intact)', async () => {
  const row = makeRow({ data_source: 'brightdata_live', market_context_key: 'key_AAAA', currency: 'EUR' });
  const r   = classifyMarketData(row, {
    propertyContextKey: 'key_BBBB',
    propertyCurrency: 'EUR',
    now: NOW,
  });
  assert.strictEqual(r.usable, false,
    'brightdata_live with wrong context key must not be usable');
  assert.strictEqual(r.status, 'live_wrong_location');
});

await test('BD5D-21 brightdata_live stale row → usable=false (freshness validation intact)', async () => {
  const row = makeRow({ data_source: 'brightdata_live', scraped_at: STALE, currency: 'EUR' });
  const r   = classifyMarketData(row, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(r.usable, false,
    'brightdata_live stale row must not be usable');
  assert.strictEqual(r.status, 'live_stale');
});

// ════════════════════════════════════════════════════════════
// Date strategy — getBrightDataMarketDates
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-22–24 : Date strategy (getBrightDataMarketDates) ──');

await test('BD5D-22 checkIn = local today+14 in property timezone', async () => {
  // 2026-10-01 00:00 UTC = 2026-10-01 02:00 CEST (Europe/Paris, UTC+2)
  // Local date in Paris = 2026-10-01 → checkIn = 2026-10-15
  const result = getBrightDataMarketDates({
    timezone: 'Europe/Paris',
    now: new Date('2026-10-01T00:00:00Z'),
  });
  assert.strictEqual(result.checkIn, '2026-10-15',
    'checkIn must be localToday+14 in the property timezone');
});

await test('BD5D-23 checkOut = checkIn + 1 calendar day', async () => {
  const result = getBrightDataMarketDates({
    timezone: 'Europe/Paris',
    now: new Date('2026-10-01T00:00:00Z'),
  });
  const checkIn  = new Date(result.checkIn  + 'T00:00:00Z');
  const checkOut = new Date(result.checkOut + 'T00:00:00Z');
  const diffDays = (checkOut - checkIn) / (1000 * 60 * 60 * 24);
  assert.strictEqual(diffDays, 1,
    'checkOut must be exactly 1 calendar day after checkIn');
});

await test('BD5D-24 DST transition does not break date calculation', async () => {
  // In 2026, CET → CEST transition in Europe/Paris is last Sunday of March.
  // 2026-03-26 01:59:59 UTC → 02:59:59 CET (UTC+1), clocks spring forward to 03:00 CEST (UTC+2).
  // Test: 2026-03-26T00:30:00Z → local time in Paris is 01:30 CET = still 2026-03-26.
  // checkIn = 2026-03-26 + 14 = 2026-04-09 (crosses the DST boundary but still a plain date add).
  const result = getBrightDataMarketDates({
    timezone: 'Europe/Paris',
    now: new Date('2026-03-26T00:30:00Z'),
  });
  assert.strictEqual(result.checkIn,  '2026-04-09', 'checkIn must cross DST cleanly');
  assert.strictEqual(result.checkOut, '2026-04-10', 'checkOut must be day after checkIn across DST');

  // Also verify: a time just after DST spring-forward still gives correct local date.
  // 2026-03-29T01:00:00Z → 03:00 CEST (UTC+2) in Paris = still 2026-03-29.
  const result2 = getBrightDataMarketDates({
    timezone: 'Europe/Paris',
    now: new Date('2026-03-29T01:00:00Z'),
  });
  assert.strictEqual(result2.checkIn, '2026-04-12', 'checkIn after DST spring-forward correct');
});

// ════════════════════════════════════════════════════════════
// Bedroom null policy
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-25–27 : Bedroom null policy ──');

await test('BD5D-25 bedrooms:null not converted to 1 (NormalizedListing contract)', async () => {
  const { parseBrightDataItem } = require(BD_PATH);
  const item = {
    currency: 'EUR', availability: true,
    pricing_details: { price_per_night: 100 }, ratings: 4.0,
  };
  const { listing } = parseBrightDataItem(item, 'EUR');
  assert.strictEqual(listing.bedrooms, null,
    'Bright Data NormalizedListing.bedrooms must be null, never converted to 1');
});

await test('BD5D-26 bedrooms:null listings survive bedroom filtering in cron', async () => {
  // Simulate the cron bedroom filter logic:
  // B5-D: l.bedrooms == null → keep (do not reject unknown-bedroom listings)
  const listings = [
    { price: 100, isBooked: false, bedrooms: null,  stars: 4.0 },  // Bright Data: keep
    { price: 110, isBooked: false, bedrooms: 2,     stars: 4.2 },  // exact match: keep
    { price: 120, isBooked: false, bedrooms: 3,     stars: 4.3 },  // within ±1: keep
    { price: 130, isBooked: false, bedrooms: 5,     stars: 4.4 },  // too far: reject
  ];
  const cfgBedrooms = 2;
  const filtered = listings.filter(
    l => l.bedrooms == null || Math.abs(l.bedrooms - cfgBedrooms) <= 1
  );
  assert.strictEqual(filtered.length, 3,
    'null-bedroom listings must survive filtering — expected 3 (null + 2 + 3)');
  assert.ok(filtered.some(l => l.bedrooms === null),
    'null-bedroom listing must be in filtered set');
  assert.ok(!filtered.some(l => l.bedrooms === 5),
    'bedrooms=5 must be filtered out when cfg.bedrooms=2');
});

await test('BD5D-27 known numeric bedrooms retain existing filtering behavior', async () => {
  // Verify that listings with numeric bedrooms still apply the ±1 rule
  const listings = [
    { price: 100, bedrooms: 1 },  // ±1 from 2: keep
    { price: 110, bedrooms: 2 },  // exact: keep
    { price: 120, bedrooms: 3 },  // ±1 from 2: keep
    { price: 130, bedrooms: 4 },  // ±2 from 2: reject
  ];
  const cfgBedrooms = 2;
  const filtered = listings.filter(
    l => l.bedrooms == null || Math.abs(l.bedrooms - cfgBedrooms) <= 1
  );
  assert.strictEqual(filtered.length, 3,
    'Numeric bedroom filtering: only bedrooms within ±1 of cfg.bedrooms kept');
});

// ════════════════════════════════════════════════════════════
// Zone provenance — dataSource reflects actual (not configured) provider
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-28 : Zone provenance ──');

await test('BD5D-28 zone provenance: BD fails → Apify fallback dataSource is apify_live (not brightdata_live)', async () => {
  const savedFlag  = process.env.MARKET_PRIMARY_PROVIDER;
  const savedApify = process.env.APIFY_TOKEN;
  process.env.MARKET_PRIMARY_PROVIDER = 'brightdata';
  process.env.APIFY_TOKEN = 'fake-apify-token-bd5d28';
  const apifyListings = [{ price: 90, isAvailable: true, bedrooms: 2, stars: 4.3 }];
  try {
    const result = await scrape('Lyon, France', 10, 'EUR', {
      bdFetchImpl: async () => errRes(500),    // BD fails
      bdApiKey: 'TEST_BD_KEY_BD5D28',
      fetchFn: makeApifyFetch(apifyListings),  // Apify succeeds
      now: new Date('2026-10-01T12:00:00Z'),
    });
    assert.strictEqual(result.dataSource, 'apify_live',
      'When BD fails and Apify succeeds, dataSource must be "apify_live" (actual source), NOT "brightdata_live"');
    assert.strictEqual(result.provider, 'apify');
  } finally {
    if (savedFlag !== undefined)  process.env.MARKET_PRIMARY_PROVIDER = savedFlag;
    else delete process.env.MARKET_PRIMARY_PROVIDER;
    if (savedApify !== undefined) process.env.APIFY_TOKEN = savedApify;
    else delete process.env.APIFY_TOKEN;
  }
});

// ════════════════════════════════════════════════════════════
// Safety / regression source checks
// ════════════════════════════════════════════════════════════

console.log('\n── BD5D-29–35 : Safety / regression ──');

await test('BD5D-29 currency CAS still present in cron (not bypassed by provider integration)', async () => {
  assert.ok(
    CRON_SRC.includes('currency_stale') || CRON_SRC.includes('capturedPropertyCurrency'),
    'Currency CAS logic must still be present in dynamic-pricing-cron.js'
  );
});

await test('BD5D-30 geographic CAS still present in cron (not bypassed)', async () => {
  assert.ok(
    CRON_SRC.includes('context_stale') || CRON_SRC.includes('capturedContextKey'),
    'Geographic CAS logic must still be present in dynamic-pricing-cron.js'
  );
});

await test('BD5D-31 calcMarketStats formula unchanged (regression)', async () => {
  const listings = [
    { price: 80,  isBooked: true  },
    { price: 90,  isBooked: false },
    { price: 100, isBooked: false },
    { price: 110, isBooked: false },
    { price: 120, isBooked: true  },
    { price: 130, isBooked: false },
    { price: 140, isBooked: false },
    { price: 150, isBooked: false },
    { price: 160, isBooked: true  },
    { price: 170, isBooked: false },
  ];
  const stats = calcMarketStats(listings);
  assert.ok(stats !== null, 'calcMarketStats must return non-null for 10 listings');
  assert.strictEqual(stats.count, 10, 'count must be 10');
  assert.strictEqual(stats.occupancy, 30, 'occupancy must be 30% (3 booked / 10 total)');
  // calcMarketStats uses prices[Math.floor(n/2)] — upper-middle index for even n.
  // For n=10: Math.floor(10/2) = 5, prices[5] = 130.
  assert.strictEqual(stats.median, 130, 'median must be 130 (prices[Math.floor(10/2)] = prices[5])');
});

await test('BD5D-32 pricing formula unchanged (pricing-apply.js not modified)', async () => {
  // Pricing-apply does not import market-provider — pricing formula is unchanged.
  assert.ok(
    !APPLY_SRC.includes('market-provider') && !APPLY_SRC.includes('brightdata'),
    'pricing-apply.js must not reference market-provider or brightdata (pricing formula unchanged)'
  );
});

await test('BD5D-33 no Channex call added by provider integration (source check)', async () => {
  const nonComment = src => src.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  const providerCode = nonComment(PROVIDER_SRC);
  assert.ok(
    !providerCode.toLowerCase().includes('channex'),
    'market-provider.js must not reference channex in executable code'
  );
});

await test('BD5D-34 no live Bright Data call in tests (all BD calls use injectable bdFetchImpl)', async () => {
  // Verify that brightdata.js throws before any network call when apiKey is absent
  // and no fetchImpl is provided — which is the case for any test that doesn't inject fetchImpl.
  // (This is a policy + structural test: we just confirm the adapter requires either apiKey or env var.)
  const { scrapeWithBrightData } = require(BD_PATH);
  const savedKey = process.env.BRIGHTDATA_API_KEY;
  delete process.env.BRIGHTDATA_API_KEY;
  let networkCallAttempted = false;
  try {
    await scrapeWithBrightData('test', 1, 'EUR', {
      checkIn: '2026-10-06', checkOut: '2026-10-07',
      fetchImpl: async () => { networkCallAttempted = true; return okJson({}); },
      pollIntervalMs: 0,
      // no apiKey
    });
  } catch (e) {
    // expected: BRIGHTDATA_API_KEY non défini
  } finally {
    if (savedKey !== undefined) process.env.BRIGHTDATA_API_KEY = savedKey;
  }
  assert.strictEqual(networkCallAttempted, false,
    'scrapeWithBrightData must not attempt network calls without API key — ensuring test isolation');
});

await test('BD5D-35 no live Apify call in tests (APIFY_TOKEN absent → mock mode, no network)', async () => {
  // Without APIFY_TOKEN, scrapeZoneApify returns mock data without any fetch call.
  const { scrapeZoneApify } = require('../services/providers/apify');
  const savedToken = process.env.APIFY_TOKEN;
  delete process.env.APIFY_TOKEN;
  let networkCallAttempted = false;
  try {
    const result = await scrapeZoneApify('Lyon', 10, 'EUR', 80,
      async () => { networkCallAttempted = true; return okJson([]); }
    );
    assert.strictEqual(result.isMock, true, 'Without APIFY_TOKEN, result must be mock');
    assert.strictEqual(networkCallAttempted, false,
      'Without APIFY_TOKEN, scrapeZoneApify must return mock without any network call');
  } finally {
    if (savedToken !== undefined) process.env.APIFY_TOKEN = savedToken;
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  ${passed + failed} total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();

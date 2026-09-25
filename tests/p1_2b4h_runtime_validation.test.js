#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-H Runtime Validation Tool
 *
 * Verifies:
 *   RV-01 : preview → 0 Apify calls, 0 DB writes
 *   RV-02 : ambiguous target → abort
 *   RV-03 : missing currency → abort
 *   RV-04 : currency != EUR → abort
 *   RV-05 : missing geo → abort
 *   RV-06 : mock scrape → no market_data write
 *   RV-07 : live scrape → requestedCurrency = capturedPropertyCurrency
 *   RV-08 : context_stale → no write succeeds
 *   RV-09 : currency_stale → no write succeeds
 *   RV-10 : successful write → resolver live_fresh, PASS
 *   RV-11 : no pricing_schedule write in tool source
 *   RV-12 : no pricing_history write in tool source
 *   RV-13 : no UPDATE properties in tool source
 *   RV-14 : no pricing_config write in tool source
 *   RV-15 : no Channex function in tool source
 *
 * Run: node tests/p1_2b4h_runtime_validation.test.js
 * No real DB / Apify / Channex calls.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Runner ─────────────────────────────────────────────────────────────────────
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

// ── Tool under test ────────────────────────────────────────────────────────────
const TOOL_PATH = path.resolve(__dirname, '../outils/validate-market-currency-runtime.js');
const TOOL_SRC  = fs.readFileSync(TOOL_PATH, 'utf8');
const { resolveTarget, previewMode, executeMode, checkPropertyGuards } = require(TOOL_PATH);

// ── Mock helpers ───────────────────────────────────────────────────────────────

const VALID_PROPERTY = {
  id: 'prop-m6-uuid',
  name: 'M6',
  internal_name: 'M6',
  address: '10 rue de la Paix, 75001 Paris, France',
  property_currency: 'EUR',
  country_code: 'FR',
  latitude: '48.85',
  longitude: '2.35',
  channex_enabled: true,
  channex_rate_plan_id: 'rp-m6',
  is_active: true,
  mode: 'manual',
  user_id: 'user-m6',
  price_min: 60,
  price_max: 200,
  bedrooms: 1,
  zone_label: null,
};

// Compute the expected context key for VALID_PROPERTY
const { computeMarketContextKey } = require('../routes/market-context-key');
const EXPECTED_CTX_KEY = computeMarketContextKey({
  countryCode: 'FR', latitude: '48.85', longitude: '2.35'
});

function makeFreshMarketRow(overrides = {}) {
  return {
    id: 42,
    week_start: '2026-09-22',
    scraped_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    data_source: 'apify_live',
    currency: 'EUR',
    market_context_key: EXPECTED_CTX_KEY,
    median_price: 120,
    comparable_count: 25,
    occupancy_rate: 65,
    tension_level: 'elevated',
    zone_label: 'Paris, France',
    ...overrides,
  };
}

// Pool that distinguishes queries by SQL pattern
function makeMockPool({ targets = [], freshProp = null, freshMarket = null, writeCalls = [] } = {}) {
  const queryCalls = [];
  return {
    queryCalls,
    writeCalls,
    async query(sql, params) {
      queryCalls.push({ sql: sql.trim().slice(0, 80), params });
      const s = sql.toLowerCase();
      if (/ilike/.test(s))                             return { rows: targets };
      if (/p\.id\s*=.*user_id/.test(s))               return { rows: freshProp ? [freshProp] : [] };
      if (/from market_data/.test(s))                  return { rows: freshMarket ? [freshMarket] : [] };
      return { rows: [] };
    },
  };
}

function makeMockScrapeFn({ isMock, listingCount = 20, requestedCurrencyRecorder = null }) {
  return async function(zones, medianBase, maxListings, bedrooms, requestedCurrency) {
    if (requestedCurrencyRecorder) requestedCurrencyRecorder.value = requestedCurrency;
    if (isMock) return { listings: [], isMock: true, zoneUsed: zones[0] };
    const listings = Array.from({ length: listingCount }, (_, i) => ({
      price: 80 + i * 3,
      isBooked: i % 3 === 0,
      bedrooms: 1,
      stars: 4.5,
    }));
    return { listings, isMock: false, zoneUsed: zones[0] };
  };
}

function makeMockWriteFn(result) {
  return async function(pool, opts) {
    if (pool.writeCalls) pool.writeCalls.push(opts);
    return result;
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── RV-01 : preview → 0 Apify calls, 0 DB writes ──');

await test('RV-01 previewMode reads DB but makes no writes, no Apify calls', async () => {
  const writeCalls = [];
  const pool = makeMockPool({ targets: [VALID_PROPERTY], freshMarket: null, writeCalls });
  // previewMode doesn't call scrapeFn at all — verify by calling it with no inject and checking
  // the tool source: previewMode has no reference to scrapeBestZone
  const previewBody = TOOL_SRC.slice(
    TOOL_SRC.indexOf('async function previewMode'),
    TOOL_SRC.indexOf('async function executeMode')
  );
  assert.ok(!previewBody.includes('scrapeFn') && !previewBody.includes('scrapeBestZone'),
    'previewMode must not call scrapeFn or scrapeBestZone');

  // Runtime: call previewMode, verify pool.writeCalls empty
  const result = await previewMode(pool, { name: 'M6' });
  assert.ok(result.ok || result.targets === 1, 'previewMode should complete without error');
  assert.deepStrictEqual(writeCalls, [], 'previewMode must make zero writes');
});

console.log('\n── RV-02 : ambiguous target → abort ──');

await test('RV-02 executeMode aborts when 2 properties match --name', async () => {
  const two = [VALID_PROPERTY, { ...VALID_PROPERTY, id: 'prop-m6b', name: 'M6 bis' }];
  const pool = makeMockPool({ targets: two });
  const result = await executeMode(pool, { name: 'M6' });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/TARGET_COUNT=2/.test(result.abort), `expected TARGET_COUNT=2, got: ${result.abort}`);
});

console.log('\n── RV-03 : missing currency → abort ──');

await test('RV-03 checkPropertyGuards rejects null currency', async () => {
  const err = checkPropertyGuards({ ...VALID_PROPERTY, property_currency: null }, { requireCurrency: 'EUR' });
  assert.ok(err, 'should return error');
  assert.ok(/currency/i.test(err), `error should mention currency, got: ${err}`);
});

await test('RV-03b executeMode aborts when properties.currency is null', async () => {
  const pool = makeMockPool({ targets: [{ ...VALID_PROPERTY, property_currency: null }] });
  const result = await executeMode(pool, { name: 'M6' });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/currency/i.test(result.abort), `abort should mention currency: ${result.abort}`);
});

console.log('\n── RV-04 : currency != EUR → abort ──');

await test('RV-04 checkPropertyGuards rejects USD when EUR required', async () => {
  const err = checkPropertyGuards({ ...VALID_PROPERTY, property_currency: 'USD' }, { requireCurrency: 'EUR' });
  assert.ok(err, 'should return error');
  assert.ok(/EUR/.test(err) && /USD/.test(err), `error should mention EUR/USD, got: ${err}`);
});

await test('RV-04b executeMode aborts when currency is USD', async () => {
  const pool = makeMockPool({ targets: [{ ...VALID_PROPERTY, property_currency: 'USD' }] });
  const result = await executeMode(pool, { name: 'M6' });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/currency/i.test(result.abort), `abort: ${result.abort}`);
});

console.log('\n── RV-05 : missing geo → abort ──');

await test('RV-05 checkPropertyGuards rejects null latitude', async () => {
  const err = checkPropertyGuards({ ...VALID_PROPERTY, latitude: null }, { requireCurrency: 'EUR' });
  assert.ok(err, 'should return error');
  assert.ok(/geo|lat|context/i.test(err), `error should mention geo: ${err}`);
});

await test('RV-05b executeMode aborts when latitude is null', async () => {
  const pool = makeMockPool({ targets: [{ ...VALID_PROPERTY, latitude: null }] });
  const result = await executeMode(pool, { name: 'M6' });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/geo|lat|context/i.test(result.abort), `abort: ${result.abort}`);
});

console.log('\n── RV-06 : mock scrape → no market_data write ──');

await test('RV-06 executeMode aborts and makes no write when scrape returns isMock=true', async () => {
  const writeCalls = [];
  const pool = makeMockPool({ targets: [VALID_PROPERTY], freshProp: VALID_PROPERTY, writeCalls });
  const scrapeFn = makeMockScrapeFn({ isMock: true });
  const writeFn  = makeMockWriteFn({ written: true }); // should NEVER be called

  const result = await executeMode(pool, { name: 'M6' }, { scrapeFn, writeFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/MOCK_SCRAPE/.test(result.abort), `abort should mention MOCK_SCRAPE: ${result.abort}`);
  assert.deepStrictEqual(writeCalls, [], 'writeFn must NOT be called for mock scrape');
});

console.log('\n── RV-07 : live scrape → requestedCurrency = capturedPropertyCurrency ──');

await test('RV-07 scrapeFn is called with capturedPropertyCurrency = EUR', async () => {
  const writeCalls = [];
  const pool = makeMockPool({
    targets:     [VALID_PROPERTY],
    freshProp:   VALID_PROPERTY,
    freshMarket: makeFreshMarketRow(),
    writeCalls,
  });
  const recorder = { value: null };
  const scrapeFn = makeMockScrapeFn({ isMock: false, requestedCurrencyRecorder: recorder });
  const writeFn  = makeMockWriteFn({ written: true });

  await executeMode(pool, { name: 'M6' }, { scrapeFn, writeFn });
  assert.strictEqual(recorder.value, 'EUR',
    `scrapeFn must be called with EUR, got: ${recorder.value}`);
});

console.log('\n── RV-08 : context_stale → no write succeeds ──');

await test('RV-08 executeMode aborts when writeScrapeResult returns context_stale', async () => {
  const writeCalls = [];
  const pool = makeMockPool({ targets: [VALID_PROPERTY], freshProp: VALID_PROPERTY, writeCalls });
  const scrapeFn = makeMockScrapeFn({ isMock: false });
  const writeFn  = makeMockWriteFn({ written: false, reason: 'context_stale' });

  const result = await executeMode(pool, { name: 'M6' }, { scrapeFn, writeFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/context_stale/.test(result.abort), `abort: ${result.abort}`);
  assert.ok(result.writeResult && !result.writeResult.written,
    'writeResult must be present and not written');
});

console.log('\n── RV-09 : currency_stale → no write succeeds ──');

await test('RV-09 executeMode aborts when writeScrapeResult returns currency_stale', async () => {
  const writeCalls = [];
  const pool = makeMockPool({ targets: [VALID_PROPERTY], freshProp: VALID_PROPERTY, writeCalls });
  const scrapeFn = makeMockScrapeFn({ isMock: false });
  const writeFn  = makeMockWriteFn({ written: false, reason: 'currency_stale', capturedCurrency: 'EUR', currentCurrency: 'GBP' });

  const result = await executeMode(pool, { name: 'M6' }, { scrapeFn, writeFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/currency_stale/.test(result.abort), `abort: ${result.abort}`);
});

console.log('\n── RV-10 : successful write → resolver live_fresh, PASS ──');

await test('RV-10 full success: write OK + resolver live_fresh → VALIDATION_RESULT=PASS', async () => {
  const freshRow = makeFreshMarketRow();
  const writeCalls = [];
  const pool = makeMockPool({
    targets:     [VALID_PROPERTY],
    freshProp:   VALID_PROPERTY,
    freshMarket: freshRow,
    writeCalls,
  });
  const scrapeFn = makeMockScrapeFn({ isMock: false });
  const writeFn  = makeMockWriteFn({ written: true });

  const result = await executeMode(pool, { name: 'M6' }, { scrapeFn, writeFn });
  assert.ok(result.ok,                          'must succeed');
  assert.strictEqual(result.validationResult, 'PASS', 'VALIDATION_RESULT must be PASS');
  assert.strictEqual(result.checks.POST_DATA_SOURCE,     true, 'POST_DATA_SOURCE');
  assert.strictEqual(result.checks.POST_MARKET_CURRENCY, true, 'POST_MARKET_CURRENCY');
  assert.strictEqual(result.checks.POST_RESOLVER_STATUS, true, 'POST_RESOLVER_STATUS');
  assert.strictEqual(result.checks.POST_TRUSTED,         true, 'POST_TRUSTED');
  assert.strictEqual(result.checks.POST_FRESH,           true, 'POST_FRESH');
  assert.strictEqual(result.checks.POST_USABLE,          true, 'POST_USABLE');
  assert.strictEqual(result.checks.POST_MARKET_RETURNED, true, 'POST_MARKET_RETURNED');
  assert.strictEqual(result.checks.POST_CONTEXT_MATCH,   true, 'POST_CONTEXT_MATCH');
  assert.strictEqual(result.checks.POST_PROPERTY_CURRENCY, true, 'POST_PROPERTY_CURRENCY');
  assert.strictEqual(result.capturedPropertyCurrency, 'EUR', 'capturedPropertyCurrency');
});

console.log('\n── RV-11–15 : static safety — forbidden patterns in tool source ──');

await test('RV-11 tool source contains no pricing_schedule write', async () => {
  const nonComment = TOOL_SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /(INSERT\s+INTO|UPDATE)\s+pricing_schedule/i.test(l));
  assert.ok(!bad, 'tool must not write to pricing_schedule');
});

await test('RV-12 tool source contains no pricing_history write', async () => {
  const nonComment = TOOL_SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /(INSERT\s+INTO|UPDATE)\s+pricing_history/i.test(l));
  assert.ok(!bad, 'tool must not write to pricing_history');
});

await test('RV-13 tool source contains no UPDATE properties', async () => {
  const nonComment = TOOL_SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /UPDATE\s+properties/i.test(l));
  assert.ok(!bad, 'tool must not UPDATE properties table');
});

await test('RV-14 tool source contains no pricing_config write', async () => {
  const nonComment = TOOL_SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /INSERT.*pricing_config|UPDATE.*pricing_config/i.test(l));
  assert.ok(!bad, 'tool must not write pricing_config');
});

await test('RV-15 tool source does not import Channex functions', async () => {
  assert.ok(
    !TOOL_SRC.includes("require('../channex')") &&
    !TOOL_SRC.includes('require("../channex")') &&
    !/ applyDynamicPricingForProperty\s*\(/.test(TOOL_SRC) &&
    !/ priceProperty\s*\(/.test(TOOL_SRC) &&
    !/ publishEffectivePricing\s*\(/.test(TOOL_SRC),
    'tool must not import or call forbidden functions (channex, applyDynamic, priceProperty, publishEffective)'
  );
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  ${passed + failed} total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();

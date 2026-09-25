#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-H1 Schema Fix Regression
 *
 * Covers the production PREVIEW failure: "column pc.zone_label does not exist"
 * and the circular-dependency PREVIEW warning fix.
 *
 *   H1-01 : PROP_SELECT does not reference pc.zone_label
 *   H1-02 : PROP_SELECT only uses real production schema columns
 *   H1-03 : previewMode is DB-write-free (no INSERT/UPDATE/DELETE)
 *   H1-04 : previewMode never invokes scrapeBestZone
 *   H1-05 : previewMode never invokes writeScrapeResult
 *   H1-06 : executeMode still targets exactly one property
 *   H1-07 : executeMode still aborts on mock scrape
 *   H1-08 : executeMode still writes only through writeScrapeResult
 *   H1-09 : no pricing apply path can be reached from the tool
 *   H1-10 : no Channex require at module top-level (lazy require fix)
 *
 * Run: node tests/p1_2b4h1_schema_fix.test.js
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
const { previewMode, executeMode, checkPropertyGuards } = require(TOOL_PATH);

// ── Mock helpers (mirrors those in p1_2b4h_runtime_validation.test.js) ────────
const { computeMarketContextKey } = require('../routes/market-context-key');
const EXPECTED_CTX_KEY = computeMarketContextKey({ countryCode: 'FR', latitude: '48.85', longitude: '2.35' });

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
};

function makeMockPool({ targets = [], freshProp = null, freshMarket = null, writeCalls = [] } = {}) {
  return {
    writeCalls,
    async query(sql) {
      const s = sql.toLowerCase();
      if (/ilike/.test(s))                  return { rows: targets };
      if (/p\.id\s*=.*user_id/.test(s))     return { rows: freshProp ? [freshProp] : [] };
      if (/from market_data/.test(s))        return { rows: freshMarket ? [freshMarket] : [] };
      return { rows: [] };
    },
  };
}

function makeMockScrapeFn({ isMock }) {
  return async function(zones, medianBase, maxListings, bedrooms, requestedCurrency) {
    if (isMock) return { listings: [], isMock: true, zoneUsed: zones[0] };
    const listings = Array.from({ length: 20 }, (_, i) => ({ price: 80 + i * 3, isBooked: i % 3 === 0, bedrooms: 1, stars: 4.5 }));
    return { listings, isMock: false, zoneUsed: zones[0] };
  };
}

function makeMockWriteFn(result) {
  return async function(pool, opts) {
    if (pool.writeCalls) pool.writeCalls.push(opts);
    return result;
  };
}

function makeFreshMarketRow() {
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
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── H1-01 : PROP_SELECT does not reference pc.zone_label ──');

await test('H1-01 PROP_SELECT does not contain pc.zone_label', async () => {
  // Extract PROP_SELECT body from tool source
  const propSelectStart = TOOL_SRC.indexOf('const PROP_SELECT');
  const propSelectEnd   = TOOL_SRC.indexOf('`;', propSelectStart) + 2;
  const propSelectBody  = TOOL_SRC.slice(propSelectStart, propSelectEnd);
  assert.ok(
    !propSelectBody.includes('pc.zone_label') && !propSelectBody.includes('zone_label'),
    `PROP_SELECT must not reference zone_label (pricing_config has no such column). Got:\n${propSelectBody}`
  );
});

console.log('\n── H1-02 : PROP_SELECT only uses real production schema columns ──');

await test('H1-02 PROP_SELECT columns exist in pricing_config schema', async () => {
  // pricing_config known columns (from server.js schema)
  const KNOWN_PC_COLS = ['is_active', 'mode', 'user_id', 'price_min', 'price_max', 'bedrooms',
    'notify_push', 'notify_email', 'notify_alert', 'zone_lat', 'zone_lng', 'zone_radius_km',
    'property_type', 'created_at', 'updated_at', 'property_id', 'id'];
  const propSelectStart = TOOL_SRC.indexOf('const PROP_SELECT');
  const propSelectEnd   = TOOL_SRC.indexOf('`;', propSelectStart) + 2;
  const propSelectBody  = TOOL_SRC.slice(propSelectStart, propSelectEnd);

  // Extract all pc.xxx references
  const pcRefs = [...propSelectBody.matchAll(/pc\.(\w+)/g)].map(m => m[1]);
  const unknown = pcRefs.filter(col => !KNOWN_PC_COLS.includes(col));
  assert.deepStrictEqual(unknown, [],
    `PROP_SELECT references unknown pricing_config columns: ${unknown.join(', ')}`
  );
});

console.log('\n── H1-03 : previewMode is DB-write-free ──');

await test('H1-03 previewMode source contains no INSERT/UPDATE/DELETE statements', async () => {
  const previewStart = TOOL_SRC.indexOf('async function previewMode');
  const previewEnd   = TOOL_SRC.indexOf('async function executeMode');
  const previewBody  = TOOL_SRC.slice(previewStart, previewEnd);
  const nonComment   = previewBody.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /\b(INSERT|UPDATE|DELETE)\b/i.test(l));
  assert.ok(!bad, 'previewMode must not contain INSERT/UPDATE/DELETE SQL');
});

console.log('\n── H1-04 : previewMode never invokes scrapeBestZone ──');

await test('H1-04 previewMode source does not call scrapeBestZone', async () => {
  const previewStart = TOOL_SRC.indexOf('async function previewMode');
  const previewEnd   = TOOL_SRC.indexOf('async function executeMode');
  const previewBody  = TOOL_SRC.slice(previewStart, previewEnd);
  assert.ok(!previewBody.includes('scrapeBestZone'),
    'previewMode must not call scrapeBestZone');
});

console.log('\n── H1-05 : previewMode never invokes writeScrapeResult ──');

await test('H1-05 previewMode source does not call writeScrapeResult', async () => {
  const previewStart = TOOL_SRC.indexOf('async function previewMode');
  const previewEnd   = TOOL_SRC.indexOf('async function executeMode');
  const previewBody  = TOOL_SRC.slice(previewStart, previewEnd);
  assert.ok(!previewBody.includes('writeScrapeResult'),
    'previewMode must not call writeScrapeResult');
});

console.log('\n── H1-06 : executeMode targets exactly one property ──');

await test('H1-06 executeMode aborts when 0 properties match', async () => {
  const pool = makeMockPool({ targets: [] });
  const result = await executeMode(pool, { name: 'M6' });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/TARGET_COUNT=0/.test(result.abort), `expected TARGET_COUNT=0, got: ${result.abort}`);
});

await test('H1-06b executeMode aborts when 2 properties match', async () => {
  const pool = makeMockPool({ targets: [VALID_PROPERTY, { ...VALID_PROPERTY, id: 'prop-m6b' }] });
  const result = await executeMode(pool, { name: 'M6' });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/TARGET_COUNT=2/.test(result.abort), `expected TARGET_COUNT=2, got: ${result.abort}`);
});

console.log('\n── H1-07 : executeMode aborts on mock scrape ──');

await test('H1-07 executeMode aborts and makes no write when isMock=true', async () => {
  const writeCalls = [];
  const pool = makeMockPool({ targets: [VALID_PROPERTY], freshProp: VALID_PROPERTY, writeCalls });
  const scrapeFn = makeMockScrapeFn({ isMock: true });
  const writeFn  = makeMockWriteFn({ written: true });

  const result = await executeMode(pool, { name: 'M6' }, { scrapeFn, writeFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/MOCK_SCRAPE/.test(result.abort), `abort: ${result.abort}`);
  assert.deepStrictEqual(writeCalls, [], 'writeFn must NOT be called for mock scrape');
});

console.log('\n── H1-08 : executeMode writes only through writeScrapeResult ──');

await test('H1-08 executeMode uses injected writeFn (writeScrapeResult path)', async () => {
  const writeCalls = [];
  const pool = makeMockPool({
    targets:     [VALID_PROPERTY],
    freshProp:   VALID_PROPERTY,
    freshMarket: makeFreshMarketRow(),
    writeCalls,
  });
  const scrapeFn = makeMockScrapeFn({ isMock: false });
  const writeFn  = makeMockWriteFn({ written: true });

  const result = await executeMode(pool, { name: 'M6' }, { scrapeFn, writeFn });
  assert.ok(result.ok, 'must succeed');
  assert.strictEqual(writeCalls.length, 1, 'writeFn called exactly once');
  // Confirm the write opts include dataSource = apify_live (not a pricing table)
  assert.strictEqual(writeCalls[0].dataSource, 'apify_live', 'write must be apify_live market_data');
});

console.log('\n── H1-09 : no pricing apply path reachable from tool ──');

await test('H1-09 tool source does not call applyDynamicPricingForProperty', async () => {
  assert.ok(!/ applyDynamicPricingForProperty\s*\(/.test(TOOL_SRC),
    'tool must not call applyDynamicPricingForProperty');
});

console.log('\n── H1-10 : no Channex require at module top-level ──');

await test('H1-10 dynamic-pricing-cron is not required at module top level', async () => {
  // Scan only lines before the first 'async function' — the module top-level section
  const firstFnIdx = TOOL_SRC.indexOf('async function resolveTarget');
  const topLevel   = TOOL_SRC.slice(0, firstFnIdx);
  assert.ok(!topLevel.includes("require('../routes/dynamic-pricing-cron')"),
    'dynamic-pricing-cron must NOT be required at module top-level (must be lazy in executeMode)');
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

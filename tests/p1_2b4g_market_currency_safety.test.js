#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-G Market Currency Safety (Final Closure)
 *
 * Verifies:
 *   — classifyMarketData pure function exported and correct
 *   — dashboard API exposes propertyCurrency, market.currency,
 *     resolverStatus, usedForCalculation, refreshRequired
 *   — refreshRequired contract (true only for currency_mismatch / market_currency_unknown)
 *   — /market/:propertyId exposes per-row currency
 *   — no EUR fallback in classification paths
 *   — read-only diagnostic tool exists with DB_WRITES = 0
 *
 * Groups:
 *   B4G-01–05 : classifyMarketData pure function basics
 *   B4G-06–10 : classifyMarketData currency statuses
 *   B4G-11–14 : dashboard static — new fields in source
 *   B4G-15–17 : refreshRequired contract (runtime)
 *   B4G-18–20 : dashboard SQL checks (static)
 *   B4G-21–22 : /market/:propertyId currency (static)
 *   B4G-23–25 : classifyMarketData integration (static)
 *   B4G-26–28 : no EUR fallback in classification paths
 *   B4G-29–30 : diagnostic tool existence and write-safety
 *
 * Run: node tests/p1_2b4g_market_currency_safety.test.js
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

// ── Sources ────────────────────────────────────────────────────────────────────
const RESOLVER_SRC  = fs.readFileSync(path.resolve(__dirname, '../routes/market-data-resolver.js'), 'utf8');
const ROUTES_SRC    = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');
const DIAG_PATH     = path.resolve(__dirname, '../outils/audit-market-currency-consistency.js');

// ── Helpers for classifyMarketData runtime tests ───────────────────────────────
const NOW = new Date('2026-01-15T12:00:00Z');
const FRESH_SCRAPED_AT = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
const STALE_SCRAPED_AT = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago

function makeLiveFreshRow(overrides = {}) {
  return {
    data_source:         'apify_live',
    scraped_at:          FRESH_SCRAPED_AT,
    week_start:          '2026-01-12',
    market_context_key:  null,
    currency:            'EUR',
    median_price:        120,
    occupancy_rate:      65,
    comparable_count:    20,
    tension_level:       'medium',
    price_p25:           90,
    price_p75:           150,
    ...overrides,
  };
}

const { classifyMarketData } = require('../routes/market-data-resolver');

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── B4G-01–05 : classifyMarketData pure function basics ──');

await test('B4G-01 classifyMarketData is exported from market-data-resolver', async () => {
  assert.strictEqual(typeof classifyMarketData, 'function',
    'classifyMarketData must be a function exported from market-data-resolver');
});

await test('B4G-02 classifyMarketData(null, {}) → status missing, usable false', async () => {
  const r = classifyMarketData(null, {});
  assert.strictEqual(r.status, 'missing',  `expected 'missing', got '${r.status}'`);
  assert.strictEqual(r.usable, false,      'usable must be false for missing');
  assert.strictEqual(r.market, null,       'market must be null for missing');
  assert.strictEqual(r.trusted, false,     'trusted must be false for missing');
});

await test('B4G-03 classifyMarketData with data_source=mock → status mock, usable false', async () => {
  const row = makeLiveFreshRow({ data_source: 'mock' });
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.status, 'mock',  `expected 'mock', got '${r.status}'`);
  assert.strictEqual(r.usable, false,   'usable must be false for mock');
  assert.strictEqual(r.trusted, false,  'trusted must be false for mock');
});

await test('B4G-04 classifyMarketData live_fresh apify_live row → usable true, market non-null', async () => {
  const row = makeLiveFreshRow();
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.status, 'live_fresh', `expected 'live_fresh', got '${r.status}'`);
  assert.strictEqual(r.usable, true,         'usable must be true for live_fresh');
  assert.ok(r.market,                        'market must be non-null for live_fresh');
  assert.strictEqual(r.trusted, true,        'trusted must be true for live_fresh');
});

await test('B4G-05 classifyMarketData stale row → status live_stale, usable false', async () => {
  const row = makeLiveFreshRow({ scraped_at: STALE_SCRAPED_AT });
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.status, 'live_stale', `expected 'live_stale', got '${r.status}'`);
  assert.strictEqual(r.usable, false,        'usable must be false for live_stale');
  assert.strictEqual(r.market, null,         'market must be null for live_stale');
});

console.log('\n── B4G-06–10 : classifyMarketData currency statuses ──');

await test('B4G-06 property_currency_unknown (propertyCurrency=null) → refreshRequired false', async () => {
  const row = makeLiveFreshRow({ currency: 'EUR' });
  const r   = classifyMarketData(row, { propertyCurrency: null, now: NOW });
  assert.strictEqual(r.status, 'property_currency_unknown',
    `expected 'property_currency_unknown', got '${r.status}'`);
  assert.strictEqual(r.refreshRequired, false,
    'refreshRequired must be false for property_currency_unknown');
  assert.strictEqual(r.usable, false, 'usable must be false for property_currency_unknown');
});

await test('B4G-07 market_currency_unknown (market.currency=null, prop has currency) → refreshRequired true', async () => {
  const row = makeLiveFreshRow({ currency: null });
  const r   = classifyMarketData(row, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(r.status, 'market_currency_unknown',
    `expected 'market_currency_unknown', got '${r.status}'`);
  assert.strictEqual(r.refreshRequired, true,
    'refreshRequired must be true for market_currency_unknown');
  assert.strictEqual(r.usable, false, 'usable must be false for market_currency_unknown');
});

await test('B4G-08 currency_mismatch (prop=EUR, market=USD) → refreshRequired true, usable false', async () => {
  const row = makeLiveFreshRow({ currency: 'USD' });
  const r   = classifyMarketData(row, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(r.status, 'currency_mismatch',
    `expected 'currency_mismatch', got '${r.status}'`);
  assert.strictEqual(r.refreshRequired, true,   'refreshRequired must be true for mismatch');
  assert.strictEqual(r.usable,          false,  'usable must be false for currency_mismatch');
  assert.strictEqual(r.marketCurrency,  'USD',  'marketCurrency should be USD');
  assert.strictEqual(r.propertyCurrency,'EUR',  'propertyCurrency should be EUR');
});

await test('B4G-09 matching currencies (EUR/EUR) → live_fresh, usable true, no refreshRequired', async () => {
  const row = makeLiveFreshRow({ currency: 'EUR' });
  const r   = classifyMarketData(row, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(r.status, 'live_fresh', `expected 'live_fresh', got '${r.status}'`);
  assert.strictEqual(r.usable, true,         'usable must be true when currencies match and fresh');
  assert.ok(!r.refreshRequired,             'refreshRequired must be falsy for live_fresh');
});

await test('B4G-10 propertyCurrency omitted (undefined) → backward compat, currency check inactive', async () => {
  const row = makeLiveFreshRow({ currency: 'USD' });
  // No propertyCurrency passed — backward compat mode, no currency check
  const r   = classifyMarketData(row, { now: NOW });
  assert.strictEqual(r.status, 'live_fresh', `expected 'live_fresh', got '${r.status}'`);
  assert.strictEqual(r.usable, true,         'usable must be true when currency check inactive');
});

console.log('\n── B4G-11–14 : dashboard static — new fields in source ──');

await test('B4G-11 dashboard response includes propertyCurrency', async () => {
  assert.ok(
    /propertyCurrency\s*:/.test(ROUTES_SRC),
    'dashboard route must include propertyCurrency in the response map'
  );
});

await test('B4G-12 dashboard market object includes currency field', async () => {
  const dashStart = ROUTES_SRC.indexOf('GET /api/dynamic-pricing/dashboard');
  assert.ok(dashStart !== -1, 'dashboard route comment not found');
  // market object is ~4900 chars from the comment — use 6000 to be safe
  const dashBody  = ROUTES_SRC.slice(dashStart, dashStart + 6000);
  assert.ok(
    /currency\s*:.*market\.currency/.test(dashBody),
    'dashboard market object must include currency: market.currency'
  );
});

await test('B4G-13 dashboard market object includes resolverStatus', async () => {
  assert.ok(
    /resolverStatus\s*:/.test(ROUTES_SRC),
    'dashboard route must include resolverStatus in the market response'
  );
});

await test('B4G-14 dashboard market object includes usedForCalculation', async () => {
  assert.ok(
    /usedForCalculation\s*:/.test(ROUTES_SRC),
    'dashboard route must include usedForCalculation in the market response'
  );
});

console.log('\n── B4G-15–17 : refreshRequired contract (runtime) ──');

await test('B4G-15 refreshRequired false for live_fresh status', async () => {
  const row = makeLiveFreshRow({ currency: 'EUR' });
  const r   = classifyMarketData(row, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(r.status, 'live_fresh');
  // refreshRequired should be absent or false for live_fresh
  assert.ok(!r.refreshRequired, 'refreshRequired must not be true for live_fresh');
});

await test('B4G-16 refreshRequired true for currency_mismatch status', async () => {
  const row = makeLiveFreshRow({ currency: 'GBP' });
  const r   = classifyMarketData(row, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(r.status, 'currency_mismatch');
  assert.strictEqual(r.refreshRequired, true,
    'refreshRequired must be true for currency_mismatch');
});

await test('B4G-17 refreshRequired true for market_currency_unknown, false for property_currency_unknown', async () => {
  const freshRow = makeLiveFreshRow({ currency: null });
  const mcu = classifyMarketData(freshRow, { propertyCurrency: 'EUR', now: NOW });
  assert.strictEqual(mcu.status, 'market_currency_unknown');
  assert.strictEqual(mcu.refreshRequired, true,
    'refreshRequired must be true for market_currency_unknown');

  const pcu = classifyMarketData(makeLiveFreshRow({ currency: 'EUR' }), { propertyCurrency: null, now: NOW });
  assert.strictEqual(pcu.status, 'property_currency_unknown');
  assert.strictEqual(pcu.refreshRequired, false,
    'refreshRequired must be false for property_currency_unknown');
});

console.log('\n── B4G-18–20 : dashboard SQL checks (static) ──');

await test('B4G-18 configs query includes p.currency AS property_currency', async () => {
  assert.ok(
    /p\.currency\s+AS\s+property_currency/.test(ROUTES_SRC),
    'configs query must include p.currency AS property_currency'
  );
});

await test('B4G-19 markets DISTINCT ON query includes currency column', async () => {
  // Verify both currency and DISTINCT ON appear close together
  const distinctOnIdx = ROUTES_SRC.indexOf('DISTINCT ON (property_id)');
  assert.ok(distinctOnIdx !== -1, 'DISTINCT ON (property_id) not found in routes');
  const distinctBlock = ROUTES_SRC.slice(distinctOnIdx, distinctOnIdx + 500);
  assert.ok(
    /\bcurrency\b/.test(distinctBlock),
    'markets DISTINCT ON query must include currency column'
  );
});

await test('B4G-20 markets DISTINCT ON query includes market_context_key and data_source', async () => {
  const distinctOnIdx = ROUTES_SRC.indexOf('DISTINCT ON (property_id)');
  const distinctBlock = ROUTES_SRC.slice(distinctOnIdx, distinctOnIdx + 500);
  assert.ok(
    /market_context_key/.test(distinctBlock),
    'markets DISTINCT ON query must include market_context_key'
  );
  assert.ok(
    /data_source/.test(distinctBlock),
    'markets DISTINCT ON query must include data_source'
  );
});

console.log('\n── B4G-21–22 : /market/:propertyId currency (static) ──');

await test('B4G-21 /market/:propertyId SELECT includes currency column', async () => {
  // Use lastIndexOf — the route comment near the top would be found by indexOf
  const marketRouteIdx = ROUTES_SRC.lastIndexOf('market/:propertyId');
  assert.ok(marketRouteIdx !== -1, '/market/:propertyId route not found');
  const routeBody = ROUTES_SRC.slice(marketRouteIdx, marketRouteIdx + 2000);
  assert.ok(
    /\bcurrency\b/.test(routeBody),
    '/market/:propertyId SELECT must include currency column'
  );
});

await test('B4G-22 /market/:propertyId response map includes currency field', async () => {
  const marketRouteIdx = ROUTES_SRC.lastIndexOf('market/:propertyId');
  const routeBody      = ROUTES_SRC.slice(marketRouteIdx, marketRouteIdx + 2000);
  assert.ok(
    /currency\s*:.*s\.currency/.test(routeBody),
    '/market/:propertyId response must include currency: s.currency'
  );
});

console.log('\n── B4G-23–25 : classifyMarketData integration (static) ──');

await test('B4G-23 classifyMarketData is exported from market-data-resolver.js', async () => {
  assert.ok(
    /module\.exports\s*=\s*\{[^}]*classifyMarketData/.test(RESOLVER_SRC),
    'market-data-resolver.js must export classifyMarketData'
  );
});

await test('B4G-24 classifyMarketData is imported and called in dynamic-pricing-routes.js', async () => {
  assert.ok(
    /require\(['"]\.\/market-data-resolver['"]\)/.test(ROUTES_SRC) &&
    /classifyMarketData/.test(ROUTES_SRC),
    'dynamic-pricing-routes.js must import classifyMarketData from market-data-resolver'
  );
  assert.ok(
    /classifyMarketData\s*\(/.test(ROUTES_SRC),
    'classifyMarketData must be called in dynamic-pricing-routes.js'
  );
});

await test('B4G-25 usedForCalculation maps to classification.usable in dashboard', async () => {
  assert.ok(
    /usedForCalculation\s*:\s*classification\.usable/.test(ROUTES_SRC),
    'usedForCalculation must be assigned from classification.usable'
  );
});

console.log('\n── B4G-26–28 : no EUR fallback in classification paths ──');

await test('B4G-26 classifyMarketData never returns EUR as default currency', async () => {
  // With null property currency and null market currency — no EUR should appear
  const row = makeLiveFreshRow({ currency: null });
  const r   = classifyMarketData(row, { propertyCurrency: null, now: NOW });
  // property_currency_unknown — neither field should be EUR
  assert.notStrictEqual(r.propertyCurrency, 'EUR', 'propertyCurrency must not default to EUR');
  assert.notStrictEqual(r.marketCurrency,   'EUR', 'marketCurrency must not be EUR when market.currency is null');

  // Null row — also no EUR
  const r2 = classifyMarketData(null, { propertyCurrency: null, now: NOW });
  assert.strictEqual(r2.market, null, 'market must be null for missing row');
});

await test('B4G-27 market-data-resolver.js contains no ?? "EUR" or || "EUR" in classification logic', async () => {
  // Allowed: anything in comments. We check non-comment lines.
  const nonCommentLines = RESOLVER_SRC.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const hasEurFallback = nonCommentLines.some(l =>
    /\?\?\s*['"]EUR['"]/.test(l) || /\|\|\s*['"]EUR['"]/.test(l)
  );
  assert.ok(!hasEurFallback,
    'market-data-resolver.js must not use ?? "EUR" or || "EUR" fallback');
});

await test('B4G-28 dynamic-pricing-routes.js dashboard does not default currency to EUR', async () => {
  const dashStart = ROUTES_SRC.indexOf('GET /api/dynamic-pricing/dashboard');
  const dashBody  = ROUTES_SRC.slice(dashStart, dashStart + 5000);
  const nonCommentLines = dashBody.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const hasEurFallback = nonCommentLines.some(l =>
    /\?\?\s*['"]EUR['"]/.test(l) || /\|\|\s*['"]EUR['"]/.test(l)
  );
  assert.ok(!hasEurFallback,
    'dashboard route must not default currency to EUR via ?? "EUR" or || "EUR"');
});

console.log('\n── B4G-29–30 : diagnostic tool existence and write-safety ──');

await test('B4G-29 outils/audit-market-currency-consistency.js exists', async () => {
  assert.ok(
    fs.existsSync(DIAG_PATH),
    `Diagnostic tool not found at ${DIAG_PATH}`
  );
});

await test('B4G-30 diagnostic tool declares DB_WRITES = 0 and CHANNEX_WRITES = 0', async () => {
  const diagSrc = fs.readFileSync(DIAG_PATH, 'utf8');
  assert.ok(
    /DB_WRITES\s*=\s*0/.test(diagSrc),
    'Diagnostic tool must declare DB_WRITES = 0'
  );
  assert.ok(
    /CHANNEX_WRITES\s*=\s*0/.test(diagSrc),
    'Diagnostic tool must declare CHANNEX_WRITES = 0'
  );
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  30 total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();

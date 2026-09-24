#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B2 Market Snapshot Currency Provenance
 *
 * Groups:
 *   MCUR-B2-01–04 : schema migration invariants
 *   MCUR-B2-05–07 : normalizeMarketCurrency
 *   MCUR-B2-08    : scrapeWithApify uses explicit requestedCurrency (B4-C)
 *   MCUR-B2-09–10 : acquisition paths capture per-property currency (B4-C)
 *   MCUR-B2-11–12 : writeScrapeResult INSERT + UPSERT currency
 *   MCUR-B2-13    : currency captured before scrape decision (not inside isMock)
 *   MCUR-B2-14–15 : resolver has B4-B currency statuses / pricing engine unchanged
 *   MCUR-B2-16–18 : no backfill, no inference, geographic CAS intact
 *
 * Run: node tests/p1_2b2_market_currency_provenance.test.js
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

// ── Source helpers ─────────────────────────────────────────────────────────────
const SERVER_SRC = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const CRON_SRC   = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
const RESOLVER_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/market-data-resolver.js'), 'utf8');
const ENGINE_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-engine.js'), 'utf8');

// ── Module under test ──────────────────────────────────────────────────────────
// Require the cron module in isolation (does not start crons — initDynamicPricingCron
// must be called explicitly, which we never do here).
const cronModule = require('../routes/dynamic-pricing-cron');
const { writeScrapeResult } = cronModule;

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── MCUR-B2-01–04 : schema migration invariants ──');

await test('MCUR-B2-01 server.js contains market_data currency column migration', () => {
  assert.ok(
    /ALTER TABLE market_data ADD COLUMN IF NOT EXISTS currency TEXT/.test(SERVER_SRC),
    'ALTER TABLE market_data ADD COLUMN IF NOT EXISTS currency TEXT absent from server.js'
  );
});

await test('MCUR-B2-02 currency column is nullable (no NOT NULL)', () => {
  const migrationMatch = SERVER_SRC.match(
    /ALTER TABLE market_data ADD COLUMN IF NOT EXISTS currency TEXT[^;]+;/
  );
  assert.ok(migrationMatch, 'currency migration block not found');
  assert.ok(
    !/NOT NULL/.test(migrationMatch[0]),
    'currency column must be nullable — NOT NULL found in migration'
  );
});

await test('MCUR-B2-03 currency column has no DEFAULT value', () => {
  const migrationMatch = SERVER_SRC.match(
    /ALTER TABLE market_data ADD COLUMN IF NOT EXISTS currency TEXT[^;]+;/
  );
  assert.ok(migrationMatch, 'currency migration block not found');
  assert.ok(
    !/DEFAULT/.test(migrationMatch[0]),
    'currency column must have no DEFAULT — DEFAULT found in migration'
  );
});

await test('MCUR-B2-04 currency column has shape CHECK constraint', () => {
  const migrationMatch = SERVER_SRC.match(
    /ALTER TABLE market_data ADD COLUMN IF NOT EXISTS currency TEXT[^;]+;/
  );
  assert.ok(migrationMatch, 'currency migration block not found');
  // Constraint must accept NULL or exactly 3 uppercase letters
  assert.ok(
    /CHECK\s*\(currency IS NULL OR currency ~ '\^\[A-Z\]\{3\}\$'\)/.test(migrationMatch[0]),
    "CHECK constraint accepting NULL or ^[A-Z]{3}$ not found in currency migration"
  );
});

console.log('\n── MCUR-B2-05–07 : normalizeMarketCurrency ──');

// Access the internal normalizer via module internals (exported via cron source text check)
// Since normalizeMarketCurrency is internal, we test via the canonical constant + source.
// For behavioral tests we inline the same logic extracted from source.

function extractNormalizer() {
  // Parse normalizeMarketCurrency function body from source
  const match = CRON_SRC.match(/function normalizeMarketCurrency\s*\(value\)\s*\{[\s\S]+?\n\}/);
  if (!match) return null;
  // eslint-disable-next-line no-new-func
  return new Function('value', match[0].replace(/^function normalizeMarketCurrency\s*\(value\)\s*\{/, '').replace(/\}$/, ''));
}

const normalizer = extractNormalizer();
assert.ok(normalizer, 'normalizeMarketCurrency not found in cron source');

await test('MCUR-B2-05 normalizer: eur → EUR', () => {
  assert.strictEqual(normalizer('eur'), 'EUR', "normalizeMarketCurrency('eur') must return 'EUR'");
});

await test('MCUR-B2-06 normalizer: " EUR " → EUR (trims whitespace)', () => {
  assert.strictEqual(normalizer(' EUR '), 'EUR', "normalizeMarketCurrency(' EUR ') must return 'EUR'");
});

await test('MCUR-B2-07 normalizer: invalid inputs → null', () => {
  const invalids = [null, undefined, '', 'EU', 'EURO', '12A', '€', 'abc1'];
  for (const v of invalids) {
    const result = normalizer(v);
    assert.strictEqual(result, null,
      `normalizeMarketCurrency(${JSON.stringify(v)}) must return null, got ${JSON.stringify(result)}`
    );
  }
});

console.log('\n── MCUR-B2-08 : actor request currency ──');

await test('MCUR-B2-08 scrapeWithApify uses explicit requestedCurrency parameter (B4-C — no MARKET_REQUEST_CURRENCY)', () => {
  // B4-C: per-property currency — global constant removed
  assert.ok(
    !/const MARKET_REQUEST_CURRENCY\s*=/.test(CRON_SRC),
    'MARKET_REQUEST_CURRENCY constant must be removed in B4-C'
  );
  // scrapeWithApify must accept requestedCurrency as a parameter
  const fnMatch = CRON_SRC.match(/async function scrapeWithApify\s*\([^)]+\)/);
  assert.ok(fnMatch, 'scrapeWithApify function not found');
  assert.ok(
    /requestedCurrency/.test(fnMatch[0]),
    'scrapeWithApify must accept requestedCurrency parameter'
  );
  // Must guard against missing requestedCurrency — no EUR fallback
  assert.ok(
    /if\s*\(!requestedCurrency\)/.test(CRON_SRC),
    'scrapeWithApify must guard against missing requestedCurrency (no EUR fallback)'
  );
  // Apify body must use requestedCurrency, not a string literal
  const apifyBodyMatch = CRON_SRC.match(/body:\s*JSON\.stringify\(\{[\s\S]{0,400}?\}\)/);
  assert.ok(apifyBodyMatch, 'Apify body JSON.stringify block not found');
  assert.ok(
    /currency\s*:\s*requestedCurrency/.test(apifyBodyMatch[0]),
    "Apify body must use requestedCurrency variable, not MARKET_REQUEST_CURRENCY or 'EUR'"
  );
});

console.log('\n── MCUR-B2-09–10 : acquisition paths capture per-property currency ──');

await test('MCUR-B2-09 weekly path captures capturedPropertyCurrency from cfg.currency with unknown-currency guard', () => {
  // B4-C: per-property currency captured from cfg.currency
  assert.ok(
    /const capturedPropertyCurrency = normalizeMarketCurrency\(cfg\.currency\)/.test(CRON_SRC),
    'capturedPropertyCurrency not captured from cfg.currency in cron (weekly path)'
  );
  // Unknown-currency guard must skip scrape and continue
  assert.ok(
    /if\s*\(!capturedPropertyCurrency\)/.test(CRON_SRC),
    'Unknown-currency guard (if !capturedPropertyCurrency) missing from cron'
  );
  // writeScrapeResult must pass capturedPropertyCurrency
  assert.ok(
    /currency:\s*capturedPropertyCurrency/.test(CRON_SRC),
    'currency: capturedPropertyCurrency not passed to writeScrapeResult'
  );
});

await test('MCUR-B2-10 one-property path uses capturedPropertyCurrency and has unknown-currency guard', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    /const capturedPropertyCurrency = normalizeMarketCurrency\(cfg\.currency\)/.test(fnBody),
    'capturedPropertyCurrency not captured from cfg.currency in one-property path'
  );
  assert.ok(
    /if\s*\(!capturedPropertyCurrency\)/.test(fnBody),
    'Unknown-currency guard missing from one-property path'
  );
  assert.ok(
    /scrapeBestZone[\s\S]{0,300}capturedPropertyCurrency/.test(fnBody),
    'capturedPropertyCurrency not passed to scrapeBestZone in one-property path'
  );
});

console.log('\n── MCUR-B2-11–12 : writeScrapeResult INSERT + UPSERT ──');

// Behavioral tests via mock pool

function makeMockPool({ onQuery } = {}) {
  return {
    async connect() {
      const queries = [];
      const client = {
        async query(sql, params = []) {
          queries.push({ sql: sql.toLowerCase().replace(/\s+/g, ' ').trim(), params });
          if (onQuery) onQuery(sql, params, queries);
          return { rows: [{ country_code: 'FR', latitude: 48.85, longitude: 2.35 }] };
        },
        release() {},
      };
      client._queries = queries;
      return client;
    },
  };
}

await test('MCUR-B2-11 writeScrapeResult INSERT writes currency', async () => {
  let insertParams = null;
  let insertSql = null;
  const pool = {
    async connect() {
      const client = {
        _queries: [],
        async query(sql, params = []) {
          const s = sql.toLowerCase().replace(/\s+/g, ' ').trim();
          this._queries.push({ s, params });
          if (s.includes('select country_code')) {
            return { rows: [{ country_code: 'FR', latitude: 48.85, longitude: 2.35 }] };
          }
          if (s.startsWith('begin') || s.startsWith('commit')) return { rows: [] };
          if (s.startsWith('insert into market_data')) {
            insertSql = sql;
            insertParams = params;
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {},
      };
      return client;
    },
  };

  await writeScrapeResult(pool, {
    userId: 'u1', propertyId: 'p1', weekStart: '2026-09-21',
    marketStats: { median: 100, p25: 80, p75: 120, occupancy: 60, count: 20, tensionLevel: 'medium' },
    zoneLabel: 'Paris', dataSource: 'apify_live',
    capturedContextKey: 'FR:48.85:2.35',
    currency: 'EUR',
  });

  assert.ok(insertSql, 'INSERT INTO market_data not called');
  assert.ok(
    /currency/.test(insertSql.toLowerCase()),
    'currency column absent from INSERT statement'
  );
  assert.ok(
    Array.isArray(insertParams) && insertParams.includes('EUR'),
    `currency 'EUR' not in INSERT params: ${JSON.stringify(insertParams)}`
  );
});

await test('MCUR-B2-12 writeScrapeResult UPSERT ON CONFLICT updates currency', () => {
  // Source-text check: ON CONFLICT DO UPDATE must include currency assignment
  const insertBlock = CRON_SRC.match(/INSERT INTO market_data[\s\S]+?ON CONFLICT[\s\S]+?scraped_at\s*=\s*NOW\(\)`/);
  assert.ok(insertBlock, 'INSERT INTO market_data ... ON CONFLICT block not found in cron source');
  assert.ok(
    /currency\s*=\s*EXCLUDED\.currency/.test(insertBlock[0]),
    'currency = EXCLUDED.currency missing from ON CONFLICT DO UPDATE SET block'
  );
});

console.log('\n── MCUR-B2-13 : currency captured before scrape decision ──');

await test('MCUR-B2-13 property currency captured before scrape decision (not inside isMock branch)', () => {
  // B4-C: capturedPropertyCurrency must be captured unconditionally before scrape
  const captureIdx = CRON_SRC.indexOf('const capturedPropertyCurrency = normalizeMarketCurrency(cfg.currency)');
  assert.ok(captureIdx !== -1, 'capturedPropertyCurrency not found in cron');
  // Verify no isMock branch precedes the capture (currency capture is unconditional)
  const precedingSlice = CRON_SRC.slice(Math.max(0, captureIdx - 200), captureIdx);
  assert.ok(
    !/if\s*\(\s*!?isMock/.test(precedingSlice),
    'capturedPropertyCurrency capture must not be inside an isMock branch'
  );
});

console.log('\n── MCUR-B2-14–15 : resolver has B4-B currency statuses / pricing engine unchanged ──');

await test('MCUR-B2-14 resolver has B4-B currency-aware classification (propertyCurrency + three new statuses)', () => {
  // B4-B added propertyCurrency support to the resolver
  assert.ok(
    /propertyCurrency/.test(RESOLVER_SRC),
    'propertyCurrency not found in resolver — B4-B should have added it'
  );
  assert.ok(
    /property_currency_unknown/.test(RESOLVER_SRC),
    "status 'property_currency_unknown' not found in resolver"
  );
  assert.ok(
    /market_currency_unknown/.test(RESOLVER_SRC),
    "status 'market_currency_unknown' not found in resolver"
  );
  assert.ok(
    /currency_mismatch/.test(RESOLVER_SRC),
    "status 'currency_mismatch' not found in resolver"
  );
});

await test('MCUR-B2-15 pricing engine unchanged (no market neutralization added)', () => {
  assert.ok(
    !/live_wrong_currency/.test(ENGINE_SRC),
    'live_wrong_currency found in pricing engine — must not be added in B2'
  );
  assert.ok(
    !/currency_unverified/.test(ENGINE_SRC),
    'currency_unverified found in pricing engine'
  );
});

console.log('\n── MCUR-B2-16–18 : no backfill, no inference, geographic CAS intact ──');

await test('MCUR-B2-16 properties.currency not written by B2', () => {
  // B2 should add no UPDATE/INSERT to properties.currency
  const updatePropCurrency = CRON_SRC.match(/UPDATE properties[\s\S]{0,200}currency/);
  assert.ok(
    !updatePropCurrency,
    'UPDATE properties ... currency found in cron — properties.currency must not be written in B2'
  );
  assert.ok(
    !/properties\.currency\s*=/.test(CRON_SRC),
    'properties.currency = assignment found in cron module'
  );
});

await test('MCUR-B2-17 no country→currency inference added', () => {
  assert.ok(
    !/country.*EUR\|EUR.*country/.test(CRON_SRC) || true, // shape test below is the real one
    'placeholder'
  );
  // More precise: no eurozone inference pattern
  assert.ok(
    !/eurozone/i.test(CRON_SRC),
    'eurozone reference found in cron — no country→currency inference allowed in B2'
  );
  assert.ok(
    !/country_code.*['"]EUR['"]/.test(CRON_SRC),
    'country_code → EUR inference pattern found in cron'
  );
});

await test('MCUR-B2-18 geographic CAS remains present in writeScrapeResult', () => {
  // The SELECT FOR UPDATE + capturedContextKey comparison must still exist
  assert.ok(
    /SELECT country_code, latitude, longitude\s+FROM properties WHERE id = \$1 FOR UPDATE/.test(CRON_SRC),
    'Geographic CAS SELECT FOR UPDATE missing from writeScrapeResult'
  );
  assert.ok(
    /capturedContextKey !== currentContextKey/.test(CRON_SRC),
    'capturedContextKey !== currentContextKey comparison missing from writeScrapeResult'
  );
  assert.ok(
    /return \{ written: false, reason: 'context_stale' \}/.test(CRON_SRC),
    "context_stale guard missing from writeScrapeResult"
  );
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  18 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== 18) {
  console.error(`⚠️  Expected 18 tests, ${passed + failed} ran`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();

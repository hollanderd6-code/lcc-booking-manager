#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-D Currency Race-Safe Market Snapshot Write
 *
 * Verifies that writeScrapeResult performs a currency CAS check under the
 * same FOR UPDATE lock as the existing geographic CAS, preventing a stale-
 * currency snapshot from being written or reaching the pricing engine.
 *
 * Groups:
 *   B4D-01–02 : currency match → write succeeds
 *   B4D-03–06 : currency mismatch / null / invalid current → currency_stale
 *   B4D-07–08 : null / invalid captured → fail closed (currency_stale)
 *   B4D-09–11 : ordering: context_stale wins when both changed
 *   B4D-12    : no INSERT executed on currency rejection
 *   B4D-13–15 : one-property path: stale currency → marketOverride=null, BoostPrice continues
 *   B4D-16–17 : callers pass capturedPropertyCurrency to writeScrapeResult
 *   B4D-18    : zone cache reuse: per-property CAS, not cache-level
 *   B4D-19–20 : mock mode obeys same CAS
 *   B4D-21    : successful write stores capturedPropertyCurrency as currency column value
 *   B4D-22    : geographic CAS semantics unchanged
 *   B4D-23    : B4-C no-EUR-fallback still holds
 *   B4D-24    : B4-B resolver currency statuses still present
 *
 * Run: node tests/p1_2b4d_currency_cas_write.test.js
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

// ── Source ─────────────────────────────────────────────────────────────────────
const CRON_SRC     = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
const RESOLVER_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/market-data-resolver.js'), 'utf8');

// ── Module under test ──────────────────────────────────────────────────────────
const { writeScrapeResult, runDynamicPricingForOneProperty } = require('../routes/dynamic-pricing-cron');

// ── Pool helpers ───────────────────────────────────────────────────────────────
const KEY_FR  = 'FR:48.86:2.35';
const KEY_FR2 = 'FR:43.30:5.37';

function makeWritePool(propRow, { trackInsert = false } = {}) {
  let insertExecuted = false;
  let insertParams   = null;

  const pool = {
    getInsertExecuted: () => insertExecuted,
    getInsertParams:   () => insertParams,
    async connect() {
      const client = {
        async query(sql) {
          const s = sql.trim();
          if (/^BEGIN$/i.test(s) || /^COMMIT$/i.test(s) || /^ROLLBACK$/i.test(s)) return { rows: [] };
          if (/SELECT.*FROM properties.*FOR UPDATE/is.test(sql)) {
            return { rows: propRow ? [propRow] : [] };
          }
          if (/INSERT INTO market_data/i.test(sql)) {
            insertExecuted = true;
            // params come as second arg — re-route via the pool method below
            return { rows: [] };
          }
          throw new Error(`Unexpected query in B4D test: ${sql.slice(0, 60)}`);
        },
        // Overload to capture params
        release() {},
      };
      // Wrap query to capture params too
      const origQuery = client.query.bind(client);
      client.query = async function(sql, params) {
        if (/INSERT INTO market_data/i.test(sql)) {
          insertExecuted = true;
          insertParams   = params;
          return { rows: [] };
        }
        return origQuery(sql, params);
      };
      return client;
    },
  };
  return pool;
}

const BASE_ARGS = {
  userId: 'u1', propertyId: 'p1', weekStart: '2026-09-22',
  marketStats: { median: 120, p25: 90, p75: 150, occupancy: 0.7, count: 15, tensionLevel: 'medium' },
  zoneLabel: 'Paris', dataSource: 'apify_live',
  capturedContextKey: KEY_FR,
};

function makePropRow(overrides = {}) {
  return { country_code: 'FR', latitude: '48.856600', longitude: '2.352200', currency: 'EUR', ...overrides };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── B4D-01–02 : currency match → write succeeds ──');

await test('B4D-01 captured EUR + current EUR → written=true', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'EUR' }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, true, `Expected written:true, got: ${JSON.stringify(r)}`);
});

await test('B4D-02 captured GBP + current GBP → written=true', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'GBP' }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'GBP' });
  assert.strictEqual(r.written, true, `Expected written:true, got: ${JSON.stringify(r)}`);
});

console.log('\n── B4D-03–06 : currency mismatch / null / invalid current → currency_stale ──');

await test('B4D-03 captured EUR + current GBP → written=false, currency_stale', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'GBP' }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale', `Expected currency_stale, got: ${r.reason}`);
});

await test('B4D-04 captured GBP + current EUR → currency_stale', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'EUR' }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'GBP' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale');
});

await test('B4D-05 captured EUR + current NULL → currency_stale', async () => {
  const pool = makeWritePool(makePropRow({ currency: null }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale');
});

await test('B4D-06 captured EUR + current invalid string → currency_stale', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'INVALID' }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale');
});

console.log('\n── B4D-07–08 : null / invalid captured → fail closed ──');

await test('B4D-07 captured NULL (explicit) → fail closed (currency_stale)', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'EUR' }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: null });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale',
    'null capturedPropertyCurrency must fail closed, not allow write');
});

await test('B4D-08 captured invalid string → fail closed (normalizes to null → currency_stale)', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'EUR' }));
  // 'EU' is not valid ISO 4217 alpha-3 — normalizes to null
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EU' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale',
    'invalid capturedPropertyCurrency must fail closed');
});

console.log('\n── B4D-09–11 : check ordering ──');

await test('B4D-09 context changed, currency same → context_stale (not currency_stale)', async () => {
  // Property moved to FR2 during scrape; currency stayed EUR
  const pool = makeWritePool(makePropRow({ country_code: 'FR', latitude: '43.296300', longitude: '5.369800', currency: 'EUR' }));
  // capturedContextKey = KEY_FR, but current = KEY_FR2 (different city)
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  // KEY_FR (captured) ≠ KEY_FR2 (current) → context_stale must fire first
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'context_stale', `Expected context_stale, got: ${r.reason}`);
});

await test('B4D-10 context same, currency changed → currency_stale', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'GBP' }));
  // Geo unchanged (capturedContextKey = KEY_FR, current = PROP_FR → KEY_FR)
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale');
});

await test('B4D-11 context AND currency changed → context_stale wins (geographic first)', async () => {
  // Both geo and currency changed — geographic CAS runs first
  const pool = makeWritePool({ country_code: 'FR', latitude: '43.296300', longitude: '5.369800', currency: 'GBP' });
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'context_stale',
    'When both context and currency mismatch, context_stale must be returned first');
});

console.log('\n── B4D-12 : no INSERT executed on currency rejection ──');

await test('B4D-12 currency mismatch → no INSERT INTO market_data executed', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'GBP' }));
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'currency_stale');
  assert.strictEqual(pool.getInsertExecuted(), false,
    'INSERT INTO market_data must NOT be executed when currency CAS rejects');
});

console.log('\n── B4D-13–15 : one-property path: currency_stale → null market, BoostPrice continues ──');

await test('B4D-13 one-property currency_stale handler discards marketOverride (source text)', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  // Use 5000-char window — currency_stale handler appears near char 3000
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 5000);
  const guardIdx = fnBody.indexOf("reason === 'currency_stale'");
  assert.ok(guardIdx !== -1, "currency_stale branch not found in one-property rejection handler");
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 600);
  assert.ok(
    /marketOverride:\s*null/.test(guardBlock),
    'currency_stale handler must pass marketOverride: null to applyDynamicPricingForProperty'
  );
  assert.ok(
    /isMock:\s*false/.test(guardBlock),
    'currency_stale handler must pass isMock: false'
  );
});

await test('B4D-14 one-property currency_stale → returns ok:true, marketStats:null (source text)', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 5000);
  const guardIdx = fnBody.indexOf("reason === 'currency_stale'");
  assert.ok(guardIdx !== -1, "currency_stale branch missing from one-property path");
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 600);
  assert.ok(
    /return\s*\{[^}]*ok:\s*true/.test(guardBlock),
    'currency_stale handler must return { ok: true, ... }'
  );
  assert.ok(
    /marketStats:\s*null/.test(guardBlock),
    'currency_stale handler must return marketStats: null'
  );
});

await test('B4D-15 one-property currency_stale → applyDynamicPricingForProperty called (not skipped)', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 5000);
  const guardIdx = fnBody.indexOf("reason === 'currency_stale'");
  assert.ok(guardIdx !== -1, "currency_stale branch missing");
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 600);
  assert.ok(
    /applyDynamicPricingForProperty/.test(guardBlock),
    'BoostPrice (applyDynamicPricingForProperty) must still run after currency_stale rejection'
  );
});

console.log('\n── B4D-16–17 : callers pass capturedPropertyCurrency ──');

await test('B4D-16 weekly path passes capturedPropertyCurrency to writeScrapeResult', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 6000);
  assert.ok(
    /writeScrapeResult\([\s\S]{0,500}capturedPropertyCurrency/.test(fnBody),
    'weekly path must pass capturedPropertyCurrency to writeScrapeResult'
  );
});

await test('B4D-17 one-property path passes capturedPropertyCurrency to writeScrapeResult', () => {
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
  assert.ok(fnIdx !== -1, 'runDynamicPricingForOneProperty not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 3000);
  assert.ok(
    /writeScrapeResult\([\s\S]{0,500}capturedPropertyCurrency/.test(fnBody),
    'one-property path must pass capturedPropertyCurrency to writeScrapeResult'
  );
});

console.log('\n── B4D-18 : zone cache reuse: per-property CAS, not cache-level ──');

await test('B4D-18 per-property currency CAS is independent of zone cache (each property calls writeScrapeResult)', () => {
  // writeScrapeResult is called AFTER zone cache lookup — each property gets its own CAS.
  // Source text: writeScrapeResult call must be inside the for-loop body, after the cache check.
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  assert.ok(fnIdx !== -1, 'runDynamicPricingJob not found');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 6000);
  const cacheIdx  = fnBody.indexOf('if (!zoneCache[cacheKey])');
  const writeIdx  = fnBody.indexOf('writeScrapeResult(');
  assert.ok(cacheIdx !== -1, 'zone cache lookup not found in weekly path');
  assert.ok(writeIdx !== -1, 'writeScrapeResult call not found in weekly path');
  assert.ok(
    writeIdx > cacheIdx,
    'writeScrapeResult (per-property CAS) must come AFTER the shared zone cache lookup'
  );
});

console.log('\n── B4D-19–20 : mock mode obeys same CAS ──');

await test('B4D-19 mock snapshot obeys same currency CAS (no separate mock code path)', () => {
  // There must be no conditional that bypasses currency CAS for isMock=true.
  // The CAS runs on writeScrapeResult regardless of dataSource (mock/live).
  const fnIdx = CRON_SRC.indexOf('async function writeScrapeResult');
  const fnEnd = CRON_SRC.indexOf('\nmodule.exports', fnIdx);
  const fnSrc = CRON_SRC.slice(fnIdx, fnEnd);
  // Currency CAS must not be inside an "if (!isMock)" or "if (isMock === false)" guard
  const casIdx = fnSrc.indexOf('currency_stale');
  assert.ok(casIdx !== -1, 'currency_stale not found in writeScrapeResult');
  const precedingSlice = fnSrc.slice(Math.max(0, casIdx - 300), casIdx);
  assert.ok(
    !/if\s*\(\s*!?isMock/.test(precedingSlice),
    'Currency CAS must NOT be gated on isMock — same code path for mock and live'
  );
});

await test('B4D-20 mock result rejected by CAS → not used as marketOverride (source text)', () => {
  // After a currency_stale rejection, the weekly path continues (skipping the marketOverride/apply line).
  // Source: currency_stale branch in weekly loop must NOT reference `marketStats` as marketOverride value.
  const fnIdx = CRON_SRC.indexOf('async function runDynamicPricingJob');
  const fnBody = CRON_SRC.slice(fnIdx, fnIdx + 6000);
  const guardIdx = fnBody.indexOf("reason === 'currency_stale'");
  assert.ok(guardIdx !== -1, "currency_stale branch not found in weekly loop");
  const guardBlock = fnBody.slice(guardIdx, guardIdx + 1200);
  // The marketOverride in the currency_stale handler must be null, not marketStats
  assert.ok(
    /marketOverride:\s*null/.test(guardBlock),
    'weekly currency_stale handler must use marketOverride: null, not fresh marketStats'
  );
  assert.ok(
    !/marketOverride:\s*\{/.test(guardBlock),
    'weekly currency_stale handler must NOT construct a live marketOverride object'
  );
});

console.log('\n── B4D-21 : successful write stores capturedPropertyCurrency ──');

await test('B4D-21 successful write stores capturedPropertyCurrency as currency column value', async () => {
  const pool = makeWritePool(makePropRow({ currency: 'GBP' }));
  let insertParams = null;

  // Override the pool to capture INSERT params
  const origConnect = pool.connect.bind(pool);
  pool.connect = async function() {
    const client = await origConnect();
    const origQuery = client.query.bind(client);
    client.query = async function(sql, params) {
      if (/INSERT INTO market_data/i.test(sql)) { insertParams = params; return { rows: [] }; }
      return origQuery(sql, params);
    };
    return client;
  };

  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'GBP' });
  assert.strictEqual(r.written, true, `Expected written:true, got: ${JSON.stringify(r)}`);
  assert.ok(insertParams !== null, 'INSERT INTO market_data not executed');
  // currency is the 13th parameter (index 12)
  assert.ok(
    Array.isArray(insertParams) && insertParams.includes('GBP'),
    `'GBP' not found in INSERT params: ${JSON.stringify(insertParams)}`
  );
});

console.log('\n── B4D-22 : geographic CAS semantics unchanged ──');

await test('B4D-22 geographic CAS still returns context_stale for mismatched geo', async () => {
  // FR2 geo != captured FR key
  const pool = makeWritePool({ country_code: 'FR', latitude: '43.296300', longitude: '5.369800', currency: 'EUR' });
  const r = await writeScrapeResult(pool, { ...BASE_ARGS, capturedPropertyCurrency: 'EUR' });
  assert.strictEqual(r.written, false);
  assert.strictEqual(r.reason, 'context_stale');
  // Geographic CAS source text
  assert.ok(
    /capturedContextKey !== currentContextKey/.test(CRON_SRC),
    'Geographic CAS comparison must still exist in writeScrapeResult'
  );
});

console.log('\n── B4D-23–24 : B4-C and B4-B invariants still hold ──');

await test('B4D-23 B4-C no-EUR-fallback invariant still holds', () => {
  assert.ok(
    !/propertyCurrency\s*\|\|\s*['"]EUR['"]/.test(CRON_SRC),
    'EUR fallback via || still absent'
  );
  assert.ok(
    !/currency\s*\?\?\s*['"]EUR['"]/.test(CRON_SRC),
    'EUR fallback via ?? still absent'
  );
  assert.ok(
    !/requestedCurrency\s*\|\|\s*['"]EUR['"]/.test(CRON_SRC),
    'requestedCurrency EUR fallback still absent'
  );
  assert.ok(
    !/const MARKET_REQUEST_CURRENCY\s*=/.test(CRON_SRC),
    'MARKET_REQUEST_CURRENCY constant still absent'
  );
});

await test('B4D-24 B4-B resolver still has currency-aware classification (propertyCurrency + three statuses)', () => {
  assert.ok(/propertyCurrency/.test(RESOLVER_SRC), 'propertyCurrency still in resolver');
  assert.ok(/property_currency_unknown/.test(RESOLVER_SRC), 'property_currency_unknown still in resolver');
  assert.ok(/market_currency_unknown/.test(RESOLVER_SRC), 'market_currency_unknown still in resolver');
  assert.ok(/currency_mismatch/.test(RESOLVER_SRC), 'currency_mismatch still in resolver');
});

// ── Summary ────────────────────────────────────────────────────────────────────
const TOTAL = 24;
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  ${TOTAL} total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== TOTAL) {
  console.error(`⚠️  Expected ${TOTAL} tests, ${passed + failed} ran`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();

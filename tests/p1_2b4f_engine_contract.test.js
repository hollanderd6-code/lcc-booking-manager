#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-F Engine Contract
 *
 * Verifies that priceProperty:
 *   — fails closed when marketOverride is absent or undefined
 *   — accepts null (neutral) and valid market objects
 *   — performs ZERO market_data SQL queries after B4-F
 *   — does not import or call resolveMarketData
 *
 * And that every active priceProperty caller supplies explicit marketOverride.
 *
 * Groups:
 *   B4F-01–04 : engine contract: accepted / rejected inputs (runtime)
 *   B4F-05–08 : zero market_data SQL in all accepted states (runtime)
 *   B4F-09–10 : static: no market_data SELECT in engine; no resolver import
 *   B4F-11–14 : BP-2 weekly cron callers (static)
 *   B4F-15–18 : BP-3 one-property callers (static)
 *   B4F-19–20 : BP-4 daily recalculation callers (static)
 *   B4F-21–22 : reactive booking recalculation callers (static)
 *   B4F-23–24 : BP-1 recompute callers (static)
 *
 * Run: node tests/p1_2b4f_engine_contract.test.js
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
const ENGINE_SRC  = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-engine.js'), 'utf8');
const APPLY_SRC   = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-apply.js'), 'utf8');
const CRON_SRC    = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
const RECALC_SRC  = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-recalc-trigger.js'), 'utf8');
const CALENDARS_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-calendars.js'), 'utf8');

// ── Minimal pool mock for priceProperty runtime tests ─────────────────────────
// Returns pricing_config rows and reservations — never market_data.
function makeEnginePool({ queryMarketData = false } = {}) {
  const queriedTables = [];
  const pool = {
    _queriedTables: queriedTables,
    async query(sql, _params) {
      const s = sql.toLowerCase();
      if (/market_data/i.test(s)) {
        queriedTables.push('market_data');
        if (!queryMarketData) throw new Error('FORBIDDEN: priceProperty queried market_data');
        return { rows: [] };
      }
      if (/from pricing_config/.test(s)) {
        return { rows: [{ price_min: 30, price_max: 500, mode: 'manual', is_active: true }] };
      }
      if (/from reservations/.test(s)) {
        return { rows: [] };
      }
      throw new Error('Unexpected query: ' + sql.slice(0, 80));
    },
  };
  return pool;
}

const PROP = { id: 'p1', base_price: 100, weekend_price: null };
const USER_ID = 'u1';

// Load the real priceProperty (not mocked)
const { priceProperty } = require('../routes/pricing-engine');

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── B4F-01–04 : engine contract: accepted / rejected inputs ──');

await test('B4F-01 marketOverride=null succeeds (neutral market)', async () => {
  const pool = makeEnginePool();
  const result = await priceProperty(pool, {
    userId: USER_ID, property: PROP, marketOverride: null,
  });
  assert.ok(result, 'should return a result');
  assert.ok(Array.isArray(result.schedule), 'schedule should be array');
  assert.strictEqual(result.market, null, 'market should be null when marketOverride=null');
});

await test('B4F-02 marketOverride=object succeeds (market applied)', async () => {
  const pool = makeEnginePool();
  const market = { median: 120, comparable_count: 20, tension_level: 'elevated', occupancy_rate: 70 };
  const result = await priceProperty(pool, {
    userId: USER_ID, property: PROP, marketOverride: market,
  });
  assert.ok(result, 'should return a result');
  assert.ok(result.market, 'market should be present');
  assert.strictEqual(result.market.median, 120);
});

await test('B4F-03 marketOverride omitted → deterministic throw', async () => {
  const pool = makeEnginePool();
  await assert.rejects(
    () => priceProperty(pool, { userId: USER_ID, property: PROP }),
    (err) => {
      assert.ok(err.message.includes('explicit marketOverride'),
        `Expected explicit marketOverride error, got: ${err.message}`);
      return true;
    }
  );
});

await test('B4F-04 marketOverride=undefined → deterministic throw', async () => {
  const pool = makeEnginePool();
  await assert.rejects(
    () => priceProperty(pool, { userId: USER_ID, property: PROP, marketOverride: undefined }),
    (err) => {
      assert.ok(err.message.includes('explicit marketOverride'),
        `Expected explicit marketOverride error, got: ${err.message}`);
      return true;
    }
  );
});

console.log('\n── B4F-05–08 : zero market_data SQL in all accepted states ──');

await test('B4F-05 marketOverride omitted → ZERO market_data SQL (throws before query)', async () => {
  let marketDataQueried = false;
  const pool = {
    async query(sql) {
      if (/market_data/i.test(sql)) { marketDataQueried = true; return { rows: [] }; }
      if (/from pricing_config/.test(sql.toLowerCase())) return { rows: [{ price_min: 30, price_max: 500 }] };
      if (/from reservations/.test(sql.toLowerCase())) return { rows: [] };
      throw new Error('Unexpected: ' + sql.slice(0, 80));
    },
  };
  try {
    await priceProperty(pool, { userId: USER_ID, property: PROP });
  } catch (_) {}
  assert.ok(!marketDataQueried, 'market_data must NOT be queried even in the error path');
});

await test('B4F-06 marketOverride=undefined → ZERO market_data SQL', async () => {
  let marketDataQueried = false;
  const pool = {
    async query(sql) {
      if (/market_data/i.test(sql)) { marketDataQueried = true; return { rows: [] }; }
      if (/from pricing_config/.test(sql.toLowerCase())) return { rows: [{ price_min: 30, price_max: 500 }] };
      if (/from reservations/.test(sql.toLowerCase())) return { rows: [] };
      throw new Error('Unexpected: ' + sql.slice(0, 80));
    },
  };
  try {
    await priceProperty(pool, { userId: USER_ID, property: PROP, marketOverride: undefined });
  } catch (_) {}
  assert.ok(!marketDataQueried, 'market_data must NOT be queried for undefined marketOverride');
});

await test('B4F-07 marketOverride=null → ZERO market_data SQL', async () => {
  const pool = makeEnginePool(); // throws if market_data queried
  await priceProperty(pool, { userId: USER_ID, property: PROP, marketOverride: null });
  assert.deepStrictEqual(pool._queriedTables, [], 'market_data must never be queried');
});

await test('B4F-08 marketOverride=object → ZERO market_data SQL', async () => {
  const pool = makeEnginePool(); // throws if market_data queried
  const market = { median: 100, comparable_count: 15, tension_level: 'medium', occupancy_rate: 55 };
  await priceProperty(pool, { userId: USER_ID, property: PROP, marketOverride: market });
  assert.deepStrictEqual(pool._queriedTables, [], 'market_data must never be queried');
});

console.log('\n── B4F-09–10 : static engine assertions ──');

await test('B4F-09 pricing-engine.js contains no active SELECT FROM market_data in priceProperty', async () => {
  // Find priceProperty body (from function declaration to end of module)
  const fnStart = ENGINE_SRC.indexOf('async function priceProperty(');
  assert.ok(fnStart !== -1, 'priceProperty not found');
  const fnBody = ENGINE_SRC.slice(fnStart, fnStart + 3000);
  // The query must not exist (only in a comment is acceptable)
  const lines = fnBody.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const hasMarketDataQuery = lines.some(l => /FROM\s+market_data/i.test(l));
  assert.ok(!hasMarketDataQuery, 'Active SELECT FROM market_data found in priceProperty body');
});

await test('B4F-10 pricing-engine.js does not import or call resolveMarketData', async () => {
  assert.ok(
    !ENGINE_SRC.includes('resolveMarketData'),
    'pricing-engine.js must not import or reference resolveMarketData'
  );
});

console.log('\n── B4F-11–14 : BP-2 weekly cron callers ──');

await test('B4F-11 BP-2 unknown currency path passes marketOverride: null', async () => {
  // Guard: capturedPropertyCurrency falsy → marketOverride: null
  assert.match(
    CRON_SRC,
    /capturedPropertyCurrency[\s\S]{0,400}marketOverride:\s*null/,
    'BP-2 unknown currency path must pass marketOverride: null to applyDynamicPricingForProperty'
  );
});

await test('B4F-12 BP-2 currency_stale path passes marketOverride: null', async () => {
  assert.match(
    CRON_SRC,
    /currency_stale[\s\S]{0,400}marketOverride:\s*null/,
    'BP-2 currency_stale path must pass marketOverride: null'
  );
});

await test('B4F-13 BP-2 context_stale path continues without applyDynamic call', async () => {
  // context_stale → continue (skip); does NOT call applyDynamicPricingForProperty
  assert.match(
    CRON_SRC,
    /contexte géo changé[\s\S]{0,200}continue/,
    'BP-2 context_stale path must continue without calling apply'
  );
});

await test('B4F-14 BP-2 fresh scrape success passes explicit marketOverride (null or object)', async () => {
  // After successful write: marketOverride = isMock ? null : { ... }
  assert.match(
    CRON_SRC,
    /marketOverride\s*=\s*isMock\s*\?\s*null\s*:\s*\{/,
    'BP-2 fresh scrape must build explicit marketOverride (null or object)'
  );
});

console.log('\n── B4F-15–18 : BP-3 one-property callers ──');

// Extract BP-3 (runDynamicPricingForOneProperty) body — find it after BP-2
const BP3_START = CRON_SRC.indexOf('async function runDynamicPricingForOneProperty');
assert.ok(BP3_START !== -1, 'runDynamicPricingForOneProperty not found');
const BP3_BODY = CRON_SRC.slice(BP3_START, BP3_START + 5500);

await test('B4F-15 BP-3 fresh scrape success passes explicit marketOverride (null or object)', async () => {
  assert.match(
    BP3_BODY,
    /marketOverride\s*=\s*isMock\s*\?\s*null\s*:\s*\{/,
    'BP-3 fresh scrape must build explicit marketOverride'
  );
});

await test('B4F-16 BP-3 unknown currency passes marketOverride: null', async () => {
  assert.match(
    BP3_BODY,
    /capturedPropertyCurrency[\s\S]{0,400}marketOverride:\s*null/,
    'BP-3 unknown currency path must pass marketOverride: null'
  );
});

await test('B4F-17 BP-3 context_stale returns error without applying pricing', async () => {
  // Pattern: "contexte géo changé" log then return { ok: false, error: 'context_stale' }
  assert.match(
    BP3_BODY,
    /contexte.*géo[\s\S]{0,200}return\s*\{\s*ok:\s*false/,
    'BP-3 context_stale must return { ok: false } without calling applyDynamicPricingForProperty'
  );
});

await test('B4F-18 BP-3 currency_stale passes marketOverride: null', async () => {
  assert.match(
    BP3_BODY,
    /currency_stale[\s\S]{0,400}marketOverride:\s*null/,
    'BP-3 currency_stale path must pass marketOverride: null'
  );
});

console.log('\n── B4F-19–20 : BP-4 daily recalculation callers ──');

// Find runDailyPricingRefresh (BP-4 daily recalculation)
const DAILY_START = CRON_SRC.indexOf('async function runDailyPricingRefresh');
assert.ok(DAILY_START !== -1, 'runDailyPricingRefresh not found');
const DAILY_BODY = CRON_SRC.slice(DAILY_START, DAILY_START + 6000);

await test('B4F-19 daily recalculation uses resolver and passes resolver.market as marketOverride', async () => {
  assert.ok(
    DAILY_BODY.includes('resolveMarketData'),
    'daily recalc must call resolveMarketData'
  );
  assert.ok(
    DAILY_BODY.includes('resolution.market'),
    'daily recalc must pass resolution.market as marketOverride'
  );
  assert.match(
    DAILY_BODY,
    /marketOverride:\s*resolution\.market/,
    'marketOverride: resolution.market assignment not found in daily recalc'
  );
});

await test('B4F-20 daily recalculation does not query market_data directly for pricing', async () => {
  // The only FROM market_data allowed in the entire cron file is the skip-check SELECT 1
  // We check the daily body specifically
  const lines = DAILY_BODY.split('\n').filter(l => !l.trim().startsWith('//'));
  const hasDirectMarket = lines.some(l =>
    /FROM\s+market_data/i.test(l) && !/SELECT\s+1\s+FROM\s+market_data/i.test(l)
  );
  assert.ok(!hasDirectMarket, 'daily recalc must not query market_data directly for pricing signal');
});

console.log('\n── B4F-21–22 : reactive booking recalculation callers ──');

await test('B4F-21 reactive booking recalc uses resolver for market', async () => {
  assert.ok(
    RECALC_SRC.includes('resolveMarketData'),
    'pricing-recalc-trigger.js must use resolveMarketData'
  );
});

await test('B4F-22 reactive booking recalc passes resolution.market as explicit marketOverride', async () => {
  assert.match(
    RECALC_SRC,
    /marketOverride:\s*resolution\.market/,
    'pricing-recalc-trigger.js must pass resolution.market as marketOverride'
  );
});

console.log('\n── B4F-23–24 : BP-1 recompute callers ──');

await test('B4F-23 BP-1 recompute uses resolver for market', async () => {
  assert.ok(
    CALENDARS_SRC.includes('resolveMarketData'),
    'pricing-calendars.js _runRecompute must use resolveMarketData'
  );
});

await test('B4F-24 BP-1 recompute passes resolution.market as explicit marketOverride', async () => {
  assert.match(
    CALENDARS_SRC,
    /marketOverride:\s*resolution\.market/,
    'pricing-calendars.js must pass resolution.market as marketOverride'
  );
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();

#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B3B Channex Rate Plan Currency Reader
 *
 * CURAUTH-01–03 : valid currency responses (EUR, lowercase, whitespace)
 * CURAUTH-04–05 : invalid input (missing / blank ratePlanId) — zero HTTP
 * CURAUTH-06–07 : missing currency in response
 * CURAUTH-08–09 : invalid currency shape in response
 * CURAUTH-10    : 404 not_found
 * CURAUTH-11    : 500 api_error
 * CURAUTH-12    : network timeout api_error
 * CURAUTH-13    : no EUR fallback
 * CURAUTH-14    : no country inference
 * CURAUTH-15    : no DB query
 * CURAUTH-16    : properties.currency not written
 * CURAUTH-17    : creation/connect flows unchanged
 * CURAUTH-18    : pricing/market modules unchanged
 *
 * Run: node tests/p1_2b3b_channex_currency_reader.test.js
 * No real Channex call. No DB. No Apify.
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

// ── Module under test ──────────────────────────────────────────────────────────
const channexModule = require('../channex');
const { getChannexRatePlanCurrency, channexAPI } = channexModule;

// ── Mock helper ───────────────────────────────────────────────────────────────
// Replaces channexAPI.get for the duration of a single test, then restores it.
// This is safe because channexAPI is exported and tests run sequentially.

function withMockGet(mockFn, testFn) {
  const original = channexAPI.get;
  channexAPI.get = mockFn;
  return Promise.resolve()
    .then(() => testFn())
    .finally(() => { channexAPI.get = original; });
}

function channexOkResponse(currency) {
  return Promise.resolve({
    data: { data: { attributes: { id: 'rp-1', currency } } }
  });
}

function channexErrorResponse(status) {
  const err = new Error(`HTTP ${status}`);
  err.response = { status };
  return Promise.reject(err);
}

function channexNetworkError() {
  const err = new Error('ECONNRESET');
  // no .response property — simulates network failure
  return Promise.reject(err);
}

// Source texts for structural checks
const CHANNEX_SRC  = fs.readFileSync(path.resolve(__dirname, '../channex.js'), 'utf8');
const RESOLVER_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/market-data-resolver.js'), 'utf8');
const ENGINE_SRC   = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-engine.js'), 'utf8');
const PUBLISHER_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/pricing-publisher.js'), 'utf8');

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── CURAUTH-01–03 : valid currency responses ──');

await test('CURAUTH-01 valid EUR response → { ok: true, currency: "EUR" }', () =>
  withMockGet(
    () => channexOkResponse('EUR'),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.deepStrictEqual(result, { ok: true, currency: 'EUR' });
    }
  )
);

await test('CURAUTH-02 lowercase "gbp" from Channex → normalized { ok: true, currency: "GBP" }', () =>
  withMockGet(
    () => channexOkResponse('gbp'),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.deepStrictEqual(result, { ok: true, currency: 'GBP' });
    }
  )
);

await test('CURAUTH-03 whitespace " USD " from Channex → normalized { ok: true, currency: "USD" }', () =>
  withMockGet(
    () => channexOkResponse(' USD '),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.deepStrictEqual(result, { ok: true, currency: 'USD' });
    }
  )
);

console.log('\n── CURAUTH-04–05 : invalid input — zero HTTP calls ──');

await test('CURAUTH-04 missing ratePlanId → invalid_input, no HTTP call', async () => {
  let httpCalled = false;
  const original = channexAPI.get;
  channexAPI.get = () => { httpCalled = true; return Promise.resolve({}); };
  try {
    const result = await getChannexRatePlanCurrency(undefined);
    assert.strictEqual(result.ok, false, 'ok must be false for undefined input');
    assert.strictEqual(result.error, 'invalid_input', `error must be invalid_input, got ${result.error}`);
    assert.ok(!httpCalled, 'HTTP must not be called for missing ratePlanId');
  } finally {
    channexAPI.get = original;
  }
});

await test('CURAUTH-05 blank ratePlanId → invalid_input, no HTTP call', async () => {
  let httpCalled = false;
  const original = channexAPI.get;
  channexAPI.get = () => { httpCalled = true; return Promise.resolve({}); };
  try {
    for (const blank of [null, '', '   ']) {
      const result = await getChannexRatePlanCurrency(blank);
      assert.strictEqual(result.ok, false, `ok must be false for ${JSON.stringify(blank)}`);
      assert.strictEqual(result.error, 'invalid_input', `error must be invalid_input for ${JSON.stringify(blank)}`);
    }
    assert.ok(!httpCalled, 'HTTP must not be called for blank ratePlanId');
  } finally {
    channexAPI.get = original;
  }
});

console.log('\n── CURAUTH-06–07 : missing currency in response ──');

await test('CURAUTH-06 Channex returns rate plan with no currency field → missing_currency', () =>
  withMockGet(
    () => Promise.resolve({ data: { data: { attributes: { id: 'rp-1' } } } }),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'missing_currency');
    }
  )
);

await test('CURAUTH-07 currency="" (empty string) → missing_currency', () =>
  withMockGet(
    () => channexOkResponse(''),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'missing_currency');
    }
  )
);

console.log('\n── CURAUTH-08–09 : invalid currency shape ──');

await test('CURAUTH-08 currency="EURO" (4 chars) → invalid_currency', () =>
  withMockGet(
    () => channexOkResponse('EURO'),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'invalid_currency');
    }
  )
);

await test('CURAUTH-09 currency="12A" (digits) → invalid_currency', () =>
  withMockGet(
    () => channexOkResponse('12A'),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'invalid_currency');
    }
  )
);

console.log('\n── CURAUTH-10 : 404 ──');

await test('CURAUTH-10 Channex 404 → { ok: false, error: "not_found" }', () =>
  withMockGet(
    () => channexErrorResponse(404),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-nonexistent');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'not_found');
    }
  )
);

console.log('\n── CURAUTH-11–12 : API / network errors ──');

await test('CURAUTH-11 Channex 500 → { ok: false, error: "api_error" }', () =>
  withMockGet(
    () => channexErrorResponse(500),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'api_error');
    }
  )
);

await test('CURAUTH-12 network error (no response) → { ok: false, error: "api_error" }', () =>
  withMockGet(
    () => channexNetworkError(),
    async () => {
      const result = await getChannexRatePlanCurrency('rp-abc-123');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.error, 'api_error');
    }
  )
);

console.log('\n── CURAUTH-13–14 : no fallback, no inference ──');

await test('CURAUTH-13 no EUR fallback — missing currency never defaults to EUR', () => {
  // Source check: the function must not contain 'EUR' as a default value
  const fnMatch = CHANNEX_SRC.match(/async function getChannexRatePlanCurrency[\s\S]+?\n\}/);
  assert.ok(fnMatch, 'getChannexRatePlanCurrency not found in channex.js');
  // The only 'EUR' reference should be in comments, not as a default
  const body = fnMatch[0];
  assert.ok(
    !/return\s+\{[^}]*currency\s*:\s*['"]EUR['"]/.test(body),
    "EUR must not appear as a hardcoded fallback return value in getChannexRatePlanCurrency"
  );
});

await test('CURAUTH-14 no country inference — country_code never consulted', () => {
  const fnMatch = CHANNEX_SRC.match(/async function getChannexRatePlanCurrency[\s\S]+?\n\}/);
  assert.ok(fnMatch, 'getChannexRatePlanCurrency not found in channex.js');
  assert.ok(
    !/country_code/.test(fnMatch[0]),
    'country_code found inside getChannexRatePlanCurrency — no country inference allowed'
  );
  assert.ok(
    !/eurozone/i.test(fnMatch[0]),
    'eurozone reference found inside getChannexRatePlanCurrency'
  );
});

console.log('\n── CURAUTH-15–16 : no DB, no properties write ──');

await test('CURAUTH-15 helper performs no DB query — no pool parameter', () => {
  const fnMatch = CHANNEX_SRC.match(/async function getChannexRatePlanCurrency[\s\S]+?\n\}/);
  assert.ok(fnMatch, 'getChannexRatePlanCurrency not found in channex.js');
  assert.ok(
    !/pool\.query/.test(fnMatch[0]),
    'pool.query found inside getChannexRatePlanCurrency — no DB access allowed'
  );
  assert.ok(
    !/client\.query/.test(fnMatch[0]),
    'client.query found inside getChannexRatePlanCurrency'
  );
});

await test('CURAUTH-16 properties.currency not written by B3B', () => {
  const fnMatch = CHANNEX_SRC.match(/async function getChannexRatePlanCurrency[\s\S]+?\n\}/);
  assert.ok(fnMatch, 'getChannexRatePlanCurrency not found in channex.js');
  assert.ok(
    !/UPDATE properties/.test(fnMatch[0]),
    'UPDATE properties found inside getChannexRatePlanCurrency'
  );
  assert.ok(
    !/properties\.currency\s*=/.test(fnMatch[0]),
    'properties.currency assignment found inside getChannexRatePlanCurrency'
  );
});

console.log('\n── CURAUTH-17–18 : creation flows / pricing modules unchanged ──');

await test('CURAUTH-17 Channex creation flows unchanged (currency:EUR hardcoded preserved)', () => {
  // createChannexProperty still sends currency:'EUR'
  const createFn = CHANNEX_SRC.match(/async function createChannexProperty[\s\S]+?\n\}/);
  assert.ok(createFn, 'createChannexProperty not found');
  assert.ok(
    /currency\s*:\s*'EUR'/.test(createFn[0]),
    "createChannexProperty no longer sends currency:'EUR' — creation flow may have changed"
  );

  // addRoomTypeToProperty still creates rate plan with currency:'EUR'
  const addFn = CHANNEX_SRC.match(/async function addRoomTypeToProperty[\s\S]+?\n  \}/);
  assert.ok(addFn, 'addRoomTypeToProperty not found');
  assert.ok(
    /currency\s*:\s*'EUR'/.test(addFn[0]),
    "addRoomTypeToProperty no longer creates rate plan with currency:'EUR'"
  );
});

await test('CURAUTH-18 pricing/market modules unchanged by B3B', () => {
  assert.ok(
    !/getChannexRatePlanCurrency/.test(RESOLVER_SRC),
    'getChannexRatePlanCurrency found in market-data-resolver — must not be imported in B3B'
  );
  assert.ok(
    !/getChannexRatePlanCurrency/.test(ENGINE_SRC),
    'getChannexRatePlanCurrency found in pricing-engine'
  );
  assert.ok(
    !/getChannexRatePlanCurrency/.test(PUBLISHER_SRC),
    'getChannexRatePlanCurrency found in pricing-publisher'
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

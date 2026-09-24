#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B3C Property Currency Reconciliation
 *
 * B3C-01–04 : classifySegment — all four segments
 * B3C-05–06 : reconcile without rate plan (NO_CHANNEX, PARTIAL_CHANNEX)
 * B3C-07–09 : reconcile with valid Channex result (WOULD_SET, ALREADY_SET, CONFLICT)
 * B3C-10–14 : reconcile with failed/absent Channex results
 * B3C-15    : output shape — all fields present
 * B3C-16    : ratePlanIdSuffix is last 8 chars
 * B3C-17    : HUMAN_REVIEW_STATUSES set contents
 * B3C-18    : pure module — no DB / no HTTP code
 *
 * Run: node tests/p1_2b3c_currency_reconciliation.test.js
 * No DB. No Channex. No network.
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
const {
  reconcilePropertyCurrency,
  classifySegment,
  SEGMENT,
  STATUS,
  FUTURE_ACTION,
} = require('../routes/property-currency-reconciler');

// ── Source check ───────────────────────────────────────────────────────────────
const RECONCILER_SRC = fs.readFileSync(
  path.resolve(__dirname, '../routes/property-currency-reconciler.js'),
  'utf8'
);

// ── Property stubs ─────────────────────────────────────────────────────────────
function base() {
  return {
    id: 'prop-aaaabbbbccccdddd',
    name: 'Test Property',
    currency: null,
    channex_enabled: false,
    channex_rate_plan_id: null,
    channex_property_id: null,
    channex_room_type_id: null,
    channex_property_id_ext: null,
    external_pricing: false,
    boost_price_active: false,
  };
}

function withRatePlan(overrides = {}) {
  return { ...base(), channex_rate_plan_id: 'rp-aaaa-bbbb-cccc-12345678', channex_enabled: true, ...overrides };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── B3C-01–04 : classifySegment ──');

await test('B3C-01 CONNECTED_RATE_PLAN: has rate plan + channex_enabled=true', () => {
  const seg = classifySegment({ ...base(), channex_rate_plan_id: 'rp-1', channex_enabled: true });
  assert.strictEqual(seg, SEGMENT.CONNECTED_RATE_PLAN);
});

await test('B3C-02 DISCONNECTED_WITH_RATE_PLAN: has rate plan + channex_enabled=false', () => {
  const seg = classifySegment({ ...base(), channex_rate_plan_id: 'rp-1', channex_enabled: false });
  assert.strictEqual(seg, SEGMENT.DISCONNECTED_WITH_RATE_PLAN);
});

await test('B3C-03 PARTIAL_CHANNEX: has channex_property_id but no rate plan', () => {
  const seg = classifySegment({ ...base(), channex_property_id: 'cp-1' });
  assert.strictEqual(seg, SEGMENT.PARTIAL_CHANNEX);
});

await test('B3C-04 NO_CHANNEX: no Channex IDs at all', () => {
  const seg = classifySegment(base());
  assert.strictEqual(seg, SEGMENT.NO_CHANNEX);
});

console.log('\n── B3C-05–06 : reconcile without rate plan ──');

await test('B3C-05 NO_CHANNEX → status NO_CHANNEX, futureAction USER_CONFIGURATION_REQUIRED', () => {
  const rec = reconcilePropertyCurrency(base(), null);
  assert.strictEqual(rec.reconciliationStatus, STATUS.NO_CHANNEX);
  assert.strictEqual(rec.futureAction, 'USER_CONFIGURATION_REQUIRED');
  assert.strictEqual(rec.requiresHumanReview, false);
  assert.strictEqual(rec.channexCurrency, null);
});

await test('B3C-06 PARTIAL_CHANNEX → status PARTIAL_CHANNEX, futureAction RECOVER_CHANNEX_SETUP', () => {
  const prop = { ...base(), channex_property_id: 'cp-xyz' };
  const rec  = reconcilePropertyCurrency(prop, null);
  assert.strictEqual(rec.reconciliationStatus, STATUS.PARTIAL_CHANNEX);
  assert.strictEqual(rec.futureAction, 'RECOVER_CHANNEX_SETUP');
  assert.strictEqual(rec.requiresHumanReview, false);
});

console.log('\n── B3C-07–09 : reconcile with valid Channex result ──');

await test('B3C-07 WOULD_SET: local NULL + Channex EUR → WOULD_SET, SET_FROM_CHANNEX', () => {
  const prop   = withRatePlan({ currency: null });
  const result = reconcilePropertyCurrency(prop, { ok: true, currency: 'EUR' });
  assert.strictEqual(result.reconciliationStatus, STATUS.WOULD_SET);
  assert.strictEqual(result.futureAction, 'SET_FROM_CHANNEX');
  assert.strictEqual(result.channexCurrency, 'EUR');
  assert.strictEqual(result.localCurrency, null);
  assert.strictEqual(result.requiresHumanReview, false);
});

await test('B3C-08 ALREADY_SET: local EUR + Channex EUR → ALREADY_SET, NO_ACTION', () => {
  const prop   = withRatePlan({ currency: 'EUR' });
  const result = reconcilePropertyCurrency(prop, { ok: true, currency: 'EUR' });
  assert.strictEqual(result.reconciliationStatus, STATUS.ALREADY_SET);
  assert.strictEqual(result.futureAction, 'NO_ACTION');
  assert.strictEqual(result.requiresHumanReview, false);
});

await test('B3C-09 CONFLICT: local USD + Channex EUR → CONFLICT, HUMAN_RECONCILIATION, requiresHumanReview', () => {
  const prop   = withRatePlan({ currency: 'USD' });
  const result = reconcilePropertyCurrency(prop, { ok: true, currency: 'EUR' });
  assert.strictEqual(result.reconciliationStatus, STATUS.CONFLICT);
  assert.strictEqual(result.futureAction, 'HUMAN_RECONCILIATION');
  assert.strictEqual(result.requiresHumanReview, true);
  assert.strictEqual(result.localCurrency, 'USD');
  assert.strictEqual(result.channexCurrency, 'EUR');
});

console.log('\n── B3C-10–14 : reconcile with failed/absent Channex results ──');

await test('B3C-10 RATE_PLAN_NOT_FOUND: error not_found → RATE_PLAN_NOT_FOUND, RECOVER_CHANNEX_SETUP', () => {
  const prop   = withRatePlan();
  const result = reconcilePropertyCurrency(prop, { ok: false, error: 'not_found' });
  assert.strictEqual(result.reconciliationStatus, STATUS.RATE_PLAN_NOT_FOUND);
  assert.strictEqual(result.futureAction, 'RECOVER_CHANNEX_SETUP');
  assert.strictEqual(result.requiresHumanReview, false);
});

await test('B3C-11 MISSING_CHANNEX_CURRENCY: error missing_currency → requiresHumanReview=true', () => {
  const prop   = withRatePlan();
  const result = reconcilePropertyCurrency(prop, { ok: false, error: 'missing_currency' });
  assert.strictEqual(result.reconciliationStatus, STATUS.MISSING_CHANNEX_CURRENCY);
  assert.strictEqual(result.futureAction, 'HUMAN_RECONCILIATION');
  assert.strictEqual(result.requiresHumanReview, true);
});

await test('B3C-12 INVALID_CHANNEX_CURRENCY: error invalid_currency → requiresHumanReview=true', () => {
  const prop   = withRatePlan();
  const result = reconcilePropertyCurrency(prop, { ok: false, error: 'invalid_currency' });
  assert.strictEqual(result.reconciliationStatus, STATUS.INVALID_CHANNEX_CURRENCY);
  assert.strictEqual(result.futureAction, 'HUMAN_RECONCILIATION');
  assert.strictEqual(result.requiresHumanReview, true);
});

await test('B3C-13 CHANNEX_UNAVAILABLE: error api_error → CHANNEX_UNAVAILABLE, RETRY_LATER', () => {
  const prop   = withRatePlan();
  const result = reconcilePropertyCurrency(prop, { ok: false, error: 'api_error' });
  assert.strictEqual(result.reconciliationStatus, STATUS.CHANNEX_UNAVAILABLE);
  assert.strictEqual(result.futureAction, 'RETRY_LATER');
  assert.strictEqual(result.requiresHumanReview, false);
});

await test('B3C-14 CHANNEX_UNAVAILABLE: null channexResult when rate plan present → CHANNEX_UNAVAILABLE', () => {
  const prop   = withRatePlan();
  // null means "call was not made" — treated as unavailable when rate plan exists
  const result = reconcilePropertyCurrency(prop, null);
  assert.strictEqual(result.reconciliationStatus, STATUS.CHANNEX_UNAVAILABLE);
  assert.strictEqual(result.futureAction, 'RETRY_LATER');
});

console.log('\n── B3C-15–16 : output shape and suffix ──');

await test('B3C-15 output object has all required fields', () => {
  const result = reconcilePropertyCurrency(withRatePlan(), { ok: true, currency: 'EUR' });
  const REQUIRED = [
    'propertyId', 'propertyName', 'segment', 'localCurrency',
    'channexEnabled', 'hasRatePlan', 'ratePlanIdSuffix',
    'channexCurrency', 'externalPricing', 'boostPriceActive',
    'reconciliationStatus', 'futureAction', 'requiresHumanReview',
  ];
  for (const field of REQUIRED) {
    assert.ok(field in result, `Missing field: ${field}`);
  }
});

await test('B3C-16 ratePlanIdSuffix is last 8 chars of rate plan ID', () => {
  const ratePlanId = 'rp-aaaa-bbbb-cccc-12345678';
  const prop       = withRatePlan({ channex_rate_plan_id: ratePlanId });
  const result     = reconcilePropertyCurrency(prop, { ok: true, currency: 'EUR' });
  assert.strictEqual(result.ratePlanIdSuffix, '12345678',
    `Expected '12345678', got ${result.ratePlanIdSuffix}`);
});

console.log('\n── B3C-17 : HUMAN_REVIEW_STATUSES ──');

await test('B3C-17 HUMAN_REVIEW_STATUSES contains exactly CONFLICT, MISSING_CHANNEX_CURRENCY, INVALID_CHANNEX_CURRENCY', () => {
  const expected = new Set([
    STATUS.CONFLICT,
    STATUS.MISSING_CHANNEX_CURRENCY,
    STATUS.INVALID_CHANNEX_CURRENCY,
  ]);
  // Verify all three statuses set requiresHumanReview=true
  for (const status of expected) {
    // Build a property+channexResult that produces this status
    let rec;
    if (status === STATUS.CONFLICT) {
      rec = reconcilePropertyCurrency(withRatePlan({ currency: 'USD' }), { ok: true, currency: 'EUR' });
    } else if (status === STATUS.MISSING_CHANNEX_CURRENCY) {
      rec = reconcilePropertyCurrency(withRatePlan(), { ok: false, error: 'missing_currency' });
    } else {
      rec = reconcilePropertyCurrency(withRatePlan(), { ok: false, error: 'invalid_currency' });
    }
    assert.strictEqual(rec.requiresHumanReview, true,
      `requiresHumanReview must be true for status ${status}`);
  }
  // Verify all other statuses do NOT set requiresHumanReview=true
  const nonReview = [
    STATUS.WOULD_SET, STATUS.ALREADY_SET, STATUS.NO_CHANNEX,
    STATUS.PARTIAL_CHANNEX, STATUS.RATE_PLAN_NOT_FOUND, STATUS.CHANNEX_UNAVAILABLE,
  ];
  const nonReviewRecs = [
    reconcilePropertyCurrency(withRatePlan({ currency: null }), { ok: true, currency: 'EUR' }),
    reconcilePropertyCurrency(withRatePlan({ currency: 'EUR' }), { ok: true, currency: 'EUR' }),
    reconcilePropertyCurrency(base(), null),
    reconcilePropertyCurrency({ ...base(), channex_property_id: 'cp-1' }, null),
    reconcilePropertyCurrency(withRatePlan(), { ok: false, error: 'not_found' }),
    reconcilePropertyCurrency(withRatePlan(), { ok: false, error: 'api_error' }),
  ];
  for (let i = 0; i < nonReview.length; i++) {
    assert.strictEqual(nonReviewRecs[i].requiresHumanReview, false,
      `requiresHumanReview must be false for status ${nonReview[i]}`);
  }
});

console.log('\n── B3C-18 : structural purity ──');

await test('B3C-18 pure module — no pool.query, no client.query, no HTTP calls, no require(pg)', () => {
  assert.ok(
    !/pool\.query/.test(RECONCILER_SRC),
    'pool.query found in reconciler — no DB access allowed'
  );
  assert.ok(
    !/client\.query/.test(RECONCILER_SRC),
    'client.query found in reconciler'
  );
  assert.ok(
    !/require\s*\(\s*['"]pg['"]/.test(RECONCILER_SRC),
    "require('pg') found in reconciler"
  );
  assert.ok(
    !/axios|fetch|https?\./.test(RECONCILER_SRC),
    'HTTP client reference found in reconciler — module must be pure'
  );
  assert.ok(
    !/channexAPI/.test(RECONCILER_SRC),
    'channexAPI reference found in reconciler — must not import channex module'
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

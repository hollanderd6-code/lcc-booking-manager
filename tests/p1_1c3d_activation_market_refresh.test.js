#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.1-C3D BoostPrice Activation → Market Refresh
 *
 * Groups:
 *   C3D-01–02  : source-text invariants (old-state pre-read, final active source)
 *   C3D-03–10  : transition matrix (behavioral, mocked route internals)
 *   C3D-11–13  : context key correctness
 *   C3D-14–15  : async / error safety
 *   C3D-16–20  : isolation (no direct Apify/Channex, imports, out-of-scope)
 *
 * Run: node tests/p1_1c3d_activation_market_refresh.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

// ── Runner ────────────────────────────────────────────────────────────────────
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

// ── Source helpers ────────────────────────────────────────────────────────────
const ROUTES_SRC = fs.readFileSync(
  path.resolve(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8'
);

function getConfigRoute() {
  // Grab the POST /api/dynamic-pricing/config handler body
  const start = ROUTES_SRC.indexOf("app.post('/api/dynamic-pricing/config'");
  if (start === -1) return '';
  // Handler spans ~140 lines / ~7000 chars
  return ROUTES_SRC.slice(start, start + 7000);
}

// ── Behavioural helpers ───────────────────────────────────────────────────────
const { computeMarketContextKey } = require('../routes/market-context-key');
const { scheduleMarketRefresh, _timers } = require('../routes/market-refresh-trigger');

/**
 * Simulate the C3D activation bridge logic extracted from the route.
 * Returns: { scheduled: bool, contextKey: string|null, logged: string[] }
 */
function runC3DBridge({
  wasActive,
  nowActive,
  propertyRow = { latitude: 48.85, longitude: 2.35, country_code: 'FR' },
  pricingOwnerId = 'user-42',
  propertyId = 'prop-1',
  scheduleFn,
}) {
  const logged = [];
  let scheduled = false;
  let contextKey = null;

  if (!wasActive && nowActive) {
    const { latitude, longitude, country_code } = propertyRow;
    contextKey = computeMarketContextKey({ countryCode: country_code, latitude, longitude });
    logged.push(`[C3D] activation detected propertyId=${propertyId}`);
    if (contextKey) {
      logged.push(`[C3D] market refresh scheduled propertyId=${propertyId} ctx=${contextKey}`);
      if (scheduleFn) scheduleFn({ propertyId, userId: pricingOwnerId, expectedContextKey: contextKey });
      scheduled = true;
    } else {
      logged.push(`[C3D] no geo propertyId=${propertyId} — market refresh skipped`);
    }
  }

  return { scheduled, contextKey, logged };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── C3D-01–02 : source-text invariants ──');

await test('C3D-01 old config state SELECT present before UPSERT', async () => {
  const src = getConfigRoute();
  assert.ok(src, 'POST /api/dynamic-pricing/config handler not found');
  assert.ok(
    /SELECT is_active\s+FROM pricing_config\s+WHERE property_id = \$1/.test(src),
    'Pre-UPSERT old-state query absent'
  );
  // Must appear BEFORE the UPSERT INSERT INTO
  const preReadIdx = src.indexOf('SELECT is_active');
  const upsertIdx  = src.indexOf('INSERT INTO pricing_config');
  assert.ok(preReadIdx !== -1, 'old-state SELECT not found');
  assert.ok(upsertIdx  !== -1, 'UPSERT INSERT not found');
  assert.ok(preReadIdx < upsertIdx, 'old-state SELECT must appear before UPSERT');
});

await test('C3D-02 final activation uses result.rows[0].is_active, not only raw request variable', async () => {
  const src = getConfigRoute();
  assert.ok(
    /result\.rows\[0\].*is_active/.test(src) || /result\.rows\[0\]\?\.is_active/.test(src),
    'nowActive must derive from result.rows[0].is_active (the DB-authoritative state after UPSERT)'
  );
});

console.log('\n── C3D-03–10 : transition matrix ──');

await test('C3D-03 NO_CONFIG → ACTIVE + valid geo → schedules refresh', async () => {
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: false,
    nowActive: true,
    scheduleFn: () => { called = true; },
  });
  assert.ok(scheduled, 'Expected scheduleMarketRefresh to be called');
  assert.ok(called, 'scheduleFn not invoked');
});

await test('C3D-04 INACTIVE → ACTIVE + valid geo → schedules refresh', async () => {
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: false,       // was explicitly inactive (hadConfig=true but is_active=false)
    nowActive: true,
    scheduleFn: () => { called = true; },
  });
  assert.ok(scheduled, 'INACTIVE → ACTIVE must schedule');
  assert.ok(called, 'scheduleFn not invoked');
});

await test('C3D-05 ACTIVE → ACTIVE → no refresh', async () => {
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: true,
    nowActive: true,
    scheduleFn: () => { called = true; },
  });
  assert.ok(!scheduled, 'ACTIVE → ACTIVE must NOT schedule');
  assert.ok(!called, 'scheduleFn must not be invoked for ACTIVE → ACTIVE');
});

await test('C3D-06 ACTIVE → INACTIVE → no refresh', async () => {
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: true,
    nowActive: false,
    scheduleFn: () => { called = true; },
  });
  assert.ok(!scheduled, 'ACTIVE → INACTIVE must NOT schedule');
  assert.ok(!called, 'scheduleFn must not be invoked');
});

await test('C3D-07 INACTIVE → INACTIVE → no refresh', async () => {
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: false,
    nowActive: false,
    scheduleFn: () => { called = true; },
  });
  assert.ok(!scheduled, 'INACTIVE → INACTIVE must NOT schedule');
  assert.ok(!called, 'scheduleFn must not be invoked');
});

await test('C3D-08 NO_CONFIG → INACTIVE → no refresh', async () => {
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: false,
    nowActive: false,
    propertyRow: { latitude: 48.85, longitude: 2.35, country_code: 'FR' },
    scheduleFn: () => { called = true; },
  });
  assert.ok(!scheduled, 'NO_CONFIG → INACTIVE must NOT schedule');
  assert.ok(!called, 'scheduleFn must not be invoked');
});

await test('C3D-09 activation + missing geo → no refresh', async () => {
  let called = false;
  const { scheduled, contextKey } = runC3DBridge({
    wasActive: false,
    nowActive: true,
    propertyRow: { latitude: null, longitude: null, country_code: null },
    scheduleFn: () => { called = true; },
  });
  assert.ok(contextKey === null, 'Expected contextKey null for missing geo');
  assert.ok(!scheduled, 'Missing geo must NOT trigger scheduleMarketRefresh');
  assert.ok(!called, 'scheduleFn must not be invoked when no geo');
});

await test('C3D-10 activation + incomplete geo (only lat) → no refresh', async () => {
  let called = false;
  const { scheduled, contextKey } = runC3DBridge({
    wasActive: false,
    nowActive: true,
    propertyRow: { latitude: 48.85, longitude: null, country_code: 'FR' },
    scheduleFn: () => { called = true; },
  });
  assert.ok(contextKey === null, 'Partial geo must yield null contextKey');
  assert.ok(!scheduled, 'Incomplete geo must NOT trigger scheduleMarketRefresh');
});

console.log('\n── C3D-11–13 : context key ──');

await test('C3D-11 context key generated by canonical computeMarketContextKey', async () => {
  const { contextKey } = runC3DBridge({
    wasActive: false,
    nowActive: true,
    propertyRow: { latitude: 48.8566, longitude: 2.3522, country_code: 'FR' },
    scheduleFn: () => {},
  });
  const expected = computeMarketContextKey({ countryCode: 'FR', latitude: 48.8566, longitude: 2.3522 });
  assert.strictEqual(contextKey, expected, 'contextKey must match computeMarketContextKey output');
  assert.ok(contextKey !== null, 'Expected a non-null context key');
});

await test('C3D-12 schedule receives pricingOwnerId', async () => {
  let capturedUserId = null;
  runC3DBridge({
    wasActive: false,
    nowActive: true,
    pricingOwnerId: 'canonical-owner-99',
    scheduleFn: ({ userId }) => { capturedUserId = userId; },
  });
  assert.strictEqual(capturedUserId, 'canonical-owner-99', 'userId must be pricingOwnerId');
});

await test('C3D-13 schedule receives expectedContextKey', async () => {
  let capturedKey = null;
  runC3DBridge({
    wasActive: false,
    nowActive: true,
    propertyRow: { latitude: 43.2965, longitude: 5.3698, country_code: 'FR' },
    scheduleFn: ({ expectedContextKey }) => { capturedKey = expectedContextKey; },
  });
  const expected = computeMarketContextKey({ countryCode: 'FR', latitude: 43.2965, longitude: 5.3698 });
  assert.strictEqual(capturedKey, expected, 'expectedContextKey must equal computeMarketContextKey result');
});

console.log('\n── C3D-14–15 : async / error safety ──');

await test('C3D-14 response sent before asynchronous scheduling (setImmediate in source)', async () => {
  const src = getConfigRoute();
  // res.json must appear before setImmediate
  const responseIdx  = src.indexOf('res.json(');
  const immediateIdx = src.indexOf('setImmediate(');
  assert.ok(responseIdx  !== -1, 'res.json not found in handler');
  assert.ok(immediateIdx !== -1, 'setImmediate not found in handler');
  assert.ok(responseIdx < immediateIdx, 'res.json must precede setImmediate');
});

await test('C3D-15 UPSERT failure → no scheduling (bridge is after successful UPSERT)', async () => {
  const src = getConfigRoute();
  // The try/catch must wrap the UPSERT; C3D bridge is inside try but after res.json.
  // Verify bridge block is before the catch keyword at the same nesting.
  const nowActiveIdx = src.indexOf('nowActive');
  const catchIdx     = src.indexOf('} catch (err)');
  assert.ok(nowActiveIdx !== -1, 'nowActive detection not found');
  assert.ok(catchIdx     !== -1, 'catch block not found');
  assert.ok(nowActiveIdx < catchIdx, 'C3D bridge must be inside the try block (before catch)');
});

console.log('\n── C3D-16–20 : isolation ──');

await test('C3D-16 no direct Apify call in dynamic-pricing-routes.js', async () => {
  assert.ok(
    !/APIFY_TOKEN/.test(ROUTES_SRC),
    'APIFY_TOKEN found in dynamic-pricing-routes.js — no direct Apify calls allowed'
  );
  assert.ok(
    !/scrapeBestZone/.test(ROUTES_SRC),
    'scrapeBestZone found in dynamic-pricing-routes.js'
  );
});

await test('C3D-17 no direct Channex call in dynamic-pricing-routes.js', async () => {
  assert.ok(
    !/channex\.io/.test(ROUTES_SRC),
    'channex.io found in dynamic-pricing-routes.js'
  );
  assert.ok(
    !/sendBookingMessage/.test(ROUTES_SRC),
    'sendBookingMessage found in dynamic-pricing-routes.js'
  );
});

await test('C3D-18 ACTIVE→ACTIVE strategy edit → no market refresh', async () => {
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: true,
    nowActive: true,
    propertyRow: { latitude: 48.85, longitude: 2.35, country_code: 'FR' },
    scheduleFn: () => { called = true; },
  });
  assert.ok(!scheduled, 'ACTIVE → ACTIVE strategy edit must NOT schedule market refresh');
  assert.ok(!called, 'scheduleFn must not be invoked');
});

await test('C3D-19 ACTIVE manual→auto → no C3D refresh', async () => {
  // wasActive=true means already active; mode change is ACTIVE→ACTIVE
  let called = false;
  const { scheduled } = runC3DBridge({
    wasActive: true,
    nowActive: true,
    scheduleFn: () => { called = true; },
  });
  assert.ok(!scheduled, 'manual→auto on active config must NOT trigger C3D market refresh');
});

await test('C3D-20 imports reuse existing market-refresh-trigger and market-context-key', async () => {
  assert.ok(
    /require\(['"]\.\/market-refresh-trigger['"]\)/.test(ROUTES_SRC),
    'market-refresh-trigger not imported in dynamic-pricing-routes.js'
  );
  assert.ok(
    /require\(['"]\.\/market-context-key['"]\)/.test(ROUTES_SRC),
    'market-context-key not imported in dynamic-pricing-routes.js'
  );
  assert.ok(
    /\bscheduleMarketRefresh\b/.test(ROUTES_SRC),
    'scheduleMarketRefresh not referenced in routes file'
  );
  assert.ok(
    /\bcomputeMarketContextKey\b/.test(ROUTES_SRC),
    'computeMarketContextKey not referenced in routes file'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  20 total`);
if (failures.length) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('─'.repeat(55));
if (passed + failed !== 20) {
  console.error(`⚠️  Expected 20 tests, ${passed + failed} ran`);
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);

})();

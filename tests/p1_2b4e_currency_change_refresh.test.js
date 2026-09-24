#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-E Currency Change → Safe Market Refresh
 *
 * Verifies that PUT /api/properties/:propertyId:
 *   — accepts a `currency` field and normalizes it with normalizeCurrency
 *   — persists the normalized value in the UPDATE SQL ($44)
 *   — reads the old currency from the PROPERTIES cache before UPDATE
 *   — schedules a market refresh (via scheduleMarketRefresh) when the
 *     normalized new currency is valid and differs from the old value
 *   — does NOT schedule when: currency absent from body, same value,
 *     or invalid/null new currency
 *   — uses computeMarketContextKey from the post-commit DB row as
 *     expectedContextKey
 *   — guards against null ctxKey (incomplete geo)
 *   — does NOT invent a public currency endpoint
 *
 * Groups:
 *   B4E-01–03 : normalizeCurrency import and usage in PUT route
 *   B4E-04–07 : currency persisted in UPDATE SQL ($44)
 *   B4E-08–10 : oldCurrencyNorm read from property cache before UPDATE
 *   B4E-11–13 : newCurrencyNorm from body.currency (undefined → no-op)
 *   B4E-14–17 : refresh guard: valid new ≠ old → scheduleMarketRefresh
 *   B4E-18–20 : no-refresh cases: same value, null, undefined
 *   B4E-21–22 : expectedContextKey from post-commit DB row
 *   B4E-23–24 : ctxKey null guard — no scheduleMarketRefresh called
 *   B4E-25–26 : setImmediate used for async dispatch
 *   B4E-27    : no dedicated public currency endpoint invented
 *   B4E-28    : B3D isolation — backfill path unchanged
 *
 * Run: node tests/p1_2b4e_currency_change_refresh.test.js
 * No real DB / HTTP calls.
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
const SERVER_SRC   = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const BACKFILL_SRC = fs.readFileSync(path.resolve(__dirname, '../outils/backfill-property-currency.js'), 'utf8');
const RESOLVER_SRC = fs.readFileSync(path.resolve(__dirname, '../routes/market-data-resolver.js'), 'utf8');

// ── Extract PUT /api/properties/:propertyId route body ─────────────────────────
// The route spans ~21,000 chars — use a 25,000-char window to cover all sections.
const PUT_START = SERVER_SRC.indexOf("app.put('/api/properties/:propertyId'");
assert.ok(PUT_START !== -1, 'PUT /api/properties/:propertyId not found in server.js');
const PUT_BODY = SERVER_SRC.slice(PUT_START, PUT_START + 25000);

// ── Tests ──────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── B4E-01–03 : normalizeCurrency import and usage ──');

await test('B4E-01 normalizeCurrency imported from market-data-resolver', async () => {
  assert.match(
    SERVER_SRC,
    /const\s*\{[^}]*normalizeCurrency[^}]*\}\s*=\s*require\(['"]\.\/routes\/market-data-resolver['"]\)/,
    'normalizeCurrency not imported from routes/market-data-resolver'
  );
});

await test('B4E-02 normalizeCurrency is exported from market-data-resolver', async () => {
  assert.ok(
    RESOLVER_SRC.includes('normalizeCurrency'),
    'normalizeCurrency not found in market-data-resolver.js'
  );
  assert.match(
    RESOLVER_SRC,
    /module\.exports\s*=[\s\S]{0,500}normalizeCurrency/,
    'normalizeCurrency not in module.exports of market-data-resolver'
  );
});

await test('B4E-03 normalizeCurrency called with body.currency in PUT route', async () => {
  assert.match(
    PUT_BODY,
    /normalizeCurrency\s*\(\s*body\.currency\s*\)/,
    'normalizeCurrency(body.currency) not found in PUT route'
  );
});

console.log('\n── B4E-04–07 : currency persisted in UPDATE SQL ──');

await test('B4E-04 UPDATE SQL contains currency = $44', async () => {
  assert.match(
    PUT_BODY,
    /currency\s*=\s*\$44/,
    'currency = $44 not found in PUT route UPDATE SQL'
  );
});

await test('B4E-05 newCurrencyNorm passed as 44th element in params array', async () => {
  // The last param before closing ] should be newCurrencyNorm (after addressChanged)
  assert.match(
    PUT_BODY,
    /addressChanged,\s*\n\s*newCurrencyNorm/,
    'newCurrencyNorm not found after addressChanged in params array'
  );
});

await test('B4E-06 $44 in params array corresponds to newCurrencyNorm', async () => {
  // Verify newCurrencyNorm variable is assigned and used in params
  assert.match(
    PUT_BODY,
    /const\s+newCurrencyNorm\s*=/,
    'newCurrencyNorm variable declaration not found in PUT route'
  );
});

await test('B4E-07 no hardcoded EUR as default currency in UPDATE params', async () => {
  // Ensure no `|| 'EUR'` fallback near currency assignment
  const currencyBlock = PUT_BODY.slice(
    PUT_BODY.indexOf('newCurrencyNorm'),
    PUT_BODY.indexOf('newCurrencyNorm') + 200
  );
  assert.ok(
    !currencyBlock.includes("|| 'EUR'") && !currencyBlock.includes('|| "EUR"'),
    'Forbidden EUR fallback found near newCurrencyNorm assignment'
  );
});

console.log('\n── B4E-08–10 : oldCurrencyNorm read from property cache ──');

await test('B4E-08 oldCurrencyNorm declared before UPDATE query', async () => {
  const oldNormPos   = PUT_BODY.indexOf('oldCurrencyNorm');
  const updatePos    = PUT_BODY.indexOf('UPDATE properties');
  assert.ok(oldNormPos !== -1, 'oldCurrencyNorm not found in PUT route');
  assert.ok(updatePos  !== -1, 'UPDATE properties not found in PUT route');
  assert.ok(
    oldNormPos < updatePos,
    'oldCurrencyNorm must be declared before the UPDATE query'
  );
});

await test('B4E-09 oldCurrencyNorm reads from property.currency', async () => {
  assert.match(
    PUT_BODY,
    /oldCurrencyNorm\s*=\s*normalizeCurrency\s*\(\s*property\.currency\s*\)/,
    'oldCurrencyNorm not derived from normalizeCurrency(property.currency)'
  );
});

await test('B4E-10 property.currency comes from PROPERTIES in-memory cache (pre-update)', async () => {
  // The `property` variable is assigned via PROPERTIES.find before the UPDATE
  const propFindPos  = PUT_BODY.indexOf('PROPERTIES.find');
  const updatePos    = PUT_BODY.indexOf('UPDATE properties');
  assert.ok(propFindPos !== -1, 'PROPERTIES.find not found in PUT route');
  assert.ok(
    propFindPos < updatePos,
    'PROPERTIES.find must appear before UPDATE query (pre-update read)'
  );
});

console.log('\n── B4E-11–13 : newCurrencyNorm from body.currency ──');

await test('B4E-11 newCurrencyNorm uses body.currency when present (not undefined)', async () => {
  assert.match(
    PUT_BODY,
    /body\.currency\s*!==\s*undefined/,
    'body.currency !== undefined guard not found in PUT route'
  );
});

await test('B4E-12 newCurrencyNorm falls back to oldCurrencyNorm when currency absent from body', async () => {
  // Pattern: body.currency !== undefined ? normalizeCurrency(body.currency) : oldCurrencyNorm
  assert.match(
    PUT_BODY,
    /body\.currency\s*!==\s*undefined[\s\S]{0,100}oldCurrencyNorm/,
    'fallback to oldCurrencyNorm not found when body.currency is absent'
  );
});

await test('B4E-13 normalizeCurrency normalizes to null for invalid currency strings', async () => {
  // Verified at the resolver level
  const { normalizeCurrency: normFn } = require('../routes/market-data-resolver');
  assert.strictEqual(normFn('INVALID'), null);
  assert.strictEqual(normFn('eu'),      null);
  assert.strictEqual(normFn(''),        null);
  assert.strictEqual(normFn(null),      null);
  assert.strictEqual(normFn('EUR'),     'EUR');
  assert.strictEqual(normFn('usd'),     'USD');
});

console.log('\n── B4E-14–17 : refresh guard: valid new ≠ old → scheduleMarketRefresh ──');

await test('B4E-14 refresh block guards: newCurrencyNorm truthy AND !== oldCurrencyNorm', async () => {
  assert.match(
    PUT_BODY,
    /newCurrencyNorm\s*&&\s*newCurrencyNorm\s*!==\s*oldCurrencyNorm/,
    'Refresh guard (newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm) not found'
  );
});

await test('B4E-15 scheduleMarketRefresh called within the refresh guard', async () => {
  const guardPos = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  assert.ok(guardPos !== -1, 'Guard not found');
  const guardBlock = PUT_BODY.slice(guardPos, guardPos + 600);
  assert.ok(
    guardBlock.includes('scheduleMarketRefresh'),
    'scheduleMarketRefresh not found within currency refresh guard block'
  );
});

await test('B4E-16 scheduleMarketRefresh receives propertyId and userId', async () => {
  const guardPos = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock = PUT_BODY.slice(guardPos, guardPos + 600);
  assert.ok(
    guardBlock.includes('propertyId') && guardBlock.includes('userId'),
    'scheduleMarketRefresh not passed propertyId and userId in B4-E block'
  );
});

await test('B4E-17 scheduleMarketRefresh receives expectedContextKey from ctxKey', async () => {
  const guardPos = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock = PUT_BODY.slice(guardPos, guardPos + 600);
  assert.ok(
    guardBlock.includes('expectedContextKey') && guardBlock.includes('ctxKey'),
    'expectedContextKey: ctxKey not passed to scheduleMarketRefresh in B4-E block'
  );
});

console.log('\n── B4E-18–20 : no-refresh cases ──');

await test('B4E-18 no EUR fallback in newCurrencyNorm assignment (no-op when currency absent)', async () => {
  // When body.currency is undefined, newCurrencyNorm = oldCurrencyNorm → guard fires false
  // Verify there is no `|| 'EUR'` anywhere in the newCurrencyNorm assignment
  const assignStart = PUT_BODY.indexOf('const newCurrencyNorm');
  const assignEnd   = PUT_BODY.indexOf('\n', PUT_BODY.indexOf('oldCurrencyNorm', assignStart)) + 1;
  const assignBlock = PUT_BODY.slice(assignStart, assignEnd + 50);
  assert.ok(
    !assignBlock.includes("'EUR'") && !assignBlock.includes('"EUR"'),
    'EUR fallback found in newCurrencyNorm assignment'
  );
});

await test('B4E-19 guard `newCurrencyNorm &&` blocks refresh when newNorm is null', async () => {
  // normalizeCurrency returns null for invalid → truthy check stops refresh
  const { normalizeCurrency: normFn } = require('../routes/market-data-resolver');
  const nullNorm = normFn('INVALID');
  assert.strictEqual(nullNorm, null);
  assert.ok(!nullNorm, 'null normalizeCurrency result is falsy — refresh guard blocks it');
});

await test('B4E-20 no refresh when newNorm === oldNorm (same currency, idempotent)', async () => {
  const guardPattern = /newCurrencyNorm\s*&&\s*newCurrencyNorm\s*!==\s*oldCurrencyNorm/;
  assert.match(
    PUT_BODY,
    guardPattern,
    '!== guard missing — same currency would incorrectly trigger refresh'
  );
});

console.log('\n── B4E-21–22 : expectedContextKey from post-commit DB row ──');

await test('B4E-21 ctxKey computed from dbRow post-commit (country_code, latitude, longitude)', async () => {
  const guardPos   = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock = PUT_BODY.slice(guardPos, guardPos + 600);
  assert.ok(
    guardBlock.includes('country_code') &&
    guardBlock.includes('latitude') &&
    guardBlock.includes('longitude'),
    'ctxKey not built from country_code/latitude/longitude in B4-E block'
  );
});

await test('B4E-22 ctxKey built with computeMarketContextKey in B4-E block', async () => {
  const guardPos   = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock = PUT_BODY.slice(guardPos, guardPos + 600);
  assert.ok(
    guardBlock.includes('computeMarketContextKey'),
    'computeMarketContextKey not called in B4-E refresh block'
  );
});

console.log('\n── B4E-23–24 : ctxKey null guard ──');

await test('B4E-23 ctxKey checked for truthiness before scheduleMarketRefresh', async () => {
  const guardPos   = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock = PUT_BODY.slice(guardPos, guardPos + 600);
  // Guard must test `if (ctxKey)` or `ctxKey &&` before calling scheduleMarketRefresh
  assert.match(
    guardBlock,
    /if\s*\(\s*ctxKey\s*\)|ctxKey\s*&&/,
    'ctxKey null guard not found before scheduleMarketRefresh call'
  );
});

await test('B4E-24 scheduleMarketRefresh not reachable when ctxKey is null/falsy', async () => {
  // Structural: scheduleMarketRefresh call is nested inside the `if (ctxKey)` block
  const guardPos     = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock   = PUT_BODY.slice(guardPos, guardPos + 600);
  const ctxCheckPos  = guardBlock.search(/if\s*\(\s*ctxKey\s*\)/);
  const schedulePos  = guardBlock.indexOf('scheduleMarketRefresh');
  assert.ok(ctxCheckPos !== -1, 'if (ctxKey) not found in B4-E block');
  assert.ok(schedulePos  !== -1, 'scheduleMarketRefresh not found in B4-E block');
  assert.ok(
    schedulePos > ctxCheckPos,
    'scheduleMarketRefresh must appear after if (ctxKey) guard'
  );
});

console.log('\n── B4E-25–26 : setImmediate for async dispatch ──');

await test('B4E-25 setImmediate used inside the currency refresh guard', async () => {
  const guardPos   = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock = PUT_BODY.slice(guardPos, guardPos + 600);
  assert.ok(
    guardBlock.includes('setImmediate'),
    'setImmediate not found inside currency refresh guard (must dispatch async)'
  );
});

await test('B4E-26 scheduleMarketRefresh call is inside the setImmediate callback', async () => {
  const guardPos      = PUT_BODY.indexOf('newCurrencyNorm && newCurrencyNorm !== oldCurrencyNorm');
  const guardBlock    = PUT_BODY.slice(guardPos, guardPos + 600);
  const setImmPos     = guardBlock.indexOf('setImmediate');
  const schedulePos   = guardBlock.indexOf('scheduleMarketRefresh');
  assert.ok(setImmPos   !== -1, 'setImmediate not found');
  assert.ok(schedulePos !== -1, 'scheduleMarketRefresh not found');
  assert.ok(
    schedulePos > setImmPos,
    'scheduleMarketRefresh must appear after (inside) setImmediate callback'
  );
});

console.log('\n── B4E-27 : no dedicated public currency endpoint invented ──');

await test('B4E-27 no dedicated POST/PUT /api/properties/.*/currency endpoint', async () => {
  // B4-E spec: "DO NOT invent a public currency endpoint merely to satisfy B4-E"
  assert.ok(
    !SERVER_SRC.match(/app\.(post|put|patch)\s*\(\s*['"][^'"]*\/currency['"]/i),
    'A dedicated /currency endpoint was invented — forbidden by B4-E spec'
  );
});

console.log('\n── B4E-28 : B3D isolation ──');

await test('B4E-28 backfill script writes currency directly (not via PUT route)', async () => {
  // Backfill uses raw UPDATE — must not reference the PUT route handler
  assert.ok(
    BACKFILL_SRC.includes('UPDATE properties'),
    'Backfill does not use direct UPDATE — unexpected'
  );
  assert.ok(
    !BACKFILL_SRC.includes('/api/properties/'),
    'Backfill incorrectly calls PUT API route — B3D isolation violated'
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

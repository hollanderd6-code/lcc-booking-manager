#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-H3 Controlled Property Geo Repair
 *
 * Verifies repair-property-geo.js:
 *   H3-01 : --name mandatory (CLI source guard)
 *   H3-02 : executeMode aborts when 0 properties match
 *   H3-03 : executeMode aborts when 2 properties match
 *   H3-04 : previewMode source does not call geocodeAddress
 *   H3-05 : previewMode source contains no INSERT/UPDATE/DELETE SQL
 *   H3-06 : previewMode source does not reference apify
 *   H3-07 : previewMode source does not reference channex API calls
 *   H3-08 : geocodeFn called exactly once with properties.address
 *   H3-09 : geocodeFn receives address from DB row, not hardcoded value
 *   H3-10 : invalid geocoder result → writeFn NOT called, DB_WRITES=0
 *   H3-11 : address_stale write rejection → executeMode aborts
 *   H3-12 : geo_changed write rejection → executeMode aborts
 *   H3-13 : writeGeoResult UPDATE SET contains only latitude/longitude/country_code/timezone
 *   H3-14 : writeGeoResult checks rowCount !== 1 before commit
 *   H3-15 : UPDATE WHERE clause scopes write to single property by id
 *   H3-16 : currency unchanged after successful geo write
 *   H3-17 : channex columns absent from UPDATE SET clause
 *   H3-18 : no INSERT INTO market_data in tool source
 *   H3-19 : no INSERT INTO / UPDATE pricing_schedule in tool source
 *   H3-20 : no INSERT/UPDATE pricing_history or pricing_config in tool source
 *   H3-21 : no scheduleMarketRefresh call in tool source
 *   H3-22 : no runDynamicPricingForOneProperty / applyDynamicPricingForProperty / triggerChannexRatesSync
 *   H3-23 : result.postCtxKey is non-null after successful geo write
 *   H3-24 : result.geoComplete = true after successful geo write
 *
 * Run: node tests/p1_2b4h3_geo_repair.test.js
 * No real DB / Geoapify / Apify / Channex calls.
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

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

// ── Load tool ─────────────────────────────────────────────────────────────────
const TOOL_PATH = path.resolve(__dirname, '../outils/repair-property-geo.js');
const TOOL_SRC  = fs.readFileSync(TOOL_PATH, 'utf8');
const { resolveTarget, previewMode, executeMode, writeGeoResult, validateGeoResult } = require(TOOL_PATH);

// ── Source sections ───────────────────────────────────────────────────────────
const writeGeoStart = TOOL_SRC.indexOf('async function writeGeoResult');
const previewStart  = TOOL_SRC.indexOf('async function previewMode');
const executeStart  = TOOL_SRC.indexOf('async function executeMode');
const writeGeoBody  = TOOL_SRC.slice(writeGeoStart, previewStart);
const previewBody   = TOOL_SRC.slice(previewStart, executeStart);

// ── Test fixtures ─────────────────────────────────────────────────────────────
const VALID_PROPERTY = {
  id:                   'prop-m6-uuid',
  name:                 'M6',
  internal_name:        'M6',
  address:              '18 bis rue Gambetta 91300 Massy',
  city:                 null,
  postal_code:          null,
  country_code:         null,
  latitude:             null,
  longitude:            null,
  timezone:             null,
  currency:             'EUR',
  channex_enabled:      true,
  channex_rate_plan_id: 'rp-m6',
  is_active:            true,
  mode:                 'auto',
  user_id:              'user-m6',
};

const VALID_GEOCODE_RESULT = {
  status:      'resolved',
  latitude:    48.5308,
  longitude:   2.2831,
  countryCode: 'FR',
  timezone:    'Europe/Paris',
  confidence:  0.85,
  resultType:  'building',
  provider:    'geoapify',
};

const POST_WRITE_ROW = {
  id:                   'prop-m6-uuid',
  address:              '18 bis rue Gambetta 91300 Massy',
  latitude:             '48.5308',
  longitude:            '2.2831',
  country_code:         'FR',
  timezone:             'Europe/Paris',
  currency:             'EUR',
  channex_enabled:      true,
  channex_rate_plan_id: 'rp-m6',
};

function makeMockPool({ targets = [], postRow = null } = {}) {
  return {
    async query(sql, params) {
      if (/ilike/i.test(sql))           return { rows: targets };
      if (/WHERE id = \$1/i.test(sql))  return { rows: postRow ? [postRow] : [] };
      return { rows: [], rowCount: 0 };
    },
    async end() {},
  };
}

const successWriteFn = async () => ({ written: true });

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── H3-01 : --name is mandatory ──');

await test('H3-01 CLI source exits with error when --name not provided', async () => {
  assert.ok(TOOL_SRC.includes('--name is mandatory'), 'must print "--name is mandatory"');
  assert.ok(/if\s*\(!name\)/.test(TOOL_SRC), 'must guard: if (!name)');
  assert.ok(TOOL_SRC.includes('process.exit(1)'), 'must call process.exit(1) when no name');
});

console.log('\n── H3-02 : 0 targets → abort ──');

await test('H3-02 executeMode aborts when 0 properties match', async () => {
  const pool = makeMockPool({ targets: [] });
  const result = await executeMode(pool, { name: 'M6' },
    { geocodeFn: async () => VALID_GEOCODE_RESULT, writeFn: successWriteFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/TARGET_COUNT=0/.test(result.abort), `expected TARGET_COUNT=0, got: ${result.abort}`);
});

console.log('\n── H3-03 : 2 targets → abort ──');

await test('H3-03 executeMode aborts when 2 properties match', async () => {
  const pool = makeMockPool({ targets: [VALID_PROPERTY, { ...VALID_PROPERTY, id: 'prop-m7-uuid' }] });
  const result = await executeMode(pool, { name: 'M' },
    { geocodeFn: async () => VALID_GEOCODE_RESULT, writeFn: successWriteFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/TARGET_COUNT=2/.test(result.abort), `expected TARGET_COUNT=2, got: ${result.abort}`);
});

console.log('\n── H3-04 : previewMode — no geocodeAddress call ──');

await test('H3-04 previewMode does not call geocodeAddress()', async () => {
  assert.ok(!/ geocodeAddress\s*\(/.test(previewBody),
    'previewMode must not call geocodeAddress()');
});

console.log('\n── H3-05 : previewMode — no INSERT/UPDATE/DELETE ──');

await test('H3-05 previewMode source contains no INSERT/UPDATE/DELETE SQL', async () => {
  const nonComment = previewBody.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i.test(l));
  assert.ok(!bad, 'previewMode must not contain INSERT/UPDATE/DELETE SQL');
});

console.log('\n── H3-06 : previewMode — no apify ──');

await test('H3-06 previewMode does not import or call apify scraping functions', async () => {
  assert.ok(!/require\s*\(['"].*apify/i.test(previewBody),
    'previewMode must not import apify');
  assert.ok(!/ scrapeBestZone\s*\(/.test(previewBody),
    'previewMode must not call scrapeBestZone');
  assert.ok(!/ apifyScrape\s*\(/.test(previewBody),
    'previewMode must not call apifyScrape');
});

console.log('\n── H3-07 : previewMode — no channex API calls ──');

await test('H3-07 previewMode does not reference channex imports or sync calls', async () => {
  assert.ok(!previewBody.toLowerCase().includes("require('../channex')"),
    'previewMode must not import channex');
  assert.ok(!previewBody.toLowerCase().includes('triggerchannexratessync'),
    'previewMode must not call triggerChannexRatesSync');
});

console.log('\n── H3-08 : geocodeFn called once with properties.address ──');

await test('H3-08 geocodeFn is invoked exactly once with the property address', async () => {
  const geocodeCalls = [];
  const geocodeFn = async (addr) => { geocodeCalls.push(addr); return VALID_GEOCODE_RESULT; };
  const pool = makeMockPool({ targets: [VALID_PROPERTY], postRow: POST_WRITE_ROW });
  await executeMode(pool, { name: 'M6' }, { geocodeFn, writeFn: successWriteFn });
  assert.strictEqual(geocodeCalls.length, 1, 'geocodeFn must be called exactly once');
  assert.strictEqual(geocodeCalls[0], VALID_PROPERTY.address,
    `geocodeFn must receive property.address "${VALID_PROPERTY.address}", got: "${geocodeCalls[0]}"`);
});

console.log('\n── H3-09 : geocodeFn receives address from DB row ──');

await test('H3-09 geocodeFn receives capturedAddress from DB row, not a hardcoded value', async () => {
  const CUSTOM_ADDRESS = '42 rue de la Paix, 75001 Paris, France';
  const customProp = { ...VALID_PROPERTY, address: CUSTOM_ADDRESS };
  const geocodeCalls = [];
  const geocodeFn = async (addr) => { geocodeCalls.push(addr); return VALID_GEOCODE_RESULT; };
  const pool = makeMockPool({ targets: [customProp], postRow: POST_WRITE_ROW });
  await executeMode(pool, { name: 'M6' }, { geocodeFn, writeFn: successWriteFn });
  assert.strictEqual(geocodeCalls[0], CUSTOM_ADDRESS,
    `geocodeFn must receive the DB address, got: "${geocodeCalls[0]}"`);
});

console.log('\n── H3-10 : invalid geocoder result → writeFn NOT called ──');

await test('H3-10 writeFn not called when geocodeResult is invalid (status not_found)', async () => {
  let writeCalled = false;
  const geocodeFn = async () => ({ status: 'not_found', reason: 'no_match' });
  const writeFn   = async () => { writeCalled = true; return { written: true }; };
  const pool = makeMockPool({ targets: [VALID_PROPERTY] });
  const result = await executeMode(pool, { name: 'M6' }, { geocodeFn, writeFn });
  assert.ok(!result.ok, 'must fail on invalid geocode');
  assert.ok(!writeCalled, 'writeFn must NOT be called when geocoder fails');
});

console.log('\n── H3-11 : address_stale → abort ──');

await test('H3-11 executeMode aborts when writeFn returns address_stale', async () => {
  const geocodeFn = async () => VALID_GEOCODE_RESULT;
  const writeFn   = async () => ({
    written: false, reason: 'address_stale',
    capturedAddress: VALID_PROPERTY.address, currentAddress: 'changed address',
  });
  const pool = makeMockPool({ targets: [VALID_PROPERTY] });
  const result = await executeMode(pool, { name: 'M6' }, { geocodeFn, writeFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/address_stale/.test(result.abort),
    `abort must mention address_stale, got: ${result.abort}`);
});

console.log('\n── H3-12 : geo_changed → abort ──');

await test('H3-12 executeMode aborts when writeFn returns geo_changed', async () => {
  const geocodeFn = async () => VALID_GEOCODE_RESULT;
  const writeFn   = async () => ({ written: false, reason: 'geo_changed' });
  const pool = makeMockPool({ targets: [VALID_PROPERTY] });
  const result = await executeMode(pool, { name: 'M6' }, { geocodeFn, writeFn });
  assert.ok(!result.ok, 'must fail');
  assert.ok(/geo_changed/.test(result.abort),
    `abort must mention geo_changed, got: ${result.abort}`);
});

console.log('\n── H3-13 : writeGeoResult UPDATE SET — only 4 geo columns ──');

await test('H3-13 writeGeoResult UPDATE SET contains only latitude/longitude/country_code/timezone', async () => {
  const updateMatch = writeGeoBody.match(/UPDATE properties\s+SET\s+([\s\S]+?)WHERE/);
  assert.ok(updateMatch, 'writeGeoResult must contain UPDATE properties SET ... WHERE');
  const setCols = updateMatch[1];
  assert.ok(/latitude/.test(setCols),     'SET must include latitude');
  assert.ok(/longitude/.test(setCols),    'SET must include longitude');
  assert.ok(/country_code/.test(setCols), 'SET must include country_code');
  assert.ok(/timezone/.test(setCols),     'SET must include timezone');
  assert.ok(!/currency/.test(setCols),    'SET must NOT include currency');
  assert.ok(!/address/.test(setCols),     'SET must NOT include address');
  assert.ok(!/channex/.test(setCols),     'SET must NOT include channex columns');
  assert.ok(!/is_active/.test(setCols),   'SET must NOT include is_active');
  assert.ok(!/updated_at/.test(setCols),  'SET must NOT include updated_at');
  assert.ok(!/mode/.test(setCols),        'SET must NOT include mode');
});

console.log('\n── H3-14 : writeGeoResult checks rowCount !== 1 ──');

await test('H3-14 writeGeoResult source guards on rowCount !== 1 before commit', async () => {
  assert.ok(writeGeoBody.includes('rowCount !== 1'),
    'writeGeoResult must guard on rowCount !== 1 (rollback on unexpected rowcount)');
});

console.log('\n── H3-15 : UPDATE scoped to single property by id ──');

await test('H3-15 UPDATE WHERE clause includes id preventing cross-property mutation', async () => {
  assert.ok(/UPDATE properties[\s\S]+?WHERE id = \$/.test(writeGeoBody),
    'UPDATE must be scoped with WHERE id = $param');
  assert.ok(/AND address = \$/.test(writeGeoBody),
    'UPDATE WHERE must also include AND address = $param (CAS guard)');
});

console.log('\n── H3-16 : currency unchanged post-write ──');

await test('H3-16 currency field unchanged after successful geo write', async () => {
  const pool = makeMockPool({ targets: [VALID_PROPERTY], postRow: POST_WRITE_ROW });
  const result = await executeMode(pool, { name: 'M6' },
    { geocodeFn: async () => VALID_GEOCODE_RESULT, writeFn: successWriteFn });
  assert.ok(result.ok, `executeMode must succeed, got abort: ${result.abort}`);
  assert.ok(result.currencyUnchanged,
    'currencyUnchanged must be true after geo write');
  assert.strictEqual(result.checks?.CURRENCY_UNCHANGED, true,
    'checks.CURRENCY_UNCHANGED must be true');
});

console.log('\n── H3-17 : channex columns absent from UPDATE SET ──');

await test('H3-17 UPDATE SET does not reference channex columns', async () => {
  const updateMatch = writeGeoBody.match(/UPDATE properties\s+SET\s+([\s\S]+?)WHERE/);
  assert.ok(updateMatch, 'must find UPDATE statement');
  const setCols = updateMatch[1];
  assert.ok(!/channex_enabled/.test(setCols),
    'SET must NOT include channex_enabled');
  assert.ok(!/channex_rate_plan_id/.test(setCols),
    'SET must NOT include channex_rate_plan_id');
  assert.ok(!/channex_property_id/.test(setCols),
    'SET must NOT include channex_property_id');
  assert.ok(!/channex_room_type_id/.test(setCols),
    'SET must NOT include channex_room_type_id');
});

console.log('\n── H3-18 : no market_data writes ──');

await test('H3-18 tool source contains no INSERT INTO market_data', async () => {
  const nonComment = TOOL_SRC.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /INSERT\s+INTO\s+market_data/i.test(l));
  assert.ok(!bad, 'must not contain INSERT INTO market_data');
});

console.log('\n── H3-19 : no pricing_schedule writes ──');

await test('H3-19 tool source contains no INSERT INTO / UPDATE pricing_schedule', async () => {
  const nonComment = TOOL_SRC.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /(INSERT\s+INTO|UPDATE\s+\w)\s*pricing_schedule/i.test(l));
  assert.ok(!bad, 'must not write pricing_schedule');
});

console.log('\n── H3-20 : no pricing_history / pricing_config writes ──');

await test('H3-20 tool source contains no INSERT/UPDATE for pricing_history or pricing_config', async () => {
  const nonComment = TOOL_SRC.split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l =>
    /(INSERT\s+INTO|UPDATE\s+\w+)\s*(pricing_history|pricing_config)/i.test(l));
  assert.ok(!bad, 'must not write pricing_history or pricing_config');
});

console.log('\n── H3-21 : no scheduleMarketRefresh ──');

await test('H3-21 tool source does not call scheduleMarketRefresh', async () => {
  assert.ok(!/ scheduleMarketRefresh\s*\(/.test(TOOL_SRC),
    'must not call scheduleMarketRefresh');
});

console.log('\n── H3-22 : no pricing/channex side-effect calls ──');

await test('H3-22 tool does not call runDynamicPricingForOneProperty, applyDynamicPricingForProperty, triggerChannexRatesSync, publishEffectivePricing', async () => {
  assert.ok(!/ runDynamicPricingForOneProperty\s*\(/.test(TOOL_SRC),
    'must not call runDynamicPricingForOneProperty');
  assert.ok(!/ applyDynamicPricingForProperty\s*\(/.test(TOOL_SRC),
    'must not call applyDynamicPricingForProperty');
  assert.ok(!/ triggerChannexRatesSync\s*\(/.test(TOOL_SRC),
    'must not call triggerChannexRatesSync');
  assert.ok(!/ publishEffectivePricing\s*\(/.test(TOOL_SRC),
    'must not call publishEffectivePricing');
});

console.log('\n── H3-23 : post-write market_context_key non-null ──');

await test('H3-23 result.postCtxKey is non-null and well-formed after successful geo write', async () => {
  const pool = makeMockPool({ targets: [VALID_PROPERTY], postRow: POST_WRITE_ROW });
  const result = await executeMode(pool, { name: 'M6' },
    { geocodeFn: async () => VALID_GEOCODE_RESULT, writeFn: successWriteFn });
  assert.ok(result.ok, `executeMode must succeed, got abort: ${result.abort}`);
  assert.ok(result.postCtxKey !== null && result.postCtxKey !== undefined,
    `postCtxKey must be non-null, got: ${result.postCtxKey}`);
  assert.ok(typeof result.postCtxKey === 'string' && result.postCtxKey.startsWith('FR:'),
    `postCtxKey must start with "FR:", got: ${result.postCtxKey}`);
});

console.log('\n── H3-24 : GEO_COMPLETE = true ──');

await test('H3-24 result.geoComplete = true and checks.GEO_COMPLETE = true after successful geo write', async () => {
  const pool = makeMockPool({ targets: [VALID_PROPERTY], postRow: POST_WRITE_ROW });
  const result = await executeMode(pool, { name: 'M6' },
    { geocodeFn: async () => VALID_GEOCODE_RESULT, writeFn: successWriteFn });
  assert.ok(result.ok, `executeMode must succeed, got abort: ${result.abort}`);
  assert.strictEqual(result.geoComplete, true,
    `result.geoComplete must be true, got: ${result.geoComplete}`);
  assert.strictEqual(result.checks?.GEO_COMPLETE, true,
    `checks.GEO_COMPLETE must be true, got: ${result.checks?.GEO_COMPLETE}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed  /  ${passed + failed} total`);
if (failures.length) {
  console.log('\n  Failed tests:');
  failures.forEach(f => console.log(`    ❌  ${f.name}\n       ${f.message}`));
}
console.log('');

if (failed > 0) process.exit(1);

})();

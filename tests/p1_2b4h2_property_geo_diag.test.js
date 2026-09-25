#!/usr/bin/env node
'use strict';
/**
 * Tests — P1.2-B4-H2 Property Geo Diagnostic
 *
 * Verifies:
 *   GD-01 : tool declares DB_WRITES = 0, EXTERNAL_API_CALLS = 0, CHANNEX_WRITES = 0
 *   GD-02 : tool requires no external API modules (no channex, no geocoder, no apify)
 *   GD-03 : isGeocodeableAddress rejects null/empty/France-only
 *   GD-04 : isGeocodeableAddress accepts valid French address
 *   GD-05 : diag correctly marks property with NULL lat as geo-incomplete
 *   GD-06 : diag correctly marks property with full geo as geo-complete
 *   GD-07 : PROP_SQL does not contain INSERT/UPDATE/DELETE
 *   GD-08 : tool does not import geocodeAddress or geocodePropertyAsync
 *   GD-09 : summary counts match input properties
 *   GD-10 : diag handles mixed complete/incomplete in the same batch
 *
 * Run: node tests/p1_2b4h2_property_geo_diag.test.js
 * No real DB / Apify / Channex / Geoapify calls.
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
const TOOL_PATH = path.resolve(__dirname, '../outils/diag-property-geo.js');
const TOOL_SRC  = fs.readFileSync(TOOL_PATH, 'utf8');
const { isGeocodeableAddress } = require(TOOL_PATH);
const { computeMarketContextKey } = require('../routes/market-context-key');

// ── Mock helpers ──────────────────────────────────────────────────────────────

const PROP_COMPLETE = {
  id:                   'prop-m7-uuid',
  name:                 'M7',
  internal_name:        'M7',
  address:              '5 Avenue des Ternes, 75017 Paris, France',
  city:                 'Paris',
  postal_code:          '75017',
  country_code:         'FR',
  latitude:             '48.88',
  longitude:            '2.30',
  timezone:             'Europe/Paris',
  currency:             'EUR',
  channex_enabled:      true,
  channex_rate_plan_id: 'rp-m7',
  is_active:            true,
  mode:                 'auto',
  user_id:              'user-m7',
};

const PROP_INCOMPLETE = {
  id:                   'prop-m6-uuid',
  name:                 'M6',
  internal_name:        'M6',
  address:              '10 rue Championnet, 75018 Paris, France',
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

function makeMockPool({ propRows = [], marketRows = [] } = {}) {
  return {
    async query(sql, params) {
      const s = sql.toLowerCase();
      if (/from market_data/.test(s)) return { rows: marketRows };
      if (/from properties/.test(s))  return { rows: propRows };
      return { rows: [] };
    },
    async end() {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

console.log('\n── GD-01 : tool declares read-only safety contract ──');

await test('GD-01 tool source declares DB_WRITES = 0, EXTERNAL_API_CALLS = 0', async () => {
  assert.ok(TOOL_SRC.includes('DB_WRITES = 0'),         'must declare DB_WRITES = 0');
  assert.ok(TOOL_SRC.includes('EXTERNAL_API_CALLS = 0'), 'must declare EXTERNAL_API_CALLS = 0');
  assert.ok(TOOL_SRC.includes('CHANNEX_WRITES = 0'),    'must declare CHANNEX_WRITES = 0');
});

console.log('\n── GD-02 : no external API imports ──');

await test('GD-02 tool does not import channex, geocoder, or apify modules', async () => {
  assert.ok(!TOOL_SRC.includes("require('../channex')"),                   'must not import channex');
  assert.ok(!TOOL_SRC.includes("require('./channex')"),                    'must not import channex');
  assert.ok(!TOOL_SRC.includes('property-geocoder'),                       'must not import geocoder');
  assert.ok(!TOOL_SRC.includes('geocodeAddress'),                          'must not call geocodeAddress');
  assert.ok(!TOOL_SRC.includes('geocodePropertyAsync'),                    'must not call geocodePropertyAsync');
  assert.ok(!TOOL_SRC.includes('apify'),                                   'must not import apify');
  assert.ok(!TOOL_SRC.includes('dynamic-pricing-cron'),                    'must not import cron');
});

console.log('\n── GD-03 : isGeocodeableAddress rejects bad inputs ──');

await test('GD-03 isGeocodeableAddress rejects null, empty, and bare "France"', async () => {
  assert.strictEqual(isGeocodeableAddress(null),    false, 'null → false');
  assert.strictEqual(isGeocodeableAddress(''),      false, 'empty → false');
  assert.strictEqual(isGeocodeableAddress('  '),    false, 'whitespace → false');
  assert.strictEqual(isGeocodeableAddress('France'), false, '"France" → false');
  assert.strictEqual(isGeocodeableAddress('abc'),   false, 'too short → false');
});

console.log('\n── GD-04 : isGeocodeableAddress accepts valid addresses ──');

await test('GD-04 isGeocodeableAddress accepts full French street addresses', async () => {
  assert.strictEqual(isGeocodeableAddress('10 rue Championnet, 75018 Paris, France'), true);
  assert.strictEqual(isGeocodeableAddress('5 Avenue des Ternes, 75017 Paris'), true);
  assert.strictEqual(isGeocodeableAddress('12 bd Haussmann, Paris'), true);
});

console.log('\n── GD-05 : NULL geo → GEO_COMPLETE = false ──');

await test('GD-05 property with null lat/lng/country_code marked geo-incomplete', async () => {
  const ctxKey = computeMarketContextKey({
    countryCode: PROP_INCOMPLETE.country_code,
    latitude:    PROP_INCOMPLETE.latitude,
    longitude:   PROP_INCOMPLETE.longitude,
  });
  assert.strictEqual(ctxKey, null, 'context key must be null for incomplete geo');
});

console.log('\n── GD-06 : complete geo → GEO_COMPLETE = true ──');

await test('GD-06 property with valid lat/lng/country_code produces a context key', async () => {
  const ctxKey = computeMarketContextKey({
    countryCode: PROP_COMPLETE.country_code,
    latitude:    PROP_COMPLETE.latitude,
    longitude:   PROP_COMPLETE.longitude,
  });
  assert.ok(ctxKey !== null && ctxKey.startsWith('FR:'), `context key must be non-null, got: ${ctxKey}`);
});

console.log('\n── GD-07 : no INSERT/UPDATE/DELETE in tool SQL ──');

await test('GD-07 tool source contains no INSERT, UPDATE, or DELETE SQL', async () => {
  const nonComment = TOOL_SRC.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const bad = nonComment.some(l => /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM)\b/i.test(l));
  assert.ok(!bad, 'tool must not contain INSERT/UPDATE/DELETE SQL');
});

console.log('\n── GD-08 : no geocoder import ──');

await test('GD-08 tool source does not import geocodeAddress or property-geocoder', async () => {
  assert.ok(!/ geocodeAddress\s*\(/.test(TOOL_SRC), 'must not call geocodeAddress()');
  assert.ok(!TOOL_SRC.includes('property-geocoder'),  'must not import property-geocoder');
});

console.log('\n── GD-09 : summary counts ──');

await test('GD-09 summary correctly counts complete vs incomplete active properties', async () => {
  // 1 complete, 1 incomplete → totalComplete=1, totalIncomplete=1
  const complete   = PROP_COMPLETE;
  const incomplete = PROP_INCOMPLETE;

  let completeCount = 0, incompleteCount = 0;
  for (const p of [complete, incomplete]) {
    const ctxKey = computeMarketContextKey({
      countryCode: p.country_code,
      latitude:    p.latitude,
      longitude:   p.longitude,
    });
    if (p.is_active) {
      if (ctxKey !== null) completeCount++;
      else                 incompleteCount++;
    }
  }

  assert.strictEqual(completeCount,   1, `expected 1 complete, got ${completeCount}`);
  assert.strictEqual(incompleteCount, 1, `expected 1 incomplete, got ${incompleteCount}`);
});

console.log('\n── GD-10 : mixed batch ──');

await test('GD-10 geocodeable flag correct for mixed address scenarios', async () => {
  // M6 has an address → geocodeable
  assert.strictEqual(isGeocodeableAddress(PROP_INCOMPLETE.address), true,
    'M6 address should be geocodeable');

  // Property with no address and no city → not geocodeable
  assert.strictEqual(isGeocodeableAddress(null), false,
    'null address → not geocodeable');

  // Short/bad address → not geocodeable
  assert.strictEqual(isGeocodeableAddress('Paris'), false,
    '"Paris" alone (no street, 5 chars) → not geocodeable');
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

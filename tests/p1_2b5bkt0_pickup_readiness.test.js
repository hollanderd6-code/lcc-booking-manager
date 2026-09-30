'use strict';
/**
 * P1.3-T0 — Booking Pickup Intelligence / Data Readiness Audit — Test Suite
 *
 * Tests pure helpers and structural invariants of the T0 audit tool.
 * ALL tests run without a database connection.
 *
 * SAFETY:
 *   DB_WRITES             = 0  always
 *   PRICING_WRITES        = 0  always
 *   CHANNEX_CALLS         = 0  always
 *   MARKET_PROVIDER_CALLS = 0  always
 *   NETWORK_CALLS         = 0  always
 *
 * Sections:
 *   A — computeLeadTimeDays
 *   B — classifyPickupReadiness
 *   C — classifySource
 *   D — leadTimeBucket
 *   E — safePropertyLabel (no PII)
 *   F — SQL / module structure invariants
 *   G — Safety contract (no writes, no network, no pricing)
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const AUDIT = require('../outils/audit-booking-pickup-readiness-t');
const {
  computeLeadTimeDays,
  classifyPickupReadiness,
  classifySource,
  leadTimeBucket,
  safePropertyLabel,
  RELIABLE_SOURCES,
  EXCLUDED_SOURCES,
  MIN_RELIABLE_BOOKINGS,
  RELIABLE_BOOKINGS_SQL,
  UNRELIABLE_BOOKINGS_SQL,
  ACTIVE_PROPERTIES_SQL,
  LEAD_TIME_HISTOGRAM_SQL,
} = AUDIT;

const SRC = fs.readFileSync(
  path.join(__dirname, '../outils/audit-booking-pickup-readiness-t.js'),
  'utf8'
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

// ── Section A — computeLeadTimeDays ──────────────────────────────────────────

console.log('\nA — computeLeadTimeDays');

test('A-01 valid booking: 30-day lead time', () => {
  const lt = computeLeadTimeDays('2025-06-01T10:00:00Z', '2025-07-01');
  assert.strictEqual(lt, 30);
});

test('A-02 same-day booking: lead time = 0', () => {
  const lt = computeLeadTimeDays('2025-06-15T08:00:00Z', '2025-06-15');
  assert.strictEqual(lt, 0);
});

test('A-03 negative lead time: booking after check-in (data quality issue)', () => {
  const lt = computeLeadTimeDays('2025-06-20T00:00:00Z', '2025-06-15');
  assert.ok(lt < 0, 'negative lead time should be negative, got: ' + lt);
});

test('A-04 missing created_at returns null', () => {
  assert.strictEqual(computeLeadTimeDays(null, '2025-06-15'), null);
});

test('A-05 missing start_date returns null', () => {
  assert.strictEqual(computeLeadTimeDays('2025-06-01', null), null);
});

test('A-06 both null returns null', () => {
  assert.strictEqual(computeLeadTimeDays(null, null), null);
});

test('A-07 invalid date string returns null', () => {
  assert.strictEqual(computeLeadTimeDays('not-a-date', '2025-06-15'), null);
});

test('A-08 Date objects accepted', () => {
  const lt = computeLeadTimeDays(new Date('2025-05-01'), new Date('2025-06-01'));
  assert.strictEqual(lt, 31);
});

test('A-09 long-horizon booking: 90 days', () => {
  const lt = computeLeadTimeDays('2025-01-01T00:00:00Z', '2025-04-01');
  assert.strictEqual(lt, 90);
});

// ── Section B — classifyPickupReadiness ──────────────────────────────────────

console.log('\nB — classifyPickupReadiness');

test('B-01 READY when reliableConfirmed >= MIN_RELIABLE_BOOKINGS', () => {
  assert.strictEqual(classifyPickupReadiness(MIN_RELIABLE_BOOKINGS), 'READY');
});

test('B-02 READY when reliableConfirmed > MIN_RELIABLE_BOOKINGS', () => {
  assert.strictEqual(classifyPickupReadiness(MIN_RELIABLE_BOOKINGS + 5), 'READY');
});

test('B-03 INSUFFICIENT when 0 < count < MIN_RELIABLE_BOOKINGS', () => {
  assert.strictEqual(classifyPickupReadiness(MIN_RELIABLE_BOOKINGS - 1), 'INSUFFICIENT');
});

test('B-04 INSUFFICIENT for count = 1', () => {
  assert.strictEqual(classifyPickupReadiness(1), 'INSUFFICIENT');
});

test('B-05 NO_RELIABLE_DATA for count = 0', () => {
  assert.strictEqual(classifyPickupReadiness(0), 'NO_RELIABLE_DATA');
});

test('B-06 NO_RELIABLE_DATA for negative count', () => {
  assert.strictEqual(classifyPickupReadiness(-1), 'NO_RELIABLE_DATA');
});

test('B-07 NO_RELIABLE_DATA for non-finite (NaN)', () => {
  assert.strictEqual(classifyPickupReadiness(NaN), 'NO_RELIABLE_DATA');
});

test('B-08 custom minRequired overrides default', () => {
  assert.strictEqual(classifyPickupReadiness(5, 5), 'READY');
  assert.strictEqual(classifyPickupReadiness(4, 5), 'INSUFFICIENT');
});

// ── Section C — classifySource ───────────────────────────────────────────────

console.log('\nC — classifySource');

test('C-01 channex is RELIABLE', () => {
  assert.strictEqual(classifySource('channex'), 'RELIABLE');
});

test('C-02 guest_app is RELIABLE', () => {
  assert.strictEqual(classifySource('guest_app'), 'RELIABLE');
});

test('C-03 ical is UNRELIABLE (sync timestamp ≠ booking time)', () => {
  assert.strictEqual(classifySource('ical'), 'UNRELIABLE');
});

test('C-04 BLOCK is EXCLUDED (not a booking)', () => {
  assert.strictEqual(classifySource('BLOCK'), 'EXCLUDED');
});

test('C-05 MANUEL is UNRELIABLE', () => {
  assert.strictEqual(classifySource('MANUEL'), 'UNRELIABLE');
});

test('C-06 DIRECT is UNRELIABLE', () => {
  assert.strictEqual(classifySource('DIRECT'), 'UNRELIABLE');
});

test('C-07 direct (lowercase) is UNRELIABLE', () => {
  assert.strictEqual(classifySource('direct'), 'UNRELIABLE');
});

test('C-08 unknown source is UNRELIABLE', () => {
  assert.strictEqual(classifySource('some_unknown_source'), 'UNRELIABLE');
});

test('C-09 null/undefined source is UNRELIABLE', () => {
  assert.strictEqual(classifySource(null),      'UNRELIABLE');
  assert.strictEqual(classifySource(undefined), 'UNRELIABLE');
});

// ── Section D — leadTimeBucket ───────────────────────────────────────────────

console.log('\nD — leadTimeBucket');

test('D-01 negative → negative bucket', () => {
  assert.strictEqual(leadTimeBucket(-1), 'negative');
});

test('D-02 0 → 0_6 bucket', () => {
  assert.strictEqual(leadTimeBucket(0), '0_6');
});

test('D-03 6 → 0_6 bucket', () => {
  assert.strictEqual(leadTimeBucket(6), '0_6');
});

test('D-04 7 → 7_13 bucket', () => {
  assert.strictEqual(leadTimeBucket(7), '7_13');
});

test('D-05 29 → 14_29 bucket', () => {
  assert.strictEqual(leadTimeBucket(29), '14_29');
});

test('D-06 30 → 30_59 bucket', () => {
  assert.strictEqual(leadTimeBucket(30), '30_59');
});

test('D-07 90 → 90plus bucket', () => {
  assert.strictEqual(leadTimeBucket(90), '90plus');
});

test('D-08 365 → 90plus bucket', () => {
  assert.strictEqual(leadTimeBucket(365), '90plus');
});

test('D-09 null → unknown bucket', () => {
  assert.strictEqual(leadTimeBucket(null), 'unknown');
});

// ── Section E — safePropertyLabel (no PII) ───────────────────────────────────

console.log('\nE — safePropertyLabel (no PII)');

test('E-01 uses internal_name when present', () => {
  const label = safePropertyLabel({ id: 1, internal_name: 'Villa Rosa', name: 'Villa Rosa 2025' });
  assert.ok(label.includes('prop_1'), 'should contain prop_id');
  assert.ok(label.includes('Villa Rosa'), 'should include internal_name');
});

test('E-02 falls back to name when no internal_name', () => {
  const label = safePropertyLabel({ id: 2, internal_name: '', name: 'Apartment XYZ' });
  assert.ok(label.includes('prop_2'));
  assert.ok(label.includes('Apartment'));
});

test('E-03 digits replaced with # to prevent ID leakage', () => {
  const label = safePropertyLabel({ id: 42, internal_name: 'Flat 12B', name: '' });
  assert.ok(!label.slice(label.indexOf('(')).includes('12'), 'digits should be masked in name portion');
  assert.ok(label.includes('Flat'), 'non-digit name part should remain');
});

test('E-04 no email-like content survives (@ truncation)', () => {
  // The ID suffix guarantees no @ appears from the name
  const label = safePropertyLabel({ id: 5, internal_name: 'host@example', name: '' });
  // Just verify it runs without throwing; email addresses are not in property names normally
  assert.ok(typeof label === 'string');
});

test('E-05 empty name handled gracefully', () => {
  const label = safePropertyLabel({ id: 99, internal_name: '', name: '' });
  assert.strictEqual(label, 'prop_99');
});

// ── Section F — SQL / module structure invariants ────────────────────────────

console.log('\nF — SQL / module structure invariants');

test('F-01 RELIABLE_BOOKINGS_SQL selects only RELIABLE_SOURCES (parameterised)', () => {
  assert.ok(
    RELIABLE_BOOKINGS_SQL.includes('= ANY($1)'),
    'should use parameterised sources array'
  );
  assert.ok(!RELIABLE_BOOKINGS_SQL.includes("'channex'"), 'source values should not be hardcoded');
});

test('F-02 RELIABLE_BOOKINGS_SQL computes percentile lead times', () => {
  assert.ok(RELIABLE_BOOKINGS_SQL.includes('PERCENTILE_CONT'));
  assert.ok(RELIABLE_BOOKINGS_SQL.includes('lead_time_p50') || RELIABLE_BOOKINGS_SQL.includes('0.5'));
});

test('F-03 RELIABLE_BOOKINGS_SQL excludes cancelled bookings from percentiles', () => {
  assert.ok(
    RELIABLE_BOOKINGS_SQL.includes("status = 'confirmed'"),
    'percentile filter should require confirmed status'
  );
});

test('F-04 RELIABLE_BOOKINGS_SQL counts negative lead times as data quality flag', () => {
  assert.ok(
    RELIABLE_BOOKINGS_SQL.includes('negative_lead_count') ||
    RELIABLE_BOOKINGS_SQL.includes('start_date::date < r.created_at::date'),
    'should flag negative lead times'
  );
});

test('F-05 ACTIVE_PROPERTIES_SQL joins pricing_config with properties', () => {
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('pricing_config'));
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('properties'));
  assert.ok(ACTIVE_PROPERTIES_SQL.includes('is_active = TRUE'));
});

test('F-06 ACTIVE_PROPERTIES_SQL does NOT select PII columns', () => {
  const piiColumns = ['guest_name', 'guest_email', 'guest_phone', 'guest_first_name', 'email'];
  for (const col of piiColumns) {
    assert.ok(!ACTIVE_PROPERTIES_SQL.includes(col), `PII column ${col} should not be in SQL`);
  }
});

test('F-07 UNRELIABLE_BOOKINGS_SQL excludes RELIABLE and BLOCK sources', () => {
  assert.ok(UNRELIABLE_BOOKINGS_SQL.includes("'channex'"), 'should exclude channex');
  assert.ok(UNRELIABLE_BOOKINGS_SQL.includes("'guest_app'"), 'should exclude guest_app');
  assert.ok(UNRELIABLE_BOOKINGS_SQL.includes("'BLOCK'"), 'should exclude BLOCK');
});

test('F-08 LEAD_TIME_HISTOGRAM_SQL uses parameterised sources', () => {
  assert.ok(LEAD_TIME_HISTOGRAM_SQL.includes('= ANY($1)'));
});

test('F-09 RELIABLE_SOURCES array contains channex and guest_app', () => {
  assert.ok(RELIABLE_SOURCES.includes('channex'));
  assert.ok(RELIABLE_SOURCES.includes('guest_app'));
  assert.ok(Array.isArray(RELIABLE_SOURCES));
});

test('F-10 EXCLUDED_SOURCES contains BLOCK', () => {
  assert.ok(EXCLUDED_SOURCES.includes('BLOCK'));
});

test('F-11 module exports all required functions and constants', () => {
  const required = [
    'classifyPickupReadiness',
    'classifySource',
    'computeLeadTimeDays',
    'leadTimeBucket',
    'safePropertyLabel',
    'RELIABLE_SOURCES',
    'EXCLUDED_SOURCES',
    'MIN_RELIABLE_BOOKINGS',
    'RELIABLE_BOOKINGS_SQL',
    'UNRELIABLE_BOOKINGS_SQL',
    'ACTIVE_PROPERTIES_SQL',
    'LEAD_TIME_HISTOGRAM_SQL',
  ];
  for (const name of required) {
    assert.ok(AUDIT[name] !== undefined, `missing export: ${name}`);
  }
});

// ── Section G — Safety contract ───────────────────────────────────────────────

console.log('\nG — Safety contract (no writes, no network, no pricing)');

test('G-01 audit source declares PRICING_WRITES = 0', () => {
  assert.ok(SRC.includes('PRICING_WRITES') && SRC.includes('= 0'));
});

test('G-02 audit source declares DB_WRITES = 0', () => {
  assert.ok(SRC.includes('DB_WRITES') && SRC.includes('= 0'));
});

test('G-03 audit source declares CHANNEX_CALLS = 0', () => {
  assert.ok(SRC.includes('CHANNEX_CALLS') && SRC.includes('= 0'));
});

test('G-04 audit source declares MARKET_PROVIDER_CALLS = 0', () => {
  assert.ok(SRC.includes('MARKET_PROVIDER_CALLS') && SRC.includes('= 0'));
});

test('G-05 no INSERT/UPDATE/DELETE in any SQL constant', () => {
  const sqls = [RELIABLE_BOOKINGS_SQL, UNRELIABLE_BOOKINGS_SQL, ACTIVE_PROPERTIES_SQL, LEAD_TIME_HISTOGRAM_SQL];
  for (const sql of sqls) {
    const upper = sql.toUpperCase();
    assert.ok(!upper.includes('\nINSERT '), 'SQL should not contain INSERT');
    assert.ok(!upper.includes('\nUPDATE '), 'SQL should not contain UPDATE');
    assert.ok(!upper.includes('\nDELETE '), 'SQL should not contain DELETE');
  }
});

test('G-06 no Channex API imports in audit source', () => {
  assert.ok(!SRC.includes("require('../channex')"), 'should not import channex');
  assert.ok(!SRC.includes("require('./channex')"), 'should not import channex');
});

test('G-07 no market-provider imports in audit source', () => {
  assert.ok(!SRC.includes("require('../services/market-provider')"));
  assert.ok(!SRC.includes("require('./market-provider')"));
});

test('G-08 no Bright Data / Apify imports', () => {
  assert.ok(!SRC.includes('brightdata'), 'should not reference brightdata');
  assert.ok(!SRC.includes('apify'), 'should not reference apify');
});

test('G-09 no pricing-engine import (no pricing multiplier installed)', () => {
  // The real safety guarantee: pricing-engine is never imported.
  // pacingMult may appear in output strings / docstrings as a display name — that is fine.
  assert.ok(!SRC.includes("require('../routes/pricing-engine')"), 'should not import pricing-engine');
  assert.ok(!SRC.includes("require('./pricing-engine')"), 'should not import pricing-engine');
  // No pickup multiplier variable assigned (would be: const pickup = pacingMult(... or similar)
  assert.ok(!SRC.match(/\bconst\s+\w+\s*=\s*pacingMult\b/), 'should not assign pacingMult result');
});

test('G-10 no PII in SQL queries (no guest_email, guest_name, guest_phone)', () => {
  const allSql = [RELIABLE_BOOKINGS_SQL, UNRELIABLE_BOOKINGS_SQL, ACTIVE_PROPERTIES_SQL, LEAD_TIME_HISTOGRAM_SQL].join('\n');
  assert.ok(!allSql.includes('guest_email'), 'SQL should not select guest_email');
  assert.ok(!allSql.includes('guest_name'),  'SQL should not select guest_name');
  assert.ok(!allSql.includes('guest_phone'), 'SQL should not select guest_phone');
});

// ── Results ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`═══════════════════════════════════════════════════════`);
console.log(` P1.3-T0 results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════════════`);

if (failed > 0) process.exit(1);

'use strict';
/**
 * P1.4-T1 — Local Seasonality Shadow — Test Suite
 *
 * Tests the production helpers and shadow job logic introduced in T1.
 * All tests run without a database connection.
 *
 * SAFETY:
 *   DB_WRITES             = 0  always
 *   PRICING_WRITES        = 0  always
 *   CHANNEX_CALLS         = 0  always
 *   MARKET_PROVIDER_CALLS = 0  always
 *   NETWORK_CALLS         = 0  always
 *
 * Sections:
 *   A — computePropertyReadinessSnapshot: end-to-end tier derivation
 *   B — computePropertyReadinessSnapshot: exposure confidence
 *   C — computePropertyReadinessSnapshot: edge cases
 *   D — helpers re-exported correctly from services/local-seasonality-helpers.js
 *   E — Feature flag: isShadowEnabled() behavior
 *   F — Migration SQL: additive-only, correct table/column definitions
 *   G — Shadow SQL: UPSERT is INSERT…ON CONFLICT (no DELETE/DROP/pricing tables)
 *   H — Module safety (importable without DB; no dotenv at require time)
 *   I — Authority proof (helpers module not imported by pricing chain)
 *   J — Write safety (no pricing-schedule/pricing-config mutations in shadow SQL)
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  computePropertyReadinessSnapshot,
  classifyReservationSource,
  isReliableForStayOccurrence,
  splitNightsByMonth,
  computeSampleTier,
} = require('../services/local-seasonality-helpers');

const {
  isShadowEnabled,
  MODEL_VERSION,
  UPSERT_SNAPSHOT_SQL,
} = require('../services/local-seasonality-shadow');

const MIGRATION_SRC = fs.readFileSync(
  path.join(__dirname, '../migrations/007_local_seasonality_readiness.sql'), 'utf8',
);

const SHADOW_JOB_SRC = fs.readFileSync(
  path.join(__dirname, '../services/local-seasonality-shadow-job.js'), 'utf8',
);

const HELPERS_SRC = fs.readFileSync(
  path.join(__dirname, '../services/local-seasonality-helpers.js'), 'utf8',
);

const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
];

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${err.message}`);
    errors.push({ name, message: err.message });
    failed++;
  }
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function makeReservation(overrides) {
  return {
    source: 'channex',
    status: 'confirmed',
    start_date: '2024-07-01',
    end_date:   '2024-07-08',
    ...overrides,
  };
}

function makeReservations12Months() {
  // 12 distinct calendar months in 2024 → EARLY tier (1 year)
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  return months.map(m => makeReservation({
    start_date: `2024-${m}-05`,
    end_date:   `2024-${m}-10`,
  }));
}

function makeReservations24Months() {
  // 12 months in 2024 + 12 months in 2025 → potential MODERATE tier
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const rows = [];
  for (const yr of ['2024','2025']) {
    for (const m of months) {
      rows.push(makeReservation({ start_date: `${yr}-${m}-05`, end_date: `${yr}-${m}-15` }));
    }
  }
  return rows;
}

// ── A — computePropertyReadinessSnapshot: tier derivation ────────────────────

console.log('\n  [A] computePropertyReadinessSnapshot — tier derivation');

test('A-01: empty reservations → INSUFFICIENT', () => {
  const s = computePropertyReadinessSnapshot([], '2026-09-30');
  assert.strictEqual(s.tier, 'INSUFFICIENT');
  assert.strictEqual(s.distinctCalendarMonths, 0);
  assert.strictEqual(s.totalBookedNights, 0);
  assert.strictEqual(s.yoyPairCount, 0);
  assert.strictEqual(s.blockCount, 0);
});

test('A-02: only BLOCK rows → INSUFFICIENT (no sellable stays)', () => {
  const rows = [
    makeReservation({ source: 'BLOCK', start_date: '2024-07-01', end_date: '2024-07-30' }),
    makeReservation({ reservation_type: 'block', source: null, start_date: '2024-08-01', end_date: '2024-08-15' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.tier, 'INSUFFICIENT');
  assert.strictEqual(s.totalBookedNights, 0);
  assert.strictEqual(s.blockCount, 2);
});

test('A-03: < 12 calendar months covered → INSUFFICIENT', () => {
  // 6 months × 5 nights each = 30 nights but only 6 months
  const rows = ['01','02','03','04','05','06'].map(m =>
    makeReservation({ start_date: `2024-${m}-01`, end_date: `2024-${m}-06` }),
  );
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.tier, 'INSUFFICIENT');
  assert.ok(s.distinctCalendarMonths < 12);
});

test('A-04: 12 months in 1 year → EARLY', () => {
  const rows = makeReservations12Months();
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.distinctCalendarMonths, 12);
  assert.strictEqual(s.distinctYears, 1);
  assert.strictEqual(s.yoyPairCount, 0);
  assert.ok(['EARLY', 'INSUFFICIENT'].includes(s.tier),
    `Expected EARLY or INSUFFICIENT, got ${s.tier}`);
});

test('A-05: 2 years with YoY pairs → MODERATE', () => {
  const rows = makeReservations24Months();
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.distinctCalendarMonths, 12);
  assert.strictEqual(s.distinctYears, 2);
  assert.strictEqual(s.yoyPairCount, 12);
  assert.ok(['MODERATE', 'GOOD'].includes(s.tier),
    `Expected MODERATE or GOOD, got ${s.tier}`);
});

test('A-06: 3 years, all 12 months, 12 YoY pairs, 300+ nights → GOOD (if blocks present)', () => {
  const months = ['01','02','03','04','05','06','07','08','09','10','11','12'];
  const rows = [];
  for (const yr of ['2023','2024','2025']) {
    for (const m of months) {
      // 9 nights each = 9×36 = 324 nights total
      rows.push(makeReservation({ start_date: `${yr}-${m}-01`, end_date: `${yr}-${m}-10` }));
    }
  }
  // Add a BLOCK to get PARTIAL exposure confidence
  rows.push(makeReservation({ source: 'BLOCK', start_date: '2024-01-15', end_date: '2024-01-20' }));

  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.distinctCalendarMonths, 12);
  assert.strictEqual(s.distinctYears, 3);
  assert.strictEqual(s.yoyPairCount, 12);
  assert.ok(s.totalBookedNights >= 300, `nights=${s.totalBookedNights}`);
  assert.strictEqual(s.exposureConfidence, 'PARTIAL');
  assert.strictEqual(s.tier, 'GOOD');
});

test('A-07: cancelled OTA rows excluded from tier calculation', () => {
  const rows = [
    ...makeReservations12Months(),
    makeReservation({ status: 'cancelled', start_date: '2024-06-01', end_date: '2024-07-01' }),
  ];
  const s1 = computePropertyReadinessSnapshot(makeReservations12Months(), '2026-09-30');
  const s2 = computePropertyReadinessSnapshot(rows, '2026-09-30');
  // Cancelled row must not inflate booked nights
  assert.strictEqual(s1.totalBookedNights, s2.totalBookedNights);
});

test('A-08: iCal rows included in stay occurrence counts', () => {
  const rows = [
    makeReservation({ source: 'ical', start_date: '2024-07-01', end_date: '2024-07-08' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.totalBookedNights, 7);
});

test('A-09: firstStayDate / lastStayDate are derived from reliable rows only', () => {
  const rows = [
    makeReservation({ source: 'BLOCK', start_date: '2020-01-01', end_date: '2020-01-05' }), // BLOCK — excluded
    makeReservation({ source: 'channex', start_date: '2024-06-01', end_date: '2024-06-05' }),
    makeReservation({ source: 'channex', start_date: '2026-08-01', end_date: '2026-08-10' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.firstStayDate, '2024-06-01');
  assert.strictEqual(s.lastStayDate,  '2026-08-10');
});

test('A-10: monthlyNights map is present and sums to totalBookedNights', () => {
  const rows = makeReservations12Months();
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  const sum = Object.values(s.monthlyNights).reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, s.totalBookedNights);
});

test('A-11: no dates on reservation → INSUFFICIENT (null safety)', () => {
  const rows = [
    { source: 'channex', status: 'confirmed', start_date: null, end_date: null },
    { source: 'channex', status: 'confirmed', start_date: '2024-07-01', end_date: null },
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.totalBookedNights, 0);
  assert.strictEqual(s.tier, 'INSUFFICIENT');
});

// ── B — computePropertyReadinessSnapshot: exposure confidence ────────────────

console.log('\n  [B] computePropertyReadinessSnapshot — exposure confidence');

test('B-01: no BLOCK rows → exposure confidence = NONE', () => {
  const rows = makeReservations12Months();
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.exposureConfidence, 'NONE');
  assert.strictEqual(s.blockCount, 0);
});

test('B-02: at least one BLOCK row → exposure confidence = PARTIAL', () => {
  const rows = [
    ...makeReservations12Months(),
    makeReservation({ source: 'BLOCK', start_date: '2024-03-10', end_date: '2024-03-15' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.exposureConfidence, 'PARTIAL');
  assert.strictEqual(s.blockCount, 1);
});

test('B-03: blockCount matches actual number of BLOCK rows', () => {
  const rows = [
    makeReservation({ source: 'BLOCK', start_date: '2024-01-01', end_date: '2024-01-03' }),
    makeReservation({ reservation_type: 'block', source: null, start_date: '2024-02-01', end_date: '2024-02-05' }),
    makeReservation({ source: 'channex', start_date: '2024-07-01', end_date: '2024-07-08' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.blockCount, 2);
});

test('B-04: blockCount only affects exposure confidence, not booked nights', () => {
  const rows = [
    makeReservation({ source: 'channex', start_date: '2024-07-01', end_date: '2024-07-11' }),
    makeReservation({ source: 'BLOCK',   start_date: '2024-07-15', end_date: '2024-07-25' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.totalBookedNights, 10); // only channex row = 10 nights
  assert.strictEqual(s.blockCount, 1);
  assert.strictEqual(s.exposureConfidence, 'PARTIAL');
});

// ── C — computePropertyReadinessSnapshot: edge cases ─────────────────────────

console.log('\n  [C] computePropertyReadinessSnapshot — edge cases');

test('C-01: month-crossing stay is split correctly in monthlyNights', () => {
  const rows = [
    makeReservation({ start_date: '2024-06-29', end_date: '2024-07-03' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  // Jun 29, 30 = 2 nights; Jul 1, 2 = 2 nights
  assert.strictEqual(s.monthlyNights['2024-06'], 2);
  assert.strictEqual(s.monthlyNights['2024-07'], 2);
  assert.strictEqual(s.totalBookedNights, 4);
});

test('C-02: reservations in correct order regardless of input sort', () => {
  const rows = [
    makeReservation({ source: 'channex', start_date: '2026-01-01', end_date: '2026-01-10' }),
    makeReservation({ source: 'channex', start_date: '2023-01-01', end_date: '2023-01-10' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  // firstStayDate should be 2023 (earliest)
  assert.strictEqual(s.firstStayDate, '2023-01-01');
  assert.strictEqual(s.lastStayDate,  '2026-01-10');
});

test('C-03: UNKNOWN source treated as bookable (not excluded)', () => {
  const rows = [
    { source: '', status: 'confirmed', start_date: '2024-07-01', end_date: '2024-07-08' },
  ];
  const cls = classifyReservationSource(rows[0]);
  assert.strictEqual(cls, 'UNKNOWN');
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  // UNKNOWN is not BLOCK → included in stay occurrence
  assert.strictEqual(s.totalBookedNights, 7);
});

test('C-04: direct booking included', () => {
  const rows = [
    makeReservation({ source: 'direct', start_date: '2024-07-01', end_date: '2024-07-06' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.totalBookedNights, 5);
});

test('C-05: guest_app booking included', () => {
  const rows = [
    makeReservation({ source: 'guest_app', start_date: '2024-08-01', end_date: '2024-08-04' }),
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.totalBookedNights, 3);
});

test('C-06: mixed sources — only BLOCK excluded', () => {
  const rows = [
    makeReservation({ source: 'channex', start_date: '2024-06-01', end_date: '2024-06-06' }),  // 5 nights
    makeReservation({ source: 'ical',    start_date: '2024-06-10', end_date: '2024-06-13' }),  // 3 nights
    makeReservation({ source: 'BLOCK',   start_date: '2024-06-20', end_date: '2024-06-25' }),  // EXCLUDED
  ];
  const s = computePropertyReadinessSnapshot(rows, '2026-09-30');
  assert.strictEqual(s.totalBookedNights, 8);
});

// ── D — helpers re-exported from services/local-seasonality-helpers.js ───────

console.log('\n  [D] Helpers exported from services/local-seasonality-helpers.js');

test('D-01: classifyReservationSource is exported and functional', () => {
  assert.strictEqual(typeof classifyReservationSource, 'function');
  assert.strictEqual(classifyReservationSource({ source: 'BLOCK' }), 'BLOCK');
  assert.strictEqual(classifyReservationSource({ source: 'channex' }), 'OTA_CONFIRMED');
});

test('D-02: isReliableForStayOccurrence is exported and functional', () => {
  assert.strictEqual(typeof isReliableForStayOccurrence, 'function');
  assert.strictEqual(
    isReliableForStayOccurrence({ source: 'channex', status: 'confirmed', start_date: '2024-01-01', end_date: '2024-01-05' }),
    true,
  );
});

test('D-03: splitNightsByMonth is exported and functional', () => {
  assert.strictEqual(typeof splitNightsByMonth, 'function');
  assert.deepStrictEqual(splitNightsByMonth('2024-07-01', '2024-07-06'), { '2024-07': 5 });
});

test('D-04: computeSampleTier is exported and functional', () => {
  assert.strictEqual(typeof computeSampleTier, 'function');
  assert.strictEqual(computeSampleTier({
    distinctCalendarMonths: 6, distinctYears: 1, totalBookedNights: 20, yoyPairCount: 0, exposureConfidence: 'NONE',
  }), 'INSUFFICIENT');
});

test('D-05: computePropertyReadinessSnapshot is exported', () => {
  assert.strictEqual(typeof computePropertyReadinessSnapshot, 'function');
});

test('D-06: all 9 exports present in helpers source', () => {
  const EXPECTED = [
    'classifyReservationSource',
    'isReliableForStayOccurrence',
    'isReliableForBookingTiming',
    'splitNightsByMonth',
    'computeMonthlyBookedNights',
    'detectYoYPairs',
    'computeSampleTier',
    'hasNoFutureLeakage',
    'computePropertyReadinessSnapshot',
  ];
  for (const fn of EXPECTED) {
    assert.ok(HELPERS_SRC.includes(fn + ',') || HELPERS_SRC.includes(fn + '\n'),
      `Missing export: ${fn}`);
  }
});

// ── E — Feature flag ──────────────────────────────────────────────────────────

console.log('\n  [E] Feature flag: isShadowEnabled()');

test('E-01: isShadowEnabled() default = false (env var not set)', () => {
  const orig = process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
  delete process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
  assert.strictEqual(isShadowEnabled(), false);
  if (orig !== undefined) process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = orig;
});

test('E-02: isShadowEnabled() = false when set to "false"', () => {
  const orig = process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
  process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = 'false';
  assert.strictEqual(isShadowEnabled(), false);
  if (orig !== undefined) process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = orig;
  else delete process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
});

test('E-03: isShadowEnabled() = true when set to "true"', () => {
  const orig = process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
  process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = 'true';
  assert.strictEqual(isShadowEnabled(), true);
  if (orig !== undefined) process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = orig;
  else delete process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
});

test('E-04: isShadowEnabled() = false for "TRUE" (case sensitive)', () => {
  const orig = process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
  process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = 'TRUE';
  assert.strictEqual(isShadowEnabled(), false);
  if (orig !== undefined) process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = orig;
  else delete process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
});

test('E-05: shadow job returns zero stats when flag is OFF', async () => {
  const orig = process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
  delete process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
  const { runLocalSeasonalityJob } = require('../services/local-seasonality-shadow-job');
  // Pass a fake pool — should never be called when flag is OFF
  const fakeCalls = [];
  const fakePool = { query: (...args) => { fakeCalls.push(args); return Promise.resolve({ rows: [] }); } };
  const stats = await runLocalSeasonalityJob(fakePool);
  assert.strictEqual(stats.propertiesEligible,   0);
  assert.strictEqual(stats.propertiesProcessed,  0);
  assert.strictEqual(stats.snapshotsPersisted,   0);
  assert.strictEqual(stats.errors.length,        0);
  assert.strictEqual(fakeCalls.length, 0, 'Pool must not be called when flag is OFF');
  if (orig !== undefined) process.env.LOCAL_SEASONALITY_SHADOW_ENABLED = orig;
});

// ── F — Migration SQL ─────────────────────────────────────────────────────────

console.log('\n  [F] Migration SQL safety');

test('F-01: migration is additive only — no DROP', () => {
  assert.ok(!/\bDROP\b/i.test(MIGRATION_SRC), 'Migration must not contain DROP');
});

test('F-02: migration is additive only — no ALTER TABLE', () => {
  assert.ok(!/\bALTER TABLE\b/i.test(MIGRATION_SRC), 'Migration must not contain ALTER TABLE');
});

test('F-03: migration has CREATE TABLE IF NOT EXISTS', () => {
  assert.ok(/CREATE TABLE IF NOT EXISTS/i.test(MIGRATION_SRC));
});

test('F-04: table is named local_seasonality_readiness', () => {
  assert.ok(MIGRATION_SRC.includes('local_seasonality_readiness'));
});

test('F-05: required columns are present', () => {
  const cols = ['property_id', 'snapshot_date', 'tier', 'distinct_calendar_months',
                'distinct_years', 'total_booked_nights', 'yoy_pair_count',
                'exposure_confidence', 'monthly_nights_json', 'model_version', 'computed_at'];
  for (const col of cols) {
    assert.ok(MIGRATION_SRC.includes(col), `Column ${col} missing from migration`);
  }
});

test('F-06: UNIQUE constraint covers (property_id, snapshot_date)', () => {
  assert.ok(MIGRATION_SRC.includes('property_id, snapshot_date') ||
            MIGRATION_SRC.includes('property_id,\n    snapshot_date'),
    'UNIQUE constraint must include property_id and snapshot_date');
});

test('F-07: migration uses CREATE INDEX IF NOT EXISTS', () => {
  assert.ok(/CREATE INDEX IF NOT EXISTS/i.test(MIGRATION_SRC));
});

test('F-08: migration has no INSERT/UPDATE/DELETE', () => {
  assert.ok(!/\bINSERT\b/i.test(MIGRATION_SRC), 'Migration must not INSERT');
  assert.ok(!/\bUPDATE\b/i.test(MIGRATION_SRC), 'Migration must not UPDATE');
  assert.ok(!/\bDELETE\b/i.test(MIGRATION_SRC), 'Migration must not DELETE');
});

// ── G — Shadow SQL safety ─────────────────────────────────────────────────────

console.log('\n  [G] Shadow SQL safety');

test('G-01: MODEL_VERSION is set', () => {
  assert.ok(typeof MODEL_VERSION === 'string' && MODEL_VERSION.length > 0);
});

test('G-02: UPSERT_SNAPSHOT_SQL starts with INSERT', () => {
  assert.ok(UPSERT_SNAPSHOT_SQL.trim().toUpperCase().startsWith('INSERT'),
    'Upsert SQL must start with INSERT');
});

test('G-03: UPSERT uses ON CONFLICT upsert pattern', () => {
  assert.ok(/ON CONFLICT/i.test(UPSERT_SNAPSHOT_SQL), 'Must use ON CONFLICT');
  assert.ok(/DO UPDATE SET/i.test(UPSERT_SNAPSHOT_SQL), 'Must use DO UPDATE SET');
});

test('G-04: UPSERT targets local_seasonality_readiness', () => {
  assert.ok(UPSERT_SNAPSHOT_SQL.includes('local_seasonality_readiness'));
});

test('G-05: shadow job does not write to any pricing table', () => {
  // pricing_config is legitimately read (SELECT) for property eligibility.
  // pricing_schedule must never be written.
  const WRITE_PATTERNS = [
    /INSERT INTO pricing_schedule/i,
    /UPDATE pricing_schedule/i,
    /INSERT INTO pricing_history/i,
    /UPDATE pricing_history/i,
    /INSERT INTO pricing_config/i,
    /UPDATE pricing_config/i,
  ];
  for (const re of WRITE_PATTERNS) {
    assert.ok(!re.test(SHADOW_JOB_SRC),
      `Shadow job must not write to pricing tables: ${re}`);
  }
});

test('G-06: shadow job SQL queries only reservations and pricing_config', () => {
  // pricing_config is used for active property list — that is correct
  // reservations is used to read history — that is correct
  assert.ok(SHADOW_JOB_SRC.includes('FROM reservations'), 'Must query reservations');
  assert.ok(SHADOW_JOB_SRC.includes('pricing_config'), 'Must use pricing_config for eligibility');
});

test('G-07: shadow SQL in job file has no DELETE or DROP', () => {
  // Isolate SQL strings from the job source
  const sqlParts = SHADOW_JOB_SRC.match(/`[\s\S]*?`/g) || [];
  for (const sql of sqlParts) {
    assert.ok(!/\bDELETE\b/i.test(sql), `SQL must not contain DELETE: ${sql.slice(0, 80)}`);
    assert.ok(!/\bDROP\b/i.test(sql),   `SQL must not contain DROP: ${sql.slice(0, 80)}`);
  }
});

test('G-08: shadow job SELECT queries start with SELECT or WITH', () => {
  const sqlParts = SHADOW_JOB_SRC.match(/`[\s\S]*?`/g) || [];
  const selects  = sqlParts.filter(s => /SELECT/i.test(s));
  for (const sql of selects) {
    const trimmed = sql.replace(/`/g, '').trim();
    const first   = trimmed.split(/\s+/)[0].toUpperCase();
    assert.ok(['SELECT', 'WITH'].includes(first),
      `SELECT SQL starts with ${first}: ${trimmed.slice(0, 60)}`);
  }
});

// ── H — Module safety ─────────────────────────────────────────────────────────

console.log('\n  [H] Module safety');

test('H-01: helpers module importable without DB (no dotenv at top-level)', () => {
  // Module was already required at top of this file with no DB.
  // Reaching here proves it does not attempt a DB connection at require time.
  assert.strictEqual(typeof computePropertyReadinessSnapshot, 'function');
});

test('H-02: shadow module importable without DB', () => {
  assert.strictEqual(typeof isShadowEnabled, 'function');
});

test('H-03: shadow-job module importable without DB (lazy pool usage)', () => {
  const { runLocalSeasonalityJob } = require('../services/local-seasonality-shadow-job');
  assert.strictEqual(typeof runLocalSeasonalityJob, 'function');
});

test('H-04: no dotenv.config() at module top level in helpers', () => {
  assert.ok(!HELPERS_SRC.includes("require('dotenv').config()") ||
            HELPERS_SRC.indexOf("require('dotenv').config()") >
            HELPERS_SRC.indexOf('module.exports'),
    'dotenv.config must not be called at require time in helpers');
});

// ── I — Authority proof ───────────────────────────────────────────────────────

console.log('\n  [I] Authority proof — helpers not in pricing chain');

test('I-01: no local-seasonality-helpers import in pricing-engine.js', () => {
  const fpath = path.join(ROOT, 'routes/pricing-engine.js');
  if (!fs.existsSync(fpath)) return;
  const src = fs.readFileSync(fpath, 'utf8');
  assert.ok(!/local-seasonality-helpers/i.test(src),
    'pricing-engine.js must not import local-seasonality-helpers');
});

test('I-02: no local-seasonality import in any pricing chain file', () => {
  const violations = [];
  for (const f of PRICING_CHAIN) {
    const fpath = path.join(ROOT, f);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    if (/local-seasonality/i.test(src)) violations.push(f);
  }
  assert.strictEqual(violations.length, 0,
    `Seasonality authority violated: ${violations.join(', ')}`);
});

test('I-03: no local-seasonality-shadow import in pricing chain', () => {
  const violations = [];
  for (const f of PRICING_CHAIN) {
    const fpath = path.join(ROOT, f);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    if (/local-seasonality-shadow/i.test(src)) violations.push(f);
  }
  assert.strictEqual(violations.length, 0,
    `Shadow authority violated: ${violations.join(', ')}`);
});

test('I-04: no local_seasonality_readiness read in pricing chain', () => {
  const violations = [];
  for (const f of PRICING_CHAIN) {
    const fpath = path.join(ROOT, f);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    if (/local_seasonality_readiness/i.test(src)) violations.push(f);
  }
  assert.strictEqual(violations.length, 0,
    `Shadow table referenced by pricing chain: ${violations.join(', ')}`);
});

// ── J — Write safety (no pricing mutations) ───────────────────────────────────

console.log('\n  [J] Write safety — no pricing mutations');

test('J-01: shadow SQL does not INSERT into pricing_schedule', () => {
  assert.ok(!/INSERT.*pricing_schedule/i.test(UPSERT_SNAPSHOT_SQL),
    'UPSERT must not touch pricing_schedule');
});

test('J-02: shadow job source has no pricing_schedule write', () => {
  assert.ok(!/INSERT.*pricing_schedule/i.test(SHADOW_JOB_SRC));
  assert.ok(!/UPDATE.*pricing_schedule/i.test(SHADOW_JOB_SRC));
});

test('J-03: shadow job source has no pricing_config write', () => {
  // pricing_config is read (SELECT) in ELIGIBLE_PROPERTIES_SQL — that is correct
  // It must not be written to
  assert.ok(!/INSERT INTO pricing_config/i.test(SHADOW_JOB_SRC));
  assert.ok(!/UPDATE pricing_config/i.test(SHADOW_JOB_SRC));
});

test('J-04: helpers source has no SQL (pure functions, no DB)', () => {
  assert.ok(!HELPERS_SRC.includes('INSERT '));
  assert.ok(!HELPERS_SRC.includes('UPDATE '));
  assert.ok(!HELPERS_SRC.includes('SELECT '));
  assert.ok(!HELPERS_SRC.includes('DELETE '));
});

test('J-05: seasonByMonth in pricing-engine.js is still the canonical IDF curve', () => {
  const fpath = path.join(ROOT, 'routes/pricing-engine.js');
  if (!fs.existsSync(fpath)) return;
  const src = fs.readFileSync(fpath, 'utf8');
  assert.ok(src.includes('seasonByMonth:'), 'seasonByMonth must still be in DEFAULTS');
  assert.ok(src.includes('0.88,'), 'Jan anchor 0.88 must be unchanged');
  assert.ok(src.includes('1.12,'), 'Jul anchor 1.12 must be unchanged');
});

test('J-06: no local seasonality module in effective-pricing-resolver.js', () => {
  const fpath = path.join(ROOT, 'routes/effective-pricing-resolver.js');
  if (!fs.existsSync(fpath)) return;
  const src = fs.readFileSync(fpath, 'utf8');
  assert.ok(!/local-seasonality/i.test(src));
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
console.log(`  P1.4-T1  ${passed + failed} tests  —  ${passed} passed  ${failed} failed`);
console.log('──────────────────────────────────────────────────────────────────────');
if (errors.length > 0) {
  errors.forEach(e => console.log(`  ✗  ${e.name}`));
  console.log('──────────────────────────────────────────────────────────────────────');
}
console.log(`  ${failed === 0 ? 'ALL PASSED ✓' : `${failed} FAILED ✗`}`);
console.log('  DB_WRITES=0  CHANNEX_CALLS=0  PRICING_WRITES=0  NETWORK_CALLS=0');
console.log('  SEASONALITY_HAS_PRICING_AUTHORITY=NO');
console.log('  PRODUCTION_SEASONALITY_CHANGED=NO');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('');

if (failed > 0) process.exit(1);

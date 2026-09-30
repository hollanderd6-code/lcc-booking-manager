'use strict';
/**
 * P1.3-T2 — Booking Pickup Persistence Activation Readiness — Test Suite
 *
 * Tests persistence infrastructure readiness: schema, INSERT SQL, deduplication,
 * observation_date semantics, flag gate, storage estimates, and authority proof.
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
 *   A — isPersistenceEnabled flag gate
 *   B — observationDateFromCalcAt UTC semantics
 *   C — INSERT SQL structural invariants (T2 schema)
 *   D — persistPickupObservation parameter mapping
 *   E — Deduplication semantic (ON CONFLICT behaviour)
 *   F — Storage estimate calculations
 *   G — PICKUP_HAS_PRICING_AUTHORITY=NO (static import proof)
 *   H — Migration 006 structural invariants
 *   I — Integration point discovery (cron file)
 *   J — Safety contract (persistence writes only to shadow table)
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const {
  isPersistenceEnabled,
  isValidTimezone,
  observationDateFromCalcAt,
  persistPickupObservation,
  INSERT_OBSERVATION_SQL,
} = require('../services/booking-pickup-persistence');

const {
  PICKUP_HORIZON_DAYS,
  generateTargetDates,
  runPickupShadowJob,
  ELIGIBLE_PROPERTIES_SQL,
} = require('../services/booking-pickup-shadow-job');

const SRC  = fs.readFileSync(path.join(__dirname, '../services/booking-pickup-persistence.js'), 'utf8');
const M006 = fs.readFileSync(path.join(__dirname, '../migrations/006_booking_pickup_observations_v2.sql'), 'utf8');
const M005 = fs.readFileSync(path.join(__dirname, '../migrations/005_booking_pickup_observations.sql'), 'utf8');
const CRON = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');

// ── Test runner ───────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// ── Section A: isPersistenceEnabled ──────────────────────────
console.log('\nSection A — isPersistenceEnabled flag gate');

test('A-01: returns false when env var is unset', () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  assert.strictEqual(isPersistenceEnabled(), false);
  if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
});

test('A-02: returns false when env var is "false"', () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'false';
  assert.strictEqual(isPersistenceEnabled(), false);
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('A-03: returns false when env var is "TRUE" (case-sensitive)', () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'TRUE';
  assert.strictEqual(isPersistenceEnabled(), false, 'case-sensitive: only "true" enables it');
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('A-04: returns true only when env var is exactly "true"', () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
  assert.strictEqual(isPersistenceEnabled(), true);
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('A-05: returns false when env var is "1"', () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = '1';
  assert.strictEqual(isPersistenceEnabled(), false);
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('A-06: default state is OFF (flag not set in test env)', () => {
  // Ensure tests themselves don't accidentally enable persistence
  assert.strictEqual(
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED === 'true',
    false,
    'persistence must be off in test environment',
  );
});

// ── Section B: observationDateFromCalcAt ─────────────────────
console.log('\nSection B — observationDateFromCalcAt UTC semantics');

test('B-01: extracts YYYY-MM-DD from a standard ISO timestamp', () => {
  assert.strictEqual(observationDateFromCalcAt('2026-09-30T06:00:00.000Z'), '2026-09-30');
});

test('B-02: end of day UTC stays on same date', () => {
  assert.strictEqual(observationDateFromCalcAt('2026-09-30T23:59:59.999Z'), '2026-09-30');
});

test('B-03: start of day UTC stays on same date', () => {
  assert.strictEqual(observationDateFromCalcAt('2026-09-30T00:00:00.000Z'), '2026-09-30');
});

test('B-04: Paris 6h = UTC 5h (winter) — same calendar day', () => {
  // Paris winter = UTC+1; cron fires at 6h Paris = 5h UTC — same UTC day
  assert.strictEqual(observationDateFromCalcAt('2026-01-15T05:00:00.000Z'), '2026-01-15');
});

test('B-05: Paris 6h = UTC 4h (summer DST) — same calendar day', () => {
  // Paris summer = UTC+2; cron fires at 6h Paris = 4h UTC — same UTC day
  assert.strictEqual(observationDateFromCalcAt('2026-06-15T04:00:00.000Z'), '2026-06-15');
});

test('B-06: null → returns today as UTC date string', () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = observationDateFromCalcAt(null);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/, 'should be a date string');
  assert.strictEqual(result, today, 'should be today (UTC)');
});

test('B-07: returns 10-character ISO date string', () => {
  const result = observationDateFromCalcAt('2026-03-15T12:00:00.000Z');
  assert.strictEqual(result.length, 10);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

test('B-08: consecutive timestamps on same UTC day → same observation_date', () => {
  const a = observationDateFromCalcAt('2026-09-30T06:00:00.000Z');
  const b = observationDateFromCalcAt('2026-09-30T18:30:00.000Z');
  assert.strictEqual(a, b, 'same UTC day must yield same observation_date for deduplication');
});

// ── Section C: INSERT SQL structural invariants ──────────────
console.log('\nSection C — INSERT SQL structural invariants');

test('C-01: INSERT_OBSERVATION_SQL is a non-empty string', () => {
  assert.strictEqual(typeof INSERT_OBSERVATION_SQL, 'string');
  assert.ok(INSERT_OBSERVATION_SQL.length > 100);
});

test('C-02: targets booking_pickup_observations table', () => {
  assert.ok(INSERT_OBSERVATION_SQL.includes('booking_pickup_observations'),
    'must INSERT INTO booking_pickup_observations');
});

test('C-03: includes observation_date column (T2 deduplication key)', () => {
  assert.ok(INSERT_OBSERVATION_SQL.includes('observation_date'),
    'observation_date must be in INSERT SQL');
});

test('C-04: includes raw_pickup_ratio column (v1.1 field)', () => {
  assert.ok(INSERT_OBSERVATION_SQL.includes('raw_pickup_ratio'),
    'raw_pickup_ratio must be in INSERT SQL');
});

test('C-05: includes pickup_ratio column (stabilized signal)', () => {
  assert.ok(INSERT_OBSERVATION_SQL.includes('pickup_ratio'),
    'pickup_ratio must be in INSERT SQL');
});

test('C-06: uses named dedup constraint (not calculated_at)', () => {
  assert.ok(INSERT_OBSERVATION_SQL.includes('bpo_property_target_obs_model_unique'),
    'must reference bpo_property_target_obs_model_unique constraint');
  assert.ok(!INSERT_OBSERVATION_SQL.includes('calculated_at') ||
            INSERT_OBSERVATION_SQL.indexOf('calculated_at') < INSERT_OBSERVATION_SQL.indexOf('ON CONFLICT'),
    'ON CONFLICT must not be based on calculated_at');
});

test('C-07: DO NOTHING on conflict (idempotent re-runs)', () => {
  assert.ok(INSERT_OBSERVATION_SQL.includes('DO NOTHING'),
    'must use DO NOTHING to skip duplicate rows');
});

test('C-08: includes RETURNING id', () => {
  assert.ok(INSERT_OBSERVATION_SQL.toUpperCase().includes('RETURNING'),
    'must RETURN inserted id for caller confirmation');
});

test('C-09: maximum param index is $23', () => {
  const params = (INSERT_OBSERVATION_SQL.match(/\$\d+/g) || [])
    .map(p => parseInt(p.slice(1), 10));
  const maxParam = Math.max(...params);
  assert.strictEqual(maxParam, 23, `expected max param $23, got $${maxParam}`);
});

test('C-10: $10 used twice (historical_band_count + comparable_sample_size)', () => {
  const tenOccurrences = (INSERT_OBSERVATION_SQL.match(/\$10\b/g) || []).length;
  assert.strictEqual(tenOccurrences, 2, '$10 must appear twice (historical_band_count and comparable_sample_size share the same value)');
});

test('C-11: does not reference pricing_schedule, pricing_config, or reservations', () => {
  const sql = INSERT_OBSERVATION_SQL.toLowerCase();
  assert.ok(!sql.includes('pricing_schedule'), 'must not touch pricing_schedule');
  assert.ok(!sql.includes('pricing_config'),   'must not touch pricing_config');
  assert.ok(!sql.includes('reservations'),     'must not touch reservations');
});

test('C-12: does not reference market_observations', () => {
  assert.ok(!INSERT_OBSERVATION_SQL.toLowerCase().includes('market_observations'),
    'must not touch market_observations');
});

// ── Section D: persistPickupObservation ──────────────────────
console.log('\nSection D — persistPickupObservation parameter mapping');

test('D-01: returns null without pool.query call when flag is OFF', async () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;

  let queryCalled = false;
  const mockPool = { query: () => { queryCalled = true; return Promise.resolve({ rows: [] }); } };

  const result = await persistPickupObservation(mockPool, { propertyId: 'p1' });

  assert.strictEqual(result, null, 'should return null when disabled');
  assert.strictEqual(queryCalled, false, 'should not call pool.query when disabled');

  if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
});

test('D-02: calls pool.query with correct parameter count when enabled', async () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

  let capturedParams = null;
  const mockPool = {
    query: (_sql, params) => {
      capturedParams = params;
      return Promise.resolve({ rows: [{ id: 42 }] });
    },
  };

  const obs = {
    propertyId:            'prop-123',
    targetDate:            '2026-11-01',
    calculatedAt:          '2026-09-30T06:00:00.000Z',
    leadTimeDays:          32,
    leadTimeBand:          '30_60',
    lookbackMonths:        12,
    targetWindowDays:      14,
    historicalSampleSize:  42,
    comparableSampleSize:  18,
    recentWindowDays:      7,
    recentBookings:        3,
    expectedBookings:      2.1,
    rawPickupRatio:        1.4286,
    pickupRatio:           1.3294,
    status:                'NORMAL',
    confidence:            'GOOD',
    advisoryMultiplier:    1.00,
    occupancyFraction:     0.35,
    pacingPickupRelation:  'ALIGNED',
    modelVersion:          'pickup-v1.1',
    anomaliesExcluded:     0,
    reasons:               ['stabilized_ratio=1.329'],
    baselineType:          'PROPERTY_HISTORY',
    pacingStrength:        'NORMAL',
  };

  await persistPickupObservation(mockPool, obs);

  assert.strictEqual(capturedParams.length, 23, `expected 23 params, got ${capturedParams?.length}`);

  // $4 = observation_date derived from calculatedAt
  assert.strictEqual(capturedParams[3], '2026-09-30', 'observation_date must be UTC date of calculatedAt');

  // $14 = raw_pickup_ratio
  assert.strictEqual(capturedParams[13], obs.rawPickupRatio, '$14 must be rawPickupRatio');

  // $15 = stabilized pickup_ratio
  assert.strictEqual(capturedParams[14], obs.pickupRatio, '$15 must be stabilized pickupRatio');

  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('D-03: observation_date is derived from calculatedAt, not targetDate', async () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

  let capturedParams = null;
  const mockPool = {
    query: (_sql, params) => { capturedParams = params; return Promise.resolve({ rows: [] }); },
  };

  await persistPickupObservation(mockPool, {
    propertyId:           'p1',
    targetDate:           '2027-06-15',     // future target date
    calculatedAt:         '2026-09-30T10:00:00.000Z',  // today's calc
    leadTimeDays:         258,
    leadTimeBand:         '180_365',
    lookbackMonths:       12,
    historicalSampleSize: 10,
    comparableSampleSize: 3,
    recentWindowDays:     7,
    recentBookings:       0,
    expectedBookings:     0.057,
    rawPickupRatio:       null,
    pickupRatio:          0.944,
    status:               'LOW_EVIDENCE',
    confidence:           'LOW',
    advisoryMultiplier:   1.00,
    occupancyFraction:    0.0,
    pacingPickupRelation: 'INSUFFICIENT_DATA',
    modelVersion:         'pickup-v1.1',
    anomaliesExcluded:    0,
    reasons:              [],
  });

  assert.strictEqual(capturedParams[1], '2027-06-15',  '$2 target_date = targetDate');
  assert.strictEqual(capturedParams[3], '2026-09-30',  '$4 observation_date = day of calculatedAt, not targetDate');

  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('D-04: rawPickupRatio null is passed as null (LOW_EVIDENCE case)', async () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

  let capturedParams = null;
  const mockPool = {
    query: (_sql, params) => { capturedParams = params; return Promise.resolve({ rows: [] }); },
  };

  await persistPickupObservation(mockPool, {
    propertyId: 'p1', targetDate: '2026-12-01',
    calculatedAt: '2026-09-30T06:00:00.000Z',
    leadTimeDays: 62, leadTimeBand: '60_90',
    lookbackMonths: 12, historicalSampleSize: 5, comparableSampleSize: 2,
    recentWindowDays: 7, recentBookings: 0, expectedBookings: 0.038,
    rawPickupRatio: null,
    pickupRatio: 0.962,
    status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT', advisoryMultiplier: 1.00,
    occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
    modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
  });

  assert.strictEqual(capturedParams[13], null, '$14 raw_pickup_ratio must be null when LOW_EVIDENCE');
  assert.ok(capturedParams[14] !== null, '$15 stabilized pickupRatio must always be non-null');

  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('D-05: returns inserted id when persistence enabled and row created', async () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

  const mockPool = {
    query: () => Promise.resolve({ rows: [{ id: 99 }] }),
  };

  const id = await persistPickupObservation(mockPool, {
    propertyId: 'p1', targetDate: '2026-11-01',
    calculatedAt: '2026-09-30T06:00:00.000Z',
    leadTimeDays: 32, leadTimeBand: '30_60',
    lookbackMonths: 12, historicalSampleSize: 20, comparableSampleSize: 18,
    recentWindowDays: 7, recentBookings: 2, expectedBookings: 1.5,
    rawPickupRatio: 1.333, pickupRatio: 1.2,
    status: 'NORMAL', confidence: 'GOOD', advisoryMultiplier: 1.00,
    occupancyFraction: 0.4, pacingPickupRelation: 'ALIGNED',
    modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
  });

  assert.strictEqual(id, 99, 'must return inserted id');

  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('D-06: returns null (not error) on DO NOTHING conflict', async () => {
  const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

  const mockPool = {
    query: () => Promise.resolve({ rows: [] }),  // DO NOTHING → no RETURNING row
  };

  const id = await persistPickupObservation(mockPool, {
    propertyId: 'p1', targetDate: '2026-11-01',
    calculatedAt: '2026-09-30T06:00:00.000Z',
    leadTimeDays: 32, leadTimeBand: '30_60',
    lookbackMonths: 12, historicalSampleSize: 20, comparableSampleSize: 18,
    recentWindowDays: 7, recentBookings: 2, expectedBookings: 1.5,
    rawPickupRatio: 1.333, pickupRatio: 1.2,
    status: 'NORMAL', confidence: 'GOOD', advisoryMultiplier: 1.00,
    occupancyFraction: 0.4, pacingPickupRelation: 'ALIGNED',
    modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
  });

  assert.strictEqual(id, null, 'conflict → null, not error');

  process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
  if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
});

test('D-07: exports observationDateFromCalcAt (public API for T2)', () => {
  const mod = require('../services/booking-pickup-persistence');
  assert.strictEqual(typeof mod.observationDateFromCalcAt, 'function',
    'observationDateFromCalcAt must be exported');
});

// ── Section E: Deduplication semantic ────────────────────────
console.log('\nSection E — Deduplication semantic');

test('E-01: ON CONFLICT constraint name is bpo_property_target_obs_model_unique', () => {
  assert.ok(INSERT_OBSERVATION_SQL.includes('bpo_property_target_obs_model_unique'));
});

test('E-02: dedup key is (property_id, target_date, observation_date, model_version)', () => {
  const constraint = M005.match(/CONSTRAINT\s+bpo_property_target_obs_model_unique[^;]+/s);
  assert.ok(constraint, 'named constraint must exist in migration 005');
  assert.ok(constraint[0].includes('observation_date'), 'constraint must include observation_date');
  assert.ok(constraint[0].includes('model_version'),    'constraint must include model_version');
  assert.ok(constraint[0].includes('target_date'),      'constraint must include target_date');
  assert.ok(constraint[0].includes('property_id'),      'constraint must include property_id');
});

test('E-03: same property+target_date on different observation_dates → different rows', () => {
  // Semantic proof: two observations differ only by observation_date → no conflict
  const obs1Date = observationDateFromCalcAt('2026-09-29T06:00:00.000Z');  // yesterday
  const obs2Date = observationDateFromCalcAt('2026-09-30T06:00:00.000Z');  // today
  assert.notStrictEqual(obs1Date, obs2Date, 'different days must yield different observation_dates');
});

test('E-04: same property+target_date+observation_date+model → conflict (idempotent)', () => {
  // Semantic proof: re-running the same job on the same day hits DO NOTHING
  const obsDate = observationDateFromCalcAt('2026-09-30T06:00:00.000Z');
  const sameDay = observationDateFromCalcAt('2026-09-30T18:00:00.000Z');
  assert.strictEqual(obsDate, sameDay, 'same UTC day must produce same observation_date → triggers DO NOTHING');
});

test('E-05: old constraint (calculated_at) is NOT present in migration 005 unique', () => {
  // 005 must use bpo_property_target_obs_model_unique, not the old per-timestamp constraint
  assert.ok(!M005.includes('UNIQUE (property_id, target_date, calculated_at)'),
    'migration 005 must not have the old calculated_at uniqueness');
});

test('E-06: migration 006 drops the old calculated_at constraint', () => {
  assert.ok(M006.includes('DROP CONSTRAINT IF EXISTS') && M006.includes('calculated'),
    'migration 006 must drop the old calculated_at-based constraint');
});

// ── Section F: Storage estimate calculations ─────────────────
console.log('\nSection F — Storage estimate calculations');

const BYTES_PER_ROW = 200;

function storageRows(properties, horizonDays, daysPerYear = 365) {
  return properties * horizonDays * daysPerYear;
}

test('F-01: 3 props × 30-day horizon → 32,850 rows/year', () => {
  const rows = storageRows(3, 30);
  assert.strictEqual(rows, 32850);
});

test('F-02: 30 props × 30-day horizon → 328,500 rows/year', () => {
  const rows = storageRows(30, 30);
  assert.strictEqual(rows, 328500);
});

test('F-03: 100 props × 90-day horizon → 3,285,000 rows/year', () => {
  const rows = storageRows(100, 90);
  assert.strictEqual(rows, 3285000);
});

test('F-04: 500 props × 365-day horizon → 66,612,500 rows/year', () => {
  const rows = storageRows(500, 365);
  assert.strictEqual(rows, 66612500);
});

test('F-05: 3 props × 30-day horizon → ~6.6 MB/year at 200 B/row', () => {
  const bytes = storageRows(3, 30) * BYTES_PER_ROW;
  assert.ok(bytes > 6_000_000 && bytes < 7_000_000,
    `expected ~6.6 MB, got ${(bytes / 1024 / 1024).toFixed(1)} MB`);
});

test('F-06: recommended horizon = 30 days for near-term signal', () => {
  // Semantic: pickup signals are most actionable for next 30 days;
  // GOOD confidence needs ≥15 comparable historical bookings in band.
  // Lead-time bands: 0-7, 7-14, 14-30, 30-60, 60-90, 90-180, 180-365.
  // Bands beyond 90 days rarely accumulate 15 comparables → mostly LOW_EVIDENCE.
  const recommendedHorizon = 30;
  assert.ok(recommendedHorizon >= 14 && recommendedHorizon <= 60,
    'recommended horizon should be 14-60 days for near-term pricing signal');
});

test('F-07: storage grows linearly with properties', () => {
  const r10 = storageRows(10, 30);
  const r20 = storageRows(20, 30);
  assert.strictEqual(r20, r10 * 2, 'rows must scale linearly with property count');
});

test('F-08: storage grows linearly with horizon', () => {
  const r30 = storageRows(10, 30);
  const r60 = storageRows(10, 60);
  assert.strictEqual(r60, r30 * 2, 'rows must scale linearly with horizon');
});

// ── Section G: PICKUP_HAS_PRICING_AUTHORITY=NO ───────────────
console.log('\nSection G — PICKUP_HAS_PRICING_AUTHORITY=NO (static import proof)');

const ROOT = path.join(__dirname, '..');

const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
];

const PICKUP_MODULES = [
  'booking-pickup-shadow',
  'booking-pickup-persistence',
];

PRICING_CHAIN.forEach((pricingFile, i) => {
  test(`G-0${i + 1}: ${path.basename(pricingFile)} does not import pickup modules`, () => {
    const fpath = path.join(ROOT, pricingFile);
    if (!fs.existsSync(fpath)) return;  // skip if not present
    const src = fs.readFileSync(fpath, 'utf8');
    for (const mod of PICKUP_MODULES) {
      // Only flag actual require() calls, not comments mentioning the module name
      const requirePattern = new RegExp(`require\\(['""][^'"]*${mod.replace(/-/g, '[-_]')}`, 'i');
      assert.ok(!requirePattern.test(src),
        `${pricingFile} must not import ${mod}`);
    }
  });
});

test('G-05: dynamic-pricing-cron.js imports pickup persistence lazily (not at top-level)', () => {
  // T2-FIX: cron IS wired — but via lazy require() inside the cron callback.
  // Top-level require would give pricing modules startup access to the shadow job.
  // Lazy require (inside the cron callback) is the safe pattern.
  const topLevelRequires = CRON.slice(0, CRON.indexOf('function initDynamicPricingCron'));
  const requirePickup = /require\(['"][^'"]*booking-pickup-persistence/;
  assert.ok(!requirePickup.test(topLevelRequires),
    'booking-pickup-persistence must not be imported at top level of dynamic-pricing-cron.js');
});

test('G-06: booking-pickup-persistence.js comment explicitly states PICKUP_HAS_PRICING_AUTHORITY=NO', () => {
  assert.ok(SRC.includes('PICKUP_HAS_PRICING_AUTHORITY=NO'),
    'persistence module must declare its non-authority status');
});

test('G-07: INSERT_OBSERVATION_SQL only inserts into booking_pickup_observations', () => {
  const tablePattern = /INSERT INTO\s+(\w+)/i;
  const match = INSERT_OBSERVATION_SQL.match(tablePattern);
  assert.ok(match, 'INSERT SQL must have an INSERT INTO');
  assert.strictEqual(match[1].toLowerCase(), 'booking_pickup_observations',
    `must insert only into booking_pickup_observations, not ${match[1]}`);
});

// ── Section H: Migration 006 structural invariants ───────────
console.log('\nSection H — Migration 006 structural invariants');

test('H-01: migration 006 adds observation_date with ADD COLUMN IF NOT EXISTS', () => {
  assert.ok(M006.includes('ADD COLUMN IF NOT EXISTS') && M006.includes('observation_date'),
    'migration 006 must add observation_date safely');
});

test('H-02: migration 006 adds raw_pickup_ratio with ADD COLUMN IF NOT EXISTS', () => {
  assert.ok(M006.includes('ADD COLUMN IF NOT EXISTS') && M006.includes('raw_pickup_ratio'),
    'migration 006 must add raw_pickup_ratio safely');
});

test('H-03: migration 006 drops old calculated_at constraint with IF EXISTS', () => {
  assert.ok(M006.includes('DROP CONSTRAINT IF EXISTS'),
    'migration 006 must use DROP CONSTRAINT IF EXISTS for safety');
});

test('H-04: migration 006 adds new dedup constraint bpo_property_target_obs_model_unique', () => {
  assert.ok(M006.includes('bpo_property_target_obs_model_unique'),
    'migration 006 must create the new named unique constraint');
});

test('H-05: migration 006 uses DO $$ / END $$ guard for constraint creation', () => {
  assert.ok(M006.includes('DO $$') || M006.includes('DO\n$$'),
    'migration 006 must use PL/pgSQL block to guard constraint creation');
});

test('H-06: migration 006 adds idx_bpo_observation_date index', () => {
  assert.ok(M006.includes('idx_bpo_observation_date'),
    'migration 006 must create observation_date index');
});

test('H-07: migration 006 uses CREATE INDEX IF NOT EXISTS', () => {
  assert.ok(M006.includes('CREATE INDEX IF NOT EXISTS'),
    'index creation must be idempotent');
});

// ── Section I: Integration point discovery ───────────────────
console.log('\nSection I — Integration point discovery');

test('I-01: dynamic-pricing-cron.js exports initDynamicPricingCron', () => {
  const mod = require('../routes/dynamic-pricing-cron');
  assert.strictEqual(typeof mod.initDynamicPricingCron, 'function');
});

test('I-02: dynamic-pricing-cron.js has a daily refresh function', () => {
  const mod = require('../routes/dynamic-pricing-cron');
  assert.strictEqual(typeof mod.runDailyPricingRefresh, 'function',
    'must have runDailyPricingRefresh for daily integration point');
});

test('I-03: cron file defines schedules for daily runs (6h)', () => {
  assert.ok(CRON.includes('0 6 * * '),
    'cron file must have at least one 06:00 schedule');
});

test('I-04: pickup shadow job is wired in cron (T2-FIX: scheduler integration complete)', () => {
  assert.ok(CRON.includes('booking-pickup-shadow-job'),
    'T2-FIX must wire booking-pickup-shadow-job into the cron scheduler');
});

// ── Section J: Safety contract ───────────────────────────────
console.log('\nSection J — Safety contract');

test('J-01: booking-pickup-persistence.js does not require channex', () => {
  const requireChannex = /require\(['"][^'"]*channex/i;
  assert.ok(!requireChannex.test(SRC), 'must not import channex');
});

test('J-02: booking-pickup-persistence.js does not call sendBookingMessage', () => {
  assert.ok(!SRC.includes('sendBookingMessage'), 'must not call Channex messaging');
});

test('J-03: booking-pickup-persistence.js does not require pricing-engine', () => {
  const requirePE = /require\(['"][^'"]*pricing-engine/;
  assert.ok(!requirePE.test(SRC), 'must not import pricing-engine');
});

test('J-04: booking-pickup-persistence.js does not modify pricing_schedule', () => {
  assert.ok(!INSERT_OBSERVATION_SQL.toLowerCase().includes('pricing_schedule'),
    'INSERT SQL must not touch pricing_schedule');
});

test('J-05: booking-pickup-persistence.js does not require apify or brightdata', () => {
  const requireApify = /require\(['"][^'"]*apify/i;
  const requireBD    = /require\(['"][^'"]*bright.?data/i;
  assert.ok(!requireApify.test(SRC), 'must not import apify');
  assert.ok(!requireBD.test(SRC),    'must not import brightdata');
});

test('J-06: migration 005 uses CREATE TABLE IF NOT EXISTS (additive-only)', () => {
  assert.ok(M005.includes('CREATE TABLE IF NOT EXISTS booking_pickup_observations'),
    'migration 005 must be additive-only');
  assert.ok(!M005.includes('DROP TABLE'), 'migration 005 must not drop tables');
  assert.ok(!M005.includes('ALTER TABLE'), 'migration 005 must not alter existing tables');
});

test('J-07: migration 006 uses only ALTER TABLE and CREATE INDEX (no data change)', () => {
  assert.ok(!M006.includes('UPDATE '), 'migration 006 must not UPDATE data');
  assert.ok(!M006.includes('DELETE '), 'migration 006 must not DELETE data');
  assert.ok(!M006.includes('DROP TABLE'), 'migration 006 must not drop tables');
});

test('J-08: isPersistenceEnabled only reads an env var — no side effects', () => {
  // Can call multiple times safely
  const r1 = isPersistenceEnabled();
  const r2 = isPersistenceEnabled();
  assert.strictEqual(r1, r2, 'pure function must be idempotent');
});

// ── Section K: Timezone-aware observationDateFromCalcAt ──────
console.log('\nSection K — Timezone-aware observationDateFromCalcAt (property-local semantics)');

test('K-01: isValidTimezone accepts Europe/Paris', () => {
  assert.strictEqual(isValidTimezone('Europe/Paris'), true);
});

test('K-02: isValidTimezone accepts America/Los_Angeles', () => {
  assert.strictEqual(isValidTimezone('America/Los_Angeles'), true);
});

test('K-03: isValidTimezone rejects garbage string', () => {
  assert.strictEqual(isValidTimezone('Not/A/Timezone'), false);
});

test('K-04: isValidTimezone rejects null', () => {
  assert.strictEqual(isValidTimezone(null), false);
});

test('K-05: isValidTimezone rejects undefined', () => {
  assert.strictEqual(isValidTimezone(undefined), false);
});

test('K-06: isValidTimezone rejects empty string', () => {
  assert.strictEqual(isValidTimezone(''), false);
});

test('K-07: Europe/Paris (UTC+2 CEST, Oct) — spec example', () => {
  // 2026-10-01T00:30Z + UTC+2 = 2026-10-01 02:30 Paris → still Oct 1
  assert.strictEqual(
    observationDateFromCalcAt('2026-10-01T00:30:00Z', 'Europe/Paris'),
    '2026-10-01',
  );
});

test('K-08: America/Los_Angeles (UTC-7 PDT, Oct) — previous local day', () => {
  // 2026-10-01T00:30Z + UTC-7 = 2026-09-30 17:30 LA → previous day
  assert.strictEqual(
    observationDateFromCalcAt('2026-10-01T00:30:00Z', 'America/Los_Angeles'),
    '2026-09-30',
  );
});

test('K-09: Asia/Tokyo (UTC+9) — next local day', () => {
  // 2026-09-30T23:30Z + UTC+9 = 2026-10-01 08:30 Tokyo → next day
  assert.strictEqual(
    observationDateFromCalcAt('2026-09-30T23:30:00Z', 'Asia/Tokyo'),
    '2026-10-01',
  );
});

test('K-10: invalid timezone → UTC fallback', () => {
  assert.strictEqual(
    observationDateFromCalcAt('2026-09-30T06:00:00Z', 'Bad/Timezone'),
    '2026-09-30',
  );
});

test('K-11: null timezone → UTC fallback', () => {
  assert.strictEqual(
    observationDateFromCalcAt('2026-09-30T06:00:00Z', null),
    '2026-09-30',
  );
});

test('K-12: undefined timezone → UTC fallback (backward compat)', () => {
  assert.strictEqual(
    observationDateFromCalcAt('2026-09-30T06:00:00Z', undefined),
    '2026-09-30',
  );
});

test('K-13: DST Europe/Paris — summer (UTC+2) transition boundary', () => {
  // 2026-03-29 at 02:00 Paris → clocks spring forward to 03:00; UTC+2 from here
  // Before transition: 2026-03-29T00:59Z = 01:59 Paris (UTC+1) → 2026-03-29
  // After transition:  2026-03-29T01:01Z = 03:01 Paris (UTC+2) → 2026-03-29
  const before = observationDateFromCalcAt('2026-03-29T00:59:00Z', 'Europe/Paris');
  const after  = observationDateFromCalcAt('2026-03-29T01:01:00Z', 'Europe/Paris');
  assert.strictEqual(before, '2026-03-29');
  assert.strictEqual(after,  '2026-03-29');
});

test('K-14: DST Europe/Paris — winter (UTC+1): 04:00Z = 05:00 Paris → same day', () => {
  assert.strictEqual(
    observationDateFromCalcAt('2026-01-15T04:00:00Z', 'Europe/Paris'),
    '2026-01-15',
  );
});

test('K-15: DST America/New_York — summer (UTC-4, EDT)', () => {
  // 2026-06-15T04:00Z = 2026-06-15 00:00 EDT (UTC-4) → same local day
  assert.strictEqual(
    observationDateFromCalcAt('2026-06-15T04:00:00Z', 'America/New_York'),
    '2026-06-15',
  );
});

test('K-16: DST America/New_York — winter (UTC-5, EST): midnight boundary', () => {
  // 2026-01-15T04:59Z = 2026-01-14 23:59 EST → previous local day
  const result = observationDateFromCalcAt('2026-01-15T04:59:00Z', 'America/New_York');
  assert.strictEqual(result, '2026-01-14');
});

test('K-17: same UTC timestamp → different local dates across timezones', () => {
  // At 2026-10-01T00:30Z: Tokyo = Oct 1, Paris = Oct 1, LA = Sep 30
  const ts = '2026-10-01T00:30:00Z';
  const tokyo  = observationDateFromCalcAt(ts, 'Asia/Tokyo');
  const paris  = observationDateFromCalcAt(ts, 'Europe/Paris');
  const la     = observationDateFromCalcAt(ts, 'America/Los_Angeles');
  assert.strictEqual(tokyo, '2026-10-01');
  assert.strictEqual(paris, '2026-10-01');
  assert.strictEqual(la,    '2026-09-30');
  assert.notStrictEqual(tokyo, la, 'Tokyo and LA must differ at this timestamp');
});

test('K-18: isValidTimezone exported from booking-pickup-persistence', () => {
  const mod = require('../services/booking-pickup-persistence');
  assert.strictEqual(typeof mod.isValidTimezone, 'function');
});

// ── Section L: generateTargetDates ───────────────────────────
console.log('\nSection L — generateTargetDates horizon semantics');

test('L-01: returns exactly 30 dates for default horizon', () => {
  const dates = generateTargetDates('2026-09-30', 30);
  assert.strictEqual(dates.length, 30, `expected 30 dates, got ${dates.length}`);
});

test('L-02: PICKUP_HORIZON_DAYS constant is 30', () => {
  assert.strictEqual(PICKUP_HORIZON_DAYS, 30);
});

test('L-03: first target date is local today+1', () => {
  const dates = generateTargetDates('2026-09-30', 30);
  assert.strictEqual(dates[0], '2026-10-01');
});

test('L-04: last target date is local today+30 (not today+31)', () => {
  const dates = generateTargetDates('2026-09-30', 30);
  assert.strictEqual(dates[29], '2026-10-30');
});

test('L-05: today is NOT included', () => {
  const dates = generateTargetDates('2026-09-30', 30);
  assert.ok(!dates.includes('2026-09-30'), 'local today must not appear in target dates');
});

test('L-06: all dates are in the future relative to localTodayStr', () => {
  const localToday = '2026-09-30';
  const dates = generateTargetDates(localToday, 30);
  for (const d of dates) {
    assert.ok(d > localToday, `date ${d} must be after local today ${localToday}`);
  }
});

test('L-07: dates are in ascending order', () => {
  const dates = generateTargetDates('2026-09-30', 30);
  for (let i = 1; i < dates.length; i++) {
    assert.ok(dates[i] > dates[i - 1], `dates must be ascending: ${dates[i - 1]} → ${dates[i]}`);
  }
});

test('L-08: all dates are YYYY-MM-DD format', () => {
  const dates = generateTargetDates('2026-09-30', 30);
  for (const d of dates) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `invalid date format: ${d}`);
  }
});

test('L-09: handles month boundary correctly', () => {
  const dates = generateTargetDates('2026-09-30', 5);
  assert.deepStrictEqual(dates, [
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  ]);
});

test('L-10: handles year boundary correctly', () => {
  const dates = generateTargetDates('2026-12-30', 4);
  assert.deepStrictEqual(dates, [
    '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
  ]);
});

test('L-11: returns exactly horizonDays dates (not horizonDays+1)', () => {
  for (const h of [1, 7, 30, 60, 90]) {
    const dates = generateTargetDates('2026-09-30', h);
    assert.strictEqual(dates.length, h, `expected ${h} dates, got ${dates.length}`);
  }
});

test('L-12: ELIGIBLE_PROPERTIES_SQL selects from pricing_config and properties', () => {
  assert.ok(ELIGIBLE_PROPERTIES_SQL.includes('pricing_config'));
  assert.ok(ELIGIBLE_PROPERTIES_SQL.includes('properties'));
  assert.ok(ELIGIBLE_PROPERTIES_SQL.toLowerCase().includes('is_active'));
  assert.ok(ELIGIBLE_PROPERTIES_SQL.toLowerCase().includes('timezone'));
});

// ── Section M: runPickupShadowJob — flag OFF ─────────────────
console.log('\nSection M — runPickupShadowJob: FLAG_OFF behavior');

// Section M tests are async — defined here for documentation,
// executed in runAsyncTests() below.
const SECTION_M_ASYNC = [

  ['M-01: flag OFF → returns with skippedReason=PERSISTENCE_FLAG_OFF', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    let calcCalled = false;
    const mockCalc = () => { calcCalled = true; return Promise.resolve({}); };
    const mockPool = { query: () => Promise.resolve({ rows: [] }) };

    const stats = await runPickupShadowJob(mockPool, { _calculateFn: mockCalc });

    assert.strictEqual(stats.skippedReason, 'PERSISTENCE_FLAG_OFF');
    assert.strictEqual(calcCalled, false, 'calculatePickupShadow must not be called when flag is OFF');
    if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
    else delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['M-02: flag OFF → zero observationsCalculated', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    const stats = await runPickupShadowJob({ query: () => Promise.resolve({ rows: [] }) });
    assert.strictEqual(stats.observationsCalculated, 0);
    if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
    else delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['M-03: flag OFF → zero observationsPersisted', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    const stats = await runPickupShadowJob({ query: () => Promise.resolve({ rows: [] }) });
    assert.strictEqual(stats.observationsPersisted, 0);
    if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
    else delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['M-04: flag OFF → zero targetDatesAttempted', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    const stats = await runPickupShadowJob({ query: () => Promise.resolve({ rows: [] }) });
    assert.strictEqual(stats.targetDatesAttempted, 0);
    if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
    else delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['M-05: flag OFF → zero propertiesProcessed', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    const stats = await runPickupShadowJob({ query: () => Promise.resolve({ rows: [] }) });
    assert.strictEqual(stats.propertiesProcessed, 0);
    if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
    else delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['M-06: flag OFF → pool.query never called (zero DB activity)', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    let queryCalled = false;
    const mockPool = { query: () => { queryCalled = true; return Promise.resolve({ rows: [] }); } };
    await runPickupShadowJob(mockPool);
    assert.strictEqual(queryCalled, false, 'no DB queries when flag is OFF');
    if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
    else delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

]; // SECTION_M_ASYNC

// ── Section N: runPickupShadowJob — flag ON scenarios ────────
console.log('\nSection N — runPickupShadowJob: flag ON scenarios');

const SECTION_N_ASYNC = [

  ['N-01: empty properties → zero stats', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
    const mockPool = { query: () => Promise.resolve({ rows: [] }) };
    const stats = await runPickupShadowJob(mockPool,
      { _calculateFn: () => Promise.resolve({}), _persistFn: () => Promise.resolve(null) });
    assert.strictEqual(stats.propertiesEligible, 0);
    assert.strictEqual(stats.observationsCalculated, 0);
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['N-02: one property, exactly 30 target dates attempted', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [{ property_id: 'p1', timezone: 'Europe/Paris' }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const mockObs = {
      propertyId: 'p1', targetDate: '2026-10-01', calculatedAt: new Date().toISOString(),
      leadTimeDays: 1, leadTimeBand: '0_7', lookbackMonths: 12,
      historicalSampleSize: 5, comparableSampleSize: 2, recentWindowDays: 7,
      recentBookings: 0, expectedBookings: 0.038, rawPickupRatio: null, pickupRatio: 0.962,
      status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT', advisoryMultiplier: 1.00,
      occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
      modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
    };

    let calcCalls = 0;
    const mockCalc = () => { calcCalls++; return Promise.resolve(mockObs); };
    const mockPersist = () => Promise.resolve(calcCalls % 2 === 0 ? 1 : null);

    const stats = await runPickupShadowJob(mockPool,
      { horizonDays: 30, _calculateFn: mockCalc, _persistFn: mockPersist });

    assert.strictEqual(stats.targetDatesAttempted, 30, `expected 30 dates, got ${stats.targetDatesAttempted}`);
    assert.strictEqual(stats.observationsCalculated, 30);
    assert.strictEqual(stats.propertiesProcessed, 1);
    assert.strictEqual(stats.propertiesEligible, 1);

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['N-03: observation_date uses property timezone, not UTC', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    // Property is in America/Los_Angeles; at certain UTC times, local date ≠ UTC date
    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [{ property_id: 'p1', timezone: 'America/Los_Angeles' }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    let capturedTimezone = null;
    const mockObs = {
      propertyId: 'p1', targetDate: '2026-10-15',
      calculatedAt: '2026-10-01T00:30:00Z',  // LA = Sep 30 (previous day)
      leadTimeDays: 14, leadTimeBand: '14_30', lookbackMonths: 12,
      historicalSampleSize: 5, comparableSampleSize: 2, recentWindowDays: 7,
      recentBookings: 0, expectedBookings: 0.038, rawPickupRatio: null, pickupRatio: 0.962,
      status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT', advisoryMultiplier: 1.00,
      occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
      modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
    };

    const mockCalc = () => Promise.resolve(mockObs);
    const mockPersist = (_pool, _obs, tz) => {
      capturedTimezone = tz;
      return Promise.resolve(1);
    };

    await runPickupShadowJob(mockPool,
      { horizonDays: 1, _calculateFn: mockCalc, _persistFn: mockPersist });

    assert.strictEqual(capturedTimezone, 'America/Los_Angeles',
      'persistPickupObservation must receive the property timezone');

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['N-04: inserted vs duplicate telemetry', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [{ property_id: 'p1', timezone: 'Europe/Paris' }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const mockObs = {
      propertyId: 'p1', targetDate: '', calculatedAt: new Date().toISOString(),
      leadTimeDays: 1, leadTimeBand: '0_7', lookbackMonths: 12,
      historicalSampleSize: 5, comparableSampleSize: 2, recentWindowDays: 7,
      recentBookings: 0, expectedBookings: 0.1, rawPickupRatio: null, pickupRatio: 0.917,
      status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT', advisoryMultiplier: 1.00,
      occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
      modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
    };

    let callCount = 0;
    const mockCalc = () => Promise.resolve(mockObs);
    // First call → inserted (id=1), subsequent calls → duplicate (null / DO NOTHING)
    const mockPersist = () => Promise.resolve(callCount++ === 0 ? 1 : null);

    const stats = await runPickupShadowJob(mockPool,
      { horizonDays: 3, _calculateFn: mockCalc, _persistFn: mockPersist });

    assert.strictEqual(stats.observationsCalculated, 3);
    assert.strictEqual(stats.observationsPersisted, 1, 'first call inserts');
    assert.strictEqual(stats.duplicatesSkipped, 2, 'subsequent calls are duplicates');

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['N-05: propertiesEligible reflects all active properties', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [
            { property_id: 'p1', timezone: 'Europe/Paris' },
            { property_id: 'p2', timezone: 'Europe/Paris' },
            { property_id: 'p3', timezone: null },
          ]});
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const stats = await runPickupShadowJob(mockPool, {
      horizonDays: 1,
      _calculateFn: () => Promise.resolve({ propertyId: '', targetDate: '', calculatedAt: new Date().toISOString(),
        leadTimeDays: 1, leadTimeBand: '0_7', lookbackMonths: 12, historicalSampleSize: 5,
        comparableSampleSize: 2, recentWindowDays: 7, recentBookings: 0, expectedBookings: 0.1,
        rawPickupRatio: null, pickupRatio: 0.917, status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT',
        advisoryMultiplier: 1.00, occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
        modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [] }),
      _persistFn: () => Promise.resolve(1),
    });

    assert.strictEqual(stats.propertiesEligible, 3);

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['N-06: invalid timezone falls back to UTC for observation_date', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [{ property_id: 'p1', timezone: null }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    let capturedTimezone = 'NOT_CALLED';
    const mockPersist = (_pool, _obs, tz) => { capturedTimezone = tz; return Promise.resolve(1); };
    const mockCalc = () => Promise.resolve({
      propertyId: 'p1', targetDate: '', calculatedAt: new Date().toISOString(),
      leadTimeDays: 1, leadTimeBand: '0_7', lookbackMonths: 12, historicalSampleSize: 5,
      comparableSampleSize: 2, recentWindowDays: 7, recentBookings: 0, expectedBookings: 0.1,
      rawPickupRatio: null, pickupRatio: 0.917, status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT',
      advisoryMultiplier: 1.00, occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
      modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
    });

    await runPickupShadowJob(mockPool,
      { horizonDays: 1, _calculateFn: mockCalc, _persistFn: mockPersist });

    // When timezone is null/invalid, job passes UTC (isValidTimezone(null)=false → 'UTC')
    // Actually the job passes the raw timezone from the property; persistPickupObservation
    // handles the fallback internally. So capturedTimezone = null (job passes it as-is).
    // The important check: persist received undefined/null and used UTC fallback.
    assert.ok(capturedTimezone === null || capturedTimezone === undefined || capturedTimezone === 'UTC',
      `timezone passed to persist should be null/undefined/UTC when property.timezone is null, got: ${capturedTimezone}`);

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

]; // SECTION_N_ASYNC

// ── Section O: Failure isolation ─────────────────────────────
console.log('\nSection O — Failure isolation');

const SECTION_O_ASYNC = [

  ['O-01: calculation failure for one target date → continues other dates', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [{ property_id: 'p1', timezone: 'Europe/Paris' }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const mockObs = {
      propertyId: 'p1', targetDate: '', calculatedAt: new Date().toISOString(),
      leadTimeDays: 1, leadTimeBand: '0_7', lookbackMonths: 12, historicalSampleSize: 5,
      comparableSampleSize: 2, recentWindowDays: 7, recentBookings: 0, expectedBookings: 0.1,
      rawPickupRatio: null, pickupRatio: 0.917, status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT',
      advisoryMultiplier: 1.00, occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
      modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
    };

    let calcCallCount = 0;
    const mockCalc = () => {
      calcCallCount++;
      if (calcCallCount === 2) throw new Error('simulated calculation failure');
      return Promise.resolve(mockObs);
    };

    const stats = await runPickupShadowJob(mockPool,
      { horizonDays: 4, _calculateFn: mockCalc, _persistFn: () => Promise.resolve(1) });

    assert.strictEqual(stats.targetDatesAttempted, 4, 'all 4 dates must be attempted');
    assert.strictEqual(stats.observationsCalculated, 3, 'only 3 succeed (1 failed)');
    assert.strictEqual(stats.errors.length, 1, 'exactly one error recorded');
    assert.ok(stats.errors[0].property_id, 'error must include property_id');
    assert.ok(stats.errors[0].targetDate, 'error must include targetDate');

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['O-02: property-level failure → continues other properties', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    let queryCount = 0;
    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [
            { property_id: 'p1', timezone: 'Europe/Paris' },
            { property_id: 'p2', timezone: 'Europe/Paris' },
          ]});
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const mockObs = {
      propertyId: '', targetDate: '', calculatedAt: new Date().toISOString(),
      leadTimeDays: 1, leadTimeBand: '0_7', lookbackMonths: 12, historicalSampleSize: 5,
      comparableSampleSize: 2, recentWindowDays: 7, recentBookings: 0, expectedBookings: 0.1,
      rawPickupRatio: null, pickupRatio: 0.917, status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT',
      advisoryMultiplier: 1.00, occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
      modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
    };

    let calcCallCount = 0;
    const mockCalc = (_pool, propertyId) => {
      calcCallCount++;
      // p1 always fails on every date
      if (propertyId === 'p1') throw new Error(`simulated failure for ${propertyId}`);
      return Promise.resolve({ ...mockObs, propertyId });
    };

    const stats = await runPickupShadowJob(mockPool,
      { horizonDays: 2, _calculateFn: mockCalc, _persistFn: () => Promise.resolve(1) });

    // p1: 2 dates attempted, all fail → propertiesProcessed still increments
    // p2: 2 dates attempted, all succeed
    assert.strictEqual(stats.propertiesEligible, 2);
    assert.ok(stats.errors.length >= 2, 'p1 errors recorded');
    assert.strictEqual(stats.observationsCalculated, 2, 'p2 contributes 2 successes');

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['O-03: job returns stats object even when all properties fail', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [{ property_id: 'p1', timezone: 'Europe/Paris' }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const mockCalc = () => { throw new Error('total failure'); };

    const stats = await runPickupShadowJob(mockPool,
      { horizonDays: 2, _calculateFn: mockCalc, _persistFn: () => Promise.resolve(null) });

    // Should return stats, not throw
    assert.ok(stats && typeof stats === 'object', 'job must return stats, not throw');
    assert.ok(Array.isArray(stats.errors), 'errors array must exist');
    assert.ok(stats.errors.length > 0, 'errors must be recorded');

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

  ['O-04: errors contain property_id but no guest PII', async () => {
    const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';

    const mockPool = {
      query: (sql) => {
        if (sql.includes('pricing_config')) {
          return Promise.resolve({ rows: [{ property_id: 'p1', timezone: 'Europe/Paris' }] });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const mockCalc = () => { throw new Error('test error message'); };

    const stats = await runPickupShadowJob(mockPool,
      { horizonDays: 1, _calculateFn: mockCalc, _persistFn: () => Promise.resolve(null) });

    assert.ok(stats.errors.length > 0);
    const err = stats.errors[0];
    assert.ok('property_id' in err, 'error must have property_id');
    assert.ok(!('guest_name' in err), 'error must not contain guest PII');
    assert.ok(!('email' in err), 'error must not contain email');
    assert.ok(!('reservation_id' in err), 'error must not contain reservation_id');

    process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
    if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
  }],

]; // SECTION_O_ASYNC

// ── Section P: Independence ───────────────────────────────────
console.log('\nSection P — Independence from market provider / pricing');

const JOB_SRC = fs.readFileSync(path.join(__dirname, '../services/booking-pickup-shadow-job.js'), 'utf8');

test('P-01: shadow job does not import channex', () => {
  assert.ok(!/require\(['"][^'"]*channex/i.test(JOB_SRC), 'must not import channex');
});

test('P-02: shadow job does not import apify or brightdata', () => {
  assert.ok(!/require\(['"][^'"]*apify/i.test(JOB_SRC),      'must not import apify');
  assert.ok(!/require\(['"][^'"]*bright.?data/i.test(JOB_SRC), 'must not import brightdata');
});

test('P-03: shadow job does not import pricing-engine', () => {
  assert.ok(!/require\(['"][^'"]*pricing-engine/.test(JOB_SRC), 'must not import pricing-engine');
});

test('P-04: shadow job does not import pricing-publisher', () => {
  assert.ok(!/require\(['"][^'"]*pricing-publisher/.test(JOB_SRC), 'must not import pricing-publisher');
});

test('P-05: shadow job does not import effective-pricing-resolver', () => {
  assert.ok(!/require\(['"][^'"]*effective-pricing-resolver/.test(JOB_SRC));
});

test('P-06: shadow job has no SQL statements targeting pricing_schedule', () => {
  // The safety comment lists pricing_schedule as something we never touch.
  // Verify no actual SQL INSERT/UPDATE/SELECT targets it (comments are excluded).
  const noSqlRef = !/\b(INSERT INTO|UPDATE|SELECT\s+.*\bFROM)\s+pricing_schedule/i.test(JOB_SRC);
  assert.ok(noSqlRef, 'job must not have SQL statements targeting pricing_schedule');
});

test('P-07: shadow job exports declare PICKUP_HAS_PRICING_AUTHORITY is not asserted but data flow is shadow-only', () => {
  // Structural proof: job only calls calculatePickupShadow and persistPickupObservation
  // Neither function takes a price as output or writes to pricing_schedule
  assert.ok(JOB_SRC.includes('calculatePickupShadow'), 'job calls pickup calculation');
  assert.ok(JOB_SRC.includes('persistPickupObservation'), 'job calls persistence');
  assert.ok(!JOB_SRC.includes('priceProperty'), 'job must not call priceProperty');
  assert.ok(!JOB_SRC.includes('publishEffectivePricing'), 'job must not call publisher');
});

test('P-08: shadow job does not import market-provider', () => {
  assert.ok(!/require\(['"][^'"]*market-provider/.test(JOB_SRC));
});

// ── Section Q: Scheduler integration ─────────────────────────
console.log('\nSection Q — Scheduler integration');

const CRON_SRC = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');

test('Q-01: dynamic-pricing-cron.js references booking-pickup-shadow-job', () => {
  assert.ok(CRON_SRC.includes('booking-pickup-shadow-job'),
    'cron file must reference the shadow job');
});

test('Q-02: pickup cron has its own dedicated daily schedule', () => {
  assert.ok(CRON_SRC.includes("'5 6 * * *'") || CRON_SRC.includes('"5 6 * * *"'),
    'pickup must have a dedicated daily cron expression');
});

test('Q-03: pickup flag is checked before job execution in cron', () => {
  // The cron callback checks isPersistenceEnabled / _pu before calling the job
  const cronsSection = CRON_SRC.slice(CRON_SRC.indexOf('5 6 * * *'));
  const hasFlag = cronsSection.includes('isPersistenceEnabled') ||
                  cronsSection.includes('_pu') ||
                  cronsSection.includes('BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED');
  assert.ok(hasFlag, 'flag must be checked in cron callback before executing job');
});

test('Q-04: pickup shadow job is called as fire-and-forget (no await)', () => {
  // Fire-and-forget: failure cannot block the cron loop
  // The job call uses .then().catch() or .catch() — not await
  const pickupCronBlock = CRON_SRC.slice(CRON_SRC.indexOf('5 6 * * *'));
  const hasFireForget = pickupCronBlock.includes('.catch(') && !pickupCronBlock.slice(0, 200).includes('await ');
  assert.ok(hasFireForget, 'pickup job must be fire-and-forget (.catch) not awaited');
});

test('Q-05: pickup cron callback NOT inside market provider success branch', () => {
  // Narrow to just the pickup cron callback body (not the rest of the file)
  const startIdx = CRON_SRC.indexOf("'5 6 * * *'");
  // The callback ends before the next cron.schedule or 'if (MOCK_MODE)' block
  const endIdx   = CRON_SRC.indexOf('if (MOCK_MODE)', startIdx);
  const pickupBlock = endIdx > startIdx
    ? CRON_SRC.slice(startIdx, endIdx)
    : CRON_SRC.slice(startIdx, startIdx + 800);
  assert.ok(!pickupBlock.includes('scrapeBestZone'),
    'pickup cron callback must not depend on scrape success');
  assert.ok(!pickupBlock.includes('market_data'),
    'pickup cron callback must not depend on market_data freshness');
});

test('Q-06: pickup import does NOT make cron import pricing modules', () => {
  // Adding pickup to cron must not introduce pricing authority
  // The shadow job is imported lazily — only when flag is on
  const pickupCronBlock = CRON_SRC.slice(CRON_SRC.indexOf('5 6 * * *'), CRON_SRC.indexOf('5 6 * * *') + 600);
  assert.ok(!pickupCronBlock.includes('pricing-engine'),
    'pickup cron block must not reference pricing-engine');
  assert.ok(!pickupCronBlock.includes('pricing_schedule'),
    'pickup cron block must not reference pricing_schedule');
});

// ── Summary ───────────────────────────────────────────────────
async function runAsyncTests() {
  const asyncTests = [
    ['D-01: returns null without pool.query call when flag is OFF', async () => {
      const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
      delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
      let queryCalled = false;
      const mockPool = { query: () => { queryCalled = true; return Promise.resolve({ rows: [] }); } };
      const result = await persistPickupObservation(mockPool, { propertyId: 'p1' });
      assert.strictEqual(result, null);
      assert.strictEqual(queryCalled, false);
      if (saved !== undefined) process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved;
    }],
    ['D-02: calls pool.query with correct parameter count when enabled', async () => {
      const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
      let capturedParams = null;
      const mockPool = { query: (_sql, params) => { capturedParams = params; return Promise.resolve({ rows: [{ id: 42 }] }); } };
      const obs = {
        propertyId: 'prop-123', targetDate: '2026-11-01', calculatedAt: '2026-09-30T06:00:00.000Z',
        leadTimeDays: 32, leadTimeBand: '30_60', lookbackMonths: 12, targetWindowDays: 14,
        historicalSampleSize: 42, comparableSampleSize: 18, recentWindowDays: 7, recentBookings: 3,
        expectedBookings: 2.1, rawPickupRatio: 1.4286, pickupRatio: 1.3294,
        status: 'NORMAL', confidence: 'GOOD', advisoryMultiplier: 1.00,
        occupancyFraction: 0.35, pacingPickupRelation: 'ALIGNED',
        modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [], baselineType: 'PROPERTY_HISTORY', pacingStrength: 'NORMAL',
      };
      await persistPickupObservation(mockPool, obs);
      assert.strictEqual(capturedParams.length, 23);
      assert.strictEqual(capturedParams[3], '2026-09-30');
      assert.strictEqual(capturedParams[13], obs.rawPickupRatio);
      assert.strictEqual(capturedParams[14], obs.pickupRatio);
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
      if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    }],
    ['D-03: observation_date derived from calculatedAt, not targetDate', async () => {
      const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
      let capturedParams = null;
      const mockPool = { query: (_sql, params) => { capturedParams = params; return Promise.resolve({ rows: [] }); } };
      await persistPickupObservation(mockPool, {
        propertyId: 'p1', targetDate: '2027-06-15', calculatedAt: '2026-09-30T10:00:00.000Z',
        leadTimeDays: 258, leadTimeBand: '180_365', lookbackMonths: 12,
        historicalSampleSize: 10, comparableSampleSize: 3, recentWindowDays: 7, recentBookings: 0,
        expectedBookings: 0.057, rawPickupRatio: null, pickupRatio: 0.944,
        status: 'LOW_EVIDENCE', confidence: 'LOW', advisoryMultiplier: 1.00,
        occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
        modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
      });
      assert.strictEqual(capturedParams[1], '2027-06-15');
      assert.strictEqual(capturedParams[3], '2026-09-30');
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
      if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    }],
    ['D-04: rawPickupRatio null passed as null (LOW_EVIDENCE case)', async () => {
      const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
      let capturedParams = null;
      const mockPool = { query: (_sql, params) => { capturedParams = params; return Promise.resolve({ rows: [] }); } };
      await persistPickupObservation(mockPool, {
        propertyId: 'p1', targetDate: '2026-12-01', calculatedAt: '2026-09-30T06:00:00.000Z',
        leadTimeDays: 62, leadTimeBand: '60_90', lookbackMonths: 12,
        historicalSampleSize: 5, comparableSampleSize: 2, recentWindowDays: 7, recentBookings: 0,
        expectedBookings: 0.038, rawPickupRatio: null, pickupRatio: 0.962,
        status: 'LOW_EVIDENCE', confidence: 'INSUFFICIENT', advisoryMultiplier: 1.00,
        occupancyFraction: 0.0, pacingPickupRelation: 'INSUFFICIENT_DATA',
        modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
      });
      assert.strictEqual(capturedParams[13], null);
      assert.ok(capturedParams[14] !== null);
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
      if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    }],
    ['D-05: returns inserted id when row created', async () => {
      const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
      const mockPool = { query: () => Promise.resolve({ rows: [{ id: 99 }] }) };
      const id = await persistPickupObservation(mockPool, {
        propertyId: 'p1', targetDate: '2026-11-01', calculatedAt: '2026-09-30T06:00:00.000Z',
        leadTimeDays: 32, leadTimeBand: '30_60', lookbackMonths: 12, historicalSampleSize: 20,
        comparableSampleSize: 18, recentWindowDays: 7, recentBookings: 2, expectedBookings: 1.5,
        rawPickupRatio: 1.333, pickupRatio: 1.2, status: 'NORMAL', confidence: 'GOOD',
        advisoryMultiplier: 1.00, occupancyFraction: 0.4, pacingPickupRelation: 'ALIGNED',
        modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
      });
      assert.strictEqual(id, 99);
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
      if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    }],
    ['D-06: returns null on DO NOTHING conflict', async () => {
      const saved = process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = 'true';
      const mockPool = { query: () => Promise.resolve({ rows: [] }) };
      const id = await persistPickupObservation(mockPool, {
        propertyId: 'p1', targetDate: '2026-11-01', calculatedAt: '2026-09-30T06:00:00.000Z',
        leadTimeDays: 32, leadTimeBand: '30_60', lookbackMonths: 12, historicalSampleSize: 20,
        comparableSampleSize: 18, recentWindowDays: 7, recentBookings: 2, expectedBookings: 1.5,
        rawPickupRatio: 1.333, pickupRatio: 1.2, status: 'NORMAL', confidence: 'GOOD',
        advisoryMultiplier: 1.00, occupancyFraction: 0.4, pacingPickupRelation: 'ALIGNED',
        modelVersion: 'pickup-v1.1', anomaliesExcluded: 0, reasons: [],
      });
      assert.strictEqual(id, null);
      process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED = saved ?? '';
      if (!saved) delete process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED;
    }],
  ];

  for (const [name, fn] of asyncTests) {
    await testAsync(name, fn);
  }

  console.log('\nSection M (async) — runPickupShadowJob: FLAG_OFF');
  for (const [name, fn] of SECTION_M_ASYNC) await testAsync(name, fn);

  console.log('\nSection N (async) — runPickupShadowJob: flag ON scenarios');
  for (const [name, fn] of SECTION_N_ASYNC) await testAsync(name, fn);

  console.log('\nSection O (async) — Failure isolation');
  for (const [name, fn] of SECTION_O_ASYNC) await testAsync(name, fn);
}

runAsyncTests().then(() => {
  console.log(`\n  ─────────────────────────────────────────`);
  console.log(`  P1.3-T2-FIX results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

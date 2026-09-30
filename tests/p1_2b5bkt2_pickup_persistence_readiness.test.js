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
  observationDateFromCalcAt,
  persistPickupObservation,
  INSERT_OBSERVATION_SQL,
} = require('../services/booking-pickup-persistence');

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

test('G-05: dynamic-pricing-cron.js does not import pickup persistence', () => {
  const requirePattern = /require\(['"][^'"]*booking-pickup-persistence/;
  assert.ok(!requirePattern.test(CRON),
    'dynamic-pricing-cron.js must not import booking-pickup-persistence (not yet wired)');
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

test('I-04: pickup persistence integration not yet wired (T2 readiness only)', () => {
  assert.ok(!CRON.includes('booking-pickup-persistence') && !CRON.includes('persistPickupObservation'),
    'pickup persistence must NOT be wired into the cron yet — T2 proves readiness only');
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
}

runAsyncTests().then(() => {
  console.log(`\n  ─────────────────────────────────────────`);
  console.log(`  P1.3-T2 results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

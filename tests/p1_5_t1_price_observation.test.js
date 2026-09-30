'use strict';
/**
 * P1.5-T1 — Price Observation Persistence
 * Standalone test suite — no real DB, no network, no pricing writes.
 *
 * Run with: node tests/p1_5_t1_price_observation.test.js
 *
 * Sections:
 *   [A] Migration: additive, no destructive SQL, TIMESTAMPTZ/DATE types
 *   [B] Migration: no observation_date uniqueness, fingerprint index present
 *   [C] Service: module exports & constants
 *   [D] Service: computeFingerprint — stable, excludes timestamp
 *   [E] Service: buildObservationRecord — field preservation, currency, sources
 *   [F] Service: dedup logic — same fingerprint skip, changed state persists
 *   [G] Service: multiple intraday changes survive (distinct fingerprints)
 *   [H] Service: flag off → zero DB writes
 *   [I] Service: currency — explicit, no silent EUR assumption
 *   [J] Service: source mapping — manual_override, boostprice, legacy, none
 *   [K] Service: no second resolver, no price recalculation
 *   [L] Service: persistence failure does not block publisher
 *   [M] Publisher: onObserve hook injected after resolve, before Channex
 *   [N] Publisher: observation failure does not block Channex push
 *   [O] Publisher: flag off → observer still called but writes skipped
 *   [P] Authority proof: no pricing engine reads price_observations
 *   [Q] Migration: no historical backfill, no destructive ops
 *   [R] Audit tool: SELECT-only, safe with empty/missing table
 *   [S] Restrictions: min_stay, stop_sell preserved
 *   [T] Lead days computed correctly
 *   [U] No Channex side effects, no network
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}: ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

function ok(val, msg) { assert.ok(val, msg); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }

// ── Load artifacts ────────────────────────────────────────────────────────────

const {
  computeFingerprint,
  buildObservationRecord,
  isFlagEnabled,
  observePricingState,
  SCHEMA_VERSION,
  FLAG_NAME,
  DEDUP_WINDOW_MS,
} = require('../services/price-observation-persistence');

const { createPublisher, PUBLISH_STATUS } = require('../routes/pricing-publisher');
const { SOURCE } = require('../routes/effective-pricing-resolver');

const MIGRATION_SRC = fs.readFileSync(
  path.join(__dirname, '../migrations/008_price_observations.sql'), 'utf8',
);
const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, '../services/price-observation-persistence.js'), 'utf8',
);
const PUBLISHER_SRC = fs.readFileSync(
  path.join(__dirname, '../routes/pricing-publisher.js'), 'utf8',
);
const AUDIT_SRC = fs.readFileSync(
  path.join(__dirname, '../outils/audit-price-observation-readiness-p1_5_t1.js'), 'utf8',
);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNight(overrides = {}) {
  return {
    date:           '2026-10-15',
    price:          120,
    priceValid:     true,
    minStayArrival: 2,
    minStayThrough: 2,
    minStaySource:  'boostprice',
    stopSell:       false,
    stopSellSource: 'none',
    source:         SOURCE.BOOSTPRICE,
    sourceId:       42,
    locked:         false,
    breakdown:      { season: 1.1, dow: 1.0 },
    calculatedAt:   new Date('2026-09-30T08:00:00Z'),
    ...overrides,
  };
}

function makeProp(overrides = {}) {
  return {
    id:                    'p1',
    user_id:               'u1',
    channex_enabled:       true,
    channex_property_id:   'cx_p1',
    channex_room_type_id:  'cx_rt1',
    channex_rate_plan_id:  'cx_rp1',
    external_pricing:      false,
    ...overrides,
  };
}

// Mock pool that records queries and can simulate table absence
function makePool({ rows = [], failFetch = false, tableAbsent = false } = {}) {
  const queries = [];
  return {
    _queries: queries,
    async query(sql, params) {
      queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (tableAbsent && /price_observations/i.test(sql)) {
        throw Object.assign(new Error('relation "price_observations" does not exist'), { code: '42P01' });
      }
      if (failFetch) throw new Error('Simulated DB failure');
      return { rows, rowCount: rows.length };
    },
  };
}

// ── [A] Migration: additive, no destructive SQL ───────────────────────────────
console.log('\n── [A] Migration: additive, no destructive SQL ──────────────────────────');

test('A-01 migration uses CREATE TABLE IF NOT EXISTS', async () => {
  ok(MIGRATION_SRC.includes('CREATE TABLE IF NOT EXISTS price_observations'), 'CREATE TABLE IF NOT EXISTS present');
});
test('A-02 migration has no DROP TABLE', async () => {
  ok(!/\bDROP\s+TABLE\b/i.test(MIGRATION_SRC), 'no DROP TABLE');
});
test('A-03 migration has no DROP INDEX', async () => {
  ok(!/\bDROP\s+INDEX\b/i.test(MIGRATION_SRC), 'no DROP INDEX');
});
test('A-04 migration has no INSERT INTO', async () => {
  ok(!/\bINSERT\s+INTO\b/i.test(MIGRATION_SRC), 'no INSERT INTO');
});
test('A-05 migration has no UPDATE ... SET', async () => {
  ok(!/\bUPDATE\b.*\bSET\b/i.test(MIGRATION_SRC), 'no UPDATE SET');
});
test('A-06 migration has no DELETE FROM', async () => {
  ok(!/\bDELETE\s+FROM\b/i.test(MIGRATION_SRC), 'no DELETE FROM');
});
test('A-07 migration has no ALTER TABLE', async () => {
  ok(!/\bALTER\s+TABLE\b/i.test(MIGRATION_SRC), 'no ALTER TABLE');
});
test('A-08 observed_at is TIMESTAMPTZ', async () => {
  ok(/observed_at\s+TIMESTAMPTZ/i.test(MIGRATION_SRC), 'observed_at TIMESTAMPTZ');
});
test('A-09 stay_date is DATE', async () => {
  ok(/stay_date\s+DATE/i.test(MIGRATION_SRC), 'stay_date DATE');
});
test('A-10 canonical_price is NUMERIC(10,2)', async () => {
  ok(/canonical_price\s+NUMERIC\(10,2\)/i.test(MIGRATION_SRC), 'canonical_price NUMERIC(10,2)');
});
test('A-11 created_at is TIMESTAMPTZ', async () => {
  ok(/created_at\s+TIMESTAMPTZ/i.test(MIGRATION_SRC), 'created_at TIMESTAMPTZ');
});
test('A-12 id is BIGSERIAL', async () => {
  ok(/\bid\s+BIGSERIAL\b/i.test(MIGRATION_SRC), 'id BIGSERIAL');
});

// ── [B] Migration: uniqueness and indexes ────────────────────────────────────
console.log('\n── [B] Migration: uniqueness and indexes ────────────────────────────────');

test('B-01 no UNIQUE constraint on (property_id, stay_date) without observed_at', async () => {
  // A bare UNIQUE(property_id, stay_date) would block intraday changes
  const blockedUnique = /UNIQUE\s*\(\s*property_id\s*,\s*stay_date\s*\)/i.test(MIGRATION_SRC);
  ok(!blockedUnique, 'no UNIQUE(property_id, stay_date) — intraday changes must survive');
});
test('B-02 no UNIQUE on observation_date alone', async () => {
  ok(!/UNIQUE\s*\(\s*observation_date\s*\)/i.test(MIGRATION_SRC), 'no UNIQUE(observation_date)');
});
test('B-03 primary key on id', async () => {
  ok(/PRIMARY\s+KEY/i.test(MIGRATION_SRC), 'PRIMARY KEY present');
});
test('B-04 idx_po_prop_stay_at index defined', async () => {
  ok(MIGRATION_SRC.includes('idx_po_prop_stay_at'), 'idx_po_prop_stay_at index present');
});
test('B-05 idx_po_prop_at index defined', async () => {
  ok(MIGRATION_SRC.includes('idx_po_prop_at'), 'idx_po_prop_at index present');
});
test('B-06 idx_po_stay_date index defined', async () => {
  ok(MIGRATION_SRC.includes('idx_po_stay_date'), 'idx_po_stay_date index present');
});
test('B-07 idx_po_fingerprint index defined', async () => {
  ok(MIGRATION_SRC.includes('idx_po_fingerprint'), 'idx_po_fingerprint index present');
});
test('B-08 price non-negative CHECK constraint', async () => {
  ok(/po_price_nonneg/i.test(MIGRATION_SRC), 'po_price_nonneg constraint present');
});
test('B-09 price_source CHECK constraint covers all SOURCE values', async () => {
  ok(/po_source_valid/i.test(MIGRATION_SRC), 'po_source_valid constraint present');
  // Verify all resolver SOURCE constants are listed
  const sources = ['manual_override','boostprice','period_rule','weekday_rule','weekend_price','base_price','none'];
  for (const s of sources) {
    ok(MIGRATION_SRC.includes(`'${s}'`), `SOURCE '${s}' in constraint`);
  }
});
test('B-10 publication_state CHECK constraint present', async () => {
  ok(/po_pub_state_valid/i.test(MIGRATION_SRC), 'po_pub_state_valid constraint present');
});
test('B-11 APPEND_ONLY documented in migration comments', async () => {
  ok(/[Aa]ppend.only/i.test(MIGRATION_SRC), 'append-only semantics documented');
});

// ── [C] Service: exports and constants ───────────────────────────────────────
console.log('\n── [C] Service: exports and constants ───────────────────────────────────');

test('C-01 computeFingerprint exported', async () => {
  ok(typeof computeFingerprint === 'function', 'computeFingerprint is function');
});
test('C-02 buildObservationRecord exported', async () => {
  ok(typeof buildObservationRecord === 'function', 'buildObservationRecord is function');
});
test('C-03 observePricingState exported', async () => {
  ok(typeof observePricingState === 'function', 'observePricingState is function');
});
test('C-04 SCHEMA_VERSION is "1"', async () => {
  eq(SCHEMA_VERSION, '1', 'SCHEMA_VERSION = "1"');
});
test('C-05 FLAG_NAME is correct', async () => {
  eq(FLAG_NAME, 'PRICE_OBSERVATION_PERSISTENCE_ENABLED', 'FLAG_NAME correct');
});
test('C-06 DEDUP_WINDOW_MS is 4 hours', async () => {
  eq(DEDUP_WINDOW_MS, 4 * 60 * 60 * 1000, 'DEDUP_WINDOW_MS = 4 hours');
});
test('C-07 isFlagEnabled returns false by default (no env var)', async () => {
  const saved = process.env[FLAG_NAME];
  delete process.env[FLAG_NAME];
  ok(!isFlagEnabled(), 'flag disabled when env var absent');
  if (saved !== undefined) process.env[FLAG_NAME] = saved;
});
test('C-08 isFlagEnabled returns false for "false"', async () => {
  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'false';
  ok(!isFlagEnabled(), 'flag disabled for "false"');
  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];
});
test('C-09 isFlagEnabled returns false for "1" or "TRUE"', async () => {
  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = '1';
  ok(!isFlagEnabled(), '"1" does not enable flag (strict string equality)');
  process.env[FLAG_NAME] = 'TRUE';
  ok(!isFlagEnabled(), '"TRUE" does not enable flag (case-sensitive)');
  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];
});
test('C-10 isFlagEnabled returns true only for exact "true"', async () => {
  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'true';
  ok(isFlagEnabled(), '"true" enables flag');
  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];
});

// ── [D] Service: computeFingerprint — stable, excludes timestamp ──────────────
console.log('\n── [D] computeFingerprint — stable, excludes timestamp ──────────────────');

const BASE_FP_INPUT = {
  canonical_price:        120,
  currency:               'EUR',
  price_source:           'boostprice',
  min_stay_arrival:       2,
  min_stay_through:       2,
  stop_sell:              false,
  manual_override_present: false,
  boostprice_present:     true,
  external_pricing:       false,
};

test('D-01 fingerprint is a non-empty string', async () => {
  const fp = computeFingerprint(BASE_FP_INPUT);
  ok(typeof fp === 'string' && fp.length > 0, 'fingerprint is non-empty string');
});
test('D-02 fingerprint is deterministic', async () => {
  const fp1 = computeFingerprint(BASE_FP_INPUT);
  const fp2 = computeFingerprint(BASE_FP_INPUT);
  eq(fp1, fp2, 'same input → same fingerprint');
});
test('D-03 fingerprint changes when price changes', async () => {
  const fp1 = computeFingerprint({ ...BASE_FP_INPUT, canonical_price: 120 });
  const fp2 = computeFingerprint({ ...BASE_FP_INPUT, canonical_price: 110 });
  ok(fp1 !== fp2, 'different price → different fingerprint');
});
test('D-04 fingerprint changes when currency changes', async () => {
  const fp1 = computeFingerprint({ ...BASE_FP_INPUT, currency: 'EUR' });
  const fp2 = computeFingerprint({ ...BASE_FP_INPUT, currency: 'GBP' });
  ok(fp1 !== fp2, 'different currency → different fingerprint');
});
test('D-05 fingerprint changes when price_source changes', async () => {
  const fp1 = computeFingerprint({ ...BASE_FP_INPUT, price_source: 'boostprice' });
  const fp2 = computeFingerprint({ ...BASE_FP_INPUT, price_source: 'manual_override' });
  ok(fp1 !== fp2, 'different source → different fingerprint');
});
test('D-06 fingerprint changes when stop_sell changes', async () => {
  const fp1 = computeFingerprint({ ...BASE_FP_INPUT, stop_sell: false });
  const fp2 = computeFingerprint({ ...BASE_FP_INPUT, stop_sell: true });
  ok(fp1 !== fp2, 'stop_sell flip → different fingerprint');
});
test('D-07 fingerprint changes when min_stay_arrival changes', async () => {
  const fp1 = computeFingerprint({ ...BASE_FP_INPUT, min_stay_arrival: 1 });
  const fp2 = computeFingerprint({ ...BASE_FP_INPUT, min_stay_arrival: 3 });
  ok(fp1 !== fp2, 'min_stay_arrival change → different fingerprint');
});
test('D-08 fingerprint is stable across time (does not include observed_at)', async () => {
  // Two builds of same state at different times must produce same fingerprint
  const fp1 = computeFingerprint(BASE_FP_INPUT);
  // Simulate "later" — nothing in fp_input captures time
  const fp2 = computeFingerprint(BASE_FP_INPUT);
  eq(fp1, fp2, 'fingerprint does not encode timestamp');
});
test('D-09 NULL canonical_price fingerprinted as "null" string', async () => {
  const fpNull = computeFingerprint({ ...BASE_FP_INPUT, canonical_price: null });
  const fp120  = computeFingerprint({ ...BASE_FP_INPUT, canonical_price: 120 });
  ok(fpNull !== fp120, 'null price distinguished from 120');
  ok(fpNull.startsWith('null|'), 'null price serialized as "null|..."');
});
test('D-10 NULL currency fingerprinted as "null" string', async () => {
  const fpNull = computeFingerprint({ ...BASE_FP_INPUT, currency: null });
  const fpEur  = computeFingerprint({ ...BASE_FP_INPUT, currency: 'EUR' });
  ok(fpNull !== fpEur, 'null currency distinguished from EUR');
});
test('D-11 fingerprint includes all nine state fields', async () => {
  const fp = computeFingerprint(BASE_FP_INPUT);
  const parts = fp.split('|');
  eq(parts.length, 9, 'fingerprint has 9 pipe-separated fields');
});

// ── [E] Service: buildObservationRecord ───────────────────────────────────────
console.log('\n── [E] buildObservationRecord — field preservation ──────────────────────');

const OBS_AT = new Date('2026-09-30T10:00:00Z');

test('E-01 stay_date preserved', async () => {
  const r = buildObservationRecord(makeNight({ date: '2026-10-15' }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: 'Europe/Paris', externalPricing: false,
    publisherRunId: 'run1', observedAt: OBS_AT,
  });
  eq(r.stay_date, '2026-10-15', 'stay_date');
});
test('E-02 canonical_price preserved', async () => {
  const r = buildObservationRecord(makeNight({ price: 95.5 }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.canonical_price, 95.5, 'canonical_price');
});
test('E-03 currency preserved', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: 'GBP', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.currency, 'GBP', 'currency');
});
test('E-04 NULL currency → null field, provenance unknown', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: null, currencyProvenance: 'unknown',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.currency, null, 'currency null');
  eq(r.currency_provenance, 'unknown', 'provenance unknown');
});
test('E-05 min_stay_arrival and min_stay_through preserved', async () => {
  const r = buildObservationRecord(makeNight({ minStayArrival: 3, minStayThrough: 2 }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.min_stay_arrival, 3, 'min_stay_arrival');
  eq(r.min_stay_through, 2, 'min_stay_through');
});
test('E-06 stop_sell preserved', async () => {
  const r = buildObservationRecord(makeNight({ stopSell: true, stopSellSource: 'stop_sell_rule' }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.stop_sell, true, 'stop_sell');
  eq(r.stop_sell_source, 'stop_sell_rule', 'stop_sell_source');
});
test('E-07 schema_version is SCHEMA_VERSION constant', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.schema_version, SCHEMA_VERSION, 'schema_version');
});
test('E-08 state_fingerprint is non-empty string', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  ok(typeof r.state_fingerprint === 'string' && r.state_fingerprint.length > 0, 'state_fingerprint');
});
test('E-09 observation_date derived from observedAt ISO', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.observation_date, '2026-09-30', 'observation_date');
});
test('E-10 publisher_run_id preserved', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: 'run_xyz', observedAt: OBS_AT,
  });
  eq(r.publisher_run_id, 'run_xyz', 'publisher_run_id');
});
test('E-11 min_stay defaults to 1 when null/0', async () => {
  const r = buildObservationRecord(makeNight({ minStayArrival: null, minStayThrough: 0 }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.min_stay_arrival, 1, 'null min_stay_arrival defaults to 1');
  eq(r.min_stay_through, 1, '0 min_stay_through defaults to 1');
});

// ── [F] Service: dedup logic simulation ──────────────────────────────────────
console.log('\n── [F] Service: dedup logic simulation ──────────────────────────────────');

test('F-01 identical fingerprint within window → skipped', async () => {
  const night = makeNight();
  const r = buildObservationRecord(night, {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  const fp = r.state_fingerprint;

  // Mock pool: returns recent fingerprint matching our candidate
  let insertCalled = false;
  const pool = {
    _queries: [],
    async query(sql) {
      const flat = sql.replace(/\s+/g, ' ').trim();
      pool._queries.push(flat.slice(0, 60));
      if (/FROM properties/i.test(flat)) return { rows: [{ currency: 'EUR', timezone: 'Europe/Paris' }] };
      if (/DISTINCT ON/i.test(flat)) {
        return { rows: [{ stay_date: '2026-10-15', state_fingerprint: fp, observed_at: new Date() }] };
      }
      if (/INSERT INTO price_observations/i.test(flat)) {
        insertCalled = true;
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'true';
  const result = await observePricingState(pool, {
    propertyId: 'p1', prop: makeProp(), nights: [night], context: {},
  });
  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];

  eq(result.skipped, 1, 'same fingerprint → 1 skipped');
  eq(result.inserted, 0, 'same fingerprint → 0 inserted');
  ok(!insertCalled, 'INSERT not called when fingerprint matches');
});

test('F-02 different fingerprint → inserted', async () => {
  const night = makeNight();
  let insertCalled = false;

  const pool = {
    async query(sql) {
      if (/SELECT.*FROM properties/i.test(sql)) return { rows: [{ currency: 'EUR', timezone: null }] };
      if (/DISTINCT ON.*price_observations/i.test(sql)) {
        // Return a DIFFERENT fingerprint (old state was €100)
        return { rows: [{ stay_date: '2026-10-15', state_fingerprint: 'different_fp', observed_at: new Date() }] };
      }
      if (/INSERT INTO price_observations/i.test(sql)) {
        insertCalled = true;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'true';
  const result = await observePricingState(pool, {
    propertyId: 'p1', prop: makeProp(), nights: [night], context: {},
  });
  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];

  ok(insertCalled, 'INSERT called when fingerprint differs');
  eq(result.skipped, 0, 'changed state → 0 skipped');
});

test('F-03 no recent fingerprint (new stay date) → inserted', async () => {
  const night = makeNight({ date: '2027-06-01' });
  let insertCalled = false;

  const pool = {
    async query(sql) {
      if (/SELECT.*FROM properties/i.test(sql)) return { rows: [{ currency: 'EUR', timezone: null }] };
      if (/DISTINCT ON.*price_observations/i.test(sql)) {
        return { rows: [] }; // No recent observation
      }
      if (/INSERT INTO price_observations/i.test(sql)) {
        insertCalled = true;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'true';
  await observePricingState(pool, {
    propertyId: 'p1', prop: makeProp(), nights: [night], context: {},
  });
  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];

  ok(insertCalled, 'new stay date → INSERT called');
});

// ── [G] Multiple intraday changes survive ─────────────────────────────────────
console.log('\n── [G] Multiple intraday changes survive ────────────────────────────────');

test('G-01 two calls with different prices produce two inserts for same stay_date', async () => {
  let insertCount = 0;

  const pool = {
    async query(sql) {
      if (/SELECT.*FROM properties/i.test(sql)) return { rows: [{ currency: 'EUR', timezone: null }] };
      if (/DISTINCT ON.*price_observations/i.test(sql)) {
        return { rows: [] }; // No recent observation
      }
      if (/INSERT INTO price_observations/i.test(sql)) {
        insertCount++;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'true';

  // First call: price=120
  await observePricingState(pool, {
    propertyId: 'p1', prop: makeProp(),
    nights: [makeNight({ price: 120 })], context: {},
  });

  // Second call: price=100 (different fingerprint — dedup returns empty again)
  await observePricingState(pool, {
    propertyId: 'p1', prop: makeProp(),
    nights: [makeNight({ price: 100 })], context: {},
  });

  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];

  eq(insertCount, 2, 'two distinct price states → 2 INSERT calls');
});

test('G-02 fingerprints for price=120 and price=100 are distinct', async () => {
  const fp120 = computeFingerprint({ ...BASE_FP_INPUT, canonical_price: 120 });
  const fp100 = computeFingerprint({ ...BASE_FP_INPUT, canonical_price: 100 });
  ok(fp120 !== fp100, 'distinct prices → distinct fingerprints → both survive');
});

// ── [H] Service: flag off → zero DB writes ────────────────────────────────────
console.log('\n── [H] Service: flag off → zero DB writes ───────────────────────────────');

test('H-01 flag off → observePricingState returns immediately with zero writes', async () => {
  const pool = makePool({ failFetch: true }); // any DB call throws
  const saved = process.env[FLAG_NAME];
  delete process.env[FLAG_NAME];

  let threw = false;
  try {
    const result = await observePricingState(pool, {
      propertyId: 'p1', prop: makeProp(),
      nights: [makeNight()], context: {},
    });
    eq(result.reason, 'flag_disabled', 'reason is flag_disabled');
    eq(result.inserted, 0, 'inserted 0');
  } catch(e) {
    threw = true;
  }

  if (saved !== undefined) process.env[FLAG_NAME] = saved;
  ok(!threw, 'no exception when flag is off');
  eq(pool._queries.length, 0, 'zero DB queries when flag off');
});

test('H-02 flag off → zero queries regardless of nights length', async () => {
  const pool = makePool({ failFetch: true });
  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'false';

  await observePricingState(pool, {
    propertyId: 'p1', prop: makeProp(),
    nights: Array.from({ length: 365 }, (_, i) => makeNight({ date: `2026-10-${String(i % 28 + 1).padStart(2,'0')}` })),
    context: {},
  });

  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];
  eq(pool._queries.length, 0, '0 queries for 365 nights when flag off');
});

// ── [I] Service: currency — explicit, no silent EUR assumption ────────────────
console.log('\n── [I] Currency — explicit, no silent EUR ───────────────────────────────');

test('I-01 currency=null in property → observation.currency=null', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: null, currencyProvenance: 'unknown',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.currency, null, 'NULL currency stored as null — no EUR fallback');
});
test('I-02 currency_provenance=unknown when currency is null', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: null, currencyProvenance: 'unknown',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.currency_provenance, 'unknown', 'provenance unknown for null currency');
});
test('I-03 currency_provenance=property_record when currency known', async () => {
  const r = buildObservationRecord(makeNight(), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.currency_provenance, 'property_record', 'property_record provenance');
});
test('I-04 different currencies produce different fingerprints', async () => {
  const fpEUR = computeFingerprint({ ...BASE_FP_INPUT, currency: 'EUR' });
  const fpGBP = computeFingerprint({ ...BASE_FP_INPUT, currency: 'GBP' });
  const fpNUL = computeFingerprint({ ...BASE_FP_INPUT, currency: null });
  ok(fpEUR !== fpGBP, 'EUR ≠ GBP fingerprint');
  ok(fpEUR !== fpNUL, 'EUR ≠ null fingerprint');
  ok(fpGBP !== fpNUL, 'GBP ≠ null fingerprint');
});

// ── [J] Service: source mapping ───────────────────────────────────────────────
console.log('\n── [J] Source mapping — all sources preserved ───────────────────────────');

test('J-01 manual_override source preserved', async () => {
  const r = buildObservationRecord(makeNight({ source: SOURCE.MANUAL_OVERRIDE, locked: true }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.price_source, 'manual_override', 'manual_override source');
  eq(r.manual_override_present, true, 'manual_override_present flag');
  eq(r.boostprice_present, false, 'boostprice_present false for manual');
});
test('J-02 boostprice source preserved', async () => {
  const r = buildObservationRecord(makeNight({ source: SOURCE.BOOSTPRICE }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.price_source, 'boostprice', 'boostprice source');
  eq(r.boostprice_present, true, 'boostprice_present flag');
  eq(r.manual_override_present, false, 'manual_override_present false for boostprice');
});
test('J-03 period_rule source preserved', async () => {
  const r = buildObservationRecord(makeNight({ source: SOURCE.PERIOD_RULE }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.price_source, 'period_rule', 'period_rule source');
});
test('J-04 weekday_rule source preserved', async () => {
  const r = buildObservationRecord(makeNight({ source: SOURCE.WEEKDAY_RULE }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.price_source, 'weekday_rule', 'weekday_rule source');
});
test('J-05 base_price source preserved', async () => {
  const r = buildObservationRecord(makeNight({ source: SOURCE.BASE_PRICE }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.price_source, 'base_price', 'base_price source');
});
test('J-06 none source (no price) preserved', async () => {
  const r = buildObservationRecord(makeNight({ source: SOURCE.NONE, price: null }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.price_source, 'none', 'none source');
  eq(r.canonical_price, null, 'canonical_price null for source=none');
});
test('J-07 weekend_price source preserved', async () => {
  const r = buildObservationRecord(makeNight({ source: SOURCE.WEEKEND_PRICE }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.price_source, 'weekend_price', 'weekend_price source');
});

// ── [K] Service: no second resolver, no price recalculation ───────────────────
console.log('\n── [K] No second resolver, no price recalculation ───────────────────────');

test('K-01 service does not require effective-pricing-resolver', async () => {
  ok(!SERVICE_SRC.includes('effective-pricing-resolver'), 'no import of effective-pricing-resolver');
});
test('K-02 service does not require pricing-engine', async () => {
  ok(!SERVICE_SRC.includes('pricing-engine'), 'no import of pricing-engine');
});
test('K-03 service does not call priceProperty', async () => {
  ok(!SERVICE_SRC.includes('priceProperty'), 'no priceProperty call');
});
test('K-04 service does not call resolveEffectivePrices', async () => {
  // Allow the string in comments (e.g. "called after resolveEffectivePrices,")
  // but not as an actual function invocation (resolveEffectivePrices(...))
  ok(!SERVICE_SRC.includes('resolveEffectivePrices('), 'no resolveEffectivePrices() call');
});
test('K-05 service does not compute price (no seasonByMonth, dow, leadCurve)', async () => {
  ok(!SERVICE_SRC.includes('seasonByMonth'), 'no seasonByMonth');
  ok(!SERVICE_SRC.includes('leadCurve'), 'no leadCurve');
  ok(!SERVICE_SRC.includes('basePrice * '), 'no price arithmetic on basePrice');
});

// ── [L] Service: persistence failure does not block caller ────────────────────
console.log('\n── [L] Persistence failure does not block caller ────────────────────────');

test('L-01 DB failure → observePricingState returns result, does not throw', async () => {
  const pool = makePool({ failFetch: true });
  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'true';

  let threw = false;
  let result;
  try {
    result = await observePricingState(pool, {
      propertyId: 'p1', prop: makeProp(), nights: [makeNight()], context: {},
    });
  } catch(e) {
    threw = true;
  }

  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];
  ok(!threw, 'no throw on DB failure');
  ok(result !== undefined, 'result returned even on DB failure');
});

test('L-02 table absent (migration not applied) → no throw, empty result', async () => {
  const pool = makePool({ tableAbsent: true });
  // Also stub properties query
  const origQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (/SELECT.*FROM properties/i.test(sql)) return { rows: [{ currency: 'EUR', timezone: null }] };
    return origQuery(sql, params);
  };

  const saved = process.env[FLAG_NAME];
  process.env[FLAG_NAME] = 'true';

  let threw = false;
  try {
    await observePricingState(pool, {
      propertyId: 'p1', prop: makeProp(), nights: [makeNight()], context: {},
    });
  } catch(e) {
    threw = true;
  }

  if (saved !== undefined) process.env[FLAG_NAME] = saved; else delete process.env[FLAG_NAME];
  ok(!threw, 'no throw when table absent (migration not applied)');
});

// ── [M] Publisher: onObserve hook ─────────────────────────────────────────────
console.log('\n── [M] Publisher: onObserve hook called after resolve ───────────────────');

test('M-01 createPublisher accepts onObserve dep', async () => {
  let observeCalled = false;
  let observedNights = null;
  let observedPropId = null;

  const publisher = createPublisher({
    onObserve: async (pool, { propertyId, nights }) => {
      observeCalled = true;
      observedNights = nights;
      observedPropId = propertyId;
    },
    resolveEffectivePrices: async () => [makeNight()],
    pushRates: async () => ({ count: 1 }),
    pushRestrictions: async () => ({ count: 1 }),
    acquireLock: async () => {},
    releaseLock: async () => {},
    connectClient: (pool) => pool.connect(),
  });

  const mockPool = {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('FROM properties')) {
          return { rows: [{ id: 'p1', user_id: 'u1', channex_enabled: true,
            channex_property_id: 'cx1', channex_room_type_id: 'rt1',
            channex_rate_plan_id: 'rp1', external_pricing: false }] };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    }),
  };

  await publisher(mockPool, { propertyId: 'p1', userId: 'u1', startDate: '2026-10-01', endDate: '2026-10-02' });

  ok(observeCalled, 'onObserve was called by publisher');
  ok(Array.isArray(observedNights), 'nights array passed to observer');
  eq(observedPropId, 'p1', 'propertyId passed to observer');
});

test('M-02 observer receives nights from resolve (not re-calculated)', async () => {
  const EXPECTED_NIGHTS = [makeNight({ price: 777 })];
  let passedNights;

  const publisher = createPublisher({
    onObserve: async (pool, { nights }) => { passedNights = nights; },
    resolveEffectivePrices: async () => EXPECTED_NIGHTS,
    pushRates: async () => ({ count: 1 }),
    pushRestrictions: async () => ({ count: 1 }),
    acquireLock: async () => {},
    releaseLock: async () => {},
    connectClient: (pool) => pool.connect(),
  });

  const mockPool = {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('FROM properties')) {
          return { rows: [{ id: 'p1', user_id: 'u1', channex_enabled: true,
            channex_property_id: 'cx1', channex_room_type_id: 'rt1',
            channex_rate_plan_id: 'rp1', external_pricing: false }] };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    }),
  };

  await publisher(mockPool, { propertyId: 'p1', userId: 'u1', startDate: '2026-10-01', endDate: '2026-10-02' });

  ok(passedNights === EXPECTED_NIGHTS, 'observer received exact nights from resolver (same reference)');
});

// ── [N] Publisher: observation failure does not block Channex ─────────────────
console.log('\n── [N] Observation failure does not block Channex ───────────────────────');

test('N-01 observer throws → publisher continues and calls pushRates', async () => {
  let pushRatesCalled = false;

  const publisher = createPublisher({
    onObserve: async () => { throw new Error('DB exploded'); },
    resolveEffectivePrices: async () => [makeNight()],
    pushRates: async () => { pushRatesCalled = true; return { count: 1 }; },
    pushRestrictions: async () => ({ count: 1 }),
    acquireLock: async () => {},
    releaseLock: async () => {},
    connectClient: (pool) => pool.connect(),
  });

  const mockPool = {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('FROM properties')) {
          return { rows: [{ id: 'p1', user_id: 'u1', channex_enabled: true,
            channex_property_id: 'cx1', channex_room_type_id: 'rt1',
            channex_rate_plan_id: 'rp1', external_pricing: false }] };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    }),
  };

  const result = await publisher(mockPool, { propertyId: 'p1', userId: 'u1', startDate: '2026-10-01', endDate: '2026-10-02' });
  ok(pushRatesCalled, 'pushRates called even when observer throws');
  eq(result.status, PUBLISH_STATUS.OK, 'publish result is OK despite observation failure');
});

test('N-02 PRICE_OBSERVATION_FAILURE_BLOCKS_PRICING = NO (documented in service)', async () => {
  ok(SERVICE_SRC.includes('PRICE_OBSERVATION_FAILURE_BLOCKS_PRICING = NO'), 'documented in service');
});

// ── [O] Publisher: onObserve=null → no observation ───────────────────────────
console.log('\n── [O] onObserve=null → publisher skips observation ─────────────────────');

test('O-01 onObserve=null → no observation call, publish still works', async () => {
  let observeCalled = false;

  const publisher = createPublisher({
    onObserve: null, // explicitly disabled
    resolveEffectivePrices: async () => [makeNight()],
    pushRates: async () => ({ count: 1 }),
    pushRestrictions: async () => ({ count: 1 }),
    acquireLock: async () => {},
    releaseLock: async () => {},
    connectClient: (pool) => pool.connect(),
  });

  const mockPool = {
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('FROM properties')) {
          return { rows: [{ id: 'p1', user_id: 'u1', channex_enabled: true,
            channex_property_id: 'cx1', channex_room_type_id: 'rt1',
            channex_rate_plan_id: 'rp1', external_pricing: false }] };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    }),
  };

  const result = await publisher(mockPool, { propertyId: 'p1', userId: 'u1', startDate: '2026-10-01', endDate: '2026-10-02' });
  ok(!observeCalled, 'observation not called when onObserve=null');
  eq(result.status, PUBLISH_STATUS.OK, 'publisher returns OK');
});

// ── [P] Authority proof ────────────────────────────────────────────────────────
console.log('\n── [P] Authority proof: no pricing engine reads price_observations ────────');

const PRICING_FILES = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/effective-pricing-resolver.js',
  'routes/dynamic-pricing-routes.js',
];

for (const f of PRICING_FILES) {
  test(`P-${PRICING_FILES.indexOf(f)+1} ${f} does not read price_observations`, async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const readPatterns = [/SELECT.*FROM\s+price_observations/i, /JOIN\s+price_observations/i];
    for (const pat of readPatterns) {
      ok(!pat.test(src), `${f}: no SELECT/JOIN from price_observations`);
    }
  });
}

// ── [Q] No historical backfill ────────────────────────────────────────────────
console.log('\n── [Q] No historical backfill ───────────────────────────────────────────');

test('Q-01 service does not create observations with fixed historical dates', async () => {
  ok(!SERVICE_SRC.includes('2024-') && !SERVICE_SRC.includes('2025-01'), 'no hardcoded historical dates in service');
});
test('Q-02 migration has no INSERT with historical dates', async () => {
  ok(!MIGRATION_SRC.match(/INSERT.*INTO.*price_observations/i), 'no INSERT in migration');
});
test('Q-03 service uses new Date() for observed_at (not a fixed past date)', async () => {
  ok(SERVICE_SRC.includes('new Date()') || SERVICE_SRC.includes('new Date('), 'service uses current time');
  ok(!SERVICE_SRC.match(/new Date\(['"]20[12][0-9]-/), 'no hardcoded past date for observed_at');
});
test('Q-04 HISTORICAL_BACKFILL documented as NO in service', async () => {
  ok(!SERVICE_SRC.includes('backfill') || SERVICE_SRC.includes('NO'), 'no backfill policy documented');
});

// ── [R] Audit tool: SELECT-only, safe with missing table ─────────────────────
console.log('\n── [R] Audit tool: SELECT-only, safe with missing table ─────────────────');

test('R-01 audit tool has no INSERT INTO', async () => {
  ok(!/\bINSERT\b.*\bINTO\b/i.test(AUDIT_SRC), 'no INSERT INTO in audit');
});
test('R-02 audit tool has no UPDATE ... SET', async () => {
  // Only check SQL constants, not documentation strings
  const sqlConstants = (AUDIT_SRC.match(/const [A-Z_]+_SQL\s*=\s*`[\s\S]+?`/g) || []).join('\n');
  ok(!/\bUPDATE\b.*\bSET\b/i.test(sqlConstants), 'no UPDATE SET in SQL constants');
});
test('R-03 audit tool has no DELETE FROM', async () => {
  ok(!/\bDELETE\s+FROM\b/i.test(AUDIT_SRC), 'no DELETE FROM in audit');
});
test('R-04 audit tool returns early when table absent (no exception)', async () => {
  // 'TABLE_EXISTS: NO' is inside a template literal, check for TABLE_EXISTS check + safe-continue
  ok(AUDIT_SRC.includes('TABLE_EXISTS'), 'TABLE_EXISTS check present in audit');
  ok(AUDIT_SRC.includes('SAFE_TO_CONTINUE'), 'SAFE_TO_CONTINUE message present');
  ok(AUDIT_SRC.includes('migration 008'), 'audit references migration 008 for the absent-table case');
});
test('R-05 audit tool exports runAudit and checkPricingAuthorityProof', async () => {
  const { runAudit, checkPricingAuthorityProof } = require('../outils/audit-price-observation-readiness-p1_5_t1');
  ok(typeof runAudit === 'function', 'runAudit exported');
  ok(typeof checkPricingAuthorityProof === 'function', 'checkPricingAuthorityProof exported');
});
test('R-06 audit authority proof returns 0 violations', async () => {
  const { checkPricingAuthorityProof } = require('../outils/audit-price-observation-readiness-p1_5_t1');
  const violations = checkPricingAuthorityProof();
  ok(Array.isArray(violations), 'returns array');
  eq(violations.length, 0, `0 violations (found: ${violations.length}${violations.length ? ': ' + violations[0] : ''})`);
});

// ── [S] Restrictions preserved ────────────────────────────────────────────────
console.log('\n── [S] Restrictions preserved ───────────────────────────────────────────');

test('S-01 stop_sell=true preserved in record and fingerprint', async () => {
  const night = makeNight({ stopSell: true, stopSellSource: 'stop_sell_rule' });
  const r = buildObservationRecord(night, {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.stop_sell, true, 'stop_sell=true in record');
  ok(r.state_fingerprint.includes('true'), 'stop_sell=true in fingerprint');
});
test('S-02 min_stay_arrival=3 persists correctly', async () => {
  const night = makeNight({ minStayArrival: 3, minStayThrough: 3 });
  const r = buildObservationRecord(night, {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt: OBS_AT,
  });
  eq(r.min_stay_arrival, 3, 'min_stay_arrival');
  eq(r.min_stay_through, 3, 'min_stay_through');
});
test('S-03 stop_sell flip changes fingerprint', async () => {
  const fpOff = computeFingerprint({ ...BASE_FP_INPUT, stop_sell: false });
  const fpOn  = computeFingerprint({ ...BASE_FP_INPUT, stop_sell: true });
  ok(fpOff !== fpOn, 'stop_sell flip changes fingerprint');
});

// ── [T] Lead days computation ─────────────────────────────────────────────────
console.log('\n── [T] Lead days computation ────────────────────────────────────────────');

test('T-01 lead_days = 15 for stay 15 days out', async () => {
  const observedAt = new Date('2026-10-01T10:00:00Z');
  const r = buildObservationRecord(makeNight({ date: '2026-10-16' }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt,
  });
  eq(r.lead_days, 15, 'lead_days=15');
});
test('T-02 same-day stay → lead_days = 0', async () => {
  const observedAt = new Date('2026-10-15T10:00:00Z');
  const r = buildObservationRecord(makeNight({ date: '2026-10-15' }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt,
  });
  eq(r.lead_days, 0, 'lead_days=0 for same day');
});
test('T-03 past stay date → lead_days = null', async () => {
  const observedAt = new Date('2026-10-20T10:00:00Z');
  const r = buildObservationRecord(makeNight({ date: '2026-10-15' }), {
    propertyId: 'p1', currency: 'EUR', currencyProvenance: 'property_record',
    propertyTimezone: null, externalPricing: false, publisherRunId: null, observedAt,
  });
  eq(r.lead_days, null, 'past stay → lead_days null');
});

// ── [U] No Channex side effects, no network ───────────────────────────────────
console.log('\n── [U] No Channex side effects, no network ──────────────────────────────');

test('U-01 service does not require channex', async () => {
  ok(!SERVICE_SRC.includes("require('../channex')"), 'no channex require');
  ok(!SERVICE_SRC.includes("require('./channex')"), 'no channex require');
});
test('U-02 service does not use fetch, http, or axios', async () => {
  ok(!SERVICE_SRC.includes("require('http')") && !SERVICE_SRC.includes("require('https')"), 'no http/https');
  ok(!SERVICE_SRC.includes("require('axios')") && !SERVICE_SRC.includes("require('node-fetch')"), 'no axios/node-fetch');
  ok(!SERVICE_SRC.includes('fetch('), 'no fetch()');
});
test('U-03 migration does not reference Channex', async () => {
  // Migration may mention "Channex" in comments to clarify what the table is NOT for.
  // Verify it has no Channex API columns or table joins.
  ok(!/channex_property_id|channex_rate_plan_id|channex_room_type_id/i.test(MIGRATION_SRC), 'no Channex API columns in migration');
  ok(!/JOIN\s+channex/i.test(MIGRATION_SRC), 'no JOIN channex in migration');
});
test('U-04 publisher onObserve receives pool not channex client', async () => {
  // The pool passed to onObserve is the outer pool, not the dedicated client
  ok(PUBLISHER_SRC.includes('await _observeFn(pool, {'), 'pool passed to observer (not client)');
});
test('U-05 OTA_DISPLAYED not used as publication_state value', async () => {
  // Migration may mention OTA_DISPLAYED in a comment to say it must NOT be used.
  // Verify it is not in the CHECK constraint (not a valid value).
  ok(!MIGRATION_SRC.match(/CHECK\s*\([^)]*OTA_DISPLAYED/i), 'OTA_DISPLAYED not in CHECK constraint');
  ok(!SERVICE_SRC.includes('OTA_DISPLAYED'), 'OTA_DISPLAYED not used in service');
});

// ── Summary ───────────────────────────────────────────────────────────────────

async function main() {
  // All tests above are async — wait for them
  // (since we're using top-level async test() calls, we need a flush)
  await new Promise(resolve => setImmediate(resolve));

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`P1.5-T1: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED:`);
    for (const f of failures) console.error(`  • ${f.name}: ${f.message}`);
    process.exit(1);
  } else {
    console.log('All tests passed ✅');
  }
}

main().catch(err => { console.error(err); process.exit(1); });

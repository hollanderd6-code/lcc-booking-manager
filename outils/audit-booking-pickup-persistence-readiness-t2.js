'use strict';
/**
 * P1.3-T2 — Booking Pickup Persistence Activation Readiness Audit
 *
 * READ-ONLY diagnostic. Checks whether the persistence infrastructure
 * for booking_pickup_observations is correctly structured and ready for
 * activation. Produces a readiness checklist with pass/fail status.
 *
 * This tool NEVER:
 *   enables the BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED flag
 *   writes DB rows (even though table structure is checked)
 *   calls Channex
 *   calls market data providers (Bright Data, APIFY, Geoapify)
 *   modifies pricing_schedule, pricing_config, or reservations
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_PROVIDER_CALLS  = 0  always
 *   PRICING_WRITES         = 0  always
 *   PICKUP_HAS_PRICING_AUTHORITY = NO
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-booking-pickup-persistence-readiness-t2.js
 *   NODE_ENV=production node outils/audit-booking-pickup-persistence-readiness-t2.js \
 *     --properties=30 --horizon=90
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const { createPool } = require('../services/db-pool');
const {
  isPersistenceEnabled,
  observationDateFromCalcAt,
  INSERT_OBSERVATION_SQL,
} = require('../services/booking-pickup-persistence');
const {
  calculatePickupShadow,
  TRUSTED_SOURCES,
  RECENT_WINDOW_DAYS,
  MODEL_VERSION,
  MIN_EXPECTED_FOR_SIGNAL,
} = require('../services/booking-pickup-shadow');

// ── CLI args ──────────────────────────────────────────────────
const ARG_PROPERTIES = parseInt(
  (process.argv.find(a => a.startsWith('--properties=')) || '').replace('--properties=', '') || '0',
  10,
) || null;

const ARG_HORIZON = parseInt(
  (process.argv.find(a => a.startsWith('--horizon=')) || '').replace('--horizon=', '') || '0',
  10,
) || null;

// ── Constants ─────────────────────────────────────────────────
const BYTES_PER_ROW    = 200;   // conservative estimate incl. JSONB metadata + index overhead
const HORIZON_OPTIONS  = [30, 60, 90, 365];
const PROPERTY_OPTIONS = [3, 30, 100, 500];
const RECOMMENDED_HORIZON = 30;

// ── Required columns in booking_pickup_observations ───────────
const REQUIRED_COLUMNS = [
  'id', 'property_id', 'target_date', 'calculated_at', 'observation_date',
  'lead_time_days', 'lead_time_band', 'lookback_months', 'target_window_days',
  'historical_total', 'historical_band_count', 'comparable_sample_size',
  'recent_window_days', 'recent_booking_count', 'expected_booking_count',
  'raw_pickup_ratio', 'pickup_ratio',
  'status', 'confidence', 'advisory_multiplier',
  'occupancy_fraction', 'pacing_pickup_relation',
  'model_version', 'anomalies_excluded', 'metadata',
];

// ── Pricing authority proof ────────────────────────────────────
const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
  'routes/dynamic-pricing-cron.js',
];

const PICKUP_MODULES = [
  'booking-pickup-shadow',
  'booking-pickup-persistence',
];

// ── Active properties SQL ─────────────────────────────────────
const ACTIVE_PROPERTIES_SQL = `
  SELECT pc.property_id, p.internal_name, p.name
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

const TABLE_COLUMNS_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'booking_pickup_observations'
  ORDER BY ordinal_position
`;

const TABLE_CONSTRAINTS_SQL = `
  SELECT conname, contype, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE conrelid = 'booking_pickup_observations'::regclass
`;

const ROW_COUNT_SQL = `
  SELECT COUNT(*) AS cnt FROM booking_pickup_observations
`;

// ── Helpers ───────────────────────────────────────────────────
function displayName(p) {
  return p.internal_name || p.name || p.property_id;
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function storageEstimate(numProperties, horizonDays) {
  const rowsPerYear = numProperties * horizonDays * 365;
  return {
    rowsPerYear,
    bytesPerYear: rowsPerYear * BYTES_PER_ROW,
    rowsPerDay:   numProperties * horizonDays,
  };
}

function checkPickupAuthorityProof() {
  const ROOT = path.join(__dirname, '..');
  const violations = [];

  for (const pricingFile of PRICING_CHAIN) {
    const fpath = path.join(ROOT, pricingFile);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    for (const mod of PICKUP_MODULES) {
      if (src.includes(`require`) && src.includes(mod)) {
        violations.push(`${pricingFile} imports ${mod}`);
      }
    }
  }

  return violations;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const pool = createPool();

  try {
    const now = new Date().toISOString();

    console.log('');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  P1.3-T2 — BOOKING PICKUP PERSISTENCE READINESS AUDIT');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Run at:         ${now}`);
    console.log(`  Model version:  ${MODEL_VERSION}`);
    console.log(`  Persistence:    ${isPersistenceEnabled() ? 'ENABLED ← UNEXPECTED' : 'OFF (correct — not yet activated)'}`);
    console.log(`  DB_WRITES=0  CHANNEX_CALLS=0  MARKET_PROVIDER_CALLS=0`);
    console.log('──────────────────────────────────────────────────────────────');

    const checks = [];

    // ── 1. Table existence and columns ───────────────────────
    console.log('\n  [1] TABLE STRUCTURE');
    let tableExists = false;
    let existingColumns = [];
    let missingColumns = [];

    try {
      const colRes  = await pool.query(TABLE_COLUMNS_SQL);
      const conRes  = await pool.query(TABLE_CONSTRAINTS_SQL);
      const cntRes  = await pool.query(ROW_COUNT_SQL);

      tableExists    = true;
      existingColumns = colRes.rows.map(r => r.column_name);
      missingColumns  = REQUIRED_COLUMNS.filter(c => !existingColumns.includes(c));

      console.log(`  Table exists:   YES  (${existingColumns.length} columns, ${cntRes.rows[0].cnt} rows)`);
      console.log(`  Missing cols:   ${missingColumns.length === 0 ? 'none ✓' : missingColumns.join(', ') + ' ← NEED MIGRATION'}`);

      const hasObsDate      = existingColumns.includes('observation_date');
      const hasRawRatio     = existingColumns.includes('raw_pickup_ratio');

      console.log(`  observation_date:   ${hasObsDate  ? 'present ✓' : 'MISSING — run migration 006'}`);
      console.log(`  raw_pickup_ratio:   ${hasRawRatio ? 'present ✓' : 'MISSING — run migration 006'}`);

      const dedupConstraint = conRes.rows.find(r => r.conname === 'bpo_property_target_obs_model_unique');
      const oldConstraint   = conRes.rows.find(r => r.conname.includes('calculated'));

      console.log(`  dedup constraint:   ${dedupConstraint ? 'bpo_property_target_obs_model_unique ✓' : 'MISSING — run migration 006'}`);
      if (oldConstraint) {
        console.log(`  old constraint:     ${oldConstraint.conname} still present — run migration 006`);
      }

      checks.push({ name: 'Table exists',                pass: tableExists });
      checks.push({ name: 'observation_date column',     pass: hasObsDate });
      checks.push({ name: 'raw_pickup_ratio column',     pass: hasRawRatio });
      checks.push({ name: 'bpo dedup constraint',        pass: !!dedupConstraint });
      checks.push({ name: 'Old calculated_at constraint dropped', pass: !oldConstraint });

    } catch (err) {
      if (err.message.includes('does not exist') || err.message.includes('regclass')) {
        console.log(`  Table exists:   NO — migration 005 not yet applied`);
        checks.push({ name: 'Table exists',            pass: false });
        checks.push({ name: 'observation_date column', pass: false });
        checks.push({ name: 'raw_pickup_ratio column', pass: false });
        checks.push({ name: 'bpo dedup constraint',    pass: false });
        checks.push({ name: 'Old calculated_at constraint dropped', pass: true });
      } else {
        console.error(`  [TABLE_CHECK_FAILURE] ${err.message}`);
        checks.push({ name: 'Table structure check',   pass: false });
        process.exitCode = 1;
      }
    }

    // ── 2. INSERT SQL structural proof ───────────────────────
    console.log('\n  [2] INSERT SQL STRUCTURE');
    const sqlHasObsDate  = INSERT_OBSERVATION_SQL.includes('observation_date');
    const sqlHasRawRatio = INSERT_OBSERVATION_SQL.includes('raw_pickup_ratio');
    const sqlHasDedup    = INSERT_OBSERVATION_SQL.includes('bpo_property_target_obs_model_unique');
    const sqlHasDoNothing = INSERT_OBSERVATION_SQL.includes('DO NOTHING');
    const paramCount     = (INSERT_OBSERVATION_SQL.match(/\$\d+/g) || [])
      .map(p => parseInt(p.slice(1), 10))
      .reduce((max, n) => Math.max(max, n), 0);

    console.log(`  observation_date in SQL:  ${sqlHasObsDate  ? '✓' : '✗'}`);
    console.log(`  raw_pickup_ratio in SQL:  ${sqlHasRawRatio ? '✓' : '✗'}`);
    console.log(`  ON CONFLICT dedup name:   ${sqlHasDedup    ? '✓' : '✗'}`);
    console.log(`  DO NOTHING on conflict:   ${sqlHasDoNothing ? '✓' : '✗'}`);
    console.log(`  Max param index:          $${paramCount}  (expected $23)`);

    checks.push({ name: 'INSERT SQL has observation_date', pass: sqlHasObsDate });
    checks.push({ name: 'INSERT SQL has raw_pickup_ratio', pass: sqlHasRawRatio });
    checks.push({ name: 'INSERT SQL uses named dedup constraint', pass: sqlHasDedup });
    checks.push({ name: 'INSERT SQL param count = 23', pass: paramCount === 23 });

    // ── 3. observationDateFromCalcAt semantics ────────────────
    console.log('\n  [3] OBSERVATION DATE SEMANTICS (UTC)');
    const sampleTs  = '2026-09-30T05:45:00.000Z';
    const sampleTs2 = '2026-09-30T23:59:59.999Z';
    const od1 = observationDateFromCalcAt(sampleTs);
    const od2 = observationDateFromCalcAt(sampleTs2);
    const odNull = observationDateFromCalcAt(null);
    console.log(`  2026-09-30T05:45:00Z  → ${od1}  (expected 2026-09-30)`);
    console.log(`  2026-09-30T23:59:59Z  → ${od2}  (expected 2026-09-30)`);
    console.log(`  null                  → ${odNull}  (today UTC, any date)`);
    checks.push({ name: 'observationDateFromCalcAt UTC semantics', pass: od1 === '2026-09-30' && od2 === '2026-09-30' });

    // ── 4. Persistence flag gate ──────────────────────────────
    console.log('\n  [4] PERSISTENCE FLAG GATE');
    const flagState = isPersistenceEnabled();
    console.log(`  BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED: ${process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED ?? '(unset)'}`);
    console.log(`  isPersistenceEnabled():  ${flagState}`);
    console.log(`  Correct state (should be false): ${!flagState ? '✓' : '✗ — DO NOT enable yet'}`);
    checks.push({ name: 'Persistence flag is OFF (safe default)', pass: !flagState });

    // ── 5. Pricing authority proof ────────────────────────────
    console.log('\n  [5] PRICING AUTHORITY PROOF  (PICKUP_HAS_PRICING_AUTHORITY=NO)');
    const violations = checkPickupAuthorityProof();
    if (violations.length === 0) {
      console.log('  No pickup module imports found in pricing chain ✓');
      PRICING_CHAIN.forEach(f => {
        const exists = fs.existsSync(path.join(__dirname, '..', f));
        console.log(`    ${exists ? 'checked' : 'skipped (not found)'}  ${f}`);
      });
    } else {
      violations.forEach(v => console.log(`  ✗ VIOLATION: ${v}`));
    }
    checks.push({ name: 'PICKUP_HAS_PRICING_AUTHORITY=NO', pass: violations.length === 0 });

    // ── 6. Active properties dry-run ─────────────────────────
    console.log('\n  [6] DRY-RUN (calculatePickupShadow, persistence=OFF)');
    let props = [];
    try {
      const res = await pool.query(ACTIVE_PROPERTIES_SQL);
      props = res.rows;
      console.log(`  Active properties: ${props.length}`);
    } catch (err) {
      console.error(`  [QUERY_FAILURE] ${err.message}`);
      process.exitCode = 1;
    }

    const targetDate = new Date();
    targetDate.setUTCDate(targetDate.getUTCDate() + RECENT_WINDOW_DAYS);
    const targetDateStr = targetDate.toISOString().slice(0, 10);
    console.log(`  Target date (dry-run):  ${targetDateStr}`);

    let dryOk = 0, dryErr = 0;
    for (const prop of props.slice(0, ARG_PROPERTIES || props.length)) {
      try {
        const obs = await calculatePickupShadow(pool, prop.property_id, targetDateStr);
        const obsDate = observationDateFromCalcAt(obs.calculatedAt);
        console.log(`    ✓  ${displayName(prop)}  status=${obs.status}  conf=${obs.confidence}  advisory=${obs.advisoryMultiplier}  obs_date=${obsDate}`);
        dryOk++;
      } catch (err) {
        console.log(`    ✗  ${displayName(prop)}  [PICKUP_FAILURE] ${err.message}`);
        dryErr++;
      }
    }
    console.log(`  Dry-run result: ${dryOk} OK, ${dryErr} errors`);
    checks.push({ name: 'Pickup calculation succeeds for all properties', pass: dryErr === 0 && props.length > 0 });

    // ── 7. Storage projections ────────────────────────────────
    console.log('\n  [7] STORAGE PROJECTIONS');
    console.log(`  Bytes/row estimate: ${BYTES_PER_ROW}  (incl. JSONB + index overhead)`);
    console.log('');
    console.log('  Props │ Horizon │ Rows/day │  Rows/year │  Size/year');
    console.log('  ──────┼─────────┼──────────┼────────────┼───────────');

    const horizons    = ARG_HORIZON    ? [ARG_HORIZON]    : HORIZON_OPTIONS;
    const propCounts  = ARG_PROPERTIES ? [ARG_PROPERTIES] : PROPERTY_OPTIONS;

    for (const p of propCounts) {
      for (const h of horizons) {
        const est = storageEstimate(p, h);
        const rec = (p === (ARG_PROPERTIES || 3) && h === RECOMMENDED_HORIZON) ? ' ← recommended' : '';
        console.log(
          `  ${String(p).padStart(5)} │ ${String(h).padStart(7)} │ ${String(est.rowsPerDay).padStart(8)} │ ` +
          `${String(est.rowsPerYear.toLocaleString()).padStart(10)} │ ${formatBytes(est.bytesPerYear).padStart(10)}${rec}`
        );
      }
    }

    console.log('');
    console.log(`  Recommended horizon: ${RECOMMENDED_HORIZON} days`);
    console.log('  Rationale: lead-time pickup most actionable for near-term dates;');
    console.log('  GOOD confidence requires ≥15 comparable historical bookings in band.');

    // ── 8. Integration point ──────────────────────────────────
    console.log('\n  [8] INTEGRATION POINT');
    console.log('  Proposed: new daily cron in routes/dynamic-pricing-cron.js');
    console.log('  Schedule: 0 6 * * *  (daily 06:00 Europe/Paris, after refresh)');
    console.log('  Pattern:');
    console.log('    // P1.3-T2 — Pickup shadow (feature-flagged, OFF by default)');
    console.log('    if (require(\'../services/booking-pickup-persistence\').isPersistenceEnabled()) {');
    console.log('      runPickupShadowJob(pool, { horizonDays: PICKUP_HORIZON_DAYS })');
    console.log('        .catch(err => console.error(\'[PICKUP_PERSIST_FAILURE]\', err.message));');
    console.log('    }');
    console.log('  NOTE: Integration is NOT wired in yet. T2 only proves readiness.');

    // ── 9. Readiness checklist ────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  P1.3-T2 READINESS CHECKLIST');
    console.log('──────────────────────────────────────────────────────────────');

    let allPass = true;
    for (const { name, pass } of checks) {
      const icon = pass ? '✓' : '✗';
      console.log(`  ${icon}  ${name}`);
      if (!pass) allPass = false;
    }

    console.log('──────────────────────────────────────────────────────────────');
    if (allPass) {
      console.log('  ALL CHECKS PASSED — persistence can be activated when ready');
      console.log('  To activate: set BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED=true');
      console.log('  Before activating: apply migration 006 if table already exists');
    } else {
      console.log('  ONE OR MORE CHECKS FAILED — resolve before activation');
      process.exitCode = 1;
    }
    console.log('  ADVISORY ONLY — no pricing changes applied');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('');

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

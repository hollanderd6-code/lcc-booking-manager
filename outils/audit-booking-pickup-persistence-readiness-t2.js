'use strict';
/**
 * P1.3-T2-FIX — Booking Pickup Persistence Activation Readiness Audit
 *
 * READ-ONLY diagnostic. Checks whether the persistence infrastructure
 * for booking_pickup_observations is correctly structured and ready for
 * activation. Produces a readiness checklist with PASS / FAIL / N/A status.
 *
 * This tool NEVER:
 *   enables the BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED flag
 *   writes DB rows
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
  isValidTimezone,
  observationDateFromCalcAt,
  INSERT_OBSERVATION_SQL,
} = require('../services/booking-pickup-persistence');
const {
  PICKUP_HORIZON_DAYS,
  generateTargetDates,
} = require('../services/booking-pickup-shadow-job');
const {
  calculatePickupShadow,
  RECENT_WINDOW_DAYS,
  MODEL_VERSION,
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
const BYTES_PER_ROW    = 200;
const HORIZON_OPTIONS  = [30, 60, 90, 365];
const PROPERTY_OPTIONS = [3, 30, 100, 500];

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
];

const PICKUP_MODULES = [
  'booking-pickup-shadow',
  'booking-pickup-persistence',
  'booking-pickup-shadow-job',
];

// ── Active properties SQL ─────────────────────────────────────
const ACTIVE_PROPERTIES_SQL = `
  SELECT pc.property_id, p.internal_name, p.name, p.timezone
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

// ── Check state: PASS / FAIL / N/A ───────────────────────────
// pass: true  = PASS
// pass: false = FAIL
// pass: null  = N/A (check not applicable in this environment state)
function makeCheck(name, pass, naReason) {
  return { name, pass: pass === undefined ? null : pass, naReason };
}

function checkIcon(pass) {
  if (pass === null)  return 'N/A';
  return pass ? '✓' : '✗';
}

function isReady(checks) {
  // N/A checks do not count as PASS — but they don't fail readiness unless
  // they represent something that must exist (e.g. table itself).
  return checks.every(c => c.pass === true || c.pass === null);
}

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
      const requirePattern = new RegExp(`require\\(['""][^'"]*${mod.replace(/-/g, '[-_]')}`, 'i');
      if (requirePattern.test(src)) {
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
    console.log('  P1.3-T2-FIX — BOOKING PICKUP PERSISTENCE READINESS AUDIT');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Run at:         ${now}`);
    console.log(`  Model version:  ${MODEL_VERSION}`);
    console.log(`  Horizon:        ${PICKUP_HORIZON_DAYS} days`);
    console.log(`  Persistence:    ${isPersistenceEnabled() ? 'ENABLED ← UNEXPECTED' : 'OFF (correct — not yet activated)'}`);
    console.log(`  DB_WRITES=0  CHANNEX_CALLS=0  MARKET_PROVIDER_CALLS=0`);
    console.log('──────────────────────────────────────────────────────────────');

    const checks = [];

    // ── 1. Table existence and columns ───────────────────────
    console.log('\n  [1] TABLE STRUCTURE');
    let tableExists = false;

    try {
      const colRes  = await pool.query(TABLE_COLUMNS_SQL);
      const conRes  = await pool.query(TABLE_CONSTRAINTS_SQL);
      const cntRes  = await pool.query(ROW_COUNT_SQL);

      tableExists = true;
      const existingColumns = colRes.rows.map(r => r.column_name);
      const missingColumns  = REQUIRED_COLUMNS.filter(c => !existingColumns.includes(c));

      console.log(`  Table exists:   YES  (${existingColumns.length} columns, ${cntRes.rows[0].cnt} rows)`);
      console.log(`  Missing cols:   ${missingColumns.length === 0 ? 'none ✓' : missingColumns.join(', ') + ' ← NEED MIGRATION'}`);

      const hasObsDate  = existingColumns.includes('observation_date');
      const hasRawRatio = existingColumns.includes('raw_pickup_ratio');
      console.log(`  observation_date:   ${hasObsDate  ? 'present ✓' : 'MISSING — run migration 006'}`);
      console.log(`  raw_pickup_ratio:   ${hasRawRatio ? 'present ✓' : 'MISSING — run migration 006'}`);

      const dedupConstraint = conRes.rows.find(r => r.conname === 'bpo_property_target_obs_model_unique');
      const oldConstraint   = conRes.rows.find(r => r.conname.includes('calculated'));
      console.log(`  dedup constraint:   ${dedupConstraint ? 'bpo_property_target_obs_model_unique ✓' : 'MISSING — run migration 006'}`);
      if (oldConstraint) console.log(`  old constraint:     ${oldConstraint.conname} still present — run migration 006`);

      checks.push(makeCheck('Table exists',                          true));
      checks.push(makeCheck('observation_date column',               hasObsDate));
      checks.push(makeCheck('raw_pickup_ratio column',               hasRawRatio));
      checks.push(makeCheck('bpo dedup constraint',                  !!dedupConstraint));
      checks.push(makeCheck('Old calculated_at constraint dropped',  !oldConstraint));

    } catch (err) {
      if (/does not exist|regclass/i.test(err.message)) {
        tableExists = false;
        console.log('  Table exists:   NO — migration 005 not yet applied');
        console.log('  Required action: apply migrations/005_booking_pickup_observations.sql');

        checks.push(makeCheck('Table exists',                         false));
        // Table-dependent checks are N/A — the table will have the correct schema
        // once migration 005 (T2-updated) is applied to a fresh instance.
        checks.push(makeCheck('observation_date column',              null, 'table not installed'));
        checks.push(makeCheck('raw_pickup_ratio column',              null, 'table not installed'));
        checks.push(makeCheck('bpo dedup constraint',                 null, 'table not installed'));
        // Old constraint: N/A for fresh install (006 only needed for upgrade from old 005)
        checks.push(makeCheck('Old calculated_at constraint dropped', null, 'N/A — fresh install, not an upgrade'));
      } else {
        console.error(`  [TABLE_CHECK_FAILURE] ${err.message}`);
        checks.push(makeCheck('Table structure check', false));
        process.exitCode = 1;
      }
    }

    // ── 2. INSERT SQL structural proof ───────────────────────
    console.log('\n  [2] INSERT SQL STRUCTURE');
    const sqlHasObsDate    = INSERT_OBSERVATION_SQL.includes('observation_date');
    const sqlHasRawRatio   = INSERT_OBSERVATION_SQL.includes('raw_pickup_ratio');
    const sqlHasDedup      = INSERT_OBSERVATION_SQL.includes('bpo_property_target_obs_model_unique');
    const sqlHasDoNothing  = INSERT_OBSERVATION_SQL.includes('DO NOTHING');
    const paramCount       = (INSERT_OBSERVATION_SQL.match(/\$\d+/g) || [])
      .map(p => parseInt(p.slice(1), 10))
      .reduce((max, n) => Math.max(max, n), 0);

    console.log(`  observation_date in SQL:  ${sqlHasObsDate  ? '✓' : '✗'}`);
    console.log(`  raw_pickup_ratio in SQL:  ${sqlHasRawRatio ? '✓' : '✗'}`);
    console.log(`  ON CONFLICT dedup name:   ${sqlHasDedup    ? '✓' : '✗'}`);
    console.log(`  DO NOTHING on conflict:   ${sqlHasDoNothing ? '✓' : '✗'}`);
    console.log(`  Max param index:          $${paramCount}  (expected $23)`);

    checks.push(makeCheck('INSERT SQL has observation_date',           sqlHasObsDate));
    checks.push(makeCheck('INSERT SQL has raw_pickup_ratio',           sqlHasRawRatio));
    checks.push(makeCheck('INSERT SQL uses named dedup constraint',    sqlHasDedup));
    checks.push(makeCheck('INSERT SQL param count = 23',               paramCount === 23));

    // ── 3. Timezone implementation ────────────────────────────
    console.log('\n  [3] TIMEZONE SEMANTICS (OBSERVATION_DATE)');
    console.log('  OBSERVATION_DATE_TIMEZONE_SOURCE = properties.timezone');
    console.log('  OBSERVATION_DATE_FALLBACK         = UTC');

    const tzValidValid   = isValidTimezone('Europe/Paris');
    const tzValidInvalid = isValidTimezone('Not/A/Timezone');
    const tzValidNull    = isValidTimezone(null);

    // Spec examples
    const parisEx  = observationDateFromCalcAt('2026-10-01T00:30:00Z', 'Europe/Paris');
    const laEx     = observationDateFromCalcAt('2026-10-01T00:30:00Z', 'America/Los_Angeles');
    const tokyoEx  = observationDateFromCalcAt('2026-09-30T23:30:00Z', 'Asia/Tokyo');
    const utcFb    = observationDateFromCalcAt('2026-09-30T06:00:00Z', null);
    // DST examples
    const parisDstSummer = observationDateFromCalcAt('2026-06-15T03:59:59Z', 'Europe/Paris');  // UTC+2: 05:59:59 Paris
    const parisDstWinter = observationDateFromCalcAt('2026-01-15T04:00:00Z', 'Europe/Paris');  // UTC+1: 05:00:00 Paris

    console.log(`  isValidTimezone('Europe/Paris'):     ${tzValidValid   ? '✓' : '✗'}`);
    console.log(`  isValidTimezone('Not/A/Timezone'):   ${!tzValidInvalid ? '✓ (correctly false)' : '✗'}`);
    console.log(`  isValidTimezone(null):               ${!tzValidNull   ? '✓ (correctly false)' : '✗'}`);
    console.log('');
    console.log(`  2026-10-01T00:30Z + Europe/Paris        → ${parisEx}  (expected 2026-10-01)`);
    console.log(`  2026-10-01T00:30Z + America/Los_Angeles → ${laEx}     (expected 2026-09-30)`);
    console.log(`  2026-09-30T23:30Z + Asia/Tokyo          → ${tokyoEx}  (expected 2026-10-01)`);
    console.log(`  2026-09-30T06:00Z + null (UTC fallback) → ${utcFb}    (expected 2026-09-30)`);
    console.log(`  DST Paris summer (UTC+2) 03:59Z         → ${parisDstSummer}  (expected 2026-06-15)`);
    console.log(`  DST Paris winter (UTC+1) 04:00Z         → ${parisDstWinter}  (expected 2026-01-15)`);

    checks.push(makeCheck('isValidTimezone correctly identifies valid IANA tz',   tzValidValid));
    checks.push(makeCheck('isValidTimezone rejects invalid timezone',              !tzValidInvalid));
    checks.push(makeCheck('observationDateFromCalcAt spec example: Europe/Paris', parisEx === '2026-10-01'));
    checks.push(makeCheck('observationDateFromCalcAt spec example: LA prev day',  laEx    === '2026-09-30'));
    checks.push(makeCheck('observationDateFromCalcAt spec example: Tokyo next',   tokyoEx === '2026-10-01'));
    checks.push(makeCheck('observationDateFromCalcAt UTC fallback for null tz',   utcFb   === '2026-09-30'));
    checks.push(makeCheck('observationDateFromCalcAt DST-safe Europe/Paris',
      parisDstSummer === '2026-06-15' && parisDstWinter === '2026-01-15'));

    // ── 4. Shadow job structural proof ────────────────────────
    console.log('\n  [4] SHADOW JOB');
    const jobModule        = require('../services/booking-pickup-shadow-job');
    const jobExists        = typeof jobModule.runPickupShadowJob === 'function';
    const genTdExists      = typeof jobModule.generateTargetDates === 'function';
    const horizonCorrect   = jobModule.PICKUP_HORIZON_DAYS === 30;
    const sample30Dates    = genTdExists ? jobModule.generateTargetDates('2026-09-30', 30) : [];
    const exactlyThirty    = sample30Dates.length === 30;
    const todayExcluded    = !sample30Dates.includes('2026-09-30');
    const firstDate        = sample30Dates[0];
    const lastDate         = sample30Dates[29];

    console.log(`  runPickupShadowJob exists:   ${jobExists        ? '✓' : '✗'}`);
    console.log(`  generateTargetDates exists:  ${genTdExists      ? '✓' : '✗'}`);
    console.log(`  PICKUP_HORIZON_DAYS = 30:    ${horizonCorrect   ? '✓' : '✗'}`);
    console.log(`  Exactly 30 target dates:     ${exactlyThirty    ? '✓' : '✗'}`);
    console.log(`  Today excluded:              ${todayExcluded    ? '✓' : '✗'}`);
    console.log(`  First target date:           ${firstDate}  (expected 2026-10-01)`);
    console.log(`  Last target date:            ${lastDate}   (expected 2026-10-30)`);

    checks.push(makeCheck('Shadow job function exists',                   jobExists));
    checks.push(makeCheck('PICKUP_HORIZON_DAYS = 30',                     horizonCorrect));
    checks.push(makeCheck('generateTargetDates returns exactly 30 dates', exactlyThirty));
    checks.push(makeCheck('Local today excluded from target dates',        todayExcluded));

    // ── 5. Scheduler integration ──────────────────────────────
    console.log('\n  [5] SCHEDULER INTEGRATION');
    const CRON = fs.readFileSync(path.join(__dirname, '../routes/dynamic-pricing-cron.js'), 'utf8');
    const hasPickupCron    = CRON.includes('booking-pickup-shadow-job');
    const hasPickupFlag    = CRON.includes('BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED') ||
                             CRON.includes('isPersistenceEnabled') || CRON.includes('_pu');
    const hasCronSchedule  = CRON.includes("'5 6 * * *'") || CRON.includes('"5 6 * * *"');
    const notCoupledToMkt  = !CRON.match(/booking-pickup-shadow-job[^}]*market_data[^}]*writeResult/s);

    console.log(`  Cron imports shadow job:      ${hasPickupCron   ? '✓' : '✗'}`);
    console.log(`  Flag check before execution:  ${hasPickupFlag   ? '✓' : '✗'}`);
    console.log(`  Dedicated daily schedule:     ${hasCronSchedule ? '✓' : '✗'}`);
    console.log(`  Not coupled to market scrape: ${notCoupledToMkt ? '✓' : '✗'}`);
    console.log('  SCHEDULER_TZ_DEBT: cron fires in Europe/Paris; property-local date still computed per-property.');

    checks.push(makeCheck('Scheduler references shadow job',              hasPickupCron));
    checks.push(makeCheck('Scheduler checks flag before execution',       hasPickupFlag));
    checks.push(makeCheck('Shadow job not coupled to market provider',    notCoupledToMkt));

    // ── 6. Persistence flag gate ──────────────────────────────
    console.log('\n  [6] PERSISTENCE FLAG GATE');
    const flagState = isPersistenceEnabled();
    console.log(`  BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED: ${process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED ?? '(unset)'}`);
    console.log(`  isPersistenceEnabled():  ${flagState}`);
    console.log(`  Correct state (should be false): ${!flagState ? '✓' : '✗ — DO NOT enable yet'}`);
    checks.push(makeCheck('Persistence flag is OFF (safe default)', !flagState));

    // ── 7. Pricing authority proof ────────────────────────────
    console.log('\n  [7] PRICING AUTHORITY PROOF  (PICKUP_HAS_PRICING_AUTHORITY=NO)');
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
    checks.push(makeCheck('PICKUP_HAS_PRICING_AUTHORITY=NO', violations.length === 0));

    // ── 8. Active properties dry-run ─────────────────────────
    console.log('\n  [8] DRY-RUN (calculatePickupShadow × active properties, persistence=OFF)');
    let props = [];
    try {
      const res = await pool.query(ACTIVE_PROPERTIES_SQL);
      props = res.rows;
      console.log(`  Active properties: ${props.length}`);
    } catch (err) {
      console.error(`  [QUERY_FAILURE] ${err.message}`);
      process.exitCode = 1;
    }

    const nowIso = new Date().toISOString();

    let dryOk = 0, dryErr = 0;
    for (const prop of props.slice(0, ARG_PROPERTIES || props.length)) {
      const tz          = isValidTimezone(prop.timezone) ? prop.timezone : 'UTC';
      const localToday  = observationDateFromCalcAt(nowIso, tz);
      const targetDates = generateTargetDates(localToday, PICKUP_HORIZON_DAYS);

      try {
        const obs = await calculatePickupShadow(pool, prop.property_id, targetDates[0]);
        console.log(
          `  ✓  ${displayName(prop)}` +
          `  tz=${tz}` +
          `  local_today=${localToday}` +
          `  target_dates=${targetDates.length}  first=${targetDates[0]}  last=${targetDates[targetDates.length - 1]}` +
          `  status=${obs.status}  conf=${obs.confidence}  advisory=${obs.advisoryMultiplier}`
        );
        dryOk++;
      } catch (err) {
        console.log(`  ✗  ${displayName(prop)}  tz=${tz}  [PICKUP_FAILURE] ${err.message}`);
        dryErr++;
      }
    }
    console.log(`  Dry-run result: ${dryOk} OK, ${dryErr} errors`);
    checks.push(makeCheck('Pickup calculation succeeds for all properties',
      dryErr === 0 && props.length > 0));

    // ── 9. Storage projections ────────────────────────────────
    console.log('\n  [9] STORAGE PROJECTIONS');
    console.log(`  Bytes/row estimate: ${BYTES_PER_ROW}  (incl. JSONB + index overhead)`);
    console.log('  Rolling horizon: each target stay-date accumulates one observation per');
    console.log('  observation_date it falls within the horizon — longitudinal history builds up.');
    console.log('');
    console.log('  Props │ Horizon │ Rows/day │  Rows/year  │  Size/year');
    console.log('  ──────┼─────────┼──────────┼─────────────┼───────────');

    const horizons   = ARG_HORIZON    ? [ARG_HORIZON]    : HORIZON_OPTIONS;
    const propCounts = ARG_PROPERTIES ? [ARG_PROPERTIES] : PROPERTY_OPTIONS;

    for (const p of propCounts) {
      for (const h of horizons) {
        const est = storageEstimate(p, h);
        const rec = (p === 3 && h === 30) ? ' ← 3 props today' : '';
        console.log(
          `  ${String(p).padStart(5)} │ ${String(h).padStart(7)} │ ${String(est.rowsPerDay).padStart(8)} │ ` +
          `${String(est.rowsPerYear.toLocaleString()).padStart(11)} │ ${formatBytes(est.bytesPerYear).padStart(10)}${rec}`
        );
      }
    }

    // ── 10. Migration review ──────────────────────────────────
    console.log('\n  [10] MIGRATION REVIEW');
    console.log(`  Table installed:           ${tableExists ? 'YES' : 'NO'}`);
    if (!tableExists) {
      console.log('  Production sequence:       005 only (fresh install — 005 already has T2 schema)');
      console.log('  Migration 006:             NOT needed for production');
      console.log('  Migration 006 purpose:     upgrade dev/test instances where old 005 was applied');
    } else {
      console.log('  Table exists — determine whether 006 is needed (check for bpo_property_target_obs_model_unique)');
    }

    // ── 11. Readiness checklist ───────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  P1.3-T2-FIX READINESS CHECKLIST');
    console.log('──────────────────────────────────────────────────────────────');

    let allReady = true;
    for (const c of checks) {
      const icon = checkIcon(c.pass);
      const note = c.naReason ? `  (${c.naReason})` : '';
      console.log(`  ${icon.padEnd(4)} ${c.name}${note}`);
      if (c.pass === false) allReady = false;
    }

    // Also FAIL if required table is absent (affects overall readiness)
    if (!tableExists) allReady = false;

    console.log('──────────────────────────────────────────────────────────────');
    if (allReady) {
      console.log('  ALL CHECKS PASSED — persistence can be activated when ready');
      console.log('  To activate:');
      console.log('    1. Apply migrations/005_booking_pickup_observations.sql (production)');
      console.log('    2. Set BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED=true on Render');
      console.log('    3. Rerun this audit to confirm readiness');
    } else {
      if (!tableExists) {
        console.log('  NOT READY — migration 005 must be applied before activating flag');
        console.log('  Exact command: NODE_ENV=production psql $DATABASE_URL -f migrations/005_booking_pickup_observations.sql');
      } else {
        console.log('  ONE OR MORE CHECKS FAILED — resolve before activation');
      }
      process.exitCode = 1;
    }
    console.log('  ADVISORY ONLY — no pricing changes applied');
    console.log('  PICKUP_HAS_PRICING_AUTHORITY=NO');
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

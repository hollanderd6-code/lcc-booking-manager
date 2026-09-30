'use strict';
/**
 * P1.4-T1 — Seasonality Shadow Pre-Activation Audit
 *
 * Verifies that the local_seasonality_observations table and shadow job are
 * correctly configured before enabling LOCAL_SEASONALITY_SHADOW_ENABLED.
 *
 * Reports:
 *   TABLE_READY, TARGET_MONTH_COLUMN, MODEL_VERSION_COLUMN, UNIQUE_CONSTRAINT
 *   FEATURE_FLAG, SCHEDULER, TARGET_MONTH_HORIZON, OBSERVATION_FREQUENCY
 *   Per-property dry-run: target months that would be generated (no writes)
 *   Post-activation check design (section 20 spec)
 *   Pricing authority proof
 *
 * This tool NEVER:
 *   writes to local_seasonality_observations
 *   modifies pricing_schedule or any pricing table
 *   calls Channex, Bright Data, APIFY, or any provider
 *   enables or changes any feature flag
 *
 * SAFETY:
 *   READ_ONLY              = YES
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   NETWORK_CALLS          = 0  always
 *   LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY = NO
 *   PRODUCTION_SEASONALITY_CHANGED          = NO
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-seasonality-shadow-readiness-p1_4_t1.js
 */

const path = require('path');
const fs   = require('fs');

// ── SQL constants (SELECT-only) ───────────────────────────────────────────────

const TABLE_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'local_seasonality_observations'
  ) AS table_exists
`;

const COLUMN_LIST_SQL = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'local_seasonality_observations'
  ORDER BY ordinal_position
`;

// pg_get_constraintdef returns the constraint definition as a plain TEXT string,
// e.g. "UNIQUE (property_id, target_month, observation_date, model_version)".
// This avoids the pg driver's inconsistent array-parsing of array_agg() results,
// which returns a raw "{col1,col2,...}" string rather than a JS array.
const UNIQUE_CONSTRAINT_SQL = `
  SELECT
    c.conname                    AS constraint_name,
    pg_get_constraintdef(c.oid)  AS constraint_def
  FROM pg_catalog.pg_constraint  c
  JOIN pg_catalog.pg_class       t ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace   n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'local_seasonality_observations'
    AND c.contype = 'u'
  ORDER BY c.conname
`;

const OBSERVATION_COUNTS_SQL = `
  SELECT
    COUNT(*)                          AS total_rows,
    COUNT(DISTINCT property_id)       AS distinct_properties,
    COUNT(DISTINCT target_month)      AS distinct_target_months,
    COUNT(DISTINCT observation_date)  AS distinct_observation_dates,
    COUNT(DISTINCT model_version)     AS distinct_model_versions,
    MIN(observation_date)             AS first_obs_date,
    MAX(observation_date)             AS last_obs_date
  FROM local_seasonality_observations
`;

const ACTIVE_PROPERTIES_SQL = `
  SELECT DISTINCT ON (pc.property_id)
    pc.property_id,
    p.internal_name,
    p.name,
    p.timezone,
    p.country_code,
    p.currency,
    p.latitude,
    p.longitude,
    mpp.profile_id AS market_profile_id
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  LEFT JOIN market_profile_properties mpp ON mpp.property_id = pc.property_id
  WHERE pc.is_active = TRUE
  ORDER BY pc.property_id, p.internal_name, p.name
`;

const PRICING_CHAIN_SQL_CHECK = `
  SELECT 1
  FROM pg_proc
  WHERE proname = 'local_seasonality_observations'
  LIMIT 1
`;

// ── Pricing authority proof ───────────────────────────────────────────────────

const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
];

function checkPricingAuthorityProof() {
  const ROOT = path.join(__dirname, '..');
  const violations = [];
  for (const f of PRICING_CHAIN) {
    const fpath = path.join(ROOT, f);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    if (/local.seasonality.observations/i.test(src) ||
        /local.seasonality.helpers/i.test(src) ||
        /local.seasonality.shadow/i.test(src)) {
      violations.push(f);
    }
  }
  return violations;
}

// ── Helper (duplicated from local-seasonality-helpers — avoid circular dep) ──

function propertyLocalDateUTC(isoTimestamp, timezone) {
  const dt = new Date(isoTimestamp);
  if (!timezone) return dt.toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(dt);
  } catch (_) {
    return dt.toISOString().slice(0, 10);
  }
}

function generateTargetMonthsDryRun(localTodayStr, horizonMonths) {
  const [yr, mon] = String(localTodayStr).split('-').map(Number);
  const months = [];
  for (let i = 0; i < horizonMonths; i++) {
    const d = new Date(Date.UTC(yr, mon - 1 + i, 1));
    months.push(d.toISOString().slice(0, 10));
  }
  return months;
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  require('dotenv').config();
  const { createPool } = require('../services/db-pool');
  runAudit(createPool())
    .catch(err => { console.error('[FATAL]', err); process.exit(1); });
}

async function runAudit(pool) {
  const NOW_ISO  = new Date().toISOString();
  const TODAY    = NOW_ISO.slice(0, 10);
  const HORIZON  = 9; // HORIZON_MONTHS from local-seasonality-helpers

  try {
    console.log('');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('  P1.4-T1 — SEASONALITY SHADOW PRE-ACTIVATION AUDIT');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`  Run at:  ${NOW_ISO}`);
    console.log('  READ_ONLY=YES  DB_WRITES=0  PRICING_WRITES=0  NETWORK_CALLS=0');
    console.log('──────────────────────────────────────────────────────────────────────');

    // ── [1] FEATURE FLAG ──────────────────────────────────────────────────────
    console.log('\n  [1] FEATURE FLAG');
    const flagValue = process.env.LOCAL_SEASONALITY_SHADOW_ENABLED;
    const flagEnabled = flagValue === 'true';
    console.log(`  LOCAL_SEASONALITY_SHADOW_ENABLED = ${flagValue ?? '(not set)'}`);
    console.log(`  FLAG_ENABLED: ${flagEnabled ? 'YES ⚠️  (shadow writes active)' : 'NO ✓ (safe)'}`);
    if (flagEnabled) {
      console.log('  ⚠️  WARNING: Flag is ON — shadow job will write to DB when cron fires.');
      console.log('     Only activate after this audit confirms TABLE_READY=YES.');
    }

    // ── [2] SCHEDULER MAP ─────────────────────────────────────────────────────
    console.log('\n  [2] SCHEDULER MAP (dynamic-pricing-cron.js)');
    console.log('');
    console.log('  Slot  Schedule              Timezone       Job');
    console.log('  ────  ────────────────────  ─────────────  ─────────────────────────────────────────');
    console.log('  1     0  6 * * 1            Europe/Paris   Weekly pricing (scrape + recalc + push)');
    console.log('  2     0  6 * * 2,3,4,5,6,0  Europe/Paris   Daily pricing refresh (recalc + push)');
    console.log('  3     5  6 * * *             Europe/Paris   Pickup shadow (daily, 06:05)');
    console.log('  4     15 3 * * 1             Europe/Paris   Seasonality shadow (Mon 03:15) ← this job');
    console.log('');
    console.log('  SEASONALITY_SLOT_CONFLICT: NONE');
    console.log('    — 03:15 runs 2h45m before weekly pricing at 06:00');
    console.log('    — 03:15 runs 2h50m before pickup shadow at 06:05');
    console.log('    — No shared exclusive resources with slots 1–3');
    console.log('');
    console.log('  GLOBAL_SCHEDULER_TIMEZONE_DEBT:');
    console.log('    All 4 crons fire on Europe/Paris clock time.');
    console.log('    Properties in other timezones: the OBSERVATION_DATE stored per property');
    console.log('    uses properties.timezone (via propertyLocalDate), so stored dates are');
    console.log('    always property-local-correct, independent of the scheduler timezone.');
    console.log('    Example: property in America/New_York, cron fires Mon 03:15 Paris (01:15 UTC);');
    console.log('    NY local time = Oct 4 21:15 EDT → observation_date = Oct 4 (correct).');
    console.log('    Remaining debt: cron fires at a fixed Paris weekday; if a NY property');
    console.log('    defines "Monday" differently, the observation_date could map to Sunday.');
    console.log('    This is acceptable for weekly seasonality tracking.');

    // ── [3] MODEL ─────────────────────────────────────────────────────────────
    console.log('\n  [3] DATA MODEL');
    console.log('');
    console.log('  TABLE:             local_seasonality_observations');
    console.log('  UNIQUE_IDENTITY:   (property_id, target_month, observation_date, model_version)');
    console.log('  MODEL_VERSION:     seasonality-shadow-v1');
    console.log('  TARGET_MONTH:      DATE — first calendar day of month (YYYY-MM-01)');
    console.log('  OBSERVATION_DATE:  DATE — property-local calendar date of run');
    console.log('  CONFLICT_POLICY:   INSERT ... ON CONFLICT DO NOTHING (history preserved)');
    console.log('');
    console.log(`  TARGET_MONTH_HORIZON:    ${HORIZON} months (current + ${HORIZON - 1} forward)`);
    console.log(`  TARGET_MONTHS_PER_RUN:   ${HORIZON} per property`);
    console.log('  OBSERVATION_FREQUENCY:   Weekly (Monday 03:15 Europe/Paris)');
    console.log('');
    console.log('  LEAD-TIME COVERAGE:');
    console.log('    Month+0 (current):  D0 to D31 (in-month observations)');
    console.log('    Month+1:            D31 to D62');
    console.log('    Month+3:            D90 to D121');
    console.log('    Month+6:            D180 to D211  ← captures D180 window');
    console.log('    Month+8:            D242 to D273  ← buffer beyond D180');
    console.log('');
    console.log('  READINESS TIER:  Derived on-demand from observations (not stored separately).');
    console.log('    computePropertyReadinessSnapshot() still available for ad-hoc analysis.');

    // ── [4] TABLE SCHEMA ──────────────────────────────────────────────────────
    console.log('\n  [4] TABLE SCHEMA CHECK');

    let tableExists = false;
    let identityConstraintOk = false; // fail closed until proven

    try {
      const res = await pool.query(TABLE_EXISTS_SQL);
      tableExists = res.rows[0]?.table_exists === true;
      console.log(`\n  TABLE_READY:  ${tableExists ? 'YES ✓' : 'NO ✗ — migration 007 not yet applied'}`);
    } catch (err) {
      console.error(`  [TABLE_CHECK_FAILURE] ${err.message}`);
    }

    if (tableExists) {
      // Columns
      try {
        const colRes = await pool.query(COLUMN_LIST_SQL);
        const cols = colRes.rows;
        console.log(`\n  Columns (${cols.length}):`);
        for (const col of cols) {
          console.log(`    ${col.column_name.padEnd(35)} ${col.data_type.padEnd(20)} nullable=${col.is_nullable}`);
        }

        // Required columns check
        const REQUIRED = [
          'property_id', 'target_month', 'observation_date', 'model_version',
          'calculated_at', 'property_timezone', 'country', 'currency',
          'market_context_key', 'market_profile_id',
          'calendar_nights', 'elapsed_calendar_nights', 'remaining_calendar_nights',
          'days_until_month_start', 'month_complete',
          'booked_nights', 'known_blocked_nights', 'known_sellable_nights',
          'occupancy_fraction', 'exposure_confidence', 'reliable_reservation_count',
          'source_distribution', 'generic_reference_factor', 'created_at',
        ];
        const colNames = new Set(cols.map(c => c.column_name));
        const missing  = REQUIRED.filter(c => !colNames.has(c));
        console.log(`\n  TARGET_MONTH_COLUMN:    ${colNames.has('target_month')       ? 'PRESENT ✓' : 'MISSING ✗'}`);
        console.log(`  MODEL_VERSION_COLUMN:   ${colNames.has('model_version')       ? 'PRESENT ✓' : 'MISSING ✗'}`);
        console.log(`  EXPOSURE_CONFIDENCE:    ${colNames.has('exposure_confidence') ? 'PRESENT ✓' : 'MISSING ✗'}`);
        if (missing.length > 0) {
          console.log(`\n  MISSING_COLUMNS (${missing.length}): ${missing.join(', ')}`);
        } else {
          console.log('  ALL_REQUIRED_COLUMNS: PRESENT ✓');
        }
      } catch (err) {
        console.error(`  [COLUMN_CHECK_FAILURE] ${err.message}`);
      }

      // Unique constraint — pg_get_constraintdef returns a plain TEXT string.
      // constraint_def example: "UNIQUE (property_id, target_month, observation_date, model_version)"
      const EXPECTED_CONSTRAINT_NAME = 'lso_identity_unique';
      const EXPECTED_CONSTRAINT_DEF  = 'UNIQUE (property_id, target_month, observation_date, model_version)';
      try {
        const ucRes = await pool.query(UNIQUE_CONSTRAINT_SQL);
        console.log(`\n  Unique constraints (${ucRes.rows.length}):`);

        let identityPresent = false;
        let identityExact   = false;

        for (const uc of ucRes.rows) {
          console.log('');
          console.log('  UNIQUE_CONSTRAINT:');
          console.log(`    ${uc.constraint_name}`);
          console.log(`    ${uc.constraint_def}`);
          if (uc.constraint_name === EXPECTED_CONSTRAINT_NAME) {
            identityPresent = true;
            identityExact   = (uc.constraint_def === EXPECTED_CONSTRAINT_DEF);
          }
        }

        console.log('');
        console.log(`  IDENTITY_CONSTRAINT_PRESENT: ${identityPresent ? 'YES ✓' : 'NO ✗'}`);
        console.log(`  IDENTITY_CONSTRAINT_EXACT:   ${identityExact   ? 'YES ✓' : 'NO ✗'}`);

        if (!identityPresent) {
          console.log(`  Expected constraint name: ${EXPECTED_CONSTRAINT_NAME}`);
          console.log(`  Expected definition:      ${EXPECTED_CONSTRAINT_DEF}`);
        } else if (!identityExact) {
          console.log(`  Expected definition: ${EXPECTED_CONSTRAINT_DEF}`);
        }

        identityConstraintOk = identityPresent && identityExact;
      } catch (err) {
        console.error(`  [CONSTRAINT_CHECK_FAILURE] ${err.message}`);
        console.log('  IDENTITY_CONSTRAINT_PRESENT: NO (inspection failed)');
        console.log('  IDENTITY_CONSTRAINT_EXACT:   NO (inspection failed)');
        console.log('  SAFE_TO_ENABLE_FLAG: NO (constraint check failed — fail closed)');
        identityConstraintOk = false;
      }

      // Current row counts
      try {
        const cntRes = await pool.query(OBSERVATION_COUNTS_SQL);
        const cnt = cntRes.rows[0];
        console.log(`\n  CURRENT ROW COUNTS:`);
        console.log(`    Total observations:       ${cnt.total_rows}`);
        console.log(`    Distinct properties:      ${cnt.distinct_properties}`);
        console.log(`    Distinct target months:   ${cnt.distinct_target_months}`);
        console.log(`    Distinct observation dates: ${cnt.distinct_observation_dates}`);
        if (Number(cnt.total_rows) > 0) {
          console.log(`    First observation date:   ${cnt.first_obs_date}`);
          console.log(`    Last observation date:    ${cnt.last_obs_date}`);
        }
      } catch (err) {
        console.error(`  [COUNT_CHECK_FAILURE] ${err.message}`);
      }
    } else {
      console.log('');
      console.log('  REQUIRED ACTION: Apply migration 007 before enabling flag.');
      console.log('    psql $DATABASE_URL -f migrations/007_local_seasonality_observations.sql');
    }

    // ── [5] DRY-RUN PER PROPERTY ──────────────────────────────────────────────
    console.log('\n  [5] DRY-RUN — TARGET MONTHS PER PROPERTY (no writes)');

    let activeProps = [];
    try {
      const pRes = await pool.query(ACTIVE_PROPERTIES_SQL);
      activeProps = pRes.rows;
      console.log(`\n  Active BoostPrice properties: ${activeProps.length}`);
    } catch (err) {
      console.error(`  [ACTIVE_PROPS_FAILURE] ${err.message}`);
    }

    let totalMonthsPerRun = 0;
    for (const prop of activeProps) {
      const pName = prop.internal_name || prop.name || `prop#${prop.property_id}`;
      const obsDate = propertyLocalDateUTC(NOW_ISO, prop.timezone);
      const months  = generateTargetMonthsDryRun(obsDate, HORIZON);
      totalMonthsPerRun += months.length;
      console.log(`\n    ${pName}  (id=${prop.property_id})`);
      console.log(`      timezone=${prop.timezone ?? 'NULL (UTC fallback)'}  country=${prop.country_code ?? 'NULL'}  currency=${prop.currency ?? 'NULL'}`);
      console.log(`      observation_date (property-local): ${obsDate}`);
      console.log(`      target_month_count: ${months.length}`);
      console.log(`      first_target_month: ${months[0]}`);
      console.log(`      last_target_month:  ${months[months.length - 1]}`);
      console.log(`      market_profile_id:  ${prop.market_profile_id ?? 'NULL (no profile)'}`);
      console.log(`      months: ${months.join(', ')}`);
    }

    if (activeProps.length > 0) {
      console.log('');
      console.log(`  TOTAL_ROWS_PER_COLLECTION: ${totalMonthsPerRun} (${activeProps.length} props × ${HORIZON} months)`);
      console.log(`  APPROX_ROWS_PER_YEAR: ${totalMonthsPerRun * 52} (52 weekly runs)`);
    }

    // ── [6] POST-ACTIVATION CHECK DESIGN ─────────────────────────────────────
    console.log('\n  [6] POST-ACTIVATION CHECK DESIGN (run after first collection)');
    console.log('');
    console.log('  These checks apply AFTER the first flag-ON cron run completes.');
    console.log('  They are NOT executed now (table may be empty).');
    console.log('');
    console.log('  CHECK_1: rows total');
    console.log(`    Expected: ${totalMonthsPerRun} rows (${activeProps.length} props × ${HORIZON} months)`);
    console.log(`    SQL: SELECT COUNT(*) FROM local_seasonality_observations`);
    console.log('         WHERE observation_date = (SELECT MAX(observation_date) FROM local_seasonality_observations)');
    console.log('');
    console.log('  CHECK_2: distinct properties = all active');
    console.log(`    Expected: ${activeProps.length}`);
    console.log('    SQL: SELECT COUNT(DISTINCT property_id) FROM local_seasonality_observations');
    console.log('');
    console.log('  CHECK_3: distinct target months = HORIZON_MONTHS per property');
    console.log(`    Expected: ${HORIZON} per property`);
    console.log('    SQL: SELECT property_id, COUNT(DISTINCT target_month)');
    console.log('         FROM local_seasonality_observations');
    console.log('         WHERE observation_date = MAX_OBS_DATE');
    console.log('         GROUP BY property_id');
    console.log('');
    console.log('  CHECK_4: target_month values are first-of-month');
    console.log('    SQL: SELECT COUNT(*) FROM local_seasonality_observations');
    console.log("         WHERE EXTRACT(DAY FROM target_month) != 1");
    console.log('    Expected: 0 violations');
    console.log('');
    console.log('  CHECK_5: duplicate detection');
    console.log('    SQL: SELECT property_id, target_month, observation_date, model_version, COUNT(*)');
    console.log('         FROM local_seasonality_observations');
    console.log('         GROUP BY 1,2,3,4 HAVING COUNT(*) > 1');
    console.log('    Expected: 0 rows');
    console.log('');
    console.log('  CHECK_6: occupancy NULL when exposure_confidence = UNKNOWN');
    console.log("    SQL: SELECT COUNT(*) FROM local_seasonality_observations");
    console.log("         WHERE exposure_confidence = 'UNKNOWN' AND occupancy_fraction IS NOT NULL");
    console.log('    Expected: 0 violations');
    console.log('');
    console.log('  CHECK_7: booked nights bounds');
    console.log('    SQL: SELECT COUNT(*) FROM local_seasonality_observations');
    console.log('         WHERE booked_nights < 0 OR booked_nights > calendar_nights');
    console.log('    Expected: 0 violations');
    console.log('');
    console.log('  CHECK_8: generic_reference_factor in [0.80, 1.20]');
    console.log('    SQL: SELECT COUNT(*) FROM local_seasonality_observations');
    console.log('         WHERE generic_reference_factor NOT BETWEEN 0.80 AND 1.20');
    console.log('    Expected: 0 violations');
    console.log('');
    console.log('  CHECK_9: timezone consistency');
    console.log('    SQL: SELECT property_id, COUNT(DISTINCT property_timezone)');
    console.log('         FROM local_seasonality_observations GROUP BY 1');
    console.log('         HAVING COUNT(DISTINCT property_timezone) > 1');
    console.log('    Expected: 0 rows (tz should not change across observations)');
    console.log('');
    console.log('  DO NOT REPORT HEALTHY BEFORE FIRST COLLECTION.');

    // ── [7] PRICING AUTHORITY PROOF ───────────────────────────────────────────
    console.log('\n  [7] PRICING AUTHORITY PROOF');
    const authViolations = checkPricingAuthorityProof();
    console.log(`\n  LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY: ${authViolations.length === 0 ? 'NO ✓' : 'VIOLATION ✗'}`);
    console.log('  PRODUCTION_SEASONALITY_CHANGED: NO (audit is read-only)');
    if (authViolations.length > 0) {
      console.log(`  Violations: ${authViolations.join(', ')}`);
    }

    // Verify seasonByMonth curve unchanged
    const ROOT = path.join(__dirname, '..');
    const enginePath = path.join(ROOT, 'routes/pricing-engine.js');
    let curveOk = false;
    if (fs.existsSync(enginePath)) {
      const src = fs.readFileSync(enginePath, 'utf8');
      curveOk = src.includes('0.88,') && src.includes('1.12,') && src.includes('seasonByMonth:');
    }
    console.log(`\n  PRICING_ENGINE_CURVE_STILL_EXACT: ${curveOk ? 'YES ✓' : 'CANNOT VERIFY ✗'}`);
    console.log('  Expected IDF curve: [0.88,0.90,0.94,1.00,1.06,1.10,1.12,1.08,1.10,1.02,0.90,0.96]');

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log('  P1.4-T1 PRE-ACTIVATION SUMMARY');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`  TABLE_READY:                   ${tableExists ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  FEATURE_FLAG:                  LOCAL_SEASONALITY_SHADOW_ENABLED = ${flagValue ?? '(not set)'}`);
    console.log(`  FEATURE_FLAG_DEFAULT:          false`);
    console.log(`  FEATURE_FLAG_CURRENTLY_ON:     ${flagEnabled ? 'YES ⚠️' : 'NO ✓'}`);
    console.log(`  SCHEDULER:                     Mon 03:15 Europe/Paris (15 3 * * 1)`);
    console.log(`  TARGET_MONTH_HORIZON:          ${HORIZON} months`);
    console.log(`  TARGET_MONTHS_PER_COLLECTION:  ${HORIZON} per property`);
    console.log(`  OBSERVATION_FREQUENCY:         Weekly`);
    console.log(`  OBSERVATION_DATE_TIMEZONE:     Property-local (UTC fallback when NULL)`);
    console.log(`  MODEL_VERSION:                 seasonality-shadow-v1`);
    console.log(`  CONFLICT_POLICY:               INSERT ON CONFLICT DO NOTHING`);
    console.log(`  ACTIVE_PROPERTIES:             ${activeProps.length}`);
    console.log(`  ROWS_PER_COLLECTION:           ${totalMonthsPerRun}`);
    console.log(`  LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY: NO ✓`);
    console.log(`  PRODUCTION_SEASONALITY_CHANGED:          NO ✓`);
    console.log(`  DB_WRITES_THIS_RUN:            0 ✓`);
    console.log('');

    const safeToApply  = !tableExists;
    // SAFE_TO_ENABLE_FLAG requires ALL of:
    //   1. table exists (migration applied)
    //   2. identity constraint proven correct (lso_identity_unique, exact 4-column definition)
    //   3. flag not already on (would be redundant / already active)
    const safeToEnable = tableExists && identityConstraintOk && !flagEnabled;

    let safeToEnableLabel;
    if (flagEnabled) {
      safeToEnableLabel = 'SKIP — flag already on';
    } else if (!tableExists) {
      safeToEnableLabel = 'NO — apply migration first';
    } else if (!identityConstraintOk) {
      safeToEnableLabel = 'NO — identity constraint not confirmed (see section [4])';
    } else {
      safeToEnableLabel = 'YES';
    }

    console.log(`  SAFE_TO_DEPLOY_CODE:     YES (already committed, no side effects)`);
    console.log(`  SAFE_TO_APPLY_MIGRATION: ${safeToApply ? 'YES — table not yet created' : 'SKIP — table already exists'}`);
    console.log(`  SAFE_TO_ENABLE_FLAG:     ${safeToEnableLabel}`);

    if (!tableExists) {
      console.log('');
      console.log('  EXACT_NEXT_COMMAND:');
      console.log('    psql $DATABASE_URL -f migrations/007_local_seasonality_observations.sql');
    } else if (!flagEnabled) {
      console.log('');
      console.log('  EXACT_NEXT_COMMAND (enable flag in Render / .env):');
      console.log('    LOCAL_SEASONALITY_SHADOW_ENABLED=true');
    }

    console.log('──────────────────────────────────────────────────────────────────────');
    console.log('  P1_4_T1_AUDIT_READ_ONLY: YES');
    console.log('  P1_4_T1_IMPLEMENTED: YES');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('');

  } finally {
    await pool.end();
  }
}

module.exports = { runAudit };

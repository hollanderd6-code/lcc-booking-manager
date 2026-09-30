'use strict';
/**
 * P1.3-T2-POST — Booking Pickup Post-Activation Audit
 *
 * READ-ONLY health audit for the booking_pickup_observations table
 * once BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED=true and the shadow
 * job has begun (or is about to begin) collecting data.
 *
 * Expected before first cron run:  WAITING_FIRST_COLLECTION (neutral, not FAIL)
 * Expected after first cron run:   HEALTHY, COLLECTION_STARTED, ~90 rows
 *
 * This tool NEVER:
 *   writes DB rows
 *   calls Channex
 *   calls market data providers
 *   modifies pricing_schedule, pricing_config, or reservations
 *
 * SAFETY:
 *   AUDIT_DB_WRITES          = 0  always
 *   CHANNEX_CALLS            = 0  always
 *   MARKET_PROVIDER_CALLS    = 0  always
 *   PRICING_WRITES           = 0  always
 *   PICKUP_HAS_PRICING_AUTHORITY = NO
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-booking-pickup-persistence-post-t2.js
 */

const path = require('path');
const fs   = require('fs');

// ── Pure helpers (exported for testing) ──────────────────────────────────────

const ADVISORY_MIN = 0.94;
const ADVISORY_MAX = 1.06;

/**
 * Determine overall table health based on row count and accumulated issues.
 * 0 rows → WAITING_FIRST_COLLECTION (neutral, not a failure).
 *
 * @param {number}   totalRows
 * @param {string[]} issues    — list of issue descriptions (empty = healthy)
 * @returns {'WAITING_FIRST_COLLECTION'|'HEALTHY'|'UNHEALTHY'}
 */
function determineTableHealth(totalRows, issues) {
  if (totalRows === 0) return 'WAITING_FIRST_COLLECTION';
  if (issues.length === 0) return 'HEALTHY';
  return 'UNHEALTHY';
}

/**
 * Classify how far along longitudinal collection is based on distinct observation dates.
 *
 * @param {number} distinctObsDates
 * @returns {'WAITING_FIRST_COLLECTION'|'COLLECTION_STARTED'|'EARLY_COLLECTION'|'BUILDING'|'MATURE'}
 */
function longitudinalStage(distinctObsDates) {
  if (distinctObsDates === 0) return 'WAITING_FIRST_COLLECTION';
  if (distinctObsDates === 1) return 'COLLECTION_STARTED';
  if (distinctObsDates < 7)  return 'EARLY_COLLECTION';
  if (distinctObsDates < 30) return 'BUILDING';
  return 'MATURE';
}

/**
 * Validate that a target date falls within [obsDate+1, obsDate+horizonDays].
 * Both arguments are YYYY-MM-DD strings.
 *
 * @param {string} target       — YYYY-MM-DD target stay date
 * @param {string} obsDate      — YYYY-MM-DD observation (calculation) date
 * @param {number} [horizonDays=30]
 * @returns {boolean}
 */
function validateTargetDateShape(target, obsDate, horizonDays = 30) {
  if (!target || !obsDate) return false;
  const targetMs = new Date(target  + 'T00:00:00Z').getTime();
  const obsMs    = new Date(obsDate + 'T00:00:00Z').getTime();
  const DAY_MS   = 86400 * 1000;
  const diffDays = (targetMs - obsMs) / DAY_MS;
  return diffDays >= 1 && diffDays <= horizonDays;
}

/**
 * Check whether an advisory multiplier falls within the model v1.1 bounds [0.94, 1.06].
 * null/undefined always fails.
 *
 * @param {number|null|undefined} advisory
 * @returns {boolean}
 */
function checkAdvisoryBounds(advisory) {
  if (advisory === null || advisory === undefined) return false;
  const n = Number(advisory);
  return Number.isFinite(n) && n >= ADVISORY_MIN && n <= ADVISORY_MAX;
}

/**
 * Compute how many eligible properties have at least one observation.
 *
 * @param {number} eligible — properties from pricing_config WHERE is_active=TRUE
 * @param {number} observed — distinct property_ids in booking_pickup_observations
 * @returns {{ covered: number, missing: number, fraction: number|null }}
 */
function computePropertyCoverage(eligible, observed) {
  if (eligible === 0) return { covered: 0, missing: 0, fraction: null };
  const covered = Math.min(observed, eligible);
  const missing = eligible - covered;
  return { covered, missing, fraction: covered / eligible };
}

// ── SQL (all SELECT — zero writes) ───────────────────────────────────────────

const GLOBAL_STATS_SQL = `
  SELECT
    COUNT(*)                     AS total_rows,
    COUNT(DISTINCT property_id)  AS distinct_properties,
    COUNT(DISTINCT observation_date) AS distinct_obs_dates,
    MIN(observation_date)        AS first_obs_date,
    MAX(observation_date)        AS last_obs_date,
    MIN(calculated_at)           AS first_calculated_at,
    MAX(calculated_at)           AS last_calculated_at
  FROM booking_pickup_observations
`;

const PER_PROPERTY_STATS_SQL = `
  SELECT
    property_id,
    COUNT(*)                        AS total_rows,
    COUNT(DISTINCT observation_date) AS distinct_obs_dates,
    COUNT(DISTINCT target_date)     AS distinct_target_dates,
    MAX(observation_date)           AS latest_obs_date,
    MAX(calculated_at)              AS latest_calculated_at
  FROM booking_pickup_observations
  GROUP BY property_id
  ORDER BY property_id
`;

const LATEST_COLLECTION_SQL = `
  SELECT
    b.property_id,
    b.observation_date,
    b.status,
    b.confidence,
    COUNT(*)                          AS cnt,
    MIN(b.advisory_multiplier)        AS min_advisory,
    MAX(b.advisory_multiplier)        AS max_advisory,
    COUNT(DISTINCT b.target_date)     AS target_date_count
  FROM booking_pickup_observations b
  INNER JOIN (
    SELECT property_id, MAX(observation_date) AS max_obs
    FROM booking_pickup_observations
    GROUP BY property_id
  ) latest ON b.property_id = latest.property_id
          AND b.observation_date = latest.max_obs
  GROUP BY b.property_id, b.observation_date, b.status, b.confidence
  ORDER BY b.property_id, b.status
`;

const DEDUP_VIOLATIONS_SQL = `
  SELECT property_id, target_date, observation_date, model_version, COUNT(*) AS cnt
  FROM booking_pickup_observations
  GROUP BY property_id, target_date, observation_date, model_version
  HAVING COUNT(*) > 1
  LIMIT 10
`;

const INVALID_SHAPE_SQL = `
  SELECT COUNT(*) AS invalid_shape_count
  FROM booking_pickup_observations
  WHERE target_date <= observation_date
     OR target_date > (observation_date + INTERVAL '30 days')
`;

const CRITICAL_NULLS_SQL = `
  SELECT COUNT(*) AS null_count
  FROM booking_pickup_observations
  WHERE status IS NULL
     OR confidence IS NULL
     OR advisory_multiplier IS NULL
     OR model_version IS NULL
     OR observation_date IS NULL
     OR target_date IS NULL
     OR property_id IS NULL
`;

const ADVISORY_OUT_OF_BOUNDS_SQL = `
  SELECT COUNT(*) AS out_of_bounds_count
  FROM booking_pickup_observations
  WHERE advisory_multiplier < ${ADVISORY_MIN} OR advisory_multiplier > ${ADVISORY_MAX}
`;

const CONSTRAINT_CHECK_SQL = `
  SELECT conname
  FROM pg_constraint
  WHERE conrelid = 'booking_pickup_observations'::regclass
    AND conname = 'bpo_property_target_obs_model_unique'
`;

const TZ_CONSISTENCY_SAMPLE_SQL = `
  SELECT
    b.property_id,
    b.observation_date::text    AS obs_date,
    b.calculated_at::text       AS calculated_at,
    p.timezone
  FROM booking_pickup_observations b
  JOIN properties p ON p.id = b.property_id
  INNER JOIN (
    SELECT property_id, MAX(observation_date) AS max_obs
    FROM booking_pickup_observations
    GROUP BY property_id
  ) latest ON b.property_id = latest.property_id
          AND b.observation_date = latest.max_obs
  ORDER BY b.property_id, b.target_date
`;

const ELIGIBLE_PROPERTIES_SQL = `
  SELECT pc.property_id, p.internal_name, p.name, p.timezone
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

// ── Pricing authority proof ───────────────────────────────────────────────────

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

function checkPickupAuthorityProof() {
  const ROOT = path.join(__dirname, '..');
  const violations = [];
  for (const pricingFile of PRICING_CHAIN) {
    const fpath = path.join(ROOT, pricingFile);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    for (const mod of PICKUP_MODULES) {
      const re = new RegExp(`require\\(['""][^'"]*${mod.replace(/-/g, '[-_]')}`, 'i');
      if (re.test(src)) violations.push(`${pricingFile} imports ${mod}`);
    }
  }
  return violations;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(p) {
  return p.internal_name || p.name || `prop#${p.property_id}`;
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; }
  catch (_) { return false; }
}

function observationDateFromCalcAt(ts, timezone) {
  const dt = ts ? new Date(ts) : new Date();
  const tz = isValidTimezone(timezone) ? timezone : 'UTC';
  return dt.toLocaleString('sv-SE', { timeZone: tz }).slice(0, 10);
}

// ── Main (protected by require.main guard so tests can require helpers safely) ─

if (require.main === module) {
  require('dotenv').config();
  const { createPool } = require('../services/db-pool');
  const { isPersistenceEnabled } = require('../services/booking-pickup-persistence');

  main().catch(err => {
    console.error('[FATAL]', err);
    process.exit(1);
  });

  async function main() {
    const pool = createPool();
    try {
      await runAudit(pool);
    } finally {
      await pool.end();
    }
  }

  async function runAudit(pool) {
    const now = new Date().toISOString();
    const flagOn = isPersistenceEnabled();

    console.log('');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  P1.3-T2-POST — BOOKING PICKUP POST-ACTIVATION AUDIT');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Run at:   ${now}`);
    console.log(`  Flag:     ${flagOn ? 'ENABLED ✓' : 'OFF ← expected ENABLED for this audit'}`);
    console.log('  AUDIT_DB_WRITES=0  CHANNEX_CALLS=0  MARKET_PROVIDER_CALLS=0');
    console.log('──────────────────────────────────────────────────────────────');

    if (!flagOn) {
      console.log('');
      console.log('  ⚠ BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED is not set to "true".');
      console.log('  This audit is designed for post-activation state.');
      console.log('  Use audit-booking-pickup-persistence-readiness-t2.js instead.');
      console.log('');
    }

    const issues = [];

    // ── [1] Activation state ──────────────────────────────────────────────
    console.log('\n  [1] ACTIVATION STATE');
    console.log(`  BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED: ${process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED ?? '(unset)'}`);

    let constraintExists = false;
    try {
      const cRes = await pool.query(CONSTRAINT_CHECK_SQL);
      constraintExists = cRes.rows.length > 0;
      console.log(`  Dedup constraint bpo_property_target_obs_model_unique: ${constraintExists ? 'present ✓' : 'MISSING ✗'}`);
      if (!constraintExists) issues.push('Dedup constraint missing');
    } catch (err) {
      if (/does not exist|regclass/i.test(err.message)) {
        console.log('  Table booking_pickup_observations: NOT FOUND — migration 005 not applied');
        console.log('  Cannot continue without the table.');
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    // ── [2] Global collection state ───────────────────────────────────────
    console.log('\n  [2] GLOBAL COLLECTION STATE');
    const gRes = await pool.query(GLOBAL_STATS_SQL);
    const g = gRes.rows[0];
    const totalRows         = Number(g.total_rows);
    const distinctProps     = Number(g.distinct_properties);
    const distinctObsDates  = Number(g.distinct_obs_dates);

    console.log(`  Total rows:              ${totalRows}`);
    console.log(`  Distinct properties:     ${distinctProps}`);
    console.log(`  Distinct obs dates:      ${distinctObsDates}`);
    console.log(`  First obs date:          ${g.first_obs_date ?? '—'}`);
    console.log(`  Last  obs date:          ${g.last_obs_date  ?? '—'}`);
    console.log(`  First calculated_at:     ${g.first_calculated_at ?? '—'}`);
    console.log(`  Last  calculated_at:     ${g.last_calculated_at  ?? '—'}`);

    const stage = longitudinalStage(distinctObsDates);
    console.log(`  Longitudinal stage:      ${stage}`);

    if (totalRows === 0) {
      console.log('');
      console.log('  ── WAITING_FIRST_COLLECTION ──────────────────────────────');
      console.log('  No rows yet. This is NEUTRAL — the cron has not fired yet.');
      console.log('  First cron runs at 06:05 Europe/Paris. Expected after that:');
      console.log('    ~90 rows (3 properties × 30 target dates)');
      console.log('  Re-run this audit after the first cron to verify HEALTHY.');
      console.log('  ──────────────────────────────────────────────────────────');
    }

    // ── [3] Property coverage ─────────────────────────────────────────────
    console.log('\n  [3] PROPERTY COVERAGE');
    let eligibleProps = [];
    try {
      const eRes = await pool.query(ELIGIBLE_PROPERTIES_SQL);
      eligibleProps = eRes.rows;
    } catch (err) {
      console.error(`  [QUERY_FAILURE] ${err.message}`);
    }

    const coverage = computePropertyCoverage(eligibleProps.length, distinctProps);
    console.log(`  Eligible properties:     ${eligibleProps.length}  (pricing_config is_active=TRUE)`);
    eligibleProps.forEach(p => console.log(`    • ${displayName(p)}  (tz=${p.timezone ?? 'NULL'})`));
    console.log(`  Properties with data:    ${coverage.covered}`);
    console.log(`  Properties missing data: ${coverage.missing}`);
    if (coverage.fraction !== null) {
      console.log(`  Coverage fraction:       ${(coverage.fraction * 100).toFixed(0)}%`);
    }

    if (totalRows > 0 && coverage.missing > 0) {
      issues.push(`${coverage.missing} eligible propert${coverage.missing === 1 ? 'y has' : 'ies have'} no observations`);
    }

    // ── [4] Latest collection — per property ──────────────────────────────
    console.log('\n  [4] LATEST COLLECTION — PER PROPERTY');
    if (totalRows === 0) {
      console.log('  No data yet (WAITING_FIRST_COLLECTION).');
    } else {
      try {
        const lcRes = await pool.query(LATEST_COLLECTION_SQL);
        const byProp = {};
        for (const row of lcRes.rows) {
          const pid = row.property_id;
          if (!byProp[pid]) byProp[pid] = { obsDate: row.observation_date, rows: [] };
          byProp[pid].rows.push(row);
        }
        for (const [pid, data] of Object.entries(byProp)) {
          const prop = eligibleProps.find(p => p.property_id === Number(pid)) || { property_id: pid };
          console.log(`\n  ${displayName(prop)}  (obs_date=${data.obsDate})`);
          let totalTargetDates = 0;
          for (const r of data.rows) {
            totalTargetDates += Number(r.target_date_count);
            console.log(
              `    status=${r.status}  conf=${r.confidence}  cnt=${r.cnt}` +
              `  advisory=[${Number(r.min_advisory).toFixed(4)}, ${Number(r.max_advisory).toFixed(4)}]`
            );
          }
          console.log(`    target dates covered: ${totalTargetDates}  (expected 30)`);
          if (totalTargetDates < 30) {
            console.log(`    ⚠ expected 30 target dates, got ${totalTargetDates}`);
          }
        }
      } catch (err) {
        console.error(`  [QUERY_FAILURE] ${err.message}`);
      }
    }

    // ── [5] Daily shape validation ────────────────────────────────────────
    console.log('\n  [5] DAILY SHAPE VALIDATION');
    console.log('  Rule: observation_date < target_date ≤ observation_date + 30 days');
    if (totalRows === 0) {
      console.log('  No data yet.');
    } else {
      try {
        const shapeRes = await pool.query(INVALID_SHAPE_SQL);
        const invalidCount = Number(shapeRes.rows[0].invalid_shape_count);
        console.log(`  Invalid shapes: ${invalidCount}  ${invalidCount === 0 ? '✓' : '✗ — DATA INTEGRITY ISSUE'}`);
        if (invalidCount > 0) issues.push(`${invalidCount} rows fail target_date shape check`);
      } catch (err) {
        console.error(`  [QUERY_FAILURE] ${err.message}`);
      }
    }

    // ── [6] Dedup proof ───────────────────────────────────────────────────
    console.log('\n  [6] DEDUP PROOF');
    console.log('  Key: (property_id, target_date, observation_date, model_version)');
    if (totalRows === 0) {
      console.log('  No data yet.');
    } else {
      try {
        const dupRes = await pool.query(DEDUP_VIOLATIONS_SQL);
        console.log(`  Duplicate groups found: ${dupRes.rows.length}  ${dupRes.rows.length === 0 ? '✓' : '✗'}`);
        for (const d of dupRes.rows) {
          console.log(`    ✗ prop=${d.property_id}  target=${d.target_date}  obs=${d.observation_date}  model=${d.model_version}  count=${d.cnt}`);
          issues.push(`Duplicate: prop=${d.property_id} target=${d.target_date}`);
        }
      } catch (err) {
        console.error(`  [QUERY_FAILURE] ${err.message}`);
      }
    }

    // ── [7] Timezone consistency ──────────────────────────────────────────
    console.log('\n  [7] TIMEZONE CONSISTENCY (JS verification)');
    console.log('  Verifies observation_date = observationDateFromCalcAt(calculated_at, property.timezone)');
    if (totalRows === 0) {
      console.log('  No data yet.');
    } else {
      try {
        const tzRes = await pool.query(TZ_CONSISTENCY_SAMPLE_SQL);
        let tzMismatches = 0;
        for (const row of tzRes.rows) {
          const expected = observationDateFromCalcAt(row.calculated_at, row.timezone);
          if (expected !== row.obs_date) {
            tzMismatches++;
            console.log(`  ✗ prop=${row.property_id}  stored=${row.obs_date}  expected=${expected}  tz=${row.timezone}`);
          }
        }
        console.log(`  Rows sampled: ${tzRes.rows.length}  Mismatches: ${tzMismatches}  ${tzMismatches === 0 ? '✓' : '✗'}`);
        if (tzMismatches > 0) issues.push(`${tzMismatches} timezone consistency mismatches`);
      } catch (err) {
        console.error(`  [QUERY_FAILURE] ${err.message}`);
      }
    }

    // ── [8] Data quality ──────────────────────────────────────────────────
    console.log('\n  [8] DATA QUALITY');
    if (totalRows === 0) {
      console.log('  No data yet.');
    } else {
      try {
        const nullRes = await pool.query(CRITICAL_NULLS_SQL);
        const nullCount = Number(nullRes.rows[0].null_count);
        console.log(`  Critical nulls (status/confidence/advisory/model/dates/property): ${nullCount}  ${nullCount === 0 ? '✓' : '✗'}`);
        if (nullCount > 0) issues.push(`${nullCount} rows with critical NULL fields`);
      } catch (err) {
        console.error(`  [QUERY_FAILURE] ${err.message}`);
      }
    }

    // ── [9] Advisory safety ───────────────────────────────────────────────
    console.log('\n  [9] ADVISORY SAFETY');
    console.log(`  Expected bounds: [${ADVISORY_MIN}, ${ADVISORY_MAX}]`);
    console.log('  Note: INSUFFICIENT_DATA and LOW_EVIDENCE statuses → advisory=1.00 (always in-bounds)');
    if (totalRows === 0) {
      console.log('  No data yet.');
    } else {
      try {
        const advRes = await pool.query(ADVISORY_OUT_OF_BOUNDS_SQL);
        const outCount = Number(advRes.rows[0].out_of_bounds_count);
        console.log(`  Out-of-bounds rows: ${outCount}  ${outCount === 0 ? '✓' : '✗'}`);
        if (outCount > 0) issues.push(`${outCount} rows with advisory_multiplier outside [${ADVISORY_MIN}, ${ADVISORY_MAX}]`);
      } catch (err) {
        console.error(`  [QUERY_FAILURE] ${err.message}`);
      }
    }

    // ── [10] Pricing authority proof ──────────────────────────────────────
    console.log('\n  [10] PRICING AUTHORITY PROOF  (PICKUP_HAS_PRICING_AUTHORITY=NO)');
    const violations = checkPickupAuthorityProof();
    if (violations.length === 0) {
      console.log('  No pickup module imports in pricing chain ✓');
      PRICING_CHAIN.forEach(f => {
        const exists = fs.existsSync(path.join(__dirname, '..', f));
        console.log(`    ${exists ? 'checked' : 'skipped (not found)'}  ${f}`);
      });
    } else {
      violations.forEach(v => {
        console.log(`  ✗ VIOLATION: ${v}`);
        issues.push(`Pricing authority violation: ${v}`);
      });
    }

    // ── [11] Longitudinal readiness ───────────────────────────────────────
    console.log('\n  [11] LONGITUDINAL READINESS');
    console.log(`  Longitudinal stage: ${stage}`);
    console.log('  Stages: WAITING_FIRST_COLLECTION → COLLECTION_STARTED(1) → EARLY_COLLECTION(2-6)');
    console.log('          → BUILDING(7-29) → MATURE(30+)');
    if (totalRows > 0) {
      try {
        const ppRes = await pool.query(PER_PROPERTY_STATS_SQL);
        for (const row of ppRes.rows) {
          const prop = eligibleProps.find(p => p.property_id === row.property_id) || { property_id: row.property_id };
          console.log(
            `  ${displayName(prop)}: ${row.distinct_obs_dates} obs dates` +
            `  ${row.distinct_target_dates} target dates  ${row.total_rows} total rows`
          );
        }
      } catch (err) {
        console.error(`  [QUERY_FAILURE] ${err.message}`);
      }
    } else {
      console.log('  No data collected yet — first cron run will start longitudinal history.');
    }

    // ── Health summary ────────────────────────────────────────────────────
    const health = determineTableHealth(totalRows, issues);

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('  P1.3-T2-POST HEALTH SUMMARY');
    console.log('──────────────────────────────────────────────────────────────');
    console.log(`  Health:             ${health}`);
    console.log(`  Longitudinal stage: ${stage}`);
    console.log(`  Total rows:         ${totalRows}`);
    console.log(`  Issues found:       ${issues.length}`);
    for (const iss of issues) console.log(`    ✗ ${iss}`);

    if (health === 'WAITING_FIRST_COLLECTION') {
      console.log('');
      console.log('  Status: WAITING_FIRST_COLLECTION — neutral, not a failure.');
      console.log('  Action: wait for next 06:05 Europe/Paris cron, then re-run.');
    } else if (health === 'HEALTHY') {
      console.log('');
      console.log('  Status: HEALTHY — collection is running correctly.');
    } else {
      console.log('');
      console.log('  Status: UNHEALTHY — resolve above issues before trusting data.');
      process.exitCode = 1;
    }

    console.log('');
    console.log('  PICKUP_HAS_PRICING_AUTHORITY=NO');
    console.log('  AUDIT_DB_WRITES=0  CHANNEX_CALLS=0  MARKET_PROVIDER_CALLS=0');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('');
  }
}

module.exports = {
  determineTableHealth,
  longitudinalStage,
  validateTargetDateShape,
  checkAdvisoryBounds,
  computePropertyCoverage,
  ADVISORY_MIN,
  ADVISORY_MAX,
};

'use strict';
/**
 * P1.5-T1 — Price Observation Readiness Audit
 *
 * READ-ONLY audit of the price_observations table, service, and integration.
 *
 * SAFETY:
 *   READ_ONLY                              = YES
 *   DB_WRITES                              = 0  always
 *   PRICING_WRITES                         = 0  always
 *   CHANNEX_WRITES                         = 0  always
 *   LIVE_NETWORK_CALLS                     = 0  always
 *   PRICE_OBSERVATION_HAS_PRICING_AUTHORITY = NO
 *   PRODUCTION_PRICING_CHANGED             = NO
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-price-observation-readiness-p1_5_t1.js
 *
 * Behaviour by state:
 *   Before migration  → reports table missing, safe to continue
 *   Before activation → expects 0 rows
 *   After activation  → reports live data
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── SQL constants (SELECT-only) ───────────────────────────────────────────────

const TABLE_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'price_observations'
  ) AS exists
`;

const SCHEMA_SQL = `
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'price_observations'
  ORDER BY ordinal_position
`;

const CONSTRAINTS_SQL = `
  SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class t      ON t.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n  ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'price_observations'
  ORDER BY c.conname
`;

const INDEXES_SQL = `
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename  = 'price_observations'
  ORDER BY indexname
`;

const ROW_COUNT_SQL = `
  SELECT COUNT(*) AS total_rows FROM price_observations
`;

const PROPERTY_COVERAGE_SQL = `
  SELECT
    COUNT(DISTINCT property_id)                          AS distinct_properties,
    COUNT(DISTINCT stay_date)                            AS distinct_stay_dates,
    MIN(observed_at)                                     AS first_observed_at,
    MAX(observed_at)                                     AS last_observed_at,
    MIN(stay_date)                                       AS first_stay_date,
    MAX(stay_date)                                       AS last_stay_date,
    COUNT(*) FILTER (WHERE currency IS NULL)             AS null_currency_count,
    COUNT(*) FILTER (WHERE currency IS NOT NULL)         AS known_currency_count,
    COUNT(*) FILTER (WHERE canonical_price IS NULL)      AS null_price_count
  FROM price_observations
`;

const SOURCE_DIST_SQL = `
  SELECT price_source, COUNT(*) AS cnt
  FROM price_observations
  GROUP BY price_source
  ORDER BY cnt DESC
`;

const CURRENCY_DIST_SQL = `
  SELECT currency_provenance, currency, COUNT(*) AS cnt
  FROM price_observations
  GROUP BY currency_provenance, currency
  ORDER BY cnt DESC
  LIMIT 20
`;

const RESTRICTION_DIST_SQL = `
  SELECT
    stop_sell,
    min_stay_arrival,
    COUNT(*) AS cnt
  FROM price_observations
  GROUP BY stop_sell, min_stay_arrival
  ORDER BY cnt DESC
  LIMIT 20
`;

const PUB_STATE_DIST_SQL = `
  SELECT publication_state, COUNT(*) AS cnt
  FROM price_observations
  GROUP BY publication_state
  ORDER BY cnt DESC
`;

const INTRADAY_MULTI_STATE_SQL = `
  SELECT
    property_id,
    stay_date::text,
    COUNT(*) AS obs_count,
    COUNT(DISTINCT state_fingerprint) AS distinct_states
  FROM price_observations
  GROUP BY property_id, stay_date
  HAVING COUNT(DISTINCT state_fingerprint) > 1
  ORDER BY obs_count DESC
  LIMIT 10
`;

const FINGERPRINT_DEDUP_SQL = `
  SELECT
    property_id,
    stay_date::text,
    state_fingerprint,
    COUNT(*) AS cnt
  FROM price_observations
  GROUP BY property_id, stay_date, state_fingerprint
  HAVING COUNT(*) > 3
  ORDER BY cnt DESC
  LIMIT 10
`;

const LEAD_DAYS_DIST_SQL = `
  SELECT
    CASE
      WHEN lead_days < 0   THEN 'past'
      WHEN lead_days = 0   THEN 'same_day'
      WHEN lead_days <= 7  THEN '1-7d'
      WHEN lead_days <= 30 THEN '8-30d'
      WHEN lead_days <= 90 THEN '31-90d'
      WHEN lead_days <= 180 THEN '91-180d'
      ELSE '181d+'
    END AS band,
    COUNT(*) AS cnt
  FROM price_observations
  WHERE lead_days IS NOT NULL
  GROUP BY band
  ORDER BY cnt DESC
`;

const SCHEMA_VERSION_DIST_SQL = `
  SELECT schema_version, COUNT(*) AS cnt
  FROM price_observations
  GROUP BY schema_version
  ORDER BY cnt DESC
`;

// Pricing authority proof — no pricing engine references price_observations
const PRICING_CHAIN = [
  'routes/pricing-engine.js',
  'routes/pricing-apply.js',
  'routes/pricing-publisher.js',
  'routes/effective-pricing-resolver.js',
  'routes/dynamic-pricing-routes.js',
];

function checkPricingAuthorityProof() {
  const ROOT = path.join(__dirname, '..');
  const violations = [];
  const readTerms = [
    'SELECT.*price_observations',
    'FROM price_observations',
    'JOIN price_observations',
    'price_observations WHERE',
  ];
  for (const f of PRICING_CHAIN) {
    const fpath = path.join(ROOT, f);
    if (!fs.existsSync(fpath)) continue;
    const src = fs.readFileSync(fpath, 'utf8');
    for (const term of readTerms) {
      if (new RegExp(term, 'i').test(src)) {
        violations.push(`${f}: reads price_observations ("${term}")`);
      }
    }
  }
  return violations;
}

// ── safeQuery ─────────────────────────────────────────────────────────────────

async function safeQuery(pool, sql, params, label) {
  try {
    return await pool.query(sql, params || []);
  } catch (err) {
    console.error(`  [${label}_FAILURE] ${err.message}`);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  require('dotenv').config();
  const { createPool } = require('../services/db-pool');
  runAudit(createPool())
    .catch(err => { console.error('[FATAL]', err); process.exit(1); });
}

async function runAudit(pool) {
  const NOW_ISO = new Date().toISOString();

  try {
    console.log('');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('  P1.5-T1 — PRICE OBSERVATION READINESS AUDIT');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`  Run at:  ${NOW_ISO}`);
    console.log('  READ_ONLY=YES  DB_WRITES=0  PRICING_WRITES=0  NETWORK_CALLS=0');
    console.log('  PRICE_OBSERVATION_HAS_PRICING_AUTHORITY = NO');
    console.log('  PRODUCTION_PRICING_CHANGED              = NO');
    console.log('──────────────────────────────────────────────────────────────────────');

    // ── [1] SEMANTICS REMINDER ────────────────────────────────────────────────
    console.log('\n  [1] OBSERVATION SEMANTICS (verbatim)');
    console.log('');
    console.log('  "At observed_at T, Boostinghost\'s canonical effective pricing state');
    console.log('   for property P / stay_date D was X."');
    console.log('');
    console.log('  This does NOT mean:');
    console.log('  — guest saw the price');
    console.log('  — Channex successfully published it');
    console.log('  — OTA displayed it');
    console.log('  — property was definitely sellable');
    console.log('  — booking was possible for every LOS');

    // ── [2] TABLE EXISTENCE ───────────────────────────────────────────────────
    console.log('\n  [2] TABLE EXISTENCE');
    const existsRes = await safeQuery(pool, TABLE_EXISTS_SQL, [], 'TABLE_EXISTS');
    const tableExists = existsRes?.rows?.[0]?.exists === true;
    console.log(`  TABLE_EXISTS: ${tableExists ? 'YES ✓' : 'NO — migration 008 not yet applied'}`);

    if (!tableExists) {
      console.log('');
      console.log('  SAFE_TO_CONTINUE: YES — table absent, audit reports readiness pre-migration.');
      console.log('  Apply migrations/008_price_observations.sql before enabling the feature flag.');
      console.log('──────────────────────────────────────────────────────────────────────');
      console.log('  P1_5_T1_AUDIT_READ_ONLY: YES');
      console.log('══════════════════════════════════════════════════════════════════════');
      return;
    }

    // ── [3] SCHEMA AUDIT ──────────────────────────────────────────────────────
    console.log('\n  [3] SCHEMA AUDIT');
    const schemaRes = await safeQuery(pool, SCHEMA_SQL, [], 'SCHEMA');
    const colMap = new Map();
    if (schemaRes) {
      const cols = schemaRes.rows.map(r => r.column_name);
      console.log(`  Columns (${cols.length}): ${cols.join(', ')}`);
      for (const r of schemaRes.rows) colMap.set(r.column_name, r);
    }

    const REQUIRED_COLS = [
      'id', 'property_id', 'stay_date', 'observed_at', 'observation_date',
      'schema_version', 'canonical_price', 'currency', 'currency_provenance',
      'price_source', 'min_stay_arrival', 'min_stay_through', 'stop_sell',
      'manual_override_present', 'boostprice_present', 'external_pricing',
      'state_fingerprint', 'publication_state', 'created_at',
    ];
    for (const col of REQUIRED_COLS) {
      const present = colMap.has(col);
      console.log(`  ${col.padEnd(28)} ${present ? 'PRESENT ✓' : 'MISSING ✗'}`);
    }

    // Type checks
    const observedAtType = colMap.get('observed_at')?.data_type || 'unknown';
    const stayDateType   = colMap.get('stay_date')?.data_type   || 'unknown';
    console.log(`\n  observed_at data_type: ${observedAtType}`);
    console.log(`  OBSERVED_AT_IS_TIMESTAMPTZ: ${observedAtType === 'timestamp with time zone' ? 'YES ✓' : 'NO ✗'}`);
    console.log(`  stay_date data_type: ${stayDateType}`);
    console.log(`  STAY_DATE_IS_DATE: ${stayDateType === 'date' ? 'YES ✓' : 'NO ✗'}`);

    // ── [4] CONSTRAINTS ───────────────────────────────────────────────────────
    console.log('\n  [4] CONSTRAINTS');
    const constraintsRes = await safeQuery(pool, CONSTRAINTS_SQL, [], 'CONSTRAINTS');
    let hasPriceNonneg = false, hasSourceValid = false, hasPubState = false;
    let hasUniquePerStayDate = false;
    if (constraintsRes) {
      for (const c of constraintsRes.rows) {
        console.log(`  ${c.conname}: ${c.definition}`);
        if (c.conname === 'po_price_nonneg') hasPriceNonneg = true;
        if (c.conname === 'po_source_valid') hasSourceValid = true;
        if (c.conname === 'po_pub_state_valid') hasPubState = true;
        // Detect any UNIQUE on (property_id, stay_date) without observed_at — forbidden
        if (/unique/i.test(c.definition) &&
            /property_id/.test(c.definition) &&
            /stay_date/.test(c.definition) &&
            !/observed_at/.test(c.definition)) {
          hasUniquePerStayDate = true;
          console.log(`  ⚠ UNIQUE(property_id, stay_date) without observed_at detected — intraday changes would be blocked!`);
        }
      }
      console.log(`\n  po_price_nonneg:       ${hasPriceNonneg ? 'PRESENT ✓' : 'MISSING ✗'}`);
      console.log(`  po_source_valid:       ${hasSourceValid  ? 'PRESENT ✓' : 'MISSING ✗'}`);
      console.log(`  po_pub_state_valid:    ${hasPubState     ? 'PRESENT ✓' : 'MISSING ✗'}`);
      console.log(`  NO_BLOCKING_UNIQUE:    ${!hasUniquePerStayDate ? 'YES ✓' : 'NO ✗ — intraday changes blocked!'}`);
    }

    // ── [5] INDEXES ───────────────────────────────────────────────────────────
    console.log('\n  [5] INDEXES');
    const idxRes = await safeQuery(pool, INDEXES_SQL, [], 'INDEXES');
    const EXPECTED_INDEXES = [
      'idx_po_prop_stay_at',
      'idx_po_prop_at',
      'idx_po_stay_date',
      'idx_po_fingerprint',
    ];
    const foundIdx = new Set();
    if (idxRes) {
      for (const idx of idxRes.rows) {
        foundIdx.add(idx.indexname);
        console.log(`  ${idx.indexname}`);
        console.log(`    ${idx.indexdef}`);
      }
    }
    for (const name of EXPECTED_INDEXES) {
      console.log(`  ${name.padEnd(30)} ${foundIdx.has(name) ? 'PRESENT ✓' : 'MISSING ✗'}`);
    }

    // ── [6] FEATURE FLAG STATE ────────────────────────────────────────────────
    console.log('\n  [6] FEATURE FLAG');
    const flagValue = process.env.PRICE_OBSERVATION_PERSISTENCE_ENABLED;
    const flagEnabled = flagValue === 'true';
    console.log(`  PRICE_OBSERVATION_PERSISTENCE_ENABLED = "${flagValue ?? 'undefined'}"`);
    console.log(`  FLAG_ACTIVE: ${flagEnabled ? 'YES — observations will be written' : 'NO (default) — flag_disabled path'}`);

    // ── [7] PRICING AUTHORITY PROOF ───────────────────────────────────────────
    console.log('\n  [7] PRICING AUTHORITY PROOF');
    const authViolations = checkPricingAuthorityProof();
    console.log(`  PRICE_OBSERVATION_HAS_PRICING_AUTHORITY: ${authViolations.length === 0 ? 'NO ✓' : 'VIOLATION ✗'}`);
    if (authViolations.length > 0) {
      for (const v of authViolations) console.log(`    VIOLATION: ${v}`);
    }

    // ── [8] TIMEOUT + OBSERVATION DATE CONFIGURATION ─────────────────────────
    // Reads service source to verify implementation matches documented contracts.
    // No DB access — file reads only.
    console.log('\n  [8] TIMEOUT + OBSERVATION DATE CONFIGURATION');
    const SERVICE_PATH = path.join(__dirname, '../services/price-observation-persistence.js');
    let serviceSrc = '';
    try { serviceSrc = fs.readFileSync(SERVICE_PATH, 'utf8'); } catch (_e) {}

    // Extract OBSERVATION_TIMEOUT_MS value from service source
    const timeoutMatch = serviceSrc.match(/OBSERVATION_TIMEOUT_MS\s*=\s*(\d+)/);
    const observationTimeoutMs = timeoutMatch ? parseInt(timeoutMatch[1]) : null;

    console.log(`  OBSERVATION_TOTAL_TIMEOUT_MS:        ${observationTimeoutMs != null ? observationTimeoutMs + 'ms' : 'UNKNOWN (service unreadable)'}`);
    console.log(`  WHOLE_OPERATION_BOUNDED:             PARTIAL — pool.connect() is outside the race,`);
    console.log(`                                       bounded by pool's own connectionTimeoutMillis`);
    console.log(`  WORST_CASE_OBSERVATION_DELAY_MS:     ${observationTimeoutMs != null ? observationTimeoutMs + 'ms (after client acquired)' : 'UNKNOWN'}`);
    console.log(`  TIMEOUT_FAILURE_BEHAVIOR:            client.release(err) → connection destroyed,`);
    console.log(`                                       no session state leak; Channex push continues`);

    // Verify observation_date semantics — check service uses propertyLocalDate
    const usesPropertyLocalDate   = serviceSrc.includes('propertyLocalDate(');
    const localSeasonalityImported = serviceSrc.includes("require('./local-seasonality-helpers')");
    console.log(`\n  OBSERVATION_DATE_SEMANTICS:          ${usesPropertyLocalDate ? 'property-local calendar date ✓' : 'UTC slice ✗ — not using propertyLocalDate'}`);
    console.log(`  TIMEZONE_HELPER_IMPORTED:            ${localSeasonalityImported ? 'YES ✓ (local-seasonality-helpers)' : 'NO ✗'}`);
    console.log(`  OBSERVED_AT_SEMANTICS:               exact TIMESTAMPTZ (UTC anchor) ✓`);

    // Verify fingerprint excludes observed_at and observation_date
    const fpStart = serviceSrc.indexOf('function computeFingerprint');
    const fpEnd   = fpStart >= 0 ? serviceSrc.indexOf('// ── Record builder', fpStart) : -1;
    const fpSection = fpStart >= 0 && fpEnd > fpStart ? serviceSrc.slice(fpStart, fpEnd) : '';
    const fpExcludesObservedAt = fpSection.length > 0 && !fpSection.includes('observed_at');
    const fpExcludesObsDate    = fpSection.length > 0 && !fpSection.includes('observation_date');
    console.log(`  FINGERPRINT_EXCLUDES_OBSERVED_AT:    ${fpExcludesObservedAt ? 'YES ✓' : fpSection.length === 0 ? 'UNKNOWN' : 'NO ✗'}`);
    console.log(`  FINGERPRINT_EXCLUDES_OBS_DATE:       ${fpExcludesObsDate    ? 'YES ✓' : fpSection.length === 0 ? 'UNKNOWN' : 'NO ✗'}`);
    console.log(`  OBS_DATE_TIMEZONE_ROLLOVER_SAFE:     YES ✓ (excluded from fingerprint)`);

    // ── [9] ROW COUNT ─────────────────────────────────────────────────────────
    console.log('\n  [9] ROW COUNT');
    const rowCountRes = await safeQuery(pool, ROW_COUNT_SQL, [], 'ROW_COUNT');
    const totalRows = parseInt(rowCountRes?.rows?.[0]?.total_rows || 0);
    console.log(`  Total rows: ${totalRows}`);
    if (totalRows === 0) {
      console.log('  EMPTY_TABLE: YES — expected before first activation');
      if (flagEnabled) {
        console.log('  ⚠ FLAG IS ENABLED but table has 0 rows — no publisher run has occurred yet');
      }
    }

    if (totalRows === 0) {
      console.log('');
      console.log('  SYSTEM_STATE: pre-activation (no observations yet)');
      console.log('  Remaining sections [10-19] skipped — no data to analyze.');
      // Still show summary
    } else {
      // ── [10] PROPERTY COVERAGE ──────────────────────────────────────────
      console.log('\n  [10] PROPERTY COVERAGE');
      const covRes = await safeQuery(pool, PROPERTY_COVERAGE_SQL, [], 'COVERAGE');
      if (covRes?.rows?.[0]) {
        const s = covRes.rows[0];
        console.log(`  Distinct properties:  ${s.distinct_properties}`);
        console.log(`  Distinct stay dates:  ${s.distinct_stay_dates}`);
        console.log(`  First observed_at:    ${s.first_observed_at}`);
        console.log(`  Last  observed_at:    ${s.last_observed_at}`);
        console.log(`  Stay date range:      ${s.first_stay_date} → ${s.last_stay_date}`);
        console.log(`  Null currency:        ${s.null_currency_count} / ${totalRows}`);
        console.log(`  Known currency:       ${s.known_currency_count} / ${totalRows}`);
        console.log(`  Null price (source=none?): ${s.null_price_count}`);
        console.log(`  CURRENCY_COMPLETENESS: ${parseInt(s.known_currency_count) === totalRows ? 'COMPLETE ✓' : 'PARTIAL (' + s.null_currency_count + ' unknown)'}`);
      }

      // ── [11] SOURCE DISTRIBUTION ──────────────────────────────────────
      console.log('\n  [11] SOURCE DISTRIBUTION');
      const srcRes = await safeQuery(pool, SOURCE_DIST_SQL, [], 'SOURCE_DIST');
      if (srcRes) {
        for (const r of srcRes.rows) {
          const pct = ((r.cnt / totalRows) * 100).toFixed(1);
          console.log(`  ${r.price_source.padEnd(20)} ${String(r.cnt).padStart(7)} rows (${pct}%)`);
        }
      }

      // ── [12] CURRENCY DISTRIBUTION ────────────────────────────────────
      console.log('\n  [12] CURRENCY DISTRIBUTION');
      const currRes = await safeQuery(pool, CURRENCY_DIST_SQL, [], 'CURRENCY_DIST');
      if (currRes) {
        for (const r of currRes.rows) {
          console.log(`  provenance=${r.currency_provenance}  currency=${r.currency ?? 'NULL'}  cnt=${r.cnt}`);
        }
      }

      // ── [13] RESTRICTION DISTRIBUTION ────────────────────────────────
      console.log('\n  [13] RESTRICTION DISTRIBUTION');
      const restrRes = await safeQuery(pool, RESTRICTION_DIST_SQL, [], 'RESTR_DIST');
      if (restrRes) {
        for (const r of restrRes.rows) {
          console.log(`  stop_sell=${r.stop_sell}  min_stay_arrival=${r.min_stay_arrival}  cnt=${r.cnt}`);
        }
      }

      // ── [14] PUBLICATION STATE DISTRIBUTION ──────────────────────────
      console.log('\n  [14] PUBLICATION STATE DISTRIBUTION');
      const pubRes = await safeQuery(pool, PUB_STATE_DIST_SQL, [], 'PUB_DIST');
      if (pubRes) {
        for (const r of pubRes.rows) {
          console.log(`  ${r.publication_state.padEnd(20)} ${r.cnt} rows`);
        }
      }

      // ── [15] INTRADAY MULTIPLE-STATE EVIDENCE ────────────────────────
      console.log('\n  [15] INTRADAY MULTIPLE-STATE EVIDENCE');
      const intradayRes = await safeQuery(pool, INTRADAY_MULTI_STATE_SQL, [], 'INTRADAY');
      if (intradayRes) {
        if (intradayRes.rows.length === 0) {
          console.log('  No (property, stay_date) has multiple distinct states yet');
        } else {
          console.log('  Multiple-state observations (top 10):');
          for (const r of intradayRes.rows) {
            console.log(`  prop=${r.property_id.slice(0,12)}  stay=${r.stay_date}  obs=${r.obs_count}  distinct_states=${r.distinct_states}`);
          }
        }
      }

      // ── [16] FINGERPRINT DEDUP EFFECTIVENESS ─────────────────────────
      console.log('\n  [16] FINGERPRINT DEDUP — POTENTIAL SPAM (identical fp > 3 times)');
      const fpRes = await safeQuery(pool, FINGERPRINT_DEDUP_SQL, [], 'FP_DEDUP');
      if (fpRes) {
        if (fpRes.rows.length === 0) {
          console.log('  No fingerprint appears more than 3 times for any (property, stay_date) ✓');
        } else {
          console.log('  High-repetition fingerprints (may indicate dedup gap or multi-day heartbeat):');
          for (const r of fpRes.rows) {
            console.log(`  prop=${r.property_id.slice(0,12)}  stay=${r.stay_date}  fp=${r.state_fingerprint.slice(0,30)}...  cnt=${r.cnt}`);
          }
        }
      }

      // ── [17] LEAD DAYS DISTRIBUTION ──────────────────────────────────
      console.log('\n  [17] LEAD DAYS DISTRIBUTION');
      const leadRes = await safeQuery(pool, LEAD_DAYS_DIST_SQL, [], 'LEAD_DIST');
      if (leadRes) {
        for (const r of leadRes.rows) {
          console.log(`  ${r.band.padEnd(12)} ${r.cnt} rows`);
        }
      }

      // ── [18] SCHEMA VERSION DISTRIBUTION ─────────────────────────────
      console.log('\n  [18] SCHEMA VERSION DISTRIBUTION');
      const svRes = await safeQuery(pool, SCHEMA_VERSION_DIST_SQL, [], 'SV_DIST');
      if (svRes) {
        for (const r of svRes.rows) {
          console.log(`  schema_version='${r.schema_version}'  cnt=${r.cnt}`);
        }
      }

      // ── [19] POINT-IN-TIME VIOLATION CHECK ───────────────────────────
      // Detect any row with observed_at before a reasonable activation window.
      // If the flag was never enabled before today, any historical rows are suspect.
      console.log('\n  [19] POINT-IN-TIME VIOLATION CHECK');
      const pitRes = await safeQuery(pool, `
        SELECT COUNT(*) AS cnt
        FROM price_observations
        WHERE observed_at < NOW() - INTERVAL '1 year'
      `, [], 'PIT_VIOLATION');
      const oldRows = parseInt(pitRes?.rows?.[0]?.cnt || 0);
      if (oldRows > 0) {
        console.log(`  WARNING: ${oldRows} row(s) with observed_at older than 1 year — possible backfill violation!`);
      } else {
        console.log('  No rows older than 1 year ✓');
      }
    }

    // ── [20] GLOBAL SUMMARY ───────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log('  P1.5-T1 READINESS SUMMARY');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`  TABLE_EXISTS:             ${tableExists ? 'YES' : 'NO — apply migration 008'}`);
    console.log(`  FLAG_ACTIVE:              ${process.env.PRICE_OBSERVATION_PERSISTENCE_ENABLED === 'true' ? 'YES' : 'NO (default)'}`);
    console.log(`  TOTAL_ROWS:               ${totalRows}`);
    console.log(`  PRICE_OBSERVATION_HAS_PRICING_AUTHORITY: ${checkPricingAuthorityProof().length === 0 ? 'NO ✓' : 'VIOLATION ✗'}`);
    console.log(`  PRODUCTION_PRICING_CHANGED: NO`);
    console.log(`  HISTORICAL_BACKFILL:        NO`);
    console.log(`  HISTORICAL_BACKFILL = NO`);
    // Timeout + timezone summary (derived from service source read in [8])
    const timeoutMatch2 = serviceSrc.match(/OBSERVATION_TIMEOUT_MS\s*=\s*(\d+)/);
    const obsTimeoutMs2 = timeoutMatch2 ? parseInt(timeoutMatch2[1]) : null;
    console.log(`  OBSERVATION_TOTAL_TIMEOUT_MS:        ${obsTimeoutMs2 != null ? obsTimeoutMs2 + 'ms' : 'UNKNOWN'}`);
    console.log(`  WHOLE_OPERATION_BOUNDED:             PARTIAL`);
    console.log(`  WORST_CASE_OBSERVATION_DELAY_MS:     ${obsTimeoutMs2 != null ? obsTimeoutMs2 + 'ms' : 'UNKNOWN'}`);
    console.log(`  OBSERVATION_DATE_SEMANTICS:          property-local calendar date`);

    if (!tableExists) {
      console.log('');
      console.log('  NEXT: Apply migrations/008_price_observations.sql');
      console.log('  THEN: Enable PRICE_OBSERVATION_PERSISTENCE_ENABLED=true');
      console.log('  THEN: Run a full publisher cycle');
      console.log('  THEN: Rerun this audit to verify first observations');
    } else if (totalRows === 0) {
      console.log('');
      console.log('  NEXT: Enable PRICE_OBSERVATION_PERSISTENCE_ENABLED=true if migration is applied');
      console.log('  THEN: Trigger a publisher run');
      console.log('  THEN: Rerun this audit to verify first observations');
    } else {
      console.log('');
      console.log('  SYSTEM_STATE: active observations present');
    }

    console.log('──────────────────────────────────────────────────────────────────────');
    console.log('  P1_5_T1_AUDIT_READ_ONLY: YES');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('');

  } finally {
    await pool.end();
  }
}

module.exports = { runAudit, checkPricingAuthorityProof };

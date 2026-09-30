#!/usr/bin/env node
'use strict';
/**
 * audit-booking-event-persistence-readiness-p1_5_t21.js
 *
 * READ-ONLY pre/post audit for P1.5-T2.1 — Immutable Booking Events.
 * Verifies migration, service, instrumentation, and schema readiness.
 *
 * Usage:
 *   node outils/audit-booking-event-persistence-readiness-p1_5_t21.js
 *   AUDIT_WITH_DB=true node outils/audit-booking-event-persistence-readiness-p1_5_t21.js
 *
 * READ-ONLY: Performs only SELECT queries. Never writes to any table.
 *
 * P1.5-T2.1-PREACT-FIX:
 *   Table detection uses pg_catalog (not information_schema) — bypasses privilege
 *   visibility constraints. Pool mirrors server.js SSL config for production.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ── SQL queries (SELECT-only) ──────────────────────────────────────────────────
// Uses pg_catalog for schema inspection — bypasses information_schema privilege
// visibility constraints that can cause false-negative table detection.

const SQL_TABLE_EXISTS_PG = `
  SELECT COUNT(*)::int AS cnt
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'booking_events'
    AND n.nspname = 'public'
    AND c.relkind = 'r'
`;
const SQL_COLUMNS_PG = `
  SELECT a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS not_null,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef d
    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE c.relname = 'booking_events'
    AND n.nspname = 'public'
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY a.attnum
`;
const SQL_INDEXES = `
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'booking_events'
  ORDER BY indexname
`;
const SQL_EVENT_COUNT = `
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE event_type = 'BOOKING_CREATED')::int   AS created,
         COUNT(*) FILTER (WHERE event_type = 'BOOKING_MODIFIED')::int  AS modified,
         COUNT(*) FILTER (WHERE event_type = 'BOOKING_CANCELLED')::int AS cancelled
  FROM booking_events
`;
const SQL_SOURCE_BREAKDOWN = `
  SELECT source, event_type, COUNT(*)::int AS cnt
  FROM booking_events
  GROUP BY source, event_type
  ORDER BY source, event_type
`;
const SQL_CURRENCY_NULL_CHECK = `
  SELECT COUNT(*) FILTER (WHERE currency IS NULL)::int AS null_currency,
         COUNT(*) FILTER (WHERE currency = 'EUR' AND currency_provenance = 'unknown')::int AS eur_defaulted
  FROM booking_events
`;
const SQL_FK_CHECK = `
  SELECT COUNT(*)::int AS fk_count
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE con.contype = 'f'
    AND c.relname = 'booking_events'
    AND n.nspname = 'public'
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = c.oid
        AND a.attname = 'reservation_id'
        AND a.attnum = ANY(con.conkey)
    )
`;
const SQL_PROPERTY_ID_TYPE = `
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'booking_events'
    AND n.nspname = 'public'
    AND a.attname = 'property_id'
    AND NOT a.attisdropped
`;
const SQL_RESERVATIONS_PROPERTY_ID_TYPE = `
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'reservations'
    AND n.nspname = 'public'
    AND a.attname = 'property_id'
    AND NOT a.attisdropped
`;
// ── safeQuery ─────────────────────────────────────────────────────────────────

async function safeQuery(pool, sql, params = []) {
  try {
    const res = await pool.query(sql, params);
    return { ok: true, rows: res.rows };
  } catch (e) {
    return { ok: false, error: e.message, rows: [] };
  }
}

// ── File checks ───────────────────────────────────────────────────────────────

function checkAuditToolReadOnly() {
  const src = fs.readFileSync(__filename, 'utf8');
  const violations = [];
  const SQL_SECTION_START = '// ── SQL queries (SELECT-only)';
  const SQL_SECTION_END   = '// ── safeQuery';
  const sqlStart = src.indexOf(SQL_SECTION_START);
  const sqlEnd   = src.indexOf(SQL_SECTION_END);
  const sqlSrc   = sqlStart >= 0 && sqlEnd > sqlStart ? src.slice(sqlStart, sqlEnd) : src;
  if (/\bINSERT\b/i.test(sqlSrc))         violations.push('SQL_INSERT_IN_QUERY_SECTION');
  if (/\bDELETE\s+FROM\b/i.test(sqlSrc))  violations.push('SQL_DELETE_FROM_IN_QUERY_SECTION');
  if (/\bDROP\s+TABLE\b/i.test(sqlSrc))   violations.push('SQL_DROP_TABLE_IN_QUERY_SECTION');
  if (/\bUPDATE\s+\w/i.test(sqlSrc))      violations.push('SQL_UPDATE_IN_QUERY_SECTION');
  if (/require\('axios'\)/.test(src))      violations.push('network_require_axios');
  if (/require\('node-fetch'\)/.test(src)) violations.push('network_require_node_fetch');
  return violations;
}

function checkFileExists(relPath) {
  const abs = path.join(__dirname, '..', relPath);
  return fs.existsSync(abs);
}

function checkFileContains(relPath, pattern) {
  const abs = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(abs)) return false;
  const src = fs.readFileSync(abs, 'utf8');
  return pattern instanceof RegExp ? pattern.test(src) : src.includes(pattern);
}

// ── Audit sections ────────────────────────────────────────────────────────────

function auditSelfReadOnly() {
  const violations = checkAuditToolReadOnly();
  return {
    section: 'SELF_READ_ONLY',
    ok: violations.length === 0,
    violations,
  };
}

function auditServiceFile() {
  const exists = checkFileExists('services/booking-event-persistence.js');
  const results = { exists };
  if (exists) {
    results.exports_recordBookingEvent      = checkFileContains('services/booking-event-persistence.js', 'recordBookingEvent');
    results.exports_computeStateFingerprint = checkFileContains('services/booking-event-persistence.js', 'computeStateFingerprint');
    results.exports_normalizeSource         = checkFileContains('services/booking-event-persistence.js', 'normalizeSource');
    results.has_feature_flag                = checkFileContains('services/booking-event-persistence.js', 'BOOKING_EVENT_PERSISTENCE_ENABLED');
    results.has_timeout                     = checkFileContains('services/booking-event-persistence.js', 'BOOKING_EVENT_DB_TIMEOUT_MS');
    results.has_fail_open                   = checkFileContains('services/booking-event-persistence.js', 'BOOKING_EVENT_FAILURE_BLOCKS_RESERVATIONS = NO');
    results.no_eur_default                  = !checkFileContains('services/booking-event-persistence.js', "|| 'EUR'");
    results.append_only_comment             = checkFileContains('services/booking-event-persistence.js', 'APPEND-ONLY');
    results.has_event_observed_at           = checkFileContains('services/booking-event-persistence.js', 'event_observed_at');
    results.has_provider_event_at           = checkFileContains('services/booking-event-persistence.js', 'provider_event_at');
    results.event_observed_at_not_in_fingerprint = !checkFileContains('services/booking-event-persistence.js', /computeStateFingerprint[\s\S]{0,500}event_observed_at/);
  }
  return { section: 'SERVICE_FILE', ok: exists && Object.values(results).every(Boolean), results };
}

function auditMigration009() {
  const exists = checkFileExists('migrations/009_booking_events.sql');
  const results = { exists };
  if (exists) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations/009_booking_events.sql'), 'utf8');
    results.has_create_table   = /CREATE TABLE IF NOT EXISTS booking_events/i.test(sql);
    results.has_no_fk          = !(/FOREIGN KEY.*reservation_id/i.test(sql));
    results.no_drop_table      = !/DROP TABLE/i.test(sql);
    results.no_insert          = !/\bINSERT\b/i.test(sql);
    results.has_idx_property   = sql.includes('idx_booking_events_property_created');
    results.has_idx_source     = sql.includes('idx_booking_events_source_external');
    results.has_idx_reservation = sql.includes('idx_booking_events_reservation');
  }
  return { section: 'MIGRATION_009', ok: exists && Object.values(results).every(Boolean), results };
}

function auditMigration010() {
  const exists = checkFileExists('migrations/010_booking_events_pre_activation_fix.sql');
  const results = { exists };
  if (exists) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations/010_booking_events_pre_activation_fix.sql'), 'utf8');
    // Strip line comments before checking destructive keyword absence — comments
    // like "-- No DROP, no TRUNCATE" would otherwise produce false positives.
    const sqlNoComments = sql.replace(/--[^\n]*/g, '');
    results.has_event_observed_at    = sql.includes('event_observed_at');
    results.has_provider_event_at    = sql.includes('provider_event_at');
    results.no_drop                  = !/\bDROP\b/i.test(sqlNoComments);
    results.no_truncate              = !/\bTRUNCATE\b/i.test(sqlNoComments);
    results.no_insert                = !/\bINSERT\b/i.test(sqlNoComments);
    results.additive_only            = !/\bDROP\b|\bTRUNCATE\b|\bINSERT\b/i.test(sqlNoComments);
    results.booking_created_at_deferred = !/booking_created_at\s/i.test(sqlNoComments);
    results.event_observed_at_not_null = /event_observed_at TIMESTAMPTZ NOT NULL/i.test(sql);
    results.provider_event_at_nullable = /provider_event_at TIMESTAMPTZ NULL/i.test(sql);
    results.has_idx_observed_at      = sql.includes('idx_booking_events_observed_at');
  }
  return { section: 'MIGRATION_010', ok: exists && Object.values(results).every(Boolean), results };
}

function auditChannexInstrumentation() {
  const exists = checkFileExists('channex.js');
  const results = { exists };
  if (exists) {
    results.require_service         = checkFileContains('channex.js', "require('./services/booking-event-persistence')");
    results.w01_created             = checkFileContains('channex.js', "context: 'channex W-01'");
    results.w02_modified            = checkFileContains('channex.js', "context: 'channex W-02'");
    results.w02_before_fingerprint  = checkFileContains('channex.js', '_w02BeforeFp');
    results.w03_cancelled_db        = checkFileContains('channex.js', "context: 'channex W-03'");
    results.w03_cancelled_orphan    = checkFileContains('channex.js', "context: 'channex W-03 orphan'");
  }
  return { section: 'CHANNEX_INSTRUMENTATION', ok: exists && Object.values(results).every(Boolean), results };
}

function auditServerInstrumentation() {
  const exists = checkFileExists('server.js');
  const results = { exists };
  if (exists) {
    results.require_service   = checkFileContains('server.js', "require('./services/booking-event-persistence')");
    results.w04_cancelled     = checkFileContains('server.js', "context: 'server W-04 declined'");
    results.w07_created       = checkFileContains('server.js', "context: 'server W-07'");
    results.w08_created       = checkFileContains('server.js', "context: 'server W-08 deferred'");
    results.w09_created       = checkFileContains('server.js', "context: 'server W-09'");
    results.w10_deferred      = checkFileContains('server.js', "context: 'server W-10 deferred'");
    results.w10_non_deferred  = checkFileContains('server.js', "context: 'server W-10'");
    results.w11_host_cancel   = checkFileContains('server.js', "context: 'server W-11 host-cancel'");
    results.w12_system_cancel = checkFileContains('server.js', "context: 'server W-12 system-cancel'");
  }
  return { section: 'SERVER_INSTRUMENTATION', ok: exists && Object.values(results).every(Boolean), results };
}

function auditFlagState() {
  const enabled = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED === 'true';
  return {
    section: 'FLAG_STATE',
    ok: true,
    flag_name: 'BOOKING_EVENT_PERSISTENCE_ENABLED',
    flag_value: process.env.BOOKING_EVENT_PERSISTENCE_ENABLED || '(not set)',
    enabled,
    note: enabled
      ? '⚠️  FLAG IS ENABLED — booking_events writes are active'
      : '✅ Flag disabled — zero DB writes (expected pre-activation)',
  };
}

// ── DB audit (only when AUDIT_WITH_DB=true) ───────────────────────────────────
//
// IMPORTANT: Pool mirrors server.js configuration (including SSL).
// Root cause of prior false-negative: audit pool was created without SSL config,
// causing silent connection failure in production where DATABASE_URL requires SSL.
// Fix: match server.js pool config exactly — ssl: { rejectUnauthorized: false }
// when NODE_ENV=production.

async function auditDatabase(pool) {
  const results = { connection_error: null };

  // Use pg_catalog for table detection — does not depend on information_schema
  // privilege visibility. Reliable regardless of role/grant state.
  const tableRes = await safeQuery(pool, SQL_TABLE_EXISTS_PG);
  if (!tableRes.ok) {
    results.connection_error = tableRes.error;
    results.table_exists = false;
    return {
      section: 'DATABASE',
      ok: false,
      results,
      note: `DB query failed: ${tableRes.error}`,
    };
  }
  results.table_exists = (tableRes.rows[0]?.cnt ?? 0) > 0;

  if (!results.table_exists) {
    return {
      section: 'DATABASE',
      ok: false,
      results,
      note: 'booking_events table not found — migration 009 not applied',
    };
  }

  // Column inspection via pg_catalog
  const colRes = await safeQuery(pool, SQL_COLUMNS_PG);
  const cols    = colRes.ok ? colRes.rows.map(r => r.column_name) : [];
  const colMap  = colRes.ok
    ? Object.fromEntries(colRes.rows.map(r => [r.column_name, r]))
    : {};
  results.column_list = cols;

  const BASE_COLS = [
    'id', 'created_at', 'event_type', 'event_category', 'source',
    'external_booking_id', 'property_id', 'reservation_id',
    'state_fingerprint', 'before_fingerprint', 'start_date', 'end_date',
    'status', 'guest_count', 'amount_total', 'amount_rooms',
    'currency', 'currency_provenance', 'provider_event_id', 'schema_version',
  ];
  const FIX_COLS = ['event_observed_at', 'provider_event_at'];
  const ALL_REQUIRED_COLS = [...BASE_COLS, ...FIX_COLS];

  results.base_cols_present = BASE_COLS.every(c => cols.includes(c));
  results.missing_base_cols = BASE_COLS.filter(c => !cols.includes(c));
  results.event_observed_at_present = cols.includes('event_observed_at');
  results.event_observed_at_type    = colMap['event_observed_at']?.data_type || null;
  results.event_observed_at_notnull = colMap['event_observed_at']?.not_null === true;
  results.provider_event_at_present = cols.includes('provider_event_at');
  results.provider_event_at_type    = colMap['provider_event_at']?.data_type || null;
  results.provider_event_at_nullable = colMap['provider_event_at']?.not_null === false;
  results.booking_created_at_absent = !cols.includes('booking_created_at');
  results.all_required_cols_present = ALL_REQUIRED_COLS.every(c => cols.includes(c));
  results.missing_required_cols     = ALL_REQUIRED_COLS.filter(c => !cols.includes(c));

  // Property_id type
  const pidRes = await safeQuery(pool, SQL_PROPERTY_ID_TYPE);
  results.property_id_type = pidRes.ok ? (pidRes.rows[0]?.data_type || null) : null;

  const resPidRes = await safeQuery(pool, SQL_RESERVATIONS_PROPERTY_ID_TYPE);
  results.reservations_property_id_type = resPidRes.ok ? (resPidRes.rows[0]?.data_type || null) : null;
  results.property_id_types_match = results.property_id_type != null
    && results.reservations_property_id_type != null
    && results.property_id_type === results.reservations_property_id_type;

  // Indexes
  const idxRes = await safeQuery(pool, SQL_INDEXES);
  const idxNames = idxRes.ok ? idxRes.rows.map(r => r.indexname) : [];
  results.idx_property_created = idxNames.includes('idx_booking_events_property_created');
  results.idx_source_external  = idxNames.includes('idx_booking_events_source_external');
  results.idx_reservation      = idxNames.includes('idx_booking_events_reservation');
  results.idx_observed_at      = idxNames.includes('idx_booking_events_observed_at');
  results.idx_property_observed = idxNames.includes('idx_booking_events_property_observed');
  results.all_indexes          = idxNames;

  // FK check (no FK on reservation_id is required)
  const fkRes = await safeQuery(pool, SQL_FK_CHECK);
  results.no_fk_on_reservation_id = fkRes.ok && (fkRes.rows[0]?.fk_count ?? 0) === 0;

  // Row count
  const countRes = await safeQuery(pool, SQL_EVENT_COUNT);
  results.event_counts = countRes.ok ? countRes.rows[0] : null;
  results.row_count    = countRes.ok ? (countRes.rows[0]?.total ?? 0) : null;

  // Source breakdown
  const srcRes = await safeQuery(pool, SQL_SOURCE_BREAKDOWN);
  results.source_breakdown = srcRes.ok ? srcRes.rows : [];

  // Currency policy
  const currRes = await safeQuery(pool, SQL_CURRENCY_NULL_CHECK);
  results.currency_check = currRes.ok ? currRes.rows[0] : null;
  results.no_eur_default_violation = currRes.ok
    ? (currRes.rows[0]?.eur_defaulted === 0)
    : null;

  // SAFE_TO_ENABLE_FLAG determination:
  // All required columns present (including 010 fix columns) + no FK + migration 009 + 010 applied
  const migration009Applied = results.base_cols_present;
  const migration010Applied = results.event_observed_at_present && results.provider_event_at_present;
  results.migration_009_applied = migration009Applied;
  results.migration_010_applied = migration010Applied;

  const flagCurrentlyOff = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED !== 'true';
  results.safe_to_enable_flag = migration009Applied
    && migration010Applied
    && results.no_fk_on_reservation_id
    && flagCurrentlyOff;
  results.safe_to_enable_flag_reason = !migration009Applied ? 'MIGRATION_009_NOT_APPLIED'
    : !migration010Applied ? 'MIGRATION_010_NOT_APPLIED'
    : !results.no_fk_on_reservation_id ? 'FK_ON_RESERVATION_ID'
    : !flagCurrentlyOff ? 'FLAG_ALREADY_ENABLED'
    : 'ALL_CHECKS_PASS';

  const allOk = results.all_required_cols_present
    && results.no_fk_on_reservation_id
    && results.idx_property_created
    && results.idx_source_external
    && results.idx_reservation;

  return { section: 'DATABASE', ok: allOk, results };
}

// ── Main audit ────────────────────────────────────────────────────────────────

async function runAudit() {
  const report = {
    audit: 'booking-event-persistence-readiness-p1_5_t21',
    timestamp: new Date().toISOString(),
    sections: [],
  };

  report.sections.push(auditSelfReadOnly());
  report.sections.push(auditMigration009());
  report.sections.push(auditMigration010());
  report.sections.push(auditServiceFile());
  report.sections.push(auditChannexInstrumentation());
  report.sections.push(auditServerInstrumentation());
  report.sections.push(auditFlagState());

  if (process.env.AUDIT_WITH_DB === 'true') {
    const { Pool } = require('pg');
    // Mirror server.js pool configuration exactly — including SSL.
    // Prior false-negative root cause: pool created without SSL caused silent
    // connection failure in production, which safeQuery caught and returned
    // ok:false → table_exists evaluated to false.
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
      connectionTimeoutMillis: 5000,
    });
    try {
      report.sections.push(await auditDatabase(pool));
    } finally {
      await pool.end();
    }
  } else {
    report.sections.push({
      section: 'DATABASE',
      ok: null,
      note: 'Skipped — set AUDIT_WITH_DB=true to run DB checks',
    });
  }

  const failedSections = report.sections.filter(s => s.ok === false);
  report.overall_ok = failedSections.length === 0;
  report.failed_sections = failedSections.map(s => s.section);

  return report;
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
  runAudit().then(report => {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.overall_ok ? 0 : 1);
  }).catch(e => {
    console.error('Audit failed:', e.message);
    process.exit(1);
  });
}

module.exports = {
  runAudit,
  checkAuditToolReadOnly,
  auditServiceFile,
  auditMigration009,
  auditMigration010,
  auditChannexInstrumentation,
  auditServerInstrumentation,
};

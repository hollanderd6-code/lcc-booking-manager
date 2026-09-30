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
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ── SQL queries (SELECT-only) ──────────────────────────────────────────────────
const SQL_TABLE_EXISTS = `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'booking_events'
`;
const SQL_COLUMNS = `
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'booking_events'
  ORDER BY ordinal_position
`;
const SQL_INDEXES = `
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'booking_events'
  ORDER BY indexname
`;
const SQL_EVENT_COUNT = `
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE event_type = 'BOOKING_CREATED')::int AS created,
         COUNT(*) FILTER (WHERE event_type = 'BOOKING_MODIFIED')::int AS modified,
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
  SELECT tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_name = 'booking_events'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'reservation_id'
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
    results.exports_recordBookingEvent     = checkFileContains('services/booking-event-persistence.js', 'recordBookingEvent');
    results.exports_computeStateFingerprint = checkFileContains('services/booking-event-persistence.js', 'computeStateFingerprint');
    results.exports_normalizeSource        = checkFileContains('services/booking-event-persistence.js', 'normalizeSource');
    results.has_feature_flag               = checkFileContains('services/booking-event-persistence.js', 'BOOKING_EVENT_PERSISTENCE_ENABLED');
    results.has_timeout                    = checkFileContains('services/booking-event-persistence.js', 'BOOKING_EVENT_DB_TIMEOUT_MS');
    results.has_fail_open                  = checkFileContains('services/booking-event-persistence.js', 'BOOKING_EVENT_FAILURE_BLOCKS_RESERVATIONS = NO');
    results.no_eur_default                 = !checkFileContains('services/booking-event-persistence.js', "|| 'EUR'");
    results.append_only_comment           = checkFileContains('services/booking-event-persistence.js', 'APPEND-ONLY');
  }
  return { section: 'SERVICE_FILE', ok: exists && Object.values(results).every(Boolean), results };
}

function auditMigrationFile() {
  const exists = checkFileExists('migrations/009_booking_events.sql');
  const results = { exists };
  if (exists) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations/009_booking_events.sql'), 'utf8');
    results.has_create_table      = /CREATE TABLE IF NOT EXISTS booking_events/i.test(sql);
    results.has_no_fk_reservation = !(/FOREIGN KEY.*reservation_id/i.test(sql));
    results.has_event_type_col    = sql.includes('event_type');
    results.has_source_col        = sql.includes('source');
    results.has_state_fingerprint = sql.includes('state_fingerprint');
    results.has_currency_col      = sql.includes('currency');
    results.has_schema_version    = sql.includes('schema_version');
    results.has_idx_property      = sql.includes('idx_booking_events_property_created');
    results.has_idx_source        = sql.includes('idx_booking_events_source_external');
    results.has_idx_reservation   = sql.includes('idx_booking_events_reservation');
    results.no_drop_table         = !/DROP TABLE/i.test(sql);
    results.no_insert             = !/\bINSERT\b/i.test(sql);
  }
  return { section: 'MIGRATION_FILE', ok: exists && Object.values(results).every(Boolean), results };
}

function auditChannexInstrumentation() {
  const exists = checkFileExists('channex.js');
  const results = { exists };
  if (exists) {
    results.require_service             = checkFileContains('channex.js', "require('./services/booking-event-persistence')");
    results.w01_created                 = checkFileContains('channex.js', "context: 'channex W-01'");
    results.w02_modified                = checkFileContains('channex.js', "context: 'channex W-02'");
    results.w02_before_fingerprint      = checkFileContains('channex.js', '_w02BeforeFp');
    results.w03_cancelled_db            = checkFileContains('channex.js', "context: 'channex W-03'");
    results.w03_cancelled_orphan        = checkFileContains('channex.js', "context: 'channex W-03 orphan'");
    results.provider_provenance_w01     = checkFileContains('channex.js', /currencyProvenance: 'provider'[\s\S]{0,200}context: 'channex W-01'/);
    results.provider_provenance_w02     = checkFileContains('channex.js', /currencyProvenance: 'provider'[\s\S]{0,200}context: 'channex W-02'/);
    results.reservation_record_w03      = checkFileContains('channex.js', /currencyProvenance: 'reservation_record'[\s\S]{0,200}context: 'channex W-03'/);
    results.unknown_provenance_w03_orphan = checkFileContains('channex.js', /currencyProvenance: 'unknown'[\s\S]{0,200}context: 'channex W-03 orphan'/);
  }
  return { section: 'CHANNEX_INSTRUMENTATION', ok: exists && Object.values(results).every(Boolean), results };
}

function auditServerInstrumentation() {
  const exists = checkFileExists('server.js');
  const results = { exists };
  if (exists) {
    results.require_service     = checkFileContains('server.js', "require('./services/booking-event-persistence')");
    results.w04_cancelled       = checkFileContains('server.js', "context: 'server W-04 declined'");
    results.w07_created         = checkFileContains('server.js', "context: 'server W-07'");
    results.w08_created         = checkFileContains('server.js', "context: 'server W-08 deferred'");
    results.w09_created         = checkFileContains('server.js', "context: 'server W-09'");
    results.w10_deferred        = checkFileContains('server.js', "context: 'server W-10 deferred'");
    results.w10_non_deferred    = checkFileContains('server.js', "context: 'server W-10'");
    results.w11_host_cancel     = checkFileContains('server.js', "context: 'server W-11 host-cancel'");
    results.w12_system_cancel   = checkFileContains('server.js', "context: 'server W-12 system-cancel'");
    results.w09_provider_prov   = checkFileContains('server.js', /currencyProvenance: 'provider'[\s\S]{0,200}context: 'server W-09'/);
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

async function auditDatabase(pool) {
  const results = {};

  const tableRes = await safeQuery(pool, SQL_TABLE_EXISTS);
  results.table_exists = tableRes.ok && tableRes.rows.length > 0;

  if (!results.table_exists) {
    return { section: 'DATABASE', ok: false, results, note: 'booking_events table not found — migration 009 not applied' };
  }

  const colRes = await safeQuery(pool, SQL_COLUMNS);
  const cols = colRes.rows.map(r => r.column_name);
  const REQUIRED_COLS = [
    'id', 'created_at', 'event_type', 'event_category', 'source',
    'external_booking_id', 'property_id', 'reservation_id',
    'state_fingerprint', 'before_fingerprint', 'start_date', 'end_date',
    'status', 'guest_count', 'amount_total', 'amount_rooms',
    'currency', 'currency_provenance', 'provider_event_id', 'schema_version',
  ];
  results.required_columns_present = REQUIRED_COLS.every(c => cols.includes(c));
  results.missing_columns = REQUIRED_COLS.filter(c => !cols.includes(c));

  const idxRes = await safeQuery(pool, SQL_INDEXES);
  const idxNames = idxRes.rows.map(r => r.indexname);
  results.idx_property_created = idxNames.includes('idx_booking_events_property_created');
  results.idx_source_external  = idxNames.includes('idx_booking_events_source_external');
  results.idx_reservation      = idxNames.includes('idx_booking_events_reservation');

  const fkRes = await safeQuery(pool, SQL_FK_CHECK);
  results.no_fk_on_reservation_id = fkRes.ok && fkRes.rows.length === 0;

  const countRes = await safeQuery(pool, SQL_EVENT_COUNT);
  results.event_counts = countRes.ok ? countRes.rows[0] : null;

  const srcRes = await safeQuery(pool, SQL_SOURCE_BREAKDOWN);
  results.source_breakdown = srcRes.ok ? srcRes.rows : [];

  const currRes = await safeQuery(pool, SQL_CURRENCY_NULL_CHECK);
  results.currency_check = currRes.ok ? currRes.rows[0] : null;
  if (results.currency_check) {
    results.no_eur_default_violation = results.currency_check.eur_defaulted === 0;
  }

  const allOk = results.required_columns_present
    && results.no_fk_on_reservation_id
    && results.idx_property_created
    && results.idx_source_external
    && results.idx_reservation
    && (results.no_eur_default_violation !== false);

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
  report.sections.push(auditMigrationFile());
  report.sections.push(auditServiceFile());
  report.sections.push(auditChannexInstrumentation());
  report.sections.push(auditServerInstrumentation());
  report.sections.push(auditFlagState());

  if (process.env.AUDIT_WITH_DB === 'true') {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

module.exports = { runAudit, checkAuditToolReadOnly, auditServiceFile, auditMigrationFile, auditChannexInstrumentation, auditServerInstrumentation };

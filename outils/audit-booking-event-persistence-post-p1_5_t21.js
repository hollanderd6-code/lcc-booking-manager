#!/usr/bin/env node
'use strict';
/**
 * audit-booking-event-persistence-post-p1_5_t21.js
 *
 * Post-activation audit for P1.5-T2.1 — Immutable Booking Events.
 * Run AFTER enabling BOOKING_EVENT_PERSISTENCE_ENABLED to verify
 * data quality, dedup integrity, and safety invariants.
 *
 * Usage:
 *   AUDIT_WITH_DB=true node outils/audit-booking-event-persistence-post-p1_5_t21.js
 *
 * READ-ONLY: Performs only SELECT queries. Never writes to any table.
 *
 * P1.5-T2.1-PREACT-FIX:
 *   Table detection uses pg_catalog (not information_schema) — bypasses privilege
 *   visibility constraints. Pool mirrors server.js SSL config for production.
 *   Temporal ordering uses event_observed_at (the canonical BH observation time),
 *   not created_at (DB row insertion time).
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ── SQL queries (SELECT-only) ──────────────────────────────────────────────────
// pg_catalog bypasses information_schema privilege visibility constraints —
// the root cause of prior false-negative table detection in production.
const SQL_TABLE_EXISTS_PG = `
  SELECT COUNT(*)::int AS cnt
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'booking_events'
    AND n.nspname = 'public'
    AND c.relkind = 'r'
`;
const SQL_TOTAL_EVENTS = `
  SELECT COUNT(*)::int AS total FROM booking_events
`;
const SQL_BY_TYPE = `
  SELECT event_type, COUNT(*)::int AS cnt
  FROM booking_events
  GROUP BY event_type ORDER BY event_type
`;
const SQL_BY_SOURCE = `
  SELECT source, event_type, COUNT(*)::int AS cnt
  FROM booking_events
  GROUP BY source, event_type ORDER BY source, event_type
`;
const SQL_CREATED_DUPES = `
  SELECT source, external_booking_id, COUNT(*)::int AS cnt
  FROM booking_events
  WHERE event_type = 'BOOKING_CREATED'
  GROUP BY source, external_booking_id
  HAVING COUNT(*) > 1
  LIMIT 20
`;
// Temporal ordering uses event_observed_at — the canonical BH observation time.
// event_observed_at: when BH observed/knew the event. Distinct from created_at
// (DB insertion time). For analysis correctness, always order by event_observed_at.
const SQL_DOUBLE_CANCEL = `
  SELECT source, external_booking_id,
         ARRAY_AGG(event_type ORDER BY event_observed_at) AS event_sequence
  FROM booking_events
  WHERE event_type = 'BOOKING_CANCELLED'
  GROUP BY source, external_booking_id
  HAVING COUNT(*) > 1
  LIMIT 20
`;
const SQL_EUR_DEFAULT = `
  SELECT COUNT(*)::int AS cnt
  FROM booking_events
  WHERE currency = 'EUR' AND currency_provenance = 'unknown'
`;
const SQL_NULL_PROPERTY = `
  SELECT COUNT(*)::int AS cnt
  FROM booking_events
  WHERE property_id IS NULL
`;
const SQL_FINGERPRINT_FORMAT = `
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE state_fingerprint IS NULL)::int AS null_fp,
         COUNT(*) FILTER (WHERE state_fingerprint NOT LIKE '%|%')::int AS malformed_fp
  FROM booking_events
`;
const SQL_ORPHAN_CANCELLATIONS = `
  SELECT COUNT(*)::int AS cnt
  FROM booking_events
  WHERE event_type = 'BOOKING_CANCELLED' AND reservation_id IS NULL
`;
// FK check via pg_catalog — does not depend on information_schema visibility.
const SQL_FK_SAFETY_PG = `
  SELECT COUNT(*)::int AS tc
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
// Schema contract check: new columns from migration 010.
const SQL_NEW_COLS_CHECK = `
  SELECT a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS not_null
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'booking_events'
    AND n.nspname = 'public'
    AND a.attname IN ('event_observed_at', 'provider_event_at')
    AND NOT a.attisdropped
`;
// Check that all rows have event_observed_at populated (should never be null
// given NOT NULL DEFAULT NOW(), but verify post-activation).
const SQL_OBSERVED_AT_NULL_COUNT = `
  SELECT COUNT(*) FILTER (WHERE event_observed_at IS NULL)::int AS null_observed_at
  FROM booking_events
`;
// Temporal skew: verify event_observed_at and created_at are near-equal (< 60s).
// Large skew would indicate event_observed_at is being set from an unexpected source.
const SQL_TEMPORAL_SKEW = `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (
      WHERE ABS(EXTRACT(EPOCH FROM (event_observed_at - created_at))) > 60
    )::int AS large_skew_count,
    MAX(ABS(EXTRACT(EPOCH FROM (event_observed_at - created_at))))::int AS max_skew_seconds
  FROM booking_events
`;
// Recent events ordered by event_observed_at (canonical temporal field).
// Includes both event_observed_at and created_at for skew visibility.
const SQL_RECENT_EVENTS = `
  SELECT id, event_observed_at, created_at, event_type, source, external_booking_id,
         property_id, reservation_id, currency, currency_provenance, schema_version
  FROM booking_events
  ORDER BY event_observed_at DESC
  LIMIT 10
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

// ── Audit sections ────────────────────────────────────────────────────────────

async function checkTableExists(pool) {
  const res = await safeQuery(pool, SQL_TABLE_EXISTS_PG);
  return res.ok && (res.rows[0]?.cnt ?? 0) > 0;
}

async function auditEventCounts(pool) {
  const total  = await safeQuery(pool, SQL_TOTAL_EVENTS);
  const byType = await safeQuery(pool, SQL_BY_TYPE);
  const bySrc  = await safeQuery(pool, SQL_BY_SOURCE);
  return {
    section: 'EVENT_COUNTS',
    ok: total.ok && byType.ok,
    total: total.ok ? total.rows[0]?.total : null,
    by_type: byType.ok ? byType.rows : [],
    by_source: bySrc.ok ? bySrc.rows : [],
  };
}

async function auditDedup(pool) {
  const dupCreated = await safeQuery(pool, SQL_CREATED_DUPES);
  const dupCancel  = await safeQuery(pool, SQL_DOUBLE_CANCEL);
  const createdDupes  = dupCreated.ok ? dupCreated.rows : [];
  const cancelDupes   = dupCancel.ok  ? dupCancel.rows  : [];
  return {
    section: 'DEDUP_INTEGRITY',
    ok: createdDupes.length === 0,
    created_duplicates: createdDupes,
    note_double_cancel: 'Double cancellations shown for review — A→B→A reinstates can produce multiple entries',
    double_cancel_samples: cancelDupes,
  };
}

async function auditCurrencyPolicy(pool) {
  const eurDefault  = await safeQuery(pool, SQL_EUR_DEFAULT);
  const nullProp    = await safeQuery(pool, SQL_NULL_PROPERTY);
  const eurCount    = eurDefault.ok ? (eurDefault.rows[0]?.cnt ?? 0) : null;
  const nullPropCnt = nullProp.ok   ? (nullProp.rows[0]?.cnt ?? 0)   : null;
  return {
    section: 'CURRENCY_POLICY',
    ok: eurCount === 0 && nullPropCnt === 0,
    eur_defaulted_count: eurCount,
    null_property_id_count: nullPropCnt,
  };
}

async function auditFingerprintQuality(pool) {
  const fpRes = await safeQuery(pool, SQL_FINGERPRINT_FORMAT);
  const row   = fpRes.ok ? fpRes.rows[0] : null;
  return {
    section: 'FINGERPRINT_QUALITY',
    ok: fpRes.ok && row && row.malformed_fp === 0,
    total: row?.total ?? null,
    null_fingerprints: row?.null_fp ?? null,
    malformed_fingerprints: row?.malformed_fp ?? null,
  };
}

async function auditOrphanCancellations(pool) {
  const res = await safeQuery(pool, SQL_ORPHAN_CANCELLATIONS);
  const cnt = res.ok ? (res.rows[0]?.cnt ?? 0) : null;
  return {
    section: 'ORPHAN_CANCELLATIONS',
    ok: true,
    count: cnt,
    note: 'Orphan cancellations (reservation_id=null) are expected for Channex W-03 orphan path',
  };
}

async function auditFkSafety(pool) {
  const res = await safeQuery(pool, SQL_FK_SAFETY_PG);
  const cnt = res.ok ? (res.rows[0]?.tc ?? 0) : null;
  return {
    section: 'FK_SAFETY',
    ok: cnt === 0,
    fk_count_on_reservation_id: cnt,
    note: cnt === 0
      ? '✅ No FK on reservation_id — cascade deletes cannot write booking_events'
      : '❌ FK found on reservation_id — violates append-only safety contract',
  };
}

async function auditSchemaContract(pool) {
  const colRes = await safeQuery(pool, SQL_NEW_COLS_CHECK);
  const cols   = colRes.ok ? colRes.rows : [];
  const colMap = Object.fromEntries(cols.map(r => [r.column_name, r]));

  const obsAtPresent   = 'event_observed_at' in colMap;
  const provAtPresent  = 'provider_event_at' in colMap;
  const obsAtNotNull   = obsAtPresent && colMap['event_observed_at'].not_null === true;
  const provAtNullable = provAtPresent && colMap['provider_event_at'].not_null === false;

  const nullCountRes   = await safeQuery(pool, SQL_OBSERVED_AT_NULL_COUNT);
  const nullObsAt      = nullCountRes.ok ? (nullCountRes.rows[0]?.null_observed_at ?? null) : null;

  const skewRes        = await safeQuery(pool, SQL_TEMPORAL_SKEW);
  const skew           = skewRes.ok ? skewRes.rows[0] : null;

  const ok = obsAtPresent && provAtPresent && obsAtNotNull && provAtNullable
    && nullObsAt === 0;

  return {
    section: 'SCHEMA_CONTRACT',
    ok,
    event_observed_at_present: obsAtPresent,
    event_observed_at_not_null: obsAtNotNull,
    provider_event_at_present: provAtPresent,
    provider_event_at_nullable: provAtNullable,
    booking_created_at_absent: !colMap['booking_created_at'],
    null_event_observed_at_rows: nullObsAt,
    temporal_skew: skew,
    note: !obsAtPresent
      ? '❌ event_observed_at column missing — apply migration 010 before enabling flag'
      : !provAtPresent
      ? '❌ provider_event_at column missing — apply migration 010 before enabling flag'
      : nullObsAt > 0
      ? `❌ ${nullObsAt} rows have NULL event_observed_at`
      : '✅ Schema contract satisfied — migration 010 applied and columns populated',
  };
}

async function auditRecentEvents(pool) {
  const res = await safeQuery(pool, SQL_RECENT_EVENTS);
  return {
    section: 'RECENT_EVENTS',
    ok: true,
    recent_10: res.ok ? res.rows : [],
  };
}

// ── Main audit ────────────────────────────────────────────────────────────────

async function runPostAudit() {
  if (process.env.AUDIT_WITH_DB !== 'true') {
    console.error('ERROR: AUDIT_WITH_DB=true is required for post-activation audit');
    process.exit(1);
  }

  const { Pool } = require('pg');
  // Mirror server.js pool configuration exactly — including SSL.
  // Prior false-negative root cause: pool without SSL → silent connection failure
  // in production → safeQuery returned ok:false → table_exists false.
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 5000,
  });

  const report = {
    audit: 'booking-event-persistence-post-p1_5_t21',
    timestamp: new Date().toISOString(),
    flag_enabled: process.env.BOOKING_EVENT_PERSISTENCE_ENABLED === 'true',
    sections: [],
  };

  try {
    const tableExists = await checkTableExists(pool);
    if (!tableExists) {
      report.sections.push({
        section: 'TABLE_CHECK',
        ok: false,
        error: 'booking_events table not found — migration 009 not applied',
      });
      report.overall_ok = false;
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }

    report.sections.push(await auditSchemaContract(pool));
    report.sections.push(await auditEventCounts(pool));
    report.sections.push(await auditDedup(pool));
    report.sections.push(await auditCurrencyPolicy(pool));
    report.sections.push(await auditFingerprintQuality(pool));
    report.sections.push(await auditOrphanCancellations(pool));
    report.sections.push(await auditFkSafety(pool));
    report.sections.push(await auditRecentEvents(pool));
  } finally {
    await pool.end();
  }

  const failedSections = report.sections.filter(s => s.ok === false);
  report.overall_ok = failedSections.length === 0;
  report.failed_sections = failedSections.map(s => s.section);

  return report;
}

if (require.main === module) {
  runPostAudit().then(report => {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.overall_ok ? 0 : 1);
  }).catch(e => {
    console.error('Post-audit failed:', e.message);
    process.exit(1);
  });
}

module.exports = { runPostAudit, auditSchemaContract };

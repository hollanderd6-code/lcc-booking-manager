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
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// ── SQL queries (SELECT-only) ──────────────────────────────────────────────────
const SQL_TABLE_EXISTS = `
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'booking_events'
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
const SQL_DOUBLE_CANCEL = `
  SELECT source, external_booking_id,
         ARRAY_AGG(event_type ORDER BY created_at) AS event_sequence
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
const SQL_FK_SAFETY = `
  SELECT COUNT(*)::int AS tc
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_name = 'booking_events'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'reservation_id'
`;
const SQL_RECENT_EVENTS = `
  SELECT id, created_at, event_type, source, external_booking_id, property_id,
         reservation_id, currency, currency_provenance, schema_version
  FROM booking_events
  ORDER BY created_at DESC
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
  const res = await safeQuery(pool, SQL_TABLE_EXISTS);
  return res.ok && res.rows.length > 0;
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
  const res = await safeQuery(pool, SQL_FK_SAFETY);
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
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

module.exports = { runPostAudit };

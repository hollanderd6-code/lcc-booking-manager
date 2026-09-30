'use strict';
/**
 * P1.3-T0 — Booking Pickup Intelligence / Data Readiness Audit (READ ONLY)
 *
 * PURPOSE:
 *   Determine whether the `reservations` table has enough reliable booking
 *   timestamp data to support a future pickup-velocity signal for dynamic pricing.
 *
 * WHAT IT MEASURES:
 *   1. Source-reliability classification: which sources have trustworthy created_at
 *   2. Lead-time distribution per property (p25/median/p75/p90 days)
 *   3. Data coverage: # reliable confirmed bookings per property in the look-back window
 *   4. Pickup readiness verdict per property (READY / INSUFFICIENT / NO_RELIABLE_DATA)
 *   5. Existing pacing signal characterisation (occupancy-position, not velocity)
 *   6. Shadow pickup signal design (spec only — nothing integrated into pricing)
 *
 * WHAT IT DOES NOT DO:
 *   - Modify pricing — no pricing writes
 *   - Write to any table — all queries are SELECT only
 *   - Call Channex, Bright Data, Apify, or any external API
 *   - Print any PII (no guest names, emails, or phone numbers)
 *   - Install a pickup multiplier — the signal is designed and audited only
 *
 * SAFETY:
 *   PRICING_WRITES         = 0  always
 *   DB_WRITES              = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_PROVIDER_CALLS  = 0  always
 *   NETWORK_CALLS          = 0  always
 *
 * `created_at` SEMANTICS BY SOURCE:
 *   channex   → DB NOW() at webhook arrival (≈ OTA booking time, within seconds)
 *               RELIABLE for pickup velocity — proxy for actual booking instant
 *   guest_app → DB NOW() at Stripe payment confirmation
 *               RELIABLE — payment is the booking event
 *   ical      → DB NOW() at iCal sync run time
 *               UNRELIABLE — sync runs on a schedule, not at booking time;
 *               created_at can be days or weeks after the actual guest booking
 *   BLOCK     → DB NOW() at block creation (operator action, not a booking)
 *               EXCLUDED — not a guest booking
 *   MANUEL / manual / DIRECT / direct → DB NOW() at operator entry time
 *               UNRELIABLE — entry time ≠ booking time
 *
 * EXISTING PACING SIGNAL (routes/pricing-engine.js pacingMult):
 *   Measures OCCUPANCY POSITION: how full is the ±12-day window vs a static curve.
 *   This is NOT booking velocity — it does not use created_at at all.
 *   Pickup velocity is orthogonal new information: "how fast are bookings arriving
 *   relative to this property's own baseline behaviour."
 *
 * SHADOW PICKUP SIGNAL DESIGN (T0 specification):
 *   Input:     confirmed reservations with source IN ('channex','guest_app')
 *              in the last LOOKBACK_MONTHS months
 *   Lead time: EXTRACT(DAY FROM (start_date::date - created_at::date))
 *              clamped to [0, 365]; negative values flagged (data quality issue)
 *   Buckets:   [0,7), [7,14), [14,30), [30,60), [60,90), [90+)
 *   Signal:    current booking rate per bucket vs property's historical baseline
 *   Output:    pickup_mult ∈ [0.88, 1.12] (advisory; not integrated yet)
 *   Gate:      property must have MIN_RELIABLE_BOOKINGS in the look-back window
 *   Integration: NONE in T0 — signal is designed + audited only
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-booking-pickup-readiness-t.js
 *   NODE_ENV=production node outils/audit-booking-pickup-readiness-t.js --verbose
 */

const { createPool } = require('../services/db-pool');

// ── Constants ────────────────────────────────────────────────────────────────

const LOOKBACK_MONTHS = 12;
const MIN_RELIABLE_BOOKINGS = 10;
const LEAD_TIME_BUCKETS = [0, 7, 14, 30, 60, 90, Infinity];

const VERBOSE = process.argv.includes('--verbose');

// Sources where created_at reliably reflects the booking instant
const RELIABLE_SOURCES = ['channex', 'guest_app'];

// Sources explicitly excluded from pickup analysis
const EXCLUDED_SOURCES = ['BLOCK'];

// ── SQL — exported for test inspection ───────────────────────────────────────

/**
 * Per-property booking statistics from reliable sources only.
 * Returns one row per property × source combination.
 *
 * SAFETY: SELECT only — no writes, no network.
 *
 * Column authority:
 *   created_at → reservations.created_at (DB insertion time — semantic varies by source)
 *   start_date → reservations.start_date (check-in date)
 *   source     → reservations.source     (ingestion path)
 *   status     → reservations.status     (confirmed / cancelled)
 */
const RELIABLE_BOOKINGS_SQL = `
  SELECT
    r.property_id,
    r.source,
    COUNT(*)                                                       AS total_count,
    COUNT(*) FILTER (WHERE r.status = 'confirmed')                AS confirmed_count,
    COUNT(*) FILTER (WHERE r.status = 'cancelled')                AS cancelled_count,
    PERCENTILE_CONT(0.25) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (r.start_date::date - r.created_at::date)) / 86400
    ) FILTER (
      WHERE r.status = 'confirmed'
        AND r.start_date::date >= r.created_at::date
    )                                                              AS lead_time_p25,
    PERCENTILE_CONT(0.5)  WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (r.start_date::date - r.created_at::date)) / 86400
    ) FILTER (
      WHERE r.status = 'confirmed'
        AND r.start_date::date >= r.created_at::date
    )                                                              AS lead_time_p50,
    PERCENTILE_CONT(0.75) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (r.start_date::date - r.created_at::date)) / 86400
    ) FILTER (
      WHERE r.status = 'confirmed'
        AND r.start_date::date >= r.created_at::date
    )                                                              AS lead_time_p75,
    PERCENTILE_CONT(0.9)  WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (r.start_date::date - r.created_at::date)) / 86400
    ) FILTER (
      WHERE r.status = 'confirmed'
        AND r.start_date::date >= r.created_at::date
    )                                                              AS lead_time_p90,
    COUNT(*) FILTER (
      WHERE r.status = 'confirmed'
        AND r.start_date::date < r.created_at::date
    )                                                              AS negative_lead_count
  FROM reservations r
  WHERE r.source = ANY($1)
    AND r.created_at >= NOW() - ($2 || ' months')::INTERVAL
  GROUP BY r.property_id, r.source
  ORDER BY r.property_id, r.source
`;

/**
 * Per-property unreliable source summary (ical, manual, DIRECT).
 * Counts only — no lead time (created_at is import time, not booking time).
 */
const UNRELIABLE_BOOKINGS_SQL = `
  SELECT
    r.property_id,
    r.source,
    COUNT(*)                                             AS total_count,
    COUNT(*) FILTER (WHERE r.status = 'confirmed')      AS confirmed_count
  FROM reservations r
  WHERE r.source NOT IN ('channex', 'guest_app', 'BLOCK')
    AND r.created_at >= NOW() - ($1 || ' months')::INTERVAL
  GROUP BY r.property_id, r.source
  ORDER BY r.property_id, r.source
`;

/**
 * Active BoostPrice properties — join pricing_config with properties.
 * Only IS_ACTIVE configs (those processed by the pricing cron).
 */
const ACTIVE_PROPERTIES_SQL = `
  SELECT
    p.id,
    p.internal_name,
    p.name
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

/**
 * Lead-time bucket distribution for reliable confirmed bookings.
 * Used for the shadow pickup signal design histogram.
 */
const LEAD_TIME_HISTOGRAM_SQL = `
  SELECT
    r.property_id,
    CASE
      WHEN ld < 0   THEN 'negative'
      WHEN ld < 7   THEN '0_6'
      WHEN ld < 14  THEN '7_13'
      WHEN ld < 30  THEN '14_29'
      WHEN ld < 60  THEN '30_59'
      WHEN ld < 90  THEN '60_89'
      ELSE               '90plus'
    END                  AS bucket,
    COUNT(*)             AS cnt
  FROM (
    SELECT
      r.property_id,
      ROUND(EXTRACT(EPOCH FROM (r.start_date::date - r.created_at::date)) / 86400)::int AS ld
    FROM reservations r
    WHERE r.source = ANY($1)
      AND r.status = 'confirmed'
      AND r.created_at >= NOW() - ($2 || ' months')::INTERVAL
  ) sub
  GROUP BY r.property_id, bucket
  ORDER BY r.property_id, bucket
`;

// ── Pure helpers — no DB, no I/O ──────────────────────────────────────────────

/**
 * Determine per-property pickup readiness based on reliable confirmed booking count.
 *
 * @param {number} reliableConfirmed
 * @param {number} [minRequired=MIN_RELIABLE_BOOKINGS]
 * @returns {'READY'|'INSUFFICIENT'|'NO_RELIABLE_DATA'}
 */
function classifyPickupReadiness(reliableConfirmed, minRequired) {
  const threshold = (minRequired != null) ? minRequired : MIN_RELIABLE_BOOKINGS;
  if (!Number.isFinite(reliableConfirmed) || reliableConfirmed < 0) return 'NO_RELIABLE_DATA';
  if (reliableConfirmed === 0) return 'NO_RELIABLE_DATA';
  if (reliableConfirmed < threshold) return 'INSUFFICIENT';
  return 'READY';
}

/**
 * Determine if a source's created_at is reliable for pickup velocity.
 *
 * @param {string} source
 * @returns {'RELIABLE'|'UNRELIABLE'|'EXCLUDED'}
 */
function classifySource(source) {
  if (!source) return 'UNRELIABLE';
  if (EXCLUDED_SOURCES.includes(source)) return 'EXCLUDED';
  if (RELIABLE_SOURCES.includes(source)) return 'RELIABLE';
  return 'UNRELIABLE';
}

/**
 * Compute lead time from booking creation to check-in.
 * Returns null for invalid inputs. Negative = data quality issue.
 *
 * @param {string|Date} createdAt
 * @param {string|Date} startDate
 * @returns {number|null}  days (can be negative; null if inputs invalid)
 */
function computeLeadTimeDays(createdAt, startDate) {
  if (!createdAt || !startDate) return null;
  const created = new Date(createdAt);
  const start   = new Date(startDate);
  if (isNaN(created.getTime()) || isNaN(start.getTime())) return null;
  // Truncate to date precision (midnight UTC)
  const createdDay = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate());
  const startDay   = Date.UTC(start.getUTCFullYear(),   start.getUTCMonth(),   start.getUTCDate());
  return Math.round((startDay - createdDay) / 86400000);
}

/**
 * Assign a lead-time bucket label.
 *
 * @param {number} days
 * @returns {string}
 */
function leadTimeBucket(days) {
  if (days == null || !Number.isFinite(days)) return 'unknown';
  if (days < 0)   return 'negative';
  if (days < 7)   return '0_6';
  if (days < 14)  return '7_13';
  if (days < 30)  return '14_29';
  if (days < 60)  return '30_59';
  if (days < 90)  return '60_89';
  return '90plus';
}

/**
 * Sanitize a display name — strips everything after '|' or '@',
 * replaces digits with '#', and truncates for output.
 * Used to produce property labels with zero PII.
 *
 * @param {object} prop   — { id, internal_name, name }
 * @returns {string}
 */
function safePropertyLabel(prop) {
  const raw = prop.internal_name || prop.name || '';
  // Keep only non-digit word characters; replace digits with '#'
  const cleaned = raw.replace(/\d/g, '#').slice(0, 40);
  return `prop_${prop.id}${cleaned ? ' (' + cleaned + ')' : ''}`;
}

// ── Main audit ───────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' P1.3-T0 — Booking Pickup Intelligence / Data Readiness Audit');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(` Look-back window : ${LOOKBACK_MONTHS} months`);
  console.log(` Min reliable bookings for READY verdict: ${MIN_RELIABLE_BOOKINGS}`);
  console.log(` Reliable sources: ${RELIABLE_SOURCES.join(', ')}`);
  console.log('');
  console.log(' SAFETY CHECK:');
  console.log('   PRICING_WRITES        = 0');
  console.log('   DB_WRITES             = 0  (SELECT only)');
  console.log('   CHANNEX_CALLS         = 0');
  console.log('   MARKET_PROVIDER_CALLS = 0');
  console.log('   NETWORK_CALLS         = 0');
  console.log('───────────────────────────────────────────────────────────────');

  let activeProps, reliableRows, unreliableRows, histogramRows;

  try {
    const [r1, r2, r3, r4] = await Promise.all([
      pool.query(ACTIVE_PROPERTIES_SQL),
      pool.query(RELIABLE_BOOKINGS_SQL, [RELIABLE_SOURCES, String(LOOKBACK_MONTHS)]),
      pool.query(UNRELIABLE_BOOKINGS_SQL, [String(LOOKBACK_MONTHS)]),
      pool.query(LEAD_TIME_HISTOGRAM_SQL, [RELIABLE_SOURCES, String(LOOKBACK_MONTHS)]),
    ]);
    activeProps    = r1.rows;
    reliableRows   = r2.rows;
    unreliableRows = r3.rows;
    histogramRows  = r4.rows;
  } catch (err) {
    console.error(`[T0_AUDIT_FAILURE] DB query error: ${err.message}`);
    console.error('  → Check DATABASE_URL and that tables exist');
    await pool.end().catch(() => {});
    process.exit(1);
  }

  // ── Index reliable data by property ──────────────────────────────────────
  const byProp = {};
  for (const row of reliableRows) {
    if (!byProp[row.property_id]) byProp[row.property_id] = { sources: {}, totalReliable: 0 };
    byProp[row.property_id].sources[row.source] = row;
    byProp[row.property_id].totalReliable += Number(row.confirmed_count || 0);
  }

  // Index unreliable data
  const unreliableByProp = {};
  for (const row of unreliableRows) {
    if (!unreliableByProp[row.property_id]) unreliableByProp[row.property_id] = {};
    unreliableByProp[row.property_id][row.source] = row;
  }

  // Index histogram
  const histByProp = {};
  for (const row of histogramRows) {
    if (!histByProp[row.property_id]) histByProp[row.property_id] = {};
    histByProp[row.property_id][row.bucket] = Number(row.cnt);
  }

  // ── Source reliability summary ────────────────────────────────────────────
  console.log('');
  console.log('SOURCE RELIABILITY CLASSIFICATION');
  console.log('  channex   → RELIABLE  (webhook receipt ≈ OTA booking time)');
  console.log('  guest_app → RELIABLE  (Stripe payment confirmation ≈ booking time)');
  console.log('  ical      → UNRELIABLE (iCal sync time ≠ booking time)');
  console.log('  BLOCK     → EXCLUDED  (not a guest booking)');
  console.log('  manual/DIRECT/MANUEL → UNRELIABLE (operator entry time ≠ booking time)');

  // ── Per-property readiness ────────────────────────────────────────────────
  console.log('');
  console.log('PER-PROPERTY PICKUP READINESS');
  console.log('─────────────────────────────────────────────────────────────────');

  const verdicts = { READY: 0, INSUFFICIENT: 0, NO_RELIABLE_DATA: 0 };

  for (const prop of activeProps) {
    const pid   = prop.id;
    const label = safePropertyLabel(prop);
    const data  = byProp[pid] || { sources: {}, totalReliable: 0 };
    const verdict = classifyPickupReadiness(data.totalReliable);
    verdicts[verdict]++;

    const chxRow  = data.sources['channex'];
    const guestRow = data.sources['guest_app'];
    const chxConf  = Number(chxRow?.confirmed_count   || 0);
    const guestConf = Number(guestRow?.confirmed_count || 0);

    const icalRow   = unreliableByProp[pid]?.['ical'];
    const icalConf  = Number(icalRow?.confirmed_count || 0);

    const p25 = chxRow?.lead_time_p25 != null ? Number(chxRow.lead_time_p25).toFixed(0) : '—';
    const p50 = chxRow?.lead_time_p50 != null ? Number(chxRow.lead_time_p50).toFixed(0) : '—';
    const p75 = chxRow?.lead_time_p75 != null ? Number(chxRow.lead_time_p75).toFixed(0) : '—';
    const p90 = chxRow?.lead_time_p90 != null ? Number(chxRow.lead_time_p90).toFixed(0) : '—';

    const negCount = Number(chxRow?.negative_lead_count || 0) + Number(guestRow?.negative_lead_count || 0);

    const hist = histByProp[pid] || {};

    console.log(`  ${label}`);
    console.log(`    Verdict            : ${verdict}`);
    console.log(`    Reliable confirmed : ${data.totalReliable} (channex=${chxConf}, guest_app=${guestConf})`);
    console.log(`    Unreliable (ical)  : ${icalConf} confirmed — excluded from velocity (sync timestamp)`);
    if (data.totalReliable > 0) {
      console.log(`    Lead time (days)   : p25=${p25} p50=${p50} p75=${p75} p90=${p90}`);
      console.log(`    Negative lead times: ${negCount} (data quality flag)`);
      if (VERBOSE) {
        const buckets = ['negative','0_6','7_13','14_29','30_59','60_89','90plus'];
        const histStr = buckets.map(b => `${b}:${hist[b]||0}`).join(' ');
        console.log(`    Lead-time histogram: ${histStr}`);
      }
    }
    console.log('');
  }

  // ── Properties NOT in pricing_config (no active BoostPrice) ─────────────
  const activePropIds = new Set(activeProps.map(p => String(p.id)));
  const unknownPropIds = [...new Set([
    ...Object.keys(byProp),
    ...Object.keys(unreliableByProp),
  ])].filter(pid => !activePropIds.has(pid));

  if (unknownPropIds.length > 0) {
    console.log('PROPERTIES WITH RESERVATIONS BUT NO ACTIVE BOOSTPRICE CONFIG');
    console.log('─────────────────────────────────────────────────────────────────');
    for (const pid of unknownPropIds) {
      const data = byProp[pid];
      const rel  = data ? data.totalReliable : 0;
      console.log(`  prop_${pid} : ${rel} reliable confirmed bookings (no pricing_config)`);
    }
    console.log('');
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(` Active BoostPrice properties  : ${activeProps.length}`);
  console.log(` READY (≥${MIN_RELIABLE_BOOKINGS} reliable confirmed)    : ${verdicts.READY}`);
  console.log(` INSUFFICIENT (<${MIN_RELIABLE_BOOKINGS} reliable)        : ${verdicts.INSUFFICIENT}`);
  console.log(` NO_RELIABLE_DATA               : ${verdicts.NO_RELIABLE_DATA}`);
  console.log('');
  console.log('EXISTING PACING SIGNAL (occupancy-position, NOT pickup velocity):');
  console.log('  routes/pricing-engine.js pacingMult() uses ±12-day window vs static');
  console.log('  idealPickup curve — measures how full the calendar is, not booking rate.');
  console.log('  created_at is NOT used. This signal and pickup velocity are orthogonal.');
  console.log('');
  console.log('SHADOW PICKUP SIGNAL (T0 design — not integrated into pricing):');
  console.log('  Sources  : channex + guest_app only (RELIABLE created_at)');
  console.log('  Lead time: start_date - created_at::date (days, clamped 0–365)');
  console.log('  Gate     : property needs ≥' + MIN_RELIABLE_BOOKINGS + ' confirmed reliable bookings');
  console.log('  Output   : advisory pickup_mult ∈ [0.88, 1.12]');
  console.log('  Status   : DESIGN ONLY — zero pricing integration in T0');
  console.log('');
  if (verdicts.READY === 0 && activeProps.length > 0) {
    console.log('⚠  PICKUP_READINESS_VERDICT = INSUFFICIENT_DATA_GLOBALLY');
    console.log('   No active BoostPrice property has ≥' + MIN_RELIABLE_BOOKINGS + ' reliable bookings.');
    console.log('   Pickup velocity signal cannot be computed with current data.');
  } else if (verdicts.READY > 0) {
    console.log(`✓  PICKUP_READINESS_VERDICT = PARTIAL (${verdicts.READY}/${activeProps.length} properties ready)`);
  }
  console.log('═══════════════════════════════════════════════════════════════');

  await pool.end().catch(() => {});
}

// ── Exports — for test inspection ────────────────────────────────────────────

module.exports = {
  RELIABLE_SOURCES,
  EXCLUDED_SOURCES,
  MIN_RELIABLE_BOOKINGS,
  LOOKBACK_MONTHS,
  LEAD_TIME_BUCKETS,
  RELIABLE_BOOKINGS_SQL,
  UNRELIABLE_BOOKINGS_SQL,
  ACTIVE_PROPERTIES_SQL,
  LEAD_TIME_HISTOGRAM_SQL,
  classifyPickupReadiness,
  classifySource,
  computeLeadTimeDays,
  leadTimeBucket,
  safePropertyLabel,
};

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch(err => {
    console.error(`[T0_AUDIT_FATAL] ${err.message}`);
    process.exit(1);
  });
}

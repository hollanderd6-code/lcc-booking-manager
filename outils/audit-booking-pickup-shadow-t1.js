'use strict';
/**
 * P1.3-T1 — Booking Pickup Shadow Audit
 *
 * READ-ONLY diagnostic.  Runs calculatePickupShadow() for every active
 * BoostPrice property and prints the full shadow observation for each.
 *
 * This tool NEVER:
 *   writes DB rows (even if BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED=true)
 *   calls Channex
 *   calls market data providers (Bright Data, APIFY, Geoapify)
 *   modifies pricing_schedule or pricing_config
 *   triggers the pricing cron
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   NETWORK_CALLS          = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_PROVIDER_CALLS  = 0  always
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-booking-pickup-shadow-t1.js
 *   NODE_ENV=production node outils/audit-booking-pickup-shadow-t1.js --target=2026-11-01
 */

require('dotenv').config();
const { createPool } = require('../services/db-pool');
const {
  calculatePickupShadow,
  TRUSTED_SOURCES,
  RECENT_WINDOW_DAYS,
  TARGET_WINDOW_DAYS,
  ADVISORY_MIN,
  ADVISORY_MAX,
  MIN_EXPECTED_FOR_SIGNAL,
} = require('../services/booking-pickup-shadow');

// ── Configuration ─────────────────────────────────────────────────────────────

const TARGET_DATE_ARG = (process.argv.find(a => a.startsWith('--target=')) || '')
  .replace('--target=', '').trim() || null;

// Default: today + RECENT_WINDOW_DAYS (7), a near-future representative date
function defaultTargetDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + RECENT_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

const ACTIVE_PROPERTIES_SQL = `
  SELECT
    pc.property_id,
    p.internal_name,
    p.name,
    pc.is_active
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function displayName(p) {
  return p.internal_name || p.name || p.property_id;
}

function statusIcon(status) {
  switch (status) {
    case 'ACCELERATING':     return '▲';
    case 'NORMAL':           return '●';
    case 'SLOW':             return '▼';
    case 'LOW_EVIDENCE':     return '~';
    case 'INSUFFICIENT_DATA': return '?';
    default:                 return '·';
  }
}

function confidenceIcon(c) {
  switch (c) {
    case 'GOOD':         return '●●●';
    case 'MODERATE':     return '●●○';
    case 'LOW':          return '●○○';
    case 'INSUFFICIENT': return '○○○';
    default:             return '···';
  }
}

function advisoryLabel(mult) {
  if (mult === 1.00) return ' 1.00 (neutral)';
  if (mult > 1.00)   return `+${((mult - 1) * 100).toFixed(0)}%  (${mult.toFixed(2)})`;
  return `-${((1 - mult) * 100).toFixed(0)}%  (${mult.toFixed(2)})`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const pool = createPool();

  try {
    const targetDate = TARGET_DATE_ARG || defaultTargetDate();

    console.log('');
    console.log('══════════════════════════════════════════════════════════════');
    console.log('  P1.3-T1 — BOOKING PICKUP SHADOW AUDIT');
    console.log('══════════════════════════════════════════════════════════════');
    console.log(`  Target date:     ${targetDate}`);
    console.log(`  Trusted sources: ${TRUSTED_SOURCES.join(', ')}`);
    console.log(`  Recent window:   ${RECENT_WINDOW_DAYS} days`);
    console.log(`  Advisory range:  [${ADVISORY_MIN}, ${ADVISORY_MAX}]`);
    console.log(`  Evidence floor:  expected >= ${MIN_EXPECTED_FOR_SIGNAL} for directional signal`);
    console.log(`  Persistence:     ${process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED === 'true' ? 'ON (disabled in audit)' : 'OFF'}`);
    console.log(`  DB_WRITES=0  CHANNEX_CALLS=0  MARKET_PROVIDER_CALLS=0`);
    console.log('──────────────────────────────────────────────────────────────');

    let props;
    try {
      const res = await pool.query(ACTIVE_PROPERTIES_SQL);
      props = res.rows;
      console.log(`  Active BoostPrice properties: ${props.length}`);
    } catch (err) {
      const isConnErr = /connect|certificate|ssl|tls|auth|econnrefused|timeout/i.test(err.message);
      const errClass  = isConnErr ? 'DATABASE_CONNECTION_FAILURE' : 'QUERY_EXECUTION_FAILURE';
      console.error(`  [${errClass}] ${err.message}`);
      process.exitCode = 1;
      return;
    }

    if (props.length === 0) {
      console.log('  No active BoostPrice properties found. Nothing to report.');
      return;
    }

    console.log('');

    let successCount = 0;
    let errorCount   = 0;

    for (const prop of props) {
      const label = displayName(prop);
      try {
        const obs = await calculatePickupShadow(pool, prop.property_id, targetDate);
        successCount++;

        const icon  = statusIcon(obs.status);
        const cIcon = confidenceIcon(obs.confidence);

        console.log(`  ${icon}  ${label}`);
        console.log(`     property_id:          ${obs.propertyId}`);
        console.log(`     target_date:          ${obs.targetDate}  (lead_time: ${obs.leadTimeDays}d, band: ${obs.leadTimeBand})`);
        console.log(`     history:              ${obs.historicalSampleSize} total, ${obs.comparableSampleSize} comparable (band)`);
        console.log(`     recent_bookings:      ${obs.recentBookings}  expected: ${obs.expectedBookings}`);
        console.log(`     raw_pickup_ratio:     ${obs.rawPickupRatio !== null ? obs.rawPickupRatio : 'n/a (expected too low)'}`);
        console.log(`     stabilized_ratio:     ${obs.pickupRatio}  (decision signal)`);
        console.log(`     status:               ${obs.status}`);
        console.log(`     confidence:           ${cIcon}  ${obs.confidence}`);
        console.log(`     advisory_multiplier:  ${advisoryLabel(obs.advisoryMultiplier)}`);
        console.log(`     pacing_proxy:         occ=${obs.occupancyFraction}  strength=${obs.pacingStrength}`);
        console.log(`     pacing_pickup_rel:    ${obs.pacingPickupRelation}`);
        console.log(`     anomalies_excluded:   ${obs.anomaliesExcluded}`);
        console.log(`     model_version:        ${obs.modelVersion}`);
        console.log(`     reasons:              ${obs.reasons.join(' | ')}`);
        console.log('');
      } catch (err) {
        errorCount++;
        console.log(`  ✗  ${label}`);
        console.log(`     [PICKUP_CALCULATION_FAILURE] ${err.message}`);
        console.log('');
      }
    }

    console.log('──────────────────────────────────────────────────────────────');
    console.log(`  Summary: ${successCount} OK, ${errorCount} errors`);
    console.log(`  ADVISORY ONLY — no pricing changes applied`);
    console.log('══════════════════════════════════════════════════════════════');
    console.log('');

    if (errorCount > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

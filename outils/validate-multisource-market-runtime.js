#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-G — Multi-Source Market Runtime Validator
 *
 * Two modes:
 *   Preview  : 0 BD calls, 0 DB writes, 0 pricing writes, 0 Channex calls
 *   Execute  : 1 Airbnb BD call + 1 Booking BD call,
 *              0 DB writes, 0 pricing writes, 0 Channex calls
 *
 * Both providers use the SAME dates: J+14 → J+17 (3 nights).
 * Displays per-source adapter metrics, quality scores, and consensus.
 *
 * SAFETY INVARIANTS:
 *   BD_CALLS         = 2 (execute) or 0 (preview)
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   BRIGHTDATA_API_KEY   never printed
 *   PRODUCTION_ROUTING_UNCHANGED — does NOT modify market-provider.js
 *
 * CLI:
 *   Preview: node outils/validate-multisource-market-runtime.js --name "M6"
 *   Execute: node outils/validate-multisource-market-runtime.js --name "M6" --execute
 */

require('dotenv').config();
const { Pool }                         = require('pg');
const { scrapeWithBrightData }         = require('../services/providers/brightdata');
const { scrapeWithBrightDataBooking }  = require('../services/providers/brightdata-booking');
const {
  selectComparables,
  calcBrightDataMarketStats,
  calcBrightDataBookingMarketStats,
  MIN_COMPARABLES_FALLBACK,
  MIN_COMPARABLES_TARGET,
  LOCAL_PRIORITY_RADIUS_KM,
  MAX_RADIUS_KM,
} = require('../services/brightdata-comparable-filter');
const { aggregateMarketSources }       = require('../services/market-multi-source-aggregator');
const { getFallbackZones }             = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }            = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS = 3;
const MAX_LISTINGS   = 50;

// Compute J+N YYYY-MM-DD in a given IANA timezone
function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d);
}

async function resolveProp(pool, name) {
  return (await pool.query(
    `SELECT p.id, p.user_id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.country_code, p.timezone,
            p.currency, p.max_guests, p.bedrooms
       FROM properties p
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
}

// ── Preview mode ──────────────────────────────────────────────────────────────

async function previewMode({ name, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-G Multi-Source Market Validator — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) { console.log(`\n  ⛔  Aucune propriété: "${name}"`); return { ok: false }; }
  if (rows.length > 1)   { console.log(`  ⛔  Ambiguïté: ${rows.length} correspondances`); return { ok: false }; }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  const now      = _now || new Date();
  const checkIn  = addDaysISO(now, 14, timezone);
  const checkOut = addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  console.log('\n  PROPERTY:');
  console.log(`    id:               ${prop.id}`);
  console.log(`    name:             ${prop.internal_name || prop.name}`);
  console.log(`    lat/lon:          ${prop.latitude} / ${prop.longitude}`);
  console.log(`    currency:         ${currency}`);
  console.log(`    timezone:         ${timezone}`);
  console.log(`    max_guests:       ${prop.max_guests ?? 'NULL'}`);
  console.log(`    bedrooms:         ${prop.bedrooms ?? 'NULL'}`);

  console.log('\n  PLANNED CALLS (not executed):');
  console.log(`    location:         ${location}`);
  console.log(`    check_in:         ${checkIn}`);
  console.log(`    check_out:        ${checkOut}`);
  console.log(`    nights:           ${DEFAULT_NIGHTS}`);
  console.log(`    max_listings:     ${MAX_LISTINGS}`);
  console.log(`    Airbnb dataset:   gd_ld7ll037kqy322v05 (discover_new, discover_by=location)`);
  console.log(`    Booking dataset:  gd_m4bf7a917zfezv9d5 (url_collection)`);

  console.log('\n  ROUTING STATUS:');
  console.log(`    MARKET_PRIMARY_PROVIDER = unchanged (not modified by B5-BK-G)`);
  console.log(`    BOOKING_PRODUCTION_ROUTING_ENABLED = NO`);

  console.log('\n  QUALITY CONSTANTS:');
  console.log(`    MIN_COMPARABLES_FALLBACK = ${MIN_COMPARABLES_FALLBACK}`);
  console.log(`    MIN_COMPARABLES_TARGET   = ${MIN_COMPARABLES_TARGET}`);
  console.log(`    LOCAL_PRIORITY_RADIUS_KM = ${LOCAL_PRIORITY_RADIUS_KM}`);
  console.log(`    MAX_RADIUS_KM            = ${MAX_RADIUS_KM}`);

  console.log('\n  Ready: node outils/validate-multisource-market-runtime.js --name <nom> --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true, propertyId: prop.id, currency, checkIn, checkOut, location };
}

// ── Execute mode ──────────────────────────────────────────────────────────────

async function executeMode({ name, _airbnbScrape, _bookingScrape, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-G Multi-Source Market Validator — EXECUTE MODE');
  console.log('  BD_CALLS=2 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) throw new Error(`Aucune propriété: "${name}"`);
  if (rows.length > 1)   throw new Error(`${rows.length} correspondances pour "${name}" — affiner --name`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  if (!currency) throw new Error('Devise propriété invalide ou absente');

  const now      = _now || new Date();
  const checkIn  = addDaysISO(now, 14, timezone);
  const checkOut = addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);

  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  const targetLat = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon = prop.longitude != null ? parseFloat(prop.longitude) : null;

  console.log(`\n  Property: ${prop.internal_name || prop.name} [${String(prop.id).slice(-8)}]`);
  console.log(`  Location: ${location}  currency=${currency}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}  nights=${DEFAULT_NIGHTS}`);
  console.log('');

  // ── Phase 1: Airbnb scrape ────────────────────────────────────────────────
  console.log('  🔍 [1/2] Calling Bright Data Airbnb…');
  const airbnbFunc = _airbnbScrape || scrapeWithBrightData;
  const airbnbRaw  = await airbnbFunc(location, MAX_LISTINGS, currency, {
    checkIn, checkOut,
  });

  // ── Phase 2: Booking scrape ───────────────────────────────────────────────
  console.log('  🔍 [2/2] Calling Bright Data Booking.com…');
  const bookingFunc = _bookingScrape || scrapeWithBrightDataBooking;
  const bookingRaw  = await bookingFunc(location, MAX_LISTINGS, currency, {
    checkIn, checkOut,
  });

  // ── Phase 3: Airbnb pipeline ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  AIRBNB PIPELINE');
  console.log('─'.repeat(72));

  const airbnbDiag  = airbnbRaw.diagnostics || {};
  const airbnbSel   = selectComparables(airbnbRaw.listings, {
    targetLat, targetLon, targetGuests: prop.max_guests, targetPropertyType: null,
  });
  const airbnbStats = calcBrightDataMarketStats(airbnbSel.listings);

  console.log(`  DATA_SOURCE:              ${airbnbRaw.dataSource}`);
  console.log(`  RAW_COUNT:                ${airbnbDiag.returnedCount ?? airbnbRaw.listings.length}`);
  console.log(`  ADAPTER_ACCEPTED:         ${airbnbRaw.listings.length}`);
  console.log(`  SELECTION_STATUS:         ${airbnbSel.status}`);
  console.log(`  SELECTED_RADIUS_KM:       ${airbnbSel.selectedRadiusKm ?? 'null (no geo)'}`);
  console.log(`  COMPARABLE_COUNT:         ${airbnbSel.listings.length}`);
  if (airbnbStats) {
    console.log(`  PRICE_MEDIAN:             ${airbnbStats.median}`);
    console.log(`  PRICE_P25/P75:            ${airbnbStats.p25} / ${airbnbStats.p75}`);
    console.log(`  OCCUPANCY:                ${airbnbStats.occupancy} (${airbnbStats.occupancy_semantics})`);
    console.log(`  TENSION_LEVEL:            ${airbnbStats.tensionLevel}`);
  } else {
    console.log('  ⚠️  No Airbnb stats (insufficient comparables)');
  }

  // ── Phase 4: Booking pipeline ─────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  BOOKING.COM PIPELINE');
  console.log('─'.repeat(72));

  const bookingDiag  = bookingRaw.diagnostics || {};
  const bookingSel   = selectComparables(bookingRaw.listings, {
    targetLat, targetLon, targetGuests: prop.max_guests, targetPropertyType: null,
  });
  const bookingStats = calcBrightDataBookingMarketStats(bookingSel.listings);

  console.log(`  DATA_SOURCE:              ${bookingRaw.dataSource}`);
  console.log(`  RAW_COUNT:                ${bookingDiag.returnedCount ?? bookingRaw.listings.length}`);
  console.log(`  ADAPTER_ACCEPTED:         ${bookingRaw.listings.length}`);
  console.log(`  SELECTION_STATUS:         ${bookingSel.status}`);
  console.log(`  SELECTED_RADIUS_KM:       ${bookingSel.selectedRadiusKm ?? 'null (no geo)'}`);
  console.log(`  COMPARABLE_COUNT:         ${bookingSel.listings.length}`);
  console.log(`  REQUESTED_NIGHTS:         ${bookingDiag.requestedNights ?? DEFAULT_NIGHTS}`);
  if (bookingStats) {
    console.log(`  PRICE_MEDIAN:             ${bookingStats.median}`);
    console.log(`  PRICE_P25/P75:            ${bookingStats.p25} / ${bookingStats.p75}`);
    console.log(`  OCCUPANCY_SEMANTICS:      ${bookingStats.occupancy_semantics}`);
    console.log(`  TENSION_LEVEL:            ${bookingStats.tensionLevel}`);
  } else {
    console.log('  ⚠️  No Booking stats (insufficient comparables)');
  }

  // ── Phase 5: Aggregation ──────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  AGGREGATION (market-multi-source-aggregator)');
  console.log('─'.repeat(72));

  const result = aggregateMarketSources({
    airbnb:  { stats: airbnbStats,  comparableCount: airbnbSel.listings.length,  selectedRadiusKm: airbnbSel.selectedRadiusKm  },
    booking: { stats: bookingStats, comparableCount: bookingSel.listings.length, selectedRadiusKm: bookingSel.selectedRadiusKm },
  });

  const diag = result.diagnostics;
  console.log(`  VALID_SOURCE_COUNT:       ${diag.validSourceCount}`);
  console.log(`  AIRBNB_QUALITY:           ${diag.airbnbQuality ?? 'null (invalid source)'}`);
  console.log(`    countScore:             ${diag.airbnbCountScore ?? 'null'}`);
  console.log(`    radiusScore:            ${diag.airbnbRadiusScore ?? 'null'}`);
  console.log(`  BOOKING_QUALITY:          ${diag.bookingQuality ?? 'null (invalid source)'}`);
  console.log(`    countScore:             ${diag.bookingCountScore ?? 'null'}`);
  console.log(`    radiusScore:            ${diag.bookingRadiusScore ?? 'null'}`);

  const con = result.consensus;
  if (con) {
    console.log('\n  CONSENSUS:');
    console.log(`    median:                 ${con.median}`);
    console.log(`    weight_airbnb:          ${con.weights.airbnb}`);
    console.log(`    weight_booking:         ${con.weights.booking}`);
    console.log(`    divergence_pct:         ${con.divergencePct ?? 'null'}`);
    console.log(`    divergence_level:       ${con.divergenceLevel ?? 'null'}`);
    console.log(`    confidence_level:       ${con.confidenceLevel}`);
  } else {
    console.log('\n  CONSENSUS:              null (no valid sources)');
  }

  const sig = result.marketSignal;
  console.log('\n  MARKET SIGNAL (Airbnb only):');
  console.log(`    source:                 ${sig.source ?? 'null'}`);
  console.log(`    occupancy:              ${sig.occupancy ?? 'null'}`);
  console.log(`    occupancy_semantics:    ${sig.occupancy_semantics ?? 'null'}`);
  console.log(`    tension_level:          ${sig.tensionLevel ?? 'null'}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('  SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  AIRBNB_COMPARABLE_COUNT:  ${airbnbSel.listings.length}`);
  console.log(`  BOOKING_COMPARABLE_COUNT: ${bookingSel.listings.length}`);
  console.log(`  AIRBNB_MEDIAN:            ${airbnbStats ? airbnbStats.median : 'null'}`);
  console.log(`  BOOKING_MEDIAN:           ${bookingStats ? bookingStats.median : 'null'}`);
  console.log(`  CONSENSUS_MEDIAN:         ${con ? con.median : 'null'}`);
  console.log(`  CONFIDENCE_LEVEL:         ${con ? con.confidenceLevel : 'null'}`);
  console.log(`  DIVERGENCE_LEVEL:         ${con ? (con.divergenceLevel ?? 'null') : 'null'}`);
  console.log(`  TENSION_LEVEL:            ${sig.tensionLevel ?? 'null'}`);
  console.log(`  DB_WRITES:                0`);
  console.log(`  PRICING_WRITES:           0`);
  console.log(`  CHANNEX_CALLS:            0`);
  console.log('═'.repeat(72) + '\n');

  return {
    ok: true,
    airbnbComparableCount:  airbnbSel.listings.length,
    bookingComparableCount: bookingSel.listings.length,
    airbnbMedian:           airbnbStats  ? airbnbStats.median  : null,
    bookingMedian:          bookingStats ? bookingStats.median : null,
    consensus:  con,
    marketSignal: sig,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/validate-multisource-market-runtime.js --name <nom> [--execute]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const modeOpts = { name, pool };
  const run = (execute ? executeMode(modeOpts) : previewMode(modeOpts))
    .then(r => { pool.end().catch(() => {}); return r; });

  run.catch(err => {
    const msg  = (err.message || '').toLowerCase();
    const code = (err.code || '').toUpperCase();
    let errType = 'FATAL_ERROR';
    if (msg.includes('self-signed') || msg.includes('certificate') || code.includes('SSL')) errType = 'DB_TLS_ERROR';
    else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') errType = 'DB_CONNECTION_ERROR';
    else if (msg.includes('brightdata') || msg.includes('booking') || msg.includes('airbnb')) errType = 'BRIGHTDATA_ERROR';
    console.error(`\n  ❌ ${errType}: ${err.message}`);
    pool.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = { previewMode, executeMode };

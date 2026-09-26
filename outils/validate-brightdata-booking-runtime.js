#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-F — Bright Data Booking.com Runtime Validator
 *
 * Two modes:
 *   Preview  : 0 BD calls, 0 DB writes, 0 pricing writes, 0 Channex calls
 *   Execute  : 1 BD call, 0 DB writes, 0 pricing writes, 0 Channex calls
 *
 * Default dates: J+14 → J+17 (3 nights).
 * Displays full adapter metrics + market stats with occupancy_semantics=unavailable.
 *
 * SAFETY INVARIANTS:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   BRIGHTDATA_API_KEY   never printed
 *
 * CLI:
 *   Preview: node outils/validate-brightdata-booking-runtime.js --name "M6"
 *   Execute: node outils/validate-brightdata-booking-runtime.js --name "M6" --execute
 */

require('dotenv').config();
const { Pool }                           = require('pg');
const { scrapeWithBrightDataBooking }    = require('../services/providers/brightdata-booking');
const {
  selectComparables,
  calcBrightDataBookingMarketStats,
  MIN_COMPARABLES_FALLBACK,
  MIN_COMPARABLES_TARGET,
  LOCAL_PRIORITY_RADIUS_KM,
  MAX_RADIUS_KM,
} = require('../services/brightdata-comparable-filter');
const { getBrightDataMarketDates } = require('../services/market-provider');
const { getFallbackZones }         = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }        = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS = 3;
const MAX_LISTINGS   = 50;

// Compute J+N date from now in a given timezone (YYYY-MM-DD)
function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  // Use Intl to get the date in the target timezone
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d).split('-');
  return parts.join('-');
}

async function resolveProp(pool, name) {
  const rows = (await pool.query(
    `SELECT p.id, p.user_id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.country_code, p.timezone,
            p.currency, p.max_guests, p.bedrooms
       FROM properties p
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
  return rows;
}

// ── Preview mode ──────────────────────────────────────────────────────────────

async function previewMode({ name, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-F Booking.com Runtime Validator — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) { console.log(`\n  ⛔  Aucune propriété: "${name}"`); return { ok: false }; }
  if (rows.length > 1)   { console.log(`  ⛔  Ambiguïté: ${rows.length} correspondances pour "${name}"`); return { ok: false }; }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  const now      = _now || new Date();

  const checkIn  = addDaysISO(now, 14, timezone);
  const checkOut = addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);
  const nights   = DEFAULT_NIGHTS;

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

  console.log('\n  PLANNED CALL (not executed):');
  console.log(`    location:         ${location}`);
  console.log(`    check_in:         ${checkIn}`);
  console.log(`    check_out:        ${checkOut}`);
  console.log(`    nights:           ${nights}`);
  console.log(`    max_listings:     ${MAX_LISTINGS}`);
  console.log(`    dataset:          gd_m4bf7a917zfezv9d5 (url_collection)`);

  console.log('\n  ROUTING STATUS:');
  console.log(`    BOOKING_PRODUCTION_ROUTING_ENABLED = NO`);
  console.log(`    (Booking.com not wired into market-provider.js — B5-BK-F scope)`);

  console.log('\n  QUALITY CONSTANTS:');
  console.log(`    MIN_COMPARABLES_FALLBACK = ${MIN_COMPARABLES_FALLBACK}`);
  console.log(`    MIN_COMPARABLES_TARGET   = ${MIN_COMPARABLES_TARGET}`);
  console.log(`    LOCAL_PRIORITY_RADIUS_KM = ${LOCAL_PRIORITY_RADIUS_KM}`);
  console.log(`    MAX_RADIUS_KM            = ${MAX_RADIUS_KM}`);

  console.log('\n  Ready: node outils/validate-brightdata-booking-runtime.js --name <nom> --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true, propertyId: prop.id, currency, checkIn, checkOut, nights, location };
}

// ── Execute mode ──────────────────────────────────────────────────────────────

async function executeMode({ name, _bdScrape, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-F Booking.com Runtime Validator — EXECUTE MODE');
  console.log('  BD_CALLS=1 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
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
  const nights   = DEFAULT_NIGHTS;

  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  console.log(`\n  Property: ${prop.internal_name || prop.name} [${String(prop.id).slice(-8)}]`);
  console.log(`  Location: ${location}  currency=${currency}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}  nights=${nights}`);
  console.log('');

  // ── Phase 1: Scrape ────────────────────────────────────────────────────────
  console.log('  🔍 Calling Bright Data Booking.com…');
  const scrapeFunc = _bdScrape || scrapeWithBrightDataBooking;
  const scrapeResult = await scrapeFunc(location, MAX_LISTINGS, currency, {
    checkIn, checkOut,
  });

  const { listings, isMock, dataSource, diagnostics } = scrapeResult;
  const diag = diagnostics || {};

  // ── Phase 2: Adapter metrics ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 2 — ADAPTER METRICS');
  console.log('─'.repeat(72));
  console.log(`  DATA_SOURCE:              ${dataSource}`);
  console.log(`  IS_MOCK:                  ${isMock}`);
  console.log(`  RAW_RETURNED_COUNT:       ${diag.returnedCount ?? listings.length}`);
  console.log(`  ADAPTER_ACCEPTED_COUNT:   ${diag.acceptedCount ?? listings.length}`);
  console.log(`  REJECTED_PRICE_COUNT:     ${diag.rejectedPriceCount ?? 0}`);
  console.log(`  REJECTED_CURRENCY_COUNT:  ${diag.rejectedCurrencyCount ?? 0}`);
  console.log(`  REQUESTED_NIGHTS:         ${diag.requestedNights ?? nights}`);

  // ── Phase 3: Field coverage ────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 3 — FIELD COVERAGE');
  console.log('─'.repeat(72));
  const withLatLng      = listings.filter(l => l.latitude != null && l.longitude != null).length;
  const withBedrooms    = listings.filter(l => l.bedrooms != null && l.bedrooms > 0).length;
  const withPropType    = listings.filter(l => l.category != null).length;
  const withStars       = listings.filter(l => l.stars > 0).length;
  const guestNullCheck  = listings.every(l => l.guests === null);
  const availNullCheck  = listings.every(l => l.availableDates === null);

  console.log(`  WITH_LAT_LNG:             ${withLatLng}/${listings.length}`);
  console.log(`  WITH_BEDROOMS:            ${withBedrooms}/${listings.length}`);
  console.log(`  WITH_PROPERTY_TYPE:       ${withPropType}/${listings.length}`);
  console.log(`  WITH_STARS:               ${withStars}/${listings.length}`);
  console.log(`  GUESTS_ALL_NULL:          ${guestNullCheck} (adults = input echo, not capacity)`);
  console.log(`  AVAILABLE_DATES_ALL_NULL: ${availNullCheck} (no occupancy proxy)`);

  // ── Phase 4: Comparable selection ─────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 4 — COMPARABLE SELECTION (selectComparables reused)');
  console.log('─'.repeat(72));

  const targetLat = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon = prop.longitude != null ? parseFloat(prop.longitude) : null;

  const { listings: comparables, status: selectStatus, selectedRadiusKm, diagnostics: selectDiag } =
    selectComparables(listings, {
      targetLat,
      targetLon,
      targetGuests:       prop.max_guests,
      targetPropertyType: null,
    });

  console.log(`  SELECTION_STATUS:         ${selectStatus}`);
  console.log(`  SELECTED_RADIUS_KM:       ${selectedRadiusKm ?? 'null (no geo)'}`);
  console.log(`  FINAL_COMPARABLE_COUNT:   ${comparables.length}`);
  console.log(`  dedup/category/capacity/geoMissing: ` +
    `${selectDiag.duplicateCount}/${selectDiag.categoryRejectedCount}/` +
    `${selectDiag.capacityRejectedCount}/${selectDiag.geoMissingCount}`);

  // ── Phase 5: Market statistics ─────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 5 — MARKET STATISTICS (calcBrightDataBookingMarketStats)');
  console.log('─'.repeat(72));

  if (comparables.length === 0) {
    console.log('  ⚠️  0 comparables — cannot compute market stats');
    console.log('═'.repeat(72) + '\n');
    return { ok: false, selectStatus, comparableCount: 0 };
  }

  const stats = calcBrightDataBookingMarketStats(comparables);

  if (!stats) {
    console.log('  ⚠️  calcBrightDataBookingMarketStats returned null (no valid prices)');
    console.log('═'.repeat(72) + '\n');
    return { ok: false, selectStatus, comparableCount: comparables.length };
  }

  console.log(`  PRICE_MIN:                ${stats.min}`);
  console.log(`  PRICE_P10:                ${stats.p10}`);
  console.log(`  PRICE_P25:                ${stats.p25}`);
  console.log(`  PRICE_MEDIAN:             ${stats.median}`);
  console.log(`  PRICE_P75:                ${stats.p75}`);
  console.log(`  PRICE_P90:                ${stats.p90}`);
  console.log(`  PRICE_MAX:                ${stats.max}`);
  console.log(`  PRICE_MEAN:               ${stats.mean}`);
  console.log(`  COMPARABLE_COUNT:         ${stats.count}`);
  console.log(`  OCCUPANCY_SIGNAL:         unavailable (no available_dates in Booking.com dataset)`);
  console.log(`  OCCUPANCY_SEMANTICS:      ${stats.occupancy_semantics}`);
  console.log(`  TENSION_LEVEL:            ${stats.tensionLevel} (null — no occupancy signal)`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('  SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  DATA_SOURCE:              ${dataSource}`);
  console.log(`  RAW_RETURNED_COUNT:       ${diag.returnedCount ?? listings.length}`);
  console.log(`  ADAPTER_ACCEPTED_COUNT:   ${listings.length}`);
  console.log(`  WITH_LAT_LNG:             ${withLatLng}/${listings.length}`);
  console.log(`  WITH_BEDROOMS:            ${withBedrooms}/${listings.length}`);
  console.log(`  WITH_PROPERTY_TYPE:       ${withPropType}/${listings.length}`);
  console.log(`  SELECTED_RADIUS_KM:       ${selectedRadiusKm ?? 'null'}`);
  console.log(`  FINAL_COMPARABLE_COUNT:   ${comparables.length}`);
  console.log(`  PRICE_MEDIAN:             ${stats.median}`);
  console.log(`  OCCUPANCY_SIGNAL:         unavailable`);
  console.log(`  DB_WRITES:                0`);
  console.log(`  PRICING_WRITES:           0`);
  console.log(`  CHANNEX_CALLS:            0`);
  console.log('═'.repeat(72) + '\n');

  return {
    ok:              true,
    dataSource,
    returnedCount:   diag.returnedCount ?? listings.length,
    acceptedCount:   listings.length,
    withLatLng,
    withBedrooms,
    withPropType,
    selectedRadiusKm,
    comparableCount: comparables.length,
    stats,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/validate-brightdata-booking-runtime.js --name <nom> [--execute]');
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
    else if (msg.includes('brightdata') || msg.includes('booking')) errType = 'BRIGHTDATA_ERROR';
    console.error(`\n  ❌ ${errType}: ${err.message}`);
    pool.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = { previewMode, executeMode };

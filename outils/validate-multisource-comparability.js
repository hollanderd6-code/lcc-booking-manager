#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-I — Cross-Source Comparability Runtime Validator
 *
 * Two modes:
 *   Preview  : 0 BD calls, 0 DB writes, 0 pricing writes, 0 Channex calls
 *   Execute  : 1 Airbnb BD call + 1 Booking BD call,
 *              0 DB writes, 0 pricing writes, 0 Channex calls
 *
 * Sections shown (execute mode):
 *   SOURCE FILTERS     — per-source quality filter diagnostics
 *   COMMON RADIUS TABLE — band-by-band comparable counts
 *   SELECTED COMMON MARKET — chosen radius, per-source stats
 *   CONSENSUS          — calibrated aggregation result
 *   COUNTERFACTUAL     — independent-radii result vs common-radius result
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
 *   Preview: node outils/validate-multisource-comparability.js --name "M6"
 *   Execute: node outils/validate-multisource-comparability.js --name "M6" --execute
 *            node outils/validate-multisource-comparability.js --name "M6" --execute --max-listings 100
 */

require('dotenv').config();
const { Pool }                         = require('pg');
const { scrapeWithBrightData }         = require('../services/providers/brightdata');
const { scrapeWithBrightDataBooking }  = require('../services/providers/brightdata-booking');
const {
  selectComparables,
  calcBrightDataMarketStats,
  calcBrightDataBookingMarketStats,
  haversineKm,
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_FALLBACK,
  MIN_COMPARABLES_TARGET,
} = require('../services/brightdata-comparable-filter');
const {
  buildCrossSourceQualityPool,
  selectCommonComparisonRadius,
  computeMetadataScore,
  computeCrossSourceDivergenceLevel,
} = require('../services/market-cross-source-policy');
const {
  aggregateMarketSources,
  aggregateMarketSourcesCalibrated,
  divergencePct,
} = require('../services/market-multi-source-aggregator');
const { getFallbackZones }  = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency } = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS = 3;
const DEFAULT_MAX_LISTINGS = 50;

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

async function previewMode({ name, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-I Cross-Source Comparability Validator — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) { console.log(`\n  ⛔  Aucune propriété: "${name}"`); return { ok: false }; }
  if (rows.length > 1)   { console.log(`  ⛔  Ambiguïté: ${rows.length} correspondances`); return { ok: false }; }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  const now      = new Date();
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
  console.log(`    max_listings:     ${DEFAULT_MAX_LISTINGS}`);
  console.log(`    Airbnb dataset:   gd_ld7ll037kqy322v05`);
  console.log(`    Booking dataset:  gd_m4bf7a917zfezv9d5`);

  console.log('\n  POLICY CONSTANTS (B5-BK-I):');
  console.log(`    MIN_COMPARABLES_FALLBACK    = ${MIN_COMPARABLES_FALLBACK}`);
  console.log(`    CROSS_SOURCE_MIN_COMPARABLE = ${MIN_COMPARABLES_FALLBACK} (both sources)`);
  console.log(`    RADIUS_BANDS_KM             = [${RADIUS_BANDS_KM.join(', ')}]`);
  console.log(`    DIVERGENCE_LOW              < 15%`);
  console.log(`    DIVERGENCE_MODERATE         < 30%`);
  console.log(`    DIVERGENCE_HIGH             < 50%`);
  console.log(`    BOOKING_CAPACITY_FILTER     DISABLED`);
  console.log(`    AIRBNB_BEDROOM_FILTER       DISABLED (bedrooms always null)`);

  console.log('\n  ROUTING STATUS:');
  console.log(`    MARKET_PRIMARY_PROVIDER            = unchanged`);
  console.log(`    BOOKING_PRODUCTION_ROUTING_ENABLED = NO`);

  console.log('\n  Ready: node outils/validate-multisource-comparability.js --name <nom> --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true };
}

// ── Execute mode ──────────────────────────────────────────────────────────────

async function executeMode({ name, maxListings, _airbnbScrape, _bookingScrape, _now, pool } = {}) {
  const MAX_LISTINGS = maxListings || DEFAULT_MAX_LISTINGS;

  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-I Cross-Source Comparability Validator — EXECUTE MODE');
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
  const targetGuests  = prop.max_guests || null;
  const targetBedrooms = prop.bedrooms  || null;
  const targetPropertyType = 'entire_place';

  console.log(`\n  Property: ${prop.internal_name || prop.name} [${String(prop.id).slice(-8)}]`);
  console.log(`  Location: ${location}  currency=${currency}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}  nights=${DEFAULT_NIGHTS}`);
  console.log(`  lat=${targetLat}  lon=${targetLon}  guests=${targetGuests}  bedrooms=${targetBedrooms}`);
  console.log('');

  // ── Phase 1: BD scrapes ───────────────────────────────────────────────────
  console.log('  🔍 [1/2] Calling Bright Data Airbnb…');
  const airbnbFunc = _airbnbScrape || scrapeWithBrightData;
  const airbnbRaw  = await airbnbFunc(location, MAX_LISTINGS, currency, { checkIn, checkOut });

  console.log('  🔍 [2/2] Calling Bright Data Booking.com…');
  const bookingFunc = _bookingScrape || scrapeWithBrightDataBooking;
  const bookingRaw  = await bookingFunc(location, MAX_LISTINGS, currency, { checkIn, checkOut });

  // ── Phase 2: SOURCE FILTERS ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  SOURCE FILTERS (B5-BK-I quality pool — no geo radius yet)');
  console.log('─'.repeat(72));

  const airbnbPool  = buildCrossSourceQualityPool(airbnbRaw.listings,  'airbnb',  { targetGuests, targetPropertyType });
  const bookingPool = buildCrossSourceQualityPool(bookingRaw.listings, 'booking', { targetBedrooms, targetPropertyType });

  const ad = airbnbPool.diagnostics;
  console.log('\n  AIRBNB SOURCE FILTER:');
  console.log(`    input_count:        ${ad.inputCount}`);
  console.log(`    dedup_rejected:     ${ad.dedupRejected}`);
  console.log(`    cat_rejected:       ${ad.catRejected}  (missing_cat: ${ad.catMissing})`);
  console.log(`    cap_rejected:       ${ad.capRejected}  (missing_cap: ${ad.capMissing})`);
  console.log(`    bedroom_filter:     ${ad.bedroomNote}`);
  console.log(`    output_count:       ${ad.outputCount}`);

  const bd = bookingPool.diagnostics;
  console.log('\n  BOOKING SOURCE FILTER:');
  console.log(`    input_count:        ${bd.inputCount}`);
  console.log(`    dedup_rejected:     ${bd.dedupRejected}`);
  console.log(`    cat_rejected:       ${bd.catRejected}  (missing_cat: ${bd.catMissing})`);
  console.log(`    bedroom_policy:     ${bd.bedroomPolicy}`);
  console.log(`    bedroom_exact:      ${bd.bedroomExact ?? 'N/A'}`);
  console.log(`    bedroom_missing:    ${bd.bedroomMissing}`);
  console.log(`    bedroom_rejected:   ${bd.bedroomRejected}`);
  console.log(`    capacity_filter:    ${bd.capacityNote}`);
  console.log(`    output_count:       ${bd.outputCount}`);

  // Metadata scores
  const airbnbMeta  = computeMetadataScore(airbnbPool.listings,  'airbnb');
  const bookingMeta = computeMetadataScore(bookingPool.listings, 'booking');
  console.log('\n  METADATA SCORES:');
  console.log(`    airbnb_metadata_score:  ${airbnbMeta.toFixed(4)}  (baseline 0.85 + guest_pct×0.10)`);
  console.log(`    booking_metadata_score: ${bookingMeta.toFixed(4)}  (baseline 0.85 + bedroom_pct×0.10)`);

  // ── Phase 3: COMMON RADIUS TABLE ──────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  COMMON RADIUS TABLE (both sources, after quality filters)');
  console.log('─'.repeat(72));
  console.log('  radius_km | airbnb_count | booking_count | both_viable');
  console.log('  --------- | ------------ | ------------- | -----------');

  // Build geo-filtered pools per band
  const mkWithDist = (listings) => {
    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return [];
    return listings
      .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
      .map(l => ({ ...l, _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude) }));
  };

  const airbnbGeo  = mkWithDist(airbnbPool.listings);
  const bookingGeo = mkWithDist(bookingPool.listings);

  for (const r of RADIUS_BANDS_KM) {
    const aCount = airbnbGeo.filter(l => l._dist <= r).length;
    const bCount = bookingGeo.filter(l => l._dist <= r).length;
    const viable = aCount >= MIN_COMPARABLES_FALLBACK && bCount >= MIN_COMPARABLES_FALLBACK ? 'YES ✓' : 'no';
    console.log(`  ${String(r).padStart(9)} | ${String(aCount).padStart(12)} | ${String(bCount).padStart(13)} | ${viable}`);
  }

  // ── Phase 4: SELECTED COMMON MARKET ───────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  SELECTED COMMON MARKET');
  console.log('─'.repeat(72));

  const commonResult = selectCommonComparisonRadius(
    airbnbRaw, bookingRaw, targetLat, targetLon,
    { targetGuests, targetBedrooms, targetPropertyType }
  );

  console.log(`\n  found:              ${commonResult.found}`);
  console.log(`  reason:             ${commonResult.reason}`);
  console.log(`  common_radius_km:   ${commonResult.radiusKm ?? 'null'}`);
  console.log(`  airbnb_count:       ${commonResult.airbnbCount}`);
  console.log(`  booking_count:      ${commonResult.bookingCount}`);

  // Compute per-source stats at common radius
  let airbnbCommonStats  = null;
  let bookingCommonStats = null;

  if (commonResult.found) {
    airbnbCommonStats  = calcBrightDataMarketStats(commonResult.airbnbListings);
    bookingCommonStats = calcBrightDataBookingMarketStats(commonResult.bookingListings);

    if (airbnbCommonStats) {
      console.log('\n  AIRBNB AT COMMON RADIUS:');
      console.log(`    median:           ${airbnbCommonStats.median}`);
      console.log(`    p25/p75:          ${airbnbCommonStats.p25} / ${airbnbCommonStats.p75}`);
      console.log(`    occupancy:        ${airbnbCommonStats.occupancy} (${airbnbCommonStats.occupancy_semantics})`);
      console.log(`    tension_level:    ${airbnbCommonStats.tensionLevel}`);
    } else {
      console.log('\n  AIRBNB AT COMMON RADIUS: insufficient comparables');
    }

    if (bookingCommonStats) {
      console.log('\n  BOOKING AT COMMON RADIUS:');
      console.log(`    median:           ${bookingCommonStats.median}`);
      console.log(`    p25/p75:          ${bookingCommonStats.p25} / ${bookingCommonStats.p75}`);
    } else {
      console.log('\n  BOOKING AT COMMON RADIUS: insufficient comparables');
    }
  } else {
    console.log('\n  ⚠️  No common radius found — calibrated consensus unavailable');
  }

  // ── Phase 5: CONSENSUS (calibrated) ──────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  CONSENSUS (B5-BK-I calibrated — divergence thresholds: <15 LOW, <30 MOD, <50 HIGH)');
  console.log('─'.repeat(72));

  let calibResult = null;

  if (commonResult.found) {
    calibResult = aggregateMarketSourcesCalibrated({
      airbnb: {
        stats:            airbnbCommonStats,
        comparableCount:  commonResult.airbnbCount,
        selectedRadiusKm: commonResult.radiusKm,
        metadataScore:    airbnbMeta,
      },
      booking: {
        stats:            bookingCommonStats,
        comparableCount:  commonResult.bookingCount,
        selectedRadiusKm: commonResult.radiusKm,
        metadataScore:    bookingMeta,
      },
      commonRadiusKm: commonResult.radiusKm,
    });

    const cdiag = calibResult.diagnostics;
    console.log(`\n  VALID_SOURCE_COUNT:       ${cdiag.validSourceCount}`);
    console.log(`  AIRBNB_QUALITY:           ${cdiag.airbnbQuality ?? 'null'}`);
    console.log(`    countScore:             ${cdiag.airbnbCountScore ?? 'null'}`);
    console.log(`    radiusScore:            ${cdiag.airbnbRadiusScore ?? 'null'}`);
    console.log(`    metadataScore:          ${cdiag.airbnbMetadataScore ?? 'null'}`);
    console.log(`  BOOKING_QUALITY:          ${cdiag.bookingQuality ?? 'null'}`);
    console.log(`    countScore:             ${cdiag.bookingCountScore ?? 'null'}`);
    console.log(`    radiusScore:            ${cdiag.bookingRadiusScore ?? 'null'}`);
    console.log(`    metadataScore:          ${cdiag.bookingMetadataScore ?? 'null'}`);

    const ccon = calibResult.consensus;
    if (ccon) {
      console.log('\n  CALIBRATED CONSENSUS:');
      console.log(`    median:               ${ccon.median}`);
      console.log(`    weight_airbnb:        ${ccon.weights.airbnb}`);
      console.log(`    weight_booking:       ${ccon.weights.booking}`);
      console.log(`    divergence_pct:       ${ccon.divergencePct ?? 'null'}`);
      console.log(`    divergence_level:     ${ccon.divergenceLevel ?? 'null'}  (calibrated thresholds)`);
      console.log(`    confidence_level:     ${ccon.confidenceLevel}`);
      console.log(`    common_radius_km:     ${ccon.commonRadiusKm ?? 'null'}`);
    } else {
      console.log('\n  CALIBRATED CONSENSUS:     null');
    }

    const csig = calibResult.marketSignal;
    console.log('\n  MARKET SIGNAL (Airbnb only):');
    console.log(`    source:               ${csig.source ?? 'null'}`);
    console.log(`    occupancy:            ${csig.occupancy ?? 'null'}`);
    console.log(`    tension_level:        ${csig.tensionLevel ?? 'null'}`);
  } else {
    console.log('\n  Calibrated consensus skipped — no common radius');
  }

  // ── Phase 6: COUNTERFACTUAL (independent radii via BK-G) ─────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  COUNTERFACTUAL — independent radii (B5-BK-G, without common-radius policy)');
  console.log('─'.repeat(72));

  const airbnbIndepSel = selectComparables(airbnbRaw.listings, {
    targetLat, targetLon, targetGuests, targetPropertyType: null,
  });
  const bookingIndepSel = selectComparables(bookingRaw.listings, {
    targetLat, targetLon, targetGuests, targetPropertyType: null,
  });

  const airbnbIndepStats  = calcBrightDataMarketStats(airbnbIndepSel.listings);
  const bookingIndepStats = calcBrightDataBookingMarketStats(bookingIndepSel.listings);

  const indepResult = aggregateMarketSources({
    airbnb:  { stats: airbnbIndepStats,  comparableCount: airbnbIndepSel.listings.length,  selectedRadiusKm: airbnbIndepSel.selectedRadiusKm  },
    booking: { stats: bookingIndepStats, comparableCount: bookingIndepSel.listings.length, selectedRadiusKm: bookingIndepSel.selectedRadiusKm },
  });

  console.log(`\n  AIRBNB_INDEP_RADIUS:        ${airbnbIndepSel.selectedRadiusKm ?? 'null'} km`);
  console.log(`  AIRBNB_INDEP_COUNT:         ${airbnbIndepSel.listings.length}`);
  console.log(`  AIRBNB_INDEP_MEDIAN:        ${airbnbIndepStats ? airbnbIndepStats.median : 'null'}`);
  console.log(`  BOOKING_INDEP_RADIUS:       ${bookingIndepSel.selectedRadiusKm ?? 'null'} km`);
  console.log(`  BOOKING_INDEP_COUNT:        ${bookingIndepSel.listings.length}`);
  console.log(`  BOOKING_INDEP_MEDIAN:       ${bookingIndepStats ? bookingIndepStats.median : 'null'}`);

  const indepCon = indepResult.consensus;
  if (indepCon) {
    console.log(`  INDEP_DIVERGENCE_PCT:       ${indepCon.divergencePct ?? 'null'}`);
    console.log(`  INDEP_DIVERGENCE_LEVEL:     ${indepCon.divergenceLevel ?? 'null'}  (BKG thresholds: <10/<25/<50)`);
    console.log(`  INDEP_CONSENSUS_MEDIAN:     ${indepCon.median}`);
    console.log(`  INDEP_CONFIDENCE_LEVEL:     ${indepCon.confidenceLevel}`);
  } else {
    console.log('  INDEP_CONSENSUS:            null (< 2 valid sources)');
  }

  // ── Phase 7: DIVERGENCE COMPARISON ───────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  DIVERGENCE COMPARISON: independent radii vs common radius');
  console.log('─'.repeat(72));

  const calibCon = calibResult ? calibResult.consensus : null;
  console.log(`\n  INDEPENDENT RADII:`);
  console.log(`    airbnb_radius:      ${airbnbIndepSel.selectedRadiusKm ?? 'null'} km`);
  console.log(`    booking_radius:     ${bookingIndepSel.selectedRadiusKm ?? 'null'} km`);
  console.log(`    divergence_pct:     ${indepCon ? (indepCon.divergencePct ?? 'null') : 'null'}`);
  console.log(`    consensus_median:   ${indepCon ? indepCon.median : 'null'}`);
  console.log(`\n  COMMON RADIUS (B5-BK-I):`);
  console.log(`    common_radius:      ${commonResult.radiusKm ?? 'null'} km`);
  console.log(`    divergence_pct:     ${calibCon ? (calibCon.divergencePct ?? 'null') : 'null'}  (calibrated thresholds)`);
  console.log(`    consensus_median:   ${calibCon ? calibCon.median : 'null'}`);
  console.log(`    confidence_level:   ${calibCon ? calibCon.confidenceLevel : 'null'}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-I SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  COMMON_RADIUS_KM:           ${commonResult.radiusKm ?? 'null'}`);
  console.log(`  AIRBNB_COUNT:               ${commonResult.airbnbCount}`);
  console.log(`  BOOKING_COUNT:              ${commonResult.bookingCount}`);
  console.log(`  AIRBNB_MEDIAN:              ${airbnbCommonStats ? airbnbCommonStats.median : 'null'}`);
  console.log(`  BOOKING_MEDIAN:             ${bookingCommonStats ? bookingCommonStats.median : 'null'}`);
  console.log(`  DIVERGENCE_PCT:             ${calibCon ? (calibCon.divergencePct ?? 'null') : 'null'}`);
  console.log(`  DIVERGENCE_LEVEL:           ${calibCon ? (calibCon.divergenceLevel ?? 'null') : 'null'}`);
  console.log(`  CONSENSUS_MEDIAN:           ${calibCon ? calibCon.median : 'null'}`);
  console.log(`  CONFIDENCE_LEVEL:           ${calibCon ? calibCon.confidenceLevel : 'null'}`);
  console.log(`  AIRBNB_METADATA_SCORE:      ${airbnbMeta.toFixed(4)}`);
  console.log(`  BOOKING_METADATA_SCORE:     ${bookingMeta.toFixed(4)}`);
  console.log(`  DB_WRITES:                  0`);
  console.log(`  PRICING_WRITES:             0`);
  console.log(`  CHANNEX_CALLS:              0`);
  console.log('═'.repeat(72) + '\n');

  return {
    ok:                  true,
    commonRadiusKm:      commonResult.radiusKm,
    airbnbCount:         commonResult.airbnbCount,
    bookingCount:        commonResult.bookingCount,
    airbnbMedian:        airbnbCommonStats  ? airbnbCommonStats.median  : null,
    bookingMedian:       bookingCommonStats ? bookingCommonStats.median : null,
    airbnbMetadataScore: airbnbMeta,
    bookingMetadataScore: bookingMeta,
    consensus:           calibCon,
    marketSignal:        calibResult ? calibResult.marketSignal : null,
    counterfactual: {
      airbnbRadius:      airbnbIndepSel.selectedRadiusKm,
      bookingRadius:     bookingIndepSel.selectedRadiusKm,
      divergencePct:     indepCon ? indepCon.divergencePct : null,
      consensusMedian:   indepCon ? indepCon.median : null,
    },
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args        = process.argv.slice(2);
  const nameIdx     = args.indexOf('--name');
  const name        = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute     = args.includes('--execute');
  const maxIdx      = args.indexOf('--max-listings');
  const maxListings = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : DEFAULT_MAX_LISTINGS;

  if (!name) {
    console.error('Usage: node outils/validate-multisource-comparability.js --name <nom> [--execute] [--max-listings N]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const opts    = { name, maxListings, pool };
  const runMode = execute ? executeMode(opts) : previewMode(opts);

  runMode
    .then(() => pool.end().catch(() => {}))
    .catch(err => {
      const msg  = (err.message || '').toLowerCase();
      const code = (err.code   || '').toUpperCase();
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

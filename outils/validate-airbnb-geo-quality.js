#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-J — Airbnb Geo Quality Validator
 *
 * Validates the geographic quality of an Airbnb comparable pool for a property.
 * Shows geo coverage metrics, quality status, and recommended weight effect.
 *
 * SAFETY:
 *   BD_CALLS     = 0 (preview) | 1 max (execute: 1 Airbnb only)
 *   DB_WRITES    = 0  always
 *   PRICING_WRITES = 0  always
 *   CHANNEX_CALLS  = 0  always
 *   BRIGHTDATA_API_KEY  never printed
 *   PRODUCTION_ROUTING_UNCHANGED
 *   MAX_AIRBNB_CALLS = 1
 *
 * CLI:
 *   node outils/validate-airbnb-geo-quality.js --name "M6"
 *   node outils/validate-airbnb-geo-quality.js --name "M6" --execute
 *   node outils/validate-airbnb-geo-quality.js --name "M6" --execute --max-listings 100
 */

require('dotenv').config();
const { Pool }                 = require('pg');
const { scrapeWithBrightData } = require('../services/providers/brightdata');
const {
  isCategoryCompatible,
  isCapacityCompatible,
  calcBrightDataMarketStats,
  selectComparables,
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_FALLBACK,
} = require('../services/brightdata-comparable-filter');
const {
  buildCrossSourceQualityPool,
  computeMetadataScore,
} = require('../services/market-cross-source-policy');
const {
  calculateGeoCoverageQuality,
  evaluateSourceGeoQuality,
} = require('../services/market-geo-quality');
const {
  qualityScoreCalibrated,
} = require('../services/market-multi-source-aggregator');
const { getFallbackZones }  = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency } = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS      = 3;
const DEFAULT_MAX_LISTINGS = 100; // B5-BK-J recommendation

function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d);
}

function fmt(v, dec = 2) {
  if (v == null) return 'null';
  return Number.isFinite(v) ? v.toFixed(dec) : String(v);
}

async function resolveProp(pool, name) {
  return (await pool.query(
    `SELECT p.id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.timezone, p.currency,
            p.max_guests, p.bedrooms
       FROM properties p
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
}

// ── Preview mode ──────────────────────────────────────────────────────────────

async function previewMode({ name, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J Airbnb Geo Quality Validator — PREVIEW MODE');
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

  console.log('\n  PROPERTY:');
  console.log(`    name:         ${prop.internal_name || prop.name}`);
  console.log(`    lat/lon:      ${prop.latitude} / ${prop.longitude}`);
  console.log(`    currency:     ${currency}  timezone: ${timezone}`);
  console.log(`    max_guests:   ${prop.max_guests ?? 'NULL'}`);
  console.log(`    bedrooms:     ${prop.bedrooms ?? 'NULL'}`);

  console.log('\n  PLANNED CALL (not executed):');
  console.log(`    dataset:      gd_ld7ll037kqy322v05 (discover_new)`);
  console.log(`    location:     ${zones[0]}`);
  console.log(`    check_in:     ${checkIn}   check_out: ${checkOut}`);
  console.log(`    max_listings: ${DEFAULT_MAX_LISTINGS} (B5-BK-J recommended)`);

  console.log('\n  GEO QUALITY GATE (B5-BK-J):');
  console.log(`    ≥8 within 5km  → score=1.00  GOOD`);
  console.log(`    ≥5 within 5km  → score=0.85  GOOD`);
  console.log(`    ≥3 within 5km  → score=0.60  DEGRADED`);
  console.log(`    ≥1 within 5km  → score=0.30  DEGRADED`);
  console.log(`    0 within 5km + ≥5 within 10km → 0.20 POOR`);
  console.log(`    0 within 5km + ≥1 within 10km → 0.10 POOR`);
  console.log(`    0 within 10km  → score=0.00  UNUSABLE → excluded from consensus`);

  console.log('\n  Ready: node outils/validate-airbnb-geo-quality.js --name <nom> --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true };
}

// ── Execute mode ──────────────────────────────────────────────────────────────

async function executeMode({ name, maxListings, _airbnbScrape, _now, pool } = {}) {
  const MAX_LISTINGS = maxListings || DEFAULT_MAX_LISTINGS;

  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J Airbnb Geo Quality Validator — EXECUTE MODE');
  console.log(`  BD_CALLS=1 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0`);
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) throw new Error(`Aucune propriété: "${name}"`);
  if (rows.length > 1)   throw new Error(`${rows.length} correspondances pour "${name}"`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  if (!currency) throw new Error('Devise propriété invalide ou absente');

  const now      = _now || new Date();
  const checkIn  = addDaysISO(now, 14, timezone);
  const checkOut = addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  const targetLat          = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon          = prop.longitude != null ? parseFloat(prop.longitude) : null;
  const targetGuests       = prop.max_guests  || null;
  const targetBedrooms     = prop.bedrooms    || null;
  const targetPropertyType = 'entire_place';

  console.log(`\n  Property: ${prop.internal_name || prop.name}  currency=${currency}`);
  console.log(`  lat=${targetLat}  lon=${targetLon}  guests=${targetGuests}  bedrooms=${targetBedrooms}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}  max_listings=${MAX_LISTINGS}`);

  // ── BD call ───────────────────────────────────────────────────────────────────
  console.log(`\n  🔍 Calling Bright Data Airbnb (max_listings=${MAX_LISTINGS})…`);
  const airbnbFunc = _airbnbScrape || scrapeWithBrightData;
  const result     = await airbnbFunc(location, MAX_LISTINGS, currency, { checkIn, checkOut });
  const listings   = result.listings;
  const diag       = result.diagnostics || {};

  // ── RAW geo metrics ───────────────────────────────────────────────────────────
  const rawGeo = calculateGeoCoverageQuality(listings, targetLat, targetLon);

  console.log('\n' + '─'.repeat(72));
  console.log('  RAW (adapter-accepted, before quality filters)');
  console.log('─'.repeat(72));
  console.log(`\n  RAW_COUNT:          ${diag.returnedCount ?? listings.length}`);
  console.log(`  ADAPTER_ACCEPTED:   ${listings.length}`);
  console.log(`  WITH_GEO:           ${rawGeo.geoListingCount}`);
  console.log(`  WITHOUT_GEO:        ${rawGeo.noGeoCount}`);
  if (rawGeo.geoListingCount > 0) {
    console.log(`\n  WITHIN_1KM:         ${rawGeo.within1km}`);
    console.log(`  WITHIN_2KM:         ${rawGeo.within2km}`);
    console.log(`  WITHIN_3KM:         ${rawGeo.within3km}`);
    console.log(`  WITHIN_5KM:         ${rawGeo.within5km}`);
    console.log(`  WITHIN_10KM:        ${rawGeo.within10km}`);
    console.log(`  WITHIN_20KM:        ${rawGeo.within20km}`);
  }

  // ── Quality pool ──────────────────────────────────────────────────────────────
  const qualityPool = buildCrossSourceQualityPool(listings, 'airbnb', {
    targetGuests, targetPropertyType,
  });
  const qualityListings = qualityPool.listings;

  const qd = qualityPool.diagnostics;
  console.log('\n' + '─'.repeat(72));
  console.log('  QUALITY POOL (after dedup + category + capacity)');
  console.log('─'.repeat(72));
  console.log(`\n  dedup_rejected:     ${qd.dedupRejected}`);
  console.log(`  cat_rejected:       ${qd.catRejected}  (missing: ${qd.catMissing})`);
  console.log(`  cap_rejected:       ${qd.capRejected}  (missing: ${qd.capMissing})`);
  console.log(`  QUALITY_POOL_COUNT: ${qd.outputCount}`);

  // ── Geo quality on quality pool ───────────────────────────────────────────────
  const geoQ = evaluateSourceGeoQuality(qualityListings, targetLat, targetLon);
  const qGeo = geoQ.metrics;

  console.log('\n' + '─'.repeat(72));
  console.log('  GEO QUALITY (on quality pool)');
  console.log('─'.repeat(72));
  if (qGeo.geoListingCount > 0) {
    console.log(`\n  WITHIN_1KM:         ${qGeo.within1km}`);
    console.log(`  WITHIN_2KM:         ${qGeo.within2km}`);
    console.log(`  WITHIN_3KM:         ${qGeo.within3km}`);
    console.log(`  WITHIN_5KM:         ${qGeo.within5km}`);
    console.log(`  WITHIN_10KM:        ${qGeo.within10km}`);
    console.log(`  WITHIN_20KM:        ${qGeo.within20km}`);
  }
  console.log(`\n  GEO_COVERAGE_SCORE: ${fmt(geoQ.geoCoverageScore)}`);
  console.log(`  GEO_QUALITY_STATUS: ${geoQ.status}`);
  console.log(`  USABLE_FOR_CONSENSUS: ${geoQ.usableForConsensus}`);
  console.log(`  REASON:             ${geoQ.reason}`);
  console.log(`  LOCAL_COUNT:        ${geoQ.localComparableCount}  @ ${geoQ.localRadiusKm ?? 'null'} km`);
  console.log(`  NEAREST_KM:         ${fmt(geoQ.nearestDistanceKm)}`);
  console.log(`  MEDIAN_KM:          ${fmt(geoQ.medianDistanceKm)}`);

  // ── Stats at selectComparables radius ─────────────────────────────────────────
  const selection = selectComparables(listings, {
    targetLat, targetLon, targetGuests, targetPropertyType: null,
  });
  const stats = calcBrightDataMarketStats(selection.listings);

  console.log('\n' + '─'.repeat(72));
  console.log('  COMPARABLE SELECTION (selectComparables)');
  console.log('─'.repeat(72));
  console.log(`\n  SELECTED_RADIUS:    ${selection.selectedRadiusKm ?? 'null'} km`);
  console.log(`  SELECTED_COUNT:     ${selection.listings.length}`);
  if (stats) {
    console.log(`  MEDIAN:             ${fmt(stats.median)}`);
    console.log(`  P25:                ${fmt(stats.p25)}`);
    console.log(`  P75:                ${fmt(stats.p75)}`);
    console.log(`  OCCUPANCY:          ${stats.occupancy}  (${stats.occupancy_semantics})`);
    console.log(`  TENSION_LEVEL:      ${stats.tensionLevel}`);
  } else {
    console.log('  ⚠️  No stats (insufficient comparables)');
  }

  // ── Quality score with geo gate ───────────────────────────────────────────────
  const metaScore = computeMetadataScore(qualityListings, 'airbnb');
  const qualNoGeo = qualityScoreCalibrated(
    selection.listings.length, selection.selectedRadiusKm, metaScore, null
  );
  const qualWithGeo = qualityScoreCalibrated(
    selection.listings.length, selection.selectedRadiusKm, metaScore, geoQ.geoCoverageScore
  );

  console.log('\n' + '─'.repeat(72));
  console.log('  QUALITY SCORE WITH GEO GATE (B5-BK-J)');
  console.log('─'.repeat(72));
  console.log(`\n  metadata_score:           ${fmt(metaScore)}`);
  console.log(`  geo_coverage_score:       ${fmt(geoQ.geoCoverageScore)}`);
  console.log(`  quality_without_geo_gate: ${fmt(qualNoGeo)}  (BK-I formula)`);
  console.log(`  quality_with_geo_gate:    ${fmt(qualWithGeo)}  (BK-J formula)`);

  let recommendedWeightEffect;
  if (!geoQ.usableForConsensus) {
    recommendedWeightEffect = 'EXCLUDED (geo-unusable → weight=0.00 in consensus)';
  } else if (geoQ.geoCoverageScore < 0.30) {
    recommendedWeightEffect = `HEAVILY_REDUCED (score=${fmt(geoQ.geoCoverageScore)} → weight significantly below proportional)`;
  } else if (geoQ.geoCoverageScore < 0.85) {
    recommendedWeightEffect = `REDUCED (score=${fmt(geoQ.geoCoverageScore)} → weight reduced proportionally)`;
  } else {
    recommendedWeightEffect = `NORMAL (score=${fmt(geoQ.geoCoverageScore)} → good local coverage)`;
  }
  console.log(`  RECOMMENDED_WEIGHT_EFFECT: ${recommendedWeightEffect}`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  RAW_COUNT:                ${diag.returnedCount ?? listings.length}`);
  console.log(`  QUALITY_POOL_COUNT:       ${qd.outputCount}`);
  console.log(`  WITHIN_1KM:               ${qGeo.within1km}`);
  console.log(`  WITHIN_2KM:               ${qGeo.within2km}`);
  console.log(`  WITHIN_3KM:               ${qGeo.within3km}`);
  console.log(`  WITHIN_5KM:               ${qGeo.within5km}`);
  console.log(`  WITHIN_10KM:              ${qGeo.within10km}`);
  console.log(`  WITHIN_20KM:              ${qGeo.within20km}`);
  console.log(`  GEO_COVERAGE_SCORE:       ${fmt(geoQ.geoCoverageScore)}`);
  console.log(`  GEO_QUALITY_STATUS:       ${geoQ.status}`);
  console.log(`  USABLE_FOR_CONSENSUS:     ${geoQ.usableForConsensus}`);
  console.log(`  SELECTED_RADIUS:          ${selection.selectedRadiusKm ?? 'null'} km`);
  console.log(`  SELECTED_COUNT:           ${selection.listings.length}`);
  console.log(`  MEDIAN:                   ${stats ? fmt(stats.median) : 'null'}`);
  console.log(`  P25:                      ${stats ? fmt(stats.p25) : 'null'}`);
  console.log(`  P75:                      ${stats ? fmt(stats.p75) : 'null'}`);
  console.log(`  RECOMMENDED_WEIGHT_EFFECT: ${recommendedWeightEffect}`);
  console.log(`  DB_WRITES:                0`);
  console.log(`  PRICING_WRITES:           0`);
  console.log(`  CHANNEX_CALLS:            0`);
  console.log('═'.repeat(72) + '\n');

  return {
    ok:               true,
    rawCount:         diag.returnedCount ?? listings.length,
    qualityPoolCount: qd.outputCount,
    geoMetrics:       qGeo,
    geoQuality:       geoQ,
    selectedRadius:   selection.selectedRadiusKm,
    selectedCount:    selection.listings.length,
    stats,
    metadataScore:    metaScore,
    qualityWithGeoGate: qualWithGeo,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');
  const maxIdx  = args.indexOf('--max-listings');
  const maxListings = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : DEFAULT_MAX_LISTINGS;

  if (!name) {
    console.error('Usage: node outils/validate-airbnb-geo-quality.js --name <nom> [--execute] [--max-listings N]');
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
      else if (msg.includes('brightdata') || msg.includes('airbnb')) errType = 'BRIGHTDATA_ERROR';
      console.error(`\n  ❌ ${errType}: ${err.message}`);
      pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { previewMode, executeMode };

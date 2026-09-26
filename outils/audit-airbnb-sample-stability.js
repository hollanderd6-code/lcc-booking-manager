#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-J — Airbnb Sample Stability Audit
 *
 * Diagnoses WHY Airbnb Bright Data results vary so drastically with sample size.
 * Runs two Airbnb calls at limit=50 and limit=100, then compares:
 *   - raw counts and geo coverage
 *   - ID overlap (set overlap + prefix order stability)
 *   - rank/distance correlation (are local listings ranked last?)
 *   - category/capacity attrition by distance band
 *   - primary local attrition reason
 *   - stability verdict
 *
 * SAFETY:
 *   BD_CALLS     = 0 (preview) | 2 max (execute: both Airbnb only)
 *   DB_WRITES    = 0  always
 *   PRICING_WRITES = 0  always
 *   CHANNEX_CALLS  = 0  always
 *   BRIGHTDATA_API_KEY  never printed
 *   PRODUCTION_ROUTING_UNCHANGED
 *   MAX_AIRBNB_CALLS = 2
 *
 * CLI:
 *   node outils/audit-airbnb-sample-stability.js --name "M6"
 *   node outils/audit-airbnb-sample-stability.js --name "M6" --execute
 */

require('dotenv').config();
const { Pool }                  = require('pg');
const { scrapeWithBrightData }  = require('../services/providers/brightdata');
const {
  haversineKm,
  isCategoryCompatible,
  isCapacityCompatible,
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_FALLBACK,
} = require('../services/brightdata-comparable-filter');
const {
  calculateGeoCoverageQuality,
  evaluateSourceGeoQuality,
  computeAttritionByDistance,
  computeRankDistanceProfile,
  computeSampleOverlap,
  determinePrimaryAttritionReason,
} = require('../services/market-geo-quality');
const { getFallbackZones }  = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency } = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS = 3;
const MAX_LISTINGS_A = 50;
const MAX_LISTINGS_B = 100;

function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d);
}

function fmt(v, dec = 2) {
  if (v == null) return 'null';
  return Number.isFinite(v) ? v.toFixed(dec) : String(v);
}

function pctOf(n, total) {
  if (!total) return '0.0%';
  return (n / total * 100).toFixed(1) + '%';
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

// ── distanceDistribution (Phase 3) ────────────────────────────────────────────

function printDistanceDistribution(listings, targetLat, targetLon, label) {
  const geoMetrics = calculateGeoCoverageQuality(listings, targetLat, targetLon);
  console.log(`\n  [${label}] DISTANCE DISTRIBUTION`);
  console.log(`    RAW_COUNT:         ${listings.length}`);
  console.log(`    WITH_GEO:          ${geoMetrics.geoListingCount}`);
  console.log(`    WITHOUT_GEO:       ${geoMetrics.noGeoCount}`);
  if (geoMetrics.geoListingCount > 0) {
    console.log(`    nearest_km:        ${fmt(geoMetrics.nearestDistanceKm)}`);
    console.log(`    p25_km:            ${fmt(geoMetrics.p25DistanceKm)}`);
    console.log(`    median_km:         ${fmt(geoMetrics.medianDistanceKm)}`);
    console.log(`    p75_km:            ${fmt(geoMetrics.p75DistanceKm)}`);
    console.log(`    within_1km:        ${geoMetrics.within1km}  (${pctOf(geoMetrics.within1km, geoMetrics.geoListingCount)})`);
    console.log(`    within_2km:        ${geoMetrics.within2km}  (${pctOf(geoMetrics.within2km, geoMetrics.geoListingCount)})`);
    console.log(`    within_3km:        ${geoMetrics.within3km}  (${pctOf(geoMetrics.within3km, geoMetrics.geoListingCount)})`);
    console.log(`    within_5km:        ${geoMetrics.within5km}  (${pctOf(geoMetrics.within5km, geoMetrics.geoListingCount)})`);
    console.log(`    within_10km:       ${geoMetrics.within10km}  (${pctOf(geoMetrics.within10km, geoMetrics.geoListingCount)})`);
    console.log(`    within_20km:       ${geoMetrics.within20km}  (${pctOf(geoMetrics.within20km, geoMetrics.geoListingCount)})`);
    console.log(`    beyond_20km:       ${geoMetrics.beyond20km}`);
  }
}

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode({ name, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J Airbnb Sample Stability Audit — PREVIEW MODE');
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

  console.log('\n  PLANNED AIRBNB CALLS (not executed):');
  console.log(`    dataset:      gd_ld7ll037kqy322v05 (discover_new, discover_by=location)`);
  console.log(`    location:     ${zones[0]}`);
  console.log(`    check_in:     ${checkIn}   check_out: ${checkOut}`);
  console.log(`    nights:       ${DEFAULT_NIGHTS}`);
  console.log(`    CALL_A:       max_listings = ${MAX_LISTINGS_A}`);
  console.log(`    CALL_B:       max_listings = ${MAX_LISTINGS_B}`);
  console.log(`    MAX_BD_CALLS: 2 (Airbnb only — NO Booking call)`);

  console.log('\n  PIPELINE AUDIT FINDINGS (from code analysis):');
  console.log(`    BD_ORDER:     Bright Data returns listings in its internal order.`);
  console.log(`                  This order is NOT geographic (not sorted by distance).`);
  console.log(`    LIMIT:        limit_per_input is a hard cap on snapshot size.`);
  console.log(`                  Local listings may appear beyond rank 50 in BD's order.`);
  console.log(`    HYPOTHESIS:   If local (≤5km) Airbnb listings appear at ranks 51-100,`);
  console.log(`                  max_listings=50 structurally excludes them.`);

  console.log('\n  Ready: node outils/audit-airbnb-sample-stability.js --name <nom> --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true };
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode({ name, _airbnbScrape, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J Airbnb Sample Stability Audit — EXECUTE MODE');
  console.log('  BD_CALLS=2 (Airbnb only) | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
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

  const targetLat         = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon         = prop.longitude != null ? parseFloat(prop.longitude) : null;
  const targetGuests      = prop.max_guests  || null;
  const targetPropertyType = 'entire_place';

  console.log(`\n  Property: ${prop.internal_name || prop.name}`);
  console.log(`  lat=${targetLat}  lon=${targetLon}  guests=${targetGuests}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}  nights=${DEFAULT_NIGHTS}`);

  // ── Phase 2: Two Airbnb BD calls ─────────────────────────────────────────────
  const airbnbFunc = _airbnbScrape || scrapeWithBrightData;

  console.log(`\n  🔍 [CALL A] Airbnb BD — max_listings=${MAX_LISTINGS_A}  …`);
  const resultA = await airbnbFunc(location, MAX_LISTINGS_A, currency, { checkIn, checkOut });

  console.log(`  🔍 [CALL B] Airbnb BD — max_listings=${MAX_LISTINGS_B}  …`);
  const resultB = await airbnbFunc(location, MAX_LISTINGS_B, currency, { checkIn, checkOut });

  const listingsA = resultA.listings;
  const listingsB = resultB.listings;
  const diagA     = resultA.diagnostics || {};
  const diagB     = resultB.diagnostics || {};

  const snapshotIdA = resultA.snapshotId || 'unknown';
  const snapshotIdB = resultB.snapshotId || 'unknown';
  const tsA = new Date().toISOString();

  // ── Phase 3: Distance distributions ──────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 3 — DISTANCE DISTRIBUTIONS');
  console.log('─'.repeat(72));

  printDistanceDistribution(listingsA, targetLat, targetLon, `CALL_A limit=${MAX_LISTINGS_A}`);
  printDistanceDistribution(listingsB, targetLat, targetLon, `CALL_B limit=${MAX_LISTINGS_B}`);

  // After quality filters
  const idsA = listingsA.map(l => l.providerListingId).filter(Boolean);
  const idsB = listingsB.map(l => l.providerListingId).filter(Boolean);

  const afterFiltersA = listingsA.filter(l =>
    isCategoryCompatible(l.category, targetPropertyType) !== false &&
    isCapacityCompatible(l.guests, targetGuests) !== false
  );
  const afterFiltersB = listingsB.filter(l =>
    isCategoryCompatible(l.category, targetPropertyType) !== false &&
    isCapacityCompatible(l.guests, targetGuests) !== false
  );

  const geoAfterA = calculateGeoCoverageQuality(afterFiltersA, targetLat, targetLon);
  const geoAfterB = calculateGeoCoverageQuality(afterFiltersB, targetLat, targetLon);

  console.log('\n  AFTER QUALITY FILTERS (dedup + category + capacity):');
  console.log(`    CALL_A:  ${afterFiltersA.length} remaining  within_5km=${geoAfterA.within5km}  within_10km=${geoAfterA.within10km}  within_20km=${geoAfterA.within20km}`);
  console.log(`    CALL_B:  ${afterFiltersB.length} remaining  within_5km=${geoAfterB.within5km}  within_10km=${geoAfterB.within10km}  within_20km=${geoAfterB.within20km}`);

  // ── Phase 4: ID overlap ───────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 4 — ID OVERLAP (providerListingId only, NO geo proximity)');
  console.log('─'.repeat(72));

  const overlap = computeSampleOverlap(idsA, idsB);
  console.log(`\n  UNIQUE_IDS_50:         ${overlap.uniqueIds50}`);
  console.log(`  UNIQUE_IDS_100:        ${overlap.uniqueIds100}`);
  console.log(`  IDS_COMMON:            ${overlap.idsCommon}`);
  console.log(`  IDS_ONLY_50:           ${overlap.idsOnly50}`);
  console.log(`  IDS_ONLY_100:          ${overlap.idsOnly100}`);
  console.log(`  OVERLAP_50_PCT:        ${overlap.overlapPct50}%`);
  console.log(`  OVERLAP_100_PCT:       ${overlap.overlapPct100}%`);
  console.log(`  FIRST_50_OF_100_MATCH_50:   ${overlap.first50Of100MatchSet50}`);
  console.log(`  FIRST_50_OF_100_ORDER_MATCH: ${overlap.first50Of100OrderMatch50}`);
  console.log(`  AIRBNB_RESULT_ORDERING:      ${overlap.ordering}`);

  // ── Phase 5: Rank/distance correlation ───────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 5 — RANK / DISTANCE CORRELATION (CALL B, max=100)');
  console.log('─'.repeat(72));
  console.log('  band      | count | geo | nearest | median | p75   | ≤2km | ≤5km | ≤10km | ≤20km');
  console.log('  --------- | ----- | --- | ------- | ------ | ----- | ---- | ---- | ----- | -----');

  const rankProfile = computeRankDistanceProfile(listingsB, targetLat, targetLon);
  for (const b of rankProfile) {
    if (b.count === 0) continue;
    const near = fmt(b.minDistanceKm, 1).padStart(7);
    const med  = fmt(b.medianDistanceKm, 1).padStart(6);
    const p75  = fmt(b.p75DistanceKm, 1).padStart(5);
    console.log(
      `  ${b.band.padEnd(9)} | ${String(b.count).padStart(5)} | ${String(b.withGeo).padStart(3)}` +
      ` | ${near} | ${med} | ${p75} | ${String(b.within2km).padStart(4)} | ${String(b.within5km).padStart(4)}` +
      ` | ${String(b.within10km).padStart(5)} | ${String(b.within20km).padStart(5)}`
    );
  }

  // Also show rank profile for CALL A
  console.log('\n  RANK/DISTANCE CORRELATION (CALL A, max=50):');
  console.log('  band      | count | geo | nearest | median | p75   | ≤2km | ≤5km | ≤10km | ≤20km');
  console.log('  --------- | ----- | --- | ------- | ------ | ----- | ---- | ---- | ----- | -----');
  const rankProfileA = computeRankDistanceProfile(listingsA, targetLat, targetLon);
  for (const b of rankProfileA) {
    if (b.count === 0) continue;
    const near = fmt(b.minDistanceKm, 1).padStart(7);
    const med  = fmt(b.medianDistanceKm, 1).padStart(6);
    const p75  = fmt(b.p75DistanceKm, 1).padStart(5);
    console.log(
      `  ${b.band.padEnd(9)} | ${String(b.count).padStart(5)} | ${String(b.withGeo).padStart(3)}` +
      ` | ${near} | ${med} | ${p75} | ${String(b.within2km).padStart(4)} | ${String(b.within5km).padStart(4)}` +
      ` | ${String(b.within10km).padStart(5)} | ${String(b.within20km).padStart(5)}`
    );
  }

  // ── Phase 6: Category/capacity attrition by distance ─────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 6 — CATEGORY / CAPACITY ATTRITION BY DISTANCE (CALL B, max=100)');
  console.log('─'.repeat(72));
  console.log('  radius | raw_geo | after_cat | after_cap | cat_rej | cap_rej');
  console.log('  ------ | ------- | --------- | --------- | ------- | -------');

  const attrition = computeAttritionByDistance(listingsB, targetLat, targetLon, targetGuests, targetPropertyType);
  for (const b of attrition) {
    console.log(
      `  ${String(b.radiusKm).padStart(6)} | ${String(b.rawGeoCount).padStart(7)} | ${String(b.afterCatCount).padStart(9)}` +
      ` | ${String(b.afterCapCount).padStart(9)} | ${String(b.catRejected).padStart(7)} | ${String(b.capRejected).padStart(7)}`
    );
  }

  // ── Phase 7: Geo quality metrics ─────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 7 — GEO COVERAGE QUALITY METRICS');
  console.log('─'.repeat(72));

  const geoQA = evaluateSourceGeoQuality(afterFiltersA, targetLat, targetLon);
  const geoQB = evaluateSourceGeoQuality(afterFiltersB, targetLat, targetLon);

  console.log('\n  CALL_A (max=50):');
  console.log(`    GEO_COVERAGE_SCORE:   ${fmt(geoQA.geoCoverageScore)}`);
  console.log(`    GEO_QUALITY_STATUS:   ${geoQA.status}`);
  console.log(`    USABLE_FOR_CONSENSUS: ${geoQA.usableForConsensus}`);
  console.log(`    REASON:               ${geoQA.reason}`);
  console.log(`    LOCAL_COUNT:          ${geoQA.localComparableCount}  @ ${geoQA.localRadiusKm ?? 'null'} km`);
  console.log(`    NEAREST_KM:           ${fmt(geoQA.nearestDistanceKm)}`);

  console.log('\n  CALL_B (max=100):');
  console.log(`    GEO_COVERAGE_SCORE:   ${fmt(geoQB.geoCoverageScore)}`);
  console.log(`    GEO_QUALITY_STATUS:   ${geoQB.status}`);
  console.log(`    USABLE_FOR_CONSENSUS: ${geoQB.usableForConsensus}`);
  console.log(`    REASON:               ${geoQB.reason}`);
  console.log(`    LOCAL_COUNT:          ${geoQB.localComparableCount}  @ ${geoQB.localRadiusKm ?? 'null'} km`);
  console.log(`    NEAREST_KM:           ${fmt(geoQB.nearestDistanceKm)}`);

  // ── Phase 6 continued: Primary attrition reason ───────────────────────────────
  const noGeoCountB = calculateGeoCoverageQuality(listingsB, targetLat, targetLon).noGeoCount;
  const primaryAttrition = determinePrimaryAttritionReason(
    attrition, diagA.returnedCount ?? listingsA.length, diagB.returnedCount ?? listingsB.length, noGeoCountB
  );

  console.log('\n' + '─'.repeat(72));
  console.log('  PRIMARY LOCAL ATTRITION REASON');
  console.log('─'.repeat(72));
  console.log(`\n  PRIMARY_LOCAL_ATTRITION_REASON:  ${primaryAttrition}`);
  const attrBand5 = attrition.find(b => b.radiusKm === 5) || {};
  console.log(`  @ 5km: raw_geo=${attrBand5.rawGeoCount ?? 0}  after_cat=${attrBand5.afterCatCount ?? 0}  after_cap=${attrBand5.afterCapCount ?? 0}`);

  // ── Phase 11: Sample size policy recommendation ───────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 11 — SAMPLE SIZE POLICY');
  console.log('─'.repeat(72));

  const moreLocalAt100 = geoQB.localComparableCount > geoQA.localComparableCount;
  const bothUnusable   = !geoQA.usableForConsensus && !geoQB.usableForConsensus;
  const only100Usable  = !geoQA.usableForConsensus && geoQB.usableForConsensus;

  let recommendedMax;
  let recommendedReason;

  if (only100Usable) {
    recommendedMax    = 100;
    recommendedReason = 'max=50 is geo-unusable; max=100 enables usable local coverage';
  } else if (bothUnusable) {
    recommendedMax    = 100;
    recommendedReason = 'both sizes produce geo-unusable results — use 100 as best effort';
  } else if (moreLocalAt100 && geoQA.usableForConsensus) {
    recommendedMax    = 100;
    recommendedReason = 'max=100 provides more local comparables (higher geo coverage score)';
  } else if (!moreLocalAt100 && geoQA.usableForConsensus) {
    recommendedMax    = 50;
    recommendedReason = 'max=50 already provides adequate geo coverage';
  } else {
    recommendedMax    = 100;
    recommendedReason = 'inconclusive — defaulting to 100 for safety';
  }

  console.log(`\n  AIRBNB_RECOMMENDED_MAX_LISTINGS:  ${recommendedMax}`);
  console.log(`  RECOMMENDATION_REASON:            ${recommendedReason}`);

  // ── Phase 12: Stability verdict ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 12 — STABILITY VERDICT');
  console.log('─'.repeat(72));

  let stabilityVerdict;
  if (overlap.uniqueIds50 === 0 || overlap.uniqueIds100 === 0) {
    stabilityVerdict = 'INCONCLUSIVE';
  } else if (overlap.ordering === 'PREFIX_STABLE' && !moreLocalAt100) {
    stabilityVerdict = 'STABLE';
  } else if (overlap.ordering === 'PREFIX_STABLE' && moreLocalAt100) {
    stabilityVerdict = 'SIZE_SENSITIVE';
  } else if (overlap.ordering === 'PARTIALLY_STABLE') {
    stabilityVerdict = 'ORDER_SENSITIVE';
  } else if (overlap.overlapPct50 < 50) {
    stabilityVerdict = 'VOLATILITY_SUSPECTED';
  } else {
    stabilityVerdict = 'INCONCLUSIVE';
  }

  const queryFingerprint = [location, checkIn, checkOut, currency, `g=${targetGuests}`].join('|');

  console.log(`\n  CALL_A  snapshot: ${snapshotIdA}  ts: ${tsA}`);
  console.log(`  CALL_B  snapshot: ${snapshotIdB}`);
  console.log(`  query_fingerprint: ${queryFingerprint}`);
  console.log(`\n  AIRBNB_50_RAW_COUNT:    ${diagA.returnedCount ?? listingsA.length}`);
  console.log(`  AIRBNB_100_RAW_COUNT:   ${diagB.returnedCount ?? listingsB.length}`);
  console.log(`  AIRBNB_50_WITHIN_2KM:   ${calculateGeoCoverageQuality(listingsA, targetLat, targetLon).within2km}`);
  console.log(`  AIRBNB_100_WITHIN_2KM:  ${calculateGeoCoverageQuality(listingsB, targetLat, targetLon).within2km}`);
  console.log(`  AIRBNB_50_WITHIN_5KM:   ${calculateGeoCoverageQuality(listingsA, targetLat, targetLon).within5km}`);
  console.log(`  AIRBNB_100_WITHIN_5KM:  ${calculateGeoCoverageQuality(listingsB, targetLat, targetLon).within5km}`);
  console.log(`  AIRBNB_50_WITHIN_10KM:  ${calculateGeoCoverageQuality(listingsA, targetLat, targetLon).within10km}`);
  console.log(`  AIRBNB_100_WITHIN_10KM: ${calculateGeoCoverageQuality(listingsB, targetLat, targetLon).within10km}`);
  console.log(`\n  AIRBNB_SAMPLE_STABILITY_VERDICT:  ${stabilityVerdict}`);

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J SUMMARY');
  console.log('─'.repeat(72));
  const rawGeoA = calculateGeoCoverageQuality(listingsA, targetLat, targetLon);
  const rawGeoB = calculateGeoCoverageQuality(listingsB, targetLat, targetLon);
  console.log(`  AIRBNB_50_RAW_COUNT:           ${diagA.returnedCount ?? listingsA.length}`);
  console.log(`  AIRBNB_100_RAW_COUNT:          ${diagB.returnedCount ?? listingsB.length}`);
  console.log(`  AIRBNB_50_WITHIN_2KM:          ${rawGeoA.within2km}`);
  console.log(`  AIRBNB_100_WITHIN_2KM:         ${rawGeoB.within2km}`);
  console.log(`  AIRBNB_50_WITHIN_5KM:          ${rawGeoA.within5km}`);
  console.log(`  AIRBNB_100_WITHIN_5KM:         ${rawGeoB.within5km}`);
  console.log(`  AIRBNB_50_WITHIN_10KM:         ${rawGeoA.within10km}`);
  console.log(`  AIRBNB_100_WITHIN_10KM:        ${rawGeoB.within10km}`);
  console.log(`  IDS_COMMON:                    ${overlap.idsCommon}`);
  console.log(`  IDS_ONLY_50:                   ${overlap.idsOnly50}`);
  console.log(`  IDS_ONLY_100:                  ${overlap.idsOnly100}`);
  console.log(`  OVERLAP_50_PCT:                ${overlap.overlapPct50}%`);
  console.log(`  OVERLAP_100_PCT:               ${overlap.overlapPct100}%`);
  console.log(`  FIRST_50_OF_100_MATCH_50:      ${overlap.first50Of100MatchSet50}`);
  console.log(`  AIRBNB_RESULT_ORDERING:        ${overlap.ordering}`);
  console.log(`  PRIMARY_LOCAL_ATTRITION_REASON: ${primaryAttrition}`);
  console.log(`  AIRBNB_SAMPLE_STABILITY_VERDICT: ${stabilityVerdict}`);
  console.log(`  AIRBNB_RECOMMENDED_MAX_LISTINGS: ${recommendedMax}`);
  console.log(`  M6_GEO_COVERAGE_SCORE_50:       ${fmt(geoQA.geoCoverageScore)}`);
  console.log(`  M6_GEO_COVERAGE_SCORE_100:      ${fmt(geoQB.geoCoverageScore)}`);
  console.log(`  M6_GEO_QUALITY_STATUS_50:       ${geoQA.status}`);
  console.log(`  M6_GEO_QUALITY_STATUS_100:      ${geoQB.status}`);
  console.log(`  DB_WRITES:                       0`);
  console.log(`  PRICING_WRITES:                  0`);
  console.log(`  CHANNEX_CALLS:                   0`);
  console.log('═'.repeat(72) + '\n');

  return {
    ok: true,
    snapshotIdA, snapshotIdB,
    queryFingerprint,
    airbnb50RawCount:    diagA.returnedCount ?? listingsA.length,
    airbnb100RawCount:   diagB.returnedCount ?? listingsB.length,
    geoMetrics50:        rawGeoA,
    geoMetrics100:       rawGeoB,
    geoQuality50:        geoQA,
    geoQuality100:       geoQB,
    overlap,
    primaryAttritionReason: primaryAttrition,
    stabilityVerdict,
    recommendedMaxListings: recommendedMax,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/audit-airbnb-sample-stability.js --name <nom> [--execute]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const opts    = { name, pool };
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

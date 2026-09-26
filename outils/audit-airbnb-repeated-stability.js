#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-J2 — Airbnb Repeated Snapshot Stability Audit
 *
 * Runs 3 identical Airbnb Bright Data calls and measures whether the
 * resulting market signal is sufficiently stable for automated pricing.
 *
 * SAFETY:
 *   BD_CALLS       = 0 (preview) | 3 max Airbnb only (execute)
 *   DB_WRITES      = 0  always
 *   PRICING_WRITES = 0  always
 *   CHANNEX_CALLS  = 0  always
 *   BOOKING_CALLS  = 0  always
 *   BRIGHTDATA_API_KEY  never printed
 *   PRODUCTION_ROUTING_UNCHANGED
 *   MAX_AIRBNB_CALLS = 3
 *
 * KEY DESIGN (Phase 15 — do not overvalue ID churn):
 *   The stability verdict is based on geo quality + price distribution only.
 *   Low ID overlap alone does NOT produce a VOLATILE verdict.
 *   ID overlap is reported (Phase 10/11) for diagnostic purposes only.
 *
 * CLI:
 *   node outils/audit-airbnb-repeated-stability.js --name "M6"
 *   node outils/audit-airbnb-repeated-stability.js --name "M6" --execute
 */

require('dotenv').config();
const { Pool }                  = require('pg');
const { scrapeWithBrightData }  = require('../services/providers/brightdata');
const {
  haversineKm,
  isCategoryCompatible,
  isCapacityCompatible,
  selectComparables,
  calcBrightDataMarketStats,
  RADIUS_BANDS_KM,
} = require('../services/brightdata-comparable-filter');
const {
  calculateGeoCoverageQuality,
  evaluateSourceGeoQuality,
} = require('../services/market-geo-quality');
const {
  generateQueryFingerprint,
  computeOverlapMatrix,
  computeLocalOverlapMatrix,
  computeLocalPriceStability,
  computeSelectedMarketVolatility,
  evaluateRepeatedSampleStability,
} = require('../services/market-repeated-snapshot-stability');
const { getFallbackZones }  = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency } = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS   = 3;
const MAX_LISTINGS     = 100;
const N_SNAPSHOTS      = 3;
const LOCAL_RADII      = [2, 5, 10];
const PRICE_RADII      = [2, 3, 5, 10];

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

// ── Quality filter funnel (Phase 7) ───────────────────────────────────────────

function computeQualityFunnel(listings, targetGuests, targetPropertyType) {
  const seen     = new Set();
  const deduped  = [];
  let   dupCount = 0;
  for (const l of listings) {
    const id = l.providerListingId;
    if (id != null) {
      if (seen.has(id)) { dupCount++; continue; }
      seen.add(id);
    }
    deduped.push(l);
  }

  let catRej = 0, catMiss = 0;
  const afterCat = deduped.filter(l => {
    const r = isCategoryCompatible(l.category, targetPropertyType);
    if (r === false) { catRej++; return false; }
    if (r === null)    catMiss++;
    return true;
  });

  let capRej = 0, capMiss = 0;
  const afterCap = afterCat.filter(l => {
    const r = isCapacityCompatible(l.guests, targetGuests);
    if (r === false) { capRej++; return false; }
    if (r === null)    capMiss++;
    return true;
  });

  return {
    raw:              listings.length,
    afterDedup:       deduped.length,
    afterCategory:    afterCat.length,
    afterCapacity:    afterCap.length,
    qualityPool:      afterCap,
    dedupRejected:    dupCount,
    categoryRejected: catRej,
    categoryMissing:  catMiss,
    capacityRejected: capRej,
    capacityMissing:  capMiss,
  };
}

// ── Extra percentiles (p10, p90, max) for Phase 6 ─────────────────────────────

function extraPercentiles(listings, targetLat, targetLon) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
    return { p10: null, p90: null, max: null };
  }
  const dists = listings
    .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    .map(l => haversineKm(targetLat, targetLon, l.latitude, l.longitude))
    .filter(d => Number.isFinite(d))
    .sort((a, b) => a - b);
  if (!dists.length) return { p10: null, p90: null, max: null };
  const n = dists.length;
  return {
    p10: dists[Math.floor(n * 0.10)],
    p90: dists[Math.floor(n * 0.90)],
    max: dists[n - 1],
  };
}

// ── Print helpers ─────────────────────────────────────────────────────────────

function printSnapshotHeader(label, snapshotId, requestedMax, rawReturnedCount, acceptedCount) {
  console.log(`\n  ── ${label} ──────────────────────────────────────────────────`);
  console.log(`    snapshotId:              ${snapshotId || 'unknown'}`);
  console.log(`    REQUESTED_MAX_LISTINGS:  ${requestedMax}`);
  console.log(`    RAW_RETURNED_COUNT:      ${rawReturnedCount ?? 'unknown'}`);
  console.log(`    ADAPTER_ACCEPTED_COUNT:  ${acceptedCount}`);
}

function printRawGeoMetrics(listings, targetLat, targetLon) {
  const m   = calculateGeoCoverageQuality(listings, targetLat, targetLon);
  const ext = extraPercentiles(listings, targetLat, targetLon);
  console.log(`    WITH_GEO:                ${m.geoListingCount}`);
  console.log(`    WITHOUT_GEO:             ${m.noGeoCount}`);
  if (m.geoListingCount > 0) {
    console.log(`    nearest_km:              ${fmt(m.nearestDistanceKm)}`);
    console.log(`    p10_km:                  ${fmt(ext.p10)}`);
    console.log(`    p25_km:                  ${fmt(m.p25DistanceKm)}`);
    console.log(`    median_km:               ${fmt(m.medianDistanceKm)}`);
    console.log(`    p75_km:                  ${fmt(m.p75DistanceKm)}`);
    console.log(`    p90_km:                  ${fmt(ext.p90)}`);
    console.log(`    max_km:                  ${fmt(ext.max)}`);
    console.log(`    within_1km:   ${String(m.within1km).padStart(3)}  (${pctOf(m.within1km, m.geoListingCount)})`);
    console.log(`    within_2km:   ${String(m.within2km).padStart(3)}  (${pctOf(m.within2km, m.geoListingCount)})`);
    console.log(`    within_3km:   ${String(m.within3km).padStart(3)}  (${pctOf(m.within3km, m.geoListingCount)})`);
    console.log(`    within_5km:   ${String(m.within5km).padStart(3)}  (${pctOf(m.within5km, m.geoListingCount)})`);
    console.log(`    within_10km:  ${String(m.within10km).padStart(3)}  (${pctOf(m.within10km, m.geoListingCount)})`);
    console.log(`    within_20km:  ${String(m.within20km).padStart(3)}  (${pctOf(m.within20km, m.geoListingCount)})`);
    console.log(`    beyond_20km:  ${m.beyond20km}`);
  }
}

function printQualityFunnel(funnel) {
  console.log(`    RAW (adapter accepted):  ${funnel.raw}`);
  console.log(`    AFTER_DEDUP:             ${funnel.afterDedup}  (dup_rejected=${funnel.dedupRejected})`);
  console.log(`    AFTER_CATEGORY:          ${funnel.afterCategory}  (cat_rejected=${funnel.categoryRejected}  cat_missing=${funnel.categoryMissing})`);
  console.log(`    AFTER_CAPACITY:          ${funnel.afterCapacity}  (cap_rejected=${funnel.capacityRejected}  cap_missing=${funnel.capacityMissing})`);
  console.log(`    QUALITY_POOL:            ${funnel.qualityPool.length}`);
}

function printQualityPoolGeo(qualityPool, targetLat, targetLon) {
  const m = calculateGeoCoverageQuality(qualityPool, targetLat, targetLon);
  console.log(`    pool_within_1km:   ${m.within1km}`);
  console.log(`    pool_within_2km:   ${m.within2km}`);
  console.log(`    pool_within_3km:   ${m.within3km}`);
  console.log(`    pool_within_5km:   ${m.within5km}`);
  console.log(`    pool_within_10km:  ${m.within10km}`);
  console.log(`    pool_within_20km:  ${m.within20km}`);
}

function printGeoQuality(gq) {
  console.log(`    GEO_COVERAGE_SCORE:      ${fmt(gq.geoCoverageScore)}`);
  console.log(`    GEO_QUALITY_STATUS:      ${gq.status}`);
  console.log(`    USABLE_FOR_CONSENSUS:    ${gq.usableForConsensus}`);
  console.log(`    REASON:                  ${gq.reason}`);
  console.log(`    LOCAL_COUNT:             ${gq.localComparableCount}  @ ${gq.localRadiusKm ?? 'null'} km`);
  console.log(`    NEAREST_KM:              ${fmt(gq.nearestDistanceKm)}`);
  console.log(`    MEDIAN_KM:               ${fmt(gq.medianDistanceKm)}`);
}

function printSelectedMarket(sel) {
  console.log(`    SELECTION_STATUS:        ${sel.status}`);
  console.log(`    SELECTED_RADIUS_KM:      ${sel.selectedRadiusKm ?? 'null'}`);
  console.log(`    FINAL_COMPARABLE_COUNT:  ${sel.comparableCount}`);
  if (sel.stats) {
    console.log(`    PRICE_MIN:               ${fmt(sel.stats.min ?? null)}`);
    console.log(`    PRICE_P25:               ${fmt(sel.stats.p25)}`);
    console.log(`    PRICE_MEDIAN:            ${fmt(sel.stats.median)}`);
    console.log(`    PRICE_P75:               ${fmt(sel.stats.p75)}`);
    console.log(`    PRICE_MAX:               ${fmt(sel.stats.max ?? null)}`);
    console.log(`    OCCUPANCY:               ${sel.stats.occupancy ?? 'null'}%`);
    console.log(`    OCCUPANCY_SEMANTICS:     ${sel.stats.occupancy_semantics}`);
    console.log(`    TENSION_LEVEL:           ${sel.stats.tensionLevel ?? 'null'}`);
  }
}

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode({ name, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J2 Airbnb Repeated Snapshot Stability — PREVIEW MODE');
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

  const fp = generateQueryFingerprint({
    location: zones[0], currency, checkIn, checkOut,
    maxListings: MAX_LISTINGS,
    targetLat: prop.latitude  != null ? parseFloat(prop.latitude)  : null,
    targetLon: prop.longitude != null ? parseFloat(prop.longitude) : null,
    targetGuests: prop.max_guests || null,
    targetPropertyType: 'entire_place',
  });

  console.log('\n  PROPERTY:');
  console.log(`    name:         ${prop.internal_name || prop.name}`);
  console.log(`    lat/lon:      ${prop.latitude} / ${prop.longitude}`);
  console.log(`    currency:     ${currency}  timezone: ${timezone}`);
  console.log(`    max_guests:   ${prop.max_guests ?? 'NULL'}`);

  console.log('\n  PLANNED AIRBNB CALLS (not executed):');
  console.log(`    dataset:      gd_ld7ll037kqy322v05 (discover_new, discover_by=location)`);
  console.log(`    location:     ${zones[0]}`);
  console.log(`    check_in:     ${checkIn}   check_out: ${checkOut}`);
  console.log(`    nights:       ${DEFAULT_NIGHTS}`);
  console.log(`    CALL_A:       max_listings = ${MAX_LISTINGS}`);
  console.log(`    CALL_B:       max_listings = ${MAX_LISTINGS}`);
  console.log(`    CALL_C:       max_listings = ${MAX_LISTINGS}`);
  console.log(`    MAX_BD_CALLS: ${N_SNAPSHOTS} (Airbnb only — NO Booking call)`);
  console.log(`    QUERY_FINGERPRINT: ${fp}`);

  console.log('\n  PHASES (execute):');
  console.log(`     5 — Query fingerprint validation (must be identical for A/B/C)`);
  console.log(`     6 — Per-snapshot raw metrics (geo distribution, p10..p90)`);
  console.log(`     7 — Quality filter funnel (dedup → category → capacity)`);
  console.log(`     8 — Geo quality gate (GOOD/DEGRADED/POOR/UNUSABLE)`);
  console.log(`     9 — Selected market (selectComparables + calcBrightDataMarketStats)`);
  console.log(`    10 — ID overlap matrix (A∩B, A∩C, B∩C, A∩B∩C)`);
  console.log(`    11 — Local ID overlap (within 2/5/10 km)`);
  console.log(`    12 — Local price stability (per radius)`);
  console.log(`    13 — Selected-market price volatility`);
  console.log(`    16 — Policy recommendation`);

  console.log('\n  Ready: node outils/audit-airbnb-repeated-stability.js --name <nom> --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true, queryFingerprint: fp };
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode({ name, _airbnbScrape, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J2 Airbnb Repeated Snapshot Stability — EXECUTE MODE');
  console.log(`  BD_CALLS=${N_SNAPSHOTS} Airbnb only | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0`);
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
  const targetGuests       = prop.max_guests || null;
  const targetPropertyType = 'entire_place';

  console.log(`\n  Property: ${prop.internal_name || prop.name}`);
  console.log(`  lat=${targetLat}  lon=${targetLon}  guests=${targetGuests}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}  nights=${DEFAULT_NIGHTS}`);
  console.log(`  max_listings=${MAX_LISTINGS}  snapshots=${N_SNAPSHOTS}`);

  // ── Phase 5: Query fingerprint ─────────────────────────────────────────────

  const fpParams = {
    location, currency, checkIn, checkOut,
    maxListings: MAX_LISTINGS,
    targetLat, targetLon, targetGuests, targetPropertyType,
  };
  const queryFingerprint = generateQueryFingerprint(fpParams);

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 5 — QUERY FINGERPRINT');
  console.log('─'.repeat(72));
  console.log(`\n  QUERY_FINGERPRINT_A:  ${queryFingerprint}`);
  console.log(`  QUERY_FINGERPRINT_B:  ${queryFingerprint}`);
  console.log(`  QUERY_FINGERPRINT_C:  ${queryFingerprint}`);
  console.log(`  QUERY_FINGERPRINTS_IDENTICAL: YES  (computed before calls — all use same parameters)`);

  // ── Three identical Airbnb BD calls ───────────────────────────────────────

  const airbnbFunc = _airbnbScrape || scrapeWithBrightData;
  const callOpts   = { checkIn, checkOut };
  const labels     = ['A', 'B', 'C'];
  const results    = [];

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    console.log(`\n  🔍 [CALL ${labels[i]}] Airbnb BD — max_listings=${MAX_LISTINGS}  …`);
    const r = await airbnbFunc(location, MAX_LISTINGS, currency, callOpts);
    results.push(r);
  }

  const snapshotIds = results.map(r => r.snapshotId || 'unknown');
  const diags       = results.map(r => r.diagnostics || {});
  const listings    = results.map(r => r.listings);

  // ── Phase 6: Per-snapshot raw metrics ─────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 6 — PER-SNAPSHOT RAW METRICS');
  console.log('─'.repeat(72));

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    printSnapshotHeader(
      `SNAPSHOT ${labels[i]}`, snapshotIds[i],
      MAX_LISTINGS, diags[i].returnedCount, listings[i].length
    );
    printRawGeoMetrics(listings[i], targetLat, targetLon);
  }

  // ── Phase 7: Quality filter funnel ────────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 7 — QUALITY FILTER FUNNEL');
  console.log('─'.repeat(72));

  const funnels = listings.map(ls => computeQualityFunnel(ls, targetGuests, targetPropertyType));

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    console.log(`\n  SNAPSHOT ${labels[i]}:`);
    printQualityFunnel(funnels[i]);
    console.log('    GEO COUNTS AFTER QUALITY FILTERS:');
    printQualityPoolGeo(funnels[i].qualityPool, targetLat, targetLon);
  }

  // ── Phase 8: Geo quality per snapshot ─────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 8 — GEO QUALITY GATE');
  console.log('─'.repeat(72));

  const geoQualities = funnels.map(f => evaluateSourceGeoQuality(f.qualityPool, targetLat, targetLon));

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    console.log(`\n  SNAPSHOT ${labels[i]}:`);
    printGeoQuality(geoQualities[i]);
  }

  // ── Phase 9: Selected market per snapshot ─────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 9 — SELECTED MARKET PER SNAPSHOT');
  console.log('─'.repeat(72));

  const selectedMarkets = listings.map(ls => {
    const sel   = selectComparables(ls, { targetLat, targetLon, targetGuests, targetPropertyType });
    const stats = sel.status === 'ok' && sel.listings.length > 0
      ? calcBrightDataMarketStats(sel.listings)
      : null;
    return {
      status:          sel.status,
      selectedRadiusKm: sel.selectedRadiusKm,
      comparableCount: sel.diagnostics.comparableCount,
      stats,
    };
  });

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    console.log(`\n  SNAPSHOT ${labels[i]}:`);
    printSelectedMarket(selectedMarkets[i]);
  }

  // ── Phase 10: ID overlap matrix ───────────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 10 — ID OVERLAP MATRIX (providerListingId only, NO geo proximity)');
  console.log('─'.repeat(72));

  const rawIds = listings.map(ls => ls.map(l => l.providerListingId).filter(Boolean));
  const overlapMatrix = computeOverlapMatrix(rawIds[0], rawIds[1], rawIds[2]);

  console.log(`\n  RAW_IDS_A:      ${overlapMatrix.rawIdsA}`);
  console.log(`  RAW_IDS_B:      ${overlapMatrix.rawIdsB}`);
  console.log(`  RAW_IDS_C:      ${overlapMatrix.rawIdsC}`);
  console.log(`\n  RAW_COMMON_AB:   ${overlapMatrix.commonAB}  (${overlapMatrix.overlapABpct}% of A)`);
  console.log(`  RAW_COMMON_AC:   ${overlapMatrix.commonAC}  (${overlapMatrix.overlapACpct}% of A)`);
  console.log(`  RAW_COMMON_BC:   ${overlapMatrix.commonBC}  (${overlapMatrix.overlapBCpct}% of B)`);
  console.log(`  RAW_COMMON_ABC:  ${overlapMatrix.commonABC}`);

  // Quality pool overlap
  const qualityIds = funnels.map(f => f.qualityPool.map(l => l.providerListingId).filter(Boolean));
  const qualOverlap = computeOverlapMatrix(qualityIds[0], qualityIds[1], qualityIds[2]);

  console.log(`\n  QUALITY_COMMON_AB:   ${qualOverlap.commonAB}  (${qualOverlap.overlapABpct}% of A)`);
  console.log(`  QUALITY_COMMON_AC:   ${qualOverlap.commonAC}  (${qualOverlap.overlapACpct}% of A)`);
  console.log(`  QUALITY_COMMON_BC:   ${qualOverlap.commonBC}  (${qualOverlap.overlapBCpct}% of B)`);
  console.log(`  QUALITY_COMMON_ABC:  ${qualOverlap.commonABC}`);

  // ── Phase 11: Local ID overlap ────────────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 11 — LOCAL ID OVERLAP (quality pool within radius)');
  console.log('─'.repeat(72));
  console.log('  radius | A_cnt | B_cnt | C_cnt | AB | AC | BC | ABC');
  console.log('  ------ | ----- | ----- | ----- | -- | -- | -- | ---');

  const localOverlap = computeLocalOverlapMatrix(
    funnels[0].qualityPool, funnels[1].qualityPool, funnels[2].qualityPool,
    targetLat, targetLon, LOCAL_RADII
  );

  for (const r of localOverlap) {
    console.log(
      `  ${String(r.radiusKm).padStart(4)}km | ` +
      `${String(r.aCount).padStart(5)} | ${String(r.bCount).padStart(5)} | ${String(r.cCount).padStart(5)} | ` +
      `${String(r.commonAB).padStart(2)} | ${String(r.commonAC).padStart(2)} | ` +
      `${String(r.commonBC).padStart(2)} | ${String(r.commonABC).padStart(3)}`
    );
  }

  // ── Phase 12: Local price stability ──────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 12 — LOCAL PRICE STABILITY (quality pool, per radius)');
  console.log('─'.repeat(72));

  const localPrices = computeLocalPriceStability(
    funnels[0].qualityPool, funnels[1].qualityPool, funnels[2].qualityPool,
    targetLat, targetLon, PRICE_RADII
  );

  for (const r of localPrices) {
    console.log(`\n  radius = ${r.radiusKm} km:`);
    for (const [lbl, s] of [['A', r.A], ['B', r.B], ['C', r.C]]) {
      if (s) {
        console.log(`    ${lbl}:  n=${s.count}  p25=${fmt(s.p25)}  median=${fmt(s.median)}  p75=${fmt(s.p75)}`);
      } else {
        console.log(`    ${lbl}:  insufficient data (< 2 listings with price)`);
      }
    }
    if (r.medianSpreadAbs != null) {
      console.log(`    MEDIAN_MIN=${fmt(r.medianMin)}  MEDIAN_MAX=${fmt(r.medianMax)}`);
      console.log(`    MEDIAN_SPREAD_ABS=${fmt(r.medianSpreadAbs)}  MEDIAN_SPREAD_PCT=${fmt(r.medianSpreadPct)}%`);
    } else {
      console.log('    MEDIAN_SPREAD: insufficient data');
    }
  }

  // ── Phase 13: Selected-market price volatility ────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 13 — SELECTED-MARKET PRICE VOLATILITY');
  console.log('─'.repeat(72));

  const volatility = computeSelectedMarketVolatility(
    selectedMarkets.map(sm => ({
      selectedMedian:   sm.stats?.median   ?? null,
      selectedRadiusKm: sm.selectedRadiusKm ?? null,
    }))
  );

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    const sm = selectedMarkets[i];
    console.log(`\n  ${labels[i]}_SELECTED_RADIUS:  ${sm.selectedRadiusKm ?? 'null'} km`);
    console.log(`  ${labels[i]}_SELECTED_MEDIAN:  ${fmt(sm.stats?.median ?? null)}`);
  }

  console.log(`\n  SELECTED_MEDIAN_MIN:       ${fmt(volatility.selectedMedianMin)}`);
  console.log(`  SELECTED_MEDIAN_MAX:       ${fmt(volatility.selectedMedianMax)}`);
  console.log(`  SELECTED_MEDIAN_MEAN:      ${fmt(volatility.selectedMedianMean)}`);
  console.log(`  SELECTED_MEDIAN_SPREAD_ABS: ${fmt(volatility.selectedMedianSpreadAbs)}`);
  console.log(`  SELECTED_MEDIAN_SPREAD_PCT: ${fmt(volatility.selectedMedianSpreadPct)}%`);
  console.log(`  SELECTED_RADIUS_MIN:       ${volatility.selectedRadiusMin ?? 'null'} km`);
  console.log(`  SELECTED_RADIUS_MAX:       ${volatility.selectedRadiusMax ?? 'null'} km`);

  // ── Stability verdict ─────────────────────────────────────────────────────

  const snapshotAnalyses = selectedMarkets.map((sm, i) => ({
    queryFingerprint,
    geoQuality:     geoQualities[i],
    selectedMarket: sm,
  }));

  const stability = evaluateRepeatedSampleStability(snapshotAnalyses);

  // ── Phase 16: Policy recommendation ──────────────────────────────────────

  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 16 — RETRY POLICY ANALYSIS');
  console.log('─'.repeat(72));

  console.log(`\n  QUERY_FINGERPRINTS_IDENTICAL:           YES`);
  console.log(`  SNAPSHOT_ID_AVAILABLE:                  ${snapshotIds[0] !== 'unknown' ? 'YES' : 'NO'}`);

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    console.log(`\n  SNAPSHOT_${labels[i]}_GEO_STATUS:             ${geoQualities[i].status}`);
    console.log(`  SNAPSHOT_${labels[i]}_USABLE_FOR_CONSENSUS:    ${geoQualities[i].usableForConsensus}`);
    console.log(`  SNAPSHOT_${labels[i]}_GEO_SCORE:               ${fmt(geoQualities[i].geoCoverageScore)}`);
  }

  console.log(`\n  STABILITY_USABLE_COUNT:                 ${stability.usableCount} / ${N_SNAPSHOTS}`);
  console.log(`  SELECTED_MEDIAN_SPREAD_PCT:             ${fmt(volatility.selectedMedianSpreadPct)}%`);
  console.log(`\n  REPEATED_SAMPLE_STABILITY_VERDICT:      ${stability.verdict}`);
  console.log(`  VERDICT_REASON:                         ${stability.verdictReason}`);
  console.log(`\n  RECOMMENDED_AIRBNB_PRODUCTION_POLICY:   ${stability.policyRecommendation}`);
  console.log(`  POLICY_REASON:                          ${stability.policyReason}`);

  const safeToUse = stability.verdict === 'STABLE' || stability.verdict === 'ACCEPTABLE_VARIATION';
  console.log(`\n  SAFE_TO_USE_ONE_AIRBNB_SNAPSHOT:        ${safeToUse ? 'LIKELY_YES — see policy' : 'NO — see verdict'}`);
  console.log(`  SAFE_TO_START_B5_BK_K:                  NO — requires live evidence review`);

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J2 SUMMARY');
  console.log('─'.repeat(72));

  console.log(`  MAX_AIRBNB_CALLS:              ${N_SNAPSHOTS}`);
  console.log(`  MAX_LISTINGS_PER_CALL:         ${MAX_LISTINGS}`);
  console.log(`  QUERY_FINGERPRINTS_IDENTICAL:  YES`);
  console.log(`  SNAPSHOT_ID_AVAILABLE:         ${snapshotIds[0] !== 'unknown' ? 'YES' : 'NO'}`);

  for (let i = 0; i < N_SNAPSHOTS; i++) {
    const d  = diags[i];
    const sm = selectedMarkets[i];
    const gq = geoQualities[i];
    const sid = snapshotIds[i];
    console.log(`\n  SNAPSHOT_${labels[i]}:`);
    console.log(`    snapshotId:                ${sid}`);
    console.log(`    REQUESTED_MAX_LISTINGS:    ${MAX_LISTINGS}`);
    console.log(`    RAW_RETURNED_COUNT:        ${d.returnedCount ?? 'unknown'}`);
    console.log(`    ADAPTER_ACCEPTED_COUNT:    ${listings[i].length}`);
    const rawGeo = calculateGeoCoverageQuality(listings[i], targetLat, targetLon);
    console.log(`    WITHIN_2KM:                ${rawGeo.within2km}`);
    console.log(`    WITHIN_5KM:                ${rawGeo.within5km}`);
    console.log(`    WITHIN_10KM:               ${rawGeo.within10km}`);
    console.log(`    GEO_STATUS:                ${gq.status}`);
    console.log(`    GEO_SCORE:                 ${fmt(gq.geoCoverageScore)}`);
    console.log(`    USABLE_FOR_CONSENSUS:      ${gq.usableForConsensus}`);
    console.log(`    SELECTED_RADIUS_KM:        ${sm.selectedRadiusKm ?? 'null'}`);
    console.log(`    SELECTED_MEDIAN:           ${fmt(sm.stats?.median ?? null)}`);
  }

  console.log(`\n  RAW_COMMON_AB:                 ${overlapMatrix.commonAB}`);
  console.log(`  RAW_COMMON_AC:                 ${overlapMatrix.commonAC}`);
  console.log(`  RAW_COMMON_BC:                 ${overlapMatrix.commonBC}`);
  console.log(`  RAW_COMMON_ABC:                ${overlapMatrix.commonABC}`);

  if (localOverlap.length > 0) {
    const r5 = localOverlap.find(r => r.radiusKm === 5);
    if (r5) {
      console.log(`\n  LOCAL_5KM_COMMON_AB:           ${r5.commonAB}`);
      console.log(`  LOCAL_5KM_COMMON_AC:           ${r5.commonAC}`);
      console.log(`  LOCAL_5KM_COMMON_BC:           ${r5.commonBC}`);
      console.log(`  LOCAL_5KM_COMMON_ABC:          ${r5.commonABC}`);
    }
  }

  console.log(`\n  SELECTED_MEDIAN_SPREAD_PCT:    ${fmt(volatility.selectedMedianSpreadPct)}%`);
  console.log(`  REPEATED_SAMPLE_STABILITY_VERDICT:    ${stability.verdict}`);
  console.log(`  RECOMMENDED_AIRBNB_PRODUCTION_POLICY: ${stability.policyRecommendation}`);
  console.log(`  SAFE_TO_START_B5_BK_K:                NO`);
  console.log(`\n  PRODUCTION_ROUTING_CHANGED:    NO`);
  console.log(`  BOOKING_PRODUCTION_ROUTING:    DISABLED`);
  console.log(`  DB_WRITES:                     0`);
  console.log(`  PRICING_WRITES:                0`);
  console.log(`  CHANNEX_CALLS:                 0`);
  console.log('═'.repeat(72) + '\n');

  return {
    ok: true,
    queryFingerprint,
    snapshotIds,
    listings,
    funnels,
    geoQualities,
    selectedMarkets,
    overlapMatrix,
    localOverlap,
    volatility,
    stability,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/audit-airbnb-repeated-stability.js --name <nom> [--execute]');
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

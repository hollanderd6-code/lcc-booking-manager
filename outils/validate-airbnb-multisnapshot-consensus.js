#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-J3 — Airbnb Multi-Snapshot Consensus Validator
 *
 * Diagnostic-only tool. Makes 3 identical Airbnb scrape calls, builds quality
 * pools, then runs the consensus algorithm and prints a structured report.
 *
 * SAFETY:
 *   DB_WRITES        = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0  — no channex import
 *   PRICING_WRITES   = 0  — no pricing-apply import
 *   BRIGHTDATA_API_KEY is NEVER printed/logged
 *
 * Ce validateur J3 NE DOIT PAS activer le pricing production.
 * Il est diagnostic-only et ne modifie aucun tarif ni aucune configuration.
 *
 * Usage (live):
 *   node outils/validate-airbnb-multisnapshot-consensus.js
 *
 * Configuration (env vars or constants below):
 *   AIRBNB_TARGET_LAT, AIRBNB_TARGET_LON, AIRBNB_LOCATION, AIRBNB_CURRENCY,
 *   AIRBNB_CHECK_IN, AIRBNB_CHECK_OUT, AIRBNB_MAX_LISTINGS
 *   AIRBNB_TARGET_GUESTS (optional), AIRBNB_TARGET_PROPERTY_TYPE (optional)
 */

const { scrapeWithBrightData }                = require('../services/providers/brightdata');
const { buildCrossSourceQualityPool }         = require('../services/market-cross-source-policy');
const { evaluateSourceGeoQuality }            = require('../services/market-geo-quality');
const { calcBrightDataMarketStats }           = require('../services/brightdata-comparable-filter');
const {
  findCommonSnapshotRadius,
  calculateSnapshotConsensusWeight,
  calculateSnapshotSpread,
  detectSnapshotOutliers,
  classifySnapshotConsensusConfidence,
  shouldRequestThirdSnapshot,
  buildAirbnbMultiSnapshotConsensus,
} = require('../services/airbnb-multi-snapshot-consensus');

// ── Configuration ─────────────────────────────────────────────────────────────

const CONFIG = {
  location:            process.env.AIRBNB_LOCATION            || 'Massy, France',
  currency:            process.env.AIRBNB_CURRENCY            || 'EUR',
  checkIn:             process.env.AIRBNB_CHECK_IN            || '2025-07-04',
  checkOut:            process.env.AIRBNB_CHECK_OUT           || '2025-07-07',
  maxListings:         parseInt(process.env.AIRBNB_MAX_LISTINGS || '100', 10),
  targetLat:           parseFloat(process.env.AIRBNB_TARGET_LAT || '48.726'),
  targetLon:           parseFloat(process.env.AIRBNB_TARGET_LON || '2.272'),
  targetGuests:        process.env.AIRBNB_TARGET_GUESTS        ? parseInt(process.env.AIRBNB_TARGET_GUESTS, 10) : null,
  targetPropertyType:  process.env.AIRBNB_TARGET_PROPERTY_TYPE || 'entire_place',
  nSnapshots:          3,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const LABEL = ['A', 'B', 'C'];

function banner(phase, title) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  PHASE ${phase}: ${title}`);
  console.log('═'.repeat(72));
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

function printQualityPool(pool, label) {
  const d = pool.diagnostics;
  console.log(`  [${label}] quality pool`);
  console.log(`    input:        ${d.inputCount}`);
  console.log(`    dedup:        −${d.dedupRejected}`);
  console.log(`    cat rejected: −${d.catRejected}  (missing: ${d.catMissing})`);
  console.log(`    cap rejected: −${d.capRejected}  (missing: ${d.capMissing ?? '?'})`);
  console.log(`    output:       ${d.outputCount}`);
}

function printGeoQuality(gq, label) {
  console.log(`  [${label}] geo quality`);
  console.log(`    status:         ${gq.status}`);
  console.log(`    geoScore:       ${gq.geoCoverageScore}`);
  console.log(`    usable:         ${gq.usableForConsensus}`);
  console.log(`    localCount:     ${gq.localComparableCount}  (radius: ${gq.localRadiusKm ?? '?'} km)`);
  console.log(`    nearest:        ${gq.nearestDistanceKm?.toFixed(2) ?? '?'} km`);
  console.log(`    median dist:    ${gq.medianDistanceKm?.toFixed(2) ?? '?'} km`);
}

// ── Main run ──────────────────────────────────────────────────────────────────

async function run(_airbnbScrape) {
  const scrape = _airbnbScrape || scrapeWithBrightData;
  const today  = new Date().toISOString().slice(0, 10);

  // ── PHASE 1: Setup ──────────────────────────────────────────────────────────
  banner(1, 'PROPERTY / QUERY SETUP');
  console.log(`  location:             ${CONFIG.location}`);
  console.log(`  currency:             ${CONFIG.currency}`);
  console.log(`  checkIn:              ${CONFIG.checkIn}`);
  console.log(`  checkOut:             ${CONFIG.checkOut}`);
  console.log(`  maxListings:          ${CONFIG.maxListings}`);
  console.log(`  targetLat:            ${CONFIG.targetLat}`);
  console.log(`  targetLon:            ${CONFIG.targetLon}`);
  console.log(`  targetGuests:         ${CONFIG.targetGuests ?? '(unset)'}`);
  console.log(`  targetPropertyType:   ${CONFIG.targetPropertyType ?? '(unset)'}`);
  console.log(`  nSnapshots:           ${CONFIG.nSnapshots}`);
  console.log(`  today (for occupancy):`);
  console.log(`    ${today}`);

  // ── PHASE 2: Snapshot calls ─────────────────────────────────────────────────
  banner(2, 'SNAPSHOT CALLS (3 × scrapeWithBrightData)');

  const rawSnapshots = [];
  for (let i = 0; i < CONFIG.nSnapshots; i++) {
    const label = LABEL[i];
    console.log(`\n  [${label}] scraping…`);
    const t0   = Date.now();
    const result = await scrape(
      CONFIG.location, CONFIG.maxListings, CONFIG.currency,
      { checkIn: CONFIG.checkIn, checkOut: CONFIG.checkOut }
    );
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const diag    = result.diagnostics;
    console.log(`    snapshotId:           ${result.snapshotId}`);
    console.log(`    returnedCount:        ${diag.returnedCount}`);
    console.log(`    acceptedCount:        ${diag.acceptedCount}`);
    console.log(`    rejectedPrice:        ${diag.rejectedPriceCount}`);
    console.log(`    rejectedCurrency:     ${diag.rejectedCurrencyCount}`);
    console.log(`    rejectedAvailability: ${diag.rejectedAvailabilityCount}`);
    console.log(`    elapsed:              ${elapsed}s`);
    rawSnapshots.push(result);
  }

  // ── PHASE 3: Quality pools + geo quality ────────────────────────────────────
  banner(3, 'QUALITY POOLS + GEO QUALITY');

  const snapshots = rawSnapshots.map((result, i) => {
    const label = LABEL[i];
    const pool  = buildCrossSourceQualityPool(result.listings, 'airbnb', {
      targetGuests:       CONFIG.targetGuests,
      targetPropertyType: CONFIG.targetPropertyType,
    });
    printQualityPool(pool, label);

    const geoQuality = evaluateSourceGeoQuality(
      pool.listings, CONFIG.targetLat, CONFIG.targetLon
    );
    printGeoQuality(geoQuality, label);

    return {
      snapshotId:  result.snapshotId,
      listings:    pool.listings,
      geoQuality,
    };
  });

  // ── PHASE 4: Common radius ──────────────────────────────────────────────────
  banner(4, 'COMMON RADIUS');

  const radiusResult = findCommonSnapshotRadius(snapshots, CONFIG.targetLat, CONFIG.targetLon);
  console.log(`  commonRadiusKm:  ${radiusResult.commonRadiusKm ?? 'null (no common radius found)'}`);
  console.log(`  reason:          ${radiusResult.reason}`);
  console.log(`  eligible per radius:`);
  for (const [r, count] of Object.entries(radiusResult.eligiblePerRadius)) {
    console.log(`    ${r} km → ${count} eligible snapshots`);
  }

  // ── PHASE 5: Stats at common radius ─────────────────────────────────────────
  banner(5, 'STATS AT COMMON RADIUS');

  if (radiusResult.commonRadiusKm == null) {
    console.log('  (skipped — no common radius)');
  } else {
    const r = radiusResult.commonRadiusKm;
    const { haversineKm } = require('../services/brightdata-comparable-filter');

    for (let i = 0; i < snapshots.length; i++) {
      const label    = LABEL[i];
      const snap     = snapshots[i];
      const atRadius = snap.listings.filter(l =>
        Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
        haversineKm(CONFIG.targetLat, CONFIG.targetLon, l.latitude, l.longitude) <= r
      );
      const stats  = atRadius.length >= 1 ? calcBrightDataMarketStats(atRadius, { today }) : null;
      const weight = calculateSnapshotConsensusWeight(snap, r, CONFIG.targetLat, CONFIG.targetLon);

      console.log(`\n  [${label}] @${r}km`);
      console.log(`    countAtRadius:  ${atRadius.length}`);
      console.log(`    weight:         ${weight.toFixed(4)}`);
      if (stats) {
        console.log(`    median:         ${stats.median}`);
        console.log(`    p25/p75:        ${stats.p25} / ${stats.p75}`);
        console.log(`    count:          ${stats.count}`);
        console.log(`    occupancy:      ${stats.occupancy_semantics === 'calendar_unavailability_proxy' ? stats.occupancy + '%' : '(' + stats.occupancy_semantics + ')'}`);
      } else {
        console.log(`    stats:          null (insufficient listings at radius)`);
      }
    }
  }

  // ── PHASE 6: Outlier analysis ───────────────────────────────────────────────
  banner(6, 'OUTLIER ANALYSIS');

  const outlierInputs = snapshots.map((s, i) => {
    const r = radiusResult.commonRadiusKm;
    if (r == null) return { snapshotIndex: i, snapshotId: s.snapshotId, median: null };
    const { haversineKm } = require('../services/brightdata-comparable-filter');
    const atRadius = s.listings.filter(l =>
      Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
      haversineKm(CONFIG.targetLat, CONFIG.targetLon, l.latitude, l.longitude) <= r
    );
    const stats = atRadius.length >= 1 ? calcBrightDataMarketStats(atRadius, { today }) : null;
    return { snapshotIndex: i, snapshotId: s.snapshotId, median: stats?.median ?? null };
  });

  const outlierAnalysis = detectSnapshotOutliers(outlierInputs);
  for (const o of outlierAnalysis) {
    const label = LABEL[o.snapshotIndex] ?? o.snapshotIndex;
    console.log(`  [${label}] median=${o.median ?? 'null'}  center=${o.center?.toFixed(1) ?? 'null'}  dev=${o.deviationPct?.toFixed(1) ?? '?'}%  → ${o.outlierStatus}`);
  }

  // ── PHASE 7: Consensus ──────────────────────────────────────────────────────
  banner(7, 'CONSENSUS');

  const consensus = buildAirbnbMultiSnapshotConsensus(snapshots, {
    targetLat: CONFIG.targetLat,
    targetLon: CONFIG.targetLon,
    today,
  });

  console.log(`  status:               ${consensus.status}`);
  if (consensus.reason) console.log(`  reason:               ${consensus.reason}`);
  console.log(`  commonRadiusKm:       ${consensus.commonRadiusKm ?? 'null'}`);
  console.log(`  consensusMedian:      ${consensus.consensusMedian ?? 'null'}`);
  console.log(`  consensusOccupancy:   ${consensus.consensusOccupancy ?? 'null'} (${consensus.consensusOccupancySemantics})`);
  console.log(`  confidence:           ${consensus.confidence}`);
  if (consensus.confidenceReasons.length) {
    console.log(`  confidenceReasons:    ${consensus.confidenceReasons.join(', ')}`);
  }
  console.log(`  contributingCount:    ${consensus.contributingCount}`);
  console.log(`  spreadPct:            ${consensus.spread?.spreadPct?.toFixed(2) ?? 'null'}%  (${consensus.spread?.stabilityLevel ?? '?'})`);

  section('Snapshot details');
  for (const d of consensus.snapshotDetails) {
    const label = LABEL[d.snapshotIndex] ?? d.snapshotIndex;
    console.log(`  [${label}] ${d.contributionStatus}  geo=${d.geoStatus}  count@${consensus.commonRadiusKm}km=${d.countAtRadius}  median=${d.statsAtRadius?.median ?? 'null'}  weight=${d.weight?.toFixed(4)}  outlier=${d.outlierStatus}`);
  }

  // ── PHASE 8: Early stop counterfactual ──────────────────────────────────────
  banner(8, 'EARLY STOP COUNTERFACTUAL (A+B only)');
  console.log('  Would 2 snapshots have been sufficient?');

  const earlyStop = shouldRequestThirdSnapshot(snapshots[0], snapshots[1], {
    targetLat: CONFIG.targetLat,
    targetLon: CONFIG.targetLon,
    today,
  });

  console.log(`  shouldRequest:   ${earlyStop.shouldRequest}`);
  console.log(`  reason:          ${earlyStop.reason}`);
  if (earlyStop.spreadPct != null) console.log(`  spreadPct:       ${earlyStop.spreadPct?.toFixed(2)}%`);

  if (!earlyStop.shouldRequest) {
    console.log('  → EARLY STOP: A+B would have been sufficient. Third snapshot was not needed.');
  } else {
    console.log('  → NEED 3RD: Third snapshot was justified.');
  }

  // ── PHASE 9: Safety ─────────────────────────────────────────────────────────
  banner(9, 'SAFETY CHECK');
  const src = require('fs').readFileSync(__filename, 'utf8');
  const srcConsensus = require('fs').readFileSync(
    require('path').join(__dirname, '../services/airbnb-multi-snapshot-consensus.js'), 'utf8'
  );
  const checks = [
    { label: 'no pool/INSERT in consensus module', ok: !srcConsensus.includes('INSERT') && !srcConsensus.includes('const pool') },
    { label: 'no channex import in consensus module', ok: !srcConsensus.toLowerCase().includes("require('channex") },
    { label: 'no pricing-apply in consensus module', ok: !srcConsensus.includes('pricing-apply') },
    { label: 'API key not printed in validator', ok: !src.includes('BRIGHTDATA_API_KEY') || !src.includes('console.log') || !src.includes('process.env.BRIGHTDATA') },
    { label: 'no INSERT in validator', ok: !src.includes('INSERT') },
    { label: 'no channex in validator', ok: !src.toLowerCase().includes("require('channex") },
  ];
  for (const { label, ok } of checks) {
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}`);
  }

  console.log('\n' + '═'.repeat(72));
  console.log('  J3 VALIDATION COMPLETE');
  console.log('═'.repeat(72) + '\n');

  return { consensus, earlyStop, snapshots };
}

module.exports = { run };

if (require.main === module) {
  run().catch(err => { console.error('FATAL:', err); process.exit(1); });
}

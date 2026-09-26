#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-J3 — Airbnb Multi-Snapshot Consensus Validator
 *
 * SAFETY:
 *   BD_CALLS        = 0 (preview) | up to 3 Airbnb only (execute, early-stop may reduce to 2)
 *   DB_WRITES       = 0  always
 *   PRICING_WRITES  = 0  always
 *   CHANNEX_CALLS   = 0  always
 *   BD API key never printed to stdout
 *   PRODUCTION_ROUTING_UNCHANGED
 *
 * CLI:
 *   node outils/validate-airbnb-multisnapshot-consensus.js --name "M6"
 *   node outils/validate-airbnb-multisnapshot-consensus.js --name "M6" --execute
 *   node outils/validate-airbnb-multisnapshot-consensus.js --name "M6" --execute --check-in 2026-11-01 --check-out 2026-11-04
 */

require('dotenv').config();
const { Pool }                        = require('pg');
const { scrapeWithBrightData }        = require('../services/providers/brightdata');
const { buildCrossSourceQualityPool } = require('../services/market-cross-source-policy');
const { evaluateSourceGeoQuality }    = require('../services/market-geo-quality');
const { haversineKm, calcBrightDataMarketStats } = require('../services/brightdata-comparable-filter');
const {
  findCommonSnapshotRadius,
  calculateSnapshotConsensusWeight,
  detectSnapshotOutliers,
  shouldRequestThirdSnapshot,
  buildAirbnbMultiSnapshotConsensus,
} = require('../services/airbnb-multi-snapshot-consensus');
const { getFallbackZones }   = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }  = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS = 3;
const MAX_LISTINGS   = 100;
const LABEL          = ['A', 'B', 'C'];

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d);
}

// Exported for unit-testing the guard in isolation.
function _validateCheckInDate(checkIn, today) {
  if (checkIn <= today) {
    throw new Error(
      `checkIn calculé (${checkIn}) ≤ aujourd'hui (${today}) — erreur de date policy`
    );
  }
}

// ── DB helper ─────────────────────────────────────────────────────────────────

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

// ── Print helpers ─────────────────────────────────────────────────────────────

function banner(phase, title) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  PHASE ${phase}: ${title}`);
  console.log('═'.repeat(72));
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

function printQualityPool(qDiag, label) {
  const d = qDiag;
  console.log(`  [${label}] quality pool`);
  console.log(`    input:        ${d.inputCount}`);
  console.log(`    dedup:        −${d.dedupRejected}`);
  console.log(`    cat rejected: −${d.catRejected}  (missing: ${d.catMissing})`);
  console.log(`    cap rejected: −${d.capRejected}  (missing: ${d.capMissing ?? '?'})`);
  console.log(`    output:       ${d.outputCount}`);
}

function printGeoQuality(gq, label) {
  console.log(`  [${label}] geo quality`);
  console.log(`    status:       ${gq.status}`);
  console.log(`    geoScore:     ${gq.geoCoverageScore}`);
  console.log(`    usable:       ${gq.usableForConsensus}`);
  console.log(`    localCount:   ${gq.localComparableCount ?? '?'}  (radius: ${gq.localRadiusKm ?? '?'} km)`);
  console.log(`    nearest:      ${gq.nearestDistanceKm?.toFixed(2) ?? '?'} km`);
  console.log(`    median dist:  ${gq.medianDistanceKm?.toFixed(2) ?? '?'} km`);
}

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode({ name, pool, _now } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J3 Airbnb Multi-Snapshot Consensus — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) { console.log(`\n  ⛔  Aucune propriété: "${name}"`); return { ok: false }; }
  if (rows.length > 1)   { console.log(`  ⛔  Ambiguïté: ${rows.length} correspondances`); return { ok: false }; }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency) || prop.currency || '?';
  const now      = _now || new Date();
  const checkIn  = addDaysISO(now, 14, timezone);
  const checkOut = addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);
  const today    = now.toISOString().slice(0, 10);

  const targetLat = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon = prop.longitude != null ? parseFloat(prop.longitude) : null;

  console.log('\n  PROPERTY:');
  console.log(`    PROPERTY_ID:       ${prop.id}`);
  console.log(`    PROPERTY_NAME:     ${prop.internal_name || prop.name}`);
  console.log(`    PROPERTY_LAT:      ${targetLat ?? 'NULL'}`);
  console.log(`    PROPERTY_LON:      ${targetLon ?? 'NULL'}`);
  console.log(`    PROPERTY_MAX_GUESTS: ${prop.max_guests ?? 'NULL'}`);
  console.log(`    PROPERTY_BEDROOMS: ${prop.bedrooms ?? 'NULL'}`);
  console.log(`    PROPERTY_TIMEZONE: ${timezone}`);
  console.log(`    PROPERTY_CURRENCY: ${currency}`);

  // Fail-fast guards — same checks that executeMode would abort on before any BD call
  const guards = [];
  if (checkIn <= today)                                              guards.push(`checkIn (${checkIn}) ≤ today (${today})`);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon))  guards.push('lat/lon manquants — impossible d\'exécuter le consensus');

  if (guards.length > 0) {
    console.log('\n  ⛔  FAIL-FAST GUARDS (would abort before network in execute):');
    for (const g of guards) console.log(`     — ${g}`);
    return { ok: false, guards };
  }

  const zones = getFallbackZones(prop.address, null);
  console.log('\n  PLANNED BD CALLS (not executed):');
  console.log(`    location:           ${zones[0] || prop.address}`);
  console.log(`    check_in:           ${checkIn}   check_out: ${checkOut}`);
  console.log(`    nights:             ${DEFAULT_NIGHTS}`);
  console.log(`    MAX_BD_CALLS:       3 (early-stop may reduce to 2)`);
  console.log(`    ACTUAL_BD_CALLS:    0  (preview — add --execute to run)`);
  console.log(`    EARLY_STOP_RULE:    spreadPct ≤ 15% and both snapshots have GOOD geo with ≥5 local listings`);
  console.log(`    targetGuests:       ${prop.max_guests ?? '(unset)'}`);
  console.log(`    targetPropertyType: entire_place`);

  console.log('\n  Ready: node outils/validate-airbnb-multisnapshot-consensus.js --name "' + name + '" --execute');
  console.log('═'.repeat(72) + '\n');

  return {
    ok: true, checkIn, checkOut, today,
    targetLat, targetLon, targetGuests: prop.max_guests || null,
  };
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode({ name, _airbnbScrape, _now, pool, _checkIn, _checkOut } = {}) {
  const scrape = _airbnbScrape || scrapeWithBrightData;

  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J3 Airbnb Multi-Snapshot Consensus — EXECUTE MODE');
  console.log('  MAX_BD_CALLS=3 Airbnb only | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) throw new Error(`Aucune propriété: "${name}"`);
  if (rows.length > 1)   throw new Error(`${rows.length} correspondances pour "${name}"`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  if (!currency) throw new Error('Devise propriété invalide ou absente');

  const now      = _now || new Date();
  const checkIn  = _checkIn  || addDaysISO(now, 14, timezone);
  const checkOut = _checkOut || addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);
  const today    = now.toISOString().slice(0, 10);

  // Fail-fast: past date guard (catches hardcoded dates or invalid --check-in overrides)
  _validateCheckInDate(checkIn, today);

  const targetLat          = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon          = prop.longitude != null ? parseFloat(prop.longitude) : null;
  const targetGuests       = prop.max_guests || null;
  const targetPropertyType = 'entire_place';

  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
    throw new Error(`lat/lon manquants pour la propriété "${name}"`);
  }

  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0] || prop.address;

  // ── PHASE 1: Setup ──────────────────────────────────────────────────────────
  banner(1, 'PROPERTY / QUERY SETUP');
  console.log(`  PROPERTY_ID:           ${prop.id}`);
  console.log(`  PROPERTY_NAME:         ${prop.internal_name || prop.name}`);
  console.log(`  location:              ${location}`);
  console.log(`  currency:              ${currency}`);
  console.log(`  checkIn:               ${checkIn}`);
  console.log(`  checkOut:              ${checkOut}`);
  console.log(`  nights:                ${DEFAULT_NIGHTS}`);
  console.log(`  maxListings:           ${MAX_LISTINGS}`);
  console.log(`  targetLat:             ${targetLat}`);
  console.log(`  targetLon:             ${targetLon}`);
  console.log(`  targetGuests:          ${targetGuests ?? '(unset)'}`);
  console.log(`  targetPropertyType:    ${targetPropertyType}`);
  console.log(`  today (for occupancy): ${today}`);

  // ── PHASE 2: Snapshot calls with real early-stop, quality pools built inline ─
  banner(2, 'SNAPSHOT CALLS (up to 3 × scrapeWithBrightData, early-stop possible)');

  const snapshots        = [];
  let earlyStopTriggered = false;
  let actualBdCalls      = 0;

  for (let i = 0; i < 3; i++) {
    const label = LABEL[i];

    // Real early-stop: evaluate A+B before deciding to call C
    if (i === 2 && snapshots.length === 2) {
      const earlyCheck = shouldRequestThirdSnapshot(snapshots[0], snapshots[1], {
        targetLat, targetLon, today,
      });
      console.log(`\n  [EARLY STOP CHECK]`);
      console.log(`    shouldRequest:  ${earlyCheck.shouldRequest}`);
      console.log(`    reason:         ${earlyCheck.reason}`);
      if (earlyCheck.spreadPct != null) {
        console.log(`    spreadPct:      ${earlyCheck.spreadPct?.toFixed(2)}%`);
      }
      if (!earlyCheck.shouldRequest) {
        console.log(`  → EARLY STOP: A+B sufficient — snapshot C skipped`);
        earlyStopTriggered = true;
        break;
      }
      console.log(`  → NEED 3RD: Third snapshot justified`);
    }

    console.log(`\n  [${label}] scraping…`);
    const t0     = Date.now();
    const result = await scrape(location, MAX_LISTINGS, currency, { checkIn, checkOut });
    actualBdCalls++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const diag    = result.diagnostics || {};
    console.log(`    snapshotId:           ${result.snapshotId}`);
    console.log(`    returnedCount:        ${diag.returnedCount ?? '?'}`);
    console.log(`    acceptedCount:        ${diag.acceptedCount ?? (result.listings?.length ?? 0)}`);
    console.log(`    rejectedPrice:        ${diag.rejectedPriceCount ?? '?'}`);
    console.log(`    rejectedCurrency:     ${diag.rejectedCurrencyCount ?? '?'}`);
    console.log(`    rejectedAvailability: ${diag.rejectedAvailabilityCount ?? '?'}`);
    console.log(`    elapsed:              ${elapsed}s`);

    // Empty snapshot → EMPTY / UNUSABLE (fail-closed)
    if (!result.listings || result.listings.length === 0) {
      console.log(`  ⚠️  [${label}] EMPTY snapshot — 0 listings returned → UNUSABLE`);
      snapshots.push({
        snapshotId:  result.snapshotId,
        listings:    [],
        geoQuality:  {
          status: 'UNUSABLE', usableForConsensus: false, geoCoverageScore: 0,
          localComparableCount: 0, localRadiusKm: null,
          nearestDistanceKm: null, medianDistanceKm: null,
        },
        _rawDiag: diag,
        _qDiag:   null,
        _status:  'EMPTY',
      });
      continue;
    }

    // Build quality pool inline — required for early-stop geoQuality check on next iteration
    const qPool      = buildCrossSourceQualityPool(result.listings, 'airbnb', {
      targetGuests, targetPropertyType,
    });
    const geoQuality = evaluateSourceGeoQuality(qPool.listings, targetLat, targetLon);

    snapshots.push({
      snapshotId:  result.snapshotId,
      listings:    qPool.listings,
      geoQuality,
      _rawDiag:    diag,
      _qDiag:      qPool.diagnostics,
      _status:     'ok',
    });
  }

  console.log('\n  NETWORK ACCOUNTING:');
  console.log(`    MAX_BD_CALLS:          3`);
  console.log(`    ACTUAL_BD_CALLS:       ${actualBdCalls}`);
  console.log(`    EARLY_STOP_TRIGGERED:  ${earlyStopTriggered}`);

  // ── PHASE 3: Quality pools + geo quality report ─────────────────────────────
  banner(3, 'QUALITY POOLS + GEO QUALITY');

  for (let i = 0; i < snapshots.length; i++) {
    const label = LABEL[i];
    const snap  = snapshots[i];
    if (snap._status === 'EMPTY') {
      console.log(`  [${label}] EMPTY — quality pool skipped`);
      continue;
    }
    printQualityPool(snap._qDiag, label);
    printGeoQuality(snap.geoQuality, label);
  }

  // ── PHASE 4: Common radius ──────────────────────────────────────────────────
  banner(4, 'COMMON RADIUS');

  const radiusResult = findCommonSnapshotRadius(snapshots, targetLat, targetLon);
  console.log(`  commonRadiusKm:  ${radiusResult.commonRadiusKm ?? 'null (no common radius found)'}`);
  console.log(`  reason:          ${radiusResult.reason}`);
  console.log(`  eligible per radius:`);
  for (const [r, count] of Object.entries(radiusResult.eligiblePerRadius || {})) {
    console.log(`    ${r} km → ${count} eligible snapshots`);
  }

  // ── PHASE 5: Stats at common radius ─────────────────────────────────────────
  banner(5, 'STATS AT COMMON RADIUS');

  if (radiusResult.commonRadiusKm == null) {
    console.log('  (skipped — no common radius)');
  } else {
    const r = radiusResult.commonRadiusKm;
    for (let i = 0; i < snapshots.length; i++) {
      const label = LABEL[i];
      const snap  = snapshots[i];
      if (snap._status === 'EMPTY') { console.log(`  [${label}] EMPTY — stats skipped`); continue; }
      const atRadius = snap.listings.filter(l =>
        Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
        haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= r
      );
      const stats  = atRadius.length >= 1 ? calcBrightDataMarketStats(atRadius, { today }) : null;
      const weight = calculateSnapshotConsensusWeight(snap, r, targetLat, targetLon);
      console.log(`\n  [${label}] @${r}km`);
      console.log(`    countAtRadius:  ${atRadius.length}`);
      console.log(`    weight:         ${weight.toFixed(4)}`);
      if (stats) {
        console.log(`    median:         ${stats.median}`);
        console.log(`    p25/p75:        ${stats.p25} / ${stats.p75}`);
        console.log(`    count:          ${stats.count}`);
        const occ = stats.occupancy_semantics === 'calendar_unavailability_proxy'
          ? stats.occupancy + '%'
          : '(' + stats.occupancy_semantics + ')';
        console.log(`    occupancy:      ${occ}`);
      } else {
        console.log(`    stats:          null (insufficient listings at radius)`);
      }
    }
  }

  // ── PHASE 6: Outlier analysis ───────────────────────────────────────────────
  banner(6, 'OUTLIER ANALYSIS');

  const outlierInputs = snapshots.map((s, i) => {
    const r = radiusResult.commonRadiusKm;
    if (r == null || s._status === 'EMPTY') {
      return { snapshotIndex: i, snapshotId: s.snapshotId, median: null };
    }
    const atRadius = s.listings.filter(l =>
      Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
      haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= r
    );
    const stats = atRadius.length >= 1 ? calcBrightDataMarketStats(atRadius, { today }) : null;
    return { snapshotIndex: i, snapshotId: s.snapshotId, median: stats?.median ?? null };
  });

  const outlierAnalysis = detectSnapshotOutliers(outlierInputs);
  for (const o of outlierAnalysis) {
    const label = LABEL[o.snapshotIndex] ?? o.snapshotIndex;
    console.log(
      `  [${label}] median=${o.median ?? 'null'}  center=${o.center?.toFixed(1) ?? 'null'}` +
      `  dev=${o.deviationPct?.toFixed(1) ?? '?'}%  → ${o.outlierStatus}`
    );
  }

  // ── PHASE 7: Consensus ──────────────────────────────────────────────────────
  banner(7, 'CONSENSUS');

  const consensus = buildAirbnbMultiSnapshotConsensus(snapshots, {
    targetLat, targetLon, today,
  });

  console.log(`  status:               ${consensus.status}`);
  if (consensus.reason) console.log(`  reason:               ${consensus.reason}`);
  console.log(`  commonRadiusKm:       ${consensus.commonRadiusKm ?? 'null'}`);
  console.log(`  consensusMedian:      ${consensus.consensusMedian ?? 'null'}`);
  console.log(`  consensusOccupancy:   ${consensus.consensusOccupancy ?? 'null'} (${consensus.consensusOccupancySemantics})`);
  console.log(`  confidence:           ${consensus.confidence}`);
  if (consensus.confidenceReasons?.length) {
    console.log(`  confidenceReasons:    ${consensus.confidenceReasons.join(', ')}`);
  }
  console.log(`  contributingCount:    ${consensus.contributingCount}`);
  console.log(`  spreadPct:            ${consensus.spread?.spreadPct?.toFixed(2) ?? 'null'}%  (${consensus.spread?.stabilityLevel ?? '?'})`);

  section('Snapshot details');
  for (const d of (consensus.snapshotDetails || [])) {
    const label = LABEL[d.snapshotIndex] ?? d.snapshotIndex;
    console.log(
      `  [${label}] ${d.contributionStatus}  geo=${d.geoStatus}  ` +
      `count@${consensus.commonRadiusKm}km=${d.countAtRadius}  median=${d.statsAtRadius?.median ?? 'null'}  ` +
      `weight=${d.weight?.toFixed(4)}  outlier=${d.outlierStatus}`
    );
  }

  // ── PHASE 8: Early stop counterfactual (A+B) ────────────────────────────────
  banner(8, 'EARLY STOP COUNTERFACTUAL (A+B only)');

  if (snapshots.length >= 2) {
    console.log('  Would 2 snapshots have been sufficient?');
    const earlyStop = shouldRequestThirdSnapshot(snapshots[0], snapshots[1], {
      targetLat, targetLon, today,
    });
    console.log(`  shouldRequest:   ${earlyStop.shouldRequest}`);
    console.log(`  reason:          ${earlyStop.reason}`);
    if (earlyStop.spreadPct != null) console.log(`  spreadPct:       ${earlyStop.spreadPct?.toFixed(2)}%`);
    if (!earlyStop.shouldRequest) {
      console.log('  → EARLY STOP: A+B would have been sufficient.');
    } else {
      console.log('  → NEED 3RD: Third snapshot was justified.');
    }
  } else {
    console.log('  (skipped — fewer than 2 snapshots available)');
  }

  // ── PHASE 9: Safety check ───────────────────────────────────────────────────
  banner(9, 'SAFETY CHECK');

  const fs   = require('fs');
  const path = require('path');
  const srcConsensus = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-multi-snapshot-consensus.js'), 'utf8'
  );
  const src = fs.readFileSync(__filename, 'utf8');

  // Forbidden patterns built from fragments so they don't appear literally in this
  // source file, preventing the safety checker from falsely matching its own strings.
  // Using require-path-specific patterns for channex/pricing avoids matching
  // occurrences of those words in comments or safety-check label strings.
  const P = {
    sqlWrite:    ['INS', 'ERT '].join(''),
    poolConst:   ['con', 'st pool'].join(''),
    chxRqRel:    ["require", "('./chann"].join(''),
    chxRqUp:     ["require", "('../chann"].join(''),
    pricingRel:  ["require", "('./pricing-apply"].join(''),
    pricingUp:   ["require", "('../pricing-apply"].join(''),
    bdKey:       ['BRIGHT', 'DATA_API_KEY'].join(''),
  };

  function noChannex(s)  { return !s.includes(P.chxRqRel)   && !s.includes(P.chxRqUp); }
  function noPricing(s)  { return !s.includes(P.pricingRel) && !s.includes(P.pricingUp); }

  const checks = [
    { label: 'consensus module: no DB write',        ok: !srcConsensus.includes(P.sqlWrite) },
    { label: 'consensus module: no pool construct',  ok: !srcConsensus.includes(P.poolConst) },
    { label: 'consensus module: no channex import',  ok: noChannex(srcConsensus) },
    { label: 'consensus module: no pricing-apply',   ok: noPricing(srcConsensus) },
    { label: 'validator: no DB write',               ok: !src.includes(P.sqlWrite) },
    { label: 'validator: no channex import',         ok: noChannex(src) },
    { label: 'validator: BD key not logged',         ok: !src.includes(P.bdKey) },
  ];

  let allOk = true;
  for (const { label, ok } of checks) {
    if (!ok) allOk = false;
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}`);
  }
  if (!allOk) console.log('\n  ⚠️  One or more safety checks FAILED — review above');

  console.log('\n' + '═'.repeat(72));
  console.log('  J3 VALIDATION COMPLETE');
  console.log(`  MAX_BD_CALLS: 3 | ACTUAL_BD_CALLS: ${actualBdCalls} | EARLY_STOP: ${earlyStopTriggered}`);
  console.log('  DB_WRITES: 0 | PRICING_WRITES: 0 | CHANNEX_CALLS: 0');
  console.log('═'.repeat(72) + '\n');

  return { consensus, snapshots, actualBdCalls, earlyStopTriggered };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args      = process.argv.slice(2);
  const nameIdx   = args.indexOf('--name');
  const name      = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute   = args.includes('--execute');
  const ciIdx     = args.indexOf('--check-in');
  const coIdx     = args.indexOf('--check-out');
  const checkIn   = ciIdx !== -1 ? args[ciIdx + 1]  : undefined;
  const checkOut  = coIdx !== -1 ? args[coIdx + 1]  : undefined;

  if (!name) {
    console.error('Usage: node outils/validate-airbnb-multisnapshot-consensus.js --name <nom> [--execute] [--check-in YYYY-MM-DD --check-out YYYY-MM-DD]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const opts    = { name, pool, _checkIn: checkIn, _checkOut: checkOut };
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

module.exports = { previewMode, executeMode, addDaysISO, _validateCheckInDate };

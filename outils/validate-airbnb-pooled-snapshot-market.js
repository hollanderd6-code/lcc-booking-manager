#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-J4 — Airbnb Pooled Snapshot Market Validator
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
 *   node outils/validate-airbnb-pooled-snapshot-market.js --name "M6"
 *   node outils/validate-airbnb-pooled-snapshot-market.js --name "M6" --execute
 *   node outils/validate-airbnb-pooled-snapshot-market.js --name "M6" --execute --check-in 2026-11-01 --check-out 2026-11-04
 */

require('dotenv').config();
const { Pool }                            = require('pg');
const { scrapeWithBrightData }            = require('../services/providers/brightdata');
const { shouldRequestThirdSnapshot }      = require('../services/airbnb-multi-snapshot-consensus');
const { buildAirbnbPooledMarket }         = require('../services/airbnb-pooled-snapshot-market');
const { buildCrossSourceQualityPool }     = require('../services/market-cross-source-policy');
const { evaluateSourceGeoQuality }        = require('../services/market-geo-quality');
const { getFallbackZones }                = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }               = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS = 3;
const MAX_LISTINGS   = 100;
const LABEL          = ['A', 'B', 'C'];

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d);
}

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

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode({ name, pool, _now } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-J4 Airbnb Pooled Snapshot Market — PREVIEW MODE');
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
  console.log(`    PROPERTY_ID:           ${prop.id}`);
  console.log(`    PROPERTY_NAME:         ${prop.internal_name || prop.name}`);
  console.log(`    PROPERTY_LAT:          ${targetLat ?? 'NULL'}`);
  console.log(`    PROPERTY_LON:          ${targetLon ?? 'NULL'}`);
  console.log(`    PROPERTY_MAX_GUESTS:   ${prop.max_guests ?? 'NULL'}`);
  console.log(`    PROPERTY_BEDROOMS:     ${prop.bedrooms ?? 'NULL'}`);
  console.log(`    PROPERTY_TIMEZONE:     ${timezone}`);
  console.log(`    PROPERTY_CURRENCY:     ${currency}`);

  const guards = [];
  if (checkIn <= today)                                             guards.push(`checkIn (${checkIn}) ≤ today (${today})`);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) guards.push("lat/lon manquants — impossible d'exécuter le pooled market");

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
  console.log(`    EARLY_STOP_RULE:    spreadPct ≤ 15% and both snapshots GOOD geo with ≥5 local listings`);
  console.log(`    targetGuests:       ${prop.max_guests ?? '(unset)'}`);
  console.log(`    targetPropertyType: entire_place`);

  console.log('\n  Ready: node outils/validate-airbnb-pooled-snapshot-market.js --name "' + name + '" --execute');
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
  console.log('  B5-BK-J4 Airbnb Pooled Snapshot Market — EXECUTE MODE');
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

  // ── PHASE 2: Snapshot calls with early-stop, quality pools built inline ─────
  banner(2, 'SNAPSHOT CALLS (up to 3 × scrapeWithBrightData, early-stop possible)');

  const rawSnapshots     = [];
  const qualitySnapshots = [];
  let earlyStopTriggered = false;
  let actualBdCalls      = 0;

  for (let i = 0; i < 3; i++) {
    const label = LABEL[i];

    if (i === 2 && qualitySnapshots.length === 2) {
      const earlyCheck = shouldRequestThirdSnapshot(qualitySnapshots[0], qualitySnapshots[1], {
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

    if (!result.listings || result.listings.length === 0) {
      console.log(`  ⚠️  [${label}] EMPTY snapshot — 0 listings returned → UNUSABLE`);
      rawSnapshots.push({ snapshotId: result.snapshotId, listings: [] });
      qualitySnapshots.push({
        snapshotId: result.snapshotId,
        listings:   [],
        geoQuality: {
          status: 'UNUSABLE', usableForConsensus: false, geoCoverageScore: 0,
          localComparableCount: 0, localRadiusKm: null,
          nearestDistanceKm: null, medianDistanceKm: null,
        },
        _status: 'EMPTY',
      });
      continue;
    }

    rawSnapshots.push({ snapshotId: result.snapshotId, listings: result.listings });

    const qPool      = buildCrossSourceQualityPool(result.listings, 'airbnb', {
      targetGuests, targetPropertyType,
    });
    const geoQuality = evaluateSourceGeoQuality(qPool.listings, targetLat, targetLon);
    qualitySnapshots.push({
      snapshotId:  result.snapshotId,
      listings:    qPool.listings,
      geoQuality,
      _qDiag:      qPool.diagnostics,
      _status:     'ok',
    });
  }

  console.log('\n  NETWORK ACCOUNTING:');
  console.log(`    MAX_BD_CALLS:          3`);
  console.log(`    ACTUAL_BD_CALLS:       ${actualBdCalls}`);
  console.log(`    EARLY_STOP_TRIGGERED:  ${earlyStopTriggered}`);

  // ── PHASE 3: Per-snapshot quality report ────────────────────────────────────
  banner(3, 'PER-SNAPSHOT QUALITY POOLS + GEO QUALITY');

  for (let i = 0; i < qualitySnapshots.length; i++) {
    const label = LABEL[i];
    const snap  = qualitySnapshots[i];
    if (snap._status === 'EMPTY') {
      console.log(`  [${label}] EMPTY — quality pool skipped`);
      continue;
    }
    const d = snap._qDiag;
    console.log(`  [${label}] quality pool`);
    console.log(`    input:        ${d.inputCount}`);
    console.log(`    dedup:        −${d.dedupRejected}`);
    console.log(`    cat rejected: −${d.catRejected}  (missing: ${d.catMissing})`);
    console.log(`    cap rejected: −${d.capRejected}  (missing: ${d.capMissing ?? '?'})`);
    console.log(`    output:       ${d.outputCount}`);
    const gq = snap.geoQuality;
    console.log(`  [${label}] geo quality`);
    console.log(`    status:       ${gq.status}`);
    console.log(`    geoScore:     ${gq.geoCoverageScore}`);
    console.log(`    usable:       ${gq.usableForConsensus}`);
    console.log(`    localCount:   ${gq.localComparableCount ?? '?'}  (radius: ${gq.localRadiusKm ?? '?'} km)`);
    console.log(`    nearest:      ${gq.nearestDistanceKm?.toFixed(2) ?? '?'} km`);
    console.log(`    median dist:  ${gq.medianDistanceKm?.toFixed(2) ?? '?'} km`);
  }

  // ── PHASE 4: Pooled Market ──────────────────────────────────────────────────
  banner(4, 'POOLED SNAPSHOT MARKET');

  const pooled = buildAirbnbPooledMarket(rawSnapshots, {
    targetLat, targetLon, targetGuests, targetPropertyType, today,
  });

  console.log(`  status:                   ${pooled.status}`);
  if (pooled.reason) console.log(`  reason:                   ${pooled.reason}`);
  console.log(`  totalInput:               ${pooled.totalInput ?? 'N/A'}`);
  console.log(`  uniqueCount:              ${pooled.uniqueCount ?? 'N/A'}`);
  console.log(`  withIdCount:              ${pooled.withIdCount ?? 'N/A'}`);
  console.log(`  noIdCount:                ${pooled.noIdCount ?? 'N/A'}`);
  console.log(`  dedupedCount:             ${pooled.dedupedCount ?? 'N/A'}`);
  console.log(`  repeatedCount:            ${pooled.repeatedCount ?? 'N/A'}`);
  console.log(`  selectedRadiusKm:         ${pooled.selectedRadiusKm ?? 'N/A'}`);
  console.log(`  fallbackUsed:             ${pooled.fallbackUsed ?? 'N/A'}`);
  console.log(`  comparableCount:          ${pooled.comparableCount ?? 'N/A'}`);

  if (pooled.uniqueCountsByRadius) {
    section('Unique listings by radius');
    for (const [r, cnt] of Object.entries(pooled.uniqueCountsByRadius)) {
      console.log(`    ${r} km → ${cnt} unique listings`);
    }
  }

  if (pooled.pooledStats) {
    section('Pooled stats at selected radius');
    const ps = pooled.pooledStats;
    console.log(`    count:    ${ps.count}`);
    console.log(`    min:      ${ps.min}     max: ${ps.max}`);
    console.log(`    p10:      ${ps.p10}     p25: ${ps.p25}`);
    console.log(`    median:   ${ps.median}`);
    console.log(`    p75:      ${ps.p75}     p90: ${ps.p90}`);
    console.log(`    mean:     ${ps.mean?.toFixed(1)}`);
    const occ = ps.occupancy_semantics === 'calendar_unavailability_proxy'
      ? ps.occupancy + '%'
      : '(' + ps.occupancy_semantics + ')';
    console.log(`    occupancy: ${occ}  tension: ${ps.tensionLevel ?? '?'}`);
  }

  if (pooled.sensitivity && Object.keys(pooled.sensitivity).length > 0) {
    section('Sensitivity analysis (same radius)');
    for (const [key, v] of Object.entries(pooled.sensitivity)) {
      console.log(`    [${key}] unique=${v.uniqueCount}  @radius=${v.countAtRadius}  median=${v.median ?? 'null'}  p25=${v.p25 ?? 'null'}  p75=${v.p75 ?? 'null'}`);
    }
  }

  if (pooled.pairDeviation) {
    section('Pair vs ABC deviation');
    const pd = pooled.pairDeviation;
    for (const [k, v] of Object.entries(pd.deviations)) {
      console.log(`    ${k} vs ABC: ${v?.toFixed(2) ?? 'null'}%`);
    }
    console.log(`    maxDeviationPct: ${pd.maxDeviationPct?.toFixed(2) ?? 'null'}%`);
  }

  if (pooled.priceVariation) {
    section('Repeated listing price variation');
    const pv = pooled.priceVariation;
    console.log(`    count: ${pv.count}  mean: ${pv.mean?.toFixed(1)}%  max: ${pv.max?.toFixed(1)}%`);
  }

  console.log(`\n  pooledMarketStability:    ${pooled.pooledMarketStability}`);
  console.log(`  pooledMarketConfidence:   ${pooled.pooledMarketConfidence}`);
  console.log(`  safeToUse:                ${pooled.safeToUse}`);

  // ── PHASE 5: Safety check ───────────────────────────────────────────────────
  banner(5, 'SAFETY CHECK');

  const fs   = require('fs');
  const path = require('path');
  const srcPooled = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-snapshot-market.js'), 'utf8'
  );
  const src = fs.readFileSync(__filename, 'utf8');

  // Forbidden patterns built from fragments — source never contains the literal
  // contiguous substring, so the checker cannot falsely match its own code.
  const P = {
    sqlWrite:    ['INS', 'ERT '].join(''),
    poolConst:   ['new', ' Pool('].join(''),
    chxRqRel:    ["require", "('./chann"].join(''),
    chxRqUp:     ["require", "('../chann"].join(''),
    pricingRel:  ["require", "('./pricing-apply"].join(''),
    pricingUp:   ["require", "('../pricing-apply"].join(''),
    bdKey:       ['BRIGHT', 'DATA_API_KEY'].join(''),
  };

  function noChannex(s) { return !s.includes(P.chxRqRel)   && !s.includes(P.chxRqUp); }
  function noPricing(s) { return !s.includes(P.pricingRel) && !s.includes(P.pricingUp); }

  const checks = [
    { label: 'pooled module: no DB write',        ok: !srcPooled.includes(P.sqlWrite) },
    { label: 'pooled module: no pool construct',  ok: !srcPooled.includes(P.poolConst) },
    { label: 'pooled module: no channex import',  ok: noChannex(srcPooled) },
    { label: 'pooled module: no pricing-apply',   ok: noPricing(srcPooled) },
    { label: 'validator: no DB write',            ok: !src.includes(P.sqlWrite) },
    { label: 'validator: no channex import',      ok: noChannex(src) },
    { label: 'validator: BD key not logged',      ok: !src.includes(P.bdKey) },
  ];

  let allOk = true;
  for (const { label, ok } of checks) {
    if (!ok) allOk = false;
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}`);
  }
  if (!allOk) console.log('\n  ⚠️  One or more safety checks FAILED — review above');

  console.log('\n' + '═'.repeat(72));
  console.log('  J4 VALIDATION COMPLETE');
  console.log(`  MAX_BD_CALLS: 3 | ACTUAL_BD_CALLS: ${actualBdCalls} | EARLY_STOP: ${earlyStopTriggered}`);
  console.log('  DB_WRITES: 0 | PRICING_WRITES: 0 | CHANNEX_CALLS: 0');
  console.log('═'.repeat(72) + '\n');

  return { pooled, rawSnapshots, qualitySnapshots, actualBdCalls, earlyStopTriggered };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args     = process.argv.slice(2);
  const nameIdx  = args.indexOf('--name');
  const name     = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute  = args.includes('--execute');
  const ciIdx    = args.indexOf('--check-in');
  const coIdx    = args.indexOf('--check-out');
  const checkIn  = ciIdx !== -1 ? args[ciIdx + 1] : undefined;
  const checkOut = coIdx !== -1 ? args[coIdx + 1] : undefined;

  if (!name) {
    console.error('Usage: node outils/validate-airbnb-pooled-snapshot-market.js --name <nom> [--execute] [--check-in YYYY-MM-DD --check-out YYYY-MM-DD]');
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

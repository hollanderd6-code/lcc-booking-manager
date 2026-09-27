#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-K — Shadow Market Engine Validator
 *
 * Executes the complete K shadow pipeline for a property and compares:
 *   - current production market signal (DB read)
 *   - Airbnb pooled market (J4/J5)
 *   - Booking.com market
 *   - K candidate multi-source consensus
 *
 * SAFETY:
 *   BD_CALLS       = 0 (preview) | up to 4 = 3 Airbnb + 1 Booking (execute)
 *   DB_WRITES      = 0  always
 *   PRICING_WRITES = 0  always
 *   CHANNEX_CALLS  = 0  always
 *   BD API key never printed to stdout
 *   PRODUCTION_ROUTING_UNCHANGED
 *   PRODUCTION_NOT_ACTIVATED
 *
 * CLI:
 *   node outils/validate-market-engine-shadow-k.js --name "M6"
 *   node outils/validate-market-engine-shadow-k.js --name "M6" --execute
 *   node outils/validate-market-engine-shadow-k.js --name "M6" --execute --check-in 2026-11-01 --check-out 2026-11-04
 */

require('dotenv').config();
const { Pool }                    = require('pg');
const { runShadowMarketEngine }   = require('../services/market-engine-shadow-k');
const { getFallbackZones }        = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }       = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS = 3;

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

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

async function fetchCurrentProductionSignal(pool, propertyId) {
  const result = await pool.query(
    `SELECT median_price, price_p25, price_p75, occupancy_rate,
            comparable_count, tension_level, zone_label,
            scraped_at, data_source, currency
       FROM market_data
      WHERE property_id = $1
      ORDER BY scraped_at DESC
      LIMIT 1`,
    [propertyId]
  );
  return result.rows[0] || null;
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

function fmt(val, suffix = '') {
  return val != null ? `${val}${suffix}` : 'N/A';
}

function fmtPct(val) {
  return val != null ? `${Number(val).toFixed(2)}%` : 'N/A';
}

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode({ name, pool, _now } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-K Shadow Market Engine — PREVIEW MODE');
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
  if (checkIn <= today)                                              guards.push(`checkIn (${checkIn}) ≤ today (${today})`);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon))  guards.push("lat/lon manquants");

  if (guards.length > 0) {
    console.log('\n  ⛔  FAIL-FAST GUARDS:');
    for (const g of guards) console.log(`     — ${g}`);
    return { ok: false, guards };
  }

  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0] || prop.address;

  // Show current production signal
  const prodSignal = await fetchCurrentProductionSignal(pool, prop.id);
  section('Current production signal');
  if (!prodSignal) {
    console.log('  (no market_data row found for this property)');
  } else {
    console.log(`  median:    ${fmt(prodSignal.median_price, ' €/nuit')}`);
    console.log(`  p25/p75:   ${fmt(prodSignal.price_p25)} / ${fmt(prodSignal.price_p75)}`);
    console.log(`  count:     ${fmt(prodSignal.comparable_count)}`);
    console.log(`  tension:   ${prodSignal.tension_level ?? 'N/A'}`);
    console.log(`  occupancy: ${prodSignal.occupancy_rate != null ? prodSignal.occupancy_rate + '%' : 'N/A'}`);
    console.log(`  source:    ${prodSignal.data_source ?? 'N/A'}`);
    console.log(`  scraped:   ${prodSignal.scraped_at ? new Date(prodSignal.scraped_at).toISOString() : 'N/A'}`);
  }

  console.log('\n  PLANNED BD CALLS (not executed):');
  console.log(`    location:              ${location}`);
  console.log(`    check_in:              ${checkIn}   check_out: ${checkOut}`);
  console.log(`    nights:                ${DEFAULT_NIGHTS}`);
  console.log(`    AIRBNB_MAX_BD_CALLS:   3 (early-stop may reduce to 2)`);
  console.log(`    BOOKING_BD_CALLS:      1`);
  console.log(`    TOTAL_MAX_BD_CALLS:    4`);
  console.log(`    ACTUAL_BD_CALLS:       0  (preview — add --execute to run)`);
  console.log(`    targetGuests:          ${prop.max_guests ?? '(unset)'}`);
  console.log(`    targetBedrooms:        ${prop.bedrooms  ?? '(unset)'}`);
  console.log(`    targetPropertyType:    entire_place`);

  console.log('\n  Ready: node outils/validate-market-engine-shadow-k.js --name "' + name + '" --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true };
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode({ name, pool, _now, _checkIn, _checkOut } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-K Shadow Market Engine — EXECUTE MODE');
  console.log('  MAX_BD_CALLS=4 (3 Airbnb + 1 Booking) | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
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

  const targetLat          = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon          = prop.longitude != null ? parseFloat(prop.longitude) : null;
  const targetGuests       = prop.max_guests  || null;
  const targetBedrooms     = prop.bedrooms    || null;
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
  console.log(`  targetLat:             ${targetLat}`);
  console.log(`  targetLon:             ${targetLon}`);
  console.log(`  targetGuests:          ${targetGuests ?? '(unset)'}`);
  console.log(`  targetBedrooms:        ${targetBedrooms ?? '(unset)'}`);
  console.log(`  targetPropertyType:    ${targetPropertyType}`);
  console.log(`  today:                 ${today}`);

  // ── PHASE 2: Current production signal (DB read) ────────────────────────────
  banner(2, 'CURRENT PRODUCTION SIGNAL (DB READ)');
  const prodSignal = await fetchCurrentProductionSignal(pool, prop.id);
  if (!prodSignal) {
    console.log('  (no market_data row found for this property)');
  } else {
    console.log(`  MEDIAN:        ${fmt(prodSignal.median_price, ' €/nuit')}`);
    console.log(`  P25/P75:       ${fmt(prodSignal.price_p25)} / ${fmt(prodSignal.price_p75)}`);
    console.log(`  COUNT:         ${fmt(prodSignal.comparable_count)}`);
    console.log(`  TENSION:       ${prodSignal.tension_level ?? 'N/A'}`);
    console.log(`  OCCUPANCY:     ${prodSignal.occupancy_rate != null ? prodSignal.occupancy_rate + '%' : 'N/A'}`);
    console.log(`  DATA_SOURCE:   ${prodSignal.data_source ?? 'N/A'}`);
    console.log(`  SCRAPED_AT:    ${prodSignal.scraped_at ? new Date(prodSignal.scraped_at).toISOString() : 'N/A'}`);
  }

  // ── PHASE 3: Run shadow engine ──────────────────────────────────────────────
  banner(3, 'SHADOW ENGINE EXECUTION (up to 4 BD calls)');
  console.log('  Running shadow engine...');
  const t0 = Date.now();

  const result = await runShadowMarketEngine({
    targetLat, targetLon, targetGuests, targetBedrooms, targetPropertyType,
    location, currency, checkIn, checkOut, today,
    maxAirbnbListings: 100, maxBookingListings: 100,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  Engine completed in ${elapsed}s`);
  console.log(`  ACTUAL_AIRBNB_BD_CALLS:  ${result.actualBdCalls}`);
  console.log(`  EARLY_STOP_TRIGGERED:    ${result.earlyStopTriggered}`);
  console.log(`  BOOKING_BD_CALLS:        ${result.bookingBdCalls}`);

  // ── PHASE 4: Airbnb pooled (J4/J5) ─────────────────────────────────────────
  banner(4, 'AIRBNB POOLED MARKET (J4/J5)');
  const pool4 = result._airbnbPooled;
  const gate4 = result._airbnbGate;

  console.log(`  AIRBNB_POOL_STATUS:        ${result.AIRBNB_POOL_STATUS}`);
  console.log(`  AIRBNB_POOL_RADIUS_KM:     ${fmt(result.AIRBNB_POOL_RADIUS_KM, ' km')}`);
  console.log(`  AIRBNB_POOL_COUNT:         ${result.AIRBNB_POOL_COUNT}`);
  console.log(`  AIRBNB_POOL_MEDIAN:        ${fmt(result.AIRBNB_POOL_MEDIAN, ' €')}`);
  console.log(`  AIRBNB_POOL_P25:           ${fmt(result.AIRBNB_POOL_P25, ' €')}`);
  console.log(`  AIRBNB_POOL_P75:           ${fmt(result.AIRBNB_POOL_P75, ' €')}`);
  console.log(`  AIRBNB_RELIABILITY_STATUS: ${result.AIRBNB_RELIABILITY_STATUS}`);

  if (gate4.POOLED_RELIABILITY_REASONS?.length > 0) {
    console.log(`  RELIABILITY_REASONS:`);
    for (const r of gate4.POOLED_RELIABILITY_REASONS) console.log(`    — ${r}`);
  }

  if (pool4.pooledStats) {
    section('Pooled stats');
    const ps = pool4.pooledStats;
    console.log(`  count: ${ps.count}  min: ${ps.min}  max: ${ps.max}`);
    console.log(`  p10: ${ps.p10}  p25: ${ps.p25}  median: ${ps.median}  p75: ${ps.p75}  p90: ${ps.p90}`);
    const occ = ps.occupancy_semantics === 'calendar_unavailability_proxy'
      ? ps.occupancy + '%' : '(' + ps.occupancy_semantics + ')';
    console.log(`  occupancy: ${occ}  tension: ${ps.tensionLevel ?? 'N/A'}`);
  }

  // ── PHASE 5: Booking market ─────────────────────────────────────────────────
  banner(5, 'BOOKING.COM MARKET');
  const bkRaw = result._bookingRaw;
  if (!bkRaw) {
    console.log('  (Booking scrape failed — see EXCLUSION_REASONS)');
  } else {
    console.log(`  raw_listings:        ${bkRaw.listings?.length ?? 0}`);
    console.log(`  BOOKING_RADIUS_KM:   ${fmt(result.BOOKING_RADIUS_KM, ' km')}`);
    console.log(`  BOOKING_COUNT:       ${result.BOOKING_COUNT}`);
    console.log(`  BOOKING_MEDIAN:      ${fmt(result.BOOKING_MEDIAN, ' €')}`);
    console.log(`  BOOKING_P25:         ${fmt(result.BOOKING_P25, ' €')}`);
    console.log(`  BOOKING_P75:         ${fmt(result.BOOKING_P75, ' €')}`);
  }

  // ── PHASE 6: Cross-source analysis ─────────────────────────────────────────
  banner(6, 'CROSS-SOURCE ANALYSIS');
  console.log(`  CROSS_SOURCE_COMMON_RADIUS_KM:   ${fmt(result.CROSS_SOURCE_COMMON_RADIUS_KM, ' km')}`);
  console.log(`  AIRBNB_AT_COMMON_RADIUS_COUNT:   ${result.AIRBNB_AT_COMMON_RADIUS_COUNT}`);
  console.log(`  BOOKING_AT_COMMON_RADIUS_COUNT:  ${result.BOOKING_AT_COMMON_RADIUS_COUNT}`);
  console.log(`  AIRBNB_AT_COMMON_RADIUS_MEDIAN:  ${fmt(result.AIRBNB_AT_COMMON_RADIUS_MEDIAN, ' €')}`);
  console.log(`  BOOKING_AT_COMMON_RADIUS_MEDIAN: ${fmt(result.BOOKING_AT_COMMON_RADIUS_MEDIAN, ' €')}`);
  console.log(`  CROSS_SOURCE_DIVERGENCE_PCT:     ${fmtPct(result.CROSS_SOURCE_DIVERGENCE_PCT)}`);
  console.log(`  CROSS_SOURCE_DIVERGENCE_LEVEL:   ${result.CROSS_SOURCE_DIVERGENCE_LEVEL ?? 'N/A'}`);

  // ── PHASE 7: Market consensus ───────────────────────────────────────────────
  banner(7, 'MARKET CONSENSUS');
  console.log(`  market_status:               ${result.market_status}`);
  console.log(`  MARKET_CONSENSUS_MEDIAN:     ${fmt(result.MARKET_CONSENSUS_MEDIAN, ' €')}`);
  console.log(`  MARKET_CONSENSUS_P25:        ${fmt(result.MARKET_CONSENSUS_P25, ' €')}`);
  console.log(`  MARKET_CONSENSUS_P75:        ${fmt(result.MARKET_CONSENSUS_P75, ' €')}`);
  console.log(`  MARKET_CONFIDENCE:           ${result.MARKET_CONFIDENCE}`);

  if (result.MARKET_EXCLUSION_REASONS?.length > 0) {
    console.log(`  EXCLUSION_REASONS:`);
    for (const r of result.MARKET_EXCLUSION_REASONS) console.log(`    — ${r}`);
  }

  section('Source usage');
  const su = result.MARKET_SOURCE_USAGE;
  if (su) {
    console.log(`  airbnb:  included=${su.airbnb?.included}  quality=${su.airbnb?.effectiveQuality ?? 'N/A'}  weight=${su.airbnb?.weight ?? 'N/A'}`);
    console.log(`  booking: included=${su.booking?.included}  quality=${su.booking?.effectiveQuality ?? 'N/A'}  weight=${su.booking?.weight ?? 'N/A'}`);
  }

  section('Occupancy signal');
  console.log(`  OCCUPANCY_SIGNAL_SOURCE: ${result.OCCUPANCY_SIGNAL_SOURCE ?? 'none'}`);
  console.log(`  OCCUPANCY_SIGNAL:        ${result.OCCUPANCY_SIGNAL ?? 'null'}`);
  console.log(`  OCCUPANCY_SEMANTICS:     ${result.OCCUPANCY_SEMANTICS ?? 'null'}`);

  // ── PHASE 8: Production comparison ─────────────────────────────────────────
  banner(8, 'PRODUCTION vs CANDIDATE COMPARISON');
  const prodMedian = prodSignal ? Number(prodSignal.median_price) : null;
  const candMedian = result.MARKET_CONSENSUS_MEDIAN;

  console.log(`  PRODUCTION_MEDIAN:   ${prodMedian != null ? prodMedian + ' €' : 'N/A'}`);
  console.log(`  CANDIDATE_MEDIAN:    ${candMedian != null ? candMedian + ' €' : 'N/A'}`);

  if (prodMedian != null && candMedian != null && prodMedian > 0 && candMedian > 0) {
    const diff = ((candMedian - prodMedian) / prodMedian * 100).toFixed(2);
    console.log(`  DELTA:               ${diff}%  (candidate vs production)`);
  }

  console.log(`  PRODUCTION_SOURCE:   ${prodSignal?.data_source ?? 'N/A'}`);
  console.log(`  CANDIDATE_STATUS:    ${result.market_status}`);
  console.log(`  CANDIDATE_CONFIDENCE: ${result.MARKET_CONFIDENCE}`);

  // ── PHASE 9: Safety check ───────────────────────────────────────────────────
  banner(9, 'SAFETY CHECK (K)');

  const fs   = require('fs');
  const path = require('path');
  const srcEngine = fs.readFileSync(
    path.join(__dirname, '../services/market-engine-shadow-k.js'), 'utf8'
  );
  const src = fs.readFileSync(__filename, 'utf8');

  const P = {
    sqlWrite:   ['INS', 'ERT '].join(''),
    newPool:    ['new', ' Pool('].join(''),
    chxRqRel:   ["require", "('./chann"].join(''),
    chxRqUp:    ["require", "('../chann"].join(''),
    pricingRel: ["require", "('./pricing-apply"].join(''),
    pricingUp:  ["require", "('../pricing-apply"].join(''),
    bdKey:      ['BRIGHT', 'DATA_API_KEY'].join(''),
  };

  function noChannex(s) { return !s.includes(P.chxRqRel) && !s.includes(P.chxRqUp); }
  function noPricing(s) { return !s.includes(P.pricingRel) && !s.includes(P.pricingUp); }

  const checks = [
    { label: 'engine: no SQL write',         ok: !srcEngine.includes(P.sqlWrite) },
    { label: 'engine: no pool construction', ok: !srcEngine.includes(P.newPool) },
    { label: 'engine: no channex import',    ok: noChannex(srcEngine) },
    { label: 'engine: no pricing-apply',     ok: noPricing(srcEngine) },
    { label: 'validator: no DB write',       ok: !src.includes(P.sqlWrite) },
    { label: 'validator: no channex import', ok: noChannex(src) },
    { label: 'validator: BD key not logged', ok: !src.includes(P.bdKey) },
  ];

  let allOk = true;
  for (const { label, ok } of checks) {
    if (!ok) allOk = false;
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}`);
  }
  if (!allOk) console.log('\n  ⚠️  One or more safety checks FAILED — review above');

  console.log('\n' + '═'.repeat(72));
  console.log('  K VALIDATION COMPLETE');
  console.log(`  MAX_BD_CALLS: 4 | ACTUAL_AIRBNB_BD_CALLS: ${result.actualBdCalls} | BOOKING_BD_CALLS: ${result.bookingBdCalls}`);
  console.log(`  EARLY_STOP: ${result.earlyStopTriggered}`);
  console.log('  DB_WRITES: 0 | PRICING_WRITES: 0 | CHANNEX_CALLS: 0');
  console.log('  PRODUCTION_NOT_ACTIVATED');
  console.log('═'.repeat(72) + '\n');

  return result;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');
  const ciIdx   = args.indexOf('--check-in');
  const coIdx   = args.indexOf('--check-out');
  const checkIn  = ciIdx !== -1 ? args[ciIdx + 1] : undefined;
  const checkOut = coIdx !== -1 ? args[coIdx + 1] : undefined;

  if (!name) {
    console.error('Usage: node outils/validate-market-engine-shadow-k.js --name <nom> [--execute] [--check-in YYYY-MM-DD --check-out YYYY-MM-DD]');
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
      else if (msg.includes('brightdata') || msg.includes('airbnb') || msg.includes('booking')) errType = 'BRIGHTDATA_ERROR';
      console.error(`\n  ❌ ${errType}: ${err.message}`);
      pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { previewMode, executeMode };

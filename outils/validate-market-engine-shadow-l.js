#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-L6 — Shadow Market Engine L Validator (Single-Window)
 *
 * Extends K validator with:
 *   - Phase 6: Cross-Source DIAGNOSTIC (L3)
 *   - Phase 8: Market ACTIONABILITY (L2)
 *   - Phase 9: Production Sanity (L4)
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
 *   node outils/validate-market-engine-shadow-l.js --name "M6"
 *   node outils/validate-market-engine-shadow-l.js --name "M6" --execute
 *   node outils/validate-market-engine-shadow-l.js --name "M6" --execute --check-in 2026-11-01 --check-out 2026-11-04
 */

require('dotenv').config();
const { Pool }                               = require('pg');
const { runShadowMarketEngine }              = require('../services/market-engine-shadow-k');
const { evaluateMarketActionability }        = require('../services/market-actionability-gate');
const { computeMarketDiagnosticCrossSource } = require('../services/market-diagnostic-cross-source');
const { analyzeProductionSignalSanity }      = require('../services/market-production-sanity');
const { getFallbackZones }                   = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }                  = require('../routes/market-data-resolver');

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
  console.log('  B5-BK-L Shadow Market Engine (Single-Window) — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0');
  console.log('═'.repeat(72));

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) { console.log(`\n  Aucune propriété: "${name}"`); return { ok: false }; }
  if (rows.length > 1)   { console.log(`  Ambiguïté: ${rows.length} correspondances`); return { ok: false }; }

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

  console.log('\n  PLANNED BD CALLS (not executed):');
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0] || prop.address;
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

  console.log('\n  Ready: node outils/validate-market-engine-shadow-l.js --name "' + name + '" --execute');
  console.log('═'.repeat(72) + '\n');

  return { ok: true };
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode({ name, pool, _now, _checkIn, _checkOut } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-L Shadow Market Engine (Single-Window) — EXECUTE MODE');
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

  // ── PHASE 6: Cross-Source DIAGNOSTIC ───────────────────────────────────────
  banner(6, 'CROSS-SOURCE DIAGNOSTIC (independent of consensus)');

  const airbnbReliabilityStatus = result.AIRBNB_RELIABILITY_STATUS;
  const airbnbConsensusElig = {
    included:   airbnbReliabilityStatus === 'STABLE_LOCAL_POOL',
    reliability: airbnbReliabilityStatus,
  };
  const bookingConsensusElig = {
    included: result.BOOKING_COUNT >= 5,
    count:    result.BOOKING_COUNT,
  };

  const diagResult = computeMarketDiagnosticCrossSource({
    airbnbUniqueListings:       result._airbnbUnique   || [],
    bookingRawListings:         result._bookingRaw?.listings || [],
    targetLat, targetLon, targetGuests, targetBedrooms, targetPropertyType,
    today,
    airbnbConsensusEligibility:  airbnbConsensusElig,
    bookingConsensusEligibility: bookingConsensusElig,
  });

  // Diagnostic input observability — visible before eligibility verdict
  const ins = diagResult.inputStats;
  if (ins) {
    section('Diagnostic input counts (pre-eligibility)');
    const ia = ins.airbnb;
    const ib = ins.booking;
    console.log(`  AIRBNB_DIAGNOSTIC_INPUT_COUNT:  ${ia.inputCount}`);
    console.log(`  AIRBNB_DIAGNOSTIC_WITH_PRICE:   ${ia.withPrice}`);
    console.log(`  AIRBNB_DIAGNOSTIC_WITH_GEO:     ${ia.withGeo}`);
    console.log(`  AIRBNB_DIAGNOSTIC_VALID_COUNT:  ${ia.validCount}`);
    console.log(`  BOOKING_DIAGNOSTIC_INPUT_COUNT: ${ib.inputCount}`);
    console.log(`  BOOKING_DIAGNOSTIC_WITH_PRICE:  ${ib.withPrice}`);
    console.log(`  BOOKING_DIAGNOSTIC_WITH_GEO:    ${ib.withGeo}`);
    console.log(`  BOOKING_DIAGNOSTIC_VALID_COUNT: ${ib.validCount}`);
  }

  console.log(`  DIAGNOSTIC_STATUS:         ${diagResult.diagnosticStatus}`);
  console.log(`  COMMON_RADIUS_KM:          ${fmt(diagResult.commonRadiusKm, ' km')}`);

  if (diagResult.airbnb) {
    const a = diagResult.airbnb;
    console.log(`\n  AIRBNB DIAGNOSTIC:`);
    console.log(`    count:  ${a.count}`);
    console.log(`    median: ${fmt(a.median, ' €')}`);
    console.log(`    p25:    ${fmt(a.p25, ' €')}`);
    console.log(`    p75:    ${fmt(a.p75, ' €')}`);
  } else {
    console.log(`\n  AIRBNB DIAGNOSTIC: (unavailable)`);
  }

  if (diagResult.booking) {
    const b = diagResult.booking;
    console.log(`\n  BOOKING DIAGNOSTIC:`);
    console.log(`    count:  ${b.count}`);
    console.log(`    median: ${fmt(b.median, ' €')}`);
    console.log(`    p25:    ${fmt(b.p25, ' €')}`);
    console.log(`    p75:    ${fmt(b.p75, ' €')}`);
  } else {
    console.log(`\n  BOOKING DIAGNOSTIC: (unavailable)`);
  }

  console.log(`\n  DIVERGENCE_PCT:   ${fmtPct(diagResult.divergencePct)}`);
  console.log(`  DIVERGENCE_LEVEL: ${diagResult.divergenceLevel ?? 'N/A'}`);
  console.log(`  DIAGNOSTIC_REASON: ${diagResult.reason ?? 'none'}`);

  section('Eligibility (consensus vs diagnostic)');
  const ce = diagResult.consensusEligibility;
  const de = diagResult.diagnosticEligibility;
  console.log(`  airbnb  — consensus: ${ce?.airbnb  ? JSON.stringify(ce.airbnb)  : 'N/A'}`);
  console.log(`            diagnostic: ${de?.airbnb  ? JSON.stringify(de.airbnb)  : 'N/A'}`);
  console.log(`  booking — consensus: ${ce?.booking ? JSON.stringify(ce.booking) : 'N/A'}`);
  console.log(`            diagnostic: ${de?.booking ? JSON.stringify(de.booking) : 'N/A'}`);

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

  // ── PHASE 8: MARKET ACTIONABILITY ──────────────────────────────────────────
  banner(8, 'MARKET ACTIONABILITY');

  const prodMedian = prodSignal ? Number(prodSignal.median_price) : null;

  const actionResult = evaluateMarketActionability({
    marketStatus:       result.market_status,
    marketConfidence:   result.MARKET_CONFIDENCE,
    sourceUsage:        result.MARKET_SOURCE_USAGE,
    crossSourceDiagnostic: {
      divergenceLevel: diagResult.divergenceLevel,
    },
    airbnbReliability:  result.AIRBNB_RELIABILITY_STATUS,
    candidateMedian:    result.MARKET_CONSENSUS_MEDIAN,
    productionMedian:   prodMedian,
  });

  console.log(`  actionable:   ${actionResult.actionable ? 'YES' : 'NO'}`);
  console.log(`  status:       ${actionResult.status}`);

  if (actionResult.reasons.length > 0) {
    console.log(`  reasons:`);
    for (const r of actionResult.reasons) console.log(`    — ${r}`);
  } else {
    console.log(`  reasons:      (none)`);
  }

  if (actionResult.warnings.length > 0) {
    console.log(`  warnings:`);
    for (const w of actionResult.warnings) console.log(`    — ${w}`);
  }

  // ── PHASE 9: Production Sanity ──────────────────────────────────────────────
  banner(9, 'PRODUCTION SANITY');

  const sanityResult = analyzeProductionSignalSanity({
    productionSignal: prodSignal,
    airbnbDiagMedian:  diagResult.airbnb?.median  ?? null,
    bookingDiagMedian: diagResult.booking?.median ?? null,
    shadowConsensus:   result.MARKET_CONSENSUS_MEDIAN,
    now,
  });

  console.log(`  available:        ${sanityResult.available}`);
  if (!sanityResult.available) {
    console.log(`  reason:           ${sanityResult.reason}`);
  } else {
    console.log(`  PRODUCTION_MEDIAN:  ${fmt(sanityResult.productionMedian, ' €')}`);
    console.log(`  signal_age_hours:   ${fmt(sanityResult.signalAgeHours, 'h')}`);
    console.log(`  signal_count:       ${fmt(sanityResult.signalCount)}`);
    console.log(`  signal_data_source: ${sanityResult.signalDataSource ?? 'N/A'}`);
    console.log(`  signal_scraped_at:  ${sanityResult.signalScrapedAt ?? 'N/A'}`);
    console.log(`  signal_p25:         ${fmt(sanityResult.signalP25, ' €')}`);
    console.log(`  signal_p75:         ${fmt(sanityResult.signalP75, ' €')}`);
    console.log(`  signal_occupancy:   ${sanityResult.signalOccupancy != null ? sanityResult.signalOccupancy + '%' : 'N/A'}`);
    console.log(`  signal_tension:     ${sanityResult.signalTension ?? 'N/A'}`);

    const va = sanityResult.vsAirbnb;
    const vb = sanityResult.vsBooking;
    const vc = sanityResult.vsConsensus;
    console.log(`\n  vs_airbnb:    delta=${fmtPct(va.deltaPct)}  class=${va.classification}`);
    console.log(`  vs_booking:   delta=${fmtPct(vb.deltaPct)}  class=${vb.classification}`);
    console.log(`  vs_consensus: delta=${fmtPct(vc.deltaPct)}  class=${vc.classification}`);
  }

  // ── PHASE 10: Safety check ──────────────────────────────────────────────────
  banner(10, 'SAFETY CHECK (L)');

  const fs   = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');

  function readSrc(rel) {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); }
    catch { return ''; }
  }

  const srcK        = readSrc('services/market-engine-shadow-k.js');
  const srcL2       = readSrc('services/market-actionability-gate.js');
  const srcL3       = readSrc('services/market-diagnostic-cross-source.js');
  const srcL4       = readSrc('services/market-production-sanity.js');
  const srcL5       = readSrc('services/market-execution-policy.js');
  const srcValidator = fs.readFileSync(__filename, 'utf8');

  const P = {
    sqlWrite:    ['INS', 'ERT '].join(''),
    newPool:     ['new', ' Pool('].join(''),
    chxRqRel:   ["require", "('./chann"].join(''),
    pricingRel: ["require", "('./pricing-apply"].join(''),
    bdKey:      ['BRIGHT', 'DATA_API_KEY'].join(''),
  };

  function noChannex(s) { return !s.includes(P.chxRqRel); }
  function noPricing(s) { return !s.includes(P.pricingRel); }

  const checks = [
    { label: 'k-engine: no SQL write',            ok: !srcK.includes(P.sqlWrite) },
    { label: 'k-engine: no pool construction',    ok: !srcK.includes(P.newPool) },
    { label: 'l2-actionability: no SQL write',    ok: !srcL2.includes(P.sqlWrite) },
    { label: 'l2-actionability: no DB pool',      ok: !srcL2.includes(P.newPool) },
    { label: 'l3-diagnostic: no SQL write',       ok: !srcL3.includes(P.sqlWrite) },
    { label: 'l3-diagnostic: no DB pool',         ok: !srcL3.includes(P.newPool) },
    { label: 'l4-sanity: no SQL write',           ok: !srcL4.includes(P.sqlWrite) },
    { label: 'l4-sanity: no DB pool',             ok: !srcL4.includes(P.newPool) },
    { label: 'l5-execution-policy: no SQL write', ok: !srcL5.includes(P.sqlWrite) },
    { label: 'l5-execution-policy: no DB pool',   ok: !srcL5.includes(P.newPool) },
    { label: 'validator: no channex import',      ok: noChannex(srcValidator) },
    { label: 'validator: no pricing-apply',       ok: noPricing(srcValidator) },
    { label: 'validator: BD key not logged',      ok: !srcValidator.includes(P.bdKey) },
  ];

  let allOk = true;
  for (const { label, ok } of checks) {
    if (!ok) allOk = false;
    console.log(`  [${ok ? 'OK' : 'FAIL'}] ${label}`);
  }
  if (!allOk) console.log('\n  One or more safety checks FAILED — review above');

  console.log('\n' + '═'.repeat(72));
  console.log('  L VALIDATION COMPLETE (SINGLE-WINDOW)');
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
    console.error('Usage: node outils/validate-market-engine-shadow-l.js --name <nom> [--execute] [--check-in YYYY-MM-DD --check-out YYYY-MM-DD]');
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
      console.error(`\n  ${errType}: ${err.message}`);
      pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = { previewMode, executeMode };

#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-L9 — Shadow Market Engine L Multidate Validator
 *
 * Runs the L pipeline (K + L2/L3/L4/L5) across multiple date windows
 * and produces per-window + aggregate summaries.
 *
 * SAFETY:
 *   BD_CALLS       = 0 (preview) | up to 12 = 3 windows × 4 calls (execute)
 *   DB_WRITES      = 0  always
 *   PRICING_WRITES = 0  always
 *   CHANNEX_CALLS  = 0  always
 *   BD API key never printed to stdout
 *   PRODUCTION_ROUTING_UNCHANGED
 *   PRODUCTION_NOT_ACTIVATED
 *
 * CLI:
 *   node outils/validate-market-engine-multidate-l.js --name "M6"
 *   node outils/validate-market-engine-multidate-l.js --name "M6" --execute
 *   node outils/validate-market-engine-multidate-l.js --name "M6" --execute --windows 14,30,60
 */

require('dotenv').config();
const { Pool }                               = require('pg');
const { runShadowMarketEngine }              = require('../services/market-engine-shadow-k');
const { evaluateMarketActionability }        = require('../services/market-actionability-gate');
const { computeMarketDiagnosticCrossSource } = require('../services/market-diagnostic-cross-source');
const { analyzeProductionSignalSanity }      = require('../services/market-production-sanity');
const { evaluateExecutionPolicy }            = require('../services/market-execution-policy');
const { getFallbackZones }                   = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }                  = require('../routes/market-data-resolver');

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_WINDOWS_DAYS               = [14, 30, 60];
const MAX_WINDOWS                        = 3;
const MAX_AIRBNB_BD_CALLS_PER_WINDOW     = 3;
const MAX_BOOKING_BD_CALLS_PER_WINDOW    = 1;
const MAX_BD_CALLS_PER_WINDOW            = MAX_AIRBNB_BD_CALLS_PER_WINDOW + MAX_BOOKING_BD_CALLS_PER_WINDOW;
const MAX_MULTIDATE_BD_CALLS             = MAX_WINDOWS * MAX_BD_CALLS_PER_WINDOW;  // 12
const DEFAULT_NIGHTS                     = 3;

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

function banner(title) {
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(72));
}

function fmt(val, suffix = '') {
  return val != null ? `${val}${suffix}` : 'N/A';
}

function fmtPct(val) {
  return val != null ? `${Number(val).toFixed(2)}%` : 'N/A';
}

function _mean(arr) {
  const valid = arr.filter(v => v != null && Number.isFinite(v));
  if (!valid.length) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

function _spread(min, max) {
  if (min == null || max == null) return null;
  const denom = (min + max) / 2;
  if (denom === 0) return null;
  return Math.round((max - min) / denom * 100 * 100) / 100;
}

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode({ name, pool, windowsDays = DEFAULT_WINDOWS_DAYS, _now } = {}) {
  banner('B5-BK-L Multidate Validator — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0\n');

  // Validate window count
  if (windowsDays.length > MAX_WINDOWS) {
    console.log(`  ERROR: ${windowsDays.length} windows requested but MAX_WINDOWS=${MAX_WINDOWS}`);
    console.log(`  Reduce to ${MAX_WINDOWS} windows or fewer.`);
    return { ok: false };
  }

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) { console.log(`  Aucune propriété: "${name}"`); return { ok: false }; }
  if (rows.length > 1)   { console.log(`  Ambiguïté: ${rows.length} correspondances`); return { ok: false }; }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency) || prop.currency || '?';
  const now      = _now || new Date();

  console.log(`  PROPERTY:  ${prop.internal_name || prop.name}  (id=${prop.id})`);
  console.log(`  CURRENCY:  ${currency}   GUESTS: ${prop.max_guests ?? '?'}  BEDROOMS: ${prop.bedrooms ?? '?'}\n`);

  const totalPlannedCalls = windowsDays.length * MAX_BD_CALLS_PER_WINDOW;
  console.log(`  PLANNED WINDOWS: ${windowsDays.length}`);
  console.log(`  MAX_BD_CALLS_PER_WINDOW: ${MAX_BD_CALLS_PER_WINDOW}`);
  console.log(`  MAX_TOTAL_BD_CALLS: ${totalPlannedCalls}  (hard limit: ${MAX_MULTIDATE_BD_CALLS})`);
  console.log(`  ACTUAL_BD_CALLS: 0  (preview — add --execute to run)\n`);

  for (const days of windowsDays) {
    const checkIn  = addDaysISO(now, days,         timezone);
    const checkOut = addDaysISO(now, days + DEFAULT_NIGHTS, timezone);
    console.log(`  J+${String(days).padEnd(3)} → checkIn: ${checkIn}  checkOut: ${checkOut}`);
  }

  console.log(`\n  Ready: node outils/validate-market-engine-multidate-l.js --name "${name}" --execute`);
  console.log('═'.repeat(72) + '\n');
  return { ok: true };
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode({ name, pool, windowsDays = DEFAULT_WINDOWS_DAYS, _now } = {}) {
  banner('B5-BK-L Multidate Validator — EXECUTE MODE');
  console.log('  MAX_BD_CALLS=12 (3 windows × 4) | DB_WRITES=0 | PRICING_WRITES=0 | CHANNEX_CALLS=0\n');

  // BD budget enforcement before ANY execution
  const totalPlannedCalls = windowsDays.length * MAX_BD_CALLS_PER_WINDOW;
  if (windowsDays.length > MAX_WINDOWS || totalPlannedCalls > MAX_MULTIDATE_BD_CALLS) {
    const msg = `BD budget exceeded: ${windowsDays.length} windows × ${MAX_BD_CALLS_PER_WINDOW} = ${totalPlannedCalls} calls > MAX_MULTIDATE_BD_CALLS=${MAX_MULTIDATE_BD_CALLS}`;
    console.error(`  ERROR: ${msg}`);
    throw new Error(msg);
  }

  const rows = await resolveProp(pool, name);
  if (rows.length === 0) throw new Error(`Aucune propriété: "${name}"`);
  if (rows.length > 1)   throw new Error(`${rows.length} correspondances pour "${name}"`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  if (!currency) throw new Error('Devise propriété invalide ou absente');

  const now                = _now || new Date();
  const today              = now.toISOString().slice(0, 10);
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

  const prodSignal = await fetchCurrentProductionSignal(pool, prop.id);
  const prodMedian = prodSignal ? Number(prodSignal.median_price) : null;

  console.log(`  PROPERTY: ${prop.internal_name || prop.name}  (id=${prop.id})`);
  console.log(`  LOCATION: ${location}  CURRENCY: ${currency}`);
  console.log(`  LAT: ${targetLat}  LON: ${targetLon}  GUESTS: ${targetGuests ?? '?'}  BEDROOMS: ${targetBedrooms ?? '?'}`);
  console.log(`  PRODUCTION_MEDIAN: ${fmt(prodMedian, ' €')}\n`);

  // Per-window results
  const windowSummaries = [];
  const executionPolicyInputs = [];
  let totalAirbnbBdCalls = 0;
  let totalBookingBdCalls = 0;
  const tStart = Date.now();

  for (const days of windowsDays) {
    const checkIn  = addDaysISO(now, days,                  timezone);
    const checkOut = addDaysISO(now, days + DEFAULT_NIGHTS, timezone);

    banner(`WINDOW J+${days}: ${checkIn} → ${checkOut}`);
    const tW = Date.now();

    const result = await runShadowMarketEngine({
      targetLat, targetLon, targetGuests, targetBedrooms, targetPropertyType,
      location, currency, checkIn, checkOut, today,
      maxAirbnbListings: 100, maxBookingListings: 100,
    });

    const elapsed = ((Date.now() - tW) / 1000);
    totalAirbnbBdCalls  += result.actualBdCalls;
    totalBookingBdCalls += result.bookingBdCalls;

    // L3 — diagnostic
    const diagResult = computeMarketDiagnosticCrossSource({
      airbnbUniqueListings:  result._airbnbUnique   || [],
      bookingRawListings:    result._bookingRaw?.listings || [],
      targetLat, targetLon, targetGuests, targetBedrooms, targetPropertyType,
      today,
      airbnbConsensusEligibility:  { included: result.AIRBNB_RELIABILITY_STATUS === 'STABLE_LOCAL_POOL' },
      bookingConsensusEligibility: { included: result.BOOKING_COUNT >= 5 },
    });

    // L2 — actionability
    const actionResult = evaluateMarketActionability({
      marketStatus:         result.market_status,
      marketConfidence:     result.MARKET_CONFIDENCE,
      sourceUsage:          result.MARKET_SOURCE_USAGE,
      crossSourceDiagnostic: { divergenceLevel: diagResult.divergenceLevel },
      airbnbReliability:    result.AIRBNB_RELIABILITY_STATUS,
      candidateMedian:      result.MARKET_CONSENSUS_MEDIAN,
      productionMedian:     prodMedian,
    });

    // L4 — production sanity
    const sanityResult = analyzeProductionSignalSanity({
      productionSignal,
      airbnbDiagMedian:  diagResult.airbnb?.median  ?? null,
      bookingDiagMedian: diagResult.booking?.median ?? null,
      shadowConsensus:   result.MARKET_CONSENSUS_MEDIAN,
      now,
    });

    // Print window block
    console.log(`  DATE_WINDOW:                 ${checkIn} → ${checkOut}`);
    console.log(`  AIRBNB_BD_CALLS:             ${result.actualBdCalls}`);
    console.log(`  BOOKING_BD_CALLS:            ${result.bookingBdCalls}`);
    console.log(`  TOTAL_RUNTIME_SECONDS:       ${elapsed.toFixed(1)}`);
    console.log('');
    console.log(`  AIRBNB_POOL_RADIUS:          ${fmt(result.AIRBNB_POOL_RADIUS_KM, ' km')}`);
    console.log(`  AIRBNB_POOL_COUNT:           ${result.AIRBNB_POOL_COUNT}`);
    console.log(`  AIRBNB_POOL_MEDIAN:          ${fmt(result.AIRBNB_POOL_MEDIAN, ' €')}`);
    console.log(`  AIRBNB_RELIABILITY_STATUS:   ${result.AIRBNB_RELIABILITY_STATUS}`);
    console.log('');
    console.log(`  BOOKING_RADIUS:              ${fmt(result.BOOKING_RADIUS_KM, ' km')}`);
    console.log(`  BOOKING_COUNT:               ${result.BOOKING_COUNT}`);
    console.log(`  BOOKING_MEDIAN:              ${fmt(result.BOOKING_MEDIAN, ' €')}`);
    console.log('');
    console.log(`  DIAGNOSTIC_COMMON_RADIUS:    ${fmt(diagResult.commonRadiusKm, ' km')}`);
    console.log(`  DIAGNOSTIC_AIRBNB_COUNT:     ${diagResult.airbnb?.count   ?? 'N/A'}`);
    console.log(`  DIAGNOSTIC_BOOKING_COUNT:    ${diagResult.booking?.count  ?? 'N/A'}`);
    console.log(`  DIAGNOSTIC_AIRBNB_MEDIAN:    ${diagResult.airbnb?.median  != null ? diagResult.airbnb.median + ' €' : 'N/A'}`);
    console.log(`  DIAGNOSTIC_BOOKING_MEDIAN:   ${diagResult.booking?.median != null ? diagResult.booking.median + ' €' : 'N/A'}`);
    console.log(`  DIAGNOSTIC_DIVERGENCE_PCT:   ${fmtPct(diagResult.divergencePct)}`);
    console.log(`  DIAGNOSTIC_DIVERGENCE_LEVEL: ${diagResult.divergenceLevel ?? 'N/A'}`);
    console.log('');
    console.log(`  MARKET_STATUS:               ${result.market_status}`);
    console.log(`  MARKET_CONSENSUS_MEDIAN:     ${fmt(result.MARKET_CONSENSUS_MEDIAN, ' €')}`);
    console.log(`  MARKET_CONFIDENCE:           ${result.MARKET_CONFIDENCE}`);
    console.log('');
    console.log(`  MARKET_ACTIONABILITY:        ${actionResult.status}`);
    console.log(`  ACTIONABILITY_REASONS:       ${actionResult.reasons.join(', ') || '(none)'}`);
    console.log('');
    console.log(`  PRODUCTION_MEDIAN:           ${fmt(prodMedian, ' €')}`);
    console.log(`  CANDIDATE_VS_PRODUCTION_DELTA_PCT: ${fmtPct(sanityResult.vsConsensus?.deltaPct)}`);

    windowSummaries.push({
      days,
      airbnbBdCalls:      result.actualBdCalls,
      bookingBdCalls:     result.bookingBdCalls,
      runtimeSeconds:     elapsed,
      airbnbStable:       result.AIRBNB_RELIABILITY_STATUS === 'STABLE_LOCAL_POOL',
      bookingPresent:     result.BOOKING_COUNT > 0,
      hasCommonDiag:      diagResult.diagnosticStatus === 'DIAGNOSTIC_AVAILABLE',
      dualSource:         result.market_status === 'STABLE_DUAL',
      actionable:         actionResult.actionable,
      lowConfidence:      result.MARKET_CONFIDENCE === 'LOW' || result.MARKET_CONFIDENCE === 'INSUFFICIENT',
      airbnbMedian:       result.AIRBNB_POOL_MEDIAN,
      bookingMedian:      result.BOOKING_MEDIAN,
      consensusMedian:    result.MARKET_CONSENSUS_MEDIAN,
      diagDivergencePct:  diagResult.divergencePct,
      vsProductionDelta:  sanityResult.vsConsensus?.deltaPct ?? null,
    });

    // For execution policy
    executionPolicyInputs.push({
      earlyStopTriggered:      result.earlyStopTriggered,
      actualBdCalls:           result.actualBdCalls,
      airbnbReliabilityStatus: result.AIRBNB_RELIABILITY_STATUS,
      airbnbGeoStatuses:       result._airbnbGate?.POOLED_GEO_STATUSES || [],
    });
  }

  const totalRuntime = ((Date.now() - tStart) / 1000).toFixed(1);

  // ── Aggregate summary ───────────────────────────────────────────────────────
  banner('AGGREGATE SUMMARY');

  const airbnbMedians    = windowSummaries.map(w => w.airbnbMedian).filter(v => v != null);
  const bookingMedians   = windowSummaries.map(w => w.bookingMedian).filter(v => v != null);
  const consensusMedians = windowSummaries.map(w => w.consensusMedian).filter(v => v != null);
  const diagDivPcts      = windowSummaries.map(w => w.diagDivergencePct).filter(v => v != null);
  const prodDeltas       = windowSummaries.map(w => w.vsProductionDelta).filter(v => v != null);

  const minOf = arr => arr.length ? Math.min(...arr) : null;
  const maxOf = arr => arr.length ? Math.max(...arr) : null;

  console.log(`  WINDOWS_RUN:                     ${windowSummaries.length}`);
  console.log(`  WINDOWS_WITH_STABLE_AIRBNB:      ${windowSummaries.filter(w => w.airbnbStable).length}`);
  console.log(`  WINDOWS_WITH_BOOKING:            ${windowSummaries.filter(w => w.bookingPresent).length}`);
  console.log(`  WINDOWS_WITH_COMMON_DIAGNOSTIC:  ${windowSummaries.filter(w => w.hasCommonDiag).length}`);
  console.log(`  WINDOWS_WITH_TWO_SOURCE_CONSENSUS: ${windowSummaries.filter(w => w.dualSource).length}`);
  console.log(`  WINDOWS_ACTIONABLE:              ${windowSummaries.filter(w => w.actionable).length}`);
  console.log(`  WINDOWS_LOW_CONFIDENCE:          ${windowSummaries.filter(w => w.lowConfidence).length}`);
  console.log('');

  const aMin = minOf(airbnbMedians);
  const aMax = maxOf(airbnbMedians);
  console.log(`  AIRBNB_MEDIAN_MIN:               ${fmt(aMin, ' €')}`);
  console.log(`  AIRBNB_MEDIAN_MAX:               ${fmt(aMax, ' €')}`);
  console.log(`  AIRBNB_MEDIAN_SPREAD_PCT:        ${fmtPct(_spread(aMin, aMax))}`);
  console.log('');

  const bMin = minOf(bookingMedians);
  const bMax = maxOf(bookingMedians);
  console.log(`  BOOKING_MEDIAN_MIN:              ${fmt(bMin, ' €')}`);
  console.log(`  BOOKING_MEDIAN_MAX:              ${fmt(bMax, ' €')}`);
  console.log(`  BOOKING_MEDIAN_SPREAD_PCT:       ${fmtPct(_spread(bMin, bMax))}`);
  console.log('');

  const cMin = minOf(consensusMedians);
  const cMax = maxOf(consensusMedians);
  console.log(`  CONSENSUS_MEDIAN_MIN:            ${fmt(cMin, ' €')}`);
  console.log(`  CONSENSUS_MEDIAN_MAX:            ${fmt(cMax, ' €')}`);
  console.log(`  CONSENSUS_MEDIAN_SPREAD_PCT:     ${fmtPct(_spread(cMin, cMax))}`);
  console.log('');

  const diagDivMin  = minOf(diagDivPcts);
  const diagDivMax  = maxOf(diagDivPcts);
  const diagDivMean = _mean(diagDivPcts);
  console.log(`  DIAGNOSTIC_DIVERGENCE_MIN:       ${fmtPct(diagDivMin)}`);
  console.log(`  DIAGNOSTIC_DIVERGENCE_MAX:       ${fmtPct(diagDivMax)}`);
  console.log(`  DIAGNOSTIC_DIVERGENCE_MEAN:      ${diagDivMean != null ? diagDivMean.toFixed(2) + '%' : 'N/A'}`);
  console.log('');

  const prodDeltaMin  = minOf(prodDeltas);
  const prodDeltaMax  = maxOf(prodDeltas);
  const prodDeltaMean = _mean(prodDeltas);
  console.log(`  PRODUCTION_DELTA_MIN:            ${fmtPct(prodDeltaMin)}`);
  console.log(`  PRODUCTION_DELTA_MAX:            ${fmtPct(prodDeltaMax)}`);
  console.log(`  PRODUCTION_DELTA_MEAN:           ${prodDeltaMean != null ? prodDeltaMean.toFixed(2) + '%' : 'N/A'}`);
  console.log('');

  console.log(`  TOTAL_AIRBNB_BD_CALLS:           ${totalAirbnbBdCalls}`);
  console.log(`  TOTAL_BOOKING_BD_CALLS:          ${totalBookingBdCalls}`);
  console.log(`  TOTAL_BD_CALLS:                  ${totalAirbnbBdCalls + totalBookingBdCalls}`);
  console.log(`  TOTAL_RUNTIME_SECONDS:           ${totalRuntime}`);
  console.log('');

  const execPolicy = evaluateExecutionPolicy(executionPolicyInputs);
  console.log(`  EXECUTION_POLICY_RECOMMENDATION: ${execPolicy.policy}`);
  console.log(`  EXECUTION_POLICY_REASON:         ${execPolicy.reason}`);

  console.log('\n' + '═'.repeat(72));
  console.log('  L MULTIDATE VALIDATION COMPLETE');
  console.log(`  WINDOWS: ${windowSummaries.length} | TOTAL_BD_CALLS: ${totalAirbnbBdCalls + totalBookingBdCalls} | RUNTIME: ${totalRuntime}s`);
  console.log('  DB_WRITES: 0 | PRICING_WRITES: 0 | CHANNEX_CALLS: 0');
  console.log('  PRODUCTION_NOT_ACTIVATED');
  console.log('═'.repeat(72) + '\n');

  return { windowSummaries, execPolicy };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args      = process.argv.slice(2);
  const nameIdx   = args.indexOf('--name');
  const name      = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute   = args.includes('--execute');
  const winIdx    = args.indexOf('--windows');
  const winArg    = winIdx !== -1 ? args[winIdx + 1] : null;

  const windowsDays = winArg
    ? winArg.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : DEFAULT_WINDOWS_DAYS;

  if (!name) {
    console.error('Usage: node outils/validate-market-engine-multidate-l.js --name <nom> [--execute] [--windows 14,30,60]');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const opts    = { name, pool, windowsDays };
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

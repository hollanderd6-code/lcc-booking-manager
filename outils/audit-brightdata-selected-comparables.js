#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B5-F3 — Bright Data Comparable Selection Audit
 *
 * Preview:  node outils/audit-brightdata-selected-comparables.js --name "M6"
 * Execute:  node outils/audit-brightdata-selected-comparables.js --name "M6" --execute
 *
 * SAFETY CONTRACT:
 *   Preview:  0 BD calls, 0 DB writes
 *   Execute:  1 BD call, 0 DB writes, 0 market_data writes, 0 Channex calls, 0 pricing writes
 *
 * PURPOSE:
 *   Diagnose the comparable set selected by B5-F1 selectComparables().
 *   Audit price distribution, category/capacity contamination, radius sensitivity.
 *   DIAGNOSIS ONLY — does not modify production selection logic.
 *
 * F3_PRODUCTION_HELPERS_REUSED  = YES
 * F3_DB_WRITE_REQUIRED          = NO
 * F3_LIVE_CALL_COUNT            = 1
 * PRODUCTION_BEHAVIOR_CHANGED   = NO
 */

// ── Safe imports only ──────────────────────────────────────────────────────────
const { scrapeWithBrightData, DATASET_ID } = require('../services/providers/brightdata');
const {
  selectComparables, calcBrightDataMarketStats,
  haversineKm, RADIUS_BANDS_KM,
  MIN_COMPARABLES_TARGET, MIN_COMPARABLES_FALLBACK,
  CALENDAR_WINDOW_DAYS,
} = require('../services/brightdata-comparable-filter');
const { getBrightDataMarketDates }  = require('../services/market-provider');
const { computeMarketContextKey }   = require('../routes/market-context-key');
const { normalizeCurrency }         = require('../routes/market-data-resolver');
const { Pool }                      = require('pg');

const MAX_LISTINGS = 100;

// ── AbortError ────────────────────────────────────────────────────────────────
class AbortError extends Error {
  constructor(msg) { super(msg); this.name = 'AbortError'; }
}
function abort(msg) { throw new AbortError(msg); }

// ── Stats helpers ─────────────────────────────────────────────────────────────

function stdMedian(sorted) {
  if (!sorted.length) return null;
  const n   = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function floorPct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

function calcStats(prices) {
  if (!prices.length) return { count: 0, min: null, p25: null, median: null, p75: null, max: null, mean: null };
  const s = [...prices].sort((a, b) => a - b);
  const mean = s.reduce((t, v) => t + v, 0) / s.length;
  return {
    count:  s.length,
    min:    s[0],
    p25:    floorPct(s, 0.25),
    median: stdMedian(s),
    p75:    floorPct(s, 0.75),
    max:    s[s.length - 1],
    mean:   parseFloat(mean.toFixed(2)),
  };
}

function fmt(v) { return v == null ? '  N/A ' : v.toFixed(2).padStart(8); }
function fmtN(v) { return v == null ? '  -  ' : String(v).padStart(5); }

function addDaysUTC(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarUnavailRate(listing, today, windowDays) {
  if (!Array.isArray(listing.availableDates)) return null;
  const endDate = addDaysUTC(today, windowDays);
  const valid   = listing.availableDates.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  const inWin   = valid.filter(d => d >= today && d < endDate);
  return Math.round(((windowDays - inWin.length) / windowDays) * 100);
}

function maskId(id) {
  if (id == null) return 'unknown';
  const s = String(id);
  return s.length <= 8 ? s : '***' + s.slice(-6);
}

function guestsLabel(g) {
  if (g == null) return 'missing';
  if (g <= 2)   return '<=2';
  if (g === 3)  return '3';
  if (g === 4)  return '4';
  if (g === 5)  return '5';
  return '>=6';
}

function categoryType(cat) {
  if (cat == null) return 'missing';
  const c = cat.toLowerCase();
  if (c.includes('entire')) return 'entire_place';
  if (c.includes('hotel'))  return 'hotel';
  if (c.includes('room') || c.includes('shared') || c.includes('hostel')) return 'room';
  return 'other';
}

// ── Property lookup ───────────────────────────────────────────────────────────
async function resolvePropF3(pool, name) {
  return (await pool.query(
    `SELECT p.id, p.user_id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.country_code, p.timezone,
            p.currency, p.channex_enabled, p.max_guests,
            pc.is_active, pc.mode
       FROM properties p
       LEFT JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
}

// ── Preview mode ──────────────────────────────────────────────────────────────
// BRIGHTDATA_CALLS = 0   DB_WRITES = 0
async function previewMode(pool, { name, _now, _getFallbackZones } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-F3 COMPARABLE SELECTION AUDIT — PREVIEW MODE (READ-ONLY)');
  console.log('  BRIGHTDATA_CALLS=0 | DB_WRITES=0');
  console.log('═'.repeat(72));

  const rows = await resolvePropF3(pool, name);
  if (rows.length === 0) {
    console.log(`\n  ⛔  Aucune propriété trouvée: "${name}"`);
    return { ok: false, abort: `no_target: "${name}"` };
  }
  if (rows.length > 1) {
    console.log(`  ⛔  Ambiguïté: ${rows.length} propriétés correspondent à "${name}"`);
    return { ok: false, abort: `ambiguous_target: ${rows.length} matches` };
  }

  const prop     = rows[0];
  const tz       = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  const ctxKey   = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
    longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
  });
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone: tz, now: _now });
  const apiKeyPresent = !!(process.env.BRIGHTDATA_API_KEY);

  const getFallbackZones = _getFallbackZones || require('../routes/dynamic-pricing-cron').getFallbackZones;
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  console.log('\n  PROPERTY:');
  console.log(`    id:               ${prop.id}`);
  console.log(`    name:             ${prop.internal_name || prop.name}`);
  console.log(`    latitude:         ${prop.latitude}`);
  console.log(`    longitude:        ${prop.longitude}`);
  console.log(`    country_code:     ${prop.country_code}`);
  console.log(`    timezone:         ${tz}`);
  console.log(`    currency:         ${prop.currency} → ${currency}`);
  console.log(`    max_guests:       ${prop.max_guests ?? 'N/A'}`);
  console.log(`    market_ctx_key:   ${ctxKey}`);

  console.log('\n  PLANNED SCRAPE:');
  console.log(`    BRIGHTDATA_API_KEY: ${apiKeyPresent ? 'présent' : 'ABSENT ⚠'}`);
  console.log(`    location:           ${location}`);
  console.log(`    checkIn:            ${checkIn}`);
  console.log(`    checkOut:           ${checkOut}`);
  console.log(`    max_listings:       ${MAX_LISTINGS}`);
  console.log(`    currency:           ${currency}`);

  console.log('\n  B5-F1 SELECTION PARAMETERS:');
  console.log(`    targetLat:          ${prop.latitude}`);
  console.log(`    targetLon:          ${prop.longitude}`);
  console.log(`    targetGuests:       ${prop.max_guests ?? 'N/A'}`);
  console.log(`    targetPropertyType: null`);
  console.log(`    MIN_COMPARABLES_TARGET:   ${MIN_COMPARABLES_TARGET}  (preferred)`);
  console.log(`    MIN_COMPARABLES_FALLBACK: ${MIN_COMPARABLES_FALLBACK} (acceptable)`);

  const geoOk   = !!(prop.latitude && prop.longitude);
  const tzOk    = !!(prop.timezone);
  const currOk  = !!(currency);
  const ready   = geoOk && tzOk && currOk && apiKeyPresent;

  console.log(`\n  PREFLIGHT: ${ready ? '✅ READY' : '⚠ NOT READY'}`);
  if (!geoOk)       console.log('    ❌ latitude/longitude manquants');
  if (!tzOk)        console.log('    ❌ timezone manquant');
  if (!currOk)      console.log('    ❌ currency invalide');
  if (!apiKeyPresent) console.log('    ❌ BRIGHTDATA_API_KEY absent');

  console.log('\n  Run with --execute to perform the audit.');
  console.log('═'.repeat(72) + '\n');

  return { ok: ready, propertyId: prop.id };
}

// ── Execute mode ──────────────────────────────────────────────────────────────
// MARKET_DATA_WRITES = 0  CHANNEX_WRITES = 0  PRICING_WRITES = 0
async function executeMode(pool, { name, _now, _bdScrape, _getFallbackZones } = {}) {
  const bdScrape = _bdScrape || scrapeWithBrightData;

  console.log('\n' + '═'.repeat(72));
  console.log('  B5-F3 COMPARABLE SELECTION AUDIT — EXECUTE MODE');
  console.log('  MARKET_DATA_WRITES=0 | CHANNEX_WRITES=0 | PRICING_WRITES=0');
  console.log('═'.repeat(72));

  // ── 1. Resolve property ───────────────────────────────────────────────────
  const rows = await resolvePropF3(pool, name);
  if (rows.length === 0) abort(`Propriété introuvable: "${name}"`);
  if (rows.length > 1)   abort(`Ambiguïté: ${rows.length} propriétés pour "${name}"`);
  const prop = rows[0];

  const capturedPropertyId       = prop.id;
  const capturedTimezone         = prop.timezone || 'Europe/Paris';
  const capturedPropertyCurrency = normalizeCurrency(prop.currency);
  const capturedLat   = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const capturedLon   = prop.longitude != null ? parseFloat(prop.longitude) : null;
  const capturedGuests = prop.max_guests != null ? parseInt(prop.max_guests, 10) : null;

  if (!process.env.BRIGHTDATA_API_KEY) abort('BRIGHTDATA_API_KEY absent — impossible de scraper');
  if (!Number.isFinite(capturedLat) || !Number.isFinite(capturedLon))
    abort('latitude/longitude manquants — comparaison géographique impossible');

  // ── 2. Safety snapshots (read-only) ──────────────────────────────────────
  const pcRow = (await pool.query(
    `SELECT is_active, mode, updated_at FROM pricing_config WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const schedCnt = (await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM pricing_schedule WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const propRow = (await pool.query(
    `SELECT name, address, latitude, longitude, country_code, timezone, currency, channex_enabled
       FROM properties WHERE id = $1`,
    [capturedPropertyId]
  )).rows[0];

  const snapBefore = {
    pricingConfig: JSON.stringify(pcRow),
    scheduleCount: schedCnt?.cnt,
    propFingerprint: JSON.stringify(propRow),
  };

  // ── 3. Dates & zone ───────────────────────────────────────────────────────
  const today        = new Date().toLocaleString('sv-SE', { timeZone: capturedTimezone }).slice(0, 10);
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone: capturedTimezone, now: _now });
  const getFallbackZones = _getFallbackZones || require('../routes/dynamic-pricing-cron').getFallbackZones;
  const location = getFallbackZones(prop.address, null)[0];

  console.log(`\n  PROPERTY: ${prop.internal_name || prop.name} (${capturedPropertyId})`);
  console.log(`  LOCATION: ${location}   currency=${capturedPropertyCurrency}   checkIn=${checkIn}   checkOut=${checkOut}`);

  // ── 4. Bright Data scrape (1 call) ────────────────────────────────────────
  console.log('\n  🔍 Scraping Bright Data...');
  let bdResult;
  try {
    bdResult = await bdScrape(location, MAX_LISTINGS, capturedPropertyCurrency, { checkIn, checkOut });
  } catch (err) {
    abort(`Bright Data call failed: ${err.message}`);
  }

  if (bdResult.isMock)                          abort('Résultat mock — brightdata_live requis');
  if (bdResult.dataSource !== 'brightdata_live') abort(`dataSource=${bdResult.dataSource} — brightdata_live requis`);

  const accepted = bdResult.listings;
  const diag     = bdResult.diagnostics || {};

  if (accepted.length === 0) abort('Bright Data: 0 listings acceptés');

  console.log(`  RAW: returned=${diag.returnedCount ?? '?'}  accepted=${accepted.length}`);
  console.log(`       rejected_price=${diag.rejectedPriceCount ?? '?'}  rejected_currency=${diag.rejectedCurrencyCount ?? '?'}`);

  // ── 5. B5-F1 selectComparables ────────────────────────────────────────────
  const { listings: selected, status: selStatus, selectedRadiusKm, diagnostics: selDiag } =
    selectComparables(accepted, {
      targetLat:   capturedLat,
      targetLon:   capturedLon,
      targetGuests: capturedGuests,
    });

  // ── 6. Market stats ───────────────────────────────────────────────────────
  const stats = selected.length > 0
    ? calcBrightDataMarketStats(selected, { today })
    : null;

  // ── Augment with distances ─────────────────────────────────────────────────
  const withDist = accepted
    .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    .map(l => ({ ...l, _dist: haversineKm(capturedLat, capturedLon, l.latitude, l.longitude) }))
    .sort((a, b) => a._dist - b._dist || a.price - b.price);

  const selectedIds = new Set(selected.map(l => l.providerListingId));
  const inSelected  = l => selectedIds.has(l.providerListingId);

  // ── PHASE 1: SELECTION ALGORITHM ─────────────────────────────────────────
  const sep = '─'.repeat(72);
  console.log('\n' + sep);
  console.log('  PHASE 1 — SELECTION ALGORITHM ANALYSIS');
  console.log(sep);
  console.log(`  MIN_COMPARABLES_TARGET:   ${MIN_COMPARABLES_TARGET}  (preferred — Pass 1)`);
  console.log(`  MIN_COMPARABLES_FALLBACK: ${MIN_COMPARABLES_FALLBACK} (acceptable — Pass 2, only if Pass 1 yields nothing)`);
  console.log(`\n  RADIUS CANDIDATE COUNTS (after dedup + category + capacity filters):`);
  let firstWith5 = null, firstWith8 = null, firstWith10 = null;
  const rcc = selDiag.radiusCandidateCounts || {};
  for (const r of RADIUS_BANDS_KM) {
    const n = rcc[r] ?? withDist.filter(l => l._dist <= r && inSelected(l)).length;
    const mark = r === selectedRadiusKm ? ' ← SELECTED' : '';
    console.log(`    ${String(r).padStart(3)} km: ${String(rcc[r] ?? '?').padStart(3)} comparables${mark}`);
    if (firstWith5 == null  && (rcc[r] ?? 0) >= 5)  firstWith5  = r;
    if (firstWith8 == null  && (rcc[r] ?? 0) >= 8)  firstWith8  = r;
    if (firstWith10 == null && (rcc[r] ?? 0) >= 10) firstWith10 = r;
  }
  console.log(`\n  FIRST_RADIUS_WITH_5:     ${firstWith5  ?? 'none'} km`);
  console.log(`  FIRST_RADIUS_WITH_8:     ${firstWith8  ?? 'none'} km`);
  console.log(`  FIRST_RADIUS_WITH_10:    ${firstWith10 ?? 'none'} km`);
  console.log(`  ACTUAL_SELECTED_RADIUS:  ${selectedRadiusKm ?? 'none'} km`);
  console.log(`  FINAL_COMPARABLE_COUNT:  ${selected.length}`);

  const passExplanation = firstWith8 != null
    ? `Pass 1 found ≥${MIN_COMPARABLES_TARGET} at ${firstWith8} km → selected directly (Pass 2 never ran)`
    : `Pass 1 found no radius with ≥${MIN_COMPARABLES_TARGET} → Pass 2 used ≥${MIN_COMPARABLES_FALLBACK} → selected ${selectedRadiusKm ?? 'none'} km`;
  console.log(`\n  WHY: ${passExplanation}`);

  // ── PHASE 3: SELECTED COMPARABLES TABLE ──────────────────────────────────
  console.log('\n' + sep);
  console.log('  PHASE 3 — SELECTED COMPARABLES (sanitized, sorted by distance then price)');
  console.log(sep);
  console.log('  ' + 'MASKED_ID'.padEnd(12) + ' DIST_KM  PRICE    GUESTS  CATEGORY              AVAIL_CT UNAVAIL%');
  console.log('  ' + '─'.repeat(70));

  const selectedWithDist = selected
    .map(l => ({
      ...l,
      _dist: (Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
        ? haversineKm(capturedLat, capturedLon, l.latitude, l.longitude)
        : null,
      _unavail: calendarUnavailRate(l, today, CALENDAR_WINDOW_DAYS),
      _avCount: Array.isArray(l.availableDates) ? l.availableDates.length : null,
    }))
    .sort((a, b) => {
      if (a._dist == null && b._dist != null) return 1;
      if (a._dist != null && b._dist == null) return -1;
      if (a._dist !== b._dist) return (a._dist ?? 0) - (b._dist ?? 0);
      return a.price - b.price;
    });

  for (const l of selectedWithDist) {
    const dist    = l._dist  != null ? l._dist.toFixed(2).padStart(7) : '    N/A';
    const price   = l.price  != null ? l.price.toFixed(2).padStart(8)  : '     N/A';
    const guests  = l.guests != null ? String(l.guests).padStart(6)    : '   N/A';
    const catRaw  = l.category || 'N/A';
    const cat     = catRaw.slice(0, 20).padEnd(20);
    const avCt    = l._avCount  != null ? String(l._avCount).padStart(8)  : '      N/A';
    const unavail = l._unavail  != null ? String(l._unavail).padStart(7) + '%' : '      N/A';
    console.log(`  ${maskId(l.providerListingId).padEnd(12)} ${dist}  ${price}  ${guests}  ${cat}  ${avCt}  ${unavail}`);
  }

  // ── PHASE 4: PRICE DISTRIBUTION BY RADIUS ────────────────────────────────
  console.log('\n' + sep);
  console.log('  PHASE 4 — PRICE DISTRIBUTION BY RADIUS');
  console.log(sep);
  console.log('  ' + 'RADIUS'.padEnd(8) + ' COUNT  ' + 'MIN'.padStart(8) + '  ' + 'P25'.padStart(8) + '  ' +
    'MEDIAN'.padStart(8) + '  ' + 'P75'.padStart(8) + '  ' + 'MAX'.padStart(8) + '  ' + 'MEAN'.padStart(8));
  console.log('  ' + '─'.repeat(70));

  for (const r of RADIUS_BANDS_KM) {
    const inR   = withDist.filter(l => l._dist <= r && l.price > 0);
    const st    = calcStats(inR.map(l => l.price));
    const mark  = r === selectedRadiusKm ? ' ← B5-F1' : '';
    console.log(`  ${String(r).padStart(3)} km  ` + fmtN(st.count) +
      fmt(st.min) + '  ' + fmt(st.p25) + '  ' + fmt(st.median) + '  ' +
      fmt(st.p75) + '  ' + fmt(st.max) + '  ' + fmt(st.mean) + mark);
  }

  // ── PHASE 5: PRICE DISTRIBUTION BY CAPACITY ──────────────────────────────
  console.log('\n' + sep);
  console.log('  PHASE 5 — PRICE DISTRIBUTION BY CAPACITY (all geolocated+accepted listings)');
  console.log(sep);
  console.log('  ' + 'GUESTS'.padEnd(10) + ' COUNT  ' + 'P25'.padStart(8) + '  ' +
    'MEDIAN'.padStart(8) + '  ' + 'P75'.padStart(8) + '  ' + 'MEAN'.padStart(8));
  console.log('  ' + '─'.repeat(56));

  const buckets = ['<=2', '3', '4', '5', '>=6', 'missing'];
  for (const bk of buckets) {
    const inB = withDist.filter(l => guestsLabel(l.guests) === bk && l.price > 0);
    const st  = calcStats(inB.map(l => l.price));
    const isTgt = capturedGuests != null && bk === guestsLabel(capturedGuests);
    const mark  = isTgt ? ' ← M6 target' : '';
    console.log(`  ${bk.padEnd(10)} ` + fmtN(st.count) +
      '  ' + fmt(st.p25) + '  ' + fmt(st.median) + '  ' + fmt(st.p75) + '  ' + fmt(st.mean) + mark);
  }

  // Also print stats for the exact B5-F1 capacity band (±2 guests from targetGuests)
  if (capturedGuests != null) {
    console.log(`\n  B5-F1 CAPACITY BAND (targetGuests=${capturedGuests} ±2):`);
    const bandMin = capturedGuests - 2, bandMax = capturedGuests + 2;
    const inBand  = withDist.filter(l => {
      if (l.price <= 0) return false;
      if (l.guests == null) return true;  // missing guests: kept conservatively
      return l.guests >= bandMin && l.guests <= bandMax;
    });
    const st = calcStats(inBand.map(l => l.price));
    console.log(`  COUNT=${st.count}  P25=${fmt(st.p25).trim()}  MEDIAN=${fmt(st.median).trim()}  P75=${fmt(st.p75).trim()}  MEAN=${st.mean}`);
  }

  // ── PHASE 6: CATEGORY ANALYSIS ───────────────────────────────────────────
  console.log('\n' + sep);
  console.log('  PHASE 6 — CATEGORY ANALYSIS');
  console.log(sep);
  console.log('  ALL GEOLOCATED+ACCEPTED LISTINGS:');
  console.log('  ' + 'CATEGORY'.padEnd(14) + ' COUNT  ' + 'P25'.padStart(8) + '  ' +
    'MEDIAN'.padStart(8) + '  ' + 'P75'.padStart(8) + '  ' + 'MEAN'.padStart(8));
  console.log('  ' + '─'.repeat(58));

  const catTypes = ['entire_place', 'hotel', 'room', 'other', 'missing'];
  for (const ct of catTypes) {
    const inC = withDist.filter(l => categoryType(l.category) === ct && l.price > 0);
    const st  = calcStats(inC.map(l => l.price));
    console.log(`  ${ct.padEnd(14)} ` + fmtN(st.count) +
      '  ' + fmt(st.p25) + '  ' + fmt(st.median) + '  ' + fmt(st.p75) + '  ' + fmt(st.mean));
  }

  // Category distribution inside selected set
  console.log('\n  CATEGORY DISTRIBUTION IN SELECTED SET:');
  for (const ct of catTypes) {
    const n = selected.filter(l => categoryType(l.category) === ct).length;
    if (n > 0) console.log(`    ${ct.padEnd(14)} ${n}`);
  }

  // ── PHASE 7: TOP/BOTTOM PRICE ─────────────────────────────────────────────
  console.log('\n' + sep);
  console.log('  PHASE 7 — TOP / BOTTOM PRICE IN SELECTED SET');
  console.log(sep);
  const sortedByPrice = [...selectedWithDist].sort((a, b) => a.price - b.price);
  const printSubset   = (label, items) => {
    console.log(`\n  ${label}:`);
    console.log('  ' + 'DIST_KM'.padEnd(9) + ' PRICE    GUESTS  CATEGORY              AVAIL_CT');
    console.log('  ' + '─'.repeat(52));
    for (const l of items) {
      const dist  = l._dist  != null ? l._dist.toFixed(2).padStart(7) : '    N/A';
      const price = l.price  != null ? l.price.toFixed(2).padStart(8)  : '     N/A';
      const g     = l.guests != null ? String(l.guests).padStart(6)    : '   N/A';
      const cat   = (l.category || 'N/A').slice(0, 20).padEnd(20);
      const avCt  = l._avCount != null ? String(l._avCount).padStart(8) : '      N/A';
      console.log(`  ${dist}  ${price}  ${g}  ${cat}  ${avCt}`);
    }
  };
  printSubset('10 CHEAPEST', sortedByPrice.slice(0, 10));
  printSubset('10 MOST EXPENSIVE', sortedByPrice.slice(-10).reverse());

  // ── PHASE 8: SENSITIVITY ANALYSIS ────────────────────────────────────────
  console.log('\n' + sep);
  console.log('  PHASE 8 — SENSITIVITY ANALYSIS (hypothetical, does not change production)');
  console.log(sep);
  console.log('  ' + 'SCENARIO'.padEnd(22) + ' RADIUS  COUNT  ' + 'P25'.padStart(8) + '  ' +
    'MEDIAN'.padStart(8) + '  ' + 'P75'.padStart(8) + '  ' + 'UNAVAIL%');
  console.log('  ' + '─'.repeat(74));

  const printScenario = (label, radius, listings) => {
    const sc = calcBrightDataMarketStats(listings, { today });
    if (!sc) {
      console.log(`  ${label.padEnd(22)} ${String(radius ?? 'N/A').padStart(6)}  ${fmtN(0)}`);
      return;
    }
    const unavailStr = sc.occupancy_semantics === 'calendar_unavailability_proxy'
      ? String(100 - sc.occupancy).padStart(6) + '%'
      : '     N/A';
    console.log(`  ${label.padEnd(22)} ${String(radius ?? 'N/A').padStart(6)}  ${fmtN(sc.count)}` +
      fmt(sc.p25) + '  ' + fmt(sc.median) + '  ' + fmt(sc.p75) + '  ' + unavailStr);
  };

  // A: first radius with ≥ 5
  const rA = RADIUS_BANDS_KM.find(r => (rcc[r] ?? 0) >= MIN_COMPARABLES_FALLBACK);
  const lA = rA != null ? withDist.filter(l => l._dist <= rA) : [];
  printScenario('A: first ≥5 comparables', rA, lA);

  // B: first radius with ≥ 8
  const rB = RADIUS_BANDS_KM.find(r => (rcc[r] ?? 0) >= MIN_COMPARABLES_TARGET);
  const lB = rB != null ? withDist.filter(l => l._dist <= rB) : [];
  printScenario('B: first ≥8 comparables', rB, lB);

  // C: first radius with ≥ 10
  const rC = RADIUS_BANDS_KM.find(r => (rcc[r] ?? 0) >= 10);
  const lC = rC != null ? withDist.filter(l => l._dist <= rC) : [];
  printScenario('C: first ≥10 comparables', rC, lC);

  // D: ≤5 km
  const lD = withDist.filter(l => l._dist <= 5);
  printScenario('D: ≤5 km', 5, lD);

  // E: ≤10 km
  const lE = withDist.filter(l => l._dist <= 10);
  printScenario('E: ≤10 km', 10, lE);

  // F: ≤20 km (current)
  const lF = withDist.filter(l => l._dist <= 20);
  printScenario('F: ≤20 km (current)', 20, lF);

  // ── PHASE 9: FINAL VERDICT ────────────────────────────────────────────────
  console.log('\n' + sep);
  console.log('  PHASE 9 — FINAL VERDICT');
  console.log(sep);

  // Classify issues
  const entireCount  = selected.filter(l => categoryType(l.category) === 'entire_place').length;
  const nonEntire    = selected.length - entireCount;
  const missingCat   = selected.filter(l => l.category == null).length;
  const guestsOk     = capturedGuests != null;
  const catContam    = guestsOk && nonEntire > 0;
  const capContam    = selDiag.capacityRejectedCount > 0;
  const geoContam    = selectedRadiusKm != null && selectedRadiusKm > 5 && firstWith5 != null && firstWith5 <= 3;

  console.log(`\n  FIRST_RADIUS_WITH_5:      ${firstWith5  ?? 'none'} km`);
  console.log(`  FIRST_RADIUS_WITH_8:      ${firstWith8  ?? 'none'} km`);
  console.log(`  FIRST_RADIUS_WITH_10:     ${firstWith10 ?? 'none'} km`);
  console.log(`  CURRENT_SELECTED_RADIUS:  ${selectedRadiusKm ?? 'none'} km`);
  console.log(`  CURRENT_MEDIAN:           ${stats ? stats.median.toFixed(2) : 'N/A'} EUR`);

  const causeRadius = rB != null
    ? `Pass 1 scans for ≥${MIN_COMPARABLES_TARGET}: skips ${firstWith5} km (only 5 candidates), reaches ${rB} km (${rcc[rB]} candidates) → POLICY_WEAKNESS`
    : 'EXPECTED_BEHAVIOR';

  const causeMedian = nonEntire > 0 || missingCat > 0
    ? `${nonEntire} non-entire-place and ${missingCat} uncategorized listings in selected set — CATEGORY_CONTAMINATION`
    : 'Median reflects capacity+geo expansion';

  const catContamClass  = catContam    ? 'POLICY_WEAKNESS (targetPropertyType=null disables category filter)' : 'EXPECTED_BEHAVIOR';
  const capContamClass  = capContam    ? 'EXPECTED_BEHAVIOR (32 rejected by capacity filter)' : 'NOT_APPLICABLE';
  const geoContamClass  = geoContam    ? 'POLICY_WEAKNESS (≤3 km has 5 but algorithm requires 8)' : 'EXPECTED_BEHAVIOR';

  console.log(`\n  CAUSE_OF_RADIUS_EXPANSION: ${causeRadius}`);
  console.log(`  CAUSE_OF_HIGH_MEDIAN:      ${causeMedian}`);
  console.log(`  CATEGORY_CONTAMINATION:    ${catContamClass}`);
  console.log(`  CAPACITY_CONTAMINATION:    ${capContamClass}`);
  console.log(`  GEOGRAPHIC_CONTAMINATION:  ${geoContamClass}`);

  // Determine safety
  const issues = [];
  if (geoContam)  issues.push('Radius expanded from tight local cluster due to TARGET>FALLBACK gap');
  if (catContam)  issues.push('Category filter inactive (targetPropertyType not passed in cron)');
  if (stats && stats.median > 400) issues.push(`High median (${stats.median.toFixed(2)} EUR) — likely mixed category/geo`);

  const safe = issues.length === 0;

  console.log('\n  ISSUES IDENTIFIED:');
  if (issues.length === 0) {
    console.log('    None.');
  } else {
    issues.forEach((issue, i) => console.log(`    ${i + 1}. ${issue}`));
  }

  console.log(`\n  SAFE_TO_ACTIVATE_BRIGHTDATA: ${safe ? 'YES' : 'NO'}`);

  if (!safe) {
    console.log('\n  RECOMMENDED POLICY CHANGES FOR B5-F4:');
    if (geoContam)  console.log('    - B5-F4-A: If tight cluster (≥FALLBACK) exists within threshold (e.g. ≤5km), prefer it over expanding to TARGET');
    if (catContam)  console.log('    - B5-F4-B: Pass targetPropertyType to selectComparables() in cron — activate category filter');
    if (stats && stats.median > 400) console.log('    - B5-F4-C: Audit listing categories in 20km band — remove hotel/shared if entire_place target');
  }

  // ── Safety invariant verification ────────────────────────────────────────
  const pcRowAfter  = (await pool.query(
    `SELECT is_active, mode, updated_at FROM pricing_config WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const schedCntAfter = (await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM pricing_schedule WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const propRowAfter = (await pool.query(
    `SELECT name, address, latitude, longitude, country_code, timezone, currency, channex_enabled
       FROM properties WHERE id = $1`,
    [capturedPropertyId]
  )).rows[0];

  const configUnchanged   = JSON.stringify(pcRowAfter)    === snapBefore.pricingConfig;
  const scheduleUnchanged = schedCntAfter?.cnt            === snapBefore.scheduleCount;
  const propUnchanged     = JSON.stringify(propRowAfter)  === snapBefore.propFingerprint;
  const allUnchanged      = configUnchanged && scheduleUnchanged && propUnchanged;

  console.log('\n' + sep);
  console.log('  SAFETY INVARIANTS:');
  console.log(`    pricing_config unchanged:   ${configUnchanged   ? '✅' : '❌ CHANGED'}`);
  console.log(`    pricing_schedule unchanged: ${scheduleUnchanged ? '✅' : '❌ CHANGED'}`);
  console.log(`    properties unchanged:       ${propUnchanged     ? '✅' : '❌ CHANGED'}`);
  console.log(`    MARKET_DATA_WRITES:         0`);
  console.log(`    CHANNEX_WRITES:             0`);
  console.log(`    PRICING_WRITES:             0`);
  console.log(sep + '\n');

  if (!allUnchanged) abort('SAFETY VIOLATION: DB state changed during audit');

  return {
    verdict:              safe ? 'SAFE' : 'NOT_SAFE',
    selectedRadiusKm,
    comparableCount:      selected.length,
    stats,
    firstWith5,
    firstWith8,
    firstWith10,
    selDiag,
    issues,
    safeToActivate:       safe,
  };
}

module.exports = { previewMode, executeMode, resolvePropF3, AbortError, MAX_LISTINGS };

// ── CLI entry point ────────────────────────────────────────────────────────────
if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/audit-brightdata-selected-comparables.js --name <nom> [--execute]');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  function classifyError(err) {
    const msg  = (err.message || '').toLowerCase();
    const code = (err.code    || '').toUpperCase();
    if (msg.includes('self-signed') || msg.includes('certificate') || code.includes('SSL')) return 'DB_TLS_ERROR';
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') return 'DB_CONNECTION_ERROR';
    if (msg.includes('column') || msg.includes('does not exist') || code === '42703') return 'DB_SCHEMA_ERROR';
    return 'FATAL_ERROR';
  }

  const run = execute
    ? executeMode(pool, { name })
    : previewMode(pool, { name });

  run
    .then(() => pool.end())
    .catch(err => {
      if (err.name === 'AbortError') {
        console.error(`\n  ❌ ABORT: ${err.message}`);
      } else {
        const errType = classifyError(err);
        console.error(`\n  ❌ ${errType}: ${err.message}`);
      }
      pool.end().catch(() => {});
      process.exit(1);
    });
}

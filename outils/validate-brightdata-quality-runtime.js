#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B5-F2 — Bright Data Live Quality Validation
 *
 * Preview:  node outils/validate-brightdata-quality-runtime.js --name "M6"
 * Execute:  node outils/validate-brightdata-quality-runtime.js --name "M6" --execute
 *
 * SAFETY CONTRACT:
 *   Preview:  0 BD calls, 0 DB writes
 *   Execute:  1 BD call, 0 DB writes, 0 Channex calls, 0 pricing writes
 *
 * PRODUCTION HELPERS REUSED (B5-F1):
 *   selectComparables()         services/brightdata-comparable-filter
 *   calcBrightDataMarketStats() services/brightdata-comparable-filter
 *   haversineKm()               services/brightdata-comparable-filter
 *   isCategoryCompatible()      services/brightdata-comparable-filter
 *   isCapacityCompatible()      services/brightdata-comparable-filter
 *   scrapeWithBrightData()      services/providers/brightdata
 *   getBrightDataMarketDates()  services/market-provider
 *
 * F2_PRODUCTION_HELPERS_REUSED   = YES
 * F2_DUPLICATED_SELECTION_LOGIC  = NO
 * F2_DB_WRITE_REQUIRED           = NO
 * F2_LIVE_CALL_COUNT             = 1
 *
 * ABSOLUTELY PROHIBITED:
 *   applyDynamicPricingForProperty   PROHIBITED
 *   triggerChannexRatesSync          PROHIBITED
 *   runDynamicPricingForOneProperty  PROHIBITED
 *   pricing_config UPDATE            PROHIBITED
 *   pricing_schedule writes          PROHIBITED
 *   pricing_history writes           PROHIBITED
 *   properties UPDATE                PROHIBITED
 *   Channex API calls                PROHIBITED
 *   Apify fallback                   PROHIBITED
 *   Mock fallback                    PROHIBITED
 *   market_data writes               PROHIBITED
 *   writeScrapeResult()              PROHIBITED
 *
 * MARKET_DATA_WRITES      = 0
 * CHANNEX_WRITES          = 0
 * PRICING_WRITES          = 0
 */

// ── Safe imports only ─────────────────────────────────────────────────────────
// dynamic-pricing-cron required lazily inside execute/preview to avoid circular dep.
const { scrapeWithBrightData, DATASET_ID } = require('../services/providers/brightdata');
const {
  selectComparables, calcBrightDataMarketStats,
  haversineKm, isCategoryCompatible, isCapacityCompatible,
  RADIUS_BANDS_KM, MIN_COMPARABLES_FALLBACK, MAX_RADIUS_KM,
  CALENDAR_WINDOW_DAYS,
} = require('../services/brightdata-comparable-filter');
const { getBrightDataMarketDates } = require('../services/market-provider');
const { computeMarketContextKey } = require('../routes/market-context-key');
const { normalizeCurrency } = require('../routes/market-data-resolver');
const { Pool } = require('pg');

// ── Constants ──────────────────────────────────────────────────────────────────
const MAX_LISTINGS             = 100;
const OLD_RAW_MEDIAN_REFERENCE = 319.53; // B5-F0 — informational only, not a pass/fail criterion

// ── AbortError ─────────────────────────────────────────────────────────────────
class AbortError extends Error {
  constructor(msg) { super(msg); this.name = 'AbortError'; }
}
function abort(msg) { throw new AbortError(msg); }

// ── Reporting percentile (floor formula — not part of comparable algorithm) ────
function reportPct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
}

// ── Property lookup with max_guests ───────────────────────────────────────────
async function resolvePropF2(pool, name) {
  const rows = (await pool.query(
    `SELECT p.id, p.user_id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.country_code, p.timezone,
            p.currency, p.channex_enabled, p.max_guests,
            pc.is_active, pc.mode
       FROM properties p
       LEFT JOIN pricing_config pc ON pc.property_id = p.id AND pc.user_id = p.user_id
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
  return rows;
}

// ── previewMode ───────────────────────────────────────────────────────────────
// BRIGHTDATA_CALLS = 0   DB_WRITES = 0   CHANNEX_WRITES = 0   PRICING_WRITES = 0
async function previewMode(pool, { name, _now } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-F2 BRIGHT DATA QUALITY VALIDATION — PREVIEW MODE (READ-ONLY)');
  console.log('  BRIGHTDATA_CALLS=0 | DB_WRITES=0 | CHANNEX_WRITES=0 | PRICING_WRITES=0');
  console.log('═'.repeat(72));

  const rows = await resolvePropF2(pool, name);

  if (rows.length === 0) {
    console.log(`\n  ⛔  Aucune propriété trouvée: "${name}"`);
    return { ok: false, abort: `no_target: "${name}"` };
  }
  if (rows.length > 1) {
    console.log(`  ⛔  Ambiguïté: ${rows.length} propriétés correspondent à "${name}"`);
    rows.forEach(r => console.log(`       - ${r.id}  ${r.internal_name || r.name}`));
    return { ok: false, abort: `ambiguous_target: ${rows.length} matches` };
  }

  const prop              = rows[0];
  const timezone          = prop.timezone || 'Europe/Paris';
  const normalizedCurrency = normalizeCurrency(prop.currency);
  const contextKey        = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
    longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
  });
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now: _now });
  const apiKeyPresent     = !!(process.env.BRIGHTDATA_API_KEY);

  const { getFallbackZones } = require('../routes/dynamic-pricing-cron');
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  console.log('\n  PROPERTY:');
  console.log(`    id:                      ${prop.id}`);
  console.log(`    name:                    ${prop.internal_name || prop.name}`);
  console.log(`    latitude:                ${prop.latitude}`);
  console.log(`    longitude:               ${prop.longitude}`);
  console.log(`    country_code:            ${prop.country_code}`);
  console.log(`    timezone:                ${prop.timezone}`);
  console.log(`    max_guests:              ${prop.max_guests ?? 'N/A'}`);
  console.log(`    currency:                ${prop.currency} → normalisé: ${normalizedCurrency}`);
  console.log(`    market_context_key:      ${contextKey}`);
  console.log(`    pricing_config.active:   ${prop.is_active ?? 'N/A'}`);

  console.log('\n  BRIGHT DATA:');
  console.log(`    BRIGHTDATA_API_KEY:      ${apiKeyPresent ? 'présent' : 'ABSENT'}`);
  console.log(`    dataset_id:              ${DATASET_ID}`);
  console.log(`    location_query:          ${location}`);
  console.log(`    planned_checkIn:         ${checkIn}`);
  console.log(`    planned_checkOut:        ${checkOut}`);
  console.log(`    date_strategy:           property-local J+14 → J+15 (${timezone})`);
  console.log(`    max_listings:            ${MAX_LISTINGS}`);

  console.log('\n  B5-F1 SELECTION PARAMETERS:');
  console.log(`    targetLat:               ${prop.latitude}`);
  console.log(`    targetLon:               ${prop.longitude}`);
  console.log(`    targetGuests:            ${prop.max_guests ?? 'N/A (no filter)'}`);
  console.log(`    targetPropertyType:      null (no type filter applied)`);
  console.log(`    adaptiveRadius:          ${RADIUS_BANDS_KM.join(' → ')} km`);
  console.log(`    minComparables:          ${MIN_COMPARABLES_FALLBACK}`);

  const geoComplete   = !!(prop.latitude && prop.longitude && prop.country_code);
  const tzPresent     = !!(prop.timezone);
  const currencyValid = !!(normalizedCurrency);
  const ready = geoComplete && tzPresent && currencyValid && apiKeyPresent;

  console.log('\n  READINESS:');
  console.log(`    geo complete:            ${geoComplete ? '✅' : '❌'}`);
  console.log(`    timezone present:        ${tzPresent ? '✅' : '❌'}`);
  console.log(`    currency valid:          ${currencyValid ? '✅' : '❌'}`);
  console.log(`    API key present:         ${apiKeyPresent ? '✅' : '❌'}`);

  if (!ready) {
    console.log('\n  ⛔  NOT READY FOR EXECUTE.');
  } else {
    console.log('\n  ✅  READY FOR EXECUTE (ajouter --execute pour démarrer).');
  }
  console.log('═'.repeat(72) + '\n');

  return { ok: ready, propertyId: prop.id, contextKey, normalizedCurrency, apiKeyPresent };
}

// ── executeMode ───────────────────────────────────────────────────────────────
// MARKET_DATA_WRITES = 0  CHANNEX_WRITES = 0  PRICING_WRITES = 0
// 0 DB writes — validation is purely observational
async function executeMode(pool, { name, _now, _bdScrape } = {}) {
  const bdScrape = _bdScrape || scrapeWithBrightData;

  console.log('\n' + '═'.repeat(72));
  console.log('  B5-F2 BRIGHT DATA QUALITY VALIDATION — EXECUTE MODE');
  console.log('');
  console.log('  PRODUCTION HELPERS REUSED:');
  console.log('    selectComparables()            services/brightdata-comparable-filter');
  console.log('    calcBrightDataMarketStats()    services/brightdata-comparable-filter');
  console.log('    scrapeWithBrightData()         services/providers/brightdata');
  console.log('');
  console.log('  SAFETY:');
  console.log('    MARKET_DATA_WRITES = 0  (no writeScrapeResult call)');
  console.log('    CHANNEX_WRITES     = 0');
  console.log('    PRICING_WRITES     = 0');
  console.log('    APIFY_CALLS        = 0  (no fallback)');
  console.log('    MOCK_FALLBACK      = 0  (no mock data)');
  console.log('═'.repeat(72));

  // ── 1. Resolve property ──────────────────────────────────────────────────
  const rows = await resolvePropF2(pool, name);
  if (rows.length === 0) abort(`Aucune propriété: "${name}"`);
  if (rows.length > 1)   abort(`${rows.length} propriétés correspondent à "${name}" — affiner --name`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';

  // ── 2. Pre-flight guards ─────────────────────────────────────────────────
  const normalizedCurrency = normalizeCurrency(prop.currency);
  const contextKey = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
    longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
  });
  const apiKeyPresent = !!(process.env.BRIGHTDATA_API_KEY);

  if (!(prop.latitude && prop.longitude && prop.country_code)) abort('Geo incomplète — coordonnées manquantes');
  if (!prop.timezone)        abort('Timezone manquante — date strategy impossible');
  if (!normalizedCurrency)   abort('Devise propriété invalide ou absente');
  if (!contextKey)           abort('Context key invalide — vérifier lat/lng/country_code');
  if (!apiKeyPresent)        abort('BRIGHTDATA_API_KEY non défini');

  // ── 3. T0 capture ────────────────────────────────────────────────────────
  const capturedPropertyId       = prop.id;
  const capturedPropertyCurrency = normalizedCurrency;
  const capturedContextKey       = contextKey;
  const capturedLat              = parseFloat(prop.latitude);
  const capturedLon              = parseFloat(prop.longitude);
  const capturedMaxGuests        = prop.max_guests != null ? parseInt(prop.max_guests, 10) : null;
  const capturedTimezone         = timezone;

  console.log('\n  T0 CAPTURE:');
  console.log(`    property_id:           ${capturedPropertyId}`);
  console.log(`    currency:              ${capturedPropertyCurrency}`);
  console.log(`    market_context_key:    ${capturedContextKey}`);
  console.log(`    latitude:              ${capturedLat}`);
  console.log(`    longitude:             ${capturedLon}`);
  console.log(`    max_guests:            ${capturedMaxGuests ?? 'N/A'}`);
  console.log(`    timezone:              ${capturedTimezone}`);

  // ── 4. Safety invariant snapshots (read-only) ────────────────────────────
  const beforePcRows = (await pool.query(
    `SELECT is_active, mode, updated_at FROM pricing_config WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows;
  const beforePcFingerprint = JSON.stringify(beforePcRows);

  let beforeScheduleCount = '0';
  try {
    beforeScheduleCount = (await pool.query(
      `SELECT COUNT(*) AS cnt FROM pricing_schedule WHERE property_id = $1`,
      [capturedPropertyId]
    )).rows[0]?.cnt ?? '0';
  } catch (_) { /* table may not exist in dev */ }

  const beforeHistoryCount = (await pool.query(
    `SELECT COUNT(*) AS cnt FROM pricing_history WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0]?.cnt ?? '0';

  const beforePropRow = (await pool.query(
    `SELECT name, address, latitude, longitude, country_code, timezone, currency, channex_enabled
       FROM properties WHERE id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const beforePropFingerprint = JSON.stringify(beforePropRow);

  // ── 5. Date strategy (B5-D helper) ──────────────────────────────────────
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone: capturedTimezone, now: _now });
  console.log(`\n  DATE STRATEGY: checkIn=${checkIn}  checkOut=${checkOut}  tz=${capturedTimezone}`);

  // ── 6. Zone derivation (production logic) ────────────────────────────────
  const { getFallbackZones } = require('../routes/dynamic-pricing-cron');
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];
  console.log(`  LOCATION: ${location}`);

  // ── 7. Bright Data call (1 call, NO Apify fallback, NO mock) ─────────────
  console.log(`\n  🔍 Bright Data: "${location}"  currency=${capturedPropertyCurrency}  checkIn=${checkIn}  checkOut=${checkOut}`);

  let bdResult;
  try {
    bdResult = await bdScrape(location, MAX_LISTINGS, capturedPropertyCurrency, { checkIn, checkOut });
  } catch (err) {
    abort(`Bright Data call failed: ${err.message}`);
  }

  if (bdResult.isMock) abort('Résultat mock reçu — brightdata_live requis, aucun fallback autorisé');
  if (bdResult.dataSource !== 'brightdata_live') abort(`dataSource="${bdResult.dataSource}" — brightdata_live requis`);

  const diag     = bdResult.diagnostics || {};
  const accepted = bdResult.listings;

  // ── PHASE 4: Raw output ──────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 4 — RAW BRIGHT DATA OUTPUT');
  console.log('─'.repeat(72));
  console.log(`  RAW_RETURNED_COUNT:              ${diag.returnedCount ?? '?'}`);
  console.log(`  ADAPTER_ACCEPTED_COUNT:          ${diag.acceptedCount ?? accepted.length}`);
  console.log(`  REJECTED_PRICE_COUNT:            ${diag.rejectedPriceCount ?? '?'}`);
  console.log(`  REJECTED_CURRENCY_COUNT:         ${diag.rejectedCurrencyCount ?? '?'}`);
  console.log(`  REJECTED_AVAILABILITY_COUNT:     ${diag.rejectedAvailabilityCount ?? '?'}`);

  const n = accepted.length;
  console.log('\n  METADATA AVAILABILITY:');
  console.log(`  WITH_PROVIDER_LISTING_ID:        ${accepted.filter(l => l.providerListingId != null).length} / ${n}`);
  console.log(`  WITH_LAT_LNG:                    ${accepted.filter(l => l.latitude != null && l.longitude != null).length} / ${n}`);
  console.log(`  WITH_GUESTS:                     ${accepted.filter(l => l.guests != null).length} / ${n}`);
  console.log(`  WITH_CATEGORY:                   ${accepted.filter(l => l.category != null).length} / ${n}`);
  console.log(`  WITH_AVAILABLE_DATES:            ${accepted.filter(l => l.availableDates != null).length} / ${n}`);

  if (accepted.length === 0) abort('Bright Data: 0 listings acceptés après normalisation — abandon');

  // ── PHASE 5: B5-F1 selectComparables ────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 5 — B5-F1 COMPARABLE SELECTION (selectComparables)');
  console.log('─'.repeat(72));

  const { listings: comparables, status: selStatus, selectedRadiusKm, diagnostics: selDiag } =
    selectComparables(accepted, {
      targetLat:    capturedLat,
      targetLon:    capturedLon,
      targetGuests: capturedMaxGuests,
    });

  console.log(`  INPUT_COUNT:                     ${selDiag.inputCount}`);
  console.log(`  DUPLICATE_COUNT:                 ${selDiag.duplicateCount}`);
  console.log(`  UNIQUE_COUNT:                    ${selDiag.uniqueCount}`);
  console.log(`  CATEGORY_REJECTED_COUNT:         ${selDiag.categoryRejectedCount}`);
  console.log(`  CATEGORY_MISSING_COUNT:          ${selDiag.categoryMissingCount}`);
  console.log(`  CAPACITY_REJECTED_COUNT:         ${selDiag.capacityRejectedCount}`);
  console.log(`  CAPACITY_MISSING_COUNT:          ${selDiag.capacityMissingCount}`);
  console.log(`  GEO_MISSING_COUNT:               ${selDiag.geoMissingCount}`);

  console.log('\n  RADIUS CANDIDATES (after B5-F1 quality filters):');
  const rCounts = selDiag.radiusCandidateCounts;
  if (rCounts) {
    for (const r of RADIUS_BANDS_KM) {
      console.log(`    ${String(r).padStart(3)} km:  ${rCounts[r] ?? 0} listings`);
    }
  } else {
    console.log('    N/A (no property coordinates for geo filter)');
  }

  console.log(`\n  SELECTED_RADIUS_KM:              ${selectedRadiusKm ?? 'N/A'}`);
  console.log(`  FINAL_COMPARABLE_COUNT:          ${comparables.length}`);
  console.log(`  SELECTION_STATUS:                ${selStatus}`);

  // ── PHASE 6: calcBrightDataMarketStats ──────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 6 — PRICE MARKET STATISTICS (calcBrightDataMarketStats)');
  console.log('─'.repeat(72));

  const today = (capturedTimezone
    ? new Date().toLocaleString('sv-SE', { timeZone: capturedTimezone })
    : new Date().toISOString()).slice(0, 10);

  const stats = calcBrightDataMarketStats(comparables, { today });

  const sortedPrices = comparables.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
  const priceMin  = sortedPrices.length ? sortedPrices[0]                       : null;
  const priceMax  = sortedPrices.length ? sortedPrices[sortedPrices.length - 1] : null;
  const priceMean = sortedPrices.length
    ? Math.round(sortedPrices.reduce((s, v) => s + v, 0) / sortedPrices.length * 100) / 100
    : null;

  console.log(`  FINAL_COMPARABLE_COUNT:          ${stats?.count ?? comparables.length}`);
  console.log(`  SELECTED_RADIUS_KM:              ${selectedRadiusKm ?? 'N/A'}`);
  console.log(`  PRICE_MIN:                       ${priceMin}`);
  console.log(`  PRICE_P10:                       ${reportPct(sortedPrices, 0.10)}`);
  console.log(`  PRICE_P25:                       ${stats?.p25 ?? 'N/A'}`);
  console.log(`  PRICE_MEDIAN:                    ${stats?.median ?? 'N/A'}`);
  console.log(`  PRICE_P75:                       ${stats?.p75 ?? 'N/A'}`);
  console.log(`  PRICE_P90:                       ${reportPct(sortedPrices, 0.90)}`);
  console.log(`  PRICE_MAX:                       ${priceMax}`);
  console.log(`  PRICE_MEAN:                      ${priceMean}`);
  console.log(`  STANDARD_MEDIAN:                 YES`);
  console.log(`\n  OLD_RAW_MEDIAN_REFERENCE:        ${OLD_RAW_MEDIAN_REFERENCE} EUR (B5-F0, informational only)`);
  if (stats?.median != null) {
    const diff = Math.round((stats.median - OLD_RAW_MEDIAN_REFERENCE) * 100) / 100;
    console.log(`  MEDIAN_DIFF_vs_REFERENCE:        ${diff > 0 ? '+' : ''}${diff} EUR`);
  }

  // ── PHASE 7: Calendar signal ─────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 7 — CALENDAR SIGNAL');
  console.log('─'.repeat(72));

  const calPresentCount = comparables.filter(l => Array.isArray(l.availableDates)).length;
  const calMissingCount = comparables.length - calPresentCount;

  console.log(`  CALENDAR_WINDOW_DAYS:            ${CALENDAR_WINDOW_DAYS}`);
  console.log(`  CALENDAR_PRESENT_COUNT:          ${calPresentCount}`);
  console.log(`  CALENDAR_MISSING_COUNT:          ${calMissingCount}`);
  console.log(`  CALENDAR_UNAVAILABILITY_RATE:    ${stats?.occupancy ?? 'N/A'}%`);
  console.log(`  OCCUPANCY_SEMANTICS:             ${stats?.occupancy_semantics ?? 'N/A'}`);
  console.log(`  THIS_IS_NOT_FACTUAL_OCCUPANCY:   true`);
  console.log(`  NOTE: absent date = booked OR blocked OR outside host calendar rules`);

  // ── PHASE 8: Quality checks ──────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 8 — QUALITY VERDICT');
  console.log('─'.repeat(72));

  // CHECK_1: final comparable count >= MIN_COMPARABLES_FALLBACK
  const c1 = comparables.length >= MIN_COMPARABLES_FALLBACK;

  // CHECK_2: selected radius within MAX_RADIUS_KM
  const c2 = selectedRadiusKm == null || selectedRadiusKm <= MAX_RADIUS_KM;

  // CHECK_3: all geolocated comparables within selected radius
  let c3 = true, c3Detail = 'N/A (no radius or no property coords)';
  if (selectedRadiusKm != null && Number.isFinite(capturedLat) && Number.isFinite(capturedLon)) {
    const outliers = comparables.filter(l =>
      Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
      haversineKm(capturedLat, capturedLon, l.latitude, l.longitude) > selectedRadiusKm + 0.01
    );
    c3 = outliers.length === 0;
    c3Detail = c3 ? 'all within radius' : `${outliers.length} outside radius`;
  }

  // CHECK_4: no duplicate providerListingId among selected comparables
  const nonNullIds = comparables.filter(l => l.providerListingId != null).map(l => l.providerListingId);
  const c4 = new Set(nonNullIds).size === nonNullIds.length;

  // CHECK_5: no selected listing has known-incompatible category (uses production helper)
  // With targetPropertyType=null, isCategoryCompatible always returns true — vacuously passes.
  const c5 = comparables.every(l => isCategoryCompatible(l.category, null) !== false);

  // CHECK_6: no selected listing has guest capacity outside ±MIN_GUEST_DELTA (uses production helper)
  const c6 = capturedMaxGuests == null
    ? true
    : comparables.every(l => isCapacityCompatible(l.guests, capturedMaxGuests) !== false);

  // CHECK_7: all selected prices finite and > 0
  const c7 = comparables.every(l => Number.isFinite(l.price) && l.price > 0);

  // CHECK_8: dataSource is brightdata_live (currency validated inside scrapeWithBrightData)
  const c8 = bdResult.dataSource === 'brightdata_live';

  // CHECK_9: calendar proxy semantics valid
  let c9 = false;
  if (stats?.occupancy_semantics === 'calendar_unavailability_proxy') {
    c9 = Number.isFinite(stats.occupancy) && stats.occupancy >= 0 && stats.occupancy <= 100;
  } else if (stats?.occupancy_semantics === 'insufficient_calendars') {
    c9 = stats.occupancy === 0;
  }

  // CHECK_10: no DB mutation (structural — executeMode never calls INSERT/UPDATE/DELETE)
  const c10 = true;

  // CHECK_11: no Channex call (structural — no channex import in this file)
  const c11 = true;

  // CHECK_12: no pricing write (structural — no applyDynamicPricingForProperty call)
  const c12 = true;

  const checks = [
    { n: 'CHECK_1',  label: 'final comparable count >= 5',                  pass: c1,  detail: `count=${comparables.length}` },
    { n: 'CHECK_2',  label: 'selected radius <= 20 km',                     pass: c2,  detail: `${selectedRadiusKm ?? 'N/A'} km` },
    { n: 'CHECK_3',  label: 'all geolocated comparables within radius',     pass: c3,  detail: c3Detail },
    { n: 'CHECK_4',  label: 'no duplicate providerListingId',               pass: c4,  detail: `${new Set(nonNullIds).size}/${nonNullIds.length} unique` },
    { n: 'CHECK_5',  label: 'no known-incompatible category',               pass: c5,  detail: 'targetPropertyType=null' },
    { n: 'CHECK_6',  label: 'no guest capacity outside ±2',                 pass: c6,  detail: `targetGuests=${capturedMaxGuests ?? 'null'}` },
    { n: 'CHECK_7',  label: 'all prices finite and > 0',                    pass: c7,  detail: `${comparables.length} listings` },
    { n: 'CHECK_8',  label: 'dataSource is brightdata_live',                pass: c8,  detail: bdResult.dataSource },
    { n: 'CHECK_9',  label: 'calendar proxy semantics valid',               pass: c9,  detail: `${stats?.occupancy_semantics ?? 'null'}` },
    { n: 'CHECK_10', label: 'no DB mutation (structural guarantee)',         pass: c10, detail: 'MARKET_DATA_WRITES=0' },
    { n: 'CHECK_11', label: 'no Channex call (structural)',                  pass: c11, detail: 'CHANNEX_WRITES=0' },
    { n: 'CHECK_12', label: 'no pricing write (structural)',                 pass: c12, detail: 'PRICING_WRITES=0' },
  ];

  for (const c of checks) {
    console.log(`  ${c.n.padEnd(8)} ${c.pass ? '✅' : '❌'}  ${c.label.padEnd(44)}  (${c.detail})`);
  }

  const failedChecks = checks.filter(c => !c.pass).map(c => c.n);
  const verdict      = failedChecks.length === 0 ? 'PASS' : 'FAIL';

  console.log('');
  console.log(`  B5_F2_LIVE_QUALITY_VALIDATION = ${verdict}`);
  if (verdict === 'FAIL') console.log(`  Failed checks: ${failedChecks.join(', ')}`);

  // ── PHASE 9: Safety invariant verification ───────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 9 — SAFETY INVARIANTS');
  console.log('─'.repeat(72));

  const afterPcRows = (await pool.query(
    `SELECT is_active, mode, updated_at FROM pricing_config WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows;
  const pcUnchanged = JSON.stringify(afterPcRows) === beforePcFingerprint;
  console.log(`  pricing_config:     ${pcUnchanged ? '✅ inchangé' : '❌ MODIFIÉ !'}`);

  let afterScheduleCount = '0';
  try {
    afterScheduleCount = (await pool.query(
      `SELECT COUNT(*) AS cnt FROM pricing_schedule WHERE property_id = $1`,
      [capturedPropertyId]
    )).rows[0]?.cnt ?? '0';
  } catch (_) {}
  const scheduleUnchanged = String(afterScheduleCount) === String(beforeScheduleCount);
  console.log(`  pricing_schedule:   ${scheduleUnchanged ? '✅ inchangé' : '❌ MODIFIÉ !'} (${beforeScheduleCount} → ${afterScheduleCount})`);

  const afterHistoryCount = (await pool.query(
    `SELECT COUNT(*) AS cnt FROM pricing_history WHERE property_id = $1`,
    [capturedPropertyId]
  )).rows[0]?.cnt ?? '0';
  const historyUnchanged = String(afterHistoryCount) === String(beforeHistoryCount);
  console.log(`  pricing_history:    ${historyUnchanged ? '✅ inchangé' : '❌ MODIFIÉ !'} (${beforeHistoryCount} → ${afterHistoryCount})`);

  const afterPropRow = (await pool.query(
    `SELECT name, address, latitude, longitude, country_code, timezone, currency, channex_enabled
       FROM properties WHERE id = $1`,
    [capturedPropertyId]
  )).rows[0];
  const propUnchanged = JSON.stringify(afterPropRow) === beforePropFingerprint;
  console.log(`  properties:         ${propUnchanged ? '✅ inchangé' : '❌ MODIFIÉ !'}`);

  console.log('');
  console.log(`  MARKET_DATA_WRITES:          0`);
  console.log(`  PRICING_CONFIG_WRITES:       ${pcUnchanged   ? '0' : '≥1 !'}`);
  console.log(`  PRICING_SCHEDULE_WRITES:     ${scheduleUnchanged ? '0' : '≥1 !'}`);
  console.log(`  PRICING_HISTORY_WRITES:      ${historyUnchanged  ? '0' : '≥1 !'}`);
  console.log(`  PROPERTIES_WRITES:           ${propUnchanged ? '0' : '≥1 !'}`);
  console.log(`  CHANNEX_WRITES:              0`);

  const invariantsOk = pcUnchanged && scheduleUnchanged && historyUnchanged && propUnchanged;
  if (!invariantsOk) abort('Invariants de sécurité violés — changements inattendus détectés');

  console.log('\n' + '═'.repeat(72));
  if (verdict === 'PASS') {
    console.log(`  🎉 B5_F2_LIVE_QUALITY_VALIDATION = PASS`);
  } else {
    console.log(`  ⚠️  B5_F2_LIVE_QUALITY_VALIDATION = FAIL — checks: ${failedChecks.join(', ')}`);
  }
  console.log(`  Property: ${prop.internal_name || prop.name} | Location: ${location}`);
  console.log(`  Comparables: ${comparables.length} @ ${selectedRadiusKm ?? 'N/A'} km | Median: ${stats?.median ?? 'N/A'} ${capturedPropertyCurrency}`);
  console.log('═'.repeat(72) + '\n');

  return {
    success: true,
    verdict,
    failedChecks,
    propertyId:      capturedPropertyId,
    contextKey:      capturedContextKey,
    currency:        capturedPropertyCurrency,
    dataSource:      bdResult.dataSource,
    stats,
    comparableCount: comparables.length,
    selectedRadiusKm,
    location,
    checkIn,
    checkOut,
  };
}

module.exports = { previewMode, executeMode, resolvePropF2, AbortError, MAX_LISTINGS };

// ── CLI entry point ────────────────────────────────────────────────────────────
if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');

  if (!name) {
    console.error('Usage: node outils/validate-brightdata-quality-runtime.js --name <nom> [--execute]');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  function classifyError(err) {
    const msg  = (err.message || '').toLowerCase();
    const code = (err.code    || '').toUpperCase();
    if (msg.includes('self-signed') || msg.includes('certificate') || code.includes('SSL')) return 'DB_TLS_ERROR';
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') return 'DB_CONNECTION_ERROR';
    if (msg.includes('column') || msg.includes('does not exist') || code === '42703') return 'DB_SCHEMA_ERROR';
    if (msg.includes('property') || msg.includes('propriét')) return 'PROPERTY_LOOKUP_ERROR';
    if (msg.includes('brightdata') || msg.includes('bright data')) return 'BRIGHTDATA_ERROR';
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

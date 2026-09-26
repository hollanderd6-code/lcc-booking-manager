'use strict';
/**
 * P1.2-B5-F1/F4 — Bright Data Comparable Market Quality Policy
 *
 * Pure comparable-selection and BD-specific market statistics.
 * Applied BEFORE calcMarketStats() in the pricing cron, only for brightdata_live.
 *
 * Safety:
 *   DB_WRITES      = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS  = 0  — no channex import
 *   PRICING_WRITES = 0  — no pricing-apply import
 *   NETWORK_CALLS  = 0  — pure functions
 *
 * WHY A SEPARATE MODULE:
 *   shared calcMarketStats() uses prices[floor(n/2)] median and !availability occupancy.
 *   Changing it globally would alter existing Apify production semantics.
 *   This module provides Bright Data–specific logic in isolation.
 *
 * OCCUPANCY SEMANTICS:
 *   For brightdata_live, 'occupancy' in the returned stats represents a
 *   calendar_unavailability_rate — the median fraction of the next 60 days
 *   where a listing's available_dates array has no entry.
 *   A missing date may mean booked, blocked, or outside host calendar rules.
 *   This is NOT factual Airbnb occupancy.
 *   The market_data column name (occupancy_rate) is intentionally not renamed
 *   in B5-F1 — the semantics distinction lives in occupancy_semantics field.
 *
 * RADIUS SELECTION POLICY (B5-F4):
 *   Phase A — Local priority: first radius ≤ LOCAL_PRIORITY_RADIUS_KM with ≥ FALLBACK.
 *             Avoids expanding to distant markets merely to reach TARGET count.
 *   Phase B — Wider radii, prefer TARGET: first radius > LOCAL with ≥ TARGET.
 *   Phase C — Wider radii, accept FALLBACK: first radius > LOCAL with ≥ FALLBACK.
 *   Phase D — insufficient_comparables if no radius yields FALLBACK.
 */

const RADIUS_BANDS_KM           = [1, 2, 3, 5, 10, 20];
const MIN_COMPARABLES_TARGET    = 8;   // preferred minimum (wider-radius search)
const MIN_COMPARABLES_FALLBACK  = 5;   // acceptable minimum
const LOCAL_PRIORITY_RADIUS_KM  = 5;   // radii ≤ this km: select at FALLBACK threshold immediately
const MAX_RADIUS_KM             = 20;  // never exceed
const MIN_GUEST_DELTA           = 2;   // abs(listing.guests - target) must be <= this
const CALENDAR_WINDOW_DAYS      = 60;  // 60-day unavailability proxy window
const MIN_CALENDAR_COMPARABLES  = 5;   // proxy requires at least 5 usable calendars

// Tension level thresholds — mirrors dynamic-pricing-routes.js.
// NOT imported to avoid a services → routes circular dependency.
function calcTensionLevelLocal(occupancyRate) {
  if (occupancyRate >= 80) return 'high';
  if (occupancyRate >= 65) return 'elevated';
  if (occupancyRate >= 45) return 'medium';
  if (occupancyRate >= 25) return 'low';
  return 'very_low';
}

// ── Haversine ────────────────────────────────────────────────────────────────

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Category compatibility ────────────────────────────────────────────────────

/**
 * Returns true/false/null.
 *   true  — compatible
 *   false — incompatible (should be rejected)
 *   null  — category missing, keep conservatively
 */
function isCategoryCompatible(category, targetPropertyType) {
  if (!targetPropertyType) return true;
  if (!category) return null;  // unknown → keep conservatively
  const cat = category.toLowerCase();
  if (targetPropertyType === 'entire_place') {
    if (cat.includes('entire')) return true;
    if (cat.includes('room') || cat.includes('hotel') ||
        cat.includes('hostel') || cat.includes('shared')) return false;
    return true;  // unrecognized category → keep conservatively
  }
  return true;
}

// ── Capacity compatibility ────────────────────────────────────────────────────

/**
 * Returns true/false/null.
 *   true  — within ±MIN_GUEST_DELTA
 *   false — outside range (should be rejected)
 *   null  — guests unknown, keep conservatively
 */
function isCapacityCompatible(listingGuests, targetGuests) {
  if (targetGuests == null || listingGuests == null) return null;
  return Math.abs(listingGuests - targetGuests) <= MIN_GUEST_DELTA;
}

// ── Date helper ───────────────────────────────────────────────────────────────

function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Comparable selection ──────────────────────────────────────────────────────

/**
 * Select Bright Data comparable listings for market statistics.
 *
 * Steps:
 *   1. Deduplicate by providerListingId
 *   2. Category filter (configurable per target property type)
 *   3. Capacity filter (abs(guests - targetGuests) <= MIN_GUEST_DELTA)
 *   4. Adaptive geographic radius with local-cluster priority (B5-F4):
 *      Phase A: first radius ≤ LOCAL_PRIORITY_RADIUS_KM (5 km) with ≥ FALLBACK (5)
 *               → select immediately, do not expand to reach TARGET.
 *      Phase B: if no local radius qualifies, scan wider radii (10, 20 km),
 *               prefer first radius with ≥ TARGET (8).
 *      Phase C: if no wider TARGET found, accept first wider radius with ≥ FALLBACK.
 *      Phase D: if none found, status='insufficient_comparables'.
 *   Listings without coordinates are excluded from geographic statistics.
 *
 * @param {Array}  listings
 * @param {object} opts
 * @param {number} opts.targetLat
 * @param {number} opts.targetLon
 * @param {number} [opts.targetGuests]         — from property.max_guests
 * @param {string} [opts.targetPropertyType]   — 'entire_place' | null
 *
 * @returns {{
 *   listings: Array,
 *   status: 'ok'|'insufficient_comparables',
 *   selectedRadiusKm: number|null,
 *   diagnostics: object
 * }}
 */
function selectComparables(listings, {
  targetLat          = null,
  targetLon          = null,
  targetGuests       = null,
  targetPropertyType = null,
} = {}) {
  const diag = {
    inputCount:            listings.length,
    duplicateCount:        0,
    uniqueCount:           0,
    categoryRejectedCount: 0,
    categoryMissingCount:  0,
    capacityRejectedCount: 0,
    capacityMissingCount:  0,
    geoMissingCount:       0,
    comparableCount:       0,
    calendarPresentCount:  0,
    calendarMissingCount:  0,
  };

  // Step 1: Deduplicate by providerListingId (keep first occurrence)
  const seenIds    = new Set();
  const deduplicated = [];
  for (const listing of listings) {
    const id = listing.providerListingId;
    if (id != null) {
      if (seenIds.has(id)) { diag.duplicateCount++; continue; }
      seenIds.add(id);
    }
    deduplicated.push(listing);
  }
  diag.uniqueCount = deduplicated.length;

  // Step 2: Category + capacity filter
  const qualified = [];
  for (const listing of deduplicated) {
    const catResult = isCategoryCompatible(listing.category, targetPropertyType);
    if (catResult === null) {
      diag.categoryMissingCount++;
      // keep: missing category is not a disqualifier
    } else if (catResult === false) {
      diag.categoryRejectedCount++;
      continue;
    }

    const capResult = isCapacityCompatible(listing.guests, targetGuests);
    if (capResult === null) {
      diag.capacityMissingCount++;
      // keep: missing capacity is not a disqualifier
    } else if (capResult === false) {
      diag.capacityRejectedCount++;
      continue;
    }

    qualified.push(listing);
  }

  // Step 3: Adaptive geographic filter
  const hasTargetCoords = Number.isFinite(targetLat) && Number.isFinite(targetLon);

  if (!hasTargetCoords) {
    // Cannot apply geo filter — return all qualified without radius
    diag.comparableCount = qualified.length;
    diag.calendarPresentCount = qualified.filter(l => l.availableDates != null).length;
    diag.calendarMissingCount = qualified.length - diag.calendarPresentCount;
    diag.radiusCandidateCounts = null;
    const status = qualified.length >= MIN_COMPARABLES_FALLBACK ? 'ok' : 'insufficient_comparables';
    return { listings: qualified, status, selectedRadiusKm: null, diagnostics: diag };
  }

  const withGeo    = qualified.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
  const missingGeo = qualified.filter(l => !Number.isFinite(l.latitude) || !Number.isFinite(l.longitude));
  diag.geoMissingCount = missingGeo.length;

  // Attach distances temporarily for sorting/filtering
  const withDist = withGeo.map(l => ({
    _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude),
    listing: l,
  }));

  // Per-radius candidate counts (after dedup + category + capacity filters) — for F2 reporting
  const radiusCandidateCounts = {};
  for (const r of RADIUS_BANDS_KM) {
    radiusCandidateCounts[r] = withDist.filter(d => d._dist <= r).length;
  }
  diag.radiusCandidateCounts = radiusCandidateCounts;

  // Adaptive radius selection — three-phase local-cluster priority (B5-F4)
  let selectedRadius = null;
  let selected       = [];

  // Phase A: local cluster priority — first radius ≤ LOCAL_PRIORITY_RADIUS_KM with ≥ FALLBACK.
  // A valid tight local cluster is preferred over expanding to meet TARGET at a wider radius.
  for (const r of RADIUS_BANDS_KM) {
    if (r > LOCAL_PRIORITY_RADIUS_KM) break;
    const inBand = withDist.filter(d => d._dist <= r);
    if (inBand.length >= MIN_COMPARABLES_FALLBACK) {
      selectedRadius = r;
      selected       = inBand.map(d => d.listing);
      break;
    }
  }

  // Phase B: wider radii — prefer first radius reaching TARGET.
  if (!selectedRadius) {
    for (const r of RADIUS_BANDS_KM) {
      if (r <= LOCAL_PRIORITY_RADIUS_KM) continue;
      const inBand = withDist.filter(d => d._dist <= r);
      if (inBand.length >= MIN_COMPARABLES_TARGET) {
        selectedRadius = r;
        selected       = inBand.map(d => d.listing);
        break;
      }
    }
  }

  // Phase C: wider radii — accept FALLBACK when no TARGET radius exists.
  if (!selectedRadius) {
    for (const r of RADIUS_BANDS_KM) {
      if (r <= LOCAL_PRIORITY_RADIUS_KM) continue;
      const inBand = withDist.filter(d => d._dist <= r);
      if (inBand.length >= MIN_COMPARABLES_FALLBACK) {
        selectedRadius = r;
        selected       = inBand.map(d => d.listing);
        break;
      }
    }
  }

  diag.comparableCount     = selected.length;
  diag.calendarPresentCount = selected.filter(l => l.availableDates != null).length;
  diag.calendarMissingCount = selected.length - diag.calendarPresentCount;

  const status = selected.length >= MIN_COMPARABLES_FALLBACK ? 'ok' : 'insufficient_comparables';
  return { listings: selected, status, selectedRadiusKm: selectedRadius, diagnostics: diag };
}

// ── Bright Data–specific market statistics ────────────────────────────────────

/**
 * Calculate market statistics from Bright Data comparables.
 *
 * Differences from shared calcMarketStats():
 *   1. Standard median (average two middle for even n) — not upper-middle.
 *   2. Occupancy = calendar_unavailability_rate (median across listings)
 *      NOT derived from !availability (which is structurally 0% for BD discovery).
 *
 * Returns the same shape as calcMarketStats() for drop-in compatibility:
 *   { median, p25, p75, occupancy, tensionLevel, count }
 * Plus:
 *   { occupancy_semantics } — internal diagnostic field; not written to market_data.
 *
 * @param {Array}  comparables
 * @param {object} [opts]
 * @param {string} [opts.today]           — ISO YYYY-MM-DD, defaults to current date
 * @param {number} [opts.calendarWindow]  — days for unavailability window, default 60
 */
function calcBrightDataMarketStats(comparables, opts = {}) {
  const {
    today          = new Date().toISOString().slice(0, 10),
    calendarWindow = CALENDAR_WINDOW_DAYS,
  } = opts;

  const prices = comparables.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
  if (!prices.length) return null;

  // Standard median
  const n   = prices.length;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

  // p25/p75 — same floor formula as calcMarketStats() for consistency
  const p25 = prices[Math.floor(n * 0.25)];
  const p75 = prices[Math.floor(n * 0.75)];

  // Calendar unavailability proxy (60-day window, median across listings)
  // A date absent from available_dates may mean booked, blocked, or outside host
  // calendar rules — this is NOT factual occupancy.
  const endDate = addDaysToDate(today, calendarWindow);
  const proxies = [];
  for (const listing of comparables) {
    if (!Array.isArray(listing.availableDates)) continue;
    const validDates = listing.availableDates.filter(
      d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
    );
    const datesInWindow = validDates.filter(d => d >= today && d < endDate);
    const unavailProxy  = (calendarWindow - datesInWindow.length) / calendarWindow;
    proxies.push(Math.min(1, Math.max(0, unavailProxy)));
  }

  let occupancy           = 0;
  let occupancy_semantics = 'insufficient_calendars';

  if (proxies.length >= MIN_CALENDAR_COMPARABLES) {
    const sp   = [...proxies].sort((a, b) => a - b);
    const pn   = sp.length;
    const pmid = Math.floor(pn / 2);
    const medProxy = pn % 2 === 1 ? sp[pmid] : (sp[pmid - 1] + sp[pmid]) / 2;
    occupancy           = Math.round(medProxy * 100);
    occupancy_semantics = 'calendar_unavailability_proxy';
  }

  const tensionLevel = calcTensionLevelLocal(occupancy);

  return { median, p25, p75, occupancy, tensionLevel, count: n, occupancy_semantics };
}

// ── Booking.com–specific market statistics ────────────────────────────────────

/**
 * Calculate market statistics from Booking.com Bright Data comparables.
 *
 * Booking.com discovery has no available_dates → occupancy proxy is NOT FEASIBLE.
 * Returns occupancy: null, occupancy_semantics: 'unavailable' (never 0, which
 * would falsely imply an empty market).
 *
 * Returns extended shape with percentile distribution:
 *   { median, p10, p25, p75, p90, mean, min, max, count,
 *     occupancy: null, occupancy_semantics: 'unavailable', tensionLevel: null }
 *
 * @param {Array} comparables  — NormalizedMarketListing[] (price field is nightly)
 */
function calcBrightDataBookingMarketStats(comparables) {
  const prices = comparables.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
  if (!prices.length) return null;

  const n   = prices.length;
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

  const percentile = (pct) => prices[Math.floor(n * pct)];

  const mean = prices.reduce((s, p) => s + p, 0) / n;

  return {
    median,
    p10: percentile(0.10),
    p25: percentile(0.25),
    p75: percentile(0.75),
    p90: percentile(0.90),
    mean: Math.round(mean * 100) / 100,
    min: prices[0],
    max: prices[n - 1],
    count: n,
    occupancy: null,
    occupancy_semantics: 'unavailable',
    tensionLevel: null,
  };
}

module.exports = {
  selectComparables,
  calcBrightDataMarketStats,
  calcBrightDataBookingMarketStats,
  haversineKm,
  isCategoryCompatible,
  isCapacityCompatible,
  addDaysToDate,
  calcTensionLevelLocal,
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_TARGET,
  MIN_COMPARABLES_FALLBACK,
  LOCAL_PRIORITY_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_GUEST_DELTA,
  CALENDAR_WINDOW_DAYS,
  MIN_CALENDAR_COMPARABLES,
};

#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-BK-H — Multi-Source Divergence Audit Tool
 *
 * Diagnoses why Airbnb and Booking.com produce divergent market statistics.
 * AUDIT/DIAGNOSTIC ONLY — no production logic is modified.
 *
 * SAFETY:
 *   DB_WRITES          = 0  always
 *   MARKET_DATA_WRITES = 0  always
 *   PRICING_WRITES     = 0  always
 *   CHANNEX_CALLS      = 0  always
 *   BD_CALLS           = 0 (preview) | 2 max (execute: 1 Airbnb + 1 Booking)
 *   BRIGHTDATA_API_KEY   never printed
 *   PRODUCTION_ROUTING_UNCHANGED
 *
 * CLI:
 *   Preview: node outils/audit-multisource-divergence.js --name "M6"
 *   Execute: node outils/audit-multisource-divergence.js --name "M6" --execute [--max-listings 100]
 */

require('dotenv').config();
const { Pool }                         = require('pg');
const { scrapeWithBrightData }         = require('../services/providers/brightdata');
const { scrapeWithBrightDataBooking }  = require('../services/providers/brightdata-booking');
const {
  selectComparables,
  haversineKm,
  isCategoryCompatible,
  isCapacityCompatible,
  calcBrightDataMarketStats,
  calcBrightDataBookingMarketStats,
  MIN_COMPARABLES_FALLBACK,
  MIN_COMPARABLES_TARGET,
  LOCAL_PRIORITY_RADIUS_KM,
} = require('../services/brightdata-comparable-filter');
const { aggregateMarketSources }       = require('../services/market-multi-source-aggregator');
const { getFallbackZones }             = require('../routes/dynamic-pricing-cron');
const { normalizeCurrency }            = require('../routes/market-data-resolver');

const DEFAULT_NIGHTS     = 3;
const DEFAULT_MAX        = 100;
const HARD_MAX_LISTINGS  = 100;
const AUDIT_RADIUS_BANDS = [1, 2, 3, 5, 10, 20];

// ── Date helpers ──────────────────────────────────────────────────────────────

function addDaysISO(now, days, timezone) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(d);
}

// ── Pure price stats ──────────────────────────────────────────────────────────

function priceStats(sortedPrices) {
  const n = sortedPrices.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return {
    count:  n,
    min:    sortedPrices[0],
    p25:    sortedPrices[Math.floor(n * 0.25)],
    median: n % 2 === 1 ? sortedPrices[mid] : (sortedPrices[mid - 1] + sortedPrices[mid]) / 2,
    p75:    sortedPrices[Math.floor(n * 0.75)],
    max:    sortedPrices[n - 1],
  };
}

// ── computeQualityPool ────────────────────────────────────────────────────────

/**
 * Apply dedup + category + capacity filters (mirrors selectComparables pre-geo step).
 * Does NOT mutate input.
 */
function computeQualityPool(listings, targetGuests = null, targetPropertyType = null) {
  const seenIds = new Set();
  const deduped = [];
  for (const l of listings) {
    const id = l.providerListingId;
    if (id != null) { if (seenIds.has(id)) continue; seenIds.add(id); }
    deduped.push(l);
  }
  const afterCat = deduped.filter(l => isCategoryCompatible(l.category, targetPropertyType) !== false);
  const afterCap = afterCat.filter(l => isCapacityCompatible(l.guests, targetGuests) !== false);
  return afterCap;
}

// ── computeFilterFunnel ───────────────────────────────────────────────────────

/**
 * Trace every filtering step from raw BD count down to quality pool.
 * Takes adapter diagnostics for raw count.
 */
function computeFilterFunnel(listings, adapterDiag, opts = {}) {
  const { targetGuests = null, targetPropertyType = null, targetBedrooms = null } = opts;

  const rawCount      = (adapterDiag && adapterDiag.returnedCount != null) ? adapterDiag.returnedCount : listings.length;
  const acceptedCount = listings.length;

  const withGeo    = listings.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)).length;
  const withoutGeo = acceptedCount - withGeo;

  // Dedup
  const seenIds = new Set();
  const deduped = [];
  let dupCount = 0;
  for (const l of listings) {
    const id = l.providerListingId;
    if (id != null) { if (seenIds.has(id)) { dupCount++; continue; } seenIds.add(id); }
    deduped.push(l);
  }

  // Category
  let catCompatible = 0, catMissing = 0, catRejected = 0;
  const afterCat = [];
  for (const l of deduped) {
    const r = isCategoryCompatible(l.category, targetPropertyType);
    if (r === false) { catRejected++; }
    else { if (r === null) catMissing++; else catCompatible++; afterCat.push(l); }
  }

  // Capacity
  let capCompatible = 0, capMissing = 0, capRejected = 0;
  const afterCap = [];
  for (const l of afterCat) {
    const r = isCapacityCompatible(l.guests, targetGuests);
    if (r === false) { capRejected++; }
    else { if (r === null) capMissing++; else capCompatible++; afterCap.push(l); }
  }

  // Bedroom counts (info only — not a selectComparables filter)
  let bedroomMissing = 0, bedroomMatch = 0, bedroomMismatch = 0;
  for (const l of afterCap) {
    if (l.bedrooms == null) { bedroomMissing++; continue; }
    if (targetBedrooms != null) {
      if (l.bedrooms === targetBedrooms) bedroomMatch++;
      else bedroomMismatch++;
    }
  }

  const qualityPool    = afterCap.length;
  const qualityPoolGeo = afterCap.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)).length;

  return {
    raw: rawCount,
    adapterAccepted: acceptedCount,
    withGeo, withoutGeo,
    dupCount,
    afterDedup: deduped.length,
    catCompatible, catMissing, catRejected,
    afterCategory: afterCat.length,
    capCompatible, capMissing, capRejected,
    afterCapacity: afterCap.length,
    bedroomMissing, bedroomMatch, bedroomMismatch,
    qualityPool,
    qualityPoolGeo,
    qualityPoolNoGeo: qualityPool - qualityPoolGeo,
  };
}

// ── computeRadiusBands ────────────────────────────────────────────────────────

/**
 * For each radius band: raw geo count (before quality filters) and
 * quality-filtered count + price stats.
 */
function computeRadiusBands(listings, targetLat, targetLon, targetGuests = null, targetPropertyType = null) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null;

  const withDist = listings
    .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    .map(l => ({ ...l, _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude) }));

  const qualityWithDist = computeQualityPool(listings, targetGuests, targetPropertyType)
    .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    .map(l => ({ ...l, _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude) }));

  return AUDIT_RADIUS_BANDS.map(r => {
    const rawInBand     = withDist.filter(d => d._dist <= r);
    const qualityInBand = qualityWithDist.filter(d => d._dist <= r);
    const rawPrices     = rawInBand.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b);
    const qualityPrices = qualityInBand.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b);
    return {
      radiusKm:    r,
      rawGeoCount: rawInBand.length,
      qualityCount: qualityInBand.length,
      rawStats:    priceStats(rawPrices),
      qualityStats: priceStats(qualityPrices),
    };
  });
}

// ── computeDistanceDistribution ───────────────────────────────────────────────

function computeDistanceDistribution(listings, targetLat, targetLon) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null;

  const distances = listings
    .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
    .map(l => haversineKm(targetLat, targetLon, l.latitude, l.longitude))
    .sort((a, b) => a - b);

  if (!distances.length) return { count: 0, within1km: 0, within2km: 0, within3km: 0, within5km: 0, within10km: 0, within20km: 0, beyond20km: 0 };

  const n   = distances.length;
  const mid = Math.floor(n / 2);
  const pct = p => distances[Math.floor(n * p)];

  return {
    count:     n,
    min:       distances[0],
    p10:       pct(0.10),
    p25:       pct(0.25),
    median:    n % 2 === 1 ? distances[mid] : (distances[mid - 1] + distances[mid]) / 2,
    p75:       pct(0.75),
    p90:       pct(0.90),
    max:       distances[n - 1],
    within1km:  distances.filter(d => d <= 1).length,
    within2km:  distances.filter(d => d <= 2).length,
    within3km:  distances.filter(d => d <= 3).length,
    within5km:  distances.filter(d => d <= 5).length,
    within10km: distances.filter(d => d <= 10).length,
    within20km: distances.filter(d => d <= 20).length,
    beyond20km: distances.filter(d => d > 20).length,
  };
}

// ── computeCategoryDistribution ───────────────────────────────────────────────

function computeCategoryDistribution(listings) {
  const counts = {};
  let nullCount = 0;
  for (const l of listings) {
    const c = l.category;
    if (c == null || c === '') { nullCount++; continue; }
    counts[c] = (counts[c] || 0) + 1;
  }
  return {
    distribution: Object.entries(counts).sort((a, b) => b[1] - a[1]),
    nullCount,
    total: listings.length,
  };
}

// ── computeBedroomDistribution ────────────────────────────────────────────────

function computeBedroomDistribution(listings, targetBedrooms = null) {
  let missing = 0, b0 = 0, b1 = 0, b2 = 0, b3plus = 0;
  for (const l of listings) {
    if (l.bedrooms == null) { missing++; continue; }
    if (l.bedrooms === 0)   { b0++;      continue; }
    if (l.bedrooms === 1)   { b1++;      continue; }
    if (l.bedrooms === 2)   { b2++;      continue; }
    b3plus++;
  }
  let exactMatch = null, unknownBedrooms = null, mismatch = null;
  if (targetBedrooms != null) {
    exactMatch = 0; unknownBedrooms = missing; mismatch = 0;
    for (const l of listings) {
      if (l.bedrooms == null) continue;
      if (l.bedrooms === targetBedrooms) exactMatch++;
      else mismatch++;
    }
  }
  return { missing, b0, b1, b2, b3plus, total: listings.length, exactMatch, unknownBedrooms, mismatch };
}

// ── computeCapacityGuestDistribution ─────────────────────────────────────────

function computeCapacityGuestDistribution(listings, provider) {
  if (provider === 'booking') {
    return {
      nativeCapacityField: 'unavailable',
      filterApplied: false,
      note: 'adults field is input echo, not listing capacity — filter not applied',
      distribution: {},
      nullCount: listings.length,
      total: listings.length,
    };
  }
  // Airbnb: guests field from item.guests
  const counts = {};
  let nullCount = 0;
  for (const l of listings) {
    if (l.guests == null) { nullCount++; continue; }
    const k = String(l.guests);
    counts[k] = (counts[k] || 0) + 1;
  }
  return {
    nativeCapacityField: 'guests',
    filterApplied: true,
    distribution: counts,
    nullCount,
    total: listings.length,
  };
}

// ── computeNormalizationSample ────────────────────────────────────────────────

function computeNormalizationSample(listings, requestedNights, provider) {
  const sample = listings.slice(0, 10).map(l => ({
    provider,
    providerListingId: l.providerListingId,
    normalizedNightlyPrice: l.price,
    requestedNights,
    impliedTotal: Math.round(l.price * requestedNights * 100) / 100,
  }));
  const prices = listings.map(l => l.price).filter(p => p > 0);
  if (!prices.length) return { sample, verdict: 'NO_DATA', medianNightly: null };
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const med = n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const verdict = (med > 5 && med < 2000) ? 'PASS' : 'FAIL';
  return { sample, verdict, medianNightly: med };
}

// ── computeCommonRadiusStats ──────────────────────────────────────────────────

/**
 * For each radius band, show airbnb + booking stats without a minimum threshold
 * requirement for display (diagnostic — always show).
 * statisticallyUsable: both sources must have >= MIN_COMPARABLES_FALLBACK.
 */
function computeCommonRadiusStats(airbnbListings, bookingListings, targetLat, targetLon, targetGuests = null, targetPropertyType = null) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null;

  const mkPool = (listings) =>
    computeQualityPool(listings, targetGuests, targetPropertyType)
      .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
      .map(l => ({ ...l, _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude) }));

  const airbnbPool  = mkPool(airbnbListings);
  const bookingPool = mkPool(bookingListings);

  return AUDIT_RADIUS_BANDS.map(r => {
    const ab = airbnbPool.filter(d => d._dist <= r);
    const bb = bookingPool.filter(d => d._dist <= r);
    const aStats = priceStats(ab.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b));
    const bStats = priceStats(bb.map(d => d.price).filter(p => p > 0).sort((a, b) => a - b));
    const div = (aStats && bStats) ? computeDivergencePct(aStats.median, bStats.median) : null;
    return {
      radiusKm:           r,
      airbnbCount:        ab.length,
      bookingCount:       bb.length,
      airbnbMedian:       aStats ? aStats.median : null,
      bookingMedian:      bStats ? bStats.median : null,
      divergencePct:      div != null ? Math.round(div * 100) / 100 : null,
      statisticallyUsable: ab.length >= MIN_COMPARABLES_FALLBACK && bb.length >= MIN_COMPARABLES_FALLBACK,
    };
  });
}

// ── computeDivergencePct ──────────────────────────────────────────────────────

function computeDivergencePct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return Math.abs(a - b) / ((a + b) / 2) * 100;
}

// ── computeSearchCoverage ─────────────────────────────────────────────────────

function computeSearchCoverage(listings, targetLat, targetLon) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return 'UNKNOWN';
  const withGeo = listings.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
  if (!withGeo.length) return 'UNKNOWN';
  const within5km = withGeo.filter(l => haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= 5).length;
  const pct = within5km / withGeo.length;
  if (pct >= 0.50) return 'LOCAL';
  if (pct >= 0.20) return 'MIXED';
  return 'WIDE';
}

// ── computePrimaryAttritionReason ─────────────────────────────────────────────

function computePrimaryAttritionReason(funnel, distDist) {
  const steps = [
    { reason: 'DUPLICATE_IDS',           lost: funnel.dupCount },
    { reason: 'CATEGORY_FILTER',         lost: funnel.catRejected },
    { reason: 'CAPACITY_FILTER',         lost: funnel.capRejected },
    { reason: 'GEO_MISSING',             lost: funnel.qualityPoolNoGeo },
    { reason: 'GEOGRAPHIC_DISTRIBUTION', lost: distDist ? (distDist.beyond20km || 0) : 0 },
    { reason: 'ADAPTER_PRICE_CURRENCY',  lost: funnel.raw - funnel.adapterAccepted },
  ];
  const maxLost = Math.max(...steps.map(s => s.lost));
  if (maxLost === 0) return 'NO_SIGNIFICANT_ATTRITION';
  return steps.find(s => s.lost === maxLost).reason;
}

// ── computeCrossSourceGeoProximity ────────────────────────────────────────────

function computeCrossSourceGeoProximity(airbnbListings, bookingListings) {
  const ag = airbnbListings.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));
  const bg = bookingListings.filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude));

  let within50m = 0, within100m = 0, within250m = 0;
  for (const a of ag) {
    let nearest = Infinity;
    for (const b of bg) {
      const dm = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
      if (dm < nearest) nearest = dm;
    }
    if (nearest <= 50)  within50m++;
    if (nearest <= 100) within100m++;
    if (nearest <= 250) within250m++;
  }
  return { within50m, within100m, within250m, usedForDedup: false, usedForPricing: false };
}

// ── computeCounterfactuals ────────────────────────────────────────────────────

function computeCounterfactuals(airbnbListings, bookingListings, targetLat, targetLon, targetGuests = null, targetPropertyType = null) {
  const hasGeo = Number.isFinite(targetLat) && Number.isFinite(targetLon);

  const poolFiltered = (listings, maxKm) => {
    const pool = computeQualityPool(listings, targetGuests, targetPropertyType);
    if (!hasGeo || maxKm == null) return pool;
    return pool.filter(l =>
      Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
      haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= maxKm
    );
  };

  const scenarioStats = (ab, bb) => {
    const aP = ab.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
    const bP = bb.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
    const aStats = priceStats(aP);
    const bStats = priceStats(bP);
    const div = (aStats && bStats) ? Math.round(computeDivergencePct(aStats.median, bStats.median) * 100) / 100 : null;
    return {
      airbnbCount:   ab.length,
      bookingCount:  bb.length,
      airbnbMedian:  aStats ? aStats.median : null,
      bookingMedian: bStats ? bStats.median : null,
      divergencePct: div,
      statisticallyUsable:
        ab.length >= MIN_COMPARABLES_FALLBACK || bb.length >= MIN_COMPARABLES_FALLBACK,
    };
  };

  // Scenario A: production selectComparables
  const selA  = selectComparables(airbnbListings, { targetLat, targetLon, targetGuests, targetPropertyType });
  const selAb = selectComparables(bookingListings, { targetLat, targetLon, targetGuests, targetPropertyType });

  // Scenario B: 5km cap
  const B_ab = poolFiltered(airbnbListings, 5);
  const B_bb = poolFiltered(bookingListings, 5);

  // Scenario C: 10km cap
  const C_ab = poolFiltered(airbnbListings, 10);
  const C_bb = poolFiltered(bookingListings, 10);

  // Scenario D: local source priority (diagnostic)
  const D3_ab = poolFiltered(airbnbListings, 3);
  const D3_bb = poolFiltered(bookingListings, 3);
  let scenarioD;
  if (D3_ab.length >= MIN_COMPARABLES_TARGET && D3_bb.length < MIN_COMPARABLES_FALLBACK) {
    scenarioD = { description: 'local_airbnb_dominant', ...scenarioStats(D3_ab, poolFiltered(bookingListings, 20)) };
  } else if (D3_bb.length >= MIN_COMPARABLES_TARGET && D3_ab.length < MIN_COMPARABLES_FALLBACK) {
    scenarioD = { description: 'local_booking_dominant', ...scenarioStats(poolFiltered(airbnbListings, 20), D3_bb) };
  } else {
    scenarioD = { description: 'not_applicable', reason: 'no_extreme_local_dominance', ...scenarioStats([], []) };
  }

  return {
    scenarioA: scenarioStats(selA.listings, selAb.listings),
    scenarioB: scenarioStats(B_ab, B_bb),
    scenarioC: scenarioStats(C_ab, C_bb),
    scenarioD,
  };
}

// ── computeDivergenceFactors ──────────────────────────────────────────────────

function computeDivergenceFactors(ctx) {
  const factors = [];

  const {
    airbnbSelectedRadius, bookingSelectedRadius,
    airbnbDistDist, bookingDistDist,
    airbnbFunnel, bookingFunnel,
    airbnbNormVerdict, bookingNormVerdict,
    airbnbSearchCoverage,
  } = ctx;

  if (airbnbSelectedRadius != null && bookingSelectedRadius != null &&
      Math.abs(airbnbSelectedRadius - bookingSelectedRadius) >= 5) {
    factors.push('GEO_RADIUS_MISMATCH');
  }

  if (airbnbDistDist && airbnbDistDist.within5km < MIN_COMPARABLES_FALLBACK) {
    factors.push('INSUFFICIENT_LOCAL_AIRBNB_SAMPLE');
  }

  if (airbnbFunnel && airbnbFunnel.bedroomMissing === airbnbFunnel.afterCapacity) {
    factors.push('BEDROOM_METADATA_WEAK_AIRBNB');
  }

  if (airbnbFunnel && bookingFunnel &&
      airbnbFunnel.capRejected > 0 && bookingFunnel.capMissing === bookingFunnel.afterDedup) {
    factors.push('CAPACITY_FILTER_ASYMMETRY');
  }

  if (airbnbSearchCoverage === 'WIDE') {
    factors.push('SEARCH_COVERAGE_MISMATCH');
  }

  if (airbnbNormVerdict === 'FAIL' || bookingNormVerdict === 'FAIL') {
    factors.push('PRICE_NORMALIZATION_MISMATCH');
  }

  if (factors.length === 0) {
    factors.push('REAL_PLATFORM_PRICE_GAP_CANDIDATE');
  }

  return factors;
}

// ── computeRealPlatformPriceGap ───────────────────────────────────────────────

function computeRealPlatformPriceGap(commonRadius) {
  if (!commonRadius) return 'UNDETERMINED';
  const usable = commonRadius.filter(r => r.statisticallyUsable);
  if (!usable.length) return 'UNDETERMINED';
  const best = usable[usable.length - 1];
  if (best.airbnbCount >= MIN_COMPARABLES_TARGET && best.bookingCount >= MIN_COMPARABLES_TARGET &&
      best.divergencePct != null && best.divergencePct >= 50) {
    return 'CONFIRMED';
  }
  if (best.divergencePct != null && best.divergencePct >= 10) {
    return 'POSSIBLE';
  }
  return 'UNDETERMINED';
}

// ── computeSafeForPricing ─────────────────────────────────────────────────────

function computeSafeForPricing(divLevel, confLevel) {
  if (confLevel === 'INSUFFICIENT' || confLevel === 'LOW') return false;
  if (divLevel === 'EXTREME') return false;
  if (divLevel === 'HIGH' && confLevel !== 'HIGH') return false;
  return true;
}

// ── runAudit ──────────────────────────────────────────────────────────────────

/**
 * Run the full divergence audit on already-scraped provider results.
 * Pure function — no network, no DB.
 */
function runAudit(airbnbRaw, bookingRaw, prop) {
  const targetLat      = prop.latitude  != null ? parseFloat(prop.latitude)  : null;
  const targetLon      = prop.longitude != null ? parseFloat(prop.longitude) : null;
  const targetGuests   = prop.max_guests   != null ? parseInt(prop.max_guests, 10)  : null;
  const targetBedrooms = prop.bedrooms     != null ? parseInt(prop.bedrooms, 10)    : null;

  const airbnbDiag  = airbnbRaw.diagnostics  || {};
  const bookingDiag = bookingRaw.diagnostics || {};
  const requestedNights = bookingDiag.requestedNights || DEFAULT_NIGHTS;

  // Funnels
  const airbnbFunnel  = computeFilterFunnel(airbnbRaw.listings,  airbnbDiag,  { targetGuests, targetBedrooms });
  const bookingFunnel = computeFilterFunnel(bookingRaw.listings, bookingDiag, { targetGuests, targetBedrooms });

  // Radius bands
  const airbnbBands  = computeRadiusBands(airbnbRaw.listings,  targetLat, targetLon, targetGuests);
  const bookingBands = computeRadiusBands(bookingRaw.listings, targetLat, targetLon, targetGuests);

  // Distance distributions
  const airbnbDistDist  = computeDistanceDistribution(airbnbRaw.listings,  targetLat, targetLon);
  const bookingDistDist = computeDistanceDistribution(bookingRaw.listings, targetLat, targetLon);

  // Category distributions (before/after quality filters)
  const airbnbCatBefore   = computeCategoryDistribution(airbnbRaw.listings);
  const airbnbPool        = computeQualityPool(airbnbRaw.listings, targetGuests);
  const airbnbCatAfter    = computeCategoryDistribution(airbnbPool);
  const bookingCatBefore  = computeCategoryDistribution(bookingRaw.listings);
  const bookingPool       = computeQualityPool(bookingRaw.listings, targetGuests);
  const bookingCatAfter   = computeCategoryDistribution(bookingPool);

  // Bedroom distributions (on quality pool)
  const airbnbBedrooms  = computeBedroomDistribution(airbnbPool,  targetBedrooms);
  const bookingBedrooms = computeBedroomDistribution(bookingPool, targetBedrooms);

  // Capacity distributions
  const airbnbCapacity  = computeCapacityGuestDistribution(airbnbRaw.listings, 'airbnb');
  const bookingCapacity = computeCapacityGuestDistribution(bookingRaw.listings, 'booking');

  // Price normalization samples
  const airbnbNormSample  = computeNormalizationSample(airbnbRaw.listings,  requestedNights, 'airbnb');
  const bookingNormSample = computeNormalizationSample(bookingRaw.listings, requestedNights, 'booking');

  // selectComparables (production)
  const selAirbnb  = selectComparables(airbnbRaw.listings,  { targetLat, targetLon, targetGuests, targetPropertyType: null });
  const selBooking = selectComparables(bookingRaw.listings, { targetLat, targetLon, targetGuests, targetPropertyType: null });

  const airbnbStats  = calcBrightDataMarketStats(selAirbnb.listings);
  const bookingStats = calcBrightDataBookingMarketStats(selBooking.listings);

  // Common radius stats
  const commonRadius = computeCommonRadiusStats(airbnbRaw.listings, bookingRaw.listings, targetLat, targetLon, targetGuests);

  // Search coverage
  const airbnbSearchCoverage  = computeSearchCoverage(airbnbRaw.listings,  targetLat, targetLon);
  const bookingSearchCoverage = computeSearchCoverage(bookingRaw.listings, targetLat, targetLon);

  // Primary attrition
  const airbnbAttrition  = computePrimaryAttritionReason(airbnbFunnel,  airbnbDistDist);
  const bookingAttrition = computePrimaryAttritionReason(bookingFunnel, bookingDistDist);

  // Cross-source geo proximity (on quality comparables)
  const crossGeo = computeCrossSourceGeoProximity(selAirbnb.listings, selBooking.listings);

  // Counterfactuals
  const counterfactuals = computeCounterfactuals(airbnbRaw.listings, bookingRaw.listings, targetLat, targetLon, targetGuests);

  // Aggregation (current production)
  const aggregation = aggregateMarketSources({
    airbnb:  { stats: airbnbStats,  comparableCount: selAirbnb.listings.length,  selectedRadiusKm: selAirbnb.selectedRadiusKm  },
    booking: { stats: bookingStats, comparableCount: selBooking.listings.length, selectedRadiusKm: selBooking.selectedRadiusKm },
  });

  // Divergence factors
  const divFactors = computeDivergenceFactors({
    airbnbSelectedRadius:  selAirbnb.selectedRadiusKm,
    bookingSelectedRadius: selBooking.selectedRadiusKm,
    airbnbDistDist,
    bookingDistDist,
    airbnbFunnel,
    bookingFunnel,
    airbnbNormVerdict:  airbnbNormSample.verdict,
    bookingNormVerdict: bookingNormSample.verdict,
    airbnbSearchCoverage,
  });

  // Real price gap
  const realPriceGap = computeRealPlatformPriceGap(commonRadius);

  // Safe for pricing
  const safeForPricing = aggregation.consensus
    ? computeSafeForPricing(aggregation.consensus.divergenceLevel, aggregation.consensus.confidenceLevel)
    : false;

  // Best common radius (widest statistically usable)
  const bestCommonRadius = commonRadius ? commonRadius.filter(r => r.statisticallyUsable).slice(-1)[0] : null;

  return {
    airbnbFunnel, bookingFunnel,
    airbnbBands, bookingBands,
    airbnbDistDist, bookingDistDist,
    airbnbCatBefore, airbnbCatAfter,
    bookingCatBefore, bookingCatAfter,
    airbnbBedrooms, bookingBedrooms,
    airbnbCapacity, bookingCapacity,
    airbnbNormSample, bookingNormSample,
    selAirbnb, selBooking,
    airbnbStats, bookingStats,
    commonRadius,
    airbnbSearchCoverage, bookingSearchCoverage,
    airbnbAttrition, bookingAttrition,
    crossGeo,
    counterfactuals,
    aggregation,
    divFactors,
    realPriceGap,
    safeForPricing,
    bestCommonRadius,
    requestedNights,
  };
}

// ── Display helpers ───────────────────────────────────────────────────────────

function fmt(v, decimals = 2) {
  if (v == null || !Number.isFinite(v)) return 'null';
  return v.toFixed(decimals);
}

function printFunnel(funnel, label, provider) {
  console.log(`\n  ${label} FILTER FUNNEL`);
  console.log('  ' + '─'.repeat(60));
  console.log(`  RAW (BD returned)              ${funnel.raw}`);
  console.log(`  ADAPTER_ACCEPTED               ${funnel.adapterAccepted}` +
    (funnel.raw !== funnel.adapterAccepted ? `  (-${funnel.raw - funnel.adapterAccepted} price/currency/avail)` : ''));
  console.log(`  WITH_GEO                       ${funnel.withGeo}`);
  console.log(`  WITHOUT_GEO                    ${funnel.withoutGeo}`);
  console.log(`  AFTER_DEDUP                    ${funnel.afterDedup}` +
    (funnel.dupCount ? `  (-${funnel.dupCount} dupes)` : ''));
  console.log(`  CATEGORY_COMPATIBLE            ${funnel.catCompatible}`);
  console.log(`  CATEGORY_MISSING               ${funnel.catMissing}`);
  console.log(`  CATEGORY_REJECTED              ${funnel.catRejected}`);
  console.log(`  AFTER_CATEGORY                 ${funnel.afterCategory}`);
  if (provider === 'booking') {
    console.log(`  CAPACITY_FILTER                FILTER_NOT_APPLIED`);
    console.log(`    reason = adults is input echo, not listing capacity`);
    console.log(`    all ${funnel.afterCategory} listings kept conservatively`);
  } else {
    console.log(`  CAPACITY_COMPATIBLE            ${funnel.capCompatible}`);
    console.log(`  CAPACITY_MISSING               ${funnel.capMissing}`);
    console.log(`  CAPACITY_REJECTED              ${funnel.capRejected}`);
  }
  console.log(`  AFTER_CAPACITY                 ${funnel.afterCapacity}`);
  console.log(`  BEDROOM_MISSING (info only)    ${funnel.bedroomMissing}`);
  console.log(`  BEDROOM_EXACT_MATCH (info)     ${funnel.bedroomMatch ?? 'n/a (no target)'}`);
  console.log(`  BEDROOM_MISMATCH (info)        ${funnel.bedroomMismatch ?? 'n/a (no target)'}`);
  console.log(`  QUALITY_POOL                   ${funnel.qualityPool}`);
  console.log(`  QUALITY_POOL_WITH_GEO          ${funnel.qualityPoolGeo}`);
  console.log(`  QUALITY_POOL_NO_GEO            ${funnel.qualityPoolNoGeo}`);
}

function printRadiusBands(bands, label) {
  if (!bands) { console.log(`\n  ${label}: no target geo — radius bands unavailable`); return; }
  console.log(`\n  ${label} RADIUS BANDS`);
  console.log('  ' + '─'.repeat(72));
  console.log('  Radius | RawGeo | Quality | P25      | Median   | P75      | Min    | Max');
  for (const b of bands) {
    const qs = b.qualityStats;
    const p25 = qs ? fmt(qs.p25) : 'null'; const med = qs ? fmt(qs.median) : 'null';
    const p75 = qs ? fmt(qs.p75) : 'null'; const min = qs ? fmt(qs.min)    : 'null';
    const max = qs ? fmt(qs.max) : 'null';
    console.log(`  ${String(b.radiusKm).padStart(4)} km | ${String(b.rawGeoCount).padStart(6)} | ${String(b.qualityCount).padStart(7)} | ${p25.padStart(8)} | ${med.padStart(8)} | ${p75.padStart(8)} | ${min.padStart(6)} | ${max}`);
  }
}

function printDistDist(dist, label) {
  if (!dist) { console.log(`\n  ${label}: no target geo`); return; }
  console.log(`\n  ${label} DISTANCE DISTRIBUTION (${dist.count} listings with geo)`);
  console.log('  ' + '─'.repeat(50));
  if (dist.count === 0) { console.log('  No geo-valid listings'); return; }
  console.log(`  min=${fmt(dist.min)} P10=${fmt(dist.p10)} P25=${fmt(dist.p25)} median=${fmt(dist.median)} P75=${fmt(dist.p75)} P90=${fmt(dist.p90)} max=${fmt(dist.max)} km`);
  console.log(`  within 1km:  ${dist.within1km}    within 2km: ${dist.within2km}    within 3km: ${dist.within3km}`);
  console.log(`  within 5km:  ${dist.within5km}    within 10km: ${dist.within10km}   within 20km: ${dist.within20km}    >20km: ${dist.beyond20km}`);
}

function printCommonRadius(cr) {
  if (!cr) { console.log('\n  COMMON RADIUS: no target geo'); return; }
  console.log('\n  COMMON RADIUS COMPARISON (quality pool, both providers)');
  console.log('  ' + '─'.repeat(80));
  console.log('  Radius | Air# | Bkg# | AirMedian | BkgMedian | Divergence% | Usable');
  for (const r of cr) {
    const div = r.divergencePct != null ? fmt(r.divergencePct) : '    null';
    const usable = r.statisticallyUsable ? 'YES' : 'NO';
    console.log(`  ${String(r.radiusKm).padStart(4)} km | ${String(r.airbnbCount).padStart(4)} | ${String(r.bookingCount).padStart(4)} | ${fmt(r.airbnbMedian).padStart(9)} | ${fmt(r.bookingMedian).padStart(9)} | ${div.padStart(11)} | ${usable}`);
  }
}

function printCounterfactuals(cf) {
  console.log('\n  COUNTERFACTUAL SCENARIOS (diagnostic only)');
  console.log('  ' + '─'.repeat(72));
  const row = (name, s) => {
    const air = s.airbnbMedian != null ? fmt(s.airbnbMedian) : 'null';
    const bkg = s.bookingMedian != null ? fmt(s.bookingMedian) : 'null';
    const div = s.divergencePct != null ? `${fmt(s.divergencePct)}%` : 'null';
    console.log(`  ${name.padEnd(22)}: Air${s.airbnbCount}@${air} Bkg${s.bookingCount}@${bkg} div=${div} usable=${s.statisticallyUsable ? 'YES' : 'NO'}`);
  };
  row('A (current prod)',      cf.scenarioA);
  row('B (≤5km)',              cf.scenarioB);
  row('C (≤10km)',             cf.scenarioC);
  if (cf.scenarioD.description === 'not_applicable') {
    console.log(`  D (local priority)    : NOT_APPLICABLE (${cf.scenarioD.reason})`);
  } else {
    row(`D (${cf.scenarioD.description})`, cf.scenarioD);
  }
}

function printTopComparables(listings, label, max = 25) {
  if (!listings.length) { console.log(`\n  ${label}: no comparables`); return; }
  console.log(`\n  ${label} TOP COMPARABLES (max ${max})`);
  console.log('  ' + '─'.repeat(72));
  console.log('  id               | dist km | nightly | beds | guests | category');
  const show = listings.slice(0, max);
  // distance would need targetLat/Lon — show without if not provided
  for (const l of show) {
    const id   = (l.providerListingId || '?').slice(-10).padEnd(16);
    const p    = fmt(l.price, 2).padStart(7);
    const bed  = l.bedrooms != null ? String(l.bedrooms).padStart(4) : 'null';
    const g    = l.guests   != null ? String(l.guests).padStart(6)   : '  null';
    const cat  = (l.category || 'null').slice(0, 25);
    console.log(`  ${id} | ${'?'.padStart(7)} | ${p} | ${bed} | ${g} | ${cat}`);
  }
}

// ── previewMode ───────────────────────────────────────────────────────────────

async function previewMode({ name, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-H Divergence Audit — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | MARKET_DATA_WRITES=0 | PRICING_WRITES=0');
  console.log('═'.repeat(72));

  const rows = (await pool.query(
    `SELECT id, name, internal_name, address, latitude, longitude, timezone, currency, max_guests, bedrooms
       FROM properties WHERE LOWER(name) = LOWER($1) OR LOWER(internal_name) = LOWER($1)`, [name]
  )).rows;
  if (!rows.length) { console.log(`\n  ⛔  Aucune propriété: "${name}"`); return { ok: false }; }
  if (rows.length > 1) { console.log(`  ⛔  Ambiguïté: ${rows.length} correspondances`); return { ok: false }; }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  const now      = _now || new Date();
  const checkIn  = addDaysISO(now, 14, timezone);
  const checkOut = addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);
  const zones    = getFallbackZones(prop.address, null);

  console.log(`\n  PROPERTY:   ${prop.internal_name || prop.name}  [${String(prop.id).slice(-8)}]`);
  console.log(`  lat/lon:    ${prop.latitude} / ${prop.longitude}`);
  console.log(`  currency:   ${currency}   timezone: ${timezone}`);
  console.log(`  max_guests: ${prop.max_guests ?? 'NULL'}   bedrooms: ${prop.bedrooms ?? 'NULL'}`);
  console.log(`\n  PLANNED CALLS (not executed):`);
  console.log(`    location:   ${zones[0]}`);
  console.log(`    check_in:   ${checkIn}   check_out: ${checkOut}   nights: ${DEFAULT_NIGHTS}`);
  console.log(`    Airbnb:     gd_ld7ll037kqy322v05 (discover_new)`);
  console.log(`    Booking:    gd_m4bf7a917zfezv9d5 (url_collection)`);
  console.log(`    max_listings per provider: up to ${HARD_MAX_LISTINGS}`);
  console.log(`\n  Ready: node outils/audit-multisource-divergence.js --name "${name}" --execute`);
  console.log('═'.repeat(72) + '\n');
  return { ok: true };
}

// ── executeMode ───────────────────────────────────────────────────────────────

async function executeMode({ name, maxListings = DEFAULT_MAX, _airbnbScrape, _bookingScrape, _now, pool } = {}) {
  const safeMax = Math.min(Math.max(1, maxListings), HARD_MAX_LISTINGS);
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK-H Divergence Audit — EXECUTE MODE');
  console.log(`  BD_CALLS=2 | max_listings=${safeMax} | DB_WRITES=0 | PRICING_WRITES=0`);
  console.log('═'.repeat(72));

  const rows = (await pool.query(
    `SELECT id, name, internal_name, address, latitude, longitude, timezone, currency, max_guests, bedrooms
       FROM properties WHERE LOWER(name) = LOWER($1) OR LOWER(internal_name) = LOWER($1)`, [name]
  )).rows;
  if (!rows.length) throw new Error(`Aucune propriété: "${name}"`);
  if (rows.length > 1) throw new Error(`${rows.length} correspondances pour "${name}"`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  if (!currency) throw new Error('Devise propriété invalide ou absente');

  const now      = _now || new Date();
  const checkIn  = addDaysISO(now, 14, timezone);
  const checkOut = addDaysISO(now, 14 + DEFAULT_NIGHTS, timezone);
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  console.log(`\n  Property: ${prop.internal_name || prop.name}  currency=${currency}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}  nights=${DEFAULT_NIGHTS}  location=${location}`);
  console.log('');

  console.log('  🔍 [1/2] Airbnb BD scrape…');
  const airbnbFn  = _airbnbScrape || scrapeWithBrightData;
  const airbnbRaw = await airbnbFn(location, safeMax, currency, { checkIn, checkOut });

  console.log('  🔍 [2/2] Booking BD scrape…');
  const bookingFn  = _bookingScrape || scrapeWithBrightDataBooking;
  const bookingRaw = await bookingFn(location, safeMax, currency, { checkIn, checkOut });

  const audit = runAudit(airbnbRaw, bookingRaw, prop);

  // ── Display ───────────────────────────────────────────────────────────────

  printFunnel(audit.airbnbFunnel,  'AIRBNB',  'airbnb');
  printFunnel(audit.bookingFunnel, 'BOOKING', 'booking');

  printRadiusBands(audit.airbnbBands,  'AIRBNB');
  printRadiusBands(audit.bookingBands, 'BOOKING');

  printDistDist(audit.airbnbDistDist,  'AIRBNB');
  printDistDist(audit.bookingDistDist, 'BOOKING');

  console.log('\n  CATEGORY DISTRIBUTION (before quality filters)');
  console.log('  ' + '─'.repeat(50));
  console.log('  Airbnb:');
  for (const [cat, n] of audit.airbnbCatBefore.distribution.slice(0, 10)) console.log(`    ${cat}: ${n}`);
  if (audit.airbnbCatBefore.nullCount) console.log(`    (null): ${audit.airbnbCatBefore.nullCount}`);
  console.log('  Booking:');
  for (const [cat, n] of audit.bookingCatBefore.distribution.slice(0, 10)) console.log(`    ${cat}: ${n}`);
  if (audit.bookingCatBefore.nullCount) console.log(`    (null): ${audit.bookingCatBefore.nullCount}`);

  console.log('\n  CATEGORY DISTRIBUTION (after quality filters, before radius)');
  console.log('  ' + '─'.repeat(50));
  console.log('  Airbnb:');
  for (const [cat, n] of audit.airbnbCatAfter.distribution.slice(0, 10)) console.log(`    ${cat}: ${n}`);
  if (audit.airbnbCatAfter.nullCount) console.log(`    (null): ${audit.airbnbCatAfter.nullCount}`);
  console.log('  Booking:');
  for (const [cat, n] of audit.bookingCatAfter.distribution.slice(0, 10)) console.log(`    ${cat}: ${n}`);
  if (audit.bookingCatAfter.nullCount) console.log(`    (null): ${audit.bookingCatAfter.nullCount}`);

  const ab = audit.airbnbBedrooms; const bb = audit.bookingBedrooms;
  console.log('\n  BEDROOM ANALYSIS (quality pool, info only — not a filter)');
  console.log('  ' + '─'.repeat(50));
  console.log(`  Airbnb:  missing=${ab.missing} 0bd=${ab.b0} 1bd=${ab.b1} 2bd=${ab.b2} 3+bd=${ab.b3plus}  exactMatch=${ab.exactMatch ?? 'n/a'}  mismatch=${ab.mismatch ?? 'n/a'}`);
  console.log(`  Booking: missing=${bb.missing} 0bd=${bb.b0} 1bd=${bb.b1} 2bd=${bb.b2} 3+bd=${bb.b3plus}  exactMatch=${bb.exactMatch ?? 'n/a'}  mismatch=${bb.mismatch ?? 'n/a'}`);

  console.log('\n  CAPACITY ANALYSIS');
  console.log('  ' + '─'.repeat(50));
  const ac = audit.airbnbCapacity;
  console.log(`  Airbnb:  CAPACITY_NATIVE_FIELD=${ac.nativeCapacityField}  CAPACITY_FILTER=${ac.filterApplied ? 'APPLIED' : 'NOT_APPLIED'}`);
  console.log(`    unknown=${ac.nullCount}  distribution: ${JSON.stringify(ac.distribution)}`);
  const bc = audit.bookingCapacity;
  console.log(`  Booking: CAPACITY_NATIVE_FIELD=${bc.nativeCapacityField}  CAPACITY_FILTER=NOT_APPLIED`);
  console.log(`    ${bc.note}`);

  console.log('\n  PRICE NORMALIZATION AUDIT');
  console.log('  ' + '─'.repeat(60));
  const an = audit.airbnbNormSample; const bn = audit.bookingNormSample;
  console.log(`  AIRBNB  formula: pricing_details.price_per_night (already nightly)`);
  console.log(`  AIRBNB  VERDICT: ${an.verdict}  medianNightly=${fmt(an.medianNightly)}`);
  console.log(`  First 10 listings (nightly / implied total for ${audit.requestedNights} nights):`);
  for (const s of an.sample) console.log(`    ${String(s.providerListingId || '?').slice(-8).padEnd(10)} nightly=${fmt(s.normalizedNightlyPrice)} total=${fmt(s.impliedTotal)}`);
  console.log('');
  console.log(`  BOOKING formula: final_price / requestedNights (STAY_TOTAL confirmed B5-BK-F)`);
  console.log(`  BOOKING VERDICT: ${bn.verdict}  medianNightly=${fmt(bn.medianNightly)}`);
  console.log(`  First 10 listings:`);
  for (const s of bn.sample) console.log(`    ${String(s.providerListingId || '?').slice(-8).padEnd(10)} nightly=${fmt(s.normalizedNightlyPrice)} total=${fmt(s.impliedTotal)}`);

  printCommonRadius(audit.commonRadius);

  const sa = audit.selAirbnb; const sb = audit.selBooking;
  console.log('\n  PRODUCTION COMPARABLE SELECTION (selectComparables)');
  console.log('  ' + '─'.repeat(60));
  console.log(`  Airbnb:  status=${sa.status}  radius=${sa.selectedRadiusKm ?? 'null'}km  count=${sa.listings.length}`);
  if (audit.airbnbStats) console.log(`    median=${fmt(audit.airbnbStats.median)} p25=${fmt(audit.airbnbStats.p25)} p75=${fmt(audit.airbnbStats.p75)} occupancy=${audit.airbnbStats.occupancy} tension=${audit.airbnbStats.tensionLevel}`);
  console.log(`  Booking: status=${sb.status}  radius=${sb.selectedRadiusKm ?? 'null'}km  count=${sb.listings.length}`);
  if (audit.bookingStats) console.log(`    median=${fmt(audit.bookingStats.median)} p25=${fmt(audit.bookingStats.p25)} p75=${fmt(audit.bookingStats.p75)} occupancy=null tension=null`);

  printTopComparables(sa.listings, 'AIRBNB');
  printTopComparables(sb.listings, 'BOOKING');

  console.log('\n  SEARCH GEO COVERAGE');
  console.log('  ' + '─'.repeat(40));
  console.log(`  Airbnb:  ${audit.airbnbSearchCoverage}`);
  console.log(`  Booking: ${audit.bookingSearchCoverage}`);

  console.log('\n  PRIMARY ATTRITION REASON');
  console.log('  ' + '─'.repeat(40));
  console.log(`  Airbnb:  ${audit.airbnbAttrition}`);
  console.log(`  Booking: ${audit.bookingAttrition}`);

  console.log('\n  CROSS-SOURCE GEO PROXIMITY (comparables, diagnostic only)');
  console.log('  ' + '─'.repeat(50));
  console.log(`  within_50m=${audit.crossGeo.within50m}  within_100m=${audit.crossGeo.within100m}  within_250m=${audit.crossGeo.within250m}`);
  console.log(`  USED_FOR_DEDUP=NO   USED_FOR_PRICING=NO`);

  printCounterfactuals(audit.counterfactuals);

  const con = audit.aggregation.consensus;
  console.log('\n  AGGREGATION (production)');
  console.log('  ' + '─'.repeat(50));
  if (con) {
    console.log(`  consensusMedian=${fmt(con.median)} divergence=${fmt(con.divergencePct)}% (${con.divergenceLevel}) confidence=${con.confidenceLevel}`);
    console.log(`  weights: airbnb=${fmt(con.weights.airbnb * 100, 1)}%  booking=${fmt(con.weights.booking * 100, 1)}%`);
  } else { console.log('  consensus=null'); }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const best = audit.bestCommonRadius;
  console.log('\n' + '═'.repeat(72));
  console.log('  DIVERGENCE AUDIT VERDICT');
  console.log('─'.repeat(72));
  const airDD = audit.airbnbDistDist || {};
  const bkDD  = audit.bookingDistDist || {};
  console.log(`  AIRBNB_LOCAL_SAMPLE_1KM   = ${airDD.within1km  ?? 'n/a'}`);
  console.log(`  AIRBNB_LOCAL_SAMPLE_3KM   = ${airDD.within3km  ?? 'n/a'}`);
  console.log(`  AIRBNB_LOCAL_SAMPLE_5KM   = ${airDD.within5km  ?? 'n/a'}`);
  console.log(`  BOOKING_LOCAL_SAMPLE_1KM  = ${bkDD.within1km  ?? 'n/a'}`);
  console.log(`  BOOKING_LOCAL_SAMPLE_3KM  = ${bkDD.within3km  ?? 'n/a'}`);
  console.log(`  BOOKING_LOCAL_SAMPLE_5KM  = ${bkDD.within5km  ?? 'n/a'}`);
  console.log(`  AIRBNB_SELECTED_RADIUS    = ${sa.selectedRadiusKm ?? 'null'} km`);
  console.log(`  BOOKING_SELECTED_RADIUS   = ${sb.selectedRadiusKm ?? 'null'} km`);
  console.log(`  AIRBNB_SELECTED_MEDIAN    = ${audit.airbnbStats  ? fmt(audit.airbnbStats.median)  : 'null'}`);
  console.log(`  BOOKING_SELECTED_MEDIAN   = ${audit.bookingStats ? fmt(audit.bookingStats.median) : 'null'}`);
  console.log(`  COMMON_RADIUS_BEST_USABLE = ${best ? best.radiusKm + ' km' : 'none'}`);
  console.log(`  COMMON_RADIUS_AIRBNB_MED  = ${best ? fmt(best.airbnbMedian)  : 'n/a'}`);
  console.log(`  COMMON_RADIUS_BOOKING_MED = ${best ? fmt(best.bookingMedian) : 'n/a'}`);
  console.log(`  COMMON_RADIUS_DIVERGENCE  = ${best ? fmt(best.divergencePct) + '%' : 'n/a'}`);
  console.log(`  AIRBNB_PRIMARY_ATTRITION  = ${audit.airbnbAttrition}`);
  console.log(`  BOOKING_PRIMARY_ATTRITION = ${audit.bookingAttrition}`);
  console.log(`  AIRBNB_SEARCH_GEO_COVERAGE  = ${audit.airbnbSearchCoverage}`);
  console.log(`  BOOKING_SEARCH_GEO_COVERAGE = ${audit.bookingSearchCoverage}`);
  console.log(`  AIRBNB_PRICE_NORMALIZATION  = ${audit.airbnbNormSample.verdict}`);
  console.log(`  BOOKING_PRICE_NORMALIZATION = ${audit.bookingNormSample.verdict}`);
  console.log(`  DIVERGENCE_FACTORS          = [${audit.divFactors.join(', ')}]`);
  console.log(`  REAL_PLATFORM_PRICE_GAP     = ${audit.realPriceGap}`);
  console.log(`  SAFE_TO_USE_FOR_PRICING     = ${audit.safeForPricing ? 'YES' : 'NO'}`);
  console.log('═'.repeat(72) + '\n');

  return audit;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const nameIdx = args.indexOf('--name');
  const name    = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const execute = args.includes('--execute');
  const mlIdx   = args.indexOf('--max-listings');
  const maxListings = mlIdx !== -1 ? parseInt(args[mlIdx + 1], 10) : DEFAULT_MAX;

  if (!name) {
    console.error('Usage: node outils/audit-multisource-divergence.js --name <nom> [--execute] [--max-listings N]');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const opts = { name, maxListings, pool };
  const run = (execute ? executeMode(opts) : previewMode(opts))
    .then(r => { pool.end().catch(() => {}); return r; });

  run.catch(err => {
    const msg  = (err.message || '').toLowerCase();
    const code = (err.code || '').toUpperCase();
    let t = 'FATAL_ERROR';
    if (msg.includes('self-signed') || msg.includes('certificate') || code.includes('SSL')) t = 'DB_TLS_ERROR';
    else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') t = 'DB_CONNECTION_ERROR';
    else if (msg.includes('brightdata') || msg.includes('booking') || msg.includes('airbnb')) t = 'BRIGHTDATA_ERROR';
    console.error(`\n  ❌ ${t}: ${err.message}`);
    pool.end().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  runAudit,
  previewMode,
  executeMode,
  computeQualityPool,
  computeFilterFunnel,
  computeRadiusBands,
  computeDistanceDistribution,
  computeCategoryDistribution,
  computeBedroomDistribution,
  computeCapacityGuestDistribution,
  computeNormalizationSample,
  computeCommonRadiusStats,
  computeDivergencePct,
  computeSearchCoverage,
  computePrimaryAttritionReason,
  computeCrossSourceGeoProximity,
  computeCounterfactuals,
  computeDivergenceFactors,
  computeRealPlatformPriceGap,
  computeSafeForPricing,
  priceStats,
  HARD_MAX_LISTINGS,
  DEFAULT_NIGHTS,
};

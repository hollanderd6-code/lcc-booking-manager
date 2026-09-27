'use strict';
/**
 * P1.2-B5-BK-L3 — Cross-Source Market Diagnostic
 *
 * Pure module — no network, no DB, no Channex.
 *
 * KEY INSIGHT: A source can be NOT eligible for consensus but still eligible
 * for diagnostic. Diagnostic results NEVER modify sourceUsage.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

const {
  haversineKm,
  MIN_COMPARABLES_FALLBACK,
  RADIUS_BANDS_KM,
  calcBrightDataMarketStats,
  calcBrightDataBookingMarketStats,
} = require('./brightdata-comparable-filter');

const {
  buildCrossSourceQualityPool,
  computeCrossSourceDivergenceLevel,
} = require('./market-cross-source-policy');

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Minimum comparables required for a source to be diagnostic-eligible.
 * Uses the same threshold as MIN_COMPARABLES_FALLBACK (5) — do NOT create
 * a separate constant value.
 */
const MIN_DIAGNOSTIC_COMPARABLES = MIN_COMPARABLES_FALLBACK;

// ── computeMarketDiagnosticCrossSource ────────────────────────────────────────

/**
 * Compute a cross-source diagnostic for both Airbnb and Booking.
 *
 * A source excluded from consensus (e.g. Airbnb with UNSTABLE reliability) can
 * still contribute to the diagnostic, which is purely informational.
 *
 * @param {object} opts
 * @param {Array}         opts.airbnbUniqueListings        — quality-filtered unique Airbnb listings
 * @param {Array}         opts.bookingRawListings          — raw Booking.com listings
 * @param {number}        [opts.targetLat]
 * @param {number}        [opts.targetLon]
 * @param {number}        [opts.targetGuests]
 * @param {number}        [opts.targetBedrooms]
 * @param {string}        [opts.targetPropertyType]
 * @param {string}        [opts.today]                    — YYYY-MM-DD
 * @param {object}        [opts.airbnbConsensusEligibility]  — passed-in from K engine
 * @param {object}        [opts.bookingConsensusEligibility] — passed-in from K engine
 *
 * @returns {DiagnosticCrossSourceResult}
 */
function computeMarketDiagnosticCrossSource({
  airbnbUniqueListings      = [],
  bookingRawListings        = [],
  targetLat                 = null,
  targetLon                 = null,
  targetGuests              = null,
  targetBedrooms            = null,
  targetPropertyType        = null,
  today                     = null,
  airbnbConsensusEligibility  = null,
  bookingConsensusEligibility = null,
} = {}) {
  // Step 1: Apply buildCrossSourceQualityPool for each source
  const airbnbQPool  = buildCrossSourceQualityPool(
    airbnbUniqueListings, 'airbnb',
    { targetGuests, targetPropertyType }
  );
  const bookingQPool = buildCrossSourceQualityPool(
    bookingRawListings, 'booking',
    { targetBedrooms, targetPropertyType }
  );

  // Step 2: Evaluate diagnosticEligibility for each source
  const airbnbWithPrice  = airbnbQPool.listings.filter(l => l.price > 0);
  const bookingWithPrice = bookingQPool.listings.filter(l => l.price > 0);

  const airbnbHasGeo  = airbnbQPool.listings.some(
    l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)
  );
  const bookingHasGeo = bookingQPool.listings.some(
    l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)
  );

  const hasTargetGeo = Number.isFinite(targetLat) && Number.isFinite(targetLon);

  function checkEligibility(withPrice, hasGeo, providerName) {
    if (withPrice.length < MIN_DIAGNOSTIC_COMPARABLES) {
      return {
        eligible: false,
        reason:   `insufficient_priced_listings (${withPrice.length} < ${MIN_DIAGNOSTIC_COMPARABLES})`,
      };
    }
    if (hasTargetGeo && !hasGeo) {
      return {
        eligible: false,
        reason:   'no_geo_coordinates_in_listings',
      };
    }
    return { eligible: true, reason: null };
  }

  const airbnbDiagElig  = checkEligibility(airbnbWithPrice, airbnbHasGeo,  'airbnb');
  const bookingDiagElig = checkEligibility(bookingWithPrice, bookingHasGeo, 'booking');

  const diagnosticEligibility = {
    airbnb:  airbnbDiagElig,
    booking: bookingDiagElig,
  };

  // Step 3: Wrap consensusEligibility
  const consensusEligibility = {
    airbnb:  airbnbConsensusEligibility  ?? null,
    booking: bookingConsensusEligibility ?? null,
  };

  // Step 4: If either source not diagnostic-eligible → INSUFFICIENT_DIAGNOSTIC_SOURCE
  if (!airbnbDiagElig.eligible || !bookingDiagElig.eligible) {
    const reason = !airbnbDiagElig.eligible
      ? `airbnb_not_eligible: ${airbnbDiagElig.reason}`
      : `booking_not_eligible: ${bookingDiagElig.reason}`;

    return {
      diagnosticStatus:   'INSUFFICIENT_DIAGNOSTIC_SOURCE',
      commonRadiusKm:     null,
      airbnb:             null,
      booking:            null,
      divergencePct:      null,
      divergenceLevel:    null,
      consensusEligibility,
      diagnosticEligibility,
      reason,
    };
  }

  // Steps 5/6: Find common radius
  // Strip _dist before computing stats (added during distance filtering)
  const strip = ({ _dist, ...l }) => l;  // eslint-disable-line no-unused-vars

  let commonRadiusKm    = null;
  let airbnbFinal       = null;
  let bookingFinal      = null;

  if (hasTargetGeo) {
    // Step 5: With geo — iterate RADIUS_BANDS_KM, find smallest where both ≥ MIN_DIAGNOSTIC_COMPARABLES
    const airbnbGeo  = airbnbQPool.listings
      .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude) && l.price > 0)
      .map(l => ({ ...l, _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude) }));
    const bookingGeo = bookingQPool.listings
      .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude) && l.price > 0)
      .map(l => ({ ...l, _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude) }));

    for (const r of RADIUS_BANDS_KM) {
      const aInR = airbnbGeo.filter(l => l._dist <= r);
      const bInR = bookingGeo.filter(l => l._dist <= r);
      if (aInR.length >= MIN_DIAGNOSTIC_COMPARABLES && bInR.length >= MIN_DIAGNOSTIC_COMPARABLES) {
        commonRadiusKm = r;
        airbnbFinal    = aInR.map(strip);
        bookingFinal   = bInR.map(strip);
        break;
      }
    }
  } else {
    // Step 6: Without geo — use full quality pools if both ≥ MIN_DIAGNOSTIC_COMPARABLES
    const aPool = airbnbQPool.listings.filter(l => l.price > 0);
    const bPool = bookingQPool.listings.filter(l => l.price > 0);
    if (
      aPool.length >= MIN_DIAGNOSTIC_COMPARABLES &&
      bPool.length >= MIN_DIAGNOSTIC_COMPARABLES
    ) {
      airbnbFinal  = aPool;
      bookingFinal = bPool;
    }
  }

  // Step 10 (early return): No common radius found
  if (airbnbFinal === null || bookingFinal === null) {
    return {
      diagnosticStatus:   'INSUFFICIENT_COMMON_MARKET',
      commonRadiusKm:     null,
      airbnb:             null,
      booking:            null,
      divergencePct:      null,
      divergenceLevel:    null,
      consensusEligibility,
      diagnosticEligibility,
      reason:             'no_common_radius_with_min_comparables',
    };
  }

  // Step 7: Compute stats
  const todayStr    = today || new Date().toISOString().slice(0, 10);
  const airbnbStats = calcBrightDataMarketStats(airbnbFinal, { today: todayStr });
  const bkStats     = calcBrightDataBookingMarketStats(bookingFinal);

  const airbnbResult  = airbnbStats
    ? { count: airbnbFinal.length, median: airbnbStats.median, p25: airbnbStats.p25, p75: airbnbStats.p75 }
    : null;
  const bookingResult = bkStats
    ? { count: bookingFinal.length, median: bkStats.median, p25: bkStats.p25, p75: bkStats.p75 }
    : null;

  // Step 8: Compute divergencePct
  const aMedian = airbnbResult?.median   ?? null;
  const bMedian = bookingResult?.median  ?? null;

  let divergencePctVal = null;
  if (
    aMedian != null && bMedian != null &&
    Number.isFinite(aMedian) && Number.isFinite(bMedian) &&
    aMedian > 0 && bMedian > 0
  ) {
    divergencePctVal = Math.round(
      Math.abs(aMedian - bMedian) / ((aMedian + bMedian) / 2) * 100 * 100
    ) / 100;
  }

  // Step 9: divergenceLevel
  const divLevel = computeCrossSourceDivergenceLevel(divergencePctVal);

  return {
    diagnosticStatus:   'DIAGNOSTIC_AVAILABLE',
    commonRadiusKm,
    airbnb:             airbnbResult,
    booking:            bookingResult,
    divergencePct:      divergencePctVal,
    divergenceLevel:    divLevel,
    consensusEligibility,
    diagnosticEligibility,
    reason:             null,
  };
}

module.exports = {
  computeMarketDiagnosticCrossSource,
  MIN_DIAGNOSTIC_COMPARABLES,
};

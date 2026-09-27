'use strict';
/**
 * P1.2-B5-BK-K — Production-Candidate Multi-Source Market Engine (Shadow Mode)
 *
 * Orchestrates: Airbnb pooled J4/J5 + Booking.com + cross-source calibration.
 * SHADOW MODE ONLY — no pricing writes, no DB writes, no Channex calls.
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_PROVIDER_UNCHANGED
 *   PRODUCTION_NOT_ACTIVATED
 *
 * market_status values:
 *   STABLE_DUAL        — both Airbnb (STABLE_LOCAL_POOL) + Booking valid, divergence < EXTREME
 *   EXTREME_DIVERGENCE — both valid, cross-source divergence ≥ 50%
 *   AIRBNB_ONLY        — Airbnb STABLE_LOCAL_POOL, Booking insufficient/excluded
 *   BOOKING_ONLY       — Booking valid, Airbnb not STABLE_LOCAL_POOL
 *   INSUFFICIENT       — neither source provides a usable signal
 *
 * Airbnb may contribute to consensus ONLY when POOLED_RELIABILITY_STATUS === STABLE_LOCAL_POOL.
 * No silent fallback to a single Airbnb snapshot.
 */

const {
  buildAirbnbPooledMarket,
  mergeAndDedup,
} = require('./airbnb-pooled-snapshot-market');

const { computePooledReliabilityGate } = require('./airbnb-pooled-reliability-gate');
const { shouldRequestThirdSnapshot }   = require('./airbnb-multi-snapshot-consensus');

const {
  buildCrossSourceQualityPool,
  selectCommonComparisonRadius,
  computeMetadataScore,
  computeCrossSourceDivergenceLevel,
} = require('./market-cross-source-policy');

const { aggregateMarketSourcesCalibrated } = require('./market-multi-source-aggregator');

const {
  calcBrightDataMarketStats,
  calcBrightDataBookingMarketStats,
  haversineKm,
  MIN_COMPARABLES_FALLBACK,
  RADIUS_BANDS_KM,
} = require('./brightdata-comparable-filter');

const { evaluateSourceGeoQuality }    = require('./market-geo-quality');
const { scrapeWithBrightData }        = require('./providers/brightdata');
const { scrapeWithBrightDataBooking } = require('./providers/brightdata-booking');

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_AIRBNB_BD_CALLS  = 3;
const DEFAULT_MAX_LISTINGS = 100;

// ── Private helpers ───────────────────────────────────────────────────────────

function _divergencePct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return Math.abs(a - b) / ((a + b) / 2) * 100;
}

function _listingsAtRadius(listings, lat, lon, radiusKm) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || radiusKm == null) return listings;
  return listings.filter(l =>
    Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
    haversineKm(lat, lon, l.latitude, l.longitude) <= radiusKm
  );
}

/**
 * Find Booking listings at the smallest radius with ≥ MIN_COMPARABLES_FALLBACK after
 * Booking-specific quality filtering. Returns { listings, radiusKm } or null.
 */
function _selectBookingOwnRadius(rawListings, lat, lon, targetBedrooms, targetPropertyType) {
  const qPool     = buildCrossSourceQualityPool(rawListings, 'booking', {
    targetBedrooms, targetPropertyType,
  });
  const qualified = qPool.listings;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return qualified.length >= MIN_COMPARABLES_FALLBACK
      ? { listings: qualified, radiusKm: null }
      : null;
  }

  for (const r of RADIUS_BANDS_KM) {
    const inR = qualified.filter(l =>
      Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
      haversineKm(lat, lon, l.latitude, l.longitude) <= r
    );
    if (inR.length >= MIN_COMPARABLES_FALLBACK) return { listings: inR, radiusKm: r };
  }
  return null;
}

/**
 * Determine market_status from source availability and cross-source divergence.
 */
function _marketStatus(airbnbValid, bookingValid, divergenceLevel) {
  if (!airbnbValid && !bookingValid) return 'INSUFFICIENT';
  if (airbnbValid  && !bookingValid) return 'AIRBNB_ONLY';
  if (!airbnbValid && bookingValid)  return 'BOOKING_ONLY';
  return divergenceLevel === 'EXTREME' ? 'EXTREME_DIVERGENCE' : 'STABLE_DUAL';
}

function _weightedPct(aVal, bVal, airbnbW, bookingW) {
  if (aVal != null && bVal != null)
    return Math.round((aVal * airbnbW + bVal * bookingW) * 100) / 100;
  return aVal ?? bVal ?? null;
}

// ── runShadowMarketEngine ─────────────────────────────────────────────────────

/**
 * Execute the full K shadow pipeline for a property.
 *
 * @param {object} opts
 * @param {number}   opts.targetLat
 * @param {number}   opts.targetLon
 * @param {number|null} [opts.targetGuests]
 * @param {number|null} [opts.targetBedrooms]
 * @param {string}   [opts.targetPropertyType='entire_place']
 * @param {string}   opts.location           — location string for BD API
 * @param {string}   opts.currency           — ISO 4217
 * @param {string}   opts.checkIn            — YYYY-MM-DD
 * @param {string}   opts.checkOut           — YYYY-MM-DD
 * @param {string}   [opts.today]            — YYYY-MM-DD, for Airbnb occupancy proxy
 * @param {Function} [opts._airbnbScrape]    — injected for tests
 * @param {Function} [opts._bookingScrape]   — injected for tests
 * @param {number}   [opts.maxAirbnbListings=100]
 * @param {number}   [opts.maxBookingListings=100]
 */
async function runShadowMarketEngine(opts = {}) {
  const {
    targetLat,
    targetLon,
    targetGuests       = null,
    targetBedrooms     = null,
    targetPropertyType = 'entire_place',
    location,
    currency,
    checkIn,
    checkOut,
    today              = null,
    _airbnbScrape      = scrapeWithBrightData,
    _bookingScrape     = scrapeWithBrightDataBooking,
    maxAirbnbListings  = DEFAULT_MAX_LISTINGS,
    maxBookingListings = DEFAULT_MAX_LISTINGS,
  } = opts;

  if (!location) throw new Error('runShadowMarketEngine: location requis');
  if (!currency) throw new Error('runShadowMarketEngine: currency requis');
  if (!checkIn)  throw new Error('runShadowMarketEngine: checkIn requis');
  if (!checkOut) throw new Error('runShadowMarketEngine: checkOut requis');

  const exclusionReasons = [];

  // ── Phase 1: Acquire Airbnb (up to 3 snapshots with early-stop) ──────────

  const rawSnapshots     = [];
  const qualitySnapshots = [];
  let earlyStopTriggered = false;
  let actualBdCalls      = 0;

  for (let i = 0; i < MAX_AIRBNB_BD_CALLS; i++) {
    if (i === 2 && qualitySnapshots.length === 2) {
      const earlyCheck = shouldRequestThirdSnapshot(
        qualitySnapshots[0], qualitySnapshots[1], { targetLat, targetLon, today }
      );
      if (!earlyCheck.shouldRequest) { earlyStopTriggered = true; break; }
    }

    const result = await _airbnbScrape(location, maxAirbnbListings, currency, { checkIn, checkOut });
    actualBdCalls++;
    const snapId = result.snapshotId || `airbnb-snap-${i}`;

    if (!result.listings || result.listings.length === 0) {
      rawSnapshots.push({ snapshotId: snapId, listings: [] });
      qualitySnapshots.push({
        snapshotId: snapId,
        listings:   [],
        geoQuality: {
          status: 'UNUSABLE', usableForConsensus: false, geoCoverageScore: 0,
          reason: 'empty_snapshot', localComparableCount: 0, localRadiusKm: null,
          nearestDistanceKm: null, medianDistanceKm: null,
        },
      });
      continue;
    }

    rawSnapshots.push({ snapshotId: snapId, listings: result.listings });
    const qPool = buildCrossSourceQualityPool(result.listings, 'airbnb', {
      targetGuests, targetPropertyType,
    });
    qualitySnapshots.push({
      snapshotId: snapId,
      listings:   qPool.listings,
      geoQuality: evaluateSourceGeoQuality(qPool.listings, targetLat, targetLon),
      _qDiag:     qPool.diagnostics,
    });
  }

  // ── Phase 2: J4 pooled market + J5 reliability gate ──────────────────────

  const airbnbPooled = buildAirbnbPooledMarket(rawSnapshots, {
    targetLat, targetLon, targetGuests, targetPropertyType, today,
  });
  const airbnbGate   = computePooledReliabilityGate(airbnbPooled);
  const airbnbStable = airbnbGate.POOLED_RELIABILITY_STATUS === 'STABLE_LOCAL_POOL';

  if (!airbnbStable) {
    exclusionReasons.push(
      `airbnb_excluded: POOLED_RELIABILITY_STATUS=${airbnbGate.POOLED_RELIABILITY_STATUS}`
    );
  }

  // ── Phase 3: Acquire Booking (1 call) ────────────────────────────────────

  let bookingBdCalls = 0;
  let bookingRaw     = null;
  let bookingErr     = null;

  try {
    bookingRaw = await _bookingScrape(location, maxBookingListings, currency, { checkIn, checkOut });
    bookingBdCalls++;
  } catch (err) {
    bookingErr = err.message || String(err);
    exclusionReasons.push(`booking_scrape_failed: ${bookingErr}`);
  }

  // ── Phase 4: Cross-source analysis ───────────────────────────────────────

  let crossSource             = null;
  let commonRadiusKm          = null;
  let airbnbAtCommonListings  = [];
  let bookingAtCommonListings = [];

  // Unique Airbnb listings (from quality snapshots, merged+deduped) for cross-source
  const { uniqueListings: airbnbUnique } = airbnbStable
    ? mergeAndDedup(qualitySnapshots)
    : { uniqueListings: [] };

  if (airbnbStable && bookingRaw && !bookingErr) {
    crossSource = selectCommonComparisonRadius(
      { listings: airbnbUnique },
      { listings: bookingRaw.listings || [] },
      targetLat, targetLon,
      { targetGuests, targetBedrooms, targetPropertyType },
    );

    if (crossSource.found) {
      commonRadiusKm          = crossSource.radiusKm;
      airbnbAtCommonListings  = crossSource.airbnbListings  || [];
      bookingAtCommonListings = crossSource.bookingListings || [];
    }
  }

  // ── Phase 5: Build per-source descriptors ────────────────────────────────

  let airbnbSource = null;

  if (airbnbStable) {
    // Use common radius listings if found, otherwise Airbnb's own pooled radius
    const useListings = commonRadiusKm != null
      ? airbnbAtCommonListings
      : airbnbPooled.selectedRadiusKm != null
        ? _listingsAtRadius(airbnbUnique, targetLat, targetLon, airbnbPooled.selectedRadiusKm)
        : airbnbUnique;

    if (useListings.length >= MIN_COMPARABLES_FALLBACK) {
      // Use pre-computed J4 pooled stats when using own radius (avoids recomputing occupancy)
      const stats = commonRadiusKm != null
        ? calcBrightDataMarketStats(useListings, today ? { today } : {})
        : airbnbPooled.pooledStats;

      const geoQ  = evaluateSourceGeoQuality(useListings, targetLat, targetLon);
      airbnbSource = {
        stats,
        comparableCount:  useListings.length,
        selectedRadiusKm: commonRadiusKm ?? airbnbPooled.selectedRadiusKm ?? null,
        metadataScore:    computeMetadataScore(useListings, 'airbnb'),
        geoCoverageScore: geoQ.geoCoverageScore,
        geoQuality:       geoQ,
      };
    } else {
      exclusionReasons.push('airbnb_excluded: insufficient_at_radius');
    }
  }

  let bookingSource = null;

  if (bookingRaw && !bookingErr) {
    // Use common-radius listings if available, else find Booking's own best radius
    let bookingListings = bookingAtCommonListings;
    let bookingRadius   = commonRadiusKm;

    if (bookingListings.length < MIN_COMPARABLES_FALLBACK) {
      const own = _selectBookingOwnRadius(
        bookingRaw.listings || [], targetLat, targetLon, targetBedrooms, targetPropertyType
      );
      if (own) {
        bookingListings = own.listings;
        bookingRadius   = own.radiusKm;
      }
    }

    if (bookingListings.length >= MIN_COMPARABLES_FALLBACK) {
      const stats = calcBrightDataBookingMarketStats(bookingListings);
      if (stats && stats.median > 0) {
        const geoQ  = evaluateSourceGeoQuality(bookingListings, targetLat, targetLon);
        bookingSource = {
          stats,
          comparableCount:  bookingListings.length,
          selectedRadiusKm: bookingRadius,
          metadataScore:    computeMetadataScore(bookingListings, 'booking'),
          geoCoverageScore: geoQ.geoCoverageScore,
          geoQuality:       geoQ,
        };
      } else {
        exclusionReasons.push('booking_excluded: invalid_stats');
      }
    } else {
      exclusionReasons.push(
        `booking_excluded: insufficient_comparables (${bookingListings.length})`
      );
    }
  }

  // ── Phase 6: Aggregate + market signal ───────────────────────────────────

  const aggregation = aggregateMarketSourcesCalibrated({
    airbnb:        airbnbSource,
    booking:       bookingSource,
    commonRadiusKm,
  });

  const consensus = aggregation.consensus;
  const signal    = aggregation.marketSignal;

  // Cross-source divergence (only valid when both are at common radius)
  const airbnbAtCommonMedian  = commonRadiusKm != null
    ? (airbnbSource?.stats?.median ?? null)
    : null;
  const bookingAtCommonMedian = (commonRadiusKm != null && bookingAtCommonListings.length >= MIN_COMPARABLES_FALLBACK)
    ? (bookingSource?.stats?.median ?? null)
    : null;

  const crossDivPct   = _divergencePct(airbnbAtCommonMedian, bookingAtCommonMedian);
  const crossDivLevel = computeCrossSourceDivergenceLevel(crossDivPct);

  const airbnbValid  = !!(airbnbSource  && aggregation.sourceUsage?.airbnb?.included);
  const bookingValid = !!(bookingSource && aggregation.sourceUsage?.booking?.included);
  const marketSt     = _marketStatus(airbnbValid, bookingValid, crossDivLevel);

  // Weighted P25/P75 for consensus output
  const airbnbW    = consensus?.weights?.airbnb  ?? 0;
  const bookingW   = consensus?.weights?.booking ?? 0;
  const consP25    = _weightedPct(airbnbSource?.stats?.p25, bookingSource?.stats?.p25, airbnbW, bookingW);
  const consP75    = _weightedPct(airbnbSource?.stats?.p75, bookingSource?.stats?.p75, airbnbW, bookingW);

  // ── Assemble result ───────────────────────────────────────────────────────

  return {
    market_status: marketSt,

    AIRBNB_POOL_STATUS:        airbnbPooled.status,
    AIRBNB_POOL_RADIUS_KM:     airbnbPooled.selectedRadiusKm   ?? null,
    AIRBNB_POOL_COUNT:         airbnbPooled.comparableCount     ?? 0,
    AIRBNB_POOL_MEDIAN:        airbnbPooled.pooledStats?.median ?? null,
    AIRBNB_POOL_P25:           airbnbPooled.pooledStats?.p25    ?? null,
    AIRBNB_POOL_P75:           airbnbPooled.pooledStats?.p75    ?? null,
    AIRBNB_RELIABILITY_STATUS: airbnbGate.POOLED_RELIABILITY_STATUS,

    BOOKING_RADIUS_KM: bookingSource?.selectedRadiusKm ?? null,
    BOOKING_COUNT:     bookingSource?.comparableCount  ?? 0,
    BOOKING_MEDIAN:    bookingSource?.stats?.median    ?? null,
    BOOKING_P25:       bookingSource?.stats?.p25       ?? null,
    BOOKING_P75:       bookingSource?.stats?.p75       ?? null,

    CROSS_SOURCE_COMMON_RADIUS_KM:   commonRadiusKm,
    AIRBNB_AT_COMMON_RADIUS_COUNT:   airbnbAtCommonListings.length,
    BOOKING_AT_COMMON_RADIUS_COUNT:  bookingAtCommonListings.length,
    AIRBNB_AT_COMMON_RADIUS_MEDIAN:  airbnbAtCommonMedian,
    BOOKING_AT_COMMON_RADIUS_MEDIAN: bookingAtCommonMedian,
    CROSS_SOURCE_DIVERGENCE_PCT:     crossDivPct != null
      ? Math.round(crossDivPct * 100) / 100 : null,
    CROSS_SOURCE_DIVERGENCE_LEVEL:   crossDivLevel ?? null,

    MARKET_CONSENSUS_MEDIAN:     consensus?.median ?? null,
    MARKET_CONSENSUS_P25:        consP25,
    MARKET_CONSENSUS_P75:        consP75,
    MARKET_CONFIDENCE:           consensus?.confidenceLevel ?? 'INSUFFICIENT',
    MARKET_SOURCE_USAGE:         aggregation.sourceUsage,
    MARKET_EXCLUSION_REASONS:    exclusionReasons,

    OCCUPANCY_SIGNAL_SOURCE: signal.source,
    OCCUPANCY_SIGNAL:        signal.occupancy,
    OCCUPANCY_SEMANTICS:     signal.occupancy_semantics,

    actualBdCalls,
    earlyStopTriggered,
    bookingBdCalls,

    _airbnbPooled:  airbnbPooled,
    _airbnbGate:    airbnbGate,
    _airbnbUnique:  airbnbUnique,
    _bookingRaw:    bookingRaw,
    _crossSource:   crossSource,
    _aggregation:   aggregation,
    _airbnbSource:  airbnbSource,
    _bookingSource: bookingSource,
  };
}

module.exports = {
  runShadowMarketEngine,
  // Exported for tests
  _marketStatus,
  _divergencePct,
  _weightedPct,
};

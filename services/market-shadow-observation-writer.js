'use strict';
/**
 * P1.2-B5-BK-P1 — Shadow Observation Writer
 *
 * Converts K-engine results into market_observations rows.
 * Calls createObservationComplete() for each provider and the consensus.
 *
 * SAFETY:
 *   DB_WRITES              = shadow tables ONLY — production pricing tables never touched
 *   PRICING_WRITES         = 0  always
 *   OTA_CALLS              = 0  always
 *   NETWORK_CALLS          = 0  pure DB writes
 *   SAFE_TO_ACTIVATE_PRODUCTION = NO
 *   MARKET_DATA_WRITES     = 0  always
 */

const {
  createObservationComplete,
} = require('./market-observation-repository');

// ── buildComparables ──────────────────────────────────────────────────────────

/**
 * Map NormalizedListing[] from the K engine to comparable insert objects.
 *
 * @param {object[]} listings  — NormalizedListing array from K engine
 * @param {string}   provider  — 'airbnb' | 'booking'
 * @returns {object[]}
 */
function buildComparables(listings, provider) {
  if (!Array.isArray(listings) || listings.length === 0) return [];
  return listings.map(l => ({
    provider_listing_id:  l.providerListingId  ?? null,
    provider,
    latitude:             l.latitude           ?? null,
    longitude:            l.longitude          ?? null,
    distance_km:          l._dist              ?? null,
    nightly_price:        l.price              ?? null,
    currency:             null, // stored on the observation; null here avoids duplication
    guests_capacity:      l.guests             ?? null,
    bedrooms:             l.bedrooms           ?? null,
    property_type:        l.category           ?? null,
    rating:               l.stars              ?? null,
    review_count:         null,
    availability_signal:  l.isBooked === true ? 'booked'
                          : l.isBooked === false ? 'available'
                          : null,
    normalization_meta:   null,
  }));
}

// ── buildProviderObservationData ──────────────────────────────────────────────

/**
 * Build the observation data object for one provider (airbnb or booking).
 *
 * @param {object} opts
 * @param {string}   opts.provider         — 'airbnb' | 'booking'
 * @param {object}   opts.source           — _airbnbSource or _bookingSource from K result
 * @param {string}   opts.fingerprint      — per-provider search fingerprint
 * @param {string}   opts.profileId
 * @param {string}   opts.collectionRunId
 * @param {string}   opts.checkIn
 * @param {string}   opts.checkOut
 * @param {number}   opts.nights
 * @param {string}   opts.currency
 * @param {string|null} opts.targetLat
 * @param {string|null} opts.targetLon
 * @param {number|null} opts.targetGuests
 * @param {number|null} opts.targetBedrooms
 * @param {string}   opts.targetPropertyType
 * @param {number}   opts.maxListings
 * @param {string}   opts.collectedAt
 * @param {string|null} opts.algorithmVersion
 * @returns {object|null}   null when source is absent
 */
function buildProviderObservationData(opts) {
  const {
    provider, source, fingerprint, profileId, collectionRunId,
    checkIn, checkOut, nights, currency, targetLat, targetLon,
    targetGuests, targetBedrooms, targetPropertyType,
    maxListings, collectedAt, algorithmVersion,
  } = opts;

  if (!source) return null;

  const stats = source.stats || {};
  const dataSource = provider === 'airbnb' ? 'brightdata_live' : 'brightdata_booking_live';

  return {
    schema_version:         1,
    provider,
    observation_type:       'PROVIDER',
    provider_snapshot_id:   null,
    data_source:            dataSource,
    collected_at:           collectedAt,
    search_fingerprint:     fingerprint,
    market_profile_id:      profileId,
    currency,
    check_in:               checkIn  ?? null,
    check_out:              checkOut ?? null,
    nights:                 nights   ?? null,
    target_lat:             targetLat   != null ? String(targetLat)   : null,
    target_lon:             targetLon   != null ? String(targetLon)   : null,
    target_guests:          targetGuests     ?? null,
    target_bedrooms:        targetBedrooms   ?? null,
    target_property_type:   targetPropertyType ?? 'entire_place',
    requested_max_listings: maxListings ?? null,
    raw_count:              source.comparableCount ?? null,
    accepted_count:         source.comparableCount ?? null,
    comparable_count:       source.comparableCount ?? null,
    selected_radius_km:     source.selectedRadiusKm ?? null,
    median_price:           stats.median ?? null,
    p25_price:              stats.p25    ?? null,
    p75_price:              stats.p75    ?? null,
    min_price:              stats.min    ?? null,
    max_price:              stats.max    ?? null,
    quality_status:         source.geoQuality?.status ?? null,
    confidence:             null,
    reliability_status:     null,
    algorithm_version:      algorithmVersion ?? null,
    collection_run_id:      collectionRunId,
    provenance:             {
      metadataScore:    source.metadataScore    ?? null,
      geoCoverageScore: source.geoCoverageScore ?? null,
    },
  };
}

// ── buildConsensusObservationData ─────────────────────────────────────────────

/**
 * Build the observation data object for a DERIVED_CONSENSUS row.
 *
 * @param {object} opts
 * @param {object}   opts.kResult           — full K engine result
 * @param {string}   opts.fingerprintConsensus
 * @param {string}   opts.profileId
 * @param {string}   opts.collectionRunId
 * @param {string}   opts.checkIn
 * @param {string}   opts.checkOut
 * @param {number}   opts.nights
 * @param {string}   opts.currency
 * @param {string|null} opts.targetLat
 * @param {string|null} opts.targetLon
 * @param {number|null} opts.targetGuests
 * @param {number|null} opts.targetBedrooms
 * @param {string}   opts.targetPropertyType
 * @param {number}   opts.maxListings
 * @param {string}   opts.collectedAt
 * @param {string|null} opts.algorithmVersion
 * @returns {object}
 */
function buildConsensusObservationData(opts) {
  const {
    kResult, fingerprintConsensus, profileId, collectionRunId,
    checkIn, checkOut, nights, currency, targetLat, targetLon,
    targetGuests, targetBedrooms, targetPropertyType,
    maxListings, collectedAt, algorithmVersion,
  } = opts;

  const airbnbCount  = kResult.AIRBNB_POOL_COUNT  ?? 0;
  const bookingCount = kResult.BOOKING_COUNT       ?? 0;

  return {
    schema_version:         1,
    provider:               'consensus',
    observation_type:       'DERIVED_CONSENSUS',
    provider_snapshot_id:   null,
    data_source:            'consensus',
    collected_at:           collectedAt,
    search_fingerprint:     fingerprintConsensus,
    market_profile_id:      profileId,
    currency,
    check_in:               checkIn  ?? null,
    check_out:              checkOut ?? null,
    nights:                 nights   ?? null,
    target_lat:             targetLat   != null ? String(targetLat)   : null,
    target_lon:             targetLon   != null ? String(targetLon)   : null,
    target_guests:          targetGuests     ?? null,
    target_bedrooms:        targetBedrooms   ?? null,
    target_property_type:   targetPropertyType ?? 'entire_place',
    requested_max_listings: maxListings ?? null,
    raw_count:              airbnbCount + bookingCount,
    accepted_count:         airbnbCount + bookingCount,
    comparable_count:       null,
    selected_radius_km:     kResult.CROSS_SOURCE_COMMON_RADIUS_KM ?? null,
    median_price:           kResult.MARKET_CONSENSUS_MEDIAN ?? null,
    p25_price:              kResult.MARKET_CONSENSUS_P25    ?? null,
    p75_price:              kResult.MARKET_CONSENSUS_P75    ?? null,
    min_price:              null,
    max_price:              null,
    quality_status:         kResult.market_status ?? null,
    confidence:             kResult.MARKET_CONFIDENCE ?? null,
    reliability_status:     kResult.AIRBNB_RELIABILITY_STATUS ?? null,
    algorithm_version:      algorithmVersion ?? null,
    collection_run_id:      collectionRunId,
    provenance:             {
      market_status:     kResult.market_status,
      sourceUsage:       kResult.MARKET_SOURCE_USAGE       ?? null,
      exclusionReasons:  kResult.MARKET_EXCLUSION_REASONS  ?? [],
      divergencePct:     kResult.CROSS_SOURCE_DIVERGENCE_PCT   ?? null,
      divergenceLevel:   kResult.CROSS_SOURCE_DIVERGENCE_LEVEL ?? null,
    },
  };
}

// ── writeShadowObservations ───────────────────────────────────────────────────

/**
 * Persist K engine results as shadow observations (up to 3 rows).
 *
 * Order:
 *   1. Airbnb PROVIDER observation  (if K produced airbnb data)
 *   2. Booking PROVIDER observation (if K produced booking data)
 *   3. Consensus DERIVED_CONSENSUS  (always; source links to 1+2)
 *
 * Each call is transactional via createObservationComplete.
 * Idempotent: same (collection_run_id, fingerprint) pair returns existing row.
 *
 * @param {object} pool
 * @param {object} opts
 * @param {object}      opts.kResult
 * @param {string}      opts.profileId
 * @param {string}      opts.collectionRunId
 * @param {string}      opts.checkIn
 * @param {string}      opts.checkOut
 * @param {number}      opts.nights
 * @param {string}      opts.currency
 * @param {string|null} opts.targetLat
 * @param {string|null} opts.targetLon
 * @param {number|null} [opts.targetGuests]
 * @param {number|null} [opts.targetBedrooms]
 * @param {string}      [opts.targetPropertyType='entire_place']
 * @param {number}      [opts.maxListings=100]
 * @param {string}      [opts.collectedAt]
 * @param {Array}       [opts.propertyLinks]
 * @param {string|null} [opts.algorithmVersion]
 * @param {string|null} opts.fingerprintAirbnb
 * @param {string|null} opts.fingerprintBooking
 * @param {string|null} opts.fingerprintConsensus
 *
 * @returns {Promise<{
 *   airbnbObsId:    string|null,
 *   bookingObsId:   string|null,
 *   consensusObsId: string|null,
 *   written:        boolean,
 * }>}
 */
async function writeShadowObservations(pool, {
  kResult,
  profileId,
  collectionRunId,
  checkIn,
  checkOut,
  nights,
  currency,
  targetLat,
  targetLon,
  targetGuests       = null,
  targetBedrooms     = null,
  targetPropertyType = 'entire_place',
  maxListings        = 100,
  collectedAt,
  propertyLinks      = [],
  algorithmVersion   = null,
  fingerprintAirbnb     = null,
  fingerprintBooking    = null,
  fingerprintConsensus  = null,
}) {
  const at = collectedAt || new Date().toISOString();

  const base = {
    profileId, collectionRunId,
    checkIn, checkOut, nights, currency,
    targetLat, targetLon, targetGuests, targetBedrooms, targetPropertyType,
    maxListings, collectedAt: at, algorithmVersion,
  };

  let airbnbObsId    = null;
  let bookingObsId   = null;
  let consensusObsId = null;

  // ── 1. Airbnb PROVIDER observation ─────────────────────────────────────────
  if (kResult._airbnbSource && fingerprintAirbnb) {
    const obsData = buildProviderObservationData({
      ...base,
      provider:    'airbnb',
      source:      kResult._airbnbSource,
      fingerprint: fingerprintAirbnb,
    });
    if (obsData) {
      // Use deduplicated quality listings; _dist absent here (no single-radius filter applied)
      const airbnbListings = Array.isArray(kResult._airbnbUnique) ? kResult._airbnbUnique : [];
      const comparables    = buildComparables(airbnbListings, 'airbnb');
      const r = await createObservationComplete(pool, {
        observation:  obsData,
        propertyLinks,
        comparables,
        sourceLinks:  [],
      });
      airbnbObsId = r.observation_id;
    }
  }

  // ── 2. Booking PROVIDER observation ────────────────────────────────────────
  if (kResult._bookingSource && fingerprintBooking) {
    const obsData = buildProviderObservationData({
      ...base,
      provider:    'booking',
      source:      kResult._bookingSource,
      fingerprint: fingerprintBooking,
    });
    if (obsData) {
      const bookingListings = kResult._bookingRaw?.listings ?? [];
      const comparables     = buildComparables(bookingListings, 'booking');
      const r = await createObservationComplete(pool, {
        observation:  obsData,
        propertyLinks,
        comparables,
        sourceLinks:  [],
      });
      bookingObsId = r.observation_id;
    }
  }

  // ── 3. Consensus DERIVED_CONSENSUS observation ──────────────────────────────
  if (fingerprintConsensus) {
    const obsData = buildConsensusObservationData({
      ...base,
      kResult,
      fingerprintConsensus,
    });
    const sourceLinks = [airbnbObsId, bookingObsId].filter(Boolean);
    const r = await createObservationComplete(pool, {
      observation:  obsData,
      propertyLinks,
      comparables:  [],
      sourceLinks,
    });
    consensusObsId = r.observation_id;
  }

  return {
    airbnbObsId,
    bookingObsId,
    consensusObsId,
    written: !!(airbnbObsId || bookingObsId || consensusObsId),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  buildComparables,
  buildProviderObservationData,
  buildConsensusObservationData,
  writeShadowObservations,
};

'use strict';
/**
 * P1.2-B5-BK-R — Market Observation Persistence Bridge
 *
 * Persists production Airbnb scrape evidence as shadow observations
 * WITHOUT making additional provider calls (0 extra BD credits).
 *
 * Architecture:
 *   Production cron already collected listings[] + marketStats.
 *   Bridge takes that in-memory evidence and writes it to market_observations.
 *   No K engine, no Bright Data, no Booking provider — pure DB write.
 *
 * SAFETY:
 *   DB_WRITES              = shadow tables ONLY (market_observations, market_profiles, etc.)
 *   MARKET_DATA_WRITES     = 0  always — production pricing table never touched
 *   PRICING_WRITES         = 0  always
 *   BRIGHT_DATA_CALLS      = 0  always
 *   BOOKING_PROVIDER_CALLS = 0  always
 *   OTA_CALLS              = 0  always
 *   CHANNEX_CALLS          = 0  always
 *
 * Activation:
 *   MARKET_OBSERVATION_PERSISTENCE_ENABLED = 'true'
 *   (MARKET_SHARED_COLLECTION_ENABLED is NOT required)
 *
 * Failure isolation (R7):
 *   bridgePersistProductionEvidence NEVER throws.
 *   All errors are caught and logged with [OBS_PERSIST_FAILURE].
 *   The production pricing path is never affected by bridge failures.
 *
 * Idempotency (R8):
 *   Same (collectionRunId, fingerprint) pair → returns existing obsId.
 *   For M6/M7 shared profiles: second property link is attached via
 *   attachObservationToProperties even when the observation already exists.
 *
 * Observability (R12):
 *   [OBS_PERSIST_ATTEMPT]               — bridge was called
 *   [OBS_PERSIST_SUCCESS]               — new observation written
 *   [OBS_PERSIST_REUSED]                — idempotent: link attached to existing obs
 *   [OBS_PERSIST_SKIPPED_MOCK]          — dataSource=mock, no real evidence
 *   [OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE] — Ti Junot: null geo or invalid profile
 *   [OBS_PERSIST_FAILURE]               — exception caught, never propagated
 */

const { randomUUID } = require('crypto');

const { buildMarketProfileIdentity, buildMarketSearchFingerprint } = require('./market-search-identity');
const { hasValidCoordinates } = require('./market-geo-validator');
const {
  upsertMarketProfile,
  assignCurrentProfile,
  createObservationComplete,
  attachObservationToProperties,
} = require('./market-observation-repository');
const { buildComparables } = require('./market-shadow-observation-writer');

// ── Feature flag ──────────────────────────────────────────────────────────────

/**
 * Returns true when the persistence bridge is enabled.
 *
 * Controlled by MARKET_OBSERVATION_PERSISTENCE_ENABLED alone.
 * MARKET_SHARED_COLLECTION_ENABLED is NOT required (R4).
 */
function isPersistenceEnabled() {
  return process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED === 'true';
}

// ── Bridge run ID ─────────────────────────────────────────────────────────────

/**
 * Generate a bridge run ID for a logical pricing cron invocation.
 *
 * Use 'brun_' prefix to distinguish from 'crun_' shadow collection runs.
 * Generate ONCE per job run; pass explicitly to every bridge call.
 */
function generateBridgeRunId() {
  return `brun_${randomUUID()}`;
}

// ── DataSource → provider mapping ────────────────────────────────────────────

/**
 * Map a production dataSource string to the canonical provider.
 * Returns null for mock (no real evidence to persist) or unknown sources.
 *
 * @param {string|undefined} dataSource
 * @returns {'airbnb'|'booking'|null}
 */
function mapDataSourceToProvider(dataSource) {
  switch (dataSource) {
    case 'brightdata_live':         return 'airbnb';
    case 'apify_live':              return 'airbnb';
    case 'apify':                   return 'airbnb';
    case 'brightdata_booking_live': return 'booking';
    case 'mock':                    return null;
    default:                        return null;
  }
}

// ── Observation builder ───────────────────────────────────────────────────────

/**
 * Build observation data from production marketStats (no K engine needed).
 * Sets bridge:true in provenance to distinguish from shadow coordinator writes.
 *
 * @param {object} opts
 * @returns {object}  — observation data for createObservationComplete
 */
function buildBridgeObservationData({
  provider,
  dataSource,
  fingerprint,
  profileId,
  collectionRunId,
  checkIn,
  checkOut,
  currency,
  targetLat,
  targetLon,
  targetGuests,
  targetBedrooms,
  targetPropertyType,
  marketStats,
  collectedAt,
}) {
  const sel    = (marketStats && marketStats._bdSelectionDiag) || {};
  const nights = (checkIn && checkOut)
    ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
    : null;

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
    nights,
    target_lat:             targetLat  != null ? String(targetLat)  : null,
    target_lon:             targetLon  != null ? String(targetLon)  : null,
    target_guests:          targetGuests   ?? null,
    target_bedrooms:        targetBedrooms ?? null,
    target_property_type:   targetPropertyType ?? 'entire_place',
    requested_max_listings: null,
    raw_count:              (marketStats && marketStats.count)            ?? null,
    accepted_count:         (marketStats && marketStats.count)            ?? null,
    comparable_count:       sel.comparableCount ?? (marketStats && marketStats.count) ?? null,
    selected_radius_km:     sel.selectedRadiusKm                         ?? null,
    median_price:           (marketStats && marketStats.median)           ?? null,
    p25_price:              (marketStats && marketStats.p25)              ?? null,
    p75_price:              (marketStats && marketStats.p75)              ?? null,
    min_price:              null,
    max_price:              null,
    quality_status:         null,
    confidence:             null,
    reliability_status:     null,
    algorithm_version:      null,
    collection_run_id:      collectionRunId,
    provenance: {
      bridge:       true,
      tensionLevel: (marketStats && marketStats.tensionLevel) ?? null,
    },
  };
}

// ── Main bridge function ──────────────────────────────────────────────────────

/**
 * Persist production scrape evidence as a shadow observation.
 *
 * Call this fire-and-forget after writeScrapeResult() confirms
 * writeResult.written === true (the production pricing write succeeded).
 *
 * NEVER throws — all errors are caught and logged (R7).
 *
 * @param {object} pool
 * @param {object} opts
 * @param {object}    opts.cfg              — property config (lat, lon, currency, etc.)
 * @param {object[]}  opts.listings         — NormalizedListing[] from the production scrape
 * @param {object}    opts.marketStats      — { median, p25, p75, count, _bdSelectionDiag }
 * @param {string}    opts.dataSource       — production data source string
 * @param {string}    opts.collectionRunId  — bridge run ID (brun_<uuid>)
 * @param {string}    opts.checkIn          — YYYY-MM-DD
 * @param {string}    opts.checkOut         — YYYY-MM-DD
 * @param {Array}     [opts.propertyLinks]  — [{ property_id, user_id }]
 *
 * @returns {Promise<{ status: 'written'|'reused'|'skipped'|'error', reason: string|null, obsId: string|null }>}
 */
async function bridgePersistProductionEvidence(pool, {
  cfg,
  listings,
  marketStats,
  dataSource,
  collectionRunId,
  checkIn,
  checkOut,
  propertyLinks = [],
}) {
  const pid = cfg && cfg.property_id != null ? String(cfg.property_id) : '?';
  console.log(`[OBS_PERSIST_ATTEMPT] property=${pid} source=${dataSource}`);

  try {
    // ── Skip mock — no real evidence ─────────────────────────────────────────
    const provider = mapDataSourceToProvider(dataSource);
    if (!provider) {
      console.log(`[OBS_PERSIST_SKIPPED_MOCK] property=${pid} dataSource=${dataSource}`);
      return { status: 'skipped', reason: 'mock_source', obsId: null };
    }

    // ── Profile completeness guard (R6: Ti Junot) ────────────────────────────
    if (!cfg || !hasValidCoordinates(cfg.latitude, cfg.longitude) || !cfg.currency) {
      console.log(`[OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE] property=${pid} reason=missing_geo_or_currency`);
      return { status: 'skipped', reason: 'profile_incomplete', obsId: null };
    }

    const identity = buildMarketProfileIdentity({
      latitude:           cfg.latitude,
      longitude:          cfg.longitude,
      currency:           cfg.currency,
      targetGuests:       cfg.max_guests    ?? null,
      targetBedrooms:     cfg.bedrooms      ?? null,
      targetPropertyType: cfg.property_type ?? null,
    });

    if (!identity.valid) {
      console.log(`[OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE] property=${pid} reason=${identity.reason}`);
      return { status: 'skipped', reason: `invalid_profile:${identity.reason}`, obsId: null };
    }

    const { profileId, dimensions } = identity;

    // ── Fingerprint ──────────────────────────────────────────────────────────
    const fpResult = buildMarketSearchFingerprint({
      latitude:           cfg.latitude,
      longitude:          cfg.longitude,
      currency:           cfg.currency,
      targetGuests:       dimensions.guests,
      targetBedrooms:     dimensions.bedrooms,
      targetPropertyType: dimensions.propType,
      checkIn,
      checkOut,
      maxListings:        100,
      provider,
    });

    if (!fpResult.valid) {
      console.log(`[OBS_PERSIST_SKIPPED_PROFILE_INCOMPLETE] property=${pid} reason=invalid_fingerprint:${fpResult.reason}`);
      return { status: 'skipped', reason: `invalid_fingerprint:${fpResult.reason}`, obsId: null };
    }

    // ── Upsert profile + assign current profile ──────────────────────────────
    await upsertMarketProfile(pool, profileId, dimensions);
    for (const link of propertyLinks) {
      if (link.property_id) {
        await assignCurrentProfile(pool, profileId, link.property_id, link.user_id ?? null);
      }
    }

    // ── Build + write observation ────────────────────────────────────────────
    const collectedAt = new Date().toISOString();
    const obsData = buildBridgeObservationData({
      provider,
      dataSource,
      fingerprint:        fpResult.fingerprint,
      profileId,
      collectionRunId,
      checkIn,
      checkOut,
      currency:           cfg.currency,
      targetLat:          dimensions.lat,
      targetLon:          dimensions.lon,
      targetGuests:       dimensions.guests,
      targetBedrooms:     dimensions.bedrooms,
      targetPropertyType: dimensions.propType,
      marketStats,
      collectedAt,
    });

    const comparables = buildComparables(Array.isArray(listings) ? listings : [], provider);

    const result = await createObservationComplete(pool, {
      observation:  obsData,
      propertyLinks,
      comparables,
      sourceLinks:  [],
    });

    if (!result.created) {
      // R8 idempotency: observation already exists for this run+fingerprint.
      // R5 M6/M7: attach this property's link even though the obs was created by a sibling.
      if (propertyLinks.length > 0) {
        await attachObservationToProperties(pool, result.observation_id, propertyLinks);
      }
      console.log(`[OBS_PERSIST_REUSED] property=${pid} obsId=${result.observation_id}`);
      return { status: 'reused', reason: 'idempotent', obsId: result.observation_id };
    }

    console.log(`[OBS_PERSIST_SUCCESS] property=${pid} obsId=${result.observation_id} provider=${provider}`);
    return { status: 'written', reason: null, obsId: result.observation_id };

  } catch (err) {
    // R7: NEVER propagate — bridge failure must never affect production pricing
    console.error(`[OBS_PERSIST_FAILURE] property=${pid} error=${err.message}`);
    return { status: 'error', reason: err.message, obsId: null };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  isPersistenceEnabled,
  generateBridgeRunId,
  mapDataSourceToProvider,
  buildBridgeObservationData,
  bridgePersistProductionEvidence,
};

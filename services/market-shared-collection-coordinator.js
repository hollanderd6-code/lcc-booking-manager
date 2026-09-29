'use strict';
/**
 * P1.2-B5-BK-P3 — Market Shared Collection Coordinator
 *
 * Orchestrates shadow market observation collection:
 *   P3  — one coordinator per logical market profile
 *   P4  — single-flight (in-process duplicate protection)
 *   P5  — persisted observation reuse (skip re-collection when fresh enough)
 *   P6  — collection_run_id generation
 *   P13 — property data completeness (fail-closed on missing lat/lon/currency)
 *
 * SAFETY:
 *   MARKET_DATA_WRITES     = 0  always — never touches production pricing tables
 *   PRICING_WRITES         = 0  always
 *   OTA_CALLS              = 0  always
 *   SAFE_TO_ACTIVATE_PRODUCTION = NO
 *
 *   This module is only activated when BOTH feature flags are 'true':
 *     MARKET_SHARED_COLLECTION_ENABLED
 *     MARKET_OBSERVATION_PERSISTENCE_ENABLED
 *
 *   Both flags default to OFF — no BD credits consumed unless explicitly enabled.
 *   LIVE_BRIGHT_DATA_CALLS = 0  during P development (flags are OFF)
 */

const {
  buildMarketProfileIdentity,
  buildMarketSearchFingerprint,
} = require('./market-search-identity');

const {
  upsertMarketProfile,
  assignCurrentProfile,
  findReusableObservation,
} = require('./market-observation-repository');

const { writeShadowObservations } = require('./market-shadow-observation-writer');

const { runShadowMarketEngine }   = require('./market-engine-shadow-k');
const { scrapeWithBrightData }    = require('./providers/brightdata');
const { scrapeWithBrightDataBooking } = require('./providers/brightdata-booking');

// ── P4: Single-flight in-process deduplication ───────────────────────────────
// Keyed by consensus fingerprint — prevents concurrent duplicate collection
// for the same market profile + stay window + currency.
const _inflight = new Map();

// ── P5: Reuse TTL ─────────────────────────────────────────────────────────────
const DEFAULT_REUSE_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

// ── P6: Collection run ID ─────────────────────────────────────────────────────

/**
 * Generate a deterministic collection run ID from a date.
 * Slots: 0=00–05h UTC, 1=06–11h, 2=12–17h, 3=18–23h.
 *
 * Same cron invocation always produces the same run ID within its 6-hour slot,
 * so retries within a slot are treated as the same collection run.
 *
 * @param {Date} [date]
 * @returns {string}  e.g. 'crun_2026-09-29_s1'
 */
function generateCollectionRunId(date = new Date()) {
  const d    = date instanceof Date ? date : new Date(date);
  const ds   = d.toISOString().slice(0, 10); // YYYY-MM-DD
  const slot = Math.floor(d.getUTCHours() / 6);
  return `crun_${ds}_s${slot}`;
}

// ── P13: Property completeness guard ─────────────────────────────────────────

/**
 * Validate that a property config has all required dimensions for collection.
 * Fails closed: any missing dimension → skip, do not collect.
 *
 * @param {object} cfg     — property config (from pricing_config + properties JOIN)
 * @returns {{ ok: boolean, reason: string|null }}
 */
function validatePropertyCompleteness(cfg) {
  if (cfg.latitude == null || cfg.longitude == null) {
    return { ok: false, reason: 'missing_geo' };
  }
  const lat = parseFloat(cfg.latitude);
  const lon = parseFloat(cfg.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, reason: 'invalid_lat' };
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { ok: false, reason: 'invalid_lon' };
  }
  if (!cfg.currency || typeof cfg.currency !== 'string' || !/^[A-Z]{3}$/.test(cfg.currency.trim().toUpperCase())) {
    return { ok: false, reason: 'missing_currency' };
  }
  return { ok: true, reason: null };
}

// ── Internal collection runner ────────────────────────────────────────────────

async function _runCollection(pool, {
  profileId,
  dimensions,
  location,
  checkIn,
  checkOut,
  nights,
  collectionRunId,
  maxListings,
  propertyLinks,
  fingerprintAirbnb,
  fingerprintBooking,
  fingerprintConsensus,
  algorithmVersion,
  _airbnbScrape,
  _bookingScrape,
}) {
  const collectedAt = new Date().toISOString();

  // P7–P9: Run K engine — failure of one provider does NOT abort the other
  let kResult;
  try {
    kResult = await runShadowMarketEngine({
      targetLat:          parseFloat(dimensions.lat),
      targetLon:          parseFloat(dimensions.lon),
      targetGuests:       dimensions.guests,
      targetBedrooms:     dimensions.bedrooms,
      targetPropertyType: dimensions.propType,
      location,
      currency:           dimensions.currency,
      checkIn,
      checkOut,
      maxAirbnbListings:  maxListings,
      maxBookingListings: maxListings,
      _airbnbScrape,
      _bookingScrape,
    });
  } catch (err) {
    // P10: Total engine failure — log and surface; do not write partial data
    console.error('[P-COORD] K engine failure:', err.message);
    return { ok: false, reason: 'engine_failure', error: err.message };
  }

  // Write all shadow observations atomically (per observation)
  const writeResult = await writeShadowObservations(pool, {
    kResult,
    profileId,
    collectionRunId,
    checkIn,
    checkOut,
    nights,
    currency:           dimensions.currency,
    targetLat:          dimensions.lat,
    targetLon:          dimensions.lon,
    targetGuests:       dimensions.guests,
    targetBedrooms:     dimensions.bedrooms,
    targetPropertyType: dimensions.propType,
    maxListings,
    collectedAt,
    propertyLinks,
    algorithmVersion,
    fingerprintAirbnb,
    fingerprintBooking,
    fingerprintConsensus,
  });

  return {
    ok:                  true,
    reused:              false,
    collectionRunId,
    airbnbObsId:         writeResult.airbnbObsId,
    bookingObsId:        writeResult.bookingObsId,
    consensusObsId:      writeResult.consensusObsId,
    written:             writeResult.written,
    market_status:       kResult.market_status,
  };
}

// ── coordinateCollection ──────────────────────────────────────────────────────

/**
 * Coordinate shadow market collection for a set of properties sharing the same
 * market profile (same geo bucket, currency, guests, bedrooms, property type).
 *
 * Sequence:
 *   1. P13 completeness guard  — skip on missing lat/lon/currency
 *   2. Build profile identity  — profileId from dimensions
 *   3. P5 persisted reuse      — skip re-collection if fresh enough
 *   4. P4 single-flight guard  — one in-flight promise per fingerprint
 *   5. Upsert market profile   — ensure market_profiles row exists
 *   6. P11 assign current profiles — update market_profile_properties
 *   7. Run K engine            — K's own BD calls (injectable for tests)
 *   8. Write shadow observations
 *
 * @param {object} pool
 * @param {object} opts
 * @param {object}    opts.cfg              — property config (must include lat/lon/currency)
 * @param {string}    opts.location         — location string passed to K engine
 * @param {string}    opts.checkIn          — YYYY-MM-DD
 * @param {string}    opts.checkOut         — YYYY-MM-DD
 * @param {string}    [opts.collectionRunId]
 * @param {number}    [opts.maxListings=100]
 * @param {number}    [opts.reuseMaxAgeMs]  — override P5 reuse TTL
 * @param {Array}     [opts.propertyLinks]  — [{property_id, user_id}]
 * @param {string|null} [opts.algorithmVersion]
 * @param {Function}  [opts._airbnbScrape]  — injected for tests (no live calls)
 * @param {Function}  [opts._bookingScrape] — injected for tests (no live calls)
 *
 * @returns {Promise<{
 *   ok:             boolean,
 *   reused?:        boolean,
 *   skipped?:       boolean,
 *   reason?:        string,
 *   collectionRunId?: string,
 *   airbnbObsId?:   string|null,
 *   bookingObsId?:  string|null,
 *   consensusObsId?:string|null,
 *   written?:       boolean,
 *   market_status?: string,
 * }>}
 */
async function coordinateCollection(pool, {
  cfg,
  location,
  checkIn,
  checkOut,
  collectionRunId,
  maxListings        = 100,
  reuseMaxAgeMs,
  propertyLinks      = [],
  algorithmVersion   = null,
  _airbnbScrape      = scrapeWithBrightData,
  _bookingScrape     = scrapeWithBrightDataBooking,
} = {}) {
  // ── Step 1: P13 completeness guard ─────────────────────────────────────────
  const completeness = validatePropertyCompleteness(cfg);
  if (!completeness.ok) {
    console.log(`[P-COORD] skip property=${cfg.property_id ?? '?'} reason=${completeness.reason}`);
    return { ok: false, skipped: true, reason: completeness.reason };
  }

  // ── Step 2: Build profile identity ─────────────────────────────────────────
  const currency = cfg.currency.trim().toUpperCase();
  const identity = buildMarketProfileIdentity({
    latitude:          cfg.latitude,
    longitude:         cfg.longitude,
    currency,
    targetGuests:      cfg.max_guests       ?? null,
    targetBedrooms:    cfg.bedrooms         ?? null,
    targetPropertyType:cfg.property_type    ?? null,
  });

  if (!identity.valid) {
    console.log(`[P-COORD] skip property=${cfg.property_id ?? '?'} reason=invalid_profile:${identity.reason}`);
    return { ok: false, skipped: true, reason: `invalid_profile:${identity.reason}` };
  }

  const { profileId, dimensions } = identity;

  // Build fingerprints
  const fpBase = {
    latitude: cfg.latitude, longitude: cfg.longitude, currency,
    targetGuests:       dimensions.guests,
    targetBedrooms:     dimensions.bedrooms,
    targetPropertyType: dimensions.propType,
    checkIn, checkOut,
    maxListings,
  };

  const fpAirbnb   = buildMarketSearchFingerprint({ ...fpBase, provider: 'airbnb'    });
  const fpBooking  = buildMarketSearchFingerprint({ ...fpBase, provider: 'booking'   });
  const fpConsensus = buildMarketSearchFingerprint({ ...fpBase, provider: 'consensus' });

  if (!fpConsensus.valid) {
    console.log(`[P-COORD] skip property=${cfg.property_id ?? '?'} reason=invalid_fingerprint:${fpConsensus.reason}`);
    return { ok: false, skipped: true, reason: `invalid_fingerprint:${fpConsensus.reason}` };
  }

  // ── Step 3: P5 persisted reuse ──────────────────────────────────────────────
  const maxAgeMs = reuseMaxAgeMs ?? DEFAULT_REUSE_AGE_MS;
  const existing = await findReusableObservation(pool, fpConsensus.fingerprint, { maxAgeMs });
  if (existing) {
    return {
      ok: true, reused: true,
      consensusObsId: existing.observation_id,
      market_status:  existing.quality_status ?? null,
    };
  }

  // ── Step 4: P4 single-flight ────────────────────────────────────────────────
  const sfKey = fpConsensus.fingerprint;
  if (_inflight.has(sfKey)) {
    return _inflight.get(sfKey);
  }

  const runId = collectionRunId || generateCollectionRunId();

  const nights = checkIn && checkOut
    ? Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
    : null;

  // ── Step 5+6: Upsert profile + assign current profile ──────────────────────
  // Runs before K engine to ensure FK constraint is satisfied when writing observations.
  await upsertMarketProfile(pool, profileId, dimensions);
  for (const link of propertyLinks) {
    if (link.property_id) {
      await assignCurrentProfile(pool, profileId, link.property_id, link.user_id ?? null);
    }
  }

  const collectionWork = _runCollection(pool, {
    profileId,
    dimensions,
    location,
    checkIn,
    checkOut,
    nights,
    collectionRunId:      runId,
    maxListings,
    propertyLinks,
    fingerprintAirbnb:    fpAirbnb.valid   ? fpAirbnb.fingerprint   : null,
    fingerprintBooking:   fpBooking.valid  ? fpBooking.fingerprint  : null,
    fingerprintConsensus: fpConsensus.fingerprint,
    algorithmVersion,
    _airbnbScrape,
    _bookingScrape,
  });

  _inflight.set(sfKey, collectionWork);
  try {
    return await collectionWork;
  } finally {
    if (_inflight.get(sfKey) === collectionWork) _inflight.delete(sfKey);
  }
}

// ── Feature flag helpers (P16) ─────────────────────────────────────────────────

/**
 * Returns true only when BOTH feature flags are enabled.
 *
 * MARKET_SHARED_COLLECTION_ENABLED    = 'true'
 * MARKET_OBSERVATION_PERSISTENCE_ENABLED = 'true'
 *
 * Both flags default to OFF — no BD credits are consumed unless explicitly set.
 */
function isShadowCollectionEnabled() {
  return (
    process.env.MARKET_SHARED_COLLECTION_ENABLED         === 'true' &&
    process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED   === 'true'
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  generateCollectionRunId,
  validatePropertyCompleteness,
  coordinateCollection,
  isShadowCollectionEnabled,
};

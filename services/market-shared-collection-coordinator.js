'use strict';
const { randomUUID } = require('crypto');

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
 * Generate a unique collection run ID for a logical orchestration run.
 *
 * Returns crun_<uuid-v4>. Each call produces a distinct ID — a new intentional
 * collection invocation always gets a different run ID.
 *
 * Call ONCE at orchestration start; pass the result explicitly to every
 * coordinateCollection call in that batch. Retries within the same logical run
 * must reuse the existing collectionRunId (do NOT call generateCollectionRunId
 * again on retry).
 *
 * @returns {string}  e.g. 'crun_61ffe1e3-6fc2-4e92-ba5d-c0e126a1803e'
 */
function generateCollectionRunId() {
  return `crun_${randomUUID()}`;
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

// ── S: Shared production collection functions ─────────────────────────────────

/**
 * S: Returns true when the shared production collection flag is enabled.
 * Requires only MARKET_SHARED_COLLECTION_ENABLED (not both flags).
 * When true, the weekly job uses fingerprint-grouped provider calls instead
 * of per-property zone-cache calls.
 */
function isSharedProductionEnabled() {
  return process.env.MARKET_SHARED_COLLECTION_ENABLED === 'true';
}

/**
 * S3/S4: Group active properties by canonical (provider, fingerprint) before any network calls.
 *
 * Returns Map<fingerprint, { fingerprint, profileId, dimensions, provider, cfg, propertyLinks }>.
 * One entry per unique fingerprint — first eligible property becomes the representative cfg.
 * Properties failing the completeness guard are silently excluded (S11: Ti Junot).
 *
 * @param {object[]} configs
 * @param {object}   opts
 * @param {string}   [opts.checkIn]
 * @param {string}   [opts.checkOut]
 * @param {Function} [opts.resolveProvider]  — (propertyId) => 'apify'|'brightdata'
 * @param {number}   [opts.maxListings=100]
 * @returns {Map}
 */
function groupPropertiesByFingerprint(configs, { checkIn, checkOut, resolveProvider, maxListings = 100 } = {}) {
  const groups = new Map();

  for (const cfg of configs) {
    const check = validatePropertyCompleteness(cfg);
    if (!check.ok) continue;

    const currency = cfg.currency.trim().toUpperCase();
    const identity = buildMarketProfileIdentity({
      latitude:           cfg.latitude,
      longitude:          cfg.longitude,
      currency,
      targetGuests:       cfg.max_guests    ?? null,
      targetBedrooms:     cfg.bedrooms      ?? null,
      targetPropertyType: cfg.property_type ?? null,
    });
    if (!identity.valid) continue;

    const { profileId, dimensions } = identity;

    // S5: provider is part of the fingerprint — never mix provider evidence
    const provider = resolveProvider ? resolveProvider(cfg.property_id) : 'apify';

    const fp = buildMarketSearchFingerprint({
      latitude:           cfg.latitude,
      longitude:          cfg.longitude,
      currency,
      targetGuests:       dimensions.guests,
      targetBedrooms:     dimensions.bedrooms,
      targetPropertyType: dimensions.propType,
      checkIn,
      checkOut,
      maxListings,
      provider,
    });
    if (!fp.valid) continue;

    const fingerprint = fp.fingerprint;

    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, {
        fingerprint,
        profileId,
        dimensions,
        provider,
        cfg,            // representative config (first eligible property in group)
        propertyLinks: [],
      });
    }

    groups.get(fingerprint).propertyLinks.push({
      property_id: String(cfg.property_id),
      user_id:     cfg.user_id ? String(cfg.user_id) : null,
    });
  }

  return groups;
}

/**
 * S10: Run shared production pre-collection.
 *
 * Groups properties by fingerprint and makes ONE provider call per group.
 * Returns shared evidence map + property-to-fingerprint index for the main job loop.
 *
 * S12: provider failures set an error entry — no per-property fallback.
 *
 * @param {object[]} configs
 * @param {object}   opts
 * @param {string}   [opts.checkIn]
 * @param {string}   [opts.checkOut]
 * @param {Function} [opts.resolveProvider]
 * @param {Function} opts.scrapeFn           — (zones, priceFallback, maxListings, bedrooms, currency, propertyId) => Promise
 * @param {Function} [opts.getFallbackZonesFn]  — (address, zoneLabel) => string[]
 * @param {Function} [opts.priceFallbackFn]     — (cfg) => number; defaults to 80
 * @param {number}   [opts.maxListings=100]
 *
 * @returns {Promise<{
 *   sharedEvidence:    Map<string, object | { error: string }>,
 *   propToFingerprint: Map<string, string>,
 *   groupCount:        number,
 *   callCount:         number,
 * }>}
 */
async function runSharedPreCollection(configs, {
  checkIn,
  checkOut,
  resolveProvider,
  scrapeFn,
  getFallbackZonesFn,
  priceFallbackFn        = () => 80,
  maxListings            = 100,
  canAttemptProvider,    // () => boolean — shared budget gate (optional)
  consumeProviderAttempt, // (name) => void — shared budget debit (optional)
} = {}) {
  const groups = groupPropertiesByFingerprint(configs, { checkIn, checkOut, resolveProvider, maxListings });

  const sharedEvidence    = new Map();
  const propToFingerprint = new Map();

  // Build propToFingerprint index
  for (const [fingerprint, group] of groups) {
    for (const link of group.propertyLinks) {
      propToFingerprint.set(link.property_id, fingerprint);
    }
  }

  let callCount = 0;

  for (const [fingerprint, group] of groups) {
    const capturedCurrency = group.cfg.currency ? group.cfg.currency.trim().toUpperCase() : null;
    if (!capturedCurrency || !/^[A-Z]{3}$/.test(capturedCurrency)) {
      sharedEvidence.set(fingerprint, { error: 'invalid_currency' });
      continue;
    }

    const zones = getFallbackZonesFn
      ? getFallbackZonesFn(group.cfg.property_address, group.cfg.zone_label)
      : ['France'];
    const priceFallback = priceFallbackFn(group.cfg);
    const groupSize     = group.propertyLinks.length;

    // FIX 4: Hard budget gate before each group call — same budget shared with legacy path
    if (canAttemptProvider && !canAttemptProvider()) {
      console.warn(
        `[MARKET_BUDGET_EXHAUSTED] fp=${fingerprint.slice(0, 12)}… ` +
        `shared_group_size=${groupSize} — budget exhausted, skip group`
      );
      sharedEvidence.set(fingerprint, { error: 'budget_exhausted' });
      continue;
    }

    const budgetOpts = (canAttemptProvider && consumeProviderAttempt)
      ? { canAttemptProvider, consumeProviderAttempt }
      : {};

    console.log(
      `[MARKET_PROVIDER_CALL_ATTEMPT] provider=${group.provider} fp=${fingerprint.slice(0, 12)}… ` +
      `shared_group_size=${groupSize} reason=shared_production`
    );

    try {
      const result = await scrapeFn(
        zones, priceFallback, maxListings, group.cfg.bedrooms, capturedCurrency, group.cfg.property_id,
        budgetOpts
      );
      sharedEvidence.set(fingerprint, result);
      callCount++;
      console.log(
        `[MARKET_PROVIDER_CALL_SUCCESS] provider=${group.provider} fp=${fingerprint.slice(0, 12)}… ` +
        `shared_group_size=${groupSize} dataSource=${result.dataSource}`
      );
    } catch (err) {
      console.error(
        `[MARKET_PROVIDER_CALL_FAILURE] provider=${group.provider} fp=${fingerprint.slice(0, 12)}… ` +
        `shared_group_size=${groupSize} reason=${err.message}`
      );
      // S12: record failure; callers must NOT fall back to per-property provider calls
      sharedEvidence.set(fingerprint, { error: err.message });
    }
  }

  return { sharedEvidence, propToFingerprint, groupCount: groups.size, callCount };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  generateCollectionRunId,
  validatePropertyCompleteness,
  coordinateCollection,
  isShadowCollectionEnabled,
  isSharedProductionEnabled,
  groupPropertiesByFingerprint,
  runSharedPreCollection,
};

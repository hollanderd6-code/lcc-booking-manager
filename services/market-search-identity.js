'use strict';
/**
 * P1.2-B5-BK-O3/O4 — Market Search Identity
 *
 * Pure module — no DB, no network, no Channex.
 *
 * Defines two canonical identities:
 *
 * MARKET PROFILE IDENTITY (O4)
 *   "Which properties share the same market definition?"
 *   Does NOT include stay dates, provider, or propertyId.
 *   Two properties with the same profile share a market search result.
 *
 * MARKET SEARCH FINGERPRINT V2 (O3)
 *   One specific search request = profile × provider × stay_window × maxListings.
 *   Deterministic. Two calls with identical inputs always produce the same fingerprint.
 *
 * GEO NORMALIZATION:
 *   Latitude/longitude rounded to 4 decimal places ≈ 11 m at equator.
 *   Two units in the same building share the same geo bucket.
 *   Buildings a few hundred metres apart have different buckets.
 *   This is documented and intentional — see MARKET_LOCATION_IDENTITY below.
 *
 * PROPERTY ID EXCLUSION:
 *   propertyId intentionally excluded from both identities.
 *   Massy x12 → 1 or 2 profiles, NOT 12.
 *
 * SAFETY:
 *   DB_WRITES      = 0  always
 *   NETWORK_CALLS  = 0  pure functions
 *   BRIGHT_DATA    = 0  no credits consumed
 *   SAFE_TO_ACTIVATE_PRODUCTION = NO
 */

const crypto = require('crypto');
const { isValidLatitude, isValidLongitude } = require('./market-geo-validator');

// ── Constants ─────────────────────────────────────────────────────────────────

const FINGERPRINT_VERSION = 2;

/**
 * MARKET_LOCATION_IDENTITY:
 *   GEO_PRECISION = 4 decimal places ≈ 11 m at equator.
 *
 *   Rationale:
 *     - Same building: coordinates are typically within 1–5 m → same bucket ✓
 *     - Different buildings 100 m apart: guaranteed different bucket ✓
 *     - Accidental cross-street merge at 4dp: possible within ~11 m — acceptable
 *       for market research (comps radius is typically 1–5 km).
 */
const GEO_PRECISION = 4;

const DEFAULT_PROPERTY_TYPE = 'entire_place';
const VALID_CURRENCY_RE     = /^[A-Z]{3}$/;
const PROFILE_PREFIX        = 'mp2_';
const FINGERPRINT_PREFIX    = 'ms2_';
const HASH_LENGTH           = 32; // hex chars = 128-bit

// ── Private helpers ───────────────────────────────────────────────────────────

function _normalizeGeo(lat, lon) {
  if (!isValidLatitude(lat) || !isValidLongitude(lon)) return null;
  const la = typeof lat === 'string' ? parseFloat(lat) : Number(lat);
  const lo = typeof lon === 'string' ? parseFloat(lon) : Number(lon);
  return {
    lat: la.toFixed(GEO_PRECISION),
    lon: lo.toFixed(GEO_PRECISION),
  };
}

function _sha256Short(obj) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex')
    .slice(0, HASH_LENGTH);
}

// ── buildMarketProfileIdentity ────────────────────────────────────────────────

/**
 * Build the market profile identity for a property.
 *
 * The profile is stable as long as geo, currency, capacity, and property type
 * are unchanged. Changing any dimension invalidates the profile — the property
 * will derive a new profileId automatically on the next call.
 *
 * NOTE: propertyId is intentionally NOT a dimension.
 *
 * @param {object} opts
 * @param {number|string}  opts.latitude
 * @param {number|string}  opts.longitude
 * @param {string}         opts.currency              — ISO 4217 uppercase
 * @param {number|null}    [opts.targetGuests]        — null treated as "any"
 * @param {number|null}    [opts.targetBedrooms]      — null treated as "any"
 * @param {string|null}    [opts.targetPropertyType]  — null defaults to 'entire_place'
 *
 * @returns {{
 *   valid:       boolean,
 *   profileId:   string|null,
 *   dimensions:  object|null,
 *   reason:      string|null,
 * }}
 */
function buildMarketProfileIdentity({
  latitude,
  longitude,
  currency,
  targetGuests       = null,
  targetBedrooms     = null,
  targetPropertyType = null,
} = {}) {
  const geo = _normalizeGeo(latitude, longitude);
  if (!geo) {
    return { valid: false, profileId: null, dimensions: null, reason: 'invalid_geo' };
  }

  const cur = (currency ?? '').toUpperCase();
  if (!VALID_CURRENCY_RE.test(cur)) {
    return { valid: false, profileId: null, dimensions: null, reason: 'invalid_currency' };
  }

  const dimensions = {
    v:        FINGERPRINT_VERSION,
    lat:      geo.lat,
    lon:      geo.lon,
    currency: cur,
    guests:   targetGuests   != null ? Number(targetGuests)   : null,
    bedrooms: targetBedrooms != null ? Number(targetBedrooms) : null,
    propType: (targetPropertyType ?? DEFAULT_PROPERTY_TYPE).toLowerCase(),
  };

  return {
    valid:      true,
    profileId:  PROFILE_PREFIX + _sha256Short(dimensions),
    dimensions,
    reason:     null,
  };
}

// ── buildMarketSearchFingerprint ──────────────────────────────────────────────

/**
 * Build a market search fingerprint for one specific collection request.
 *
 * fingerprint = profile × provider × stay_window × maxListings
 *
 * propertyId is intentionally excluded — all properties sharing the same
 * profile, provider, and stay window get the SAME fingerprint.
 *
 * @param {object} opts
 * @param {number|string}  opts.latitude
 * @param {number|string}  opts.longitude
 * @param {string}         opts.currency
 * @param {number|null}    [opts.targetGuests]
 * @param {number|null}    [opts.targetBedrooms]
 * @param {string|null}    [opts.targetPropertyType]
 * @param {string}         opts.provider         — 'airbnb' | 'booking' | 'consensus'
 * @param {string}         opts.checkIn          — YYYY-MM-DD
 * @param {string}         opts.checkOut         — YYYY-MM-DD
 * @param {number}         [opts.maxListings=100]
 *
 * @returns {{
 *   valid:        boolean,
 *   fingerprint:  string|null,
 *   profileId:    string|null,
 *   dimensions:   object|null,
 *   reason:       string|null,
 * }}
 */
function buildMarketSearchFingerprint({
  latitude,
  longitude,
  currency,
  targetGuests       = null,
  targetBedrooms     = null,
  targetPropertyType = null,
  provider,
  checkIn,
  checkOut,
  maxListings        = 100,
} = {}) {
  const profile = buildMarketProfileIdentity({
    latitude, longitude, currency, targetGuests, targetBedrooms, targetPropertyType,
  });

  if (!profile.valid) {
    return { valid: false, fingerprint: null, profileId: null, dimensions: null, reason: profile.reason };
  }

  if (!provider || typeof provider !== 'string') {
    return { valid: false, fingerprint: null, profileId: profile.profileId, dimensions: null, reason: 'missing_provider' };
  }
  if (!checkIn || typeof checkIn !== 'string') {
    return { valid: false, fingerprint: null, profileId: profile.profileId, dimensions: null, reason: 'missing_check_in' };
  }
  if (!checkOut || typeof checkOut !== 'string') {
    return { valid: false, fingerprint: null, profileId: profile.profileId, dimensions: null, reason: 'missing_check_out' };
  }

  const dimensions = {
    profileId:   profile.profileId,
    provider:    provider.toLowerCase(),
    checkIn,
    checkOut,
    maxListings: Number(maxListings),
  };

  return {
    valid:       true,
    fingerprint: FINGERPRINT_PREFIX + _sha256Short(dimensions),
    profileId:   profile.profileId,
    dimensions,
    reason:      null,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  buildMarketProfileIdentity,
  buildMarketSearchFingerprint,
  FINGERPRINT_VERSION,
  GEO_PRECISION,
  DEFAULT_PROPERTY_TYPE,
  PROFILE_PREFIX,
  FINGERPRINT_PREFIX,
  // Re-exported for consumers that need geo validation alongside profile building
  isValidLatitude,
  isValidLongitude,
  hasValidCoordinates: (lat, lon) => isValidLatitude(lat) && isValidLongitude(lon),
};

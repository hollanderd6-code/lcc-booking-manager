'use strict';
const axios = require('axios');

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY || null;
const GEOAPIFY_TIMEOUT_MS = 5000;
const ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';

// country/state/region always produce results too coarse for property geo context
const FAILED_TYPES = new Set(['country', 'state', 'region']);

// Only these result_types precisely identify a property location.
// Everything else (street, postcode, district, city, null, unknown) → at best ambiguous.
const RESOLVED_TYPES = new Set(['building', 'amenity']);

function normalizeCountryCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const n = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(n) ? n : null;
}

function isValidIANATimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; }
  catch (e) { return false; }
}

function isValidLat(v) { return typeof v === 'number' && isFinite(v) && v >= -90 && v <= 90; }
function isValidLng(v) { return typeof v === 'number' && isFinite(v) && v >= -180 && v <= 180; }

// opts._apiKey and opts._axios are injection points for tests only.
async function geocodeAddress(address, opts = {}) {
  const apiKey = opts._apiKey !== undefined ? opts._apiKey : GEOAPIFY_API_KEY;
  const http   = opts._axios  || axios;

  const failed = (reason, extra = {}) => ({
    status: 'failed', latitude: null, longitude: null,
    countryCode: null, timezone: null, confidence: null, resultType: null,
    provider: 'geoapify', reason, ...extra,
  });

  if (!address || !String(address).trim()) return failed('empty_address');
  if (!apiKey)                             return failed('no_api_key');

  try {
    const resp = await http.get(ENDPOINT, {
      params: { text: String(address).trim(), apiKey, format: 'json', limit: 1 },
      timeout: opts.timeoutMs || GEOAPIFY_TIMEOUT_MS,
    });

    const results = resp.data?.results;
    if (!results || results.length === 0) return failed('no_result');

    const r          = results[0];
    const lat        = parseFloat(r.lat);
    const lng        = parseFloat(r.lon);
    const confidence = r.rank?.confidence != null ? parseFloat(r.rank.confidence) : null;
    const resultType = r.result_type || null;
    const countryCode = normalizeCountryCode(r.country_code);
    const rawTz      = r.timezone?.name || null;
    const timezone   = rawTz && isValidIANATimezone(rawTz) ? rawTz : null;

    if (!isValidLat(lat) || !isValidLng(lng)) {
      return { ...failed('invalid_coordinates'), countryCode, timezone, confidence, resultType };
    }
    if (FAILED_TYPES.has(resultType) || confidence === null || !isFinite(confidence) || confidence < 0.4) {
      return { status: 'failed', latitude: lat, longitude: lng, countryCode, timezone,
               confidence, resultType, provider: 'geoapify', reason: 'too_coarse_or_low_confidence' };
    }
    // Allowlist: only explicitly recognised precise types can reach 'resolved'.
    // Unknown/null/future result_type → ambiguous, never resolved (fail-closed).
    // All 4 context fields required: partial writes are worse than no write.
    if (confidence >= 0.7 && RESOLVED_TYPES.has(resultType)
        && countryCode !== null && timezone !== null) {
      return { status: 'resolved', latitude: lat, longitude: lng, countryCode, timezone,
               confidence, resultType, provider: 'geoapify' };
    }
    return { status: 'ambiguous', latitude: lat, longitude: lng, countryCode, timezone,
             confidence, resultType, provider: 'geoapify', reason: 'ambiguous' };

  } catch (err) {
    const reason = err.code === 'ECONNABORTED'
      ? 'timeout'
      : `http_error_${err.response?.status || 'network'}`;
    return failed(reason);
  }
}

module.exports = { geocodeAddress };

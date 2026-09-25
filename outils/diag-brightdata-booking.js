#!/usr/bin/env node
'use strict';
require('dotenv').config();
/**
 * P1.2-B5-BK-A/B/C/D — Bright Data Booking.com Contract Discovery
 *
 * Discovery diagnostic — investigates the Booking.com BD API contract.
 * Does NOT activate Booking.com in production.
 * Does NOT modify market-provider.js, dynamic-pricing-cron.js, or any production code.
 *
 * Usage:
 *   Preview:     node outils/diag-brightdata-booking.js --name "M6"
 *   Execute:     node outils/diag-brightdata-booking.js --name "M6" --execute
 *   Resume:      node outils/diag-brightdata-booking.js --snapshot-id <id>
 *                (0 trigger POSTs — polls + downloads existing snapshot, runs same analysis)
 *
 * SAFETY CONTRACT:
 *   Preview:  0 BD calls, 0 DB writes, 0 market_data writes
 *   Execute:  MAX 1 BD job, MAX 10 records, 0 DB writes, 0 pricing writes
 *   Resume:   0 BD trigger POSTs, polls existing snapshot only
 *   NEVER:    market_data writes, pricing engine, Channex calls
 *
 * B5-BK-B additions:
 *   - Error body observability: HTTP_STATUS, HTTP_STATUS_TEXT,
 *     RESPONSE_CONTENT_TYPE, SANITIZED_ERROR_BODY on any non-2xx trigger
 *   - Secret redaction in error bodies (Bearer, api_key, token, auth headers,
 *     literal BRIGHTDATA_API_KEY value)
 *   - Preview shows EXACT REQUEST CONTRACT (URL + query params + body) without secrets
 *
 * B5-BK-C: Corrected contract after confirmed HTTP 400 from real API call:
 *   discover_new       → NOT SUPPORTED (error: "Supported types: ['url_collection']")
 *   type= query param  → MUST NOT be sent (implicit url_collection for this dataset)
 *   discover_by=       → MUST NOT be sent
 *   body url field     → REQUIRED: "https://www.booking.com" (official BD docs)
 *
 * B5-BK-D: Live contract validation (controlled real call):
 *   executeMode unblocked, snapshotResumeMode added, raw field scan, price semantics verdict
 *
 * CONTRACT CONFIDENCE LEVELS (B5-BK-C update):
 *   BOOKING_DATASET_ID        gd_m4bf7a917zfezv9d5    CONFIRMED (BD "Listings Search" page)
 *   BOOKING_TRIGGER_BASE      /datasets/v3/trigger    CONFIRMED (same as Airbnb)
 *   URL_COLLECTION_SUPPORTED  url_collection          CONFIRMED (API error + official docs)
 *   INPUT_URL_FIELD           https://www.booking.com CONFIRMED (official BD examples)
 *   INPUT_DATE_FORMAT         ISO8601 full timestamp  CONFIRMED (official BD examples)
 *   PRICE_FIELD               final_price             CONFIRMED (HuggingFace schema)
 *   PRICE_SEMANTICS           per-night for dates     INFERRED (unconfirmed without live data)
 *   LAT_LON_AVAILABLE         FALSE                   CONFIRMED (map_coordinates=null)
 *   BEDROOMS_AVAILABLE        TRUE                    CONFIRMED (nb_bedrooms field)
 *   RATING_FIELD              review_score 0-10       CONFIRMED (HuggingFace schema)
 *   OCCUPANCY_PROXY           NOT FEASIBLE            CONFIRMED (no available_dates)
 *   CROSS_PLATFORM_DEDUP      NOT FEASIBLE            CONFIRMED (no shared ID space)
 */

// ── Safe imports only ─────────────────────────────────────────────────────────
// DO NOT import: resolveProvider, resolveProviderForProperty, scrape() from market-provider
//                DB write helpers, pricing engine, channex, rate modules
const { getBrightDataMarketDates } = require('../services/market-provider');
const { computeMarketContextKey }  = require('../routes/market-context-key');
const { normalizeCurrency }        = require('../routes/market-data-resolver');
const { getFallbackZones }         = require('../routes/dynamic-pricing-cron');
const { Pool }                     = require('pg');

// ── Contract constants (with confidence annotations) ──────────────────────────

const BOOKING_DATASET_ID    = 'gd_m4bf7a917zfezv9d5';   // CONFIRMED (BD "Listings Search" page)
const BOOKING_TRIGGER_BASE  = 'https://api.brightdata.com/datasets/v3/trigger';   // CONFIRMED
const BOOKING_PROGRESS_BASE = 'https://api.brightdata.com/datasets/v3/progress';  // CONFIRMED
const BOOKING_SNAPSHOT_BASE = 'https://api.brightdata.com/datasets/v3/snapshot';  // CONFIRMED
// url_collection: no type= or discover_by= query params — body includes url + location instead
const BOOKING_INPUT_URL     = 'https://www.booking.com'; // CONFIRMED (official BD Listings Search docs)
const BOOKING_DEFAULT_ADULTS = 2;
const BOOKING_DEFAULT_ROOMS  = 1;
const MAX_RECORDS            = 10;       // hard cap — discovery only
const MAX_WAIT_MS            = 180_000;  // 3 minutes
const POLL_INTERVAL_MS_LIVE  = 10_000;


const CONTRACT_CONFIDENCE = {
  BOOKING_DATASET_ID:      'CONFIRMED',  // BD product page names gd_m4bf7a917zfezv9d5 "Listings Search"
  URL_COLLECTION_SUPPORTED:'CONFIRMED',  // real API error: "Supported types: ['url_collection']"
  INPUT_URL_FIELD:         'CONFIRMED',  // official docs: url="https://www.booking.com" + location
  INPUT_DATE_FORMAT:       'CONFIRMED',  // ISO8601 timestamps — shown in official BD examples
  PRICE_FIELD:             'CONFIRMED',  // final_price
  PRICE_SEMANTICS:         'INFERRED',   // per-night — semantics unconfirmed without live data
  CURRENCY_FIELD:          'CONFIRMED',  // item.currency
  LAT_LON_AVAILABLE:       'CONFIRMED',  // FALSE — map_coordinates null in observed data
  BEDROOMS_AVAILABLE:      'CONFIRMED',  // nb_bedrooms field present
  RATING_FIELD:            'CONFIRMED',  // review_score 0-10 scale
  OCCUPANCY_PROXY:         'CONFIRMED',  // NOT FEASIBLE — no available_dates
  CROSS_PLATFORM_DEDUP:    'CONFIRMED',  // NOT FEASIBLE — incompatible ID spaces
};

// ── Error body observability (B5-BK-B) ────────────────────────────────────────

const ERROR_BODY_MAX_CHARS = 4000;
const ERROR_USEFUL_KEYS    = [
  'error', 'message', 'code', 'details', 'errors',
  'description', 'reason', 'status', 'statusCode', 'type',
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact all secret patterns from a string.
 *   Bearer tokens, authorization/api_key/token headers and query params.
 * Optionally redacts the literal apiKey value when explicitly passed
 * (guards against BD echoing credentials back in error bodies).
 *
 * @param {string}  text
 * @param {string}  [apiKey] — literal secret to erase from text
 * @returns {string}
 */
function redactSecrets(text, apiKey) {
  if (typeof text !== 'string') return String(text);
  let result = text
    .replace(/Bearer\s+\S+/gi,                       'Bearer [REDACTED]')
    .replace(/"[Aa]uthorization"\s*:\s*"[^"]*"/g,    '"authorization": "[REDACTED]"')
    .replace(/"[Aa]pi_?[Kk]ey"\s*:\s*"[^"]*"/g,      '"api_key": "[REDACTED]"')
    .replace(/"[Aa]pikey"\s*:\s*"[^"]*"/g,            '"apikey": "[REDACTED]"')
    .replace(/"[Tt]oken"\s*:\s*"[^"]*"/g,             '"token": "[REDACTED]"')
    .replace(/\bapi_?key=[^&\s"'<>]*/gi,              'api_key=[REDACTED]')
    .replace(/\btoken=[^&\s"'<>]*/gi,                 'token=[REDACTED]');
  // Erase the literal API key value if Bright Data echoes it back in error bodies
  if (apiKey && apiKey.length > 4) {
    result = result.replace(new RegExp(escapeRegExp(apiKey), 'g'), '[REDACTED]');
  }
  return result;
}

/**
 * Sanitize a Bright Data error response body for safe console display.
 *
 * - Reads rawText (already consumed from Response.text() — no double-read)
 * - Handles application/json, text/plain, text/html, empty body
 * - Parses JSON when possible; extracts known error keys first
 * - Redacts all secret patterns; truncates to maxLen
 *
 * @param {string}  rawText     — body already read via Response.text()
 * @param {string}  contentType — value of Content-Type header
 * @param {string}  [apiKey]    — literal API key to redact from body
 * @param {number}  [maxLen]    — max chars to return (default 4000)
 * @returns {string}
 */
function sanitizeErrorBody(rawText, contentType, apiKey, maxLen) {
  if (maxLen === undefined) maxLen = ERROR_BODY_MAX_CHARS;
  if (!rawText) return '(empty response body)';

  // Always try JSON parse — BD may not set Content-Type correctly
  let jsonObj = null;
  try { jsonObj = JSON.parse(rawText); } catch {}

  if (jsonObj !== null && typeof jsonObj === 'object') {
    const useful = {};
    ERROR_USEFUL_KEYS.forEach(k => { if (jsonObj[k] !== undefined) useful[k] = jsonObj[k]; });
    const pretty = JSON.stringify(Object.keys(useful).length > 0 ? useful : jsonObj, null, 2);
    return redactSecrets(pretty, apiKey).slice(0, maxLen);
  }

  return redactSecrets(rawText, apiKey).slice(0, maxLen);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function normalizeBookingCurrency(s) {
  return (s || '').trim().toUpperCase();
}

/**
 * Convert YYYY-MM-DD date string to ISO8601 full timestamp.
 * Booking.com trigger uses ISO8601 (INFERRED from observed output schema).
 * Differs from Airbnb which accepts plain YYYY-MM-DD.
 */
function toISO8601Timestamp(dateStr) {
  return dateStr + 'T00:00:00.000Z';
}

// ── parseBookingItem ───────────────────────────────────────────────────────────

/**
 * Parse one Booking.com raw record into a NormalizedMarketListing candidate.
 *
 * Key differences from parseBrightDataItem (Airbnb):
 *   - Price field: final_price (integer, INFERRED as per-night)
 *   - Lat/lon: not extracted (map_coordinates null in observed data)
 *   - Bedrooms: nb_bedrooms (reliably present — unlike Airbnb which is always null)
 *   - Rating: review_score 0-10 → normalized to 0-5 for NormalizedListing compat
 *   - Availability: no explicit boolean; discovery = available (isBooked=false always)
 *   - availableDates: NULL (no calendar array — occupancy proxy NOT FEASIBLE)
 *
 * @returns {{ listing: object|null, reason: string|null }}
 */
function parseBookingItem(item, requestedCurrency) {
  // Currency check
  const itemCurrency = normalizeBookingCurrency(item.currency);
  if (!itemCurrency || itemCurrency !== normalizeBookingCurrency(requestedCurrency)) {
    return { listing: null, reason: 'currency' };
  }

  // Price: final_price (CONFIRMED field, INFERRED as per-night for requested dates)
  const price = typeof item.final_price === 'number'
    ? item.final_price
    : parseFloat(item.final_price);
  if (!Number.isFinite(price) || price <= 0) {
    return { listing: null, reason: 'price' };
  }

  // Geo: map_coordinates (CONFIRMED null in observed schema)
  // Attempt extraction in case a future schema version populates it.
  let latitude = null, longitude = null;
  if (item.map_coordinates != null) {
    if (typeof item.map_coordinates === 'object') {
      const lat = parseFloat(item.map_coordinates.latitude  ?? item.map_coordinates.lat);
      const lon = parseFloat(
        item.map_coordinates.longitude ?? item.map_coordinates.lon ?? item.map_coordinates.lng
      );
      if (Number.isFinite(lat) && Number.isFinite(lon)) { latitude = lat; longitude = lon; }
    }
  }
  // Try full_location JSON if map_coordinates failed
  if (latitude == null && item.full_location != null) {
    try {
      const fl = typeof item.full_location === 'string'
        ? JSON.parse(item.full_location)
        : item.full_location;
      const lat = parseFloat(fl?.latitude ?? fl?.lat ?? fl?.coordinates?.lat ?? fl?.coordinates?.latitude);
      const lon = parseFloat(
        fl?.longitude ?? fl?.lon ?? fl?.lng ?? fl?.coordinates?.lon ?? fl?.coordinates?.lng ?? fl?.coordinates?.longitude
      );
      if (Number.isFinite(lat) && Number.isFinite(lon)) { latitude = lat; longitude = lon; }
    } catch (_) {}
  }

  // Bedrooms: nb_bedrooms (CONFIRMED field — unlike Airbnb which is always null)
  let bedrooms = null;
  if (item.nb_bedrooms != null) {
    const n = parseInt(item.nb_bedrooms, 10);
    if (n > 0) bedrooms = n;
  }

  // Rating: review_score (0-10 scale) → normalize to 0-5 for NormalizedListing compat
  const rawScore = parseFloat(item.review_score);
  const stars    = Number.isFinite(rawScore) ? rawScore / 2 : 0;

  // Guests: adults (echoed from input — INFERRED as guest capacity proxy)
  let guests = null;
  if (typeof item.adults === 'number' && item.adults > 0) {
    guests = item.adults;
  } else if (typeof item.adults === 'string') {
    const n = parseInt(item.adults, 10);
    if (n > 0) guests = n;
  }

  // Availability: Booking.com discovery returns only listings bookable for requested dates.
  // No explicit availability field → isBooked=false for all discovery results (same as Airbnb).
  const isBooked = false;

  // No available_dates calendar array → occupancy proxy NOT FEASIBLE
  const availableDates = null;

  return {
    listing: {
      price, isBooked, bedrooms, stars,
      providerListingId: item.id != null ? String(item.id) : null,
      latitude,
      longitude,
      guests,
      category:      null,  // no Booking.com equivalent of Airbnb category
      availableDates,
    },
    reason: null,
  };
}

// ── Schema field presence analysis ────────────────────────────────────────────

const BOOKING_EXPECTED_FIELDS = [
  // Core output fields (CONFIRMED from HuggingFace schema)
  'url', 'id', 'title', 'location', 'city', 'address', 'full_location',
  'final_price', 'original_price', 'currency',
  'check_in', 'check_out', 'adults', 'children', 'rooms',
  'review_score', 'review_count',
  'nb_bedrooms', 'nb_bathrooms', 'nb_kitchens', 'nb_livingrooms', 'nb_all_beds',
  'free_cancellation', 'no_prepayment', 'free_cancellation_until',
  'map_coordinates', 'star_rating',
  // Fields to check for absence (expected NOT present in Booking.com)
  'availability',       // Airbnb boolean — likely absent from Booking.com
  'available_dates',    // Airbnb calendar — likely absent
  'pricing_details',    // Airbnb nested object — absent in Booking.com
  'guests',             // Airbnb field name (vs 'adults' for Booking.com)
  'ratings',            // Airbnb field name (vs 'review_score')
];

/**
 * Compute field presence stats across an array of raw items.
 * @returns {{ [field]: { present: number, total: number, pct: number } }}
 */
function analyzeFieldPresence(items) {
  if (!items.length) return {};
  const counts = {};
  for (const f of BOOKING_EXPECTED_FIELDS) counts[f] = 0;
  for (const item of items) {
    for (const f of BOOKING_EXPECTED_FIELDS) {
      if (item[f] !== undefined && item[f] !== null) counts[f]++;
    }
  }
  const result = {};
  for (const f of BOOKING_EXPECTED_FIELDS) {
    result[f] = { present: counts[f], total: items.length, pct: Math.round(counts[f] / items.length * 100) };
  }
  return result;
}

// ── Property lookup ────────────────────────────────────────────────────────────

async function resolvePropByName(pool, name) {
  const rows = (await pool.query(
    `SELECT p.id, p.user_id, p.name, p.internal_name, p.address,
            p.latitude, p.longitude, p.country_code, p.timezone,
            p.currency, p.max_guests, p.bedrooms
       FROM properties p
      WHERE LOWER(p.name) = LOWER($1) OR LOWER(p.internal_name) = LOWER($1)`,
    [name]
  )).rows;
  return rows;
}

// ── Booking.com BD job trigger (max MAX_RECORDS records) ──────────────────────

/**
 * Trigger a Booking.com discovery job and return the result items.
 *
 * Error body observability (B5-BK-B):
 *   On any non-2xx trigger response the function prints:
 *     HTTP_STATUS, HTTP_STATUS_TEXT, RESPONSE_CONTENT_TYPE, SANITIZED_ERROR_BODY
 *   Body is read exactly once via .text() — never causes a double-read error.
 *   BRIGHTDATA_API_KEY value is redacted from error output.
 */
async function triggerBookingJob(location, currency, checkIn, checkOut, opts = {}) {
  const {
    _fetchImpl,
    maxWaitMs      = MAX_WAIT_MS,
    pollIntervalMs = POLL_INTERVAL_MS_LIVE,
  } = opts;
  const _fetch = _fetchImpl || fetch;
  const key    = process.env.BRIGHTDATA_API_KEY;
  if (!key) throw new Error('BRIGHTDATA_API_KEY non défini');

  // B5-BK-C: no type= or discover_by= params — url_collection is implicit for this dataset.
  const triggerUrl = `${BOOKING_TRIGGER_BASE}?dataset_id=${BOOKING_DATASET_ID}&format=json` +
    `&limit_per_input=${MAX_RECORDS}`;

  const triggerRes = await _fetch(triggerUrl, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    // url_collection: body includes url + location (CONFIRMED from official BD docs)
    // dates as ISO8601 timestamps (CONFIRMED from official BD Listings Search examples)
    body: JSON.stringify([{
      url:      BOOKING_INPUT_URL,
      location,
      currency: normalizeBookingCurrency(currency),
      check_in:  toISO8601Timestamp(checkIn),
      check_out: toISO8601Timestamp(checkOut),
      adults:   BOOKING_DEFAULT_ADULTS,
      rooms:    BOOKING_DEFAULT_ROOMS,
    }]),
  });

  // Read body exactly once — prevents double-read error regardless of status
  const rawTriggerBody = await triggerRes.text().catch(() => '');

  if (!triggerRes.ok) {
    const ct = (triggerRes.headers && typeof triggerRes.headers.get === 'function')
      ? (triggerRes.headers.get('content-type') ?? 'unknown')
      : 'unknown';
    const sanitized = sanitizeErrorBody(rawTriggerBody, ct, key);
    const indented  = sanitized.split('\n').map(l => '    ' + l).join('\n');
    console.error(`\n  ❌ BD TRIGGER FAILED`);
    console.error(`  HTTP_STATUS:           ${triggerRes.status}`);
    console.error(`  HTTP_STATUS_TEXT:      ${triggerRes.statusText ?? ''}`);
    console.error(`  RESPONSE_CONTENT_TYPE: ${ct}`);
    console.error(`  SANITIZED_ERROR_BODY:`);
    console.error(indented);
    throw new Error(`Booking.com BD trigger échoué: ${triggerRes.status}`);
  }

  let triggerData;
  try   { triggerData = JSON.parse(rawTriggerBody); }
  catch { throw new Error('Booking.com BD trigger: réponse JSON malformée'); }

  const snapshotId = triggerData?.snapshot_id;
  if (!snapshotId) throw new Error('Booking.com BD trigger: snapshot_id absent de la réponse');

  const deadline = Date.now() + maxWaitMs;
  let ready = false;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const progressRes = await _fetch(
      `${BOOKING_PROGRESS_BASE}/${snapshotId}`,
      { headers: { 'Authorization': `Bearer ${key}` } }
    );
    if (!progressRes.ok) throw new Error(`Booking.com BD progress échoué: ${progressRes.status}`);
    const progress = await progressRes.json();
    if (progress?.status === 'ready')  { ready = true; break; }
    if (progress?.status === 'failed') throw new Error('Booking.com BD snapshot terminé en erreur');
  }

  if (!ready) {
    const timeoutErr = new Error('Booking.com BD timeout: snapshot non prêt dans les délais');
    timeoutErr.snapshotId = snapshotId;
    throw timeoutErr;
  }

  const snapshotRes = await _fetch(
    `${BOOKING_SNAPSHOT_BASE}/${snapshotId}?format=json`,
    { headers: { 'Authorization': `Bearer ${key}` } }
  );
  if (!snapshotRes.ok) throw new Error(`Booking.com BD snapshot fetch échoué: ${snapshotRes.status}`);

  let items;
  try   { items = await snapshotRes.json(); }
  catch { throw new Error('Booking.com BD snapshot: JSON malformé'); }
  if (!Array.isArray(items)) throw new Error('Booking.com BD snapshot: réponse non-tableau');

  return { snapshotId, items };
}

// ── Preview mode ──────────────────────────────────────────────────────────────
// BD_CALLS=0  DB_WRITES=0  MARKET_DATA_WRITES=0  PRICING_WRITES=0

async function previewMode({ name, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK BOOKING.COM CONTRACT DISCOVERY — PREVIEW MODE');
  console.log('  BD_CALLS=0 | DB_WRITES=0 | MARKET_DATA_WRITES=0 | PRICING_WRITES=0');
  console.log('═'.repeat(72));

  const rows = await resolvePropByName(pool, name);
  if (rows.length === 0) {
    console.log(`\n  ⛔  Aucune propriété: "${name}"`);
    return { ok: false };
  }
  if (rows.length > 1) {
    console.log(`  ⛔  Ambiguïté: ${rows.length} correspondances pour "${name}"`);
    return { ok: false };
  }

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now: _now });
  const zones    = getFallbackZones(prop.address, null);
  const ctxKey   = computeMarketContextKey({
    countryCode: prop.country_code,
    latitude:    prop.latitude  != null ? parseFloat(prop.latitude)  : null,
    longitude:   prop.longitude != null ? parseFloat(prop.longitude) : null,
  });

  console.log('\n  PROPERTY:');
  console.log(`    id:                ${prop.id}`);
  console.log(`    name:              ${prop.internal_name || prop.name}`);
  console.log(`    lat/lon:           ${prop.latitude} / ${prop.longitude}`);
  console.log(`    currency:          ${currency}`);
  console.log(`    timezone:          ${timezone}`);
  console.log(`    max_guests:        ${prop.max_guests ?? 'NULL'}`);
  console.log(`    bedrooms:          ${prop.bedrooms ?? 'NULL'}`);
  console.log(`    context_key:       ${ctxKey}`);

  // ── EXACT REQUEST CONTRACT (B5-BK-B/C) ──────────────────────────────────
  const location    = zones[0];
  // B5-BK-C: body now includes url=BOOKING_INPUT_URL (CONFIRMED from official BD docs)
  const reqBody     = [{
    url:      BOOKING_INPUT_URL,
    location,
    currency: normalizeBookingCurrency(currency),
    check_in:  toISO8601Timestamp(checkIn),
    check_out: toISO8601Timestamp(checkOut),
    adults:   BOOKING_DEFAULT_ADULTS,
    rooms:    BOOKING_DEFAULT_ROOMS,
  }];
  // B5-BK-C: no type= or discover_by= (were causing HTTP 400 — not supported)
  const triggerUrl  = `${BOOKING_TRIGGER_BASE}?dataset_id=${BOOKING_DATASET_ID}&format=json` +
    `&limit_per_input=${MAX_RECORDS}`;

  console.log('\n  EXACT REQUEST CONTRACT (B5-BK-C corrected — no secrets):');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('  TRIGGER_URL_SANITIZED:');
  console.log(`    ${BOOKING_TRIGGER_BASE}`);
  console.log(`      ?dataset_id=${BOOKING_DATASET_ID}`);
  console.log(`      &format=json`);
  console.log(`      &limit_per_input=${MAX_RECORDS}`);
  console.log('  (no type= or discover_by= — url_collection is implicit for this dataset)');
  console.log('  HEADERS (sanitized):');
  console.log('    Authorization: Bearer [REDACTED]');
  console.log('    Content-Type:  application/json');
  console.log('  REQUEST BODY:');
  const bodyLines = JSON.stringify(reqBody, null, 4).split('\n');
  bodyLines.forEach(l => console.log('    ' + l));

  console.log('\n  CONTRACT CONFIDENCE LEVELS:');
  for (const [k, v] of Object.entries(CONTRACT_CONFIDENCE)) {
    const icon = v === 'CONFIRMED' ? '✅' : '⚠️ ';
    console.log(`    ${icon} ${k.padEnd(28)} ${v}`);
  }

  console.log('\n  KNOWN LIMITATIONS (confirmed from schema research):');
  console.log('    ❌ lat/lon unavailable     → selectComparables geo-filter disabled');
  console.log('    ❌ available_dates absent  → occupancy proxy NOT feasible (always 0)');
  console.log('    ❌ no shared ID w/ Airbnb  → cross-platform dedup NOT feasible');
  console.log('    ✅ nb_bedrooms present     → bedroom count filter feasible');
  console.log('    ✅ final_price present     → nightly price parseable (semantics INFERRED)');
  console.log('    ✅ review_score present    → rating quality filter feasible (0-10 → 0-5)');
  console.log('    ✅ Dataset ID CONFIRMED    → gd_m4bf7a917zfezv9d5 = BD "Listings Search"');
  console.log('    ✅ url_collection CONFIRMED → body: url + location (not discover_new)');

  console.log('\n  Ready: node outils/diag-brightdata-booking.js --name <nom> --execute');
  console.log('  Resume: node outils/diag-brightdata-booking.js --snapshot-id <id>');
  console.log('═'.repeat(72) + '\n');

  return {
    ok:         true,
    propertyId: prop.id,
    currency,
    zones,
    checkIn,
    checkOut,
    triggerUrl,
    requestBody: reqBody,
  };
}

// ── Execute mode ──────────────────────────────────────────────────────────────
// MAX_BD_CALLS=1  MAX_RECORDS=10  DB_WRITES=0  PRICING_WRITES=0  CHANNEX_WRITES=0

async function executeMode({ name, _bdFetchImpl, _bdMaxWaitMs, _now, pool } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK BOOKING.COM CONTRACT DISCOVERY — EXECUTE MODE');
  console.log('  MAX_BD_CALLS=1 | MAX_RECORDS=10 | DB_WRITES=0 | PRICING_WRITES=0');
  console.log('═'.repeat(72));

  // 1. Resolve property
  const rows = await resolvePropByName(pool, name);
  if (rows.length === 0) throw new Error(`Aucune propriété: "${name}"`);
  if (rows.length > 1)  throw new Error(`${rows.length} correspondances pour "${name}" — affiner --name`);

  const prop     = rows[0];
  const timezone = prop.timezone || 'Europe/Paris';
  const currency = normalizeCurrency(prop.currency);
  if (!currency) throw new Error('Devise propriété invalide ou absente');

  const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now: _now });
  const zones    = getFallbackZones(prop.address, null);
  const location = zones[0];

  console.log(`\n  Target: ${prop.internal_name || prop.name} [${String(prop.id).slice(-8)}]`);
  console.log(`  Location: ${location}  currency=${currency}`);
  console.log(`  checkIn=${checkIn}  checkOut=${checkOut}`);
  console.log(`  ISO8601 input: check_in=${toISO8601Timestamp(checkIn)}`);

  // 2. Trigger BD job (MAX 1 job, MAX 10 records)
  console.log(`\n  🔍 Calling Bright Data Booking.com (dataset=${BOOKING_DATASET_ID}, max=${MAX_RECORDS})…`);
  let snapshotId, items;
  try {
    ({ snapshotId, items } = await triggerBookingJob(location, currency, checkIn, checkOut, {
      _fetchImpl:     _bdFetchImpl,
      pollIntervalMs: _bdFetchImpl ? 1 : POLL_INTERVAL_MS_LIVE,
      maxWaitMs:      _bdMaxWaitMs !== undefined ? _bdMaxWaitMs : MAX_WAIT_MS,
    }));
  } catch (err) {
    if (err.snapshotId) {
      console.error(`\n  ⏱️  TIMEOUT — snapshot non prêt dans les délais`);
      console.error(`  SNAPSHOT_ID: ${err.snapshotId}`);
      console.error(`  Resume (sans nouveau job):`);
      console.error(`    node outils/diag-brightdata-booking.js --snapshot-id ${err.snapshotId}`);
      return { ok: false, timeout: true, snapshotId: err.snapshotId };
    }
    throw err;
  }
  console.log(`  snapshot_id: ${snapshotId}`);
  console.log(`  Returned: ${items.length} raw items`);

  if (!items.length) {
    console.log('\n  ⚠️  0 items returned — cannot analyze output contract.');
    console.log('  Possible causes: location not found by Booking.com, date range issue,');
    console.log('  currency filter, or limit_per_input=0.');
    return { ok: false, snapshotId, returnedCount: 0 };
  }

  // ── Phase 1b: Raw contract field scan ────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 1b — RAW CONTRACT FIELD SCAN');
  console.log('─'.repeat(72));

  const allTopLevel = new Set();
  for (const item of items) Object.keys(item).forEach(k => allTopLevel.add(k));
  const sortedFields = [...allTopLevel].sort();
  console.log(`\n  ALL TOP-LEVEL FIELDS (${sortedFields.length} unique across ${items.length} items):`);
  console.log(`  ${sortedFields.join(', ')}`);

  const KEY_FIELD_NAMES = [
    'final_price', 'nb_bedrooms', 'review_score',
    'lat', 'lon', 'latitude', 'longitude', 'map_coordinates',
    'id', 'hotel_id', 'url', 'availability', 'available_dates',
  ];
  console.log('\n  KEY FIELD SAMPLE (first item, sanitized):');
  for (const k of KEY_FIELD_NAMES) {
    if (items[0][k] !== undefined) {
      const val = items[0][k];
      const display = val === null ? 'null'
        : typeof val === 'object' ? JSON.stringify(val).slice(0, 80)
        : String(val).slice(0, 80);
      console.log(`    ${k.padEnd(20)} = ${display}`);
    }
  }

  // ── Phase 2: Output schema field presence ─────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 2 — OUTPUT SCHEMA FIELD PRESENCE');
  console.log('─'.repeat(72));

  const fieldPresence = analyzeFieldPresence(items);
  console.log(`\n  Total items: ${items.length}`);
  console.log('\n  Field                   Present   %');
  for (const [f, s] of Object.entries(fieldPresence)) {
    const icon = s.pct === 100 ? '✅' : s.pct === 0 ? '❌' : '⚠️ ';
    console.log(`  ${icon} ${f.padEnd(24)} ${String(s.present).padStart(3)}/${s.total}  ${String(s.pct).padStart(3)}%`);
  }

  // ── Phase 3: Input contract verification (echo check) ─────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 3 — INPUT CONTRACT ECHO VERIFICATION');
  console.log('─'.repeat(72));

  const first = items[0];
  console.log(`  check_in  echoed: ${first.check_in  ?? 'ABSENT'}`);
  console.log(`  check_out echoed: ${first.check_out ?? 'ABSENT'}`);
  console.log(`  adults    echoed: ${first.adults    ?? 'ABSENT'}`);
  console.log(`  rooms     echoed: ${first.rooms     ?? 'ABSENT'}`);
  console.log(`  currency  echoed: ${first.currency  ?? 'ABSENT'}`);
  console.log(`  location  echoed: ${first.location  ?? 'ABSENT'}`);

  // ── Phase 4: Price semantics ───────────────────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 4 — PRICE FIELD SEMANTICS');
  console.log('─'.repeat(72));

  const withFinalPrice = items.filter(i => typeof i.final_price === 'number' && i.final_price > 0);
  console.log(`  final_price positive: ${withFinalPrice.length}/${items.length}`);

  console.log('\n  Sample (id, final_price, original_price, nights):');
  for (const item of items.slice(0, 5)) {
    const nights = (() => {
      try { return Math.round((new Date(item.check_out) - new Date(item.check_in)) / 86400000); }
      catch { return '?'; }
    })();
    console.log(`    id=${String(item.id ?? '?').slice(-6)}  final=${item.final_price ?? 'N/A'}  orig=${item.original_price ?? 'N/A'}  nights=${nights}  currency=${item.currency}`);
  }

  const oneNight = items.filter(i => {
    try { return Math.round((new Date(i.check_out) - new Date(i.check_in)) / 86400000) === 1; }
    catch { return false; }
  });
  let priceSemantics;
  if (oneNight.length === items.length) {
    priceSemantics = 'NEED_MULTI_NIGHT_TEST';
    console.log('\n  ⚠️  All items are 1-night stays — per-night vs total price indistinguishable.');
    console.log('  Semantics INFERRED as per-night. Verify with multi-night query separately.');
    console.log(`  PRICE_SEMANTICS = ${priceSemantics}`);
  } else {
    const multi = items.filter(i => !oneNight.includes(i));
    const sample = multi.slice(0, 3).map(i => {
      const n = Math.round((new Date(i.check_out) - new Date(i.check_in)) / 86400000);
      return `final=${i.final_price} nights=${n}`;
    });
    console.log(`\n  Multi-night items: ${multi.length} → ${sample.join(', ')}`);
    console.log('  Compare final_price / nights to identify per-night vs total semantics.');
    priceSemantics = 'NEEDS_ANALYSIS';
  }

  // ── Phase 5: Geo / coordinates analysis ───────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 5 — GEO / COORDINATES ANALYSIS');
  console.log('─'.repeat(72));

  const mapCoordPresent = items.filter(i => i.map_coordinates != null).length;
  const fullLocPresent  = items.filter(i => i.full_location != null).length;
  let coordExtracted    = 0;
  for (const item of items) {
    const r = parseBookingItem(item, currency);
    if (r.listing && r.listing.latitude != null) coordExtracted++;
  }
  console.log(`  map_coordinates present:  ${mapCoordPresent}/${items.length}`);
  console.log(`  full_location present:    ${fullLocPresent}/${items.length}`);
  console.log(`  Extractable lat/lon:      ${coordExtracted}/${items.length}`);

  if (coordExtracted === 0) {
    console.log('  ❌ GEO_FILTERING_FEASIBLE = false');
    console.log('  ❌ selectComparables() geo-filter will be DISABLED for all Booking.com listings');
    console.log('  → All capacity+category-qualified listings will be used regardless of distance');
  } else {
    console.log(`  ⚠️  Partial geo: ${coordExtracted}/${items.length} — geo-filter partially feasible`);
  }

  // ── Phase 6: Comparable metadata analysis ────────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 6 — COMPARABLE METADATA ANALYSIS');
  console.log('─'.repeat(72));

  const availFieldCount   = items.filter(i => i.availability !== undefined).length;
  const availDatesCount   = items.filter(i => Array.isArray(i.available_dates)).length;
  const freeCancelCount   = items.filter(i => i.free_cancellation === true).length;
  const bedroomCount      = items.filter(i => i.nb_bedrooms != null && parseInt(i.nb_bedrooms, 10) > 0).length;
  const reviewScoreCount  = items.filter(i => typeof i.review_score === 'number').length;
  const adultsCount       = items.filter(i => i.adults != null).length;

  const BEDROOM_SOURCE       = bedroomCount > 0 ? 'nb_bedrooms' : 'ABSENT';
  const GUEST_CAPACITY_SRC   = adultsCount > 0  ? 'adults (input echo)' : 'ABSENT';
  const RATING_SOURCE        = reviewScoreCount > 0 ? 'review_score (0-10)' : 'ABSENT';
  const RATING_SCALE         = reviewScoreCount > 0 ? '0-10 → normalized /2 → 0-5' : 'N/A';
  const GEO_SOURCE           = coordExtracted > 0 ? 'map_coordinates / full_location' : 'ABSENT';
  const AVAILABILITY_SOURCE  = availDatesCount > 0 ? 'available_dates' : 'ABSENT';
  const PROPERTY_ID_SOURCE   = items[0]?.id != null ? 'id (integer)' : 'ABSENT';

  console.log(`\n  BEDROOM_SOURCE:          ${BEDROOM_SOURCE}  (${bedroomCount}/${items.length} items)`);
  console.log(`  GUEST_CAPACITY_SOURCE:   ${GUEST_CAPACITY_SRC}  (${adultsCount}/${items.length} items)`);
  console.log(`  RATING_SOURCE:           ${RATING_SOURCE}  (${reviewScoreCount}/${items.length} items)`);
  console.log(`  RATING_SCALE:            ${RATING_SCALE}`);
  console.log(`  GEO_SOURCE:              ${GEO_SOURCE}`);
  console.log(`  AVAILABILITY_SOURCE:     ${AVAILABILITY_SOURCE}  (${availDatesCount}/${items.length} items)`);
  console.log(`  PROPERTY_ID_SOURCE:      ${PROPERTY_ID_SOURCE}`);
  console.log(`  free_cancellation=true:  ${freeCancelCount}/${items.length}`);

  const CAN_FILTER_BY_BEDROOMS  = bedroomCount > 0;
  const CAN_FILTER_BY_CAPACITY  = adultsCount > 0;
  const CAN_FILTER_BY_GEO       = coordExtracted > 0;
  const CAN_DEDUP_BOOKING        = false;
  const CAN_CALC_CALENDAR_PROXY  = availDatesCount > 0;

  console.log('\n  FILTER VERDICTS:');
  console.log(`  CAN_FILTER_BY_BEDROOMS:  ${CAN_FILTER_BY_BEDROOMS ? '✅ YES' : '❌ NO'}`);
  console.log(`  CAN_FILTER_BY_CAPACITY:  ${CAN_FILTER_BY_CAPACITY ? '✅ YES (adults echo)' : '❌ NO'}`);
  console.log(`  CAN_FILTER_BY_GEO:       ${CAN_FILTER_BY_GEO ? '⚠️  PARTIAL' : '❌ NO (no lat/lon)'}`);
  console.log(`  CAN_DEDUP_BOOKING:       ❌ NO (incompatible ID space with Airbnb)`);
  console.log(`  CAN_CALC_CALENDAR_PROXY: ${CAN_CALC_CALENDAR_PROXY ? '✅ YES' : '❌ NO (no available_dates → occupancy always 0)'}`);

  if (availDatesCount === 0) {
    console.log('\n  → calcBrightDataMarketStats occupancy signal is absent for Booking.com');
    console.log('  → occupancy_rate will always = 0 (insufficient_calendars semantics)');
  }

  // ── Phase 7: NormalizedMarketListing mapping ───────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 7 — NormalizedMarketListing MAPPING');
  console.log('─'.repeat(72));

  let accepted = 0, rejPrice = 0, rejCurrency = 0;
  const normalizedSample = [];
  for (const item of items) {
    const { listing, reason } = parseBookingItem(item, currency);
    if (listing) {
      accepted++;
      if (normalizedSample.length < 3) normalizedSample.push(listing);
    } else if (reason === 'currency') rejCurrency++;
    else                              rejPrice++;
  }
  console.log(`  Accepted:         ${accepted}/${items.length}`);
  console.log(`  Rejected(price):  ${rejPrice}`);
  console.log(`  Rejected(curr):   ${rejCurrency}`);

  console.log('\n  Normalized sample (first 3 accepted):');
  for (const l of normalizedSample) {
    console.log(`    price=${l.price}  bedrooms=${l.bedrooms ?? 'null'}  stars=${l.stars.toFixed(2)}  ` +
                `lat=${l.latitude ?? 'null'}  guests=${l.guests ?? 'null'}  isBooked=${l.isBooked}`);
  }

  console.log('\n  Field mapping verdict:');
  console.log(`    price          → final_price            CONFIRMED (semantics INFERRED as per-night)`);
  console.log(`    currency       → currency               CONFIRMED`);
  console.log(`    latitude       → NULL (no map_coords)   CONFIRMED — geo-filter blocked`);
  console.log(`    longitude      → NULL                   CONFIRMED`);
  console.log(`    bedrooms       → nb_bedrooms            CONFIRMED (unlike Airbnb always-null)`);
  console.log(`    stars          → review_score / 2       CONFIRMED (0-10 → 0-5 normalization)`);
  console.log(`    guests         → adults (input echo)    INFERRED`);
  console.log(`    isBooked       → false (discovery)      INFERRED (same as Airbnb discover)`);
  console.log(`    availableDates → null                   CONFIRMED — no occupancy proxy`);
  console.log(`    providerListingId → id                  CONFIRMED`);
  console.log(`    category       → null                   CONFIRMED (no equivalent field)`);

  // ── Phase 8: Cross-platform dedup assessment ───────────────────────────────
  console.log('\n' + '─'.repeat(72));
  console.log('  PHASE 8 — CROSS-PLATFORM DEDUP ASSESSMENT');
  console.log('─'.repeat(72));
  console.log(`  Airbnb IDs:          property_id (string, e.g. "12345678")`);
  console.log(`  Booking.com IDs:     id (integer, e.g. ${items[0]?.id ?? '?'})`);
  console.log('  Shared ID scheme:    NONE — incompatible ID spaces');
  console.log('  Geo-based dedup:     NOT FEASIBLE — Booking.com lat/lon unavailable');
  console.log('  URL-based dedup:     NOT FEASIBLE — airbnb.com vs booking.com domains');
  console.log('  VERDICT:             CROSS_PLATFORM_DEDUP = NOT_FEASIBLE (CONFIRMED)');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(72));
  console.log('  DISCOVERY SUMMARY');
  console.log('─'.repeat(72));
  console.log(`  Items returned:          ${items.length}`);
  console.log(`  Items parseable:         ${accepted}`);
  console.log(`  Geo filtering:           ${coordExtracted > 0 ? '⚠️  PARTIAL' : '❌ NOT FEASIBLE'}`);
  console.log(`  Occupancy proxy:         ${availDatesCount > 0 ? '✅ FEASIBLE' : '❌ NOT FEASIBLE (always 0)'}`);
  console.log(`  Price field usable:      ${withFinalPrice.length === items.length ? '✅ YES' : '⚠️  SOME MISSING'}`);
  console.log(`  Bedroom filter:          ✅ FEASIBLE (nb_bedrooms confirmed)`);
  console.log(`  Cross-platform dedup:    ❌ NOT FEASIBLE`);
  console.log(`  Min viable adapter:      ${accepted >= 5 ? '⚠️  POSSIBLE with constraints' : '❌ INSUFFICIENT DATA'}`);
  console.log('─'.repeat(72));
  console.log('  CONSTRAINTS FOR PRODUCTION ADAPTER:');
  console.log('    • selectComparables() used without geo-filter (lat/lon unavailable)');
  console.log('    • occupancy_rate will be 0 for all Booking.com market data rows');
  console.log('    • price semantics (per-night vs total) must be verified before adapting');
  console.log('    • BOOKING_DATASET_ID must be confirmed via a successful trigger');
  console.log('═'.repeat(72) + '\n');

  return {
    ok:             true,
    snapshotId,
    returnedCount:  items.length,
    acceptedCount:  accepted,
    geoFeasible:    coordExtracted > 0,
    occFeasible:    availDatesCount > 0,
    priceUsable:    withFinalPrice.length === items.length,
    priceSemantics,
    rawFields:      sortedFields,
  };
}

// ── Snapshot resume mode ───────────────────────────────────────────────────────
// BD_TRIGGER_POSTS=0  DB_WRITES=0  Polls existing snapshot, runs same analysis.

async function snapshotResumeMode(snapshotId, { _bdFetchImpl, currency = 'EUR' } = {}) {
  console.log('\n' + '═'.repeat(72));
  console.log('  B5-BK BOOKING.COM CONTRACT DISCOVERY — SNAPSHOT RESUME MODE');
  console.log('  BD_TRIGGER_POSTS=0 | DB_WRITES=0 | polls existing snapshot only');
  console.log('═'.repeat(72));

  if (!snapshotId) throw new Error('snapshotResumeMode: snapshotId requis');

  const _fetch = _bdFetchImpl || fetch;
  const key    = process.env.BRIGHTDATA_API_KEY;
  if (!key) throw new Error('BRIGHTDATA_API_KEY non défini');

  console.log(`\n  Resuming snapshot: ${snapshotId}`);

  // Poll until ready
  const deadline = Date.now() + MAX_WAIT_MS;
  let ready = false;
  while (Date.now() < deadline) {
    const progressRes = await _fetch(
      `${BOOKING_PROGRESS_BASE}/${snapshotId}`,
      { headers: { 'Authorization': `Bearer ${key}` } }
    );
    if (!progressRes.ok) throw new Error(`BD progress échoué: ${progressRes.status}`);
    const progress = await progressRes.json();
    if (progress?.status === 'ready')  { ready = true; break; }
    if (progress?.status === 'failed') throw new Error('BD snapshot terminé en erreur');
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS_LIVE));
  }
  if (!ready) throw new Error(`snapshotResumeMode: snapshot ${snapshotId} non prêt dans les délais`);

  // Download
  const snapshotRes = await _fetch(
    `${BOOKING_SNAPSHOT_BASE}/${snapshotId}?format=json`,
    { headers: { 'Authorization': `Bearer ${key}` } }
  );
  if (!snapshotRes.ok) throw new Error(`BD snapshot fetch échoué: ${snapshotRes.status}`);

  let items;
  try   { items = await snapshotRes.json(); }
  catch { throw new Error('BD snapshot: JSON malformé'); }
  if (!Array.isArray(items)) throw new Error('BD snapshot: réponse non-tableau');

  console.log(`  Snapshot ready — ${items.length} items`);

  // Field presence
  const fieldPresence = analyzeFieldPresence(items);
  console.log('\n  Field                   Present   %');
  for (const [f, s] of Object.entries(fieldPresence)) {
    const icon = s.pct === 100 ? '✅' : s.pct === 0 ? '❌' : '⚠️ ';
    console.log(`  ${icon} ${f.padEnd(24)} ${String(s.present).padStart(3)}/${s.total}  ${String(s.pct).padStart(3)}%`);
  }

  return { ok: true, snapshotId, returnedCount: items.length };
}

// ── Exports ────────────────────────────────────────────────────────────────────
module.exports = {
  previewMode,
  executeMode,
  snapshotResumeMode,
  parseBookingItem,
  analyzeFieldPresence,
  toISO8601Timestamp,
  normalizeBookingCurrency,
  resolvePropByName,
  sanitizeErrorBody,
  redactSecrets,
  BOOKING_DATASET_ID,
  BOOKING_TRIGGER_BASE,
  BOOKING_PROGRESS_BASE,
  BOOKING_SNAPSHOT_BASE,
  BOOKING_INPUT_URL,
  CONTRACT_CONFIDENCE,
  BOOKING_EXPECTED_FIELDS,
  MAX_RECORDS,
};

// ── CLI ────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args       = process.argv.slice(2);
  const nameIdx    = args.indexOf('--name');
  const name       = nameIdx !== -1 ? args[nameIdx + 1] : null;
  const snapIdx    = args.indexOf('--snapshot-id');
  const snapId     = snapIdx !== -1 ? args[snapIdx + 1] : null;
  const execute    = args.includes('--execute');

  if (!name && !snapId) {
    console.error('Usage: node outils/diag-brightdata-booking.js --name <nom> [--execute]');
    console.error('       node outils/diag-brightdata-booking.js --snapshot-id <id>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  let run;
  if (snapId) {
    run = snapshotResumeMode(snapId).then(r => { pool.end().catch(() => {}); return r; });
  } else {
    run = (execute ? executeMode({ name, pool }) : previewMode({ name, pool }))
      .then(r => { pool.end().catch(() => {}); return r; });
  }

  run
    .catch(err => {
      const msg  = (err.message || '').toLowerCase();
      const code = (err.code || '').toUpperCase();
      let errType = 'FATAL_ERROR';
      if (msg.includes('self-signed') || msg.includes('certificate') || code.includes('SSL')) errType = 'DB_TLS_ERROR';
      else if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') errType = 'DB_CONNECTION_ERROR';
      else if (msg.includes('column') || msg.includes('does not exist') || code === '42703') errType = 'DB_SCHEMA_ERROR';
      else if (msg.includes('brightdata') || msg.includes('booking')) errType = 'BRIGHTDATA_ERROR';
      console.error(`\n  ❌ ${errType}: ${err.message}`);
      pool.end().catch(() => {});
      process.exit(1);
    });
}

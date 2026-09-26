'use strict';
/**
 * P1.2-B5-BK-F — Bright Data Booking.com Market Provider
 *
 * Adapter for Bright Data Booking.com dataset gd_m4bf7a917zfezv9d5 (Listings Search).
 * Implements the normalized provider interface parallel to services/providers/brightdata.js.
 *
 * SAFETY:
 *   DB_WRITES        = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0  — no channex import
 *   PRICING_WRITES   = 0  — no pricing-apply import
 *   ROUTING_DISABLED       — NOT wired into market-provider.js (BOOKING_PRODUCTION_ROUTING_ENABLED=NO)
 *
 * CONTRACT (confirmed in B5-BK-A/B/C/D/E/F):
 *   Dataset:          gd_m4bf7a917zfezv9d5
 *   Trigger type:     url_collection — NO type= or discover_by= query params
 *   Body:             [{ url: "https://www.booking.com", location, currency,
 *                        check_in (ISO8601), check_out (ISO8601), adults, rooms }]
 *   Price semantics:  final_price = STAY_TOTAL (CONFIRMED B5-BK-F)
 *                     nightly_price = final_price / requestedNights
 *   Geo:              map_coordinates.lat / .lon (CONFIRMED 10/10 in live M6 run)
 *   Bedrooms:         nb_bedrooms (integer > 0)
 *   Rating:           review_score 0-10 → /2 → 0-5
 *   Guests:           NULL — adults is input echo, not listing capacity
 *   Occupancy proxy:  NOT FEASIBLE — no available_dates
 *
 * NormalizedListing: { price (nightly), isBooked: false, bedrooms, stars,
 *                      providerListingId, latitude, longitude,
 *                      guests: null, category, availableDates: null }
 */

const BOOKING_DATASET_ID    = 'gd_m4bf7a917zfezv9d5';
const BOOKING_TRIGGER_BASE  = 'https://api.brightdata.com/datasets/v3/trigger';
const BOOKING_PROGRESS_BASE = 'https://api.brightdata.com/datasets/v3/progress';
const BOOKING_SNAPSHOT_BASE = 'https://api.brightdata.com/datasets/v3/snapshot';
const BOOKING_INPUT_URL     = 'https://www.booking.com';
const BOOKING_DEFAULT_ADULTS = 2;
const BOOKING_DEFAULT_ROOMS  = 1;

function normalizeCurrency(s) {
  return (s || '').trim().toUpperCase();
}

function validateISO(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

function toISO8601Timestamp(dateStr) {
  return dateStr + 'T00:00:00.000Z';
}

/**
 * Parse one Booking.com Bright Data record into a NormalizedMarketListing candidate.
 *
 * Price normalization: final_price / requestedNights (STAY_TOTAL confirmed).
 * No availability rejection — discovery results are implicitly available.
 *
 * @param {object} item              — raw Booking.com BD record
 * @param {string} requestedCurrency — ISO 4217
 * @param {number} requestedNights   — positive integer, used to normalize price
 *
 * @returns {{ listing: object|null, reason: 'price'|'currency'|null }}
 */
function parseBrightDataBookingItem(item, requestedCurrency, requestedNights) {
  if (!Number.isInteger(requestedNights) || requestedNights < 1) {
    throw new Error(`parseBrightDataBookingItem: requestedNights must be a positive integer, got ${requestedNights}`);
  }

  // Currency check
  const itemCurrency = normalizeCurrency(item.currency);
  if (!itemCurrency || itemCurrency !== normalizeCurrency(requestedCurrency)) {
    return { listing: null, reason: 'currency' };
  }

  // Price: final_price = STAY_TOTAL → divide by nights to get nightly
  const rawPrice = typeof item.final_price === 'number'
    ? item.final_price
    : parseFloat(item.final_price);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    return { listing: null, reason: 'price' };
  }
  const price = rawPrice / requestedNights;

  // Geo: map_coordinates.lat/lon (CONFIRMED present 10/10 in live M6 run)
  let latitude = null, longitude = null;
  if (item.map_coordinates != null && typeof item.map_coordinates === 'object') {
    const lat = parseFloat(item.map_coordinates.lat ?? item.map_coordinates.latitude);
    const lon = parseFloat(item.map_coordinates.lon ?? item.map_coordinates.lng ?? item.map_coordinates.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) { latitude = lat; longitude = lon; }
  }

  // Bedrooms: nb_bedrooms > 0 else null
  let bedrooms = null;
  if (item.nb_bedrooms != null) {
    const n = parseInt(item.nb_bedrooms, 10);
    if (n > 0) bedrooms = n;
  }

  // Rating: review_score 0-10 → normalize to 0-5 for NormalizedListing compat
  const rawScore = parseFloat(item.review_score);
  const stars    = Number.isFinite(rawScore) ? rawScore / 2 : 0;

  // Guests: null — adults is our input echoed back, not listing capacity
  const guests = null;

  // Category: property_type → lowercase if present
  let category = null;
  if (item.property_type != null) {
    const pt = String(item.property_type).trim();
    if (pt) category = pt.toLowerCase();
  }

  // Discovery = available for requested dates → isBooked always false
  const isBooked = false;

  // No available_dates → occupancy proxy NOT FEASIBLE
  const availableDates = null;

  return {
    listing: {
      price,
      isBooked,
      bedrooms,
      stars,
      providerListingId: item.id != null ? String(item.id) : null,
      latitude,
      longitude,
      guests,
      category,
      availableDates,
    },
    reason: null,
  };
}

/**
 * Scrape Booking.com listings via Bright Data dataset gd_m4bf7a917zfezv9d5.
 *
 * checkIn and checkOut are REQUIRED — requestedNights is derived from them.
 * Price normalization: final_price / requestedNights (STAY_TOTAL semantics confirmed).
 *
 * BOOKING_PRODUCTION_ROUTING_ENABLED = NO — do NOT call from market-provider.js yet.
 *
 * @param {string}   location
 * @param {number}   maxListings
 * @param {string}   requestedCurrency  — ISO 4217, mandatory
 * @param {object}   opts
 * @param {string}   opts.checkIn       — ISO YYYY-MM-DD, mandatory
 * @param {string}   opts.checkOut      — ISO YYYY-MM-DD, mandatory, must be > checkIn
 * @param {string}   [opts.apiKey]      — overrides BRIGHTDATA_API_KEY env var
 * @param {Function} [opts.fetchImpl]   — injectable for tests (no live calls in tests)
 * @param {number}   [opts.maxWaitMs=600000]
 * @param {number}   [opts.pollIntervalMs=10000]
 *
 * @returns {{
 *   listings:    NormalizedListing[],
 *   isMock:      false,
 *   provider:    'brightdata_booking',
 *   dataSource:  'brightdata_booking_live',
 *   diagnostics: { returnedCount, acceptedCount, rejectedPriceCount, rejectedCurrencyCount,
 *                  requestedNights }
 * }}
 */
async function scrapeWithBrightDataBooking(location, maxListings, requestedCurrency, opts = {}) {
  const {
    checkIn,
    checkOut,
    apiKey,
    fetchImpl,
    maxWaitMs      = 10 * 60 * 1000,
    pollIntervalMs = 10_000,
  } = opts;

  if (!requestedCurrency) throw new Error('requestedCurrency requis — aucun fallback autorisé');
  if (!checkIn)           throw new Error('checkIn requis (format YYYY-MM-DD)');
  if (!checkOut)          throw new Error('checkOut requis (format YYYY-MM-DD)');
  if (!validateISO(checkIn))  throw new Error(`checkIn invalide: "${checkIn}"`);
  if (!validateISO(checkOut)) throw new Error(`checkOut invalide: "${checkOut}"`);
  if (checkOut <= checkIn)    throw new Error('checkOut doit être strictement postérieur à checkIn');

  const requestedNights = Math.round(
    (new Date(checkOut + 'T00:00:00Z') - new Date(checkIn + 'T00:00:00Z')) / 86400000
  );
  if (requestedNights < 1) throw new Error('checkIn/checkOut: requestedNights calculé < 1');

  const key = apiKey || process.env.BRIGHTDATA_API_KEY;
  if (!key) throw new Error('BRIGHTDATA_API_KEY non défini');

  const _fetch  = fetchImpl || fetch;
  const safeMax = Math.min(Math.max(1, Math.floor(maxListings || 1)), 1000);

  // ── 1. Trigger url_collection job ────────────────────────────────────────────
  // B5-BK-C: no type= or discover_by= — url_collection is implicit for this dataset
  const triggerUrl = `${BOOKING_TRIGGER_BASE}?dataset_id=${BOOKING_DATASET_ID}&format=json` +
    `&limit_per_input=${safeMax}`;

  const triggerRes = await _fetch(triggerUrl, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      url:       BOOKING_INPUT_URL,
      location,
      currency:  normalizeCurrency(requestedCurrency),
      check_in:  toISO8601Timestamp(checkIn),
      check_out: toISO8601Timestamp(checkOut),
      adults:    BOOKING_DEFAULT_ADULTS,
      rooms:     BOOKING_DEFAULT_ROOMS,
    }]),
  });

  // Read body once to prevent double-read error
  const rawTriggerBody = await triggerRes.text().catch(() => '');

  if (!triggerRes.ok) {
    throw new Error(`Booking.com BD trigger échoué: ${triggerRes.status}`);
  }

  let triggerData;
  try   { triggerData = JSON.parse(rawTriggerBody); }
  catch { throw new Error('Booking.com BD trigger: réponse JSON malformée'); }

  const snapshotId = triggerData?.snapshot_id;
  if (!snapshotId) throw new Error('Booking.com BD trigger: snapshot_id absent de la réponse');

  // ── 2. Poll for completion ────────────────────────────────────────────────────
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

  // ── 3. Download snapshot ──────────────────────────────────────────────────────
  const snapshotRes = await _fetch(
    `${BOOKING_SNAPSHOT_BASE}/${snapshotId}?format=json`,
    { headers: { 'Authorization': `Bearer ${key}` } }
  );
  if (!snapshotRes.ok) throw new Error(`Booking.com BD snapshot fetch échoué: ${snapshotRes.status}`);

  let items;
  try   { items = await snapshotRes.json(); }
  catch { throw new Error('Booking.com BD snapshot: JSON malformé'); }
  if (!Array.isArray(items)) throw new Error('Booking.com BD snapshot: réponse non-tableau');

  // ── 4. Normalize listings ─────────────────────────────────────────────────────
  let rejectedPriceCount    = 0;
  let rejectedCurrencyCount = 0;
  const listings = [];

  for (const item of items) {
    const { listing, reason } = parseBrightDataBookingItem(item, requestedCurrency, requestedNights);
    if (listing) {
      listings.push(listing);
    } else if (reason === 'currency') { rejectedCurrencyCount++; }
    else                              { rejectedPriceCount++; }
  }

  return {
    listings,
    isMock:     false,
    provider:   'brightdata_booking',
    dataSource: 'brightdata_booking_live',
    diagnostics: {
      returnedCount:        items.length,
      acceptedCount:        listings.length,
      rejectedPriceCount,
      rejectedCurrencyCount,
      requestedNights,
    },
  };
}

module.exports = {
  parseBrightDataBookingItem,
  scrapeWithBrightDataBooking,
  BOOKING_DATASET_ID,
  BOOKING_TRIGGER_BASE,
  BOOKING_PROGRESS_BASE,
  BOOKING_SNAPSHOT_BASE,
  BOOKING_INPUT_URL,
  BOOKING_DEFAULT_ADULTS,
  BOOKING_DEFAULT_ROOMS,
};

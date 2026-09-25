#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-C — Bright Data Market Provider
 *
 * Adapter for Bright Data Airbnb dataset gd_ld7ll037kqy322v05.
 * Implements the normalized provider interface for use in services/market-provider.js.
 *
 * SAFETY:
 *   BRIGHTDATA_CALLS = 0 — all network calls guarded by injectable fetchImpl
 *   DB_WRITES        = 0 — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0 — no channex import
 *
 * REAL CONTRACT (observed in B5-A3 diagnostics):
 *   Dataset:        gd_ld7ll037kqy322v05
 *   Trigger:        POST /datasets/v3/trigger  (discover_new, discover_by=location)
 *   Canonical price: pricing_details.price_per_night  — the ONLY accepted price field
 *   Dates required: without check_in/check_out, pricing_details is null (unusable)
 *   Bedrooms:       no structured source found in observed dataset — always null
 *   Currency:       item.currency must match requestedCurrency (after normalization)
 *
 * NormalizedListing: { price: number, isBooked: boolean, bedrooms: null, stars: number }
 *
 * ── B5-D integration points ──────────────────────────────────────────────────
 * 1. Wire scrapeWithBrightData into services/market-provider.js provider selection.
 * 2. Add 'brightdata_live' to trusted sources in routes/market-data-resolver.js.
 * 3. Propagate { checkIn, checkOut } from the pricing cron's rolling date strategy.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BD_TRIGGER_BASE  = 'https://api.brightdata.com/datasets/v3/trigger';
const BD_PROGRESS_BASE = 'https://api.brightdata.com/datasets/v3/progress';
const BD_SNAPSHOT_BASE = 'https://api.brightdata.com/datasets/v3/snapshot';

const DATASET_ID = 'gd_ld7ll037kqy322v05';

function normalizeCurrency(s) {
  return (s || '').trim().toUpperCase();
}

function validateISO(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

/**
 * Parse one Bright Data record into a NormalizedListing or a rejection descriptor.
 *
 * Returns { listing: NormalizedListing, reason: null } on success.
 * Returns { listing: null, reason: 'price'|'currency'|'availability' } on rejection.
 *
 * Price rule: pricing_details.price_per_night ONLY.
 *   Never substitutes total_price, initial_price_per_night, price_without_fees, or nightly_price.
 * Bedrooms: always null — no reliable structured source in the observed dataset.
 *
 * Extended metadata (B5-F1 comparable selection):
 *   providerListingId, latitude, longitude, guests, category, availableDates
 *   These fields are preserved for the comparable filter and are ignored by calcMarketStats().
 */
function parseBrightDataItem(item, requestedCurrency) {
  // Currency: required and must match after normalization
  const itemCurrency = normalizeCurrency(item.currency);
  if (!itemCurrency || itemCurrency !== normalizeCurrency(requestedCurrency)) {
    return { listing: null, reason: 'currency' };
  }

  // Price: ONLY pricing_details.price_per_night
  const pd = item.pricing_details;
  if (!pd) return { listing: null, reason: 'price' };

  const price = parseFloat(pd.price_per_night);
  if (!Number.isFinite(price) || price <= 0) return { listing: null, reason: 'price' };

  // Availability: accept boolean true/false or strings "true"/"false" defensively.
  // NOTE: availability=true for discovery results means "available for requested dates",
  // NOT "generally unbooked". isBooked is preserved for backward compat but must NOT
  // be used as market occupancy for Bright Data — see B5-F1 / calcBrightDataMarketStats.
  const avail = item.availability;
  let isBooked;
  if      (avail === true  || avail === 'true')  isBooked = false;
  else if (avail === false || avail === 'false') isBooked = true;
  else return { listing: null, reason: 'availability' };

  const stars = (() => { const v = parseFloat(item.ratings); return Number.isFinite(v) ? v : 0; })();

  // ── Extended metadata for comparable selection (B5-F1) ──────────────────────
  const latitude  = (typeof item.lat  === 'number' && Number.isFinite(item.lat))  ? item.lat  : null;
  const longitude = (typeof item.long === 'number' && Number.isFinite(item.long)) ? item.long : null;

  const rawGuests = item.guests;
  let guests = null;
  if (typeof rawGuests === 'number' && Number.isFinite(rawGuests) && rawGuests > 0) {
    guests = Math.floor(rawGuests);
  } else if (typeof rawGuests === 'string') {
    const g = parseInt(rawGuests, 10);
    if (g > 0) guests = g;
  }

  const category = (typeof item.category === 'string' && item.category.trim())
    ? item.category.trim()
    : null;

  let availableDates = null;
  if (Array.isArray(item.available_dates)) {
    const valid = [...new Set(
      item.available_dates.filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    )].sort();
    availableDates = valid;
  }

  return {
    listing: {
      price, isBooked, bedrooms: null, stars,
      // Extended fields — ignored by calcMarketStats(), used by selectComparables()
      providerListingId: (item.property_id != null) ? String(item.property_id) : null,
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
 * Scrape Airbnb listings via Bright Data dataset gd_ld7ll037kqy322v05.
 *
 * checkIn and checkOut are REQUIRED — without dates the Bright Data response
 * returns pricing_details: null and no usable price can be extracted.
 * The adapter MUST NOT invent dates internally.
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
 *   provider:    'brightdata',
 *   dataSource:  'brightdata_live',
 *   diagnostics: { returnedCount, acceptedCount, rejectedPriceCount,
 *                  rejectedCurrencyCount, rejectedAvailabilityCount }
 * }}
 */
async function scrapeWithBrightData(location, maxListings, requestedCurrency, opts = {}) {
  const {
    checkIn,
    checkOut,
    apiKey,
    fetchImpl,
    maxWaitMs      = 10 * 60 * 1000,
    pollIntervalMs = 10_000,
  } = opts;

  // Validate before touching any secret or making any network call
  if (!requestedCurrency) throw new Error('requestedCurrency requis — aucun fallback autorisé');
  if (!checkIn)           throw new Error('checkIn requis (format YYYY-MM-DD)');
  if (!checkOut)          throw new Error('checkOut requis (format YYYY-MM-DD)');
  if (!validateISO(checkIn))  throw new Error(`checkIn invalide: "${checkIn}"`);
  if (!validateISO(checkOut)) throw new Error(`checkOut invalide: "${checkOut}"`);
  if (checkOut <= checkIn)    throw new Error('checkOut doit être strictement postérieur à checkIn');

  const key = apiKey || process.env.BRIGHTDATA_API_KEY;
  if (!key) throw new Error('BRIGHTDATA_API_KEY non défini');

  const _fetch  = fetchImpl || fetch;
  const safeMax = Math.min(Math.max(1, Math.floor(maxListings || 1)), 1000);

  // ── 1. Trigger discovery job ──────────────────────────────────────────────
  const triggerUrl = `${BD_TRIGGER_BASE}?dataset_id=${DATASET_ID}&format=json&type=discover_new&discover_by=location&limit_per_input=${safeMax}`;
  const triggerRes = await _fetch(triggerUrl, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([{
      location,
      currency:  normalizeCurrency(requestedCurrency),
      check_in:  checkIn,
      check_out: checkOut,
    }]),
  });

  if (!triggerRes.ok) throw new Error(`BrightData trigger échoué: ${triggerRes.status}`);

  let triggerData;
  try   { triggerData = await triggerRes.json(); }
  catch { throw new Error('BrightData trigger: réponse JSON malformée'); }

  const snapshotId = triggerData?.snapshot_id;
  if (!snapshotId) throw new Error('BrightData trigger: snapshot_id absent de la réponse');

  // ── 2. Poll for completion ────────────────────────────────────────────────
  const deadline = Date.now() + maxWaitMs;
  let ready = false;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const progressRes = await _fetch(
      `${BD_PROGRESS_BASE}/${snapshotId}`,
      { headers: { 'Authorization': `Bearer ${key}` } }
    );
    if (!progressRes.ok) throw new Error(`BrightData progress échoué: ${progressRes.status}`);
    const progress = await progressRes.json();
    if (progress?.status === 'ready')  { ready = true; break; }
    if (progress?.status === 'failed') throw new Error('BrightData snapshot terminé en erreur');
  }

  if (!ready) throw new Error('BrightData timeout: snapshot non prêt dans les délais');

  // ── 3. Download snapshot ──────────────────────────────────────────────────
  const snapshotRes = await _fetch(
    `${BD_SNAPSHOT_BASE}/${snapshotId}?format=json`,
    { headers: { 'Authorization': `Bearer ${key}` } }
  );
  if (!snapshotRes.ok) throw new Error(`BrightData snapshot fetch échoué: ${snapshotRes.status}`);

  let items;
  try   { items = await snapshotRes.json(); }
  catch { throw new Error('BrightData snapshot: JSON malformé'); }
  if (!Array.isArray(items)) throw new Error('BrightData snapshot: réponse non-tableau');

  // ── 4. Normalize listings ─────────────────────────────────────────────────
  let rejectedPriceCount        = 0;
  let rejectedCurrencyCount     = 0;
  let rejectedAvailabilityCount = 0;
  const listings = [];

  for (const item of items) {
    const { listing, reason } = parseBrightDataItem(item, requestedCurrency);
    if (listing) {
      listings.push(listing);
    } else if (reason === 'currency')    { rejectedCurrencyCount++; }
    else if (reason === 'availability')  { rejectedAvailabilityCount++; }
    else                                 { rejectedPriceCount++; }
  }

  return {
    listings,
    isMock:     false,
    provider:   'brightdata',
    dataSource: 'brightdata_live',
    diagnostics: {
      returnedCount:            items.length,
      acceptedCount:            listings.length,
      rejectedPriceCount,
      rejectedCurrencyCount,
      rejectedAvailabilityCount,
    },
  };
}

module.exports = {
  parseBrightDataItem,
  scrapeWithBrightData,
  DATASET_ID,
  BD_TRIGGER_BASE,
  BD_PROGRESS_BASE,
  BD_SNAPSHOT_BASE,
};

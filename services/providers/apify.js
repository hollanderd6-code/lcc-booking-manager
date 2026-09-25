#!/usr/bin/env node
'use strict';
/**
 * P1.2-B5-B — Apify Market Provider
 *
 * Standalone Apify scraper wrapped in the normalized provider interface.
 * Used by services/market-provider.js.
 *
 * Preserves exact behavior from routes/dynamic-pricing-cron.js:
 *   - parseApifyItem  → same multi-format price extraction + isBooked heuristic
 *   - getMockListings → same randomized spread around medianBase
 *   - scrapeApify     → same actor, same input shape, same poll loop, same dataset fetch
 *
 * SAFETY:
 *   BRIGHTDATA_CALLS = 0 — this module never references Bright Data
 *   DB_WRITES        = 0 — no DB connection, no pool
 *   CHANNEX_CALLS    = 0 — no channex import
 */

const APIFY_ACTOR_ID = 'tri_angle~airbnb-scraper';
const APIFY_BASE_URL = 'https://api.apify.com/v2';

/**
 * Parse one Apify item into a NormalizedListing { price, isBooked, bedrooms, stars }.
 * Returns null when no valid price is found.
 *
 * Supports multiple price shapes from different actor versions:
 *   item.price (number), item.price.rate.amount, item.price.total.amount,
 *   item.pricing.rate, item.nightly_price
 */
function parseApifyItem(item) {
  let price = null;
  if (typeof item.price === 'number') {
    price = item.price;
  } else if (item.price?.rate?.amount) {
    price = parseFloat(item.price.rate.amount);
  } else if (item.price?.total?.amount) {
    price = parseFloat(item.price.total.amount);
  } else if (item.pricing?.rate) {
    price = parseFloat(item.pricing.rate);
  } else if (item.nightly_price) {
    price = parseFloat(item.nightly_price);
  }

  if (!price || price <= 0) return null;

  const isBooked = item.isAvailable === false
    || item.available === false
    || (item.bookingDates && item.bookingDates.length > 20);

  return {
    price,
    isBooked,
    bedrooms: parseInt(item.bedrooms || item.bedroomsCount || 1),
    stars:    parseFloat(item.stars || item.rating || 0),
  };
}

/**
 * Generate realistic mock listings for offline testing and fallback.
 * Count: 40–70, occupancy: 40–85%, spread: ±30% around medianBase.
 */
function getMockListings(medianBase) {
  const count  = 40 + Math.floor(Math.random() * 30);
  const occ    = 40 + Math.floor(Math.random() * 45);
  const spread = 0.3;
  return Array.from({ length: count }, () => ({
    price:    Math.round(medianBase * (1 - spread + Math.random() * spread * 2)),
    isBooked: Math.random() * 100 < occ,
    bedrooms: 1 + Math.floor(Math.random() * 2),
    stars:    3.5 + Math.random() * 1.5,
  }));
}

/**
 * Scrape Airbnb listings via Apify actor tri_angle~airbnb-scraper.
 * Returns NormalizedListing[].
 * Throws on HTTP error or actor failure.
 *
 * requestedCurrency is mandatory — throws if absent (no silent EUR fallback).
 *
 * @param {string}   location
 * @param {number}   maxListings
 * @param {string}   requestedCurrency — ISO 4217, e.g. 'EUR'
 * @param {Function} [fetchFn]         — injectable for tests (default: global fetch)
 */
async function scrapeApify(location, maxListings, requestedCurrency, fetchFn) {
  if (!requestedCurrency) throw new Error('requestedCurrency requis — aucun fallback EUR autorisé');
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN non défini');

  const _fetch = fetchFn || fetch;

  // 1. Start run
  const startRes = await _fetch(
    `${APIFY_BASE_URL}/acts/${APIFY_ACTOR_ID}/runs?token=${token}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        locationQueries:    [location],
        currency:           requestedCurrency,
        locale:             'fr-FR',
        maxListings,
        enrichUserProfiles: false,
        startUrls:          [],
      }),
    }
  );

  if (!startRes.ok) {
    const err = await startRes.text();
    throw new Error(`Apify start failed: ${startRes.status} — ${err}`);
  }

  const { data: runData } = await startRes.json();
  const runId     = runData.id;
  const datasetId = runData.defaultDatasetId;

  // 2. Poll for completion (max 10 min, every 10s)
  const maxPoll = 60;
  for (let i = 0; i < maxPoll; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const statusRes        = await _fetch(`${APIFY_BASE_URL}/actor-runs/${runId}?token=${token}`);
    const { data: status } = await statusRes.json();
    if (status.status === 'SUCCEEDED') break;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status.status)) {
      throw new Error(`Run Apify terminé en erreur: ${status.status}`);
    }
  }

  // 3. Download results
  const itemsRes = await _fetch(
    `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${token}&format=json&limit=${maxListings}`
  );
  if (!itemsRes.ok) throw new Error(`Apify dataset fetch failed: ${itemsRes.status}`);
  const items = await itemsRes.json();

  return items.map(parseApifyItem).filter(Boolean);
}

/**
 * Scrape a single zone with Apify, falling back to mock when APIFY_TOKEN is absent or on error.
 *
 * Returns normalized provider result:
 *   { listings: NormalizedListing[], isMock: boolean, provider: 'apify', dataSource: string }
 *
 * dataSource = 'apify_live' on live success, 'mock' on mock/fallback.
 *
 * @param {string}   location
 * @param {number}   maxListings
 * @param {string}   requestedCurrency
 * @param {number}   medianFallback — base price for mock generation
 * @param {Function} [fetchFn]      — injectable for tests
 */
async function scrapeZoneApify(location, maxListings, requestedCurrency, medianFallback, fetchFn) {
  const mockMode = !process.env.APIFY_TOKEN;

  if (mockMode) {
    return {
      listings:   getMockListings(medianFallback),
      isMock:     true,
      provider:   'apify',
      dataSource: 'mock',
    };
  }

  try {
    const listings = await scrapeApify(location, maxListings, requestedCurrency, fetchFn);
    return {
      listings,
      isMock:     false,
      provider:   'apify',
      dataSource: 'apify_live',
    };
  } catch (err) {
    console.error(`❌ [ApifyProvider] Error pour "${location}":`, err.message);
    return {
      listings:   getMockListings(medianFallback),
      isMock:     true,
      provider:   'apify',
      dataSource: 'mock',
    };
  }
}

module.exports = {
  parseApifyItem,
  getMockListings,
  scrapeApify,
  scrapeZoneApify,
  APIFY_ACTOR_ID,
  APIFY_BASE_URL,
};

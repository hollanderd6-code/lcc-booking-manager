'use strict';
/**
 * P1.2-B5-B — Market Provider Abstraction
 *
 * Single entry point for market listing scraping.
 * Currently delegates exclusively to the Apify provider.
 *
 * SAFETY:
 *   BRIGHTDATA_CALLS    = 0 — Bright Data provider NOT activated (no BRIGHTDATA_API_KEY use)
 *   DB_WRITES           = 0 — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS       = 0 — no channex import
 *
 * Normalized provider result:
 *   {
 *     listings:   NormalizedListing[],
 *     isMock:     boolean,
 *     provider:   'apify',              // 'brightdata' in B5-C
 *     dataSource: 'apify_live'|'mock',  // 'brightdata_live' in B5-C
 *   }
 *
 * NormalizedListing: { price: number, isBooked: boolean, bedrooms: number|null, stars: number }
 *
 * ── B5-C integration points ──────────────────────────────────────────────────
 * 1. Add services/providers/brightdata.js following the scrapeZoneApify contract.
 * 2. Add provider selection here: e.g. process.env.MARKET_PROVIDER === 'brightdata'.
 * 3. Rolling date strategy: inject { checkIn, checkOut } into opts for Bright Data.
 * 4. Bedrooms rule: Bright Data bedrooms MUST remain null if absent.
 * 5. Currency rule: every usable listing MUST have normalize(currency) === requestedCurrency.
 *    A mismatch MUST NOT enter market statistics.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const apifyProvider = require('./providers/apify');

/**
 * Scrape market listings for one location using the configured provider.
 *
 * @param {string}   location          — e.g. "Massy, France"
 * @param {number}   maxListings       — maximum records to fetch
 * @param {string}   requestedCurrency — ISO 4217, mandatory (no silent EUR fallback)
 * @param {object}   [opts]
 * @param {number}   [opts.medianFallback=80] — base price for mock data generation
 * @param {Function} [opts.fetchFn]           — injectable fetch for tests (no real calls)
 */
async function scrape(location, maxListings, requestedCurrency, opts = {}) {
  if (!requestedCurrency) throw new Error('requestedCurrency requis — aucun fallback EUR autorisé');

  const { medianFallback = 80, fetchFn } = opts;

  // B5-C: add provider selection here before delegating.
  return apifyProvider.scrapeZoneApify(location, maxListings, requestedCurrency, medianFallback, fetchFn);
}

module.exports = { scrape };

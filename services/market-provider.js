'use strict';
/**
 * P1.2-B5-D — Market Provider Abstraction (dual-provider + feature flag)
 *
 * Single entry point for market listing scraping.
 * Provider selection via MARKET_PRIMARY_PROVIDER env var.
 *
 * SAFETY:
 *   BRIGHTDATA_CALLS    = 0 — all network calls guarded by injectable fetch opts
 *   DB_WRITES           = 0 — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS       = 0 — no channex import
 *
 * Provider selection (MARKET_PRIMARY_PROVIDER):
 *   'brightdata' → Bright Data first, falls back to Apify on failure/empty result
 *   anything else (including missing/invalid) → Apify  (DEFAULT, zero production change)
 *
 * Normalized provider result:
 *   {
 *     listings:    NormalizedListing[],
 *     isMock:      boolean,
 *     provider:    'apify'|'brightdata',
 *     dataSource:  'apify_live'|'brightdata_live'|'mock',
 *     diagnostics?: object,   — present when Bright Data was used
 *   }
 *
 * NormalizedListing: { price: number, isBooked: boolean, bedrooms: number|null, stars: number }
 *
 * ── B5-D date strategy ───────────────────────────────────────────────────────
 *   getBrightDataMarketDates({ timezone, now? }):
 *     checkIn  = local today + 14 calendar days  (in property's timezone)
 *     checkOut = checkIn + 1 calendar day
 *   Dates are derived by the orchestration layer, never inside brightdata.js.
 *
 * ── B5-E integration points ──────────────────────────────────────────────────
 * 1. Rolling date horizons (J+7, J+30) — pass multiple checkIn/checkOut windows.
 * 2. Multi-horizon median aggregation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const apifyProvider      = require('./providers/apify');
const brightdataProvider = require('./providers/brightdata');

// ── Date strategy ─────────────────────────────────────────────────────────────

/**
 * Compute the market observation dates for Bright Data.
 *
 * checkIn  = local today + 14 calendar days (in the property's timezone)
 * checkOut = checkIn + 1 calendar day
 *
 * Uses the property's IANA timezone so the local calendar date is correct
 * even when the wall clock crosses midnight in a different timezone.
 *
 * @param {object} opts
 * @param {string} [opts.timezone='Europe/Paris'] — IANA timezone name
 * @param {Date}   [opts.now]                     — injectable clock for tests
 * @returns {{ checkIn: string, checkOut: string }} — ISO YYYY-MM-DD
 */
function getBrightDataMarketDates({ timezone = 'Europe/Paris', now = new Date() } = {}) {
  // Determine the local calendar date in the property's timezone.
  // en-CA locale produces a YYYY-MM-DD string directly.
  const localToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  // Add 14 and 15 calendar days using UTC arithmetic (prevents DST shifting the date).
  const base     = new Date(localToday + 'T00:00:00Z');
  const checkIn  = new Date(base);
  checkIn.setUTCDate(base.getUTCDate() + 14);
  const checkOut = new Date(checkIn);
  checkOut.setUTCDate(checkIn.getUTCDate() + 1);

  return {
    checkIn:  checkIn.toISOString().slice(0, 10),
    checkOut: checkOut.toISOString().slice(0, 10),
  };
}

// ── Provider selection ────────────────────────────────────────────────────────

/**
 * Resolve the active market provider from env.
 * Any missing/empty/invalid value safely returns 'apify'.
 * BRIGHTDATA_API_KEY presence alone does NOT activate Bright Data.
 *
 * @returns {'apify'|'brightdata'}
 */
function resolveProvider() {
  const raw = (process.env.MARKET_PRIMARY_PROVIDER || '').trim().toLowerCase();
  return raw === 'brightdata' ? 'brightdata' : 'apify';
}

// ── Main scrape entry point ───────────────────────────────────────────────────

/**
 * Scrape market listings for one location using the configured provider.
 *
 * Provider selection:
 *   MARKET_PRIMARY_PROVIDER=brightdata → Bright Data → Apify fallback → mock
 *   MARKET_PRIMARY_PROVIDER=apify (default) → Apify → mock
 *
 * @param {string}   location
 * @param {number}   maxListings
 * @param {string}   requestedCurrency      — ISO 4217, mandatory
 * @param {object}   [opts]
 * @param {number}   [opts.medianFallback=80] — base price for mock generation
 * @param {Function} [opts.fetchFn]           — injectable fetch for Apify tests
 * @param {Function} [opts.bdFetchImpl]       — injectable fetch for Bright Data tests
 * @param {string}   [opts.bdApiKey]          — injectable API key for Bright Data tests
 * @param {string}   [opts.timezone='Europe/Paris'] — property timezone for date strategy
 * @param {Date}     [opts.now]              — injectable clock for date strategy tests
 */
async function scrape(location, maxListings, requestedCurrency, opts = {}) {
  if (!requestedCurrency) throw new Error('requestedCurrency requis — aucun fallback EUR autorisé');

  const {
    medianFallback = 80,
    fetchFn,
    bdFetchImpl,
    bdApiKey,
    timezone = 'Europe/Paris',
    now,
  } = opts;

  const provider = resolveProvider();

  if (provider === 'brightdata') {
    const { checkIn, checkOut } = getBrightDataMarketDates({ timezone, now });
    try {
      const bdResult = await brightdataProvider.scrapeWithBrightData(
        location, maxListings, requestedCurrency,
        { checkIn, checkOut, fetchImpl: bdFetchImpl, apiKey: bdApiKey }
      );
      if (bdResult.listings.length > 0) {
        // Bright Data succeeded with usable listings — do NOT call Apify.
        return bdResult;
      }
      console.warn(`⚠️ [market-provider] Bright Data: 0 listings utilisables pour "${location}" — fallback Apify`);
    } catch (err) {
      console.error(`❌ [market-provider] Bright Data erreur pour "${location}": ${err.message} — fallback Apify`);
    }
    // Fall through to Apify
  }

  // Apify (default path or fallback from Bright Data)
  return apifyProvider.scrapeZoneApify(location, maxListings, requestedCurrency, medianFallback, fetchFn);
}

module.exports = { scrape, getBrightDataMarketDates, resolveProvider };

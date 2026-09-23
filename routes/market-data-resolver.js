'use strict';
/**
 * Market Data Resolver — P1.0-B
 *
 * Single source of truth for market snapshot trust + freshness.
 *
 * Invariants:
 *   • Only exact data_source='apify_live' is considered trusted.
 *   • Trusted + fresh (age < MARKET_TTL_DAYS)  → usable=true  → market passed to engine.
 *   • Trusted + stale (age >= MARKET_TTL_DAYS) → usable=false → market=null (neutral).
 *   • Any untrusted source (mock/unknown/invalid) → usable=false → market=null.
 *   • No row at all → status='missing' → usable=false → market=null (neutral, not untrusted).
 *   • Invalid or future scraped_at on trusted row → treated as stale (fail-safe).
 *
 * Missing ≠ untrusted. Missing means "no market signal" — BoostPrice continues
 * normally and auto-push is allowed. Untrusted means "a snapshot exists but its
 * provenance is not verified" — auto-push is blocked.
 *
 * The TTL boundary is strict: age < TTL_MS → fresh; age >= TTL_MS → stale.
 *
 * Clock skew: freshness is computed from the `now` parameter (injectable for
 * tests). We allow up to CLOCK_SKEW_TOLERANCE_MS (5 min) of forward drift before
 * treating a future scraped_at as a clock anomaly and falling back to stale.
 * This handles minor NTP drift without conferring unlimited trust on absurd dates.
 */

const MARKET_TTL_DAYS       = 14;
const MARKET_TTL_MS         = MARKET_TTL_DAYS * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * resolveMarketData(pool, { propertyId, now? })
 *
 * Reads the single most-recent market_data row for a property and classifies it.
 * Intentionally reads ANY latest row (no data_source filter in the SELECT)
 * so that a recent mock is detected and classified, not silently bypassed in
 * favour of an older live row.
 *
 * @param {object} pool  — pg Pool or PoolClient
 * @param {string} opts.propertyId
 * @param {Date}   [opts.now]  — override current time (for tests)
 *
 * @returns {MarketResolution}
 */
async function resolveMarketData(pool, { propertyId, now } = {}) {
  const nowMs = (now instanceof Date ? now : new Date()).getTime();

  const row = (await pool.query(
    `SELECT median_price, price_p25, price_p75,
            occupancy_rate, comparable_count, tension_level,
            data_source, scraped_at, week_start
       FROM market_data
      WHERE property_id = $1
      ORDER BY week_start DESC, scraped_at DESC
      LIMIT 1`,
    [propertyId]
  )).rows[0] || null;

  if (!row) {
    return {
      row:     null,
      status:  'missing',
      trusted: false,
      fresh:   false,
      usable:  false,
      ageMs:   null,
      ageDays: null,
      market:  null,
    };
  }

  const trusted = row.data_source === 'apify_live';

  if (!trusted) {
    const knownStatus = { mock: 'mock', unknown: 'unknown' };
    const status = knownStatus[row.data_source] ?? 'invalid';
    return {
      row, status, trusted: false, fresh: false, usable: false,
      ageMs: null, ageDays: null, market: null,
    };
  }

  // Trusted (apify_live) — evaluate freshness
  const scrapedAt  = row.scraped_at ? new Date(row.scraped_at) : null;
  const scrapedMs  = scrapedAt && !isNaN(scrapedAt.getTime()) ? scrapedAt.getTime() : null;

  if (scrapedMs === null) {
    // Invalid or missing timestamp on trusted row → treat as stale (fail-safe)
    return {
      row, status: 'live_stale', trusted: true, fresh: false, usable: false,
      ageMs: null, ageDays: null, market: null,
    };
  }

  const ageMs = nowMs - scrapedMs;

  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    // Timestamp more than 5 min in the future → clock anomaly → stale (fail-safe)
    return {
      row, status: 'live_stale', trusted: true, fresh: false, usable: false,
      ageMs, ageDays: ageMs / (24 * 60 * 60 * 1000), market: null,
    };
  }

  // For negative ageMs within tolerance, clamp to 0 (minor NTP drift → treat as age=0 → fresh)
  const effectiveAgeMs = Math.max(0, ageMs);
  const ageDays        = effectiveAgeMs / (24 * 60 * 60 * 1000);
  const fresh          = effectiveAgeMs < MARKET_TTL_MS;

  if (!fresh) {
    return {
      row, status: 'live_stale', trusted: true, fresh: false, usable: false,
      ageMs: effectiveAgeMs, ageDays, market: null,
    };
  }

  // Fresh and trusted — build usable market object
  const market = {
    median:           row.median_price != null ? parseFloat(row.median_price) : null,
    occupancy_rate:   row.occupancy_rate,
    comparable_count: row.comparable_count,
    tension_level:    row.tension_level,
    tensionLevel:     row.tension_level,
  };

  return {
    row, status: 'live_fresh', trusted: true, fresh: true, usable: true,
    ageMs: effectiveAgeMs, ageDays, market,
  };
}

module.exports = { resolveMarketData, MARKET_TTL_DAYS, MARKET_TTL_MS };

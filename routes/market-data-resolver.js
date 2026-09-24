'use strict';
/**
 * Market Data Resolver — P1.0-B / P1.1-C3B
 *
 * Single source of truth for market snapshot trust + freshness + location compatibility.
 *
 * Classification pipeline:
 *   1. No row               → missing   (neutral, push allowed)
 *   2. Untrusted provenance  → mock / unknown / invalid (push blocked — P1.0-A)
 *   3. Trusted, bad clock    → live_stale (neutral, push allowed)
 *   4. Trusted, valid clock:
 *      propertyContextKey provided:
 *        row key = null              → legacy_unverified_location (neutral, push allowed)
 *        row key ≠ property key      → live_wrong_location        (neutral, push allowed)
 *        row key = property key      → live_fresh / live_stale    (standard freshness)
 *      propertyContextKey absent:
 *        row key ≠ null              → context_unavailable        (neutral, push allowed)
 *        row key = null              → live_fresh / live_stale    (legacy P1.0-B behavior)
 *
 * Location-specific statuses (wrong/legacy/unavailable):
 *   trusted=true  (provenance preserved)
 *   usable=false  (market never reaches engine)
 *   isMock = !trusted && status !== 'missing' → false for all three
 *   auto-push remains allowed
 *
 * Provenance always wins before location (B11):
 *   mock/unknown/invalid rows never receive a location-specific status.
 */

const MARKET_TTL_DAYS         = 14;
const MARKET_TTL_MS           = MARKET_TTL_DAYS * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * resolveMarketData(pool, { propertyId, propertyContextKey?, now? })
 *
 * Reads the single most-recent market_data row for a property (latest week_start,
 * then latest scraped_at — no data_source pre-filter) and classifies it.
 *
 * @param {object} pool
 * @param {string} opts.propertyId
 * @param {string|null} [opts.propertyContextKey] — from computeMarketContextKey(); null = no geo
 * @param {Date}        [opts.now]                — override current time (tests only)
 */
async function resolveMarketData(pool, { propertyId, propertyContextKey, now } = {}) {
  const nowMs       = (now instanceof Date ? now : new Date()).getTime();
  const propCtxKey  = propertyContextKey ?? null;

  const row = (await pool.query(
    `SELECT median_price, price_p25, price_p75,
            occupancy_rate, comparable_count, tension_level,
            data_source, scraped_at, week_start, market_context_key
       FROM market_data
      WHERE property_id = $1
      ORDER BY week_start DESC, scraped_at DESC
      LIMIT 1`,
    [propertyId]
  )).rows[0] || null;

  if (!row) {
    return { row: null, status: 'missing', trusted: false, fresh: false, usable: false,
             ageMs: null, ageDays: null, market: null, locationCompatible: null };
  }

  // ── Step 1: Provenance (B11 — provenance wins before location) ───────────────
  const trusted = row.data_source === 'apify_live';
  if (!trusted) {
    const knownStatus = { mock: 'mock', unknown: 'unknown' };
    const status = knownStatus[row.data_source] ?? 'invalid';
    return { row, status, trusted: false, fresh: false, usable: false,
             ageMs: null, ageDays: null, market: null, locationCompatible: null };
  }

  // ── Step 2: Timestamp validity ────────────────────────────────────────────────
  const scrapedAt = row.scraped_at ? new Date(row.scraped_at) : null;
  const scrapedMs = scrapedAt && !isNaN(scrapedAt.getTime()) ? scrapedAt.getTime() : null;

  if (scrapedMs === null) {
    return { row, status: 'live_stale', trusted: true, fresh: false, usable: false,
             ageMs: null, ageDays: null, market: null, locationCompatible: null };
  }

  const ageMs = nowMs - scrapedMs;

  if (ageMs < -CLOCK_SKEW_TOLERANCE_MS) {
    return { row, status: 'live_stale', trusted: true, fresh: false, usable: false,
             ageMs, ageDays: ageMs / (24 * 60 * 60 * 1000), market: null, locationCompatible: null };
  }

  const effectiveAgeMs = Math.max(0, ageMs);
  const ageDays        = effectiveAgeMs / (24 * 60 * 60 * 1000);
  const fresh          = effectiveAgeMs < MARKET_TTL_MS;

  // ── Step 3: Location compatibility (B5–B10) ───────────────────────────────────
  const rowCtxKey = row.market_context_key ?? null;

  if (propCtxKey !== null) {
    // Property has complete geo — apply location check
    if (rowCtxKey === null) {
      // Row predates context capture (legacy NULL) — B8
      return { row, status: 'legacy_unverified_location', trusted: true, fresh, usable: false,
               ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: false };
    }
    if (rowCtxKey !== propCtxKey) {
      // Row was scraped for a different location — B7
      return { row, status: 'live_wrong_location', trusted: true, fresh, usable: false,
               ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: false };
    }
    // Keys match — location compatible (B6), fall through to freshness
  } else {
    // Property has no geo — legacy compatibility (B9/B10)
    if (rowCtxKey !== null) {
      // Row has a context key but property geo is unknown — B10
      return { row, status: 'context_unavailable', trusted: true, fresh, usable: false,
               ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: null };
    }
    // Both null — legacy behavior, fall through to freshness
  }

  // ── Step 4: Freshness ─────────────────────────────────────────────────────────
  if (!fresh) {
    return { row, status: 'live_stale', trusted: true, fresh: false, usable: false,
             ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: true };
  }

  const market = {
    median:           row.median_price != null ? parseFloat(row.median_price) : null,
    occupancy_rate:   row.occupancy_rate,
    comparable_count: row.comparable_count,
    tension_level:    row.tension_level,
    tensionLevel:     row.tension_level,
  };

  return { row, status: 'live_fresh', trusted: true, fresh: true, usable: true,
           ageMs: effectiveAgeMs, ageDays, market, locationCompatible: true };
}

module.exports = { resolveMarketData, MARKET_TTL_DAYS, MARKET_TTL_MS };

'use strict';
/**
 * Market Data Resolver — P1.0-B / P1.1-C3B / P1.2-B4-B
 *
 * Single source of truth for market snapshot trust + freshness + location + currency.
 *
 * Classification pipeline:
 *   1. No row               → missing   (neutral, push allowed)
 *   2. Untrusted provenance  → mock / unknown / invalid (push blocked — P1.0-A)
 *   3. Trusted, bad clock    → live_stale (neutral, push allowed)
 *   4. Trusted, valid clock:
 *      propertyContextKey provided:
 *        row key = null              → legacy_unverified_location (neutral, push allowed)
 *        row key ≠ property key      → live_wrong_location        (neutral, push allowed)
 *        row key = property key      → currency check (step 5-7), then freshness
 *      propertyContextKey absent:
 *        row key ≠ null              → context_unavailable        (neutral, push allowed)
 *        row key = null              → currency check (step 5-7), then freshness
 *   5. (currency check active) propertyCurrency null → property_currency_unknown (neutral, push allowed)
 *   6. (currency check active) row.currency null     → market_currency_unknown   (neutral, push allowed)
 *   7. (currency check active) currencies differ     → currency_mismatch         (neutral, push allowed)
 *   8. age > TTL             → live_stale (neutral, push allowed)
 *   9. all checks pass       → live_fresh (usable, push allowed)
 *
 * Currency check (B4-B):
 *   Active only when propertyCurrency is explicitly provided (not undefined).
 *   Passing undefined is backward-compatible: no currency classification performed.
 *   Passing null means the property has no known currency → property_currency_unknown.
 *   Currency statuses: trusted=true, usable=false, market=null, isMock=false.
 *   Auto-push remains allowed — BoostPrice uses non-market signals only.
 *
 * Location-specific statuses (wrong/legacy/unavailable):
 *   trusted=true, usable=false, market=null, isMock=false, push allowed.
 *
 * Provenance always wins before location (B11):
 *   mock/unknown/invalid rows never receive a location-specific status.
 */

const MARKET_TTL_DAYS         = 14;
const MARKET_TTL_MS           = MARKET_TTL_DAYS * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Normalize a value to strict ISO 4217 alpha-3 uppercase, or null.
 * Returns null for: null, undefined, empty string, non-alpha-3, wrong length.
 */
function normalizeCurrency(value) {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

/**
 * classifyMarketData(row, { propertyContextKey?, propertyCurrency?, now? })
 *
 * Pure classifier — takes an already-fetched market_data row (or null) and
 * returns the same resolution shape as resolveMarketData.  Zero DB queries.
 * Callers that already have the row (e.g. dashboard batch query) use this
 * directly to avoid N+1 queries.
 *
 * @param {object|null} row         — raw market_data DB row, or null if absent
 * @param {string|null} [opts.propertyContextKey] — from computeMarketContextKey()
 * @param {string|null} [opts.propertyCurrency]   — from properties.currency; omit for backward compat
 * @param {Date}        [opts.now]                — override current time (tests only)
 */
function classifyMarketData(row, { propertyContextKey, propertyCurrency, now } = {}) {
  const nowMs      = (now instanceof Date ? now : new Date()).getTime();
  const propCtxKey = propertyContextKey ?? null;

  // Currency check is only active when propertyCurrency is explicitly provided (not undefined).
  // undefined = caller predates B4-B and does not participate in currency classification.
  // null = property has no known valid currency → property_currency_unknown.
  const currencyCheckActive = propertyCurrency !== undefined;
  const propCurr = currencyCheckActive ? normalizeCurrency(propertyCurrency) : null;

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
    // Keys match — location compatible (B6), fall through to currency
  } else {
    // Property has no geo — legacy compatibility (B9/B10)
    if (rowCtxKey !== null) {
      // Row has a context key but property geo is unknown — B10
      return { row, status: 'context_unavailable', trusted: true, fresh, usable: false,
               ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: null };
    }
    // Both null — legacy behavior, fall through to currency
  }

  // ── Step 4: Currency compatibility (B4-B) ─────────────────────────────────────
  // Only runs when propertyCurrency was explicitly provided by the caller.
  if (currencyCheckActive) {
    const rowCurr = normalizeCurrency(row.currency);

    if (propCurr === null) {
      return { row, status: 'property_currency_unknown', trusted: true, fresh, usable: false,
               ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: true,
               propertyCurrency: null, marketCurrency: rowCurr, refreshRequired: false };
    }
    if (rowCurr === null) {
      return { row, status: 'market_currency_unknown', trusted: true, fresh, usable: false,
               ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: true,
               propertyCurrency: propCurr, marketCurrency: null, refreshRequired: true };
    }
    if (rowCurr !== propCurr) {
      return { row, status: 'currency_mismatch', trusted: true, fresh, usable: false,
               ageMs: effectiveAgeMs, ageDays, market: null, locationCompatible: true,
               propertyCurrency: propCurr, marketCurrency: rowCurr, refreshRequired: true };
    }
    // Currencies match — fall through to freshness
  }

  // ── Step 5: Freshness ─────────────────────────────────────────────────────────
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

/**
 * resolveMarketData(pool, { propertyId, propertyContextKey?, propertyCurrency?, now? })
 *
 * Fetches the most-recent market_data row for a property (latest week_start,
 * then latest scraped_at) and classifies it via classifyMarketData.
 * Callers that already have the row should call classifyMarketData directly.
 *
 * @param {object} pool
 * @param {string} opts.propertyId
 * @param {string|null}    [opts.propertyContextKey] — from computeMarketContextKey(); null = no geo
 * @param {string|null}    [opts.propertyCurrency]   — from properties.currency; omit for backward compat
 * @param {Date}           [opts.now]                — override current time (tests only)
 */
async function resolveMarketData(pool, { propertyId, propertyContextKey, propertyCurrency, now } = {}) {
  const row = (await pool.query(
    `SELECT median_price, price_p25, price_p75,
            occupancy_rate, comparable_count, tension_level,
            data_source, scraped_at, week_start, market_context_key, currency
       FROM market_data
      WHERE property_id = $1
      ORDER BY week_start DESC, scraped_at DESC
      LIMIT 1`,
    [propertyId]
  )).rows[0] || null;

  return classifyMarketData(row, { propertyContextKey, propertyCurrency, now });
}

module.exports = { resolveMarketData, classifyMarketData, MARKET_TTL_DAYS, MARKET_TTL_MS, normalizeCurrency };

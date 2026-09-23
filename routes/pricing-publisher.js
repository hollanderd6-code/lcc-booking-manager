'use strict';
/**
 * Effective Pricing Publisher — P0-C1
 *
 * Resolves the canonical effective price for each date in a range (via P0-A
 * resolver) and publishes to Channex via pushRates + pushRestrictions.
 *
 * Invariants:
 *   • Prices come EXCLUSIVELY from the just-in-time resolver. The caller
 *     cannot inject rates, prices, or a pre-computed schedule.
 *   • external_pricing=true → skip BEFORE the resolver is called.
 *     force=true NEVER bypasses this guard.
 *   • channex_enabled=false or missing Channex IDs → skip.
 *   • No DB writes. No side effects beyond the two Channex API calls.
 *
 * Concurrency note (P0-C1):
 *   No in-process lock is implemented. A Node.js Map-based lock provides no
 *   protection across Render instances, worker processes, or restarts.
 *   The just-in-time resolve (DB read at call time) gives best-effort
 *   correctness: the last caller to push wins with the freshest DB state.
 *   A robust solution (DB advisory lock, Redis, or a serialised queue) is
 *   deferred until the Render deployment topology is confirmed.
 *
 * Partial failure contract:
 *   A. rates OK  + restrictions OK  → status='ok'
 *   B. rates FAIL                   → rates.error set; restrictions still attempted
 *   C. rates OK  + restrictions FAIL→ status='partial'
 *   D. no valid rates               → pushRates not called; restrictions still pushed
 *   E. no restrictions              → pushRestrictions not called (never happens with
 *                                     a non-empty date range and default min_stay=1)
 *   F. both FAIL                    → status='error'
 *
 * Production usage:
 *   const { publishEffectivePricing } = require('./pricing-publisher');
 *   const result = await publishEffectivePricing(pool, { propertyId, userId, startDate, endDate });
 *
 * NOT yet wired to any production route. See isolation check in report.
 */

const PUBLISH_STATUS = Object.freeze({
  OK:                       'ok',
  PARTIAL:                  'partial',
  ERROR:                    'error',
  SKIPPED_NOT_FOUND:        'skipped_property_not_found',
  SKIPPED_EXTERNAL:         'skipped_external_pricing',
  SKIPPED_CHANNEX_DISABLED: 'skipped_channex_disabled',
  SKIPPED_MISSING_IDS:      'skipped_missing_channex_ids',
});

/**
 * createPublisher({ pushRates, pushRestrictions, resolveEffectivePrices })
 *
 * Factory that returns a publishEffectivePricing function.
 * Pass mock implementations in tests; omit in production to use real deps.
 *
 * Dependencies are resolved lazily (require inside the returned function) so
 * that the factory can be called at module load time without circular-require
 * issues.
 */
function createPublisher(deps = {}) {
  function _pushRates()       { return deps.pushRates        || require('../channex').pushRates; }
  function _pushRestrictions(){ return deps.pushRestrictions  || require('../channex').pushRestrictions; }
  function _resolve()         { return deps.resolveEffectivePrices || require('./effective-pricing-resolver').resolveEffectivePrices; }

  /**
   * @param {object} pool
   * @param {string}  opts.propertyId
   * @param {string}  opts.userId        Caller's id; falls back to prop.user_id for rule resolution
   * @param {string}  opts.startDate     Inclusive 'YYYY-MM-DD'
   * @param {string}  opts.endDate       Exclusive 'YYYY-MM-DD'
   * @param {string}  [opts.reason]      Included in result/logs only; never influences prices
   * @param {boolean} [opts.force]       Reserved. No effect in P0-C1. NEVER bypasses external_pricing.
   * @returns {Promise<PublishResult>}
   */
  async function publishEffectivePricing(pool, {
    propertyId,
    userId,
    startDate,
    endDate,
    reason = 'unknown',
    force = false,  // reserved — no effect in P0-C1; diffing guard will use this in P0-D
  }) {
    // ── 1. Fetch property ──────────────────────────────────────────────────────
    const propRes = await pool.query(
      `SELECT id, user_id, channex_enabled, channex_property_id,
              channex_room_type_id, channex_rate_plan_id, external_pricing
       FROM properties WHERE id = $1`,
      [propertyId]
    );
    const prop = propRes.rows[0];

    // ── 2. Hard guards — fail-closed ───────────────────────────────────────────
    if (!prop) {
      return _skip(PUBLISH_STATUS.SKIPPED_NOT_FOUND, propertyId, reason);
    }

    // external_pricing checked FIRST, before any resolver work.
    // force=true intentionally does NOT bypass this.
    if (prop.external_pricing) {
      return _skip(PUBLISH_STATUS.SKIPPED_EXTERNAL, propertyId, reason);
    }

    if (!prop.channex_enabled) {
      return _skip(PUBLISH_STATUS.SKIPPED_CHANNEX_DISABLED, propertyId, reason);
    }

    const missingIds = [
      !prop.channex_property_id  && 'channex_property_id',
      !prop.channex_rate_plan_id && 'channex_rate_plan_id',
      !prop.channex_room_type_id && 'channex_room_type_id',
    ].filter(Boolean);

    if (missingIds.length > 0) {
      return _skip(PUBLISH_STATUS.SKIPPED_MISSING_IDS, propertyId, reason, { missingIds });
    }

    // ── 3. Resolve ownerId — rules/overrides stored under property owner ───────
    const ownerId = prop.user_id || userId;

    // ── 4. Just-in-time resolve (DB state at call time = single source of truth)
    const nights = await _resolve()(pool, { propertyId, userId: ownerId, startDate, endDate });

    // ── 5. Build payloads ──────────────────────────────────────────────────────
    // Rates: only nights with a valid (non-null, > 0) price
    const rates = nights
      .filter(n => n.priceValid)
      .map(n => ({ date: n.date, price: n.price }));

    // Restrictions: all resolved nights (min_stay defaults to 1 — never null)
    // stop_sell always sent (false re-opens a date previously blocked)
    const restrictions = nights.map(n => ({
      date:             n.date,
      min_stay_arrival: n.minStayArrival,
      min_stay_through: n.minStayThrough,
      stop_sell:        n.stopSell ?? false,
    }));

    // ── 6. Push — both attempted independently; errors are collected, not thrown
    let ratesResult       = null;
    let restrictionsResult= null;
    let ratesError        = null;
    let restrictionsError = null;

    if (rates.length > 0) {
      try {
        ratesResult = await _pushRates()(pool, {
          property_id:          prop.id,
          channex_property_id:  prop.channex_property_id,
          channex_rate_plan_id: prop.channex_rate_plan_id,
          rates,
        });
      } catch (e) {
        ratesError = e;
        console.error(`[PUBLISHER] pushRates error (${propertyId}):`, e.message);
      }
    }

    if (restrictions.length > 0) {
      try {
        restrictionsResult = await _pushRestrictions()(pool, {
          property_id:           prop.id,
          channex_property_id:   prop.channex_property_id,
          channex_room_type_id:  prop.channex_room_type_id,
          channex_rate_plan_id:  prop.channex_rate_plan_id,
          restrictions,
        });
      } catch (e) {
        restrictionsError = e;
        console.error(`[PUBLISHER] pushRestrictions error (${propertyId}):`, e.message);
      }
    }

    // ── 7. Classify result ─────────────────────────────────────────────────────
    const ratesOk = rates.length === 0 || !!ratesResult;
    const restrOk = restrictions.length === 0 || !!restrictionsResult;

    let status;
    if (ratesOk && restrOk)  status = PUBLISH_STATUS.OK;
    else if (ratesOk || restrOk) status = PUBLISH_STATUS.PARTIAL;
    else status = PUBLISH_STATUS.ERROR;

    console.log(`[PUBLISHER] ${propertyId} — ${status} — reason:${reason} — rates:${rates.length} restr:${restrictions.length}`);

    return {
      status,
      propertyId,
      reason,
      nights:       nights.length,
      rates:        { count: rates.length,        pushed: ratesResult?.count       ?? 0, error: ratesError?.message       ?? null },
      restrictions: { count: restrictions.length, pushed: restrictionsResult?.count ?? 0, error: restrictionsError?.message ?? null },
    };
  }

  return publishEffectivePricing;
}

function _skip(status, propertyId, reason, detail = null) {
  return {
    status,
    propertyId,
    reason,
    nights:       0,
    rates:        { count: 0, pushed: 0, error: null },
    restrictions: { count: 0, pushed: 0, error: null },
    ...(detail != null ? { detail } : {}),
  };
}

const publishEffectivePricing = createPublisher();

module.exports = { publishEffectivePricing, createPublisher, PUBLISH_STATUS };

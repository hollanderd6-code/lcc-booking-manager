'use strict';
/**
 * Effective Pricing Publisher — P0-C1 / C4.9-C
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
 * Concurrency model (P0-C4.9-C — DESIGN C):
 *   1. Per-property local queue (Map<propertyId, Promise>) ensures at most one
 *      _doPublish executes at a time per property within this process. Other
 *      callers wait in memory — they do NOT consume pool connections.
 *   2. PostgreSQL session-level advisory lock (namespace 1002,
 *      key = hashtext(propertyId)) serializes across Render instances.
 *      Acquired BEFORE property guard/resolve; released AFTER both Channex
 *      calls complete. A dedicated PoolClient is held for the duration.
 *   3. resolve (JIT) only happens under the distributed lock.
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
 * Lock acquisition failure:
 *   If the advisory lock cannot be acquired within ACQUIRE_TIMEOUT_MS (15s),
 *   _doPublish throws with err.code='PRICING_PUBLISH_LOCK_TIMEOUT'. The
 *   caller (fire-and-forget trigger-sync) swallows this silently. No Channex
 *   call is made. The local queue advances to the next waiter regardless.
 *
 * Production usage:
 *   const { publishEffectivePricing } = require('./pricing-publisher');
 *   const result = await publishEffectivePricing(pool, { propertyId, userId, startDate, endDate });
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
 * createPublisher({ pushRates, pushRestrictions, resolveEffectivePrices,
 *                   acquireLock, releaseLock, connectClient })
 *
 * Factory returning a publishEffectivePricing function.
 * All deps are lazily resolved so the factory can be called at module-load
 * time without circular-require issues.
 *
 * Injectable for tests:
 *   acquireLock   (client, propertyId) → Promise<void>
 *   releaseLock   (client, propertyId) → Promise<void>
 *   connectClient (pool)               → Promise<PoolClient-like>
 */
function createPublisher(deps = {}) {
  function _pushRates()        { return deps.pushRates        || require('../channex').pushRates; }
  function _pushRestrictions() { return deps.pushRestrictions  || require('../channex').pushRestrictions; }
  function _resolve()          { return deps.resolveEffectivePrices || require('./effective-pricing-resolver').resolveEffectivePrices; }
  function _acquireLock()      { return deps.acquireLock || require('./pricing-publish-lock').acquirePropertyLock; }
  function _releaseLock()      { return deps.releaseLock || require('./pricing-publish-lock').releasePropertyLock; }
  function _connectClient()    { return deps.connectClient || ((pool) => pool.connect()); }

  // ── Per-property local queue ─────────────────────────────────────────────────
  // Map<propertyId, Promise> — each entry is the settled tail of the queue chain.
  // Invariants:
  //   • At most one _doPublish runs per propertyId per process at any time.
  //   • Each enqueued call runs exactly once, in arrival order.
  //   • A failure in call N does not block call N+1.
  //   • Map entry is removed when the last queued call completes (no leak).
  const _localQueue = new Map();

  function _enqueue(propertyId, fn) {
    const prev = _localQueue.get(propertyId) ?? Promise.resolve();
    // Run fn after prev settles, regardless of prev outcome
    const execution = prev.then(() => fn(), () => fn());
    // Tail silences fn's error so next queued item can chain unconditionally
    const tail = execution.then(() => {}, () => {});
    _localQueue.set(propertyId, tail);
    // Cleanup: if nothing queued after us when tail settles, remove from Map
    tail.then(() => {
      if (_localQueue.get(propertyId) === tail) _localQueue.delete(propertyId);
    });
    return execution; // caller receives actual result or rejection
  }

  /**
   * @param {object} pool
   * @param {string}  opts.propertyId
   * @param {string}  opts.userId
   * @param {string}  opts.startDate     Inclusive 'YYYY-MM-DD'
   * @param {string}  opts.endDate       Exclusive 'YYYY-MM-DD'
   * @param {string}  [opts.reason]
   * @param {boolean} [opts.force]       Reserved — no effect in P0-C1
   * @param {Array}   [opts.allowedDates]
   * @param {string}  [opts.stopSellMode] 'authoritative'|'true_only'|'none'
   * @param {boolean} [opts.includeStopSell] Legacy compat
   * @returns {Promise<PublishResult>}
   */
  async function publishEffectivePricing(pool, opts) {
    const { propertyId } = opts;
    return _enqueue(propertyId, () => _doPublish(pool, opts));
  }

  async function _doPublish(pool, {
    propertyId,
    userId,
    startDate,
    endDate,
    reason = 'unknown',
    force = false,       // reserved — no effect in P0-C1
    allowedDates,
    stopSellMode,
    includeStopSell,
  }) {
    // ── Acquire dedicated client (one per publish cycle) ────────────────────
    // If pool is exhausted, this throws and _doPublish rejects — no lock, no push.
    const client = await _connectClient()(pool);
    let lockAcquired = false;

    try {
      // ── Acquire distributed advisory lock ───────────────────────────────
      // Fails closed: no push without the lock.
      // Throws PRICING_PUBLISH_LOCK_TIMEOUT if deadline exceeded.
      await _acquireLock()(client, propertyId);
      lockAcquired = true;

      // ── 1. Fetch property (under lock — eliminates TOCTOU on guards) ────
      const propRes = await client.query(
        `SELECT id, user_id, channex_enabled, channex_property_id,
                channex_room_type_id, channex_rate_plan_id, external_pricing
         FROM properties WHERE id = $1`,
        [propertyId]
      );
      const prop = propRes.rows[0];

      // ── 2. Hard guards — fail-closed ─────────────────────────────────────
      if (!prop) {
        return _skip(PUBLISH_STATUS.SKIPPED_NOT_FOUND, propertyId, reason);
      }
      // external_pricing checked first; force=true intentionally does NOT bypass.
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

      // ── 3. Resolve ownerId ────────────────────────────────────────────────
      const ownerId = prop.user_id || userId;

      // ── 4. JIT resolve — ONLY under the distributed lock ─────────────────
      // Uses the same dedicated client throughout to avoid pool pressure.
      const nights = await _resolve()(client, { propertyId, userId: ownerId, startDate, endDate });

      // ── 5. Build payloads ─────────────────────────────────────────────────
      // Resolve stopSellMode: explicit wins; else legacy includeStopSell:false → 'none';
      // else 'authoritative' (default — all active callers pass explicit mode via C4.8).
      const VALID_STOP_SELL_MODES = new Set(['authoritative', 'true_only', 'none']);
      const resolvedStopSellMode = stopSellMode !== undefined
        ? stopSellMode
        : (includeStopSell === false ? 'none' : 'authoritative');

      // Fail-fast: unknown mode → error before any Channex call
      if (!VALID_STOP_SELL_MODES.has(resolvedStopSellMode)) {
        throw new Error(
          `[PUBLISHER] stopSellMode invalide: "${resolvedStopSellMode}" — valeurs acceptées: authoritative|true_only|none`
        );
      }

      // allowedDates: undefined/null → publish all nights; [] → publish none.
      const allowedDateSet = Array.isArray(allowedDates) ? new Set(allowedDates) : null;
      const publishNights  = allowedDateSet !== null
        ? nights.filter(n => allowedDateSet.has(n.date))
        : nights;

      const rates = publishNights
        .filter(n => n.priceValid)
        .map(n => ({ date: n.date, price: n.price }));

      const restrictions = publishNights.map(n => {
        const r = {
          date:             n.date,
          min_stay_arrival: n.minStayArrival,
          min_stay_through: n.minStayThrough,
        };
        if (resolvedStopSellMode === 'authoritative') {
          r.stop_sell = n.stopSell ?? false;
        } else if (resolvedStopSellMode === 'true_only') {
          if (n.stopSell) r.stop_sell = true;
          // field absent when falsy — Channex state unchanged for that night
        }
        // 'none': stop_sell always absent
        return r;
      });

      // ── 6. Push — both attempted independently; errors collected, not thrown ─
      let ratesResult       = null;
      let restrictionsResult= null;
      let ratesError        = null;
      let restrictionsError = null;

      if (rates.length > 0) {
        try {
          ratesResult = await _pushRates()(client, {
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
          restrictionsResult = await _pushRestrictions()(client, {
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

      // ── 7. Classify result ────────────────────────────────────────────────
      const ratesOk = rates.length === 0 || !!ratesResult;
      const restrOk = restrictions.length === 0 || !!restrictionsResult;

      let status;
      if (ratesOk && restrOk)        status = PUBLISH_STATUS.OK;
      else if (ratesOk || restrOk)   status = PUBLISH_STATUS.PARTIAL;
      else                           status = PUBLISH_STATUS.ERROR;

      const filterNote = allowedDateSet !== null ? ` allowed:${allowedDateSet.size}` : '';
      console.log(`[PUBLISHER] ${propertyId} — ${status} — reason:${reason} — rates:${rates.length} restr:${restrictions.length}${filterNote}`);

      return {
        status,
        propertyId,
        reason,
        nights:       nights.length,
        rates:        { count: rates.length,        pushed: ratesResult?.count       ?? 0, error: ratesError?.message       ?? null },
        restrictions: { count: restrictions.length, pushed: restrictionsResult?.count ?? 0, error: restrictionsError?.message ?? null },
      };

    } finally {
      // Always unlock before releasing the client to the pool.
      // If releaseLock throws, pass the error to client.release(err) so pg-pool
      // destroys the connection instead of recycling a potentially still-locked
      // session back to the pool (pg-pool@3: release(err) → _remove, not _idle).
      if (lockAcquired) {
        let releaseErr;
        try {
          await _releaseLock()(client, propertyId);
        } catch (e) {
          releaseErr = e;
        } finally {
          client.release(releaseErr);
        }
        if (releaseErr) throw releaseErr;
      } else {
        client.release();
      }
    }
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

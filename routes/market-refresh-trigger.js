'use strict';

const { computeMarketContextKey } = require('./market-context-key');
const { runDynamicPricingForOneProperty } = require('./dynamic-pricing-cron');

const DEFAULT_DEBOUNCE_MS = 60000;
const MAX_ATTEMPTS        = 3;
const RETRY_DELAYS_MS     = [60000, 300000];

// Map<propertyId, { timer, token }> — currently pending timer for each property.
// token is a unique object reference per scheduleMarketRefresh call.
const _timers = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

function scheduleMarketRefresh(pool, {
  propertyId,
  userId,
  expectedContextKey,
  delayMs = DEFAULT_DEBOUNCE_MS,
  _runner,
} = {}) {
  if (!pool || !propertyId || !userId || !expectedContextKey) return;

  const existing = _timers.get(propertyId);
  if (existing) {
    clearTimeout(existing.timer);
    console.log(`[MRT] debounced propertyId=${propertyId}`);
  }

  const token = {};
  const runner = _runner || runDynamicPricingForOneProperty;

  const timer = setTimeout(() => {
    const cur = _timers.get(propertyId);
    if (!cur || cur.token !== token) return;
    _timers.delete(propertyId);
    _runAttempt(pool, { propertyId, userId, expectedContextKey, runner, attempt: 1, token });
  }, delayMs);

  if (timer.unref) timer.unref();
  _timers.set(propertyId, { timer, token });
  console.log(`[MRT] scheduled propertyId=${propertyId} ctx=${expectedContextKey}`);
}

// ── Internal ──────────────────────────────────────────────────────────────────

async function _preflight(pool, { propertyId, userId, expectedContextKey }) {
  const res = await pool.query(
    `SELECT p.country_code, p.latitude, p.longitude, pc.is_active
       FROM properties p
       LEFT JOIN pricing_config pc
         ON pc.property_id = p.id AND pc.user_id = p.user_id
      WHERE p.id = $1 AND p.user_id = $2`,
    [propertyId, userId]
  );

  if (res.rows.length === 0) return { ok: false, reason: 'property_deleted' };

  const row = res.rows[0];
  const currentKey = computeMarketContextKey({
    countryCode: row.country_code,
    latitude:    row.latitude,
    longitude:   row.longitude,
  });

  if (currentKey !== expectedContextKey) return { ok: false, reason: 'context_stale_preflight' };
  if (row.is_active == null)              return { ok: false, reason: 'no_pricing_config' };
  if (row.is_active !== true)             return { ok: false, reason: 'inactive' };

  return { ok: true };
}

function _cleanupIfOwner(propertyId, token) {
  const cur = _timers.get(propertyId);
  if (cur && cur.token === token) _timers.delete(propertyId);
}

async function _runAttempt(pool, { propertyId, userId, expectedContextKey, runner, attempt, token }) {
  console.log(`[MRT] started attempt=${attempt} propertyId=${propertyId} ctx=${expectedContextKey}`);

  const pre = await _preflight(pool, { propertyId, userId, expectedContextKey });
  if (!pre.ok) {
    console.log(`[MRT] dropped ${pre.reason} propertyId=${propertyId}`);
    _cleanupIfOwner(propertyId, token);
    return;
  }

  try {
    const result = await runner(pool, { userId, propertyId, force: true });

    if (!result || result.ok !== true) {
      const reason = result?.error || 'failed';
      console.log(`[MRT] terminal failure reason=${reason} propertyId=${propertyId}`);
      _cleanupIfOwner(propertyId, token);
      return;
    }

    console.log(`[MRT] succeeded propertyId=${propertyId} attempt=${attempt} isMock=${result.isMock}`);
    _cleanupIfOwner(propertyId, token);

  } catch (err) {
    console.warn(`[MRT] attempt=${attempt} threw propertyId=${propertyId}:`, err.message);

    if (attempt >= MAX_ATTEMPTS) {
      console.log(`[MRT] terminal failure (max attempts) propertyId=${propertyId}`);
      _cleanupIfOwner(propertyId, token);
      return;
    }

    // Only retry if not superseded
    const cur = _timers.get(propertyId);
    if (cur && cur.token !== token) {
      console.log(`[MRT] retry superseded propertyId=${propertyId}`);
      return;
    }

    const retryDelay = RETRY_DELAYS_MS[attempt - 1];
    const retryTimer = setTimeout(() => {
      const check = _timers.get(propertyId);
      if (!check || check.token !== token) return;
      _timers.delete(propertyId);
      _runAttempt(pool, { propertyId, userId, expectedContextKey, runner, attempt: attempt + 1, token });
    }, retryDelay);

    if (retryTimer.unref) retryTimer.unref();
    _timers.set(propertyId, { timer: retryTimer, token });
    console.log(`[MRT] retry scheduled attempt=${attempt + 1} propertyId=${propertyId} delay=${retryDelay}ms`);
  }
}

module.exports = { scheduleMarketRefresh, DEFAULT_DEBOUNCE_MS, MAX_ATTEMPTS, RETRY_DELAYS_MS, _timers };

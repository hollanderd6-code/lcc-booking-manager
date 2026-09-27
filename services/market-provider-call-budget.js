'use strict';
/**
 * P1.2-B5-BK-M2 — Provider Call Budget
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Fail-closed budget for Bright Data API calls.
 * When a provider's budget is exhausted, canMakeCall returns allowed: false
 * with reason BUDGET_EXHAUSTED — the caller must honour this and skip the call.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

const DEFAULT_MAX_AIRBNB_CALLS  = 3;
const DEFAULT_MAX_BOOKING_CALLS = 1;

// ── createCallBudget ──────────────────────────────────────────────────────────

/**
 * Create a mutable budget tracking object.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxAirbnbCalls=3]
 * @param {number} [opts.maxBookingCalls=1]
 * @returns {CallBudget}
 */
function createCallBudget({
  maxAirbnbCalls  = DEFAULT_MAX_AIRBNB_CALLS,
  maxBookingCalls = DEFAULT_MAX_BOOKING_CALLS,
} = {}) {
  return {
    airbnb:  { used: 0, max: maxAirbnbCalls  },
    booking: { used: 0, max: maxBookingCalls },
  };
}

// ── canMakeCall ───────────────────────────────────────────────────────────────

/**
 * Check whether a call to the given provider is allowed.
 * Fail-closed: unknown providers are rejected.
 *
 * @param {CallBudget} budget
 * @param {string}     provider — 'airbnb' | 'booking'
 * @returns {{ allowed: boolean, reason: string|null }}
 */
function canMakeCall(budget, provider) {
  const entry = budget[provider];
  if (!entry) {
    return { allowed: false, reason: `CALL_NOT_ALLOWED: unknown_provider (${provider})` };
  }
  if (entry.used >= entry.max) {
    return {
      allowed: false,
      reason:  `BUDGET_EXHAUSTED: ${provider} (${entry.used}/${entry.max})`,
    };
  }
  return { allowed: true, reason: null };
}

// ── recordCall ────────────────────────────────────────────────────────────────

/**
 * Record that a call was made. Mutates budget.
 * Throws if provider is unknown — callers must check canMakeCall first.
 *
 * @param {CallBudget} budget
 * @param {string}     provider
 */
function recordCall(budget, provider) {
  if (!budget[provider]) {
    throw new Error(`recordCall: unknown provider "${provider}"`);
  }
  budget[provider].used++;
}

// ── getBudgetStatus ───────────────────────────────────────────────────────────

/**
 * Return a snapshot of the current budget state (non-mutating).
 *
 * @param {CallBudget} budget
 * @returns {object}  — { airbnb: { used, max, remaining, exhausted }, booking: {...} }
 */
function getBudgetStatus(budget) {
  const result = {};
  for (const [provider, entry] of Object.entries(budget)) {
    result[provider] = {
      provider,
      used:      entry.used,
      max:       entry.max,
      remaining: Math.max(0, entry.max - entry.used),
      exhausted: entry.used >= entry.max,
    };
  }
  return result;
}

module.exports = {
  createCallBudget,
  canMakeCall,
  recordCall,
  getBudgetStatus,
  DEFAULT_MAX_AIRBNB_CALLS,
  DEFAULT_MAX_BOOKING_CALLS,
};

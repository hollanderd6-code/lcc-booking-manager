'use strict';
/**
 * P1.2-B5-BK-M4 — Provider Health Tracker
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Tracks per-provider success/error outcomes and provides health status.
 * A provider is considered unhealthy when its recent failure rate is too high.
 * Uses a sliding window of the last N outcomes (default 5).
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

const WINDOW_SIZE           = 5;
const UNHEALTHY_ERROR_RATE  = 0.6;   // ≥ 60% errors in window → unhealthy

// ── createHealthTracker ───────────────────────────────────────────────────────

/**
 * Create a mutable health tracker for all known providers.
 *
 * @returns {HealthTracker}
 */
function createHealthTracker() {
  return {
    airbnb:  { outcomes: [], totalCalls: 0, totalErrors: 0 },
    booking: { outcomes: [], totalCalls: 0, totalErrors: 0 },
  };
}

// ── recordProviderOutcome ─────────────────────────────────────────────────────

/**
 * Record a call outcome for a provider. Mutates tracker.
 *
 * @param {HealthTracker} tracker
 * @param {string}        provider  — 'airbnb' | 'booking'
 * @param {'success'|'error'} outcome
 */
function recordProviderOutcome(tracker, provider, outcome) {
  if (!tracker[provider]) {
    tracker[provider] = { outcomes: [], totalCalls: 0, totalErrors: 0 };
  }
  const entry = tracker[provider];
  entry.totalCalls++;
  if (outcome === 'error') entry.totalErrors++;

  // Sliding window
  entry.outcomes.push(outcome);
  if (entry.outcomes.length > WINDOW_SIZE) {
    entry.outcomes.shift();
  }
}

// ── getProviderHealth ─────────────────────────────────────────────────────────

/**
 * Return the current health status for a provider.
 *
 * @param {HealthTracker} tracker
 * @param {string}        provider
 * @returns {{ status: 'HEALTHY'|'UNHEALTHY'|'UNKNOWN', successRate: number|null, callCount: number, errorRate: number|null }}
 */
function getProviderHealth(tracker, provider) {
  const entry = tracker?.[provider];
  if (!entry || entry.totalCalls === 0) {
    return { status: 'UNKNOWN', successRate: null, errorRate: null, callCount: 0 };
  }

  const window       = entry.outcomes;
  const errorsInWin  = window.filter(o => o === 'error').length;
  const errorRate    = window.length > 0 ? errorsInWin / window.length : 0;
  const successRate  = 1 - errorRate;
  const status       = errorRate >= UNHEALTHY_ERROR_RATE ? 'UNHEALTHY' : 'HEALTHY';

  return {
    status,
    successRate: Math.round(successRate * 1000) / 1000,
    errorRate:   Math.round(errorRate   * 1000) / 1000,
    callCount:   entry.totalCalls,
  };
}

// ── isProviderHealthy ─────────────────────────────────────────────────────────

/**
 * Quick boolean check. Unknown providers (no calls yet) are treated as healthy
 * (permissive default — don't block first calls on an empty tracker).
 *
 * @param {HealthTracker} tracker
 * @param {string}        provider
 * @returns {boolean}
 */
function isProviderHealthy(tracker, provider) {
  const h = getProviderHealth(tracker, provider);
  return h.status !== 'UNHEALTHY';
}

module.exports = {
  createHealthTracker,
  recordProviderOutcome,
  getProviderHealth,
  isProviderHealthy,
  WINDOW_SIZE,
  UNHEALTHY_ERROR_RATE,
};

'use strict';
/**
 * P1.2-B5-BK-M3 — Adaptive Collection Planner
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Given an execution policy, snapshot cache, and call budget, produces a
 * declarative collection plan (list of REUSE / CALL / SKIP steps).
 * Deterministic and fully testable without any provider calls.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

const { shouldReuseSnapshot } = require('./market-snapshot-reuse-policy');
const { canMakeCall }          = require('./market-provider-call-budget');

// ── Policy → max Airbnb snapshots ─────────────────────────────────────────────

const POLICY_MAX_AIRBNB_CALLS = {
  SINGLE_SNAPSHOT_ALLOWED:  1,
  TWO_SNAPSHOT_EARLY_STOP:  2,
  THREE_SNAPSHOT_REQUIRED:  3,
  INSUFFICIENT_EVIDENCE:    3,  // conservative default
};

// ── planAdaptiveCollection ────────────────────────────────────────────────────

/**
 * Produce a declarative collection plan.
 *
 * @param {object} context
 * @param {string}  context.executionPolicy     — from market-execution-policy L5
 * @param {Array}   [context.snapshotQueue=[]]  — cached snapshots to consider for reuse
 * @param {object}  context.budget              — M2 call budget
 * @param {object}  context.request             — { location, checkIn, checkOut, currency, targetGuests, ... }
 * @param {number}  [context.maxAgeMs]          — override max snapshot age
 *
 * @returns {CollectionPlan}
 *   {
 *     airbnb:           Array<{ type: 'REUSE'|'CALL'|'SKIP', reason, snapshot? }>
 *     booking:          { type: 'CALL'|'SKIP', reason }
 *     reusedSnapshots:  number
 *     newCallsNeeded:   number
 *     totalPlannedCalls: number   — CALL items only (credits consumed)
 *     decisionTrace:    string[]
 *   }
 */
function planAdaptiveCollection({
  executionPolicy = 'INSUFFICIENT_EVIDENCE',
  snapshotQueue   = [],
  budget,
  request         = {},
  maxAgeMs,
} = {}) {
  const maxAirbnb = POLICY_MAX_AIRBNB_CALLS[executionPolicy]
    ?? POLICY_MAX_AIRBNB_CALLS.INSUFFICIENT_EVIDENCE;

  const airbnbPlan   = [];
  const decisionTrace = [];
  let reusedSnapshots = 0;
  let newCallsNeeded  = 0;

  for (let i = 0; i < maxAirbnb; i++) {
    const cached = snapshotQueue[i] ?? null;

    // Try reuse
    if (cached) {
      const reuseOpts = maxAgeMs != null ? { ...request, maxAgeMs } : request;
      const reuseCheck = shouldReuseSnapshot(cached, reuseOpts);
      if (reuseCheck.reuse) {
        airbnbPlan.push({ type: 'REUSE', reason: 'cached_valid', snapshot: cached });
        decisionTrace.push(`airbnb[${i}]: REUSE (${cached.snapshotId})`);
        reusedSnapshots++;
        continue;
      }
      decisionTrace.push(`airbnb[${i}]: cache-miss — ${reuseCheck.reason}`);
    }

    // Check budget
    const budgetCheck = canMakeCall(budget, 'airbnb');
    if (!budgetCheck.allowed) {
      airbnbPlan.push({ type: 'SKIP', reason: budgetCheck.reason });
      decisionTrace.push(`airbnb[${i}]: SKIP — ${budgetCheck.reason}`);
    } else {
      airbnbPlan.push({ type: 'CALL', reason: 'new_collection_needed' });
      decisionTrace.push(`airbnb[${i}]: CALL`);
      newCallsNeeded++;
    }
  }

  // Booking — always 1 call unless budget exhausted
  const bkBudget = canMakeCall(budget, 'booking');
  let bookingStep;
  if (bkBudget.allowed) {
    bookingStep = { type: 'CALL', reason: 'booking_collection' };
    decisionTrace.push('booking: CALL');
  } else {
    bookingStep = { type: 'SKIP', reason: bkBudget.reason };
    decisionTrace.push(`booking: SKIP — ${bkBudget.reason}`);
  }

  const bookingCalls = bookingStep.type === 'CALL' ? 1 : 0;

  return {
    airbnb:            airbnbPlan,
    booking:           bookingStep,
    reusedSnapshots,
    newCallsNeeded,
    totalPlannedCalls: newCallsNeeded + bookingCalls,
    decisionTrace,
  };
}

module.exports = {
  planAdaptiveCollection,
  POLICY_MAX_AIRBNB_CALLS,
};

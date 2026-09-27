'use strict';
/**
 * P1.2-B5-BK-M7 — Market Collection Cost Estimator
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Estimates the number of Bright Data API credits a collection plan will
 * consume, before any call is made. One API call = one credit.
 * REUSE and SKIP steps consume 0 credits.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

// Bright Data pricing model: 1 call = 1 credit
const CREDITS_PER_CALL = 1;

// ── estimateCollectionCost ────────────────────────────────────────────────────

/**
 * Estimate the credit cost of a collection plan (from M3).
 *
 * @param {CollectionPlan} plan
 *   {
 *     airbnb:  Array<{ type: 'REUSE'|'CALL'|'SKIP' }>,
 *     booking: { type: 'CALL'|'SKIP' },
 *   }
 *
 * @returns {{
 *   totalCalls:        number,
 *   estimatedCredits:  number,
 *   breakdown: Array<{ provider, index, type, credits }>
 * }}
 */
function estimateCollectionCost(plan) {
  if (!plan) {
    return { totalCalls: 0, estimatedCredits: 0, breakdown: [] };
  }

  const breakdown = [];
  let totalCalls = 0;

  // Airbnb steps
  const airbnbSteps = plan.airbnb || [];
  for (let i = 0; i < airbnbSteps.length; i++) {
    const step    = airbnbSteps[i];
    const credits = step.type === 'CALL' ? CREDITS_PER_CALL : 0;
    if (step.type === 'CALL') totalCalls++;
    breakdown.push({
      provider: 'airbnb',
      index:    i,
      type:     step.type,
      credits,
    });
  }

  // Booking step
  if (plan.booking) {
    const credits = plan.booking.type === 'CALL' ? CREDITS_PER_CALL : 0;
    if (plan.booking.type === 'CALL') totalCalls++;
    breakdown.push({
      provider: 'booking',
      index:    0,
      type:     plan.booking.type,
      credits,
    });
  }

  return {
    totalCalls,
    estimatedCredits: totalCalls * CREDITS_PER_CALL,
    breakdown,
  };
}

module.exports = {
  estimateCollectionCost,
  CREDITS_PER_CALL,
};

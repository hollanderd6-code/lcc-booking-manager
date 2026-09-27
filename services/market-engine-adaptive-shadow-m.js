'use strict';
/**
 * P1.2-B5-BK-M8 — Adaptive Shadow Market Engine
 *
 * Wraps the K engine with credit-aware adaptive collection:
 *   M1 snapshot reuse      — skip live calls when cache is valid
 *   M2 call budget         — fail-closed credit guard
 *   M3 collection planner  — deterministic plan before any call
 *   M4 provider health     — skip calls on unhealthy providers
 *   M6 anomaly diagnostic  — flag suspicious snapshot batches
 *   M7 cost estimator      — log planned credit spend
 *   M5 quarantine          — flag deviating shadow results
 *
 * DEFAULT PROVIDER: noNetworkProvider — throws immediately.
 * Pre-collected snapshots must be provided via _snapshotQueue / _bookingSnapshot
 * to run without live BD calls.
 *
 * ABSOLUTE RULE: SAFE_TO_ACTIVATE_PRODUCTION is NEVER 'YES' in M.
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   SAFE_TO_ACTIVATE_PRODUCTION = 'NO'  always
 */

const { runShadowMarketEngine } = require('./market-engine-shadow-k');

const { createCallBudget, canMakeCall, recordCall, getBudgetStatus } =
  require('./market-provider-call-budget');
const { planAdaptiveCollection }    = require('./market-adaptive-collection-planner');
const { createHealthTracker, recordProviderOutcome, isProviderHealthy } =
  require('./market-provider-health');
const { evaluateQuarantine }        = require('./market-production-quarantine');
const { diagnoseSnapshotAnomalies } = require('./airbnb-snapshot-anomaly-diagnostic');

// ── noNetworkProvider ─────────────────────────────────────────────────────────

/**
 * Default provider — throws immediately.
 * Forces callers to either supply pre-collected snapshots or an explicit
 * live provider with --execute-live in the validator.
 */
async function noNetworkProvider() {
  throw new Error(
    'NO_NETWORK: M8 adaptive mode requires pre-collected snapshots (_snapshotQueue / _bookingSnapshot) ' +
    'or an explicit live provider. Use validate-market-engine-adaptive-m.js --execute-live for live calls.'
  );
}

// ── runAdaptiveMarketEngine ───────────────────────────────────────────────────

/**
 * Run the adaptive shadow market engine.
 *
 * @param {object} opts
 *
 * — K pass-through params —
 * @param {number}        opts.targetLat
 * @param {number}        opts.targetLon
 * @param {number|null}   [opts.targetGuests]
 * @param {number|null}   [opts.targetBedrooms]
 * @param {string}        [opts.targetPropertyType='entire_place']
 * @param {string}        opts.location
 * @param {string}        opts.currency
 * @param {string}        opts.checkIn
 * @param {string}        opts.checkOut
 * @param {string}        [opts.today]
 * @param {number}        [opts.maxAirbnbListings=100]
 * @param {number}        [opts.maxBookingListings=100]
 *
 * — M-specific params —
 * @param {Array|null}    [opts._snapshotQueue=null]      — pre-collected Airbnb snapshots
 * @param {object|null}   [opts._bookingSnapshot=null]    — pre-collected Booking result
 * @param {Function}      [opts._airbnbScrape=noNetworkProvider]
 * @param {Function}      [opts._bookingScrape=noNetworkProvider]
 * @param {object|null}   [opts._budget=null]             — M2 budget (created internally if null)
 * @param {object|null}   [opts._healthTracker=null]      — M4 tracker (created internally if null)
 * @param {string}        [opts._executionPolicy='INSUFFICIENT_EVIDENCE']
 * @param {number}        [opts._maxAgeMs]                — snapshot max age override
 * @param {object|null}   [opts._sanityResult=null]       — L4 sanity result for quarantine
 *
 * @returns {AdaptiveMarketResult}  — K result + decisionTrace + budgetStatus + anomalyDiagnostic + quarantine
 */
async function runAdaptiveMarketEngine(opts = {}) {
  const {
    // K params
    targetLat,
    targetLon,
    targetGuests       = null,
    targetBedrooms     = null,
    targetPropertyType = 'entire_place',
    location,
    currency,
    checkIn,
    checkOut,
    today              = null,
    maxAirbnbListings  = 100,
    maxBookingListings = 100,

    // M params
    _snapshotQueue    = null,
    _bookingSnapshot  = null,
    _airbnbScrape     = noNetworkProvider,
    _bookingScrape    = noNetworkProvider,
    _budget           = null,
    _healthTracker    = null,
    _executionPolicy  = 'INSUFFICIENT_EVIDENCE',
    _maxAgeMs,
    _sanityResult     = null,
  } = opts;

  const decisionTrace = [];
  const budget        = _budget        || createCallBudget();
  const healthTracker = _healthTracker || createHealthTracker();

  const request = { location, checkIn, checkOut, currency, targetGuests };

  // ── Phase 1: Collect Airbnb snapshots ────────────────────────────────────
  //
  // Two paths:
  //  (a) _snapshotQueue provided → use directly, bypass M1 fingerprint check
  //      (caller trusts these snapshots; M1 check applies to a persistent cache,
  //       not to explicitly injected fixtures or pre-collected batches)
  //  (b) _snapshotQueue null/empty → use M3 planner + live providers
  //
  const collectedSnapshots = [];

  if (_snapshotQueue && _snapshotQueue.length > 0) {
    // Path (a): trust injected queue
    for (const snap of _snapshotQueue) {
      collectedSnapshots.push(snap);
    }
    decisionTrace.push({ step: 'QUEUE_INJECTED', count: collectedSnapshots.length });
  } else {
    // Path (b): plan and collect via live providers
    const plan = planAdaptiveCollection({
      executionPolicy: _executionPolicy,
      snapshotQueue:   [],
      budget,
      request,
      maxAgeMs:        _maxAgeMs,
    });
    decisionTrace.push({ step: 'M3_PLAN', plan: plan.decisionTrace });

    for (let i = 0; i < plan.airbnb.length; i++) {
      const step = plan.airbnb[i];

      if (step.type === 'SKIP') {
        decisionTrace.push({ step: 'AIRBNB_SKIP', callIndex: i, reason: step.reason });
        continue;
      }

      // CALL — check health before spending budget
      const healthy = isProviderHealthy(healthTracker, 'airbnb');
      if (!healthy) {
        decisionTrace.push({ step: 'AIRBNB_HEALTH_SKIP', callIndex: i, reason: 'provider_unhealthy' });
        continue;
      }

      const budgetCheck = canMakeCall(budget, 'airbnb');
      if (!budgetCheck.allowed) {
        decisionTrace.push({ step: 'AIRBNB_BUDGET_EXHAUSTED', callIndex: i, reason: budgetCheck.reason });
        break;
      }

      recordCall(budget, 'airbnb');
      try {
        const result = await _airbnbScrape(
          location, maxAirbnbListings, currency, { checkIn, checkOut }
        );
        const snap = {
          snapshotId: result.snapshotId || `airbnb-live-${i}`,
          listings:   result.listings   || [],
        };
        collectedSnapshots.push(snap);
        recordProviderOutcome(healthTracker, 'airbnb', 'success');
        decisionTrace.push({ step: 'AIRBNB_CALL', callIndex: i, snapshotId: snap.snapshotId, count: snap.listings.length });
      } catch (err) {
        recordProviderOutcome(healthTracker, 'airbnb', 'error');
        decisionTrace.push({ step: 'AIRBNB_CALL_FAILED', callIndex: i, error: err.message });
        break;
      }
    }
  }

  // ── Phase 2: Cost estimate (M7) ───────────────────────────────────────────
  // Estimate based on budget used (queue path consumes 0 budget credits)
  const liveCalls = budget.airbnb.used + budget.booking.used;
  const costEstimate = {
    totalCalls:       liveCalls,
    estimatedCredits: liveCalls,
    breakdown:        [],
  };
  decisionTrace.push({ step: 'M7_COST_ESTIMATE', estimatedCredits: costEstimate.estimatedCredits });

  // ── Phase 4: Anomaly diagnostic on collected snapshots (M6) ──────────────

  const anomalyDiagnostic = diagnoseSnapshotAnomalies(collectedSnapshots);
  decisionTrace.push({ step: 'M6_ANOMALY', severity: anomalyDiagnostic.severity });

  // ── Phase 5: Booking snapshot ─────────────────────────────────────────────

  let bookingResult = _bookingSnapshot || null;

  if (!bookingResult) {
    const bkBudget = canMakeCall(budget, 'booking');
    if (!bkBudget.allowed) {
      decisionTrace.push({ step: 'BOOKING_BUDGET_EXHAUSTED', reason: bkBudget.reason });
    } else {
      const healthy = isProviderHealthy(healthTracker, 'booking');
      if (!healthy) {
        decisionTrace.push({ step: 'BOOKING_HEALTH_SKIP', reason: 'provider_unhealthy' });
      } else {
        recordCall(budget, 'booking');
        try {
          bookingResult = await _bookingScrape(
            location, maxBookingListings, currency, { checkIn, checkOut }
          );
          recordProviderOutcome(healthTracker, 'booking', 'success');
          decisionTrace.push({ step: 'BOOKING_CALL', count: (bookingResult.listings || []).length });
        } catch (err) {
          recordProviderOutcome(healthTracker, 'booking', 'error');
          decisionTrace.push({ step: 'BOOKING_CALL_FAILED', error: err.message });
        }
      }
    }
  } else if (_bookingSnapshot) {
    decisionTrace.push({ step: 'BOOKING_INJECTED', count: (_bookingSnapshot.listings || []).length });
  }

  // ── Phase 6: Run K with queue-draining provider ───────────────────────────

  const budgetStatus = getBudgetStatus(budget);

  if (collectedSnapshots.length === 0) {
    decisionTrace.push({ step: 'K_SKIP', reason: 'no_snapshots_collected' });
    return {
      market_status:          'INSUFFICIENT',
      AIRBNB_RELIABILITY_STATUS: 'UNSTABLE_OR_INSUFFICIENT',
      MARKET_CONSENSUS_MEDIAN: null,
      decisionTrace,
      budgetStatus,
      anomalyDiagnostic,
      quarantine:             null,
      costEstimate,
      SAFE_TO_ACTIVATE_PRODUCTION: 'NO',
      _noSnapshots:           true,
    };
  }

  // Build queue-draining Airbnb provider for K
  let qIdx = 0;
  const queueProvider = async () => {
    if (qIdx < collectedSnapshots.length) return collectedSnapshots[qIdx++];
    // Repeat last — K makes up to 3 calls; mergeAndDedup handles duplicates
    return collectedSnapshots[collectedSnapshots.length - 1];
  };

  // Build Booking provider for K
  const bookingProvider = bookingResult
    ? async () => bookingResult
    : async () => { throw new Error('NO_BOOKING_SNAPSHOT'); };

  decisionTrace.push({ step: 'K_START', snapshotCount: collectedSnapshots.length });

  const kResult = await runShadowMarketEngine({
    targetLat,
    targetLon,
    targetGuests,
    targetBedrooms,
    targetPropertyType,
    location,
    currency,
    checkIn,
    checkOut,
    today,
    maxAirbnbListings,
    maxBookingListings,
    _airbnbScrape:  queueProvider,
    _bookingScrape: bookingProvider,
  });

  decisionTrace.push({ step: 'K_DONE', market_status: kResult.market_status });

  // ── Phase 7: Quarantine evaluation (M5) ──────────────────────────────────

  const quarantine = evaluateQuarantine(_sanityResult);
  decisionTrace.push({ step: 'M5_QUARANTINE', level: quarantine.level });

  return {
    ...kResult,
    decisionTrace,
    budgetStatus,
    anomalyDiagnostic,
    quarantine,
    costEstimate,
    SAFE_TO_ACTIVATE_PRODUCTION: 'NO',
  };
}

module.exports = {
  runAdaptiveMarketEngine,
  noNetworkProvider,
};

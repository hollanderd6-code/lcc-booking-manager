'use strict';
/**
 * P1.2-B5-BK-L4 — Production Signal Sanity Analysis
 *
 * Pure module — no network, no DB, no Channex.
 * Compares candidate market medians against the existing production signal.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Delta below this → ALIGNED */
const SANITY_MATERIAL_DEVIATION_PCT = 20;

/** Delta at/above MATERIAL, below this → MATERIAL_DEVIATION; at/above → LARGE_DEVIATION */
const SANITY_LARGE_DEVIATION_PCT = 50;

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute signed delta pct: (candidate - production) / production * 100
 * Positive = candidate above production.
 */
function _signedDeltaPct(candidate, production) {
  if (
    candidate == null || !Number.isFinite(candidate) || candidate <= 0 ||
    production == null || !Number.isFinite(production) || production <= 0
  ) return null;
  return (candidate - production) / production * 100;
}

/**
 * Classify based on Math.abs(signedDeltaPct).
 */
function _classify(deltaPct) {
  if (deltaPct == null) return 'INSUFFICIENT_DATA';
  const abs = Math.abs(deltaPct);
  if (abs < SANITY_MATERIAL_DEVIATION_PCT) return 'ALIGNED';
  if (abs < SANITY_LARGE_DEVIATION_PCT)    return 'MATERIAL_DEVIATION';
  return 'LARGE_DEVIATION';
}

// ── analyzeProductionSignalSanity ─────────────────────────────────────────────

/**
 * Analyze production signal against shadow candidate medians.
 *
 * @param {object} opts
 * @param {object|null}  opts.productionSignal   — DB row with median_price etc, or null
 * @param {number|null}  opts.airbnbDiagMedian   — from cross-source diagnostic
 * @param {number|null}  opts.bookingDiagMedian  — from cross-source diagnostic
 * @param {number|null}  opts.shadowConsensus    — MARKET_CONSENSUS_MEDIAN from K engine
 * @param {Date}         [opts.now]              — defaults to new Date()
 *
 * @returns {ProductionSanityResult}
 */
function analyzeProductionSignalSanity({
  productionSignal  = null,
  airbnbDiagMedian  = null,
  bookingDiagMedian = null,
  shadowConsensus   = null,
  now               = null,
} = {}) {
  const _now = now || new Date();

  if (!productionSignal) {
    return {
      available:        false,
      reason:           'no_production_signal',
      productionMedian: null,
      signalAgeHours:   null,
      signalCount:      null,
      signalDataSource: null,
      signalScrapedAt:  null,
      signalP25:        null,
      signalP75:        null,
      signalOccupancy:  null,
      signalTension:    null,
      vsAirbnb:    { deltaPct: null, classification: 'INSUFFICIENT_DATA' },
      vsBooking:   { deltaPct: null, classification: 'INSUFFICIENT_DATA' },
      vsConsensus: { deltaPct: null, classification: 'INSUFFICIENT_DATA' },
    };
  }

  const productionMedian = productionSignal.median_price != null
    ? Number(productionSignal.median_price)
    : null;

  // Signal age
  let signalAgeHours = null;
  if (productionSignal.scraped_at) {
    const scrapedAt = new Date(productionSignal.scraped_at);
    if (!isNaN(scrapedAt.getTime())) {
      signalAgeHours = Math.round((_now - scrapedAt) / (1000 * 60 * 60) * 10) / 10;
    }
  }

  const vsAirbnbDelta    = _signedDeltaPct(airbnbDiagMedian,  productionMedian);
  const vsBookingDelta   = _signedDeltaPct(bookingDiagMedian, productionMedian);
  const vsConsensusDelta = _signedDeltaPct(shadowConsensus,   productionMedian);

  return {
    available:        true,
    reason:           null,
    productionMedian: productionMedian,
    signalAgeHours,
    signalCount:      productionSignal.comparable_count ?? null,
    signalDataSource: productionSignal.data_source      ?? null,
    signalScrapedAt:  productionSignal.scraped_at       != null
      ? new Date(productionSignal.scraped_at).toISOString()
      : null,
    signalP25:        productionSignal.price_p25        != null ? Number(productionSignal.price_p25) : null,
    signalP75:        productionSignal.price_p75        != null ? Number(productionSignal.price_p75) : null,
    signalOccupancy:  productionSignal.occupancy_rate   != null ? Number(productionSignal.occupancy_rate) : null,
    signalTension:    productionSignal.tension_level    ?? null,
    vsAirbnb: {
      deltaPct:       vsAirbnbDelta != null ? Math.round(vsAirbnbDelta * 100) / 100 : null,
      classification: _classify(vsAirbnbDelta),
    },
    vsBooking: {
      deltaPct:       vsBookingDelta != null ? Math.round(vsBookingDelta * 100) / 100 : null,
      classification: _classify(vsBookingDelta),
    },
    vsConsensus: {
      deltaPct:       vsConsensusDelta != null ? Math.round(vsConsensusDelta * 100) / 100 : null,
      classification: _classify(vsConsensusDelta),
    },
  };
}

module.exports = {
  analyzeProductionSignalSanity,
  SANITY_MATERIAL_DEVIATION_PCT,
  SANITY_LARGE_DEVIATION_PCT,
};

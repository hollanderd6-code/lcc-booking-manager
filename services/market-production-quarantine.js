'use strict';
/**
 * P1.2-B5-BK-M5 — Production Signal Quarantine
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Evaluates whether a candidate shadow result should be quarantined based on
 * how far it deviates from the existing production signal.
 * QUARANTINED ≠ price write. Quarantine is informational only — it NEVER
 * modifies source usage, production signal, or Channex rates.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

// Quarantine when BOTH sources show LARGE_DEVIATION against production
const QUARANTINE_CLASSIFICATIONS = new Set(['LARGE_DEVIATION']);

// ── evaluateQuarantine ────────────────────────────────────────────────────────

/**
 * Evaluate whether the shadow result should be quarantined.
 *
 * @param {object|null} sanityResult  — from analyzeProductionSignalSanity (L4)
 *   {
 *     available:   boolean,
 *     vsAirbnb:    { classification: string },
 *     vsBooking:   { classification: string },
 *     vsConsensus: { classification: string },
 *   }
 *
 * @returns {{
 *   quarantined:    boolean,
 *   reason:         string|null,
 *   level:          'NONE'|'CAUTION'|'QUARANTINED',
 *   vsAirbnb:       string|null,
 *   vsBooking:      string|null,
 *   vsConsensus:    string|null,
 * }}
 */
function evaluateQuarantine(sanityResult) {
  if (!sanityResult || !sanityResult.available) {
    return {
      quarantined: false,
      reason:      'no_production_signal',
      level:       'NONE',
      vsAirbnb:    null,
      vsBooking:   null,
      vsConsensus: null,
    };
  }

  const vsAirbnb    = sanityResult.vsAirbnb?.classification    ?? 'INSUFFICIENT_DATA';
  const vsBooking   = sanityResult.vsBooking?.classification   ?? 'INSUFFICIENT_DATA';
  const vsConsensus = sanityResult.vsConsensus?.classification ?? 'INSUFFICIENT_DATA';

  const airbnbLarge    = QUARANTINE_CLASSIFICATIONS.has(vsAirbnb);
  const bookingLarge   = QUARANTINE_CLASSIFICATIONS.has(vsBooking);
  const consensusLarge = QUARANTINE_CLASSIFICATIONS.has(vsConsensus);

  // Quarantine when consensus deviates largely, OR both individual sources do
  if (consensusLarge || (airbnbLarge && bookingLarge)) {
    return {
      quarantined: true,
      reason:      consensusLarge
        ? `consensus_large_deviation (vsConsensus: ${vsConsensus})`
        : `both_sources_large_deviation (vsAirbnb: ${vsAirbnb}, vsBooking: ${vsBooking})`,
      level:       'QUARANTINED',
      vsAirbnb,
      vsBooking,
      vsConsensus,
    };
  }

  // Caution when at least one source shows material deviation
  const anyMaterial = vsAirbnb === 'MATERIAL_DEVIATION'
    || vsBooking === 'MATERIAL_DEVIATION'
    || vsConsensus === 'MATERIAL_DEVIATION';

  if (anyMaterial) {
    return {
      quarantined: false,
      reason:      'material_deviation_observed',
      level:       'CAUTION',
      vsAirbnb,
      vsBooking,
      vsConsensus,
    };
  }

  return {
    quarantined: false,
    reason:      null,
    level:       'NONE',
    vsAirbnb,
    vsBooking,
    vsConsensus,
  };
}

module.exports = {
  evaluateQuarantine,
  QUARANTINE_CLASSIFICATIONS,
};

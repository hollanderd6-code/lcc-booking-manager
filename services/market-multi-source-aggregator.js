'use strict';
/**
 * P1.2-B5-BK-G — Multi-Source Market Aggregator
 *
 * Pure function — no network, no DB, no Channex, no env vars.
 * Accepts already-computed per-source statistics and returns a quality-weighted
 * consensus, divergence metrics, and market signal.
 *
 * SAFETY:
 *   DB_WRITES        = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0  — no channex import
 *   PRICING_WRITES   = 0  — no pricing-apply import
 *   NETWORK_CALLS    = 0  — pure functions, no fetch/require of live services
 *   BOOKING_ROUTING_UNCHANGED — does not modify market-provider.js routing
 *
 * DESIGN INVARIANTS:
 *   1. Raw listings are NEVER naively merged ([...airbnb, ...booking]).
 *   2. Consensus is built from per-source statistics, not pooled listings.
 *   3. Weights are derived from quality scores, not raw counts.
 *   4. Booking occupancy is ALWAYS null — never averaged with Airbnb occupancy.
 *   5. Market signal (tension) comes from Airbnb only.
 *   6. null is never transformed to 0.
 *
 * API:
 *   aggregateMarketSources({ airbnb, booking }) → AggregationResult
 *
 * Input shape per source:
 *   {
 *     stats:             object|null   — output of calcBrightDataMarketStats or
 *                                        calcBrightDataBookingMarketStats
 *     comparableCount:   number        — count of listings after selectComparables
 *     selectedRadiusKm:  number|null   — radius at which comparables were selected
 *   }
 *
 * Output shape:
 *   {
 *     sources:     { airbnb: SourceSummary, booking: SourceSummary }
 *     consensus:   ConsensusSummary | null   (null when < 2 valid sources)
 *     marketSignal: MarketSignal
 *     diagnostics: DiagnosticsSummary
 *   }
 */

// ── Quality scoring constants ─────────────────────────────────────────────────

// Count tiers: comparableCount thresholds → quality contribution
const COUNT_TIERS = [
  { min: 15, score: 1.00 },
  { min: 10, score: 0.90 },
  { min:  8, score: 0.80 },
  { min:  5, score: 0.65 },
  { min:  0, score: 0.00 },
];

// Radius tiers: selectedRadiusKm thresholds → quality contribution
// null (no geo) treated same as worst valid radius (0.55)
const RADIUS_TIERS = [
  { max:  1, score: 1.00 },
  { max:  3, score: 0.95 },
  { max:  5, score: 0.90 },
  { max: 10, score: 0.75 },
  { max: 20, score: 0.55 },
];
const RADIUS_SCORE_NO_GEO = 0.55;
const RADIUS_SCORE_EXCESS = 0.00; // > MAX_RADIUS_KM

// Divergence thresholds (symmetric: |A-B| / ((A+B)/2) × 100)
const DIVERGENCE_LOW      = 10;
const DIVERGENCE_MODERATE = 25;
const DIVERGENCE_HIGH     = 50;

// Minimum quality for HIGH confidence
const CONFIDENCE_MIN_QUALITY = 0.50;

// ── Pure helpers ──────────────────────────────────────────────────────────────

function countScore(comparableCount) {
  const n = Math.max(0, comparableCount || 0);
  for (const { min, score } of COUNT_TIERS) {
    if (n >= min) return score;
  }
  return 0.00;
}

function radiusScore(selectedRadiusKm) {
  if (selectedRadiusKm == null) return RADIUS_SCORE_NO_GEO;
  const r = selectedRadiusKm;
  for (const { max, score } of RADIUS_TIERS) {
    if (r <= max) return score;
  }
  return RADIUS_SCORE_EXCESS;
}

function qualityScore(comparableCount, selectedRadiusKm) {
  return countScore(comparableCount) * radiusScore(selectedRadiusKm);
}

/**
 * Symmetric divergence percentage between two positive medians.
 * |A - B| / ((A + B) / 2) × 100
 */
function divergencePct(a, b) {
  if (a <= 0 || b <= 0) return null;
  return Math.abs(a - b) / ((a + b) / 2) * 100;
}

function divergenceLevel(pct) {
  if (pct == null) return null;
  if (pct < DIVERGENCE_LOW)      return 'LOW';
  if (pct < DIVERGENCE_MODERATE) return 'MODERATE';
  if (pct < DIVERGENCE_HIGH)     return 'HIGH';
  return 'EXTREME';
}

/**
 * Confidence level given valid source count, divergence level, and min quality.
 *
 * INSUFFICIENT  — 0 valid sources
 * LOW           — 1 valid source, OR 2+ sources with EXTREME divergence
 * MEDIUM        — 2+ sources with HIGH divergence, OR minQuality < threshold,
 *                 OR MODERATE divergence
 * HIGH          — 2+ sources, LOW divergence, both quality ≥ threshold
 */
function confidenceLevel(validSourceCount, divLevel, minQuality) {
  if (validSourceCount === 0) return 'INSUFFICIENT';
  if (validSourceCount === 1) return 'LOW';
  // 2+ sources from here
  if (divLevel === 'EXTREME')                                     return 'LOW';
  if (divLevel === 'HIGH' || minQuality < CONFIDENCE_MIN_QUALITY) return 'MEDIUM';
  if (divLevel === 'MODERATE')                                    return 'MEDIUM';
  // LOW divergence + both quality ≥ threshold
  return 'HIGH';
}

// ── Source validation ─────────────────────────────────────────────────────────

/**
 * Validate that a source's stats are usable for consensus.
 * A source is valid only when stats has a positive median with p25 ≤ median ≤ p75
 * and comparableCount ≥ MIN_COMPARABLES_FALLBACK (5).
 */
const MIN_COMPARABLES_FALLBACK = 5;

function isSourceValid(source) {
  if (!source || !source.stats) return false;
  const { stats, comparableCount } = source;
  if ((comparableCount || 0) < MIN_COMPARABLES_FALLBACK) return false;
  const { median, p25, p75 } = stats;
  if (!Number.isFinite(median) || median <= 0) return false;
  if (!Number.isFinite(p25) || !Number.isFinite(p75)) return false;
  if (p25 > median || median > p75) return false;
  return true;
}

// ── Main aggregator ───────────────────────────────────────────────────────────

/**
 * Aggregate market statistics from Airbnb and Booking.com sources.
 *
 * @param {object} inputs
 * @param {object} inputs.airbnb   — { stats, comparableCount, selectedRadiusKm }
 * @param {object} inputs.booking  — { stats, comparableCount, selectedRadiusKm }
 *
 * @returns {{
 *   sources:      { airbnb: SourceSummary, booking: SourceSummary },
 *   consensus:    ConsensusSummary | null,
 *   marketSignal: MarketSignal,
 *   diagnostics:  DiagnosticsSummary,
 * }}
 */
function aggregateMarketSources({ airbnb = null, booking = null } = {}) {
  // ── Per-source summaries ──────────────────────────────────────────────────

  const airbnbValid   = isSourceValid(airbnb);
  const bookingValid  = isSourceValid(booking);

  const airbnbQuality  = airbnbValid
    ? qualityScore(airbnb.comparableCount, airbnb.selectedRadiusKm)
    : 0;
  const bookingQuality = bookingValid
    ? qualityScore(booking.comparableCount, booking.selectedRadiusKm)
    : 0;

  const sourceSummary = (source, valid, quality) => ({
    valid,
    quality: valid ? Math.round(quality * 10000) / 10000 : null,
    median:  valid ? source.stats.median : null,
    p25:     valid ? source.stats.p25    : null,
    p75:     valid ? source.stats.p75    : null,
    comparableCount:  (source && source.comparableCount != null) ? source.comparableCount : null,
    selectedRadiusKm: (source && source.selectedRadiusKm != null) ? source.selectedRadiusKm : null,
  });

  const sources = {
    airbnb:  sourceSummary(airbnb,  airbnbValid,  airbnbQuality),
    booking: sourceSummary(booking, bookingValid, bookingQuality),
  };

  // ── Consensus ─────────────────────────────────────────────────────────────

  const validSources = [
    airbnbValid  ? { key: 'airbnb',  quality: airbnbQuality,  stats: airbnb.stats  } : null,
    bookingValid ? { key: 'booking', quality: bookingQuality, stats: booking.stats } : null,
  ].filter(Boolean);

  let consensus = null;

  if (validSources.length >= 2) {
    const totalQuality = validSources.reduce((s, vs) => s + vs.quality, 0);

    const airbnbW  = totalQuality > 0 ? airbnbQuality  / totalQuality : 0.5;
    const bookingW = totalQuality > 0 ? bookingQuality / totalQuality : 0.5;

    const airbnbMedian  = airbnb.stats.median;
    const bookingMedian = booking.stats.median;

    const rawConsensusMedian = airbnbMedian * airbnbW + bookingMedian * bookingW;
    const consensusMedian    = Math.round(rawConsensusMedian * 100) / 100;

    const dp    = divergencePct(airbnbMedian, bookingMedian);
    const dLevel = divergenceLevel(dp);

    const minQuality = Math.min(airbnbQuality, bookingQuality);
    const confLevel  = confidenceLevel(validSources.length, dLevel, minQuality);

    consensus = {
      median:       consensusMedian,
      weights:      { airbnb: Math.round(airbnbW * 10000) / 10000, booking: Math.round(bookingW * 10000) / 10000 },
      divergencePct: dp != null ? Math.round(dp * 100) / 100 : null,
      divergenceLevel: dLevel,
      confidenceLevel: confLevel,
    };
  } else if (validSources.length === 1) {
    const sole = validSources[0];
    const confLevel = confidenceLevel(1, null, null);
    consensus = {
      median:          sole.stats.median,
      weights:         sole.key === 'airbnb'
        ? { airbnb: 1.00, booking: 0.00 }
        : { airbnb: 0.00, booking: 1.00 },
      divergencePct:   null,
      divergenceLevel: null,
      confidenceLevel: confLevel,
    };
  }

  // ── Market signal (Airbnb only) ───────────────────────────────────────────
  // Booking occupancy is always null/unavailable — NEVER averaged with Airbnb.

  let marketSignal = {
    occupancy:          null,
    occupancy_semantics: null,
    tensionLevel:        null,
    source:              null,
  };

  if (
    airbnbValid &&
    airbnb.stats.occupancy_semantics === 'calendar_unavailability_proxy' &&
    airbnb.stats.occupancy != null
  ) {
    marketSignal = {
      occupancy:           airbnb.stats.occupancy,
      occupancy_semantics: 'calendar_unavailability_proxy',
      tensionLevel:        airbnb.stats.tensionLevel ?? null,
      source:              'airbnb',
    };
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  const diagnostics = {
    validSourceCount:    validSources.length,
    airbnbQuality:       airbnbValid  ? Math.round(airbnbQuality  * 10000) / 10000 : null,
    bookingQuality:      bookingValid ? Math.round(bookingQuality * 10000) / 10000 : null,
    airbnbCountScore:    airbnbValid  ? countScore(airbnb.comparableCount)         : null,
    airbnbRadiusScore:   airbnbValid  ? radiusScore(airbnb.selectedRadiusKm)       : null,
    bookingCountScore:   bookingValid ? countScore(booking.comparableCount)        : null,
    bookingRadiusScore:  bookingValid ? radiusScore(booking.selectedRadiusKm)      : null,
  };

  return { sources, consensus, marketSignal, diagnostics };
}

module.exports = {
  aggregateMarketSources,
  // Exported for tests
  countScore,
  radiusScore,
  qualityScore,
  divergencePct,
  divergenceLevel,
  confidenceLevel,
  isSourceValid,
  MIN_COMPARABLES_FALLBACK,
  COUNT_TIERS,
  RADIUS_TIERS,
  DIVERGENCE_LOW,
  DIVERGENCE_MODERATE,
  DIVERGENCE_HIGH,
  CONFIDENCE_MIN_QUALITY,
};

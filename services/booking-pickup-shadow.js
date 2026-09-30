'use strict';
/**
 * P1.3-T1 — Booking Pickup Shadow Engine (v1)
 *
 * Calculates property-specific booking acquisition velocity vs. the property's
 * own historical baseline.  ADVISORY ONLY — zero pricing integration.
 *
 * DESIGN RATIONALE
 *   Production data shows M6 (p50=1d) and M7 (p50=0d) have very short booking
 *   windows — most bookings arrive within 14 days of check-in. At 42–52
 *   bookings/year, per-stay-date analysis is too granular (expected < 0.05
 *   per 7-day window per specific night). Instead T1 uses PROPERTY-LEVEL
 *   BAND-WEIGHTED velocity: "In the last R days, how many bookings arrived
 *   with lead-times in band B, vs. historical rate for that band?"
 *
 *   This is the correct signal for these properties:
 *     - Compares against property's own history, not another property
 *     - Accounts for lead-time: band 0-1 rate ≠ band 31-60 rate
 *     - Robust to low booking volumes (property-level, not per-stay)
 *
 * EXISTING PACING SIGNAL DISTINCTION (routes/pricing-engine.js pacingMult):
 *   Pacing = occupancy position: "how full is ±12-day window vs. idealPickup?"
 *   Pickup = booking velocity: "how fast are NEW bookings arriving vs. history?"
 *   These are orthogonal. Pacing uses bookedSet+idealPickup. Pickup uses created_at.
 *
 * LIMITATION (HISTORICAL_RECONSTRUCTION):
 *   created_at = DB insertion time, not the OTA booking timestamp.
 *   For channex: webhook receipt time ≈ OTA booking time (reliable proxy).
 *   For guest_app: Stripe payment time ≈ booking time (reliable).
 *   Cancellations and stay-date modifications may not be fully captured.
 *   Confidence levels account for this uncertainty.
 *
 * SAFETY:
 *   PRICING_WRITES         = 0  always
 *   DB_WRITES              = 0  from calculatePickupShadow (SELECT only)
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_PROVIDER_CALLS  = 0  always
 *   NETWORK_CALLS          = 0  always
 *
 * SCHEMA CONTRACT (reservations table — T0-PROD-FIX verified):
 *   start_date  DATE
 *   created_at  TIMESTAMPTZ
 *   source      TEXT
 *   status      TEXT
 *   property_id TEXT
 *   (start_date::date - created_at::date) → INTEGER days
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_VERSION        = 'pickup-v1';
const LOOKBACK_MONTHS      = 12;
const LOOKBACK_DAYS        = 365;   // ≈ 12 months
const TARGET_WINDOW_DAYS   = 14;    // stay nights considered for recent pickup
const RECENT_WINDOW_DAYS   = 7;     // booking creation window for recent count
const ADVISORY_MIN         = 0.94;
const ADVISORY_MAX         = 1.06;
const MIN_BAND_SAMPLES     = 3;     // min band observations for non-INSUFFICIENT confidence
const MIN_TOTAL_SAMPLES    = 10;    // mirrors T0 threshold

// Trusted sources: created_at is a reliable booking-time proxy for these
const TRUSTED_SOURCES = Object.freeze(['channex', 'guest_app']);

// Excluded from pickup analysis
const EXCLUDED_SOURCES = Object.freeze(['BLOCK']);

// idealPickup curve — inlined from pricing-engine defaults to avoid import dependency.
// PRICING ENGINE DOES NOT IMPORT THIS FILE — this copy is for the pacing proxy only.
// [lead_time_days, expected_occupancy_fraction]
const IDEAL_PICKUP_CURVE = Object.freeze([
  [365, 0.06], [180, 0.12], [90, 0.25], [60, 0.38],
  [30, 0.55],  [14, 0.72],  [7, 0.85],  [1, 0.93],
]);

// Lead-time bands (per spec: 0-1, 2-3, 4-7, 8-14, 15-30, 31-60, 61-90, 91+)
const LEAD_TIME_BAND_DEFS = Object.freeze([
  { name: '0_1',    min: 0,  max: 1   },
  { name: '2_3',    min: 2,  max: 3   },
  { name: '4_7',    min: 4,  max: 7   },
  { name: '8_14',   min: 8,  max: 14  },
  { name: '15_30',  min: 15, max: 30  },
  { name: '31_60',  min: 31, max: 60  },
  { name: '61_90',  min: 61, max: 90  },
  { name: '91plus', min: 91, max: 9999 },  // 9999 used as SQL safe-max
]);

// ── SQL constants — exported for test inspection ──────────────────────────────

/**
 * Historical lead-time distribution for a property.
 * Returns one row per distinct lead_time_days (non-negative only).
 *
 * Schema contract: (DATE - TIMESTAMPTZ::date) = INTEGER days (T0-PROD-FIX).
 * TRUSTED_SOURCES passed as array parameter $2.
 */
const HISTORICAL_DISTRIBUTION_SQL = `
  SELECT
    (r.start_date::date - r.created_at::date) AS lead_time_days,
    COUNT(*)::int                              AS cnt
  FROM reservations r
  WHERE r.property_id = $1
    AND r.source = ANY($2)
    AND r.status = 'confirmed'
    AND r.created_at >= NOW() - ($3::int * INTERVAL '1 month')
    AND r.start_date::date >= r.created_at::date
  GROUP BY 1
  ORDER BY 1
`;

/**
 * Count of anomalous bookings (negative lead time) in the lookback window.
 * These are excluded from the historical model but counted for transparency.
 */
const ANOMALY_COUNT_SQL = `
  SELECT COUNT(*)::int AS anomaly_count
  FROM reservations r
  WHERE r.property_id = $1
    AND r.source = ANY($2)
    AND r.status = 'confirmed'
    AND r.created_at >= NOW() - ($3::int * INTERVAL '1 month')
    AND r.start_date::date < r.created_at::date
`;

/**
 * Recent booking count in the target lead-time band.
 * Counts bookings created in the last RECENT_WINDOW_DAYS days whose
 * (start_date - created_at) falls within [band_min, band_max].
 *
 * No specific stay-date target window — property-level band velocity.
 * $3 = recent_window_days (integer), $4 = band_min, $5 = band_max.
 */
const RECENT_PICKUP_SQL = `
  SELECT COUNT(*)::int AS recent_count
  FROM reservations r
  WHERE r.property_id = $1
    AND r.source = ANY($2)
    AND r.status = 'confirmed'
    AND r.created_at::date >= CURRENT_DATE - $3::int
    AND r.start_date::date >= r.created_at::date
    AND (r.start_date::date - r.created_at::date) >= $4::int
    AND (r.start_date::date - r.created_at::date) <= $5::int
`;

/**
 * Confirmed future stay count for pacing proxy.
 * Counts confirmed stays starting in the next TARGET_WINDOW_DAYS days.
 * Used to compute a simple occupancy fraction for the pacing relation diagnostic.
 * NOT the pricing-engine pacing — this is a read-only proxy only.
 */
const OCCUPANCY_PROXY_SQL = `
  SELECT COUNT(*)::int AS confirmed_stays
  FROM reservations r
  WHERE r.property_id = $1
    AND r.status = 'confirmed'
    AND r.start_date::date >= CURRENT_DATE
    AND r.start_date::date < CURRENT_DATE + $2::int
`;

// ── Pure helpers — no DB, no I/O ─────────────────────────────────────────────

/**
 * Classify a lead time (days) into the canonical band name.
 * Negative values → 'anomaly' (excluded from model).
 */
function getLeadTimeBand(days) {
  if (days == null || !Number.isFinite(days)) return 'unknown';
  if (days < 0) return 'anomaly';
  for (const def of LEAD_TIME_BAND_DEFS) {
    if (days >= def.min && days <= def.max) return def.name;
  }
  return '91plus';
}

/**
 * Return the band definition for a given band name, or null if not found.
 */
function getBandDefinition(bandName) {
  return LEAD_TIME_BAND_DEFS.find(d => d.name === bandName) ?? null;
}

/**
 * Interpolate the idealPickup expected-occupancy fraction at a given lead time.
 * Uses the same linear interpolation as pricing-engine.js `interp()`.
 * Returns 0 for lead_time < 0 (past stays). Returns 0.06 for lead_time >= 365.
 */
function interpolateIdealPickup(leadTimeDays) {
  if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) return 0;
  const curve = IDEAL_PICKUP_CURVE;
  if (leadTimeDays >= curve[0][0]) return curve[0][1];  // beyond max (365 days)
  if (leadTimeDays <= curve[curve.length - 1][0]) return curve[curve.length - 1][1]; // same/next day
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    if (leadTimeDays <= x0 && leadTimeDays >= x1) {
      const t = (x0 - leadTimeDays) / (x0 - x1);
      return y0 + t * (y1 - y0);
    }
  }
  return 0.5; // fallback
}

/**
 * Compute the expected recent-window booking count for a lead-time band.
 *
 * Derivation:
 *   bandCount   = historical bookings in band B over lookback_days
 *   rate_B      = bandCount / lookback_days   (bookings per day in band B)
 *   expected    = rate_B * recentWindowDays
 *
 * This is property-level (not per-specific-stay). Zero if bandCount is 0.
 *
 * @param {number} bandCount       — historical bookings in the target band
 * @param {number} recentWindowDays
 * @param {number} lookbackDays
 * @returns {number}  expected bookings in recent window
 */
function computeExpectedRecent(bandCount, recentWindowDays, lookbackDays) {
  if (!bandCount || bandCount <= 0 || lookbackDays <= 0) return 0;
  return (bandCount / lookbackDays) * recentWindowDays;
}

/**
 * Compute the pickup ratio (observed / expected).
 * Returns null if expected is effectively 0 (insufficient history).
 *
 * @param {number} recentCount
 * @param {number} expected
 * @returns {number|null}
 */
function computePickupRatio(recentCount, expected) {
  if (expected < 0.001) return null;  // cannot compute meaningful ratio
  return recentCount / expected;
}

/**
 * Classify confidence based on total historical sample size and
 * band-specific sample size.
 *
 * Confidence reflects both overall history depth AND the density of
 * observations in the specific lead-time band being evaluated.
 *
 * @param {number} totalSamples   — total trusted confirmed bookings in lookback
 * @param {number} bandSamples    — bookings in the relevant lead-time band
 * @returns {'INSUFFICIENT'|'LOW'|'MODERATE'|'GOOD'}
 */
function classifyConfidence(totalSamples, bandSamples) {
  if (!Number.isFinite(totalSamples) || !Number.isFinite(bandSamples)) return 'INSUFFICIENT';
  if (totalSamples < MIN_TOTAL_SAMPLES || bandSamples < MIN_BAND_SAMPLES) return 'INSUFFICIENT';
  if (totalSamples < 20) return 'LOW';
  if (totalSamples < 40) return 'MODERATE';
  return 'GOOD';
}

/**
 * Classify pickup status from ratio and confidence.
 *
 * Thresholds are wider than a typical model because:
 * - Low booking volumes (42-52/year) → high per-week variance
 * - T1 is shadow only — conservative to avoid false signals
 *
 * @param {number|null} ratio
 * @param {'INSUFFICIENT'|'LOW'|'MODERATE'|'GOOD'} confidence
 * @returns {'ACCELERATING'|'NORMAL'|'SLOW'|'INSUFFICIENT_DATA'}
 */
function classifyPickupStatus(ratio, confidence) {
  if (confidence === 'INSUFFICIENT' || ratio === null) return 'INSUFFICIENT_DATA';
  if (ratio >= 2.0)  return 'ACCELERATING';
  if (ratio >= 0.4)  return 'NORMAL';
  return 'SLOW';
}

/**
 * Map pickup status + confidence to an advisory multiplier.
 * Conservative range [0.94, 1.06] for T1 shadow.
 * ADVISORY ONLY — not fed to any pricing formula.
 *
 * @param {'ACCELERATING'|'NORMAL'|'SLOW'|'INSUFFICIENT_DATA'} status
 * @param {'INSUFFICIENT'|'LOW'|'MODERATE'|'GOOD'} confidence
 * @returns {number}  multiplier in [ADVISORY_MIN, ADVISORY_MAX]
 */
function computeAdvisoryMultiplier(status, confidence) {
  if (status === 'INSUFFICIENT_DATA' || confidence === 'INSUFFICIENT') return 1.00;
  if (status === 'ACCELERATING') {
    if (confidence === 'GOOD')     return ADVISORY_MAX;            // 1.06
    if (confidence === 'MODERATE') return 1.05;
    return 1.03;                                                    // LOW
  }
  if (status === 'SLOW') {
    if (confidence === 'GOOD')     return ADVISORY_MIN;            // 0.94
    if (confidence === 'MODERATE') return 0.95;
    return 0.97;                                                    // LOW
  }
  return 1.00;  // NORMAL
}

/**
 * Classify pacing strength from current occupancy fraction vs. idealPickup.
 *
 * occupancyFraction = confirmed_stays / TARGET_WINDOW_DAYS
 * idealFraction     = interpolateIdealPickup(leadTimeDays)
 * pacing_score      = occupancyFraction / max(idealFraction, 0.01)
 *
 * @param {number} occupancyFraction  [0, 1+]
 * @param {number} leadTimeDays
 * @returns {'STRONG'|'NORMAL'|'WEAK'|'UNKNOWN'}
 */
function classifyPacingStrength(occupancyFraction, leadTimeDays) {
  if (!Number.isFinite(occupancyFraction) || !Number.isFinite(leadTimeDays)) return 'UNKNOWN';
  const expected = interpolateIdealPickup(leadTimeDays);
  const score = occupancyFraction / Math.max(expected, 0.01);
  if (score >= 1.15) return 'STRONG';
  if (score >= 0.75) return 'NORMAL';
  return 'WEAK';
}

/**
 * Produce the pacing/pickup relation diagnostic.
 * Describes the alignment of the existing pacing signal with the new pickup signal.
 *
 * @param {'STRONG'|'NORMAL'|'WEAK'|'UNKNOWN'} pacingStrength
 * @param {'ACCELERATING'|'NORMAL'|'SLOW'|'INSUFFICIENT_DATA'} pickupStatus
 * @param {'INSUFFICIENT'|'LOW'|'MODERATE'|'GOOD'} confidence
 * @returns {string}
 */
function diagnosePacingPickupRelation(pacingStrength, pickupStatus, confidence) {
  if (confidence === 'INSUFFICIENT' || pickupStatus === 'INSUFFICIENT_DATA' || pacingStrength === 'UNKNOWN') {
    return 'INSUFFICIENT';
  }
  const ps = pacingStrength;
  const pk = pickupStatus;
  if (ps === 'STRONG'  && pk === 'ACCELERATING') return 'BOTH_STRONG';
  if (ps === 'STRONG'  && pk === 'NORMAL')        return 'PACING_STRONG_PICKUP_NORMAL';
  if (ps === 'STRONG'  && pk === 'SLOW')          return 'PACING_STRONG_PICKUP_SLOW';
  if (ps === 'NORMAL'  && pk === 'ACCELERATING')  return 'PICKUP_ACCELERATING_PACING_NORMAL';
  if (ps === 'NORMAL'  && pk === 'NORMAL')         return 'BOTH_NORMAL';
  if (ps === 'NORMAL'  && pk === 'SLOW')           return 'PICKUP_SLOW_PACING_NORMAL';
  if (ps === 'WEAK'    && pk === 'ACCELERATING')  return 'PACING_WEAK_PICKUP_ACCELERATING';
  if (ps === 'WEAK'    && pk === 'NORMAL')         return 'PACING_WEAK_PICKUP_NORMAL';
  if (ps === 'WEAK'    && pk === 'SLOW')           return 'BOTH_WEAK';
  return 'BOTH_NORMAL';
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Parse targetDate (Date or 'YYYY-MM-DD') to UTC midnight Date.
 */
function parseTargetDate(targetDate) {
  if (targetDate instanceof Date) {
    return new Date(Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate()
    ));
  }
  if (typeof targetDate === 'string') {
    const parts = targetDate.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      throw new Error(`Invalid targetDate string: ${targetDate}`);
    }
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }
  throw new Error(`Invalid targetDate type: ${typeof targetDate}`);
}

/**
 * Compute lead time from today (UTC) to targetDate in calendar days.
 * Returns negative for past dates.
 */
function computeLeadTimeFromToday(targetDate) {
  const target  = parseTargetDate(targetDate);
  const now     = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target.getTime() - todayMs) / 86400000);
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Calculate the shadow pickup observation for a property and target date.
 * READ-ONLY — no DB writes. Separation: persistence is in booking-pickup-persistence.js.
 *
 * @param {object}       pool        — pg Pool
 * @param {string}       propertyId
 * @param {string|Date}  targetDate  — the stay date to evaluate (or representative date)
 * @param {object}       [options]
 * @param {number}       [options.lookbackMonths=12]
 * @param {number}       [options.recentWindowDays=7]
 * @param {number}       [options.targetWindowDays=14]  — for pacing proxy occupancy
 * @returns {Promise<object>}  full observation object (advisory only)
 */
async function calculatePickupShadow(pool, propertyId, targetDate, options = {}) {
  const lookbackMonths   = options.lookbackMonths   ?? LOOKBACK_MONTHS;
  const recentWindowDays = options.recentWindowDays ?? RECENT_WINDOW_DAYS;
  const targetWindowDays = options.targetWindowDays ?? TARGET_WINDOW_DAYS;
  const lookbackDays     = lookbackMonths * 30.4375; // ≈ average month length

  const leadTimeDays = computeLeadTimeFromToday(targetDate);
  const band         = getLeadTimeBand(leadTimeDays);
  const bandDef      = getBandDefinition(band) ?? { min: 0, max: 9999 };
  const bandMin      = bandDef.min;
  const bandMax      = Math.min(bandDef.max, 9999);

  const [histResult, anomalyResult, recentResult, occupancyResult] = await Promise.all([
    pool.query(HISTORICAL_DISTRIBUTION_SQL, [propertyId, TRUSTED_SOURCES, lookbackMonths]),
    pool.query(ANOMALY_COUNT_SQL,           [propertyId, TRUSTED_SOURCES, lookbackMonths]),
    pool.query(RECENT_PICKUP_SQL,           [propertyId, TRUSTED_SOURCES, recentWindowDays, bandMin, bandMax]),
    pool.query(OCCUPANCY_PROXY_SQL,         [propertyId, targetWindowDays]),
  ]);

  // Aggregate historical distribution
  let totalHistorical = 0;
  let bandHistorical  = 0;
  for (const row of histResult.rows) {
    const lt = Number(row.lead_time_days);
    const cnt = Number(row.cnt);
    totalHistorical += cnt;
    if (lt >= bandMin && lt <= bandDef.max) bandHistorical += cnt;
  }

  const anomalyCount     = Number(anomalyResult.rows[0]?.anomaly_count ?? 0);
  const recentCount      = Number(recentResult.rows[0]?.recent_count ?? 0);
  const confirmedStays   = Number(occupancyResult.rows[0]?.confirmed_stays ?? 0);

  // Core pickup metrics
  const expected    = computeExpectedRecent(bandHistorical, recentWindowDays, lookbackDays);
  const ratio       = computePickupRatio(recentCount, expected);
  const confidence  = classifyConfidence(totalHistorical, bandHistorical);
  const status      = classifyPickupStatus(ratio, confidence);
  const advisory    = computeAdvisoryMultiplier(status, confidence);

  // Pacing proxy (occupancy-based, not the actual pricing-engine pacing)
  const occupancyFraction = confirmedStays / Math.max(targetWindowDays, 1);
  const pacingStrength    = classifyPacingStrength(occupancyFraction, leadTimeDays);
  const pacingPickupRelation = diagnosePacingPickupRelation(pacingStrength, status, confidence);

  // Reasons array for explainability
  const reasons = [];
  if (band === 'anomaly') reasons.push(`target_date_is_in_the_past`);
  if (confidence === 'INSUFFICIENT') reasons.push(`insufficient_history:total=${totalHistorical},band=${bandHistorical}`);
  if (anomalyCount > 0) reasons.push(`anomalies_excluded:${anomalyCount}`);
  if (ratio !== null) reasons.push(`ratio=${Number(ratio.toFixed(3))}`);
  reasons.push(`band=${band},band_count=${bandHistorical}`);
  reasons.push(`pacing_strength=${pacingStrength},occ=${occupancyFraction.toFixed(3)}`);

  return {
    propertyId,
    targetDate:           targetDate instanceof Date
                            ? targetDate.toISOString().slice(0, 10)
                            : String(targetDate),
    leadTimeDays,
    leadTimeBand:         band,

    lookbackMonths,
    historicalSampleSize: totalHistorical,
    comparableSampleSize: bandHistorical,

    recentWindowDays,
    recentBookings:       recentCount,
    expectedBookings:     Number(expected.toFixed(4)),

    pickupRatio:          ratio !== null ? Number(ratio.toFixed(4)) : null,
    status,
    confidence,
    advisoryMultiplier:   advisory,

    occupancyFraction:    Number(occupancyFraction.toFixed(4)),
    pacingStrength,
    pacingPickupRelation,

    baselineType:         'PROPERTY_HISTORY',
    anomaliesExcluded:    anomalyCount,
    modelVersion:         MODEL_VERSION,
    calculatedAt:         new Date().toISOString(),

    reasons,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  MODEL_VERSION,
  TRUSTED_SOURCES,
  EXCLUDED_SOURCES,
  LOOKBACK_MONTHS,
  LOOKBACK_DAYS,
  TARGET_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  ADVISORY_MIN,
  ADVISORY_MAX,
  MIN_BAND_SAMPLES,
  MIN_TOTAL_SAMPLES,
  LEAD_TIME_BAND_DEFS,
  IDEAL_PICKUP_CURVE,

  // SQL
  HISTORICAL_DISTRIBUTION_SQL,
  ANOMALY_COUNT_SQL,
  RECENT_PICKUP_SQL,
  OCCUPANCY_PROXY_SQL,

  // Pure helpers
  getLeadTimeBand,
  getBandDefinition,
  interpolateIdealPickup,
  computeExpectedRecent,
  computePickupRatio,
  classifyConfidence,
  classifyPickupStatus,
  computeAdvisoryMultiplier,
  classifyPacingStrength,
  diagnosePacingPickupRelation,
  computeLeadTimeFromToday,
  parseTargetDate,

  // Main function
  calculatePickupShadow,
};

'use strict';
/**
 * P1.3-T1/T2/T2-FIX — Booking Pickup Shadow Persistence
 *
 * Feature-flagged persistence for pickup observations.
 * Defaults to OFF (BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED must be 'true').
 * Caller (shadow job / audit tool) is responsible for gating.
 *
 * SAFETY:
 *   Only writes to booking_pickup_observations (shadow table).
 *   Never touches: pricing_schedule, pricing_config, reservations, market_observations,
 *   or any table read by pricing-engine.js.
 *   No Channex calls, no network calls, no market provider calls.
 *   PICKUP_HAS_PRICING_AUTHORITY=NO — never imported by pricing-engine.js.
 */

const INSERT_OBSERVATION_SQL = `
  INSERT INTO booking_pickup_observations (
    property_id, target_date, calculated_at,
    observation_date,
    lead_time_days, lead_time_band,
    lookback_months, target_window_days,
    historical_total, historical_band_count, comparable_sample_size,
    recent_window_days, recent_booking_count, expected_booking_count,
    raw_pickup_ratio, pickup_ratio,
    status, confidence, advisory_multiplier,
    occupancy_fraction, pacing_pickup_relation,
    model_version, anomalies_excluded, metadata
  ) VALUES (
    $1, $2, $3,
    $4,
    $5, $6,
    $7, $8,
    $9, $10, $10,
    $11, $12, $13,
    $14, $15,
    $16, $17, $18,
    $19, $20,
    $21, $22, $23
  )
  ON CONFLICT ON CONSTRAINT bpo_property_target_obs_model_unique DO NOTHING
  RETURNING id
`;

/**
 * Returns true only when the env var is explicitly set to 'true'.
 */
function isPersistenceEnabled() {
  return process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED === 'true';
}

/**
 * Returns true when tz is a valid IANA timezone string recognised by the V8 engine.
 * Uses Intl.DateTimeFormat for validation — no external dependency required.
 */
function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Derive the local observation date (YYYY-MM-DD) at the given IANA timezone.
 *
 * Semantics: "calendar date at the PROPERTY LOCATION when this observation was calculated".
 *
 * OBSERVATION_DATE_TIMEZONE_SOURCE = properties.timezone
 * OBSERVATION_DATE_FALLBACK         = UTC (when timezone is missing or invalid)
 *
 * Examples:
 *   '2026-10-01T00:30:00Z', 'Europe/Paris'        → '2026-10-01'  (UTC+2 CEST)
 *   '2026-10-01T00:30:00Z', 'America/Los_Angeles'  → '2026-09-30'  (UTC-7 PDT)
 *   '2026-09-30T23:30:00Z', 'Asia/Tokyo'           → '2026-10-01'  (UTC+9)
 *   '2026-09-30T06:00:00Z', undefined              → '2026-09-30'  (UTC fallback)
 *
 * @param {string|null} ts        — ISO-8601 timestamp; null → now
 * @param {string}      [timezone] — IANA timezone (e.g. 'Europe/Paris'); invalid → UTC
 * @returns {string}               YYYY-MM-DD
 */
function observationDateFromCalcAt(ts, timezone) {
  const dt = ts ? new Date(ts) : new Date();
  const tz = isValidTimezone(timezone) ? timezone : 'UTC';
  // sv-SE locale formats as 'YYYY-MM-DD HH:mm:ss' — matches existing project pattern
  return dt.toLocaleString('sv-SE', { timeZone: tz }).slice(0, 10);
}

/**
 * Persist a pickup observation row. Skips silently if persistence is disabled.
 * Returns the inserted row id, or null if skipped / conflict.
 *
 * The observation_date is derived from observation.calculatedAt using the given timezone
 * so that the deduplication key reflects the property's local calendar day.
 *
 * @param {object} pool         — pg Pool
 * @param {object} observation  — result from calculatePickupShadow()
 * @param {string} [timezone]   — IANA property timezone (e.g. 'Europe/Paris'); invalid → UTC
 * @returns {Promise<number|null>}
 */
async function persistPickupObservation(pool, observation, timezone) {
  if (!isPersistenceEnabled()) return null;

  const calculatedAt    = observation.calculatedAt ?? new Date().toISOString();
  const observationDate = observationDateFromCalcAt(calculatedAt, timezone);

  const meta = {
    reasons:                observation.reasons        ?? [],
    baselineType:           observation.baselineType,
    pacingStrength:         observation.pacingStrength ?? null,
    observationTimezone:    isValidTimezone(timezone) ? timezone : 'UTC',
    observationTzSource:    isValidTimezone(timezone) ? 'properties.timezone' : 'UTC_FALLBACK',
  };

  const result = await pool.query(INSERT_OBSERVATION_SQL, [
    observation.propertyId,                    // $1  property_id
    observation.targetDate,                    // $2  target_date
    calculatedAt,                              // $3  calculated_at
    observationDate,                           // $4  observation_date (property-local date)
    observation.leadTimeDays,                  // $5  lead_time_days
    observation.leadTimeBand,                  // $6  lead_time_band
    observation.lookbackMonths,                // $7  lookback_months
    observation.targetWindowDays ?? 14,        // $8  target_window_days
    observation.historicalSampleSize,          // $9  historical_total
    observation.comparableSampleSize,          // $10 historical_band_count + comparable_sample_size
    observation.recentWindowDays,              // $11 recent_window_days
    observation.recentBookings,                // $12 recent_booking_count
    observation.expectedBookings,              // $13 expected_booking_count
    observation.rawPickupRatio ?? null,        // $14 raw_pickup_ratio (null when LOW_EVIDENCE)
    observation.pickupRatio,                   // $15 pickup_ratio (stabilized)
    observation.status,                        // $16 status
    observation.confidence,                    // $17 confidence
    observation.advisoryMultiplier,            // $18 advisory_multiplier
    observation.occupancyFraction,             // $19 occupancy_fraction
    observation.pacingPickupRelation,          // $20 pacing_pickup_relation
    observation.modelVersion,                  // $21 model_version
    observation.anomaliesExcluded ?? 0,        // $22 anomalies_excluded
    JSON.stringify(meta),                      // $23 metadata (includes tz provenance)
  ]);

  return result.rows[0]?.id ?? null;
}

module.exports = {
  isPersistenceEnabled,
  isValidTimezone,
  observationDateFromCalcAt,
  persistPickupObservation,
  INSERT_OBSERVATION_SQL,
};

'use strict';
/**
 * P1.4-T1-FIX — Local Seasonality Shadow Persistence
 *
 * Writes target-month observations to local_seasonality_observations.
 * Feature-flagged: LOCAL_SEASONALITY_SHADOW_ENABLED (default false).
 *
 * SAFETY:
 *   PRICING_WRITES = 0  always (never touches pricing_schedule or pricing_config)
 *   CHANNEX_CALLS  = 0  always
 *   NETWORK_CALLS  = 0  always
 *   DB_WRITES      = 0 when flag is OFF
 *   LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY = NO
 *
 * CONFLICT POLICY:
 *   INSERT ... ON CONFLICT DO NOTHING — first canonical observation wins.
 *   Historical point-in-time evidence is never overwritten.
 */

const MODEL_VERSION = 'seasonality-shadow-v1';

function isShadowEnabled() {
  return process.env.LOCAL_SEASONALITY_SHADOW_ENABLED === 'true';
}

// One row per (property_id, target_month, observation_date, model_version).
// DO NOTHING on conflict: preserves point-in-time history — retrying the same
// observation_date is idempotent without corrupting historical evidence.
const INSERT_OBSERVATION_SQL = `
  INSERT INTO local_seasonality_observations (
    property_id,
    target_month,
    observation_date,
    calculated_at,
    model_version,
    property_timezone,
    country,
    currency,
    market_context_key,
    market_profile_id,
    calendar_nights,
    elapsed_calendar_nights,
    remaining_calendar_nights,
    days_until_month_start,
    month_complete,
    booked_nights,
    known_blocked_nights,
    known_sellable_nights,
    occupancy_fraction,
    exposure_confidence,
    reliable_reservation_count,
    source_distribution,
    generic_reference_factor
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8,
    $9, $10,
    $11, $12, $13,
    $14, $15,
    $16, $17, $18, $19,
    $20, $21, $22,
    $23
  )
  ON CONFLICT (property_id, target_month, observation_date, model_version)
  DO NOTHING
`;

/**
 * Persist one target-month observation.
 * Returns true if the row was inserted, false if it already existed (DO NOTHING).
 *
 * @param {object} pool
 * @param {{
 *   propertyId: number|string,
 *   targetMonth: string,        — 'YYYY-MM-01'
 *   observationDate: string,    — 'YYYY-MM-DD'
 *   calculatedAt: string,       — ISO timestamp
 *   timezone: string|null,
 *   country: string|null,
 *   currency: string|null,
 *   marketContextKey: string|null,
 *   marketProfileId: string|null,
 *   calendarNights: number,
 *   elapsedCalendarNights: number,
 *   remainingCalendarNights: number,
 *   daysUntilMonthStart: number,
 *   monthComplete: boolean,
 *   bookedNights: number,
 *   knownBlockedNights: number,
 *   knownSellableNights: number|null,
 *   occupancyFraction: number|null,
 *   exposureConfidence: string,
 *   reliableReservationCount: number,
 *   sourceDistribution: object,
 *   genericReferenceFactor: number|null,
 * }} obs
 * @returns {Promise<boolean>} — true if inserted
 */
async function persistObservation(pool, obs) {
  const result = await pool.query(INSERT_OBSERVATION_SQL, [
    obs.propertyId,
    obs.targetMonth,
    obs.observationDate,
    obs.calculatedAt,
    MODEL_VERSION,
    obs.timezone     || null,
    obs.country      || null,
    obs.currency     || null,
    obs.marketContextKey  || null,
    obs.marketProfileId   || null,
    obs.calendarNights,
    obs.elapsedCalendarNights,
    obs.remainingCalendarNights,
    obs.daysUntilMonthStart,
    obs.monthComplete,
    obs.bookedNights,
    obs.knownBlockedNights,
    obs.knownSellableNights ?? null,
    obs.occupancyFraction   ?? null,
    obs.exposureConfidence,
    obs.reliableReservationCount,
    JSON.stringify(obs.sourceDistribution),
    obs.genericReferenceFactor ?? null,
  ]);
  return result.rowCount > 0; // true = inserted; false = DO NOTHING (duplicate)
}

module.exports = { isShadowEnabled, persistObservation, MODEL_VERSION, INSERT_OBSERVATION_SQL };

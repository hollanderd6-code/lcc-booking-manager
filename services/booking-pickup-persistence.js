'use strict';
/**
 * P1.3-T1 — Booking Pickup Shadow Persistence
 *
 * Feature-flagged persistence for pickup observations.
 * Defaults to OFF (BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED must be 'true').
 * Caller (audit tool / future scheduled job) is responsible for gating.
 *
 * SAFETY:
 *   Only writes to booking_pickup_observations (shadow table).
 *   Never touches: pricing_schedule, pricing_config, reservations, market_observations,
 *   or any table read by pricing-engine.js.
 *   No Channex calls, no network calls, no market provider calls.
 */

const INSERT_OBSERVATION_SQL = `
  INSERT INTO booking_pickup_observations (
    property_id, target_date, calculated_at,
    lead_time_days, lead_time_band,
    lookback_months, target_window_days,
    historical_total, historical_band_count, comparable_sample_size,
    recent_window_days, recent_booking_count, expected_booking_count,
    pickup_ratio, status, confidence, advisory_multiplier,
    occupancy_fraction, pacing_pickup_relation,
    model_version, anomalies_excluded, metadata
  ) VALUES (
    $1, $2, $3,
    $4, $5,
    $6, $7,
    $8, $9, $9,
    $10, $11, $12,
    $13, $14, $15, $16,
    $17, $18,
    $19, $20, $21
  )
  ON CONFLICT (property_id, target_date, calculated_at) DO NOTHING
  RETURNING id
`;

/**
 * Returns true only when the env var is explicitly set to 'true'.
 */
function isPersistenceEnabled() {
  return process.env.BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED === 'true';
}

/**
 * Persist a pickup observation row. Skips silently if persistence is disabled.
 * Returns the inserted row id, or null if skipped / conflict.
 *
 * @param {object} pool         — pg Pool
 * @param {object} observation  — result from calculatePickupShadow()
 * @returns {Promise<number|null>}
 */
async function persistPickupObservation(pool, observation) {
  if (!isPersistenceEnabled()) return null;

  const meta = {
    reasons:      observation.reasons ?? [],
    baselineType: observation.baselineType,
    pacingStrength: observation.pacingStrength ?? null,
  };

  const result = await pool.query(INSERT_OBSERVATION_SQL, [
    observation.propertyId,                                  // $1
    observation.targetDate,                                  // $2
    observation.calculatedAt ?? new Date().toISOString(),    // $3
    observation.leadTimeDays,                                // $4
    observation.leadTimeBand,                                // $5
    observation.lookbackMonths,                              // $6
    observation.targetWindowDays ?? 14,                     // $7
    observation.historicalSampleSize,                        // $8
    observation.comparableSampleSize,                        // $9 (historical_band_count AND comparable_sample_size)
    observation.recentWindowDays,                            // $10
    observation.recentBookings,                              // $11
    observation.expectedBookings,                            // $12
    observation.pickupRatio,                                 // $13 — may be null
    observation.status,                                      // $14
    observation.confidence,                                  // $15
    observation.advisoryMultiplier,                          // $16
    observation.occupancyFraction,                           // $17
    observation.pacingPickupRelation,                        // $18
    observation.modelVersion,                                // $19
    observation.anomaliesExcluded ?? 0,                      // $20
    JSON.stringify(meta),                                    // $21
  ]);

  return result.rows[0]?.id ?? null;
}

module.exports = {
  isPersistenceEnabled,
  persistPickupObservation,
  INSERT_OBSERVATION_SQL,
};

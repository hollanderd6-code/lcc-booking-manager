'use strict';
/**
 * P1.4-T1 — Local Seasonality Shadow Persistence
 *
 * Writes readiness snapshots to local_seasonality_readiness.
 * Feature-flagged: LOCAL_SEASONALITY_SHADOW_ENABLED (default false).
 *
 * SAFETY:
 *   PRICING_WRITES = 0  always (never touches pricing_schedule or pricing_config)
 *   CHANNEX_CALLS  = 0  always
 *   NETWORK_CALLS  = 0  always
 *   DB_WRITES      = 0 when flag is OFF
 *   SEASONALITY_HAS_PRICING_AUTHORITY = NO
 */

const MODEL_VERSION = 'seasonality-v1';

function isShadowEnabled() {
  return process.env.LOCAL_SEASONALITY_SHADOW_ENABLED === 'true';
}

// INSERT with ON CONFLICT upsert — one row per (property_id, snapshot_date).
// On re-run for the same date, overwrites with the latest calculation.
const UPSERT_SNAPSHOT_SQL = `
  INSERT INTO local_seasonality_readiness (
    property_id,
    snapshot_date,
    tier,
    distinct_calendar_months,
    distinct_years,
    total_booked_nights,
    yoy_pair_count,
    exposure_confidence,
    first_stay_date,
    last_stay_date,
    monthly_nights_json,
    model_version,
    computed_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
  ON CONFLICT (property_id, snapshot_date)
  DO UPDATE SET
    tier                     = EXCLUDED.tier,
    distinct_calendar_months = EXCLUDED.distinct_calendar_months,
    distinct_years           = EXCLUDED.distinct_years,
    total_booked_nights      = EXCLUDED.total_booked_nights,
    yoy_pair_count           = EXCLUDED.yoy_pair_count,
    exposure_confidence      = EXCLUDED.exposure_confidence,
    first_stay_date          = EXCLUDED.first_stay_date,
    last_stay_date           = EXCLUDED.last_stay_date,
    monthly_nights_json      = EXCLUDED.monthly_nights_json,
    model_version            = EXCLUDED.model_version,
    computed_at              = NOW()
`;

/**
 * Persist a readiness snapshot for one property.
 *
 * @param {object} pool
 * @param {number|string} propertyId
 * @param {string} snapshotDate — YYYY-MM-DD
 * @param {{
 *   tier: string,
 *   distinctCalendarMonths: number,
 *   distinctYears: number,
 *   totalBookedNights: number,
 *   yoyPairCount: number,
 *   exposureConfidence: string,
 *   firstStayDate: string|null,
 *   lastStayDate: string|null,
 *   monthlyNights: object,
 * }} snapshot
 */
async function persistReadinessSnapshot(pool, propertyId, snapshotDate, snapshot) {
  await pool.query(UPSERT_SNAPSHOT_SQL, [
    propertyId,
    snapshotDate,
    snapshot.tier,
    snapshot.distinctCalendarMonths,
    snapshot.distinctYears,
    snapshot.totalBookedNights,
    snapshot.yoyPairCount,
    snapshot.exposureConfidence,
    snapshot.firstStayDate || null,
    snapshot.lastStayDate  || null,
    JSON.stringify(snapshot.monthlyNights),
    MODEL_VERSION,
  ]);
}

module.exports = { isShadowEnabled, persistReadinessSnapshot, MODEL_VERSION, UPSERT_SNAPSHOT_SQL };

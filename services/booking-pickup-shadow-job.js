'use strict';
/**
 * P1.3-T2-FIX — Booking Pickup Shadow Job
 *
 * Calculates pickup-v1.1 observations for every eligible BoostPrice property
 * across a 30-day forward horizon and persists the results.
 *
 * Design invariants:
 *   - Feature-flagged: returns immediately when BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED != 'true'
 *   - FLAG_OFF_CALCULATIONS = 0 / FLAG_OFF_WRITES = 0
 *   - Failures isolated per target date, then per property
 *   - Job failure MUST NOT block the pricing cycle (caller wraps in .catch())
 *   - Fully independent of market provider (APIFY/Bright Data): uses reservation DB only
 *   - PICKUP_HAS_PRICING_AUTHORITY = NO — results never flow into pricing_schedule
 *
 * SAFETY:
 *   CHANNEX_CALLS          = 0
 *   MARKET_PROVIDER_CALLS  = 0
 *   PRICING_WRITES         = 0
 *   DB_WRITES              = 0 when flag is OFF
 */

const {
  isPersistenceEnabled,
  isValidTimezone,
  observationDateFromCalcAt,
  persistPickupObservation,
} = require('./booking-pickup-persistence');

const { calculatePickupShadow } = require('./booking-pickup-shadow');

/**
 * Number of future target dates to compute per property per run.
 * local today+1 through local today+PICKUP_HORIZON_DAYS (inclusive) = exactly 30 dates.
 */
const PICKUP_HORIZON_DAYS = 30;

/**
 * Properties eligible for pickup shadow collection:
 * has an active BoostPrice config, joined with timezone for local-date computation.
 */
const ELIGIBLE_PROPERTIES_SQL = `
  SELECT
    pc.property_id,
    p.internal_name,
    p.name,
    p.timezone
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
`;

/**
 * Generate exactly horizonDays future target dates starting from local today+1.
 * Returns ['YYYY-MM-DD', ...] — today is excluded, past dates never generated.
 *
 * @param {string} localTodayStr — YYYY-MM-DD of the property's local today
 * @param {number} horizonDays   — number of target dates to generate (default 30)
 * @returns {string[]}           — exactly horizonDays ISO-8601 date strings
 */
function generateTargetDates(localTodayStr, horizonDays) {
  const dates = [];
  for (let i = 1; i <= horizonDays; i++) {
    // Use noon UTC as the base to avoid DST boundary edge cases in date arithmetic
    const d = new Date(localTodayStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Run the pickup shadow collection job.
 *
 * Stats returned:
 *   propertiesEligible    — properties loaded from DB
 *   propertiesProcessed   — properties for which all target dates completed (even partially)
 *   targetDatesAttempted  — total calculatePickupShadow calls made
 *   observationsCalculated — successful calculatePickupShadow calls
 *   observationsPersisted — rows inserted (DO NOTHING = 0 here)
 *   duplicatesSkipped     — rows silently skipped by ON CONFLICT DO NOTHING
 *   errors                — [{ property_id, targetDate?, error }] (no PII)
 *   skippedReason?        — present when job returns early (e.g. 'PERSISTENCE_FLAG_OFF')
 *
 * @param {object}   pool                     — pg Pool
 * @param {object}   [options]
 * @param {number}   [options.horizonDays=30] — target date window
 * @param {Function} [options._calculateFn]   — injectable for tests (default: calculatePickupShadow)
 * @param {Function} [options._persistFn]     — injectable for tests (default: persistPickupObservation)
 * @returns {Promise<object>} stats
 */
async function runPickupShadowJob(pool, options = {}) {
  const {
    horizonDays  = PICKUP_HORIZON_DAYS,
    _calculateFn = calculatePickupShadow,
    _persistFn   = persistPickupObservation,
  } = options;

  // FLAG_OFF: skip entirely — zero calculations, zero writes
  if (!isPersistenceEnabled()) {
    return {
      propertiesEligible:      0,
      propertiesProcessed:     0,
      targetDatesAttempted:    0,
      observationsCalculated:  0,
      observationsPersisted:   0,
      duplicatesSkipped:       0,
      errors:                  [],
      skippedReason:           'PERSISTENCE_FLAG_OFF',
    };
  }

  const stats = {
    propertiesEligible:      0,
    propertiesProcessed:     0,
    targetDatesAttempted:    0,
    observationsCalculated:  0,
    observationsPersisted:   0,
    duplicatesSkipped:       0,
    errors:                  [],
  };

  // Load eligible properties
  const { rows: props } = await pool.query(ELIGIBLE_PROPERTIES_SQL);
  stats.propertiesEligible = props.length;

  for (const prop of props) {
    try {
      const tz          = isValidTimezone(prop.timezone) ? prop.timezone : 'UTC';
      const nowIso      = new Date().toISOString();
      const localToday  = observationDateFromCalcAt(nowIso, tz);
      const targetDates = generateTargetDates(localToday, horizonDays);

      for (const targetDate of targetDates) {
        stats.targetDatesAttempted++;
        try {
          const obs = await _calculateFn(pool, prop.property_id, targetDate);
          stats.observationsCalculated++;

          const id = await _persistFn(pool, obs, tz);
          if (id !== null) {
            stats.observationsPersisted++;
          } else {
            stats.duplicatesSkipped++;
          }
        } catch (err) {
          stats.errors.push({
            property_id: prop.property_id,
            targetDate,
            error: err.message,
          });
        }
      }

      stats.propertiesProcessed++;
    } catch (err) {
      stats.errors.push({
        property_id: prop.property_id,
        error: err.message,
      });
    }
  }

  return stats;
}

module.exports = {
  PICKUP_HORIZON_DAYS,
  ELIGIBLE_PROPERTIES_SQL,
  generateTargetDates,
  runPickupShadowJob,
};

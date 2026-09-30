'use strict';
/**
 * P1.4-T1-FIX — Local Seasonality Shadow Job
 *
 * Weekly job that generates target-month observations for every active
 * BoostPrice property across a 9-month forward horizon and persists them.
 *
 * Per collection, each property produces HORIZON_MONTHS rows:
 *   current local calendar month + 8 forward months
 *
 * This longitudinal record enables booking build-up analysis at
 * D180/D120/D90/D60/D30/D14/D7 for each calendar month.
 *
 * Design invariants:
 *   - Feature-flagged: returns immediately when LOCAL_SEASONALITY_SHADOW_ENABLED != 'true'
 *   - FLAG_OFF_CALCULATIONS = 0 / FLAG_OFF_WRITES = 0
 *   - One target-month failure never blocks other months for the same property
 *   - One property failure never blocks other properties
 *   - Job failure MUST NOT block the pricing cycle (caller wraps in .catch())
 *   - Reads reservation DB only (no market provider, no Channex, no network)
 *   - OBSERVATION_DATE is property-local calendar date (not Europe/Paris scheduler tz)
 *
 * SAFETY:
 *   PRICING_WRITES        = 0  always
 *   CHANNEX_CALLS         = 0  always
 *   MARKET_PROVIDER_CALLS = 0  always
 *   NETWORK_CALLS         = 0  always
 *   DB_WRITES             = 0 when flag is OFF
 *   LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY = NO
 *
 * SCHEDULER TZ DEBT:
 *   The cron fires at 03:15 Europe/Paris.  For FR properties the stored
 *   observation_date matches the Europe/Paris local date.  For properties in
 *   other timezones the job uses properties.timezone to compute the correct
 *   property-local calendar date — so observation_date is always semantically
 *   correct per property regardless of the scheduler timezone.
 */

const {
  isShadowEnabled,
  persistObservation,
} = require('./local-seasonality-shadow');

const {
  HORIZON_MONTHS,
  propertyLocalDate,
  generateTargetMonths,
  computeMonthCalendarInfo,
  computeTargetMonthBookings,
  computeGenericSeasonalityFactor,
  classifyReservationSource,
} = require('./local-seasonality-helpers');

const { computeMarketContextKey } = require('../routes/market-context-key');

// ── SQL constants (SELECT-only) ───────────────────────────────────────────────

const ELIGIBLE_PROPERTIES_SQL = `
  SELECT DISTINCT ON (pc.property_id)
    pc.property_id,
    p.internal_name,
    p.name,
    p.timezone,
    p.country_code,
    p.currency,
    p.latitude,
    p.longitude,
    mpp.profile_id AS market_profile_id
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  LEFT JOIN market_profile_properties mpp ON mpp.property_id = pc.property_id
  WHERE pc.is_active = TRUE
  ORDER BY pc.property_id, p.internal_name, p.name
`;

const RESERVATION_HISTORY_SQL = `
  SELECT
    id,
    start_date::text,
    end_date::text,
    source,
    platform,
    reservation_type,
    status
  FROM reservations
  WHERE property_id = $1
  ORDER BY start_date
`;

// ── Job ───────────────────────────────────────────────────────────────────────

/**
 * Run the local seasonality shadow collection job.
 *
 * Stats returned:
 *   propertiesEligible    — properties loaded from DB
 *   propertiesProcessed   — properties that completed without a fatal error
 *   observationsAttempted — total INSERT attempts (properties × horizon months)
 *   observationsInserted  — new rows actually written
 *   observationsDuplicate — DO NOTHING hits (already existed for this date)
 *   errors                — [{ propertyId, targetMonth|null, message }]
 *
 * @param {object} pool
 * @returns {Promise<{
 *   propertiesEligible: number,
 *   propertiesProcessed: number,
 *   observationsAttempted: number,
 *   observationsInserted: number,
 *   observationsDuplicate: number,
 *   errors: Array<{propertyId: number|string, targetMonth: string|null, message: string}>,
 * }>}
 */
async function runLocalSeasonalityJob(pool) {
  const stats = {
    propertiesEligible:    0,
    propertiesProcessed:   0,
    observationsAttempted: 0,
    observationsInserted:  0,
    observationsDuplicate: 0,
    errors:                [],
  };

  if (!isShadowEnabled()) return stats; // FLAG_OFF — zero reads, zero writes

  const NOW_ISO      = new Date().toISOString();
  const CALCULATED_AT = NOW_ISO;

  const propRes = await pool.query(ELIGIBLE_PROPERTIES_SQL);
  const properties = propRes.rows;
  stats.propertiesEligible = properties.length;

  for (const prop of properties) {
    const pName = prop.internal_name || prop.name || `prop#${prop.property_id}`;
    try {
      // Property-local observation date (corrects for scheduler timezone)
      const observationDate = propertyLocalDate(NOW_ISO, prop.timezone);

      // Generate 9 target months starting from the property's current local month
      const targetMonths = generateTargetMonths(observationDate, HORIZON_MONTHS);

      // Market context key (derived from property geo — no DB lookup needed)
      const marketContextKey = computeMarketContextKey({
        countryCode: prop.country_code,
        latitude:    prop.latitude,
        longitude:   prop.longitude,
      });

      // Load full reservation history for this property
      const rRes = await pool.query(RESERVATION_HISTORY_SQL, [prop.property_id]);
      const reservations = rRes.rows;

      // Exposure confidence is property-level: if any BLOCK rows exist, we can
      // at least partially reconstruct availability (owner uses blocking).
      const hasAnyBlockHistory = reservations.some(
        r => classifyReservationSource(r) === 'BLOCK',
      );

      let propertyError = false;

      for (const targetMonth of targetMonths) {
        stats.observationsAttempted++;
        try {
          const calInfo    = computeMonthCalendarInfo(targetMonth, observationDate);
          const booking    = computeTargetMonthBookings(reservations, targetMonth);
          const genericFactor = computeGenericSeasonalityFactor(targetMonth);

          // Exposure semantics (section 10)
          // UNKNOWN: no block history → denominator not defensible
          // PARTIAL: block rows exist → calendar - blocked is a lower-bound estimate
          let exposureConfidence, knownSellableNights, occupancyFraction;
          if (!hasAnyBlockHistory) {
            exposureConfidence  = 'UNKNOWN';
            knownSellableNights = null;
            occupancyFraction   = null;
          } else {
            exposureConfidence  = 'PARTIAL';
            knownSellableNights = calInfo.calendarNights - booking.knownBlockedNights;
            occupancyFraction   = knownSellableNights > 0
              ? booking.bookedNights / knownSellableNights
              : null;
          }

          const inserted = await persistObservation(pool, {
            propertyId:               prop.property_id,
            targetMonth,
            observationDate,
            calculatedAt:             CALCULATED_AT,
            timezone:                 prop.timezone     || null,
            country:                  prop.country_code || null,
            currency:                 prop.currency     || null,
            marketContextKey:         marketContextKey  || null,
            marketProfileId:          prop.market_profile_id || null,
            calendarNights:           calInfo.calendarNights,
            elapsedCalendarNights:    calInfo.elapsedCalendarNights,
            remainingCalendarNights:  calInfo.remainingCalendarNights,
            daysUntilMonthStart:      calInfo.daysUntilMonthStart,
            monthComplete:            calInfo.monthComplete,
            bookedNights:             booking.bookedNights,
            knownBlockedNights:       booking.knownBlockedNights,
            knownSellableNights,
            occupancyFraction,
            exposureConfidence,
            reliableReservationCount: booking.reliableReservationCount,
            sourceDistribution:       booking.sourceDistribution,
            genericReferenceFactor:   genericFactor,
          });

          if (inserted) stats.observationsInserted++;
          else           stats.observationsDuplicate++;

        } catch (err) {
          stats.errors.push({
            propertyId: prop.property_id,
            targetMonth,
            message: err.message,
          });
          // Continue to next target month — do not abort the property
        }
      }

      if (!propertyError) {
        stats.propertiesProcessed++;
        console.log(
          `[SEASONALITY_SHADOW] ${pName}: observationDate=${observationDate}` +
          ` months=${targetMonths.length} inserted=${stats.observationsInserted}` +
          ` dupes=${stats.observationsDuplicate}` +
          ` exposure=${hasAnyBlockHistory ? 'PARTIAL' : 'UNKNOWN'}`,
        );
      }
    } catch (err) {
      stats.errors.push({ propertyId: prop.property_id, targetMonth: null, message: err.message });
      console.error(`[SEASONALITY_SHADOW] ${pName}: PROPERTY_ERROR — ${err.message}`);
    }
  }

  return stats;
}

module.exports = { runLocalSeasonalityJob };

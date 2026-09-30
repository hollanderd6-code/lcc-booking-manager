'use strict';
/**
 * P1.4-T1 — Local Seasonality Shadow Job
 *
 * Weekly job that computes a readiness tier snapshot for every active
 * BoostPrice property and persists the results.
 *
 * Design invariants:
 *   - Feature-flagged: returns immediately when LOCAL_SEASONALITY_SHADOW_ENABLED != 'true'
 *   - FLAG_OFF_CALCULATIONS = 0 / FLAG_OFF_WRITES = 0
 *   - Per-property failures are isolated — one bad property never blocks others
 *   - Job failure MUST NOT block the pricing cycle (caller wraps in .catch())
 *   - Reads reservation DB only (no market provider, no Channex)
 *   - SEASONALITY_HAS_PRICING_AUTHORITY = NO
 *
 * SAFETY:
 *   PRICING_WRITES        = 0  always
 *   CHANNEX_CALLS         = 0  always
 *   MARKET_PROVIDER_CALLS = 0  always
 *   NETWORK_CALLS         = 0  always
 *   DB_WRITES             = 0 when flag is OFF
 */

const { isShadowEnabled, persistReadinessSnapshot } = require('./local-seasonality-shadow');
const { computePropertyReadinessSnapshot }           = require('./local-seasonality-helpers');

const ELIGIBLE_PROPERTIES_SQL = `
  SELECT
    pc.property_id,
    p.internal_name,
    p.name
  FROM pricing_config pc
  JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
  WHERE pc.is_active = TRUE
  ORDER BY p.internal_name, p.name
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

/**
 * Run the local seasonality shadow collection job.
 *
 * Returns stats:
 *   propertiesEligible    — properties loaded from DB
 *   propertiesProcessed   — properties that completed without a fatal error
 *   snapshotsPersisted    — successful upserts to local_seasonality_readiness
 *   errors                — [{ propertyId, message }]
 *
 * @param {object} pool
 * @returns {Promise<{
 *   propertiesEligible: number,
 *   propertiesProcessed: number,
 *   snapshotsPersisted: number,
 *   errors: Array<{propertyId: number|string, message: string}>,
 * }>}
 */
async function runLocalSeasonalityJob(pool) {
  const stats = {
    propertiesEligible:   0,
    propertiesProcessed:  0,
    snapshotsPersisted:   0,
    errors:               [],
  };

  if (!isShadowEnabled()) return stats; // FLAG_OFF — zero reads, zero writes

  const TODAY = new Date().toISOString().slice(0, 10);

  const propRes = await pool.query(ELIGIBLE_PROPERTIES_SQL);
  const properties = propRes.rows;
  stats.propertiesEligible = properties.length;

  for (const prop of properties) {
    const pName = prop.internal_name || prop.name || `prop#${prop.property_id}`;
    try {
      const rRes = await pool.query(RESERVATION_HISTORY_SQL, [prop.property_id]);
      const snapshot = computePropertyReadinessSnapshot(rRes.rows, TODAY);
      await persistReadinessSnapshot(pool, prop.property_id, TODAY, snapshot);
      stats.snapshotsPersisted++;
      stats.propertiesProcessed++;
      console.log(
        `[SEASONALITY_SHADOW] ${pName}: tier=${snapshot.tier}` +
        ` months=${snapshot.distinctCalendarMonths}/12` +
        ` years=${snapshot.distinctYears}` +
        ` nights=${snapshot.totalBookedNights}` +
        ` yoy=${snapshot.yoyPairCount}`,
      );
    } catch (err) {
      stats.errors.push({ propertyId: prop.property_id, message: err.message });
      console.error(`[SEASONALITY_SHADOW] ${pName}: ERROR — ${err.message}`);
    }
  }

  return stats;
}

module.exports = { runLocalSeasonalityJob };

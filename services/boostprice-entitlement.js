'use strict';

// ── Canonical BoostPrice commercial entitlement resolver ─────────────────────
//
// Commercial entitlement = property has an ACTIVE row in
// boostprice_property_entitlements AND the property owner has a valid
// main Boostinghost subscription.
//
// Technical activation = pricing_config.is_active (separate concern).
//
// CAN_RUN_BOOSTPRICE = hasBoostPriceEntitlement(...) AND pricing_config.is_active
//
// Fail-closed: returns false / empty array on any DB error.
// ─────────────────────────────────────────────────────────────────────────────

const ENTITLEMENT_SQL = `
  SELECT bpe.id
  FROM boostprice_property_entitlements bpe
  WHERE bpe.user_id     = $1
    AND bpe.property_id = $2
    AND bpe.status      = 'active'
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.user_id = bpe.user_id
        AND (
          s.status IN ('active', 'trialing')
          OR (s.status = 'trial' AND s.trial_end_date > NOW())
        )
    )
  LIMIT 1
`;

const BULK_ENTITLEMENT_SQL = `
  SELECT bpe.property_id
  FROM boostprice_property_entitlements bpe
  WHERE bpe.user_id = $1
    AND bpe.status  = 'active'
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.user_id = bpe.user_id
        AND (
          s.status IN ('active', 'trialing')
          OR (s.status = 'trial' AND s.trial_end_date > NOW())
        )
    )
`;

// ─────────────────────────────────────────────────────────────────────────────
// hasBoostPriceEntitlement(pool, userId, propertyId)
//   → true  : property is commercially entitled for BoostPrice
//   → false : not entitled, or DB error (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────
async function hasBoostPriceEntitlement(pool, userId, propertyId) {
  try {
    const result = await pool.query(ENTITLEMENT_SQL, [userId, propertyId]);
    return result.rows.length > 0;
  } catch (err) {
    console.error('[BOOSTPRICE_ENTITLEMENT] lookup error — fail closed:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getBoostPriceEntitledPropertyIds(pool, userId)
//   → string[] : property_ids with active entitlement + valid subscription
//   → []       : none, or DB error (fail-closed)
// ─────────────────────────────────────────────────────────────────────────────
async function getBoostPriceEntitledPropertyIds(pool, userId) {
  try {
    const result = await pool.query(BULK_ENTITLEMENT_SQL, [userId]);
    return result.rows.map(r => r.property_id);
  } catch (err) {
    console.error('[BOOSTPRICE_ENTITLEMENT] bulk lookup error — fail closed:', err.message);
    return [];
  }
}

module.exports = { hasBoostPriceEntitlement, getBoostPriceEntitledPropertyIds };

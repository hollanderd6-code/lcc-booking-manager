'use strict';
/**
 * P1.2-B3C — Pure currency reconciliation logic.
 * No DB access. No external calls. Exportable + unit-testable.
 */

// ── Segments ──────────────────────────────────────────────────
const SEGMENT = {
  CONNECTED_RATE_PLAN:        'CONNECTED_RATE_PLAN',
  DISCONNECTED_WITH_RATE_PLAN:'DISCONNECTED_WITH_RATE_PLAN',
  PARTIAL_CHANNEX:            'PARTIAL_CHANNEX',
  NO_CHANNEX:                 'NO_CHANNEX',
};

// ── Reconciliation statuses ────────────────────────────────────
const STATUS = {
  WOULD_SET:                'WOULD_SET',
  ALREADY_SET:              'ALREADY_SET',
  CONFLICT:                 'CONFLICT',
  NO_CHANNEX:               'NO_CHANNEX',
  PARTIAL_CHANNEX:          'PARTIAL_CHANNEX',
  RATE_PLAN_NOT_FOUND:      'RATE_PLAN_NOT_FOUND',
  MISSING_CHANNEX_CURRENCY: 'MISSING_CHANNEX_CURRENCY',
  INVALID_CHANNEX_CURRENCY: 'INVALID_CHANNEX_CURRENCY',
  CHANNEX_UNAVAILABLE:      'CHANNEX_UNAVAILABLE',
};

// ── B3D future-action map ──────────────────────────────────────
const FUTURE_ACTION = {
  [STATUS.WOULD_SET]:                'SET_FROM_CHANNEX',
  [STATUS.ALREADY_SET]:              'NO_ACTION',
  [STATUS.CONFLICT]:                 'HUMAN_RECONCILIATION',
  [STATUS.NO_CHANNEX]:               'USER_CONFIGURATION_REQUIRED',
  [STATUS.PARTIAL_CHANNEX]:          'RECOVER_CHANNEX_SETUP',
  [STATUS.RATE_PLAN_NOT_FOUND]:      'RECOVER_CHANNEX_SETUP',
  [STATUS.MISSING_CHANNEX_CURRENCY]: 'HUMAN_RECONCILIATION',
  [STATUS.INVALID_CHANNEX_CURRENCY]: 'HUMAN_RECONCILIATION',
  [STATUS.CHANNEX_UNAVAILABLE]:      'RETRY_LATER',
};

const HUMAN_REVIEW_STATUSES = new Set([
  STATUS.CONFLICT,
  STATUS.MISSING_CHANNEX_CURRENCY,
  STATUS.INVALID_CHANNEX_CURRENCY,
]);

// ── Segment helper ─────────────────────────────────────────────
function classifySegment(property) {
  const hasRatePlan   = !!property.channex_rate_plan_id;
  const hasAnyChannex = !!(
    property.channex_property_id ||
    property.channex_room_type_id ||
    property.channex_rate_plan_id ||
    property.channex_property_id_ext
  );

  if (hasRatePlan && property.channex_enabled) return SEGMENT.CONNECTED_RATE_PLAN;
  if (hasRatePlan && !property.channex_enabled) return SEGMENT.DISCONNECTED_WITH_RATE_PLAN;
  if (hasAnyChannex)                            return SEGMENT.PARTIAL_CHANNEX;
  return SEGMENT.NO_CHANNEX;
}

// ── Main pure reconcile function ───────────────────────────────
// property: DB row with relevant fields
// channexResult: { ok, currency?, error? } | null (null = no rate plan, no call made)
//
// NOTE: WOULD_SET reflects B3D's _ability_ to populate properties.currency from the
// current Channex distribution denomination. It is NOT independent evidence of the
// owner's intended commercial currency — Boostinghost created all Channex objects
// with EUR hardcoded.
function reconcilePropertyCurrency(property, channexResult) {
  const segment = classifySegment(property);
  const hasRatePlan = !!property.channex_rate_plan_id;
  const localCurrency = property.currency || null;

  let reconciliationStatus;
  let channexCurrency = null;

  if (!hasRatePlan) {
    reconciliationStatus = segment === SEGMENT.PARTIAL_CHANNEX
      ? STATUS.PARTIAL_CHANNEX
      : STATUS.NO_CHANNEX;
  } else if (!channexResult || !channexResult.ok) {
    const err = channexResult?.error;
    if      (err === 'not_found')         reconciliationStatus = STATUS.RATE_PLAN_NOT_FOUND;
    else if (err === 'missing_currency')  reconciliationStatus = STATUS.MISSING_CHANNEX_CURRENCY;
    else if (err === 'invalid_currency')  reconciliationStatus = STATUS.INVALID_CHANNEX_CURRENCY;
    else                                  reconciliationStatus = STATUS.CHANNEX_UNAVAILABLE;
  } else {
    channexCurrency = channexResult.currency;
    if (localCurrency === null) {
      reconciliationStatus = STATUS.WOULD_SET;
    } else if (localCurrency === channexCurrency) {
      reconciliationStatus = STATUS.ALREADY_SET;
    } else {
      reconciliationStatus = STATUS.CONFLICT;
    }
  }

  const ratePlanId   = property.channex_rate_plan_id || null;
  const ratePlanIdSuffix = ratePlanId ? ratePlanId.slice(-8) : null;

  return {
    propertyId:           property.id,
    propertyName:         property.name || property.id,
    segment,
    localCurrency,
    channexEnabled:       !!property.channex_enabled,
    hasRatePlan,
    ratePlanIdSuffix,
    channexCurrency,
    externalPricing:      !!property.external_pricing,
    boostPriceActive:     !!property.boost_price_active,
    reconciliationStatus,
    futureAction:         FUTURE_ACTION[reconciliationStatus],
    requiresHumanReview:  HUMAN_REVIEW_STATUSES.has(reconciliationStatus),
  };
}

module.exports = {
  reconcilePropertyCurrency,
  classifySegment,
  SEGMENT,
  STATUS,
  FUTURE_ACTION,
};

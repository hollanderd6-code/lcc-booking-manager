'use strict';
/**
 * Effective Pricing Shadow — P0-B
 *
 * Compares the legacy price resolution used by triggerChannexRatesSync
 * with the new resolveEffectivePrices() resolver.
 *
 * NEVER modifies production behavior. No DB writes. No Channex calls.
 * Activated only when EFFECTIVE_PRICING_SHADOW_ENABLED=true (default: OFF).
 *
 * Error isolation: runPricingShadow() throws on failure.
 * The caller (triggerChannexRatesSync) wraps it in try/catch so errors
 * never interrupt the production push path.
 */

const { resolveEffectivePrices, SOURCE } = require('./effective-pricing-resolver');

const MAX_DIFF_DETAIL = 20;

const CLASSIFICATION = Object.freeze({
  MATCH:                          'MATCH',
  EXPECTED_BOOSTPRICE_DIFFERENCE: 'EXPECTED_BOOSTPRICE_DIFFERENCE',
  MANUAL_OVERRIDE_PROTECTION:     'MANUAL_OVERRIDE_PROTECTION',
  PENDING_IGNORED:                'PENDING_IGNORED',
  UNEXPECTED_PRICE_DIFFERENCE:    'UNEXPECTED_PRICE_DIFFERENCE',
  UNEXPECTED_MIN_STAY_DIFFERENCE: 'UNEXPECTED_MIN_STAY_DIFFERENCE',
  EXTERNAL_PRICING_CASE:          'EXTERNAL_PRICING_CASE',
  LONG_STAY_DIFFERENCE:           'LONG_STAY_DIFFERENCE',
  OTHER:                          'OTHER',
});

function isShadowEnabled() {
  return process.env.EFFECTIVE_PRICING_SHADOW_ENABLED === 'true';
}

/**
 * Classify one night comparison.
 *
 * Classification order (earlier checks take priority):
 *   1. EXTERNAL_PRICING_CASE
 *   2. EXPECTED_BOOSTPRICE_DIFFERENCE — resolver picked applied BoostPrice
 *   3. LONG_STAY_DIFFERENCE — legacy applied discount, resolver did not
 *   4. OTHER — both price diff AND min_stay diff with no known explanation
 *   5. UNEXPECTED_PRICE_DIFFERENCE — price diff, unexplained
 *   6. UNEXPECTED_MIN_STAY_DIFFERENCE — min_stay differs only
 *   7. MANUAL_OVERRIDE_PROTECTION — prices match, resolver used override
 *   8. PENDING_IGNORED — prices match, pending schedule entry noted
 *   9. MATCH
 *
 * Note: legacy source is NOT tracked in path A (triggerChannexRatesSync),
 * so differences.source is always false in path A comparisons.
 */
function classifyNight({
  legacyPrice,
  legacyMinArr,
  legacyMinThru,
  resolverNight,
  longStayRule,
  isExternalPricing,
  hasPending,
}) {
  if (isExternalPricing) return CLASSIFICATION.EXTERNAL_PRICING_CASE;

  const priceDiff  = legacyPrice !== resolverNight.price;
  const arrDiff    = legacyMinArr !== resolverNight.minStayArrival;
  const thrDiff    = legacyMinThru !== resolverNight.minStayThrough;

  if (priceDiff) {
    // BoostPrice explains why resolver differs from legacy
    if (resolverNight.source === SOURCE.BOOSTPRICE) {
      return CLASSIFICATION.EXPECTED_BOOSTPRICE_DIFFERENCE;
    }

    // Long-stay discount applied in legacy but not in resolver
    // (triggerChannexRatesSync applies it; getCalendarPricesForRange does not)
    if (longStayRule?.discount_pct && resolverNight.source !== SOURCE.MANUAL_OVERRIDE) {
      const expectedLegacy = Math.round(
        resolverNight.price * (1 - parseFloat(longStayRule.discount_pct) / 100) * 100
      ) / 100;
      if (Math.abs(expectedLegacy - legacyPrice) < 0.02) {
        return CLASSIFICATION.LONG_STAY_DIFFERENCE;
      }
    }

    // Both price AND min_stay differ with no known explanation
    if (arrDiff || thrDiff) return CLASSIFICATION.OTHER;

    return CLASSIFICATION.UNEXPECTED_PRICE_DIFFERENCE;
  }

  if (arrDiff || thrDiff) return CLASSIFICATION.UNEXPECTED_MIN_STAY_DIFFERENCE;

  // Prices and min_stay match — informational sub-classifications
  if (resolverNight.source === SOURCE.MANUAL_OVERRIDE) {
    return CLASSIFICATION.MANUAL_OVERRIDE_PROTECTION;
  }
  if (hasPending) return CLASSIFICATION.PENDING_IGNORED;

  return CLASSIFICATION.MATCH;
}

/**
 * Compare legacy and resolver results for a property over a date range.
 * Returns the array of NightComparison objects.
 */
function compareNights({
  resolverNights,
  legacyRateMap,
  legacyRestMap,
  pendingSet,
  longStayRule,
  isExternalPricing,
  propertyId,
}) {
  const comparisons = [];
  for (const resolverNight of resolverNights) {
    const date = resolverNight.date;
    const legacyPrice = legacyRateMap.has(date) ? legacyRateMap.get(date) : null;
    const legacyRest  = legacyRestMap.get(date) || { min_stay_arrival: 1, min_stay_through: 1 };

    const cl = classifyNight({
      legacyPrice,
      legacyMinArr:  legacyRest.min_stay_arrival,
      legacyMinThru: legacyRest.min_stay_through,
      resolverNight,
      longStayRule,
      isExternalPricing,
      hasPending: pendingSet.has(date),
    });

    comparisons.push({
      propertyId,
      date,
      legacy: {
        price:          legacyPrice,
        minStayArrival: legacyRest.min_stay_arrival,
        minStayThrough: legacyRest.min_stay_through,
        source:         null, // not tracked in path A (triggerChannexRatesSync)
      },
      resolver: {
        price:          resolverNight.price,
        minStayArrival: resolverNight.minStayArrival,
        minStayThrough: resolverNight.minStayThrough,
        source:         resolverNight.source,
        locked:         resolverNight.locked,
      },
      differences: {
        price:          legacyPrice !== resolverNight.price,
        minStayArrival: legacyRest.min_stay_arrival !== resolverNight.minStayArrival,
        minStayThrough: legacyRest.min_stay_through !== resolverNight.minStayThrough,
        source:         false, // legacy source not tracked
      },
      classification: cl,
    });
  }
  return comparisons;
}

/**
 * Log a compact summary of the shadow comparison.
 * Individual differences are limited to MAX_DIFF_DETAIL lines.
 */
function logShadowSummary(comparisons, { propertyId, startDate, endDate }) {
  const total = comparisons.length;
  const counts = {
    match:                   0,
    expected_boostprice:     0,
    manual_override_protection: 0,
    pending_ignored:         0,
    unexpected_price:        0,
    unexpected_min_stay:     0,
    external_pricing:        0,
    long_stay_difference:    0,
    other:                   0,
  };

  for (const c of comparisons) {
    switch (c.classification) {
      case CLASSIFICATION.MATCH:                          counts.match++; break;
      case CLASSIFICATION.EXPECTED_BOOSTPRICE_DIFFERENCE: counts.expected_boostprice++; break;
      case CLASSIFICATION.MANUAL_OVERRIDE_PROTECTION:     counts.manual_override_protection++; break;
      case CLASSIFICATION.PENDING_IGNORED:                counts.pending_ignored++; break;
      case CLASSIFICATION.UNEXPECTED_PRICE_DIFFERENCE:    counts.unexpected_price++; break;
      case CLASSIFICATION.UNEXPECTED_MIN_STAY_DIFFERENCE: counts.unexpected_min_stay++; break;
      case CLASSIFICATION.EXTERNAL_PRICING_CASE:          counts.external_pricing++; break;
      case CLASSIFICATION.LONG_STAY_DIFFERENCE:           counts.long_stay_difference++; break;
      case CLASSIFICATION.OTHER:                          counts.other++; break;
    }
  }

  const diffs = comparisons.filter(c => c.classification !== CLASSIFICATION.MATCH);
  const totalDiffs = diffs.length;

  console.log(`=== PRICING SHADOW ===`);
  console.log(`property_id:                ${propertyId}`);
  console.log(`range:                      ${startDate} → ${endDate}`);
  console.log(`nights_compared:            ${total}`);
  console.log(`matches:                    ${counts.match}`);
  console.log(`differences:                ${totalDiffs}`);
  console.log(`  expected_boostprice:        ${counts.expected_boostprice}`);
  console.log(`  manual_override_protection: ${counts.manual_override_protection}`);
  console.log(`  pending_ignored:            ${counts.pending_ignored}`);
  console.log(`  unexpected_price:           ${counts.unexpected_price}`);
  console.log(`  unexpected_min_stay:        ${counts.unexpected_min_stay}`);
  console.log(`  external_pricing:           ${counts.external_pricing}`);
  console.log(`  long_stay_difference:       ${counts.long_stay_difference}`);
  console.log(`  other:                      ${counts.other}`);

  if (diffs.length > 0) {
    const shown = Math.min(diffs.length, MAX_DIFF_DETAIL);
    console.log(`\n  Détail (${shown}/${diffs.length} divergences) :`);
    for (let i = 0; i < shown; i++) {
      const c = diffs[i];
      const minStayNote = (c.differences.minStayArrival || c.differences.minStayThrough)
        ? ` | arr=${c.legacy.minStayArrival}→${c.resolver.minStayArrival} thru=${c.legacy.minStayThrough}→${c.resolver.minStayThrough}`
        : '';
      console.log(
        `  ${c.classification.padEnd(38)} | ${c.date}` +
        ` | legacy=${c.legacy.price} resolver=${c.resolver.price} (src=${c.resolver.source})` +
        minStayNote
      );
    }
  }

  console.log(`=== END SHADOW ===`);
}

/**
 * Main shadow entry point — called from triggerChannexRatesSync.
 *
 * @param {object} pool
 * @param {object} opts
 * @param {string}  opts.propertyId
 * @param {string}  opts.userId         — ownerId in triggerChannexRatesSync
 * @param {string}  opts.startDate      — inclusive 'YYYY-MM-DD'
 * @param {string}  opts.endDate        — exclusive 'YYYY-MM-DD'
 * @param {Array}   opts.legacyRates    — [{date, price}] from triggerChannexRatesSync
 * @param {Array}   opts.legacyRestrictions — [{date, min_stay_arrival, min_stay_through}]
 * @param {object|null} opts.longStayRule   — {discount_pct, discount_after_nights}|null
 * @param {boolean} opts.isExternalPricing
 * @returns {Promise<void>}  — never returns data; throws on error for caller to catch
 */
async function runPricingShadow(pool, {
  propertyId,
  userId,
  startDate,
  endDate,
  legacyRates,
  legacyRestrictions,
  longStayRule,
  isExternalPricing,
}) {
  if (!isShadowEnabled()) return;

  // ── Resolver (5 read-only queries) ──────────────────────────────────────────
  const resolverNights = await resolveEffectivePrices(pool, {
    propertyId, userId, startDate, endDate,
  });

  // ── Pending entries — informational only ────────────────────────────────────
  const pendingRes = await pool.query(
    `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
     FROM pricing_schedule
     WHERE property_id = $1 AND date >= $2 AND date < $3 AND status = 'pending'`,
    [propertyId, startDate, endDate]
  );
  const pendingSet = new Set(pendingRes.rows.map(r => r.date));

  // ── Build legacy maps ────────────────────────────────────────────────────────
  const legacyRateMap = new Map((legacyRates || []).map(r => [r.date, r.price]));
  const legacyRestMap = new Map((legacyRestrictions || []).map(r => [r.date, r]));

  // ── Compare ──────────────────────────────────────────────────────────────────
  const comparisons = compareNights({
    resolverNights,
    legacyRateMap,
    legacyRestMap,
    pendingSet,
    longStayRule,
    isExternalPricing,
    propertyId,
  });

  // ── Log ──────────────────────────────────────────────────────────────────────
  logShadowSummary(comparisons, { propertyId, startDate, endDate });
}

module.exports = {
  runPricingShadow,
  classifyNight,
  isShadowEnabled,
  CLASSIFICATION,
  compareNights,
  logShadowSummary,
  MAX_DIFF_DETAIL,
};

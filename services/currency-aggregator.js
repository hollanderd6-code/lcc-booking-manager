'use strict';
/**
 * INTL-3B — Currency Aggregator
 *
 * groupAmountsByCurrency(items)
 *   Groups a list of { amount, currency } pairs by currency.
 *   Unknown or invalid currency codes are excluded and counted separately.
 *   Never performs FX conversion — never add across currency buckets.
 *
 * SAFETY:
 *   DB_WRITES      = 0  always
 *   PRICING_WRITES = 0  always
 *   NETWORK_CALLS  = 0  pure function
 */

const _CUR_RE = /^[A-Z]{3}$/;

/**
 * @param {{ amount: number|null, currency: string|null }[]} items
 * @returns {{ totals: Record<string, number>, unknownCount: number }}
 */
function groupAmountsByCurrency(items) {
  const totals = {};
  let unknownCount = 0;
  for (const item of items) {
    const n = Number(item.amount);
    if (item.amount == null || isNaN(n)) continue;
    const raw = typeof item.currency === 'string' ? item.currency.trim().toUpperCase() : null;
    if (!raw || !_CUR_RE.test(raw)) { unknownCount++; continue; }
    totals[raw] = (totals[raw] || 0) + n;
  }
  return { totals, unknownCount };
}

module.exports = { groupAmountsByCurrency };

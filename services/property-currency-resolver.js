'use strict';
/**
 * INTL-1D — Property Currency Resolver
 *
 * Pure function — no network, no DB, no Channex.
 *
 * Resolves the currency to persist when a property is created:
 *   1. Requested currency from the payload (normalized to uppercase)
 *   2. User's default_currency from DB (passed by caller)
 *   3. Hard fallback: 'EUR'
 *
 * Normalization: 'ils' → 'ILS', 'eur' → 'EUR' (uppercase only).
 * Validation: must match ^[A-Z]{3}$ after normalization, or step is skipped.
 *
 * SAFETY:
 *   DB_WRITES      = 0  always
 *   PRICING_WRITES = 0  always
 *   CHANNEX_CALLS  = 0  always
 *   NETWORK_CALLS  = 0  pure function
 */

const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Normalize a raw currency string: trim + uppercase.
 * Returns null when input is absent or empty.
 */
function normalizeCurrency(raw) {
  if (raw == null) return null;
  const v = String(raw).trim().toUpperCase();
  return v.length > 0 ? v : null;
}

/**
 * Resolve the currency for a new property.
 *
 * @param {string|null} bodyCurrency         — value from the request payload (may be raw/lowercase)
 * @param {string|null} userDefaultCurrency  — value from users.default_currency (already stored normalized)
 * @returns {string}  — resolved 3-char ISO 4217 code, never null
 */
function resolvePropertyCurrency(bodyCurrency, userDefaultCurrency) {
  const fromBody = normalizeCurrency(bodyCurrency);
  if (fromBody && CURRENCY_RE.test(fromBody)) return fromBody;

  const fromUser = normalizeCurrency(userDefaultCurrency);
  if (fromUser && CURRENCY_RE.test(fromUser)) return fromUser;

  return 'EUR';
}

module.exports = { resolvePropertyCurrency, normalizeCurrency, CURRENCY_RE };

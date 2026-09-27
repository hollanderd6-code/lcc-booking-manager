'use strict';
/**
 * INTL-2B — Money Formatter (backend)
 *
 * Pure function — no network, no DB.
 *
 * fmtMoney(amount, currency, locale)
 *   Formats a numeric amount as a currency string using Intl.NumberFormat.
 *   Falls back to 'EUR' / 'fr-FR' when inputs are absent or invalid.
 *   Returns '—' for null/undefined/NaN amounts.
 *
 * SAFETY:
 *   DB_WRITES      = 0  always
 *   PRICING_WRITES = 0  always
 *   NETWORK_CALLS  = 0  pure function
 */

const CURRENCY_RE = /^[A-Z]{3}$/;
const LOCALE_RE   = /^[a-z]{2}-[A-Z]{2}$/;

/**
 * Format an amount as a localized currency string.
 *
 * @param {number|null} amount
 * @param {string|null} currency  — ISO 4217 3-char code (e.g. 'EUR', 'ILS'). Falls back to 'EUR'.
 * @param {string|null} locale    — BCP 47 locale (e.g. 'fr-FR'). Falls back to 'fr-FR'.
 * @returns {string}
 */
function fmtMoney(amount, currency, locale) {
  if (amount == null || isNaN(amount)) return '—';
  const safeCurrency = (currency && CURRENCY_RE.test(currency)) ? currency : 'EUR';
  const safeLocale   = (locale   && LOCALE_RE.test(locale))     ? locale   : 'fr-FR';
  return new Intl.NumberFormat(safeLocale, {
    style:    'currency',
    currency: safeCurrency,
  }).format(amount);
}

module.exports = { fmtMoney };

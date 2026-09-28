'use strict';
/**
 * INTL-2C — Money Formatter (frontend)
 *
 * fmtMoney(amount, currency, locale)
 *   Formats a numeric amount as a localized currency string.
 *   Falls back to 'EUR' / 'fr-FR' for absent or invalid inputs.
 *   Returns '—' for null/undefined/NaN amounts.
 *
 * Usage:
 *   fmtMoney(125)              → '125 €'
 *   fmtMoney(125, 'ILS')       → '125 ₪'
 *   fmtMoney(125, 'USD', 'en-US') → '$125'
 */

const _CURRENCY_RE = /^[A-Z]{3}$/;
const _LOCALE_RE   = /^[a-z]{2}-[A-Z]{2}$/;

function fmtMoney(amount, currency, locale) {
  if (amount == null || isNaN(amount)) return '—';
  const safeCurrency = (currency && _CURRENCY_RE.test(currency)) ? currency : 'EUR';
  const safeLocale   = (locale   && _LOCALE_RE.test(locale))     ? locale   : 'fr-FR';
  return new Intl.NumberFormat(safeLocale, {
    style:    'currency',
    currency: safeCurrency,
  }).format(amount);
}

// Returns the narrow currency symbol for a given ISO 4217 code (e.g. 'EUR' → '€', 'ILS' → '₪').
function getCurrencySymbol(currency) {
  const cur = (currency && _CURRENCY_RE.test(currency)) ? currency : 'EUR';
  try {
    const parts = new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol'
    }).formatToParts(0);
    const sym = parts.find(function(p) { return p.type === 'currency'; });
    return sym ? sym.value : cur;
  } catch(e) { return cur; }
}

// Compact variant for calendar cells — no decimals, narrow symbol.
function fmtMoneyCompact(amount, currency) {
  if (amount == null || isNaN(amount)) return '—';
  const safeCurrency = (currency && _CURRENCY_RE.test(currency)) ? currency : 'EUR';
  return new Intl.NumberFormat('fr-FR', {
    style:                 'currency',
    currency:              safeCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    currencyDisplay:       'narrowSymbol',
  }).format(amount);
}

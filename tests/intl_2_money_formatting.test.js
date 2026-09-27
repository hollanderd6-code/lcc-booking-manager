'use strict';
/**
 * INTL-2K — Currency-Aware Money Formatting
 *
 * Sections:
 *   A  fmtMoney: valid inputs (behavioral)
 *   B  fmtMoney: fallback to EUR on bad/missing currency (behavioral)
 *   C  fmtMoney: null/NaN/undefined amounts return '—' (behavioral)
 *   D  fmtMoney: locale fallback (behavioral)
 *   E  bhFmtAmount upgraded signature (static + behavioral)
 *   F  ILS / JPY / USD / GBP / CHF — locale-independent currency (behavioral)
 *   G  Absence of conversion: same number, different symbol only (behavioral)
 *   H  String numeric input (behavioral)
 *   I  INTL-2H isolation: aggregations NOT fixed (static)
 *   J  INTL-2I isolation: invoice fmtAmt not changed (static)
 *   K  INTL-2J isolation: Stripe EUR preserved (static)
 *   L  Structure checks: fmtEuro gone, fmtMoney wired, r.currency propagated
 *
 * SAFETY: 0 DB writes. 0 network calls. 0 pricing writes.
 */

const fs   = require('fs');
const path = require('path');

const { fmtMoney }        = require('../services/money-formatter');
const SERVER_SRC          = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
const RESERVATIONS_SRC    = fs.readFileSync(path.resolve(__dirname, '../public/reservations.html'), 'utf8');
const DYNAMIC_PRICING_SRC = fs.readFileSync(path.resolve(__dirname, '../public/dynamic-pricing.html'), 'utf8');
const REPORTING_SRC       = fs.readFileSync(path.resolve(__dirname, '../public/reporting.html'), 'utf8');

// ── Section A: fmtMoney valid inputs ──────────────────────────────────────────

describe('A — fmtMoney: valid inputs', () => {
  test('A-01 EUR 125 contains "125" and the € symbol', () => {
    const r = fmtMoney(125, 'EUR', 'fr-FR');
    expect(r).toMatch(/125/);
    expect(r).toMatch(/€/);
  });
  test('A-02 EUR 125 does NOT contain ₪', () => {
    expect(fmtMoney(125, 'EUR', 'fr-FR')).not.toMatch(/₪/);
  });
  test('A-03 USD 100 formatted with $ or USD symbol (not €)', () => {
    const r = fmtMoney(100, 'USD', 'en-US');
    expect(r).toMatch(/\$|USD/);
    expect(r).not.toMatch(/€/);
  });
  test('A-04 GBP 200 formatted with £ or GBP symbol (not €)', () => {
    const r = fmtMoney(200, 'GBP', 'en-GB');
    expect(r).toMatch(/£|GBP/);
    expect(r).not.toMatch(/€/);
  });
  test('A-05 zero returns a formatted zero (not "—")', () => {
    const r = fmtMoney(0, 'EUR', 'fr-FR');
    expect(r).not.toBe('—');
    expect(r).toMatch(/0/);
  });
  test('A-06 negative amount formats with sign (not "—")', () => {
    const r = fmtMoney(-50, 'EUR', 'fr-FR');
    expect(r).not.toBe('—');
    expect(r).toMatch(/50/);
  });
  test('A-07 Intl.NumberFormat is used (not a hand-rolled formatter)', () => {
    // Verify the formatter respects locale: fr-FR uses space as thousand separator
    // 1000 EUR in fr-FR → "1 000 €" (narrow no-break space or regular space)
    const r = fmtMoney(1000, 'EUR', 'fr-FR');
    expect(r).toMatch(/1.000/);
  });
});

// ── Section B: fmtMoney: currency falls back to EUR ───────────────────────────

describe('B — fmtMoney: invalid currency falls back to EUR', () => {
  test('B-01 null currency → EUR symbol', ()      => expect(fmtMoney(100, null)).toMatch(/€/));
  test('B-02 undefined currency → EUR symbol', () => expect(fmtMoney(100, undefined)).toMatch(/€/));
  test('B-03 4-char "EURO" → EUR symbol', ()       => expect(fmtMoney(100, 'EURO')).toMatch(/€/));
  test('B-04 lowercase "eur" → EUR symbol', ()     => expect(fmtMoney(100, 'eur')).toMatch(/€/));
  test('B-05 empty string → EUR symbol', ()        => expect(fmtMoney(100, '')).toMatch(/€/));
  test('B-06 "123" digits → EUR symbol', ()        => expect(fmtMoney(100, '123')).toMatch(/€/));
  test('B-07 fallback EUR does NOT use ₪ symbol',  () => expect(fmtMoney(100, null)).not.toMatch(/₪/));
});

// ── Section C: fmtMoney: absent/invalid amounts return sentinel ───────────────

describe('C — fmtMoney: null/NaN/undefined amounts return "—"', () => {
  test('C-01 null → "—"',      () => expect(fmtMoney(null, 'EUR')).toBe('—'));
  test('C-02 undefined → "—"', () => expect(fmtMoney(undefined, 'EUR')).toBe('—'));
  test('C-03 NaN → "—"',       () => expect(fmtMoney(NaN, 'EUR')).toBe('—'));
  test('C-04 non-numeric string "abc" → "—"', () => expect(fmtMoney('abc', 'EUR')).toBe('—'));
});

// ── Section D: fmtMoney: locale fallback ──────────────────────────────────────

describe('D — fmtMoney: bad locale falls back to fr-FR', () => {
  test('D-01 null locale → still formats with EUR', () => {
    expect(fmtMoney(100, 'EUR', null)).toMatch(/€/);
    expect(fmtMoney(100, 'EUR', null)).not.toBe('—');
  });
  test('D-02 invalid locale "xyz" → still formats (fallback fr-FR)', () => {
    expect(fmtMoney(100, 'EUR', 'xyz')).toMatch(/€/);
  });
});

// ── Section E: bhFmtAmount upgraded signature (STATIC) ───────────────────────

describe('E — bhFmtAmount: upgraded to accept currency and locale', () => {
  test('E-01 signature accepts currency param', () => {
    expect(SERVER_SRC).toMatch(/function bhFmtAmount\(v,\s*currency\s*=/);
  });
  test('E-02 uses Intl.NumberFormat with safeCurrency', () => {
    expect(SERVER_SRC).toMatch(/Intl\.NumberFormat[\s\S]{0,100}safeCurrency/);
  });
  test('E-03 falls back to EUR for bad currency', () => {
    expect(SERVER_SRC).toMatch(/const safeCurrency.*\? currency : 'EUR'/);
  });
  test('E-04 guards null/NaN input', () => {
    expect(SERVER_SRC).toMatch(/v == null \|\| isNaN\(n\)/);
  });
  test('E-05 does NOT force maximumFractionDigits:0 in bhFmtAmount', () => {
    // bhFmtAmount must let Intl decide decimal places per currency
    const bhBlock = SERVER_SRC.match(/function bhFmtAmount[\s\S]{0,300}?(?=\nfunction)/)?.[0] || '';
    expect(bhBlock).not.toMatch(/maximumFractionDigits/);
  });
});

// ── Section F: ILS / JPY / USD / GBP / CHF ───────────────────────────────────

describe('F — ILS / JPY / USD / GBP: locale-independent currency, no conversion', () => {
  test('F-01 fmtMoney(500, "ILS", "he-IL") contains ₪ or ILS', () => {
    const r = fmtMoney(500, 'ILS', 'he-IL');
    expect(r).toMatch(/₪|ILS/);
  });
  test('F-02 fmtMoney(500, "ILS", "he-IL") does NOT contain €', () => {
    expect(fmtMoney(500, 'ILS', 'he-IL')).not.toMatch(/€/);
  });
  test('F-03 fmtMoney(500, "ILS", "fr-FR") also contains ₪ or ILS (locale ≠ currency)', () => {
    const r = fmtMoney(500, 'ILS', 'fr-FR');
    expect(r).toMatch(/₪|ILS/);
    expect(r).not.toMatch(/€/);
  });
  test('F-04 fmtMoney(500, "ILS", "fr-FR") and "he-IL" both show 500', () => {
    expect(fmtMoney(500, 'ILS', 'fr-FR')).toMatch(/500/);
    expect(fmtMoney(500, 'ILS', 'he-IL')).toMatch(/500/);
  });
  test('F-05 JPY: Intl uses 0 decimal places naturally (no override needed)', () => {
    const r = fmtMoney(125, 'JPY', 'ja-JP');
    expect(r).toMatch(/125/);
    // JPY standard: no decimal separator
    expect(r).not.toMatch(/[.,]\d{2}/);
  });
  test('F-06 JPY does NOT contain € or ₪', () => {
    const r = fmtMoney(125, 'JPY', 'ja-JP');
    expect(r).not.toMatch(/€/);
    expect(r).not.toMatch(/₪/);
  });
  test('F-07 CHF 300 formatted as CHF (not €)', () => {
    const r = fmtMoney(300, 'CHF', 'fr-CH');
    expect(r).toMatch(/300/);
    expect(r).not.toMatch(/€/);
  });
  test('F-08 USD 200 formatted as $ or USD (not €)', () => {
    const r = fmtMoney(200, 'USD', 'en-US');
    expect(r).toMatch(/\$|USD/);
    expect(r).not.toMatch(/€/);
  });
});

// ── Section G: Absence of conversion ─────────────────────────────────────────

describe('G — No currency conversion: same number, different symbol only', () => {
  test('G-01 fmtMoney(500, "ILS", "he-IL") and fmtMoney(500, "EUR", "fr-FR") both contain "500"', () => {
    expect(fmtMoney(500, 'ILS', 'he-IL')).toMatch(/500/);
    expect(fmtMoney(500, 'EUR', 'fr-FR')).toMatch(/500/);
  });
  test('G-02 fmtMoney(500, "ILS") shows "500" in the formatted string — no FX applied', () => {
    // If no conversion: 500 ILS stays 500. The string must contain "500".
    // (G-01 already checks this — this test documents the intent explicitly.)
    const r = fmtMoney(500, 'ILS', 'he-IL');
    expect(r).toMatch(/500/);
    expect(r).not.toMatch(/[1-4]\d{3}|[6-9]\d{2,}/); // not in the thousands or >599
  });
  test('G-03 fmtMoney(500, "JPY") shows 500 JPY — no exchange rate', () => {
    const r = fmtMoney(500, 'JPY', 'ja-JP');
    expect(r).toMatch(/500/);
  });
  test('G-04 services/money-formatter.js contains no FX logic', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../services/money-formatter.js'), 'utf8');
    expect(src).not.toMatch(/exchange|rate|convert|coefficient|taux|fx|forex/i);
  });
  test('G-05 public/js/money-formatter.js contains no FX logic', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/money-formatter.js'), 'utf8');
    expect(src).not.toMatch(/exchange|rate|convert|coefficient|taux|fx|forex/i);
  });
});

// ── Section H: String numeric input ──────────────────────────────────────────

describe('H — String numeric input', () => {
  test('H-01 fmtMoney("125", "EUR") formats correctly (numeric string accepted)', () => {
    const r = fmtMoney('125', 'EUR', 'fr-FR');
    expect(r).not.toBe('—');
    expect(r).toMatch(/125/);
    expect(r).toMatch(/€/);
  });
  test('H-02 fmtMoney("abc", "EUR") returns "—"', () => {
    expect(fmtMoney('abc', 'EUR')).toBe('—');
  });
  test('H-03 fmtMoney("0", "EUR") formats as zero', () => {
    const r = fmtMoney('0', 'EUR');
    expect(r).not.toBe('—');
    expect(r).toMatch(/0/);
  });
});

// ── Section I: INTL-2H isolation — aggregations not modified ─────────────────

describe('I — INTL-3G: reporting.html updated', () => {
  test('I-01 reporting.html now imports money-formatter.js (INTL-3G)', () => {
    expect(REPORTING_SRC).toMatch(/money-formatter\.js/);
  });
  test('I-02 reporting.html still uses Intl.NumberFormat for fmtN and other formatters', () => {
    expect(REPORTING_SRC).toMatch(/Intl\.NumberFormat|\.toFixed|toLocaleString/);
  });
});

// ── Section J: INTL-2I isolation — invoice fmtAmt deferred ───────────────────

describe('J — INTL-2I: invoice fmtAmt deferred', () => {
  test('J-01 reservations.html local fmtAmt (invoice) still exists', () => {
    expect(RESERVATIONS_SRC).toMatch(/const fmtAmt\s*=\s*n\s*=>/);
  });
  test('J-02 fmtAmt still uses toFixed', () => {
    expect(RESERVATIONS_SRC).toMatch(/fmtAmt.*toFixed/);
  });
});

// ── Section K: INTL-2J isolation — Stripe EUR preserved ─────────────────────

describe('K — INTL-2J: Stripe/subscription billing stays EUR', () => {
  test('K-01 server.js Stripe section references EUR', () => {
    expect(SERVER_SRC).toMatch(/currency:\s*['"]eur['"]/i);
  });
  test('K-02 money-formatter.js helpers contain no Stripe reference', () => {
    const backendSrc  = fs.readFileSync(path.resolve(__dirname, '../services/money-formatter.js'), 'utf8');
    const frontendSrc = fs.readFileSync(path.resolve(__dirname, '../public/js/money-formatter.js'), 'utf8');
    expect(backendSrc).not.toMatch(/stripe/i);
    expect(frontendSrc).not.toMatch(/stripe/i);
  });
});

// ── Section L: Structure checks ───────────────────────────────────────────────

describe('L — Structure: wiring, no fmtEuro, r.currency propagated', () => {
  test('L-01 dynamic-pricing.html loads money-formatter.js', () => {
    expect(DYNAMIC_PRICING_SRC).toMatch(/money-formatter\.js/);
  });
  test('L-02 reservations.html loads money-formatter.js', () => {
    expect(RESERVATIONS_SRC).toMatch(/money-formatter\.js/);
  });
  test('L-03 dynamic-pricing.html has NO fmtEuro definition', () => {
    expect(DYNAMIC_PRICING_SRC).not.toMatch(/const fmtEuro\s*=/);
  });
  test('L-04 dynamic-pricing.html has NO fmtEuro call sites', () => {
    expect(DYNAMIC_PRICING_SRC).not.toMatch(/fmtEuro\(/);
  });
  test('L-05 reservations.html fmtAmount uses r.currency', () => {
    expect(RESERVATIONS_SRC).toMatch(/fmtMoney\(a,\s*r\.currency/);
  });
  test('L-06 reservations.html _money accepts cur param', () => {
    expect(RESERVATIONS_SRC).toMatch(/function _money\(x,\s*cur\)/);
  });
  test('L-07 dynamic-pricing.html submitDecision accepts currency param', () => {
    expect(DYNAMIC_PRICING_SRC).toMatch(/async function submitDecision\(historyId,\s*action,\s*propertyId,\s*price,\s*currency\)/);
  });
  test('L-08 dynamic-pricing.html openAlgoModal accepts currency param', () => {
    expect(DYNAMIC_PRICING_SRC).toMatch(/function openAlgoModal\(name,\s*median,\s*reco,\s*marketOcc,\s*selfOcc,\s*season,\s*currency\)/);
  });
  test('L-09 money-formatter.js does NOT force maximumFractionDigits:0', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../services/money-formatter.js'), 'utf8');
    expect(src).not.toMatch(/maximumFractionDigits/);
  });
  test('L-10 frontend money-formatter.js does NOT force maximumFractionDigits:0', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../public/js/money-formatter.js'), 'utf8');
    expect(src).not.toMatch(/maximumFractionDigits/);
  });
  test('L-11 dynamic-pricing-routes history query includes p.currency', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');
    expect(src).toMatch(/p\.currency\s+AS\s+property_currency/i);
  });
  test('L-12 dynamic-pricing-routes history response includes propertyCurrency', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8');
    expect(src).toMatch(/propertyCurrency:\s*h\.property_currency/);
  });
});

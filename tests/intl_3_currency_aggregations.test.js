'use strict';
/**
 * INTL-3K — Currency Aggregation Tests
 *
 * Covers groupAmountsByCurrency (services/currency-aggregator.js)
 * and structural checks for INTL-3 file changes.
 */

const { groupAmountsByCurrency } = require('../services/currency-aggregator');
const fs = require('fs');
const path = require('path');

// ── A: groupAmountsByCurrency — basic grouping ────────────────
describe('A — groupAmountsByCurrency: basic grouping', () => {
  test('A-01 single currency sums correctly', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 100, currency: 'EUR' },
      { amount: 50,  currency: 'EUR' },
    ]);
    expect(totals.EUR).toBe(150);
    expect(unknownCount).toBe(0);
  });

  test('A-02 two currencies kept separate', () => {
    const { totals } = groupAmountsByCurrency([
      { amount: 100, currency: 'EUR' },
      { amount: 200, currency: 'ILS' },
    ]);
    expect(totals.EUR).toBe(100);
    expect(totals.ILS).toBe(200);
    expect(Object.keys(totals)).toHaveLength(2);
  });

  test('A-03 empty array returns empty totals', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(0);
  });

  test('A-04 three currencies', () => {
    const { totals } = groupAmountsByCurrency([
      { amount: 100, currency: 'EUR' },
      { amount: 200, currency: 'ILS' },
      { amount: 300, currency: 'USD' },
    ]);
    expect(Object.keys(totals)).toHaveLength(3);
    expect(totals.USD).toBe(300);
  });

  test('A-05 amounts accumulate correctly across multiple entries', () => {
    const items = Array.from({ length: 5 }, () => ({ amount: 10, currency: 'EUR' }));
    const { totals } = groupAmountsByCurrency(items);
    expect(totals.EUR).toBe(50);
  });
});

// ── B: unknown / invalid currency — fail-closed ───────────────
describe('B — unknown currency: fail-closed', () => {
  test('B-01 null currency excluded, counted', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 100, currency: null },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(1);
  });

  test('B-02 undefined currency excluded', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 50, currency: undefined },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(1);
  });

  test('B-03 empty string currency excluded', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 50, currency: '' },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(1);
  });

  test('B-04 lowercase currency normalised to uppercase — accepted', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 50, currency: 'eur' },
    ]);
    expect(totals.EUR).toBe(50);
    expect(unknownCount).toBe(0);
  });

  test('B-05 2-char code invalid — excluded', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 50, currency: 'EU' },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(1);
  });

  test('B-06 4-char code invalid — excluded', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 50, currency: 'EURO' },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(1);
  });

  test('B-07 mixed valid + unknown: valid + normalised summed, truly unknown counted', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 100, currency: 'EUR' },
      { amount: 50,  currency: null },
      { amount: 75,  currency: 'eur' },
    ]);
    expect(totals.EUR).toBe(175); // 100 (EUR) + 75 (eur→EUR)
    expect(unknownCount).toBe(1); // only null
  });
});

// ── C: null / NaN amount handling ────────────────────────────
describe('C — null/NaN amounts skipped', () => {
  test('C-01 null amount skipped (not counted as unknown)', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: null, currency: 'EUR' },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(0);
  });

  test('C-02 NaN amount skipped', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: NaN, currency: 'EUR' },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(0);
  });

  test('C-03 undefined amount skipped', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: undefined, currency: 'EUR' },
    ]);
    expect(totals).toEqual({});
    expect(unknownCount).toBe(0);
  });
});

// ── D: currency normalization ─────────────────────────────────
describe('D — currency normalization', () => {
  test('D-01 currency with surrounding spaces normalised to uppercase', () => {
    const { totals } = groupAmountsByCurrency([
      { amount: 100, currency: ' EUR ' },
    ]);
    expect(totals.EUR).toBe(100);
  });

  test('D-02 lowercase with spaces: trim + toUpperCase → EUR accepted', () => {
    const { totals, unknownCount } = groupAmountsByCurrency([
      { amount: 100, currency: ' eur ' },
    ]);
    expect(totals.EUR).toBe(100);
    expect(unknownCount).toBe(0);
  });
});

// ── E: No FX — deterministic output ──────────────────────────
describe('E — no cross-currency mixing', () => {
  test('E-01 EUR + ILS never summed together', () => {
    const { totals } = groupAmountsByCurrency([
      { amount: 500, currency: 'EUR' },
      { amount: 2000, currency: 'ILS' },
    ]);
    expect(totals.EUR).not.toBeUndefined();
    expect(totals.ILS).not.toBeUndefined();
    expect(totals.EUR + totals.ILS).toBe(2500); // totals exist separately
    expect(Object.keys(totals)).toHaveLength(2); // two buckets, not one
  });

  test('E-02 function is pure — same input same output', () => {
    const items = [{ amount: 100, currency: 'EUR' }];
    const r1 = groupAmountsByCurrency(items);
    const r2 = groupAmountsByCurrency(items);
    expect(r1).toEqual(r2);
  });

  test('E-03 does not mutate input items', () => {
    const items = [{ amount: 100, currency: 'EUR' }];
    const copy = JSON.parse(JSON.stringify(items));
    groupAmountsByCurrency(items);
    expect(items).toEqual(copy);
  });
});

// ── F: currency-aggregator.js structural checks ───────────────
describe('F — currency-aggregator.js structure', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/currency-aggregator.js'), 'utf8'
  );

  test('F-01 exports groupAmountsByCurrency', () => {
    expect(src).toMatch(/module\.exports.*groupAmountsByCurrency/);
  });

  test('F-02 no FX rate usage', () => {
    expect(src).not.toMatch(/fxRate|exchangeRate|conversionRate/i);
  });

  test('F-03 no network calls', () => {
    expect(src).not.toMatch(/fetch|axios|http|https/i);
  });

  test('F-04 no DB writes', () => {
    expect(src).not.toMatch(/pool\.query|INSERT|UPDATE|DELETE/i);
  });
});

// ── G: dynamic-pricing-routes.js — weeklyGainByCurrency ───────
describe('G — dynamic-pricing-routes.js: weeklyGainByCurrency', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../routes/dynamic-pricing-routes.js'), 'utf8'
  );

  test('G-01 weeklyGainByCurrency replaces weeklyGain', () => {
    expect(src).toMatch(/weeklyGainByCurrency/);
  });

  test('G-02 no standalone weeklyGain in JSON response', () => {
    // weeklyGain: Math.round(weeklyGain) should be gone
    expect(src).not.toMatch(/weeklyGain:\s*Math\.round\(weeklyGain\)/);
  });

  test('G-03 property_currency in weekly email query', () => {
    expect(src).toMatch(/p\.currency AS property_currency/);
  });

  test('G-04 totalDeltaByCurrency replaces totalDelta', () => {
    expect(src).toMatch(/totalDeltaByCurrency/);
    expect(src).not.toMatch(/const totalDelta\s*=/);
  });
});

// ── H: server.js — /api/properties returns currency ──────────
describe('H — server.js: /api/properties currency field', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../server.js'), 'utf8'
  );

  test('H-01 currency: p.currency in properties response map', () => {
    expect(src).toMatch(/currency:\s*p\.currency/);
  });
});

// ── I: export CSV — Devise column ─────────────────────────────
describe('I — server.js: export CSV has Devise column', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../server.js'), 'utf8'
  );

  test('I-01 CSV header has Devise column', () => {
    expect(src).toMatch(/'Devise'/);
  });

  test('I-02 EUR removed from CSV column headers', () => {
    // Old headers like "Prix sejour (EUR)" should be gone
    expect(src).not.toMatch(/['"]Prix sejour \(EUR\)['"]/);
  });

  test('I-03 totalByCurrency replaces totalGeneral', () => {
    expect(src).toMatch(/totalByCurrency/);
    expect(src).not.toMatch(/let totalGeneral\s*=/);
  });
});

// ── J: reporting API — singleCurrency ─────────────────────────
describe('J — server.js: /api/reporting returns singleCurrency', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../server.js'), 'utf8'
  );

  test('J-01 singleCurrency in summary', () => {
    expect(src).toMatch(/singleCurrency:/);
  });

  test('J-02 currencies array in summary', () => {
    expect(src).toMatch(/currencies:\s*_uniqueCurrencies/);
  });

  test('J-03 r.currency in reporting reservations query', () => {
    expect(src).toMatch(/r\.currency,\s*EXTRACT\(YEAR/);
  });
});

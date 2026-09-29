'use strict';
/**
 * ACCOUNTING-CG3 — Traveler Invoice Currency End-to-End
 *
 * Structural checks: verifies that the complete traveler invoice pipeline
 * is currency-aware: POST /api/invoice/create resolves currency from
 * reservation/property, stores it in metadata, GET /api/invoice/history
 * exposes it, and generateInvoicePdf receives it.
 *
 * No DB connection. Static source analysis only.
 */

const fs   = require('fs');
const path = require('path');

const src  = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const pdf  = fs.readFileSync(path.join(__dirname, '../utils/invoice-pdf.js'), 'utf8');

// Extract POST /api/invoice/create handler body
const createBlock = src.match(/app\.post\('\/api\/invoice\/create'[\s\S]+?^\}\);/m)?.[0] || '';

// Extract GET /api/invoice/history handler body
const historyBlock = src.match(/app\.get\('\/api\/invoice\/history'[\s\S]+?^\}\);/m)?.[0] || '';

// Extract generateInvoicePdf function from invoice-pdf.js
const pdfFuncBlock = pdf.match(/async function generateInvoicePdf[\s\S]+?^\}/m)?.[0] || '';

// ── A: POST /api/invoice/create — currency resolution ────────────────────────

describe('A — POST /api/invoice/create: resolves currency from reservation/property', () => {
  test('A-01 handler is present', () => {
    expect(createBlock).not.toBe('');
  });

  test('A-02 property query selects reservation currency', () => {
    expect(createBlock).toMatch(/r\.currency\s+AS\s+reservation_currency/);
  });

  test('A-03 property query selects property currency', () => {
    expect(createBlock).toMatch(/p\.currency\s+AS\s+property_currency/);
  });

  test('A-04 resolvedCurrency derived from reservation_currency first', () => {
    expect(createBlock).toMatch(/normalizeCurrency\(.*reservation_currency/);
  });

  test('A-05 resolvedCurrency falls back to property_currency', () => {
    expect(createBlock).toMatch(/normalizeCurrency\(.*property_currency/);
  });

  test('A-06 resolvedCurrency has EUR fallback', () => {
    expect(createBlock).toMatch(/resolvedCurrency.*=.*\|\|\s*['"]EUR['"]/);
  });
});

// ── B: POST /api/invoice/create — currency not derived from other sources ────

describe('B — currency authority: no user default_currency used for traveler invoice', () => {
  test('B-01 resolvedCurrency does not use users.default_currency', () => {
    // resolvedCurrency derivation line must not reference default_currency
    const derivLine = createBlock.match(/const resolvedCurrency\s*=.+/)?.[0] || '';
    expect(derivLine).not.toMatch(/default_currency/);
  });
});

// ── C: POST /api/invoice/create — currency stored in metadata ────────────────

describe('C — POST /api/invoice/create: currency persisted in invoice metadata', () => {
  test('C-01 first metadata object (_meta) contains currency', () => {
    // _meta JSON must include resolvedCurrency
    expect(createBlock).toMatch(/currency:\s*resolvedCurrency/);
  });

  test('C-02 download-link metadata (dlMeta) contains currency', () => {
    // Both metadata objects must store resolvedCurrency
    const matches = (createBlock.match(/currency:\s*resolvedCurrency/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });
});

// ── D: POST /api/invoice/create — PDF receives currency ─────────────────────

describe('D — generateInvoicePdf receives resolvedCurrency', () => {
  test('D-01 generateInvoicePdfToFile passes currency to generateInvoicePdf', () => {
    const pdfToFileBlock = createBlock.match(/async function generateInvoicePdfToFile[\s\S]+?^\s*}/m)?.[0] || '';
    expect(pdfToFileBlock).toMatch(/currency:\s*resolvedCurrency/);
  });
});

// ── E: POST /api/invoice/create — email uses currency formatter ──────────────

describe('E — email template uses bhFmtAmount not toFixed+€', () => {
  test('E-01 bhFmtAmount used for rent in email', () => {
    expect(createBlock).toMatch(/bhFmtAmount\(rentAmount,\s*resolvedCurrency\)/);
  });

  test('E-02 bhFmtAmount used for total in email', () => {
    expect(createBlock).toMatch(/bhFmtAmount\(total,\s*resolvedCurrency\)/);
  });

  test('E-03 no raw toFixed+€ in create block email section', () => {
    // The email section should not use .toFixed(2) + ' €' anymore
    const emailSection = createBlock.match(/const emailHtml[\s\S]+?emailCard/)?.[0] || '';
    expect(emailSection).not.toMatch(/\.toFixed\(2\)\s*\+\s*['"]\s*€/);
  });
});

// ── F: GET /api/invoice/history — exposes stored currency ───────────────────

describe('F — GET /api/invoice/history: propagates stored currency', () => {
  test('F-01 history mapper reads meta.currency', () => {
    expect(historyBlock).toMatch(/meta\.currency/);
  });

  test('F-02 history response includes currency field', () => {
    expect(historyBlock).toMatch(/currency:\s*meta\.currency/);
  });

  test('F-03 currency falls back to null for legacy (not current property)', () => {
    // Must use meta.currency, NOT reservation.currency or property.currency
    const currencyLine = historyBlock.match(/currency:\s*meta\.currency.*/)?.[0] || '';
    expect(currencyLine).not.toMatch(/property\.currency|reservation\.currency/);
  });
});

// ── G: utils/invoice-pdf.js — currency-aware PDF generation ─────────────────

describe('G — generateInvoicePdf: uses currency parameter for all monetary amounts', () => {
  test('G-01 fmtAmount function defined in invoice-pdf.js', () => {
    expect(pdf).toMatch(/const fmtAmount\s*=/);
  });

  test('G-02 formatEuro no longer present', () => {
    expect(pdf).not.toMatch(/formatEuro/);
  });

  test('G-03 currency parameter accepted by generateInvoicePdf', () => {
    expect(pdfFuncBlock).toMatch(/currency\s*=\s*['"]EUR['"]/);
  });

  test('G-04 fmtAmount called with currency for row amount', () => {
    expect(pdfFuncBlock).toMatch(/fmtAmount\(amount,\s*currency\)/);
  });

  test('G-05 fmtAmount called with currency for subtotal', () => {
    expect(pdfFuncBlock).toMatch(/fmtAmount\(subtotal,\s*currency\)/);
  });

  test('G-06 fmtAmount called with currency for total', () => {
    expect(pdfFuncBlock).toMatch(/fmtAmount\(total,\s*currency\)/);
  });
});

// ── H: no FX arithmetic ─────────────────────────────────────────────────────

describe('H — no FX conversion anywhere in traveler invoice pipeline', () => {
  test('H-01 no exchangeRate in create handler', () => {
    expect(createBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('H-02 no FX in invoice-pdf.js', () => {
    expect(pdf).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('H-03 no FX in history handler', () => {
    expect(historyBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });
});

// ── I: legacy safety — history does not re-read property currency ────────────

describe('I — history does not re-read current property/reservation currency', () => {
  test('I-01 history handler does not JOIN reservations for currency', () => {
    expect(historyBlock).not.toMatch(/JOIN reservations.*currency|reservations.*\.currency/);
  });

  test('I-02 history handler does not JOIN properties for currency', () => {
    expect(historyBlock).not.toMatch(/JOIN properties.*currency|properties.*\.currency/);
  });
});

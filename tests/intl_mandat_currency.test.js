'use strict';
/**
 * INTL-MANDAT — Mandate Currency Authority End-to-End
 *
 * Structural checks: verifies that the mandate pipeline is currency-aware:
 * POST /api/mandat/send accepts currency, derives a symbol, uses it in the
 * PDF (remuLabels + urgenceLimit), and stores it in contract_data.
 *
 * No DB connection. Static source analysis only.
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract POST /api/mandat/send handler body
const postMandatBlock = src.match(/app\.post\('\/api\/mandat\/send'[\s\S]+?^\}\);/m)?.[0] || '';

// Extract the remuLabels object literal
const remuLabelsBlock = postMandatBlock.match(/const remuLabels\s*=\s*\{[\s\S]+?\};/)?.[0] || '';

// Extract the contractData object literal
const contractDataBlock = postMandatBlock.match(/const contractData\s*=\s*\{[\s\S]+?\};/)?.[0] || '';

// ── A: currency derivation ────────────────────────────────────────────────────

describe('A — POST /api/mandat/send: currency derivation', () => {
  test('A-01 handler is present', () => {
    expect(postMandatBlock).not.toBe('');
  });

  test('A-02 INTL-MANDAT comment present', () => {
    expect(postMandatBlock).toMatch(/INTL-MANDAT/);
  });

  test('A-03 _mandatCurrency derived via normalizeCurrency with EUR fallback', () => {
    expect(postMandatBlock).toMatch(/_mandatCurrency.*=.*normalizeCurrency.*req\.body\.currency.*\|\|.*'EUR'/);
  });

  test('A-04 symbol map covers EUR ILS USD CHF', () => {
    expect(postMandatBlock).toMatch(/EUR.*€/);
    expect(postMandatBlock).toMatch(/ILS.*₪/);
    expect(postMandatBlock).toMatch(/USD.*\$/);
    expect(postMandatBlock).toMatch(/CHF/);
  });

  test('A-05 _mandatSymbol derived from _mandatCurrency', () => {
    expect(postMandatBlock).toMatch(/_mandatSymbol.*=.*\{.*EUR.*€.*\}.*\[_mandatCurrency\]/);
  });
});

// ── B: remuLabels use dynamic symbol ─────────────────────────────────────────

describe('B — remuLabels: currency symbol in PDF text', () => {
  test('B-01 remuLabels block is present', () => {
    expect(remuLabelsBlock).not.toBe('');
  });

  test('B-02 forfait_mensuel uses _mandatSymbol', () => {
    expect(remuLabelsBlock).toMatch(/forfait_mensuel[\s\S]+?_mandatSymbol/);
  });

  test('B-03 forfait_resa uses _mandatSymbol', () => {
    expect(remuLabelsBlock).toMatch(/forfait_resa[\s\S]+?_mandatSymbol/);
  });

  test('B-04 mixte uses _mandatSymbol', () => {
    expect(remuLabelsBlock).toMatch(/mixte[\s\S]+?_mandatSymbol/);
  });

  test('B-05 no hardcoded € in remuLabels', () => {
    expect(remuLabelsBlock).not.toMatch(/['"`][^'"`]*€[^'"`]*['"`]/);
  });
});

// ── C: urgenceLimit uses dynamic symbol ──────────────────────────────────────

describe('C — urgenceLimit: currency symbol in PDF', () => {
  test('C-01 urgenceLimit PDF line uses _mandatSymbol', () => {
    expect(postMandatBlock).toMatch(/urgenceLimit.*_mandatSymbol.*TTC/);
  });

  test('C-02 no hardcoded € adjacent to urgenceLimit in PDF', () => {
    const urgLine = postMandatBlock.match(/urgenceLimit[^\n]*TTC[^\n]*/)?.[0] || '';
    expect(urgLine).not.toMatch(/ €/);
  });
});

// ── D: contractData stores currency ──────────────────────────────────────────

describe('D — contractData: currency persisted in JSONB', () => {
  test('D-01 contractData block is present', () => {
    expect(contractDataBlock).not.toBe('');
  });

  test('D-02 currency: _mandatCurrency stored in contractData', () => {
    expect(contractDataBlock).toMatch(/currency\s*:\s*_mandatCurrency/);
  });
});

// ── E: extras strings — verbatim pass-through ────────────────────────────────

describe('E — extrasFacturables: verbatim storage', () => {
  test('E-01 extrasFacturables stored as-is (no server transformation)', () => {
    expect(contractDataBlock).toMatch(/extrasFacturables\s*:\s*extrasFacturables/);
  });
});

// ── F: no FX conversion ──────────────────────────────────────────────────────

describe('F — no FX conversion in mandate pipeline', () => {
  test('F-01 no exchangeRate or fxRate in POST mandat/send', () => {
    expect(postMandatBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });
});

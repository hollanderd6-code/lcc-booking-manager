'use strict';
/**
 * PMS-INTL-RENTAL-CONTRACT-PDF-RERENDER-1
 *
 * Static source analysis verifying that GET /api/contrats/:id/pdf and
 * POST /api/contrat/sign/:token use contract_data.currency (not property.currency)
 * as the monetary authority for all financial amounts in the re-rendered PDF.
 *
 * Suites:
 *   A — GET PDF currency authority (normalizeCurrency + symbol)
 *   B — SIGN route currency authority
 *   C — EUR acceptance
 *   D — ILS acceptance
 *   E — USD acceptance
 *   F — CHF acceptance
 *   G — Legacy missing currency → EUR fallback
 *   H — Invalid currency → normalizeCurrency fallback
 *   I — Property-currency-change / historical immutability
 *   J — POST /api/contrat/send consistency
 *   K — No hardcoded € in corrected financial rows
 *   L — No FX
 *   M — Isolation: mandats and other contract surfaces untouched
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(
  path.join(__dirname, '../server.js'), 'utf8'
);

// ── Locate route handlers ──────────────────────────────────────────────────────

const getPdfHandlerIdx = serverSrc.indexOf("app.get('/api/contrats/:id/pdf'");
const signHandlerIdx   = serverSrc.indexOf("app.post('/api/contrat/sign/:token'");
const sendHandlerIdx   = serverSrc.indexOf("app.post('/api/contrat/send'");

// ── Locate the GET PDF rental-contract block ───────────────────────────────────
// Anchor on the full declaration — unique in the file.
const getPdfRentalIdx = serverSrc.indexOf('const rentalCurrency = normalizeCurrency(d.currency)');
// 4 500 chars covers symbol declaration + entire financial section (distance ~3 300)
const getPdfBlock = getPdfRentalIdx !== -1
  ? serverSrc.slice(getPdfRentalIdx, getPdfRentalIdx + 4500)
  : '';

// ── Locate the SIGN route rental else-block ────────────────────────────────────
// Anchor on the full declaration — unique in the file.
const signRentalIdx = serverSrc.indexOf('const rentalCurrency = normalizeCurrency(data.currency)');
// 4 500 chars covers symbol declaration + entire financial section
const signBlock = signRentalIdx !== -1
  ? serverSrc.slice(signRentalIdx, signRentalIdx + 4500)
  : '';

// ── Locate POST /api/contrat/send for consistency check ───────────────────────
// 8 000 chars: the financial section is ~6 400 chars from the handler start
const sendBlock = sendHandlerIdx !== -1
  ? serverSrc.slice(sendHandlerIdx, sendHandlerIdx + 8000)
  : '';

// ── A: GET PDF currency authority ─────────────────────────────────────────────

describe('A — GET PDF currency authority', () => {
  test('A-01 GET PDF handler present', () => {
    expect(getPdfHandlerIdx).not.toBe(-1);
  });

  test('A-02 rental-contract block located (normalizeCurrency(d.currency))', () => {
    expect(getPdfRentalIdx).not.toBe(-1);
  });

  test('A-03 rentalCurrency derived from normalizeCurrency(d.currency)', () => {
    expect(getPdfBlock).toMatch(/normalizeCurrency\(d\.currency\)/);
  });

  test('A-04 fallback to EUR when normalizeCurrency returns falsy', () => {
    expect(getPdfBlock).toMatch(/normalizeCurrency\(d\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-05 rentalSymbol table includes EUR, ILS, USD, CHF', () => {
    expect(getPdfBlock).toMatch(/EUR.*€.*ILS.*₪.*USD.*\$.*CHF.*Fr\./s);
  });

  test('A-06 rentalSymbol fallback to currency code for unknown ISO', () => {
    expect(getPdfBlock).toMatch(/\[rentalCurrency\]\s*\|\|\s*rentalCurrency/);
  });

  test('A-07 totalPrice row uses rentalSymbol (not hardcoded €)', () => {
    const idx = getPdfBlock.indexOf('Loyer total (CC)');
    expect(idx).not.toBe(-1);
    const row = getPdfBlock.slice(idx, idx + 100);
    expect(row).toMatch(/\$\{rentalSymbol\}/);
    expect(row).not.toMatch(/} €/);
  });

  test('A-08 deposit row uses rentalSymbol (not hardcoded €)', () => {
    const idx = getPdfBlock.indexOf('Dépôt de garantie');
    expect(idx).not.toBe(-1);
    const row = getPdfBlock.slice(idx, idx + 100);
    expect(row).toMatch(/\$\{rentalSymbol\}/);
    expect(row).not.toMatch(/} €/);
  });
});

// ── B: SIGN route currency authority ──────────────────────────────────────────

describe('B — SIGN route currency authority', () => {
  test('B-01 SIGN handler present', () => {
    expect(signHandlerIdx).not.toBe(-1);
  });

  test('B-02 rental-contract block located in sign route (normalizeCurrency(data.currency))', () => {
    expect(signRentalIdx).not.toBe(-1);
  });

  test('B-03 rentalCurrency derived from normalizeCurrency(data.currency)', () => {
    expect(signBlock).toMatch(/normalizeCurrency\(data\.currency\)/);
  });

  test('B-04 fallback to EUR', () => {
    expect(signBlock).toMatch(/normalizeCurrency\(data\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-05 rentalSymbol table present in sign rental block', () => {
    expect(signBlock).toMatch(/EUR.*€.*ILS.*₪.*USD.*\$.*CHF.*Fr\./s);
  });

  test('B-06 rentalSymbol fallback to currency code', () => {
    expect(signBlock).toMatch(/\[rentalCurrency\]\s*\|\|\s*rentalCurrency/);
  });

  test('B-07 totalPrice row uses rentalSymbol', () => {
    const idx = signBlock.indexOf('Loyer total (CC)');
    expect(idx).not.toBe(-1);
    const row = signBlock.slice(idx, idx + 100);
    expect(row).toMatch(/\$\{rentalSymbol\}/);
    expect(row).not.toMatch(/} €/);
  });

  test('B-08 deposit row uses rentalSymbol', () => {
    const idx = signBlock.indexOf('Dépôt de garantie');
    expect(idx).not.toBe(-1);
    const row = signBlock.slice(idx, idx + 100);
    expect(row).toMatch(/\$\{rentalSymbol\}/);
    expect(row).not.toMatch(/} €/);
  });
});

// ── C: EUR acceptance ──────────────────────────────────────────────────────────

describe('C — EUR acceptance', () => {
  test('C-01 GET PDF: EUR → € symbol in table', () => {
    expect(getPdfBlock).toMatch(/EUR.*'€'/);
  });

  test('C-02 SIGN: EUR → € symbol in table', () => {
    expect(signBlock).toMatch(/EUR.*'€'/);
  });
});

// ── D: ILS acceptance ──────────────────────────────────────────────────────────

describe('D — ILS acceptance', () => {
  test('D-01 GET PDF: ILS → ₪ symbol in table', () => {
    expect(getPdfBlock).toMatch(/ILS.*'₪'/);
  });

  test('D-02 SIGN: ILS → ₪ symbol in table', () => {
    expect(signBlock).toMatch(/ILS.*'₪'/);
  });
});

// ── E: USD acceptance ──────────────────────────────────────────────────────────

describe('E — USD acceptance', () => {
  test('E-01 GET PDF: USD → $ symbol in table', () => {
    expect(getPdfBlock).toMatch(/USD.*'\$'/);
  });

  test('E-02 SIGN: USD → $ symbol in table', () => {
    expect(signBlock).toMatch(/USD.*'\$'/);
  });
});

// ── F: CHF acceptance ──────────────────────────────────────────────────────────

describe('F — CHF acceptance', () => {
  test('F-01 GET PDF: CHF → Fr. symbol in table', () => {
    expect(getPdfBlock).toMatch(/CHF.*'Fr\.'/);
  });

  test('F-02 SIGN: CHF → Fr. symbol in table', () => {
    expect(signBlock).toMatch(/CHF.*'Fr\.'/);
  });
});

// ── G: Legacy missing currency → EUR ──────────────────────────────────────────

describe('G — Legacy missing currency → EUR fallback', () => {
  test('G-01 GET PDF: normalizeCurrency(undefined/null/empty) → falsy → "EUR" fallback via ||', () => {
    expect(getPdfBlock).toMatch(/normalizeCurrency\(d\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('G-02 SIGN: same fallback pattern', () => {
    expect(signBlock).toMatch(/normalizeCurrency\(data\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });
});

// ── H: Invalid currency → normalizeCurrency fallback ──────────────────────────

describe('H — Invalid currency → normalizeCurrency fallback → EUR', () => {
  test('H-01 GET PDF uses normalizeCurrency (delegates validation to shared helper)', () => {
    expect(getPdfBlock).toMatch(/normalizeCurrency/);
  });

  test('H-02 SIGN uses normalizeCurrency', () => {
    expect(signBlock).toMatch(/normalizeCurrency/);
  });
});

// ── I: Historical immutability ─────────────────────────────────────────────────

describe('I — Historical immutability (property currency change simulation)', () => {
  test('I-01 GET PDF handler SELECT is FROM contracts only (no property JOIN)', () => {
    const handlerBlock = serverSrc.slice(getPdfHandlerIdx, getPdfHandlerIdx + 700);
    expect(handlerBlock).toMatch(/SELECT \* FROM contracts WHERE id/);
    expect(handlerBlock).not.toMatch(/JOIN.*propert/i);
  });

  test('I-02 GET PDF rental section does not reference property.currency or prop.currency', () => {
    expect(getPdfBlock).not.toMatch(/property\.currency|prop\.currency|p\.currency/);
  });

  test('I-03 SIGN route SELECT does not JOIN properties', () => {
    const signSelect = serverSrc.slice(signHandlerIdx, signHandlerIdx + 500);
    expect(signSelect).not.toMatch(/JOIN.*propert/i);
  });

  test('I-04 SIGN rental section does not reference property.currency', () => {
    expect(signBlock).not.toMatch(/property\.currency|prop\.currency|p\.currency/);
  });

  test('I-05 GET PDF: currency authority is d.currency (contract_data snapshot)', () => {
    expect(getPdfBlock).toMatch(/normalizeCurrency\(d\.currency\)/);
  });

  test('I-06 SIGN: currency authority is data.currency (contract_data snapshot)', () => {
    expect(signBlock).toMatch(/normalizeCurrency\(data\.currency\)/);
  });
});

// ── J: POST /api/contrat/send consistency ─────────────────────────────────────

describe('J — POST /api/contrat/send consistency (all three paths use same symbol strategy)', () => {
  test('J-01 send route uses normalizeCurrency(currency) || "EUR"', () => {
    expect(sendBlock).toMatch(/normalizeCurrency\(currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('J-02 send route uses same symbol table', () => {
    expect(sendBlock).toMatch(/EUR.*€.*ILS.*₪.*USD.*\$.*CHF.*Fr\./s);
  });

  test('J-03 send route totalPrice uses rentalSymbol', () => {
    const idx = sendBlock.indexOf('Loyer total (CC)');
    expect(idx).not.toBe(-1);
    const row = sendBlock.slice(idx, idx + 100);
    expect(row).toMatch(/\$\{rentalSymbol\}/);
  });
});

// ── K: No hardcoded € in corrected financial rows ─────────────────────────────

describe('K — No hardcoded € remaining in rental financial rows', () => {
  test('K-01 GET PDF: "Loyer total" row no longer has } €', () => {
    const idx = getPdfBlock.indexOf('Loyer total (CC)');
    const row = getPdfBlock.slice(idx, idx + 100);
    expect(row).not.toMatch(/} €/);
  });

  test('K-02 GET PDF: "Dépôt de garantie" row no longer has } €', () => {
    const idx = getPdfBlock.indexOf('Dépôt de garantie');
    const row = getPdfBlock.slice(idx, idx + 100);
    expect(row).not.toMatch(/} €/);
  });

  test('K-03 SIGN: "Loyer total" row no longer has } €', () => {
    const idx = signBlock.indexOf('Loyer total (CC)');
    const row = signBlock.slice(idx, idx + 100);
    expect(row).not.toMatch(/} €/);
  });

  test('K-04 SIGN: "Dépôt de garantie" row no longer has } €', () => {
    const idx = signBlock.indexOf('Dépôt de garantie');
    const row = signBlock.slice(idx, idx + 100);
    expect(row).not.toMatch(/} €/);
  });
});

// ── L: No FX ──────────────────────────────────────────────────────────────────

describe('L — No FX conversion introduced', () => {
  test('L-01 GET PDF rental block: no exchangeRate/fxRate/convertCurrency', () => {
    expect(getPdfBlock).not.toMatch(/exchangeRate|fxRate|convert.*currency|convertCurrency/i);
  });

  test('L-02 SIGN rental block: no exchangeRate/fxRate/convertCurrency', () => {
    expect(signBlock).not.toMatch(/exchangeRate|fxRate|convert.*currency|convertCurrency/i);
  });
});

// ── M: Isolation ───────────────────────────────────────────────────────────────

describe('M — Isolation: mandats and other surfaces untouched', () => {
  test('M-01 GET PDF mandat branch still has isMandat guard', () => {
    // isMandat is declared ~730 chars into the handler
    const handlerBlock = serverSrc.slice(getPdfHandlerIdx, getPdfHandlerIdx + 800);
    expect(handlerBlock).toMatch(/isMandat\s*=\s*d\.contractType\s*===\s*['"]mandat['"]/);
  });

  test('M-02 SIGN route mandat branch still has isMandat guard', () => {
    // isMandat is declared ~1 419 chars into the sign handler
    const signHandler = serverSrc.slice(signHandlerIdx, signHandlerIdx + 1500);
    expect(signHandler).toMatch(/isMandat\s*=\s*data\.contractType\s*===\s*['"]mandat['"]/);
  });

  test('M-03 no rentalSymbol declared in mandat path of GET PDF (before mandat early-return)', () => {
    // Everything before our getPdfRentalIdx is the mandat path
    const mandatBlock = serverSrc.slice(getPdfHandlerIdx, getPdfRentalIdx);
    expect(mandatBlock).not.toMatch(/const rentalCurrency\s*=/);
  });

  test('M-04 rentalCurrency IS present in GET PDF rental block (correctly scoped)', () => {
    expect(getPdfBlock).toMatch(/const rentalCurrency/);
  });

  test('M-05 POST /api/contrat/send unchanged (rentalSymbol still present)', () => {
    expect(sendBlock).toMatch(/rentalSymbol/);
  });

  test('M-06 deposits INSERT now uses dynamic currency (INTL-DEPOSIT-STRIPE-1B applied)', () => {
    // PMS-INTL-DEPOSIT-STRIPE-CURRENCY-1B changed all deposit INSERTs to use dynamic currency.
    // Verify the migration DEFAULT 'eur' is still present (legacy rows stay EUR automatically).
    expect(serverSrc).toMatch(/ALTER TABLE deposits ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'eur'/);
  });
});

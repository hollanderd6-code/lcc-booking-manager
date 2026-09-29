'use strict';
/**
 * PMS-INTL-MANDATE-RERENDER-1
 *
 * Static source analysis verifying that GET /api/contrats/:id/pdf and
 * POST /api/contrat/sign/:token use contract_data.currency (not property.currency)
 * as the monetary authority for remuLabels and urgenceLimit in the mandat branch.
 *
 * Suites:
 *   A — SIGN route mandat currency authority
 *   B — GET PDF route mandat currency authority
 *   C — EUR acceptance
 *   D — ILS acceptance
 *   E — USD acceptance
 *   F — CHF acceptance
 *   G — Legacy missing currency → EUR fallback
 *   H — Invalid currency → normalizeCurrency fallback
 *   I — Historical immutability (no JOIN on properties)
 *   J — remuLabels rows use mandatSymbol
 *   K — urgenceLimit uses mandatSymbol (no hardcoded €)
 *   L — No FX
 *   M — Isolation: rental branches and send route untouched
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(
  path.join(__dirname, '../server.js'), 'utf8'
);

// ── Locate route handlers ─────────────────────────────────────────────────────

const getPdfHandlerIdx = serverSrc.indexOf("app.get('/api/contrats/:id/pdf'");
const signHandlerIdx   = serverSrc.indexOf("app.post('/api/contrat/sign/:token'");
const sendHandlerIdx   = serverSrc.indexOf("app.post('/api/contrat/send'");

// ── Locate SIGN route mandat block ────────────────────────────────────────────
// Anchor unique in file: mandatCurrency derived from data.currency (SIGN uses `data`)
const signMandatIdx = serverSrc.indexOf('const mandatCurrency = normalizeCurrency(data.currency)');
// 3 500 chars covers remuLabels (~250 chars) + urgenceLimit (distance ~2 790)
const signMandatBlock = signMandatIdx !== -1
  ? serverSrc.slice(signMandatIdx, signMandatIdx + 3500)
  : '';

// ── Locate GET PDF route mandat block ─────────────────────────────────────────
// Anchor unique in file: mandatCurrency derived from d.currency (GET PDF uses `d`)
const getPdfMandatIdx = serverSrc.indexOf('const mandatCurrency = normalizeCurrency(d.currency)');
// 6 000 chars covers remuLabels (~250 chars) + urgenceLimit (distance ~5 309)
const getPdfMandatBlock = getPdfMandatIdx !== -1
  ? serverSrc.slice(getPdfMandatIdx, getPdfMandatIdx + 6000)
  : '';

// ── A: SIGN route mandat currency authority ───────────────────────────────────

describe('A — SIGN route mandat currency authority', () => {
  test('A-01 SIGN handler present', () => {
    expect(signHandlerIdx).not.toBe(-1);
  });

  test('A-02 SIGN mandat block located (mandatCurrency = normalizeCurrency(data.currency))', () => {
    expect(signMandatIdx).not.toBe(-1);
  });

  test('A-03 mandatCurrency derived from normalizeCurrency(data.currency) || "EUR"', () => {
    expect(signMandatBlock).toMatch(/normalizeCurrency\(data\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-04 mandatSymbol table present in SIGN mandat block', () => {
    expect(signMandatBlock).toMatch(/EUR.*€.*ILS.*₪.*USD.*\$.*CHF.*Fr\./s);
  });

  test('A-05 mandatSymbol fallback to currency code for unknown ISO', () => {
    expect(signMandatBlock).toMatch(/\[mandatCurrency\]\s*\|\|\s*mandatCurrency/);
  });
});

// ── B: GET PDF route mandat currency authority ────────────────────────────────

describe('B — GET PDF route mandat currency authority', () => {
  test('B-01 GET PDF handler present', () => {
    expect(getPdfHandlerIdx).not.toBe(-1);
  });

  test('B-02 GET PDF mandat block located (mandatCurrency = normalizeCurrency(d.currency))', () => {
    expect(getPdfMandatIdx).not.toBe(-1);
  });

  test('B-03 mandatCurrency derived from normalizeCurrency(d.currency) || "EUR"', () => {
    expect(getPdfMandatBlock).toMatch(/normalizeCurrency\(d\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-04 mandatSymbol table present in GET PDF mandat block', () => {
    expect(getPdfMandatBlock).toMatch(/EUR.*€.*ILS.*₪.*USD.*\$.*CHF.*Fr\./s);
  });

  test('B-05 mandatSymbol fallback to currency code for unknown ISO', () => {
    expect(getPdfMandatBlock).toMatch(/\[mandatCurrency\]\s*\|\|\s*mandatCurrency/);
  });
});

// ── C: EUR acceptance ─────────────────────────────────────────────────────────

describe('C — EUR acceptance', () => {
  test('C-01 SIGN: EUR → "€" in symbol table', () => {
    expect(signMandatBlock).toMatch(/EUR.*'€'/);
  });

  test('C-02 GET PDF: EUR → "€" in symbol table', () => {
    expect(getPdfMandatBlock).toMatch(/EUR.*'€'/);
  });
});

// ── D: ILS acceptance ─────────────────────────────────────────────────────────

describe('D — ILS acceptance', () => {
  test('D-01 SIGN: ILS → "₪" in symbol table', () => {
    expect(signMandatBlock).toMatch(/ILS.*'₪'/);
  });

  test('D-02 GET PDF: ILS → "₪" in symbol table', () => {
    expect(getPdfMandatBlock).toMatch(/ILS.*'₪'/);
  });
});

// ── E: USD acceptance ─────────────────────────────────────────────────────────

describe('E — USD acceptance', () => {
  test('E-01 SIGN: USD → "$" in symbol table', () => {
    expect(signMandatBlock).toMatch(/USD.*'\$'/);
  });

  test('E-02 GET PDF: USD → "$" in symbol table', () => {
    expect(getPdfMandatBlock).toMatch(/USD.*'\$'/);
  });
});

// ── F: CHF acceptance ─────────────────────────────────────────────────────────

describe('F — CHF acceptance', () => {
  test('F-01 SIGN: CHF → "Fr." in symbol table', () => {
    expect(signMandatBlock).toMatch(/CHF.*'Fr\.'/);
  });

  test('F-02 GET PDF: CHF → "Fr." in symbol table', () => {
    expect(getPdfMandatBlock).toMatch(/CHF.*'Fr\.'/);
  });
});

// ── G: Legacy missing currency → EUR fallback ─────────────────────────────────

describe('G — Legacy missing currency → EUR fallback', () => {
  test('G-01 SIGN: normalizeCurrency(undefined/null/empty) → falsy → "EUR" fallback via ||', () => {
    expect(signMandatBlock).toMatch(/normalizeCurrency\(data\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('G-02 GET PDF: same fallback pattern', () => {
    expect(getPdfMandatBlock).toMatch(/normalizeCurrency\(d\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });
});

// ── H: Invalid currency → normalizeCurrency fallback ─────────────────────────

describe('H — Invalid currency → normalizeCurrency fallback → EUR', () => {
  test('H-01 SIGN uses normalizeCurrency (delegates validation to shared helper)', () => {
    expect(signMandatBlock).toMatch(/normalizeCurrency/);
  });

  test('H-02 GET PDF uses normalizeCurrency', () => {
    expect(getPdfMandatBlock).toMatch(/normalizeCurrency/);
  });
});

// ── I: Historical immutability ────────────────────────────────────────────────

describe('I — Historical immutability (property currency change simulation)', () => {
  test('I-01 GET PDF handler SELECT is FROM contracts only (no property JOIN)', () => {
    const handlerBlock = serverSrc.slice(getPdfHandlerIdx, getPdfHandlerIdx + 700);
    expect(handlerBlock).toMatch(/SELECT \* FROM contracts WHERE id/);
    expect(handlerBlock).not.toMatch(/JOIN.*propert/i);
  });

  test('I-02 GET PDF mandat block does not reference property.currency or d.property', () => {
    expect(getPdfMandatBlock).not.toMatch(/property\.currency|prop\.currency|p\.currency/);
  });

  test('I-03 SIGN route SELECT does not JOIN properties', () => {
    const signSelect = serverSrc.slice(signHandlerIdx, signHandlerIdx + 500);
    expect(signSelect).not.toMatch(/JOIN.*propert/i);
  });

  test('I-04 SIGN mandat block does not reference property.currency', () => {
    expect(signMandatBlock).not.toMatch(/property\.currency|prop\.currency|p\.currency/);
  });

  test('I-05 GET PDF: currency authority is d.currency (contract_data snapshot)', () => {
    expect(getPdfMandatBlock).toMatch(/normalizeCurrency\(d\.currency\)/);
  });

  test('I-06 SIGN: currency authority is data.currency (contract_data snapshot)', () => {
    expect(signMandatBlock).toMatch(/normalizeCurrency\(data\.currency\)/);
  });
});

// ── J: remuLabels use mandatSymbol ────────────────────────────────────────────

describe('J — remuLabels rows use mandatSymbol', () => {
  test('J-01 SIGN forfait_mensuel uses ${mandatSymbol}/mois', () => {
    expect(signMandatBlock).toMatch(/forfait_mensuel.*\$\{mandatSymbol\}\/mois/s);
  });

  test('J-02 SIGN forfait_resa uses ${mandatSymbol}/réservation', () => {
    expect(signMandatBlock).toMatch(/forfait_resa.*\$\{mandatSymbol\}\/r/s);
  });

  test('J-03 SIGN mixte uses ${mandatSymbol}/mois', () => {
    expect(signMandatBlock).toMatch(/mixte.*\$\{mandatSymbol\}\/mois/s);
  });

  test('J-04 GET PDF forfait_mensuel uses ${mandatSymbol}', () => {
    expect(getPdfMandatBlock).toMatch(/forfait_mensuel.*\$\{mandatSymbol\}/s);
  });

  test('J-05 GET PDF forfait_resa uses ${mandatSymbol}', () => {
    expect(getPdfMandatBlock).toMatch(/forfait_resa.*\$\{mandatSymbol\}/s);
  });

  test('J-06 GET PDF mixte uses ${mandatSymbol}/mois', () => {
    expect(getPdfMandatBlock).toMatch(/mixte.*\$\{mandatSymbol\}\/mois/s);
  });
});

// ── K: urgenceLimit uses mandatSymbol ─────────────────────────────────────────

describe('K — urgenceLimit uses mandatSymbol (no hardcoded €)', () => {
  test('K-01 SIGN urgenceLimit uses ${mandatSymbol}', () => {
    const idx = signMandatBlock.indexOf('urgenceLimit');
    expect(idx).not.toBe(-1);
    const row = signMandatBlock.slice(idx, idx + 120);
    expect(row).toMatch(/\$\{mandatSymbol\}/);
  });

  test('K-02 SIGN urgenceLimit no longer hardcodes €', () => {
    const idx = signMandatBlock.indexOf('urgenceLimit');
    const row = signMandatBlock.slice(idx, idx + 120);
    expect(row).not.toMatch(/\} €/);
  });

  test('K-03 GET PDF urgenceLimit uses ${mandatSymbol}', () => {
    const idx = getPdfMandatBlock.indexOf('urgenceLimit');
    expect(idx).not.toBe(-1);
    const row = getPdfMandatBlock.slice(idx, idx + 120);
    expect(row).toMatch(/\$\{mandatSymbol\}/);
  });

  test('K-04 GET PDF urgenceLimit no longer hardcodes €', () => {
    const idx = getPdfMandatBlock.indexOf('urgenceLimit');
    const row = getPdfMandatBlock.slice(idx, idx + 120);
    expect(row).not.toMatch(/\} €/);
  });
});

// ── L: No FX ─────────────────────────────────────────────────────────────────

describe('L — No FX conversion introduced', () => {
  test('L-01 SIGN mandat block: no exchangeRate/fxRate/convertCurrency', () => {
    expect(signMandatBlock).not.toMatch(/exchangeRate|fxRate|convert.*currency|convertCurrency/i);
  });

  test('L-02 GET PDF mandat block: no exchangeRate/fxRate/convertCurrency', () => {
    expect(getPdfMandatBlock).not.toMatch(/exchangeRate|fxRate|convert.*currency|convertCurrency/i);
  });
});

// ── M: Isolation ──────────────────────────────────────────────────────────────

describe('M — Isolation: rental branches and send route untouched', () => {
  test('M-01 GET PDF rental branch still has rentalCurrency = normalizeCurrency(d.currency)', () => {
    expect(serverSrc).toMatch(/const rentalCurrency = normalizeCurrency\(d\.currency\)/);
  });

  test('M-02 SIGN rental branch still has rentalCurrency = normalizeCurrency(data.currency)', () => {
    expect(serverSrc).toMatch(/const rentalCurrency = normalizeCurrency\(data\.currency\)/);
  });

  test('M-03 send route still uses _mandatSymbol (unchanged)', () => {
    expect(serverSrc).toMatch(/const _mandatSymbol = \{/);
  });

  test('M-04 isMandat guard still present in GET PDF handler', () => {
    const handlerBlock = serverSrc.slice(getPdfHandlerIdx, getPdfHandlerIdx + 800);
    expect(handlerBlock).toMatch(/isMandat\s*=\s*d\.contractType\s*===\s*['"]mandat['"]/);
  });

  test('M-05 isMandat guard still present in SIGN handler', () => {
    const signHandler = serverSrc.slice(signHandlerIdx, signHandlerIdx + 1500);
    expect(signHandler).toMatch(/isMandat\s*=\s*data\.contractType\s*===\s*['"]mandat['"]/);
  });

  test('M-06 mandatCurrency NOT declared before the mandat branch in GET PDF (correctly scoped)', () => {
    // Everything from getPdfHandlerIdx to getPdfMandatIdx is before the if(isMandat) body
    const preMandatBlock = serverSrc.slice(getPdfHandlerIdx, getPdfMandatIdx);
    expect(preMandatBlock).not.toMatch(/const mandatCurrency\s*=/);
  });

  test('M-07 mandatCurrency NOT declared before the mandat branch in SIGN (correctly scoped)', () => {
    // Everything from signHandlerIdx to signMandatIdx is before the if(isMandat) body
    const preMandatBlock = serverSrc.slice(signHandlerIdx, signMandatIdx);
    expect(preMandatBlock).not.toMatch(/const mandatCurrency\s*=/);
  });
});

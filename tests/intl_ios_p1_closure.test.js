'use strict';
/**
 * PMS-INTL-IOS-P1-CLOSURE-1
 *
 * Static source analysis verifying that remaining P1 internationalisation
 * findings are closed in the iOS Swift sources and that each unfixed site
 * is correctly classified (CURRENCY_SNAPSHOT_MISSING / INTENTIONALLY_EUR).
 *
 * Suites:
 *   A — MandatCreationView freeExtraRow defect fix
 *   B — ContractDetailModels model upgrade (currency decoded, displayCurrency exposed)
 *   C — ContractDetailView mandate amounts use displayCurrency
 *   D — ContractDetailViewModel commissionSummary dynamic currency
 *   E — ConversationDetailView deposit classified CURRENCY_SNAPSHOT_MISSING
 *   F — UpsellSheet classified INTENTIONALLY_EUR
 *   G — Regression: no new bare € introduced in previously fixed paths
 */

const fs   = require('fs');
const path = require('path');

const iosRoot = path.join(__dirname, '../../Boostinghost-ios/Boostinghost');

function read(relPath) {
  const abs = path.join(iosRoot, relPath);
  try { return fs.readFileSync(abs, 'utf8'); }
  catch (_) { return ''; }
}

const mandatCreationSrc     = read('Features/Manage/MandatCreationView.swift');
const contractDetailModels  = read('Features/Manage/ContractDetailModels.swift');
const contractDetailView    = read('Features/Manage/ContractDetailView.swift');
const contractDetailVM      = read('Features/Manage/ContractDetailViewModel.swift');
const mandatModels          = read('Features/Manage/MandatModels.swift');
const convDetailView        = read('Features/Messages/ConversationDetailView.swift');
const upsellSheet           = read('Features/Upsell/UpsellSheet.swift');

// ── A: MandatCreationView freeExtraRow defect fix ────────────────────────────

describe('A — MandatCreationView freeExtraRow defect', () => {
  test('A-01 file present', () => {
    expect(mandatCreationSrc).not.toBe('');
  });

  test('A-02 freeExtraRow no longer contains bare Text("€")', () => {
    // Extract the freeExtraRow function block
    const idx = mandatCreationSrc.indexOf('private func freeExtraRow');
    expect(idx).not.toBe(-1);
    const block = mandatCreationSrc.slice(idx, idx + 1200);
    // Should NOT have a standalone Text("€") — it must use currencySymbol
    expect(block).not.toMatch(/Text\("€"\)/);
  });

  test('A-03 freeExtraRow uses currencySymbol(for: draft.currency)', () => {
    const idx = mandatCreationSrc.indexOf('private func freeExtraRow');
    const block = mandatCreationSrc.slice(idx, idx + 1200);
    expect(block).toMatch(/currencySymbol\(for:\s*draft\.currency\)/);
  });

  test('A-04 all other MandatCreationView currency labels already use currencySymbol', () => {
    // No stray Text("€") anywhere in the file (only dynamic uses should remain)
    expect(mandatCreationSrc).not.toMatch(/Text\("€"\)/);
  });
});

// ── B: ContractDetailModels model upgrade ────────────────────────────────────

describe('B — ContractDetailModels currency field and displayCurrency', () => {
  test('B-01 file present', () => {
    expect(contractDetailModels).not.toBe('');
  });

  test('B-02 ContractDetailData declares currency: String?', () => {
    expect(contractDetailModels).toMatch(/let currency:\s*String\?/);
  });

  test('B-03 CodingKeys includes currency case', () => {
    expect(contractDetailModels).toMatch(/case.*\bcurrency\b/);
  });

  test('B-04 init(from:) decodes currency', () => {
    expect(contractDetailModels).toMatch(/currency\s*=\s*try\? c\.decodeIfPresent\(String\.self.*forKey: \.currency\)/);
  });

  test('B-05 ContractDetail exposes displayCurrency computed property', () => {
    expect(contractDetailModels).toMatch(/var displayCurrency:\s*String/);
  });

  test('B-06 displayCurrency uses normalizeCurrency with contractData?.currency', () => {
    expect(contractDetailModels).toMatch(/normalizeCurrency\(contractData\?\.currency\)/);
  });
});

// ── C: ContractDetailView mandate amounts use displayCurrency ─────────────────

describe('C — ContractDetailView mandate amounts', () => {
  test('C-01 file present', () => {
    expect(contractDetailView).not.toBe('');
  });

  test('C-02 urgenceLimit uses displayCurrency (not bare €)', () => {
    const idx = contractDetailView.indexOf('Plafond urgence');
    expect(idx).not.toBe(-1);
    const block = contractDetailView.slice(Math.max(0, idx - 20), idx + 200);
    expect(block).toMatch(/displayCurrency/);
    expect(block).not.toMatch(/\\u\{202F\}€/);
  });

  test('C-03 forfait_mensuel uses displayCurrency', () => {
    const idx = contractDetailView.indexOf('forfait_mensuel');
    const block = contractDetailView.slice(idx, idx + 400);
    expect(block).toMatch(/displayCurrency/);
  });

  test('C-04 forfait_resa uses displayCurrency', () => {
    const idx = contractDetailView.indexOf('forfait_resa');
    expect(idx).not.toBe(-1);
    const block = contractDetailView.slice(idx, idx + 400);
    expect(block).toMatch(/displayCurrency/);
  });

  test('C-05 mixteForfait uses displayCurrency', () => {
    const honoraireIdx = contractDetailView.indexOf('private func honorairesContent');
    const block = contractDetailView.slice(honoraireIdx, honoraireIdx + 2000);
    expect(block).toMatch(/mixteForfait.*displayCurrency|displayCurrency.*mixteForfait/s);
  });

  test('C-06 rental tarifsContent uses displayCurrency (CURRENCY_SNAPSHOT_MISSING resolved by RENTAL-CONTRACT-CURRENCY-1)', () => {
    const idx = contractDetailView.indexOf('private func tarifsContent');
    const block = contractDetailView.slice(idx, idx + 800);
    expect(block).toMatch(/currencySymbol\(for:\s*detail\.displayCurrency\)/);
    expect(block).not.toMatch(/\\u\{202F\}€/);
  });
});

// ── D: ContractDetailViewModel commissionSummary dynamic currency ─────────────

describe('D — ContractDetailViewModel commissionSummary', () => {
  test('D-01 file present', () => {
    expect(contractDetailVM).not.toBe('');
  });

  test('D-02 commissionSummary computes sym from displayCurrency', () => {
    const idx = contractDetailVM.indexOf('var commissionSummary');
    expect(idx).not.toBe(-1);
    const block = contractDetailVM.slice(idx, idx + 700);
    expect(block).toMatch(/sym\s*=\s*Formatters\.currencySymbol\(for:/);
    expect(block).toMatch(/displayCurrency/);
  });

  test('D-03 commissionSummary no longer hardcodes €/mois literal', () => {
    const idx = contractDetailVM.indexOf('var commissionSummary');
    const block = contractDetailVM.slice(idx, idx + 700);
    expect(block).not.toMatch(/\\u\{202F\}€\/mois/);
    expect(block).not.toMatch(/\\u\{202F\}€\/rés\./);
  });

  test('D-04 commissionSummary uses \\(sym)/mois', () => {
    const idx = contractDetailVM.indexOf('var commissionSummary');
    const block = contractDetailVM.slice(idx, idx + 700);
    expect(block).toMatch(/\\\(sym\)\/mois/);
  });

  test('D-05 rentalPriceSummary uses displayCurrency (CURRENCY_SNAPSHOT_MISSING resolved by RENTAL-CONTRACT-CURRENCY-1)', () => {
    const idx = contractDetailVM.indexOf('var rentalPriceSummary');
    expect(idx).not.toBe(-1);
    const block = contractDetailVM.slice(idx, idx + 300);
    expect(block).toMatch(/currencySymbol\(for:\s*detail\?\.displayCurrency/);
  });

  test('D-06 rentalDepositSummary uses displayCurrency (CURRENCY_SNAPSHOT_MISSING resolved by RENTAL-CONTRACT-CURRENCY-1)', () => {
    const idx = contractDetailVM.indexOf('var rentalDepositSummary');
    expect(idx).not.toBe(-1);
    const block = contractDetailVM.slice(idx, idx + 300);
    expect(block).toMatch(/currencySymbol\(for:\s*detail\?\.displayCurrency/);
  });
});

// ── E: ConversationDetailView deposit CURRENCY_SNAPSHOT_MISSING ───────────────

describe('E — ConversationDetailView deposit denomination', () => {
  test('E-01 file present', () => {
    expect(convDetailView).not.toBe('');
  });

  test('E-02 deposit amount display uses currency-aware formatter (CURRENCY_SNAPSHOT_MISSING resolved by DEPOSIT-CONTEXT-CURRENCY-1)', () => {
    const idx = convDetailView.indexOf('depositAmountCents');
    expect(idx).not.toBe(-1);
    const block = convDetailView.slice(idx, idx + 400);
    expect(block).toMatch(/Formatters\.amount.*depositCurrency|depositCurrency.*Formatters\.amount/s);
    expect(block).not.toMatch(/CURRENCY_SNAPSHOT_MISSING/);
  });
});

// ── F: UpsellSheet INTENTIONALLY_EUR ─────────────────────────────────────────

describe('F — UpsellSheet EUR classification', () => {
  test('F-01 file present', () => {
    expect(upsellSheet).not.toBe('');
  });

  test('F-02 input Text("€") marked INTENTIONALLY_EUR', () => {
    // Find Text("€") in the input form (Montant section)
    const idx = upsellSheet.indexOf('Text("€")');
    expect(idx).not.toBe(-1);
    // Check nearby (within 300 chars before)
    const block = upsellSheet.slice(Math.max(0, idx - 300), idx + 20);
    expect(block).toMatch(/INTENTIONALLY_EUR/);
  });

  test('F-03 fee/net amounts marked INTENTIONALLY_EUR', () => {
    const idx = upsellSheet.indexOf('Formatters.amountDecimal(fee)');
    expect(idx).not.toBe(-1);
    const block = upsellSheet.slice(Math.max(0, idx - 400), idx + 20);
    expect(block).toMatch(/INTENTIONALLY_EUR/);
  });
});

// ── G: Regression ─────────────────────────────────────────────────────────────

describe('G — regression: previously fixed paths unchanged', () => {
  test('G-01 MandatViewModel.commissionSummary still uses currencySymbol', () => {
    const mandatVMSrc = read('Features/Manage/MandatViewModel.swift');
    const idx = mandatVMSrc.indexOf('var commissionSummary');
    expect(idx).not.toBe(-1);
    const block = mandatVMSrc.slice(idx, idx + 600);
    expect(block).toMatch(/currencySymbol\(for:\s*draft\.currency\)/);
  });

  test('G-02 MandatCreationView Step5 urgenceLimit still uses currencySymbol', () => {
    // The Step5 preview in MandatCreationView also uses the dynamic symbol
    const idx = mandatCreationSrc.indexOf('urgenceLimit');
    expect(idx).not.toBe(-1);
    // Multiple occurrences — check the one in the preview section (not freeExtraRow)
    expect(mandatCreationSrc).toMatch(/urgenceLimit.*currencySymbol|currencySymbol.*urgenceLimit/s);
  });

  test('G-03 MandatModels still has MandatDraft.currency default EUR', () => {
    expect(mandatModels).toMatch(/currency:\s*String\s*=\s*"EUR"/);
  });

  test('G-04 MandatModels MandatSource.currency is decodable', () => {
    expect(mandatModels).toMatch(/currency:\s*String\?/);
  });
});

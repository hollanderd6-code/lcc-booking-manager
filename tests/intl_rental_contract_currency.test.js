'use strict';
/**
 * PMS-INTL-IOS-RENTAL-CONTRACT-CURRENCY-1
 *
 * Static source analysis verifying that rental contracts carry a historical
 * currency snapshot — persisted in contract_data JSONB and surfaced on the
 * iOS detail screen — without touching mandates, reservations, or any
 * unrelated system.
 *
 * Suites:
 *   A — Backend route accepts currency and normalises it
 *   B — contract_data JSONB includes contractType + currency snapshot
 *   C — iOS ContractDetailView tarifsContent uses displayCurrency
 *   D — iOS ContractDetailViewModel rental summaries use displayCurrency
 *   E — Historical immutability: stored currency wins, absent → EUR
 *   F — PDF section 5 and email use rentalSymbol (not hardcoded €)
 *   G — Isolation: mandate route, reservation logic untouched
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(
  path.join(__dirname, '../server.js'), 'utf8'
);

const iosRoot = path.join(__dirname, '../../Boostinghost-ios/Boostinghost');

function readIos(relPath) {
  const abs = path.join(iosRoot, relPath);
  try { return fs.readFileSync(abs, 'utf8'); }
  catch (_) { return ''; }
}

const contractDetailModels  = readIos('Features/Manage/ContractDetailModels.swift');
const contractDetailView    = readIos('Features/Manage/ContractDetailView.swift');
const contractDetailVM      = readIos('Features/Manage/ContractDetailViewModel.swift');
const rentalContractModels  = readIos('Features/Manage/RentalContractModels.swift');

// ── Locate the POST /api/contrat/send route ──────────────────────────────────

const contratSendIdx = serverSrc.indexOf("app.post('/api/contrat/send'");
expect(contratSendIdx).not.toBe(-1);
// Route body is ~350 lines; 22 000 chars covers it entirely
const contratSendBlock = serverSrc.slice(contratSendIdx, contratSendIdx + 22000);

// ── A: Backend route accepts and normalises currency ─────────────────────────

describe('A — Backend: currency accepted and normalised', () => {
  test('A-01 currency is destructured from req.body', () => {
    // currency must appear in the destructuring block (before req.body ends)
    const destructureEnd = contratSendBlock.indexOf('} = req.body;');
    expect(destructureEnd).not.toBe(-1);
    const destructure = contratSendBlock.slice(0, destructureEnd);
    expect(destructure).toMatch(/\bcurrency\b/);
  });

  test('A-02 rentalCurrency uses normalizeCurrency with EUR fallback', () => {
    expect(contratSendBlock).toMatch(/const rentalCurrency\s*=\s*normalizeCurrency\(currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-03 rentalSymbol maps EUR to €', () => {
    expect(contratSendBlock).toMatch(/rentalSymbol\s*=.*EUR.*€/);
  });

  test('A-04 rentalSymbol maps ILS to ₪', () => {
    expect(contratSendBlock).toMatch(/rentalSymbol\s*=.*ILS.*₪/);
  });

  test('A-05 rentalSymbol maps USD to $', () => {
    expect(contratSendBlock).toMatch(/rentalSymbol\s*=.*USD.*\$/);
  });

  test('A-06 rentalSymbol maps CHF to Fr.', () => {
    expect(contratSendBlock).toMatch(/rentalSymbol\s*=.*CHF.*Fr\./);
  });

  test('A-07 normalizeCurrency imported at module level', () => {
    expect(serverSrc).toMatch(/const\s*\{[^}]*normalizeCurrency[^}]*\}\s*=\s*require/);
  });
});

// ── B: contract_data JSONB snapshot ──────────────────────────────────────────

describe('B — Backend: contractData JSONB includes snapshot', () => {
  const contractDataIdx = contratSendBlock.indexOf('const contractData = {');
  let contractDataBlock = '';
  if (contractDataIdx !== -1) {
    contractDataBlock = contratSendBlock.slice(contractDataIdx, contractDataIdx + 600);
  }

  test('B-01 contractData object is present in the route', () => {
    expect(contractDataIdx).not.toBe(-1);
  });

  test('B-02 contractData includes contractType: "location"', () => {
    expect(contractDataBlock).toMatch(/contractType\s*:\s*['"]location['"]/);
  });

  test('B-03 contractData includes currency: rentalCurrency', () => {
    expect(contractDataBlock).toMatch(/currency\s*:\s*rentalCurrency/);
  });

  test('B-04 contractData is persisted via JSON.stringify', () => {
    expect(contratSendBlock).toMatch(/JSON\.stringify\(contractData\)/);
  });

  test('B-05 mandate route still sets contractType: "mandat"', () => {
    const mandatIdx = serverSrc.indexOf("app.post('/api/mandat/send'");
    expect(mandatIdx).not.toBe(-1);
    const mandatBlock = serverSrc.slice(mandatIdx, mandatIdx + 15000);
    expect(mandatBlock).toMatch(/contractType\s*:\s*['"]mandat['"]/);
  });

  test('B-06 mandate route still sets currency: _mandatCurrency', () => {
    const mandatIdx = serverSrc.indexOf("app.post('/api/mandat/send'");
    const mandatBlock = serverSrc.slice(mandatIdx, mandatIdx + 15000);
    expect(mandatBlock).toMatch(/currency\s*:\s*_mandatCurrency/);
  });
});

// ── C: iOS ContractDetailView tarifsContent ──────────────────────────────────

describe('C — iOS ContractDetailView tarifsContent uses displayCurrency', () => {
  test('C-01 file present', () => {
    expect(contractDetailView).not.toBe('');
  });

  test('C-02 tarifsContent no longer contains CURRENCY_SNAPSHOT_MISSING', () => {
    const idx = contractDetailView.indexOf('private func tarifsContent');
    expect(idx).not.toBe(-1);
    const block = contractDetailView.slice(idx, idx + 800);
    expect(block).not.toMatch(/CURRENCY_SNAPSHOT_MISSING/);
  });

  test('C-03 tarifsContent uses currencySymbol (via sym)', () => {
    const idx = contractDetailView.indexOf('private func tarifsContent');
    const block = contractDetailView.slice(idx, idx + 800);
    expect(block).toMatch(/currencySymbol\(for:\s*detail\.displayCurrency\)/);
  });

  test('C-04 tarifsContent totalPrice uses sym (not bare €)', () => {
    const idx = contractDetailView.indexOf('private func tarifsContent');
    const block = contractDetailView.slice(idx, idx + 800);
    expect(block).toMatch(/totalPrice.*\\\(sym\)|\\\(sym\).*totalPrice/s);
    expect(block).not.toMatch(/\\u\{202F\}€/);
  });

  test('C-05 tarifsContent deposit uses sym', () => {
    const idx = contractDetailView.indexOf('private func tarifsContent');
    const block = contractDetailView.slice(idx, idx + 800);
    expect(block).toMatch(/deposit.*\\\(sym\)|\\\(sym\).*deposit/s);
  });

  test('C-06 tarifsContent cleaningFee uses sym', () => {
    const idx = contractDetailView.indexOf('private func tarifsContent');
    const block = contractDetailView.slice(idx, idx + 1000);
    expect(block).toMatch(/cleaningFee.*\\\(sym\)|\\\(sym\).*cleaningFee/s);
  });
});

// ── D: iOS ContractDetailViewModel rental summaries ──────────────────────────

describe('D — iOS ContractDetailViewModel rental summaries', () => {
  test('D-01 file present', () => {
    expect(contractDetailVM).not.toBe('');
  });

  test('D-02 rentalPriceSummary no longer contains CURRENCY_SNAPSHOT_MISSING', () => {
    const idx = contractDetailVM.indexOf('var rentalPriceSummary');
    expect(idx).not.toBe(-1);
    const block = contractDetailVM.slice(Math.max(0, idx - 200), idx + 20);
    expect(block).not.toMatch(/CURRENCY_SNAPSHOT_MISSING/);
  });

  test('D-03 rentalPriceSummary uses currencySymbol(for: displayCurrency)', () => {
    const idx = contractDetailVM.indexOf('var rentalPriceSummary');
    const block = contractDetailVM.slice(idx, idx + 300);
    expect(block).toMatch(/currencySymbol\(for:\s*detail\?\.displayCurrency/);
  });

  test('D-04 rentalPriceSummary uses sym (not bare €)', () => {
    const idx = contractDetailVM.indexOf('var rentalPriceSummary');
    const block = contractDetailVM.slice(idx, idx + 300);
    expect(block).toMatch(/\\\(sym\)/);
    expect(block).not.toMatch(/\\u\{202F\}€/);
  });

  test('D-05 rentalDepositSummary no longer contains CURRENCY_SNAPSHOT_MISSING', () => {
    const idx = contractDetailVM.indexOf('var rentalDepositSummary');
    expect(idx).not.toBe(-1);
    const block = contractDetailVM.slice(Math.max(0, idx - 200), idx + 20);
    expect(block).not.toMatch(/CURRENCY_SNAPSHOT_MISSING/);
  });

  test('D-06 rentalDepositSummary uses currencySymbol(for: displayCurrency)', () => {
    const idx = contractDetailVM.indexOf('var rentalDepositSummary');
    const block = contractDetailVM.slice(idx, idx + 300);
    expect(block).toMatch(/currencySymbol\(for:\s*detail\?\.displayCurrency/);
  });

  test('D-07 rentalDepositSummary uses sym (not bare €)', () => {
    const idx = contractDetailVM.indexOf('var rentalDepositSummary');
    const block = contractDetailVM.slice(idx, idx + 300);
    expect(block).toMatch(/\\\(sym\)/);
    expect(block).not.toMatch(/\\u\{202F\}€/);
  });
});

// ── E: Historical immutability ────────────────────────────────────────────────

describe('E — Historical immutability: stored currency wins', () => {
  test('E-01 displayCurrency reads from contractData.currency (not property-level)', () => {
    // ContractDetail.displayCurrency must use contractData?.currency, not a property field
    expect(contractDetailModels).toMatch(/normalizeCurrency\(contractData\?\.currency\)/);
  });

  test('E-02 displayCurrency falls back to EUR when currency absent (nil → normalizeCurrency → EUR)', () => {
    // normalizeCurrency(nil) returns "EUR" — verified in the utility itself
    // Here we check the call site does not add a separate override
    const idx = contractDetailModels.indexOf('var displayCurrency');
    const block = contractDetailModels.slice(idx, idx + 200);
    // Must call normalizeCurrency — the function handles nil/empty → EUR
    expect(block).toMatch(/normalizeCurrency/);
    // Must NOT bypass it with a hardcoded fallback string after the call
    expect(block).not.toMatch(/normalizeCurrency.*\?\?\s*"EUR"/);
  });

  test('E-03 RentalContractModels.swift exists', () => {
    expect(rentalContractModels).not.toBe('');
  });

  test('E-04 RentalContractDraft derives currency from property at init time', () => {
    expect(rentalContractModels).toMatch(/init\(property:/);
    expect(rentalContractModels).toMatch(/normalizeCurrency\(prop\.currency\)/);
  });

  test('E-05 RentalContractSendBody carries currency field', () => {
    expect(rentalContractModels).toMatch(/struct RentalContractSendBody/);
    expect(rentalContractModels).toMatch(/let currency:\s*String/);
  });

  test('E-06 RentalContractDraft default currency is EUR', () => {
    expect(rentalContractModels).toMatch(/var currency:\s*String\s*=\s*"EUR"/);
  });
});

// ── F: PDF section 5 and email use rentalSymbol ───────────────────────────────

describe('F — PDF and email use rentalSymbol', () => {
  // Extract PDF section 5 from the route block
  const pdfSection5Idx = contratSendBlock.indexOf('5. CONDITIONS FINANCIÈRES');
  let pdfSection5 = '';
  if (pdfSection5Idx !== -1) {
    pdfSection5 = contratSendBlock.slice(pdfSection5Idx, pdfSection5Idx + 600);
  }

  test('F-01 PDF section 5 is present in the route', () => {
    expect(pdfSection5Idx).not.toBe(-1);
  });

  test('F-02 PDF totalPrice row uses rentalSymbol (not bare €)', () => {
    expect(pdfSection5).toMatch(/totalPrice.*rentalSymbol|rentalSymbol.*totalPrice/s);
    expect(pdfSection5).not.toMatch(/toFixed\(2\)\s*}\s*€/);
  });

  test('F-03 PDF cleaningFee row uses rentalSymbol', () => {
    expect(pdfSection5).toMatch(/cleaningFee.*rentalSymbol|rentalSymbol.*cleaningFee/s);
  });

  test('F-04 PDF deposit row uses rentalSymbol', () => {
    expect(pdfSection5).toMatch(/deposit.*rentalSymbol|rentalSymbol.*deposit/s);
  });

  test('F-05 email body uses rentalSymbol for loyer total', () => {
    const emailIdx = contratSendBlock.indexOf('label: \'Loyer total\'');
    expect(emailIdx).not.toBe(-1);
    const emailBlock = contratSendBlock.slice(emailIdx, emailIdx + 200);
    expect(emailBlock).toMatch(/rentalSymbol/);
    expect(emailBlock).not.toMatch(/toFixed\(2\)\s*}\s*€/);
  });

  test('F-06 email body uses rentalSymbol for dépôt de garantie', () => {
    const emailIdx = contratSendBlock.indexOf("label: 'Dépôt de garantie'");
    expect(emailIdx).not.toBe(-1);
    const emailBlock = contratSendBlock.slice(emailIdx, emailIdx + 200);
    expect(emailBlock).toMatch(/rentalSymbol/);
  });
});

// ── G: Isolation — mandate, reservations, unrelated code untouched ────────────

describe('G — Isolation: mandate and unrelated code untouched', () => {
  test('G-01 mandate route still defines _mandatCurrency (not renamed)', () => {
    const mandatIdx = serverSrc.indexOf("app.post('/api/mandat/send'");
    const mandatBlock = serverSrc.slice(mandatIdx, mandatIdx + 15000);
    expect(mandatBlock).toMatch(/_mandatCurrency/);
  });

  test('G-02 mandate route still defines _mandatSymbol', () => {
    const mandatIdx = serverSrc.indexOf("app.post('/api/mandat/send'");
    const mandatBlock = serverSrc.slice(mandatIdx, mandatIdx + 15000);
    expect(mandatBlock).toMatch(/_mandatSymbol/);
  });

  test('G-03 MandatCreationView.swift freeExtraRow still uses currencySymbol(for: draft.currency)', () => {
    const mandatCreationSrc = readIos('Features/Manage/MandatCreationView.swift');
    const idx = mandatCreationSrc.indexOf('private func freeExtraRow');
    expect(idx).not.toBe(-1);
    const block = mandatCreationSrc.slice(idx, idx + 1200);
    expect(block).toMatch(/currencySymbol\(for:\s*draft\.currency\)/);
  });

  test('G-04 ContractDetailViewModel commissionSummary still uses displayCurrency', () => {
    const idx = contractDetailVM.indexOf('var commissionSummary');
    expect(idx).not.toBe(-1);
    const block = contractDetailVM.slice(idx, idx + 600);
    expect(block).toMatch(/displayCurrency/);
  });

  test('G-05 rentalCurrency is not used in the mandate route (no leak)', () => {
    const mandatIdx = serverSrc.indexOf("app.post('/api/mandat/send'");
    const mandatBlock = serverSrc.slice(mandatIdx, mandatIdx + 15000);
    expect(mandatBlock).not.toMatch(/rentalCurrency/);
  });

  test('G-06 UpsellSheet.swift still has INTENTIONALLY_EUR on Text("€")', () => {
    const upsellSrc = readIos('Features/Upsell/UpsellSheet.swift');
    const idx = upsellSrc.indexOf('Text("€")');
    expect(idx).not.toBe(-1);
    const block = upsellSrc.slice(Math.max(0, idx - 300), idx + 20);
    expect(block).toMatch(/INTENTIONALLY_EUR/);
  });

  test('G-07 No new bare \\u{202F}€ introduced in tarifsContent or rental summaries', () => {
    const tarifsIdx = contractDetailView.indexOf('private func tarifsContent');
    const tarifsBlock = contractDetailView.slice(tarifsIdx, tarifsIdx + 800);
    expect(tarifsBlock).not.toMatch(/\\u\{202F\}€/);

    const priceIdx = contractDetailVM.indexOf('var rentalPriceSummary');
    const priceBlock = contractDetailVM.slice(priceIdx, priceIdx + 300);
    expect(priceBlock).not.toMatch(/\\u\{202F\}€/);

    const depositIdx = contractDetailVM.indexOf('var rentalDepositSummary');
    const depositBlock = contractDetailVM.slice(depositIdx, depositIdx + 300);
    expect(depositBlock).not.toMatch(/\\u\{202F\}€/);
  });
});

'use strict';
/**
 * INTL-4.6 — Frontend Owner Invoices Internationalization
 *
 * Structural checks: reads public/factures-proprietaires.html and verifies
 * that all owner-invoice money formatting, date formatting, legal identifier
 * labels, tax labels, vat-exempt labels, and payment terms are currency-aware
 * and locale-aware via the new helpers.
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../public/factures-proprietaires.html'),
  'utf8'
);

// ── helpers ──────────────────────────────────────────────────────────────────
// Extract specific function bodies for scoped assertions
const fmBlock  = src.match(/function formatOwnerInvoiceMoney[\s\S]+?^  }/m)?.[0] || '';
const ctxBlock = src.match(/function getOwnerInvoiceDisplayContext[\s\S]+?^  }/m)?.[0] || '';
const previewBlock = src.match(/window\.updatePreview\s*=\s*function[\s\S]+?^  };/m)?.[0] || '';
const dlBlock  = src.match(/window\.downloadOwnerInvoice\s*=\s*async function[\s\S]+?^  };/m)?.[0] || '';
const createBlock = src.match(/window\.createNewInvoice\s*=\s*function[\s\S]+?^  };/m)?.[0] || '';
const editBlock   = src.match(/window\.editOwnerInvoiceDraft\s*=\s*async function[\s\S]+?^};/m)?.[0] || '';
const viewBlock   = src.match(/window\.viewOwnerInvoiceReadOnly\s*=\s*async function[\s\S]+?^};/m)?.[0] || '';
const senderBlock = src.match(/function updateSenderAddressFromProfile[\s\S]+?^  }/m)?.[0] || '';
const renderEd    = src.match(/function renderEditorPrestations[\s\S]+?^  }/m)?.[0] || '';
const updatePrest = src.match(/window\.updatePrestation\s*=\s*function[\s\S]+?^};/m)?.[0] || '';
const profileBlock = src.match(/async function loadUserProfile[\s\S]+?^}/m)?.[0] || '';
const renderGrid  = src.match(/function renderFpGrid[\s\S]+?^}/m)?.[0] || '';

// ── A: formatOwnerInvoiceMoney helper ────────────────────────────────────────
describe('A — formatOwnerInvoiceMoney helper', () => {
  test('A-01 function defined', () => {
    expect(src).toMatch(/function formatOwnerInvoiceMoney\(/);
  });

  test('A-02 uses Intl.NumberFormat with style currency', () => {
    expect(fmBlock).toMatch(/Intl\.NumberFormat/);
    expect(fmBlock).toMatch(/style:\s*['"]currency['"]/);
  });

  test('A-03 validates currency with /^[A-Z]{3}$/', () => {
    expect(fmBlock).toMatch(/\[A-Z\]\{3\}/);
  });

  test('A-04 validates locale with /^[a-z]{2}-[A-Z]{2}$/', () => {
    expect(fmBlock).toMatch(/\[a-z\]\{2\}-\[A-Z\]\{2\}/);
  });

  test('A-05 falls back to EUR/fr-FR on error', () => {
    expect(fmBlock).toMatch(/EUR/);
    expect(fmBlock).toMatch(/fr-FR/);
  });

  test('A-06 has catch block for safety', () => {
    expect(fmBlock).toMatch(/catch\s*\(/);
  });
});

// ── B: getOwnerInvoiceDisplayContext helper ───────────────────────────────────
describe('B — getOwnerInvoiceDisplayContext helper', () => {
  test('B-01 function defined', () => {
    expect(src).toMatch(/function getOwnerInvoiceDisplayContext\(/);
  });

  test('B-02 reads window.userProfile', () => {
    expect(ctxBlock).toMatch(/window\.userProfile/);
  });

  test('B-03 existing invoice branch uses invoice.currency', () => {
    expect(ctxBlock).toMatch(/invoice\.currency/);
  });

  test('B-04 new invoice branch uses profile.defaultCurrency', () => {
    expect(ctxBlock).toMatch(/prof\.defaultCurrency/);
  });

  test('B-05 validates locale format', () => {
    expect(ctxBlock).toMatch(/\[a-z\]\{2\}-\[A-Z\]\{2\}/);
  });

  test('B-06 reads tax_label from invoice', () => {
    expect(ctxBlock).toMatch(/invoice\.tax_label/);
  });

  test('B-07 reads vat_exempt_label from invoice', () => {
    expect(ctxBlock).toMatch(/invoice\.vat_exempt_label/);
  });

  test('B-08 returns taxLabel defaulting to TVA', () => {
    expect(ctxBlock).toMatch(/taxLabel.*TVA/);
  });

  test('B-09 returns vatExemptLabel (null for new invoice)', () => {
    expect(ctxBlock).toMatch(/vatExemptLabel/);
  });

  test('B-10 handles issuer_snapshot string parse', () => {
    expect(ctxBlock).toMatch(/JSON\.parse/);
  });

  test('B-11 legalLabel reads from snapshot legalIdentifierLabel', () => {
    expect(ctxBlock).toMatch(/legalIdentifierLabel/);
  });

  test('B-12 legalValue reads from snapshot legalIdentifierValue or siret', () => {
    expect(ctxBlock).toMatch(/legalIdentifierValue/);
  });

  test('B-13 country from profile', () => {
    expect(ctxBlock).toMatch(/prof\.country/);
  });

  test('B-14 returns all required keys', () => {
    expect(ctxBlock).toMatch(/currency/);
    expect(ctxBlock).toMatch(/locale/);
    expect(ctxBlock).toMatch(/legalLabel/);
    expect(ctxBlock).toMatch(/legalValue/);
    expect(ctxBlock).toMatch(/taxLabel/);
    expect(ctxBlock).toMatch(/vatExemptLabel/);
    expect(ctxBlock).toMatch(/country/);
  });
});

// ── C: _invoiceCtx global ────────────────────────────────────────────────────
describe('C — _invoiceCtx global variable', () => {
  test('C-01 declared as let', () => {
    expect(src).toMatch(/let _invoiceCtx\s*=/);
  });

  test('C-02 default currency EUR', () => {
    expect(src).toMatch(/let _invoiceCtx\s*=\s*\{[^}]*currency:\s*'EUR'/);
  });

  test('C-03 default locale fr-FR', () => {
    expect(src).toMatch(/let _invoiceCtx\s*=\s*\{[^}]*locale:\s*'fr-FR'/);
  });

  test('C-04 default taxLabel TVA', () => {
    expect(src).toMatch(/let _invoiceCtx\s*=\s*\{[^}]*taxLabel:\s*'TVA'/);
  });
});

// ── D: DOMContentLoaded initialization ───────────────────────────────────────
describe('D — DOMContentLoaded initializes _invoiceCtx', () => {
  const domBlock = src.match(/document\.addEventListener\('DOMContentLoaded'[\s\S]+?^\}\)/m)?.[0] || '';

  test('D-01 _invoiceCtx initialized in DOMContentLoaded', () => {
    expect(domBlock).toMatch(/_invoiceCtx\s*=\s*getOwnerInvoiceDisplayContext\(null\)/);
  });

  test('D-02 initialized after loadEmitterProfile', () => {
    const idx1 = domBlock.indexOf('loadEmitterProfile()');
    const idx2 = domBlock.indexOf('_invoiceCtx = getOwnerInvoiceDisplayContext(null)');
    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
  });
});

// ── E: updatePreview — locale-aware dates ─────────────────────────────────────
describe('E — updatePreview locale-aware dates', () => {
  test('E-01 toLocaleDateString uses _invoiceCtx.locale', () => {
    expect(previewBlock).toMatch(/toLocaleDateString\(_invoiceCtx\.locale\)/);
  });

  test('E-02 no hardcoded toLocaleDateString(\'fr-FR\') in updatePreview', () => {
    expect(previewBlock).not.toMatch(/toLocaleDateString\('fr-FR'\)/);
  });
});

// ── F: updatePreview — currency-aware amounts ─────────────────────────────────
describe('F — updatePreview currency-aware amounts', () => {
  test('F-01 uses formatOwnerInvoiceMoney for rentalAmount', () => {
    expect(previewBlock).toMatch(/formatOwnerInvoiceMoney\(.*rentalAmount/);
  });

  test('F-02 uses formatOwnerInvoiceMoney for unitPrice', () => {
    expect(previewBlock).toMatch(/formatOwnerInvoiceMoney\(.*unitPrice/);
  });

  test('F-03 uses formatOwnerInvoiceMoney for lineTotal', () => {
    expect(previewBlock).toMatch(/formatOwnerInvoiceMoney\(lineTotal/);
  });

  test('F-04 uses formatOwnerInvoiceMoney for totalHT', () => {
    expect(previewBlock).toMatch(/formatOwnerInvoiceMoney\(totalHT/);
  });

  test('F-05 uses formatOwnerInvoiceMoney for vatAmount', () => {
    expect(previewBlock).toMatch(/formatOwnerInvoiceMoney\(vatAmount/);
  });

  test('F-06 uses formatOwnerInvoiceMoney for totalTTC', () => {
    expect(previewBlock).toMatch(/formatOwnerInvoiceMoney\(totalTTC/);
  });

  test('F-07 passes _invoiceCtx.currency to formatOwnerInvoiceMoney', () => {
    expect(previewBlock).toMatch(/_invoiceCtx\.currency/);
  });

  test('F-08 passes _invoiceCtx.locale to formatOwnerInvoiceMoney', () => {
    expect(previewBlock).toMatch(/_invoiceCtx\.locale/);
  });

  test('F-09 no hardcoded .toFixed(2) + \' €\' in updatePreview', () => {
    expect(previewBlock).not.toMatch(/\.toFixed\(2\)\s*\+\s*'[^']*€/);
  });
});

// ── G: updatePreview — taxLabel dynamic ───────────────────────────────────────
describe('G — updatePreview taxLabel dynamic', () => {
  test('G-01 reads _invoiceCtx.taxLabel', () => {
    expect(previewBlock).toMatch(/_invoiceCtx\.taxLabel/);
  });

  test('G-02 updates previewVatLabel element', () => {
    expect(previewBlock).toMatch(/previewVatLabel/);
  });

  test('G-03 updates displayVatLabel element', () => {
    expect(previewBlock).toMatch(/displayVatLabel/);
  });

  test('G-04 HTML has id previewVatLabel', () => {
    expect(src).toMatch(/id="previewVatLabel"/);
  });

  test('G-05 HTML has id displayVatLabel', () => {
    expect(src).toMatch(/id="displayVatLabel"/);
  });
});

// ── H: updatePreview — vatExemptLabel dynamic ────────────────────────────────
describe('H — updatePreview vatExemptLabel dynamic', () => {
  test('H-01 reads _invoiceCtx.vatExemptLabel', () => {
    expect(previewBlock).toMatch(/_invoiceCtx\.vatExemptLabel/);
  });

  test('H-02 sets mentionEl.textContent dynamically', () => {
    expect(previewBlock).toMatch(/mentionEl\.textContent\s*=/);
  });

  test('H-03 falls back to 293 B mention for FR', () => {
    expect(previewBlock).toMatch(/293 B du CGI/);
  });
});

// ── I: downloadOwnerInvoice — full i18n ──────────────────────────────────────
describe('I — downloadOwnerInvoice i18n', () => {
  test('I-01 builds _dlCtx via getOwnerInvoiceDisplayContext', () => {
    expect(dlBlock).toMatch(/getOwnerInvoiceDisplayContext\(inv\)/);
  });

  test('I-02 uses formatOwnerInvoiceMoney with _dlCtx for item totals', () => {
    expect(dlBlock).toMatch(/formatOwnerInvoiceMoney\(.*_dlCtx\.currency.*_dlCtx\.locale\)/s);
  });

  test('I-03 dates use _dlCtx.locale', () => {
    expect(dlBlock).toMatch(/formatDate\(.*_dlCtx\.locale\)/);
  });

  test('I-04 payment terms from invoice fields', () => {
    expect(dlBlock).toMatch(/inv\.payment_delay/);
    expect(dlBlock).toMatch(/inv\.payment_mode/);
    expect(dlBlock).toMatch(/inv\.late_interest/);
  });

  test('I-05 no hardcoded 30 jours', () => {
    expect(dlBlock).not.toMatch(/'30 jours'/);
  });

  test('I-06 no hardcoded Virement bancaire', () => {
    expect(dlBlock).not.toMatch(/'Virement bancaire'/);
  });

  test('I-07 no hardcoded country France', () => {
    expect(dlBlock).not.toMatch(/'France'/);
  });

  test('I-08 legal label uses _dlCtx.legalLabel', () => {
    expect(dlBlock).toMatch(/_dlCtx\.legalLabel/);
  });

  test('I-09 no hardcoded \'SIRET : \' string', () => {
    expect(dlBlock).not.toMatch(/'SIRET : '/);
  });

  test('I-10 uses escHtml for user-controlled content', () => {
    expect(dlBlock).toMatch(/escHtml\(/);
  });

  test('I-11 totals use _dlCtx currency/locale', () => {
    expect(dlBlock).toMatch(/formatOwnerInvoiceMoney\(subtotal/);
    expect(dlBlock).toMatch(/formatOwnerInvoiceMoney\(vatAmount/);
    expect(dlBlock).toMatch(/formatOwnerInvoiceMoney\(totalTtc/);
  });

  test('I-12 vat exempt label uses _dlCtx.vatExemptLabel', () => {
    expect(dlBlock).toMatch(/_dlVatExempt/);
  });

  test('I-13 tax label uses _dlCtx.taxLabel', () => {
    expect(dlBlock).toMatch(/_dlTaxLabel/);
  });
});

// ── J: Legal identifier label ─────────────────────────────────────────────────
describe('J — Legal identifier label dynamic', () => {
  test('J-01 emitterSiretLabel has id in HTML', () => {
    expect(src).toMatch(/id="emitterSiretLabel"/);
  });

  test('J-02 loadUserProfile updates emitterSiretLabel', () => {
    expect(profileBlock).toMatch(/emitterSiretLabel/);
    expect(profileBlock).toMatch(/legalIdentifierLabel/);
  });

  test('J-03 updateSenderAddressFromProfile uses _invoiceCtx.legalLabel', () => {
    expect(senderBlock).toMatch(/_invoiceCtx\.legalLabel/);
  });

  test('J-04 updateSenderAddressFromProfile no hardcoded \'SIRET : \'', () => {
    expect(senderBlock).not.toMatch(/'SIRET : '/);
  });
});

// ── K: _invoiceCtx set on open/edit/view ─────────────────────────────────────
describe('K — _invoiceCtx set when opening invoices', () => {
  test('K-01 createNewInvoice sets _invoiceCtx with null (new invoice)', () => {
    expect(createBlock).toMatch(/_invoiceCtx\s*=\s*getOwnerInvoiceDisplayContext\(null\)/);
  });

  test('K-02 editOwnerInvoiceDraft sets _invoiceCtx from invoice', () => {
    expect(editBlock).toMatch(/_invoiceCtx\s*=\s*getOwnerInvoiceDisplayContext\(inv\)/);
  });

  test('K-03 viewOwnerInvoiceReadOnly sets _invoiceCtx from invoice', () => {
    expect(viewBlock).toMatch(/_invoiceCtx\s*=\s*getOwnerInvoiceDisplayContext\(inv\)/);
  });
});

// ── L: Existing invoice immutability ─────────────────────────────────────────
describe('L — Existing invoice currency/locale immutability', () => {
  test('L-01 getOwnerInvoiceDisplayContext prioritises invoice.currency over profile', () => {
    // When invoice.currency is set, it comes first in the branch
    const invBranch = ctxBlock.match(/if \(invoice && invoice\.currency\)[\s\S]+?return {[^}]+}/)?.[0] || '';
    expect(invBranch).toMatch(/const currency = invoice\.currency/);
  });

  test('L-02 new invoice falls back to profile.defaultCurrency', () => {
    expect(ctxBlock).toMatch(/prof\.defaultCurrency/);
  });

  test('L-03 existing invoice locale from invoice.locale first', () => {
    const invBranch = ctxBlock.match(/if \(invoice && invoice\.currency\)[\s\S]+?return {[^}]+}/)?.[0] || '';
    expect(invBranch).toMatch(/invoice\.locale/);
  });

  test('L-04 new invoice locale from prof.locale', () => {
    expect(ctxBlock).toMatch(/prof\.locale/);
  });
});

// ── M: Regression — no new hardcoded FR-only patterns ────────────────────────
describe('M — Regression: no new FR-only hardcodes in owner invoice contexts', () => {
  test('M-01 renderFpGrid uses formatOwnerInvoiceMoney, not formatMoney', () => {
    expect(renderGrid).toMatch(/formatOwnerInvoiceMoney/);
    expect(renderGrid).not.toMatch(/formatMoney\(/);
  });

  test('M-02 renderEditorPrestations uses formatOwnerInvoiceMoney', () => {
    expect(renderEd).toMatch(/formatOwnerInvoiceMoney/);
  });

  test('M-03 updatePrestation uses formatOwnerInvoiceMoney', () => {
    expect(updatePrest).toMatch(/formatOwnerInvoiceMoney/);
  });

  test('M-04 escHtml defined globally', () => {
    expect(src).toMatch(/function escHtml\s*\(/);
  });

  test('M-05 escHtml escapes & < > "', () => {
    const escBlock = src.match(/function escHtml[\s\S]+?^  }/m)?.[0] || '';
    expect(escBlock).toMatch(/&amp;/);
    expect(escBlock).toMatch(/&lt;/);
    expect(escBlock).toMatch(/&gt;/);
    expect(escBlock).toMatch(/&quot;/);
  });

  test('M-06 formatMoney no longer called anywhere', () => {
    // All formatMoney callers should be gone
    const callSites = src.match(/formatMoney\(/g) || [];
    // Only the function definition itself may appear
    expect(callSites.length).toBeLessThanOrEqual(1);
  });

  test('M-07 no .toFixed(2) + \' €\' outside formatMoney definition', () => {
    // Count all instances of .toFixed(2)[.replace(...)] + ' €' — only the one in formatMoney allowed
    const pattern = /\.toFixed\(2\)(?:\.replace\([^)]+\))?\s*\+\s*' €'/g;
    const allMatches = src.match(pattern) || [];
    expect(allMatches.length).toBeLessThanOrEqual(1);
  });

  test('M-08 no toLocaleDateString with literal \'fr-FR\' in preview/download', () => {
    expect(previewBlock).not.toMatch(/toLocaleDateString\('fr-FR'\)/);
    expect(dlBlock).not.toMatch(/toLocaleDateString\('fr-FR'\)/);
  });
});

// ── INTL-4.6R corrections ─────────────────────────────────────────────────────

const createInvoiceBlock = src.match(/window\.createInvoice\s*=\s*async function[\s\S]+?^  };/m)?.[0] || '';
const resolveBlock = src.match(/function resolveSelectedPropertyCurrency[\s\S]+?^}/m)?.[0] || '';

// ── N: No static EUR placeholders ────────────────────────────────────────────
describe('N — No static EUR placeholders', () => {
  test('N-01 statsRevenue initial value is not a EUR amount', () => {
    expect(src).not.toMatch(/id="statsRevenue"[^>]*>0[,.]00\s*€/);
  });

  test('N-02 statsPending initial value is not a EUR amount', () => {
    expect(src).not.toMatch(/id="statsPending"[^>]*>0[,.]00\s*€/);
  });

  test('N-03 displayTotalHT/VAT/TTC do not contain 0.00 €', () => {
    expect(src).not.toMatch(/id="displayTotalHT"[^>]*>0\.00\s*€/);
    expect(src).not.toMatch(/id="displayTotalVAT"[^>]*>0\.00\s*€/);
    expect(src).not.toMatch(/id="displayTotalTTC"[^>]*>0\.00\s*€/);
  });

  test('N-04 previewTotalHT/VAT/TTC do not contain 0,00 €', () => {
    expect(src).not.toMatch(/id="previewTotalHT"[^>]*>0,00\s*€/);
    expect(src).not.toMatch(/id="previewTotalVAT"[^>]*>0,00\s*€/);
    expect(src).not.toMatch(/id="previewTotalTTC"[^>]*>0,00\s*€/);
  });

  test('N-05 previewVatLegalMention contains no static 293B text', () => {
    const mentionMatch = src.match(/id="previewVatLegalMention"[^>]*>([\s\S]*?)<\/div>/);
    const content = mentionMatch ? mentionMatch[1].trim() : '';
    expect(content).toBe('');
  });
});

// ── O: Property currency guard ────────────────────────────────────────────────
describe('O — Property currency guard', () => {
  test('O-01 resolveSelectedPropertyCurrency function defined', () => {
    expect(src).toMatch(/function resolveSelectedPropertyCurrency\s*\(/);
  });

  test('O-02 returns object with valid/currency/reason/message', () => {
    expect(resolveBlock).toMatch(/valid\s*:/);
    expect(resolveBlock).toMatch(/currency\s*:/);
    expect(resolveBlock).toMatch(/reason\s*:/);
    expect(resolveBlock).toMatch(/message\s*:/);
  });

  test('O-03 detects mixed currencies (currencies.size > 1) as invalid', () => {
    expect(resolveBlock).toMatch(/currencies\.size/);
    expect(resolveBlock).toMatch(/valid\s*:\s*false/);
  });

  test('O-04 propertyCurrencyError div exists in HTML', () => {
    expect(src).toMatch(/id="propertyCurrencyError"/);
  });

  test('O-05 updatePreview calls resolveSelectedPropertyCurrency', () => {
    expect(previewBlock).toMatch(/resolveSelectedPropertyCurrency\s*\(\s*\)/);
  });

  test('O-06 createInvoice calls resolveSelectedPropertyCurrency guard', () => {
    expect(createInvoiceBlock).toMatch(/resolveSelectedPropertyCurrency\s*\(\s*\)/);
  });
});

// ── P: Draft property changes ─────────────────────────────────────────────────
describe('P — Draft property changes', () => {
  test('P-01 _invoiceCtxBase global declared', () => {
    expect(src).toMatch(/let\s+_invoiceCtxBase\s*=/);
  });

  test('P-02 createNewInvoice sets _invoiceCtxBase', () => {
    expect(createBlock).toMatch(/_invoiceCtxBase\s*=\s*\{/);
  });

  test('P-03 editOwnerInvoiceDraft sets _invoiceCtxBase', () => {
    expect(editBlock).toMatch(/_invoiceCtxBase\s*=\s*\{/);
  });

  test('P-04 viewOwnerInvoiceReadOnly sets _invoiceCtxBase', () => {
    expect(viewBlock).toMatch(/_invoiceCtxBase\s*=\s*\{/);
  });

  test('P-05 DOMContentLoaded sets _invoiceCtxBase after init', () => {
    const domBlock = src.match(/document\.addEventListener\('DOMContentLoaded'[\s\S]+?\}\s*\)\s*;/)?.[0] || '';
    expect(domBlock).toMatch(/_invoiceCtxBase\s*=\s*\{/);
  });

  test('P-06 updatePreview uses _invoiceCtxBase to restore context', () => {
    expect(previewBlock).toMatch(/_invoiceCtxBase/);
  });
});

// ── Q: Legal identifier label country-awareness ───────────────────────────────
describe('Q — Legal identifier label country-awareness', () => {
  test('Q-01 getOwnerInvoiceDisplayContext uses invoice.country for existing invoice', () => {
    expect(ctxBlock).toMatch(/invoice\.country/);
  });

  test('Q-02 _isFrLegal guard present in getOwnerInvoiceDisplayContext', () => {
    expect(ctxBlock).toMatch(/_isFrLegal/);
  });

  test('Q-03 _isFrProf guard present in getOwnerInvoiceDisplayContext', () => {
    expect(ctxBlock).toMatch(/_isFrProf/);
  });

  test('Q-04 updateSenderAddressFromProfile does not hardcode SIRET label', () => {
    expect(senderBlock).not.toMatch(/\|\|\s*['"]SIRET['"]/);
  });

  test('Q-05 updateSenderAddressFromProfile uses _invoiceCtx.legalLabel', () => {
    expect(senderBlock).toMatch(/_invoiceCtx\.legalLabel/);
  });

  test('Q-06 downloadOwnerInvoice does not fall back to SIRET string', () => {
    expect(dlBlock).not.toMatch(/\|\|\s*['"]SIRET['"]/);
  });

  test('Q-07 downloadOwnerInvoice uses _dlCtx.legalLabel without fallback', () => {
    expect(dlBlock).toMatch(/_dlCtx\.legalLabel/);
  });
});

// ── R: 293B static/dynamic ────────────────────────────────────────────────────
describe('R — 293B rendering', () => {
  test('R-01 previewVatLegalMention div initially empty', () => {
    const mentionMatch = src.match(/id="previewVatLegalMention"[^>]*>([\s\S]*?)<\/div>/);
    const content = mentionMatch ? mentionMatch[1].trim() : 'NOT_FOUND';
    expect(content).toBe('');
  });

  test('R-02 updatePreview uses vatExemptLabel from _invoiceCtx', () => {
    expect(previewBlock).toMatch(/_invoiceCtx\.vatExemptLabel/);
  });

  test('R-03 updatePreview checks _isFrCtx before showing 293B', () => {
    expect(previewBlock).toMatch(/_isFrCtx/);
  });

  test('R-04 downloadOwnerInvoice uses _dlIsFr guard for 293B', () => {
    expect(dlBlock).toMatch(/_dlIsFr/);
  });
});

// ── S: VAT default and Loyer label ────────────────────────────────────────────
describe('S — VAT default and Loyer label', () => {
  test('S-01 createNewInvoice does not hardcode invoiceVatRate to 20 unconditionally', () => {
    expect(createBlock).not.toMatch(/invoiceVatRate'?\]\.value\s*=\s*20\s*;/);
  });

  test('S-02 createNewInvoice has country-aware VAT default', () => {
    expect(createBlock).toMatch(/_isNewFr/);
  });

  test('S-03 renderEditorPrestations uses _invoiceCtx.currency in Loyer label', () => {
    expect(renderEd).toMatch(/_invoiceCtx\.currency/);
  });

  test('S-04 renderEditorPrestations does not hardcode Loyer (€)', () => {
    expect(renderEd).not.toMatch(/Loyer\s*\(€\)/);
  });
});

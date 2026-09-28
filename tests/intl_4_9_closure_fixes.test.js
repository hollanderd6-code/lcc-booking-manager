'use strict';
/**
 * INTL-4.9 — Final Internationalization Correctness Fixes
 *
 * Structural checks covering:
 * A–B.  GET /api/owner-invoices list API exposes stored currency + locale
 * C–E.  Invoice card display uses inv.currency / inv.locale
 * F–H.  Cross-currency stats aggregation (no cross-currency addition)
 * I–J.  Tax label: no global 'TVA' assumption; FR legacy preserved
 * K–L.  PATH A PDF: no fabricated SIRET / N° TVA
 * M–N.  PATH B email PDF: no fabricated SIRET / N° TVA
 * O–P.  sendOwnerInvoiceEmail: currency/locale-aware amounts + dates
 * Q.    Credit-note context snapshot invariant
 * R.    No FX / currency conversion
 * S.    Historical invoice stored values remain authoritative
 */

const fs   = require('fs');
const path = require('path');

const srv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const fe  = fs.readFileSync(path.join(__dirname, '../public/factures-proprietaires.html'), 'utf8');

// ── Extract key blocks ────────────────────────────────────────────────────────
// Use line-number anchored slices to avoid cross-block contamination on a large file.

// GET /api/owner-invoices: find the two SELECT branches directly by their unique anchors
const listApiLines = srv.split('\n').slice(
  srv.split('\n').findIndex(l => l.includes("app.get('/api/owner-invoices'")),
  srv.split('\n').findIndex(l => l.includes("app.get('/api/owner-invoices/'"))
    || srv.split('\n').findIndex(l => l.includes('resolveOwnerInvoiceContext'))
);
const listApiText = listApiLines.join('\n');

const postInv     = srv.match(/app\.post\('\/api\/owner-invoices'[\s\S]+?^\}\);/m)?.[0] || '';
const pathABlock  = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/pdf'[\s\S]+?^\}\);/m)?.[0] || '';
const pathBFn     = srv.match(/async function sendOwnerInvoiceEmail[\s\S]+?^}/m)?.[0] || '';
const csvBlock    = srv.match(/EXPORT COMPTABLE — FACTURES PROPRIETAIRES CSV[\s\S]+?res\.send\(\s*'\\uFEFF'[\s\S]{0,200}/)?.[0] || '';

const renderFpGrid  = fe.match(/function renderFpGrid[\s\S]+?^}/m)?.[0] || '';

// ─────────────────────────────────────────────────────────────────────────────
// A. List API — currency column present in SELECT
// ─────────────────────────────────────────────────────────────────────────────
describe('A. List API exposes currency', () => {
  test('A-01: primary SELECT branch includes i.currency', () => {
    // Extract the list-route block by finding both SELECT queries anchored by their unique columns
    const primarySel = srv.match(/COALESCE\(i\.invoice_number[^)]+\) AS invoice_number,\s*i\.issue_date,\s*i\.total_ttc,\s*i\.status,\s*i\.client_id,[\s\S]+?ORDER BY i\.issue_date DESC/);
    expect(primarySel).not.toBeNull();
    expect(primarySel[0]).toMatch(/i\.currency/);
  });

  test('A-02: fallback SELECT branch (code 42703) includes i.currency', () => {
    const fallbackBlock = srv.match(/42703[\s\S]+?SELECT[\s\S]+?FROM owner_invoices i[\s\S]+?ORDER BY i\.issue_date DESC/);
    expect(fallbackBlock).not.toBeNull();
    expect(fallbackBlock[0]).toMatch(/i\.currency/);
  });

  test('A-03: list route SELECT does NOT derive currency from users table', () => {
    // Both SELECT clauses in the list route use i.currency directly
    const listBlock = srv.match(/app\.get\('\/api\/owner-invoices',[\s\S]+?res\.json\(\{ invoices:/)?.[0] || '';
    expect(listBlock).not.toMatch(/default_currency/);
    expect(listBlock).not.toMatch(/JOIN users/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. List API — locale column present in SELECT
// ─────────────────────────────────────────────────────────────────────────────
describe('B. List API exposes locale', () => {
  test('B-01: primary SELECT includes i.locale', () => {
    const primarySel = srv.match(/COALESCE\(i\.invoice_number[^)]+\) AS invoice_number,\s*i\.issue_date,\s*i\.total_ttc,\s*i\.status,\s*i\.client_id,[\s\S]+?ORDER BY i\.issue_date DESC/);
    expect(primarySel).not.toBeNull();
    expect(primarySel[0]).toMatch(/i\.locale/);
  });

  test('B-02: fallback SELECT (code 42703) includes i.locale', () => {
    const fallbackBlock = srv.match(/42703[\s\S]+?SELECT[\s\S]+?FROM owner_invoices i[\s\S]+?ORDER BY i\.issue_date DESC/);
    expect(fallbackBlock).not.toBeNull();
    expect(fallbackBlock[0]).toMatch(/i\.locale/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Invoice card uses inv.currency for amount formatting
// ─────────────────────────────────────────────────────────────────────────────
describe('C. Invoice card uses inv.currency', () => {
  test('C-01: formatOwnerInvoiceMoney in card uses inv.currency', () => {
    // The card HTML generation must reference inv.currency (not only profile currency)
    expect(renderFpGrid).toMatch(/formatOwnerInvoiceMoney\s*\([^)]*inv\.currency/);
  });

  test('C-02: inv.currency with profile fallback for legacy rows', () => {
    // Must have fallback: inv.currency || profile.defaultCurrency
    expect(renderFpGrid).toMatch(/inv\.currency\s*\|\|\s*\(window\.userProfile[^)]*\)\.defaultCurrency/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Invoice card uses inv.locale for date + amount formatting
// ─────────────────────────────────────────────────────────────────────────────
describe('D. Invoice card uses inv.locale', () => {
  test('D-01: formatDate in card uses inv.locale', () => {
    expect(renderFpGrid).toMatch(/formatDate\s*\([^,]+,\s*inv\.locale/);
  });

  test('D-02: inv.locale with profile fallback', () => {
    expect(renderFpGrid).toMatch(/inv\.locale\s*\|\|\s*\(window\.userProfile[^)]*\)\.locale/);
  });

  test('D-03: formatOwnerInvoiceMoney in card uses inv.locale', () => {
    // The card amount line contains inv.locale as second locale argument
    expect(renderFpGrid).toMatch(/inv\.locale\s*\|\|\s*\(window\.userProfile\|\|\{\}\)\.locale/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Profile currency change does NOT alter existing invoice card
// ─────────────────────────────────────────────────────────────────────────────
describe('E. Profile currency change does not alter card', () => {
  test('E-01: card amount source is inv.currency (invoice-stored), not profile-only', () => {
    // The card must use inv.currency as primary source — profile only as fallback
    // If inv.currency is present it takes priority; profile.defaultCurrency is secondary
    expect(renderFpGrid).toMatch(/inv\.currency\s*\|\|/);
    // Must NOT have formatOwnerInvoiceMoney(...profile.defaultCurrency...) without inv.currency guard
    const cardLine = renderFpGrid.match(/invoice-info-value amount[\s\S]+?formatOwnerInvoiceMoney[^)]+\)/)?.[0] || '';
    expect(cardLine).toMatch(/inv\.currency/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F–H. Cross-currency stats: no cross-currency addition
// ─────────────────────────────────────────────────────────────────────────────
describe('F. Single-currency stats', () => {
  test('F-01: stats use per-currency map, not a single totalRev variable', () => {
    // Old pattern was: let totalRev = 0; totalRev += total;
    // New pattern: _revByCur[invCur] = (_revByCur[invCur] || 0) + total
    expect(renderFpGrid).not.toMatch(/let totalRev\s*=\s*0/);
    expect(renderFpGrid).toMatch(/_revByCur\[invCur\]/);
  });

  test('F-02: stats use per-currency pending map', () => {
    expect(renderFpGrid).not.toMatch(/let totalPending\s*=\s*0/);
    expect(renderFpGrid).toMatch(/_pendByCur\[invCur\]/);
  });

  test('F-03: _setStatEl renders single-currency as plain textContent', () => {
    expect(renderFpGrid).toMatch(/_setStatEl/);
    // single entry path uses textContent (not innerHTML)
    expect(renderFpGrid).toMatch(/entries\.length\s*===\s*1[\s\S]+?textContent/);
  });
});

describe('G. EUR + ILS stats remain separate', () => {
  test('G-01: invCur uses inv.currency as key (not profile currency)', () => {
    // invCur must read inv.currency, not a global profile currency
    expect(renderFpGrid).toMatch(/const invCur\s*=\s*inv\.currency/);
  });

  test('G-02: no cross-currency totalRev across all invoices', () => {
    // The old `totalRev += total` without currency check must be gone
    const plainAdd = renderFpGrid.match(/totalRev\s*\+=\s*total/);
    expect(plainAdd).toBeNull();
  });

  test('G-03: multiple-currency entries rendered with <br> separator', () => {
    expect(renderFpGrid).toMatch(/\.join\s*\(\s*'<br>'\s*\)/);
  });
});

describe('H. EUR + CHF + USD remain separate', () => {
  test('H-01: _setStatEl called with per-currency maps (not a single total)', () => {
    // _setStatEl is called with the per-currency accumulator maps
    expect(renderFpGrid).toMatch(/_setStatEl\s*\([^,]+,\s*_revByCur\s*\)/);
    expect(renderFpGrid).toMatch(/_setStatEl\s*\([^,]+,\s*_pendByCur\s*\)/);
  });

  test('H-02: no EUR hardcode in stats display', () => {
    // The stats display section must not reference 'EUR' as a hardcoded currency
    const statsSection = renderFpGrid.match(/_setStatEl[\s\S]+$/)?.[0] || '';
    expect(statsSection).not.toMatch(/'EUR'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. New non-FR invoice does NOT automatically store 'TVA'
// ─────────────────────────────────────────────────────────────────────────────
describe('I. Tax label: no global TVA assumption for new non-FR invoices', () => {
  test('I-01: taxLabel at creation uses country-aware logic, not unconditional TVA', () => {
    // Old: const taxLabel = 'TVA';
    // New: const taxLabel = req.body.taxLabel || (invoiceCountry === 'FR' ? 'TVA' : 'Tax')
    const creation = postInv.match(/const taxLabel[\s\S]{0,200}vatExemptLabel/)?.[0] || '';
    expect(creation).not.toMatch(/^const taxLabel\s*=\s*'TVA'\s*;/m);
    expect(creation).toMatch(/invoiceCountry\s*===\s*'FR'/);
  });

  test('I-02: non-FR branch results in a non-French label', () => {
    const creation = postInv.match(/const taxLabel[\s\S]{0,200}vatExemptLabel/)?.[0] || '';
    // The non-FR branch must yield 'Tax' (or a caller-provided label), never 'TVA' as default
    expect(creation).toMatch(/'Tax'/);
  });

  test('I-03: taxLabel is stored in INSERT via $31 or similar parameter', () => {
    // taxLabel must appear in the INSERT params — verify it is passed
    expect(postInv).toMatch(/tax_label/);
    expect(postInv).toMatch(/taxLabel/);
  });

  test('I-04: req.body.taxLabel is checked first (caller override)', () => {
    const creation = postInv.match(/const taxLabel[\s\S]{0,200}vatExemptLabel/)?.[0] || '';
    expect(creation).toMatch(/req\.body\.taxLabel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. FR legacy fallback remains supported
// ─────────────────────────────────────────────────────────────────────────────
describe('J. FR legacy fallback preserved', () => {
  test('J-01: FR country still results in TVA default', () => {
    const creation = postInv.match(/const taxLabel[\s\S]{0,200}vatExemptLabel/)?.[0] || '';
    expect(creation).toMatch(/invoiceCountry\s*===\s*'FR'\s*\?\s*'TVA'/);
  });

  test('J-02: resolveOwnerInvoicePdfContext still reads stored tax_label first', () => {
    // inv.tax_label || 'TVA' — reads from stored invoice; 'TVA' only when NULL
    const pdfCtxFn = srv.match(/function resolveOwnerInvoicePdfContext[\s\S]+?return \{/)?.[0] || '';
    expect(pdfCtxFn).toMatch(/inv\.tax_label\s*\|\|\s*'TVA'/);
  });

  test('J-03: sendOwnerInvoiceEmail taxLabel fallback is TVA (legacy historical NULL)', () => {
    // _taxLabel = taxLabel || 'TVA' — only reached for truly NULL historical rows
    expect(pathBFn).toMatch(/const _taxLabel\s*=\s*taxLabel\s*\|\|\s*'TVA'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. PATH A PDF: no fabricated SIRET when label is null
// ─────────────────────────────────────────────────────────────────────────────
describe('K. PATH A PDF — no fabricated SIRET', () => {
  test('K-01: PATH A issuer legal render guards on BOTH label AND value', () => {
    // Must NOT have: if (_pdfCtx.issuerLegalValue) { ... || 'SIRET' }
    // Must have: if (_pdfCtx.issuerLegalLabel && _pdfCtx.issuerLegalValue)
    expect(pathABlock).toMatch(/_pdfCtx\.issuerLegalLabel\s*&&\s*_pdfCtx\.issuerLegalValue/);
  });

  test('K-02: PATH A issuer legal render does not use || SIRET fallback', () => {
    const renderLine = pathABlock.match(/issuerLegalLabel.*issuerLegalValue.*/)?.[0] || '';
    expect(renderLine).not.toMatch(/\|\|\s*'SIRET'/);
  });

  test('K-03: PATH A issuer legal fallback SIRET still in resolveOwnerInvoicePdfContext (for siret field)', () => {
    // The label resolution in context fn preserves legacy siret → 'SIRET'
    const pdfCtxFn = srv.match(/function resolveOwnerInvoicePdfContext[\s\S]+?return \{/)?.[0] || '';
    expect(pdfCtxFn).toMatch(/snap\.siret\s*\?\s*'SIRET'\s*:\s*null/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. PATH A PDF: no fabricated N° TVA when label is null
// ─────────────────────────────────────────────────────────────────────────────
describe('L. PATH A PDF — no fabricated N° TVA', () => {
  test('L-01: PATH A issuer tax render guards on BOTH label AND value', () => {
    expect(pathABlock).toMatch(/_pdfCtx\.issuerTaxLabel\s*&&\s*_pdfCtx\.issuerTaxValue/);
  });

  test('L-02: PATH A issuer tax render does not use || N° TVA fallback', () => {
    const renderLine = pathABlock.match(/issuerTaxLabel.*issuerTaxValue.*/)?.[0] || '';
    expect(renderLine).not.toMatch(/\|\|\s*'N° TVA'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M. PATH B email PDF: no fabricated SIRET
// ─────────────────────────────────────────────────────────────────────────────
describe('M. PATH B email PDF — no fabricated SIRET', () => {
  test('M-01: sendOwnerInvoiceEmail issuer legal render guards on both label and value', () => {
    expect(pathBFn).toMatch(/if\s*\(\s*userLegalLabel\s*&&\s*userSiret\s*\)/);
  });

  test('M-02: sendOwnerInvoiceEmail issuer legal render has no || SIRET fallback', () => {
    const renderLine = pathBFn.match(/userLegalLabel.*userSiret.*/)?.[0] || '';
    expect(renderLine).not.toMatch(/\|\|\s*'SIRET'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N. PATH B email PDF: no fabricated N° TVA
// ─────────────────────────────────────────────────────────────────────────────
describe('N. PATH B email PDF — no fabricated N° TVA', () => {
  test('N-01: sendOwnerInvoiceEmail issuer tax render guards on both label and value', () => {
    expect(pathBFn).toMatch(/if\s*\(\s*userTaxLabel\s*&&\s*userTaxValue\s*\)/);
  });

  test('N-02: sendOwnerInvoiceEmail issuer tax render has no || N° TVA fallback', () => {
    const renderLine = pathBFn.match(/userTaxLabel.*userTaxValue.*/)?.[0] || '';
    expect(renderLine).not.toMatch(/\|\|\s*'N° TVA'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O. Owner-invoice email (sendOwnerInvoiceEmail): no hardcoded € in amounts
// ─────────────────────────────────────────────────────────────────────────────
describe('O. sendOwnerInvoiceEmail — no hardcoded € formatting', () => {
  test('O-01: email HTML body does not use .toFixed(2) + € for amounts', () => {
    const emailHtml = pathBFn.match(/emailHtml\s*=[\s\S]+?bhEmailTemplate[\s\S]+?`\s*`?/)?.[0] || pathBFn;
    expect(emailHtml).not.toMatch(/toFixed\s*\(\s*2\s*\)\s*[+]\s*['"]\s*€/);
  });

  test('O-02: email HTML body amounts use bhFmtAmount with _cur and _loc', () => {
    expect(pathBFn).toMatch(/bhFmtAmount\s*\([^)]*_cur[^)]*_loc/);
  });

  test('O-03: email HTML body tax label uses _taxLabel variable', () => {
    const emailHtml = pathBFn.match(/const emailHtml[\s\S]+?`\s*\)\s*;/)?.[0] || pathBFn;
    expect(emailHtml).toMatch(/_taxLabel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P. Owner-invoice email: dates use invoice locale
// ─────────────────────────────────────────────────────────────────────────────
describe('P. sendOwnerInvoiceEmail — dates use invoice locale', () => {
  test('P-01: period dates use _loc (not hardcoded fr-FR)', () => {
    // periodStartFr / periodEndFr must use _loc
    expect(pathBFn).toMatch(/toLocaleDateString\s*\(\s*_loc\s*\)/);
  });

  test('P-02: issue date in PDF uses _loc', () => {
    expect(pathBFn).toMatch(/toLocaleDateString\s*\(\s*_loc\s*\)/);
  });

  test('P-03: _loc is derived from invoice locale (not hardcoded fr-FR)', () => {
    // const _loc = (locale && ...) ? locale : 'fr-FR'  — invoice locale first
    expect(pathBFn).toMatch(/const _loc\s*=\s*\(locale/);
    // Must reference the locale parameter, not start with 'fr-FR'
    expect(pathBFn).not.toMatch(/const _loc\s*=\s*'fr-FR'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q. Credit note context: snapshot invariant
// ─────────────────────────────────────────────────────────────────────────────
describe('Q. Credit note snapshot invariant', () => {
  test('Q-01: credit note INSERT copies currency from original invoice', () => {
    const cnInsert = srv.match(/INTL-4\.4[\s\S]+?INSERT INTO owner_invoices[\s\S]+?currency[\s\S]+?\$29/)?.[0]
      || srv.match(/INSERT INTO owner_invoices[\s\S]+?is_credit_note[\s\S]+?TRUE[\s\S]+?currency[\s\S]+?orig\./)?.[0]
      || '';
    // The credit note INSERT must reference orig.currency or pass currency via param
    const cnBlock = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/credit-note'[\s\S]+?^\}\);/m)?.[0] || '';
    expect(cnBlock).toMatch(/orig\.currency|orig\['currency'\]/);
  });

  test('Q-02: credit note INSERT copies locale from original invoice', () => {
    const cnBlock = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/credit-note'[\s\S]+?^\}\);/m)?.[0] || '';
    expect(cnBlock).toMatch(/orig\.locale|orig\['locale'\]/);
  });

  test('Q-03: credit note INSERT copies tax_label from original invoice', () => {
    const cnBlock = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/credit-note'[\s\S]+?^\}\);/m)?.[0] || '';
    expect(cnBlock).toMatch(/orig\.tax_label|orig\['tax_label'\]/);
  });

  test('Q-04: credit note INSERT block has INTL-4.4 or INTL-4.7 comment about snapshot', () => {
    // The credit note INSERT has comments marking snapshot authority
    const cnBlock = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/credit-note'[\s\S]+?^\}\);/m)?.[0] || '';
    // Comment must reference INTL-4.4 or INTL-4.7 near snapshot language
    expect(cnBlock).toMatch(/INTL-4\.[47]/);
    expect(cnBlock).toMatch(/snapshot|hérite/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R. No FX / currency conversion
// ─────────────────────────────────────────────────────────────────────────────
describe('R. No FX', () => {
  test('R-01: no exchangeRate variable in server.js (owner invoice paths)', () => {
    expect(srv).not.toMatch(/\bexchangeRate\b/);
  });

  test('R-02: no exchange_rate column reference in owner invoice queries', () => {
    expect(srv).not.toMatch(/exchange_rate/);
  });

  test('R-03: no fxRate variable', () => {
    expect(srv).not.toMatch(/\bfxRate\b/);
  });

  test('R-04: no convertCurrency function', () => {
    expect(srv).not.toMatch(/convertCurrency/);
  });

  test('R-05: stats aggregation does not convert currencies', () => {
    // Stats must NOT multiply/divide by any rate
    expect(renderFpGrid).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('R-06: frontend has no currencyConversion', () => {
    expect(fe).not.toMatch(/currencyConversion/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S. Historical invoice stored values remain authoritative
// ─────────────────────────────────────────────────────────────────────────────
describe('S. Historical invoice fallback preserved', () => {
  test('S-01: resolveOwnerInvoicePdfContext uses inv.currency first', () => {
    const pdfCtxFn = srv.match(/function resolveOwnerInvoicePdfContext[\s\S]+?return \{/)?.[0] || '';
    expect(pdfCtxFn).toMatch(/inv\.currency/);
  });

  test('S-02: resolveOwnerInvoicePdfContext uses inv.locale first', () => {
    const pdfCtxFn = srv.match(/function resolveOwnerInvoicePdfContext[\s\S]+?return \{/)?.[0] || '';
    expect(pdfCtxFn).toMatch(/inv\.locale/);
  });

  test('S-03: resolveOwnerInvoicePdfContext reads inv.tax_label (not hardcode)', () => {
    const pdfCtxFn = srv.match(/function resolveOwnerInvoicePdfContext[\s\S]+?return \{/)?.[0] || '';
    expect(pdfCtxFn).toMatch(/inv\.tax_label/);
  });

  test('S-04: frontend card amount source is inv.currency (stored), not derived', () => {
    // After INTL-4.9, inv.currency is available on list response and used as primary source
    expect(renderFpGrid).toMatch(/inv\.currency\s*\|\|/);
  });

  test('S-05: card date source is inv.locale (stored), not derived', () => {
    expect(renderFpGrid).toMatch(/inv\.locale\s*\|\|/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional structural checks
// ─────────────────────────────────────────────────────────────────────────────
describe('Additional: CSV export currency-aware', () => {
  test('CSV-01: invoice CSV export SELECT includes i.currency', () => {
    // The CSV SELECT must include i.currency so each row carries its stored currency
    expect(csvBlock).toMatch(/i\.currency/);
  });

  test('CSV-02: CSV headers do not hardcode (EUR)', () => {
    // After fix, no column header contains "(EUR)"
    const headersLine = csvBlock.match(/lines\.push\(\[.*\]\.join\(';'\)\)/)?.[0] || '';
    expect(headersLine).not.toMatch(/\(EUR\)/);
  });

  test('CSV-03: CSV data rows include inv.currency per row', () => {
    expect(csvBlock).toMatch(/inv\.currency\s*\|\|\s*''/);
  });

  test('CSV-04: CSV totals grouped by currency (no single cross-currency total)', () => {
    expect(csvBlock).toMatch(/totalByCurrency/);
    expect(csvBlock).toMatch(/Object\.entries\s*\(\s*totalByCurrency\s*\)/);
  });
});

describe('Additional: PATH A/B client identity unchanged (INTL-4.7R)', () => {
  test('PATH-A-client: PATH A still has no live owner_clients fallback for client identity', () => {
    // INTL-4.7R invariant: no client.legal_identifier_label in PATH A identity block
    const pathAIdentity = pathABlock.match(/const clientLegalLabel[\s\S]+?const clientTaxValue/)?.[0] || '';
    expect(pathAIdentity).not.toMatch(/client\.legal_identifier_label/);
    expect(pathAIdentity).not.toMatch(/client\.legal_identifier_value/);
  });

  test('PATH-B-client: PATH B send call still snapshots client from invoice row', () => {
    const sendRoute = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/send'[\s\S]+?^\}\);/m)?.[0] || '';
    expect(sendRoute).toMatch(/invoice\.client_legal_identifier_label/);
    expect(sendRoute).not.toMatch(/client\.legal_identifier_label/);
  });
});

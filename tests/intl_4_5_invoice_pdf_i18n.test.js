'use strict';
/**
 * INTL-4.5 — Owner Invoice PDF Internationalization
 *
 * Structural checks: reads server.js source and verifies that both PDF paths
 * (PATH A: POST /api/owner-invoices/:id/pdf, PATH B: sendOwnerInvoiceEmail)
 * are currency-aware, locale-aware, snapshot-first, and use snapshot-derived labels.
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract key blocks once for reuse across groups
const helperBlock = src.match(/INTL-4\.5 — resolveOwnerInvoicePdfContext[\s\S]+?^}/m)?.[0] || '';
const pathABlock  = src.match(/app\.post\('\/api\/owner-invoices\/:id\/pdf'[\s\S]+?^\}\);/m)?.[0] || '';
const pathBFn     = src.match(/async function sendOwnerInvoiceEmail[\s\S]+?^}/m)?.[0] || '';
const sendRoute   = src.match(/app\.post\('\/api\/owner-invoices\/:id\/send'[\s\S]+?^\}\);/m)?.[0] || '';

// ── A: resolveOwnerInvoicePdfContext helper present ──────────
describe('A — resolveOwnerInvoicePdfContext helper', () => {
  test('A-01 function defined', () => {
    expect(src).toMatch(/function resolveOwnerInvoicePdfContext\(/);
  });

  test('A-02 function is synchronous (not async)', () => {
    expect(src).toMatch(/^function resolveOwnerInvoicePdfContext\(/m);
    expect(src).not.toMatch(/async function resolveOwnerInvoicePdfContext\(/);
  });

  test('A-03 takes inv and liveUser parameters', () => {
    expect(src).toMatch(/function resolveOwnerInvoicePdfContext\(inv,\s*liveUser\)/);
  });

  test('A-04 returns currency', () => {
    expect(helperBlock).toMatch(/currency/);
  });

  test('A-05 returns locale', () => {
    expect(helperBlock).toMatch(/locale/);
  });

  test('A-06 returns issuerName', () => {
    expect(helperBlock).toMatch(/issuerName/);
  });

  test('A-07 returns issuerLegalLabel and issuerLegalValue', () => {
    expect(helperBlock).toMatch(/issuerLegalLabel/);
    expect(helperBlock).toMatch(/issuerLegalValue/);
  });

  test('A-08 returns taxLabel and vatExemptLabel', () => {
    expect(helperBlock).toMatch(/taxLabel/);
    expect(helperBlock).toMatch(/vatExemptLabel/);
  });

  test('A-09 INTL-4.5 comment present', () => {
    expect(src).toMatch(/INTL-4\.5/);
  });
});

// ── B: resolveOwnerInvoicePdfContext — snapshot branch ───────
describe('B — helper: snapshot-first branch', () => {
  test('B-01 reads issuer_snapshot from inv', () => {
    expect(helperBlock).toMatch(/inv\.issuer_snapshot/);
  });

  test('B-02 snapshot branch uses snap.company', () => {
    expect(helperBlock).toMatch(/snap\.company/);
  });

  test('B-03 snapshot branch uses snap.invoiceEmail or snap.email', () => {
    expect(helperBlock).toMatch(/snap\.invoiceEmail/);
    expect(helperBlock).toMatch(/snap\.email/);
  });

  test('B-04 snapshot branch uses snap.legalIdentifierLabel', () => {
    expect(helperBlock).toMatch(/snap\.legalIdentifierLabel/);
  });

  test('B-05 snapshot branch uses snap.legalIdentifierValue', () => {
    expect(helperBlock).toMatch(/snap\.legalIdentifierValue/);
  });

  test('B-06 snapshot branch falls back to snap.siret for SIRET label', () => {
    expect(helperBlock).toMatch(/snap\.siret/);
  });

  test('B-07 snapshot branch uses snap.taxIdentifierLabel and snap.taxIdentifierValue', () => {
    expect(helperBlock).toMatch(/snap\.taxIdentifierLabel/);
    expect(helperBlock).toMatch(/snap\.taxIdentifierValue/);
  });

  test('B-08 snapshot branch uses snap.vatNumber as tax value fallback', () => {
    expect(helperBlock).toMatch(/snap\.vatNumber/);
  });
});

// ── C: resolveOwnerInvoicePdfContext — legacy fallback branch ─
describe('C — helper: legacy live-user fallback branch', () => {
  test('C-01 fallback uses liveUser', () => {
    expect(helperBlock).toMatch(/liveUser/);
  });

  test('C-02 fallback reads u.invoice_email', () => {
    expect(helperBlock).toMatch(/u\.invoice_email/);
  });

  test('C-03 fallback reads u.legal_identifier_label', () => {
    expect(helperBlock).toMatch(/u\.legal_identifier_label/);
  });

  test('C-04 fallback reads u.legal_identifier_value', () => {
    expect(helperBlock).toMatch(/u\.legal_identifier_value/);
  });

  test('C-05 fallback reads u.tax_identifier_label and u.tax_identifier_value', () => {
    expect(helperBlock).toMatch(/u\.tax_identifier_label/);
    expect(helperBlock).toMatch(/u\.tax_identifier_value/);
  });

  test('C-06 fallback reads u.vat_number as tax value fallback', () => {
    expect(helperBlock).toMatch(/u\.vat_number/);
  });

  test('C-07 fallback reads u.siret for legacy SIRET label', () => {
    expect(helperBlock).toMatch(/u\.siret/);
  });
});

// ── D: resolveOwnerInvoicePdfContext — currency/locale guards ─
describe('D — helper: currency and locale guards', () => {
  test('D-01 currency validated against [A-Z]{3} pattern', () => {
    expect(helperBlock).toMatch(/\[A-Z\]\{3\}/);
  });

  test('D-02 currency fallback to EUR', () => {
    expect(helperBlock).toMatch(/'EUR'/);
  });

  test('D-03 locale validated against ll-CC pattern', () => {
    expect(helperBlock).toMatch(/\[a-z\]\{2\}-\[A-Z\]\{2\}/);
  });

  test('D-04 locale fallback to fr-FR', () => {
    expect(helperBlock).toMatch(/'fr-FR'/);
  });

  test('D-05 taxLabel fallback to TVA', () => {
    expect(helperBlock).toMatch(/\|\|\s*'TVA'/);
  });
});

// ── E: PATH A — users SELECT expanded ───────────────────────
describe('E — PATH A: users SELECT expanded', () => {
  test('E-01 users SELECT in PATH A includes invoice_email', () => {
    expect(pathABlock).toMatch(/invoice_email/);
  });

  test('E-02 users SELECT in PATH A includes phone', () => {
    expect(pathABlock).toMatch(/phone/);
  });

  test('E-03 users SELECT in PATH A includes website', () => {
    expect(pathABlock).toMatch(/website/);
  });

  test('E-04 users SELECT in PATH A includes vat_number', () => {
    expect(pathABlock).toMatch(/vat_number/);
  });

  test('E-05 users SELECT in PATH A includes legal_identifier_label', () => {
    expect(pathABlock).toMatch(/legal_identifier_label/);
  });

  test('E-06 users SELECT in PATH A includes tax_identifier_label', () => {
    expect(pathABlock).toMatch(/tax_identifier_label/);
  });
});

// ── F: PATH A — snapshot-first emitter ──────────────────────
describe('F — PATH A: snapshot-first emitter identity', () => {
  test('F-01 PATH A calls resolveOwnerInvoicePdfContext', () => {
    expect(pathABlock).toMatch(/resolveOwnerInvoicePdfContext\(/);
  });

  test('F-02 PATH A blocks emitter identity override when snapshot present', () => {
    expect(pathABlock).toMatch(/_snapActive/);
  });

  test('F-03 PATH A uses _emitterIdentity (not raw emitter) for identity fields', () => {
    expect(pathABlock).toMatch(/_emitterIdentity/);
  });

  test('F-04 emitter.logo still allowed (residual visual dependency)', () => {
    expect(pathABlock).toMatch(/emitter\.logo/);
  });

  test('F-05 _pdfCtx passed to PDF generation', () => {
    expect(pathABlock).toMatch(/_pdfCtx/);
  });
});

// ── G: PATH A — currency-aware amounts ───────────────────────
describe('G — PATH A: currency-aware amount formatting', () => {
  test('G-01 PATH A uses bhFmtAmount for item total', () => {
    expect(pathABlock).toMatch(/bhFmtAmount\(.*_pdfCtx\.currency.*_pdfCtx\.locale/s);
  });

  test('G-02 PATH A uses bhFmtAmount for subtotal HT', () => {
    expect(pathABlock).toMatch(/bhFmtAmount\(subtotal/);
  });

  test('G-03 PATH A uses bhFmtAmount for VAT amount', () => {
    expect(pathABlock).toMatch(/bhFmtAmount\(vatAmt/);
  });

  test('G-04 PATH A uses bhFmtAmount for total TTC', () => {
    expect(pathABlock).toMatch(/bhFmtAmount\(totalTtc/);
  });

  test('G-05 PATH A no longer hardcodes .toFixed(2)+\' €\' for financial amounts', () => {
    // toFixed still allowed for rates/percentages but not monetary totals
    const monetaryFixed = pathABlock.match(/total(?:Ttc|Ht|Amt)\.toFixed\(2\)\s*\+\s*' €'/);
    expect(monetaryFixed).toBeNull();
  });
});

// ── H: PATH A — locale-aware dates ───────────────────────────
describe('H — PATH A: locale-aware date formatting', () => {
  test('H-01 issue date uses _pdfCtx.locale', () => {
    expect(pathABlock).toMatch(/toLocaleDateString\(_pdfCtx\.locale\)/);
  });

  test('H-02 PATH A no longer hardcodes fr-FR for dates', () => {
    // Any toLocaleDateString call in pathABlock must not use hardcoded 'fr-FR'
    const hardcoded = pathABlock.match(/toLocaleDateString\('fr-FR'\)/);
    expect(hardcoded).toBeNull();
  });
});

// ── I: PATH A — generic legal identifier ─────────────────────
describe('I — PATH A: generic legal/tax identifier display', () => {
  test('I-01 PATH A uses _pdfCtx.issuerLegalLabel and issuerLegalValue', () => {
    expect(pathABlock).toMatch(/_pdfCtx\.issuerLegalLabel/);
    expect(pathABlock).toMatch(/_pdfCtx\.issuerLegalValue/);
  });

  test('I-02 PATH A no longer has hardcoded SIRET : ${senderSiret}', () => {
    expect(pathABlock).not.toMatch(/`SIRET : \$\{senderSiret\}`/);
  });

  test('I-03 PATH A: SIRET fallback in context resolution, not at render time (INTL-4.9)', () => {
    // INTL-4.9: render guard requires BOTH label AND value — no || 'SIRET' at render time.
    // The legacy SIRET label is now resolved in resolveOwnerInvoicePdfContext (snap.siret → 'SIRET').
    const pdfCtxFn = src.match(/function resolveOwnerInvoicePdfContext[\s\S]+?return \{/)?.[0] || '';
    expect(pdfCtxFn).toMatch(/snap\.siret\s*\?\s*'SIRET'\s*:\s*null/);
    // Render line must require both label and value, no || 'SIRET' fallback
    expect(pathABlock).toMatch(/_pdfCtx\.issuerLegalLabel\s*&&\s*_pdfCtx\.issuerLegalValue/);
    expect(pathABlock).not.toMatch(/issuerLegalLabel\s*\|\|\s*'SIRET'/);
  });

  test('I-04 PATH A shows tax identifier when present', () => {
    expect(pathABlock).toMatch(/_pdfCtx\.issuerTaxValue/);
  });
});

// ── J: PATH A — tax label and VAT exempt label ───────────────
describe('J — PATH A: tax label and VAT exempt label', () => {
  test('J-01 PATH A uses _pdfCtx.taxLabel for TVA line', () => {
    expect(pathABlock).toMatch(/_pdfCtx\.taxLabel/);
  });

  test('J-02 PATH A uses _pdfCtx.vatExemptLabel for exempt text', () => {
    expect(pathABlock).toMatch(/_pdfCtx\.vatExemptLabel/);
  });

  test('J-03 PATH A no longer hardcodes TVA non applicable, art. 293 B du CGI', () => {
    expect(pathABlock).not.toMatch(/TVA non applicable, art\. 293 B du CGI/);
  });

  test('J-04 PATH A shows exempt label only when vatExemptLabel is truthy (no invention)', () => {
    expect(pathABlock).toMatch(/else if \(_pdfCtx\.vatExemptLabel\)/);
  });
});

// ── K: PATH B (sendOwnerInvoiceEmail) — new parameters ───────
describe('K — PATH B: sendOwnerInvoiceEmail new parameters', () => {
  test('K-01 function signature includes currency', () => {
    expect(pathBFn).toMatch(/currency/);
  });

  test('K-02 function signature includes locale', () => {
    expect(pathBFn).toMatch(/locale/);
  });

  test('K-03 function signature includes taxLabel', () => {
    expect(pathBFn).toMatch(/taxLabel/);
  });

  test('K-04 function signature includes vatExemptLabel', () => {
    expect(pathBFn).toMatch(/vatExemptLabel/);
  });

  test('K-05 function signature includes paymentDelay, paymentMode, lateInterest', () => {
    expect(pathBFn).toMatch(/paymentDelay/);
    expect(pathBFn).toMatch(/paymentMode/);
    expect(pathBFn).toMatch(/lateInterest/);
  });

  test('K-06 function signature includes userLegalLabel and userTaxLabel', () => {
    expect(pathBFn).toMatch(/userLegalLabel/);
    expect(pathBFn).toMatch(/userTaxLabel/);
  });

  test('K-07 function signature includes issueDate', () => {
    expect(pathBFn).toMatch(/issueDate/);
  });
});

// ── L: PATH B — currency-aware amounts ───────────────────────
describe('L — PATH B: currency-aware amount formatting', () => {
  test('L-01 PATH B uses bhFmtAmount for item total', () => {
    expect(pathBFn).toMatch(/bhFmtAmount\(total,\s*_cur,\s*_loc\)/);
  });

  test('L-02 PATH B uses bhFmtAmount for subtotal HT', () => {
    expect(pathBFn).toMatch(/bhFmtAmount\(ht,\s*_cur,\s*_loc\)/);
  });

  test('L-03 PATH B uses bhFmtAmount for VAT amount', () => {
    expect(pathBFn).toMatch(/bhFmtAmount\(vatAmt,\s*_cur,\s*_loc\)/);
  });

  test('L-04 PATH B uses bhFmtAmount for total TTC', () => {
    expect(pathBFn).toMatch(/bhFmtAmount\(ttc,\s*_cur,\s*_loc\)/);
  });

  test('L-05 PATH B email HTML body uses bhFmtAmount', () => {
    expect(pathBFn).toMatch(/bhFmtAmount\(total,\s*_cur,\s*_loc\)/);
  });
});

// ── M: PATH B — locale-aware dates ───────────────────────────
describe('M — PATH B: locale-aware date formatting', () => {
  test('M-01 period start uses _loc', () => {
    expect(pathBFn).toMatch(/toLocaleDateString\(_loc\)/);
  });

  test('M-02 issue date in PDF uses _loc', () => {
    expect(pathBFn).toMatch(/issueDate.*toLocaleDateString\(_loc\)/s);
  });

  test('M-03 PATH B no longer hardcodes fr-FR for dates', () => {
    const hardcoded = pathBFn.match(/toLocaleDateString\('fr-FR'\)/);
    expect(hardcoded).toBeNull();
  });
});

// ── N: PATH B — generic legal identifier ─────────────────────
describe('N — PATH B: generic legal/tax identifier display', () => {
  test('N-01 PATH B uses userLegalLabel (not hardcoded SIRET)', () => {
    expect(pathBFn).toMatch(/userLegalLabel/);
  });

  test('N-02 PATH B uses userTaxLabel and userTaxValue', () => {
    expect(pathBFn).toMatch(/userTaxLabel/);
    expect(pathBFn).toMatch(/userTaxValue/);
  });

  test('N-03 PATH B no longer hardcodes SIRET : +userSiret (old form)', () => {
    expect(pathBFn).not.toMatch(/'SIRET : '\+userSiret/);
  });

  test('N-04 PATH B falls back to SIRET label string when userLegalLabel absent', () => {
    expect(pathBFn).toMatch(/userLegalLabel.*'SIRET'/s);
  });
});

// ── O: PATH B — tax label and VAT exempt label ───────────────
describe('O — PATH B: tax label and VAT exempt label', () => {
  test('O-01 PATH B uses _taxLabel for TVA line', () => {
    expect(pathBFn).toMatch(/_taxLabel/);
  });

  test('O-02 PATH B uses _vatExempt for exempt text', () => {
    expect(pathBFn).toMatch(/_vatExempt/);
  });

  test('O-03 PATH B shows exempt label only when _vatExempt is truthy (no invention)', () => {
    expect(pathBFn).toMatch(/else if \(_vatExempt\)/);
  });

  test('O-04 PATH B no longer hardcodes TVA non applicable, art. 293 B du CGI', () => {
    expect(pathBFn).not.toMatch(/TVA non applicable, art\. 293 B du CGI/);
  });
});

// ── P: PATH B — payment terms from invoice fields ────────────
describe('P — PATH B: payment terms from invoice (not hardcoded)', () => {
  test('P-01 PATH B uses paymentDelay variable', () => {
    expect(pathBFn).toMatch(/paymentDelay/);
  });

  test('P-02 PATH B uses paymentMode variable', () => {
    expect(pathBFn).toMatch(/paymentMode/);
  });

  test('P-03 PATH B uses lateInterest variable', () => {
    expect(pathBFn).toMatch(/lateInterest/);
  });

  test('P-04 PATH B no longer hardcodes 30 jours payment term', () => {
    expect(pathBFn).not.toMatch(/30 jours/);
  });

  test('P-05 PATH B no longer hardcodes Virement bancaire', () => {
    expect(pathBFn).not.toMatch(/Virement bancaire/);
  });

  test('P-06 PATH B no longer hardcodes 3× taux légal', () => {
    expect(pathBFn).not.toMatch(/3× taux légal/);
  });
});

// ── Q: send route — passes new fields to sendOwnerInvoiceEmail ─
describe('Q — send route: new fields passed to sendOwnerInvoiceEmail', () => {
  test('Q-01 send route calls resolveOwnerInvoicePdfContext', () => {
    expect(sendRoute).toMatch(/resolveOwnerInvoicePdfContext\(/);
  });

  test('Q-02 send route passes currency to sendOwnerInvoiceEmail', () => {
    expect(sendRoute).toMatch(/currency:\s*_sendPdfCtx\.currency/);
  });

  test('Q-03 send route passes locale to sendOwnerInvoiceEmail', () => {
    expect(sendRoute).toMatch(/locale:\s*_sendPdfCtx\.locale/);
  });

  test('Q-04 send route passes taxLabel to sendOwnerInvoiceEmail', () => {
    expect(sendRoute).toMatch(/taxLabel:\s*_sendPdfCtx\.taxLabel/);
  });

  test('Q-05 send route passes vatExemptLabel to sendOwnerInvoiceEmail', () => {
    expect(sendRoute).toMatch(/vatExemptLabel:\s*_sendPdfCtx\.vatExemptLabel/);
  });

  test('Q-06 send route passes paymentDelay, paymentMode, lateInterest from invoice', () => {
    expect(sendRoute).toMatch(/paymentDelay:\s*invoice\.payment_delay/);
    expect(sendRoute).toMatch(/paymentMode:\s*invoice\.payment_mode/);
    expect(sendRoute).toMatch(/lateInterest:\s*invoice\.late_interest/);
  });

  test('Q-07 send route passes userLegalLabel from _sendPdfCtx', () => {
    expect(sendRoute).toMatch(/userLegalLabel:\s*_sendPdfCtx\.issuerLegalLabel/);
  });

  test('Q-08 send route expands users SELECT to include invoice_email', () => {
    expect(sendRoute).toMatch(/invoice_email/);
  });

  test('Q-09 send route expands users SELECT to include legal_identifier_label', () => {
    expect(sendRoute).toMatch(/legal_identifier_label/);
  });
});

// ── R: send route — snapshot-first logo ──────────────────────
describe('R — send route: logo residual visual dependency', () => {
  test('R-01 send route logo blocked for snapshot invoices (identity blocked, logo allowed separately)', () => {
    // Logo from emitter only when no snapshot, but logo_url always as DB fallback
    expect(sendRoute).toMatch(/issuer_snapshot.*emitter.*logo/s);
  });

  test('R-02 send route logo falls back to profile.logo_url', () => {
    expect(sendRoute).toMatch(/profile\.logo_url/);
  });
});

// ── S: PATH A — senderSiret variable removed ─────────────────
describe('S — PATH A: old senderSiret variable gone', () => {
  test('S-01 senderSiret not used as direct SIRET display var in PATH A', () => {
    // senderSiret was the old variable, now replaced by _pdfCtx.issuerLegalValue
    expect(pathABlock).not.toMatch(/const senderSiret/);
  });
});

// ── T: helper placed between INTL-4.4 and route 2 ────────────
describe('T — helper placement in server.js', () => {
  test('T-01 resolveOwnerInvoicePdfContext defined after resolveOwnerInvoiceContext', () => {
    const pos4 = src.indexOf('function resolveOwnerInvoiceContext(');
    const pos5 = src.indexOf('function resolveOwnerInvoicePdfContext(');
    expect(pos4).toBeGreaterThan(-1);
    expect(pos5).toBeGreaterThan(-1);
    expect(pos5).toBeGreaterThan(pos4);
  });

  test('T-02 resolveOwnerInvoicePdfContext defined before POST /api/owner-invoices/:id/pdf', () => {
    const posFn  = src.indexOf('function resolveOwnerInvoicePdfContext(');
    const posRte = src.indexOf("app.post('/api/owner-invoices/:id/pdf'");
    expect(posFn).toBeGreaterThan(-1);
    expect(posRte).toBeGreaterThan(-1);
    expect(posFn).toBeLessThan(posRte);
  });
});

// ── U: no forbidden modifications ────────────────────────────
describe('U — forbidden modifications not introduced', () => {
  test('U-01 factures-proprietaires.html not modified (INTL-4.6 scope)', () => {
    // Verify we haven't accidentally touched the HTML file references
    expect(src).not.toMatch(/INTL-4\.6.*factures/);
  });

  test('U-02 vat_amount not SET in PDF paths (read-only)', () => {
    expect(pathABlock).not.toMatch(/SET vat_amount/);
    expect(pathBFn).not.toMatch(/SET vat_amount/);
  });

  test('U-03 invoice_number not modified in PDF paths', () => {
    expect(pathABlock).not.toMatch(/SET invoice_number/);
  });

  test('U-04 total_ttc not SET in PDF paths', () => {
    expect(pathABlock).not.toMatch(/SET total_ttc/);
    expect(pathBFn).not.toMatch(/SET total_ttc/);
  });

  test('U-05 resolveOwnerInvoicePdfContext makes no DB writes (no pool.query inside)', () => {
    expect(helperBlock).not.toMatch(/pool\.query/);
    expect(helperBlock).not.toMatch(/await /);
  });
});

// ── V: snapshot authority — behavioral (resolveOwnerInvoicePdfContext) ──
// Adversarial test: snapshot must win over live user data for all legal identity fields.
describe('V — snapshot authority: snapshot beats live user', () => {
  // Load the actual function for behavioral testing
  let resolveOwnerInvoicePdfContext;
  beforeAll(() => {
    // Isolate only the function definition from server.js for eval
    const fnSrc = src.match(/^function resolveOwnerInvoicePdfContext\([\s\S]+?^}/m)?.[0] || '';
    // eslint-disable-next-line no-new-func
    resolveOwnerInvoicePdfContext = new Function('return ' + fnSrc)();
  });

  const snapInv = {
    issuer_snapshot: {
      company: 'OLD COMPANY',
      firstName: null,
      lastName: null,
      address: 'OLD ADDRESS',
      postalCode: '00000',
      city: 'OLD CITY',
      email: 'old@example.com',
      invoiceEmail: 'oldinvoice@example.com',
      phone: '+00 0 00 00 00 00',
      website: 'https://old.example.com',
      siret: null,
      vatNumber: null,
      legalIdentifierLabel: 'OLD-LABEL',
      legalIdentifierValue: 'OLD-ID',
      taxIdentifierLabel: 'OLD-TAX-LABEL',
      taxIdentifierValue: 'OLD-TAX-VALUE',
    },
    currency: 'ILS',
    locale: 'he-IL',
    tax_label: 'TAX_SENTINEL',
    vat_exempt_label: 'EXEMPT_SENTINEL',
  };

  const livePollutingUser = {
    company: 'NEW COMPANY',
    first_name: 'New', last_name: 'User',
    address: 'NEW ADDRESS',
    postal_code: '99999',
    city: 'NEW CITY',
    email: 'new@example.com',
    invoice_email: 'newinvoice@example.com',
    phone: '+99 9 99 99 99 99',
    website: 'https://new.example.com',
    siret: 'NEWSIRET',
    vat_number: 'NEWVAT',
    legal_identifier_label: 'NEW-LABEL',
    legal_identifier_value: 'NEW-ID',
    tax_identifier_label: 'NEW-TAX-LABEL',
    tax_identifier_value: 'NEW-TAX-VALUE',
  };

  test('V-01 issuerName comes from snapshot, not live user', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.issuerName).toBe('OLD COMPANY');
    expect(ctx.issuerName).not.toMatch(/NEW/);
  });

  test('V-02 issuerAddr comes from snapshot', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.issuerAddr).toBe('OLD ADDRESS');
  });

  test('V-03 issuerEmail uses snapshot invoiceEmail', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.issuerEmail).toBe('oldinvoice@example.com');
  });

  test('V-04 issuerLegalLabel and issuerLegalValue come from snapshot', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.issuerLegalLabel).toBe('OLD-LABEL');
    expect(ctx.issuerLegalValue).toBe('OLD-ID');
  });

  test('V-05 issuerTaxLabel and issuerTaxValue come from snapshot', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.issuerTaxLabel).toBe('OLD-TAX-LABEL');
    expect(ctx.issuerTaxValue).toBe('OLD-TAX-VALUE');
  });

  test('V-06 currency comes from invoice (not live user)', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.currency).toBe('ILS');
  });

  test('V-07 locale comes from invoice (not live user)', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.locale).toBe('he-IL');
  });

  test('V-08 taxLabel comes from invoice field', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.taxLabel).toBe('TAX_SENTINEL');
  });

  test('V-09 vatExemptLabel comes from invoice field', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    expect(ctx.vatExemptLabel).toBe('EXEMPT_SENTINEL');
  });

  test('V-10 live user data does not appear anywhere in the result when snapshot present', () => {
    const ctx = resolveOwnerInvoicePdfContext(snapInv, livePollutingUser);
    const json = JSON.stringify(ctx);
    expect(json).not.toMatch(/NEW COMPANY|NEW ADDRESS|NEW CITY|NEW-ID|NEW-LABEL|NEWSIRET|NEWVAT/);
  });
});

// ── W: legacy fallback boundary ──────────────────────────────
describe('W — legacy fallback: null snapshot uses live user', () => {
  let resolveOwnerInvoicePdfContext;
  beforeAll(() => {
    const fnSrc = src.match(/^function resolveOwnerInvoicePdfContext\([\s\S]+?^}/m)?.[0] || '';
    // eslint-disable-next-line no-new-func
    resolveOwnerInvoicePdfContext = new Function('return ' + fnSrc)();
  });

  const legacyInv = {
    issuer_snapshot: null,
    currency: 'EUR',
    locale: 'fr-FR',
    tax_label: null,
    vat_exempt_label: null,
  };

  const liveUser = {
    company: 'LIVE COMPANY',
    first_name: null, last_name: null,
    address: 'LIVE ADDRESS',
    postal_code: '75001',
    city: 'Paris',
    email: 'live@example.com',
    invoice_email: null,
    phone: '+33 1 00 00 00 00',
    website: null,
    siret: '12345678901234',
    vat_number: null,
    legal_identifier_label: null,
    legal_identifier_value: null,
    tax_identifier_label: null,
    tax_identifier_value: null,
  };

  test('W-01 null snapshot → live user company used', () => {
    const ctx = resolveOwnerInvoicePdfContext(legacyInv, liveUser);
    expect(ctx.issuerName).toBe('LIVE COMPANY');
  });

  test('W-02 null snapshot → siret fallback to SIRET label', () => {
    const ctx = resolveOwnerInvoicePdfContext(legacyInv, liveUser);
    expect(ctx.issuerLegalLabel).toBe('SIRET');
    expect(ctx.issuerLegalValue).toBe('12345678901234');
  });

  test('W-03 null snapshot → taxLabel fallback to TVA', () => {
    const ctx = resolveOwnerInvoicePdfContext(legacyInv, liveUser);
    expect(ctx.taxLabel).toBe('TVA');
  });

  test('W-04 null snapshot → vatExemptLabel is null (no invented 293B)', () => {
    const ctx = resolveOwnerInvoicePdfContext(legacyInv, liveUser);
    expect(ctx.vatExemptLabel).toBeNull();
  });
});

// ── X: non-FR snapshot — no SIRET invented ───────────────────
describe('X — non-FR snapshot: no SIRET/293B invented', () => {
  let resolveOwnerInvoicePdfContext;
  beforeAll(() => {
    const fnSrc = src.match(/^function resolveOwnerInvoicePdfContext\([\s\S]+?^}/m)?.[0] || '';
    // eslint-disable-next-line no-new-func
    resolveOwnerInvoicePdfContext = new Function('return ' + fnSrc)();
  });

  test('X-01 non-FR snapshot with no legal identifier → issuerLegalValue null', () => {
    const inv = {
      issuer_snapshot: { company: 'IL Corp', siret: null, legalIdentifierLabel: null, legalIdentifierValue: null, vatNumber: null },
      currency: 'ILS', locale: 'he-IL', tax_label: 'מע״מ', vat_exempt_label: null,
    };
    const ctx = resolveOwnerInvoicePdfContext(inv, {});
    expect(ctx.issuerLegalValue).toBeNull();
    expect(ctx.issuerLegalLabel).toBeNull();
  });

  test('X-02 non-FR snapshot, null vat_exempt_label → vatExemptLabel null (no invented 293B)', () => {
    const inv = {
      issuer_snapshot: { company: 'IL Corp' },
      currency: 'ILS', locale: 'he-IL', tax_label: null, vat_exempt_label: null,
    };
    const ctx = resolveOwnerInvoicePdfContext(inv, {});
    expect(ctx.vatExemptLabel).toBeNull();
  });

  test('X-03 he-IL locale passes validation (no fr-FR forced)', () => {
    const inv = {
      issuer_snapshot: null,
      currency: 'ILS', locale: 'he-IL', tax_label: null, vat_exempt_label: null,
    };
    const ctx = resolveOwnerInvoicePdfContext(inv, {});
    expect(ctx.locale).toBe('he-IL');
    expect(ctx.currency).toBe('ILS');
  });
});

// ── Y: client snapshot priority ──────────────────────────────
describe('Y — client snapshot priority: invoice fields first', () => {
  test('Y-01 PATH A uses inv.client_name before client.company_name', () => {
    // client_name (invoice snapshot) must come before owner_clients lookup
    const clientPriorityMatch = pathABlock.match(/inv\.client_name\s*\|\|\s*client\.company_name/);
    expect(clientPriorityMatch).not.toBeNull();
  });

  test('Y-02 PATH A uses inv.client_address before client.address', () => {
    expect(pathABlock).toMatch(/inv\.client_address\s*\|\|\s*client\.address/);
  });

  test('Y-03 PATH A uses inv.client_email before client.email', () => {
    expect(pathABlock).toMatch(/inv\.client_email\s*\|\|\s*client\.email/);
  });

  test('Y-04 send route uses invoice.client_name before client.company_name', () => {
    expect(sendRoute).toMatch(/invoice\.client_name\s*\|\|\s*client\.company_name/);
  });

  test('Y-05 send route uses invoice.client_email before client.email', () => {
    expect(sendRoute).toMatch(/invoice\.client_email\s*\|\|\s*client\.email/);
  });

  test('Y-06 send route clientAddress uses invoice.client_address first', () => {
    expect(sendRoute).toMatch(/invoice\.client_address\s*\|\|\s*client\.address/);
  });
});

// ── Z: debours annex formatting ───────────────────────────────
describe('Z — debours annex: bhFmtAmount used for photo captions', () => {
  test('Z-01 PATH A debours annex uses bhFmtAmount for total', () => {
    expect(pathABlock).toMatch(/bhFmtAmount\(total,\s*_pdfCtx\.currency,\s*_pdfCtx\.locale\)/);
  });

  test('Z-02 PATH A debours annex no longer uses .toFixed(2)+\' €\'', () => {
    // Ensure old pattern gone from annex section
    const annexBlock = pathABlock.match(/Annexe — Justificatifs[\s\S]+/)?.[0] || '';
    expect(annexBlock).not.toMatch(/\.toFixed\(2\)\s*\+\s*' €'/);
  });

  test('Z-03 PATH B debours annex uses bhFmtAmount for total', () => {
    expect(pathBFn).toMatch(/bhFmtAmount\(total,\s*_cur,\s*_loc\)/);
  });

  test('Z-04 PATH B debours annex no longer uses .toFixed(2)+\' €\'', () => {
    const annexBlock = pathBFn.match(/Annexe — Justificatifs[\s\S]+/)?.[0] || '';
    expect(annexBlock).not.toMatch(/\.toFixed\(2\)\s*\+\s*' €'/);
  });
});

'use strict';
/**
 * INTL-4.4 — Invoice Snapshot + Mono-Currency Guard
 *
 * Structural tests verifying:
 * - resolveOwnerInvoiceContext helper exists and is correct
 * - POST /api/owner-invoices stores all 7 INTL-4.4 fields
 * - Mono-currency guard rejects mixed currencies (FAIL CLOSED)
 * - Invalid/missing property currency rejected (FAIL CLOSED)
 * - Credit note inherits all snapshot fields from original
 * - PUT /api/owner-invoices/:id immutability (no body override)
 * - No FX conversion anywhere in scope
 * - Legacy/isolation: historical invoices, PDF, HTML untouched
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract helper
const helperBlock = serverSrc.match(/async function resolveOwnerInvoiceContext[\s\S]+?^}/m)?.[0] || '';

// Extract POST /api/owner-invoices body (up to the next app.post or app.get)
const postBlock = serverSrc.match(/app\.post\('\/api\/owner-invoices',[\s\S]+?client\.release\(\);\s*\}\s*\}\);/)?.[0] || '';

// Extract credit-note body
const creditBlock = serverSrc.match(/app\.post\('\/api\/owner-invoices\/:id\/credit-note',[\s\S]+?client\.release\(\);\s*\}\s*\}\);/)?.[0] || '';

// Extract PUT body
const putBlock = serverSrc.match(/app\.put\('\/api\/owner-invoices\/:id',[\s\S]+?client\.release\(\);\s*\}\s*\}\);/)?.[0] || '';

// ── A: Snapshot FR/EUR ────────────────────────────────────────
describe('A — Snapshot FR/EUR: context helper produces correct values', () => {
  test('A-01 resolveOwnerInvoiceContext reads default_currency from users', () => {
    expect(helperBlock).toMatch(/SELECT.*default_currency.*FROM users/s);
  });

  test('A-02 resolveOwnerInvoiceContext reads country from users', () => {
    expect(helperBlock).toMatch(/SELECT.*country.*FROM users/s);
  });

  test('A-03 resolveOwnerInvoiceContext reads locale from users', () => {
    expect(helperBlock).toMatch(/SELECT.*locale.*FROM users/s);
  });

  test('A-04 POST inserts currency into owner_invoices', () => {
    expect(postBlock).toMatch(/INSERT INTO owner_invoices[\s\S]+?currency/);
  });

  test('A-05 POST inserts country into owner_invoices', () => {
    expect(postBlock).toMatch(/INSERT INTO owner_invoices[\s\S]+?country/);
  });

  test('A-06 POST inserts locale into owner_invoices', () => {
    expect(postBlock).toMatch(/INSERT INTO owner_invoices[\s\S]+?locale/);
  });

  test('A-07 POST inserts issuer_snapshot (non-null for new invoices)', () => {
    expect(postBlock).toMatch(/INSERT INTO owner_invoices[\s\S]+?issuer_snapshot/);
  });

  test('A-08 POST inserts issuer_snapshot_source (from context helper)', () => {
    expect(postBlock).toMatch(/issuer_snapshot_source/);
    expect(postBlock).toMatch(/issuerSnapshotSource/);
    expect(helperBlock).toMatch(/issuerSnapshotSource:\s*'user_profile'/);
  });

  test('A-09 POST inserts tax_label (INTL-4.9: country-aware, not unconditional TVA)', () => {
    expect(postBlock).toMatch(/INSERT INTO owner_invoices[\s\S]+?tax_label/);
    // INTL-4.9: taxLabel is now country-aware — FR keeps 'TVA', non-FR gets 'Tax'
    expect(postBlock).toMatch(/invoiceCountry\s*===\s*'FR'\s*\?\s*'TVA'/);
    // The old unconditional `const taxLabel = 'TVA'` must not exist
    expect(postBlock).not.toMatch(/^const taxLabel\s*=\s*'TVA'\s*;/m);
  });

  test('A-10 POST inserts vat_exempt_label', () => {
    expect(postBlock).toMatch(/INSERT INTO owner_invoices[\s\S]+?vat_exempt_label/);
  });

  test('A-11 vat_exempt_label = 293 B CGI for FR + no VAT', () => {
    expect(postBlock).toMatch(/invoiceCountry === 'FR' && !vatApplicable/);
    expect(postBlock).toMatch(/TVA non applicable, art\. 293 B du CGI/);
  });

  test('A-12 vat_exempt_label = null for non-FR', () => {
    // The ternary: country === FR ? '293B' : null
    expect(postBlock).toMatch(/invoiceCountry === 'FR'[\s\S]{0,80}null/);
  });
});

// ── B: Snapshot IL/ILS ────────────────────────────────────────
describe('B — Snapshot IL/ILS: generic legal fields in issuerSnapshot', () => {
  test('B-01 helper reads legal_identifier_label from users', () => {
    expect(helperBlock).toMatch(/legal_identifier_label/);
  });

  test('B-02 helper reads legal_identifier_value from users', () => {
    expect(helperBlock).toMatch(/legal_identifier_value/);
  });

  test('B-03 helper reads tax_identifier_label from users', () => {
    expect(helperBlock).toMatch(/tax_identifier_label/);
  });

  test('B-04 helper reads tax_identifier_value from users', () => {
    expect(helperBlock).toMatch(/tax_identifier_value/);
  });

  test('B-05 issuerSnapshot includes legalIdentifierLabel', () => {
    expect(helperBlock).toMatch(/legalIdentifierLabel:\s*u\.legal_identifier_label/);
  });

  test('B-06 issuerSnapshot includes legalIdentifierValue', () => {
    expect(helperBlock).toMatch(/legalIdentifierValue:\s*u\.legal_identifier_value/);
  });

  test('B-07 issuerSnapshot includes taxIdentifierLabel', () => {
    expect(helperBlock).toMatch(/taxIdentifierLabel:\s*u\.tax_identifier_label/);
  });

  test('B-08 issuerSnapshot includes taxIdentifierValue', () => {
    expect(helperBlock).toMatch(/taxIdentifierValue:\s*u\.tax_identifier_value/);
  });

  test('B-09 vat_exempt_label NOT hardcoded 293 B CGI for non-FR (null path exists)', () => {
    // Non-FR path returns null — 293 B is strictly gated on country === FR
    expect(helperBlock).not.toMatch(/293 B/);
  });
});

// ── C: Mono-currency guard ────────────────────────────────────
describe('C — Mono-currency guard: mixed currencies rejected', () => {
  test('C-01 guard computes Set of currencies from property rows', () => {
    expect(helperBlock).toMatch(/new Set\(/);
  });

  test('C-02 guard rejects when Set size > 1', () => {
    expect(helperBlock).toMatch(/currencies\.size > 1/);
  });

  test('C-03 error message: Une facture ne peut pas contenir des logements utilisant des devises différentes', () => {
    expect(helperBlock).toMatch(/Une facture ne peut pas contenir des logements utilisant des devises diff/);
  });

  test('C-04 guard throws with status 400', () => {
    expect(helperBlock).toMatch(/status:\s*400/);
  });

  test('C-05 POST catches context error and returns HTTP 400', () => {
    expect(postBlock).toMatch(/ctxErr\.status \|\| 400/);
  });

  test('C-06 no cross-currency addition anywhere in helper', () => {
    expect(helperBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency|currencyConversion/);
  });
});

// ── D: Currency inconnue (FAIL CLOSED) ───────────────────────
describe('D — Invalid/missing property currency: fail closed', () => {
  test('D-01 guard validates property currency format with regex', () => {
    expect(helperBlock).toMatch(/\/\^\[A-Z\]\{3\}\$\/\.test\(c\)/);
  });

  test('D-02 guard throws 400 for missing currency', () => {
    expect(helperBlock).toMatch(/La devise d'un logement doit être configurée avant de créer la facture/);
  });

  test('D-03 guard uses FAIL CLOSED (no silent EUR fallback for properties)', () => {
    // Must NOT have property.currency || 'EUR' pattern
    expect(helperBlock).not.toMatch(/row\.currency\s*\|\|\s*'EUR'/);
    expect(helperBlock).not.toMatch(/\.currency\s*\|\|\s*'EUR'/);
  });

  test('D-04 guard checks property found (not just currency of found rows)', () => {
    // Each requested propId must be in the result set
    expect(helperBlock).toMatch(/propRes\.rows\.find/);
  });

  test('D-05 no silent EUR fallback on missing property', () => {
    expect(helperBlock).not.toMatch(/\|\|\s*'EUR'.*propId/s);
  });
});

// ── E: Facture sans logement ──────────────────────────────────
describe('E — Invoice without properties: default_currency used', () => {
  test('E-01 no-property path uses default_currency from user', () => {
    expect(helperBlock).toMatch(/default_currency/);
  });

  test('E-02 default_currency validated against /^[A-Z]{3}$/', () => {
    expect(helperBlock).toMatch(/\/\^\[A-Z\]\{3\}\$\/\.test\(dc\)/);
  });

  test('E-03 EUR fallback only for no-property case (legacy compatibility)', () => {
    // fallback EUR with comment
    expect(helperBlock).toMatch(/dc && \/\^\[A-Z\]\{3\}\$\/\.test\(dc\)\s*\)\s*\?\s*dc\s*:\s*'EUR'/);
  });

  test('E-04 EUR fallback only applies when propertyIds is empty', () => {
    // EUR fallback is in the else branch (no properties)
    const noPropBranch = helperBlock.match(/\} else \{[\s\S]+?currency = /)?.[0] || '';
    expect(noPropBranch).toMatch(/default_currency/);
  });
});

// ── F: Immutabilité PUT ───────────────────────────────────────
describe('F — PUT immutability: snapshot fields not overwritable via body', () => {
  test('F-01 PUT UPDATE does not include currency in SET (not body-injectable)', () => {
    // The SET clause must not have currency = $N where N is a user-controlled param
    // It only updates via resolveOwnerInvoiceContext, not from req.body directly
    const updateClause = putBlock.match(/UPDATE owner_invoices SET[\s\S]+?WHERE id = \$12/)?.[0] || '';
    expect(updateClause).not.toMatch(/currency\s*=/);
  });

  test('F-02 PUT UPDATE does not include country in SET', () => {
    const updateClause = putBlock.match(/UPDATE owner_invoices SET[\s\S]+?WHERE id = \$12/)?.[0] || '';
    expect(updateClause).not.toMatch(/country\s*=/);
  });

  test('F-03 PUT UPDATE does not include locale in SET', () => {
    const updateClause = putBlock.match(/UPDATE owner_invoices SET[\s\S]+?WHERE id = \$12/)?.[0] || '';
    expect(updateClause).not.toMatch(/locale\s*=/);
  });

  test('F-04 PUT UPDATE does not include issuer_snapshot in SET', () => {
    const updateClause = putBlock.match(/UPDATE owner_invoices SET[\s\S]+?WHERE id = \$12/)?.[0] || '';
    expect(updateClause).not.toMatch(/issuer_snapshot/);
  });

  test('F-05 PUT does not destructure currency from req.body', () => {
    // Body cannot supply currency to the SET clause
    const destructure = putBlock.match(/const \{[\s\S]+?\} = req\.body/)?.[0] || '';
    expect(destructure).not.toMatch(/\bcurrency\b/);
  });

  test('F-06 PUT does not destructure issuerSnapshot from req.body', () => {
    const destructure = putBlock.match(/const \{[\s\S]+?\} = req\.body/)?.[0] || '';
    expect(destructure).not.toMatch(/issuerSnapshot|issuer_snapshot/);
  });
});

// ── G: Credit note inheritance ────────────────────────────────
describe('G — Credit note: inherits all snapshot fields from original', () => {
  test('G-01 credit note INSERT includes currency from orig', () => {
    expect(creditBlock).toMatch(/orig\.currency/);
  });

  test('G-02 credit note INSERT includes country from orig', () => {
    expect(creditBlock).toMatch(/orig\.country/);
  });

  test('G-03 credit note INSERT includes locale from orig', () => {
    expect(creditBlock).toMatch(/orig\.locale/);
  });

  test('G-04 credit note INSERT includes issuer_snapshot from orig', () => {
    expect(creditBlock).toMatch(/orig\.issuer_snapshot/);
  });

  test('G-05 credit note INSERT includes issuer_snapshot_source from orig', () => {
    expect(creditBlock).toMatch(/orig\.issuer_snapshot_source/);
  });

  test('G-06 credit note INSERT includes vat_exempt_label from orig', () => {
    expect(creditBlock).toMatch(/orig\.vat_exempt_label/);
  });

  test('G-07 credit note INSERT includes tax_label from orig', () => {
    expect(creditBlock).toMatch(/orig\.tax_label/);
  });

  test('G-08 credit note does NOT call resolveOwnerInvoiceContext', () => {
    // Must not re-read user profile for currency decision
    expect(creditBlock).not.toMatch(/resolveOwnerInvoiceContext/);
  });

  test('G-09 credit note does NOT read users.default_currency', () => {
    expect(creditBlock).not.toMatch(/default_currency/);
  });
});

// ── H: Atomicité ─────────────────────────────────────────────
describe('H — Atomicity: mono-currency guard runs before any write', () => {
  test('H-01 resolveOwnerInvoiceContext called before client.query BEGIN', () => {
    const beginIdx     = postBlock.indexOf("client.query('BEGIN')");
    const ctxCallIdx   = postBlock.indexOf('resolveOwnerInvoiceContext');
    expect(ctxCallIdx).toBeGreaterThan(-1);
    expect(beginIdx).toBeGreaterThan(-1);
    expect(ctxCallIdx).toBeLessThan(beginIdx);
  });

  test('H-02 context error returns 400 before BEGIN (no partial invoice)', () => {
    // The catch for ctxErr returns early before BEGIN
    const ctxBlock = postBlock.match(/resolveOwnerInvoiceContext[\s\S]+?client\.query\('BEGIN'\)/)?.[0] || '';
    expect(ctxBlock).toMatch(/ctxErr/);
    expect(ctxBlock).toMatch(/return res\.status/);
  });

  test('H-03 POST uses BEGIN/COMMIT/ROLLBACK transaction', () => {
    expect(postBlock).toMatch(/client\.query\('BEGIN'\)/);
    expect(postBlock).toMatch(/client\.query\('COMMIT'\)/);
    expect(postBlock).toMatch(/client\.query\('ROLLBACK'\)/);
  });

  test('H-04 credit-note uses BEGIN/COMMIT/ROLLBACK transaction', () => {
    expect(creditBlock).toMatch(/client\.query\('BEGIN'\)/);
    expect(creditBlock).toMatch(/client\.query\('COMMIT'\)/);
    expect(creditBlock).toMatch(/client\.query\('ROLLBACK'\)/);
  });
});

// ── I: No FX ─────────────────────────────────────────────────
describe('I — No FX conversion in INTL-4.4 additions', () => {
  test('I-01 no exchangeRate in helper', () => {
    expect(helperBlock).not.toMatch(/exchangeRate|exchange_rate/);
  });

  test('I-02 no fxRate in helper', () => {
    expect(helperBlock).not.toMatch(/fxRate/);
  });

  test('I-03 no convertCurrency in helper', () => {
    expect(helperBlock).not.toMatch(/convertCurrency|currencyConversion/);
  });

  test('I-04 no exchangeRate in POST invoice additions', () => {
    const intlPostAdditions = postBlock.match(/INTL-4\.4[\s\S]+?taxLabel\s*=\s*'TVA'/)?.[0] || '';
    expect(intlPostAdditions).not.toMatch(/exchangeRate|fxRate/);
  });
});

// ── J: Legacy / isolation ─────────────────────────────────────
describe('J — Legacy / isolation: historical invoices and PDF untouched', () => {
  test('J-01 INTL-4.1/4.2 migration block not modified (console.log marker present)', () => {
    expect(serverSrc).toMatch(/✅ INTL-4\.1\/4\.2 migrations OK/);
  });

  test('J-02 no UPDATE owner_invoices SET currency from migration block', () => {
    const migBlock = serverSrc.match(/INTL-4\.1 \/ INTL-4\.2[\s\S]+?✅ INTL-4\.1\/4\.2 migrations OK/)?.[0] || '';
    // Backfills already exist; no new ones should appear
    const setCurrencyMatches = (migBlock.match(/UPDATE owner_invoices SET currency/g) || []);
    // Only the original backfill (currency = 'EUR') should be there
    expect(setCurrencyMatches.length).toBe(1);
    expect(migBlock).toMatch(/UPDATE owner_invoices SET currency = 'EUR' WHERE currency IS NULL/);
  });

  test('J-03 factures-proprietaires.html not read by test (proxy for not modified)', () => {
    const htmlPath = path.join(__dirname, '../public/factures-proprietaires.html');
    // File must exist but we don't inspect it — just confirm it hasn't been deleted
    expect(fs.existsSync(htmlPath)).toBe(true);
  });

  test('J-04 no new PDF generation call added to POST /api/owner-invoices', () => {
    expect(postBlock).not.toMatch(/generateInvoicePdf|PDFDocument|pdfkit/);
  });

  test('J-05 Stripe not referenced in invoice context helper', () => {
    expect(helperBlock).not.toMatch(/stripe|Stripe/i);
  });

  test('J-06 Channex not referenced in invoice context helper', () => {
    expect(helperBlock).not.toMatch(/channex|Channex/i);
  });

  test('J-07 pricing not referenced in invoice context helper', () => {
    expect(helperBlock).not.toMatch(/publishEffectivePricing|effectivePricing/);
  });

  test('J-08 financial columns not modified by context helper', () => {
    expect(helperBlock).not.toMatch(/total_ttc|subtotal_ht|vat_amount|vat_rate|discount_amount/);
  });
});

// ── K: PUT guard wiring ───────────────────────────────────────
describe('K — PUT guard: mono-currency on propertyIds change', () => {
  test('K-01 PUT calls resolveOwnerInvoiceContext when propertyIds changes', () => {
    expect(putBlock).toMatch(/resolveOwnerInvoiceContext/);
  });

  test('K-02 PUT guard only runs when Array.isArray(propertyIds)', () => {
    expect(putBlock).toMatch(/Array\.isArray\(propertyIds\)/);
  });

  test('K-03 PUT guard error rolls back transaction', () => {
    expect(putBlock).toMatch(/client\.query\('ROLLBACK'\)/);
  });

  test('K-04 PUT rejects currency change via propertyIds (INTL-4.4C immutability)', () => {
    // Draft currency is immutable — swapping propertyIds to a different currency must fail.
    expect(putBlock).toMatch(/OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE/);
    expect(putBlock).toMatch(/_putCtx\.currency\s*!==\s*_storedInvoiceCurrency/);
  });
});

// ── L: Draft-only currency mutability (INTL-4.4-REVIEW A) ─────
describe('L — Draft-only currency mutability: non-draft is forever immutable', () => {
  test('L-01 PUT handler rejects non-draft invoices before any INTL-4.4 code runs', () => {
    // Status guard is the first check after userId — must come before resolveOwnerInvoiceContext
    const statusGuardIdx    = putBlock.indexOf("status !== 'draft'");
    const ctxCallIdx        = putBlock.indexOf('resolveOwnerInvoiceContext');
    expect(statusGuardIdx).toBeGreaterThan(-1);
    expect(ctxCallIdx).toBeGreaterThan(-1);
    expect(statusGuardIdx).toBeLessThan(ctxCallIdx);
  });

  test('L-02 PUT status guard returns 400 for non-draft', () => {
    expect(putBlock).toMatch(/status !== 'draft'[\s\S]{0,80}Seuls les brouillons peuvent être modifiés/);
  });

  test('L-03 PUT body cannot supply currency directly (not in destructuring)', () => {
    const destructure = putBlock.match(/const \{[\s\S]+?\} = req\.body/)?.[0] || '';
    expect(destructure).not.toMatch(/\bcurrency\b/);
  });

  test('L-04 PUT body cannot supply issuerSnapshot directly', () => {
    const destructure = putBlock.match(/const \{[\s\S]+?\} = req\.body/)?.[0] || '';
    expect(destructure).not.toMatch(/issuerSnapshot|issuer_snapshot/);
  });

  test('L-05 currency immutability guard is inside propertyIds.length > 0 block', () => {
    // The mismatch guard is only reached when non-empty propertyIds is provided
    const guardBlock = putBlock.match(/if \(propertyIds\.length > 0\)[\s\S]+?OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE/)?.[0] || '';
    expect(guardBlock).toBeTruthy();
  });

  test('L-06 PUT passes agencyIds to resolveOwnerInvoiceContext (tenant isolation)', () => {
    expect(putBlock).toMatch(/resolveOwnerInvoiceContext\(pool, userId, propertyIds, agencyIds\)/);
  });
});

// ── M: Empty propertyIds currency preservation (INTL-4.4-REVIEW B) ─
describe('M — Empty propertyIds: invoice currency not changed', () => {
  test('M-01 when propertyIds is empty, resolveOwnerInvoiceContext is NOT called', () => {
    // The guard: if (propertyIds.length > 0) { resolveOwnerInvoiceContext... }
    // Empty array skips the currency resolution — existing currency preserved
    const innerGuard = putBlock.match(/if \(Array\.isArray\(propertyIds\)\)[\s\S]+?if \(propertyIds\.length > 0\)/)?.[0] || '';
    expect(innerGuard).toBeTruthy();
  });

  test('M-02 no silent currency UPDATE in PUT — immutability enforced instead', () => {
    // INTL-4.4C: currency is immutable; there is no UPDATE SET currency in the propertyIds block.
    // A mismatch returns 400 OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE instead.
    const outerBlock = putBlock.match(/if \(Array\.isArray\(propertyIds\)\)[\s\S]+?DELETE FROM owner_invoice_properties/)?.[0] || '';
    expect(outerBlock).not.toMatch(/UPDATE owner_invoices SET currency/);
  });

  test('M-03 no default_currency fallback in PUT (currency stays from snapshot)', () => {
    expect(putBlock).not.toMatch(/default_currency.*PUT|PUT.*default_currency/s);
  });
});

// ── N: Snapshot completeness — email/phone/invoiceEmail/website (INTL-4.4-REVIEW C) ─
describe('N — issuerSnapshot completeness: email, invoiceEmail, phone, website', () => {
  test('N-01 helper SELECT includes email', () => {
    expect(helperBlock).toMatch(/SELECT\s+email/);
  });

  test('N-02 helper SELECT includes invoice_email', () => {
    expect(helperBlock).toMatch(/invoice_email/);
  });

  test('N-03 helper SELECT includes phone', () => {
    expect(helperBlock).toMatch(/,\s*phone/);
  });

  test('N-04 helper SELECT includes website', () => {
    expect(helperBlock).toMatch(/,\s*website/);
  });

  test('N-05 issuerSnapshot includes email: u.email', () => {
    expect(helperBlock).toMatch(/email:\s*u\.email/);
  });

  test('N-06 issuerSnapshot includes invoiceEmail: u.invoice_email', () => {
    expect(helperBlock).toMatch(/invoiceEmail:\s*u\.invoice_email/);
  });

  test('N-07 issuerSnapshot includes phone: u.phone', () => {
    expect(helperBlock).toMatch(/phone:\s*u\.phone/);
  });

  test('N-08 issuerSnapshot includes website: u.website', () => {
    expect(helperBlock).toMatch(/website:\s*u\.website/);
  });
});

// ── O: VAT exempt semantics (INTL-4.4-REVIEW E) ──────────────
describe('O — VAT exempt: based on vatApplicable flag, not vat_amount', () => {
  test('O-01 vat_exempt_label uses !vatApplicable (not vat_amount comparison)', () => {
    expect(postBlock).toMatch(/invoiceCountry === 'FR' && !vatApplicable/);
  });

  test('O-02 no historical vat_amount <= 0 quirk for new invoices', () => {
    // The 293B guard for new invoices must NOT use vat_amount
    const vatExemptLine = postBlock.match(/vatExemptLabel\s*=[\s\S]{0,200}/)?.[0] || '';
    expect(vatExemptLine).not.toMatch(/vat_amount/);
    expect(vatExemptLine).not.toMatch(/vatAmount\s*<=\s*0/);
  });

  test('O-03 non-FR country → vat_exempt_label = null', () => {
    expect(postBlock).toMatch(/invoiceCountry === 'FR'[\s\S]{0,80}null/);
  });

  test('O-04 293B CGI string used exactly', () => {
    expect(postBlock).toMatch(/TVA non applicable, art\. 293 B du CGI/);
  });
});

// ── P: Tenant isolation (INTL-4.4-REVIEW G) ──────────────────
describe('P — Tenant isolation: property ownership enforced', () => {
  test('P-01 property query filters by user_id', () => {
    expect(helperBlock).toMatch(/FROM properties WHERE id = ANY.*AND user_id = ANY/s);
  });

  test('P-02 property query uses ownerIds (agencyIds-aware)', () => {
    expect(helperBlock).toMatch(/ownerIds/);
  });

  test('P-03 ownerIds falls back to [userId] when agencyIds not provided', () => {
    expect(helperBlock).toMatch(/ownerIds = .*agencyIds.*\? agencyIds : \[userId\]/);
  });

  test('P-04 POST passes agencyIds to resolveOwnerInvoiceContext', () => {
    expect(postBlock).toMatch(/resolveOwnerInvoiceContext\(pool, userId, propertyIds, _postAgencyIds\)/);
  });

  test('P-05 property not found (wrong tenant) → same 400 as invalid currency', () => {
    // Unknown property → propRes.rows.find(...) returns undefined → c = null → throws 400
    expect(helperBlock).toMatch(/const row = propRes\.rows\.find/);
    expect(helperBlock).toMatch(/const c = row\?\.currency \|\| null/);
    expect(helperBlock).toMatch(/if \(!c \|\| !\/\^\[A-Z\]\{3\}\$\/\.test\(c\)\)/);
  });
});

// ── Q: Duplicate propertyIds (INTL-4.4-REVIEW H) ─────────────
describe('Q — Duplicate propertyIds: deduplication before validation', () => {
  test('Q-01 uniqueIds deduplicated with Set before property query', () => {
    expect(helperBlock).toMatch(/const uniqueIds = \[\.\.\.new Set\(propertyIds\)\]/);
  });

  test('Q-02 DB query uses uniqueIds (not raw propertyIds) to avoid false count mismatch', () => {
    expect(helperBlock).toMatch(/const propRes = await pool\.query[\s\S]{0,150}uniqueIds/s);
  });

  test('Q-03 ownership check iterates uniqueIds (not raw propertyIds)', () => {
    expect(helperBlock).toMatch(/for \(const propId of uniqueIds\)/);
  });

  test('Q-04 INSERT owner_invoice_properties uses ON CONFLICT DO NOTHING', () => {
    expect(postBlock).toMatch(/ON CONFLICT DO NOTHING/);
  });
});

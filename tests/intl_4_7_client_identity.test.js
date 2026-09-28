'use strict';
/**
 * INTL-4.7 / INTL-4.7R — International Owner Client Identity + Snapshot Authority
 *
 * Structural checks: reads server.js and public/factures-proprietaires.html to verify
 * that owner_clients and owner_invoices support generic legal/tax identifier fields,
 * that existing invoices use ONLY their stored snapshot (no live owner_clients fallback),
 * that new invoices snapshot the client at creation, that credit notes inherit the
 * original invoice snapshot, and that draft client-change triggers a fresh re-snapshot.
 */

const fs   = require('fs');
const path = require('path');

const srv = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const fe  = fs.readFileSync(path.join(__dirname, '../public/factures-proprietaires.html'), 'utf8');

// ── Extract key blocks ────────────────────────────────────────────────────────
const migBlock    = srv.match(/INTL-4\.7 — Owner Client Identity[\s\S]+?console\.log\('✅ INTL-4\.7[^']*'\)/)?.[0] || '';
const postClient  = srv.match(/app\.post\('\/api\/owner-clients'[\s\S]+?res\.json\(\{ client:[\s\S]+?\}\);[\s\S]+?\}\);/)?.[0] || '';
const putClient   = srv.match(/app\.put\('\/api\/owner-clients\/:id'[\s\S]+?res\.json\(\{ client:[\s\S]+?\}\);[\s\S]+?\}\);/)?.[0] || '';
const postInv     = srv.match(/app\.post\('\/api\/owner-invoices'[\s\S]+?^\}\);/m)?.[0] || '';
const creditNote  = srv.match(/INTL-4\.7 — L'avoir h[\s\S]+?^\s*\]\);/m)?.[0] || '';
const pathABlock  = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/pdf'[\s\S]+?^\}\);/m)?.[0] || '';
const pathBFn     = srv.match(/async function sendOwnerInvoiceEmail[\s\S]+?^}/m)?.[0] || '';
const sendRoute   = srv.match(/app\.post\('\/api\/owner-invoices\/:id\/send'[\s\S]+?^\}\);/m)?.[0] || '';
const putInvRoute = srv.match(/app\.put\('\/api\/owner-invoices\/:id'[\s\S]+?^\}\);/m)?.[0] || '';

const dlBlock     = fe.match(/window\.downloadOwnerInvoice\s*=\s*async function[\s\S]+?^  };/m)?.[0] || '';
const editClient  = fe.match(/window\.editClient\s*=\s*(?:async )?function[\s\S]+?^};/m)?.[0]
                  || fe.match(/function editClient\b[\s\S]+?^}/m)?.[0] || '';
const saveClient  = fe.match(/window\.saveClient\s*=\s*(?:async )?function[\s\S]+?^};/m)?.[0]
                  || fe.match(/(?:async )?function saveClient\b[\s\S]+?^}/m)?.[0] || '';
const previewBlock = fe.match(/window\.updatePreview\s*=\s*function[\s\S]+?^  };/m)?.[0] || '';

// ── A: Migration IIFE — schema ALTER TABLE ────────────────────────────────────
describe('A — INTL-4.7 migration: owner_clients schema', () => {
  test('A-01 migration IIFE present with INTL-4.7 comment', () => {
    expect(srv).toMatch(/INTL-4\.7 — Owner Client Identity/);
  });

  test('A-02 adds legal_identifier_label to owner_clients', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_clients ADD COLUMN IF NOT EXISTS legal_identifier_label/);
  });

  test('A-03 adds legal_identifier_value to owner_clients', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_clients ADD COLUMN IF NOT EXISTS legal_identifier_value/);
  });

  test('A-04 adds tax_identifier_label to owner_clients', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_clients ADD COLUMN IF NOT EXISTS tax_identifier_label/);
  });

  test('A-05 adds tax_identifier_value to owner_clients', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_clients ADD COLUMN IF NOT EXISTS tax_identifier_value/);
  });

  test('A-06 adds client_legal_identifier_label to owner_invoices', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS client_legal_identifier_label/);
  });

  test('A-07 adds client_legal_identifier_value to owner_invoices', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS client_legal_identifier_value/);
  });

  test('A-08 adds client_tax_identifier_label to owner_invoices', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS client_tax_identifier_label/);
  });

  test('A-09 adds client_tax_identifier_value to owner_invoices', () => {
    expect(migBlock).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS client_tax_identifier_value/);
  });

  test('A-10 success log confirms migration ran', () => {
    expect(migBlock).toMatch(/INTL-4\.7 migrations OK/);
  });
});

// ── B: Backfill logic ─────────────────────────────────────────────────────────
describe('B — INTL-4.7 backfill: siret → generic identifier', () => {
  test('B-01 backfills owner_clients.legal_identifier_label from siret', () => {
    expect(migBlock).toMatch(/SET legal_identifier_label = 'SIRET'/);
    expect(migBlock).toMatch(/legal_identifier_value = siret/);
  });

  test('B-02 backfill is guarded: only when siret IS NOT NULL', () => {
    expect(migBlock).toMatch(/siret IS NOT NULL/);
  });

  test('B-03 backfill is idempotent: only when legal_identifier_label IS NULL', () => {
    // Both label and value must be null (prevents double-backfill)
    expect(migBlock).toMatch(/legal_identifier_label IS NULL/);
    expect(migBlock).toMatch(/legal_identifier_value IS NULL/);
  });

  test('B-04 backfills owner_invoices.client_legal_identifier_label from client_siret', () => {
    expect(migBlock).toMatch(/SET client_legal_identifier_label = 'SIRET'/);
    expect(migBlock).toMatch(/client_legal_identifier_value = client_siret/);
  });

  test('B-05 invoice backfill guarded: client_siret IS NOT NULL', () => {
    expect(migBlock).toMatch(/client_siret IS NOT NULL/);
  });

  test('B-06 invoice backfill is idempotent: client_legal_identifier_label IS NULL', () => {
    expect(migBlock).toMatch(/client_legal_identifier_label IS NULL/);
    expect(migBlock).toMatch(/client_legal_identifier_value IS NULL/);
  });
});

// ── C: POST /api/owner-clients — INSERT accepts generic fields ────────────────
describe('C — POST /api/owner-clients: generic fields accepted', () => {
  test('C-01 legalIdentifierLabel destructured from req.body', () => {
    expect(postClient).toMatch(/legalIdentifierLabel/);
  });

  test('C-02 legalIdentifierValue destructured from req.body', () => {
    expect(postClient).toMatch(/legalIdentifierValue/);
  });

  test('C-03 taxIdentifierLabel destructured from req.body', () => {
    expect(postClient).toMatch(/taxIdentifierLabel/);
  });

  test('C-04 taxIdentifierValue destructured from req.body', () => {
    expect(postClient).toMatch(/taxIdentifierValue/);
  });

  test('C-05 legal_identifier_label included in INSERT column list', () => {
    expect(postClient).toMatch(/legal_identifier_label/);
  });

  test('C-06 tax_identifier_label included in INSERT column list', () => {
    expect(postClient).toMatch(/tax_identifier_label/);
  });

  test('C-07 values trimmed before insert', () => {
    expect(postClient).toMatch(/String\(legalIdentifierLabel\)\.trim\(\)/);
  });
});

// ── D: PUT /api/owner-clients/:id — UPDATE accepts generic fields ─────────────
describe('D — PUT /api/owner-clients/:id: generic fields updated', () => {
  test('D-01 legal_identifier_label in SET clause', () => {
    expect(putClient).toMatch(/legal_identifier_label\s*=\s*\$12/);
  });

  test('D-02 legal_identifier_value in SET clause', () => {
    expect(putClient).toMatch(/legal_identifier_value\s*=\s*\$13/);
  });

  test('D-03 tax_identifier_label in SET clause', () => {
    expect(putClient).toMatch(/tax_identifier_label\s*=\s*\$14/);
  });

  test('D-04 tax_identifier_value in SET clause', () => {
    expect(putClient).toMatch(/tax_identifier_value\s*=\s*\$15/);
  });

  test('D-05 values trimmed before update', () => {
    expect(putClient).toMatch(/String\(legalIdentifierLabel\)\.trim\(\)/);
  });
});

// ── E: New invoice creation — snapshot uses generic fields ────────────────────
describe('E — POST /api/owner-invoices: client identity snapshot', () => {
  test('E-01 _snapClientLegalLabel computed from _clientRow', () => {
    expect(postInv).toMatch(/_snapClientLegalLabel/);
  });

  test('E-02 _snapClientLegalValue computed from _clientRow', () => {
    expect(postInv).toMatch(/_snapClientLegalValue/);
  });

  test('E-03 _snapClientTaxLabel computed from _clientRow', () => {
    expect(postInv).toMatch(/_snapClientTaxLabel/);
  });

  test('E-04 _snapClientTaxValue computed from _clientRow', () => {
    expect(postInv).toMatch(/_snapClientTaxValue/);
  });

  test('E-05 client_legal_identifier_label column in INSERT', () => {
    expect(postInv).toMatch(/client_legal_identifier_label/);
  });

  test('E-06 client_tax_identifier_label column in INSERT', () => {
    expect(postInv).toMatch(/client_tax_identifier_label/);
  });

  test('E-07 legacy fallback: siret → SIRET when generic fields absent', () => {
    // Snapshot builder: legal_identifier_label || (siret ? 'SIRET' : null)
    expect(postInv).toMatch(/_clientRow\.legal_identifier_label\s*\|\|\s*\(_clientRow\.siret\s*\?\s*'SIRET'/);
  });

  test('E-08 _clientRow read from owner_clients before snapshot', () => {
    expect(postInv).toMatch(/SELECT \* FROM owner_clients WHERE id = \$1/);
  });
});

// ── F: Credit note inherits original invoice snapshot ─────────────────────────
describe('F — Credit note: client identity inherited from original invoice', () => {
  test('F-01 credit note INSERT comment references INTL-4.7', () => {
    expect(creditNote).toMatch(/INTL-4\.7/);
  });

  test('F-02 credit note uses orig.client_legal_identifier_label', () => {
    expect(creditNote).toMatch(/orig\.client_legal_identifier_label/);
  });

  test('F-03 credit note uses orig.client_legal_identifier_value', () => {
    expect(creditNote).toMatch(/orig\.client_legal_identifier_value/);
  });

  test('F-04 credit note uses orig.client_tax_identifier_label', () => {
    expect(creditNote).toMatch(/orig\.client_tax_identifier_label/);
  });

  test('F-05 credit note uses orig.client_tax_identifier_value', () => {
    expect(creditNote).toMatch(/orig\.client_tax_identifier_value/);
  });

  test('F-06 comment: must not re-read owner_clients for credit note', () => {
    // Principle: snapshot is immutable; credit note copies from orig
    expect(srv).toMatch(/Ne pas relire users ni owner_clients/);
  });
});

// ── G: PDF PATH A — renders generic client identity ──────────────────────────
describe('G — PDF PATH A: generic client identity rendered', () => {
  test('G-01 INTL-4.7 comment in PATH A block', () => {
    expect(pathABlock).toMatch(/INTL-4\.7/);
  });

  test('G-02 clientLegalLabel resolved: invoice snapshot first', () => {
    expect(pathABlock).toMatch(/inv\.client_legal_identifier_label/);
  });

  test('G-03 clientLegalLabel falls back to legacy client_siret', () => {
    expect(pathABlock).toMatch(/inv\.client_siret\s*\?\s*'SIRET'/);
  });

  test('G-04 no live client.legal_identifier_label fallback in PATH A (snapshot authority)', () => {
    // INTL-4.7R: existing invoice must not drift when owner_clients changes
    const pathAClientBlock = pathABlock.match(/INTL-4\.7R[\s\S]+?clientTaxValue/)?.[0] || pathABlock;
    expect(pathAClientBlock).not.toMatch(/client\.legal_identifier_label/);
  });

  test('G-05 clientLegalValue resolved: invoice snapshot → legacy siret only', () => {
    expect(pathABlock).toMatch(/clientLegalValue/);
    expect(pathABlock).toMatch(/inv\.client_legal_identifier_value/);
  });

  test('G-06 clientTaxLabel and clientTaxValue resolved', () => {
    expect(pathABlock).toMatch(/clientTaxLabel/);
    expect(pathABlock).toMatch(/clientTaxValue/);
  });

  test('G-07 legal identity rendered in DESTINATAIRE section', () => {
    // doc.text with clientLegalLabel
    expect(pathABlock).toMatch(/clientLegalLabel.*clientLegalValue/s);
  });

  test('G-08 tax identity rendered only when both label and value present', () => {
    expect(pathABlock).toMatch(/clientTaxLabel && clientTaxValue/);
  });
});

// ── H: PDF PATH B (sendOwnerInvoiceEmail) — renders generic identity ──────────
describe('H — PDF PATH B: sendOwnerInvoiceEmail generic identity', () => {
  test('H-01 function signature includes clientLegalIdentifierLabel', () => {
    expect(pathBFn).toMatch(/clientLegalIdentifierLabel/);
  });

  test('H-02 function signature includes clientLegalIdentifierValue', () => {
    expect(pathBFn).toMatch(/clientLegalIdentifierValue/);
  });

  test('H-03 function signature includes clientTaxIdentifierLabel', () => {
    expect(pathBFn).toMatch(/clientTaxIdentifierLabel/);
  });

  test('H-04 function signature includes clientTaxIdentifierValue', () => {
    expect(pathBFn).toMatch(/clientTaxIdentifierValue/);
  });

  test('H-05 INTL-4.7 comment in PATH B', () => {
    expect(pathBFn).toMatch(/INTL-4\.7/);
  });

  test('H-06 _cLegalLbl resolves with legacy clientSiret fallback', () => {
    expect(pathBFn).toMatch(/_cLegalLbl\s*=\s*clientLegalIdentifierLabel\s*\|\|.*clientSiret\s*\?\s*'SIRET'/s);
  });

  test('H-07 _cLegalVal uses clientLegalIdentifierValue then clientSiret', () => {
    expect(pathBFn).toMatch(/_cLegalVal\s*=\s*clientLegalIdentifierValue\s*\|\|\s*clientSiret/);
  });

  test('H-08 tax identity rendered in PATH B', () => {
    expect(pathBFn).toMatch(/clientTaxIdentifierLabel && clientTaxIdentifierValue/);
  });
});

// ── I: Call site for sendOwnerInvoiceEmail — snapshot-first resolution ─────────
describe('I — sendOwnerInvoiceEmail call site: snapshot-first resolution', () => {
  test('I-01 clientLegalIdentifierLabel passed at call site', () => {
    expect(sendRoute).toMatch(/clientLegalIdentifierLabel/);
  });

  test('I-02 invoice snapshot checked first for legal label', () => {
    expect(sendRoute).toMatch(/invoice\.client_legal_identifier_label/);
  });

  test('I-03 invoice client_siret used as legacy fallback for label', () => {
    expect(sendRoute).toMatch(/invoice\.client_siret\s*\?\s*'SIRET'/);
  });

  test('I-04 clientTaxIdentifierLabel passed at call site', () => {
    expect(sendRoute).toMatch(/clientTaxIdentifierLabel/);
  });

  test('I-05 no live client.legal_identifier_label fallback at call site (snapshot authority)', () => {
    // INTL-4.7R: call site must not fall back to owner_clients for existing invoice identity
    const callSiteBlock = sendRoute.match(/INTL-4\.7R[\s\S]+?clientTaxIdentifierValue:/)?.[0] || sendRoute;
    expect(callSiteBlock).not.toMatch(/client\.legal_identifier_label/);
    expect(callSiteBlock).not.toMatch(/client\.tax_identifier_label/);
  });
});

// ── J: Frontend client form — 4 new input elements ───────────────────────────
describe('J — Frontend: client form has generic identifier fields', () => {
  test('J-01 clientLegalIdentifierLabel input present', () => {
    expect(fe).toMatch(/id="clientLegalIdentifierLabel"/);
  });

  test('J-02 clientLegalIdentifierValue input present', () => {
    expect(fe).toMatch(/id="clientLegalIdentifierValue"/);
  });

  test('J-03 clientTaxIdentifierLabel input present', () => {
    expect(fe).toMatch(/id="clientTaxIdentifierLabel"/);
  });

  test('J-04 clientTaxIdentifierValue input present', () => {
    expect(fe).toMatch(/id="clientTaxIdentifierValue"/);
  });

  test('J-05 legal identifier label placeholder suggests EIN/UID/SIRET', () => {
    expect(fe).toMatch(/placeholder="Ex: SIRET, EIN, UID"/);
  });

  test('J-06 tax identifier label placeholder suggests VAT ID', () => {
    expect(fe).toMatch(/placeholder="Ex: N° TVA, VAT ID"/);
  });
});

// ── K: Frontend editClient — populates 4 new fields ──────────────────────────
describe('K — Frontend editClient: generic fields populated', () => {
  test('K-01 editClient populates clientLegalIdentifierLabel', () => {
    expect(editClient).toMatch(/clientLegalIdentifierLabel.*legal_identifier_label/s);
  });

  test('K-02 editClient populates clientLegalIdentifierValue', () => {
    expect(editClient).toMatch(/clientLegalIdentifierValue.*legal_identifier_value/s);
  });

  test('K-03 editClient populates clientTaxIdentifierLabel', () => {
    expect(editClient).toMatch(/clientTaxIdentifierLabel.*tax_identifier_label/s);
  });

  test('K-04 editClient populates clientTaxIdentifierValue', () => {
    expect(editClient).toMatch(/clientTaxIdentifierValue.*tax_identifier_value/s);
  });
});

// ── L: Frontend saveClient — sends 4 new fields in payload ───────────────────
describe('L — Frontend saveClient: generic fields sent in payload', () => {
  test('L-01 saveClient sends legalIdentifierLabel', () => {
    expect(saveClient).toMatch(/legalIdentifierLabel/);
  });

  test('L-02 saveClient sends legalIdentifierValue', () => {
    expect(saveClient).toMatch(/legalIdentifierValue/);
  });

  test('L-03 saveClient sends taxIdentifierLabel', () => {
    expect(saveClient).toMatch(/taxIdentifierLabel/);
  });

  test('L-04 saveClient sends taxIdentifierValue', () => {
    expect(saveClient).toMatch(/taxIdentifierValue/);
  });

  test('L-05 null sent when field is empty (trim || null pattern)', () => {
    expect(saveClient).toMatch(/\.trim\(\)\s*\|\|\s*null/);
  });
});

// ── M: Frontend downloadOwnerInvoice — snapshot-first client identity ──────────
describe('M — Frontend downloadOwnerInvoice: snapshot-first client identity', () => {
  test('M-01 _cliLegalLabel resolved: invoice snapshot checked first', () => {
    expect(dlBlock).toMatch(/inv\.client_legal_identifier_label/);
  });

  test('M-02 _cliLegalLabel falls back to legacy client_siret with SIRET label', () => {
    expect(dlBlock).toMatch(/inv\.client_siret\s*\?\s*'SIRET'/);
  });

  test('M-03 no live client.legal_identifier_label fallback in download (snapshot authority)', () => {
    // INTL-4.7R: downloadOwnerInvoice must not fall back to owner_clients live data
    const snapBlock = dlBlock.match(/INTL-4\.7R[\s\S]+?_cliTaxValue/)?.[0] || '';
    expect(snapBlock).not.toMatch(/client\.legal_identifier_label/);
  });

  test('M-04 _cliTaxLabel resolved exclusively from invoice snapshot', () => {
    expect(dlBlock).toMatch(/inv\.client_tax_identifier_label/);
  });

  test('M-05 _cliLegalLine rendered as HTML div', () => {
    expect(dlBlock).toMatch(/_cliLegalLabel.*_cliLegalValue/s);
  });

  test('M-06 _cliTaxLine rendered as HTML div', () => {
    expect(dlBlock).toMatch(/_cliTaxLine/);
  });
});

// ── N: Frontend updatePreview — shows generic client identity ─────────────────
describe('N — Frontend updatePreview: client identity in preview', () => {
  test('N-01 _pCLegalLbl resolved from client.legal_identifier_label', () => {
    expect(previewBlock).toMatch(/_pCLegalLbl/);
    expect(previewBlock).toMatch(/client\.legal_identifier_label/);
  });

  test('N-02 _pCLegalLbl falls back to SIRET when client.siret present', () => {
    expect(previewBlock).toMatch(/client\.siret\s*\?\s*'SIRET'/);
  });

  test('N-03 _pCLegalLine appended to previewClientDetails', () => {
    expect(previewBlock).toMatch(/_pCLegalLine/);
  });

  test('N-04 previewClientDetails innerHTML updated', () => {
    expect(previewBlock).toMatch(/previewClientDetails/);
  });
});

// ── O: Financial isolation ────────────────────────────────────────────────────
describe('O — Financial isolation: INTL-4.7 does not touch financial fields', () => {
  test('O-01 no exchangeRate reference in migration block', () => {
    expect(migBlock).not.toMatch(/exchangeRate|exchange_rate|fxRate|fx_rate/i);
  });

  test('O-02 no currency conversion in invoice creation snapshot block', () => {
    // The snapshot computation (_snapClientLegal*) has no currency math
    const snapBlock = postInv.match(/_snapClientLegalLabel[\s\S]+?_snapClientTaxValue/)?.[0] || '';
    expect(snapBlock).not.toMatch(/convert|exchange|rate\s*\*/i);
  });

  test('O-03 subtotal_ht not modified by INTL-4.7 changes', () => {
    // The migration IIFE only touches identifier columns, never amounts
    expect(migBlock).not.toMatch(/subtotal_ht|subtotal_debours|vat_amount|total_ttc/);
  });

  test('O-04 credit note financial fields come from orig row (unchanged)', () => {
    // Credit note param order: generic identity inserted between client_phone and period_start
    // Financial fields (subtotal_ht etc.) still computed from orig amounts
    expect(creditNote).toMatch(/orig\.vat_applicable/);
    expect(creditNote).toMatch(/orig\.vat_rate/);
  });

  test('O-05 no FX/currency conversion added in PATH A client block', () => {
    const clientBlock = pathABlock.match(/INTL-4\.7.*?clientTaxValue/s)?.[0] || '';
    expect(clientBlock).not.toMatch(/convert|exchange|fxRate/i);
  });

  test('O-06 no country-specific validation for legal identifier values', () => {
    // Must not enforce IL/CH/US format rules — label/value are free text
    expect(srv).not.toMatch(/israeliCompanyNumber|swissUID|usEIN/i);
    expect(fe).not.toMatch(/israeliCompanyNumber|swissUID|usEIN/i);
  });
});

// ── P: Snapshot authority — live owner_clients forbidden for existing invoices ──
describe('P — INTL-4.7R snapshot authority: no live owner_clients drift', () => {
  test('P-01 PATH A comment confirms snapshot authority', () => {
    expect(pathABlock).toMatch(/INTL-4\.7R/);
  });

  test('P-02 PATH A: no client.legal_identifier_label fallback', () => {
    // Extract only the client identity resolution block in PATH A
    const identBlock = pathABlock.match(/INTL-4\.7R[\s\S]+?clientTaxValue\s*=/)?.[0] || '';
    expect(identBlock).not.toMatch(/client\.legal_identifier_label/);
    expect(identBlock).not.toMatch(/client\.legal_identifier_value/);
  });

  test('P-03 PATH A: no client.tax_identifier_label fallback', () => {
    const identBlock = pathABlock.match(/INTL-4\.7R[\s\S]+?clientTaxValue\s*=/)?.[0] || '';
    expect(identBlock).not.toMatch(/client\.tax_identifier_label/);
    expect(identBlock).not.toMatch(/client\.tax_identifier_value/);
  });

  test('P-04 PATH A: no client.siret fallback in identity resolution', () => {
    const identBlock = pathABlock.match(/INTL-4\.7R[\s\S]+?clientTaxValue\s*=/)?.[0] || '';
    // client.siret must not appear as an identity fallback (only inv.client_siret is allowed)
    expect(identBlock).not.toMatch(/\|\|\s*client\.siret/);
  });

  test('P-05 PATH B call site: INTL-4.7R comment present', () => {
    expect(sendRoute).toMatch(/INTL-4\.7R/);
  });

  test('P-06 PATH B call site: no client.legal_identifier fallback', () => {
    const callSiteBlock = sendRoute.match(/INTL-4\.7R[\s\S]+?clientTaxIdentifierValue:/)?.[0] || '';
    expect(callSiteBlock).not.toMatch(/client\.legal_identifier_label/);
    expect(callSiteBlock).not.toMatch(/client\.legal_identifier_value/);
  });

  test('P-07 PATH B call site: no client.siret fallback for invoice identity', () => {
    const callSiteBlock = sendRoute.match(/INTL-4\.7R[\s\S]+?clientTaxIdentifierValue:/)?.[0] || '';
    expect(callSiteBlock).not.toMatch(/\|\|\s*client\.siret/);
  });

  test('P-08 frontend download: INTL-4.7R comment present', () => {
    expect(dlBlock).toMatch(/INTL-4\.7R/);
  });

  test('P-09 frontend download: no live client fallback after snapshot', () => {
    const snapBlock = dlBlock.match(/INTL-4\.7R[\s\S]+?_cliTaxValue\s*=/)?.[0] || '';
    expect(snapBlock).not.toMatch(/client\.legal_identifier_label/);
    expect(snapBlock).not.toMatch(/client\.tax_identifier_label/);
    expect(snapBlock).not.toMatch(/client\.siret/);
  });

  test('P-10 partial state guard: legal line shown only when BOTH label and value present', () => {
    expect(dlBlock).toMatch(/_cliLegalLabel && _cliLegalValue/);
  });

  test('P-11 partial state guard: tax line shown only when BOTH label and value present', () => {
    expect(dlBlock).toMatch(/_cliTaxLabel && _cliTaxValue/);
  });

  test('P-12 PATH A partial state guard: legal rendered only when both truthy', () => {
    expect(pathABlock).toMatch(/clientLegalLabel && clientLegalValue/);
  });

  test('P-13 PATH A partial state guard: tax rendered only when both truthy', () => {
    expect(pathABlock).toMatch(/clientTaxLabel && clientTaxValue/);
  });
});

// ── Q: Draft client change — backend re-snapshot ─────────────────────────────
describe('Q — INTL-4.7R draft client change: backend re-snapshot', () => {
  test('Q-01 PUT /api/owner-invoices/:id extracts newClientId from req.body', () => {
    expect(putInvRoute).toMatch(/newClientId/);
    expect(putInvRoute).toMatch(/clientId:\s*newClientId/);
  });

  test('Q-02 PUT checks existing client_id in SELECT', () => {
    expect(putInvRoute).toMatch(/SELECT status, client_id/);
  });

  test('Q-03 PUT re-snapshots when newClientId differs from current', () => {
    expect(putInvRoute).toMatch(/newClientId.*!==.*_currentClientId/s);
  });

  test('Q-04 re-snapshot fetches new client from owner_clients', () => {
    expect(putInvRoute).toMatch(/SELECT \* FROM owner_clients WHERE id = \$1/);
  });

  test('Q-05 re-snapshot updates client_legal_identifier_label', () => {
    const reSnapBlock = putInvRoute.match(/INTL-4\.7R — client change[\s\S]+?req\.params\.id\s*\]\)/)?.[0] || '';
    expect(reSnapBlock).toMatch(/client_legal_identifier_label/);
  });

  test('Q-06 re-snapshot updates client_tax_identifier_label', () => {
    const reSnapBlock = putInvRoute.match(/INTL-4\.7R — client change[\s\S]+?req\.params\.id\s*\]\)/)?.[0] || '';
    expect(reSnapBlock).toMatch(/client_tax_identifier_label/);
  });

  test('Q-07 re-snapshot also updates client_siret for legacy', () => {
    const reSnapBlock = putInvRoute.match(/INTL-4\.7R — client change[\s\S]+?req\.params\.id\s*\]\)/)?.[0] || '';
    expect(reSnapBlock).toMatch(/client_siret/);
  });

  test('Q-08 re-snapshot only triggers on DRAFT (status guard exists)', () => {
    // The PUT route already guards: only drafts can be modified
    expect(putInvRoute).toMatch(/status.*!==.*'draft'|Seuls les brouillons/);
  });

  test('Q-09 INTL-4.7R comment on re-snapshot block', () => {
    expect(putInvRoute).toMatch(/INTL-4\.7R/);
  });
});

// ── R: Frontend _currentInvoiceClientSnap ────────────────────────────────────
describe('R — INTL-4.7R frontend: _currentInvoiceClientSnap', () => {
  test('R-01 _currentInvoiceClientSnap global declared', () => {
    expect(fe).toMatch(/_currentInvoiceClientSnap\s*=\s*null/);
  });

  test('R-02 INTL-4.7R comment explains the variable', () => {
    expect(fe).toMatch(/INTL-4\.7R/);
  });

  test('R-03 editOwnerInvoiceDraft sets _currentInvoiceClientSnap', () => {
    const editDraftFn = fe.match(/window\.editOwnerInvoiceDraft\s*=\s*async function[\s\S]+?^\};/m)?.[0] || '';
    expect(editDraftFn).toMatch(/_currentInvoiceClientSnap\s*=/);
    expect(editDraftFn).toMatch(/clientId/);
    expect(editDraftFn).toMatch(/legalLabel/);
    expect(editDraftFn).toMatch(/legalValue/);
  });

  test('R-04 viewOwnerInvoiceReadOnly sets _currentInvoiceClientSnap', () => {
    const viewFn = fe.match(/window\.viewOwnerInvoiceReadOnly\s*=\s*async function[\s\S]+?^\};/m)?.[0] || '';
    expect(viewFn).toMatch(/_currentInvoiceClientSnap\s*=/);
    expect(viewFn).toMatch(/legalLabel/);
  });

  test('R-05 createNewInvoice clears _currentInvoiceClientSnap', () => {
    const createNewFn = fe.match(/window\.createNewInvoice\s*=\s*function[\s\S]+?^  };/m)?.[0] || '';
    expect(createNewFn).toMatch(/_currentInvoiceClientSnap\s*=\s*null/);
  });

  test('R-06 createInvoice clears _currentInvoiceClientSnap on successful save', () => {
    const createFn = fe.match(/window\.createInvoice\s*=\s*async function[\s\S]+?^  };/m)?.[0] || '';
    expect(createFn).toMatch(/_currentInvoiceClientSnap\s*=\s*null/);
  });

  test('R-07 updatePreview uses _currentInvoiceClientSnap for same-client existing invoice', () => {
    expect(previewBlock).toMatch(/_currentInvoiceClientSnap/);
    expect(previewBlock).toMatch(/editingInvoiceId.*_currentInvoiceClientSnap/s);
  });

  test('R-08 updatePreview uses live client when client changed from snapshot', () => {
    // Must have an else branch that uses client.legal_identifier_label
    expect(previewBlock).toMatch(/else\s*\{[\s\S]+?client\.legal_identifier_label/);
  });

  test('R-09 updatePreview snapshot branch uses snap.legalLabel and snap.legalValue', () => {
    expect(previewBlock).toMatch(/_currentInvoiceClientSnap\.legalLabel/);
    expect(previewBlock).toMatch(/_currentInvoiceClientSnap\.legalValue/);
  });
});

// ── S: Historical drift — existing invoice must not show new owner_clients data ─
describe('S — Historical drift prevention', () => {
  // Simulates: invoice has OLD123 SIRET, owner_clients now has EIN:NEW999 + VAT ID:NEWVAT
  // All resolution paths must show only the invoice snapshot, never the new client data.

  test('S-01 PATH A: clientLegalLabel uses inv.client_legal_identifier_label first', () => {
    // If invoice has a snapshot, it must be used regardless of client changes
    const pathAResolution = pathABlock.match(/clientLegalLabel\s*=\s*inv\.client_legal_identifier_label[\s\S]+?;\s*\n/)?.[0] || '';
    expect(pathAResolution).toBeTruthy();
  });

  test('S-02 PATH A: live client.legal_identifier_label absent from resolution chain', () => {
    const identBlock = pathABlock.match(/clientLegalLabel\s*=\s*inv\.client_legal_identifier_label[\s\S]+?clientTaxValue\s*=/)?.[0] || '';
    expect(identBlock).not.toMatch(/client\.legal_identifier_label/);
    expect(identBlock).not.toMatch(/client\.legal_identifier_value/);
    expect(identBlock).not.toMatch(/client\.tax_identifier_label/);
    expect(identBlock).not.toMatch(/client\.tax_identifier_value/);
  });

  test('S-03 PATH B call site: live client.siret not appended to legal value', () => {
    // clientLegalIdentifierValue must stop at invoice.client_siret; never reach client.siret
    const valueResolution = sendRoute.match(/clientLegalIdentifierValue:\s*invoice\.client_legal_identifier_value[\s\S]+?,\s*\n/)?.[0] || '';
    expect(valueResolution).not.toMatch(/client\.siret/);
  });

  test('S-04 frontend download: legacy inv.client_siret used as fallback, not client.siret', () => {
    const snapBlock = dlBlock.match(/_cliLegalLabel\s*=\s*inv\.client_legal_identifier_label[\s\S]+?_cliTaxValue\s*=/)?.[0] || '';
    expect(snapBlock).not.toMatch(/client\.siret/);
  });
});

// ── T: New invoice creation — client snapshot stored correctly ────────────────
describe('T — New invoice: client snapshot stored at creation', () => {
  test('T-01 invoice creation fetches _clientRow from owner_clients', () => {
    expect(postInv).toMatch(/SELECT \* FROM owner_clients WHERE id = \$1/);
  });

  test('T-02 _snapClientLegalLabel built from live client at creation time', () => {
    // At creation, there is no existing invoice snapshot — live client is the correct source
    expect(postInv).toMatch(/_snapClientLegalLabel\s*=\s*_clientRow/);
  });

  test('T-03 _snapClientLegalLabel uses generic field with siret fallback', () => {
    expect(postInv).toMatch(/_clientRow\.legal_identifier_label\s*\|\|\s*\(_clientRow\.siret\s*\?\s*'SIRET'/);
  });

  test('T-04 _snapClientTaxLabel and value stored', () => {
    expect(postInv).toMatch(/_snapClientTaxLabel/);
    expect(postInv).toMatch(/_snapClientTaxValue/);
  });

  test('T-05 all 4 snapshot columns written to INSERT', () => {
    expect(postInv).toMatch(/client_legal_identifier_label/);
    expect(postInv).toMatch(/client_legal_identifier_value/);
    expect(postInv).toMatch(/client_tax_identifier_label/);
    expect(postInv).toMatch(/client_tax_identifier_value/);
  });

  test('T-06 _snapClientLegalLabel passed as $33 parameter', () => {
    expect(postInv).toMatch(/_snapClientLegalLabel,\s*\n\s*_snapClientLegalValue/);
  });
});

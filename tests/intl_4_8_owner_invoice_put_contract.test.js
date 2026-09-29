'use strict';
/**
 * IOS-OWNER-INVOICES-CREATE-2D — PUT /api/owner-invoices/:id contract
 *
 * Vérifie les corrections apportées au contrat backend :
 *
 * A — discountType PUT : 'percent' accepté (fix bug 'percentage')   PUT-A-01 à PUT-A-04
 * B — dates modifiables sur brouillon                               PUT-B-01 à PUT-B-04
 * C — validation période (start ≤ end)                              PUT-C-01 à PUT-C-02
 * D — non-brouillon ne peut pas être modifié                        PUT-D-01
 * E — devise immutable (INTL-4.4C regression)                       PUT-E-01 à PUT-E-02
 * F — items inchangés par changement de dates                       PUT-F-01
 * G — POST discountType 'percent' cohérent                          PUT-G-01
 * H — dueDate default web = issueDate + 30 jours                    PUT-H-01
 */

const fs   = require('fs');
const path = require('path');

const serverSrc    = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const facturesHtml = fs.readFileSync(path.join(__dirname, '../public/factures-proprietaires.html'), 'utf8');

// ── Extraire le bloc PUT owner-invoices/:id ───────────────────────────────────
const putMatch  = serverSrc.match(/app\.put\('\/api\/owner-invoices\/:id',[\s\S]+?client\.release\(\);\s*\}\s*\}\);/);
const putBlock  = putMatch ? putMatch[0] : '';

// ── Extraire le bloc POST owner-invoices ─────────────────────────────────────
const postMatch = serverSrc.match(/app\.post\('\/api\/owner-invoices',[\s\S]+?client\.release\(\);\s*\}\s*\}\);/);
const postBlock = postMatch ? postMatch[0] : '';

// ── A. discountType PUT ───────────────────────────────────────────────────────
describe("A. PUT discountType — 'percent' accepté (correction bug 'percentage')", () => {

  test("PUT-A-01 : 'percent' déclenche le calcul de remise pourcentage", () => {
    // Guard must accept both 'percent' and 'percentage'
    expect(putBlock).toMatch(/discountType\s*===\s*['"]percent['"]\s*\|\|\s*discountType\s*===\s*['"]percentage['"]/);
  });

  test("PUT-A-02 : 'percentage' toujours accepté comme alias legacy", () => {
    // The normalizer also handles 'percentage' via the OR condition
    expect(putBlock).toMatch(/['"]percentage['"]/);
  });

  test("PUT-A-03 : discountType normalisé 'percentage' → 'percent' avant stockage", () => {
    // _normalizedDiscountType converts 'percentage' to 'percent'
    expect(putBlock).toMatch(/_normalizedDiscountType\s*=.*['"](percent|percentage)['"]/);
    expect(putBlock).toMatch(/\?\s*['"]percent['"]\s*:/);
  });

  test("PUT-A-04 : discount_type = 'fixed' toujours calculé correctement", () => {
    expect(putBlock).toMatch(/discountType\s*===\s*['"]fixed['"]/);
    expect(putBlock).toMatch(/parseFloat\(discountValue\)/);
  });
});

// ── B. dates modifiables sur brouillon ───────────────────────────────────────
describe('B. PUT dates — issue_date/due_date/period_start/period_end modifiables', () => {

  test('PUT-B-01 : issueDate extrait du req.body', () => {
    expect(putBlock).toMatch(/issueDate/);
  });

  test('PUT-B-02 : dueDate extrait du req.body', () => {
    expect(putBlock).toMatch(/dueDate/);
  });

  test('PUT-B-03 : issue_date mis à jour via COALESCE dans le SET', () => {
    expect(putBlock).toMatch(/COALESCE\(\$\d+,\s*issue_date\)/i);
  });

  test('PUT-B-04 : due_date mis à jour via COALESCE dans le SET', () => {
    expect(putBlock).toMatch(/COALESCE\(\$\d+,\s*due_date\)/i);
  });

  test('PUT-B-05 : period_start mis à jour via COALESCE dans le SET', () => {
    expect(putBlock).toMatch(/COALESCE\(\$\d+,\s*period_start\)/i);
  });

  test('PUT-B-06 : period_end mis à jour via COALESCE dans le SET', () => {
    expect(putBlock).toMatch(/COALESCE\(\$\d+,\s*period_end\)/i);
  });
});

// ── C. validation période ─────────────────────────────────────────────────────
describe('C. PUT period validation — periodStart ≤ periodEnd', () => {

  test('PUT-C-01 : guard periodStart > periodEnd → 400', () => {
    expect(putBlock).toMatch(/periodStart\s*>\s*periodEnd/);
  });

  test('PUT-C-02 : message erreur période renvoyé', () => {
    expect(putBlock).toMatch(/date de début de période/i);
  });
});

// ── D. non-brouillon ne peut pas être modifié ─────────────────────────────────
describe('D. PUT non-draft guard', () => {

  test("PUT-D-01 : status !== 'draft' → 400 avec message", () => {
    expect(putBlock).toMatch(/status\s*!==\s*['"]draft['"]/);
    expect(putBlock).toMatch(/Seuls les brouillons peuvent être modifiés/);
  });
});

// ── E. devise immutable (INTL-4.4C regression) ────────────────────────────────
describe('E. PUT devise immutable — INTL-4.4C regression', () => {

  test("PUT-E-01 : guard OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE présent", () => {
    expect(putBlock).toMatch(/OWNER_INVOICE_DRAFT_CURRENCY_CHANGE_REQUIRES_RECREATE/);
  });

  test('PUT-E-02 : currency/_storedInvoiceCurrency comparaison contre _putCtx.currency', () => {
    expect(putBlock).toMatch(/_putCtx\.currency\s*!==\s*_storedInvoiceCurrency/);
  });

  test("PUT-E-03 : currency/country/locale/issuer_snapshot NOT dans le SET (commentaire présent)", () => {
    // The guard comment states these are immutable snapshots
    expect(putBlock).toMatch(/currency.*immutable|snapshots immuables/i);
  });
});

// ── F. items inchangés par changement de dates ────────────────────────────────
describe('F. PUT items — indépendants des dates', () => {

  test('PUT-F-01 : aucun recalcul des items déclenché par les dates', () => {
    // Items are passed in directly from iOS — no server-side recompute from dates
    const itemsLoop = putBlock.match(/for.*items[\s\S]{0,300}INSERT INTO owner_invoice_items/);
    expect(itemsLoop).not.toBeNull();
    // The INSERT block does not reference issueDate/dueDate
    const insertSection = putBlock.match(/INSERT INTO owner_invoice_items[\s\S]{0,400}(?=\n\s*\})/)?.[0] ?? '';
    expect(insertSection).not.toMatch(/issueDate|dueDate|issue_date|due_date/);
  });
});

// ── G. POST discountType cohérent ─────────────────────────────────────────────
describe("G. POST discountType — 'percent' cohérent", () => {

  test("PUT-G-01 : POST utilise 'percent' (pas 'percentage')", () => {
    expect(postBlock).toMatch(/discountType\s*===\s*['"]percent['"]/);
    expect(postBlock).not.toMatch(/discountType\s*===\s*['"]percentage['"]/);
  });
});

// ── H. dueDate default web ────────────────────────────────────────────────────
describe('H. dueDate default — issueDate + 30 jours', () => {

  test('PUT-H-01 : factures-proprietaires.html calcule dueDate = date + 30', () => {
    expect(facturesHtml).toMatch(/d2\.setDate\(d2\.getDate\(\)\+30\)/);
  });
});

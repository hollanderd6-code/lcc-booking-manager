'use strict';
/**
 * ACCOUNTING-DEBOUR — Debour Currency Authority End-to-End
 *
 * Structural checks: verifies that the debour pipeline is currency-aware:
 * DB migration adds debours.currency, POST/PUT store it, GET returns it,
 * and POST/PUT /api/owner-invoices reject denomination mismatches.
 *
 * No DB connection. Static source analysis only.
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract INTL-DEBOUR migration block
const migrationBlock = src.match(/INTL-DEBOUR[\s\S]+?console\.log\('✅ INTL-DEBOUR/)?.[0] || '';

// Extract POST /api/debours handler body
const postDebourBlock = src.match(/app\.post\('\/api\/debours'[\s\S]+?^\}\);/m)?.[0] || '';

// Extract PUT /api/debours/:id handler body
const putDebourBlock = src.match(/app\.put\('\/api\/debours\/:id'[\s\S]+?^\}\);/m)?.[0] || '';

// Extract GET /api/debours handler body (list)
const getDebourBlock = src.match(/app\.get\('\/api\/debours',[\s\S]+?^\}\);/m)?.[0] || '';

// Extract POST /api/owner-invoices handler body
const postOwnerInvBlock = src.match(/app\.post\('\/api\/owner-invoices'[\s\S]+?^\}\);/m)?.[0] || '';

// Extract PUT /api/owner-invoices/:id handler body
const putOwnerInvBlock = src.match(/app\.put\('\/api\/owner-invoices\/:id'[\s\S]+?^\}\);/m)?.[0] || '';

// ── A: DB migration — debours.currency column ────────────────────────────────

describe('A — DB migration: debours.currency column', () => {
  test('A-01 INTL-DEBOUR migration block is present', () => {
    expect(migrationBlock).not.toBe('');
  });

  test('A-02 ALTER TABLE adds currency column', () => {
    expect(migrationBlock).toMatch(/ALTER TABLE debours ADD COLUMN IF NOT EXISTS currency/);
  });

  test('A-03 currency column uses TEXT type', () => {
    expect(migrationBlock).toMatch(/ADD COLUMN IF NOT EXISTS currency TEXT/);
  });

  test('A-04 constraint matches owner_invoices pattern (ISO 3-char)', () => {
    expect(migrationBlock).toMatch(/chk_debours_currency.*\^.*\[A-Z\]\{3\}/);
  });
});

// ── B: legacy backfill ───────────────────────────────────────────────────────

describe('B — Legacy backfill: historical debours get EUR', () => {
  test('B-01 UPDATE debours SET currency = EUR WHERE currency IS NULL', () => {
    expect(migrationBlock).toMatch(/UPDATE debours SET currency = 'EUR' WHERE currency IS NULL/);
  });
});

// ── C: POST /api/debours stores currency ─────────────────────────────────────

describe('C — POST /api/debours: currency stored at creation', () => {
  test('C-01 handler is present', () => {
    expect(postDebourBlock).not.toBe('');
  });

  test('C-02 currency extracted from req.body', () => {
    expect(postDebourBlock).toMatch(/currency.*=.*req\.body/);
  });

  test('C-03 normalizeCurrency applied to raw input', () => {
    expect(postDebourBlock).toMatch(/normalizeCurrency\(.*rawCurrency\)/);
  });

  test('C-04 EUR fallback when normalizeCurrency returns null', () => {
    expect(postDebourBlock).toMatch(/normalizeCurrency\(.*rawCurrency\).*\|\|.*'EUR'/);
  });

  test('C-05 currency column present in INSERT', () => {
    expect(postDebourBlock).toMatch(/INSERT INTO debours[\s\S]+?currency/);
  });

  test('C-06 currency value passed to INSERT params', () => {
    expect(postDebourBlock).toMatch(/currency\]/);
  });
});

// ── D: GET /api/debours returns currency ─────────────────────────────────────

describe('D — GET /api/debours: currency returned in list', () => {
  test('D-01 handler is present', () => {
    expect(getDebourBlock).not.toBe('');
  });

  test('D-02 SELECT * returns all columns including currency', () => {
    expect(getDebourBlock).toMatch(/SELECT \* FROM debours/);
  });
});

// ── E: PUT /api/debours updates currency ─────────────────────────────────────

describe('E — PUT /api/debours/:id: currency updatable', () => {
  test('E-01 handler is present', () => {
    expect(putDebourBlock).not.toBe('');
  });

  test('E-02 currency extracted from req.body in PUT', () => {
    expect(putDebourBlock).toMatch(/currency.*=.*req\.body/);
  });

  test('E-03 normalizeCurrency applied in PUT', () => {
    expect(putDebourBlock).toMatch(/normalizeCurrency\(.*rawCurrency\)/);
  });

  test('E-04 currency included in UPDATE SET', () => {
    expect(putDebourBlock).toMatch(/currency\s*=\s*\$\d/);
  });
});

// ── F: POST /api/owner-invoices — debour currency check ──────────────────────

describe('F — POST /api/owner-invoices: rejects denomination mismatch', () => {
  test('F-01 INTL-DEBOUR comment present in POST owner-invoices', () => {
    expect(postOwnerInvBlock).toMatch(/INTL-DEBOUR/);
  });

  test('F-02 filters debour items by isDebours && deboursId', () => {
    expect(postOwnerInvBlock).toMatch(/isDebours.*&&.*deboursId|deboursId.*&&.*isDebours/);
  });

  test('F-03 queries debours table for stored currency', () => {
    expect(postOwnerInvBlock).toMatch(/SELECT.*currency FROM debours WHERE id/);
  });

  test('F-04 compares debour currency against invoice currency', () => {
    expect(postOwnerInvBlock).toMatch(/_dc.*!==.*invoiceCurrency|invoiceCurrency.*!==.*_dc/);
  });

  test('F-05 returns 400 on mismatch', () => {
    expect(postOwnerInvBlock).toMatch(/res\.status\(400\).*débours.*en.*alors.*facture/s);
  });

  test('F-06 normalizeCurrency applied to stored debour.currency', () => {
    expect(postOwnerInvBlock).toMatch(/normalizeCurrency\(_row\.currency\)/);
  });
});

// ── G: PUT /api/owner-invoices/:id — debour currency check ───────────────────

describe('G — PUT /api/owner-invoices/:id: rejects denomination mismatch', () => {
  test('G-01 INTL-DEBOUR comment present in PUT owner-invoices', () => {
    expect(putOwnerInvBlock).toMatch(/INTL-DEBOUR/);
  });

  test('G-02 reads stored invoice currency from checkResult', () => {
    expect(putOwnerInvBlock).toMatch(/_storedInvoiceCurrency.*=.*normalizeCurrency.*checkResult/);
  });

  test('G-03 queries debours table for stored currency', () => {
    expect(putOwnerInvBlock).toMatch(/SELECT.*currency FROM debours WHERE id/);
  });

  test('G-04 compares debour currency against stored invoice currency', () => {
    expect(putOwnerInvBlock).toMatch(/_dc.*!==.*_storedInvoiceCurrency|_storedInvoiceCurrency.*!==.*_dc/);
  });

  test('G-05 rolls back transaction on mismatch', () => {
    expect(putOwnerInvBlock).toMatch(/ROLLBACK[\s\S]+?débours.*en.*alors.*facture/s);
  });

  test('G-06 checkResult SELECT includes currency column', () => {
    expect(putOwnerInvBlock).toMatch(/SELECT status, client_id, currency FROM owner_invoices/);
  });
});

// ── H: no FX conversion ──────────────────────────────────────────────────────

describe('H — no FX conversion in debour pipeline', () => {
  test('H-01 no exchangeRate in POST /api/debours', () => {
    expect(postDebourBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('H-02 no exchangeRate in PUT /api/debours/:id', () => {
    expect(putDebourBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('H-03 no exchangeRate in POST owner-invoice debour check', () => {
    const debourCheckSection = postOwnerInvBlock.match(/INTL-DEBOUR[\s\S]+?await client\.query\('BEGIN'\)/)?.[0] || '';
    expect(debourCheckSection).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });
});

// ── I: constraint matches existing pattern ───────────────────────────────────

describe('I — currency constraint matches owner_invoices convention', () => {
  test('I-01 debours uses same ISO regex pattern as owner_invoices', () => {
    const debourConstraint = src.match(/chk_debours_currency.*\^.*\[A-Z\]\{3\}/)?.[0] || '';
    const invoiceConstraint = src.match(/chk_owner_invoices_currency.*\^.*\[A-Z\]\{3\}/)?.[0] || '';
    expect(debourConstraint).not.toBe('');
    expect(invoiceConstraint).not.toBe('');
    // Both use same pattern — extract just the regex part
    const extractRegex = s => s.match(/\^.*\[A-Z\]\{3\}/)?.[0] || '';
    expect(extractRegex(debourConstraint)).toBe(extractRegex(invoiceConstraint));
  });
});

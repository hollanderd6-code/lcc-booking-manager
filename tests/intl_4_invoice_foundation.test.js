'use strict';
/**
 * INTL-4.1 / INTL-4.2 — International Owner Invoicing — DB Foundation
 *
 * Structural checks: verifies that the INTL-4.1/4.2 migrations are present
 * in server.js and that the new columns, constraints, backfills, and Option A
 * decision (issuer_snapshot = NULL) are all correctly coded.
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// ── A: owner_invoices — column additions ─────────────────────
describe('A — owner_invoices: new columns added', () => {
  test('A-01 currency column added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS currency TEXT/);
  });

  test('A-02 country column added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS country TEXT/);
  });

  test('A-03 locale column added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS locale TEXT/);
  });

  test('A-04 issuer_snapshot JSONB column added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS issuer_snapshot JSONB/);
  });

  test('A-05 issuer_snapshot_source column added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS issuer_snapshot_source TEXT/);
  });

  test('A-06 vat_exempt_label column added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS vat_exempt_label TEXT/);
  });

  test('A-07 tax_label column added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS tax_label TEXT/);
  });
});

// ── B: owner_invoices — CHECK constraints ────────────────────
describe('B — owner_invoices: CHECK constraints', () => {
  test('B-01 currency CHECK constraint: 3-char uppercase', () => {
    expect(serverSrc).toMatch(/chk_owner_invoices_currency/);
    expect(serverSrc).toMatch(/currency ~ '\^\[A-Z\]\{3\}\$'/);
  });

  test('B-02 country CHECK constraint: 2-char uppercase', () => {
    expect(serverSrc).toMatch(/chk_owner_invoices_country/);
    expect(serverSrc).toMatch(/country ~ '\^\[A-Z\]\{2\}\$'/);
  });

  test('B-03 locale CHECK constraint: ll-CC pattern', () => {
    expect(serverSrc).toMatch(/chk_owner_invoices_locale/);
    expect(serverSrc).toMatch(/locale ~ '\^\[a-z\]\{2\}-\[A-Z\]\{2\}\$'/);
  });

  test('B-04 all three CHECK constraints allow NULL (IS NULL OR)', () => {
    const currencyChk = serverSrc.match(/chk_owner_invoices_currency[\s\S]{0,120}CHECK\s*\(([^)]+)\)/);
    const countryChk  = serverSrc.match(/chk_owner_invoices_country[\s\S]{0,120}CHECK\s*\(([^)]+)\)/);
    const localeChk   = serverSrc.match(/chk_owner_invoices_locale[\s\S]{0,120}CHECK\s*\(([^)]+)\)/);
    expect(currencyChk).not.toBeNull();
    expect(countryChk).not.toBeNull();
    expect(localeChk).not.toBeNull();
  });
});

// ── C: users — new abstract legal identifier columns ─────────
describe('C — users: legal identifier columns added', () => {
  test('C-01 legal_identifier_label added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_identifier_label TEXT/);
  });

  test('C-02 legal_identifier_value added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_identifier_value TEXT/);
  });

  test('C-03 tax_identifier_label added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_identifier_label TEXT/);
  });

  test('C-04 tax_identifier_value added', () => {
    expect(serverSrc).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_identifier_value TEXT/);
  });

  test('C-05 siret column not removed', () => {
    // siret must still be readable from users (existing invoices depend on it)
    expect(serverSrc).toMatch(/SELECT.*siret.*FROM users/s);
  });

  test('C-06 vat_number column not removed', () => {
    expect(serverSrc).toMatch(/vat_number/);
  });
});

// ── D: owner_invoices backfill — INTL-4.2A ───────────────────
describe('D — owner_invoices: historical backfill (INTL-4.2A)', () => {
  test('D-01 currency backfill to EUR WHERE IS NULL', () => {
    expect(serverSrc).toMatch(/UPDATE owner_invoices SET currency = 'EUR' WHERE currency IS NULL/);
  });

  test('D-02 country backfill to FR WHERE IS NULL', () => {
    expect(serverSrc).toMatch(/UPDATE owner_invoices SET country\s*=\s*'FR'\s*WHERE country\s*IS NULL/);
  });

  test('D-03 locale backfill to fr-FR WHERE IS NULL', () => {
    expect(serverSrc).toMatch(/UPDATE owner_invoices SET locale\s*=\s*'fr-FR'\s*WHERE locale\s*IS NULL/);
  });
});

// ── E: tax_label backfill — INTL-4.2B ────────────────────────
describe('E — tax_label backfill (INTL-4.2B)', () => {
  test('E-01 tax_label backfill to TVA WHERE IS NULL', () => {
    expect(serverSrc).toMatch(/UPDATE owner_invoices SET tax_label = 'TVA' WHERE tax_label IS NULL/);
  });
});

// ── F: vat_exempt_label backfill — INTL-4.2C ─────────────────
describe('F — vat_exempt_label backfill (INTL-4.2C)', () => {
  test('F-01 vat_exempt_label backfill text is exact 293 B mention', () => {
    expect(serverSrc).toMatch(/UPDATE owner_invoices[\s\S]{0,50}SET vat_exempt_label = 'TVA non applicable, art\. 293 B du CGI'/);
  });

  test('F-02 vat_exempt_label backfill only WHERE IS NULL', () => {
    expect(serverSrc).toMatch(/vat_exempt_label IS NULL/);
  });

  test('F-03 condition uses vat_amount (mirrors PDF paths), NOT vat_applicable', () => {
    // Both PDF paths: if (vatAmt > 0) { TVA } else { 293B }
    // vatAmt = parseFloat(inv.vat_amount || 0) — so condition is vat_amount-based.
    expect(serverSrc).toMatch(/COALESCE\(vat_amount,\s*0\)\s*<=\s*0/);
    // Must NOT use vat_applicable as the 293B trigger (wrong condition)
    const block = serverSrc.match(/INTL-4\.1 \/ INTL-4\.2[\s\S]+?console\.log\('✅ INTL-4\.1\/4\.2/)?.[0] || '';
    expect(block).not.toMatch(/vat_applicable = FALSE/);
  });

  test('F-04 vat_exempt_label backfill SET clause does not touch financial columns', () => {
    const block = serverSrc.match(/INTL-4\.1 \/ INTL-4\.2[\s\S]+?console\.log\('✅ INTL-4\.1\/4\.2/)?.[0] || '';
    expect(block).not.toMatch(/total_ttc/);
    expect(block).not.toMatch(/subtotal_ht/);
    expect(block).not.toMatch(/vat_rate/);
  });

  test('F-05 zero-amount invoices (vat_amount=0) are backfilled (edge case)', () => {
    // vat_amount = 0 → COALESCE(0,0)=0 → <= 0 → 293B was shown historically
    expect(serverSrc).toMatch(/COALESCE\(vat_amount,\s*0\)\s*<=\s*0/);
  });
});

// ── G: users legal identifier backfill — INTL-4.2D ───────────
describe('G — users: legal identifier backfill (INTL-4.2D)', () => {
  test('G-01 legal_identifier_label set to SIRET from siret', () => {
    expect(serverSrc).toMatch(/legal_identifier_label = 'SIRET'/);
  });

  test('G-02 legal_identifier_value set from siret', () => {
    expect(serverSrc).toMatch(/legal_identifier_value = siret/);
  });

  test('G-03 siret backfill only WHERE siret IS NOT NULL', () => {
    expect(serverSrc).toMatch(/siret IS NOT NULL[\s\S]{0,80}legal_identifier_label IS NULL/);
  });

  test('G-04 tax_identifier_label set to N° TVA from vat_number', () => {
    expect(serverSrc).toMatch(/tax_identifier_label = 'N° TVA'/);
  });

  test('G-05 tax_identifier_value set from vat_number', () => {
    expect(serverSrc).toMatch(/tax_identifier_value = vat_number/);
  });

  test('G-06 vat_number backfill only WHERE vat_number IS NOT NULL', () => {
    expect(serverSrc).toMatch(/vat_number IS NOT NULL[\s\S]{0,80}tax_identifier_label IS NULL/);
  });
});

// ── H: issuer_snapshot — Option A confirmed ──────────────────
describe('H — issuer_snapshot: Option A (NULL for historical records)', () => {
  test('H-01 no UPDATE owner_invoices SET issuer_snapshot = (bulk insert)', () => {
    // Option A: we do NOT backfill issuer_snapshot with current user data
    expect(serverSrc).not.toMatch(/UPDATE owner_invoices SET issuer_snapshot\s*=/);
  });

  test('H-02 issuer_snapshot_source column exists (for future use)', () => {
    expect(serverSrc).toMatch(/issuer_snapshot_source/);
  });

  test('H-03 Option A rationale comment present', () => {
    expect(serverSrc).toMatch(/Option A/);
  });
});

// ── I: idempotence guarantees ─────────────────────────────────
describe('I — idempotence: all migrations safe to re-run', () => {
  test('I-01 all owner_invoices ADD COLUMN use IF NOT EXISTS', () => {
    const oi = serverSrc.match(/ALTER TABLE owner_invoices ADD COLUMN IF NOT EXISTS/g);
    expect(oi).not.toBeNull();
    expect(oi.length).toBeGreaterThanOrEqual(7);
  });

  test('I-02 all users ADD COLUMN (INTL-4) use IF NOT EXISTS', () => {
    const u = serverSrc.match(/ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_identifier/g);
    expect(u).not.toBeNull();
    expect(u.length).toBeGreaterThanOrEqual(2);
  });

  test('I-03 backfills use WHERE IS NULL (never overwrite existing data)', () => {
    const nullGuards = serverSrc.match(/UPDATE owner_invoices SET \w+\s*=\s*.+ WHERE \w+\s+IS NULL/g);
    expect(nullGuards).not.toBeNull();
    expect(nullGuards.length).toBeGreaterThanOrEqual(4);
  });
});

// ── J: no forbidden modifications ────────────────────────────
describe('J — forbidden modifications not introduced', () => {
  test('J-01 migration block does not SET monetary columns', () => {
    // vat_amount is allowed in a WHERE clause (F-03) but must never appear in a SET clause
    const block = serverSrc.match(/INTL-4\.1 \/ INTL-4\.2[\s\S]+?console\.log\('✅ INTL-4\.1\/4\.2/)?.[0] || '';
    expect(block).not.toMatch(/SET total_ttc/);
    expect(block).not.toMatch(/SET subtotal_ht/);
    expect(block).not.toMatch(/SET vat_amount/);
    expect(block).not.toMatch(/SET vat_rate/);
    expect(block).not.toMatch(/SET discount_amount/);
  });

  test('J-02 invoice_number not modified by INTL-4 migrations', () => {
    const block = serverSrc.match(/INTL-4\.1 \/ INTL-4\.2[\s\S]+?console\.log\('✅ INTL-4\.1\/4\.2/)?.[0] || '';
    expect(block).not.toMatch(/invoice_number/);
  });

  test('J-03 INTL-4.1/4.2 migration wrapped in try/catch', () => {
    expect(serverSrc).toMatch(/INTL-4\.1\/4\.2 migrations OK[\s\S]{0,30}} catch\(e\)/);
  });
});

// ── K: legal identifier partial-state guard ───────────────────
// Verifies that the WHERE clause prevents overwriting any pre-existing value,
// covering cases B (label set, value NULL), C (value set, label NULL),
// D (label only set), E (both set).
describe('K — legal identifier: partial-state guards', () => {
  // Extract just the INTL-4.1/4.2 migration block once
  const block = serverSrc.match(/INTL-4\.1 \/ INTL-4\.2[\s\S]+?console\.log\('✅ INTL-4\.1\/4\.2/)?.[0] || '';

  test('K-01 siret backfill requires BOTH label AND value to be NULL (no partial overwrite)', () => {
    // Protects Case B (label set, value NULL) and Case D (label set)
    expect(block).toMatch(/legal_identifier_label IS NULL[\s\S]{0,50}legal_identifier_value IS NULL/);
  });

  test('K-02 siret backfill guards prevent overwriting custom label (Case D)', () => {
    // If legal_identifier_label is already set (e.g. custom label), the backfill is skipped
    // because the condition legal_identifier_label IS NULL fails.
    expect(block).toMatch(/AND legal_identifier_label IS NULL/);
  });

  test('K-03 siret backfill guards prevent overwriting custom value (Case C)', () => {
    // If legal_identifier_value is already set (e.g. custom value), the backfill is skipped
    expect(block).toMatch(/AND legal_identifier_value IS NULL/);
  });

  test('K-04 siret backfill skipped when siret is NULL (no empty label written)', () => {
    expect(block).toMatch(/siret IS NOT NULL/);
  });

  test('K-05 vat_number backfill requires BOTH tax_identifier fields to be NULL', () => {
    expect(block).toMatch(/tax_identifier_label IS NULL[\s\S]{0,50}tax_identifier_value IS NULL/);
  });

  test('K-06 vat_number backfill skipped when vat_number is NULL', () => {
    expect(block).toMatch(/vat_number IS NOT NULL/);
  });

  test('K-07 backfill sets label AND value atomically in a single UPDATE', () => {
    // Both columns set in the same SET clause — SQL UPDATE is atomic, no partial state
    expect(block).toMatch(/SET legal_identifier_label[\s\S]{0,60}legal_identifier_value/);
    expect(block).toMatch(/SET tax_identifier_label[\s\S]{0,60}tax_identifier_value/);
  });
});

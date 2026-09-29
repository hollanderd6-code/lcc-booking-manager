'use strict';
/**
 * ACCOUNTING-2B — Owner Invoice Search Currency Contract
 *
 * Structural checks: verifies that the /api/search owner-invoice SQL
 * propagates owner_invoices.currency into search results.
 *
 * No DB connection. Static source analysis only.
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract the ownerInvQuery function body for scoped assertions
const ownerInvBlock = src.match(/const ownerInvQuery\s*=\s*async[\s\S]+?^\s*};/m)?.[0] || '';

// ── A: SQL inner SELECT propagates i.currency ────────────────────────────────

describe('A — owner invoice search: inner SELECT includes i.currency', () => {
  test('A-01 ownerInvQuery function is present', () => {
    expect(ownerInvBlock).not.toBe('');
  });

  test('A-02 inner SELECT selects i.currency from owner_invoices', () => {
    expect(ownerInvBlock).toMatch(/i\.currency/);
  });

  test('A-03 outer SELECT propagates sub.currency', () => {
    expect(ownerInvBlock).toMatch(/sub\.currency/);
  });
});

// ── B: currency is NOT derived from other tables ──────────────────────────────

describe('B — currency authority: owner_invoices.currency only', () => {
  test('B-01 no property currency consulted in ownerInvQuery', () => {
    expect(ownerInvBlock).not.toMatch(/properties\.currency|p\.currency/);
  });

  test('B-02 no reservation currency consulted in ownerInvQuery', () => {
    expect(ownerInvBlock).not.toMatch(/reservations\.currency|r\.currency/);
  });

  test('B-03 no default_currency consulted in ownerInvQuery', () => {
    expect(ownerInvBlock).not.toMatch(/default_currency/);
  });
});

// ── C: result mapping does not strip currency ────────────────────────────────

describe('C — result mapping: owner_invoices rows passed through unmodified', () => {
  test('C-01 ownerInvRes.rows is assigned directly to owner_invoices result key', () => {
    // The rows are passed as-is — no .map() that could drop currency
    expect(src).toMatch(/owner_invoices:\s*ownerInvRes\.rows/);
  });

  test('C-02 no .map() transforms ownerInvRes.rows', () => {
    // Voyageur invoices use .map() to build download_url — owner invoices must not
    expect(src).not.toMatch(/ownerInvRes\.rows\.map/);
  });
});

// ── D: no FX arithmetic introduced ───────────────────────────────────────────

describe('D — no FX conversion in owner invoice search', () => {
  test('D-01 no exchange rate computation in ownerInvQuery', () => {
    expect(ownerInvBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('D-02 total_ttc is not modified in ownerInvQuery', () => {
    // i.total_ttc is selected as-is, not multiplied or divided
    expect(ownerInvBlock).toMatch(/i\.total_ttc/);
    expect(ownerInvBlock).not.toMatch(/i\.total_ttc\s*[*/]/);
  });
});

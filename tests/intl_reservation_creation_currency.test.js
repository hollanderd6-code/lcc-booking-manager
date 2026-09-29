'use strict';
/**
 * INTL-RESERVATION — Manual Reservation Currency at Creation
 *
 * Structural checks: verifies that both manual reservation creation routes
 * are currency-aware and use the property's stored currency rather than
 * a hardcoded 'EUR'.
 *
 * No DB connection. Static source analysis only.
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract POST /api/reservations/manual handler body
const postManualBlock = src.match(/app\.post\('\/api\/reservations\/manual'[\s\S]+?^\}\);/m)?.[0] || '';

// Extract POST /api/bookings handler body (authenticated version at line ~10230)
// Match the first occurrence (the real one with authenticateAny + checkSubscription)
const postBookingsBlock = (() => {
  const idx = src.indexOf("app.post('/api/bookings', authenticateAny");
  if (idx === -1) return '';
  const slice = src.slice(idx);
  // Capture until the first standalone });
  const m = slice.match(/^[\s\S]+?^\}\);/m);
  return m ? m[0] : '';
})();

// ── A: POST /api/reservations/manual currency ─────────────────────────────────

describe('A — POST /api/reservations/manual: property currency', () => {
  test('A-01 handler is present', () => {
    expect(postManualBlock).not.toBe('');
  });

  test('A-02 INTL-RESERVATION comment present', () => {
    expect(postManualBlock).toMatch(/INTL-RESERVATION/);
  });

  test('A-03 currency derived from property.currency via normalizeCurrency with EUR fallback', () => {
    expect(postManualBlock).toMatch(/normalizeCurrency\(property\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-04 no bare comma-separated EUR at currency position in SQL params', () => {
    // Old form: ..., 'EUR', 'confirmed', ...
    // New form: normalizeCurrency(property.currency) || 'EUR', 'confirmed',
    // The old form has a comma directly before 'EUR'; the new form has ||.
    expect(postManualBlock).not.toMatch(/,\s*'EUR'\s*,\s*'confirmed'/);
  });

  test('A-05 normalizeCurrency available (required at top of server.js)', () => {
    expect(src).toMatch(/normalizeCurrency.*=.*require/);
  });
});

// ── B: POST /api/bookings currency ───────────────────────────────────────────

describe('B — POST /api/bookings: property currency', () => {
  test('B-01 handler is present', () => {
    expect(postBookingsBlock).not.toBe('');
  });

  test('B-02 INTL-RESERVATION comment present', () => {
    expect(postBookingsBlock).toMatch(/INTL-RESERVATION/);
  });

  test('B-03 SELECT includes currency column', () => {
    expect(postBookingsBlock).toMatch(/SELECT\s+id\s*,\s*name\s*,\s*color\s*,\s*currency/);
  });

  test('B-04 currency derived from property.currency via normalizeCurrency with EUR fallback', () => {
    expect(postBookingsBlock).toMatch(/normalizeCurrency\(property\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-05 reservation object does not hardcode EUR', () => {
    // The reservation object literal should not contain currency: 'EUR'
    const reservationObj = postBookingsBlock.match(/const reservation\s*=\s*\{[\s\S]+?\};/)?.[0] || '';
    expect(reservationObj).not.toMatch(/currency\s*:\s*['"]EUR['"]/);
  });
});

// ── C: Isolation — no FX conversion ──────────────────────────────────────────

describe('C — no FX conversion in reservation creation routes', () => {
  test('C-01 no exchangeRate or fxRate in POST reservations/manual', () => {
    expect(postManualBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('C-02 no exchangeRate or fxRate in POST bookings', () => {
    expect(postBookingsBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });
});

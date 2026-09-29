'use strict';
/**
 * INTL-BHGUEST — BHGuest Direct Booking Reservation Currency
 *
 * Structural checks: verifies that all three BHGuest reservation INSERT sites
 * (POST /api/guest/book, /api/guest/confirm-after-payment,
 * /api/guest/recover-sessions) derive reservation.currency from the property
 * record rather than hardcoding EUR.
 *
 * Also validates reservationsStore classification, Stripe boundary isolation,
 * and isolation from other reservation paths.
 *
 * No DB connection. Static source analysis only.
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// ── Block extractors ──────────────────────────────────────────────────────────

function extractBlock(marker, src) {
  const idx = src.indexOf(marker);
  if (idx === -1) return '';
  // Grab up to next app. route definition (~8000 chars should be enough)
  return src.slice(idx, idx + 8000);
}

const guestBookBlock         = extractBlock("app.post('/api/guest/book'", src);
const confirmAfterPayBlock   = extractBlock("app.post('/api/guest/confirm-after-payment'", src);
const recoverSessionsBlock   = extractBlock("app.post('/api/guest/recover-sessions'", src);

// Webhook block — starts at checkout.session.completed, covers both INSERTs + store push
const webhookIdx = src.indexOf("case 'checkout.session.completed':");
const webhookBlock = webhookIdx !== -1 ? src.slice(webhookIdx, webhookIdx + 20000) : '';

// reservationsStore push at the webhook fallback path
const storePushBlock = (() => {
  const idx = src.indexOf('🔄 Pousser la résa dans le store en mémoire');
  return idx !== -1 ? src.slice(idx, idx + 1200) : '';
})();

// Manual reservation block from RESERVATION-1 (isolation check)
const manualResaBlock = extractBlock("app.post('/api/reservations/manual'", src);
const bookingsBlock   = extractBlock("app.post('/api/bookings', authenticateAny", src);

// ── A: Discovery / known persistence paths ───────────────────────────────────

describe('A — discovery: BHGuest reservation INSERT sites', () => {
  test('A-01 POST /api/guest/book handler present', () => {
    expect(guestBookBlock).not.toBe('');
  });

  test('A-01b POST /api/guest/confirm-after-payment handler present', () => {
    expect(confirmAfterPayBlock).not.toBe('');
  });

  test('A-01c POST /api/guest/recover-sessions handler present', () => {
    expect(recoverSessionsBlock).not.toBe('');
  });

  test('A-02 each INSERT site has INTL-BHGUEST comment', () => {
    expect(guestBookBlock).toMatch(/INTL-BHGUEST/);
    expect(confirmAfterPayBlock).toMatch(/INTL-BHGUEST/);
    expect(recoverSessionsBlock).toMatch(/INTL-BHGUEST/);
  });

  test('A-03 each INSERT site uses normalizeCurrency(prop.currency) as authority or fallback', () => {
    // BHGUEST-CLOSURE upgrade: guest/book uses bookingCurrency = normalizeCurrency(...)
    // confirm-after-payment and recover-sessions use Stripe denomination as primary with property as fallback
    expect(guestBookBlock).toMatch(/normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
    expect(confirmAfterPayBlock).toMatch(/normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
    expect(recoverSessionsBlock).toMatch(/normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-03b each INSERT uses reservationCurrency variable (not bare EUR) in params', () => {
    // The old form: guests || 1, 'EUR' — new form: guests || 1, reservationCurrency
    expect(guestBookBlock).not.toMatch(/guests\s*\|\|\s*1,\s*'EUR'/);
    expect(confirmAfterPayBlock).not.toMatch(/guests\s*\|\|\s*1,\s*'EUR'/);
    expect(recoverSessionsBlock).not.toMatch(/guests\s*,\s*'EUR'/);
  });
});

// ── B: Currency behavior ──────────────────────────────────────────────────────

describe('B — currency behavior: normalizeCurrency contract', () => {
  // These tests verify the normalizeCurrency helper used by all three sites.
  let normalizeCurrency;
  beforeAll(() => {
    try {
      normalizeCurrency = require('../routes/market-data-resolver').normalizeCurrency;
    } catch (e) {
      normalizeCurrency = null;
    }
  });

  test('B-00 normalizeCurrency is importable', () => {
    expect(normalizeCurrency).toBeTruthy();
  });

  test('B-01 EUR property → reservation EUR', () => {
    expect(normalizeCurrency('EUR') || 'EUR').toBe('EUR');
  });

  test('B-02 ILS property → reservation ILS', () => {
    expect(normalizeCurrency('ILS') || 'EUR').toBe('ILS');
  });

  test('B-03 USD property → reservation USD', () => {
    expect(normalizeCurrency('USD') || 'EUR').toBe('USD');
  });

  test('B-04 CHF property → reservation CHF', () => {
    expect(normalizeCurrency('CHF') || 'EUR').toBe('CHF');
  });

  test('B-05 null/undefined property currency → EUR fallback', () => {
    expect(normalizeCurrency(null) || 'EUR').toBe('EUR');
    expect(normalizeCurrency(undefined) || 'EUR').toBe('EUR');
  });

  test('B-06 invalid/empty property currency → EUR fallback', () => {
    expect(normalizeCurrency('') || 'EUR').toBe('EUR');
    expect(normalizeCurrency('INVALID') || 'EUR').toBe('EUR');
  });
});

// ── C: Arithmetic integrity ───────────────────────────────────────────────────

describe('C — arithmetic integrity', () => {
  test('C-01 no FX-related identifiers in guest/book', () => {
    expect(guestBookBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('C-02 no FX-related identifiers in confirm-after-payment', () => {
    expect(confirmAfterPayBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('C-03 no FX-related identifiers in recover-sessions', () => {
    expect(recoverSessionsBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });
});

// ── D: Retry / path consistency ───────────────────────────────────────────────

describe('D — retry/path consistency', () => {
  test('D-01 normalizeCurrency pattern consistent across all three sites', () => {
    const pattern = /normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/;
    expect(guestBookBlock).toMatch(pattern);
    expect(confirmAfterPayBlock).toMatch(pattern);
    expect(recoverSessionsBlock).toMatch(pattern);
  });

  test('D-02 all three sites use reservationCurrency variable (not inline literal)', () => {
    expect(guestBookBlock).toMatch(/reservationCurrency/);
    expect(confirmAfterPayBlock).toMatch(/reservationCurrency/);
    expect(recoverSessionsBlock).toMatch(/reservationCurrency/);
  });

  test('D-03 normalizeCurrency is available at server module level', () => {
    expect(src).toMatch(/normalizeCurrency.*=.*require.*market-data-resolver/);
  });
});

// ── E: reservationsStore ──────────────────────────────────────────────────────

describe('E — reservationsStore currency classification', () => {
  test('E-01 store push block found', () => {
    expect(storePushBlock).not.toBe('');
  });

  test('E-02 store push uses session.amount_total (Stripe payment amount, EUR-denominated)', () => {
    // The price field is session.amount_total / 100 — a Stripe EUR amount
    expect(storePushBlock).toMatch(/price:\s*amountTotal/);
  });

  test('E-03 store currency reflects actual Stripe payment denomination (webhookCurrency)', () => {
    // BHGUEST-CLOSURE upgrade: store currency is now webhookCurrency = session.currency.toUpperCase()
    // amountTotal is session.amount_total / 100 — labeled with the actual session currency, not hardcoded EUR.
    expect(storePushBlock).toMatch(/currency:\s*webhookCurrency/);
  });
});

// ── F: Isolation ──────────────────────────────────────────────────────────────

describe('F — isolation: other paths unchanged', () => {
  test('F-01 manual reservation RESERVATION-1 fix still present', () => {
    expect(manualResaBlock).toMatch(/normalizeCurrency\(property\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('F-02 POST /api/bookings RESERVATION-1 fix still present', () => {
    expect(bookingsBlock).toMatch(/normalizeCurrency\(property\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('F-03 no FX in manual reservation path', () => {
    expect(manualResaBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('F-06 Stripe Checkout session currency derives from property (BHGUEST-CLOSURE upgrade)', () => {
    // BHGUEST-CLOSURE: was hardcoded 'eur', now bookingCurrency.toLowerCase() for multi-currency support
    const checkoutIdx = src.indexOf("app.post('/api/guest/create-checkout-session'");
    const checkoutBlock = checkoutIdx !== -1 ? src.slice(checkoutIdx, checkoutIdx + 20000) : '';
    expect(checkoutBlock).toMatch(/currency:\s*bookingCurrency\.toLowerCase\(\)/);
    expect(checkoutBlock).not.toMatch(/price_data[\s\S]{0,80}currency:\s*['"]eur['"]/);
  });

  test('F-07 deferred path now persists currency via booking_currency metadata (BHGUEST-CLOSURE)', () => {
    // BHGUEST-CLOSURE: deferred INSERT now includes currency column from m.booking_currency
    const deferredBlock = extractBlock("deferred === '1'", src);
    expect(deferredBlock).toMatch(/deferredCurrency\s*=\s*m\.booking_currency/);
  });
});

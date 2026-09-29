'use strict';
/**
 * PMS-INTL-IOS-BHGUEST-CLOSURE-1
 *
 * Structural + behavioral tests verifying multi-currency support across the
 * complete BHGuest accommodation booking lifecycle.
 *
 * Suites:
 *   A — Checkout Session currency (create-checkout-session)
 *   B — PaymentIntent currency (guest/book)
 *   C — Webhook reservation persistence (BHGUEST_ INSERTs)
 *   D — reservationsStore denomination
 *   E — recover-sessions historical denomination
 *   F — confirm-after-payment historical denomination
 *   G — No FX
 *   H — Presentation (emails / push)
 *   I — Regression
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// ── Block extractors ──────────────────────────────────────────────────────────

function extractBlock(marker, src, limit = 8000) {
  const idx = src.indexOf(marker);
  if (idx === -1) return '';
  return src.slice(idx, idx + limit);
}

const checkoutSessionBlock   = extractBlock("app.post('/api/guest/create-checkout-session'", src, 20000);
const guestBookBlock         = extractBlock("app.post('/api/guest/book'", src, 10000);
const confirmAfterPayBlock   = extractBlock("app.post('/api/guest/confirm-after-payment'", src, 25000);
const recoverSessionsBlock   = extractBlock("app.post('/api/guest/recover-sessions'", src, 10000);

// Webhook: checkout.session.completed — covers both setup/deferred and payment paths
const webhookIdx = src.indexOf("case 'checkout.session.completed':");
const webhookBlock = webhookIdx !== -1 ? src.slice(webhookIdx, webhookIdx + 35000) : '';

// reservationsStore push (inside webhook payment path)
const storePushIdx = src.indexOf('🔄 Pousser la résa dans le store en mémoire');
const storePushBlock = storePushIdx !== -1 ? src.slice(storePushIdx, storePushIdx + 1500) : '';

// Deferred cron capture
const deferredCronBlock = extractBlock("cron.schedule('0 8 * * *'", src, 4000);

// Manual/bookings regression blocks
const manualResaBlock = extractBlock("app.post('/api/reservations/manual'", src);
const bookingsBlock   = extractBlock("app.post('/api/bookings', authenticateAny", src);

// ── A: Checkout Session currency ──────────────────────────────────────────────

describe('A — Checkout Session currency (create-checkout-session)', () => {
  test('A-01 handler present', () => {
    expect(checkoutSessionBlock).not.toBe('');
  });

  test('A-02 property query now selects p.currency', () => {
    expect(checkoutSessionBlock).toMatch(/SELECT.*p\.currency.*FROM properties p/s);
  });

  test('A-03 bookingCurrency derived from normalizeCurrency(prop.currency)', () => {
    expect(checkoutSessionBlock).toMatch(/bookingCurrency\s*=\s*normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-04 Stripe session uses bookingCurrency.toLowerCase() — no hardcoded eur', () => {
    expect(checkoutSessionBlock).toMatch(/currency:\s*bookingCurrency\.toLowerCase\(\)/);
    expect(checkoutSessionBlock).not.toMatch(/currency:\s*['"]eur['"]/);
  });

  test('A-05 booking_currency snapshot added to session metadata', () => {
    expect(checkoutSessionBlock).toMatch(/booking_currency:\s*bookingCurrency/);
  });

  test('A-06 deferred setup path inherits booking_currency from session metadata (spread)', () => {
    // setup_intent_data spreads ...sessionParams.metadata which already contains booking_currency
    expect(checkoutSessionBlock).toMatch(/setup_intent_data.*metadata.*sessionParams\.metadata/s);
  });
});

// ── B: PaymentIntent currency ──────────────────────────────────────────────────

describe('B — PaymentIntent currency (guest/book)', () => {
  test('B-01 handler present', () => {
    expect(guestBookBlock).not.toBe('');
  });

  test('B-02 bookingCurrency derived from holdCurrencyForBook || normalizeCurrency(prop.currency) || EUR (F9)', () => {
    // F9: hold.currency is authoritative for fixed-price holds; property.currency is fallback
    expect(guestBookBlock).toMatch(/bookingCurrency\s*=\s*holdCurrencyForBook\s*\|\|\s*normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-03 PaymentIntent uses bookingCurrency.toLowerCase() — no hardcoded eur', () => {
    expect(guestBookBlock).toMatch(/currency:\s*bookingCurrency\.toLowerCase\(\)/);
    expect(guestBookBlock).not.toMatch(/currency:\s*['"]eur['"]/);
  });

  test('B-04 booking_currency snapshot added to PaymentIntent metadata', () => {
    expect(guestBookBlock).toMatch(/booking_currency:\s*bookingCurrency/);
  });

  test('B-05 reservationCurrency set to bookingCurrency (no second normalizeCurrency call)', () => {
    expect(guestBookBlock).toMatch(/reservationCurrency\s*=\s*bookingCurrency/);
  });
});

// ── C: Webhook reservation persistence ────────────────────────────────────────

describe('C — Webhook reservation persistence (BHGUEST_ INSERTs)', () => {
  test('C-01 webhook block present', () => {
    expect(webhookBlock).not.toBe('');
  });

  test('C-02 deferred setup INSERT includes currency column', () => {
    // Deferred path: INSERT with deferredCurrency = m.booking_currency || 'EUR'
    expect(webhookBlock).toMatch(/deferredCurrency\s*=\s*m\.booking_currency\s*\|\|\s*['"]EUR['"]/);
  });

  test('C-03 deferred setup INSERT uses deferredCurrency as parameter', () => {
    expect(webhookBlock).toMatch(/INSERT INTO reservations[\s\S]*?currency[\s\S]*?deferredCurrency/);
  });

  test('C-04 payment path computes webhookCurrency from session.currency', () => {
    expect(webhookBlock).toMatch(/webhookCurrency\s*=\s*\(session\.currency\s*\|\|/);
  });

  test('C-05 payment path INSERT includes currency column and webhookCurrency param', () => {
    expect(webhookBlock).toMatch(/INSERT INTO reservations[\s\S]*?currency[\s\S]*?webhookCurrency/);
  });

  test('C-06 INTL-CONFLICT logged when session.currency and booking_currency diverge', () => {
    expect(webhookBlock).toMatch(/INTL-CONFLICT/);
  });

  test('C-07 payment path authority chain: session.currency || booking_currency || eur', () => {
    expect(webhookBlock).toMatch(/session\.currency\s*\|\|\s*session\.metadata\?\.booking_currency\s*\|\|\s*['"]eur['"]/);
  });
});

// ── D: reservationsStore denomination ─────────────────────────────────────────

describe('D — reservationsStore denomination', () => {
  test('D-01 store push block found', () => {
    expect(storePushBlock).not.toBe('');
  });

  test('D-02 store push uses webhookCurrency (not hardcoded EUR)', () => {
    expect(storePushBlock).toMatch(/currency:\s*webhookCurrency/);
  });

  test('D-03 no unconditional currency:\'EUR\' on Stripe-derived booking object', () => {
    // webhookCurrency replaces the old hardcoded 'EUR'
    expect(storePushBlock).not.toMatch(/currency:\s*['"]EUR['"]/);
  });
});

// ── E: recover-sessions historical denomination ───────────────────────────────

describe('E — recover-sessions historical denomination', () => {
  test('E-01 handler present', () => {
    expect(recoverSessionsBlock).not.toBe('');
  });

  test('E-02 reservationCurrency uses session.currency as primary authority', () => {
    expect(recoverSessionsBlock).toMatch(/session\.currency[\s\S]*?\.toUpperCase\(\)/);
  });

  test('E-03 property currency only as fallback', () => {
    // session.currency primary, then normalizeCurrency(prop.currency) fallback
    expect(recoverSessionsBlock).toMatch(/session\.currency[\s\S]*?normalizeCurrency\(prop\.currency\)/s);
  });
});

// ── F: confirm-after-payment historical denomination ──────────────────────────

describe('F — confirm-after-payment historical denomination', () => {
  test('F-01 handler present', () => {
    expect(confirmAfterPayBlock).not.toBe('');
  });

  test('F-02 stripeSessionCurrency captured from Stripe retrieve', () => {
    expect(confirmAfterPayBlock).toMatch(/stripeSessionCurrency\s*=\s*session\.currency\s*\|\|\s*null/);
  });

  test('F-03 reservationCurrency uses stripeSessionCurrency as primary authority', () => {
    expect(confirmAfterPayBlock).toMatch(/stripeSessionCurrency[\s\S]*?\.toUpperCase\(\)/);
  });

  test('F-04 property currency only as fallback', () => {
    expect(confirmAfterPayBlock).toMatch(/stripeSessionCurrency[\s\S]*?normalizeCurrency\(prop\.currency\)/s);
  });
});

// ── G: No FX ──────────────────────────────────────────────────────────────────

describe('G — no FX conversion', () => {
  test('G-01 no exchangeRate in checkout-session block', () => {
    expect(checkoutSessionBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('G-02 no exchangeRate in guest/book block', () => {
    expect(guestBookBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('G-03 no exchangeRate in confirm-after-payment block', () => {
    expect(confirmAfterPayBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });

  test('G-04 no exchangeRate in recover-sessions block', () => {
    expect(recoverSessionsBlock).not.toMatch(/exchangeRate|fxRate|convertCurrency/);
  });
});

// ── H: Presentation (emails / push) ──────────────────────────────────────────

describe('H — presentation: no hardcoded € on accommodation monetary amounts', () => {
  test('H-01 deferred guest email uses booking_currency not bare €', () => {
    // "m.booking_currency || 'EUR'" is now used in the amount display
    expect(webhookBlock).toMatch(/m\.booking_currency\s*\|\|\s*['"]EUR['"]/);
  });

  test('H-02 deferred host push body does not end amount with bare €', () => {
    // Old: ` · ${amountD.toFixed(0)}€`
    // New: ` · ${amountD.toFixed(0)} ${m.booking_currency || 'EUR'}`
    expect(webhookBlock).not.toMatch(/amountD\.toFixed\(0\)`/);
    expect(webhookBlock).toMatch(/amountD\.toFixed\(0\)\}\s*\$\{m\.booking_currency/);
  });

  test('H-03 webhook host email amount uses webhookCurrency', () => {
    expect(webhookBlock).toMatch(/amountTotal\.toFixed\(2\)\}\s*\$\{webhookCurrency\}/);
  });

  test('H-04 webhook host push body uses webhookCurrency', () => {
    expect(webhookBlock).toMatch(/amountTotal\.toFixed\(0\)\}\s*\$\{webhookCurrency\}/);
  });

  test('H-05 sub-account payment notification uses session.currency', () => {
    expect(webhookBlock).toMatch(/session\.currency.*toUpperCase/);
  });

  test('H-06 confirm-after-payment guest email uses reservationCurrency', () => {
    expect(confirmAfterPayBlock).toMatch(/totalTTC\}\s*\$\{reservationCurrency\}/);
  });

  test('H-07 confirm-after-payment payment notification uses reservationCurrency', () => {
    // amtLabel = `... ${totalTTC.toFixed(2) : totalTTC} ${reservationCurrency}` — not bare €
    expect(confirmAfterPayBlock).toMatch(/amtLabel[\s\S]*?reservationCurrency/);
    expect(confirmAfterPayBlock).not.toMatch(/amtLabel[\s\S]{0,100}€'/);
  });

  test('H-08 deferred cron capture email uses deferredCaptureCurrency', () => {
    expect(deferredCronBlock).toMatch(/deferredCaptureCurrency/);
    expect(deferredCronBlock).not.toMatch(/amount_cents.*\/\s*100.*toFixed.*€`/);
  });
});

// ── I: Regression ─────────────────────────────────────────────────────────────

describe('I — regression', () => {
  test('I-01 RESERVATION-1 manual reservation fix still present', () => {
    expect(manualResaBlock).toMatch(/normalizeCurrency\(property\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('I-02 RESERVATION-1 POST /api/bookings fix still present', () => {
    expect(bookingsBlock).toMatch(/normalizeCurrency\(property\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('I-03 BHGUEST-1 guest/book still persists currency column', () => {
    expect(guestBookBlock).toMatch(/INSERT INTO reservations[\s\S]*?currency[\s\S]*?reservationCurrency/);
  });

  test('I-04 BHGUEST-1 confirm-after-payment still persists currency column', () => {
    expect(confirmAfterPayBlock).toMatch(/INSERT INTO reservations[\s\S]*?currency[\s\S]*?reservationCurrency/);
  });

  test('I-05 BHGUEST-1 recover-sessions still persists currency column', () => {
    expect(recoverSessionsBlock).toMatch(/INSERT INTO reservations[\s\S]*?currency[\s\S]*?reservationCurrency/);
  });

  test('I-06 legacy EUR behavior preserved (normalizeCurrency fallback)', () => {
    // EUR properties produce bookingCurrency = 'EUR' via the || 'EUR' fallback
    let normalizeCurrency;
    try {
      normalizeCurrency = require('../routes/market-data-resolver').normalizeCurrency;
    } catch(e) { normalizeCurrency = null; }
    if (normalizeCurrency) {
      expect(normalizeCurrency('EUR') || 'EUR').toBe('EUR');
      expect(normalizeCurrency(null)  || 'EUR').toBe('EUR');
    } else {
      // If not importable, at least verify the pattern exists in code
      expect(src).toMatch(/normalizeCurrency.*\|\|\s*['"]EUR['"]/);
    }
  });

  test('I-07 no new hardcoded currency:eur introduced in BHGuest paths', () => {
    // Verify the three main BHGuest paths no longer have the bare hardcoded string
    expect(guestBookBlock).not.toMatch(/\bcurrency:\s*['"]eur['"]/);
    expect(checkoutSessionBlock).not.toMatch(/price_data[\s\S]*?currency:\s*['"]eur['"]/);
  });

  test('I-08 normalizeCurrency available at server module level', () => {
    expect(src).toMatch(/normalizeCurrency.*=.*require.*market-data-resolver/);
  });
});

'use strict';
/**
 * PMS-INTL-P2-FINAL-CLEANUP-1B — Structural regression tests
 *
 * Suites:
 *   A — F10: BHGuest host email uses bhFmtAmount (not hardcoded €)
 *   B — payments.currency: BHGuest hold INSERT + upsell INSERT include currency
 *   C — Guest history: /api/guest/me + cancel-preview expose currency
 *   D — Refunds: backend cancel + frontend display use per-reservation currency
 *   E — F5 push notifications: all 4 monetary push paths use bhFmtAmount
 *   F — F9 hold display: hold-info endpoint + frontend fetch + effectiveCurrency
 *   G — F6 /api/host/stats: multi-currency null guard + monetaryByCurrency
 *   H — F7 /api/reporting: multi-currency null guard + totalsByCurrency
 *   I — S1 Connect Account: no hardcoded acct_, env var + guard
 *   J — Upsell: currency authority chain, no client override, bhFmtAmount in email
 */

const fs   = require('fs');
const path = require('path');

const src       = fs.readFileSync(path.join(__dirname, '../server.js'),   'utf8');
const upsellSrc = fs.readFileSync(path.join(__dirname, '../upsell-service.js'), 'utf8');
const frontSrc  = fs.readFileSync(path.join(__dirname, '../guest-app/public/js/app-guest.js'), 'utf8');

function extractBlock(marker, content, limit = 8000) {
  const idx = content.indexOf(marker);
  if (idx === -1) return '';
  return content.slice(idx, idx + limit);
}

// ── Pre-extracted blocks ──────────────────────────────────────────────────────

// A / B / C
const bhguestBookBlock   = extractBlock("app.post('/api/guest/book'", src, 40000);
const guestMeBlock       = extractBlock("app.get('/api/guest/me'",    src, 5000);
const cancelPreviewBlock = extractBlock("app.get('/api/guest/reservations/:uid/cancel-preview'", src, 4000);
const cancelBlock        = extractBlock("app.post('/api/guest/reservations/:uid/cancel', async", src, 15000);

// E — push notification blocks
const pmtPushBlock    = extractBlock('🔔 Notif compte principal : paiement reçu', src, 3000);
const depSubBlock     = extractBlock('Notif sous-comptes caution', src, 3000);
const depMainBlock    = extractBlock('Notif compte principal : caution', src, 3000);
const captureDepBlock = extractBlock('captureDeposit', src, 5000);

// F
const holdInfoBlock   = extractBlock("app.get('/api/guest/hold-info'", src, 2000);
const goToCheckoutBlock = extractBlock('async function goToCheckout', frontSrc, 3000);
const recalcBlock       = extractBlock('function _recalcTotal', frontSrc, 1500);

// G
const hostStatsBlock  = extractBlock("app.get('/api/host/stats'", src, 20000);

// H
const reportingBlock  = extractBlock("app.get('/api/reporting'", src, 10000);

// J
const upsellRouteBlock = extractBlock("app.post('/api/upsell/manual'", src, 6000);

// ── A: F10 BHGuest host email ─────────────────────────────────────────────────

describe('A — F10 BHGuest host email uses bhFmtAmount', () => {
  test('A-01 bhFmtAmount used for the Reversé label line', () => {
    expect(bhguestBookBlock).toMatch(/bhFmtAmount\(totalBase - commission,\s*bookingCurrency\)/);
  });

  test('A-02 bookingCurrency variable present in booking block', () => {
    expect(bhguestBookBlock).toMatch(/bookingCurrency/);
  });

  test('A-03 no raw hardcoded € on Reversé line', () => {
    const reverseLine = bhguestBookBlock.match(/Reversé.*?\n/);
    if (reverseLine) {
      expect(reverseLine[0]).not.toMatch(/toFixed.*€/);
    }
  });

  test('A-04 BHGuest email total also uses bhFmtAmount with bookingCurrency', () => {
    expect(bhguestBookBlock).toMatch(/bhFmtAmount\([^,]+,\s*bookingCurrency\)/);
  });
});

// ── B: payments.currency INSERT ───────────────────────────────────────────────

describe('B — payments.currency present in BHGuest hold + upsell INSERTs', () => {
  test('B-01 BHGuest hold payment INSERT includes currency column', () => {
    // Column list: (id, user_id, property_id, reservation_uid, amount_cents, currency, ...)
    expect(src).toMatch(/INSERT INTO payments\s*\n\s*\(id, user_id, property_id, reservation_uid, amount_cents, currency/);
    // Value: holdCurrency.toLowerCase() is passed as the currency param
    expect(src).toMatch(/holdCurrency\.toLowerCase\(\)/);
  });

  test('B-02 holdCurrency.toLowerCase() passed as parameter in BHGuest payment INSERT', () => {
    expect(src).toMatch(/holdCurrency\.toLowerCase\(\)/);
  });

  test('B-03 upsell-service.js INSERT INTO payments includes currency column', () => {
    expect(upsellSrc).toMatch(/INSERT INTO payments[\s\S]*?currency/);
  });

  test('B-04 upsell-service.js Stripe session currency is upsellCurrency.toLowerCase() not hardcoded eur', () => {
    // sessionParams is built before checkout.sessions.create; search within price_data block
    const priceDataBlock = extractBlock('price_data:', upsellSrc, 300);
    expect(priceDataBlock).toMatch(/currency:\s*upsellCurrency\.toLowerCase\(\)/);
    expect(upsellSrc).not.toMatch(/currency:\s*['"]eur['"]/);
  });
});

// ── C: Guest history currency ─────────────────────────────────────────────────

describe('C — Guest history and cancel-preview expose currency', () => {
  test('C-01 /api/guest/me SQL SELECT includes r.currency', () => {
    expect(guestMeBlock).toMatch(/r\.currency/);
  });

  test('C-02 /api/guest/me response exposes currency per reservation', () => {
    expect(guestMeBlock).toMatch(/currency:/);
  });

  test('C-03 /api/guest/cancel-preview defines reservationCurrency', () => {
    expect(cancelPreviewBlock).toMatch(/reservationCurrency\s*=/);
  });

  test('C-04 /api/guest/cancel-preview response includes currency field', () => {
    expect(cancelPreviewBlock).toMatch(/currency:\s*reservationCurrency/);
  });
});

// ── D: Refunds ────────────────────────────────────────────────────────────────

describe('D — Refunds: backend cancel + frontend display use per-reservation currency', () => {
  test('D-01 /api/guest/cancel defines cancelCurrency', () => {
    expect(cancelBlock).toMatch(/cancelCurrency\s*=/);
  });

  test('D-02 cancel email uses bhFmtAmount with cancelCurrency (not raw €)', () => {
    expect(cancelBlock).toMatch(/bhFmtAmount\([^)]+cancelCurrency\)/);
  });

  test('D-03 cancel response includes currency: cancelCurrency', () => {
    expect(cancelBlock).toMatch(/currency:\s*cancelCurrency/);
  });

  test('D-04 frontend refund display uses fmtCurrency with pol.currency', () => {
    expect(frontSrc).toMatch(/fmtCurrency\(pol\.refundAmount,\s*pol\.currency/);
  });

  test('D-05 frontend cancel toast uses fmtCurrency with data.currency', () => {
    expect(frontSrc).toMatch(/fmtCurrency\(data\.refundAmount,\s*data\.currency/);
  });
});

// ── E: Push notifications currency ───────────────────────────────────────────

describe('E — F5 push notifications use bhFmtAmount (not hardcoded €)', () => {
  test('E-01 payment push SQL includes COALESCE(r.currency, p.currency) as payment_currency', () => {
    expect(pmtPushBlock).toMatch(/COALESCE\(r\.currency,\s*p\.currency\)\s*as\s*payment_currency/);
  });

  test('E-02 payment push uses bhFmtAmount with pmtCur', () => {
    expect(pmtPushBlock).toMatch(/bhFmtAmount\(amount_cents\s*\/\s*100,\s*pmtCur\)/);
  });

  test('E-03 caution sous-compte push SQL includes d.currency as deposit_currency', () => {
    const depSub2 = extractBlock('Notif sous-compte : caution', src, 2000);
    const found = depSubBlock.includes('deposit_currency') || depSub2.includes('deposit_currency') ||
      extractBlock('SELECT d.user_id', src, 1000).includes('deposit_currency');
    expect(src).toMatch(/d\.currency as deposit_currency/);
  });

  test('E-04 caution sous-compte push uses bhFmtAmount with depCur', () => {
    expect(src).toMatch(/bhFmtAmount\(amount_cents\s*\/\s*100,\s*depCur\)/);
  });

  test('E-05 caution débitée (captureDeposit) defines depositCurrency', () => {
    expect(captureDepBlock).toMatch(/depositCurrency\s*=\s*normalizeCurrency\(depositData\.currency\)/);
  });

  test('E-06 caution débitée push uses bhFmtAmount with depositCurrency', () => {
    expect(captureDepBlock).toMatch(/bhFmtAmount\(depositAmount,\s*depositCurrency\)/);
  });
});

// ── F: F9 hold display ────────────────────────────────────────────────────────

describe('F — F9 hold display: hold-info endpoint + frontend currency fetch', () => {
  test('F-01 GET /api/guest/hold-info endpoint exists', () => {
    expect(holdInfoBlock).not.toBe('');
    expect(holdInfoBlock).toMatch(/hold-info/);
  });

  test('F-02 hold-info SQL selects currency from bhguest_holds', () => {
    expect(holdInfoBlock).toMatch(/SELECT fixed_price,\s*currency,\s*status,\s*expires_at FROM bhguest_holds/);
  });

  test('F-03 hold-info response includes normalizeCurrency on currency field', () => {
    expect(holdInfoBlock).toMatch(/currency:\s*normalizeCurrency\(hold\.currency\)/);
  });

  test('F-04 hold-info response includes active flag (expiry check)', () => {
    expect(holdInfoBlock).toMatch(/active:\s*isActive/);
  });

  test('F-05 goToCheckout in app-guest.js is async', () => {
    expect(goToCheckoutBlock).toMatch(/^async function goToCheckout/m);
  });

  test('F-06 goToCheckout fetches /api/guest/hold-info before checkout', () => {
    expect(goToCheckoutBlock).toMatch(/api\/guest\/hold-info/);
  });

  test('F-07 goToCheckout stores _holdCurrency on property', () => {
    expect(goToCheckoutBlock).toMatch(/_holdCurrency\s*=\s*holdInfo\.currency/);
  });

  test('F-08 _recalcTotal uses _holdCurrency when _holdToken is set', () => {
    expect(recalcBlock).toMatch(/_holdToken.*_holdCurrency/s);
  });
});

// ── G: F6 /api/host/stats ─────────────────────────────────────────────────────

describe('G — F6 /api/host/stats: multi-currency null guard + monetaryByCurrency', () => {
  test('G-01 SQL includes r.currency in SELECT', () => {
    expect(hostStatsBlock).toMatch(/r\.currency/);
  });

  test('G-02 _statsUniqueCurrencies derived via new Set + normalizeCurrency', () => {
    expect(src).toMatch(/_statsUniqueCurrencies\s*=\s*\[\.\.\.new Set\(/);
  });

  test('G-03 _statsSingleCurrency is null when multiple currencies', () => {
    expect(src).toMatch(/_statsSingleCurrency\s*=\s*_statsUniqueCurrencies\.length\s*===\s*1\s*\?/);
  });

  test('G-04 net total is null when multi-currency', () => {
    expect(src).toMatch(/net:\s*_statsSingleCurrency\s*\?\s*[\s\S]*?:\s*null/);
  });

  test('G-05 monetaryByCurrency object is built per currency', () => {
    expect(src).toMatch(/monetaryByCurrency/);
    expect(src).toMatch(/monetaryByCurrency\[cur\]\s*=/);
  });

  test('G-06 response includes singleCurrency and currencies array for stats', () => {
    const statsRespBlock = extractBlock('singleCurrency: _statsSingleCurrency', src, 500);
    expect(statsRespBlock).toMatch(/singleCurrency:\s*_statsSingleCurrency/);
    expect(statsRespBlock).toMatch(/currencies:\s*_statsUniqueCurrencies/);
  });
});

// ── H: F7 /api/reporting ─────────────────────────────────────────────────────

describe('H — F7 /api/reporting: multi-currency null guard + totalsByCurrency', () => {
  test('H-01 reporting SQL includes r.currency in SELECT', () => {
    expect(reportingBlock).toMatch(/r\.currency/);
  });

  test('H-02 _singleCurrency null when multi-currency in reporting block', () => {
    expect(src).toMatch(/_singleCurrency\s*=\s*_uniqueCurrencies\.length\s*===\s*1\s*\?/);
  });

  test('H-03 totalGrossRevenue is null when multi-currency', () => {
    expect(src).toMatch(/totalGrossRevenue:\s*_singleCurrency\s*\?[\s\S]*?:\s*null/);
  });

  test('H-04 totalNetRevenue is null when multi-currency', () => {
    expect(src).toMatch(/totalNetRevenue:\s*_singleCurrency\s*\?[\s\S]*?:\s*null/);
  });

  test('H-05 totalsByCurrency object present in reporting response', () => {
    expect(src).toMatch(/totalsByCurrency/);
    const byCurBlock = extractBlock('_totalsByCurrency', src, 2000);
    expect(byCurBlock).toMatch(/_totalsByCurrency\[cur\]/);
  });

  test('H-06 totalOtaCommission is null when multi-currency', () => {
    expect(src).toMatch(/totalOtaCommission:\s*_singleCurrency\s*\?[\s\S]*?:\s*null/);
  });
});

// ── I: S1 Connect Account ─────────────────────────────────────────────────────

describe('I — S1 Connect Account: env var, no hardcoded acct_', () => {
  test('I-01 no hardcoded acct_1TE4RFFT0WaR8aHH in server.js', () => {
    expect(src).not.toMatch(/acct_1TE4RFFT0WaR8aHH/);
  });

  test('I-02 BHGUEST_CONNECT_ACCOUNT_ID env var referenced in server.js', () => {
    expect(src).toMatch(/process\.env\.BHGUEST_CONNECT_ACCOUNT_ID/);
  });

  test('I-03 startsWith(\'acct_\') guard before using the env-derived value', () => {
    const connectBlock = extractBlock('BHGUEST_CONNECT_ACCOUNT_ID', src, 500);
    expect(connectBlock).toMatch(/startsWith\(['"]acct_['"]\)/);
  });

  test('I-04 env var fallback is empty string (not a real account id)', () => {
    const connectBlock = extractBlock('BHGUEST_CONNECT_ACCOUNT_ID', src, 300);
    expect(connectBlock).toMatch(/\|\|\s*['"]{2}/);
  });

  test('I-05 session retrieval only attempted when guard passes', () => {
    const connectBlock = extractBlock('BHGUEST_CONNECT_ACCOUNT_ID', src, 600);
    expect(connectBlock).toMatch(/if\s*\([\s\S]*?_connectAccount\.startsWith/);
  });
});

// ── J: Upsell currency authority chain ───────────────────────────────────────

describe('J — Upsell: currency authority chain, no client override, bhFmtAmount in email', () => {
  test('J-01 upsell route queries properties with currency column', () => {
    expect(upsellRouteBlock).toMatch(/SELECT id,\s*name,\s*currency FROM properties/);
  });

  test('J-02 upsellCurrency fallback chain: normalizeCurrency(property.currency) || EUR', () => {
    expect(upsellRouteBlock).toMatch(/upsellCurrency\s*=\s*normalizeCurrency\(property\?\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('J-03 reservation currency overrides property currency (resolution chain)', () => {
    expect(upsellRouteBlock).toMatch(/resaCurr\s*=\s*normalizeCurrency\(/);
    expect(upsellRouteBlock).toMatch(/if\s*\(resaCurr\)\s*upsellCurrency\s*=\s*resaCurr/);
  });

  test('J-04 currency passed to createUpsellPaymentLink (not req.body.currency)', () => {
    expect(upsellRouteBlock).toMatch(/currency:\s*upsellCurrency/);
    expect(upsellRouteBlock).not.toMatch(/currency:\s*req\.body\.currency/);
  });

  test('J-05 upsell email CTA uses bhFmtAmount with link.currency (not raw € or toFixed)', () => {
    expect(upsellRouteBlock).toMatch(/bhFmtAmount\(amountCents\s*\/\s*100,\s*link\.currency/);
    const emailLine = upsellRouteBlock.match(/emailCTABlock\([^)]+\)/);
    if (emailLine) {
      expect(emailLine[0]).not.toMatch(/toFixed.*€/);
    }
  });
});

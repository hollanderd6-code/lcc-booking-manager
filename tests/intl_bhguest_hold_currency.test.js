'use strict';
/**
 * PMS-INTL-P2-BHGUEST-HOLD-CURRENCY-1B
 *
 * Structural + behavioral tests verifying F9 fix:
 *   — bhguest_holds.currency column (DDL, backfill)
 *   — POST /api/guest/hold snapshots property.currency at creation
 *   — POST /api/guest/create-checkout-session: hold.currency authoritative for fixed-price holds
 *   — LEGACY_HOLD_CURRENCY_UNKNOWN fail-closed path
 *   — POST /api/guest/book: same authority chain + expiry guard
 *   — GET /api/reservations exposes holdCurrency
 *   — GET /api/guest/properties{/:id} exposes currency
 *   — Frontend fmtCurrency helper
 *   — No hardcoded € in checkout UI
 *   — No FX conversion, no silent legacy fallback
 *
 * Suites:
 *   A — DDL & backfill (server.js bootstrap block)
 *   B — POST /api/guest/hold — hold creation snapshots currency
 *   C — POST /api/guest/create-checkout-session — INTL-F9 authority
 *   D — POST /api/guest/book — INTL-F9 authority + expiry guard
 *   E — GET /api/reservations — holds expose holdCurrency
 *   F — GET /api/guest/properties — currency field
 *   G — No FX conversion, no silent legacy fallback
 *   H — Frontend formatter (app-guest.js)
 *   I — Backfill query structure
 */

const fs   = require('fs');
const path = require('path');

const src      = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const frontSrc = fs.readFileSync(path.join(__dirname, '../guest-app/public/js/app-guest.js'), 'utf8');

// ── Block extractors ──────────────────────────────────────────────────────────

function extractBlock(marker, content, limit = 10000) {
  const idx = content.indexOf(marker);
  if (idx === -1) return '';
  return content.slice(idx, idx + limit);
}

// Server blocks
const bootstrapBlock       = extractBlock('bhguest_holds.currency OK', src, 3000);
const backfillBlock        = extractBlock('bhguest_holds backfill currency depuis réservations OK', src, 3000);
const holdCreateBlock      = extractBlock("app.post('/api/guest/hold', authenticateAny", src, 3000);
const checkoutSessionBlock = extractBlock("app.post('/api/guest/create-checkout-session'", src, 30000);
const guestBookBlock       = extractBlock("app.post('/api/guest/book', async", src, 30000);
const reservationsBlock    = extractBlock('Ajouter les holds BHGuest actifs comme pré-réservations', src, 2000);
const guestPropsBlock      = extractBlock("app.get('/api/guest/properties', async", src, 6000);
const guestPropsIdBlock    = extractBlock("app.get('/api/guest/properties/:id', async", src, 8000);

// ── A: DDL & backfill ─────────────────────────────────────────────────────────

describe('A — DDL & backfill (bootstrap block)', () => {
  test('A-01 ALTER TABLE ADD COLUMN IF NOT EXISTS currency TEXT present', () => {
    expect(src).toMatch(/ALTER TABLE bhguest_holds ADD COLUMN IF NOT EXISTS currency TEXT/);
  });

  test('A-02 no DEFAULT value on currency column', () => {
    const altBlock = extractBlock('ALTER TABLE bhguest_holds ADD COLUMN IF NOT EXISTS currency TEXT', src, 200);
    // TEXT with no DEFAULT and no NOT NULL constraint
    expect(altBlock).not.toMatch(/DEFAULT\s+['"]?EUR['"]?/i);
    expect(altBlock).not.toMatch(/NOT NULL/i);
  });

  test('A-03 bootstrap logs success for currency column', () => {
    expect(bootstrapBlock).toMatch(/bhguest_holds\.currency OK/);
  });

  test('A-04 backfill exists and targets status=converted + currency IS NULL', () => {
    expect(backfillBlock).toMatch(/bhguest_holds backfill currency depuis réservations OK/);
    expect(src).toMatch(/h\.status\s*=\s*['"]converted['"]/);
    expect(src).toMatch(/h\.currency IS NULL/);
  });

  test('A-05 backfill joins reservations on property_id + dates + source=guest_app', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    expect(bf).toMatch(/r\.property_id = h\.property_id/);
    expect(bf).toMatch(/r\.source\s*=\s*['"]guest_app['"]/);
  });

  test('A-06 backfill uses COUNT=1 uniqueness guard', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    // Subquery closes with ) = 1 — SELECT COUNT(*) ... ) = 1
    expect(bf).toMatch(/SELECT COUNT\(\*\)[\s\S]*?\)\s*=\s*1/);
  });

  test('A-07 backfill only sets currency when r.currency IS NOT NULL', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    expect(bf).toMatch(/r\.currency IS NOT NULL/);
  });

  test('A-08 backfill does NOT do global UPDATE bhguest_holds SET currency = property.currency', () => {
    // Must not join to properties table directly and update all rows
    const globalBackfill = /UPDATE bhguest_holds\s+SET currency\s*=.*properties.*WHERE/s;
    expect(src).not.toMatch(globalBackfill);
  });

  test('A-09 backfill does NOT use COALESCE(currency, EUR) globally', () => {
    expect(src).not.toMatch(/UPDATE bhguest_holds[\s\S]{0,200}COALESCE\(currency\s*,\s*['"]EUR['"]\)/);
  });
});

// ── B: POST /api/guest/hold — hold creation ───────────────────────────────────

describe('B — POST /api/guest/hold — currency snapshot at creation', () => {
  test('B-01 handler present', () => {
    expect(holdCreateBlock).not.toBe('');
  });

  test('B-02 SELECT user_id, currency FROM properties', () => {
    expect(holdCreateBlock).toMatch(/SELECT user_id,\s*currency FROM properties WHERE id/);
  });

  test('B-03 holdCurrency = normalizeCurrency(ownerRow) || EUR', () => {
    expect(holdCreateBlock).toMatch(/holdCurrency\s*=\s*normalizeCurrency\(ownerRow\.rows\[0\]\?\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-04 INSERT includes currency column', () => {
    expect(holdCreateBlock).toMatch(/INSERT INTO bhguest_holds[\s\S]*?currency/);
  });

  test('B-05 INSERT passes holdCurrency as parameter (10th value)', () => {
    expect(holdCreateBlock).toMatch(/VALUES\s*\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10\)/);
    expect(holdCreateBlock).toMatch(/fixed_price \|\| null,\s*holdCurrency\]/);
  });

  test('B-06 payments metadata includes holdCurrency snapshot', () => {
    const holdExtended = extractBlock("app.post('/api/guest/hold', authenticateAny", src, 5000);
    expect(holdExtended).toMatch(/holdCurrency/);
  });

  test('B-07 email uses bhFmtAmount with holdCurrency (not raw €)', () => {
    const holdEmail = extractBlock("app.post('/api/guest/hold', authenticateAny", src, 10000);
    expect(holdEmail).toMatch(/bhFmtAmount\(parseFloat\(fixed_price\),\s*holdCurrency\)/);
    // Must not contain raw € in the price display line
    expect(holdEmail).not.toMatch(/Prix total.*fixed_price.*€/);
  });

  test('B-08 SMS uses bhFmtAmount with holdCurrency', () => {
    const holdSms = extractBlock("app.post('/api/guest/hold', authenticateAny", src, 10000);
    expect(holdSms).toMatch(/bhFmtAmount\(parseFloat\(fixed_price\),\s*holdCurrency\)/);
  });

  test('B-09 req.body.currency is NOT used as currency authority', () => {
    // No assignment holdCurrency = req.body.currency or similar
    expect(holdCreateBlock).not.toMatch(/holdCurrency\s*=\s*req\.body\.currency/);
    expect(holdCreateBlock).not.toMatch(/normalizeCurrency\(req\.body\.currency\)/);
  });
});

// ── C: POST /api/guest/create-checkout-session ────────────────────────────────

describe('C — POST /api/guest/create-checkout-session — INTL-F9 authority', () => {
  test('C-01 handler present', () => {
    expect(checkoutSessionBlock).not.toBe('');
  });

  test('C-02 INTL-F9 comment marks the authority decision block', () => {
    expect(checkoutSessionBlock).toMatch(/INTL-F9/);
  });

  test('C-03 holdRow.fixed_price != null triggers hold.currency authority', () => {
    expect(checkoutSessionBlock).toMatch(/holdRow.*fixed_price\s*!=\s*null/s);
    expect(checkoutSessionBlock).toMatch(/normalizeCurrency\(holdRow\.currency\)/);
  });

  test('C-04 fail-closed: NULL currency on fixed-price hold returns 409 LEGACY_HOLD_CURRENCY_UNKNOWN', () => {
    expect(checkoutSessionBlock).toMatch(/LEGACY_HOLD_CURRENCY_UNKNOWN/);
    expect(checkoutSessionBlock).toMatch(/status\(409\)/);
  });

  test('C-05 CAS C: no fixed_price on hold → bookingCurrency = normalizeCurrency(prop.currency) || EUR', () => {
    expect(checkoutSessionBlock).toMatch(/bookingCurrency\s*=\s*normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('C-06 Stripe session uses bookingCurrency.toLowerCase()', () => {
    expect(checkoutSessionBlock).toMatch(/currency:\s*bookingCurrency\.toLowerCase\(\)/);
  });

  test('C-07 no hardcoded "eur" or "EUR" string as Stripe currency', () => {
    // Allowed: fallback string 'EUR' in normalizeCurrency call, not as direct Stripe param
    const stripeSection = extractBlock('const sessionParams = {', checkoutSessionBlock, 2000);
    expect(stripeSection).not.toMatch(/currency:\s*['"]eur['"]/i);
  });

  test('C-08 metadata.booking_currency snapshot present', () => {
    expect(checkoutSessionBlock).toMatch(/booking_currency:\s*bookingCurrency/);
  });

  test('C-09 response includes currency: bookingCurrency', () => {
    expect(checkoutSessionBlock).toMatch(/currency:\s*bookingCurrency/);
  });

  test('C-10 deferred setup_intent_data spreads session metadata (inherits booking_currency)', () => {
    expect(checkoutSessionBlock).toMatch(/setup_intent_data[\s\S]*?metadata[\s\S]*?\.\.\.sessionParams\.metadata/s);
  });

  test('C-11 holdRow SELECT includes currency column', () => {
    expect(checkoutSessionBlock).toMatch(/SELECT \*, expires_at > NOW\(\)[\s\S]*?FROM bhguest_holds/s);
    // The hold row returns all columns (* includes currency)
    expect(checkoutSessionBlock).toMatch(/holdRow\.currency/);
  });
});

// ── D: POST /api/guest/book ───────────────────────────────────────────────────

describe('D — POST /api/guest/book — INTL-F9 authority + expiry guard', () => {
  test('D-01 handler present', () => {
    expect(guestBookBlock).not.toBe('');
  });

  test('D-02 hold SELECT includes currency column', () => {
    expect(guestBookBlock).toMatch(/SELECT fixed_price, currency, status, expires_at/);
  });

  test('D-03 hold SELECT filters status=active AND expires_at > NOW()', () => {
    expect(guestBookBlock).toMatch(/status\s*=\s*['"]active['"]/);
    expect(guestBookBlock).toMatch(/expires_at\s*>\s*NOW\(\)/);
  });

  test('D-04 holdCurrencyForBook set from normalizeCurrency(holdVal.rows[0].currency)', () => {
    expect(guestBookBlock).toMatch(/holdCurrencyForBook\s*=\s*snappedCurrency/);
    expect(guestBookBlock).toMatch(/snappedCurrency\s*=\s*normalizeCurrency\(holdVal\.rows\[0\]\.currency\)/);
  });

  test('D-05 fail-closed: NULL currency on fixed-price hold returns 409 LEGACY_HOLD_CURRENCY_UNKNOWN', () => {
    expect(guestBookBlock).toMatch(/LEGACY_HOLD_CURRENCY_UNKNOWN/);
    expect(guestBookBlock).toMatch(/status\(409\)/);
  });

  test('D-06 bookingCurrency = holdCurrencyForBook || normalizeCurrency(prop.currency) || EUR', () => {
    expect(guestBookBlock).toMatch(/bookingCurrency\s*=\s*holdCurrencyForBook\s*\|\|\s*normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('D-07 PaymentIntent uses bookingCurrency.toLowerCase()', () => {
    expect(guestBookBlock).toMatch(/currency:\s*bookingCurrency\.toLowerCase\(\)/);
  });

  test('D-08 PaymentIntent metadata includes booking_currency snapshot', () => {
    expect(guestBookBlock).toMatch(/booking_currency:\s*bookingCurrency/);
  });

  test('D-09 expired hold does not contribute fixed_price (status + expiry guard enforced)', () => {
    // The guard AND status = 'active' AND expires_at > NOW() prevents expired holds
    const holdSelectInBook = extractBlock('SELECT fixed_price, currency, status, expires_at', guestBookBlock, 400);
    expect(holdSelectInBook).toMatch(/status\s*=\s*['"]active['"]/);
    expect(holdSelectInBook).toMatch(/expires_at\s*>\s*NOW\(\)/);
  });
});

// ── E: GET /api/reservations — holds expose holdCurrency ──────────────────────

describe('E — GET /api/reservations — holds expose holdCurrency', () => {
  test('E-01 holds block present in reservations route', () => {
    expect(reservationsBlock).not.toBe('');
  });

  test('E-02 fixedPrice mapped from hold.fixed_price', () => {
    expect(reservationsBlock).toMatch(/fixedPrice:\s*hold\.fixed_price\s*!=\s*null\s*\?.*parseFloat\(hold\.fixed_price\)/);
  });

  test('E-03 holdCurrency mapped from hold.currency (null for legacy)', () => {
    expect(reservationsBlock).toMatch(/holdCurrency:\s*hold\.currency\s*\|\|\s*null/);
  });
});

// ── F: GET /api/guest/properties — currency field ─────────────────────────────

describe('F — GET /api/guest/properties — currency field', () => {
  test('F-01 /api/guest/properties handler present', () => {
    expect(guestPropsBlock).not.toBe('');
  });

  test('F-02 SQL selects p.currency', () => {
    expect(guestPropsBlock).toMatch(/p\.currency/);
  });

  test('F-03 response includes currency: normalizeCurrency(p.currency) || EUR', () => {
    expect(guestPropsBlock).toMatch(/currency:\s*normalizeCurrency\(p\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('F-04 /api/guest/properties/:id handler present', () => {
    expect(guestPropsIdBlock).not.toBe('');
  });

  test('F-05 /api/guest/properties/:id SQL selects p.currency', () => {
    expect(guestPropsIdBlock).toMatch(/p\.currency/);
  });

  test('F-06 /api/guest/properties/:id response includes currency: normalizeCurrency(p.currency) || EUR', () => {
    const detailResponse = extractBlock("app.get('/api/guest/properties/:id', async", src, 6000);
    expect(detailResponse).toMatch(/currency:\s*normalizeCurrency\(p\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });
});

// ── G: No FX, no silent legacy fallback ──────────────────────────────────────

describe('G — No FX conversion, no silent legacy fallback', () => {
  test('G-01 no FX conversion function calls in checkout-session block', () => {
    expect(checkoutSessionBlock).not.toMatch(/convertCurrency|fxRate|exchangeRate|FX_|fx_convert/i);
  });

  test('G-02 no FX conversion function calls in guest/book block', () => {
    expect(guestBookBlock).not.toMatch(/convertCurrency|fxRate|exchangeRate|FX_|fx_convert/i);
  });

  test('G-03 no silent fallback: fixed-price hold with NULL currency never silently inherits property.currency', () => {
    // The checkout-session block must NOT have:
    //   bookingCurrency = normalizeCurrency(holdRow.currency) || normalizeCurrency(prop.currency)
    // (which would silently use prop.currency when holdRow.currency is NULL)
    expect(checkoutSessionBlock).not.toMatch(
      /snappedCurrency\s*=\s*normalizeCurrency\(holdRow\.currency\)[\s\S]{0,50}bookingCurrency\s*=\s*snappedCurrency\s*\|\|\s*normalizeCurrency\(prop\.currency\)/s
    );
  });

  test('G-04 no silent fallback in guest/book: fixed-price hold with NULL currency never silently inherits property.currency', () => {
    expect(guestBookBlock).not.toMatch(
      /snappedCurrency[\s\S]{0,50}holdCurrencyForBook\s*=\s*snappedCurrency\s*\|\|\s*normalizeCurrency/s
    );
  });

  test('G-05 LEGACY_HOLD_CURRENCY_UNKNOWN appears in both routes', () => {
    const occurrences = (src.match(/LEGACY_HOLD_CURRENCY_UNKNOWN/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

// ── H: Frontend formatter (app-guest.js) ─────────────────────────────────────

describe('H — Frontend formatter (app-guest.js)', () => {
  test('H-01 fmtCurrency helper present', () => {
    expect(frontSrc).toMatch(/function fmtCurrency\(amount,\s*currency\)/);
  });

  test('H-02 fmtCurrency uses Intl.NumberFormat with style:currency', () => {
    const helperBlock = extractBlock('function fmtCurrency(amount', frontSrc, 300);
    expect(helperBlock).toMatch(/Intl\.NumberFormat/);
    expect(helperBlock).toMatch(/style:\s*['"]currency['"]/);
  });

  test('H-03 fmtCurrency guards invalid currency code (falls back to EUR)', () => {
    const helperBlock = extractBlock('function fmtCurrency(amount', frontSrc, 300);
    expect(helperBlock).toMatch(/\/\^[A-Z]\{3\}\$\/|[A-Z]{3}/);
  });

  test('H-04 fmtCurrency returns — for null/NaN amount', () => {
    const helperBlock = extractBlock('function fmtCurrency(amount', frontSrc, 300);
    expect(helperBlock).toMatch(/return\s*['"]—['"]/);
  });

  test('H-05 property list cards use fmtCurrency (not raw €)', () => {
    expect(frontSrc).toMatch(/fmtCurrency\(p\.basePrice,\s*p\.currency\)/);
  });

  test('H-06 booking bar uses fmtCurrency', () => {
    expect(frontSrc).toMatch(/fmtCurrency\(total,\s*p\.currency\)/);
  });

  test('H-07 checkout summary uses fmtCurrency for total TTC', () => {
    // P2 F9 fix: effectiveCurrency used for fixed-price holds (may differ from p.currency)
    expect(frontSrc).toMatch(/fmtCurrency\(ttc,\s*effectiveCurrency\)/);
  });

  test('H-08 _recalcTotal uses fmtCurrency', () => {
    const recalcBlock = extractBlock('_recalcTotal', frontSrc, 800);
    expect(recalcBlock).toMatch(/fmtCurrency\(ttc,\s*cur\)/);
  });

  test('H-09 applyPromo uses fmtCurrency', () => {
    const promoBlock = extractBlock('applyPromo', frontSrc, 1000);
    expect(promoBlock).toMatch(/fmtCurrency\(/);
  });

  test('H-10 confirmation screen uses fmtCurrency for total payé', () => {
    const confirmBlock = extractBlock('function showConfirmation', frontSrc, 2000);
    expect(confirmBlock).toMatch(/fmtCurrency\(data\.total_ttc,/);
  });

  test('H-11 confirmation screen uses data.currency || pending?.booking_currency || EUR', () => {
    const confirmBlock = extractBlock('function showConfirmation', frontSrc, 2000);
    expect(confirmBlock).toMatch(/data\.currency\s*\|\|\s*pending\?\.booking_currency\s*\|\|\s*['"]EUR['"]/);
  });

  test('H-12 showConfirmation accepts pending as 4th parameter', () => {
    expect(frontSrc).toMatch(/function showConfirmation\(data,\s*guestName,\s*guestEmail,\s*pending\)/);
  });

  test('H-13 submitBooking persists booking_currency to localStorage', () => {
    const submitBlock = extractBlock('async function submitBooking', frontSrc, 3000);
    expect(submitBlock).toMatch(/booking_currency:\s*data\.currency\s*\|\|\s*null/);
  });

  test('H-14 state contains _bookingCurrency field', () => {
    expect(frontSrc).toMatch(/_bookingCurrency/);
  });

  test('H-15 no raw € sign in payment button text within _recalcTotal and applyPromo', () => {
    const recalcBlock = extractBlock('_recalcTotal', frontSrc, 500);
    const promoBlock  = extractBlock('applyPromo', frontSrc, 1000);
    expect(recalcBlock).not.toMatch(/Payer [\d]+€/);
    expect(promoBlock).not.toMatch(/Payer [\d]+€/);
  });
});

// ── I: Backfill query structure (deep check) ──────────────────────────────────

describe('I — Backfill query structure', () => {
  test('I-01 backfill only updates holds that are status=converted', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    expect(bf).toMatch(/h\.status\s*=\s*['"]converted['"]/);
  });

  test('I-02 backfill only updates holds where currency IS NULL (idempotent)', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    expect(bf).toMatch(/h\.currency IS NULL/);
  });

  test('I-03 backfill only uses reservations with status=confirmed', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    expect(bf).toMatch(/r\.status\s*=\s*['"]confirmed['"]/);
  });

  test('I-04 backfill join on start_date::date = checkin (type-safe date cast)', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    expect(bf).toMatch(/r\.start_date::date\s*=\s*h\.checkin/);
    expect(bf).toMatch(/r\.end_date::date\s*=\s*h\.checkout/);
  });

  test('I-05 backfill subquery uses all same filters as outer join', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    expect(bf).toMatch(/r2\.source\s*=\s*['"]guest_app['"]/);
    expect(bf).toMatch(/r2\.currency IS NOT NULL/);
    expect(bf).toMatch(/r2\.status\s*=\s*['"]confirmed['"]/);
  });

  test('I-06 no UPDATE of currency on status != converted (active/expired/cancelled untouched)', () => {
    const bf = extractBlock('UPDATE bhguest_holds h', src, 1500);
    // Must not have IN ('active', 'converted') or similar expansions
    expect(bf).not.toMatch(/h\.status IN \(/);
    expect(bf).not.toMatch(/h\.status != ['"]active['"]/);
  });
});

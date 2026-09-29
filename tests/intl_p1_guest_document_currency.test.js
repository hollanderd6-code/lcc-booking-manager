'use strict';
/**
 * PMS-INTL-P1-GUEST-DOCUMENT-CURRENCY-1
 *
 * Structural tests covering the four P1 remediation findings:
 *
 *   F4 — Invoice resend: savedVars now propagates historical currency
 *   F2 — BHGuest guest confirmation email: bhFmtAmount(x, bookingCurrency)
 *   F3 — BHGuest deferred payment failure email: uses deferredCaptureCurrency
 *   F1 — BHGuest public SEO pages: per-property currency, no cross-currency aggregate
 *
 * Suites:
 *   A — F4: Invoice resend currency propagation
 *   B — F2: Guest confirmation email currency
 *   C — F3: Deferred payment failure email currency
 *   D — F1: /logement/:id property detail page
 *   E — F1: /logements listing page
 *   F — F1: /logements/:citySlug city page — per-card currency
 *   G — F1: /logements/:citySlug — multi-currency aggregate guard
 *   H — F1: Schema.org priceRange
 *   I — Historical immutability (invoice resend uses meta.currency, not property.currency)
 *   J — Legacy EUR fallback
 *   K — Hardcode second pass: no bare € on dynamic P1 surfaces
 */

const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// ── Block extractors ──────────────────────────────────────────────────────────

function extractBlock(marker, src, limit = 10000) {
  const idx = src.indexOf(marker);
  if (idx === -1) return '';
  return src.slice(idx, idx + limit);
}

// F4 — invoice resend path
const resendIdx = src.indexOf("app.post('/api/invoice/resend'");
const resendBlock = resendIdx !== -1 ? src.slice(resendIdx, resendIdx + 6000) : '';

// Narrow to the savedVars object itself — increase window to capture last field
const savedVarsIdx = resendBlock.indexOf('const savedVars = {');
const savedVarsBlock = savedVarsIdx !== -1 ? resendBlock.slice(savedVarsIdx, savedVarsIdx + 900) : '';

// F3 — deferred payment failure email (attempts < 3 path)
const deferredCronIdx = src.indexOf("// Relancer le voyageur : carte à mettre à jour");
const deferredFailBlock = deferredCronIdx !== -1 ? src.slice(deferredCronIdx, deferredCronIdx + 800) : '';

// Also check the broader deferred section for deferredCaptureCurrency
const deferredCaptureSectionIdx = src.indexOf('// INTL-BHGUEST-CLOSURE — use the currency stored on the reservation at booking time');
const deferredCaptureBlock = deferredCaptureSectionIdx !== -1
  ? src.slice(deferredCaptureSectionIdx, deferredCaptureSectionIdx + 3000)
  : '';

// F2 — guest/book confirmation email
// The /api/guest/book handler is large; the confirmation email sits ~19k chars into it.
// Extract from the comment marker directly in src rather than slicing a too-short subblock.
const guestBookIdx = src.indexOf("app.post('/api/guest/book'");
const guestBookBlock = guestBookIdx !== -1 ? src.slice(guestBookIdx, guestBookIdx + 30000) : '';
const confEmailIdx = guestBookBlock.indexOf('// ── Email de confirmation au voyageur');
// The payment-summary HTML is ~17k chars after the comment; use a generous window
const confEmailBlock = confEmailIdx !== -1 ? guestBookBlock.slice(confEmailIdx, confEmailIdx + 20000) : '';

// F1 — /logement/:id
const propDetailBlock = extractBlock("app.get('/logement/:id'", src, 10000);

// F1 — /logements
const listingsBlock = extractBlock("app.get('/logements',", src, 3000);

// F1 — /logements/:citySlug
const cityBlock = extractBlock("app.get('/logements/:citySlug'", src, 4000);


// ── A: F4 — Invoice resend currency propagation ───────────────────────────────

describe('A — F4: Invoice resend currency propagation', () => {
  test('A-01 resend handler present', () => {
    expect(resendBlock).not.toBe('');
  });

  test('A-02 savedVars block present', () => {
    expect(savedVarsBlock).not.toBe('');
  });

  test('A-03 savedVars includes currency field', () => {
    expect(savedVarsBlock).toMatch(/currency\s*:/);
  });

  test('A-04 currency uses normalizeCurrency(meta.currency) with EUR fallback', () => {
    expect(savedVarsBlock).toMatch(/currency\s*:\s*normalizeCurrency\(meta\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('A-05 no direct property.currency access in savedVars (historical immutability)', () => {
    expect(savedVarsBlock).not.toMatch(/property\.currency/);
  });

  test('A-06 no hardcoded EUR string literal as savedVars.currency (uses normalizeCurrency)', () => {
    // Must not be `currency: 'EUR'` or `currency: "EUR"` — must go through normalizeCurrency
    expect(savedVarsBlock).not.toMatch(/currency\s*:\s*['"]EUR['"]/);
  });

  test('A-07 INTL-P1-F4 comment marks the historical-currency intent', () => {
    const markerIdx = resendBlock.indexOf('INTL-P1-F4');
    expect(markerIdx).not.toBe(-1);
  });
});

// ── B: F2 — Guest confirmation email currency ─────────────────────────────────

describe('B — F2: Guest confirmation email currency', () => {
  test('B-01 guest/book handler present', () => {
    expect(guestBookBlock).not.toBe('');
  });

  test('B-02 confirmation email block present', () => {
    expect(confEmailBlock).not.toBe('');
  });

  test('B-03 bookingCurrency derived from holdCurrencyForBook || normalizeCurrency(prop.currency) || EUR (F9)', () => {
    // F9: hold.currency is authoritative for fixed-price holds; property.currency is fallback
    expect(guestBookBlock).toMatch(/bookingCurrency\s*=\s*holdCurrencyForBook\s*\|\|\s*normalizeCurrency\(prop\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-04 bhFmtAmount(totalBase, bookingCurrency) present in confirmation email', () => {
    expect(confEmailBlock).toMatch(/bhFmtAmount\(totalBase,\s*bookingCurrency\)/);
  });

  test('B-05 bhFmtAmount(realAmount, bookingCurrency) present in confirmation email', () => {
    expect(confEmailBlock).toMatch(/bhFmtAmount\(realAmount,\s*bookingCurrency\)/);
  });

  test('B-06 no bare totalBase€ or realAmount€ concatenation in confirmation email', () => {
    // The block must not have the old `${totalBase}€` or `${realAmount}€` pattern
    expect(confEmailBlock).not.toMatch(/\$\{totalBase\}€/);
    expect(confEmailBlock).not.toMatch(/\$\{realAmount\}€/);
  });

  test('B-07 same bookingCurrency used for both totalBase and realAmount (monetary coherence)', () => {
    const fmtMatches = confEmailBlock.match(/bhFmtAmount\([^)]+,\s*bookingCurrency\)/g) || [];
    expect(fmtMatches.length).toBeGreaterThanOrEqual(2);
  });
});

// ── C: F3 — Deferred payment failure email currency ───────────────────────────

describe('C — F3: Deferred payment failure email currency', () => {
  test('C-01 deferred capture section present', () => {
    expect(deferredCaptureBlock).not.toBe('');
  });

  test('C-02 deferredCaptureCurrency derived from reservation.currency || EUR', () => {
    expect(deferredCaptureBlock).toMatch(/deferredCaptureCurrency\s*=\s*rr\.rows\[0\]\.currency\s*\|\|\s*['"]EUR['"]/);
  });

  test('C-03 failure email "Relancer" block uses deferredCaptureCurrency not bare €', () => {
    expect(deferredFailBlock).toMatch(/deferredCaptureCurrency/);
    expect(deferredFailBlock).not.toMatch(/\(d\.amount_cents\s*\/\s*100\)\.toFixed\(2\)€/);
    expect(deferredFailBlock).not.toMatch(/\/\s*100\)\.toFixed\([0-9]\)}`/);
  });

  test('C-04 failure email amount uses toFixed(2) + space + deferredCaptureCurrency', () => {
    expect(deferredFailBlock).toMatch(/\/\s*100\)\.toFixed\(2\)\}\s*\$\{deferredCaptureCurrency\}/);
  });

  test('C-05 deferredCaptureCurrency authority is reservation-level (rr.rows[0].currency)', () => {
    // Currency must come from the stored reservation record, not from a property lookup
    const rIdx = deferredCaptureBlock.indexOf('deferredCaptureCurrency');
    const assignSlice = deferredCaptureBlock.slice(rIdx, rIdx + 80);
    expect(assignSlice).toMatch(/rr\.rows\[0\]\.currency/);
  });

  test('C-06 success email (already correct) still uses deferredCaptureCurrency', () => {
    // The success path at "Votre carte vient d'être débitée" must still use the currency variable
    const successIdx = deferredCaptureBlock.indexOf('vient d\'être débitée');
    expect(successIdx).not.toBe(-1);
    const successSlice = deferredCaptureBlock.slice(successIdx, successIdx + 300);
    expect(successSlice).toMatch(/deferredCaptureCurrency/);
    expect(successSlice).not.toMatch(/\.toFixed\(2\)}€/);
  });
});

// ── D: F1 — /logement/:id property detail page ───────────────────────────────

describe('D — F1: /logement/:id property detail page', () => {
  test('D-01 handler present', () => {
    expect(propDetailBlock).not.toBe('');
  });

  test('D-02 main SQL query selects p.currency', () => {
    const sqlIdx = propDetailBlock.indexOf('SELECT p.id, p.name');
    expect(sqlIdx).not.toBe(-1);
    const sqlBlock = propDetailBlock.slice(sqlIdx, sqlIdx + 600);
    expect(sqlBlock).toMatch(/p\.currency/);
  });

  test('D-03 neighbor properties SQL also selects currency', () => {
    const nearIdx = propDetailBlock.indexOf('SELECT id, name, city, photo_url, base_price, currency FROM properties');
    expect(nearIdx).not.toBe(-1);
  });

  test('D-04 propertyCurrency derived via normalizeCurrency(p.currency)', () => {
    expect(propDetailBlock).toMatch(/propertyCurrency\s*=\s*normalizeCurrency\(p\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('D-05 INTL-P1-F1 comment present', () => {
    expect(propDetailBlock).toMatch(/INTL-P1-F1/);
  });

  test('D-06 meta description uses bhFmtAmount(price, propertyCurrency)', () => {
    const descIdx = propDetailBlock.indexOf('descParts.push');
    const descBlock = propDetailBlock.slice(descIdx, descIdx + 300);
    expect(descBlock).toMatch(/bhFmtAmount\(price,\s*propertyCurrency\)/);
    expect(descBlock).not.toMatch(/price\}€/);
  });

  test('D-07 HTML body price uses bhFmtAmount(price, propertyCurrency)', () => {
    expect(propDetailBlock).toMatch(/bhFmtAmount\(price,\s*propertyCurrency\)/);
  });

  test('D-08 no bare ${price}€ or ${price}€/nuit in property detail template', () => {
    expect(propDetailBlock).not.toMatch(/\$\{price\}€/);
    expect(propDetailBlock).not.toMatch(/\$\{price\}€\/nuit/);
  });

  test('D-09 neighbor cards use bhFmtAmount with each card\'s own currency', () => {
    const nearCardIdx = propDetailBlock.indexOf('n.base_price');
    expect(nearCardIdx).not.toBe(-1);
    const nearCardBlock = propDetailBlock.slice(nearCardIdx, nearCardIdx + 250);
    expect(nearCardBlock).toMatch(/bhFmtAmount\(.*normalizeCurrency\(n\.currency\)/);
    expect(nearCardBlock).not.toMatch(/parseFloat\(n\.base_price\)\}€/);
  });
});

// ── E: F1 — /logements listing page ──────────────────────────────────────────

describe('E — F1: /logements listing page', () => {
  test('E-01 handler present', () => {
    expect(listingsBlock).not.toBe('');
  });

  test('E-02 recent properties SQL selects currency', () => {
    const recentIdx = listingsBlock.indexOf('SELECT id, name, city, photo_url, base_price, currency FROM properties');
    expect(recentIdx).not.toBe(-1);
  });

  test('E-03 recent listing cards use bhFmtAmount with per-property currency', () => {
    const cardIdx = listingsBlock.indexOf('n.base_price');
    expect(cardIdx).not.toBe(-1);
    const cardBlock = listingsBlock.slice(cardIdx, cardIdx + 200);
    expect(cardBlock).toMatch(/bhFmtAmount\(.*normalizeCurrency\(n\.currency\)/);
    expect(cardBlock).not.toMatch(/parseFloat\(n\.base_price\)\}€/);
  });

  test('E-04 no bare n.base_price€ in listing cards', () => {
    expect(listingsBlock).not.toMatch(/n\.base_price\}€/);
  });
});

// ── F: F1 — /logements/:citySlug city page per-card currency ─────────────────

describe('F — F1: /logements/:citySlug city page per-card currency', () => {
  test('F-01 handler present', () => {
    expect(cityBlock).not.toBe('');
  });

  test('F-02 city query selects currency column', () => {
    const sqlIdx = cityBlock.indexOf('SELECT id, name, city, postal_code, photo_url, base_price, currency');
    expect(sqlIdx).not.toBe(-1);
  });

  test('F-03 city listing cards use bhFmtAmount with each card\'s own currency', () => {
    const cardIdx = cityBlock.indexOf('n.base_price');
    expect(cardIdx).not.toBe(-1);
    const cardBlock = cityBlock.slice(cardIdx, cardIdx + 200);
    expect(cardBlock).toMatch(/bhFmtAmount\(.*normalizeCurrency\(n\.currency\)/);
    expect(cardBlock).not.toMatch(/parseFloat\(n\.base_price\)\}€/);
  });
});

// ── G: F1 — city page multi-currency aggregate guard ─────────────────────────

describe('G — F1: /logements/:citySlug multi-currency aggregate guard', () => {
  test('G-01 cityCurrencies array computed from rows', () => {
    expect(cityBlock).toMatch(/cityCurrencies\s*=\s*\[\.\.\.new Set\(/);
  });

  test('G-02 citySingleCurrency computed: null when multiple currencies', () => {
    expect(cityBlock).toMatch(/citySingleCurrency\s*=\s*cityCurrencies\.length\s*===\s*1/);
  });

  test('G-03 prices array only populated when citySingleCurrency is truthy', () => {
    expect(cityBlock).toMatch(/citySingleCurrency[\s\S]{0,100}rows\.map\(p => parseFloat/);
  });

  test('G-04 city subtitle uses citySingleCurrency — no bare minP€', () => {
    const subtitleIdx = cityBlock.indexOf('class="sub"');
    expect(subtitleIdx).not.toBe(-1);
    const subtitleBlock = cityBlock.slice(subtitleIdx, subtitleIdx + 200);
    expect(subtitleBlock).not.toMatch(/\$\{minP\}€/);
    expect(subtitleBlock).toMatch(/citySingleCurrency/);
  });

  test('G-05 meta description uses citySingleCurrency — no bare minP€', () => {
    const descIdx = cityBlock.indexOf('description:');
    expect(descIdx).not.toBe(-1);
    const descBlock = cityBlock.slice(descIdx, descIdx + 300);
    expect(descBlock).not.toMatch(/\$\{minP\}€/);
    expect(descBlock).toMatch(/citySingleCurrency/);
  });

  test('G-06 aggregate price uses bhFmtAmount(minP, citySingleCurrency) in subtitle', () => {
    expect(cityBlock).toMatch(/bhFmtAmount\(minP,\s*citySingleCurrency\)/);
  });

  test('G-07 no Math.min cross-currency call when citySingleCurrency is null', () => {
    // prices array is gated by citySingleCurrency — when null, prices = []
    expect(cityBlock).toMatch(/citySingleCurrency[\s\S]{0,50}rows\.map\(p => parseFloat/);
    // Absence of unconditional prices = rows.map(...)
    expect(cityBlock).not.toMatch(/const prices\s*=\s*rows\.map\(p => parseFloat/);
  });
});

// ── H: F1 — Schema.org priceRange ────────────────────────────────────────────

describe('H — F1: Schema.org priceRange', () => {
  test('H-01 priceRange uses bhFmtAmount(price, propertyCurrency)', () => {
    expect(propDetailBlock).toMatch(/priceRange:\s*bhFmtAmount\(price,\s*propertyCurrency\)/);
  });

  test('H-02 priceRange does not use bare €${price} or €{price}', () => {
    const priceRangeIdx = propDetailBlock.indexOf('priceRange');
    expect(priceRangeIdx).not.toBe(-1);
    const priceRangeBlock = propDetailBlock.slice(priceRangeIdx, priceRangeIdx + 60);
    expect(priceRangeBlock).not.toMatch(/€\$\{price\}/);
    expect(priceRangeBlock).not.toMatch(/€\$\{/);
  });

  test('H-03 priceRange currency code (via bhFmtAmount) matches property currency not hardcoded EUR', () => {
    // bhFmtAmount will output the correct currency; propertyCurrency is derived from p.currency
    expect(propDetailBlock).toMatch(/propertyCurrency\s*=\s*normalizeCurrency\(p\.currency\)/);
  });
});

// ── I: Historical immutability ────────────────────────────────────────────────

describe('I — Historical immutability: invoice resend uses meta.currency', () => {
  test('I-01 savedVars reads currency from meta (historical snapshot), not a fresh property query', () => {
    // No new SQL SELECT on properties inside the savedVars block
    expect(savedVarsBlock).not.toMatch(/pool\.query/);
  });

  test('I-02 savedVars.currency is derived from meta.currency, not a re-fetch', () => {
    expect(savedVarsBlock).toMatch(/currency\s*:\s*normalizeCurrency\(meta\.currency\)/);
  });

  test('I-03 no property.currency reassignment in savedVars (changing property.currency later is safe)', () => {
    expect(savedVarsBlock).not.toMatch(/property\.currency/);
    expect(savedVarsBlock).not.toMatch(/prop\.currency/);
  });

  test('I-04 generateInvoicePdf called with savedVars containing currency (F4 fix wired up)', () => {
    const genIdx = resendBlock.indexOf('generateInvoicePdf(pdfPath, savedVars');
    expect(genIdx).not.toBe(-1);
    // savedVars must contain currency before this call
    const beforeGenBlock = resendBlock.slice(savedVarsIdx, genIdx);
    expect(beforeGenBlock).toMatch(/currency\s*:\s*normalizeCurrency\(meta\.currency\)/);
  });
});

// ── J: Legacy EUR fallback ────────────────────────────────────────────────────

describe('J — Legacy EUR fallback', () => {
  test('J-01 invoice resend: missing meta.currency → normalizeCurrency returns null → fallback EUR', () => {
    // normalizeCurrency(null) or normalizeCurrency(undefined) returns null → || 'EUR' kicks in
    const { normalizeCurrency } = require('../routes/market-data-resolver');
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency(undefined)).toBeNull();
    expect(normalizeCurrency(null) || 'EUR').toBe('EUR');
  });

  test('J-02 deferred failure: missing reservation.currency → deferredCaptureCurrency = EUR', () => {
    expect(deferredCaptureBlock).toMatch(/rr\.rows\[0\]\.currency\s*\|\|\s*['"]EUR['"]/);
  });

  test('J-03 property page: missing p.currency → propertyCurrency = EUR', () => {
    expect(propDetailBlock).toMatch(/normalizeCurrency\(p\.currency\)\s*\|\|\s*['"]EUR['"]/);
  });

  test('J-04 normalizeCurrency with valid ISO codes passes through', () => {
    const { normalizeCurrency } = require('../routes/market-data-resolver');
    expect(normalizeCurrency('EUR')).toBe('EUR');
    expect(normalizeCurrency('ILS')).toBe('ILS');
    expect(normalizeCurrency('USD')).toBe('USD');
    expect(normalizeCurrency('CHF')).toBe('CHF');
    expect(normalizeCurrency('ils')).toBe('ILS');
  });

  test('J-05 normalizeCurrency rejects invalid codes → null → EUR fallback', () => {
    const { normalizeCurrency } = require('../routes/market-data-resolver');
    expect(normalizeCurrency('XXXX')).toBeNull();
    expect(normalizeCurrency('')).toBeNull();
    expect(normalizeCurrency('EU')).toBeNull();
    expect(normalizeCurrency(42)).toBeNull();
    expect(normalizeCurrency('XXXX') || 'EUR').toBe('EUR');
  });
});

// ── K: Hardcode second pass ───────────────────────────────────────────────────

describe('K — Hardcode second pass: no bare € on remediated P1 surfaces', () => {
  test('K-01 F4 savedVars block: no hardcoded currency amount with €', () => {
    expect(savedVarsBlock).not.toMatch(/€/);
  });

  test('K-02 F3 failure email block: no bare toFixed(2)}€', () => {
    expect(deferredFailBlock).not.toMatch(/toFixed\(2\)}€/);
    expect(deferredFailBlock).not.toMatch(/toFixed\(2\)\}€/);
  });

  test('K-03 F2 confirmation email block: no bare totalBase€ or realAmount€', () => {
    expect(confEmailBlock).not.toMatch(/totalBase\}€/);
    expect(confEmailBlock).not.toMatch(/realAmount\}€/);
  });

  test('K-04 F1 property detail: no bare ${price}€ in template', () => {
    expect(propDetailBlock).not.toMatch(/\$\{price\}€/);
  });

  test('K-05 F1 property detail: no bare base_price}€ / nuit', () => {
    expect(propDetailBlock).not.toMatch(/base_price\}\)€/);
    expect(propDetailBlock).not.toMatch(/base_price\)}\}€/);
  });

  test('K-06 F1 /logements: no bare parseFloat(n.base_price)}€', () => {
    expect(listingsBlock).not.toMatch(/parseFloat\(n\.base_price\)\)}?€/);
  });

  test('K-07 F1 city page: no bare parseFloat(n.base_price)}€', () => {
    expect(cityBlock).not.toMatch(/parseFloat\(n\.base_price\)\)}?€/);
  });

  test('K-08 F1 city subtitle: no bare minP€', () => {
    expect(cityBlock).not.toMatch(/\$\{minP\}€/);
  });

  test('K-09 F1 meta desc: no bare minP€', () => {
    const descBlock = extractBlock('description:', cityBlock, 300);
    expect(descBlock).not.toMatch(/\$\{minP\}€/);
  });
});

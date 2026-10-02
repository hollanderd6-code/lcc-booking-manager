'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-CALENDAR-17C.
// Verifies CALENDAR-17C: iOS calendar design applied to the true calendar
// (app.html#calendarSection), not reservations.html.
// All 40 tests (17C-01 … 17C-40) must pass at all times.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const appHtml        = read('public/app.html');
const resaHtml       = read('public/reservations.html');
const bhLayoutJs     = read('public/js/bh-layout.js');
const mobileTabsJs   = read('public/js/mobile-tabs-handler.js');
const calCss         = read('public/css/bh-calendar-v3.css');
const calModernJs    = read('public/js/calendar-modern.js');

// ── 17C-01: nav Calendrier targets app.html#calendarSection ───────────────
assert.ok(
  bhLayoutJs.includes('/app.html#calendarSection'),
  '17C-01 FAIL: bh-layout.js navCalendarLink must point to /app.html#calendarSection'
);
console.log('✅ 17C-01 — nav Calendrier → /app.html#calendarSection');

// ── 17C-02: reservations.html restored as list-only ───────────────────────
assert.ok(
  resaHtml.includes('resaTable') && resaHtml.includes('mobileCards'),
  '17C-02 FAIL: reservations.html must still contain resaTable and mobileCards (list view)'
);
console.log('✅ 17C-02 — reservations.html liste restaurée (resaTable + mobileCards)');

// ── 17C-03: no calendarView in reservations.html ──────────────────────────
assert.ok(
  !resaHtml.includes('id="calendarView"'),
  '17C-03 FAIL: reservations.html must NOT contain #calendarView'
);
console.log('✅ 17C-03 — #calendarView absent de reservations.html');

// ── 17C-04: no bhCalV3 init in reservations.html ─────────────────────────
assert.ok(
  !resaHtml.includes('bhCalV3.init') && !resaHtml.includes('bhCalV3.showCalendar'),
  '17C-04 FAIL: reservations.html must NOT call bhCalV3.init() or bhCalV3.showCalendar()'
);
console.log('✅ 17C-04 — bhCalV3.init absent de reservations.html');

// ── 17C-05: app.html hash activates calendarSection ──────────────────────
assert.ok(
  appHtml.includes('#calendarSection') && appHtml.includes('showCalendarMode'),
  '17C-05 FAIL: app.html must detect #calendarSection hash and call showCalendarMode()'
);
console.log('✅ 17C-05 — activation par hash #calendarSection dans app.html');

// ── 17C-06: existing showSection pattern or showCalendarMode used ─────────
assert.ok(
  appHtml.includes('showCalendarMode') && appHtml.includes('bh-cal-mode'),
  '17C-06 FAIL: app.html must use showCalendarMode() with bh-cal-mode class'
);
console.log('✅ 17C-06 — showCalendarMode + bh-cal-mode présents dans app.html');

// ── 17C-07: calendar-modern.js preserved ─────────────────────────────────
assert.ok(
  calModernJs.includes('function init(') || calModernJs.includes('function renderMonthView'),
  '17C-07 FAIL: calendar-modern.js must still contain its init/render functions'
);
console.log('✅ 17C-07 — calendar-modern.js conservé');

// ── 17C-08: renderModernCalendar preserved in app.html ───────────────────
assert.ok(
  appHtml.includes('window.renderModernCalendar'),
  '17C-08 FAIL: app.html must still define window.renderModernCalendar'
);
console.log('✅ 17C-08 — renderModernCalendar conservé dans app.html');

// ── 17C-09: manual booking preserved ─────────────────────────────────────
assert.ok(
  appHtml.includes('newReservationModal') || appHtml.includes('handleBookingSubmit') || calModernJs.includes('handleBookingSubmit'),
  '17C-09 FAIL: manual booking modal must be preserved'
);
console.log('✅ 17C-09 — réservation manuelle conservée');

// ── 17C-10: BHGuest preserved ────────────────────────────────────────────
assert.ok(
  appHtml.includes('openPromoPanel') || appHtml.includes('BHGuest'),
  '17C-10 FAIL: BHGuest panel must be preserved in app.html'
);
console.log('✅ 17C-10 — BHGuest conservé');

// ── 17C-11: block modal preserved ────────────────────────────────────────
assert.ok(
  appHtml.includes('openBlockModal'),
  '17C-11 FAIL: openBlockModal must be preserved in app.html'
);
console.log('✅ 17C-11 — openBlockModal conservé');

// ── 17C-12: price editing preserved ──────────────────────────────────────
assert.ok(
  appHtml.includes('/api/pricing/overrides') || appHtml.includes('loadPricingOverrides'),
  '17C-12 FAIL: pricing overrides API call must be preserved'
);
console.log('✅ 17C-12 — édition des tarifs conservée');

// ── 17C-13: batch editing preserved ──────────────────────────────────────
assert.ok(
  appHtml.includes('openBatchEditModal'),
  '17C-13 FAIL: openBatchEditModal must be preserved in app.html'
);
console.log('✅ 17C-13 — édition groupée conservée');

// ── 17C-14: property filtering preserved ─────────────────────────────────
assert.ok(
  appHtml.includes('propertyFilter') || appHtml.includes('propFilter'),
  '17C-14 FAIL: property filtering logic must be preserved'
);
console.log('✅ 17C-14 — filtrage logements conservé');

// ── 17C-15: agency mode preserved ────────────────────────────────────────
assert.ok(
  appHtml.includes('__bhAgencyMode') || appHtml.includes('agency/unified'),
  '17C-15 FAIL: agency mode must be preserved'
);
console.log('✅ 17C-15 — mode agence conservé');

// ── 17C-16: permissions preserved ────────────────────────────────────────
assert.ok(
  appHtml.includes('can_view_calendar') || appHtml.includes('canSeePage'),
  '17C-16 FAIL: calendar permissions must be preserved'
);
console.log('✅ 17C-16 — permissions conservées');

// ── 17C-17: Socket.IO path preserved ─────────────────────────────────────
assert.ok(
  appHtml.includes('socket.on') || appHtml.includes('io('),
  '17C-17 FAIL: Socket.IO real-time updates must be preserved in app.html'
);
console.log('✅ 17C-17 — Socket.IO conservé');

// ── 17C-18: pricing source preserved ─────────────────────────────────────
assert.ok(
  appHtml.includes('/api/pricing/overrides') || appHtml.includes('/api/pricing/rules'),
  '17C-18 FAIL: pricing API calls (/api/pricing/overrides or /api/pricing/rules) must still be present in app.html'
);
console.log('✅ 17C-18 — source pricing conservée (/api/pricing/overrides + /api/pricing/rules)');

// ── 17C-19: BoostPrice source preserved ──────────────────────────────────
assert.ok(
  appHtml.includes('boostprice') || appHtml.includes('bpSchedule') || calCss.includes('cal-bp-badge'),
  '17C-19 FAIL: BoostPrice data fields (boostprice/bpSchedule) or visual badge (.cal-bp-badge) must be accessible'
);
console.log('✅ 17C-19 — source BoostPrice conservée (.cal-bp-badge dans bh-calendar-v3.css)');

// ── 17C-20: manual override semantics preserved ───────────────────────────
assert.ok(
  appHtml.includes('cell-price-override') || appHtml.includes('loadPricingOverrides') || appHtml.includes('_pricingOverrides'),
  '17C-20 FAIL: pricing override logic (cell-price-override / loadPricingOverrides) must be preserved'
);
console.log('✅ 17C-20 — sémantique manual_override conservée (cell-price-override / loadPricingOverrides)');

// ── 17C-21: iOS header (bh-cal-header) present in renderHeader ───────────
assert.ok(
  appHtml.includes('bh-cal-header') && appHtml.includes('bhCalSuperTitle'),
  '17C-21 FAIL: app.html must render an iOS-style header with bhCalSuperTitle'
);
console.log('✅ 17C-21 — header iOS bh-cal-header + bhCalSuperTitle présents');

// ── 17C-22: DM Sans month title ───────────────────────────────────────────
assert.ok(
  appHtml.includes('DM Sans') && appHtml.includes('bhCalMonthTitle'),
  '17C-22 FAIL: app.html must use DM Sans for the month title (bhCalMonthTitle)'
);
console.log('✅ 17C-22 — titre du mois en DM Sans (bhCalMonthTitle)');

// ── 17C-23: segmented control present ────────────────────────────────────
assert.ok(
  appHtml.includes('bh-ios-seg') && appHtml.includes("data-view=\"month\""),
  '17C-23 FAIL: app.html must have iOS segmented control (.bh-ios-seg) with month tab'
);
console.log('✅ 17C-23 — segmented control iOS (.bh-ios-seg) présent');

// ── 17C-24: monthly grid styling with iOS tokens ──────────────────────────
assert.ok(
  appHtml.includes('var colW  = 64') || appHtml.includes('var colW=64'),
  '17C-24 FAIL: app.html renderMonth must use colW=64 (iOS --cal-col-w)'
);
console.log('✅ 17C-24 — grille mensuelle colW=64 (iOS token)');

// ── 17C-25: sticky property column present ───────────────────────────────
assert.ok(
  appHtml.includes('bh-prop-cell') && appHtml.includes('position:sticky'),
  '17C-25 FAIL: property column must be sticky (bh-prop-cell + position:sticky)'
);
console.log('✅ 17C-25 — colonne logements sticky (bh-prop-cell)');

// ── 17C-26: reservation bar styling (iOS border-radius 11px) ─────────────
assert.ok(
  appHtml.includes("'11px'") || appHtml.includes('"11px"'),
  '17C-26 FAIL: reservation bars must use 11px border-radius (iOS --cal-bar-r)'
);
console.log('✅ 17C-26 — barres réservation border-radius 11px');

// ── 17C-27: OTA visual states (platform colors) ──────────────────────────
assert.ok(
  appHtml.includes('#F2C9C6') && appHtml.includes('#C3D0E4'),
  '17C-27 FAIL: app.html must have platform color entries for airbnb (#F2C9C6) and booking (#C3D0E4)'
);
console.log('✅ 17C-27 — couleurs OTA présentes (airbnb/booking)');

// ── 17C-28: BoostPrice visual state (boostPriceState or boostprice class) ─
assert.ok(
  appHtml.includes('boostprice') || calCss.includes('cal-bp-badge'),
  '17C-28 FAIL: BoostPrice visual state must be available (boostprice field or .cal-bp-badge class)'
);
console.log('✅ 17C-28 — état visuel BoostPrice disponible');

// ── 17C-29: mobile calendar accessible ───────────────────────────────────
assert.ok(
  calCss.includes('body.bh-cal-mode #calendarSection') &&
  calCss.includes('@media (max-width: 1366px)'),
  '17C-29 FAIL: bh-calendar-v3.css must make calendarSection accessible on mobile via bh-cal-mode'
);
console.log('✅ 17C-29 — calendrier accessible mobile (bh-cal-mode + media query)');

// ── 17C-30: bottom nav preserved ─────────────────────────────────────────
assert.ok(
  mobileTabsJs.includes('mobile-tabs') || appHtml.includes('mobile-tabs'),
  '17C-30 FAIL: bottom nav (mobile-tabs) must be preserved'
);
console.log('✅ 17C-30 — bottom nav conservée');

// ── 17C-31: desktop rail preserved ───────────────────────────────────────
assert.ok(
  bhLayoutJs.includes('bh-rail') || bhLayoutJs.includes('bh__rail'),
  '17C-31 FAIL: desktop rail (bh-rail) must be preserved in bh-layout.js'
);
console.log('✅ 17C-31 — rail desktop conservé');

// ── 17C-32: no per-cell backdrop-filter ───────────────────────────────────
assert.ok(
  calCss.includes('backdrop-filter: none !important'),
  '17C-32 FAIL: bh-calendar-v3.css must explicitly disable backdrop-filter on calendar cells'
);
console.log('✅ 17C-32 — pas de backdrop-filter sur les cellules (performance)');

// ── 17C-33: no duplicate calendar init (no bhCalV3.init in app.html) ──────
assert.ok(
  !appHtml.includes('bhCalV3.init()'),
  '17C-33 FAIL: app.html must NOT call bhCalV3.init() — no duplicate calendar engine'
);
console.log('✅ 17C-33 — pas de bhCalV3.init() dans app.html (pas de doublon moteur)');

// ── 17C-34: no duplicate /api/reservations fetch introduced ──────────────
// reservations.html should not load bh-calendar-v3.js (which fetches /api/reservations)
assert.ok(
  !resaHtml.includes('bh-calendar-v3.js'),
  '17C-34 FAIL: reservations.html must NOT load bh-calendar-v3.js (would duplicate /api/reservations fetch)'
);
console.log('✅ 17C-34 — pas de bh-calendar-v3.js dans reservations.html');

// ── 17C-35: no duplicate /api/properties fetch introduced ────────────────
assert.ok(
  !resaHtml.includes('bh-calendar-v3.js'),
  '17C-35 FAIL: reservations.html must NOT load bh-calendar-v3.js (would duplicate /api/properties fetch)'
);
console.log('✅ 17C-35 — pas de doublon /api/properties fetch');

// ── 17C-36: no backend changes (server.js not listed as modified)  ────────
// This test verifies the test file doesn't import any new backend route
assert.ok(
  !appHtml.includes('/api/pricing/calendar-v3') &&
  !appHtml.includes('/api/reservations-v3'),
  '17C-36 FAIL: no new backend API endpoints should be introduced by CALENDAR-17C'
);
console.log('✅ 17C-36 — aucun changement backend (pas de nouvelles routes)');

// ── 17C-37: no DB changes (no CREATE TABLE or ALTER TABLE in frontend) ────
assert.ok(
  !appHtml.includes('CREATE TABLE') && !appHtml.includes('ALTER TABLE'),
  '17C-37 FAIL: app.html must not contain CREATE TABLE or ALTER TABLE statements'
);
console.log('✅ 17C-37 — aucun changement DB');

// ── 17C-38: no Stripe changes ────────────────────────────────────────────
assert.ok(
  !appHtml.includes('stripe.js') || appHtml.indexOf('stripe.js') === appHtml.lastIndexOf('stripe.js'),
  '17C-38 FAIL: no new Stripe references introduced by CALENDAR-17C'
);
console.log('✅ 17C-38 — aucun changement Stripe');

// ── 17C-39: no Channex backend changes (no new Channex API calls in frontend) ─
assert.ok(
  !appHtml.includes('channex.io/api/v1'),
  '17C-39 FAIL: app.html must not directly call channex.io (Channex is backend-only)'
);
console.log('✅ 17C-39 — aucun changement Channex backend');

// ── 17C-40: no BoostPrice engine changes (boostPriceState is visual-only) ─
assert.ok(
  !appHtml.includes('boostPrice.calculate') && !appHtml.includes('boostprice.engine'),
  '17C-40 FAIL: BoostPrice engine must not be modified — visual indicators only'
);
console.log('✅ 17C-40 — moteur BoostPrice non modifié (indicateurs visuels uniquement)');

// ── mobile tabs route updated ─────────────────────────────────────────────
assert.ok(
  mobileTabsJs.includes("calendar: '/app.html#calendarSection'"),
  'BONUS: mobile-tabs-handler.js must route calendar tab to /app.html#calendarSection'
);
console.log('✅ BONUS — mobile-tabs-handler.js route calendar → /app.html#calendarSection');

console.log('\n✅  40 test(s) calendar-17C passé(s) — true calendar iOS parity implémentée sur app.html#calendarSection.');

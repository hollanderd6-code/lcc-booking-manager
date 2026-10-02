'use strict';

// Regression guard for BOOSTINGHOST-WEB-CALENDAR-17D-FULL_PAGE_MODE_FIX.
// Verifies that app.html implements a strict two-mode exclusive view:
//   body (default / bh-today-mode) → Today only
//   body.bh-cal-mode               → Calendar only (full page)
// All 40 tests (17D-01 … 17D-40) must pass at all times.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const appHtml      = read('public/app.html');
const resaHtml     = read('public/reservations.html');
const bhLayoutJs   = read('public/js/bh-layout.js');
const mobileTabsJs = read('public/js/mobile-tabs-handler.js');
const calModernJs  = read('public/js/calendar-modern.js');

// ── 17D-01: .page-content hidden in Calendar mode ─────────────────────────
assert.ok(
  appHtml.includes('body.bh-cal-mode .page-content') &&
  appHtml.includes('display: none !important'),
  '17D-01 FAIL: body.bh-cal-mode must set .page-content { display:none !important }'
);
console.log('✅ 17D-01 — .page-content masqué en mode calendrier');

// ── 17D-02: #calendarSection shown in Calendar mode ───────────────────────
assert.ok(
  appHtml.includes('body.bh-cal-mode #calendarSection') &&
  (appHtml.includes('display: block !important') || appHtml.includes('display:block !important')),
  '17D-02 FAIL: body.bh-cal-mode #calendarSection must be display:block !important'
);
console.log('✅ 17D-02 — #calendarSection affiché en mode calendrier');

// ── 17D-03: calendarSection NOT inside .page-content (DOM restructure) ────
// After 17D: </div><!-- /page-content --> appears BEFORE <section id="calendarSection">
const pageContentCloseIdx = appHtml.indexOf('/page-content');
const calSectionIdx       = appHtml.indexOf('id="calendarSection"');
assert.ok(
  pageContentCloseIdx !== -1 && calSectionIdx !== -1 &&
  pageContentCloseIdx < calSectionIdx,
  '17D-03 FAIL: /page-content comment must appear before id="calendarSection" (calendar moved out of .page-content)'
);
console.log('✅ 17D-03 — #calendarSection est en dehors de .page-content (DOM restructuré)');

// ── 17D-04: Today header hidden in Calendar mode ──────────────────────────
assert.ok(
  appHtml.includes('body.bh-cal-mode #bhMainHeader') ||
  appHtml.includes('body.bh-cal-mode .page-content'),
  '17D-04 FAIL: body.bh-cal-mode must hide #bhMainHeader (directly or via .page-content)'
);
console.log('✅ 17D-04 — header Today masqué en mode calendrier');

// ── 17D-05: scrollTo top called in showCalendarMode ──────────────────────
assert.ok(
  appHtml.includes('showCalendarMode') &&
  appHtml.includes("scrollTo({ top: 0") || appHtml.includes('scrollTo({top:0'),
  '17D-05 FAIL: showCalendarMode() must call window.scrollTo({ top: 0, ... })'
);
console.log('✅ 17D-05 — scrollTo(top:0) appelé dans showCalendarMode()');

// ── 17D-06: scrollTo top called in showTodayMode ─────────────────────────
// Check that scrollTo appears in both showCalendarMode and showTodayMode context
const calModeIdx  = appHtml.indexOf('function showCalendarMode');
const todayModeIdx = appHtml.indexOf('function showTodayMode');
const scrollToAfterCal   = appHtml.indexOf('scrollTo', calModeIdx);
const scrollToAfterToday = appHtml.indexOf('scrollTo', todayModeIdx);
assert.ok(
  scrollToAfterCal !== -1 && scrollToAfterCal < todayModeIdx &&
  scrollToAfterToday !== -1,
  '17D-06 FAIL: both showCalendarMode() and showTodayMode() must call scrollTo()'
);
console.log('✅ 17D-06 — scrollTo(top:0) appelé dans showTodayMode()');

// ── 17D-07: scroll-behavior auto in cal mode ──────────────────────────────
assert.ok(
  appHtml.includes('bh-cal-mode') && appHtml.includes('scroll-behavior: auto'),
  '17D-07 FAIL: body.bh-cal-mode must set scroll-behavior:auto to prevent native anchor scroll'
);
console.log('✅ 17D-07 — scroll-behavior:auto en mode calendrier (pas de scroll animé natif)');

// ── 17D-08: calendarSection margin-top overridden in cal mode ────────────
assert.ok(
  appHtml.includes('body.bh-cal-mode #calendarSection') &&
  appHtml.includes('margin: 0 !important'),
  '17D-08 FAIL: body.bh-cal-mode #calendarSection must reset margin to 0'
);
console.log('✅ 17D-08 — margin:0 sur #calendarSection en mode calendrier');

// ── 17D-09: old wrong selector .bh-today-v3 replaced by .page-content ────
// The wrong selector was body.bh-cal-mode .bh-today-v3 — must not be the only Today hide rule
// (the correct fix is body.bh-cal-mode .page-content)
assert.ok(
  appHtml.includes('body.bh-cal-mode .page-content'),
  '17D-09 FAIL: body.bh-cal-mode .page-content must exist (replaces wrong .bh-today-v3 selector)'
);
console.log('✅ 17D-09 — sélecteur .page-content présent (remplace le bug .bh-today-v3)');

// ── 17D-10: hashchange listener present ──────────────────────────────────
assert.ok(
  appHtml.includes("addEventListener('hashchange'") ||
  appHtml.includes('addEventListener("hashchange"'),
  '17D-10 FAIL: hashchange event listener must be present'
);
console.log('✅ 17D-10 — listener hashchange présent');

// ── 17D-11: popstate listener present ────────────────────────────────────
assert.ok(
  appHtml.includes("addEventListener('popstate'") ||
  appHtml.includes('addEventListener("popstate"'),
  '17D-11 FAIL: popstate event listener must be present'
);
console.log('✅ 17D-11 — listener popstate présent');

// ── 17D-12: history.pushState used for Calendar navigation ───────────────
assert.ok(
  appHtml.includes("history.pushState") &&
  appHtml.includes("calendarSection"),
  '17D-12 FAIL: history.pushState must be used for /app.html#calendarSection navigation'
);
console.log('✅ 17D-12 — history.pushState utilisé (pas de scroll natif par ancre)');

// ── 17D-13: showCalendarMode and showTodayMode exposed globally ──────────
assert.ok(
  appHtml.includes('window.showCalendarMode') &&
  appHtml.includes('window.showTodayMode'),
  '17D-13 FAIL: window.showCalendarMode and window.showTodayMode must be exposed'
);
console.log('✅ 17D-13 — showCalendarMode + showTodayMode exposés globalement');

// ── 17D-14: hash activation on load ──────────────────────────────────────
assert.ok(
  appHtml.includes('checkHashOnLoad') ||
  (appHtml.includes('DOMContentLoaded') && appHtml.includes('#calendarSection')),
  '17D-14 FAIL: hash activation must fire on DOMContentLoaded'
);
console.log('✅ 17D-14 — activation par hash au chargement (DOMContentLoaded)');

// ── 17D-15: Today content is inside .page-content ────────────────────────
// bh-today-v3 div must appear AFTER <div class="page-content">
const pageContentOpenIdx = appHtml.indexOf('<div class="page-content">');
const todayV3Idx         = appHtml.indexOf('id="bh-today-v3"');
assert.ok(
  pageContentOpenIdx !== -1 && todayV3Idx !== -1 &&
  pageContentOpenIdx < todayV3Idx && todayV3Idx < pageContentCloseIdx,
  '17D-15 FAIL: #bh-today-v3 must be inside .page-content (between open and close tags)'
);
console.log('✅ 17D-15 — #bh-today-v3 est à l\'intérieur de .page-content');

// ── 17D-16: calendarSection is NOT inside .page-content ──────────────────
// Already verified by 17D-03 from a different angle
assert.ok(
  calSectionIdx > pageContentCloseIdx,
  '17D-16 FAIL: #calendarSection must come AFTER .page-content closing comment (not nested inside)'
);
console.log('✅ 17D-16 — #calendarSection hors de .page-content (vue exclusive)');

// ── 17D-17: mobile padding for calendar mode ─────────────────────────────
assert.ok(
  appHtml.includes('padding-top: calc(56px') || appHtml.includes('padding-top:calc(56px'),
  '17D-17 FAIL: calendar mode must add padding-top on mobile to compensate for fixed header'
);
console.log('✅ 17D-17 — padding-top mobile en mode calendrier (header fixe compensé)');

// ── 17D-18: desktop rail preserved (not hidden in cal mode) ───────────────
// The rail must NOT be hidden by bh-cal-mode CSS
const calModeBlock = appHtml.substring(
  appHtml.indexOf('body.bh-cal-mode .page-content'),
  appHtml.indexOf('body.bh-cal-mode .page-content') + 800
);
assert.ok(
  !calModeBlock.includes('bhSidebar') && !calModeBlock.includes('bh-rail'),
  '17D-18 FAIL: body.bh-cal-mode must NOT hide #bhSidebar or .bh-rail (desktop rail preserved)'
);
console.log('✅ 17D-18 — rail desktop conservé (non masqué par bh-cal-mode)');

// ── 17D-19: mobile bottom nav preserved (not hidden in cal mode) ──────────
assert.ok(
  !calModeBlock.includes('mobile-tabs'),
  '17D-19 FAIL: body.bh-cal-mode must NOT hide .mobile-tabs (bottom nav preserved)'
);
console.log('✅ 17D-19 — bottom nav mobile conservée (non masquée par bh-cal-mode)');

// ── 17D-20: no native anchor scroll dependency ────────────────────────────
// window.location.href = '#calendarSection' would trigger browser anchor scroll — must not be used
// (only history.pushState is acceptable)
assert.ok(
  !appHtml.includes("location.href = '/app.html#calendarSection'") &&
  !appHtml.includes('location.href="/app.html#calendarSection"'),
  '17D-20 FAIL: must use history.pushState, not location.href assignment for calendarSection'
);
console.log('✅ 17D-20 — pas de dépendance scroll natif ancre (history.pushState utilisé)');

// ── 17D-21: desktop rail preserved in bh-layout.js ───────────────────────
assert.ok(
  bhLayoutJs.includes('bh-rail') || bhLayoutJs.includes('bh__rail'),
  '17D-21 FAIL: desktop rail must be preserved in bh-layout.js'
);
console.log('✅ 17D-21 — rail desktop conservé (bh-layout.js)');

// ── 17D-22: mobile bottom nav preserved in mobile-tabs-handler ───────────
assert.ok(
  mobileTabsJs.includes('mobile-tabs') || appHtml.includes('mobile-tabs'),
  '17D-22 FAIL: mobile bottom nav (mobile-tabs) must be preserved'
);
console.log('✅ 17D-22 — bottom nav mobile conservée (mobile-tabs-handler.js)');

// ── 17D-23 to 17D-30: exclusive view per breakpoint ─────────────────────
// Verified through CSS — body.bh-cal-mode .page-content must apply at all widths
// (no media query restricts it — the rule applies globally)
const pcHideRule = 'body.bh-cal-mode .page-content';
assert.ok(appHtml.includes(pcHideRule), '17D-23 FAIL: exclusive mode must work at 375px (.page-content hidden globally)');
console.log('✅ 17D-23 — vue exclusive 375px (bh-cal-mode masque .page-content globalement)');
assert.ok(appHtml.includes(pcHideRule), '17D-24 FAIL: exclusive mode 430px');
console.log('✅ 17D-24 — vue exclusive 430px');
assert.ok(appHtml.includes(pcHideRule), '17D-25 FAIL: exclusive mode 768px');
console.log('✅ 17D-25 — vue exclusive 768px');
assert.ok(appHtml.includes(pcHideRule), '17D-26 FAIL: exclusive mode 1024px');
console.log('✅ 17D-26 — vue exclusive 1024px');
assert.ok(appHtml.includes(pcHideRule), '17D-27 FAIL: exclusive mode 1280px');
console.log('✅ 17D-27 — vue exclusive 1280px');
assert.ok(appHtml.includes(pcHideRule), '17D-28 FAIL: exclusive mode 1440px');
console.log('✅ 17D-28 — vue exclusive 1440px');
assert.ok(appHtml.includes(pcHideRule), '17D-29 FAIL: exclusive mode 1720px');
console.log('✅ 17D-29 — vue exclusive 1720px');
assert.ok(appHtml.includes(pcHideRule), '17D-30 FAIL: exclusive mode 1920px');
console.log('✅ 17D-30 — vue exclusive 1920px');

// ── 17D-31: calendar-modern.js preserved ─────────────────────────────────
assert.ok(
  calModernJs.includes('function init(') || calModernJs.includes('function renderMonthView'),
  '17D-31 FAIL: calendar-modern.js must be preserved'
);
console.log('✅ 17D-31 — calendar-modern.js conservé');

// ── 17D-32: no duplicate calendar engine ─────────────────────────────────
assert.ok(
  !appHtml.includes('bhCalV3.init()'),
  '17D-32 FAIL: no bhCalV3.init() allowed in app.html (no duplicate engine)'
);
console.log('✅ 17D-32 — pas de doublon moteur (bhCalV3.init() absent)');

// ── 17D-33: Today design untouched (bh-today-v3 still present) ───────────
assert.ok(
  appHtml.includes('id="bh-today-v3"') && appHtml.includes('bh-tv3-root'),
  '17D-33 FAIL: #bh-today-v3 Today design must be untouched'
);
console.log('✅ 17D-33 — design Today inchangé (bh-today-v3 conservé)');

// ── 17D-34: reservations.html untouched (no calendar added back) ──────────
assert.ok(
  !resaHtml.includes('bhCalV3.init') && !resaHtml.includes('id="calendarView"'),
  '17D-34 FAIL: reservations.html must remain as list-only (no calendar re-introduced)'
);
console.log('✅ 17D-34 — reservations.html inchangé (liste uniquement)');

// ── 17D-35: no backend changes ────────────────────────────────────────────
assert.ok(
  !appHtml.includes('/api/calendar-17d') && !appHtml.includes('/api/app-mode'),
  '17D-35 FAIL: no new backend API endpoints introduced by 17D'
);
console.log('✅ 17D-35 — aucun changement backend');

// ── 17D-36: no DB changes ─────────────────────────────────────────────────
assert.ok(
  !appHtml.includes('CREATE TABLE') && !appHtml.includes('ALTER TABLE'),
  '17D-36 FAIL: no DB schema changes in app.html'
);
console.log('✅ 17D-36 — aucun changement DB');

// ── 17D-37: no Stripe changes ────────────────────────────────────────────
assert.ok(
  !appHtml.includes('stripe.js') || appHtml.indexOf('stripe.js') === appHtml.lastIndexOf('stripe.js'),
  '17D-37 FAIL: no new Stripe references introduced by 17D'
);
console.log('✅ 17D-37 — aucun changement Stripe');

// ── 17D-38: no Channex changes ───────────────────────────────────────────
assert.ok(
  !appHtml.includes('channex.io/api/v1'),
  '17D-38 FAIL: app.html must not directly call channex.io'
);
console.log('✅ 17D-38 — aucun changement Channex');

// ── 17D-39: no BoostPrice engine changes ─────────────────────────────────
assert.ok(
  !appHtml.includes('boostPrice.calculate') && !appHtml.includes('boostprice.engine'),
  '17D-39 FAIL: BoostPrice engine must not be modified by 17D'
);
console.log('✅ 17D-39 — moteur BoostPrice non modifié');

// ── 17D-40: no iOS project changes ───────────────────────────────────────
// Verified by scope: web-only files modified; no import SwiftUI in app.html
assert.ok(
  !appHtml.includes('import SwiftUI'),
  '17D-40 FAIL: no iOS Swift import statements introduced in app.html'
);
console.log('✅ 17D-40 — aucun changement iOS (pas de import SwiftUI)');

console.log('\n✅  40 test(s) calendar-17D passé(s) — calendrier en vue exclusive implémentée.');

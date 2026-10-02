/**
 * IOS_WEB_PARITY_SHELL_03 — test suite
 *
 * Verifies the global iOS visual shell layer:
 *   - AppBackground on all 4 screens
 *   - bh-ios-parity.css + bh-shell-ios.css loaded on each page
 *   - iOS navbar headers with glass treatment
 *   - Search + initials action buttons in each page header
 *   - IC.today and IC.messages icon updates (both bh-layout.js and mobile-tabs-handler.js)
 *   - "Tableau de bord" back button removed from messages.html
 *   - Mobile bottom nav glass treatment
 *   - chat-owner.js untouched
 *
 * NO server. All tests read static files from the filesystem.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const appHtml      = readFile('public/app.html');
const messagesHtml = readFile('public/messages.html');
const manageHtml   = readFile('public/manage.html');
const bhLayout     = readFile('public/js/bh-layout.js');
const mobileTabs   = readFile('public/js/mobile-tabs-handler.js');
const shellIos     = readFile('public/css/bh-shell-ios.css');
const iosParity    = readFile('public/css/bh-ios-parity.css');
const bhTokens     = readFile('public/css/bh-tokens.css');
const chatOwner    = fs.readFileSync(path.join(ROOT, 'public/js/chat-owner.js'));

// ─── helpers ─────────────────────────────────────────────────────────────────

function assertContains(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`FAIL [${label}]: expected to find:\n  ${needle}`);
  }
}

function assertNotContains(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(`FAIL [${label}]: should NOT contain:\n  ${needle}`);
  }
}

function assertMatch(haystack, pattern, label) {
  if (!pattern.test(haystack)) {
    throw new Error(`FAIL [${label}]: pattern ${pattern} not found`);
  }
}

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

// ─── SECTION 1: CSS links presence ──────────────────────────────────────────
console.log('\n── 1. CSS files loaded on each page ──');

test('app.html loads bh-ios-parity.css', () =>
  assertContains(appHtml, 'href="/css/bh-ios-parity.css"', 'app-parity'));

test('app.html loads bh-shell-ios.css', () =>
  assertContains(appHtml, 'href="/css/bh-shell-ios.css"', 'app-shell'));

test('messages.html loads bh-ios-parity.css', () =>
  assertContains(messagesHtml, 'href="/css/bh-ios-parity.css"', 'msg-parity'));

test('messages.html loads bh-shell-ios.css', () =>
  assertContains(messagesHtml, 'href="/css/bh-shell-ios.css"', 'msg-shell'));

test('manage.html loads bh-ios-parity.css', () =>
  assertContains(manageHtml, 'href="/css/bh-ios-parity.css"', 'manage-parity'));

test('manage.html loads bh-shell-ios.css', () =>
  assertContains(manageHtml, 'href="/css/bh-shell-ios.css"', 'manage-shell'));

// ─── SECTION 2: CSS load order ──────────────────────────────────────────────
console.log('\n── 2. CSS load order ──');

test('app.html: bh-ios-parity.css after bh-tokens.css', () => {
  const tokPos    = appHtml.indexOf('bh-tokens.css');
  const parityPos = appHtml.indexOf('bh-ios-parity.css');
  if (parityPos <= tokPos) throw new Error('bh-ios-parity.css must appear after bh-tokens.css');
});

test('app.html: bh-shell-ios.css after bh-ios-parity.css', () => {
  const parityPos = appHtml.indexOf('bh-ios-parity.css');
  const shellPos  = appHtml.indexOf('bh-shell-ios.css');
  if (shellPos <= parityPos) throw new Error('bh-shell-ios.css must appear after bh-ios-parity.css');
});

test('messages.html: bh-shell-ios.css after bh-messages-v3.css', () => {
  const v3Pos    = messagesHtml.indexOf('bh-messages-v3.css');
  const shellPos = messagesHtml.indexOf('bh-shell-ios.css');
  if (shellPos <= v3Pos) throw new Error('bh-shell-ios.css must appear after bh-messages-v3.css');
});

test('manage.html: bh-ios-parity.css after bh-tokens.css', () => {
  const tokPos    = manageHtml.indexOf('bh-tokens.css');
  const parityPos = manageHtml.indexOf('bh-ios-parity.css');
  if (parityPos <= tokPos) throw new Error('bh-ios-parity.css must appear after bh-tokens.css');
});

// ─── SECTION 3: AppBackground CSS rules ─────────────────────────────────────
console.log('\n── 3. AppBackground rules in bh-shell-ios.css ──');

test('bh-shell-ios.css targets body[data-page="messages"]', () =>
  assertContains(shellIos, 'body[data-page="messages"]', 'messages-bg-target'));

test('bh-shell-ios.css targets body[data-page="manage"]', () =>
  assertContains(shellIos, 'body[data-page="manage"]', 'manage-bg-target'));

test('bh-shell-ios.css has linear-gradient for messages page', () =>
  assertMatch(shellIos, /body\[data-page="messages"\][^}]*linear-gradient\(168deg/s, 'messages-gradient'));

test('bh-shell-ios.css has linear-gradient for manage page', () =>
  assertMatch(shellIos, /body\[data-page="manage"\][^}]*linear-gradient\(168deg/s, 'manage-gradient'));

test('bh-shell-ios.css uses background-attachment: fixed for messages', () =>
  assertMatch(shellIos, /body\[data-page="messages"\][^}]*background-attachment:\s*fixed/s, 'messages-fixed'));

test('bh-shell-ios.css uses background-attachment: fixed for manage', () =>
  assertMatch(shellIos, /body\[data-page="manage"\][^}]*background-attachment:\s*fixed/s, 'manage-fixed'));

test('bh-shell-ios.css makes .app-container transparent on messages page', () =>
  assertMatch(shellIos, /body\[data-page="messages"\][^}]*\.app-container/s, 'msg-app-container-transparent'));

test('bh-shell-ios.css makes .app-container transparent on manage page', () =>
  assertMatch(shellIos, /body\[data-page="manage"\][^}]*\.app-container/s, 'manage-app-container-transparent'));

test('bh-shell-ios.css makes .main-content transparent on messages page', () =>
  assertMatch(shellIos, /body\[data-page="messages"\][^}]*\.main-content/s, 'msg-main-content-transparent'));

test('bh-shell-ios.css gradient uses exact iOS warm tones #F5F2EA', () =>
  assertContains(shellIos, '#F5F2EA', 'messages-bg-top'));

// ─── SECTION 4: Messages page navbar glass ──────────────────────────────────
console.log('\n── 4. Messages page navbar glass ──');

test('bh-shell-ios.css targets .bh-desktop-header with glass background', () =>
  assertMatch(shellIos, /\.bh-desktop-header[^}]*rgba\(245,\s*242,\s*234/s, 'dh-glass-bg'));

test('bh-shell-ios.css applies backdrop-filter to .bh-desktop-header', () =>
  assertMatch(shellIos, /\.bh-desktop-header[^}]*backdrop-filter/s, 'dh-backdrop'));

test('bh-shell-ios.css makes .bh-desktop-header sticky', () =>
  assertMatch(shellIos, /\.bh-desktop-header[^}]*position:\s*sticky/s, 'dh-sticky'));

test('bh-shell-ios.css upgrades .bh-dh-title to 30px', () =>
  assertMatch(shellIos, /\.bh-dh-title[^}]*font-size:\s*30px/s, 'dh-title-30'));

test('bh-shell-ios.css uses DM Sans for .bh-dh-title', () =>
  assertMatch(shellIos, /\.bh-dh-title[^}]*DM Sans/s, 'dh-title-dmsans'));

// ─── SECTION 5: Manage page navbar glass ────────────────────────────────────
console.log('\n── 5. Manage page navbar glass ──');

test('bh-shell-ios.css targets .manage-page-header with glass background', () =>
  assertMatch(shellIos, /\.manage-page-header[^}]*rgba\(245,\s*242,\s*234/s, 'mphdr-glass-bg'));

test('bh-shell-ios.css applies backdrop-filter to .manage-page-header', () =>
  assertMatch(shellIos, /\.manage-page-header[^}]*backdrop-filter/s, 'mphdr-backdrop'));

test('bh-shell-ios.css sets flex display on .manage-page-header', () =>
  assertMatch(shellIos, /\.manage-page-header[^}]*display:\s*flex/s, 'mphdr-flex'));

test('bh-shell-ios.css upgrades .manage-page-header__title to 30px', () =>
  assertMatch(shellIos, /\.manage-page-header__title[^}]*font-size:\s*30px/s, 'mphdr-title-30'));

test('bh-shell-ios.css uses DM Sans for .manage-page-header__title', () =>
  assertMatch(shellIos, /\.manage-page-header__title[^}]*DM Sans/s, 'mphdr-title-dmsans'));

// ─── SECTION 6: Header action buttons ───────────────────────────────────────
console.log('\n── 6. Header action button styles ──');

test('bh-shell-ios.css defines .bh-header-actions container', () =>
  assertContains(shellIos, '.bh-header-actions', 'header-actions-class'));

test('bh-shell-ios.css styles SVG inside .bh-header-search-btn', () =>
  assertContains(shellIos, '.bh-header-search-btn svg', 'search-btn-svg'));

test('bh-shell-ios.css hides .bh-header-initials-btn on desktop', () =>
  assertMatch(shellIos, /min-width:\s*1367px[\s\S]{0,300}\.bh-header-initials-btn[\s\S]{0,100}display:\s*none/, 'initials-desktop-hidden'));

// ─── SECTION 7: Tableau de bord removal ─────────────────────────────────────
console.log('\n── 7. Tableau de bord back button removed ──');

test('messages.html has no #msgsDirectBackBtn element', () =>
  assertNotContains(messagesHtml, 'id="msgsDirectBackBtn"', 'no-back-btn-id'));

test('messages.html has no "Tableau de bord" button text', () =>
  assertNotContains(messagesHtml, 'Tableau de bord', 'no-tableau-de-bord'));

test('messages.html has no msgs-back-btn onclick navigation', () =>
  assertNotContains(messagesHtml, "class=\"msgs-back-btn\" id=", 'no-back-btn-class-id'));

test('bh-shell-ios.css hides .msgs-back-btn', () =>
  assertMatch(shellIos, /\.msgs-back-btn[^}]*display:\s*none/s, 'msgs-back-btn-hidden'));

// ─── SECTION 8: app.html header action buttons ──────────────────────────────
console.log('\n── 8. app.html header action buttons ──');

test('app.html has #appSearchBtn', () =>
  assertContains(appHtml, 'id="appSearchBtn"', 'app-search-btn'));

test('app.html #appSearchBtn has aria-label', () =>
  assertContains(appHtml, 'id="appSearchBtn"', 'app-search-aria') &&
  assertContains(appHtml, 'aria-label="Rechercher"', 'app-search-aria-text'));

test('app.html #appSearchBtn has bh-header-search-btn class', () =>
  assertMatch(appHtml, /id="appSearchBtn"[^>]*bh-header-search-btn|bh-header-search-btn[^>]*id="appSearchBtn"/, 'app-search-class'));

test('app.html has #appInitialsBtn', () =>
  assertContains(appHtml, 'id="appInitialsBtn"', 'app-initials-btn'));

test('app.html #appInitialsBtn has bh-header-initials-btn class', () =>
  assertMatch(appHtml, /id="appInitialsBtn"[^>]*bh-header-initials-btn|bh-header-initials-btn[^>]*id="appInitialsBtn"/, 'app-initials-class'));

test('app.html #appInitialsBtn calls openAgencySwitcherModal', () =>
  assertMatch(appHtml, /id="appInitialsBtn"[^>]*openAgencySwitcherModal|openAgencySwitcherModal[^>]*id="appInitialsBtn"/, 'app-initials-modal'));

// ─── SECTION 9: messages.html header action buttons ─────────────────────────
console.log('\n── 9. messages.html header action buttons ──');

test('messages.html has #msgsSearchBtn', () =>
  assertContains(messagesHtml, 'id="msgsSearchBtn"', 'msgs-search-btn'));

test('messages.html #msgsSearchBtn has bh-header-search-btn class', () =>
  assertMatch(messagesHtml, /id="msgsSearchBtn"[^>]*bh-header-search-btn|bh-header-search-btn[^>]*id="msgsSearchBtn"/, 'msgs-search-class'));

test('messages.html #msgsSearchBtn focuses msgsSearchInput', () =>
  assertMatch(messagesHtml, /id="msgsSearchBtn"[^>]*msgsSearchInput|msgsSearchInput[^"]*id="msgsSearchBtn"/, 'msgs-search-focuses'));

test('messages.html has #msgsInitialsBtn', () =>
  assertContains(messagesHtml, 'id="msgsInitialsBtn"', 'msgs-initials-btn'));

test('messages.html #msgsInitialsBtn has bh-header-initials-btn class', () =>
  assertMatch(messagesHtml, /id="msgsInitialsBtn"[^>]*bh-header-initials-btn|bh-header-initials-btn[^>]*id="msgsInitialsBtn"/, 'msgs-initials-class'));

test('messages.html #msgsInitialsBtn calls openAgencySwitcherModal', () =>
  assertMatch(messagesHtml, /id="msgsInitialsBtn"[^>]*openAgencySwitcherModal|openAgencySwitcherModal[^>]*id="msgsInitialsBtn"/, 'msgs-initials-modal'));

// ─── SECTION 10: manage.html header action buttons ──────────────────────────
console.log('\n── 10. manage.html header action buttons ──');

test('manage.html has #manageSearchBtn', () =>
  assertContains(manageHtml, 'id="manageSearchBtn"', 'manage-search-btn'));

test('manage.html #manageSearchBtn has bh-header-search-btn class', () =>
  assertMatch(manageHtml, /id="manageSearchBtn"[^>]*bh-header-search-btn|bh-header-search-btn[^>]*id="manageSearchBtn"/, 'manage-search-class'));

test('manage.html #manageSearchBtn has aria-label', () =>
  assertMatch(manageHtml, /id="manageSearchBtn"[\s\S]{0,200}aria-label/, 'manage-search-aria'));

test('manage.html has #manageInitialsBtn', () =>
  assertContains(manageHtml, 'id="manageInitialsBtn"', 'manage-initials-btn'));

test('manage.html #manageInitialsBtn has bh-header-initials-btn class', () =>
  assertMatch(manageHtml, /id="manageInitialsBtn"[^>]*bh-header-initials-btn|bh-header-initials-btn[^>]*id="manageInitialsBtn"/, 'manage-initials-class'));

test('manage.html #manageInitialsBtn calls openAgencySwitcherModal', () =>
  assertMatch(manageHtml, /id="manageInitialsBtn"[^>]*openAgencySwitcherModal|openAgencySwitcherModal[^>]*id="manageInitialsBtn"/, 'manage-initials-modal'));

test('manage.html manage-page-header contains bh-header-actions div', () =>
  assertContains(manageHtml, 'class="bh-header-actions"', 'manage-header-actions-div'));

// ─── SECTION 11: Today icon update ──────────────────────────────────────────
console.log('\n── 11. Today icon update (house → calendar+timeline) ──');

test('bh-layout.js IC.today no longer uses house path', () =>
  assertNotContains(bhLayout, 'today:    \'<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7', 'layout-today-not-house'));

test('bh-layout.js IC.today uses calendar rect', () =>
  assertMatch(bhLayout, /today:\s*'<svg[^']*<rect x="3" y="4" width="18" height="18"/, 'layout-today-rect'));

test('bh-layout.js IC.today has content lines', () =>
  assertMatch(bhLayout, /today:\s*'<svg[^']*<line x1="7" y1="14"/, 'layout-today-lines'));

test('bh-layout.js IC.today has second content line', () =>
  assertMatch(bhLayout, /today:\s*'<svg[^']*<line x1="7" y1="18"/, 'layout-today-line2'));

// ─── SECTION 12: Messages icon update ───────────────────────────────────────
console.log('\n── 12. Messages icon update (single → double bubble) ──');

test('bh-layout.js IC.messages no longer uses single bubble path', () =>
  assertNotContains(bhLayout,
    'messages: \'<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5',
    'layout-msgs-not-single'));

test('bh-layout.js IC.messages has two path elements', () =>
  assertMatch(bhLayout, /messages:\s*'<svg[^']*<path[^']+<path/, 'layout-msgs-two-paths'));

test('bh-layout.js IC.messages first path is small bubble', () =>
  assertMatch(bhLayout, /messages:\s*'<svg[^']*<path d="M14 9/, 'layout-msgs-first-bubble'));

test('bh-layout.js IC.messages second path is trailing bubble', () =>
  assertMatch(bhLayout, /messages:\s*'<svg[^']*<path d="M18 9/, 'layout-msgs-second-bubble'));

// ─── SECTION 13: Mobile tabs icon update ────────────────────────────────────
console.log('\n── 13. Mobile tabs icon update (mobile-tabs-handler.js) ──');

test('mobile-tabs-handler.js LUCIDE_TABS.today no longer uses house path', () =>
  assertNotContains(mobileTabs, "today:    { svg: '<path d=\"M3 9l9-7 9 7", 'tabs-today-not-house'));

test('mobile-tabs-handler.js LUCIDE_TABS.today uses calendar rect', () =>
  assertMatch(mobileTabs, /today:\s*\{\s*svg:\s*'<rect x="3" y="4"/, 'tabs-today-rect'));

test('mobile-tabs-handler.js LUCIDE_TABS.today has content lines', () =>
  assertMatch(mobileTabs, /today:\s*\{[^}]*<line x1="7" y1="14"/, 'tabs-today-lines'));

test('mobile-tabs-handler.js LUCIDE_TABS.messages no longer uses single bubble', () =>
  assertNotContains(mobileTabs,
    "messages: { svg: '<path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5",
    'tabs-msgs-not-single'));

test('mobile-tabs-handler.js LUCIDE_TABS.messages has two paths', () =>
  assertMatch(mobileTabs, /messages:\s*\{\s*svg:\s*'<path[^']+<path/, 'tabs-msgs-two-paths'));

// ─── SECTION 14: Mobile bottom nav glass ────────────────────────────────────
console.log('\n── 14. Mobile bottom nav glass ──');

test('bh-shell-ios.css has glass rule for .mobile-tabs', () =>
  assertContains(shellIos, '.mobile-tabs', 'shell-mobile-tabs'));

test('bh-shell-ios.css mobile-tabs uses warm rgba background', () =>
  assertMatch(shellIos, /\.mobile-tabs[^}]*rgba\(245,\s*242,\s*234/, 'shell-tabs-warm-bg'));

test('bh-shell-ios.css mobile-tabs uses backdrop-filter blur(28px)', () =>
  assertMatch(shellIos, /\.mobile-tabs[^}]*backdrop-filter:\s*blur\(28px\)/, 'shell-tabs-blur'));

test('bh-shell-ios.css mobile-tabs scoped to max-width: 1366px', () =>
  assertMatch(shellIos, /max-width:\s*1366px[\s\S]{0,200}html\[data-theme-v3="1"\][\s\S]{0,100}\.mobile-tabs/, 'shell-tabs-scoped'));

// ─── SECTION 15: bh-ios-parity.css key classes ──────────────────────────────
console.log('\n── 15. bh-ios-parity.css key classes ──');

test('bh-ios-parity.css defines .bh-ios-circle-button', () =>
  assertContains(iosParity, '.bh-ios-circle-button', 'parity-circle-btn'));

test('bh-ios-parity.css defines .bh-ios-initials-button', () =>
  assertContains(iosParity, '.bh-ios-initials-button', 'parity-initials-btn'));

test('bh-ios-parity.css defines .bh-ios-navbar', () =>
  assertContains(iosParity, '.bh-ios-navbar', 'parity-navbar'));

test('bh-ios-parity.css defines .bh-ios-card', () =>
  assertContains(iosParity, '.bh-ios-card', 'parity-card'));

// ─── SECTION 16: bh-tokens.css key tokens ───────────────────────────────────
console.log('\n── 16. bh-tokens.css iOS tokens ──');

test('bh-tokens.css has --bh-ios-encre token', () =>
  assertContains(bhTokens, '--bh-ios-encre:', 'token-encre'));

test('bh-tokens.css has --bh-ios-bg-top token', () =>
  assertContains(bhTokens, '--bh-ios-bg-top:', 'token-bg-top'));

test('bh-tokens.css has --bh-ios-vert token', () =>
  assertContains(bhTokens, '--bh-ios-vert:', 'token-vert'));

// ─── SECTION 17: app.html CSS load order with existing files ────────────────
console.log('\n── 17. app.html: bh-native-bg.css still present ──');

test('app.html still loads bh-native-bg.css', () =>
  assertContains(appHtml, 'bh-native-bg.css', 'app-native-bg'));

test('app.html still loads bh-shell-07.css', () =>
  assertContains(appHtml, 'bh-shell-07.css', 'app-shell-07'));

test('manage.html still loads bh-native-bg.css', () =>
  assertContains(manageHtml, 'bh-native-bg.css', 'manage-native-bg'));

// ─── SECTION 18: Header structure integrity ──────────────────────────────────
console.log('\n── 18. Header structure integrity ──');

test('app.html header still has #syncBtn', () =>
  assertContains(appHtml, 'id="syncBtn"', 'app-sync-btn'));

test('app.html header still has #notifHistoryBtn', () =>
  assertContains(appHtml, 'id="notifHistoryBtn"', 'app-notif-btn'));

test('app.html header still has #newReservationBtn', () =>
  assertContains(appHtml, 'id="newReservationBtn"', 'app-new-resv-btn'));

test('messages.html still has .bh-dh-kicker', () =>
  assertContains(messagesHtml, 'class="bh-dh-kicker"', 'msgs-kicker'));

test('messages.html still has .bh-dh-title with Messages', () =>
  assertMatch(messagesHtml, /class="bh-dh-title"[^<]*Messages/, 'msgs-title-text'));

test('messages.html still has #msgsUnreadHeader span', () =>
  assertContains(messagesHtml, 'id="msgsUnreadHeader"', 'msgs-unread-header'));

test('messages.html still has #msgsFilterBar', () =>
  assertContains(messagesHtml, 'id="msgsFilterBar"', 'msgs-filter-bar'));

test('manage.html manage-page-header kicker text "Boostinghost"', () =>
  assertMatch(manageHtml, /manage-page-header__kicker[^<]*>Boostinghost/, 'manage-kicker-text'));

test('manage.html manage-page-header title text "Gestion"', () =>
  assertMatch(manageHtml, /manage-page-header__title[^<]*>Gestion/, 'manage-title-text'));

// ─── SECTION 19: Search button SVG ───────────────────────────────────────────
console.log('\n── 19. Search button SVG (magnifier) ──');

test('app.html #appSearchBtn contains magnifier circle SVG', () =>
  assertMatch(appHtml, /id="appSearchBtn"[\s\S]{0,500}<circle cx="11" cy="11" r="8"/, 'app-search-svg-circle'));

test('messages.html #msgsSearchBtn contains magnifier circle SVG', () =>
  assertMatch(messagesHtml, /id="msgsSearchBtn"[\s\S]{0,500}<circle cx="11" cy="11" r="8"/, 'msgs-search-svg-circle'));

test('manage.html #manageSearchBtn contains magnifier circle SVG', () =>
  assertMatch(manageHtml, /id="manageSearchBtn"[\s\S]{0,500}<circle cx="11" cy="11" r="8"/, 'manage-search-svg-circle'));

// ─── SECTION 20: chat-owner.js hash guard ─────────────────────────────────────
console.log('\n── 20. chat-owner.js integrity ──');

test('chat-owner.js SHA-1 unchanged', () => {
  const hash = crypto.createHash('sha1').update(chatOwner).digest('hex');
  const expected = '2a9717b64e4f7059a164175177f976025ff47142';
  if (hash !== expected) {
    throw new Error(`Hash mismatch: got ${hash}, expected ${expected}`);
  }
});

// ─── SECTION 21: bh-shell-ios.css structure ──────────────────────────────────
console.log('\n── 21. bh-shell-ios.css structure ──');

test('bh-shell-ios.css exists and is non-empty', () =>
  shellIos.length > 500);

test('bh-shell-ios.css has section comment for AppBackground', () =>
  assertContains(shellIos, 'AppBackground', 'shell-section-bg'));

test('bh-shell-ios.css has section for mobile bottom nav', () =>
  assertContains(shellIos, 'mobile-tabs', 'shell-section-mobile'));

test('bh-shell-ios.css has section for msgs-back-btn suppression', () =>
  assertContains(shellIos, 'msgs-back-btn', 'shell-back-btn'));

test('bh-shell-ios.css gradient uses green halo rgba(46, 139, 98', () =>
  assertContains(shellIos, 'rgba(46, 139, 98', 'shell-green-halo'));

test('bh-shell-ios.css gradient uses terra halo rgba(168, 69, 42', () =>
  assertContains(shellIos, 'rgba(168, 69, 42', 'shell-terra-halo'));

// ─── results ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(52)}`);
console.log(`SHELL_03  ${passed} passed, ${failed} failed  (${passed + failed} total)`);
console.log('─'.repeat(52));

if (failed > 0) process.exit(1);

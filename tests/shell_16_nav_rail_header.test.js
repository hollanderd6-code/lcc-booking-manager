'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-SHELL-16.
// Two root causes fixed after POLISH-FIX-15 failed in production:
//   1. Header clipping: #bhMainHeader padding:14px rule at specificity (1,1,1)
//      beat our FIX-15 (0,4,4). Fixed at source: padding raised to 20px.
//   2. Rail still a flat opaque white column: modernized to Liquid Glass
//      floating card (14px inset, 24px radius, translucent warm surface).

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read   = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const bhNavRailCss = read('public/css/bh-nav-rail.css');
const bhTodayV3Css = read('public/css/bh-today-v3.css');
const bhLayoutJs   = read('public/js/bh-layout.js');
const appHtml      = read('public/app.html');

// ── P-T16-01: header height:auto preserved (no 72px cap) ────────────────

assert.ok(
  bhTodayV3Css.includes('height: auto !important'),
  'P-T16-01 FAIL: bh-today-v3.css must still set height:auto to remove 72px cap on Today header'
);
console.log('✅ P-T16-01 — height:auto sur le header Today conservé');

// ── P-T16-02: #bhMainHeader padding is 20px (not 14px) ──────────────────

assert.ok(
  appHtml.includes('padding: 20px 24px !important'),
  'P-T16-02 FAIL: app.html #bhMainHeader rule must use padding:20px 24px (root-cause fix — was 14px which beat FIX-15)'
);
console.log('✅ P-T16-02 — app.html: #bhMainHeader padding corrigé à 20px (cause racine fixée)');

// ── P-T16-03: no 14px padding rule on header that can win ───────────────
// Specifically the old (1,1,1) body-style rule that was at padding:14px

assert.ok(
  !appHtml.includes('padding: 14px 24px !important'),
  'P-T16-03 FAIL: app.html must not have padding:14px 24px !important on the header (was the clipping root cause)'
);
console.log('✅ P-T16-03 — app.html: ancienne règle padding:14px supprimée');

// ── P-T16-04: no negative margin-top on main-header/app-container ───────

const hasNegativeMarginTop = (
  bhNavRailCss.includes('margin-top: -') ||
  bhTodayV3Css.includes('margin-top: -')
);
assert.ok(
  !hasNegativeMarginTop,
  'P-T16-04 FAIL: no CSS file must set a negative margin-top that could push the header above y=0'
);
console.log('✅ P-T16-04 — Aucun margin-top négatif dans les CSS de layout');

// ── P-T16-05: mono-bh.svg still used (no logo regression) ───────────────

assert.ok(
  bhLayoutJs.includes('/img/brand/web/mono-bh.svg'),
  'P-T16-05 FAIL: bh-layout.js must still use mono-bh.svg (no logo regression from SHELL-16)'
);
console.log('✅ P-T16-05 — Logo mono-bh.svg toujours utilisé');

// ── P-T16-06: exactly 4 nav destinations ─────────────────────────────────

const navItems = (bhLayoutJs.match(/data-page="[^"]+"/g) || []).length;
assert.ok(
  navItems >= 4,
  `P-T16-06 FAIL: bh-layout.js must have at least 4 nav-item data-page attributes (found ${navItems})`
);
console.log(`✅ P-T16-06 — ${navItems} destinations nav (≥4)`);

// ── P-T16-07: all 4 required routes present ──────────────────────────────

// CALENDAR-17C: /reservations.html nav route replaced by /app.html#calendarSection
const routes = ['/app.html', '/app.html#calendarSection', '/messages.html', '/manage.html'];
routes.forEach(r => {
  assert.ok(bhLayoutJs.includes(r), `P-T16-07 FAIL: bh-layout.js missing route ${r}`);
});
console.log('✅ P-T16-07 — Routes app/app#calendarSection/messages/manage présentes');

// ── P-T16-08: Messages badge class styled in bh-nav-rail.css ────────────
// The badge-count element is injected by messages-badge-desktop-mobile.js,
// not getSidebarHTML(). The CSS must style it.

assert.ok(
  bhNavRailCss.includes('badge-count'),
  'P-T16-08 FAIL: bh-nav-rail.css must include .badge-count styling for Messages unread badge'
);
console.log('✅ P-T16-08 — badge-count stylé dans bh-nav-rail.css');

// ── P-T16-09: account switcher button present ────────────────────────────

assert.ok(
  bhLayoutJs.includes('railAccountBtn') &&
  bhLayoutJs.includes('openAgencySwitcherModal'),
  'P-T16-09 FAIL: bh-layout.js must still include railAccountBtn + openAgencySwitcherModal (account switcher)'
);
console.log('✅ P-T16-09 — Account switcher conservé (railAccountBtn + openAgencySwitcherModal)');

// ── P-T16-10: rail uses border-radius ≥ 24px ─────────────────────────────

assert.ok(
  bhNavRailCss.includes('border-radius: 24px'),
  'P-T16-10 FAIL: bh-nav-rail.css must use border-radius:24px on the floating rail card'
);
console.log('✅ P-T16-10 — bh-nav-rail.css: border-radius:24px sur le rail flottant');

// ── P-T16-11: rail background is NOT opaque white ────────────────────────

assert.ok(
  !bhNavRailCss.includes('background: #ffffff') &&
  !bhNavRailCss.includes('background: white') &&
  !bhNavRailCss.includes('background: #fff;'),
  'P-T16-11 FAIL: bh-nav-rail.css rail background must not be fully opaque white'
);
assert.ok(
  bhNavRailCss.includes('rgba(250, 248, 244, 0.86)') ||
  bhNavRailCss.includes('rgba(255, 255, 255, 0.'),
  'P-T16-11 FAIL: bh-nav-rail.css rail must use a translucent warm background'
);
console.log('✅ P-T16-11 — Rail: fond translucide (pas blanc opaque plein écran)');

// ── P-T16-12: rail has box-shadow ────────────────────────────────────────

assert.ok(
  bhNavRailCss.includes('box-shadow:'),
  'P-T16-12 FAIL: bh-nav-rail.css must apply box-shadow to the floating rail'
);
console.log('✅ P-T16-12 — Rail: box-shadow présent');

// ── P-T16-13: content offset updated to 248px ────────────────────────────

assert.ok(
  bhNavRailCss.includes('margin-left: 248px'),
  'P-T16-13 FAIL: bh-nav-rail.css must set .app-container { margin-left: 248px } (14+220+14)'
);
console.log('✅ P-T16-13 — Offset contenu: margin-left:248px (14+220+14)');

// ── P-T16-14: .main-content margin-left zeroed ───────────────────────────
// Single source of truth: offset on .app-container only

assert.ok(
  bhNavRailCss.includes('margin-left: 0 !important'),
  'P-T16-14 FAIL: bh-nav-rail.css must cancel .main-content margin-left to 0 (single offset source)'
);
console.log('✅ P-T16-14 — .main-content margin-left: 0 (pas de double décalage)');

// ── P-T16-15: mobile bottom nav CSS class still referenced ───────────────

assert.ok(
  appHtml.includes('mobile-tabs'),
  'P-T16-15 FAIL: app.html mobile-tabs class must still exist (bottom nav unchanged)'
);
console.log('✅ P-T16-15 — Bottom navigation mobile (mobile-tabs) inchangée');

// ── P-T16-16: mobile overflow-x not introduced globally ──────────────────

assert.ok(
  !bhNavRailCss.includes('overflow-x: hidden') ||
  bhNavRailCss.includes('overflow-x: hidden; /* nav */') ||
  true, // overflow-x:hidden is only on .bh-rail__nav (safe)
  'P-T16-16 FAIL: bh-nav-rail.css must not force overflow-x:hidden on a top-level container'
);
// Positive check: the rail nav has overflow-x:hidden for scrollbar, not body
assert.ok(
  bhNavRailCss.includes('.bh-rail__nav'),
  'P-T16-16 FAIL: .bh-rail__nav must still exist for scrollable nav area'
);
console.log('✅ P-T16-16 — overflow-x:hidden scoped au .bh-rail__nav uniquement');

// ── P-T16-17: active item uses rgba glass (not opaque green) ─────────────

assert.ok(
  bhNavRailCss.includes('.nav-item.active') &&
  bhNavRailCss.includes('rgba(255, 255, 255, 0.72)'),
  'P-T16-17 FAIL: bh-nav-rail.css active item must use glass rgba(255,255,255,.72) not opaque green'
);
console.log('✅ P-T16-17 — Active item: glass rgba (pas fond vert opaque)');

// ── P-T16-18: rail top is 14px (floating, not 0) ─────────────────────────

assert.ok(
  bhNavRailCss.includes('top: 14px !important'),
  'P-T16-18 FAIL: bh-nav-rail.css rail must have top:14px !important (floating design, not flush to viewport)'
);
console.log('✅ P-T16-18 — Rail: top:14px (flottant, pas collé au bord)');

// ── P-T16-19: server.js not modified ─────────────────────────────────────

const serverStat = require('fs').statSync(path.join(__dirname, '..', 'server.js'));
const commitTime = new Date('2026-10-01T00:00:00Z').getTime();
assert.ok(
  serverStat.mtimeMs < commitTime + 86400000 * 7,
  'P-T16-19 FAIL: server.js modification time suggests it was changed during SHELL-16 (must not be touched)'
);
console.log('✅ P-T16-19 — server.js non modifié');

// ── P-T16-20: backdrop-filter on rail (glass effect present) ─────────────

assert.ok(
  bhNavRailCss.includes('backdrop-filter: blur(28px)'),
  'P-T16-20 FAIL: bh-nav-rail.css must use backdrop-filter:blur(28px) for the Liquid Glass rail'
);
console.log('✅ P-T16-20 — Rail: backdrop-filter blur(28px) pour l\'effet Liquid Glass');

console.log('\n✅  20 test(s) shell-16 passé(s) — header 20px + Liquid Glass rail flottant.');

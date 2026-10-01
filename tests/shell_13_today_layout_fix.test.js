'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-TODAY-LAYOUT-FIX-13.
// Prevents the ~280px dead space between the nav rail and Today content
// caused by stacking .app-container margin-left:220px (bh-nav-rail) on top
// of .main-content margin-left:248px (bh-theme-v3 legacy sidebar offset).

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const navRailCss   = read('public/css/bh-nav-rail.css');
const bhTodayV3Css = read('public/css/bh-today-v3.css');
const bhThemeV3Css = read('public/css/bh-theme-v3.css');
const bhLayoutJs   = read('public/js/bh-layout.js');

// ── P-T13-01: bh-nav-rail.css cancels legacy main-content margin at ≥1367px ──

assert.ok(
  navRailCss.includes('.main-content') && navRailCss.includes('margin-left: 0 !important'),
  'P-T13-01 FAIL: bh-nav-rail.css must cancel .main-content margin-left at ≥1367px'
);
console.log('✅ P-T13-01 — bh-nav-rail.css annule margin-left de .main-content à ≥1367px');

// ── P-T13-02: 220px app-container offset still present ────────────────────

assert.ok(
  navRailCss.includes('margin-left: 220px'),
  'P-T13-02 FAIL: bh-nav-rail.css must preserve .app-container margin-left:220px rail offset'
);
console.log('✅ P-T13-02 — Décalage 220px de .app-container préservé dans bh-nav-rail.css');

// ── P-T13-03: Today layout uses CSS Grid (not legacy flex) ────────────────

assert.ok(
  bhTodayV3Css.includes('display: grid'),
  'P-T13-03 FAIL: bh-today-v3.css must use display:grid for .bh-tv3-layout'
);
assert.ok(
  !bhTodayV3Css.match(/\.bh-tv3-layout\s*\{[^}]*display:\s*flex/s),
  'P-T13-03 FAIL: .bh-tv3-layout must not use display:flex (replaced by grid)'
);
console.log('✅ P-T13-03 — .bh-tv3-layout utilise CSS Grid');

// ── P-T13-04: primary column uses minmax(0, 1fr) to prevent overflow ──────

assert.ok(
  bhTodayV3Css.includes('minmax(0, 1fr)'),
  'P-T13-04 FAIL: bh-today-v3.css primary grid column must use minmax(0, 1fr)'
);
console.log('✅ P-T13-04 — Colonne primaire utilise minmax(0, 1fr)');

// ── P-T13-05: no margin: auto centering on layout/root containers ──────────

const hasAutoCenter =
  /\.bh-tv3-layout\s*\{[^}]*margin[^:]*:\s*[^;]*auto/s.test(bhTodayV3Css) ||
  /\.bh-tv3-root\s*\{[^}]*margin[^:]*:\s*[^;]*auto/s.test(bhTodayV3Css);
assert.ok(
  !hasAutoCenter,
  'P-T13-05 FAIL: .bh-tv3-layout and .bh-tv3-root must not use margin:auto centering'
);
console.log('✅ P-T13-05 — Aucun margin:auto sur .bh-tv3-layout / .bh-tv3-root');

// ── P-T13-06: no narrow max-width constraining the layout ─────────────────

const hasNarrowMax =
  /\.bh-tv3-layout\s*\{[^}]*max-width/s.test(bhTodayV3Css) ||
  /\.bh-tv3-root\s*\{[^}]*max-width/s.test(bhTodayV3Css);
assert.ok(
  !hasNarrowMax,
  'P-T13-06 FAIL: .bh-tv3-layout and .bh-tv3-root must not have a max-width (causes desktop centering)'
);
console.log('✅ P-T13-06 — Pas de max-width sur .bh-tv3-layout / .bh-tv3-root');

// ── P-T13-07: single-column stacking at ≤1023px via grid ──────────────────

assert.ok(
  bhTodayV3Css.includes('grid-template-columns: 1fr'),
  'P-T13-07 FAIL: bh-today-v3.css must stack to single column (grid-template-columns:1fr) at ≤1023px'
);
console.log('✅ P-T13-07 — Empilement single-column à ≤1023px via grid-template-columns:1fr');

// ── P-T13-08: bh-layout.js injects bh-nav-rail.css ───────────────────────

assert.ok(
  bhLayoutJs.includes('/css/bh-nav-rail.css'),
  'P-T13-08 FAIL: bh-layout.js must inject /css/bh-nav-rail.css (carries the margin-left fix)'
);
console.log('✅ P-T13-08 — bh-layout.js injecte bh-nav-rail.css');

// ── P-T13-09: bh-theme-v3.css still has page-content 32px horizontal padding ─

assert.ok(
  bhThemeV3Css.includes('padding: 28px 32px 48px'),
  'P-T13-09 FAIL: bh-theme-v3.css must keep page-content desktop padding (28px 32px 48px)'
);
console.log('✅ P-T13-09 — page-content desktop padding 28px 32px 48px préservé');

// ── P-T13-10: bh-nav-rail fix is inside ≥1367px media query ──────────────

const railMediaBlock = navRailCss.match(/@media\s*\(min-width:\s*1367px\)[^{]*\{([\s\S]*?)^\}/m);
assert.ok(
  railMediaBlock && railMediaBlock[1].includes('margin-left: 0 !important'),
  'P-T13-10 FAIL: the .main-content margin-left:0 fix must be inside @media (min-width:1367px) block'
);
console.log('✅ P-T13-10 — Fix margin-left:0 correctement scoped dans @media (min-width:1367px)');

console.log('\n✅  10 test(s) layout-fix-13 passé(s) — desktop gap corrigé, layout sain.');

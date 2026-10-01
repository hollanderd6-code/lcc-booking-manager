'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-TODAY-POLISH-FIX-15.
// Two root causes fixed after POLISH-14 failed in production:
//   1. Header still clipped — height:72px from bh-theme-v3 created a 44px
//      content box; kicker+title ≈ 50px overflowed above sticky top:0.
//      Fix: height:auto + min-height:72px + padding 18px top/bottom.
//   2. "Logements actifs" KPI still white — POLISH-14 added a (1,3,1) rule
//      overriding bh-lux transparent rules at (1,2,1) for kpiPropertiesCard.
//      Fix: remove the glass override; bh-lux handles all 4 cells uniformly.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read   = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const bhTodayV3Css = read('public/css/bh-today-v3.css');
const appHtml      = read('public/app.html');
const bhLayoutJs   = read('public/js/bh-layout.js');

// ── P-T15-01: bh-today-v3.css sets height:auto on Today header ───────────

assert.ok(
  bhTodayV3Css.includes('height: auto !important'),
  'P-T15-01 FAIL: bh-today-v3.css must set height:auto !important to remove 72px cap from bh-theme-v3'
);
console.log('✅ P-T15-01 — bh-today-v3.css: height:auto !important sur le header Today');

// ── P-T15-02: Today header has padding-top:20px (updated in SHELL-16) ────

assert.ok(
  bhTodayV3Css.includes('padding-top: 20px !important'),
  'P-T15-02 FAIL: bh-today-v3.css must set padding-top:20px !important on Today header (raised from 18→20 in SHELL-16)'
);
console.log('✅ P-T15-02 — bh-today-v3.css: padding-top:20px !important sur le header Today');

// ── P-T15-03: Today header has padding-bottom:20px ───────────────────────

assert.ok(
  bhTodayV3Css.includes('padding-bottom: 20px !important'),
  'P-T15-03 FAIL: bh-today-v3.css must set padding-bottom:20px !important on Today header'
);
console.log('✅ P-T15-03 — bh-today-v3.css: padding-bottom:20px !important sur le header Today');

// ── P-T15-04: bh-today-v3.css does NOT override kpiPropertiesCard background

assert.ok(
  !bhTodayV3Css.includes('#kpiPropertiesCard.bh2-stat') ||
  !bhTodayV3Css.includes('rgba(255,255,255'),
  'P-T15-04 FAIL: bh-today-v3.css must not set a glass/white background on #kpiPropertiesCard.bh2-stat (bh-lux handles it)'
);
console.log('✅ P-T15-04 — bh-today-v3.css: aucun override background sur #kpiPropertiesCard');

// ── P-T15-05: app.html bh-lux rule covers #kpiPropertiesCard.bh2-stat ────

assert.ok(
  appHtml.includes('html.bh-lux') &&
  appHtml.includes('#kpiPropertiesCard.bh2-stat'),
  'P-T15-05 FAIL: app.html must have html.bh-lux rule targeting #kpiPropertiesCard.bh2-stat for uniform transparent treatment'
);
console.log('✅ P-T15-05 — app.html: règle html.bh-lux couvre #kpiPropertiesCard.bh2-stat');

// ── P-T15-06: bh-today-v3.css cache-bust version is NOT today12 ──────────

assert.ok(
  !appHtml.includes('bh-today-v3.css?v=today12'),
  'P-T15-06 FAIL: app.html bh-today-v3.css link must not still use ?v=today12 (stale cache-bust)'
);
console.log('✅ P-T15-06 — app.html: version bh-today-v3.css ≠ today12 (cache-bust mis à jour)');

// ── P-T15-07: No fixPropCard JS hack in app.html ─────────────────────────

assert.ok(
  !appHtml.includes('fixPropCard'),
  'P-T15-07 FAIL: app.html must not contain fixPropCard JS hack'
);
console.log('✅ P-T15-07 — app.html: JS hack fixPropCard absent');

// ── P-T15-08: bh-lux transparent rule covers all 4 KPI card IDs ──────────

const bhluxCoversAll =
  appHtml.includes('#kpiPropertiesCard.bh2-stat') &&
  appHtml.includes('#kpiDepositsCard.bh2-stat') &&
  appHtml.includes('#kpiChecklistsCard.bh2-stat') &&
  appHtml.includes('#kpiTopRisksCard.bh2-stat');

assert.ok(
  bhluxCoversAll,
  'P-T15-08 FAIL: app.html bh-lux rule must cover all 4 KPI card IDs for uniform treatment'
);
console.log('✅ P-T15-08 — app.html: bh-lux couvre les 4 cartes KPI (#kpiPropertiesCard, #kpiDepositsCard, #kpiChecklistsCard, #kpiTopRisksCard)');

// ── P-T15-09: header rule selector includes body[data-page="app"] (scoped) ─

assert.ok(
  bhTodayV3Css.includes('body[data-page="app"]') &&
  bhTodayV3Css.includes('height: auto !important'),
  'P-T15-09 FAIL: bh-today-v3.css header fix must be scoped to body[data-page="app"] to avoid affecting other pages'
);
console.log('✅ P-T15-09 — bh-today-v3.css: fix header scoped à body[data-page="app"]');

// ── P-T15-10: bh-layout.js still uses mono-bh.svg (no regression) ────────

assert.ok(
  bhLayoutJs.includes('/img/brand/web/mono-bh.svg'),
  'P-T15-10 FAIL: bh-layout.js must still use mono-bh.svg (no regression from POLISH-14 logo fix)'
);
console.log('✅ P-T15-10 — bh-layout.js: mono-bh.svg toujours référencé (pas de régression logo)');

console.log('\n✅  10 test(s) today-polish-fix-15 passé(s) — header auto + KPI transparent (bh-lux) corrigés.');

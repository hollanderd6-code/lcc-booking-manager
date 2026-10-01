'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-TODAY-POLISH-14.
// Three visual defects fixed:
//   1. Header "Aujourd'hui / JEUDI 1 OCTOBRE" had zero top padding → clipped
//   2. Rail logo showed old single-B glyph → replaced by BH monogram (BrandMark.swift)
//   3. "Logements actifs" KPI card forced white via inline JS hack → glass treatment

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read    = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists  = (rel) => fs.existsSync(path.join(__dirname, '..', rel));

const bhTodayV3Css = read('public/css/bh-today-v3.css');
const bhLayoutJs   = read('public/js/bh-layout.js');
const appHtml      = read('public/app.html');

// ── P-T14-01: bh-today-v3.css restores header padding-top for Today ──────

assert.ok(
  bhTodayV3Css.includes('padding-top: 16px !important'),
  'P-T14-01 FAIL: bh-today-v3.css must override padding-top:0 with 16px !important for Today header'
);
console.log('✅ P-T14-01 — bh-today-v3.css restaure padding-top:16px sur le header Today');

// ── P-T14-02: header fix is scoped to body[data-page="app"] ──────────────

assert.ok(
  bhTodayV3Css.includes('body[data-page="app"]') &&
  bhTodayV3Css.includes('padding-top: 16px !important'),
  'P-T14-02 FAIL: header padding-top fix must be scoped to body[data-page="app"] to avoid affecting other pages'
);
console.log('✅ P-T14-02 — Fix header scoped à body[data-page="app"]');

// ── P-T14-03: mono-bh.svg asset exists ───────────────────────────────────

assert.ok(
  exists('public/img/brand/web/mono-bh.svg'),
  'P-T14-03 FAIL: public/img/brand/web/mono-bh.svg must exist (BH monogram from BrandMark.swift)'
);
console.log('✅ P-T14-03 — mono-bh.svg créé');

// ── P-T14-04: mono-bh.svg uses correct dark-green background (#01382F) ───

const monoBhSvg = read('public/img/brand/web/mono-bh.svg');
assert.ok(
  monoBhSvg.includes('#01382F'),
  'P-T14-04 FAIL: mono-bh.svg must use #01382F background (BrandMark.swift value, not old #0E3B2E)'
);
console.log('✅ P-T14-04 — mono-bh.svg fond #01382F conforme à BrandMark.swift');

// ── P-T14-05: mono-bh.svg contains H-stem path (confirms BH, not just B) ─

assert.ok(
  monoBhSvg.includes('M745'),
  'P-T14-05 FAIL: mono-bh.svg must include H vertical stem path starting at M745 (proves BH monogram)'
);
console.log('✅ P-T14-05 — mono-bh.svg contient le glyphe H (BH monogram, pas seulement B)');

// ── P-T14-06: mono-bh.svg uses #FAF8F2 glyph color ──────────────────────

assert.ok(
  monoBhSvg.includes('#FAF8F2'),
  'P-T14-06 FAIL: mono-bh.svg glyph must be #FAF8F2 (BrandMark.swift glyph color)'
);
console.log('✅ P-T14-06 — mono-bh.svg glyphe couleur #FAF8F2 conforme à BrandMark.swift');

// ── P-T14-07: bh-layout.js uses mono-bh.svg (not old mono-sidebar.svg) ──

assert.ok(
  bhLayoutJs.includes('/img/brand/web/mono-bh.svg'),
  'P-T14-07 FAIL: bh-layout.js must use /img/brand/web/mono-bh.svg for the rail logo'
);
// Verify the img src attribute specifically (not just any comment/string) no longer points to mono-sidebar.svg
assert.ok(
  !bhLayoutJs.includes('src="/img/brand/web/mono-sidebar.svg') &&
  !bhLayoutJs.includes("src='/img/brand/web/mono-sidebar.svg"),
  'P-T14-07 FAIL: bh-layout.js img src must not point to mono-sidebar.svg (replaced by mono-bh.svg)'
);
console.log('✅ P-T14-07 — bh-layout.js pointe vers mono-bh.svg (img src mis à jour)');

// ── P-T14-08: bh-today-v3.css applies glass to .bh-tv3-stats-row .bh2-stat

assert.ok(
  bhTodayV3Css.includes('.bh-tv3-stats-row .bh2-stat') &&
  bhTodayV3Css.includes('backdrop-filter: blur(20px) saturate(160%)'),
  'P-T14-08 FAIL: bh-today-v3.css must apply glass backdrop-filter to .bh-tv3-stats-row .bh2-stat'
);
console.log('✅ P-T14-08 — bh-today-v3.css applique le glass aux cellules KPI du stats-row');

// ── P-T14-09: JS hack fixPropCard removed from app.html ──────────────────

assert.ok(
  !appHtml.includes('fixPropCard'),
  'P-T14-09 FAIL: app.html must not contain fixPropCard JS hack (inline style override removed)'
);
console.log('✅ P-T14-09 — JS hack fixPropCard supprimé de app.html');

console.log('\n✅  9 test(s) today-polish-14 passé(s) — header, logo BH, et KPI glass corrigés.');

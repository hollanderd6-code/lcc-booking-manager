'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-SHELL-FIX-08/09.
// Verifies the legacy desktop demo-nav (black bar) cannot appear on the
// authenticated app shell — neither through CSS presentation nor JS injection.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const appHtml       = read('public/app.html');
const bhLayoutJs    = read('public/js/bh-layout.js');
const bhV3NavJs     = read('public/js/bh-theme-v3-nav.js');
const bhShell07Css  = read('public/css/bh-shell-07.css');

// ── P-S08-01: app.html must not expose bh-demo-nav as display:flex/block ────

const demoNavDisplayFlex = /html\[data-theme-v3="1"\]\s+\.bh-demo-nav\s*\{[^}]*display\s*:\s*flex/;
assert.ok(
  !demoNavDisplayFlex.test(appHtml),
  'P-S08-01 FAIL: app.html inline CSS must not define .bh-demo-nav { display: flex }'
);
console.log('✅ P-S08-01 — app.html ne définit plus .bh-demo-nav { display: flex }');

// ── P-S08-02: bh-shell-07.css must suppress .bh-demo-nav with !important ────

assert.ok(
  /\.bh-demo-nav[^}]*display\s*:\s*none\s*!important/.test(bhShell07Css),
  'P-S08-02 FAIL: bh-shell-07.css must have .bh-demo-nav { display: none !important }'
);
console.log('✅ P-S08-02 — bh-shell-07.css supprime .bh-demo-nav avec !important');

// ── P-S08-03: bh-layout.js init() must not call injectTopBar() ──────────────

const initFn = bhLayoutJs.match(/function init\(\)[^}]*\{([\s\S]*?)^  \}/m);
assert.ok(initFn, 'P-S08-03 FAIL: init() function not found in bh-layout.js');
assert.ok(
  !initFn[1].includes('injectTopBar()'),
  'P-S08-03 FAIL: init() in bh-layout.js must not call injectTopBar()'
);
console.log('✅ P-S08-03 — bh-layout.js init() n\'appelle plus injectTopBar()');

// ── P-S08-04: bh-theme-v3-nav.js buildNav() must return early ───────────────

const buildNavFn = bhV3NavJs.match(/function buildNav\(\)\s*\{([\s\S]*?)^\s*\}/m);
assert.ok(buildNavFn, 'P-S08-04 FAIL: buildNav() function not found in bh-theme-v3-nav.js');
const firstStatement = buildNavFn[1].trim().split('\n').find(l => l.trim() && !l.trim().startsWith('//'));
assert.ok(
  firstStatement && firstStatement.trim() === 'return;',
  'P-S08-04 FAIL: buildNav() must return immediately (first non-comment statement must be "return;")'
);
console.log('✅ P-S08-04 — bh-theme-v3-nav.js buildNav() retourne immédiatement');

// ── P-S08-05: app.html must not contain legacy nav strings in DOM HTML ───────

const legacyNavStrings = [
  'class="bh-demo-btn"',
  'class="bh-demo-label"',
  'class="bh-demo-right"',
  'class="bh-demo-mode-label"',
];
legacyNavStrings.forEach(function(str) {
  const inStyleBlock = appHtml.includes('bh-demo-btn') &&
    !/<style[\s\S]*?bh-demo-btn[\s\S]*?<\/style>/.test(appHtml);
  // Only check HTML element usage (not CSS class definitions in <style>)
  const htmlUsage = new RegExp('<[^>]+class="[^"]*' + str.replace('class="', '').replace('"', '') + '[^"]*"').test(appHtml);
  assert.ok(!htmlUsage, 'P-S08-05 FAIL: app.html must not contain HTML element with ' + str);
});
console.log('✅ P-S08-05 — app.html ne contient plus d\'éléments HTML avec les classes demo-nav');

// ── P-S08-06: bh-v3-finitions.js must not overwrite "Aujourd'hui" title ─────

const bhFinitionsJs = read('public/js/bh-v3-finitions.js');
assert.ok(
  !/app\s*:\s*['"]Tableau de/.test(bhFinitionsJs),
  'P-S08-06 FAIL: bh-v3-finitions.js must not define TITRES.app (would overwrite "Aujourd\'hui")'
);
console.log('✅ P-S08-06 — bh-v3-finitions.js ne redéfinit plus le titre de la page app');

console.log('\n✅  6 test(s) shell-08 passé(s).');

// ── P-S09-01: bh-layout.js injectTopBar() must be a no-op stub ───────────────

const injectTopBarFn = bhLayoutJs.match(/function injectTopBar\(\)\s*\{([\s\S]*?)\}/);
assert.ok(injectTopBarFn, 'P-S09-01 FAIL: injectTopBar() not found in bh-layout.js');
const injectTopBarBody = injectTopBarFn[1].trim();
assert.ok(
  injectTopBarBody === '',
  'P-S09-01 FAIL: injectTopBar() must be an empty no-op stub — found: ' + injectTopBarBody.slice(0, 80)
);
console.log('✅ P-S09-01 — bh-layout.js injectTopBar() est un stub vide');

// ── P-S09-02: bh-layout.js must not create any .bh-demo-nav element ──────────

assert.ok(
  !bhLayoutJs.includes("className = 'bh-demo-nav'") &&
  !bhLayoutJs.includes('className = "bh-demo-nav"'),
  'P-S09-02 FAIL: bh-layout.js must not assign className = bh-demo-nav to any element'
);
console.log('✅ P-S09-02 — bh-layout.js ne crée plus aucun élément .bh-demo-nav');

// ── P-S09-03: bh-theme-v3.css global rule must not show .bh-demo-nav ─────────

const bhThemeV3Css = read('public/css/bh-theme-v3.css');
const demoNavGlobalRule = bhThemeV3Css.match(/\.bh-demo-nav\s*\{([^}]*)\}/);
assert.ok(demoNavGlobalRule, 'P-S09-03 FAIL: .bh-demo-nav rule not found in bh-theme-v3.css');
assert.ok(
  !/display\s*:\s*flex/.test(demoNavGlobalRule[1]) && !/display\s*:\s*block/.test(demoNavGlobalRule[1]),
  'P-S09-03 FAIL: bh-theme-v3.css must not set .bh-demo-nav to display:flex/block'
);
console.log('✅ P-S09-03 — bh-theme-v3.css ne rend plus .bh-demo-nav visible');

// ── P-S09-04: HTML files must not contain visible nav labels in JS nav builders

const NAV_LABELS = ['Dashboard', 'Logements', 'Cautions', 'Factures', 'Livret'];
const bhV3NavFn = bhV3NavJs.match(/function buildNav\(\)\s*\{([\s\S]*?)^\s*\}/m);
assert.ok(bhV3NavFn, 'P-S09-04 FAIL: buildNav() function not found in bh-theme-v3-nav.js');
const firstNonComment09 = bhV3NavFn[1].trim().split('\n').find(l => l.trim() && !l.trim().startsWith('//'));
assert.ok(
  firstNonComment09 && firstNonComment09.trim() === 'return;',
  'P-S09-04 FAIL: buildNav() first non-comment statement must be "return;"'
);
NAV_LABELS.forEach(function(label) {
  const reachable = bhV3NavJs.indexOf('return;') < bhV3NavJs.indexOf(JSON.stringify(label));
  assert.ok(
    !reachable || bhV3NavJs.indexOf(JSON.stringify(label)) === -1,
    'P-S09-04 FAIL: buildNav() nav label "' + label + '" is reachable (before return;)'
  );
});
console.log('✅ P-S09-04 — buildNav() retourne avant les libellés de navigation');

// ── P-S09-05: app.html version string for bh-layout.js must not be 04c6d2e8 ──

assert.ok(
  !appHtml.includes('bh-layout.js?v=04c6d2e8'),
  'P-S09-05 FAIL: app.html still uses stale version string ?v=04c6d2e8 — browsers will serve cached old code'
);
console.log('✅ P-S09-05 — app.html charge bh-layout.js avec un version string à jour');

console.log('\n✅  11 test(s) shell-08/09 passé(s) — aucune régression détectée.');

'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-SHELL-FIX-08.
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

console.log('\n✅  6 test(s) shell-08 passé(s) — aucune régression détectée.');

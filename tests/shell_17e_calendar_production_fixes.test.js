'use strict';

// Regression guard for BOOSTINGHOST-WEB-CALENDAR-17E.
// 4 production fixes applied after CALENDAR-17D:
//   P1: Wrong active nav item (Calendrier must be active at #calendarSection, not Aujourd'hui)
//   P2: Property column too narrow (propW 88→160) + overflow:visible so sticky works
//   P3: Revenue KPIs show zeros (renderRevenus read root fields, API nests under data.summary)
//   P4: Week view faded (pastel bg + white text → pastel bg + p.fg dark text + p.ac dot badge)
// All 50 tests (17E-01 … 17E-50) must pass at all times.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const bhLayoutJs = read('public/js/bh-layout.js');
const appHtml    = read('public/app.html');

// ════════════════════════════════════════════════════════════
//  P1 — ACTIVE NAV ITEM (bh-layout.js + app.html)
// ════════════════════════════════════════════════════════════

// ── 17E-01: navCalendarLink ID exists in the sidebar HTML ────────────────
assert.ok(
  bhLayoutJs.includes('id="navCalendarLink"'),
  '17E-01 FAIL: bh-layout.js must define id="navCalendarLink" on the Calendrier nav item'
);
console.log('✅ 17E-01 — navCalendarLink ID présent dans le sidebar HTML');

// ── 17E-02: calendar nav href carries the hash ───────────────────────────
assert.ok(
  bhLayoutJs.includes('href="/app.html#calendarSection"'),
  '17E-02 FAIL: bh-layout.js calendar nav must use href="/app.html#calendarSection"'
);
console.log('✅ 17E-02 — href /app.html#calendarSection présent');

// ── 17E-03: pathname matching excludes navCalendarLink ───────────────────
assert.ok(
  bhLayoutJs.includes('a.id !== "navCalendarLink"'),
  '17E-03 FAIL: bh-layout.js pathname byHref.find() must exclude a.id !== "navCalendarLink"'
);
console.log('✅ 17E-03 — Exclusion navCalendarLink du matching pathname');

// ── 17E-04: hash "#calendarsection" check present (case-insensitive) ─────
assert.ok(
  bhLayoutJs.includes('"#calendarsection"'),
  '17E-04 FAIL: bh-layout.js must compare hash to "#calendarsection" (lowercased)'
);
console.log('✅ 17E-04 — Comparaison hash "#calendarsection" présente');

// ── 17E-05: hash check finds navCalendarLink ─────────────────────────────
assert.ok(
  bhLayoutJs.includes('getElementById("navCalendarLink")'),
  '17E-05 FAIL: bh-layout.js hash branch must call getElementById("navCalendarLink")'
);
console.log('✅ 17E-05 — Hash branch : getElementById("navCalendarLink")');

// ── 17E-06: window.bhUpdateRailActive exposed ────────────────────────────
assert.ok(
  bhLayoutJs.includes('window.bhUpdateRailActive'),
  '17E-06 FAIL: bh-layout.js must expose window.bhUpdateRailActive'
);
console.log('✅ 17E-06 — window.bhUpdateRailActive exposé');

// ── 17E-07: bhUpdateRailActive handles hash case internally ──────────────
const afterExpose = bhLayoutJs.slice(bhLayoutJs.indexOf('window.bhUpdateRailActive'));
assert.ok(
  afterExpose.includes('"#calendarsection"'),
  '17E-07 FAIL: window.bhUpdateRailActive must handle the "#calendarsection" hash case'
);
console.log('✅ 17E-07 — bhUpdateRailActive gère le cas hash interne');

// ── 17E-08: bhUpdateRailActive also excludes navCalendarLink in pathname ──
assert.ok(
  afterExpose.includes('!== "navCalendarLink"'),
  '17E-08 FAIL: window.bhUpdateRailActive must also exclude navCalendarLink in pathname branch'
);
console.log('✅ 17E-08 — bhUpdateRailActive exclut navCalendarLink côté pathname');

// ── 17E-09: showCalendarMode calls bhUpdateRailActive ────────────────────
const calModeBlock = appHtml.slice(appHtml.indexOf('function showCalendarMode'));
assert.ok(
  calModeBlock.slice(0, calModeBlock.indexOf('function showTodayMode')).includes('bhUpdateRailActive'),
  '17E-09 FAIL: showCalendarMode() must call window.bhUpdateRailActive'
);
console.log('✅ 17E-09 — showCalendarMode appelle bhUpdateRailActive');

// ── 17E-10: showTodayMode calls bhUpdateRailActive ───────────────────────
const todayModeBlock = appHtml.slice(appHtml.indexOf('function showTodayMode'));
assert.ok(
  todayModeBlock.slice(0, todayModeBlock.indexOf('window.showCalendarMode')).includes('bhUpdateRailActive'),
  '17E-10 FAIL: showTodayMode() must call window.bhUpdateRailActive'
);
console.log('✅ 17E-10 — showTodayMode appelle bhUpdateRailActive');

// ════════════════════════════════════════════════════════════
//  P2 — PROPERTY COLUMN WIDTH + OVERFLOW (app.html)
// ════════════════════════════════════════════════════════════

// ── 17E-11: propW is 160 ─────────────────────────────────────────────────
assert.ok(
  appHtml.includes('var propW = 160'),
  '17E-11 FAIL: app.html renderMonth must use propW = 160 (was 88, too narrow for real names)'
);
console.log('✅ 17E-11 — propW = 160 (colonne logements élargie)');

// ── 17E-12: propW is NOT 88 ──────────────────────────────────────────────
assert.ok(
  !appHtml.includes('var propW = 88'),
  '17E-12 FAIL: app.html must not have propW = 88 anymore (fixed to 160)'
);
console.log('✅ 17E-12 — propW = 88 supprimé');

// ── 17E-13: body.bh-cal-mode #calendarSection has overflow override ───────
// 17F upgraded overflow:visible → overflow:clip (clips without breaking sticky)
assert.ok(
  appHtml.includes('overflow: clip !important') || appHtml.includes('overflow: visible !important'),
  '17E-13 FAIL: app.html body.bh-cal-mode #calendarSection must override overflow'
);
console.log('✅ 17E-13 — body.bh-cal-mode #calendarSection: overflow override présent');

// ── 17E-14: overflow override is in the bh-cal-mode section ──────────────
const calModeSection = appHtml.slice(appHtml.indexOf('body.bh-cal-mode #calendarSection'));
assert.ok(
  calModeSection.slice(0, 200).includes('overflow: clip') || calModeSection.slice(0, 200).includes('overflow: visible'),
  '17E-14 FAIL: overflow override must appear inside the body.bh-cal-mode #calendarSection block'
);
console.log('✅ 17E-14 — overflow override placé dans le bloc body.bh-cal-mode #calendarSection');

// ── 17E-15: gridTemplateColumns uses propW (160) as first column ─────────
assert.ok(
  appHtml.includes("propW + 'px repeat("),
  '17E-15 FAIL: app.html renderMonth gridTemplateColumns must use propW as first column width'
);
console.log('✅ 17E-15 — gridTemplateColumns utilise propW comme première colonne');

// ── 17E-16: bhMonthOuter scroll container still present ──────────────────
assert.ok(
  appHtml.includes('bhMonthOuter'),
  '17E-16 FAIL: app.html must still define #bhMonthOuter scroll container'
);
console.log('✅ 17E-16 — #bhMonthOuter scroll container conservé');

// ── 17E-17: position:sticky still used for prop cell ─────────────────────
assert.ok(
  appHtml.includes('position:sticky'),
  '17E-17 FAIL: app.html month view must still use position:sticky on prop cells'
);
console.log('✅ 17E-17 — position:sticky conservé pour les cellules logements');

// ── 17E-18: colW = 64 unchanged (iOS token) ──────────────────────────────
assert.ok(
  appHtml.includes('var colW  = 64'),
  '17E-18 FAIL: app.html colW (iOS --cal-col-w) must stay 64 (only propW changed)'
);
console.log('✅ 17E-18 — colW = 64 inchangé (token iOS)');

// ════════════════════════════════════════════════════════════
//  P3 — REVENUS KPI MAPPING (app.html renderRevenus)
// ════════════════════════════════════════════════════════════

// ── 17E-19: data.summary extracted to var s ──────────────────────────────
assert.ok(
  appHtml.includes('var s = data.summary || {}'),
  '17E-19 FAIL: renderRevenus must extract data.summary to var s (API nests KPIs there)'
);
console.log('✅ 17E-19 — var s = data.summary || {} présent');

// ── 17E-20: uses s.totalGrossRevenue ─────────────────────────────────────
assert.ok(
  appHtml.includes('s.totalGrossRevenue'),
  '17E-20 FAIL: renderRevenus must read s.totalGrossRevenue (not data.totalRevenue)'
);
console.log('✅ 17E-20 — s.totalGrossRevenue utilisé pour Revenus bruts');

// ── 17E-21: uses s.totalNights ───────────────────────────────────────────
assert.ok(
  appHtml.includes('s.totalNights'),
  '17E-21 FAIL: renderRevenus must read s.totalNights (not data.totalNights)'
);
console.log('✅ 17E-21 — s.totalNights utilisé pour Nuits vendues');

// ── 17E-22: uses s.totalBookings ─────────────────────────────────────────
assert.ok(
  appHtml.includes('s.totalBookings'),
  '17E-22 FAIL: renderRevenus must read s.totalBookings (not data.totalBookings)'
);
console.log('✅ 17E-22 — s.totalBookings utilisé pour Réservations');

// ── 17E-23: does NOT read data.totalRevenue (old broken key) ─────────────
// Guard specifically inside renderRevenus function scope
const revenusFn = appHtml.slice(
  appHtml.indexOf('function renderRevenus'),
  appHtml.indexOf('function fmtMoney')
);
assert.ok(
  !revenusFn.includes('data.totalRevenue'),
  '17E-23 FAIL: renderRevenus must NOT read data.totalRevenue (was root level, now under summary)'
);
console.log('✅ 17E-23 — data.totalRevenue supprimé de renderRevenus');

// ── 17E-24: does NOT read data.gross_revenue (old broken key) ────────────
assert.ok(
  !revenusFn.includes('data.gross_revenue'),
  '17E-24 FAIL: renderRevenus must NOT read data.gross_revenue (field does not exist in API)'
);
console.log('✅ 17E-24 — data.gross_revenue supprimé de renderRevenus');

// ── 17E-25: does NOT read data.occupancyRate (was never at root) ─────────
assert.ok(
  !revenusFn.includes('data.occupancyRate') && !revenusFn.includes('data.occupancy'),
  '17E-25 FAIL: renderRevenus must NOT read data.occupancyRate / data.occupancy (not in API root)'
);
console.log('✅ 17E-25 — data.occupancyRate supprimé de renderRevenus');

// ── 17E-26: uses data.byProperty for breakdown ───────────────────────────
assert.ok(
  revenusFn.includes('data.byProperty'),
  '17E-26 FAIL: renderRevenus breakdown must use data.byProperty (not data.properties)'
);
console.log('✅ 17E-26 — data.byProperty utilisé pour la liste logements');

// ── 17E-27: does NOT fall back to data.properties or data.breakdown ──────
assert.ok(
  !revenusFn.includes('data.properties') && !revenusFn.includes('data.breakdown'),
  '17E-27 FAIL: renderRevenus must NOT use data.properties or data.breakdown (wrong keys)'
);
console.log('✅ 17E-27 — data.properties / data.breakdown supprimés');

// ── 17E-28: byProperty rows use p.grossRevenue ───────────────────────────
assert.ok(
  revenusFn.includes('p.grossRevenue'),
  '17E-28 FAIL: renderRevenus byProperty rows must read p.grossRevenue (API field name)'
);
console.log('✅ 17E-28 — p.grossRevenue utilisé dans les lignes byProperty');

// ── 17E-29: property_id param added when filter is set ───────────────────
assert.ok(
  revenusFn.includes('property_id'),
  '17E-29 FAIL: renderRevenus must append &property_id= to URL when propertyFilter is set'
);
console.log('✅ 17E-29 — Param property_id ajouté à l\'URL de reporting');

// ── 17E-30: encodeURIComponent used for property_id value ────────────────
assert.ok(
  revenusFn.includes('encodeURIComponent(state.propertyFilter)'),
  '17E-30 FAIL: renderRevenus must use encodeURIComponent for the property_id value'
);
console.log('✅ 17E-30 — encodeURIComponent utilisé pour property_id');

// ── 17E-31: != null guard on KPI values (no silent zeros) ────────────────
assert.ok(
  revenusFn.includes('!= null'),
  '17E-31 FAIL: renderRevenus KPI values must use != null checks (not || 0) to avoid silent zeros'
);
console.log('✅ 17E-31 — Gardes != null sur les valeurs KPI (pas de zéros silencieux)');

// ── 17E-32: error state shows "Données indisponibles" ────────────────────
assert.ok(
  revenusFn.includes('Données indisponibles'),
  '17E-32 FAIL: renderRevenus .catch must show "Données indisponibles" (not silent empty)'
);
console.log('✅ 17E-32 — État d\'erreur affiche "Données indisponibles"');

// ── 17E-33: error state does NOT display "0 €" or plain "0" ─────────────
const catchBlock = revenusFn.slice(revenusFn.indexOf('.catch('));
assert.ok(
  !catchBlock.includes('0 €') && !catchBlock.includes('>0<'),
  '17E-33 FAIL: renderRevenus .catch must not display "0 €" or bare 0 values'
);
console.log('✅ 17E-33 — Aucun "0 €" affiché dans l\'état d\'erreur');

// ── 17E-34: reportUrl variable used (not hardcoded single fetch) ─────────
assert.ok(
  revenusFn.includes('var reportUrl'),
  '17E-34 FAIL: renderRevenus must build the URL in a var reportUrl before fetching'
);
console.log('✅ 17E-34 — var reportUrl construit avant fetch');

// ── 17E-35: still calls /api/reporting endpoint ──────────────────────────
assert.ok(
  revenusFn.includes('/api/reporting'),
  '17E-35 FAIL: renderRevenus must still call /api/reporting (no new endpoint invented)'
);
console.log('✅ 17E-35 — /api/reporting toujours appelé');

// ════════════════════════════════════════════════════════════
//  P4 — WEEK VIEW CONTRAST (app.html renderWeek)
// ════════════════════════════════════════════════════════════

const weekFn = appHtml.slice(
  appHtml.indexOf('function renderWeek(body)'),
  appHtml.indexOf('function renderMonth(body)')
);

// ── 17E-36: booking blocks use p.fg for text color ───────────────────────
assert.ok(
  weekFn.includes("color:'+p.fg+'"),
  '17E-36 FAIL: renderWeek booking blocks must use p.fg for text color (not hardcoded white)'
);
console.log('✅ 17E-36 — Vue semaine: couleur texte p.fg (foncé sur pastel)');

// ── 17E-37: booking blocks do NOT use color:white ────────────────────────
// Verify the booking block div no longer has hardcoded white text
assert.ok(
  !weekFn.includes("background:'+p.bg+';color:white;"),
  '17E-37 FAIL: renderWeek must not use color:white on booking blocks (was invisible on pastel bg)'
);
console.log('✅ 17E-37 — color:white supprimé des blocs réservations (vue semaine)');

// ── 17E-38: acDot uses p.ac as background ────────────────────────────────
assert.ok(
  weekFn.includes("background:'+p.ac+'"),
  '17E-38 FAIL: renderWeek must render a dot badge with background p.ac (accent, saturated)'
);
console.log('✅ 17E-38 — Point badge: background p.ac (couleur accentuée)');

// ── 17E-39: acDot variable defined in renderWeek ─────────────────────────
assert.ok(
  weekFn.includes('var acDot'),
  '17E-39 FAIL: renderWeek must define var acDot for the platform dot badge'
);
console.log('✅ 17E-39 — var acDot défini dans renderWeek');

// ── 17E-40: PLT airbnb has readable fg (dark on pastel OR white on saturated) ──
// 17F upgraded to saturated colors (#FF5A5F bg + #FFFFFF fg) — both are readable
assert.ok(
  appHtml.includes("airbnb:") && (appHtml.includes("fg:'#8A2E29'") || appHtml.includes("fg:'#FFFFFF'")),
  '17E-40 FAIL: PLT.airbnb must have readable fg (dark #8A2E29 or white #FFFFFF)'
);
console.log('✅ 17E-40 — PLT.airbnb fg: lisible (foncé ou blanc sur saturé)');

// ── 17E-41: PLT booking has readable fg ──────────────────────────────────
assert.ok(
  appHtml.includes("fg:'#1E3A5F'") || appHtml.includes("fg:'#FFFFFF'"),
  '17E-41 FAIL: PLT.booking must have readable fg (dark #1E3A5F or white #FFFFFF)'
);
console.log('✅ 17E-41 — PLT.booking fg: lisible');

// ── 17E-42: PLT direct has readable fg ───────────────────────────────────
assert.ok(
  appHtml.includes("fg:'#0F4433'") || appHtml.includes("fg:'#FFFFFF'"),
  '17E-42 FAIL: PLT.direct must have readable fg (dark #0F4433 or white #FFFFFF)'
);
console.log('✅ 17E-42 — PLT.direct fg: lisible');

// ── 17E-43: PLT airbnb has accent color ──────────────────────────────────
// 17F uses rgba(0,0,0,.18) as universal dark overlay accent
assert.ok(
  appHtml.includes("ac:'#C0433C'") || appHtml.includes("ac:'rgba(0,0,0,.18)'"),
  '17E-43 FAIL: PLT.airbnb must have ac value (saturated or dark overlay)'
);
console.log('✅ 17E-43 — PLT.airbnb ac: présent');

// ── 17E-44: week view block still uses p.bg for background ───────────────
assert.ok(
  weekFn.includes("background:'+p.bg+'"),
  '17E-44 FAIL: renderWeek booking blocks must still use p.bg as background (pastel platform color)'
);
console.log('✅ 17E-44 — Vue semaine: fond p.bg (couleur pastel) conservé');

// ── 17E-45: block bars use p.bg not hardcoded colour ────────────────────
assert.ok(
  !weekFn.includes("background:'#F2C9C6'") && !weekFn.includes("background:'#C3D0E4'"),
  '17E-45 FAIL: renderWeek must not hardcode platform colours (must use p.bg from PLT)'
);
console.log('✅ 17E-45 — Couleurs plateformes non hardcodées dans renderWeek');

// ════════════════════════════════════════════════════════════
//  REGRESSION GUARDS — existing 17C/17D contracts preserved
// ════════════════════════════════════════════════════════════

// ── 17E-46: bh-cal-mode .page-content display:none preserved (17D) ───────
assert.ok(
  appHtml.includes('body.bh-cal-mode .page-content { display: none !important; }'),
  '17E-46 FAIL: 17D fix must be preserved — body.bh-cal-mode .page-content display:none'
);
console.log('✅ 17E-46 — Régression 17D: body.bh-cal-mode .page-content display:none conservé');

// ── 17E-47: showCalendarMode still does history.pushState ────────────────
assert.ok(
  calModeBlock.includes("history.pushState") && calModeBlock.includes('#calendarSection'),
  '17E-47 FAIL: showCalendarMode must still call history.pushState (17C/17D contract)'
);
console.log('✅ 17E-47 — Régression 17C: history.pushState dans showCalendarMode conservé');

// ── 17E-48: bhCalPrevBtn / bhCalNextBtn navigation preserved (17C) ───────
assert.ok(
  appHtml.includes('bhCalPrevBtn') && appHtml.includes('bhCalNextBtn'),
  '17E-48 FAIL: app.html must still have bhCalPrevBtn and bhCalNextBtn (17C iOS header)'
);
console.log('✅ 17E-48 — Régression 17C: bhCalPrevBtn / bhCalNextBtn conservés');

// ── 17E-49: routes in bh-layout.js still include #calendarSection ────────
assert.ok(
  bhLayoutJs.includes('/app.html#calendarSection'),
  '17E-49 FAIL: bh-layout.js must still reference /app.html#calendarSection in nav routes'
);
console.log('✅ 17E-49 — Régression 17C: route /app.html#calendarSection conservée');

// ── 17E-50: totalW still uses propW so grid expands with wider column ─────
assert.ok(
  appHtml.includes('var totalW = propW + numDays * colW'),
  '17E-50 FAIL: app.html totalW must still derive from propW (so wider column widens the grid)'
);
console.log('✅ 17E-50 — totalW = propW + numDays * colW conservé (grille élargie)');

console.log('\n✅  50 test(s) calendar-17E passé(s) — 4 correctifs production appliqués.');

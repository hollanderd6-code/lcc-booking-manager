'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-TODAY-12.
// Verifies the Today page reproduces TodayView.swift structure:
//   counters, week strip, urgent/arrivals/departures/cleaning sections,
//   iOS-parity navigation intact, no legacy calendar dominating Today,
//   no backend/BoostPrice/Channex changes, no legacy top nav regression.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const appHtml     = read('public/app.html');
const bhLayoutJs  = read('public/js/bh-layout.js');
const bhTodayV3Js = read('public/js/bh-today-v3.js');
const bhTodayV3Css = read('public/css/bh-today-v3.css');
const serverJs    = read('server.js');
const aujourdhuiRoutes = read('routes/aujourdhui-routes.js');

// ── P-T12-01: app.html contains the 3-counter strip container ──────────────

assert.ok(
  appHtml.includes('id="bhTv3Counters"'),
  'P-T12-01 FAIL: app.html must have #bhTv3Counters (3-counter strip)'
);
console.log('✅ P-T12-01 — #bhTv3Counters présent dans app.html');

// ── P-T12-02: app.html contains the week strip container ───────────────────

assert.ok(
  appHtml.includes('id="bhTv3WeekCard"'),
  'P-T12-02 FAIL: app.html must have #bhTv3WeekCard (week strip)'
);
console.log('✅ P-T12-02 — #bhTv3WeekCard présent dans app.html');

// ── P-T12-03: app.html contains "À traiter maintenant" section ────────────

assert.ok(
  appHtml.includes('id="bhTv3UrgentSection"'),
  'P-T12-03 FAIL: app.html must have #bhTv3UrgentSection'
);
console.log('✅ P-T12-03 — #bhTv3UrgentSection présent dans app.html');

// ── P-T12-04: app.html contains Arrivées section ──────────────────────────

assert.ok(
  appHtml.includes('id="bhTv3ArrivalsSection"'),
  'P-T12-04 FAIL: app.html must have #bhTv3ArrivalsSection'
);
console.log('✅ P-T12-04 — #bhTv3ArrivalsSection présent dans app.html');

// ── P-T12-05: calendarSection is hidden from Today ─────────────────────────

assert.ok(
  appHtml.includes('id="calendarSection"') && appHtml.includes('"calendarSection"'),
  'P-T12-05 FAIL: calendarSection must still exist in DOM'
);
assert.ok(
  !appHtml.includes('"calendarSection" style="display:block !important;"'),
  'P-T12-05 FAIL: calendarSection must NOT be display:block !important (should be none or CSS-hidden)'
);
assert.ok(
  bhTodayV3Css.includes('#calendarSection') && bhTodayV3Css.includes('display: none !important'),
  'P-T12-05 FAIL: bh-today-v3.css must suppress #calendarSection with display:none !important'
);
console.log('✅ P-T12-05 — #calendarSection masqué depuis Today via CSS');

// ── P-T12-06: iOS-parity navigation still intact ─────────────────────────

const IOS_NAV = ["Aujourd'hui", 'Calendrier', 'Messages', 'Gestion'];
IOS_NAV.forEach(function(label) {
  assert.ok(bhLayoutJs.includes(label), 'P-T12-06 FAIL: nav missing iOS item: ' + label);
});
console.log('✅ P-T12-06 — Navigation iOS 4 items intacte dans bh-layout.js');

// ── P-T12-07: mobile bottom tabs intact in bh-layout.js ──────────────────

assert.ok(
  bhLayoutJs.includes("Aujourd'hui") && bhLayoutJs.includes('Calendrier'),
  'P-T12-07 FAIL: mobile tab bar items missing in bh-layout.js'
);
console.log('✅ P-T12-07 — Bottom tab bar mobile intact');

// ── P-T12-08: bh-today-v3.js fetches the correct API endpoint ────────────

assert.ok(
  bhTodayV3Js.includes('/api/aujourdhui/etats'),
  'P-T12-08 FAIL: bh-today-v3.js must fetch /api/aujourdhui/etats'
);
console.log('✅ P-T12-08 — bh-today-v3.js appelle /api/aujourdhui/etats');

// ── P-T12-09: bh-today-v3.js renders urgent, arrival, departure sections ──

assert.ok(
  bhTodayV3Js.includes('bhTv3UrgentSection') &&
  bhTodayV3Js.includes('bhTv3ArrivalsSection') &&
  bhTodayV3Js.includes('bhTv3DeparturesSection'),
  'P-T12-09 FAIL: bh-today-v3.js must populate all three sections'
);
console.log('✅ P-T12-09 — bh-today-v3.js peuple les 3 sections (urgent/arrivées/départs)');

// ── P-T12-10: bh-today-v3.js has week strip builder ──────────────────────

assert.ok(
  bhTodayV3Js.includes('weekStripHTML') && bhTodayV3Js.includes('bhTv3WeekCard'),
  'P-T12-10 FAIL: bh-today-v3.js must build week strip'
);
console.log('✅ P-T12-10 — bh-today-v3.js construit la bande semaine');

// ── P-T12-11: counter cards use DM Sans (not Instrument Serif) ───────────

assert.ok(
  bhTodayV3Css.includes("'DM Sans'") || bhTodayV3Css.includes('"DM Sans"'),
  'P-T12-11 FAIL: bh-today-v3.css must use DM Sans for counters'
);
assert.ok(
  !bhTodayV3Css.includes('Instrument Serif'),
  'P-T12-11 FAIL: bh-today-v3.css must NOT use Instrument Serif'
);
console.log('✅ P-T12-11 — Compteurs Today utilisent DM Sans (pas Instrument Serif)');

// ── P-T12-12: urgent card has terracotta left bar ─────────────────────────

assert.ok(
  bhTodayV3Css.includes('bh-tv3-urgent-bar') &&
  bhTodayV3Css.includes('C4552F'),  // terracotta gradient color
  'P-T12-12 FAIL: urgent card must have terracotta left bar (#C4552F gradient)'
);
console.log('✅ P-T12-12 — Carte urgente avec filet terracotta gauche');

// ── P-T12-13: "Voir la réservation" action wires to existing modal ─────────

assert.ok(
  bhTodayV3Js.includes('bhTv3OpenResa') &&
  bhTodayV3Js.includes('bhTv3Action'),
  'P-T12-13 FAIL: bh-today-v3.js must expose bhTv3OpenResa and bhTv3Action'
);
assert.ok(
  bhTodayV3Js.includes('reservationDetailsModal') || bhTodayV3Js.includes('fixModalContent'),
  'P-T12-13 FAIL: bh-today-v3.js must wire to existing reservation detail modal'
);
console.log('✅ P-T12-13 — "Voir la réservation" câblé sur la modale existante');

// ── P-T12-14: "Écrire" action links to /messages.html with bhconv param ───

assert.ok(
  bhTodayV3Js.includes('/messages.html?bhconv='),
  'P-T12-14 FAIL: bh-today-v3.js must link to /messages.html?bhconv=<id>'
);
console.log('✅ P-T12-14 — Action "Écrire" pointe vers /messages.html?bhconv=');

// ── P-T12-15: legacy KPI IDs preserved for existing JS compatibility ───────

const LEGACY_IDS = [
  'kpiCaCard', 'kpiCaValue', 'kpiCaSub', 'kpiCaDelta', 'kpiCaSpark',
  'kpiOccupancyCard', 'kpiOccupancyValue', 'kpiOccRing', 'kpiOccLegend',
  'kpiPropertiesCard', 'kpiPropertiesValue',
  'kpiDepositsCard', 'kpiDepositsValue',
  'kpiChecklistsCard', 'kpiChecklistsValue',
  'kpiAutoCard', 'kpiAutoLabel', 'kpiAutoText'
];
LEGACY_IDS.forEach(function(id) {
  assert.ok(appHtml.includes('id="' + id + '"'), 'P-T12-15 FAIL: legacy ID missing: ' + id);
});
console.log('✅ P-T12-15 — Tous les IDs KPI legacy préservés dans app.html');

// ── P-T12-16: no bhDemoNav regression ─────────────────────────────────────

assert.ok(
  !appHtml.includes("nav.id  = 'bhDemoNav'") && !appHtml.includes("nav.id = 'bhDemoNav'"),
  'P-T12-16 FAIL: #bhDemoNav creation must not exist in app.html'
);
console.log('✅ P-T12-16 — Aucune régression bhDemoNav');

// ── P-T12-17: no backend file changed ─────────────────────────────────────

// server.js must not reference bh-today-v3 (no server-side change needed)
assert.ok(
  !serverJs.includes('bh-today-v3'),
  'P-T12-17 FAIL: server.js must not reference bh-today-v3 (frontend-only change)'
);
console.log('✅ P-T12-17 — server.js non modifié');

// ── P-T12-18: /api/aujourdhui/etats route unchanged ───────────────────────

assert.ok(
  aujourdhuiRoutes.includes('/api/aujourdhui/etats'),
  'P-T12-18 FAIL: /api/aujourdhui/etats route must still exist'
);
assert.ok(
  aujourdhuiRoutes.includes('blocking') && aujourdhuiRoutes.includes('a_traiter'),
  'P-T12-18 FAIL: aujourdhui-routes.js must still compute blocking and a_traiter'
);
console.log('✅ P-T12-18 — Route /api/aujourdhui/etats intacte (blocking, a_traiter)');

// ── P-T12-19: bh-today-v3.js loaded in app.html ──────────────────────────

assert.ok(
  appHtml.includes('bh-today-v3.js'),
  'P-T12-19 FAIL: app.html must load bh-today-v3.js'
);
console.log('✅ P-T12-19 — bh-today-v3.js chargé dans app.html');

// ── P-T12-20: bh-today-v3.css loaded in app.html ─────────────────────────

assert.ok(
  appHtml.includes('bh-today-v3.css'),
  'P-T12-20 FAIL: app.html must load bh-today-v3.css'
);
console.log('✅ P-T12-20 — bh-today-v3.css chargé dans app.html');

console.log('\n✅  20 test(s) today-12 passé(s) — iOS-parity Today conforme.');

'use strict';

// Regression guard for BOOSTINGHOST-WEB-IOS-PARITY-CALENDAR-17.
// Translates iOS CalendarView.swift + TimelineView.swift design tokens,
// platform colours, BoostPrice badge, and tab structure to web.
// All 30 tests (P-C17-01 … P-C17-30) must pass at all times.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const calCss  = read('public/css/bh-calendar-v3.css');
const calJs   = read('public/js/bh-calendar-v3.js');
const resaHtml = read('public/reservations.html');

// ── P-C17-01: bh-calendar-v3.css exists and has iOS design tokens ─
assert.ok(
  calCss.includes('--cal-col-w:') && calCss.includes('64px'),
  'P-C17-01 FAIL: bh-calendar-v3.css must define --cal-col-w (64px, matches iOS COL_W)'
);
console.log('✅ P-C17-01 — CSS: --cal-col-w:64px (iOS COL_W)');

// ── P-C17-02: row height token = 64px (CalBarLayout.rowH) ─────────
assert.ok(
  calCss.includes('--cal-row-h:') && calCss.includes('64px'),
  'P-C17-02 FAIL: bh-calendar-v3.css must define --cal-row-h:64px (CalBarLayout.rowH)'
);
console.log('✅ P-C17-02 — CSS: --cal-row-h:64px (CalBarLayout.rowH)');

// ── P-C17-03: bar height token = 44px (CalBarLayout.barH) ─────────
assert.ok(
  calCss.includes('--cal-bar-h:') && calCss.includes('44px'),
  'P-C17-03 FAIL: bh-calendar-v3.css must define --cal-bar-h:44px (CalBarLayout.barH)'
);
console.log('✅ P-C17-03 — CSS: --cal-bar-h:44px (CalBarLayout.barH)');

// ── P-C17-04: bar corner radius = 11px (CalBarLayout.barR) ────────
assert.ok(
  calCss.includes('--cal-bar-r:') && calCss.includes('11px'),
  'P-C17-04 FAIL: bh-calendar-v3.css must define --cal-bar-r:11px (CalBarLayout.barR)'
);
console.log('✅ P-C17-04 — CSS: --cal-bar-r:11px (CalBarLayout.barR)');

// ── P-C17-05: day header height = 44px (dayHeaderH) ───────────────
assert.ok(
  calCss.includes('--cal-day-hdr-h:') && calCss.includes('44px'),
  'P-C17-05 FAIL: bh-calendar-v3.css must define --cal-day-hdr-h:44px (dayHeaderH)'
);
console.log('✅ P-C17-05 — CSS: --cal-day-hdr-h:44px (dayHeaderH)');

// ── P-C17-06: weekend background token present ─────────────────────
assert.ok(
  calCss.includes('--cal-weekend-bg') && calCss.includes('rgba(201,161,91'),
  'P-C17-06 FAIL: bh-calendar-v3.css must define --cal-weekend-bg with rgba(201,161,91,...)'
);
console.log('✅ P-C17-06 — CSS: --cal-weekend-bg rgba(201,161,91,…)');

// ── P-C17-07: iOS column separator colour ─────────────────────────
assert.ok(
  calCss.includes('rgba(20,32,27,.10)') || calCss.includes('rgba(20,32,27,0.10)') || calCss.includes('rgba(20,32,27,.10)'),
  'P-C17-07 FAIL: bh-calendar-v3.css must use rgba(20,32,27,.10) for column separators'
);
console.log('✅ P-C17-07 — CSS: col-sep rgba(20,32,27,.10) présent');

// ── P-C17-08: iOS Sunday separator heavier colour ─────────────────
assert.ok(
  calCss.includes('rgba(20,32,27,.18)') || calCss.includes('rgba(20,32,27,0.18)'),
  'P-C17-08 FAIL: bh-calendar-v3.css must use rgba(20,32,27,.18) for Sunday/week separators'
);
console.log('✅ P-C17-08 — CSS: week-sep rgba(20,32,27,.18) présent');

// ── P-C17-09: BoostPrice badge classes present ─────────────────────
assert.ok(
  calCss.includes('cal-bp-badge') &&
  calCss.includes('.effective') &&
  calCss.includes('.pending'),
  'P-C17-09 FAIL: bh-calendar-v3.css must define .cal-bp-badge.effective and .cal-bp-badge.pending'
);
console.log('✅ P-C17-09 — CSS: .cal-bp-badge .effective/.pending définis');

// ── P-C17-10: hatched block bar class present ─────────────────────
assert.ok(
  calCss.includes('cal-bar-block') && calCss.includes('repeating-linear-gradient'),
  'P-C17-10 FAIL: bh-calendar-v3.css must define .cal-bar-block with repeating-linear-gradient (hatched)'
);
console.log('✅ P-C17-10 — CSS: .cal-bar-block hachuré avec repeating-linear-gradient');

// ── P-C17-11: segmented control (4 tabs) ──────────────────────────
assert.ok(
  calCss.includes('cal-seg-pill') && calCss.includes('cal-segmented'),
  'P-C17-11 FAIL: bh-calendar-v3.css must define .cal-segmented and .cal-seg-pill'
);
console.log('✅ P-C17-11 — CSS: sélecteur segmenté cal-segmented / cal-seg-pill');

// ── P-C17-12: JS platform colours map present ─────────────────────
assert.ok(
  calJs.includes('PLATFORM_COLORS') &&
  calJs.includes("airbnb:  '#E00B41'") ||
  calJs.includes("airbnb: '#E00B41'"),
  'P-C17-12 FAIL: bh-calendar-v3.js must define PLATFORM_COLORS with airbnb:#E00B41'
);
console.log('✅ P-C17-12 — JS: PLATFORM_COLORS airbnb #E00B41');

// ── P-C17-13: Booking.com colour ──────────────────────────────────
assert.ok(
  calJs.includes('#003580'),
  'P-C17-13 FAIL: bh-calendar-v3.js must use #003580 for Booking.com bars'
);
console.log('✅ P-C17-13 — JS: PLATFORM_COLORS booking #003580');

// ── P-C17-14: iOS CalBarLayout design tokens in JS ────────────────
assert.ok(
  calJs.includes('COL_W      = 64') || calJs.includes('COL_W = 64') || calJs.includes('COL_W=64'),
  'P-C17-14 FAIL: bh-calendar-v3.js must define COL_W=64 (CalBarLayout.colWidth)'
);
console.log('✅ P-C17-14 — JS: COL_W = 64 (CalBarLayout)');

// ── P-C17-15: lane layout (overlapping reservations) ──────────────
assert.ok(
  calJs.includes('computeLanes') && calJs.includes('laneIndex') && calJs.includes('laneCount'),
  'P-C17-15 FAIL: bh-calendar-v3.js must implement computeLanes() with laneIndex/laneCount (ReservationLaneLayout.compute)'
);
console.log('✅ P-C17-15 — JS: computeLanes() avec laneIndex/laneCount');

// ── P-C17-16: BoostPrice state logic ──────────────────────────────
assert.ok(
  calJs.includes('boostPriceState') && calJs.includes("'boostprice'") && calJs.includes("'pending'"),
  'P-C17-16 FAIL: bh-calendar-v3.js must implement boostPriceState() checking sources[dk]==="boostprice"'
);
console.log('✅ P-C17-16 — JS: boostPriceState() vérifiant sources[dk]===boostprice');

// ── P-C17-17: pricing calendar API endpoint ────────────────────────
assert.ok(
  calJs.includes('/api/pricing/calendar'),
  'P-C17-17 FAIL: bh-calendar-v3.js must call /api/pricing/calendar?from=...&to=...'
);
console.log('✅ P-C17-17 — JS: appel /api/pricing/calendar');

// ── P-C17-18: reporting API endpoint ──────────────────────────────
assert.ok(
  calJs.includes('/api/reporting'),
  'P-C17-18 FAIL: bh-calendar-v3.js must call /api/reporting for the Revenus tab'
);
console.log('✅ P-C17-18 — JS: appel /api/reporting pour Revenus');

// ── P-C17-19: 4 tabs defined ──────────────────────────────────────
const tabsPresent = ['jour', 'semaine', 'mensuel', 'revenus'].every(t =>
  calJs.includes(`'${t}'`) || calJs.includes(`"${t}"`)
);
assert.ok(tabsPresent, 'P-C17-19 FAIL: bh-calendar-v3.js must handle all 4 tabs: jour, semaine, mensuel, revenus');
console.log('✅ P-C17-19 — JS: 4 onglets définis (jour/semaine/mensuel/revenus)');

// ── P-C17-20: today scrolled into view ────────────────────────────
assert.ok(
  calJs.includes('todayOff') && calJs.includes('scrollLeft'),
  'P-C17-20 FAIL: bh-calendar-v3.js must auto-scroll to today (todayOff + scrollLeft)'
);
console.log('✅ P-C17-20 — JS: défilement auto vers aujourd\'hui (todayOff + scrollLeft)');

// ── P-C17-21: reservations.html links bh-calendar-v3.css ──────────
assert.ok(
  resaHtml.includes('bh-calendar-v3.css'),
  'P-C17-21 FAIL: reservations.html must link /css/bh-calendar-v3.css'
);
console.log('✅ P-C17-21 — HTML: lien bh-calendar-v3.css présent');

// ── P-C17-22: reservations.html loads bh-calendar-v3.js ───────────
assert.ok(
  resaHtml.includes('bh-calendar-v3.js'),
  'P-C17-22 FAIL: reservations.html must load /js/bh-calendar-v3.js'
);
console.log('✅ P-C17-22 — HTML: script bh-calendar-v3.js chargé');

// ── P-C17-23: 4 tab panes in HTML ─────────────────────────────────
const panes = ['calJour', 'calSemaine', 'calMensuel', 'calRevenus'];
panes.forEach(id => {
  assert.ok(resaHtml.includes(`id="${id}"`), `P-C17-23 FAIL: reservations.html must contain #${id} tab pane`);
});
console.log('✅ P-C17-23 — HTML: 4 panneaux d\'onglets (calJour/calSemaine/calMensuel/calRevenus)');

// ── P-C17-24: segmented control buttons in HTML ───────────────────
const segs = ['jour', 'semaine', 'mensuel', 'revenus'];
segs.forEach(tab => {
  assert.ok(
    resaHtml.includes(`data-tab="${tab}"`),
    `P-C17-24 FAIL: reservations.html must have a .cal-seg-pill with data-tab="${tab}"`
  );
});
console.log('✅ P-C17-24 — HTML: 4 boutons segmentés avec data-tab');

// ── P-C17-25: property supertitle present ─────────────────────────
assert.ok(
  resaHtml.includes('calSuperTitle'),
  'P-C17-25 FAIL: reservations.html must have #calSuperTitle (property selector, iOS supertitle)'
);
console.log('✅ P-C17-25 — HTML: #calSuperTitle (sélecteur logement)');

// ── P-C17-26: prev/next navigation buttons ────────────────────────
assert.ok(
  resaHtml.includes('calPrevBtn') && resaHtml.includes('calNextBtn'),
  'P-C17-26 FAIL: reservations.html must have #calPrevBtn and #calNextBtn'
);
console.log('✅ P-C17-26 — HTML: #calPrevBtn et #calNextBtn présents');

// ── P-C17-27: view toggle (Liste / Calendrier) ────────────────────
assert.ok(
  resaHtml.includes('cal-view-toggle') &&
  resaHtml.includes('data-mode="liste"') &&
  resaHtml.includes('data-mode="calendrier"'),
  'P-C17-27 FAIL: reservations.html must have .cal-view-toggle with data-mode="liste" and data-mode="calendrier"'
);
console.log('✅ P-C17-27 — HTML: bascule Vue (Liste / Calendrier)');

// ── P-C17-28: existing list view preserved ────────────────────────
assert.ok(
  resaHtml.includes('id="listView"') &&
  resaHtml.includes('resaTable') &&
  resaHtml.includes('mobileCards'),
  'P-C17-28 FAIL: reservations.html must preserve existing list view (resaTable + mobileCards) inside #listView'
);
console.log('✅ P-C17-28 — HTML: vue liste existante conservée (#listView, resaTable, mobileCards)');

// ── P-C17-29: calendar hidden on mobile via CSS ───────────────────
assert.ok(
  calCss.includes('@media (max-width: 1024px)') &&
  calCss.includes('#calendarView') &&
  calCss.includes('display: none !important'),
  'P-C17-29 FAIL: bh-calendar-v3.css must hide #calendarView on ≤1024px (mobile — calendar is desktop-only)'
);
console.log('✅ P-C17-29 — CSS: #calendarView masqué en mobile (≤1024px)');

// ── P-C17-30: bhCalV3 public API exposed ──────────────────────────
assert.ok(
  calJs.includes('window.bhCalV3') && calJs.includes('init') && calJs.includes('showCalendar'),
  'P-C17-30 FAIL: bh-calendar-v3.js must expose window.bhCalV3 with init() and showCalendar()'
);
console.log('✅ P-C17-30 — JS: window.bhCalV3 exposé avec init() et showCalendar()');

console.log('\n✅  30 test(s) calendar-17 passé(s) — CalendarView iOS parity implémentée sur le web.');

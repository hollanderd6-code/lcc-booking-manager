'use strict';

// Regression guard for BOOSTINGHOST-WEB-CALENDAR-17F — TRUE IOS VISUAL PARITY.
// Verifies: white backgrounds, saturated iOS platform colors, legend removal,
// overflow:clip fix, property column geometry, and all 17E regressions preserved.
// All 63 tests (17F-01 … 17F-63) must pass at all times.

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const calCss   = read('public/css/bh-calendar-v3.css');
const calJs    = read('public/js/bh-calendar-v3.js');
const nativeBg = read('public/css/bh-native-bg.css');
const appHtml  = read('public/app.html');
const layoutJs = read('public/js/bh-layout.js');

// ─────────────────────────────────────────────────────────────────────────────
// CSS — WHITE BACKGROUNDS (17F-01 … 17F-07)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-01: calendarSection background white ──────────────────────────────
assert.ok(
  calCss.includes('body.bh-cal-mode #calendarSection') &&
  calCss.includes('background: #FFFFFF !important'),
  '17F-01 FAIL: bh-calendar-v3.css must set background:#FFFFFF on body.bh-cal-mode #calendarSection'
);
console.log('✅ 17F-01 — CSS: calendarSection background: #FFFFFF (white)');

// ── 17F-02: main-content background white ────────────────────────────────
assert.ok(
  calCss.includes('body.bh-cal-mode main.main-content') &&
  (calCss.match(/body\.bh-cal-mode main\.main-content[\s\S]{0,60}background: #FFFFFF/)||[]).length > 0,
  '17F-02 FAIL: bh-calendar-v3.css must set background:#FFFFFF on body.bh-cal-mode main.main-content'
);
console.log('✅ 17F-02 — CSS: main-content background: #FFFFFF (white)');

// ── 17F-03: bh-prop-cell background white ────────────────────────────────
assert.ok(
  calCss.includes('#bhCalRoot .bh-prop-cell') &&
  (calCss.match(/#bhCalRoot \.bh-prop-cell[\s\S]{0,120}background: #FFFFFF/)||[]).length > 0,
  '17F-03 FAIL: bh-calendar-v3.css must set background:#FFFFFF on #bhCalRoot .bh-prop-cell'
);
console.log('✅ 17F-03 — CSS: .bh-prop-cell background: #FFFFFF (white)');

// ── 17F-04: bhMonthOuter background white ────────────────────────────────
assert.ok(
  calCss.includes('#bhMonthOuter') &&
  (calCss.match(/#bhMonthOuter[\s\S]{0,60}background: #FFFFFF/)||[]).length > 0,
  '17F-04 FAIL: bh-calendar-v3.css must set background:#FFFFFF on #bhMonthOuter'
);
console.log('✅ 17F-04 — CSS: #bhMonthOuter background: #FFFFFF (white)');

// ── 17F-05: bh-cal-mode #calendarSection selector present ────────────────
assert.ok(
  calCss.includes('body.bh-cal-mode #calendarSection'),
  '17F-05 FAIL: bh-calendar-v3.css must keep body.bh-cal-mode #calendarSection rule'
);
console.log('✅ 17F-05 — CSS: body.bh-cal-mode #calendarSection règle présente');

// ── 17F-06: iOS day cell border colours preserved ─────────────────────────
assert.ok(
  calCss.includes('#bhCalRoot .bh-day-cell') &&
  calCss.includes('rgba(20,32,27,.10)'),
  '17F-06 FAIL: bh-calendar-v3.css must keep #bhCalRoot .bh-day-cell with rgba(20,32,27,.10)'
);
console.log('✅ 17F-06 — CSS: #bhCalRoot .bh-day-cell border rgba(20,32,27,.10) préservé');

// ── 17F-07: booking-block border-radius 11px preserved ───────────────────
assert.ok(
  calCss.includes('#bhCalRoot .booking-block-bh') &&
  calCss.includes('border-radius: 11px'),
  '17F-07 FAIL: bh-calendar-v3.css must keep .booking-block-bh border-radius:11px'
);
console.log('✅ 17F-07 — CSS: .booking-block-bh border-radius:11px préservé');

// ─────────────────────────────────────────────────────────────────────────────
// CSS — bh-native-bg.css WARM GRADIENT PRESERVED (17F-08 … 17F-09)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-08: bh-native-bg.css warm gradient on body still present ──────────
assert.ok(
  nativeBg.includes('linear-gradient') &&
  nativeBg.includes('#F5F2EA') &&
  nativeBg.includes('background-attachment: fixed'),
  '17F-08 FAIL: bh-native-bg.css must still define the warm gradient on body (not removed)'
);
console.log('✅ 17F-08 — CSS: bh-native-bg.css dégradé chaud préservé (body)');

// ── 17F-09: bh-native-bg.css transparent containers still present ─────────
assert.ok(
  nativeBg.includes('background: transparent !important') &&
  nativeBg.includes('.app-container'),
  '17F-09 FAIL: bh-native-bg.css must still make containers transparent'
);
console.log('✅ 17F-09 — CSS: bh-native-bg.css conteneurs transparents préservés');

// ─────────────────────────────────────────────────────────────────────────────
// OVERFLOW: CLIP FIX (17F-10 … 17F-12)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-10: overflow: clip in body.bh-cal-mode #calendarSection ───────────
assert.ok(
  appHtml.includes('overflow: clip !important'),
  '17F-10 FAIL: app.html must use overflow: clip !important in bh-cal-mode #calendarSection'
);
console.log('✅ 17F-10 — HTML: overflow: clip !important (17E hack remplacé)');

// ── 17F-11: old overflow: visible NOT in bh-cal-mode calendarSection ──────
const calSecBlock = appHtml.match(/body\.bh-cal-mode #calendarSection\s*\{([^}]+)\}/);
assert.ok(
  calSecBlock && !calSecBlock[1].includes('overflow: visible'),
  '17F-11 FAIL: body.bh-cal-mode #calendarSection must NOT have overflow: visible'
);
console.log('✅ 17F-11 — HTML: overflow: visible absent de bh-cal-mode #calendarSection');

// ── 17F-12: iOS scroll fix (bh-fix-app-container) still present ──────────
assert.ok(
  appHtml.includes('bh-fix-app-container') &&
  appHtml.includes("overflow:visible !important;height:auto !important"),
  '17F-12 FAIL: app.html must keep bh-fix-app-container scroll fix for iOS'
);
console.log('✅ 17F-12 — HTML: bh-fix-app-container iOS scroll fix préservé');

// ─────────────────────────────────────────────────────────────────────────────
// PLT — SATURATED IOS PLATFORM COLORS (17F-13 … 17F-32)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-13: PLT airbnb bg = '#FF5A5F' ────────────────────────────────────
assert.ok(
  appHtml.includes("airbnb:            { bg:'#FF5A5F'") ||
  appHtml.includes("airbnb: { bg:'#FF5A5F'") ||
  appHtml.includes("airbnb:{bg:'#FF5A5F'"),
  '17F-13 FAIL: PLT airbnb bg must be #FF5A5F (iOS Airbnb coral)'
);
console.log('✅ 17F-13 — JS: PLT airbnb bg:#FF5A5F (Airbnb coral iOS)');

// ── 17F-14: PLT airbnb fg = '#FFFFFF' ────────────────────────────────────
assert.ok(
  (appHtml.match(/airbnb:.*fg:'#FFFFFF'/)||[]).length > 0,
  '17F-14 FAIL: PLT airbnb fg must be #FFFFFF (white text on saturated bg)'
);
console.log('✅ 17F-14 — JS: PLT airbnb fg:#FFFFFF');

// ── 17F-15: PLT booking bg = '#003580' ───────────────────────────────────
assert.ok(
  appHtml.includes("booking:           { bg:'#003580'") ||
  appHtml.includes("booking: { bg:'#003580'") ||
  appHtml.includes("bg:'#003580'"),
  '17F-15 FAIL: PLT booking bg must be #003580 (iOS Booking.com deep blue)'
);
console.log('✅ 17F-15 — JS: PLT booking bg:#003580 (Booking.com bleu iOS)');

// ── 17F-16: PLT booking fg = '#FFFFFF' ───────────────────────────────────
assert.ok(
  (appHtml.match(/booking:.*fg:'#FFFFFF'/)||[]).length > 0,
  '17F-16 FAIL: PLT booking fg must be #FFFFFF'
);
console.log('✅ 17F-16 — JS: PLT booking fg:#FFFFFF');

// ── 17F-17: PLT direct bg = '#0E3B2E' ────────────────────────────────────
assert.ok(
  (appHtml.match(/direct:.*bg:'#0E3B2E'/)||[]).length > 0,
  '17F-17 FAIL: PLT direct bg must be #0E3B2E (iOS Direct deep green)'
);
console.log('✅ 17F-17 — JS: PLT direct bg:#0E3B2E (vert profond iOS)');

// ── 17F-18: PLT direct fg = '#FFFFFF' ────────────────────────────────────
assert.ok(
  (appHtml.match(/direct:.*fg:'#FFFFFF'/)||[]).length > 0,
  '17F-18 FAIL: PLT direct fg must be #FFFFFF'
);
console.log('✅ 17F-18 — JS: PLT direct fg:#FFFFFF');

// ── 17F-19: PLT bdc bg = '#003580' (alias booking) ───────────────────────
assert.ok(
  (appHtml.match(/bdc:.*bg:'#003580'/)||[]).length > 0,
  '17F-19 FAIL: PLT bdc (Booking.com alias) bg must be #003580'
);
console.log('✅ 17F-19 — JS: PLT bdc bg:#003580 (alias booking)');

// ── 17F-20: PLT manuel bg = '#0E3B2E' (alias direct) ────────────────────
assert.ok(
  (appHtml.match(/manuel:.*bg:'#0E3B2E'/)||[]).length > 0,
  '17F-20 FAIL: PLT manuel (direct alias) bg must be #0E3B2E'
);
console.log('✅ 17F-20 — JS: PLT manuel bg:#0E3B2E (alias direct)');

// ── 17F-21: PLT abritel bg = '#2E86B0' ───────────────────────────────────
assert.ok(
  appHtml.includes("bg:'#2E86B0'"),
  '17F-21 FAIL: PLT abritel bg must be #2E86B0'
);
console.log('✅ 17F-21 — JS: PLT abritel bg:#2E86B0');

// ── 17F-22: PLT expedia bg = '#F97316' ───────────────────────────────────
assert.ok(
  appHtml.includes("bg:'#F97316'"),
  '17F-22 FAIL: PLT expedia bg must be #F97316'
);
console.log('✅ 17F-22 — JS: PLT expedia bg:#F97316');

// ── 17F-23: PLT vrbo bg = '#2E6BB0' ──────────────────────────────────────
assert.ok(
  appHtml.includes("bg:'#2E6BB0'"),
  '17F-23 FAIL: PLT vrbo bg must be #2E6BB0'
);
console.log('✅ 17F-23 — JS: PLT vrbo bg:#2E6BB0');

// ── 17F-24: PLT gites bg = '#2E7D32' ─────────────────────────────────────
assert.ok(
  appHtml.includes("bg:'#2E7D32'"),
  '17F-24 FAIL: PLT gites bg must be #2E7D32'
);
console.log('✅ 17F-24 — JS: PLT gites bg:#2E7D32');

// ── 17F-25: PLT guest_app bg = '#C2410C' ─────────────────────────────────
assert.ok(
  (appHtml.match(/guest_app:.*bg:'#C2410C'/)||[]).length > 0,
  '17F-25 FAIL: PLT guest_app bg must be #C2410C'
);
console.log('✅ 17F-25 — JS: PLT guest_app bg:#C2410C');

// ── 17F-26: PLT bhguest bg = '#C2410C' ───────────────────────────────────
assert.ok(
  (appHtml.match(/bhguest:.*bg:'#C2410C'/)||[]).length > 0,
  '17F-26 FAIL: PLT bhguest bg must be #C2410C'
);
console.log('✅ 17F-26 — JS: PLT bhguest bg:#C2410C');

// ── 17F-27: pastel Airbnb (#F2C9C6) removed from PLT ─────────────────────
assert.ok(
  !appHtml.includes("'#F2C9C6'"),
  '17F-27 FAIL: PLT pastel Airbnb #F2C9C6 must be replaced (use #FF5A5F)'
);
console.log('✅ 17F-27 — JS: PLT pastel #F2C9C6 supprimé (remplacé par saturé)');

// ── 17F-28: pastel Booking (#C3D0E4) removed from PLT ────────────────────
assert.ok(
  !appHtml.includes("'#C3D0E4'"),
  '17F-28 FAIL: PLT pastel Booking #C3D0E4 must be replaced (use #003580)'
);
console.log('✅ 17F-28 — JS: PLT pastel #C3D0E4 supprimé');

// ── 17F-29: pastel Direct (#BFD8CC) removed from PLT ─────────────────────
assert.ok(
  !appHtml.includes("'#BFD8CC'"),
  '17F-29 FAIL: PLT pastel Direct #BFD8CC must be replaced (use #0E3B2E)'
);
console.log('✅ 17F-29 — JS: PLT pastel #BFD8CC supprimé');

// ── 17F-30: PLT white fg across all entries (at least 8 occurrences) ─────
const whiteFgCount = (appHtml.match(/fg:'#FFFFFF'/g)||[]).length;
assert.ok(
  whiteFgCount >= 8,
  '17F-30 FAIL: PLT must have fg:#FFFFFF on all entries (found '+whiteFgCount+', need >= 8)'
);
console.log('✅ 17F-30 — JS: PLT fg:#FFFFFF sur toutes les entrées ('+whiteFgCount+' occurrences)');

// ── 17F-31: old dark Airbnb fg (#8A2E29) removed ─────────────────────────
assert.ok(
  !appHtml.includes("'#8A2E29'"),
  '17F-31 FAIL: Old dark Airbnb fg #8A2E29 must be removed from PLT'
);
console.log('✅ 17F-31 — JS: fg sombre #8A2E29 (Airbnb) supprimé');

// ── 17F-32: old dark Booking fg (#1E3A5F) removed ────────────────────────
assert.ok(
  !appHtml.includes("'#1E3A5F'"),
  '17F-32 FAIL: Old dark Booking fg #1E3A5F must be removed from PLT'
);
console.log('✅ 17F-32 — JS: fg sombre #1E3A5F (Booking) supprimé');

// ─────────────────────────────────────────────────────────────────────────────
// NAV LEGEND REMOVED (17F-33 … 17F-35)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-33: bh-cal-legend class NOT in app.html ───────────────────────────
assert.ok(
  !appHtml.includes("'bh-cal-legend'") && !appHtml.includes('"bh-cal-legend"'),
  '17F-33 FAIL: bh-cal-legend must be removed from renderNav() (causes extra row height)'
);
console.log('✅ 17F-33 — JS: bh-cal-legend supprimé de renderNav()');

// ── 17F-34: renderNav background uses white (not warm beige) ─────────────
assert.ok(
  appHtml.includes('background:rgba(255,255,255,.9);border-bottom:1px solid rgba(200,184,154,.25)'),
  '17F-34 FAIL: renderNav background must be rgba(255,255,255,.9) (white, not beige)'
);
console.log('✅ 17F-34 — JS: renderNav background rgba(255,255,255,.9) (fond blanc)');

// ── 17F-35: getPeriodLabel still defined ─────────────────────────────────
assert.ok(
  appHtml.includes('function getPeriodLabel'),
  '17F-35 FAIL: getPeriodLabel must still be defined (nav not broken)'
);
console.log('✅ 17F-35 — JS: getPeriodLabel() toujours défini');

// ─────────────────────────────────────────────────────────────────────────────
// HEADER BACKGROUND WHITE (17F-36 … 17F-37)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-36: renderHeader background #FFFFFF ───────────────────────────────
assert.ok(
  appHtml.includes("var hdr = div('background:#FFFFFF;border-radius:16px 16px 0 0;"),
  '17F-36 FAIL: renderHeader() must use background:#FFFFFF (not var(--bh-creme))'
);
console.log('✅ 17F-36 — JS: renderHeader() background:#FFFFFF');

// ── 17F-37: renderHeader border-bottom still present ─────────────────────
assert.ok(
  appHtml.includes("border-bottom:1px solid rgba(200,184,154,.35)"),
  '17F-37 FAIL: renderHeader border-bottom must be preserved'
);
console.log('✅ 17F-37 — JS: renderHeader border-bottom préservé');

// ─────────────────────────────────────────────────────────────────────────────
// MONTH VIEW — WHITE GEOMETRY (17F-38 … 17F-44)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-38: corner cell background #FFFFFF ────────────────────────────────
assert.ok(
  appHtml.includes("background:#FFFFFF;border-right:2px solid #DDD9D3;border-bottom:2px solid #E8E4DF;"),
  '17F-38 FAIL: renderMonth corner cell must use background:#FFFFFF'
);
console.log('✅ 17F-38 — JS: renderMonth cellule coin background:#FFFFFF');

// ── 17F-39: property cell (bh-prop-cell) background #FFFFFF ──────────────
assert.ok(
  appHtml.includes("background:#FFFFFF;border-right:2px solid #DDD9D3;border-bottom:1px solid #EEEBE6;"),
  '17F-39 FAIL: renderMonth property cell must use background:#FFFFFF'
);
console.log('✅ 17F-39 — JS: renderMonth bh-prop-cell background:#FFFFFF');

// ── 17F-40: property cell box-shadow uses #FFFFFF ────────────────────────
assert.ok(
  appHtml.includes("box-shadow:4px 0 0 0 #FFFFFF"),
  '17F-40 FAIL: renderMonth property cell box-shadow must use #FFFFFF (was #FAFAF9)'
);
console.log('✅ 17F-40 — JS: bh-prop-cell box-shadow 4px 0 0 0 #FFFFFF');

// ── 17F-41: property cell font-size 13px ─────────────────────────────────
assert.ok(
  appHtml.includes("font-size:13px;font-weight:600;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"),
  '17F-41 FAIL: renderMonth property label must use font-size:13px (was 11px)'
);
console.log('✅ 17F-41 — JS: bh-prop-cell label font-size:13px');

// ── 17F-42: old 11px font-size NOT in property cell ──────────────────────
assert.ok(
  !appHtml.includes("font-size:11px;font-weight:600;color:#374151;white-space:nowrap"),
  '17F-42 FAIL: old font-size:11px must be replaced with 13px in property cell'
);
console.log('✅ 17F-42 — JS: font-size:11px (ancien) supprimé de bh-prop-cell');

// ── 17F-43: footer corner background #FFFFFF ─────────────────────────────
assert.ok(
  appHtml.includes("background:#FFFFFF;border-right:2px solid #DDD9D3;border-top:2px solid #E8E4DF;"),
  '17F-43 FAIL: renderMonth footer corner must use background:#FFFFFF'
);
console.log('✅ 17F-43 — JS: renderMonth cellule footer background:#FFFFFF');

// ── 17F-44: propW >= 140 (not reverted) ──────────────────────────────────
const propWMatch = appHtml.match(/var propW = (\d+)/);
assert.ok(
  propWMatch && parseInt(propWMatch[1]) >= 140,
  '17F-44 FAIL: propW must be >= 140 (iOS --cal-label-w, 17E geometry preserved)'
);
console.log('✅ 17F-44 — JS: propW = '+( propWMatch ? propWMatch[1] : '?')+' (>= 140)');

// ─────────────────────────────────────────────────────────────────────────────
// WEEK VIEW — WHITE (17F-45 … 17F-47)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-45: week view property cell background #FFFFFF ───────────────────
assert.ok(
  appHtml.includes("padding:10px 8px;background:#FFFFFF;border-right:1px solid #E5E7EB;display:flex;align-items:center;"),
  '17F-45 FAIL: renderWeek property cell must use background:#FFFFFF'
);
console.log('✅ 17F-45 — JS: renderWeek propCell background:#FFFFFF');

// ── 17F-46: week view container background white ─────────────────────────
assert.ok(
  appHtml.includes("div('background:white;overflow:hidden;')"),
  '17F-46 FAIL: renderWeek container must use background:white'
);
console.log('✅ 17F-46 — JS: renderWeek conteneur background:white');

// ── 17F-47: week view booking bar uses platform bg color ─────────────────
assert.ok(
  appHtml.includes("background:'+p.bg+';color:'+p.fg+'"),
  '17F-47 FAIL: renderWeek booking bar must use p.bg/p.fg from PLT'
);
console.log('✅ 17F-47 — JS: renderWeek barre réservation utilise p.bg / p.fg');

// ─────────────────────────────────────────────────────────────────────────────
// 17E REGRESSIONS PRESERVED (17F-48 … 17F-63)
// ─────────────────────────────────────────────────────────────────────────────

// ── 17F-48: window.bhCalV3 still exposed in bh-calendar-v3.js ────────────
assert.ok(
  calJs.includes('window.bhCalV3') && calJs.includes('showCalendar'),
  '17F-48 FAIL: bh-calendar-v3.js must still expose window.bhCalV3 with showCalendar'
);
console.log('✅ 17F-48 — JS: window.bhCalV3.showCalendar() exposé (bh-calendar-v3.js)');

// ── 17F-49: showCalendarMode still defined ────────────────────────────────
assert.ok(
  appHtml.includes('function showCalendarMode'),
  '17F-49 FAIL: showCalendarMode must still be defined'
);
console.log('✅ 17F-49 — JS: showCalendarMode() défini');

// ── 17F-50: showTodayMode still defined ──────────────────────────────────
assert.ok(
  appHtml.includes('function showTodayMode'),
  '17F-50 FAIL: showTodayMode must still be defined'
);
console.log('✅ 17F-50 — JS: showTodayMode() défini');

// ── 17F-51: bhUpdateRailActive in bh-layout.js ───────────────────────────
assert.ok(
  layoutJs.includes('window.bhUpdateRailActive'),
  '17F-51 FAIL: bh-layout.js must expose window.bhUpdateRailActive (17E nav fix)'
);
console.log('✅ 17F-51 — JS: window.bhUpdateRailActive dans bh-layout.js');

// ── 17F-52: renderRevenus uses data.summary (17E fix preserved) ───────────
assert.ok(
  appHtml.includes('data.summary || {}'),
  '17F-52 FAIL: renderRevenus must use data.summary (17E KPI mapping fix)'
);
console.log('✅ 17F-52 — JS: renderRevenus data.summary préservé (17E)');

// ── 17F-53: prev/next navigation buttons still in app.html ───────────────
assert.ok(
  appHtml.includes('bhCalPrevBtn') && appHtml.includes('bhCalNextBtn'),
  '17F-53 FAIL: bhCalPrevBtn and bhCalNextBtn must still be present'
);
console.log('✅ 17F-53 — HTML: bhCalPrevBtn + bhCalNextBtn présents');

// ── 17F-54: bhCalSuperTitle still present ────────────────────────────────
assert.ok(
  appHtml.includes('bhCalSuperTitle'),
  '17F-54 FAIL: bhCalSuperTitle must still be present'
);
console.log('✅ 17F-54 — HTML: bhCalSuperTitle présent');

// ── 17F-55: bh-ios-seg segmented control still present ───────────────────
assert.ok(
  appHtml.includes('bh-ios-seg'),
  '17F-55 FAIL: bh-ios-seg segmented control must still be present'
);
console.log('✅ 17F-55 — HTML: bh-ios-seg présent');

// ── 17F-56: bhMonthOuter id still defined ────────────────────────────────
assert.ok(
  appHtml.includes("outer.id = 'bhMonthOuter'"),
  '17F-56 FAIL: bhMonthOuter id must still be assigned in renderMonth'
);
console.log('✅ 17F-56 — JS: outer.id = bhMonthOuter défini');

// ── 17F-57: calendar data API endpoint still called ──────────────────────
assert.ok(
  appHtml.includes('/api/reservations') && appHtml.includes('loadCalendarData'),
  '17F-57 FAIL: /api/reservations and loadCalendarData must still be present'
);
console.log('✅ 17F-57 — JS: /api/reservations + loadCalendarData présents');

// ── 17F-58: computeLanes still present in bh-calendar-v3.js ──────────────
assert.ok(
  calJs.includes('computeLanes'),
  '17F-58 FAIL: computeLanes must still be present in bh-calendar-v3.js'
);
console.log('✅ 17F-58 — JS: computeLanes() présent (bh-calendar-v3.js)');

// ── 17F-59: COL_W = 64 still present (iOS token preserved) ──────────────
assert.ok(
  appHtml.includes('COL_W      = 64') || appHtml.includes('COL_W = 64') || appHtml.includes('colW  = 64') || appHtml.includes('colW = 64'),
  '17F-59 FAIL: COL_W/colW = 64 must still be defined (iOS CalBarLayout token)'
);
console.log('✅ 17F-59 — JS: COL_W / colW = 64 préservé (token iOS)');

// ── 17F-60: bh-cal-mode .page-content display:none preserved ─────────────
assert.ok(
  appHtml.includes('body.bh-cal-mode .page-content') &&
  appHtml.includes('display: none !important'),
  '17F-60 FAIL: body.bh-cal-mode .page-content { display:none } must be preserved'
);
console.log('✅ 17F-60 — CSS: body.bh-cal-mode .page-content display:none préservé');

// ── 17F-61: history.pushState in showCalendarMode ────────────────────────
assert.ok(
  appHtml.includes('history.pushState') && appHtml.includes('showCalendarMode'),
  '17F-61 FAIL: showCalendarMode must still use history.pushState'
);
console.log('✅ 17F-61 — JS: history.pushState dans showCalendarMode()');

// ── 17F-62: renderWeek function still defined ─────────────────────────────
assert.ok(
  appHtml.includes('function renderWeek'),
  '17F-62 FAIL: renderWeek must still be defined'
);
console.log('✅ 17F-62 — JS: renderWeek() défini');

// ── 17F-63: 4 view tabs still defined in app.html ────────────────────────
const tabsOk = ["'day'", "'week'", "'month'", "'revenus'"].every(t => appHtml.includes(t));
assert.ok(
  tabsOk,
  '17F-63 FAIL: all 4 view tabs (day/week/month/revenus) must still be defined in app.html'
);
console.log('✅ 17F-63 — JS: 4 onglets (day/week/month/revenus) définis dans app.html');

console.log('\n✅  63 test(s) calendar-17F passé(s) — True iOS visual parity implémentée.');

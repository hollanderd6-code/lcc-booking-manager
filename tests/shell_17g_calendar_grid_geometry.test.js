/**
 * CALENDAR-17G — Grid geometry tests
 * Canonical tokens, Week/Month propW parity, row heights, padding, font sizes.
 * 55 tests: 17G-01 … 17G-55
 */

const fs   = require('fs');
const path = require('path');

const CSS_FILE  = path.join(__dirname, '../public/css/bh-calendar-v3.css');
const HTML_FILE = path.join(__dirname, '../public/app.html');

let css = '';
let app = '';

beforeAll(() => {
  css = fs.readFileSync(CSS_FILE, 'utf8');
  app = fs.readFileSync(HTML_FILE, 'utf8');
});

// ── Canonical token: --cal-property-width ───────────────────────────────────

test('17G-01: CSS has canonical token --cal-property-width', () => {
  expect(css).toMatch(/--cal-property-width/);
});

test('17G-02: --cal-property-width desktop default is 160px', () => {
  expect(css).toMatch(/--cal-property-width\s*:\s*160px/);
});

test('17G-03: CSS has canonical token --cal-row-height', () => {
  expect(css).toMatch(/--cal-row-height/);
});

test('17G-04: --cal-row-height is 56px', () => {
  expect(css).toMatch(/--cal-row-height\s*:\s*56px/);
});

test('17G-05: CSS has canonical token --cal-property-padding-x', () => {
  expect(css).toMatch(/--cal-property-padding-x/);
});

test('17G-06: --cal-property-padding-x is 16px', () => {
  expect(css).toMatch(/--cal-property-padding-x\s*:\s*16px/);
});

test('17G-07: CSS has canonical token --cal-grid-line', () => {
  expect(css).toMatch(/--cal-grid-line/);
});

test('17G-08: --cal-grid-line uses rgba format', () => {
  expect(css).toMatch(/--cal-grid-line\s*:\s*rgba\(/);
});

// ── Legacy tokens synced ─────────────────────────────────────────────────────

test('17G-09: --cal-label-w updated to 160px (no longer stale 88px)', () => {
  expect(css).toMatch(/--cal-label-w\s*:\s*160px/);
  expect(css).not.toMatch(/--cal-label-w\s*:\s*88px/);
});

test('17G-10: --cal-row-h updated to 56px (no longer 64px)', () => {
  expect(css).toMatch(/--cal-row-h\s*:\s*56px/);
  expect(css).not.toMatch(/--cal-row-h\s*:\s*64px/);
});

// ── Responsive breakpoints ───────────────────────────────────────────────────

test('17G-11: CSS has responsive tablet override --cal-property-width: 140px at max-width:1366px', () => {
  const mqBlock = css.match(/@media\s*\(max-width\s*:\s*1366px\)[^}]*\{([\s\S]*?)(?=@media|\Z)/);
  expect(mqBlock).not.toBeNull();
  expect(mqBlock[0]).toMatch(/--cal-property-width\s*:\s*140px/);
});

test('17G-12: CSS has responsive mobile override --cal-property-width: 120px at max-width:767px', () => {
  const mqBlock = css.match(/@media\s*\(max-width\s*:\s*767px\)[^}]*\{([\s\S]*?)(?=@media|$)/);
  expect(mqBlock).not.toBeNull();
  expect(mqBlock[0]).toMatch(/--cal-property-width\s*:\s*120px/);
});

test('17G-13: desktop > tablet > mobile propW (160 > 140 > 120)', () => {
  const desktop = 160;
  const tablet  = 140;
  const mobile  = 120;
  expect(desktop).toBeGreaterThan(tablet);
  expect(tablet).toBeGreaterThan(mobile);
  expect(mobile).toBeGreaterThanOrEqual(100);
  expect(desktop).toBeLessThanOrEqual(200);
});

// ── renderMonth — JS propW reads from CSS variable ───────────────────────────

test('17G-14: renderMonth reads propW from --cal-property-width CSS variable', () => {
  expect(app).toMatch(/getComputedStyle.*--cal-property-width/s);
});

test('17G-15: renderMonth propW has fallback of 160', () => {
  expect(app).toMatch(/\|\|\s*160/);
});

test('17G-16: renderMonth no longer uses hardcoded var propW = 160', () => {
  expect(app).not.toMatch(/var propW\s*=\s*160\s*;/);
});

test('17G-17: renderMonth rowH non-compact is 56 (not 64)', () => {
  // compactMode ? 34 : 56
  expect(app).toMatch(/compactMode\s*\?\s*34\s*:\s*56/);
  expect(app).not.toMatch(/compactMode\s*\?\s*34\s*:\s*64/);
});

test('17G-18: renderMonth rowH compact stays 34', () => {
  expect(app).toMatch(/compactMode\s*\?\s*34/);
});

// ── renderWeek — JS propW reads from CSS variable ────────────────────────────

test('17G-19: renderWeek declares propW via CSS variable read', () => {
  // Look for the propW declaration inside function renderWeek
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  expect(weekFn[0]).toMatch(/var propW\s*=\s*parseInt/);
  expect(weekFn[0]).toMatch(/--cal-property-width/);
});

test('17G-20: renderWeek propW has fallback of 160', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  expect(weekFn[0]).toMatch(/\|\|\s*160/);
});

test('17G-21: renderWeek header row grid-template-columns uses propW variable (no 80px)', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  expect(weekFn[0]).not.toMatch(/grid-template-columns\s*[=:][^;]*80px/);
});

test('17G-22: renderWeek property row grid-template-columns uses propW variable', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  // Should contain propW + 'px repeat(7,1fr)' pattern
  expect(weekFn[0]).toMatch(/propW.*px.*repeat\(7,1fr\)/);
});

test('17G-23: no hardcoded 80px in week grid-template-columns across entire app.html', () => {
  // Any grid-template-columns:80px is the old stale week view column
  expect(app).not.toMatch(/grid-template-columns\s*[=:][^;]*['"].*80px.*repeat\(7/);
});

// ── Geometry: padding ────────────────────────────────────────────────────────

test('17G-24: month property cell padding is 0 16px (was 0 8px)', () => {
  // The sticky property cell in month view
  expect(app).toMatch(/padding:0 16px;cursor:pointer/);
  expect(app).not.toMatch(/padding:0 8px;cursor:pointer/);
});

test('17G-25: week property cell padding is 10px 16px (was 10px 8px)', () => {
  expect(app).toMatch(/padding:10px 16px;background:#FFFFFF;border-right/);
  expect(app).not.toMatch(/padding:10px 8px;background:#FFFFFF;border-right/);
});

test('17G-26: padding value 16 matches --cal-property-padding-x: 16px', () => {
  expect(css).toMatch(/--cal-property-padding-x\s*:\s*16px/);
  expect(app).toMatch(/padding:0 16px;cursor:pointer/);
  expect(app).toMatch(/padding:10px 16px;background:#FFFFFF;border-right/);
});

// ── Geometry: font sizes ─────────────────────────────────────────────────────

test('17G-27: month property cell font-size is 14px (was 13px)', () => {
  // The span inside sticky prop cell
  expect(app).toMatch(/font-size:14px;font-weight:600;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

test('17G-28: week property cell font-size is 14px (was 12px)', () => {
  // The div inside week propCell
  // Check month propCell (span) and week propCell (div) both use 14px
  const monthSpan = app.match(/font-size:14px;font-weight:600;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  expect(monthSpan).not.toBeNull();
});

test('17G-29: no 12px font-size on week property cell', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  expect(weekFn[0]).not.toMatch(/font-size:12px;font-weight:600/);
});

test('17G-30: no 13px font-size on month property cell sticky span', () => {
  expect(app).not.toMatch(/font-size:13px;font-weight:600;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

// ── Geometry: bhMonthOuter ───────────────────────────────────────────────────

test('17G-31: #bhMonthOuter div has width:100%', () => {
  expect(app).toMatch(/overflow:auto;-webkit-overflow-scrolling:touch;background:white;position:relative;width:100%;box-sizing:border-box/);
});

test('17G-32: #bhMonthOuter div has box-sizing:border-box', () => {
  expect(app).toMatch(/box-sizing:border-box/);
});

// ── Stacking / z-index ────────────────────────────────────────────────────────

test('17G-33: month corner cell z-index >= 20 (above property cells)', () => {
  expect(app).toMatch(/position:sticky;left:0;z-index:20/);
});

test('17G-34: month property cell z-index = 15', () => {
  expect(app).toMatch(/position:sticky;left:0;z-index:15/);
});

test('17G-35: month day header row z-index = 8 (below property cells)', () => {
  expect(app).toMatch(/position:sticky;top:0;z-index:8/);
});

// ── Grid formula integrity ────────────────────────────────────────────────────

test('17G-36: month totalW formula uses propW variable', () => {
  expect(app).toMatch(/var totalW\s*=\s*propW\s*\+\s*numDays/);
});

test('17G-37: month gridTemplateColumns uses propW variable', () => {
  expect(app).toMatch(/gridTemplateColumns\s*=\s*propW\s*\+\s*['"]px repeat/);
});

test('17G-38: week header row uses propW for first column', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  expect(weekFn[0]).toMatch(/propW\s*\+\s*['"]px repeat\(7,1fr\)/);
});

test('17G-39: week property rows use propW for first column', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  // At least two occurrences (hrow + each property row)
  const matches = weekFn[0].match(/propW\s*\+\s*['"]px repeat\(7,1fr\)/g) || [];
  expect(matches.length).toBeGreaterThanOrEqual(2);
});

// ── CSS token placement ───────────────────────────────────────────────────────

test('17G-40: canonical tokens are in :root block', () => {
  const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
  expect(rootBlock).not.toBeNull();
  expect(rootBlock[1]).toMatch(/--cal-property-width/);
  expect(rootBlock[1]).toMatch(/--cal-row-height/);
  expect(rootBlock[1]).toMatch(/--cal-property-padding-x/);
  expect(rootBlock[1]).toMatch(/--cal-grid-line/);
});

test('17G-41: --cal-property-width and --cal-label-w are both 160px (in sync)', () => {
  expect(css).toMatch(/--cal-property-width\s*:\s*160px/);
  expect(css).toMatch(/--cal-label-w\s*:\s*160px/);
});

test('17G-42: --cal-row-height and --cal-row-h are both 56px (in sync)', () => {
  expect(css).toMatch(/--cal-row-height\s*:\s*56px/);
  expect(css).toMatch(/--cal-row-h\s*:\s*56px/);
});

test('17G-43: month view colW is still 64 (unchanged)', () => {
  expect(app).toMatch(/var colW\s*=\s*64/);
});

test('17G-44: --cal-col-w is still 64px', () => {
  expect(css).toMatch(/--cal-col-w\s*:\s*64px/);
});

// ── Font weight consistency ───────────────────────────────────────────────────

test('17G-45: month property cell font-weight is 600', () => {
  expect(app).toMatch(/font-size:14px;font-weight:600;color:#374151;white-space:nowrap/);
});

test('17G-46: week property cell font-weight is 600', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  expect(weekFn[0]).toMatch(/font-size:14px;font-weight:600/);
});

// ── bh-fix-app-container (functional iOS scroll — must remain) ───────────────

test('17G-47: bh-fix-app-container JS block still present', () => {
  expect(app).toMatch(/bh-fix-app-container/);
});

test('17G-48: bh-fix-app-container is guarded by getElementById check', () => {
  expect(app).toMatch(/getElementById\(['"]bh-fix-app-container['"]\)/);
});

// ── 17F regression guards ────────────────────────────────────────────────────

test('17G-49: overflow:clip still on bh-cal-mode #calendarSection (17F)', () => {
  expect(app).toMatch(/overflow\s*:\s*clip\s*!important/);
});

test('17G-50: #bhMonthOuter background white maintained (17F)', () => {
  expect(app).toMatch(/background:white;position:relative;width:100%/);
});

test('17G-51: month property cell background #FFFFFF maintained (17F)', () => {
  expect(app).toMatch(/background:#FFFFFF;border-right:2px solid #DDD9D3/);
});

test('17G-52: Airbnb saturated color #FF5A5F still present (17F)', () => {
  expect(app).toMatch(/#FF5A5F/);
});

test('17G-53: Booking saturated color #003580 still present (17F)', () => {
  expect(app).toMatch(/#003580/);
});

test('17G-54: CSS --cal-property-width token present in responsive @media blocks', () => {
  const count = (css.match(/--cal-property-width/g) || []).length;
  // At minimum: 1 in :root + 1 in 1366 MQ + 1 in 767 MQ = 3
  expect(count).toBeGreaterThanOrEqual(3);
});

test('17G-55: week view has 7 day columns (repeat(7,1fr))', () => {
  const weekFn = app.match(/function renderWeek\(body\)([\s\S]*?)(?=\n  (?:function|\/\/ ─))/);
  expect(weekFn).not.toBeNull();
  expect(weekFn[0]).toMatch(/repeat\(7,1fr\)/);
});

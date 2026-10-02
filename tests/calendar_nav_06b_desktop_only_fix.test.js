'use strict';
/**
 * CALENDAR_NAV_06B_DESKTOP_ONLY_FIX — restore Calendar desktop tab interaction
 *
 * Root cause: Chrome's Pointer Events spec redirects the synthesized `click`
 * event to the pointer-capturing element when setPointerCapture() is active.
 * bh-layout.js onDown() calls bar.setPointerCapture(e.pointerId) for all
 * pointerdown events, including mouse clicks on desktop.
 *
 * Consequence on desktop (Chrome/Blink):
 *   1. pointerdown on .tab-btn → captured to .mobile-tabs
 *   2. pointerup fires on .mobile-tabs (captured target)
 *   3. click synthesized on .mobile-tabs (not on the button)
 *   4. mobile-native-experience.js click listener on .tab-btn → never fires
 *   5. switchTab() / tabChanged / showCalendarMode() → never called
 *
 * Why mobile (iOS WKWebView) works: WebKit fires the synthesized click on the
 * original hit-tested element regardless of pointer capture.
 *
 * Fix (bh-layout.js onDown):
 *   Guard setPointerCapture with `e.pointerType !== 'mouse'`.
 *   On desktop there is no draggable capsule (lg-capsule width:0 in
 *   bh-shell-04.css @media min-width:1367px), so capture is unnecessary for
 *   mouse events and its removal has no side-effects.
 *
 * Scope:
 *   - ONE character class of pointerType added to the existing if-guard
 *   - No change to mobile-tabs-handler.js, mobile-native-experience.js,
 *     app.html, bh-shell-04.css, or the calendar engine
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');

const bhLayout  = js('bh-layout.js');
const tabsHndlr = js('mobile-tabs-handler.js');
const mobileExp = js('mobile-native-experience.js');
const shell04   = css('bh-shell-04.css');
const appHtml   = html('app.html');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fix guard — setPointerCapture skipped for mouse pointerType
// ─────────────────────────────────────────────────────────────────────────────

describe('06B fix: setPointerCapture skipped for mouse pointerType', () => {
  test('1-01 onDown guard contains e.pointerType !== mouse', () => {
    expect(bhLayout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
  });

  test('1-02 setPointerCapture call is inside the pointer-type guard', () => {
    // The full guard must read: setPointerCapture && pointerId != null && pointerType !== 'mouse'
    expect(bhLayout).toMatch(
      /bar\.setPointerCapture\s*&&\s*e\.pointerId\s*!=\s*null\s*&&\s*e\.pointerType\s*!==\s*['"]mouse['"]/
    );
  });

  test('1-03 old unguarded setPointerCapture line is NOT present', () => {
    // Old line had no pointerType check — must be gone
    expect(bhLayout).not.toMatch(
      /bar\.setPointerCapture\s*&&\s*e\.pointerId\s*!=\s*null\s*\)\s*\{/
    );
  });

  test('1-04 setPointerCapture is still called for non-mouse pointers (guard allows it)', () => {
    // Confirm the call itself still exists inside the guard block
    expect(bhLayout).toMatch(/bar\.setPointerCapture\s*\(\s*e\.pointerId\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Desktop lg-capsule — width:0 confirms drag is not needed for mouse
// ─────────────────────────────────────────────────────────────────────────────

describe('06B desktop capsule: lg-capsule width:0 on desktop (no drag needed)', () => {
  test('2-01 bh-shell-04.css min-width:1367px media query exists', () => {
    expect(shell04).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)/);
  });

  test('2-02 lg-capsule has width:0!important (desktop block)', () => {
    // The selector is html[data-theme-v3="1"] .mobile-tabs .lg-capsule
    const capsuleBlock = shell04.match(/\.lg-capsule\s*\{[\s\S]{0,1200}?\}/);
    expect(capsuleBlock).toBeTruthy();
    expect(capsuleBlock[0]).toMatch(/width\s*:\s*0\s*!important/);
  });

  test('2-03 lg-capsule has pointer-events:none!important (desktop block)', () => {
    const capsuleBlock = shell04.match(/\.lg-capsule\s*\{[\s\S]{0,1200}?\}/);
    expect(capsuleBlock).toBeTruthy();
    expect(capsuleBlock[0]).toMatch(/pointer-events\s*:\s*none\s*!important/);
  });

  test('2-04 lg-capsule has opacity:0!important (desktop block)', () => {
    const capsuleBlock = shell04.match(/\.lg-capsule\s*\{[\s\S]{0,1200}?\}/);
    expect(capsuleBlock).toBeTruthy();
    expect(capsuleBlock[0]).toMatch(/opacity\s*:\s*0\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Click chain — button click → switchTab → tabChanged → showCalendarMode
// ─────────────────────────────────────────────────────────────────────────────

describe('06B click chain integrity: button → switchTab → tabChanged → showCalendarMode', () => {
  test('3-01 mobile-native-experience.js attaches click listener to each .tab-btn', () => {
    expect(mobileExp).toMatch(/btn\.addEventListener\s*\(\s*['"]click['"]/);
  });

  test('3-02 click listener calls switchTab(tabId)', () => {
    expect(mobileExp).toMatch(/self\.switchTab\s*\(\s*tabId\s*\)/);
  });

  test('3-03 switchTab dispatches tabChanged CustomEvent', () => {
    expect(mobileExp).toMatch(/new\s+CustomEvent\s*\(\s*['"]tabChanged['"]/);
    expect(mobileExp).toMatch(/document\.dispatchEvent\s*\(\s*event\s*\)/);
  });

  test('3-04 mobile-tabs-handler.js listens for tabChanged', () => {
    expect(tabsHndlr).toMatch(/addEventListener\s*\(\s*['"]tabChanged['"]/);
  });

  test('3-05 tabChanged handler calls showCalendarMode for calendar tab', () => {
    expect(tabsHndlr).toMatch(/tab\s*===\s*['"]calendar['"]\s*&&\s*typeof\s+window\.showCalendarMode/);
    expect(tabsHndlr).toMatch(/window\.showCalendarMode\s*\(\s*\)/);
  });

  test('3-06 tabChanged handler calls showTodayMode for today tab', () => {
    expect(tabsHndlr).toMatch(/tab\s*===\s*['"]today['"]\s*&&\s*typeof\s+window\.showTodayMode/);
    expect(tabsHndlr).toMatch(/window\.showTodayMode\s*\(\s*\)/);
  });

  test('3-07 showCalendarMode is exposed on window in app.html', () => {
    expect(appHtml).toMatch(/window\.showCalendarMode\s*=\s*showCalendarMode/);
  });

  test('3-08 showCalendarMode adds bh-cal-mode to body', () => {
    expect(appHtml).toMatch(/document\.body\.classList\.add\s*\(\s*['"]bh-cal-mode['"]\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. bh-layout.js structure preserved — swallowClick, onBarClick, drag intact
// ─────────────────────────────────────────────────────────────────────────────

describe('06B: bh-layout.js core structure preserved', () => {
  test('4-01 swallowClick still present', () => {
    expect(bhLayout).toMatch(/function\s+swallowClick/);
  });

  test('4-02 swallowClick checks suppressClick (not unconditional)', () => {
    expect(bhLayout).toMatch(/suppressClick[\s\S]{0,80}stopPropagation/);
  });

  test('4-03 onBarClick still uses e.target.closest(.tab-btn)', () => {
    expect(bhLayout).toMatch(/e\.target\.closest\s*\(\s*['"]\.tab-btn['"]\s*\)/);
  });

  test('4-04 onBarClick still registers as bubble listener (false)', () => {
    expect(bhLayout).toMatch(/addEventListener\s*\(\s*['"]click['"]\s*,\s*onBarClick\s*,\s*false\s*\)/);
  });

  test('4-05 swallowClick still registers as capture listener (true)', () => {
    expect(bhLayout).toMatch(/addEventListener\s*\(\s*['"]click['"]\s*,\s*swallowClick\s*,\s*true\s*\)/);
  });

  test('4-06 drag detection threshold of 6px still present', () => {
    expect(bhLayout).toMatch(/Math\.abs[\s\S]{0,30}startX[\s\S]{0,10}>\s*6/);
  });

  test('4-07 suppressClick timeout still 450ms', () => {
    expect(bhLayout).toMatch(/suppressClick\s*=\s*false[\s\S]{0,30}450/);
  });

  test('4-08 onDown is still registered as pointerdown listener', () => {
    expect(bhLayout).toMatch(/addEventListener\s*\(\s*['"]pointerdown['"]\s*,\s*onDown/);
  });

  test('4-09 onUp is still registered as pointerup listener', () => {
    expect(bhLayout).toMatch(/addEventListener\s*\(\s*['"]pointerup['"]\s*,\s*onUp/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Mobile (touch) path preserved — setPointerCapture still active for touch
// ─────────────────────────────────────────────────────────────────────────────

describe('06B: mobile touch path preserved', () => {
  test('5-01 setPointerCapture call is still present for touch (pointerType !== mouse allows it)', () => {
    // The call must exist — only mouse is excluded
    expect(bhLayout).toMatch(/bar\.setPointerCapture\s*\(\s*e\.pointerId\s*\)/);
  });

  test('5-02 touchstart / touchend fallback listeners still registered', () => {
    expect(bhLayout).toMatch(/addEventListener\s*\(\s*['"]touchstart['"]/);
    expect(bhLayout).toMatch(/addEventListener\s*\(\s*['"]touchend['"]/);
  });

  test('5-03 mobile-native-experience.js touchstart/touchend for long-press still present', () => {
    expect(mobileExp).toMatch(/btn\.addEventListener\s*\(\s*['"]touchstart['"]/);
    expect(mobileExp).toMatch(/btn\.addEventListener\s*\(\s*['"]touchend['"]/);
  });

  test('5-04 mobile-tabs-handler.js showCalendarMode branch unchanged', () => {
    expect(tabsHndlr).toMatch(/window\.showCalendarMode\s*\(\s*\)\s*;\s*\n\s*return\s*;/);
  });

  test('5-05 bindCalendarLink isMobileTab guard still present in app.html', () => {
    expect(appHtml).toMatch(/isMobileTab\s*=\s*!!\s*el\.getAttribute\s*\(\s*['"]data-tab['"]\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Calendar engine unchanged — rowH=64, no backend/API change
// ─────────────────────────────────────────────────────────────────────────────

describe('06B: calendar engine and backend unchanged', () => {
  test('6-01 rowH=64 still present in app.html', () => {
    expect(appHtml).toMatch(/rowH[\s\S]{0,20}64/);
  });

  test('6-02 app.html: bh-cal-mode #calendarSection display:block exists outside mobile @media', () => {
    // The bh-mobile-master style block contains an @media (max-width:1366px) sub-block
    // that closes before the standalone body.bh-cal-mode rule. Verify ordering:
    // position of first `body.bh-cal-mode #calendarSection` > closing `}` of the @media block.
    const mediaMobileStart = appHtml.indexOf('@media (max-width: 1366px)', appHtml.indexOf('id="bh-mobile-master"'));
    expect(mediaMobileStart).toBeGreaterThan(-1);
    // Find the closing } of that @media block (first `}` at column 0 after it, used as sentinel)
    const afterMedia    = appHtml.indexOf('\n}', mediaMobileStart);
    const calModeFirst  = appHtml.indexOf('body.bh-cal-mode #calendarSection');
    expect(afterMedia).toBeGreaterThan(-1);
    expect(calModeFirst).toBeGreaterThan(-1);
    // The standalone rule must come AFTER the @media block closes
    expect(calModeFirst).toBeGreaterThan(afterMedia);
    // And it must have display: block !important
    expect(appHtml).toMatch(/body\.bh-cal-mode\s+#calendarSection\s*\{[^}]*display\s*:\s*block\s*!important/);
  });

  test('6-03 no server.js modification (backend untouched)', () => {
    // Verify the fix file is bh-layout.js only — not server.js
    // server.js has no pointerType reference (not a frontend concern)
    const serverJs = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(serverJs).not.toMatch(/pointerType\s*!==\s*['"]mouse['"]/);
  });
});

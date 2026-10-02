'use strict';
/**
 * CALENDAR_06A_NAV_FIX — Calendar bottom navigation fix
 *
 * Root cause: mobile-tabs-handler.js fired window.location.href = ROUTES.calendar
 * even when already on app.html. In WKWebView (Capacitor), this hash navigation
 * reloads the page, clearing bh-cal-mode before checkHashOnLoad can restore it.
 *
 * Fix 1 (mobile-tabs-handler.js): when showCalendarMode / showTodayMode are
 *   available (i.e., we are on app.html), call them directly — no location.href.
 * Fix 2 (app.html bindCalendarLink): mobile tab buttons (data-tab) no longer use
 *   stopImmediatePropagation, so bh-layout.js onBarClick can settle the lg-capsule.
 *
 * Guards:
 *  - ROUTES.calendar === '/app.html#calendarSection' (not reservations.html)
 *  - tabChanged handler checks showCalendarMode before navigating
 *  - tabChanged handler checks showTodayMode before navigating
 *  - Cross-page fallback: window.location.href = ROUTES[tab] still present
 *  - bindCalendarLink: isMobileTab guard present, !isMobileTab before stopImmediatePropagation
 *  - calendarSection outside .page-content, shown by body.bh-cal-mode CSS
 *  - hashchange listener on app.html calls showCalendarMode
 *  - checkHashOnLoad fires showCalendarMode on #calendarSection hash
 *  - window.showCalendarMode + window.showTodayMode exposed globally
 *  - Calendar active state #0E3B2E present in mobile-tabs-handler.js
 *  - lg-capsule MutationObserver preserved in bh-layout.js
 *  - Messages badge logic preserved in mobile-native-experience.js
 *  - No legacy .tab-btn::before / .tab-btn.active::before
 *  - No calendar engine change (rowH still 64)
 *  - No API/backend changes
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const html    = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const js      = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
const server  = () => fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const appHtml   = html('app.html');
const tabsHndlr = js('mobile-tabs-handler.js');
const mobileExp = js('mobile-native-experience.js');
const bhLayout  = js('bh-layout.js');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Canonical destination — ROUTES.calendar
// ─────────────────────────────────────────────────────────────────────────────

describe('ROUTES.calendar canonical destination', () => {
  test('1-01 ROUTES.calendar is /app.html#calendarSection', () => {
    expect(tabsHndlr).toMatch(/calendar\s*:\s*['"]\/app\.html#calendarSection['"]/);
  });

  test('1-02 ROUTES.calendar does NOT reference reservations.html', () => {
    const routeBlock = tabsHndlr.match(/const ROUTES\s*=\s*\{[^}]+\}/);
    expect(routeBlock).toBeTruthy();
    expect(routeBlock[0]).not.toMatch(/reservations/);
  });

  test('1-03 ROUTES.today is /app.html', () => {
    expect(tabsHndlr).toMatch(/today\s*:\s*['"]\/app\.html['"]/);
  });

  test('1-04 No global window.location.href = reservations for calendar tab', () => {
    // tabChanged handler must not navigate to reservations.html for calendar
    const handler = tabsHndlr.match(/document\.addEventListener\s*\(\s*['"]tabChanged['"][\s\S]{0,2000}?\}\s*\)/);
    expect(handler).toBeTruthy();
    expect(handler[0]).not.toMatch(/reservations\.html/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Fix 1 — tabChanged handler uses showCalendarMode / showTodayMode on app.html
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 1: tabChanged handler uses mode functions on app.html', () => {
  test('2-01 tabChanged handler checks typeof window.showCalendarMode', () => {
    expect(tabsHndlr).toMatch(/typeof\s+window\.showCalendarMode\s*===\s*['"]function['"]/);
  });

  test('2-02 tabChanged handler calls window.showCalendarMode() for calendar tab', () => {
    expect(tabsHndlr).toMatch(/tab\s*===\s*['"]calendar['"]\s*&&\s*typeof\s+window\.showCalendarMode/);
    expect(tabsHndlr).toMatch(/window\.showCalendarMode\s*\(\s*\)/);
  });

  test('2-03 showCalendarMode branch returns early (no fall-through to location.href)', () => {
    // There must be a return after the showCalendarMode() call
    expect(tabsHndlr).toMatch(/window\.showCalendarMode\s*\(\s*\)\s*;\s*\n\s*return\s*;/);
  });

  test('2-04 tabChanged handler checks typeof window.showTodayMode', () => {
    expect(tabsHndlr).toMatch(/typeof\s+window\.showTodayMode\s*===\s*['"]function['"]/);
  });

  test('2-05 tabChanged handler calls window.showTodayMode() for today tab', () => {
    expect(tabsHndlr).toMatch(/tab\s*===\s*['"]today['"]\s*&&\s*typeof\s+window\.showTodayMode/);
    expect(tabsHndlr).toMatch(/window\.showTodayMode\s*\(\s*\)/);
  });

  test('2-06 showTodayMode branch returns early', () => {
    expect(tabsHndlr).toMatch(/window\.showTodayMode\s*\(\s*\)\s*;\s*\n\s*return\s*;/);
  });

  test('2-07 Cross-page fallback window.location.href = ROUTES[tab] still present', () => {
    expect(tabsHndlr).toMatch(/window\.location\.href\s*=\s*ROUTES\[tab\]/);
  });

  test('2-08 tabChanged handler: showCalendarMode check comes BEFORE location.href assignment', () => {
    const handlerStart = tabsHndlr.indexOf('tabChanged');
    const calCheck     = tabsHndlr.indexOf('showCalendarMode', handlerStart);
    const locHref      = tabsHndlr.indexOf('window.location.href', handlerStart);
    expect(calCheck).toBeGreaterThan(-1);
    expect(locHref).toBeGreaterThan(-1);
    expect(calCheck).toBeLessThan(locHref);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fix 2 — bindCalendarLink mobile tab buttons no stopImmediatePropagation
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix 2: bindCalendarLink mobile tab buttons allow bubbling', () => {
  test('3-01 isMobileTab guard present in bindCalendarLink', () => {
    expect(appHtml).toMatch(/isMobileTab\s*=\s*!!\s*el\.getAttribute\s*\(\s*['"]data-tab['"]\s*\)/);
  });

  test('3-02 stopImmediatePropagation guarded by !isMobileTab', () => {
    expect(appHtml).toMatch(/if\s*\(\s*!isMobileTab\s*\)\s*e\.stopImmediatePropagation\s*\(\s*\)/);
  });

  test('3-03 doScroll still called after isMobileTab guard in bindCalendarLink', () => {
    // doScroll() must appear after the isMobileTab variable declaration
    const isMobileIdx = appHtml.indexOf('var isMobileTab = !!el.getAttribute');
    const doScrollIdx = appHtml.indexOf('doScroll();', isMobileIdx);
    expect(isMobileIdx).toBeGreaterThan(-1);
    expect(doScrollIdx).toBeGreaterThan(isMobileIdx);
  });

  test('3-04 Desktop navCalendarLink still uses stopImmediatePropagation', () => {
    // The clone.addEventListener block for navCalendarLink still uses stopImmediatePropagation
    const desktopBlock = appHtml.match(/navCalendarLink[\s\S]{0,500}?_scrollBound\s*=\s*true[\s\S]{0,300}?clone\.addEventListener/);
    expect(desktopBlock).toBeTruthy();
    // The stopImmediatePropagation call comes somewhere after navCalendarLink's clone binding
    const cloneIdx = appHtml.indexOf("clone.addEventListener('click'");
    const stopIdx  = appHtml.indexOf('stopImmediatePropagation', cloneIdx);
    expect(cloneIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(cloneIdx);
    // And it comes before the mobile querySelectorAll block
    const mobileIdx = appHtml.indexOf('querySelectorAll', cloneIdx);
    expect(stopIdx).toBeLessThan(mobileIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. app.html — calendarSection DOM position and CSS
// ─────────────────────────────────────────────────────────────────────────────

describe('app.html calendarSection structure', () => {
  test('4-01 #calendarSection exists in app.html', () => {
    expect(appHtml).toMatch(/id\s*=\s*["']calendarSection["']/);
  });

  test('4-02 calendarSection is outside .page-content (direct child of main)', () => {
    // The comment CALENDAR-17D confirms calendarSection is a sibling of .page-content
    expect(appHtml).toMatch(/Direct child of <main>, sibling to \.page-content/);
  });

  test('4-03 body.bh-cal-mode #calendarSection shows block', () => {
    expect(appHtml).toMatch(/body\.bh-cal-mode\s+#calendarSection\s*\{[^}]*display\s*:\s*block\s*!important/);
  });

  test('4-04 body.bh-cal-mode .page-content hidden', () => {
    expect(appHtml).toMatch(/body\.bh-cal-mode\s+\.page-content\s*\{[^}]*display\s*:\s*none\s*!important/);
  });

  test('4-05 #calendarSection default display:none', () => {
    expect(appHtml).toMatch(/#calendarSection\s*\{[^}]*display\s*:\s*none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. app.html — hashchange and checkHashOnLoad
// ─────────────────────────────────────────────────────────────────────────────

describe('app.html hash-based calendar activation', () => {
  test('5-01 hashchange listener calls showCalendarMode', () => {
    expect(appHtml).toMatch(/addEventListener\s*\(\s*['"]hashchange['"]\s*,\s*function[\s\S]{0,200}showCalendarMode/);
  });

  test('5-02 checkHashOnLoad checks #calendarSection hash', () => {
    expect(appHtml).toMatch(/checkHashOnLoad[\s\S]{0,300}#calendarSection/);
  });

  test('5-03 checkHashOnLoad calls showCalendarMode', () => {
    expect(appHtml).toMatch(/checkHashOnLoad[\s\S]{0,300}showCalendarMode\s*\(\s*\)/);
  });

  test('5-04 popstate listener calls showCalendarMode for calendar hash', () => {
    expect(appHtml).toMatch(/popstate[\s\S]{0,300}showCalendarMode\s*\(\s*\)/);
  });

  test('5-05 window.showCalendarMode exposed globally', () => {
    expect(appHtml).toMatch(/window\.showCalendarMode\s*=\s*showCalendarMode/);
  });

  test('5-06 window.showTodayMode exposed globally', () => {
    expect(appHtml).toMatch(/window\.showTodayMode\s*=\s*showTodayMode/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Calendar active state — #0E3B2E color
// ─────────────────────────────────────────────────────────────────────────────

describe('Calendar active state colors', () => {
  test('6-01 TAB_ACTIVE color is #0E3B2E in mobile-tabs-handler.js', () => {
    expect(tabsHndlr).toMatch(/TAB_ACTIVE\s*=\s*['"]#0E3B2E['"]/);
  });

  test('6-02 TAB_INACTIVE color is #7A8695 in mobile-tabs-handler.js', () => {
    expect(tabsHndlr).toMatch(/TAB_INACTIVE\s*=\s*['"]#7A8695['"]/);
  });

  test('6-03 updateLucideActive applies TAB_ACTIVE for active tabs', () => {
    expect(tabsHndlr).toMatch(/updateLucideActive[\s\S]{0,500}TAB_ACTIVE/);
  });

  test('6-04 applyLucideIcons applies correct color based on active state', () => {
    expect(tabsHndlr).toMatch(/isActive\s*\?\s*TAB_ACTIVE\s*:\s*TAB_INACTIVE/);
  });

  test('6-05 Lucide calendar icon defined in LUCIDE_TABS', () => {
    expect(tabsHndlr).toMatch(/calendar\s*:\s*\{\s*svg\s*:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. lg-capsule preserved — bh-layout.js MutationObserver on .active class
// ─────────────────────────────────────────────────────────────────────────────

describe('lg-capsule preservation', () => {
  test('7-01 bh-layout.js MutationObserver watches .active class on tab buttons', () => {
    expect(bhLayout).toMatch(/MutationObserver[\s\S]{0,200}attributeFilter\s*:\s*\[\s*['"]class['"]\s*\]/);
  });

  test('7-02 MutationObserver callback calls sync', () => {
    expect(bhLayout).toMatch(/MutationObserver[\s\S]{0,300}sync\s*\(\s*true\s*\)/);
  });

  test('7-03 lg-capsule setup present in bh-layout.js', () => {
    expect(bhLayout).toMatch(/lg-capsule/);
  });

  test('7-04 onBarClick present for click-driven capsule settle', () => {
    expect(bhLayout).toMatch(/function\s+onBarClick/);
  });

  test('7-05 bh-layout.js loads on app.html', () => {
    expect(appHtml).toMatch(/bh-layout\.js/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Messages badge preserved
// ─────────────────────────────────────────────────────────────────────────────

describe('Messages badge preservation', () => {
  test('8-01 updateTabBadge present in mobile-native-experience.js', () => {
    expect(mobileExp).toMatch(/updateTabBadge/);
  });

  test('8-02 messages badge span logic present', () => {
    expect(mobileExp).toMatch(/badge/);
  });

  test('8-03 mobile-native-experience.js loaded on app.html', () => {
    expect(appHtml).toMatch(/mobile-native-experience\.js/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. No legacy ::before on tab buttons
// ─────────────────────────────────────────────────────────────────────────────

describe('No legacy ::before navigation indicator', () => {
  test('9-01 app.html has no .tab-btn::before positioning block', () => {
    // Old pattern: .tab-btn.active::before { content: ''; position: absolute; ... }
    expect(appHtml).not.toMatch(/\.tab-btn\.active\s*::\s*before\s*\{[^}]*position\s*:\s*absolute/);
  });

  test('9-02 mobile-tabs-handler.js has no legacy ::before pill', () => {
    expect(tabsHndlr).not.toMatch(/\.tab-btn\s*::\s*before\s*\{/);
  });

  test('9-03 mobile-native-experience.js has no legacy ::before pill', () => {
    expect(mobileExp).not.toMatch(/\.tab-btn\.active\s*::\s*before/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Cross-page navigation preserved (Messages → Calendar, Gestion → Calendar)
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-page calendar navigation', () => {
  test('10-01 mobile-tabs-handler.js loaded on messages.html', () => {
    const msgs = html('messages.html');
    expect(msgs).toMatch(/mobile-tabs-handler\.js/);
  });

  test('10-02 mobile-tabs-handler.js loaded on manage.html', () => {
    const mgmt = html('manage.html');
    expect(mgmt).toMatch(/mobile-tabs-handler\.js/);
  });

  test('10-03 ROUTES.calendar defined for cross-page navigation', () => {
    expect(tabsHndlr).toMatch(/ROUTES\s*\[tab\]/);
  });

  test('10-04 window.location.href fallback remains after mode-function checks', () => {
    const handlerMatch = tabsHndlr.match(
      /document\.addEventListener\s*\(\s*['"]tabChanged['"][\s\S]{0,2000}?\}\s*\)/
    );
    expect(handlerMatch).toBeTruthy();
    expect(handlerMatch[0]).toMatch(/window\.location\.href\s*=\s*ROUTES\[tab\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. No calendar engine change (rowH still 64 from CALENDAR_06_STRICT)
// ─────────────────────────────────────────────────────────────────────────────

describe('No calendar engine regression', () => {
  test('11-01 rowH still 64 in renderMonth (CALENDAR_06_STRICT guard)', () => {
    expect(appHtml).toMatch(/compactMode\s*\?\s*34\s*:\s*64/);
  });

  test('11-02 week property row and cell min-height still 64px', () => {
    // Two occurrences: property row + day cell (both inline JS styles)
    const matches = appHtml.match(/min-height:64px/g);
    expect(matches).toBeTruthy();
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('11-03 bh-calendar-ios-06.css linked in app.html', () => {
    expect(appHtml).toMatch(/bh-calendar-ios-06\.css/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. No API / backend changes
// ─────────────────────────────────────────────────────────────────────────────

describe('No API or backend changes', () => {
  test('12-01 server.js does not contain calendar nav route changes', () => {
    const srv = server();
    // Only navigation JS files changed — no new API route for calendar
    expect(srv).not.toMatch(/app\.get\s*\(\s*['"]\/api\/calendar\/navigate['"]/);
  });

  test('12-02 mobile-tabs-handler.js has no fetch / XHR calls for calendar navigation', () => {
    const handlerMatch = tabsHndlr.match(
      /document\.addEventListener\s*\(\s*['"]tabChanged['"][\s\S]{0,2000}?\}\s*\)/
    );
    expect(handlerMatch).toBeTruthy();
    expect(handlerMatch[0]).not.toMatch(/fetch\s*\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. mobile-tabs-handler.js — Today active detection on app.html with hash
// ─────────────────────────────────────────────────────────────────────────────

describe('Active tab detection on app.html', () => {
  test('13-01 app.html + #calendarSection hash → activeTab = calendar', () => {
    expect(tabsHndlr).toMatch(
      /window\.location\.hash\s*===\s*['"]#calendarSection['"]\s*\?\s*['"]calendar['"]\s*:\s*['"]today['"]/
    );
  });

  test('13-02 window.__bhActiveTab exposed globally', () => {
    expect(tabsHndlr).toMatch(/window\.__bhActiveTab\s*=\s*activeTab/);
  });

  test('13-03 mobile-native-experience.js reads window.__bhActiveTab', () => {
    expect(mobileExp).toMatch(/window\.__bhActiveTab/);
  });
});

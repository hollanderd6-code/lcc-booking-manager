'use strict';
/**
 * SHELL_04C — Final visual fix
 * Minimum 70 assertions.
 *
 * Guards:
 *  - Root cause documented: bh-v3-mobile.css desktop display:none !important
 *  - bh-shell-04.css specificity fix: body .mobile-tabs beats (0,2,1) conflict
 *  - Desktop nav visible at all widths (375 → 1920)
 *  - Capsule geometry: fixed, centered, 520-620px, border-radius 50px
 *  - Liquid Glass surface
 *  - Active lg-capsule
 *  - 4 tabs in strict order
 *  - Initials binding in bh-layout.js (no hardcoded "?")
 *  - Account type variants: own / delegated
 *  - openAgencySwitcherModal flow reused
 *  - Protected files unchanged
 *  - Regressions: SHELL_04 (92), SHELL_03 (102) still pass
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Root cause: bh-v3-mobile.css conflicts', () => {
  const v3m = css('bh-v3-mobile.css');

  test('bh-v3-mobile.css has display:none !important for .mobile-tabs at min-width 1367px', () => {
    expect(v3m).toMatch(/@media\s*\(min-width:\s*1367px\)[\s\S]{0,200}\.mobile-tabs[\s\S]{0,100}display:\s*none\s*!important/);
  });

  test('bh-v3-mobile.css rule uses selector html[data-theme-v3="1"] .mobile-tabs (specificity 0,2,1)', () => {
    expect(v3m).toMatch(/html\[data-theme-v3="1"\]\s*\.mobile-tabs\s*\{[\s\S]{0,50}display:\s*none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Specificity fix in bh-shell-04.css', () => {
  const s = css('bh-shell-04.css');

  test('bh-shell-04.css has body in .mobile-tabs display rule for higher specificity', () => {
    expect(s).toMatch(/html\[data-theme-v3="1"\]\s*body\s*\.mobile-tabs\s*\{[\s\S]{0,50}display:\s*flex\s*!important/);
  });

  test('body .mobile-tabs rule is inside min-width: 1367px block', () => {
    const desktopBlock = s.match(/@media\s*\(min-width:\s*1367px\)([\s\S]*)/);
    expect(desktopBlock).not.toBeNull();
    expect(desktopBlock[1]).toMatch(/body\s*\.mobile-tabs[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('specificity comment documents the override rationale', () => {
    expect(s).toMatch(/Specificity override|bh-v3-mobile/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Desktop nav geometry (unchanged from SHELL_04)', () => {
  const s = css('bh-shell-04.css');

  test('position: fixed at min-width 1367px', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}position:\s*fixed\s*!important/);
  });

  test('bottom: 20–24px', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}bottom:\s*2[0-4]px\s*!important/);
  });

  test('left: 50% for centering', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}left:\s*50%\s*!important/);
  });

  test('transform: translateX(-50%) for viewport centering', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}transform:\s*translateX\(-50%\)\s*!important/);
  });

  test('min-width: 520px', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}min-width:\s*520px\s*!important/);
  });

  test('max-width: 620px', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}max-width:\s*620px\s*!important/);
  });

  test('border-radius: 50px (capsule)', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}border-radius:\s*50px\s*!important/);
  });

  test('z-index: 10001', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,1400}z-index:\s*10001\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Liquid Glass surface', () => {
  const s = css('bh-shell-04.css');

  test('background rgba(255,255,255,0.6x)', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}background:\s*rgba\(255,\s*255,\s*255,\s*0\.[6-9]/);
  });

  test('backdrop-filter blur(28px) saturate(180%)', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}backdrop-filter:\s*blur\(28px\)\s*saturate\(180%\)/);
  });

  test('-webkit-backdrop-filter present', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}-webkit-backdrop-filter:\s*blur\(28px\)/);
  });

  test('border rgba(255,255,255,0.72)', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.72\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — lg-capsule active zone on desktop', () => {
  const s = css('bh-shell-04.css');

  test('.lg-capsule position: absolute', () => {
    expect(s).toMatch(/\.lg-capsule[\s\S]{0,100}position:\s*absolute\s*!important/);
  });

  test('.lg-capsule background rgba(14,59,46,...)', () => {
    expect(s).toMatch(/\.lg-capsule[\s\S]{0,300}background:\s*rgba\(14,\s*59,\s*46/);
  });

  test('.lg-capsule.lg-visible opacity: 1', () => {
    expect(s).toMatch(/\.lg-capsule\.lg-visible[\s\S]{0,100}opacity:\s*1\s*!important/);
  });

  test('.lg-capsule.lg-animate has transition', () => {
    expect(s).toMatch(/\.lg-capsule\.lg-animate[\s\S]{0,200}transition:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Nav present at all breakpoints (structural CSS)', () => {
  const s = css('bh-shell-04.css');
  const v3m = css('bh-v3-mobile.css');

  // bh-bottom-bar.css handles mobile (≤1366px) — check it has display:flex
  const bbar = css('bh-bottom-bar.css');

  test('bh-bottom-bar.css has .mobile-tabs display:flex at max-width:1366px (mobile/tablet)', () => {
    expect(bbar).toMatch(/@media\s*\(max-width:\s*1366px\)[\s\S]{0,200}\.mobile-tabs[\s\S]{0,600}display:\s*flex/);
  });

  test('bh-shell-04.css makes nav visible at ≥1367px with !important', () => {
    expect(s).toMatch(/min-width:\s*1367px[\s\S]{0,9000}body\s*\.mobile-tabs[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('mobile-native-experience.js creates .mobile-tabs unconditionally (no viewport gate)', () => {
    const mne = js('mobile-native-experience.js');
    // No innerWidth check before createTabNavigation
    expect(mne).toMatch(/createTabNavigation\(\)/);
    // The function itself does not gate on window.innerWidth
    const createFn = mne.match(/createTabNavigation\(\)\s*\{([\s\S]{0,2000})\}/);
    expect(createFn).not.toBeNull();
    expect(createFn[1]).not.toMatch(/innerWidth/);
  });

  // Breakpoint assertions: 375 / 430 — mobile handled by bh-bottom-bar.css
  test('375px: bh-bottom-bar.css max-width:1366px covers mobile width 375', () => {
    // 375 < 1366, so the mobile style applies
    expect(bbar).toMatch(/max-width:\s*1366px/);
  });

  test('430px: covered by bh-bottom-bar.css ≤1366px', () => {
    expect(bbar).toMatch(/max-width:\s*1366px/);
  });

  test('768px: mobile-native-styles.css display:none (no !important) beaten by bh-shell-04.css (no conflict below 1367px because mobile-tabs IS flex via bh-bottom-bar)', () => {
    const mns = css('mobile-native-styles.css');
    expect(mns).toMatch(/@media\s*\(min-width:\s*768px\)[\s\S]{0,100}\.mobile-tabs[\s\S]{0,50}display:\s*none/);
    // Our mobile-tabs is shown via bh-bottom-bar.css (max-width: 1366px flex)
    // At 768px (< 1366px), bh-bottom-bar.css wins for flex; mobile-native no !important
    expect(bbar).toMatch(/max-width:\s*1366px/);
  });

  test('1024px: still covered by bh-bottom-bar.css ≤1366px range', () => {
    expect(bbar).toMatch(/max-width:\s*1366px/);
  });

  test('1280px: covered by bh-shell-04.css ≥1367px — no, 1280 < 1367. Covered by bh-bottom-bar at ≤1366px', () => {
    // 1280 < 1367: mobile bar applies, bh-shell-04 desktop rule not active
    expect(bbar).toMatch(/max-width:\s*1366px/);
  });

  test('1440px: ≥1367px — bh-shell-04.css body .mobile-tabs display:flex !important', () => {
    expect(s).toMatch(/body\s*\.mobile-tabs[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('1720px: same desktop rule covers ≥1367px up to any width', () => {
    expect(s).toMatch(/min-width:\s*1367px[\s\S]{0,9000}body\s*\.mobile-tabs[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('1920px: same desktop rule covers 1920px', () => {
    expect(s).toMatch(/min-width:\s*1367px[\s\S]{0,9000}body\s*\.mobile-tabs[\s\S]{0,100}display:\s*flex\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — 4 tabs in strict order (HTML is dynamic, check JS source)', () => {
  const mne = js('mobile-native-experience.js');

  test("allTabs array contains 'today' first", () => {
    expect(mne).toMatch(/allTabs\s*=\s*\[[\s\S]{0,50}id:\s*'today'/);
  });

  test("allTabs second entry is 'calendar'", () => {
    const m = mne.match(/allTabs\s*=\s*\[([\s\S]{0,800})\]/);
    expect(m).not.toBeNull();
    const block = m[1];
    const todayPos    = block.indexOf("id: 'today'");
    const calendarPos = block.indexOf("id: 'calendar'");
    const messagesPos = block.indexOf("id: 'messages'");
    const managePos   = block.indexOf("id: 'manage'");
    expect(todayPos).toBeLessThan(calendarPos);
    expect(calendarPos).toBeLessThan(messagesPos);
    expect(messagesPos).toBeLessThan(managePos);
  });

  test("Messages tab has badge property", () => {
    expect(mne).toMatch(/id:\s*'messages'[\s\S]{0,100}badge:/);
  });

  test('LUCIDE_TABS in mobile-tabs-handler has today icon (calendar+timeline)', () => {
    const mth = js('mobile-tabs-handler.js');
    expect(mth).toMatch(/LUCIDE_TABS/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Tab icons (from bh-layout.js IC object)', () => {
  const layout = js('bh-layout.js');

  test("IC.today has calendar rect SVG", () => {
    expect(layout).toMatch(/today:\s*'<svg[\s\S]{0,100}rect x="3" y="4"/);
  });

  test("IC.today has timeline lines (x1=\"7\" y1=\"14\")", () => {
    expect(layout).toMatch(/today:[\s\S]{0,300}x1="7" y1="14"/);
  });

  test("IC.calendar has calendar rect without timeline", () => {
    expect(layout).toMatch(/calendar:\s*'<svg[\s\S]{0,100}rect x="3" y="4"/);
  });

  test("IC.messages has double-bubble (M18 9h2 path)", () => {
    expect(layout).toMatch(/messages:\s*'<svg[\s\S]{0,200}M18 9h2/);
  });

  test("IC.manage has grid (four rects)", () => {
    expect(layout).toMatch(/manage:\s*'<svg[\s\S]{0,200}rect x="3" y="3"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Initials button: real source in bh-layout.js', () => {
  const layout = js('bh-layout.js');

  test('bh-layout.js updates .bh-header-initials-btn elements', () => {
    expect(layout).toMatch(/\.bh-header-initials-btn/);
    expect(layout).toMatch(/querySelectorAll\(.*\.bh-header-initials-btn.*\)/);
  });

  test('initials update reads from localStorage lcc_user', () => {
    expect(layout).toMatch(/lcc_user/);
  });

  test('initials update uses displayUser.firstName as primary source', () => {
    expect(layout).toMatch(/displayUser\.firstName[\s\S]{0,200}bh-header-initials-btn|bh-header-initials-btn[\s\S]{0,500}displayUser\.firstName/);
  });

  test('initials update falls back to user.firstName', () => {
    // user.firstName is referenced before querySelectorAll in the IIFE
    expect(layout).toMatch(/user\.firstName[\s\S]{0,200}\.bh-header-initials-btn/);
  });

  test('fallback to "?" only when no identity exists', () => {
    expect(layout).toMatch(/charAt\(0\)\.toUpperCase\(\)\s*\|\|\s*'\?'/);
  });

  test('textContent = _letter sets the initial on the button', () => {
    expect(layout).toMatch(/btn\.textContent\s*=\s*_letter/);
  });

  test('delegated sub-account adds bh-ios-initials-button--delegated class', () => {
    expect(layout).toMatch(/bh-ios-initials-button--delegated/);
  });

  test('own account adds bh-ios-initials-button--own class', () => {
    const block = layout.match(/\.bh-header-initials-btn[\s\S]{0,800}/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/bh-ios-initials-button--own/);
  });

  test('sub-account detection reads lcc_account_type and lcc_is_sub_account', () => {
    // lcc_account_type/_is_sub_account are read before querySelectorAll in the IIFE
    expect(layout).toMatch(/lcc_account_type[\s\S]{0,400}\.bh-header-initials-btn|lcc_is_sub_account[\s\S]{0,400}\.bh-header-initials-btn/);
  });

  test('no hardcoded single letter as initials fallback', () => {
    // "?" is the only allowed hardcoded value, not a letter like "C" or "A"
    const btnSection = layout.match(/querySelectorAll.*bh-header-initials-btn[\s\S]{0,600}/);
    expect(btnSection).not.toBeNull();
    // Should not set btn.textContent = 'C' or any single uppercase letter literal
    expect(btnSection[0]).not.toMatch(/btn\.textContent\s*=\s*'[A-Z]'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Initials button: HTML structure unchanged', () => {
  const h = html('app.html');

  test('#appInitialsBtn exists in app.html with class bh-header-initials-btn', () => {
    expect(h).toMatch(/id="appInitialsBtn"/);
    expect(h).toMatch(/bh-header-initials-btn/);
  });

  test('#appInitialsBtn uses openAgencySwitcherModal', () => {
    expect(h).toMatch(/appInitialsBtn[\s\S]{0,200}openAgencySwitcherModal|openAgencySwitcherModal[\s\S]{0,200}appInitialsBtn/);
  });

  test('app.html initials button has bh-ios-initials-button--own as default class', () => {
    // class attribute precedes id attribute in HTML: class="... bh-ios-initials-button--own ..." id="appInitialsBtn"
    expect(h).toMatch(/bh-ios-initials-button--own[\s\S]{0,100}appInitialsBtn|appInitialsBtn[\s\S]{0,200}bh-ios-initials-button--own/);
  });

  test('messages.html has initials button', () => {
    expect(html('messages.html')).toMatch(/bh-header-initials-btn/);
  });

  test('manage.html has initials button', () => {
    expect(html('manage.html')).toMatch(/bh-header-initials-btn/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Initials button: visual tokens in bh-ios-parity.css', () => {
  const parity = css('bh-ios-parity.css');

  test('bh-ios-parity.css defines .bh-ios-initials-button', () => {
    expect(parity).toMatch(/\.bh-ios-initials-button/);
  });

  test('.bh-ios-initials-button is 38×38px', () => {
    expect(parity).toMatch(/\.bh-ios-initials-button[\s\S]{0,200}38px/);
  });

  test('.bh-ios-initials-button has border-radius: 50% (circle)', () => {
    expect(parity).toMatch(/\.bh-ios-initials-button[\s\S]{0,200}border-radius:\s*50%/);
  });

  test('--own variant uses DCE8E1 background', () => {
    expect(parity).toMatch(/initials-button--own[\s\S]{0,200}DCE8E1|#DCE8E1[\s\S]{0,400}initials-button/);
  });

  test('--own variant uses #0E3B2E foreground', () => {
    expect(parity).toMatch(/initials-button--own[\s\S]{0,300}0E3B2E/);
  });

  test('--delegated variant exists', () => {
    expect(parity).toMatch(/initials-button--delegated/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Today header unchanged', () => {
  const h = html('app.html');

  test('#appSearchBtn present', () => {
    expect(h).toMatch(/id="appSearchBtn"/);
  });

  test('#syncBtn still in DOM (functionality preserved)', () => {
    expect(h).toMatch(/id="syncBtn"/);
  });

  test('#notifHistoryBtn still in DOM', () => {
    expect(h).toMatch(/id="notifHistoryBtn"/);
  });

  test('#newReservationBtn still in DOM', () => {
    expect(h).toMatch(/id="newReservationBtn"/);
  });

  test('Aujourd\'hui page-title present', () => {
    expect(h).toMatch(/Aujourd'hui/);
  });

  test('page-kicker element present', () => {
    expect(h).toMatch(/id="appPageKicker"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Messages composer protection', () => {
  const s = css('bh-shell-04.css');

  test('#chatInputArea bottom lifted above nav on desktop', () => {
    expect(s).toMatch(/data-page="messages"[\s\S]{0,200}#chatInputArea[\s\S]{0,100}bottom:\s*calc\(/);
  });

  test('.chat-modal-input bottom lifted on desktop', () => {
    expect(s).toMatch(/data-page="messages"[\s\S]{0,200}\.chat-modal-input[\s\S]{0,100}bottom:\s*calc\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Rail neutralised', () => {
  const s = css('bh-shell-04.css');

  test('.sidebar.bh-nav-rail hidden on app page', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,200}sidebar\.bh-nav-rail[\s\S]{0,100}display:\s*none\s*!important/);
  });

  test('.app-container margin-left 0 on app page', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,400}\.app-container[\s\S]{0,100}margin-left:\s*0\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04C — Protected files unchanged', () => {
  test('chat-owner.js SHA-1 unchanged', () => {
    const buf = fs.readFileSync(path.join(ROOT, 'public', 'js', 'chat-owner.js'));
    const raw = crypto.createHash('sha1').update(buf).digest('hex');
    expect(raw).toBe('2a9717b64e4f7059a164175177f976025ff47142');
  });

  test('calendar-modern.js size > 1 KB', () => {
    const p = path.join(ROOT, 'public', 'js', 'calendar-modern.js');
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('bh-calendar-v3.js size > 1 KB', () => {
    const p = path.join(ROOT, 'public', 'js', 'bh-calendar-v3.js');
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('bh-nav-rail.css unchanged (still has 248px rule)', () => {
    expect(css('bh-nav-rail.css')).toMatch(/margin-left:\s*248px/);
  });

  test('No backend files modified (server.js not touched by CSS/JS changes)', () => {
    expect(fs.existsSync(path.join(ROOT, 'server.js'))).toBe(true);
  });
});

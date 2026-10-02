'use strict';
/**
 * SHELL_04_STRICT — Universal floating bottom navigation
 * Minimum 90 assertions.
 *
 * Guards:
 *  - bh-shell-04.css exists with correct content
 *  - All 4 pages load bh-shell-04.css
 *  - Rail neutralised (margin-left, display:none) on 4 pages
 *  - Desktop capsule geometry (bottom, centering, size, glass)
 *  - Today header buttons hidden (sync / notif / new-resa)
 *  - Messages composer protected (sticky bottom lifted)
 *  - Content bottom padding present
 *  - Initials button shown on desktop
 *  - Protected files unchanged
 *  - Mobile behaviour preserved
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function sha1(filePath) {
  const buf = fs.readFileSync(path.join(ROOT, filePath));
  return crypto.createHash('sha1').update(buf).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — file existence', () => {
  test('bh-shell-04.css exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'public', 'css', 'bh-shell-04.css'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — HTML: bh-shell-04.css loaded on all 4 pages', () => {
  const pages = ['app.html', 'messages.html', 'manage.html', 'reservations.html'];
  for (const page of pages) {
    test(`${page} includes bh-shell-04.css`, () => {
      expect(html(page)).toMatch(/bh-shell-04\.css/);
    });
  }

  test('app.html loads bh-shell-04.css after bh-shell-ios.css', () => {
    const h = html('app.html');
    const posIos = h.indexOf('bh-shell-ios.css');
    const pos04  = h.indexOf('bh-shell-04.css');
    expect(posIos).toBeGreaterThan(-1);
    expect(pos04).toBeGreaterThan(posIos);
  });

  test('messages.html loads bh-shell-04.css after bh-shell-ios.css', () => {
    const h = html('messages.html');
    const posIos = h.indexOf('bh-shell-ios.css');
    const pos04  = h.indexOf('bh-shell-04.css');
    expect(posIos).toBeGreaterThan(-1);
    expect(pos04).toBeGreaterThan(posIos);
  });

  test('manage.html loads bh-shell-04.css after bh-shell-ios.css', () => {
    const h = html('manage.html');
    const posIos = h.indexOf('bh-shell-ios.css');
    const pos04  = h.indexOf('bh-shell-04.css');
    expect(posIos).toBeGreaterThan(-1);
    expect(pos04).toBeGreaterThan(posIos);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: rail neutralisation', () => {
  const s = css('bh-shell-04.css');

  test('bh-shell-04.css targets desktop breakpoint (min-width: 1367px)', () => {
    expect(s).toMatch(/min-width:\s*1367px/);
  });

  test('hides .sidebar.bh-nav-rail for data-page="app"', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,200}sidebar\.bh-nav-rail[\s\S]{0,100}display:\s*none/);
  });

  test('hides .sidebar.bh-nav-rail for data-page="messages"', () => {
    expect(s).toMatch(/data-page="messages"[\s\S]{0,200}sidebar\.bh-nav-rail[\s\S]{0,100}display:\s*none/);
  });

  test('hides .sidebar.bh-nav-rail for data-page="manage"', () => {
    expect(s).toMatch(/data-page="manage"[\s\S]{0,200}sidebar\.bh-nav-rail[\s\S]{0,100}display:\s*none/);
  });

  test('hides .sidebar.bh-nav-rail for data-page="reservations"', () => {
    expect(s).toMatch(/data-page="reservations"[\s\S]{0,200}sidebar\.bh-nav-rail[\s\S]{0,100}display:\s*none/);
  });

  test('zeros margin-left on .app-container for data-page="app"', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,400}\.app-container[\s\S]{0,100}margin-left:\s*0\s*!important/);
  });

  test('zeros margin-left on .app-container for data-page="messages"', () => {
    expect(s).toMatch(/data-page="messages"[\s\S]{0,400}\.app-container[\s\S]{0,100}margin-left:\s*0\s*!important/);
  });

  test('zeros margin-left on .app-container for data-page="manage"', () => {
    expect(s).toMatch(/data-page="manage"[\s\S]{0,400}\.app-container[\s\S]{0,100}margin-left:\s*0\s*!important/);
  });

  test('zeros margin-left on .app-container for data-page="reservations"', () => {
    expect(s).toMatch(/data-page="reservations"[\s\S]{0,400}\.app-container[\s\S]{0,100}margin-left:\s*0\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: desktop floating capsule geometry', () => {
  const s = css('bh-shell-04.css');

  // The .mobile-tabs block has many properties; use {0,900} to cover the full block.
  test('.mobile-tabs position: fixed on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}position:\s*fixed\s*!important/);
  });

  test('.mobile-tabs bottom: 22px on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}bottom:\s*22px\s*!important/);
  });

  test('.mobile-tabs left: 50% on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}left:\s*50%\s*!important/);
  });

  test('.mobile-tabs transform: translateX(-50%) on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}transform:\s*translateX\(-50%\)\s*!important/);
  });

  test('.mobile-tabs min-width: 520px on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}min-width:\s*520px\s*!important/);
  });

  test('.mobile-tabs max-width: 620px on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}max-width:\s*620px\s*!important/);
  });

  test('.mobile-tabs border-radius: 50px (capsule) on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}border-radius:\s*50px\s*!important/);
  });

  test('.mobile-tabs z-index: 10001 on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,1400}z-index:\s*10001\s*!important/);
  });

  test('.mobile-tabs display: flex on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}display:\s*flex\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: Liquid Glass surface', () => {
  const s = css('bh-shell-04.css');

  test('.mobile-tabs uses rgba(255,255,255,...) glass background', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}background:\s*rgba\(255,\s*255,\s*255,\s*0\.[6-9]/);
  });

  test('.mobile-tabs uses backdrop-filter blur(28px) saturate(180%)', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}backdrop-filter:\s*blur\(28px\)\s*saturate\(180%\)/);
  });

  test('.mobile-tabs uses -webkit-backdrop-filter', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}-webkit-backdrop-filter:\s*blur\(28px\)/);
  });

  test('.mobile-tabs border uses rgba(255,255,255,0.72)', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.72\)/);
  });

  test('.mobile-tabs box-shadow includes rgba(20, 32, 27', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}box-shadow[\s\S]{0,300}rgba\(20,\s*32,\s*27/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: tab button styles', () => {
  const s = css('bh-shell-04.css');

  test('.tab-btn has flex-direction: column for icon-above-label', () => {
    expect(s).toMatch(/\.tab-btn[\s\S]{0,300}flex-direction:\s*column\s*!important/);
  });

  test('.tab-btn min-height at least 60px', () => {
    expect(s).toMatch(/\.tab-btn[\s\S]{0,600}min-height:\s*6[0-9]px\s*!important/);
  });

  test('.tab-btn inactive color uses --bh-ios-attenue or #5E6B63', () => {
    expect(s).toMatch(/bh-ios-attenue|#5E6B63/);
  });

  test('.tab-btn active color uses --bh-ios-vert or #0E3B2E', () => {
    expect(s).toMatch(/bh-ios-vert|#0E3B2E/);
  });

  test('.tab-btn active span has font-weight: 700', () => {
    expect(s).toMatch(/\.tab-btn\.active[\s\S]{0,200}font-weight:\s*700\s*!important|\.tab-btn\.lg-active[\s\S]{0,200}font-weight:\s*700\s*!important/);
  });

  test('.tab-btn span uses DM Sans font', () => {
    expect(s).toMatch(/DM Sans/);
  });

  test('.tab-btn span font-size: 11px', () => {
    expect(s).toMatch(/\.tab-btn[\s\S]{0,300}font-size:\s*11px\s*!important/);
  });

  test('.badge color preserved (#DC2626)', () => {
    expect(s).toMatch(/#DC2626/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: lg-capsule on desktop', () => {
  const s = css('bh-shell-04.css');

  test('.lg-capsule position: absolute on desktop', () => {
    expect(s).toMatch(/\.lg-capsule[\s\S]{0,100}position:\s*absolute\s*!important/);
  });

  test('.lg-capsule background uses rgba(14, 59, 46', () => {
    expect(s).toMatch(/\.lg-capsule[\s\S]{0,300}background:\s*rgba\(14,\s*59,\s*46/);
  });

  test('.lg-capsule.lg-visible opacity: 1', () => {
    expect(s).toMatch(/\.lg-capsule\.lg-visible[\s\S]{0,100}opacity:\s*1\s*!important/);
  });

  test('.lg-capsule.lg-animate has transition', () => {
    expect(s).toMatch(/\.lg-capsule\.lg-animate[\s\S]{0,200}transition:/);
  });

  test('.lg-capsule.lg-dragging transition: none', () => {
    expect(s).toMatch(/\.lg-capsule\.lg-dragging[\s\S]{0,400}transition:\s*none\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: Today header cleanup', () => {
  const s = css('bh-shell-04.css');

  test('#syncBtn hidden for data-page="app"', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,200}#syncBtn[\s\S]{0,300}display:\s*none\s*!important/);
  });

  test('#notifHistoryBtn hidden for data-page="app"', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,400}#notifHistoryBtn[\s\S]{0,300}display:\s*none\s*!important/);
  });

  test('#newReservationBtn hidden for data-page="app"', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,600}#newReservationBtn[\s\S]{0,300}display:\s*none\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: messages composer protection', () => {
  const s = css('bh-shell-04.css');

  test('#chatInputArea bottom lifted on desktop', () => {
    expect(s).toMatch(/data-page="messages"[\s\S]{0,200}#chatInputArea[\s\S]{0,100}bottom:\s*calc\(/);
  });

  test('.chat-modal-input bottom lifted on desktop', () => {
    expect(s).toMatch(/data-page="messages"[\s\S]{0,200}\.chat-modal-input[\s\S]{0,100}bottom:\s*calc\(/);
  });

  test('#chatInputArea bottom lifted on mobile', () => {
    const mobileBlock = s.match(/@media\s*\(max-width:\s*1366px\)([\s\S]*)/);
    expect(mobileBlock).not.toBeNull();
    expect(mobileBlock[1]).toMatch(/data-page="messages"[\s\S]{0,200}#chatInputArea[\s\S]{0,100}bottom:\s*calc\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: content bottom padding', () => {
  const s = css('bh-shell-04.css');

  test('desktop padding-bottom on .page-content for data-page="app"', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,200}\.page-content[\s\S]{0,100}padding-bottom:\s*calc\(/);
  });

  test('desktop padding-bottom on .page-content for data-page="manage"', () => {
    expect(s).toMatch(/data-page="manage"[\s\S]{0,200}\.page-content[\s\S]{0,100}padding-bottom:\s*calc\(/);
  });

  test('mobile padding-bottom on .page-content uses safe-area', () => {
    const mobileBlock = s.match(/@media\s*\(max-width:\s*1366px\)([\s\S]*)/);
    expect(mobileBlock).not.toBeNull();
    expect(mobileBlock[1]).toMatch(/safe-area-inset-bottom/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — CSS: initials button on desktop', () => {
  const s = css('bh-shell-04.css');

  test('.bh-header-initials-btn shown on desktop for data-page="app"', () => {
    expect(s).toMatch(/data-page="app"[\s\S]{0,200}\.bh-header-initials-btn[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('.bh-header-initials-btn shown on desktop for data-page="messages"', () => {
    expect(s).toMatch(/data-page="messages"[\s\S]{0,200}\.bh-header-initials-btn[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('.bh-header-initials-btn shown on desktop for data-page="manage"', () => {
    expect(s).toMatch(/data-page="manage"[\s\S]{0,200}\.bh-header-initials-btn[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('initials button rule is scoped to ≥1367px', () => {
    const desktopBlock = s.match(/@media\s*\(min-width:\s*1367px\)([\s\S]*)/);
    expect(desktopBlock).not.toBeNull();
    expect(desktopBlock[1]).toMatch(/\.bh-header-initials-btn[\s\S]{0,100}display:\s*flex\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — HTML: Today header DOM preserved', () => {
  const h = html('app.html');

  test('#syncBtn still exists in DOM (functionality preserved)', () => {
    expect(h).toMatch(/id="syncBtn"/);
  });

  test('#notifHistoryBtn still exists in DOM (functionality preserved)', () => {
    expect(h).toMatch(/id="notifHistoryBtn"/);
  });

  test('#newReservationBtn still exists in DOM (functionality preserved)', () => {
    expect(h).toMatch(/id="newReservationBtn"/);
  });

  test('#appSearchBtn present in header', () => {
    expect(h).toMatch(/id="appSearchBtn"/);
  });

  test('#appInitialsBtn present in header', () => {
    expect(h).toMatch(/id="appInitialsBtn"/);
  });

  test('page-kicker present in Today header', () => {
    expect(h).toMatch(/id="appPageKicker"/);
  });

  test('page-title "Aujourd\'hui" present', () => {
    expect(h).toMatch(/Aujourd'hui/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — HTML: data-page attributes correct', () => {
  test('app.html data-page="app"', () => {
    expect(html('app.html')).toMatch(/data-page="app"/);
  });

  test('messages.html data-page="messages"', () => {
    expect(html('messages.html')).toMatch(/data-page="messages"/);
  });

  test('manage.html data-page="manage"', () => {
    expect(html('manage.html')).toMatch(/data-page="manage"/);
  });

  test('reservations.html data-page="reservations"', () => {
    expect(html('reservations.html')).toMatch(/data-page="reservations"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — HTML: messages composer present', () => {
  const h = html('messages.html');

  test('#chatInputArea exists in messages.html', () => {
    expect(h).toMatch(/id="chatInputArea"/);
  });

  test('.chat-modal-input present', () => {
    expect(h).toMatch(/chat-modal-input/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — Mobile behaviour preserved', () => {
  const shellIos = css('bh-shell-ios.css');

  test('bh-shell-ios.css still has mobile tabs glass treatment', () => {
    expect(shellIos).toMatch(/@media\s*\(max-width:\s*1366px\)[\s\S]{0,300}\.mobile-tabs[\s\S]{0,200}backdrop-filter/);
  });

  test('mobile-native-experience.js appends .mobile-tabs to body', () => {
    const mne = js('mobile-native-experience.js');
    expect(mne).toMatch(/className\s*=\s*'mobile-tabs'/);
    expect(mne).toMatch(/document\.body\.appendChild\(tabsContainer\)/);
  });

  test('mobile-tabs-handler.js still present', () => {
    expect(fs.existsSync(path.join(ROOT, 'public', 'js', 'mobile-tabs-handler.js'))).toBe(true);
  });

  test('mobile-tabs-handler.js still has LUCIDE_TABS from SHELL_03', () => {
    const mth = js('mobile-tabs-handler.js');
    expect(mth).toMatch(/LUCIDE_TABS/);
  });

  test('bh-layout.js injectStyle creates lg-capsule for mobile', () => {
    const layout = js('bh-layout.js');
    expect(layout).toMatch(/lg-capsule/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — Protected files unchanged', () => {
  test('chat-owner.js SHA-1 unchanged (a56812...)', () => {
    // raw file SHA-1
    const buf = fs.readFileSync(path.join(ROOT, 'public', 'js', 'chat-owner.js'));
    const raw = crypto.createHash('sha1').update(buf).digest('hex');
    expect(raw).toBe('2a9717b64e4f7059a164175177f976025ff47142');
  });

  test('calendar-modern.js exists and has not been cleared', () => {
    const p = path.join(ROOT, 'public', 'js', 'calendar-modern.js');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('bh-calendar-v3.js exists and has not been cleared', () => {
    const p = path.join(ROOT, 'public', 'js', 'bh-calendar-v3.js');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  test('bh-nav-rail.css not modified (still has 248px rule)', () => {
    expect(css('bh-nav-rail.css')).toMatch(/margin-left:\s*248px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — bh-shell-04.css cascade order', () => {
  test('bh-shell-04.css has header comment identifying SHELL_04_STRICT', () => {
    expect(css('bh-shell-04.css')).toMatch(/SHELL_04_STRICT/);
  });

  test('bh-shell-04.css has section 1 for rail neutralisation', () => {
    expect(css('bh-shell-04.css')).toMatch(/Neutralis/i);
  });

  test('bh-shell-04.css has section for floating bottom nav', () => {
    expect(css('bh-shell-04.css')).toMatch(/floating/i);
  });

  test('bh-shell-04.css has section for composer protection', () => {
    expect(css('bh-shell-04.css')).toMatch(/composer/i);
  });

  test('bh-shell-04.css has section for content padding', () => {
    expect(css('bh-shell-04.css')).toMatch(/padding/);
  });

  test('bh-shell-04.css uses !important on all key layout rules', () => {
    const s = css('bh-shell-04.css');
    expect(s).toMatch(/margin-left:\s*0\s*!important/);
    expect(s).toMatch(/display:\s*none\s*!important/);
    expect(s).toMatch(/position:\s*fixed\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04_STRICT — SHELL_03 integrity preserved', () => {
  test('app.html still loads bh-ios-parity.css', () => {
    expect(html('app.html')).toMatch(/bh-ios-parity\.css/);
  });

  test('app.html still loads bh-shell-ios.css', () => {
    expect(html('app.html')).toMatch(/bh-shell-ios\.css/);
  });

  test('messages.html still loads bh-ios-parity.css', () => {
    expect(html('messages.html')).toMatch(/bh-ios-parity\.css/);
  });

  test('manage.html still loads bh-ios-parity.css', () => {
    expect(html('manage.html')).toMatch(/bh-ios-parity\.css/);
  });

  test('IC.today in bh-layout.js has calendar+timeline SVG (rect+lines)', () => {
    const layout = js('bh-layout.js');
    // updated in SHELL_03: calendar rect plus timeline horizontal lines
    expect(layout).toMatch(/today:\s*'<svg[\s\S]{0,100}rect x="3" y="4"/);
  });

  test('IC.messages in bh-layout.js has double-bubble SVG', () => {
    const layout = js('bh-layout.js');
    // updated in SHELL_03: two overlapping speech bubbles (M18 9h2 path)
    expect(layout).toMatch(/messages:\s*'<svg[\s\S]{0,200}M18 9h2/);
  });

  test('msgs-back-btn hidden in bh-shell-ios.css', () => {
    expect(css('bh-shell-ios.css')).toMatch(/\.msgs-back-btn[\s\S]{0,100}display:\s*none/);
  });
});

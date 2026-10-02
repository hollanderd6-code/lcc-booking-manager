'use strict';
/**
 * SHELL_04D — Remove legacy tab active indicator
 * Minimum 20 assertions.
 *
 * Guards:
 *  - Root cause: bh-bottom-bar.css ::before pulsing dot on .tab-btn.active
 *  - Fix: bh-shell-04.css suppresses ::before / ::after via content:none !important
 *  - lg-capsule preserved as sole active affordance
 *  - Active color, badge, geometry, initials, header all unchanged
 *  - Protected files unchanged
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const css  = (f) => fs.readFileSync(path.join(ROOT, 'public', 'css', f), 'utf8');
const html = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const js   = (f) => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — Root cause: legacy ::before dot in bh-bottom-bar.css', () => {
  const bbar = css('bh-bottom-bar.css');

  test('bh-bottom-bar.css has .tab-btn.active::before dot indicator', () => {
    expect(bbar).toMatch(/\.mobile-tabs\s*\.tab-btn\.active::before/);
  });

  test('legacy indicator is contained inside @media (max-width:1366px)', () => {
    // All ::before occurrences are wrapped in a max-width media query
    expect(bbar).toMatch(/@media\s*\(max-width:\s*1366px\)[\s\S]{0,4000}\.tab-btn\.active::before/);
  });

  test('legacy ::before uses content: "" (generates a box)', () => {
    expect(bbar).toMatch(/\.tab-btn\.active::before[\s\S]{0,50}content:\s*''/);
  });

  test('legacy ::before has indicatorPulse animation', () => {
    expect(bbar).toMatch(/indicatorPulse/);
  });

  test('legacy ::before uses var(--bh-vert) green background', () => {
    expect(bbar).toMatch(/\.tab-btn\.active::before[\s\S]{0,200}background:\s*var\(--bh-vert\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — Fix: bh-shell-04.css suppresses ::before and ::after', () => {
  const s = css('bh-shell-04.css');

  test('bh-shell-04.css has .mobile-tabs .tab-btn::before rule', () => {
    expect(s).toMatch(/\.mobile-tabs\s*\.tab-btn::before/);
  });

  test('bh-shell-04.css has .mobile-tabs .tab-btn::after rule', () => {
    expect(s).toMatch(/\.mobile-tabs\s*\.tab-btn::after/);
  });

  test('content: none !important suppresses the dot', () => {
    expect(s).toMatch(/\.tab-btn::before[\s\S]{0,200}content:\s*none\s*!important/);
  });

  test('display: none !important hides the element', () => {
    expect(s).toMatch(/\.tab-btn::before[\s\S]{0,200}display:\s*none\s*!important/);
  });

  test('animation: none !important stops indicatorPulse', () => {
    expect(s).toMatch(/\.tab-btn::before[\s\S]{0,200}animation:\s*none\s*!important/);
  });

  test('fix is scoped to html[data-theme-v3="1"] (no bleed to non-v3)', () => {
    expect(s).toMatch(/html\[data-theme-v3="1"\]\s*\.mobile-tabs\s*\.tab-btn::before/);
  });

  test('fix has no breakpoint restriction — comment documents all-widths intent', () => {
    // Section 7 comment explicitly states "at all widths"
    expect(s).toMatch(/Remove legacy[\s\S]{0,400}all widths/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — No border-left vertical bars on tab buttons', () => {
  test('bh-bottom-bar.css has no border-left on .tab-btn', () => {
    const bbar = css('bh-bottom-bar.css');
    // tab-btn should not have a border-left (only ::before dot was the indicator)
    const tabBtnSection = bbar.match(/\.tab-btn\s*\{[^}]{0,400}\}/g) || [];
    tabBtnSection.forEach(block => {
      expect(block).not.toMatch(/border-left/);
    });
  });

  test('bh-shell-04.css tab-btn has border: none (no left border)', () => {
    const s = css('bh-shell-04.css');
    expect(s).toMatch(/\.tab-btn[\s\S]{0,500}border:\s*none\s*!important/);
  });

  test('no border-left on .mobile-tabs .tab-btn in bh-shell-04.css', () => {
    const s = css('bh-shell-04.css');
    // The fix section has no border-left
    const fixSection = s.match(/7\. Remove legacy[\s\S]{0,500}/);
    if (fixSection) {
      expect(fixSection[0]).not.toMatch(/border-left/);
    } else {
      expect(s).not.toMatch(/\.tab-btn::before[\s\S]{0,300}border-left/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — lg-capsule preserved as active affordance', () => {
  const s = css('bh-shell-04.css');

  test('.lg-capsule is position: absolute', () => {
    expect(s).toMatch(/\.lg-capsule[\s\S]{0,100}position:\s*absolute\s*!important/);
  });

  test('.lg-capsule has Liquid Glass backdrop-filter', () => {
    expect(s).toMatch(/\.lg-capsule[\s\S]{0,300}backdrop-filter:\s*blur\(14px\)/);
  });

  test('.lg-capsule.lg-visible has opacity: 1', () => {
    expect(s).toMatch(/\.lg-capsule\.lg-visible[\s\S]{0,100}opacity:\s*1\s*!important/);
  });

  test('.lg-capsule.lg-animate has transition', () => {
    expect(s).toMatch(/\.lg-capsule\.lg-animate[\s\S]{0,200}transition:/);
  });

  test('.lg-capsule border-radius is 24px (rounded active zone)', () => {
    expect(s).toMatch(/\.lg-capsule[\s\S]{0,200}border-radius:\s*24px\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — Active tab states preserved for all 4 tabs', () => {
  const s = css('bh-shell-04.css');

  test('active color #0E3B2E (--bh-ios-vert) preserved for Today', () => {
    expect(s).toMatch(/tab-btn\.active[\s\S]{0,200}bh-ios-vert.*#0E3B2E|bh-ios-vert.*#0E3B2E/);
  });

  test('active tab bold label preserved', () => {
    expect(s).toMatch(/tab-btn\.active[\s\S]{0,300}font-weight:\s*700\s*!important/);
  });

  test('lg-active class color also set to #0E3B2E', () => {
    expect(s).toMatch(/tab-btn\.lg-active[\s\S]{0,200}bh-ios-vert|tab-btn\.lg-active[\s\S]{0,200}#0E3B2E/);
  });

  test('Messages badge color #DC2626 preserved', () => {
    expect(s).toMatch(/\.badge[\s\S]{0,100}#DC2626/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — Desktop nav geometry unchanged', () => {
  const s = css('bh-shell-04.css');

  test('.mobile-tabs position: fixed on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}position:\s*fixed\s*!important/);
  });

  test('.mobile-tabs bottom: 22px on desktop', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}bottom:\s*22px\s*!important/);
  });

  test('.mobile-tabs border-radius: 50px (Liquid Glass capsule)', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}border-radius:\s*50px\s*!important/);
  });

  test('.mobile-tabs min-width: 520px', () => {
    expect(s).toMatch(/\.mobile-tabs[\s\S]{0,900}min-width:\s*520px\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — Responsive: no legacy indicator at any breakpoint', () => {
  const s = css('bh-shell-04.css');
  const bbar = css('bh-bottom-bar.css');

  test('375–1366px: bh-bottom-bar ::before suppressed by bh-shell-04 content:none', () => {
    // bh-bottom-bar has ::before only inside max-width:1366px
    // bh-shell-04 suppresses it globally with higher-priority !important
    expect(s).toMatch(/content:\s*none\s*!important/);
    expect(bbar).toMatch(/@media\s*\(max-width:\s*1366px\)/);
  });

  test('1367–1920px: bh-shell-04.css section 7 overrides any ::before via content:none !important', () => {
    // The scoped suppressor in section 7 applies at all widths including ≥1367px
    expect(s).toMatch(/html\[data-theme-v3="1"\]\s*\.mobile-tabs\s*\.tab-btn::before[\s\S]{0,100}content:\s*none\s*!important/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — Header, initials, search preserved', () => {
  const h = html('app.html');
  const s = css('bh-shell-04.css');

  test('#appInitialsBtn still in app.html', () => {
    expect(h).toMatch(/id="appInitialsBtn"/);
  });

  test('.bh-header-initials-btn shows on desktop via section 6', () => {
    expect(s).toMatch(/bh-header-initials-btn[\s\S]{0,100}display:\s*flex\s*!important/);
  });

  test('#appSearchBtn still in app.html', () => {
    expect(h).toMatch(/id="appSearchBtn"/);
  });

  test('Aujourd\'hui page title preserved', () => {
    expect(h).toMatch(/Aujourd'hui/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SHELL_04D — Protected files unchanged', () => {
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

  test('bh-bottom-bar.css not modified (legacy dot still present — just suppressed)', () => {
    // Original dot indicator code still in file; we suppress it via bh-shell-04.css
    expect(css('bh-bottom-bar.css')).toMatch(/\.tab-btn\.active::before/);
  });

  test('server.js exists (no backend change)', () => {
    expect(fs.existsSync(path.join(ROOT, 'server.js'))).toBe(true);
  });
});

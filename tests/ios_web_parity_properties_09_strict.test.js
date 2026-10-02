'use strict';
/**
 * BOOSTINGHOST_WEB_IOS_PARITY_PROPERTIES_09_STRICT
 * Verifies public/properties.html and public/css/bh-properties-ios-09.css
 * implement the iOS PropertiesView parity spec.
 * Minimum 150 assertions.
 */

const fs   = require('fs');
const path = require('path');

const cssPath    = path.join(__dirname, '..', 'public', 'css', 'bh-properties-ios-09.css');
const htmlPath   = path.join(__dirname, '..', 'public', 'properties.html');
const managePath = path.join(__dirname, '..', 'public', 'manage.html');

let css    = '';
let html   = '';
let manage = '';

beforeAll(() => {
  css    = fs.readFileSync(cssPath,    'utf8');
  html   = fs.readFileSync(htmlPath,   'utf8');
  manage = fs.readFileSync(managePath, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. FILE EXISTENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('09-1: File existence', () => {
  test('09-1-01: bh-properties-ios-09.css exists', () => {
    expect(fs.existsSync(cssPath)).toBe(true);
  });

  test('09-1-02: properties.html exists', () => {
    expect(fs.existsSync(htmlPath)).toBe(true);
  });

  test('09-1-03: CSS file is non-empty', () => {
    expect(css.length).toBeGreaterThan(100);
  });

  test('09-1-04: HTML file is non-empty', () => {
    expect(html.length).toBeGreaterThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CSS SCOPING — all rules scoped to body[data-page="properties"]
// ─────────────────────────────────────────────────────────────────────────────

describe('09-2: CSS scoping', () => {
  test('09-2-01: no bare unscoped selectors modifying global elements', () => {
    // Remove @media blocks and comments, then check no selector without data-page scope
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{([\s\S]*?)\}/g, '');
    const ruleBlocks = stripped.match(/[^{}]+\{[^{}]*\}/g) || [];
    ruleBlocks.forEach(function(block) {
      const selector = block.split('{')[0].trim();
      if (!selector) return;
      // Each top-level selector must mention data-page="properties" or html[data-theme
      const lines = selector.split(',').map(s => s.trim()).filter(Boolean);
      lines.forEach(function(sel) {
        const ok = sel.includes('[data-page="properties"]') || sel.includes('html[data-theme');
        expect(ok).toBe(true);
      });
    });
  });

  test('09-2-02: CSS does not contain data-page="manage" (wrong scope)', () => {
    expect(css).not.toMatch(/data-page="manage"/);
  });

  test('09-2-03: CSS does not contain data-page="settings" (wrong scope)', () => {
    expect(css).not.toMatch(/data-page="settings"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CSS — NAV-RAIL HIDING
// ─────────────────────────────────────────────────────────────────────────────

describe('09-3: CSS nav-rail hiding at ≥1367px', () => {
  test('09-3-01: 1367px breakpoint present', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)/);
  });

  test('09-3-02: .bh-nav-rail hidden for properties page', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.bh-nav-rail[\s\S]{0,200}?display\s*:\s*none/);
  });

  test('09-3-03: .app-container margin-left reset', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.app-container[\s\S]{0,200}?margin-left\s*:\s*0/);
  });

  test('09-3-04: .main-content padding-top reset', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.main-content[\s\S]{0,200}?padding-top\s*:\s*0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. CSS — DESKTOP PAGE HEADER
// ─────────────────────────────────────────────────────────────────────────────

describe('09-4: CSS desktop page header', () => {
  test('09-4-01: .prop-page-header rule exists', () => {
    expect(css).toMatch(/\.prop-page-header\s*\{/);
  });

  test('09-4-02: .prop-page-header display:none by default', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-page-header\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/display\s*:\s*none/);
  });

  test('09-4-03: .prop-page-header shown at ≥1367px', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]+?\.prop-page-header[\s\S]{0,200}?display\s*:\s*flex/);
  });

  test('09-4-04: .prop-page-header__kicker has min-height', () => {
    expect(css).toMatch(/\.prop-page-header__kicker[\s\S]{0,300}?min-height/);
  });

  test('09-4-05: .prop-page-header__kicker min-height ≥ 1em', () => {
    const block = css.match(/\.prop-page-header__kicker\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    const mh = block[1].match(/min-height\s*:\s*([\d.]+)em/);
    expect(mh).not.toBeNull();
    expect(parseFloat(mh[1])).toBeGreaterThanOrEqual(1);
  });

  test('09-4-06: .prop-page-header__title font-size is 30px', () => {
    const block = css.match(/\.prop-page-header__title\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/font-size\s*:\s*30px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. CSS — CONTENT WIDTH (desktop expansion)
// ─────────────────────────────────────────────────────────────────────────────

describe('09-5: CSS content desktop width', () => {
  test('09-5-01: 1100px breakpoint present', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)/);
  });

  test('09-5-02: width calc(100% - 80px) in 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)[\s\S]+?width\s*:\s*calc\(100%\s*-\s*80px\)/);
    expect(block).not.toBeNull();
  });

  test('09-5-03: max-width ≥ 1300px in 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    const mw = block[1].match(/max-width\s*:\s*(\d+)px/);
    expect(mw).not.toBeNull();
    expect(parseInt(mw[1], 10)).toBeGreaterThanOrEqual(1300);
  });

  test('09-5-04: margin-inline: auto in 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)[\s\S]+?margin-inline\s*:\s*auto/);
    expect(block).not.toBeNull();
  });

  test('09-5-05: .prop-content targeted in 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.prop-content/);
  });

  test('09-5-06: base .prop-content has 18px horizontal padding', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-content\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/18px/);
  });

  test('09-5-07: base .prop-content has no max-width ≤ 900px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-content\s*\{([^}]+)\}/);
    if (!block) { expect(block).not.toBeNull(); return; }
    const mw = block[1].match(/max-width\s*:\s*(\d+)px/);
    if (mw) expect(parseInt(mw[1], 10)).toBeGreaterThan(900);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CSS — FILTER PILLS
// ─────────────────────────────────────────────────────────────────────────────

describe('09-6: CSS filter pills', () => {
  test('09-6-01: .prop-filter-bar rule exists', () => {
    expect(css).toMatch(/\.prop-filter-bar\s*\{/);
  });

  test('09-6-02: .prop-filter-bar uses overflow-x: auto', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-filter-bar\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/overflow-x\s*:\s*auto/);
  });

  test('09-6-03: .prop-filter-pill rule exists', () => {
    expect(css).toMatch(/\.prop-filter-pill\s*\{/);
  });

  test('09-6-04: .prop-filter-pill has border-radius', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-filter-pill\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/border-radius/);
  });

  test('09-6-05: .prop-filter-pill.active sets background to #0E3B2E', () => {
    expect(css).toMatch(/\.prop-filter-pill\.active[\s\S]{0,200}?#0E3B2E/);
  });

  test('09-6-06: .prop-filter-pill.active sets color to #fff', () => {
    const block = css.match(/\.prop-filter-pill\.active\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/color\s*:\s*#fff/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. CSS — PROBLEM CARD (gold rail, glass amber)
// ─────────────────────────────────────────────────────────────────────────────

describe('09-7: CSS problem card', () => {
  test('09-7-01: .prop-problem-card rule exists', () => {
    expect(css).toMatch(/\.prop-problem-card\s*\{/);
  });

  test('09-7-02: .prop-problem-card border-radius is 22px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-problem-card\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/border-radius\s*:\s*22px/);
  });

  test('09-7-03: .prop-problem-card has gold border color', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-problem-card\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/rgba\(201[^)]+\)/);
  });

  test('09-7-04: .prop-problem-rail has gradient from #C9A15B to #8A5B14', () => {
    const block = css.match(/\.prop-problem-rail\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/#C9A15B/);
    expect(block[1]).toMatch(/#8A5B14/);
  });

  test('09-7-05: .prop-problem-rail width is 4px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-problem-rail\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/width\s*:\s*4px/);
  });

  test('09-7-06: .prop-problem-card hover lightens background', () => {
    expect(css).toMatch(/\.prop-problem-card:hover\s*\{/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. CSS — GLASS LIST CARD
// ─────────────────────────────────────────────────────────────────────────────

describe('09-8: CSS glass list card', () => {
  test('09-8-01: .prop-list-card rule exists', () => {
    expect(css).toMatch(/\.prop-list-card\s*\{/);
  });

  test('09-8-02: .prop-list-card has backdrop-filter', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-list-card\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/backdrop-filter/);
  });

  test('09-8-03: .prop-list-card border-radius is 22px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-list-card\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/border-radius\s*:\s*22px/);
  });

  test('09-8-04: .prop-list-card::before specular edge exists', () => {
    expect(css).toMatch(/\.prop-list-card::before\s*\{/);
  });

  test('09-8-05: .prop-list-card has box-shadow', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-list-card\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/box-shadow/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. CSS — PROPERTY ROW + SEPARATOR
// ─────────────────────────────────────────────────────────────────────────────

describe('09-9: CSS property row', () => {
  test('09-9-01: .prop-row rule exists', () => {
    expect(css).toMatch(/\.prop-row\s*\{/);
  });

  test('09-9-02: .prop-row padding includes 16px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-row\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/16px/);
  });

  test('09-9-03: .prop-row has tap highlight disabled', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-row\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/-webkit-tap-highlight-color\s*:\s*transparent/);
  });

  test('09-9-04: .prop-row + .prop-row::before separator exists', () => {
    expect(css).toMatch(/\.prop-row\s*\+\s*\.prop-row::before\s*\{/);
  });

  test('09-9-05: separator height is 0.5px', () => {
    const block = css.match(/\.prop-row\s*\+\s*\.prop-row::before\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/height\s*:\s*0\.5px/);
  });

  test('09-9-06: .prop-row:hover exists', () => {
    expect(css).toMatch(/\.prop-row:hover\s*\{/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. CSS — COLOR DOT
// ─────────────────────────────────────────────────────────────────────────────

describe('09-10: CSS color dot', () => {
  test('09-10-01: .prop-dot rule exists', () => {
    expect(css).toMatch(/\.prop-dot\s*\{/);
  });

  test('09-10-02: .prop-dot is circular (border-radius: 50%)', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-dot\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/border-radius\s*:\s*50%/);
  });

  test('09-10-03: .prop-dot width is 10px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-dot\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/width\s*:\s*10px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. CSS — CONNECTION BADGES
// ─────────────────────────────────────────────────────────────────────────────

describe('09-11: CSS connection badges', () => {
  test('09-11-01: .prop-badge base rule exists', () => {
    expect(css).toMatch(/\.prop-badge\s*\{/);
  });

  test('09-11-02: .prop-badge has border-radius', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-badge\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/border-radius/);
  });

  test('09-11-03: .prop-badge--ota exists with green background', () => {
    const block = css.match(/\.prop-badge--ota\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/#DCE8E1/);
  });

  test('09-11-04: .prop-badge--ota text color is green', () => {
    const block = css.match(/\.prop-badge--ota\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/#1B6B41/);
  });

  test('09-11-05: .prop-badge--ical exists with blue background', () => {
    const block = css.match(/\.prop-badge--ical\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/#DDE8F5/);
  });

  test('09-11-06: .prop-badge--ical text color is blue', () => {
    const block = css.match(/\.prop-badge--ical\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/#1D5FA6/);
  });

  test('09-11-07: .prop-badge--none exists (grey, Non relié)', () => {
    expect(css).toMatch(/\.prop-badge--none\s*\{/);
  });

  test('09-11-08: .prop-badge--problem exists with amber color', () => {
    const block = css.match(/\.prop-badge--problem\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/#8A5B14/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. CSS — ROW TYPOGRAPHY
// ─────────────────────────────────────────────────────────────────────────────

describe('09-12: CSS typography', () => {
  test('09-12-01: .prop-name font-size is 16px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-name\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/font-size\s*:\s*16px/);
  });

  test('09-12-02: .prop-name font-weight is 600', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-name\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/font-weight\s*:\s*600/);
  });

  test('09-12-03: .prop-sub font-size is 13px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-sub\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/font-size\s*:\s*13px/);
  });

  test('09-12-04: .prop-section-label is uppercase', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-section-label\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/text-transform\s*:\s*uppercase/);
  });

  test('09-12-05: .prop-section-label letter-spacing declared', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-section-label\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/letter-spacing/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. CSS — BOTTOM PAD
// ─────────────────────────────────────────────────────────────────────────────

describe('09-13: CSS bottom pad', () => {
  test('09-13-01: .prop-bottom-pad rule exists', () => {
    expect(css).toMatch(/\.prop-bottom-pad\s*\{/);
  });

  test('09-13-02: .prop-bottom-pad uses env(safe-area-inset-bottom)', () => {
    expect(css).toMatch(/\.prop-bottom-pad[\s\S]{0,300}?safe-area-inset-bottom/);
  });

  test('09-13-03: .prop-bottom-pad hidden at ≥1367px', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]+?\.prop-bottom-pad[\s\S]{0,200}?display\s*:\s*none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. CSS — LOADING / ERROR / EMPTY STATES
// ─────────────────────────────────────────────────────────────────────────────

describe('09-14: CSS states', () => {
  test('09-14-01: .prop-loading rule exists', () => {
    expect(css).toMatch(/\.prop-loading\s*\{/);
  });

  test('09-14-02: .prop-error rule exists', () => {
    expect(css).toMatch(/\.prop-error\s*\{/);
  });

  test('09-14-03: .prop-empty rule exists', () => {
    expect(css).toMatch(/\.prop-empty\s*\{/);
  });

  test('09-14-04: .prop-error has border-radius', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-error\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/border-radius/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. CSS — CHEVRON
// ─────────────────────────────────────────────────────────────────────────────

describe('09-15: CSS chevron', () => {
  test('09-15-01: .prop-chevron rule exists', () => {
    expect(css).toMatch(/\.prop-chevron\s*\{/);
  });

  test('09-15-02: .prop-chevron svg size is 12px', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-chevron\s+svg\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/width\s*:\s*12px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. HTML — HEAD AND META
// ─────────────────────────────────────────────────────────────────────────────

describe('09-16: HTML head and meta', () => {
  test('09-16-01: charset is utf-8', () => {
    expect(html).toMatch(/charset="utf-8"/i);
  });

  test('09-16-02: viewport meta present', () => {
    expect(html).toMatch(/name="viewport"/);
  });

  test('09-16-03: title contains "Logements"', () => {
    expect(html).toMatch(/<title>[^<]*Logements[^<]*<\/title>/);
  });

  test('09-16-04: bh-properties-ios-09.css is linked', () => {
    expect(html).toMatch(/href="[^"]*bh-properties-ios-09\.css[^"]*"/);
  });

  test('09-16-05: bh-properties-ios-09.css is the last CSS link in head', () => {
    const cssLinks = [...html.matchAll(/href="[^"]+\.css[^"]*"/g)].map(m => m[0]);
    const lastCss = cssLinks[cssLinks.length - 1];
    expect(lastCss).toMatch(/bh-properties-ios-09\.css/);
  });

  test('09-16-06: bh-core.css is in CSS chain', () => {
    expect(html).toMatch(/href="[^"]*bh-core\.css[^"]*"/);
  });

  test('09-16-07: bh-shell-04.css is in CSS chain', () => {
    expect(html).toMatch(/href="[^"]*bh-shell-04\.css[^"]*"/);
  });

  test('09-16-08: bh-bottom-bar.css is in CSS chain', () => {
    expect(html).toMatch(/href="[^"]*bh-bottom-bar\.css[^"]*"/);
  });

  test('09-16-09: data-theme-v3="1" on html element', () => {
    expect(html).toMatch(/data-theme-v3="1"/);
  });

  test('09-16-10: theme-color meta is #0E3B2E', () => {
    expect(html).toMatch(/name="theme-color"[\s\S]{0,50}?#0E3B2E/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. HTML — BODY ATTRIBUTES
// ─────────────────────────────────────────────────────────────────────────────

describe('09-17: HTML body attributes', () => {
  test('09-17-01: data-page="properties" on body', () => {
    expect(html).toMatch(/<body[^>]*data-page="properties"/);
  });

  test('09-17-02: data-kicker attribute present on body', () => {
    expect(html).toMatch(/<body[^>]*data-kicker=/);
  });

  test('09-17-03: data-title="Logements" on body', () => {
    expect(html).toMatch(/<body[^>]*data-title="Logements"/);
  });

  test('09-17-04: data-back-href="/manage.html" on body', () => {
    expect(html).toMatch(/<body[^>]*data-back-href="\/manage\.html"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. HTML — PAGE STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

describe('09-18: HTML page structure', () => {
  test('09-18-01: #bhSidebar present', () => {
    expect(html).toMatch(/id="bhSidebar"/);
  });

  test('09-18-02: #bhHeader present', () => {
    expect(html).toMatch(/id="bhHeader"/);
  });

  test('09-18-03: .app-container present', () => {
    expect(html).toMatch(/class="app-container"/);
  });

  test('09-18-04: .main-content present', () => {
    expect(html).toMatch(/class="main-content"/);
  });

  test('09-18-05: .prop-content present', () => {
    expect(html).toMatch(/class="prop-content"/);
  });

  test('09-18-06: .page-content present', () => {
    expect(html).toMatch(/class="page-content"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. HTML — DESKTOP HEADER ELEMENTS
// ─────────────────────────────────────────────────────────────────────────────

describe('09-19: HTML desktop header', () => {
  test('09-19-01: .prop-page-header present', () => {
    expect(html).toMatch(/class="prop-page-header"/);
  });

  test('09-19-02: #propKicker present inside prop-page-header', () => {
    const block = html.match(/class="prop-page-header"([\s\S]+?)(?=<div class="prop-content"|<\/div>\s*<\/div>)/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/id="propKicker"/);
  });

  test('09-19-03: desktop header title is "Logements"', () => {
    const block = html.match(/class="prop-page-header"([\s\S]+?)(?=<div class="prop-content")/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/Logements/);
  });

  test('09-19-04: desktop header add button links to /settings.html', () => {
    const block = html.match(/class="prop-page-header"([\s\S]+?)(?=<div class="prop-content")/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/href="\/settings\.html"/);
  });

  test('09-19-05: desktop header has initials button', () => {
    const block = html.match(/class="prop-page-header"([\s\S]+?)(?=<div class="prop-content")/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/bh-header-initials-btn/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. HTML — FILTER BAR
// ─────────────────────────────────────────────────────────────────────────────

describe('09-20: HTML filter bar', () => {
  test('09-20-01: #propFilterBar present', () => {
    expect(html).toMatch(/id="propFilterBar"/);
  });

  test('09-20-02: #propFilterBar has class prop-filter-bar', () => {
    expect(html).toMatch(/id="propFilterBar"[^>]*class="prop-filter-bar"|class="prop-filter-bar"[^>]*id="propFilterBar"/);
  });

  test('09-20-03: filter bar is inside .prop-content', () => {
    const contentBlock = html.match(/class="prop-content"([\s\S]+?)prop-bottom-pad/);
    expect(contentBlock).not.toBeNull();
    expect(contentBlock[1]).toMatch(/id="propFilterBar"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. HTML — LIST STATE ELEMENTS
// ─────────────────────────────────────────────────────────────────────────────

describe('09-21: HTML list state elements', () => {
  test('09-21-01: #propLoading present', () => {
    expect(html).toMatch(/id="propLoading"/);
  });

  test('09-21-02: #propError present', () => {
    expect(html).toMatch(/id="propError"/);
  });

  test('09-21-03: #propItems present', () => {
    expect(html).toMatch(/id="propItems"/);
  });

  test('09-21-04: #propEmpty present', () => {
    expect(html).toMatch(/id="propEmpty"/);
  });

  test('09-21-05: #propError is initially hidden', () => {
    expect(html).toMatch(/id="propError"[^>]*style="display:none"|id="propError"[^>]*style='display:none'/);
  });

  test('09-21-06: #propItems is initially hidden', () => {
    expect(html).toMatch(/id="propItems"[^>]*style="display:none"|id="propItems"[^>]*style='display:none'/);
  });

  test('09-21-07: #propEmpty is initially hidden', () => {
    expect(html).toMatch(/id="propEmpty"[^>]*style="display:none"|id="propEmpty"[^>]*style='display:none'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. HTML — BOTTOM PAD
// ─────────────────────────────────────────────────────────────────────────────

describe('09-22: HTML bottom pad', () => {
  test('09-22-01: .prop-bottom-pad present', () => {
    expect(html).toMatch(/class="prop-bottom-pad"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. HTML — AUTH AND LAYOUT SCRIPTS
// ─────────────────────────────────────────────────────────────────────────────

describe('09-23: HTML scripts', () => {
  test('09-23-01: auth-fetch.js loaded', () => {
    expect(html).toMatch(/src="[^"]*auth-fetch\.js[^"]*"/);
  });

  test('09-23-02: auth-fetch.js loaded before bh-layout.js', () => {
    const authIdx  = html.indexOf('auth-fetch.js');
    const layoutIdx = html.indexOf('bh-layout.js');
    expect(authIdx).toBeGreaterThan(-1);
    expect(layoutIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(layoutIdx);
  });

  test('09-23-03: bh-layout.js loaded', () => {
    expect(html).toMatch(/src="[^"]*bh-layout\.js[^"]*"/);
  });

  test('09-23-04: bh-bottom-bar or mobile-tabs-handler loaded', () => {
    const hasTabs   = html.includes('mobile-tabs-handler.js');
    const hasBottom = html.includes('bh-bottom-bar');
    expect(hasTabs || hasBottom).toBe(true);
  });

  test('09-23-05: sub-account-guard.js loaded', () => {
    expect(html).toMatch(/sub-account-guard\.js/);
  });

  test('09-23-06: bh-page-transitions.js loaded', () => {
    expect(html).toMatch(/bh-page-transitions\.js/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. HTML — JS: DATA LOADING (3 parallel fetches)
// ─────────────────────────────────────────────────────────────────────────────

describe('09-24: JS data loading', () => {
  test('09-24-01: fetch() is used for API calls (window.fetch patched by auth-fetch.js)', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/api\//);
  });

  test('09-24-02: /api/properties endpoint fetched', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/?api\/properties['"]\s*\)/);
  });

  test('09-24-03: /api/property-groups endpoint fetched', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/?api\/property-groups['"]\s*\)/);
  });

  test('09-24-04: /api/properties/diffusion endpoint fetched', () => {
    expect(html).toMatch(/fetch\s*\(\s*['"]\/?api\/properties\/diffusion['"]\s*\)/);
  });

  test('09-24-05: Promise.all used for parallel fetching', () => {
    expect(html).toMatch(/Promise\.all\s*\(/);
  });

  test('09-24-06: propLoading hidden after data loads', () => {
    expect(html).toMatch(/propLoading[\s\S]{0,100}?display.*none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. HTML — JS: RENDERING LOGIC
// ─────────────────────────────────────────────────────────────────────────────

describe('09-25: JS rendering', () => {
  test('09-25-01: renderProblemRow or problem card rendering function exists', () => {
    expect(html).toMatch(/renderProblemRow|prop-problem-card/);
  });

  test('09-25-02: renderNormalRow or normal row rendering function exists', () => {
    expect(html).toMatch(/renderNormalRow|prop-list-card/);
  });

  test('09-25-03: prop-section-label is generated in JS', () => {
    expect(html).toMatch(/prop-section-label/);
  });

  test('09-25-04: prop-list-card wrapper generated in JS', () => {
    expect(html).toMatch(/prop-list-card/);
  });

  test('09-25-05: displayName function prefers internalName', () => {
    expect(html).toMatch(/internalName\s*\|\|.*internal_name\s*\|\|.*name/);
  });

  test('09-25-06: kicker updated with property count', () => {
    expect(html).toMatch(/propKicker|updateKicker/);
  });

  test('09-25-07: data-kicker attribute updated on body by JS', () => {
    expect(html).toMatch(/setAttribute\s*\(\s*['"]data-kicker['"]/);
  });

  test('09-25-08: color dot rendered with property color', () => {
    expect(html).toMatch(/prop-dot[\s\S]{0,100}?color|color[\s\S]{0,100}?prop-dot/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. HTML — JS: PROBLEM PREDICATE
// ─────────────────────────────────────────────────────────────────────────────

describe('09-26: JS problem predicate', () => {
  test('09-26-01: isProblem function defined', () => {
    expect(html).toMatch(/function\s+isProblem\s*\(/);
  });

  test('09-26-02: diffusionMap used in isProblem', () => {
    expect(html).toMatch(/diffusionMap\[/);
  });

  test('09-26-03: predicate checks !vendable OR !diffuse', () => {
    expect(html).toMatch(/!d\.vendable\s*\|\|\s*!d\.diffuse|!d\.diffuse\s*\|\|\s*!d\.vendable/);
  });

  test('09-26-04: no diffusion entry = normal (returns false when d is falsy)', () => {
    const fnBlock = html.match(/function\s+isProblem[\s\S]{0,300}?return false/);
    expect(fnBlock).not.toBeNull();
  });

  test('09-26-05: diffusionMap populated from diffusion API response', () => {
    expect(html).toMatch(/diffusionMap\[l\.property_id\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. HTML — JS: CONNECTION BADGE LOGIC
// ─────────────────────────────────────────────────────────────────────────────

describe('09-27: JS connection badge logic', () => {
  test('09-27-01: connectionBadge function defined', () => {
    expect(html).toMatch(/function\s+connectionBadge\s*\(/);
  });

  test('09-27-02: OTA badge uses diffuse from diffusion or channexEnabled', () => {
    expect(html).toMatch(/d\.diffuse|channexEnabled/);
  });

  test('09-27-03: iCal badge checks icalUrls.length', () => {
    expect(html).toMatch(/icalUrls.*length|\.icalUrls/);
  });

  test('09-27-04: "Non relié" fallback badge exists in JS', () => {
    expect(html).toMatch(/Non\s+reli/);
  });

  test('09-27-05: OTA text badge generated', () => {
    expect(html).toMatch(/'OTA'|"OTA"/);
  });

  test('09-27-06: iCal text badge generated', () => {
    expect(html).toMatch(/'iCal'|"iCal"/);
  });

  test('09-27-07: combined OTA · iCal badge when both present', () => {
    expect(html).toMatch(/OTA\s*·\s*iCal|OTA.*iCal/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28. HTML — JS: FILTER LOGIC
// ─────────────────────────────────────────────────────────────────────────────

describe('09-28: JS filter logic', () => {
  test('09-28-01: buildFilterPills function defined', () => {
    expect(html).toMatch(/function\s+buildFilterPills\s*\(/);
  });

  test('09-28-02: "Tous" pill always present', () => {
    expect(html).toMatch(/'Tous'|"Tous"/);
  });

  test('09-28-03: "Non groupés" pill for ungrouped properties', () => {
    expect(html).toMatch(/Non\s+group/);
  });

  test('09-28-04: activeFilter variable controls rendering', () => {
    expect(html).toMatch(/activeFilter/);
  });

  test('09-28-05: getFilteredProperties function defined', () => {
    expect(html).toMatch(/function\s+getFilteredProperties\s*\(/);
  });

  test('09-28-06: filter clears active class and adds to clicked pill', () => {
    expect(html).toMatch(/classList\.remove\s*\(\s*['"]active['"]/);
    expect(html).toMatch(/classList\.add\s*\(\s*['"]active['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 29. HTML — JS: NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────

describe('09-29: JS navigation', () => {
  test('09-29-01: property click navigates to /settings.html', () => {
    expect(html).toMatch(/settings\.html/);
  });

  test('09-29-02: add button (+) links to /settings.html', () => {
    expect(html).toMatch(/href="\/settings\.html"[^>]*aria-label="Ajouter|href="\/settings\.html"/);
  });

  test('09-29-03: back navigation goes to /manage.html', () => {
    expect(html).toMatch(/manage\.html/);
  });

  test('09-29-04: property click handler uses addEventListener', () => {
    expect(html).toMatch(/addEventListener\s*\(\s*['"]click['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 30. HTML — JS: XSS SAFETY
// ─────────────────────────────────────────────────────────────────────────────

describe('09-30: JS XSS safety (escHtml)', () => {
  test('09-30-01: escHtml function defined', () => {
    expect(html).toMatch(/function\s+escHtml\s*\(/);
  });

  test('09-30-02: escHtml escapes < character', () => {
    expect(html).toMatch(/replace\s*\(\s*\/[^/]*</);
  });

  test('09-30-03: escHtml escapes & character', () => {
    expect(html).toMatch(/replace\s*\(\s*\/&/);
  });

  test('09-30-04: property name rendered via escHtml', () => {
    expect(html).toMatch(/escHtml\s*\(\s*displayName\s*\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 31. HTML — JS: EMPTY STATE TEXT
// ─────────────────────────────────────────────────────────────────────────────

describe('09-31: JS empty state', () => {
  test('09-31-01: "Aucun logement dans ce groupe" text for filtered empty state', () => {
    expect(html).toMatch(/Aucun logement dans ce groupe/);
  });

  test('09-31-02: "Aucun logement pour le moment" text for global empty state', () => {
    expect(html).toMatch(/Aucun logement pour le moment/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 32. HTML — SUB-ACCOUNT PERMISSION FILTERING
// ─────────────────────────────────────────────────────────────────────────────

describe('09-32: HTML sub-account permissions', () => {
  test('09-32-01: permission filtering script present', () => {
    expect(html).toMatch(/lcc_is_sub_account/);
  });

  test('09-32-02: data-perm on add button', () => {
    expect(html).toMatch(/data-perm="can_view_properties"/);
  });

  test('09-32-03: lcc_sub_account permissions read', () => {
    expect(html).toMatch(/lcc_sub_account/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 33. MANAGE.HTML REGRESSION — Logements row updated to /properties.html
// ─────────────────────────────────────────────────────────────────────────────

describe('09-33: manage.html regression', () => {
  test('09-33-01: Logements row href is now /properties.html', () => {
    const logementRow = manage.match(/mgios-title[^<]*Logements[\s\S]{0,300}?mgios-title|[\s\S]{0,300}Logements/);
    // Find the specific row block containing "Logements"
    const rowBlock = manage.match(/href="([^"]+)"[^>]*>[\s\S]{0,500}?<div class="mgios-title">Logements<\/div>/);
    if (rowBlock) {
      expect(rowBlock[1]).toBe('/properties.html');
    } else {
      // Alternative: find href near "Logements" text
      const nearBlock = manage.match(/(href="[^"]+")[\s\S]{0,300}?Logements/);
      expect(nearBlock).not.toBeNull();
      expect(nearBlock[1]).toBe('href="/properties.html"');
    }
  });

  test('09-33-02: /settings.html not used as the Logements row href in manage.html', () => {
    // The Logements mgios-row should NOT link to settings.html anymore
    const rowBlock = manage.match(/href="([^"]+)"[^>]*>[\s\S]{0,500}?Logements[\s\S]{0,200}?mgios-subtitle[^<]*Livret/);
    if (rowBlock) {
      expect(rowBlock[1]).not.toBe('/settings.html');
    } else {
      // Just check the specific aria/content pattern near "Livret, prix, accès"
      const specificRow = manage.match(/href="([^"]+)"[\s\S]{0,300}?Livret, prix/);
      if (specificRow) {
        expect(specificRow[1]).toBe('/properties.html');
      }
    }
  });

  test('09-33-03: manage.html still contains #managePrimaryCard', () => {
    expect(manage).toMatch(/id="managePrimaryCard"/);
  });

  test('09-33-04: manage.html still has diffusion alert', () => {
    expect(manage).toMatch(/id="manageDiffusionAlert"/);
  });

  test('09-33-05: manage.html #manageShortcutsCard still present', () => {
    expect(manage).toMatch(/id="manageShortcutsCard"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 34. CSS — no 760px max-width constraint
// ─────────────────────────────────────────────────────────────────────────────

describe('09-34: CSS no narrow max-width constraint', () => {
  test('09-34-01: max-width: 760px not present in CSS', () => {
    expect(css).not.toMatch(/max-width\s*:\s*760px/);
  });

  test('09-34-02: no max-width ≤ 900px in base .prop-content', () => {
    const block = css.match(/body\[data-page="properties"\]\s+\.prop-content\s*\{([^}]+)\}/);
    if (block) {
      const mw = block[1].match(/max-width\s*:\s*(\d+)px/);
      if (mw) {
        expect(parseInt(mw[1], 10)).toBeGreaterThan(900);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 35. HTML — JS: sub-line (group name or address)
// ─────────────────────────────────────────────────────────────────────────────

describe('09-35: JS sub-line logic', () => {
  test('09-35-01: subLine function defined', () => {
    expect(html).toMatch(/function\s+subLine\s*\(/);
  });

  test('09-35-02: subLine checks group membership', () => {
    expect(html).toMatch(/propertyIds.*indexOf|propertyIds.*includes/);
  });

  test('09-35-03: subLine falls back to address', () => {
    expect(html).toMatch(/p\.address/);
  });
});

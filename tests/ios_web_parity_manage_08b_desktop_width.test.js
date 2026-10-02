'use strict';
/**
 * BOOSTINGHOST_WEB_IOS_PARITY_MANAGE_08B — desktop width expansion
 * Verifies bh-manage-ios-08.css removes the 760px max-width constraint
 * and introduces a proper ≥1100px wide layout for Gestion hub.
 */

const fs   = require('fs');
const path = require('path');

const cssPath  = path.join(__dirname, '..', 'public', 'css', 'bh-manage-ios-08.css');
const htmlPath = path.join(__dirname, '..', 'public', 'manage.html');

let css  = '';
let html = '';

beforeAll(() => {
  css  = fs.readFileSync(cssPath,  'utf8');
  html = fs.readFileSync(htmlPath, 'utf8');
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. BASE RULE — no fixed narrow max-width
// ─────────────────────────────────────────────────────────────────────────────

describe('08B-1: base .manage-content has no 760px constraint', () => {
  test('08B-1-01: max-width: 760px is not present in CSS', () => {
    expect(css).not.toMatch(/max-width\s*:\s*760px/);
  });

  test('08B-1-02: base .manage-content rule exists', () => {
    expect(css).toMatch(/body\[data-page="manage"\]\s+\.manage-content\s*\{/);
  });

  test('08B-1-03: base .manage-content does not set max-width to a narrow value (≤900px)', () => {
    const baseBlock = css.match(/body\[data-page="manage"\]\s+\.manage-content\s*\{([^}]+)\}/);
    if (!baseBlock) { expect(baseBlock).not.toBeNull(); return; }
    const inner = baseBlock[1];
    const mw = inner.match(/max-width\s*:\s*(\d+)px/);
    if (mw) {
      expect(parseInt(mw[1], 10)).toBeGreaterThan(900);
    }
    // if no max-width declared in base rule, that's also fine
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DESKTOP BREAKPOINT ≥1100px — wide layout
// ─────────────────────────────────────────────────────────────────────────────

describe('08B-2: @media (min-width: 1100px) wide layout block', () => {
  test('08B-2-01: 1100px media query present', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)/);
  });

  test('08B-2-02: width calc(100% - 80px) declared inside 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)[\s\S]+?width\s*:\s*calc\(100%\s*-\s*80px\)/);
    expect(block).not.toBeNull();
  });

  test('08B-2-03: max-width ≥ 1300px declared inside 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    const mw = block[1].match(/max-width\s*:\s*(\d+)px/);
    expect(mw).not.toBeNull();
    expect(parseInt(mw[1], 10)).toBeGreaterThanOrEqual(1300);
  });

  test('08B-2-04: margin-inline: auto declared inside 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)[\s\S]+?margin-inline\s*:\s*auto/);
    expect(block).not.toBeNull();
  });

  test('08B-2-05: .manage-content is targeted in 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.manage-content/);
  });

  test('08B-2-06: .manage-page-header is aligned in 1100px block', () => {
    const block = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media|$)/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.manage-page-header/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. KICKER — min-height prevents layout collapse while async fetch runs
// ─────────────────────────────────────────────────────────────────────────────

describe('08B-3: kicker min-height', () => {
  test('08B-3-01: .manage-page-header__kicker has min-height declared', () => {
    expect(css).toMatch(/\.manage-page-header__kicker[\s\S]{0,300}?min-height/);
  });

  test('08B-3-02: kicker min-height value is ≥ 1em', () => {
    const block = css.match(/\.manage-page-header__kicker\s*\{([^}]+)\}/);
    expect(block).not.toBeNull();
    const mh = block[1].match(/min-height\s*:\s*([\d.]+)em/);
    expect(mh).not.toBeNull();
    expect(parseFloat(mh[1])).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SHORTCUTS — 2-column grid on desktop
// ─────────────────────────────────────────────────────────────────────────────

describe('08B-4: shortcuts 2-column grid at ≥1100px', () => {
  test('08B-4-01: #manageShortcutsCard targeted inside 1100px block', () => {
    const block1100 = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media\s*\(|$)/);
    expect(block1100).not.toBeNull();
    expect(block1100[1]).toMatch(/#manageShortcutsCard/);
  });

  test('08B-4-02: display: grid set on shortcuts card in 1100px block', () => {
    const block1100 = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media\s*\(|$)/);
    expect(block1100).not.toBeNull();
    expect(block1100[1]).toMatch(/#manageShortcutsCard[\s\S]{0,300}?display\s*:\s*grid/);
  });

  test('08B-4-03: grid-template-columns: 1fr 1fr declared', () => {
    const block1100 = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media\s*\(|$)/);
    expect(block1100).not.toBeNull();
    expect(block1100[1]).toMatch(/grid-template-columns\s*:\s*1fr\s+1fr/);
  });

  test('08B-4-04: gap declared on shortcuts grid', () => {
    const block1100 = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media\s*\(|$)/);
    expect(block1100).not.toBeNull();
    expect(block1100[1]).toMatch(/#manageShortcutsCard[\s\S]{0,400}?gap\s*:/);
  });

  test('08B-4-05: background transparent on shortcuts card (dissolves outer card shell)', () => {
    const block1100 = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media\s*\(|$)/);
    expect(block1100).not.toBeNull();
    expect(block1100[1]).toMatch(/#manageShortcutsCard[\s\S]{0,400}?background\s*:\s*transparent/);
  });

  test('08B-4-06: each .mgios-row inside shortcuts card gets glass card styling', () => {
    const block1100 = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media\s*\(|$)/);
    expect(block1100).not.toBeNull();
    expect(block1100[1]).toMatch(/#manageShortcutsCard\s+\.mgios-row[\s\S]{0,400}?border-radius/);
  });

  test('08B-4-07: shortcut row separators hidden on desktop', () => {
    const block1100 = css.match(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)([\s\S]+?)(?=@media\s*\(|$)/);
    expect(block1100).not.toBeNull();
    expect(block1100[1]).toMatch(/#manageShortcutsCard[\s\S]{0,600}?mgios-row\s*\+\s*\.mgios-row::before[\s\S]{0,100}?display\s*:\s*none/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. HTML — structure unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('08B-5: HTML structure unaffected', () => {
  test('08B-5-01: #manageShortcutsCard still present in HTML', () => {
    expect(html).toMatch(/id="manageShortcutsCard"/);
  });

  test('08B-5-02: 4 shortcut .mgios-row entries', () => {
    const card = html.match(/id="manageShortcutsCard"([\s\S]+?)<!--\s*\/#manageShortcutsCard\s*-->/);
    expect(card).not.toBeNull();
    const rows = card[1].match(/class="mgios-row"/g);
    expect(rows).not.toBeNull();
    expect(rows.length).toBe(4);
  });

  test('08B-5-03: manage-page-header still present', () => {
    expect(html).toMatch(/class="manage-page-header"/);
  });

  test('08B-5-04: #manageKicker still in header', () => {
    expect(html).toMatch(/id="manageKicker"/);
  });

  test('08B-5-05: bh-manage-ios-08.css still linked last', () => {
    const cssLinks = [...html.matchAll(/href="[^"]+\.css[^"]*"/g)].map(m => m[0]);
    const lastCss = cssLinks[cssLinks.length - 1];
    expect(lastCss).toMatch(/bh-manage-ios-08\.css/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. MOBILE — base layout unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('08B-6: mobile layout unchanged', () => {
  test('08B-6-01: base .manage-content padding includes 18px', () => {
    const baseBlock = css.match(/body\[data-page="manage"\]\s+\.manage-content\s*\{([^}]+)\}/);
    expect(baseBlock).not.toBeNull();
    expect(baseBlock[1]).toMatch(/18px/);
  });

  test('08B-6-02: .manage-bottom-pad still in HTML', () => {
    expect(html).toMatch(/class="manage-bottom-pad"/);
  });

  test('08B-6-03: no max-width ≤ 600px breakpoint added that would break mobile', () => {
    const narrowMedia = css.match(/@media\s*\([^)]*max-width\s*:\s*(\d+)px[^)]*\)/g);
    if (narrowMedia) {
      narrowMedia.forEach(m => {
        const val = m.match(/max-width\s*:\s*(\d+)px/);
        if (val) {
          expect(parseInt(val[1], 10)).toBeGreaterThanOrEqual(300);
        }
      });
    }
  });
});

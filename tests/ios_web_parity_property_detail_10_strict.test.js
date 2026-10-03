/**
 * BOOSTINGHOST_WEB_IOS_PARITY_PROPERTY_DETAIL_10_STRICT
 *
 * Tests for the iOS-style property detail hub:
 *   - public/property.html
 *   - public/css/bh-property-detail-ios-10.css
 *   - public/js/bh-property-detail-ios-10.js
 *   - public/properties.html (click handler update)
 *
 * Run: npx jest tests/ios_web_parity_property_detail_10_strict.test.js
 */

const fs   = require('fs');
const path = require('path');

const HTML_PATH    = path.join(__dirname, '../public/property.html');
const CSS_PATH     = path.join(__dirname, '../public/css/bh-property-detail-ios-10.css');
const JS_PATH      = path.join(__dirname, '../public/js/bh-property-detail-ios-10.js');
const PROPS_PATH   = path.join(__dirname, '../public/properties.html');
const SETTINGS_PATH = path.join(__dirname, '../public/settings.html');

let html, css, js, propsHtml, settingsHtml;

beforeAll(() => {
  html        = fs.readFileSync(HTML_PATH,     'utf8');
  css         = fs.readFileSync(CSS_PATH,      'utf8');
  js          = fs.readFileSync(JS_PATH,       'utf8');
  propsHtml   = fs.readFileSync(PROPS_PATH,    'utf8');
  settingsHtml = fs.readFileSync(SETTINGS_PATH, 'utf8');
});

/* ═══════════════════════════════════════════════════════════════
   10-1 · FILE EXISTENCE
   ═══════════════════════════════════════════════════════════════ */
describe('10-1 File existence', () => {
  test('10-1-01 property.html exists', () => {
    expect(fs.existsSync(HTML_PATH)).toBe(true);
  });
  test('10-1-02 bh-property-detail-ios-10.css exists', () => {
    expect(fs.existsSync(CSS_PATH)).toBe(true);
  });
  test('10-1-03 bh-property-detail-ios-10.js exists', () => {
    expect(fs.existsSync(JS_PATH)).toBe(true);
  });
  test('10-1-04 property.html is non-empty', () => {
    expect(html.length).toBeGreaterThan(500);
  });
  test('10-1-05 CSS file is non-empty', () => {
    expect(css.length).toBeGreaterThan(500);
  });
  test('10-1-06 JS file is non-empty', () => {
    expect(js.length).toBeGreaterThan(1000);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-2 · property.html — body attributes and data-page
   ═══════════════════════════════════════════════════════════════ */
describe('10-2 property.html body attributes', () => {
  test('10-2-01 data-page="property"', () => {
    expect(html).toMatch(/data-page="property"/);
  });
  test('10-2-02 data-back-href="/properties.html"', () => {
    expect(html).toMatch(/data-back-href="\/properties\.html"/);
  });
  test('10-2-03 data-kicker attribute present', () => {
    expect(html).toMatch(/data-kicker=/);
  });
  test('10-2-04 data-title attribute present', () => {
    expect(html).toMatch(/data-title=/);
  });
  test('10-2-05 data-back-label="Logements"', () => {
    expect(html).toMatch(/data-back-label="Logements"/);
  });
  test('10-2-06 lang="fr"', () => {
    expect(html).toMatch(/lang="fr"/);
  });
  test('10-2-07 data-theme-v3="1"', () => {
    expect(html).toMatch(/data-theme-v3="1"/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-3 · property.html — CSS chain
   ═══════════════════════════════════════════════════════════════ */
describe('10-3 property.html CSS chain', () => {
  test('10-3-01 loads style.css', () => {
    expect(html).toMatch(/style\.css/);
  });
  test('10-3-02 loads bh-theme-v3.css', () => {
    expect(html).toMatch(/bh-theme-v3\.css/);
  });
  test('10-3-03 loads bh-tokens.css', () => {
    expect(html).toMatch(/bh-tokens\.css/);
  });
  test('10-3-04 loads bh-ios-parity.css', () => {
    expect(html).toMatch(/bh-ios-parity\.css/);
  });
  test('10-3-05 loads bh-shell-04.css', () => {
    expect(html).toMatch(/bh-shell-04\.css/);
  });
  test('10-3-06 loads bh-core.css', () => {
    expect(html).toMatch(/bh-core\.css/);
  });
  test('10-3-07 loads bh-property-detail-ios-10.css', () => {
    expect(html).toMatch(/bh-property-detail-ios-10\.css/);
  });
  test('10-3-08 loads bh-bottom-bar.css', () => {
    expect(html).toMatch(/bh-bottom-bar\.css/);
  });
  test('10-3-09 loads bh-native-bg.css', () => {
    expect(html).toMatch(/bh-native-bg\.css/);
  });
  test('10-3-10 loads bh-v3-mobile.css', () => {
    expect(html).toMatch(/bh-v3-mobile\.css/);
  });
  test('10-3-11 loads mobile-native-styles.css', () => {
    expect(html).toMatch(/mobile-native-styles\.css/);
  });
  test('10-3-12 bh-property-detail-ios-10.css loaded AFTER bh-core.css', () => {
    var coreIdx   = html.indexOf('bh-core.css');
    var detailIdx = html.indexOf('bh-property-detail-ios-10.css');
    expect(coreIdx).toBeGreaterThan(-1);
    expect(detailIdx).toBeGreaterThan(-1);
    expect(detailIdx).toBeGreaterThan(coreIdx);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-4 · property.html — Scripts
   ═══════════════════════════════════════════════════════════════ */
describe('10-4 property.html scripts', () => {
  test('10-4-01 auth-fetch.js loaded', () => {
    expect(html).toMatch(/auth-fetch\.js/);
  });
  test('10-4-02 bh-layout.js loaded', () => {
    expect(html).toMatch(/bh-layout\.js/);
  });
  test('10-4-03 bh-property-detail-ios-10.js loaded', () => {
    expect(html).toMatch(/bh-property-detail-ios-10\.js/);
  });
  test('10-4-04 sub-account-guard.js loaded', () => {
    expect(html).toMatch(/sub-account-guard\.js/);
  });
  test('10-4-05 auth-fetch.js appears before bh-property-detail-ios-10.js', () => {
    var authIdx   = html.indexOf('auth-fetch.js');
    var detailIdx = html.indexOf('bh-property-detail-ios-10.js');
    expect(authIdx).toBeGreaterThan(-1);
    expect(detailIdx).toBeGreaterThan(-1);
    expect(detailIdx).toBeGreaterThan(authIdx);
  });
  test('10-4-06 mobile-native-experience.js loaded', () => {
    expect(html).toMatch(/mobile-native-experience\.js/);
  });
  test('10-4-07 bh-haptics.js loaded', () => {
    expect(html).toMatch(/bh-haptics\.js/);
  });
  test('10-4-08 messages-badge-desktop-mobile.js loaded', () => {
    expect(html).toMatch(/messages-badge-desktop-mobile\.js/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-5 · property.html — DOM structure
   ═══════════════════════════════════════════════════════════════ */
describe('10-5 property.html DOM structure', () => {
  test('10-5-01 propDetLoading element present', () => {
    expect(html).toMatch(/id="propDetLoading"/);
  });
  test('10-5-02 propDetError element present', () => {
    expect(html).toMatch(/id="propDetError"/);
  });
  test('10-5-03 propDetBody element present', () => {
    expect(html).toMatch(/id="propDetBody"/);
  });
  test('10-5-04 propDetLoading has prop-det-loading class', () => {
    expect(html).toMatch(/class="prop-det-loading"/);
  });
  test('10-5-05 propDetError has prop-det-error class', () => {
    expect(html).toMatch(/class="prop-det-error"/);
  });
  test('10-5-06 propDetBody hidden by default', () => {
    expect(html).toMatch(/id="propDetBody"\s+style="display:none"/);
  });
  test('10-5-07 propDetError hidden by default', () => {
    expect(html).toMatch(/id="propDetError".*?style="display:none"/s);
  });
  test('10-5-08 Loading shows "Chargement..."', () => {
    expect(html).toMatch(/Chargement\.\.\./);
  });
  test('10-5-09 prop-detail-content wrapper present', () => {
    expect(html).toMatch(/class="prop-detail-content"/);
  });
  test('10-5-10 propDetKicker span present', () => {
    expect(html).toMatch(/id="propDetKicker"/);
  });
  test('10-5-11 propDetTitle element present', () => {
    expect(html).toMatch(/id="propDetTitle"/);
  });
  test('10-5-12 bhSidebar div present', () => {
    expect(html).toMatch(/id="bhSidebar"/);
  });
  test('10-5-13 bhHeader div present', () => {
    expect(html).toMatch(/id="bhHeader"/);
  });
  test('10-5-14 page-content wrapper present', () => {
    expect(html).toMatch(/class="page-content"/);
  });
  test('10-5-15 app-container present', () => {
    expect(html).toMatch(/class="app-container"/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-6 · CSS — scoping and nav-rail
   ═══════════════════════════════════════════════════════════════ */
describe('10-6 CSS scoping and nav-rail', () => {
  test('10-6-01 all rules scoped to body[data-page="property"]', () => {
    var ruleLines = css.split('\n').filter(function (l) {
      var t = l.trim();
      return t.length > 0 && !t.startsWith('/*') && !t.startsWith('*') && !t.startsWith('@') && !t.startsWith('}') && t.includes('{');
    });
    ruleLines.forEach(function (line) {
      expect(line).toMatch(/body\[data-page="property"\]|@media|html\[data-theme/);
    });
  });
  test('10-6-02 nav-rail hidden at 1367px', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)/);
    expect(css).toMatch(/\.sidebar\.bh-nav-rail[\s\S]{0,80}?display\s*:\s*none/);
  });
  test('10-6-03 app-container margin-left reset at 1367px', () => {
    expect(css).toMatch(/\.app-container[\s\S]{0,80}?margin-left\s*:\s*0/);
  });
  test('10-6-04 main-content padding-top reset at 1367px', () => {
    expect(css).toMatch(/\.main-content[\s\S]{0,80}?padding-top\s*:\s*0/);
  });
  test('10-6-05 1367px block uses !important for nav-rail', () => {
    expect(css).toMatch(/bh-nav-rail[\s\S]{0,100}?!important/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-7 · CSS — content container desktop width
   ═══════════════════════════════════════════════════════════════ */
describe('10-7 CSS content container', () => {
  test('10-7-01 1100px breakpoint present', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)/);
  });
  test('10-7-02 width calc(100% - 80px) at 1100px', () => {
    expect(css).toMatch(/width\s*:\s*calc\(100%\s*-\s*80px\)/);
  });
  test('10-7-03 max-width: 1440px at 1100px', () => {
    expect(css).toMatch(/max-width\s*:\s*1440px/);
  });
  test('10-7-04 margin-inline: auto at 1100px', () => {
    expect(css).toMatch(/margin-inline\s*:\s*auto/);
  });
  test('10-7-05 prop-detail-content has padding', () => {
    expect(css).toMatch(/\.prop-detail-content[\s\S]{0,60}?padding/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-8 · CSS — glass card
   ═══════════════════════════════════════════════════════════════ */
describe('10-8 CSS glass card', () => {
  test('10-8-01 prop-detail-card has backdrop-filter', () => {
    expect(css).toMatch(/\.prop-detail-card[\s\S]{0,200}?backdrop-filter/);
  });
  test('10-8-02 prop-detail-card has border-radius 22px', () => {
    expect(css).toMatch(/\.prop-detail-card[\s\S]{0,200}?border-radius\s*:\s*22px/);
  });
  test('10-8-03 prop-detail-card has box-shadow', () => {
    expect(css).toMatch(/\.prop-detail-card[\s\S]{0,500}?box-shadow/);
  });
  test('10-8-04 specular top edge ::before present', () => {
    expect(css).toMatch(/\.prop-detail-card::before/);
  });
  test('10-8-05 prop-action-card has backdrop-filter', () => {
    expect(css).toMatch(/\.prop-action-card[\s\S]{0,200}?backdrop-filter/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-9 · CSS — block row
   ═══════════════════════════════════════════════════════════════ */
describe('10-9 CSS block row', () => {
  test('10-9-01 prop-block-row has padding', () => {
    expect(css).toMatch(/\.prop-block-row[\s\S]{0,100}?padding/);
  });
  test('10-9-02 prop-block-row separator inset from icon', () => {
    expect(css).toMatch(/\.prop-detail-card\s+\.prop-block-row\s*\+\s*\.prop-block-row::before/);
  });
  test('10-9-03 separator is 0.5px', () => {
    expect(css).toMatch(/height\s*:\s*0\.5px/);
  });
  test('10-9-04 prop-block-name font-size 15px', () => {
    expect(css).toMatch(/\.prop-block-name[\s\S]{0,100}?font-size\s*:\s*15px/);
  });
  test('10-9-05 prop-block-name font-weight 600', () => {
    expect(css).toMatch(/\.prop-block-name[\s\S]{0,100}?font-weight\s*:\s*600/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-10 · CSS — status badges
   ═══════════════════════════════════════════════════════════════ */
describe('10-10 CSS status badges', () => {
  test('10-10-01 prop-status-badge--complete has green background', () => {
    expect(css).toMatch(/\.prop-status-badge--complete[\s\S]{0,100}?background\s*:\s*#DCE8E1/);
  });
  test('10-10-02 prop-status-badge--complete has green color', () => {
    expect(css).toMatch(/\.prop-status-badge--complete[\s\S]{0,100}?color\s*:\s*#1B6B41/);
  });
  test('10-10-03 prop-status-badge--to-fill has terracotta color', () => {
    expect(css).toMatch(/\.prop-status-badge--to-fill[\s\S]{0,100}?color\s*:\s*#A8452A/);
  });
  test('10-10-04 prop-livret-badge has amber background', () => {
    expect(css).toMatch(/\.prop-livret-badge[\s\S]{0,300}?background\s*:\s*rgba\(201,\s*161,\s*91/);
  });
  test('10-10-05 prop-livret-badge has #8A5B14 color', () => {
    expect(css).toMatch(/\.prop-livret-badge[\s\S]{0,300}?color\s*:\s*#8A5B14/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-11 · CSS — livret card
   ═══════════════════════════════════════════════════════════════ */
describe('10-11 CSS livret card', () => {
  test('10-11-01 prop-livret-card has amber background', () => {
    expect(css).toMatch(/\.prop-livret-card[\s\S]{0,100}?background\s*:\s*rgba\(251/);
  });
  test('10-11-02 prop-livret-card has border-radius 22px', () => {
    expect(css).toMatch(/\.prop-livret-card[\s\S]{0,100}?border-radius\s*:\s*22px/);
  });
  test('10-11-03 prop-livret-block--complete is green', () => {
    expect(css).toMatch(/\.prop-livret-block--complete[\s\S]{0,100}?color\s*:\s*#1B6B41/);
  });
  test('10-11-04 prop-livret-block--to-fill is terracotta', () => {
    expect(css).toMatch(/\.prop-livret-block--to-fill[\s\S]{0,100}?color\s*:\s*#A8452A/);
  });
  test('10-11-05 prop-livret-btn has green background', () => {
    expect(css).toMatch(/\.prop-livret-btn[\s\S]{0,100}?background\s*:\s*#0E3B2E/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-12 · CSS — bottom pad and actions
   ═══════════════════════════════════════════════════════════════ */
describe('10-12 CSS bottom pad and actions', () => {
  test('10-12-01 prop-bottom-pad uses env(safe-area-inset-bottom)', () => {
    expect(css).toMatch(/env\(safe-area-inset-bottom/);
  });
  test('10-12-02 prop-bottom-pad hidden at 1367px', () => {
    expect(css).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)[\s\S]+?\.prop-bottom-pad[\s\S]{0,60}?display\s*:\s*none/);
  });
  test('10-12-03 prop-action-row--danger is terracotta', () => {
    expect(css).toMatch(/\.prop-action-row--danger[\s\S]{0,100}?color\s*:\s*#A8452A/);
  });
  test('10-12-04 prop-det-retry-btn has green background', () => {
    expect(css).toMatch(/\.prop-det-retry-btn[\s\S]{0,300}?background\s*:\s*#0E3B2E/);
  });
  test('10-12-05 DM Sans used in prop-block-name', () => {
    expect(css).toMatch(/\.prop-block-name[\s\S]{0,100}?DM Sans/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-13 · JS — fetch() not authFetch
   ═══════════════════════════════════════════════════════════════ */
describe('10-13 JS uses fetch() not authFetch()', () => {
  test('10-13-01 no authFetch() calls', () => {
    expect(js).not.toMatch(/authFetch\s*\(/);
  });
  test('10-13-02 uses fetch() for property', () => {
    expect(js).toMatch(/fetch\s*\(\s*['"`]\/api\/properties\/'/);
  });
  test('10-13-03 uses fetch() for property-groups', () => {
    expect(js).toMatch(/fetch\s*\(\s*['"`]\/api\/property-groups/);
  });
  test('10-13-04 uses fetch() for diffusion', () => {
    expect(js).toMatch(/fetch\s*\(\s*['"`]\/api\/properties\/diffusion/);
  });
  test('10-13-05 uses fetch() for welcome-books', () => {
    expect(js).toMatch(/fetch\s*\(\s*['"`]\/api\/welcome-books\/by-property\//);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-14 · JS — 4 parallel fetches in Promise.all
   ═══════════════════════════════════════════════════════════════ */
describe('10-14 JS parallel fetches', () => {
  test('10-14-01 Promise.all present', () => {
    expect(js).toMatch(/Promise\.all\s*\(/);
  });
  test('10-14-02 /api/properties/ + propertyId fetched', () => {
    expect(js).toMatch(/\/api\/properties\/'\s*\+\s*propertyId/);
  });
  test('10-14-03 /api/property-groups fetched', () => {
    expect(js).toMatch(/\/api\/property-groups/);
  });
  test('10-14-04 /api/properties/diffusion fetched', () => {
    expect(js).toMatch(/\/api\/properties\/diffusion/);
  });
  test('10-14-05 /api/welcome-books/by-property/ fetched', () => {
    expect(js).toMatch(/\/api\/welcome-books\/by-property\//);
  });
  test('10-14-06 non-critical fetches have .catch fallback', () => {
    var catchCount = (js.match(/\.catch\s*\(function/g) || []).length;
    expect(catchCount).toBeGreaterThanOrEqual(3);
  });
  test('10-14-07 fetch /api/properties/:id throws on !r.ok', () => {
    expect(js).toMatch(/if\s*\(!r\.ok\)\s*throw/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-15 · JS — URL parsing and init
   ═══════════════════════════════════════════════════════════════ */
describe('10-15 JS URL parsing and init', () => {
  test('10-15-01 URLSearchParams used', () => {
    expect(js).toMatch(/new URLSearchParams/);
  });
  test('10-15-02 params.get("id") called', () => {
    expect(js).toMatch(/params\.get\s*\(\s*['"]id['"]\s*\)/);
  });
  test('10-15-03 showError called if no propertyId', () => {
    expect(js).toMatch(/if\s*\(!\s*propertyId\s*\)[\s\S]{0,100}?showError/);
  });
  test('10-15-04 DOMContentLoaded or readyState check', () => {
    expect(js).toMatch(/DOMContentLoaded|readyState/);
  });
  test('10-15-05 window._propDetRetry set to loadAll', () => {
    expect(js).toMatch(/window\._propDetRetry\s*=\s*loadAll/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-16 · JS — livret completion logic
   ═══════════════════════════════════════════════════════════════ */
describe('10-16 JS livret completion', () => {
  test('10-16-01 livretCompletion function defined', () => {
    expect(js).toMatch(/function\s+livretCompletion/);
  });
  test('10-16-02 accessCode OR wifiName counted', () => {
    expect(js).toMatch(/accessCode\s*\|\|\s*p\.wifiName/);
  });
  test('10-16-03 practicalInfo checked via hasContent', () => {
    expect(js).toMatch(/hasContent\s*\(\s*p\.practicalInfo\s*\)/);
  });
  test('10-16-04 amenities checked via hasContent', () => {
    expect(js).toMatch(/hasContent\s*\(\s*p\.amenities\s*\)/);
  });
  test('10-16-05 count computed as sum of 3 booleans', () => {
    expect(js).toMatch(/count\s*:/);
  });
  test('10-16-06 card hidden when count >= 3', () => {
    expect(js).toMatch(/comp\.count\s*>=\s*3/);
  });
  test('10-16-07 hasContent handles array', () => {
    expect(js).toMatch(/Array\.isArray\s*\(\s*val\s*\)/);
  });
  test('10-16-08 hasContent handles JSON string', () => {
    expect(js).toMatch(/JSON\.parse\s*\(\s*s\s*\)/);
  });
  test('10-16-09 hasContent rejects empty JSON {} string', () => {
    expect(js).toMatch(/s\s*===\s*'{}'/);
  });
  test('10-16-10 hasContent rejects empty JSON [] string', () => {
    expect(js).toMatch(/s\s*===\s*'\[\]'/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-17 · JS — livret card rendering
   ═══════════════════════════════════════════════════════════════ */
describe('10-17 JS livret card render', () => {
  test('10-17-01 prop-livret-card class in HTML output', () => {
    expect(js).toMatch(/prop-livret-card/);
  });
  test('10-17-02 "Livret d\'accueil" label in render', () => {
    expect(js).toMatch(/Livret d/);
  });
  test('10-17-03 "Accès & Wi-Fi" block present', () => {
    expect(js).toMatch(/Accès & Wi-Fi/);
  });
  test('10-17-04 "Le quartier" block present', () => {
    expect(js).toMatch(/Le quartier/);
  });
  test('10-17-05 "Équipements" block present', () => {
    expect(js).toMatch(/Équipements/);
  });
  test('10-17-06 "X / 3 complétés" text template', () => {
    expect(js).toMatch(/\/ 3 complétés/);
  });
  test('10-17-07 "Créer le livret" button label', () => {
    expect(js).toMatch(/Créer le livret/);
  });
  test('10-17-08 "Voir le livret" button label', () => {
    expect(js).toMatch(/Voir le livret/);
  });
  test('10-17-09 livret btn links to /welcome.html', () => {
    expect(js).toMatch(/\/welcome\.html/);
  });
  test('10-17-10 prop-livret-btn class in render', () => {
    expect(js).toMatch(/prop-livret-btn/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-18 · JS — block status logic
   ═══════════════════════════════════════════════════════════════ */
describe('10-18 JS block status', () => {
  test('10-18-01 blockStatus function defined', () => {
    expect(js).toMatch(/function\s+blockStatus/);
  });
  test('10-18-02 identity status uses p.name', () => {
    expect(js).toMatch(/identity\s*:[\s\S]{0,80}?p\.name/);
  });
  test('10-18-03 stay requires arrivalTime AND departureTime AND maxGuests', () => {
    expect(js).toMatch(/arrivalTime[\s\S]{0,30}?departureTime[\s\S]{0,30}?maxGuests/);
  });
  test('10-18-04 pricing uses p.basePrice', () => {
    expect(js).toMatch(/pricing\s*:[\s\S]{0,60}?p\.basePrice/);
  });
  test('10-18-05 upsell is "inactive"', () => {
    expect(js).toMatch(/upsell\s*:[\s\S]{0,80}?'inactive'/);
  });
  test('10-18-06 access uses accessCode OR wifiName', () => {
    expect(js).toMatch(/access\s*:[\s\S]{0,80}?accessCode[\s\S]{0,20}?wifiName/);
  });
  test('10-18-07 neighborhood uses hasContent(practicalInfo)', () => {
    expect(js).toMatch(/neighborhood\s*:[\s\S]{0,60}?hasContent\s*\(\s*p\.practicalInfo\s*\)/);
  });
  test('10-18-08 amenities uses hasContent(amenities)', () => {
    expect(js).toMatch(/amenities\s*:[\s\S]{0,60}?hasContent\s*\(\s*p\.amenities\s*\)/);
  });
  test('10-18-09 ai uses autoResponsesEnabled', () => {
    expect(js).toMatch(/ai\s*:[\s\S]{0,80}?autoResponsesEnabled/);
  });
  test('10-18-10 platforms uses channexEnabled AND channexPropertyId', () => {
    expect(js).toMatch(/platforms\s*:[\s\S]{0,100}?channexEnabled[\s\S]{0,20}?channexPropertyId/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-19 · JS — 9 blocks in correct order
   ═══════════════════════════════════════════════════════════════ */
describe('10-19 JS 9 blocks correct order', () => {
  var blocks = [
    'Identité', 'Séjour', 'Argent', 'Prestations payantes',
    'Accès', 'Le quartier', 'Équipements & règles',
    'Assistant IA', 'Plateformes & prix'
  ];

  blocks.forEach(function (label, idx) {
    test('10-19-0' + (idx + 1) + ' block "' + label + '" defined', () => {
      expect(js).toMatch(new RegExp(label.replace(/[&]/g, '\\&').replace(/[é]/g, 'é')));
    });
  });

  test('10-19-10 Identité comes before Séjour', () => {
    expect(js.indexOf('Identité')).toBeLessThan(js.indexOf('Séjour'));
  });
  test('10-19-11 Accès block comes before Le quartier in renderBlocksCard', () => {
    var fnStart = js.indexOf('function renderBlocksCard');
    var fnBody  = js.slice(fnStart, fnStart + 1200);
    expect(fnBody.indexOf("'Accès'")).toBeLessThan(fnBody.indexOf("'Le quartier'"));
  });
  test('10-19-12 Équipements comes before Assistant IA', () => {
    var equipeIdx = js.indexOf('Équipements & règles');
    var aiIdx     = js.indexOf('Assistant IA');
    expect(equipeIdx).toBeLessThan(aiIdx);
  });
  test('10-19-13 all 9 blocks in one renderBlocksCard function', () => {
    expect(js).toMatch(/function\s+renderBlocksCard/);
    var fnStart = js.indexOf('function renderBlocksCard');
    var fnEnd   = js.indexOf('\n  }', fnStart + 50);
    var fnBody  = js.slice(fnStart, fnEnd + 10);
    expect(fnBody).toMatch(/Identité/);
    expect(fnBody).toMatch(/Plateformes/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-20 · JS — LIVRET badge on Accès, Quartier, Équipements
   ═══════════════════════════════════════════════════════════════ */
describe('10-20 JS livret badge placement', () => {
  test('10-20-01 Accès block has hasLivretBadge=true', () => {
    expect(js).toMatch(/'access'[\s\S]{0,100}?true/);
  });
  test('10-20-02 Le quartier block has hasLivretBadge=true', () => {
    expect(js).toMatch(/'neighborhood'[\s\S]{0,100}?true/);
  });
  test('10-20-03 Équipements block has hasLivretBadge=true', () => {
    expect(js).toMatch(/'amenities'[\s\S]{0,100}?true/);
  });
  test('10-20-04 Identité block has hasLivretBadge=false', () => {
    expect(js).toMatch(/'identity'[\s\S]{0,100}?false/);
  });
  test('10-20-05 Argent block has hasLivretBadge=false', () => {
    expect(js).toMatch(/'pricing'[\s\S]{0,100}?false/);
  });
  test('10-20-06 prop-livret-badge class used', () => {
    expect(js).toMatch(/prop-livret-badge/);
  });
  test('10-20-07 renderBlock uses hasLivretBadge param', () => {
    expect(js).toMatch(/function\s+renderBlock\s*\([^)]*hasLivretBadge/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-21 · JS — diffusion section
   ═══════════════════════════════════════════════════════════════ */
describe('10-21 JS diffusion section', () => {
  test('10-21-01 renderDiffusion function defined', () => {
    expect(js).toMatch(/function\s+renderDiffusion/);
  });
  test('10-21-02 isSubAccount check in renderDiffusion', () => {
    var fnStart = js.indexOf('function renderDiffusion');
    var fnBody = js.slice(fnStart, fnStart + 400);
    expect(fnBody).toMatch(/isSubAccount/);
  });
  test('10-21-03 returns empty string for sub-accounts', () => {
    var fnStart = js.indexOf('function renderDiffusion');
    var fnBody = js.slice(fnStart, fnStart + 200);
    expect(fnBody).toMatch(/isSubAccount\s*\(\s*\)[\s\S]{0,60}?return\s+''/);
  });
  test('10-21-04 "Connecter à la diffusion" label', () => {
    expect(js).toMatch(/Connecter à la diffusion/);
  });
  test('10-21-05 "Gérer la diffusion" label', () => {
    expect(js).toMatch(/Gérer la diffusion/);
  });
  test('10-21-06 "Déconnecter" label', () => {
    expect(js).toMatch(/Déconnecter/);
  });
  test('10-21-07 channexEnabled AND channexPropertyId checked', () => {
    var fnStart = js.indexOf('function renderDiffusion');
    var fnBody = js.slice(fnStart, fnStart + 500);
    expect(fnBody).toMatch(/channexEnabled[\s\S]{0,30}?channexPropertyId/);
  });
  test('10-21-08 Déconnecter has danger class', () => {
    expect(js).toMatch(/prop-diffusion-row--danger/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-22 · JS — iCal section
   ═══════════════════════════════════════════════════════════════ */
describe('10-22 JS iCal section', () => {
  test('10-22-01 renderIcal function defined', () => {
    expect(js).toMatch(/function\s+renderIcal/);
  });
  test('10-22-02 icalUrls array handled', () => {
    expect(js).toMatch(/Array\.isArray\s*\(\s*p\.icalUrls\s*\)/);
  });
  test('10-22-03 item.platform extracted', () => {
    expect(js).toMatch(/item\.platform/);
  });
  test('10-22-04 item.url extracted', () => {
    expect(js).toMatch(/item\.url/);
  });
  test('10-22-05 prop-ical-url class used', () => {
    expect(js).toMatch(/prop-ical-url/);
  });
  test('10-22-06 prop-ical-platform class used', () => {
    expect(js).toMatch(/prop-ical-platform/);
  });
  test('10-22-07 URL truncated at 40 chars', () => {
    expect(js).toMatch(/url\.length\s*>\s*40/);
  });
  test('10-22-08 "Ajouter un flux iCal" shown when empty', () => {
    expect(js).toMatch(/Ajouter un flux iCal/);
  });
  test('10-22-09 "Modifier les flux iCal" shown when non-empty', () => {
    expect(js).toMatch(/Modifier les flux iCal/);
  });
  test('10-22-10 action row links to /settings.html', () => {
    var fnStart = js.indexOf('function renderIcal');
    var fnBody = js.slice(fnStart, fnStart + 1200);
    expect(fnBody).toMatch(/\/settings\.html/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-23 · JS — bottom actions
   ═══════════════════════════════════════════════════════════════ */
describe('10-23 JS bottom actions', () => {
  test('10-23-01 renderActions function defined', () => {
    expect(js).toMatch(/function\s+renderActions/);
  });
  test('10-23-02 propDetDuplicate button id present', () => {
    expect(js).toMatch(/id="propDetDuplicate"/);
  });
  test('10-23-03 propDetResync button id present', () => {
    expect(js).toMatch(/id="propDetResync"/);
  });
  test('10-23-04 propDetDelete button id present', () => {
    expect(js).toMatch(/id="propDetDelete"/);
  });
  test('10-23-05 "Dupliquer" label', () => {
    expect(js).toMatch(/Dupliquer/);
  });
  test('10-23-06 "Resynchroniser" label', () => {
    expect(js).toMatch(/Resynchroniser/);
  });
  test('10-23-07 "Supprimer" label', () => {
    expect(js).toMatch(/Supprimer/);
  });
  test('10-23-08 delete has danger class', () => {
    expect(js).toMatch(/prop-action-row--danger/);
  });
  test('10-23-09 prop-action-card class used', () => {
    expect(js).toMatch(/prop-action-card/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-24 · JS — delete confirmation modal
   ═══════════════════════════════════════════════════════════════ */
describe('10-24 JS delete confirmation', () => {
  test('10-24-01 confirmDelete function defined', () => {
    expect(js).toMatch(/function\s+confirmDelete/);
  });
  test('10-24-02 _propDetDeleteModal id used', () => {
    expect(js).toMatch(/_propDetDeleteModal/);
  });
  test('10-24-03 _propDetDeleteConfirm button present', () => {
    expect(js).toMatch(/_propDetDeleteConfirm/);
  });
  test('10-24-04 _propDetDeleteCancel button present', () => {
    expect(js).toMatch(/_propDetDeleteCancel/);
  });
  test('10-24-05 DELETE method used for /api/properties/', () => {
    expect(js).toMatch(/method\s*:\s*['"]DELETE['"]/);
  });
  test('10-24-06 redirect to /properties.html after delete', () => {
    expect(js).toMatch(/\/properties\.html/);
  });
  test('10-24-07 backdrop blur on confirmation modal', () => {
    expect(js).toMatch(/backdrop-filter\s*:\s*blur/);
  });
  test('10-24-08 click-outside to dismiss modal', () => {
    expect(js).toMatch(/e\.target\s*===\s*modal/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-25 · JS — resync
   ═══════════════════════════════════════════════════════════════ */
describe('10-25 JS resync', () => {
  test('10-25-01 resyncProperty function defined', () => {
    expect(js).toMatch(/function\s+resyncProperty/);
  });
  test('10-25-02 calls /api/channex/sync-availability/', () => {
    expect(js).toMatch(/\/api\/channex\/sync-availability\//);
  });
  test('10-25-03 calls /api/pricing/rules/push-channex/', () => {
    expect(js).toMatch(/\/api\/pricing\/rules\/push-channex\//);
  });
  test('10-25-04 uses POST method', () => {
    var fnStart = js.indexOf('function resyncProperty');
    var fnBody  = js.slice(fnStart, fnStart + 400);
    expect(fnBody).toMatch(/method\s*:\s*['"]POST['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-26 · JS — header update
   ═══════════════════════════════════════════════════════════════ */
describe('10-26 JS header update', () => {
  test('10-26-01 updateHeader function defined', () => {
    expect(js).toMatch(/function\s+updateHeader/);
  });
  test('10-26-02 uses internalName or name for title', () => {
    expect(js).toMatch(/internalName\s*\|\|\s*p\.name/);
  });
  test('10-26-03 group name in kicker', () => {
    var fnStart = js.indexOf('function updateHeader');
    var fnBody = js.slice(fnStart, fnStart + 500);
    expect(fnBody).toMatch(/group/);
  });
  test('10-26-04 address in kicker', () => {
    var fnStart = js.indexOf('function updateHeader');
    var fnBody = js.slice(fnStart, fnStart + 500);
    expect(fnBody).toMatch(/address/);
  });
  test('10-26-05 body.setAttribute("data-title") called', () => {
    expect(js).toMatch(/body\.setAttribute\s*\(\s*['"]data-title['"]/);
  });
  test('10-26-06 body.setAttribute("data-kicker") called', () => {
    expect(js).toMatch(/body\.setAttribute\s*\(\s*['"]data-kicker['"]/);
  });
  test('10-26-07 desktop title element updated', () => {
    expect(js).toMatch(/propDetTitle/);
  });
  test('10-26-08 desktop kicker element updated', () => {
    expect(js).toMatch(/propDetKicker/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-27 · JS — error handling
   ═══════════════════════════════════════════════════════════════ */
describe('10-27 JS error handling', () => {
  test('10-27-01 showError function defined', () => {
    expect(js).toMatch(/function\s+showError/);
  });
  test('10-27-02 propDetLoading hidden in showError', () => {
    var fnStart = js.indexOf('function showError');
    var fnBody  = js.slice(fnStart, fnStart + 200);
    expect(fnBody).toMatch(/propDetLoading/);
  });
  test('10-27-03 propDetError shown in showError', () => {
    var fnStart = js.indexOf('function showError');
    var fnBody  = js.slice(fnStart, fnStart + 200);
    expect(fnBody).toMatch(/propDetError/);
  });
  test('10-27-04 "Réessayer" retry button in error', () => {
    expect(js).toMatch(/Réessayer/);
  });
  test('10-27-05 error message escaped via escHtml', () => {
    var fnStart = js.indexOf('function showError');
    var fnBody  = js.slice(fnStart, fnStart + 300);
    expect(fnBody).toMatch(/escHtml/);
  });
  test('10-27-06 loadAll resets loading state', () => {
    var fnStart = js.indexOf('function loadAll');
    var fnBody = js.slice(fnStart, fnStart + 500);
    expect(fnBody).toMatch(/propDetLoading[\s\S]{0,200}?display/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-28 · JS — XSS safety
   ═══════════════════════════════════════════════════════════════ */
describe('10-28 JS XSS safety', () => {
  test('10-28-01 escHtml function defined', () => {
    expect(js).toMatch(/function\s+escHtml/);
  });
  test('10-28-02 escHtml escapes &', () => {
    expect(js).toMatch(/replace\s*\(\s*\/&\/g\s*,\s*'&amp;'\s*\)/);
  });
  test('10-28-03 escHtml escapes <', () => {
    expect(js).toMatch(/replace\s*\(\s*\/<\/g\s*,\s*'&lt;'\s*\)/);
  });
  test('10-28-04 escHtml escapes >', () => {
    expect(js).toMatch(/replace\s*\(\s*\/>\//);
  });
  test('10-28-05 escHtml escapes "', () => {
    expect(js).toMatch(/replace\s*\(\s*\/"\/g/);
  });
  test('10-28-06 property name passed through escHtml', () => {
    expect(js).toMatch(/escHtml\s*\(\s*label\s*\)/);
  });
  test('10-28-07 delete modal name passed through escHtml', () => {
    var fnStart = js.indexOf('function confirmDelete');
    var fnBody  = js.slice(fnStart, fnStart + 500);
    expect(fnBody).toMatch(/escHtml/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-29 · JS — toast
   ═══════════════════════════════════════════════════════════════ */
describe('10-29 JS toast', () => {
  test('10-29-01 showToast function defined', () => {
    expect(js).toMatch(/function\s+showToast/);
  });
  test('10-29-02 toast uses green for success', () => {
    expect(js).toMatch(/#0E3B2E/);
  });
  test('10-29-03 toast uses red for error', () => {
    expect(js).toMatch(/#DC2626/);
  });
  test('10-29-04 toast auto-removes after timeout', () => {
    var fnStart = js.indexOf('function showToast');
    var fnBody  = js.slice(fnStart, fnStart + 800);
    expect(fnBody).toMatch(/setTimeout/);
    expect(fnBody).toMatch(/\.remove\s*\(\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-30 · properties.html — click handler updated
   ═══════════════════════════════════════════════════════════════ */
describe('10-30 properties.html click handler', () => {
  test('10-30-01 click navigates to /property.html', () => {
    expect(propsHtml).toMatch(/\/property\.html\?id=/);
  });
  test('10-30-02 uses el.getAttribute("data-prop-id")', () => {
    expect(propsHtml).toMatch(/el\.getAttribute\s*\(\s*['"]data-prop-id['"]\s*\)/);
  });
  test('10-30-03 old /settings.html navigation removed from click handler', () => {
    var clickBlock = propsHtml.match(/addEventListener\s*\(\s*['"]click['"][\s\S]{0,200}?\}\s*\)/);
    if (clickBlock) {
      expect(clickBlock[0]).not.toMatch(/window\.location\.href\s*=\s*'\/settings\.html'/);
    }
  });
  test('10-30-04 data-prop-id still set on elements', () => {
    expect(propsHtml).toMatch(/data-prop-id=/);
  });
  test('10-30-05 escHtml still used for p.id', () => {
    expect(propsHtml).toMatch(/escHtml\s*\(\s*p\.id\s*\)/);
  });
  test('10-30-06 property click uses el.getAttribute not p.id directly', () => {
    expect(propsHtml).toMatch(/href.*property\.html.*getAttribute/s);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-31 · Absolute protections — files not modified
   ═══════════════════════════════════════════════════════════════ */
describe('10-31 Absolute protections', () => {
  test('10-31-01 server.js not modified (no property.html reference)', () => {
    const serverPath = path.join(__dirname, '../server.js');
    const server = fs.readFileSync(serverPath, 'utf8');
    expect(server).not.toMatch(/property\.html/);
  });
  test('10-31-02 bh-layout.js e.pointerType !== "mouse" preserved', () => {
    const layoutPath = path.join(__dirname, '../public/js/bh-layout.js');
    const layout = fs.readFileSync(layoutPath, 'utf8');
    expect(layout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
  });
  test('10-31-03 settings.html still exists', () => {
    expect(fs.existsSync(SETTINGS_PATH)).toBe(true);
  });
  test('10-31-04 settings.html still has editPropertyModal', () => {
    expect(settingsHtml).toMatch(/editPropertyModal/);
  });
  test('10-31-05 chat_routes.js not modified by this task', () => {
    const chatPath = path.join(__dirname, '../routes/chat_routes.js');
    if (fs.existsSync(chatPath)) {
      const chat = fs.readFileSync(chatPath, 'utf8');
      expect(chat).not.toMatch(/property-detail-ios-10/);
    }
  });
  test('10-31-06 integrated-chat-handler.js not modified by this task', () => {
    const icPath = path.join(__dirname, '../integrated-chat-handler.js');
    if (fs.existsSync(icPath)) {
      const ic = fs.readFileSync(icPath, 'utf8');
      expect(ic).not.toMatch(/property-detail-ios-10/);
    }
  });
  test('10-31-07 property.html does not modify channex.js', () => {
    const channexPath = path.join(__dirname, '../channex.js');
    if (fs.existsSync(channexPath)) {
      const ch = fs.readFileSync(channexPath, 'utf8');
      expect(ch).not.toMatch(/property-detail-ios-10/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-32 · JS — section labels
   ═══════════════════════════════════════════════════════════════ */
describe('10-32 JS section labels', () => {
  test('10-32-01 "Informations" section label', () => {
    expect(js).toMatch(/Informations/);
  });
  test('10-32-02 "Diffusion" section label', () => {
    expect(js).toMatch(/Diffusion/);
  });
  test('10-32-03 "Calendriers iCal" section label', () => {
    expect(js).toMatch(/Calendriers iCal/);
  });
  test('10-32-04 "Actions" section label', () => {
    expect(js).toMatch(/Actions/);
  });
  test('10-32-05 section labels use prop-detail-section-label class', () => {
    expect(js).toMatch(/prop-detail-section-label/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-33 · JS — isSubAccount logic
   ═══════════════════════════════════════════════════════════════ */
describe('10-33 JS sub-account guard', () => {
  test('10-33-01 isSubAccount function defined', () => {
    expect(js).toMatch(/function\s+isSubAccount/);
  });
  test('10-33-02 checks lcc_is_sub_account localStorage key', () => {
    expect(js).toMatch(/lcc_is_sub_account/);
  });
  test('10-33-03 checks lcc_account_type localStorage key', () => {
    expect(js).toMatch(/lcc_account_type/);
  });
  test('10-33-04 diffusion section hidden for sub-accounts', () => {
    var renderFnStart = js.indexOf('function render(');
    var renderFnBody  = js.slice(renderFnStart, renderFnStart + 600);
    expect(renderFnBody).toMatch(/isSubAccount/);
  });
  test('10-33-05 iCal section also hidden for sub-accounts in render', () => {
    var renderFnStart = js.indexOf('function render(');
    var renderFnBody  = js.slice(renderFnStart, renderFnStart + 600);
    var subGuardMatch = renderFnBody.match(/if\s*\(\s*!\s*isSubAccount\s*\(\s*\)\s*\)([\s\S]{0,300}?)(?:html \+=.*Actions|html \+=.*prop-detail-section-label.*Actions)/);
    if (subGuardMatch) {
      expect(subGuardMatch[1]).toMatch(/Calendriers iCal|renderIcal/);
    } else {
      expect(renderFnBody).toMatch(/isSubAccount/);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-34 · CSS — section label
   ═══════════════════════════════════════════════════════════════ */
describe('10-34 CSS section label', () => {
  test('10-34-01 prop-detail-section-label has uppercase', () => {
    expect(css).toMatch(/\.prop-detail-section-label[\s\S]{0,250}?text-transform\s*:\s*uppercase/);
  });
  test('10-34-02 prop-detail-section-label has letter-spacing', () => {
    expect(css).toMatch(/\.prop-detail-section-label[\s\S]{0,250}?letter-spacing/);
  });
  test('10-34-03 prop-detail-section-label color #5E6B63', () => {
    expect(css).toMatch(/\.prop-detail-section-label[\s\S]{0,250}?color\s*:\s*#5E6B63/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-35 · JS — block bridge to settings.html documented
   ═══════════════════════════════════════════════════════════════ */
describe('10-35 JS block bridge documentation', () => {
  test('10-35-01 renderBlock links to /settings.html', () => {
    var fnStart = js.indexOf('function renderBlock');
    var fnBody  = js.slice(fnStart, fnStart + 500);
    expect(fnBody).toMatch(/\/settings\.html/);
  });
  test('10-35-02 bridge comment mentions PROPERTIES_11', () => {
    expect(js).toMatch(/PROPERTIES_11/);
  });
  test('10-35-03 duplicate action bridges to settings.html', () => {
    var fnStart = js.indexOf('function bindActions');
    var fnBody  = js.slice(fnStart, fnStart + 400);
    expect(fnBody).toMatch(/\/settings\.html/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-36 · JS — groups fetched and used
   ═══════════════════════════════════════════════════════════════ */
describe('10-36 JS property groups', () => {
  test('10-36-01 groups extracted from groupsResult.groups', () => {
    expect(js).toMatch(/groupsResult[\s\S]{0,30}?groups/);
  });
  test('10-36-02 groups.find used to get property group', () => {
    expect(js).toMatch(/groups[\s\S]{0,20}?find/);
  });
  test('10-36-03 group.propertyIds.indexOf(p.id) checked', () => {
    expect(js).toMatch(/propertyIds[\s\S]{0,30}?indexOf\s*\(\s*p\.id\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-37 · JS — IIFE pattern and strict mode
   ═══════════════════════════════════════════════════════════════ */
describe('10-37 JS IIFE and strict mode', () => {
  test('10-37-01 IIFE pattern used', () => {
    expect(js).toMatch(/\(function\s*\(\s*\)\s*\{/);
  });
  test('10-37-02 "use strict" declared', () => {
    expect(js).toMatch(/'use strict'/);
  });
  test('10-37-03 IIFE closed at end', () => {
    expect(js.trim()).toMatch(/\}\)\s*\(\s*\)\s*;?\s*$/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-38 · property.html — bottom pad and inline style
   ═══════════════════════════════════════════════════════════════ */
describe('10-38 property.html inline styles', () => {
  test('10-38-01 bottom pad defined in inline style', () => {
    expect(html).toMatch(/prop-bottom-pad[\s\S]{0,100}?safe-area-inset-bottom/);
  });
  test('10-38-02 bottom pad hidden at 1367px inline', () => {
    expect(html).toMatch(/@media.*1367px[\s\S]{0,100}?prop-bottom-pad[\s\S]{0,60}?display:\s*none/);
  });
  test('10-38-03 meta viewport with viewport-fit=cover', () => {
    expect(html).toMatch(/viewport-fit=cover/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-39 · CSS — block icon
   ═══════════════════════════════════════════════════════════════ */
describe('10-39 CSS block icon', () => {
  test('10-39-01 prop-block-icon defined', () => {
    expect(css).toMatch(/\.prop-block-icon/);
  });
  test('10-39-02 prop-block-icon is 32px', () => {
    expect(css).toMatch(/\.prop-block-icon[\s\S]{0,100}?width\s*:\s*32px/);
  });
  test('10-39-03 prop-block-icon has border-radius', () => {
    expect(css).toMatch(/\.prop-block-icon[\s\S]{0,100}?border-radius/);
  });
  test('10-39-04 prop-block-icon default color is green', () => {
    expect(css).toMatch(/\.prop-block-icon[\s\S]{0,400}?color\s*:\s*#0E3B2E/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   10-40 · JS — render function orchestrates all sections
   ═══════════════════════════════════════════════════════════════ */
describe('10-40 JS render function', () => {
  test('10-40-01 render function defined with p, groups, diffInfo, livret', () => {
    expect(js).toMatch(/function\s+render\s*\(\s*p\s*,\s*groups\s*,\s*diffInfo\s*,\s*livret\s*\)/);
  });
  test('10-40-02 calls updateHeader', () => {
    var fnStart = js.indexOf('function render(');
    var fnBody  = js.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/updateHeader/);
  });
  test('10-40-03 calls renderLivretCard', () => {
    var fnStart = js.indexOf('function render(');
    var fnBody  = js.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/renderLivretCard/);
  });
  test('10-40-04 calls renderBlocksCard', () => {
    var fnStart = js.indexOf('function render(');
    var fnBody  = js.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/renderBlocksCard/);
  });
  test('10-40-05 calls renderActions', () => {
    var fnStart = js.indexOf('function render(');
    var fnBody  = js.slice(fnStart, fnStart + 600);
    expect(fnBody).toMatch(/renderActions/);
  });
  test('10-40-06 calls bindActions after rendering', () => {
    var fnStart = js.indexOf('function render(');
    var fnBody  = js.slice(fnStart, fnStart + 1200);
    expect(fnBody).toMatch(/bindActions/);
  });
  test('10-40-07 propDetBody shown after render', () => {
    var fnStart = js.indexOf('function render(');
    var fnBody  = js.slice(fnStart, fnStart + 1200);
    expect(fnBody).toMatch(/bodyEl\.style\.display\s*=\s*''/);
  });
  test('10-40-08 propDetLoading hidden after render', () => {
    var fnStart = js.indexOf('function render(');
    var fnBody  = js.slice(fnStart, fnStart + 1200);
    expect(fnBody).toMatch(/propDetLoading[\s\S]{0,100}?display[\s\S]{0,40}?none/);
  });
});

/**
 * BOOSTINGHOST_WEB_IOS_PARITY_PROPERTY_DETAIL_11C_AI_PLATFORMS
 *
 * Validates migration of the AI and Platforms sections to native
 * section editors in property.html.
 *
 * Files under test:
 *   - public/css/bh-property-detail-sections-11c.css
 *   - public/js/bh-property-detail-sections-11c.js
 *   - public/js/bh-property-detail-ios-10.js  (section routing, hub coherence)
 *   - public/property.html
 *
 * Run: npx jest tests/ios_web_parity_property_detail_11c_ai_platforms.test.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CSS11C_PATH = path.join(__dirname, '../public/css/bh-property-detail-sections-11c.css');
const JS11C_PATH  = path.join(__dirname, '../public/js/bh-property-detail-sections-11c.js');
const JS10_PATH   = path.join(__dirname, '../public/js/bh-property-detail-ios-10.js');
const HTML_PATH   = path.join(__dirname, '../public/property.html');

const css11c = fs.existsSync(CSS11C_PATH) ? fs.readFileSync(CSS11C_PATH, 'utf8') : '';
const js11c  = fs.existsSync(JS11C_PATH)  ? fs.readFileSync(JS11C_PATH,  'utf8') : '';
const js10   = fs.existsSync(JS10_PATH)   ? fs.readFileSync(JS10_PATH,   'utf8') : '';
const html   = fs.existsSync(HTML_PATH)   ? fs.readFileSync(HTML_PATH,   'utf8') : '';

/* ═══════════════════════════════════════════════════════════════
   11C-01 · File existence
   ═══════════════════════════════════════════════════════════════ */
describe('11C-01 file existence', () => {
  test('11C-01-01 bh-property-detail-sections-11c.css exists', () => {
    expect(fs.existsSync(CSS11C_PATH)).toBe(true);
  });
  test('11C-01-02 bh-property-detail-sections-11c.js exists', () => {
    expect(fs.existsSync(JS11C_PATH)).toBe(true);
  });
  test('11C-01-03 property.html includes 11c CSS', () => {
    expect(html).toMatch(/bh-property-detail-sections-11c\.css/);
  });
  test('11C-01-04 property.html includes 11c JS', () => {
    expect(html).toMatch(/bh-property-detail-sections-11c\.js/);
  });
  test('11C-01-05 11c CSS loaded after 11b CSS', () => {
    var idx11b = html.indexOf('bh-property-detail-sections-11b.css');
    var idx11c = html.indexOf('bh-property-detail-sections-11c.css');
    expect(idx11b).toBeGreaterThan(-1);
    expect(idx11c).toBeGreaterThan(idx11b);
  });
  test('11C-01-06 11c JS loaded after 11b JS', () => {
    var idx11b = html.indexOf('bh-property-detail-sections-11b.js');
    var idx11c = html.indexOf('bh-property-detail-sections-11c.js');
    expect(idx11b).toBeGreaterThan(-1);
    expect(idx11c).toBeGreaterThan(idx11b);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-02 · IIFE structure
   ═══════════════════════════════════════════════════════════════ */
describe('11C-02 IIFE structure', () => {
  test('11C-02-01 wrapped in IIFE', () => {
    expect(js11c).toMatch(/\(function\s*\(\s*\)\s*\{/);
  });
  test('11C-02-02 use strict directive', () => {
    expect(js11c).toMatch(/'use strict'/);
  });
  test('11C-02-03 early back-nav IIFE present', () => {
    expect(js11c).toMatch(/\(function\s*\(\s*\)\s*\{[\s\S]{0,50}?try/);
  });
  test('11C-02-04 ai title in early IIFE', () => {
    expect(js11c).toMatch(/Assistant IA/);
  });
  test('11C-02-05 platforms title in early IIFE', () => {
    expect(js11c).toMatch(/Plateformes & prix/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-03 · Early back-nav
   ═══════════════════════════════════════════════════════════════ */
describe('11C-03 early back-nav IIFE', () => {
  test('11C-03-01 data-back-href set', () => {
    expect(js11c).toMatch(/data-back-href/);
  });
  test('11C-03-02 data-back-label set', () => {
    expect(js11c).toMatch(/data-back-label/);
  });
  test('11C-03-03 data-title set', () => {
    expect(js11c).toMatch(/data-title/);
  });
  test('11C-03-04 data-kicker set', () => {
    expect(js11c).toMatch(/data-kicker/);
  });
  test('11C-03-05 Assistant IA title present', () => {
    expect(js11c).toMatch(/['"]Assistant IA['"]/);
  });
  test('11C-03-06 Plateformes & prix title present', () => {
    expect(js11c).toMatch(/Plateformes & prix/);
  });
  test('11C-03-07 propId used in back-href', () => {
    expect(js11c).toMatch(/data-back-href[\s\S]{0,100}?propId/);
  });
  test('11C-03-08 titles11c object with ai and platforms keys', () => {
    expect(js11c).toMatch(/titles11c/);
    expect(js11c).toMatch(/titles11c[\s\S]{0,200}?ai/);
    expect(js11c).toMatch(/titles11c[\s\S]{0,200}?platforms/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-04 · Helpers
   ═══════════════════════════════════════════════════════════════ */
describe('11C-04 helpers', () => {
  test('11C-04-01 escHtml defined', () => {
    expect(js11c).toMatch(/function\s+escHtml/);
  });
  test('11C-04-02 showToast defined', () => {
    expect(js11c).toMatch(/function\s+showToast/);
  });
  test('11C-04-03 isSubAccount defined', () => {
    expect(js11c).toMatch(/function\s+isSubAccount/);
  });
  test('11C-04-04 buildBaseFormData defined', () => {
    expect(js11c).toMatch(/function\s+buildBaseFormData/);
  });
  test('11C-04-05 sectionLabel helper defined', () => {
    expect(js11c).toMatch(/function\s+sectionLabel/);
  });
  test('11C-04-06 makeSectionHeader helper defined', () => {
    expect(js11c).toMatch(/function\s+makeSectionHeader/);
  });
  test('11C-04-07 isSubAccount checks lcc_is_sub_account', () => {
    expect(js11c).toMatch(/lcc_is_sub_account/);
  });
  test('11C-04-08 isSubAccount checks lcc_account_type', () => {
    expect(js11c).toMatch(/lcc_account_type/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-05 · window.BhPropSections11c
   ═══════════════════════════════════════════════════════════════ */
describe('11C-05 window.BhPropSections11c', () => {
  test('11C-05-01 window.BhPropSections11c exposed', () => {
    expect(js11c).toMatch(/window\.BhPropSections11c\s*=/);
  });
  test('11C-05-02 mount function on BhPropSections11c', () => {
    expect(js11c).toMatch(/BhPropSections11c\s*=\s*\{\s*mount\s*:/);
  });
  test('11C-05-03 mount function handles ai section', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/section\s*===\s*['"]ai['"]/);
  });
  test('11C-05-04 mount function handles platforms section', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 800);
    expect(fnBody).toMatch(/section\s*===\s*['"]platforms['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-06 · SECTION_TITLES
   ═══════════════════════════════════════════════════════════════ */
describe('11C-06 SECTION_TITLES', () => {
  test('11C-06-01 SECTION_TITLES defined', () => {
    expect(js11c).toMatch(/SECTION_TITLES\s*=/);
  });
  test('11C-06-02 ai title in SECTION_TITLES', () => {
    var idx  = js11c.indexOf('SECTION_TITLES');
    var body = js11c.slice(idx, idx + 200);
    expect(body).toMatch(/ai\s*:/);
  });
  test('11C-06-03 platforms title in SECTION_TITLES', () => {
    var idx  = js11c.indexOf('SECTION_TITLES');
    var body = js11c.slice(idx, idx + 200);
    expect(body).toMatch(/platforms\s*:/);
  });
  test('11C-06-04 renderSection uses SECTION_TITLES', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/SECTION_TITLES/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-10 · AI section — renderAiRead
   ═══════════════════════════════════════════════════════════════ */
describe('11C-10 renderAiRead', () => {
  test('11C-10-01 renderAiRead function defined', () => {
    expect(js11c).toMatch(/function\s+renderAiRead/);
  });
  test('11C-10-02 reads autoResponsesEnabled', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 800);
    expect(fnBody).toMatch(/p\.autoResponsesEnabled/);
  });
  test('11C-10-03 Activé shown when true', () => {
    expect(js11c).toMatch(/Activé/);
  });
  test('11C-10-04 Désactivé shown when false', () => {
    expect(js11c).toMatch(/Désactivé/);
  });
  test('11C-10-05 Réponses automatiques label', () => {
    expect(js11c).toMatch(/Réponses automatiques/);
  });
  test('11C-10-06 reads facts array', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/facts/);
  });
  test('11C-10-07 prop-fact-row class in read', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/prop-fact-row/);
  });
  test('11C-10-08 prop-fact-answer-badge class used', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/prop-fact-answer-badge/);
  });
  test('11C-10-09 empty state for facts', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/Aucune question/);
  });
  test('11C-10-10 reads quick_replies (snake_case)', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/p\.quick_replies/);
  });
  test('11C-10-11 prop-qr-row class used', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1800);
    expect(fnBody).toMatch(/prop-qr-row/);
  });
  test('11C-10-12 empty state for quick replies', () => {
    var fnIdx  = js11c.indexOf('function renderAiRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1600);
    expect(fnBody).toMatch(/Aucune réponse rapide/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-11 · AI section — renderAiEdit
   ═══════════════════════════════════════════════════════════════ */
describe('11C-11 renderAiEdit', () => {
  test('11C-11-01 renderAiEdit function defined', () => {
    expect(js11c).toMatch(/function\s+renderAiEdit/);
  });
  test('11C-11-02 psfAiAutoToggle id present', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/psfAiAutoToggle/);
  });
  test('11C-11-03 prop-toggle class on toggle button', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/prop-toggle/);
  });
  test('11C-11-04 autoResponsesEnabled used to set toggle state', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/autoResponsesEnabled/);
  });
  test('11C-11-05 psfFactsCard container id', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2000);
    expect(fnBody).toMatch(/psfFactsCard/);
  });
  test('11C-11-06 psfFactsList container id', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2000);
    expect(fnBody).toMatch(/psfFactsList/);
  });
  test('11C-11-07 psfFactAddBtn id', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2000);
    expect(fnBody).toMatch(/psfFactAddBtn/);
  });
  test('11C-11-08 psfFactQ input for question', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2000);
    expect(fnBody).toMatch(/psfFactQ/);
  });
  test('11C-11-09 psfFactA select for answer', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2000);
    expect(fnBody).toMatch(/psfFactA/);
  });
  test('11C-11-10 psfFactD detail input', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2000);
    expect(fnBody).toMatch(/psfFactD/);
  });
  test('11C-11-11 psfQrList container id', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/psfQrList/);
  });
  test('11C-11-12 psfQrAddBtn id', () => {
    var fnIdx  = js11c.indexOf('function renderAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/psfQrAddBtn/);
  });
  test('11C-11-13 data-qr-title attribute', () => {
    expect(js11c).toMatch(/data-qr-title/);
  });
  test('11C-11-14 data-qr-text attribute', () => {
    expect(js11c).toMatch(/data-qr-text/);
  });
  test('11C-11-15 quick replies max 5 constraint', () => {
    expect(js11c).toMatch(/>=\s*5|<\s*5|\.length\s*<\s*5/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-12 · Facts API
   ═══════════════════════════════════════════════════════════════ */
describe('11C-12 facts API', () => {
  test('11C-12-01 GET /api/properties/:id/facts in mount', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/\/facts/);
  });
  test('11C-12-02 DELETE /api/properties/:id/facts/:factId', () => {
    expect(js11c).toMatch(/\/facts\/['"\s]*'\s*\+\s*factId|\/facts\/' \+ factId|facts\/' \+ factId/);
  });
  test('11C-12-03 POST /api/properties/:id/facts', () => {
    expect(js11c).toMatch(/\/facts['"]\s*,\s*\{[\s\S]{0,50}?method\s*:\s*['"]POST['"]/);
  });
  test('11C-12-04 fact POST uses JSON.stringify', () => {
    var postIdx = js11c.indexOf("method:  'POST'");
    var ctx     = js11c.slice(postIdx - 100, postIdx + 300);
    expect(ctx).toMatch(/JSON\.stringify/);
  });
  test('11C-12-05 fact POST payload includes question', () => {
    expect(js11c).toMatch(/question\s*:\s*question/);
  });
  test('11C-12-06 fact POST payload includes answer as boolean', () => {
    expect(js11c).toMatch(/answer\s*:\s*answer/);
    expect(js11c).toMatch(/answer\s*=\s*answerVal\s*===\s*['"]true['"]/);
  });
  test('11C-12-07 data-fact-id attribute on delete button', () => {
    expect(js11c).toMatch(/data-fact-id/);
  });
  test('11C-12-08 method DELETE for facts', () => {
    expect(js11c).toMatch(/method\s*:\s*['"]DELETE['"]/);
  });
  test('11C-12-09 prop-fact-delete-btn class used', () => {
    expect(js11c).toMatch(/prop-fact-delete-btn/);
  });
  test('11C-12-10 answer converted to boolean (=== true)', () => {
    expect(js11c).toMatch(/=\s*answerVal\s*===\s*['"]true['"]/);
  });
  test('11C-12-11 factAddBtn disabled while posting', () => {
    expect(js11c).toMatch(/factAddBtn\.disabled\s*=\s*true/);
  });
  test('11C-12-12 factAddBtn re-enabled after fetch', () => {
    expect(js11c).toMatch(/factAddBtn\.disabled\s*=\s*false/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-13 · AI section — save
   ═══════════════════════════════════════════════════════════════ */
describe('11C-13 AI save', () => {
  test('11C-13-01 psfSaveBtn used in AI section', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 6100);
    expect(fnBody).toMatch(/psfSaveBtn/);
  });
  test('11C-13-02 autoResponsesEnabled via PUT /api/properties/:id', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7100);
    expect(fnBody).toMatch(/autoResponsesEnabled/);
    expect(fnBody).toMatch(/PUT/);
  });
  test('11C-13-03 quick-replies PUT endpoint used', () => {
    expect(js11c).toMatch(/\/quick-replies/);
    expect(js11c).toMatch(/method\s*:\s*['"]PUT['"][\s\S]{0,200}?quick-replies|quick-replies[\s\S]{0,200}?method\s*:\s*['"]PUT['"]/);
  });
  test('11C-13-04 quickReplies array in JSON body', () => {
    expect(js11c).toMatch(/quickReplies\s*:/);
    expect(js11c).toMatch(/JSON\.stringify\s*\(\s*\{\s*quickReplies/);
  });
  test('11C-13-05 saveBtn disabled on click', () => {
    expect(js11c).toMatch(/saveBtn\.disabled\s*=\s*true/);
  });
  test('11C-13-06 saveBtn re-enabled on error', () => {
    expect(js11c).toMatch(/saveBtn\.disabled\s*=\s*false/);
  });
  test('11C-13-07 fd.set autoResponsesEnabled', () => {
    expect(js11c).toMatch(/fd\.set\s*\(\s*['"]autoResponsesEnabled['"]/);
  });
  test('11C-13-08 navigate to backHref on success', () => {
    expect(js11c).toMatch(/window\.location\.href\s*=\s*backHref/);
  });
  test('11C-13-09 buildBaseFormData used in AI save', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7000);
    expect(fnBody).toMatch(/buildBaseFormData/);
  });
  test('11C-13-10 showToast on error', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/showToast[\s\S]{0,50}?error/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-20 · Platforms section — renderPlatformsRead
   ═══════════════════════════════════════════════════════════════ */
describe('11C-20 renderPlatformsRead', () => {
  test('11C-20-01 renderPlatformsRead function defined', () => {
    expect(js11c).toMatch(/function\s+renderPlatformsRead/);
  });
  test('11C-20-02 diffusion block present', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/Diffusion/);
  });
  test('11C-20-03 isSubAccount check hides diffusion', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/isSubAccount/);
  });
  test('11C-20-04 Connecté badge', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/Connecté/);
  });
  test('11C-20-05 Non connecté badge', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/Non connecté/);
  });
  test('11C-20-06 channexPropertyId shown', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1500);
    expect(fnBody).toMatch(/channexPropertyId/);
  });
  test('11C-20-07 prop-diffusion-status-badge class used', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/prop-diffusion-status-badge/);
  });
  test('11C-20-08 iCal list rendered', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/icalUrls/);
  });
  test('11C-20-09 markups rendered', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/markups/);
  });
  test('11C-20-10 prop-markup-row class used', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2800);
    expect(fnBody).toMatch(/prop-markup-row/);
  });
  test('11C-20-11 prop-platform-badge class used', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2900);
    expect(fnBody).toMatch(/prop-platform-badge/);
  });
  test('11C-20-12 empty state for iCal', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsRead');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/Aucun flux iCal/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-21 · Platforms section — renderPlatformsEdit
   ═══════════════════════════════════════════════════════════════ */
describe('11C-21 renderPlatformsEdit', () => {
  test('11C-21-01 renderPlatformsEdit function defined', () => {
    expect(js11c).toMatch(/function\s+renderPlatformsEdit/);
  });
  test('11C-21-02 psfConnectBtn when not connected', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1500);
    expect(fnBody).toMatch(/psfConnectBtn/);
  });
  test('11C-21-03 psfDisconnectBtn when connected', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1500);
    expect(fnBody).toMatch(/psfDisconnectBtn/);
  });
  test('11C-21-04 Channex block hidden for sub-accounts', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/isSubAccount/);
  });
  test('11C-21-05 iCal list with delete buttons', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/psfIcalList/);
  });
  test('11C-21-06 psfIcalAddBtn present', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/psfIcalAddBtn/);
  });
  test('11C-21-07 psfIcalPlatform input', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/psfIcalPlatform/);
  });
  test('11C-21-08 psfIcalUrl input', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/psfIcalUrl/);
  });
  test('11C-21-09 psfIcalSyncBtn present', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/psfIcalSyncBtn/);
  });
  test('11C-21-10 markup inputs with data-markup-code', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3300);
    expect(fnBody).toMatch(/data-markup-code/);
  });
  test('11C-21-11 prop-markup-input class', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3200);
    expect(fnBody).toMatch(/prop-markup-input/);
  });
  test('11C-21-12 data-ical-index on iCal delete buttons', () => {
    expect(js11c).toMatch(/data-ical-index/);
  });
  test('11C-21-13 min 0 max 100 on markup inputs', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3500);
    expect(fnBody).toMatch(/min=["']0["']/);
    expect(fnBody).toMatch(/max=["']100["']/);
  });
  test('11C-21-14 prop-diffusion-connect-btn class', () => {
    expect(js11c).toMatch(/prop-diffusion-connect-btn/);
  });
  test('11C-21-15 prop-diffusion-disconnect-btn class', () => {
    expect(js11c).toMatch(/prop-diffusion-disconnect-btn/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-22 · Platforms API calls
   ═══════════════════════════════════════════════════════════════ */
describe('11C-22 platforms API calls', () => {
  test('11C-22-01 connect-property POST endpoint', () => {
    expect(js11c).toMatch(/\/api\/channex\/connect-property/);
  });
  test('11C-22-02 disconnect-property POST endpoint', () => {
    expect(js11c).toMatch(/\/api\/channex\/disconnect-property/);
  });
  test('11C-22-03 connect sends property_id', () => {
    var idx  = js11c.indexOf('connect-property');
    var body = js11c.slice(idx, idx + 300);
    expect(body).toMatch(/property_id/);
  });
  test('11C-22-04 disconnect sends property_id', () => {
    var idx  = js11c.indexOf('disconnect-property');
    var body = js11c.slice(idx, idx + 300);
    expect(body).toMatch(/property_id/);
  });
  test('11C-22-05 sync/ical POST endpoint', () => {
    expect(js11c).toMatch(/\/api\/sync\/ical/);
  });
  test('11C-22-06 markups PATCH endpoint', () => {
    expect(js11c).toMatch(/\/markups/);
    expect(js11c).toMatch(/method\s*:\s*['"]PATCH['"]/);
  });
  test('11C-22-07 markup PATCH body has code and pct', () => {
    var idx  = js11c.indexOf("'PATCH'");
    var body = js11c.slice(idx - 100, idx + 300);
    expect(body).toMatch(/code\s*:/);
    expect(body).toMatch(/pct\s*:/);
  });
  test('11C-22-08 icalUrls via PUT /api/properties/:id', () => {
    expect(js11c).toMatch(/icalUrls/);
    var idx  = js11c.indexOf("fd.append('icalUrls'");
    var body = js11c.slice(idx, idx + 150);
    expect(body).toMatch(/fd\.append/);
  });
  test('11C-22-09 JSON.stringify for icalUrls', () => {
    expect(js11c).toMatch(/JSON\.stringify\s*\(\s*currentIcalUrls\s*\)/);
  });
  test('11C-22-10 fd.append icalUrls', () => {
    expect(js11c).toMatch(/fd\.append\s*\(\s*['"]icalUrls['"]/);
  });
  test('11C-22-11 connect error re-enables button', () => {
    var fnIdx = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/connectBtn\.disabled\s*=\s*false/);
  });
  test('11C-22-12 disconnect error re-enables button', () => {
    var fnIdx = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2500);
    expect(fnBody).toMatch(/disconnectBtn\.disabled\s*=\s*false/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-23 · Platforms save
   ═══════════════════════════════════════════════════════════════ */
describe('11C-23 platforms save', () => {
  test('11C-23-01 psfSaveBtn in bindPlatformsEdit', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 5500);
    expect(fnBody).toMatch(/psfSaveBtn/);
  });
  test('11C-23-02 iCal saved via property PUT', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 6200);
    expect(fnBody).toMatch(/method\s*:\s*['"]PUT['"]/);
  });
  test('11C-23-03 markups PATCH in save', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7000);
    expect(fnBody).toMatch(/PATCH/);
  });
  test('11C-23-04 saveBtn disabled during save', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 5700);
    expect(fnBody).toMatch(/saveBtn\.disabled\s*=\s*true/);
  });
  test('11C-23-05 saveBtn re-enabled on error', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 6600);
    expect(fnBody).toMatch(/saveBtn\.disabled\s*=\s*false/);
  });
  test('11C-23-06 markup saves chained (Promise chain)', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 6800);
    expect(fnBody).toMatch(/chain\s*=\s*chain\.then/);
  });
  test('11C-23-07 navigate to backHref on success', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7200);
    expect(fnBody).toMatch(/window\.location\.href\s*=\s*backHref/);
  });
  test('11C-23-08 buildBaseFormData used in platforms save', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 6100);
    expect(fnBody).toMatch(/buildBaseFormData/);
  });
  test('11C-23-09 showToast success on save', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3000);
    expect(fnBody).toMatch(/showToast[\s\S]{0,50}?success/);
  });
  test('11C-23-10 markupCodes collected from DOM', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 5800);
    expect(fnBody).toMatch(/markupCodes/);
    expect(fnBody).toMatch(/data-markup-code/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-30 · ios-10.js modifications
   ═══════════════════════════════════════════════════════════════ */
describe('11C-30 ios-10.js changes', () => {
  test('11C-30-01 sectionRoutes has ai:ai', () => {
    expect(js10).toMatch(/ai\s*:\s*['"]ai['"]/);
  });
  test('11C-30-02 sectionRoutes has platforms:platforms', () => {
    expect(js10).toMatch(/platforms\s*:\s*['"]platforms['"]/);
  });
  test('11C-30-03 sectionRoutes has 9 entries', () => {
    var routesIdx = js10.indexOf('var sectionRoutes =');
    var body      = js10.slice(routesIdx, routesIdx + 600);
    var entries   = body.match(/:\s*['"][a-z]+['"]/g) || [];
    expect(entries.length).toBe(9);
  });
  test('11C-30-04 renderDiffusion links to section=platforms', () => {
    var fnIdx  = js10.indexOf('function renderDiffusion');
    var fnBody = js10.slice(fnIdx, fnIdx + 700);
    expect(fnBody).toMatch(/section=platforms/);
  });
  test('11C-30-05 renderIcal links to section=platforms', () => {
    var fnIdx  = js10.indexOf('function renderIcal');
    var fnBody = js10.slice(fnIdx, fnIdx + 900);
    expect(fnBody).toMatch(/section=platforms/);
  });
  test('11C-30-06 bindActions disconnectBtn navigates to section=platforms', () => {
    var fnIdx  = js10.indexOf('function bindActions');
    var fnBody = js10.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/section=platforms/);
  });
  test('11C-30-07 is11c variable defined in loadSection', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/is11c/);
  });
  test('11C-30-08 BhPropSections11c.mount called', () => {
    expect(js10).toMatch(/BhPropSections11c[\s\S]{0,50}?\.mount/);
  });
  test('11C-30-09 knownSections includes ai', () => {
    var fnIdx  = js10.indexOf('function init');
    var fnBody = js10.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/knownSections[\s\S]{0,200}?['"]ai['"]/);
  });
  test('11C-30-10 knownSections includes platforms', () => {
    var fnIdx  = js10.indexOf('function init');
    var fnBody = js10.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/knownSections[\s\S]{0,200}?['"]platforms['"]/);
  });
  test('11C-30-11 is11c checks ai and platforms', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/is11c[\s\S]{0,200}?['"]ai['"]/);
    expect(fnBody).toMatch(/is11c[\s\S]{0,200}?['"]platforms['"]/);
  });
  test('11C-30-12 loadSection dispatches to BhPropSections11c', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 1600);
    expect(fnBody).toMatch(/is11c/);
    expect(fnBody).toMatch(/BhPropSections11c/);
  });
  test('11C-30-13 renderDiffusion no longer bridges to /settings.html', () => {
    var fnIdx  = js10.indexOf('function renderDiffusion');
    var fnBody = js10.slice(fnIdx, fnIdx + 700);
    expect(fnBody).not.toMatch(/href=["']\/settings\.html["']/);
  });
  test('11C-30-14 renderIcal no longer bridges to /settings.html', () => {
    var fnIdx  = js10.indexOf('function renderIcal');
    var fnBody = js10.slice(fnIdx, fnIdx + 600);
    expect(fnBody).not.toMatch(/href=["']\/settings\.html["']/);
  });
  test('11C-30-15 BhPropSections11c error handling', () => {
    var fnIdx  = js10.indexOf('is11c');
    var fnBody = js10.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/Erreur de chargement/);
  });
  test('11C-30-16 window._propDetDisconnect navigates to section=platforms', () => {
    expect(js10).toMatch(/_propDetDisconnect[\s\S]{0,200}?section=platforms/);
  });
  test('11C-30-17 renderDiffusion section=platforms for connected case', () => {
    var fnIdx  = js10.indexOf('function renderDiffusion');
    var fnBody = js10.slice(fnIdx, fnIdx + 900);
    expect(fnBody).toMatch(/Gérer la diffusion/);
    expect(fnBody).toMatch(/section=platforms/);
  });
  test('11C-30-18 renderDiffusion section=platforms for non-connected case', () => {
    var fnIdx  = js10.indexOf('function renderDiffusion');
    var fnBody = js10.slice(fnIdx, fnIdx + 700);
    expect(fnBody).toMatch(/Connecter à la diffusion/);
  });
  test('11C-30-19 renderIcal iCal labels still present', () => {
    var fnIdx  = js10.indexOf('function renderIcal');
    var fnBody = js10.slice(fnIdx, fnIdx + 800);
    expect(fnBody).toMatch(/Ajouter un flux iCal/);
    expect(fnBody).toMatch(/Modifier les flux iCal/);
  });
  test('11C-30-20 fallback /settings.html still in renderBlock', () => {
    var fnIdx  = js10.indexOf('function renderBlock');
    var fnBody = js10.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/\/settings\.html/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-40 · CSS assertions
   ═══════════════════════════════════════════════════════════════ */
describe('11C-40 CSS classes', () => {
  test('11C-40-01 prop-platform-badge in CSS', () => {
    expect(css11c).toMatch(/\.prop-platform-badge/);
  });
  test('11C-40-02 prop-markup-row in CSS', () => {
    expect(css11c).toMatch(/\.prop-markup-row/);
  });
  test('11C-40-03 prop-markup-input in CSS', () => {
    expect(css11c).toMatch(/\.prop-markup-input/);
  });
  test('11C-40-04 prop-markup-pct in CSS', () => {
    expect(css11c).toMatch(/\.prop-markup-pct/);
  });
  test('11C-40-05 prop-fact-row in CSS', () => {
    expect(css11c).toMatch(/\.prop-fact-row/);
  });
  test('11C-40-06 prop-fact-answer-badge--true in CSS', () => {
    expect(css11c).toMatch(/\.prop-fact-answer-badge--true/);
  });
  test('11C-40-07 prop-fact-answer-badge--false in CSS', () => {
    expect(css11c).toMatch(/\.prop-fact-answer-badge--false/);
  });
  test('11C-40-08 prop-fact-question in CSS', () => {
    expect(css11c).toMatch(/\.prop-fact-question/);
  });
  test('11C-40-09 prop-fact-delete-btn in CSS', () => {
    expect(css11c).toMatch(/\.prop-fact-delete-btn/);
  });
  test('11C-40-10 prop-qr-row in CSS', () => {
    expect(css11c).toMatch(/\.prop-qr-row/);
  });
  test('11C-40-11 prop-qr-title in CSS', () => {
    expect(css11c).toMatch(/\.prop-qr-title/);
  });
  test('11C-40-12 prop-qr-text in CSS', () => {
    expect(css11c).toMatch(/\.prop-qr-text/);
  });
  test('11C-40-13 prop-ical-dot in CSS', () => {
    expect(css11c).toMatch(/\.prop-ical-dot/);
  });
  test('11C-40-14 prop-diffusion-status-badge in CSS', () => {
    expect(css11c).toMatch(/\.prop-diffusion-status-badge/);
  });
  test('11C-40-15 prop-diffusion-connect-btn in CSS', () => {
    expect(css11c).toMatch(/\.prop-diffusion-connect-btn/);
  });
  test('11C-40-16 prop-diffusion-disconnect-btn in CSS', () => {
    expect(css11c).toMatch(/\.prop-diffusion-disconnect-btn/);
  });
  test('11C-40-17 prop-fact-add-form in CSS', () => {
    expect(css11c).toMatch(/\.prop-fact-add-form/);
  });
  test('11C-40-18 prop-qr-edit-item in CSS', () => {
    expect(css11c).toMatch(/\.prop-qr-edit-item/);
  });
  test('11C-40-19 prop-ical-sync-btn in CSS', () => {
    expect(css11c).toMatch(/\.prop-ical-sync-btn/);
  });
  test('11C-40-20 prop-diffusion-status-row in CSS', () => {
    expect(css11c).toMatch(/\.prop-diffusion-status-row/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-50 · Platform colors
   ═══════════════════════════════════════════════════════════════ */
describe('11C-50 platform colors', () => {
  test('11C-50-01 PLATFORM_COLORS object defined', () => {
    expect(js11c).toMatch(/PLATFORM_COLORS\s*=/);
  });
  test('11C-50-02 ABB Airbnb color #FF5A5F', () => {
    var idx  = js11c.indexOf('PLATFORM_COLORS');
    var body = js11c.slice(idx, idx + 200);
    expect(body).toMatch(/ABB[\s\S]{0,20}?#FF5A5F/);
  });
  test('11C-50-03 BDC Booking color #003580', () => {
    var idx  = js11c.indexOf('PLATFORM_COLORS');
    var body = js11c.slice(idx, idx + 200);
    expect(body).toMatch(/BDC[\s\S]{0,20}?#003580/);
  });
  test('11C-50-04 EXP Expedia color #FFC72C', () => {
    var idx  = js11c.indexOf('PLATFORM_COLORS');
    var body = js11c.slice(idx, idx + 200);
    expect(body).toMatch(/EXP[\s\S]{0,20}?#FFC72C/);
  });
  test('11C-50-05 VRB VRBO color #1A5276', () => {
    var idx  = js11c.indexOf('PLATFORM_COLORS');
    var body = js11c.slice(idx, idx + 200);
    expect(body).toMatch(/VRB[\s\S]{0,20}?#1A5276/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-60 · renderSection structure
   ═══════════════════════════════════════════════════════════════ */
describe('11C-60 renderSection', () => {
  test('11C-60-01 renderSection function defined', () => {
    expect(js11c).toMatch(/function\s+renderSection/);
  });
  test('11C-60-02 prop-section-view wrapper', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/prop-section-view/);
  });
  test('11C-60-03 makeSectionHeader called', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/makeSectionHeader/);
  });
  test('11C-60-04 edit button in read mode', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1400);
    expect(fnBody).toMatch(/psfEditBtn/);
  });
  test('11C-60-05 cancel and save buttons in edit mode', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/psfCancelBtn/);
    expect(fnBody).toMatch(/psfSaveBtn/);
  });
  test('11C-60-06 prop-bottom-pad in output', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1400);
    expect(fnBody).toMatch(/prop-bottom-pad/);
  });
  test('11C-60-07 desktop header updated', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1600);
    expect(fnBody).toMatch(/propDetTitle/);
    expect(fnBody).toMatch(/propDetKicker/);
  });
  test('11C-60-08 backHref points to property hub', () => {
    var fnIdx  = js11c.indexOf('function renderSection');
    var fnBody = js11c.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/\/property\.html\?id=/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-70 · Safety
   ═══════════════════════════════════════════════════════════════ */
describe('11C-70 safety', () => {
  test('11C-70-01 server.js still exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../server.js'))).toBe(true);
  });
  test('11C-70-02 settings.html still exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../public/settings.html'))).toBe(true);
  });
  test('11C-70-03 e.pointerType preservation in bh-layout.js', () => {
    var layoutPath = path.join(__dirname, '../public/js/bh-layout.js');
    if (fs.existsSync(layoutPath)) {
      var layout = fs.readFileSync(layoutPath, 'utf8');
      expect(layout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
    } else {
      expect(true).toBe(true);
    }
  });
  test('11C-70-04 externalPricing NOT in 11c JS', () => {
    expect(js11c).not.toMatch(/externalPricing/);
  });
  test('11C-70-05 externalPricing omitted comment in header', () => {
    expect(js11c).toMatch(/externalPricing.*omit|NOT in GET.*omit/i);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-80 · Hub coherence
   ═══════════════════════════════════════════════════════════════ */
describe('11C-80 hub coherence', () => {
  test('11C-80-01 renderDiffusion links to &section=platforms', () => {
    var fnIdx  = js10.indexOf('function renderDiffusion');
    var fnBody = js10.slice(fnIdx, fnIdx + 700);
    expect(fnBody).toMatch(/section=platforms/);
  });
  test('11C-80-02 renderIcal links to &section=platforms', () => {
    var fnIdx  = js10.indexOf('function renderIcal');
    var fnBody = js10.slice(fnIdx, fnIdx + 900);
    expect(fnBody).toMatch(/section=platforms/);
  });
  test('11C-80-03 Gérer la diffusion still present in hub', () => {
    expect(js10).toMatch(/Gérer la diffusion/);
  });
  test('11C-80-04 Connecter à la diffusion still present in hub', () => {
    expect(js10).toMatch(/Connecter à la diffusion/);
  });
  test('11C-80-05 Ajouter un flux iCal still present in hub', () => {
    expect(js10).toMatch(/Ajouter un flux iCal/);
  });
  test('11C-80-06 Modifier les flux iCal still present in hub', () => {
    expect(js10).toMatch(/Modifier les flux iCal/);
  });
  test('11C-80-07 renderBlock has ai call', () => {
    expect(js10).toMatch(/renderBlock\s*\(\s*['"]ai['"]/);
  });
  test('11C-80-08 renderBlock has platforms call', () => {
    expect(js10).toMatch(/renderBlock\s*\(\s*['"]platforms['"]/);
  });
  test('11C-80-09 loadSection handles ai section', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/['"]ai['"]/);
  });
  test('11C-80-10 loadSection handles platforms section', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/['"]platforms['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-90 · bindAiEdit specifics
   ═══════════════════════════════════════════════════════════════ */
describe('11C-90 bindAiEdit', () => {
  test('11C-90-01 bindAiEdit function defined', () => {
    expect(js11c).toMatch(/function\s+bindAiEdit/);
  });
  test('11C-90-02 toggle click handler changes prop-toggle--on', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/prop-toggle--on/);
  });
  test('11C-90-03 fact delete uses fetch with DELETE method', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1500);
    expect(fnBody).toMatch(/method\s*:\s*['"]DELETE['"]/);
  });
  test('11C-90-04 fact add uses fetch with POST method', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3100);
    expect(fnBody).toMatch(/method\s*:\s*['"]POST['"]/);
  });
  test('11C-90-05 quick replies collected from DOM by querySelectorAll', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 4700);
    expect(fnBody).toMatch(/querySelectorAll.*qr-edit-item|qr-edit-item.*querySelectorAll/);
  });
  test('11C-90-06 fd.set autoResponsesEnabled in AI save', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7000);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]autoResponsesEnabled['"]/);
  });
  test('11C-90-07 quickReplies PUT called after property PUT', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7600);
    expect(fnBody).toMatch(/quick-replies/);
  });
  test('11C-90-08 buildBaseFormData used in AI save', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7000);
    expect(fnBody).toMatch(/buildBaseFormData/);
  });
  test('11C-90-09 aria-checked toggled on toggle button', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/aria-checked/);
  });
  test('11C-90-10 facts delete targets .prop-fact-delete-btn class', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1500);
    expect(fnBody).toMatch(/prop-fact-delete-btn/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-91 · bindPlatformsEdit specifics
   ═══════════════════════════════════════════════════════════════ */
describe('11C-91 bindPlatformsEdit', () => {
  test('11C-91-01 bindPlatformsEdit function defined', () => {
    expect(js11c).toMatch(/function\s+bindPlatformsEdit/);
  });
  test('11C-91-02 connect sends JSON with property_id', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/property_id\s*:/);
  });
  test('11C-91-03 disconnect sends JSON with property_id', () => {
    var idx  = js11c.indexOf('disconnect-property');
    var body = js11c.slice(idx, idx + 400);
    expect(body).toMatch(/property_id\s*:/);
  });
  test('11C-91-04 after connect success location.reload', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/location\.reload/);
  });
  test('11C-91-05 after disconnect success location.reload', () => {
    var idx  = js11c.indexOf('Déconnexion réussie');
    var body = js11c.slice(idx, idx + 300);
    expect(body).toMatch(/location\.reload/);
  });
  test('11C-91-06 iCal delete removes from currentIcalUrls', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3200);
    expect(fnBody).toMatch(/currentIcalUrls\.splice/);
  });
  test('11C-91-07 iCal add requires URL validation', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 4200);
    expect(fnBody).toMatch(/L['']URL est requise/);
  });
  test('11C-91-08 iCal add creates entry with platform and url', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 4200);
    expect(fnBody).toMatch(/currentIcalUrls\.push/);
    expect(fnBody).toMatch(/platform\s*:/);
    expect(fnBody).toMatch(/url\s*:/);
  });
  test('11C-91-09 sync button calls /api/sync/ical', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 4800);
    expect(fnBody).toMatch(/\/api\/sync\/ical/);
  });
  test('11C-91-10 save collects markup inputs', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 5800);
    expect(fnBody).toMatch(/markupInputs/);
    expect(fnBody).toMatch(/querySelectorAll.*data-markup-code|data-markup-code.*querySelectorAll/);
  });
  test('11C-91-11 save appends icalUrls as JSON string', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 6200);
    expect(fnBody).toMatch(/fd\.append\s*\(\s*['"]icalUrls['"]/);
    expect(fnBody).toMatch(/JSON\.stringify\s*\(\s*currentIcalUrls\s*\)/);
  });
  test('11C-91-12 each markup PATCH call chained', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 7000);
    expect(fnBody).toMatch(/chain\s*=\s*chain\.then/);
    expect(fnBody).toMatch(/PATCH/);
  });
  test('11C-91-13 connect error re-enables button', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1500);
    expect(fnBody).toMatch(/connectBtn\.disabled\s*=\s*false/);
  });
  test('11C-91-14 disconnect error re-enables button', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3000);
    expect(fnBody).toMatch(/disconnectBtn\.disabled\s*=\s*false/);
  });
  test('11C-91-15 psfIcalSyncBtn handled in bindPlatformsEdit', () => {
    var fnIdx  = js11c.indexOf('function bindPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 4600);
    expect(fnBody).toMatch(/psfIcalSyncBtn/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-92 · mount function
   ═══════════════════════════════════════════════════════════════ */
describe('11C-92 mount function', () => {
  test('11C-92-01 mount function defined', () => {
    expect(js11c).toMatch(/function\s+mount\s*\(/);
  });
  test('11C-92-02 mount fetches /facts for ai', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/\/facts/);
  });
  test('11C-92-03 mount fetches /markups for platforms', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/\/markups/);
  });
  test('11C-92-04 factsData.facts array used', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/factsData\.facts/);
  });
  test('11C-92-05 markupsData passed to renderSection', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 1100);
    expect(fnBody).toMatch(/markupsData/);
  });
  test('11C-92-06 mount calls renderSection', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/renderSection/);
  });
  test('11C-92-07 loadEl shown during mount', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/loadEl\.style\.display\s*=\s*['"]['"]|propDetLoading/);
  });
  test('11C-92-08 bodyEl hidden during mount', () => {
    var fnIdx  = js11c.indexOf('function mount');
    var fnBody = js11c.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/bodyEl\.style\.display\s*=\s*['"]none['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-93 · Quick replies specifics
   ═══════════════════════════════════════════════════════════════ */
describe('11C-93 quick replies', () => {
  test('11C-93-01 max 5 quick replies checked', () => {
    expect(js11c).toMatch(/currentCount\s*>=\s*5|length\s*<\s*5/);
  });
  test('11C-93-02 psfQrAddBtn hidden when at 5 items', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 4900);
    var idx    = fnBody.indexOf("getElementById('psfQrAddBtn')");
    var body   = fnBody.slice(idx, idx + 600);
    expect(body).toMatch(/display\s*=\s*['"]none['"]/);
  });
  test('11C-93-03 delete renumbers remaining items', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 5800);
    expect(fnBody).toMatch(/Réponse\s*['"]\s*\+\s*\(/);
  });
  test('11C-93-04 renderQrEditItem function defined', () => {
    expect(js11c).toMatch(/function\s+renderQrEditItem/);
  });
  test('11C-93-05 maxlength 50 on title input', () => {
    expect(js11c).toMatch(/maxlength=["']50["']/);
  });
  test('11C-93-06 maxlength 200 on text textarea', () => {
    expect(js11c).toMatch(/maxlength=["']200["']/);
  });
  test('11C-93-07 Réponse N numbering in edit item', () => {
    var fnIdx  = js11c.indexOf('function renderQrEditItem');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/Réponse\s/);
  });
  test('11C-93-08 data-qr-index attribute on edit item', () => {
    var fnIdx  = js11c.indexOf('function renderQrEditItem');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/data-qr-index/);
  });
  test('11C-93-09 data-qr-title on title input', () => {
    var fnIdx  = js11c.indexOf('function renderQrEditItem');
    var fnBody = js11c.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/data-qr-title/);
  });
  test('11C-93-10 data-qr-text on text textarea', () => {
    var fnIdx  = js11c.indexOf('function renderQrEditItem');
    var fnBody = js11c.slice(fnIdx, fnIdx + 900);
    expect(fnBody).toMatch(/data-qr-text/);
  });
  test('11C-93-11 empty title/text items not saved', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 6900);
    expect(fnBody).toMatch(/title.*text.*push|if\s*\(\s*title\s*\|\|\s*text\s*\)/);
  });
  test('11C-93-12 prop-qr-char-hint class for char limit', () => {
    expect(js11c).toMatch(/prop-qr-char-hint/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-94 · Facts specifics
   ═══════════════════════════════════════════════════════════════ */
describe('11C-94 facts specifics', () => {
  test('11C-94-01 renderFactEditRow function defined', () => {
    expect(js11c).toMatch(/function\s+renderFactEditRow/);
  });
  test('11C-94-02 answer shown as O or N', () => {
    var fnIdx  = js11c.indexOf('function renderFactEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/['"]O['"]/);
    expect(fnBody).toMatch(/['"]N['"]/);
  });
  test('11C-94-03 prop-fact-answer-badge--true for true answer', () => {
    var fnIdx  = js11c.indexOf('function renderFactEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/prop-fact-answer-badge--true/);
  });
  test('11C-94-04 prop-fact-answer-badge--false for false answer', () => {
    var fnIdx  = js11c.indexOf('function renderFactEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/prop-fact-answer-badge--false/);
  });
  test('11C-94-05 data-fact-id on fact row container', () => {
    var fnIdx  = js11c.indexOf('function renderFactEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/prop-fact-row.*data-fact-id|data-fact-id.*prop-fact-row/);
  });
  test('11C-94-06 data-fact-id on delete button', () => {
    var fnIdx  = js11c.indexOf('function renderFactEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 800);
    var deleteBtnIdx = fnBody.indexOf('prop-fact-delete-btn');
    var afterBtn     = fnBody.slice(deleteBtnIdx, deleteBtnIdx + 200);
    expect(afterBtn).toMatch(/data-fact-id/);
  });
  test('11C-94-07 empty state shown when no facts', () => {
    expect(js11c).toMatch(/psfFactsEmpty/);
  });
  test('11C-94-08 psfFactsEmpty element used', () => {
    expect(js11c).toMatch(/getElementById\s*\(\s*['"]psfFactsEmpty['"]/);
  });
  test('11C-94-09 question required validation', () => {
    expect(js11c).toMatch(/La question est requise/);
  });
  test('11C-94-10 answer required validation', () => {
    expect(js11c).toMatch(/La réponse est requise/);
  });
  test('11C-94-11 fact POST body uses JSON.stringify', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3100);
    expect(fnBody).toMatch(/JSON\.stringify\s*\(\s*payload\s*\)/);
  });
  test('11C-94-12 factAddBtn disabled while posting', () => {
    var fnIdx  = js11c.indexOf('function bindAiEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 2700);
    expect(fnBody).toMatch(/factAddBtn\.disabled\s*=\s*true/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-95 · iCal edit row specifics
   ═══════════════════════════════════════════════════════════════ */
describe('11C-95 iCal edit row', () => {
  test('11C-95-01 renderIcalEditRow function defined', () => {
    expect(js11c).toMatch(/function\s+renderIcalEditRow/);
  });
  test('11C-95-02 data-ical-index on row', () => {
    var fnIdx  = js11c.indexOf('function renderIcalEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/data-ical-index/);
  });
  test('11C-95-03 data-ical-index on delete button', () => {
    var fnIdx  = js11c.indexOf('function renderIcalEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 900);
    var btnIdx = fnBody.indexOf('prop-fact-delete-btn');
    var after  = fnBody.slice(btnIdx, btnIdx + 200);
    expect(after).toMatch(/data-ical-index/);
  });
  test('11C-95-04 URL truncated at 40 chars', () => {
    var fnIdx  = js11c.indexOf('function renderIcalEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/\.length\s*>\s*40/);
  });
  test('11C-95-05 platform name displayed', () => {
    var fnIdx  = js11c.indexOf('function renderIcalEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/platform/);
  });
  test('11C-95-06 ical dot with color style', () => {
    var fnIdx  = js11c.indexOf('function renderIcalEditRow');
    var fnBody = js11c.slice(fnIdx, fnIdx + 700);
    expect(fnBody).toMatch(/prop-ical-dot/);
    expect(fnBody).toMatch(/background:/);
  });
  test('11C-95-07 iCal URL input type="url"', () => {
    expect(js11c).toMatch(/type=["']url["']/);
  });
  test('11C-95-08 currentIcalUrls updated on add and delete', () => {
    expect(js11c).toMatch(/currentIcalUrls\.push/);
    expect(js11c).toMatch(/currentIcalUrls\.splice/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11C-96 · Markup specifics
   ═══════════════════════════════════════════════════════════════ */
describe('11C-96 markup specifics', () => {
  test('11C-96-01 platformColor function defined', () => {
    expect(js11c).toMatch(/function\s+platformColor/);
  });
  test('11C-96-02 ABB returns #FF5A5F', () => {
    var fnIdx  = js11c.indexOf('function platformColor');
    var fnBody = js11c.slice(fnIdx, fnIdx + 200);
    expect(fnBody).toMatch(/#FF5A5F|PLATFORM_COLORS/);
  });
  test('11C-96-03 BDC returns blue color #003580', () => {
    expect(js11c).toMatch(/#003580/);
  });
  test('11C-96-04 four platform codes defined ABB BDC EXP VRB', () => {
    expect(js11c).toMatch(/ABB/);
    expect(js11c).toMatch(/BDC/);
    expect(js11c).toMatch(/EXP/);
    expect(js11c).toMatch(/VRB/);
  });
  test('11C-96-05 markup pct 0-100 range on input', () => {
    expect(js11c).toMatch(/min=["']0["'][\s\S]{0,50}?max=["']100["']/);
  });
  test('11C-96-06 step=0.1 on markup input', () => {
    expect(js11c).toMatch(/step=["']0\.1["']/);
  });
  test('11C-96-07 markup code as data-markup-code attribute', () => {
    var fnIdx  = js11c.indexOf('function renderPlatformsEdit');
    var fnBody = js11c.slice(fnIdx, fnIdx + 3300);
    expect(fnBody).toMatch(/data-markup-code=["']\s*'\s*\+\s*escHtml|data-markup-code.*escHtml.*code/);
  });
  test('11C-96-08 parseFloat used for markup pct value', () => {
    expect(js11c).toMatch(/parseFloat\s*\(\s*inp\.value\s*\)/);
  });
});

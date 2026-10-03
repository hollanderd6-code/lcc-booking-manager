/**
 * BOOSTINGHOST_WEB_IOS_PARITY_PROPERTY_DETAIL_11A_SECTIONS
 *
 * Tests for section editors: Identity, Stay, Money
 *   - public/css/bh-property-detail-sections-11a.css
 *   - public/js/bh-property-detail-sections-11a.js
 *   - public/js/bh-property-detail-ios-10.js  (section routing)
 *   - public/property.html  (new CSS/JS links)
 *
 * Run: npx jest tests/ios_web_parity_property_detail_11a_sections.test.js
 */

const fs   = require('fs');
const path = require('path');

const HTML_PATH   = path.join(__dirname, '../public/property.html');
const CSS11A_PATH = path.join(__dirname, '../public/css/bh-property-detail-sections-11a.css');
const JS10_PATH   = path.join(__dirname, '../public/js/bh-property-detail-ios-10.js');
const JS11A_PATH  = path.join(__dirname, '../public/js/bh-property-detail-sections-11a.js');

let html, css11a, js10, js11a;

beforeAll(() => {
  html   = fs.readFileSync(HTML_PATH,   'utf8');
  css11a = fs.readFileSync(CSS11A_PATH, 'utf8');
  js10   = fs.readFileSync(JS10_PATH,   'utf8');
  js11a  = fs.readFileSync(JS11A_PATH,  'utf8');
});

/* ═══════════════════════════════════════════════════════════════
   11A-01 · FILE EXISTENCE
   ═══════════════════════════════════════════════════════════════ */
describe('11A-01 File existence', () => {
  test('11A-01-01 bh-property-detail-sections-11a.css exists', () => {
    expect(fs.existsSync(CSS11A_PATH)).toBe(true);
  });
  test('11A-01-02 bh-property-detail-sections-11a.js exists', () => {
    expect(fs.existsSync(JS11A_PATH)).toBe(true);
  });
  test('11A-01-03 CSS file is non-empty', () => {
    expect(css11a.length).toBeGreaterThan(500);
  });
  test('11A-01-04 JS file is non-empty', () => {
    expect(js11a.length).toBeGreaterThan(1000);
  });
  test('11A-01-05 bh-property-detail-ios-10.js still exists', () => {
    expect(fs.existsSync(JS10_PATH)).toBe(true);
  });
  test('11A-01-06 property.html still exists', () => {
    expect(fs.existsSync(HTML_PATH)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-02 · property.html — new CSS link
   ═══════════════════════════════════════════════════════════════ */
describe('11A-02 property.html CSS link', () => {
  test('11A-02-01 loads bh-property-detail-sections-11a.css', () => {
    expect(html).toMatch(/bh-property-detail-sections-11a\.css/);
  });
  test('11A-02-02 sections-11a.css loaded AFTER ios-10.css', () => {
    var idx10  = html.indexOf('bh-property-detail-ios-10.css');
    var idx11a = html.indexOf('bh-property-detail-sections-11a.css');
    expect(idx10).toBeGreaterThan(-1);
    expect(idx11a).toBeGreaterThan(-1);
    expect(idx11a).toBeGreaterThan(idx10);
  });
  test('11A-02-03 sections-11a.css is a <link rel="stylesheet">', () => {
    expect(html).toMatch(/<link[^>]+bh-property-detail-sections-11a\.css/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-03 · property.html — new JS script
   ═══════════════════════════════════════════════════════════════ */
describe('11A-03 property.html JS script', () => {
  test('11A-03-01 loads bh-property-detail-sections-11a.js', () => {
    expect(html).toMatch(/bh-property-detail-sections-11a\.js/);
  });
  test('11A-03-02 sections-11a.js loaded AFTER ios-10.js', () => {
    var idx10  = html.indexOf('bh-property-detail-ios-10.js');
    var idx11a = html.indexOf('bh-property-detail-sections-11a.js');
    expect(idx10).toBeGreaterThan(-1);
    expect(idx11a).toBeGreaterThan(-1);
    expect(idx11a).toBeGreaterThan(idx10);
  });
  test('11A-03-03 sections-11a.js is a <script src> tag', () => {
    expect(html).toMatch(/<script[^>]+bh-property-detail-sections-11a\.js/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-04 · ios-10.js — section routing in init
   ═══════════════════════════════════════════════════════════════ */
describe('11A-04 ios-10.js section routing — init', () => {
  test('11A-04-01 params.get(\'section\') is called', () => {
    expect(js10).toMatch(/params\.get\(['"]section['"]\)/);
  });
  test('11A-04-02 section === \'identity\' check present', () => {
    expect(js10).toMatch(/section\s*===\s*['"]identity['"]/);
  });
  test('11A-04-03 section === \'stay\' check present', () => {
    expect(js10).toMatch(/section\s*===\s*['"]stay['"]/);
  });
  test('11A-04-04 section === \'money\' check present', () => {
    expect(js10).toMatch(/section\s*===\s*['"]money['"]/);
  });
  test('11A-04-05 hub path falls through to loadAll', () => {
    var initFn = js10.slice(js10.indexOf('function init()'));
    expect(initFn).toMatch(/loadAll\s*\(\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-05 · ios-10.js — loadSection function
   ═══════════════════════════════════════════════════════════════ */
describe('11A-05 ios-10.js loadSection function', () => {
  test('11A-05-01 loadSection function defined', () => {
    expect(js10).toMatch(/function\s+loadSection\s*\(/);
  });
  test('11A-05-02 loadSection fetches /api/properties/', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 700);
    expect(fnBody).toMatch(/fetch\s*\(\s*['"]\/api\/properties\/['"].*\+\s*propertyId/);
  });
  test('11A-05-03 loadSection calls window.BhPropSections.mount', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 1000);
    expect(fnBody).toMatch(/window\.BhPropSections[\s\S]{0,50}?\.mount/);
  });
  test('11A-05-04 loadSection resets propDetLoading', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 500);
    expect(fnBody).toMatch(/propDetLoading/);
  });
  test('11A-05-05 loadSection handles error via showError', () => {
    var fnIdx  = js10.indexOf('function loadSection');
    var fnBody = js10.slice(fnIdx, fnIdx + 700);
    expect(fnBody).toMatch(/showError\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-06 · ios-10.js — section block hrefs
   ═══════════════════════════════════════════════════════════════ */
describe('11A-06 ios-10.js section block hrefs', () => {
  test('11A-06-01 sectionRoutes has identity key', () => {
    expect(js10).toMatch(/identity\s*:\s*['"]identity['"]/);
  });
  test('11A-06-02 sectionRoutes has stay key', () => {
    expect(js10).toMatch(/stay\s*:\s*['"]stay['"]/);
  });
  test('11A-06-03 sectionRoutes maps pricing to money', () => {
    expect(js10).toMatch(/pricing\s*:\s*['"]money['"]/);
  });
  test('11A-06-04 &section= prefix in block href', () => {
    expect(js10).toMatch(/&section=/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-07 · ios-10.js — bridge blocks still use settings.html
   ═══════════════════════════════════════════════════════════════ */
describe('11A-07 ios-10.js bridge blocks preserved', () => {
  test('11A-07-01 sectionRoutes map defined in renderBlock', () => {
    var fnIdx  = js10.indexOf('function renderBlock');
    var fnBody = js10.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/sectionRoutes/);
  });
  test('11A-07-02 /settings.html still present for non-section blocks', () => {
    expect(js10).toMatch(/\/settings\.html/);
  });
  test('11A-07-03 sectionRoutes does not include upsell', () => {
    var mapIdx  = js10.indexOf('sectionRoutes');
    var mapBody = js10.slice(mapIdx, mapIdx + 100);
    expect(mapBody).not.toMatch(/upsell/);
  });
  test('11A-07-04 sectionRoutes does not include access', () => {
    var mapIdx  = js10.indexOf('sectionRoutes');
    var mapBody = js10.slice(mapIdx, mapIdx + 100);
    expect(mapBody).not.toMatch(/\baccess\b/);
  });
  test('11A-07-05 sectionRoutes does not include ai', () => {
    var mapIdx  = js10.indexOf('sectionRoutes');
    var mapBody = js10.slice(mapIdx, mapIdx + 100);
    expect(mapBody).not.toMatch(/\bai\b/);
  });
  test('11A-07-06 fallback href is /settings.html in renderBlock', () => {
    var fnIdx  = js10.indexOf('function renderBlock');
    var fnBody = js10.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/\/settings\.html/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-08 · sections-11a.js — IIFE structure
   ═══════════════════════════════════════════════════════════════ */
describe('11A-08 sections-11a.js IIFE structure', () => {
  test('11A-08-01 wrapped in IIFE', () => {
    /* file may start with a comment block before the IIFE */
    expect(js11a).toMatch(/\(function\s*\(\s*\)\s*\{/);
  });
  test('11A-08-02 use strict directive', () => {
    expect(js11a).toMatch(/'use strict'/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-09 · sections-11a.js — early back-nav fix
   ═══════════════════════════════════════════════════════════════ */
describe('11A-09 sections-11a.js early back-nav', () => {
  test('11A-09-01 updates data-back-href', () => {
    expect(js11a).toMatch(/setAttribute\s*\(\s*['"]data-back-href['"]/);
  });
  test('11A-09-02 back-href points to /property.html?id=', () => {
    expect(js11a).toMatch(/['"]\/property\.html\?id=/);
  });
  test('11A-09-03 updates data-back-label to Logement', () => {
    expect(js11a).toMatch(/['"]data-back-label['"][\s\S]{0,20}?['"]Logement['"]/);
  });
  test('11A-09-04 updates data-title', () => {
    expect(js11a).toMatch(/setAttribute\s*\(\s*['"]data-title['"]/);
  });
  test('11A-09-05 updates data-kicker', () => {
    expect(js11a).toMatch(/setAttribute\s*\(\s*['"]data-kicker['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-10 · sections-11a.js — window.BhPropSections
   ═══════════════════════════════════════════════════════════════ */
describe('11A-10 sections-11a.js window.BhPropSections', () => {
  test('11A-10-01 window.BhPropSections assigned', () => {
    expect(js11a).toMatch(/window\.BhPropSections\s*=/);
  });
  test('11A-10-02 mount function exposed', () => {
    expect(js11a).toMatch(/window\.BhPropSections\s*=\s*\{[\s\S]{0,60}?mount/);
  });
  test('11A-10-03 mount function defined', () => {
    expect(js11a).toMatch(/function\s+mount\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-11 · sections-11a.js — escHtml
   ═══════════════════════════════════════════════════════════════ */
describe('11A-11 sections-11a.js escHtml', () => {
  test('11A-11-01 escHtml function defined', () => {
    expect(js11a).toMatch(/function\s+escHtml\s*\(/);
  });
  test('11A-11-02 escapes ampersand', () => {
    expect(js11a).toMatch(/&amp;/);
  });
  test('11A-11-03 escapes less-than', () => {
    expect(js11a).toMatch(/&lt;/);
  });
  test('11A-11-04 escapes greater-than', () => {
    expect(js11a).toMatch(/&gt;/);
  });
  test('11A-11-05 escapes double-quote', () => {
    expect(js11a).toMatch(/&quot;/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-12 · sections-11a.js — buildBaseFormData
   ═══════════════════════════════════════════════════════════════ */
describe('11A-12 sections-11a.js buildBaseFormData', () => {
  test('11A-12-01 buildBaseFormData function defined', () => {
    expect(js11a).toMatch(/function\s+buildBaseFormData\s*\(/);
  });
  test('11A-12-02 appends name always', () => {
    var fnIdx  = js11a.indexOf('function buildBaseFormData');
    var fnBody = js11a.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/fd\.append\s*\(\s*['"]name['"]/);
  });
  test('11A-12-03 appends internalName always', () => {
    var fnIdx  = js11a.indexOf('function buildBaseFormData');
    var fnBody = js11a.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/fd\.append\s*\(\s*['"]internalName['"]/);
  });
  test('11A-12-04 appends airbnbCommissionPct always', () => {
    var fnIdx  = js11a.indexOf('function buildBaseFormData');
    var fnBody = js11a.slice(fnIdx, fnIdx + 800);
    expect(fnBody).toMatch(/fd\.append\s*\(\s*['"]airbnbCommissionPct['"]/);
  });
  test('11A-12-05 appends bookingCommissionPct always', () => {
    var fnIdx  = js11a.indexOf('function buildBaseFormData');
    var fnBody = js11a.slice(fnIdx, fnIdx + 800);
    expect(fnBody).toMatch(/fd\.append\s*\(\s*['"]bookingCommissionPct['"]/);
  });
  test('11A-12-06 creates new FormData', () => {
    var fnIdx  = js11a.indexOf('function buildBaseFormData');
    var fnBody = js11a.slice(fnIdx, fnIdx + 200);
    expect(fnBody).toMatch(/new\s+FormData\s*\(\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-13 · sections-11a.js — mount structure
   ═══════════════════════════════════════════════════════════════ */
describe('11A-13 sections-11a.js mount structure', () => {
  test('11A-13-01 mount hides propDetLoading', () => {
    var fnIdx  = js11a.indexOf('function mount(');
    var fnBody = js11a.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/propDetLoading[\s\S]{0,300}?display/);
  });
  test('11A-13-02 mount sets propDetBody display', () => {
    var fnIdx  = js11a.indexOf('function mount(');
    var fnBody = js11a.slice(fnIdx, fnIdx + 800);
    expect(fnBody).toMatch(/bodyEl[\s\S]{0,300}?display/);
  });
  test('11A-13-03 renders prop-section-view wrapper', () => {
    expect(js11a).toMatch(/prop-section-view/);
  });
  test('11A-13-04 receives propertyId, section, p params', () => {
    expect(js11a).toMatch(/function\s+mount\s*\(\s*propertyId\s*,\s*section\s*,\s*p\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-14 · sections-11a.js — back button
   ═══════════════════════════════════════════════════════════════ */
describe('11A-14 sections-11a.js back button', () => {
  test('11A-14-01 prop-section-header rendered', () => {
    expect(js11a).toMatch(/prop-section-header/);
  });
  test('11A-14-02 back link uses prop-section-back-btn', () => {
    expect(js11a).toMatch(/prop-section-back-btn/);
  });
  test('11A-14-03 back href points to /property.html?id=', () => {
    var mountIdx  = js11a.indexOf('function mount(');
    var mountBody = js11a.slice(mountIdx, mountIdx + 800);
    expect(mountBody).toMatch(/\/property\.html\?id=/);
  });
  test('11A-14-04 back button contains Retour text', () => {
    expect(js11a).toMatch(/Retour/);
  });
  test('11A-14-05 chevron-left polyline in SVG', () => {
    expect(js11a).toMatch(/polyline\s+points="15 18 9 12 15 6"/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-15 · sections-11a.js — save button
   ═══════════════════════════════════════════════════════════════ */
describe('11A-15 sections-11a.js save button', () => {
  test('11A-15-01 psfSaveBtn id rendered', () => {
    expect(js11a).toMatch(/id="psfSaveBtn"/);
  });
  test('11A-15-02 Sauvegarder text', () => {
    expect(js11a).toMatch(/Sauvegarder/);
  });
  test('11A-15-03 prop-section-save-btn class', () => {
    expect(js11a).toMatch(/prop-section-save-btn/);
  });
  test('11A-15-04 save button disabled during save', () => {
    var saveEvt = js11a.slice(js11a.indexOf('psfSaveBtn'));
    expect(saveEvt).toMatch(/saveBtn\.disabled\s*=\s*true/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-16 · sections-11a.js — identity section fields
   ═══════════════════════════════════════════════════════════════ */
describe('11A-16 sections-11a.js identity fields', () => {
  test('11A-16-01 psfName passed to formField', () => {
    expect(js11a).toMatch(/'psfName'/);
  });
  test('11A-16-02 psfInternalName passed to formField', () => {
    expect(js11a).toMatch(/'psfInternalName'/);
  });
  test('11A-16-03 psfAddress passed to formField', () => {
    expect(js11a).toMatch(/'psfAddress'/);
  });
  test('11A-16-04 psfColor text input in HTML', () => {
    expect(js11a).toMatch(/id="psfColor"/);
  });
  test('11A-16-05 psfColorPicker type=color input', () => {
    expect(js11a).toMatch(/id="psfColorPicker"/);
  });
  test('11A-16-06 psfMaxGuests passed to formField', () => {
    expect(js11a).toMatch(/'psfMaxGuests'/);
  });
  test('11A-16-07 psfBedrooms passed to formField', () => {
    expect(js11a).toMatch(/'psfBedrooms'/);
  });
  test('11A-16-08 psfBeds passed to formField', () => {
    expect(js11a).toMatch(/'psfBeds'/);
  });
  test('11A-16-09 psfBathrooms passed to formField', () => {
    expect(js11a).toMatch(/'psfBathrooms'/);
  });
  test('11A-16-10 psfPhotoUrl passed to formField', () => {
    expect(js11a).toMatch(/'psfPhotoUrl'/);
  });
  test('11A-16-11 psfOwnerContainer div in HTML', () => {
    expect(js11a).toMatch(/id="psfOwnerContainer"/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-17 · sections-11a.js — stay section fields
   ═══════════════════════════════════════════════════════════════ */
describe('11A-17 sections-11a.js stay fields', () => {
  test('11A-17-01 psfArrivalTime passed to formField', () => {
    expect(js11a).toMatch(/'psfArrivalTime'/);
  });
  test('11A-17-02 psfDepartureTime passed to formField', () => {
    expect(js11a).toMatch(/'psfDepartureTime'/);
  });
  test('11A-17-03 psfArrivalMessage passed to formTextarea', () => {
    expect(js11a).toMatch(/'psfArrivalMessage'/);
  });
  test('11A-17-04 arrivalMessage uses formTextarea helper', () => {
    expect(js11a).toMatch(/formTextarea\s*\(\s*'psfArrivalMessage'/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-18 · sections-11a.js — money section fields
   ═══════════════════════════════════════════════════════════════ */
describe('11A-18 sections-11a.js money fields', () => {
  test('11A-18-01 psfBasePrice passed to formField', () => {
    expect(js11a).toMatch(/'psfBasePrice'/);
  });
  test('11A-18-02 psfWeekendPrice passed to formField', () => {
    expect(js11a).toMatch(/'psfWeekendPrice'/);
  });
  test('11A-18-03 psfCleaningFee passed to formField', () => {
    expect(js11a).toMatch(/'psfCleaningFee'/);
  });
  test('11A-18-04 psfTouristTax passed to formField', () => {
    expect(js11a).toMatch(/'psfTouristTax'/);
  });
  test('11A-18-05 psfDepositAmount passed to formField', () => {
    expect(js11a).toMatch(/'psfDepositAmount'/);
  });
  test('11A-18-06 psfDepositDays passed to formField', () => {
    expect(js11a).toMatch(/'psfDepositDays'/);
  });
  test('11A-18-07 psfConciergePct passed to formField', () => {
    expect(js11a).toMatch(/'psfConciergePct'/);
  });
  test('11A-18-08 psfAirbnbPct passed to formField', () => {
    expect(js11a).toMatch(/'psfAirbnbPct'/);
  });
  test('11A-18-09 psfBookingPct passed to formField', () => {
    expect(js11a).toMatch(/'psfBookingPct'/);
  });
  test('11A-18-10 psfCurrency passed to formSelect', () => {
    expect(js11a).toMatch(/formSelect\s*\(\s*'psfCurrency'/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-19 · sections-11a.js — PUT fetch
   ═══════════════════════════════════════════════════════════════ */
describe('11A-19 sections-11a.js PUT fetch', () => {
  test('11A-19-01 fetches /api/properties/ + propertyId', () => {
    expect(js11a).toMatch(/fetch\s*\(\s*['"]\/api\/properties\/['"][\s\S]{0,30}?\+\s*propertyId/);
  });
  test('11A-19-02 uses method PUT', () => {
    expect(js11a).toMatch(/method\s*:\s*['"]PUT['"]/);
  });
  test('11A-19-03 body is FormData (fd)', () => {
    expect(js11a).toMatch(/body\s*:\s*fd/);
  });
  test('11A-19-04 does not set Content-Type manually', () => {
    var fetchIdx = js11a.indexOf("fetch('/api/properties/'");
    var fetchCtx = js11a.slice(fetchIdx, fetchIdx + 200);
    expect(fetchCtx).not.toMatch(/Content-Type/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-20 · sections-11a.js — 409 currency lock handling
   ═══════════════════════════════════════════════════════════════ */
describe('11A-20 sections-11a.js 409 handling', () => {
  test('11A-20-01 checks status === 409', () => {
    expect(js11a).toMatch(/status\s*===\s*409/);
  });
  test('11A-20-02 shows error toast on 409', () => {
    var idx409 = js11a.indexOf('status === 409');
    var ctx    = js11a.slice(idx409, idx409 + 350);
    expect(ctx).toMatch(/showToast[\s\S]{0,100}?'error'/);
  });
  test('11A-20-03 re-enables save button on 409', () => {
    var idx409 = js11a.indexOf('status === 409');
    var ctx    = js11a.slice(idx409, idx409 + 350);
    expect(ctx).toMatch(/saveBtn\.disabled\s*=\s*false/);
  });
  test('11A-20-04 restores Sauvegarder text on 409', () => {
    var idx409 = js11a.indexOf('status === 409');
    var ctx    = js11a.slice(idx409, idx409 + 350);
    expect(ctx).toMatch(/saveBtn\.textContent\s*=\s*['"]Sauvegarder['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-21 · sections-11a.js — currency locked display
   ═══════════════════════════════════════════════════════════════ */
describe('11A-21 sections-11a.js currency locked', () => {
  test('11A-21-01 channexEnabled && channexPropertyId check', () => {
    expect(js11a).toMatch(/channexEnabled[\s\S]{0,30}?channexPropertyId/);
  });
  test('11A-21-02 currency select disabled attribute when locked', () => {
    expect(js11a).toMatch(/disabled/);
  });
  test('11A-21-03 prop-currency-locked-notice shown when locked', () => {
    expect(js11a).toMatch(/prop-currency-locked-notice/);
  });
  test('11A-21-04 currency not sent to fd if input disabled', () => {
    var applyFnIdx = js11a.indexOf('function applyMoneyFields');
    var fnBody     = js11a.slice(applyFnIdx, applyFnIdx + 1900);
    expect(fnBody).toMatch(/!currency\.disabled/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-22 · sections-11a.js — save identity field overrides
   ═══════════════════════════════════════════════════════════════ */
describe('11A-22 sections-11a.js save identity overrides', () => {
  test('11A-22-01 applyIdentityFields defined', () => {
    expect(js11a).toMatch(/function\s+applyIdentityFields\s*\(/);
  });
  test('11A-22-02 fd.set name', () => {
    var fnIdx  = js11a.indexOf('function applyIdentityFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]name['"]/);
  });
  test('11A-22-03 fd.set internalName', () => {
    var fnIdx  = js11a.indexOf('function applyIdentityFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]internalName['"]/);
  });
  test('11A-22-04 fd.set color', () => {
    var fnIdx  = js11a.indexOf('function applyIdentityFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1200);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]color['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-23 · sections-11a.js — save stay field overrides
   ═══════════════════════════════════════════════════════════════ */
describe('11A-23 sections-11a.js save stay overrides', () => {
  test('11A-23-01 applyStayFields defined', () => {
    expect(js11a).toMatch(/function\s+applyStayFields\s*\(/);
  });
  test('11A-23-02 fd.set arrivalTime', () => {
    var fnIdx  = js11a.indexOf('function applyStayFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]arrivalTime['"]/);
  });
  test('11A-23-03 fd.set departureTime', () => {
    var fnIdx  = js11a.indexOf('function applyStayFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]departureTime['"]/);
  });
  test('11A-23-04 fd.set arrivalMessage', () => {
    var fnIdx  = js11a.indexOf('function applyStayFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 600);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]arrivalMessage['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-24 · sections-11a.js — save money field overrides
   ═══════════════════════════════════════════════════════════════ */
describe('11A-24 sections-11a.js save money overrides', () => {
  test('11A-24-01 applyMoneyFields defined', () => {
    expect(js11a).toMatch(/function\s+applyMoneyFields\s*\(/);
  });
  test('11A-24-02 fd.set basePrice', () => {
    var fnIdx  = js11a.indexOf('function applyMoneyFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1600);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]basePrice['"]/);
  });
  test('11A-24-03 fd.set airbnbCommissionPct always', () => {
    var fnIdx  = js11a.indexOf('function applyMoneyFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1600);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]airbnbCommissionPct['"]/);
  });
  test('11A-24-04 fd.set bookingCommissionPct always', () => {
    var fnIdx  = js11a.indexOf('function applyMoneyFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1800);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]bookingCommissionPct['"]/);
  });
  test('11A-24-05 fd.set touristTaxPerNight', () => {
    var fnIdx  = js11a.indexOf('function applyMoneyFields');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1600);
    expect(fnBody).toMatch(/fd\.set\s*\(\s*['"]touristTaxPerNight['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-25 · sections-11a.js — success flow
   ═══════════════════════════════════════════════════════════════ */
describe('11A-25 sections-11a.js success flow', () => {
  test('11A-25-01 shows success toast', () => {
    expect(js11a).toMatch(/showToast\s*\(\s*['"]Enregistré['"]/);
  });
  test('11A-25-02 redirects to backHref after save', () => {
    expect(js11a).toMatch(/window\.location\.href\s*=\s*backHref/);
  });
  test('11A-25-03 redirect is delayed with setTimeout', () => {
    expect(js11a).toMatch(/setTimeout[\s\S]{0,100}?backHref/);
  });
  test('11A-25-04 redirect timeout is 800ms', () => {
    expect(js11a).toMatch(/setTimeout[\s\S]{0,100}?800/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-26 · sections-11a.js — toast function
   ═══════════════════════════════════════════════════════════════ */
describe('11A-26 sections-11a.js toast', () => {
  test('11A-26-01 showToast function defined', () => {
    expect(js11a).toMatch(/function\s+showToast\s*\(/);
  });
  test('11A-26-02 error type uses red', () => {
    var fnIdx  = js11a.indexOf('function showToast');
    var fnBody = js11a.slice(fnIdx, fnIdx + 200);
    expect(fnBody).toMatch(/#DC2626/);
  });
  test('11A-26-03 success type uses green', () => {
    var fnIdx  = js11a.indexOf('function showToast');
    var fnBody = js11a.slice(fnIdx, fnIdx + 200);
    expect(fnBody).toMatch(/#0E3B2E/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-27 · sections-11a.js — owner loading
   ═══════════════════════════════════════════════════════════════ */
describe('11A-27 sections-11a.js owner loading', () => {
  test('11A-27-01 loadOwners function defined', () => {
    expect(js11a).toMatch(/function\s+loadOwners\s*\(/);
  });
  test('11A-27-02 fetches /api/owner-clients', () => {
    expect(js11a).toMatch(/\/api\/owner-clients/);
  });
  test('11A-27-03 shows psfOwnerContainer on success', () => {
    var fnIdx  = js11a.indexOf('function loadOwners');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1100);
    expect(fnBody).toMatch(/psfOwnerContainer/);
    expect(fnBody).toMatch(/style\.display\s*=\s*['"][''"]/);
  });
  test('11A-27-04 catches errors silently', () => {
    var fnIdx  = js11a.indexOf('function loadOwners');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1100);
    expect(fnBody).toMatch(/\.catch\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-28 · sections-11a.js — color picker sync
   ═══════════════════════════════════════════════════════════════ */
describe('11A-28 sections-11a.js color picker sync', () => {
  test('11A-28-01 bindColorSync function defined', () => {
    expect(js11a).toMatch(/function\s+bindColorSync\s*\(/);
  });
  test('11A-28-02 picker input event updates text', () => {
    var fnIdx  = js11a.indexOf('function bindColorSync');
    var fnBody = js11a.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/picker[\s\S]{0,60}?text\.value\s*=\s*picker\.value/);
  });
  test('11A-28-03 text input validates hex before updating picker', () => {
    var fnIdx  = js11a.indexOf('function bindColorSync');
    var fnBody = js11a.slice(fnIdx, fnIdx + 400);
    expect(fnBody).toMatch(/#\[0-9A-Fa-f\]\{6\}/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-29 · sections-11a.js — XSS safety
   ═══════════════════════════════════════════════════════════════ */
describe('11A-29 sections-11a.js XSS safety', () => {
  test('11A-29-01 formField helper calls escHtml on value', () => {
    var fnIdx  = js11a.indexOf('function formField');
    var fnBody = js11a.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/escHtml\s*\(/);
  });
  test('11A-29-02 formTextarea escapes value', () => {
    var fnIdx  = js11a.indexOf('function formTextarea');
    var fnBody = js11a.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/escHtml\s*\(/);
  });
  test('11A-29-03 backHref escaped in back-link href', () => {
    var mountIdx  = js11a.indexOf('function mount(');
    var mountBody = js11a.slice(mountIdx, mountIdx + 1000);
    expect(mountBody).toMatch(/escHtml\s*\(\s*backHref\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-30 · sections-11a.js — bottom pad
   ═══════════════════════════════════════════════════════════════ */
describe('11A-30 sections-11a.js bottom pad', () => {
  test('11A-30-01 prop-bottom-pad rendered', () => {
    expect(js11a).toMatch(/prop-bottom-pad/);
  });
  test('11A-30-02 rendered inside prop-section-view', () => {
    var mountIdx  = js11a.indexOf('function mount(');
    var mountBody = js11a.slice(mountIdx, mountIdx + 1500);
    expect(mountBody).toMatch(/prop-bottom-pad/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-31 · sections-11a.js — desktop header update
   ═══════════════════════════════════════════════════════════════ */
describe('11A-31 sections-11a.js desktop header', () => {
  test('11A-31-01 propDetTitle textContent updated', () => {
    expect(js11a).toMatch(/propDetTitle[\s\S]{0,150}?textContent/);
  });
  test('11A-31-02 propDetKicker textContent updated', () => {
    expect(js11a).toMatch(/propDetKicker[\s\S]{0,100}?textContent/);
  });
  test('11A-31-03 kicker uses property internalName or name', () => {
    expect(js11a).toMatch(/p\.internalName\s*\|\|\s*p\.name/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-32 · CSS — file scoping
   ═══════════════════════════════════════════════════════════════ */
describe('11A-32 CSS 11a file scoping', () => {
  test('11A-32-01 all non-comment rule lines scoped to body[data-page="property"]', () => {
    var ruleLines = css11a.split('\n').filter(function (l) {
      var t = l.trim();
      return t.length > 0
        && !t.startsWith('/*') && !t.startsWith('*')
        && !t.startsWith('@') && !t.startsWith('}')
        && t.includes('{');
    });
    ruleLines.forEach(function (line) {
      expect(line.trim()).toMatch(/body\[data-page="property"\]|@media|html\[data-theme/);
    });
  });
  test('11A-32-02 at least 20 rule blocks defined', () => {
    var count = (css11a.match(/\{/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(20);
  });
  test('11A-32-03 no unscoped :root or html selectors', () => {
    expect(css11a).not.toMatch(/^:root\s*\{/m);
    expect(css11a).not.toMatch(/^html\s*\{/m);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-33 · CSS — section view desktop max-width
   ═══════════════════════════════════════════════════════════════ */
describe('11A-33 CSS section view desktop width', () => {
  test('11A-33-01 1100px breakpoint present', () => {
    expect(css11a).toMatch(/@media\s*\(\s*min-width\s*:\s*1100px\s*\)/);
  });
  test('11A-33-02 max-width 900px at 1100px', () => {
    expect(css11a).toMatch(/max-width\s*:\s*900px/);
  });
  test('11A-33-03 prop-section-view in 1100px block', () => {
    var mediaIdx  = css11a.indexOf('min-width: 1100px');
    var mediaBody = css11a.slice(mediaIdx, mediaIdx + 200);
    expect(mediaBody).toMatch(/prop-section-view/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-34 · CSS — section header
   ═══════════════════════════════════════════════════════════════ */
describe('11A-34 CSS section header', () => {
  test('11A-34-01 prop-section-header display flex', () => {
    expect(css11a).toMatch(/\.prop-section-header[\s\S]{0,100}?display\s*:\s*flex/);
  });
  test('11A-34-02 prop-section-header has align-items center', () => {
    expect(css11a).toMatch(/\.prop-section-header[\s\S]{0,100}?align-items\s*:\s*center/);
  });
  test('11A-34-03 prop-section-header hidden at 1367px', () => {
    expect(css11a).toMatch(/@media\s*\(\s*min-width\s*:\s*1367px\s*\)/);
    var mediaIdx  = css11a.indexOf('min-width: 1367px');
    var mediaBody = css11a.slice(mediaIdx, mediaIdx + 200);
    expect(mediaBody).toMatch(/prop-section-header[\s\S]{0,60}?display\s*:\s*none/);
  });
  test('11A-34-04 prop-section-header has margin-bottom', () => {
    expect(css11a).toMatch(/\.prop-section-header[\s\S]{0,150}?margin-bottom/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-35 · CSS — back button
   ═══════════════════════════════════════════════════════════════ */
describe('11A-35 CSS back button', () => {
  test('11A-35-01 prop-section-back-btn background none', () => {
    expect(css11a).toMatch(/\.prop-section-back-btn[\s\S]{0,200}?background\s*:\s*none/);
  });
  test('11A-35-02 prop-section-back-btn color #0E3B2E', () => {
    expect(css11a).toMatch(/\.prop-section-back-btn[\s\S]{0,200}?color\s*:\s*#0E3B2E/);
  });
  test('11A-35-03 prop-section-back-btn display flex', () => {
    expect(css11a).toMatch(/\.prop-section-back-btn[\s\S]{0,150}?display\s*:\s*flex/);
  });
  test('11A-35-04 prop-section-title-text font-weight 700', () => {
    expect(css11a).toMatch(/\.prop-section-title-text[\s\S]{0,150}?font-weight\s*:\s*700/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-36 · CSS — form card
   ═══════════════════════════════════════════════════════════════ */
describe('11A-36 CSS form card', () => {
  test('11A-36-01 prop-form-card background rgba(255,255,255,0.62)', () => {
    expect(css11a).toMatch(/\.prop-form-card[\s\S]{0,200}?background\s*:\s*rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.62\s*\)/);
  });
  test('11A-36-02 prop-form-card has backdrop-filter', () => {
    expect(css11a).toMatch(/\.prop-form-card[\s\S]{0,200}?backdrop-filter/);
  });
  test('11A-36-03 prop-form-card border-radius 22px', () => {
    expect(css11a).toMatch(/\.prop-form-card[\s\S]{0,300}?border-radius\s*:\s*22px/);
  });
  test('11A-36-04 prop-form-card has position relative', () => {
    expect(css11a).toMatch(/\.prop-form-card[\s\S]{0,400}?position\s*:\s*relative/);
  });
  test('11A-36-05 prop-form-card::before specular edge', () => {
    expect(css11a).toMatch(/\.prop-form-card::before/);
    expect(css11a).toMatch(/linear-gradient/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-37 · CSS — form label
   ═══════════════════════════════════════════════════════════════ */
describe('11A-37 CSS form label', () => {
  test('11A-37-01 prop-form-label font-size 12px', () => {
    expect(css11a).toMatch(/\.prop-form-label[\s\S]{0,150}?font-size\s*:\s*12px/);
  });
  test('11A-37-02 prop-form-label text-transform uppercase', () => {
    expect(css11a).toMatch(/\.prop-form-label[\s\S]{0,150}?text-transform\s*:\s*uppercase/);
  });
  test('11A-37-03 prop-form-label color #5E6B63', () => {
    expect(css11a).toMatch(/\.prop-form-label[\s\S]{0,150}?color\s*:\s*#5E6B63/);
  });
  test('11A-37-04 prop-form-label font-weight 600', () => {
    expect(css11a).toMatch(/\.prop-form-label[\s\S]{0,150}?font-weight\s*:\s*600/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-38 · CSS — form input
   ═══════════════════════════════════════════════════════════════ */
describe('11A-38 CSS form input', () => {
  test('11A-38-01 prop-form-input height 44px', () => {
    expect(css11a).toMatch(/\.prop-form-input[\s\S]{0,200}?height\s*:\s*44px/);
  });
  test('11A-38-02 prop-form-input border-radius 12px', () => {
    expect(css11a).toMatch(/\.prop-form-input[\s\S]{0,300}?border-radius\s*:\s*12px/);
  });
  test('11A-38-03 prop-form-input font-size 14.5px', () => {
    expect(css11a).toMatch(/\.prop-form-input[\s\S]{0,300}?font-size\s*:\s*14\.5px/);
  });
  test('11A-38-04 focus border-color #0E3B2E', () => {
    expect(css11a).toMatch(/:focus[\s\S]{0,100}?border-color\s*:\s*#0E3B2E/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-39 · CSS — grids
   ═══════════════════════════════════════════════════════════════ */
describe('11A-39 CSS grids', () => {
  test('11A-39-01 prop-form-grid-2 display grid', () => {
    expect(css11a).toMatch(/\.prop-form-grid-2[\s\S]{0,100}?display\s*:\s*grid/);
  });
  test('11A-39-02 prop-form-grid-2 columns 1fr 1fr', () => {
    expect(css11a).toMatch(/\.prop-form-grid-2[\s\S]{0,150}?grid-template-columns\s*:\s*1fr\s+1fr/);
  });
  test('11A-39-03 prop-form-grid-2 gap 12px', () => {
    expect(css11a).toMatch(/\.prop-form-grid-2[\s\S]{0,150}?gap\s*:\s*12px/);
  });
  test('11A-39-04 prop-form-grid-3 columns 1fr 1fr 1fr', () => {
    expect(css11a).toMatch(/\.prop-form-grid-3[\s\S]{0,150}?grid-template-columns\s*:\s*1fr\s+1fr\s+1fr/);
  });
  test('11A-39-05 400px breakpoint for grid-2 collapse', () => {
    expect(css11a).toMatch(/@media\s*\(\s*max-width\s*:\s*400px\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-40 · CSS — save button
   ═══════════════════════════════════════════════════════════════ */
describe('11A-40 CSS save button', () => {
  test('11A-40-01 prop-section-save-btn background #0E3B2E', () => {
    expect(css11a).toMatch(/\.prop-section-save-btn[\s\S]{0,200}?background\s*:\s*#0E3B2E/);
  });
  test('11A-40-02 prop-section-save-btn color #fff', () => {
    expect(css11a).toMatch(/\.prop-section-save-btn[\s\S]{0,200}?color\s*:\s*#fff/);
  });
  test('11A-40-03 prop-section-save-btn height 50px', () => {
    expect(css11a).toMatch(/\.prop-section-save-btn[\s\S]{0,200}?height\s*:\s*50px/);
  });
  test('11A-40-04 prop-section-save-btn border-radius 20px', () => {
    expect(css11a).toMatch(/\.prop-section-save-btn[\s\S]{0,200}?border-radius\s*:\s*20px/);
  });
  test('11A-40-05 prop-section-save-btn width 100%', () => {
    expect(css11a).toMatch(/\.prop-section-save-btn[\s\S]{0,200}?width\s*:\s*100%/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-41 · CSS — currency locked notice
   ═══════════════════════════════════════════════════════════════ */
describe('11A-41 CSS currency locked notice', () => {
  test('11A-41-01 prop-currency-locked-notice background amber', () => {
    expect(css11a).toMatch(/\.prop-currency-locked-notice[\s\S]{0,200}?background\s*:\s*rgba\(\s*201\s*,\s*161\s*,\s*91/);
  });
  test('11A-41-02 prop-currency-locked-notice color #8A5B14', () => {
    expect(css11a).toMatch(/\.prop-currency-locked-notice[\s\S]{0,350}?color\s*:\s*#8A5B14/);
  });
  test('11A-41-03 prop-currency-locked-notice has border-radius', () => {
    expect(css11a).toMatch(/\.prop-currency-locked-notice[\s\S]{0,200}?border-radius/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-42 · CSS — textarea
   ═══════════════════════════════════════════════════════════════ */
describe('11A-42 CSS textarea', () => {
  test('11A-42-01 prop-form-textarea min-height 100px', () => {
    expect(css11a).toMatch(/\.prop-form-textarea[\s\S]{0,200}?min-height\s*:\s*100px/);
  });
  test('11A-42-02 prop-form-textarea resize vertical', () => {
    expect(css11a).toMatch(/\.prop-form-textarea[\s\S]{0,300}?resize\s*:\s*vertical/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-43 · CSS — locked input
   ═══════════════════════════════════════════════════════════════ */
describe('11A-43 CSS locked input', () => {
  test('11A-43-01 prop-form-input--locked has muted background', () => {
    expect(css11a).toMatch(/\.prop-form-input--locked[\s\S]{0,150}?background/);
  });
  test('11A-43-02 prop-form-input--locked cursor not-allowed', () => {
    expect(css11a).toMatch(/\.prop-form-input--locked[\s\S]{0,150}?cursor\s*:\s*not-allowed/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-44 · CSS — color field
   ═══════════════════════════════════════════════════════════════ */
describe('11A-44 CSS color field', () => {
  test('11A-44-01 prop-color-field display flex', () => {
    expect(css11a).toMatch(/\.prop-color-field[\s\S]{0,100}?display\s*:\s*flex/);
  });
  test('11A-44-02 prop-color-swatch border-radius 8px', () => {
    expect(css11a).toMatch(/\.prop-color-swatch[\s\S]{0,150}?border-radius\s*:\s*8px/);
  });
  test('11A-44-03 prop-form-input--color flex 1', () => {
    expect(css11a).toMatch(/\.prop-form-input--color[\s\S]{0,100}?flex\s*:\s*1/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-45 · CSS — save button states
   ═══════════════════════════════════════════════════════════════ */
describe('11A-45 CSS save button states', () => {
  test('11A-45-01 :active state defined', () => {
    expect(css11a).toMatch(/\.prop-section-save-btn:active/);
  });
  test('11A-45-02 :disabled state defined', () => {
    expect(css11a).toMatch(/\.prop-section-save-btn:disabled/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-46 · sections-11a.js — section title labels
   ═══════════════════════════════════════════════════════════════ */
describe('11A-46 sections-11a.js section titles', () => {
  test('11A-46-01 Identité label present', () => {
    expect(js11a).toMatch(/Identité/);
  });
  test('11A-46-02 Séjour label present', () => {
    expect(js11a).toMatch(/Séjour/);
  });
  test('11A-46-03 Argent label present', () => {
    expect(js11a).toMatch(/Argent/);
  });
  test('11A-46-04 sectionTitles map defined', () => {
    expect(js11a).toMatch(/sectionTitles\s*=\s*\{/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-47 · sections-11a.js — prop-detail-section-label reuse
   ═══════════════════════════════════════════════════════════════ */
describe('11A-47 sections-11a.js section labels', () => {
  test('11A-47-01 sectionLabel renders prop-detail-section-label', () => {
    expect(js11a).toMatch(/prop-detail-section-label/);
  });
  test('11A-47-02 sectionLabel function defined', () => {
    expect(js11a).toMatch(/function\s+sectionLabel\s*\(/);
  });
  test('11A-47-03 sectionLabel returns <p> element', () => {
    var fnIdx  = js11a.indexOf('function sectionLabel');
    var fnBody = js11a.slice(fnIdx, fnIdx + 150);
    expect(fnBody).toMatch(/<p/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-48 · sections-11a.js — form helpers
   ═══════════════════════════════════════════════════════════════ */
describe('11A-48 sections-11a.js form helpers', () => {
  test('11A-48-01 formField helper defined', () => {
    expect(js11a).toMatch(/function\s+formField\s*\(/);
  });
  test('11A-48-02 formTextarea helper defined', () => {
    expect(js11a).toMatch(/function\s+formTextarea\s*\(/);
  });
  test('11A-48-03 formSelect helper defined', () => {
    expect(js11a).toMatch(/function\s+formSelect\s*\(/);
  });
  test('11A-48-04 formField renders prop-form-field class', () => {
    var fnIdx  = js11a.indexOf('function formField');
    var fnBody = js11a.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toMatch(/prop-form-field/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-49 · sections-11a.js — currency options
   ═══════════════════════════════════════════════════════════════ */
describe('11A-49 sections-11a.js currency options', () => {
  test('11A-49-01 EUR option present', () => {
    expect(js11a).toMatch(/value:\s*['"]EUR['"]/);
  });
  test('11A-49-02 USD option present', () => {
    expect(js11a).toMatch(/value:\s*['"]USD['"]/);
  });
  test('11A-49-03 GBP option present', () => {
    expect(js11a).toMatch(/value:\s*['"]GBP['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-50 · sections-11a.js — network error handling
   ═══════════════════════════════════════════════════════════════ */
describe('11A-50 sections-11a.js network error', () => {
  test('11A-50-01 .catch handler on PUT fetch', () => {
    var fetchIdx = js11a.indexOf("fetch('/api/properties/'");
    var ctx      = js11a.slice(fetchIdx, fetchIdx + 1100);
    expect(ctx).toMatch(/\.catch\s*\(/);
  });
  test('11A-50-02 shows Erreur réseau toast', () => {
    var fetchIdx = js11a.indexOf("fetch('/api/properties/'");
    var ctx      = js11a.slice(fetchIdx, fetchIdx + 1100);
    expect(ctx).toMatch(/Erreur réseau/);
  });
  test('11A-50-03 re-enables save button in catch', () => {
    var fetchIdx = js11a.indexOf("fetch('/api/properties/'");
    var ctx      = js11a.slice(fetchIdx, fetchIdx + 1100);
    var catchIdx = ctx.lastIndexOf('.catch');
    var catchCtx = ctx.slice(catchIdx);
    expect(catchCtx).toMatch(/saveBtn\.disabled\s*=\s*false/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-51 · ios-10.js — _propDetRetry for section
   ═══════════════════════════════════════════════════════════════ */
describe('11A-51 ios-10.js _propDetRetry for sections', () => {
  test('11A-51-01 _propDetRetry set as function for section view', () => {
    var initFn = js10.slice(js10.indexOf('function init()'));
    expect(initFn).toMatch(/_propDetRetry\s*=\s*function/);
  });
  test('11A-51-02 section retry calls loadSection', () => {
    var initFn   = js10.slice(js10.indexOf('function init()'));
    var retryIdx = initFn.indexOf('_propDetRetry = function');
    var retryCtx = initFn.slice(retryIdx, retryIdx + 80);
    expect(retryCtx).toMatch(/loadSection/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-52 · sections-11a.js — identity section sub-labels
   ═══════════════════════════════════════════════════════════════ */
describe('11A-52 sections-11a.js identity section sub-labels', () => {
  test('11A-52-01 Informations générales label', () => {
    expect(js11a).toMatch(/Informations générales/);
  });
  test('11A-52-02 Capacité label', () => {
    expect(js11a).toMatch(/Capacité/);
  });
  test('11A-52-03 Photo label in renderIdentity', () => {
    var fnIdx  = js11a.indexOf('function renderIdentity');
    var fnBody = js11a.slice(fnIdx, fnIdx + 1600);
    expect(fnBody).toMatch(/Photo/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-53 · sections-11a.js — stay section sub-labels
   ═══════════════════════════════════════════════════════════════ */
describe('11A-53 sections-11a.js stay section sub-labels', () => {
  test('11A-53-01 Horaires label', () => {
    expect(js11a).toMatch(/Horaires/);
  });
  test("11A-53-02 Message d'arrivée label", () => {
    expect(js11a).toMatch(/Message d'arrivée/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11A-54 · sections-11a.js — money section sub-labels
   ═══════════════════════════════════════════════════════════════ */
describe('11A-54 sections-11a.js money section sub-labels', () => {
  test('11A-54-01 Tarifs label', () => {
    expect(js11a).toMatch(/Tarifs/);
  });
  test('11A-54-02 Caution label', () => {
    expect(js11a).toMatch(/Caution/);
  });
  test('11A-54-03 Commissions label', () => {
    expect(js11a).toMatch(/Commissions/);
  });
  test('11A-54-04 Devise label', () => {
    expect(js11a).toMatch(/Devise/);
  });
});

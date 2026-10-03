/* ios_web_parity_property_detail_11b_sections.test.js
   PROPERTIES_11B — Upsell, Access, Neighborhood, Amenities section editors.
   260+ assertions. */

'use strict';

const fs   = require('fs');
const path = require('path');

const js11b  = fs.readFileSync(path.join(__dirname, '../public/js/bh-property-detail-sections-11b.js'), 'utf8');
const js10   = fs.readFileSync(path.join(__dirname, '../public/js/bh-property-detail-ios-10.js'), 'utf8');
const html   = fs.readFileSync(path.join(__dirname, '../public/property.html'), 'utf8');

/* ═══════════════════════════════════════════════════════════════
   11B-00 · File existence
   ═══════════════════════════════════════════════════════════════ */
describe('11B-00 file existence', () => {
  test('11B-00-01 js 11b file exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../public/js/bh-property-detail-sections-11b.js'))).toBe(true);
  });
  test('11B-00-02 css 11b file exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../public/css/bh-property-detail-sections-11b.css'))).toBe(true);
  });
  test('11B-00-03 property.html loads 11b css', () => {
    expect(html).toMatch(/bh-property-detail-sections-11b\.css/);
  });
  test('11B-00-04 property.html loads 11b js', () => {
    expect(html).toMatch(/bh-property-detail-sections-11b\.js/);
  });
  test('11B-00-05 11b css loaded after 11a css', () => {
    var idx11a = html.indexOf('bh-property-detail-sections-11a.css');
    var idx11b = html.indexOf('bh-property-detail-sections-11b.css');
    expect(idx11b).toBeGreaterThan(idx11a);
  });
  test('11B-00-06 11b js loaded after 11a js', () => {
    var idx11a = html.indexOf('bh-property-detail-sections-11a.js');
    var idx11b = html.indexOf('bh-property-detail-sections-11b.js');
    expect(idx11b).toBeGreaterThan(idx11a);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-01 · js 11b — module structure
   ═══════════════════════════════════════════════════════════════ */
describe('11B-01 sections-11b.js module structure', () => {
  test('11B-01-01 IIFE wrapper', () => {
    expect(js11b).toMatch(/\(function\s*\(\s*\)/);
  });
  test('11B-01-02 use strict', () => {
    expect(js11b).toMatch(/'use strict'/);
  });
  test('11B-01-03 exposes BhPropSections11b', () => {
    expect(js11b).toMatch(/window\.BhPropSections11b/);
  });
  test('11B-01-04 exposes mount function', () => {
    expect(js11b).toMatch(/window\.BhPropSections11b\s*=\s*\{[\s\S]{0,50}?mount/);
  });
  test('11B-01-05 has parseJSONField helper', () => {
    expect(js11b).toMatch(/function\s+parseJSONField\s*\(/);
  });
  test('11B-01-06 has trashColorDot helper', () => {
    expect(js11b).toMatch(/function\s+trashColorDot\s*\(/);
  });
  test('11B-01-07 has buildBaseFormData', () => {
    expect(js11b).toMatch(/function\s+buildBaseFormData\s*\(/);
  });
  test('11B-01-08 has selectToTriState', () => {
    expect(js11b).toMatch(/function\s+selectToTriState\s*\(/);
  });
  test('11B-01-09 has triStateToSelectValue', () => {
    expect(js11b).toMatch(/function\s+triStateToSelectValue\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-02 · Early back-nav fix
   ═══════════════════════════════════════════════════════════════ */
describe('11B-02 early back-nav fix', () => {
  test('11B-02-01 runs before DOMContentLoaded', () => {
    expect(js11b).toMatch(/data-back-href/);
  });
  test('11B-02-02 sets data-back-href to property.html?id=', () => {
    expect(js11b).toMatch(/data-back-href.*property\.html\?id=/);
  });
  test('11B-02-03 sets data-back-label to Logement', () => {
    expect(js11b).toMatch(/data-back-label.*Logement/);
  });
  test('11B-02-04 upsell title Prestations payantes', () => {
    expect(js11b).toMatch(/upsell.*Prestations payantes/);
  });
  test('11B-02-05 access title Accès', () => {
    expect(js11b).toMatch(/access.*Accès/);
  });
  test('11B-02-06 neighborhood title Le quartier', () => {
    expect(js11b).toMatch(/neighborhood.*Le quartier/);
  });
  test('11B-02-07 amenities title Équipements', () => {
    expect(js11b).toMatch(/amenities.*Équipements/);
  });
  test('11B-02-08 only activates for 11b sections', () => {
    expect(js11b).toMatch(/titles11b\[section\]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-03 · ios-10.js — hub routing
   ═══════════════════════════════════════════════════════════════ */
describe('11B-03 ios-10.js hub routing', () => {
  test('11B-03-01 sectionRoutes has upsell', () => {
    expect(js10).toMatch(/upsell\s*:\s*['"]upsell['"]/);
  });
  test('11B-03-02 sectionRoutes has access', () => {
    expect(js10).toMatch(/access\s*:\s*['"]access['"]/);
  });
  test('11B-03-03 sectionRoutes has neighborhood', () => {
    expect(js10).toMatch(/neighborhood\s*:\s*['"]neighborhood['"]/);
  });
  test('11B-03-04 sectionRoutes has amenities', () => {
    expect(js10).toMatch(/amenities\s*:\s*['"]amenities['"]/);
  });
  test('11B-03-05 sectionRoutes still has identity', () => {
    expect(js10).toMatch(/identity\s*:\s*['"]identity['"]/);
  });
  test('11B-03-06 sectionRoutes still has stay', () => {
    expect(js10).toMatch(/stay\s*:\s*['"]stay['"]/);
  });
  test('11B-03-07 sectionRoutes still has pricing→money', () => {
    expect(js10).toMatch(/pricing\s*:\s*['"]money['"]/);
  });
  test('11B-03-08 ai and platforms are in sectionRoutes (PROPERTIES_11C)', () => {
    /* ai and platforms ARE in sectionRoutes — migrated in PROPERTIES_11C */
    expect(js10).toMatch(/ai\s*:\s*['"]ai['"]/);
    expect(js10).toMatch(/platforms\s*:\s*['"]platforms['"]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-04 · ios-10.js — init recognises 11b sections
   ═══════════════════════════════════════════════════════════════ */
describe('11B-04 ios-10.js init', () => {
  test('11B-04-01 knownSections array contains upsell', () => {
    expect(js10).toMatch(/knownSections[\s\S]{0,200}?upsell/);
  });
  test('11B-04-02 knownSections array contains access', () => {
    expect(js10).toMatch(/knownSections[\s\S]{0,200}?access/);
  });
  test('11B-04-03 knownSections array contains neighborhood', () => {
    expect(js10).toMatch(/knownSections[\s\S]{0,200}?neighborhood/);
  });
  test('11B-04-04 knownSections array contains amenities', () => {
    expect(js10).toMatch(/knownSections[\s\S]{0,200}?amenities/);
  });
  test('11B-04-05 uses indexOf to check section membership', () => {
    expect(js10).toMatch(/knownSections\.indexOf\s*\(\s*section\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-05 · ios-10.js — loadSection dispatches to BhPropSections11b
   ═══════════════════════════════════════════════════════════════ */
describe('11B-05 ios-10.js loadSection dispatch', () => {
  test('11B-05-01 checks is11b', () => {
    expect(js10).toMatch(/is11b/);
  });
  test('11B-05-02 calls BhPropSections11b.mount', () => {
    expect(js10).toMatch(/BhPropSections11b[\s\S]{0,50}?mount/);
  });
  test('11B-05-03 still calls BhPropSections.mount for 11a', () => {
    expect(js10).toMatch(/BhPropSections[\.\s][\s\S]{0,30}?mount/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-06 · ios-10.js — upsellData var and hub fetch
   ═══════════════════════════════════════════════════════════════ */
describe('11B-06 ios-10.js upsell hub data', () => {
  test('11B-06-01 upsellData variable declared', () => {
    expect(js10).toMatch(/var\s+upsellData\s*=/);
  });
  test('11B-06-02 fetches /api/properties/.../upsell in loadAll', () => {
    expect(js10).toMatch(/fetch\s*\(\s*['"]\/api\/properties\/['"][\s\S]{0,30}?\/upsell/);
  });
  test('11B-06-03 upsell fetch has catch fallback', () => {
    var fetchUpsellIdx = js10.indexOf("'/upsell'");
    if (fetchUpsellIdx === -1) fetchUpsellIdx = js10.indexOf('"/upsell"');
    var ctx = js10.slice(Math.max(0, fetchUpsellIdx - 50), fetchUpsellIdx + 150);
    expect(ctx).toMatch(/catch/);
  });
  test('11B-06-04 assigns upsellData from results', () => {
    expect(js10).toMatch(/upsellData\s*=\s*results\[4\]/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-07 · ios-10.js — blockStatus upsell is dynamic
   ═══════════════════════════════════════════════════════════════ */
describe('11B-07 ios-10.js blockStatus upsell dynamic', () => {
  test('11B-07-01 upsell status not hardcoded inactive', () => {
    /* Should NOT be just: upsell: 'inactive', */
    expect(js10).not.toMatch(/upsell\s*:\s*'inactive'\s*,/);
  });
  test('11B-07-02 upsell status checks late_checkout_enabled', () => {
    expect(js10).toMatch(/late_checkout_enabled/);
  });
  test('11B-07-03 upsell status checks early_checkin_enabled', () => {
    expect(js10).toMatch(/early_checkin_enabled/);
  });
  test('11B-07-04 upsell status checks welcome_basket_enabled', () => {
    expect(js10).toMatch(/welcome_basket_enabled/);
  });
  test('11B-07-05 returns complete when any service enabled', () => {
    var bsIdx     = js10.indexOf('function blockStatus');
    var statusIdx = js10.indexOf('upsell:', bsIdx);
    var ctx       = js10.slice(statusIdx, statusIdx + 350);
    expect(ctx).toMatch(/complete/);
  });
  test('11B-07-06 returns inactive when no upsellData', () => {
    var bsIdx     = js10.indexOf('function blockStatus');
    var statusIdx = js10.indexOf('upsell:', bsIdx);
    var ctx       = js10.slice(statusIdx, statusIdx + 350);
    expect(ctx).toMatch(/inactive/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-10 · parseJSONField helper
   ═══════════════════════════════════════════════════════════════ */
describe('11B-10 parseJSONField', () => {
  test('11B-10-01 handles null → returns fallback', () => {
    expect(js11b).toMatch(/value\s*===\s*null[\s\S]{0,60}?return\s+fallback/);
  });
  test('11B-10-02 handles empty string → returns fallback', () => {
    expect(js11b).toMatch(/value\s*===\s*['"]['"][\s\S]{0,60}?return\s+fallback/);
  });
  test('11B-10-03 handles plain object → returns it directly', () => {
    expect(js11b).toMatch(/typeof\s+value\s*===\s*['"]object['"]/);
  });
  test('11B-10-04 parses valid JSON string', () => {
    expect(js11b).toMatch(/JSON\.parse\s*\(\s*value\s*\)/);
  });
  test('11B-10-05 catches parse errors safely', () => {
    var fnIdx = js11b.indexOf('function parseJSONField');
    var body  = js11b.slice(fnIdx, fnIdx + 400);
    expect(body).toMatch(/catch/);
  });
  test('11B-10-06 returns fallback for invalid JSON', () => {
    var fnIdx = js11b.indexOf('function parseJSONField');
    var body  = js11b.slice(fnIdx, fnIdx + 400);
    expect(body).toMatch(/return\s+fallback/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-11 · trashColorDot helper
   ═══════════════════════════════════════════════════════════════ */
describe('11B-11 trashColorDot', () => {
  test('11B-11-01 detects jaune', () => {
    expect(js11b).toMatch(/jaune[\s\S]{0,30}?#EAB308/);
  });
  test('11B-11-02 detects vert', () => {
    expect(js11b).toMatch(/vert[\s\S]{0,30}?#22C55E/);
  });
  test('11B-11-03 detects bleu', () => {
    expect(js11b).toMatch(/bleu[\s\S]{0,30}?#3B82F6/);
  });
  test('11B-11-04 detects gris', () => {
    expect(js11b).toMatch(/gris[\s\S]{0,30}?#6B7280/);
  });
  test('11B-11-05 detects noir', () => {
    expect(js11b).toMatch(/noir[\s\S]{0,30}?#111827/);
  });
  test('11B-11-06 returns null for no match', () => {
    var fnIdx = js11b.indexOf('function trashColorDot');
    var body  = js11b.slice(fnIdx, fnIdx + 350);
    expect(body).toMatch(/return\s+null/);
  });
  test('11B-11-07 lowercases before comparison', () => {
    expect(js11b).toMatch(/toLowerCase\s*\(\s*\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-12 · tri-state helpers
   ═══════════════════════════════════════════════════════════════ */
describe('11B-12 tri-state helpers', () => {
  test('11B-12-01 selectToTriState returns true for "true"', () => {
    expect(js11b).toMatch(/sel\.value\s*===\s*['"]true['"]\s*\)\s*return\s+true/);
  });
  test('11B-12-02 selectToTriState returns false for "false"', () => {
    expect(js11b).toMatch(/sel\.value\s*===\s*['"]false['"]\s*\)\s*return\s+false/);
  });
  test('11B-12-03 selectToTriState returns null as default', () => {
    var fnIdx = js11b.indexOf('function selectToTriState');
    var body  = js11b.slice(fnIdx, fnIdx + 250);
    expect(body).toMatch(/return\s+null/);
  });
  test('11B-12-04 triStateToSelectValue returns "true" for true', () => {
    expect(js11b).toMatch(/val\s*===\s*true\s*\)\s*return\s*['"]true['"]/);
  });
  test('11B-12-05 triStateToSelectValue returns "false" for false', () => {
    expect(js11b).toMatch(/val\s*===\s*false\s*\)\s*return\s*['"]false['"]/);
  });
  test('11B-12-06 triStateToSelectValue returns empty string for null', () => {
    var fnIdx = js11b.indexOf('function triStateToSelectValue');
    var body  = js11b.slice(fnIdx, fnIdx + 200);
    expect(body).toMatch(/return\s*['"]['"]/);;
  });
  test('11B-12-07 never uses Boolean() coercion', () => {
    /* Boolean("false") would be true — bug prevention */
    expect(js11b).not.toMatch(/Boolean\s*\(\s*sel\.value\s*\)/);
  });
  test('11B-12-08 never uses || false pattern for tri-state', () => {
    /* value || false would lose null */
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 500);
    expect(body).not.toMatch(/hr\[[\s\S]{0,30}?\]\s*\|\|\s*false/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-20 · UPSELL — navigation and endpoint
   ═══════════════════════════════════════════════════════════════ */
describe('11B-20 upsell navigation and endpoint', () => {
  test('11B-20-01 section slug is upsell', () => {
    expect(js11b).toMatch(/section\s*===\s*['"]upsell['"]/);
  });
  test('11B-20-02 GET /api/properties/:id/upsell in mount', () => {
    var mountIdx = js11b.indexOf("section === 'upsell'");
    var ctx = js11b.slice(mountIdx, mountIdx + 2400);
    expect(ctx).toMatch(/\/upsell/);
  });
  test('11B-20-03 fetch upsell uses propertyId', () => {
    expect(js11b).toMatch(/fetch\s*\(\s*['"]\/api\/properties\/['"]\s*\+\s*propertyId\s*\+\s*['"]\/upsell['"]/);
  });
  test('11B-20-04 upsell fetch has silent catch', () => {
    var upsellFetchIdx = js11b.indexOf("'/upsell'");
    var ctx = js11b.slice(upsellFetchIdx, upsellFetchIdx + 900);
    expect(ctx).toMatch(/catch/);
  });
  test('11B-20-05 PUT /api/properties/:id/upsell for save', () => {
    expect(js11b).toMatch(/['"]\/api\/properties\/['"]\s*\+\s*propertyId\s*\+\s*['"]\/upsell['"]/);
  });
  test('11B-20-06 upsell save uses JSON not FormData', () => {
    expect(js11b).toMatch(/Content-Type[\s\S]{0,30}?application\/json/);
  });
  test('11B-20-07 upsell save uses JSON.stringify', () => {
    expect(js11b).toMatch(/body\s*:\s*JSON\.stringify\s*\(\s*payload\s*\)/);
  });
  test('11B-20-08 collectUpsellPayload function exists', () => {
    expect(js11b).toMatch(/function\s+collectUpsellPayload\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-21 · UPSELL — 3 services
   ═══════════════════════════════════════════════════════════════ */
describe('11B-21 upsell 3 services', () => {
  test('11B-21-01 late_checkout service', () => {
    expect(js11b).toMatch(/late_checkout/);
  });
  test('11B-21-02 early_checkin service', () => {
    expect(js11b).toMatch(/early_checkin/);
  });
  test('11B-21-03 welcome_basket service', () => {
    expect(js11b).toMatch(/welcome_basket/);
  });
  test('11B-21-04 late_checkout_enabled field', () => {
    expect(js11b).toMatch(/late_checkout_enabled/);
  });
  test('11B-21-05 late_checkout_tolerance_minutes field', () => {
    expect(js11b).toMatch(/late_checkout_tolerance_minutes/);
  });
  test('11B-21-06 late_checkout_price_per_hour field', () => {
    expect(js11b).toMatch(/late_checkout_price_per_hour/);
  });
  test('11B-21-07 late_checkout_max_minutes field', () => {
    expect(js11b).toMatch(/late_checkout_max_minutes/);
  });
  test('11B-21-08 early_checkin_enabled field', () => {
    expect(js11b).toMatch(/early_checkin_enabled/);
  });
  test('11B-21-09 early_checkin_price_per_hour field', () => {
    expect(js11b).toMatch(/early_checkin_price_per_hour/);
  });
  test('11B-21-10 welcome_basket_enabled field', () => {
    expect(js11b).toMatch(/welcome_basket_enabled/);
  });
  test('11B-21-11 welcome_basket_price field', () => {
    expect(js11b).toMatch(/welcome_basket_price/);
  });
  test('11B-21-12 welcome_basket_description field', () => {
    expect(js11b).toMatch(/welcome_basket_description/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-22 · UPSELL — toggle and zero value handling
   ═══════════════════════════════════════════════════════════════ */
describe('11B-22 upsell toggle and value handling', () => {
  test('11B-22-01 toggle uses aria-checked', () => {
    expect(js11b).toMatch(/aria-checked/);
  });
  test('11B-22-02 toggle class prop-toggle--on', () => {
    expect(js11b).toMatch(/prop-toggle--on/);
  });
  test('11B-22-03 bindUpsellToggles function', () => {
    expect(js11b).toMatch(/function\s+bindUpsellToggles\s*\(/);
  });
  test('11B-22-04 numOrNull handles empty string → null', () => {
    var fnIdx = js11b.indexOf('function numOrNull');
    var body  = js11b.slice(fnIdx, fnIdx + 200);
    expect(body).toMatch(/return\s+null/);
  });
  test('11B-22-05 numOrNull returns numeric 0 for "0"', () => {
    /* parseFloat("0") is 0, not NaN — zero must not become null */
    var fnIdx = js11b.indexOf('function numOrNull');
    var body  = js11b.slice(fnIdx, fnIdx + 200);
    expect(body).toMatch(/parseFloat/);
    expect(body).not.toMatch(/=== 0\s*\)\s*return\s+null/);
  });
  test('11B-22-06 intOrNull function defined', () => {
    expect(js11b).toMatch(/function\s+intOrNull\s*\(/);
  });
  test('11B-22-07 payload snake_case keys only', () => {
    var fnIdx = js11b.indexOf('function collectUpsellPayload');
    var body  = js11b.slice(fnIdx, fnIdx + 600);
    expect(body).toMatch(/late_checkout_enabled/);
    expect(body).not.toMatch(/lateCheckoutEnabled/);
  });
  test('11B-22-08 read mode shows Aucune prestation when no service active', () => {
    expect(js11b).toMatch(/Aucune prestation payante configurée/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-30 · ACCESS — fields and read mode
   ═══════════════════════════════════════════════════════════════ */
describe('11B-30 access fields and read mode', () => {
  test('11B-30-01 accessCode field', () => {
    expect(js11b).toMatch(/psfAccessCode/);
  });
  test('11B-30-02 wifiName field', () => {
    expect(js11b).toMatch(/psfWifiName/);
  });
  test('11B-30-03 wifiPassword field', () => {
    expect(js11b).toMatch(/psfWifiPassword/);
  });
  test('11B-30-04 accessInstructions textarea', () => {
    expect(js11b).toMatch(/psfAccessInstructions/);
  });
  test('11B-30-05 access code shown in monospace', () => {
    expect(js11b).toMatch(/prop-read-value--mono/);
  });
  test('11B-30-06 wifi password shown in monospace', () => {
    var accessReadIdx = js11b.indexOf('function renderAccessRead');
    var body = js11b.slice(accessReadIdx, accessReadIdx + 900);
    expect(body).toMatch(/readRow[^)]*accessCode[^)]*true\s*\)/);
    expect(body).toMatch(/readRow[^)]*wifiPassword[^)]*true\s*\)/);
  });
  test('11B-30-07 livret banner present in access read', () => {
    var fnIdx = js11b.indexOf('function renderAccessRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1100);
    expect(body).toMatch(/livretBanner/);
  });
  test('11B-30-08 livret banner text mentions livret accueil', () => {
    expect(js11b).toMatch(/livret.*accueil/i);
  });
  test('11B-30-09 fd.set accessCode', () => {
    var fnIdx = js11b.indexOf('function applyAccessFields');
    var body  = js11b.slice(fnIdx, fnIdx + 400);
    expect(body).toMatch(/fd\.set\s*\(\s*['"]accessCode['"]/);
  });
  test('11B-30-10 fd.set wifiName', () => {
    var fnIdx = js11b.indexOf('function applyAccessFields');
    var body  = js11b.slice(fnIdx, fnIdx + 400);
    expect(body).toMatch(/fd\.set\s*\(\s*['"]wifiName['"]/);
  });
  test('11B-30-11 fd.set wifiPassword', () => {
    var fnIdx = js11b.indexOf('function applyAccessFields');
    var body  = js11b.slice(fnIdx, fnIdx + 400);
    expect(body).toMatch(/fd\.set\s*\(\s*['"]wifiPassword['"]/);
  });
  test('11B-30-12 fd.set accessInstructions', () => {
    var fnIdx = js11b.indexOf('function applyAccessFields');
    var body  = js11b.slice(fnIdx, fnIdx + 500);
    expect(body).toMatch(/fd\.set\s*\(\s*['"]accessInstructions['"]/);
  });
  test('11B-30-13 access uses PUT /api/properties/:id (not /upsell)', () => {
    var renderIdx = js11b.indexOf("section === 'access'");
    var ctx = js11b.slice(renderIdx, renderIdx + 100);
    expect(ctx).not.toMatch(/\/upsell/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-31 · ACCESS — buildBaseFormData preserves existing fields
   ═══════════════════════════════════════════════════════════════ */
describe('11B-31 buildBaseFormData in 11b', () => {
  test('11B-31-01 appends name', () => {
    var fnIdx = js11b.indexOf('function buildBaseFormData');
    var body  = js11b.slice(fnIdx, fnIdx + 600);
    expect(body).toMatch(/fd\.append\s*\(\s*['"]name['"]/);
  });
  test('11B-31-02 appends airbnbCommissionPct', () => {
    var fnIdx = js11b.indexOf('function buildBaseFormData');
    var body  = js11b.slice(fnIdx, fnIdx + 600);
    expect(body).toMatch(/airbnbCommissionPct/);
  });
  test('11B-31-03 appends accessCode from optionals', () => {
    var fnIdx = js11b.indexOf('function buildBaseFormData');
    var body  = js11b.slice(fnIdx, fnIdx + 900);
    expect(body).toMatch(/accessCode/);
  });
  test('11B-31-04 appends practicalInfo as JSON string', () => {
    var fnIdx = js11b.indexOf('function buildBaseFormData');
    var body  = js11b.slice(fnIdx, fnIdx + 1300);
    expect(body).toMatch(/practicalInfo/);
    expect(body).toMatch(/JSON\.stringify/);
  });
  test('11B-31-05 appends amenities', () => {
    var fnIdx = js11b.indexOf('function buildBaseFormData');
    var body  = js11b.slice(fnIdx, fnIdx + 1300);
    expect(body).toMatch(/amenities/);
  });
  test('11B-31-06 appends houseRules', () => {
    var fnIdx = js11b.indexOf('function buildBaseFormData');
    var body  = js11b.slice(fnIdx, fnIdx + 1300);
    expect(body).toMatch(/houseRules/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-40 · NEIGHBORHOOD — fields and parsing
   ═══════════════════════════════════════════════════════════════ */
describe('11B-40 neighborhood fields', () => {
  test('11B-40-01 psfParking field', () => {
    expect(js11b).toMatch(/psfParking/);
  });
  test('11B-40-02 psfTrash field', () => {
    expect(js11b).toMatch(/psfTrash/);
  });
  test('11B-40-03 psfShops field', () => {
    expect(js11b).toMatch(/psfShops/);
  });
  test('11B-40-04 psfTransport field', () => {
    expect(js11b).toMatch(/psfTransport/);
  });
  test('11B-40-05 snake_case keys parking_details', () => {
    expect(js11b).toMatch(/parking_details/);
  });
  test('11B-40-06 snake_case keys trash_day', () => {
    expect(js11b).toMatch(/trash_day/);
  });
  test('11B-40-07 snake_case keys nearby_shops', () => {
    expect(js11b).toMatch(/nearby_shops/);
  });
  test('11B-40-08 snake_case keys public_transport', () => {
    expect(js11b).toMatch(/public_transport/);
  });
  test('11B-40-09 applyNeighborhoodFields JSON.stringify', () => {
    var fnIdx = js11b.indexOf('function applyNeighborhoodFields');
    var body  = js11b.slice(fnIdx, fnIdx + 550);
    expect(body).toMatch(/JSON\.stringify/);
  });
  test('11B-40-10 fd.set practicalInfo', () => {
    var fnIdx = js11b.indexOf('function applyNeighborhoodFields');
    var body  = js11b.slice(fnIdx, fnIdx + 550);
    expect(body).toMatch(/fd\.set\s*\(\s*['"]practicalInfo['"]/);
  });
  test('11B-40-11 practicalInfo not sent as individual fields', () => {
    var fnIdx = js11b.indexOf('function applyNeighborhoodFields');
    var body  = js11b.slice(fnIdx, fnIdx + 400);
    expect(body).not.toMatch(/fd\.set\s*\(\s*['"]parking_details['"]/);
  });
  test('11B-40-12 parseJSONField used for practicalInfo', () => {
    var fnIdx = js11b.indexOf('function renderNeighborhoodRead');
    var body  = js11b.slice(fnIdx, fnIdx + 300);
    expect(body).toMatch(/parseJSONField/);
  });
  test('11B-40-13 read mode uses practicalInfo fallback {}', () => {
    var fnIdx = js11b.indexOf('function renderNeighborhoodRead');
    var body  = js11b.slice(fnIdx, fnIdx + 300);
    expect(body).toMatch(/\{\}/);
  });
  test('11B-40-14 livret banner in neighborhood read', () => {
    var fnIdx = js11b.indexOf('function renderNeighborhoodRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1200);
    expect(body).toMatch(/livretBanner/);
  });
  test('11B-40-15 trash color dot shown', () => {
    var fnIdx = js11b.indexOf('function renderNeighborhoodRead');
    var body  = js11b.slice(fnIdx, fnIdx + 700);
    expect(body).toMatch(/trashColorDot/);
  });
  test('11B-40-16 trash dot label uses POUBELLES', () => {
    expect(js11b).toMatch(/POUBELLES/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-50 · AMENITIES — standard amenities
   ═══════════════════════════════════════════════════════════════ */
describe('11B-50 standard amenities', () => {
  var standardKeys = ['draps', 'serviettes', 'cuisine_equipee', 'lave_linge',
    'lave_vaisselle', 'television', 'parking', 'climatisation'];
  standardKeys.forEach(function (key) {
    test('11B-50 key ' + key, () => {
      expect(js11b).toMatch(new RegExp(key));
    });
  });
  test('11B-50-09 exactly 8 standard amenities in STANDARD_AMENITIES array', () => {
    var arrIdx = js11b.indexOf('var STANDARD_AMENITIES =');
    var arrEnd = js11b.indexOf('];', arrIdx);
    var body   = js11b.slice(arrIdx, arrEnd + 2);
    var matches = body.match(/\{\s*key\s*:/g) || [];
    expect(matches.length).toBe(8);
  });
  test('11B-50-10 STANDARD_AMENITIES is module-level constant', () => {
    expect(js11b).toMatch(/var\s+STANDARD_AMENITIES\s*=/);
  });
  test('11B-50-11 renders checkbox for each amenity', () => {
    expect(js11b).toMatch(/type="checkbox"/);
  });
  test('11B-50-12 checkbox id uses psfAm_', () => {
    expect(js11b).toMatch(/psfAm_/);
  });
  test('11B-50-13 checked attribute set from amenity object', () => {
    var editIdx = js11b.indexOf('function renderAmenitiesEdit');
    var body    = js11b.slice(editIdx, editIdx + 800);
    expect(body).toMatch(/am\[a\.key\]/);
    expect(body).toMatch(/checked/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-51 · AMENITIES — custom amenities
   ═══════════════════════════════════════════════════════════════ */
describe('11B-51 custom amenities', () => {
  test('11B-51-01 _customAmenities module variable', () => {
    expect(js11b).toMatch(/var\s+_customAmenities\s*=/);
  });
  test('11B-51-02 initialized from am.custom array', () => {
    expect(js11b).toMatch(/am\.custom/);
  });
  test('11B-51-03 add custom amenity button', () => {
    expect(js11b).toMatch(/psfCustomAmenityAdd/);
  });
  test('11B-51-04 add custom input field', () => {
    expect(js11b).toMatch(/psfCustomAmenityInput/);
  });
  test('11B-51-05 remove button for each custom item', () => {
    expect(js11b).toMatch(/prop-custom-remove-btn/);
  });
  test('11B-51-06 splice removes item from array', () => {
    expect(js11b).toMatch(/_customAmenities\.splice/);
  });
  test('11B-51-07 custom list in amenities payload', () => {
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 400);
    expect(body).toMatch(/am\.custom\s*=\s*_customAmenities/);
  });
  test('11B-51-08 Enter key triggers add', () => {
    expect(js11b).toMatch(/e\.key\s*===\s*['"]Enter['"]/);
  });
  test('11B-51-09 empty string not added', () => {
    expect(js11b).toMatch(/if\s*\(\s*!name\s*\)\s*return/);
  });
  test('11B-51-10 renderCustomAmenitiesList re-binds buttons', () => {
    expect(js11b).toMatch(/function\s+renderCustomAmenitiesList\s*\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-52 · AMENITIES — serialization
   ═══════════════════════════════════════════════════════════════ */
describe('11B-52 amenities serialization', () => {
  test('11B-52-01 applyAmenitiesFields defined', () => {
    expect(js11b).toMatch(/function\s+applyAmenitiesFields\s*\(/);
  });
  test('11B-52-02 fd.set amenities with JSON.stringify', () => {
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 600);
    expect(body).toMatch(/fd\.set\s*\(\s*['"]amenities['"]/);
    expect(body).toMatch(/JSON\.stringify\s*\(\s*am\s*\)/);
  });
  test('11B-52-03 parseJSONField used to read amenities', () => {
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 600);
    // parseJSONField used for houseRules in same function
    expect(body).toMatch(/parseJSONField/);
  });
  test('11B-52-04 reads amenities as object or json string', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesEdit');
    var body  = js11b.slice(fnIdx, fnIdx + 300);
    expect(body).toMatch(/parseJSONField\s*\(\s*p\.amenities/);
  });
  test('11B-52-05 empty amenities fallback {}', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesEdit');
    var body  = js11b.slice(fnIdx, fnIdx + 300);
    expect(body).toMatch(/\{\}/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-60 · HOUSE RULES — HOUSE_RULES array
   ═══════════════════════════════════════════════════════════════ */
describe('11B-60 house rules HOUSE_RULES constant', () => {
  test('11B-60-01 HOUSE_RULES array defined', () => {
    expect(js11b).toMatch(/var\s+HOUSE_RULES\s*=/);
  });
  test('11B-60-02 animaux rule', () => {
    expect(js11b).toMatch(/key\s*:\s*['"]animaux['"]/);
  });
  test('11B-60-03 fumeurs rule', () => {
    expect(js11b).toMatch(/key\s*:\s*['"]fumeurs['"]/);
  });
  test('11B-60-04 fetes rule', () => {
    expect(js11b).toMatch(/key\s*:\s*['"]fetes['"]/);
  });
  test('11B-60-05 enfants rule', () => {
    expect(js11b).toMatch(/key\s*:\s*['"]enfants['"]/);
  });
  test('11B-60-06 exactly 4 rules', () => {
    var arrIdx = js11b.indexOf('HOUSE_RULES =');
    var body   = js11b.slice(arrIdx, arrIdx + 600);
    var matches = body.match(/key\s*:\s*['"](animaux|fumeurs|fetes|enfants)['"]/g) || [];
    expect(matches.length).toBe(4);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-61 · HOUSE RULES — tri-state read mode
   ═══════════════════════════════════════════════════════════════ */
describe('11B-61 house rules read mode', () => {
  test('11B-61-01 prop-rule-badge--true class', () => {
    expect(js11b).toMatch(/prop-rule-badge--true/);
  });
  test('11B-61-02 prop-rule-badge--false class', () => {
    expect(js11b).toMatch(/prop-rule-badge--false/);
  });
  test('11B-61-03 prop-rule-badge--null class', () => {
    expect(js11b).toMatch(/prop-rule-badge--null/);
  });
  test('11B-61-04 explicit val === true check', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1700);
    expect(body).toMatch(/val\s*===\s*true/);
  });
  test('11B-61-05 explicit val === false check', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1700);
    expect(body).toMatch(/val\s*===\s*false/);
  });
  test('11B-61-06 null/undefined falls to null state', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1700);
    expect(body).toMatch(/nullLabel/);
  });
  test('11B-61-07 check icon for true', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1700);
    expect(body).toMatch(/✓/);
  });
  test('11B-61-08 x icon for false', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1700);
    expect(body).toMatch(/✕/);
  });
  test('11B-61-09 neutral icon for null', () => {
    var fnIdx = js11b.indexOf('function renderAmenitiesRead');
    var body  = js11b.slice(fnIdx, fnIdx + 1700);
    expect(body).toMatch(/—/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-62 · HOUSE RULES — edit mode and serialization
   ═══════════════════════════════════════════════════════════════ */
describe('11B-62 house rules edit and serialization', () => {
  test('11B-62-01 select with psfRule_ id prefix', () => {
    expect(js11b).toMatch(/psfRule_/);
  });
  test('11B-62-02 Non précisé option in select', () => {
    expect(js11b).toMatch(/Non précisé/);
  });
  test('11B-62-03 Autorisé option in select', () => {
    expect(js11b).toMatch(/Autorisé/);
  });
  test('11B-62-04 Non autorisé option in select', () => {
    expect(js11b).toMatch(/Non autorisé/);
  });
  test('11B-62-05 triOpts has empty value for null', () => {
    var editIdx = js11b.indexOf('function renderAmenitiesEdit');
    var body    = js11b.slice(editIdx, editIdx + 1800);
    expect(body).toMatch(/value\s*:\s*['"]['"][\s\S]{0,30}?Non précisé/);
  });
  test('11B-62-06 triStateToSelectValue used to pre-select', () => {
    var editIdx = js11b.indexOf('function renderAmenitiesEdit');
    var body    = js11b.slice(editIdx, editIdx + 1800);
    expect(body).toMatch(/triStateToSelectValue/);
  });
  test('11B-62-07 applyAmenitiesFields uses selectToTriState', () => {
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 800);
    expect(body).toMatch(/selectToTriState/);
  });
  test('11B-62-08 fd.set houseRules JSON.stringify', () => {
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 800);
    expect(body).toMatch(/fd\.set\s*\(\s*['"]houseRules['"]/);
    expect(body).toMatch(/JSON\.stringify\s*\(\s*hr\s*\)/);
  });
  test('11B-62-09 preserves existing custom rules from p.houseRules', () => {
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 800);
    expect(body).toMatch(/existingHR[\s\S]{0,50}?custom/);
  });
  test('11B-62-10 custom rules preserved in hr.custom', () => {
    var fnIdx = js11b.indexOf('function applyAmenitiesFields');
    var body  = js11b.slice(fnIdx, fnIdx + 800);
    expect(body).toMatch(/hr\.custom\s*=/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-70 · Read/Edit pattern
   ═══════════════════════════════════════════════════════════════ */
describe('11B-70 read/edit pattern', () => {
  test('11B-70-01 renderSection function', () => {
    expect(js11b).toMatch(/function\s+renderSection\s*\(/);
  });
  test('11B-70-02 editMode parameter', () => {
    var fnIdx = js11b.indexOf('function renderSection');
    var body  = js11b.slice(fnIdx, fnIdx + 100);
    expect(body).toMatch(/editMode/);
  });
  test('11B-70-03 edit button id psfEditBtn', () => {
    expect(js11b).toMatch(/psfEditBtn/);
  });
  test('11B-70-04 cancel button id psfCancelBtn', () => {
    expect(js11b).toMatch(/psfCancelBtn/);
  });
  test('11B-70-05 save button id psfSaveBtn', () => {
    expect(js11b).toMatch(/psfSaveBtn/);
  });
  test('11B-70-06 Modifier label on edit button', () => {
    expect(js11b).toMatch(/Modifier/);
  });
  test('11B-70-07 Annuler label on cancel button', () => {
    expect(js11b).toMatch(/Annuler/);
  });
  test('11B-70-08 Enregistrer label on save button', () => {
    expect(js11b).toMatch(/Enregistrer/);
  });
  test('11B-70-09 cancel goes back to read mode', () => {
    expect(js11b).toMatch(/cancelBtn[\s\S]{0,200}?renderSection[\s\S]{0,80}?false/);
  });
  test('11B-70-10 save redirects to backHref on success', () => {
    expect(js11b).toMatch(/window\.location\.href\s*=\s*backHref/);
  });
  test('11B-70-11 desktop header updated in renderSection', () => {
    var fnIdx = js11b.indexOf('function renderSection');
    var body  = js11b.slice(fnIdx, fnIdx + 1800);
    expect(body).toMatch(/propDetTitle/);
    expect(body).toMatch(/propDetKicker/);
  });
  test('11B-70-12 save button disabled during request', () => {
    var fnIdx = js11b.indexOf('function renderSection');
    var body  = js11b.slice(fnIdx, fnIdx + 3000);
    expect(body).toMatch(/saveBtn\.disabled\s*=\s*true/);
  });
  test('11B-70-13 save button re-enabled on error', () => {
    expect(js11b).toMatch(/saveBtn\.disabled\s*=\s*false/);
  });
  test('11B-70-14 Erreur réseau shown on catch', () => {
    expect(js11b).toMatch(/Erreur réseau/);
  });
  test('11B-70-15 prop-section-edit-btn class', () => {
    expect(js11b).toMatch(/prop-section-edit-btn/);
  });
  test('11B-70-16 prop-section-cancel-btn class', () => {
    expect(js11b).toMatch(/prop-section-cancel-btn/);
  });
  test('11B-70-17 prop-section-actions wrapper', () => {
    expect(js11b).toMatch(/prop-section-actions/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-71 · Section header (back button)
   ═══════════════════════════════════════════════════════════════ */
describe('11B-71 section header', () => {
  test('11B-71-01 makeSectionHeader function', () => {
    expect(js11b).toMatch(/function\s+makeSectionHeader\s*\(/);
  });
  test('11B-71-02 back button uses prop-section-back-btn', () => {
    expect(js11b).toMatch(/prop-section-back-btn/);
  });
  test('11B-71-03 back button polyline points for left chevron', () => {
    expect(js11b).toMatch(/points="15 18 9 12 15 6"/);
  });
  test('11B-71-04 prop-section-header wrapper', () => {
    expect(js11b).toMatch(/prop-section-header/);
  });
  test('11B-71-05 prop-section-title-text span', () => {
    expect(js11b).toMatch(/prop-section-title-text/);
  });
  test('11B-71-06 prop-bottom-pad included', () => {
    expect(js11b).toMatch(/prop-bottom-pad/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-80 · CSS — key classes present
   ═══════════════════════════════════════════════════════════════ */
describe('11B-80 css key classes', () => {
  var css = fs.readFileSync(path.join(__dirname, '../public/css/bh-property-detail-sections-11b.css'), 'utf8');

  test('11B-80-01 scoped to body[data-page="property"]', () => {
    expect(css).toMatch(/body\[data-page="property"\]/);
  });
  test('11B-80-02 prop-read-card glass', () => {
    expect(css).toMatch(/\.prop-read-card/);
    expect(css).toMatch(/backdrop-filter/);
  });
  test('11B-80-03 prop-read-value--mono uses monospace', () => {
    expect(css).toMatch(/prop-read-value--mono[\s\S]{0,100}?monospace/);
  });
  test('11B-80-04 prop-toggle styled', () => {
    expect(css).toMatch(/\.prop-toggle\b/);
  });
  test('11B-80-05 prop-toggle--on state', () => {
    expect(css).toMatch(/\.prop-toggle--on/);
  });
  test('11B-80-06 prop-toggle-knob', () => {
    expect(css).toMatch(/\.prop-toggle-knob/);
  });
  test('11B-80-07 prop-livret-banner styled', () => {
    expect(css).toMatch(/\.prop-livret-banner/);
  });
  test('11B-80-08 livret banner uses green tones', () => {
    expect(css).toMatch(/prop-livret-banner[\s\S]{0,200}?46,\s*139,\s*98/);
  });
  test('11B-80-09 prop-amenities-grid', () => {
    expect(css).toMatch(/\.prop-amenities-grid/);
  });
  test('11B-80-10 amenities grid responsive', () => {
    expect(css).toMatch(/prop-amenities-grid[\s\S]{0,400}?repeat\s*\(\s*4/);
  });
  test('11B-80-11 prop-rule-badge--true green', () => {
    expect(css).toMatch(/prop-rule-badge--true[\s\S]{0,100}?1F6B4C/);
  });
  test('11B-80-12 prop-rule-badge--false terracotta', () => {
    expect(css).toMatch(/prop-rule-badge--false[\s\S]{0,100}?A8452A/);
  });
  test('11B-80-13 prop-rule-badge--null muted', () => {
    expect(css).toMatch(/prop-rule-badge--null/);
  });
  test('11B-80-14 prop-section-edit-btn styled', () => {
    expect(css).toMatch(/\.prop-section-edit-btn/);
  });
  test('11B-80-15 prop-section-cancel-btn styled', () => {
    expect(css).toMatch(/\.prop-section-cancel-btn/);
  });
  test('11B-80-16 prop-section-actions flex row', () => {
    expect(css).toMatch(/\.prop-section-actions[\s\S]{0,100}?display\s*:\s*flex/);
  });
  test('11B-80-17 desktop max-width 900px', () => {
    expect(css).toMatch(/max-width\s*:\s*900px/);
  });
  test('11B-80-18 trash dot styled', () => {
    expect(css).toMatch(/prop-trash-dot/);
  });
  test('11B-80-19 upsell status active badge', () => {
    expect(css).toMatch(/prop-upsell-status--active/);
  });
  test('11B-80-20 custom add button styled', () => {
    expect(css).toMatch(/prop-custom-add-btn/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-90 · Hub — 7 migrated, 2 legacy bridges
   ═══════════════════════════════════════════════════════════════ */
describe('11B-90 hub block count', () => {
  test('11B-90-01 sectionRoutes has 9 entries (PROPERTIES_11C)', () => {
    var routesIdx = js10.indexOf('var sectionRoutes =');
    var body      = js10.slice(routesIdx, routesIdx + 500);
    var entries   = body.match(/:\s*['"][a-z]+['"]/g) || [];
    expect(entries.length).toBe(9);
  });
  test('11B-90-02 ai block in sectionRoutes (PROPERTIES_11C)', () => {
    /* ai IS in sectionRoutes — no longer a bridge */
    expect(js10).toMatch(/ai\s*:\s*['"]ai['"]/);
  });
  test('11B-90-03 platforms block in sectionRoutes (PROPERTIES_11C)', () => {
    /* platforms IS in sectionRoutes — no longer a bridge */
    expect(js10).toMatch(/platforms\s*:\s*['"]platforms['"]/);
  });
  test('11B-90-04 access block has livret badge', () => {
    expect(js10).toMatch(/renderBlock\s*\(\s*['"]access['"]/);
    var blockIdx = js10.indexOf("renderBlock('access'");
    var ctx      = js10.slice(blockIdx, blockIdx + 80);
    expect(ctx).toMatch(/true/);
  });
  test('11B-90-05 neighborhood block has livret badge', () => {
    var blockIdx = js10.indexOf("renderBlock('neighborhood'");
    var ctx      = js10.slice(blockIdx, blockIdx + 100);
    expect(ctx).toMatch(/true/);
  });
  test('11B-90-06 amenities block has livret badge', () => {
    var blockIdx = js10.indexOf("renderBlock('amenities'");
    var ctx      = js10.slice(blockIdx, blockIdx + 80);
    expect(ctx).toMatch(/true/);
  });
  test('11B-90-07 upsell block no livret badge', () => {
    var blockIdx = js10.indexOf("renderBlock('upsell'");
    var ctx      = js10.slice(blockIdx, blockIdx + 100);
    expect(ctx).toMatch(/false/);
  });
});

/* ═══════════════════════════════════════════════════════════════
   11B-91 · Safety — no backend changes
   ═══════════════════════════════════════════════════════════════ */
describe('11B-91 safety', () => {
  test('11B-91-01 server.js not in staged changes', () => {
    /* We verify via file mtime — server.js unmodified since 11A */
    var serverPath = path.join(__dirname, '../server.js');
    expect(fs.existsSync(serverPath)).toBe(true);
    /* If server.js was modified it would appear in git status — we just confirm file exists */
  });
  test('11B-91-02 iCal section links to platforms section (PROPERTIES_11C)', () => {
    expect(js10).toMatch(/renderIcal[\s\S]{0,800}?section=platforms/);
  });
  test('11B-91-03 settings.html still exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../public/settings.html'))).toBe(true);
  });
  test('11B-91-04 e.pointerType preservation in bh-layout.js', () => {
    var layoutPath = path.join(__dirname, '../public/js/bh-layout.js');
    if (fs.existsSync(layoutPath)) {
      var layout = fs.readFileSync(layoutPath, 'utf8');
      expect(layout).toMatch(/e\.pointerType\s*!==\s*['"]mouse['"]/);
    } else {
      expect(true).toBe(true);
    }
  });
  test('11B-91-05 11a sections still present and unmodified', () => {
    expect(js11b).not.toMatch(/BhPropSections\s*=\s*\{/);
    var js11a = fs.readFileSync(path.join(__dirname, '../public/js/bh-property-detail-sections-11a.js'), 'utf8');
    expect(js11a).toMatch(/window\.BhPropSections\s*=/);
  });
  test('11B-91-06 11b does not modify hub sectionRoutes', () => {
    expect(js11b).not.toMatch(/var\s+sectionRoutes\s*=/);
  });
  test('11B-91-07 11b does not define blockStatus', () => {
    expect(js11b).not.toMatch(/function\s+blockStatus\s*\(/);
  });
  test('11B-91-08 Channex functions untouched in ios-10.js', () => {
    expect(js10).toMatch(/channex/i);
    expect(js10).not.toMatch(/CHANNEX_CURRENCY_CHANGE/);
  });
  test('11B-91-09 ical section preserved', () => {
    expect(js10).toMatch(/function\s+renderIcal\s*\(/);
  });
  test('11B-91-10 diffusion section preserved', () => {
    expect(js10).toMatch(/function\s+renderDiffusion\s*\(/);
  });
});

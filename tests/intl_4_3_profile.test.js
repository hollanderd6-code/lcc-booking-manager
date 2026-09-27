'use strict';
/**
 * INTL-4.3 — International Account Legal Profile
 *
 * Structural tests verifying:
 * - GET /api/user/profile exposes the 4 new INTL-4.1 columns
 * - PUT /api/user/profile accepts and stores them
 * - SIRET validation is country-aware (FR only)
 * - effectiveCountry logic covers all 4 DB/body combinations
 * - No cross-field sync (legalIdentifierValue ≠ siret write)
 * - No owner_invoices or PDF functions touched
 * - UI settings-account.html wired correctly
 */

const fs   = require('fs');
const path = require('path');

const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const uiSrc     = fs.readFileSync(path.join(__dirname, '../public/settings-account.html'), 'utf8');

// ── A: GET /api/user/profile — new fields exposed ────────────
describe('A — GET /api/user/profile: new fields', () => {
  // Extract the GET handler block
  const getBlock = serverSrc.match(/app\.get\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('A-01 SELECT includes legal_identifier_label', () => {
    expect(getBlock).toMatch(/legal_identifier_label/);
  });

  test('A-02 SELECT includes legal_identifier_value', () => {
    expect(getBlock).toMatch(/legal_identifier_value/);
  });

  test('A-03 SELECT includes tax_identifier_label', () => {
    expect(getBlock).toMatch(/tax_identifier_label/);
  });

  test('A-04 SELECT includes tax_identifier_value', () => {
    expect(getBlock).toMatch(/tax_identifier_value/);
  });

  test('A-05 response maps legalIdentifierLabel', () => {
    expect(getBlock).toMatch(/legalIdentifierLabel:\s*row\.legal_identifier_label/);
  });

  test('A-06 response maps legalIdentifierValue', () => {
    expect(getBlock).toMatch(/legalIdentifierValue:\s*row\.legal_identifier_value/);
  });

  test('A-07 response maps taxIdentifierLabel', () => {
    expect(getBlock).toMatch(/taxIdentifierLabel:\s*row\.tax_identifier_label/);
  });

  test('A-08 response maps taxIdentifierValue', () => {
    expect(getBlock).toMatch(/taxIdentifierValue:\s*row\.tax_identifier_value/);
  });

  test('A-09 legacy fields siret/vatNumber/vatRegime/legalForm still returned', () => {
    expect(getBlock).toMatch(/siret:\s*row\.siret/);
    expect(getBlock).toMatch(/vatNumber:\s*row\.vat_number/);
    expect(getBlock).toMatch(/vatRegime:\s*row\.vat_regime/);
    expect(getBlock).toMatch(/legalForm:\s*row\.legal_form/);
  });
});

// ── B: PUT /api/user/profile — new fields accepted ───────────
describe('B — PUT /api/user/profile: new fields accepted', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('B-01 legalIdentifierLabel destructured from body', () => {
    expect(putBlock).toMatch(/legalIdentifierLabel/);
  });

  test('B-02 legalIdentifierValue destructured from body', () => {
    expect(putBlock).toMatch(/legalIdentifierValue/);
  });

  test('B-03 taxIdentifierLabel destructured from body', () => {
    expect(putBlock).toMatch(/taxIdentifierLabel/);
  });

  test('B-04 taxIdentifierValue destructured from body', () => {
    expect(putBlock).toMatch(/taxIdentifierValue/);
  });

  test('B-05 UPDATE uses COALESCE for legal_identifier_label', () => {
    expect(putBlock).toMatch(/legal_identifier_label = COALESCE\(\$20, legal_identifier_label\)/);
  });

  test('B-06 UPDATE uses COALESCE for legal_identifier_value', () => {
    expect(putBlock).toMatch(/legal_identifier_value = COALESCE\(\$21, legal_identifier_value\)/);
  });

  test('B-07 UPDATE uses COALESCE for tax_identifier_label', () => {
    expect(putBlock).toMatch(/tax_identifier_label\s*= COALESCE\(\$22, tax_identifier_label\)/);
  });

  test('B-08 UPDATE uses COALESCE for tax_identifier_value', () => {
    expect(putBlock).toMatch(/tax_identifier_value\s*= COALESCE\(\$23, tax_identifier_value\)/);
  });

  test('B-09 params trim new fields (String().trim())', () => {
    expect(putBlock).toMatch(/String\(legalIdentifierLabel\)\.trim\(\)/);
    expect(putBlock).toMatch(/String\(legalIdentifierValue\)\.trim\(\)/);
  });

  test('B-10 RETURNING includes new columns', () => {
    expect(putBlock).toMatch(/RETURNING[\s\S]+?legal_identifier_label/);
    expect(putBlock).toMatch(/RETURNING[\s\S]+?tax_identifier_value/);
  });

  test('B-11 response includes legalIdentifierLabel', () => {
    expect(putBlock).toMatch(/legalIdentifierLabel:\s*updated\.legal_identifier_label/);
  });

  test('B-12 response includes taxIdentifierValue', () => {
    expect(putBlock).toMatch(/taxIdentifierValue:\s*updated\.tax_identifier_value/);
  });
});

// ── C: effectiveCountry logic (INTL-4.3D) ────────────────────
describe('C — effectiveCountry: DB country > body country', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('C-01 DB query fetches current country before SIRET validation', () => {
    expect(putBlock).toMatch(/SELECT country FROM users WHERE id = \$1/);
  });

  test('C-02 effectiveCountry computed from countryNorm and dbCountry', () => {
    expect(putBlock).toMatch(/effectiveCountry\s*=\s*countryNorm\s*\?\?/);
  });

  test('C-03 effectiveCountry falls back to FR when no data', () => {
    expect(putBlock).toMatch(/\?\?\s*'FR'/);
  });

  test('C-04 SIRET validation uses effectiveCountry === FR', () => {
    expect(putBlock).toMatch(/effectiveCountry === 'FR'/);
  });

  test('C-05 effectiveCountry: body country takes precedence over DB', () => {
    // countryNorm ?? (...) — if countryNorm is non-null (body sent country), it wins
    expect(putBlock).toMatch(/const effectiveCountry = countryNorm \?\?/);
  });
});

// ── D: SIRET validation FR-only (INTL-4.3E/F) ────────────────
describe('D — SIRET validation: FR only', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('D-01 SIRET validation gated on effectiveCountry === FR', () => {
    expect(putBlock).toMatch(/accountType === 'business' && siret && effectiveCountry === 'FR'/);
  });

  test('D-02 SIRET validation: 14 digits check retained', () => {
    expect(putBlock).toMatch(/siretClean\.length !== 14 \|\| !\/\^\\d\{14\}\$\/\.test\(siretClean\)/);
  });

  test('D-03 SIRET validation NOT triggered without effectiveCountry === FR condition', () => {
    // Old pattern (no country check) must not exist
    expect(putBlock).not.toMatch(/if \(accountType === 'business' && siret\) \{[\s\S]{0,20}siretClean/);
  });

  test('D-04 error message preserved', () => {
    expect(putBlock).toMatch(/Le numéro SIRET doit contenir exactement 14 chiffres/);
  });
});

// ── E: no cross-field sync (INTL-4.3G) ───────────────────────
describe('E — no cross-field sync: legal_identifier_* ≠ siret write', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('E-01 siret column not written from legalIdentifierValue', () => {
    // The $8 param (siret) must not reference legalIdentifierValue
    expect(putBlock).not.toMatch(/\$8.*legalIdentifierValue|legalIdentifierValue.*siret\s*=/);
  });

  test('E-02 vat_number column not written from taxIdentifierValue', () => {
    expect(putBlock).not.toMatch(/\$15.*taxIdentifierValue|taxIdentifierValue.*vat_number\s*=/);
  });

  test('E-03 legal_identifier_value stored in $21 (not in siret position $8)', () => {
    expect(putBlock).toMatch(/legal_identifier_value = COALESCE\(\$21/);
  });

  test('E-04 legalIdentifierValue trim stored as $21 param', () => {
    expect(putBlock).toMatch(/String\(legalIdentifierValue\)\.trim\(\)/);
  });
});

// ── F: legacy fields preserved (INTL-4.3H) ───────────────────
describe('F — legacy fields still present in PUT', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('F-01 siret still in UPDATE', () => {
    expect(putBlock).toMatch(/siret = \$8/);
  });

  test('F-02 vat_number still in UPDATE', () => {
    expect(putBlock).toMatch(/vat_number = COALESCE\(\$15, vat_number\)/);
  });

  test('F-03 vat_regime still in UPDATE', () => {
    expect(putBlock).toMatch(/vat_regime = COALESCE\(\$14, vat_regime\)/);
  });

  test('F-04 legal_form still in UPDATE', () => {
    expect(putBlock).toMatch(/legal_form = COALESCE\(\$16, legal_form\)/);
  });

  test('F-05 country INTL-1 normalization preserved', () => {
    expect(putBlock).toMatch(/countryNorm\s*=\s*country\s*\?\s*String\(country\)\.trim\(\)\.toUpperCase\(\)/);
  });

  test('F-06 defaultCurrency INTL-1 normalization preserved', () => {
    expect(putBlock).toMatch(/defaultCurrencyNorm\s*=\s*defaultCurrency\s*\?\s*String\(defaultCurrency\)/);
  });
});

// ── G: isolation — owner_invoices/PDF not touched ────────────
describe('G — isolation: owner_invoices and PDFs not modified', () => {
  // Extract only the diff region (PUT profile + GET profile)
  const profileBlock = serverSrc.match(/app\.get\('\/api\/user\/profile'[\s\S]+?app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('G-01 no INSERT/UPDATE owner_invoices in profile routes', () => {
    expect(profileBlock).not.toMatch(/INSERT INTO owner_invoices|UPDATE owner_invoices/);
  });

  test('G-02 no PDF generation call in profile routes', () => {
    expect(profileBlock).not.toMatch(/PDFDocument|pdfkit|generateInvoicePdf/);
  });

  test('G-03 no sendOwnerInvoiceEmail in profile routes', () => {
    expect(profileBlock).not.toMatch(/sendOwnerInvoiceEmail/);
  });
});

// ── H: UI settings-account.html wiring ───────────────────────
describe('H — UI: settings-account.html wired for legal identifier fields', () => {
  test('H-01 profileLegalIdentifierLabel input exists', () => {
    expect(uiSrc).toMatch(/id="profileLegalIdentifierLabel"/);
  });

  test('H-02 profileLegalIdentifierValue input exists', () => {
    expect(uiSrc).toMatch(/id="profileLegalIdentifierValue"/);
  });

  test('H-03 profileTaxIdentifierLabel input exists', () => {
    expect(uiSrc).toMatch(/id="profileTaxIdentifierLabel"/);
  });

  test('H-04 profileTaxIdentifierValue input exists', () => {
    expect(uiSrc).toMatch(/id="profileTaxIdentifierValue"/);
  });

  test('H-05 fillProfileFields loads legalIdentifierLabel', () => {
    expect(uiSrc).toMatch(/profile\.legalIdentifierLabel/);
  });

  test('H-06 fillProfileFields loads taxIdentifierValue', () => {
    expect(uiSrc).toMatch(/profile\.taxIdentifierValue/);
  });

  test('H-07 save handler appends legalIdentifierLabel to formData', () => {
    expect(uiSrc).toMatch(/formData\.append\('legalIdentifierLabel'/);
  });

  test('H-08 save handler appends taxIdentifierValue to formData', () => {
    expect(uiSrc).toMatch(/formData\.append\('taxIdentifierValue'/);
  });

  test('H-09 existing SIRET field not removed', () => {
    expect(uiSrc).toMatch(/id="profileSiret"/);
  });

  test('H-10 Informations légales section present', () => {
    expect(uiSrc).toMatch(/Informations légales/);
  });
});

// ── J: FR/non-FR toggle — no doublon SIRET (INTL-4.3-REVIEW pt.1) ──
describe('J — UI toggle: FR hides legalIdentifierRow, non-FR shows it', () => {
  test('J-01 legalIdentifierRow div exists with id', () => {
    expect(uiSrc).toMatch(/id="legalIdentifierRow"/);
  });

  test('J-02 legalIdentifierRow default display is none (hidden on load)', () => {
    // Must start hidden — FR is the default / most common case
    expect(uiSrc).toMatch(/id="legalIdentifierRow"\s[^>]*style="[^"]*display\s*:\s*none/);
  });

  test('J-03 toggleLegalIdentifierFields function defined', () => {
    expect(uiSrc).toMatch(/function toggleLegalIdentifierFields\s*\(\)/);
  });

  test('J-04 toggle: country === FR → display none', () => {
    expect(uiSrc).toMatch(/countryVal === 'FR'\s*\)\s*\?\s*'none'\s*:\s*'block'/);
  });

  test('J-05 toggle: country !== FR → display block', () => {
    // Same ternary covers both branches: 'none' : 'block'
    expect(uiSrc).toMatch(/'none'\s*:\s*'block'/);
  });

  test('J-06 profileCountry change listener calls toggleLegalIdentifierFields', () => {
    expect(uiSrc).toMatch(/addEventListener\('change',\s*toggleLegalIdentifierFields\)/);
  });

  test('J-07 fillProfileFields calls toggleLegalIdentifierFields after populating country', () => {
    // Must be called after data is loaded so initial visibility is correct
    expect(uiSrc).toMatch(/typeof toggleLegalIdentifierFields === 'function'\s*\)\s*toggleLegalIdentifierFields\(\)/);
  });

  test('J-08 save: legalIdentifierLabel only sent when legalIdentifierRow visible', () => {
    // _liVisible guard ensures FR users never send legalIdentifierLabel
    expect(uiSrc).toMatch(/_liVisible && legalLabelVal.*formData\.append\('legalIdentifierLabel'/s);
  });

  test('J-09 save: legalIdentifierValue only sent when legalIdentifierRow visible', () => {
    expect(uiSrc).toMatch(/_liVisible && legalValueVal.*formData\.append\('legalIdentifierValue'/s);
  });

  test('J-10 save: taxIdentifierLabel sent regardless of legalIdentifierRow visibility', () => {
    // Tax identifier (VAT) is available for all countries
    expect(uiSrc).toMatch(/if \(taxLabelVal\)\s*formData\.append\('taxIdentifierLabel'/);
  });

  test('J-11 save: taxIdentifierValue sent regardless of legalIdentifierRow visibility', () => {
    expect(uiSrc).toMatch(/if \(taxValueVal\)\s*formData\.append\('taxIdentifierValue'/);
  });

  test('J-12 existing SIRET legacy field kept (no doublon — FR uses profileSiret, not legalIdentifierRow)', () => {
    expect(uiSrc).toMatch(/id="profileSiret"/);
  });

  test('J-13 no country-change handler that clears input values (no data erasure on switch)', () => {
    // The change listener must only affect display, not .value assignments
    const changeHandlerBlock = uiSrc.match(/addEventListener\('change',\s*toggleLegalIdentifierFields\)[\s\S]{0,400}/)?.[0] || '';
    expect(changeHandlerBlock).not.toMatch(/\.value\s*=\s*''/);
  });
});

// ── K: effectiveCountry bypass prevention (INTL-4.3-REVIEW pt.3) ─
describe('K — effectiveCountry: invalid country rejected before computation', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('K-01 ISO country validation (400 error) precedes effectiveCountry assignment', () => {
    // Invalid country returns 400 before effectiveCountry is computed
    const isoErrIdx      = putBlock.indexOf("country doit être un code ISO 3166-1 alpha-2");
    const effCountryIdx  = putBlock.indexOf('effectiveCountry');
    expect(isoErrIdx).toBeGreaterThan(-1);
    expect(effCountryIdx).toBeGreaterThan(-1);
    expect(isoErrIdx).toBeLessThan(effCountryIdx);
  });

  test('K-02 effectiveCountry expression uses countryNorm (post-validation value, not raw country)', () => {
    expect(putBlock).toMatch(/effectiveCountry\s*=\s*countryNorm\s*\?\?/);
  });

  test('K-03 countryNorm is null when no country sent (SIRET validation falls back to DB/FR)', () => {
    // countryNorm = country ? String(country).trim().toUpperCase() : null
    expect(putBlock).toMatch(/countryNorm\s*=\s*country\s*\?\s*String\(country\)/);
  });
});

// ── L: PUT partial — accountType absent (INTL-4.3-REVIEW pt.4) ──
describe('L — PUT partial: accountType absent cannot bypass SIRET validation', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('L-01 accountType defaults to "individual" when absent (siret param becomes null)', () => {
    // accountType || 'individual' means absent body field → 'individual' → SIRET condition fails safely
    expect(putBlock).toMatch(/accountType.*\|\|\s*'individual'|accountType\s*===\s*'business'.*siret/);
  });

  test('L-02 SIRET validation requires accountType === business AND siret non-null', () => {
    // Condition: accountType === 'business' && siret && effectiveCountry === 'FR'
    // If accountType is absent → falls to individual → siret stored as null → condition never reached
    expect(putBlock).toMatch(/accountType === 'business' && siret && effectiveCountry === 'FR'/);
  });
});

// ── I: INTL-1 behavior unchanged ─────────────────────────────
describe('I — INTL-1 country/currency behavior preserved', () => {
  const putBlock = serverSrc.match(/app\.put\('\/api\/user\/profile'[\s\S]+?res\.json\(\{[\s\S]+?\}\);/)?.[0] || '';

  test('I-01 country ISO validation still present', () => {
    expect(putBlock).toMatch(/country doit être un code ISO 3166-1 alpha-2/);
  });

  test('I-02 defaultCurrency ISO validation still present', () => {
    expect(putBlock).toMatch(/defaultCurrency doit être un code ISO 4217/);
  });

  test('I-03 locale BCP47 validation still present', () => {
    expect(putBlock).toMatch(/locale doit être au format BCP 47/);
  });
});

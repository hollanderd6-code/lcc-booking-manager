'use strict';
/**
 * PMS-INTL-2 — Property Currency + Web Calendar Implementation
 *
 * Structural tests covering:
 * A.  money-formatter.js — fmtMoneyCompact + getCurrencySymbol present
 * B.  server.js — GET /api/pricing/calendar exposes currency per property
 * C.  settings.html — propertyCurrency selector with all 8 currencies incl. ILS
 * D.  settings.html — price spans carry class prop-cur (dynamic symbol update)
 * E.  settings.js — helper functions present (updatePropertyCurrencySymbols, onPropertyCurrencyChange)
 * F.  settings.js — openEditPropertyModal loads currency
 * G.  settings.js — openAddPropertyModal seeds currency from userProfile
 * H.  settings.js — duplicateProperty copies currency
 * I.  settings.js — saveProperty appends currency to FormData
 * J.  app.html — property model mapping includes currency
 * K.  app.html — initial cell render uses fmtMoneyCompact
 * L.  app.html — applyPricingRulesToCells uses fmtMoneyCompact
 * M.  app.html — applyPricingOverridesFromCache uses fmtMoneyCompact
 * N.  app.html — saveCellPrice uses fmtMoneyCompact
 * O.  app.html — saveCellPrice toast uses fmtMoney
 * P.  app.html — reservation priceFormatted uses fmtMoney
 * Q.  app.html — fmtAmount uses fmtMoney(currency)
 * R.  app.html — money-formatter.js loaded
 * S.  settings.html — money-formatter.js loaded
 * T.  Scope protection — no currency column added to pricing_overrides / pricing_rules / daily rows
 *
 * PMS-INTL-2-FIX-1 — Live blockModal "Prix" tab currency label:
 * U.  app.html — dayPriceCurrencySymbol span present in label
 * V.  app.html — updateDayPriceCurrencySymbol helper structure
 * W.  app.html — change listener wired to dayPricePropertySelect
 * X.  app.html — openBlockModal calls updateDayPriceCurrencySymbol after pre-selection
 */

const fs   = require('fs');
const path = require('path');

const srv    = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const app    = fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8');
const shtml  = fs.readFileSync(path.join(__dirname, '../public/settings.html'), 'utf8');
const sjs    = fs.readFileSync(path.join(__dirname, '../public/js/settings.js'), 'utf8');
const mf     = fs.readFileSync(path.join(__dirname, '../public/js/money-formatter.js'), 'utf8');

// ── Extract blocks ────────────────────────────────────────────────────────────

const calendarRouteBlock = srv.match(
  /app\.get\('\/api\/pricing\/calendar'[\s\S]+?^\}\);/m
)?.[0] || '';

const savePropertyFn = sjs.match(
  /async function saveProperty[\s\S]+?^\}/m
)?.[0] || '';

const editPropertyFn = sjs.match(
  /function openEditPropertyModal[\s\S]+?^\}/m
)?.[0] || '';

const addPropertyFn = sjs.match(
  /function openAddPropertyModal[\s\S]+?^\}/m
)?.[0] || '';

const duplicateFn = sjs.match(
  /function duplicateProperty[\s\S]+?^\}/m
)?.[0] || '';

const overridesBlock = app.match(
  /window\.applyPricingOverridesFromCache[\s\S]+?^\};/m
)?.[0] || '';

const rulesBlock = app.match(
  /window\.applyPricingRulesToCells[\s\S]+?^\};/m
)?.[0] || '';

const saveCellBlock = app.match(
  /window\.saveCellPrice\s*=\s*async function[\s\S]+?Ouvrir le modal de blocage/
)?.[0] || '';

const openCellBlock = app.match(
  /window\.openCellModal[\s\S]+?^\};/m
)?.[0] || '';

const bookingDetailBlock = app.match(
  /const currency\s*=\s*booking\.currency[\s\S]+?function fmtAmount[\s\S]+?\}/
)?.[0] || '';

// ─────────────────────────────────────────────────────────────────────────────
// A. money-formatter.js — new functions
// ─────────────────────────────────────────────────────────────────────────────
describe('A. money-formatter.js — getCurrencySymbol + fmtMoneyCompact', () => {
  test('A-01: getCurrencySymbol function defined', () => {
    expect(mf).toMatch(/function getCurrencySymbol/);
  });

  test('A-02: getCurrencySymbol uses Intl.NumberFormat narrowSymbol', () => {
    expect(mf).toMatch(/narrowSymbol/);
  });

  test('A-03: fmtMoneyCompact function defined', () => {
    expect(mf).toMatch(/function fmtMoneyCompact/);
  });

  test('A-04: fmtMoneyCompact sets maximumFractionDigits to 0', () => {
    expect(mf).toMatch(/maximumFractionDigits:\s*0/);
  });

  test('A-05: fmtMoneyCompact uses narrowSymbol', () => {
    const compactFn = mf.match(/function fmtMoneyCompact[\s\S]+?\}/)?.[0] || '';
    expect(compactFn).toMatch(/narrowSymbol/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. server.js — calendar API exposes currency
// ─────────────────────────────────────────────────────────────────────────────
describe('B. GET /api/pricing/calendar — currency per property', () => {
  test('B-01: route block found', () => {
    expect(calendarRouteBlock.length).toBeGreaterThan(100);
  });

  test('B-02: result[pid] includes currency field', () => {
    expect(calendarRouteBlock).toMatch(/currency:\s*prop\.currency\s*\|\|\s*['"]EUR['"]/);
  });

  test('B-03: currency uses prop (in-memory cache), not a DB join', () => {
    // The currency must come from the already-loaded prop object, not from a raw SQL alias
    const resultAssignment = calendarRouteBlock.match(/result\[pid\]\s*=\s*\{[\s\S]+?\};/)?.[0] || '';
    expect(resultAssignment).toMatch(/currency/);
    expect(resultAssignment).not.toMatch(/\.currency\s*AS\s/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. settings.html — currency selector
// ─────────────────────────────────────────────────────────────────────────────
describe('C. settings.html — propertyCurrency selector', () => {
  test('C-01: propertyCurrency select element exists', () => {
    expect(shtml).toMatch(/id="propertyCurrency"/);
  });

  test('C-02: ILS option present', () => {
    expect(shtml).toMatch(/<option value="ILS">/);
  });

  test('C-03: EUR option present', () => {
    expect(shtml).toMatch(/<option value="EUR">/);
  });

  test('C-04: 8 currency options total', () => {
    const opts = shtml.match(/<option value="[A-Z]{3}">/g) || [];
    // settings-account.html has its own selector; check settings.html contains at least 8 in the propertyCurrency block
    const block = shtml.match(/id="propertyCurrency"[\s\S]+?<\/select>/)?.[0] || '';
    const blockOpts = block.match(/<option value="[A-Z]{3}">/g) || [];
    expect(blockOpts.length).toBeGreaterThanOrEqual(8);
  });

  test('C-05: currency change calls onPropertyCurrencyChange', () => {
    expect(shtml).toMatch(/onchange="onPropertyCurrencyChange\(\)"/);
  });

  test('C-06: currency-change warning div present', () => {
    expect(shtml).toMatch(/id="propertyCurrencyWarning"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. settings.html — dynamic price label spans
// ─────────────────────────────────────────────────────────────────────────────
describe('D. settings.html — prop-cur class on price spans', () => {
  test('D-01: at least 5 spans carry class prop-cur', () => {
    const propCurSpans = shtml.match(/class="prop-cur"/g) || [];
    expect(propCurSpans.length).toBeGreaterThanOrEqual(5);
  });

  test('D-02: deposit span has class prop-cur', () => {
    const depositBlock = shtml.match(/id="propertyDeposit"[\s\S]{0,200}/)?.[0] || '';
    expect(depositBlock).toMatch(/class="prop-cur"/);
  });

  test('D-03: base-price span has class prop-cur', () => {
    const bpBlock = shtml.match(/id="propertyBasePrice"[\s\S]{0,200}/)?.[0] || '';
    expect(bpBlock).toMatch(/class="prop-cur"/);
  });

  test('D-04: weekend-price span has class prop-cur', () => {
    const wpBlock = shtml.match(/id="propertyWeekendPrice"[\s\S]{0,200}/)?.[0] || '';
    expect(wpBlock).toMatch(/class="prop-cur"/);
  });

  test('D-05: tourist-tax span uses data-suffix', () => {
    const ttBlock = shtml.match(/id="propertyTouristTax"[\s\S]{0,200}/)?.[0] || '';
    expect(ttBlock).toMatch(/data-suffix/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. settings.js — helper functions
// ─────────────────────────────────────────────────────────────────────────────
describe('E. settings.js — currency helpers', () => {
  test('E-01: updatePropertyCurrencySymbols defined', () => {
    expect(sjs).toMatch(/function updatePropertyCurrencySymbols/);
  });

  test('E-02: updatePropertyCurrencySymbols iterates .prop-cur', () => {
    const fn = sjs.match(/function updatePropertyCurrencySymbols[\s\S]+?\}/)?.[0] || '';
    expect(fn).toMatch(/\.prop-cur/);
  });

  test('E-03: updatePropertyCurrencySymbols respects data-suffix', () => {
    const fn = sjs.match(/function updatePropertyCurrencySymbols[\s\S]+?\}/)?.[0] || '';
    expect(fn).toMatch(/data[-.]suffix|dataset\.suffix/);
  });

  test('E-04: onPropertyCurrencyChange defined', () => {
    expect(sjs).toMatch(/function onPropertyCurrencyChange/);
  });

  test('E-05: onPropertyCurrencyChange calls updatePropertyCurrencySymbols', () => {
    const fn = sjs.match(/function onPropertyCurrencyChange[\s\S]+?\}/)?.[0] || '';
    expect(fn).toMatch(/updatePropertyCurrencySymbols/);
  });

  test('E-06: getCurrencySymbol NOT re-defined in settings.js (lives in money-formatter.js)', () => {
    expect(sjs).not.toMatch(/function getCurrencySymbol/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. settings.js — openEditPropertyModal loads currency
// ─────────────────────────────────────────────────────────────────────────────
describe('F. settings.js — openEditPropertyModal loads currency', () => {
  test('F-01: sets propertyCurrency value', () => {
    expect(editPropertyFn).toMatch(/propertyCurrency/);
  });

  test('F-02: calls updatePropertyCurrencySymbols', () => {
    expect(editPropertyFn).toMatch(/updatePropertyCurrencySymbols/);
  });

  test('F-03: hides warning on open (not a change event)', () => {
    expect(editPropertyFn).toMatch(/propertyCurrencyWarning[\s\S]{0,100}display.*none|none[\s\S]{0,100}propertyCurrencyWarning/);
  });

  test('F-04: reads property.currency with EUR fallback', () => {
    expect(editPropertyFn).toMatch(/property\.currency\s*\|\|\s*['"]EUR['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. settings.js — openAddPropertyModal seeds currency
// ─────────────────────────────────────────────────────────────────────────────
describe('G. settings.js — openAddPropertyModal seeds currency', () => {
  test('G-01: reads from userProfile.defaultCurrency', () => {
    expect(addPropertyFn).toMatch(/userProfile.*defaultCurrency|defaultCurrency.*userProfile/);
  });

  test('G-02: calls updatePropertyCurrencySymbols', () => {
    expect(addPropertyFn).toMatch(/updatePropertyCurrencySymbols/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. settings.js — duplicateProperty copies currency
// ─────────────────────────────────────────────────────────────────────────────
describe('H. settings.js — duplicateProperty copies currency', () => {
  test('H-01: reads property.currency', () => {
    expect(duplicateFn).toMatch(/property\.currency/);
  });

  test('H-02: calls updatePropertyCurrencySymbols', () => {
    expect(duplicateFn).toMatch(/updatePropertyCurrencySymbols/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// I. settings.js — saveProperty appends currency
// ─────────────────────────────────────────────────────────────────────────────
describe('I. settings.js — saveProperty appends currency', () => {
  test('I-01: reads propertyCurrency element', () => {
    expect(savePropertyFn).toMatch(/propertyCurrency/);
  });

  test('I-02: appends currency to formData', () => {
    expect(savePropertyFn).toMatch(/formData\.append\(['"]currency['"]/);
  });

  test('I-03: falls back to EUR', () => {
    const currencyLine = savePropertyFn.match(/propertyCurrency[\s\S]{0,100}EUR/)?.[0] || '';
    expect(currencyLine).toMatch(/EUR/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J. app.html — property model includes currency
// ─────────────────────────────────────────────────────────────────────────────
describe('J. app.html — property model mapping', () => {
  test('J-01: state.properties mapping includes currency', () => {
    const propMap = app.match(/state\.properties\s*=\s*properties\.map[\s\S]+?\}\)/)?.[0] || '';
    expect(propMap).toMatch(/currency:\s*p\.currency/);
  });

  test('J-02: currency falls back to EUR', () => {
    const propMap = app.match(/state\.properties\s*=\s*properties\.map[\s\S]+?\}\)/)?.[0] || '';
    expect(propMap).toMatch(/p\.currency\s*\|\|\s*['"]EUR['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K. app.html — initial cell render uses fmtMoneyCompact
// ─────────────────────────────────────────────────────────────────────────────
describe('K. app.html — initial cell render', () => {
  test('K-01: priceEl uses fmtMoneyCompact not raw Math.round', () => {
    const cellRender = app.match(/priceEl\.textContent\s*=\s*fmtMoneyCompact[\s\S]{0,200}basePrice/)?.[0] || '';
    expect(cellRender).toMatch(/fmtMoneyCompact/);
  });

  test('K-02: passes prop.currency to fmtMoneyCompact', () => {
    const cellRender = app.match(/fmtMoneyCompact\(Math\.round[\s\S]{0,100}prop\.currency/)?.[0] || '';
    expect(cellRender).not.toBeNull();
    expect(cellRender.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// L. app.html — applyPricingRulesToCells uses fmtMoneyCompact
// ─────────────────────────────────────────────────────────────name────────────
describe('L. app.html — applyPricingRulesToCells', () => {
  test('L-01: block found', () => {
    expect(rulesBlock.length).toBeGreaterThan(100);
  });

  test('L-02: uses fmtMoneyCompact for rule price display', () => {
    expect(rulesBlock).toMatch(/fmtMoneyCompact/);
  });

  test('L-03: passes prop.currency', () => {
    expect(rulesBlock).toMatch(/prop\.currency/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M. app.html — applyPricingOverridesFromCache uses fmtMoneyCompact
// ─────────────────────────────────────────────────────────────────────────────
describe('M. app.html — applyPricingOverridesFromCache', () => {
  test('M-01: block found', () => {
    expect(overridesBlock.length).toBeGreaterThan(100);
  });

  test('M-02: uses fmtMoneyCompact', () => {
    expect(overridesBlock).toMatch(/fmtMoneyCompact/);
  });

  test('M-03: looks up _cur from LCC_PROPERTIES', () => {
    expect(overridesBlock).toMatch(/LCC_PROPERTIES/);
    expect(overridesBlock).toMatch(/_cur/);
  });

  test('M-04: no raw Math.round without fmtMoneyCompact in display assignments', () => {
    // Every textContent assignment in the overrides block must use fmtMoneyCompact
    const rawAssignments = overridesBlock.match(/\.textContent\s*=\s*Math\.round/g) || [];
    expect(rawAssignments.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// N. app.html — saveCellPrice cell text uses fmtMoneyCompact
// ─────────────────────────────────────────────────────────────────────────────
describe('N. app.html — saveCellPrice cell display', () => {
  test('N-01: block found', () => {
    expect(saveCellBlock.length).toBeGreaterThan(100);
  });

  test('N-02: uses fmtMoneyCompact', () => {
    expect(saveCellBlock).toMatch(/fmtMoneyCompact/);
  });

  test('N-03: no raw priceToSend as textContent', () => {
    // Must not assign bare priceToSend (integer) to textContent
    const bare = saveCellBlock.match(/\.textContent\s*=\s*priceToSend[^)]/g) || [];
    expect(bare.length).toBe(0);
  });

  test('N-04: looks up _saveCur from LCC_PROPERTIES', () => {
    expect(saveCellBlock).toMatch(/_saveCur/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O. app.html — saveCellPrice toast uses fmtMoney
// ─────────────────────────────────────────────────────────────────────────────
describe('O. app.html — saveCellPrice toast', () => {
  test('O-01: toast uses fmtMoney not raw + €', () => {
    const toastLine = saveCellBlock.match(/showToast[\s\S]{0,300}enregistré/)?.[0] || '';
    expect(toastLine).toMatch(/fmtMoney/);
    expect(toastLine).not.toMatch(/priceToSend\s*\+\s*['"]€['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P. app.html — reservation priceFormatted uses fmtMoney
// ─────────────────────────────────────────────────────────────────────────────
describe('P. app.html — reservation priceFormatted', () => {
  test('P-01: priceFormatted uses fmtMoney', () => {
    const priceFmt = app.match(/const priceFormatted\s*=[\s\S]{0,200}/)?.[0] || '';
    expect(priceFmt).toMatch(/fmtMoney/);
  });

  test('P-02: priceFormatted does NOT use toLocaleString + € literal', () => {
    const priceFmt = app.match(/const priceFormatted\s*=[\s\S]{0,200}/)?.[0] || '';
    expect(priceFmt).not.toMatch(/toLocaleString[\s\S]{0,50}['"]€['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Q. app.html — fmtAmount uses fmtMoney(currency)
// ─────────────────────────────────────────────────────────────────────────────
describe('Q. app.html — fmtAmount uses booking currency', () => {
  test('Q-01: fmtAmount calls fmtMoney', () => {
    expect(bookingDetailBlock).toMatch(/function fmtAmount[\s\S]+?fmtMoney/);
  });

  test('Q-02: fmtAmount passes currency variable not hardcoded EUR', () => {
    const fmtAmountFn = app.match(/function fmtAmount[\s\S]+?\}/)?.[0] || '';
    expect(fmtAmountFn).toMatch(/fmtMoney\(Number\(val\),\s*currency\)/);
  });

  test('Q-03: fmtAmount does NOT hardcode € literal', () => {
    const fmtAmountFn = app.match(/function fmtAmount[\s\S]+?\}/)?.[0] || '';
    expect(fmtAmountFn).not.toMatch(/['"]€['"]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R. app.html — money-formatter.js loaded
// ─────────────────────────────────────────────────────────────────────────────
describe('R. app.html — money-formatter.js script tag', () => {
  test('R-01: money-formatter.js is loaded in app.html', () => {
    expect(app).toMatch(/src="\/js\/money-formatter\.js"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S. settings.html — money-formatter.js loaded
// ─────────────────────────────────────────────────────────────────────────────
describe('S. settings.html — money-formatter.js script tag', () => {
  test('S-01: money-formatter.js is loaded in settings.html', () => {
    expect(shtml).toMatch(/src="\/js\/money-formatter\.js"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T. Scope protection — no currency leakage into pricing tables
// ─────────────────────────────────────────────────────────────────────────────
describe('T. Scope protection — no currency column in pricing tables', () => {
  test('T-01: CREATE TABLE pricing_overrides has no currency column', () => {
    const tbl = srv.match(/CREATE TABLE IF NOT EXISTS pricing_overrides[\s\S]+?\);/)?.[0] || '';
    expect(tbl.length).toBeGreaterThan(50);
    expect(tbl).not.toMatch(/\bcurrency\b/i);
  });

  test('T-02: INSERT INTO pricing_overrides has no currency', () => {
    const ins = srv.match(/INSERT INTO pricing_overrides[\s\S]{0,300}/)?.[0] || '';
    expect(ins).not.toMatch(/currency/i);
  });

  test('T-03: CREATE TABLE pricing_rules has no currency column', () => {
    const tbl = srv.match(/CREATE TABLE IF NOT EXISTS pricing_rules[\s\S]+?\);/)?.[0] || '';
    expect(tbl.length).toBeGreaterThan(50);
    expect(tbl).not.toMatch(/\bcurrency\b/i);
  });

  test('T-04: no ALTER TABLE adding currency to pricing_overrides or pricing_rules', () => {
    const alters = srv.match(/ALTER TABLE pricing_(?:overrides|rules)[\s\S]{0,200}/g) || [];
    alters.forEach(a => {
      expect(a).not.toMatch(/ADD COLUMN.+currency/i);
    });
  });

  test('T-05: no FX conversion — no exchange rate or multiply-by-rate pattern', () => {
    const fxPatterns = [
      /exchange_rate/i,
      /convert_currency/i,
      /fxRate/i,
    ];
    fxPatterns.forEach(re => {
      expect(srv).not.toMatch(re);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX-1 extraction blocks
// ─────────────────────────────────────────────────────────────────────────────

const blockModalScript = app.match(
  /\/\/ Script complet pour le blocage de dates[\s\S]+?window\.switchBlockTab\s*=\s*switchBlockTab/
)?.[0] || '';

const updateSymbolFn = blockModalScript.match(
  /function updateDayPriceCurrencySymbol[\s\S]+?(?=\n\n\s*\/\/ Remplir la liste)/
)?.[0] || '';

const openBlockModalFn = app.match(
  /window\.openBlockModal\s*=\s*function openBlockModal[\s\S]+?\};/
)?.[0] || '';

const domContentLoadedBlock = blockModalScript.match(
  /document\.addEventListener\('DOMContentLoaded'[\s\S]+?\}\);/
)?.[0] || '';

// ─────────────────────────────────────────────────────────────────────────────
// U. app.html — FIX-1: dayPriceCurrencySymbol span in label
// ─────────────────────────────────────────────────────────────────────────────
describe('U. app.html — FIX-1: dayPriceCurrencySymbol span in Prix label', () => {
  test('U-01: span#dayPriceCurrencySymbol exists in app.html', () => {
    expect(app).toMatch(/id="dayPriceCurrencySymbol"/);
  });

  test('U-02: span is inside the dayPriceValue label', () => {
    const labelBlock = app.match(/<label for="dayPriceValue">[\s\S]{0,200}<\/label>/)?.[0] || '';
    expect(labelBlock).toMatch(/id="dayPriceCurrencySymbol"/);
  });

  test('U-03: label no longer contains a bare hardcoded € symbol (must use span)', () => {
    const labelBlock = app.match(/<label for="dayPriceValue">[\s\S]{0,200}<\/label>/)?.[0] || '';
    // The € character must be INSIDE the span, not bare text in the label
    const bareEuro = labelBlock.replace(/<span[^>]*>[^<]*<\/span>/g, '');
    expect(bareEuro).not.toMatch(/€/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// V. app.html — FIX-1: updateDayPriceCurrencySymbol helper
// ─────────────────────────────────────────────────────────────────────────────
describe('V. app.html — FIX-1: updateDayPriceCurrencySymbol function', () => {
  test('V-01: function defined inside block modal script', () => {
    expect(blockModalScript).toMatch(/function updateDayPriceCurrencySymbol/);
  });

  test('V-02: reads dayPricePropertySelect element', () => {
    expect(updateSymbolFn).toMatch(/dayPricePropertySelect/);
  });

  test('V-03: looks up window.LCC_PROPERTIES', () => {
    expect(updateSymbolFn).toMatch(/LCC_PROPERTIES/);
  });

  test('V-04: reads property.currency with EUR fallback', () => {
    expect(updateSymbolFn).toMatch(/\.currency.*\|\|.*['"]EUR['"]|['"]EUR['"].*\.currency/);
  });

  test('V-05: calls getCurrencySymbol', () => {
    expect(updateSymbolFn).toMatch(/getCurrencySymbol/);
  });

  test('V-06: updates dayPriceCurrencySymbol.textContent', () => {
    expect(updateSymbolFn).toMatch(/dayPriceCurrencySymbol/);
    expect(updateSymbolFn).toMatch(/\.textContent\s*=/);
  });

  test('V-07: accepts fallbackPid parameter', () => {
    expect(updateSymbolFn).toMatch(/function updateDayPriceCurrencySymbol\s*\(\s*fallbackPid\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W. app.html — FIX-1: change listener wired to dayPricePropertySelect
// ─────────────────────────────────────────────────────────────────────────────
describe('W. app.html — FIX-1: change event listener on dayPricePropertySelect', () => {
  test('W-01: DOMContentLoaded wires change listener to dayPricePropertySelect', () => {
    expect(domContentLoadedBlock).toMatch(/dayPricePropertySelect/);
    expect(domContentLoadedBlock).toMatch(/addEventListener\s*\(\s*['"]change['"]/);
  });

  test('W-02: change handler calls updateDayPriceCurrencySymbol', () => {
    const changeHandler = domContentLoadedBlock.match(
      /dayPricePropertySelect[\s\S]{0,300}updateDayPriceCurrencySymbol|updateDayPriceCurrencySymbol[\s\S]{0,300}dayPricePropertySelect/
    )?.[0] || '';
    expect(changeHandler.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// X. app.html — FIX-1: openBlockModal calls updateDayPriceCurrencySymbol
// ─────────────────────────────────────────────────────────────────────────────
describe('X. app.html — FIX-1: openBlockModal calls updateDayPriceCurrencySymbol', () => {
  test('X-01: openBlockModal block found', () => {
    expect(openBlockModalFn.length).toBeGreaterThan(100);
  });

  test('X-02: openBlockModal calls updateDayPriceCurrencySymbol', () => {
    expect(openBlockModalFn).toMatch(/updateDayPriceCurrencySymbol/);
  });

  test('X-03: call passes propertyId as fallback', () => {
    expect(openBlockModalFn).toMatch(/updateDayPriceCurrencySymbol\s*\(\s*propertyId\s*\)/);
  });

  test('X-04: call appears AFTER the dayPricePropertySelect pre-selection line', () => {
    const preSelectIdx = openBlockModalFn.indexOf('dayPricePropertySelect');
    const updateIdx    = openBlockModalFn.indexOf('updateDayPriceCurrencySymbol');
    expect(preSelectIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(preSelectIdx);
  });
});

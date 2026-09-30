'use strict';
/**
 * BACKEND-INVOICE-CREATE-FIX-01 — Regression test
 *
 * Verifies that propResult is declared in the OUTER scope of POST /api/invoice/create
 * (not inside the inner try block), so that the resolvedCurrency derivation at line
 * ~28103 cannot throw "ReferenceError: propResult is not defined".
 *
 * Also exercises the normalizeCurrency helper and the currency authority chain:
 *   reservation_currency → property_currency → 'EUR'
 *
 * Pure static analysis — no DB connection required.
 * Run with: node tests/backend_invoice_create_fix.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0;
let failed = 0;

function ok(val, label) {
  if (val) {
    console.log('  ✅ ' + label);
    passed++;
  } else {
    console.error('  ❌ ' + label);
    failed++;
  }
}

const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Extract the POST /api/invoice/create handler block
// The block ends at the first top-level '});' after the route definition
const createRouteMatch = src.match(/app\.post\('\/api\/invoice\/create'[\s\S]+?^\}\);/m);
assert.ok(createRouteMatch, 'POST /api/invoice/create must exist in server.js');
const createBlock = createRouteMatch[0];

// normalizeCurrency lives in routes/market-data-resolver.js (imported into server.js)
const { normalizeCurrency } = require('../routes/market-data-resolver');
assert.strictEqual(typeof normalizeCurrency, 'function', 'normalizeCurrency must be a function');

console.log('\n── A. SCOPE FIX: propResult declared outside inner try block ────────────');

// The agency resolution section pattern:
//   let billingUserId = ...
//   let ownerInfo = ...
//   let _resolvedPropertyId = ...
//   let propResult = { rows: [] };   ← must be HERE (outer scope)
//   try {
//     ...
//     [NO "let propResult" inside]
//     ...
//   } catch(e) { ... }
//
// Before the fix: "let propResult = { rows: [] };" was INSIDE the try { }.
// After the fix: it appears BEFORE the try { } in the outer scope.

// Test A-01: propResult is declared at the route handler level (not inside try)
{
  // Find the block that contains billingUserId + propResult + try
  const agencyBlock = createBlock.match(
    /let billingUserId[\s\S]+?let propResult[\s\S]+?try \{[\s\S]+?\} catch\(e\) \{[\s\S]+?\}/
  )?.[0] || '';
  ok(agencyBlock.length > 0, 'A-01 agency resolution block found');

  // The declaration "let propResult = { rows: [] };" must appear BEFORE "try {"
  const propDeclIdx = agencyBlock.indexOf('let propResult = { rows: [] };');
  const tryIdx      = agencyBlock.indexOf('try {');
  ok(propDeclIdx !== -1, 'A-02 "let propResult = { rows: [] };" present');
  ok(tryIdx      !== -1, 'A-03 "try {" present in agency block');
  ok(propDeclIdx < tryIdx, 'A-04 propResult declared BEFORE try { (scope fix confirmed)');
}

// Test A-05: no second "let propResult" inside the try block
{
  // Extract only the try { ... } part of the agency block
  const tryBlock = createBlock.match(
    /let propResult = \{ rows: \[\] \};\s*try \{([\s\S]+?)\} catch\(e\) \{/
  )?.[1] || '';
  ok(tryBlock.length > 0, 'A-05 inner try block body extracted');
  const innerLetPropResult = tryBlock.includes('let propResult');
  ok(!innerLetPropResult, 'A-06 no "let propResult" inside the try body (no redeclaration)');
}

console.log('\n── B. CURRENCY AUTHORITY CHAIN: resolvedCurrency derivation ─────────────');

// Test B-01: resolvedCurrency uses reservation_currency first
ok(
  createBlock.includes('normalizeCurrency(propResult?.rows[0]?.reservation_currency)'),
  'B-01 resolvedCurrency checks reservation_currency first'
);

// Test B-02: resolvedCurrency falls back to property_currency
ok(
  createBlock.includes('normalizeCurrency(propResult?.rows[0]?.property_currency)'),
  'B-02 resolvedCurrency falls back to property_currency'
);

// Test B-03: EUR is the final fallback
ok(
  /resolvedCurrency\s*=.*\|\|\s*['"]EUR['"]/.test(createBlock),
  "B-03 resolvedCurrency final fallback is 'EUR'"
);

// Test B-04: resolvedCurrency declared AFTER the try/catch (correct position)
{
  const tryCatchEnd  = createBlock.indexOf("} catch(e) {\n      console.error('Erreur résolution propriétaire");
  const resolvedLine = createBlock.indexOf('const resolvedCurrency');
  ok(tryCatchEnd !== -1, 'B-04a try/catch block found for agency resolution');
  ok(resolvedLine > tryCatchEnd, 'B-04b resolvedCurrency declared after the try/catch closes');
}

console.log('\n── C. normalizeCurrency helper — unit tests ─────────────────────────────');

// Test C-01: EUR is valid
ok(normalizeCurrency('EUR') === 'EUR', 'C-01 normalizeCurrency("EUR") → "EUR"');

// Test C-02: ILS is valid (non-EUR currency)
ok(normalizeCurrency('ILS') === 'ILS', 'C-02 normalizeCurrency("ILS") → "ILS"');

// Test C-03: lowercase is normalized to uppercase
ok(normalizeCurrency('eur') === 'EUR', 'C-03 normalizeCurrency("eur") → "EUR"');

// Test C-04: null returns null (triggers fallback)
ok(normalizeCurrency(null) === null, 'C-04 normalizeCurrency(null) → null');

// Test C-05: undefined returns null
ok(normalizeCurrency(undefined) === null, 'C-05 normalizeCurrency(undefined) → null');

// Test C-06: invalid code returns null
ok(normalizeCurrency('EU') === null, 'C-06 normalizeCurrency("EU") → null (2 chars)');
ok(normalizeCurrency('EURO') === null, 'C-07 normalizeCurrency("EURO") → null (4 chars)');

console.log('\n── D. resolvedCurrency logic — simulated scenarios ──────────────────────');

// Simulate the resolvedCurrency derivation with various propResult values

function simulateResolvedCurrency(reservationCurrency, propertyCurrency) {
  const propResult = {
    rows: [{
      reservation_currency: reservationCurrency,
      property_currency:    propertyCurrency,
    }]
  };
  return normalizeCurrency(propResult?.rows[0]?.reservation_currency)
      || normalizeCurrency(propResult?.rows[0]?.property_currency)
      || 'EUR';
}

function simulateResolvedCurrencyNoProperty() {
  const propResult = { rows: [] };
  return normalizeCurrency(propResult?.rows[0]?.reservation_currency)
      || normalizeCurrency(propResult?.rows[0]?.property_currency)
      || 'EUR';
}

// D-01: reservation_currency takes priority over property_currency
ok(simulateResolvedCurrency('ILS', 'EUR') === 'ILS',
   'D-01 reservation_currency=ILS beats property_currency=EUR → ILS');

// D-02: property_currency used when reservation_currency is null
ok(simulateResolvedCurrency(null, 'ILS') === 'ILS',
   'D-02 reservation_currency=null, property_currency=ILS → ILS');

// D-03: EUR fallback when both are null
ok(simulateResolvedCurrency(null, null) === 'EUR',
   'D-03 both null → EUR fallback');

// D-04: EUR property, EUR reservation → EUR
ok(simulateResolvedCurrency('EUR', 'EUR') === 'EUR',
   'D-04 both EUR → EUR');

// D-05: no property found (propResult.rows empty) → EUR fallback
ok(simulateResolvedCurrencyNoProperty() === 'EUR',
   'D-05 no property row → EUR fallback');

// D-06: reservation_currency EUR, property_currency ILS → EUR (resa wins)
ok(simulateResolvedCurrency('EUR', 'ILS') === 'EUR',
   'D-06 reservation_currency=EUR beats property_currency=ILS → EUR');

console.log('\n── E. agency=all scope ───────────────────────────────────────────────────');

// E-01: the route forces agency=all for getAgencyUserIds
ok(
  createBlock.includes("agency: 'all'"),
  "E-01 route forces agency: 'all' for getAgencyUserIds"
);

// E-02: idempotent preflight check present before the crash site
ok(
  createBlock.includes('_findExistingInvoice'),
  'E-02 idempotent _findExistingInvoice check present'
);

console.log('\n── F. transaction safety — crash happens before INSERT ──────────────────');

// F-01: resolvedCurrency is computed BEFORE the advisory lock transaction
{
  const resolvedIdx  = createBlock.indexOf('const resolvedCurrency');
  const advisoryIdx  = createBlock.indexOf('pg_advisory_xact_lock');
  ok(resolvedIdx < advisoryIdx,
     'F-01 resolvedCurrency computed before advisory lock (no partial insert risk)');
}

// F-02: INSERT into invoice_download_tokens comes after resolvedCurrency
{
  const resolvedIdx = createBlock.indexOf('const resolvedCurrency');
  const insertIdx   = createBlock.indexOf('INSERT INTO invoice_download_tokens');
  ok(insertIdx > resolvedIdx,
     'F-02 DB INSERT comes after resolvedCurrency (no orphan row risk from this bug)');
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`BACKEND-INVOICE-CREATE-FIX-01: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}

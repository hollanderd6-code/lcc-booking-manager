'use strict';
/**
 * WEB-OWNER-INVOICE-IMPORT-FIX-02 — Regression test
 *
 * Verifies that openImportReservations() property resolution:
 *  1. Uses _managedAccount.userId as PRIMARY path for agency clients
 *     (not owner_id which is in the wrong namespace / unreliable)
 *  2. Fails closed for agency clients — never falls back to own/global properties
 *  3. Uses owner_id filter correctly for own (non-agency) clients
 *  4. loadClientDefaults() also uses managed metadata for agency clients
 *  5. fetchInvoiceSummary sends owner_user_id when managed property selected
 *
 * Saint-Gratien reference case:
 *   client       : agency_client_7  (delegator = u_mt2nuw9l)
 *   properties   : u_mt2nuw9l-saint-gratien-etage, u_mt2nuw9l-saint-gratien-rdc
 *   managed_user : u_mt2nuw9l
 *
 * Pure static + logic analysis — no DB / browser required.
 * Run with: node tests/web_owner_invoice_import_fix02.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0;
let failed = 0;

function ok(val, label) {
  if (val) { console.log('  ✅ ' + label); passed++; }
  else      { console.error('  ❌ ' + label); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, '../public/clients.html'), 'utf8');

// ── A. STATIC: agency client code path structure ─────────────────────────────

console.log('\n── A. CODE STRUCTURE: agency client takes authoritative managed path ────');

// A-01: isAgencyClient detection present
ok(
  src.includes("String(clientId2).startsWith('agency_client_')"),
  'A-01 isAgencyClient detected via startsWith("agency_client_")'
);

// A-02: owner_id filter NOT used as primary for agency clients
{
  const importFn = src.match(/window\.openImportReservations\s*=\s*function[\s\S]+?^\};/m)?.[0] || '';
  ok(importFn.length > 0, 'A-02a openImportReservations function found');

  // The owner_id filter must be inside an else branch (not before the agency check)
  const agencyBranchIdx  = importFn.indexOf("if (isAgencyClient2)");
  const ownerIdFilterIdx = importFn.indexOf("String(p.owner_id) === realClientId");
  ok(agencyBranchIdx !== -1,  'A-02b isAgencyClient2 branch present');
  ok(ownerIdFilterIdx > agencyBranchIdx, 'A-02c owner_id filter is in else branch (after agency check)');
}

// A-03: managed metadata used INSIDE agency branch
ok(
  src.includes('p._isManaged && p._managedAccount && p._managedAccount.userId === _clObj.delegator_user_id'),
  'A-03 managed metadata filter present in agency branch'
);

// A-04: fail closed — no global allProperties fallback for agency clients
{
  const importFn = src.match(/window\.openImportReservations\s*=\s*function[\s\S]+?^\};/m)?.[0] || '';
  // The unsafe "allProps = window.allProperties || []" must NOT appear after the agency path
  // Check that the old "entire window.allProperties" global fallback is gone
  const globalFallback = importFn.includes('allProps = window.allProperties || [];');
  ok(!globalFallback, 'A-04 global allProperties fallback removed (fail-closed for agency)');
}

// A-05: own-props fallback (!_isManaged) also removed
{
  const importFn = src.match(/window\.openImportReservations\s*=\s*function[\s\S]+?^\};/m)?.[0] || '';
  ok(!importFn.includes("filter(function(p){ return !p._isManaged; })"),
     'A-05 own-props fallback removed from openImportReservations');
}

// ── B. STATIC: loadClientDefaults uses managed metadata for agency clients ───

console.log('\n── B. loadClientDefaults: agency path ───────────────────────────────────');

{
  const lcdFn = src.match(/function loadClientDefaults\(\)[\s\S]+?\n\}/)?.[0] || '';
  ok(lcdFn.length > 0, 'B-01 loadClientDefaults function found');

  ok(lcdFn.includes("String(clientId).startsWith('agency_client_')"),
     'B-02 loadClientDefaults detects agency client');

  ok(lcdFn.includes('_agClObj.delegator_user_id'),
     'B-03 loadClientDefaults uses delegator_user_id for agency clients');

  ok(lcdFn.includes('p._isManaged && p._managedAccount'),
     'B-04 loadClientDefaults filters by managed metadata for agency clients');
}

// ── C. STATIC: DIAG log structure ────────────────────────────────────────────

console.log('\n── C. DIAG log structure ────────────────────────────────────────────────');

ok(src.includes('[OwnerInvoiceWebImport][DIAG] client'), 'C-01 DIAG client log present');
ok(src.includes('[OwnerInvoiceWebImport][DIAG] collections'), 'C-02 DIAG collections log present');
ok(src.includes('[OwnerInvoiceWebImport][DIAG] selectedProperties'), 'C-03 DIAG selectedProperties log present');
ok(src.includes('[OwnerInvoiceWebImport][DIAG] primaryOwnerMatch'), 'C-04 DIAG primaryOwnerMatch log present');
ok(src.includes('[OwnerInvoiceWebImport][DIAG] managedMatch'), 'C-05 DIAG managedMatch log present');
ok(src.includes('[OwnerInvoiceWebImport][DIAG] request'), 'C-06 DIAG request log in fetchInvoiceSummary');
ok(src.includes('[OwnerInvoiceWebImport][DIAG] response'), 'C-07 DIAG response log in fetchInvoiceSummary');
ok(src.includes('delegatorUserId:'), 'C-08 delegatorUserId in DIAG client log');

// ── D. LOGIC: simulate Saint-Gratien property resolution ─────────────────────

console.log('\n── D. LOGIC: Saint-Gratien property resolution simulation ───────────────');

// Simulates the runtime state for the agency scenario
function simulatePropertyResolution(clientId2, allProperties, clients) {
  const isAgencyClient2 = String(clientId2).startsWith('agency_client_');
  let allProps = [];

  if (isAgencyClient2) {
    const _clObj = (clients || []).find(c => String(c.id) === String(clientId2));
    if (_clObj && _clObj.delegator_user_id) {
      allProps = (allProperties || []).filter(p =>
        p._isManaged && p._managedAccount && p._managedAccount.userId === _clObj.delegator_user_id
      );
    }
    // Fail closed: no fallback for agency clients
  } else if (allProperties && allProperties.length > 0 && clientId2) {
    const realClientId = String(clientId2).replace('agency_client_', '');
    allProps = allProperties.filter(p => String(p.owner_id) === realClientId);
  }
  return allProps;
}

// Runtime state for the Saint-Gratien reference case
const saintGratienClients = [
  {
    id: 'agency_client_7',
    original_id: 7,
    delegator_user_id: 'u_mt2nuw9l',
    is_agency_client: true,
    first_name: 'Blandine',
    last_name: 'Fyne'
  }
];

const saintGratienProperties = [
  // Agency user's own properties (should NOT appear for agency client)
  { id: 'u_agency-other', name: 'Own property', owner_id: '7', _isManaged: false },
  // Blandine Fyne's managed properties
  {
    id: 'u_mt2nuw9l-saint-gratien-etage',
    name: 'Saint-Gratien Étage',
    owner_id: null,
    _isManaged: true,
    _managedAccount: { userId: 'u_mt2nuw9l', name: 'Blandine Fyne' }
  },
  {
    id: 'u_mt2nuw9l-saint-gratien-rdc',
    name: 'Saint-Gratien RDC',
    owner_id: null,
    _isManaged: true,
    _managedAccount: { userId: 'u_mt2nuw9l', name: 'Blandine Fyne' }
  },
  // Another managed account — must NOT appear
  {
    id: 'u_other-prop',
    name: 'Other managed',
    owner_id: null,
    _isManaged: true,
    _managedAccount: { userId: 'u_other', name: 'Other Owner' }
  }
];

// D-01: Saint-Gratien agency client resolves to exactly 2 managed properties
{
  const result = simulatePropertyResolution('agency_client_7', saintGratienProperties, saintGratienClients);
  ok(result.length === 2, 'D-01 agency_client_7 resolves to 2 properties');
  ok(result.every(p => p._managedAccount.userId === 'u_mt2nuw9l'),
     'D-02 both resolved properties belong to u_mt2nuw9l');
  ok(result.some(p => p.id === 'u_mt2nuw9l-saint-gratien-etage'),
     'D-03 saint-gratien-etage present');
  ok(result.some(p => p.id === 'u_mt2nuw9l-saint-gratien-rdc'),
     'D-04 saint-gratien-rdc present');
}

// D-05: own property with owner_id=7 NOT included for agency client (fail closed)
{
  const result = simulatePropertyResolution('agency_client_7', saintGratienProperties, saintGratienClients);
  ok(!result.some(p => p.id === 'u_agency-other'),
     'D-05 own property (owner_id=7) excluded from agency client resolution');
}

// D-06: other managed account's property NOT included
{
  const result = simulatePropertyResolution('agency_client_7', saintGratienProperties, saintGratienClients);
  ok(!result.some(p => p.id === 'u_other-prop'),
     'D-06 other managed account excluded');
}

// D-07: client not found → fail closed (0 properties)
{
  const result = simulatePropertyResolution('agency_client_999', saintGratienProperties, saintGratienClients);
  ok(result.length === 0, 'D-07 unknown agency client → 0 properties (fail closed)');
}

// D-08: own client (non-agency) uses owner_id filter correctly
{
  const ownProps = [
    { id: 'own-1', owner_id: '3', _isManaged: false },
    { id: 'own-2', owner_id: '4', _isManaged: false },
    { id: 'managed-1', owner_id: null, _isManaged: true, _managedAccount: { userId: 'u_x' } }
  ];
  const result = simulatePropertyResolution('3', ownProps, []);
  ok(result.length === 1 && result[0].id === 'own-1',
     'D-08 own client ID=3 resolves to own-1 via owner_id filter');
}

// D-09: empty allProperties → 0 for agency (not an exception)
{
  const result = simulatePropertyResolution('agency_client_7', [], saintGratienClients);
  ok(result.length === 0, 'D-09 empty allProperties → 0 results, no exception');
}

// D-10: window.clients not loaded yet → 0 properties (fail closed)
{
  const result = simulatePropertyResolution('agency_client_7', saintGratienProperties, []);
  ok(result.length === 0, 'D-10 empty clients → 0 properties (fail closed, no fallback)');
}

// ── E. STATIC: currency and propResult fixes preserved ────────────────────────

console.log('\n── E. Prior fixes preserved ──────────────────────────────────────────────');

// E-01: INTL-4.4B currency forwarding preserved (from prior fix)
ok(
  src.includes('...(p.currency ? { currency: p.currency } : {})'),
  'E-01 INTL-4.4B item currency forwarding preserved'
);

// E-02: fail closed message for agency client with 0 properties
ok(
  src.includes('Impossible d&#39;identifier les logements'),
  'E-02 fail-closed error message present for agency client with 0 properties'
);

// E-03: server.js propResult fix not reverted — same check as backend_invoice_create_fix.test.js
{
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const createRouteMatch = serverSrc.match(/app\.post\('\/api\/invoice\/create'[\s\S]+?^\}\);/m);
  if (!createRouteMatch) {
    ok(false, 'E-03 POST /api/invoice/create route not found in server.js');
  } else {
    const createBlock2 = createRouteMatch[0];
    const agencyBlock = createBlock2.match(
      /let billingUserId[\s\S]+?let propResult[\s\S]+?try \{[\s\S]+?\} catch\(e\) \{[\s\S]+?\}/
    )?.[0] || '';
    const propDeclIdx = agencyBlock.indexOf('let propResult = { rows: [] };');
    const tryIdx      = agencyBlock.indexOf('try {');
    ok(agencyBlock.length > 0 && propDeclIdx !== -1 && propDeclIdx < tryIdx,
       'E-03 server.js propResult declared before try { (scope fix intact)');
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`WEB-OWNER-INVOICE-IMPORT-FIX-02: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}

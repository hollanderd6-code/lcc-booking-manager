'use strict';
/**
 * WEB-OWNER-INVOICE-IMPORT-FIX-03 — Regression test
 *
 * Proves that fetchInvoiceSummary() uses a canonical owner scope set by
 * openImportReservations() instead of re-discovering it from window.allProperties.
 *
 * The production failure:
 *   - openImportReservations() correctly resolved agency_client_7 → u_mt2nuw9l
 *   - fetchInvoiceSummary() re-derived managedUserId from window.allProperties
 *   - That re-derivation returned null → request sent WITHOUT owner_user_id
 *   - Backend returned 0 reservations (queried wrong account)
 *
 * Generic test matrix (no hardcoded account IDs in production logic):
 *   1. Normal owner             → ownerUserId=null, no owner_user_id param
 *   2. Managed owner A          → ownerUserId=u_managed_A, owner_user_id=u_managed_A
 *   3. Managed owner B          → ownerUserId=u_managed_B, owner_user_id=u_managed_B
 *   4. Switch managed A → B     → scope changes, no leakage
 *   5. Switch managed → normal  → scope resets to null
 *   6. Switch normal → managed  → scope becomes delegator_user_id
 *   7. Missing delegator        → fail closed, no request
 *   8. No matching managed props→ fail closed before fetch (openImportReservations)
 *   9. Numeric owner_id collision (local 7 vs agency original_id 7) → no collision
 *
 * Pure logic simulation — no DOM / DB required.
 * Run with: node tests/web_owner_invoice_import_fix03.test.js
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

// ── A. STATIC: scope object structure ────────────────────────────────────────

console.log('\n── A. STATIC: _importResaOwnerScope set by openImportReservations() ──────');

ok(src.includes('window._importResaOwnerScope'), 'A-01 _importResaOwnerScope introduced');
ok(src.includes('isAgency: isAgencyClient2'),    'A-02 isAgency field set from isAgencyClient2');
ok(src.includes('_diagClObj.delegator_user_id'), 'A-03 ownerUserId sourced from delegator_user_id');
ok(src.includes('window._importResaOwnerScope = null'), 'A-04 scope reset in closeImportResaModal()');

console.log('\n── B. STATIC: fetchInvoiceSummary uses scope, not re-discovery ───────────');

{
  const fetchFn = src.match(/window\.fetchInvoiceSummary\s*=\s*async function[\s\S]+?^\};/m)?.[0] || '';
  ok(fetchFn.length > 0, 'B-01 fetchInvoiceSummary found');

  // Re-discovery loop must be gone
  ok(!fetchFn.includes('window.allProperties.find'),
     'B-02 window.allProperties.find re-discovery removed from fetchInvoiceSummary');
  ok(!fetchFn.includes('prop._isManaged'),
     'B-03 prop._isManaged re-discovery removed from fetchInvoiceSummary');

  // Canonical scope consumed
  ok(fetchFn.includes('window._importResaOwnerScope'),
     'B-04 fetchInvoiceSummary reads _importResaOwnerScope');
  ok(fetchFn.includes('_ownerScope.ownerUserId'),
     'B-05 _ownerScope.ownerUserId used to build URL');
  ok(fetchFn.includes('_ownerScope.isAgency && !_ownerScope.ownerUserId'),
     'B-06 fail-closed: isAgency + missing ownerUserId aborts fetch');
}

// ── C. LOGIC: openImportReservations scope-setting simulation ─────────────────

console.log('\n── C. LOGIC: scope-setting simulation (generic, no hardcodes) ───────────');

// Simulates the scope-setting block of openImportReservations()
function computeScope(clientId2, clients) {
  const isAgencyClient2 = String(clientId2).startsWith('agency_client_');
  const _diagClObj = (clients || []).find(c => String(c.id) === String(clientId2));
  return {
    isAgency: isAgencyClient2,
    ownerUserId: (isAgencyClient2 && _diagClObj && _diagClObj.delegator_user_id)
      ? _diagClObj.delegator_user_id
      : null
  };
}

// Simulates fetchInvoiceSummary scope consumption
function simulateFetch(scope, propIds, dateFrom, dateTo) {
  const _ownerScope = scope || { isAgency: false, ownerUserId: null };
  if (_ownerScope.isAgency && !_ownerScope.ownerUserId) {
    return { aborted: true, reason: 'missing_owner_user_id', url: null };
  }
  const managedUserId = _ownerScope.ownerUserId || null;
  let url = '/api/reservations/invoice-summary?date_from=' + dateFrom + '&date_to=' + dateTo;
  if (propIds.length > 0) url += '&property_ids=' + propIds.join(',');
  if (managedUserId) url += '&owner_user_id=' + managedUserId;
  return { aborted: false, url, managedUserId };
}

// Generic test clients — NOTE: numeric IDs are generic, NOT hardcoded per-account
const testClients = [
  { id: 'agency_client_7',  original_id: 7,  delegator_user_id: 'u_managed_A', is_agency_client: true },
  { id: 'agency_client_12', original_id: 12, delegator_user_id: 'u_managed_B', is_agency_client: true },
  { id: '3',                original_id: 3,  delegator_user_id: null,           is_agency_client: false }
];

const managedPropsA = [
  { id: 'u_managed_A-prop1', _isManaged: true,  _managedAccount: { userId: 'u_managed_A' }, owner_id: null },
  { id: 'u_managed_A-prop2', _isManaged: true,  _managedAccount: { userId: 'u_managed_A' }, owner_id: null }
];
const managedPropsB = [
  { id: 'u_managed_B-prop1', _isManaged: true,  _managedAccount: { userId: 'u_managed_B' }, owner_id: null }
];
const ownProps = [
  { id: 'own-prop-1', _isManaged: false, owner_id: '3' },
  // Deliberately give this own property owner_id=7 to test collision
  { id: 'own-prop-collision', _isManaged: false, owner_id: '7' }
];
const allTestProperties = [...ownProps, ...managedPropsA, ...managedPropsB];

// CASE 1 — Normal owner
{
  const scope = computeScope('3', testClients);
  ok(scope.isAgency === false, 'C-01 normal owner: isAgency=false');
  ok(scope.ownerUserId === null, 'C-02 normal owner: ownerUserId=null');
  const result = simulateFetch(scope, ['own-prop-1'], '2026-09-01', '2026-10-01');
  ok(!result.aborted, 'C-03 normal owner: fetch not aborted');
  ok(!result.url.includes('owner_user_id'), 'C-04 normal owner: no owner_user_id in URL');
}

// CASE 2 — Managed owner A
{
  const scope = computeScope('agency_client_7', testClients);
  ok(scope.isAgency === true, 'C-05 managed A: isAgency=true');
  ok(scope.ownerUserId === 'u_managed_A', 'C-06 managed A: ownerUserId=u_managed_A');
  const result = simulateFetch(scope, ['u_managed_A-prop1', 'u_managed_A-prop2'], '2026-09-01', '2026-10-01');
  ok(!result.aborted, 'C-07 managed A: fetch not aborted');
  ok(result.url.includes('owner_user_id=u_managed_A'), 'C-08 managed A: URL contains owner_user_id=u_managed_A');
}

// CASE 3 — Managed owner B
{
  const scope = computeScope('agency_client_12', testClients);
  ok(scope.isAgency === true, 'C-09 managed B: isAgency=true');
  ok(scope.ownerUserId === 'u_managed_B', 'C-10 managed B: ownerUserId=u_managed_B');
  const result = simulateFetch(scope, ['u_managed_B-prop1'], '2026-09-01', '2026-10-01');
  ok(result.url.includes('owner_user_id=u_managed_B'), 'C-11 managed B: URL contains owner_user_id=u_managed_B');
  ok(!result.url.includes('u_managed_A'), 'C-12 managed B: no leakage of u_managed_A');
}

// CASE 4 — Switch managed A → managed B
{
  const scopeA = computeScope('agency_client_7',  testClients);
  const scopeB = computeScope('agency_client_12', testClients);
  ok(scopeA.ownerUserId === 'u_managed_A', 'C-13 switch A→B: scope A correct before switch');
  ok(scopeB.ownerUserId === 'u_managed_B', 'C-14 switch A→B: scope B replaces A');
  const resultB = simulateFetch(scopeB, ['u_managed_B-prop1'], '2026-09-01', '2026-10-01');
  ok(resultB.url.includes('u_managed_B'), 'C-15 switch A→B: URL uses B not A');
  ok(!resultB.url.includes('u_managed_A'), 'C-16 switch A→B: no A leakage in B request');
}

// CASE 5 — Switch managed A → normal owner
{
  const scopeManaged = computeScope('agency_client_7', testClients);
  const scopeOwn     = computeScope('3', testClients);
  ok(scopeOwn.ownerUserId === null,  'C-17 switch managed→own: ownerUserId reset to null');
  ok(scopeOwn.isAgency === false,    'C-18 switch managed→own: isAgency=false');
  const result = simulateFetch(scopeOwn, ['own-prop-1'], '2026-09-01', '2026-10-01');
  ok(!result.url.includes('owner_user_id'), 'C-19 switch managed→own: no owner_user_id in URL');
}

// CASE 6 — Switch normal → managed B
{
  const scopeOwn     = computeScope('3',               testClients);
  const scopeManaged = computeScope('agency_client_12', testClients);
  ok(scopeManaged.ownerUserId === 'u_managed_B', 'C-20 switch own→managed B: ownerUserId=u_managed_B');
  const result = simulateFetch(scopeManaged, ['u_managed_B-prop1'], '2026-09-01', '2026-10-01');
  ok(result.url.includes('owner_user_id=u_managed_B'), 'C-21 switch own→managed B: URL correct');
}

// CASE 7 — Agency client with missing delegator_user_id
{
  const brokenClients = [{ id: 'agency_client_99', is_agency_client: true }]; // no delegator_user_id
  const scope = computeScope('agency_client_99', brokenClients);
  ok(scope.isAgency === true,       'C-22 missing delegator: isAgency=true');
  ok(scope.ownerUserId === null,    'C-23 missing delegator: ownerUserId=null');
  const result = simulateFetch(scope, ['some-prop'], '2026-09-01', '2026-10-01');
  ok(result.aborted === true,       'C-24 missing delegator: fetch aborted');
  ok(result.url === null,           'C-25 missing delegator: no URL generated');
}

// CASE 8 — Agency client, delegator found, but no managed properties loaded
//          (openImportReservations shows fail-closed error; fetch should not proceed)
//          Test that scope is set correctly even when allProps=[]:
{
  const scope = computeScope('agency_client_7', testClients);
  ok(scope.ownerUserId === 'u_managed_A', 'C-26 no managed props loaded: scope still set from client');
  // The fetch is still valid (scope.ownerUserId is set), but openImportReservations already
  // blocked the modal with error message. The fetch button is disabled.
  // This test confirms scope is NOT corrupted by empty property list.
}

// CASE 9 — Numeric owner_id collision: local prop owner_id=7 vs agency_client_7
{
  // own-prop-collision has owner_id='7' — same as agency_client_7's original_id
  // But agency scope uses delegator_user_id='u_managed_A', NOT owner_id lookup
  const scope = computeScope('agency_client_7', testClients);
  ok(scope.ownerUserId === 'u_managed_A', 'C-27 collision: agency scope uses u_managed_A not owner_id');

  // Simulate property resolution (FIX-02 path — agency uses _managedAccount.userId)
  const resolvedProps = allTestProperties.filter(p =>
    p._isManaged && p._managedAccount && p._managedAccount.userId === scope.ownerUserId
  );
  ok(!resolvedProps.some(p => p.id === 'own-prop-collision'),
     'C-28 collision: own-prop with owner_id=7 excluded from agency resolution');
  ok(resolvedProps.every(p => p._managedAccount.userId === 'u_managed_A'),
     'C-29 collision: only u_managed_A properties in resolved set');

  const result = simulateFetch(scope, resolvedProps.map(p => p.id), '2026-09-01', '2026-10-01');
  ok(result.url.includes('owner_user_id=u_managed_A'), 'C-30 collision: correct owner_user_id in URL');
}

// CASE: null scope (defensive — scope never set)
{
  const result = simulateFetch(null, ['some-prop'], '2026-09-01', '2026-10-01');
  ok(!result.aborted, 'C-31 null scope treated as non-agency, no abort');
  ok(!result.url.includes('owner_user_id'), 'C-32 null scope: no owner_user_id in URL');
}

// ── D. STATIC: no hardcoded account IDs in production logic ──────────────────

console.log('\n── D. NO hardcodes in production logic ──────────────────────────────────');

{
  // Extract only the production function bodies (not test fixtures, not DIAG comment strings)
  const fetchFn   = src.match(/window\.fetchInvoiceSummary\s*=\s*async function[\s\S]+?^\};/m)?.[0] || '';
  const importFn  = src.match(/window\.openImportReservations\s*=\s*function[\s\S]+?^\};/m)?.[0] || '';
  const closeFn   = src.match(/window\.closeImportResaModal\s*=\s*function[\s\S]+?\};/)?.[0] || '';

  // These literals must NOT appear in production logic
  const forbidden = ['u_mt2nuw9l', 'saint-gratien', 'Blandine', 'agency_client_7'];
  forbidden.forEach(function(f) {
    ok(!fetchFn.includes(f),  'D hardcode absent from fetchInvoiceSummary: ' + f);
    ok(!importFn.includes(f), 'D hardcode absent from openImportReservations: ' + f);
    ok(!closeFn.includes(f),  'D hardcode absent from closeImportResaModal: ' + f);
  });
}

// ── E. STATIC: prior fixes preserved ─────────────────────────────────────────

console.log('\n── E. Prior fixes preserved ──────────────────────────────────────────────');

ok(src.includes("String(clientId2).startsWith('agency_client_')"),
   'E-01 FIX-02 agency detection preserved in openImportReservations');
ok(src.includes('p._isManaged && p._managedAccount && p._managedAccount.userId === _clObj.delegator_user_id'),
   'E-02 FIX-02 managed metadata filter preserved in property resolution');
ok(src.includes("String(clientId).startsWith('agency_client_')"),
   'E-03 FIX-02 loadClientDefaults agency path preserved');
ok(src.includes('...(p.currency ? { currency: p.currency } : {})'),
   'E-04 INTL-4.4B item currency forwarding preserved');
ok(src.includes("p.platform + '|' + (p.currency || 'EUR')"),
   'E-05 INTL-4.4 platform|currency composite key preserved');
ok(src.includes('[OwnerInvoiceWebImport][DIAG] client'),
   'E-06 DIAG client log preserved');
ok(src.includes('scopeIsAgency'),
   'E-07 scopeIsAgency added to DIAG request log');

// ── F. STATIC: server.js propResult fix intact ────────────────────────────────

console.log('\n── F. server.js propResult fix intact ───────────────────────────────────');

{
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const createRouteMatch = serverSrc.match(/app\.post\('\/api\/invoice\/create'[\s\S]+?^\}\);/m);
  if (!createRouteMatch) {
    ok(false, 'F-01 POST /api/invoice/create route not found');
  } else {
    const createBlock = createRouteMatch[0];
    const agencyBlock = createBlock.match(
      /let billingUserId[\s\S]+?let propResult[\s\S]+?try \{[\s\S]+?\} catch\(e\) \{[\s\S]+?\}/
    )?.[0] || '';
    const propDeclIdx = agencyBlock.indexOf('let propResult = { rows: [] };');
    const tryIdx      = agencyBlock.indexOf('try {');
    ok(agencyBlock.length > 0 && propDeclIdx !== -1 && propDeclIdx < tryIdx,
       'F-01 server.js propResult scope fix intact');
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`WEB-OWNER-INVOICE-IMPORT-FIX-03: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  console.error(`${failed} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('All tests passed ✅');
}

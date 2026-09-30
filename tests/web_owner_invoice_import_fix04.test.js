'use strict';
/**
 * WEB-OWNER-INVOICE-IMPORT-FIX-04 — Regression test
 *
 * Root cause (proven from production logs):
 *   bh-layout.js installs a global window.fetch interceptor that appends
 *   ?agency=all to every /api/ call when localStorage.bh_agency_view='all'.
 *   GET /api/properties?agency=all therefore returns both own and managed
 *   properties.  clients.html stamped ALL of those _isManaged:false.
 *   GET /api/agency/managed-properties then returned the same IDs with
 *   authoritative managed metadata (_isManaged:true, _managedAccount.userId).
 *   The old Set-based dedup dropped those authoritative versions → 0 managed.
 *
 *   CRITICAL INVARIANT:
 *     owner_id           = owner_clients.id  — billing client identifier
 *     delegator_user_id  = users.id          — Boostinghost account owning reservations
 *   These MUST NOT be treated as interchangeable.
 *
 * Fixes:
 *
 *  FIX-A  loadPropertiesForInvoice() dedup
 *    Map-based merge: when same ID in both sources, keep richer own-props
 *    entry but stamp _isManaged:true + _managedAccount from managed source.
 *
 *  FIX-B  loadClients() enrichment (deterministic only)
 *    For each local UUID client C: collect delegator_user_id values from
 *    managed properties linked via owner_id = C.id.
 *    Exactly 1 unique → stamp client.delegator_user_id.
 *    0 → leave as local.
 *    > 1 → fail closed, log ambiguousOwnerScope (no arbitrary choice).
 *    Does NOT stamp is_agency_client (would affect unrelated UI).
 *
 *  FIX-C  openImportReservations broadened detection
 *    isAgencyClient2 = startsWith('agency_client_') || delegator_user_id present.
 *    FIX-03 path then naturally produces scopeIsAgency:true, ownerUserId correct.
 *
 *  FIX-D  loadClientDefaults same broadened detection.
 *
 * Pure static + logic analysis — no DB / browser required.
 * Run with: node tests/web_owner_invoice_import_fix04.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

let passed = 0;
let failed = 0;
const ambiguityLogs = []; // captures simulated ambiguity log calls

function ok(val, label) {
  if (val) { console.log('  ✅ ' + label); passed++; }
  else      { console.error('  ❌ ' + label); failed++; }
}

const src = fs.readFileSync(path.join(__dirname, '../public/clients.html'), 'utf8');

// ── A. STATIC: dedup uses Map-based merge ──────────────────────────────────

console.log('\n── A. STATIC: FIX-A dedup ───────────────────────────────────────────────');

ok(src.includes('ownByIdMap') && src.includes('existing._isManaged = true')
   && src.includes('existing._managedAccount = p._managedAccount'),
   'A-01 Map-based merge: ownByIdMap + stamp _isManaged + _managedAccount');
ok(src.includes('Array.from(ownByIdMap.values())'), 'A-02 allProperties from Map values');
ok(!src.includes('allIds.has(String(p.id))'),       'A-03 old Set-based drop-only removed');

// ── B. STATIC: DIAG identity log ──────────────────────────────────────────

console.log('\n── B. STATIC: DIAG identity log ─────────────────────────────────────────');

ok(src.includes("[OwnerInvoiceWebImport][IDENTITY] properties"),
   'B-01 IDENTITY log key = "[OwnerInvoiceWebImport][IDENTITY] properties"');
ok(src.includes('total: window.allProperties.length') && src.includes('managed: _diagMgd.length'),
   'B-02 IDENTITY log fields: total + managed');
// No managedIds array (removed per spec — no PII concern but not needed)
ok(!src.includes('managedIds:'), 'B-03 managedIds array removed from IDENTITY log');

// ── C. STATIC: FIX-B client enrichment ────────────────────────────────────

console.log('\n── C. STATIC: FIX-B client enrichment ──────────────────────────────────');

ok(src.includes("c.delegator_user_id || String(c.id).startsWith('agency_client_')"),
   'C-01 guard: skip already-flagged or prefixed clients');
ok(src.includes('p._isManaged && p._managedAccount && p._managedAccount.userId')
   && src.includes('String(p.owner_id) === cId'),
   'C-02 links managed properties to client via owner_id (owner_clients.id)');
ok(src.includes('if (uniq.length === 1)') && src.includes('c.delegator_user_id = uniq[0]'),
   'C-03 stamps delegator_user_id only when exactly one unique delegator');
ok(src.includes('uniq.length > 1') && src.includes('ambiguousOwnerScope'),
   'C-04 ambiguousOwnerScope log present for multiple-delegator case');
ok(src.includes('[OwnerInvoiceWebImport][IDENTITY] ambiguousOwnerScope'),
   'C-05 ambiguity log uses correct key');
ok(src.includes('ownerClientId') && src.includes('accountCount'),
   'C-06 ambiguity log fields: ownerClientId + accountCount');
// CRITICAL: must not stamp is_agency_client
ok(!src.includes('c.is_agency_client = true'),
   'C-07 is_agency_client NOT stamped (would affect unrelated UI)');
// Must have owner_id vs user_id comment
ok(src.includes('owner_id') && src.includes('owner_clients.id')
   && src.includes('delegator_user_id') && src.includes('users.id'),
   'C-08 code comment distinguishes owner_id (owner_clients.id) from delegator_user_id (users.id)');

// No hardcodes in enrichment block
{
  const block = src.match(/Enrichir les clients locaux[\s\S]+?ambiguousOwnerScope[\s\S]+?\}\);/)?.[0] || '';
  ok(block.length > 0, 'C-09a enrichment block found');
  ok(!block.includes('u_mt2nuw9l'), 'C-09b no u_mt2nuw9l in enrichment');
  ok(!block.includes('5001a05b'),   'C-09c no UUID in enrichment');
  ok(!block.includes('agency_client_7'), 'C-09d no agency_client_7 in enrichment');
}

// ── D. STATIC: broadened isAgencyClient2 detection ────────────────────────

console.log('\n── D. STATIC: FIX-C/D broadened detection ───────────────────────────────');

ok(src.includes("String(clientId2).startsWith('agency_client_')")
   && src.includes('!!(_diagClObj && _diagClObj.delegator_user_id)'),
   'D-01 openImportReservations: broadened to startsWith OR delegator_user_id');
ok(src.includes("String(clientId).startsWith('agency_client_')")
   && src.includes('!!(_lcdClObj && _lcdClObj.delegator_user_id)'),
   'D-02 loadClientDefaults: broadened to startsWith OR delegator_user_id');
ok(!src.includes('_propsManagedUserId'),
   'D-03 _propsManagedUserId workaround absent (FIX-03 path used instead)');

// ── E. LOGIC: FIX-A dedup simulation ──────────────────────────────────────

console.log('\n── E. LOGIC: FIX-A dedup simulation ────────────────────────────────────');

function simulateDedup(ownPropsRaw, managedPropsRaw) {
  var myProps = ownPropsRaw.map(function(p) { return Object.assign({}, p, { _isManaged: false }); });
  var ownByIdMap = new Map(myProps.map(function(p) { return [String(p.id), p]; }));
  managedPropsRaw.forEach(function(p) {
    var existing = ownByIdMap.get(String(p.id));
    if (existing) {
      existing._isManaged = true;
      existing._managedAccount = p._managedAccount;
    } else {
      ownByIdMap.set(String(p.id), p);
    }
  });
  return Array.from(ownByIdMap.values());
}

// Case A: own-only property → stays _isManaged:false
{
  const r = simulateDedup([{ id: 'own-p', owner_id: null }], []);
  ok(r.length === 1 && r[0]._isManaged === false, 'E-01 own-only: _isManaged:false');
}
// Case B: managed-only property → added as-is with _isManaged:true
{
  const r = simulateDedup([], [{ id: 'mgd-p', _isManaged: true, _managedAccount: { userId: 'del-A' } }]);
  ok(r.length === 1 && r[0]._isManaged === true, 'E-02 managed-only: _isManaged:true');
}
// Case C: same ID in both → one entry, managed metadata wins, rich fields preserved
{
  const own = [{ id: 'X', owner_id: 'uuid-U', extra: 'rich' }];
  const mng = [{ id: 'X', _isManaged: true, _managedAccount: { userId: 'del-A' } }];
  const r = simulateDedup(own, mng);
  ok(r.length === 1,                                   'E-03 overlap: 1 entry');
  ok(r[0]._isManaged === true,                         'E-04 overlap: _isManaged:true');
  ok(r[0]._managedAccount.userId === 'del-A',          'E-05 overlap: _managedAccount.userId');
  ok(r[0].extra === 'rich',                            'E-06 overlap: own-props extra fields preserved');
  ok(r[0].owner_id === 'uuid-U',                       'E-07 overlap: owner_id preserved');
}
// Case D: 26-overlap (bh-layout.js scenario)
{
  const IDS = Array.from({ length: 26 }, function(_, i) { return 'prop-' + i; });
  const own = IDS.map(function(id) { return { id, owner_id: 'uuid-U', field: id + '-f' }; });
  const mng = IDS.map(function(id) { return { id, _isManaged: true, _managedAccount: { userId: 'del-A' } }; });
  const r = simulateDedup(own, mng);
  ok(r.length === 26,                                   'E-08 26-overlap: 26 entries (no dup)');
  ok(r.every(function(p) { return p._isManaged; }),    'E-09 26-overlap: all _isManaged:true');
  ok(r.every(function(p) { return p._managedAccount && p._managedAccount.userId === 'del-A'; }),
     'E-10 26-overlap: all _managedAccount.userId correct');
  ok(r.every(function(p) { return p.field === p.id + '-f'; }),
     'E-11 26-overlap: all extra fields preserved');
}
// No duplicate IDs anywhere
{
  const own = [{ id: 'p1' }, { id: 'p2' }];
  const mng = [{ id: 'p1', _isManaged: true, _managedAccount: { userId: 'del-A' } },
               { id: 'p3', _isManaged: true, _managedAccount: { userId: 'del-A' } }];
  const r = simulateDedup(own, mng);
  const ids = r.map(function(p) { return p.id; });
  const unique = ids.filter(function(v, i, a) { return a.indexOf(v) === i; });
  ok(r.length === unique.length, 'E-12 no duplicate IDs in result');
}

// ── F. LOGIC: FIX-B client enrichment ─────────────────────────────────────

console.log('\n── F. LOGIC: FIX-B client enrichment simulation ────────────────────────');

function simulateEnrichment(clientsRaw, allProperties) {
  var clients = JSON.parse(JSON.stringify(clientsRaw));
  var logs = [];
  clients.forEach(function(c) {
    if (c.delegator_user_id || String(c.id).startsWith('agency_client_')) return;
    var cId = String(c.id);
    var linked = allProperties.filter(function(p) {
      return p._isManaged && p._managedAccount && p._managedAccount.userId
        && p.owner_id && String(p.owner_id) === cId;
    });
    if (!linked.length) return;
    var dIds = linked.map(function(p) { return p._managedAccount.userId; });
    var uniq = dIds.filter(function(v, i, a) { return a.indexOf(v) === i; });
    if (uniq.length === 1) {
      c.delegator_user_id = uniq[0];
    } else if (uniq.length > 1) {
      logs.push({ ownerClientId: cId, accountCount: uniq.length });
    }
  });
  return { clients, logs };
}

// F-01: 2 managed props same delegator → enriched
{
  const { clients } = simulateEnrichment(
    [{ id: 'uuid-U' }],
    [{ id: 'p1', _isManaged: true, _managedAccount: { userId: 'del-A' }, owner_id: 'uuid-U' },
     { id: 'p2', _isManaged: true, _managedAccount: { userId: 'del-A' }, owner_id: 'uuid-U' }]
  );
  ok(clients[0].delegator_user_id === 'del-A', 'F-01 single delegator → enriched');
}
// F-02: zero managed props → not enriched
{
  const { clients } = simulateEnrichment([{ id: '42' }], [{ id: 'p1', _isManaged: false, owner_id: '42' }]);
  ok(!clients[0].delegator_user_id, 'F-02 zero managed → not enriched (stays local)');
}
// F-03: two distinct delegators → NOT enriched, ambiguity logged
{
  const { clients, logs } = simulateEnrichment(
    [{ id: 'uuid-U2' }],
    [{ id: 'p1', _isManaged: true, _managedAccount: { userId: 'del-A' }, owner_id: 'uuid-U2' },
     { id: 'p2', _isManaged: true, _managedAccount: { userId: 'del-B' }, owner_id: 'uuid-U2' }]
  );
  ok(!clients[0].delegator_user_id, 'F-03 ambiguous: NOT enriched');
  ok(logs.length === 1 && logs[0].ownerClientId === 'uuid-U2' && logs[0].accountCount === 2,
     'F-04 ambiguous: ambiguousOwnerScope logged with ownerClientId + accountCount');
}
// F-05: already has delegator_user_id → skipped
{
  const { clients } = simulateEnrichment([{ id: 'uuid-X', delegator_user_id: 'existing' }], []);
  ok(clients[0].delegator_user_id === 'existing', 'F-05 already enriched: not overwritten');
}
// F-06: agency_client_ prefix → skipped
{
  const { clients } = simulateEnrichment(
    [{ id: 'agency_client_7', delegator_user_id: 'del-X' }], []);
  ok(clients[0].delegator_user_id === 'del-X', 'F-06 agency_client_ prefix: skipped');
}
// F-07: is_agency_client must NOT be stamped
{
  const { clients } = simulateEnrichment(
    [{ id: 'uuid-U3' }],
    [{ id: 'p3', _isManaged: true, _managedAccount: { userId: 'del-A' }, owner_id: 'uuid-U3' }]
  );
  ok(clients[0].is_agency_client !== true,
     'F-07 is_agency_client NOT stamped (preserves original backend semantics)');
}

// ── G. LOGIC: generic account matrix (cases A–I from spec) ────────────────

console.log('\n── G. LOGIC: generic account matrix ────────────────────────────────────');

function simulateFullScenario(ownPropsRaw, managedPropsRaw, clientsRaw, selectedClientId) {
  // FIX-A: dedup
  var myProps = ownPropsRaw.map(function(p) { return Object.assign({}, p, { _isManaged: false }); });
  var ownByIdMap = new Map(myProps.map(function(p) { return [String(p.id), p]; }));
  managedPropsRaw.forEach(function(p) {
    var ex = ownByIdMap.get(String(p.id));
    if (ex) { ex._isManaged = true; ex._managedAccount = p._managedAccount; }
    else ownByIdMap.set(String(p.id), p);
  });
  var allProperties = Array.from(ownByIdMap.values());

  // FIX-B: enrichment
  var clients = JSON.parse(JSON.stringify(clientsRaw));
  var ambiguityLogs = [];
  clients.forEach(function(c) {
    if (c.delegator_user_id || String(c.id).startsWith('agency_client_')) return;
    var cId = String(c.id);
    var linked = allProperties.filter(function(p) {
      return p._isManaged && p._managedAccount && p._managedAccount.userId
        && p.owner_id && String(p.owner_id) === cId;
    });
    if (!linked.length) return;
    var dIds = linked.map(function(p) { return p._managedAccount.userId; });
    var uniq = dIds.filter(function(v, i, a) { return a.indexOf(v) === i; });
    if (uniq.length === 1) c.delegator_user_id = uniq[0];
    else if (uniq.length > 1) ambiguityLogs.push({ ownerClientId: cId, accountCount: uniq.length });
  });

  // FIX-C: detection
  var diagClObj = clients.find(function(c) { return String(c.id) === String(selectedClientId); });
  var isAgencyClient2 = String(selectedClientId).startsWith('agency_client_')
    || !!(diagClObj && diagClObj.delegator_user_id);

  // Property resolution
  var allProps = [];
  if (isAgencyClient2) {
    if (diagClObj && diagClObj.delegator_user_id) {
      allProps = allProperties.filter(function(p) {
        return p._isManaged && p._managedAccount
          && p._managedAccount.userId === diagClObj.delegator_user_id;
      });
    }
  } else {
    allProps = allProperties.filter(function(p) {
      return String(p.owner_id) === String(selectedClientId);
    });
  }

  // Scope (FIX-03 natural path)
  var scope = {
    isAgency: isAgencyClient2,
    ownerUserId: (isAgencyClient2 && diagClObj && diagClObj.delegator_user_id)
      ? diagClObj.delegator_user_id : null
  };

  return { allProperties, clients, diagClObj, isAgencyClient2, allProps, scope, ambiguityLogs };
}

// Case A: agency's own property — no managed match
{
  const r = simulateFullScenario(
    [{ id: 'own-p', owner_id: null }], [], [{ id: 'agency-id' }], 'agency-id'
  );
  ok(r.allProperties[0]._isManaged === false, 'G-A1 own prop: _isManaged:false');
  ok(!r.clients[0].delegator_user_id,         'G-A2 own client: no delegator_user_id');
  ok(r.scope.ownerUserId === null,             'G-A3 own client: ownerUserId:null (no owner_user_id sent)');
}

// Case B: delegated account A
{
  const r = simulateFullScenario(
    [{ id: 'pA', owner_id: 'uuid-X' }],
    [{ id: 'pA', _isManaged: true, _managedAccount: { userId: 'u_account_A' } }],
    [{ id: 'uuid-X' }],
    'uuid-X'
  );
  ok(r.allProperties.length === 1,                           'G-B1 one property (no dup)');
  ok(r.allProperties[0]._isManaged === true,                 'G-B2 _isManaged:true');
  ok(r.allProperties[0]._managedAccount.userId === 'u_account_A', 'G-B3 _managedAccount.userId correct');
  ok(r.clients[0].delegator_user_id === 'u_account_A',       'G-B4 client enriched');
  ok(r.scope.isAgency === true,                              'G-B5 scopeIsAgency:true');
  ok(r.scope.ownerUserId === 'u_account_A',                  'G-B6 ownerUserId:u_account_A');
}

// Case C: delegated account B (dynamic — different ID)
{
  const r = simulateFullScenario(
    [{ id: 'pB', owner_id: 'uuid-Y' }],
    [{ id: 'pB', _isManaged: true, _managedAccount: { userId: 'u_account_B' } }],
    [{ id: 'uuid-Y' }],
    'uuid-Y'
  );
  ok(r.scope.ownerUserId === 'u_account_B', 'G-C1 delegated B: ownerUserId:u_account_B');
  ok(r.scope.isAgency === true,             'G-C2 delegated B: scopeIsAgency:true');
}

// Case D: owner_client only under one delegated account — deterministic
{
  const r = simulateFullScenario(
    [{ id: 'pD', owner_id: 'uuid-D' }],
    [{ id: 'pD', _isManaged: true, _managedAccount: { userId: 'u_account_D' } }],
    [{ id: 'uuid-D' }],
    'uuid-D'
  );
  ok(r.clients[0].delegator_user_id === 'u_account_D', 'G-D1 deterministic enrichment');
}

// Case E: owner_client with properties from TWO distinct delegated accounts → ambiguous
{
  const r = simulateFullScenario(
    [{ id: 'pe1', owner_id: 'uuid-E' }, { id: 'pe2', owner_id: 'uuid-E' }],
    [{ id: 'pe1', _isManaged: true, _managedAccount: { userId: 'u_acct_A' } },
     { id: 'pe2', _isManaged: true, _managedAccount: { userId: 'u_acct_B' } }],
    [{ id: 'uuid-E' }],
    'uuid-E'
  );
  ok(!r.clients[0].delegator_user_id,   'G-E1 ambiguous: NOT enriched');
  ok(r.scope.ownerUserId === null,       'G-E2 ambiguous: ownerUserId:null (fail closed)');
  ok(r.scope.isAgency === false,         'G-E3 ambiguous: isAgency:false');
  ok(r.ambiguityLogs.length === 1 && r.ambiguityLogs[0].accountCount === 2,
     'G-E4 ambiguous: ambiguousOwnerScope logged');
}

// Case F: managed property has no _managedAccount.userId → fail closed
{
  const r = simulateFullScenario(
    [{ id: 'pF', owner_id: 'uuid-F' }],
    [{ id: 'pF', _isManaged: true, _managedAccount: {} }],  // no userId
    [{ id: 'uuid-F' }],
    'uuid-F'
  );
  ok(!r.clients[0].delegator_user_id, 'G-F1 missing managedAccount.userId → not enriched');
  ok(r.scope.ownerUserId === null,    'G-F2 missing userId → fail closed');
}

// Case G: switch delegated A → delegated B (scope replaced, no stale data)
{
  const rA = simulateFullScenario(
    [{ id: 'pga', owner_id: 'uuid-GA' }, { id: 'pgb', owner_id: 'uuid-GB' }],
    [{ id: 'pga', _isManaged: true, _managedAccount: { userId: 'u_acct_A' } },
     { id: 'pgb', _isManaged: true, _managedAccount: { userId: 'u_acct_B' } }],
    [{ id: 'uuid-GA' }, { id: 'uuid-GB' }],
    'uuid-GA'
  );
  const rB = simulateFullScenario(
    [{ id: 'pga', owner_id: 'uuid-GA' }, { id: 'pgb', owner_id: 'uuid-GB' }],
    [{ id: 'pga', _isManaged: true, _managedAccount: { userId: 'u_acct_A' } },
     { id: 'pgb', _isManaged: true, _managedAccount: { userId: 'u_acct_B' } }],
    [{ id: 'uuid-GA' }, { id: 'uuid-GB' }],
    'uuid-GB'
  );
  ok(rA.scope.ownerUserId === 'u_acct_A', 'G-G1 switch A→B: scope A correct');
  ok(rB.scope.ownerUserId === 'u_acct_B', 'G-G2 switch A→B: scope B no stale A');
}

// Case H: delegated → local (ownerUserId resets null)
{
  const r = simulateFullScenario(
    [{ id: 'local-p', owner_id: 'local-c' }],
    [],
    [{ id: 'local-c' }],
    'local-c'
  );
  ok(r.scope.isAgency === false,       'G-H1 delegated→local: isAgency:false');
  ok(r.scope.ownerUserId === null,     'G-H2 delegated→local: ownerUserId:null');
}

// Case I: local → delegated (correct account selected)
{
  const r = simulateFullScenario(
    [{ id: 'pi', owner_id: 'uuid-I' }],
    [{ id: 'pi', _isManaged: true, _managedAccount: { userId: 'u_account_I' } }],
    [{ id: 'uuid-I' }],
    'uuid-I'
  );
  ok(r.scope.isAgency === true,               'G-I1 local→delegated: isAgency:true');
  ok(r.scope.ownerUserId === 'u_account_I',   'G-I2 local→delegated: ownerUserId correct');
}

// ── H. LOGIC: reference case simulation (Saint-Gratien pattern) ──────────

console.log('\n── H. LOGIC: Saint-Gratien reference pattern ────────────────────────────');

// Simulates the exact scenario from production evidence.
// IDs used only because they ARE the test fixture, not hardcoded in production logic.
const r = simulateFullScenario(
  // /api/properties?agency=all returns both Saint-Gratien props with _isManaged:false
  [
    { id: 'u_mt2nuw9l-saint-gratien-rdc',   owner_id: '5001a05b-7aed-4b04-a235-520d60694e9a', name: 'SG RDC' },
    { id: 'u_mt2nuw9l-saint-gratien-etage', owner_id: '5001a05b-7aed-4b04-a235-520d60694e9a', name: 'SG Etage' },
    { id: 'own-other', owner_id: null } // agency's own unrelated prop
  ],
  // /api/agency/managed-properties returns same IDs with authoritative metadata
  [
    { id: 'u_mt2nuw9l-saint-gratien-rdc',   _isManaged: true, _managedAccount: { userId: 'u_mt2nuw9l' } },
    { id: 'u_mt2nuw9l-saint-gratien-etage', _isManaged: true, _managedAccount: { userId: 'u_mt2nuw9l' } }
  ],
  // window.clients after /api/owner-clients
  [{ id: '5001a05b-7aed-4b04-a235-520d60694e9a', first_name: 'B' }],
  '5001a05b-7aed-4b04-a235-520d60694e9a'
);

ok(r.allProperties.length === 3, 'H-01 allProperties: 2 SG props + 1 own = 3');
ok(r.allProperties.filter(function(p) { return p._isManaged; }).length === 2,
   'H-02 managed = 2 (not 0)');

const rdc   = r.allProperties.find(function(p) { return p.id === 'u_mt2nuw9l-saint-gratien-rdc'; });
const etage = r.allProperties.find(function(p) { return p.id === 'u_mt2nuw9l-saint-gratien-etage'; });
ok(rdc   && rdc._isManaged   && rdc._managedAccount.userId === 'u_mt2nuw9l',   'H-03 SG RDC: _isManaged:true, _managedAccount.userId:u_mt2nuw9l');
ok(etage && etage._isManaged && etage._managedAccount.userId === 'u_mt2nuw9l', 'H-04 SG Etage: _isManaged:true, _managedAccount.userId:u_mt2nuw9l');

ok(r.clients[0].delegator_user_id === 'u_mt2nuw9l', 'H-05 client enriched: delegator_user_id=u_mt2nuw9l');
ok(r.isAgencyClient2 === true,                       'H-06 isAgencyClient2:true');
ok(r.scope.isAgency === true,                        'H-07 scopeIsAgency:true');
ok(r.scope.ownerUserId === 'u_mt2nuw9l',             'H-08 ownerUserId:u_mt2nuw9l');
ok(r.allProps.length === 2,                          'H-09 allProps: 2 SG properties');
ok(!r.allProps.some(function(p) { return p.id === 'own-other'; }),
   'H-10 own-other prop NOT in allProps');

// ── I. Prior fixes preserved ───────────────────────────────────────────────

console.log('\n── I. Prior fixes preserved ──────────────────────────────────────────────');

ok(src.includes("String(clientId2).startsWith('agency_client_')"), 'I-01 FIX-02 agency detection');
ok(src.includes('Impossible d&#39;identifier les logements'),      'I-02 FIX-02 fail-closed message');
ok(src.includes('window._importResaOwnerScope') && src.includes('window.closeImportResaModal'), 'I-03 FIX-03 scope');
ok(src.includes('window._importResaOwnerScope = null'),            'I-04 FIX-03 scope reset on close');
ok(src.includes('...(p.currency ? { currency: p.currency } : {})'), 'I-05 INTL-4.4B currency');

{
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const match = serverSrc.match(/app\.post\('\/api\/invoice\/create'[\s\S]+?^\}\);/m);
  if (!match) { ok(false, 'I-06 POST /api/invoice/create not found'); }
  else {
    const ag = match[0].match(/let billingUserId[\s\S]+?let propResult[\s\S]+?try \{[\s\S]+?\} catch\(e\) \{[\s\S]+?\}/)?.[0] || '';
    const pi = ag.indexOf('let propResult = { rows: [] };'), ti = ag.indexOf('try {');
    ok(ag.length > 0 && pi !== -1 && pi < ti, 'I-06 server.js propResult scope fix intact');
  }
}

// ── J. No hardcodes in production logic ───────────────────────────────────

console.log('\n── J. No hardcodes in production logic ───────────────────────────────────');

// Check production functions only — reference-case test (section H) uses the IDs as fixtures
const prodFns = ['openImportReservations', 'closeImportResaModal', 'fetchInvoiceSummary', 'loadClients'];
const banned  = ['u_mt2nuw9l', 'saint-gratien', 'Blandine', 'agency_client_7', '5001a05b'];
prodFns.forEach(function(fnName) {
  var m = src.match(new RegExp('(window\\.' + fnName + '|async function ' + fnName + ')[\\s\\S]+?^\\};', 'm'));
  var fnSrc = m ? m[0] : '';
  banned.forEach(function(word) {
    ok(!fnSrc.includes(word), 'J "' + word + '" absent from ' + fnName);
  });
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`WEB-OWNER-INVOICE-IMPORT-FIX-04: ${passed}/${passed + failed} tests passed`);
if (failed > 0) { console.error(`${failed} test(s) FAILED`); process.exit(1); }
else              { console.log('All tests passed ✅'); }

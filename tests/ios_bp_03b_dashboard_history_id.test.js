/**
 * IOS-BP-03B — Dashboard historyId exposure
 *
 * Verifies that GET /api/dynamic-pricing/dashboard exposes history.historyId
 * (the pricing_history.id PK) so iOS can directly call
 * POST /api/dynamic-pricing/decision/:historyId without a secondary lookup.
 *
 * Pure static analysis — no DB, no network.
 * All assertions operate on source-code text or the pure inline logic below.
 */
'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const ROUTES_PATH   = path.join(__dirname, '../routes/dynamic-pricing-routes.js');
const routesSrc     = fs.readFileSync(ROUTES_PATH, 'utf8');

// ── Inline replica of dashboard history assembly ───────────────────────────
// Mirrors the server logic exactly so assertions can drive it without DB.

function buildHistoryObject(historyRow) {
  if (!historyRow) return null;
  return {
    historyId:       historyRow.id ?? null,
    status:          historyRow.status,
    priceBefore:     parseFloat(historyRow.price_before || 0),
    priceCalculated: parseFloat(historyRow.price_calculated || 0),
    priceApplied:    historyRow.price_applied ? parseFloat(historyRow.price_applied) : null,
    modeUsed:        historyRow.mode_used,
    reason:          historyRow.reason,
    factorMarket:    parseFloat(historyRow.factor_market || 1),
    factorSelf:      parseFloat(historyRow.factor_self || 1),
    factorSeason:    parseFloat(historyRow.factor_season || 1),
    appliedAt:       historyRow.applied_at,
  };
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const PENDING_ROW = {
  id:               42,
  property_id:      'prop-A',
  price_before:     '120',
  price_calculated: '135',
  price_applied:    null,
  status:           'pending',
  mode_used:        'auto',
  reason:           'market_tension',
  factor_market:    '1.12',
  factor_self:      '1.00',
  factor_season:    '1.05',
  applied_at:       null,
};

const APPLIED_ROW = {
  id:               77,
  property_id:      'prop-B',
  price_before:     '100',
  price_calculated: '115',
  price_applied:    '115',
  status:           'applied',
  mode_used:        'manual',
  reason:           'user_accepted',
  factor_market:    '1.15',
  factor_self:      '1.00',
  factor_season:    '1.00',
  applied_at:       '2026-09-29T10:00:00Z',
};

// ── [A] historyId present for pending history ──────────────────────────────

{
  const h = buildHistoryObject(PENDING_ROW);
  assert.ok('historyId' in h, '[A-01] historyId key present for pending row');
  assert.strictEqual(h.historyId, 42, '[A-02] historyId equals pricing_history.id for pending row');
}

// ── [B] historyId present for applied history ──────────────────────────────

{
  const h = buildHistoryObject(APPLIED_ROW);
  assert.ok('historyId' in h, '[B-01] historyId key present for applied row');
  assert.strictEqual(h.historyId, 77, '[B-02] historyId equals pricing_history.id for applied row');
}

// ── [C] historyId type is a number ────────────────────────────────────────

{
  const h = buildHistoryObject(PENDING_ROW);
  assert.strictEqual(typeof h.historyId, 'number', '[C-01] historyId is numeric');
}

// ── [D] history is null when no history row ────────────────────────────────

{
  const h = buildHistoryObject(null);
  assert.strictEqual(h, null, '[D-01] null history row produces null, not object with historyId');
}

// ── [E] historyId null-safe when row has no id (defensive) ────────────────

{
  const rowNoId = { ...PENDING_ROW };
  delete rowNoId.id;
  const h = buildHistoryObject(rowNoId);
  assert.strictEqual(h.historyId, null, '[E-01] historyId falls back to null when id is missing');
}

// ── [F] multi-property: each property gets its own historyId ──────────────

{
  const rows = [PENDING_ROW, APPLIED_ROW];
  const historyMap = {};
  rows.forEach(r => { historyMap[r.property_id] = r; });

  const hA = buildHistoryObject(historyMap['prop-A']);
  const hB = buildHistoryObject(historyMap['prop-B']);

  assert.strictEqual(hA.historyId, 42, '[F-01] prop-A historyId = 42');
  assert.strictEqual(hB.historyId, 77, '[F-02] prop-B historyId = 77');
  assert.notStrictEqual(hA.historyId, hB.historyId, '[F-03] distinct properties get distinct historyIds');
}

// ── [G] existing history fields still present (backwards compat) ──────────

{
  const h = buildHistoryObject(PENDING_ROW);
  const legacyFields = [
    'status','priceBefore','priceCalculated','priceApplied',
    'modeUsed','reason','factorMarket','factorSelf','factorSeason','appliedAt',
  ];
  for (const f of legacyFields) {
    assert.ok(f in h, `[G-01] legacy field '${f}' still present`);
  }
}

// ── [H] historyId is the FIRST field in the history object ────────────────
// Convention: new additive fields go first so diffs are obvious.

{
  const h = buildHistoryObject(PENDING_ROW);
  const keys = Object.keys(h);
  assert.strictEqual(keys[0], 'historyId', '[H-01] historyId is first key in history object');
}

// ── [I] Source: ph.id selected in dashboard SQL ───────────────────────────

{
  // Locate the histories query block
  const dashIdx = routesSrc.indexOf("GET /api/dynamic-pricing/dashboard");
  assert.ok(dashIdx >= 0, '[I-01] dashboard route block found');

  // Find the histories SELECT within the dashboard block (not the history pagination query)
  const histBlock = routesSrc.indexOf('FROM pricing_history ph', dashIdx);
  assert.ok(histBlock >= 0, '[I-02] pricing_history ph reference found in dashboard');

  // Walk back to the SELECT keyword
  const selectIdx = routesSrc.lastIndexOf('SELECT', histBlock);
  const selectClause = routesSrc.slice(selectIdx, histBlock + 200);

  assert.ok(/\bph\.id\b/.test(selectClause), '[I-03] ph.id selected in dashboard histories SQL');
}

// ── [J] Source: historyId exposed in history object in routes source ───────

{
  const histObjIdx = routesSrc.indexOf("history: history ? {");
  assert.ok(histObjIdx >= 0, '[J-01] history object literal found in routes source');

  const histObjSlice = routesSrc.slice(histObjIdx, histObjIdx + 600);
  assert.ok(/historyId\s*:/.test(histObjSlice), '[J-02] historyId key exposed in history response object');
  assert.ok(/history\.id/.test(histObjSlice), '[J-03] historyId wired to history.id');
}

// ── [K] Decision endpoint uses historyId (ph.id) as lookup key ────────────

{
  const decisionIdx = routesSrc.indexOf("POST /api/dynamic-pricing/decision/:historyId");
  assert.ok(decisionIdx >= 0, '[K-01] decision endpoint comment found');

  const decisionBlock = routesSrc.slice(decisionIdx, decisionIdx + 1500);
  assert.ok(/parseInt\(req\.params\.historyId\)/.test(decisionBlock),
    '[K-02] decision endpoint parses historyId from URL param');
  assert.ok(/WHERE ph\.id = \$1/.test(decisionBlock),
    '[K-03] decision endpoint looks up pricing_history by ph.id');
}

// ── [L] historyId usable: pending rows have it, applied rows have it ───────

{
  const pending  = buildHistoryObject(PENDING_ROW);
  const applied  = buildHistoryObject(APPLIED_ROW);

  assert.ok(pending.historyId !== null && pending.status === 'pending',
    '[L-01] pending history has a non-null historyId');
  assert.ok(applied.historyId !== null && applied.status === 'applied',
    '[L-02] applied history has a non-null historyId (for reference/audit)');
}

// ── [M] historyId does not bleed into market or config fields ─────────────

{
  // Verify historyId key is in the history sub-object, not in market or config blocks.
  // Locate the market object literal and ensure historyId is not inside it.
  const marketObjIdx = routesSrc.indexOf('market: market ? {');
  assert.ok(marketObjIdx >= 0, '[M-01] market object literal found');

  // Find the closing of the market block (ends at "} : null," before history:)
  const historyObjIdx = routesSrc.indexOf('history: history ? {');
  assert.ok(historyObjIdx > marketObjIdx, '[M-02] history block is after market block');

  const marketBlock = routesSrc.slice(marketObjIdx, historyObjIdx);
  assert.ok(!/historyId\s*:/.test(marketBlock), '[M-03] historyId not present in market block');
}

console.log('✅  IOS-BP-03B: all tests passed');

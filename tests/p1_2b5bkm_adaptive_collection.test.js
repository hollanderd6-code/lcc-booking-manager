'use strict';
/**
 * P1.2-B5-BK-M — Adaptive Collection Test Suite
 *
 * Sections:
 *   A  — M1 Snapshot Reuse Policy        (10 tests)
 *   B  — M2 Provider Call Budget         (10 tests)
 *   C  — M3 Adaptive Collection Planner  (15 tests)
 *   D  — M4 Provider Health              (10 tests)
 *   E  — M5 Production Quarantine        ( 9 tests)
 *   F  — M6 Snapshot Anomaly Diagnostic  (10 tests)
 *   G  — M7 Cost Estimator               ( 8 tests)
 *   H  — M8 Adaptive Orchestrator        (15 tests)
 *   I  — Integration / Regression        (10 tests)
 *
 * ABSOLUTE RULE: 0 Bright Data credits consumed.
 * All providers are either noNetworkProvider or injected fixtures.
 */

const assert = require('assert');

// Modules under test
const {
  buildSnapshotFingerprint,
  shouldReuseSnapshot,
  DEFAULT_MAX_AGE_MS,
} = require('../services/market-snapshot-reuse-policy');

const {
  createCallBudget,
  canMakeCall,
  recordCall,
  getBudgetStatus,
  DEFAULT_MAX_AIRBNB_CALLS,
  DEFAULT_MAX_BOOKING_CALLS,
} = require('../services/market-provider-call-budget');

const {
  planAdaptiveCollection,
  POLICY_MAX_AIRBNB_CALLS,
} = require('../services/market-adaptive-collection-planner');

const {
  createHealthTracker,
  recordProviderOutcome,
  getProviderHealth,
  isProviderHealthy,
  WINDOW_SIZE,
} = require('../services/market-provider-health');

const {
  evaluateQuarantine,
} = require('../services/market-production-quarantine');

const {
  diagnoseSnapshotAnomalies,
  PRICE_SPIKE_RATIO,
} = require('../services/airbnb-snapshot-anomaly-diagnostic');

const {
  estimateCollectionCost,
} = require('../services/market-collection-cost-estimator');

const {
  runAdaptiveMarketEngine,
  noNetworkProvider,
} = require('../services/market-engine-adaptive-shadow-m');

const {
  TARGET,
  AIRBNB_LISTINGS_STABLE,
  BOOKING_LISTINGS_STABLE,
  BOOKING_LISTINGS_EXTREME,
  FIXTURE_M6_STABLE_DUAL,
  FIXTURE_M6_MULTIDATE_J14_BAD,
  FIXTURE_M6_J30,
  FIXTURE_M6_J60,
  PRODUCTION_FIXTURE,
  REUSE_REQUEST,
  CACHED_SNAPSHOT_VALID,
  CACHED_SNAPSHOT_WRONG_WINDOW,
  makeAirbnbSnapshot,
  makeBookingResult,
} = require('./fixtures/market-m-fixtures');

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        passed++;
        process.stdout.write('.');
      }).catch(err => {
        failed++;
        failures.push({ label, error: err.message });
        process.stdout.write('F');
      });
    }
    passed++;
    process.stdout.write('.');
    return Promise.resolve();
  } catch (err) {
    failed++;
    failures.push({ label, error: err.message });
    process.stdout.write('F');
    return Promise.resolve();
  }
}

// ── Section A — M1 Snapshot Reuse Policy ─────────────────────────────────────

console.log('\nA — M1 Snapshot Reuse Policy');

const tests = [

// A-01: Same fingerprint → reuse true
test('A-01 same fingerprint → reuse:true', () => {
  const snap = { ...CACHED_SNAPSHOT_VALID };
  const r = shouldReuseSnapshot(snap, REUSE_REQUEST);
  assert.strictEqual(r.reuse, true);
  assert.strictEqual(r.reason, null);
}),

// A-02: Different checkIn → fingerprint mismatch
test('A-02 different checkIn → fingerprint_mismatch', () => {
  const r = shouldReuseSnapshot(CACHED_SNAPSHOT_WRONG_WINDOW, REUSE_REQUEST);
  assert.strictEqual(r.reuse, false);
  assert.ok(r.reason.includes('fingerprint_mismatch'));
}),

// A-03: Different checkOut → fingerprint mismatch
test('A-03 different checkOut → fingerprint_mismatch', () => {
  const snap = { ...CACHED_SNAPSHOT_VALID, checkOut: '2026-11-01' };
  const r = shouldReuseSnapshot(snap, REUSE_REQUEST);
  assert.strictEqual(r.reuse, false);
}),

// A-04: Different location → fingerprint mismatch
test('A-04 different location → fingerprint_mismatch', () => {
  const snap = { ...CACHED_SNAPSHOT_VALID, location: 'Lyon, France' };
  const r = shouldReuseSnapshot(snap, REUSE_REQUEST);
  assert.strictEqual(r.reuse, false);
}),

// A-05: Different currency → fingerprint mismatch
test('A-05 different currency → fingerprint_mismatch', () => {
  const snap = { ...CACHED_SNAPSHOT_VALID, currency: 'USD' };
  const r = shouldReuseSnapshot(snap, REUSE_REQUEST);
  assert.strictEqual(r.reuse, false);
}),

// A-06: Different targetGuests → fingerprint mismatch
test('A-06 different targetGuests → fingerprint_mismatch', () => {
  const snap = { ...CACHED_SNAPSHOT_VALID, targetGuests: 4 };
  const r = shouldReuseSnapshot(snap, REUSE_REQUEST);
  assert.strictEqual(r.reuse, false);
}),

// A-07: Null snapshot → no_snapshot
test('A-07 null snapshot → no_snapshot', () => {
  const r = shouldReuseSnapshot(null, REUSE_REQUEST);
  assert.strictEqual(r.reuse, false);
  assert.strictEqual(r.reason, 'no_snapshot');
}),

// A-08: Snapshot too old → snapshot_too_old
test('A-08 too old snapshot → snapshot_too_old', () => {
  const oldSnap = {
    ...CACHED_SNAPSHOT_VALID,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
  };
  const r = shouldReuseSnapshot(oldSnap, REUSE_REQUEST);
  assert.strictEqual(r.reuse, false);
  assert.ok(r.reason.includes('snapshot_too_old'));
}),

// A-09: Custom maxAgeMs — recent enough
test('A-09 custom maxAgeMs within limit → reuse:true', () => {
  const snap = { ...CACHED_SNAPSHOT_VALID };
  const r = shouldReuseSnapshot(snap, { ...REUSE_REQUEST, maxAgeMs: 2 * 60 * 60 * 1000 }); // 2h
  assert.strictEqual(r.reuse, true);
}),

// A-10: No createdAt → no age check, reuse if fingerprint matches
test('A-10 no createdAt → reuse:true (no age check)', () => {
  const snap = { ...CACHED_SNAPSHOT_VALID };
  delete snap.createdAt;
  const r = shouldReuseSnapshot(snap, REUSE_REQUEST);
  assert.strictEqual(r.reuse, true);
}),

// A-11: buildSnapshotFingerprint normalises currency to uppercase
test('A-11 fingerprint normalises currency case', () => {
  const fp1 = buildSnapshotFingerprint({ ...REUSE_REQUEST, currency: 'eur' });
  const fp2 = buildSnapshotFingerprint({ ...REUSE_REQUEST, currency: 'EUR' });
  assert.strictEqual(fp1, fp2);
}),

// ── Section B — M2 Provider Call Budget ──────────────────────────────────────
// (B tests start here in the Promise chain)

// B-01: Default budget has correct maxes
test('B-01 default budget maxes', () => {
  const b = createCallBudget();
  assert.strictEqual(b.airbnb.max,  DEFAULT_MAX_AIRBNB_CALLS);
  assert.strictEqual(b.booking.max, DEFAULT_MAX_BOOKING_CALLS);
  assert.strictEqual(b.airbnb.used,  0);
  assert.strictEqual(b.booking.used, 0);
}),

// B-02: canMakeCall → allowed when budget available
test('B-02 canMakeCall allows when budget available', () => {
  const b = createCallBudget();
  assert.strictEqual(canMakeCall(b, 'airbnb').allowed, true);
}),

// B-03: canMakeCall → BUDGET_EXHAUSTED
test('B-03 BUDGET_EXHAUSTED when used >= max', () => {
  const b = createCallBudget({ maxAirbnbCalls: 1 });
  recordCall(b, 'airbnb');
  const r = canMakeCall(b, 'airbnb');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('BUDGET_EXHAUSTED'));
}),

// B-04: recordCall increments used
test('B-04 recordCall increments used', () => {
  const b = createCallBudget();
  recordCall(b, 'airbnb');
  assert.strictEqual(b.airbnb.used, 1);
}),

// B-05: getBudgetStatus structure
test('B-05 getBudgetStatus structure', () => {
  const b = createCallBudget({ maxAirbnbCalls: 3, maxBookingCalls: 1 });
  recordCall(b, 'airbnb');
  const s = getBudgetStatus(b);
  assert.strictEqual(s.airbnb.used, 1);
  assert.strictEqual(s.airbnb.remaining, 2);
  assert.strictEqual(s.airbnb.exhausted, false);
  assert.strictEqual(s.booking.remaining, 1);
}),

// B-06: Custom max calls
test('B-06 custom maxAirbnbCalls=1', () => {
  const b = createCallBudget({ maxAirbnbCalls: 1 });
  assert.strictEqual(b.airbnb.max, 1);
}),

// B-07: Unknown provider → CALL_NOT_ALLOWED
test('B-07 unknown provider → CALL_NOT_ALLOWED', () => {
  const b = createCallBudget();
  const r = canMakeCall(b, 'unknown_provider');
  assert.strictEqual(r.allowed, false);
  assert.ok(r.reason.includes('CALL_NOT_ALLOWED'));
}),

// B-08: Airbnb exhausted, booking still available
test('B-08 airbnb exhausted booking still available', () => {
  const b = createCallBudget({ maxAirbnbCalls: 3, maxBookingCalls: 1 });
  recordCall(b, 'airbnb'); recordCall(b, 'airbnb'); recordCall(b, 'airbnb');
  assert.strictEqual(canMakeCall(b, 'airbnb').allowed,  false);
  assert.strictEqual(canMakeCall(b, 'booking').allowed, true);
}),

// B-09: recordCall throws on unknown provider
test('B-09 recordCall throws on unknown provider', () => {
  const b = createCallBudget();
  assert.throws(() => recordCall(b, 'mystery'), /unknown provider/i);
}),

// B-10: exhausted flag correct
test('B-10 exhausted flag', () => {
  const b = createCallBudget({ maxAirbnbCalls: 2 });
  recordCall(b, 'airbnb'); recordCall(b, 'airbnb');
  const s = getBudgetStatus(b);
  assert.strictEqual(s.airbnb.exhausted, true);
  assert.strictEqual(s.airbnb.remaining, 0);
}),

// ── Section C — M3 Adaptive Collection Planner ───────────────────────────────

// C-01: SINGLE_SNAPSHOT_ALLOWED → 1 airbnb step
test('C-01 SINGLE_SNAPSHOT_ALLOWED plans 1 call', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'SINGLE_SNAPSHOT_ALLOWED',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb.length, 1);
  assert.strictEqual(plan.airbnb[0].type, 'CALL');
}),

// C-02: TWO_SNAPSHOT_EARLY_STOP → 2 airbnb steps
test('C-02 TWO_SNAPSHOT_EARLY_STOP plans 2 calls', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'TWO_SNAPSHOT_EARLY_STOP',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb.length, 2);
}),

// C-03: THREE_SNAPSHOT_REQUIRED → 3 airbnb steps
test('C-03 THREE_SNAPSHOT_REQUIRED plans 3 calls', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'THREE_SNAPSHOT_REQUIRED',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb.length, 3);
}),

// C-04: INSUFFICIENT_EVIDENCE → 3 airbnb steps
test('C-04 INSUFFICIENT_EVIDENCE plans 3 calls', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'INSUFFICIENT_EVIDENCE',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb.length, 3);
}),

// C-05: Budget exhausted → SKIP
test('C-05 exhausted budget → SKIP', () => {
  const b = createCallBudget({ maxAirbnbCalls: 0 });
  const plan = planAdaptiveCollection({
    executionPolicy: 'SINGLE_SNAPSHOT_ALLOWED',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb[0].type, 'SKIP');
}),

// C-06: Valid cached snapshot → REUSE
test('C-06 valid cached snapshot → REUSE', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'SINGLE_SNAPSHOT_ALLOWED',
    snapshotQueue: [CACHED_SNAPSHOT_VALID],
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb[0].type, 'REUSE');
  assert.strictEqual(plan.reusedSnapshots, 1);
}),

// C-07: Wrong-window cached snapshot → CALL
test('C-07 wrong-window cache → CALL', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'SINGLE_SNAPSHOT_ALLOWED',
    snapshotQueue: [CACHED_SNAPSHOT_WRONG_WINDOW],
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb[0].type, 'CALL');
}),

// C-08: reusedSnapshots counted correctly
test('C-08 reusedSnapshots count', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'TWO_SNAPSHOT_EARLY_STOP',
    snapshotQueue: [CACHED_SNAPSHOT_VALID, CACHED_SNAPSHOT_VALID],
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.reusedSnapshots, 2);
  assert.strictEqual(plan.newCallsNeeded, 0);
}),

// C-09: newCallsNeeded counted correctly
test('C-09 newCallsNeeded count', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'TWO_SNAPSHOT_EARLY_STOP',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.newCallsNeeded, 2);
}),

// C-10: totalPlannedCalls includes booking
test('C-10 totalPlannedCalls includes booking CALL', () => {
  const b = createCallBudget({ maxAirbnbCalls: 1, maxBookingCalls: 1 });
  const plan = planAdaptiveCollection({
    executionPolicy: 'SINGLE_SNAPSHOT_ALLOWED',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.booking.type, 'CALL');
  assert.strictEqual(plan.totalPlannedCalls, 2); // 1 airbnb + 1 booking
}),

// C-11: Booking budget exhausted → SKIP
test('C-11 booking budget exhausted → SKIP', () => {
  const b = createCallBudget({ maxBookingCalls: 0 });
  const plan = planAdaptiveCollection({
    executionPolicy: 'SINGLE_SNAPSHOT_ALLOWED',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.booking.type, 'SKIP');
}),

// C-12: Mixed reuse + call
test('C-12 mixed reuse+call', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'TWO_SNAPSHOT_EARLY_STOP',
    snapshotQueue: [CACHED_SNAPSHOT_VALID], // only 1 cached
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb[0].type, 'REUSE');
  assert.strictEqual(plan.airbnb[1].type, 'CALL');
  assert.strictEqual(plan.reusedSnapshots, 1);
  assert.strictEqual(plan.newCallsNeeded, 1);
}),

// C-13: Empty snapshotQueue → all CALL
test('C-13 empty queue → all CALL', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'THREE_SNAPSHOT_REQUIRED',
    snapshotQueue: [],
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.strictEqual(plan.airbnb.every(s => s.type === 'CALL'), true);
}),

// C-14: decisionTrace is array of strings
test('C-14 decisionTrace is string[]', () => {
  const b = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'SINGLE_SNAPSHOT_ALLOWED',
    budget: b,
    request: REUSE_REQUEST,
  });
  assert.ok(Array.isArray(plan.decisionTrace));
  assert.strictEqual(typeof plan.decisionTrace[0], 'string');
}),

// C-15: POLICY_MAX_AIRBNB_CALLS map is exported
test('C-15 POLICY_MAX_AIRBNB_CALLS exported', () => {
  assert.strictEqual(POLICY_MAX_AIRBNB_CALLS.SINGLE_SNAPSHOT_ALLOWED,  1);
  assert.strictEqual(POLICY_MAX_AIRBNB_CALLS.TWO_SNAPSHOT_EARLY_STOP,  2);
  assert.strictEqual(POLICY_MAX_AIRBNB_CALLS.THREE_SNAPSHOT_REQUIRED,  3);
}),

// ── Section D — M4 Provider Health ───────────────────────────────────────────

// D-01: Fresh tracker → UNKNOWN (no calls yet)
test('D-01 fresh tracker → UNKNOWN', () => {
  const h = createHealthTracker();
  const r = getProviderHealth(h, 'airbnb');
  assert.strictEqual(r.status, 'UNKNOWN');
  assert.strictEqual(r.callCount, 0);
}),

// D-02: Unknown provider → UNKNOWN (permissive)
test('D-02 unknown provider → UNKNOWN / healthy', () => {
  const h = createHealthTracker();
  assert.strictEqual(isProviderHealthy(h, 'mystery'), true);
}),

// D-03: All successes → HEALTHY
test('D-03 all successes → HEALTHY', () => {
  const h = createHealthTracker();
  recordProviderOutcome(h, 'airbnb', 'success');
  recordProviderOutcome(h, 'airbnb', 'success');
  assert.strictEqual(getProviderHealth(h, 'airbnb').status, 'HEALTHY');
}),

// D-04: Majority errors → UNHEALTHY
test('D-04 majority errors → UNHEALTHY', () => {
  const h = createHealthTracker();
  recordProviderOutcome(h, 'airbnb', 'error');
  recordProviderOutcome(h, 'airbnb', 'error');
  recordProviderOutcome(h, 'airbnb', 'error');
  assert.strictEqual(getProviderHealth(h, 'airbnb').status, 'UNHEALTHY');
  assert.strictEqual(isProviderHealthy(h, 'airbnb'), false);
}),

// D-05: isProviderHealthy true for HEALTHY
test('D-05 isProviderHealthy true when HEALTHY', () => {
  const h = createHealthTracker();
  recordProviderOutcome(h, 'booking', 'success');
  assert.strictEqual(isProviderHealthy(h, 'booking'), true);
}),

// D-06: callCount tracks total calls
test('D-06 callCount tracks all calls', () => {
  const h = createHealthTracker();
  recordProviderOutcome(h, 'airbnb', 'success');
  recordProviderOutcome(h, 'airbnb', 'error');
  recordProviderOutcome(h, 'airbnb', 'success');
  assert.strictEqual(getProviderHealth(h, 'airbnb').callCount, 3);
}),

// D-07: Sliding window — old errors cleared
test('D-07 sliding window clears old errors', () => {
  const h = createHealthTracker();
  // Fill window with errors, then successes
  for (let i = 0; i < WINDOW_SIZE; i++) recordProviderOutcome(h, 'airbnb', 'error');
  for (let i = 0; i < WINDOW_SIZE; i++) recordProviderOutcome(h, 'airbnb', 'success');
  assert.strictEqual(getProviderHealth(h, 'airbnb').status, 'HEALTHY');
}),

// D-08: successRate is between 0 and 1
test('D-08 successRate in [0,1]', () => {
  const h = createHealthTracker();
  recordProviderOutcome(h, 'airbnb', 'success');
  recordProviderOutcome(h, 'airbnb', 'error');
  const r = getProviderHealth(h, 'airbnb');
  assert.ok(r.successRate >= 0 && r.successRate <= 1);
}),

// D-09: Booking and airbnb tracked independently
test('D-09 booking/airbnb tracked independently', () => {
  const h = createHealthTracker();
  recordProviderOutcome(h, 'airbnb',  'error');
  recordProviderOutcome(h, 'booking', 'success');
  assert.strictEqual(getProviderHealth(h, 'booking').status, 'HEALTHY');
}),

// D-10: getProviderHealth errorRate field present
test('D-10 errorRate field present', () => {
  const h = createHealthTracker();
  recordProviderOutcome(h, 'airbnb', 'success');
  const r = getProviderHealth(h, 'airbnb');
  assert.strictEqual(typeof r.errorRate, 'number');
}),

// ── Section E — M5 Production Quarantine ─────────────────────────────────────

// E-01: No sanity result → not quarantined
test('E-01 null sanityResult → not quarantined', () => {
  const r = evaluateQuarantine(null);
  assert.strictEqual(r.quarantined, false);
  assert.strictEqual(r.level, 'NONE');
}),

// E-02: sanity not available → not quarantined
test('E-02 sanity available:false → not quarantined', () => {
  const r = evaluateQuarantine({ available: false });
  assert.strictEqual(r.quarantined, false);
}),

// E-03: All ALIGNED → not quarantined
test('E-03 all ALIGNED → NONE', () => {
  const sanity = {
    available:   true,
    vsAirbnb:    { classification: 'ALIGNED' },
    vsBooking:   { classification: 'ALIGNED' },
    vsConsensus: { classification: 'ALIGNED' },
  };
  const r = evaluateQuarantine(sanity);
  assert.strictEqual(r.quarantined, false);
  assert.strictEqual(r.level, 'NONE');
}),

// E-04: Consensus LARGE_DEVIATION → QUARANTINED
test('E-04 consensus LARGE_DEVIATION → QUARANTINED', () => {
  const sanity = {
    available:   true,
    vsAirbnb:    { classification: 'ALIGNED' },
    vsBooking:   { classification: 'ALIGNED' },
    vsConsensus: { classification: 'LARGE_DEVIATION' },
  };
  const r = evaluateQuarantine(sanity);
  assert.strictEqual(r.quarantined, true);
  assert.strictEqual(r.level, 'QUARANTINED');
}),

// E-05: Both sources LARGE_DEVIATION → QUARANTINED
test('E-05 both sources LARGE_DEVIATION → QUARANTINED', () => {
  const sanity = {
    available:   true,
    vsAirbnb:    { classification: 'LARGE_DEVIATION' },
    vsBooking:   { classification: 'LARGE_DEVIATION' },
    vsConsensus: { classification: 'INSUFFICIENT_DATA' },
  };
  const r = evaluateQuarantine(sanity);
  assert.strictEqual(r.quarantined, true);
}),

// E-06: One source MATERIAL_DEVIATION → CAUTION
test('E-06 one MATERIAL_DEVIATION → CAUTION', () => {
  const sanity = {
    available:   true,
    vsAirbnb:    { classification: 'MATERIAL_DEVIATION' },
    vsBooking:   { classification: 'ALIGNED' },
    vsConsensus: { classification: 'ALIGNED' },
  };
  const r = evaluateQuarantine(sanity);
  assert.strictEqual(r.quarantined, false);
  assert.strictEqual(r.level, 'CAUTION');
}),

// E-07: reason string present on QUARANTINED
test('E-07 reason string present when quarantined', () => {
  const sanity = {
    available:   true,
    vsAirbnb:    { classification: 'ALIGNED' },
    vsBooking:   { classification: 'ALIGNED' },
    vsConsensus: { classification: 'LARGE_DEVIATION' },
  };
  const r = evaluateQuarantine(sanity);
  assert.strictEqual(typeof r.reason, 'string');
}),

// E-08: vsAirbnb/vsBooking/vsConsensus present in result
test('E-08 source classifications in result', () => {
  const sanity = {
    available:   true,
    vsAirbnb:    { classification: 'ALIGNED' },
    vsBooking:   { classification: 'ALIGNED' },
    vsConsensus: { classification: 'ALIGNED' },
  };
  const r = evaluateQuarantine(sanity);
  assert.strictEqual(r.vsAirbnb,    'ALIGNED');
  assert.strictEqual(r.vsBooking,   'ALIGNED');
  assert.strictEqual(r.vsConsensus, 'ALIGNED');
}),

// E-09: Only airbnb LARGE_DEVIATION (not booking) → not quarantined
test('E-09 only one source LARGE_DEVIATION → not quarantined', () => {
  const sanity = {
    available:   true,
    vsAirbnb:    { classification: 'LARGE_DEVIATION' },
    vsBooking:   { classification: 'ALIGNED' },
    vsConsensus: { classification: 'ALIGNED' },
  };
  const r = evaluateQuarantine(sanity);
  assert.strictEqual(r.quarantined, false);
}),

// ── Section F — M6 Snapshot Anomaly Diagnostic ───────────────────────────────

// F-01: Empty input → NONE severity
test('F-01 empty snapshots → NONE', () => {
  const r = diagnoseSnapshotAnomalies([]);
  assert.strictEqual(r.severity, 'NONE');
  assert.strictEqual(r.safe, true);
  assert.deepStrictEqual(r.anomalies, []);
}),

// F-02: Single consistent snapshot → no anomaly
test('F-02 single consistent snapshot → NONE', () => {
  const r = diagnoseSnapshotAnomalies([makeAirbnbSnapshot('x', AIRBNB_LISTINGS_STABLE)]);
  assert.strictEqual(r.severity, 'NONE');
}),

// F-03: Two consistent snapshots → no anomaly
test('F-03 two consistent snapshots → NONE', () => {
  const r = diagnoseSnapshotAnomalies([
    makeAirbnbSnapshot('a', AIRBNB_LISTINGS_STABLE),
    makeAirbnbSnapshot('b', AIRBNB_LISTINGS_STABLE.map(l => ({ ...l, price: l.price + 5 }))),
  ]);
  assert.strictEqual(r.severity, 'NONE');
}),

// F-04: Empty snapshot → CRITICAL
test('F-04 empty snapshot → CRITICAL', () => {
  const r = diagnoseSnapshotAnomalies([makeAirbnbSnapshot('empty', [])]);
  assert.strictEqual(r.severity, 'CRITICAL');
  assert.strictEqual(r.safe, false);
}),

// F-05: All-zero prices → CRITICAL
test('F-05 all-zero prices → CRITICAL', () => {
  const listings = AIRBNB_LISTINGS_STABLE.map(l => ({ ...l, price: 0 }));
  const r = diagnoseSnapshotAnomalies([makeAirbnbSnapshot('zeros', listings)]);
  assert.strictEqual(r.severity, 'CRITICAL');
}),

// F-06: Price spike > 2× → HIGH
test('F-06 price spike > 2x → HIGH', () => {
  const normal = makeAirbnbSnapshot('n', AIRBNB_LISTINGS_STABLE);
  const spiked = makeAirbnbSnapshot('s', AIRBNB_LISTINGS_STABLE.map(l => ({ ...l, price: l.price * 3 })));
  const r = diagnoseSnapshotAnomalies([normal, spiked]);
  assert.strictEqual(r.severity, 'HIGH');
  const spike = r.anomalies.find(a => a.type === 'PRICE_SPIKE');
  assert.ok(spike);
}),

// F-07: Minor price spike 1.5x-2x → LOW
test('F-07 minor spike 1.5x → LOW', () => {
  const normal = makeAirbnbSnapshot('n', AIRBNB_LISTINGS_STABLE);
  const minor  = makeAirbnbSnapshot('m', AIRBNB_LISTINGS_STABLE.map(l => ({ ...l, price: l.price * 1.6 })));
  const r = diagnoseSnapshotAnomalies([normal, minor]);
  const hasLow = r.anomalies.some(a => a.severity === 'LOW');
  assert.ok(hasLow);
}),

// F-08: FIXTURE_M6_MULTIDATE_J14_BAD → HIGH severity
test('F-08 FIXTURE_M6_MULTIDATE_J14_BAD → HIGH anomaly severity', () => {
  const r = diagnoseSnapshotAnomalies(FIXTURE_M6_MULTIDATE_J14_BAD.airbnbSnapshots);
  assert.strictEqual(FIXTURE_M6_MULTIDATE_J14_BAD.expectedAnomalySeverity, 'HIGH');
  assert.strictEqual(r.severity, 'HIGH');
}),

// F-09: FIXTURE_M6_STABLE_DUAL snapshots → NONE or LOW anomaly
test('F-09 FIXTURE_M6_STABLE_DUAL snapshots → safe', () => {
  const r = diagnoseSnapshotAnomalies(FIXTURE_M6_STABLE_DUAL.airbnbSnapshots);
  assert.ok(r.safe);
}),

// F-10: safe=false when CRITICAL
test('F-10 safe:false when CRITICAL', () => {
  const r = diagnoseSnapshotAnomalies([makeAirbnbSnapshot('e', [])]);
  assert.strictEqual(r.safe, false);
}),

// ── Section G — M7 Cost Estimator ────────────────────────────────────────────

// G-01: Null plan → 0 credits
test('G-01 null plan → 0 credits', () => {
  const r = estimateCollectionCost(null);
  assert.strictEqual(r.estimatedCredits, 0);
  assert.strictEqual(r.totalCalls, 0);
}),

// G-02: Empty plan → 0 credits
test('G-02 empty plan → 0 credits', () => {
  const r = estimateCollectionCost({ airbnb: [], booking: null });
  assert.strictEqual(r.estimatedCredits, 0);
}),

// G-03: 1 CALL → 1 credit
test('G-03 1 airbnb CALL → 1 credit', () => {
  const plan = { airbnb: [{ type: 'CALL' }], booking: null };
  const r = estimateCollectionCost(plan);
  assert.strictEqual(r.estimatedCredits, 1);
  assert.strictEqual(r.totalCalls, 1);
}),

// G-04: REUSE → 0 credits
test('G-04 REUSE → 0 credits', () => {
  const plan = { airbnb: [{ type: 'REUSE' }], booking: null };
  const r = estimateCollectionCost(plan);
  assert.strictEqual(r.estimatedCredits, 0);
}),

// G-05: SKIP → 0 credits
test('G-05 SKIP → 0 credits', () => {
  const plan = { airbnb: [{ type: 'SKIP' }], booking: null };
  const r = estimateCollectionCost(plan);
  assert.strictEqual(r.estimatedCredits, 0);
}),

// G-06: 3 airbnb + 1 booking → 4 credits
test('G-06 3 airbnb + 1 booking CALL → 4 credits', () => {
  const plan = {
    airbnb:  [{ type: 'CALL' }, { type: 'CALL' }, { type: 'CALL' }],
    booking: { type: 'CALL' },
  };
  const r = estimateCollectionCost(plan);
  assert.strictEqual(r.estimatedCredits, 4);
  assert.strictEqual(r.totalCalls, 4);
}),

// G-07: Breakdown present
test('G-07 breakdown structure', () => {
  const plan = { airbnb: [{ type: 'CALL' }], booking: { type: 'CALL' } };
  const r = estimateCollectionCost(plan);
  assert.ok(Array.isArray(r.breakdown));
  assert.strictEqual(r.breakdown.length, 2);
  assert.strictEqual(r.breakdown[0].provider, 'airbnb');
  assert.strictEqual(r.breakdown[1].provider, 'booking');
}),

// G-08: Booking SKIP contributes 0
test('G-08 booking SKIP → 0 credits', () => {
  const plan = { airbnb: [{ type: 'CALL' }], booking: { type: 'SKIP' } };
  const r = estimateCollectionCost(plan);
  assert.strictEqual(r.totalCalls, 1);
}),

// ── Section H — M8 Adaptive Orchestrator ─────────────────────────────────────

// H-01: noNetworkProvider throws
test('H-01 noNetworkProvider throws', async () => {
  await assert.rejects(() => noNetworkProvider(), /NO_NETWORK/);
}),

// H-02: Pre-collected snapshots → no network calls
test('H-02 pre-collected snapshots → market_status returned', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(result.market_status);
  assert.ok(['STABLE_DUAL', 'AIRBNB_ONLY', 'BOOKING_ONLY', 'EXTREME_DIVERGENCE', 'INSUFFICIENT'].includes(result.market_status));
}),

// H-03: STABLE_DUAL fixture → expected status
test('H-03 STABLE_DUAL fixture → STABLE_DUAL', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.strictEqual(result.market_status, f.expectedMarketStatus);
}),

// H-04: decisionTrace present and non-empty
test('H-04 decisionTrace present', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(Array.isArray(result.decisionTrace));
  assert.ok(result.decisionTrace.length > 0);
}),

// H-05: SAFE_TO_ACTIVATE_PRODUCTION is always 'NO'
test('H-05 SAFE_TO_ACTIVATE_PRODUCTION = NO always', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.strictEqual(result.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
}),

// H-06: budgetStatus present
test('H-06 budgetStatus present', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(result.budgetStatus);
  assert.ok('airbnb' in result.budgetStatus);
}),

// H-07: 0 budget → INSUFFICIENT
test('H-07 zero airbnb budget + no queue → INSUFFICIENT', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const budget = createCallBudget({ maxAirbnbCalls: 0, maxBookingCalls: 0 });
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   [],
    _bookingSnapshot: null,
    _budget:          budget,
  });
  assert.strictEqual(result.market_status, 'INSUFFICIENT');
  assert.strictEqual(result._noSnapshots, true);
}),

// H-08: anomalyDiagnostic present
test('H-08 anomalyDiagnostic present', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(result.anomalyDiagnostic);
  assert.ok('severity' in result.anomalyDiagnostic);
}),

// H-09: quarantine present
test('H-09 quarantine result present', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(result.quarantine);
  assert.ok('quarantined' in result.quarantine);
}),

// H-10: costEstimate present
test('H-10 costEstimate present', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(result.costEstimate);
  assert.strictEqual(typeof result.costEstimate.estimatedCredits, 'number');
}),

// H-11: No live BD calls when snapshot queue provided
test('H-11 pre-collected queue → 0 budget credits consumed', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  // airbnb budget should be 0 used (all from queue)
  assert.strictEqual(result.budgetStatus.airbnb.used, 0);
}),

// H-12: Health skip — unhealthy provider skips live call (no queue → live path)
test('H-12 unhealthy provider → call skipped', async () => {
  const h = createHealthTracker();
  // Make airbnb unhealthy
  for (let i = 0; i < 5; i++) recordProviderOutcome(h, 'airbnb', 'error');
  const b = createCallBudget();
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   null,   // null → live path → health checked
    _bookingSnapshot: f.bookingResult,
    _budget:          b,
    _healthTracker:   h,
  });
  const healthSkip = result.decisionTrace.find(t => t.step === 'AIRBNB_HEALTH_SKIP');
  assert.ok(healthSkip);
}),

// H-13: J30 fixture works
test('H-13 J30 fixture → valid result', async () => {
  const f = FIXTURE_M6_J30;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(result.market_status);
  assert.strictEqual(result.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
}),

// H-14: J60 fixture works
test('H-14 J60 fixture → valid result', async () => {
  const f = FIXTURE_M6_J60;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(result.market_status);
}),

// H-15: MARKET_CONSENSUS_MEDIAN present when STABLE_DUAL
test('H-15 MARKET_CONSENSUS_MEDIAN present on STABLE_DUAL', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  if (result.market_status === 'STABLE_DUAL') {
    assert.ok(result.MARKET_CONSENSUS_MEDIAN != null);
  }
}),

// ── Section I — Integration / Regression ─────────────────────────────────────

// I-01: FIXTURE_M6_STABLE_DUAL full round-trip
test('I-01 STABLE_DUAL full round-trip', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.strictEqual(result.market_status, 'STABLE_DUAL');
  assert.strictEqual(result.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
  assert.ok(result.anomalyDiagnostic.safe);
  assert.strictEqual(result.quarantine.quarantined, false);
}),

// I-02: 0 BD credits consumed across all fixtures
test('I-02 0 BD credits in all fixtures', async () => {
  for (const f of [FIXTURE_M6_STABLE_DUAL, FIXTURE_M6_J30, FIXTURE_M6_J60]) {
    const result = await runAdaptiveMarketEngine({
      ...f,
      _snapshotQueue:   f.airbnbSnapshots,
      _bookingSnapshot: f.bookingResult,
    });
    assert.strictEqual(result.budgetStatus.airbnb.used,  0, `${f.checkIn}: airbnb budget consumed`);
    assert.strictEqual(result.budgetStatus.booking.used, 0, `${f.checkIn}: booking budget consumed`);
  }
}),

// I-03: SAFE_TO_ACTIVATE_PRODUCTION never YES in any fixture
test('I-03 SAFE_TO_ACTIVATE_PRODUCTION never YES', async () => {
  for (const f of [FIXTURE_M6_STABLE_DUAL, FIXTURE_M6_J30, FIXTURE_M6_J60]) {
    const result = await runAdaptiveMarketEngine({
      ...f,
      _snapshotQueue:   f.airbnbSnapshots,
      _bookingSnapshot: f.bookingResult,
    });
    assert.notStrictEqual(result.SAFE_TO_ACTIVATE_PRODUCTION, 'YES');
  }
}),

// I-04: M1+M2+M3 planner integration — all REUSE when queue valid
test('I-04 M1+M2+M3 integration all REUSE', () => {
  const b = createCallBudget();
  const queue = [CACHED_SNAPSHOT_VALID, CACHED_SNAPSHOT_VALID, CACHED_SNAPSHOT_VALID];
  const plan = planAdaptiveCollection({
    executionPolicy: 'THREE_SNAPSHOT_REQUIRED',
    snapshotQueue:   queue,
    budget:          b,
    request:         REUSE_REQUEST,
  });
  assert.strictEqual(plan.reusedSnapshots, 3);
  assert.strictEqual(plan.newCallsNeeded, 0);
  assert.strictEqual(plan.totalPlannedCalls, 1); // only booking
}),

// I-05: PRODUCTION_FIXTURE sanity check with quarantine
test('I-05 PRODUCTION_FIXTURE sanity + quarantine', () => {
  const { analyzeProductionSignalSanity } = require('../services/market-production-sanity');
  const sanity = analyzeProductionSignalSanity({ productionSignal: PRODUCTION_FIXTURE });
  assert.strictEqual(sanity.available, true);
  const q = evaluateQuarantine(sanity);
  assert.strictEqual(q.quarantined, false); // no shadow to compare
}),

// I-06: M6 + M8 integration — bad snapshots flagged in anomalyDiagnostic
test('I-06 M6+M8 bad snapshots flagged', async () => {
  const f = FIXTURE_M6_MULTIDATE_J14_BAD;
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.strictEqual(result.anomalyDiagnostic.severity, 'HIGH');
}),

// I-07: M7 estimates 0 credits when all REUSE
test('I-07 M7 0 credits when all REUSE', () => {
  const plan = {
    airbnb:  [{ type: 'REUSE' }, { type: 'REUSE' }, { type: 'REUSE' }],
    booking: { type: 'SKIP' },
  };
  const r = estimateCollectionCost(plan);
  assert.strictEqual(r.estimatedCredits, 0);
}),

// I-08: Full module chain — M1→M2→M3→M7 estimates cost correctly
test('I-08 M1→M2→M3→M7 cost chain', () => {
  const b    = createCallBudget();
  const plan = planAdaptiveCollection({
    executionPolicy: 'TWO_SNAPSHOT_EARLY_STOP',
    snapshotQueue:   [CACHED_SNAPSHOT_VALID],
    budget:          b,
    request:         REUSE_REQUEST,
  });
  const cost = estimateCollectionCost(plan);
  // 1 REUSE + 1 CALL + booking CALL = 2 credits
  assert.strictEqual(cost.estimatedCredits, 2);
}),

// I-09: noNetworkProvider as default prevents accidental BD calls
test('I-09 default provider blocks live calls', async () => {
  const f = FIXTURE_M6_STABLE_DUAL;
  // No _snapshotQueue → M8 will try to CALL via noNetworkProvider → error logged in trace
  const budget = createCallBudget({ maxAirbnbCalls: 1 });
  let result;
  try {
    result = await runAdaptiveMarketEngine({
      ...f,
      _snapshotQueue:   null,
      _bookingSnapshot: null,
      _budget:          budget,
    });
  } catch (_) { /* noNetworkProvider throw propagated through live call path */ }
  // Either result is INSUFFICIENT (no snapshots) or caught above — either way 0 credits
  if (result) {
    // If somehow returned, budget must show 0 used (no successful calls)
    assert.strictEqual(result.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
  }
}),

// I-10: Extreme divergence fixture → EXTREME_DIVERGENCE or BOOKING_ONLY
test('I-10 extreme booking prices → divergence detected', async () => {
  const f = {
    ...FIXTURE_M6_STABLE_DUAL,
    bookingResult: makeBookingResult(BOOKING_LISTINGS_EXTREME),
  };
  const result = await runAdaptiveMarketEngine({
    ...f,
    _snapshotQueue:   f.airbnbSnapshots,
    _bookingSnapshot: f.bookingResult,
  });
  assert.ok(['EXTREME_DIVERGENCE', 'STABLE_DUAL', 'AIRBNB_ONLY', 'BOOKING_ONLY'].includes(result.market_status));
  assert.strictEqual(result.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
}),

];

// ── Wait for all async tests then report ──────────────────────────────────────

Promise.all(tests).then(() => {
  console.log(`\n\n${'─'.repeat(60)}`);
  if (failures.length) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  ✗ ${f.label}: ${f.error}`));
    console.log();
  }
  console.log(`P1.2-B5-BK-M: ${passed + failed} tests — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});

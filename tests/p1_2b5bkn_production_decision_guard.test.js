'use strict';
/**
 * P1.2-B5-BK-N — Production Decision Guard + Observation Provenance
 *
 * Sections:
 *   A  — N0 Audit invariants (shadow-safe)                            (3  tests)
 *   B  — REJECT: candidate structural invalidity                      (8  tests)
 *   C  — REJECT: actionability structural reasons                     (5  tests)
 *   D  — REJECT: provider health                                      (4  tests)
 *   E  — QUARANTINE: production context anomaly (M5 + historical)     (5  tests)
 *   F  — HOLD_FOR_CONFIRMATION: uncertainty signals                   (10 tests)
 *   G  — ELIGIBLE_SHADOW_CANDIDATE: perfect candidate                 (4  tests)
 *   H  — N3 M6 fixture: production=345.45, candidate=125.61           (4  tests)
 *   I  — Invariant G: circular-reject logic forbidden                 (4  tests)
 *   J  — N4 Observation Provenance: valid cases                       (5  tests)
 *   K  — N4 Observation Provenance: invalid (missing required fields) (7  tests)
 *   L  — N4 Observation Provenance: warnings (missing recommended)    (4  tests)
 *
 * ABSOLUTE RULE: 0 Bright Data credits consumed.
 * All inputs are pure JS objects — no DB, no network, no Channex.
 */

const assert = require('assert');

const {
  evaluateMarketProductionCandidate,
  DECISIONS,
  STRUCTURAL_ACTIONABILITY_REJECTS,
  SINGLE_SOURCE_STATUSES,
  FAILING_MARKET_STATUSES,
} = require('../services/market-production-decision-guard');

const {
  normalizeMarketObservationProvenance,
  VALID_SOURCES,
} = require('../services/market-observation-provenance');

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(label, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push({ label, message: e.message });
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Perfect shadow candidate — all evidence strongly positive */
function perfectCandidate() {
  return {
    median:       125.61,
    confidence:   'HIGH',
    marketStatus: 'STABLE_DUAL',
    currency:     'EUR',
    sources: {
      airbnbIncluded:    true,
      bookingIncluded:   true,
      airbnbReliability: 'STABLE_LOCAL_POOL',
      comparableCount:   93,
    },
    collectionEvidence: {
      snapshotCount:   3,
      radiusKm:        1.5,
      comparableCount: 93,
      stayWindow:      { checkIn: '2026-10-11', checkOut: '2026-10-14', nights: 3 },
      collectedAt:     '2026-09-29T08:00:00Z',
    },
  };
}

function perfectActionability() {
  return { actionable: true, reasons: [], warnings: [] };
}

function perfectHistoricalAssessment() {
  return {
    severity: 'NONE',
    reasons:  [],
    warnings: [],
    metrics: {
      windowCompatStatus:      'SAME_WINDOW',
      historyCount:            8,
      historyMedian:           135.50,
      ratioVsHistoryMedian:    0.927,
      deltaVsHistoryMedianPct: -7.3,
    },
  };
}

function productionSanityAvailable() {
  return {
    available:        true,
    productionMedian: 125.61,
    vsConsensus: { deltaPct: 0, classification: 'ALIGNED' },
  };
}

function quarantineNone() {
  return { quarantined: false, level: 'NONE', reason: null, vsConsensus: null };
}

function healthyProviders() {
  return {
    airbnb:  { status: 'HEALTHY' },
    booking: { status: 'HEALTHY' },
  };
}

// ── M6 production signal (345.45 EUR — CRITICAL historical anomaly) ──────────

function m6ProductionSanity() {
  // shadowConsensus (125.61) vs production (345.45): delta = -63.6% → LARGE_DEVIATION
  return {
    available:        true,
    productionMedian: 345.45,
    vsConsensus: { deltaPct: -63.64, classification: 'LARGE_DEVIATION' },
    vsAirbnb:    { deltaPct: -64.31, classification: 'LARGE_DEVIATION' },
    vsBooking:   { deltaPct: -63.02, classification: 'LARGE_DEVIATION' },
  };
}

function m6QuarantineResult() {
  // evaluateQuarantine on m6ProductionSanity → consensus LARGE_DEVIATION → QUARANTINED
  return {
    quarantined: true,
    level:       'QUARANTINED',
    reason:      'consensus_large_deviation (vsConsensus: LARGE_DEVIATION)',
    vsConsensus: 'LARGE_DEVIATION',
  };
}

function m6HistoricalAssessment() {
  // classifyHistoricalAnomaly: latestMedian=345.45, historyMedian=135.50
  // ratio=2.549 → CRITICAL spike, windowCompat=UNKNOWN_WINDOW
  return {
    severity: 'CRITICAL',
    reasons:  ['critical_price_spike'],
    warnings: ['window_comparability_unknown'],
    metrics: {
      windowCompatStatus:      'UNKNOWN_WINDOW',
      historyCount:            8,
      historyMedian:           135.50,
      ratioVsHistoryMedian:    2.549,
      deltaVsHistoryMedianPct: 154.94,
    },
  };
}

function m6Actionability() {
  // evaluateMarketActionability: candidateMedian=125.61 vs productionMedian=345.45
  // delta = 63.6% > 35% → LARGE_PRODUCTION_DEVIATION
  return {
    actionable: false,
    reasons:    ['LARGE_PRODUCTION_DEVIATION'],
    warnings:   ['production_deviation=63.64% (threshold=35%)'],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// A — N0 Audit invariants
// ──────────────────────────────────────────────────────────────────────────────

test('A-01: SAFE_TO_ACTIVATE_PRODUCTION is always NO', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
});

test('A-02: eligible is true only for ELIGIBLE_SHADOW_CANDIDATE', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.ok(r.eligible);
  assert.strictEqual(r.decision, DECISIONS.ELIGIBLE_SHADOW_CANDIDATE);
});

test('A-03: eligible is false for all other decisions', () => {
  // REJECT case
  const r = evaluateMarketProductionCandidate({ candidate: null });
  assert.ok(!r.eligible);
  assert.strictEqual(r.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
});

// ──────────────────────────────────────────────────────────────────────────────
// B — REJECT: candidate structural invalidity
// ──────────────────────────────────────────────────────────────────────────────

test('B-01: null candidate → REJECT MISSING_CANDIDATE', () => {
  const r = evaluateMarketProductionCandidate({ candidate: null });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.includes('MISSING_CANDIDATE'));
});

test('B-02: median = 0 → REJECT INVALID_CANDIDATE_MEDIAN', () => {
  const c = { ...perfectCandidate(), median: 0 };
  const r = evaluateMarketProductionCandidate({ candidate: c, actionability: perfectActionability() });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.includes('INVALID_CANDIDATE_MEDIAN'));
});

test('B-03: median = -1 → REJECT INVALID_CANDIDATE_MEDIAN', () => {
  const c = { ...perfectCandidate(), median: -1 };
  const r = evaluateMarketProductionCandidate({ candidate: c, actionability: perfectActionability() });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.includes('INVALID_CANDIDATE_MEDIAN'));
});

test('B-04: median = null → REJECT INVALID_CANDIDATE_MEDIAN', () => {
  const c = { ...perfectCandidate(), median: null };
  const r = evaluateMarketProductionCandidate({ candidate: c, actionability: perfectActionability() });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.includes('INVALID_CANDIDATE_MEDIAN'));
});

test('B-05: currency missing → REJECT MISSING_OR_INVALID_CANDIDATE_CURRENCY', () => {
  const c = { ...perfectCandidate(), currency: null };
  const r = evaluateMarketProductionCandidate({ candidate: c, actionability: perfectActionability() });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('MISSING_OR_INVALID_CANDIDATE_CURRENCY')));
});

test('B-06: currency mismatch with property → REJECT CURRENCY_MISMATCH', () => {
  const c = { ...perfectCandidate(), currency: 'USD' };
  const r = evaluateMarketProductionCandidate({
    candidate:      c,
    actionability:  perfectActionability(),
    propertyContext: { currency: 'EUR' },
  });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('CURRENCY_MISMATCH')));
});

test('B-07: confidence LOW → REJECT INSUFFICIENT_CONFIDENCE', () => {
  const c = { ...perfectCandidate(), confidence: 'LOW' };
  const r = evaluateMarketProductionCandidate({ candidate: c, actionability: perfectActionability() });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.includes('INSUFFICIENT_CONFIDENCE'));
});

test('B-08: marketStatus INSUFFICIENT → REJECT FAILING_MARKET_STATUS', () => {
  const c = { ...perfectCandidate(), marketStatus: 'INSUFFICIENT' };
  const r = evaluateMarketProductionCandidate({ candidate: c, actionability: perfectActionability() });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('FAILING_MARKET_STATUS')));
});

// ──────────────────────────────────────────────────────────────────────────────
// C — REJECT: actionability structural reasons
// ──────────────────────────────────────────────────────────────────────────────

test('C-01: actionability null → REJECT MISSING_ACTIONABILITY_RESULT', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: null,
  });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.includes('MISSING_ACTIONABILITY_RESULT'));
});

test('C-02: EXTREME_CROSS_SOURCE_DIVERGENCE → REJECT', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: { actionable: false, reasons: ['EXTREME_CROSS_SOURCE_DIVERGENCE'], warnings: [] },
  });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('EXTREME_CROSS_SOURCE_DIVERGENCE')));
});

test('C-03: UNKNOWN_MARKET_STATUS → REJECT', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: { actionable: false, reasons: ['UNKNOWN_MARKET_STATUS'], warnings: [] },
  });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('UNKNOWN_MARKET_STATUS')));
});

test('C-04: NO_VALID_SOURCE → REJECT', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: { actionable: false, reasons: ['NO_VALID_SOURCE'], warnings: [] },
  });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('NO_VALID_SOURCE')));
});

test('C-05: STRUCTURAL_ACTIONABILITY_REJECTS exports correct set', () => {
  const expected = new Set(['LOW_CONFIDENCE', 'NO_VALID_SOURCE', 'INVALID_CANDIDATE_MEDIAN', 'EXTREME_CROSS_SOURCE_DIVERGENCE', 'UNKNOWN_MARKET_STATUS']);
  assert.deepStrictEqual(STRUCTURAL_ACTIONABILITY_REJECTS, expected);
});

// ──────────────────────────────────────────────────────────────────────────────
// D — REJECT: provider health
// ──────────────────────────────────────────────────────────────────────────────

test('D-01: airbnb UNHEALTHY and airbnb used → REJECT', () => {
  const c = { ...perfectCandidate(), sources: { airbnbIncluded: true, bookingIncluded: true } };
  const r = evaluateMarketProductionCandidate({
    candidate:    c,
    actionability: perfectActionability(),
    providerHealth: { airbnb: { status: 'UNHEALTHY' }, booking: { status: 'HEALTHY' } },
  });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('PROVIDER_UNHEALTHY: airbnb')));
});

test('D-02: booking UNHEALTHY and booking used → REJECT', () => {
  const c = { ...perfectCandidate(), sources: { airbnbIncluded: false, bookingIncluded: true } };
  const r = evaluateMarketProductionCandidate({
    candidate:    c,
    actionability: perfectActionability(),
    providerHealth: { airbnb: { status: 'HEALTHY' }, booking: { status: 'UNHEALTHY' } },
  });
  assert.strictEqual(r.decision, DECISIONS.REJECT);
  assert.ok(r.reasons.some(s => s.includes('PROVIDER_UNHEALTHY: booking')));
});

test('D-03: airbnb UNHEALTHY but airbnb NOT used → no REJECT from health', () => {
  // airbnb not included in this candidate → its health does not matter
  const c = { ...perfectCandidate(), marketStatus: 'BOOKING_ONLY', sources: { airbnbIncluded: false, bookingIncluded: true } };
  const r = evaluateMarketProductionCandidate({
    candidate:    c,
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    quarantine:   quarantineNone(),
    providerHealth: { airbnb: { status: 'UNHEALTHY' }, booking: { status: 'HEALTHY' } },
  });
  // Should not REJECT for provider health — airbnb not used
  assert.notStrictEqual(r.decision, DECISIONS.REJECT);
  // But BOOKING_ONLY → HOLD
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
});

test('D-04: UNKNOWN provider health → no health-based REJECT', () => {
  // UNKNOWN is permissive (no data yet — first run)
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       { airbnb: { status: 'UNKNOWN' }, booking: { status: 'UNKNOWN' } },
  });
  // UNKNOWN is not UNHEALTHY — should not trigger health REJECT
  assert.notStrictEqual(r.decision, DECISIONS.REJECT);
});

// ──────────────────────────────────────────────────────────────────────────────
// E — QUARANTINE: production context anomaly
// ──────────────────────────────────────────────────────────────────────────────

test('E-01: quarantine.quarantined = true → QUARANTINE', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           { quarantined: true, level: 'QUARANTINED', reason: 'consensus_large_deviation', vsConsensus: 'LARGE_DEVIATION' },
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
  assert.ok(r.reasons.some(s => s.includes('PRODUCTION_QUARANTINED')));
  assert.strictEqual(r.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
});

test('E-02: historicalAssessment.severity CRITICAL → QUARANTINE', () => {
  const hist = { ...perfectHistoricalAssessment(), severity: 'CRITICAL', reasons: ['critical_price_spike'] };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: hist,
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
  assert.ok(r.reasons.includes('HISTORICAL_ANOMALY_CRITICAL'));
});

test('E-03: both quarantine AND CRITICAL → QUARANTINE (quarantine checked first)', () => {
  const hist = { ...perfectHistoricalAssessment(), severity: 'CRITICAL' };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: hist,
    quarantine:   { quarantined: true, level: 'QUARANTINED', reason: 'test', vsConsensus: null },
    providerHealth: healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
  // quarantine checked before historical
  assert.ok(r.reasons.some(s => s.includes('PRODUCTION_QUARANTINED')));
});

test('E-04: QUARANTINE preserves quarantine.reason in reasons', () => {
  const q = { quarantined: true, level: 'QUARANTINED', reason: 'consensus_large_deviation (vsConsensus: LARGE_DEVIATION)', vsConsensus: 'LARGE_DEVIATION' };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    quarantine:           q,
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
  assert.ok(r.reasons.some(s => s.includes('consensus_large_deviation')));
});

test('E-05: candidate coherent with history but production CRITICAL → still QUARANTINE', () => {
  // Candidate -7.3% vs history (coherent), but production is critically anomalous
  const hist = { ...perfectHistoricalAssessment(), severity: 'CRITICAL', metrics: { ...perfectHistoricalAssessment().metrics, ratioVsHistoryMedian: 2.549, deltaVsHistoryMedianPct: 154.94 } };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: hist,
    productionSanity:     m6ProductionSanity(),
    quarantine:           quarantineNone(),  // M5 not active but historical IS CRITICAL
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
  assert.ok(r.reasons.includes('HISTORICAL_ANOMALY_CRITICAL'));
});

// ──────────────────────────────────────────────────────────────────────────────
// F — HOLD_FOR_CONFIRMATION
// ──────────────────────────────────────────────────────────────────────────────

test('F-01: historicalAssessment null → HOLD MISSING_HISTORICAL_ASSESSMENT', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: null,
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.includes('MISSING_HISTORICAL_ASSESSMENT'));
});

test('F-02: severity HIGH → HOLD HISTORICAL_ANOMALY_HIGH', () => {
  const hist = { ...perfectHistoricalAssessment(), severity: 'HIGH' };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: hist,
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.includes('HISTORICAL_ANOMALY_HIGH'));
});

test('F-03: severity INCONCLUSIVE → HOLD HISTORICAL_ANOMALY_INCONCLUSIVE', () => {
  const hist = { ...perfectHistoricalAssessment(), severity: 'INCONCLUSIVE' };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: hist,
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.includes('HISTORICAL_ANOMALY_INCONCLUSIVE'));
});

test('F-04: windowCompatStatus UNKNOWN_WINDOW → HOLD even when severity NONE', () => {
  const hist = {
    ...perfectHistoricalAssessment(),
    severity: 'NONE',
    metrics: { ...perfectHistoricalAssessment().metrics, windowCompatStatus: 'UNKNOWN_WINDOW' },
  };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: hist,
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.includes('UNKNOWN_STAY_WINDOW_COMPARABILITY'));
  assert.ok(r.warnings.some(w => w.includes('window_comparability_unknown')));
});

test('F-05: confidence MEDIUM → HOLD MEDIUM_CONFIDENCE_REQUIRES_ADDITIONAL_EVIDENCE', () => {
  const c = { ...perfectCandidate(), confidence: 'MEDIUM' };
  const r = evaluateMarketProductionCandidate({
    candidate:    c,
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.includes('MEDIUM_CONFIDENCE_REQUIRES_ADDITIONAL_EVIDENCE'));
});

test('F-06: AIRBNB_ONLY → HOLD SINGLE_SOURCE_MARKET', () => {
  const c = { ...perfectCandidate(), marketStatus: 'AIRBNB_ONLY', sources: { airbnbIncluded: true, bookingIncluded: false } };
  const r = evaluateMarketProductionCandidate({
    candidate:    c,
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.some(s => s.includes('SINGLE_SOURCE_MARKET')));
});

test('F-07: BOOKING_ONLY → HOLD SINGLE_SOURCE_MARKET', () => {
  const c = { ...perfectCandidate(), marketStatus: 'BOOKING_ONLY', sources: { airbnbIncluded: false, bookingIncluded: true } };
  const r = evaluateMarketProductionCandidate({
    candidate:    c,
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.some(s => s.includes('SINGLE_SOURCE_MARKET: BOOKING_ONLY')));
});

test('F-08: quarantine level CAUTION → HOLD PRODUCTION_DEVIATION_CAUTION', () => {
  const q = { quarantined: false, level: 'CAUTION', reason: 'material_deviation_observed', vsConsensus: 'MATERIAL_DEVIATION' };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           q,
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.includes('PRODUCTION_DEVIATION_CAUTION'));
});

test('F-09: no production sanity → warning, not HOLD (absent baseline is informational)', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     null,
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  // No production baseline is a warning, not a HOLD condition
  assert.strictEqual(r.decision, DECISIONS.ELIGIBLE_SHADOW_CANDIDATE);
  assert.ok(r.warnings.some(w => w.includes('no_production_baseline')));
});

test('F-10: LARGE_PRODUCTION_DEVIATION alone (no quarantine) → HOLD', () => {
  // Candidate actionability says NOT_ACTIONABLE due only to LARGE_PRODUCTION_DEVIATION
  // Production signal is not quarantined (level NONE)
  const a = { actionable: false, reasons: ['LARGE_PRODUCTION_DEVIATION'], warnings: ['production_deviation=40% (threshold=35%)'] };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: a,
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     { available: true, productionMedian: 200, vsConsensus: { classification: 'LARGE_DEVIATION' } },
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.some(s => s.includes('LARGE_PRODUCTION_DEVIATION_REQUIRES_CONTEXT_VALIDATION')));
  assert.ok(r.warnings.some(w => w.includes('large_production_deviation')));
});

// ──────────────────────────────────────────────────────────────────────────────
// G — ELIGIBLE_SHADOW_CANDIDATE
// ──────────────────────────────────────────────────────────────────────────────

test('G-01: all evidence strong → ELIGIBLE_SHADOW_CANDIDATE', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.ELIGIBLE_SHADOW_CANDIDATE);
  assert.ok(r.eligible);
  assert.strictEqual(r.reasons.length, 0);
  assert.strictEqual(r.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
});

test('G-02: severity LOW still reaches ELIGIBLE_SHADOW_CANDIDATE', () => {
  const hist = { ...perfectHistoricalAssessment(), severity: 'LOW' };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: hist,
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.ELIGIBLE_SHADOW_CANDIDATE);
});

test('G-03: currency match with property passes ELIGIBLE', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(), // EUR
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
    propertyContext:      { currency: 'EUR' },
  });
  assert.strictEqual(r.decision, DECISIONS.ELIGIBLE_SHADOW_CANDIDATE);
});

test('G-04: ELIGIBLE evidence includes all key fields', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: perfectActionability(),
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     productionSanityAvailable(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.evidence.candidateMedian, 125.61);
  assert.strictEqual(r.evidence.candidateConfidence, 'HIGH');
  assert.strictEqual(r.evidence.candidateMarketStatus, 'STABLE_DUAL');
  assert.strictEqual(r.evidence.quarantineLevel, 'NONE');
  assert.strictEqual(r.evidence.historicalSeverity, 'NONE');
  assert.strictEqual(r.evidence.windowCompatStatus, 'SAME_WINDOW');
});

// ──────────────────────────────────────────────────────────────────────────────
// H — N3: M6 fixture (production=345.45, candidate=125.61)
// ──────────────────────────────────────────────────────────────────────────────

test('H-01: M6 full fixture → QUARANTINE (not ELIGIBLE, not REJECT)', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:            { ...perfectCandidate(), median: 125.61 },
    actionability:        m6Actionability(),
    historicalAssessment: m6HistoricalAssessment(),
    productionSanity:     m6ProductionSanity(),
    quarantine:           m6QuarantineResult(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
  assert.ok(!r.eligible);
  assert.strictEqual(r.SAFE_TO_ACTIVATE_PRODUCTION, 'NO');
});

test('H-02: M6 QUARANTINE reason references production quarantine, not candidate quality', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:            { ...perfectCandidate(), median: 125.61 },
    actionability:        m6Actionability(),
    historicalAssessment: m6HistoricalAssessment(),
    productionSanity:     m6ProductionSanity(),
    quarantine:           m6QuarantineResult(),
    providerHealth:       healthyProviders(),
  });
  // Decision is QUARANTINE from production context, not from candidate invalidity
  assert.ok(r.reasons.some(s => s.includes('PRODUCTION_QUARANTINED')));
  // Candidate is sound: median valid, confidence HIGH, STABLE_DUAL
  assert.strictEqual(r.evidence.candidateMedian, 125.61);
  assert.strictEqual(r.evidence.candidateConfidence, 'HIGH');
  assert.strictEqual(r.evidence.candidateMarketStatus, 'STABLE_DUAL');
});

test('H-03: M6 evidence includes production median 345.45', () => {
  const r = evaluateMarketProductionCandidate({
    candidate:            { ...perfectCandidate(), median: 125.61 },
    actionability:        m6Actionability(),
    historicalAssessment: m6HistoricalAssessment(),
    productionSanity:     m6ProductionSanity(),
    quarantine:           m6QuarantineResult(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.evidence.productionMedian, 345.45);
  assert.strictEqual(r.evidence.quarantineLevel, 'QUARANTINED');
  assert.strictEqual(r.evidence.historicalSeverity, 'CRITICAL');
});

test('H-04: M6 without M5 quarantine but with CRITICAL history still → QUARANTINE', () => {
  // Even if M5 doesn't trigger quarantine, the CRITICAL historical anomaly alone → QUARANTINE
  const r = evaluateMarketProductionCandidate({
    candidate:            { ...perfectCandidate(), median: 125.61 },
    actionability:        m6Actionability(),
    historicalAssessment: m6HistoricalAssessment(),
    productionSanity:     m6ProductionSanity(),
    quarantine:           quarantineNone(),  // M5 not active
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
  assert.ok(r.reasons.includes('HISTORICAL_ANOMALY_CRITICAL'));
});

// ──────────────────────────────────────────────────────────────────────────────
// I — Invariant G: circular-reject logic is forbidden
// ──────────────────────────────────────────────────────────────────────────────

test('I-01: LARGE_PRODUCTION_DEVIATION alone does NOT → REJECT', () => {
  const a = { actionable: false, reasons: ['LARGE_PRODUCTION_DEVIATION'], warnings: [] };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: a,
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     { available: true, productionMedian: 300, vsConsensus: { classification: 'LARGE_DEVIATION' } },
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  assert.notStrictEqual(r.decision, DECISIONS.REJECT);
});

test('I-02: production anormal + candidate coherent → at most HOLD (not REJECT)', () => {
  const a = { actionable: false, reasons: ['LARGE_PRODUCTION_DEVIATION'], warnings: [] };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: a,
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     m6ProductionSanity(),
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  // Candidate is not rejected for production anomaly
  assert.ok(r.decision !== DECISIONS.REJECT);
});

test('I-03: production anormal + quarantine active → QUARANTINE supersedes LARGE_PRODUCTION_DEVIATION', () => {
  const a = { actionable: false, reasons: ['LARGE_PRODUCTION_DEVIATION'], warnings: [] };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: a,
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     m6ProductionSanity(),
    quarantine:           m6QuarantineResult(),
    providerHealth:       healthyProviders(),
  });
  assert.strictEqual(r.decision, DECISIONS.QUARANTINE);
});

test('I-04: reasons distinguish production anomaly from candidate quality issue', () => {
  const a = { actionable: false, reasons: ['LARGE_PRODUCTION_DEVIATION'], warnings: [] };
  const r = evaluateMarketProductionCandidate({
    candidate:    perfectCandidate(),
    actionability: a,
    historicalAssessment: perfectHistoricalAssessment(),
    productionSanity:     { available: true, productionMedian: 300, vsConsensus: { classification: 'LARGE_DEVIATION' } },
    quarantine:           quarantineNone(),
    providerHealth:       healthyProviders(),
  });
  // Decision is about context, not candidate structure
  assert.strictEqual(r.decision, DECISIONS.HOLD_FOR_CONFIRMATION);
  assert.ok(r.reasons.some(s => s.includes('LARGE_PRODUCTION_DEVIATION_REQUIRES_CONTEXT_VALIDATION')));
  assert.ok(!r.reasons.some(s => s.includes('INVALID_CANDIDATE')));
  assert.ok(!r.reasons.some(s => s.includes('INSUFFICIENT_CONFIDENCE')));
});

// ──────────────────────────────────────────────────────────────────────────────
// J — N4 Observation Provenance: valid cases
// ──────────────────────────────────────────────────────────────────────────────

test('J-01: full valid provenance → valid: true', () => {
  const r = normalizeMarketObservationProvenance({
    source:          'airbnb',
    collectedAt:     '2026-09-29T08:00:00Z',
    currency:        'EUR',
    comparableCount: 93,
    stayWindow:      { checkIn: '2026-10-11', checkOut: '2026-10-14', nights: 3 },
    snapshotCount:   3,
    radiusKm:        1.5,
    propertyId:      'prop-abc',
    targetLat:       48.855,
    targetLon:       2.347,
    targetGuests:    2,
    targetBedrooms:  1,
    targetPropertyType: 'entire_place',
  });
  assert.ok(r.valid);
  assert.ok(r.provenance != null);
  assert.strictEqual(r.provenance.source, 'airbnb');
  assert.strictEqual(r.provenance.currency, 'EUR');
  assert.strictEqual(r.provenance.stayWindowNights, 3);
  assert.strictEqual(r.missing.length, 0);
  assert.strictEqual(r.warnings.length, 0);
});

test('J-02: nights derived from checkIn/checkOut when not explicit', () => {
  const r = normalizeMarketObservationProvenance({
    source:          'booking',
    collectedAt:     '2026-09-29T08:00:00Z',
    currency:        'ILS',
    comparableCount: 45,
    stayWindow:      { checkIn: '2026-10-11', checkOut: '2026-10-14' },  // no nights
    snapshotCount:   1,
    radiusKm:        2.0,
  });
  assert.ok(r.valid);
  assert.strictEqual(r.provenance.stayWindowNights, 3);
});

test('J-03: source booking → valid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'booking', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'USD', comparableCount: 20,
    stayWindow: { nights: 2 },
  });
  assert.ok(r.valid);
  assert.strictEqual(r.provenance.source, 'booking');
});

test('J-04: source consensus → valid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'consensus', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'CHF', comparableCount: 55,
    stayWindow: { nights: 5 },
  });
  assert.ok(r.valid);
});

test('J-05: provenance includes normalizedAt timestamp', () => {
  const before = new Date().toISOString();
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'EUR', comparableCount: 10,
    stayWindow: { nights: 3 },
  });
  assert.ok(r.valid);
  assert.ok(r.provenance.normalizedAt >= before);
});

// ──────────────────────────────────────────────────────────────────────────────
// K — N4 Observation Provenance: invalid (missing required fields)
// ──────────────────────────────────────────────────────────────────────────────

test('K-01: missing source → invalid', () => {
  const r = normalizeMarketObservationProvenance({
    collectedAt: '2026-09-29T00:00:00Z', currency: 'EUR',
    comparableCount: 10, stayWindow: { nights: 3 },
  });
  assert.ok(!r.valid);
  assert.ok(r.missing.some(m => m.includes('source')));
});

test('K-02: invalid source → invalid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'apify',  // not in VALID_SOURCES
    collectedAt: '2026-09-29T00:00:00Z', currency: 'EUR',
    comparableCount: 10, stayWindow: { nights: 3 },
  });
  assert.ok(!r.valid);
  assert.ok(r.missing.some(m => m.includes('source')));
});

test('K-03: missing collectedAt → invalid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', currency: 'EUR',
    comparableCount: 10, stayWindow: { nights: 3 },
  });
  assert.ok(!r.valid);
  assert.ok(r.missing.some(m => m.includes('collectedAt')));
});

test('K-04: invalid currency → invalid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'euro',  // lowercase → invalid
    comparableCount: 10, stayWindow: { nights: 3 },
  });
  assert.ok(!r.valid);
  assert.ok(r.missing.some(m => m.includes('currency')));
});

test('K-05: comparableCount negative → invalid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'EUR', comparableCount: -1,
    stayWindow: { nights: 3 },
  });
  assert.ok(!r.valid);
  assert.ok(r.missing.some(m => m.includes('comparableCount')));
});

test('K-06: stayWindow null → invalid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'EUR', comparableCount: 10,
    stayWindow: null,
  });
  assert.ok(!r.valid);
  assert.ok(r.missing.some(m => m.includes('stayWindow')));
});

test('K-07: stayWindow empty object → invalid', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'EUR', comparableCount: 10,
    stayWindow: {},
  });
  assert.ok(!r.valid);
  assert.ok(r.missing.some(m => m.includes('stayWindow')));
});

// ──────────────────────────────────────────────────────────────────────────────
// L — N4 Observation Provenance: warnings
// ──────────────────────────────────────────────────────────────────────────────

test('L-01: missing recommended fields → warnings', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'EUR', comparableCount: 10,
    stayWindow: { nights: 3 },
    // all recommended fields absent
  });
  assert.ok(r.valid);
  assert.ok(r.warnings.some(w => w.includes('snapshotCount')));
  assert.ok(r.warnings.some(w => w.includes('radiusKm')));
  assert.ok(r.warnings.some(w => w.includes('targetLat')));
});

test('L-02: nights not derivable from partial window → warning', () => {
  // Only checkIn provided — cannot derive nights
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'EUR', comparableCount: 10,
    stayWindow: { checkIn: '2026-10-11' },  // no checkOut, no nights
    snapshotCount: 3, radiusKm: 1.5,
    propertyId: 'p1', targetLat: 48.855, targetLon: 2.347,
    targetGuests: 2, targetBedrooms: 1, targetPropertyType: 'entire_place',
  });
  assert.ok(r.valid);
  assert.ok(r.warnings.some(w => w.includes('nights could not be derived')));
  assert.strictEqual(r.provenance.stayWindowNights, null);
});

test('L-03: VALID_SOURCES exports correct set', () => {
  assert.ok(VALID_SOURCES.has('airbnb'));
  assert.ok(VALID_SOURCES.has('booking'));
  assert.ok(VALID_SOURCES.has('consensus'));
  assert.strictEqual(VALID_SOURCES.size, 3);
});

test('L-04: provenance.stayWindow.checkIn and checkOut preserved when provided', () => {
  const r = normalizeMarketObservationProvenance({
    source: 'airbnb', collectedAt: '2026-09-29T00:00:00Z',
    currency: 'EUR', comparableCount: 10,
    stayWindow: { checkIn: '2026-10-11', checkOut: '2026-10-14', nights: 3 },
    snapshotCount: 3, radiusKm: 1.5,
    propertyId: 'p1', targetLat: 48.855, targetLon: 2.347,
    targetGuests: 2, targetBedrooms: 1, targetPropertyType: 'entire_place',
  });
  assert.ok(r.valid);
  assert.strictEqual(r.provenance.stayWindow.checkIn, '2026-10-11');
  assert.strictEqual(r.provenance.stayWindow.checkOut, '2026-10-14');
  assert.strictEqual(r.provenance.stayWindow.nights, 3);
});

// ──────────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────────

// Jest compatibility shim — custom test() shadows Jest's global, so expose via it()
it('P1.2-B5-BK-N — all sub-tests pass', () => {
  if (failed > 0) {
    const detail = failures.map(f => `  ✗ ${f.label}: ${f.message}`).join('\n');
    throw new Error(`${failed} sub-test(s) failed:\n${detail}`);
  }
  console.log(`\nP1.2-B5-BK-N — ${passed} passed, ${failed} failed`);
});

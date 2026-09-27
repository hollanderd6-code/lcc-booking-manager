'use strict';
/**
 * P1.2-B5-BK-J5 — Airbnb Pooled Snapshot Reliability Gate Tests
 *
 * Groups:
 *   A. calcIqrPct                                   (J5-A01…04)
 *   B. evaluateSubsetReliability                    (J5-B01…08)
 *   C. computePooledReliabilityGate — gate rules    (J5-C01…11)
 *   D. M6 live scenario integration                 (J5-D01…04)
 *   E. Safety invariants (source-level)             (J5-E01…04)
 *   F. Validator modes                              (J5-F01…02)
 *
 * Total: 33 tests
 */

const assert = require('assert');
const test   = require('node:test');
const path   = require('path');

const {
  computePooledReliabilityGate,
  evaluateSubsetReliability,
  calcIqrPct,
  MIN_ABC_COMPARABLES,
  MAX_ABC_RADIUS_KM,
  MIN_RELIABLE_SUBSETS,
  MAX_RELIABLE_DEVIATION_PCT,
  MAX_IQR_PCT,
  MAX_REPEATED_VARIATION_PCT,
  MIN_USABLE_SNAPSHOTS,
} = require('../services/airbnb-pooled-reliability-gate');

const { MIN_COMPARABLES_FALLBACK } = require('../services/airbnb-pooled-snapshot-market');

const {
  previewMode,
  executeMode,
} = require('../outils/validate-airbnb-pooled-reliability-gate');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGeoQual(status) {
  return { geoQuality: { status } };
}

function makeMockPooled(overrides = {}) {
  return Object.assign({
    status:           'ok',
    comparableCount:  9,
    selectedRadiusKm: 2,
    fallbackUsed:     false,
    pooledStats: {
      median: 133, p25: 131.46, p75: 138.33, p10: 100, p90: 200, count: 9,
    },
    priceVariation: { max: 0, mean: 0, count: 0 },
    pairDeviation:  { deviations: { AB: 2.26, AC: 0, BC: 43.61 }, maxDeviationPct: 43.61 },
    sensitivity: {
      AB:  { countAtRadius: 8, median: 136, p25: 130,    p75: 140    },
      AC:  { countAtRadius: 9, median: 133, p25: 131.46, p75: 138.33 },
      BC:  { countAtRadius: 2, median: 75,  p25: 70,     p75: 80     },
      ABC: { countAtRadius: 9, median: 133, p25: 131.46, p75: 138.33 },
    },
    perSnapshotQuality: [
      makeGeoQual('GOOD'),
      makeGeoQual('UNUSABLE'),
      makeGeoQual('DEGRADED'),
    ],
    repeatedCount: 5,
  }, overrides);
}

function makeMockPool(rows) {
  return { query: async () => ({ rows }), end: async () => {} };
}

function makePropRow(name, lat = 48.726, lon = 2.272, overrides = {}) {
  return Object.assign({
    id: 1, name, internal_name: null,
    address: `${name}, Massy, France`,
    latitude: String(lat), longitude: String(lon),
    timezone: 'Europe/Paris', currency: 'EUR',
    max_guests: 4, bedrooms: 2,
  }, overrides);
}

// ── A. calcIqrPct ─────────────────────────────────────────────────────────────

test('J5-A01 calcIqrPct: null input → null', () => {
  assert.strictEqual(calcIqrPct(null), null);
});

test('J5-A02 calcIqrPct: median=0 → null', () => {
  assert.strictEqual(calcIqrPct({ p25: 80, p75: 120, median: 0 }), null);
});

test('J5-A03 calcIqrPct: missing p25/p75 → null', () => {
  assert.strictEqual(calcIqrPct({ median: 133 }), null);
});

test('J5-A04 calcIqrPct: M6 values → ≈5.17%', () => {
  const r = calcIqrPct({ p25: 131.46, p75: 138.33, median: 133 });
  assert.ok(r != null && r > 5.0 && r < 5.5,
    `expected ≈5.17, got ${r}`);
});

// ── B. evaluateSubsetReliability ──────────────────────────────────────────────

test('J5-B01 evaluateSubsetReliability: count < fallback → not reliable', () => {
  const sensitivity = {
    BC: { countAtRadius: MIN_COMPARABLES_FALLBACK - 1, median: 75 },
  };
  const perQ = [makeGeoQual('GOOD'), makeGeoQual('UNUSABLE'), makeGeoQual('DEGRADED')];
  const r = evaluateSubsetReliability('BC', sensitivity, perQ, 133);
  assert.strictEqual(r.subsetReliable, false);
  assert.ok(r.reliabilityReason.includes('insufficient_count'));
  assert.strictEqual(r.deviationFromABC, null);
});

test('J5-B02 evaluateSubsetReliability: all snapshots UNUSABLE → not reliable', () => {
  const sensitivity = { AB: { countAtRadius: 8, median: 100 } };
  const perQ = [makeGeoQual('UNUSABLE'), makeGeoQual('UNUSABLE'), makeGeoQual('UNUSABLE')];
  const r = evaluateSubsetReliability('AB', sensitivity, perQ, 100);
  assert.strictEqual(r.subsetReliable, false);
  assert.strictEqual(r.reliabilityReason, 'all_snapshots_unusable');
});

test('J5-B03 evaluateSubsetReliability: count ok + 1 eligible → reliable', () => {
  const sensitivity = { AB: { countAtRadius: 8, median: 136 } };
  // A=GOOD (eligible), B=UNUSABLE (not eligible)
  const perQ = [makeGeoQual('GOOD'), makeGeoQual('UNUSABLE'), makeGeoQual('DEGRADED')];
  const r = evaluateSubsetReliability('AB', sensitivity, perQ, 133);
  assert.strictEqual(r.subsetReliable, true);
  assert.strictEqual(r.eligibleSnapshotCount, 1);
});

test('J5-B04 evaluateSubsetReliability: AB maps indices 0+1 to A+B labels', () => {
  const sensitivity = { AB: { countAtRadius: 5, median: 100 } };
  const perQ = [makeGeoQual('GOOD'), makeGeoQual('DEGRADED'), makeGeoQual('POOR')];
  const r = evaluateSubsetReliability('AB', sensitivity, perQ, 100);
  assert.strictEqual(r.geoStatuses.A, 'GOOD');
  assert.strictEqual(r.geoStatuses.B, 'DEGRADED');
  assert.ok(!('C' in r.geoStatuses));
});

test('J5-B05 evaluateSubsetReliability: BC maps indices 1+2 to B+C labels', () => {
  const sensitivity = { BC: { countAtRadius: 5, median: 100 } };
  const perQ = [makeGeoQual('GOOD'), makeGeoQual('DEGRADED'), makeGeoQual('POOR')];
  const r = evaluateSubsetReliability('BC', sensitivity, perQ, 100);
  assert.strictEqual(r.geoStatuses.B, 'DEGRADED');
  assert.strictEqual(r.geoStatuses.C, 'POOR');
  assert.ok(!('A' in r.geoStatuses));
});

test('J5-B06 evaluateSubsetReliability: deviationFromABC computed for reliable subset', () => {
  const sensitivity = { AB: { countAtRadius: 8, median: 136 } };
  const perQ = [makeGeoQual('GOOD'), makeGeoQual('GOOD'), makeGeoQual('GOOD')];
  const r = evaluateSubsetReliability('AB', sensitivity, perQ, 133);
  // |136-133|/133*100 ≈ 2.26%
  assert.ok(r.subsetReliable);
  assert.ok(r.deviationFromABC != null && r.deviationFromABC > 2.0 && r.deviationFromABC < 3.0,
    `expected ~2.26%, got ${r.deviationFromABC}`);
});

test('J5-B07 evaluateSubsetReliability: abcMedian=null → deviationFromABC=null even if reliable', () => {
  const sensitivity = { AB: { countAtRadius: 8, median: 136 } };
  const perQ = [makeGeoQual('GOOD'), makeGeoQual('GOOD'), makeGeoQual('GOOD')];
  const r = evaluateSubsetReliability('AB', sensitivity, perQ, null);
  assert.strictEqual(r.deviationFromABC, null);
});

test('J5-B08 evaluateSubsetReliability: unknown subsetKey → null', () => {
  const r = evaluateSubsetReliability('XY', {}, [], 100);
  assert.strictEqual(r, null);
});

// ── C. computePooledReliabilityGate — gate rules ──────────────────────────────

test('J5-C01 gate: pool status !== ok → POOL_UNAVAILABLE', () => {
  const r = computePooledReliabilityGate({ status: 'insufficient_data', reason: 'no_radius' });
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'POOL_UNAVAILABLE');
  assert.strictEqual(r.RELIABLE_SUBSET_COUNT, 0);
});

test('J5-C02 gate: null pooledResult → POOL_UNAVAILABLE', () => {
  const r = computePooledReliabilityGate(null);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'POOL_UNAVAILABLE');
});

test('J5-C03 gate: only 2 snapshots (AB only), AB reliable → INSUFFICIENT_RELIABILITY_EVIDENCE', () => {
  const pooled = makeMockPooled({
    sensitivity:    { AB: { countAtRadius: 8, median: 110 } }, // no ABC key
    pairDeviation:  null,
    perSnapshotQuality: [makeGeoQual('GOOD'), makeGeoQual('GOOD')],
  });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'INSUFFICIENT_RELIABILITY_EVIDENCE');
  assert.strictEqual(r.RELIABLE_SUBSET_COUNT, 1); // only AB
});

test('J5-C04 gate: 3 snapshots, only 1 reliable → INSUFFICIENT_RELIABILITY_EVIDENCE', () => {
  const pooled = makeMockPooled({
    sensitivity: {
      AB:  { countAtRadius: 8, median: 136 },
      AC:  { countAtRadius: 1, median: 200 },  // too few
      BC:  { countAtRadius: 1, median: 75  },  // too few
      ABC: { countAtRadius: 9, median: 133 },
    },
  });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'INSUFFICIENT_RELIABILITY_EVIDENCE');
  assert.strictEqual(r.RELIABLE_SUBSET_COUNT, 1); // only AB
});

test('J5-C05 gate: all rules pass → STABLE_LOCAL_POOL, empty reasons', () => {
  const pooled = makeMockPooled({
    sensitivity: {
      AB:  { countAtRadius: 8, median: 136 },
      AC:  { countAtRadius: 9, median: 133 },
      BC:  { countAtRadius: 2, median: 75  },  // unreliable but ≥2 others are reliable
      ABC: { countAtRadius: 9, median: 133 },
    },
  });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'STABLE_LOCAL_POOL');
  assert.deepStrictEqual(r.POOLED_RELIABILITY_REASONS, []);
  assert.strictEqual(r.RELIABLE_SUBSET_COUNT, 2);
});

test('J5-C06 gate: abc_count < MIN_ABC_COMPARABLES → UNSTABLE_OR_INSUFFICIENT', () => {
  const pooled = makeMockPooled({ comparableCount: MIN_ABC_COMPARABLES - 1 });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'UNSTABLE_OR_INSUFFICIENT');
  assert.ok(r.POOLED_RELIABILITY_REASONS.some(s => s.includes('abc_count_below')));
});

test('J5-C07 gate: radius > MAX_ABC_RADIUS_KM → UNSTABLE_OR_INSUFFICIENT', () => {
  const pooled = makeMockPooled({ selectedRadiusKm: MAX_ABC_RADIUS_KM + 1 });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'UNSTABLE_OR_INSUFFICIENT');
  assert.ok(r.POOLED_RELIABILITY_REASONS.some(s => s.includes('radius_exceeds')));
});

test('J5-C08 gate: reliable deviation > MAX → UNSTABLE_OR_INSUFFICIENT', () => {
  const pooled = makeMockPooled({
    sensitivity: {
      AB:  { countAtRadius: 8, median: 200 },  // deviation = |200-133|/133*100 ≈ 50% > 15%
      AC:  { countAtRadius: 9, median: 133 },
      BC:  { countAtRadius: 2, median: 75  },
      ABC: { countAtRadius: 9, median: 133 },
    },
  });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'UNSTABLE_OR_INSUFFICIENT');
  assert.ok(r.POOLED_RELIABILITY_REASONS.some(s => s.includes('reliable_deviation_exceeds')));
});

test('J5-C09 gate: IQR > MAX_IQR_PCT → UNSTABLE_OR_INSUFFICIENT', () => {
  // IQR = (p75-p25)/median; make p75-p25 > 30% of median
  const pooled = makeMockPooled({
    pooledStats: { median: 100, p25: 50, p75: 150, p10: 30, p90: 200, count: 9 },
  });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'UNSTABLE_OR_INSUFFICIENT');
  assert.ok(r.POOLED_RELIABILITY_REASONS.some(s => s.includes('iqr_exceeds')));
});

test('J5-C10 gate: repeated price variation > MAX → UNSTABLE_OR_INSUFFICIENT', () => {
  const pooled = makeMockPooled({
    priceVariation: { max: MAX_REPEATED_VARIATION_PCT + 1, mean: 15, count: 3 },
  });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'UNSTABLE_OR_INSUFFICIENT');
  assert.ok(r.POOLED_RELIABILITY_REASONS.some(s => s.includes('repeated_variation_exceeds')));
});

test('J5-C11 gate: usable snapshots < MIN → UNSTABLE_OR_INSUFFICIENT', () => {
  // A=POOR (usable, eligible), B=UNUSABLE (not usable), C=UNUSABLE (not usable)
  // → usableSnapshotCount=1 < MIN_USABLE_SNAPSHOTS(2)
  // AB: eligible=1 (A), count=8 ≥ fallback → RELIABLE
  // AC: eligible=1 (A), count=9 ≥ fallback → RELIABLE
  // BC: eligible=0 (both unusable) → NOT reliable
  // RELIABLE_SUBSET_COUNT=2 ≥ MIN → reaches usable-snapshot rule → UNSTABLE
  const pooled = makeMockPooled({
    perSnapshotQuality: [
      makeGeoQual('POOR'),
      makeGeoQual('UNUSABLE'),
      makeGeoQual('UNUSABLE'),
    ],
  });
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'UNSTABLE_OR_INSUFFICIENT');
  assert.ok(r.POOLED_RELIABILITY_REASONS.some(s => s.includes('usable_snapshots_below')));
});

// ── D. M6 live scenario ───────────────────────────────────────────────────────

test('J5-D01 M6: BC unreliable (count=2<3), AB+AC reliable', () => {
  const pooled = makeMockPooled(); // BC countAtRadius=2 by default
  const r = computePooledReliabilityGate(pooled);
  assert.ok(r.reliableSubsets.includes('AB'), 'AB should be reliable');
  assert.ok(r.reliableSubsets.includes('AC'), 'AC should be reliable');
  assert.ok(r.UNRELIABLE_SUBSETS.includes('BC'), 'BC should be unreliable');
  assert.ok(r.subsets.BC.reliabilityReason.includes('insufficient_count'));
});

test('J5-D02 M6: gate produces STABLE_LOCAL_POOL', () => {
  const pooled = makeMockPooled();
  const r = computePooledReliabilityGate(pooled);
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'STABLE_LOCAL_POOL');
  assert.deepStrictEqual(r.POOLED_RELIABILITY_REASONS, []);
});

test('J5-D03 M6: RELIABLE_MAX_DEVIATION_PCT ≤ 15% (only AB+AC contribute)', () => {
  const pooled = makeMockPooled();
  const r = computePooledReliabilityGate(pooled);
  // AB dev ≈ 2.26%, AC dev = 0% → max ≈ 2.26% ≤ 15%
  assert.ok(r.RELIABLE_MAX_DEVIATION_PCT != null && r.RELIABLE_MAX_DEVIATION_PCT < MAX_RELIABLE_DEVIATION_PCT,
    `expected < ${MAX_RELIABLE_DEVIATION_PCT}%, got ${r.RELIABLE_MAX_DEVIATION_PCT}`);
});

test('J5-D04 M6: BC excluded from deviation does not affect stability', () => {
  // Verify that BC's 43.61% deviation is NOT in RELIABLE_MAX_DEVIATION_PCT
  const pooled = makeMockPooled();
  const r = computePooledReliabilityGate(pooled);
  // If BC were included, maxDev would be 43.61% > 15% → UNSTABLE. But it's excluded.
  assert.strictEqual(r.POOLED_RELIABILITY_STATUS, 'STABLE_LOCAL_POOL',
    'BC exclusion must prevent its deviation from triggering UNSTABLE');
});

// ── E. Safety invariants ──────────────────────────────────────────────────────

test('J5-E01 gate module: no SQL write statements', () => {
  const fs   = require('fs');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-reliability-gate.js'), 'utf8'
  );
  assert.ok(!src.includes(['INS', 'ERT '].join('')), 'module must not contain SQL INSERT');
});

test('J5-E02 gate module: no pool construction', () => {
  const fs   = require('fs');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-reliability-gate.js'), 'utf8'
  );
  assert.ok(!src.includes(['new', ' Pool('].join('')), 'module must not instantiate a DB pool');
});

test('J5-E03 gate module: no channex import', () => {
  const fs   = require('fs');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-reliability-gate.js'), 'utf8'
  );
  const chxRel = ["require", "('./chann"].join('');
  const chxUp  = ["require", "('../chann"].join('');
  assert.ok(!src.includes(chxRel) && !src.includes(chxUp), 'module must not import channex');
});

test('J5-E04 gate module: no pricing-apply import', () => {
  const fs   = require('fs');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-reliability-gate.js'), 'utf8'
  );
  const pRel = ["require", "('./pricing-apply"].join('');
  const pUp  = ["require", "('../pricing-apply"].join('');
  assert.ok(!src.includes(pRel) && !src.includes(pUp), 'module must not import pricing-apply');
});

// ── F. Validator modes ────────────────────────────────────────────────────────

test('J5-F01 previewMode: returns ok=false when property not found (proxies J4)', async () => {
  const pool = makeMockPool([]);
  const r = await previewMode({ name: 'DoesNotExist', pool });
  assert.strictEqual(r.ok, false);
});

test('J5-F02 executeMode: runs J4 then gate, returns j4Result and gate', async () => {
  const pool = makeMockPool([makePropRow('TestProp')]);
  const now  = new Date('2026-09-27T10:00:00Z');

  const calls = [];
  const mockScrape = async () => {
    calls.push(1);
    return {
      snapshotId:  `snap-${calls.length}`,
      listings:    [],
      diagnostics: { returnedCount: 0 },
    };
  };

  const r = await executeMode({
    name: 'TestProp', pool, _now: now, _airbnbScrape: mockScrape,
    _checkIn: '2026-10-11', _checkOut: '2026-10-14',
  });

  assert.ok('j4Result' in r, 'should return j4Result');
  assert.ok('gate' in r, 'should return gate');
  assert.ok(['POOL_UNAVAILABLE', 'INSUFFICIENT_RELIABILITY_EVIDENCE', 'STABLE_LOCAL_POOL', 'UNSTABLE_OR_INSUFFICIENT'].includes(r.gate.POOLED_RELIABILITY_STATUS));
});

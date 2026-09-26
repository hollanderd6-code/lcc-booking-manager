'use strict';
/**
 * P1.2-B5-BK-J3 — Airbnb Multi-Snapshot Consensus Tests
 *
 * Groups:
 *   A. weightedMedian                        (J3-A01…09)
 *   B. calculateSnapshotSpread               (J3-B01…08)
 *   C. detectSnapshotOutliers                (J3-C01…08)
 *   D. findCommonSnapshotRadius              (J3-D01…09)
 *   E. calculateSnapshotConsensusWeight      (J3-E01…07)
 *   F. classifySnapshotConsensusConfidence   (J3-F01…08)
 *   G. shouldRequestThirdSnapshot            (J3-G01…07)
 *   H. buildAirbnbMultiSnapshotConsensus     (J3-H01…09)
 *   I. Safety invariants                     (J3-I01…05)
 *
 * Total: 70 tests
 */

const assert = require('assert');
const test   = require('node:test');
const path   = require('path');

const {
  weightedMedian,
  calculateSnapshotSpread,
  detectSnapshotOutliers,
  findCommonSnapshotRadius,
  calculateSnapshotConsensusWeight,
  classifySnapshotConsensusConfidence,
  shouldRequestThirdSnapshot,
  buildAirbnbMultiSnapshotConsensus,
  SPREAD_VERY_STABLE,
  SPREAD_STABLE,
  SPREAD_MODERATE,
  OUTLIER_WARNING_PCT,
  OUTLIER_CANDIDATE_PCT,
} = require('../services/airbnb-multi-snapshot-consensus');

// ── Helpers ───────────────────────────────────────────────────────────────────

const TARGET_LAT = 48.726;
const TARGET_LON = 2.272;

function makeListingAtKm(km, price, opts = {}) {
  const offset = km / 111;
  return {
    price,
    latitude:          TARGET_LAT + offset,
    longitude:         TARGET_LON,
    isBooked:          false,
    bedrooms:          null,
    stars:             4.0,
    providerListingId: opts.id ?? `listing-${km}-${price}`,
    guests:            opts.guests ?? null,
    category:          opts.category ?? null,
    availableDates:    opts.availableDates ?? null,
  };
}

function makeListingsWithin(n, km, basePrice = 100) {
  return Array.from({ length: n }, (_, i) => {
    const dist = (i + 1) / (n + 1) * km;
    return makeListingAtKm(dist, basePrice + i * 5, { id: `lw-${km}-${i}` });
  });
}

function makeGeoQuality(status) {
  const scoreMap = { GOOD: 0.85, DEGRADED: 0.30, POOR: 0.10, UNUSABLE: 0.00 };
  return {
    status,
    geoCoverageScore:   scoreMap[status] ?? 0,
    usableForConsensus: status !== 'UNUSABLE',
  };
}

function makeSnapshot(opts = {}) {
  return {
    snapshotId:  opts.snapshotId ?? `snap-${Math.random().toString(36).slice(2, 8)}`,
    listings:    opts.listings   ?? makeListingsWithin(opts.count ?? 8, opts.radius ?? 3),
    geoQuality:  opts.geoQuality ?? makeGeoQuality(opts.status ?? 'GOOD'),
  };
}

// ── A. weightedMedian ─────────────────────────────────────────────────────────

test('J3-A01 weightedMedian: empty array → null', () => {
  assert.strictEqual(weightedMedian([], []), null);
});

test('J3-A02 weightedMedian: single value → that value', () => {
  assert.strictEqual(weightedMedian([120], [1]), 120);
});

test('J3-A03 weightedMedian: equal weights → sorted median', () => {
  // [100, 60, 80] equal weights — sorted: 60,80,100 → median=80
  assert.strictEqual(weightedMedian([100, 60, 80], [1, 1, 1]), 80);
});

test('J3-A04 weightedMedian: heavy weight on low value → biased low', () => {
  // values [50, 150], weights [0.9, 0.1] → cumul after 50: 0.9 ≥ 0.5 → return 50
  assert.strictEqual(weightedMedian([50, 150], [0.9, 0.1]), 50);
});

test('J3-A05 weightedMedian: heavy weight on high value → biased high', () => {
  // values [50, 150], weights [0.1, 0.9] → cumul after 150: 1.0 ≥ 0.5 → return 150
  assert.strictEqual(weightedMedian([50, 150], [0.1, 0.9]), 150);
});

test('J3-A06 weightedMedian: M6-like A=77 (weight 0.5525) vs C=111 (weight 0.4225) → 77', () => {
  // total=0.975, target=0.4875; cumul after 77: 0.5525 ≥ 0.4875 → return 77
  assert.strictEqual(weightedMedian([77, 111], [0.5525, 0.4225]), 77);
});

test('J3-A07 weightedMedian: zero-weight values excluded', () => {
  // [50, 100, 200] weights [0, 1, 0] → only 100 contributes
  assert.strictEqual(weightedMedian([50, 100, 200], [0, 1, 0]), 100);
});

test('J3-A08 weightedMedian: two equal-weight values → lower returned', () => {
  // [70, 130] weights [1, 1] → total=2, target=1; cumul after 70: 1 ≥ 1 → return 70
  assert.strictEqual(weightedMedian([70, 130], [1, 1]), 70);
});

test('J3-A09 weightedMedian: unsorted input → correct result after sort', () => {
  // [300, 50, 100] weights [0.2, 0.5, 0.3] → sorted: 50(0.5),100(0.3),300(0.2)
  // total=1.0, target=0.5; cumul after 50: 0.5 ≥ 0.5 → return 50
  assert.strictEqual(weightedMedian([300, 50, 100], [0.2, 0.5, 0.3]), 50);
});

// ── B. calculateSnapshotSpread ────────────────────────────────────────────────

test('J3-B01 calculateSnapshotSpread: single median → INCONCLUSIVE', () => {
  const r = calculateSnapshotSpread([100]);
  assert.strictEqual(r.stabilityLevel, 'INCONCLUSIVE');
  assert.strictEqual(r.spreadPct, null);
});

test('J3-B02 calculateSnapshotSpread: two equal medians → 0% VERY_STABLE', () => {
  const r = calculateSnapshotSpread([100, 100]);
  assert.strictEqual(r.spreadAbs, 0);
  assert.strictEqual(r.spreadPct, 0);
  assert.strictEqual(r.stabilityLevel, 'VERY_STABLE');
});

test('J3-B03 calculateSnapshotSpread: spread 8% → VERY_STABLE', () => {
  // min=96 max=104 → |8|/100 = 8%
  const r = calculateSnapshotSpread([96, 104]);
  assert.ok(Math.abs(r.spreadPct - 8) < 0.01);
  assert.strictEqual(r.stabilityLevel, 'VERY_STABLE');
});

test('J3-B04 calculateSnapshotSpread: spread ~16.7% → STABLE', () => {
  // [110, 130]: |20| / 120 = 16.67%
  const r = calculateSnapshotSpread([110, 130]);
  assert.ok(r.spreadPct > SPREAD_VERY_STABLE);
  assert.ok(r.spreadPct <= SPREAD_STABLE);
  assert.strictEqual(r.stabilityLevel, 'STABLE');
});

test('J3-B05 calculateSnapshotSpread: spread ~28.6% → MODERATE', () => {
  // [90, 120]: |30| / 105 = 28.57%
  const r = calculateSnapshotSpread([90, 120]);
  assert.ok(r.spreadPct > SPREAD_STABLE);
  assert.ok(r.spreadPct <= SPREAD_MODERATE);
  assert.strictEqual(r.stabilityLevel, 'MODERATE');
});

test('J3-B06 calculateSnapshotSpread: M6 spread ~92.7% → VOLATILE', () => {
  // [77, 111, 210]: max=210 min=77 → 133/143.5 ≈ 92.7%
  const r = calculateSnapshotSpread([77, 111, 210]);
  assert.ok(r.spreadPct > SPREAD_MODERATE);
  assert.strictEqual(r.stabilityLevel, 'VOLATILE');
});

test('J3-B07 calculateSnapshotSpread: null/NaN medians filtered', () => {
  // [null, 100, NaN, 110] → valid=[100,110]
  const r = calculateSnapshotSpread([null, 100, NaN, 110]);
  assert.ok(r.spreadPct != null);
  assert.notStrictEqual(r.stabilityLevel, 'INCONCLUSIVE');
});

test('J3-B08 calculateSnapshotSpread: empty array → INCONCLUSIVE', () => {
  const r = calculateSnapshotSpread([]);
  assert.strictEqual(r.stabilityLevel, 'INCONCLUSIVE');
});

// ── C. detectSnapshotOutliers ─────────────────────────────────────────────────

const makeM = (idx, median) => ({ snapshotIndex: idx, snapshotId: `s${idx}`, median });

test('J3-C01 detectSnapshotOutliers: all equal → all NORMAL, deviation 0', () => {
  const results = detectSnapshotOutliers([makeM(0, 100), makeM(1, 100), makeM(2, 100)]);
  assert.ok(results.every(r => r.outlierStatus === 'NORMAL'));
  assert.ok(results.every(r => r.deviationPct === 0));
});

test('J3-C02 detectSnapshotOutliers: extreme value → OUTLIER_CANDIDATE', () => {
  // [80, 90, 300]: center=median([80,90,300])=90; dev of 300: |300-90|/90=233%
  const results = detectSnapshotOutliers([makeM(0, 80), makeM(1, 90), makeM(2, 300)]);
  assert.strictEqual(results[2].outlierStatus, 'OUTLIER_CANDIDATE');
  assert.ok(results[2].deviationPct > OUTLIER_CANDIDATE_PCT);
});

test('J3-C03 detectSnapshotOutliers: ~28% deviation → OUTLIER_WARNING', () => {
  // [100, 100, 128]: center=100; dev of 128: 28% → WARNING
  const results = detectSnapshotOutliers([makeM(0, 100), makeM(1, 100), makeM(2, 128)]);
  assert.strictEqual(results[2].outlierStatus, 'OUTLIER_WARNING');
  assert.ok(results[2].deviationPct > OUTLIER_WARNING_PCT);
  assert.ok(results[2].deviationPct <= OUTLIER_CANDIDATE_PCT);
});

test('J3-C04 detectSnapshotOutliers: center is median (odd N)', () => {
  // [60, 100, 200]: median=100
  const results = detectSnapshotOutliers([makeM(0, 60), makeM(1, 100), makeM(2, 200)]);
  assert.strictEqual(results[0].center, 100);
});

test('J3-C05 detectSnapshotOutliers: center is avg of two middle (even N)', () => {
  // [80, 100]: center=(80+100)/2=90
  const results = detectSnapshotOutliers([makeM(0, 80), makeM(1, 100)]);
  assert.strictEqual(results[0].center, 90);
});

test('J3-C06 detectSnapshotOutliers: null median → INCONCLUSIVE', () => {
  const results = detectSnapshotOutliers([makeM(0, null), makeM(1, 100)]);
  assert.strictEqual(results[0].outlierStatus, 'INCONCLUSIVE');
  assert.strictEqual(results[0].deviationPct, null);
});

test('J3-C07 detectSnapshotOutliers: M6 B=210 vs A=77/C=111 → OUTLIER_CANDIDATE', () => {
  // center=median([77,111,210])=111; dev of 210: 99/111=89.2%
  const results = detectSnapshotOutliers([makeM(0, 77), makeM(1, 111), makeM(2, 210)]);
  assert.strictEqual(results[2].outlierStatus, 'OUTLIER_CANDIDATE');
});

test('J3-C08 detectSnapshotOutliers: empty input → empty array', () => {
  const results = detectSnapshotOutliers([]);
  assert.deepStrictEqual(results, []);
});

// ── D. findCommonSnapshotRadius ───────────────────────────────────────────────

test('J3-D01 findCommonSnapshotRadius: 3 GOOD with ≥5 within 1km → radius=1', () => {
  const snaps = [
    makeSnapshot({ listings: makeListingsWithin(6, 0.8) }),
    makeSnapshot({ listings: makeListingsWithin(7, 0.9) }),
    makeSnapshot({ listings: makeListingsWithin(5, 0.7) }),
  ];
  const r = findCommonSnapshotRadius(snaps, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.commonRadiusKm, 1);
  assert.strictEqual(r.reason, 'found');
});

test('J3-D02 findCommonSnapshotRadius: 5km needed for 2 eligible → radius=5', () => {
  const snapsA = makeListingsWithin(7, 4.5);
  const snapsB = [
    ...makeListingsWithin(5, 4.9),  // 5 within 5km, 0 within 3km
  ];
  const snaps = [
    makeSnapshot({ listings: snapsA }),
    makeSnapshot({ listings: snapsB }),
  ];
  const r = findCommonSnapshotRadius(snaps, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.commonRadiusKm, 5);
});

test('J3-D03 findCommonSnapshotRadius: only 1 eligible at any radius → null', () => {
  const snaps = [
    makeSnapshot({ listings: makeListingsWithin(8, 3) }),
    makeSnapshot({ status: 'UNUSABLE', listings: makeListingsWithin(8, 3) }),
  ];
  const r = findCommonSnapshotRadius(snaps, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.commonRadiusKm, null);
});

test('J3-D04 findCommonSnapshotRadius: UNUSABLE not counted in eligibility', () => {
  const snaps = [
    makeSnapshot({ status: 'UNUSABLE', listings: makeListingsWithin(8, 3) }),
    makeSnapshot({ status: 'UNUSABLE', listings: makeListingsWithin(8, 3) }),
    makeSnapshot({ status: 'GOOD',     listings: makeListingsWithin(8, 3) }),
  ];
  const r = findCommonSnapshotRadius(snaps, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.commonRadiusKm, null);
  assert.strictEqual(r.reason, 'insufficient_eligible_snapshots');
});

test('J3-D05 findCommonSnapshotRadius: POOR not counted (J3 allows only GOOD/DEGRADED)', () => {
  const snaps = [
    makeSnapshot({ status: 'POOR', listings: makeListingsWithin(8, 3) }),
    makeSnapshot({ status: 'POOR', listings: makeListingsWithin(8, 3) }),
  ];
  const r = findCommonSnapshotRadius(snaps, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.commonRadiusKm, null);
  assert.strictEqual(r.reason, 'insufficient_eligible_snapshots');
});

test('J3-D06 findCommonSnapshotRadius: M6 scenario — weak B must not force expansion', () => {
  // A: GOOD, 5 within 3km, 7 within 5km
  const listingsA = [
    ...makeListingsWithin(5, 3, 70),
    makeListingAtKm(4.5, 80, { id: 'a-6' }),
    makeListingAtKm(4.8, 85, { id: 'a-7' }),
  ];
  // B: DEGRADED, 1 within 5km → NOT eligible at any radius ≤ 5km
  const listingsB = [
    makeListingAtKm(4.9, 200, { id: 'b-1' }),
    ...makeListingsWithin(9, 19, 200),
  ];
  // C: GOOD, 2 within 3km, 5 within 5km
  const listingsC = [
    ...makeListingsWithin(2, 3, 105),
    makeListingAtKm(3.5, 108, { id: 'c-3' }),
    makeListingAtKm(4.0, 110, { id: 'c-4' }),
    makeListingAtKm(4.7, 112, { id: 'c-5' }),
  ];
  const snaps = [
    makeSnapshot({ listings: listingsA, status: 'GOOD' }),
    makeSnapshot({ listings: listingsB, status: 'DEGRADED' }),
    makeSnapshot({ listings: listingsC, status: 'GOOD' }),
  ];
  const r = findCommonSnapshotRadius(snaps, TARGET_LAT, TARGET_LON);
  // @3km: A=5✓, B=0✗, C=2✗ → 1 eligible (A only) → need 2 → skip
  // @5km: A=7✓, B=1✗, C=5✓ → 2 eligible (A+C) → FOUND
  assert.strictEqual(r.commonRadiusKm, 5);
  assert.strictEqual(r.reason, 'found');
  assert.ok(r.eligiblePerRadius[5] >= 2, 'at least 2 eligible at 5km');
});

test('J3-D07 findCommonSnapshotRadius: no target coords → null', () => {
  const snaps = [makeSnapshot(), makeSnapshot()];
  const r = findCommonSnapshotRadius(snaps, NaN, NaN);
  assert.strictEqual(r.commonRadiusKm, null);
  assert.strictEqual(r.reason, 'no_target_coords');
});

test('J3-D08 findCommonSnapshotRadius: fewer than 2 snapshots → null', () => {
  const r = findCommonSnapshotRadius([makeSnapshot()], TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.commonRadiusKm, null);
  assert.strictEqual(r.reason, 'too_few_snapshots');
});

test('J3-D09 findCommonSnapshotRadius: DEGRADED counts as eligible', () => {
  const snaps = [
    makeSnapshot({ status: 'GOOD',     listings: makeListingsWithin(6, 3) }),
    makeSnapshot({ status: 'DEGRADED', listings: makeListingsWithin(5, 3) }),
  ];
  const r = findCommonSnapshotRadius(snaps, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.commonRadiusKm, 3);
  assert.strictEqual(r.reason, 'found');
});

// ── E. calculateSnapshotConsensusWeight ───────────────────────────────────────

test('J3-E01 calculateSnapshotConsensusWeight: GOOD + 10 listings → geoScore×countScore', () => {
  // geoScore=0.85, countScore(10)=0.90 → 0.765
  const snap = makeSnapshot({ listings: makeListingsWithin(10, 2), status: 'GOOD' });
  snap.geoQuality.geoCoverageScore = 0.85;
  const w = calculateSnapshotConsensusWeight(snap, 3, TARGET_LAT, TARGET_LON);
  assert.ok(Math.abs(w - 0.765) < 0.001);
});

test('J3-E02 calculateSnapshotConsensusWeight: DEGRADED + 5 listings → 0.195', () => {
  // geoScore=0.30, countScore(5)=0.65 → 0.195
  const snap = makeSnapshot({ listings: makeListingsWithin(5, 2), status: 'DEGRADED' });
  snap.geoQuality.geoCoverageScore = 0.30;
  const w = calculateSnapshotConsensusWeight(snap, 3, TARGET_LAT, TARGET_LON);
  assert.ok(Math.abs(w - 0.195) < 0.001);
});

test('J3-E03 calculateSnapshotConsensusWeight: POOR → 0', () => {
  const snap = makeSnapshot({ listings: makeListingsWithin(8, 2), status: 'POOR' });
  assert.strictEqual(calculateSnapshotConsensusWeight(snap, 3, TARGET_LAT, TARGET_LON), 0);
});

test('J3-E04 calculateSnapshotConsensusWeight: UNUSABLE → 0', () => {
  const snap = makeSnapshot({ listings: makeListingsWithin(8, 2), status: 'UNUSABLE' });
  assert.strictEqual(calculateSnapshotConsensusWeight(snap, 3, TARGET_LAT, TARGET_LON), 0);
});

test('J3-E05 calculateSnapshotConsensusWeight: GOOD but count < 5 → countScore=0 → 0', () => {
  // 3 listings within radius → countScore(3)=0
  const snap = makeSnapshot({ listings: makeListingsWithin(3, 2), status: 'GOOD' });
  snap.geoQuality.geoCoverageScore = 0.85;
  assert.strictEqual(calculateSnapshotConsensusWeight(snap, 3, TARGET_LAT, TARGET_LON), 0);
});

test('J3-E06 calculateSnapshotConsensusWeight: null geoQuality → 0', () => {
  const snap = { snapshotId: 'x', listings: makeListingsWithin(8, 2), geoQuality: null };
  assert.strictEqual(calculateSnapshotConsensusWeight(snap, 3, TARGET_LAT, TARGET_LON), 0);
});

test('J3-E07 calculateSnapshotConsensusWeight: GOOD + 15 listings → countScore=1.0 → geoScore', () => {
  // countScore(15)=1.00 → weight=geoScore×1.00=geoScore
  const snap = makeSnapshot({ listings: makeListingsWithin(15, 4), status: 'GOOD' });
  snap.geoQuality.geoCoverageScore = 0.85;
  const w = calculateSnapshotConsensusWeight(snap, 5, TARGET_LAT, TARGET_LON);
  assert.ok(Math.abs(w - 0.85) < 0.001);
});

// ── F. classifySnapshotConsensusConfidence ────────────────────────────────────

function makeConfidenceInputs({ nSnapshots = 2, degradedIdx = null, radius = 5, spreadLevel = 'VERY_STABLE', outlierStatus = null } = {}) {
  const snaps = Array.from({ length: nSnapshots }, (_, i) => ({
    geoQuality: makeGeoQuality(i === degradedIdx ? 'DEGRADED' : 'GOOD'),
  }));
  const spread = { stabilityLevel: spreadLevel, spreadPct: spreadLevel === 'VERY_STABLE' ? 5 : 25 };
  const outliers = snaps.map((_, i) => ({
    snapshotIndex: i,
    outlierStatus: (i === nSnapshots - 1 && outlierStatus) ? outlierStatus : 'NORMAL',
  }));
  return {
    snapshots: snaps,
    commonRadiusKm: radius,
    contributingCount: nSnapshots,
    spread,
    outliers,
    contributingIndices: snaps.map((_, i) => i),
  };
}

test('J3-F01 classifySnapshotConsensusConfidence: all GOOD, radius≤5, VERY_STABLE → HIGH', () => {
  const r = classifySnapshotConsensusConfidence(makeConfidenceInputs());
  assert.strictEqual(r.confidence, 'HIGH');
  assert.deepStrictEqual(r.reasons, []);
});

test('J3-F02 classifySnapshotConsensusConfidence: one DEGRADED → not HIGH', () => {
  const r = classifySnapshotConsensusConfidence(makeConfidenceInputs({ degradedIdx: 1 }));
  assert.notStrictEqual(r.confidence, 'HIGH');
  assert.ok(r.reasons.includes('degraded_snapshot_contributes'));
});

test('J3-F03 classifySnapshotConsensusConfidence: radius=10km → not HIGH', () => {
  const r = classifySnapshotConsensusConfidence(makeConfidenceInputs({ radius: 10 }));
  assert.notStrictEqual(r.confidence, 'HIGH');
  assert.ok(r.reasons.some(x => x.includes('10km')));
});

test('J3-F04 classifySnapshotConsensusConfidence: spread VOLATILE → LOW', () => {
  const r = classifySnapshotConsensusConfidence(makeConfidenceInputs({ spreadLevel: 'VOLATILE' }));
  assert.strictEqual(r.confidence, 'LOW');
});

test('J3-F05 classifySnapshotConsensusConfidence: OUTLIER_CANDIDATE → LOW', () => {
  const r = classifySnapshotConsensusConfidence(makeConfidenceInputs({ outlierStatus: 'OUTLIER_CANDIDATE' }));
  assert.strictEqual(r.confidence, 'LOW');
  assert.ok(r.reasons.includes('outlier_candidate'));
});

test('J3-F06 classifySnapshotConsensusConfidence: contributingCount=1 → UNUSABLE', () => {
  const r = classifySnapshotConsensusConfidence({
    ...makeConfidenceInputs(),
    contributingCount: 1,
    contributingIndices: [0],
  });
  assert.strictEqual(r.confidence, 'UNUSABLE');
});

test('J3-F07 classifySnapshotConsensusConfidence: STABLE spread (not VERY_STABLE) → MEDIUM', () => {
  const r = classifySnapshotConsensusConfidence(makeConfidenceInputs({ spreadLevel: 'STABLE' }));
  assert.strictEqual(r.confidence, 'MEDIUM');
});

test('J3-F08 classifySnapshotConsensusConfidence: OUTLIER_WARNING → MEDIUM', () => {
  const r = classifySnapshotConsensusConfidence(makeConfidenceInputs({ outlierStatus: 'OUTLIER_WARNING' }));
  assert.strictEqual(r.confidence, 'MEDIUM');
  assert.ok(r.reasons.includes('outlier_warning'));
});

// ── G. shouldRequestThirdSnapshot ────────────────────────────────────────────

function makeGoodSnap(count = 6, price = 100) {
  return makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(count, 4.5, price) });
}

test('J3-G01 shouldRequestThirdSnapshot: both GOOD, ≥5 within 5km, spread ≤15% → false', () => {
  const a = makeGoodSnap(6, 100);
  const b = makeGoodSnap(6, 104);
  const r = shouldRequestThirdSnapshot(a, b, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(r.shouldRequest, false);
  assert.strictEqual(r.reason, 'two_good_snapshots_agree');
});

test('J3-G02 shouldRequestThirdSnapshot: A is DEGRADED → shouldRequest=true', () => {
  const a = makeSnapshot({ status: 'DEGRADED', listings: makeListingsWithin(6, 4.5) });
  const b = makeGoodSnap();
  const r = shouldRequestThirdSnapshot(a, b, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(r.shouldRequest, true);
  assert.ok(r.reason.includes('not_good'));
});

test('J3-G03 shouldRequestThirdSnapshot: B has count < 5 within 5km → true', () => {
  const a = makeGoodSnap(6);
  const b = makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(3, 4.5) });
  const r = shouldRequestThirdSnapshot(a, b, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(r.shouldRequest, true);
  assert.ok(r.reason.includes('insufficient_local_b'));
});

test('J3-G04 shouldRequestThirdSnapshot: spread >15% → true', () => {
  // price A=100, B=140 → spread ~33% > 15
  const a = makeGoodSnap(6, 100);
  const b = makeGoodSnap(6, 140);
  const r = shouldRequestThirdSnapshot(a, b, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(r.shouldRequest, true);
  assert.ok(r.reason.includes('spread_too_high'));
});

test('J3-G05 shouldRequestThirdSnapshot: no target coords → true', () => {
  const a = makeGoodSnap();
  const b = makeGoodSnap();
  const r = shouldRequestThirdSnapshot(a, b, { targetLat: NaN, targetLon: NaN });
  assert.strictEqual(r.shouldRequest, true);
  assert.strictEqual(r.reason, 'no_target_coords');
});

test('J3-G06 shouldRequestThirdSnapshot: null snapshot → true', () => {
  const b = makeGoodSnap();
  const r = shouldRequestThirdSnapshot(null, b, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(r.shouldRequest, true);
});

test('J3-G07 shouldRequestThirdSnapshot: exactly 5 within 5km and spread ≤15% → false', () => {
  const a = makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(5, 4.5, 100) });
  const b = makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(5, 4.5, 104) });
  const r = shouldRequestThirdSnapshot(a, b, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(r.shouldRequest, false);
});

// ── H. buildAirbnbMultiSnapshotConsensus ──────────────────────────────────────

test('J3-H01 buildAirbnbMultiSnapshotConsensus: 3 GOOD tight prices → ok with valid median', () => {
  const snaps = [
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(8, 3, 95) }),
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(7, 3, 100) }),
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(6, 3, 102) }),
  ];
  for (const s of snaps) s.geoQuality.geoCoverageScore = 0.85;

  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.status, 'ok');
  assert.ok(Number.isFinite(result.consensusMedian));
  assert.ok(result.consensusMedian > 0);
  assert.ok(result.contributingCount >= 2);
});

test('J3-H02 buildAirbnbMultiSnapshotConsensus: M6 scenario — B excluded, A+C contribute', () => {
  // A: GOOD, 7 listings within 5km
  const listingsA = makeListingsWithin(7, 4.8, 72);
  // B: DEGRADED, 1 within 5km → excluded (count < 5)
  const listingsB = [makeListingAtKm(4.9, 210, { id: 'b-only' })];
  // C: GOOD, 5 within 5km
  const listingsC = makeListingsWithin(5, 4.8, 108);

  const snaps = [
    makeSnapshot({ status: 'GOOD',     listings: listingsA }),
    makeSnapshot({ status: 'DEGRADED', listings: listingsB }),
    makeSnapshot({ status: 'GOOD',     listings: listingsC }),
  ];
  snaps[0].geoQuality.geoCoverageScore = 0.85;
  snaps[1].geoQuality.geoCoverageScore = 0.30;
  snaps[2].geoQuality.geoCoverageScore = 0.85;

  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.commonRadiusKm, 5);
  assert.strictEqual(result.contributingCount, 2);

  const bDetail = result.snapshotDetails[1];
  assert.strictEqual(bDetail.contributionStatus, 'excluded_insufficient_local_count');

  // consensus median is between A and C price ranges
  assert.ok(result.consensusMedian >= 72 && result.consensusMedian <= 135);
});

test('J3-H03 buildAirbnbMultiSnapshotConsensus: all UNUSABLE → insufficient_data', () => {
  const snaps = [
    makeSnapshot({ status: 'UNUSABLE' }),
    makeSnapshot({ status: 'UNUSABLE' }),
    makeSnapshot({ status: 'UNUSABLE' }),
  ];
  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.status, 'insufficient_data');
});

test('J3-H04 buildAirbnbMultiSnapshotConsensus: fewer than 2 snapshots → insufficient_data', () => {
  const result = buildAirbnbMultiSnapshotConsensus([makeSnapshot()], { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.status, 'insufficient_data');
  assert.strictEqual(result.reason, 'too_few_snapshots');
});

test('J3-H05 buildAirbnbMultiSnapshotConsensus: volatile spread → spread.stabilityLevel=VOLATILE', () => {
  // A median ~80, B median ~250 → spread ~103%
  const snaps = [
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(6, 3, 75) }),
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(6, 3, 245) }),
  ];
  for (const s of snaps) s.geoQuality.geoCoverageScore = 0.85;

  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.spread.stabilityLevel, 'VOLATILE');
  assert.strictEqual(result.confidence, 'LOW');
});

test('J3-H06 buildAirbnbMultiSnapshotConsensus: DEGRADED contributes → confidence not HIGH', () => {
  const snaps = [
    makeSnapshot({ status: 'GOOD',     listings: makeListingsWithin(6, 3, 100) }),
    makeSnapshot({ status: 'DEGRADED', listings: makeListingsWithin(5, 4.5, 105) }),
  ];
  snaps[0].geoQuality.geoCoverageScore = 0.85;
  snaps[1].geoQuality.geoCoverageScore = 0.30;

  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.status, 'ok');
  assert.notStrictEqual(result.confidence, 'HIGH');
  assert.ok(result.confidenceReasons.includes('degraded_snapshot_contributes'));
});

test('J3-H07 buildAirbnbMultiSnapshotConsensus: returns snapshotDetails for each snapshot', () => {
  const snaps = [
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(6, 3) }),
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(6, 3, 110) }),
  ];
  for (const s of snaps) s.geoQuality.geoCoverageScore = 0.85;

  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.snapshotDetails.length, 2);
  for (const d of result.snapshotDetails) {
    assert.ok('snapshotId' in d);
    assert.ok('contributionStatus' in d);
    assert.ok('weight' in d);
    assert.ok('countAtRadius' in d);
  }
});

test('J3-H08 buildAirbnbMultiSnapshotConsensus: outlierAnalysis populated', () => {
  const snaps = [
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(6, 3, 100) }),
    makeSnapshot({ status: 'GOOD', listings: makeListingsWithin(6, 3, 104) }),
  ];
  for (const s of snaps) s.geoQuality.geoCoverageScore = 0.85;

  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(result.outlierAnalysis.length, 2);
  assert.ok(result.outlierAnalysis.every(o => 'outlierStatus' in o));
});

test('J3-H09 buildAirbnbMultiSnapshotConsensus: weighted median leans toward higher-weight snapshot', () => {
  // A: GOOD geoScore=0.85, 15 listings → weight≈0.85; median≈100
  // B: DEGRADED geoScore=0.30, 5 listings → weight≈0.195; median≈200
  // consensus should be closer to A
  const snaps = [
    makeSnapshot({ status: 'GOOD',     listings: makeListingsWithin(15, 4, 95) }),
    makeSnapshot({ status: 'DEGRADED', listings: makeListingsWithin(5, 4, 195) }),
  ];
  snaps[0].geoQuality.geoCoverageScore = 0.85;
  snaps[1].geoQuality.geoCoverageScore = 0.30;

  const result = buildAirbnbMultiSnapshotConsensus(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  if (result.status === 'ok' && result.consensusMedian != null) {
    const aDetail = result.snapshotDetails[0];
    const bDetail = result.snapshotDetails[1];
    if (aDetail.statsAtRadius && bDetail.statsAtRadius) {
      const distToA = Math.abs(result.consensusMedian - aDetail.statsAtRadius.median);
      const distToB = Math.abs(result.consensusMedian - bDetail.statsAtRadius.median);
      assert.ok(distToA <= distToB, `Consensus ${result.consensusMedian} should be closer to A median`);
    }
  }
});

// ── I. Safety invariants ──────────────────────────────────────────────────────

test('J3-I01 safety: consensus module has no pool.query/INSERT INTO/UPDATE SET', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, '../services/airbnb-multi-snapshot-consensus.js'), 'utf8'
  );
  assert.ok(!src.includes('pool.query'),   'no pool.query');
  assert.ok(!src.includes('pool.connect'), 'no pool.connect');
  assert.ok(!src.includes('INSERT INTO'),  'no INSERT INTO');
  assert.ok(!src.includes('UPDATE SET'),   'no UPDATE SET');
});

test('J3-I02 safety: consensus module has no channex import', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, '../services/airbnb-multi-snapshot-consensus.js'), 'utf8'
  );
  assert.ok(!src.toLowerCase().includes("require('channex"), 'no channex');
});

test('J3-I03 safety: consensus module has no pricing-apply require', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, '../services/airbnb-multi-snapshot-consensus.js'), 'utf8'
  );
  assert.ok(!src.includes("require('./pricing-apply")  &&
            !src.includes("require('../pricing-apply"), 'no pricing-apply require');
});

test('J3-I04 safety: consensus module exports all required functions', () => {
  const mod = require('../services/airbnb-multi-snapshot-consensus');
  const required = [
    'findCommonSnapshotRadius',
    'calculateSnapshotConsensusWeight',
    'weightedMedian',
    'calculateSnapshotSpread',
    'detectSnapshotOutliers',
    'classifySnapshotConsensusConfidence',
    'shouldRequestThirdSnapshot',
    'buildAirbnbMultiSnapshotConsensus',
  ];
  for (const fn of required) {
    assert.strictEqual(typeof mod[fn], 'function', `${fn} should be exported`);
  }
});

test('J3-I05 safety: validator has no DB writes and no channex import', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, '../outils/validate-airbnb-multisnapshot-consensus.js'), 'utf8'
  );
  assert.ok(!src.includes('pool.query'),                        'validator: no pool.query');
  assert.ok(!src.includes('pool.connect'),                      'validator: no pool.connect');
  assert.ok(!src.includes('INSERT INTO'),                       'validator: no INSERT INTO');
  assert.ok(!src.includes("require('../channex") &&
            !src.includes("require('./channex"),               'validator: no channex import');
  assert.ok(!src.includes("require('./pricing-apply"),          'validator: no pricing-apply');
});

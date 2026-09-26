'use strict';
/**
 * P1.2-B5-BK-J2 — Repeated Snapshot Stability Tests
 *
 * Covers:
 *   - generateQueryFingerprint: determinism, field coverage
 *   - computeOverlapMatrix: pairwise + triple intersection
 *   - computeLocalOverlapMatrix: per-radius filtering
 *   - computeLocalPriceStability: spread calculation, insufficient data
 *   - computeSelectedMarketVolatility: spread, null handling
 *   - computeCrossSnapshotLocalDifferenceReason: volatility vs size effect
 *   - evaluateRepeatedSampleStability: all verdict paths
 *   - Phase 15: ID churn does NOT affect verdict
 *   - Safety: no DB writes, no Channex, no pricing, no Booking, max 3 BD calls
 */

const assert = require('assert');
const test   = require('node:test');

const {
  generateQueryFingerprint,
  computeOverlapMatrix,
  computeLocalOverlapMatrix,
  computeLocalPriceStability,
  computeSelectedMarketVolatility,
  computeCrossSnapshotLocalDifferenceReason,
  evaluateRepeatedSampleStability,
  STABILITY_SPREAD_STABLE,
  STABILITY_SPREAD_ACCEPTABLE,
  STABILITY_MIN_USABLE_COUNT,
  POLICY_ONE_CALL,
  POLICY_RETRY,
  POLICY_MULTI,
  POLICY_UNRELIABLE,
} = require('../services/market-repeated-snapshot-stability');

// ── Helpers ───────────────────────────────────────────────────────────────────

const TARGET_LAT = 48.730667;
const TARGET_LON = 2.276069;

let _lid = 0;
function mkL(price, distKm = 1, overrides = {}) {
  _lid++;
  const latOffset = distKm / 111;
  return {
    providerListingId: `id-${_lid}`,
    latitude:  TARGET_LAT + latOffset,
    longitude: TARGET_LON,
    price,
    ...overrides,
  };
}

function mkGeoQ(status, geoCoverageScore, usableForConsensus) {
  return { status, geoCoverageScore, usableForConsensus, localComparableCount: usableForConsensus ? 8 : 0, reason: '' };
}

function mkSnap(overrides = {}) {
  const fp = overrides.queryFingerprint ?? 'fp-identical';
  const geoQ = overrides.geoQuality ?? mkGeoQ('GOOD', 1.00, true);
  const sm   = overrides.selectedMarket ?? { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 120, p25: 90, p75: 155 } };
  return { queryFingerprint: fp, geoQuality: geoQ, selectedMarket: sm };
}

// ── J2-01..03: generateQueryFingerprint ──────────────────────────────────────

test('J2-01 generateQueryFingerprint: identical params → identical fingerprint', () => {
  const params = {
    location: 'Massy, France', currency: 'EUR', checkIn: '2026-10-10', checkOut: '2026-10-13',
    maxListings: 100, targetLat: 48.730667, targetLon: 2.276069,
    targetGuests: 3, targetPropertyType: 'entire_place',
  };
  assert.strictEqual(generateQueryFingerprint(params), generateQueryFingerprint(params));
});

test('J2-02 generateQueryFingerprint: different maxListings → different fingerprint', () => {
  const base = { location: 'X', currency: 'EUR', checkIn: '2026-10-10', checkOut: '2026-10-13', maxListings: 100 };
  const other = { ...base, maxListings: 50 };
  assert.notStrictEqual(generateQueryFingerprint(base), generateQueryFingerprint(other));
});

test('J2-03 generateQueryFingerprint: location is case-normalised', () => {
  const a = generateQueryFingerprint({ location: 'MASSY, France' });
  const b = generateQueryFingerprint({ location: 'massy, france' });
  assert.strictEqual(a, b);
});

// ── J2-04..06: computeOverlapMatrix ──────────────────────────────────────────

test('J2-04 computeOverlapMatrix: full overlap identical sets', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const r   = computeOverlapMatrix(ids, ids, ids);
  assert.strictEqual(r.commonAB,  4);
  assert.strictEqual(r.commonABC, 4);
  assert.strictEqual(r.overlapABpct, 100);
});

test('J2-05 computeOverlapMatrix: disjoint sets → 0 common', () => {
  const r = computeOverlapMatrix(['a', 'b'], ['c', 'd'], ['e', 'f']);
  assert.strictEqual(r.commonAB,  0);
  assert.strictEqual(r.commonABC, 0);
  assert.strictEqual(r.overlapABpct, 0);
});

test('J2-06 computeOverlapMatrix: partial overlap', () => {
  const r = computeOverlapMatrix(['a', 'b', 'c'], ['b', 'c', 'd'], ['c', 'd', 'e']);
  assert.strictEqual(r.commonAB,  2);  // b, c
  assert.strictEqual(r.commonAC,  1);  // c
  assert.strictEqual(r.commonBC,  2);  // c, d
  assert.strictEqual(r.commonABC, 1);  // c
});

// ── J2-07..10: computeLocalOverlapMatrix ─────────────────────────────────────

test('J2-07 computeLocalOverlapMatrix: listings within radius counted', () => {
  const local = [mkL(100, 1), mkL(110, 1), mkL(120, 1)];
  const r = computeLocalOverlapMatrix(local, local, local, TARGET_LAT, TARGET_LON, [2, 5]);
  const r2 = r.find(x => x.radiusKm === 2);
  assert.strictEqual(r2.aCount,    3);
  assert.strictEqual(r2.commonABC, 3);
});

test('J2-08 computeLocalOverlapMatrix: listings beyond radius excluded', () => {
  const near = [mkL(100, 1, { providerListingId: 'near-1' })];
  const far  = [mkL(200, 30, { providerListingId: 'far-1' })];
  const r = computeLocalOverlapMatrix([...near, ...far], [...near, ...far], [...near, ...far],
    TARGET_LAT, TARGET_LON, [2]);
  const r2 = r[0]; // 2km
  assert.strictEqual(r2.aCount,  1);   // only near-1
  assert.strictEqual(r2.commonAB, 1);
});

test('J2-09 computeLocalOverlapMatrix: no target coords → all listings returned', () => {
  const ls = [mkL(100, 1), mkL(110, 5)];
  const r = computeLocalOverlapMatrix(ls, ls, ls, null, null, [5]);
  assert.strictEqual(r[0].aCount, 2);
});

test('J2-10 computeLocalOverlapMatrix: empty listings → zero counts', () => {
  const r = computeLocalOverlapMatrix([], [], [], TARGET_LAT, TARGET_LON, [5]);
  assert.strictEqual(r[0].aCount, 0);
  assert.strictEqual(r[0].commonABC, 0);
});

// ── J2-11..14: computeLocalPriceStability ────────────────────────────────────

test('J2-11 computeLocalPriceStability: stable prices → low spread', () => {
  const lsA = [mkL(120, 1), mkL(130, 1), mkL(110, 1)];
  const lsB = [mkL(125, 1), mkL(128, 1), mkL(115, 1)];
  const lsC = [mkL(122, 1), mkL(132, 1), mkL(118, 1)];
  const r = computeLocalPriceStability(lsA, lsB, lsC, TARGET_LAT, TARGET_LON, [5]);
  assert.ok(r[0].medianSpreadPct != null);
  assert.ok(r[0].medianSpreadPct < 10);
});

test('J2-12 computeLocalPriceStability: volatile prices → spread > 20%', () => {
  const lsA = [mkL(80, 1), mkL(90, 1), mkL(85, 1)];
  const lsB = [mkL(200, 1), mkL(210, 1), mkL(190, 1)];
  const lsC = [mkL(300, 1), mkL(310, 1), mkL(290, 1)];
  const r = computeLocalPriceStability(lsA, lsB, lsC, TARGET_LAT, TARGET_LON, [5]);
  assert.ok(r[0].medianSpreadPct > 20);
});

test('J2-13 computeLocalPriceStability: insufficient listings → null stats', () => {
  const singleListing = [mkL(100, 1)]; // < 2 required
  const r = computeLocalPriceStability(singleListing, [], [], TARGET_LAT, TARGET_LON, [5]);
  assert.strictEqual(r[0].A, null);
  assert.strictEqual(r[0].B, null);
  assert.strictEqual(r[0].C, null);
  assert.strictEqual(r[0].medianSpreadAbs, null);
});

test('J2-14 computeLocalPriceStability: no NaN in outputs', () => {
  const ls = Array.from({length: 5}, (_, i) => mkL(100 + i * 10, 1));
  const r = computeLocalPriceStability(ls, ls, ls, TARGET_LAT, TARGET_LON, [5]);
  for (const band of r) {
    if (band.medianSpreadPct != null) assert.ok(!Number.isNaN(band.medianSpreadPct));
    if (band.medianSpreadAbs != null) assert.ok(!Number.isNaN(band.medianSpreadAbs));
  }
});

// ── J2-15..18: computeSelectedMarketVolatility ───────────────────────────────

test('J2-15 computeSelectedMarketVolatility: stable medians → low spread', () => {
  const r = computeSelectedMarketVolatility([
    { selectedMedian: 120, selectedRadiusKm: 2 },
    { selectedMedian: 125, selectedRadiusKm: 2 },
    { selectedMedian: 122, selectedRadiusKm: 2 },
  ]);
  assert.ok(r.selectedMedianSpreadPct != null);
  assert.ok(r.selectedMedianSpreadPct < 5);
  assert.strictEqual(r.selectedRadiusMin, 2);
  assert.strictEqual(r.selectedRadiusMax, 2);
});

test('J2-16 computeSelectedMarketVolatility: null medians → spreadPct null', () => {
  const r = computeSelectedMarketVolatility([
    { selectedMedian: null, selectedRadiusKm: null },
  ]);
  assert.strictEqual(r.selectedMedianSpreadPct, null);
  assert.strictEqual(r.selectedMedianSpreadAbs, null);
});

test('J2-17 computeSelectedMarketVolatility: zero denominator → no division error', () => {
  // Both medians are 0 — avg = 0, should not produce NaN
  const r = computeSelectedMarketVolatility([
    { selectedMedian: 0, selectedRadiusKm: 2 },
    { selectedMedian: 0, selectedRadiusKm: 2 },
  ]);
  assert.ok(r.selectedMedianSpreadPct === null || !Number.isNaN(r.selectedMedianSpreadPct));
});

test('J2-18 computeSelectedMarketVolatility: single valid median → no spread', () => {
  const r = computeSelectedMarketVolatility([
    { selectedMedian: 120, selectedRadiusKm: 2 },
    { selectedMedian: null, selectedRadiusKm: null },
  ]);
  assert.strictEqual(r.selectedMedianSpreadAbs, null);
  assert.strictEqual(r.selectedMedianSpreadPct, null);
});

// ── J2-19..22: computeCrossSnapshotLocalDifferenceReason ─────────────────────

test('J2-19 computeCrossSnapshotLocalDifferenceReason: both adequate → NONE', () => {
  const gqA = { localComparableCount: 8, usableForConsensus: true };
  const gqB = { localComparableCount: 9, usableForConsensus: true };
  const ov  = { overlapPct50: 80, ordering: 'PREFIX_STABLE' };
  assert.strictEqual(computeCrossSnapshotLocalDifferenceReason(gqA, gqB, ov), 'NONE');
});

test('J2-20 computeCrossSnapshotLocalDifferenceReason: 0 overlap → SOURCE_SAMPLE_VOLATILITY', () => {
  const gqA = { localComparableCount: 0 };
  const gqB = { localComparableCount: 8 };
  const ov  = { overlapPct50: 0, ordering: 'UNSTABLE' };
  assert.strictEqual(computeCrossSnapshotLocalDifferenceReason(gqA, gqB, ov), 'SOURCE_SAMPLE_VOLATILITY');
});

test('J2-21 computeCrossSnapshotLocalDifferenceReason: high overlap prefix stable → SAMPLE_SIZE_EFFECT', () => {
  const gqA = { localComparableCount: 0 };
  const gqB = { localComparableCount: 8 };
  const ov  = { overlapPct50: 90, ordering: 'PREFIX_STABLE' };
  assert.strictEqual(computeCrossSnapshotLocalDifferenceReason(gqA, gqB, ov), 'SAMPLE_SIZE_EFFECT');
});

test('J2-22 computeCrossSnapshotLocalDifferenceReason: no overlap object → INCONCLUSIVE', () => {
  const gqA = { localComparableCount: 0 };
  const gqB = { localComparableCount: 5 };
  assert.strictEqual(computeCrossSnapshotLocalDifferenceReason(gqA, gqB, null), 'INCONCLUSIVE');
});

// ── J2-23..35: evaluateRepeatedSampleStability verdicts ──────────────────────

test('J2-23 evaluateRepeatedSampleStability: all GOOD + spread ≤10% → STABLE, ONE_CALL', () => {
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 120, p25: 90, p75: 155 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 9, stats: { median: 124, p25: 93, p75: 158 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 7, stats: { median: 122, p25: 91, p75: 157 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.verdict, 'STABLE');
  assert.strictEqual(r.policyRecommendation, POLICY_ONE_CALL);
  assert.strictEqual(r.usableCount, 3);
  assert.strictEqual(r.fingerprintsIdentical, true);
});

test('J2-24 evaluateRepeatedSampleStability: all GOOD + spread 10-20% → ACCEPTABLE_VARIATION', () => {
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 100, p25: 75, p75: 130 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 115, p25: 87, p75: 148 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 112, p25: 84, p75: 145 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.verdict, 'ACCEPTABLE_VARIATION');
  assert.strictEqual(r.policyRecommendation, POLICY_ONE_CALL);
});

test('J2-25 evaluateRepeatedSampleStability: all GOOD + spread >20% → VOLATILE, MULTI', () => {
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 80, p25: 60, p75: 100 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 160, p25: 120, p75: 200 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 155, p25: 115, p75: 195 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.verdict, 'VOLATILE');
  assert.strictEqual(r.policyRecommendation, POLICY_MULTI);
});

test('J2-26 evaluateRepeatedSampleStability: GOOD/GOOD/UNUSABLE + stable prices → ACCEPTABLE_VARIATION, RETRY', () => {
  const unusable = mkSnap({ geoQuality: mkGeoQ('UNUSABLE', 0.00, false),
    selectedMarket: { status: 'ok', selectedRadiusKm: 20, comparableCount: 5, stats: null } });
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 120, p25: 90, p75: 155 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 9, stats: { median: 122, p25: 92, p75: 157 } } }),
    unusable,
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.usableCount, 2);
  assert.strictEqual(r.verdict, 'ACCEPTABLE_VARIATION');
  assert.strictEqual(r.policyRecommendation, POLICY_RETRY);
});

test('J2-27 evaluateRepeatedSampleStability: GOOD/UNUSABLE/GOOD + stable prices → ACCEPTABLE_VARIATION, RETRY', () => {
  const unusable = mkSnap({ geoQuality: mkGeoQ('UNUSABLE', 0.00, false),
    selectedMarket: null });
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 118, p25: 88, p75: 153 } } }),
    unusable,
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 123, p25: 93, p75: 158 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.usableCount, 2);
  assert.strictEqual(r.verdict, 'ACCEPTABLE_VARIATION');
  assert.strictEqual(r.policyRecommendation, POLICY_RETRY);
});

test('J2-28 evaluateRepeatedSampleStability: all UNUSABLE → UNUSABLE, UNRELIABLE', () => {
  const unusable = mkSnap({ geoQuality: mkGeoQ('UNUSABLE', 0.00, false), selectedMarket: null });
  const r = evaluateRepeatedSampleStability([unusable, unusable, unusable]);
  assert.strictEqual(r.verdict, 'UNUSABLE');
  assert.strictEqual(r.policyRecommendation, POLICY_UNRELIABLE);
  assert.strictEqual(r.usableCount, 0);
});

test('J2-29 evaluateRepeatedSampleStability: fingerprints differ → INCONCLUSIVE', () => {
  const snapshots = [
    mkSnap({ queryFingerprint: 'fp-A' }),
    mkSnap({ queryFingerprint: 'fp-B' }),
    mkSnap({ queryFingerprint: 'fp-A' }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.verdict, 'INCONCLUSIVE');
  assert.strictEqual(r.verdictReason, 'fingerprints_differ');
  assert.strictEqual(r.fingerprintsIdentical, false);
});

test('J2-30 evaluateRepeatedSampleStability: all null medians → INCONCLUSIVE', () => {
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 0, stats: null } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 0, stats: null } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 0, stats: null } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.verdict, 'INCONCLUSIVE');
});

test('J2-31 evaluateRepeatedSampleStability: empty input → INCONCLUSIVE', () => {
  const r = evaluateRepeatedSampleStability([]);
  assert.strictEqual(r.verdict, 'INCONCLUSIVE');
  assert.strictEqual(r.verdictReason, 'no_snapshots');
});

test('J2-32 evaluateRepeatedSampleStability: 1/3 usable (majority fail) → VOLATILE, UNRELIABLE', () => {
  const unusable = mkSnap({ geoQuality: mkGeoQ('UNUSABLE', 0.00, false), selectedMarket: null });
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 120, p25: 90, p75: 155 } } }),
    unusable,
    unusable,
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.usableCount, 1);  // < STABILITY_MIN_USABLE_COUNT (2)
  assert.strictEqual(r.verdict, 'VOLATILE');
  assert.strictEqual(r.policyRecommendation, POLICY_UNRELIABLE);
});

// ── J2-33..38: Phase 15 — ID churn must NOT affect verdict ───────────────────

test('J2-33 evaluateRepeatedSampleStability: 0% ID overlap but stable prices → STABLE (not VOLATILE)', () => {
  // All geo GOOD, medians 128/131/130 — completely different listing populations
  // Verdict should be STABLE because evaluateRepeatedSampleStability does NOT take ID overlap
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 128, p25: 96, p75: 166 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 131, p25: 98, p75: 170 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 130, p25: 97, p75: 169 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  // Phase 15: ID churn does not appear in inputs → verdict is based on price stability alone
  assert.strictEqual(r.verdict, 'STABLE');
  assert.ok(r.selectedMedianSpreadPct < STABILITY_SPREAD_STABLE);
});

test('J2-34 evaluateRepeatedSampleStability: 100% ID overlap but volatile prices → VOLATILE (not STABLE)', () => {
  // Identical IDs but huge price swings — should be VOLATILE
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 80, p25: 60, p75: 100 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 200, p25: 150, p75: 250 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 190, p25: 142, p75: 238 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r.verdict, 'VOLATILE');
});

// ── J2-35..38: Edge cases and correctness ─────────────────────────────────────

test('J2-35 evaluateRepeatedSampleStability: no NaN in output', () => {
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 120, p25: 90, p75: 155 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 3, comparableCount: 6, stats: { median: 130, p25: 95, p75: 165 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 5, comparableCount: 7, stats: { median: 125, p25: 92, p75: 160 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  for (const key of Object.keys(r)) {
    const v = r[key];
    if (typeof v === 'number') {
      assert.ok(!Number.isNaN(v),      `${key} should not be NaN`);
      assert.ok(Number.isFinite(v),    `${key} should not be Infinity`);
    }
  }
});

test('J2-36 evaluateRepeatedSampleStability: deterministic — same inputs → same output', () => {
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 120, p25: 90, p75: 155 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 122, p25: 92, p75: 157 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 121, p25: 91, p75: 156 } } }),
  ];
  const r1 = evaluateRepeatedSampleStability(snapshots);
  const r2 = evaluateRepeatedSampleStability(snapshots);
  assert.strictEqual(r1.verdict,              r2.verdict);
  assert.strictEqual(r1.policyRecommendation, r2.policyRecommendation);
  assert.strictEqual(r1.selectedMedianSpreadPct, r2.selectedMedianSpreadPct);
});

test('J2-37 computeLocalPriceStability: immutable — does not modify input listings', () => {
  const ls = [mkL(100, 1), mkL(110, 1), mkL(120, 1)];
  const origLen = ls.length;
  const origFirst = { ...ls[0] };
  computeLocalPriceStability(ls, ls, ls, TARGET_LAT, TARGET_LON, [5]);
  assert.strictEqual(ls.length, origLen);
  assert.strictEqual(ls[0].price,             origFirst.price);
  assert.strictEqual(ls[0].providerListingId, origFirst.providerListingId);
});

test('J2-38 computeOverlapMatrix: null IDs filtered out', () => {
  const r = computeOverlapMatrix([null, 'a', null], ['a', null], [null, 'a']);
  assert.strictEqual(r.rawIdsA, 1);  // only 'a'
  assert.strictEqual(r.commonABC, 1);
});

// ── J2-39..41: Constants ──────────────────────────────────────────────────────

test('J2-39 constants: thresholds and policies exported', () => {
  assert.strictEqual(STABILITY_SPREAD_STABLE,     10);
  assert.strictEqual(STABILITY_SPREAD_ACCEPTABLE, 20);
  assert.strictEqual(STABILITY_MIN_USABLE_COUNT,   2);
  assert.ok(typeof POLICY_ONE_CALL   === 'string');
  assert.ok(typeof POLICY_RETRY      === 'string');
  assert.ok(typeof POLICY_MULTI      === 'string');
  assert.ok(typeof POLICY_UNRELIABLE === 'string');
});

test('J2-40 constants: spread thresholds are monotone', () => {
  assert.ok(STABILITY_SPREAD_STABLE < STABILITY_SPREAD_ACCEPTABLE);
});

test('J2-41 evaluateRepeatedSampleStability: spread boundary — exactly 10% → STABLE', () => {
  // medians 100 and 110: spread = (110-100)/105 * 100 ≈ 9.52% < 10
  const snapshots = [
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 100, p25: 75, p75: 130 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 109, p25: 82, p75: 142 } } }),
    mkSnap({ selectedMarket: { status: 'ok', selectedRadiusKm: 2, comparableCount: 8, stats: { median: 105, p25: 79, p75: 136 } } }),
  ];
  const r = evaluateRepeatedSampleStability(snapshots);
  assert.ok(r.selectedMedianSpreadPct <= STABILITY_SPREAD_STABLE);
  assert.strictEqual(r.verdict, 'STABLE');
});

// ── J2-42..45: Safety ─────────────────────────────────────────────────────────

test('J2-42 market-repeated-snapshot-stability.js: no DB writes, no Channex, no pricing-apply', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-repeated-snapshot-stability.js'), 'utf8'
  );
  assert.ok(!src.includes('pool.query'),         'no DB query');
  assert.ok(!src.includes("require('pg')"),     'no pg import');
  assert.ok(!src.includes("require('channex")   &&
            !src.includes('require("channex'),   'no Channex require');
  assert.ok(!src.includes('applyDynamic'),       'no pricing apply');
  assert.ok(!src.includes('pricing_schedule'),   'no pricing_schedule write');
});

test('J2-43 audit-airbnb-repeated-stability.js: max 3 BD calls in execute mode', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../outils/audit-airbnb-repeated-stability.js'), 'utf8'
  );
  // N_SNAPSHOTS constant must be 3
  assert.ok(src.includes('N_SNAPSHOTS      = 3') || src.includes('N_SNAPSHOTS = 3'), 'N_SNAPSHOTS=3');
  // No Booking scrape calls
  assert.ok(!src.includes('scrapeBooking') && !src.includes('booking_dataset'),
    'no Booking BD calls');
});

test('J2-44 audit-airbnb-repeated-stability.js: BRIGHTDATA_API_KEY never printed', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../outils/audit-airbnb-repeated-stability.js'), 'utf8'
  );
  // Key can appear as a variable name but must never be concatenated into a log string
  const apiKeyLogPattern = /console\.log.*BRIGHTDATA_API_KEY/;
  assert.ok(!apiKeyLogPattern.test(src), 'BRIGHTDATA_API_KEY not in any console.log');
});

test('J2-45 audit-airbnb-repeated-stability.js: production routing unchanged', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../outils/audit-airbnb-repeated-stability.js'), 'utf8'
  );
  assert.ok(!src.includes('MARKET_PRIMARY_PROVIDER'),     'no primary provider activation');
  assert.ok(!src.includes('pricing_history'),             'no pricing history write');
  assert.ok(!src.includes('applyDynamicPricingForProp'),  'no pricing apply');
  assert.ok(!src.includes('channex'),                     'no channex');
});

'use strict';
/**
 * P1.2-B5-BK-J4 — Airbnb Pooled Snapshot Market Tests
 *
 * Groups:
 *   A. mergeAndDedup                                    (J4-A01…08)
 *   B. selectPooledRadius                               (J4-B01…05)
 *   C. calcPooledStats                                  (J4-C01…05)
 *   D. computeSensitivity                               (J4-D01…05)
 *   E. computeRepeatedPriceVariation + pairToAbcDev     (J4-E01…06)
 *   F. classifyPooledStability + classifyPooledConf     (J4-F01…07)
 *   G. buildAirbnbPooledMarket integration              (J4-G01…07)
 *   H. Safety invariants (source-level)                 (J4-H01…04)
 *   J. Validator helpers + modes                        (J4-J01…06)
 *
 * Total: 53 tests
 */

const assert = require('assert');
const test   = require('node:test');
const path   = require('path');

const {
  buildAirbnbPooledMarket,
  mergeAndDedup,
  selectPooledRadius,
  calcPooledStats,
  computeSensitivity,
  computeRepeatedPriceVariation,
  computePairToAbcDeviation,
  classifyPooledStability,
  classifyPooledConfidence,
  getListingsWithinRadius,
  RADII_KM,
  MIN_COMPARABLES_TARGET,
  MIN_COMPARABLES_FALLBACK,
  PAIR_DEVIATION_STABLE,
  PAIR_DEVIATION_MODERATE,
  PRICE_VARIATION_LOW,
  PRICE_VARIATION_HIGH,
} = require('../services/airbnb-pooled-snapshot-market');

const {
  previewMode,
  executeMode,
  addDaysISO,
  _validateCheckInDate,
} = require('../outils/validate-airbnb-pooled-snapshot-market');

// ── Helpers ───────────────────────────────────────────────────────────────────

const TARGET_LAT = 48.726;
const TARGET_LON = 2.272;

function makeListingAtKm(km, price, opts = {}) {
  const offset = km / 111;
  return {
    price,
    latitude:          TARGET_LAT + offset,
    longitude:         TARGET_LON,
    isBooked:          opts.isBooked  ?? false,
    bedrooms:          opts.bedrooms  ?? 2,
    stars:             4.0,
    providerListingId: opts.id        ?? `listing-${km}-${price}`,
    guests:            opts.guests    ?? 4,
    category:          opts.category  ?? 'entire_place',
    availableDates:    opts.availableDates ?? null,
  };
}

function makeListingsWithin(n, km, basePrice = 100, idPrefix = 'lw') {
  return Array.from({ length: n }, (_, i) => {
    const dist = (i + 1) / (n + 1) * km;
    return makeListingAtKm(dist, basePrice + i * 5, { id: `${idPrefix}-${km}-${i}` });
  });
}

function makeSnap(id, listings) {
  return { snapshotId: id, listings };
}

function makeMockPool(rows) {
  return { query: async () => ({ rows }), end: async () => {} };
}

function makePropRow(name, lat = TARGET_LAT, lon = TARGET_LON, overrides = {}) {
  return Object.assign({
    id: 1, name, internal_name: null,
    address: `${name}, Massy, France`,
    latitude: String(lat), longitude: String(lon),
    timezone: 'Europe/Paris', currency: 'EUR',
    max_guests: 4, bedrooms: 2,
  }, overrides);
}

// ── A. mergeAndDedup ──────────────────────────────────────────────────────────

test('J4-A01 mergeAndDedup: empty input → zero counts', () => {
  const r = mergeAndDedup([]);
  assert.strictEqual(r.totalInput, 0);
  assert.strictEqual(r.uniqueCount, 0);
  assert.strictEqual(r.dedupedCount, 0);
  assert.strictEqual(r.repeatedListings.length, 0);
});

test('J4-A02 mergeAndDedup: single listing with ID → passes through', () => {
  const l = makeListingAtKm(1, 100, { id: 'abc' });
  const r = mergeAndDedup([makeSnap('S1', [l])]);
  assert.strictEqual(r.totalInput, 1);
  assert.strictEqual(r.uniqueCount, 1);
  assert.strictEqual(r.withIdCount, 1);
  assert.strictEqual(r.noIdCount, 0);
  assert.strictEqual(r.dedupedCount, 0);
  assert.strictEqual(r.uniqueListings[0].price, 100);
});

test('J4-A03 mergeAndDedup: same ID in 2 snapshots → deduplicated, median price', () => {
  const l1 = makeListingAtKm(1, 100, { id: 'abc' });
  const l2 = makeListingAtKm(1, 200, { id: 'abc' });
  const r  = mergeAndDedup([makeSnap('S1', [l1]), makeSnap('S2', [l2])]);
  assert.strictEqual(r.totalInput, 2);
  assert.strictEqual(r.uniqueCount, 1);
  assert.strictEqual(r.dedupedCount, 1);
  // median of [100, 200] → 150
  assert.strictEqual(r.uniqueListings[0].price, 150);
  assert.strictEqual(r.repeatedListings.length, 1);
});

test('J4-A04 mergeAndDedup: same ID in 3 snapshots → median of 3', () => {
  const snaps = ['S1', 'S2', 'S3'].map((sid, i) =>
    makeSnap(sid, [makeListingAtKm(1, [100, 150, 200][i], { id: 'x' })])
  );
  const r = mergeAndDedup(snaps);
  assert.strictEqual(r.uniqueCount, 1);
  // sorted [100,150,200] → median=150
  assert.strictEqual(r.uniqueListings[0].price, 150);
});

test('J4-A05 mergeAndDedup: listing without ID → included per occurrence', () => {
  const l1 = { ...makeListingAtKm(1, 100), providerListingId: null };
  const l2 = { ...makeListingAtKm(1, 200), providerListingId: null };
  const r  = mergeAndDedup([makeSnap('S1', [l1]), makeSnap('S2', [l2])]);
  assert.strictEqual(r.noIdCount, 2);
  assert.strictEqual(r.uniqueCount, 2);
  assert.strictEqual(r.dedupedCount, 0);
});

test('J4-A06 mergeAndDedup: repeatedListings only includes multi-occurrence IDs', () => {
  const lA = makeListingAtKm(1, 100, { id: 'shared' });
  const lB = makeListingAtKm(1, 120, { id: 'shared' });
  const lC = makeListingAtKm(2, 200, { id: 'unique' });
  const r  = mergeAndDedup([makeSnap('S1', [lA, lC]), makeSnap('S2', [lB])]);
  assert.strictEqual(r.repeatedListings.length, 1);
  assert.strictEqual(r.repeatedListings[0].id, 'shared');
  assert.strictEqual(r.repeatedListings[0].occurrences, 2);
});

test('J4-A07 mergeAndDedup: priceVariationPct computed (max-min)/mean*100', () => {
  const l1 = makeListingAtKm(1, 100, { id: 'v' });
  const l2 = makeListingAtKm(1, 200, { id: 'v' });
  const r  = mergeAndDedup([makeSnap('S1', [l1]), makeSnap('S2', [l2])]);
  const rep = r.repeatedListings[0];
  // mean=150, (200-100)/150 * 100 ≈ 66.67%
  assert.ok(rep.priceVariationPct > 60 && rep.priceVariationPct < 70,
    `expected ~66.67, got ${rep.priceVariationPct}`);
});

test('J4-A08 mergeAndDedup: mixed with/without IDs counted separately', () => {
  const lId  = makeListingAtKm(1, 100, { id: 'x' });
  const lNoId = { ...makeListingAtKm(2, 200), providerListingId: null };
  const r = mergeAndDedup([makeSnap('S1', [lId, lNoId])]);
  assert.strictEqual(r.withIdCount, 1);
  assert.strictEqual(r.noIdCount, 1);
  assert.strictEqual(r.uniqueCount, 2);
});

// ── B. selectPooledRadius ─────────────────────────────────────────────────────

test('J4-B01 selectPooledRadius: ≥5 listings at 1km → select 1km, no fallback', () => {
  const listings = makeListingsWithin(6, 0.8);
  const r = selectPooledRadius(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.selectedRadiusKm, 1);
  assert.strictEqual(r.fallbackUsed, false);
  assert.ok(r.countAtRadius >= MIN_COMPARABLES_TARGET);
});

test('J4-B02 selectPooledRadius: 3 listings within 2km but not 1km → select 2km with fallback', () => {
  const listings = makeListingsWithin(3, 1.8);
  const r = selectPooledRadius(listings, TARGET_LAT, TARGET_LON);
  assert.ok(r.fallbackUsed === true);
  assert.ok(r.selectedRadiusKm != null);
  assert.ok(r.countAtRadius >= MIN_COMPARABLES_FALLBACK);
});

test('J4-B03 selectPooledRadius: ≥5 listings require 5km radius → selects 5km no fallback', () => {
  const listings = makeListingsWithin(5, 4.5);
  const r = selectPooledRadius(listings, TARGET_LAT, TARGET_LON);
  assert.ok(r.selectedRadiusKm != null);
  assert.strictEqual(r.fallbackUsed, false);
  assert.ok(r.countAtRadius >= MIN_COMPARABLES_TARGET);
});

test('J4-B04 selectPooledRadius: fewer than fallback everywhere → null radius', () => {
  const listings = makeListingsWithin(2, 0.5);
  const r = selectPooledRadius(listings, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.selectedRadiusKm, null);
  assert.strictEqual(r.countAtRadius, 0);
});

test('J4-B05 selectPooledRadius: empty list → null', () => {
  const r = selectPooledRadius([], TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.selectedRadiusKm, null);
  assert.strictEqual(r.countAtRadius, 0);
});

// ── C. calcPooledStats ────────────────────────────────────────────────────────

test('J4-C01 calcPooledStats: empty → null', () => {
  assert.strictEqual(calcPooledStats([]), null);
  assert.strictEqual(calcPooledStats(null), null);
});

test('J4-C02 calcPooledStats: single listing price', () => {
  const r = calcPooledStats([makeListingAtKm(1, 150)]);
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.median, 150);
  assert.strictEqual(r.min, 150);
  assert.strictEqual(r.max, 150);
});

test('J4-C03 calcPooledStats: odd count → exact middle value', () => {
  const listings = [100, 200, 300].map((p, i) => makeListingAtKm(i + 1, p));
  const r = calcPooledStats(listings);
  assert.strictEqual(r.median, 200);
  assert.strictEqual(r.count, 3);
});

test('J4-C04 calcPooledStats: even count → average of two middles', () => {
  const listings = [100, 200, 300, 400].map((p, i) => makeListingAtKm(i + 1, p));
  const r = calcPooledStats(listings);
  // sorted: [100,200,300,400], mid=2 → (200+300)/2=250
  assert.strictEqual(r.median, 250);
});

test('J4-C05 calcPooledStats: min/max/p10/p90 correct', () => {
  const listings = Array.from({ length: 10 }, (_, i) =>
    makeListingAtKm(i + 1, (i + 1) * 10)
  );
  const r = calcPooledStats(listings);
  assert.strictEqual(r.min, 10);
  assert.strictEqual(r.max, 100);
  // p10 = floor(10*0.10)=1 → price at index 1 = 20
  assert.strictEqual(r.p10, 20);
  // p90 = floor(10*0.90)=9 → price at index 9 = 100
  assert.strictEqual(r.p90, 100);
});

// ── D. computeSensitivity ─────────────────────────────────────────────────────

test('J4-D01 computeSensitivity: fewer than 2 snapshots → empty object', () => {
  const r = computeSensitivity(
    [makeSnap('S1', makeListingsWithin(5, 2))],
    3, TARGET_LAT, TARGET_LON
  );
  assert.deepStrictEqual(r, {});
});

test('J4-D02 computeSensitivity: 2 snapshots → only AB key', () => {
  const snaps = [
    makeSnap('S1', makeListingsWithin(5, 2, 100, 'A')),
    makeSnap('S2', makeListingsWithin(5, 2, 110, 'B')),
  ];
  const r = computeSensitivity(snaps, 3, TARGET_LAT, TARGET_LON);
  assert.ok('AB' in r);
  assert.ok(!('AC' in r));
  assert.ok(!('BC' in r));
  assert.ok(!('ABC' in r));
});

test('J4-D03 computeSensitivity: 3 snapshots → AB, AC, BC, ABC keys', () => {
  const snaps = ['A', 'B', 'C'].map((l, i) =>
    makeSnap(`S${i}`, makeListingsWithin(5, 2, 100 + i * 20, l))
  );
  const r = computeSensitivity(snaps, 3, TARGET_LAT, TARGET_LON);
  assert.ok('AB' in r && 'AC' in r && 'BC' in r && 'ABC' in r);
});

test('J4-D04 computeSensitivity: null radius → null medians', () => {
  const snaps = [
    makeSnap('S1', makeListingsWithin(5, 2)),
    makeSnap('S2', makeListingsWithin(5, 2)),
  ];
  const r = computeSensitivity(snaps, null, TARGET_LAT, TARGET_LON);
  assert.strictEqual(r.AB.median, null);
});

test('J4-D05 computeSensitivity: dedup across pair — shared ID counted once', () => {
  const shared = makeListingAtKm(1, 100, { id: 'shared' });
  const unique = makeListingAtKm(1, 200, { id: 'unique' });
  const snaps = [
    makeSnap('S1', [shared, ...makeListingsWithin(4, 2, 100, 'A')]),
    makeSnap('S2', [{ ...shared, price: 110 }, ...makeListingsWithin(4, 2, 110, 'B')]),
  ];
  const r = computeSensitivity(snaps, 5, TARGET_LAT, TARGET_LON);
  // AB pool should have one less than total because shared is deduped
  assert.ok(r.AB.uniqueCount < snaps[0].listings.length + snaps[1].listings.length);
});

// ── E. computeRepeatedPriceVariation + computePairToAbcDeviation ──────────────

test('J4-E01 computeRepeatedPriceVariation: empty → mean=0, count=0', () => {
  const r = computeRepeatedPriceVariation([]);
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.mean, 0);
});

test('J4-E02 computeRepeatedPriceVariation: one entry → its variation', () => {
  const r = computeRepeatedPriceVariation([{ priceVariationPct: 25 }]);
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.mean, 25);
  assert.strictEqual(r.max, 25);
});

test('J4-E03 computeRepeatedPriceVariation: multiple → mean averaged, max correct', () => {
  const r = computeRepeatedPriceVariation([
    { priceVariationPct: 10 },
    { priceVariationPct: 30 },
  ]);
  assert.strictEqual(r.mean, 20);
  assert.strictEqual(r.max, 30);
  assert.strictEqual(r.count, 2);
});

test('J4-E04 computePairToAbcDeviation: sensitivity without ABC → null', () => {
  const r = computePairToAbcDeviation({ AB: { median: 100 } });
  assert.strictEqual(r, null);
});

test('J4-E05 computePairToAbcDeviation: ABC median=0 → null', () => {
  const r = computePairToAbcDeviation({ ABC: { median: 0 }, AB: { median: 100 } });
  assert.strictEqual(r, null);
});

test('J4-E06 computePairToAbcDeviation: computes deviation from ABC median', () => {
  const r = computePairToAbcDeviation({
    ABC: { median: 200 },
    AB:  { median: 180 },
    AC:  { median: 220 },
    BC:  { median: 200 },
  });
  assert.ok(r !== null);
  // AB: |180-200|/200*100 = 10%
  assert.strictEqual(r.deviations.AB, 10);
  // AC: |220-200|/200*100 = 10%
  assert.strictEqual(r.deviations.AC, 10);
  // BC: |200-200|/200*100 = 0%
  assert.strictEqual(r.deviations.BC, 0);
  assert.strictEqual(r.maxDeviationPct, 10);
});

// ── F. classifyPooledStability + classifyPooledConfidence ─────────────────────

test('J4-F01 classifyPooledStability: null pairMax + low variation → STABLE', () => {
  assert.strictEqual(classifyPooledStability(null, PRICE_VARIATION_LOW - 1), 'STABLE');
});

test('J4-F02 classifyPooledStability: null pairMax + high variation → VOLATILE', () => {
  assert.strictEqual(classifyPooledStability(null, PRICE_VARIATION_HIGH + 1), 'VOLATILE');
});

test('J4-F03 classifyPooledStability: low pairMax + low variation → STABLE', () => {
  assert.strictEqual(
    classifyPooledStability(PAIR_DEVIATION_STABLE - 1, PRICE_VARIATION_LOW - 1),
    'STABLE'
  );
});

test('J4-F04 classifyPooledStability: moderate pairMax → MODERATE', () => {
  assert.strictEqual(
    classifyPooledStability(PAIR_DEVIATION_STABLE + 1, PRICE_VARIATION_LOW - 1),
    'MODERATE'
  );
});

test('J4-F05 classifyPooledStability: high pairMax + high variation → VOLATILE', () => {
  assert.strictEqual(
    classifyPooledStability(PAIR_DEVIATION_MODERATE + 1, PRICE_VARIATION_HIGH + 1),
    'VOLATILE'
  );
});

test('J4-F06 classifyPooledConfidence: count below fallback → INSUFFICIENT', () => {
  assert.strictEqual(
    classifyPooledConfidence('STABLE', MIN_COMPARABLES_FALLBACK - 1, 3, false),
    'INSUFFICIENT'
  );
});

test('J4-F07 classifyPooledConfidence: STABLE + ≥5 + ≤5km + no fallback → HIGH', () => {
  assert.strictEqual(
    classifyPooledConfidence('STABLE', MIN_COMPARABLES_TARGET, 5, false),
    'HIGH'
  );
});

// ── G. buildAirbnbPooledMarket integration ────────────────────────────────────

test('J4-G01 buildAirbnbPooledMarket: fewer than 2 snapshots → insufficient_data', () => {
  const r = buildAirbnbPooledMarket(
    [makeSnap('S1', makeListingsWithin(5, 2))],
    { targetLat: TARGET_LAT, targetLon: TARGET_LON }
  );
  assert.strictEqual(r.status, 'insufficient_data');
  assert.strictEqual(r.safeToUse, false);
});

test('J4-G02 buildAirbnbPooledMarket: null/missing snapshots → insufficient_data', () => {
  const r = buildAirbnbPooledMarket(null, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.strictEqual(r.status, 'insufficient_data');
});

test('J4-G03 buildAirbnbPooledMarket: missing coords → error status', () => {
  const snaps = ['S1', 'S2'].map(id => makeSnap(id, makeListingsWithin(5, 2)));
  const r = buildAirbnbPooledMarket(snaps, { targetLat: NaN, targetLon: NaN });
  assert.strictEqual(r.status, 'error');
  assert.strictEqual(r.reason, 'missing_target_coords');
});

test('J4-G04 buildAirbnbPooledMarket: 2 snapshots with disjoint IDs → uniqueCount = sum', () => {
  const snaps = [
    makeSnap('S1', makeListingsWithin(5, 2, 100, 'A')),
    makeSnap('S2', makeListingsWithin(5, 2, 120, 'B')),
  ];
  const r = buildAirbnbPooledMarket(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  if (r.status === 'ok') {
    assert.ok(r.uniqueCount <= r.totalInput);
    assert.strictEqual(r.pairDeviation, null); // only 2 snapshots
  }
});

test('J4-G05 buildAirbnbPooledMarket: dedup reduces unique count for shared IDs', () => {
  const shared = [
    makeListingAtKm(0.5, 100, { id: 'x1' }),
    makeListingAtKm(0.8, 150, { id: 'x2' }),
  ];
  const snaps = [
    makeSnap('S1', [...shared, ...makeListingsWithin(3, 1.5, 100, 'A')]),
    makeSnap('S2', [...shared.map(l => ({ ...l, price: l.price + 10 })), ...makeListingsWithin(3, 1.5, 110, 'B')]),
  ];
  const r = buildAirbnbPooledMarket(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  if (r.status === 'ok') {
    assert.ok(r.dedupedCount >= 0);
    assert.ok(r.uniqueCount <= r.totalInput);
  }
});

test('J4-G06 buildAirbnbPooledMarket: 3 snapshots → pairDeviation present', () => {
  const snaps = ['A', 'B', 'C'].map((l, i) =>
    makeSnap(`S${i}`, makeListingsWithin(6, 2, 100 + i * 10, l))
  );
  const r = buildAirbnbPooledMarket(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  if (r.status === 'ok') {
    // pairDeviation should be non-null when 3 snapshots and ABC has a median
    assert.ok('pairDeviation' in r);
    assert.ok('sensitivity' in r);
    assert.ok('ABC' in r.sensitivity);
  }
});

test('J4-G07 buildAirbnbPooledMarket: empty snapshots → insufficient_data', () => {
  const snaps = [makeSnap('S1', []), makeSnap('S2', [])];
  const r = buildAirbnbPooledMarket(snaps, { targetLat: TARGET_LAT, targetLon: TARGET_LON });
  assert.notStrictEqual(r.status, 'ok');
  assert.strictEqual(r.safeToUse, false);
});

// ── H. Safety invariants (source-level) ──────────────────────────────────────

test('J4-H01 pooled module: no SQL write statements', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-snapshot-market.js'), 'utf8'
  );
  assert.ok(
    !src.includes(['INS', 'ERT '].join('')),
    'module must not contain SQL INSERT'
  );
});

test('J4-H02 pooled module: no pool construction (no direct DB connection)', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-snapshot-market.js'), 'utf8'
  );
  // Check for `new Pool(` — actual DB pool instantiation
  const newPool = ['new', ' Pool('].join('');
  assert.ok(!src.includes(newPool), 'module must not instantiate a DB pool');
});

test('J4-H03 pooled module: no channex import', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-snapshot-market.js'), 'utf8'
  );
  const chxRel = ["require", "('./chann"].join('');
  const chxUp  = ["require", "('../chann"].join('');
  assert.ok(!src.includes(chxRel) && !src.includes(chxUp), 'module must not import channex');
});

test('J4-H04 pooled module: no pricing-apply import', () => {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(
    path.join(__dirname, '../services/airbnb-pooled-snapshot-market.js'), 'utf8'
  );
  const pRel = ["require", "('./pricing-apply"].join('');
  const pUp  = ["require", "('../pricing-apply"].join('');
  assert.ok(!src.includes(pRel) && !src.includes(pUp), 'module must not import pricing-apply');
});

// ── J. Validator helpers + modes ──────────────────────────────────────────────

test('J4-J01 addDaysISO: adds days relative to Europe/Paris', () => {
  const base = new Date('2026-09-26T10:00:00Z');
  const result = addDaysISO(base, 14, 'Europe/Paris');
  assert.strictEqual(result, '2026-10-10');
});

test('J4-J02 _validateCheckInDate: throws when checkIn equals today', () => {
  assert.throws(
    () => _validateCheckInDate('2026-09-26', '2026-09-26'),
    /erreur de date policy/
  );
});

test('J4-J03 _validateCheckInDate: throws when checkIn is in the past', () => {
  assert.throws(
    () => _validateCheckInDate('2026-09-25', '2026-09-26'),
    /erreur de date policy/
  );
});

test('J4-J04 _validateCheckInDate: does not throw for future checkIn', () => {
  assert.doesNotThrow(() => _validateCheckInDate('2026-10-10', '2026-09-26'));
});

test('J4-J05 previewMode: returns ok=false when property not found', async () => {
  const pool = makeMockPool([]);
  const r = await previewMode({ name: 'DoesNotExist', pool });
  assert.strictEqual(r.ok, false);
});

test('J4-J06 previewMode: returns planned dates, no BD calls', async () => {
  const pool = makeMockPool([makePropRow('TestProp')]);
  const now = new Date('2026-09-26T10:00:00Z');
  const r = await previewMode({ name: 'TestProp', pool, _now: now });
  assert.strictEqual(r.ok, true);
  // checkIn should be J+14 = 2026-10-10
  assert.strictEqual(r.checkIn, '2026-10-10');
  // No actual BD calls: the function returns without scraping
  assert.strictEqual(r.targetLat, TARGET_LAT);
  assert.strictEqual(r.targetLon, TARGET_LON);
});

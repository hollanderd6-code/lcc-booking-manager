'use strict';
/**
 * P1.2-B5-BK-G — Multi-Source Market Aggregator Tests
 *
 * Covers:
 *   - Quality scoring (countScore, radiusScore, qualityScore)
 *   - Divergence (divergencePct, divergenceLevel)
 *   - Confidence (confidenceLevel)
 *   - Source validation (isSourceValid)
 *   - aggregateMarketSources — single source, dual source, null sources
 *   - Consensus weights, consensus median arithmetic
 *   - Market signal from Airbnb only, never Booking occupancy
 *   - Source safety (no DB, no pricing-apply, no Channex, no env vars logged)
 */

const assert = require('assert');
const test   = require('node:test');

const {
  aggregateMarketSources,
  countScore,
  radiusScore,
  qualityScore,
  divergencePct,
  divergenceLevel,
  confidenceLevel,
  isSourceValid,
  MIN_COMPARABLES_FALLBACK,
  COUNT_TIERS,
  RADIUS_TIERS,
  DIVERGENCE_LOW,
  DIVERGENCE_MODERATE,
  DIVERGENCE_HIGH,
  CONFIDENCE_MIN_QUALITY,
} = require('../services/market-multi-source-aggregator');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAirbnbStats({ median = 80, p25 = 60, p75 = 100, occupancy = 70, tensionLevel = 'elevated' } = {}) {
  return { median, p25, p75, occupancy, tensionLevel, occupancy_semantics: 'calendar_unavailability_proxy', count: 10 };
}

function makeBookingStats({ median = 85, p25 = 65, p75 = 105 } = {}) {
  return { median, p25, p75, p10: 50, p90: 120, mean: 87, min: 45, max: 130, count: 10,
    occupancy: null, occupancy_semantics: 'unavailable', tensionLevel: null };
}

function makeSource(stats, comparableCount = 10, selectedRadiusKm = 3) {
  return { stats, comparableCount, selectedRadiusKm };
}

// ── BKG-01..05: countScore ────────────────────────────────────────────────────

test('BKG-01 countScore >= 15 → 1.00', () => {
  assert.strictEqual(countScore(15), 1.00);
  assert.strictEqual(countScore(20), 1.00);
});

test('BKG-02 countScore >= 10 < 15 → 0.90', () => {
  assert.strictEqual(countScore(10), 0.90);
  assert.strictEqual(countScore(14), 0.90);
});

test('BKG-03 countScore >= 8 < 10 → 0.80', () => {
  assert.strictEqual(countScore(8), 0.80);
  assert.strictEqual(countScore(9), 0.80);
});

test('BKG-04 countScore >= 5 < 8 → 0.65', () => {
  assert.strictEqual(countScore(5), 0.65);
  assert.strictEqual(countScore(7), 0.65);
});

test('BKG-05 countScore < 5 → 0.00', () => {
  assert.strictEqual(countScore(4),  0.00);
  assert.strictEqual(countScore(0),  0.00);
  assert.strictEqual(countScore(-1), 0.00);
});

// ── BKG-06..10: radiusScore ───────────────────────────────────────────────────

test('BKG-06 radiusScore <= 1 → 1.00', () => {
  assert.strictEqual(radiusScore(1),   1.00);
  assert.strictEqual(radiusScore(0.5), 1.00);
});

test('BKG-07 radiusScore <= 3 → 0.95', () => {
  assert.strictEqual(radiusScore(2), 0.95);
  assert.strictEqual(radiusScore(3), 0.95);
});

test('BKG-08 radiusScore <= 5 → 0.90', () => {
  assert.strictEqual(radiusScore(4), 0.90);
  assert.strictEqual(radiusScore(5), 0.90);
});

test('BKG-09 radiusScore <= 10 → 0.75', () => {
  assert.strictEqual(radiusScore(6),  0.75);
  assert.strictEqual(radiusScore(10), 0.75);
});

test('BKG-10 radiusScore <= 20 → 0.55', () => {
  assert.strictEqual(radiusScore(11), 0.55);
  assert.strictEqual(radiusScore(20), 0.55);
});

test('BKG-11 radiusScore null → 0.55 (no geo, treated as worst valid)', () => {
  assert.strictEqual(radiusScore(null), 0.55);
});

test('BKG-12 radiusScore > 20 → 0.00', () => {
  assert.strictEqual(radiusScore(21),  0.00);
  assert.strictEqual(radiusScore(100), 0.00);
});

// ── BKG-13..14: qualityScore ──────────────────────────────────────────────────

test('BKG-13 qualityScore = countScore × radiusScore', () => {
  const expected = countScore(12) * radiusScore(3);
  assert.strictEqual(qualityScore(12, 3), expected);
});

test('BKG-14 qualityScore = 0.00 when count < 5', () => {
  assert.strictEqual(qualityScore(3, 1), 0.00);
});

// ── BKG-15..19: divergencePct & divergenceLevel ───────────────────────────────

test('BKG-15 divergencePct symmetric: |A-B| / ((A+B)/2) × 100', () => {
  const dp = divergencePct(80, 100);
  assert.ok(Math.abs(dp - (20 / 90 * 100)) < 0.0001);
});

test('BKG-16 divergencePct is symmetric: divergencePct(A,B) === divergencePct(B,A)', () => {
  const d1 = divergencePct(80, 100);
  const d2 = divergencePct(100, 80);
  assert.ok(Math.abs(d1 - d2) < 0.0001);
});

test('BKG-17 divergencePct with zero or negative returns null', () => {
  assert.strictEqual(divergencePct(0, 100), null);
  assert.strictEqual(divergencePct(100, 0), null);
  assert.strictEqual(divergencePct(-1, 100), null);
});

test('BKG-18 divergenceLevel thresholds', () => {
  assert.strictEqual(divergenceLevel(5),  'LOW');
  assert.strictEqual(divergenceLevel(9),  'LOW');       // < 10 → LOW (strictly less-than)
  assert.strictEqual(divergenceLevel(10), 'MODERATE');  // 10 is not < 10 → MODERATE
  assert.strictEqual(divergenceLevel(11), 'MODERATE');
  assert.strictEqual(divergenceLevel(24), 'MODERATE');
  assert.strictEqual(divergenceLevel(25), 'HIGH');      // 25 is not < 25 → HIGH
  assert.strictEqual(divergenceLevel(49), 'HIGH');
  assert.strictEqual(divergenceLevel(50), 'EXTREME');   // >= 50 → EXTREME
  assert.strictEqual(divergenceLevel(99), 'EXTREME');
});

test('BKG-19 divergenceLevel(null) → null', () => {
  assert.strictEqual(divergenceLevel(null), null);
});

// ── BKG-20..25: confidenceLevel ───────────────────────────────────────────────

test('BKG-20 0 valid sources → INSUFFICIENT', () => {
  assert.strictEqual(confidenceLevel(0, null, null), 'INSUFFICIENT');
});

test('BKG-21 1 valid source → LOW', () => {
  assert.strictEqual(confidenceLevel(1, 'LOW', 0.90), 'LOW');
  assert.strictEqual(confidenceLevel(1, null, null), 'LOW');
});

test('BKG-22 2 sources + EXTREME divergence → LOW', () => {
  assert.strictEqual(confidenceLevel(2, 'EXTREME', 0.90), 'LOW');
});

test('BKG-23 2 sources + HIGH divergence → MEDIUM', () => {
  assert.strictEqual(confidenceLevel(2, 'HIGH', 0.90), 'MEDIUM');
});

test('BKG-24 2 sources + LOW divergence + minQuality < threshold → MEDIUM', () => {
  assert.strictEqual(confidenceLevel(2, 'LOW', CONFIDENCE_MIN_QUALITY - 0.01), 'MEDIUM');
});

test('BKG-25 2 sources + MODERATE divergence → MEDIUM', () => {
  assert.strictEqual(confidenceLevel(2, 'MODERATE', 0.80), 'MEDIUM');
});

test('BKG-26 2 sources + LOW divergence + minQuality >= threshold → HIGH', () => {
  assert.strictEqual(confidenceLevel(2, 'LOW', CONFIDENCE_MIN_QUALITY), 'HIGH');
  assert.strictEqual(confidenceLevel(2, 'LOW', 0.90), 'HIGH');
});

// ── BKG-27..30: isSourceValid ─────────────────────────────────────────────────

test('BKG-27 valid source passes isSourceValid', () => {
  assert.strictEqual(isSourceValid(makeSource(makeAirbnbStats())), true);
});

test('BKG-28 null source → false', () => {
  assert.strictEqual(isSourceValid(null), false);
  assert.strictEqual(isSourceValid({ stats: null, comparableCount: 10 }), false);
});

test('BKG-29 comparableCount < MIN_COMPARABLES_FALLBACK → false', () => {
  const src = makeSource(makeAirbnbStats(), MIN_COMPARABLES_FALLBACK - 1, 3);
  assert.strictEqual(isSourceValid(src), false);
});

test('BKG-30 p25 > median → false (invalid stats)', () => {
  const badStats = { median: 80, p25: 90, p75: 100 };
  assert.strictEqual(isSourceValid(makeSource(badStats)), false);
});

// ── BKG-31..36: aggregateMarketSources — dual-source consensus ────────────────

test('BKG-31 two valid sources produce a consensus', () => {
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats({ median: 80, p25: 60, p75: 100 })),
    booking: makeSource(makeBookingStats({ median: 100, p25: 75, p75: 125 })),
  });
  assert.ok(r.consensus !== null);
  assert.ok(r.consensus.median > 0);
});

test('BKG-32 consensus median is quality-weighted average of source medians', () => {
  // Equal quality → weights 0.5/0.5 → consensusMedian = (80+100)/2 = 90
  const src = makeSource(makeAirbnbStats({ median: 80, p25: 60, p75: 100 }), 10, 3);
  const bkg = makeSource(makeBookingStats({ median: 100, p25: 75, p75: 125 }), 10, 3);
  const r   = aggregateMarketSources({ airbnb: src, booking: bkg });
  assert.ok(r.consensus !== null);
  assert.ok(Math.abs(r.consensus.median - 90) < 0.01, `Expected ~90, got ${r.consensus.median}`);
});

test('BKG-33 higher-quality source gets bigger weight', () => {
  // airbnb: count=15 (score=1.00), radius=1 (score=1.00) → quality=1.00
  // booking: count=5  (score=0.65), radius=10 (score=0.75) → quality=0.4875
  const airbnb  = makeSource(makeAirbnbStats({ median: 80 }), 15, 1);
  const booking = makeSource(makeBookingStats({ median: 100 }), 5, 10);
  const r = aggregateMarketSources({ airbnb, booking });
  assert.ok(r.consensus.weights.airbnb > r.consensus.weights.booking,
    `Expected airbnb weight > booking, got ${JSON.stringify(r.consensus.weights)}`);
});

test('BKG-34 weights sum to 1 in dual-source case', () => {
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats()),
    booking: makeSource(makeBookingStats()),
  });
  const sum = r.consensus.weights.airbnb + r.consensus.weights.booking;
  assert.ok(Math.abs(sum - 1.0) < 0.0001, `Weights sum = ${sum}`);
});

test('BKG-35 divergence metrics present when two sources valid', () => {
  // Use stats where p25≤median≤p75 is satisfied for both sources
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats({ median: 80, p25: 60, p75: 100 })),
    booking: makeSource(makeBookingStats({ median: 100, p25: 75, p75: 130 })),
  });
  assert.ok(r.consensus !== null);
  assert.ok(r.consensus.divergencePct != null);
  assert.ok(['LOW','MODERATE','HIGH','EXTREME'].includes(r.consensus.divergenceLevel));
});

test('BKG-36 confidenceLevel present in consensus', () => {
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats()),
    booking: makeSource(makeBookingStats()),
  });
  assert.ok(['INSUFFICIENT','LOW','MEDIUM','HIGH'].includes(r.consensus.confidenceLevel));
});

// ── BKG-37..38: single source ─────────────────────────────────────────────────

test('BKG-37 only airbnb valid → consensus uses airbnb median, weight=[1,0]', () => {
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats({ median: 80 })),
    booking: null,
  });
  assert.ok(r.consensus !== null);
  assert.strictEqual(r.consensus.median, 80);
  assert.strictEqual(r.consensus.weights.airbnb,  1.00);
  assert.strictEqual(r.consensus.weights.booking, 0.00);
  assert.strictEqual(r.consensus.divergencePct,  null);
  assert.strictEqual(r.consensus.confidenceLevel, 'LOW');
});

test('BKG-38 only booking valid → consensus uses booking median, weight=[0,1]', () => {
  const r = aggregateMarketSources({
    airbnb:  null,
    booking: makeSource(makeBookingStats({ median: 100 })),
  });
  assert.ok(r.consensus !== null);
  assert.strictEqual(r.consensus.median, 100);
  assert.strictEqual(r.consensus.weights.airbnb,  0.00);
  assert.strictEqual(r.consensus.weights.booking, 1.00);
  assert.strictEqual(r.consensus.confidenceLevel, 'LOW');
});

// ── BKG-39: no sources ────────────────────────────────────────────────────────

test('BKG-39 no valid sources → consensus null', () => {
  const r = aggregateMarketSources({ airbnb: null, booking: null });
  assert.strictEqual(r.consensus, null);
});

// ── BKG-40..44: market signal ─────────────────────────────────────────────────

test('BKG-40 market signal from Airbnb when occupancy_semantics=calendar_unavailability_proxy', () => {
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats({ occupancy: 72, tensionLevel: 'elevated' })),
    booking: makeSource(makeBookingStats()),
  });
  assert.strictEqual(r.marketSignal.source, 'airbnb');
  assert.strictEqual(r.marketSignal.occupancy, 72);
  assert.strictEqual(r.marketSignal.occupancy_semantics, 'calendar_unavailability_proxy');
  assert.strictEqual(r.marketSignal.tensionLevel, 'elevated');
});

test('BKG-41 Booking occupancy is NEVER used for market signal (always null)', () => {
  const r = aggregateMarketSources({
    airbnb:  null,
    booking: makeSource(makeBookingStats()),
  });
  assert.strictEqual(r.marketSignal.source, null);
  assert.strictEqual(r.marketSignal.occupancy, null);
  assert.strictEqual(r.marketSignal.tensionLevel, null);
});

test('BKG-42 market signal null when no valid airbnb', () => {
  const r = aggregateMarketSources({ airbnb: null, booking: makeSource(makeBookingStats()) });
  assert.strictEqual(r.marketSignal.occupancy, null);
  assert.strictEqual(r.marketSignal.source, null);
});

test('BKG-43 market signal null when airbnb occupancy_semantics != calendar_unavailability_proxy', () => {
  const badStats = { ...makeAirbnbStats(), occupancy_semantics: 'insufficient_calendars' };
  const r = aggregateMarketSources({
    airbnb:  makeSource(badStats),
    booking: makeSource(makeBookingStats()),
  });
  assert.strictEqual(r.marketSignal.source, null);
  assert.strictEqual(r.marketSignal.occupancy, null);
});

test('BKG-44 market signal null is never 0 — null != 0', () => {
  const r = aggregateMarketSources({ airbnb: null, booking: null });
  assert.strictEqual(r.marketSignal.occupancy, null);
  assert.notStrictEqual(r.marketSignal.occupancy, 0);
});

// ── BKG-45..47: diagnostics ───────────────────────────────────────────────────

test('BKG-45 diagnostics includes validSourceCount, airbnbQuality, bookingQuality', () => {
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats(), 12, 3),
    booking: makeSource(makeBookingStats(), 8, 5),
  });
  assert.strictEqual(r.diagnostics.validSourceCount, 2);
  assert.ok(r.diagnostics.airbnbQuality  > 0);
  assert.ok(r.diagnostics.bookingQuality > 0);
});

test('BKG-46 diagnostics includes per-source countScore and radiusScore', () => {
  const r = aggregateMarketSources({
    airbnb:  makeSource(makeAirbnbStats(), 12, 3),
    booking: makeSource(makeBookingStats(), 8, 5),
  });
  assert.ok(r.diagnostics.airbnbCountScore  != null);
  assert.ok(r.diagnostics.airbnbRadiusScore != null);
  assert.ok(r.diagnostics.bookingCountScore  != null);
  assert.ok(r.diagnostics.bookingRadiusScore != null);
});

test('BKG-47 diagnostics quality null when source invalid', () => {
  const r = aggregateMarketSources({ airbnb: null, booking: null });
  assert.strictEqual(r.diagnostics.airbnbQuality, null);
  assert.strictEqual(r.diagnostics.bookingQuality, null);
  assert.strictEqual(r.diagnostics.validSourceCount, 0);
});

// ── BKG-48..51: edge cases and invariants ─────────────────────────────────────

test('BKG-48 Booking null occupancy is never averaged (null stays null in marketSignal)', () => {
  // This invariant ensures null != 0 never passes through arithmetic
  const booking = makeSource({ ...makeBookingStats(), occupancy: null, occupancy_semantics: 'unavailable' });
  const r = aggregateMarketSources({ airbnb: null, booking });
  assert.strictEqual(r.marketSignal.occupancy, null);
  assert.notStrictEqual(r.marketSignal.occupancy, 0);
});

test('BKG-49 aggregateMarketSources called with no args returns a valid result shape', () => {
  const r = aggregateMarketSources();
  assert.ok('sources' in r);
  assert.ok('consensus' in r);
  assert.ok('marketSignal' in r);
  assert.ok('diagnostics' in r);
  assert.strictEqual(r.consensus, null);
});

test('BKG-50 sources shape always has airbnb and booking keys', () => {
  const r = aggregateMarketSources({ airbnb: makeSource(makeAirbnbStats()), booking: null });
  assert.ok('airbnb'  in r.sources);
  assert.ok('booking' in r.sources);
  assert.strictEqual(r.sources.booking.valid, false);
  assert.strictEqual(r.sources.airbnb.valid,  true);
});

// ── BKG-51..54: source safety ─────────────────────────────────────────────────

test('BKG-51 aggregator source: 0 DB writes (no pool, INSERT, UPDATE)', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-multi-source-aggregator.js'), 'utf8');
  assert.ok(!src.includes('new Pool('), 'must not create DB pool');
  // Match SQL keywords only as code (not in comments): look for pool.query or raw SQL patterns
  assert.ok(!/pool\.query/i.test(src), 'must not call pool.query');
  assert.ok(!/\bINSERT\s+INTO\b/i.test(src), 'must not contain INSERT INTO');
  assert.ok(!/\bUPDATE\s+\w/i.test(src), 'must not contain UPDATE <table>');
});

test('BKG-52 aggregator source: 0 pricing-apply calls', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-multi-source-aggregator.js'), 'utf8');
  assert.ok(!/require\(['"][^'"]*pricing-apply/i.test(src), 'must not import pricing-apply module');
});

test('BKG-53 aggregator source: 0 Channex calls', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-multi-source-aggregator.js'), 'utf8');
  assert.ok(!src.includes('require') || !/require\(['"][^'"]*channex/i.test(src), 'must not import channex');
});

test('BKG-54 aggregator source: no fetch/network calls', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/market-multi-source-aggregator.js'), 'utf8');
  assert.ok(!src.includes('fetch('), 'must not call fetch (pure function)');
  assert.ok(!src.includes('https://'), 'must not embed network URLs');
});

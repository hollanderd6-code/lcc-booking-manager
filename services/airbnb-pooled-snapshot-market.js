'use strict';
/**
 * P1.2-B5-BK-J4 — Airbnb Pooled Snapshot Market
 *
 * Merges and deduplicates listings from 2-3 Airbnb snapshots into a single
 * quality-filtered pool, providing a more stable market signal than any
 * individual snapshot.
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   MARKET_PROVIDER_UNCHANGED
 *   BOOKING_PRODUCTION_DISABLED
 *
 * The unit of analysis is the individual listing, not the per-snapshot median.
 * A listing present in multiple snapshots is counted exactly once; its price
 * is the median of all observed prices for that ID.
 */

const { haversineKm, calcBrightDataMarketStats }    = require('./brightdata-comparable-filter');
const { buildCrossSourceQualityPool }               = require('./market-cross-source-policy');
const { evaluateSourceGeoQuality }                  = require('./market-geo-quality');

// ── Constants ─────────────────────────────────────────────────────────────────

const RADII_KM                  = [1, 2, 3, 5, 10, 20];
const MIN_COMPARABLES_TARGET    = 5;   // ideal: smallest radius with ≥ 5 unique listings
const MIN_COMPARABLES_FALLBACK  = 3;   // fallback: accept ≥ 3 if target unmet
const PAIR_DEVIATION_STABLE     = 10;  // % — pair medians within 10% of ABC = stable
const PAIR_DEVIATION_MODERATE   = 20;  // % — pair medians within 20% = moderate
const PRICE_VARIATION_LOW       = 5;   // % — repeated listing prices vary < 5% = low
const PRICE_VARIATION_HIGH      = 20;  // % — repeated listing prices vary ≥ 20% = high

// ── Internal helpers ──────────────────────────────────────────────────────────

function medianOfSorted(sorted) {
  if (!sorted.length) return null;
  const n = sorted.length, mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getListingsWithinRadius(listings, targetLat, targetLon, radiusKm) {
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return [];
  return listings.filter(l =>
    Number.isFinite(l.latitude) && Number.isFinite(l.longitude) &&
    haversineKm(targetLat, targetLon, l.latitude, l.longitude) <= radiusKm
  );
}

// ── mergeAndDedup ─────────────────────────────────────────────────────────────

/**
 * Merge quality-filtered snapshots, dedup by providerListingId.
 *
 * Strategy for duplicates:
 *   - Representative price = median of all prices seen for that ID
 *   - latitude/longitude/category/guests = taken from the first occurrence
 *   - Listings with null providerListingId are included once per occurrence
 *
 * @param {Array<{snapshotId: string, listings: object[]}>} qualitySnapshots
 * @returns {{
 *   uniqueListings: object[],
 *   totalInput: number,
 *   uniqueCount: number,
 *   withIdCount: number,
 *   noIdCount: number,
 *   dedupedCount: number,
 *   repeatedListings: Array<{id, occurrences, snapshotIds, prices, priceVariationPct}>
 * }}
 */
function mergeAndDedup(qualitySnapshots) {
  const byId     = new Map();   // id → { listing, priceEntries: [{snapshotId, price}] }
  const noIdList = [];
  let   totalInput = 0;

  for (const snap of (qualitySnapshots || [])) {
    for (const l of (snap.listings || [])) {
      totalInput++;
      const id = l.providerListingId;
      if (id == null) { noIdList.push(l); continue; }
      if (!byId.has(id)) byId.set(id, { listing: l, priceEntries: [] });
      byId.get(id).priceEntries.push({ snapshotId: snap.snapshotId, price: l.price });
    }
  }

  const repeatedListings = [];
  const uniqueListings   = [];

  for (const [id, entry] of byId) {
    const validPrices = entry.priceEntries
      .map(e => e.price)
      .filter(p => p != null && p > 0)
      .sort((a, b) => a - b);

    let repPrice          = entry.priceEntries[0]?.price ?? null;
    let priceVariationPct = 0;

    if (validPrices.length > 0) {
      repPrice = medianOfSorted(validPrices);
      if (validPrices.length > 1) {
        const minP = validPrices[0];
        const maxP = validPrices[validPrices.length - 1];
        const mean = validPrices.reduce((s, p) => s + p, 0) / validPrices.length;
        priceVariationPct = mean > 0 ? (maxP - minP) / mean * 100 : 0;
      }
    }

    uniqueListings.push({ ...entry.listing, price: repPrice });

    if (entry.priceEntries.length > 1) {
      repeatedListings.push({
        id,
        occurrences:      entry.priceEntries.length,
        snapshotIds:      entry.priceEntries.map(e => e.snapshotId),
        prices:           entry.priceEntries.map(e => e.price),
        priceVariationPct,
      });
    }
  }

  for (const l of noIdList) uniqueListings.push(l);

  return {
    uniqueListings,
    totalInput,
    uniqueCount:  uniqueListings.length,
    withIdCount:  byId.size,
    noIdCount:    noIdList.length,
    dedupedCount: totalInput - uniqueListings.length,
    repeatedListings,
  };
}

// ── selectPooledRadius ────────────────────────────────────────────────────────

/**
 * Select the smallest radius containing ≥ MIN_COMPARABLES_TARGET unique listings.
 * Falls back to smallest with ≥ MIN_COMPARABLES_FALLBACK if target unmet.
 */
function selectPooledRadius(uniqueListings, targetLat, targetLon) {
  for (const r of RADII_KM) {
    const count = getListingsWithinRadius(uniqueListings, targetLat, targetLon, r).length;
    if (count >= MIN_COMPARABLES_TARGET) {
      return { selectedRadiusKm: r, fallbackUsed: false, countAtRadius: count };
    }
  }
  for (const r of RADII_KM) {
    const count = getListingsWithinRadius(uniqueListings, targetLat, targetLon, r).length;
    if (count >= MIN_COMPARABLES_FALLBACK) {
      return { selectedRadiusKm: r, fallbackUsed: true, countAtRadius: count };
    }
  }
  return { selectedRadiusKm: null, fallbackUsed: null, countAtRadius: 0 };
}

// ── calcPooledStats ───────────────────────────────────────────────────────────

/**
 * Calculate P10/P25/median/P75/P90 plus occupancy proxy on a deduped pool.
 * Uses the same floor-based percentile formula as calcBrightDataMarketStats.
 */
function calcPooledStats(listings, today) {
  if (!listings || listings.length === 0) return null;

  const prices = listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return null;

  const n   = prices.length;
  const mid = Math.floor(n / 2);

  const base = calcBrightDataMarketStats(listings, today ? { today } : {});

  return {
    count:               n,
    min:                 prices[0],
    p10:                 prices[Math.floor(n * 0.10)],
    p25:                 prices[Math.floor(n * 0.25)],
    median:              n % 2 === 1 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2,
    p75:                 prices[Math.floor(n * 0.75)],
    p90:                 prices[Math.floor(n * 0.90)],
    max:                 prices[n - 1],
    mean:                prices.reduce((s, p) => s + p, 0) / n,
    occupancy:           base?.occupancy           ?? 0,
    occupancy_semantics: base?.occupancy_semantics ?? 'insufficient_calendars',
    tensionLevel:        base?.tensionLevel        ?? null,
  };
}

// ── computeSensitivity ────────────────────────────────────────────────────────

/**
 * For each pair/combo (AB, AC, BC, ABC), merge-dedup only those snapshots,
 * then compute median at the already-selected radius.
 * All pairs use the SAME radius as the full ABC pool for apples-to-apples comparison.
 */
function computeSensitivity(qualitySnapshots, selectedRadiusKm, targetLat, targetLon, today) {
  const n = qualitySnapshots.length;
  if (n < 2) return {};

  const combos = [{ key: 'AB', indices: [0, 1] }];
  if (n >= 3) {
    combos.push({ key: 'AC',  indices: [0, 2] });
    combos.push({ key: 'BC',  indices: [1, 2] });
    combos.push({ key: 'ABC', indices: [0, 1, 2] });
  }

  const results = {};
  for (const { key, indices } of combos) {
    const subset = indices.map(i => qualitySnapshots[i]);
    const merged = mergeAndDedup(subset);
    const atR    = selectedRadiusKm != null
      ? getListingsWithinRadius(merged.uniqueListings, targetLat, targetLon, selectedRadiusKm)
      : [];
    const stats  = atR.length >= 1 ? calcPooledStats(atR, today) : null;
    results[key] = {
      uniqueCount:   merged.uniqueCount,
      countAtRadius: atR.length,
      median:        stats?.median ?? null,
      p25:           stats?.p25   ?? null,
      p75:           stats?.p75   ?? null,
    };
  }
  return results;
}

// ── computeRepeatedPriceVariation ─────────────────────────────────────────────

function computeRepeatedPriceVariation(repeatedListings) {
  if (!repeatedListings || repeatedListings.length === 0) {
    return { mean: 0, max: 0, count: 0 };
  }
  const variations = repeatedListings.map(r => r.priceVariationPct);
  const mean = variations.reduce((s, v) => s + v, 0) / variations.length;
  const max  = Math.max(...variations);
  return { mean, max, count: repeatedListings.length };
}

// ── computePairToAbcDeviation ─────────────────────────────────────────────────

/**
 * Deviation of each pair median vs the full ABC median.
 * Returns null when there is no ABC reference (fewer than 3 snapshots).
 */
function computePairToAbcDeviation(sensitivity) {
  const abcMedian = sensitivity?.ABC?.median ?? null;
  if (abcMedian == null || abcMedian === 0) return null;

  const deviations = {};
  let   maxDeviationPct = null;

  for (const key of ['AB', 'AC', 'BC']) {
    const m = sensitivity[key]?.median;
    if (m == null) { deviations[key] = null; continue; }
    const dev = Math.abs(m - abcMedian) / abcMedian * 100;
    deviations[key] = dev;
    if (maxDeviationPct == null || dev > maxDeviationPct) maxDeviationPct = dev;
  }
  return { deviations, maxDeviationPct };
}

// ── classifyPooledStability ───────────────────────────────────────────────────

/**
 * @param {number|null} pairMaxDeviationPct — null if only 2 snapshots (no ABC ref)
 * @param {number}      repeatedVariationMean
 */
function classifyPooledStability(pairMaxDeviationPct, repeatedVariationMean) {
  if (pairMaxDeviationPct == null) {
    // 2-snapshot run: can only use repeated price variation
    if (repeatedVariationMean < PRICE_VARIATION_LOW)  return 'STABLE';
    if (repeatedVariationMean < PRICE_VARIATION_HIGH) return 'MODERATE';
    return 'VOLATILE';
  }
  if (pairMaxDeviationPct < PAIR_DEVIATION_STABLE  && repeatedVariationMean < PRICE_VARIATION_LOW)  return 'STABLE';
  if (pairMaxDeviationPct < PAIR_DEVIATION_MODERATE || repeatedVariationMean < PRICE_VARIATION_HIGH) return 'MODERATE';
  return 'VOLATILE';
}

// ── classifyPooledConfidence ──────────────────────────────────────────────────

function classifyPooledConfidence(stability, comparableCount, selectedRadiusKm, fallbackUsed) {
  if (comparableCount < MIN_COMPARABLES_FALLBACK)                return 'INSUFFICIENT';
  if (stability === 'VOLATILE')                                  return 'LOW';
  if (stability === 'STABLE'
    && comparableCount >= MIN_COMPARABLES_TARGET
    && selectedRadiusKm <= 5
    && !fallbackUsed)                                            return 'HIGH';
  return 'MEDIUM';
}

// ── buildAirbnbPooledMarket ───────────────────────────────────────────────────

/**
 * Main entry point. Accepts raw (un-filtered) snapshots; quality filters applied
 * internally via buildCrossSourceQualityPool.
 *
 * @param {Array<{snapshotId: string, listings: object[]}>} rawSnapshots
 * @param {{
 *   targetLat:           number,
 *   targetLon:           number,
 *   targetGuests?:       number|null,
 *   targetPropertyType?: string,
 *   today?:              string,  // YYYY-MM-DD for occupancy window
 * }} opts
 */
function buildAirbnbPooledMarket(rawSnapshots, opts = {}) {
  const {
    targetLat,
    targetLon,
    targetGuests       = null,
    targetPropertyType = 'entire_place',
    today              = null,
  } = opts;

  if (!rawSnapshots || rawSnapshots.length < 2) {
    return {
      status: 'insufficient_data', reason: 'need_at_least_2_snapshots',
      pooledMarketStability: 'INSUFFICIENT', pooledMarketConfidence: 'INSUFFICIENT',
      safeToUse: false,
    };
  }
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) {
    return {
      status: 'error', reason: 'missing_target_coords',
      pooledMarketStability: 'INSUFFICIENT', pooledMarketConfidence: 'INSUFFICIENT',
      safeToUse: false,
    };
  }

  // 1. Apply quality filters to each snapshot
  const qualityResults = rawSnapshots.map(s => {
    const qPool      = buildCrossSourceQualityPool(s.listings || [], 'airbnb', {
      targetGuests, targetPropertyType,
    });
    const geoQuality = evaluateSourceGeoQuality(qPool.listings, targetLat, targetLon);
    return {
      snapshotId:        s.snapshotId,
      listings:          qPool.listings,
      qualityDiagnostics: qPool.diagnostics,
      geoQuality,
      rawCount:          (s.listings || []).length,
    };
  });

  // 2-4. Merge and dedup across all snapshots
  const merged = mergeAndDedup(qualityResults);
  const { uniqueListings, repeatedListings } = merged;

  // Unique counts by radius
  const uniqueCountsByRadius = {};
  for (const r of RADII_KM) {
    uniqueCountsByRadius[r] = getListingsWithinRadius(uniqueListings, targetLat, targetLon, r).length;
  }

  // 5-6. Select radius
  const radiusSel = selectPooledRadius(uniqueListings, targetLat, targetLon);

  if (radiusSel.selectedRadiusKm == null) {
    return {
      status: 'insufficient_data', reason: 'no_radius_with_min_comparables',
      totalInput:         merged.totalInput,
      uniqueCount:        merged.uniqueCount,
      uniqueCountsByRadius,
      perSnapshotQuality: qualityResults.map(r => ({
        snapshotId: r.snapshotId, qualityDiagnostics: r.qualityDiagnostics, geoQuality: r.geoQuality,
      })),
      pooledMarketStability: 'INSUFFICIENT', pooledMarketConfidence: 'INSUFFICIENT',
      safeToUse: false,
    };
  }

  // 7. Stats at selected radius
  const pooledListings = getListingsWithinRadius(
    uniqueListings, targetLat, targetLon, radiusSel.selectedRadiusKm
  );
  const pooledStats = calcPooledStats(pooledListings, today);

  if (!pooledStats) {
    return {
      status: 'insufficient_data', reason: 'no_valid_prices_at_radius',
      totalInput:        merged.totalInput,
      uniqueCount:       merged.uniqueCount,
      uniqueCountsByRadius,
      selectedRadiusKm:  radiusSel.selectedRadiusKm,
      pooledMarketStability: 'INSUFFICIENT', pooledMarketConfidence: 'INSUFFICIENT',
      safeToUse: false,
    };
  }

  // 8-9. Sensitivity analysis (pairs at same radius)
  const sensitivity   = computeSensitivity(
    qualityResults, radiusSel.selectedRadiusKm, targetLat, targetLon, today
  );

  const pairDeviation = rawSnapshots.length >= 3
    ? computePairToAbcDeviation(sensitivity)
    : null;

  const priceVariation = computeRepeatedPriceVariation(repeatedListings);

  // 10. Stability and confidence
  const stability  = classifyPooledStability(
    pairDeviation?.maxDeviationPct ?? null,
    priceVariation.mean
  );
  const confidence = classifyPooledConfidence(
    stability, pooledListings.length, radiusSel.selectedRadiusKm, radiusSel.fallbackUsed
  );

  return {
    status: 'ok',
    // Per-snapshot quality (for diagnostics)
    perSnapshotQuality: qualityResults.map(r => ({
      snapshotId:         r.snapshotId,
      rawCount:           r.rawCount,
      qualityDiagnostics: r.qualityDiagnostics,
      geoQuality:         r.geoQuality,
    })),
    // Dedup summary
    totalInput:      merged.totalInput,
    uniqueCount:     merged.uniqueCount,
    withIdCount:     merged.withIdCount,
    noIdCount:       merged.noIdCount,
    dedupedCount:    merged.dedupedCount,
    repeatedCount:   repeatedListings.length,
    // Geo distribution of unique listings
    uniqueCountsByRadius,
    // Selected market
    selectedRadiusKm: radiusSel.selectedRadiusKm,
    fallbackUsed:     radiusSel.fallbackUsed,
    comparableCount:  pooledListings.length,
    // Stats
    pooledStats,
    // Sensitivity
    sensitivity,
    pairDeviation,
    // Repeated price variation
    priceVariation,
    // Verdict
    pooledMarketStability:  stability,
    pooledMarketConfidence: confidence,
    safeToUse: stability === 'STABLE' && confidence === 'HIGH',
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
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
};

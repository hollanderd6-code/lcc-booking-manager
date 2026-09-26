'use strict';
/**
 * P1.2-B5-BK-I — Cross-Source Comparability Policy
 *
 * Source-specific quality filters and common-radius selection for
 * multi-source market consensus.
 *
 * SAFETY:
 *   DB_WRITES        = 0  — no pool, no INSERT/UPDATE
 *   CHANNEX_CALLS    = 0  — no channex import
 *   PRICING_WRITES   = 0  — no pricing-apply import
 *   NETWORK_CALLS    = 0  — pure functions
 *   PRODUCTION_ROUTING_UNCHANGED
 *
 * DESIGN:
 *   Airbnb:  category + capacity filters (from existing isCategoryCompatible/isCapacityCompatible)
 *            bedrooms always null — FILTER_NOT_APPLIED
 *   Booking: category (stricter — hostels/hotels/guest_houses rejected)
 *            bedroom (tiered: exact → exact+missing → fail_open)
 *            capacity FILTER_NOT_APPLIED (adults is input echo, not listing capacity)
 *
 * Common-radius policy:
 *   Find the smallest radius where BOTH sources have ≥ MIN_COMPARABLES after
 *   source-specific quality filters. Prefer local — do not expand to reach TARGET
 *   when FALLBACK already satisfied for both sources.
 */

const {
  haversineKm,
  isCategoryCompatible,
  isCapacityCompatible,
  RADIUS_BANDS_KM,
  MIN_COMPARABLES_FALLBACK,
} = require('./brightdata-comparable-filter');

// ── Booking.com category compatibility ───────────────────────────────────────
// Based on observed Booking.com property_type values (stored lowercase in adapter).

const BOOKING_COMPATIBLE_CATEGORIES = new Set([
  'apartment', 'apartments', 'flat', 'flats',
  'holiday home', 'holiday homes', 'vacation home', 'vacation rental',
  'villa', 'villas', 'chalet', 'chalets',
  'cottage', 'cottages', 'bungalow', 'bungalows',
  'house', 'houses', 'entire home', 'entire home/apt',
  'studio', 'loft', 'condo', 'condos', 'cabin', 'cabins',
  'aparthotel', 'aparthotels', // borderline: hotel services + apt style — compatible with caveat
]);

// Explicitly incompatible for any entire-place target
// (shared accommodation or commercial hotel market)
const BOOKING_INCOMPATIBLE_CATEGORIES = new Set([
  'hostel', 'hostels',
  'hotel', 'hotels',
  'motel', 'motels',
  'guest house', 'guest houses', 'guesthouse', 'guesthouses',
  'bed and breakfast', 'bed & breakfast', 'b&b', 'bnb',
  'inn', 'resort', 'resorts',
]);

// Minimum comparables required for common-radius selection
const CROSS_SOURCE_MIN_COMPARABLES = MIN_COMPARABLES_FALLBACK; // 5

// Calibrated cross-source divergence thresholds
// More lenient than within-source thresholds because cross-platform
// structural differences (coverage, listing categories) add noise.
const CROSS_SOURCE_DIVERGENCE_LOW      = 15;
const CROSS_SOURCE_DIVERGENCE_MODERATE = 30;
const CROSS_SOURCE_DIVERGENCE_HIGH     = 50;

// Metadata completeness scoring
const AIRBNB_METADATA_BASELINE  = 0.85; // bedrooms always null (structural gap)
const BOOKING_METADATA_BASELINE = 0.85;
const METADATA_BONUS            = 0.10; // bonus for available metadata field

// ── bookingCategoryCompatible ─────────────────────────────────────────────────

/**
 * Determines if a Booking.com property_type is compatible with the target
 * property type for comparable market analysis.
 *
 * Returns:
 *   true  — compatible
 *   false — incompatible (reject)
 *   null  — unknown (keep conservatively)
 *
 * BOOKING_INCOMPATIBLE_CATEGORIES includes hostels, hotels, motels, guest houses,
 * and B&Bs — these serve a different market segment than self-catering apartments.
 * APARTHOTELS are marked compatible-with-caveat: they compete on nightly rate in
 * the same price range but may have shared services. (B5-BK-I: evaluate only)
 */
function bookingCategoryCompatible(category, targetPropertyType) {
  if (!targetPropertyType) return true;   // no target → accept all
  if (!category) return null;             // unknown → keep conservatively

  const cat = String(category).toLowerCase().trim();

  // Explicit incompatible: shared/commercial accommodation
  if (BOOKING_INCOMPATIBLE_CATEGORIES.has(cat))   return false;
  if (cat.includes('hostel') || cat.includes('motel')) return false;
  if (cat === 'hotel' || cat === 'hotels')         return false;
  if (cat.includes('guest house') || cat.includes('guesthouse')) return false;
  if (cat.includes('bed and breakfast') || cat === 'b&b') return false;

  if (targetPropertyType === 'entire_place') {
    // Standard hotels (but not "aparthotel" which has "hotel" as substring)
    if (cat.includes('hotel') && !cat.includes('apart')) return false;
    // Resort without villa/holiday context
    if (cat.includes('resort') && !cat.includes('villa') && !cat.includes('holiday')) return false;

    // Explicit compatible
    if (BOOKING_COMPATIBLE_CATEGORIES.has(cat))    return true;
    if (cat.includes('apartment') || cat.includes('flat'))  return true;
    if (cat.includes('holiday') || cat.includes('vacation')) return true;
    if (cat.includes('villa') || cat.includes('chalet'))    return true;
    if (cat.includes('cottage') || cat.includes('bungalow')) return true;
    if (cat.includes('house') || cat.includes('home'))      return true;
    if (cat.includes('studio') || cat.includes('loft'))     return true;
    if (cat.includes('cabin') || cat.includes('condo'))     return true;
    if (cat.includes('aparthotel'))                         return true;

    return null; // unrecognized → keep conservatively
  }

  return true; // unknown targetPropertyType → accept
}

// ── bookingBedroomFilter ──────────────────────────────────────────────────────

/**
 * Tiered bedroom quality filter for Booking.com comparables.
 *
 * Priority order:
 *   1. exact bedroom match (nb_bedrooms === targetBedrooms)
 *      → if count >= MIN_COMPARABLES_FALLBACK, use only exact matches
 *   2. exact + missing (nb_bedrooms == null treated as unknown, not wrong)
 *      → if count >= MIN_COMPARABLES_FALLBACK, use exact + missing
 *   3. fail_open: accept all (including bedroom mismatch)
 *      → used only as last resort
 *
 * Never treats "missing" as mismatch.
 * Reports policy applied and counts for diagnostics.
 */
function bookingBedroomFilter(listings, targetBedrooms) {
  const exactCount   = listings.filter(l => l.bedrooms != null && l.bedrooms === targetBedrooms).length;
  const missingCount = listings.filter(l => l.bedrooms == null).length;
  const wrongCount   = listings.filter(l => l.bedrooms != null && l.bedrooms !== targetBedrooms).length;

  if (targetBedrooms == null) {
    return {
      listings,
      policy:         'no_target_bedrooms',
      exactCount:     null,
      missingCount,
      rejectedCount:  0,
    };
  }

  const exact   = listings.filter(l => l.bedrooms != null && l.bedrooms === targetBedrooms);
  if (exact.length >= MIN_COMPARABLES_FALLBACK) {
    return {
      listings:      exact,
      policy:        'exact_match',
      exactCount,
      missingCount,
      rejectedCount: wrongCount,
    };
  }

  const missing  = listings.filter(l => l.bedrooms == null);
  const combined = [...exact, ...missing];
  if (combined.length >= MIN_COMPARABLES_FALLBACK) {
    return {
      listings:      combined,
      policy:        'exact_plus_missing',
      exactCount,
      missingCount,
      rejectedCount: wrongCount,
    };
  }

  // Fail open — last resort, include bedroom mismatches
  return {
    listings,
    policy:        'fail_open',
    exactCount,
    missingCount,
    rejectedCount: wrongCount,
  };
}

// ── buildCrossSourceQualityPool ───────────────────────────────────────────────

/**
 * Build source-specific quality pool (without geographic radius filter).
 *
 * Airbnb: dedup + isCategoryCompatible + isCapacityCompatible (guests)
 *         bedroom filter NOT APPLIED (bedrooms always null in adapter)
 *
 * Booking: dedup + bookingCategoryCompatible + bookingBedroomFilter (tiered)
 *          capacity filter NOT APPLIED (adults is input echo, not listing capacity)
 *
 * Does not mutate input.
 */
function buildCrossSourceQualityPool(listings, provider, opts = {}) {
  const { targetGuests = null, targetBedrooms = null, targetPropertyType = null } = opts;

  // Dedup
  const seenIds = new Set();
  const deduped = [];
  for (const l of listings) {
    const id = l.providerListingId;
    if (id != null) { if (seenIds.has(id)) continue; seenIds.add(id); }
    deduped.push(l);
  }
  const dedupRejected = listings.length - deduped.length;

  if (provider === 'airbnb') {
    const afterCat = deduped.filter(l => isCategoryCompatible(l.category, targetPropertyType) !== false);
    const afterCap = afterCat.filter(l => isCapacityCompatible(l.guests, targetGuests) !== false);
    return {
      listings: afterCap,
      diagnostics: {
        inputCount:    listings.length,
        dedupRejected,
        catRejected:   deduped.length - afterCat.length,
        catMissing:    afterCat.filter(l => l.category == null).length,
        capRejected:   afterCat.length - afterCap.length,
        capMissing:    afterCap.filter(l => l.guests == null).length,
        bedroomNote:   'FILTER_NOT_APPLIED — bedrooms always null in Airbnb adapter',
        capacityNote:  null,
        outputCount:   afterCap.length,
      },
    };
  }

  if (provider === 'booking') {
    const afterCat = deduped.filter(l => bookingCategoryCompatible(l.category, targetPropertyType) !== false);
    const bedroomResult = bookingBedroomFilter(afterCat, targetBedrooms);
    return {
      listings: bedroomResult.listings,
      diagnostics: {
        inputCount:      listings.length,
        dedupRejected,
        catRejected:     deduped.length - afterCat.length,
        catMissing:      afterCat.filter(l => l.category == null).length,
        bedroomPolicy:   bedroomResult.policy,
        bedroomExact:    bedroomResult.exactCount,
        bedroomMissing:  bedroomResult.missingCount,
        bedroomRejected: bedroomResult.rejectedCount,
        capacityNote:    'FILTER_NOT_APPLIED — adults is input echo, not listing capacity',
        outputCount:     bedroomResult.listings.length,
      },
    };
  }

  throw new Error(`buildCrossSourceQualityPool: unknown provider "${provider}"`);
}

// ── computeMetadataScore ──────────────────────────────────────────────────────

/**
 * Metadata completeness score for a comparable pool.
 *
 * Airbnb: bedrooms always null (structural gap) → fixed 0.85 baseline.
 *         Some listings have guest capacity → adds partial bonus.
 * Booking: bedrooms partially known → bonus proportional to bedroom coverage.
 *          Guest capacity never available → no guest bonus.
 *
 * Range: 0.80 – 0.95
 */
function computeMetadataScore(listings, provider) {
  if (!listings.length) return 0;

  if (provider === 'airbnb') {
    const guestPct = listings.filter(l => l.guests != null).length / listings.length;
    return AIRBNB_METADATA_BASELINE + METADATA_BONUS * guestPct;
  }

  if (provider === 'booking') {
    const bedroomPct = listings.filter(l => l.bedrooms != null).length / listings.length;
    return BOOKING_METADATA_BASELINE + METADATA_BONUS * bedroomPct;
  }

  return 1.0;
}

// ── selectCommonComparisonRadius ──────────────────────────────────────────────

/**
 * Find the smallest radius where BOTH sources have ≥ minComparables after
 * source-specific quality filters (Airbnb: cat+cap; Booking: cat+bedroom).
 *
 * Policy:
 * - Check radius bands in order [1, 2, 3, 5, 10, 20 km].
 * - Return the FIRST (smallest) band where airbnbCount >= min AND bookingCount >= min.
 * - Do NOT expand merely to reach TARGET (8) once FALLBACK (5) is satisfied.
 * - If no band satisfies both, return a null-radius result.
 *
 * Expected M6 result (from B5-BK-H audit): common radius ≈ 2 km.
 *
 * @param {object} airbnbRaw   — { listings: NormalizedListing[], diagnostics }
 * @param {object} bookingRaw  — { listings: NormalizedListing[], diagnostics }
 * @param {number} targetLat
 * @param {number} targetLon
 * @param {object} opts
 * @param {number} [opts.targetGuests]
 * @param {number} [opts.targetBedrooms]
 * @param {string} [opts.targetPropertyType]
 * @param {number} [opts.minComparables=5]
 */
function selectCommonComparisonRadius(
  airbnbRaw, bookingRaw, targetLat, targetLon, opts = {}
) {
  const {
    targetGuests        = null,
    targetBedrooms      = null,
    targetPropertyType  = null,
    minComparables      = CROSS_SOURCE_MIN_COMPARABLES,
  } = opts;

  const noGeo = !Number.isFinite(targetLat) || !Number.isFinite(targetLon);

  const airbnbPool  = buildCrossSourceQualityPool(
    airbnbRaw.listings  || airbnbRaw,  'airbnb',  { targetGuests, targetPropertyType }
  );
  const bookingPool = buildCrossSourceQualityPool(
    bookingRaw.listings || bookingRaw, 'booking', { targetBedrooms, targetPropertyType }
  );

  if (noGeo) {
    // No geo → cannot determine distance-based common radius
    // Fall back: use the entire quality pool, report no radius
    const airbnbCount  = airbnbPool.listings.length;
    const bookingCount = bookingPool.listings.length;
    const found = airbnbCount >= minComparables && bookingCount >= minComparables;
    return {
      radiusKm:          null,
      airbnbCount,
      bookingCount,
      airbnbListings:    airbnbPool.listings,
      bookingListings:   bookingPool.listings,
      airbnbDiagnostics: airbnbPool.diagnostics,
      bookingDiagnostics: bookingPool.diagnostics,
      found,
      reason:            found ? 'no_geo_quality_pool' : 'insufficient_no_geo',
    };
  }

  const mkWithDist = (pool) =>
    pool.listings
      .filter(l => Number.isFinite(l.latitude) && Number.isFinite(l.longitude))
      .map(l => ({ ...l, _dist: haversineKm(targetLat, targetLon, l.latitude, l.longitude) }));

  const airbnbGeo  = mkWithDist(airbnbPool);
  const bookingGeo = mkWithDist(bookingPool);

  for (const r of RADIUS_BANDS_KM) {
    const aInR = airbnbGeo.filter(d => d._dist <= r);
    const bInR = bookingGeo.filter(d => d._dist <= r);

    if (aInR.length >= minComparables && bInR.length >= minComparables) {
      const strip = ({ _dist, ...l }) => l;   // eslint-disable-line no-unused-vars
      return {
        radiusKm:          r,
        airbnbCount:       aInR.length,
        bookingCount:      bInR.length,
        airbnbListings:    aInR.map(strip),
        bookingListings:   bInR.map(strip),
        airbnbDiagnostics: airbnbPool.diagnostics,
        bookingDiagnostics: bookingPool.diagnostics,
        found:             true,
        reason:            'common_radius_selected',
      };
    }
  }

  // No common radius satisfies both at minimum threshold
  return {
    radiusKm:          null,
    airbnbCount:       airbnbGeo.length,
    bookingCount:      bookingGeo.length,
    airbnbListings:    [],
    bookingListings:   [],
    airbnbDiagnostics: airbnbPool.diagnostics,
    bookingDiagnostics: bookingPool.diagnostics,
    found:             false,
    reason:            'no_common_radius',
  };
}

// ── computeCrossSourceDivergenceLevel ─────────────────────────────────────────

/**
 * Calibrated cross-source divergence thresholds.
 * More lenient than within-source thresholds (<10/<25/<50) because cross-platform
 * structural differences add inherent noise.
 *
 * < 15  → LOW
 * < 30  → MODERATE
 * < 50  → HIGH
 * ≥ 50  → EXTREME
 */
function computeCrossSourceDivergenceLevel(pct) {
  if (pct == null) return null;
  if (pct < CROSS_SOURCE_DIVERGENCE_LOW)      return 'LOW';
  if (pct < CROSS_SOURCE_DIVERGENCE_MODERATE) return 'MODERATE';
  if (pct < CROSS_SOURCE_DIVERGENCE_HIGH)     return 'HIGH';
  return 'EXTREME';
}

module.exports = {
  bookingCategoryCompatible,
  bookingBedroomFilter,
  buildCrossSourceQualityPool,
  computeMetadataScore,
  selectCommonComparisonRadius,
  computeCrossSourceDivergenceLevel,
  BOOKING_COMPATIBLE_CATEGORIES,
  BOOKING_INCOMPATIBLE_CATEGORIES,
  CROSS_SOURCE_MIN_COMPARABLES,
  CROSS_SOURCE_DIVERGENCE_LOW,
  CROSS_SOURCE_DIVERGENCE_MODERATE,
  CROSS_SOURCE_DIVERGENCE_HIGH,
  AIRBNB_METADATA_BASELINE,
  BOOKING_METADATA_BASELINE,
  METADATA_BONUS,
};

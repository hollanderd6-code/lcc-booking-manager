'use strict';
/**
 * P1.2-B5-BK-O6 — Shared Search Planner
 *
 * Pure module — no DB, no network, no Channex.
 *
 * Given a list of properties and search parameters, computes the MINIMAL
 * set of actual provider searches needed by deduplicating on market search
 * identity. Properties that share the same profile, provider, and stay window
 * map to a single search.
 *
 * Example — Massy, 12 properties, 2 profiles, 1 stay window, 2 providers:
 *   naiveSearchCount    = 12 × 2 = 24
 *   actualSearchCount   =  2 × 2 =  4
 *   searchesSaved       = 20
 *
 * SAFETY:
 *   DB_WRITES      = 0  always
 *   NETWORK_CALLS  = 0  pure function
 *   BRIGHT_DATA    = 0  no credits consumed
 *   SAFE_TO_ACTIVATE_PRODUCTION = NO
 */

const {
  buildMarketProfileIdentity,
  buildMarketSearchFingerprint,
} = require('./market-search-identity');

// ── planSharedSearches ────────────────────────────────────────────────────────

/**
 * Plan the minimal set of searches for a set of properties.
 *
 * Properties are expected to carry the fields used for profile identity:
 *   latitude, longitude, currency
 *   max_guests or targetGuests (property.max_guests is the DB column name)
 *   bedrooms or targetBedrooms
 *   property_type or targetPropertyType
 *   id or property_id — used for assignment output only, NOT for fingerprinting
 *
 * @param {object}   opts
 * @param {object[]} opts.properties          — array of property objects
 * @param {object}   opts.stayWindow          — { checkIn: string, checkOut: string }
 * @param {string[]} [opts.providers]         — default ['airbnb']
 * @param {number}   [opts.maxListings=100]
 *
 * @returns {{
 *   propertyCount:       number,
 *   profileCount:        number,
 *   profiles:            ProfileSummary[],
 *   searches:            SearchSummary[],
 *   propertyAssignments: PropertyAssignment[],
 *   invalidProperties:   InvalidProperty[],
 *   deduplication: {
 *     naiveSearchCount:  number,
 *     actualSearchCount: number,
 *     searchesSaved:     number,
 *     reductionPct:      number,
 *   },
 * }}
 */
function planSharedSearches({
  properties  = [],
  stayWindow  = {},
  providers   = ['airbnb'],
  maxListings = 100,
} = {}) {
  const { checkIn, checkOut } = stayWindow;

  const profileMap    = new Map(); // profileId → { profileId, dimensions, propertyIds[] }
  const searchMap     = new Map(); // fingerprint → SearchSummary
  const assignments   = [];
  const invalidProps  = [];

  for (const prop of properties) {
    const propId = prop.id ?? prop.property_id ?? null;

    // Resolve canonical identity fields — accept both DB column names and camelCase
    const profResult = buildMarketProfileIdentity({
      latitude:          prop.latitude,
      longitude:         prop.longitude,
      currency:          prop.currency,
      targetGuests:      prop.targetGuests      ?? prop.max_guests     ?? null,
      targetBedrooms:    prop.targetBedrooms    ?? prop.bedrooms       ?? null,
      targetPropertyType: prop.targetPropertyType ?? prop.property_type ?? null,
    });

    if (!profResult.valid) {
      invalidProps.push({ propertyId: propId, reason: profResult.reason });
      continue;
    }

    const { profileId } = profResult;

    if (!profileMap.has(profileId)) {
      profileMap.set(profileId, {
        profileId,
        dimensions:  profResult.dimensions,
        propertyIds: [],
      });
    }
    profileMap.get(profileId).propertyIds.push(propId);

    const propFingerprints = [];

    for (const provider of providers) {
      const fpResult = buildMarketSearchFingerprint({
        latitude:          prop.latitude,
        longitude:         prop.longitude,
        currency:          prop.currency,
        targetGuests:      prop.targetGuests      ?? prop.max_guests     ?? null,
        targetBedrooms:    prop.targetBedrooms    ?? prop.bedrooms       ?? null,
        targetPropertyType: prop.targetPropertyType ?? prop.property_type ?? null,
        provider,
        checkIn,
        checkOut,
        maxListings,
      });

      if (!fpResult.valid) continue;

      if (!searchMap.has(fpResult.fingerprint)) {
        searchMap.set(fpResult.fingerprint, {
          fingerprint: fpResult.fingerprint,
          profileId,
          provider,
          checkIn,
          checkOut,
          maxListings,
        });
      }
      propFingerprints.push(fpResult.fingerprint);
    }

    assignments.push({
      propertyId:   propId,
      profileId,
      fingerprints: propFingerprints,
    });
  }

  const validCount        = properties.length - invalidProps.length;
  const naiveSearchCount  = validCount * providers.length;
  const actualSearchCount = searchMap.size;
  const searchesSaved     = naiveSearchCount - actualSearchCount;

  return {
    propertyCount:       properties.length,
    profileCount:        profileMap.size,
    profiles:            [...profileMap.values()],
    searches:            [...searchMap.values()],
    propertyAssignments: assignments,
    invalidProperties:   invalidProps,
    deduplication: {
      naiveSearchCount,
      actualSearchCount,
      searchesSaved,
      reductionPct: naiveSearchCount > 0
        ? Math.round((searchesSaved / naiveSearchCount) * 100)
        : 0,
    },
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { planSharedSearches };

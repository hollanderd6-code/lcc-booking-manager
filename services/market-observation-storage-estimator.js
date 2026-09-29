'use strict';
/**
 * P1.2-B5-BK-O14 — Market Observation Storage Estimator
 *
 * Pure module — no DB, no network, no Channex.
 *
 * Estimates the annual order-of-magnitude storage for the market_observations
 * store. Used to verify the architecture remains reasonable at scale before
 * committing to the schema.
 *
 * Key principle: STALE_FOR_PRICING != USELESS_FOR_HISTORY.
 * Observations are never deleted (RETENTION = INDEFINITE), so the estimator
 * projects cumulative annual growth.
 *
 * SAFETY:
 *   DB_WRITES     = 0  always
 *   NETWORK_CALLS = 0  pure function
 */

const WEEKS_PER_YEAR = 52;

/**
 * Estimate annual storage growth for the observation store.
 *
 * @param {object}   opts
 * @param {number}   opts.propertyCount                   — total number of properties
 * @param {number|null} [opts.profileCount]               — distinct market profiles; null = one per property (worst case)
 * @param {number}   [opts.searchWindowsPerWeek=1]        — distinct stay windows collected per week per profile
 * @param {string[]} [opts.providers=['airbnb']]          — provider names
 * @param {number}   [opts.avgComparablesPerObservation=0] — comparable rows per observation (0 = not storing comparables)
 *
 * @returns {StorageEstimate}
 */
function estimateObservationStorage({
  propertyCount                = 0,
  profileCount                 = null,
  searchWindowsPerWeek         = 1,
  providers                    = ['airbnb'],
  avgComparablesPerObservation = 0,
} = {}) {
  const effectiveProfiles = profileCount != null ? profileCount : propertyCount;
  const providerCount     = providers.length;

  // ── Naive (no deduplication): one search per property × provider × window × week
  const naiveObservationsPerYear =
    propertyCount * providerCount * searchWindowsPerWeek * WEEKS_PER_YEAR;

  // ── Deduplicated: one per (profile × provider × window × week)
  const deduplicatedObservationsPerYear =
    effectiveProfiles * providerCount * searchWindowsPerWeek * WEEKS_PER_YEAR;

  // ── Provider observations = deduplicated base (one per provider)
  const providerObservationsPerYear = deduplicatedObservationsPerYear;

  // ── Consensus observations: one per (profile × window × week) regardless of provider count
  const consensusObservationsPerYear =
    effectiveProfiles * searchWindowsPerWeek * WEEKS_PER_YEAR;

  // ── Comparable rows (optional — 0 if not storing individual comparables)
  const estimatedComparableRowsPerYear =
    deduplicatedObservationsPerYear * avgComparablesPerObservation;

  const savedObservationsPerYear = naiveObservationsPerYear - deduplicatedObservationsPerYear;
  const reductionPct = naiveObservationsPerYear > 0
    ? Math.round((savedObservationsPerYear / naiveObservationsPerYear) * 100)
    : 0;

  return {
    inputs: {
      propertyCount,
      profileCount:                effectiveProfiles,
      searchWindowsPerWeek,
      providers,
      avgComparablesPerObservation,
    },
    naiveObservationsPerYear,
    deduplicatedObservationsPerYear,
    providerObservationsPerYear,
    consensusObservationsPerYear,
    estimatedComparableRowsPerYear,
    deduplication: {
      savedObservationsPerYear,
      reductionPct,
    },
    notes: {
      immutable:  'Each row is an immutable historical event. Same fingerprint next week = new row.',
      retention:  'INDEFINITE — STALE_FOR_PRICING != USELESS_FOR_HISTORY',
      comparables: avgComparablesPerObservation === 0
        ? 'Comparable rows not stored (avgComparablesPerObservation=0). Set > 0 to include individual listing storage.'
        : `~${estimatedComparableRowsPerYear.toLocaleString()} comparable rows/year at ${avgComparablesPerObservation} avg per observation.`,
    },
  };
}

module.exports = { estimateObservationStorage };

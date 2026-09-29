'use strict';
/**
 * P1.2-B5-BK-Q — Canonical coordinate validator
 *
 * IMPORTANT: 0 is a VALID coordinate (equator / prime meridian).
 * Do NOT use !lat / !lon — those reject legitimate zero values.
 *
 * Rules:
 *   null / undefined / '' / NaN / non-finite  → invalid
 *   Number in range                            → valid
 *   Numeric string                             → parsed then validated
 *
 * PURE MODULE — no DB, no network, no side effects.
 *   DB_WRITES     = 0
 *   NETWORK_CALLS = 0
 */

/**
 * Returns true only if value is (or parses to) a finite number in [-90, 90].
 * null, undefined, '', NaN, Infinity, and out-of-range all return false.
 * 0 returns true.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidLatitude(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return false;
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

/**
 * Returns true only if value is (or parses to) a finite number in [-180, 180].
 * null, undefined, '', NaN, Infinity, and out-of-range all return false.
 * 0 returns true.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidLongitude(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return false;
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

/**
 * Returns true only if both lat and lon are individually valid.
 *
 * @param {*} lat
 * @param {*} lon
 * @returns {boolean}
 */
function hasValidCoordinates(lat, lon) {
  return isValidLatitude(lat) && isValidLongitude(lon);
}

module.exports = { isValidLatitude, isValidLongitude, hasValidCoordinates };

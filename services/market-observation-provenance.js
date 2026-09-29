'use strict';
/**
 * P1.2-B5-BK-N4 — Market Observation Provenance
 *
 * Pure module — no DB, no network, no Channex.
 *
 * Normalizes and validates the provenance record that MUST accompany each
 * market observation before it can be considered for production use.
 *
 * PROBLEM (identified in M10F): existing market_data rows have no stay-window
 * metadata at the schema level. Without knowing which check-in / check-out /
 * nights was used during scraping, historical anomaly comparisons carry
 * UNKNOWN_WINDOW uncertainty. This module defines the contract that future
 * market_data inserts must satisfy to eliminate that uncertainty.
 *
 * SCHEMA CONTRACT:
 *   Required fields (absent → valid: false, entry in missing[]):
 *     source          — 'airbnb' | 'booking' | 'consensus'
 *     collectedAt     — ISO 8601 timestamp
 *     currency        — 3-letter ISO code
 *     comparableCount — integer ≥ 0
 *     stayWindow      — object with at least one of { checkIn, checkOut, nights }
 *
 *   Recommended fields (absent → warning in warnings[], not invalid):
 *     snapshotCount     — number of Airbnb snapshots used
 *     radiusKm          — geographic collection radius
 *     targetLat/Lon     — property center coordinates
 *     targetGuests      — guest count filter applied
 *     targetBedrooms    — bedroom count filter
 *     targetPropertyType — property type filter
 *     propertyId        — property this observation belongs to
 *
 * SAFETY:
 *   DB_WRITES              = 0  always
 *   PRICING_WRITES         = 0  always
 *   CHANNEX_CALLS          = 0  always
 *   NETWORK_CALLS          = 0  pure function
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_SOURCES = new Set(['airbnb', 'booking', 'consensus']);

const RECOMMENDED_FIELDS = [
  'snapshotCount',
  'radiusKm',
  'targetLat',
  'targetLon',
  'targetGuests',
  'targetBedrooms',
  'targetPropertyType',
  'propertyId',
];

// ── Private helpers ───────────────────────────────────────────────────────────

function _isoCode(str) {
  return typeof str === 'string' && /^[A-Z]{3}$/.test(str);
}

/**
 * Derive stayWindowNights from stayWindow fields.
 * Returns null if derivation not possible.
 */
function _deriveNights(stayWindow) {
  if (!stayWindow) return null;
  if (stayWindow.nights != null) return Number(stayWindow.nights);

  const { checkIn, checkOut } = stayWindow;
  if (!checkIn || !checkOut) return null;

  const msIn  = new Date(checkIn).getTime();
  const msOut = new Date(checkOut).getTime();
  if (!isNaN(msIn) && !isNaN(msOut) && msOut > msIn) {
    return Math.round((msOut - msIn) / 86_400_000);
  }
  return null;
}

/**
 * Validate stayWindow has at least minimal information.
 * Returns null if completely absent or empty.
 */
function _validateStayWindow(stayWindow) {
  if (!stayWindow || typeof stayWindow !== 'object') return null;
  const { checkIn, checkOut, nights } = stayWindow;
  const hasAny = checkIn != null || checkOut != null || nights != null;
  if (!hasAny) return null;
  return stayWindow;
}

// ── normalizeMarketObservationProvenance ──────────────────────────────────────

/**
 * Normalize and validate a market observation provenance record.
 *
 * Returns `valid: false` when required fields are absent or invalid.
 * Returns `valid: true` even when recommended fields are missing — those
 * populate warnings[] but do not block validity.
 *
 * @param {object} opts
 * @param {string}      opts.source            — 'airbnb'|'booking'|'consensus'
 * @param {string}      opts.collectedAt       — ISO timestamp
 * @param {string}      opts.currency          — e.g. 'EUR'
 * @param {number}      opts.comparableCount   — integer ≥ 0
 * @param {object|null} opts.stayWindow        — { checkIn?, checkOut?, nights? }
 * @param {number}      [opts.snapshotCount]   — recommended
 * @param {number}      [opts.radiusKm]        — recommended
 * @param {string}      [opts.propertyId]      — recommended
 * @param {number}      [opts.targetLat]       — recommended
 * @param {number}      [opts.targetLon]       — recommended
 * @param {number}      [opts.targetGuests]    — recommended
 * @param {number}      [opts.targetBedrooms]  — recommended
 * @param {string}      [opts.targetPropertyType] — recommended
 *
 * @returns {{
 *   valid:      boolean,
 *   provenance: ProvenanceRecord | null,
 *   missing:    string[],
 *   warnings:   string[],
 * }}
 */
function normalizeMarketObservationProvenance({
  source          = null,
  collectedAt     = null,
  currency        = null,
  comparableCount = null,
  stayWindow      = null,
  // recommended
  snapshotCount      = null,
  radiusKm           = null,
  propertyId         = null,
  targetLat          = null,
  targetLon          = null,
  targetGuests       = null,
  targetBedrooms     = null,
  targetPropertyType = null,
} = {}) {
  const missing  = [];
  const warnings = [];

  // ── Required: source ──
  if (!VALID_SOURCES.has(source)) {
    missing.push(`source: must be one of ${[...VALID_SOURCES].join('|')}, got: ${JSON.stringify(source)}`);
  }

  // ── Required: collectedAt ──
  let collectedAtMs = null;
  if (!collectedAt) {
    missing.push('collectedAt: required ISO timestamp');
  } else {
    collectedAtMs = new Date(collectedAt).getTime();
    if (isNaN(collectedAtMs)) {
      missing.push(`collectedAt: invalid date "${collectedAt}"`);
      collectedAtMs = null;
    }
  }

  // ── Required: currency ──
  if (!_isoCode(currency)) {
    missing.push(`currency: must be a 3-letter ISO code, got: ${JSON.stringify(currency)}`);
  }

  // ── Required: comparableCount ──
  if (comparableCount == null || !Number.isFinite(Number(comparableCount)) || Number(comparableCount) < 0) {
    missing.push(`comparableCount: required non-negative integer, got: ${JSON.stringify(comparableCount)}`);
  }

  // ── Required: stayWindow ──
  const validWindow = _validateStayWindow(stayWindow);
  if (!validWindow) {
    missing.push('stayWindow: required (at minimum one of checkIn, checkOut, nights)');
  }

  if (missing.length > 0) {
    return { valid: false, provenance: null, missing, warnings };
  }

  // ── Recommended fields ──
  const present = { snapshotCount, radiusKm, propertyId, targetLat, targetLon, targetGuests, targetBedrooms, targetPropertyType };
  for (const field of RECOMMENDED_FIELDS) {
    if (present[field] == null) {
      warnings.push(`${field}: recommended for full provenance — absent increases window uncertainty`);
    }
  }

  // ── Future-date warning ──
  const nowMs = Date.now();
  if (collectedAtMs != null && collectedAtMs > nowMs + 60_000) {
    warnings.push(`collectedAt: future timestamp (${collectedAt}) — verify collection system clock`);
  }

  // ── Derive stayWindowNights ──
  const stayWindowNights = _deriveNights(validWindow);
  if (stayWindowNights == null) {
    warnings.push('stayWindow: nights could not be derived — provide explicit nights or both checkIn and checkOut');
  }

  const provenance = {
    source,
    collectedAt,
    currency,
    comparableCount:    Number(comparableCount),
    stayWindow: {
      checkIn:  validWindow.checkIn  ?? null,
      checkOut: validWindow.checkOut ?? null,
      nights:   stayWindowNights,
    },
    stayWindowNights,
    // recommended fields (may be null)
    snapshotCount:      snapshotCount      != null ? Number(snapshotCount)  : null,
    radiusKm:           radiusKm           != null ? Number(radiusKm)       : null,
    propertyId:         propertyId         ?? null,
    targetLat:          targetLat          != null ? Number(targetLat)      : null,
    targetLon:          targetLon          != null ? Number(targetLon)      : null,
    targetGuests:       targetGuests       != null ? Number(targetGuests)   : null,
    targetBedrooms:     targetBedrooms     != null ? Number(targetBedrooms) : null,
    targetPropertyType: targetPropertyType ?? null,
    // meta
    normalizedAt: new Date().toISOString(),
  };

  return { valid: true, provenance, missing: [], warnings };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  normalizeMarketObservationProvenance,
  VALID_SOURCES,
  RECOMMENDED_FIELDS,
};

'use strict';
/**
 * P1.2-B5-BK-M1 — Snapshot Reuse Policy
 *
 * Pure module — no network, no DB, no Channex.
 *
 * Determines whether a cached snapshot can be reused for a new request.
 * CRITICAL INVARIANT: snapshots from different stay windows are NEVER interchangeable.
 * A fingerprint mismatch (different checkIn/checkOut/location/currency/guests) always
 * returns reuse: false, regardless of how fresh the snapshot is.
 *
 * SAFETY:
 *   DB_WRITES        = 0  always
 *   PRICING_WRITES   = 0  always
 *   CHANNEX_CALLS    = 0  always
 *   NETWORK_CALLS    = 0  pure function
 */

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

// ── buildSnapshotFingerprint ──────────────────────────────────────────────────

/**
 * Build a deterministic fingerprint for a collection request.
 * Two requests with the same fingerprint can share snapshots.
 *
 * @param {object} request
 * @param {string}      request.location
 * @param {string}      request.checkIn      — YYYY-MM-DD
 * @param {string}      request.checkOut     — YYYY-MM-DD
 * @param {string}      request.currency     — ISO 4217
 * @param {number|null} [request.targetGuests]
 * @returns {string}
 */
function buildSnapshotFingerprint(request) {
  return JSON.stringify({
    location:     (request.location     || '').trim().toLowerCase(),
    checkIn:      request.checkIn       || '',
    checkOut:     request.checkOut      || '',
    currency:     (request.currency     || '').toUpperCase(),
    targetGuests: request.targetGuests  ?? null,
  });
}

// ── shouldReuseSnapshot ───────────────────────────────────────────────────────

/**
 * Determine whether a cached snapshot satisfies a collection request.
 *
 * @param {object|null} snapshot     — cached snapshot (must contain fingerprint data)
 * @param {object}      request      — current collection request
 * @param {number}      [request.maxAgeMs]  — override default 24 h max age
 *
 * @returns {{ reuse: boolean, reason: string|null }}
 */
function shouldReuseSnapshot(snapshot, request) {
  if (!snapshot) {
    return { reuse: false, reason: 'no_snapshot' };
  }

  // Fingerprint check — NEVER skip this, even for fresh snapshots
  const requestFp  = buildSnapshotFingerprint(request);
  const snapshotFp = snapshot.fingerprint || buildSnapshotFingerprint(snapshot);
  if (requestFp !== snapshotFp) {
    return { reuse: false, reason: 'fingerprint_mismatch' };
  }

  // Age check
  if (snapshot.createdAt) {
    const maxAgeMs = request.maxAgeMs != null ? request.maxAgeMs : DEFAULT_MAX_AGE_MS;
    const ageMs    = Date.now() - new Date(snapshot.createdAt).getTime();
    if (ageMs > maxAgeMs) {
      const ageMin = Math.round(ageMs / 1000 / 60);
      return { reuse: false, reason: `snapshot_too_old (${ageMin} min)` };
    }
  }

  return { reuse: true, reason: null };
}

module.exports = {
  buildSnapshotFingerprint,
  shouldReuseSnapshot,
  DEFAULT_MAX_AGE_MS,
};

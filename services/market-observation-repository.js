'use strict';
/**
 * P1.2-B5-BK-O16 — Market Observation Repository
 *
 * Provides the DB interface for the new O-schema tables:
 *   market_observations
 *   market_observation_properties
 *   market_profiles
 *   market_profile_properties
 *
 * SAFETY:
 *   PRODUCTION_CALLERS = 0  — not connected to any cron or production route in O
 *   DB_WRITES go to new O-schema tables ONLY — market_data is never touched
 *   PRICING_WRITES = 0  always
 *   CHANNEX_CALLS  = 0  always
 *   SAFE_TO_ACTIVATE_PRODUCTION = NO
 *
 * INJECTABLE POOL:
 *   All functions accept a `pool` parameter. Pass a mock for tests.
 *   No module-level pool import — fully testable without a real DB.
 *
 * IDEMPOTENCY:
 *   createObservation() checks (collection_run_id, search_fingerprint) before
 *   inserting. Same retry → same observation_id, created: false.
 *   Different collection_run_id same fingerprint → new observation (historical).
 */

// ── createObservation ─────────────────────────────────────────────────────────

/**
 * Save a new immutable market observation.
 *
 * Returns { observation_id, created: true } on new insert.
 * Returns { observation_id, created: false } if this (collection_run_id, fingerprint)
 * was already recorded (idempotent retry).
 *
 * @param {object} pool    — pg Pool (or in-memory mock)
 * @param {object} obs     — observation data
 * @returns {Promise<{ observation_id: string, created: boolean }>}
 */
async function createObservation(pool, obs) {
  // Idempotency guard: same run + same fingerprint → return existing
  if (obs.collection_run_id && obs.search_fingerprint) {
    const check = await pool.query(
      `SELECT observation_id FROM market_observations
       WHERE collection_run_id = $1 AND search_fingerprint = $2 LIMIT 1`,
      [obs.collection_run_id, obs.search_fingerprint]
    );
    if (check.rows.length > 0) {
      return { observation_id: check.rows[0].observation_id, created: false };
    }
  }

  const result = await pool.query(
    `INSERT INTO market_observations (
       schema_version, provider, observation_type, provider_snapshot_id, data_source,
       collected_at, search_fingerprint, market_profile_id, currency,
       check_in, check_out, nights,
       target_lat, target_lon, target_guests, target_bedrooms, target_property_type,
       requested_max_listings, raw_count, accepted_count, comparable_count, selected_radius_km,
       median_price, p25_price, p75_price, min_price, max_price,
       quality_status, confidence, reliability_status,
       algorithm_version, source_observation_ids,
       collection_run_id, provenance
     ) VALUES (
       $1,$2,$3,$4,$5, $6,$7,$8,$9, $10,$11,$12, $13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22, $23,$24,$25,$26,$27, $28,$29,$30, $31,$32, $33,$34
     ) RETURNING observation_id`,
    [
      obs.schema_version          ?? 1,
      obs.provider,
      obs.observation_type        ?? 'PROVIDER',
      obs.provider_snapshot_id    ?? null,
      obs.data_source             ?? null,
      obs.collected_at,
      obs.search_fingerprint,
      obs.market_profile_id       ?? null,
      obs.currency,
      obs.check_in                ?? null,
      obs.check_out               ?? null,
      obs.nights                  ?? null,
      obs.target_lat              ?? null,
      obs.target_lon              ?? null,
      obs.target_guests           ?? null,
      obs.target_bedrooms         ?? null,
      obs.target_property_type    ?? null,
      obs.requested_max_listings  ?? null,
      obs.raw_count               ?? null,
      obs.accepted_count          ?? null,
      obs.comparable_count        ?? null,
      obs.selected_radius_km      ?? null,
      obs.median_price            ?? null,
      obs.p25_price               ?? null,
      obs.p75_price               ?? null,
      obs.min_price               ?? null,
      obs.max_price               ?? null,
      obs.quality_status          ?? null,
      obs.confidence              ?? null,
      obs.reliability_status      ?? null,
      obs.algorithm_version       ?? null,
      obs.source_observation_ids  ?? null,
      obs.collection_run_id       ?? null,
      obs.provenance              ?? {},
    ]
  );

  return { observation_id: result.rows[0].observation_id, created: true };
}

// ── attachObservationToProperties ─────────────────────────────────────────────

/**
 * Link one observation to one or more properties.
 *
 * Multiple properties that shared the same search point to the same
 * observation_id. The observation itself is stored once.
 *
 * @param {object}   pool
 * @param {string}   observation_id
 * @param {Array}    propertyLinks   — [{ property_id, user_id?, profile_id?, assignment_reason? }]
 */
async function attachObservationToProperties(pool, observation_id, propertyLinks) {
  for (const link of propertyLinks) {
    await pool.query(
      `INSERT INTO market_observation_properties
         (observation_id, property_id, user_id, profile_id, assignment_reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (observation_id, property_id) DO NOTHING`,
      [
        observation_id,
        link.property_id,
        link.user_id           ?? null,
        link.profile_id        ?? null,
        link.assignment_reason ?? 'shared_search',
      ]
    );
  }
}

// ── upsertMarketProfile ───────────────────────────────────────────────────────

/**
 * Ensure a market_profiles row exists for the given profileId.
 * Insert if new; no-op if already present.
 *
 * @param {object} pool
 * @param {string} profileId    — from buildMarketProfileIdentity()
 * @param {object} dimensions   — profile dimensions object
 */
async function upsertMarketProfile(pool, profileId, dimensions) {
  await pool.query(
    `INSERT INTO market_profiles
       (profile_id, schema_version, geo_lat, geo_lon, currency,
        target_guests, target_bedrooms, target_property_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (profile_id) DO NOTHING`,
    [
      profileId,
      dimensions.v,
      dimensions.lat,
      dimensions.lon,
      dimensions.currency,
      dimensions.guests   ?? null,
      dimensions.bedrooms ?? null,
      dimensions.propType,
    ]
  );
}

// ── findReusableObservation ───────────────────────────────────────────────────

/**
 * Find the most recent observation for a search fingerprint within maxAgeMs.
 * Used for cache/reuse decisions — read-only.
 *
 * Different stay window, currency, or provider = different fingerprint → never
 * returned here (the fingerprint encodes all of those dimensions).
 *
 * @param {object}  pool
 * @param {string}  search_fingerprint
 * @param {object}  [opts]
 * @param {number}    [opts.maxAgeMs=86400000]  — default 24 h
 * @returns {Promise<object|null>}
 */
async function findReusableObservation(pool, search_fingerprint, opts = {}) {
  const maxAgeMs = opts.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const cutoff   = new Date(Date.now() - maxAgeMs).toISOString();

  const result = await pool.query(
    `SELECT * FROM market_observations
     WHERE search_fingerprint = $1
       AND collected_at >= $2
     ORDER BY collected_at DESC
     LIMIT 1`,
    [search_fingerprint, cutoff]
  );
  return result.rows[0] ?? null;
}

// ── getObservationHistory ─────────────────────────────────────────────────────

/**
 * Retrieve historical observations for a market profile.
 *
 * Supports the long-term read model (O12):
 *   - Year-over-year comparison (pass fromDate/toDate)
 *   - Lead-time analysis (multiple collected_at per check_in)
 *   - Provider comparison (filter by provider)
 *
 * @param {object}  pool
 * @param {string}  market_profile_id
 * @param {object}  [opts]
 * @param {string}    [opts.provider]   — filter to one provider
 * @param {string}    [opts.fromDate]   — ISO lower bound on collected_at
 * @param {string}    [opts.toDate]     — ISO upper bound on collected_at
 * @param {string}    [opts.checkIn]    — filter to specific stay date
 * @param {number}    [opts.limit=100]
 * @returns {Promise<object[]>}  — sorted collected_at DESC
 */
async function getObservationHistory(pool, market_profile_id, opts = {}) {
  const params  = [market_profile_id];
  const clauses = ['market_profile_id = $1'];

  if (opts.provider) {
    params.push(opts.provider);
    clauses.push(`provider = $${params.length}`);
  }
  if (opts.fromDate) {
    params.push(opts.fromDate);
    clauses.push(`collected_at >= $${params.length}`);
  }
  if (opts.toDate) {
    params.push(opts.toDate);
    clauses.push(`collected_at <= $${params.length}`);
  }
  if (opts.checkIn) {
    params.push(opts.checkIn);
    clauses.push(`check_in = $${params.length}`);
  }

  params.push(opts.limit ?? 100);

  const result = await pool.query(
    `SELECT * FROM market_observations
     WHERE ${clauses.join(' AND ')}
     ORDER BY collected_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createObservation,
  attachObservationToProperties,
  upsertMarketProfile,
  findReusableObservation,
  getObservationHistory,
};

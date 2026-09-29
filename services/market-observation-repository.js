'use strict';
/**
 * P1.2-B5-BK-O16 — Market Observation Repository
 *
 * Provides the DB interface for the new O-schema tables:
 *   market_observations
 *   market_observation_sources
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
 * Note: source observation links for DERIVED_CONSENSUS rows are stored separately
 * via insertSourceLinks(). Pass sourceLinks to createObservationComplete() to
 * insert them atomically in the same transaction.
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
       algorithm_version,
       collection_run_id, provenance
     ) VALUES (
       $1,$2,$3,$4,$5, $6,$7,$8,$9, $10,$11,$12, $13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22, $23,$24,$25,$26,$27, $28,$29,$30, $31, $32,$33
     ) RETURNING observation_id`,
    [
      obs.schema_version          ?? 1,           // $1
      obs.provider,                               // $2
      obs.observation_type        ?? 'PROVIDER',  // $3
      obs.provider_snapshot_id    ?? null,        // $4
      obs.data_source             ?? null,        // $5
      obs.collected_at,                           // $6
      obs.search_fingerprint,                     // $7
      obs.market_profile_id       ?? null,        // $8
      obs.currency,                               // $9
      obs.check_in                ?? null,        // $10
      obs.check_out               ?? null,        // $11
      obs.nights                  ?? null,        // $12
      obs.target_lat              ?? null,        // $13
      obs.target_lon              ?? null,        // $14
      obs.target_guests           ?? null,        // $15
      obs.target_bedrooms         ?? null,        // $16
      obs.target_property_type    ?? null,        // $17
      obs.requested_max_listings  ?? null,        // $18
      obs.raw_count               ?? null,        // $19
      obs.accepted_count          ?? null,        // $20
      obs.comparable_count        ?? null,        // $21
      obs.selected_radius_km      ?? null,        // $22
      obs.median_price            ?? null,        // $23
      obs.p25_price               ?? null,        // $24
      obs.p75_price               ?? null,        // $25
      obs.min_price               ?? null,        // $26
      obs.max_price               ?? null,        // $27
      obs.quality_status          ?? null,        // $28
      obs.confidence              ?? null,        // $29
      obs.reliability_status      ?? null,        // $30
      obs.algorithm_version       ?? null,        // $31
      obs.collection_run_id       ?? null,        // $32
      obs.provenance              ?? {},          // $33
    ]
  );

  return { observation_id: result.rows[0].observation_id, created: true };
}

// ── insertSourceLinks ─────────────────────────────────────────────────────────

/**
 * Record provenance links for a DERIVED_CONSENSUS observation.
 *
 * Replaces the former unsafe source_observation_ids UUID[] column with proper
 * FK-enforced rows in market_observation_sources.
 * Each link: derivedObservationId was built from sourceObservationId.
 * Idempotent: ON CONFLICT DO NOTHING.
 *
 * @param {object}   pool
 * @param {string}   derivedObservationId
 * @param {string[]} sourceObservationIds
 */
async function insertSourceLinks(pool, derivedObservationId, sourceObservationIds) {
  for (const sourceId of sourceObservationIds) {
    await pool.query(
      `INSERT INTO market_observation_sources
         (derived_observation_id, source_observation_id)
       VALUES ($1, $2)
       ON CONFLICT (derived_observation_id, source_observation_id) DO NOTHING`,
      [derivedObservationId, sourceId]
    );
  }
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

// ── createObservationComplete ─────────────────────────────────────────────────

/**
 * Atomically insert an observation with all its related rows in one transaction.
 *
 * Wraps createObservation + insertSourceLinks + attachObservationToProperties
 * + comparable inserts. On retry (same run+fingerprint) the idempotency guard
 * returns early — related tables are not re-touched.
 *
 * @param {object}  pool
 * @param {object}  opts
 * @param {object}    opts.observation      — observation data (passed to createObservation)
 * @param {Array}     [opts.propertyLinks]  — passed to attachObservationToProperties
 * @param {Array}     [opts.comparables]    — [{ provider_listing_id, nightly_price, ... }]
 * @param {string[]}  [opts.sourceLinks]    — source observation UUIDs (DERIVED_CONSENSUS only)
 * @returns {Promise<{ observation_id: string, created: boolean }>}
 */
async function createObservationComplete(pool, {
  observation,
  propertyLinks = [],
  comparables   = [],
  sourceLinks   = [],
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await createObservation(client, observation);

    if (result.created) {
      if (sourceLinks.length > 0) {
        await insertSourceLinks(client, result.observation_id, sourceLinks);
      }

      if (propertyLinks.length > 0) {
        await attachObservationToProperties(client, result.observation_id, propertyLinks);
      }

      for (const comp of comparables) {
        await client.query(
          `INSERT INTO market_observation_comparables
             (observation_id, provider_listing_id, provider, latitude, longitude,
              distance_km, nightly_price, currency, guests_capacity, bedrooms,
              property_type, rating, review_count, availability_signal, normalization_meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (observation_id, provider, provider_listing_id)
             WHERE provider_listing_id IS NOT NULL
           DO NOTHING`,
          [
            result.observation_id,
            comp.provider_listing_id    ?? null,
            comp.provider               ?? null,
            comp.latitude               ?? null,
            comp.longitude              ?? null,
            comp.distance_km            ?? null,
            comp.nightly_price          ?? null,
            comp.currency               ?? null,
            comp.guests_capacity        ?? null,
            comp.bedrooms               ?? null,
            comp.property_type          ?? null,
            comp.rating                 ?? null,
            comp.review_count           ?? null,
            comp.availability_signal    ?? null,
            comp.normalization_meta     ?? null,
          ]
        );
      }
    }

    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── findReusableObservation ───────────────────────────────────────────────────

// Max allowable clock skew for collected_at. Observations with collected_at
// more than this far in the future are rejected (fail-closed on bogus timestamps).
const REUSE_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 min

/**
 * Find the most recent observation for a search fingerprint within maxAgeMs.
 * Used for cache/reuse decisions — read-only.
 *
 * Different stay window, currency, or provider = different fingerprint → never
 * returned here (the fingerprint encodes all of those dimensions).
 *
 * TTL boundary: age == maxAgeMs is inclusive (collected_at == cutoff → reusable).
 * Future timestamps: collected_at > now + REUSE_CLOCK_SKEW_MS → rejected (fail closed).
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
  const future   = new Date(Date.now() + REUSE_CLOCK_SKEW_MS).toISOString();

  const result = await pool.query(
    `SELECT * FROM market_observations
     WHERE search_fingerprint = $1
       AND collected_at >= $2
       AND collected_at <= $3
     ORDER BY collected_at DESC
     LIMIT 1`,
    [search_fingerprint, cutoff, future]
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

// ── assignCurrentProfile ──────────────────────────────────────────────────────

/**
 * P1.2-B5-BK-P2 — Set the CURRENT market profile for a property.
 *
 * market_profile_properties stores the current (active) profile mapping.
 * If the property already has a profile, it is replaced (profile dimensions changed).
 * Historical attribution is preserved separately in market_observation_properties.
 *
 * Idempotent: re-assigning the same profileId to the same propertyId is a no-op.
 *
 * @param {object} pool
 * @param {string} profileId    — from buildMarketProfileIdentity()
 * @param {string} propertyId
 * @param {string|null} [userId]
 */
async function assignCurrentProfile(pool, profileId, propertyId, userId = null) {
  await pool.query(
    `INSERT INTO market_profile_properties (profile_id, property_id, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (property_id) DO UPDATE SET
       profile_id  = EXCLUDED.profile_id,
       user_id     = COALESCE(EXCLUDED.user_id, market_profile_properties.user_id),
       assigned_at = NOW()`,
    [profileId, propertyId, userId]
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createObservation,
  insertSourceLinks,
  attachObservationToProperties,
  upsertMarketProfile,
  assignCurrentProfile,
  createObservationComplete,
  findReusableObservation,
  getObservationHistory,
};

'use strict';
/**
 * P1.5-T1 — Price Observation Persistence
 *
 * Captures Boostinghost's canonical effective pricing state per (property, stay_date)
 * as an append-only historical record.
 *
 * SEMANTICS:
 *   An observation means: "At observed_at T, the canonical effective pricing state
 *   for property P / stay_date D was X."
 *   It does NOT mean: guest exposure, OTA publication, or confirmed sellability.
 *
 * SAFETY:
 *   READ_ONLY_FROM_PRICING       = YES (no pricing engine reads this table)
 *   PRICE_OBSERVATION_HAS_PRICING_AUTHORITY = NO
 *   PRODUCTION_PRICING_CHANGED   = NO
 *   DB_WRITES_WHEN_FLAG_OFF      = 0
 *
 * FEATURE FLAG:
 *   process.env.PRICE_OBSERVATION_PERSISTENCE_ENABLED === 'true'
 *   Default: FALSE — zero writes, zero overhead.
 *
 * FAILURE CONTRACT:
 *   PRICE_OBSERVATION_FAILURE_BLOCKS_PRICING = NO
 *   All errors are caught and logged. Never rethrown to caller.
 *
 * TIMEOUT:
 *   OBSERVATION_TOTAL_TIMEOUT_MS = 5000
 *   A dedicated pool client is acquired for all observation queries.
 *   SET statement_timeout = OBSERVATION_TOTAL_TIMEOUT_MS bounds each individual query.
 *   Promise.race with a 5s deadline ensures the publisher never awaits more than
 *   OBSERVATION_TOTAL_TIMEOUT_MS for this feature.
 *   On timeout: dedicated client is destroyed (release(err)) — no session state leak
 *   to pool; in-flight query is terminated at the TCP level.
 *   Note: pool.connect() is outside the race, bounded by pool's connectionTimeoutMillis.
 *   WHOLE_OPERATION_BOUNDED = PARTIAL (connect step outside race)
 *   WORST_CASE_OBSERVATION_DELAY_MS = 5000ms (after client acquired)
 *
 * OBSERVATION_DATE_SEMANTICS:
 *   observation_date = calendar date at observed_at in the property's IANA timezone
 *   (properties.timezone). Falls back to UTC when timezone is null or invalid.
 *   observed_at (TIMESTAMPTZ) remains the canonical UTC anchor — unchanged.
 *
 * DEDUP:
 *   Within a 4-hour window per (property_id, stay_date), observations with
 *   identical state_fingerprint are skipped. State changes always produce a
 *   new row. Multiple legitimate intraday changes survive (A→B→A preserved).
 *
 * Usage (called from pricing-publisher _doPublish after resolve, before push):
 *   await observePricingState(pool, { propertyId, prop, nights, context });
 */

const { propertyLocalDate } = require('./local-seasonality-helpers');

const SCHEMA_VERSION         = '1';
const FLAG_NAME              = 'PRICE_OBSERVATION_PERSISTENCE_ENABLED';
const DEDUP_WINDOW_MS        = 4 * 60 * 60 * 1000; // 4 hours
const OBSERVATION_TIMEOUT_MS = 5000;               // whole-op deadline (ms)

// ── Feature flag ─────────────────────────────────────────────────────────────

function isFlagEnabled() {
  return process.env[FLAG_NAME] === 'true';
}

// ── Fingerprint ───────────────────────────────────────────────────────────────
//
// Deterministic string over the effective pricing state fields.
// MUST exclude observed_at and any volatile temporal identifier.
// Stable: same state always produces same fingerprint.
// observation_date intentionally excluded — timezone/date rollover must NOT
// create a spurious pricing-state change.

function computeFingerprint({
  canonical_price,
  currency,
  price_source,
  min_stay_arrival,
  min_stay_through,
  stop_sell,
  manual_override_present,
  boostprice_present,
  external_pricing,
}) {
  return [
    canonical_price != null ? String(canonical_price) : 'null',
    currency         != null ? String(currency)        : 'null',
    String(price_source),
    String(min_stay_arrival),
    String(min_stay_through),
    String(!!stop_sell),
    String(!!manual_override_present),
    String(!!boostprice_present),
    String(!!external_pricing),
  ].join('|');
}

// ── Record builder ────────────────────────────────────────────────────────────
//
// Converts one resolved night + enrichment into a price_observations row.
// Pure function — no I/O.

function buildObservationRecord(night, {
  propertyId,
  currency,
  currencyProvenance,
  propertyTimezone,
  externalPricing,
  publisherRunId,
  observedAt,   // Date object
}) {
  const observedAtDate  = observedAt instanceof Date ? observedAt : new Date(observedAt);
  const observedAtIso   = observedAtDate.toISOString();
  // observation_date: property-local calendar date at observed_at.
  // Uses IANA timezone from properties.timezone; falls back to UTC when null/invalid.
  const observationDate = propertyLocalDate(observedAtDate, propertyTimezone);

  const source = night.source || 'none';
  const manualOverridePresent = (source === 'manual_override');
  const boostpricePresent     = (source === 'boostprice');

  const minStayArrival = (night.minStayArrival != null && night.minStayArrival >= 1)
    ? night.minStayArrival : 1;
  const minStayThrough = (night.minStayThrough != null && night.minStayThrough >= 1)
    ? night.minStayThrough : 1;

  // lead_days: integer days from observation to stay date (forward-looking = positive)
  let leadDays = null;
  if (night.date && observationDate) {
    const ms = new Date(night.date + 'T12:00:00Z') - new Date(observationDate + 'T12:00:00Z');
    leadDays = Math.round(ms / (24 * 3600 * 1000));
    if (leadDays < 0) leadDays = null; // past stay dates — don't store negative lead
  }

  const fingerprint = computeFingerprint({
    canonical_price:        night.price,
    currency,
    price_source:           source,
    min_stay_arrival:       minStayArrival,
    min_stay_through:       minStayThrough,
    stop_sell:              !!night.stopSell,
    manual_override_present: manualOverridePresent,
    boostprice_present:     boostpricePresent,
    external_pricing:       !!externalPricing,
  });

  return {
    property_id:             propertyId,
    stay_date:               night.date,
    observed_at:             observedAtIso,
    observation_date:        observationDate,
    property_timezone:       propertyTimezone || null,
    schema_version:          SCHEMA_VERSION,
    canonical_price:         night.price,
    currency:                currency || null,
    currency_provenance:     currencyProvenance || 'unknown',
    price_source:            source,
    price_source_id:         night.sourceId || null,
    min_stay_arrival:        minStayArrival,
    min_stay_through:        minStayThrough,
    min_stay_source:         night.minStaySource || null,
    stop_sell:               !!night.stopSell,
    stop_sell_source:        night.stopSellSource || null,
    manual_override_present: manualOverridePresent,
    boostprice_present:      boostpricePresent,
    external_pricing:        !!externalPricing,
    lead_days:               leadDays,
    publisher_run_id:        publisherRunId || null,
    state_fingerprint:       fingerprint,
    // publication_state uses DB DEFAULT 'RESOLVED'
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────
// Accept a pool OR PoolClient as first arg — both expose .query().

async function fetchPropertyEnrichment(poolOrClient, propertyId) {
  try {
    const res = await poolOrClient.query(
      `SELECT currency, timezone FROM properties WHERE id = $1`,
      [propertyId]
    );
    return res.rows[0] || {};
  } catch (err) {
    console.error(`[PRICE-OBS] fetchPropertyEnrichment failed (${propertyId}):`, err.message);
    return {};
  }
}

// Returns Map<stay_date_string, { fingerprint, observed_at }> for the most
// recent observation per stay_date within the dedup window.
async function fetchLastFingerprints(poolOrClient, propertyId, stayDates, windowMs) {
  if (!stayDates || !stayDates.length) return new Map();
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  try {
    const res = await poolOrClient.query(
      `SELECT DISTINCT ON (stay_date)
         TO_CHAR(stay_date, 'YYYY-MM-DD') AS stay_date,
         state_fingerprint,
         observed_at
       FROM price_observations
       WHERE property_id = $1
         AND stay_date = ANY($2::date[])
         AND observed_at >= $3
       ORDER BY stay_date, observed_at DESC`,
      [propertyId, stayDates, cutoff]
    );
    const map = new Map();
    for (const row of res.rows) {
      map.set(row.stay_date, {
        fingerprint: row.state_fingerprint,
        observed_at: row.observed_at,
      });
    }
    return map;
  } catch (err) {
    // Table may not exist yet (migration not applied) — fail open: return empty map
    // so the service inserts all observations rather than silently dropping them.
    if (!err.message || !err.message.includes('price_observations')) {
      console.error(`[PRICE-OBS] fetchLastFingerprints failed (${propertyId}):`, err.message);
    }
    return new Map();
  }
}

// Batch insert into price_observations. Returns rowCount inserted.
// Silently handles "relation does not exist" (migration not yet applied).
async function insertObservations(poolOrClient, rows) {
  if (!rows || !rows.length) return 0;
  const N_FIELDS = 22;
  const CHUNK    = 200;
  let inserted   = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice  = rows.slice(i, i + CHUNK);
    const vals   = [];
    const params = [];

    slice.forEach((r, k) => {
      const b = k * N_FIELDS;
      vals.push(`(${Array.from({ length: N_FIELDS }, (_, j) => `$${b + j + 1}`).join(',')})`);
      params.push(
        r.property_id,
        r.stay_date,
        r.observed_at,
        r.observation_date,
        r.property_timezone,
        r.schema_version,
        r.canonical_price,
        r.currency,
        r.currency_provenance,
        r.price_source,
        r.price_source_id,
        r.min_stay_arrival,
        r.min_stay_through,
        r.min_stay_source,
        r.stop_sell,
        r.stop_sell_source,
        r.manual_override_present,
        r.boostprice_present,
        r.external_pricing,
        r.lead_days,
        r.publisher_run_id,
        r.state_fingerprint
      );
    });

    try {
      const res = await poolOrClient.query(
        `INSERT INTO price_observations (
           property_id, stay_date, observed_at, observation_date, property_timezone,
           schema_version, canonical_price, currency, currency_provenance, price_source,
           price_source_id, min_stay_arrival, min_stay_through, min_stay_source,
           stop_sell, stop_sell_source, manual_override_present, boostprice_present,
           external_pricing, lead_days, publisher_run_id, state_fingerprint
         ) VALUES ${vals.join(',')}`,
        params
      );
      inserted += res.rowCount || 0;
    } catch (err) {
      console.error(`[PRICE-OBS] insertObservations failed (${slice.length} rows):`, err.message);
      // Don't rethrow — PRICE_OBSERVATION_FAILURE_BLOCKS_PRICING = NO
    }
  }

  return inserted;
}

// ── Core observation logic ────────────────────────────────────────────────────
//
// Runs on a dedicated client (with statement_timeout pre-applied).
// Called via _runWithTimeout — never invoked directly in production.
// Exported for unit testing only (allows direct testing without the client lifecycle).

async function _observeCore(client, { propertyId, prop, nights, context }) {
  const observedAt = new Date();

  const enrichment      = await fetchPropertyEnrichment(client, propertyId);
  const currency        = enrichment.currency  || null;
  const currencyProv    = enrichment.currency  ? 'property_record' : 'unknown';
  const propertyTimezone = enrichment.timezone || null;
  const externalPricing  = !!(prop && prop.external_pricing);

  const publisherRunId = context.publisherRunId || null;

  const candidates = nights.map(night =>
    buildObservationRecord(night, {
      propertyId,
      currency,
      currencyProvenance: currencyProv,
      propertyTimezone,
      externalPricing,
      publisherRunId,
      observedAt,
    })
  );

  const stayDates = candidates.map(c => c.stay_date);
  const recentFPs = await fetchLastFingerprints(client, propertyId, stayDates, DEDUP_WINDOW_MS);
  const toInsert  = candidates.filter(c => {
    const recent = recentFPs.get(c.stay_date);
    return !recent || recent.fingerprint !== c.state_fingerprint;
  });

  const inserted = await insertObservations(client, toInsert);
  const skipped  = candidates.length - toInsert.length;

  if (inserted > 0 || skipped > 0) {
    console.log(`[PRICE-OBS] ${propertyId} — inserted:${inserted} dedup_skipped:${skipped}`);
  }

  return { inserted, skipped };
}

// ── Timeout-bounded execution ─────────────────────────────────────────────────
//
// Acquires a dedicated pool client, applies per-query statement_timeout,
// then races the work against a whole-operation deadline.
//
// On normal completion:
//   - SET statement_timeout = DEFAULT to reset session state
//   - client.release() returns client to pool cleanly
// On timeout:
//   - client.release(err) destroys the connection; pg server terminates
//     the in-flight query when it sees the closed TCP connection.
//   - No session state leaks to the next pool borrower.
// On reset failure:
//   - client.release(resetErr) destroys the connection.
//
// Note: pool.connect() is OUTSIDE the race. In production the pool has
// connectionTimeoutMillis=5000, bounding it independently.
//
// WHOLE_OPERATION_BOUNDED = PARTIAL (pool.connect outside race)
// WORST_CASE_OBSERVATION_DELAY_MS = 5000ms (after client acquired)
//
// Exported for unit testing with custom timeoutMs values.

async function _runWithTimeout(pool, workFn, timeoutMs) {
  // Acquire dedicated client (bounded by pool's connectionTimeoutMillis in production)
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return { inserted: 0, skipped: 0, error: `connect_failed: ${e.message}` };
  }

  // Set per-query statement_timeout on this client's session
  try {
    await client.query(`SET statement_timeout = ${timeoutMs}`);
  } catch (e) {
    client.release(e);
    return { inserted: 0, skipped: 0, error: `set_timeout_failed: ${e.message}` };
  }

  let timedOut = false;
  let timeoutHandle;

  const timeoutPromise = new Promise(resolve => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      resolve({ inserted: 0, skipped: 0, error: 'PRICE_OBS_TIMEOUT' });
    }, timeoutMs);
  });

  let result;
  try {
    result = await Promise.race([
      workFn(client).catch(e => ({ inserted: 0, skipped: 0, error: e.message })),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutHandle);
    if (timedOut) {
      // Destroy connection — terminates in-flight query at TCP level, no session leak
      client.release(new Error('[PRICE-OBS] timeout — destroy client'));
    } else {
      // Reset statement_timeout before returning client to pool
      try {
        await client.query('SET statement_timeout = DEFAULT');
        client.release();
      } catch (resetErr) {
        client.release(resetErr); // destroy on reset failure
      }
    }
  }

  return result;
}

// ── Main entry point ──────────────────────────────────────────────────────────
//
// Called from pricing-publisher _doPublish after resolveEffectivePrices,
// before Channex push. Failure NEVER propagates to caller.

async function observePricingState(pool, { propertyId, prop, nights, context = {} }) {
  if (!isFlagEnabled()) {
    return { inserted: 0, skipped: nights ? nights.length : 0, reason: 'flag_disabled' };
  }

  if (!nights || nights.length === 0) {
    return { inserted: 0, skipped: 0, reason: 'no_nights' };
  }

  try {
    const result = await _runWithTimeout(
      pool,
      (client) => _observeCore(client, { propertyId, prop, nights, context }),
      OBSERVATION_TIMEOUT_MS
    );
    if (result.error === 'PRICE_OBS_TIMEOUT') {
      console.error(
        `[PRICE-OBS] observation timeout (${propertyId}): exceeded ${OBSERVATION_TIMEOUT_MS}ms` +
        ` — Channex publication continues`
      );
    }
    return result;
  } catch (err) {
    console.error(`[PRICE-OBS] observePricingState unexpected error (${propertyId}):`, err.message);
    return { inserted: 0, skipped: nights.length, error: err.message };
  }
}

module.exports = {
  observePricingState,
  computeFingerprint,
  buildObservationRecord,
  isFlagEnabled,
  fetchLastFingerprints,
  insertObservations,
  SCHEMA_VERSION,
  FLAG_NAME,
  DEDUP_WINDOW_MS,
  OBSERVATION_TIMEOUT_MS,
  // Internal — exported for unit testing only
  _runWithTimeout,
  _observeCore,
};

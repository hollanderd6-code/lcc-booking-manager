'use strict';
/**
 * P1.5-T2.1 — Booking Event Persistence
 *
 * Appends immutable BOOKING_CREATED / BOOKING_MODIFIED / BOOKING_CANCELLED
 * events to booking_events for observational demand analysis.
 *
 * SEMANTICS:
 *   An event means: "At created_at T, reservation lifecycle event E was observed
 *   for source S / external_booking_id X on property P."
 *   It does NOT grant pricing, pickup, or reservation authority.
 *
 * SAFETY:
 *   BOOKING_EVENTS_HAVE_PRICING_AUTHORITY    = NO
 *   BOOKING_EVENTS_HAVE_PICKUP_AUTHORITY     = NO
 *   PRODUCTION_RESERVATION_SEMANTICS_CHANGED = NO
 *   DB_WRITES_WHEN_FLAG_OFF                  = 0
 *
 * FEATURE FLAG:
 *   process.env.BOOKING_EVENT_PERSISTENCE_ENABLED === 'true'
 *   Default: FALSE — zero DB access, zero overhead.
 *
 * FAILURE CONTRACT:
 *   BOOKING_EVENT_FAILURE_BLOCKS_RESERVATIONS = NO
 *   All errors are caught and logged. Never rethrown to caller.
 *   Transaction ordering: reservation write succeeds first; event appended
 *   after on a separate pool connection. Event failure cannot roll back
 *   reservation state.
 *
 * TIMEOUT:
 *   BOOKING_EVENT_DB_TIMEOUT_MS = 5000
 *   A dedicated pool client is acquired for all event queries.
 *   SET statement_timeout bounds each individual query on that session.
 *   Promise.race with a 5s deadline ensures the webhook handler never
 *   awaits more than BOOKING_EVENT_DB_TIMEOUT_MS for this feature.
 *   On timeout: dedicated client is destroyed — no session state leak.
 *
 * APPEND-ONLY:
 *   NEVER UPDATE or DELETE booking_events rows.
 *
 * IDEMPOTENCY:
 *   CREATED:   skip if any BOOKING_CREATED exists for (source, external_booking_id)
 *   MODIFIED:  skip if latest state_fingerprint matches current state
 *   CANCELLED: skip if latest event_type is BOOKING_CANCELLED
 *
 * A→B→A PRESERVATION:
 *   MODIFIED compares against LATEST event fingerprint only.
 *   If state returns to a prior value, a new event is recorded.
 */

const FLAG_NAME                = 'BOOKING_EVENT_PERSISTENCE_ENABLED';
const BOOKING_EVENT_TIMEOUT_MS = 5000;
const SCHEMA_VERSION           = '1';

// ── Feature flag ──────────────────────────────────────────────────────────────

function isFlagEnabled() {
  return process.env[FLAG_NAME] === 'true';
}

// ── State fingerprint ─────────────────────────────────────────────────────────
//
// Deterministic pipe-separated string over 8 canonical fields.
// Excludes all timestamps, PII, event metadata, and IDs.
//
// Normalization:
//   NULL/undefined → ''
//   numerics       → toFixed(2)
//   dates          → YYYY-MM-DD (first 10 chars)
//   currency       → uppercase
//   status         → lowercase
//
// guest_count falls back to occupancy_adults for channex reservations
// that don't have a dedicated guest_count column.

function computeStateFingerprint(row) {
  if (!row) return '';
  const fmtDate = v => (v != null ? String(v).slice(0, 10) : '');
  const fmtNum  = v => (v != null ? Number(v).toFixed(2) : '');
  const fmtStr  = v => (v != null ? String(v) : '');
  const guestCount = row.guest_count != null
    ? row.guest_count
    : (row.occupancy_adults != null ? row.occupancy_adults : null);
  return [
    fmtStr(row.property_id),
    fmtDate(row.start_date),
    fmtDate(row.end_date),
    row.status != null ? String(row.status).toLowerCase() : '',
    guestCount != null ? fmtStr(guestCount) : '',
    fmtNum(row.amount_total),
    fmtNum(row.amount_rooms),
    row.currency != null ? String(row.currency).toUpperCase() : '',
  ].join('|');
}

// ── Source normalization ──────────────────────────────────────────────────────
//
// Canonical source identifiers: 'channex', 'guest_app'.
// Normalizes legacy variants: GUEST_APP, bhguest → 'guest_app'.

function normalizeSource(s) {
  if (!s) return 'unknown';
  const lower = String(s).toLowerCase().trim();
  if (lower === 'channex') return 'channex';
  if (lower === 'guest_app' || lower === 'bhguest' || lower === 'guest app') return 'guest_app';
  return lower;
}

// ── Dedup helpers ─────────────────────────────────────────────────────────────

async function fetchLatestEvent(client, source, externalBookingId) {
  if (!externalBookingId) return null;
  try {
    const res = await client.query(
      `SELECT event_type, state_fingerprint
       FROM booking_events
       WHERE source = $1 AND external_booking_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [source, externalBookingId]
    );
    return res.rows[0] || null;
  } catch (e) {
    if (e.message && !e.message.includes('booking_events')) {
      console.error('[BOOKING-EVENT] fetchLatestEvent failed:', e.message);
    }
    return null;
  }
}

async function hasCreatedEvent(client, source, externalBookingId) {
  if (!externalBookingId) return false;
  try {
    const res = await client.query(
      `SELECT 1 FROM booking_events
       WHERE source = $1 AND external_booking_id = $2 AND event_type = 'BOOKING_CREATED'
       LIMIT 1`,
      [source, externalBookingId]
    );
    return res.rows.length > 0;
  } catch (e) {
    if (e.message && !e.message.includes('booking_events')) {
      console.error('[BOOKING-EVENT] hasCreatedEvent failed:', e.message);
    }
    return false;
  }
}

// ── Core record logic ─────────────────────────────────────────────────────────
//
// Runs on a dedicated client with statement_timeout already applied.
// Returns { inserted, skipped, reason?, error?, eventId? }.
// Never throws.

async function _recordCore(client, {
  eventType,
  source,
  externalBookingId,
  reservationRow,
  beforeFingerprint,
  currencyProvenance,
  providerEventId,
  context,
}) {
  // event_observed_at: Boostinghost observation time — when we know this event happened.
  // Generated here, after the reservation write succeeds. NOT from reservation.created_at.
  // NOT included in state fingerprint. Distinct from created_at (DB insertion time).
  const eventObservedAt = new Date().toISOString();

  const normSource = normalizeSource(source);
  const row        = reservationRow || {};
  const afterFp    = computeStateFingerprint(row);

  // ── Idempotency / dedup ───────────────────────────────────────────────────

  if (eventType === 'BOOKING_CREATED') {
    const alreadyCreated = await hasCreatedEvent(client, normSource, externalBookingId);
    if (alreadyCreated) {
      return { inserted: 0, skipped: 1, reason: 'dedup_created_exists' };
    }
  }

  if (eventType === 'BOOKING_MODIFIED') {
    const latest = await fetchLatestEvent(client, normSource, externalBookingId);
    if (latest && latest.state_fingerprint === afterFp) {
      return { inserted: 0, skipped: 1, reason: 'dedup_fingerprint_match' };
    }
  }

  if (eventType === 'BOOKING_CANCELLED') {
    const latest = await fetchLatestEvent(client, normSource, externalBookingId);
    if (latest && latest.event_type === 'BOOKING_CANCELLED') {
      return { inserted: 0, skipped: 1, reason: 'dedup_already_cancelled' };
    }
  }

  // ── Currency extraction ────────────────────────────────────────────────────
  // NEVER default to EUR. Use actual currency from the row, or NULL.

  const rawCurrency = row.currency != null ? String(row.currency).toUpperCase() : null;
  const currProv    = currencyProvenance || (rawCurrency ? 'reservation_record' : 'unknown');

  // ── Guest count ───────────────────────────────────────────────────────────

  const guestCount = row.guest_count != null
    ? row.guest_count
    : (row.occupancy_adults != null ? row.occupancy_adults : null);

  // ── INSERT ────────────────────────────────────────────────────────────────
  // APPEND-ONLY: never UPDATE or DELETE booking_events rows.

  const res = await client.query(
    `INSERT INTO booking_events (
       event_type, event_category, source, external_booking_id,
       property_id, reservation_id,
       state_fingerprint, before_fingerprint,
       start_date, end_date, status, guest_count,
       amount_total, amount_rooms,
       currency, currency_provenance,
       provider_event_id, schema_version,
       event_observed_at, provider_event_at
     ) VALUES (
       $1, 'DEMAND', $2, $3,
       $4, $5,
       $6, $7,
       $8, $9, $10, $11,
       $12, $13,
       $14, $15,
       $16, $17,
       $18, $19
     ) RETURNING id`,
    [
      eventType,
      normSource,
      externalBookingId || null,
      row.property_id   != null ? row.property_id : null,
      row.id            != null ? row.id           : null,
      afterFp           || null,
      beforeFingerprint || null,
      row.start_date    ? String(row.start_date).slice(0, 10) : null,
      row.end_date      ? String(row.end_date).slice(0, 10)   : null,
      row.status        ? String(row.status).toLowerCase()    : null,
      guestCount        != null ? guestCount : null,
      row.amount_total  != null ? row.amount_total : null,
      row.amount_rooms  != null ? row.amount_rooms : null,
      rawCurrency,
      currProv,
      providerEventId   || null,
      SCHEMA_VERSION,
      eventObservedAt,  // $18 — Boostinghost observation time (when we knew this event)
      null,             // $19 — provider_event_at (no reliable provider timestamps in T2.1)
    ]
  );

  if (res.rows[0]) {
    const fpSnippet = afterFp ? afterFp.slice(0, 40) : 'null';
    console.log(`[BOOKING-EVENT] ${eventType} id=${res.rows[0].id} src=${normSource} ext=${externalBookingId || 'null'} prop=${row.property_id || 'null'} fp=${fpSnippet} ctx=${context || ''}`);
    return { inserted: 1, skipped: 0, eventId: res.rows[0].id };
  }
  return { inserted: 0, skipped: 0, reason: 'no_row_returned' };
}

// ── Timeout-bounded execution ─────────────────────────────────────────────────
//
// Acquires a dedicated pool client, applies per-query statement_timeout,
// then races the work against a whole-operation deadline.
//
// On normal completion: SET statement_timeout = DEFAULT, then client.release().
// On timeout: client.release(err) destroys the connection; no session leak.
//
// Exported for unit testing.

async function _runWithTimeout(pool, workFn, timeoutMs) {
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    return { inserted: 0, skipped: 0, error: `connect_failed: ${e.message}` };
  }

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
      resolve({ inserted: 0, skipped: 0, error: 'BOOKING_EVENT_TIMEOUT' });
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
      client.release(new Error('[BOOKING-EVENT] timeout — destroy client'));
    } else {
      try {
        await client.query('SET statement_timeout = DEFAULT');
        client.release();
      } catch (resetErr) {
        client.release(resetErr);
      }
    }
  }

  return result;
}

// ── Main entry point ──────────────────────────────────────────────────────────
//
// Called from channex.js and server.js after reservation write succeeds.
// Failure NEVER propagates to caller — always returns a result object.

async function recordBookingEvent(pool, params) {
  if (!isFlagEnabled()) {
    return { inserted: 0, skipped: 1, reason: 'flag_disabled' };
  }
  if (!params || !params.eventType || !params.source) {
    console.warn('[BOOKING-EVENT] recordBookingEvent called without required params:', JSON.stringify({ eventType: params?.eventType, source: params?.source }));
    return { inserted: 0, skipped: 0, error: 'missing_required_params' };
  }

  try {
    const result = await _runWithTimeout(
      pool,
      client => _recordCore(client, params),
      BOOKING_EVENT_TIMEOUT_MS
    );
    if (result.error) {
      console.warn(`[BOOKING-EVENT] persist failed (${params.eventType} ${params.source}/${params.externalBookingId}): ${result.error}`);
    }
    return result;
  } catch (e) {
    console.warn('[BOOKING-EVENT] unexpected error in recordBookingEvent:', e.message);
    return { inserted: 0, skipped: 0, error: e.message };
  }
}

module.exports = {
  recordBookingEvent,
  computeStateFingerprint,
  normalizeSource,
  isFlagEnabled,
  // Exported for unit testing only:
  _recordCore,
  _runWithTimeout,
};

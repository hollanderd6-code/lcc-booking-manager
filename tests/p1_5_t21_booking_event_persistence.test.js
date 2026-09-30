'use strict';
/**
 * P1.5-T2.1 — Booking Event Persistence Tests
 *
 * Tests for services/booking-event-persistence.js and supporting files.
 *
 * Sections:
 *   [A] Module structure and exports
 *   [B] computeStateFingerprint — normalization
 *   [C] computeStateFingerprint — consistency and sensitivity
 *   [D] normalizeSource
 *   [E] isFlagEnabled
 *   [F] _recordCore unit — mock client (no DB)
 *   [G] recordBookingEvent — flag disabled and missing params
 *   [H] Migration SQL structure
 *   [I] Channex.js instrumentation static check
 *   [J] server.js instrumentation static check
 *   [K] Audit tool structure
 *   [L] Service safety constants
 *   [M] Fingerprint — A→B→A semantics
 *   [N] Currency policy (no EUR default)
 *   [O] Audit tool self-read-only
 */

const assert = require('assert');
const path   = require('path');
const fs     = require('fs');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌  ${name}: ${err.message}`);
    failures.push({ name, message: err.message });
    failed++;
  }
}

function ok(val, msg)  { assert.ok(val, msg); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function neq(a, b, msg) { assert.notStrictEqual(a, b, msg); }

const SVC      = require('../services/booking-event-persistence');
const SVC_SRC  = fs.readFileSync(path.join(__dirname, '../services/booking-event-persistence.js'), 'utf8');
const MIG_PATH = path.join(__dirname, '../migrations/009_booking_events.sql');
const CHX_PATH = path.join(__dirname, '../channex.js');
const SRV_PATH = path.join(__dirname, '../server.js');
const AUD_PATH = path.join(__dirname, '../outils/audit-booking-event-persistence-readiness-p1_5_t21.js');

const migSrc  = fs.existsSync(MIG_PATH) ? fs.readFileSync(MIG_PATH, 'utf8') : '';
const chxSrc  = fs.existsSync(CHX_PATH) ? fs.readFileSync(CHX_PATH, 'utf8') : '';
const srvSrc  = fs.existsSync(SRV_PATH) ? fs.readFileSync(SRV_PATH, 'utf8') : '';

// ── Mock client factory ────────────────────────────────────────────────────────

function makeMockClient(opts = {}) {
  const log = [];
  return {
    _log: log,
    query: async (sql, params) => {
      log.push({ sql: sql.trim().slice(0, 100), params: params || [] });
      const up = sql.toUpperCase().trim();
      if (up.startsWith('SET STATEMENT_TIMEOUT') || up.startsWith('SET STATEMENT_TIMEOUT = DEFAULT')) {
        return { rows: [] };
      }
      if (up.includes('AND EVENT_TYPE')) {
        return { rows: opts.hasCreated ? [{ event_type: 'BOOKING_CREATED' }] : [] };
      }
      if (up.includes('ORDER BY CREATED_AT DESC')) {
        return { rows: opts.latestEvent ? [opts.latestEvent] : [] };
      }
      if (up.includes('INSERT INTO BOOKING_EVENTS')) {
        const id = opts.insertId !== undefined ? opts.insertId : 9999;
        return { rows: opts.insertFails ? [] : [{ id }] };
      }
      return { rows: [] };
    },
  };
}

function makeMockPool(opts = {}) {
  return {
    connect: async () => {
      if (opts.connectFails) throw new Error('simulated connect failure');
      return makeMockClient(opts);
    },
  };
}

// ── [A] Module structure and exports ─────────────────────────────────────────

test('[A-01] service module loads without error', async () => {
  ok(SVC, 'module loaded');
});

test('[A-02] exports recordBookingEvent function', async () => {
  eq(typeof SVC.recordBookingEvent, 'function');
});

test('[A-03] exports computeStateFingerprint function', async () => {
  eq(typeof SVC.computeStateFingerprint, 'function');
});

test('[A-04] exports normalizeSource function', async () => {
  eq(typeof SVC.normalizeSource, 'function');
});

test('[A-05] exports isFlagEnabled function', async () => {
  eq(typeof SVC.isFlagEnabled, 'function');
});

test('[A-06] exports _recordCore for testing', async () => {
  eq(typeof SVC._recordCore, 'function');
});

test('[A-07] exports _runWithTimeout for testing', async () => {
  eq(typeof SVC._runWithTimeout, 'function');
});

// ── [B] computeStateFingerprint — normalization ────────────────────────────

test('[B-01] null row produces empty string', async () => {
  eq(SVC.computeStateFingerprint(null), '');
  eq(SVC.computeStateFingerprint(undefined), '');
});

test('[B-02] fingerprint has 8 pipe-separated fields', async () => {
  const fp = SVC.computeStateFingerprint({});
  eq(fp.split('|').length, 8, 'fingerprint has 8 fields');
});

test('[B-03] null fields normalize to empty string in fingerprint', async () => {
  const fp = SVC.computeStateFingerprint({ property_id: null, start_date: null, status: null, currency: null });
  const parts = fp.split('|');
  eq(parts[0], '', 'null property_id → empty string');
  eq(parts[3], '', 'null status → empty string');
  eq(parts[7], '', 'null currency → empty string');
});

test('[B-04] numeric amount_total formatted to 2 decimal places', async () => {
  const fp = SVC.computeStateFingerprint({ amount_total: 150 });
  ok(fp.includes('150.00'), `expected 150.00 in fp: ${fp}`);
});

test('[B-05] numeric amount_rooms formatted to 2 decimal places', async () => {
  const fp = SVC.computeStateFingerprint({ amount_rooms: 99.9 });
  ok(fp.includes('99.90'), `expected 99.90 in fp: ${fp}`);
});

test('[B-06] dates normalized to YYYY-MM-DD (10 chars)', async () => {
  const fp = SVC.computeStateFingerprint({ start_date: '2026-07-01T00:00:00.000Z', end_date: '2026-07-07' });
  ok(fp.includes('2026-07-01'), `expected 2026-07-01 in fp: ${fp}`);
  ok(fp.includes('2026-07-07'), `expected 2026-07-07 in fp: ${fp}`);
});

test('[B-07] currency normalized to uppercase', async () => {
  const fp = SVC.computeStateFingerprint({ currency: 'eur' });
  ok(fp.includes('EUR'), 'currency uppercased');
  ok(!fp.includes('eur'), 'lowercase currency not present');
});

test('[B-08] status normalized to lowercase', async () => {
  const fp = SVC.computeStateFingerprint({ status: 'CONFIRMED' });
  ok(fp.includes('confirmed'), 'status lowercased');
  ok(!fp.includes('CONFIRMED'), 'uppercase status not present');
});

test('[B-09] guest_count used when present', async () => {
  const fp = SVC.computeStateFingerprint({ guest_count: 3 });
  const parts = fp.split('|');
  eq(parts[4], '3', `expected guest_count 3 in fp field 4`);
});

test('[B-10] occupancy_adults used as fallback when guest_count absent', async () => {
  const fp1 = SVC.computeStateFingerprint({ occupancy_adults: 2 });
  const fp2 = SVC.computeStateFingerprint({ guest_count: 2 });
  eq(fp1, fp2, 'guest_count=2 and occupancy_adults=2 produce same fingerprint');
});

test('[B-11] guest_count takes precedence over occupancy_adults', async () => {
  const fp = SVC.computeStateFingerprint({ guest_count: 4, occupancy_adults: 2 });
  const parts = fp.split('|');
  eq(parts[4], '4', 'guest_count 4 wins over occupancy_adults 2');
});

test('[B-12] amount_total zero serializes correctly', async () => {
  const fp = SVC.computeStateFingerprint({ amount_total: 0 });
  ok(fp.includes('0.00'), `expected 0.00 in fp: ${fp}`);
});

// ── [C] computeStateFingerprint — consistency and sensitivity ──────────────

test('[C-01] same row always produces same fingerprint', async () => {
  const row = { property_id: 42, start_date: '2026-08-01', end_date: '2026-08-07', status: 'confirmed', occupancy_adults: 2, amount_total: 350, amount_rooms: 300, currency: 'EUR' };
  eq(SVC.computeStateFingerprint(row), SVC.computeStateFingerprint(row));
});

test('[C-02] different amount_total produces different fingerprint', async () => {
  const base    = { property_id: 1, start_date: '2026-08-01', end_date: '2026-08-07', status: 'confirmed', amount_total: 300 };
  const changed = { ...base, amount_total: 350 };
  neq(SVC.computeStateFingerprint(base), SVC.computeStateFingerprint(changed));
});

test('[C-03] status change confirmed→cancelled changes fingerprint', async () => {
  const confirmed = { property_id: 1, status: 'confirmed' };
  const cancelled = { property_id: 1, status: 'cancelled' };
  neq(SVC.computeStateFingerprint(confirmed), SVC.computeStateFingerprint(cancelled));
});

test('[C-04] date change changes fingerprint', async () => {
  const base    = { property_id: 1, start_date: '2026-08-01', end_date: '2026-08-07' };
  const shifted = { property_id: 1, start_date: '2026-08-02', end_date: '2026-08-08' };
  neq(SVC.computeStateFingerprint(base), SVC.computeStateFingerprint(shifted));
});

test('[C-05] currency change changes fingerprint', async () => {
  neq(SVC.computeStateFingerprint({ property_id: 1, currency: 'EUR' }),
      SVC.computeStateFingerprint({ property_id: 1, currency: 'USD' }));
});

test('[C-06] property_id change changes fingerprint', async () => {
  neq(SVC.computeStateFingerprint({ property_id: 1, status: 'confirmed' }),
      SVC.computeStateFingerprint({ property_id: 2, status: 'confirmed' }));
});

test('[C-07] fingerprint excludes reservation row id', async () => {
  const a = { id: 100, property_id: 1, status: 'confirmed' };
  const b = { id: 200, property_id: 1, status: 'confirmed' };
  eq(SVC.computeStateFingerprint(a), SVC.computeStateFingerprint(b));
});

test('[C-08] fingerprint excludes created_at timestamp', async () => {
  const a = { created_at: '2026-01-01T00:00:00Z', property_id: 1, status: 'confirmed' };
  const b = { created_at: '2026-06-01T12:00:00Z', property_id: 1, status: 'confirmed' };
  eq(SVC.computeStateFingerprint(a), SVC.computeStateFingerprint(b));
});

// ── [D] normalizeSource ────────────────────────────────────────────────────

test('[D-01] channex normalizes to channex (any case)', async () => {
  eq(SVC.normalizeSource('channex'), 'channex');
  eq(SVC.normalizeSource('CHANNEX'), 'channex');
  eq(SVC.normalizeSource('Channex'), 'channex');
});

test('[D-02] guest_app / GUEST_APP normalize to guest_app', async () => {
  eq(SVC.normalizeSource('guest_app'), 'guest_app');
  eq(SVC.normalizeSource('GUEST_APP'), 'guest_app');
});

test('[D-03] bhguest / BHGUEST normalize to guest_app', async () => {
  eq(SVC.normalizeSource('bhguest'), 'guest_app');
  eq(SVC.normalizeSource('BHGUEST'), 'guest_app');
});

test('[D-04] null/undefined/empty returns unknown', async () => {
  eq(SVC.normalizeSource(null), 'unknown');
  eq(SVC.normalizeSource(undefined), 'unknown');
  eq(SVC.normalizeSource(''), 'unknown');
});

test('[D-05] unknown source preserved as lowercase', async () => {
  eq(SVC.normalizeSource('ICAL'), 'ical');
});

// ── [E] isFlagEnabled ──────────────────────────────────────────────────────

test('[E-01] isFlagEnabled false when flag not set', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  eq(SVC.isFlagEnabled(), false);
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
});

test('[E-02] isFlagEnabled false for string "false"', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = 'false';
  eq(SVC.isFlagEnabled(), false);
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
  else delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
});

test('[E-03] isFlagEnabled true only for exact string "true"', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = 'true';
  eq(SVC.isFlagEnabled(), true);
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
  else delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
});

test('[E-04] isFlagEnabled false for wrong-case "TRUE"', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = 'TRUE';
  eq(SVC.isFlagEnabled(), false);
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
  else delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
});

// ── [F] _recordCore unit — mock client ─────────────────────────────────────

test('[F-01] BOOKING_CREATED inserts when no prior CREATED event', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 1 });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'channex',
    externalBookingId: 'BK_001',
    reservationRow: { property_id: 1, start_date: '2026-08-01', end_date: '2026-08-07', status: 'confirmed' },
    context: 'test',
  });
  eq(result.inserted, 1);
  eq(result.skipped, 0);
  ok(result.eventId != null);
});

test('[F-02] BOOKING_CREATED skipped when CREATED already exists (dedup)', async () => {
  const client = makeMockClient({ hasCreated: true });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'channex',
    externalBookingId: 'BK_001',
    reservationRow: { property_id: 1, status: 'confirmed' },
    context: 'test',
  });
  eq(result.inserted, 0);
  eq(result.skipped, 1);
  eq(result.reason, 'dedup_created_exists');
});

test('[F-03] BOOKING_MODIFIED inserted when fingerprint changed', async () => {
  const row = { property_id: 1, start_date: '2026-08-01', end_date: '2026-08-07', status: 'confirmed', amount_total: 350 };
  const client = makeMockClient({ latestEvent: { event_type: 'BOOKING_CREATED', state_fingerprint: 'different|fp' }, insertId: 2 });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_MODIFIED',
    source: 'channex',
    externalBookingId: 'BK_001',
    reservationRow: row,
    context: 'test',
  });
  eq(result.inserted, 1);
  eq(result.skipped, 0);
});

test('[F-04] BOOKING_MODIFIED skipped when fingerprint matches latest', async () => {
  const row = { property_id: 1, start_date: '2026-08-01', end_date: '2026-08-07', status: 'confirmed', amount_total: 350, amount_rooms: null, currency: 'EUR' };
  const fp = SVC.computeStateFingerprint(row);
  const client = makeMockClient({ latestEvent: { event_type: 'BOOKING_MODIFIED', state_fingerprint: fp } });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_MODIFIED',
    source: 'channex',
    externalBookingId: 'BK_001',
    reservationRow: row,
    context: 'test',
  });
  eq(result.inserted, 0);
  eq(result.skipped, 1);
  eq(result.reason, 'dedup_fingerprint_match');
});

test('[F-05] BOOKING_CANCELLED inserted when no prior cancellation', async () => {
  const client = makeMockClient({ latestEvent: { event_type: 'BOOKING_CREATED', state_fingerprint: 'fp1' }, insertId: 3 });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_CANCELLED',
    source: 'guest_app',
    externalBookingId: 'GUEST_123',
    reservationRow: { property_id: 5, start_date: '2026-09-01', end_date: '2026-09-05', status: 'cancelled' },
    context: 'test',
  });
  eq(result.inserted, 1);
  eq(result.skipped, 0);
});

test('[F-06] BOOKING_CANCELLED skipped when already cancelled (dedup)', async () => {
  const client = makeMockClient({ latestEvent: { event_type: 'BOOKING_CANCELLED', state_fingerprint: 'fp1' } });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_CANCELLED',
    source: 'guest_app',
    externalBookingId: 'GUEST_123',
    reservationRow: { property_id: 5, status: 'cancelled' },
    context: 'test',
  });
  eq(result.inserted, 0);
  eq(result.skipped, 1);
  eq(result.reason, 'dedup_already_cancelled');
});

test('[F-07] source is normalized before DB queries', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 4 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'GUEST_APP',
    externalBookingId: 'GUEST_456',
    reservationRow: { property_id: 1, status: 'confirmed' },
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ, 'INSERT was called');
  ok(insertQ.params.includes('guest_app'), 'normalized source stored');
});

test('[F-08] currency is uppercased in INSERT params', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 5 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'channex',
    externalBookingId: 'BK_002',
    reservationRow: { property_id: 1, status: 'confirmed', currency: 'eur' },
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ, 'INSERT was called');
  ok(insertQ.params.includes('EUR'), 'currency uppercased in params');
});

test('[F-09] null currency stored as null — not defaulted to EUR', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 6 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'guest_app',
    externalBookingId: 'GUEST_789',
    reservationRow: { property_id: 2, status: 'confirmed', currency: null },
    currencyProvenance: 'unknown',
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ, 'INSERT was called');
  ok(!insertQ.params.includes('EUR'), 'EUR not in params when currency is null');
  ok(insertQ.params.includes(null), 'null currency stored as null');
});

test('[F-10] beforeFingerprint stored in INSERT params', async () => {
  const client = makeMockClient({ latestEvent: { event_type: 'BOOKING_CREATED', state_fingerprint: 'old_fp' }, insertId: 7 });
  const beforeFp = 'before|fp|value';
  await SVC._recordCore(client, {
    eventType: 'BOOKING_MODIFIED',
    source: 'channex',
    externalBookingId: 'BK_003',
    reservationRow: { property_id: 1, status: 'confirmed', amount_total: 400 },
    beforeFingerprint: beforeFp,
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ, 'INSERT was called');
  ok(insertQ.params.includes(beforeFp), 'beforeFingerprint in params');
});

test('[F-11] reservationRow.id stored as reservation_id', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 9 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'guest_app',
    externalBookingId: 'GUEST_100',
    reservationRow: { id: 777, property_id: 3, status: 'confirmed' },
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ.params.includes(777), 'reservation_id 777 stored');
});

test('[F-12] currencyProvenance defaults to reservation_record when currency present', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 10 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'channex',
    externalBookingId: 'BK_007',
    reservationRow: { property_id: 1, status: 'confirmed', currency: 'EUR' },
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ.params.includes('reservation_record'), 'default provenance when currency present');
});

test('[F-13] currencyProvenance explicit provider is stored', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 11 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'channex',
    externalBookingId: 'BK_008',
    reservationRow: { property_id: 1, status: 'confirmed', currency: 'EUR' },
    currencyProvenance: 'provider',
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ.params.includes('provider'), 'provider provenance stored');
});

// ── [G] recordBookingEvent — flag disabled and missing params ──────────────

test('[G-01] recordBookingEvent returns flag_disabled when flag off', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  const result = await SVC.recordBookingEvent({}, { eventType: 'BOOKING_CREATED', source: 'channex', externalBookingId: 'BK_X' });
  eq(result.reason, 'flag_disabled');
  eq(result.inserted, 0);
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
});

test('[G-02] recordBookingEvent returns error for missing eventType', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = 'true';
  const result = await SVC.recordBookingEvent({}, { source: 'channex' });
  eq(result.error, 'missing_required_params');
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
  else delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
});

test('[G-03] recordBookingEvent returns error for missing source', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = 'true';
  const result = await SVC.recordBookingEvent({}, { eventType: 'BOOKING_CREATED' });
  eq(result.error, 'missing_required_params');
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
  else delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
});

test('[G-04] recordBookingEvent never throws even on DB connect error', async () => {
  const orig = process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
  process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = 'true';
  const brokenPool = { connect: async () => { throw new Error('simulated pool failure'); } };
  let threw = false;
  let result;
  try {
    result = await SVC.recordBookingEvent(brokenPool, {
      eventType: 'BOOKING_CREATED', source: 'channex',
      externalBookingId: 'BK_ERR', reservationRow: { property_id: 1 },
    });
  } catch (e) { threw = true; }
  eq(threw, false, 'should NOT throw');
  ok(result && result.error, 'should return error object');
  if (orig !== undefined) process.env.BOOKING_EVENT_PERSISTENCE_ENABLED = orig;
  else delete process.env.BOOKING_EVENT_PERSISTENCE_ENABLED;
});

test('[G-05] _runWithTimeout returns error on connect failure', async () => {
  const brokenPool = { connect: async () => { throw new Error('timeout test'); } };
  const result = await SVC._runWithTimeout(brokenPool, async () => ({ inserted: 1 }), 5000);
  ok(result.error && result.error.includes('connect_failed'), `expected connect_failed error, got: ${result.error}`);
  eq(result.inserted, 0);
});

// ── [H] Migration SQL structure ────────────────────────────────────────────

test('[H-01] migration file 009_booking_events.sql exists', async () => {
  ok(fs.existsSync(MIG_PATH), 'migration file exists');
});

test('[H-02] migration has CREATE TABLE IF NOT EXISTS booking_events', async () => {
  ok(/CREATE TABLE IF NOT EXISTS booking_events/i.test(migSrc));
});

test('[H-03] migration has no FK on reservation_id', async () => {
  ok(!/FOREIGN KEY\s*\([^)]*reservation_id/i.test(migSrc), 'no FK on reservation_id');
});

test('[H-04] migration has no DROP TABLE', async () => {
  ok(!/DROP TABLE/i.test(migSrc));
});

test('[H-05] migration has no INSERT', async () => {
  ok(!/\bINSERT\b/i.test(migSrc));
});

test('[H-06] migration has all required columns', async () => {
  const required = ['event_type', 'event_category', 'source', 'external_booking_id',
    'property_id', 'reservation_id', 'state_fingerprint', 'before_fingerprint',
    'currency', 'currency_provenance', 'schema_version'];
  for (const col of required) {
    ok(migSrc.includes(col), `column ${col} present in migration`);
  }
});

test('[H-07] migration has all three required indexes', async () => {
  ok(migSrc.includes('idx_booking_events_property_created'));
  ok(migSrc.includes('idx_booking_events_source_external'));
  ok(migSrc.includes('idx_booking_events_reservation'));
});

test('[H-08] migration schema_version defaults to 1', async () => {
  ok(/schema_version.*DEFAULT\s+'1'/i.test(migSrc));
});

// ── [I] Channex.js instrumentation static check ────────────────────────────

test('[I-01] channex.js requires booking-event-persistence service', async () => {
  ok(chxSrc.includes("require('./services/booking-event-persistence')"));
});

test('[I-02] channex.js imports recordBookingEvent', async () => {
  ok(chxSrc.includes('recordBookingEvent'));
});

test('[I-03] channex.js imports computeStateFingerprint', async () => {
  ok(chxSrc.includes('computeStateFingerprint'));
});

test('[I-04] W-01 BOOKING_CREATED context present', async () => {
  ok(chxSrc.includes("context: 'channex W-01'"));
});

test('[I-05] W-02 BOOKING_MODIFIED context present', async () => {
  ok(chxSrc.includes("context: 'channex W-02'"));
});

test('[I-06] W-02 captures _w02BeforeFp before UPDATE', async () => {
  ok(chxSrc.includes('_w02BeforeFp'));
});

test('[I-07] W-03 BOOKING_CANCELLED DB path context present', async () => {
  ok(chxSrc.includes("context: 'channex W-03'"));
});

test('[I-08] W-03 orphan path context present', async () => {
  ok(chxSrc.includes("context: 'channex W-03 orphan'"));
});

test('[I-09] W-01 uses currencyProvenance provider', async () => {
  const idx = chxSrc.indexOf("context: 'channex W-01'");
  const block = chxSrc.slice(Math.max(0, idx - 400), idx + 50);
  ok(block.includes("currencyProvenance: 'provider'"), 'W-01 provider provenance');
});

test('[I-10] W-03 orphan uses currencyProvenance unknown', async () => {
  const idx = chxSrc.indexOf("context: 'channex W-03 orphan'");
  const block = chxSrc.slice(Math.max(0, idx - 400), idx + 50);
  ok(block.includes("currencyProvenance: 'unknown'"), 'W-03 orphan unknown provenance');
});

// ── [J] server.js instrumentation static check ────────────────────────────

test('[J-01] server.js requires booking-event-persistence service', async () => {
  ok(srvSrc.includes("require('./services/booking-event-persistence')"));
});

test('[J-02] W-04 declined_reservation context present', async () => {
  ok(srvSrc.includes("context: 'server W-04 declined'"));
});

test('[J-03] W-07 confirm-after-payment context present', async () => {
  ok(srvSrc.includes("context: 'server W-07'"));
});

test('[J-04] W-08 deferred setup context present', async () => {
  ok(srvSrc.includes("context: 'server W-08 deferred'"));
});

test('[J-05] W-09 Stripe checkout session context present', async () => {
  ok(srvSrc.includes("context: 'server W-09'"));
});

test('[J-06] W-10 deferred guest cancel context present', async () => {
  ok(srvSrc.includes("context: 'server W-10 deferred'"));
});

test('[J-07] W-10 non-deferred guest cancel context present', async () => {
  ok(srvSrc.includes("context: 'server W-10'"));
});

test('[J-08] W-11 host cancel context present', async () => {
  ok(srvSrc.includes("context: 'server W-11 host-cancel'"));
});

test('[J-09] W-12 system cancel context present', async () => {
  ok(srvSrc.includes("context: 'server W-12 system-cancel'"));
});

test('[J-10] W-09 uses currencyProvenance provider (Stripe authoritative)', async () => {
  const idx = srvSrc.indexOf("context: 'server W-09'");
  const block = srvSrc.slice(Math.max(0, idx - 500), idx + 50);
  ok(block.includes("currencyProvenance: 'provider'"), 'W-09 provider provenance');
});

// ── [K] Audit tool structure ───────────────────────────────────────────────

test('[K-01] readiness audit tool file exists', async () => {
  ok(fs.existsSync(AUD_PATH));
});

test('[K-02] audit tool exports runAudit', async () => {
  const audit = require(AUD_PATH);
  eq(typeof audit.runAudit, 'function');
});

test('[K-03] audit tool exports checkAuditToolReadOnly', async () => {
  const audit = require(AUD_PATH);
  eq(typeof audit.checkAuditToolReadOnly, 'function');
});

test('[K-04] audit tool self-check returns no violations', async () => {
  const audit = require(AUD_PATH);
  const violations = audit.checkAuditToolReadOnly();
  assert.deepStrictEqual(violations, [], `Expected no violations, got: ${JSON.stringify(violations)}`);
});

test('[K-05] runAudit returns expected section names', async () => {
  const audit = require(AUD_PATH);
  const report = await audit.runAudit();
  const names = report.sections.map(s => s.section);
  ok(names.includes('SELF_READ_ONLY'));
  ok(names.includes('MIGRATION_009'));
  ok(names.includes('MIGRATION_010'));
  ok(names.includes('SERVICE_FILE'));
  ok(names.includes('CHANNEX_INSTRUMENTATION'));
  ok(names.includes('SERVER_INSTRUMENTATION'));
  ok(names.includes('FLAG_STATE'));
});

test('[K-06] runAudit passes all static sections (no DB required)', async () => {
  const audit = require(AUD_PATH);
  const report = await audit.runAudit();
  const staticFailed = report.sections
    .filter(s => s.section !== 'DATABASE' && s.section !== 'FLAG_STATE' && s.ok === false)
    .map(s => ({ section: s.section, results: s.results }));
  assert.deepStrictEqual(staticFailed, [], `Static sections failed: ${JSON.stringify(staticFailed, null, 2)}`);
});

// ── [L] Service safety constants ────────────────────────────────────────────

test('[L-01] service has BOOKING_EVENT_PERSISTENCE_ENABLED flag name', async () => {
  ok(SVC_SRC.includes('BOOKING_EVENT_PERSISTENCE_ENABLED'));
});

test('[L-02] service has 5000ms timeout constant', async () => {
  ok(SVC_SRC.includes('5000'));
});

test('[L-03] service declares BOOKING_EVENTS_HAVE_PRICING_AUTHORITY = NO', async () => {
  ok(SVC_SRC.includes('BOOKING_EVENTS_HAVE_PRICING_AUTHORITY') && SVC_SRC.includes('NO'));
});

test('[L-04] service declares BOOKING_EVENTS_HAVE_PICKUP_AUTHORITY = NO', async () => {
  ok(SVC_SRC.includes('BOOKING_EVENTS_HAVE_PICKUP_AUTHORITY') && SVC_SRC.includes('NO'));
});

test('[L-05] service declares BOOKING_EVENT_FAILURE_BLOCKS_RESERVATIONS = NO', async () => {
  ok(SVC_SRC.includes('BOOKING_EVENT_FAILURE_BLOCKS_RESERVATIONS = NO'));
});

test('[L-06] service has APPEND-ONLY comment', async () => {
  ok(SVC_SRC.includes('APPEND-ONLY'));
});

test('[L-07] service has exactly one INSERT INTO booking_events (in _recordCore)', async () => {
  const matches = (SVC_SRC.match(/INSERT INTO booking_events/gi) || []);
  eq(matches.length, 1, 'only one INSERT INTO booking_events');
});

test('[L-08] service has no UPDATE booking_events (append-only)', async () => {
  ok(!/UPDATE booking_events/i.test(SVC_SRC));
});

test('[L-09] service has no DELETE FROM booking_events', async () => {
  ok(!/DELETE FROM booking_events/i.test(SVC_SRC));
});

// ── [M] Fingerprint — A→B→A semantics ─────────────────────────────────────

test('[M-01] A→B→A: state A fingerprint is stable across calls', async () => {
  const stateA = { property_id: 1, start_date: '2026-08-01', end_date: '2026-08-07', status: 'confirmed', amount_total: 300, amount_rooms: 250, currency: 'EUR', occupancy_adults: 2 };
  const stateB = { ...stateA, amount_total: 350, amount_rooms: 300 };
  const fpA1 = SVC.computeStateFingerprint(stateA);
  const fpB  = SVC.computeStateFingerprint(stateB);
  const fpA2 = SVC.computeStateFingerprint(stateA);
  neq(fpA1, fpB, 'A and B produce different fingerprints');
  eq(fpA1, fpA2, 'A fingerprint is identical on second call');
});

test('[M-02] A→B→A: third event (back to A) is not skipped by dedup (latest=B)', async () => {
  const stateA = { property_id: 1, amount_total: 300, status: 'confirmed', currency: 'EUR' };
  const stateB = { property_id: 1, amount_total: 350, status: 'confirmed', currency: 'EUR' };
  const fpA = SVC.computeStateFingerprint(stateA);
  const fpB = SVC.computeStateFingerprint(stateB);
  // Simulate: latest event in DB has fingerprint B. New event has state A.
  // fpA !== fpB → dedup should NOT skip
  const client = makeMockClient({ latestEvent: { event_type: 'BOOKING_MODIFIED', state_fingerprint: fpB }, insertId: 50 });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_MODIFIED',
    source: 'channex',
    externalBookingId: 'BK_ABA',
    reservationRow: stateA,
    context: 'test A→B→A',
  });
  eq(result.inserted, 1, 'A→B→A: third event (state A again) is inserted because latest=B');
});

test('[M-03] A→A: second identical modification is skipped (fingerprint unchanged)', async () => {
  const stateA = { property_id: 1, amount_total: 300, status: 'confirmed', currency: 'EUR' };
  const fpA = SVC.computeStateFingerprint(stateA);
  const client = makeMockClient({ latestEvent: { event_type: 'BOOKING_MODIFIED', state_fingerprint: fpA } });
  const result = await SVC._recordCore(client, {
    eventType: 'BOOKING_MODIFIED',
    source: 'channex',
    externalBookingId: 'BK_AA',
    reservationRow: stateA,
    context: 'test A→A',
  });
  eq(result.skipped, 1, 'identical re-delivery is skipped');
  eq(result.reason, 'dedup_fingerprint_match');
});

// ── [N] Currency policy (no EUR default) ──────────────────────────────────

test('[N-01] service source has no EUR default fallback', async () => {
  ok(!/\|\|\s*['"]EUR['"]/i.test(SVC_SRC), "No || 'EUR' fallback in service source");
});

test('[N-02] computeStateFingerprint with null currency → empty string, not EUR', async () => {
  const fp = SVC.computeStateFingerprint({ property_id: 1, currency: null });
  const parts = fp.split('|');
  eq(parts[7], '', 'null currency → empty string, not EUR');
});

test('[N-03] computeStateFingerprint does not inject EUR when currency missing', async () => {
  const fp = SVC.computeStateFingerprint({ property_id: 1 });
  ok(!fp.includes('EUR'), 'EUR not injected when currency absent');
});

test('[N-04] _recordCore stores null for null currency — not EUR', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 99 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'guest_app',
    externalBookingId: 'GUEST_NO_CCY',
    reservationRow: { property_id: 1, status: 'confirmed' },
    currencyProvenance: 'unknown',
    context: 'test',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ, 'INSERT was called');
  ok(!insertQ.params.includes('EUR'), 'EUR never stored when currency absent');
});

// ── [P] event_observed_at and provider_event_at — service contract ─────────

const MIG10_PATH = path.join(__dirname, '../migrations/010_booking_events_pre_activation_fix.sql');
const POST_AUD_PATH = path.join(__dirname, '../outils/audit-booking-event-persistence-post-p1_5_t21.js');

test('[P-01] service INSERT includes event_observed_at param', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 200 });
  const before = Date.now();
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'channex',
    externalBookingId: 'BK_P01',
    reservationRow: { property_id: 1, status: 'confirmed' },
    context: 'test P-01',
  });
  const after = Date.now();
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ, 'INSERT was called');
  // event_observed_at is an ISO string in params
  const obsAt = insertQ.params.find(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(p));
  ok(obsAt, 'event_observed_at ISO string present in INSERT params');
  const ts = new Date(obsAt).getTime();
  ok(ts >= before && ts <= after + 100, 'event_observed_at is close to call time');
});

test('[P-02] event_observed_at is excluded from state fingerprint', async () => {
  const rowA = { property_id: 1, status: 'confirmed', event_observed_at: '2026-01-01T00:00:00Z' };
  const rowB = { property_id: 1, status: 'confirmed', event_observed_at: '2026-09-01T12:00:00Z' };
  eq(SVC.computeStateFingerprint(rowA), SVC.computeStateFingerprint(rowB),
    'different event_observed_at values → same fingerprint');
});

test('[P-03] provider_event_at is null in INSERT params', async () => {
  const client = makeMockClient({ hasCreated: false, insertId: 201 });
  await SVC._recordCore(client, {
    eventType: 'BOOKING_CREATED',
    source: 'channex',
    externalBookingId: 'BK_P03',
    reservationRow: { property_id: 1, status: 'confirmed' },
    context: 'test P-03',
  });
  const insertQ = client._log.find(q => q.sql.toUpperCase().includes('INSERT INTO BOOKING_EVENTS'));
  ok(insertQ, 'INSERT was called');
  const nullParams = insertQ.params.filter(p => p === null);
  ok(nullParams.length >= 1, 'at least one null param (provider_event_at)');
  // provider_event_at is $19 — last param
  const lastParam = insertQ.params[insertQ.params.length - 1];
  eq(lastParam, null, 'last INSERT param (provider_event_at) is null');
});

test('[P-04] service INSERT SQL includes event_observed_at and provider_event_at column names', async () => {
  ok(SVC_SRC.includes('event_observed_at'), 'service source includes event_observed_at');
  ok(SVC_SRC.includes('provider_event_at'), 'service source includes provider_event_at');
});

test('[P-05] service INSERT has 19 params ($19)', async () => {
  ok(SVC_SRC.includes('$19'), 'INSERT has $19 param position');
});

test('[P-06] booking_created_at is NOT referenced in service source', async () => {
  ok(!SVC_SRC.includes('booking_created_at'), 'booking_created_at is deferred — not in service');
});

test('[P-07] event_observed_at is generated at _recordCore call time (new Date)', async () => {
  ok(SVC_SRC.includes('new Date().toISOString()'), 'event_observed_at uses new Date().toISOString()');
  ok(!SVC_SRC.includes('row.created_at'), 'event_observed_at NOT derived from row.created_at');
});

// ── [Q] Migration 010 ─────────────────────────────────────────────────────────

const mig10Src = fs.existsSync(MIG10_PATH) ? fs.readFileSync(MIG10_PATH, 'utf8') : '';
// Strip SQL line comments before checking absence of destructive keywords.
// Comments like "-- No DROP, no TRUNCATE" would otherwise produce false positives.
const mig10NoComments = mig10Src.replace(/--[^\n]*/g, '');

test('[Q-01] migration 010 file exists', async () => {
  ok(fs.existsSync(MIG10_PATH), 'migrations/010_booking_events_pre_activation_fix.sql exists');
});

test('[Q-02] migration 010 adds event_observed_at TIMESTAMPTZ NOT NULL', async () => {
  ok(/event_observed_at TIMESTAMPTZ NOT NULL/i.test(mig10Src), 'event_observed_at TIMESTAMPTZ NOT NULL');
});

test('[Q-03] migration 010 adds provider_event_at TIMESTAMPTZ NULL', async () => {
  ok(/provider_event_at TIMESTAMPTZ NULL/i.test(mig10Src), 'provider_event_at TIMESTAMPTZ NULL');
});

test('[Q-04] migration 010 has no DROP statement (excluding comments)', async () => {
  ok(!/\bDROP\b/i.test(mig10NoComments), 'no DROP in migration 010 SQL (comments excluded)');
});

test('[Q-05] migration 010 has no TRUNCATE (excluding comments)', async () => {
  ok(!/\bTRUNCATE\b/i.test(mig10NoComments), 'no TRUNCATE in migration 010 SQL (comments excluded)');
});

test('[Q-06] migration 010 has no INSERT', async () => {
  ok(!/\bINSERT\b/i.test(mig10NoComments), 'no INSERT in migration 010 — no backfill');
});

test('[Q-07] migration 010 uses ALTER TABLE ADD COLUMN IF NOT EXISTS (additive only)', async () => {
  ok(/ALTER TABLE/i.test(mig10Src), 'has ALTER TABLE');
  ok(/ADD COLUMN IF NOT EXISTS/i.test(mig10Src), 'uses ADD COLUMN IF NOT EXISTS');
  ok(!/DROP COLUMN/i.test(mig10NoComments), 'no DROP COLUMN');
});

test('[Q-08] migration 010 has idx_booking_events_observed_at index', async () => {
  ok(mig10Src.includes('idx_booking_events_observed_at'), 'temporal index present');
});

test('[Q-09] migration 010 does NOT add booking_created_at column (deferred, excluding comments)', async () => {
  ok(!/booking_created_at\s/i.test(mig10NoComments), 'booking_created_at not in migration 010 SQL');
});

test('[Q-10] migration 010 event_observed_at has DEFAULT NOW()', async () => {
  ok(/event_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i.test(mig10Src),
    'event_observed_at has DEFAULT NOW()');
});

// ── [R] Readiness audit — PREACT-FIX checks ───────────────────────────────────

const audSrc = fs.existsSync(AUD_PATH) ? fs.readFileSync(AUD_PATH, 'utf8') : '';

test('[R-01] readiness audit uses pg_catalog for table detection (not information_schema)', async () => {
  ok(audSrc.includes('pg_catalog.pg_class'), 'uses pg_catalog.pg_class');
  ok(!audSrc.includes("information_schema.tables\n  WHERE table_schema = 'public' AND table_name = 'booking_events'"),
    'does NOT use information_schema.tables for booking_events detection');
});

test('[R-02] readiness audit pool config includes SSL for production', async () => {
  ok(audSrc.includes('rejectUnauthorized'), 'SSL rejectUnauthorized in pool config');
  ok(audSrc.includes('NODE_ENV'), 'NODE_ENV check for SSL in pool config');
});

test('[R-03] readiness audit exports auditMigration009', async () => {
  const audit = require(AUD_PATH);
  eq(typeof audit.auditMigration009, 'function');
});

test('[R-04] readiness audit exports auditMigration010', async () => {
  const audit = require(AUD_PATH);
  eq(typeof audit.auditMigration010, 'function');
});

test('[R-05] auditMigration010 detects event_observed_at and provider_event_at in file', async () => {
  const audit = require(AUD_PATH);
  const result = audit.auditMigration010();
  ok(result.ok === true, `auditMigration010 should pass: ${JSON.stringify(result.results)}`);
  ok(result.results.has_event_observed_at, 'migration 010 has event_observed_at');
  ok(result.results.has_provider_event_at, 'migration 010 has provider_event_at');
});

test('[R-06] runAudit includes MIGRATION_010 section', async () => {
  const audit = require(AUD_PATH);
  const report = await audit.runAudit();
  const names = report.sections.map(s => s.section);
  ok(names.includes('MIGRATION_010'), 'MIGRATION_010 section present');
  ok(names.includes('MIGRATION_009'), 'MIGRATION_009 section present');
});

test('[R-07] readiness audit SAFE_TO_ENABLE_FLAG logic references migration_010_applied', async () => {
  ok(audSrc.includes('migration_010_applied'), 'SAFE_TO_ENABLE_FLAG requires migration 010');
  ok(audSrc.includes('safe_to_enable_flag'), 'safe_to_enable_flag field present');
});

test('[R-08] readiness audit checks event_observed_at and provider_event_at columns in DB section', async () => {
  ok(audSrc.includes('event_observed_at_present'), 'DB section checks event_observed_at presence');
  ok(audSrc.includes('provider_event_at_present'), 'DB section checks provider_event_at presence');
});

test('[R-09] readiness audit SERVICE_FILE checks has_event_observed_at in service', async () => {
  ok(audSrc.includes('has_event_observed_at'), 'SERVICE_FILE checks event_observed_at in service');
});

test('[R-10] readiness audit service check verifies event_observed_at not in fingerprint', async () => {
  ok(audSrc.includes('event_observed_at_not_in_fingerprint'),
    'service check verifies event_observed_at excluded from fingerprint');
});

test('[R-11] post-activation audit uses pg_catalog for table detection', async () => {
  const postSrc = fs.existsSync(POST_AUD_PATH) ? fs.readFileSync(POST_AUD_PATH, 'utf8') : '';
  ok(postSrc.includes('pg_catalog'), 'post-activation audit uses pg_catalog');
});

test('[R-12] post-activation audit pool config includes SSL for production', async () => {
  const postSrc = fs.existsSync(POST_AUD_PATH) ? fs.readFileSync(POST_AUD_PATH, 'utf8') : '';
  ok(postSrc.includes('rejectUnauthorized'), 'post-activation audit SSL rejectUnauthorized');
  ok(postSrc.includes('NODE_ENV'), 'post-activation audit NODE_ENV check');
});

test('[R-13] post-activation audit SQL_RECENT_EVENTS includes event_observed_at', async () => {
  const postSrc = fs.existsSync(POST_AUD_PATH) ? fs.readFileSync(POST_AUD_PATH, 'utf8') : '';
  ok(postSrc.includes('event_observed_at'), 'event_observed_at referenced in post-audit');
});

test('[R-14] post-activation audit orders recent events by event_observed_at (not created_at)', async () => {
  const postSrc = fs.existsSync(POST_AUD_PATH) ? fs.readFileSync(POST_AUD_PATH, 'utf8') : '';
  ok(/ORDER BY event_observed_at DESC/i.test(postSrc), 'recent events ordered by event_observed_at');
});

// ── [O] Audit tool self-read-only ──────────────────────────────────────────

test('[O-01] readiness audit checkAuditToolReadOnly returns no violations', async () => {
  const audit = require(AUD_PATH);
  const violations = audit.checkAuditToolReadOnly();
  assert.deepStrictEqual(violations, [], `Violations: ${JSON.stringify(violations)}`);
});

test('[O-02] readiness audit SQL template literals are SELECT-only', async () => {
  const src = fs.readFileSync(AUD_PATH, 'utf8');
  const sqlBlocks = (src.match(/`[\s\S]*?`/g) || []).join('\n');
  ok(!/\bINSERT\s+INTO\b/i.test(sqlBlocks), 'No INSERT INTO in SQL template literals');
  ok(!/\bDELETE\s+FROM\b/i.test(sqlBlocks), 'No DELETE FROM in SQL template literals');
  ok(!/\bDROP\s+TABLE\b/i.test(sqlBlocks), 'No DROP TABLE in SQL template literals');
});

test('[O-03] post-activation audit file exists', async () => {
  const postPath = path.join(__dirname, '../outils/audit-booking-event-persistence-post-p1_5_t21.js');
  ok(fs.existsSync(postPath));
});

// ── Summary ───────────────────────────────────────────────────────────────────

async function main() {
  await new Promise(resolve => setImmediate(resolve));

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`P1.5-T2.1: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED:`);
    for (const f of failures) console.error(`  • ${f.name}: ${f.message}`);
    process.exit(1);
  } else {
    console.log('All tests passed ✅');
  }
}

main().catch(err => { console.error(err); process.exit(1); });

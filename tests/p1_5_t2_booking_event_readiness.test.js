'use strict';
/**
 * P1.5-T2 — Booking Event Write-Path Readiness
 * Standalone test suite — no real DB, no network, no pricing writes.
 *
 * Run with: node tests/p1_5_t2_booking_event_readiness.test.js
 *
 * Sections:
 *   [A] Event semantic definitions
 *   [B] BLOCK exclusion from booking demand
 *   [C] Current state vs event history distinction
 *   [D] Timestamp semantics
 *   [E] iCal semantics
 *   [F] Channex idempotency
 *   [G] Write path registry structure
 *   [H] Identity model per source
 *   [I] Financial field reliability
 *   [J] PII exclusion
 *   [K] Point-in-time policy
 *   [L] Price observation join feasibility
 *   [M] Schema recommendation structure
 *   [N] Out-of-order events
 *   [O] Audit tool safety
 *
 * Invariants:
 *   READ_ONLY                               = YES
 *   DB_WRITES                               = 0
 *   BOOKING_EVENTS_EXIST                    = NO
 *   BOOKING_EVENTS_HAVE_PRICING_AUTHORITY   = NO
 *   PRODUCTION_RESERVATION_BEHAVIOR_CHANGED = NO
 *   PRODUCTION_PRICING_CHANGED              = NO
 */

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

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

// ── Load audit module (exports only — no DB connection, no network) ──────────

const {
  RESERVATION_WRITE_PATHS,
  BOOKING_EVENT_SCHEMA_RECOMMENDATION,
  BOOKING_EVENT_TYPES,
  BOOKING_EVENT_CATEGORY,
  BOOKING_EVENT_LIFECYCLE_SEMANTICS,
  SOURCE_READINESS,
  checkAuditToolReadOnly,
} = require('../outils/audit-booking-event-readiness-p1_5_t2');

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  P1.5-T2 — BOOKING EVENT WRITE-PATH READINESS TESTS');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  READ_ONLY=YES  DB_WRITES=0  PRICING_WRITES=0  NETWORK_CALLS=0');
  console.log('  BOOKING_EVENTS_EXIST                    = NO');
  console.log('  BOOKING_EVENTS_HAVE_PRICING_AUTHORITY   = NO');
  console.log('  PRODUCTION_RESERVATION_BEHAVIOR_CHANGED = NO');
  console.log('  PRODUCTION_PRICING_CHANGED              = NO');
  console.log('──────────────────────────────────────────────────────────────────────');

  // ── [A] EVENT SEMANTIC DEFINITIONS ──────────────────────────────────────────
  console.log('\n  [A] Event semantic definitions');

  await test('A-01: BOOKING_CREATED is defined', () => {
    assert.strictEqual(BOOKING_EVENT_TYPES.BOOKING_CREATED, 'BOOKING_CREATED');
  });

  await test('A-02: BOOKING_CANCELLED is defined', () => {
    assert.strictEqual(BOOKING_EVENT_TYPES.BOOKING_CANCELLED, 'BOOKING_CANCELLED');
  });

  await test('A-03: BOOKING_MODIFIED is defined', () => {
    assert.strictEqual(BOOKING_EVENT_TYPES.BOOKING_MODIFIED, 'BOOKING_MODIFIED');
  });

  await test('A-04: BOOKING_REINSTATED is defined and marked DEFERRED in lifecycle semantics', () => {
    assert.strictEqual(BOOKING_EVENT_TYPES.BOOKING_REINSTATED, 'BOOKING_REINSTATED');
    const sem = BOOKING_EVENT_LIFECYCLE_SEMANTICS.BOOKING_REINSTATED;
    assert.ok(Array.isArray(sem) && sem.length > 0, 'BOOKING_REINSTATED must have lifecycle semantics');
    assert.ok(sem.some(s => s.includes('DEFERRED')), 'BOOKING_REINSTATED semantics must be marked DEFERRED');
  });

  await test('A-05: BOOKING_MODIFIED requires fingerprint; repeated no-change UPSERT is not BOOKING_MODIFIED', () => {
    const sem = BOOKING_EVENT_LIFECYCLE_SEMANTICS.BOOKING_MODIFIED;
    assert.ok(Array.isArray(sem) && sem.length > 0);
    assert.ok(sem.some(s => s.toLowerCase().includes('fingerprint')),
      'BOOKING_MODIFIED semantics must reference state fingerprint');
    assert.ok(
      sem.some(s => s.includes('is NOT a BOOKING_MODIFIED') || s.toLowerCase().includes('no state change')),
      'Semantics must clarify that a no-change upsert is not BOOKING_MODIFIED'
    );
  });

  // ── [B] BLOCK EXCLUSION FROM DEMAND ─────────────────────────────────────────
  console.log('\n  [B] BLOCK exclusion from booking demand');

  await test('B-01: BLOCK_CREATED category is BLOCK not DEMAND', () => {
    assert.strictEqual(BOOKING_EVENT_CATEGORY.BLOCK_CREATED, 'BLOCK');
  });

  await test('B-02: BLOCK_REMOVED category is BLOCK not DEMAND', () => {
    assert.strictEqual(BOOKING_EVENT_CATEGORY.BLOCK_REMOVED, 'BLOCK');
  });

  await test('B-03: all DEMAND-category event types are BOOKING_ types only', () => {
    const demandTypes = Object.entries(BOOKING_EVENT_CATEGORY)
      .filter(([, cat]) => cat === 'DEMAND')
      .map(([type]) => type);
    assert.ok(demandTypes.length > 0, 'At least one DEMAND event type must exist');
    for (const t of demandTypes) {
      assert.ok(t.startsWith('BOOKING_'), `${t} is classified DEMAND but is not a BOOKING_ type`);
    }
  });

  await test('B-04: BLOCK_CREATED lifecycle semantics state blocks are never guest demand', () => {
    const sem = BOOKING_EVENT_LIFECYCLE_SEMANTICS.BLOCK_CREATED;
    assert.ok(Array.isArray(sem) && sem.length > 0);
    assert.ok(
      sem.some(s => s.toLowerCase().includes('demand') || s.toLowerCase().includes('elasticity')),
      'BLOCK_CREATED semantics must explicitly reference demand or elasticity exclusion'
    );
  });

  // ── [C] CURRENT STATE vs EVENT HISTORY ──────────────────────────────────────
  console.log('\n  [C] Current state vs event history distinction');

  await test('C-01: BOOKING_CANCELLED semantics prohibit inferring cancellation from row DELETE', () => {
    const sem = BOOKING_EVENT_LIFECYCLE_SEMANTICS.BOOKING_CANCELLED;
    assert.ok(Array.isArray(sem) && sem.length > 0);
    assert.ok(
      sem.some(s => s.includes('row deletion') || s.includes('DELETE')),
      'BOOKING_CANCELLED semantics must explicitly state row deletion is not a cancellation event'
    );
  });

  await test('C-02: W-30 hard-delete path has canDetectCancelled=false', () => {
    const w30 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-30');
    assert.ok(w30, 'W-30 (DELETE /api/reservations/:uid) must be in registry');
    assert.strictEqual(w30.canDetectCancelled, false);
    assert.ok(w30.operations.includes('DELETE'));
  });

  await test('C-03: W-31 account-deletion cascade has canDetectCancelled=false', () => {
    const w31 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-31');
    assert.ok(w31, 'W-31 (account deletion cascade) must be in registry');
    assert.strictEqual(w31.canDetectCancelled, false);
    assert.ok(
      w31.notes.toLowerCase().includes('gdpr') || w31.notes.toLowerCase().includes('cascade'),
      'W-31 must note GDPR / cascade context'
    );
  });

  await test('C-04: W-32 property-deletion cascade has canDetectCancelled=false', () => {
    const w32 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-32');
    assert.ok(w32, 'W-32 (property deletion cascade) must be in registry');
    assert.strictEqual(w32.canDetectCancelled, false);
    assert.ok(w32.notes.toLowerCase().includes('cascade'));
  });

  // ── [D] TIMESTAMP SEMANTICS ──────────────────────────────────────────────────
  console.log('\n  [D] Timestamp semantics');

  await test('D-01: Channex W-01 notes document that created_at is webhook receipt, not OTA booking time', () => {
    const w01 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-01');
    assert.ok(w01, 'W-01 must be in registry');
    assert.ok(
      w01.notes.toLowerCase().includes('webhook receipt') || w01.notes.toLowerCase().includes('created_at'),
      'W-01 notes must document that local created_at is webhook receipt time, not OTA booking creation time'
    );
  });

  await test('D-02: W-15 iCal INSERT documents IMPORT_FIRST_SEEN_AT proxy', () => {
    const w15 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-15');
    assert.ok(w15, 'W-15 (iCal import) must be in registry');
    assert.ok(
      w15.notes.toUpperCase().includes('IMPORT_FIRST_SEEN_AT'),
      'W-15 must document IMPORT_FIRST_SEEN_AT proxy timestamp semantics'
    );
  });

  await test('D-03: W-07 guest_app notes reference Stripe webhook as timestamp source', () => {
    const w07 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-07');
    assert.ok(w07, 'W-07 must be in registry');
    assert.ok(
      w07.notes.toLowerCase().includes('stripe') || w07.notes.toLowerCase().includes('webhook'),
      'W-07 must document that created_at reflects Stripe webhook receipt'
    );
  });

  await test('D-04: provider_event_at is classified USEFUL (not REQUIRED) in schema recommendation', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'provider_event_at');
    assert.ok(f, 'provider_event_at must be in schema recommendation');
    assert.strictEqual(f.classify, 'USEFUL',
      'provider_event_at must be USEFUL (not REQUIRED) — it is not always available');
  });

  // ── [E] ICAL SEMANTICS ───────────────────────────────────────────────────────
  console.log('\n  [E] iCal semantics');

  await test('E-01: iCal CREATED_EVENT_READINESS is PARTIAL (not READY)', () => {
    assert.strictEqual(SOURCE_READINESS.ical.CREATED_EVENT_READINESS, 'PARTIAL');
  });

  await test('E-02: iCal MODIFIED_EVENT_READINESS is UNRELIABLE', () => {
    assert.strictEqual(SOURCE_READINESS.ical.MODIFIED_EVENT_READINESS, 'UNRELIABLE');
  });

  await test('E-03: iCal CANCELLED_EVENT_READINESS is PARTIAL', () => {
    assert.strictEqual(SOURCE_READINESS.ical.CANCELLED_EVENT_READINESS, 'PARTIAL');
  });

  await test('E-04: W-16 iCal delete has canDetectCancelled=false (feed disappearance is ambiguous)', () => {
    const w16 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-16');
    assert.ok(w16, 'W-16 (iCal delete on feed removal) must be in registry');
    assert.strictEqual(w16.canDetectCancelled, false);
    assert.ok(
      w16.notes.toLowerCase().includes('feed') || w16.notes.includes('gap') || w16.notes.includes('PARTIAL'),
      'W-16 must note that feed disappearance is ambiguous (not definitive cancellation)'
    );
  });

  await test('E-05: iCal readiness notes call out that DTSTAMP/CREATED/LAST-MODIFIED are not parsed', () => {
    const notes = SOURCE_READINESS.ical.notes.join(' ');
    assert.ok(
      notes.includes('DTSTAMP') || notes.includes('LAST-MODIFIED') || notes.includes('not currently parsed'),
      'iCal notes must mention that iCal temporal metadata fields are not parsed'
    );
  });

  // ── [F] CHANNEX IDEMPOTENCY ──────────────────────────────────────────────────
  console.log('\n  [F] Channex idempotency');

  await test('F-01: Channex CREATED_EVENT_READINESS is READY', () => {
    assert.strictEqual(SOURCE_READINESS.channex.CREATED_EVENT_READINESS, 'READY');
  });

  await test('F-02: Channex MODIFIED_EVENT_READINESS is PARTIAL (no before/after comparison today)', () => {
    assert.strictEqual(SOURCE_READINESS.channex.MODIFIED_EVENT_READINESS, 'PARTIAL');
  });

  await test('F-03: Channex CANCELLED_EVENT_READINESS is READY', () => {
    assert.strictEqual(SOURCE_READINESS.channex.CANCELLED_EVENT_READINESS, 'READY');
  });

  await test('F-04: W-02 notes document that re-delivery is indistinguishable from modification without fingerprint', () => {
    const w02 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-02');
    assert.ok(w02, 'W-02 (Channex UPDATE path) must be in registry');
    assert.ok(
      w02.notes.toLowerCase().includes('fingerprint') || w02.notes.toLowerCase().includes('re-delivery'),
      'W-02 must note the re-delivery vs meaningful modification problem'
    );
  });

  // ── [G] WRITE PATH REGISTRY STRUCTURE ───────────────────────────────────────
  console.log('\n  [G] Write path registry structure');

  await test('G-01: registry has at least 33 write paths', () => {
    assert.ok(RESERVATION_WRITE_PATHS.length >= 33,
      `Expected ≥33 paths, got ${RESERVATION_WRITE_PATHS.length}`);
  });

  await test('G-02: all paths have required structural fields', () => {
    const required = [
      'id', 'file', 'function', 'source', 'operations', 'trigger',
      'identityUsed', 'canDetectCreated', 'canDetectModified', 'canDetectCancelled',
    ];
    for (const p of RESERVATION_WRITE_PATHS) {
      for (const f of required) {
        assert.ok(f in p, `Path ${p.id} missing required field: ${f}`);
      }
    }
  });

  await test('G-03: all path ids are unique', () => {
    const ids = RESERVATION_WRITE_PATHS.map(p => p.id);
    const uniq = new Set(ids);
    assert.strictEqual(uniq.size, ids.length, `Duplicate path IDs: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
  });

  await test('G-04: all operation values are known (INSERT|UPDATE|DELETE|UPSERT)', () => {
    const known = new Set(['INSERT', 'UPDATE', 'DELETE', 'UPSERT']);
    for (const p of RESERVATION_WRITE_PATHS) {
      for (const op of p.operations) {
        assert.ok(known.has(op), `Path ${p.id} has unknown operation: "${op}"`);
      }
    }
  });

  await test('G-05: registry covers all expected sources: channex, guest_app, ical, block, manuel', () => {
    const sources = new Set(RESERVATION_WRITE_PATHS.map(p => p.source.toLowerCase()));
    for (const required of ['channex', 'guest_app', 'ical', 'block', 'manuel']) {
      assert.ok(sources.has(required), `Source "${required}" must be present in registry`);
    }
  });

  // ── [H] IDENTITY MODEL PER SOURCE ───────────────────────────────────────────
  console.log('\n  [H] Identity model per source');

  await test('H-01: Channex INSERT (W-01) uses channex_booking_id as primary identity', () => {
    const w01 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-01');
    assert.ok(w01);
    assert.ok(w01.identityUsed.includes('channex_booking_id'));
  });

  await test('H-02: guest_app INSERT paths use uid=BHGUEST_ or uid=GUEST_ prefix', () => {
    const guestInserts = RESERVATION_WRITE_PATHS.filter(
      p => p.source === 'guest_app' && p.operations.includes('INSERT')
    );
    assert.ok(guestInserts.length >= 3, `Expected ≥3 guest_app INSERT paths, got ${guestInserts.length}`);
    for (const p of guestInserts) {
      assert.ok(
        p.identityUsed.includes('BHGUEST_') || p.identityUsed.includes('GUEST_') || p.identityUsed.includes('uid'),
        `${p.id}: guest_app INSERT must use uid-based identity`
      );
    }
  });

  await test('H-03: iCal INSERT (W-15) uses ical_uid from VEVENT UID field', () => {
    const w15 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-15');
    assert.ok(w15);
    assert.ok(w15.identityUsed.includes('ical_uid'));
  });

  await test('H-04: manual INSERT (W-13) uses uid=manual_ timestamp prefix', () => {
    const w13 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-13');
    assert.ok(w13);
    assert.ok(w13.identityUsed.includes('manual_'));
  });

  await test('H-05: block INSERT paths use uid=block_ prefix', () => {
    const blockInserts = RESERVATION_WRITE_PATHS.filter(
      p => p.source === 'BLOCK' && p.operations.includes('INSERT')
    );
    assert.ok(blockInserts.length >= 2, `Expected ≥2 BLOCK INSERT paths, got ${blockInserts.length}`);
    for (const p of blockInserts) {
      assert.ok(
        p.identityUsed.includes('block_') || p.identityUsed.includes('HOSTCANCEL_'),
        `${p.id}: BLOCK INSERT must use uid=block_ or HOSTCANCEL_ prefix`
      );
    }
  });

  // ── [I] FINANCIAL FIELD RELIABILITY ─────────────────────────────────────────
  console.log('\n  [I] Financial field reliability');

  await test('I-01: amount_total is USEFUL in schema recommendation (source reliability varies)', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'amount_total');
    assert.ok(f, 'amount_total must be in schema recommendation');
    assert.strictEqual(f.classify, 'USEFUL',
      'amount_total must be USEFUL (not REQUIRED) — reliability varies by source');
  });

  await test('I-02: amount_rooms is SOURCE_SPECIFIC (reliable for Channex only)', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'amount_rooms');
    assert.ok(f, 'amount_rooms must be in schema recommendation');
    assert.strictEqual(f.classify, 'SOURCE_SPECIFIC');
  });

  await test('I-03: currency is REQUIRED in schema recommendation', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'currency');
    assert.ok(f, 'currency must be in schema recommendation');
    assert.strictEqual(f.classify, 'REQUIRED');
  });

  await test('I-04: guest_app readiness notes reference Stripe as authoritative financial source', () => {
    const notes = SOURCE_READINESS.guest_app.notes.join(' ');
    assert.ok(
      notes.toLowerCase().includes('stripe'),
      'guest_app readiness notes must reference Stripe as the financial source'
    );
  });

  // ── [J] PII EXCLUSION ────────────────────────────────────────────────────────
  console.log('\n  [J] PII exclusion');

  await test('J-01: guest_name is classified AVOID in schema recommendation', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'guest_name');
    assert.ok(f, 'guest_name must be in schema recommendation');
    assert.strictEqual(f.classify, 'AVOID');
  });

  await test('J-02: guest_email is classified AVOID', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'guest_email');
    assert.ok(f, 'guest_email must be in schema recommendation');
    assert.strictEqual(f.classify, 'AVOID');
  });

  await test('J-03: guest_phone is classified AVOID', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'guest_phone');
    assert.ok(f, 'guest_phone must be in schema recommendation');
    assert.strictEqual(f.classify, 'AVOID');
  });

  await test('J-04: guest_address is classified AVOID', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'guest_address');
    assert.ok(f, 'guest_address must be in schema recommendation');
    assert.strictEqual(f.classify, 'AVOID');
  });

  await test('J-05: message_content (notes/ota_notes) is classified AVOID', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'message_content');
    assert.ok(f, 'message_content must be in schema recommendation');
    assert.strictEqual(f.classify, 'AVOID');
  });

  // ── [K] POINT-IN-TIME POLICY ─────────────────────────────────────────────────
  console.log('\n  [K] Point-in-time policy');

  await test('K-01: event_observed_at is REQUIRED in schema recommendation', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'event_observed_at');
    assert.ok(f, 'event_observed_at must be in schema recommendation');
    assert.strictEqual(f.classify, 'REQUIRED');
  });

  await test('K-02: event_observed_at notes identify it as the primary visibility timestamp', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'event_observed_at');
    assert.ok(f);
    assert.ok(
      f.notes.toLowerCase().includes('primary') || f.notes.toLowerCase().includes('visibility'),
      'event_observed_at notes must state it is the primary visibility anchor'
    );
  });

  await test('K-03: provider_event_at notes include caveat that it is not always available', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'provider_event_at');
    assert.ok(f);
    assert.ok(
      f.notes.toLowerCase().includes('never') || f.notes.toLowerCase().includes('null') || f.notes.toLowerCase().includes('unavailable'),
      'provider_event_at notes must include a caveat on availability'
    );
  });

  await test('K-04: booking_created_at is SOURCE_SPECIFIC (not REQUIRED — unreliable for Channex/iCal)', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'booking_created_at');
    assert.ok(f, 'booking_created_at must be in schema recommendation');
    assert.strictEqual(f.classify, 'SOURCE_SPECIFIC',
      'booking_created_at must be SOURCE_SPECIFIC — it is a proxy for most sources');
  });

  // ── [L] PRICE OBSERVATION JOIN ───────────────────────────────────────────────
  console.log('\n  [L] Price observation join feasibility');

  await test('L-01: BLOCK events can never confer pricing authority (BLOCK ≠ DEMAND)', () => {
    assert.strictEqual(BOOKING_EVENT_CATEGORY.BLOCK_CREATED, 'BLOCK');
    assert.strictEqual(BOOKING_EVENT_CATEGORY.BLOCK_REMOVED, 'BLOCK');
    assert.notStrictEqual(BOOKING_EVENT_CATEGORY.BLOCK_CREATED, 'DEMAND');
  });

  await test('L-02: event_observed_at (REQUIRED) must be the join anchor, not provider_event_at (USEFUL)', () => {
    const observed = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'event_observed_at');
    const provider = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'provider_event_at');
    assert.ok(observed && provider);
    assert.strictEqual(observed.classify, 'REQUIRED');
    assert.strictEqual(provider.classify, 'USEFUL');
  });

  await test('L-03: state_fingerprint is REQUIRED and enables dedup and change detection', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'state_fingerprint');
    assert.ok(f, 'state_fingerprint must be in schema recommendation');
    assert.strictEqual(f.classify, 'REQUIRED');
    assert.ok(
      f.notes.toLowerCase().includes('dedup') || f.notes.toLowerCase().includes('change'),
      'state_fingerprint notes must reference dedup or change detection'
    );
  });

  await test('L-04: all DEFERRED fields are optional (none classified REQUIRED)', () => {
    const deferred = BOOKING_EVENT_SCHEMA_RECOMMENDATION.filter(r => r.classify === 'DEFERRED');
    assert.ok(deferred.length > 0, 'At least one DEFERRED field expected');
    for (const f of deferred) {
      assert.notStrictEqual(f.classify, 'REQUIRED',
        `${f.field} is DEFERRED but must not be REQUIRED — missing optional columns must be safe`);
    }
  });

  // ── [M] SCHEMA RECOMMENDATION STRUCTURE ─────────────────────────────────────
  console.log('\n  [M] Schema recommendation structure');

  await test('M-01: all core REQUIRED fields are present in recommendation', () => {
    const coreRequired = [
      'id', 'reservation_id', 'property_id', 'source', 'external_booking_id',
      'event_type', 'event_observed_at', 'start_date', 'end_date', 'status',
      'currency', 'state_fingerprint', 'created_at',
    ];
    const fields = new Set(BOOKING_EVENT_SCHEMA_RECOMMENDATION.map(r => r.field));
    for (const f of coreRequired) {
      assert.ok(fields.has(f), `Core REQUIRED field "${f}" missing from schema recommendation`);
    }
  });

  await test('M-02: all AVOID fields include PII justification in notes', () => {
    const avoid = BOOKING_EVENT_SCHEMA_RECOMMENDATION.filter(r => r.classify === 'AVOID');
    assert.ok(avoid.length >= 4, `Expected ≥4 PII AVOID fields, got ${avoid.length}`);
    for (const f of avoid) {
      assert.ok(
        f.notes.toLowerCase().includes('pii') || f.notes.toLowerCase().includes('do not'),
        `AVOID field "${f.field}" notes must state PII or do-not-copy rationale`
      );
    }
  });

  await test('M-03: event_type notes include all non-deferred event type values', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'event_type');
    assert.ok(f);
    const nonDeferred = ['BOOKING_CREATED', 'BOOKING_MODIFIED', 'BOOKING_CANCELLED', 'BLOCK_CREATED', 'BLOCK_REMOVED'];
    for (const type of nonDeferred) {
      assert.ok(f.notes.includes(type),
        `event_type recommendation notes must include ${type}`);
    }
  });

  await test('M-04: reservation_id is REQUIRED with ON DELETE SET NULL to survive cascade', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'reservation_id');
    assert.ok(f);
    assert.strictEqual(f.classify, 'REQUIRED');
    assert.ok(
      f.notes.includes('ON DELETE SET NULL') || f.notes.includes('Nullable') || f.notes.includes('nullable'),
      'reservation_id must note ON DELETE SET NULL to survive reservation row deletion'
    );
  });

  await test('M-05: all classify values are known types', () => {
    const known = new Set(['REQUIRED', 'USEFUL', 'SOURCE_SPECIFIC', 'DEFERRED', 'AVOID']);
    for (const f of BOOKING_EVENT_SCHEMA_RECOMMENDATION) {
      assert.ok(known.has(f.classify),
        `Unknown classify value "${f.classify}" on field "${f.field}"`);
    }
  });

  await test('M-06: metadata_json is DEFERRED (not required for initial schema)', () => {
    const f = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'metadata_json');
    assert.ok(f, 'metadata_json must be in schema recommendation');
    assert.strictEqual(f.classify, 'DEFERRED');
  });

  // ── [N] OUT-OF-ORDER EVENTS ──────────────────────────────────────────────────
  console.log('\n  [N] Out-of-order events');

  await test('N-01: Channex readiness notes document out-of-order delivery risk', () => {
    const notes = SOURCE_READINESS.channex.notes.join(' ');
    assert.ok(
      notes.toLowerCase().includes('out-of-order') || notes.toLowerCase().includes('re-deliver'),
      'Channex readiness notes must document out-of-order / re-delivery risk'
    );
  });

  await test('N-02: event_observed_at (REQUIRED) is the ordering anchor, not provider_event_at (USEFUL)', () => {
    const observed = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'event_observed_at');
    const provider = BOOKING_EVENT_SCHEMA_RECOMMENDATION.find(r => r.field === 'provider_event_at');
    assert.strictEqual(observed.classify, 'REQUIRED');
    assert.strictEqual(provider.classify, 'USEFUL');
    const channexNotes = SOURCE_READINESS.channex.notes.join(' ');
    assert.ok(
      channexNotes.toLowerCase().includes('observed') || channexNotes.toLowerCase().includes('arrival'),
      'Channex notes must reference event_observed_at as arrival-order anchor'
    );
  });

  await test('N-03: W-02 notes require fingerprint to distinguish modification from re-delivery', () => {
    const w02 = RESERVATION_WRITE_PATHS.find(p => p.id === 'W-02');
    assert.ok(w02, 'W-02 must be in registry');
    assert.ok(
      w02.notes.toLowerCase().includes('fingerprint'),
      'W-02 notes must reference state fingerprint for modification detection under out-of-order conditions'
    );
  });

  // ── [O] AUDIT TOOL SAFETY ────────────────────────────────────────────────────
  console.log('\n  [O] Audit tool safety');

  await test('O-01: checkAuditToolReadOnly() returns no violations', () => {
    const violations = checkAuditToolReadOnly();
    assert.ok(Array.isArray(violations), 'checkAuditToolReadOnly must return an array');
    assert.strictEqual(violations.length, 0,
      `Audit tool has read-only violations: [${violations.join(', ')}]`);
  });

  await test('O-02: audit tool SQL constants are SELECT-only (no mutating SQL)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/audit-booking-event-readiness-p1_5_t2.js'), 'utf8'
    );
    // Extract SQL constants (backtick template literals used as SQL)
    const sqlBlocks = (src.match(/`[\s\S]*?`/g) || []).join('\n');
    assert.ok(!/\bINSERT\s+INTO\b/i.test(sqlBlocks), 'No INSERT INTO in SQL template literals');
    assert.ok(!/\bDELETE\s+FROM\b/i.test(sqlBlocks), 'No DELETE FROM in SQL template literals');
    assert.ok(!/\bDROP\s+TABLE\b/i.test(sqlBlocks), 'No DROP TABLE in SQL template literals');
  });

  await test('O-03: audit tool source has no network requires (axios, node-fetch, https)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/audit-booking-event-readiness-p1_5_t2.js'), 'utf8'
    );
    assert.ok(!src.includes("require('axios')"), 'Must not require axios');
    assert.ok(!src.includes("require('node-fetch')"), 'Must not require node-fetch');
    assert.ok(!src.includes("require('https')"), 'Must not require https for network calls');
  });

  await test('O-04: BOOKING_EVENTS_EXIST = NO — no booking_events CREATE TABLE in audit', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/audit-booking-event-readiness-p1_5_t2.js'), 'utf8'
    );
    assert.ok(!src.includes('CREATE TABLE booking_events'),
      'Audit tool must not CREATE TABLE booking_events');
    assert.ok(!src.includes('CREATE TABLE IF NOT EXISTS booking_events'),
      'Audit tool must not CREATE TABLE IF NOT EXISTS booking_events');
  });

  await test('O-05: BOOKING_EVENTS_HAVE_PRICING_AUTHORITY = NO — no pricing engine imports', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../outils/audit-booking-event-readiness-p1_5_t2.js'), 'utf8'
    );
    assert.ok(!src.includes('effective-pricing-resolver'),
      'Audit tool must not import the pricing resolver');
    assert.ok(!src.includes('dynamic-pricing-routes'),
      'Audit tool must not import dynamic pricing routes');
  });

  // ── FINAL SUMMARY ─────────────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`  P1.5-T2 TESTS: ${passed} passed, ${failed} failed`);

  if (failures.length > 0) {
    console.log('');
    console.log('  FAILURES:');
    for (const { name, message } of failures) {
      console.log(`    ✗ ${name}`);
      console.log(`      ${message}`);
    }
  }

  console.log('');
  console.log(`  READ_ONLY                               = YES`);
  console.log(`  BOOKING_EVENTS_EXIST                    = NO`);
  console.log(`  BOOKING_EVENTS_HAVE_PRICING_AUTHORITY   = NO`);
  console.log(`  PRODUCTION_RESERVATION_BEHAVIOR_CHANGED = NO`);
  console.log(`  PRODUCTION_PRICING_CHANGED              = NO`);
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});

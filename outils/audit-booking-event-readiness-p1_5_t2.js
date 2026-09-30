'use strict';
/**
 * P1.5-T2 — Booking Event Write-Path Readiness Audit
 *
 * READ-ONLY audit of every reservation write path in Boostinghost.
 * Determines readiness for a future immutable booking_events history.
 *
 * SAFETY:
 *   READ_ONLY                                    = YES
 *   DB_WRITES                                    = 0  always
 *   PRICING_WRITES                               = 0  always
 *   CHANNEX_WRITES                               = 0  always
 *   LIVE_NETWORK_CALLS                           = 0  always
 *   BOOKING_EVENTS_EXIST                         = NO
 *   BOOKING_EVENTS_HAVE_PRICING_AUTHORITY        = NO
 *   PRODUCTION_RESERVATION_BEHAVIOR_CHANGED      = NO
 *   PRODUCTION_PRICING_CHANGED                   = NO
 *
 * Usage:
 *   NODE_ENV=production node outils/audit-booking-event-readiness-p1_5_t2.js
 */

const path = require('path');
const fs   = require('fs');

// ── Event type definitions ────────────────────────────────────────────────────

const BOOKING_EVENT_TYPES = Object.freeze({
  BOOKING_CREATED:     'BOOKING_CREATED',
  BOOKING_MODIFIED:    'BOOKING_MODIFIED',
  BOOKING_CANCELLED:   'BOOKING_CANCELLED',
  BOOKING_REINSTATED:  'BOOKING_REINSTATED',  // DEFERRED — not in initial scope
  BLOCK_CREATED:       'BLOCK_CREATED',
  BLOCK_REMOVED:       'BLOCK_REMOVED',
});

// Event category: DEMAND (counts toward pickup/elasticity) vs BLOCK (capacity, not demand)
const BOOKING_EVENT_CATEGORY = Object.freeze({
  BOOKING_CREATED:    'DEMAND',
  BOOKING_MODIFIED:   'DEMAND',
  BOOKING_CANCELLED:  'DEMAND',
  BOOKING_REINSTATED: 'DEMAND',
  BLOCK_CREATED:      'BLOCK',  // NEVER counts as demand
  BLOCK_REMOVED:      'BLOCK',  // NEVER counts as demand
});

// ── Lifecycle semantics ───────────────────────────────────────────────────────

const BOOKING_EVENT_LIFECYCLE_SEMANTICS = Object.freeze({
  BOOKING_CREATED: [
    'A new guest-demand reservation became known to Boostinghost.',
    'Immutable: must not be deleted or updated when reservation state changes.',
    'timestamp: event_observed_at = NOW() at ingestion. provider_event_at if available.',
    'A BOOKING_CREATED event is NOT the same as the OTA booking creation time.',
  ],
  BOOKING_MODIFIED: [
    'A known reservation changed its effective state (dates, amounts, status).',
    'Requires state fingerprint comparison (before vs after).',
    'A repeated UPSERT that produces no state change is NOT a BOOKING_MODIFIED event.',
    'Fields to compare: start_date, end_date, status, amount_total, currency, guest_count.',
  ],
  BOOKING_CANCELLED: [
    'A known reservation transitioned to cancelled state.',
    'Must NOT be inferred solely from row deletion — DELETE is not always cancellation.',
    'Must NOT be inferred solely from iCal feed disappearance — feed gaps are possible.',
    'Source-specific: Channex: status=cancelled webhook. guest_app: explicit cancellation route.',
    'Row deletion for account/property cascade is NOT a cancellation event.',
  ],
  BOOKING_REINSTATED: [
    'DEFERRED — not in P1.5-T2 scope.',
    'Would represent: previously-cancelled reservation reactivated.',
  ],
  BLOCK_CREATED: [
    'A date-block was placed on a property (manual, programmatic, or hold-generated).',
    'BLOCK events represent capacity management, never guest demand.',
    'Must not count toward booking demand, pickup analysis, or elasticity.',
  ],
  BLOCK_REMOVED: [
    'A date-block was removed (manual unblock, hold expiry, Channex unblock).',
    'Not a cancellation. Not demand.',
  ],
});

// ── Reservation write-path registry ──────────────────────────────────────────
// Derived from static source analysis of the codebase.
// DOES NOT modify production code.

const RESERVATION_WRITE_PATHS = Object.freeze([
  // ── CHANNEX SOURCE ────────────────────────────────────────────────────────
  {
    id: 'W-01',
    file: 'channex.js',
    function: 'processChannexBooking',
    source: 'channex',
    operations: ['INSERT'],
    trigger: 'POST /api/channex/webhook (new booking)',
    identityUsed: 'uid=CHX_{booking_id}, channex_booking_id',
    fieldsWritten: [
      'uid', 'property_id', 'user_id', 'start_date', 'end_date',
      'guest_name', 'guest_first_name', 'guest_last_name', 'guest_email', 'guest_phone',
      'guest_country', 'guest_language', 'guest_city', 'guest_address', 'guest_zip',
      'occupancy_adults', 'occupancy_children',
      'amount_total', 'amount_rooms', 'amount_taxes', 'amount_cleaning', 'ota_commission',
      'days_breakdown', 'services_raw', 'currency', 'host_payout', 'airbnb_data',
      'platform', 'source', 'status', 'channex_booking_id', 'channex_revision_id',
      'ota_name', 'ota_reservation_id', 'ota_notes',
    ],
    statusSemantics: "'confirmed' always on INSERT (Channex does not distinguish instant-book from request-to-book in attrs.status)",
    canDetectCreated: true,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'result._isNew=true flag on INSERT (ephemeral, not stored). Raw webhook in webhook_events before processing. No OTA booking_created_at in Channex payload — local created_at is webhook receipt time.',
  },
  {
    id: 'W-02',
    file: 'channex.js',
    function: 'processChannexBooking (existing row path)',
    source: 'channex',
    operations: ['UPDATE'],
    trigger: 'POST /api/channex/webhook (re-delivery or modification)',
    identityUsed: 'channex_booking_id (L1), ota_reservation_id (L2), dates+channex_property_id (L3)',
    fieldsWritten: [
      'start_date', 'end_date', 'guest_first_name', 'guest_last_name', 'guest_country',
      'guest_language', 'guest_city', 'guest_address', 'guest_zip',
      'occupancy_adults', 'occupancy_children',
      'amount_total', 'amount_rooms', 'amount_taxes', 'amount_cleaning', 'ota_commission',
      'days_breakdown', 'services_raw', 'currency', 'host_payout', 'airbnb_data',
      'ota_notes', 'status', 'updated_at',
    ],
    statusSemantics: "status: CANCELLED→confirmed re-opens; otherwise preserved",
    canDetectCreated: false,
    canDetectModified: true,
    canDetectCancelled: false,
    notes: 'No before/after comparison today — any re-delivery triggers UPDATE. Cannot distinguish meaningful modification from idempotent re-delivery without fingerprinting. Level-3 date-match can be ambiguous when multiple rows share same dates.',
  },
  {
    id: 'W-03',
    file: 'channex.js',
    function: 'processChannexBooking (cancellation path)',
    source: 'channex',
    operations: ['UPDATE'],
    trigger: 'POST /api/channex/webhook (booking_status=cancelled)',
    identityUsed: 'channex_booking_id',
    fieldsWritten: ['status', 'updated_at'],
    statusSemantics: "'cancelled'",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: true,
    notes: 'If row not in DB, returns synthetic cancelled object (_not_in_db=true) — no DB write. Channex cancellation webhook is reliable for confirmed cancellations.',
  },
  {
    id: 'W-04',
    file: 'server.js',
    function: 'POST /api/channex/webhook (accepted/declined_reservation)',
    source: 'channex',
    operations: ['UPDATE'],
    trigger: 'Channex webhook event_type=accepted_reservation or declined_reservation (Airbnb request-to-book)',
    identityUsed: 'channex_booking_id',
    fieldsWritten: ['status', 'updated_at'],
    statusSemantics: "'confirmed' for accepted; 'cancelled' for declined",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: true,
    notes: 'Airbnb request-to-book only. Declined = functional cancellation. No before-state record.',
  },
  {
    id: 'W-05',
    file: 'channex.js',
    function: 'processChannexBooking (iCal→OTA conversion)',
    source: 'ical→channex',
    operations: ['UPDATE'],
    trigger: 'POST /api/channex/webhook when iCal row covers same dates',
    identityUsed: 'ical row id (matched by property+dates)',
    fieldsWritten: [
      'source', 'channex_booking_id', 'channex_revision_id', 'ota_name', 'ota_reservation_id',
      'platform', 'start_date', 'end_date', 'guest_name', 'guest_first_name', 'guest_last_name',
      'guest_email', 'guest_phone', 'guest_country', 'guest_language', 'guest_city',
      'guest_address', 'guest_zip', 'occupancy_adults', 'occupancy_children',
      'amount_total', 'amount_rooms', 'amount_taxes', 'amount_cleaning', 'ota_commission',
      'days_breakdown', 'services_raw', 'currency', 'host_payout', 'airbnb_data',
      'ota_notes', 'status', 'updated_at',
    ],
    statusSemantics: "'confirmed'",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Changes source from ical to channex — a single logical booking may appear as two events (ICAL created + Channex enrichment). Must correlate by uid to avoid double-counting in event history.',
  },
  {
    id: 'W-06',
    file: 'channex.js',
    function: 'processChannexBooking (ota_reservation_id dedup link)',
    source: 'channex',
    operations: ['UPDATE'],
    trigger: 'POST /api/channex/webhook (level-2 fallback: ota_reservation_id match)',
    identityUsed: 'ota_reservation_id',
    fieldsWritten: ['channex_booking_id', 'updated_at'],
    statusSemantics: 'unchanged',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Reconciliation path when Channex changes booking_id across revisions. OTA reference stable; BH re-links.',
  },
  // ── GUEST_APP SOURCE ──────────────────────────────────────────────────────
  {
    id: 'W-07',
    file: 'server.js',
    function: 'POST /api/guest-app/confirm-after-payment (direct Stripe payment)',
    source: 'guest_app',
    operations: ['INSERT'],
    trigger: 'Guest completes Stripe payment in BHGuest app (immediate capture)',
    identityUsed: 'uid=GUEST_{Date.now()}',
    fieldsWritten: [
      'uid', 'property_id', 'user_id', 'start_date', 'end_date',
      'guest_name', 'guest_email', 'guest_phone',
      'amount_total', 'platform', 'source', 'status', 'occupancy_adults', 'currency',
    ],
    statusSemantics: "'confirmed'",
    canDetectCreated: true,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Stripe amount_received used for amount_total. Currency from Stripe session. timestamp = local INSERT time (Stripe webhook receipt, not exact guest tap time). RETURNING * provides all fields.',
  },
  {
    id: 'W-08',
    file: 'server.js',
    function: 'POST /api/webhooks/stripe (Stripe setup_intent — deferred payment)',
    source: 'guest_app',
    operations: ['INSERT'],
    trigger: 'Stripe checkout.session.completed webhook for deferred payment setup',
    identityUsed: 'uid=BHGUEST_{session.id}, ON CONFLICT (uid) DO NOTHING',
    fieldsWritten: [
      'uid', 'user_id', 'property_id', 'source',
      'guest_name', 'guest_email', 'guest_phone',
      'start_date', 'end_date', 'amount_total', 'status', 'currency',
    ],
    statusSemantics: "'confirmed' immediately (pre-authorization model: deferred capture at J-2)",
    canDetectCreated: true,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'ON CONFLICT DO NOTHING for idempotency. Deferred capture scheduled in bhguest_deferred_payments. Amount from Stripe session metadata snapshot.',
  },
  {
    id: 'W-09',
    file: 'server.js',
    function: 'POST /api/webhooks/stripe (checkout.session.completed for free-link / guest_app path)',
    source: 'guest_app',
    operations: ['INSERT'],
    trigger: 'Stripe checkout.session.completed webhook (isFreeLinkWithDates or isGuestAppSession)',
    identityUsed: 'uid=BHGUEST_{paymentId|session.id}, ON CONFLICT DO NOTHING',
    fieldsWritten: [
      'uid', 'user_id', 'property_id', 'source',
      'guest_name', 'guest_email', 'guest_phone',
      'start_date', 'end_date', 'amount_total', 'status', 'currency',
    ],
    statusSemantics: "'confirmed'",
    canDetectCreated: true,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Second guest_app INSERT path via Stripe webhook. ON CONFLICT guard prevents duplicate. Currency: Stripe session.currency wins over booking_currency if conflict.',
  },
  {
    id: 'W-10',
    file: 'server.js',
    function: 'POST /api/bhguest/guest-cancel',
    source: 'guest_app',
    operations: ['UPDATE'],
    trigger: 'Guest cancels own booking via BHGuest',
    identityUsed: 'uid',
    fieldsWritten: ['status', 'cancelled_by', 'updated_at'],
    statusSemantics: "'cancelled', cancelled_by='guest'",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: true,
    notes: "Explicit guest action. cancelled_by='guest' stored. No before-state snapshot.",
  },
  {
    id: 'W-11',
    file: 'server.js',
    function: 'POST /api/bhguest/host-cancel',
    source: 'guest_app',
    operations: ['UPDATE', 'INSERT'],
    trigger: 'Host cancels guest_app reservation via management UI',
    identityUsed: 'uid',
    fieldsWritten: ['status', 'cancelled_by', 'cancellation_reason', 'updated_at'],
    statusSemantics: "'cancelled', cancelled_by='host' or 'host_refusal' (grace period <48h)",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: true,
    notes: 'Also INSERTs a BLOCK reservation (uid=HOSTCANCEL_{original_uid}) to prevent re-booking unless isGraceRefusal. bhguest_host_cancellations counter updated.',
  },
  {
    id: 'W-12',
    file: 'server.js',
    function: 'bhguestDeferredCron (payment failure → auto-cancel)',
    source: 'guest_app',
    operations: ['UPDATE'],
    trigger: 'Scheduled cron: deferred capture fails after 3 attempts',
    identityUsed: 'uid',
    fieldsWritten: ['status', 'cancelled_by', 'cancellation_reason', 'updated_at'],
    statusSemantics: "'cancelled', cancelled_by='system'",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: true,
    notes: 'System-initiated cancellation. No guest or host action required.',
  },
  // ── MANUAL / DIRECT BOOKINGS ──────────────────────────────────────────────
  {
    id: 'W-13',
    file: 'server.js',
    function: 'POST /api/reservations/add',
    source: 'MANUEL',
    operations: ['INSERT', 'UPDATE'],
    trigger: 'Host creates manual booking in Boostinghost dashboard',
    identityUsed: 'uid=manual_{Date.now()}, ON CONFLICT (uid) DO UPDATE (partial fields)',
    fieldsWritten: [
      'uid', 'property_id', 'user_id', 'start_date', 'end_date',
      'guest_name', 'source', 'platform', 'reservation_type',
      'price', 'amount_total', 'currency', 'status', 'notes',
      'guest_phone', 'guest_email', 'guest_country', 'occupancy_adults',
      'amount_rooms', 'amount_cleaning', 'amount_taxes', 'ota_commission',
      'synced_at', 'created_at',
    ],
    statusSemantics: "'confirmed' on create",
    canDetectCreated: true,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'uid=manual_{Date.now()} — millisecond timestamp in uid acts as created-at proxy. ON CONFLICT DO UPDATE covers limited fields only (notes, phone, email, price, amount_total). created_at is local server time = exact booking entry time.',
  },
  {
    id: 'W-14',
    file: 'server.js',
    function: 'PUT /api/reservations/manual/:uid',
    source: 'MANUEL',
    operations: ['UPDATE'],
    trigger: 'Host modifies manual booking in dashboard',
    identityUsed: 'uid',
    fieldsWritten: [
      'start_date', 'end_date', 'guest_name', 'notes', 'status',
      'amount_total', 'amount_rooms', 'amount_cleaning', 'amount_taxes',
      'currency', 'guest_phone', 'guest_email', 'updated_at',
    ],
    statusSemantics: 'Explicit in body; includes cancellation',
    canDetectCreated: false,
    canDetectModified: true,
    canDetectCancelled: true,
    notes: 'Cancellation possible via status=cancelled in body. No before-state comparison — every PUT is a potential BOOKING_MODIFIED or BOOKING_CANCELLED.',
  },
  // ── ICAL SOURCE ───────────────────────────────────────────────────────────
  {
    id: 'W-15',
    file: 'server.js',
    function: 'syncAllCalendars → processIcalFeed (iCal import — new event)',
    source: 'ical',
    operations: ['INSERT'],
    trigger: 'Scheduled iCal sync (cron) or manual resync',
    identityUsed: 'uid=ICAL_{Date.now().toString(36)}_{random}, ical_uid from VEVENT UID field',
    fieldsWritten: [
      'uid', 'property_id', 'user_id', 'start_date', 'end_date',
      'guest_name', 'platform', 'source', 'status', 'ical_uid',
      'created_at', 'updated_at',
    ],
    statusSemantics: "'confirmed' always",
    canDetectCreated: true,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'BOOKING_CREATED_TIMESTAMP = IMPORT_FIRST_SEEN_AT (NOT exact OTA booking creation time). ical_uid from VEVENT UID stored when present. DTSTAMP/CREATED/LAST-MODIFIED from iCal not currently parsed or stored. Dedup check: existing row with same dates and non-ical source → skip.',
  },
  {
    id: 'W-16',
    file: 'server.js',
    function: 'syncAllCalendars → processIcalFeed (iCal delete — event removed)',
    source: 'ical',
    operations: ['DELETE'],
    trigger: 'iCal sync: VEVENT present in DB but absent from current feed',
    identityUsed: 'uid or id',
    fieldsWritten: [],
    statusSemantics: 'Row deleted, no status update',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'DELETE ≠ BOOKING_CANCELLED. iCal feed disappearance may be: true cancellation, feed error, sync gap, stale cache, or source change (event may reappear). ICAL_CAN_PROVE_BOOKING_CANCELLED = PARTIAL (circumstantial, not reliable alone).',
  },
  {
    id: 'W-17',
    file: 'server.js',
    function: 'syncAllCalendars → processIcalFeed (full resync cleanup)',
    source: 'ical',
    operations: ['DELETE'],
    trigger: 'iCal full resync: delete stale iCal rows not in current feed',
    identityUsed: 'property_id + source=ical + uid NOT IN current set',
    fieldsWritten: [],
    statusSemantics: 'Row deleted',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Same caveat as W-16. Batch delete of stale iCal rows during full property resync.',
  },
  // ── BLOCK / AVAILABILITY ──────────────────────────────────────────────────
  {
    id: 'W-18',
    file: 'server.js',
    function: 'POST /api/blocks',
    source: 'BLOCK',
    operations: ['INSERT'],
    trigger: 'Host places single block on calendar',
    identityUsed: "uid=block_{Date.now()}_{propertyId}_{date}, ON CONFLICT DO NOTHING",
    fieldsWritten: [
      'uid', 'property_id', 'user_id', 'start_date', 'end_date',
      'guest_name', 'source', 'platform', 'reservation_type', 'status', 'notes',
    ],
    statusSemantics: "'confirmed'",
    canDetectCreated: false,  // not a booking — BLOCK_CREATED
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'source=BLOCK, platform=BLOCK, reservation_type=block. Category=BLOCK, not DEMAND.',
  },
  {
    id: 'W-19',
    file: 'server.js',
    function: 'POST /api/blocks/batch (action=block)',
    source: 'BLOCK',
    operations: ['INSERT'],
    trigger: 'Host places batch block on calendar (per-night granularity)',
    identityUsed: "uid=block_{Date.now()}_{propertyId}_{date}, ON CONFLICT DO NOTHING",
    fieldsWritten: [
      'uid', 'property_id', 'user_id', 'start_date', 'end_date',
      'guest_name', 'source', 'platform', 'reservation_type', 'status', 'notes',
    ],
    statusSemantics: "'confirmed'",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Batch block, per-night rows. BLOCK_CREATED category.',
  },
  {
    id: 'W-20',
    file: 'server.js',
    function: 'DELETE /api/blocks/:id',
    source: 'BLOCK',
    operations: ['DELETE'],
    trigger: 'Host removes single block from calendar',
    identityUsed: 'id (numeric) OR uid, WHERE reservation_type=block OR source=BLOCK',
    fieldsWritten: [],
    statusSemantics: 'Row deleted',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'DELETE ≠ BOOKING_CANCELLED. BLOCK_REMOVED event category. No before-state record.',
  },
  {
    id: 'W-21',
    file: 'server.js',
    function: 'POST /api/blocks/batch (action=unblock)',
    source: 'BLOCK',
    operations: ['DELETE'],
    trigger: 'Host removes batch blocks from calendar',
    identityUsed: 'user_id + property_id + date overlap + reservation_type/source=BLOCK',
    fieldsWritten: [],
    statusSemantics: 'Rows deleted',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Batch unblock. BLOCK_REMOVED category. Note: block rows are per-night granularity.',
  },
  // ── TRANSIENT / SYSTEM PATHS ──────────────────────────────────────────────
  {
    id: 'W-22',
    file: 'server.js',
    function: 'BHGuest hold → HOLD pre-reservation',
    source: 'HOLD',
    operations: ['INSERT', 'DELETE'],
    trigger: 'Guest initiates BHGuest payment flow (hold created), then payment completes (hold deleted)',
    identityUsed: "uid=HOLD_{link_token}",
    fieldsWritten: ['uid', 'property_id', 'user_id', 'start_date', 'end_date', 'source', 'status'],
    statusSemantics: "'confirmed' then row DELETED on payment success",
    canDetectCreated: false,  // transient — not guest demand until payment confirmed
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Transient administrative hold, not guest demand. HOLD rows are deleted on payment success (→ GUEST_ row created) or on hold expiry. NOT a booking event. BLOCK_CREATED semantics if anything.',
  },
  {
    id: 'W-23',
    file: 'server.js',
    function: 'POST /api/bhguest/host-cancel (anti-rebooking block)',
    source: 'BLOCK',
    operations: ['INSERT'],
    trigger: 'Host cancels guest_app booking — auto-block created to prevent re-booking at higher price',
    identityUsed: "uid=HOSTCANCEL_{original_uid}, ON CONFLICT DO NOTHING",
    fieldsWritten: ['uid', 'user_id', 'property_id', 'source', 'guest_name', 'start_date', 'end_date', 'status'],
    statusSemantics: "'confirmed'",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'BLOCK_CREATED event. Source=BLOCK. Not a guest booking.',
  },
  {
    id: 'W-24',
    file: 'server.js',
    function: 'Channex bulk sync / resync (W-24)',
    source: 'channex',
    operations: ['UPDATE'],
    trigger: 'Manual Channex data re-import or sync-all admin action',
    identityUsed: 'channex_booking_id',
    fieldsWritten: ['status', 'updated_at'],
    statusSemantics: "'confirmed' or 'cancelled'",
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: true,
    notes: 'Reconciliation / repair path. Should not produce spurious BOOKING_MODIFIED events.',
  },
  {
    id: 'W-25',
    file: 'server.js',
    function: 'Channex block-type reconciliation',
    source: 'channex',
    operations: ['UPDATE'],
    trigger: 'Channex booking identified as block after initial insert',
    identityUsed: 'channex_booking_id',
    fieldsWritten: ['reservation_type', 'updated_at'],
    statusSemantics: 'unchanged',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: "reservation_type='block' set after Channex indicates the booking is a block (OTA block, not guest demand). Changes event category from DEMAND to BLOCK retroactively.",
  },
  {
    id: 'W-26',
    file: 'onboarding-system.js',
    function: 'updateReservationWithGuestInfo',
    source: 'any',
    operations: ['UPDATE'],
    trigger: 'Guest completes BHGuest onboarding (phone/name collection)',
    identityUsed: 'property_id + DATE(start_date) + LOWER(source)',
    fieldsWritten: ['guest_name', 'guest_phone', 'updated_at'],
    statusSemantics: 'unchanged',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Minor enrichment — not a meaningful lifecycle event. No booking-event capture needed.',
  },
  {
    id: 'W-27',
    file: 'integrated-chat-handler.js',
    function: 'chat handler notes update',
    source: 'any',
    operations: ['UPDATE'],
    trigger: 'AI or manual chat handler updates reservation notes',
    identityUsed: 'reservation uid via conversation linkage',
    fieldsWritten: ['notes', 'updated_at'],
    statusSemantics: 'unchanged',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Operational annotation. Not a lifecycle event. PII may be in notes — exclude from events.',
  },
  {
    id: 'W-28',
    file: 'server.js',
    function: 'bhguestReminderCron',
    source: 'guest_app',
    operations: ['UPDATE'],
    trigger: 'Cron: bhguest reminder sent',
    identityUsed: 'uid',
    fieldsWritten: ['bhguest_reminder_sent'],
    statusSemantics: 'unchanged',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Operational flag only.',
  },
  {
    id: 'W-29',
    file: 'server.js',
    function: 'Manual property re-assignment',
    source: 'any',
    operations: ['UPDATE'],
    trigger: 'Admin re-assigns reservation to different property',
    identityUsed: 'id',
    fieldsWritten: ['property_id', 'updated_at'],
    statusSemantics: 'unchanged',
    canDetectCreated: false,
    canDetectModified: true,
    canDetectCancelled: false,
    notes: 'Rare admin path. Property change is a meaningful modification.',
  },
  {
    id: 'W-30',
    file: 'server.js',
    function: 'DELETE /api/reservations/:uid (hard delete)',
    source: 'any',
    operations: ['DELETE'],
    trigger: 'Host deletes individual reservation from dashboard',
    identityUsed: 'uid + user_id authorization check',
    fieldsWritten: [],
    statusSemantics: 'Row deleted',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Hard DELETE — NOT a BOOKING_CANCELLED event. Historical row is destroyed. Future booking_events must survive row deletion via independent table.',
  },
  {
    id: 'W-31',
    file: 'server.js',
    function: 'Account deletion cascade',
    source: 'any',
    operations: ['DELETE'],
    trigger: 'User deletes account (GDPR / admin)',
    identityUsed: 'user_id',
    fieldsWritten: [],
    statusSemantics: 'All user reservation rows deleted',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'GDPR cascade — NOT BOOKING_CANCELLED. booking_events must handle user deletion gracefully (anonymize or soft-delete).',
  },
  {
    id: 'W-32',
    file: 'server.js',
    function: 'Property deletion cascade',
    source: 'any',
    operations: ['DELETE'],
    trigger: 'Host deletes property',
    identityUsed: 'property_id',
    fieldsWritten: [],
    statusSemantics: 'All property reservation rows deleted',
    canDetectCreated: false,
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Cascade delete — NOT BOOKING_CANCELLED. booking_events must survive property deletion.',
  },
  {
    id: 'W-33',
    file: 'server.js',
    function: 'Channex bulk import (onboarding / resync route)',
    source: 'channex',
    operations: ['INSERT'],
    trigger: 'Manual import of Channex bookings during onboarding',
    identityUsed: 'uid=CHX_{booking_id}, ON CONFLICT DO NOTHING',
    fieldsWritten: [
      'uid', 'property_id', 'user_id', 'start_date', 'end_date',
      'guest_name', 'source', 'platform', 'status',
      'channex_booking_id', 'channex_revision_id', 'ota_name', 'ota_reservation_id',
      'amount_total', 'currency',
    ],
    statusSemantics: "'confirmed' or per booking status",
    canDetectCreated: false,  // historical import, not a real creation event
    canDetectModified: false,
    canDetectCancelled: false,
    notes: 'Historical import path. ON CONFLICT DO NOTHING provides idempotency. Imported rows have local created_at = import time, NOT original OTA booking time. Do NOT emit BOOKING_CREATED events for historical imports.',
  },
]);

// ── Schema recommendation (Section 27) ───────────────────────────────────────
// NOT a migration — analysis only. classify: REQUIRED | USEFUL | SOURCE_SPECIFIC | DEFERRED | AVOID

const BOOKING_EVENT_SCHEMA_RECOMMENDATION = Object.freeze([
  { field: 'id',                  type: 'BIGSERIAL PRIMARY KEY',           classify: 'REQUIRED',        notes: 'Append-only; never reused.' },
  { field: 'reservation_id',      type: 'INTEGER REFERENCES reservations', classify: 'REQUIRED',        notes: 'Nullable: W-31/32 cascade may destroy reservation row. Foreign key with ON DELETE SET NULL.' },
  { field: 'property_id',         type: 'TEXT NOT NULL',                   classify: 'REQUIRED',        notes: 'Retained even if reservation row deleted.' },
  { field: 'source',              type: 'TEXT NOT NULL',                   classify: 'REQUIRED',        notes: 'channex|ical|guest_app|manual|block. Scopes identity and semantics.' },
  { field: 'external_booking_id', type: 'TEXT',                            classify: 'REQUIRED',        notes: 'uid value at event time. Stable cross-source identity.' },
  { field: 'event_type',          type: 'TEXT NOT NULL',                   classify: 'REQUIRED',        notes: 'CHECK: BOOKING_CREATED|BOOKING_MODIFIED|BOOKING_CANCELLED|BLOCK_CREATED|BLOCK_REMOVED' },
  { field: 'event_observed_at',   type: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()', classify: 'REQUIRED',     notes: 'When BH observed/knew of the event. Primary visibility timestamp.' },
  { field: 'provider_event_at',   type: 'TIMESTAMPTZ',                     classify: 'USEFUL',          notes: 'When provider says the event occurred. NULL when unavailable. Never alone for visibility.' },
  { field: 'booking_created_at',  type: 'TIMESTAMPTZ',                     classify: 'SOURCE_SPECIFIC', notes: 'Only reliable for manual/guest_app. Channex: webhook receipt proxy. iCal: import_first_seen_at proxy.' },
  { field: 'start_date',          type: 'DATE NOT NULL',                   classify: 'REQUIRED',        notes: 'Snapshot at event time.' },
  { field: 'end_date',            type: 'DATE NOT NULL',                   classify: 'REQUIRED',        notes: 'Snapshot at event time.' },
  { field: 'status',              type: 'TEXT NOT NULL',                   classify: 'REQUIRED',        notes: 'confirmed|cancelled|completed|pending at event time.' },
  { field: 'guest_count',         type: 'INTEGER',                         classify: 'USEFUL',          notes: 'occupancy_adults at event time. Demand proxy for elasticity.' },
  { field: 'amount_total',        type: 'NUMERIC(10,2)',                   classify: 'USEFUL',          notes: 'NULL for blocks. Source reliability varies — see FINANCIAL_EVENT_FIELDS.' },
  { field: 'amount_rooms',        type: 'NUMERIC(10,2)',                   classify: 'SOURCE_SPECIFIC', notes: 'Channex only reliably.' },
  { field: 'currency',            type: 'TEXT',                            classify: 'REQUIRED',        notes: 'At event time. EUR default where unknown.' },
  { field: 'state_fingerprint',   type: 'TEXT NOT NULL',                   classify: 'REQUIRED',        notes: '9-field pipe-separated hash of effective event state. Excludes event_observed_at. Enables dedup and change detection.' },
  { field: 'provider_event_id',   type: 'TEXT',                            classify: 'SOURCE_SPECIFIC', notes: 'Channex: channex_revision_id. webhook_events.id as proxy when revision absent. NULL for manual/ical.' },
  { field: 'metadata_json',       type: 'JSONB',                           classify: 'DEFERRED',        notes: 'Optional provider-specific data for debugging. PII must be stripped before storage.' },
  { field: 'created_at',          type: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()', classify: 'REQUIRED',     notes: 'Append-only audit timestamp.' },
  // PII to AVOID
  { field: 'guest_name',          type: 'TEXT',                            classify: 'AVOID',           notes: 'PII — do not copy to booking_events.' },
  { field: 'guest_email',         type: 'TEXT',                            classify: 'AVOID',           notes: 'PII — do not copy.' },
  { field: 'guest_phone',         type: 'TEXT',                            classify: 'AVOID',           notes: 'PII — do not copy.' },
  { field: 'guest_address',       type: 'TEXT',                            classify: 'AVOID',           notes: 'PII — do not copy.' },
  { field: 'message_content',     type: 'TEXT',                            classify: 'AVOID',           notes: 'PII — notes/ota_notes must not be copied.' },
]);

// ── Readiness classification per source ──────────────────────────────────────

const SOURCE_READINESS = Object.freeze({
  channex: {
    CREATED_EVENT_READINESS:    'READY',
    MODIFIED_EVENT_READINESS:   'PARTIAL',
    CANCELLED_EVENT_READINESS:  'READY',
    notes: [
      'CREATED: W-01 INSERT path detects new bookings. webhook_events provides raw payload.',
      'MODIFIED: W-02 UPDATE fires on any re-delivery — no before/after comparison today. State fingerprint needed.',
      'CANCELLED: W-03 status=cancelled path is reliable. W-04 declined_reservation also.',
      'OTA booking creation time: NOT AVAILABLE from Channex payload. Local created_at = webhook receipt (proxy only).',
      'Idempotency: revision_id in-memory dedup (60s). webhook_events.id as durable idempotency anchor.',
      'Out-of-order: possible — Channex can re-deliver old revisions. event_observed_at preserves arrival order.',
    ],
  },
  guest_app: {
    CREATED_EVENT_READINESS:    'READY',
    MODIFIED_EVENT_READINESS:   'NOT_AVAILABLE',
    CANCELLED_EVENT_READINESS:  'READY',
    notes: [
      'CREATED: W-07/W-08/W-09 INSERT paths are explicit. created_at = local server time (Stripe webhook receipt). Not exact guest tap time.',
      'MODIFIED: No modification path exists for guest_app reservations today.',
      'CANCELLED: W-10 (guest), W-11 (host), W-12 (system) all set cancelled_by — reliable event.',
      'Financial: amount_total from Stripe amount_received (authoritative). currency from Stripe session.',
      'Idempotency: ON CONFLICT (uid) DO NOTHING on uid=BHGUEST_/GUEST_. Stripe session ID is stable.',
    ],
  },
  manual: {
    CREATED_EVENT_READINESS:    'READY',
    MODIFIED_EVENT_READINESS:   'PARTIAL',
    CANCELLED_EVENT_READINESS:  'PARTIAL',
    notes: [
      'CREATED: W-13 explicit INSERT. uid=manual_{Date.now()} embeds millisecond timestamp.',
      'MODIFIED: W-14 PUT route fires on any change. State fingerprint needed for meaningful-change detection.',
      'CANCELLED: W-14 supports status=cancelled in body. No separate cancellation route — must infer from status.',
      'Financial: host-entered amounts, no Stripe validation. Reliability depends on host input.',
      'Timing: created_at = exact host-entry time (best timestamp available for direct bookings).',
    ],
  },
  ical: {
    CREATED_EVENT_READINESS:    'PARTIAL',
    MODIFIED_EVENT_READINESS:   'UNRELIABLE',
    CANCELLED_EVENT_READINESS:  'PARTIAL',
    notes: [
      'CREATED: W-15 INSERT on first-seen. BOOKING_CREATED_TIMESTAMP = IMPORT_FIRST_SEEN_AT (proxy). Not OTA booking creation time.',
      'MODIFIED: No modification path — iCal is snapshot-based. Changed events → DELETE + INSERT (new uid). Not suitable for meaningful BOOKING_MODIFIED events.',
      'CANCELLED: W-16/17 DELETE on feed disappearance. ICAL_CAN_PROVE_BOOKING_CANCELLED = PARTIAL. Feed disappearance may be: true cancellation, sync gap, stale cache. Must corroborate with other evidence.',
      'Identity: ical_uid from VEVENT UID is most stable. Present in schema. uid=ICAL_* (local proxy) only.',
      'DTSTAMP/CREATED/LAST-MODIFIED: not currently parsed from iCal feed.',
      'iCal events must NOT contaminate exact booking-event history — isolate in separate source classification.',
    ],
  },
  block: {
    CREATED_EVENT_READINESS:    'READY',
    MODIFIED_EVENT_READINESS:   'NOT_AVAILABLE',
    CANCELLED_EVENT_READINESS:  'NOT_AVAILABLE',
    notes: [
      'BLOCK is not guest demand. Must never count toward pickup or elasticity.',
      'BLOCK_CREATED: W-18/W-19/W-23 INSERT paths are explicit. event_category=BLOCK.',
      'BLOCK_REMOVED: W-20/W-21 DELETE paths. Not BOOKING_CANCELLED.',
      'Architecture recommendation: BLOCK events may live in booking_events with event_category=BLOCK, separate from DEMAND events. Do not expose BLOCK rows to demand/elasticity analyses.',
    ],
  },
});

// ── SQL queries (SELECT-only) ─────────────────────────────────────────────────

const RESERVATIONS_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reservations'
  ) AS exists
`;

const SCHEMA_SQL = `
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'reservations'
  ORDER BY ordinal_position
`;

const COUNT_BY_SOURCE_SQL = `
  SELECT
    COALESCE(source, 'NULL') AS source,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'confirmed')  AS confirmed,
    COUNT(*) FILTER (WHERE status = 'cancelled')  AS cancelled,
    COUNT(*) FILTER (WHERE status = 'completed')  AS completed,
    MIN(created_at)  AS first_created_at,
    MAX(created_at)  AS last_created_at,
    MIN(start_date)  AS first_stay,
    MAX(start_date)  AS last_stay
  FROM reservations
  GROUP BY source
  ORDER BY total DESC
`;

const IDENTITY_COMPLETENESS_SQL = `
  SELECT
    COALESCE(source, 'NULL') AS source,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE channex_booking_id IS NOT NULL) AS has_channex_id,
    COUNT(*) FILTER (WHERE ical_uid IS NOT NULL)            AS has_ical_uid,
    COUNT(*) FILTER (WHERE ota_reservation_id IS NOT NULL)  AS has_ota_id,
    COUNT(*) FILTER (WHERE created_at IS NULL)              AS missing_created_at,
    COUNT(*) FILTER (WHERE updated_at IS NULL)              AS missing_updated_at
  FROM reservations
  GROUP BY source
  ORDER BY total DESC
`;

const FINANCIAL_COMPLETENESS_SQL = `
  SELECT
    COALESCE(source, 'NULL') AS source,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE amount_total IS NULL)  AS null_amount_total,
    COUNT(*) FILTER (WHERE currency IS NULL)       AS null_currency,
    COUNT(*) FILTER (WHERE currency = 'EUR')       AS eur_currency,
    COUNT(*) FILTER (WHERE host_payout IS NOT NULL) AS has_host_payout
  FROM reservations
  GROUP BY source
  ORDER BY total DESC
`;

const CANCELLATION_EVIDENCE_SQL = `
  SELECT
    COALESCE(source, 'NULL') AS source,
    COALESCE(cancelled_by, 'NULL') AS cancelled_by,
    COUNT(*) AS cnt
  FROM reservations
  WHERE status = 'cancelled'
  GROUP BY source, cancelled_by
  ORDER BY source, cnt DESC
`;

const DUPLICATE_CHANNEX_ID_SQL = `
  SELECT channex_booking_id, COUNT(*) AS cnt
  FROM reservations
  WHERE channex_booking_id IS NOT NULL
  GROUP BY channex_booking_id
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 10
`;

const DUPLICATE_ICAL_UID_SQL = `
  SELECT ical_uid, COUNT(*) AS cnt
  FROM reservations
  WHERE ical_uid IS NOT NULL
  GROUP BY ical_uid
  HAVING COUNT(*) > 1
  ORDER BY cnt DESC
  LIMIT 10
`;

const WEBHOOK_EVENTS_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'webhook_events'
  ) AS exists
`;

const WEBHOOK_EVENTS_STATS_SQL = `
  SELECT
    COUNT(*) AS total_events,
    COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
    COUNT(*) FILTER (WHERE status = 'ok')        AS ok,
    COUNT(*) FILTER (WHERE status = 'error')     AS error,
    COUNT(*) FILTER (WHERE payload IS NOT NULL)  AS has_raw_payload,
    MIN(received_at) AS first_event,
    MAX(received_at) AS last_event
  FROM webhook_events
`;

const CHANNEX_LOGS_EXISTS_SQL = `
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'channex_logs'
  ) AS exists
`;

const CHANNEX_LOGS_STATS_SQL = `
  SELECT
    COUNT(*) AS total_logs,
    COUNT(*) FILTER (WHERE direction = 'inbound')  AS inbound,
    COUNT(*) FILTER (WHERE direction = 'outbound') AS outbound,
    COUNT(*) FILTER (WHERE event_type = 'receive_booking') AS booking_created,
    COUNT(*) FILTER (WHERE event_type = 'update_booking')  AS booking_updated,
    MIN(created_at) AS first_log,
    MAX(created_at) AS last_log
  FROM channex_logs
`;

const BLOCK_SOURCE_SQL = `
  SELECT
    COALESCE(reservation_type, 'NULL') AS reservation_type,
    COALESCE(source, 'NULL') AS source,
    COALESCE(platform, 'NULL') AS platform,
    COUNT(*) AS cnt
  FROM reservations
  WHERE source = 'BLOCK' OR reservation_type = 'block' OR platform = 'BLOCK'
  GROUP BY reservation_type, source, platform
  ORDER BY cnt DESC
`;

// ── safeQuery ─────────────────────────────────────────────────────────────────

async function safeQuery(pool, sql, params, label) {
  try {
    return await pool.query(sql, params || []);
  } catch (err) {
    console.error(`  [${label}_FAILURE] ${err.message}`);
    return null;
  }
}

// ── checkAuditToolReadOnly — static source analysis ───────────────────────────

function checkAuditToolReadOnly() {
  const src = fs.readFileSync(__filename, 'utf8');
  const violations = [];
  // Scan only the SQL constants section for mutating SQL.
  // The write-path registry (RESERVATION_WRITE_PATHS) and readiness notes legitimately
  // contain INSERT/UPDATE/DELETE/DROP as human-readable documentation — those are NOT
  // executable SQL and must not trigger false positives.
  const SQL_SECTION_START = '// ── SQL queries (SELECT-only)';
  const SQL_SECTION_END   = '// ── safeQuery';
  const sqlStart = src.indexOf(SQL_SECTION_START);
  const sqlEnd   = src.indexOf(SQL_SECTION_END);
  const sqlSrc   = sqlStart >= 0 && sqlEnd > sqlStart ? src.slice(sqlStart, sqlEnd) : src;
  if (/\bINSERT\b/i.test(sqlSrc))            violations.push('SQL_INSERT_IN_QUERY_SECTION');
  if (/\bDELETE\s+FROM\b/i.test(sqlSrc))     violations.push('SQL_DELETE_FROM_IN_QUERY_SECTION');
  if (/\bDROP\s+TABLE\b/i.test(sqlSrc))      violations.push('SQL_DROP_TABLE_IN_QUERY_SECTION');
  if (/\bUPDATE\s+\w/i.test(sqlSrc))         violations.push('SQL_UPDATE_IN_QUERY_SECTION');
  // Check full source for network imports.
  if (/require\('axios'\)/.test(src))         violations.push('network_require_axios');
  if (/require\('node-fetch'\)/.test(src))    violations.push('network_require_node_fetch');
  return violations;
}

// ── Main audit ────────────────────────────────────────────────────────────────

if (require.main === module) {
  require('dotenv').config();
  const { createPool } = require('../services/db-pool');
  runAudit(createPool())
    .catch(err => { console.error('[FATAL]', err); process.exit(1); });
}

async function runAudit(pool) {
  const NOW_ISO = new Date().toISOString();

  try {
    console.log('');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('  P1.5-T2 — BOOKING EVENT WRITE-PATH READINESS AUDIT');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`  Run at:  ${NOW_ISO}`);
    console.log('  READ_ONLY=YES  DB_WRITES=0  PRICING_WRITES=0  NETWORK_CALLS=0');
    console.log('  BOOKING_EVENTS_EXIST                    = NO');
    console.log('  BOOKING_EVENTS_HAVE_PRICING_AUTHORITY   = NO');
    console.log('  PRODUCTION_RESERVATION_BEHAVIOR_CHANGED = NO');
    console.log('  PRODUCTION_PRICING_CHANGED              = NO');
    console.log('──────────────────────────────────────────────────────────────────────');

    // ── [1] AUDIT TOOL SELF-CHECK ────────────────────────────────────────────
    console.log('\n  [1] AUDIT TOOL SELF-CHECK');
    const selfViolations = checkAuditToolReadOnly();
    console.log(`  READ_ONLY: ${selfViolations.length === 0 ? 'YES ✓' : 'VIOLATION ✗ — ' + selfViolations.join(', ')}`);

    // ── [2] EVENT SEMANTICS ──────────────────────────────────────────────────
    console.log('\n  [2] EVENT SEMANTICS');
    for (const [type, lines] of Object.entries(BOOKING_EVENT_LIFECYCLE_SEMANTICS)) {
      console.log(`\n  ${type} (category: ${BOOKING_EVENT_CATEGORY[type] || 'N/A'})`);
      for (const line of lines) console.log(`    ${line}`);
    }
    console.log(`\n  BOOKING_REINSTATED: DEFERRED — not in P1.5-T2 scope`);
    console.log(`  BOOKING_DELETED:    NOT_NEEDED — reservation row deletion is not a lifecycle event`);
    console.log(`  BLOCK events must NEVER count as booking demand.`);

    // ── [3] WRITE-PATH REGISTRY ──────────────────────────────────────────────
    console.log('\n  [3] RESERVATION WRITE-PATH REGISTRY');
    console.log(`  Total write paths identified: ${RESERVATION_WRITE_PATHS.length}`);
    for (const p of RESERVATION_WRITE_PATHS) {
      console.log(`\n  ${p.id} — ${p.source.toUpperCase()} — ${p.operations.join('+')} — ${p.trigger.slice(0,60)}`);
      console.log(`    file:           ${p.file}`);
      console.log(`    identity:       ${p.identityUsed}`);
      console.log(`    can_detect:     CREATED=${p.canDetectCreated} MODIFIED=${p.canDetectModified} CANCELLED=${p.canDetectCancelled}`);
      if (p.notes) console.log(`    notes:          ${p.notes.slice(0,120)}`);
    }

    // ── [4] TABLE EXISTENCE ──────────────────────────────────────────────────
    console.log('\n  [4] TABLE EXISTENCE');
    const rExist = await safeQuery(pool, RESERVATIONS_EXISTS_SQL, [], 'RES_EXISTS');
    const resExists = rExist?.rows?.[0]?.exists === true;
    console.log(`  reservations:   ${resExists ? 'YES ✓' : 'NO ✗'}`);

    const weExist = await safeQuery(pool, WEBHOOK_EVENTS_EXISTS_SQL, [], 'WE_EXISTS');
    const webhookExists = weExist?.rows?.[0]?.exists === true;
    console.log(`  webhook_events: ${webhookExists ? 'YES ✓' : 'NO ✗'}`);

    const clExist = await safeQuery(pool, CHANNEX_LOGS_EXISTS_SQL, [], 'CL_EXISTS');
    const channexLogsExist = clExist?.rows?.[0]?.exists === true;
    console.log(`  channex_logs:   ${channexLogsExist ? 'YES ✓' : 'NO ✗'}`);

    if (!resExists) {
      console.log('\n  RESERVATIONS TABLE ABSENT — cannot run data audit.');
      console.log('══════════════════════════════════════════════════════════════════════');
      return;
    }

    // ── [5] SCHEMA AUDIT ─────────────────────────────────────────────────────
    console.log('\n  [5] RESERVATIONS SCHEMA');
    const schemaRes = await safeQuery(pool, SCHEMA_SQL, [], 'SCHEMA');
    if (schemaRes) {
      const cols = schemaRes.rows.map(r => r.column_name);
      console.log(`  Columns (${cols.length}): ${cols.join(', ')}`);
      const IDENTITY_COLS  = ['id', 'uid', 'channex_booking_id', 'ota_reservation_id', 'ical_uid'];
      const TEMPORAL_COLS  = ['created_at', 'updated_at', 'start_date', 'end_date', 'synced_at'];
      const FINANCIAL_COLS = ['amount_total', 'amount_rooms', 'amount_taxes', 'amount_cleaning',
                               'ota_commission', 'host_payout', 'currency'];
      const STATUS_COLS    = ['status', 'cancelled_by', 'cancellation_reason', 'reservation_type', 'source'];
      const colSet = new Set(cols);
      for (const group of [
        { label: 'IDENTITY',   cols: IDENTITY_COLS  },
        { label: 'TEMPORAL',   cols: TEMPORAL_COLS  },
        { label: 'FINANCIAL',  cols: FINANCIAL_COLS },
        { label: 'STATUS',     cols: STATUS_COLS    },
      ]) {
        const missing = group.cols.filter(c => !colSet.has(c));
        console.log(`  ${group.label.padEnd(12)} ${missing.length === 0 ? 'all present ✓' : 'MISSING: ' + missing.join(', ')}`);
      }
      // Check created_at type
      const createdAt = schemaRes.rows.find(r => r.column_name === 'created_at');
      console.log(`  created_at type: ${createdAt?.data_type || 'MISSING'} ${createdAt?.data_type === 'timestamp with time zone' ? '✓' : '— expected TIMESTAMPTZ'}`);
    }

    // ── [6] RESERVATION COUNTS BY SOURCE ─────────────────────────────────────
    console.log('\n  [6] RESERVATION COUNTS BY SOURCE');
    const srcRes = await safeQuery(pool, COUNT_BY_SOURCE_SQL, [], 'COUNT_BY_SRC');
    let totalReservations = 0;
    if (srcRes) {
      for (const r of srcRes.rows) {
        totalReservations += parseInt(r.total);
        console.log(`  source=${String(r.source).padEnd(12)} total=${String(r.total).padStart(6)}  confirmed=${String(r.confirmed).padStart(5)}  cancelled=${String(r.cancelled).padStart(5)}  span=${String(r.first_stay||'?').slice(0,10)}→${String(r.last_stay||'?').slice(0,10)}`);
      }
      console.log(`  TOTAL: ${totalReservations}`);
    }

    // ── [7] IDENTITY COMPLETENESS ─────────────────────────────────────────────
    console.log('\n  [7] IDENTITY COMPLETENESS');
    const idRes = await safeQuery(pool, IDENTITY_COMPLETENESS_SQL, [], 'IDENTITY');
    if (idRes) {
      for (const r of idRes.rows) {
        console.log(`  source=${String(r.source).padEnd(12)} channex_id=${r.has_channex_id}/${r.total}  ical_uid=${r.has_ical_uid}/${r.total}  ota_id=${r.has_ota_id}/${r.total}  missing_created_at=${r.missing_created_at}`);
      }
    }

    // ── [8] FINANCIAL COMPLETENESS ────────────────────────────────────────────
    console.log('\n  [8] FINANCIAL COMPLETENESS');
    const finRes = await safeQuery(pool, FINANCIAL_COMPLETENESS_SQL, [], 'FINANCIAL');
    if (finRes) {
      for (const r of finRes.rows) {
        console.log(`  source=${String(r.source).padEnd(12)} null_amount=${r.null_amount_total}/${r.total}  null_currency=${r.null_currency}/${r.total}  has_host_payout=${r.has_host_payout}`);
      }
    }

    // ── [9] CANCELLATION EVIDENCE ─────────────────────────────────────────────
    console.log('\n  [9] CANCELLATION EVIDENCE (status=cancelled rows)');
    const cancelRes = await safeQuery(pool, CANCELLATION_EVIDENCE_SQL, [], 'CANCEL');
    if (cancelRes) {
      for (const r of cancelRes.rows) {
        console.log(`  source=${String(r.source).padEnd(12)} cancelled_by=${String(r.cancelled_by).padEnd(14)} cnt=${r.cnt}`);
      }
    }

    // ── [10] DUPLICATE IDENTITY AUDIT ────────────────────────────────────────
    console.log('\n  [10] DUPLICATE IDENTITY AUDIT');
    const dupCHX = await safeQuery(pool, DUPLICATE_CHANNEX_ID_SQL, [], 'DUP_CHX');
    if (dupCHX) {
      if (dupCHX.rows.length === 0) {
        console.log('  Duplicate channex_booking_id: none ✓');
      } else {
        console.log(`  WARNING: ${dupCHX.rows.length} channex_booking_id(s) appear on multiple rows:`);
        for (const r of dupCHX.rows) console.log(`    booking_id=${r.channex_booking_id} cnt=${r.cnt}`);
      }
    }
    const dupICAL = await safeQuery(pool, DUPLICATE_ICAL_UID_SQL, [], 'DUP_ICAL');
    if (dupICAL) {
      if (dupICAL.rows.length === 0) {
        console.log('  Duplicate ical_uid: none ✓');
      } else {
        console.log(`  WARNING: ${dupICAL.rows.length} ical_uid(s) appear on multiple rows:`);
        for (const r of dupICAL.rows) console.log(`    ical_uid=${r.ical_uid} cnt=${r.cnt}`);
      }
    }

    // ── [11] BLOCK AUDIT ─────────────────────────────────────────────────────
    console.log('\n  [11] BLOCK ROWS (DEMAND_EXCLUDED)');
    const blkRes = await safeQuery(pool, BLOCK_SOURCE_SQL, [], 'BLOCKS');
    if (blkRes) {
      for (const r of blkRes.rows) {
        console.log(`  type=${String(r.reservation_type).padEnd(6)} source=${String(r.source).padEnd(8)} platform=${String(r.platform).padEnd(8)} cnt=${r.cnt}`);
      }
    }

    // ── [12] WEBHOOK_EVENTS AUDIT ─────────────────────────────────────────────
    console.log('\n  [12] WEBHOOK_EVENTS (existing event history for Channex)');
    if (webhookExists) {
      const weStats = await safeQuery(pool, WEBHOOK_EVENTS_STATS_SQL, [], 'WE_STATS');
      if (weStats?.rows?.[0]) {
        const s = weStats.rows[0];
        console.log(`  total_events:     ${s.total_events}`);
        console.log(`  pending/ok/error: ${s.pending} / ${s.ok} / ${s.error}`);
        console.log(`  has_raw_payload:  ${s.has_raw_payload} / ${s.total_events}`);
        console.log(`  span:             ${String(s.first_event||'').slice(0,19)} → ${String(s.last_event||'').slice(0,19)}`);
      }
      console.log('  EXISTING_BOOKING_EVENT_HISTORY (Channex): webhook_events table');
      console.log('    Contains: received_at, event_type, booking_id, payload JSONB, status');
      console.log('    NOT normalized: source-specific (Channex only), no lifecycle event model');
      console.log('    USABLE: as Channex-specific idempotency anchor (provider_event_id proxy)');
    } else {
      console.log('  webhook_events: table not found');
    }

    // ── [13] CHANNEX_LOGS AUDIT ───────────────────────────────────────────────
    console.log('\n  [13] CHANNEX_LOGS (inbound/outbound Channex API call log)');
    if (channexLogsExist) {
      const clStats = await safeQuery(pool, CHANNEX_LOGS_STATS_SQL, [], 'CL_STATS');
      if (clStats?.rows?.[0]) {
        const s = clStats.rows[0];
        console.log(`  total_logs:      ${s.total_logs}`);
        console.log(`  inbound/outbound:${s.inbound} / ${s.outbound}`);
        console.log(`  booking events:  receive_booking=${s.booking_created}  update_booking=${s.booking_updated}`);
        console.log(`  span:            ${String(s.first_log||'').slice(0,19)} → ${String(s.last_log||'').slice(0,19)}`);
      }
      console.log('  EXISTING_BOOKING_EVENT_HISTORY (Channex): channex_logs');
      console.log('    Contains: event_type, direction, payload JSONB (summary, not full booking)');
      console.log('    Less detailed than webhook_events — no full raw payload');
    } else {
      console.log('  channex_logs: table not found');
    }

    // ── [14] READINESS CLASSIFICATION SUMMARY ────────────────────────────────
    console.log('\n  [14] SOURCE READINESS CLASSIFICATION');
    for (const [src, r] of Object.entries(SOURCE_READINESS)) {
      console.log(`\n  ${src.toUpperCase()}`);
      console.log(`    CREATED_EVENT_READINESS:   ${r.CREATED_EVENT_READINESS}`);
      console.log(`    MODIFIED_EVENT_READINESS:  ${r.MODIFIED_EVENT_READINESS}`);
      console.log(`    CANCELLED_EVENT_READINESS: ${r.CANCELLED_EVENT_READINESS}`);
      for (const note of r.notes) console.log(`    • ${note}`);
    }

    // ── [15] SCHEMA RECOMMENDATION ───────────────────────────────────────────
    console.log('\n  [15] FUTURE BOOKING_EVENTS SCHEMA RECOMMENDATION');
    console.log('  (No migration in T2 — analysis only)');
    const groups = { REQUIRED: [], USEFUL: [], SOURCE_SPECIFIC: [], DEFERRED: [], AVOID: [] };
    for (const f of BOOKING_EVENT_SCHEMA_RECOMMENDATION) {
      (groups[f.classify] || groups['DEFERRED']).push(f);
    }
    for (const [cls, fields] of Object.entries(groups)) {
      console.log(`\n  ${cls}:`);
      for (const f of fields) {
        console.log(`    ${f.field.padEnd(26)} ${f.type.padEnd(36)} ${f.notes}`);
      }
    }

    // ── [16] POINT-IN-TIME + IDEMPOTENCY POLICY ───────────────────────────────
    console.log('\n  [16] POINT-IN-TIME + IDEMPOTENCY + OUT-OF-ORDER POLICY');
    console.log('');
    console.log('  POINT-IN-TIME:');
    console.log('    event_observed_at = when BH observed the event (primary visibility timestamp)');
    console.log('    provider_event_at = when provider says event occurred (if available)');
    console.log('    booking_created_at = source-specific proxy (see SOURCE_READINESS)');
    console.log('    At decision time T: only events with event_observed_at <= T are visible.');
    console.log('    provider_event_at alone must NEVER determine visibility.');
    console.log('');
    console.log('  IDEMPOTENCY:');
    console.log('    Channex:   revision_id in-memory 60s dedup. webhook_events.id as durable anchor.');
    console.log('    guest_app: ON CONFLICT (uid) DO NOTHING on BHGUEST_/GUEST_ uid.');
    console.log('    manual:    uid=manual_{timestamp} — collision within same ms only (negligible).');
    console.log('    iCal:      ical_uid present when VEVENT has UID. uid=ICAL_* local proxy fallback.');
    console.log('    Future:    idempotency key = (source, external_booking_id, event_type, provider_event_id)');
    console.log('');
    console.log('  OUT-OF-ORDER:');
    console.log('    Channex can re-deliver old revisions. event_observed_at preserves arrival order.');
    console.log('    Events MUST be inserted in observed order, never rewritten to match provider_event_at.');
    console.log('    MODIFIED before CREATED: insert both, mark out-of-order in metadata_json.');

    // ── [17] ACTIVATION + ARCHITECTURE RECOMMENDATION ─────────────────────────
    console.log('\n  [17] RECOMMENDED CAPTURE ARCHITECTURE');
    console.log('');
    console.log('  RECOMMENDED_ACTIVATION_STRATEGY: B — begin with reliable sources only');
    console.log('');
    console.log('  Phase 1 (reliable): channex (W-01, W-03) + guest_app (W-07,W-08,W-09,W-10,W-11,W-12)');
    console.log('    These have explicit INSERT/status paths. webhook_events provides Channex raw anchor.');
    console.log('    Do NOT activate iCal yet — semantics unreliable for MODIFIED/CANCELLED.');
    console.log('');
    console.log('  Phase 2: manual booking (W-13/W-14) once state fingerprint is implemented.');
    console.log('');
    console.log('  Phase 3: iCal, if needed, with strict event_category=ICAL_SNAPSHOT isolation.');
    console.log('');
    console.log('  No central reservation persistence layer exists today — hooks must be added');
    console.log('  at each write path individually. Prefer a shared helper function to avoid drift.');

    // ── [18] GLOBAL SUMMARY ───────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log('  P1.5-T2 READINESS SUMMARY');
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`  CANONICAL_RESERVATION_TABLE:             reservations`);
    console.log(`  RESERVATION_WRITE_PATHS:                 ${RESERVATION_WRITE_PATHS.length} paths identified`);
    console.log(`  EXISTING_BOOKING_EVENT_HISTORY:          webhook_events (Channex only, not normalized)`);
    console.log(`  BOOKING_EVENT_IDENTITY_STRATEGY:         (source, external_booking_id) scoped per-source`);
    console.log('');
    console.log(`  CHANNEX_LIFECYCLE_READINESS:             CREATED=READY MODIFIED=PARTIAL CANCELLED=READY`);
    console.log(`  GUEST_APP_LIFECYCLE_READINESS:           CREATED=READY MODIFIED=N/A CANCELLED=READY`);
    console.log(`  DIRECT_MANUAL_LIFECYCLE_READINESS:       CREATED=READY MODIFIED=PARTIAL CANCELLED=PARTIAL`);
    console.log(`  ICAL_LIFECYCLE_READINESS:                CREATED=PARTIAL MODIFIED=UNRELIABLE CANCELLED=PARTIAL`);
    console.log(`  BLOCK_LIFECYCLE_RECOMMENDATION:          Separate event_category=BLOCK, never DEMAND`);
    console.log('');
    console.log(`  CHANNEX_CANONICAL_BOOKING_ID:            channex_booking_id`);
    console.log(`  CHANNEX_EVENT_TYPE_AVAILABLE:            YES (booking/accepted_reservation/declined)`);
    console.log(`  CHANNEX_BOOKED_AT_AVAILABLE:             NO (local created_at = webhook receipt proxy)`);
    console.log(`  CHANNEX_RAW_EVENT_AVAILABLE:             YES (webhook_events.payload JSONB)`);
    console.log(`  CHANNEX_IDEMPOTENCY:                     PARTIAL (60s in-memory + webhook_events.id)`);
    console.log('');
    console.log(`  ICAL_CAN_PROVE_BOOKING_CREATED:          PARTIAL (import_first_seen_at proxy only)`);
    console.log(`  ICAL_CAN_PROVE_BOOKING_MODIFIED:         NO`);
    console.log(`  ICAL_CAN_PROVE_BOOKING_CANCELLED:        PARTIAL (feed disappearance, not definitive)`);
    console.log('');
    console.log(`  BOOKING_EVENT_POINT_IN_TIME_POLICY:      event_observed_at is primary visibility anchor`);
    console.log(`  PRICE_BOOKING_JOIN_FEASIBILITY:          YES — join on property_id + stay_date + event_observed_at`);
    console.log('');
    console.log(`  BOOKING_EVENTS_EXIST:                    NO`);
    console.log(`  BOOKING_EVENTS_HAVE_PRICING_AUTHORITY:   NO`);
    console.log(`  PRODUCTION_RESERVATION_BEHAVIOR_CHANGED: NO`);
    console.log(`  PRODUCTION_PRICING_CHANGED:              NO`);
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log('  P1_5_T2_AUDIT_READ_ONLY: YES');
    console.log('══════════════════════════════════════════════════════════════════════');
    console.log('');

  } finally {
    await pool.end();
  }
}

module.exports = {
  runAudit,
  RESERVATION_WRITE_PATHS,
  BOOKING_EVENT_SCHEMA_RECOMMENDATION,
  BOOKING_EVENT_TYPES,
  BOOKING_EVENT_CATEGORY,
  BOOKING_EVENT_LIFECYCLE_SEMANTICS,
  SOURCE_READINESS,
  checkAuditToolReadOnly,
};

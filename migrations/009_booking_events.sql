-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009: booking_events — append-only booking lifecycle event store
--
-- P1.5-T2.1 — Immutable Booking Events (Channex + Guest_App)
--
-- SAFETY CONSTRAINTS (must remain true at all times):
--   BOOKING_EVENTS_HAVE_PRICING_AUTHORITY    = NO
--   BOOKING_EVENTS_HAVE_PICKUP_AUTHORITY     = NO
--   PRODUCTION_RESERVATION_SEMANTICS_CHANGED = NO
--   HISTORICAL_BACKFILL                      = NO
--   BLOCK_CAPTURED                           = NO (T2.1 scope)
--   ICAL_CAPTURED                            = NO (T2.1 scope)
--   MANUAL_CAPTURED                          = NO (T2.1 scope)
--
-- This table is OBSERVATIONAL ONLY. No downstream system reads booking_events
-- to make reservation, pricing, availability, or messaging decisions.
--
-- reservation_id is stored as an informational INTEGER with NO FK and NO
-- CASCADE. ON DELETE SET NULL would implicitly write booking_events during
-- cascade deletes on reservations, adding unwanted coupling.
--
-- DO NOT apply this migration until BOOKING_EVENT_PERSISTENCE_ENABLED review.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS booking_events (
  id                  BIGSERIAL    PRIMARY KEY,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Event classification
  event_type          TEXT         NOT NULL,  -- BOOKING_CREATED | BOOKING_MODIFIED | BOOKING_CANCELLED
  event_category      TEXT         NOT NULL DEFAULT 'DEMAND',  -- DEMAND only in T2.1

  -- Source identity (canonical, normalized)
  source              TEXT         NOT NULL,  -- 'channex' | 'guest_app'
  external_booking_id TEXT,                   -- channex booking_id or reservation uid

  -- Property & reservation link (informational, no FK)
  property_id         INTEGER      NOT NULL,
  reservation_id      INTEGER,                -- informational only — NO FK, NO CASCADE

  -- State snapshot at event time
  state_fingerprint   TEXT,                   -- pipe-separated canonical state string
  before_fingerprint  TEXT,                   -- previous state (MODIFIED events only)
  start_date          DATE,
  end_date            DATE,
  status              TEXT,                   -- 'confirmed' | 'cancelled' | ...
  guest_count         INTEGER,

  -- Financial snapshot (NEVER the authority for pricing)
  amount_total        NUMERIC(12,2),
  amount_rooms        NUMERIC(12,2),
  currency            TEXT,                   -- ISO-4217 uppercase, or NULL — NEVER defaulted to EUR
  currency_provenance TEXT,                   -- 'provider' | 'reservation_record' | 'unknown'

  -- Provenance traceability
  provider_event_id   TEXT,                   -- channex revision_id, stripe session_id, etc.
  schema_version      TEXT         NOT NULL DEFAULT '1'
);

-- Compound index for time-range queries per property
CREATE INDEX IF NOT EXISTS idx_booking_events_property_created
  ON booking_events (property_id, created_at DESC);

-- Index for dedup lookups: (source, external_booking_id) used in CREATED/MODIFIED/CANCELLED dedup
CREATE INDEX IF NOT EXISTS idx_booking_events_source_external
  ON booking_events (source, external_booking_id);

-- Partial index for reservation-based lookups (NULL reservation_id excluded)
CREATE INDEX IF NOT EXISTS idx_booking_events_reservation
  ON booking_events (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: booking_events — pre-activation schema fix
--
-- P1.5-T2.1-PREACT-FIX
--
-- Adds event_observed_at and provider_event_at columns.
--
-- ADDITIVE ONLY:
--   No DROP, no TRUNCATE, no destructive ALTER, no table recreation.
--   No historical backfill (booking_events had 0 rows at preparation time).
--
-- Must be applied BEFORE enabling BOOKING_EVENT_PERSISTENCE_ENABLED.
-- DO NOT apply this migration automatically.
-- ─────────────────────────────────────────────────────────────────────────────

-- event_observed_at: The exact instant Boostinghost observed/knew the successful
-- reservation state transition. Primary point-in-time visibility anchor.
--
-- Semantics: at model decision time T, only events with event_observed_at <= T
-- are visible. This is the canonical "when did BH know about this event" field.
--
-- Distinct from created_at (DB row insertion time) even though they will normally
-- be near-equal. The separation is intentional:
--   event_observed_at = Boostinghost observation time (set explicitly by service)
--   created_at        = DB row insertion time (DEFAULT NOW(), not used for analysis)
--
-- NOT derived from: reservation.created_at, provider_event_at, booking_created_at.
-- NOT included in state fingerprint.
ALTER TABLE booking_events
  ADD COLUMN IF NOT EXISTS event_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- provider_event_at: Timestamp from the providing system (Channex, Stripe, etc.)
-- at which the event occurred within that system.
-- NULL when the provider does not supply a reliable event timestamp.
-- NEVER populated from webhook receipt time.
-- Currently NULL for all T2.1 sources (Channex and Guest_App do not provide
-- reliable per-event timestamps in the current integration).
ALTER TABLE booking_events
  ADD COLUMN IF NOT EXISTS provider_event_at TIMESTAMPTZ NULL;

-- booking_created_at and booking_created_at_provenance: DEFERRED.
-- Channex does not provide an exact OTA booking creation timestamp.
-- Guest_app webhook receipt time is not the exact guest booking time.
-- These columns are not added until a source can provide reliable values.

-- Primary temporal index for point-in-time event visibility queries.
-- Enables: WHERE event_observed_at <= $decision_time
CREATE INDEX IF NOT EXISTS idx_booking_events_observed_at
  ON booking_events (event_observed_at DESC);

-- Compound index for property-scoped temporal analysis.
CREATE INDEX IF NOT EXISTS idx_booking_events_property_observed
  ON booking_events (property_id, event_observed_at DESC);

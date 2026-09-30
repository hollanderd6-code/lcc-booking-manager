-- ════════════════════════════════════════════════════════════════════════════
-- P1.4-T1-FIX — Local Seasonality Target-Month Observations
-- Migration 007 — ADDITIVE ONLY
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- Additive only. No destructive statements. No backfill.
--
-- Purpose: accumulate weekly point-in-time booking evidence per target month
-- per active BoostPrice property.  One row per (property, target_month,
-- observation_date, model_version).  Longitudinal data enables studying the
-- booking build-up curve at D180/D120/D90/D60/D30/D14/D7 for each month.
--
-- PRICING AUTHORITY:
--   LOCAL_SEASONALITY_HAS_PRICING_AUTHORITY = NO
--   PRODUCTION_SEASONALITY_CHANGED          = NO
--   This table is read by outils/ audit tools only.
--   It is NEVER imported by pricing-engine.js or any pricing path.
--
-- WRITE GATE:
--   LOCAL_SEASONALITY_SHADOW_ENABLED env var (default false) gates writes.
--
-- READINESS TIER:
--   Derived on-demand from this table, not a separate stored column.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS local_seasonality_observations (
  id                        BIGSERIAL     PRIMARY KEY,

  -- ── Observation identity ──────────────────────────────────────────────────
  property_id               INTEGER       NOT NULL,
  target_month              DATE          NOT NULL,   -- first calendar day: YYYY-MM-01
  observation_date          DATE          NOT NULL,   -- property-local calendar date of run
  calculated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  model_version             TEXT          NOT NULL,   -- e.g. 'seasonality-shadow-v1'

  -- ── Property context (snapshotted at observation time) ───────────────────
  property_timezone         TEXT,                     -- NULL → UTC fallback used
  country                   TEXT,
  currency                  TEXT,

  -- ── Market linkage (nullable — do not create profiles here) ─────────────
  market_context_key        TEXT,
  market_profile_id         TEXT,

  -- ── Calendar math for the target month ───────────────────────────────────
  calendar_nights           INTEGER       NOT NULL,   -- total nights in target month
  elapsed_calendar_nights   INTEGER       NOT NULL,   -- nights already past at observation time
  remaining_calendar_nights INTEGER       NOT NULL,   -- nights still ahead
  days_until_month_start    INTEGER       NOT NULL,   -- +N=future, 0=today, -N=already started
  month_complete            BOOLEAN       NOT NULL,   -- true when observation is after month end

  -- ── Booking evidence for the target month ────────────────────────────────
  booked_nights             INTEGER       NOT NULL DEFAULT 0,   -- confirmed stays (non-BLOCK)
  known_blocked_nights      INTEGER       NOT NULL DEFAULT 0,   -- BLOCK rows
  known_sellable_nights     INTEGER,                            -- NULL when exposure UNKNOWN
  occupancy_fraction        NUMERIC(6, 4),                      -- NULL when not defensible
  exposure_confidence       TEXT          NOT NULL,   -- UNKNOWN | PARTIAL | RELIABLE
  reliable_reservation_count INTEGER      NOT NULL DEFAULT 0,
  source_distribution       JSONB         NOT NULL DEFAULT '{}',

  -- ── Analytical reference ──────────────────────────────────────────────────
  -- The generic IDF seasonality factor for this month from pricing-engine DEFAULTS.
  -- INFORMATIONAL ONLY.  Never read as a pricing authority source.
  generic_reference_factor  NUMERIC(6, 4),

  -- ── Row audit ────────────────────────────────────────────────────────────
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Dedup: one canonical observation per (property, target_month, observation_date, model)
  -- INSERT ON CONFLICT DO NOTHING preserves first observation; never overwrites history.
  CONSTRAINT lso_identity_unique
    UNIQUE (property_id, target_month, observation_date, model_version)
);

CREATE INDEX IF NOT EXISTS idx_lso_property_id
  ON local_seasonality_observations (property_id);

CREATE INDEX IF NOT EXISTS idx_lso_target_month
  ON local_seasonality_observations (target_month DESC);

CREATE INDEX IF NOT EXISTS idx_lso_observation_date
  ON local_seasonality_observations (observation_date DESC);

CREATE INDEX IF NOT EXISTS idx_lso_property_target
  ON local_seasonality_observations (property_id, target_month DESC);

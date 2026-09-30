-- P1.3-T1 — Shadow table for booking pickup observations
-- Additive-only: CREATE TABLE IF NOT EXISTS, no ALTER on existing tables.
-- Never imported by pricing-engine.js or any pricing path.
-- BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED env var (default false) gates writes.

CREATE TABLE IF NOT EXISTS booking_pickup_observations (
  id                      BIGSERIAL PRIMARY KEY,

  -- Identity
  property_id             TEXT        NOT NULL,
  target_date             DATE        NOT NULL,
  calculated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Lead-time context
  lead_time_days          INTEGER     NOT NULL,
  lead_time_band          TEXT        NOT NULL,

  -- Lookback configuration
  lookback_months         INTEGER     NOT NULL,
  target_window_days      INTEGER     NOT NULL,

  -- Historical baseline
  historical_total        INTEGER     NOT NULL,
  historical_band_count   INTEGER     NOT NULL,
  comparable_sample_size  INTEGER     NOT NULL,   -- alias: same as historical_band_count

  -- Recent pickup observation
  recent_window_days      INTEGER     NOT NULL,
  recent_booking_count    INTEGER     NOT NULL,
  expected_booking_count  NUMERIC(8,4) NOT NULL,

  -- Classification
  pickup_ratio            NUMERIC(8,4),           -- NULL when expected ≈ 0
  status                  TEXT        NOT NULL,   -- ACCELERATING | NORMAL | SLOW | INSUFFICIENT_DATA
  confidence              TEXT        NOT NULL,   -- GOOD | MODERATE | LOW | INSUFFICIENT

  -- Advisory signal (shadow only — never applied to pricing)
  advisory_multiplier     NUMERIC(5,4) NOT NULL,

  -- Pacing relation diagnostic
  occupancy_fraction      NUMERIC(6,4),
  pacing_pickup_relation  TEXT,

  -- Provenance
  model_version           TEXT        NOT NULL,
  anomalies_excluded      INTEGER     NOT NULL DEFAULT 0,

  -- Free-form diagnostic fields
  metadata                JSONB,

  -- Prevent duplicate shadow rows for the same (property, target_date) in a single run
  UNIQUE (property_id, target_date, calculated_at)
);

CREATE INDEX IF NOT EXISTS idx_bpo_property_date
  ON booking_pickup_observations (property_id, target_date DESC);

CREATE INDEX IF NOT EXISTS idx_bpo_calculated_at
  ON booking_pickup_observations (calculated_at DESC);

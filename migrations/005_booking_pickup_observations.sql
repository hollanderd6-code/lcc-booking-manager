-- P1.3-T1/T2 — Shadow table for booking pickup observations
-- P1.3-T2 update: added observation_date, raw_pickup_ratio, corrected UNIQUE constraint.
-- Additive-only: CREATE TABLE IF NOT EXISTS, no ALTER on existing tables.
-- For instances where 005 was applied before T2, use 006_booking_pickup_observations_v2.sql.
-- Never imported by pricing-engine.js or any pricing path.
-- BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED env var (default false) gates writes.

CREATE TABLE IF NOT EXISTS booking_pickup_observations (
  id                      BIGSERIAL PRIMARY KEY,

  -- Identity
  property_id             TEXT        NOT NULL,
  target_date             DATE        NOT NULL,
  calculated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Deduplication key: one row per (property, target_date) per calendar day per model
  observation_date        DATE        NOT NULL,   -- UTC date of the calculation run

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

  -- Classification (v1.1: raw vs stabilized ratio; LOW_EVIDENCE status added)
  raw_pickup_ratio        NUMERIC(8,4),           -- NULL when expected < MIN_EXPECTED_FOR_SIGNAL
  pickup_ratio            NUMERIC(8,4),           -- stabilized (Laplace), always non-null when status set
  status                  TEXT        NOT NULL,   -- ACCELERATING | NORMAL | SLOW | LOW_EVIDENCE | INSUFFICIENT_DATA
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

  -- Dedup: one observation per (property, target_date) per day per model version
  CONSTRAINT bpo_property_target_obs_model_unique
    UNIQUE (property_id, target_date, observation_date, model_version)
);

CREATE INDEX IF NOT EXISTS idx_bpo_property_date
  ON booking_pickup_observations (property_id, target_date DESC);

CREATE INDEX IF NOT EXISTS idx_bpo_calculated_at
  ON booking_pickup_observations (calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bpo_observation_date
  ON booking_pickup_observations (observation_date DESC);

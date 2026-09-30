-- ════════════════════════════════════════════════════════════════════════════
-- P1.4-T1 — Local Seasonality Readiness Shadow Table
-- Migration 007 — ADDITIVE ONLY
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
-- Additive only. No destructive statements. No backfill.
--
-- Purpose: accumulate weekly tier-readiness snapshots per active BoostPrice
-- property so we can track when properties graduate from EARLY → MODERATE → GOOD.
--
-- PRICING AUTHORITY:
--   SEASONALITY_HAS_PRICING_AUTHORITY = NO
--   This table is read by outils/ audit tools only.
--   It is NEVER imported by pricing-engine.js or any pricing path.
--
-- WRITE GATE:
--   LOCAL_SEASONALITY_SHADOW_ENABLED env var (default false) gates writes.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS local_seasonality_readiness (
  id                       BIGSERIAL    PRIMARY KEY,

  -- Identity
  property_id              INTEGER      NOT NULL,
  snapshot_date            DATE         NOT NULL,

  -- Sample tier assessment
  tier                     TEXT         NOT NULL,   -- INSUFFICIENT | EARLY | MODERATE | GOOD
  distinct_calendar_months INTEGER      NOT NULL DEFAULT 0,
  distinct_years           INTEGER      NOT NULL DEFAULT 0,
  total_booked_nights      INTEGER      NOT NULL DEFAULT 0,
  yoy_pair_count           INTEGER      NOT NULL DEFAULT 0,
  exposure_confidence      TEXT         NOT NULL DEFAULT 'NONE',  -- FULL | PARTIAL | NONE

  -- Stay date range
  first_stay_date          DATE,
  last_stay_date           DATE,

  -- Per-month breakdown (JSONB: { 'YYYY-MM': nightCount, ... })
  monthly_nights_json      JSONB,

  -- Provenance
  model_version            TEXT         NOT NULL DEFAULT 'seasonality-v1',
  computed_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Dedup: one snapshot per property per calendar day
  CONSTRAINT lsr_property_date_unique
    UNIQUE (property_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_lsr_property_id
  ON local_seasonality_readiness (property_id);

CREATE INDEX IF NOT EXISTS idx_lsr_snapshot_date
  ON local_seasonality_readiness (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_lsr_tier
  ON local_seasonality_readiness (tier);

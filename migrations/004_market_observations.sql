-- ════════════════════════════════════════════════════════════════════════════
-- P1.2-B5-BK-O — Market Observation Store
-- Migration 004 — ADDITIVE ONLY — rev 2 (O-FIX hardening)
--
-- !! DO NOT APPLY AUTOMATICALLY !!
-- Review fully before executing against production.
--
-- Idempotent: all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- No DROP. No destructive ALTER. No backfill. No mutation of market_data.
--
-- RETENTION: INDEFINITE — observations are never deleted.
--   STALE_FOR_PRICING != USELESS_FOR_HISTORY
-- ════════════════════════════════════════════════════════════════════════════

-- ── market_profiles ──────────────────────────────────────────────────────────
-- Stores the canonical dimension set for each distinct market profile.
-- A profile represents: "which properties share the same market search?"
-- Profile ID = mp2_<sha256(v,lat4dp,lon4dp,currency,guests,bedrooms,propType)>
-- Profiles are immutable identity records — never updated after creation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_profiles (
  profile_id            TEXT PRIMARY KEY,
  schema_version        SMALLINT NOT NULL DEFAULT 2,

  -- Geo bucket: lat/lon rounded to 4 decimal places ≈ 11 m at equator
  -- Stored as TEXT because toFixed(4) is the canonical form; range-checked below.
  geo_lat               TEXT NOT NULL,   -- lat.toFixed(4)
  geo_lon               TEXT NOT NULL,   -- lon.toFixed(4)

  currency              TEXT NOT NULL
    CONSTRAINT chk_mp_currency CHECK (currency ~ '^[A-Z]{3}$'),

  -- Search filter dimensions — NULL = "any" (not a filter applied)
  target_guests         SMALLINT,
  target_bedrooms       SMALLINT,
  target_property_type  TEXT NOT NULL DEFAULT 'entire_place',

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Geo range guards — defend against bad toFixed(4) caller output
  CONSTRAINT chk_mp_geo_lat CHECK (CAST(geo_lat AS NUMERIC) BETWEEN -90 AND 90),
  CONSTRAINT chk_mp_geo_lon CHECK (CAST(geo_lon AS NUMERIC) BETWEEN -180 AND 180)
);

-- ── market_profile_properties ─────────────────────────────────────────────────
-- Links properties to their CURRENT market profile.
-- One property → exactly one active profile at any time (cardinality = 1:1).
-- Rebuilt automatically when profile identity dimensions change.
-- Historical attribution is preserved in market_observation_properties (below).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_profile_properties (
  profile_id            TEXT NOT NULL REFERENCES market_profiles(profile_id),
  property_id           TEXT NOT NULL,
  user_id               TEXT REFERENCES users(id) ON DELETE CASCADE,
  assigned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (profile_id, property_id),
  -- One property → one active profile at a time (current assignment cardinality)
  CONSTRAINT uq_mpp_property_id UNIQUE (property_id)
);

CREATE INDEX IF NOT EXISTS idx_mpp_property_id
  ON market_profile_properties(property_id);

-- ── market_observations ───────────────────────────────────────────────────────
-- Core immutable observation store.
-- Each row = one scrape result for one provider at one point in time.
-- NEVER updated. New scrape = new row. History is preserved indefinitely.
-- RETENTION: INDEFINITE — STALE_FOR_PRICING != USELESS_FOR_HISTORY
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_observations (
  id                    BIGSERIAL PRIMARY KEY,
  observation_id        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  schema_version        SMALLINT NOT NULL DEFAULT 1,

  -- Provider identity
  provider              TEXT NOT NULL
    CONSTRAINT chk_mo_provider CHECK (provider IN ('airbnb', 'booking', 'consensus')),
  observation_type      TEXT NOT NULL DEFAULT 'PROVIDER'
    CONSTRAINT chk_mo_type CHECK (observation_type IN ('PROVIDER', 'DERIVED_CONSENSUS')),
  provider_snapshot_id  TEXT,          -- provider's own ID if available; NULL if unavailable
  data_source           TEXT,          -- 'brightdata_live', 'mock', etc.

  -- Time
  collected_at          TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Search identity
  search_fingerprint    TEXT NOT NULL,
  -- FK to market_profiles with RESTRICT: prevents accidental deletion of a profile
  -- while observations reference it. Profiles are immutable; this guard never fires
  -- in normal operation but prevents accidental data loss.
  market_profile_id     TEXT
    REFERENCES market_profiles(profile_id) ON DELETE RESTRICT,
  currency              TEXT NOT NULL
    CONSTRAINT chk_mo_currency CHECK (currency ~ '^[A-Z]{3}$'),

  -- Stay window
  check_in              DATE,
  check_out             DATE,
  nights                SMALLINT,

  -- Target (what was searched for)
  target_lat            NUMERIC(9,6),
  target_lon            NUMERIC(9,6),
  target_guests         SMALLINT,
  target_bedrooms       SMALLINT,
  target_property_type  TEXT,

  -- Collection parameters
  requested_max_listings INTEGER,
  raw_count             INTEGER,
  accepted_count        INTEGER,
  comparable_count      INTEGER,
  selected_radius_km    NUMERIC(5,2),

  -- Statistics
  median_price          NUMERIC(10,2),
  p25_price             NUMERIC(10,2),
  p75_price             NUMERIC(10,2),
  min_price             NUMERIC(10,2),   -- NULL if not reliably available
  max_price             NUMERIC(10,2),   -- NULL if not reliably available

  -- Quality assessment
  quality_status        TEXT,
  confidence            TEXT,
  reliability_status    TEXT,

  -- Consensus provenance (only populated for DERIVED_CONSENSUS rows)
  -- Source observation links live in market_observation_sources (proper FK table,
  -- replaces the former unsafe source_observation_ids UUID[] column).
  algorithm_version     TEXT,

  -- Idempotency: prevents duplicate on worker retry
  collection_run_id     TEXT,

  -- Extensible provenance metadata (non-critical, future-proof)
  provenance            JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- ── Constraints ──────────────────────────────────────────────────────────

  -- provider/type must agree bidirectionally: 'consensus' ↔ 'DERIVED_CONSENSUS'
  CONSTRAINT chk_mo_provider_type_consistency CHECK (
    (provider = 'consensus') = (observation_type = 'DERIVED_CONSENSUS')
  ),

  CONSTRAINT chk_mo_check_out_after_in CHECK (
    check_out IS NULL OR check_in IS NULL OR check_out > check_in
  ),
  CONSTRAINT chk_mo_nights_positive CHECK (
    nights IS NULL OR nights > 0
  ),

  -- Count constraints (null-tolerant)
  CONSTRAINT chk_mo_raw_count_nonneg CHECK (
    raw_count IS NULL OR raw_count >= 0
  ),
  CONSTRAINT chk_mo_accepted_count_nonneg CHECK (
    accepted_count IS NULL OR accepted_count >= 0
  ),
  CONSTRAINT chk_mo_comparable_nonneg CHECK (
    comparable_count IS NULL OR comparable_count >= 0
  ),
  -- accepted cannot exceed raw (only fires when both are present)
  CONSTRAINT chk_mo_accepted_le_raw CHECK (
    accepted_count IS NULL OR raw_count IS NULL OR accepted_count <= raw_count
  ),

  -- Statistical ordering (null-tolerant — only fires when both sides present)
  CONSTRAINT chk_mo_median_positive CHECK (
    median_price IS NULL OR median_price > 0
  ),
  CONSTRAINT chk_mo_p25_positive CHECK (
    p25_price IS NULL OR p25_price > 0
  ),
  CONSTRAINT chk_mo_p25_le_median CHECK (
    p25_price IS NULL OR median_price IS NULL OR p25_price <= median_price
  ),
  CONSTRAINT chk_mo_median_le_p75 CHECK (
    median_price IS NULL OR p75_price IS NULL OR median_price <= p75_price
  ),
  CONSTRAINT chk_mo_min_le_max CHECK (
    min_price IS NULL OR max_price IS NULL OR min_price <= max_price
  ),
  CONSTRAINT chk_mo_min_le_median CHECK (
    min_price IS NULL OR median_price IS NULL OR min_price <= median_price
  ),
  CONSTRAINT chk_mo_max_ge_median CHECK (
    max_price IS NULL OR median_price IS NULL OR max_price >= median_price
  ),

  -- Geo target range guards (search coordinate sanity)
  CONSTRAINT chk_mo_target_lat CHECK (
    target_lat IS NULL OR target_lat BETWEEN -90 AND 90
  ),
  CONSTRAINT chk_mo_target_lon CHECK (
    target_lon IS NULL OR target_lon BETWEEN -180 AND 180
  ),

  CONSTRAINT chk_mo_radius_positive CHECK (
    selected_radius_km IS NULL OR selected_radius_km > 0
  )
);

-- Idempotency index: one observation per (collection_run_id × fingerprint)
-- Allows: same fingerprint at different times (historical) ✓
-- Prevents: double-insert on retry within same run ✓
CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_run_fingerprint
  ON market_observations(collection_run_id, search_fingerprint)
  WHERE collection_run_id IS NOT NULL;

-- Primary lookup: find observations for a fingerprint (cache/reuse)
CREATE INDEX IF NOT EXISTS idx_mo_fingerprint
  ON market_observations(search_fingerprint);

-- History query: all observations for a profile, newest first
CREATE INDEX IF NOT EXISTS idx_mo_profile_collected
  ON market_observations(market_profile_id, collected_at DESC)
  WHERE market_profile_id IS NOT NULL;

-- Cross-provider comparison queries
CREATE INDEX IF NOT EXISTS idx_mo_provider_check_in
  ON market_observations(provider, check_in)
  WHERE check_in IS NOT NULL;

-- Time-range history queries
CREATE INDEX IF NOT EXISTS idx_mo_collected_at
  ON market_observations(collected_at DESC);

-- ── market_observation_sources ────────────────────────────────────────────────
-- Provenance links for DERIVED_CONSENSUS observations.
-- Replaces the former unsafe source_observation_ids UUID[] column with proper
-- FK-enforced rows. Each row records: derived_observation_id was built from
-- source_observation_id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_observation_sources (
  derived_observation_id  UUID NOT NULL
    REFERENCES market_observations(observation_id) ON DELETE CASCADE,
  source_observation_id   UUID NOT NULL
    REFERENCES market_observations(observation_id) ON DELETE RESTRICT,
  PRIMARY KEY (derived_observation_id, source_observation_id),
  -- A consensus observation cannot list itself as its own source
  CONSTRAINT chk_mos_no_self_reference CHECK (
    derived_observation_id != source_observation_id
  )
);

CREATE INDEX IF NOT EXISTS idx_mos_source
  ON market_observation_sources(source_observation_id);

-- ── market_observation_properties ─────────────────────────────────────────────
-- Links observations to the properties that consumed them.
-- One observation can serve N properties (shared search result).
-- This is NOT a pricing decision — it is an attribution record.
-- HISTORICAL: survives profile changes. market_profile_properties reflects current.
-- (profile_id here has no FK — intentional, so old observations survive if a
--  property is re-profiled. market_profile_properties = current; this = history.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_observation_properties (
  observation_id        UUID NOT NULL
    REFERENCES market_observations(observation_id) ON DELETE CASCADE,
  property_id           TEXT NOT NULL,
  user_id               TEXT,
  profile_id            TEXT,
  -- Why this property was assigned this observation
  assignment_reason     TEXT,          -- 'shared_search', 'direct', 'consensus'
  assigned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (observation_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_mop_property
  ON market_observation_properties(property_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_mop_profile
  ON market_observation_properties(profile_id)
  WHERE profile_id IS NOT NULL;

-- ── market_observation_comparables ────────────────────────────────────────────
-- Optional: raw listing-level data from which statistics were computed.
-- Stores ANALYTICAL VARIABLES ONLY — no personal data, no marketing text,
-- no images, no host names, no traveler data.
-- RETENTION: INDEFINITE — same as the parent observation.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_observation_comparables (
  id                    BIGSERIAL PRIMARY KEY,
  observation_id        UUID NOT NULL
    REFERENCES market_observations(observation_id) ON DELETE CASCADE,
  provider_listing_id   TEXT,          -- provider's own ID for the comparable
  provider              TEXT,
  latitude              NUMERIC(9,6),
  longitude             NUMERIC(9,6),
  distance_km           NUMERIC(6,3),
  nightly_price         NUMERIC(10,2),
  currency              TEXT
    CONSTRAINT chk_moc_currency CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  -- Analytical dimensions (no personal data)
  guests_capacity       SMALLINT,
  bedrooms              SMALLINT,
  property_type         TEXT,
  rating                NUMERIC(3,2),  -- e.g. 4.85 — aggregate only, no reviewer identity
  review_count          INTEGER,

  -- Availability signal — only if semantically defined for this provider
  availability_signal   TEXT,

  -- How prices/counts were normalized before aggregation
  normalization_meta    JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_moc_price_positive CHECK (
    nightly_price IS NULL OR nightly_price > 0
  ),
  CONSTRAINT chk_moc_distance_nonneg CHECK (
    distance_km IS NULL OR distance_km >= 0
  ),
  CONSTRAINT chk_moc_review_count_nonneg CHECK (
    review_count IS NULL OR review_count >= 0
  ),
  -- Geo range guards for comparable coordinates
  CONSTRAINT chk_moc_lat CHECK (
    latitude IS NULL OR latitude BETWEEN -90 AND 90
  ),
  CONSTRAINT chk_moc_lon CHECK (
    longitude IS NULL OR longitude BETWEEN -180 AND 180
  )
);

CREATE INDEX IF NOT EXISTS idx_moc_observation
  ON market_observation_comparables(observation_id);

-- Retry deduplication: same listing within same observation = same row (when known)
-- Partial index: only enforced when provider_listing_id is not NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_moc_obs_provider_listing
  ON market_observation_comparables(observation_id, provider, provider_listing_id)
  WHERE provider_listing_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 004
--
-- RETENTION: INDEFINITE — STALE_FOR_PRICING != USELESS_FOR_HISTORY
-- Observations are immutable historical events. Never delete them.
--
-- To apply manually:
--   psql "$DATABASE_URL" -f migrations/004_market_observations.sql
--
-- To verify after applying:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN (
--     'market_profiles', 'market_profile_properties',
--     'market_observations', 'market_observation_sources',
--     'market_observation_properties', 'market_observation_comparables'
--   );
-- ════════════════════════════════════════════════════════════════════════════

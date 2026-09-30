-- ============================================================
-- P1.5-T1 — Price Observations
-- Append-only point-in-time record of canonical effective pricing state.
--
-- SEMANTICS:
--   "At observed_at T, Boostinghost's canonical effective pricing state for
--    property P / stay_date D was X."
--   This does NOT mean: guest saw the price, Channex published it,
--   OTA displayed it, property was sellable, or booking was possible.
--
-- DESIGN:
--   Append-only — historical rows are NEVER updated or deleted.
--   No UNIQUE constraint on (property_id, stay_date) — multiple
--   observations per stay date are expected and correct (intraday
--   price changes, heartbeat).
--   No UNIQUE constraint on (property_id, stay_date, observed_at) —
--   clock granularity or retry could produce identical timestamps.
--   Dedup is handled in the service layer via state_fingerprint.
--
-- AUTHORITY:
--   PRICE_OBSERVATION_HAS_PRICING_AUTHORITY = NO
--   No pricing engine reads this table. Write-only from pricing flow.
--
-- FLAG:
--   PRICE_OBSERVATION_PERSISTENCE_ENABLED (env var) — default FALSE.
--   When FALSE: 0 rows ever inserted here.
-- ============================================================

CREATE TABLE IF NOT EXISTS price_observations (
  -- ── Identity ─────────────────────────────────────────────────────────────
  id                       BIGSERIAL    PRIMARY KEY,
  property_id              TEXT         NOT NULL,
  stay_date                DATE         NOT NULL,

  -- ── Observation timing ───────────────────────────────────────────────────
  -- observed_at: exact moment the effective pricing state was captured.
  -- Use TIMESTAMPTZ — multiple intraday changes for same stay_date must survive.
  -- observation_date: calendar date (property local) for partitioning/analysis.
  observed_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  observation_date         DATE         NOT NULL,
  property_timezone        TEXT,

  -- ── Schema versioning ────────────────────────────────────────────────────
  schema_version           TEXT         NOT NULL DEFAULT '1',

  -- ── Canonical price ──────────────────────────────────────────────────────
  -- NULL when price_source='none' (no price resolution possible).
  canonical_price          NUMERIC(10,2),
  currency                 TEXT,
  -- currency_provenance: how currency was determined.
  -- 'property_record' | 'unknown'
  currency_provenance      TEXT         NOT NULL DEFAULT 'unknown',

  -- ── Price source (effective-pricing-resolver SOURCE constants) ───────────
  -- manual_override | boostprice | period_rule | weekday_rule |
  -- weekend_price | base_price | none
  price_source             TEXT         NOT NULL DEFAULT 'none',
  price_source_id          INTEGER,

  -- ── Restrictions ─────────────────────────────────────────────────────────
  min_stay_arrival         INTEGER      NOT NULL DEFAULT 1,
  min_stay_through         INTEGER      NOT NULL DEFAULT 1,
  min_stay_source          TEXT,
  stop_sell                BOOLEAN      NOT NULL DEFAULT FALSE,
  stop_sell_source         TEXT,

  -- ── Pricing mode flags ───────────────────────────────────────────────────
  manual_override_present  BOOLEAN      NOT NULL DEFAULT FALSE,
  boostprice_present       BOOLEAN      NOT NULL DEFAULT FALSE,
  external_pricing         BOOLEAN      NOT NULL DEFAULT FALSE,

  -- ── Derived context ──────────────────────────────────────────────────────
  -- lead_days: (stay_date - observed_at::date) at observation time.
  -- Stored for lead-time analysis without runtime subtraction.
  lead_days                INTEGER,

  -- ── Publication linkage ──────────────────────────────────────────────────
  -- publisher_run_id: groups observations from the same publish invocation.
  -- NULL if observation was not triggered via the central publisher.
  publisher_run_id         TEXT,

  -- ── Dedup / change detection ─────────────────────────────────────────────
  -- state_fingerprint: deterministic hash of the effective pricing state fields.
  -- Used by the service layer to skip identical consecutive observations.
  -- Does NOT include observed_at (timestamp excluded — fingerprint must be stable).
  state_fingerprint        TEXT         NOT NULL,

  -- ── Publication state ────────────────────────────────────────────────────
  -- RESOLVED         — effective state captured; no Channex evidence yet.
  -- PUBLISH_SKIPPED  — publisher guard was met (external_pricing, no channex).
  -- DEFERRED         — reserved for future use.
  -- NOTE: OTA_DISPLAYED must NOT be used. Channex push ≠ OTA exposure.
  publication_state        TEXT         NOT NULL DEFAULT 'RESOLVED',

  -- ── Audit ────────────────────────────────────────────────────────────────
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- ── Constraints ──────────────────────────────────────────────────────────
  CONSTRAINT po_price_nonneg    CHECK (canonical_price IS NULL OR canonical_price >= 0),
  CONSTRAINT po_source_valid    CHECK (price_source IN (
    'manual_override', 'boostprice', 'period_rule', 'weekday_rule',
    'weekend_price',   'base_price', 'none'
  )),
  CONSTRAINT po_pub_state_valid CHECK (publication_state IN (
    'RESOLVED', 'PUBLISH_SKIPPED', 'DEFERRED'
  )),
  CONSTRAINT po_currency_prov   CHECK (currency_provenance IN (
    'property_record', 'unknown'
  )),
  CONSTRAINT po_min_stay_pos    CHECK (min_stay_arrival >= 1 AND min_stay_through >= 1),
  CONSTRAINT po_schema_nonempty CHECK (schema_version <> '')
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Primary analytical access: all observations for a (property, stay_date), time-ordered.
CREATE INDEX IF NOT EXISTS idx_po_prop_stay_at
  ON price_observations (property_id, stay_date, observed_at DESC);

-- Chronological access per property (audit, most-recent, run grouping).
CREATE INDEX IF NOT EXISTS idx_po_prop_at
  ON price_observations (property_id, observed_at DESC);

-- Stay-date access (cross-property analysis, expiry cleanup by date range).
CREATE INDEX IF NOT EXISTS idx_po_stay_date
  ON price_observations (stay_date);

-- Dedup lookup: latest fingerprint per (property, stay_date) within window.
CREATE INDEX IF NOT EXISTS idx_po_fingerprint
  ON price_observations (property_id, stay_date, state_fingerprint);

-- P1.3-T2 — Incremental migration for booking_pickup_observations
-- Applied when migration 005 was executed before the P1.3-T2 schema update.
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.
--
-- Context: BOOKING_PICKUP_SHADOW_PERSISTENCE_ENABLED was OFF during 005,
-- so the table is empty. No data migration required.
--
-- Changes vs 005 original:
--   1. Add observation_date  — deduplication key (one row per calendar day per model)
--   2. Add raw_pickup_ratio  — v1.1 adds rawPickupRatio to observation object
--   3. Drop old UNIQUE(property_id, target_date, calculated_at)  — too granular
--   4. Add UNIQUE(property_id, target_date, observation_date, model_version)
--   5. Add index on observation_date

-- 1. Deduplication key column
ALTER TABLE booking_pickup_observations
  ADD COLUMN IF NOT EXISTS observation_date DATE;

-- 2. Raw (pre-stabilization) pickup ratio from v1.1 model
ALTER TABLE booking_pickup_observations
  ADD COLUMN IF NOT EXISTS raw_pickup_ratio NUMERIC(8,4);

-- 3. Drop original uniqueness (calculated_at changes on every retry — not a useful dedup key)
ALTER TABLE booking_pickup_observations
  DROP CONSTRAINT IF EXISTS booking_pickup_observations_property_id_target_date_calculated__key;

-- 4. Correct deduplication: once per (property, target_date, calendar day, model)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bpo_property_target_obs_model_unique'
  ) THEN
    ALTER TABLE booking_pickup_observations
      ADD CONSTRAINT bpo_property_target_obs_model_unique
      UNIQUE (property_id, target_date, observation_date, model_version);
  END IF;
END $$;

-- 5. Index for retention queries keyed by observation_date
CREATE INDEX IF NOT EXISTS idx_bpo_observation_date
  ON booking_pickup_observations (observation_date DESC);

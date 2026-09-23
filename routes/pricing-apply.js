// ============================================================
// 🔌 PRICING APPLY — Intégration moteur per-night ↔ Channex
// ------------------------------------------------------------
// Pour UN logement :
//   1. lance le moteur per-night (pricing-engine.js)
//   2. stocke le planning nuit par nuit (table pricing_schedule, auto-créée)
//      avec le breakdown complet (→ UI "pourquoi ce prix")
//   3. mode 'auto'   → push rates + restrictions vers Channex
//      mode 'manual' → planning en 'pending' (suggestions), pas de push
//   4. écrit un récap HEBDO dans pricing_history (compat UI/email existants)
//
// Appelé par le cron (dynamic-pricing-cron.js) après le scrape marché.
// ============================================================

'use strict';

const {
  priceProperty,
  SCHOOL_HOLIDAYS_IDF_2025_2026,
  EVENTS_PARIS_2026,
} = require('./pricing-engine');

const { addDays } = require('./effective-pricing-resolver');
const { publishEffectivePricing } = require('./pricing-publisher');

// ── Lundi de la semaine courante (aligne le récap hebdo) ─────
function getCurrentWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ── Table planning par nuit (auto-créée une seule fois) ──────
let _tableReady = false;
async function ensureScheduleTable(pool) {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pricing_schedule (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL,
      property_id  TEXT NOT NULL,
      date         DATE NOT NULL,
      price        NUMERIC(10,2) NOT NULL,
      min_stay     INTEGER,
      reason       TEXT,
      breakdown    JSONB DEFAULT '{}'::jsonb,
      status       TEXT NOT NULL DEFAULT 'pending',   -- pending | applied
      pushed_at    TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(property_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_pricing_schedule_user
      ON pricing_schedule(user_id);
    CREATE INDEX IF NOT EXISTS idx_pricing_schedule_prop_date
      ON pricing_schedule(property_id, date);
  `);
  _tableReady = true;
}

// ── Upsert du planning par nuit (par lots) ───────────────────
async function upsertSchedule(pool, userId, propertyId, nights, status) {
  if (status !== 'applied' && status !== 'pending') {
    throw new Error(`upsertSchedule: statut invalide "${status}" — attendu applied|pending`);
  }
  // pushed_at est un littéral SQL (fonction ou NULL), pas un paramètre
  const pushedAtSql = status === 'applied' ? 'NOW()' : 'NULL';
  const CHUNK = 200;
  for (let i = 0; i < nights.length; i += CHUNK) {
    const slice = nights.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    slice.forEach((n, k) => {
      const b = k * 8;   // 8 params par nuit (status ajouté)
      values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},${pushedAtSql})`);
      params.push(
        userId, propertyId, n.date, n.price, n.minStay,
        n.reason, JSON.stringify(n.breakdown || {}), status
      );
    });
    await pool.query(
      `INSERT INTO pricing_schedule
         (user_id, property_id, date, price, min_stay, reason, breakdown,
          status, pushed_at)
       VALUES ${values.join(',')}
       ON CONFLICT (property_id, date) DO UPDATE SET
         user_id    = EXCLUDED.user_id,
         price      = EXCLUDED.price,
         min_stay   = EXCLUDED.min_stay,
         reason     = EXCLUDED.reason,
         breakdown  = EXCLUDED.breakdown,
         status     = EXCLUDED.status,
         pushed_at  = EXCLUDED.pushed_at,
         updated_at = NOW()`,
      params
    );
  }
}

// ── Map des réglages pricing_config → overrides moteur ───────
// (extensible : ajoute des colonnes à pricing_config et mappe-les ici)
function configToOverride(cfg) {
  const ov = {};
  if (cfg.aggressiveness != null)  ov.aggressiveness = parseFloat(cfg.aggressiveness);
  if (cfg.market_weight  != null)  ov.marketWeight   = parseFloat(cfg.market_weight);
  if (cfg.horizon_days   != null)  ov.horizonDays    = parseInt(cfg.horizon_days);
  if (cfg.strategy       != null)  ov.strategy       = parseInt(cfg.strategy);
  return ov;
}

// ============================================================
// applyDynamicPricingForProperty
// ============================================================
async function applyDynamicPricingForProperty(pool, { cfg, marketStats, isMock, marketOverride, sendPushNotification }) {
  await ensureScheduleTable(pool);
  const weekStart = getCurrentWeekStart();

  // 1. Logement + champs Channex
  const prop = (await pool.query(
    `SELECT id, name, base_price, weekend_price,
            channex_enabled, channex_property_id, channex_room_type_id, channex_rate_plan_id,
            external_pricing
       FROM properties WHERE id = $1`,
    [cfg.property_id]
  )).rows[0];

  if (!prop || prop.base_price == null) {
    console.warn(`⚠️ [DP-APPLY] base_price manquant pour ${cfg.property_name} — skip`);
    return { status: 'error', error: 'base_price manquant', priceBefore: null, priceApplied: null, priceCalculated: null, nights: 0 };
  }

  // 2. Moteur per-night (J → J+horizon)
  // marketOverride present → pipeline resolved usability; pass it (null = neutral).
  // marketOverride absent  → backward-compat: priceProperty does its own DB lookup.
  const engineOpts = {
    userId: cfg.user_id,
    property: prop,
    today: new Date(),
    events: EVENTS_PARIS_2026,
    schoolHolidays: SCHOOL_HOLIDAYS_IDF_2025_2026,
    configOverride: configToOverride(cfg),
  };
  // marketOverride !== undefined means the caller explicitly resolved market usability.
  // null = neutral (stale/untrusted). An object = use it. Absent (undefined) = legacy DB lookup.
  if (marketOverride !== undefined) engineOpts.marketOverride = marketOverride;

  const result = await priceProperty(pool, engineOpts);

  const nights = result.schedule.filter(n => !n.booked);
  if (nights.length === 0) {
    return { status: 'skipped', reason: 'aucune nuit à tarifer', priceBefore: null, priceApplied: null, priceCalculated: null, nights: 0 };
  }

  // 3. Mode → push ou suggestions
  const mode = cfg.mode || 'manual';
  const canPush = prop.channex_enabled && prop.channex_rate_plan_id && !prop.external_pricing;
  if (mode === 'auto' && canPush && isMock) {
    console.warn(`⚠️ [DP-APPLY] ${prop.name}: auto push bloqué — données marché non live (data_source non 'apify_live')`);
  }
  const willPush = mode === 'auto' && canPush && !isMock;
  const status = willPush ? 'applied' : 'pending';

  // 4. Stockage du planning par nuit (+ breakdown)
  // C7: in manual mode, skip dates already locked by an explicit manual accept
  let nightsToUpsert = nights;
  if (!willPush) {
    try {
      const manualApplied = await pool.query(
        `SELECT week_start FROM pricing_history
         WHERE property_id = $1 AND status = 'applied' AND mode_used = 'manual'`,
        [cfg.property_id]
      );
      if (manualApplied.rows.length > 0) {
        const protectedDates = new Set();
        for (const row of manualApplied.rows) {
          const ws = String(row.week_start).slice(0, 10);
          for (let i = 0; i < 7; i++) protectedDates.add(addDays(ws, i));
        }
        nightsToUpsert = nights.filter(n => !protectedDates.has(n.date));
        const skipped = nights.length - nightsToUpsert.length;
        if (skipped > 0) {
          console.log(`[DP-APPLY] C7: ${skipped} nuit(s) protégée(s) par accept manuel pour ${cfg.property_id}`);
        }
      }
    } catch (e) {
      console.error(`⚠️ [DP-APPLY] C7 protection query failed (${cfg.property_id}):`, e.message);
    }
  }
  await upsertSchedule(pool, cfg.user_id, cfg.property_id, nightsToUpsert, status);

  // 5. Publish via central publisher (mode auto uniquement)
  // allowedDates = exactement les dates upsertées applied — nuits booked exclues
  let pubResult = { status: 'skipped_no_push', rates: { count: 0, pushed: 0, error: null }, restrictions: { count: 0, pushed: 0, error: null } };
  if (willPush) {
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate   = addDays(startDate, 365);
    const allowedDates = nightsToUpsert.map(n => n.date);
    try {
      pubResult = await publishEffectivePricing(pool, {
        propertyId:      cfg.property_id,
        userId:          cfg.user_id,
        startDate,
        endDate,
        allowedDates,
        reason:          'boostprice_auto',
        includeStopSell: false,
      });
      console.log(`📡 [DP-APPLY] ${prop.name} : pub:${pubResult.status} rates:${pubResult.rates.pushed}/${pubResult.rates.count}`);
    } catch (pubErr) {
      console.error(`⚠️ [DP-APPLY] publisher throw inattendu (${prop.name}):`, pubErr.message);
      pubResult = { status: 'error', rates: { count: allowedDates.length, pushed: 0, error: pubErr.message }, restrictions: { count: allowedDates.length, pushed: 0, error: null } };
    }
  }

  // 6. Récap HEBDO dans pricing_history (compat UI/email existants)
  const next7 = nights.slice(0, 7).map(n => n.price);
  const avg7 = Math.round(next7.reduce((a, b) => a + b, 0) / next7.length);
  const first = nights[0];

  // occupation hôte sur 30 jours (depuis le planning)
  const next30 = result.schedule.slice(0, 30);
  const booked30 = next30.filter(n => n.booked).length;
  const selfOcc = Math.round((booked30 / 30) * 100);

  // prix précédent (dernier appliqué)
  let priceBefore = marketStats?.median ? parseFloat(marketStats.median) : avg7;
  try {
    const pb = await pool.query(
      `SELECT price_applied FROM pricing_history
        WHERE property_id = $1 AND price_applied IS NOT NULL
        ORDER BY week_start DESC LIMIT 1`,
      [cfg.property_id]
    );
    if (pb.rows[0]?.price_applied) priceBefore = parseFloat(pb.rows[0].price_applied);
  } catch {}

  const reason = willPush
    ? `${nightsToUpsert.length} nuits recalculées (pub:${pubResult.status})`
    : `${nightsToUpsert.length} suggestions prêtes${isMock ? ' (marché simulé)' : ''}`;

  try {
    await pool.query(
      `INSERT INTO pricing_history (
         user_id, property_id, week_start,
         price_before, price_calculated, price_applied,
         market_median, market_occupancy, tension_level,
         factor_market, factor_self, factor_season,
         self_occupancy, status, mode_used, reason,
         applied_by, applied_at, created_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())
       ON CONFLICT (property_id, week_start) DO UPDATE SET
         price_before     = EXCLUDED.price_before,
         price_calculated = EXCLUDED.price_calculated,
         price_applied    = EXCLUDED.price_applied,
         market_median    = EXCLUDED.market_median,
         market_occupancy = EXCLUDED.market_occupancy,
         tension_level    = EXCLUDED.tension_level,
         factor_market    = EXCLUDED.factor_market,
         factor_self      = EXCLUDED.factor_self,
         factor_season    = EXCLUDED.factor_season,
         self_occupancy   = EXCLUDED.self_occupancy,
         status           = EXCLUDED.status,
         mode_used        = EXCLUDED.mode_used,
         reason           = EXCLUDED.reason,
         updated_at       = NOW()`,
      [
        cfg.user_id, cfg.property_id, weekStart,
        priceBefore, avg7, willPush ? avg7 : null,
        marketStats?.median ?? null, marketStats?.occupancy ?? null, marketStats?.tensionLevel ?? null,
        first.breakdown.market, first.breakdown.pacing, first.breakdown.season,
        selfOcc, willPush ? 'applied' : 'pending', mode, reason,
        willPush ? 'auto' : null, willPush ? new Date() : null,
      ]
    );
  } catch (e) {
    console.error(`⚠️ [DP-APPLY] pricing_history (${prop.name}):`, e.message);
  }

  // 7. Notification push
  if (cfg.notify_push && sendPushNotification) {
    try {
      await sendPushNotification(cfg.user_id, {
        title: willPush ? '💰 Prix mis à jour' : '💡 Suggestions de prix',
        body: willPush
          ? `${prop.name} : ${nights.length} nuits réajustées (moy. ${avg7}€)`
          : `${prop.name} : ${nights.length} suggestions prêtes (moy. ${avg7}€)`,
        data: { type: 'dynamic_pricing', propertyId: cfg.property_id },
      });
    } catch (pErr) {
      console.error(`❌ [DP-APPLY] Push failed (${prop.name}):`, pErr.message);
    }
  }

  return {
    status: willPush ? 'applied' : 'pending',
    mode,
    priceBefore,
    priceApplied: willPush ? avg7 : null,
    priceCalculated: avg7,
    nights: nights.length,
    pushed: pubResult.rates.pushed,
    publishStatus: pubResult.status,
  };
}

module.exports = { applyDynamicPricingForProperty, ensureScheduleTable, upsertSchedule };

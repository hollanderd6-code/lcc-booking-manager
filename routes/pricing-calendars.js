// ============================================================
// 📅 PRICING CALENDARS — Vacances scolaires (par zone) + Événements (par client)
// ------------------------------------------------------------
// Rend les calendriers MULTI-CLIENTS / MULTI-ZONES :
//
//   • school_holidays  : table de RÉFÉRENCE partagée, par zone A/B/C
//                        (seedée avec les vraies dates officielles 2025-2027).
//   • pricing_events   : événements PROPRES À CHAQUE CLIENT (salons, concerts…),
//                        applicables à tous ses logements ou à un seul.
//   • pricing_config.school_zone : la zone scolaire de CHAQUE logement
//                        (défaut 'C' = Île-de-France / Paris / Créteil / Versailles).
//
// Le moteur reçoit, pour un logement donné, SES événements + les vacances
// de SA zone. Chaque client gère ses propres données.
//
// Zones (académies) :
//   A : Besançon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon, Poitiers
//   B : Aix-Marseille, Amiens, Caen, Lille, Nancy-Metz, Nantes, Nice,
//       Orléans-Tours, Reims, Rennes, Rouen, Strasbourg
//   C : Créteil, Montpellier, Paris, Toulouse, Versailles   ← Massy / CDG
// ============================================================

'use strict';

const express = require('express');
const { resolveMarketData } = require('./market-data-resolver');
const { computeMarketContextKey } = require('./market-context-key');

// ── Dates officielles (Journal Officiel) — multiplicateurs = demande estimée ──
// 'ALL' = commun aux 3 zones (Toussaint, Noël, Été).
// Fin = dernière NUIT des vacances (= jour de reprise − 1).
const SCHOOL_HOLIDAYS_SEED = [
  // ───────── 2025-2026 ─────────
  ['ALL', 'Toussaint 2025',  '2025-10-18', '2025-11-02', 1.06],
  ['ALL', 'Noël 2025',       '2025-12-20', '2026-01-04', 1.12],
  ['ALL', 'Été 2026',        '2026-07-04', '2026-08-31', 1.08],
  ['A',   'Hiver 2026 (A)',  '2026-02-07', '2026-02-22', 1.06],
  ['A',   'Print. 2026 (A)', '2026-04-04', '2026-04-19', 1.06],
  ['B',   'Hiver 2026 (B)',  '2026-02-14', '2026-03-01', 1.06],
  ['B',   'Print. 2026 (B)', '2026-04-11', '2026-04-26', 1.06],
  ['C',   'Hiver 2026 (C)',  '2026-02-21', '2026-03-08', 1.06],
  ['C',   'Print. 2026 (C)', '2026-04-18', '2026-05-03', 1.06],
  // ───────── 2026-2027 ─────────
  ['ALL', 'Toussaint 2026',  '2026-10-17', '2026-11-01', 1.06],
  ['ALL', 'Noël 2026',       '2026-12-19', '2027-01-03', 1.12],
  ['ALL', 'Été 2027',        '2027-07-03', '2027-08-31', 1.08],
  ['A',   'Hiver 2027 (A)',  '2027-02-13', '2027-02-28', 1.06],
  ['A',   'Print. 2027 (A)', '2027-04-10', '2027-04-25', 1.06],
  ['B',   'Hiver 2027 (B)',  '2027-02-20', '2027-03-07', 1.06],
  ['B',   'Print. 2027 (B)', '2027-04-17', '2027-05-02', 1.06],
  ['C',   'Hiver 2027 (C)',  '2027-02-06', '2027-02-21', 1.06],
  ['C',   'Print. 2027 (C)', '2027-04-03', '2027-04-18', 1.06],
];

const VALID_ZONES = ['A', 'B', 'C'];

// ── Création des tables + seed (une seule fois) ──────────────
let _ready = false;
async function ensureCalendarTables(pool) {
  if (_ready) return;
  await pool.query(`
    -- Événements PROPRES À CHAQUE CLIENT
    CREATE TABLE IF NOT EXISTS pricing_events (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      property_id TEXT,                         -- NULL = tous les logements du client
      label       TEXT NOT NULL,
      date_start  DATE NOT NULL,
      date_end    DATE NOT NULL,
      multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.15,
      active      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pricing_events_user ON pricing_events(user_id);

    -- Vacances scolaires : RÉFÉRENCE partagée, par zone
    CREATE TABLE IF NOT EXISTS school_holidays (
      id          SERIAL PRIMARY KEY,
      zone        TEXT NOT NULL,                -- 'A' | 'B' | 'C' | 'ALL'
      label       TEXT NOT NULL,
      date_start  DATE NOT NULL,
      date_end    DATE NOT NULL,
      multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.06,
      UNIQUE(zone, date_start, date_end)
    );
    CREATE INDEX IF NOT EXISTS idx_school_holidays_zone ON school_holidays(zone);

    -- Zone scolaire PAR LOGEMENT (défaut C = IDF)
    ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS school_zone TEXT DEFAULT 'C';
  `);

  // Seed des vacances officielles si la table est vide
  const c = await pool.query('SELECT COUNT(*)::int AS n FROM school_holidays');
  if (c.rows[0].n === 0) {
    const values = [];
    const params = [];
    SCHOOL_HOLIDAYS_SEED.forEach((row, i) => {
      const b = i * 5;
      values.push(`($${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`);
      params.push(row[0], row[1], row[2], row[3], row[4]);
    });
    await pool.query(
      `INSERT INTO school_holidays (zone, label, date_start, date_end, multiplier)
       VALUES ${values.join(',')}
       ON CONFLICT (zone, date_start, date_end) DO NOTHING`,
      params
    );
    console.log(`✅ [DP-CAL] school_holidays seedée (${SCHOOL_HOLIDAYS_SEED.length} périodes A/B/C)`);
  }
  _ready = true;
}

// ── Charge les calendriers d'UN logement (zone + événements client) ──
async function getCalendarsForProperty(pool, { userId, propertyId, zone }) {
  await ensureCalendarTables(pool);
  const z = VALID_ZONES.includes(zone) ? zone : 'C';

  const ev = await pool.query(
    `SELECT label,
            TO_CHAR(date_start,'YYYY-MM-DD') AS s,
            TO_CHAR(date_end,'YYYY-MM-DD')   AS e,
            multiplier
       FROM pricing_events
      WHERE user_id = $1 AND active = TRUE
        AND (property_id IS NULL OR property_id = $2)`,
    [userId, propertyId]
  );

  const sh = await pool.query(
    `SELECT label,
            TO_CHAR(date_start,'YYYY-MM-DD') AS s,
            TO_CHAR(date_end,'YYYY-MM-DD')   AS e,
            multiplier
       FROM school_holidays
      WHERE zone = $1 OR zone = 'ALL'
      ORDER BY date_start`,
    [z]
  );

  return {
    events: ev.rows.map(r => ({ start: r.s, end: r.e, mult: parseFloat(r.multiplier), label: r.label })),
    schoolHolidays: sh.rows.map(r => ({ start: r.s, end: r.e, mult: parseFloat(r.multiplier), label: r.label })),
  };
}

// Résout l'identité canonique du pricing (properties.user_id) pour un acteur
// donné (compte principal ou délégué/sous-compte). Renvoie null si l'acteur
// n'a pas accès à ce logement.
async function resolvePricingOwner(pool, req, propertyId) {
  let callerUserId;
  if (req.user && req.user.isSubAccount) {
    const { rows } = await pool.query(
      'SELECT parent_user_id FROM sub_accounts WHERE id = $1',
      [req.user.subAccountId]
    );
    if (!rows[0]) return null;
    callerUserId = rows[0].parent_user_id;
  } else {
    callerUserId = req.user && req.user.id;
  }
  const { rows } = await pool.query(
    `SELECT user_id AS pricing_owner_id
       FROM properties
      WHERE id = $1
        AND (
          user_id = $2
          OR EXISTS (
            SELECT 1 FROM account_delegations
            WHERE delegator_user_id = user_id
              AND delegate_user_id  = $2
              AND status = 'accepted'
          )
        )`,
    [propertyId, callerUserId]
  );
  return rows[0] ? rows[0].pricing_owner_id : null;
}

// ── BP-1 fix: recompute core extracted for testability (injectable deps) ────────
async function _runRecompute(pool, userId, propertyId, {
  _resolveMarketData: resolveMarketDataFn,
  _computeContextKey: computeContextKeyFn,
  _applyFn:          applyFn,
} = {}) {
  const resolveFn = resolveMarketDataFn || resolveMarketData;
  const ctxFn     = computeContextKeyFn  || computeMarketContextKey;
  const apply     = applyFn             || require('./pricing-apply').applyDynamicPricingForProperty;

  const cfg = (await pool.query(
    `SELECT pc.*, p.name AS property_name,
            p.latitude, p.longitude, p.country_code, p.currency
       FROM pricing_config pc
       JOIN properties p ON p.id = pc.property_id AND p.user_id = pc.user_id
      WHERE pc.user_id = $1 AND pc.property_id = $2`,
    [userId, propertyId]
  )).rows[0];
  if (!cfg) return null;

  const propertyContextKey = ctxFn({
    countryCode: cfg.country_code,
    latitude:    cfg.latitude,
    longitude:   cfg.longitude,
  });

  const resolution = await resolveFn(pool, {
    propertyId,
    propertyContextKey,
    propertyCurrency: cfg.currency,
  });

  const isMock = !resolution.trusted && resolution.status !== 'missing';

  const marketStats = resolution.row ? {
    median:       resolution.row.median_price,
    occupancy:    resolution.row.occupancy_rate,
    tensionLevel: resolution.row.tension_level,
  } : null;

  return apply(pool, {
    cfg, marketStats, isMock,
    marketOverride:        resolution.market,
    sendPushNotification:  null,
  });
}

// ── Routes CRUD (chaque client gère SES événements + SA zone) ─────
// À câbler dans server.js :
//   const { setupPricingCalendarRoutes } = require('./routes/pricing-calendars');
//   setupPricingCalendarRoutes(app, pool, authenticateAny);
function setupPricingCalendarRoutes(app, pool, authenticateAny) {
  ensureCalendarTables(pool).catch(e => console.error('[DP-CAL] init:', e.message));
  const json = express.json();

  // Liste des événements du client (globaux + spécifiques logement)
  app.get('/api/pricing/events', authenticateAny, async (req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT id, property_id, label,
                TO_CHAR(date_start,'YYYY-MM-DD') AS date_start,
                TO_CHAR(date_end,'YYYY-MM-DD')   AS date_end,
                multiplier, active
           FROM pricing_events
          WHERE user_id = $1
          ORDER BY date_start`,
        [req.user.id]
      )).rows;
      res.json({ events: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Ajout / mise à jour d'un événement
  app.post('/api/pricing/events', json, authenticateAny, async (req, res) => {
    try {
      const { id, label, date_start, date_end, multiplier, property_id, active } = req.body || {};
      if (!label || !date_start || !date_end) {
        return res.status(400).json({ error: 'label, date_start, date_end requis' });
      }
      const mult = Math.max(0.5, Math.min(2, parseFloat(multiplier) || 1.15));
      if (id) {
        await pool.query(
          `UPDATE pricing_events
              SET label=$1, date_start=$2, date_end=$3, multiplier=$4,
                  property_id=$5, active=COALESCE($6, active)
            WHERE id=$7 AND user_id=$8`,
          [label, date_start, date_end, mult, property_id || null, active, id, req.user.id]
        );
        return res.json({ ok: true, id });
      }
      const r = await pool.query(
        `INSERT INTO pricing_events (user_id, property_id, label, date_start, date_end, multiplier)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [req.user.id, property_id || null, label, date_start, date_end, mult]
      );
      res.json({ ok: true, id: r.rows[0].id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Suppression
  app.delete('/api/pricing/events/:id', authenticateAny, async (req, res) => {
    try {
      await pool.query('DELETE FROM pricing_events WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Vacances scolaires de référence (lecture seule) pour une zone
  app.get('/api/pricing/school-holidays', authenticateAny, async (req, res) => {
    try {
      const z = VALID_ZONES.includes(req.query.zone) ? req.query.zone : 'C';
      const rows = (await pool.query(
        `SELECT zone, label,
                TO_CHAR(date_start,'YYYY-MM-DD') AS date_start,
                TO_CHAR(date_end,'YYYY-MM-DD')   AS date_end, multiplier
           FROM school_holidays WHERE zone=$1 OR zone='ALL' ORDER BY date_start`,
        [z]
      )).rows;
      res.json({ zone: z, holidays: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Définir la zone scolaire d'un logement
  app.put('/api/pricing/zone', json, authenticateAny, async (req, res) => {
    try {
      const { propertyId, zone } = req.body || {};
      if (!propertyId || !VALID_ZONES.includes(zone)) {
        return res.status(400).json({ error: 'propertyId + zone (A|B|C) requis' });
      }
      const ownerId = await resolvePricingOwner(pool, req, propertyId);
      if (!ownerId) return res.status(403).json({ error: 'Accès refusé à ce logement' });
      const { rowCount } = await pool.query(
        `UPDATE pricing_config SET school_zone=$1, updated_at=NOW()
          WHERE user_id=$2 AND property_id=$3`,
        [zone, ownerId, propertyId]
      );
      if (!rowCount) return res.status(404).json({ error: 'Pricing non configuré sur ce logement.' });
      res.json({ ok: true, zone });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Aperçu combiné des calendriers appliqués à un logement
  app.get('/api/pricing/calendars/:propertyId', authenticateAny, async (req, res) => {
    try {
      const cfg = (await pool.query(
        'SELECT school_zone FROM pricing_config WHERE user_id=$1 AND property_id=$2',
        [req.user.id, req.params.propertyId]
      )).rows[0] || {};
      const cal = await getCalendarsForProperty(pool, {
        userId: req.user.id, propertyId: req.params.propertyId, zone: cfg.school_zone || 'C',
      });
      res.json({ zone: cfg.school_zone || 'C', ...cal });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Planning par nuit (lecture) — pour l'onglet Calendrier de l'UI
  app.get('/api/pricing/schedule/:propertyId', authenticateAny, async (req, res) => {
    try {
      const days = Math.min(120, Math.max(7, parseInt(req.query.days) || 60));
      const rows = (await pool.query(
        `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, price, min_stay, reason, breakdown, status
           FROM pricing_schedule
          WHERE user_id = $1 AND property_id = $2 AND date >= CURRENT_DATE
          ORDER BY date LIMIT $3`,
        [req.user.id, req.params.propertyId, days]
      )).rows;
      const cfg = (await pool.query(
        `SELECT mode, is_active FROM pricing_config WHERE user_id = $1 AND property_id = $2`,
        [req.user.id, req.params.propertyId]
      )).rows[0] || {};
      res.json({ nights: rows, mode: cfg.mode || 'manual', isActive: cfg.is_active !== false, configured: !!cfg.mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Bascule manual/auto d'un logement (depuis l'onglet Calendrier)
  app.put('/api/pricing/mode/:propertyId', json, authenticateAny, async (req, res) => {
    try {
      const { mode } = req.body || {};
      if (!['manual', 'auto'].includes(mode)) return res.status(400).json({ error: 'mode manual|auto requis' });
      const ownerId = await resolvePricingOwner(pool, req, req.params.propertyId);
      if (!ownerId) return res.status(403).json({ error: 'Accès refusé à ce logement' });
      const r = await pool.query(
        `UPDATE pricing_config SET mode = $1, updated_at = NOW() WHERE user_id = $2 AND property_id = $3`,
        [mode, ownerId, req.params.propertyId]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: 'Active d\'abord le pricing dynamique sur ce logement.' });
      res.json({ ok: true, mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Recalcul à la demande (sans scrape : réutilise le dernier market_data via le resolver)
  app.post('/api/pricing/recompute/:propertyId', authenticateAny, async (req, res) => {
    try {
      const result = await _runRecompute(pool, req.user.id, req.params.propertyId);
      if (!result) return res.status(404).json({ error: 'Active d\'abord le pricing dynamique sur ce logement.' });
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('✅ [DP-CAL] routes calendriers pricing montées');
}

module.exports = {
  ensureCalendarTables,
  getCalendarsForProperty,
  setupPricingCalendarRoutes,
  _runRecompute,
  SCHOOL_HOLIDAYS_SEED,
  VALID_ZONES,
};

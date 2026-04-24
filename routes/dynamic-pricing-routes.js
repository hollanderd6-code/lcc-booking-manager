// ============================================================
// DYNAMIC PRICING — Routes API
// /api/dynamic-pricing/*
// ============================================================
// Exposition :
//   setupDynamicPricingRoutes(app, pool, authenticateAny, sendEmail)
//
// Routes :
//   GET  /api/dynamic-pricing/dashboard          → données dashboard UI
//   GET  /api/dynamic-pricing/config             → configs de tous les logements
//   POST /api/dynamic-pricing/config             → save config d'un logement
//   POST /api/dynamic-pricing/decision/:id       → accepter / refuser une suggestion
//   GET  /api/dynamic-pricing/history            → historique des ajustements
//   GET  /api/dynamic-pricing/market/:propertyId → snapshot marché d'un logement
// ============================================================

'use strict';

const cors = require('cors');

// ── Helpers ──────────────────────────────────────────────────

/**
 * Calcule le niveau de tension à partir du taux d'occupation.
 * Retourne : 'very_low' | 'low' | 'medium' | 'elevated' | 'high'
 */
function calcTensionLevel(occupancyRate) {
  if (occupancyRate >= 80) return 'high';
  if (occupancyRate >= 65) return 'elevated';
  if (occupancyRate >= 45) return 'medium';
  if (occupancyRate >= 25) return 'low';
  return 'very_low';
}

/**
 * Libellé lisible du niveau de tension (pour l'UI et les emails).
 */
function tensionLabel(level) {
  const labels = {
    high:      'Forte (≥80%)',
    elevated:  'Élevée (65-79%)',
    medium:    'Moyenne (45-64%)',
    low:       'Faible (25-44%)',
    very_low:  'Très faible (<25%)',
  };
  return labels[level] || 'Inconnue';
}

/**
 * Facteur taux d'occupation marché (Signal 1).
 * Table de décision issue du doc stratégie.
 */
function factorMarket(occupancyRate) {
  if (occupancyRate >= 80) return 1.22;
  if (occupancyRate >= 65) return 1.15;
  if (occupancyRate >= 45) return 1.02;
  if (occupancyRate >= 25) return 0.92;
  return 0.82;
}

/**
 * Facteur taux d'occupation de l'hôte (Signal 2).
 * Basé sur les réservations existantes de la propriété.
 */
function factorSelf(selfOccupancyRate) {
  if (selfOccupancyRate >= 80) return 1.08;
  if (selfOccupancyRate >= 60) return 1.03;
  if (selfOccupancyRate >= 40) return 0.98;
  return 0.93;
}

/**
 * Facteur saisonnalité (Signal 4).
 * Simplifié — à affiner avec un calendrier des jours fériés + zones académiques.
 * Reçoit un objet Date.
 */
function factorSeasonality(date) {
  const d = date instanceof Date ? date : new Date(date);
  const dow = d.getDay(); // 0=dim, 5=ven, 6=sam
  const month = d.getMonth() + 1; // 1-12

  // Jours fériés FR fixes (simplifié)
  const md = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const frHolidays = ['01-01','05-01','05-08','07-14','08-15','11-01','11-11','12-25'];
  if (frHolidays.includes(md)) return 1.20;

  // Basse saison (nov–mars hors fériés)
  if (month >= 11 || month <= 3) return 0.90;

  // Weekend (ven + sam soir)
  if (dow === 5 || dow === 6) return 1.10;

  return 1.00;
}

/**
 * Calcule le prix recommandé en appliquant les 4 signaux,
 * contraint dans la fourchette [priceMin, priceMax] de l'hôte.
 */
function calcRecommendedPrice({ medianPrice, marketOccupancy, selfOccupancy, priceMin, priceMax, date }) {
  const fMarket  = factorMarket(marketOccupancy);
  const fSelf    = factorSelf(selfOccupancy);
  const fSeason  = factorSeasonality(date || new Date());
  const raw      = medianPrice * fMarket * fSelf * fSeason;
  const clamped  = Math.min(priceMax, Math.max(priceMin, raw));
  return {
    priceCalculated: Math.round(clamped),
    factorMarket:  fMarket,
    factorSelf:    fSelf,
    factorSeason:  fSeason,
    rawBeforeClamp: Math.round(raw),
  };
}

/**
 * Calcule le taux d'occupation de l'hôte sur les 30 prochains jours.
 * Lit la table reservations.
 */
async function getSelfOccupancy(pool, propertyId) {
  try {
    const today = new Date();
    const in30   = new Date(today); in30.setDate(in30.getDate() + 30);
    const res = await pool.query(
      `SELECT COALESCE(
         SUM(
           LEAST(end_date, $3::date) - GREATEST(start_date, $2::date)
         ), 0
       ) AS booked_nights
       FROM reservations
       WHERE property_id = $1
         AND status NOT IN ('cancelled','canceled')
         AND start_date < $3::date
         AND end_date   > $2::date`,
      [propertyId, today.toISOString().slice(0,10), in30.toISOString().slice(0,10)]
    );
    const bookedNights = parseInt(res.rows[0]?.booked_nights || 0);
    return Math.round((bookedNights / 30) * 100);
  } catch {
    return 50; // fallback neutre
  }
}

/**
 * Génère le HTML de l'email récapitulatif hebdomadaire.
 */
function buildWeeklyEmailHtml(firstName, rows, weekLabel) {
  const totalDelta = rows.reduce((sum, r) => {
    if (r.status === 'applied' && r.price_applied && r.price_before) {
      return sum + (parseFloat(r.price_applied) - parseFloat(r.price_before));
    }
    return sum;
  }, 0);

  const rowsHtml = rows.map(r => {
    const before = r.price_before ? `${Math.round(r.price_before)}€` : '—';
    const after  = r.price_applied ? `${Math.round(r.price_applied)}€` : '—';
    const delta  = r.price_applied && r.price_before
      ? (parseFloat(r.price_applied) - parseFloat(r.price_before))
      : null;
    const deltaStr = delta !== null
      ? (delta > 0 ? `<span style="color:#10b981;font-weight:700;">+${Math.round(delta)}€</span>`
         : delta < 0 ? `<span style="color:#DC2626;font-weight:700;">${Math.round(delta)}€</span>`
         : `<span style="color:#9CA3AF;">stable</span>`)
      : `<span style="color:#F59E0B;">en attente</span>`;

    const statusLabel = {
      applied:  '✅ Appliqué',
      declined: '❌ Refusé',
      pending:  '⏳ En attente',
      skipped:  '— Stable',
      error:    '⚠️ Erreur',
    }[r.status] || r.status;

    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede8;font-weight:600;color:#0D1117;">${r.property_name || r.property_id}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede8;text-align:right;">${before}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede8;text-align:right;font-weight:700;">${after}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede8;text-align:right;">${deltaStr}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0ede8;font-size:12px;color:#7A8695;">${statusLabel}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F2EC;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid rgba(200,184,154,.3);">
    <!-- Header -->
    <tr><td style="background:#1A7A5E;padding:28px 32px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;background:rgba(255,255,255,.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:white;">B</div>
        <span style="color:white;font-size:18px;font-weight:700;margin-left:8px;">Boostinghost</span>
      </div>
      <h1 style="color:white;font-size:22px;font-weight:400;margin:16px 0 4px;font-family:Georgia,serif;">
        📊 Pricing dynamique — <em>${weekLabel}</em>
      </h1>
      <p style="color:rgba(255,255,255,.75);font-size:14px;margin:0;">Résumé des ajustements de prix effectués cette semaine</p>
    </td></tr>

    <!-- Body -->
    <tr><td style="padding:28px 32px;">
      <p style="font-size:15px;color:#374151;margin:0 0 20px;">Bonjour ${firstName},</p>
      <p style="font-size:14px;color:#7A8695;margin:0 0 20px;line-height:1.6;">
        Voici le récapitulatif des ajustements de prix effectués automatiquement sur vos logements cette semaine.
      </p>

      <!-- Table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#F5F2EC;">
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:700;color:#7A8695;text-transform:uppercase;letter-spacing:.05em;">Logement</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#7A8695;text-transform:uppercase;letter-spacing:.05em;">Avant</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#7A8695;text-transform:uppercase;letter-spacing:.05em;">Après</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;font-weight:700;color:#7A8695;text-transform:uppercase;letter-spacing:.05em;">Δ</th>
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#7A8695;text-transform:uppercase;letter-spacing:.05em;">Statut</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      ${totalDelta > 0 ? `
      <div style="background:#F0FDF4;border:1px solid rgba(16,185,129,.2);border-radius:10px;padding:14px 16px;margin-bottom:24px;">
        <span style="font-size:14px;font-weight:700;color:#065F46;">
          💰 Revenu additionnel estimé cette semaine : <span style="color:#10b981;">+${Math.round(totalDelta)}€</span> vs tarif fixe
        </span>
      </div>` : ''}

      <div style="text-align:center;margin:24px 0;">
        <a href="https://boostinghost.fr/dynamic-pricing.html" style="background:#1A7A5E;color:white;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;font-size:14px;">
          Voir le détail dans Boostinghost →
        </a>
      </div>

      <p style="font-size:11px;color:#9CA3AF;line-height:1.5;margin-top:24px;border-top:1px solid #f0ede8;padding-top:16px;">
        Vous recevez cet email car le pricing dynamique est activé sur au moins un de vos logements.
        Gérez vos préférences dans <a href="https://boostinghost.fr/dynamic-pricing.html" style="color:#1A7A5E;">Paramètres → Pricing dynamique</a>.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Setup principal ──────────────────────────────────────────

function setupDynamicPricingRoutes(app, pool, authenticateAny, sendEmail) {

  const corsDP = cors();

  // ────────────────────────────────────────────────────────
  // GET /api/dynamic-pricing/dashboard
  // Retourne pour chaque logement actif : config, dernier
  // snapshot marché, historique de la semaine en cours.
  // ────────────────────────────────────────────────────────
  app.get('/api/dynamic-pricing/dashboard', corsDP, authenticateAny, async (req, res) => {
    try {
      const userId = req.user.id;

      // 1. Toutes les configs actives de l'user
      const configs = await pool.query(
        `SELECT pc.*, p.name AS property_name, p.address
         FROM pricing_config pc
         LEFT JOIN properties p ON p.id = pc.property_id
         WHERE pc.user_id = $1 AND pc.is_active = TRUE
         ORDER BY pc.created_at ASC`,
        [userId]
      );

      if (configs.rows.length === 0) {
        return res.json({ properties: [], pendingCount: 0, weeklyGain: 0 });
      }

      const propertyIds = configs.rows.map(c => c.property_id);

      // 2. Dernier snapshot marché pour chaque logement
      const markets = await pool.query(
        `SELECT DISTINCT ON (property_id)
           property_id, week_start, median_price, price_p25, price_p75,
           occupancy_rate, comparable_count, tension_level, scraped_at
         FROM market_data
         WHERE property_id = ANY($1::text[])
         ORDER BY property_id, week_start DESC`,
        [propertyIds]
      );
      const marketMap = {};
      markets.rows.forEach(m => { marketMap[m.property_id] = m; });

      // 3. Historique semaine courante (lundi le plus récent)
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0=dim
      const daysToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
      const monday = new Date(today);
      monday.setDate(today.getDate() - daysToMonday);
      const weekStart = monday.toISOString().slice(0, 10);

      const histories = await pool.query(
        `SELECT property_id, price_before, price_calculated, price_applied,
                status, mode_used, reason, factor_market, factor_self, factor_season,
                market_median, market_occupancy, tension_level, applied_at
         FROM pricing_history
         WHERE property_id = ANY($1::text[]) AND week_start = $2`,
        [propertyIds, weekStart]
      );
      const historyMap = {};
      histories.rows.forEach(h => { historyMap[h.property_id] = h; });

      // 4. Assembler la réponse
      let pendingCount = 0;
      let weeklyGain = 0;

      const properties = configs.rows.map(cfg => {
        const market  = marketMap[cfg.property_id] || null;
        const history = historyMap[cfg.property_id] || null;

        if (history?.status === 'pending') pendingCount++;
        if (history?.status === 'applied' && history.price_applied && history.price_before) {
          weeklyGain += parseFloat(history.price_applied) - parseFloat(history.price_before);
        }

        return {
          propertyId:    cfg.property_id,
          propertyName:  cfg.property_name || cfg.property_id,
          address:       cfg.address || '',
          mode:          cfg.mode,
          priceMin:      parseFloat(cfg.price_min),
          priceMax:      parseFloat(cfg.price_max),
          notifyPush:    cfg.notify_push,
          market: market ? {
            weekStart:       market.week_start,
            medianPrice:     parseFloat(market.median_price || 0),
            priceP25:        parseFloat(market.price_p25 || 0),
            priceP75:        parseFloat(market.price_p75 || 0),
            occupancyRate:   parseFloat(market.occupancy_rate || 0),
            comparableCount: market.comparable_count,
            tensionLevel:    market.tension_level,
            tensionLabel:    tensionLabel(market.tension_level),
            scrapedAt:       market.scraped_at,
          } : null,
          history: history ? {
            status:          history.status,
            priceBefore:     parseFloat(history.price_before || 0),
            priceCalculated: parseFloat(history.price_calculated || 0),
            priceApplied:    history.price_applied ? parseFloat(history.price_applied) : null,
            modeUsed:        history.mode_used,
            reason:          history.reason,
            factorMarket:    parseFloat(history.factor_market || 1),
            factorSelf:      parseFloat(history.factor_self || 1),
            factorSeason:    parseFloat(history.factor_season || 1),
            appliedAt:       history.applied_at,
          } : null,
        };
      });

      res.json({
        properties,
        pendingCount,
        weeklyGain: Math.round(weeklyGain),
        weekStart,
      });

    } catch (err) {
      console.error('❌ [DYNAMIC-PRICING] dashboard error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/dynamic-pricing/config
  // Retourne toutes les configs de l'user (actives + inactives)
  // ────────────────────────────────────────────────────────
  app.get('/api/dynamic-pricing/config', corsDP, authenticateAny, async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await pool.query(
        `SELECT pc.*, p.name AS property_name
         FROM pricing_config pc
         LEFT JOIN properties p ON p.id = pc.property_id
         WHERE pc.user_id = $1
         ORDER BY pc.created_at ASC`,
        [userId]
      );

      const configs = result.rows.map(c => ({
        id:            c.id,
        propertyId:    c.property_id,
        propertyName:  c.property_name || c.property_id,
        priceMin:      parseFloat(c.price_min),
        priceMax:      parseFloat(c.price_max),
        mode:          c.mode,
        isActive:      c.is_active,
        notifyPush:    c.notify_push,
        notifyEmail:   c.notify_email,
        notifyAlert:   c.notify_alert,
        zoneRadiusKm:  parseFloat(c.zone_radius_km || 1.5),
        propertyType:  c.property_type,
        bedrooms:      c.bedrooms,
        createdAt:     c.created_at,
        updatedAt:     c.updated_at,
      }));

      res.json({ configs });

    } catch (err) {
      console.error('❌ [DYNAMIC-PRICING] config GET error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────
  // POST /api/dynamic-pricing/config
  // Crée ou met à jour la config d'un logement (upsert).
  // Body: { propertyId, priceMin, priceMax, mode, isActive,
  //         notifyPush, notifyEmail, notifyAlert,
  //         propertyType, bedrooms }
  // ────────────────────────────────────────────────────────
  app.post('/api/dynamic-pricing/config', corsDP, express.json(), authenticateAny, async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        propertyId,
        priceMin,
        priceMax,
        mode         = 'manual',
        isActive     = true,
        notifyPush   = true,
        notifyEmail  = true,
        notifyAlert  = true,
        propertyType = null,
        bedrooms     = 1,
      } = req.body || {};

      // Validation
      if (!propertyId) {
        return res.status(400).json({ error: 'propertyId requis' });
      }
      if (priceMin == null || priceMax == null) {
        return res.status(400).json({ error: 'priceMin et priceMax requis' });
      }
      if (parseFloat(priceMin) >= parseFloat(priceMax)) {
        return res.status(400).json({ error: 'priceMin doit être inférieur à priceMax' });
      }
      if (!['manual','auto'].includes(mode)) {
        return res.status(400).json({ error: 'mode doit être manual ou auto' });
      }

      const result = await pool.query(
        `INSERT INTO pricing_config (
           user_id, property_id, price_min, price_max, mode, is_active,
           notify_push, notify_email, notify_alert, property_type, bedrooms,
           created_at, updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
         ON CONFLICT (user_id, property_id) DO UPDATE SET
           price_min    = EXCLUDED.price_min,
           price_max    = EXCLUDED.price_max,
           mode         = EXCLUDED.mode,
           is_active    = EXCLUDED.is_active,
           notify_push  = EXCLUDED.notify_push,
           notify_email = EXCLUDED.notify_email,
           notify_alert = EXCLUDED.notify_alert,
           property_type = EXCLUDED.property_type,
           bedrooms     = EXCLUDED.bedrooms,
           updated_at   = NOW()
         RETURNING *`,
        [userId, propertyId, priceMin, priceMax, mode, isActive,
         notifyPush, notifyEmail, notifyAlert, propertyType, bedrooms]
      );

      console.log(`✅ [DYNAMIC-PRICING] Config sauvegardée — ${userId} / ${propertyId} — mode:${mode} [${priceMin}€-${priceMax}€]`);
      res.json({ success: true, config: result.rows[0] });

    } catch (err) {
      console.error('❌ [DYNAMIC-PRICING] config POST error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────
  // POST /api/dynamic-pricing/decision/:historyId
  // Accepte ou refuse une suggestion en attente (mode manual).
  // Body: { action: 'apply' | 'decline' }
  // ────────────────────────────────────────────────────────
  app.post('/api/dynamic-pricing/decision/:historyId', corsDP, express.json(), authenticateAny, async (req, res) => {
    try {
      const userId    = req.user.id;
      const historyId = parseInt(req.params.historyId);
      const { action } = req.body || {};

      if (!['apply','decline'].includes(action)) {
        return res.status(400).json({ error: "action doit être 'apply' ou 'decline'" });
      }

      // Vérifier que la suggestion appartient à l'user et est bien 'pending'
      const check = await pool.query(
        `SELECT ph.*, pc.price_min, pc.price_max, pc.mode
         FROM pricing_history ph
         JOIN pricing_config pc ON pc.property_id = ph.property_id AND pc.user_id = ph.user_id
         WHERE ph.id = $1 AND ph.user_id = $2 AND ph.status = 'pending'`,
        [historyId, userId]
      );

      if (check.rows.length === 0) {
        return res.status(404).json({ error: 'Suggestion non trouvée ou déjà traitée' });
      }

      const row = check.rows[0];

      if (action === 'apply') {
        // Appliquer le prix calculé (clampé dans la fourchette)
        const priceApplied = Math.min(
          parseFloat(row.price_max),
          Math.max(parseFloat(row.price_min), parseFloat(row.price_calculated))
        );

        await pool.query(
          `UPDATE pricing_history
           SET status = 'applied', price_applied = $1,
               applied_by = $2, applied_at = NOW(), updated_at = NOW()
           WHERE id = $3`,
          [priceApplied, userId, historyId]
        );

        // TODO V3 : push vers Channex ici
        // await pushPriceToChannex(pool, row.property_id, row.week_start, priceApplied);

        console.log(`✅ [DYNAMIC-PRICING] Suggestion acceptée — historyId:${historyId} — ${priceApplied}€`);
        res.json({ success: true, action: 'applied', priceApplied });

      } else {
        // Refuser → garder le prix actuel
        await pool.query(
          `UPDATE pricing_history
           SET status = 'declined', price_applied = price_before,
               applied_by = $1, applied_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [userId, historyId]
        );

        console.log(`ℹ️ [DYNAMIC-PRICING] Suggestion refusée — historyId:${historyId}`);
        res.json({ success: true, action: 'declined' });
      }

    } catch (err) {
      console.error('❌ [DYNAMIC-PRICING] decision error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/dynamic-pricing/history
  // Historique paginé des ajustements (tous logements).
  // Query: ?limit=20&offset=0&propertyId=xxx
  // ────────────────────────────────────────────────────────
  app.get('/api/dynamic-pricing/history', corsDP, authenticateAny, async (req, res) => {
    try {
      const userId     = req.user.id;
      const limit      = Math.min(parseInt(req.query.limit  || 20), 100);
      const offset     = parseInt(req.query.offset || 0);
      const propertyId = req.query.propertyId || null;

      const conditions = ['ph.user_id = $1'];
      const params     = [userId];
      let pi = 2;

      if (propertyId) {
        conditions.push(`ph.property_id = $${pi++}`);
        params.push(propertyId);
      }

      const where = conditions.join(' AND ');

      const result = await pool.query(
        `SELECT ph.*,
                p.name AS property_name
         FROM pricing_history ph
         LEFT JOIN properties p ON p.id = ph.property_id
         WHERE ${where}
         ORDER BY ph.week_start DESC, ph.created_at DESC
         LIMIT $${pi++} OFFSET $${pi++}`,
        [...params, limit, offset]
      );

      // Total pour pagination
      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM pricing_history ph WHERE ${where}`,
        params
      );

      const history = result.rows.map(h => ({
        id:              h.id,
        propertyId:      h.property_id,
        propertyName:    h.property_name || h.property_id,
        weekStart:       h.week_start,
        priceBefore:     parseFloat(h.price_before || 0),
        priceCalculated: parseFloat(h.price_calculated || 0),
        priceApplied:    h.price_applied ? parseFloat(h.price_applied) : null,
        status:          h.status,
        modeUsed:        h.mode_used,
        reason:          h.reason,
        tensionLevel:    h.tension_level,
        tensionLabel:    tensionLabel(h.tension_level),
        marketOccupancy: parseFloat(h.market_occupancy || 0),
        factorMarket:    parseFloat(h.factor_market || 1),
        factorSelf:      parseFloat(h.factor_self || 1),
        factorSeason:    parseFloat(h.factor_season || 1),
        appliedAt:       h.applied_at,
        createdAt:       h.created_at,
      }));

      res.json({
        history,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
      });

    } catch (err) {
      console.error('❌ [DYNAMIC-PRICING] history error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────
  // GET /api/dynamic-pricing/market/:propertyId
  // Retourne les N derniers snapshots marché d'un logement.
  // Utile pour un graphique d'évolution.
  // Query: ?weeks=8
  // ────────────────────────────────────────────────────────
  app.get('/api/dynamic-pricing/market/:propertyId', corsDP, authenticateAny, async (req, res) => {
    try {
      const userId     = req.user.id;
      const propertyId = req.params.propertyId;
      const weeks      = Math.min(parseInt(req.query.weeks || 8), 52);

      // Vérifier que l'user a bien une config pour ce logement
      const cfgCheck = await pool.query(
        'SELECT id FROM pricing_config WHERE user_id = $1 AND property_id = $2',
        [userId, propertyId]
      );
      if (cfgCheck.rows.length === 0) {
        return res.status(403).json({ error: 'Accès refusé à ce logement' });
      }

      const result = await pool.query(
        `SELECT week_start, median_price, price_p25, price_p75,
                occupancy_rate, comparable_count, tension_level, scraped_at
         FROM market_data
         WHERE property_id = $1
         ORDER BY week_start DESC
         LIMIT $2`,
        [propertyId, weeks]
      );

      res.json({
        propertyId,
        snapshots: result.rows.map(s => ({
          weekStart:       s.week_start,
          medianPrice:     parseFloat(s.median_price || 0),
          priceP25:        parseFloat(s.price_p25 || 0),
          priceP75:        parseFloat(s.price_p75 || 0),
          occupancyRate:   parseFloat(s.occupancy_rate || 0),
          comparableCount: s.comparable_count,
          tensionLevel:    s.tension_level,
          tensionLabel:    tensionLabel(s.tension_level),
          scrapedAt:       s.scraped_at,
        })).reverse(), // chronologique
      });

    } catch (err) {
      console.error('❌ [DYNAMIC-PRICING] market error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ────────────────────────────────────────────────────────
  // POST /api/dynamic-pricing/send-weekly-report
  // Appelée par le cron (ou en test manuel) pour envoyer
  // l'email récap hebdomadaire à tous les users actifs.
  // Protégée par CRON_SECRET en plus de l'auth.
  // ────────────────────────────────────────────────────────
  app.post('/api/dynamic-pricing/send-weekly-report', corsDP, async (req, res) => {
    try {
      // Vérification du secret cron
      const secret = req.headers['x-cron-secret'] || req.body?.cronSecret;
      if (secret !== process.env.CRON_SECRET) {
        return res.status(403).json({ error: 'Secret invalide' });
      }

      const today = new Date();
      const dayOfWeek = today.getDay();
      const daysToMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
      const monday = new Date(today);
      monday.setDate(today.getDate() - daysToMonday);
      const weekStart = monday.toISOString().slice(0, 10);
      const weekLabel = monday.toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' });

      // Tous les users avec email activé et au moins une config active
      const usersResult = await pool.query(
        `SELECT DISTINCT u.id, u.first_name, u.email
         FROM users u
         JOIN pricing_config pc ON pc.user_id = u.id
         WHERE pc.is_active = TRUE AND pc.notify_email = TRUE`
      );

      let sentCount = 0;
      for (const user of usersResult.rows) {
        try {
          // Historique de la semaine pour cet user
          const histResult = await pool.query(
            `SELECT ph.*, p.name AS property_name
             FROM pricing_history ph
             LEFT JOIN properties p ON p.id = ph.property_id
             WHERE ph.user_id = $1 AND ph.week_start = $2
             ORDER BY ph.created_at ASC`,
            [user.id, weekStart]
          );

          if (histResult.rows.length === 0) continue; // Rien à envoyer

          const html = buildWeeklyEmailHtml(user.first_name, histResult.rows, weekLabel);

          await sendEmail({
            from: `"Boostinghost" <noreply@boostinghost.fr>`,
            to: user.email,
            subject: `📊 Votre marché cette semaine — ${histResult.rows.length} logement${histResult.rows.length > 1 ? 's' : ''}`,
            html,
          });

          sentCount++;
          console.log(`📧 [DYNAMIC-PRICING] Email récap envoyé à ${user.email}`);
        } catch (emailErr) {
          console.error(`❌ [DYNAMIC-PRICING] Email failed for ${user.email}:`, emailErr.message);
        }
      }

      res.json({ success: true, sentCount, weekStart });

    } catch (err) {
      console.error('❌ [DYNAMIC-PRICING] weekly-report error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  console.log('✅ [DYNAMIC-PRICING] Routes montées');
}

// Exporte aussi les helpers pour le futur cron Apify
module.exports = {
  setupDynamicPricingRoutes,
  calcRecommendedPrice,
  calcTensionLevel,
  tensionLabel,
  factorMarket,
  factorSelf,
  factorSeasonality,
  getSelfOccupancy,
};

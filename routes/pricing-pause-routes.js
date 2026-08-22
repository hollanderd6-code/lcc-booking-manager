/* ============================================================
   routes/pricing-pause-routes.js
   Tout mettre en pause, et pouvoir reprendre a l'identique
   ============================================================
   MONTAGE — une ligne dans server.js :

     require('./routes/pricing-pause-routes')(app, pool, { authenticateAny, getRealUserId });

   ── POURQUOI ─────────────────────────────────────────────────────
   BoostPrice est en beta et touche aux prix. La premiere question de
   quelqu'un qui doute est « comment j'arrete tout ? ». Sans reponse
   visible, il desactive ses logements un par un — ou n'active jamais.

   ── COMMENT ──────────────────────────────────────────────────────
   Le levier existe deja : is_active dans pricing_config. Le cron
   hebdomadaire, le recalcul declenche par une reservation, le dashboard
   et l'email recapitulatif filtrent tous sur is_active = TRUE. Le
   passer a faux suffit donc a tout arreter, sans modifier un seul
   consommateur.

   ── REPRENDRE A L'IDENTIQUE ──────────────────────────────────────
   Une pause qui reactive tout au retour serait un piege : un logement
   volontairement desactive se retrouverait relance. On memorise donc
   l'etat de chaque ligne avant la pause (actif_avant_pause) et la
   reprise le restitue exactement.

   Les prix deja publies chez les plateformes ne sont pas repris : la
   pause arrete les futurs ajustements, elle ne revient pas en arriere.
   L'interface doit le dire.
   ============================================================ */

'use strict';

const express = require('express');

const MIGRATION = `
  ALTER TABLE pricing_config
    ADD COLUMN IF NOT EXISTS actif_avant_pause BOOLEAN,
    ADD COLUMN IF NOT EXISTS paused_at         TIMESTAMP;
`;

module.exports = function monterPause(app, pool, deps) {
  const auth = typeof deps === 'function'
    ? deps
    : (deps && (deps.authenticateAny || deps.auth)) || ((req, res, next) => next());
  const getRealUserId = deps && typeof deps.getRealUserId === 'function' ? deps.getRealUserId : null;

  pool.query(MIGRATION)
    .then(() => console.log('✅ [DP-PAUSE] Colonnes de pause prêtes'))
    .catch((e) => console.error('❌ [DP-PAUSE] Migration impossible :', e.message));

  async function uid(req) {
    if (getRealUserId) {
      try { const u = await getRealUserId(pool, req); if (u) return u; } catch (e) {}
    }
    return req.user && (req.user.id || req.user.userId);
  }

  /* ── Etat ───────────────────────────────────────────────────────
     En pause si au moins une ligne porte une date de pause. On renvoie
     aussi le nombre de logements concernes : « en pause » sans dire
     combien ne rassure personne. */
  app.get('/api/dynamic-pricing/pause', auth, async (req, res) => {
    try {
      const userId = await uid(req);
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int                                     AS total,
                COUNT(*) FILTER (WHERE paused_at IS NOT NULL)::int AS en_pause,
                COUNT(*) FILTER (WHERE is_active IS TRUE)::int     AS actifs,
                MAX(paused_at)                                    AS depuis
           FROM pricing_config WHERE user_id = $1`,
        [userId]
      );
      const r = rows[0] || {};
      res.json({
        total: r.total || 0,
        actifs: r.actifs || 0,
        en_pause: (r.en_pause || 0) > 0,
        logements_en_pause: r.en_pause || 0,
        depuis: r.depuis || null
      });
    } catch (e) {
      console.error('❌ [DP-PAUSE] GET:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /* ── Mise en pause et reprise ───────────────────────────────────── */
  app.post('/api/dynamic-pricing/pause', express.json(), auth, async (req, res) => {
    try {
      if (typeof req.body.paused !== 'boolean') {
        return res.status(400).json({ error: 'paused doit être true ou false' });
      }
      const userId = await uid(req);

      if (req.body.paused) {
        /* On n'ecrase pas une memoire deja posee : une seconde mise en
           pause ne doit pas enregistrer « inactif » comme etat d'origine. */
        const { rowCount } = await pool.query(
          `UPDATE pricing_config
              SET actif_avant_pause = COALESCE(actif_avant_pause, is_active),
                  is_active         = FALSE,
                  paused_at         = COALESCE(paused_at, NOW()),
                  updated_at        = NOW()
            WHERE user_id = $1 AND paused_at IS NULL`,
          [userId]
        );
        console.log(`⏸️ [DP-PAUSE] ${userId} — ${rowCount} logement(s) mis en pause`);
        return res.json({ en_pause: true, logements: rowCount });
      }

      const { rowCount } = await pool.query(
        `UPDATE pricing_config
            SET is_active         = COALESCE(actif_avant_pause, TRUE),
                actif_avant_pause = NULL,
                paused_at         = NULL,
                updated_at        = NOW()
          WHERE user_id = $1 AND paused_at IS NOT NULL`,
        [userId]
      );
      console.log(`▶️ [DP-PAUSE] ${userId} — ${rowCount} logement(s) repris`);
      res.json({ en_pause: false, logements: rowCount });
    } catch (e) {
      console.error('❌ [DP-PAUSE] POST:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  console.log('✅ [DP-PAUSE] Routes de mise en pause montées');
};

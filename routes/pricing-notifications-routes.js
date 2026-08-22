/* ============================================================
   routes/pricing-notifications-routes.js
   Les trois interrupteurs de notification, pour de vrai
   ============================================================
   MONTAGE — une ligne dans server.js :

     require('./routes/pricing-notifications-routes')(app, pool, { authenticateAny, getRealUserId });

   ── LE PROBLEME QU'ON CORRIGE ────────────────────────────────────
   L'onglet Paramètres de BoostPrice affiche trois interrupteurs :
   notification push, email hebdomadaire, alerte écart marché. Ils
   étaient cochés par défaut et affichaient « Préférences enregistrées »
   sans rien envoyer — le code portait un TODO. L'utilisateur croyait
   avoir réglé ses notifications.

   ── POURQUOI UNE ROUTE DEDIEE ────────────────────────────────────
   Les trois drapeaux vivent dans pricing_config, une ligne PAR
   LOGEMENT. Mais ce sont des préférences personnelles : personne ne
   veut choisir s'il reçoit un email pour le studio et pas pour le
   deux-pièces. On les applique donc à tous les logements de l'utilisateur.

   On ne passe pas par POST /config, qui fait un upsert exigeant
   priceMin et priceMax : un appel partiel écraserait les fourchettes de
   prix. Ici, un UPDATE ne touche que les trois colonnes.

   ── QUAND IL N'Y A AUCUN LOGEMENT CONFIGURE ──────────────────────
   Il n'existe alors aucune ligne où écrire. La route le dit
   (logements: 0), et l'interface désactive les interrupteurs au lieu
   de faire semblant.
   ============================================================ */

'use strict';

const express = require('express');

const COLONNES = {
  notifyPush:  'notify_push',
  notifyEmail: 'notify_email',
  notifyAlert: 'notify_alert'
};

module.exports = function monterNotifications(app, pool, deps) {
  const auth = typeof deps === 'function'
    ? deps
    : (deps && (deps.authenticateAny || deps.auth)) || ((req, res, next) => next());
  const getRealUserId = deps && typeof deps.getRealUserId === 'function' ? deps.getRealUserId : null;

  async function uid(req) {
    if (getRealUserId) {
      try { const u = await getRealUserId(pool, req); if (u) return u; } catch (e) {}
    }
    return req.user && (req.user.id || req.user.userId);
  }

  /* ── Lecture ────────────────────────────────────────────────────
     Un utilisateur peut avoir des valeurs differentes selon les
     logements — heritage de l'ancien modele. On renvoie la valeur
     dominante et on signale le desaccord, plutot que de choisir en
     silence une ligne au hasard. */
  app.get('/api/dynamic-pricing/notifications', auth, async (req, res) => {
    try {
      const userId = await uid(req);
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int                                   AS total,
                COUNT(*) FILTER (WHERE notify_push  IS TRUE)::int AS push_on,
                COUNT(*) FILTER (WHERE notify_email IS TRUE)::int AS email_on,
                COUNT(*) FILTER (WHERE notify_alert IS TRUE)::int AS alert_on
           FROM pricing_config WHERE user_id = $1`,
        [userId]
      );

      const r = rows[0] || { total: 0, push_on: 0, email_on: 0, alert_on: 0 };
      const dominant = (n) => r.total > 0 && n * 2 >= r.total;
      const mixte = (n) => n > 0 && n < r.total;

      res.json({
        logements: r.total,
        notifyPush:  dominant(r.push_on),
        notifyEmail: dominant(r.email_on),
        notifyAlert: dominant(r.alert_on),
        heterogene: {
          notifyPush:  mixte(r.push_on),
          notifyEmail: mixte(r.email_on),
          notifyAlert: mixte(r.alert_on)
        }
      });
    } catch (e) {
      console.error('❌ [DP-NOTIF] GET:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /* ── Ecriture ───────────────────────────────────────────────────
     Un seul drapeau a la fois, sur tous les logements. Un PATCH par
     interrupteur : deux onglets ouverts ne s'ecrasent pas. */
  app.patch('/api/dynamic-pricing/notifications', express.json(), auth, async (req, res) => {
    try {
      const cle = String(req.body.key || '');
      const colonne = COLONNES[cle];
      if (!colonne) {
        return res.status(400).json({ error: 'Préférence inconnue : ' + cle });
      }
      if (typeof req.body.value !== 'boolean') {
        return res.status(400).json({ error: 'value doit être true ou false' });
      }

      const userId = await uid(req);
      const { rowCount } = await pool.query(
        `UPDATE pricing_config SET ${colonne} = $2, updated_at = NOW() WHERE user_id = $1`,
        [userId, req.body.value]
      );

      if (!rowCount) {
        // Rien ou ecrire : le dire, plutot que de repondre « enregistre ».
        return res.status(409).json({
          error: 'Aucun logement n\'a le pricing dynamique activé — la préférence n\'a nulle part où être enregistrée.',
          logements: 0
        });
      }

      console.log(`🔔 [DP-NOTIF] ${userId} · ${cle} → ${req.body.value} (${rowCount} logement${rowCount > 1 ? 's' : ''})`);
      res.json({ enregistre: true, logements: rowCount, key: cle, value: req.body.value });
    } catch (e) {
      console.error('❌ [DP-NOTIF] PATCH:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  console.log('✅ [DP-NOTIF] Routes des préférences de notification montées');
};

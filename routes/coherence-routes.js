/* ============================================================
   routes/coherence-routes.js
   La vérification de cohérence, exposée et branchée
   ============================================================
   MONTAGE — une ligne dans server.js :

     require('./routes/coherence-routes')(app, pool, { authenticateAny, getRealUserId });

   Routes :

     GET  /api/properties/:id/coherence
          Diagnostic, sans rien modifier.

     POST /api/properties/:id/coherence/repair
          Répare ce qui peut l'être, et renvoie ce qui reste à faire à la
          main (un mapping absent ne s'invente pas).

     POST /api/channex/coherence/repair-all
          Passe tous les logements du compte. Utile après une migration ou
          une série de rattachements.
   ============================================================ */

'use strict';

const { verifierCoherence } = require('../channex-coherence');

module.exports = function monterRoutesCoherence(app, pool, deps) {
  const auth = typeof deps === 'function'
    ? deps
    : (deps && (deps.authenticateAny || deps.auth)) || ((req, res, next) => next());
  const getRealUserId = deps && typeof deps.getRealUserId === 'function' ? deps.getRealUserId : null;

  async function resoudreUid(req) {
    if (getRealUserId) {
      try { const uid = await getRealUserId(pool, req); if (uid) return uid; } catch (e) {}
    }
    return req.user && (req.user.id || req.user.userId);
  }

  async function appartient(req, res) {
    const uid = await resoudreUid(req);
    const { rows } = await pool.query(
      'SELECT id FROM properties WHERE id = $1 AND user_id = $2',
      [req.params.id, uid]
    );
    if (!rows.length) { res.status(404).json({ error: 'Logement introuvable' }); return null; }
    return uid;
  }

  app.get('/api/properties/:id/coherence', auth, async (req, res) => {
    try {
      const uid = await appartient(req, res);
      if (!uid) return;
      res.json(await verifierCoherence(pool, { property_id: req.params.id, user_id: uid }));
    } catch (e) {
      console.error('❌ [COHERENCE] GET:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/properties/:id/coherence/repair', auth, async (req, res) => {
    try {
      const uid = await appartient(req, res);
      if (!uid) return;
      res.json(await verifierCoherence(pool, { property_id: req.params.id, user_id: uid, reparer: true }));
    } catch (e) {
      console.error('❌ [COHERENCE] REPAIR:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/channex/coherence/repair-all', auth, async (req, res) => {
    try {
      const uid = await resoudreUid(req);
      const { rows } = await pool.query(
        `SELECT id FROM properties
          WHERE user_id = $1 AND channex_property_id IS NOT NULL
          ORDER BY name ASC`,
        [uid]
      );

      const resultats = [];
      for (const r of rows) {
        try {
          resultats.push(await verifierCoherence(pool, { property_id: r.id, user_id: uid, reparer: true }));
        } catch (e) {
          resultats.push({ verifie: false, property_id: r.id, raison: e.message });
        }
      }

      const reparations = resultats.reduce((n, x) => n + ((x.reparations || []).length), 0);
      const aFaire = resultats.flatMap((x) => x.action_utilisateur || []);

      res.json({ logements: rows.length, reparations, action_utilisateur: aFaire, resultats });
    } catch (e) {
      console.error('❌ [COHERENCE] REPAIR-ALL:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  console.log('✅ [COHERENCE] Routes de vérification des mappings montées');
};

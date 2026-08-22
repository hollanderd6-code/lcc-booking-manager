/* ============================================================
   routes/mapping-routes.js
   Remappage automatique des canaux sur les plans majorés
   ============================================================
   MONTAGE — une ligne dans server.js :

     require('./routes/mapping-routes')(app, pool, { authenticateAny, getRealUserId });

   Trois routes :

     GET   /api/properties/:id/channel-mapping
           Diagnostic : ce que Channex renvoie réellement pour ce logement,
           sans rien modifier. À regarder en premier si un remappage échoue.

     POST  /api/properties/:id/channel-mapping/apply
           Remappe chaque canal majoré sur son plan dédié. Idempotent :
           relancé, il ne refait que ce qui manque.

     POST  /api/properties/:id/channel-mapping/revert   { code }
           Restaure le mapping d'une plateforme dans l'état sauvegardé
           avant le premier remappage.
   ============================================================ */

'use strict';

const { inspecterCanaux, remapperPlansMajores, restaurerMapping } = require('../channex-mapping');

module.exports = function monterRoutesMapping(app, pool, deps) {
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

  // Le logement doit appartenir à l'appelant — contrôle unique, réutilisé.
  async function appartient(req, res) {
    const uid = await resoudreUid(req);
    const { rows } = await pool.query(
      'SELECT id FROM properties WHERE id = $1 AND user_id = $2',
      [req.params.id, uid]
    );
    if (!rows.length) { res.status(404).json({ error: 'Logement introuvable' }); return null; }
    return uid;
  }

  app.get('/api/properties/:id/channel-mapping', auth, async (req, res) => {
    try {
      if (!(await appartient(req, res))) return;
      res.json(await inspecterCanaux(pool, { property_id: req.params.id }));
    } catch (e) {
      console.error('❌ [MAPPING] GET:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/properties/:id/channel-mapping/apply', auth, async (req, res) => {
    try {
      const uid = await appartient(req, res);
      if (!uid) return;
      const r = await remapperPlansMajores(pool, { property_id: req.params.id, user_id: uid });
      res.json(r);
    } catch (e) {
      console.error('❌ [MAPPING] APPLY:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/properties/:id/channel-mapping/revert', auth, async (req, res) => {
    try {
      if (!(await appartient(req, res))) return;
      const code = String(req.body.code || '').toUpperCase();
      if (!code) return res.status(400).json({ error: 'Plateforme manquante' });
      res.json(await restaurerMapping(pool, { property_id: req.params.id, code }));
    } catch (e) {
      console.error('❌ [MAPPING] REVERT:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  console.log('✅ [MAPPING] Routes de remappage des plans majorés montées');
};

/* ============================================================
   routes/markup-routes.js — v2
   Majoration de prix par plateforme : migration + routes
   ============================================================
   MONTAGE — UNE seule ligne à ajouter dans server.js, après la création
   de `pool` et l'import de sub-accounts-middleware :

     require('./routes/markup-routes')(app, pool, { authenticateAny, getRealUserId });

   Plus besoin de lancer psql : la migration s'applique au démarrage
   (ADD COLUMN IF NOT EXISTS, donc sans effet si elle est déjà passée).

   Le middleware réel de ce projet est `authenticateAny`, et l'identité
   se résout par `getRealUserId(pool, req)` — un sous-compte doit voir
   les logements du compte parent. C'est ce que fait resoudreUid().

   ── CE QUI EST VÉRIFIÉ ───────────────────────────────────────────
   - le logement appartient bien au compte de l'appelant (dans le WHERE,
     jamais dans un if : impossible de l'oublier) ;
   - le code plateforme fait partie des quatre connus ;
   - la valeur est un nombre entre 0 et 100.
   Une majoration à 0 est SUPPRIMÉE de l'objet plutôt que stockée : la
   présence d'une clé signifie « il y a une majoration ». C'est ce que
   assurerPlansMajores() attend pour ne pas créer de plan inutile.
   ============================================================ */

'use strict';

const CODES = { ABB: 'Airbnb', BDC: 'Booking.com', EXP: 'Expedia', VRB: 'Abritel / VRBO' };

const MIGRATION = `
  ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS platform_markups          JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS channex_markup_rate_plans JSONB DEFAULT '{}'::jsonb;
`;

module.exports = function monterRoutesMajoration(app, pool, deps) {
  // deps accepte soit le middleware directement, soit { authenticateAny, getRealUserId }
  const auth = typeof deps === 'function'
    ? deps
    : (deps && (deps.authenticateAny || deps.auth)) || ((req, res, next) => next());
  const getRealUserId = deps && typeof deps.getRealUserId === 'function' ? deps.getRealUserId : null;

  async function resoudreUid(req) {
    if (getRealUserId) {
      try {
        const uid = await getRealUserId(pool, req);
        if (uid) return uid;
      } catch (e) {}
    }
    return req.user && (req.user.id || req.user.userId);
  }

  // Migration au démarrage : sans effet si les colonnes existent déjà.
  pool.query(MIGRATION)
    .then(() => console.log('✅ [MARKUPS] Colonnes platform_markups / channex_markup_rate_plans prêtes'))
    .catch((e) => console.error('❌ [MARKUPS] Migration impossible :', e.message));

  /* ── Lecture ──────────────────────────────────────────────────
     Le client s'en sert aussi comme test de disponibilité : si cette
     route répond, il affiche les champs ; sinon il ne les affiche pas,
     plutôt que de proposer une saisie qui ne serait jamais enregistrée. */
  app.get('/api/properties/:id/markups', auth, async (req, res) => {
    try {
      const uid = await resoudreUid(req);
      const { rows } = await pool.query(
        `SELECT COALESCE(platform_markups, '{}'::jsonb) AS markups
           FROM properties
          WHERE id = $1 AND user_id = $2`,
        [req.params.id, uid]
      );
      if (!rows.length) return res.status(404).json({ error: 'Logement introuvable' });
      res.json({ markups: rows[0].markups || {}, codes: CODES });
    } catch (e) {
      console.error('❌ [MARKUPS] GET:', e.message);
      res.status(500).json({ error: 'Lecture impossible' });
    }
  });

  /* ── Écriture d'une seule plateforme ───────────────────────────
     Un PATCH par plateforme, et non un PUT de l'objet entier : deux
     onglets ouverts ne s'écrasent pas mutuellement. jsonb_set applique
     la modification côté base, sans lecture-modification-écriture. */
  app.patch('/api/properties/:id/markups', auth, async (req, res) => {
    try {
      const code = String(req.body.code || '').toUpperCase();
      if (!CODES[code]) {
        return res.status(400).json({ error: 'Plateforme inconnue : ' + code });
      }

      const brut = req.body.pct;
      const pct = (brut === '' || brut === null || brut === undefined) ? 0 : parseFloat(brut);
      if (!isFinite(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: 'La majoration doit être un nombre entre 0 et 100.' });
      }

      const uid = await resoudreUid(req);

      const { rows } = await (pct > 0
        ? pool.query(
            `UPDATE properties
                SET platform_markups = jsonb_set(
                      COALESCE(platform_markups, '{}'::jsonb),
                      ARRAY[$3], to_jsonb($4::numeric), true)
              WHERE id = $1 AND user_id = $2
              RETURNING platform_markups AS markups`,
            [req.params.id, uid, code, pct]
          )
        : pool.query(
            // 0 : on retire la clé. Sa présence signifie « il y a une
            // majoration » — un 0 stocké ferait créer un plan pour rien.
            `UPDATE properties
                SET platform_markups = COALESCE(platform_markups, '{}'::jsonb) - $3
              WHERE id = $1 AND user_id = $2
              RETURNING platform_markups AS markups`,
            [req.params.id, uid, code]
          ));

      if (!rows.length) return res.status(404).json({ error: 'Logement introuvable' });

      console.log(`💰 [MARKUPS] ${req.params.id} · ${CODES[code]} → ${pct > 0 ? '+' + pct + '%' : 'aucune'}`);

      /* Le nouveau prix ne partira chez le partenaire qu'à la prochaine
         synchronisation des tarifs — on le dit au client pour qu'il ne
         croie pas à un échec en ne voyant rien changer tout de suite. */
      res.json({
        markups: rows[0].markups || {},
        applique_au_prochain_push: true
      });
    } catch (e) {
      console.error('❌ [MARKUPS] PATCH:', e.message);
      res.status(500).json({ error: 'Enregistrement impossible' });
    }
  });

  console.log('✅ [MARKUPS] Routes de majoration par plateforme montées');
};

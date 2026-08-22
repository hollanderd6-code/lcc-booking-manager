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

/* Le plan majoré et la vérification de cohérence sont facultatifs : si ces
   modules ne sont pas encore installés, la majoration s'enregistre quand même
   et s'appliquera au prochain envoi de tarifs. */
let assurerPlansMajores = null;
let verifierCoherence = null;
try { assurerPlansMajores = require('../channex').assurerPlansMajores; } catch (e) {}
try { verifierCoherence = require('../channex-coherence').verifierCoherence; } catch (e) {}

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

  /* Un sous-compte d'agence gère des logements qui ne lui appartiennent pas :
     ils sont au compte parent, et lui sont confiés par sub_account_properties.
     Un contrôle sur le seul user_id lui refusait donc l'accès, et les champs
     de majoration disparaissaient de son écran. On accepte les deux voies,
     sans en ouvrir une troisième : soit le logement est à lui, soit il lui a
     été explicitement confié. */
  async function autorise(req, property_id) {
    const uid = await resoudreUid(req);

    const { rows } = await pool.query(
      'SELECT id FROM properties WHERE id = $1 AND user_id = $2',
      [property_id, uid]
    );
    if (rows.length) return uid;

    if (req.user && req.user.isSubAccount) {
      const { rows: confie } = await pool.query(
        `SELECT 1 FROM sub_account_properties
          WHERE sub_account_id = $1 AND property_id = $2`,
        [req.user.subAccountId, property_id]
      );
      if (confie.length) return uid;

      // Un sous-compte sans restriction voit tout le parc du parent.
      const { rows: aucune } = await pool.query(
        'SELECT 1 FROM sub_account_properties WHERE sub_account_id = $1 LIMIT 1',
        [req.user.subAccountId]
      );
      if (!aucune.length) {
        const { rows: duParent } = await pool.query(
          'SELECT id FROM properties WHERE id = $1 AND user_id = $2',
          [property_id, uid]
        );
        if (duParent.length) return uid;
      }
    }

    return null;
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
      const uid = await autorise(req, req.params.id);
      if (!uid) return res.status(404).json({ error: 'Logement introuvable' });
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

      const uid = await autorise(req, req.params.id);
      if (!uid) return res.status(404).json({ error: 'Logement introuvable' });

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

      /* ── La chaîne complète, tout de suite ───────────────────────────
         Sans ça, l'utilisateur devrait modifier un prix pour créer le plan,
         puis aller remapper le canal à la main. Deux étapes indevinables.
         On crée le plan et on vérifie la cohérence ici, à l'enregistrement.

         Un échec ne remet jamais en cause la majoration, qui est déjà en
         base : elle s'appliquera au prochain envoi de tarifs, remappage ou
         non. On renvoie l'état réel pour que l'interface le dise. */
      let plan_cree = false;
      let coherence = null;
      if (assurerPlansMajores) {
        try {
          if (pct > 0) {
            const actifs = await assurerPlansMajores(pool, req.params.id);
            plan_cree = actifs.some((a) => a.code === code);
          }
          // Appelée dans les deux sens : une majoration retirée doit ramener
          // le canal sur le tarif standard, sinon il resterait majoré.
          if (verifierCoherence) {
            coherence = await verifierCoherence(pool, {
              property_id: req.params.id, user_id: uid, reparer: true
            });
          }
        } catch (e) {
          console.warn('⚠️ [MARKUPS] Plan ou cohérence indisponible (non bloquant) :',
            e.response?.data || e.message);
        }
      }

      const remappe = !!(coherence && (
        (coherence.reparations || []).some((r) => r.code === code) ||
        (coherence.conformes || []).some((c) => c.code === code)
      ));

      res.json({
        markups: rows[0].markups || {},
        applique_au_prochain_push: true,
        plan_cree,
        remappe,
        // Ce que l'utilisateur doit faire lui-même : un mapping absent ne
        // s'invente pas.
        action_utilisateur: (coherence && coherence.action_utilisateur) || [],
        coherence
      });
    } catch (e) {
      console.error('❌ [MARKUPS] PATCH:', e.message);
      res.status(500).json({ error: 'Enregistrement impossible' });
    }
  });

  console.log('✅ [MARKUPS] Routes de majoration par plateforme montées');
};

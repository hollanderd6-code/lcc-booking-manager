/* ============================================================
   routes/markup-routes.js
   Majoration de prix par plateforme — lecture et ecriture
   ============================================================
   MONTAGE — une ligne a ajouter dans server.js, apres la creation de
   `pool` et la definition du middleware d'authentification :

     require('./routes/markup-routes')(app, pool, authenticateToken);

   Remplacez `authenticateToken` par le nom reel de votre middleware
   d'auth (celui utilise par les autres routes /api/properties). Il doit
   poser `req.user.id`.

   Si votre middleware s'appelle autrement, seule cette ligne change :
   ce fichier ne suppose rien d'autre.

   ── POURQUOI UNE ROUTE DEDIEE ────────────────────────────────────
   Plutot que d'ajouter deux champs au formulaire de logement, qui
   compte deja une quarantaine d'entrees et passe par un FormData dont
   le serveur filtre les cles. Une route separee ne depend d'aucun
   comportement existant, et la majoration se regle la ou l'on voit les
   plateformes — pas au fond d'un formulaire.

   ── CE QUI EST VERIFIE ───────────────────────────────────────────
   - le logement appartient bien a l'utilisateur qui appelle ;
   - le code plateforme fait partie des quatre connus ;
   - la valeur est un nombre entre 0 et 100.
   Une majoration a 0 est SUPPRIMEE de l'objet plutot que stockee : la
   presence d'une cle signifie « il y a une majoration ». C'est ce que
   assurerPlansMajores() attend pour ne pas creer de plan inutile.
   ============================================================ */

'use strict';

const CODES = { ABB: 'Airbnb', BDC: 'Booking.com', EXP: 'Expedia', VRB: 'Abritel / VRBO' };

module.exports = function monterRoutesMajoration(app, pool, auth) {

  /* ── Lecture ──────────────────────────────────────────────────
     Le client s'en sert aussi comme test de disponibilite : si cette
     route repond, il affiche les champs ; sinon il ne les affiche pas,
     plutot que de proposer une saisie qui ne serait jamais enregistree. */
  app.get('/api/properties/:id/markups', auth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT COALESCE(platform_markups, '{}'::jsonb) AS markups
           FROM properties
          WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Logement introuvable' });
      res.json({ markups: rows[0].markups || {}, codes: CODES });
    } catch (e) {
      console.error('❌ [MARKUPS] GET:', e.message);
      res.status(500).json({ error: 'Lecture impossible' });
    }
  });

  /* ── Ecriture d'une seule plateforme ───────────────────────────
     Un PATCH par plateforme, et non un PUT de l'objet entier : deux
     onglets ouverts ne s'ecrasent pas mutuellement. jsonb_set applique
     la modification cote base, sans lecture-modification-ecriture. */
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

      // Le logement doit appartenir a l'appelant : le controle est dans le
      // WHERE, pas dans un if — impossible de l'oublier.
      const q = pct > 0
        ? pool.query(
            `UPDATE properties
                SET platform_markups = jsonb_set(
                      COALESCE(platform_markups, '{}'::jsonb),
                      ARRAY[$3], to_jsonb($4::numeric), true)
              WHERE id = $1 AND user_id = $2
              RETURNING platform_markups AS markups`,
            [req.params.id, req.user.id, code, pct]
          )
        : pool.query(
            // 0 : on retire la cle. Sa presence signifie « il y a une
            // majoration » — un 0 stocke ferait creer un plan pour rien.
            `UPDATE properties
                SET platform_markups = COALESCE(platform_markups, '{}'::jsonb) - $3
              WHERE id = $1 AND user_id = $2
              RETURNING platform_markups AS markups`,
            [req.params.id, req.user.id, code]
          );

      const { rows } = await q;
      if (!rows.length) return res.status(404).json({ error: 'Logement introuvable' });

      console.log(`💰 [MARKUPS] ${req.params.id} · ${CODES[code]} → ${pct > 0 ? '+' + pct + '%' : 'aucune'}`);

      /* Le nouveau prix ne partira chez le partenaire qu'a la prochaine
         synchronisation des tarifs — on le dit au client pour qu'il ne
         croie pas a un echec en ne voyant rien changer tout de suite. */
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

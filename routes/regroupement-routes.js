/* ============================================================
   routes/regroupement-routes.js
   Rattacher un logement a l'immeuble d'un autre
   ============================================================
   MONTAGE — une ligne dans server.js, avant app.listen() :

     require('./routes/regroupement-routes')(app, pool, authenticateToken);

   Remplacez `authenticateToken` par le nom de votre middleware d'auth
   (celui des autres routes /api/properties).

   ── LE PROBLEME QUE CETTE ROUTE RESOUT ───────────────────────────
   Deux logements dans le meme immeuble, mais connectes separement :
   chacun a son propre etablissement chez le partenaire. Airbnb le
   tolere. Booking.com non — l'identifiant de l'etablissement (9001519)
   n'est utilisable qu'une fois, et le second logement est bloque, sans
   qu'aucun ecran ne dise pourquoi.

   La seule issue est de rattacher le second logement a l'etablissement
   du premier. Chez le partenaire, un logement ne se DEPLACE pas d'un
   etablissement a l'autre : il faut detacher puis recreer. Cette route
   fait cet enchainement en une fois, au lieu de laisser l'utilisateur
   deviner qu'une deconnexion est la solution.

   ── CE QU'ELLE NE CACHE PAS ──────────────────────────────────────
   Le rattachement CASSE les canaux deja mappes sur l'ancien
   etablissement : ils devront etre remappes sous le nouveau. La reponse
   les liste nommement (`a_remapper`) pour que l'interface le dise AVANT
   de lancer l'operation, pas apres.

   ── CE QU'ELLE REFUSE ────────────────────────────────────────────
   - un logement qui a des reservations a venir : le remapping les
     mettrait en peril, et cette route n'est pas le bon endroit pour
     arbitrer ce risque ;
   - un logement deja dans l'etablissement vise : rien a faire ;
   - une cible qui n'a pas d'etablissement, ou qui n'appartient pas a
     l'appelant.
   ============================================================ */

'use strict';

module.exports = function monterRoutesRegroupement(app, pool, auth) {

  /* ── Ce qu'un rattachement couterait, sans rien modifier ──────
     L'interface appelle ceci d'abord, pour annoncer les consequences.
     Une operation destructrice doit etre chiffree avant d'etre lancee. */
  app.get('/api/properties/:id/regroupement', auth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, internal_name, address,
                channex_property_id, channex_room_type_id, channex_enabled
           FROM properties
          WHERE user_id = $1`,
        [req.user.id]
      );

      const moi = rows.find(r => r.id === req.params.id);
      if (!moi) return res.status(404).json({ error: 'Logement introuvable' });

      const norm = (a) => String(a || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

      const monAdresse = norm(moi.address);

      // Candidats : meme adresse non vide, etablissement different du mien.
      const candidats = monAdresse
        ? rows.filter(r =>
            r.id !== moi.id &&
            norm(r.address) === monAdresse &&
            r.channex_property_id &&
            r.channex_property_id !== moi.channex_property_id)
        : [];

      // Ce qui sera a remapper : les canaux du logement, s'il en a.
      let aRemapper = [];
      if (moi.channex_enabled && moi.channex_property_id) {
        try {
          const { channexAPI } = require('../channex');
          const r = await channexAPI.get('/channels', {
            params: { 'filter[property_id]': moi.channex_property_id, 'pagination[page_size]': 100 }
          });
          aRemapper = (r.data?.data || []).map(c => ({
            titre: c.attributes?.title || c.id,
            canal: c.attributes?.channel || null
          }));
        } catch (e) {
          // On ne connait pas la liste : on le DIT, plutot que de renvoyer
          // un tableau vide qui ferait croire qu'il n'y a rien a refaire.
          console.warn('⚠️ [REGROUPEMENT] Lecture des canaux impossible:', e.message);
          aRemapper = null;
        }
      }

      const { rows: resa } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM reservations
          WHERE property_id = $1 AND status != 'cancelled' AND end_date >= CURRENT_DATE`,
        [moi.id]
      );

      res.json({
        adresse: moi.address || null,
        sans_adresse: !monAdresse,
        deja_groupe: rows.some(r => r.id !== moi.id && r.channex_property_id &&
                                    r.channex_property_id === moi.channex_property_id),
        candidats: candidats.map(c => ({
          id: c.id,
          nom: c.internal_name || c.name,
          channex_property_id: c.channex_property_id
        })),
        a_remapper: aRemapper,
        reservations_a_venir: resa[0].n
      });
    } catch (e) {
      console.error('❌ [REGROUPEMENT] GET:', e.message);
      res.status(500).json({ error: 'Lecture impossible' });
    }
  });

  /* ── Le rattachement ──────────────────────────────────────────── */
  app.post('/api/properties/:id/regroupement', auth, async (req, res) => {
    const cible = String(req.body.cible_property_id || '');
    if (!cible) return res.status(400).json({ error: 'Logement cible manquant' });

    try {
      const { rows } = await pool.query(
        `SELECT id, name, internal_name, channex_property_id, channex_enabled
           FROM properties
          WHERE user_id = $1 AND id = ANY($2::text[])`,
        [req.user.id, [req.params.id, cible]]
      );

      const moi = rows.find(r => r.id === req.params.id);
      const autre = rows.find(r => r.id === cible);

      if (!moi)   return res.status(404).json({ error: 'Logement introuvable' });
      if (!autre) return res.status(404).json({ error: 'Logement cible introuvable' });
      if (!autre.channex_property_id) {
        return res.status(400).json({ error: 'Le logement cible n\'est pas encore connecté.' });
      }
      if (moi.channex_property_id === autre.channex_property_id) {
        return res.status(400).json({ error: 'Ce logement est déjà dans le même immeuble.' });
      }

      // Une reservation a venir dependrait d'un mapping qu'on va casser.
      const { rows: resa } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM reservations
          WHERE property_id = $1 AND status != 'cancelled' AND end_date >= CURRENT_DATE`,
        [moi.id]
      );
      if (resa[0].n > 0 && !req.body.force) {
        return res.status(409).json({
          error: 'Ce logement a ' + resa[0].n + ' réservation(s) à venir. Le rattachement casse les ' +
                 'associations existantes : traitez-les d\'abord, ou renvoyez force: true en connaissance de cause.',
          reservations_a_venir: resa[0].n
        });
      }

      const { addRoomTypeToProperty } = require('../channex');

      // Detacher : on vide les colonnes chez nous. L'ancien etablissement
      // reste chez le partenaire — vide et inoffensif. Le supprimer serait
      // irreversible et n'apporte rien.
      const ancien = moi.channex_property_id;
      await pool.query(
        `UPDATE properties
            SET channex_property_id = NULL, channex_room_type_id = NULL,
                channex_rate_plan_id = NULL, channex_enabled = false,
                channex_markup_rate_plans = '{}'::jsonb
          WHERE id = $1`,
        [moi.id]
      );

      // Rattacher : un nouveau room type sous l'etablissement de l'autre.
      let cree;
      try {
        cree = await addRoomTypeToProperty(pool, {
          user_id: req.user.id,
          property_id: moi.id,
          channex_property_id: autre.channex_property_id,
          name: moi.internal_name || moi.name || 'Logement'
        });
      } catch (e) {
        // Rattachement echoue : on remet l'ancien lien plutot que de laisser
        // le logement sans etablissement du tout.
        await pool.query(
          `UPDATE properties SET channex_property_id = $1, channex_enabled = true WHERE id = $2`,
          [ancien, moi.id]
        );
        console.error('❌ [REGROUPEMENT] Rattachement échoué, ancien lien rétabli:', e.message);
        return res.status(502).json({
          error: 'Le rattachement a échoué et l\'état précédent a été rétabli. ' +
                 (e.response?.data?.errors?.title || e.message)
        });
      }

      console.log(`🏢 [REGROUPEMENT] ${moi.id} rattaché à l'immeuble de ${autre.id} (${autre.channex_property_id})`);

      res.json({
        ok: true,
        immeuble_de: autre.internal_name || autre.name,
        channex_property_id: autre.channex_property_id,
        channex_room_type_id: cree.channex_room_type_id,
        message: 'Rattaché à l\'immeuble de ' + (autre.internal_name || autre.name) +
                 '. Les plateformes doivent maintenant être mappées sur ce logement ' +
                 'dans le canal existant — il n\'y a plus de canal à créer.'
      });
    } catch (e) {
      console.error('❌ [REGROUPEMENT] POST:', e.message);
      res.status(500).json({ error: 'Rattachement impossible' });
    }
  });

  console.log('✅ [REGROUPEMENT] Routes de rattachement d\'immeuble montées');
};

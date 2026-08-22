/* ============================================================
   routes/diagnostic-ota-routes.js
   Ce que le partenaire sait vraiment d'un logement
   ============================================================
   MONTAGE — dans server.js, avant app.listen() :

     require('./routes/diagnostic-ota-routes')(app, pool, authenticateToken);

   ── POURQUOI CETTE ROUTE ─────────────────────────────────────────
   SG Etage reste « Tarif fermé » chez Booking.com apres l'envoi des
   disponibilites ET des tarifs. Trois causes sont possibles, et rien
   dans le produit ne permet de les distinguer :

     1. le logement n'a pas de plan tarifaire chez le partenaire ;
     2. il en a un, mais le canal Booking est mappe sur un AUTRE plan —
        le cas classique apres un rattachement d'immeuble, qui cree un
        nouveau room type sans toucher au mapping existant ;
     3. le plan est le bon, mais les tarifs n'y sont jamais arrives.

   Continuer a corriger sans savoir laquelle, c'est deviner. Cette route
   lit l'etat reel chez le partenaire et le renvoie tel quel.

   Elle ne modifie RIEN. C'est un instrument de mesure.

   ── UTILISATION ──────────────────────────────────────────────────
     curl -s -H "Authorization: Bearer $TOKEN" \
       https://VOTRE-DOMAINE/api/properties/ID_DU_LOGEMENT/diagnostic-ota \
       | python3 -m json.tool
   ============================================================ */

'use strict';

module.exports = function monterDiagnosticOTA(app, pool, auth) {

  app.get('/api/properties/:id/diagnostic-ota', auth, async (req, res) => {
    const diag = { logement: null, chez_le_partenaire: null, verdict: [] };

    try {
      const { rows } = await pool.query(
        `SELECT id, name, internal_name, address, base_price, weekend_price,
                channex_enabled, channex_property_id, channex_room_type_id,
                channex_rate_plan_id, external_pricing,
                COALESCE(platform_markups, '{}'::jsonb) AS markups,
                COALESCE(channex_markup_rate_plans, '{}'::jsonb) AS plans_majores
           FROM properties
          WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );

      const p = rows[0];
      if (!p) return res.status(404).json({ error: 'Logement introuvable' });

      diag.logement = {
        nom: p.internal_name || p.name,
        adresse: p.address || null,
        prix_base: p.base_price,
        prix_weekend: p.weekend_price,
        connecte: !!p.channex_enabled,
        etablissement: p.channex_property_id,
        room_type: p.channex_room_type_id,
        rate_plan: p.channex_rate_plan_id,
        tarifs_externes: !!p.external_pricing,
        majorations: p.markups,
        plans_majores: p.plans_majores
      };

      if (!p.base_price) diag.verdict.push('Aucun prix de base : rien ne peut être envoyé.');
      if (!p.channex_rate_plan_id) diag.verdict.push('Aucun plan tarifaire enregistré de notre côté.');
      if (p.external_pricing) diag.verdict.push('Tarifs pilotés par un outil externe : nos envois sont ignorés.');

      // Les autres logements du meme etablissement : utile pour comprendre
      // un immeuble partage.
      if (p.channex_property_id) {
        const { rows: freres } = await pool.query(
          `SELECT id, internal_name, name, channex_room_type_id, channex_rate_plan_id
             FROM properties
            WHERE user_id = $1 AND channex_property_id = $2 AND id <> $3`,
          [req.user.id, p.channex_property_id, p.id]
        );
        diag.meme_etablissement = freres.map(f => ({
          nom: f.internal_name || f.name,
          room_type: f.channex_room_type_id,
          rate_plan: f.channex_rate_plan_id
        }));
      }

      if (!p.channex_property_id) {
        diag.verdict.push('Pas d\'établissement : le logement n\'est pas connecté.');
        return res.json(diag);
      }

      const { channexAPI } = require('../channex');
      const chez = { room_types: [], rate_plans: [], canaux: [], tarifs_vus: null };

      // Room types de l'etablissement
      try {
        const r = await channexAPI.get('/room_types', {
          params: { 'filter[property_id]': p.channex_property_id, 'pagination[page_size]': 100 }
        });
        chez.room_types = (r.data?.data || []).map(x => ({
          id: x.id, titre: x.attributes?.title,
          est_le_notre: x.id === p.channex_room_type_id
        }));
      } catch (e) { chez.room_types = { erreur: e.response?.data || e.message }; }

      // Plans tarifaires
      try {
        const r = await channexAPI.get('/rate_plans', {
          params: { 'filter[property_id]': p.channex_property_id, 'pagination[page_size]': 100 }
        });
        chez.rate_plans = (r.data?.data || []).map(x => ({
          id: x.id,
          titre: x.attributes?.title,
          room_type: x.attributes?.room_type_id,
          est_le_notre: x.id === p.channex_rate_plan_id,
          sur_notre_room_type: x.attributes?.room_type_id === p.channex_room_type_id
        }));
      } catch (e) { chez.rate_plans = { erreur: e.response?.data || e.message }; }

      // Canaux, et surtout leur mapping : c'est la que se voit le decalage.
      try {
        const r = await channexAPI.get('/channels', {
          params: { 'filter[property_id]': p.channex_property_id, 'pagination[page_size]': 100 }
        });
        chez.canaux = (r.data?.data || []).map(x => {
          const a = x.attributes || {};
          const mappings = (a.settings?.mappings || a.mappings || []).map(mp => ({
            room_type: mp.room_type_id || mp.roomTypeId || null,
            rate_plan: mp.rate_plan_id || mp.ratePlanId || null,
            chambre_partenaire: mp.channel_room_id || mp.channel_rate_id || null
          }));
          return {
            id: x.id, titre: a.title, canal: a.channel,
            actif: a.is_active !== false,
            mappings: mappings,
            pointe_sur_notre_rate_plan: mappings.some(mp => mp.rate_plan === p.channex_rate_plan_id)
          };
        });
      } catch (e) { chez.canaux = { erreur: e.response?.data || e.message }; }

      // Les tarifs reellement presents sur notre plan, sur 7 jours.
      try {
        const debut = new Date().toISOString().slice(0, 10);
        const fin = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
        const r = await channexAPI.get('/restrictions', {
          params: {
            'filter[property_id]': p.channex_property_id,
            'filter[rate_plan_ids]': p.channex_rate_plan_id,
            'filter[date][gte]': debut,
            'filter[date][lte]': fin
          }
        });
        chez.tarifs_vus = r.data?.data || r.data || null;
      } catch (e) { chez.tarifs_vus = { erreur: e.response?.data || e.message }; }

      diag.chez_le_partenaire = chez;

      // ── Lecture des faits ────────────────────────────────────
      if (Array.isArray(chez.rate_plans)) {
        if (!chez.rate_plans.some(rp => rp.est_le_notre)) {
          diag.verdict.push(
            'Le plan tarifaire que nous utilisons (' + p.channex_rate_plan_id + ') n\'existe pas ' +
            'chez le partenaire. Les tarifs partent dans le vide.'
          );
        }
      }

      if (Array.isArray(chez.canaux)) {
        const actifs = chez.canaux.filter(c => c.actif);
        if (!actifs.length) {
          diag.verdict.push('Aucun canal actif sur cet établissement.');
        } else {
          const mal = actifs.filter(c => c.mappings.length && !c.pointe_sur_notre_rate_plan);
          if (mal.length) {
            diag.verdict.push(
              'CAUSE LA PLUS PROBABLE — ' + mal.map(c => c.titre || c.canal).join(', ') +
              ' est mappé sur un autre plan tarifaire que le nôtre. Nos tarifs arrivent sur un plan ' +
              'que le canal ne lit pas : le logement reste fermé à la vente. Dans la fenêtre du ' +
              'partenaire, onglet Mapping, faites pointer ce canal sur notre plan (' +
              p.channex_rate_plan_id + ').'
            );
          }
          const sansMapping = actifs.filter(c => !c.mappings.length);
          if (sansMapping.length) {
            diag.verdict.push(
              sansMapping.map(c => c.titre || c.canal).join(', ') +
              ' n\'a aucun mapping : le canal existe mais aucun logement ne lui est associé.'
            );
          }
        }
      }

      if (!diag.verdict.length) {
        diag.verdict.push(
          'Rien d\'anormal de notre côté : plan tarifaire présent, canal mappé dessus. ' +
          'Si le partenaire garde le logement fermé, la cause est chez lui — ouvrez ' +
          '« Problèmes éventuels » dans son extranet, il nomme précisément ce qui bloque.'
        );
      }

      res.json(diag);
    } catch (e) {
      console.error('❌ [DIAG-OTA]', e.message);
      res.status(500).json({ error: e.message, partiel: diag });
    }
  });

  console.log('✅ [DIAG-OTA] Route de diagnostic montée');
};

/* ============================================================
   routes/push-tarifs-routes.js
   Envoyer les tarifs du calendrier vers les plateformes
   ============================================================
   MONTAGE — une ligne dans server.js, avant app.listen() :

     require('./routes/push-tarifs-routes')(app, pool, authenticateToken);

   (outils/monter-push-tarifs.js le fait pour vous.)

   ── LE PROBLEME QUE CETTE ROUTE RESOUT ───────────────────────────
   Sur Booking.com, deux logements du meme immeuble :

     Appartement 1 Chambre (900151901)  « Réservable », Standard Rate 75 €
     Appartement deux pièces (900151902) « Tarif fermé », Standard Rate VIDE

   Les disponibilites du second sont bien parties — les reservations
   nettes s'affichent. Mais son plan tarifaire n'a AUCUN prix, et un
   plan sans prix est ferme a la vente. C'est litteralement ce que
   Booking annonce.

   Pourquoi : les tarifs ne partaient que par un seul chemin, le moteur
   de tarification dynamique en mode « auto » (routes/pricing-apply.js).
   Un logement qui n'est pas passe par ce moteur n'a jamais recu de prix.
   Aucune route ne permettait de pousser simplement le prix du
   calendrier.

   ── D'OU VIENT LE PRIX ENVOYE ────────────────────────────────────
   Dans l'ordre :
     1. pricing_schedule, si le moteur a deja calcule des nuits — c'est
        le prix que l'utilisateur voit dans son calendrier ;
     2. sinon weekend_price les vendredis et samedis, base_price les
        autres jours — le reglage de la fiche du logement.

   La majoration par plateforme est appliquee par pushRates lui-meme
   (channex.js, assurerPlansMajores) : rien a faire ici. base_price
   n'est jamais modifie.

   ── CE QU'ELLE REFUSE ────────────────────────────────────────────
   Un logement sans base_price : sans prix de reference, il n'y a rien
   a envoyer, et inventer un prix serait pire que de refuser.
   ============================================================ */

'use strict';

module.exports = function monterRoutesPushTarifs(app, pool, auth) {

  app.post('/api/properties/:id/push-rates', auth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, internal_name, base_price, weekend_price,
                channex_enabled, channex_property_id,
                channex_room_type_id, channex_rate_plan_id, external_pricing
           FROM properties
          WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );

      const p = rows[0];
      if (!p) return res.status(404).json({ error: 'Logement introuvable' });

      if (!p.channex_enabled || !p.channex_rate_plan_id) {
        return res.status(400).json({
          error: 'Ce logement n\'est pas encore connecté aux plateformes.'
        });
      }
      if (p.base_price == null) {
        return res.status(400).json({
          error: 'Ce logement n\'a pas de prix de base. Renseignez-le dans sa fiche : ' +
                 'sans prix de référence, il n\'y a rien à envoyer aux plateformes.'
        });
      }
      if (p.external_pricing) {
        return res.status(400).json({
          error: 'Les tarifs de ce logement sont pilotés par un outil externe (PriceLabs). ' +
                 'C\'est lui qui doit les envoyer.'
        });
      }

      const JOURS = 500;

      // 1. Le planning du moteur, s'il existe : c'est le prix que
      //    l'utilisateur voit dans son calendrier.
      const { rows: planning } = await pool.query(
        `SELECT to_char(date, 'YYYY-MM-DD') AS date, price
           FROM pricing_schedule
          WHERE property_id = $1
            AND date >= CURRENT_DATE
            AND date < CURRENT_DATE + $2::int
          ORDER BY date`,
        [p.id, JOURS]
      ).catch(() => ({ rows: [] }));

      const parDate = {};
      planning.forEach(r => { parDate[r.date] = parseFloat(r.price); });

      // 2. Repli sur la fiche : weekend_price les vendredis et samedis.
      const base = parseFloat(p.base_price);
      const weekend = p.weekend_price != null ? parseFloat(p.weekend_price) : base;

      const rates = [];
      const d = new Date();
      d.setHours(12, 0, 0, 0);   // midi : evite les decalages de fuseau
      for (let i = 0; i < JOURS; i++) {
        const iso = d.toISOString().slice(0, 10);
        const jour = d.getDay();                     // 5 = vendredi, 6 = samedi
        const prix = parDate[iso] != null ? parDate[iso] : (jour === 5 || jour === 6 ? weekend : base);
        rates.push({ date: iso, price: prix });
        d.setDate(d.getDate() + 1);
      }

      const { pushRates } = require('../channex');
      await pushRates(pool, {
        property_id: p.id,
        channex_property_id: p.channex_property_id,
        channex_rate_plan_id: p.channex_rate_plan_id,
        rates: rates
      });

      const source = planning.length ? 'calendrier' : 'fiche du logement';
      console.log(`💰 [PUSH-RATES] ${p.internal_name || p.name} : ${rates.length} nuits envoyées (source : ${source})`);

      res.json({
        ok: true,
        nuits: rates.length,
        source: source,
        depuis: rates[0].date,
        jusqu_au: rates[rates.length - 1].date,
        message: rates.length + ' nuits envoyées. Comptez quelques minutes avant que les ' +
                 'plateformes ouvrent les dates à la vente.'
      });
    } catch (e) {
      console.error('❌ [PUSH-RATES]', e.response?.data || e.message);
      res.status(500).json({
        error: 'L\'envoi des tarifs a échoué. ' +
               (e.response?.data?.errors?.title || e.message)
      });
    }
  });

  console.log('✅ [PUSH-RATES] Route d\'envoi des tarifs montée');
};

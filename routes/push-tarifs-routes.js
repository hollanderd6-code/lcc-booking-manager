/* ============================================================
   routes/push-tarifs-routes.js
   Envoyer les tarifs du calendrier vers les plateformes
   ============================================================
   MONTAGE — une ligne dans server.js, avant app.listen() :

     require('./routes/push-tarifs-routes')(app, pool, authenticateToken);

   (outils/monter-push-tarifs.js le fait pour vous.)

   ── CE QU'ELLE FAIT ──────────────────────────────────────────
   POST /api/properties/:id/push-rates

   Valide l'accès utilisateur puis délègue la résolution des
   tarifs et restrictions à publishEffectivePricing() (P0-C1).
   Plus aucune résolution locale : la route délègue entièrement
   au publisher et n'appelle plus les fonctions Channex directement.

   ── DATE RANGE ───────────────────────────────────────────────
   500 nuits à partir d'aujourd'hui (start inclusif / end exclusif).
   Même horizon qu'avant. Local noon évite les décalages DST.

   ── CE QU'ELLE REFUSE ────────────────────────────────────────
   - Logement sans base_price
   - Logement non connecté à Channex
   - Logement en tarification externe (PriceLabs)
   ============================================================ */

'use strict';

module.exports = function monterRoutesPushTarifs(app, pool, auth, deps = {}) {
  const { publishEffectivePricing: _pub, PUBLISH_STATUS } = require('./pricing-publisher');
  const { addDays } = require('./effective-pricing-resolver');
  const publish = deps.publisher || _pub;

  app.post('/api/properties/:id/push-rates', auth, async (req, res) => {
    try {
      // ── 1. Auth + ownership ─────────────────────────────────────────────────
      const { rows } = await pool.query(
        `SELECT id, name, internal_name, base_price, channex_enabled,
                channex_rate_plan_id, external_pricing
           FROM properties
          WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id],
      );
      const p = rows[0];

      if (!p) {
        return res.status(404).json({ error: 'Logement introuvable' });
      }
      if (!p.channex_enabled || !p.channex_rate_plan_id) {
        return res.status(400).json({
          error: 'Ce logement n\'est pas encore connecté aux plateformes.',
        });
      }
      if (p.base_price == null) {
        return res.status(400).json({
          error: 'Ce logement n\'a pas de prix de base. Renseignez-le dans sa fiche : ' +
                 'sans prix de référence, il n\'y a rien à envoyer aux plateformes.',
        });
      }
      if (p.external_pricing) {
        return res.status(400).json({
          error: 'Les tarifs de ce logement sont pilotés par un outil externe (PriceLabs). ' +
                 'C\'est lui qui doit les envoyer.',
        });
      }

      // ── 2. Date range — 500 nuits, start inclusif / end exclusif ────────────
      // Local noon évite les décalages DST au moment du slice ISO.
      const JOURS = 500;
      const d0 = new Date();
      d0.setHours(12, 0, 0, 0);
      const startDate = d0.toISOString().slice(0, 10);
      const endDate   = addDays(startDate, JOURS);   // exclusif → exactement JOURS nuits

      // ── 3. Déléguer au publisher (just-in-time resolver) ────────────────────
      const result = await publish(pool, {
        propertyId: p.id,
        userId:     req.user.id,
        startDate,
        endDate,
        reason:    'manual_push',
        force:      true,
      });

      // ── 4. HTTP mapping ──────────────────────────────────────────────────────
      const label = p.internal_name || p.name;
      console.log(
        `💰 [PUSH-RATES] ${label} : ${result.nights} nuits — ${result.status}` +
        ` — rates:${result.rates.pushed} restr:${result.restrictions.pushed}`,
      );

      if (result.status === PUBLISH_STATUS.OK) {
        return res.json({
          ok:        true,
          nuits:     result.nights,
          depuis:    startDate,
          jusqu_au:  addDays(startDate, JOURS - 1),
          message:   result.nights + ' nuits envoyées. Comptez quelques minutes avant que les ' +
                     'plateformes ouvrent les dates à la vente.',
        });
      }

      if (result.status === PUBLISH_STATUS.PARTIAL) {
        return res.json({
          ok:      false,
          partial: true,
          nuits:   result.nights,
          message: 'Synchronisation partielle : certains éléments n\'ont pas pu être envoyés aux plateformes.',
        });
      }

      if (result.status === PUBLISH_STATUS.ERROR) {
        console.error('❌ [PUSH-RATES] publisher error —',
          result.rates.error || result.restrictions.error || 'unknown');
        return res.status(500).json({ error: 'L\'envoi des tarifs a échoué.' });
      }

      // Défense en profondeur : les SKIPPED ne devraient pas être atteints
      // ici car les guards ci-dessus les ont déjà bloqués.
      if (result.status === PUBLISH_STATUS.SKIPPED_EXTERNAL) {
        return res.status(400).json({
          error: 'Les tarifs de ce logement sont pilotés par un outil externe. C\'est lui qui doit les envoyer.',
        });
      }
      if (result.status === PUBLISH_STATUS.SKIPPED_CHANNEX_DISABLED ||
          result.status === PUBLISH_STATUS.SKIPPED_MISSING_IDS) {
        return res.status(400).json({
          error: 'Ce logement n\'est pas encore connecté aux plateformes.',
        });
      }
      if (result.status === PUBLISH_STATUS.SKIPPED_NOT_FOUND) {
        return res.status(404).json({ error: 'Logement introuvable' });
      }

      return res.status(500).json({ error: 'Statut inattendu.' });

    } catch (e) {
      console.error('❌ [PUSH-RATES]', e.response?.data || e.message);
      res.status(500).json({ error: 'L\'envoi des tarifs a échoué.' });
    }
  });

  console.log('✅ [PUSH-RATES] Route d\'envoi des tarifs montée');
};

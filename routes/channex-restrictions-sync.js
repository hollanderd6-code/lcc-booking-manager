/* ============================================================
   routes/channex-restrictions-sync.js — P0-C4.7
   POST /api/channex/sync-restrictions/:property_id

   Remplace l'ancienne logique inline de server.js (~43380–43477).
   Ferme le dernier bypass actif du central pricing publisher (PATH7).

   ── CE QUE FAIT CETTE ROUTE ─────────────────────────────────
   Pousse 500 nuits de tarifs + restrictions vers Channex via le
   central publisher (publishEffectivePricing, stopSellMode:'true_only').

   ── CE QU'ELLE REMPLACE ─────────────────────────────────────
   Ancienne logique inline (PATH7 bypass) :
     - moteur legacy (period/weekday/base/weekend)  — SUPPRIMÉ
     - rate embarqué directement dans pushRestrictions — SUPPRIMÉ
     - appel direct pushRestrictions sans publisher  — SUPPRIMÉ
     - aucun guard external_pricing                 — CORRIGÉ

   ── DIFFÉRENCES VOLONTAIRES PAR RAPPORT AU CONTRAT HISTORIQUE ─
   1. external_pricing=true → 400 "outil externe"
      (avant : aucun guard → Channex write avec prix legacy)
   2. BoostPrice applied et pricing_overrides désormais inclus
      (avant : ignorés)
   3. PARTIAL désormais possible (rates OK, restrictions KO ou inverse)
      (avant : un seul appel combiné, tout ou rien)
   4. userId publisher = prop.user_id (canonical owner)
      (avant : req.user.id pour le caller, pas l'owner canonical)

   ── CONTRAT HTTP PRÉSERVÉ ────────────────────────────────────
   URL     : POST /api/channex/sync-restrictions/:property_id
   Auth    : authenticateToken (inchangé)
   200 OK  : { success:true, message:'Tarifs + restrictions synchronisés', restrictions:N, rates:N }
   400     : { error:'Logement non configuré pour la diffusion' }
   500     : { error:'...' }

   ── MONTAGE (server.js) ─────────────────────────────────────
   require('./routes/channex-restrictions-sync')(app, pool, {
     authenticateToken,
     getAgencyUserIds,
   });
   ============================================================ */

'use strict';

module.exports = function monterRouteSyncRestrictions(app, pool, middlewares, deps = {}) {
  const { authenticateToken, getAgencyUserIds } = middlewares;

  const { publishEffectivePricing: _pub, PUBLISH_STATUS } = require('./pricing-publisher');
  const { addDays } = require('./effective-pricing-resolver');
  const publish = deps.publisher || _pub;

  app.post(
    '/api/channex/sync-restrictions/:property_id',
    authenticateToken,
    async (req, res) => {
      const { property_id } = req.params;
      const user_id = req.user.id;

      try {
        const agencyIds = await getAgencyUserIds(req, user_id);

        const { rows } = await pool.query(
          `SELECT id, user_id, name,
                  external_pricing,
                  channex_enabled, channex_property_id,
                  channex_room_type_id, channex_rate_plan_id
             FROM properties
            WHERE id = $1 AND user_id = ANY($2::text[])`,
          [property_id, agencyIds],
        );
        const prop = rows[0];

        // Preserve historical 400 for both not-found and not-configured
        if (!prop || !prop.channex_enabled || !prop.channex_property_id) {
          return res.status(400).json({ error: 'Logement non configuré pour la diffusion' });
        }

        // UTC noon avoids DST skew when converting to YYYY-MM-DD
        const d0 = new Date();
        d0.setHours(12, 0, 0, 0);
        const startDate = d0.toISOString().slice(0, 10);
        const endDate   = addDays(startDate, 500);

        const result = await publish(pool, {
          propertyId:   prop.id,
          userId:       prop.user_id,
          startDate,
          endDate,
          reason:       'manual_restrictions_push',
          stopSellMode: 'true_only',
        });

        const ratesCount = result.rates?.pushed ?? 0;
        const restrCount = result.restrictions?.pushed ?? 0;

        if (result.status === PUBLISH_STATUS.OK) {
          console.log(
            `✅ [CHANNEX SYNC RESTRICTIONS] ${property_id} OK` +
            ` — rates:${ratesCount} restr:${restrCount}`,
          );
          return res.json({
            success:      true,
            message:      'Tarifs + restrictions synchronisés',
            restrictions: restrCount,
            rates:        ratesCount,
          });
        }

        if (result.status === PUBLISH_STATUS.PARTIAL) {
          console.warn(
            `⚠️ [CHANNEX SYNC RESTRICTIONS] ${property_id} partial` +
            ` — rates_err:${result.rates.error || 'none'}` +
            ` restr_err:${result.restrictions.error || 'none'}`,
          );
          return res.json({
            success:      true,
            partial:      true,
            message:      'Tarifs + restrictions partiellement synchronisés',
            restrictions: restrCount,
            rates:        ratesCount,
          });
        }

        if (result.status === PUBLISH_STATUS.ERROR) {
          console.error(`❌ [CHANNEX SYNC RESTRICTIONS] ${property_id} error`);
          return res.status(500).json({ error: 'Erreur lors de la synchronisation des tarifs.' });
        }

        if (result.status === PUBLISH_STATUS.SKIPPED_EXTERNAL) {
          return res.status(400).json({
            error: 'Les tarifs de ce logement sont pilotés par un outil externe.',
          });
        }

        if (result.status === PUBLISH_STATUS.SKIPPED_CHANNEX_DISABLED ||
            result.status === PUBLISH_STATUS.SKIPPED_MISSING_IDS) {
          return res.status(400).json({ error: 'Logement non configuré pour la diffusion' });
        }

        if (result.status === PUBLISH_STATUS.SKIPPED_NOT_FOUND) {
          return res.status(404).json({ error: 'Logement introuvable' });
        }

        return res.status(500).json({ error: 'Statut inattendu.' });

      } catch (e) {
        console.error('❌ [CHANNEX SYNC RESTRICTIONS]', e.message);
        res.status(500).json({ error: e.message });
      }
    },
  );

  console.log('✅ [CHANNEX SYNC RESTRICTIONS] Route montée');
};

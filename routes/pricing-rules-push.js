/* ============================================================
   routes/pricing-rules-push.js — P0-C4.4-B
   POST /api/pricing/rules/push-channex/:property_id

   Remplace l'ancienne logique inline de server.js (lignes ~19638–19812).

   ── CE QUE FAIT CETTE ROUTE ──────────────────────────────────
   Envoie les tarifs et restrictions effectifs d'un logement vers
   Channex sur 500 nuits à partir d'aujourd'hui.

   Prix résolu par publishEffectivePricing → resolver effectif :
     manual_override > BoostPrice applied > period > weekday > weekend > base

   BoostPrice applied est maintenant inclus (correction de la
   régression de PATH 2 qui écrasait BoostPrice avec le prix legacy).

   ── CE QU'ELLE REFUSE ────────────────────────────────────────
   - Logement inaccessible/introuvable → 404
   - Logement en tarification externe  → 400  (NOUVEAU — guard absent avant)
   - Channex non configuré             → 400

   ── STOP_SELL ────────────────────────────────────────────────
   Mode true_only : stop_sell:true si une règle couvre la date ;
   champ absent sinon. Ne rouvre jamais une date bloquée manuellement.

   ── MONTAGE (server.js) ──────────────────────────────────────
   require('./routes/pricing-rules-push')(app, pool, {
     authenticateAny,
     requirePermission,
     getUserFromRequest,
     getAgencyUserIds,
   });
   ============================================================ */

'use strict';

module.exports = function monterRoutePricingRulesPush(app, pool, middlewares, deps = {}) {
  const {
    authenticateAny,
    requirePermission,
    getUserFromRequest,
    getAgencyUserIds,
  } = middlewares;

  const { publishEffectivePricing: _pub, PUBLISH_STATUS } = require('./pricing-publisher');
  const { addDays } = require('./effective-pricing-resolver');
  const publish = deps.publisher || _pub;

  app.post(
    '/api/pricing/rules/push-channex/:property_id',
    authenticateAny,
    requirePermission(pool, 'can_manage_pricing'),
    async (req, res) => {
      try {
        // ── 1. Auth ──────────────────────────────────────────────────────────
        const user = await getUserFromRequest(req);
        if (!user) return res.status(401).json({ error: 'Non autorisé' });

        const { property_id } = req.params;

        // ── 2. Ownership — agencyIds supports delegation ─────────────────────
        const agencyIds = await getAgencyUserIds(req, user.id);
        const { rows } = await pool.query(
          `SELECT id, user_id, name, base_price,
                  external_pricing,
                  channex_enabled, channex_property_id, channex_room_type_id, channex_rate_plan_id
             FROM properties
            WHERE id = $1 AND user_id = ANY($2::text[])`,
          [property_id, agencyIds],
        );
        const prop = rows[0];
        if (!prop) return res.status(404).json({ error: 'Logement introuvable' });

        // ── 3. Guards (pre-publisher, fail-closed) ───────────────────────────
        if (prop.external_pricing) {
          return res.status(400).json({
            error: 'Les tarifs de ce logement sont pilotés par un outil externe.',
          });
        }
        if (!prop.channex_enabled || !prop.channex_property_id ||
            !prop.channex_room_type_id || !prop.channex_rate_plan_id) {
          return res.status(400).json({
            error: "Ce logement n'est pas configuré pour la diffusion",
          });
        }

        // ── 4. Date range — 500 nights, UTC-safe ─────────────────────────────
        // Local noon avoids DST skew when converting to YYYY-MM-DD.
        const d0 = new Date();
        d0.setHours(12, 0, 0, 0);
        const startDate = d0.toISOString().slice(0, 10);
        const endDate   = addDays(startDate, 500);  // exclusive → exactly 500 nights

        // ── 5. Delegate to publisher ─────────────────────────────────────────
        // userId = prop.user_id (canonical pricing owner, NOT the caller's id)
        // stopSellMode:'true_only' preserves the historical PATH 2 behavior:
        //   stop_sell:true when a rule covers the date; field absent otherwise.
        const result = await publish(pool, {
          propertyId:   prop.id,
          userId:       prop.user_id,
          startDate,
          endDate,
          reason:       'manual_push',
          stopSellMode: 'true_only',
        });

        // ── 6. HTTP mapping ──────────────────────────────────────────────────
        // Use 'pushed' counts (rates/restrictions actually received by Channex)
        // to match the historical message semantics.
        const ratesCount = result.rates?.pushed ?? 0;
        const restrCount = result.restrictions?.pushed ?? 0;

        if (result.status === PUBLISH_STATUS.OK) {
          return res.json({
            success: true,
            ok:      true,
            message: `${ratesCount} jours de tarifs + ${restrCount} jours de restrictions synchronisés`,
            property:        prop.name,
            longStayApplied: false,
            details: { rates: ratesCount, restrictions: restrCount },
          });
        }

        if (result.status === PUBLISH_STATUS.PARTIAL) {
          console.warn(
            `⚠️ [PUSH-CHANNEX] ${prop.name} — partial` +
            ` rates_err:${result.rates.error || 'none'} restr_err:${result.restrictions.error || 'none'}`,
          );
          return res.json({
            success: true,
            ok:      true,
            partial: true,
            message: `${ratesCount} jours de tarifs + ${restrCount} jours de restrictions synchronisés (synchronisation partielle)`,
            property:        prop.name,
            longStayApplied: false,
            details: { rates: ratesCount, restrictions: restrCount },
          });
        }

        if (result.status === PUBLISH_STATUS.ERROR) {
          console.error(
            `❌ [PUSH-CHANNEX] ${prop.name} — error`,
            result.rates.error || result.restrictions.error || 'unknown',
          );
          return res.status(500).json({ error: "L'envoi des tarifs a échoué." });
        }

        // Defensive: skipped statuses should have been pre-empted by route guards above
        if (result.status === PUBLISH_STATUS.SKIPPED_EXTERNAL) {
          return res.status(400).json({
            error: 'Les tarifs de ce logement sont pilotés par un outil externe.',
          });
        }
        if (result.status === PUBLISH_STATUS.SKIPPED_CHANNEX_DISABLED ||
            result.status === PUBLISH_STATUS.SKIPPED_MISSING_IDS) {
          return res.status(400).json({
            error: "Ce logement n'est pas configuré pour la diffusion",
          });
        }
        if (result.status === PUBLISH_STATUS.SKIPPED_NOT_FOUND) {
          return res.status(404).json({ error: 'Logement introuvable' });
        }

        return res.status(500).json({ error: 'Statut inattendu.' });

      } catch (err) {
        console.error('❌ [PUSH-CHANNEX] POST /api/pricing/rules/push-channex:', err.message);
        res.status(500).json({ error: "L'envoi des tarifs a échoué." });
      }
    },
  );

  console.log('✅ [PUSH-CHANNEX] Route pricing rules push montée');
};

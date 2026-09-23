/* ============================================================
   routes/pricing-diffusion-sync.js — P0-C4.5-B
   POST /api/diffusion/sync-all

   Remplace l'ancienne logique inline de server.js (lignes ~38299–38401).

   ── CE QUE FAIT CETTE ROUTE ─────────────────────────────────
   Pour chaque logement Channex activé de l'utilisateur :
     1. triggerChannexAvailabilitySync(prop.id)  — inchangé
     2. publishEffectivePricing(...)             — remplace le moteur legacy

   La réponse immédiate { message, count } est renvoyée AVANT le
   démarrage du traitement arrière-plan (comportement iOS conservé).

   ── CE QU'ELLE REMPLACE ─────────────────────────────────────
   Ancienne logique arrière-plan :
     - moteur de prix local (period/weekday/base/weekend) — SUPPRIMÉ
     - pushRestrictions avec rate embedded              — SUPPRIMÉ
     - pas de pricing_overrides                         — CORRIGÉ
     - pas de BoostPrice                                — CORRIGÉ
     - pas de plans majorés                             — CORRIGÉ (via pushRates)

   ── MONTAGE (server.js) ─────────────────────────────────────
   require('./routes/pricing-diffusion-sync')(app, pool, {
     authenticateAny,
     getRealUserId,
     getAgencyUserIds,
     triggerChannexAvailabilitySync,
   });
   ============================================================ */

'use strict';

module.exports = function monterRouteDiffusionSync(app, pool, middlewares, deps = {}) {
  const {
    authenticateAny,
    getRealUserId,
    getAgencyUserIds,
    triggerChannexAvailabilitySync,
  } = middlewares;

  const { publishEffectivePricing: _pub } = require('./pricing-publisher');
  const { addDays } = require('./effective-pricing-resolver');
  const publish = deps.publisher || _pub;
  const availabilitySync = deps.triggerChannexAvailabilitySync || triggerChannexAvailabilitySync;
  // loopDelayMs: injectable for tests (0 = no throttle); production default = 1000ms
  const loopDelayMs = deps.loopDelayMs !== undefined ? deps.loopDelayMs : 1000;

  app.post(
    '/api/diffusion/sync-all',
    authenticateAny,
    async (req, res) => {
      try {
        // ── 1. Auth / scope ──────────────────────────────────────────────────
        const userId = req.user.isSubAccount
          ? (await getRealUserId(pool, req))
          : (req.user?.id || req.user?.userId);
        const agencyIds = await getAgencyUserIds(req, userId);

        // ── 2. Fetch all Channex-enabled properties in scope ─────────────────
        // user_id added (required for canonical publisher call below)
        const propsResult = await pool.query(
          `SELECT id, user_id, channex_property_id, channex_room_type_id, channex_rate_plan_id
             FROM properties
            WHERE user_id = ANY($1::text[])
              AND channex_enabled = TRUE
              AND channex_property_id IS NOT NULL`,
          [agencyIds],
        );
        const properties = propsResult.rows;

        // ── 3. Immediate response (before background work starts) ────────────
        // iOS decodes { message: String?, count: Int? } — keep this shape.
        res.json({
          message: `Synchronisation démarrée pour ${properties.length} logements`,
          count:   properties.length,
        });

        // ── 4. Background processing — one property at a time ────────────────
        // Errors are isolated per property; one failure does not stop the loop.
        (async () => {
          // UTC noon avoids DST skew when converting to YYYY-MM-DD
          const d0 = new Date();
          d0.setHours(12, 0, 0, 0);
          const startDate = d0.toISOString().slice(0, 10);
          const endDate   = addDays(startDate, 500);  // exclusive — exactly 500 nights

          for (const prop of properties) {
            try {
              // Step 1 — Availability (unchanged — must NOT go through publisher)
              await availabilitySync(prop.id);

              // Step 2 — Pricing + restrictions via central publisher
              // userId = prop.user_id (canonical pricing owner, not caller)
              // stopSellMode 'true_only': send stop_sell:true when a rule covers
              //   the date; field absent otherwise (historical PATH 6 behaviour).
              const result = await publish(pool, {
                propertyId:   prop.id,
                userId:       prop.user_id,
                startDate,
                endDate,
                reason:       'sync_all',
                stopSellMode: 'true_only',
              });

              console.log(
                `✅ [SYNC-ALL] ${prop.id} OK — status:${result.status}` +
                ` rates:${result.rates.pushed} restr:${result.restrictions.pushed}`,
              );
            } catch (e) {
              console.error(`❌ [SYNC-ALL] ${prop.id}:`, e.message);
            }

            await new Promise(r => setTimeout(r, loopDelayMs));
          }

          console.log(`✅ [SYNC-ALL] Terminé — ${properties.length} logements synchronisés`);
        })();

      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    },
  );

  console.log('✅ [SYNC-ALL] Route diffusion sync montée');
};

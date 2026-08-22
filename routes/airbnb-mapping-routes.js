/* ============================================================
   routes/airbnb-mapping-routes.js
   Mapper un logement sur son annonce Airbnb
   ============================================================
   MONTAGE — une ligne dans server.js :

     require('./routes/airbnb-mapping-routes')(app, pool, { authenticateAny, getRealUserId });

   ── LE PROBLÈME ──────────────────────────────────────────────────
   Airbnb ne mappe pas par code de chambre comme Booking, mais par
   listing_id — l'identifiant de l'annonce. Un logement dont le plan
   tarifaire n'apparaît dans aucune entrée du canal est « connecté »
   sans rien synchroniser : c'est le cas de SG Étage.

   ── DEUX ROUTES ──────────────────────────────────────────────────
     GET  /api/properties/:id/airbnb-listings
          Les annonces qu'Airbnb expose au canal, et celles déjà prises
          par un autre logement. Sert à identifier la bonne.

     POST /api/properties/:id/airbnb-map   { listing_id }
          Ajoute l'entrée manquante dans le canal Airbnb, en laissant
          les entrées existantes intactes.

   ── PRUDENCE ─────────────────────────────────────────────────────
   Channex n'expose pas de point d'entrée documenté et stable pour
   lister les annonces d'un canal Airbnb. La route d'inventaire essaie
   plusieurs chemins plausibles et dit lequel a répondu : c'est un
   diagnostic, pas une promesse. Si aucun ne répond, le listing_id se
   lit dans l'URL de l'annonce Airbnb (airbnb.fr/rooms/LISTING_ID) et
   se passe directement à la seconde route.
   ============================================================ */

'use strict';

const { channexAPI, logChannex } = require('../channex');

const CANAUX_AIRBNB = ['airbnb', 'abb'];

function estAirbnb(attrs) {
  const v = String(attrs.channel || attrs.title || '').toLowerCase().replace(/[^a-z]/g, '');
  return CANAUX_AIRBNB.some((c) => v.indexOf(c) > -1);
}

module.exports = function monterRoutesAirbnb(app, pool, deps) {
  const auth = typeof deps === 'function'
    ? deps
    : (deps && (deps.authenticateAny || deps.auth)) || ((req, res, next) => next());
  const getRealUserId = deps && typeof deps.getRealUserId === 'function' ? deps.getRealUserId : null;

  async function resoudreUid(req) {
    if (getRealUserId) {
      try { const uid = await getRealUserId(pool, req); if (uid) return uid; } catch (e) {}
    }
    return req.user && (req.user.id || req.user.userId);
  }

  async function contexte(req, res) {
    const uid = await resoudreUid(req);
    const { rows } = await pool.query(
      `SELECT id, name, internal_name, channex_property_id, channex_room_type_id, channex_rate_plan_id
         FROM properties WHERE id = $1 AND user_id = $2`,
      [req.params.id, uid]
    );
    if (!rows.length) { res.status(404).json({ error: 'Logement introuvable' }); return null; }
    const p = rows[0];
    if (!p.channex_property_id) { res.status(400).json({ error: 'Logement non connecté à Channex' }); return null; }

    // Le canal Airbnb qui couvre ce logement.
    const liste = await channexAPI.get('/channels', {
      params: { 'filter[property_id]': p.channex_property_id, 'pagination[page_size]': 100 }
    });
    const sommaire = liste.data?.data || [];
    let canal = null;
    for (const c of sommaire) {
      let attrs = c.attributes || {};
      if (!estAirbnb(attrs)) continue;
      try {
        const d = await channexAPI.get(`/channels/${c.id}`);
        attrs = d.data?.data?.attributes || attrs;
      } catch (e) {}
      canal = { id: c.id, attrs };
      break;
    }
    if (!canal) { res.status(404).json({ error: 'Aucun canal Airbnb sur ce logement' }); return null; }
    return { uid, p, canal };
  }

  /* ── Inventaire des annonces ───────────────────────────────────── */
  app.get('/api/properties/:id/airbnb-listings', auth, async (req, res) => {
    try {
      const ctx = await contexte(req, res);
      if (!ctx) return;
      const { p, canal } = ctx;

      const entrees = Array.isArray(canal.attrs.rate_plans) ? canal.attrs.rate_plans : [];
      const prises = entrees.map((e) => ({
        listing_id: e.settings && e.settings.listing_id,
        rate_plan_id: e.rate_plan_id,
        est_ce_logement: e.rate_plan_id === p.channex_rate_plan_id
      }));

      // Channex ne documente pas de route stable pour l'inventaire : on essaie.
      const tentatives = [
        `/channels/${canal.id}/listings`,
        `/channels/${canal.id}/available_listings`,
        `/listings?filter[channel_id]=${canal.id}`
      ];
      let inventaire = null;
      let chemin_qui_repond = null;
      for (const url of tentatives) {
        try {
          const r = await channexAPI.get(url);
          inventaire = r.data?.data || r.data;
          chemin_qui_repond = url;
          break;
        } catch (e) { /* on passe au suivant */ }
      }

      res.json({
        logement: p.internal_name || p.name,
        canal_id: canal.id,
        notre_plan_standard: p.channex_rate_plan_id,
        deja_mappe: prises.some((x) => x.est_ce_logement),
        annonces_prises: prises,
        chemin_qui_repond,
        inventaire,
        aide: chemin_qui_repond
          ? 'Comparez l\'inventaire aux annonces déjà prises : celle qui reste est probablement la vôtre.'
          : 'Aucun inventaire disponible via l\'API. Ouvrez l\'annonce sur airbnb.fr : le numéro dans l\'URL /rooms/NUMERO est le listing_id.'
      });
    } catch (e) {
      console.error('❌ [AIRBNB] listings:', e.response?.data || e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /* ── Ajout de l'entrée manquante ───────────────────────────────── */
  app.post('/api/properties/:id/airbnb-map', auth, async (req, res) => {
    try {
      const ctx = await contexte(req, res);
      if (!ctx) return;
      const { uid, p, canal } = ctx;

      const listing_id = String(req.body.listing_id || '').trim();
      if (!/^\d{6,}$/.test(listing_id)) {
        return res.status(400).json({ error: 'listing_id attendu : le numéro de l\'URL Airbnb /rooms/…' });
      }
      if (!p.channex_rate_plan_id) {
        return res.status(400).json({ error: 'Ce logement n\'a pas de plan tarifaire Channex' });
      }

      const entrees = Array.isArray(canal.attrs.rate_plans) ? canal.attrs.rate_plans.slice() : [];

      // Refus net plutôt que doublon : une annonce déjà prise par un autre
      // logement signifie qu'on s'est trompé de numéro.
      const conflit = entrees.find((e) => e.settings && String(e.settings.listing_id) === listing_id
        && e.rate_plan_id !== p.channex_rate_plan_id);
      if (conflit) {
        return res.status(409).json({
          error: 'Cette annonce est déjà mappée sur un autre logement.',
          rate_plan_id_existant: conflit.rate_plan_id
        });
      }

      const deja = entrees.find((e) => e.rate_plan_id === p.channex_rate_plan_id);
      if (deja) {
        return res.json({ deja_mappe: true, listing_id: deja.settings && deja.settings.listing_id });
      }

      // Une entrée neuve : pas d'id (c'est Channex qui l'attribue), le
      // minimum de settings, et notre plan tarifaire.
      entrees.push({
        rate_plan_id: p.channex_rate_plan_id,
        settings: { listing_id: listing_id, published: true, primary_occ: true }
      });

      await channexAPI.put(`/channels/${canal.id}`, { channel: { rate_plans: entrees } });

      await logChannex(pool, {
        user_id: uid, property_id: p.id, channex_property_id: p.channex_property_id,
        event_type: 'map_airbnb_listing',
        direction: 'outbound',
        payload: { listing_id, rate_plan_id: p.channex_rate_plan_id }
      });

      console.log(`✅ [AIRBNB] ${p.internal_name || p.name} mappé sur l'annonce ${listing_id}`);
      res.json({ mappe: true, listing_id, rate_plan_id: p.channex_rate_plan_id });
    } catch (e) {
      const d = e.response?.data || e.message;
      console.error('❌ [AIRBNB] map:', d);
      res.status(500).json({ error: typeof d === 'string' ? d : JSON.stringify(d) });
    }
  });

  console.log('✅ [AIRBNB] Routes de mapping des annonces montées');
};

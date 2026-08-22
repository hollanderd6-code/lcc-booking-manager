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

      /* Chaque annonce pointe vers un plan tarifaire. On regarde à quel
         logement ce plan appartient VRAIMENT, chez nous : une annonce dont
         le plan ne correspond à aucun logement est restée accrochée à un
         ancien établissement — le cas typique d'un logement détaché puis
         rattaché ailleurs. C'est celle-là qu'il faut réaffecter. */
      const prises = [];
      for (const e of entrees) {
        const rp = e.rate_plan_id;
        const { rows: prop } = await pool.query(
          `SELECT id, name, internal_name FROM properties
            WHERE channex_rate_plan_id = $1 AND user_id = $2 LIMIT 1`,
          [rp, ctx.uid]
        );
        prises.push({
          listing_id: e.settings && e.settings.listing_id,
          rate_plan_id: rp,
          est_ce_logement: rp === p.channex_rate_plan_id,
          appartient_a: prop.length ? (prop[0].internal_name || prop[0].name) : null,
          orphelin: prop.length === 0
        });
      }

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

      const orphelines = prises.filter((x) => x.orphelin);
      res.json({
        logement: p.internal_name || p.name,
        canal_id: canal.id,
        notre_plan_standard: p.channex_rate_plan_id,
        deja_mappe: prises.some((x) => x.est_ce_logement),
        annonces_prises: prises,
        chemin_qui_repond,
        inventaire,
        aide: prises.some((x) => x.est_ce_logement)
          ? 'Ce logement est déjà mappé sur son annonce.'
          : orphelines.length === 1
            ? 'L\'annonce ' + orphelines[0].listing_id + ' pointe vers un plan tarifaire ' +
              'qui n\'appartient à aucun de vos logements : elle est restée accrochée à un ancien ' +
              'établissement. Réaffectez-la avec { listing_id, reassigner: true }.'
            : chemin_qui_repond
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
      const reassigner = req.body.reassigner === true;
      const supprimer = req.body.supprimer === true;

      const existante = entrees.find((e) => e.settings && String(e.settings.listing_id) === listing_id);

      /* Suppression de l'entrée ───────────────────────────────────
         Quand l'établissement d'origine a été supprimé, l'entrée reste dans
         le canal avec un rate_plan_id qui ne pointe plus vers rien. Elle
         retient l'annonce et bloque tout remappage. La modifier ne sert à
         rien : il faut la retirer, puis la recréer proprement. */
      if (supprimer) {
        if (!existante) return res.json({ supprime: false, raison: 'entree_absente' });

        const restantes = entrees.filter((e) => e !== existante);
        await channexAPI.put(`/channels/${canal.id}`, { channel: { rate_plans: restantes } });

        // Channex annule parfois en silence : on relît pour le savoir.
        let parti = false;
        try {
          const relu = await channexAPI.get(`/channels/${canal.id}`);
          const apres = relu.data?.data?.attributes?.rate_plans || [];
          parti = !apres.some((e) => e.settings && String(e.settings.listing_id) === listing_id);
        } catch (e) { parti = true; }

        if (!parti) {
          return res.status(409).json({
            supprime: false,
            error: 'Channex a refusé la suppression de cette entrée. L\'annonce est probablement ' +
                   'retenue côté Airbnb par un autre gestionnaire de canaux : déconnectez-la dans ' +
                   'votre espace hôte Airbnb, section des logiciels connectés.'
          });
        }

        await logChannex(pool, {
          user_id: uid, property_id: p.id, channex_property_id: p.channex_property_id,
          event_type: 'unmap_airbnb_listing',
          direction: 'outbound',
          payload: { listing_id, ancien_plan: existante.rate_plan_id }
        });
        console.log(`✅ [AIRBNB] Entrée morte de l'annonce ${listing_id} retirée du canal`);
        return res.json({ supprime: true, listing_id, ancien_plan: existante.rate_plan_id,
          suite: 'Relancez la même commande sans supprimer pour la mapper sur ce logement.' });
      }

      /* Annonce déjà prise. Deux situations très différentes :
         — elle pointe vers un autre de VOS logements : c'est une erreur de
           numéro, on refuse ;
         — elle pointe vers un plan orphelin (ancien établissement) : c'est
           précisément le cas à réparer, sur demande explicite. */
      if (existante && existante.rate_plan_id !== p.channex_rate_plan_id) {
        const { rows: autre } = await pool.query(
          `SELECT id, name, internal_name FROM properties
            WHERE channex_rate_plan_id = $1 AND user_id = $2 LIMIT 1`,
          [existante.rate_plan_id, uid]
        );

        if (autre.length) {
          return res.status(409).json({
            error: 'Cette annonce est déjà mappée sur ' + (autre[0].internal_name || autre[0].name) + '.',
            rate_plan_id_existant: existante.rate_plan_id
          });
        }

        if (!reassigner) {
          return res.status(409).json({
            error: 'Cette annonce pointe vers un plan tarifaire orphelin, hérité d\'un ancien ' +
                   'établissement. Relancez avec reassigner: true pour la rattacher à ce logement.',
            rate_plan_id_orphelin: existante.rate_plan_id,
            orphelin: true
          });
        }

        // Réaffectation : seul rate_plan_id change, les réglages Airbnb de
        // l'annonce (tarifs, règles, promotions) sont conservés tels quels.
        const nouvelles = entrees.map((e) =>
          (e.settings && String(e.settings.listing_id) === listing_id)
            ? Object.assign({}, e, { rate_plan_id: p.channex_rate_plan_id })
            : e
        );

        await channexAPI.put(`/channels/${canal.id}`, { channel: { rate_plans: nouvelles } });
        await logChannex(pool, {
          user_id: uid, property_id: p.id, channex_property_id: p.channex_property_id,
          event_type: 'reassign_airbnb_listing',
          direction: 'outbound',
          payload: { listing_id, avant: existante.rate_plan_id, apres: p.channex_rate_plan_id }
        });
        console.log(`✅ [AIRBNB] Annonce ${listing_id} réaffectée à ${p.internal_name || p.name}`);
        return res.json({ reassigne: true, listing_id, ancien_plan: existante.rate_plan_id,
          rate_plan_id: p.channex_rate_plan_id });
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

  /* ── Où est cette annonce, dans tout le compte ? ──────────────────
     Quand une annonce refuse d'être librée, c'est souvent qu'une AUTRE
     connexion Airbnb du même compte Channex la détient — un canal rattaché
     à un autre établissement, invisible depuis la fenêtre du logement.
     Cette route balaie tous les canaux du compte pour la retrouver. */
  app.get('/api/channex/find-listing/:listing_id', auth, async (req, res) => {
    try {
      const cible = String(req.params.listing_id || '').trim();

      /* Channex ignore parfois page_size et s'en tient à sa page par défaut :
         une recherche non paginée conclut à tort que l'annonce est absente.
         On parcourt donc les pages jusqu'à épuisement. */
      const sommaire = [];
      for (let page = 1; page <= 20; page++) {
        const r = await channexAPI.get('/channels', {
          params: { 'pagination[page]': page, 'pagination[limit]': 100 }
        });
        const lot = r.data?.data || [];
        if (!Array.isArray(lot) || !lot.length) break;
        sommaire.push(...lot);
        const meta = r.data?.meta;
        const total = meta && (meta.total_pages || (meta.pagination && meta.pagination.total_pages));
        if (total && page >= total) break;
        if (lot.length < 10) break;   // page incomplète : c'est la dernière
      }

      const trouvailles = [];
      const canaux = [];

      for (const c of (Array.isArray(sommaire) ? sommaire : [])) {
        let attrs = c.attributes || {};
        try {
          const d = await channexAPI.get(`/channels/${c.id}`);
          attrs = d.data?.data?.attributes || attrs;
        } catch (e) {}

        canaux.push({
          id: c.id,
          canal: attrs.channel || null,
          titre: attrs.title || null,
          actif: attrs.is_active !== false,
          etablissements: attrs.properties || [],
          nb_entrees: Array.isArray(attrs.rate_plans) ? attrs.rate_plans.length : 0
        });

        const entrees = Array.isArray(attrs.rate_plans) ? attrs.rate_plans : [];
        for (const e of entrees) {
          const lid = e.settings && String(e.settings.listing_id || e.settings.room_type_code || '');
          if (lid === cible) {
            trouvailles.push({
              canal_id: c.id,
              canal: attrs.channel || null,
              titre: attrs.title || null,
              actif: attrs.is_active !== false,
              etablissements: attrs.properties || [],
              entree_id: e.id,
              rate_plan_id: e.rate_plan_id
            });
          }
        }
      }

      res.json({
        listing_id: cible,
        canaux_parcourus: canaux.length,
        trouve_dans: trouvailles,
        tous_les_canaux: canaux,
        aide: trouvailles.length > 1
          ? 'Cette annonce est déclarée dans plusieurs canaux : c\'est la cause du verrou. ' +
            'Il faut la retirer de tous sauf celui du bon établissement.'
          : trouvailles.length === 1
            ? 'Un seul canal la détient. Si le verrou persiste, il vient d\'Airbnb : ' +
              'déconnectez le logiciel dans votre espace hôte.'
            : 'Aucun canal de ce compte ne la déclare — elle est reliée à un autre compte Channex ou à un autre gestionnaire.'
      });
    } catch (e) {
      const d = e.response?.data || e.message;
      console.error('❌ [AIRBNB] find-listing:', d);
      res.status(500).json({ error: typeof d === 'string' ? d : JSON.stringify(d) });
    }
  });

  console.log('✅ [AIRBNB] Routes de mapping des annonces montées');
};

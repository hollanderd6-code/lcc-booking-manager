/* ============================================================
   routes/inventaire-channex-routes.js
   Ce qui existe chez Channex, et ce qui sert vraiment
   ============================================================
   MONTAGE — une ligne dans server.js :

     require('./routes/inventaire-channex-routes')(app, pool, { authenticateAny, getRealUserId });

   ── POURQUOI UN INVENTAIRE, ET PAS UN NETTOYAGE ──────────────────
   Un etablissement ou un canal « qui a l'air mort » ne l'est pas
   toujours. Un canal nomme « New AirBNB Channel » peut etre actif et
   porter deux annonces qui synchronisent tous les jours : le supprimer
   au nom casserait une connexion qui fonctionne.

   Cette route ne supprime rien. Elle croise ce que Channex contient
   avec ce que la base utilise, et classe chaque objet :

     utilise      : un logement du parc s'appuie dessus.
     inactif_vide : canal desactive et sans aucun mapping. Sans effet.
     sans_usage   : rien dans la base ne le reference — candidat au
                    nettoyage, A VERIFIER avant de supprimer (une
                    reservation a venir, un logement d'un autre compte).

   La suppression reste manuelle, dans Channex. C'est un acte
   irreversible : il n'a pas sa place derriere un appel automatique.
   ============================================================ */

'use strict';

const { channexAPI } = require('../channex');
const { idsAccessibles } = require('../acces-logement');

async function toutesLesPages(url, params) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await channexAPI.get(url, {
      params: Object.assign({}, params, { 'pagination[page]': page, 'pagination[limit]': 100 })
    });
    const lot = r.data?.data || [];
    if (!Array.isArray(lot) || !lot.length) break;
    out.push(...lot);
    const meta = r.data?.meta;
    const total = meta && (meta.total_pages || (meta.pagination && meta.pagination.total_pages));
    if (total && page >= total) break;
    if (lot.length < 10) break;
  }
  return out;
}

module.exports = function monterInventaire(app, pool, deps) {
  const auth = typeof deps === 'function'
    ? deps
    : (deps && (deps.authenticateAny || deps.auth)) || ((req, res, next) => next());
  const getRealUserId = deps && typeof deps.getRealUserId === 'function' ? deps.getRealUserId : null;

  app.get('/api/channex/inventaire', auth, async (req, res) => {
    try {
      const ids = await idsAccessibles(pool, req, getRealUserId);
      if (!ids.length) return res.status(403).json({ error: 'Compte inconnu' });

      const { rows: parc } = await pool.query(
        `SELECT id, name, internal_name, channex_property_id, channex_rate_plan_id,
                COALESCE(channex_markup_rate_plans, '{}'::jsonb) AS plans
           FROM properties
          WHERE user_id = ANY($1) AND channex_property_id IS NOT NULL`,
        [ids]
      );

      /* La clé API Channex est unique pour toute la plateforme : /properties
         renvoie les établissements de TOUS les comptes. Juger « sans usage »
         sur le seul parc du compte courant désignerait les logements des
         autres clients comme supprimables. Le critère de sûreté doit donc
         porter sur la base entière — sans exposer pour autant à qui ils sont. */
      const { rows: toutLeMonde } = await pool.query(
        `SELECT channex_property_id, channex_rate_plan_id,
                COALESCE(channex_markup_rate_plans, '{}'::jsonb) AS plans
           FROM properties WHERE channex_property_id IS NOT NULL`
      );

      const etabPlateforme = new Set();
      const plansPlateforme = new Set();
      toutLeMonde.forEach((p) => {
        etabPlateforme.add(p.channex_property_id);
        if (p.channex_rate_plan_id) plansPlateforme.add(p.channex_rate_plan_id);
        Object.values(p.plans || {}).forEach((rp) => plansPlateforme.add(rp));
      });

      const etabUtilises = new Map();   // channex_property_id -> [noms]
      const plansUtilises = new Set();
      parc.forEach((p) => {
        const nom = p.internal_name || p.name;
        if (!etabUtilises.has(p.channex_property_id)) etabUtilises.set(p.channex_property_id, []);
        etabUtilises.get(p.channex_property_id).push(nom);
        if (p.channex_rate_plan_id) plansUtilises.add(p.channex_rate_plan_id);
        Object.values(p.plans || {}).forEach((rp) => plansUtilises.add(rp));
      });

      const etablissements = await toutesLesPages('/properties');
      const canaux = await toutesLesPages('/channels');

      const rapportEtabs = etablissements.map((e) => {
        const a = e.attributes || {};
        const noms = etabUtilises.get(e.id) || [];
        const ailleurs = !noms.length && etabPlateforme.has(e.id);
        return {
          id: e.id,
          titre: a.title || null,
          logements_du_parc: noms,
          statut: noms.length ? 'utilise'
            : ailleurs ? 'utilise_autre_compte'   // ne pas y toucher
            : 'sans_usage'
        };
      });

      const rapportCanaux = [];
      for (const c of canaux) {
        let a = c.attributes || {};
        try {
          const d = await channexAPI.get(`/channels/${c.id}`);
          a = d.data?.data?.attributes || a;
        } catch (e) {}

        const entrees = Array.isArray(a.rate_plans) ? a.rate_plans : [];
        const actif = a.is_active !== false;
        const nosEntrees = entrees.filter((x) => plansUtilises.has(x.rate_plan_id));
        const entreesPlateforme = entrees.filter((x) => plansPlateforme.has(x.rate_plan_id));
        const etabs = a.properties || [];
        const etabsDuParc = etabs.filter((x) => etabUtilises.has(x));
        const etabsPlateforme = etabs.filter((x) => etabPlateforme.has(x));

        let statut;
        if (nosEntrees.length) statut = 'utilise';
        else if (entreesPlateforme.length || etabsPlateforme.length) statut = 'utilise_autre_compte';
        else if (!actif && !entrees.length) statut = 'inactif_vide';
        else if (!etabsDuParc.length) statut = 'sans_usage';
        else statut = 'a_verifier';   // etablissement du parc, mais aucun mapping reconnu

        rapportCanaux.push({
          id: c.id,
          canal: a.channel || null,
          titre: a.title || null,
          actif,
          nb_entrees: entrees.length,
          entrees_du_parc: nosEntrees.length,
          etablissements_du_parc: etabsDuParc.map((x) => (etabUtilises.get(x) || []).join(', ')),
          statut
        });
      }

      const aNettoyer = []
        .concat(rapportEtabs.filter((x) => x.statut === 'sans_usage')
          .map((x) => 'Établissement « ' + (x.titre || x.id) + ' » (' + x.id + ') : aucun logement du parc.'))
        .concat(rapportCanaux.filter((x) => x.statut === 'inactif_vide' || x.statut === 'sans_usage')
          .map((x) => 'Canal ' + (x.canal || '?') + ' « ' + (x.titre || x.id) + ' » (' + x.id + ') : ' +
            (x.statut === 'inactif_vide' ? 'désactivé et vide.' : 'aucun établissement du parc.')));

      res.json({
        logements_connectes: parc.length,
        etablissements: rapportEtabs,
        canaux: rapportCanaux,
        candidats_au_nettoyage: aNettoyer,
        a_verifier: rapportCanaux.filter((x) => x.statut === 'a_verifier')
          .map((x) => 'Canal ' + (x.canal || '?') + ' « ' + (x.titre || x.id) + ' » porte un établissement du parc ' +
            'mais aucun mapping reconnu : mapping à faire, ou fait sur un ancien plan.'),
        avertissement: 'Cette route ne supprime rien. « sans_usage » signifie : aucun logement de ' +
          'la base entière ne s\'appuie dessus. Vérifiez tout de même les réservations à venir dans ' +
          'Channex avant de supprimer. Les objets marqués « utilise_autre_compte » appartiennent à ' +
          'un autre compte de la plateforme : n\'y touchez pas.'
      });
    } catch (e) {
      const d = e.response?.data || e.message;
      console.error('❌ [INVENTAIRE]', d);
      res.status(500).json({ error: typeof d === 'string' ? d : JSON.stringify(d) });
    }
  });

  console.log('✅ [INVENTAIRE] Route d\'inventaire Channex montée');
};

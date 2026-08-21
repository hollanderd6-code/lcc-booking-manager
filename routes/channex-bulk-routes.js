// ============================================================================
// channex-bulk-routes.js — préparer plusieurs logements en un seul passage
// ============================================================================
// À placer dans routes/ et à monter dans server.js, après la définition de
// `pool` et l'import de sub-accounts-middleware :
//
//   const channexBulkRoutes = require('./routes/channex-bulk-routes');
//   app.use('/api/channex', channexBulkRoutes(pool, { authenticateAny, getRealUserId }));
//
// Deux routes, aucune dépendance nouvelle :
//
//   GET  /api/channex/bulk-status
//        → l'état de tous les logements du compte : qui est déjà dans Channex,
//          qui doit encore l'être, et quels logements partagent une adresse.
//
//   POST /api/channex/bulk-prepare   { property_ids: [...] }
//        → crée l'établissement Channex de chaque logement demandé, en
//          regroupant automatiquement par adresse : le premier logement d'une
//          adresse crée l'établissement, les suivants y sont rattachés comme
//          room types. C'est exactement le travail qui, aujourd'hui, oblige
//          l'utilisateur à répéter la même modale logement par logement.
//
// Ce qui reste manuel : l'autorisation OAuth Airbnb et le mapping Booking.com,
// qui passent par la fenêtre Channex. Mais après bulk-prepare il n'y a plus
// qu'UNE autorisation par établissement au lieu d'une par logement.
// ============================================================================

const { createChannexProperty, addRoomTypeToProperty } = require('../channex');

function normAdresse(a) {
  return String(a || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

module.exports = function (pool, deps) {
  const express = require('express');
  const router = express.Router();
  const auth = (deps && deps.authenticateAny) || ((req, res, next) => next());
  const userId = (deps && deps.getRealUserId) || ((req) => req.user && req.user.id);

  async function chargerLogements(uid) {
    const { rows } = await pool.query(
      `SELECT id, name, internal_name, address, city,
              channex_enabled, channex_property_id, channex_room_type_id
         FROM properties
        WHERE user_id = $1
        ORDER BY name ASC`,
      [uid]
    );
    return rows;
  }

  router.get('/bulk-status', auth, async (req, res) => {
    try {
      const logements = await chargerLogements(userId(req));
      const parAdresse = {};
      logements.forEach((l) => {
        const k = normAdresse(l.address);
        if (!k) return;
        (parAdresse[k] = parAdresse[k] || []).push(l.name);
      });
      res.json({
        total: logements.length,
        prets: logements.filter((l) => l.channex_enabled && l.channex_property_id).length,
        a_preparer: logements
          .filter((l) => !(l.channex_enabled && l.channex_property_id))
          .map((l) => ({
            id: l.id,
            name: l.internal_name || l.name,
            address: l.address || null,
            sans_adresse: !normAdresse(l.address),
            immeuble: (parAdresse[normAdresse(l.address)] || []).length > 1
          })),
        immeubles: Object.values(parAdresse).filter((g) => g.length > 1)
      });
    } catch (e) {
      console.error('❌ [CHANNEX BULK] bulk-status:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/bulk-prepare', auth, async (req, res) => {
    const uid = userId(req);
    const demandes = Array.isArray(req.body && req.body.property_ids) ? req.body.property_ids : null;

    try {
      const logements = await chargerLogements(uid);
      const cibles = logements.filter(
        (l) => !(l.channex_enabled && l.channex_property_id) &&
               (!demandes || demandes.indexOf(l.id) > -1 || demandes.indexOf(String(l.id)) > -1)
      );

      // Établissements déjà existants, par adresse : on s'y rattache au lieu
      // de créer un doublon.
      const etablissements = {};
      logements
        .filter((l) => l.channex_property_id)
        .forEach((l) => {
          const k = normAdresse(l.address);
          if (k && !etablissements[k]) etablissements[k] = l.channex_property_id;
        });

      const resultats = [];

      for (const l of cibles) {
        const nom = l.internal_name || l.name;
        const cle = normAdresse(l.address);
        try {
          let r;
          if (cle && etablissements[cle]) {
            r = await addRoomTypeToProperty(pool, {
              user_id: uid,
              property_id: l.id,
              channex_property_id: etablissements[cle],
              name: nom
            });
            resultats.push({ id: l.id, name: nom, statut: 'rattache', channex_property_id: r.channex_property_id });
          } else {
            r = await createChannexProperty(pool, {
              user_id: uid,
              property_id: l.id,
              name: nom,
              address: l.address,
              city: l.city
            });
            if (cle) etablissements[cle] = r.channex_property_id;
            resultats.push({ id: l.id, name: nom, statut: 'cree', channex_property_id: r.channex_property_id });
          }
        } catch (e) {
          const detail = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
          console.error(`❌ [CHANNEX BULK] ${nom}:`, detail);
          resultats.push({ id: l.id, name: nom, statut: 'erreur', erreur: detail });
        }
      }

      // Un établissement = une autorisation à donner dans la fenêtre Channex.
      const etablissementsTouches = [];
      resultats.forEach((r) => {
        if (r.channex_property_id && etablissementsTouches.indexOf(r.channex_property_id) === -1) {
          etablissementsTouches.push(r.channex_property_id);
        }
      });

      res.json({
        traites: resultats.length,
        crees: resultats.filter((r) => r.statut === 'cree').length,
        rattaches: resultats.filter((r) => r.statut === 'rattache').length,
        erreurs: resultats.filter((r) => r.statut === 'erreur'),
        autorisations_restantes: etablissementsTouches.length,
        resultats
      });
    } catch (e) {
      console.error('❌ [CHANNEX BULK] bulk-prepare:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};

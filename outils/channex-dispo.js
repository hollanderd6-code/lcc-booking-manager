#!/usr/bin/env node
/* ============================================================
   outils/channex-dispo.js
   Ce que l'API Channex dit de la disponibilite, en lecture seule
   ============================================================
   Ne touche ni a votre base, ni a Channex en ecriture. Un seul GET.

   ── POURQUOI ─────────────────────────────────────────────────────
   Le 30 aout a 16:40:01, votre serveur a envoye a Channex 500 dates
   dont 83 bloquees — la nuit du 15 janvier 2027 comprise — et Channex a
   repondu « success ». Six minutes plus tard, son interface affichait
   pourtant AVL = 1 sur cette nuit.

   Deux explications restent, et un GET les separe :
     · l'API dit 0 -> l'ecriture a bien pris, c'est l'AFFICHAGE de
       Channex qui etait en retard, et le vrai defaut est ailleurs
       (propagation vers Airbnb) ;
     · l'API dit 1 -> Channex a accepte un message qu'il n'a pas
       applique. Le « success » de nos logs ne vaut rien, et il faut
       verifier l'etat APRES ecriture, pas la reponse de l'appel.

   ── LA CLE ───────────────────────────────────────────────────────
   Prenez CHANNEX_API_KEY dans les variables d'environnement de votre
   hebergeur et passez-la en ligne de commande, sans l'enregistrer :

     CHANNEX_API_KEY='...' CHANNEX_ENV=production \
       node outils/channex-dispo.js 4cf40619-c03e-4103-8475-c4647ae5bffc 2027-01-14 2027-01-18

   (Le premier argument est le channex_property_id de M13, deja connu.)
   Ajoutez `unset HISTFILE` avant si l'historique du shell vous gene.
   ============================================================ */

'use strict';

const [, , propertyId, du, au] = process.argv;

if (!propertyId || !du || !au) {
  console.error('\n  Usage : node outils/channex-dispo.js <channex_property_id> <date_debut> <date_fin>');
  console.error('  Exemple : node outils/channex-dispo.js 4cf40619-c03e-4103-8475-c4647ae5bffc 2027-01-14 2027-01-18\n');
  process.exit(1);
}
if (!process.env.CHANNEX_API_KEY) {
  console.error('\n  \u2717 CHANNEX_API_KEY absente. Passez-la devant la commande.\n');
  process.exit(1);
}

const axios = require('axios');

const base = process.env.CHANNEX_ENV === 'production'
  ? 'https://app.channex.io/api/v1'
  : 'https://staging.channex.io/api/v1';

(async function () {
  console.log('\n  Environnement : ' + (process.env.CHANNEX_ENV === 'production' ? 'production' : 'staging (defaut)'));
  console.log('  ' + base + '/availability\n');

  try {
    const r = await axios.get(base + '/availability', {
      headers: { 'Content-Type': 'application/json', 'user-api-key': process.env.CHANNEX_API_KEY },
      params: {
        'filter[property_id]': propertyId,
        'filter[date][gte]': du,
        'filter[date][lte]': au
      },
      timeout: 15000
    });

    const data = (r.data && (r.data.data || r.data)) || [];
    const lignes = Array.isArray(data) ? data : [];

    if (!lignes.length) {
      console.log('  Reponse sans lignes exploitables. Brut, tronque a 1200 caracteres :\n');
      console.log('  ' + JSON.stringify(r.data).slice(0, 1200) + '\n');
      return;
    }

    lignes.forEach(l => {
      const a = l.attributes || l;
      const rt = a.room_type_id
        || (l.relationships && l.relationships.room_type && l.relationships.room_type.data && l.relationships.room_type.data.id)
        || '?';
      const dispo = a.availability != null ? a.availability : a.available_rooms;
      console.log('  ' + (a.date || '?') + '   dispo = ' + dispo
        + '   ' + (Number(dispo) === 0 ? '\u2713 bloque' : '\u2717 vendable')
        + '   room_type ' + String(rt).slice(0, 8));
    });

    console.log('\n  Rappel : la nuit du 15 janvier 2027 doit etre a 0 tant que le hold');
    console.log('  BHGuest est actif (il expirait a 20:40 UTC le 30 aout).\n');

  } catch (e) {
    const st = e.response && e.response.status;
    console.error('\n  \u2717 Appel refuse' + (st ? ' (HTTP ' + st + ')' : '') + ' : ' + e.message);
    if (e.response && e.response.data) {
      console.error('  ' + JSON.stringify(e.response.data).slice(0, 800));
    }
    console.error('\n  Un 401 signifie mauvaise cle ou mauvais environnement (CHANNEX_ENV).');
    console.error('  Un 404 signifie que ce property_id n\'existe pas dans cet environnement.\n');
    process.exit(1);
  }
})();

#!/usr/bin/env node
/* ============================================================
   outils/channex-test-blocage.js
   Une seule date, un seul POST : Channex applique-t-il ?
   ============================================================
   ⚠ CE SCRIPT ECRIT CHEZ CHANNEX. Une seule valeur, une seule date,
   celle que vous nommez. Il n'ecrit rien dans votre base.

   ── CE QU'IL DEMONTRE ────────────────────────────────────────────
   Le 30 aout, notre serveur a envoye 500 valeurs en un POST, dont la
   nuit du 15 janvier 2027 a 0. Channex a repondu « success ». Sa propre
   API repond pourtant 1 sur cette nuit.

   Deux causes possibles, et un POST a une valeur les separe :

     · apres l'envoi unitaire, l'API repond 0 -> Channex ne traite pas
       les gros lots en entier et ne le dit pas. Le correctif est de
       decouper les envois (et de RELIRE apres ecriture).

     · apres l'envoi unitaire, l'API repond encore 1 -> le format meme
       de notre requete est refuse en silence. Le correctif est ailleurs,
       et je saurai ou en lisant la reponse complete affichee ici.

   ── SEQUENCE ─────────────────────────────────────────────────────
   1. lecture avant ;  2. POST d'une valeur ;  3. reponse brute ;
   4. lecture apres.  Aucune etape n'est deduite : tout est affiche.

   Usage :
     CHANNEX_API_KEY='...' CHANNEX_ENV=production \
       node outils/channex-test-blocage.js <property_id> <room_type_id> <date> [0|1]

   Exemple (bloquer la nuit du 15 janvier sur M13) :
     ... node outils/channex-test-blocage.js \
       4cf40619-c03e-4103-8475-c4647ae5bffc \
       e0464321-aa57-4dc8-8a35-1864f9495746 2027-01-15 0

   Pour rouvrir la nuit ensuite, relancez avec 1 a la fin.
   ============================================================ */

'use strict';

const [, , propertyId, roomTypeId, date, valeurArg] = process.argv;
const valeur = valeurArg === undefined ? 0 : Number(valeurArg);

if (!propertyId || !roomTypeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || ![0, 1].includes(valeur)) {
  console.error('\n  Usage : node outils/channex-test-blocage.js <property_id> <room_type_id> <AAAA-MM-JJ> [0|1]\n');
  process.exit(1);
}
if (!process.env.CHANNEX_API_KEY) {
  console.error('\n  \u2717 CHANNEX_API_KEY absente. Passez-la devant la commande.\n');
  process.exit(1);
}

const axios = require('axios');

const api = axios.create({
  baseURL: process.env.CHANNEX_ENV === 'production'
    ? 'https://app.channex.io/api/v1'
    : 'https://staging.channex.io/api/v1',
  headers: { 'Content-Type': 'application/json', 'user-api-key': process.env.CHANNEX_API_KEY },
  timeout: 15000
});

/* Channex renvoie { data: { <room_type_id>: { "<date>": n } } }. */
function lireDispo(payload, rt, jour) {
  const d = payload && payload.data;
  if (!d || typeof d !== 'object') return undefined;
  const parRt = d[rt] || d[Object.keys(d)[0]];
  return parRt ? parRt[jour] : undefined;
}

async function etat(etiquette) {
  const r = await api.get('/availability', {
    params: {
      'filter[property_id]': propertyId,
      'filter[date][gte]': date,
      'filter[date][lte]': date
    }
  });
  const v = lireDispo(r.data, roomTypeId, date);
  console.log('  ' + etiquette + ' : ' + date + ' = ' + v
    + (Number(v) === 0 ? '   (bloque)' : '   (vendable)'));
  return v;
}

(async function () {
  console.log('\n  ' + api.defaults.baseURL);
  console.log('  Logement ' + propertyId.slice(0, 8) + '  room type ' + roomTypeId.slice(0, 8) + '\n');

  const avant = await etat('AVANT ');

  console.log('\n  POST /availability  \u2014 une seule valeur : ' + valeur);
  let reponse;
  try {
    const r = await api.post('/availability', {
      values: [{ property_id: propertyId, room_type_id: roomTypeId, date: date, availability: valeur }]
    });
    reponse = r;
    console.log('  HTTP ' + r.status + '   reponse : ' + JSON.stringify(r.data).slice(0, 600));
  } catch (e) {
    const st = e.response && e.response.status;
    console.error('\n  \u2717 POST refuse' + (st ? ' (HTTP ' + st + ')' : '') + ' : ' + e.message);
    if (e.response && e.response.data) console.error('  ' + JSON.stringify(e.response.data).slice(0, 800));
    console.error('\n  Un refus ici est une bonne nouvelle : il dit enfin pourquoi.\n');
    process.exit(1);
  }

  /* Channex applique de facon asynchrone : on laisse deux secondes. */
  await new Promise(r => setTimeout(r, 2000));
  const apres = await etat('APRES ');

  console.log('\n\u2500\u2500 VERDICT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  if (Number(apres) === valeur && Number(avant) !== valeur) {
    console.log('  \u2713 L\'envoi UNITAIRE prend effet, alors que l\'envoi de 500 valeurs');
    console.log('    n\'avait rien change. Channex ne traite donc pas nos gros lots en');
    console.log('    entier, et repond « success » quand meme.');
    console.log('    Correctif : decouper les envois par tranches, et RELIRE l\'etat');
    console.log('    apres ecriture avant d\'ecrire « bloque » dans les logs.');
  } else if (Number(apres) === Number(avant)) {
    console.log('  \u2717 Meme un envoi unitaire ne change rien, alors que le POST repond');
    console.log('    en succes. Le format de notre requete est donc ignore par Channex');
    console.log('    (champ attendu different, ou room type non pilotable en ecriture).');
    console.log('    La reponse brute ci-dessus est la piece a suivre.');
  } else {
    console.log('  Etat inattendu : avant=' + avant + ', apres=' + apres + '. A relire ensemble.');
  }
  if (valeur === 0) {
    console.log('\n  Pour rouvrir cette nuit, relancez la meme commande en terminant par 1.');
  }
  console.log('');
})();

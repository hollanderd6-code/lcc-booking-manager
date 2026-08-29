#!/usr/bin/env node
/* ============================================================
   outils/channex-canaux-par-logement.js
   Un logement affiche des plateformes qu'il n'a pas
   ============================================================
   Cible : server.js  (route GET /api/channex/connected-channels/:property_id)

   ── LE SYMPTOME ─────────────────────────────────────────────────
   « La longere numero 3 » affiche les pastilles Booking.com ET Airbnb
   alors que seul Booking a ete connecte.

   ── CE QUI A ETE ECARTE ─────────────────────────────────────────
   Le filtre Channex fonctionne : en interrogeant les 25 logements, les
   channex_property_id different bien, et M11 ne renvoie que Booking.
   L'API n'ignore donc pas filter[property_id].

   ── LA CAUSE ────────────────────────────────────────────────────
   Les longeres 2 et 3 partagent la MEME property Channex
   (6c96e777-…), parce que la 3 a ete rattachee a la 2 via le scenario
   « partie d'un immeuble » (addRoomTypeToProperty). Dans ce montage,
   une property Channex porte plusieurs room types — un par logement —
   et les canaux sont attaches a la PROPERTY, pas au room type.

   La route filtre par property. Elle renvoie donc, pour la longere 3,
   les canaux de la longere 2. C'est exact au niveau de la property et
   faux au niveau du logement.

   Le front le savait : il envoie deja bh_property_id avec ce
   commentaire — « Passer le bhPropertyId en query param pour filtrer
   par room_type cote serveur ». Le serveur ne lit jamais ce parametre.

   ── CE QUE FAIT CE CORRECTIF ────────────────────────────────────
   La route lit desormais channex_room_type_id et ne garde que les
   canaux dont la configuration mentionne CE room type.

   Comment : la reponse de Channex est inspectee a la recherche de
   l'identifiant du room type. C'est volontairement agnostique quant a
   la structure exacte des mappings — elle varie selon les canaux et
   les versions de l'API. Chercher l'identifiant dans la charge utile
   est stable la ou un chemin fige (attributes.settings.mapping[].
   room_type_id) casserait au premier changement.

   Repli explicite : si AUCUN canal ne mentionne le room type, on ne
   filtre pas. Deux situations donnent ce resultat — Channex n'inclut
   pas les mappings dans cette reponse, ou le logement n'est mappe
   nulle part — et dans les deux cas, masquer toutes les pastilles
   serait pire que d'en montrer une de trop. Le cas est journalise.

   Un logement seul dans sa property (le cas courant) n'est pas
   concerne : ses canaux sont deja les siens.

   Usage :
     node outils/channex-canaux-par-logement.js --essai
     node outils/channex-canaux-par-logement.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');
let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('canauxDuRoomType') !== -1) {
  console.log('\n  Le correctif est deja en place — rien a faire.\n');
  process.exit(0);
}

function unique(aiguille, quoi) {
  const n = src.split(aiguille).length - 1;
  if (n !== 1) echec(quoi + ' : ' + n + ' occurrence(s) au lieu d\'une. server.js a change.');
}

/* ── 1. Lire aussi le room type ── */
const A1 = `    const propResult = await pool.query(
      'SELECT channex_property_id, channex_enabled FROM properties WHERE id = $1 AND user_id = ANY($2::text[])',
      [property_id, agencyIds]
    );`;
unique(A1, 'Lecture de la property dans connected-channels');
const A1N = `    const propResult = await pool.query(
      'SELECT channex_property_id, channex_room_type_id, channex_enabled FROM properties WHERE id = $1 AND user_id = ANY($2::text[])',
      [property_id, agencyIds]
    );`;
src = src.split(A1).join(A1N);

/* ── 2. Filtrer les canaux sur ce room type ──
   On s'insere entre la recuperation des canaux et leur mise en forme. */
const A2 = `    // Si l'API Channex retourne des résultats → les utiliser
    if (channexChannels.length > 0) {`;
unique(A2, 'Debut du traitement des canaux');

const A2N = `    /* Plusieurs logements peuvent partager une meme property Channex
       (montage « immeuble » : un room type par logement). Les canaux sont
       attaches a la PROPERTY : filtrer sur elle renvoie donc les canaux des
       voisins. On ne garde que ceux qui mentionnent CE room type.

       La recherche est faite sur la charge utile entiere plutot que sur un
       chemin precis : la structure des mappings varie selon les canaux et
       les versions de l'API Channex, et un chemin fige casserait au premier
       changement. */
    const canauxDuRoomType = (liste, roomTypeId) => {
      if (!roomTypeId || !liste.length) return liste;
      const gardes = liste.filter(c => {
        try { return JSON.stringify(c).includes(roomTypeId); }
        catch (e) { return true; }   // canal illisible : on ne l'exclut pas
      });
      if (gardes.length === 0) {
        /* Aucun canal ne mentionne ce room type. Soit Channex n'inclut pas
           les mappings ici, soit le logement n'est mappe nulle part. Dans les
           deux cas on prefere afficher les canaux de la property plutot que
           rien : une pastille en trop se comprend, une liste vide inquiete. */
        console.warn(\`⚠️ [channels] \${property_id} : aucun mapping trouve pour le room type \${roomTypeId}, filtrage ignore\`);
        return liste;
      }
      if (gardes.length !== liste.length) {
        console.log(\`🔎 [channels] \${property_id} : \${liste.length} canal(aux) sur la property, \${gardes.length} pour ce logement\`);
      }
      return gardes;
    };
    channexChannels = canauxDuRoomType(channexChannels, prop.channex_room_type_id);

    // Si l'API Channex retourne des résultats → les utiliser
    if (channexChannels.length > 0) {`;
src = src.split(A2).join(A2N);

/* ---- Verifications ---- */
try { new Function(src); }
catch (e) { echec('server.js n\'est plus du JavaScript valide — ' + e.message); }

for (const [quoi, aiguille] of [
  ['la lecture du room type', 'SELECT channex_property_id, channex_room_type_id, channex_enabled FROM properties'],
  ['la fonction de filtrage', 'const canauxDuRoomType ='],
  ['son application', 'channexChannels = canauxDuRoomType(channexChannels, prop.channex_room_type_id);'],
  ['le repli sans mapping', 'filtrage ignore'],
]) if (src.indexOf(aiguille) === -1) echec('Verification : ' + quoi + ' est absent du resultat.');

if (src.split('const canauxDuRoomType =').length - 1 !== 1) echec('Le filtrage a ete insere plusieurs fois.');
/* channexChannels doit rester reassignable : declare avec let. */
if (src.indexOf('let channexChannels = [];') === -1) {
  echec('channexChannels n\'est pas declare avec « let » : la reassignation echouerait.');
}
/* Le repli sur les reservations en base doit subsister. */
if (src.indexOf('// Fallback : lire depuis les réservations en DB si Channex ne répond pas') === -1) {
  echec('Le repli sur la base de donnees a ete perdu.');
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('canauxDuRoomType') === -1) {
    echec('L\'ajout est absent apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  connected-channels ne renvoie plus que les canaux du logement,');
console.log('  et non ceux de tous les logements partageant la meme property Channex.');
console.log('');
console.log('  Redemarrez le serveur, puis rechargez Mes logements.');
console.log('  Attendu : La longere numero 3 n\'affiche plus qu\'une pastille Booking.com.');
console.log('  Les logements seuls dans leur property ne changent pas.');
console.log('');
console.log('  Surveillez la sortie du serveur : « aucun mapping trouve pour le room');
console.log('  type … , filtrage ignore » signifie que Channex n\'expose pas les');
console.log('  mappings dans cette reponse. L\'affichage reste alors celui d\'avant,');
console.log('  et il faudra interroger /channels/:id canal par canal.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

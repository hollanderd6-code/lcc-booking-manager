#!/usr/bin/env node
/* ============================================================
   Envoyer les disponibilites apres une connexion
   ============================================================
   Cible : public/js/bh-ota-connect.js

   ── LE VRAI PROBLEME, QUE LA CAPTURE BOOKING MONTRE ──────────────
   Sur Booking.com, deux logements du meme immeuble :

     Appartement 1 Chambre (900151901)  « Réservable », tarifs 75 €
     Appartement deux pièces (900151902) « Tarif fermé », « Critères
                                          non remplis », tout en rouge

   Le second est bien mappe — Booking le voit — mais aucun tarif ni
   aucune disponibilite ne lui a jamais ete envoye. Un logement mappe
   sans disponibilite est ferme a la vente : c'est exactement ce que
   Booking affiche.

   ── POURQUOI ────────────────────────────────────────────────────
   L'ancien parcours de settings.js finissait par une sequence de
   quatre appels, que le nouveau parcours n'a jamais reprise :

     POST /api/channex/pull-bookings/:id     recuperer les reservations
     (attente, le temps que la plateforme reponde)
     POST /api/channex/sync-bookings/:id     les importer dans BH
     POST /api/channex/push-availability/:id envoyer les 500 jours

   C'est la meme omission qui explique la disparition des messages
   « Connexion à la plateforme », « Récupération des réservations » :
   ces lignes commentaient cette sequence. Elles n'ont pas ete
   supprimees — la sequence qu'elles decrivaient n'existe plus.

   ── CE QUE FAIT CE PATCH ────────────────────────────────────────
   Il rend la sequence disponible et visible :

   1. un bouton « Envoyer vers les plateformes » sur l'ecran des
      plateformes, des qu'un logement est connecte. C'est ce qui
      debloque un logement deja mappe mais ferme a la vente ;
   2. la sequence est lancee automatiquement apres un rattachement
      d'immeuble — sans quoi le logement rattache reste ferme ;
   3. la progression est affichee etape par etape, avec les
      reservations importees a la fin.

   L'attente entre le pull et le sync est de 8 s, comme dans l'ancien
   parcours : la plateforme met quelques secondes a repondre. Trop
   court, la sequence n'importe rien.

   Usage :
     node outils/envoyer-disponibilites.js --essai
     node outils/envoyer-disponibilites.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/js/bh-ota-connect.js introuvable.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('_bhEnvoyer') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La sequence, posee avant _bhAdresse ─────────────────────── */
const A1 = `    window._bhAdresse = function () {`;

const N1 = `    /* La sequence de fin de connexion. Sans elle, un logement mappe chez le
       partenaire reste « Tarif fermé » : il est visible mais ferme a la vente,
       faute de disponibilites envoyees. */
    window._bhEnvoyer = async function () {
      var etapes = [
        'Connexion à la plateforme…',
        'Récupération des réservations existantes…',
        'Import des réservations dans BoostingHost…',
        'Envoi des disponibilités et des tarifs…'
      ];
      var n = 0;

      var afficher = function (texte, sousTexte) {
        modal.innerHTML = carte(440,
          '<div style="padding:38px 30px;text-align:center;">' +
          '<div style="width:22px;height:22px;margin:0 auto;border:2px solid ' + V.ligne +
          ';border-top-color:' + V.vert + ';border-radius:50%;animation:bhspin .8s linear infinite;"></div>' +
          '<div style="margin-top:16px;font-size:14px;color:' + V.encre + ';">' + esc(texte) + '</div>' +
          '<div style="margin-top:6px;font-size:12.5px;color:' + V.t3 + ';">' +
          esc(sousTexte || 'Ne fermez pas cette fenêtre.') + '</div>' +
          '<div style="margin-top:14px;font-size:11.5px;color:' + V.t4 + ';font-variant-numeric:tabular-nums;">' +
          'Étape ' + (n) + ' sur ' + etapes.length + '</div></div>');
      };

      var appel = function (chemin) {
        return fetch(API_URL + '/api/channex/' + chemin + '/' + pid, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token() }
        }).then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : null; })
          .catch(function () { return null; });
      };

      n = 1; afficher(etapes[0]);
      await appel('pull-bookings');

      n = 2; afficher(etapes[1], 'La plateforme peut mettre quelques secondes à répondre.');
      // Sans cette attente, sync-bookings arrive avant la reponse de la
      // plateforme et n'importe rien.
      await new Promise(function (r) { setTimeout(r, 8000); });

      n = 3; afficher(etapes[2]);
      var dSync = await appel('sync-bookings');

      n = 4; afficher(etapes[3], 'Cinq cents jours de calendrier sont envoyés.');
      var dDispo = await appel('push-availability');

      var importees = dSync ? ((dSync.imported || 0) + (dSync.updated || 0)) : 0;
      var echecDispo = dDispo === null;

      modal.innerHTML = carte(460,
        entete(null, echecDispo ? 'Envoi incomplet' : 'Disponibilités envoyées', esc(pname)) +
        '<div style="padding:20px 24px;font-size:14px;color:' + V.t2 + ';line-height:1.65;">' +
        (echecDispo
          ? 'Les réservations ont été relevées, mais l\\'envoi des disponibilités a échoué. ' +
            'Le logement restera fermé à la vente sur les plateformes tant qu\\'il n\\'aura pas abouti — ' +
            'réessayez dans quelques minutes.'
          : 'Le calendrier des 500 prochains jours est parti vers vos plateformes. ' +
            'Comptez quelques minutes avant de voir les dates s\\'ouvrir dans leur extranet.') +
        (importees
          ? '<span style="display:block;margin-top:10px;color:' + V.encre + ';">' +
            importees + ' réservation' + (importees > 1 ? 's' : '') + ' importée' + (importees > 1 ? 's' : '') +
            ' depuis les plateformes.</span>'
          : '<span style="display:block;margin-top:10px;color:' + V.t3 + ';">Aucune réservation à importer.</span>') +
        '</div>' +
        pied('', btnPlein('Terminer', "document.getElementById('channexModal')?.remove()")));

      if (typeof loadProperties === 'function') loadProperties().catch(function () {});
    };

    window._bhAdresse = function () {`;

/* ── 2. Le bouton sur l'ecran des plateformes ────────────────────── */
const A2 = `        btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));`;

const N2 = `        /* Un logement connecte mais jamais synchronise reste ferme a la vente
           chez le partenaire. Ce bouton est le seul moyen de le debloquer. */
        estConnecte
          ? btnPlein('Envoyer vers les plateformes', 'window._bhEnvoyer()')
          : btnFantome('Fermer', "document.getElementById('channexModal')?.remove()")));`;

/* ── 3. Enchainer apres un rattachement ──────────────────────────── */
const A3 = `          pied('', btnPlein('Voir les plateformes', 'window._bhRetourPlateformes()')));`;

const N3 = `          /* Un logement fraichement rattache n'a aucune disponibilite sous son
             nouvel etablissement : sans cet envoi il resterait « Tarif fermé ». */
          pied(btnFantome('Plus tard', 'window._bhRetourPlateformes()'),
            btnPlein('Envoyer les disponibilités', 'window._bhEnvoyer()')));`;

const edits = [
  ['sequence d\'envoi', A1, N1],
  ['bouton sur l\'ecran des plateformes', A2, N2],
  ['enchainement apres rattachement', A3, N3]
];

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    if (nom === 'enchainement apres rattachement') {
      console.error('    Ce patch suppose outils/bouton-regroupement.js applique.');
    }
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

try {
  new Function(src);
} catch (e) {
  console.error('\n  \u2717 Resultat invalide : ' + e.message + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Sequence d\'envoi + bouton + enchainement apres rattachement.');
console.log('  Syntaxe verifiee.');
console.log('\n  POUR DEBLOQUER SG ETAGE MAINTENANT');
console.log('    Mes logements \u2192 SG Etage \u2192 Connecter mes plateformes');
console.log('    \u2192 « Envoyer vers les plateformes ». Les quatre etapes');
console.log('    s\'affichent, puis le nombre de reservations importees.');
console.log('    Comptez quelques minutes avant que Booking passe de');
console.log('    « Tarif fermé » a « Réservable ».');
console.log('\n  SI CELA NE SUFFIT PAS');
console.log('    Le logement est peut-etre mappe sur un etablissement separe.');
console.log('    Verifiez d\'abord dans l\'extranet Booking que 900151902 est');
console.log('    bien sous le meme etablissement que 900151901.');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');

#!/usr/bin/env node
/* ============================================================
   outils/refonte-16-heures-des-mouvements.js
   Lot 16 : les heures, et l'ordre de la journee
   ============================================================

   ── LA COLONNE EXISTE ────────────────────────────────────────────
   Vous aviez raison : l'heure est bien en base, sur le LOGEMENT et non
   sur la reservation.

       properties.arrival_time     l'heure d'arrivee
       properties.departure_time   l'heure de depart

   Votre code s'en sert deja ailleurs — le message de bienvenue ecrit
   « L'heure d'arrivee est a partir de … » en la lisant la. Et la route
   /api/aujourdhui/etats joint deja la table properties : il ne manquait
   que deux colonnes au SELECT.

   C'est donc une heure de reference par logement, pas une heure negociee
   avec le voyageur. Le sous-titre dit « a partir de 16:00 » pour une
   arrivee, « avant 11:00 » pour un depart — la nuance compte, et la
   colonne ne dit rien de plus.

   ── L'ORDRE DE LA JOURNEE ────────────────────────────────────────
   Les mouvements ne sont plus groupes arrivees puis departs. Ils sont
   melanges et tries par heure, comme votre maquette : les departs du
   matin d'abord, les arrivees de l'apres-midi ensuite. C'est la journee
   telle qu'elle se passe.

   Un logement sans heure renseignee ne se voit pas attribuer d'heure par
   defaut. Il passe en fin de liste, sans heure affichee. Un « 16 h »
   invente serait pire que rien : on organiserait sa journee dessus.

   ── QUATRE MODIFICATIONS ─────────────────────────────────────────
   server.js                deux colonnes au SELECT, deux champs renvoyes
   bh-liste-unifiee.js      tri par heure, heure affichee

   La route reste en lecture seule. Le script le verifie avant d'ecrire.

   Usage :
     node outils/refonte-16-heures-des-mouvements.js --essai
     node outils/refonte-16-heures-des-mouvements.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const SERVEUR = path.join(RACINE, 'server.js');
const LISTE = path.join(RACINE, 'public', 'js', 'bh-liste-unifiee.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(SERVEUR)) echec('server.js introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(LISTE)) echec('bh-liste-unifiee.js introuvable.');

let srv = fs.readFileSync(SERVEUR, 'utf8');
let liste = fs.readFileSync(LISTE, 'utf8');

if (srv.indexOf('heure_arrivee:') !== -1 && liste.indexOf('minutesDe') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function rempl(texte, avant, apres, quoi, fichier) {
  const n = texte.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois dans ' + fichier + ' (attendu : 1).');
  return texte.split(avant).join(apres);
}

/* ============================================================
   1. SERVEUR — deux colonnes, deux champs
   ============================================================ */

let etatServeur;

if (srv.indexOf('heure_arrivee:') !== -1) {
  etatServeur = 'deja applique';
} else {
  if (srv.indexOf('const departsListe = ') === -1 && srv.indexOf('let departsListe = []') === -1) {
    echec('Le lot 8 n\'est pas applique (departs absents de la route).');
  }

  /* ── Les arrivees ─────────────────────────────────────────── */

  srv = rempl(srv,
    '              p.name AS property_name, p.deposit_amount,',
    '              p.name AS property_name, p.deposit_amount, p.arrival_time,',
    'le SELECT des arrivees', 'server.js');

  srv = rempl(srv,
`        arrivee: r.arrivee,
        depart: r.depart,
        message_envoye:`,
`        arrivee: r.arrivee,
        depart: r.depart,
        // Heure de reference du LOGEMENT, pas une heure negociee avec le
        // voyageur : d'ou « a partir de » cote affichage.
        heure_arrivee: r.arrival_time || null,
        message_envoye:`,
    'la sortie des arrivees', 'server.js');

  /* ── Les departs ──────────────────────────────────────────── */

  srv = rempl(srv,
`                p.name AS property_name,
                to_char(c.reservation_end_date`,
`                p.name AS property_name, p.departure_time,
                to_char(c.reservation_end_date`,
    'le SELECT des departs', 'server.js');

  srv = rempl(srv,
`        depart: r.depart,
        menage_fait: menages[r.property_id]`,
`        depart: r.depart,
        heure_depart: r.departure_time || null,
        menage_fait: menages[r.property_id]`,
    'la sortie des departs', 'server.js');

  /* La route doit rester en lecture seule. */
  const debut = srv.indexOf("app.get('/api/aujourdhui/etats'");
  const fin = srv.indexOf('async function runTemplatesCron');
  if (debut === -1 || fin === -1 || fin < debut) echec('Impossible de delimiter la route pour la verifier.');
  const zone = srv.slice(debut, fin).toUpperCase();
  ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE'].forEach(function (mot) {
    if (zone.indexOf(mot) !== -1) echec('La route contiendrait \u00ab ' + mot.trim() + ' \u00bb. Refus.');
  });

  try { new Function(srv); }
  catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

  etatServeur = 'arrival_time et departure_time ajoutes';
}

/* ============================================================
   2. NAVIGATEUR — l'ordre de la journee
   ============================================================ */

let etatListe;

if (liste.indexOf('minutesDe') !== -1) {
  etatListe = 'deja applique';
} else {
  if (liste.indexOf('function construireCompact(d) {') === -1) {
    echec('La liste compacte est absente. Lancez d\'abord le lot 15.');
  }

  /* Les deux bornes du bloc a remplacer. On coupe entre deux reperes
     plutot que de recopier vingt lignes d'accents et d'echappements :
     une seule difference invisible ferait echouer la comparaison. */
  const DEBUT = liste.indexOf('    var rangs = [];');
  const FIN = liste.indexOf('    rangs.forEach(function (r, i) {');
  if (DEBUT === -1 || FIN === -1 || FIN < DEBUT) echec('Bornes du bloc des mouvements introuvables.');

  const NOUVEAU = `    /* L'heure telle que la base la porte : « 16:00:00 », « 16:00 »,
       parfois « 16h ». On en tire des minutes pour trier et un « 16:00 »
       pour afficher. Ce qu'on ne sait pas lire ne recoit pas d'heure —
       jamais de valeur par defaut : on organiserait sa journee dessus. */
    function minutesDe(brut) {
      if (!brut) return null;
      var m = String(brut).match(/(\\d{1,2})\\s*[:hH]\\s*(\\d{2})?/);
      if (!m) return null;
      var h = parseInt(m[1], 10);
      var mn = m[2] ? parseInt(m[2], 10) : 0;
      if (isNaN(h) || h > 23 || mn > 59) return null;
      return h * 60 + mn;
    }
    function heureTexte(min) {
      if (min === null) return null;
      var h = Math.floor(min / 60), mn = min % 60;
      return (h < 10 ? '0' + h : h) + ':' + (mn < 10 ? '0' + mn : mn);
    }

    var rangs = [];
    arrivees.forEach(function (a) {
      var n = nuits(a.arrivee, a.depart);
      var p = plateforme(a.platform);
      var min = minutesDe(a.heure_arrivee);
      var h = heureTexte(min);
      var detail = [h ? 'Arrivée à partir de ' + h : 'Arrivée',
                    n ? n + ' nuit' + (n > 1 ? 's' : '') : null,
                    p ? p.nom : null].filter(Boolean).join(' \\u00b7 ');
      var t = [a.guest_name, a.property_name].filter(Boolean).join(' \\u00b7 ');
      rangs.push({ tri: min, icone: fleche(true), titre: t || 'Arrivée', detail: detail, lien: '/messages.html' });
      diag.arrivees.push((a.property_name || '?') + ' / ' + (a.guest_name || '?') + (h ? ' — ' + h : ' — sans heure'));
    });
    departs.forEach(function (x) {
      var men = x.menage_fait === true
        ? (x.menage_valide === true ? 'ménage fait et validé' : 'ménage fait')
        : (x.menage_fait === false ? 'ménage à faire' : null);
      var min = minutesDe(x.heure_depart);
      var h = heureTexte(min);
      var detail = [h ? 'Départ avant ' + h : 'Départ', x.guest_name || null, men]
        .filter(Boolean).join(' \\u00b7 ');
      rangs.push({ tri: min, icone: fleche(false), titre: x.property_name || 'Départ', detail: detail, lien: '/reservations.html' });
      diag.departs.push((x.property_name || '?') + ' / ' + (x.guest_name || '?') + (h ? ' — ' + h : ' — sans heure'));
    });

    /* La journee telle qu'elle se passe : les departs du matin, puis les
       arrivees de l'apres-midi. Les mouvements sans heure ferment la
       liste plutot que de s'inserer au hasard. */
    rangs.sort(function (a, b) {
      if (a.tri === null && b.tri === null) return 0;
      if (a.tri === null) return 1;
      if (b.tri === null) return -1;
      return a.tri - b.tri;
    });

`;

  liste = liste.slice(0, DEBUT) + NOUVEAU + liste.slice(FIN);

  liste = rempl(liste,
    "      forme: enVueCalendrier ? 'compacte (vue calendrier)' : 'cartes (Aujourd hui)',",
    "      forme: enVueCalendrier ? 'compacte (vue calendrier)' : 'cartes (Aujourd hui)',\n      heures: 'properties.arrival_time / departure_time',",
    'le diagnostic', 'bh-liste-unifiee.js');

  try { new Function(liste); }
  catch (e) { echec('bh-liste-unifiee.js ne serait plus du JavaScript valide — ' + e.message); }

  etatListe = 'tri par heure, heures affichees';
}

/* ── Verifications ───────────────────────────────────────────── */

[
  [srv, 'la colonne des arrivees', 'p.arrival_time,'],
  [srv, 'la colonne des departs', 'p.departure_time,'],
  [srv, 'le champ heure_arrivee', 'heure_arrivee: r.arrival_time'],
  [srv, 'le champ heure_depart', 'heure_depart: r.departure_time'],
  [liste, 'la lecture de l heure', 'function minutesDe(brut) {'],
  [liste, 'le tri', 'rangs.sort(function (a, b) {'],
  [liste, 'l arrivee « a partir de »', "'Arrivée à partir de '"],
  [liste, 'le depart « avant »', "'Départ avant '"],
].forEach(function (c) {
  if (c[0].indexOf(c[2]) === -1) echec('Verification : ' + c[1] + ' est absent apres modification.');
});

if (!ESSAI) {
  const sauvegarde = SERVEUR + '.avant-heures';
  if (etatServeur !== 'deja applique' && !fs.existsSync(sauvegarde)) {
    fs.writeFileSync(sauvegarde, fs.readFileSync(SERVEUR));
  }
  fs.writeFileSync(SERVEUR, srv, 'utf8');
  fs.writeFileSync(LISTE, liste, 'utf8');
  if (fs.readFileSync(SERVEUR, 'utf8').indexOf('heure_arrivee:') === -1) echec('Champ absent de server.js apres ecriture.');
  if (fs.readFileSync(LISTE, 'utf8').indexOf('minutesDe') === -1) echec('Correction absente de bh-liste-unifiee.js apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  server.js                      ' + etatServeur);
console.log('  public/js/bh-liste-unifiee.js  ' + etatListe);
if (!ESSAI && etatServeur !== 'deja applique') {
  console.log('  Sauvegarde : server.js.avant-heures (ne pas commiter)');
}
console.log('\n  L\'heure vient de properties.arrival_time et departure_time —');
console.log('  celles-la memes que votre message de bienvenue utilise pour');
console.log('  ecrire « L\'heure d\'arrivee est a partir de… ». C\'est une heure');
console.log('  de reference du LOGEMENT, pas une heure negociee : la liste dit');
console.log('  donc « Arrivee a partir de 16:00 » et « Depart avant 11:00 ».');
console.log('\n  Les mouvements sont melanges et tries par heure — les departs');
console.log('  du matin, puis les arrivees de l\'apres-midi. Un logement sans');
console.log('  heure renseignee ferme la liste, sans heure affichee : une');
console.log('  heure par defaut serait pire que rien, on organise sa journee');
console.log('  dessus.');
console.log('\n  A verifier sur telephone, cache vide : /calendrier.html');
console.log('    les lignes dans l\'ordre des heures, heures visibles');
console.log('    bhVerifListeUnifiee()  —  chaque ligne suivie de son heure,');
console.log('    ou de « sans heure » si le logement ne la porte pas.');
console.log('\n  Si beaucoup de « sans heure » remontent, c\'est que la colonne');
console.log('  est vide pour ces logements — cote fiche logement, pas ici.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

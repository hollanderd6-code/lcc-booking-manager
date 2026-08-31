#!/usr/bin/env node
/* ============================================================
   outils/refonte-16c-heures-zone-juste.js
   Lot 16c : la meme chose, avec la bonne zone de departs
   ============================================================

   ── POURQUOI LE LOT 16 N'A RIEN FAIT ─────────────────────────────
   Il s'est arrete sur une ancre et n'a rien ecrit — c'est le
   comportement voulu, mais vous avez commite par-dessus et seul l'outil
   est parti dans le depot. D'ou « undefined » : le serveur repondait
   avec l'ancien code, et il avait raison.

   La cause : je recopiais une ligne entiere du script du lot 6,
   indentation comprise. Votre server.js ne la porte pas au caractere
   pres. Comparer vingt caracteres d'espaces pour inserer un mot est une
   fragilite que je m'impose sans raison.

   ── CE LOT N'A PLUS D'ANCRE DE LIGNE ─────────────────────────────
   Il delimite la route /api/aujourdhui/etats, puis travaille par
   REPERES a l'interieur :

       p.deposit_amount        ->  , p.arrival_time apres lui
       message_envoye:         ->  heure_arrivee: avant lui
       p.name AS property_name ->  , p.departure_time  (bloc departs)
       menage_fait: menages[   ->  heure_depart: avant lui

   L'indentation est LUE sur la ligne existante, jamais supposee. Chaque
   repere doit apparaitre exactement une fois dans sa zone ; sinon le
   script s'arrete en disant lequel et combien de fois.

   ── CE QUE LE 16b A REVELE ───────────────────────────────────────
   « menage_fait: menages[ » apparait deux fois : dans la carte des
   departs, et dans celle des arrivees ou le lot 6b l'a mise aussi. Ma
   zone « departs » courait jusqu'a la fin de la route au lieu de
   s'arreter la ou commence « const sortie ». Le script a refuse plutot
   que d'inserer dans la mauvaise carte — c'est le comportement voulu,
   et c'est ce refus qui m'a montre le texte reel.

   La zone des departs va desormais de « depJour » a « const sortie ».

   ── ET SI CA S'ARRETE ENCORE ─────────────────────────────────────
   Le script affiche alors les lignes qu'il a trouvees autour du repere
   fautif. Vous me les collez, et je vois enfin le texte reel au lieu de
   le deviner — au lieu de vous faire relancer une variante de plus.

   Le lot 16 n'avait rien casse. Celui-ci non plus : tout ou rien.

   Usage :
     node outils/refonte-16b-heures-sans-ancre.js --essai
     node outils/refonte-16b-heures-sans-ancre.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const SERVEUR = path.join(RACINE, 'server.js');
const LISTE = path.join(RACINE, 'public', 'js', 'bh-liste-unifiee.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg, extrait) {
  console.error('\n  \u2717 ' + msg);
  if (extrait) {
    console.error('\n    Ce que le fichier contient a cet endroit :');
    console.error(extrait.split('\n').map(function (l) { return '      ' + l; }).join('\n'));
    console.error('\n    Collez-moi ces lignes : je verrai le texte reel.');
  }
  console.error("\n    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(SERVEUR)) echec('server.js introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(LISTE)) echec('bh-liste-unifiee.js introuvable.');

let srv = fs.readFileSync(SERVEUR, 'utf8');
let liste = fs.readFileSync(LISTE, 'utf8');

/* ============================================================
   Outils d'insertion, sans recopie de ligne
   ============================================================ */

function zoneRoute(texte) {
  const d = texte.indexOf("app.get('/api/aujourdhui/etats'");
  if (d === -1) echec('La route /api/aujourdhui/etats est absente de server.js.');
  const f = texte.indexOf('async function runTemplatesCron', d);
  if (f === -1) echec('Impossible de delimiter la fin de la route.');
  return { debut: d, fin: f };
}

function unique(texte, zone, repere, quoi) {
  const seg = texte.slice(zone.debut, zone.fin);
  const n = seg.split(repere).length - 1;
  if (n !== 1) {
    const i = seg.indexOf(repere);
    const extrait = i === -1 ? null : seg.slice(Math.max(0, i - 200), i + 200);
    echec('\u00ab ' + quoi + ' \u00bb : le repere « ' + repere + ' » apparait ' + n
      + ' fois dans la route (attendu : 1).', extrait);
  }
  return zone.debut + seg.indexOf(repere);
}

/* Insere APRES le repere, sur la meme ligne. */
function apres(texte, pos, repere, ajout) {
  const p = pos + repere.length;
  return texte.slice(0, p) + ajout + texte.slice(p);
}

/* Insere une ligne complete AVANT celle qui porte le repere, en
   reprenant l'indentation exacte de cette ligne. */
function avantLigne(texte, pos, contenu) {
  let debutLigne = texte.lastIndexOf('\n', pos) + 1;
  let i = debutLigne;
  while (i < texte.length && (texte[i] === ' ' || texte[i] === '\t')) i++;
  const indentation = texte.slice(debutLigne, i);
  return texte.slice(0, debutLigne) + indentation + contenu + '\n' + texte.slice(debutLigne);
}

/* ============================================================
   1. SERVEUR
   ============================================================ */

let etatServeur;

if (srv.indexOf('heure_arrivee: r.arrival_time') !== -1) {
  etatServeur = 'deja applique';
} else {
  let z = zoneRoute(srv);

  /* ── Les arrivees : la colonne ─────────────────────────────── */
  let p = unique(srv, z, 'p.deposit_amount', 'la colonne des arrivees');
  srv = apres(srv, p, 'p.deposit_amount', ', p.arrival_time');

  /* ── Les arrivees : le champ renvoye ───────────────────────── */
  z = zoneRoute(srv);
  p = unique(srv, z, 'message_envoye:', 'la sortie des arrivees');
  srv = avantLigne(srv, p,
    '// Heure de reference du LOGEMENT, pas une heure negociee avec le');
  z = zoneRoute(srv);
  p = unique(srv, z, 'message_envoye:', 'la sortie des arrivees');
  srv = avantLigne(srv, p, "// voyageur : d'ou « a partir de » cote affichage.");
  z = zoneRoute(srv);
  p = unique(srv, z, 'message_envoye:', 'la sortie des arrivees');
  srv = avantLigne(srv, p, 'heure_arrivee: r.arrival_time || null,');

  /* ── Les departs ───────────────────────────────────────────── */
  z = zoneRoute(srv);
  const iDep = srv.indexOf('depJour', z.debut);
  if (iDep === -1 || iDep > z.fin) {
    echec('Le bloc des departs (depJour) est absent de la route. Lancez d\'abord le lot 8.');
  }
  /* La carte des arrivees porte les memes noms de champs. La zone des
     departs s'arrete donc la ou commence « const sortie », sinon les
     reperes y apparaissent deux fois. */
  const iSortie = srv.indexOf('const sortie', iDep);
  if (iSortie === -1 || iSortie > z.fin) echec('« const sortie » introuvable apres le bloc des departs.');
  const zDep = { debut: iDep, fin: iSortie };

  p = unique(srv, zDep, 'p.name AS property_name', 'la colonne des departs');
  srv = apres(srv, p, 'p.name AS property_name', ', p.departure_time');

  z = zoneRoute(srv);
  const iDepB = srv.indexOf('depJour', z.debut);
  const iSortieB = srv.indexOf('const sortie', iDepB);
  if (iSortieB === -1 || iSortieB > z.fin) echec('« const sortie » introuvable apres le bloc des departs.');
  const zDep2 = { debut: iDepB, fin: iSortieB };
  p = unique(srv, zDep2, 'menage_fait: menages[', 'la sortie des departs');
  srv = avantLigne(srv, p, 'heure_depart: r.departure_time || null,');

  /* ── La route reste en lecture seule ───────────────────────── */
  z = zoneRoute(srv);
  const zone = srv.slice(z.debut, z.fin).toUpperCase();
  ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE'].forEach(function (mot) {
    if (zone.indexOf(mot) !== -1) echec('La route contiendrait \u00ab ' + mot.trim() + ' \u00bb. Refus.');
  });

  try { new Function(srv); }
  catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

  etatServeur = 'arrival_time et departure_time ajoutes';
}

/* ============================================================
   2. NAVIGATEUR — inchange par rapport au lot 16
   ============================================================ */

let etatListe;

if (liste.indexOf('minutesDe') !== -1) {
  etatListe = 'deja applique';
} else {
  if (liste.indexOf('function construireCompact(d) {') === -1) {
    echec('La liste compacte est absente. Lancez d\'abord le lot 15.');
  }

  const DEBUT = liste.indexOf('    var rangs = [];');
  const FIN = liste.indexOf('    rangs.forEach(function (r, i) {');
  if (DEBUT === -1 || FIN === -1 || FIN < DEBUT) echec('Bornes du bloc des mouvements introuvables.');

  const NOUVEAU = `    /* L'heure telle que la base la porte : « 15:00:00 », « 15:00 »,
       parfois « 15h ». On en tire des minutes pour trier et un « 15:00 »
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

  const AVANT_DIAG = "      forme: enVueCalendrier ? 'compacte (vue calendrier)' : 'cartes (Aujourd hui)',";
  if (liste.split(AVANT_DIAG).length - 1 === 1) {
    liste = liste.split(AVANT_DIAG).join(AVANT_DIAG
      + "\n      heures: 'properties.arrival_time / departure_time',");
  }

  try { new Function(liste); }
  catch (e) { echec('bh-liste-unifiee.js ne serait plus du JavaScript valide — ' + e.message); }

  etatListe = 'tri par heure, heures affichees';
}

/* ── Verifications ───────────────────────────────────────────── */

[
  [srv, 'la colonne des arrivees', 'p.deposit_amount, p.arrival_time'],
  [srv, 'le champ heure_arrivee', 'heure_arrivee: r.arrival_time'],
  [srv, 'la colonne des departs', 'p.name AS property_name, p.departure_time'],
  [srv, 'le champ heure_depart', 'heure_depart: r.departure_time'],
  [liste, 'la lecture de l heure', 'function minutesDe(brut) {'],
  [liste, 'le tri', 'rangs.sort(function (a, b) {'],
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
  if (fs.readFileSync(SERVEUR, 'utf8').indexOf('heure_arrivee: r.arrival_time') === -1) {
    echec('Champ absent de server.js apres ecriture.');
  }
  if (fs.readFileSync(LISTE, 'utf8').indexOf('minutesDe') === -1) {
    echec('Correction absente de bh-liste-unifiee.js apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  server.js                      ' + etatServeur);
console.log('  public/js/bh-liste-unifiee.js  ' + etatListe);
if (!ESSAI && etatServeur !== 'deja applique') {
  console.log('  Sauvegarde : server.js.avant-heures (ne pas commiter)');
}
console.log('\n  Les insertions ne recopient plus de ligne : elles se placent');
console.log('  par rapport a un repere, et lisent l\'indentation existante.');
console.log('  Le lot 16 echouait la-dessus, sans rien casser — mais le commit');
console.log('  qui a suivi n\'emportait que l\'outil, d\'ou « undefined ».');
console.log('\n  IMPORTANT — verifiez AVANT de commiter :');
console.log('    grep -c "heure_arrivee: r.arrival_time" server.js     doit dire 1');
console.log('    grep -c "minutesDe" public/js/bh-liste-unifiee.js     doit dire 3');
console.log('\n  Puis, apres deploiement complet sur Render, cache vide :');
console.log('    les mouvements dans l\'ordre des heures');
console.log('    « Arrivee a partir de 15:00 », « Depart avant 10:00 »\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/refonte-15-ca-juste-et-mouvements.js
   Lot 15 : le bon montant, et la liste compacte
   ============================================================

   ── 1. « 111 € » AU LIEU DE « 19 111 € » ─────────────────────────
   Mon expression reguliere lisait le texte de la carte avec une classe
   de caracteres contenant l'espace ordinaire et l'espace insecable. Or
   « 19 111 € » est ecrit avec une ESPACE FINE INSECABLE (U+202F), celle
   que le francais typographique met entre les tranches de milliers.
   L'expression s'arretait dessus et ne gardait que « 111 ».

   Et le montant changeait d'un rechargement a l'autre parce que je
   figeais le sous-titre des que ses deux morceaux existaient. La carte
   n'etant pas toujours remplie au meme instant, je figeais parfois une
   valeur partielle — et plus rien ne la corrigeait.

   Deux corrections :

   Je ne lis plus le texte de la carte a l'expression reguliere. Je
   cherche, DANS la carte, la feuille qui porte le montant — celle dont
   le texte contient un euro et la plus longue suite de chiffres. C'est
   le noeud que votre code met a jour ; je lis donc exactement ce qu'il
   ecrit, espaces comprises, sans les interpreter.

   Et le sous-titre n'est plus jamais fige : il se reecrit a chaque
   passage. Si la valeur change, elle change a l'ecran.

   ── 2. LA LISTE, COMPACTE ────────────────────────────────────────
   En vue calendrier je vous ai livre les grandes cartes d'Aujourd'hui —
   celles qui nomment ce qui bloque. Elles ont leur place la ou l'on
   agit, pas sous un calendrier que l'on consulte.

   La vue calendrier recoit donc la forme de votre maquette : une seule
   carte, une ligne par mouvement, une fleche entrante ou sortante, et le
   detail en seconde ligne. Meme donnee, meme source — /api/aujourdhui/
   etats — presentation differente selon l'endroit.

   Une reserve que je dois vous dire : la maquette melange arrivees et
   departs dans l'ordre des heures. Votre API ne porte pas l'heure
   d'arrivee (heure_disponible etait false). Les mouvements sont donc
   groupes, arrivees puis departs, et aucune heure n'est affichee — je
   prefere un ordre honnete a un « 16 h » invente.

   Si vous voulez les heures, elles existent probablement en base : dites-
   le et je regarde quelle colonne les porte.

   Usage :
     node outils/refonte-15-ca-juste-et-mouvements.js --essai
     node outils/refonte-15-ca-juste-et-mouvements.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const JS = path.join(process.cwd(), 'public', 'js');
const ENTETE = path.join(JS, 'bh-entete-calendrier.js');
const LISTE = path.join(JS, 'bh-liste-unifiee.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

[[ENTETE, 'bh-entete-calendrier.js'], [LISTE, 'bh-liste-unifiee.js']]
  .forEach(function (p) { if (!fs.existsSync(p[0])) echec(p[1] + ' introuvable.'); });

let entete = fs.readFileSync(ENTETE, 'utf8');
let liste = fs.readFileSync(LISTE, 'utf8');

if (entete.indexOf('feuilleMontant') !== -1 && liste.indexOf('construireCompact') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function rempl(texte, avant, apres, quoi, fichier) {
  const n = texte.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois dans ' + fichier + ' (attendu : 1).');
  return texte.split(avant).join(apres);
}

/* ============================================================
   1. Le montant, lu au noeud
   ============================================================ */

if (entete.indexOf('feuilleMontant') === -1) {
  const DEBUT = entete.indexOf('  /* Le CA, lu la ou il est calcule.');
  const FIN = entete.indexOf('  var SVG_LOUPE =');
  if (DEBUT === -1 || FIN === -1 || FIN < DEBUT) echec('Bornes de la lecture du CA introuvables.');

  const NOUVEAU = `  /* Le montant, lu au NOEUD et non a l'expression reguliere.

     « 19 111 € » separe ses milliers par une espace fine insecable
     (U+202F). Ma classe de caracteres ne la connaissait pas et coupait :
     « 111 ». Plutot que d'allonger la liste des espaces possibles — il en
     existe une dizaine en Unicode — on cherche la feuille qui porte le
     montant et on rend son texte tel quel. C'est ce que votre code
     ecrit, donc c'est juste par construction. */
  function feuilleMontant(racine) {
    if (!racine) return null;
    var noeuds = racine.querySelectorAll('*');
    var meilleur = null, maxChiffres = 0;
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.children.length) continue;
      var t = (n.textContent || '').trim();
      if (!t || t.length > 24) continue;
      if (t.indexOf('\\u20ac') === -1) continue;
      var chiffres = (t.match(/\\d/g) || []).length;
      if (chiffres > maxChiffres) { maxChiffres = chiffres; meilleur = t; }
    }
    return maxChiffres ? meilleur : null;
  }

  function caMensuel() {
    /* La carte d'abord, son conteneur ensuite : selon les versions le
       montant vit dans #kpiCaCard ou directement dans .bh2-feat. */
    return feuilleMontant(document.getElementById('kpiCaCard'))
        || feuilleMontant(document.querySelector('.bh2-feat'));
  }

  /* Le sous-titre : l'argent d'abord, l'occupation qui l'explique
     ensuite. Ce qui manque est omis, jamais remplace par un zero. */
  function sousTitre() {
    var bouts = [];
    var ca = caMensuel();
    var occ = occupation();
    if (ca) bouts.push(ca + ' ce mois');
    if (occ) bouts.push(occ + " % d'occupation");
    return bouts.join('  \\u00b7  ');
  }

`;

  entete = entete.slice(0, DEBUT) + NOUVEAU + entete.slice(FIN);

  /* Le sous-titre ne se fige plus. */
  const ANCIEN_MAJ = entete.indexOf('      /* Les deux chiffres arrivent par des chemins differents');
  const FIN_MAJ = entete.indexOf('    }\n\n    /* L\'en-tete doit rester le premier enfant');
  if (ANCIEN_MAJ === -1 || FIN_MAJ === -1) echec('Bloc de mise a jour du sous-titre introuvable.');

  entete = entete.slice(0, ANCIEN_MAJ)
    + `      /* Jamais fige : la carte se remplit a son rythme, et une valeur
         partielle lue trop tot doit pouvoir etre corrigee. On reecrit a
         chaque passage, et on ne vide jamais un sous-titre deja rempli. */
      var s = document.getElementById('bhEnteteCalSous');
      if (s) {
        var frais = sousTitre();
        if (frais) s.textContent = frais;
      }
`
    + entete.slice(FIN_MAJ);

  try { new Function(entete); }
  catch (e) { echec('bh-entete-calendrier.js ne serait plus du JavaScript valide — ' + e.message); }
}

/* ============================================================
   2. La liste compacte en vue calendrier
   ============================================================ */

if (liste.indexOf('construireCompact') === -1) {
  liste = rempl(liste,
    '  function construire(d) {',
`  /* ── La forme compacte, pour la vue calendrier ─────────────────
     Une seule carte, une ligne par mouvement. Les grandes cartes qui
     nomment ce qui bloque restent sur Aujourd'hui : c'est la qu'on agit.

     Les mouvements sont groupes, arrivees puis departs. La maquette les
     melange par heure, mais l'API ne porte pas l'heure d'arrivee — un
     ordre honnete vaut mieux qu'un « 16 h » invente. */
  var JOURS_LONG = ['DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI'];
  var MOIS_LONG = ['JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET',
                   'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE'];

  function fleche(entrante) {
    var d = entrante
      ? '<path d="M13 4.5 20 12l-7 7.5"/><path d="M20 12H9"/><path d="M4.5 4v16"/>'
      : '<path d="M17 4.5 24 12l-7 7.5"/><path d="M24 12H13"/><path d="M8.5 4v16"/>';
    var couleur = entrante ? '#0E3B2E' : '#8A5230';
    return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"'
      + ' stroke="' + couleur + '" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
      + d + '</svg>';
  }

  function ligneCompacte(icone, titre, detail, lien, dernier) {
    var a = document.createElement('a');
    a.href = lien;
    a.style.cssText = 'display:flex;align-items:center;gap:12px;padding:13px 15px'
      + ';text-decoration:none;min-height:44px'
      + (dernier ? '' : ';border-bottom:1px solid #F0EEE7');

    var g = document.createElement('span');
    g.style.cssText = 'flex:none;display:inline-flex;line-height:0';
    g.innerHTML = icone;
    a.appendChild(g);

    var m = document.createElement('span');
    m.style.cssText = 'flex:1;min-width:0';
    var t = document.createElement('span');
    t.textContent = titre;
    t.style.cssText = 'display:block;font-size:14.5px;font-weight:600;color:' + ENCRE
      + ';letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    m.appendChild(t);
    if (detail) {
      var s = document.createElement('span');
      s.textContent = detail;
      s.style.cssText = 'display:block;font-size:12.5px;color:' + GRIS + ';margin-top:1px'
        + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      m.appendChild(s);
    }
    a.appendChild(m);

    var ch = document.createElement('span');
    ch.textContent = '\\u203A';
    ch.setAttribute('aria-hidden', 'true');
    ch.style.cssText = 'flex:none;color:#C4C0B6;font-size:18px;line-height:1';
    a.appendChild(ch);
    return a;
  }

  function construireCompact(d) {
    if (document.getElementById('bhListeUnifiee')) return true;
    var place = ancre();
    if (!place) { diag.erreur = 'point d insertion introuvable'; return false; }

    var arrivees = Array.isArray(d.arrivees) ? d.arrivees : [];
    var departs = Array.isArray(d.departs) ? d.departs : [];
    var total = arrivees.length + departs.length;
    if (!total) { diag.erreur = 'aucun mouvement aujourd hui'; return false; }

    var bloc = document.createElement('div');
    bloc.id = 'bhListeUnifiee';
    bloc.style.cssText = 'font-family:inherit;margin:16px 0 0';

    var quand = new Date();
    if (d.date && /^\\d{4}-\\d{2}-\\d{2}$/.test(d.date)) {
      var p = d.date.split('-');
      quand = new Date(+p[0], +p[1] - 1, +p[2]);
    }
    var titre = document.createElement('div');
    titre.textContent = JOURS_LONG[quand.getDay()] + ' ' + quand.getDate() + ' '
      + MOIS_LONG[quand.getMonth()] + ' \\u00b7 ' + total + ' MOUVEMENT' + (total > 1 ? 'S' : '');
    titre.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.13em;color:#8B8B84;padding:0 4px 9px';
    bloc.appendChild(titre);

    var carte = document.createElement('div');
    carte.style.cssText = 'background:#fff;border:1px solid ' + BORD + ';border-radius:16px;overflow:hidden';

    var rangs = [];
    arrivees.forEach(function (a) {
      var n = nuits(a.arrivee, a.depart);
      var p = plateforme(a.platform);
      var detail = ['Arrivée', n ? n + ' nuit' + (n > 1 ? 's' : '') : null, p ? p.nom : null]
        .filter(Boolean).join(' \\u00b7 ');
      var t = [a.guest_name, a.property_name].filter(Boolean).join(' \\u00b7 ');
      rangs.push({ icone: fleche(true), titre: t || 'Arrivée', detail: detail, lien: '/messages.html' });
      diag.arrivees.push((a.property_name || '?') + ' / ' + (a.guest_name || '?'));
    });
    departs.forEach(function (x) {
      var men = x.menage_fait === true
        ? (x.menage_valide === true ? 'ménage fait et validé' : 'ménage fait')
        : (x.menage_fait === false ? 'ménage à faire' : null);
      var detail = ['Départ', x.guest_name || null, men].filter(Boolean).join(' \\u00b7 ');
      rangs.push({ icone: fleche(false), titre: x.property_name || 'Départ', detail: detail, lien: '/reservations.html' });
      diag.departs.push((x.property_name || '?') + ' / ' + (x.guest_name || '?'));
    });

    rangs.forEach(function (r, i) {
      carte.appendChild(ligneCompacte(r.icone, r.titre, r.detail, r.lien, i === rangs.length - 1));
    });
    bloc.appendChild(carte);

    place.parent.insertBefore(bloc, place.avant);
    return true;
  }

  function construire(d) {`,
    'la fonction construire', 'bh-liste-unifiee.js');

  liste = rempl(liste,
    '        construire(d);',
    '        (enVueCalendrier ? construireCompact : construire)(d);',
    'l\'appel a construire', 'bh-liste-unifiee.js');

  liste = rempl(liste,
    '      source: diag.source,',
    "      source: diag.source,\n      forme: enVueCalendrier ? 'compacte (vue calendrier)' : 'cartes (Aujourd hui)',",
    'le diagnostic', 'bh-liste-unifiee.js');

  try { new Function(liste); }
  catch (e) { echec('bh-liste-unifiee.js ne serait plus du JavaScript valide — ' + e.message); }
}

/* ── Verifications ───────────────────────────────────────────── */

[
  [entete, 'la lecture au noeud', 'function feuilleMontant(racine) {'],
  [entete, 'la recherche du plus long montant', 'if (chiffres > maxChiffres)'],
  [entete, 'les deux emplacements', "feuilleMontant(document.getElementById('kpiCaCard'))"],
  [liste, 'la forme compacte', 'function construireCompact(d) {'],
  [liste, 'les fleches', 'function fleche(entrante) {'],
  [liste, 'le branchement', '(enVueCalendrier ? construireCompact : construire)(d);'],
  [liste, "l'en-tete de date", "' MOUVEMENT' + (total > 1 ? 'S' : '')"],
].forEach(function (c) {
  if (c[0].indexOf(c[2]) === -1) echec('Verification : ' + c[1] + ' est absent apres modification.');
});

if (entete.indexOf('bhComplet') !== -1) echec('Le figeage du sous-titre subsiste. Refus.');
if (entete.indexOf('match(/(\\d[\\d') !== -1) echec("L'ancienne expression reguliere subsiste. Refus.");

if (!ESSAI) {
  fs.writeFileSync(ENTETE, entete, 'utf8');
  fs.writeFileSync(LISTE, liste, 'utf8');
  if (fs.readFileSync(ENTETE, 'utf8').indexOf('feuilleMontant') === -1) echec('Correction absente de bh-entete-calendrier.js.');
  if (fs.readFileSync(LISTE, 'utf8').indexOf('construireCompact') === -1) echec('Correction absente de bh-liste-unifiee.js.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  1. Le montant est lu AU NOEUD, plus a l\'expression reguliere.');
console.log('     « 19 111 € » separe ses milliers par une espace fine');
console.log('     insecable (U+202F) que ma classe ignorait : elle coupait a');
console.log('     « 111 ». On rend desormais le texte tel que votre code');
console.log('     l\'ecrit, sans l\'interpreter.');
console.log('  2. Le sous-titre ne se fige plus : il se reecrit a chaque');
console.log('     passage, donc une valeur lue trop tot se corrige.');
console.log('  3. La vue calendrier recoit la liste compacte : une carte, une');
console.log('     ligne par mouvement, fleche entrante ou sortante.');
console.log('     Les grandes cartes restent sur Aujourd\'hui — c\'est la qu\'on');
console.log('     agit sur ce qui bloque.');
console.log('\n  Reserve : la maquette melange arrivees et departs par heure.');
console.log('  L\'API ne porte pas l\'heure d\'arrivee, donc ils sont groupes et');
console.log('  aucune heure n\'est affichee. Un ordre honnete plutot qu\'un');
console.log('  « 16 h » invente. Dites-le si vous voulez les heures : je');
console.log('  chercherai la colonne qui les porte.');
console.log('\n  A verifier sur telephone, cache vide : /calendrier.html');
console.log('  1. Le sous-titre doit dire le MEME montant que l\'ancienne carte');
console.log('     CA mensuel — 19 111 €. Rechargez trois fois : il ne doit');
console.log('     plus changer.');
console.log('  2. Sous le calendrier : une carte, sept lignes, fleches.');
console.log('  3. bhVerifEnteteCal()  — « ca_lu » doit valoir 19 111 €.');
console.log('     bhVerifListeUnifiee()  — « forme » doit dire compacte.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

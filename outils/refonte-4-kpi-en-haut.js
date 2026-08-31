#!/usr/bin/env node
/* ============================================================
   outils/refonte-4-kpi-en-haut.js
   Lot 4 : les trois compteurs au-dessus de la bande
   ============================================================

   ── LE CHOIX QUI COMPTE ──────────────────────────────────────────
   La maquette montre trois tuiles compactes en haut. Je pourrais les
   dessiner et y recopier vos chiffres — c'est ce que j'avais refuse de
   faire au lot 3f, et je le refuse encore : deux endroits qui affichent
   le meme nombre finissent toujours par en afficher deux differents.

   Je DEPLACE donc les tuiles existantes. Les noeuds eux-memes : arrivees,
   departs, menages 48h quittent « Votre journee » et remontent au-dessus
   de la bande. Leurs chiffres continuent d'etre ecrits par le code qui
   les ecrivait — je n'ai pas a savoir comment il les calcule, et il n'a
   pas a savoir que je les ai bougees.

   ── CE QUI RESTE DANS « VOTRE JOURNEE » ──────────────────────────
   Logements actifs, cautions, tout est valide, notes sur reservations.
   Quatre mesures de fond, consultees moins souvent : elles gardent leur
   carte, un pouce plus bas.

   Si les trois tuiles etaient les seules de la carte, la carte serait
   vide : dans ce cas le module ne deplace rien et le dit. Une carte
   fantome serait pire que l'ordre actuel.

   ── LA COMPACITE ─────────────────────────────────────────────────
   Les tuiles remontees sont retaillees : le chiffre passe a 26 px, le
   libelle a 12, les icones decoratives disparaissent. Sur la maquette
   ces trois tuiles tiennent en 80 px de haut ; dans la carte elles en
   prennent 150 avec leurs pastilles et leurs sous-titres.

   Tout est memorise : bhAnnulerKpi() les remet dans la carte.

   Usage :
     node outils/refonte-4-kpi-en-haut.js --essai
     node outils/refonte-4-kpi-en-haut.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const MODULE = path.join(PUBLIC, 'js', 'bh-kpi-haut.js');
const APP = path.join(PUBLIC, 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-entete-jour.js'))) {
  echec('bh-entete-jour.js absent. Lancez d\'abord les lots 3f a 3i.');
}

const SOURCE = `/* ============================================================
   bh-kpi-haut.js — trois compteurs au-dessus de la bande
   ============================================================
   Les tuiles sont DEPLACEES depuis « Votre journee », pas recopiees :
   le code qui ecrit leurs chiffres continue de le faire, sans savoir
   qu'elles ont change de place.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhKpiHaut) return;
  window.__bhKpiHaut = true;

  var mem = [];
  var diag = { deplacees: [], raison: '', restantes: 0 };

  /* Les trois tuiles cherchees, par leur libelle. */
  var CHERCHEES = [
    { cle: 'arrivees', mots: ['arrivée', 'arrivee', 'arrivées'] },
    { cle: 'departs',  mots: ['départ', 'depart', 'check-out', 'checkout'] },
    { cle: 'menages',  mots: ['ménage', 'menage', 'nettoy'] }
  ];

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  function carteJournee() {
    var titres = document.querySelectorAll('h1, h2, h3, h4, .card-title, [class*="title"]');
    for (var i = 0; i < titres.length; i++) {
      var t = (titres[i].textContent || '').toLowerCase();
      if (t.indexOf('votre journ') === -1) continue;
      var carte = titres[i].closest('.card, [class*="card"], section, .panel') || titres[i].parentElement;
      var garde = 0;
      while (carte && carte.parentElement && carte.getBoundingClientRect().height < 120 && garde++ < 6) {
        carte = carte.parentElement;
      }
      return carte;
    }
    return null;
  }

  /* Une tuile : le plus petit bloc qui contient a la fois le libelle et
     un nombre. On remonte depuis le libelle jusqu'a trouver le nombre. */
  function tuileDepuisLibelle(el, racine) {
    var n = el;
    var garde = 0;
    while (n && n !== racine && garde++ < 6) {
      var txt = (n.textContent || '');
      if (/\\d/.test(txt) && n.getBoundingClientRect().height > 40) return n;
      n = n.parentElement;
    }
    return null;
  }

  function trouverTuiles(carte) {
    var out = [];
    var pris = [];
    var feuilles = carte.querySelectorAll('div, span, p, small, label, h4, h5');

    CHERCHEES.forEach(function (c) {
      for (var i = 0; i < feuilles.length; i++) {
        var f = feuilles[i];
        if (f.children.length) continue;
        var t = (f.textContent || '').trim().toLowerCase();
        if (!t || t.length > 24) continue;
        var ok = false;
        for (var k = 0; k < c.mots.length; k++) if (t.indexOf(c.mots[k]) !== -1) { ok = true; break; }
        if (!ok) continue;
        var tuile = tuileDepuisLibelle(f, carte);
        if (!tuile) continue;
        /* Pas deux fois la meme, ni une tuile imbriquee dans une autre. */
        var conflit = false;
        for (var j = 0; j < pris.length; j++) {
          if (pris[j] === tuile || pris[j].contains(tuile) || tuile.contains(pris[j])) { conflit = true; break; }
        }
        if (conflit) continue;
        pris.push(tuile);
        out.push({ cle: c.cle, el: tuile, libelle: t });
        break;
      }
    });
    return out;
  }

  function compacter(tuile) {
    memoriser(tuile, 'padding', '11px 12px');
    memoriser(tuile, 'margin', '0');
    memoriser(tuile, 'min-height', '0');
    memoriser(tuile, 'height', 'auto');

    var feuilles = tuile.querySelectorAll('div, span, p, small, label, h3, h4, h5');
    for (var i = 0; i < feuilles.length; i++) {
      var f = feuilles[i];
      if (f.children.length) continue;
      var t = (f.textContent || '').trim();
      if (!t) continue;
      if (/^[\\d\\s.,%€]+$/.test(t)) {
        memoriser(f, 'font-size', '26px');
        memoriser(f, 'line-height', '1');
        memoriser(f, 'margin', '0');
      } else {
        memoriser(f, 'font-size', '12px');
        memoriser(f, 'margin', '5px 0 0');
        memoriser(f, 'line-height', '1.25');
      }
    }
    /* Les icones decoratives prennent la place du chiffre. */
    var icones = tuile.querySelectorAll('svg, i, img, [class*="icon"]');
    for (var j = 0; j < icones.length; j++) {
      if ((icones[j].textContent || '').trim()) continue;
      memoriser(icones[j], 'display', 'none');
    }
  }

  function deplacer() {
    if (document.getElementById('bhKpiHaut')) return true;

    var entete = document.getElementById('bhEnteteJour');
    var bande = document.getElementById('bhBandeJours');
    var carte = carteJournee();
    if (!entete || !carte) { diag.raison = 'en-tete ou carte introuvable'; return false; }

    var tuiles = trouverTuiles(carte);
    if (tuiles.length < 2) { diag.raison = 'seulement ' + tuiles.length + ' tuile(s) reconnue(s)'; return false; }

    /* Si la carte n'a que ces tuiles, la vider la laisserait fantome. */
    var nombresAvant = (carte.textContent.match(/\\d+/g) || []).length;
    var nombresDansTuiles = 0;
    tuiles.forEach(function (t) { nombresDansTuiles += (t.el.textContent.match(/\\d+/g) || []).length; });
    if (nombresAvant - nombresDansTuiles < 2) {
      diag.raison = 'la carte « Votre journee » serait vide — deplacement annule';
      return false;
    }
    diag.restantes = nombresAvant - nombresDansTuiles;

    var rangee = document.createElement('div');
    rangee.id = 'bhKpiHaut';
    rangee.style.cssText = 'display:grid;grid-template-columns:repeat(' + tuiles.length + ',1fr)'
      + ';gap:8px;margin:0 0 14px;font-family:inherit';

    tuiles.forEach(function (t) {
      mem.push({ type: 'place', el: t.el, parent: t.el.parentElement, avant: t.el.nextSibling });
      compacter(t.el);
      rangee.appendChild(t.el);
      diag.deplacees.push(t.cle + ' (' + t.libelle + ')');
    });

    /* Au-dessus de la bande, sous l'en-tete. */
    var ancre = bande || carte;
    ancre.parentElement.insertBefore(rangee, ancre);
    return true;
  }

  window.bhAnnulerKpi = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }
    }
    var r = document.getElementById('bhKpiHaut');
    if (r) r.remove();
    var n = mem.length;
    mem = [];
    console.log(n + ' changement(s) annule(s). Les tuiles sont revenues dans « Votre journee ».');
    return n;
  };

  window.bhVerifKpi = function () {
    var rangee = document.getElementById('bhKpiHaut');
    var res = {
      rangee_posee: !!rangee,
      tuiles_deplacees: diag.deplacees,
      nombres_restants_dans_la_carte: diag.restantes,
      au_dessus_de_la_bande: !!(rangee && document.getElementById('bhBandeJours')
        && rangee.compareDocumentPosition(document.getElementById('bhBandeJours')) & Node.DOCUMENT_POSITION_FOLLOWING),
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── KPI en haut ──');
    console.log(res);
    if (!res.rangee_posee) console.warn('Non deplacees : ' + (diag.raison || 'inconnu'));
    console.log('Pour revenir en arriere : bhAnnulerKpi()');
    return res;
  };

  function demarrer() { deplacer(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 1800); });
  } else {
    setTimeout(demarrer, 1800);
  }
  setTimeout(demarrer, 3200);
  setTimeout(demarrer, 5200);
})();
`;

const BALISE = '<script src="js/bh-kpi-haut.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etat;

if (html.indexOf('bh-kpi-haut.js') !== -1) {
  etat = 'deja';
} else {
  const ancre = html.indexOf('bh-vide-du-haut.js');
  const secours = ancre === -1 ? html.indexOf('bh-entete-jour.js') : ancre;
  if (secours === -1) echec('Aucun module du lot 3 dans app.html.');
  const fin = html.indexOf('</script>', secours);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etat = 'apres ' + (ancre === -1 ? 'bh-entete-jour.js' : 'bh-vide-du-haut.js');
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerKpi') === -1) echec("Le module n'est pas complet apres ecriture.");
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  public/js/bh-kpi-haut.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html             ' + etat);
console.log('\n  Arrivees, departs, menages 48h remontent AU-DESSUS de la bande.');
console.log('  Les noeuds sont DEPLACES : leurs chiffres restent ecrits par le');
console.log('  code d\'origine. Aucun nombre n\'est recopie, donc aucun ne peut');
console.log('  divergen.');
console.log('  Restent dans « Votre journee » : logements actifs, cautions,');
console.log('  tout est valide, notes sur reservations.');
console.log('\n  Garde-fou : si la carte se retrouvait vide, rien n\'est deplace.');
console.log('  Annulation :  bhAnnulerKpi()');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  1. Trois tuiles compactes sous le titre, avant la bande.');
console.log('  2. Leurs chiffres sont les MEMES qu\'avant : 7, 3, 6.');
console.log('  3. « Votre journee » existe encore, avec ses quatre mesures.');
console.log('  4. bhVerifKpi()  — au_dessus_de_la_bande: true.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

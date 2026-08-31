#!/usr/bin/env node
/* ============================================================
   outils/refonte-4b-kpi-vrais-noms.js
   Lot 4b : les vraies classes, un seul noeud a deplacer
   ============================================================

   ── CE QUE LA STRUCTURE M'APPREND ────────────────────────────────
       div.bh2-ops                        h=107
         div#kpiTodayMovesCard            h=0
           span#kpiTodayMovesValue        « 10 »        (masque)
           span#kpiTodayMovesSub          « 7 arrivées • 3 départs »
           div.bh2-op    Arrivées   7   voyageurs attendus
           div.bh2-op    Départs    3   check-outs ce jour
         div#kpiCleaning48hCard.bh2-op    Ménages 48h  6
       section.bh2-stats                  h=157
         Logements actifs · Cautions · tout est valide · Notes

   Ma detection cherchait des libelles sans enfants. Or chaque libelle
   partage sa ligne avec son icone : span.bh2-op-lbl et span.bh2-op-ic
   sont freres dans div.bh2-op-top. Une seule tuile passait le test.

   Il n'y avait rien a deviner : les trois tuiles sont deja reunies dans
   div.bh2-ops, et rien d'autre. Je deplace ce conteneur, un seul noeud.
   Zero detection, zero heuristique — donc zero pari.

   ── LA COMPACITE ─────────────────────────────────────────────────
   #kpiTodayMovesCard groupe deux tuiles sur trois : il passe en
   display:contents pour que les trois deviennent freres dans une grille
   de trois colonnes egales. Sans cela, deux tuiles se serreraient dans
   une colonne et la troisieme s'etalerait.

   Les sous-titres (« voyageurs attendus », « check-outs ce jour ») et
   les icones sont masques : a trois tuiles cote a cote sur 390 px, le
   libelle et le chiffre suffisent — c'est ce que montre la maquette.
   Ils reviennent avec bhAnnulerKpi().

   « Votre journee » garde son titre, sa date et ses quatre mesures de
   fond : section.bh2-stats n'est pas touchee.

   Usage :
     node outils/refonte-4b-kpi-vrais-noms.js --essai
     node outils/refonte-4b-kpi-vrais-noms.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-kpi-haut.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-kpi-haut.js introuvable. Lancez d\'abord refonte-4-kpi-en-haut.js.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('bh2-ops') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* On remplace tout le bloc de detection et de deplacement, des
   « CHERCHEES » jusqu'a la fin de deplacer(). Bornes uniques. */
const debut = src.indexOf('  /* Les trois tuiles cherchees, par leur libelle. */');
const fin = src.indexOf('  window.bhAnnulerKpi = function () {');
if (debut === -1 || fin === -1 || fin < debut) echec('Bornes du bloc introuvables.');

const NOUVEAU = `  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* ── Le deplacement ───────────────────────────────────────────
     Les trois tuiles sont deja reunies dans div.bh2-ops, et rien
     d'autre ne s'y trouve. Un seul noeud a deplacer : aucune detection,
     donc aucun pari. */
  function deplacer() {
    if (document.getElementById('bhKpiHaut')) return true;

    var ops = document.querySelector('.bh2-ops');
    var entete = document.getElementById('bhEnteteJour');
    var bande = document.getElementById('bhBandeJours');
    if (!ops) { diag.raison = 'div.bh2-ops introuvable'; return false; }
    if (!entete) { diag.raison = 'en-tete introuvable'; return false; }

    var tuiles = ops.querySelectorAll('.bh2-op');
    if (!tuiles.length) { diag.raison = 'aucune .bh2-op dans .bh2-ops'; return false; }

    /* « Votre journee » doit rester habitee : ses quatre mesures de fond
       vivent dans section.bh2-stats, hors de .bh2-ops. */
    var stats = document.querySelector('.bh2-stats');
    if (!stats || !stats.querySelectorAll('.bh2-stat').length) {
      diag.raison = 'section.bh2-stats absente — la carte serait vide, deplacement annule';
      return false;
    }
    diag.restantes = stats.querySelectorAll('.bh2-stat').length;

    /* On memorise la place exacte avant de bouger. */
    mem.push({ type: 'place', el: ops, parent: ops.parentElement, avant: ops.nextSibling });

    /* Trois colonnes egales. #kpiTodayMovesCard groupe deux tuiles sur
       trois : display:contents les rend freres dans la grille, sinon
       deux se serreraient dans une colonne. */
    memoriser(ops, 'display', 'grid');
    memoriser(ops, 'grid-template-columns', 'repeat(' + tuiles.length + ', 1fr)');
    memoriser(ops, 'gap', '8px');
    memoriser(ops, 'margin', '0 0 14px');
    memoriser(ops, 'padding', '0');

    var groupe = document.getElementById('kpiTodayMovesCard');
    if (groupe && groupe.querySelectorAll('.bh2-op').length) {
      memoriser(groupe, 'display', 'contents');
    }

    /* Compacite : le libelle et le chiffre suffisent a trois de front. */
    for (var i = 0; i < tuiles.length; i++) {
      var t = tuiles[i];
      memoriser(t, 'padding', '11px 12px');
      memoriser(t, 'margin', '0');
      memoriser(t, 'min-height', '0');
      memoriser(t, 'height', 'auto');
      diag.deplacees.push((t.querySelector('.bh2-op-lbl') || {}).textContent || '?');
    }
    ['.bh2-op-sub', '.bh2-op-ic'].forEach(function (sel) {
      var els = ops.querySelectorAll(sel);
      for (var j = 0; j < els.length; j++) memoriser(els[j], 'display', 'none');
    });
    var nums = ops.querySelectorAll('.bh2-op-num');
    for (var k = 0; k < nums.length; k++) {
      memoriser(nums[k], 'font-size', '26px');
      memoriser(nums[k], 'line-height', '1');
      memoriser(nums[k], 'margin', '4px 0 0');
    }

    ops.id = ops.id || '';
    ops.setAttribute('data-bh-kpi-haut', '1');

    /* Un repere stable pour le diagnostic, sans changer l'id d'origine. */
    var marque = document.createElement('div');
    marque.id = 'bhKpiHaut';
    marque.style.cssText = 'display:none';
    ops.appendChild(marque);
    mem.push({ type: 'place', el: marque, parent: null, avant: null });

    /* Au-dessus de la bande, sous l'en-tete. */
    var ancre = bande || entete.nextSibling;
    if (bande) bande.parentElement.insertBefore(ops, bande);
    else entete.parentElement.insertBefore(ops, entete.nextSibling);
    return true;
  }

`;

src = src.slice(0, debut) + NOUVEAU + src.slice(fin);

/* L'annulation doit savoir retirer la marque. */
const ancienne = `      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }`;
if (src.split(ancienne).length - 1 !== 1) echec('Bloc d\'annulation introuvable.');
src = src.split(ancienne).join(`      } else if (m.type === 'place') {
        if (m.parent) m.parent.insertBefore(m.el, m.avant);
        else if (m.el && m.el.parentElement) m.el.remove();
      }`);

const ancienRetrait = `    var r = document.getElementById('bhKpiHaut');
    if (r) r.remove();`;
if (src.split(ancienRetrait).length - 1 !== 1) echec('Retrait de la rangee introuvable.');
src = src.split(ancienRetrait).join(`    var ops = document.querySelector('[data-bh-kpi-haut]');
    if (ops) ops.removeAttribute('data-bh-kpi-haut');`);

/* Le diagnostic parle de .bh2-ops, plus d'une rangee fabriquee. */
const ancienDiag = `      rangee_posee: !!rangee,`;
if (src.split(ancienDiag).length - 1 !== 1) echec('Ligne du diagnostic introuvable.');
src = src.split(ancienDiag).join(`      deplacement_fait: !!document.querySelector('[data-bh-kpi-haut]'),`);

const ancienRangee = `    var rangee = document.getElementById('bhKpiHaut');
    var res = {`;
if (src.split(ancienRangee).length - 1 !== 1) echec('Debut du diagnostic introuvable.');
src = src.split(ancienRangee).join(`    var rangee = document.querySelector('[data-bh-kpi-haut]');
    var res = {`);

const ancienAvert = `    if (!res.rangee_posee) console.warn('Non deplacees : ' + (diag.raison || 'inconnu'));`;
if (src.split(ancienAvert).length - 1 !== 1) echec('Avertissement du diagnostic introuvable.');
src = src.split(ancienAvert).join(`    if (!res.deplacement_fait) console.warn('Non deplacees : ' + (diag.raison || 'inconnu'));`);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['le conteneur reel', "document.querySelector('.bh2-ops')"],
  ['les tuiles reelles', "ops.querySelectorAll('.bh2-op')"],
  ['le garde-fou sur les stats', "document.querySelector('.bh2-stats')"],
  ['display contents sur le groupe', "memoriser(groupe, 'display', 'contents')"],
  ['le masquage des sous-titres', "['.bh2-op-sub', '.bh2-op-ic']"],
  ['la marque', "ops.setAttribute('data-bh-kpi-haut', '1')"],
  ['le diagnostic', 'deplacement_fait:'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

if (src.indexOf('CHERCHEES') !== -1) echec('L\'ancienne detection subsiste. Refus.');
if (src.indexOf('tuileDepuisLibelle') !== -1) echec('L\'ancienne heuristique subsiste. Refus.');
if (src.split('function deplacer()').length - 1 !== 1) echec('deplacer est definie plusieurs fois. Refus.');

try {
  new Function(src);
} catch (e) {
  echec('Le module ne serait plus du JavaScript valide — ' + e.message);
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('bh2-ops') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Un seul noeud deplace : div.bh2-ops, qui contient exactement');
console.log('  les trois tuiles. Aucune detection, aucune heuristique.');
console.log('  Trois colonnes egales grace a display:contents sur');
console.log('  #kpiTodayMovesCard, qui en groupait deux sur trois.');
console.log('  Sous-titres et icones masques — le libelle et le chiffre');
console.log('  suffisent a trois de front sur 390 px.');
console.log('\n  Garde-fou : rien ne bouge si section.bh2-stats est absente.');
console.log('  Annulation :  bhAnnulerKpi()');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  1. Arrivées 7 · Départs 3 · Ménages 48h 6, sous le titre.');
console.log('  2. « Votre journee » garde ses quatre mesures de fond.');
console.log('  3. bhVerifKpi()  — deplacement_fait: true, au_dessus_de_la_bande: true.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

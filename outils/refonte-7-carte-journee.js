#!/usr/bin/env node
/* ============================================================
   outils/refonte-7-carte-journee.js
   Lot 7 : retirer « Votre journee », garder ses deux chiffres vivants
   ============================================================

   ── CE QUE LA CARTE CONTIENT ENCORE ──────────────────────────────
       Logements actifs   26      vivant
       Cautions           8       vivant
       Tout est valide    0       zero
       Notes sur reservations 0   zero

   Deux mesures utiles, deux zeros. Une carte entiere, un titre, une date
   repetee — pour deux nombres.

   ── CE QUE FAIT LE LOT ───────────────────────────────────────────
   La carte est masquee. Mais « 26 logements · 8 cautions » remonte dans
   la ligne du titre, sous « Aujourd'hui », en petit.

   Les noeuds sont DEPLACES : #kpiPropertiesValue et #kpiDepositsValue
   continuent d'etre mis a jour par le code qui les ecrit. Je ne recopie
   aucun chiffre — sinon vous auriez un 26 fige le jour ou vous passez a
   27 logements.

   Les deux zeros partent avec la carte. Ils ne disent rien quand tout va
   bien, et quand ils ne diront plus zero, ils meritent mieux qu'un coin
   de carte : une ligne dans « A traiter », visible.

   ── REVERSIBLE ───────────────────────────────────────────────────
   bhAnnulerCarte() remet la carte et ses chiffres a leur place.

   Usage :
     node outils/refonte-7-carte-journee.js --essai
     node outils/refonte-7-carte-journee.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const MODULE = path.join(PUBLIC, 'js', 'bh-carte-journee.js');
const APP = path.join(PUBLIC, 'app.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-entete-jour.js'))) {
  echec('bh-entete-jour.js absent. Lancez d\'abord les lots 3.');
}

const SOURCE = `/* ============================================================
   bh-carte-journee.js — la carte part, ses chiffres restent
   ============================================================
   « Votre journee » ne contenait plus que deux mesures vivantes et deux
   zeros. Les deux mesures remontent sous le titre ; la carte est masquee.

   Les valeurs sont DEPLACEES, pas recopiees : le code qui les met a jour
   continue de le faire.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhCarteJournee) return;
  window.__bhCarteJournee = true;

  var GRIS = '#8B8B84';
  var mem = [];
  var diag = { carte_masquee: false, chiffres_remontes: [], raison: '' };

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  function carte() {
    var stats = document.querySelector('.bh2-stats');
    if (!stats) return null;
    var c = stats.closest('.card, [class*="card"], section') || stats.parentElement;
    var garde = 0;
    while (c && c.parentElement && c.getBoundingClientRect().height < 120 && garde++ < 5) c = c.parentElement;
    return c;
  }

  function remonter() {
    if (document.getElementById('bhChiffresFond')) return true;

    var entete = document.getElementById('bhEnteteJour');
    var c = carte();
    if (!entete || !c) { diag.raison = 'en-tete ou carte introuvable'; return false; }

    /* Le cote gauche de l'en-tete porte la date et le titre. */
    var gauche = entete.firstElementChild;
    if (!gauche) { diag.raison = 'cote gauche de l\\'en-tete introuvable'; return false; }

    var ligne = document.createElement('div');
    ligne.id = 'bhChiffresFond';
    ligne.style.cssText = 'display:flex;align-items:baseline;gap:6px;margin-top:6px'
      + ';font-size:13px;color:' + GRIS + ';flex-wrap:wrap';

    var paires = [
      { val: 'kpiPropertiesValue', mot: 'logements' },
      { val: 'kpiDepositsValue', mot: 'cautions' }
    ];
    var poses = 0;

    paires.forEach(function (p, i) {
      var v = document.getElementById(p.val);
      if (!v) return;
      if (i && poses) {
        var sep = document.createElement('span');
        sep.textContent = '\\u00b7';
        sep.style.cssText = 'color:#C4C0B6';
        ligne.appendChild(sep);
      }
      mem.push({ type: 'place', el: v, parent: v.parentElement, avant: v.nextSibling });
      memoriser(v, 'font-size', '13px');
      memoriser(v, 'font-weight', '600');
      memoriser(v, 'color', '#3D4A44');
      memoriser(v, 'margin', '0');
      memoriser(v, 'display', 'inline');
      ligne.appendChild(v);

      var mot = document.createElement('span');
      mot.textContent = p.mot;
      ligne.appendChild(mot);
      poses++;
      diag.chiffres_remontes.push(p.mot);
    });

    if (!poses) { diag.raison = 'aucun chiffre vivant trouve — carte laissee en place'; return false; }

    gauche.appendChild(ligne);

    /* La carte peut partir : ce qu'elle portait d'utile est remonte. */
    memoriser(c, 'display', 'none');
    diag.carte_masquee = true;
    return true;
  }

  window.bhAnnulerCarte = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }
    }
    var l = document.getElementById('bhChiffresFond');
    if (l) l.remove();
    var n = mem.length;
    mem = [];
    console.log(n + ' changement(s) annule(s). La carte « Votre journee » est revenue.');
    return n;
  };

  window.bhVerifCarte = function () {
    var res = {
      carte_masquee: diag.carte_masquee,
      chiffres_remontes: diag.chiffres_remontes,
      ligne_posee: !!document.getElementById('bhChiffresFond'),
      valeurs_lues: {
        logements: (document.getElementById('kpiPropertiesValue') || {}).textContent,
        cautions: (document.getElementById('kpiDepositsValue') || {}).textContent
      },
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── Carte « Votre journee » ──');
    console.log(res);
    if (!res.carte_masquee) console.warn('Non masquee : ' + (diag.raison || 'inconnu'));
    console.log('Pour revenir en arriere : bhAnnulerCarte()');
    return res;
  };

  function demarrer() { remonter(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 2200); });
  } else {
    setTimeout(demarrer, 2200);
  }
  setTimeout(demarrer, 4200);
  setTimeout(demarrer, 6800);
})();
`;

const BALISE = '<script src="js/bh-carte-journee.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etat;

if (html.indexOf('bh-carte-journee.js') !== -1) {
  etat = 'deja';
} else {
  const ancre = html.indexOf('bh-listes-jour.js');
  const secours = ancre === -1 ? html.indexOf('bh-kpi-haut.js') : ancre;
  if (secours === -1) echec('Aucun module des lots 4 ou 5 dans app.html.');
  const fin = html.indexOf('</script>', secours);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etat = 'apres ' + (ancre === -1 ? 'bh-kpi-haut.js' : 'bh-listes-jour.js');
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerCarte') === -1) echec("Le module n'est pas complet apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  public/js/bh-carte-journee.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html             ' + etat);
console.log('\n  La carte est masquee. « 26 logements · 8 cautions » remonte');
console.log('  sous « Aujourd\'hui », en petit.');
console.log('  Les valeurs sont DEPLACEES : elles restent mises a jour par');
console.log('  le code d\'origine. Aucun chiffre recopie, donc aucun 26 fige');
console.log('  le jour ou vous passez a 27.');
console.log('  Les deux zeros partent : ils ne disent rien quand tout va bien.');
console.log('\n  Garde-fou : si aucun chiffre vivant n\'est trouve, la carte');
console.log('  reste en place. Annulation :  bhAnnulerCarte()');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  bhVerifCarte()  — carte_masquee: true, deux chiffres remontes.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/refonte-12-onglet-calendrier.js
   Lot 12 : l'onglet Calendrier montre le vrai calendrier
   ============================================================

   ── CE QUE LA SONDE A ETABLI ─────────────────────────────────────
   224 Ko de code animent le calendrier, repartis en dix scripts inline
   de app.html. Sept sur dix nomment aussi des noeuds etrangers au
   calendrier : les modales de reservation, le reordonnancement des
   logements, les restrictions KPI, les services mobiles.

   Les trois « voyageables » sont anecdotiques : un lieur de scroll et
   deux surcouches de prix.

   Deplacer ce calendrier, ce n'est donc pas un lot. C'est demeler 224 Ko
   entrelaces avec la page qui fonctionne aujourd'hui, et accepter la
   regression pendant qu'on demele.

   ── LA ROUTE COURTE, ET POURQUOI ELLE EST HONNETE ────────────────
   Le calendrier reste ou vit son code. C'est l'onglet qui vient a lui.

       L'onglet Calendrier pointe sur app.html?vue=calendrier
       Un module masque tout sauf <section id="calendarSection">

   Vous obtenez un onglet Calendrier plein ecran, avec les vraies
   donnees, sans qu'une ligne du moteur ne bouge. Aucun code duplique,
   donc aucun risque de voir les deux versions diverger.

   reservations.html n'est pas modifie : il est mis de cote par le fait
   de ne plus etre la destination. Le jour ou vous voudrez en faire
   autre chose, il est intact.

   ── CE QUE CE LOT NE PRETEND PAS ETRE ────────────────────────────
   Ce n'est pas le deplacement que vous avez demande. C'est le resultat
   que vous cherchiez, obtenu autrement. La difference se voit a un seul
   endroit : l'adresse dans la barre du navigateur reste app.html.

   Si cette adresse vous gene, le vrai deplacement reste possible — mais
   il faut savoir ce qu'on achete : plusieurs jours, et le moteur du
   calendrier reecrit.

   ── TROIS MODIFICATIONS ──────────────────────────────────────────
   1. bh-barre-onglets.js   l'onglet Calendrier change de destination
   2. bh-aujourdhui-allege.js  se tait en vue calendrier, sinon il
                            masquerait le calendrier qu'on vient montrer
   3. bh-vue-calendrier.js  le module de la vue, nouveau

   ── REVERSIBLE ───────────────────────────────────────────────────
   bhAnnulerVueCalendrier()  rend la page complete, sans rechargement

   Usage :
     node outils/refonte-12-onglet-calendrier.js --essai
     node outils/refonte-12-onglet-calendrier.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const APP = path.join(PUBLIC, 'app.html');
const BARRE = path.join(PUBLIC, 'js', 'bh-barre-onglets.js');
const ALLEGE = path.join(PUBLIC, 'js', 'bh-aujourdhui-allege.js');
const MODULE = path.join(PUBLIC, 'js', 'bh-vue-calendrier.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(APP)) echec('public/app.html introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(BARRE)) echec('bh-barre-onglets.js introuvable.');

const app0 = fs.readFileSync(APP, 'utf8');
if (app0.indexOf('id="calendarSection"') === -1) {
  echec('id="calendarSection" absent de app.html : la vue n\'aurait rien a montrer.');
}

/* ============================================================
   1. La barre d'onglets
   ============================================================ */

let barre = fs.readFileSync(BARRE, 'utf8');
let etatBarre;

if (barre.indexOf("dest: 'app.html?vue=calendrier'") !== -1) {
  etatBarre = 'deja applique';
} else {
  const remplacer = (avant, apres, quoi) => {
    const n = barre.split(avant).length - 1;
    if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois dans bh-barre-onglets.js (attendu : 1).');
    barre = barre.split(avant).join(apres);
  };

  /* « page » reste reservations.html : c'est par elle que l'onglet est
     RECONNU dans la barre existante. « dest » est la destination. Les
     confondre casserait l'appariement. */
  remplacer(
    "{ cle: 'calendrier', libelle: 'Calendrier',  page: 'reservations.html', mots: ['réservation', 'reservation', 'calendrier'] },",
    "{ cle: 'calendrier', libelle: 'Calendrier',  page: 'reservations.html', dest: 'app.html?vue=calendrier', mots: ['réservation', 'reservation', 'calendrier'] },",
    "l'onglet Calendrier"
  );

  remplacer(
    "      if (el.tagName === 'A') el.setAttribute('href', '/' + p.vise.page);",
    "      if (el.tagName === 'A') el.setAttribute('href', '/' + (p.vise.dest || p.vise.page));",
    'le lien de l\'onglet'
  );

  remplacer(
`        var page = p.vise.page;
        el.addEventListener('click', function (ev) {
          var ici = location.pathname.split('/').pop().toLowerCase();
          if (ici === page) return; /* deja sur place : on laisse faire */
          ev.preventDefault();
          ev.stopImmediatePropagation();
          location.href = '/' + page;
        }, true);`,
`        var dest = p.vise.dest || p.vise.page;
        el.addEventListener('click', function (ev) {
          var cible = dest.split('?')[0].toLowerCase();
          var recherche = dest.indexOf('?') !== -1 ? '?' + dest.split('?')[1] : '';
          var ici = location.pathname.split('/').pop().toLowerCase();
          /* Deja sur place : meme fichier ET meme vue. Sans la seconde
             condition, Aujourd'hui et Calendrier deviendraient le meme
             bouton, puisqu'ils partagent app.html. */
          if (ici === cible && (location.search || '') === recherche) return;
          ev.preventDefault();
          ev.stopImmediatePropagation();
          location.href = '/' + dest;
        }, true);`,
    'le clic de l\'onglet'
  );

  remplacer(
    "      etat.renommes.push(p.vise.libelle + ' \\u2192 ' + p.vise.page);",
    "      etat.renommes.push(p.vise.libelle + ' \\u2192 ' + (p.vise.dest || p.vise.page));",
    'le journal de la barre'
  );

  try { new Function(barre); } catch (e) { echec('bh-barre-onglets.js ne serait plus valide — ' + e.message); }
  etatBarre = 'Calendrier -> app.html?vue=calendrier';
}

/* ============================================================
   2. Le module d'allegement se tait en vue calendrier
   ============================================================ */

let etatAllege = 'absent (rien a faire)';
let allege = null;

if (fs.existsSync(ALLEGE)) {
  allege = fs.readFileSync(ALLEGE, 'utf8');
  if (allege.indexOf("vue=calendrier") !== -1) {
    etatAllege = 'deja applique';
  } else {
    const avant = `  if (window.__bhAujourdhuiAllege) return;
  window.__bhAujourdhuiAllege = true;`;
    const n = allege.split(avant).length - 1;
    if (n !== 1) echec('Le garde d\'entree de bh-aujourdhui-allege.js est introuvable (' + n + ').');
    allege = allege.split(avant).join(`  if (window.__bhAujourdhuiAllege) return;
  /* En vue calendrier, ce module n'a rien a alleger — et il masquerait
     precisement le calendrier qu'on vient afficher. */
  if ((location.search || '').indexOf('vue=calendrier') !== -1) return;
  window.__bhAujourdhuiAllege = true;`);
    try { new Function(allege); } catch (e) { echec('bh-aujourdhui-allege.js ne serait plus valide — ' + e.message); }
    etatAllege = 'se tait en vue calendrier';
  }
}

/* ============================================================
   3. Le module de la vue
   ============================================================ */

const SOURCE = `/* ============================================================
   bh-vue-calendrier.js — app.html?vue=calendrier
   ============================================================
   Le calendrier ne peut pas quitter app.html : 224 Ko de code l'y
   retiennent, tisses avec les modales, le reordonnancement et les
   restrictions de la page. Alors c'est l'onglet qui vient a lui.

   En vue calendrier, tout est masque sauf <section id="calendarSection">.
   Rien n'est deplace, rien n'est duplique : le moteur tourne chez lui,
   et une seule section reste visible.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhVueCalendrier) return;
  if ((location.search || '').indexOf('vue=calendrier') === -1) return;
  window.__bhVueCalendrier = true;

  var mem = [];
  var diag = { section: false, masques: 0, raison: '', voisins: [] };

  function memoriser(el, prop, valeur) {
    mem.push({ el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* Ce qui doit rester visible quoi qu'il arrive : la barre du bas, et
     les modales du calendrier lui-meme. */
  function intouchable(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.id === 'calendarSection') return true;
    var c = ' ' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '')) + ' ';
    if (/tabbar|tab-bar|mobile-tabs|mobile-nav|sidebar-overlay|modal/i.test(c)) return true;
    if (/modal/i.test(el.id || '')) return true;
    if (el.querySelector && el.querySelector('#calendarSection')) return true;
    return false;
  }

  function appliquer() {
    var section = document.getElementById('calendarSection');
    if (!section) { diag.raison = 'section calendrier pas encore rendue'; return false; }
    diag.section = true;

    /* On remonte de la section jusqu'au corps, et a chaque niveau on
       masque ses freres. La section reste donc dans sa chaine de
       parents — sa mise en page n'est pas touchee. */
    var courant = section;
    var garde = 0;
    while (courant && courant.parentElement && courant !== document.body && garde++ < 12) {
      var parent = courant.parentElement;
      for (var i = 0; i < parent.children.length; i++) {
        var frere = parent.children[i];
        if (frere === courant || intouchable(frere)) continue;
        if (frere.dataset && frere.dataset.bhVueMasque) continue;
        if (getComputedStyle(frere).display === 'none') continue;
        memoriser(frere, 'display', 'none');
        if (frere.dataset) frere.dataset.bhVueMasque = '1';
        diag.masques++;
        diag.voisins.push((frere.id ? '#' + frere.id : frere.tagName.toLowerCase())
          + (frere.className && typeof frere.className === 'string' ? '.' + frere.className.split(/\\s+/)[0] : ''));
      }
      courant = parent;
    }

    /* La section prend la place laissee libre. */
    memoriser(section, 'margin', '0');
    var pere = section.parentElement;
    if (pere) memoriser(pere, 'padding-top', '8px');

    return true;
  }

  window.bhAnnulerVueCalendrier = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
      else m.el.style.removeProperty(m.prop);
      if (m.el.dataset) delete m.el.dataset.bhVueMasque;
    }
    var n = mem.length;
    mem = [];
    diag.masques = 0;
    diag.voisins = [];
    console.log(n + ' changement(s) annule(s). La page complete est revenue.');
    return n;
  };

  window.bhVerifVueCalendrier = function () {
    var s = document.getElementById('calendarSection');
    var res = {
      vue_active: true,
      section_trouvee: diag.section,
      section_visible: !!(s && getComputedStyle(s).display !== 'none'),
      voisins_masques: diag.masques,
      exemples: diag.voisins.slice(0, 12),
      barre_onglets_visible: !!document.querySelector('.mobile-tabs, [class*="tabbar"], [class*="tab-bar"]'),
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── Vue calendrier ──');
    console.log(res);
    if (!res.section_visible) console.warn('Le calendrier n\\'est pas visible : ' + (diag.raison || 'inconnu'));
    console.log('Pour revenir a la page complete : bhAnnulerVueCalendrier()');
    return res;
  };

  function demarrer() { appliquer(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 400); });
  } else {
    setTimeout(demarrer, 400);
  }
  /* Le calendrier et ses voisins arrivent par vagues : on repasse. */
  [1200, 2400, 4000, 6500, 9000].forEach(function (t) { setTimeout(demarrer, t); });
})();
`;

const BALISE = '<script src="js/bh-vue-calendrier.js"></script>';

let html = app0;
let etatApp;

if (html.indexOf('bh-vue-calendrier.js') !== -1) {
  etatApp = 'balise deja presente';
} else {
  let ancre = html.indexOf('bh-barre-onglets.js');
  let nom = 'bh-barre-onglets.js';
  if (ancre === -1) { ancre = html.indexOf('bh-aujourdhui-allege.js'); nom = 'bh-aujourdhui-allege.js'; }
  if (ancre === -1) { ancre = html.indexOf('bh-entete-jour.js'); nom = 'bh-entete-jour.js'; }
  if (ancre === -1) echec('Aucun module des lots precedents dans app.html.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etatApp = 'balise ajoutee apres ' + nom;
}

/* ── Verifications avant ecriture ─────────────────────────────── */

try { new Function(SOURCE); } catch (e) { echec('Le module ne serait pas valide — ' + e.message); }
if (SOURCE.indexOf('bhAnnulerVueCalendrier') === -1) echec('Annulation absente du module.');

if (!ESSAI) {
  fs.writeFileSync(BARRE, barre, 'utf8');
  if (allege) fs.writeFileSync(ALLEGE, allege, 'utf8');
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  if (html !== app0) fs.writeFileSync(APP, html, 'utf8');

  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerVueCalendrier') === -1) echec("Le module n'est pas complet apres ecriture.");
  if (fs.readFileSync(BARRE, 'utf8').indexOf('vue=calendrier') === -1) echec("La barre n'a pas ete modifiee.");
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  bh-barre-onglets.js         ' + etatBarre);
console.log('  bh-aujourdhui-allege.js     ' + etatAllege);
console.log('  bh-vue-calendrier.js        nouveau (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html                    ' + etatApp);
console.log('\n  L\'onglet Calendrier ouvre app.html?vue=calendrier, ou tout est');
console.log('  masque sauf <section id="calendarSection">. Le moteur du');
console.log('  calendrier tourne chez lui : aucun code duplique, donc aucune');
console.log('  chance de voir deux versions diverger.');
console.log('\n  reservations.html n\'est pas modifie. Il est mis de cote par le');
console.log('  fait de ne plus etre la destination — et reste intact.');
console.log('\n  Ce que ce lot n\'est pas : le deplacement demande. L\'adresse');
console.log('  reste app.html. Si cela vous gene, le vrai deplacement coute');
console.log('  plusieurs jours et le moteur du calendrier reecrit — la sonde');
console.log('  11c a montre pourquoi.');
console.log('\n  A verifier sur telephone, cache vide :');
console.log('    onglet Calendrier -> le calendrier seul, plein ecran');
console.log('    bhVerifVueCalendrier()   section_visible: true');
console.log('    onglet Aujourd\'hui -> la page du matin, inchangee');
console.log('\n  Annulation sans rechargement : bhAnnulerVueCalendrier()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

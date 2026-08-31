#!/usr/bin/env node
/* ============================================================
   outils/refonte-12-entete-calendrier.js
   Lot 12 : l'en-tete de la maquette, et les resas sous le calendrier
   ============================================================

   ── CE QUE DIT LA MAQUETTE ───────────────────────────────────────
       « 32 % d'occupation ce mois »   en petit
       « Calendrier »                  en grand
       la loupe et les initiales       a droite, meme ligne
       [votre calendrier]              inchange
       les mouvements du jour          dessous

   Deux gestes, et une suppression que je vous soumets.

   ── 1. L'EN-TETE ─────────────────────────────────────────────────
   Meme forme que celui d'Aujourd'hui. Le pourcentage n'est pas
   recalcule : il est LU dans la carte Occupation avant que celle-ci ne
   disparaisse. Un seul endroit calcule l'occupation, et ce n'est pas
   moi — sinon vos deux chiffres finiraient par differer.

   La loupe suit la lecon du lot 3h : le composant de recherche recree
   son bouton a intervalles, donc on n'essaie pas de le deplacer. L'en-
   tete porte SA loupe, qui declenche l'originale au clic.

   Le rond aux initiales, lui, porte un identifiant unique : il est
   deplace, une fois, sans risque de doublon.

   ── 2. LES MOUVEMENTS SOUS LE CALENDRIER ─────────────────────────
   Je n'ecris pas une troisieme liste. bh-liste-unifiee.js existe, lit
   /api/aujourdhui/etats — la seule source qui voit vos sept arrivees,
   BHGuest comprises — et sait deja distinguer « a traiter », arrivees et
   departs.

   Le lot 9 l'avait simplement empeche de se lancer en vue calendrier,
   pour arreter la course avec le masquage. Il n'a pas besoin d'etre
   reecrit : il a besoin d'un point d'ancrage. En vue calendrier, il
   s'insere apres le calendrier, dans le conteneur de la vue. Ailleurs,
   rien ne change pour lui.

   ── 3. CE QUE JE SUPPRIME, ET POURQUOI JE LE DIS ─────────────────
   Les trois cartes du mois — CA mensuel, Occupation, Automatisation —
   sont masquees dans la vue calendrier.

   Vous m'aviez demande « tout ce qui est l'ecran 3 », et le lot 8 les y
   avait montees. Mais votre maquette ne les montre pas, et son sous-
   titre porte deja l'occupation. Je suis la maquette, qui est la
   demande la plus recente.

   Si vous voulez le CA mensuel de retour, c'est un mot : il reviendra
   entre l'en-tete et le calendrier. Rien n'est supprime, seulement
   masque, et bhAnnulerEnteteCal() rend tout.

   Usage :
     node outils/refonte-12-entete-calendrier.js --essai
     node outils/refonte-12-entete-calendrier.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(process.cwd(), 'public');
const JS = path.join(PUBLIC, 'js');
const LISTE = path.join(JS, 'bh-liste-unifiee.js');
const MODULE = path.join(JS, 'bh-entete-calendrier.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const PAGES = ['app.html', 'calendrier.html', 'messages.html', 'reservations.html', 'settings.html', 'deposits.html', 'factures.html', 'cleaning.html'];

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(LISTE)) echec('public/js/bh-liste-unifiee.js introuvable.');
if (!fs.existsSync(path.join(JS, 'bh-vue-calendrier.js'))) echec('bh-vue-calendrier.js introuvable.');

let liste = fs.readFileSync(LISTE, 'utf8');
const ecrire = [];

/* ============================================================
   1. bh-liste-unifiee.js — un point d'ancrage en vue calendrier
   ============================================================ */

if (liste.indexOf('enVueCalendrier') === -1) {
  liste = (function () {
    const AVANT = `  /* En vue calendrier, ce module n'a rien a construire — et ce qu'il
     construirait reapparaitrait par-dessus le calendrier, apres le
     masquage. Un module qui ne se lance pas ne peut pas defaire le
     travail d'un autre. */
  if ((location.search || '').indexOf('vue=calendrier') !== -1) return;
  if ((location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html') return;`;
    if (liste.split(AVANT).length - 1 !== 1) echec('La clause du lot 9 est introuvable dans bh-liste-unifiee.js.');
    return liste.split(AVANT).join(
`  /* En vue calendrier, ce module a bien quelque chose a construire : les
     mouvements du jour, sous le calendrier. Ce qui lui manquait n'etait
     pas le droit de tourner, c'etait un point d'ancrage — il visait la
     bande de sept jours, qui n'existe pas la. */
  var enVueCalendrier = (location.search || '').indexOf('vue=calendrier') !== -1
    || (location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html';`);
  })();

  const ANCRE = `  function ancre() {
    var vieux = document.getElementById('bhListesJour');`;
  if (liste.split(ANCRE).length - 1 !== 1) echec('La fonction ancre() est introuvable.');
  liste = liste.split(ANCRE).join(
`  function ancre() {
    /* Vue calendrier : apres le calendrier, dans le conteneur de la vue.
       Tant que bh-vue-calendrier n'a pas pose sa racine, on attend —
       inserer avant reviendrait a etre masque avec le reste. */
    if (enVueCalendrier) {
      var racine = document.getElementById('bhVueRacine');
      var section = document.getElementById('calendarSection');
      if (!racine || !section || section.parentElement !== racine) return null;
      return { parent: racine, avant: section.nextSibling };
    }
    var vieux = document.getElementById('bhListesJour');`);

  /* La racine peut etre posee tard : on repasse plus longtemps. */
  const FIN = '  setTimeout(charger, 5800);';
  if (liste.split(FIN).length - 1 !== 1) echec('Les passages de charger() sont introuvables.');
  liste = liste.split(FIN).join(
`  setTimeout(charger, 5800);
  /* bh-vue-calendrier peut poser sa racine jusqu'a 11 s : sans ces
     passages, la liste renoncerait avant qu'elle existe. */
  [8000, 11500, 14000].forEach(function (t) { setTimeout(charger, t); });`);

  try { new Function(liste); }
  catch (e) { echec('bh-liste-unifiee.js ne serait plus du JavaScript valide — ' + e.message); }
  ecrire.push([LISTE, liste]);
}

/* ============================================================
   2. Le module d'en-tete
   ============================================================ */

const SOURCE = `/* ============================================================
   bh-entete-calendrier.js — l'en-tete de la vue calendrier
   ============================================================
   « X % d'occupation ce mois » / « Calendrier », loupe et initiales a
   droite. Le pourcentage est LU dans la carte Occupation, jamais
   recalcule : un seul endroit calcule l'occupation.
   ============================================================ */
(function () {
  'use strict';

  var enVue = (location.search || '').indexOf('vue=calendrier') !== -1
    || (location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html';
  if (!enVue) return;
  if (window.__bhEnteteCalendrier) return;
  window.__bhEnteteCalendrier = true;

  var ENCRE = '#0D1117';
  var GRIS = '#8B8B84';
  var VERT = '#0E3B2E';

  var mem = [];
  var diag = { entete: false, occupation: null, loupe: false, rond: false, cartes: [] };

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* Le pourcentage, lu la ou il est calcule. Si la carte ne l'a pas
     encore, on n'invente pas : le sous-titre reste vide et se remplira
     au passage suivant. */
  function occupation() {
    var c = document.getElementById('kpiOccupancyCard');
    if (!c) return null;
    var m = (c.textContent || '').match(/(\\d{1,3})\\s*%/);
    return m ? m[1] : null;
  }

  var SVG_LOUPE = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"'
    + ' stroke="#3D4A44" stroke-width="1.9" stroke-linecap="round">'
    + '<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20.5 20.5"/></svg>';

  function loupeOriginale() {
    var tous = document.querySelectorAll('.bhgs-trigger-mobile, .bhgs-trigger, [class*="bhgs-trigger"]');
    for (var i = 0; i < tous.length; i++) {
      if (tous[i].id === 'bhLoupeEntete' || tous[i].id === 'bhLoupeCal') continue;
      return tous[i];
    }
    return null;
  }

  function poser() {
    var racine = document.getElementById('bhVueRacine');
    if (!racine) return false;

    var pct = occupation();
    if (pct) diag.occupation = pct + ' %';

    var bloc = document.getElementById('bhEnteteCal');
    if (!bloc) {
      bloc = document.createElement('div');
      bloc.id = 'bhEnteteCal';
      bloc.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px'
        + ';padding:8px 4px 14px;font-family:inherit';

      var gauche = document.createElement('div');
      gauche.style.cssText = 'min-width:0';
      var sous = document.createElement('div');
      sous.id = 'bhEnteteCalSous';
      sous.textContent = pct ? pct + " % d'occupation ce mois" : '';
      sous.style.cssText = 'font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em;min-height:18px';
      gauche.appendChild(sous);
      var titre = document.createElement('div');
      titre.textContent = 'Calendrier';
      titre.style.cssText = 'margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE;
      gauche.appendChild(titre);
      bloc.appendChild(gauche);

      var droite = document.createElement('div');
      droite.id = 'bhEnteteCalCommandes';
      droite.style.cssText = 'flex:none;display:flex;align-items:center;gap:9px;padding-top:5px';
      bloc.appendChild(droite);

      racine.insertBefore(bloc, racine.firstChild);
      diag.entete = true;
    } else {
      /* Le pourcentage arrive parfois apres nous. */
      var s = document.getElementById('bhEnteteCalSous');
      if (s && pct && !s.textContent) s.textContent = pct + " % d'occupation ce mois";
    }

    /* L'en-tete doit rester le premier enfant : bh-vue-calendrier
       deplace des blocs dans la racine apres nous. */
    if (racine.firstChild !== bloc) racine.insertBefore(bloc, racine.firstChild);

    var droiteEl = document.getElementById('bhEnteteCalCommandes');
    if (droiteEl) {
      /* Notre loupe, creee une fois. Le composant de recherche recree la
         sienne a intervalles : la deplacer en produirait une de plus a
         chaque passage — la lecon du lot 3h. */
      if (!document.getElementById('bhLoupeCal')) {
        var b = document.createElement('button');
        b.id = 'bhLoupeCal';
        b.type = 'button';
        b.setAttribute('aria-label', 'Rechercher');
        b.style.cssText = 'flex:none;width:40px;height:40px;padding:0;border:1px solid #E4E1D8'
          + ';border-radius:50%;background:#fff;display:inline-flex;align-items:center'
          + ';justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent';
        b.innerHTML = SVG_LOUPE;
        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var orig = loupeOriginale();
          if (!orig) { console.warn('[entete cal] aucun bouton de recherche a declencher'); return; }
          var avant = orig.style.display;
          orig.style.removeProperty('display');
          try { orig.click(); } catch (e) {}
          setTimeout(function () { orig.style.display = avant; }, 60);
        });
        droiteEl.appendChild(b);
        diag.loupe = true;
      }

      /* Le rond porte un identifiant unique : un seul deplacement. */
      var rond = document.getElementById('bhAvatarHeader');
      if (rond && rond.parentElement !== droiteEl) {
        mem.push({ type: 'place', el: rond, parent: rond.parentElement, avant: rond.nextSibling });
        rond.style.setProperty('margin', '0', 'important');
        droiteEl.appendChild(rond);
        diag.rond = true;
      }
    }

    /* Les trois cartes du mois : la maquette ne les montre pas, et son
       sous-titre porte deja l'occupation. Masquees, pas supprimees. */
    ['.bh2-feat', '#kpiOccupancyCard', '#kpiAutoCard'].forEach(function (sel) {
      var c = document.querySelector(sel);
      if (!c || c.dataset.bhCalMasquee) return;
      c.dataset.bhCalMasquee = '1';
      memoriser(c, 'display', 'none');
      diag.cartes.push(sel);
    });

    return true;
  }

  window.bhAnnulerEnteteCal = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
        delete m.el.dataset.bhCalMasquee;
      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }
    }
    var b = document.getElementById('bhEnteteCal');
    if (b) b.remove();
    var n = mem.length;
    mem = [];
    console.log(n + ' changement(s) annule(s) : les trois cartes du mois sont revenues.');
    return n;
  };

  window.bhVerifEnteteCal = function () {
    var racine = document.getElementById('bhVueRacine');
    var bloc = document.getElementById('bhEnteteCal');
    var section = document.getElementById('calendarSection');
    var liste = document.getElementById('bhListeUnifiee');
    var res = {
      entete_pose: !!bloc,
      premier_dans_la_vue: !!(racine && bloc && racine.firstChild === bloc),
      occupation_lue: diag.occupation,
      loupe_propre: !!document.getElementById('bhLoupeCal'),
      rond_deplace: diag.rond,
      cartes_masquees: diag.cartes,
      liste_sous_le_calendrier: !!(liste && section && section.nextElementSibling === liste),
      liste_affichee: !!liste,
      annulable: mem.length + ' changement(s) memorise(s)'
    };
    console.log('── En-tete calendrier ──');
    console.log(res);
    if (!res.entete_pose) console.warn('En-tete non pose : bhVueRacine absente (la vue calendrier ne s est pas posee).');
    if (!res.liste_affichee) console.warn('Liste absente : tapez bhVerifListeUnifiee() pour la raison.');
    console.log('Pour revenir en arriere : bhAnnulerEnteteCal()');
    return res;
  };

  function demarrer() { poser(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 900); });
  } else {
    setTimeout(demarrer, 900);
  }
  [1800, 3000, 4500, 7000, 10000, 13000].forEach(function (t) { setTimeout(demarrer, t); });
})();
`;

try { new Function(SOURCE); }
catch (e) { echec('Le module ne serait pas du JavaScript valide — ' + e.message); }

const BALISE = '<script src="js/bh-entete-calendrier.js"></script>';
const rapport = [];

PAGES.forEach(function (nom) {
  const p = path.join(PUBLIC, nom);
  if (!fs.existsSync(p)) { rapport.push([nom, 'absente']); return; }
  let html = fs.readFileSync(p, 'utf8');
  if (html.indexOf('bh-entete-calendrier.js') !== -1) { rapport.push([nom, 'deja']); return; }

  const ancre = html.indexOf('bh-vue-calendrier.js');
  const secours = ancre === -1 ? html.indexOf('bh-liste-unifiee.js') : ancre;
  if (secours === -1) { rapport.push([nom, 'sans vue calendrier — ignoree']); return; }
  const fin = html.indexOf('</script>', secours);
  if (fin === -1) { rapport.push([nom, 'balise mal formee — ignoree']); return; }

  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  ecrire.push([p, html]);
  rapport.push([nom, 'apres ' + (ancre === -1 ? 'bh-liste-unifiee.js' : 'bh-vue-calendrier.js')]);
});

const posees = rapport.filter(function (r) { return r[1].indexOf('apres') === 0; }).length;
if (!posees && !ecrire.length) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}
if (!posees) echec("Aucune page n'a recu le module.");

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  ecrire.forEach(function (p) { fs.writeFileSync(p[0], p[1], 'utf8'); });
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhVerifEnteteCal') === -1) echec("Le module n'est pas complet apres ecriture.");
  if (fs.readFileSync(LISTE, 'utf8').indexOf('enVueCalendrier') === -1) {
    echec("Le point d'ancrage n'est pas dans bh-liste-unifiee.js apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-entete-calendrier.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  bh-liste-unifiee.js         point d\'ancrage en vue calendrier');
rapport.forEach(function (r) { console.log('  ' + (r[0] + '                    ').slice(0, 20) + r[1]); });
console.log('\n  « X % d\'occupation ce mois » / « Calendrier », loupe et');
console.log('  initiales a droite. Le pourcentage est LU dans la carte');
console.log('  Occupation, jamais recalcule.');
console.log('  Les mouvements du jour viennent de bh-liste-unifiee, qui lit');
console.log('  /api/aujourdhui/etats — la seule source qui voit vos sept');
console.log('  arrivees. Aucune troisieme liste ecrite.');
console.log('\n  Les trois cartes du mois sont MASQUEES : votre maquette ne les');
console.log('  montre pas. Un mot et le CA mensuel revient sous l\'en-tete.');
console.log('  bhAnnulerEnteteCal() les rend toutes.');
console.log('\n  A verifier sur telephone, cache vide : /calendrier.html');
console.log('  1. En-tete « 32 % d\'occupation ce mois / Calendrier ».');
console.log('  2. Votre calendrier, inchange, juste dessous.');
console.log('  3. Les mouvements du jour sous le calendrier.');
console.log('  4. bhVerifEnteteCal()  — premier_dans_la_vue et');
console.log('     liste_sous_le_calendrier a true.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

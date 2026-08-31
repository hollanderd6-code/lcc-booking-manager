#!/usr/bin/env node
/* ============================================================
   outils/refonte-19-messages-epure.js
   Lot 19 : la barre de marque part, la recherche se replie
   ============================================================

   ── CE QUI PART ──────────────────────────────────────────────────
   La barre BOOSTINGHOST en haut, et le bandeau de recherche toujours
   ouvert. Sur un telephone, une marque en haut de chaque ecran occupe
   la place du contenu : vous savez dans quelle application vous etes.
   Les autres ecrans ne la montrent pas — Messages devient coherent.

   ── LA RECHERCHE N'EST PAS SUPPRIMEE, ELLE SE REPLIE ─────────────
   Le champ existe toujours ; il est simplement ferme. La loupe de
   l'en-tete l'ouvre, lui donne le focus, et la referme si on la
   retouche ou si on quitte un champ vide.

   Sans cela la loupe de l'en-tete pointerait vers un champ masque :
   un bouton qui ne fait rien est pire que pas de bouton.

   Le champ garde son identifiant et ses ecouteurs : c'est le meme
   #msgsSearchInput, donc la recherche de chat-owner.js continue de
   filtrer. Je ne recree rien.

   ── REPERE PAR LE CONTENU ────────────────────────────────────────
   La barre de marque est trouvee par son image ou son texte
   « BOOSTINGHOST », le bandeau de recherche par le champ qu'il
   contient. Aucun identifiant devine : si l'un des deux n'est pas
   trouve, il n'est pas masque et le diagnostic le nomme.

   Usage :
     node outils/refonte-19-messages-epure.js --essai
     node outils/refonte-19-messages-epure.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE = path.join(process.cwd(), 'public', 'js', 'bh-entete-messages.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(MODULE)) echec('bh-entete-messages.js absent. Lancez d\'abord le lot 18.');

let src = fs.readFileSync(MODULE, 'utf8');
if (src.indexOf('barreMarque') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function rempl(avant, apres, quoi) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. La loupe ouvre et ferme le champ ──────────────────────── */

rempl(
`        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          /* La page a deja un champ de recherche : on lui donne le
             focus plutot que d'en creer un second. */
          var champ = document.getElementById('msgsSearchInput')
            || document.querySelector('input[placeholder*="echerch"]');
          if (champ) {
            champ.scrollIntoView ? null : null;
            try { champ.focus(); } catch (e) {}
          } else {
            console.warn('[entete msg] aucun champ de recherche trouve');
          }
        });`,
`        b.addEventListener('click', function (ev) {
          ev.preventDefault();
          basculerRecherche();
        });`,
  'le clic de la loupe'
);

/* ── 2. Les nouvelles fonctions ───────────────────────────────── */

rempl(
`  /* ── 2. Le defilement ───────────────────────────────────────── */`,
`  /* ── 1 bis. La marque et la recherche ───────────────────────── */

  function champRecherche() {
    return document.getElementById('msgsSearchInput')
      || document.querySelector('input[placeholder*="echerch"], input[placeholder*="echerch"]');
  }

  /* Le bandeau : le plus petit conteneur qui porte le champ et qui a
     une hauteur propre. On remonte de trois crans au plus. */
  function bandeauRecherche() {
    var c = champRecherche();
    if (!c) return null;
    var el = c.parentElement, garde = 0, dernier = null;
    while (el && el !== document.body && garde++ < 3) {
      if (el.querySelector('#conversationsList, #bhMessagesListe')) break;
      dernier = el;
      el = el.parentElement;
    }
    return dernier;
  }

  /* La barre de marque : un conteneur portant « BOOSTINGHOST », court,
     et qui ne contient ni la liste ni le champ de recherche. */
  function barreMarque() {
    var noeuds = document.querySelectorAll('header, div, nav, section');
    var meilleur = null;
    for (var i = 0; i < noeuds.length; i++) {
      var n = noeuds[i];
      if (n.id === 'bhEnteteMsg' || n.closest && n.closest('#bhEnteteMsg')) continue;
      if (n.querySelector('#conversationsList, #bhMessagesListe, #msgsSearchInput')) continue;
      var t = (n.textContent || '').replace(/\\s+/g, ' ').trim();
      var logo = n.querySelector('img[alt*="oosting" i], img[src*="logo" i]');
      var dit = /BOOSTINGHOST/i.test(t) && t.length < 90;
      if (!logo && !dit) continue;
      if (n.getBoundingClientRect().height < 24) continue;
      if (!meilleur || (n.textContent || '').length < (meilleur.textContent || '').length) meilleur = n;
    }
    return meilleur;
  }

  var rechercheOuverte = false;

  function basculerRecherche() {
    var bandeau = bandeauRecherche();
    var champ = champRecherche();
    if (!bandeau || !champ) {
      console.warn('[entete msg] aucun champ de recherche a ouvrir');
      return;
    }
    rechercheOuverte = !rechercheOuverte;
    bandeau.style.setProperty('display', rechercheOuverte ? '' : 'none', 'important');
    if (rechercheOuverte) {
      try { champ.focus(); } catch (e) {}
    } else if (champ.value) {
      /* On referme sur un champ vide : sinon la liste resterait filtree
         par un texte que plus personne ne voit. */
      champ.value = '';
      try { champ.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    }
  }

  function replierRecherche() {
    var bandeau = bandeauRecherche();
    if (!bandeau || bandeau.dataset.bhReplie) return;
    bandeau.dataset.bhReplie = '1';
    memoriser(bandeau, 'display', 'none');
    diag.recherche = 'repliee — la loupe l ouvre';

    var champ = champRecherche();
    if (champ && !champ.dataset.bhEchap) {
      champ.dataset.bhEchap = '1';
      champ.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') basculerRecherche();
      });
      champ.addEventListener('blur', function () {
        if (!champ.value && rechercheOuverte) setTimeout(basculerRecherche, 120);
      });
    }
  }

  function masquerMarque() {
    if (diag.marque) return;
    var b = barreMarque();
    if (!b) { diag.marque = null; return; }
    if (b.dataset.bhMarqueMasquee) return;
    b.dataset.bhMarqueMasquee = '1';
    memoriser(b, 'display', 'none');
    diag.marque = (b.id ? '#' + b.id : b.tagName.toLowerCase())
      + (typeof b.className === 'string' && b.className ? '.' + b.className.split(/\\s+/)[0] : '');
  }

  /* ── 2. Le defilement ───────────────────────────────────────── */`,
  'le point d insertion'
);

/* ── 3. Le tour ───────────────────────────────────────────────── */

rempl(
`  function tour() {
    poserEntete();
    libererDefilement();
    masquerOnglets();
  }`,
`  function tour() {
    poserEntete();
    masquerMarque();
    replierRecherche();
    libererDefilement();
    masquerOnglets();
  }`,
  'le tour'
);

/* ── 4. L'etat et le diagnostic ───────────────────────────────── */

rempl(
`  var diag = { entete: false, rond: false, loupe: false, defilement: [], onglets: null, raison: '' };`,
`  var diag = { entete: false, rond: false, loupe: false, defilement: [], onglets: null,
               marque: null, recherche: null, raison: '' };`,
  'l etat interne'
);

rempl(
`      onglets_masques: diag.onglets || 'barre non trouvee — rien masque',`,
`      onglets_masques: diag.onglets || 'barre non trouvee — rien masque',
      marque_masquee: diag.marque || 'barre BOOSTINGHOST non trouvee — rien masque',
      recherche: diag.recherche || 'bandeau non trouve — laisse en place',
      recherche_ouverte: rechercheOuverte,`,
  'le diagnostic'
);

rempl(
`      delete m.el.dataset.bhOngletsMasques;`,
`      delete m.el.dataset.bhOngletsMasques;
        delete m.el.dataset.bhMarqueMasquee;
        delete m.el.dataset.bhReplie;`,
  'l annulation'
);

[
  ['la barre de marque', 'function barreMarque()'],
  ['le repli de la recherche', 'function replierRecherche()'],
  ['la bascule', 'function basculerRecherche()'],
  ['le tour complet', 'masquerMarque();'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

try { new Function(src); } catch (e) { echec('Le module ne serait plus valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(MODULE, src, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('barreMarque') === -1) echec("La correction n'est pas dans le fichier apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide apres ecriture — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  public/js/bh-entete-messages.js  marque masquee, recherche repliee');
console.log('\n  La barre BOOSTINGHOST part : les autres ecrans ne la montrent');
console.log('  pas, et sur un telephone elle occupe la place du contenu.');
console.log('\n  Le champ de recherche n\'est pas supprime, il est replie. La');
console.log('  loupe de l\'en-tete l\'ouvre et le referme — sinon elle pointerait');
console.log('  vers un champ masque, et un bouton qui ne fait rien est pire');
console.log('  que pas de bouton. C\'est le meme #msgsSearchInput : la recherche');
console.log('  de chat-owner.js continue de filtrer, je ne recree rien.');
console.log('\n  A verifier, cache vide : /messages.html');
console.log('    plus de barre de marque, l\'en-tete « N non lus / Messages »');
console.log('      arrive en haut');
console.log('    la loupe ouvre le champ, Echap ou champ vide le referme');
console.log('    bhVerifEnteteMsg()  —  marque_masquee et recherche renseignes');
console.log('\n  Annulation : bhAnnulerEnteteMsg()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

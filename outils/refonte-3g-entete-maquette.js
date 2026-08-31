#!/usr/bin/env node
/* ============================================================
   outils/refonte-3g-entete-maquette.js
   Lot 3g : l'en-tete de la maquette, sans la barre beige
   ============================================================

   ── CE QUE VOUS DEMANDEZ ─────────────────────────────────────────
   Exactement la maquette : la date et « Aujourd'hui » a gauche, la loupe
   et le rond aux initiales a droite, sur la MEME ligne. Et la barre
   beige peut disparaitre.

   Aujourd'hui il y a deux etages : la barre beige avec logo, loupe et
   initiales, puis l'en-tete en dessous. Deux etages pour un seul role.

   ── CE QUE FAIT LE LOT ───────────────────────────────────────────
   L'en-tete devient une ligne a deux cotes. La loupe et le rond y sont
   DEPLACES — les noeuds eux-memes, pas des copies : leurs ecouteurs de
   clic, la recherche, l'ouverture de « Mon compte » continuent de
   fonctionner sans qu'une ligne de leur logique soit touchee.

   Puis la barre beige est masquee, vide de ce qui servait encore.

   Le logo Boostinghost part avec elle. C'est un choix defendable sur
   telephone : dans une application ou l'on est deja connecte, la marque
   ne dit rien qu'on ne sache, et elle coutait 60 px de hauteur sur
   chaque ecran. Si vous le voulez garder, dites-le : il retrouvera sa
   place a gauche du titre, en petit.

   ── LE FILET DE SECURITE ─────────────────────────────────────────
   Si la loupe ou le rond ne sont pas trouves, la barre beige n'est PAS
   masquee. Mieux vaut deux etages qu'une application sans recherche ni
   acces au compte.

   Usage :
     node outils/refonte-3g-entete-maquette.js --essai
     node outils/refonte-3g-entete-maquette.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-entete-jour.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-entete-jour.js introuvable. Lancez d\'abord refonte-3f-entete-jour.js.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('deplacerCommandes') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. L'en-tete devient une ligne a deux cotes ─────────────── */

remplacer(
`    var bloc = document.createElement('div');
    bloc.id = 'bhEnteteJour';
    bloc.style.cssText = 'padding:2px 4px 14px;font-family:inherit';
    bloc.innerHTML =
      '<div style="font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em">'
      + JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + '</div>'
      + '<div style="margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE + '">'
      + "Aujourd'hui</div>";`,
`    var bloc = document.createElement('div');
    bloc.id = 'bhEnteteJour';
    bloc.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px'
      + ';padding:2px 4px 14px;font-family:inherit';

    var gauche = document.createElement('div');
    gauche.style.cssText = 'min-width:0';
    gauche.innerHTML =
      '<div style="font-size:13.5px;font-weight:500;color:' + GRIS + ';letter-spacing:-.01em">'
      + JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()] + '</div>'
      + '<div style="margin-top:1px;font-size:31px;font-weight:600;letter-spacing:-.03em;color:' + ENCRE + '">'
      + "Aujourd'hui</div>";
    bloc.appendChild(gauche);

    /* Le cote droit accueillera la loupe et le rond, deplaces depuis la
       barre beige. Cree vide : s'ils manquent, il ne laisse aucun trou. */
    var droite = document.createElement('div');
    droite.id = 'bhEnteteCommandes';
    droite.style.cssText = 'flex:none;display:flex;align-items:center;gap:9px;padding-top:5px';
    bloc.appendChild(droite);`,
  'la construction de l\'en-tete'
);

/* ── 2. Le deplacement des commandes, et la barre beige ─────── */

remplacer(
  "  window.bhVerifEntete = function () {",
`  /* La loupe et le rond sont DEPLACES, pas copies : leurs ecouteurs
     restent attaches, donc la recherche et « Mon compte » fonctionnent
     sans qu'une ligne de leur logique soit reecrite. */
  function deplacerCommandes() {
    var droite = document.getElementById('bhEnteteCommandes');
    if (!droite) return false;

    var loupe = document.querySelector('.bhgs-trigger-mobile');
    var rond = document.getElementById('bhAvatarHeader');
    if (!loupe && !rond) { diag.raison = 'ni loupe ni rond trouves'; return false; }

    if (loupe && loupe.parentElement !== droite) {
      loupe.style.setProperty('margin', '0', 'important');
      loupe.style.setProperty('flex', 'none', 'important');
      droite.appendChild(loupe);
      diag.loupe = true;
    }
    if (rond && rond.parentElement !== droite) {
      rond.style.setProperty('margin', '0', 'important');
      droite.appendChild(rond);
      diag.rond = true;
    }

    /* La barre beige n'est masquee que si les deux commandes ont bien
       trouve leur nouvelle place. Deux etages valent mieux qu'une
       application sans recherche ni acces au compte. */
    if (loupe && rond && loupe.parentElement === droite && rond.parentElement === droite) {
      var barre = loupe.closest('header, .mobile-header, [class*="header"]');
      if (barre && !barre.dataset.bhMasquee) {
        /* On ne masque pas un conteneur qui porte encore autre chose de
           visible et cliquable — un bouton que je n'aurais pas vu. */
        var restants = barre.querySelectorAll('button:not([data-bh-masque]), a[href]:not(.mobile-logo)');
        var vivants = 0;
        for (var i = 0; i < restants.length; i++) {
          var e = restants[i];
          if (e === loupe || e === rond) continue;
          if (droite.contains(e)) continue;
          if (getComputedStyle(e).display === 'none') continue;
          vivants++;
        }
        if (vivants === 0) {
          barre.style.setProperty('display', 'none', 'important');
          barre.dataset.bhMasquee = '1';
          diag.barre_masquee = true;
        } else {
          diag.raison = vivants + ' bouton(s) encore vivant(s) dans la barre — non masquee';
        }
      }
    }
    return true;
  }

  window.bhVerifEntete = function () {`,
  'l\'ajout du deplacement'
);

/* ── 3. Le diagnostic ───────────────────────────────────────── */

remplacer(
`      carte_journee_trouvee: diag.carte_trouvee,`,
`      carte_journee_trouvee: diag.carte_trouvee,
      loupe_deplacee: !!diag.loupe,
      rond_deplace: !!diag.rond,
      barre_beige_masquee: !!diag.barre_masquee,`,
  'le diagnostic'
);

/* ── 4. L'appel, a chaque passage ───────────────────────────── */

remplacer(
`  function demarrer() {
    poserEntete();
    remonterBande();
  }`,
`  function demarrer() {
    poserEntete();
    deplacerCommandes();
    remonterBande();
  }`,
  'la fonction demarrer'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la ligne a deux cotes', "justify-content:space-between"],
  ['le cote droit', "droite.id = 'bhEnteteCommandes'"],
  ['le deplacement', 'function deplacerCommandes() {'],
  ['le deplacement de la loupe', 'droite.appendChild(loupe);'],
  ['le deplacement du rond', 'droite.appendChild(rond);'],
  ['le filet de securite', 'if (vivants === 0) {'],
  ['l\'appel', 'deplacerCommandes();\n    remonterBande();'],
  ['le diagnostic', 'barre_beige_masquee'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Aucune copie : appendChild deplace, cloneNode copierait. */
if (src.indexOf('cloneNode') !== -1) echec('Un cloneNode est apparu : les ecouteurs seraient perdus. Refus.');

try {
  new Function(src);
} catch (e) {
  echec('Le module ne serait plus du JavaScript valide — ' + e.message);
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('deplacerCommandes') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Date + « Aujourd\'hui » a gauche, loupe + initiales a droite.');
console.log('  La barre beige est masquee — mais SEULEMENT si les deux');
console.log('  commandes ont trouve leur nouvelle place, et qu\'aucun autre');
console.log('  bouton vivant n\'y reste.');
console.log('\n  Les noeuds sont DEPLACES, jamais clones : la recherche et');
console.log('  « Mon compte » gardent leurs ecouteurs.');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  Un seul etage en haut. Touchez la loupe : la recherche s\'ouvre.');
console.log('  Touchez le rond : « Mon compte » monte.');
console.log('  Puis :  bhVerifEntete()');
console.log('  Attendu : loupe_deplacee, rond_deplace, barre_beige_masquee = true.');
console.log('  Si barre_beige_masquee est false, « raison » nomme le bouton qui');
console.log('  reste — collez-la moi.\n');
console.log('  Le logo Boostinghost part avec la barre. Si vous le voulez');
console.log('  garder, dites-le : il reviendra a gauche du titre, en petit.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

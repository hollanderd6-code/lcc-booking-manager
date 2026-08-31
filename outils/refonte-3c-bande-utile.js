#!/usr/bin/env node
/* ============================================================
   outils/refonte-3c-bande-utile.js
   Lot 3c : la bande dit ce qui varie, pas ce qui est toujours vrai
   ============================================================

   ── L'AVEU ───────────────────────────────────────────────────────
   « Ca ne me donne vraiment aucune info quand j'ai 20 logements. »

   C'est exact, et le defaut est de conception. A 26 logements, chaque
   jour a de l'occupe ET des departs : les sept cases affichent la meme
   paire de pastilles. Une information vraie sept fois de suite
   n'informe pas — c'est du decor.

   Les pastilles marchent pour un proprietaire de deux studios. Pas pour
   une conciergerie.

   ── CE QUI VARIE VRAIMENT ────────────────────────────────────────
   Le nombre de logements VIDES. C'est la seule grandeur qui bouge d'un
   jour a l'autre, et la seule qui coute de l'argent : sept vides jeudi,
   c'est sept nuits a vendre avant jeudi.

   La bande devient donc :

       un chiffre     les logements libres cette nuit-la
       une jauge      la part occupee du parc, en hauteur
       une teinte     plus le parc se vide, plus la case s'eclaircit

   Le jour ou tout est loue, la case affiche « 0 » et se remplit — un
   coup d'oeil suffit a voir le trou de la semaine.

   ── LE PARC ──────────────────────────────────────────────────────
   Compter les vides suppose de connaitre le total. Le module lit
   /api/properties, en lecture seule. S'il echoue, il retombe sur le
   nombre de logements distincts vus dans les reservations — un plancher,
   jamais un chiffre invente. Et si meme cela manque, il affiche les
   nuits vendues au lieu des vides, en le disant dans la legende.

   Les blocages manuels comptent comme occupes ici : un logement bloque
   n'est pas un logement a vendre.

   Usage :
     node outils/refonte-3c-bande-utile.js --essai
     node outils/refonte-3c-bande-utile.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-bande-jours.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-bande-jours.js introuvable.');

let src = fs.readFileSync(CIBLE, 'utf8');
if (src.indexOf("'startDate'") === -1) echec('Lancez d\'abord refonte-3b-bande-champs.js.');

if (src.indexOf('parcTotal') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois).');
  }
  src = src.split(avant).join(apres);
}

/* ── 1. Compter les logements distincts, et le parc ─────────── */

remplacer(
`    var compte = {}, departs = {}, bloques = {}, noms = {};
    lignes.forEach(function (r) {`,
`    var compte = {}, departs = {}, bloques = {}, noms = {}, vusParc = {};
    lignes.forEach(function (r) {
      var pid = r.propertyId || r.property_id;
      if (pid) vusParc[pid] = true;`,
  'le debut du comptage'
);

remplacer(
  "    return { compte: compte, departs: departs, bloques: bloques, noms: noms };",
  "    return { compte: compte, departs: departs, bloques: bloques, noms: noms,\n             logements_vus: Object.keys(vusParc).length };",
  'le retour du comptage'
);

remplacer(
  "    if (!lignes.length) return { compte: {}, departs: {}, bloques: {}, noms: {} };",
  "    if (!lignes.length) return { compte: {}, departs: {}, bloques: {}, noms: {}, logements_vus: 0 };",
  'la reponse vide'
);

/* ── 2. Le parc, lu sur /api/properties ─────────────────────── */

remplacer(
`  function charger() {
    if (document.getElementById('bhBandeJours')) return;
    var t = jeton();
    if (!t) { diag.erreur = 'aucun jeton en memoire'; return; }

    fetch('/api/reservations', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.json(); })
      .then(function (rep) {
        diag.recu = rep;
        var d = lire(rep);
        if (!d) {
          diag.erreur = 'forme de reponse non reconnue (' + diag.forme + ')';
          console.warn('[bande] ' + diag.erreur + ' — la bande ne s\\\\'affiche pas. Tapez bhVerifBande().');
          return;
        }
        construire(d);
      })
      .catch(function (e) {
        diag.erreur = e.message;
        console.warn('[bande] /api/reservations : ' + e.message);
      });
  }`,
`  /* Le total du parc : sans lui, « combien de vides » n'a pas de sens. */
  function lireParc(t) {
    return fetch('/api/properties', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.json(); })
      .then(function (rep) {
        var l = Array.isArray(rep) ? rep
          : (rep && (rep.properties || rep.data || rep.rows || rep.results)) || null;
        if (!Array.isArray(l)) return 0;
        /* On ne compte que les logements reellement exploites. */
        var n = l.filter(function (p) {
          if (p.archived === true || p.deleted === true) return false;
          var st = String(p.status || '').toLowerCase();
          if (st.indexOf('archiv') !== -1 || st.indexOf('inactif') !== -1) return false;
          return true;
        }).length;
        diag.parc_source = '/api/properties';
        return n;
      })
      .catch(function () { return 0; });
  }

  function charger() {
    if (document.getElementById('bhBandeJours')) return;
    var t = jeton();
    if (!t) { diag.erreur = 'aucun jeton en memoire'; return; }

    Promise.all([
      fetch('/api/reservations', { headers: { Authorization: 'Bearer ' + t } }).then(function (r) { return r.json(); }),
      lireParc(t)
    ])
      .then(function (paire) {
        var rep = paire[0], parc = paire[1];
        diag.recu = rep;
        var d = lire(rep);
        if (!d) {
          diag.erreur = 'forme de reponse non reconnue (' + diag.forme + ')';
          console.warn('[bande] ' + diag.erreur + ' — la bande ne s\\\\'affiche pas. Tapez bhVerifBande().');
          return;
        }
        /* Repli : les logements vus dans les reservations. C'est un
           plancher, jamais un chiffre invente. */
        if (!parc) {
          parc = d.logements_vus || 0;
          diag.parc_source = parc ? 'logements vus dans les reservations (plancher)' : 'aucun';
        }
        d.parcTotal = parc;
        diag.parc = parc;
        construire(d);
      })
      .catch(function (e) {
        diag.erreur = e.message;
        console.warn('[bande] ' + e.message);
      });
  }`,
  'la fonction de chargement'
);

/* ── 3. La case : un chiffre, une jauge, une teinte ─────────── */

remplacer(
`      var cell = document.createElement('div');
      var estAuj = i === 0;
      cell.style.cssText = 'text-align:center;padding:7px 0 8px;border-radius:11px'
        + ';background:' + (estAuj ? VERT : (depart && !occupe ? '#FBF6E9' : '#F4F2EC'));`,
`      /* Un logement bloque n'est pas a vendre : il compte comme occupe. */
      var pris = (donnees.compte[k] || 0) + (donnees.bloques[k] || 0);
      var parc = donnees.parcTotal || 0;
      var libres = parc ? Math.max(0, parc - pris) : null;
      var part = parc ? Math.min(1, pris / parc) : 0;
      jours[jours.length - 1].libres = libres;
      jours[jours.length - 1].occupation = parc ? Math.round(part * 100) + ' %' : null;

      var cell = document.createElement('div');
      var estAuj = i === 0;
      cell.style.cssText = 'position:relative;overflow:hidden;text-align:center;padding:7px 0 8px'
        + ';border-radius:11px;background:' + (estAuj ? VERT : '#F4F2EC');`,
  'le debut de la case'
);

remplacer(
`      var pts = document.createElement('div');
      pts.style.cssText = 'display:flex;gap:2px;justify-content:center;margin-top:5px;height:4px';
      if (occupe) {
        var p1 = document.createElement('span');
        p1.style.cssText = 'width:4px;height:4px;border-radius:50%;background:' + (estAuj ? '#8FD3B4' : VERT_CLAIR);
        pts.appendChild(p1);
      }
      if (depart) {
        var p2 = document.createElement('span');
        p2.style.cssText = 'width:4px;height:4px;border-radius:50%;background:' + AMBRE;
        pts.appendChild(p2);
      }
      /* Bloque mais pas vendu : un point creux, pour ne pas confondre
         « personne ne peut reserver » et « personne n'a reserve ». */
      if (bloque && !occupe) {
        var p3 = document.createElement('span');
        p3.style.cssText = 'width:4px;height:4px;border-radius:50%;border:1px solid #B9B4A8;box-sizing:border-box';
        pts.appendChild(p3);
      }
      cell.appendChild(pts);
      grille.appendChild(cell);`,
`      /* Le chiffre qui varie : les logements libres cette nuit-la.
         Sans total de parc, on retombe sur les nuits vendues. */
      var chiffre = document.createElement('div');
      var valeur = libres === null ? (donnees.compte[k] || 0) : libres;
      chiffre.textContent = valeur;
      var criant = libres !== null && libres === 0;
      chiffre.style.cssText = 'position:relative;font-size:13px;font-weight:700;margin-top:4px;letter-spacing:-.01em'
        + ';color:' + (estAuj ? (criant ? '#8FD3B4' : '#DCE8E1')
                              : (criant ? VERT : (valeur > 0 ? '#8A5B14' : '#0D1117')));
      cell.appendChild(chiffre);

      /* La jauge d'occupation, en fond de case : la lire ne demande pas
         de compter, seulement de comparer des hauteurs. */
      if (parc) {
        var jauge = document.createElement('div');
        jauge.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:' + Math.round(part * 100) + '%'
          + ';background:' + (estAuj ? 'rgba(143,211,180,.20)' : 'rgba(46,139,98,.13)') + ';pointer-events:none';
        cell.insertBefore(jauge, cell.firstChild);
      }

      /* Le depart reste signale : c'est du travail a prevoir, pas du CA. */
      if (depart) {
        var trait = document.createElement('div');
        trait.style.cssText = 'position:absolute;top:0;left:50%;transform:translateX(-50%);width:16px;height:3px'
          + ';border-radius:0 0 3px 3px;background:' + AMBRE;
        cell.appendChild(trait);
      }

      grille.appendChild(cell);`,
  'les pastilles'
);

/* ── 4. La legende explique le chiffre ──────────────────────── */

remplacer(
`    legende.innerHTML =
      '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '">'
      + '<span style="width:5px;height:5px;border-radius:50%;background:' + VERT_CLAIR + '"></span>occupé</span>'
      + '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '">'
      + '<span style="width:5px;height:5px;border-radius:50%;background:' + AMBRE + '"></span>départ, ménage à prévoir</span>'
      + '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '">'
      + '<span style="width:5px;height:5px;border-radius:50%;border:1px solid #B9B4A8;box-sizing:border-box"></span>bloqué</span>';`,
`    var parcConnu = donnees.parcTotal || 0;
    legende.innerHTML =
      '<span style="font-size:11px;color:' + GRIS + '">'
      + (parcConnu
          ? 'le chiffre : logements libres sur ' + parcConnu
          : 'le chiffre : nuits vendues (parc inconnu)')
      + '</span>'
      + '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '">'
      + '<span style="width:11px;height:3px;border-radius:2px;background:' + AMBRE + '"></span>départ ce jour-là</span>';`,
  'la legende'
);

/* ── 5. Le diagnostic dit d'ou vient le parc ────────────────── */

remplacer(
`      champs_dates: diag.champs,
      sept_jours: diag.jours,
      erreur: diag.erreur`,
`      champs_dates: diag.champs,
      parc_total: diag.parc,
      parc_source: diag.parc_source,
      sept_jours: diag.jours,
      erreur: diag.erreur`,
  'le diagnostic'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la lecture du parc', "function lireParc(t) {"],
  ['l\'appel parallele', 'Promise.all(['],
  ['le repli plancher', "diag.parc_source = parc ? 'logements vus"],
  ['le calcul des libres', 'var libres = parc ? Math.max(0, parc - pris) : null;'],
  ['le blocage compte comme pris', "var pris = (donnees.compte[k] || 0) + (donnees.bloques[k] || 0);"],
  ['la jauge', 'height:\' + Math.round(part * 100) + \'%\''],
  ['la legende parlante', "'le chiffre : logements libres sur '"],
  ['la source du parc au diagnostic', 'parc_source: diag.parc_source'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

if (src.indexOf('p3.style.cssText') !== -1) echec('Une ancienne pastille subsiste. Refus.');

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('parcTotal') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Chaque jour : un chiffre = logements LIBRES cette nuit-la');
console.log('  Une jauge en fond = part du parc occupee');
console.log('  Un trait ambre en haut = depart ce jour-la');
console.log('  Un blocage manuel compte comme occupe : il n\'est pas a vendre');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  Les sept chiffres doivent DIFFERER. Si les sept sont identiques,');
console.log('  c\'est le parc qui est mal lu : bhVerifBande() dit « parc_total »');
console.log('  et « parc_source ». Sur 26 logements actifs, parc_total doit');
console.log('  valoir 26 — s\'il vaut le nombre de reservations, dites-le moi.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

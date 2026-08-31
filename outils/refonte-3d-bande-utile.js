#!/usr/bin/env node
/* ============================================================
   outils/refonte-3d-bande-utile.js
   Lot 3d : le meme changement, avec des ancrages qui tiennent
   ============================================================

   Le 3c a echoue sur « la fonction de chargement ». La cause est de mon
   fait : mon texte de recherche contenait une apostrophe echappee
   (« ne s\\'affiche pas ») dont le nombre d'antislashs ne correspondait
   pas a ce qui a reellement ete ecrit dans le fichier. Rien n'a ete
   modifie — le script a refuse d'ecrire plutot que d'ecrire a moitie.

   Ce lot fait exactement la meme chose, en s'ancrant sur des lignes
   courtes et sans apostrophe. Aucune ligne de comportement ne change
   par rapport au 3c.

   Rappel de l'intention : a 26 logements, « occupe » et « depart » sont
   vrais tous les jours. Ce qui varie, c'est le nombre de logements
   VIDES. Votre propre table le montre — 12 nuits vendues aujourd'hui,
   3 vendredi. La bande doit dire cet ecart.

   Usage :
     node outils/refonte-3d-bande-utile.js --essai
     node outils/refonte-3d-bande-utile.js
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
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. Le parc : logements distincts vus ────────────────────── */

remplacer(
  "    var compte = {}, departs = {}, bloques = {}, noms = {};",
  "    var compte = {}, departs = {}, bloques = {}, noms = {}, vusParc = {};",
  'la declaration des compteurs'
);

remplacer(
  "      var st = String(r.status || r.state || '').toLowerCase();",
  "      var pid = r.propertyId || r.property_id;\n      if (pid) vusParc[pid] = true;\n      var st = String(r.status || r.state || '').toLowerCase();",
  'le debut de boucle'
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

/* ── 2. La lecture du parc, posee avant charger() ───────────── */

remplacer(
  "  function charger() {",
`  /* Le total du parc : sans lui, « combien de vides » n'a pas de sens.
     Lecture seule sur /api/properties, aucune ecriture. */
  function lireParc(t) {
    return fetch('/api/properties', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.json(); })
      .then(function (rep) {
        var l = Array.isArray(rep) ? rep
          : (rep && (rep.properties || rep.data || rep.rows || rep.results)) || null;
        if (!Array.isArray(l)) return 0;
        var n = l.filter(function (p) {
          if (p.archived === true || p.deleted === true) return false;
          var st = String(p.status || '').toLowerCase();
          if (st.indexOf('archiv') !== -1) return false;
          if (st.indexOf('inactif') !== -1) return false;
          return true;
        }).length;
        diag.parc_source = '/api/properties';
        return n;
      })
      .catch(function () { return 0; });
  }

  function charger() {`,
  'la fonction charger'
);

/* ── 3. construire() attend le parc ─────────────────────────── */

remplacer(
  "        construire(d);",
`        lireParc(t).then(function (parc) {
          /* Repli : les logements vus dans les reservations. C'est un
             plancher, jamais un chiffre invente. */
          if (!parc) {
            parc = d.logements_vus || 0;
            diag.parc_source = parc ? 'logements vus dans les reservations (plancher)' : 'aucun';
          }
          d.parcTotal = parc;
          diag.parc = parc;
          construire(d);
        });`,
  'l\'appel a construire'
);

/* ── 4. La case : un chiffre, une jauge ─────────────────────── */

remplacer(
  "      var cell = document.createElement('div');\n      var estAuj = i === 0;",
`      /* Un logement bloque n'est pas a vendre : il compte comme occupe. */
      var pris = (donnees.compte[k] || 0) + (donnees.bloques[k] || 0);
      var parc = donnees.parcTotal || 0;
      var libres = parc ? Math.max(0, parc - pris) : null;
      var part = parc ? Math.min(1, pris / parc) : 0;
      jours[jours.length - 1].libres = libres;
      jours[jours.length - 1].occupation = parc ? Math.round(part * 100) + ' %' : null;

      var cell = document.createElement('div');
      var estAuj = i === 0;`,
  'la creation de la case'
);

remplacer(
  "      cell.style.cssText = 'text-align:center;padding:7px 0 8px;border-radius:11px'\n        + ';background:' + (estAuj ? VERT : (depart && !occupe ? '#FBF6E9' : '#F4F2EC'));",
  "      cell.style.cssText = 'position:relative;overflow:hidden;text-align:center;padding:7px 0 8px'\n        + ';border-radius:11px;background:' + (estAuj ? VERT : '#F4F2EC');",
  'le style de la case'
);

/* ── 5. Les pastilles cedent la place au chiffre ────────────── */

remplacer(
  "      var pts = document.createElement('div');\n      pts.style.cssText = 'display:flex;gap:2px;justify-content:center;margin-top:5px;height:4px';",
`      /* Le chiffre qui varie : les logements libres cette nuit-la.
         Sans total de parc, on retombe sur les nuits vendues, et la
         legende le dit. */
      var chiffre = document.createElement('div');
      var valeur = libres === null ? (donnees.compte[k] || 0) : libres;
      chiffre.textContent = valeur;
      var complet = libres !== null && libres === 0;
      chiffre.style.cssText = 'position:relative;font-size:13px;font-weight:700;margin-top:4px'
        + ';letter-spacing:-.01em;color:'
        + (estAuj ? (complet ? '#8FD3B4' : '#DCE8E1')
                  : (complet ? VERT : (valeur > 0 ? '#8A5B14' : '#0D1117')));
      cell.appendChild(chiffre);

      /* La jauge d'occupation, en fond : la lire ne demande pas de
         compter, seulement de comparer des hauteurs. */
      if (parc) {
        var jauge = document.createElement('div');
        jauge.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:' + Math.round(part * 100) + '%'
          + ';background:' + (estAuj ? 'rgba(143,211,180,.20)' : 'rgba(46,139,98,.13)')
          + ';pointer-events:none';
        cell.insertBefore(jauge, cell.firstChild);
      }

      /* Le depart reste signale : c'est du travail a prevoir, pas du CA. */
      if (depart) {
        var trait = document.createElement('div');
        trait.style.cssText = 'position:absolute;top:0;left:50%;transform:translateX(-50%)'
          + ';width:16px;height:3px;border-radius:0 0 3px 3px;background:' + AMBRE;
        cell.appendChild(trait);
      }

      var pts = document.createElement('div');
      pts.style.cssText = 'display:none';`,
  'le bloc des pastilles'
);

/* ── 6. La legende explique le chiffre ──────────────────────── */

remplacer(
  "    legende.innerHTML =",
  "    var parcConnu = donnees.parcTotal || 0;\n    legende.innerHTML =",
  'le debut de la legende'
);

remplacer(
  "      '<span style=\"display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '\">'\n      + '<span style=\"width:5px;height:5px;border-radius:50%;background:' + VERT_CLAIR + '\"></span>occupé</span>'",
  "      '<span style=\"font-size:11px;color:' + GRIS + '\">'\n      + (parcConnu ? 'le chiffre : logements libres sur ' + parcConnu : 'le chiffre : nuits vendues (parc inconnu)')\n      + '</span>'",
  'la premiere entree de legende'
);

remplacer(
  "      + '<span style=\"width:5px;height:5px;border-radius:50%;background:' + AMBRE + '\"></span>départ, ménage à prévoir</span>'",
  "      + '<span style=\"width:11px;height:3px;border-radius:2px;background:' + AMBRE + '\"></span>départ ce jour-là</span>'",
  'l\'entree depart de la legende'
);

remplacer(
  "      + '<span style=\"display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '\">'\n      + '<span style=\"width:5px;height:5px;border-radius:50%;border:1px solid #B9B4A8;box-sizing:border-box\"></span>bloqué</span>';",
  "      + '';",
  'l\'entree bloque de la legende'
);

/* ── 7. Le diagnostic dit d'ou vient le parc ────────────────── */

remplacer(
  "      sept_jours: diag.jours,",
  "      parc_total: diag.parc,\n      parc_source: diag.parc_source,\n      sept_jours: diag.jours,",
  'le diagnostic'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la lecture du parc', 'function lireParc(t) {'],
  ['l\'attente du parc', 'lireParc(t).then(function (parc) {'],
  ['le repli plancher', "(plancher)'"],
  ['le calcul des libres', 'var libres = parc ? Math.max(0, parc - pris) : null;'],
  ['le blocage compte comme pris', 'var pris = (donnees.compte[k] || 0) + (donnees.bloques[k] || 0);'],
  ['le chiffre', 'chiffre.textContent = valeur;'],
  ['la jauge', "jauge.style.cssText = 'position:absolute"],
  ['la legende parlante', "'le chiffre : logements libres sur '"],
  ['la source du parc', 'parc_source: diag.parc_source'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Le fichier doit rester du JavaScript valide. */
try {
  new Function(src);
} catch (e) {
  echec('Le module ne serait plus du JavaScript valide — ' + e.message);
}

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
console.log('  Blocage manuel compte comme occupe : il n\'est pas a vendre');
console.log('\n  Attendu d\'apres votre propre table, sur 26 logements :');
console.log('    31 aout   12 vendues + 8 bloques  ->  6 libres');
console.log('    5 sept.    3 vendues + 5 bloques  -> 18 libres');
console.log('  Les sept chiffres doivent donc differer nettement.');
console.log('\n  Puis :  bhVerifBande()   — parc_total doit valoir 26.');
console.log('  S\'il vaut 887, /api/properties a repondu autrement que prevu :');
console.log('  collez-moi parc_total et parc_source.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

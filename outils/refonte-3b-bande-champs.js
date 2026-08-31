#!/usr/bin/env node
/* ============================================================
   outils/refonte-3b-bande-champs.js
   Lot 3b : les vrais noms de champs, camelCase
   ============================================================

   ── CE QUE LE TELEPHONE A DIT ────────────────────────────────────
       forme : { reservations }        reconnue
       lignes : 886                   lues
       champs : id, uid, propertyId, propertyName, startDate, endDate,
                start, end, guestName, platform, source, type, isManual, price

   Mes listes ne contenaient que du snake_case — start_date, checkin,
   arrival_date. Votre API repond en camelCase. Aucun champ ne
   correspondait, donc la bande a refuse de s'afficher. C'est le
   comportement voulu : elle s'est taue au lieu de dessiner sept cases
   vides.

   ── LA CORRECTION ────────────────────────────────────────────────
   startDate / endDate en tete de liste, avec start / end en repli — vos
   deux paires de champs. Le snake_case reste derriere, au cas ou une
   autre route reponde autrement.

   Trois autres champs de votre reponse changent la bande pour le mieux :

       propertyName   la pastille peut dire QUEL logement part
       isManual       un blocage manuel n'est pas une nuit vendue
       type           distingue reservation, blocage et pre-reservation

   isManual surtout : vos deux « Blocage manuel » sur AN2 compteraient
   comme des nuits occupees, et la bande annoncerait un parc plus rempli
   qu'il ne l'est. Ils sont desormais comptes a part.

   Usage :
     node outils/refonte-3b-bande-champs.js --essai
     node outils/refonte-3b-bande-champs.js
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

if (!fs.existsSync(CIBLE)) echec('public/js/bh-bande-jours.js introuvable. Lancez d\'abord refonte-3-bande-jours.js.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf("'startDate'") !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois).');
  }
  src = src.split(avant).join(apres);
}

/* ── 1. camelCase en tete ────────────────────────────────────── */

remplacer(
`  var DEBUTS = ['start_date', 'reservation_start_date', 'checkin', 'check_in', 'arrival_date', 'arrival', 'date_debut', 'from'];
  var FINS   = ['end_date', 'reservation_end_date', 'checkout', 'check_out', 'departure_date', 'departure', 'date_fin', 'to'];`,
`  /* Votre API repond en camelCase : startDate / endDate, avec start / end
     en doublon. Le snake_case reste en repli pour les autres routes. */
  var DEBUTS = ['startDate', 'start', 'start_date', 'reservation_start_date', 'checkin', 'check_in', 'arrival_date', 'date_debut'];
  var FINS   = ['endDate', 'end', 'end_date', 'reservation_end_date', 'checkout', 'check_out', 'departure_date', 'date_fin'];`,
  'les listes de champs'
);

/* ── 2. Un blocage manuel n'est pas une nuit vendue ─────────── */

remplacer(
`    var compte = {}, departs = {};
    lignes.forEach(function (r) {
      var st = String(r.status || r.state || '').toLowerCase();
      if (st.indexOf('cancel') !== -1 || st.indexOf('annul') !== -1) return;
      var d1 = versDate(r[cDebut]), d2 = versDate(r[cFin]);
      if (!d1 || !d2) return;
      for (var d = new Date(d1); d < d2; d.setDate(d.getDate() + 1)) {
        var k = ymd(d);
        compte[k] = (compte[k] || 0) + 1;
      }
      var kf = ymd(d2);
      departs[kf] = (departs[kf] || 0) + 1;
    });
    return { compte: compte, departs: departs };`,
`    var compte = {}, departs = {}, bloques = {}, noms = {};
    lignes.forEach(function (r) {
      var st = String(r.status || r.state || '').toLowerCase();
      if (st.indexOf('cancel') !== -1 || st.indexOf('annul') !== -1) return;

      var d1 = versDate(r[cDebut]), d2 = versDate(r[cFin]);
      if (!d1 || !d2) return;

      /* Un blocage manuel occupe la nuit mais ne la vend pas. Le compter
         comme une reservation gonflerait l'occupation affichee. */
      var manuel = r.isManual === true || String(r.type || '').toLowerCase().indexOf('block') !== -1
        || String(r.source || '').toLowerCase().indexOf('manual') !== -1;

      for (var d = new Date(d1); d < d2; d.setDate(d.getDate() + 1)) {
        var k = ymd(d);
        if (manuel) bloques[k] = (bloques[k] || 0) + 1;
        else compte[k] = (compte[k] || 0) + 1;
      }

      /* Un blocage qui se termine n'appelle pas de menage. */
      if (!manuel) {
        var kf = ymd(d2);
        departs[kf] = (departs[kf] || 0) + 1;
        var nom = r.propertyName || r.property_name || '';
        if (nom) {
          if (!noms[kf]) noms[kf] = [];
          if (noms[kf].indexOf(nom) === -1) noms[kf].push(nom);
        }
      }
    });
    return { compte: compte, departs: departs, bloques: bloques, noms: noms };`,
  'le comptage'
);

/* ── 3. La reponse vide garde la meme forme ─────────────────── */

remplacer(
  "    if (!lignes.length) return { compte: {}, departs: {} };",
  "    if (!lignes.length) return { compte: {}, departs: {}, bloques: {}, noms: {} };",
  'la reponse vide'
);

/* ── 4. L'infobulle nomme les logements qui partent ─────────── */

remplacer(
`      var occupe = (donnees.compte[k] || 0) > 0;
      var depart = (donnees.departs[k] || 0) > 0;
      jours.push({ date: k, occupe: occupe, depart: depart, nuits: donnees.compte[k] || 0 });`,
`      var occupe = (donnees.compte[k] || 0) > 0;
      var depart = (donnees.departs[k] || 0) > 0;
      var bloque = (donnees.bloques[k] || 0) > 0;
      jours.push({
        date: k,
        occupe: occupe,
        depart: depart,
        nuits_vendues: donnees.compte[k] || 0,
        blocages: donnees.bloques[k] || 0,
        departs: donnees.departs[k] || 0,
        logements_qui_partent: (donnees.noms[k] || []).join(', ')
      });`,
  'la construction des jours'
);

remplacer(
`      cell.title = jours[i].nuits + ' nuit(s) occupee(s)' + (depart ? ', depart' : '');`,
`      var infos = [(donnees.compte[k] || 0) + ' nuit(s) vendue(s)'];
      if (bloque) infos.push((donnees.bloques[k] || 0) + ' blocage(s) manuel(s)');
      if (depart) infos.push('depart : ' + ((donnees.noms[k] || []).join(', ') || (donnees.departs[k] + ' logement(s)')));
      cell.title = infos.join(' \\u00b7 ');`,
  'l\'infobulle'
);

/* ── 5. Une nuit seulement bloquee se voit, en creux ────────── */

remplacer(
`      if (depart) {
        var p2 = document.createElement('span');
        p2.style.cssText = 'width:4px;height:4px;border-radius:50%;background:' + AMBRE;
        pts.appendChild(p2);
      }`,
`      if (depart) {
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
      }`,
  'les pastilles'
);

remplacer(
  "      + '<span style=\"width:5px;height:5px;border-radius:50%;background:' + AMBRE + '\"></span>départ, ménage à prévoir</span>';",
  "      + '<span style=\"width:5px;height:5px;border-radius:50%;background:' + AMBRE + '\"></span>départ, ménage à prévoir</span>'\n"
  + "      + '<span style=\"display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '\">'\n"
  + "      + '<span style=\"width:5px;height:5px;border-radius:50%;border:1px solid #B9B4A8;box-sizing:border-box\"></span>bloqué</span>';",
  'la legende'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['startDate en tete', "var DEBUTS = ['startDate', 'start',"],
  ['endDate en tete', "var FINS   = ['endDate', 'end',"],
  ['la detection du blocage manuel', 'var manuel = r.isManual === true'],
  ['le comptage separe', 'if (manuel) bloques[k] = (bloques[k] || 0) + 1;'],
  ['pas de menage sur un blocage', 'if (!manuel) {'],
  ['les noms de logements', 'logements_qui_partent'],
  ['la pastille creuse', 'if (bloque && !occupe) {'],
  ['la legende bloque', 'bloqué</span>'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf("'startDate'") === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  startDate / endDate en tete, start / end en repli');
console.log('  isManual : un blocage manuel ne compte pas comme nuit vendue');
console.log('  propertyName : l\'infobulle nomme le logement qui part');
console.log('  Trois pastilles : vert vendu, ambre depart, creux bloque');
console.log('\n  A verifier sur telephone, cache vide : /app.html');
console.log('  La bande doit apparaitre. Puis :  bhVerifBande()');
console.log('  Le tableau donne par jour : nuits_vendues, blocages, departs,');
console.log('  logements_qui_partent. Comparez « aujourd\'hui » avec vos chiffres :');
console.log('  vous avez 7 arrivees, 3 departs et 26 logements actifs.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

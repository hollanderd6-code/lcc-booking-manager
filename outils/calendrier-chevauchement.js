#!/usr/bin/env node
/* ============================================================
   outils/calendrier-chevauchement.js
   Deux sejours sur la meme nuit : des barres dessinees l'une SUR l'autre
   ============================================================
   Cible : public/app.html  (fonction renderMonth, vue Mensuel)

   ── LE DEFAUT, ET LA LIGNE QUI LE PROUVE ─────────────────────────
   Dans renderMonth, chaque reservation est posee en absolu dans la
   cellule de son arrivee, avec une geometrie verticale FIXE :

       blk.style.setProperty('top', padPx + 'px', 'important');
       blk.style.setProperty('height', (rowH - 2*padPx) + 'px', 'important');

   Toutes les barres d'une meme ligne occupent donc la meme bande, sur
   toute la hauteur de la ligne. Aucune notion de piste, aucun test de
   chevauchement : deux sejours qui partagent une nuit sont dessines
   l'un par-dessus l'autre.

   C'est pourquoi les lignes « normales » le sont : un depart le 12 et
   une arrivee le 12 ne se chevauchent pas (le checkout est exclusif),
   les barres se touchent sans se superposer. Des qu'il y a UNE nuit
   commune — doublon iCal/Channex, double reservation, ou hold BHGuest
   non libere apres paiement — les deux barres se marchent dessus et
   les noms se melangent (« Bringboui Nat... e » : le nom tronque de la
   barre du dessus, suivi de la derniere lettre de celle du dessous qui
   depasse a droite).

   ── LA CORRECTION ────────────────────────────────────────────────
   1. bhPlanRow() : par logement, on calcule les chevauchements reels
      et on attribue une PISTE a chaque sejour (algorithme classique de
      pistes : premiere piste dont la fin est <= au debut du suivant).
      La hauteur de la ligne est partagee entre les pistes utilisees.
      Une ligne sans chevauchement garde exactement son rendu actuel
      (1 piste = hauteur pleine).

   2. Un hold BHGuest dont les nuits sont entierement couvertes par une
      reservation confirmee n'est plus affiche : c'est un residu (le
      paiement est passe, le hold n'a pas ete libere cote serveur). Sans
      ca, un sejour paye apparait deux fois, en deux couleurs.
      /!\ Ce point-ci masque le symptome, il ne corrige pas la base :
      la liberation du hold au paiement reste a faire dans server.js.

   3. Deux sejours CONFIRMES qui partagent une nuit sont cercles de
      rouge : c'est une double reservation, elle doit se voir.

   ── CE QUE CE LOT NE FAIT PAS ────────────────────────────────────
   Il ne touche ni la vue Jour, ni la vue Semaine, ni le serveur.
   Il ne supprime aucun doublon en base.

   Usage :
     node outils/calendrier-chevauchement.js --essai
     node outils/calendrier-chevauchement.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

/* La vue Mensuel vit dans public/app.html ; les builds natifs en gardent
   une copie. On corrige tout fichier present qui contient l'ancre. */
const CIBLES = [
  'public/app.html',
  'ios/App/App/public/app.html',
  'android/app/src/main/assets/public/app.html'
].map(p => path.join(process.cwd(), p));

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

/* ── Le code injecte ─────────────────────────────────────────────── */

const HELPERS = `  // ── Chevauchements : une piste par sejour qui se superpose ──────
  // Deux sejours qui partagent au moins une nuit ne peuvent pas occuper
  // la meme bande : ils etaient dessines l'un SUR l'autre, noms melanges.
  // Le checkout est exclusif : un depart et une arrivee le meme jour ne
  // se chevauchent PAS et restent donc sur une seule piste.
  function bhIsHold(r) {
    var v = String(r.source || r.platform || '').toLowerCase();
    return v === 'bhguest_hold' || v === 'hold' || r.type === 'hold' || r.status === 'hold'
      || (r.uid && String(r.uid).indexOf('hold_') === 0);
  }
  function bhPlanRow(bookings, prop, rangeStart, numDays) {
    var base = ds(rangeStart);
    var items = [];
    (bookings || []).forEach(function(r) {
      if (!r || String(r.propertyId) !== String(prop.id)) return;
      var s = (r.startDate || r.start || '').split('T')[0];
      var e = (r.endDate   || r.end   || '').split('T')[0];
      if (!s || !e) return;
      var cs = Math.round((new Date(s + 'T00:00:00') - new Date(base + 'T00:00:00')) / MS);
      var ce = Math.round((new Date(e + 'T00:00:00') - new Date(base + 'T00:00:00')) / MS);
      if (ce <= 0 || cs >= numDays) return;
      items.push({ r: r, cs: cs, ce: ce, hold: bhIsHold(r), lane: 0, conflict: false });
    });

    // 1) Hold residuel : ses nuits sont deja couvertes par une reservation
    //    confirmee. Le paiement est passe, le hold n'a pas ete libere.
    items = items.filter(function(it) {
      if (!it.hold) return true;
      return !items.some(function(o) { return !o.hold && o.cs <= it.cs && o.ce >= it.ce; });
    });

    // 2) Double reservation confirmee sur une meme nuit : a signaler.
    items.forEach(function(a) {
      if (a.hold) return;
      items.forEach(function(b) {
        if (b === a || b.hold) return;
        if (a.cs < b.ce && b.cs < a.ce) { a.conflict = true; b.conflict = true; }
      });
    });

    // 3) Pistes : premiere piste dont la fin est <= au debut du sejour.
    items.sort(function(a, b) { return a.cs - b.cs || a.ce - b.ce; });
    var fins = [];
    items.forEach(function(it) {
      var i = 0;
      while (i < fins.length && fins[i] > it.cs) i++;
      it.lane = i;
      fins[i] = it.ce;
    });

    return { items: items, lanes: Math.max(1, fins.length) };
  }

`;

const REGLES = [
  {
    quoi: 'la boucle des blocs lit desormais les pistes calculees',
    avant:
`    state.properties.forEach(function(prop, rowIdx) {
      state.bookings.forEach(function(r) {
        if (String(r.propertyId) !== String(prop.id)) return;
        var s = (r.startDate||r.start||'').split('T')[0];`,
    apres:
`    state.properties.forEach(function(prop, rowIdx) {
      var _plan = bhPlanRow(state.bookings, prop, rangeStart, numDays);
      _plan.items.forEach(function(it) {
        var r = it.r;
        var s = (r.startDate||r.start||'').split('T')[0];`
  },
  {
    quoi: 'la hauteur de la barre est celle de sa piste',
    avant:
`        blk.style.setProperty('top', padPx + 'px', 'important');
        blk.style.setProperty('height', (rowH - 2*padPx) + 'px', 'important');`,
    apres:
`        var _gap  = _plan.lanes > 1 ? 2 : 0;
        var _laneH = (rowH - 2*padPx - _gap * (_plan.lanes - 1)) / _plan.lanes;
        blk.style.setProperty('top', (padPx + it.lane * (_laneH + _gap)) + 'px', 'important');
        blk.style.setProperty('height', _laneH + 'px', 'important');`
  },
  {
    quoi: 'lisibilite en piste etroite + cerclage des doubles reservations',
    avant: `        anchorCell.appendChild(blk);`,
    apres:
`        // Piste etroite : on rend la place au nom (badge plateforme retire).
        if (_laneH < 20) {
          blk.style.padding = '0 5px';
          blk.style.borderRadius = '6px';
          var _badge = blk.firstElementChild;
          if (_badge && _badge.tagName === 'DIV') _badge.style.display = 'none';
          var _lbl = blk.querySelector('span:last-child');
          if (_lbl) _lbl.style.fontSize = (_laneH < 15 ? '8.5px' : '10px');
        }
        // Deux sejours confirmes sur une meme nuit : ca doit se voir.
        if (it.conflict) {
          blk.style.outline = '1.5px solid #EF4444';
          blk.style.outlineOffset = '-1.5px';
          blk.title = 'Chevauchement : deux reservations sur ces nuits';
        }
        anchorCell.appendChild(blk);`
  },
  {
    quoi: 'insertion des fonctions de pistes',
    avant: `  function renderMonth(body) {`,
    apres: HELPERS + `  function renderMonth(body) {`
  }
];

/* ── Application ─────────────────────────────────────────────────── */

const fichiers = CIBLES.filter(f => fs.existsSync(f));
if (!fichiers.length) echec('Aucun app.html trouve. Lancez depuis la racine du projet.');

const aEcrire = [];
let traites = 0;

fichiers.forEach(function (cible) {
  let src = fs.readFileSync(cible, 'utf8');
  const nom = path.relative(process.cwd(), cible);

  if (src.indexOf('function bhPlanRow') !== -1) {
    console.log('  \u2014 ' + nom + ' : deja applique, ignore.');
    return;
  }
  if (src.indexOf(REGLES[0].avant) === -1) {
    console.log('  \u2014 ' + nom + " : ancre absente (version differente), ignore.");
    return;
  }

  REGLES.forEach(function (r) {
    const n = src.split(r.avant).length - 1;
    if (n !== 1) echec(nom + ' : « ' + r.quoi + ' » attendait 1 occurrence, ' + n + ' trouvee(s).');
    src = src.split(r.avant).join(r.apres);
  });

  /* Verifications */
  if (src.indexOf('function bhPlanRow') === -1) echec(nom + ' : bhPlanRow absent apres modification.');
  if (src.indexOf('_plan.items.forEach') === -1) echec(nom + ' : la boucle des blocs n\'a pas ete reliee aux pistes.');
  if (src.indexOf("(rowH - 2*padPx) + 'px', 'important'") !== -1) echec(nom + ' : une hauteur pleine subsiste.');

  aEcrire.push({ cible: cible, nom: nom, src: src });
  traites++;
});

if (!traites) { console.log('\n  Rien a faire.\n'); process.exit(0); }

if (!ESSAI) {
  aEcrire.forEach(function (f) {
    const sauvegarde = f.cible + '.avant-chevauchement';
    if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(f.cible));
    fs.writeFileSync(f.cible, f.src, 'utf8');
    if (fs.readFileSync(f.cible, 'utf8').indexOf('function bhPlanRow') === -1) {
      echec("La correction n'est pas dans " + f.nom + ' apres ecriture.');
    }
  });
}

console.log('\n' + (ESSAI ? '\u2014 ESSAI, aucune ecriture \u2014' : '\u2014 APPLIQUE ET VERIFIE \u2014'));
aEcrire.forEach(f => console.log('  ' + f.nom + '  (4 modifications)'));
if (!ESSAI) console.log('  Sauvegardes : *.avant-chevauchement (ne pas commiter)');
console.log('');
console.log('  A verifier ensuite, vue Mensuel :');
console.log('  \u2022 CDG5 : les deux sejours apparaissent sur deux demi-bandes,');
console.log('    cercles de rouge (chevauchement reel a trancher en base).');
console.log('  \u2022 M13 : une seule barre — le hold residuel n\'est plus affiche.');
console.log('  \u2022 Une ligne sans chevauchement doit etre INCHANGEE (barre pleine hauteur).');
console.log('');
console.log('  Reste a faire cote serveur (hors de ce lot) :');
console.log('    liberer le hold BHGuest quand le paiement aboutit, et creer la');
console.log('    reservation depuis le webhook Stripe et non au retour du navigateur.');
console.log('');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

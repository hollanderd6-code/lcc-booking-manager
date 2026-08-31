#!/usr/bin/env node
/* ============================================================
   outils/refonte-8-liste-unifiee.js
   Lot 8 : une seule source de verite pour « qui arrive aujourd'hui »
   ============================================================

   ── LE DEFAUT MESURE ─────────────────────────────────────────────
   Trois chiffres pour un meme jour :

       ma liste (/api/reservations)      4
       le compteur (conversations)       7
       /api/aujourdhui/etats             7

   Manquent dans la liste : AM2 / Sandra demay, M10 / Guillaume didier,
   M11 / Ridwan abdi, M13 / Thomas De Sousa. Les quatre sont sur
   Boostinghost Guest — vos reservations directes. En echange la liste
   affiche « Pre-reservation — M4 », que la route ne voit pas.

   Ce n'est pas un defaut d'affichage. Ce sont deux populations
   differentes, et vos reservations directes tombent dans la faille.

   ── CE QUE FAIT LE LOT ───────────────────────────────────────────
   1. SERVEUR (lecture seule) : /api/aujourdhui/etats renvoie desormais
      « departs » a cote de « arrivees ». Meme table, meme journee, meme
      verite. Sans cela, abandonner /api/reservations ferait disparaitre
      la liste des departs.

   2. NAVIGATEUR : un module bh-liste-unifiee.js lit cette route et
      construit trois sections :

          A TRAITER MAINTENANT   les arrivees sans infos envoyees,
                                 avec la CAUSE (condition_envoi)
          ARRIVEES               le reste, avec ce qui est deja fait
          DEPARTS                menage attendu / fait

      L'ancien bloc #bhListesJour est masque, pas supprime : son garde
      « si le bloc existe, ne rien reconstruire » suffit alors a
      l'endormir, et bhAnnulerListe() le fait revenir.

   ── LA CAUSE, PAS LE SYMPTOME ────────────────────────────────────
   Une carte « Infos non envoyees » sans raison ne sert a rien. Le module
   nomme la condition qui retient le message — « police_complete » pour
   Roxana. Si la condition vaut « always » et que rien n'est parti, il le
   dit aussi : la carte affiche « condition always — cause a chercher »,
   ce qui est une information, pas un remplissage.

   ── CE QUE JE N'INVENTE PAS ──────────────────────────────────────
   Les cartes urgentes pointent vers /messages.html, les autres vers
   /reservations.html. Je ne fabrique aucun parametre d'URL pour ouvrir
   directement une conversation : je ne sais pas lequel votre page
   accepte. Dites-le moi et c'est une ligne.

   ── REVERSIBLE ───────────────────────────────────────────────────
   bhAnnulerListe()        rend la main a l'ancien bloc
   bhVerifListeUnifiee()   ce qui est affiche, et d'ou ca vient

   Usage :
     node outils/refonte-8-liste-unifiee.js --essai
     node outils/refonte-8-liste-unifiee.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const SERVEUR = path.join(RACINE, 'server.js');
const PUBLIC = path.join(RACINE, 'public');
const APP = path.join(PUBLIC, 'app.html');
const MODULE = path.join(PUBLIC, 'js', 'bh-liste-unifiee.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(SERVEUR)) echec('server.js introuvable. Lancez depuis la racine du projet.');
if (!fs.existsSync(APP)) echec('public/app.html introuvable.');
if (!fs.existsSync(path.join(PUBLIC, 'js', 'bh-listes-jour.js'))) {
  echec('bh-listes-jour.js absent. Lancez d\'abord le lot 5.');
}

/* ============================================================
   1. SERVEUR — « departs » dans la meme route
   ============================================================ */

let src = fs.readFileSync(SERVEUR, 'utf8');
let etatServeur;

if (src.indexOf('/api/aujourdhui/etats') === -1) {
  echec('La route est absente. Lancez d\'abord refonte-6-route-etats.js.');
}
if (src.indexOf('menage_attendu') === -1) {
  echec('Le lot 6b n\'est pas applique (menage_attendu absent). Lancez-le d\'abord.');
}

if (src.indexOf('const departsListe = ') !== -1) {
  etatServeur = 'deja applique';
} else {
  const remplacer = (avant, apres, quoi) => {
    const n = src.split(avant).length - 1;
    if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
    src = src.split(avant).join(apres);
  };

  remplacer(
    '    const sortie = arrivees.rows.map(r => {',
`    // Les departs du jour, lus dans la meme table que les arrivees.
    // Une seule source pour « qui bouge aujourd'hui » : c'est tout
    // l'objet de ce lot. Le menage y est celui de la fiche du jour.
    let departsListe = [];
    try {
      const depJour = await pool.query(
        \`SELECT c.id AS conversation_id, c.guest_name, c.property_id, c.platform,
                p.name AS property_name,
                to_char(c.reservation_end_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS depart
         FROM conversations c
         LEFT JOIN properties p ON p.id = c.property_id
         WHERE c.user_id = ANY($1::text[])
           AND c.status <> 'cancelled'
           AND DATE(c.reservation_end_date AT TIME ZONE 'Europe/Paris') = $2
         ORDER BY p.name NULLS LAST\`,
        [ids, jour]
      );
      departsListe = depJour.rows.map(r => ({
        conversation_id: r.conversation_id,
        guest_name: r.guest_name,
        property_id: r.property_id,
        property_name: r.property_name,
        platform: r.platform,
        depart: r.depart,
        menage_fait: menages[r.property_id] ? !!menages[r.property_id].completed_at : null,
        menage_valide: menages[r.property_id] ? !!menages[r.property_id].is_validated : null
      }));
    } catch (e) {
      // Departs indisponibles : tableau vide, jamais une fausse liste.
      console.error('[AUJOURDHUI/ETATS] departs:', e.message);
    }

    const sortie = arrivees.rows.map(r => {`,
    'le point d\'insertion des departs'
  );

  remplacer(
`      arrivees: sortie,
      diagnostic`,
`      arrivees: sortie,
      departs: departsListe,
      diagnostic`,
    'la reponse de la route'
  );

  [
    ['la lecture des departs', 'let departsListe = []'],
    ['le menage des departs', 'menage_valide: menages[r.property_id]'],
    ['les departs renvoyes', 'departs: departsListe,'],
  ].forEach(function (c) {
    if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
  });

  /* Toujours en lecture seule. */
  const debut = src.indexOf("app.get('/api/aujourdhui/etats'");
  const fin = src.indexOf('async function runTemplatesCron');
  if (debut === -1 || fin === -1 || fin < debut) echec('Impossible de delimiter la route pour la verifier.');
  const zone = src.slice(debut, fin).toUpperCase();
  ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE'].forEach(function (mot) {
    if (zone.indexOf(mot) !== -1) echec('La route contiendrait \u00ab ' + mot.trim() + ' \u00bb. Refus.');
  });

  try {
    new Function(src);
  } catch (e) {
    echec('server.js ne serait plus du JavaScript valide — ' + e.message);
  }

  etatServeur = 'departs ajoutes a /api/aujourdhui/etats';
  if (!ESSAI) {
    const sauvegarde = SERVEUR + '.avant-liste-unifiee';
    if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(SERVEUR));
    fs.writeFileSync(SERVEUR, src, 'utf8');
    if (fs.readFileSync(SERVEUR, 'utf8').indexOf('departs: departsListe,') === -1) {
      echec("Les departs ne sont pas dans le fichier apres ecriture.");
    }
  }
}

/* ============================================================
   2. NAVIGATEUR — le module
   ============================================================ */

const SOURCE = `/* ============================================================
   bh-liste-unifiee.js — une seule source pour la journee
   ============================================================
   Lit /api/aujourdhui/etats : sept arrivees, pas quatre. Les
   reservations directes (Boostinghost Guest) existent en conversation
   mais pas dans /api/reservations — c'est la faille que ce module ferme.

   Trois sections : A TRAITER MAINTENANT, ARRIVEES, DEPARTS.
   Une carte urgente nomme toujours sa cause.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhListeUnifiee) return;
  window.__bhListeUnifiee = true;

  var ENCRE = '#0D1117';
  var GRIS = '#7A8695';
  var BORD = '#E4E1D8';
  var ROUGE = '#A8452A';

  var mem = [];
  var diag = { a_traiter: [], arrivees: [], departs: [], date: '', erreur: '', source: '/api/aujourdhui/etats' };

  function jeton() {
    return localStorage.getItem('lcc_token') || localStorage.getItem('token') || '';
  }

  /* Les conditions d'envoi telles que les nomme votre serveur. Une
     condition inconnue est affichee brute plutot que traduite au
     jugé : mieux vaut un nom technique qu'un contresens. */
  var CONDITIONS = {
    police_complete: 'Fiche police non signée',
    deposit_paid: 'Caution non payée',
    deposit_authorized: 'Caution non autorisée',
    contract_signed: 'Contrat non signé',
    checkin_completed: 'Enregistrement non terminé',
    id_verified: 'Pièce d identité non vérifiée'
  };

  function cause(a) {
    var c = a.condition_envoi;
    if (!c) return null;
    if (c === 'always') return 'Condition « always » — cause ailleurs';
    return CONDITIONS[c] || ('Condition « ' + c + ' »');
  }

  var PLATEFORMES = {
    airbnb: { nom: 'AIRBNB', fond: '#E4EDE8', encre: '#0E3B2E' },
    abb: { nom: 'AIRBNB', fond: '#E4EDE8', encre: '#0E3B2E' },
    booking: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    bookingcom: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    bdc: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    expedia: { nom: 'EXPEDIA', fond: '#EEF0F6', encre: '#3A4A6B' },
    boostinghost: { nom: 'BHGUEST', fond: '#F4EDE4', encre: '#8A5B14' },
    bhguest: { nom: 'BHGUEST', fond: '#F4EDE4', encre: '#8A5B14' }
  };

  function plateforme(p) {
    var brut = String(p || '').toLowerCase().replace(/[^a-z]/g, '');
    for (var k in PLATEFORMES) {
      if (brut.indexOf(k) !== -1) return PLATEFORMES[k];
    }
    return brut ? { nom: String(p).toUpperCase().slice(0, 9), fond: '#F0EEE7', encre: '#5A5A54' } : null;
  }

  function nuits(a, b) {
    if (!a || !b) return null;
    var d1 = new Date(a), d2 = new Date(b);
    var n = Math.round((d2 - d1) / 86400000);
    return n > 0 ? n : null;
  }

  var TONS = {
    rouge: { fond: '#FDF0EC', encre: '#A8452A' },
    ambre: { fond: '#FBF3E2', encre: '#8A5B14' },
    vert: { fond: '#E9F0EC', encre: '#0E3B2E' },
    gris: { fond: '#F4F2EC', encre: '#5A5A54' }
  };

  function pastille(texte, ton) {
    var t = TONS[ton] || TONS.gris;
    var el = document.createElement('span');
    el.textContent = texte;
    el.style.cssText = 'font-size:12px;font-weight:600;border-radius:8px;padding:7px 10px'
      + ';color:' + t.encre + ';background:' + t.fond;
    return el;
  }

  function carte(titre, second, plat, pastilles, urgent, lien) {
    var el = document.createElement('a');
    el.href = lien;
    el.style.cssText = 'display:block;text-decoration:none;background:#fff;border-radius:16px'
      + ';padding:14px 15px;margin-bottom:10px'
      + (urgent ? ';border:1px solid #F0DDD5;border-left:4px solid ' + ROUGE
                : ';border:1px solid ' + BORD);

    var haut = document.createElement('div');
    haut.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px';

    var g = document.createElement('div');
    g.style.cssText = 'min-width:0';
    var t = document.createElement('div');
    t.textContent = titre || 'Sans nom';
    t.style.cssText = 'font-size:17px;font-weight:600;color:' + ENCRE
      + ';letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    g.appendChild(t);
    if (second) {
      var s = document.createElement('div');
      s.textContent = second;
      s.style.cssText = 'font-size:13px;color:' + GRIS + ';margin-top:2px';
      g.appendChild(s);
    }
    haut.appendChild(g);

    var p = plateforme(plat);
    if (p) {
      var b = document.createElement('div');
      b.textContent = p.nom;
      b.style.cssText = 'flex:none;font-size:10px;font-weight:700;letter-spacing:.07em;border-radius:7px'
        + ';padding:5px 8px;color:' + p.encre + ';background:' + p.fond;
      haut.appendChild(b);
    }
    el.appendChild(haut);

    if (pastilles.length) {
      var rang = document.createElement('div');
      rang.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-top:11px';
      pastilles.forEach(function (x) { rang.appendChild(x); });
      el.appendChild(rang);
    }
    return el;
  }

  function titreSection(texte, compte) {
    var t = document.createElement('div');
    t.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.13em;color:#8B8B84;padding:8px 4px 9px';
    t.textContent = texte + (compte ? ' \\u00b7 ' + compte : '');
    return t;
  }

  function urgente(a) {
    return a.message_envoye === false
      || a.caution_bloquante === true
      || (a.menage_attendu === true && a.menage_fait === false);
  }

  function pastillesArrivee(a, urgent) {
    var out = [];
    if (urgent) {
      if (a.message_envoye === false) out.push(pastille('Infos non envoyées', 'rouge'));
      var c = cause(a);
      if (a.message_envoye === false && c) out.push(pastille(c, 'ambre'));
      if (a.caution_bloquante === true) out.push(pastille('Caution non autorisée', 'ambre'));
      if (a.menage_attendu === true && a.menage_fait === false) out.push(pastille('Ménage non fait', 'ambre'));
    } else {
      if (a.message_envoye === true) out.push(pastille('Infos envoyées', 'vert'));
      if (a.menage_fait === true) out.push(pastille('Ménage fait', 'vert'));
      if (a.menage_attendu === false) out.push(pastille('Pas de ménage attendu', 'gris'));
    }
    return out;
  }

  /* On se place la ou l'ancien bloc se trouvait, pour ne rien deplacer
     d'autre dans la page. */
  function ancre() {
    var vieux = document.getElementById('bhListesJour');
    if (vieux && vieux.parentElement) return { parent: vieux.parentElement, avant: vieux };
    var bande = document.getElementById('bhBandeJours');
    if (bande && bande.parentElement) return { parent: bande.parentElement, avant: bande.nextSibling };
    return null;
  }

  /* L'ancien bloc est masque, pas supprime : son propre garde
     « si le bloc existe, ne pas reconstruire » l'endort alors. */
  function endormirAncien() {
    var vieux = document.getElementById('bhListesJour');
    if (!vieux || vieux.dataset.bhEndormi) return;
    mem.push({ el: vieux, valeur: vieux.style.getPropertyValue('display'), priorite: vieux.style.getPropertyPriority('display') });
    vieux.style.setProperty('display', 'none', 'important');
    vieux.dataset.bhEndormi = '1';
  }

  function construire(d) {
    if (document.getElementById('bhListeUnifiee')) return true;
    var place = ancre();
    if (!place) { diag.erreur = 'point d insertion introuvable'; return false; }

    var arrivees = Array.isArray(d.arrivees) ? d.arrivees : [];
    var departs = Array.isArray(d.departs) ? d.departs : [];
    if (!arrivees.length && !departs.length) { diag.erreur = 'aucun mouvement aujourd hui'; return false; }

    var chaudes = arrivees.filter(urgente);
    var calmes = arrivees.filter(function (a) { return !urgente(a); });

    var bloc = document.createElement('div');
    bloc.id = 'bhListeUnifiee';
    bloc.style.cssText = 'font-family:inherit;margin-top:14px';

    if (chaudes.length) {
      bloc.appendChild(titreSection('À TRAITER MAINTENANT', chaudes.length));
      chaudes.forEach(function (a) {
        var bas = [a.property_name, nuits(a.arrivee, a.depart) ? nuits(a.arrivee, a.depart) + ' nuit' + (nuits(a.arrivee, a.depart) > 1 ? 's' : '') : null]
          .filter(Boolean).join(' \\u00b7 ');
        bloc.appendChild(carte(a.guest_name, bas, a.platform, pastillesArrivee(a, true), true, '/messages.html'));
        diag.a_traiter.push((a.property_name || '?') + ' / ' + (a.guest_name || '?') + ' — ' + (cause(a) || 'sans condition connue'));
      });
    }

    if (calmes.length) {
      bloc.appendChild(titreSection('ARRIVÉES', arrivees.length));
      calmes.forEach(function (a) {
        var n = nuits(a.arrivee, a.depart);
        var bas = [a.property_name, n ? n + ' nuit' + (n > 1 ? 's' : '') : null].filter(Boolean).join(' \\u00b7 ');
        bloc.appendChild(carte(a.guest_name, bas, a.platform, pastillesArrivee(a, false), false, '/reservations.html'));
      });
    }
    arrivees.forEach(function (a) { diag.arrivees.push((a.property_name || '?') + ' / ' + (a.guest_name || '?')); });

    if (departs.length) {
      bloc.appendChild(titreSection('DÉPARTS', departs.length));
      departs.forEach(function (x) {
        var past = [];
        if (x.menage_fait === true) past.push(pastille(x.menage_valide === true ? 'Ménage fait et validé' : 'Ménage fait', 'vert'));
        else if (x.menage_fait === false) past.push(pastille('Ménage à faire', 'ambre'));
        bloc.appendChild(carte(x.property_name, x.guest_name, x.platform, past, false, '/reservations.html'));
        diag.departs.push((x.property_name || '?') + ' / ' + (x.guest_name || '?'));
      });
    }

    endormirAncien();
    place.parent.insertBefore(bloc, place.avant);
    return true;
  }

  function charger() {
    if (document.getElementById('bhListeUnifiee')) { endormirAncien(); return; }
    var t = jeton();
    if (!t) { diag.erreur = 'aucun jeton en memoire'; return; }

    fetch('/api/aujourdhui/etats', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) {
        if (!r.ok) throw new Error('route indisponible (' + r.status + ')');
        return r.json();
      })
      .then(function (d) {
        if (!d || !Array.isArray(d.arrivees)) { diag.erreur = 'forme de reponse non reconnue'; return; }
        diag.date = d.date || '';
        construire(d);
      })
      .catch(function (e) { diag.erreur = e.message; });
  }

  window.bhAnnulerListe = function () {
    var bloc = document.getElementById('bhListeUnifiee');
    if (bloc) bloc.remove();
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.valeur) m.el.style.setProperty('display', m.valeur, m.priorite);
      else m.el.style.removeProperty('display');
      delete m.el.dataset.bhEndormi;
    }
    var n = mem.length;
    mem = [];
    console.log('Liste unifiee retiree, ancien bloc rendu (' + n + ' changement(s)).');
    return n;
  };

  window.bhVerifListeUnifiee = function () {
    var res = {
      bloc_affiche: !!document.getElementById('bhListeUnifiee'),
      source: diag.source,
      date: diag.date,
      total_arrivees: diag.arrivees.length,
      a_traiter: diag.a_traiter,
      arrivees: diag.arrivees,
      departs: diag.departs,
      ancien_bloc_endormi: !!(document.getElementById('bhListesJour') || {}).dataset,
      erreur: diag.erreur
    };
    console.log('── Liste unifiee du jour ──');
    console.log(res);
    if (diag.a_traiter.length) console.table(diag.a_traiter);
    if (!res.bloc_affiche) console.warn('Non affiche : ' + (diag.erreur || 'inconnu'));
    console.log('Pour revenir en arriere : bhAnnulerListe()');
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(charger, 1400); });
  } else {
    setTimeout(charger, 1400);
  }
  setTimeout(charger, 3200);
  setTimeout(charger, 5800);
})();
`;

const BALISE = '<script src="js/bh-liste-unifiee.js"></script>';

let html = fs.readFileSync(APP, 'utf8');
let etatApp;

if (html.indexOf('bh-liste-unifiee.js') !== -1) {
  etatApp = 'balise deja presente';
} else {
  const ancre = html.indexOf('bh-listes-jour.js');
  if (ancre === -1) echec('bh-listes-jour.js absent de app.html. Lancez d\'abord le lot 5.');
  const fin = html.indexOf('</script>', ancre);
  if (fin === -1) echec('Balise mal formee dans app.html.');
  const pos = fin + '</script>'.length;
  html = html.slice(0, pos) + '\n' + BALISE + html.slice(pos);
  etatApp = 'balise ajoutee apres bh-listes-jour.js';
  if (!ESSAI) fs.writeFileSync(APP, html, 'utf8');
}

if (!ESSAI) {
  fs.writeFileSync(MODULE, SOURCE, 'utf8');
  const relu = fs.readFileSync(MODULE, 'utf8');
  if (relu.indexOf('bhAnnulerListe') === -1) echec("Le module n'est pas complet apres ecriture.");
  try { new Function(relu); } catch (e) { echec('Module invalide — ' + e.message); }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  server.js                      ' + etatServeur);
console.log('  public/js/bh-liste-unifiee.js  (' + Math.round(SOURCE.length / 1024) + ' Ko)');
console.log('  app.html                       ' + etatApp);
if (!ESSAI && etatServeur.indexOf('deja') === -1) {
  console.log('  Sauvegarde : server.js.avant-liste-unifiee (ne pas commiter)');
}
console.log('\n  La journee vient desormais d\'une seule route. Les quatre');
console.log('  reservations directes qui manquaient — AM2, M10, M11, M13 —');
console.log('  apparaissent, et les trois sans infos remontent en tete avec');
console.log('  la condition qui les retient.');
console.log('\n  Apres deploiement, sur telephone, cache vide :');
console.log('');
console.log('  bhVerifListeUnifiee()');
console.log('');
console.log('  Ce que j\'attends : total_arrivees 7, et « a_traiter » qui');
console.log('  nomme la condition de M10, M11 et M13. Si elle vaut « always »,');
console.log('  la carte le dit et la cause est ailleurs — on la cherche.');
console.log('\n  Annulation immediate, sans rechargement : bhAnnulerListe()\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

/* ============================================================
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
  /* En vue calendrier, ce module a bien quelque chose a construire : les
     mouvements du jour, sous le calendrier. Ce qui lui manquait n'etait
     pas le droit de tourner, c'etait un point d'ancrage — il visait la
     bande de sept jours, qui n'existe pas la. */
  var enVueCalendrier = (location.search || '').indexOf('vue=calendrier') !== -1
    || (location.pathname || '').split('/').pop().toLowerCase() === 'calendrier.html';
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
    deposit_active: 'Caution à autoriser',
    deposit_paid: 'Caution non payée',
    deposit_authorized: 'Caution non autorisée',
    police_complete: 'Fiche police non signée',
    contract_signed: 'Contrat non signé',
    checkin_completed: 'Enregistrement non terminé',
    id_verified: "Pièce d'identité non vérifiée"
  };

  /* Le serveur renvoie parfois plusieurs conditions separees par une
     virgule : « deposit_active,police_complete ». Chacune est une raison
     distincte, donc chacune sa pastille. Une condition inconnue passe
     telle quelle — un nom technique vaut mieux qu'une traduction
     inventee. */
  function causes(a) {
    var brut = a.condition_envoi;
    if (!brut) return [];
    var liste = String(brut).split(/[,+;|]/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!liste.length) return [];
    if (liste.length === 1 && liste[0] === 'always') return ['Envoi immédiat prévu — cause ailleurs'];
    var out = [];
    liste.forEach(function (c) {
      if (c === 'always') return;
      out.push(CONDITIONS[c] || c);
    });
    return out;
  }

  var PLATEFORMES = {
    airbnb: { nom: 'AIRBNB', fond: '#FCE7EC', encre: '#B81E4B' },
    abb: { nom: 'AIRBNB', fond: '#FCE7EC', encre: '#B81E4B' },
    booking: { nom: 'BOOKING', fond: '#E3EAF8', encre: '#123E86' },
    bookingcom: { nom: 'BOOKING', fond: '#E3EAF8', encre: '#123E86' },
    bdc: { nom: 'BOOKING', fond: '#E3EAF8', encre: '#123E86' },
    expedia: { nom: 'EXPEDIA', fond: '#EEF0F6', encre: '#3A4A6B' },
    boostinghost: { nom: 'BHGUEST', fond: '#FDEBDC', encre: '#A85413' },
    bhguest: { nom: 'BHGUEST', fond: '#FDEBDC', encre: '#A85413' }
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
    t.textContent = texte + (compte ? ' \u00b7 ' + compte : '');
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
      if (a.message_envoye === false) {
        causes(a).forEach(function (c) { out.push(pastille(c, 'ambre')); });
      }
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
    /* Vue calendrier : apres le calendrier, dans le conteneur de la vue.
       Tant que bh-vue-calendrier n'a pas pose sa racine, on attend —
       inserer avant reviendrait a etre masque avec le reste. */
    if (enVueCalendrier) {
      var racine = document.getElementById('bhVueRacine');
      var section = document.getElementById('calendarSection');
      if (!racine || !section || section.parentElement !== racine) return null;
      return { parent: racine, avant: section.nextSibling };
    }
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
          .filter(Boolean).join(' \u00b7 ');
        bloc.appendChild(carte(a.guest_name, bas, a.platform, pastillesArrivee(a, true), true, '/messages.html'));
        diag.a_traiter.push((a.property_name || '?') + ' / ' + (a.guest_name || '?') + ' — ' + (causes(a).join(' + ') || 'sans condition connue'));
      });
    }

    if (calmes.length) {
      bloc.appendChild(titreSection('ARRIVÉES', arrivees.length));
      calmes.forEach(function (a) {
        var n = nuits(a.arrivee, a.depart);
        var bas = [a.property_name, n ? n + ' nuit' + (n > 1 ? 's' : '') : null].filter(Boolean).join(' \u00b7 ');
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
  /* bh-vue-calendrier peut poser sa racine jusqu'a 11 s : sans ces
     passages, la liste renoncerait avant qu'elle existe. */
  [8000, 11500, 14000].forEach(function (t) { setTimeout(charger, t); });
})();

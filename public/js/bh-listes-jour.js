/* ============================================================
   bh-listes-jour.js — arrivees et departs du jour, nommement
   ============================================================
   Un appel en lecture a /api/reservations. Aucune supposition : ce qui
   n'est pas dans la reponse n'est pas affiche.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhListesJour) return;
  window.__bhListesJour = true;

  var VERT = '#0E3B2E';
  var ENCRE = '#0D1117';
  var GRIS = '#7A8695';
  var BORD = '#E4E1D8';

  var diag = { arrivees: [], departs: [], erreur: '', champs_manquants: {} };

  function jeton() {
    return localStorage.getItem('lcc_token') || localStorage.getItem('token') || '';
  }

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function versDate(v) {
    if (!v) return null;
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function nuits(a, b) {
    if (!a || !b) return null;
    var n = Math.round((b - a) / 86400000);
    return n > 0 ? n : null;
  }

  /* L'heure d'arrivee n'existe peut-etre pas dans la reponse. On la
     cherche, et on se passe d'elle si elle manque. */
  function heure(r) {
    var champs = ['checkinTime', 'checkin_time', 'arrivalTime', 'arrival_time', 'checkInTime'];
    for (var i = 0; i < champs.length; i++) {
      var v = r[champs[i]];
      if (!v) continue;
      var m = String(v).match(/^(\d{1,2})[:h](\d{2})/);
      if (m) return (+m[1]) + ' h' + (m[2] === '00' ? '' : ' ' + m[2]);
    }
    diag.champs_manquants.heure = true;
    return null;
  }

  var PLATEFORMES = {
    airbnb: { nom: 'AIRBNB', fond: '#E4EDE8', encre: '#0E3B2E' },
    abb: { nom: 'AIRBNB', fond: '#E4EDE8', encre: '#0E3B2E' },
    booking: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    bookingcom: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    bdc: { nom: 'BOOKING', fond: '#FBEAE4', encre: '#A8452A' },
    expedia: { nom: 'EXPEDIA', fond: '#EEF0F6', encre: '#3A4A6B' },
    bhguest: { nom: 'DIRECT', fond: '#F0EEE7', encre: '#5A5A54' }
  };

  function plateforme(r) {
    var brut = String(r.platform || r.source || r.ota_name || '').toLowerCase().replace(/[^a-z]/g, '');
    for (var k in PLATEFORMES) {
      if (brut.indexOf(k) !== -1) return PLATEFORMES[k];
    }
    return brut ? { nom: (r.platform || r.source || '').toUpperCase().slice(0, 9), fond: '#F0EEE7', encre: '#5A5A54' } : null;
  }

  function manuel(r) {
    return r.isManual === true
      || String(r.type || '').toLowerCase().indexOf('block') !== -1
      || String(r.guestName || '').toLowerCase().indexOf('blocage') !== -1;
  }

  function trier(lignes) {
    var auj = ymd(new Date());
    var arr = [], dep = [];
    lignes.forEach(function (r) {
      var st = String(r.status || '').toLowerCase();
      if (st.indexOf('cancel') !== -1 || st.indexOf('annul') !== -1) return;
      if (manuel(r)) return;

      var d1 = versDate(r.startDate || r.start || r.start_date);
      var d2 = versDate(r.endDate || r.end || r.end_date);
      if (d1 && ymd(d1) === auj) arr.push({ r: r, d1: d1, d2: d2 });
      if (d2 && ymd(d2) === auj) dep.push({ r: r, d1: d1, d2: d2 });
    });
    return { arr: arr, dep: dep };
  }

  function ligne(item, estDepart) {
    var r = item.r;
    var el = document.createElement('a');
    el.href = '/reservations.html';
    el.style.cssText = 'display:block;text-decoration:none;background:#fff;border:1px solid ' + BORD
      + ';border-radius:16px;padding:14px 15px;margin-bottom:10px';

    var haut = document.createElement('div');
    haut.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px';

    var titre = (estDepart ? (r.propertyName || r.property_name) : (r.guestName || r.guest_name)) || '';
    var second = estDepart ? (r.guestName || r.guest_name || '') : (r.propertyName || r.property_name || '');
    if (!titre) { titre = second || 'Sans nom'; second = ''; }

    var n = nuits(item.d1, item.d2);
    var h = estDepart ? null : heure(r);
    var bas = [second, h, n ? n + ' nuit' + (n > 1 ? 's' : '') : null].filter(Boolean).join(' \u00b7 ');

    var g = document.createElement('div');
    g.style.cssText = 'min-width:0';
    g.innerHTML = '<div style="font-size:17px;font-weight:600;color:' + ENCRE
      + ';letter-spacing:-.02em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + titre + '</div>'
      + (bas ? '<div style="font-size:13px;color:' + GRIS + ';margin-top:2px">' + bas + '</div>' : '');
    haut.appendChild(g);

    var p = plateforme(r);
    if (p) {
      var b = document.createElement('div');
      b.textContent = p.nom;
      b.style.cssText = 'flex:none;font-size:10px;font-weight:700;letter-spacing:.07em;border-radius:7px'
        + ';padding:5px 8px;color:' + p.encre + ';background:' + p.fond;
      haut.appendChild(b);
    }
    el.appendChild(haut);
    return el;
  }

  function titreSection(texte, compte) {
    var t = document.createElement('div');
    t.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:.13em;color:#8B8B84;padding:8px 4px 9px';
    t.textContent = texte + (compte ? ' \u00b7 ' + compte : '');
    return t;
  }

  /* Sous « Votre journee » : les listes sont un detail, la synthese
     reste au-dessus. */
  function ancre() {
    var stats = document.querySelector('.bh2-stats');
    if (stats) {
      var carte = stats.closest('.card, [class*="card"], section') || stats.parentElement;
      var garde = 0;
      while (carte && carte.parentElement && carte.getBoundingClientRect().height < 120 && garde++ < 5) {
        carte = carte.parentElement;
      }
      if (carte && carte.parentElement) return { parent: carte.parentElement, avant: carte.nextSibling };
    }
    var bande = document.getElementById('bhBandeJours');
    if (bande && bande.parentElement) return { parent: bande.parentElement, avant: bande.nextSibling };
    return null;
  }

  function construire(tri) {
    if (document.getElementById('bhListesJour')) return true;
    var place = ancre();
    if (!place) { diag.erreur = 'point d\'insertion introuvable'; return false; }
    if (!tri.arr.length && !tri.dep.length) { diag.erreur = 'aucune arrivee ni depart aujourd\'hui'; return false; }

    var bloc = document.createElement('div');
    bloc.id = 'bhListesJour';
    bloc.style.cssText = 'font-family:inherit;margin-top:14px';

    if (tri.arr.length) {
      bloc.appendChild(titreSection('ARRIVÉES', tri.arr.length));
      tri.arr.forEach(function (it) {
        bloc.appendChild(ligne(it, false));
        diag.arrivees.push((it.r.guestName || '?') + ' — ' + (it.r.propertyName || '?'));
      });
    }
    if (tri.dep.length) {
      bloc.appendChild(titreSection('DÉPARTS', tri.dep.length));
      tri.dep.forEach(function (it) {
        bloc.appendChild(ligne(it, true));
        diag.departs.push((it.r.propertyName || '?') + ' — ' + (it.r.guestName || '?'));
      });
    }

    place.parent.insertBefore(bloc, place.avant);
    return true;
  }

  function charger() {
    if (document.getElementById('bhListesJour')) return;
    var t = jeton();
    if (!t) { diag.erreur = 'aucun jeton en memoire'; return; }

    fetch('/api/reservations', { headers: { Authorization: 'Bearer ' + t } })
      .then(function (r) { return r.json(); })
      .then(function (rep) {
        var lignes = Array.isArray(rep) ? rep
          : (rep && (rep.reservations || rep.data || rep.rows || rep.results)) || null;
        if (!Array.isArray(lignes)) { diag.erreur = 'forme de reponse non reconnue'; return; }
        construire(trier(lignes));
      })
      .catch(function (e) { diag.erreur = e.message; });
  }

  window.bhVerifListes = function () {
    var res = {
      bloc_affiche: !!document.getElementById('bhListesJour'),
      arrivees: diag.arrivees,
      departs: diag.departs,
      heure_disponible: !diag.champs_manquants.heure,
      erreur: diag.erreur,
      note: 'A TRAITER MAINTENANT absent : menage fait, infos envoyees et fiche police ne sont pas exposes au navigateur.'
    };
    console.log('── Listes du jour ──');
    console.log(res);
    if (diag.arrivees.length) console.table(diag.arrivees);
    if (!res.bloc_affiche) console.warn('Non affiche : ' + (diag.erreur || 'inconnu'));
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(charger, 1200); });
  } else {
    setTimeout(charger, 1200);
  }
  setTimeout(charger, 3000);
  setTimeout(charger, 5500);
})();

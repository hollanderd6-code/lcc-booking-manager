/* ============================================================
   bh-bande-jours.js — sept jours, sans defiler
   ============================================================
   Une bande inseree apres « Votre journee », alimentee par un seul
   appel en lecture a /api/reservations.

   Si la forme de la reponse n'est pas reconnue, la bande ne s'affiche
   pas. Mieux vaut rien qu'un calendrier qui mentirait.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhBandeJours) return;
  window.__bhBandeJours = true;

  var VERT = '#0E3B2E';
  var VERT_CLAIR = '#2E8B62';
  var AMBRE = '#C9A15B';
  var GRIS = '#7A8695';
  var BORD = '#E4E1D8';

  var JOURS = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  var diag = { recu: null, forme: '', lignes: 0, champs: null, jours: null, erreur: null };

  function jeton() {
    return localStorage.getItem('lcc_token') || localStorage.getItem('token') || '';
  }

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* Les noms de champs possibles, du plus probable au moins. */
  /* Votre API repond en camelCase : startDate / endDate, avec start / end
     en doublon. Le snake_case reste en repli pour les autres routes. */
  var DEBUTS = ['startDate', 'start', 'start_date', 'reservation_start_date', 'checkin', 'check_in', 'arrival_date', 'date_debut'];
  var FINS   = ['endDate', 'end', 'end_date', 'reservation_end_date', 'checkout', 'check_out', 'departure_date', 'date_fin'];

  function trouverChamp(ligne, noms) {
    for (var i = 0; i < noms.length; i++) {
      if (ligne[noms[i]]) return noms[i];
    }
    return null;
  }

  function versDate(v) {
    if (!v) return null;
    var s = String(v);
    /* On garde la date nue : un fuseau applique a « 2026-08-30 » peut
       reculer d'un jour et decaler toute la bande. */
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function lire(reponse) {
    var lignes = null;
    if (Array.isArray(reponse)) { lignes = reponse; diag.forme = 'tableau'; }
    else if (reponse && Array.isArray(reponse.reservations)) { lignes = reponse.reservations; diag.forme = '{ reservations }'; }
    else if (reponse && Array.isArray(reponse.data)) { lignes = reponse.data; diag.forme = '{ data }'; }
    else if (reponse && Array.isArray(reponse.rows)) { lignes = reponse.rows; diag.forme = '{ rows }'; }
    else if (reponse && Array.isArray(reponse.results)) { lignes = reponse.results; diag.forme = '{ results }'; }
    if (!lignes) { diag.forme = 'inconnue'; return null; }

    diag.lignes = lignes.length;
    if (!lignes.length) return { compte: {}, departs: {}, bloques: {}, noms: {} };

    var cDebut = null, cFin = null;
    for (var i = 0; i < lignes.length && !cDebut; i++) {
      cDebut = trouverChamp(lignes[i], DEBUTS);
      cFin = trouverChamp(lignes[i], FINS);
    }
    diag.champs = { debut: cDebut, fin: cFin, exemple: Object.keys(lignes[0] || {}).slice(0, 14) };
    if (!cDebut || !cFin) return null;

    var compte = {}, departs = {}, bloques = {}, noms = {};
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
    return { compte: compte, departs: departs, bloques: bloques, noms: noms };
  }

  /* ── L'endroit ou s'inserer ─────────────────────────────────── */
  function hote() {
    /* Apres la carte « Votre journee » : on la reconnait par son titre. */
    var titres = document.querySelectorAll('h1, h2, h3, .card-title, [class*="title"]');
    for (var i = 0; i < titres.length; i++) {
      var t = (titres[i].textContent || '').toLowerCase();
      if (t.indexOf('votre journ') !== -1) {
        var carte = titres[i].closest('.card, [class*="card"], section, .panel') || titres[i].parentElement;
        while (carte && carte.parentElement && carte.getBoundingClientRect().height < 120) carte = carte.parentElement;
        if (carte && carte.parentElement) return { parent: carte.parentElement, avant: carte.nextSibling };
      }
    }
    return null;
  }

  function construire(donnees) {
    if (document.getElementById('bhBandeJours')) return true;
    var place = hote();
    if (!place) { diag.erreur = 'carte « Votre journee » introuvable'; return false; }

    var aujourdhui = new Date();
    aujourdhui = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());

    var cadre = document.createElement('div');
    cadre.id = 'bhBandeJours';
    cadre.style.cssText = 'background:#fff;border:1px solid ' + BORD + ';border-radius:16px'
      + ';padding:13px 14px 12px;margin:0 0 14px;font-family:inherit';

    var entete = document.createElement('div');
    entete.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:11px;gap:10px';
    var fin = new Date(aujourdhui); fin.setDate(fin.getDate() + 6);
    var libMois = MOIS[aujourdhui.getMonth()].toUpperCase()
      + (fin.getMonth() !== aujourdhui.getMonth() ? ' · ' + MOIS[fin.getMonth()].toUpperCase() : '');
    entete.innerHTML = '<span style="font-size:11px;font-weight:700;letter-spacing:.13em;color:#8B8B84">' + libMois + '</span>';

    var lien = document.createElement('a');
    lien.href = '/reservations.html';
    lien.textContent = 'Voir le mois \u203A';
    lien.style.cssText = 'font-size:12.5px;font-weight:600;color:' + VERT + ';text-decoration:none;flex:none;padding:4px 0';
    entete.appendChild(lien);
    cadre.appendChild(entete);

    var grille = document.createElement('div');
    grille.style.cssText = 'display:grid;grid-template-columns:repeat(7,1fr);gap:5px';

    var jours = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(aujourdhui);
      d.setDate(d.getDate() + i);
      var k = ymd(d);
      var occupe = (donnees.compte[k] || 0) > 0;
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
      });

      var cell = document.createElement('div');
      var estAuj = i === 0;
      cell.style.cssText = 'text-align:center;padding:7px 0 8px;border-radius:11px'
        + ';background:' + (estAuj ? VERT : (depart && !occupe ? '#FBF6E9' : '#F4F2EC'));
      var infos = [(donnees.compte[k] || 0) + ' nuit(s) vendue(s)'];
      if (bloque) infos.push((donnees.bloques[k] || 0) + ' blocage(s) manuel(s)');
      if (depart) infos.push('depart : ' + ((donnees.noms[k] || []).join(', ') || (donnees.departs[k] + ' logement(s)')));
      cell.title = infos.join(' \u00b7 ');

      var jn = document.createElement('div');
      jn.textContent = JOURS[d.getDay()];
      jn.style.cssText = 'font-size:10px;font-weight:600;color:' + (estAuj ? '#A8CDBE' : (depart && !occupe ? '#8A5B14' : '#9A958A'));
      cell.appendChild(jn);

      var num = document.createElement('div');
      num.textContent = d.getDate();
      num.style.cssText = 'font-size:16px;font-weight:' + (estAuj ? '700' : '600')
        + ';margin-top:3px;color:' + (estAuj ? '#fff' : (depart && !occupe ? '#8A5B14' : '#0D1117'));
      cell.appendChild(num);

      var pts = document.createElement('div');
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
      grille.appendChild(cell);
    }
    diag.jours = jours;
    cadre.appendChild(grille);

    var legende = document.createElement('div');
    legende.style.cssText = 'display:flex;gap:14px;margin-top:11px;padding-top:10px;border-top:1px solid #EFEDE6;flex-wrap:wrap';
    legende.innerHTML =
      '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '">'
      + '<span style="width:5px;height:5px;border-radius:50%;background:' + VERT_CLAIR + '"></span>occupé</span>'
      + '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '">'
      + '<span style="width:5px;height:5px;border-radius:50%;background:' + AMBRE + '"></span>départ, ménage à prévoir</span>'
      + '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + GRIS + '">'
      + '<span style="width:5px;height:5px;border-radius:50%;border:1px solid #B9B4A8;box-sizing:border-box"></span>bloqué</span>';
    cadre.appendChild(legende);

    place.parent.insertBefore(cadre, place.avant);
    return true;
  }

  function charger() {
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
          console.warn('[bande] ' + diag.erreur + ' — la bande ne s\'affiche pas. Tapez bhVerifBande().');
          return;
        }
        construire(d);
      })
      .catch(function (e) {
        diag.erreur = e.message;
        console.warn('[bande] /api/reservations : ' + e.message);
      });
  }

  window.bhVerifBande = function () {
    var res = {
      bande_affichee: !!document.getElementById('bhBandeJours'),
      forme_reponse: diag.forme,
      lignes_recues: diag.lignes,
      champs_dates: diag.champs,
      sept_jours: diag.jours,
      erreur: diag.erreur
    };
    console.log('── Bande de sept jours ──');
    console.log(res);
    if (diag.jours) console.table(diag.jours);
    if (!res.bande_affichee) {
      console.warn('Non affichee. Raison : ' + (diag.erreur || 'inconnue'));
      if (diag.champs) console.warn('Champs vus sur la premiere ligne : ' + (diag.champs.exemple || []).join(', '));
    }
    return res;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(charger, 900); });
  } else {
    setTimeout(charger, 900);
  }
  setTimeout(charger, 2600);
})();

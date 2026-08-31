/* ============================================================
   bh-kpi-haut.js — trois compteurs au-dessus de la bande
   ============================================================
   Les tuiles sont DEPLACEES depuis « Votre journee », pas recopiees :
   le code qui ecrit leurs chiffres continue de le faire, sans savoir
   qu'elles ont change de place.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhKpiHaut) return;
  window.__bhKpiHaut = true;

  var mem = [];
  var diag = { deplacees: [], raison: '', restantes: 0 };

  /* Les trois tuiles cherchees, par leur libelle. */
  var CHERCHEES = [
    { cle: 'arrivees', mots: ['arrivée', 'arrivee', 'arrivées'] },
    { cle: 'departs',  mots: ['départ', 'depart', 'check-out', 'checkout'] },
    { cle: 'menages',  mots: ['ménage', 'menage', 'nettoy'] }
  ];

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  function carteJournee() {
    var titres = document.querySelectorAll('h1, h2, h3, h4, .card-title, [class*="title"]');
    for (var i = 0; i < titres.length; i++) {
      var t = (titres[i].textContent || '').toLowerCase();
      if (t.indexOf('votre journ') === -1) continue;
      var carte = titres[i].closest('.card, [class*="card"], section, .panel') || titres[i].parentElement;
      var garde = 0;
      while (carte && carte.parentElement && carte.getBoundingClientRect().height < 120 && garde++ < 6) {
        carte = carte.parentElement;
      }
      return carte;
    }
    return null;
  }

  /* Une tuile : le plus petit bloc qui contient a la fois le libelle et
     un nombre. On remonte depuis le libelle jusqu'a trouver le nombre. */
  function tuileDepuisLibelle(el, racine) {
    var n = el;
    var garde = 0;
    while (n && n !== racine && garde++ < 6) {
      var txt = (n.textContent || '');
      if (/\d/.test(txt) && n.getBoundingClientRect().height > 40) return n;
      n = n.parentElement;
    }
    return null;
  }

  function trouverTuiles(carte) {
    var out = [];
    var pris = [];
    var feuilles = carte.querySelectorAll('div, span, p, small, label, h4, h5');

    CHERCHEES.forEach(function (c) {
      for (var i = 0; i < feuilles.length; i++) {
        var f = feuilles[i];
        if (f.children.length) continue;
        var t = (f.textContent || '').trim().toLowerCase();
        if (!t || t.length > 24) continue;
        var ok = false;
        for (var k = 0; k < c.mots.length; k++) if (t.indexOf(c.mots[k]) !== -1) { ok = true; break; }
        if (!ok) continue;
        var tuile = tuileDepuisLibelle(f, carte);
        if (!tuile) continue;
        /* Pas deux fois la meme, ni une tuile imbriquee dans une autre. */
        var conflit = false;
        for (var j = 0; j < pris.length; j++) {
          if (pris[j] === tuile || pris[j].contains(tuile) || tuile.contains(pris[j])) { conflit = true; break; }
        }
        if (conflit) continue;
        pris.push(tuile);
        out.push({ cle: c.cle, el: tuile, libelle: t });
        break;
      }
    });
    return out;
  }

  function compacter(tuile) {
    memoriser(tuile, 'padding', '11px 12px');
    memoriser(tuile, 'margin', '0');
    memoriser(tuile, 'min-height', '0');
    memoriser(tuile, 'height', 'auto');

    var feuilles = tuile.querySelectorAll('div, span, p, small, label, h3, h4, h5');
    for (var i = 0; i < feuilles.length; i++) {
      var f = feuilles[i];
      if (f.children.length) continue;
      var t = (f.textContent || '').trim();
      if (!t) continue;
      if (/^[\d\s.,%€]+$/.test(t)) {
        memoriser(f, 'font-size', '26px');
        memoriser(f, 'line-height', '1');
        memoriser(f, 'margin', '0');
      } else {
        memoriser(f, 'font-size', '12px');
        memoriser(f, 'margin', '5px 0 0');
        memoriser(f, 'line-height', '1.25');
      }
    }
    /* Les icones decoratives prennent la place du chiffre. */
    var icones = tuile.querySelectorAll('svg, i, img, [class*="icon"]');
    for (var j = 0; j < icones.length; j++) {
      if ((icones[j].textContent || '').trim()) continue;
      memoriser(icones[j], 'display', 'none');
    }
  }

  function deplacer() {
    if (document.getElementById('bhKpiHaut')) return true;

    var entete = document.getElementById('bhEnteteJour');
    var bande = document.getElementById('bhBandeJours');
    var carte = carteJournee();
    if (!entete || !carte) { diag.raison = 'en-tete ou carte introuvable'; return false; }

    var tuiles = trouverTuiles(carte);
    if (tuiles.length < 2) { diag.raison = 'seulement ' + tuiles.length + ' tuile(s) reconnue(s)'; return false; }

    /* Si la carte n'a que ces tuiles, la vider la laisserait fantome. */
    var nombresAvant = (carte.textContent.match(/\d+/g) || []).length;
    var nombresDansTuiles = 0;
    tuiles.forEach(function (t) { nombresDansTuiles += (t.el.textContent.match(/\d+/g) || []).length; });
    if (nombresAvant - nombresDansTuiles < 2) {
      diag.raison = 'la carte « Votre journee » serait vide — deplacement annule';
      return false;
    }
    diag.restantes = nombresAvant - nombresDansTuiles;

    var rangee = document.createElement('div');
    rangee.id = 'bhKpiHaut';
    rangee.style.cssText = 'display:grid;grid-template-columns:repeat(' + tuiles.length + ',1fr)'
      + ';gap:8px;margin:0 0 14px;font-family:inherit';

    tuiles.forEach(function (t) {
      mem.push({ type: 'place', el: t.el, parent: t.el.parentElement, avant: t.el.nextSibling });
      compacter(t.el);
      rangee.appendChild(t.el);
      diag.deplacees.push(t.cle + ' (' + t.libelle + ')');
    });

    /* Au-dessus de la bande, sous l'en-tete. */
    var ancre = bande || carte;
    ancre.parentElement.insertBefore(rangee, ancre);
    return true;
  }

  window.bhAnnulerKpi = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }
    }
    var r = document.getElementById('bhKpiHaut');
    if (r) r.remove();
    var n = mem.length;
    mem = [];
    console.log(n + ' changement(s) annule(s). Les tuiles sont revenues dans « Votre journee ».');
    return n;
  };

  window.bhVerifKpi = function () {
    var rangee = document.getElementById('bhKpiHaut');
    var res = {
      rangee_posee: !!rangee,
      tuiles_deplacees: diag.deplacees,
      nombres_restants_dans_la_carte: diag.restantes,
      au_dessus_de_la_bande: !!(rangee && document.getElementById('bhBandeJours')
        && rangee.compareDocumentPosition(document.getElementById('bhBandeJours')) & Node.DOCUMENT_POSITION_FOLLOWING),
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── KPI en haut ──');
    console.log(res);
    if (!res.rangee_posee) console.warn('Non deplacees : ' + (diag.raison || 'inconnu'));
    console.log('Pour revenir en arriere : bhAnnulerKpi()');
    return res;
  };

  function demarrer() { deplacer(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 1800); });
  } else {
    setTimeout(demarrer, 1800);
  }
  setTimeout(demarrer, 3200);
  setTimeout(demarrer, 5200);
})();

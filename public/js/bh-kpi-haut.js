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

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  /* ── Le deplacement ───────────────────────────────────────────
     Les trois tuiles sont deja reunies dans div.bh2-ops, et rien
     d'autre ne s'y trouve. Un seul noeud a deplacer : aucune detection,
     donc aucun pari. */
  function deplacer() {
    if (document.getElementById('bhKpiHaut')) return true;

    var ops = document.querySelector('.bh2-ops');
    var entete = document.getElementById('bhEnteteJour');
    var bande = document.getElementById('bhBandeJours');
    if (!ops) { diag.raison = 'div.bh2-ops introuvable'; return false; }
    if (!entete) { diag.raison = 'en-tete introuvable'; return false; }

    var tuiles = ops.querySelectorAll('.bh2-op');
    if (!tuiles.length) { diag.raison = 'aucune .bh2-op dans .bh2-ops'; return false; }

    /* « Votre journee » doit rester habitee : ses quatre mesures de fond
       vivent dans section.bh2-stats, hors de .bh2-ops. */
    var stats = document.querySelector('.bh2-stats');
    if (!stats || !stats.querySelectorAll('.bh2-stat').length) {
      diag.raison = 'section.bh2-stats absente — la carte serait vide, deplacement annule';
      return false;
    }
    diag.restantes = stats.querySelectorAll('.bh2-stat').length;

    /* On memorise la place exacte avant de bouger. */
    mem.push({ type: 'place', el: ops, parent: ops.parentElement, avant: ops.nextSibling });

    /* Trois colonnes egales. #kpiTodayMovesCard groupe deux tuiles sur
       trois : display:contents les rend freres dans la grille, sinon
       deux se serreraient dans une colonne. */
    memoriser(ops, 'display', 'grid');
    memoriser(ops, 'grid-template-columns', 'repeat(' + tuiles.length + ', 1fr)');
    memoriser(ops, 'gap', '8px');
    memoriser(ops, 'margin', '0 0 14px');
    memoriser(ops, 'padding', '0');

    var groupe = document.getElementById('kpiTodayMovesCard');
    if (groupe && groupe.querySelectorAll('.bh2-op').length) {
      memoriser(groupe, 'display', 'contents');
    }

    /* Compacite : le libelle et le chiffre suffisent a trois de front. */
    for (var i = 0; i < tuiles.length; i++) {
      var t = tuiles[i];
      memoriser(t, 'padding', '11px 12px');
      memoriser(t, 'margin', '0');
      memoriser(t, 'min-height', '0');
      memoriser(t, 'height', 'auto');
      diag.deplacees.push((t.querySelector('.bh2-op-lbl') || {}).textContent || '?');
    }
    ['.bh2-op-sub', '.bh2-op-ic'].forEach(function (sel) {
      var els = ops.querySelectorAll(sel);
      for (var j = 0; j < els.length; j++) memoriser(els[j], 'display', 'none');
    });
    var nums = ops.querySelectorAll('.bh2-op-num');
    for (var k = 0; k < nums.length; k++) {
      memoriser(nums[k], 'font-size', '26px');
      memoriser(nums[k], 'line-height', '1');
      memoriser(nums[k], 'margin', '4px 0 0');
    }

    ops.id = ops.id || '';
    ops.setAttribute('data-bh-kpi-haut', '1');

    /* Un repere stable pour le diagnostic, sans changer l'id d'origine. */
    var marque = document.createElement('div');
    marque.id = 'bhKpiHaut';
    marque.style.cssText = 'display:none';
    ops.appendChild(marque);
    mem.push({ type: 'place', el: marque, parent: null, avant: null });

    /* Au-dessus de la bande, sous l'en-tete. */
    var ancre = bande || entete.nextSibling;
    if (bande) bande.parentElement.insertBefore(ops, bande);
    else entete.parentElement.insertBefore(ops, entete.nextSibling);
    return true;
  }

  window.bhAnnulerKpi = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
      } else if (m.type === 'place') {
        if (m.parent) m.parent.insertBefore(m.el, m.avant);
        else if (m.el && m.el.parentElement) m.el.remove();
      }
    }
    var ops = document.querySelector('[data-bh-kpi-haut]');
    if (ops) ops.removeAttribute('data-bh-kpi-haut');
    var n = mem.length;
    mem = [];
    console.log(n + ' changement(s) annule(s). Les tuiles sont revenues dans « Votre journee ».');
    return n;
  };

  window.bhVerifKpi = function () {
    var rangee = document.querySelector('[data-bh-kpi-haut]');
    var res = {
      deplacement_fait: !!document.querySelector('[data-bh-kpi-haut]'),
      tuiles_deplacees: diag.deplacees,
      nombres_restants_dans_la_carte: diag.restantes,
      au_dessus_de_la_bande: !!(rangee && document.getElementById('bhBandeJours')
        && rangee.compareDocumentPosition(document.getElementById('bhBandeJours')) & Node.DOCUMENT_POSITION_FOLLOWING),
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── KPI en haut ──');
    console.log(res);
    if (!res.deplacement_fait) console.warn('Non deplacees : ' + (diag.raison || 'inconnu'));
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

/* ============================================================
   bh-carte-journee.js — la carte part, ses chiffres restent
   ============================================================
   « Votre journee » ne contenait plus que deux mesures vivantes et deux
   zeros. Les deux mesures remontent sous le titre ; la carte est masquee.

   Les valeurs sont DEPLACEES, pas recopiees : le code qui les met a jour
   continue de le faire.
   ============================================================ */
(function () {
  'use strict';

  if (window.__bhCarteJournee) return;
  window.__bhCarteJournee = true;

  var GRIS = '#8B8B84';
  var mem = [];
  var diag = { carte_masquee: false, chiffres_remontes: [], raison: '' };

  function memoriser(el, prop, valeur) {
    mem.push({ type: 'style', el: el, prop: prop, valeur: el.style.getPropertyValue(prop), priorite: el.style.getPropertyPriority(prop) });
    el.style.setProperty(prop, valeur, 'important');
  }

  function carte() {
    var stats = document.querySelector('.bh2-stats');
    if (!stats) return null;
    var c = stats.closest('.card, [class*="card"], section') || stats.parentElement;
    var garde = 0;
    while (c && c.parentElement && c.getBoundingClientRect().height < 120 && garde++ < 5) c = c.parentElement;
    return c;
  }

  function remonter() {
    if (document.getElementById('bhChiffresFond')) return true;

    var entete = document.getElementById('bhEnteteJour');
    var c = carte();
    if (!entete || !c) { diag.raison = 'en-tete ou carte introuvable'; return false; }

    /* Le cote gauche de l'en-tete porte la date et le titre. */
    var gauche = entete.firstElementChild;
    if (!gauche) { diag.raison = 'cote gauche de l\'en-tete introuvable'; return false; }

    var ligne = document.createElement('div');
    ligne.id = 'bhChiffresFond';
    ligne.style.cssText = 'display:flex;align-items:baseline;gap:6px;margin-top:6px'
      + ';font-size:13px;color:' + GRIS + ';flex-wrap:wrap';

    var paires = [
      { val: 'kpiPropertiesValue', mot: 'logements' },
      { val: 'kpiDepositsValue', mot: 'cautions' }
    ];
    var poses = 0;

    paires.forEach(function (p, i) {
      var v = document.getElementById(p.val);
      if (!v) return;
      if (i && poses) {
        var sep = document.createElement('span');
        sep.textContent = '\u00b7';
        sep.style.cssText = 'color:#C4C0B6';
        ligne.appendChild(sep);
      }
      mem.push({ type: 'place', el: v, parent: v.parentElement, avant: v.nextSibling });
      memoriser(v, 'font-size', '13px');
      memoriser(v, 'font-weight', '600');
      memoriser(v, 'color', '#3D4A44');
      memoriser(v, 'margin', '0');
      memoriser(v, 'display', 'inline');
      ligne.appendChild(v);

      var mot = document.createElement('span');
      mot.textContent = p.mot;
      ligne.appendChild(mot);
      poses++;
      diag.chiffres_remontes.push(p.mot);
    });

    if (!poses) { diag.raison = 'aucun chiffre vivant trouve — carte laissee en place'; return false; }

    gauche.appendChild(ligne);

    /* La carte peut partir : ce qu'elle portait d'utile est remonte. */
    memoriser(c, 'display', 'none');
    diag.carte_masquee = true;
    return true;
  }

  window.bhAnnulerCarte = function () {
    for (var i = mem.length - 1; i >= 0; i--) {
      var m = mem[i];
      if (m.type === 'style') {
        if (m.valeur) m.el.style.setProperty(m.prop, m.valeur, m.priorite);
        else m.el.style.removeProperty(m.prop);
      } else if (m.type === 'place' && m.parent) {
        m.parent.insertBefore(m.el, m.avant);
      }
    }
    var l = document.getElementById('bhChiffresFond');
    if (l) l.remove();
    var n = mem.length;
    mem = [];
    console.log(n + ' changement(s) annule(s). La carte « Votre journee » est revenue.');
    return n;
  };

  window.bhVerifCarte = function () {
    var res = {
      carte_masquee: diag.carte_masquee,
      chiffres_remontes: diag.chiffres_remontes,
      ligne_posee: !!document.getElementById('bhChiffresFond'),
      valeurs_lues: {
        logements: (document.getElementById('kpiPropertiesValue') || {}).textContent,
        cautions: (document.getElementById('kpiDepositsValue') || {}).textContent
      },
      annulable: mem.length + ' changement(s) memorise(s)',
      raison: diag.raison
    };
    console.log('── Carte « Votre journee » ──');
    console.log(res);
    if (!res.carte_masquee) console.warn('Non masquee : ' + (diag.raison || 'inconnu'));
    console.log('Pour revenir en arriere : bhAnnulerCarte()');
    return res;
  };

  function demarrer() { remonter(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(demarrer, 2200); });
  } else {
    setTimeout(demarrer, 2200);
  }
  setTimeout(demarrer, 4200);
  setTimeout(demarrer, 6800);
})();

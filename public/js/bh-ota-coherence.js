/* ============================================================================
   BH-OTA-COHERENCE — la vérification au bon moment, sans y penser
   ============================================================================
   INSTALLATION — dans public/settings.html, après bh-ota-connect.js :

     <script src="/js/bh-ota-coherence.js"></script>

   Le serveur sait réparer les mappings ; encore faut-il l'appeler quand
   quelque chose a pu bouger. Le moment sûr est la FERMETURE de la fenêtre de
   connexion : à cet instant, le rattachement a eu lieu, ou le mapping a été
   fait dans la fenêtre du partenaire, ou les deux.

   Plutôt que de s'accrocher aux boutons de cette fenêtre — qui changent — on
   observe la disparition de la modale elle-même. Ça reste vrai quelle que
   soit la façon dont elle est fermée : bouton, clic à côté, touche Échap.

   Ce que l'utilisateur voit : rien, si tout est cohérent. Un message précis
   sinon — soit « corrigé », soit ce qu'il doit faire lui-même, car un mapping
   absent ne s'invente pas.
   ========================================================================== */
(function () {
  'use strict';

  var pidOuvert = null;
  var enCours = false;

  function token() { try { return localStorage.getItem('lcc_token'); } catch (e) { return null; } }
  function toast(m, t) { if (typeof showToast === 'function') showToast(m, t || 'info'); }

  async function verifier(pid) {
    if (!pid || enCours) return;
    enCours = true;
    try {
      var r = await fetch(API_URL + '/api/properties/' + pid + '/coherence/repair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }
      });
      if (!r.ok) return;   // route pas installée : silence, pas d'alarme inutile
      var d = await r.json();

      var reparations = d.reparations || [];
      if (reparations.length) {
        // On nomme la plateforme : « corrigé » tout court n'apprend rien.
        var noms = { ABB: 'Airbnb', BDC: 'Booking.com', EXP: 'Expedia', VRB: 'Abritel' };
        var quoi = reparations.map(function (x) { return noms[x.code] || x.code; }).join(', ');
        toast(quoi + ' : le tarif envoyé pointait vers un ancien plan, c\'est corrigé.', 'success');
      }

      (d.action_utilisateur || []).slice(0, 2).forEach(function (msg) { toast(msg, 'warning'); });

      if (typeof loadProperties === 'function') loadProperties().catch(function () {});
    } catch (e) {
      // Une vérification qui échoue ne doit rien casser ni rien annoncer.
    } finally {
      enCours = false;
    }
  }

  function brancher() {
    if (typeof window.openChannexModal === 'function' && !window.openChannexModal.__bhCoh) {
      var origine = window.openChannexModal;
      var enveloppe = function (propertyId) {
        pidOuvert = propertyId || null;
        return origine.apply(this, arguments);
      };
      enveloppe.__bhCoh = true;
      window.openChannexModal = enveloppe;
    }

    if (!document.body.dataset.bhCoh) {
      document.body.dataset.bhCoh = '1';
      // La modale de connexion a disparu : c'est le moment de vérifier.
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var partis = mutations[i].removedNodes;
          for (var j = 0; j < partis.length; j++) {
            var n = partis[j];
            if (n && n.id === 'channexModal' && pidOuvert) {
              var pid = pidOuvert;
              pidOuvert = null;
              // Un instant de délai : Channex enregistre le mapping juste
              // après la fermeture de son iframe.
              setTimeout(function () { verifier(pid); }, 1500);
              return;
            }
          }
        }
      }).observe(document.body, { childList: true });
    }
  }

  function attendre(n) {
    brancher();
    if (!(window.openChannexModal && window.openChannexModal.__bhCoh) && n > 0) {
      setTimeout(function () { attendre(n - 1); }, 300);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { attendre(20); });
  } else {
    attendre(20);
  }
})();

/**
 * bh-v3-finitions.js
 * ============================================================================
 * Les finitions du theme v3 qui n'ont jamais ete branchees.
 *
 * ── D'OU CELA VIENT ────────────────────────────────────────────────────────
 * js/bh-theme-v3-nav.js contenait ces fonctions, mais il n'etait charge par
 * AUCUNE page. En le lisant, la raison apparait : ce fichier injecte aussi une
 * barre noire de demonstration (« Vue » + Dashboard / Messages / Logements…,
 * liens en ?v3=1, masquee sur ecran tactile) et un bouton de bascule de theme.
 * C'etait l'outil de revue de la refonte, pas du code de production. Le
 * charger tel quel ferait apparaitre cette barre aux clients.
 *
 * Ce fichier ne garde que les trois finitions qui sont de vraies
 * fonctionnalites, et dont le CSS est DEJA livre :
 *
 *   1. la legende du calendrier — bh-theme-v3.css style .bh-cal-legend et
 *      .bh-cal-legend-dot.airbnb / .booking / .direct depuis des mois, sans
 *      que rien ne cree ces elements ;
 *   2. les titres de page avec un mot en italique serif (« Tableau de bord ») ;
 *   3. le bouton « + Nouvelle réservation » du tableau de bord, dont le style
 *      #newReservationBtn existe aussi deja.
 *
 * Ce qui a ete ECARTE volontairement : la barre de demonstration, et le bouton
 * de bascule clair/sombre — le mode sombre n'est couvert qu'a 12 %, le bouton
 * reste masque jusque-la (voir bh-tokens.css).
 *
 * ── A CHARGER ──────────────────────────────────────────────────────────────
 *   <script src="/js/bh-v3-finitions.js"></script>
 * apres bh-layout.js, sur les pages du theme v3.
 * ============================================================================
 */
(function () {
  'use strict';

  // Le theme v3 doit etre actif, sinon ces finitions n'auraient pas de style.
  if (document.documentElement.getAttribute('data-theme-v3') !== '1') return;

  var page = function () { return document.body.getAttribute('data-page') || ''; };

  /* ── 1. Titre de page : un mot en italique serif ────────────────────────
     bh-theme-v3.css style deja .page-title em. Sans ce code, tous les titres
     restaient d'un seul poids. */
  var TITRES = {
    app:      'Tableau de <em>bord</em>',
    messages: 'Mes <em>messages</em>',
    settings: 'Mes <em>logements</em>',
    deposits: 'Gestion des <em>cautions</em>',
    factures: 'Factures <em>clients</em>',
    welcome:  "Livret d'<em>accueil</em>",
    cleaning: 'Gestion du <em>ménage</em>'
  };

  function titre() {
    var el = document.querySelector('.main-header h1.page-title, .main-header .page-title');
    if (!el) return;
    var t = TITRES[page()];
    // On ne recrit pas un titre deja mis en forme, ni un titre pose par la page
    // via data-title si l'utilisateur l'a personnalise.
    if (t && !el.querySelector('em')) el.innerHTML = t;
  }

  /* ── 2. Calendrier : legende et sous-titre ──────────────────────────────
     Le calendrier se rend en plusieurs temps selon la latence reseau : on
     retente, et chaque etape est idempotente (elle verifie avant d'ajouter). */
  function calendrier() {
    var titreCal = document.querySelector('.calendar-title-modern span');
    if (titreCal && titreCal.textContent.trim() === 'Calendrier') {
      titreCal.innerHTML = 'Calendrier des <em>réservations</em>';
    }

    var haut = document.querySelector('.calendar-header-top');
    if (haut && !document.getElementById('bhCalSubtitle')) {
      var h = haut.querySelector('.calendar-title-modern');
      if (h) {
        var sub = document.createElement('p');
        sub.id = 'bhCalSubtitle';
        sub.className = 'bh-cal-subtitle';
        sub.textContent = sousTitre('month');
        h.insertAdjacentElement('afterend', sub);
      }
    }

    var selecteur = document.querySelector('.view-selector');
    if (selecteur && !selecteur.querySelector('.bh-cal-legend')) {
      var lg = document.createElement('div');
      lg.className = 'bh-cal-legend';
      lg.innerHTML =
        '<span class="bh-cal-legend-item"><span class="bh-cal-legend-dot airbnb"></span>Airbnb</span>' +
        '<span class="bh-cal-legend-item"><span class="bh-cal-legend-dot booking"></span>Booking</span>' +
        '<span class="bh-cal-legend-item"><span class="bh-cal-legend-dot direct"></span>Direct</span>';
      selecteur.appendChild(lg);
    }

    // Le sous-titre suit la vue choisie. Delegation sur le document : les
    // onglets peuvent etre recrees par le calendrier sans perdre l'ecoute.
    if (!document.body.hasAttribute('data-bh-cal-lie')) {
      document.body.setAttribute('data-bh-cal-lie', '1');
      document.addEventListener('click', function (e) {
        var tab = e.target.closest && e.target.closest('.view-tab');
        if (!tab) return;
        var sub = document.getElementById('bhCalSubtitle');
        if (sub) sub.textContent = sousTitre(tab.getAttribute('data-view'));
      });
    }
  }

  var VUES = { day: 'Vue journalière', week: 'Vue hebdomadaire', month: 'Vue mensuelle', year: 'Vue annuelle' };
  function sousTitre(vue) {
    var n = document.querySelectorAll('.property-item').length;
    return (n > 0 ? n + (n > 1 ? ' logements · ' : ' logement · ') : '') + (VUES[vue] || VUES.month);
  }

  /* ── 3. Bouton « + Nouvelle réservation », tableau de bord seulement ──── */
  function boutonReservation() {
    if (page() !== 'app') return;
    if (document.getElementById('newReservationBtn')) return;
    var actions = document.querySelector('.main-header .header-actions');
    if (!actions) return;

    var b = document.createElement('button');
    b.id = 'newReservationBtn';
    b.type = 'button';
    b.innerHTML = '<i class="fas fa-plus" aria-hidden="true"></i> Nouvelle réservation';
    b.addEventListener('click', function () {
      var modal = document.getElementById('newReservationModal');
      if (modal) modal.style.display = 'flex';
    });
    actions.appendChild(b);
  }

  /* ── Init ───────────────────────────────────────────────────────────────
     L'en-tete et le calendrier sont poses par bh-layout.js et par le moteur de
     calendrier, a des moments qui dependent du reseau. Plutot que d'empiler
     des setTimeout au hasard, on observe le DOM et on s'arrete des que tout
     est en place. */
  function passe() {
    titre();
    boutonReservation();
    calendrier();
  }

  function demarrer() {
    passe();
    document.addEventListener('sidebarReady', passe);

    var fini = false;
    var obs = new MutationObserver(function () {
      if (fini) return;
      passe();
      var ok = document.querySelector('.bh-cal-legend')
        && document.getElementById('bhCalSubtitle')
        && (page() !== 'app' || document.getElementById('newReservationBtn'));
      if (ok) { fini = true; obs.disconnect(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Garde-fou : sur une page sans calendrier, l'observateur n'aurait jamais
    // sa condition de sortie. On le coupe au bout de 10 s.
    setTimeout(function () { if (!fini) { fini = true; obs.disconnect(); } }, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
})();

/* ============================================
   BADGE MESSAGES — compteur de non-lus
   ============================================
   ── DEUX DEFAUTS CORRIGES ──────────────────────────────────────────────

   1. LE BADGE NE SE RAFRAICHISSAIT PAS A LA LECTURE.
      L'ancienne version ne rechargeait le compteur que dans trois cas :
      au demarrage, toutes les 30 secondes, et sur « sidebarReady ».
      Lire un message ne prevenait personne : le badge gardait sa valeur
      jusqu'au prochain cycle, soit 30 secondes d'affichage faux.
      D'ou le reflexe de recliquer sur « Messages » pour forcer un
      rechargement de page.

      Le marquage comme lu part de TROIS endroits (messages.html,
      chat-owner.js, chat-mobile.html). Plutot que de les modifier un par
      un — et d'oublier le quatrieme le jour ou il arrivera — on observe
      les requetes : des qu'une requete de marquage aboutit, le compteur
      se recharge. Un seul endroit a maintenir.

   2. UN BADGE ROUGE AFFICHANT « 0 ».
      L'en-tete disait « AFFICHAGE PERMANENT » et le code ecrivait la
      valeur telle quelle : sans message non lu, une pastille rouge
      affichait 0. Une pastille rouge signifie « quelque chose demande
      votre attention » ; a zero, elle ne doit pas etre la.

   Les cinq setTimeout en cascade (0, 500, 1000, 2000, 3000 ms) sont
   remplaces par l'ecoute de sidebarReady, seule condition reelle.
   ============================================ */

(function() {
  'use strict';

  const IS_NATIVE = window.Capacitor?.isNativePlatform() || false;
  const API_URL = IS_NATIVE ? 'https://lcc-booking-manager.onrender.com' : window.location.origin;

  let dernierCompte = null;

  async function loadUnreadCount() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) return;

      const response = await fetch(`${API_URL}/api/chat/conversations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return;

      const data = await response.json();

      let totalUnread = 0;
      if (data.conversations && Array.isArray(data.conversations)) {
        data.conversations.forEach((conv) => {
          totalUnread += parseInt(conv.unread_count) || 0;
        });
      }

      dernierCompte = totalUnread;
      updateAllBadges(totalUnread);
    } catch (error) {
      console.error('[BADGE] Erreur:', error);
    }
  }

  function updateAllBadges(count) {
    const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
    if (desktopNav) updateSingleBadge(desktopNav, count, 'desktop');

    const mobileTab = document.querySelector('.tab-btn[data-tab="messages"]');
    if (mobileTab) updateSingleBadge(mobileTab, count, 'mobile');
  }

  function updateSingleBadge(element, count, type) {
    let badge = element.querySelector('.badge-count');

    // A zero, la pastille disparait : une pastille rouge annonce quelque
    // chose a traiter, elle n'a pas de sens vide.
    if (!count) { if (badge) badge.remove(); return; }

    element.style.position = 'relative';

    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge-count';
      badge.setAttribute('aria-hidden', 'true');
      element.appendChild(badge);
    }

    if (type === 'desktop') {
      badge.style.cssText = `
        position: absolute !important;
        top: 50% !important;
        right: 10px !important;
        transform: translateY(-50%) !important;
        min-width: 20px !important;
        height: 20px !important;
        padding: 0 6px !important;
        background: #EF4444 !important;
        color: white !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        border-radius: 10px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 100 !important;
      `;
    } else {
      badge.style.cssText = `
        position: absolute !important;
        top: 4px !important;
        right: 30% !important;
        transform: translateX(18px) !important;
        min-width: 18px !important;
        height: 18px !important;
        padding: 0 5px !important;
        background: #EF4444 !important;
        color: white !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        border-radius: 9px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 100 !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
      `;
    }

    badge.textContent = count > 99 ? '99+' : count;

    // Le nombre est aussi porte par le libelle du lien, pour les lecteurs
    // d'ecran : une pastille visuelle seule ne leur dit rien.
    const base = (element.getAttribute('data-aria-base') || element.getAttribute('aria-label') || 'Messages').replace(/\s*\(\d+.*\)$/, '');
    element.setAttribute('data-aria-base', base);
    element.setAttribute('aria-label', base + ' (' + count + ' non lu' + (count > 1 ? 's' : '') + ')');
  }

  /* ── Rafraichissement a la lecture ──────────────────────────────────
     On enveloppe fetch pour reperer les requetes de marquage comme lu,
     d'ou qu'elles viennent. La requete d'origine n'est ni modifiee ni
     retardee : on se contente de recharger le compteur apres sa reussite. */
  const RE_LU = /\/api\/chat\/(mark-read|conversations\/[^/]+\/(read|mark-read))/;

  function surveiller() {
    const fetchOrigine = window.fetch;
    if (fetchOrigine.__badgeSurveille) return;

    const enveloppe = function(entree, options) {
      const url = typeof entree === 'string' ? entree : (entree && entree.url) || '';
      const p = fetchOrigine.apply(this, arguments);
      if (RE_LU.test(url)) {
        p.then(function(r) {
          // Un echec ne doit pas faire disparaitre un badge encore valable.
          if (r && r.ok) loadUnreadCount();
        }).catch(function() {});
      }
      return p;
    };
    enveloppe.__badgeSurveille = true;
    window.fetch = enveloppe;
  }

  function init() {
    // auth-fetch.js enveloppe deja window.fetch : on se place APRES lui,
    // sinon notre enveloppe serait remplacee au chargement.
    surveiller();

    loadUnreadCount();
    setInterval(loadUnreadCount, 30000);

    document.addEventListener('sidebarReady', function() {
      // La barre laterale vient d'etre reconstruite : les pastilles ont
      // disparu avec elle, on les repose sans nouvelle requete.
      if (dernierCompte !== null) updateAllBadges(dernierCompte);
      loadUnreadCount();
    });

    // Retour sur l'onglet ou sortie de veille : le compteur peut avoir
    // vieilli pendant l'absence.
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) loadUnreadCount();
    });

    // Point d'appel explicite pour le code qui sait qu'il vient de faire
    // lire des messages, sans attendre l'interception reseau.
    document.addEventListener('messagesRead', loadUnreadCount);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.refreshMessagesBadge = loadUnreadCount;
  window.updateMessagesBadge = updateAllBadges;
})();

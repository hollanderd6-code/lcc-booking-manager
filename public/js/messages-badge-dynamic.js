// messages-badge-dynamic-ALWAYS-VISIBLE.js
// Badge rouge TOUJOURS visible, même à 0

(function() {
  console.log('[Badge Messages] Initialisation - TOUJOURS VISIBLE');

  // Fonction pour créer ou mettre à jour le badge
  function updateBadge(count) {
    // Desktop sidebar
    const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
    if (desktopNav) {
      let badge = desktopNav.querySelector('.badge-count');
      
      // Si le badge n'existe pas, le créer
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge-count';
        desktopNav.appendChild(badge);
        console.log('[Badge Messages] Badge desktop créé');
      }
      
      // TOUJOURS afficher, même si count = 0
      badge.textContent = count;
      badge.style.display = 'flex'; // Toujours visible
      console.log('[Badge Messages] Desktop mis à jour:', count);
    }

    // Mobile bottom bar
    const mobileTab = document.querySelector('.mobile-tab[data-tab="messages"]');
    if (mobileTab) {
      let badge = mobileTab.querySelector('.badge-count');
      
      // Si le badge n'existe pas, le créer
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge-count';
        mobileTab.appendChild(badge);
        console.log('[Badge Messages] Badge mobile créé');
      }
      
      // TOUJOURS afficher, même si count = 0
      badge.textContent = count;
      badge.style.display = 'flex'; // Toujours visible
      console.log('[Badge Messages] Mobile mis à jour:', count);
    }
  }

  // Récupérer le compte depuis le serveur
  async function fetchUnreadCount() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) {
        console.log('[Badge Messages] Pas de token, affichage de 0');
        updateBadge(0);
        return;
      }

      const API_URL = window.location.origin;
      const response = await fetch(`${API_URL}/api/chat/unread-count`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.warn('[Badge Messages] Erreur API, affichage de 0');
        updateBadge(0);
        return;
      }

      const data = await response.json();
      const count = data.unreadCount || 0;
      
      console.log('[Badge Messages] Count récupéré:', count);
      updateBadge(count);

    } catch (error) {
      console.error('[Badge Messages] Erreur fetch:', error);
      updateBadge(0); // Afficher 0 en cas d'erreur
    }
  }

  // Initialiser au chargement
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[Badge Messages] DOM chargé');
      // Afficher 0 immédiatement, puis récupérer le vrai count
      updateBadge(0);
      fetchUnreadCount();
    });
  } else {
    console.log('[Badge Messages] DOM déjà chargé');
    updateBadge(0);
    fetchUnreadCount();
  }

  // Écouter les mises à jour via Socket.io (si disponible)
  if (typeof io !== 'undefined') {
    console.log('[Badge Messages] Socket.io détecté');
    
    // Attendre que le socket soit initialisé
    setTimeout(() => {
      if (window.socket) {
        window.socket.on('unread_count_update', (data) => {
          console.log('[Badge Messages] Mise à jour Socket:', data.count);
          updateBadge(data.count || 0);
        });

        window.socket.on('new_message', () => {
          console.log('[Badge Messages] Nouveau message reçu');
          fetchUnreadCount();
        });
      }
    }, 1000);
  }

  // Rafraîchir toutes les 30 secondes
  setInterval(() => {
    console.log('[Badge Messages] Rafraîchissement automatique');
    fetchUnreadCount();
  }, 30000);

})();

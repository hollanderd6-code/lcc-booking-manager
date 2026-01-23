/* ============================================
   🔢 BADGE MESSAGES - AFFICHAGE PERMANENT
   Badge en haut à droite de l'icône sur mobile
   ============================================ */

(function() {
  'use strict';
  
  const IS_NATIVE = window.Capacitor?.isNativePlatform() || false;
  const API_URL = IS_NATIVE ? 'https://lcc-booking-manager.onrender.com' : window.location.origin;

  console.log('🔔 [BADGE] IS_NATIVE:', IS_NATIVE);
  console.log('🔔 [BADGE] API_URL:', API_URL);

  // ============================================
  // 📊 CHARGER LE NOMBRE DE MESSAGES NON LUS
  // ============================================
  
  async function loadUnreadCount() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) {
        console.log('⚠️ [BADGE] Pas de token');
        return;
      }

      console.log('📤 [BADGE] Fetch:', `${API_URL}/api/chat/conversations`);

      const response = await fetch(`${API_URL}/api/chat/conversations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      console.log('📥 [BADGE] Status:', response.status);

      if (!response.ok) {
        console.warn('⚠️ [BADGE] Erreur API', response.status);
        return;
      }

      const data = await response.json();
      
      let totalUnread = 0;
      if (data.conversations && Array.isArray(data.conversations)) {
        data.conversations.forEach((conv) => {
          totalUnread += parseInt(conv.unread_count) || 0;
        });
      }

      console.log('📬 [BADGE] Total:', totalUnread);
      updateAllBadges(totalUnread);

    } catch (error) {
      console.error('❌ [BADGE] Erreur:', error);
    }
  }

  // ============================================
  // 🎨 METTRE À JOUR TOUS LES BADGES
  // ============================================
  
  function updateAllBadges(count) {
    console.log('🎨 [BADGE] Update all:', count);
    
    // Desktop - sidebar
    const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
    if (desktopNav) {
      updateSingleBadge(desktopNav, count, 'desktop');
    } else {
      console.log('⚠️ [BADGE] Desktop nav non trouvé');
    }
    
    // Mobile - bottom tabs
    const mobileTab = document.querySelector('.tab-btn[data-tab="messages"]');
    if (mobileTab) {
      updateSingleBadge(mobileTab, count, 'mobile');
    }
  }

  function updateSingleBadge(element, count, type) {
    // S'assurer que le parent a position relative
    element.style.position = 'relative';
    
    // Chercher ou créer le badge
    let badge = element.querySelector('.badge-count');
    
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge-count';
      element.appendChild(badge);
      console.log('✅ [BADGE] Créé (' + type + ')');
    }

    // Appliquer les styles directement - TOUJOURS VISIBLE
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
      // MOBILE : Badge en haut à droite de l'icône (style iOS)
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
    console.log('✅ [BADGE] ' + type + ':', count);
  }

  // ============================================
  // 🚀 INITIALISATION
  // ============================================
  
  function init() {
    console.log('🔔 [BADGE] Init...');
    
    // Essayer immédiatement
    loadUnreadCount();
    
    // Réessayer après plusieurs délais (au cas où la sidebar n'est pas encore là)
    setTimeout(loadUnreadCount, 500);
    setTimeout(loadUnreadCount, 1000);
    setTimeout(loadUnreadCount, 2000);
    setTimeout(loadUnreadCount, 3000);
    
    // Refresh toutes les 30 secondes
    setInterval(loadUnreadCount, 30000);
    
    // Écouter quand la sidebar est prête
    document.addEventListener('sidebarReady', () => {
      console.log('📢 [BADGE] sidebarReady reçu');
      setTimeout(loadUnreadCount, 100);
    });
  }

  // Démarrer
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Exposer pour debug
  window.refreshMessagesBadge = loadUnreadCount;
  window.updateMessagesBadge = updateAllBadges;
  window.debugBadge = function() {
    console.log('=== DEBUG BADGE ===');
    console.log('Token:', localStorage.getItem('lcc_token') ? 'OK' : 'MANQUANT');
    console.log('Desktop nav:', document.querySelector('.nav-item[data-page="messages"]') ? 'OK' : 'NON TROUVÉ');
    console.log('Mobile tab:', document.querySelector('.tab-btn[data-tab="messages"]') ? 'OK' : 'NON TROUVÉ');
    console.log('Sidebar:', document.querySelector('.sidebar') ? 'OK' : 'NON TROUVÉ');
    console.log('bhSidebar:', document.getElementById('bhSidebar')?.innerHTML ? 'REMPLI' : 'VIDE');
    loadUnreadCount();
  };

})();

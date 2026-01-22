/* ============================================
   🔢 BADGE MESSAGES - VERSION CORRIGÉE
   
   ✅ Affiche le badge sur desktop (nav-item)
   ✅ Affiche le badge sur mobile (mobile-tab)
   ✅ Mise à jour en temps réel avec Socket.io
   ✅ Gestion robuste avec MutationObserver
   ✅ Attend que la sidebar soit injectée
   ============================================ */

(function() {
  'use strict';

  const API_URL = window.location.origin;
  let socket = null;
  let badgeInitialized = false;
  let retryCount = 0;
  const MAX_RETRIES = 10;

  // ============================================
  // 📊 CHARGER LE NOMBRE DE MESSAGES NON LUS
  // ============================================
  
  async function loadUnreadCount() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) {
        console.log('⚠️ Badge: Pas de token - Badge = 0');
        updateBadge(0);
        return;
      }

      // Appel API pour récupérer les conversations
      const response = await fetch(`${API_URL}/api/chat/conversations`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.warn('⚠️ Badge: Erreur API (status:', response.status, ') - Badge = 0');
        updateBadge(0);
        return;
      }

      const data = await response.json();
      
      // Compter les messages non lus
      let totalUnread = 0;
      
      if (data.conversations && Array.isArray(data.conversations)) {
        data.conversations.forEach((conv) => {
          const unreadCount = parseInt(conv.unread_count) || 0;
          totalUnread += unreadCount;
        });
      }

      // Mettre à jour le badge
      updateBadge(totalUnread);
      
      console.log('📬 Badge Messages: Total non lus =', totalUnread);

    } catch (error) {
      console.error('❌ Badge: Erreur chargement:', error);
      updateBadge(0);
    }
  }

  // ============================================
  // 🎨 METTRE À JOUR LE BADGE
  // ============================================
  
  function updateBadge(count) {
    // 📱 Mobile : chercher .mobile-tab ou .tab-btn
    const mobileTab = document.querySelector('.mobile-tab[data-tab="messages"]') ||
                      document.querySelector('.tab-btn[data-tab="messages"]');
    
    // 💻 Desktop : chercher .nav-item
    const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
    
    if (!mobileTab && !desktopNav) {
      // Les éléments n'existent pas encore, on réessaiera plus tard
      if (!badgeInitialized && retryCount < MAX_RETRIES) {
        retryCount++;
        console.log(`⏳ Badge: Éléments non trouvés, retry ${retryCount}/${MAX_RETRIES}...`);
        setTimeout(() => updateBadge(count), 200);
      }
      return;
    }

    badgeInitialized = true;
    retryCount = 0;

    // Fonction pour mettre à jour un élément
    function updateElement(element, isMobile) {
      if (!element) return;
      
      // Mettre à jour l'attribut data-count
      element.setAttribute('data-count', count);

      // Si le badge n'existe pas encore, le créer
      let badge = element.querySelector('.badge-count');
      
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge-count';
        
        // Style inline pour garantir l'affichage
        badge.style.cssText = `
          position: absolute;
          top: ${isMobile ? '4px' : '8px'};
          right: ${isMobile ? '50%' : '8px'};
          transform: ${isMobile ? 'translateX(12px)' : 'none'};
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          background: #EF4444;
          color: white;
          font-size: 11px;
          font-weight: 600;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        `;
        
        // S'assurer que le parent a position relative
        if (getComputedStyle(element).position === 'static') {
          element.style.position = 'relative';
        }
        
        element.appendChild(badge);
        console.log(`✅ Badge créé (${isMobile ? 'mobile' : 'desktop'})`);
      }

      // Afficher ou masquer le badge selon le count
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }

    // Mettre à jour mobile (si existe)
    if (mobileTab) {
      updateElement(mobileTab, true);
    }
    
    // Mettre à jour desktop (si existe)
    if (desktopNav) {
      updateElement(desktopNav, false);
    }
  }

  // ============================================
  // 🔌 SOCKET.IO - MISES À JOUR EN TEMPS RÉEL
  // ============================================
  
  function connectSocket() {
    // Vérifier si Socket.io est disponible
    if (typeof io === 'undefined') {
      console.warn('⚠️ Badge: Socket.io non disponible - Badge statique');
      return;
    }

    try {
      socket = io(API_URL);

      socket.on('connect', () => {
        console.log('✅ Badge: Socket connecté');
        
        // Rejoindre la room utilisateur
        const userId = getUserId();
        if (userId) {
          socket.emit('join_user_room', userId);
        }
      });

      // Écouter les nouveaux messages
      socket.on('new_message', () => {
        setTimeout(loadUnreadCount, 500);
      });

      // Écouter les notifications
      socket.on('new_notification', () => {
        setTimeout(loadUnreadCount, 500);
      });

      // Écouter les messages lus
      socket.on('messages_read', () => {
        setTimeout(loadUnreadCount, 300);
      });

      socket.on('disconnect', () => {
        console.log('⚠️ Badge: Socket déconnecté');
      });

    } catch (error) {
      console.error('❌ Badge: Erreur connexion Socket:', error);
    }
  }

  // ============================================
  // 🔑 RÉCUPÉRER L'ID UTILISATEUR
  // ============================================
  
  function getUserId() {
    try {
      const userStr = localStorage.getItem('lcc_user');
      if (userStr) {
        const user = JSON.parse(userStr);
        return user.id;
      }
    } catch (error) {
      console.error('❌ Badge: Erreur lecture user:', error);
    }
    return null;
  }

  // ============================================
  // 🔄 RECHARGER LE BADGE PÉRIODIQUEMENT
  // ============================================
  
  function startPeriodicRefresh() {
    setInterval(() => {
      loadUnreadCount();
    }, 30000); // 30 secondes
  }

  // ============================================
  // 👁️ OBSERVER LES CHANGEMENTS DU DOM
  // ============================================
  
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // Vérifier si la sidebar ou les tabs ont été ajoutés
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
          const mobileTab = document.querySelector('.tab-btn[data-tab="messages"]');
          
          if ((desktopNav || mobileTab) && !badgeInitialized) {
            console.log('🔍 Badge: Éléments détectés via MutationObserver');
            loadUnreadCount();
            break;
          }
        }
      }
    });

    observer.observe(document.body, { 
      childList: true, 
      subtree: true 
    });

    // Déconnecter après 10 secondes pour économiser les ressources
    setTimeout(() => {
      observer.disconnect();
    }, 10000);
  }

  // ============================================
  // 🚀 INITIALISATION
  // ============================================
  
  function init() {
    console.log('🚀 Badge Messages: Initialisation...');
    
    // Écouter l'événement sidebarReady émis par bh-layout.js
    document.addEventListener('sidebarReady', () => {
      console.log('📢 Badge: Événement sidebarReady reçu');
      setTimeout(loadUnreadCount, 100);
    });

    // Setup MutationObserver pour détecter quand les éléments sont créés
    setupMutationObserver();
    
    // Essayer de charger immédiatement
    loadUnreadCount();
    
    // Connecter Socket.io
    connectSocket();
    
    // Backup : recharger périodiquement
    startPeriodicRefresh();
    
    // Réessayer après des délais progressifs
    setTimeout(loadUnreadCount, 300);
    setTimeout(loadUnreadCount, 700);
    setTimeout(loadUnreadCount, 1500);
  }

  // ============================================
  // DÉMARRAGE
  // ============================================
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================
  // 🌐 EXPOSER GLOBALEMENT POUR DÉBOGAGE
  // ============================================
  
  window.updateMessagesBadge = updateBadge;
  window.refreshMessagesBadge = loadUnreadCount;
  
  // Pour déboguer depuis la console
  window.debugBadge = function() {
    console.log('🔍 DEBUG BADGE:');
    console.log('- API_URL:', API_URL);
    console.log('- Token:', localStorage.getItem('lcc_token') ? 'Présent' : 'Absent');
    console.log('- Socket:', socket ? 'Connecté' : 'Non connecté');
    console.log('- Badge initialisé:', badgeInitialized);
    
    const mobileTab = document.querySelector('.mobile-tab[data-tab="messages"]') ||
                      document.querySelector('.tab-btn[data-tab="messages"]');
    const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
    
    console.log('- Mobile Tab:', mobileTab ? 'Trouvé' : 'Non trouvé');
    console.log('- Desktop Nav:', desktopNav ? 'Trouvé' : 'Non trouvé');
    
    if (desktopNav) {
      const badge = desktopNav.querySelector('.badge-count');
      console.log('- Desktop Badge:', badge ? `Créé (${badge.textContent})` : 'Pas encore créé');
    }
    
    console.log('🔄 Rechargement forcé...');
    loadUnreadCount();
  };

})();

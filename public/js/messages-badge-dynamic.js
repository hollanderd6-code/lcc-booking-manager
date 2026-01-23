/* ============================================
   🔔 BADGE MESSAGES - VERSION CORRIGÉE iOS
   
   Affiche toujours le badge (même pour 0)
   Gestion robuste des erreurs
   Compatible iOS/Android
   ============================================ */

(function() {
  'use strict';

  // Détection native
  const IS_NATIVE = !!(
    window.Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:'
  );

  const API_URL = IS_NATIVE 
    ? 'https://lcc-booking-manager.onrender.com' 
    : window.location.origin;

  console.log('🔔 [BADGE] Initialisation...');
  console.log('🔔 [BADGE] API_URL:', API_URL);
  console.log('🔔 [BADGE] IS_NATIVE:', IS_NATIVE);

  let socket = null;

  // ============================================
  // 📊 CHARGER LE NOMBRE DE MESSAGES NON LUS
  // ============================================
  
  async function loadUnreadCount() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) {
        console.log('⚠️ [BADGE] Pas de token - Badge = 0');
        updateBadge(0);
        return;
      }

      console.log('📤 [BADGE] Requête conversations...');

      // Construire l'URL complète
      const url = `${API_URL}/api/chat/conversations`;
      console.log('📤 [BADGE] URL:', url);

      // Appel API pour récupérer les conversations
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('📥 [BADGE] Response status:', response.status);

      if (!response.ok) {
        console.warn(`⚠️ [BADGE] Erreur API (${response.status}) - Badge = 0`);
        updateBadge(0);
        return;
      }

      // Vérifier que c'est du JSON
      const contentType = response.headers.get('content-type') || '';
      console.log('📄 [BADGE] Content-Type:', contentType);

      if (!contentType.includes('application/json')) {
        const text = await response.text();
        console.error('❌ [BADGE] Réponse non-JSON:', text.substring(0, 200));
        updateBadge(0);
        return;
      }

      const data = await response.json();
      
      console.log('📦 [BADGE] Données reçues:', data);
      
      // Compter les messages non lus
      let totalUnread = 0;
      
      if (data.conversations && Array.isArray(data.conversations)) {
        console.log(`📋 [BADGE] ${data.conversations.length} conversation(s)`);
        
        data.conversations.forEach((conv, index) => {
          const unreadCount = parseInt(conv.unread_count) || 0;
          
          if (unreadCount > 0) {
            console.log(`  - Conv ${index + 1} (${conv.guest_name || 'Sans nom'}): ${unreadCount} non lu(s)`);
          }
          
          totalUnread += unreadCount;
        });
      } else {
        console.warn('⚠️ [BADGE] Format de réponse inattendu:', data);
      }

      // Mettre à jour le badge
      updateBadge(totalUnread);
      
      console.log('🔔 [BADGE] Total messages non lus:', totalUnread);

    } catch (error) {
      console.error('❌ [BADGE] Erreur chargement:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      // En cas d'erreur, afficher 0
      updateBadge(0);
    }
  }

  // ============================================
  // 🎨 METTRE À JOUR LE BADGE
  // ============================================
  
  function updateBadge(count) {
    console.log('🎨 [BADGE] Mise à jour:', count);

    // 📱 Mobile : chercher .mobile-tab ou .tab-btn
    const mobileTab = document.querySelector('.mobile-tab[data-tab="messages"]') ||
                      document.querySelector('.tab-btn[data-tab="messages"]');
    
    // 💻 Desktop : chercher .nav-item
    const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
    
    if (!mobileTab && !desktopNav) {
      console.warn('⚠️ [BADGE] Onglet/Nav Messages non trouvé');
      return;
    }

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
        element.appendChild(badge);
        console.log(`✅ [BADGE] Badge créé (${isMobile ? 'mobile' : 'desktop'})`);
      }

      // Afficher le badge
      if (count > 99) {
        badge.textContent = '99+';
      } else {
        badge.textContent = count;
      }
      
      // Sur desktop : masquer si 0, sur mobile : toujours afficher
      badge.style.display = (count > 0 || isMobile) ? 'flex' : 'none';
    }

    // Mettre à jour mobile (si existe)
    if (mobileTab) {
      updateElement(mobileTab, true);
      console.log('✅ [BADGE] Mobile mis à jour');
    }
    
    // Mettre à jour desktop (si existe)
    if (desktopNav) {
      updateElement(desktopNav, false);
      console.log('✅ [BADGE] Desktop mis à jour');
    }
  }

  // ============================================
  // 🔌 SOCKET.IO - MISES À JOUR EN TEMPS RÉEL
  // ============================================
  
  function connectSocket() {
    // Vérifier si Socket.io est disponible
    if (typeof io === 'undefined') {
      console.warn('⚠️ [BADGE] Socket.io non disponible - Badge statique');
      return;
    }

    try {
      console.log('🔌 [BADGE] Connexion Socket.io...');
      socket = io(API_URL);

      socket.on('connect', () => {
        console.log('✅ [BADGE] Socket connecté');
        
        // Rejoindre la room utilisateur
        const userId = getUserId();
        if (userId) {
          socket.emit('join_user_room', userId);
          console.log('🔌 [BADGE] Room user rejointe:', userId);
        }
      });

      // Écouter les nouveaux messages
      socket.on('new_message', (message) => {
        console.log('🔔 [BADGE] Nouveau message reçu:', message);
        setTimeout(() => {
          loadUnreadCount();
        }, 500);
      });

      // Écouter les notifications
      socket.on('new_notification', (notification) => {
        console.log('🔔 [BADGE] Nouvelle notification:', notification);
        setTimeout(() => {
          loadUnreadCount();
        }, 500);
      });

      socket.on('disconnect', () => {
        console.log('❌ [BADGE] Socket déconnecté');
      });

    } catch (error) {
      console.error('❌ [BADGE] Erreur connexion Socket:', error);
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
      console.error('❌ [BADGE] Erreur lecture user:', error);
    }
    return null;
  }

  // ============================================
  // 🔄 RECHARGER LE BADGE PÉRIODIQUEMENT
  // ============================================
  
  function startPeriodicRefresh() {
    // Recharger toutes les 30 secondes (backup si Socket.io ne fonctionne pas)
    setInterval(() => {
      console.log('🔄 [BADGE] Refresh périodique...');
      loadUnreadCount();
    }, 30000); // 30 secondes
  }

  // ============================================
  // 🚀 INITIALISATION
  // ============================================
  
  function init() {
    // Attendre que le DOM soit prêt
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // Attendre que les onglets soient créés (mobile-tabs)
    setTimeout(() => {
      console.log('🔔 [BADGE] Initialisation...');
      
      // Charger le compteur
      loadUnreadCount();
      
      // Connecter Socket.io pour les mises à jour temps réel
      connectSocket();
      
      // Backup : recharger périodiquement
      startPeriodicRefresh();
      
    }, 1000); // Attendre 1s que les onglets soient créés
  }

  // Démarrer
  init();

  // ============================================
  // 🌐 EXPOSER GLOBALEMENT POUR DÉBOGAGE
  // ============================================
  
  window.updateMessagesBadge = updateBadge;
  window.refreshMessagesBadge = loadUnreadCount;
  
  // Pour déboguer depuis la console
  window.debugBadge = function() {
    console.log('🔍 DEBUG BADGE:');
    console.log('- IS_NATIVE:', IS_NATIVE);
    console.log('- API_URL:', API_URL);
    console.log('- Token:', localStorage.getItem('lcc_token') ? 'Présent' : 'Absent');
    console.log('- User:', localStorage.getItem('lcc_user'));
    console.log('- Socket:', socket ? 'Connecté' : 'Non connecté');
    
    // Forcer le rechargement
    console.log('🔄 Rechargement forcé...');
    loadUnreadCount();
  };

  console.log('✅ [BADGE] Script chargé');

})();

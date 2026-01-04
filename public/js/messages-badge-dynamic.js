/* ============================================
   🔔 BADGE MESSAGES - SYSTÈME DYNAMIQUE
   
   Charge et met à jour le compteur de messages
   non lus en temps réel
   
   À inclure sur TOUTES les pages
   ============================================ */

(function() {
  'use strict';

  const API_URL = window.location.origin;
  let socket = null;

  // ============================================
  // 📊 CHARGER LE NOMBRE DE MESSAGES NON LUS
  // ============================================
  
  async function loadUnreadCount() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) {
        console.log('⚠️ Pas de token - Badge désactivé');
        return;
      }

      // Appel API pour récupérer les conversations
      const response = await fetch(`${API_URL}/api/chat/conversations`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Erreur chargement conversations');
      }

      const data = await response.json();
      
      // Compter les messages non lus
      let totalUnread = 0;
      
      if (data.conversations && Array.isArray(data.conversations)) {
        data.conversations.forEach(conv => {
          totalUnread += (conv.unread_count || 0);
        });
      }

      // Mettre à jour le badge
      updateBadge(totalUnread);
      
      console.log('🔔 Messages non lus:', totalUnread);

    } catch (error) {
      console.error('❌ Erreur chargement badge:', error);
      // En cas d'erreur, afficher 0
      updateBadge(0);
    }
  }

  // ============================================
  // 🎨 METTRE À JOUR LE BADGE
  // ============================================
  
  function updateBadge(count) {
    const messagesTab = document.querySelector('.mobile-tab[data-tab="messages"]') ||
                       document.querySelector('.tab-btn[data-tab="messages"]');
    
    if (!messagesTab) {
      console.warn('⚠️ Onglet Messages non trouvé');
      return;
    }

    // Mettre à jour l'attribut data-count
    messagesTab.setAttribute('data-count', count);

    // Si le badge n'existe pas encore, le créer
    let badge = messagesTab.querySelector('.badge-count');
    
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge-count';
      messagesTab.appendChild(badge);
    }

    // Afficher ou masquer selon le nombre
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.textContent = '0';
      badge.style.display = 'flex'; // Afficher 0 aussi
    }

    console.log('🔔 Badge mis à jour:', count);
  }

  // ============================================
  // 🔌 SOCKET.IO - MISES À JOUR EN TEMPS RÉEL
  // ============================================
  
  function connectSocket() {
    // Vérifier si Socket.io est disponible
    if (typeof io === 'undefined') {
      console.warn('⚠️ Socket.io non disponible - Badge statique');
      return;
    }

    try {
      socket = io(API_URL);

      socket.on('connect', () => {
        console.log('✅ Socket connecté pour le badge');
        
        // Rejoindre la room utilisateur
        const userId = getUserId();
        if (userId) {
          socket.emit('join_user_room', userId);
        }
      });

      // Écouter les nouveaux messages
      socket.on('new_message', () => {
        console.log('🔔 Nouveau message reçu - Recharger badge');
        loadUnreadCount();
      });

      // Écouter les notifications
      socket.on('new_notification', () => {
        console.log('🔔 Nouvelle notification - Recharger badge');
        loadUnreadCount();
      });

      socket.on('disconnect', () => {
        console.log('❌ Socket déconnecté');
      });

    } catch (error) {
      console.error('❌ Erreur connexion Socket:', error);
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
      console.error('❌ Erreur lecture user:', error);
    }
    return null;
  }

  // ============================================
  // 🔄 RECHARGER LE BADGE PÉRIODIQUEMENT
  // ============================================
  
  function startPeriodicRefresh() {
    // Recharger toutes les 30 secondes (backup si Socket.io ne fonctionne pas)
    setInterval(() => {
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
      console.log('📱 Initialisation badge messages...');
      
      // Charger le compteur
      loadUnreadCount();
      
      // Connecter Socket.io pour les mises à jour temps réel
      connectSocket();
      
      // Backup : recharger périodiquement
      startPeriodicRefresh();
      
    }, 500); // Attendre 500ms que les onglets soient créés
  }

  // Démarrer
  init();

  // ============================================
  // 🌍 EXPOSER updateBadge GLOBALEMENT
  // ============================================
  
  window.updateMessagesBadge = updateBadge;
  window.refreshMessagesBadge = loadUnreadCount;

})();

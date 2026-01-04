/* ============================================
   🔔 BADGE MESSAGES - VERSION CORRIGÉE
   
   Affiche toujours le badge (même pour 0)
   Meilleur comptage des messages non lus
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
        console.log('⚠️ Pas de token - Badge = 0');
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
        console.warn('⚠️ Erreur API (status:', response.status, ') - Badge = 0');
        updateBadge(0);
        return;
      }

      const data = await response.json();
      
      console.log('📦 Données reçues:', data);
      
      // Compter les messages non lus
      let totalUnread = 0;
      
      if (data.conversations && Array.isArray(data.conversations)) {
        console.log(`📋 ${data.conversations.length} conversation(s) trouvée(s)`);
        
        data.conversations.forEach((conv, index) => {
          const unreadCount = parseInt(conv.unread_count) || 0;
          
          if (unreadCount > 0) {
            console.log(`  - Conv ${index + 1} (${conv.guest_name || 'Sans nom'}): ${unreadCount} non lu(s)`);
          }
          
          totalUnread += unreadCount;
        });
      } else {
        console.warn('⚠️ Format de réponse inattendu:', data);
      }

      // Mettre à jour le badge
      updateBadge(totalUnread);
      
      console.log('🔔 Total messages non lus:', totalUnread);

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
      console.log('✅ Badge créé');
    }

    // Toujours afficher le badge (même pour 0)
    if (count > 99) {
      badge.textContent = '99+';
    } else {
      badge.textContent = count;
    }
    
    badge.style.display = 'flex';

    console.log('✅ Badge mis à jour:', badge.textContent);
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
          console.log('🔌 Room user rejointe:', userId);
        }
      });

      // Écouter les nouveaux messages
      socket.on('new_message', (message) => {
        console.log('🔔 Nouveau message reçu:', message);
        // Attendre 500ms avant de recharger (laisser le temps au serveur de mettre à jour)
        setTimeout(() => {
          loadUnreadCount();
        }, 500);
      });

      // Écouter les notifications
      socket.on('new_notification', (notification) => {
        console.log('🔔 Nouvelle notification:', notification);
        setTimeout(() => {
          loadUnreadCount();
        }, 500);
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
      console.log('🔄 Refresh périodique du badge...');
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
  // 🌍 EXPOSER GLOBALEMENT POUR DÉBOGAGE
  // ============================================
  
  window.updateMessagesBadge = updateBadge;
  window.refreshMessagesBadge = loadUnreadCount;
  
  // Pour déboguer depuis la console
  window.debugBadge = function() {
    console.log('🔍 DEBUG BADGE:');
    console.log('- API_URL:', API_URL);
    console.log('- Token:', localStorage.getItem('lcc_token') ? 'Présent' : 'Absent');
    console.log('- User:', localStorage.getItem('lcc_user'));
    console.log('- Socket:', socket ? 'Connecté' : 'Non connecté');
    
    // Forcer le rechargement
    loadUnreadCount();
  };

})();

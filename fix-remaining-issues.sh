#!/bin/bash

echo "🔧 Correction des erreurs mineures iOS"
echo "======================================="
echo ""

# ============================================
# 1. Corriger messages-badge-dynamic.js
# ============================================

echo "📛 1. Correction badge messages..."

cat > public/js/messages-badge-dynamic.js << 'EOF'
/* Badge messages - Version iOS corrigée */

(function() {
  'use strict';

  const IS_NATIVE = !!(
    window.Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:'
  );

  const API_URL = IS_NATIVE 
    ? 'https://lcc-booking-manager.onrender.com' 
    : window.location.origin;

  console.log('🔔 [BADGE] Init - API_URL:', API_URL);

  let socket = null;

  async function loadUnreadCount() {
    try {
      const token = localStorage.getItem('lcc_token');
      if (!token) {
        console.log('⚠️ [BADGE] Pas de token');
        updateBadge(0);
        return;
      }

      const url = `${API_URL}/api/chat/conversations`;
      console.log('📤 [BADGE] Fetch:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('📥 [BADGE] Status:', response.status);

      if (!response.ok) {
        console.warn(`⚠️ [BADGE] HTTP ${response.status}`);
        updateBadge(0);
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        console.error('❌ [BADGE] Non-JSON');
        updateBadge(0);
        return;
      }

      const data = await response.json();
      console.log('📦 [BADGE] Data:', data);

      let totalUnread = 0;
      
      if (data.conversations && Array.isArray(data.conversations)) {
        console.log(`📋 [BADGE] ${data.conversations.length} conv(s)`);
        
        data.conversations.forEach((conv) => {
          const unread = parseInt(conv.unread_count) || 0;
          if (unread > 0) {
            console.log(`  - ${conv.guest_name}: ${unread} non lu(s)`);
          }
          totalUnread += unread;
        });
      }

      console.log(`🔔 [BADGE] Total non lus: ${totalUnread}`);
      updateBadge(totalUnread);

    } catch (error) {
      console.error('❌ [BADGE] Erreur:', error);
      updateBadge(0);
    }
  }

  function updateBadge(count) {
    console.log('🎨 [BADGE] Update:', count);

    const mobileTab = document.querySelector('.mobile-tab[data-tab="messages"]') ||
                      document.querySelector('.tab-btn[data-tab="messages"]');
    
    const desktopNav = document.querySelector('.nav-item[data-page="messages"]');
    
    if (!mobileTab && !desktopNav) {
      console.warn('⚠️ [BADGE] Aucun élément trouvé');
      return;
    }

    function updateElement(element, isMobile) {
      if (!element) return;
      
      element.setAttribute('data-count', count);

      let badge = element.querySelector('.badge-count');
      
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'badge-count';
        element.appendChild(badge);
        console.log(`✅ [BADGE] Badge créé (${isMobile ? 'mobile' : 'desktop'})`);
      }

      if (count > 99) {
        badge.textContent = '99+';
      } else {
        badge.textContent = count;
      }
      
      // Mobile: toujours afficher, Desktop: masquer si 0
      badge.style.display = (count > 0 || isMobile) ? 'flex' : 'none';
      
      console.log(`✅ [BADGE] ${isMobile ? 'Mobile' : 'Desktop'} updated: ${count}`);
    }

    if (mobileTab) updateElement(mobileTab, true);
    if (desktopNav) updateElement(desktopNav, false);
  }

  function connectSocket() {
    if (typeof io === 'undefined') {
      console.warn('⚠️ [BADGE] Socket.io non disponible');
      return;
    }

    try {
      socket = io(API_URL);

      socket.on('connect', () => {
        console.log('✅ [BADGE] Socket connecté');
        const userId = getUserId();
        if (userId) {
          socket.emit('join_user_room', userId);
        }
      });

      socket.on('new_message', () => {
        console.log('🔔 [BADGE] Nouveau message');
        setTimeout(() => loadUnreadCount(), 500);
      });

      socket.on('disconnect', () => {
        console.log('❌ [BADGE] Socket déconnecté');
      });

    } catch (error) {
      console.error('❌ [BADGE] Socket error:', error);
    }
  }

  function getUserId() {
    try {
      const userStr = localStorage.getItem('lcc_user');
      if (userStr) {
        const user = JSON.parse(userStr);
        return user.id;
      }
    } catch (error) {
      console.error('❌ [BADGE] User parse error:', error);
    }
    return null;
  }

  function startPeriodicRefresh() {
    setInterval(() => {
      console.log('🔄 [BADGE] Refresh périodique');
      loadUnreadCount();
    }, 30000);
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    setTimeout(() => {
      console.log('🔔 [BADGE] Démarrage...');
      loadUnreadCount();
      connectSocket();
      startPeriodicRefresh();
    }, 1000);
  }

  init();

  window.updateMessagesBadge = updateBadge;
  window.refreshMessagesBadge = loadUnreadCount;

})();
EOF

echo "   ✅ messages-badge-dynamic.js corrigé"
echo ""

# ============================================
# 2. Nettoyer les fichiers manquants
# ============================================

echo "🧹 2. Nettoyage fichiers manquants..."

# Trouver tous les fichiers HTML qui référencent logout-fix.js
FILES_WITH_LOGOUT=$(grep -l "logout-fix.js" public/*.html 2>/dev/null || true)
if [ -n "$FILES_WITH_LOGOUT" ]; then
  for file in $FILES_WITH_LOGOUT; do
    sed -i '' '/logout-fix.js/d' "$file"
    echo "   ✅ Supprimé logout-fix.js de $(basename $file)"
  done
else
  echo "   ℹ️  Pas de référence à logout-fix.js"
fi

# Supprimer messages-badge-sync.js
FILES_WITH_SYNC=$(grep -l "messages-badge-sync.js" public/*.html 2>/dev/null || true)
if [ -n "$FILES_WITH_SYNC" ]; then
  for file in $FILES_WITH_SYNC; do
    sed -i '' '/messages-badge-sync.js/d' "$file"
    echo "   ✅ Supprimé messages-badge-sync.js de $(basename $file)"
  done
else
  echo "   ℹ️  Pas de référence à messages-badge-sync.js"
fi

echo ""

# ============================================
# 3. Push Notifications (créer un placeholder)
# ============================================

echo "🔔 3. Push notifications placeholder..."

# Vérifier si le plugin est installé
if npm list @capacitor/push-notifications &>/dev/null; then
  echo "   ✅ Plugin @capacitor/push-notifications déjà installé"
else
  echo "   ⚠️  Plugin manquant, installation..."
  npm install @capacitor/push-notifications
fi

echo ""

# ============================================
# 4. Résumé et rebuild
# ============================================

echo "╔════════════════════════════════════════╗"
echo "║  ✅ CORRECTIONS APPLIQUÉES            ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Modifications:"
echo "  ✅ Badge messages corrigé (iOS fix)"
echo "  ✅ Fichiers manquants nettoyés"
echo "  ✅ Push notifications vérifié"
echo ""
echo "Prochaines étapes:"
echo "1. rm -rf ios/App/App/public"
echo "2. npx cap copy ios"
echo "3. npx cap sync ios"
echo "4. npx cap open ios"
echo "5. Clean Build + Lancer"
echo ""
echo "Le compteur de messages devrait maintenant afficher 1 ! 🎯"
echo ""

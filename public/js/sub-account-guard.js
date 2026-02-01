// ============================================
// 🔒 PROTECTION DES PAGES - SOUS-COMPTES
// Fichier : /js/sub-account-guard.js
// ============================================

(function() {
  'use strict';
  
  console.log('🔒 Sub-account Guard - Initialisation');
  
  // Configuration des pages et permissions requises
  const PAGE_PERMISSIONS = {
    'app.html': { view: 'can_view_reservations', edit: 'can_edit_reservations' },
    'cleaning.html': { view: 'can_view_cleaning', edit: 'can_manage_cleaning' },
    'messages.html': { view: 'can_view_messages', edit: 'can_send_messages' },
    'deposits.html': { view: 'can_view_deposits', edit: null },
    'smart-locks.html': { view: 'can_manage_locks', edit: 'can_manage_locks' }
  };
  
  // Récupérer les infos du compte
  const token = localStorage.getItem('lcc_token');
  const accountType = localStorage.getItem('lcc_account_type');
  const permissions = JSON.parse(localStorage.getItem('lcc_permissions') || '{}');
  
  // Si pas de token → login
  if (!token) {
    console.log('❌ Pas de token - Redirection login');
    window.location.href = '/login.html';
    return;
  }
  
  // Si compte principal → accès total
  if (accountType !== 'sub') {
    console.log('✅ Compte principal - Accès total');
    window.isSubAccount = false;
    window.permissions = 'all';
    window.hasPermission = () => true;
    window.hasEditPermission = () => true;
    return;
  }
  
  // Sous-compte → vérifier permissions
  console.log('🔐 Sous-compte détecté - Vérification permissions');
  console.log('Permissions:', permissions);
  
  window.isSubAccount = true;
  window.permissions = permissions;
  
  // Déterminer la page courante
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const pageConfig = PAGE_PERMISSIONS[currentPage];
  
  console.log('📄 Page courante:', currentPage);
  
  if (pageConfig) {
    console.log('🔍 Configuration trouvée:', pageConfig);
    
    // Vérifier permission de lecture
    const hasViewPermission = permissions[pageConfig.view] === true;
    
    console.log(`Permission "${pageConfig.view}":`, hasViewPermission);
    
    if (!hasViewPermission) {
      console.log('❌ Permission refusée pour', currentPage);
      alert('Vous n\'avez pas accès à cette page.');
      window.location.href = '/sub-account.html';
      return;
    }
    
    console.log('✅ Permission accordée pour', currentPage);
    
    // Stocker les permissions d'édition
    window.hasEditPermission = function() {
      if (!pageConfig.edit) return false;
      const hasEdit = permissions[pageConfig.edit] === true;
      console.log(`Permission d'édition "${pageConfig.edit}":`, hasEdit);
      return hasEdit;
    };
    
    // Fonction helper pour vérifier n'importe quelle permission
    window.hasPermission = function(permName) {
      return permissions[permName] === true;
    };
    
    // Au chargement du DOM, masquer les boutons non autorisés
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hideUnauthorizedButtons);
    } else {
      hideUnauthorizedButtons();
    }
  } else {
    console.log('⚠️ Pas de configuration pour cette page');
    // Pas de restriction pour les pages non configurées
    window.hasPermission = (permName) => permissions[permName] === true;
    window.hasEditPermission = () => false;
  }
  
  // Masquer les boutons selon les permissions
  function hideUnauthorizedButtons() {
    console.log('🔍 Vérification des boutons à masquer...');
    
    const hasEdit = window.hasEditPermission();
    console.log('Permission d\'édition:', hasEdit);
    
    if (!hasEdit) {
      // Masquer tous les boutons d'édition
      const editSelectors = [
        '[data-action="edit"]',
        '[data-action="delete"]',
        '[data-action="create"]',
        '[data-action="add"]',
        'button[id*="edit"]',
        'button[id*="add"]',
        'button[id*="delete"]',
        'button[id*="create"]',
        'button[id*="new"]',
        '.btn-primary:not([id*="cancel"]):not([id*="close"])',
        'button[type="submit"]'
      ];
      
      const editButtons = document.querySelectorAll(editSelectors.join(', '));
      
      console.log(`🚫 ${editButtons.length} boutons trouvés à masquer`);
      
      editButtons.forEach(btn => {
        // Ne pas masquer les boutons de navigation
        const text = btn.textContent.trim().toLowerCase();
        if (text.includes('retour') || text.includes('annuler') || text.includes('fermer')) {
          return;
        }
        
        btn.style.display = 'none';
        console.log('  → Masqué:', btn.id || btn.textContent.trim().substring(0, 30));
      });
      
      // Ajouter un badge "Lecture seule"
      addReadOnlyBadge();
    } else {
      console.log('✅ Permissions d\'édition - Tous les boutons visibles');
    }
  }
  
  // Ajouter un badge "Partenaire"
  function addReadOnlyBadge() {
    // Vérifier si le badge n'existe pas déjà
    if (document.getElementById('subAccountReadOnlyBadge')) {
      return;
    }
    
    const badge = document.createElement('div');
    badge.id = 'subAccountReadOnlyBadge';
    badge.style.cssText = `
      position: fixed;
      top: 10px;
      right: 20px;
      background: linear-gradient(135deg, #F59E0B, #D97706);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
      display: flex;
      align-items: center;
      gap: 6px;
      animation: slideInFromRight 0.4s ease;
    `;
    badge.innerHTML = '<i class="fas fa-eye"></i> Partenaire';
    
    // Ajouter l'animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInFromRight {
        from {
          opacity: 0;
          transform: translateX(100px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(badge);
    console.log('📛 Badge "Partenaire" ajouté');
  }
  
  // Fonction publique pour masquer un élément spécifique
  window.hideIfNoPermission = function(elementId, permissionName) {
    if (window.isSubAccount && !window.hasPermission(permissionName)) {
      const element = document.getElementById(elementId);
      if (element) {
        element.style.display = 'none';
        console.log(`🚫 Élément masqué: ${elementId} (permission: ${permissionName})`);
      }
    }
  };
  
  // Fonction publique pour désactiver un élément
  window.disableIfNoPermission = function(elementId, permissionName) {
    if (window.isSubAccount && !window.hasPermission(permissionName)) {
      const element = document.getElementById(elementId);
      if (element) {
        element.disabled = true;
        element.style.opacity = '0.5';
        element.style.cursor = 'not-allowed';
        console.log(`🔒 Élément désactivé: ${elementId} (permission: ${permissionName})`);
      }
    }
  };
  
  console.log('✅ Sub-account Guard - Initialisé');
  
})();

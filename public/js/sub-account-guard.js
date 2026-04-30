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
    'smart-locks.html': { view: 'can_manage_locks', edit: 'can_manage_locks' },
    'contrat.html': { view: 'can_view_contracts', edit: null }
  };

  // Pages bloquées pour tous les sous-comptes (sans exception)
  const BLOCKED_PAGES = ['settings-account.html', 'help.html'];
  
  // Récupérer les infos du compte
  const token = localStorage.getItem('lcc_token');

  // Compatible nouveau système (lcc_is_sub_account) ET ancien (lcc_account_type)
  const isSubAccountNew = localStorage.getItem('lcc_is_sub_account') === 'true';
  const isSubAccountOld = localStorage.getItem('lcc_account_type') === 'sub';
  const accountType = isSubAccountNew ? 'sub' : (localStorage.getItem('lcc_account_type') || 'main');

  // Permissions : nouveau système prioritaire
  let permissions = {};
  try {
    const subData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
    if (subData.permissions) permissions = subData.permissions;
  } catch(e) {}
  // Fallback ancien système
  if (Object.keys(permissions).length === 0) {
    try { permissions = JSON.parse(localStorage.getItem('lcc_permissions') || '{}'); } catch(e) {}
  }
  
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

  // Assurer la compatibilité avec les anciens scripts
  if (isSubAccountNew && !isSubAccountOld) {
    localStorage.setItem('lcc_account_type', 'sub');
  }

  // Déterminer la page courante (déclaré tôt pour les vérifications suivantes)
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  // Bloquer settings et support pour tous les sous-comptes
  if (BLOCKED_PAGES.includes(currentPage)) {
    console.log('🚫 Page bloquée pour les sous-comptes:', currentPage);
    window.location.href = '/app.html';
    return;
  }
  
  // Sous-compte → vérifier permissions
  console.log('🔍 Sous-compte détecté - Vérification permissions');
  console.log('Permissions:', permissions);
  
  window.isSubAccount = true;
  window.permissions = permissions;
  
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
      window.location.href = '/app.html';
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
        // Ne pas masquer les boutons de nav mobile
        if (btn.closest('.mobile-nav') || btn.closest('.tab-bar') || btn.classList.contains('tab-btn') || btn.id === 'mobileMenuBtn') {
          return;
        }
        
        btn.style.display = 'none';
        console.log('  → Masqué:', btn.id || btn.textContent.trim().substring(0, 30));
      });
      
    } else {
      console.log('✅ Permissions d\'édition - Tous les boutons visibles');
    }
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

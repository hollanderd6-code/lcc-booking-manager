// ============================================
// 📱 GESTION DES ONGLETS MOBILES
// À inclure sur toutes les pages de l'app
// ============================================

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION DES ROUTES
  // ============================================
  
  const _isSubForRoutes = (localStorage.getItem('lcc_account_type') === 'sub');

  const ROUTES = {
    dashboard: _isSubForRoutes ? '/app-simple-subaccount.html' : '/app.html',
    calendar: _isSubForRoutes ? '/app-simple-subaccount.html?scroll=calendar' : '/app.html#calendar',
    messages: '/messages.html',
    'smart-locks': '/smart-locks.html',
    properties: '/settings.html',
    more: 'bottomsheet'
  };

  // ============================================
  // ✅ PERMISSIONS - même logique que bh-layout.js
  // ============================================

  const accountType = localStorage.getItem('lcc_account_type');
  const isSubAccount = (accountType === 'sub');
  let permissions = {};
  if (isSubAccount) {
    try {
      const permData = localStorage.getItem('lcc_permissions');
      if (permData) permissions = JSON.parse(permData);
    } catch (e) {}
  }

  const hasPermission = (perm) => {
    if (!isSubAccount) return true;
    return permissions[perm] === true;
  };

  // ============================================
  // ✅ GÉNÉRATION DYNAMIQUE DU MENU SELON PERMISSIONS
  // ============================================

  function getMoreMenuButtons() {
    let buttons = '';

    // Paramètres — compte principal uniquement
    if (!isSubAccount) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/settings-account.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-user-cog"></i> Paramètres du compte
        </button>`;
    }

    // Serrures connectées
    if (hasPermission('can_view_smart_locks') || hasPermission('can_manage_smart_locks')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/smart-locks.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-lock"></i> Serrures connectées
        </button>`;
    }

    buttons += `<hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color, #e5e7eb);">`;

    // Ménages
    if (hasPermission('can_view_cleaning') || hasPermission('can_manage_cleaning')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/cleaning.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-broom"></i> Ménages
        </button>
        <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color, #e5e7eb);">`;
    }

    // Cautions
    if (hasPermission('can_view_deposits') || hasPermission('can_manage_deposits')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/deposits.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-shield-alt"></i> Cautions
        </button>`;
    }

    // Factures
    if (hasPermission('can_view_invoices') || hasPermission('can_manage_invoices')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/factures.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-file-invoice"></i> Factures
        </button>
        <button class="btn btn-secondary" onclick="window.location.href='/factures-proprietaires.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-file-invoice-dollar"></i> Factures propriétaires
        </button>`;
    }

    buttons += `<hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color, #e5e7eb);">`;

    // Livrets d'accueil
    if (hasPermission('can_view_properties')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/welcome.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-book-open"></i> Livrets d'accueil
        </button>`;
    }

    // Aide — compte principal uniquement
    if (!isSubAccount) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/help.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-question-circle"></i> Aide
        </button>`;
    }

    buttons += `
      <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color, #e5e7eb);">
      <button class="btn btn-danger" onclick="confirmLogout()" style="width: 100%; justify-content: flex-start;">
        <i class="fas fa-sign-out-alt"></i> Déconnexion
      </button>`;

    return buttons;
  }

  // ============================================
  // ✅ DÉTECTION DE LA PAGE ACTIVE - CORRIGÉE
  // ============================================
  
  const currentPath = window.location.pathname;
  const dataPage = document.body.getAttribute('data-page'); // ✅ Lire data-page du body
  let activeTab = 'dashboard';

  // ✅ Pages du menu "Plus" (détection prioritaire)
  const PLUS_PAGES = [
    'smart-locks',
    'settings-account', 
    'cleaning',
    'deposits',
    'factures',
    'factures-proprietaires',
    'welcome',
    'help'
  ];

  // ✅ Vérifier data-page="settings" en priorité
  if (dataPage === 'settings') {
    // settings.html (Mes logements) → Onglet Logements
    activeTab = 'properties';
  } else if (dataPage && PLUS_PAGES.includes(dataPage)) {
    // Pages du menu Plus → Onglet Plus
    activeTab = 'more';
  } else if (currentPath.includes('messages')) {
    activeTab = 'messages';
  } else if (currentPath.includes('settings')) {
    // Fallback pour /settings.html sans data-page
    activeTab = 'properties';
  } else if (currentPath.includes('app')) {
    activeTab = 'dashboard';
  }

  // ============================================
  // ÉCOUTER LES CHANGEMENTS D'ONGLET
  // ============================================
  
  document.addEventListener('tabChanged', (e) => {
    const tab = e.detail.tab;
    console.log('Navigation vers:', tab);
    
    if (ROUTES[tab] === 'bottomsheet') {
      showMoreMenu();
    } else if (ROUTES[tab]) {
      window.location.href = ROUTES[tab];
    }
  });

  // ============================================
  // MENU "PLUS" - FILTRÉ PAR PERMISSIONS
  // ============================================
  
  function showMoreMenu() {
    const menuButtons = getMoreMenuButtons();

    // Si window.mobileApp existe, utiliser le bottom sheet natif
    if (window.mobileApp && window.mobileApp.createBottomSheet) {
      window.mobileApp.createBottomSheet({
        title: '⚙️ Menu',
        content: `
          <div style="display: flex; flex-direction: column; gap: 12px; padding: 8px 0;">
            ${menuButtons}
          </div>
        `,
        height: '80%'
      });
      return;
    }
    
    // Fallback : Si mobileApp n'existe pas, utiliser un menu custom
    console.log('⚠️ window.mobileApp non disponible, utilisation du fallback');
    
    // Créer ou récupérer l'overlay
    let overlay = document.getElementById('moreMenuOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'moreMenuOverlay';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:none;';
      overlay.onclick = () => closeMoreMenu();
      document.body.appendChild(overlay);
    }
    
    // Créer ou récupérer le bottom sheet
    let sheet = document.getElementById('moreMenuSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'moreMenuSheet';
      sheet.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#F5F0E8;border-radius:20px 20px 0 0;padding:20px;max-height:80vh;overflow-y:auto;z-index:10000;transform:translateY(100%);transition:transform 0.3s ease;';
      document.body.appendChild(sheet);
    }

    // Regénérer le contenu à chaque ouverture
    sheet.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:18px;font-weight:700;"><i class="fas fa-cog"></i> Menu</h3>
        <button onclick="closeMoreMenu()" style="background:none;border:none;font-size:24px;cursor:pointer;padding:0;width:32px;height:32px;">&times;</button>
      </div>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${menuButtons}
      </div>
    `;
    
    // Afficher le menu
    overlay.style.display = 'block';
    setTimeout(() => {
      sheet.style.transform = 'translateY(0)';
    }, 10);
  }
  
  window.closeMoreMenu = function() {
    const overlay = document.getElementById('moreMenuOverlay');
    const sheet = document.getElementById('moreMenuSheet');
    if (sheet) sheet.style.transform = 'translateY(100%)';
    setTimeout(() => {
      if (overlay) overlay.style.display = 'none';
    }, 300);
  };

  // ============================================
  // FONCTIONS UTILITAIRES
  // ============================================

  window.confirmLogout = function() {
    if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
      localStorage.removeItem('lcc_token');
      localStorage.removeItem('lcc_user');
      localStorage.removeItem('lcc_account_type');
      localStorage.removeItem('lcc_permissions');
      window.location.href = '/login.html';
    }
  };

  // ============================================
  // METTRE L'ONGLET ACTIF AU CHARGEMENT
  // ============================================
  
  function setActiveTab() {
    // Attendre que les onglets soient créés
    setTimeout(() => {
      const tabs = document.querySelectorAll('.tab-btn');
      tabs.forEach(tab => {
        const tabId = tab.dataset.tab;
        if (tabId === activeTab) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });
    }, 100);
  }

  // Initialiser
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setActiveTab);
  } else {
    setActiveTab();
  }

  console.log('✅ Gestion des onglets mobile initialisée (page:', activeTab, ')');

})();

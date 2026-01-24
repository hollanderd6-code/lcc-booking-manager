// ============================================
// 📱 GESTION DES ONGLETS MOBILES
// À inclure sur toutes les pages de l'app
// ============================================

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION DES ROUTES
  // ============================================
  
  const ROUTES = {
    dashboard: '/app.html',
    calendar: '/app.html#calendar',
    messages: '/messages.html',
    properties: '/settings.html',  // Logements
    more: 'bottomsheet'
  };

  // ============================================
  // ✅ DÉTECTION DE LA PAGE ACTIVE - CORRIGÉE
  // ============================================
  
  const currentPath = window.location.pathname;
  const dataPage = document.body.getAttribute('data-page'); // ✅ Lire data-page du body
  let activeTab = 'dashboard';

  // ✅ Pages du menu "Plus" (détection prioritaire)
  const PLUS_PAGES = [
    'notifications',
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
  // MENU "PLUS" - TOUS LES BOUTONS EN SECONDAIRE
  // ============================================
  
  function showMoreMenu() {
    if (!window.mobileApp) return;
    
    window.mobileApp.createBottomSheet({
      title: '⚙️ Menu',
      content: `
        <div style="display: flex; flex-direction: column; gap: 12px; padding: 8px 0;">
          
          <button class="btn btn-secondary" onclick="window.location.href='/settings-account.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-user-cog"></i> Paramètres du compte
          </button>
          
          <button class="btn btn-secondary" onclick="window.location.href='/notifications.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-bell"></i> Notifications
          </button>
          
          <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color);">
          
          <button class="btn btn-secondary" onclick="window.location.href='/cleaning.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-broom"></i> Ménages
          </button>
          
          <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color);">
          
          <button class="btn btn-secondary" onclick="window.location.href='/deposits.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-shield-alt"></i> Cautions
          </button>
          
          <button class="btn btn-secondary" onclick="window.location.href='/factures.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-file-invoice"></i> Factures
          </button>
          
          <button class="btn btn-secondary" onclick="window.location.href='/factures-proprietaires.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-file-invoice-dollar"></i> Factures propriétaires
          </button>
          
          <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color);">
          
          <button class="btn btn-secondary" onclick="window.location.href='/welcome.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-book-open"></i> Livrets d'accueil
          </button>
          
          <button class="btn btn-secondary" onclick="window.location.href='/help.html'" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-question-circle"></i> Aide
          </button>
          
          <hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color);">
          
          <button class="btn btn-danger" onclick="confirmLogout()" style="width: 100%; justify-content: flex-start;">
            <i class="fas fa-sign-out-alt"></i> Déconnexion
          </button>
          
        </div>
      `,
      height: '80%'
    });
  }

  // ============================================
  // FONCTIONS UTILITAIRES
  // ============================================

  window.confirmLogout = function() {
    if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
      localStorage.removeItem('lcc_token');
      localStorage.removeItem('lcc_user');
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

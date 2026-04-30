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
    dashboard: '/app.html',
    calendar: '/app.html#calendar',
    messages: '/messages.html',
    'smart-locks': '/smart-locks.html',
    properties: '/settings.html',
    more: 'bottomsheet'
  };

  // ============================================
  // ✅ PERMISSIONS - même logique que bh-layout.js
  // ============================================

  const isSubAccount = localStorage.getItem('lcc_is_sub_account') === 'true'
                    || localStorage.getItem('lcc_account_type') === 'sub';

  let role = 'main';
  let permissions = {};

  if (isSubAccount) {
    try {
      const subData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
      role = subData.role || 'custom';
      if (subData.permissions) permissions = subData.permissions;
    } catch(e) {}
    try {
      const permData = localStorage.getItem('lcc_permissions');
      if (permData) permissions = Object.assign(JSON.parse(permData), permissions);
    } catch(e) {}
    try {
      if (role === 'main' || role === 'custom') {
        const u = JSON.parse(localStorage.getItem('lcc_user') || '{}');
        if (u.role) role = u.role;
      }
    } catch(e) {}
  }

  const ROLE_PAGES = {
    cleaner:      ['calendar', 'cleaning'],
    proprietaire: ['dashboard', 'calendar', 'messages', 'settings', 'welcome', 'cleaning', 'deposits', 'factures', 'clients', 'reporting'],
    manager:      ['dashboard', 'calendar', 'messages', 'settings', 'welcome', 'contrat', 'cleaning', 'deposits', 'factures', 'clients'],
    comptable:    ['factures', 'clients', 'reporting'],
    custom:       null
  };

  const allowedPages = isSubAccount ? (ROLE_PAGES[role] || null) : null;

  const canSeePage = (page) => {
    if (!isSubAccount) return true;
    if (allowedPages) return allowedPages.includes(page);
    const permMap = {
      dashboard: 'can_view_reservations', calendar: 'can_view_reservations',
      messages: 'can_view_messages', settings: 'can_view_properties',
      welcome: 'can_view_properties', contrat: 'can_view_contracts',
      cleaning: 'can_view_cleaning', deposits: 'can_view_deposits',
      factures: 'can_view_invoices', clients: 'can_view_invoices',
      reporting: 'can_view_reporting',
    };
    const perm = permMap[page];
    return perm ? permissions[perm] === true : false;
  };

  // ============================================
  // ✅ GÉNÉRATION DYNAMIQUE DU MENU SELON PERMISSIONS
  // ============================================

  function getMoreMenuButtons() {
    const hr = `<hr style="margin: 8px 0; border: none; border-top: 1px solid var(--border-color, #e5e7eb);">`;
    let buttons = '';

    if (canSeePage('welcome')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/welcome.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-book-open"></i> Livrets d'accueil
        </button>`;
    }
    if (canSeePage('contrat')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/contrat.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-file-contract"></i> Contrats
        </button>`;
    }
    if (canSeePage('cleaning')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/cleaning.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-broom"></i> Ménages
        </button>`;
    }

    buttons += hr;

    if (canSeePage('deposits')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/deposits.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-wallet"></i> Finances
        </button>`;
    }
    if (canSeePage('factures')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/factures.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-file-invoice"></i> Factures séjours
        </button>
        <button class="btn btn-secondary" onclick="window.location.href='/clients.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-users"></i> Mes Clients
        </button>`;
    }
    if (canSeePage('reporting')) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/reporting.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-chart-bar"></i> Revenus
        </button>`;
    }

    buttons += hr;

    if (!isSubAccount) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/dynamic-pricing.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-bolt" style="color:#B45309;"></i> Prix dynamique
          <span style="margin-left:auto;font-size:10px;font-weight:700;background:rgba(245,158,11,.15);color:#B45309;border:1px solid rgba(245,158,11,.3);padding:1px 7px;border-radius:20px;">Bêta</span>
        </button>`;
      buttons += hr;
    }

    buttons += `
      <button class="btn btn-secondary" disabled style="width: 100%; justify-content: flex-start; opacity: 0.45; cursor: default; pointer-events: none;">
        <i class="fas fa-lock"></i> Serrures connectées
        <span style="margin-left:auto;font-size:10px;font-weight:700;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:2px 7px;border-radius:20px;opacity:1;">Bientôt</span>
      </button>`;

    buttons += hr;

    if (!isSubAccount) {
      buttons += `
        <button class="btn btn-secondary" onclick="window.location.href='/settings-account.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-user-cog"></i> Paramètres du compte
        </button>
        <button class="btn btn-secondary" onclick="window.location.href='/help.html'" style="width: 100%; justify-content: flex-start;">
          <i class="fas fa-headset"></i> Support
        </button>`;
    }

    buttons += `
      ${hr}
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
    'clients',
    'reporting',
    'welcome',
    'contrat',
    'help',
    'pricing',           // Dynamic Pricing
    'dynamic-pricing',   // fallback
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
  
  async function showMoreMenu() {
    const menuButtons = getMoreMenuButtons();

    // Lire depuis localStorage
    let user = JSON.parse(localStorage.getItem('lcc_user') || '{}');
    // Nouveau système sous-compte — priorité sur lcc_user
    const subAccountData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
    if (subAccountData.firstName) user = { ...user, ...subAccountData };

    // Si pas de logoUrl, refetch depuis l'API (fix iOS Capacitor)
    if (!user.logoUrl) {
      try {
        const token = localStorage.getItem('lcc_token');
        const res = await fetch('/api/user/profile', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const fresh = await res.json();
          user = { ...user, ...fresh };
          localStorage.setItem('lcc_user', JSON.stringify(user));
        }
      } catch(e) {
        console.warn('Impossible de rafraîchir le profil:', e);
      }
    }

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Mon compte';
    const userCompany = user.company || '';
    const logoUrl = user.logoUrl;
    const logoSrc = logoUrl && logoUrl.includes('cloudinary.com')
      ? logoUrl.replace('/upload/', '/upload/w_80,h_80,c_fit,q_auto,f_png/')
      : logoUrl;
    const avatarHtml = logoSrc
      ? `<div style="width:38px;height:38px;min-width:38px;border-radius:8px;background:white url('${logoSrc}') center/65% no-repeat;border:1px solid rgba(200,184,154,.4);flex-shrink:0;"></div>`
      : `<div style="width:38px;height:38px;min-width:38px;border-radius:50%;background:linear-gradient(135deg,#1A7A5E,#2AAE86);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;flex-shrink:0;">${(user.firstName || 'U').charAt(0).toUpperCase()}</div>`;

    // Si window.mobileApp existe, utiliser le bottom sheet natif
    if (window.mobileApp && window.mobileApp.createBottomSheet) {
      const titleHtml = `<div style="display:flex;align-items:center;gap:10px;">${avatarHtml}<div><div style="font-size:14px;font-weight:700;color:#0D1117;">${userName}</div>${userCompany ? `<div style="font-size:12px;color:#7A8695;">${userCompany}</div>` : ''}</div></div>`;

      window.mobileApp.createBottomSheet({
        title: titleHtml,
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
        <div style="display:flex;align-items:center;gap:10px;">
          ${avatarHtml}
          <div>
            <div style="font-size:14px;font-weight:700;color:#0D1117;line-height:1.3;">${userName}</div>
            ${userCompany ? `<div style="font-size:12px;color:#7A8695;line-height:1.3;">${userCompany}</div>` : ''}
          </div>
        </div>
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

  window.confirmLogout = async function() {
    const ok = await bhConfirm(
      'Déconnexion',
      'Êtes-vous sûr de vouloir vous déconnecter ?',
      'Déconnecter',
      'Annuler',
      'danger'
    );
    if (ok) {
      localStorage.removeItem('lcc_token');
      localStorage.removeItem('lcc_user');
      localStorage.removeItem('lcc_account_type');
      localStorage.removeItem('lcc_permissions');
      localStorage.removeItem('lcc_is_sub_account');
      localStorage.removeItem('lcc_sub_account');
      window.location.href = '/login.html';
    }
  };

  // Masquer les onglets du bas selon le rôle
  function applyMobileTabRestrictions() {
    if (!isSubAccount) return;
    setTimeout(() => {
      const tabs = document.querySelectorAll('.tab-btn[data-tab]');
      tabs.forEach(tab => {
        const t = tab.dataset.tab;
        if (t === 'dashboard' && !canSeePage('dashboard')) tab.style.display = 'none';
        if (t === 'messages'  && !canSeePage('messages'))  tab.style.display = 'none';
        if (t === 'properties'&& !canSeePage('settings'))  tab.style.display = 'none';
        if (t === 'calendar'  && !canSeePage('calendar'))  tab.style.display = 'none';
      });
    }, 150);
  }

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
    document.addEventListener('DOMContentLoaded', () => { setActiveTab(); applyMobileTabRestrictions(); });
  } else {
    setActiveTab();
    applyMobileTabRestrictions();
  }

  console.log('✅ Gestion des onglets mobile initialisée (page:', activeTab, ')');

})();

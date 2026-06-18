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
    calendar: '/reservations.html',
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
    if (page === 'dashboard') return true;
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
    var V3 = document.documentElement.getAttribute('data-theme-v3') === '1';
    const hr = `<hr style="margin: 8px 4px; border: none; border-top: 1px solid rgba(0,0,0,0.06);">`;

    // Icônes Lucide colorées (Option 1)
    var IC = {
      dashboard:  { c:'#1A7A5E', p:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>' },
      welcome:    { c:'#1A7A5E', p:'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
      contrat:    { c:'#3B82F6', p:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
      cleaning:   { c:'#06B6D4', p:'<path d="M19 11V4a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v7"/><path d="M5 11l1.5-7h11L19 11"/><path d="M3 11h18v2a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/>' },
      finances:   { c:'#10B981', p:'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
      factures:   { c:'#8B5CF6', p:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>' },
      clients:    { c:'#EC4899', p:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' },
      reporting:  { c:'#0EA5E9', p:'<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
      pricing:    { c:'#F59E0B', p:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
      locks:      { c:'#64748B', p:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' },
      settings:   { c:'#475569', p:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
      support:    { c:'#14B8A6', p:'<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>' }
    };

    function lucideSvg(key) {
      var i = IC[key];
      if (!i) return '';
      return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="' + i.c + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">' + i.p + '</svg>';
    }

    // Génère un item de menu (style Option 1 : icône colorée + texte)
    function item(key, label, onclick, extra) {
      var icon = V3 ? lucideSvg(key) : '<i class="fas fa-circle" style="color:' + (IC[key] ? IC[key].c : '#888') + ';"></i>';
      return '<button class="btn btn-secondary bh-more-item" data-menu-key="' + key + '" onclick="' + onclick + '" style="width:100%;justify-content:flex-start;gap:12px;">'
        + icon + '<span style="flex:1;text-align:left;">' + label + '</span>' + (extra || '') + '</button>';
    }

    let buttons = '';

    if (isSubAccount) {
      buttons += item('dashboard', 'Dashboard', "window.location.href='/app.html'");
      buttons += hr;
    }

    if (canSeePage('welcome'))  buttons += item('welcome', "Livrets d'accueil", "window.location.href='/welcome.html'");
    if (canSeePage('contrat'))  buttons += item('contrat', 'Contrats', "window.location.href='/contrat.html'");
    if (canSeePage('cleaning')) buttons += item('cleaning', 'Ménages', "window.location.href='/cleaning.html'");

    buttons += hr;

    if (canSeePage('deposits')) buttons += item('finances', 'Finances', "window.location.href='/deposits.html'");
    if (canSeePage('factures')) {
      buttons += item('factures', 'Factures séjours', "window.location.href='/factures.html'");
      buttons += item('clients', 'Mes Clients', "window.location.href='/clients.html'");
    }
    if (canSeePage('reporting')) buttons += item('reporting', 'Revenus', "window.location.href='/reporting.html'");

    buttons += hr;

    if (!isSubAccount) {
      var betaBadge = '<span style="margin-left:auto;font-size:10px;font-weight:700;background:rgba(245,158,11,.15);color:#B45309;border:1px solid rgba(245,158,11,.3);padding:1px 7px;border-radius:20px;">Bêta</span>';
      buttons += item('pricing', 'BoostPrice', "window.location.href='/dynamic-pricing.html'", betaBadge);
      buttons += hr;
    }

    buttons += item('locks', 'Serrures connectées', "window.location.href='/smart-locks.html'");

    buttons += hr;

    if (!isSubAccount) {
      const agencyExit = `if(localStorage.getItem('lcc_managed_user')){var o=localStorage.getItem('lcc_agency_token');if(o){localStorage.setItem('lcc_token',o);['lcc_agency_token','lcc_managed_user','lcc_settings_profile','lcc_properties_cache'].forEach(function(k){localStorage.removeItem(k)});window.location.href='`;
      buttons += item('settings', 'Paramètres du compte', `${agencyExit}/settings-account.html';}return;}window.location.href='/settings-account.html'`);
      buttons += item('support', 'Support', `${agencyExit}/help.html';}return;}window.location.href='/help.html'`);
    }

    buttons += `
      ${hr}
      <button class="btn btn-danger bh-more-item" onclick="confirmLogout()" style="width: 100%; justify-content: flex-start; gap:12px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span style="flex:1;text-align:left;">Déconnexion</span>
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
  } else if (currentPath.includes('reservations')) {
    activeTab = 'calendar';
  } else if (currentPath.includes('settings')) {
    // Fallback pour /settings.html sans data-page
    activeTab = 'properties';
  } else if (currentPath.includes('app')) {
    activeTab = 'dashboard';
  }

  // Exposé pour que la barre d'onglets démarre DIRECTEMENT sur le bon onglet.
  // Sans ça, la barre se crée avec Dashboard actif puis la capsule glass glisse
  // visiblement vers le vrai onglet à chaque arrivée de page.
  try { window.__bhActiveTab = activeTab; } catch (e) {}

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
  
  // Récupère le profil en arrière-plan et met à jour l'avatar déjà affiché,
  // sans bloquer l'ouverture du menu. Le résultat est mis en cache (localStorage)
  // donc dès la 2e ouverture le logo est instantané.
  async function _bhRefreshMenuAvatarBg() {
    try {
      const token = localStorage.getItem('lcc_token');
      const res = await fetch('/api/user/profile', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;
      const fresh = await res.json();
      const merged = { ...JSON.parse(localStorage.getItem('lcc_user') || '{}'), ...fresh };
      localStorage.setItem('lcc_user', JSON.stringify(merged));
      if (!fresh.logoUrl) return;
      const src = fresh.logoUrl.includes('cloudinary.com')
        ? fresh.logoUrl.replace('/upload/', '/upload/w_80,h_80,c_fit,q_auto,f_png/')
        : fresh.logoUrl;
      document.querySelectorAll('#bhMenuAvatar').forEach(function(el) {
        el.textContent = '';
        el.style.background = "white url('" + src + "') center/65% no-repeat";
        el.style.backgroundSize = '65%';
        el.style.borderRadius = '8px';
        el.style.border = '1px solid rgba(200,184,154,.4)';
      });
    } catch(e) {
      console.warn('Refresh logo arrière-plan échoué:', e);
    }
  }

  async function showMoreMenu() {
    const menuButtons = getMoreMenuButtons();

    // Lire depuis localStorage
    let user = JSON.parse(localStorage.getItem('lcc_user') || '{}');
    // Nouveau système sous-compte — priorité sur lcc_user
    const subAccountData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
    if (subAccountData.firstName) user = { ...user, ...subAccountData };

    // ⚡ Plus de fetch bloquant ici : le menu s'ouvre INSTANTANÉMENT.
    // Si le logo manque (cas iOS Capacitor), on le récupère en arrière-plan
    // (_bhRefreshMenuAvatarBg) et on met à jour l'avatar #bhMenuAvatar une fois
    // l'image arrivée, sans jamais retarder l'affichage du menu.
    const _needsLogo = !user.logoUrl;

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Mon compte';
    const userCompany = user.company || '';
    const logoUrl = user.logoUrl;
    const logoSrc = logoUrl && logoUrl.includes('cloudinary.com')
      ? logoUrl.replace('/upload/', '/upload/w_80,h_80,c_fit,q_auto,f_png/')
      : logoUrl;
    const avatarHtml = logoSrc
      ? `<div id="bhMenuAvatar" style="width:38px;height:38px;min-width:38px;border-radius:8px;background:white url('${logoSrc}') center/65% no-repeat;border:1px solid rgba(200,184,154,.4);flex-shrink:0;"></div>`
      : `<div id="bhMenuAvatar" style="width:38px;height:38px;min-width:38px;border-radius:50%;background:linear-gradient(135deg,#1A7A5E,#2AAE86);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700;flex-shrink:0;">${(user.firstName || 'U').charAt(0).toUpperCase()}</div>`;

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
      if (_needsLogo) setTimeout(_bhRefreshMenuAvatarBg, 0);
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
      sheet.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#F5F0E8;border-radius:20px 20px 0 0;padding:20px 20px calc(80px + env(safe-area-inset-bottom, 20px));max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;z-index:10000;transform:translateY(100%);transition:transform 0.3s ease;';
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
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    setTimeout(() => {
      sheet.style.transform = 'translateY(0)';
    }, 10);

    if (_needsLogo) setTimeout(_bhRefreshMenuAvatarBg, 0);

    // Mettre en valeur l'item de la page courante (Option 1 : fond teinté + texte coloré)
    setTimeout(function() {
      var page = document.body.getAttribute('data-page') || '';
      var pageToKey = {
        'welcome':'welcome','livrets':'welcome','contrat':'contrat','cleaning':'cleaning',
        'deposits':'finances','factures':'factures','clients':'clients','reporting':'reporting',
        'dynamic-pricing':'pricing','smart-locks':'locks','smart_locks':'locks',
        'settings-account':'settings','notifications':'settings','help':'support'
      };
      var activeKey = pageToKey[page];
      if (!activeKey) return;
      var IC_COLORS = { welcome:'#1A7A5E',contrat:'#3B82F6',cleaning:'#06B6D4',finances:'#10B981',factures:'#8B5CF6',clients:'#EC4899',reporting:'#0EA5E9',pricing:'#F59E0B',locks:'#64748B',settings:'#475569',support:'#14B8A6' };
      var el = sheet.querySelector('.bh-more-item[data-menu-key="' + activeKey + '"]');
      if (el) {
        var col = IC_COLORS[activeKey] || '#1A7A5E';
        el.style.background = col + '1A'; // ~10% opacity
        el.style.borderColor = 'transparent';
        var label = el.querySelector('span');
        if (label) { label.style.color = col; label.style.fontWeight = '700'; }
      }
    }, 50);
  }
  
  window.closeMoreMenu = function() {
    const overlay = document.getElementById('moreMenuOverlay');
    const sheet = document.getElementById('moreMenuSheet');
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
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
    setTimeout(() => {
      const tabs = document.querySelectorAll('.tab-btn');
      const container = document.querySelector('.mobile-tabs');
      tabs.forEach(tab => {
        const tabId = tab.dataset.tab;
        if (tabId === activeTab) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });
      if (window._bhUpdateLucideActive) window._bhUpdateLucideActive();

      // ── Liquid Glass : sliding pill ──
      // DÉSACTIVÉ : bh-layout.js gère la vraie capsule (.lg-capsule) en transform
      // GPU. Cet ancien pill (.glass-pill-mobile) est de toute façon masqué par
      // bh-layout (display:none!important) et ne faisait que du travail inutile à
      // chaque chargement : création d'un élément backdrop-filter caché, lectures
      // getBoundingClientRect en boucle, et un listener click par onglet. Tout ça
      // tournait sur le main-thread pile au moment où la page doit s'afficher.
      return;
      if (document.documentElement.getAttribute('data-theme-v3') !== '1') return;
      if (!container || !tabs.length) return;

      var TRANSITION = 'left 0.5s cubic-bezier(0.34,1.56,0.64,1),top 0.3s ease,width 0.35s ease,height 0.35s ease';

      var pill = container.querySelector('.glass-pill-mobile');
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'glass-pill-mobile';
        pill.style.cssText = [
          'position:absolute',
          'pointer-events:none',
          'z-index:0',
          'border-radius:16px',
          'background:rgba(26,122,94,0.10)',
          'backdrop-filter:blur(20px) saturate(180%)',
          '-webkit-backdrop-filter:blur(20px) saturate(180%)',
          'border:1.5px solid rgba(26,122,94,0.20)',
          'box-shadow:0 2px 12px rgba(26,122,94,0.12),inset 0 1px 0 rgba(255,255,255,0.5)',
          'opacity:1',
          'transition:none'
        ].join(';');
        container.appendChild(pill);
      }

      var activeEl = container.querySelector('.tab-btn.active');
      if (!activeEl) return;

      var allTabs = Array.from(tabs);
      var activeIdx = allTabs.indexOf(activeEl);
      var prevIdx = parseInt(sessionStorage.getItem('_glassPillIdx') || '-1');

      function getPos(el) {
        var cr = container.getBoundingClientRect();
        var er = el.getBoundingClientRect();
        // Réduire la hauteur de 6px en haut et en bas pour que l'icône ne dépasse pas
        return {
          left: er.left - cr.left + 4,
          top: er.top - cr.top + 2,
          width: er.width - 8,
          height: er.height - 4
        };
      }

      function applyPos(pos) {
        pill.style.left = pos.left + 'px';
        pill.style.top = pos.top + 'px';
        pill.style.width = pos.width + 'px';
        pill.style.height = pos.height + 'px';
      }

      var activePos = getPos(activeEl);

      if (prevIdx >= 0 && prevIdx !== activeIdx && allTabs[prevIdx]) {
        // 1. Placer sur l'ancien tab SANS transition
        pill.style.transition = 'none';
        applyPos(getPos(allTabs[prevIdx]));
        // 2. Forcer le navigateur à peindre cette position
        pill.getBoundingClientRect();
        // 3. Activer la transition et glisser vers le nouveau tab
        setTimeout(function() {
          pill.style.transition = TRANSITION;
          applyPos(activePos);
        }, 50);
      } else {
        pill.style.transition = 'none';
        applyPos(activePos);
      }

      // Au clic, stocker l'index et animer vers le tab cliqué
      allTabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
          sessionStorage.setItem('_glassPillIdx', String(activeIdx));
          pill.style.transition = TRANSITION;
          applyPos(getPos(tab));
        }, { once: true });
      });
    }, 50); // était 200ms — la capsule se positionne plus vite au chargement
  }

  // ============================================
  // 🎨 LIQUID GLASS v4 — Icônes Lucide colorées
  // ============================================
  var LUCIDE_TABS = {
    dashboard: { color: '#1A7A5E', svg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    calendar:  { color: '#3B82F6', svg: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    messages:  { color: '#6366F1', svg: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>' },
    properties:{ color: '#F59E0B', svg: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/>' },
    more:      { color: '#64748B', svg: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>' }
  };

  function applyLucideIcons() {
    if (document.documentElement.getAttribute('data-theme-v3') !== '1') return;
    var tabs = document.querySelectorAll('.mobile-tabs .tab-btn[data-tab]');
    tabs.forEach(function(tab) {
      var id = tab.dataset.tab;
      var cfg = LUCIDE_TABS[id];
      if (!cfg) return;
      if (tab.querySelector('svg.lucide-tab')) return; // déjà fait

      var iconEl = tab.querySelector('i');
      var isActive = tab.classList.contains('active');
      var svg = '<svg class="lucide-tab" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + cfg.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:' + (isActive ? '1' : '0.55') + ';transition:opacity .25s ease;">' + cfg.svg + '</svg>';

      if (iconEl) {
        iconEl.outerHTML = svg;
      } else {
        tab.insertAdjacentHTML('afterbegin', svg);
      }
      // Couleur du label
      var span = tab.querySelector('span');
      if (span) {
        span.style.color = cfg.color;
        span.style.opacity = isActive ? '1' : '0.55';
        span.style.fontWeight = isActive ? '700' : '500';
        span.style.transition = 'opacity .25s ease';
      }
    });
  }

  function updateLucideActive() {
    if (document.documentElement.getAttribute('data-theme-v3') !== '1') return;
    document.querySelectorAll('.mobile-tabs .tab-btn[data-tab]').forEach(function(tab) {
      var svg = tab.querySelector('svg.lucide-tab');
      var span = tab.querySelector('span');
      var isActive = tab.classList.contains('active');
      if (svg) svg.style.opacity = isActive ? '1' : '0.55';
      if (span) {
        span.style.opacity = isActive ? '1' : '0.55';
        span.style.fontWeight = isActive ? '700' : '500';
      }
    });
  }
  window._bhUpdateLucideActive = updateLucideActive;

  // Initialiser
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { setActiveTab(); applyMobileTabRestrictions(); setTimeout(applyLucideIcons, 100); });
  } else {
    setActiveTab();
    applyMobileTabRestrictions();
    setTimeout(applyLucideIcons, 100);
  }

  // ============================================
  // ⚡ PRÉCHARGEMENT DES PAGES (perf navigation)
  // Au moindre contact sur un onglet, on réchauffe la page de destination dans
  // le cache → l'attente réseau ne bloque plus au moment du tap. En complément,
  // on précharge les autres onglets en tâche de fond quand le device est au repos.
  // NB : ceci accélère le RÉSEAU. Le re-rendu / les appels API de la page d'arrivée
  // restent ; pour du vraiment instantané il faudra le shell SPA (étape suivante).
  // ============================================
  (function setupPrefetch() {
    if (!('fetch' in window)) return;
    var done = {};

    function warm(url) {
      if (!url || url === 'bottomsheet' || done[url]) return;
      if (url === window.location.pathname) return;
      done[url] = true;
      try {
        var link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'document';
        link.href = url;
        document.head.appendChild(link);
      } catch (e) {}
      try { fetch(url, { credentials: 'same-origin' }).catch(function () {}); } catch (e) {}
    }

    function onContact(e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest('.tab-btn[data-tab]') : null;
      if (!btn) return;
      warm(ROUTES[btn.dataset.tab]);
    }
    document.addEventListener('pointerdown', onContact, { passive: true, capture: true });
    document.addEventListener('touchstart', onContact, { passive: true, capture: true });

    function warmAll() { Object.keys(ROUTES).forEach(function (k) { warm(ROUTES[k]); }); }
    if ('requestIdleCallback' in window) requestIdleCallback(warmAll, { timeout: 4000 });
    else setTimeout(warmAll, 2500);
  })();

  console.log('✅ Gestion des onglets mobile initialisée (page:', activeTab, ')');

})();

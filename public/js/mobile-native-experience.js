// ============================================
// 📱 BOOSTINGHOST - EXPÉRIENCE MOBILE NATIVE
// Version compatible Capacitor + Web
// ============================================

(function() {
  'use strict';

  // ============================================
  // DÉTECTION CAPACITOR
  // ============================================
  
  const isCapacitor = window.Capacitor !== undefined;
  const isNative = isCapacitor && window.Capacitor.isNativePlatform();
  
  console.log('📱 Environnement:', isNative ? 'App Native' : 'Web Browser');

  // ============================================
  // CHARGEMENT DES PLUGINS CAPACITOR
  // ============================================
  
  let Haptics, StatusBar, SplashScreen;
  
  if (isCapacitor) {
    // Les plugins sont disponibles via window.Capacitor.Plugins
    const plugins = window.Capacitor.Plugins;
    Haptics = plugins.Haptics;
    StatusBar = plugins.StatusBar;
    SplashScreen = plugins.SplashScreen;
  }

  // ============================================
  // CLASSE PRINCIPALE
  // ============================================

  class MobileNativeExperience {
    constructor() {
      this.currentTab = 'dashboard';
      this.isDarkMode = false;
      this.isScrolling = false;
      this.pullRefreshThreshold = 80;
      
      this.init();
    }

    async init() {
      console.log('📱 Initialisation expérience mobile native...');
      
      // Attendre que le DOM soit prêt
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
      }
      
      // Configurer la status bar (app native seulement)
      await this.setupStatusBar();
      
      // Configurer le dark mode
      this.setupDarkMode();
      
      // Créer la navigation à onglets
      this.createTabNavigation();
      
      // Pull-to-refresh désactivé (géré nativement par iOS)
      // this.setupPullToRefresh();
      
      // Configurer les gestures
      this.setupSwipeGestures();
      
      // Configurer les haptics sur tous les boutons
      this.setupHapticFeedback();
      
      // Configurer les transitions de page
      this.setupPageTransitions();
      
      // Masquer le splash screen
      await this.hideSplashScreen();
      
      console.log('✅ Expérience mobile native prête !');
    }

    // ============================================
    // STATUS BAR NATIVE
    // ============================================

    async setupStatusBar() {
      if (!isNative || !StatusBar) return;
      
      try {
        await StatusBar.setStyle({ style: 'light' });
        await StatusBar.setBackgroundColor({ color: '#FFFFFF' });
        await StatusBar.show();
        console.log('✅ Status bar configurée');
      } catch (error) {
        console.log('⚠️ Status bar non disponible');
      }
    }

    // ============================================
    // DARK MODE AUTOMATIQUE
    // ============================================
    // ⚠️ DÉSACTIVÉ - Force toujours le mode clair
    // ============================================

    setupDarkMode() {
      // Ne plus détecter le thème système - forcer le mode clair
      this.isDarkMode = false;
      
      // Supprimer toute classe dark-mode existante
      document.body.classList.remove('dark-mode');
      document.documentElement.setAttribute('data-theme', 'light');
      
      // Configurer la status bar en mode clair
      if (isNative && StatusBar) {
        try {
          StatusBar.setStyle({ style: 'light' });
          StatusBar.setBackgroundColor({ color: '#FFFFFF' });
        } catch (e) {}
      }
      
      console.log('🎨 [THEME] Mode clair forcé (dark mode auto désactivé)');
    }

    // ============================================
    // NAVIGATION À ONGLETS (BOTTOM TABS)
    // ============================================

    createTabNavigation() {
      // Vérifier si la navigation existe déjà
      if (document.querySelector('.mobile-tabs')) {
        console.log('⚠️ Navigation déjà créée');
        return;
      }

      // ── Filtrage par permissions (même logique que bh-layout.js) ──
      // ⚠️ Ne PAS lire uniquement lcc_account_type / lcc_permissions : login.html
      // n'écrit que lcc_is_sub_account + lcc_sub_account, et sub-account-guard.js
      // pose lcc_account_type='sub' SANS jamais écrire lcc_permissions. Résultat :
      // _permissions restait vide → tous les onglets (dont Ménage) étaient masqués.
      const _isSubAccount = localStorage.getItem('lcc_is_sub_account') === 'true'
                         || localStorage.getItem('lcc_account_type') === 'sub';
      let _permissions = {};
      let _role = 'main';
      if (_isSubAccount) {
        // Nouveau système (prioritaire)
        try {
          const _sd = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
          if (_sd.role) _role = _sd.role;
          if (_sd.permissions) _permissions = _sd.permissions;
        } catch(e) {}
        // Fallback ancien système
        if (!Object.keys(_permissions).length) {
          try {
            const _pd = localStorage.getItem('lcc_permissions');
            if (_pd) _permissions = JSON.parse(_pd);
          } catch(e) {}
        }
      }

      // Rôles prédéfinis : liste de pages autorisées (identique à bh-layout.js
      // et mobile-tabs-handler.js). null = on retombe sur les permissions DB.
      const _ROLE_PAGES = {
        cleaner:      ['calendar', 'cleaning'],
        proprietaire: ['dashboard', 'calendar', 'messages', 'cleaning'],
        manager:      ['dashboard', 'calendar', 'messages', 'cleaning'],
        comptable:    [],
        custom:       null
      };
      const _allowedPages = _isSubAccount ? (_ROLE_PAGES[_role] || null) : null;

      const _hasPerm = (perm) => !_isSubAccount || _permissions[perm] === true;
      const _canSeeTab = (tabId, perm) => {
        if (!_isSubAccount) return true;
        if (tabId === 'dashboard') return true;
        if (_allowedPages) return _allowedPages.includes(tabId);
        return _hasPerm(perm);
      };

      // Onglets de base — toujours visibles si permission
      const allTabs = [
        { id: 'dashboard',   icon: 'fa-home',       label: 'Accueil',    perm: 'can_view_reservations' },
        { id: 'calendar',    icon: 'fa-calendar-check', label: 'Réservations', perm: 'can_view_reservations' },
        { id: 'messages',    icon: 'fa-comment',    label: 'Messages',   perm: 'can_view_messages', badge: 0 },
        { id: 'cleaning',    icon: 'fa-broom',      label: 'Ménage',     perm: 'can_view_cleaning' },
        { id: 'more',        icon: 'fa-ellipsis-h', label: 'Plus',       perm: null }
      ];

      // Filtrer selon rôle + permissions
      const tabs = allTabs.filter(tab => tab.perm === null || _canSeeTab(tab.id, tab.perm));

      // Onglet réellement actif pour la page courante (calculé par mobile-tabs-handler).
      // On démarre la barre dessus → la capsule glass se pose directement au bon
      // endroit, sans partir du Dashboard puis glisser. Fallback léger si indispo.
      let _activeTabId = window.__bhActiveTab;
      if (!_activeTabId) {
        const _p = window.location.pathname;
        const _dp = document.body.getAttribute('data-page');
        if (_p.includes('cleaning')) _activeTabId = 'cleaning';
        else if (_p.includes('messages')) _activeTabId = 'messages';
        else if (_p.includes('reservations')) _activeTabId = 'calendar';
        else if (_p.includes('app')) _activeTabId = 'dashboard';
        else _activeTabId = 'more';
      }

      const tabsContainer = document.createElement('div');
      tabsContainer.className = 'mobile-tabs';
      tabsContainer.innerHTML = tabs.map(tab => `
        <button class="tab-btn ${tab.id === _activeTabId ? 'active' : ''}" data-tab="${tab.id}">
          <i class="fas ${tab.icon}"></i>
          <span>${tab.label}</span>
          ${tab.badge !== undefined ? `<span class="badge" style="display: ${tab.badge > 0 ? 'flex' : 'none'}">${tab.badge}</span>` : ''}
        </button>
      `).join('');

      document.body.appendChild(tabsContainer);

      // Event listeners
      var self = this;
      // Raccourcis par appui long (500ms) sur certains onglets
      var RACCOURCIS = {
        calendar: [{ label: 'Nouvelle réservation', icon: 'fa-plus', go: function(){ location.href='/reservations.html?nouvelle=1'; } }],
        messages: [{ label: 'Message à tous', icon: 'fa-bullhorn', go: function(){ location.href='/messages.html?broadcast=1'; } }],
        cleaning: [{ label: 'Voir les checklists', icon: 'fa-clipboard-check', go: function(){ location.href='/cleaning.html?tab=checklists'; } }]
      };
      document.querySelectorAll('.tab-btn').forEach(btn => {
        var tabId = btn.dataset.tab;
        var timer = null, longPress = false;
        var demarrer = function () {
          longPress = false;
          if (!RACCOURCIS[tabId]) return;
          timer = setTimeout(function () {
            longPress = true;
            self.vibrate('medium');
            self.ouvrirRaccourcis(btn, RACCOURCIS[tabId]);
          }, 500);
        };
        var arreter = function () { if (timer) { clearTimeout(timer); timer = null; } };
        btn.addEventListener('touchstart', demarrer, { passive: true });
        btn.addEventListener('touchend', arreter);
        btn.addEventListener('touchmove', arreter, { passive: true });
        btn.addEventListener('click', async (e) => {
          if (longPress) { e.preventDefault(); longPress = false; return; }
          await self.switchTab(tabId);
        });
      });

      // Ajouter padding en bas du contenu pour les tabs
      const mainContent = document.querySelector('main') || document.querySelector('.container') || document.querySelector('.main-content');
      if (mainContent) {
        mainContent.style.paddingBottom = '80px';
      }

      console.log('✅ Navigation à onglets créée');
    }

    ouvrirRaccourcis(btn, items) {
      var existant = document.getElementById('bh-tab-shortcuts');
      if (existant) existant.remove();
      var r = btn.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.id = 'bh-tab-shortcuts';
      menu.style.cssText = 'position:fixed;z-index:100002;left:' + Math.round(r.left + r.width/2) + 'px;'
        + 'bottom:' + Math.round(window.innerHeight - r.top + 8) + 'px;transform:translateX(-50%) translateY(6px);'
        + 'background:#FAF7F2;border:1px solid rgba(200,184,154,.5);border-radius:16px;'
        + 'box-shadow:0 14px 44px rgba(13,17,23,.28);padding:6px;opacity:0;transition:opacity .16s,transform .16s;'
        + 'min-width:210px;';
      menu.innerHTML = items.map(function (it, i) {
        return '<button data-i="' + i + '" style="display:flex;align-items:center;gap:11px;width:100%;'
          + 'padding:12px 14px;border:none;background:transparent;border-radius:11px;cursor:pointer;'
          + 'font:600 14px \'DM Sans\',sans-serif;color:#0D1117;text-align:left;">'
          + '<span style="width:30px;height:30px;border-radius:9px;background:rgba(14,59,46,.1);color:#0E3B2E;'
          + 'display:flex;align-items:center;justify-content:center;"><i class="fas ' + it.icon + '"></i></span>'
          + it.label + '</button>';
      }).join('');
      document.body.appendChild(menu);
      requestAnimationFrame(function () { menu.style.opacity = '1'; menu.style.transform = 'translateX(-50%) translateY(0)'; });
      var fermer = function () { menu.remove(); document.removeEventListener('click', horsClic, true); };
      var horsClic = function (e) { if (!menu.contains(e.target)) fermer(); };
      menu.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () { var it = items[Number(b.dataset.i)]; fermer(); it.go(); });
      });
      setTimeout(function () { document.addEventListener('click', horsClic, true); }, 50);
    }

    async switchTab(tabId) {
      // Haptic feedback — fire-and-forget : ne pas attendre le bridge natif
      // sinon la navigation (window.location.href) est retardée de 50-150ms
      this.vibrate('light');

      // Update active tab
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
      });

      this.currentTab = tabId;

      // Émettre événement custom
      const event = new CustomEvent('tabChanged', { detail: { tab: tabId } });
      document.dispatchEvent(event);

      console.log('📍 Onglet changé:', tabId);
    }

    updateTabBadge(tabId, count) {
      const tab = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      if (!tab) return;

      const badge = tab.querySelector('.badge');
      if (!badge) return;

      badge.textContent = count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    }

    // ============================================
    // PULL-TO-REFRESH
    // ============================================

    setupPullToRefresh() {
      // Désactivé — pull-to-refresh géré nativement par iOS (AppDelegate)
      console.log('ℹ️ Pull-to-refresh JS désactivé (natif iOS actif)');
    }

    async refreshData() {
      console.log('🔄 Refresh des données...');
      
      // Émettre un événement que votre code peut écouter
      const event = new CustomEvent('dataRefreshRequested');
      document.dispatchEvent(event);
      
      // Attendre un peu
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // ============================================
    // SWIPE GESTURES
    // ============================================

    setupSwipeGestures() {
      const addSwipeToElement = (element) => {
        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        const content = element.querySelector('.swipe-content') || element;
        const actions = element.querySelector('.swipe-actions');

        element.addEventListener('touchstart', (e) => {
          startX = e.touches[0].clientX;
          isDragging = true;
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
          if (!isDragging) return;

          currentX = e.touches[0].clientX;
          const diff = currentX - startX;

          if (diff < 0 && actions) {
            const distance = Math.max(diff, -100);
            content.style.transform = `translateX(${distance}px)`;
            content.style.transition = 'none';
          }
        }, { passive: true });

        element.addEventListener('touchend', async () => {
          if (!isDragging) return;
          isDragging = false;

          const diff = currentX - startX;

          content.style.transition = 'transform 0.3s ease-out';

          if (diff < -50 && actions) {
            content.style.transform = 'translateX(-100px)';
            await this.vibrate('light');
          } else {
            content.style.transform = 'translateX(0)';
          }
        }, { passive: true });
      };

      // Observer pour nouveaux éléments
      const observer = new MutationObserver((mutations) => {
        document.querySelectorAll('.swipeable-item:not(.swipe-enabled)').forEach(element => {
          addSwipeToElement(element);
          element.classList.add('swipe-enabled');
        });
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Appliquer aux éléments déjà présents
      document.querySelectorAll('.swipeable-item').forEach(addSwipeToElement);

      console.log('✅ Swipe gestures configurés');
    }

    // ============================================
    // HAPTIC FEEDBACK
    // ============================================

    setupHapticFeedback() {
      const addHapticToButtons = () => {
        document.querySelectorAll('button:not(.haptic-enabled), .btn:not(.haptic-enabled), a.btn:not(.haptic-enabled)').forEach(btn => {
          btn.addEventListener('click', () => this.vibrate('light'), { passive: true });
          btn.classList.add('haptic-enabled');
        });
      };

      // Observer pour nouveaux boutons
      const observer = new MutationObserver(addHapticToButtons);
      observer.observe(document.body, { childList: true, subtree: true });

      addHapticToButtons();

      console.log('✅ Haptic feedback configuré');
    }

    async vibrate(type = 'light') {
      if (!isNative || !Haptics) return;
      
      try {
        const ImpactStyle = { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' };
        const NotificationType = { Success: 'SUCCESS', Error: 'ERROR', Warning: 'WARNING' };
        
        switch (type) {
          case 'light':
            await Haptics.impact({ style: ImpactStyle.Light });
            break;
          case 'medium':
            await Haptics.impact({ style: ImpactStyle.Medium });
            break;
          case 'heavy':
            await Haptics.impact({ style: ImpactStyle.Heavy });
            break;
          case 'success':
            await Haptics.notification({ type: NotificationType.Success });
            break;
          case 'error':
            await Haptics.notification({ type: NotificationType.Error });
            break;
          case 'warning':
            await Haptics.notification({ type: NotificationType.Warning });
            break;
        }
      } catch (error) {
        // Haptics non disponible
      }
    }

    // ============================================
    // TRANSITIONS DE PAGE
    // ============================================

    setupPageTransitions() {
      window.navigateToPage = async (pageId, direction = 'forward') => {
        const currentPage = document.querySelector('.page.active');
        const nextPage = document.querySelector(`.page[data-page="${pageId}"]`);

        if (!nextPage || !currentPage || currentPage === nextPage) return;

        await this.vibrate('light');

        const animations = {
          forward: { out: 'slideOutLeft', in: 'slideInRight' },
          back: { out: 'slideOutRight', in: 'slideInLeft' }
        };

        const anim = animations[direction];

        currentPage.style.animation = `${anim.out} 0.3s ease-out`;

        setTimeout(() => {
          currentPage.classList.remove('active');
          currentPage.style.animation = '';

          nextPage.classList.add('active');
          nextPage.style.animation = `${anim.in} 0.3s ease-out`;

          setTimeout(() => {
            nextPage.style.animation = '';
          }, 300);
        }, 300);
      };

      console.log('✅ Transitions de page configurées');
    }

    // ============================================
    // SPLASH SCREEN
    // ============================================

    async hideSplashScreen() {
      if (!isNative || !SplashScreen) return;
      
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await SplashScreen.hide({ fadeOutDuration: 500 });
        console.log('✅ Splash screen masqué');
      } catch (error) {
        console.log('⚠️ Splash screen non disponible');
      }
    }

    // ============================================
    // BOTTOM SHEET
    // ============================================

    createBottomSheet(options) {
      const { title, content, height = '50%' } = options;

      const sheet = document.createElement('div');
      sheet.className = 'bottom-sheet';
      sheet.innerHTML = `
        <div class="bottom-sheet-overlay"></div>
        <div class="bottom-sheet-content" style="max-height: ${height}">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <h3>${title}</h3>
            <button class="sheet-close"><i class="fas fa-times"></i></button>
          </div>
          <div class="sheet-body">
            ${content}
          </div>
        </div>
      `;

      document.body.appendChild(sheet);

      // Feuille au-dessus de la barre du bas + corps réellement scrollable
      sheet.style.zIndex = '10060';
      const _content = sheet.querySelector('.bottom-sheet-content');
      if (_content) {
        _content.style.display = 'flex';
        _content.style.flexDirection = 'column';
      }
      const _body = sheet.querySelector('.sheet-body');
      if (_body) {
        _body.style.flex = '1';
        _body.style.minHeight = '0';
        _body.style.overflowY = 'auto';
        _body.style.webkitOverflowScrolling = 'touch';
        _body.style.overscrollBehavior = 'contain';
        _body.style.paddingBottom = 'calc(env(safe-area-inset-bottom, 0px) + 24px)';
      }

      setTimeout(() => sheet.classList.add('open'), 10);

      const close = async () => {
        await this.vibrate('light');
        sheet.classList.remove('open');
        setTimeout(() => sheet.remove(), 300);
      };

      sheet.querySelector('.sheet-close').addEventListener('click', close);
      sheet.querySelector('.bottom-sheet-overlay').addEventListener('click', close);

      // Swipe down pour fermer — UNIQUEMENT si la liste est déjà tout en haut,
      // sinon on laisse défiler normalement (sinon scroller vers le haut ferme le menu).
      let startY = 0;
      let dragging = false;
      const sheetContent = sheet.querySelector('.bottom-sheet-content');
      const scrollBody = sheet.querySelector('.sheet-body') || sheetContent;

      sheetContent.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        dragging = (scrollBody.scrollTop <= 0);
      }, { passive: true });

      sheetContent.addEventListener('touchmove', (e) => {
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (!dragging) return;
        if (scrollBody.scrollTop > 0) { dragging = false; sheetContent.style.transform = 'translateY(0)'; return; }

        if (diff > 0) {
          sheetContent.style.transform = `translateY(${diff}px)`;
        }
      }, { passive: true });

      sheetContent.addEventListener('touchend', (e) => {
        if (!dragging) return;
        const currentY = e.changedTouches[0].clientY;
        const diff = currentY - startY;
        dragging = false;

        if (diff > 100) {
          close();
        } else {
          sheetContent.style.transform = 'translateY(0)';
        }
      }, { passive: true });

      return sheet;
    }
  }

  // ============================================
  // INITIALISATION GLOBALE
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.mobileApp = new MobileNativeExperience();
    });
  } else {
    window.mobileApp = new MobileNativeExperience();
  }

})();


// Les notifications push sont gerees uniquement par
// public/js/push-notifications-handler.js (@capacitor-firebase/messaging).
// Le bloc initPushNotifications qui vivait ici utilisait le second plugin
// @capacitor/push-notifications : deux enregistrements de jeton, deux
// ecouteurs de clic, et un delegue iOS dispute. Supprime.

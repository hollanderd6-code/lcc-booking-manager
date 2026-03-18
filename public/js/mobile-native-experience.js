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
      const _accountType = localStorage.getItem('lcc_account_type');
      const _isSubAccount = (_accountType === 'sub');
      let _permissions = {};
      if (_isSubAccount) {
        try {
          const _pd = localStorage.getItem('lcc_permissions');
          if (_pd) _permissions = JSON.parse(_pd);
        } catch(e) {}
      }
      const _hasPerm = (perm) => !_isSubAccount || _permissions[perm] === true;

      // Onglets de base — toujours visibles si permission
      const allTabs = [
        { id: 'dashboard',   icon: 'fa-home',       label: 'Accueil',    perm: 'can_view_reservations' },
        { id: 'calendar',    icon: 'fa-calendar',   label: 'Calendrier', perm: 'can_view_reservations' },
        { id: 'messages',    icon: 'fa-comment',    label: 'Messages',   perm: 'can_view_messages', badge: 0 },
        { id: 'properties',  icon: 'fa-building',   label: 'Logements',  perm: 'can_view_properties' },
        { id: 'more',        icon: 'fa-ellipsis-h', label: 'Plus',       perm: null }
      ];

      // Filtrer selon permissions
      const tabs = allTabs.filter(tab => tab.perm === null || _hasPerm(tab.perm));

      const tabsContainer = document.createElement('div');
      tabsContainer.className = 'mobile-tabs';
      tabsContainer.innerHTML = tabs.map(tab => `
        <button class="tab-btn ${tab.id === 'dashboard' ? 'active' : ''}" data-tab="${tab.id}">
          <i class="fas ${tab.icon}"></i>
          <span>${tab.label}</span>
          ${tab.badge !== undefined ? `<span class="badge" style="display: ${tab.badge > 0 ? 'flex' : 'none'}">${tab.badge}</span>` : ''}
        </button>
      `).join('');

      document.body.appendChild(tabsContainer);

      // Event listeners
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tabId = btn.dataset.tab;
          await this.switchTab(tabId);
        });
      });

      // Ajouter padding en bas du contenu pour les tabs
      const mainContent = document.querySelector('main') || document.querySelector('.container') || document.querySelector('.main-content');
      if (mainContent) {
        mainContent.style.paddingBottom = '80px';
      }

      console.log('✅ Navigation à onglets créée');
    }

    async switchTab(tabId) {
      // Haptic feedback
      await this.vibrate('light');

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

      setTimeout(() => sheet.classList.add('open'), 10);

      const close = async () => {
        await this.vibrate('light');
        sheet.classList.remove('open');
        setTimeout(() => sheet.remove(), 300);
      };

      sheet.querySelector('.sheet-close').addEventListener('click', close);
      sheet.querySelector('.bottom-sheet-overlay').addEventListener('click', close);

      // Swipe down pour fermer
      let startY = 0;
      const sheetContent = sheet.querySelector('.bottom-sheet-content');

      sheetContent.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
      }, { passive: true });

      sheetContent.addEventListener('touchmove', (e) => {
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0) {
          sheetContent.style.transform = `translateY(${diff}px)`;
        }
      }, { passive: true });

      sheetContent.addEventListener('touchend', (e) => {
        const currentY = e.changedTouches[0].clientY;
        const diff = currentY - startY;

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

// ============================================
// 📱 BOOSTINGHOST - EXPÉRIENCE MOBILE NATIVE
// Version corrigée - Transition splash fluide
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
      
      // 🎬 PRIORITÉ 1 : Masquer le splash dès que possible
      await this.hideSplashScreen();
      
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
      
      // Configurer pull-to-refresh
      this.setupPullToRefresh();
      
      // Configurer les gestures
      this.setupSwipeGestures();
      
      // Configurer les haptics sur tous les boutons
      this.setupHapticFeedback();
      
      // Configurer les transitions de page
      this.setupPageTransitions();
      
      console.log('✅ Expérience mobile native prête !');
    }

    // ============================================
    // STATUS BAR NATIVE
    // ============================================

    async setupStatusBar() {
      if (!isNative || !StatusBar) return;
      
      try {
        await StatusBar.setStyle({ style: 'light' });
        await StatusBar.setBackgroundColor({ color: '#ffffff' }); 
        await StatusBar.show();
        console.log('✅ Status bar configurée');
      } catch (error) {
        console.log('⚠️ Status bar non disponible');
      }
    }

    // ============================================
    // DARK MODE AUTOMATIQUE
    // ============================================

    setupDarkMode() {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      
      const updateTheme = async (isDark) => {
        this.isDarkMode = isDark;
        
        if (isDark) {
          document.body.classList.add('dark-mode');
          if (isNative && StatusBar) {
            try {
              await StatusBar.setStyle({ style: 'dark' });
              await StatusBar.setBackgroundColor({ color: '#1F2937' });
            } catch (e) {}
          }
        } else {
          document.body.classList.remove('dark-mode');
          if (isNative && StatusBar) {
            try {
              await StatusBar.setStyle({ style: 'light' });
              await StatusBar.setBackgroundColor({ color: '#ffffff' });
            } catch (e) {}
          }
        }
      };

      prefersDark.addEventListener('change', (e) => updateTheme(e.matches));
      updateTheme(prefersDark.matches);
    }

    // ============================================
    // NAVIGATION À ONGLETS (BOTTOM TABS)
    // ============================================

    createTabNavigation() {
      if (document.querySelector('.mobile-tabs')) {
        console.log('⚠️ Navigation déjà créée');
        return;
      }

      const tabs = [
        { id: 'dashboard', icon: 'fa-home', label: 'Accueil' },
        { id: 'calendar', icon: 'fa-calendar', label: 'Calendrier' },
        { id: 'messages', icon: 'fa-comment', label: 'Messages', badge: 0 },
        { id: 'properties', icon: 'fa-building', label: 'Logements' },
        { id: 'more', icon: 'fa-ellipsis-h', label: 'Plus' }
      ];

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

      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tabId = btn.dataset.tab;
          await this.switchTab(tabId);
        });
      });

      const mainContent = document.querySelector('main') || document.querySelector('.container') || document.querySelector('.main-content');
      if (mainContent) {
        mainContent.style.paddingBottom = '80px';
      }

      console.log('✅ Navigation à onglets créée');
    }

    async switchTab(tabId) {
      await this.vibrate('light');

      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
      });

      this.currentTab = tabId;

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
      let startY = 0;
      let currentY = 0;
      let pulling = false;
      let refreshing = false;

      const indicator = document.createElement('div');
      indicator.className = 'pull-refresh-indicator';
      indicator.innerHTML = '<i class="fas fa-sync-alt"></i>';
      document.body.insertBefore(indicator, document.body.firstChild);

      const mainContent = document.querySelector('main') || document.querySelector('.container') || document.querySelector('.main-content') || document.body;

      mainContent.addEventListener('touchstart', (e) => {
        if (window.scrollY === 0 && !refreshing) {
          startY = e.touches[0].clientY;
          pulling = true;
        }
      }, { passive: true });

      mainContent.addEventListener('touchmove', (e) => {
        if (!pulling || refreshing) return;

        currentY = e.touches[0].clientY;
        const diff = currentY - startY;

        if (diff > 0 && diff < this.pullRefreshThreshold * 1.5) {
          e.preventDefault();
          const progress = Math.min(diff / this.pullRefreshThreshold, 1);
          indicator.style.transform = `translateY(${diff * 0.5}px) rotate(${progress * 360}deg)`;
          indicator.style.opacity = progress;

          if (diff > this.pullRefreshThreshold) {
            indicator.classList.add('ready');
          } else {
            indicator.classList.remove('ready');
          }
        }
      });

      mainContent.addEventListener('touchend', async (e) => {
        if (!pulling || refreshing) return;

        const finalY = e.changedTouches[0].clientY;
        const diff = finalY - startY;

        pulling = false;

        if (diff > this.pullRefreshThreshold) {
          refreshing = true;
          indicator.classList.add('refreshing');
          await this.vibrate('medium');

          const event = new CustomEvent('pullRefresh');
          document.dispatchEvent(event);

          setTimeout(() => {
            indicator.style.transform = 'translateY(0)';
            indicator.style.opacity = '0';
            indicator.classList.remove('ready', 'refreshing');
            refreshing = false;
          }, 1500);
        } else {
          indicator.style.transform = 'translateY(0)';
          indicator.style.opacity = '0';
          indicator.classList.remove('ready');
        }
      }, { passive: true });

      console.log('✅ Pull-to-refresh configuré');
    }

    // ============================================
    // SWIPE GESTURES
    // ============================================

    setupSwipeGestures() {
      const addSwipeToElement = (element) => {
        let startX = 0;
        let currentX = 0;
        let isSwiping = false;

        const content = element.querySelector('.swipeable-content');
        const actions = element.querySelector('.swipe-actions');

        if (!content || !actions) return;

        element.addEventListener('touchstart', (e) => {
          startX = e.touches[0].clientX;
          isSwiping = true;
        }, { passive: true });

        element.addEventListener('touchmove', (e) => {
          if (!isSwiping) return;

          currentX = e.touches[0].clientX;
          const diff = currentX - startX;

          if (diff < 0 && Math.abs(diff) < 100) {
            content.style.transform = `translateX(${diff}px)`;
          }
        }, { passive: true });

        element.addEventListener('touchend', async (e) => {
          if (!isSwiping) return;

          isSwiping = false;
          const finalX = e.changedTouches[0].clientX;
          const diff = finalX - startX;

          if (diff < -50 && actions) {
            content.style.transform = 'translateX(-100px)';
            await this.vibrate('light');
          } else {
            content.style.transform = 'translateX(0)';
          }
        }, { passive: true });
      };

      const observer = new MutationObserver((mutations) => {
        document.querySelectorAll('.swipeable-item:not(.swipe-enabled)').forEach(element => {
          addSwipeToElement(element);
          element.classList.add('swipe-enabled');
        });
      });

      observer.observe(document.body, { childList: true, subtree: true });
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
    // SPLASH SCREEN - VERSION OPTIMISÉE
    // ============================================

    async hideSplashScreen() {
      if (!isNative || !SplashScreen) {
        console.log('⚠️ Pas de splash screen (web ou plugin indisponible)');
        return;
      }
      
      try {
        console.log('🎬 Masquage du splash screen...');
        
        // ⚡ Stratégie : masquer RAPIDEMENT avec une belle animation
        // Le HTML a maintenant un fond vert qui prend le relais
        
        // Petit délai pour que le HTML soit chargé
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Masquer avec animation douce
        await SplashScreen.hide({ fadeOutDuration: 800 });
        
        console.log('✅ Splash masqué avec succès');
        
      } catch (error) {
        console.error('❌ Erreur splash:', error);
        // En cas d'erreur, forcer le masquage
        try {
          await SplashScreen.hide({ fadeOutDuration: 300 });
        } catch (e) {
          console.error('❌ Impossible de masquer le splash');
        }
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

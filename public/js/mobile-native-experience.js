// ============================================
// 📱 BOOSTINGHOST - EXPÉRIENCE MOBILE NATIVE
// ============================================

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

// ============================================
// 1. INITIALISATION AU DÉMARRAGE
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
    
    // Attendre que Capacitor soit prêt
    await this.waitForCapacitor();
    
    // Configurer la status bar
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
    
    // Masquer le splash screen
    await this.hideSplashScreen();
    
    console.log('✅ Expérience mobile native prête !');
  }

  async waitForCapacitor() {
    return new Promise((resolve) => {
      if (window.Capacitor) {
        resolve();
      } else {
        document.addEventListener('deviceready', resolve);
      }
    });
  }

  // ============================================
  // 2. STATUS BAR NATIVE
  // ============================================

  async setupStatusBar() {
    try {
      await StatusBar.setStyle({ style: Style.Light });
      await StatusBar.setBackgroundColor({ color: '#3B82F6' });
      await StatusBar.show();
      console.log('✅ Status bar configurée');
    } catch (error) {
      console.log('⚠️ Status bar non disponible (mode web)');
    }
  }

  // ============================================
  // 3. DARK MODE AUTOMATIQUE
  // ============================================

  setupDarkMode() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    
    const updateTheme = async (isDark) => {
      this.isDarkMode = isDark;
      
      if (isDark) {
        document.body.classList.add('dark-mode');
        try {
          await StatusBar.setStyle({ style: Style.Dark });
          await StatusBar.setBackgroundColor({ color: '#1F2937' });
        } catch (e) {}
      } else {
        document.body.classList.remove('dark-mode');
        try {
          await StatusBar.setStyle({ style: Style.Light });
          await StatusBar.setBackgroundColor({ color: '#3B82F6' });
        } catch (e) {}
      }
    };

    prefersDark.addEventListener('change', (e) => updateTheme(e.matches));
    updateTheme(prefersDark.matches);
  }

  // ============================================
  // 4. NAVIGATION À ONGLETS (BOTTOM TABS)
  // ============================================

  createTabNavigation() {
    // Vérifier si la navigation existe déjà
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

    // Event listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tabId = btn.dataset.tab;
        await this.switchTab(tabId);
      });
    });

    // Ajouter padding en bas du contenu pour les tabs
    const mainContent = document.querySelector('main') || document.querySelector('.container');
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

    // Émettre événement custom pour que votre code existant puisse réagir
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
  // 5. PULL-TO-REFRESH
  // ============================================

  setupPullToRefresh() {
    let startY = 0;
    let currentY = 0;
    let pulling = false;
    let refreshing = false;

    // Créer l'indicateur
    const indicator = document.createElement('div');
    indicator.className = 'pull-refresh-indicator';
    indicator.innerHTML = '<i class="fas fa-sync-alt"></i>';
    document.body.insertBefore(indicator, document.body.firstChild);

    const mainContent = document.querySelector('main') || document.querySelector('.container') || document.body;

    mainContent.addEventListener('touchstart', (e) => {
      if (window.scrollY === 0 && !refreshing) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    });

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
      if (!pulling) return;
      pulling = false;

      const diff = currentY - startY;

      if (diff > this.pullRefreshThreshold && !refreshing) {
        refreshing = true;
        indicator.classList.add('refreshing');

        // Haptic feedback
        await this.vibrate('medium');

        // Émettre événement pour déclencher le refresh
        const event = new CustomEvent('pullRefresh');
        document.dispatchEvent(event);

        // Attendre le refresh (vous devez implémenter refreshData())
        try {
          await this.refreshData();
          await this.vibrate('success');
        } catch (error) {
          await this.vibrate('error');
        }

        // Reset
        setTimeout(() => {
          indicator.style.transform = 'translateY(0) rotate(0deg)';
          indicator.style.opacity = '0';
          indicator.classList.remove('ready', 'refreshing');
          refreshing = false;
        }, 300);
      } else {
        indicator.style.transform = 'translateY(0) rotate(0deg)';
        indicator.style.opacity = '0';
        indicator.classList.remove('ready');
      }

      currentY = 0;
    });

    console.log('✅ Pull-to-refresh configuré');
  }

  async refreshData() {
    // Cette fonction doit être implémentée pour recharger vos données
    console.log('🔄 Refresh des données...');
    
    // Émettre un événement que votre code peut écouter
    const event = new CustomEvent('dataRefreshRequested');
    document.dispatchEvent(event);
    
    // Attendre un peu pour simuler le chargement
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ============================================
  // 6. SWIPE GESTURES (pour supprimer)
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
      });

      element.addEventListener('touchmove', (e) => {
        if (!isDragging) return;

        currentX = e.touches[0].clientX;
        const diff = currentX - startX;

        // Swipe vers la gauche seulement
        if (diff < 0 && actions) {
          const distance = Math.max(diff, -100);
          content.style.transform = `translateX(${distance}px)`;
          content.style.transition = 'none';
        }
      });

      element.addEventListener('touchend', async () => {
        if (!isDragging) return;
        isDragging = false;

        const diff = currentX - startX;

        content.style.transition = 'transform 0.3s ease-out';

        if (diff < -50 && actions) {
          // Afficher les actions
          content.style.transform = 'translateX(-100px)';
          await this.vibrate('light');
        } else {
          // Reset
          content.style.transform = 'translateX(0)';
        }
      });
    };

    // Appliquer aux éléments swipeable
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
  // 7. HAPTIC FEEDBACK
  // ============================================

  setupHapticFeedback() {
    // Ajouter haptic sur tous les boutons
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
    try {
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
      // Haptics non disponible (mode web)
    }
  }

  // ============================================
  // 8. TRANSITIONS DE PAGE
  // ============================================

  setupPageTransitions() {
    window.navigateToPage = async (pageId, direction = 'forward') => {
      const currentPage = document.querySelector('.page.active');
      const nextPage = document.querySelector(`.page[data-page="${pageId}"]`);

      if (!nextPage || !currentPage || currentPage === nextPage) return;

      await this.vibrate('light');

      const animations = {
        forward: {
          out: 'slideOutLeft',
          in: 'slideInRight'
        },
        back: {
          out: 'slideOutRight',
          in: 'slideInLeft'
        }
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
  // 9. SPLASH SCREEN
  // ============================================

  async hideSplashScreen() {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      await SplashScreen.hide({
        fadeOutDuration: 500
      });
      console.log('✅ Splash screen masqué');
    } catch (error) {
      console.log('⚠️ Splash screen non disponible');
    }
  }

  // ============================================
  // 10. BOTTOM SHEET
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

    // Ouvrir avec animation
    setTimeout(() => sheet.classList.add('open'), 10);

    // Fermer au clic
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
    });

    sheetContent.addEventListener('touchmove', (e) => {
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY;

      if (diff > 0) {
        sheetContent.style.transform = `translateY(${diff}px)`;
      }
    });

    sheetContent.addEventListener('touchend', (e) => {
      const currentY = e.changedTouches[0].clientY;
      const diff = currentY - startY;

      if (diff > 100) {
        close();
      } else {
        sheetContent.style.transform = 'translateY(0)';
      }
    });

    return sheet;
  }
}

// ============================================
// INITIALISATION GLOBALE
// ============================================

window.mobileApp = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.mobileApp = new MobileNativeExperience();
  });
} else {
  window.mobileApp = new MobileNativeExperience();
}

// Export pour utilisation
export default MobileNativeExperience;

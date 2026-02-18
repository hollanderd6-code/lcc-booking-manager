/**
 * bh-theme-v3-nav.js
 * Injecte la barre de navigation V3 (noire, en haut)
 * quand ?v3=1 est dans l'URL et que data-theme-v3="1" est sur <html>
 *
 * À inclure après bh-layout.js dans toutes les pages :
 *   <script src="/js/bh-theme-v3-nav.js"></script>
 */
(function () {
  'use strict';

  // N'agit que si le thème V3 est activé
  if (document.documentElement.getAttribute('data-theme-v3') !== '1') return;

  // ─── Pages avec libellés et liens ────────────────────────────
  const NAV_PAGES = [
    { label: 'Dashboard',  icon: 'fa-chart-line',     href: '/app.html',                    page: 'app' },
    { label: 'Messages',   icon: 'fa-comment-dots',   href: '/messages.html',               page: 'messages' },
    { label: 'Logements',  icon: 'fa-building',       href: '/settings.html',               page: 'settings' },
    { label: 'Cautions',   icon: 'fa-shield-halved',  href: '/deposits.html',               page: 'deposits' },
    { label: 'Factures',   icon: 'fa-file-invoice',   href: '/factures.html',               page: 'factures' },
    { label: 'Livret',     icon: 'fa-book-open',      href: '/welcome.html',                page: 'welcome' },
  ];

  function getCurrentPage() {
    return document.body.getAttribute('data-page') || '';
  }

  function buildNav() {
    const currentPage = getCurrentPage();
    const currentPath = window.location.pathname.toLowerCase();

    let btns = '';
    NAV_PAGES.forEach(function (p) {
      const isActive =
        p.page === currentPage ||
        currentPath === p.href.toLowerCase() ||
        currentPath === p.href.replace('.html', '').toLowerCase();

      btns += `<a class="bh-demo-btn${isActive ? ' active' : ''}" href="${p.href}?v3=1">
        <i class="fas ${p.icon}"></i> ${p.label}
      </a>`;
    });

    const nav = document.createElement('div');
    nav.className = 'bh-demo-nav';
    nav.innerHTML = `
      <span class="bh-demo-label">Vue</span>
      ${btns}
      <div class="bh-demo-right">
        <span class="bh-demo-mode-label">Mode</span>
        <button class="bh-theme-toggle" id="bhV3ThemeToggle" title="Basculer dark/light mode"></button>
      </div>
    `;

    document.body.insertBefore(nav, document.body.firstChild);

    // Toggle dark mode
    const toggle = document.getElementById('bhV3ThemeToggle');
    if (toggle) {
      // État initial
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) toggle.classList.add('active');

      toggle.addEventListener('click', function () {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);

        // Synchronise avec l'ancien système si présent
        if (typeof toggleTheme === 'function') {
          // déjà fait
        }
        // Persister le choix
        try { localStorage.setItem('bh_theme', next); } catch (e) {}
      });

      // Restaurer le thème sauvegardé
      try {
        const saved = localStorage.getItem('bh_theme');
        if (saved) {
          document.documentElement.setAttribute('data-theme', saved);
        }
      } catch (e) {}
    }
  }

  // ─── Titre topbar avec italic jade ───────────────────────────
  function enhancePageTitle() {
    const titleEl = document.querySelector('.main-header h1.page-title, .main-header .page-title');
    if (!titleEl) return;

    // Mapping page → titre avec em
    const titles = {
      app:       'Tableau de <em>bord</em>',
      messages:  'Mes <em>messages</em>',
      settings:  'Mes <em>logements</em>',
      deposits:  'Gestion des <em>cautions</em>',
      factures:  'Factures <em>clients</em>',
      welcome:   "Livret d'<em>accueil</em>",
      cleaning:  'Gestion du <em>ménage</em>',
    };

    const page = getCurrentPage();
    if (titles[page] && !titleEl.querySelector('em')) {
      titleEl.innerHTML = titles[page];
    }
  }

  // ─── Bouton "Nouvelle réservation" dans le header ────────────
  function injectCTAButton() {
    const actions = document.querySelector('.main-header .header-actions');
    if (!actions) return;
    if (document.getElementById('newReservationBtn')) return; // déjà présent

    const page = getCurrentPage();
    if (page !== 'app') return; // uniquement sur le dashboard

    const btn = document.createElement('button');
    btn.id = 'newReservationBtn';
    btn.innerHTML = '<i class="fas fa-plus"></i> Nouvelle réservation';
    btn.addEventListener('click', function () {
      const modal = document.getElementById('newReservationModal');
      if (modal) {
        modal.style.display = 'flex';
      }
    });
    actions.appendChild(btn);
  }

  // ─── Init ────────────────────────────────────────────────────
  function init() {
    buildNav();
    enhancePageTitle();

    // Attendre que la sidebar soit injectée
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(enhancePageTitle, 100);
        setTimeout(injectCTAButton, 200);
      });
    } else {
      setTimeout(enhancePageTitle, 100);
      setTimeout(injectCTAButton, 200);
    }

    // Après injection sidebar (event custom de bh-layout.js)
    document.addEventListener('sidebarReady', function () {
      enhancePageTitle();
      injectCTAButton();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

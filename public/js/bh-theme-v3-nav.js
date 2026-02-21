/**
 * bh-theme-v3-nav.js
 * Injecte la barre de navigation V3 (noire, en haut)
 * + légende plateformes dans le calendrier
 * + titres en Instrument Serif/italic jade
 *
 * À inclure après bh-layout.js dans toutes les pages :
 *   <script src="/js/bh-theme-v3-nav.js"></script>
 */
(function () {
  'use strict';

  // N'agit que si le thème V3 est activé
  if (document.documentElement.getAttribute('data-theme-v3') !== '1') return;

  // ─── Pages avec libellés et liens ────────────────────────────
  var NAV_PAGES = [
    { label: 'Dashboard',  icon: 'fa-chart-line',    href: '/app.html',       page: 'app' },
    { label: 'Messages',   icon: 'fa-comment-dots',  href: '/messages.html',  page: 'messages' },
    { label: 'Logements',  icon: 'fa-building',      href: '/settings.html',  page: 'settings' },
    { label: 'Cautions',   icon: 'fa-shield-halved', href: '/deposits.html',  page: 'deposits' },
    { label: 'Factures',   icon: 'fa-file-invoice',  href: '/factures.html',  page: 'factures' },
    { label: 'Livret',     icon: 'fa-book-open',     href: '/welcome.html',   page: 'welcome' },
  ];

  function getCurrentPage() {
    return document.body.getAttribute('data-page') || '';
  }

  // ─── Barre noire demo-nav ─────────────────────────────────────
  function buildNav() {
    var currentPage = getCurrentPage();
    var currentPath = window.location.pathname.toLowerCase();

    var btns = '';
    NAV_PAGES.forEach(function (p) {
      var isActive =
        p.page === currentPage ||
        currentPath === p.href.toLowerCase() ||
        currentPath === p.href.replace('.html', '').toLowerCase();
      btns += '<a class="bh-demo-btn' + (isActive ? ' active' : '') + '" href="' + p.href + '?v3=1">'
            + '<i class="fas ' + p.icon + '"></i> ' + p.label + '</a>';
    });

    var nav = document.createElement('div');
    nav.className = 'bh-demo-nav';
    nav.innerHTML = '<span class="bh-demo-label">Vue</span>'
      + btns
      + '<div class="bh-demo-right">'
      +   '<span class="bh-demo-mode-label">Mode</span>'
      +   '<button class="bh-theme-toggle" id="bhV3ThemeToggle" title="Basculer dark/light"></button>'
      + '</div>';

    document.body.insertBefore(nav, document.body.firstChild);

    // Toggle dark mode
    var toggle = document.getElementById('bhV3ThemeToggle');
    if (toggle) {
      try {
        var saved = localStorage.getItem('bh_theme');
        if (saved) document.documentElement.setAttribute('data-theme', saved);
      } catch (e) {}

      toggle.addEventListener('click', function () {
        var html = document.documentElement;
        var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', next);
        try { localStorage.setItem('bh_theme', next); } catch (e) {}
      });
    }
  }

  // ─── Titre topbar ─────────────────────────────────────────────
  function enhancePageTitle() {
    var titleEl = document.querySelector('.main-header h1.page-title, .main-header .page-title');
    if (!titleEl) return;

    var titles = {
      app:       'Tableau de <em>bord</em>',
      messages:  'Mes <em>messages</em>',
      settings:  'Mes <em>logements</em>',
      deposits:  'Gestion des <em>cautions</em>',
      factures:  'Factures <em>clients</em>',
      welcome:   "Livret d'<em>accueil</em>",
      cleaning:  'Gestion du <em>ménage</em>',
    };

    var page = getCurrentPage();
    if (titles[page] && !titleEl.querySelector('em')) {
      titleEl.innerHTML = titles[page];
    }
  }

  // ─── Calendrier : titre + légende + sous-titre ───────────────
  function enhanceCalendar() {
    // 1. Titre "Calendrier" → "Calendrier des réservations"
    var calTitle = document.querySelector('.calendar-title-modern span');
    if (calTitle && calTitle.textContent.trim() === 'Calendrier') {
      calTitle.innerHTML = 'Calendrier des <em style="font-style:italic;color:#2AAE86;font-family:\'Instrument Serif\',serif;">réservations</em>';
    }

    // 2. Sous-titre sous le titre (nb logements · vue)
    var headerTop = document.querySelector('.calendar-header-top');
    if (headerTop && !document.getElementById('bhCalSubtitle')) {
      var h3 = headerTop.querySelector('.calendar-title-modern');
      if (h3) {
        var sub = document.createElement('p');
        sub.id = 'bhCalSubtitle';
        sub.style.cssText = 'margin:3px 0 0 50px;font-size:11.5px;color:rgba(255,255,255,.45);font-family:"DM Sans",sans-serif;font-weight:500;letter-spacing:.01em;line-height:1;';

        // Compter les logements
        var propCount = document.querySelectorAll('.property-item').length;
        sub.textContent = (propCount > 0 ? propCount + ' logements · ' : '') + 'Vue mensuelle';
        h3.insertAdjacentElement('afterend', sub);
      }
    }

    // 3. Légende ● Airbnb ● Booking ● Direct dans le .view-selector
    var viewSelector = document.querySelector('.view-selector');
    if (viewSelector && !viewSelector.querySelector('.bh-cal-legend')) {
      var legend = document.createElement('div');
      legend.className = 'bh-cal-legend';
      legend.innerHTML =
        '<span class="bh-cal-legend-item"><span class="bh-cal-legend-dot airbnb"></span>Airbnb</span>' +
        '<span class="bh-cal-legend-item"><span class="bh-cal-legend-dot booking"></span>Booking</span>' +
        '<span class="bh-cal-legend-item"><span class="bh-cal-legend-dot direct"></span>Direct</span>';
      viewSelector.appendChild(legend);
    }

    // 4. Màj sous-titre selon vue active
    var viewTabs = document.querySelectorAll('.view-tab');
    viewTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var sub = document.getElementById('bhCalSubtitle');
        if (!sub) return;
        var views = { day: 'Vue journalière', week: 'Vue hebdomadaire', month: 'Vue mensuelle', year: 'Vue annuelle' };
        var view = tab.getAttribute('data-view');
        var propCount = document.querySelectorAll('.property-item').length;
        var prefix = propCount > 0 ? propCount + ' logements · ' : '';
        if (views[view]) sub.textContent = prefix + views[view];
      });
    });
  }

  // ─── Bouton "+ Nouvelle réservation" ─────────────────────────
  function injectCTAButton() {
    var actions = document.querySelector('.main-header .header-actions');
    if (!actions) return;
    if (document.getElementById('newReservationBtn')) return;
    if (getCurrentPage() !== 'app') return;

    var btn = document.createElement('button');
    btn.id = 'newReservationBtn';
    btn.innerHTML = '<i class="fas fa-plus"></i> Nouvelle réservation';
    btn.addEventListener('click', function () {
      var modal = document.getElementById('newReservationModal');
      if (modal) modal.style.display = 'flex';
    });
    actions.appendChild(btn);
  }

  // ─── Init ────────────────────────────────────────────────────
  function init() {
    buildNav();
    enhancePageTitle();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(enhancePageTitle, 80);
        setTimeout(injectCTAButton, 150);
        setTimeout(enhanceCalendar, 600); // après rendu du calendrier
      });
    } else {
      setTimeout(enhancePageTitle, 80);
      setTimeout(injectCTAButton, 150);
      setTimeout(enhanceCalendar, 600);
    }

    document.addEventListener('sidebarReady', function () {
      enhancePageTitle();
      injectCTAButton();
    });

    // Re-tenter si le calendrier est rendu plus tard
    setTimeout(enhanceCalendar, 1500);
    setTimeout(enhanceCalendar, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

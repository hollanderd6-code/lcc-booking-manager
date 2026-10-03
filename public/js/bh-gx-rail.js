/* bh-gx-rail.js — barre latérale « verre » des écrans Gestion, posée aussi sur les
   pages historiques (Aujourd'hui, Calendrier, Messages, Mon compte…) à partir de 860 px.
   Sur ces largeurs, la barre d'onglets flottante (.mobile-tabs) disparaît : une seule
   navigation sur ordinateur. En dessous de 860 px, rien ne change (barre d'onglets).
   Chargé par bh-layout.js. Repliée par défaut ; « gx_sidebar_collapsed » = '0' la garde ouverte. */
(function () {
  'use strict';
  if (window.__bhGxRail) return;
  window.__bhGxRail = true;
  if (document.querySelector('.gx-shell')) return; // écrans Gestion : barre déjà dans la page

  var BP = 860;
  var page = (document.body && document.body.dataset.page) || (location.pathname.split('/').pop() || '').replace('.html', '');
  var hash = location.hash || '';
  var active = page === 'messages' || /^chat/.test(page) ? 'messages'
    : (page === 'app' || page === 'dashboard' || page === 'index') ? (hash === '#calendarSection' ? 'calendar' : 'today')
    : page === 'reservations' ? 'calendar' : 'manage';

  var css = ''
    + '@media (min-width:' + BP + 'px){'
    + 'html.bh-rail-on body{padding-left:var(--bh-rail-w,100px)!important;transition:padding-left .25s ease}'
    + 'html.bh-rail-on.bh-rail-on body .mobile-tabs,html.bh-rail-on.bh-rail-on body .tab-bar{display:none!important}'
    + 'html.bh-rail-on .sidebar,html.bh-rail-on #bhSidebar{display:none!important}'
    // En-tête « mobile » fixe des pages historiques (jusqu'à 1366 px) : décalé pour ne pas passer sur la barre
    + 'html.bh-rail-on.bh-rail-on body .mobile-header{left:var(--bh-rail-w,100px)!important;width:auto!important;right:0!important;transition:left .25s ease}'
    // Messages : le panneau liste/conversation est fixe et calé à gauche
    // (sélecteur renforcé : messages.html pose « left:0; width:100vw » en !important)
    + 'html.bh-rail-on.bh-rail-on body .msgs-split,html.bh-rail-on.bh-rail-on body #panelLogs{left:var(--bh-rail-w,100px)!important;right:0!important;width:auto!important;margin-left:0!important;bottom:16px!important;transition:left .25s ease}'
    // Bouton flottant « + réservation » : stylé seulement sous 900 px, il traînait en bas de page
    + 'html.bh-rail-on #fabAddResa{display:none!important}'
    + '.bhr-rail{position:fixed;top:0;left:0;bottom:0;z-index:900;padding:16px 0 16px 16px;display:flex;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","DM Sans",system-ui,sans-serif}'
    + '}'
    + '@media (max-width:' + (BP - 1) + 'px){.bhr-rail{display:none!important}'
    // Téléphone : une seule barre d'onglets, la même pilule flottante que les écrans Gestion
    + 'html.bh-tabs-on .mobile-tabs,html.bh-tabs-on .tab-bar{display:none!important}'
    // Messages : le panneau plein écran avait une marge gauche de 20 px en plus de sa largeur 100vw
    + 'html.bh-tabs-on.bh-tabs-on.bh-tabs-on body[data-page] .msgs-split{margin-left:0!important;margin-right:0!important}'
    + '.bhr-tabs{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1200;display:flex;gap:4px;padding:6px;border-radius:999px;'
    + 'background:rgba(255,255,255,.78);backdrop-filter:blur(30px) saturate(180%);-webkit-backdrop-filter:blur(30px) saturate(180%);border:1px solid rgba(0,0,0,.07);box-shadow:0 6px 24px rgba(20,32,27,.16);'
    + 'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","DM Sans",system-ui,sans-serif}'
    + '.bhr-tabs a{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;width:78px;padding:7px 0 6px;border-radius:999px;color:#5E6B63;font-size:10.5px;font-weight:500;text-decoration:none;-webkit-tap-highlight-color:transparent}'
    + '.bhr-tabs a svg{width:22px;height:22px}'
    + '.bhr-tabs a.is-active{background:rgba(0,0,0,.07);color:#14201B;font-weight:600}'
    + '.bhr-tabs .gx-badge{position:absolute;top:2px;left:calc(50% + 6px);min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#A8452A;color:#fff;font-size:10.5px;font-weight:700;display:none;align-items:center;justify-content:center;box-sizing:border-box}'
    + '.bhr-tabs .gx-badge.on{display:flex}'
    // En-tête épuré façon iOS (date + grand titre, recherche, initiale) à la place de l'en-tête logo + raccourcis
    + 'html.bh-top-on .mobile-header,html.bh-top-on #bhMobileHeader{display:none!important}'
    // Messages : le panneau laissait la place des anciens onglets (44 px) sous l'en-tête
    + 'html.bh-top-on.bh-top-on.bh-top-on body[data-page] .msgs-split,html.bh-top-on.bh-top-on.bh-top-on body[data-page] #panelLogs{top:calc(60px + env(safe-area-inset-top,0px))!important}'
    + '.bhr-top{position:fixed;top:0;left:0;right:0;z-index:1100;height:calc(60px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) 16px 0;box-sizing:border-box;display:flex;align-items:center;gap:10px;'
    + 'background:rgba(245,242,236,.9);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-bottom:1px solid rgba(20,32,27,.07);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","DM Sans",system-ui,sans-serif}'
    + '.bhr-top__t{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center}'
    + '.bhr-top__k{font-size:12.5px;font-weight:600;color:#5E6B63;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.bhr-top__h{font-size:26px;font-weight:700;letter-spacing:-.03em;color:#14201B;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}'
    + '.bhr-top__b{width:40px;height:40px;flex:none;border-radius:50%;border:0;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#14201B;text-decoration:none;'
    + 'background:rgba(255,255,255,.75);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(20,32,27,.10)}'
    + '.bhr-top__b svg{width:19px;height:19px}'
    + '.bhr-top__i{border:1.5px solid #14201B;background:transparent;box-shadow:none;font-weight:700;font-size:15px;color:#1F6B4C}'
    + '}'
    + '@media (min-width:' + BP + 'px){.bhr-tabs,.bhr-top{display:none!important}}'
    + '.bhr-rail a{text-decoration:none}'
    + '.bhr-rail .gx-nav{width:232px;display:flex;flex-direction:column;gap:4px;padding:20px 12px 14px;border-radius:30px;box-sizing:border-box;'
    + 'background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.55) 55%,rgba(255,255,255,.66));'
    + 'backdrop-filter:blur(44px) saturate(230%) brightness(1.07);-webkit-backdrop-filter:blur(44px) saturate(230%) brightness(1.07);'
    + 'border:1px solid rgba(255,255,255,.6);box-shadow:inset 0 1.5px 1px rgba(255,255,255,.95),inset 0 -1.5px 1px rgba(255,255,255,.45),0 14px 38px rgba(20,32,27,.14);transition:width .25s ease}'
    + '.bhr-rail .gx-logo{display:flex;align-items:center;gap:10px;padding:2px 8px 22px;min-height:60px}'
    + '.bhr-rail .gx-logo .mono{width:36px;height:36px;flex:0 0 36px;border-radius:10px;display:block;margin-left:-2px}'
    + '.bhr-rail .gx-logo .full{font-size:16.5px;font-weight:700;letter-spacing:-.02em;color:#14201B;white-space:nowrap}'
    + '.bhr-rail .gx-item{position:relative;display:flex;align-items:center;gap:12px;height:44px;padding:0 12px;border-radius:14px;color:#3E4A44;font-size:14.5px;font-weight:500;border:0;background:transparent;font-family:inherit;cursor:pointer;text-align:left;width:100%;box-sizing:border-box}'
    + '.bhr-rail .gx-item:hover{background:rgba(0,0,0,.05);color:#14201B}'
    + '.bhr-rail .gx-item.is-active{background:rgba(0,0,0,.07);color:#14201B;font-weight:600}'
    + '.bhr-rail .gx-item svg{width:20px;height:20px;flex:0 0 22px}'
    + '.bhr-rail .gx-item .lbl{flex:1;white-space:nowrap}'
    + '.bhr-rail .gx-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#A8452A;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;box-sizing:border-box}'
    + '.bhr-rail .gx-badge.on{display:flex}'
    + '.bhr-rail .gx-collapse{height:40px;color:#5E6B63;font-size:13.5px}'
    + '.bhr-rail .gx-sep{height:1px;background:rgba(20,32,27,.08);margin:6px 8px}'
    + '.bhr-rail .gx-account{display:flex;align-items:center;gap:10px;padding:8px;border:0;border-radius:16px;background:transparent;font-family:inherit;cursor:pointer;text-align:left;width:100%}'
    + '.bhr-rail .gx-account:hover{background:rgba(0,0,0,.05)}'
    + '.bhr-rail .gx-initials{width:36px;height:36px;flex:0 0 36px;border-radius:50%;background:rgba(46,139,98,.13);color:#1F6B4C;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}'
    + '.bhr-rail .gx-account .txt{display:flex;flex-direction:column;min-width:0}'
    + '.bhr-rail .gx-account .t1{font-size:14px;font-weight:600;color:#14201B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.bhr-rail .gx-account .t2{font-size:12.5px;color:#5E6B63}'
    + 'html.bh-rail-collapsed .bhr-rail .gx-nav{width:68px}'
    + 'html.bh-rail-collapsed .bhr-rail .gx-logo .full,html.bh-rail-collapsed .bhr-rail .gx-item .lbl,html.bh-rail-collapsed .bhr-rail .gx-account .txt{display:none}'
    + 'html.bh-rail-collapsed .bhr-rail .gx-badge{position:absolute;top:6px;left:26px}';

  function svg(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
  var IC = {
    today: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M7 14h10M7 18h6"/>'),
    calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    messages: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    manage: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    side: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>')
  };
  function item(key, href, label, extra) {
    return '<a class="gx-item' + (active === key ? ' is-active' : '') + '" href="' + href + '" title="' + label + '"' + (active === key ? ' aria-current="page"' : '') + '>' + IC[key] + '<span class="lbl">' + label + '</span>' + (extra || '') + '</a>';
  }

  function collapsed() { try { return localStorage.getItem('gx_sidebar_collapsed') !== '0'; } catch (e) { return true; } }
  function applyWidth() {
    var c = document.documentElement.classList.contains('bh-rail-collapsed');
    document.documentElement.style.setProperty('--bh-rail-w', (c ? 68 : 232) + 16 + 16 + 'px');
  }

  function mount() {
    if (document.querySelector('.bhr-rail')) return;
    var st = document.createElement('style'); st.id = 'bh-gx-rail-css'; st.textContent = css; document.head.appendChild(st);
    var de = document.documentElement;
    de.classList.add('bh-rail-on');
    de.classList.toggle('bh-rail-collapsed', collapsed());
    applyWidth();
    var aside = document.createElement('aside');
    aside.className = 'bhr-rail';
    aside.innerHTML = '<nav class="gx-nav" aria-label="Navigation principale">'
      + '<a class="gx-logo" href="/app.html"><img class="mono" src="/img/brand/bh-icon-256.png" alt="Boostinghost"><span class="full">Boostinghost</span></a>'
      + item('today', '/app.html', 'Aujourd\'hui') + item('calendar', '/app.html#calendarSection', 'Calendrier')
      + item('messages', '/messages.html', 'Messages', '<span class="gx-badge" data-gx-unread></span>') + item('manage', '/manage.html', 'Gestion')
      + '<div style="flex:1"></div>'
      + '<button class="gx-item gx-collapse" type="button" data-rail-toggle title="' + (collapsed() ? 'Agrandir le menu' : 'Réduire le menu') + '">' + IC.side + '<span class="lbl">Réduire</span></button>'
      + '<div class="gx-sep"></div>'
      + '<button class="gx-account" data-account-sheet type="button" title="Mon compte"><span class="gx-initials" data-rail-ini>?</span><span class="txt"><span class="t1" data-rail-name>Mon compte</span><span class="t2">Changer de compte</span></span></button>'
      + '</nav>';
    document.body.appendChild(aside);
    try {
      var u = JSON.parse(localStorage.getItem('lcc_user') || localStorage.getItem('user') || '{}');
      var first = u.firstName || u.first_name || '';
      var name = [first, u.lastName || u.last_name].filter(Boolean).join(' ') || u.company || u.company_name || u.name || u.email || '';
      if (name) { aside.querySelector('[data-rail-name]').textContent = name; aside.querySelector('[data-rail-ini]').textContent = (first || name).trim().charAt(0).toUpperCase(); }
    } catch (e) {}
    aside.querySelector('[data-rail-toggle]').addEventListener('click', function () {
      var on = !de.classList.contains('bh-rail-collapsed');
      de.classList.toggle('bh-rail-collapsed', on);
      try { localStorage.setItem('gx_sidebar_collapsed', on ? '1' : '0'); } catch (e) {}
      this.title = on ? 'Agrandir le menu' : 'Réduire le menu';
      applyWidth();
      window.dispatchEvent(new Event('resize'));
    });
    mountTabs();
    mountTop();
    // En-tête mobile : bh-layout.js lui pose « left:0 » en style inline !important,
    // que seule une autre écriture inline peut corriger. On la refait s'il revient.
    function fixHeader() {
      var desk = window.innerWidth >= BP;
      document.querySelectorAll('.mobile-header, #bhMobileHeader').forEach(function (h) {
        var want = desk ? 'var(--bh-rail-w, 100px)' : '0px';
        if (h.style.getPropertyValue('left') !== want) h.style.setProperty('left', want, 'important');
        if (!h.__bhRailObs && window.MutationObserver) { h.__bhRailObs = new MutationObserver(fixHeader); h.__bhRailObs.observe(h, { attributes: true, attributeFilter: ['style'] }); }
      });
    }
    fixHeader(); setTimeout(fixHeader, 300); setTimeout(fixHeader, 1200);
    window.addEventListener('resize', fixHeader);
  }
  function mountTabs() {
    if (document.querySelector('.bhr-tabs')) return;
    var nav = document.createElement('nav');
    nav.className = 'bhr-tabs'; nav.setAttribute('aria-label', 'Onglets');
    nav.innerHTML = [['today', '/app.html', 'Aujourd\'hui'], ['calendar', '/app.html#calendarSection', 'Calendrier'], ['messages', '/messages.html', 'Messages'], ['manage', '/manage.html', 'Gestion']].map(function (t) {
      return '<a href="' + t[1] + '" data-tab="' + t[0] + '"' + (active === t[0] ? ' class="is-active" aria-current="page"' : '') + '>' + IC[t[0]] + '<span>' + t[2] + '</span>' + (t[0] === 'messages' ? '<span class="gx-badge" data-gx-unread></span>' : '') + '</a>';
    }).join('');
    document.body.appendChild(nav);
    document.documentElement.classList.add('bh-tabs-on');
  }

  function topTitle() {
    var b = document.body.dataset;
    if (active === 'today') return { k: new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }), t: 'Aujourd\'hui' };
    if (active === 'calendar' && page === 'app') return { k: 'Planning', t: 'Calendrier' };
    if (active === 'messages') return { k: b.kicker || 'Voyageurs', t: 'Messages' };
    return { k: b.kicker || '', t: b.title || (document.title || '').split(/[—|-]/)[0].trim() || 'Boostinghost' };
  }
  function mountTop() {
    if (document.querySelector('.bhr-top')) return;
    var top = document.createElement('header');
    top.className = 'bhr-top';
    var back = document.body.dataset.backHref && ['today', 'calendar', 'messages'].indexOf(active) < 0;
    var u = {}; try { u = JSON.parse(localStorage.getItem('lcc_user') || localStorage.getItem('user') || '{}'); } catch (e) {}
    var first = u.firstName || u.first_name || '', nm = first || u.company || u.company_name || u.name || u.email || '';
    top.innerHTML = (back ? '<a class="bhr-top__b" href="' + document.body.dataset.backHref.replace(/"/g, '') + '" aria-label="Retour">' + svg('<polyline points="15 18 9 12 15 6"/>') + '</a>' : '')
      + '<div class="bhr-top__t"><div class="bhr-top__k" data-top-k></div><h1 class="bhr-top__h" data-top-t></h1></div>'
      + '<button class="bhr-top__b" type="button" data-global-search aria-label="Rechercher">' + svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>') + '</button>'
      + '<button class="bhr-top__b bhr-top__i" type="button" data-account-sheet aria-label="Mon compte">' + (nm ? nm.trim().charAt(0).toUpperCase() : '?') + '</button>';
    document.body.appendChild(top);
    document.documentElement.classList.add('bh-top-on');
    fillTop();
  }
  function fillTop() {
    var x = topTitle(), k = document.querySelector('[data-top-k]'), t = document.querySelector('[data-top-t]');
    if (!k) return;
    if (x.k && x.k.toLowerCase() === String(x.t).toLowerCase()) x.k = '';
    k.textContent = x.k || '';
    k.style.display = x.k ? '' : 'none';
    t.textContent = x.t;
  }

  // Aujourd'hui ↔ Calendrier sur app.html : bascule sans recharger (showTodayMode / showCalendarMode
  // d'app.html), et onglet actif tenu à jour (app.html appelle window.bhUpdateRailActive).
  function syncActive() {
    if (!/\/(app|index|dashboard)\.html$/.test(location.pathname) && location.pathname !== '/') return;
    var cal = document.body.classList.contains('bh-cal-mode') || location.hash === '#calendarSection';
    active = cal ? 'calendar' : 'today';
    document.querySelectorAll('.bhr-rail .gx-item[href^="/app.html"], .bhr-tabs a[href^="/app.html"]').forEach(function (a) {
      var isCal = a.getAttribute('href') === '/app.html#calendarSection', on = isCal === cal;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    fillTop();
  }
  window.bhUpdateRailActive = syncActive;
  window.addEventListener('hashchange', syncActive);
  window.addEventListener('popstate', function () { setTimeout(syncActive, 0); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.bhr-rail a[href^="/app.html"], .bhr-tabs a[href^="/app.html"]');
    if (!a || !/\/app\.html$/.test(location.pathname) || typeof window.showCalendarMode !== 'function') return;
    e.preventDefault();
    if (a.getAttribute('href') === '/app.html#calendarSection') window.showCalendarMode(); else window.showTodayMode();
    syncActive();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.addEventListener('load', function () { setTimeout(syncActive, 50); });
})();

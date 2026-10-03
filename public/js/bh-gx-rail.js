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
    + 'html.bh-rail-on .mobile-tabs,html.bh-rail-on .tab-bar{display:none!important}'
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
    + '@media (max-width:' + (BP - 1) + 'px){.bhr-rail{display:none!important}}'
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
    // Calendrier et Aujourd'hui partagent app.html : l'onglet actif suit l'ancre.
    window.addEventListener('hashchange', function () {
      if (active !== 'today' && active !== 'calendar') return;
      var cal = location.hash === '#calendarSection';
      aside.querySelectorAll('.gx-item[href^="/app.html"]').forEach(function (a) { a.classList.toggle('is-active', (a.getAttribute('href') === '/app.html#calendarSection') === cal); });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

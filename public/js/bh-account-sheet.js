/* Boostinghost — feuille « Mon compte » (desktop + mobile web)
   Ouverte par le rond aux initiales de n'importe quelle page.
   Inclure : <script src="/js/bh-account-sheet.js" defer></script> */
(function () {
  'use strict';
  if (window.__bhAccountSheet) return;
  window.__bhAccountSheet = true;

  var CSS = "    /* Feuille Mon compte */\n    .bhas-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(20,32,27,.22);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .28s ease}\n    .bhas-sheet{position:fixed;z-index:2147483001;top:16px;right:16px;bottom:16px;width:460px;max-width:calc(100% - 32px);display:flex;flex-direction:column;border-radius:30px;overflow:hidden;\n      background:linear-gradient(168deg,rgba(245,242,234,.86),rgba(235,231,220,.82) 46%,rgba(226,221,208,.86));\n      backdrop-filter:blur(44px) saturate(230%) brightness(1.07);-webkit-backdrop-filter:blur(44px) saturate(230%) brightness(1.07);\n      border:1px solid rgba(255,255,255,.5);box-shadow:inset 0 1.5px 1px rgba(255,255,255,.95),inset 0 -1.5px 1px rgba(255,255,255,.45),0 24px 60px rgba(20,32,27,.28);\n      transform:translateX(calc(100% + 40px));opacity:0;pointer-events:none;transition:transform .34s cubic-bezier(.32,.72,0,1),opacity .2s ease}\n    html.bhas-open .bhas-scrim{opacity:1;pointer-events:auto}\n    html.bhas-open .bhas-sheet{transform:translateX(0);opacity:1;pointer-events:auto}\n    .bhas-sheet-halo{position:absolute;width:420px;height:420px;border-radius:50%;pointer-events:none}\n    .bhas-sheet-halo.a{top:-120px;right:-140px;background:radial-gradient(circle,rgba(46,139,98,.38),rgba(46,139,98,0) 68%);filter:blur(18px)}\n    .bhas-sheet-halo.b{bottom:-160px;left:-140px;background:radial-gradient(circle,rgba(168,69,42,.26),rgba(168,69,42,0) 68%);filter:blur(20px)}\n    .bhas-sheet-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:26px 28px 18px}\n    .bhas-sheet-head h2{margin:0;font-size:30px;font-weight:700;letter-spacing:-0.032em;color:#14201B}\n    .bhas-close{height:36px;padding:0 14px;border:0;border-radius:18px;background:rgba(255,255,255,.5);color:#0E3B2E;font:inherit;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px}\n    .bhas-close:hover{background:rgba(255,255,255,.8)}\n    .bhas-close kbd{font-family:inherit;font-size:11.5px;font-weight:600;color:#5E6B63;padding:1px 6px;border-radius:6px;background:rgba(0,0,0,.05)}\n    .bhas-sheet-body{position:relative;flex:1;overflow-y:auto;padding:4px 28px 24px;display:grid;grid-auto-rows:max-content;align-content:start;gap:14px}\n    .bhas-profile{display:flex;align-items:center;gap:16px;padding:18px;border-radius:22px;background:rgba(255,255,255,.66);border:1px solid rgba(255,255,255,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 8px 22px rgba(20,32,27,.08);color:#14201B}\n    .bhas-profile:hover{background:rgba(255,255,255,.8);color:#14201B}\n    .bhas-profile .av{width:52px;height:52px;flex:0 0 52px;border-radius:50%;background:rgba(46,139,98,.13);color:#1F6B4C;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700}\n    .bhas-profile .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}\n    .bhas-profile .n{font-size:18.5px;font-weight:600;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n    .bhas-profile .s{font-size:14px;color:#5E6B63}\n    .bhas-group{display:flex;flex-direction:column;border-radius:22px;background:rgba(255,255,255,.62);border:1px solid rgba(255,255,255,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 8px 22px rgba(20,32,27,.06);overflow:hidden}\n    .bhas-row{display:flex;align-items:center;gap:14px;min-height:54px;padding:0 18px;color:#14201B}\n    .bhas-row + .bhas-row{border-top:1px solid rgba(20,32,27,.07)}\n    .bhas-row:hover{background:rgba(255,255,255,.5);color:#14201B}\n    .bhas-row svg.i{width:20px;height:20px;flex:0 0 22px;color:#2C3A33}\n    .bhas-row .l{flex:1;min-width:0;font-size:15.5px;font-weight:500}\n    .bhas-row .v{font-size:14px;color:#5E6B63;white-space:nowrap}\n    .bhas-row .v.state{color:#0E3B2E;font-weight:600}\n    .bhas-logout{height:54px;border-radius:22px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.62);box-shadow:inset 0 1px 0 rgba(255,255,255,.85);color:#A8452A;font:inherit;font-size:16.5px;font-weight:600;cursor:pointer}\n    .bhas-logout:hover{background:rgba(255,236,229,.85)}\n    .bhas-sheet-foot{display:flex;justify-content:center;align-items:center;gap:8px;padding-top:4px;font-size:12.5px;color:#5E6B63}\n    .bhas-sheet-foot a{color:#5E6B63}\n    html.bhas-sub .bhas-group{display:none}\n    .bhas-sheet,.bhas-sheet *{box-sizing:border-box}\n    .bhas-sheet{font-family:'DM Sans',system-ui,-apple-system,sans-serif;color:#14201B;-webkit-font-smoothing:antialiased;text-align:left}\n    .bhas-sheet a{text-decoration:none}\n    .bhas-sheet h2{line-height:1.1}\n    @media (max-width:859px){.bhas-sheet{top:8px;right:8px;bottom:8px;max-width:calc(100% - 16px)}}\n";
  var HTML = "  \n  <div class=\"bhas-scrim\" id=\"bhasScrim\"></div>\n  <aside class=\"bhas-sheet\" id=\"bhasSheet\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"bhasSheetTitle\" aria-hidden=\"true\">\n    <i class=\"bhas-sheet-halo a\"></i><i class=\"bhas-sheet-halo b\"></i>\n    <header class=\"bhas-sheet-head\">\n      <h2 id=\"bhasSheetTitle\">Mon compte</h2>\n      <button class=\"bhas-close\" id=\"bhasSheetClose\" type=\"button\">Fermer<kbd>Échap</kbd></button>\n    </header>\n    <div class=\"bhas-sheet-body\">\n      <a class=\"bhas-profile\" href=\"/settings-account.html\">\n        <span class=\"av\" id=\"bhasProfileInitials\">?</span>\n        <span class=\"tx\"><span class=\"n\" id=\"bhasProfileName\">Mon compte</span><span class=\"s\" id=\"bhasProfileSub\">&#160;</span></span>\n        <svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg>\n      </a>\n      <div class=\"bhas-group\">\n            <a class=\"bhas-row\" href=\"/settings-account.html#abonnement\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"5\" width=\"20\" height=\"14\" rx=\"2\"/><path d=\"M2 10h20M6 15h4\"/></svg><span class=\"l\">Abonnement et factures</span><span class=\"v\" id=\"bhasvPlan\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n            <a class=\"bhas-row\" href=\"/settings-account.html#equipe\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75\"/></svg><span class=\"l\">Mon équipe et accès</span><span class=\"v\" id=\"bhasvTeam\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n            <a class=\"bhas-row\" href=\"/settings-account.html#comptes\" data-bhas-switcher><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"2\" width=\"16\" height=\"20\" rx=\"2\"/><path d=\"M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01\"/></svg><span class=\"l\">Comptes gérés</span><span class=\"v\" id=\"bhasvAccounts\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n            <a class=\"bhas-row\" href=\"/settings-account.html#paiements\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"6\" width=\"20\" height=\"12\" rx=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"2.5\"/><path d=\"M6 12h.01M18 12h.01\"/></svg><span class=\"l\">Paiements</span><span class=\"v\" id=\"bhasvPayments\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n            <a class=\"bhas-row\" href=\"/settings.html\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\"/><path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\"/></svg><span class=\"l\">Plateformes connectées</span><span class=\"v state\" id=\"bhasvChannels\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n      </div>\n      <div class=\"bhas-group\">\n            <a class=\"bhas-row\" href=\"/cleaning.html\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z\"/><path d=\"M19 3v4M17 5h4\"/></svg><span class=\"l\">Ménage et prestataires</span><span class=\"v\" id=\"bhasvCleaners\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n            <a class=\"bhas-row\" href=\"/settings.html#messages\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z\"/><path d=\"M8 9h8M8 13h5\"/></svg><span class=\"l\">Messages automatiques</span><span class=\"v\" id=\"bhasvTemplates\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n            <a class=\"bhas-row\" href=\"/settings-account.html#notifications\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9\"/><path d=\"M13.73 21a2 2 0 0 1-3.46 0\"/></svg><span class=\"l\">Notifications</span><span class=\"v\" id=\"bhasvNotifs\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n      </div>\n      <div class=\"bhas-group\">\n            <a class=\"bhas-row\" href=\"/help.html\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01\"/></svg><span class=\"l\">Aide et tutoriels</span><span class=\"v\" id=\"bhasvHelp\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n            <a class=\"bhas-row\" href=\"/support.html\"><svg class=\"i\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\"/><path d=\"m22 6-10 7L2 6\"/></svg><span class=\"l\">Nous écrire</span><span class=\"v\" id=\"bhasvSupport\"></span><svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5E6B63\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 18 15 12 9 6\"/></svg></a>\n      </div>\n      <button class=\"bhas-logout\" id=\"bhasLogout\" type=\"button\">Se déconnecter</button>\n      <div class=\"bhas-sheet-foot\"><span>Boostinghost 3.2</span><span>·</span><a href=\"/cgu.html\">CGU</a><span>·</span><a href=\"/confidentialite.html\">Confidentialité</a></div>\n    </div>\n  </aside>\n";
  var TRIGGERS = '.bh-header-initials-btn, .bh-ios-initials-button, [data-account-sheet]';

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function $(id) { return document.getElementById(id); }

  function mount() {
    if ($('bhasSheet')) return;
    if (!document.querySelector('link[href*="DM+Sans"]')) {
      var f = document.createElement('link');
      f.rel = 'stylesheet';
      f.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap';
      document.head.appendChild(f);
    }
    var st = document.createElement('style');
    st.id = 'bhasStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
    var wrap = document.createElement('div');
    wrap.innerHTML = HTML;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    $('bhasSheetClose').addEventListener('click', close);
    $('bhasScrim').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.documentElement.classList.contains('bhas-open')) close();
    });
    $('bhasLogout').addEventListener('click', function () {
      if (typeof window.logout === 'function') return window.logout();
      ['lcc_token', 'lcc_user'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      location.href = '/login.html';
    });
    var sw = document.querySelector('[data-bhas-switcher]');
    if (sw) sw.addEventListener('click', function (e) {
      if (typeof origSwitcher === 'function') { e.preventDefault(); close(); origSwitcher(); }
    });
    $('bhasvHelp').textContent = 'FAQ · Guides';
    $('bhasvSupport').textContent = 'Réponse sous 2 h';
    fill();
  }

  function fill() {
    var isSub = ls('lcc_is_sub_account') === 'true' || ls('lcc_account_type') === 'sub';
    document.documentElement.classList.toggle('bhas-sub', isSub);
    var u = {};
    try { u = JSON.parse(ls('lcc_user') || ls('user') || '{}') || {}; } catch (e) {}
    var name = u.company || u.company_name || [u.firstName || u.first_name, u.lastName || u.last_name].filter(Boolean).join(' ') || u.name || u.email || '';
    if (name) {
      $('bhasProfileName').textContent = name;
      $('bhasProfileInitials').textContent = name.trim().charAt(0).toUpperCase();
    }
    var plan = u.plan || u.subscription_plan || u.subscriptionPlan || '';
    if (plan) { plan = String(plan); plan = plan.charAt(0).toUpperCase() + plan.slice(1); $('bhasvPlan').textContent = plan; }

    var get = function (url) {
      var p = typeof window.authFetch === 'function'
        ? window.authFetch(url)
        : fetch(url, { headers: { Authorization: 'Bearer ' + (ls('lcc_token') || '') } });
      return p.then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    };
    Promise.all([get('/api/properties'), get('/api/properties/diffusion')]).then(function (res) {
      var pc = (res[0].properties && res[0].properties.length) || 0;
      var parts = [];
      if (plan) parts.push('Formule ' + plan);
      if (pc) parts.push(pc === 1 ? '1 logement' : pc + ' logements');
      $('bhasProfileSub').textContent = parts.join(' · ') || '\u00a0';
      var l = res[1].logements;
      if (l && l.length) {
        var d = l.filter(function (x) { return !(x.a_regler > 0); }).length;
        if (d) $('bhasvChannels').textContent = d + (d === 1 ? ' diffusé' : ' diffusés');
      }
    });
  }

  var lastFocus = null;
  function open() {
    mount();
    lastFocus = document.activeElement;
    document.documentElement.classList.add('bhas-open');
    $('bhasSheet').setAttribute('aria-hidden', 'false');
    setTimeout(function () { var c = $('bhasSheetClose'); if (c) c.focus(); }, 50);
  }
  function close() {
    document.documentElement.classList.remove('bhas-open');
    var s = $('bhasSheet'); if (s) s.setAttribute('aria-hidden', 'true');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Le rond aux initiales ouvre la feuille ; l'ancien sélecteur d'agence reste accessible via « Comptes gérés ».
  var origSwitcher = null;
  function hijack() {
    var cur = window.openAgencySwitcherModal;
    if (cur && cur !== open && !cur.__bhas) origSwitcher = cur;
    if (cur !== open) { window.openAgencySwitcherModal = open; open.__bhas = true; }
  }
  hijack();
  window.addEventListener('load', hijack);
  setTimeout(hijack, 1500);

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest(TRIGGERS);
    if (!t || t.closest('#bhasSheet')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    open();
  }, true);

  window.BHAccountSheet = { open: open, close: close };
})();

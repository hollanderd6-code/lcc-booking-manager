// ============================================================
// 🔎 RECHERCHE GLOBALE BOOSTINGHOST
// Ouverture : bouton loupe (header mobile / barre desktop) ou Ctrl/Cmd+K.
// Cherche : réservations (voyageur, logement), conversations, logements, pages.
// Auto-contenu : styles injectés, deep-links gérés par ce même fichier.
// ============================================================
(function () {
  'use strict';
  if (window.__bhSearchLoaded) return; window.__bhSearchLoaded = true;

  var token = function () { return localStorage.getItem('lcc_token') || ''; };
  var norm = function (t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  };

  // ── Deep-links traités à l'arrivée sur la page cible ──
  var params = new URLSearchParams(location.search);
  if (params.get('bhconv')) {
    var convId = params.get('bhconv');
    var tries = 0;
    var t1 = setInterval(function () {
      if (window.openChat) { clearInterval(t1); window.openChat(convId); }
      else if (++tries > 60) clearInterval(t1);
    }, 250);
  }
  if (params.get('bhq')) {
    var q0 = params.get('bhq');
    var tries2 = 0;
    var t2 = setInterval(function () {
      var inp = document.getElementById('searchInput') || document.getElementById('mobileSearch');
      if (inp) {
        clearInterval(t2);
        var m = document.getElementById('mobileSearch');
        if (inp) inp.value = q0;
        if (m) m.value = q0;
        if (window.applyFilters) window.applyFilters();
        else inp.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (++tries2 > 60) clearInterval(t2);
    }, 250);
  }

  // ── Styles ──
  var st = document.createElement('style');
  st.textContent = [
    '.bhgs-overlay{position:fixed;inset:0;z-index:100000;background:rgba(13,17,23,.5);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;justify-content:center;align-items:flex-start;padding:calc(8vh + env(safe-area-inset-top,0px)) 14px 14px;}',
    '.bhgs{background:#FAF7F2;border:1px solid rgba(200,184,154,.55);border-radius:22px;width:100%;max-width:560px;box-shadow:0 24px 70px rgba(13,17,23,.3);overflow:hidden;display:flex;flex-direction:column;max-height:min(70vh,560px);font-family:\'DM Sans\',sans-serif;}',
    '.bhgs-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(200,184,154,.4);background:#fff;}',
    '.bhgs-head i{color:#B7791F;font-size:14px;}',
    '.bhgs-head input{flex:1;border:none;outline:none;background:transparent;font-family:\'DM Sans\',sans-serif;font-size:16px;color:#0D1117;}',
    '.bhgs-head input::placeholder{color:#B0A896;}',
    '.bhgs-close{border:1px solid rgba(200,184,154,.5);background:#FBF8F3;color:#6B7280;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:12px;flex:none;}',
    '.bhgs-res{flex:1;overflow-y:auto;padding:6px;}',
    '.bhgs-grp{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#B7791F;padding:10px 14px 4px;}',
    '.bhgs-item{display:flex;align-items:center;gap:11px;padding:10px 14px;border-radius:13px;cursor:pointer;transition:background .12s;}',
    '.bhgs-item:hover,.bhgs-item.actif{background:rgba(26,122,94,.08);}',
    '.bhgs-ic{flex:none;width:32px;height:32px;border-radius:10px;background:rgba(26,122,94,.1);color:#1A7A5E;display:flex;align-items:center;justify-content:center;font-size:13px;}',
    '.bhgs-l{min-width:0;flex:1;}',
    '.bhgs-t{font-size:14px;font-weight:600;color:#0D1117;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.bhgs-s{font-size:12px;color:#8A8375;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.bhgs-vide{padding:28px 20px;text-align:center;color:#8A8375;font-size:13.5px;}',
    '.bhgs-trigger-mobile{width:38px;height:38px;border-radius:50%;border:1px solid rgba(200,184,154,.5);background:#fff;color:#1A7A5E;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;margin-right:8px;}',
    '.bhgs-trigger-desktop{width:28px;height:24px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:transparent;color:rgba(255,255,255,.6);font-size:11px;cursor:pointer;flex:none;}',
    '.bhgs-trigger-desktop:hover{background:rgba(255,255,255,.1);color:#fff;}',
    /* Pages au logo centr\u00e9 : loupe \u00e9pingl\u00e9e \u00e0 droite, le logo ne bouge pas */

    '.mobile-header .bhgs-trigger-mobile.bhgs-abs{position:absolute;right:12px;top:calc(50% + env(safe-area-inset-top,0px)/2);transform:translateY(-50%);margin:0;z-index:5}',
    /* app.html : logo ABSOLUMENT centr\u00e9, c\u00f4t\u00e9s compact\u00e9s */
    '@media (max-width:700px){',
    '  .mobile-header.bhgs-app{position:relative!important}',
    '  .mobile-header.bhgs-app>a.mobile-logo{position:absolute!important;left:50%!important;top:calc(50% + env(safe-area-inset-top,0px)/2)!important;transform:translate(-50%,-50%)!important;z-index:1;max-width:42vw}',
    '  .mobile-header.bhgs-app>div{position:relative;z-index:2}',
    '  #bh-mobile-svc i{display:none!important}',
    '  #bh-mobile-svc>div:nth-child(2){display:none!important}',
    '  #bh-mobile-svc{padding:2px 5px!important;gap:2px!important}',
    '  .mobile-header.bhgs-app>div[style*="flex-end"]{gap:0!important}',
    '  .mobile-header.bhgs-app>div[style*="flex-end"]>*{width:30px!important;height:30px!important;min-width:30px!important}',
    '  .mobile-header .mobile-logo{min-width:0}',
    '  .mobile-header .mobile-logo-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
    '  .mobile-header .mobile-logo-subtitle{display:none!important}',
    '}'
  ].join('\n');
  document.head.appendChild(st);

  // ── Données (cache 60 s) ──
  var cache = null, cacheT = 0;
  function fetchJson(url) {
    return fetch(url, { headers: { Authorization: 'Bearer ' + token() } })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }
  function donnees() {
    if (cache && Date.now() - cacheT < 60000) return Promise.resolve(cache);
    return Promise.all([
      fetchJson('/api/reservations'),
      fetchJson('/api/properties'),
      fetchJson('/api/chat/conversations')
    ]).then(function (r) {
      cache = {
        resas: r[0].reservations || r[0] || [],
        props: r[1].properties || r[1] || [],
        convs: r[2].conversations || r[2] || []
      };
      if (!Array.isArray(cache.resas)) cache.resas = [];
      if (!Array.isArray(cache.props)) cache.props = [];
      if (!Array.isArray(cache.convs)) cache.convs = [];
      cacheT = Date.now();
      return cache;
    });
  }

  var PAGES = [
    ['Dashboard', '/app.html', 'fa-chart-line'],
    ['Réservations', '/reservations.html', 'fa-calendar-check'],
    ['Messages', '/messages.html', 'fa-comments'],
    ['Mes logements', '/settings.html', 'fa-home'],
    ['Cautions & paiements', '/deposits.html', 'fa-shield-alt'],
    ['Gestion du ménage', '/cleaning.html', 'fa-broom'],
    ['Factures', '/factures.html', 'fa-file-invoice'],
    ['Livrets d\u2019accueil', '/welcome.html', 'fa-book-open'],
    ['Clients', '/clients.html', 'fa-users'],
    ['Serrures connectées', '/smart-locks.html', 'fa-lock'],
    ['Mon compte', '/settings-account.html', 'fa-user-cog']
  ];

  function fmtD(d) {
    if (!d) return '';
    var x = new Date(d);
    return isNaN(x) ? '' : x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  // ── Overlay ──
  window.bhOpenSearch = function () {
    if (document.querySelector('.bhgs-overlay')) return;
    var ov = document.createElement('div');
    ov.className = 'bhgs-overlay';
    ov.innerHTML =
      '<div class="bhgs">' +
      '  <div class="bhgs-head"><i class="fas fa-search"></i>' +
      '    <input type="search" placeholder="Voyageur, logement, page\u2026" autocomplete="off">' +
      '    <button class="bhgs-close" type="button"><i class="fas fa-times"></i></button></div>' +
      '  <div class="bhgs-res"></div>' +
      '</div>';
    document.body.appendChild(ov);
    var inp = ov.querySelector('input'), zone = ov.querySelector('.bhgs-res');
    setTimeout(function () { inp.focus(); }, 60);

    var items = [], actif = 0;
    function fermer() { ov.remove(); document.removeEventListener('keydown', onKey, true); }
    function executer(it) { fermer(); it.go(); }

    function dessiner() {
      if (!items.length) {
        zone.innerHTML = '<div class="bhgs-vide">Aucun résultat. Essayez un nom de voyageur ou de logement.</div>';
        return;
      }
      var html = '', grp = '';
      items.forEach(function (it, i) {
        if (it.grp !== grp) { grp = it.grp; html += '<div class="bhgs-grp">' + grp + '</div>'; }
        html += '<div class="bhgs-item ' + (i === actif ? 'actif' : '') + '" data-i="' + i + '">' +
          '<span class="bhgs-ic"><i class="fas ' + it.ic + '"></i></span>' +
          '<span class="bhgs-l"><span class="bhgs-t"></span><span class="bhgs-s"></span></span></div>';
      });
      zone.innerHTML = html;
      zone.querySelectorAll('.bhgs-item').forEach(function (el) {
        var it = items[Number(el.dataset.i)];
        el.querySelector('.bhgs-t').textContent = it.t;
        el.querySelector('.bhgs-s').textContent = it.s || '';
        el.addEventListener('click', function () { executer(it); });
      });
      var a = zone.querySelector('.bhgs-item.actif');
      if (a) a.scrollIntoView({ block: 'nearest' });
    }

    function chercher() {
      var q = norm(inp.value.trim());
      var out = [];
      PAGES.filter(function (p) { return !q || norm(p[0]).indexOf(q) !== -1; })
        .slice(0, q ? 4 : 6)
        .forEach(function (p) {
          out.push({ grp: 'Pages', ic: p[2], t: p[0], go: function () { location.href = p[1]; } });
        });
      if (q.length < 2) { items = out; actif = 0; dessiner(); return; }
      donnees().then(function (d) {
        if (norm(inp.value.trim()) !== q) return; // saisie plus récente
        d.convs.filter(function (c) {
          return norm((c.guest_display_name || c.guest_name || '') + ' ' + (c.property_name || '')).indexOf(q) !== -1;
        }).slice(0, 5).forEach(function (c) {
          out.push({ grp: 'Conversations', ic: 'fa-comment', t: c.guest_display_name || c.guest_name || 'Voyageur',
            s: c.property_name || '',
            go: function () { location.href = '/messages.html?bhconv=' + encodeURIComponent(c.id); } });
        });
        d.resas.filter(function (r) {
          return norm((r.guest_name || r.guestName || '') + ' ' + (r.property_name || r.propertyName || '')).indexOf(q) !== -1;
        }).slice(0, 5).forEach(function (r) {
          var nom = r.guest_name || r.guestName || 'Voyageur';
          var deb = fmtD(r.start_date || r.startDate || r.checkin);
          var fin = fmtD(r.end_date || r.endDate || r.checkout);
          out.push({ grp: 'Réservations', ic: 'fa-calendar-check', t: nom,
            s: (r.property_name || r.propertyName || '') + (deb ? ' · ' + deb + ' → ' + fin : ''),
            go: function () { location.href = '/reservations.html?bhq=' + encodeURIComponent(nom); } });
        });
        d.props.filter(function (p) {
          return norm((p.name || '') + ' ' + (p.address || '')).indexOf(q) !== -1;
        }).slice(0, 5).forEach(function (p) {
          out.push({ grp: 'Logements', ic: 'fa-home', t: p.name || '',
            s: p.address || '', go: function () { location.href = '/settings.html'; } });
        });
        items = out; actif = 0; dessiner();
      });
      items = out; actif = 0; dessiner(); // rendu immédiat des pages pendant le fetch
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); fermer(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); actif = Math.min(actif + 1, items.length - 1); dessiner(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); actif = Math.max(actif - 1, 0); dessiner(); }
      else if (e.key === 'Enter' && items[actif]) { e.preventDefault(); executer(items[actif]); }
    }
    document.addEventListener('keydown', onKey, true);
    inp.addEventListener('input', chercher);
    ov.querySelector('.bhgs-close').addEventListener('click', fermer);
    ov.addEventListener('click', function (e) { if (e.target === ov) fermer(); });
    chercher();
  };

  // ── Déclencheurs ──
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); bhOpenSearch(); }
  });
  function injecter() {
    // Cibler le header VISIBLE (certaines pages en ont un statique caché
    // + un reconstruit par bh-layout ; injecter dans le caché ne sert à rien)
    var mh = null;
    document.querySelectorAll('.mobile-header').forEach(function (h) {
      if (!mh && window.getComputedStyle(h).display !== 'none') mh = h;
    });
    // Rééquilibrage du header app à CHAQUE passe (le bouton agence
    // peut être injecté après la loupe par un autre script)
    if (mh && mh.querySelector('#bh-mobile-svc')) {
      var dr = mh.querySelector('div[style*="flex-end"]');
      var ga = mh.querySelector('div[style*="flex-start"]');
      if (dr && ga) Array.prototype.slice.call(dr.children).forEach(function (el) {
        if (el.id === 'syncBtnMobile' || el.id === 'bh-mobile-notif-btn'
            || el.classList.contains('bhgs-trigger-mobile')) return;
        ga.appendChild(el);
      });
    }
    if (mh && !mh.querySelector('.bhgs-trigger-mobile')) {
      var b = document.createElement('button');
      b.className = 'bhgs-trigger-mobile'; b.type = 'button';
      b.setAttribute('aria-label', 'Rechercher');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>';
      b.addEventListener('click', bhOpenSearch);
      if (mh.querySelector('#bh-mobile-svc')) {
        // app.html : header 3 zones -> loupe dans le groupe d'actions,
        // et classe pour le centrage absolu du logo
        mh.classList.add('bhgs-app');
        var droite = mh.querySelector('div[style*="flex-end"]');
        if (droite) droite.appendChild(b); else mh.appendChild(b);
      } else {
        // logo centr\u00e9 seul -> loupe \u00e9pingl\u00e9e \u00e0 droite en absolu
        b.classList.add('bhgs-abs');
        if (window.getComputedStyle(mh).position === 'static') mh.style.position = 'relative';
        mh.appendChild(b);
      }
    }
    var right = document.querySelector('.bh-demo-nav .bh-demo-right');
    if (right && !right.querySelector('.bhgs-trigger-desktop')) {
      var d = document.createElement('button');
      d.className = 'bhgs-trigger-desktop'; d.type = 'button';
      d.title = 'Rechercher (Ctrl+K)';
      d.innerHTML = '<i class="fas fa-search"></i>';
      d.addEventListener('click', bhOpenSearch);
      right.insertBefore(d, right.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injecter);
  else injecter();
  setTimeout(injecter, 800); setTimeout(injecter, 2500); setTimeout(injecter, 5000); setTimeout(injecter, 9000); // headers reconstruits par bh-layout.js
})();

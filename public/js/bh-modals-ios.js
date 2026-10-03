/* Boostinghost — modales façon iOS sur tout le site
   Détecte automatiquement les fenêtres modales (overlay plein écran + panneau)
   et leur applique la charte de l'app iOS : verre, rayons 30, typographie DM Sans,
   boutons verts, champs arrondis, bouton fermer en pastille.
   Inclure : <script src="/js/bh-modals-ios.js" defer></script> */
(function () {
  'use strict';
  if (window.__bhModalsIos) return;
  window.__bhModalsIos = true;

  var SKIP = '#bhasSheet, #bhasScrim, #bhasSr, #bhasSrScrim, .bhas-sheet, .bhas-sr, .bhp-sheet, .bhp-overlay, .sidebar-overlay, .loading-overlay, [data-bhm-skip]';

  var CSS = `
html.bhm-open #fabAddResa,html.bhm-open .bhr-tabs{opacity:0 !important;pointer-events:none !important}
html.bhm-open .bhm-tabbar{opacity:0 !important;pointer-events:none !important;transform:translateY(20px) !important;transition:opacity .2s ease,transform .2s ease !important}
.bhm-overlay{background:rgba(20,32,27,.24) !important;-webkit-backdrop-filter:blur(4px) !important;backdrop-filter:blur(4px) !important}
.bhm-panel{
  background:linear-gradient(168deg,rgba(245,242,234,.97),rgba(235,231,220,.95) 46%,rgba(226,221,208,.97)) !important;
  -webkit-backdrop-filter:blur(44px) saturate(230%) !important;backdrop-filter:blur(44px) saturate(230%) !important;
  border:1px solid rgba(255,255,255,.55) !important;
  box-shadow:inset 0 1.5px 1px rgba(255,255,255,.95),inset 0 -1.5px 1px rgba(255,255,255,.45),0 24px 60px rgba(20,32,27,.28) !important;
  font-family:'DM Sans',system-ui,-apple-system,sans-serif !important;color:#14201B !important;-webkit-font-smoothing:antialiased}
.bhm-panel.bhm-round{border-radius:30px !important}
.bhm-panel.bhm-bottom{border-radius:30px 30px 0 0 !important}
.bhm-panel :is(p,span,div,label,li,td,th,small,strong,b,a,h1,h2,h3,h4,h5,h6,input,select,textarea,button):not(.fa):not(.fas):not(.far):not(.fab):not(.fa-solid):not(.fa-regular):not([class*="material"]){font-family:'DM Sans',system-ui,-apple-system,sans-serif !important}
.bhm-panel :is(h1,h2,h3){letter-spacing:-0.02em !important;color:#14201B !important;font-weight:700 !important}
.bhm-panel .bhm-title{font-size:22px !important;line-height:1.2 !important}
.bhm-panel .bhm-head{background:transparent !important;background-image:none !important;color:#14201B !important;border-bottom:1px solid rgba(20,32,27,.07) !important;box-shadow:none !important}
.bhm-panel .bhm-head *:not(.bhm-close):not(.bhm-close *){color:#14201B !important}
.bhm-panel .bhm-head i:not(.bhm-close i){color:#0E3B2E !important}
.bhm-panel .bhm-close{width:36px !important;height:36px !important;min-width:36px !important;padding:0 !important;border-radius:50% !important;border:1px solid rgba(255,255,255,.75) !important;
  background:rgba(255,255,255,.62) !important;-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 4px 12px rgba(20,32,27,.08) !important;
  color:#14201B !important;display:inline-flex !important;align-items:center !important;justify-content:center !important;font-size:15px !important;line-height:1 !important;cursor:pointer;transition:transform .15s ease,background .15s ease}
.bhm-panel .bhm-close:hover{background:rgba(255,255,255,.9) !important;transform:scale(1.05)}
.bhm-panel .bhm-close *{color:#14201B !important;font-size:14px !important}
.bhm-panel .bhm-btn{border-radius:15px !important;min-height:44px;font-weight:600 !important;transition:background .15s ease,transform .1s ease !important}
.bhm-panel .bhm-btn:active{transform:scale(.98)}
.bhm-panel .bhm-btn-primary{background:#0E3B2E !important;background-image:none !important;color:#fff !important;border:1px solid #0E3B2E !important;box-shadow:0 6px 16px rgba(14,59,46,.22) !important}
.bhm-panel .bhm-btn-primary *{color:#fff !important}
.bhm-panel .bhm-btn-primary:hover{background:#174D3D !important}
.bhm-panel .bhm-btn-secondary{background:rgba(255,255,255,.7) !important;background-image:none !important;color:#14201B !important;border:1px solid rgba(255,255,255,.85) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(20,32,27,.05) !important}
.bhm-panel .bhm-btn-secondary:hover{background:#fff !important}
.bhm-panel .bhm-btn-danger{background:rgba(255,255,255,.7) !important;background-image:none !important;color:#A8452A !important;border:1px solid rgba(255,222,210,.9) !important;box-shadow:none !important}
.bhm-panel .bhm-btn-danger *{color:#A8452A !important}
.bhm-panel .bhm-btn-danger:hover{background:rgba(255,236,229,.95) !important}
.bhm-panel .bhm-btn-on{background:rgba(46,139,98,.13) !important;color:#0E3B2E !important;border:1.5px solid #0E3B2E !important;box-shadow:none !important}
.bhm-panel .bhm-btn-on *{color:#0E3B2E !important}
.bhm-panel :is(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden]),select,textarea){
  box-sizing:border-box !important;max-width:100%;border-radius:13px !important;border:1px solid rgba(20,32,27,.1) !important;background:rgba(255,255,255,.78) !important;color:#14201B !important;min-height:44px;font-size:15px !important;box-shadow:none !important;outline:none !important}
.bhm-panel textarea{min-height:90px}
.bhm-panel :is(input,select,textarea):focus{border-color:#2E8B62 !important;box-shadow:0 0 0 3px rgba(46,139,98,.15) !important;background:#fff !important}
.bhm-panel :is(input[type=checkbox],input[type=radio]){accent-color:#0E3B2E}
.bhm-panel .bhm-card{background:rgba(255,255,255,.62) !important;border:1px solid rgba(255,255,255,.75) !important;border-radius:18px !important;box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 4px 14px rgba(20,32,27,.05) !important}
.bhm-panel .bhm-label{color:#5E6B63 !important;letter-spacing:.11em !important;font-weight:700 !important}
.bhm-panel .bhm-muted{color:#5E6B63 !important}
.bhm-panel .bhm-accent{color:#0E3B2E !important}
.bhm-panel .bhm-accent-bg{background:#0E3B2E !important;background-image:none !important;color:#fff !important;border-color:#0E3B2E !important}
.bhm-panel hr{border:0 !important;border-top:1px solid rgba(20,32,27,.08) !important}
.bhm-panel ::-webkit-scrollbar{width:8px}.bhm-panel ::-webkit-scrollbar-thumb{background:rgba(20,32,27,.18);border-radius:4px}
`;

  /* ── Couleurs ── */
  function rgb(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function hsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) { var d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return { h: h, s: s, l: l };
  }
  function isOpaque(c) { return c && c.a > .6; }
  function isWhiteish(c) { return c && c.a > .5 && c.r > 235 && c.g > 235 && c.b > 235; }
  function isDark(c) { return c && c.a > .6 && hsl(c).l < .42; }
  function isPurple(c) { if (!c || c.a < .4) return false; var x = hsl(c); return x.s > .35 && x.h >= 245 && x.h <= 300 && x.l > .2 && x.l < .8; }
  function isRed(c) { if (!c || c.a < .4) return false; var x = hsl(c); return x.s > .45 && (x.h <= 12 || x.h >= 345) && x.l > .3 && x.l < .7; }
  function isStrongColor(c) { if (!c || c.a < .6) return false; var x = hsl(c); return x.s > .35 && x.l > .18 && x.l < .62; }

  /* ── Détection ── */
  function visible(el, cs) {
    cs = cs || getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < .05) return false;
    var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  }
  function isOverlay(el) {
    if (el.closest(SKIP)) return false;
    var cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || !visible(el, cs)) return false;
    var r = el.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
    if (r.width < vw * .9 || r.height < vh * .9) return false;
    var z = parseInt(cs.zIndex, 10); if (!(z >= 20)) return false;
    return !!el.firstElementChild;
  }
  function findPanel(ov) {
    var vw = innerWidth, vh = innerHeight, best = null, bestArea = 0;
    var walk = function (el, depth) {
      if (depth > 4) return;
      [].forEach.call(el.children, function (c) {
        if (c.matches('script,style,link,template')) return;
        var cs = getComputedStyle(c); if (!visible(c, cs)) return;
        var r = c.getBoundingClientRect();
        var bg = rgb(cs.backgroundColor);
        var hasBg = (bg && bg.a > .3) || cs.backgroundImage !== 'none';
        // Sur téléphone les fenêtres prennent toute la largeur (feuille du bas) : on les
        // accepte tant qu'elles ne couvrent pas aussi toute la hauteur.
        if (hasBg && (r.width < vw * .98 || r.height < vh * .97) && r.width > 220 && r.height > 80) {
          var area = r.width * r.height; if (area > bestArea) { best = c; bestArea = area; }
          return;
        }
        walk(c, depth + 1);
      });
    };
    walk(ov, 0);
    return best;
  }
  function findTabbar() {
    document.querySelectorAll('nav, div, footer').forEach(function (el) {
      if (el.classList.contains('bhm-tabbar') || el.closest(SKIP)) return;
      var cs = getComputedStyle(el); if (cs.position !== 'fixed') return;
      var r = el.getBoundingClientRect(); if (r.bottom < innerHeight - 140 || r.height > 140 || r.height < 40) return;
      var t = el.textContent || '';
      if (t.indexOf('Gestion') >= 0 && t.indexOf('Messages') >= 0 && t.indexOf('Calendrier') >= 0) addC(el, 'bhm-tabbar');
    });
  }

  function addC(el, c) { if (el && !el.classList.contains(c)) el.classList.add(c); }
  // Certaines pages ciblent leurs fenêtres par #id (ex. #editPropertyModal .modal-header) : ces
  // règles battent nos classes même en !important. Un style inline !important passe devant tout.
  function force(el, props) { if (!el) return; for (var k in props) if (el.style.getPropertyValue(k) !== props[k] || el.style.getPropertyPriority(k) !== 'important') el.style.setProperty(k, props[k], 'important'); }
  var INK = '#14201B', VERT = '#0E3B2E';
  /* ── Habillage d'un panneau ── */
  function style(ov, panel) {
    addC(ov, 'bhm-overlay');
    addC(panel, 'bhm-panel');
    var pr = panel.getBoundingClientRect();
    addC(panel, pr.bottom >= innerHeight - 2 && pr.width >= innerWidth * .9 ? 'bhm-bottom' : 'bhm-round');
    var top = pr.top;

    // En-tête : bandeau coloré / dégradé en haut du panneau
    [].forEach.call(panel.querySelectorAll('*'), function (el) {
      if (el.classList.contains('bhm-head') || el.closest('.bhm-panel .bhm-panel')) return;
      var r = el.getBoundingClientRect(); if (r.top - top > 40 || r.width < pr.width * .8 || r.height > 160 || r.height < 30) return;
      var cs = getComputedStyle(el), bg = rgb(cs.backgroundColor);
      if (cs.backgroundImage.indexOf('gradient') >= 0 || isStrongColor(bg) || isDark(bg)) addC(el, 'bhm-head');
    });
    [].forEach.call(panel.querySelectorAll('.bhm-head'), function (h) {
      force(h, { 'background': 'transparent', 'background-image': 'none', 'color': INK, 'box-shadow': 'none', 'border-bottom': '1px solid rgba(20,32,27,.07)' });
      [].forEach.call(h.querySelectorAll('h1,h2,h3,h4,span,p,div,small'), function (x) { if (!x.closest('.bhm-close')) force(x, { 'color': INK, 'font-family': "'DM Sans',system-ui,-apple-system,sans-serif" }); });
      [].forEach.call(h.querySelectorAll('h1,h2,h3'), function (x) { force(x, { 'font-weight': '700', 'letter-spacing': '-0.02em' }); });
      [].forEach.call(h.querySelectorAll('i,svg'), function (x) { if (!x.closest('.bhm-close')) force(x, { 'color': VERT }); });
    });

    // Titre
    var t = panel.querySelector('h1,h2,h3,.modal-title,[class*="title"]');
    if (t && t.getBoundingClientRect().top - top < 140) addC(t, 'bhm-title');

    // Boutons
    [].forEach.call(panel.querySelectorAll('button, a.btn, a[class*="btn"], a[class*="button"], [role=button], input[type=submit], input[type=button]'), function (b) {
      if (b.dataset.bhm) return;
      var txt = (b.textContent || b.value || '').trim();
      var lbl = ((b.getAttribute('aria-label') || '') + ' ' + (b.title || '') + ' ' + b.className + ' ' + (b.id || '')).toLowerCase();
      var icon = b.querySelector('.fa-times, .fa-xmark, .fa-close, .fa-x');
      var cs = getComputedStyle(b), r = b.getBoundingClientRect();
      var isClose = (/close|fermer|dismiss/.test(lbl) && txt.length <= 2) || txt === '×' || txt === '✕' || txt === '✖' || (icon && txt.length <= 1) || (txt === '' && /close|fermer/.test(lbl));
      if (r.width === 0) return; // encore masqué ou en cours d'animation : on repassera
      b.dataset.bhm = '1';
      if (isClose && r.width <= 60) { addC(b, 'bhm-close'); force(b, { 'background': 'rgba(255,255,255,.62)', 'background-image': 'none', 'color': INK }); return; }
      if (r.width < 24 || r.height < 20) return;
      // petits boutons-icônes et puces de sélection : on garde le gabarit, on corrige juste la couleur
      var bg = rgb(cs.backgroundColor), fg = rgb(cs.color), bd = rgb(cs.borderTopColor);
      var grad = cs.backgroundImage.indexOf('gradient') >= 0;
      addC(b, 'bhm-btn');
      if (/supprim|delete|annuler la réservation|retirer/i.test(txt) || isRed(bg) || (isRed(fg) && !isOpaque(bg)) || isRed(fg)) addC(b, 'bhm-btn-danger');
      else if (grad || isDark(bg) || isStrongColor(bg)) { addC(b, 'bhm-btn-primary'); force(b, { 'background': VERT, 'background-image': 'none', 'color': '#fff', 'border-color': VERT }); }
      else if ((isPurple(bd) || isStrongColor(bd)) && parseFloat(cs.borderTopWidth) >= 1.5) addC(b, 'bhm-btn-on');
      else addC(b, 'bhm-btn-secondary');
    });

    // Cartes blanches, intertitres, accents violets
    [].forEach.call(panel.querySelectorAll('div, section, li, label, span, p, small, i, a, strong, h4, h5, h6'), function (el) {
      if (el.dataset.bhm || el.closest('.bhm-btn, .bhm-close')) return; el.dataset.bhm = '1';
      var cs = getComputedStyle(el);
      var bg = rgb(cs.backgroundColor), fg = rgb(cs.color);
      if (el.tagName === 'DIV' || el.tagName === 'SECTION' || el.tagName === 'LI' || el.tagName === 'LABEL') {
        var r = el.getBoundingClientRect();
        if (isWhiteish(bg) && parseFloat(cs.borderTopLeftRadius) >= 6 && r.width < pr.width - 8 && r.height >= 36) addC(el, 'bhm-card');
      }
      if (cs.textTransform === 'uppercase' && parseFloat(cs.fontSize) <= 14) addC(el, 'bhm-label');
      if (isPurple(bg)) addC(el, 'bhm-accent-bg');
      else if (isPurple(fg)) addC(el, 'bhm-accent');
      else if (fg && fg.a > .5 && hsl(fg).s < .15 && hsl(fg).l > .55 && hsl(fg).l < .78) addC(el, 'bhm-muted');
    });
  }

  /* ── Boucle ── */
  var scheduled = false;
  function scan() {
    scheduled = false;
    var open = false;
    var cands = new Set([].slice.call(document.body.children));
    document.querySelectorAll('[class*="modal" i],[id*="modal" i],[class*="overlay" i],[id*="overlay" i],[class*="sheet" i],[id*="sheet" i],[class*="popup" i],[id*="popup" i],[class*="dialog" i],[id*="dialog" i],[class*="backdrop" i],[role="dialog"],dialog,.bhm-overlay').forEach(function (e) { cands.add(e); });
    cands.forEach(function (el) {
      if (el.classList.contains('bhm-overlay')) {
        if (!visible(el)) return;
        open = true;
        var p = el.querySelector('.bhm-panel'); if (p) style(el, p); // nouveaux contenus
        return;
      }
      if (el.closest('.bhm-overlay')) return;
      if (!isOverlay(el)) return;
      var panel = findPanel(el);
      if (!panel) return;
      open = true;
      style(el, panel);
    });
    if (document.documentElement.classList.contains('bhm-open') !== open) document.documentElement.classList.toggle('bhm-open', open);
  }
  // Les fenêtres s'ouvrent souvent en fondu ou en glissant : au premier passage elles sont
  // encore invisibles ou hors écran. On repasse après l'animation.
  var late = 0;
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(function () { setTimeout(scan, 30); }); }
    clearTimeout(late); late = setTimeout(function () { scan(); setTimeout(scan, 300); }, 250);
  }

  function boot() {
    var st = document.createElement('style'); st.id = 'bhmStyle'; st.textContent = CSS; document.head.appendChild(st);
    if (!document.querySelector('link[href*="DM+Sans"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap';
      document.head.appendChild(l);
    }
    findTabbar(); setTimeout(findTabbar, 1500);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'open', 'hidden', 'aria-hidden'] });
    addEventListener('resize', schedule);
    scan();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.BHModals = { rescan: scan };
})();

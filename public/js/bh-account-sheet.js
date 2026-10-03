/* Boostinghost — « Mon compte » (web, desktop + mobile)
   Feuille latérale ouverte par le rond aux initiales de n'importe quelle page,
   avec ses sous-écrans (repris de l'app iOS, Features/Account) :
   Profil · Abonnement · Équipe · Comptes gérés · Paiements · Plateformes ·
   Ménage et prestataires · Messages automatiques · Notifications · Aide · Nous écrire.
   Inclure : <script src="/js/bh-account-sheet.js" defer></script> */
(function () {
  'use strict';
  if (window.__bhAccountSheet) return;
  window.__bhAccountSheet = true;

  var TRIGGERS = '.bh-header-initials-btn, .bh-ios-initials-button, [data-account-sheet]';
  var VERSION = 'Boostinghost 3.2';

  /* ───────────── Styles ───────────── */
  var CSS = `
.bhas-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(20,32,27,.22);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .28s ease}
.bhas-sheet{position:fixed;z-index:2147483001;top:16px;right:16px;bottom:16px;width:460px;max-width:calc(100% - 32px);display:flex;flex-direction:column;border-radius:30px;overflow:hidden;
  background:linear-gradient(168deg,rgba(245,242,234,.9),rgba(235,231,220,.86) 46%,rgba(226,221,208,.9));
  backdrop-filter:blur(44px) saturate(230%) brightness(1.07);-webkit-backdrop-filter:blur(44px) saturate(230%) brightness(1.07);
  border:1px solid rgba(255,255,255,.5);box-shadow:inset 0 1.5px 1px rgba(255,255,255,.95),inset 0 -1.5px 1px rgba(255,255,255,.45),0 24px 60px rgba(20,32,27,.28);
  transform:translateX(calc(100% + 40px));opacity:0;pointer-events:none;transition:transform .34s cubic-bezier(.32,.72,0,1),opacity .2s ease,width .3s cubic-bezier(.32,.72,0,1);
  font-family:'DM Sans',system-ui,-apple-system,sans-serif;color:#14201B;-webkit-font-smoothing:antialiased;text-align:left;font-size:15px;line-height:1.35}
.bhas-sheet.wide{width:600px}
.bhas-sheet *{box-sizing:border-box}
.bhas-sheet a{text-decoration:none;color:#0E3B2E}
.bhas-sheet button{font-family:inherit}
html.bhas-open .bhas-scrim{opacity:1;pointer-events:auto}
html.bhas-open .bhas-sheet{transform:translateX(0);opacity:1;pointer-events:auto}
.bhas-halo{position:absolute;width:420px;height:420px;border-radius:50%;pointer-events:none}
.bhas-halo.a{top:-120px;right:-140px;background:radial-gradient(circle,rgba(46,139,98,.38),rgba(46,139,98,0) 68%);filter:blur(18px)}
.bhas-halo.b{bottom:-160px;left:-140px;background:radial-gradient(circle,rgba(168,69,42,.26),rgba(168,69,42,0) 68%);filter:blur(20px)}
.bhas-view{position:absolute;inset:0;display:flex;flex-direction:column;animation:bhasIn .28s cubic-bezier(.32,.72,0,1)}
.bhas-view.back{animation:bhasBack .28s cubic-bezier(.32,.72,0,1)}
@keyframes bhasIn{from{transform:translateX(36px);opacity:0}to{transform:none;opacity:1}}
@keyframes bhasBack{from{transform:translateX(-36px);opacity:0}to{transform:none;opacity:1}}
.bhas-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:24px 28px 14px;flex:0 0 auto}
.bhas-head h2{margin:0;font-size:30px;font-weight:700;letter-spacing:-0.032em;line-height:1.1;color:#14201B}
.bhas-subhead{position:relative;display:flex;flex-direction:column;gap:10px;padding:18px 28px 14px;flex:0 0 auto}
.bhas-subhead .row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.bhas-subhead h2{margin:0;font-size:26px;font-weight:700;letter-spacing:-0.03em;line-height:1.1}
.bhas-back{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 10px 0 6px;margin-left:-6px;border:0;border-radius:16px;background:transparent;color:#0E3B2E;font-size:15px;font-weight:600;cursor:pointer;align-self:flex-start}
.bhas-back:hover{background:rgba(255,255,255,.5)}
.bhas-close{height:36px;padding:0 14px;border:0;border-radius:18px;background:rgba(255,255,255,.5);color:#0E3B2E;font-size:15px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px}
.bhas-close:hover{background:rgba(255,255,255,.8)}
.bhas-close kbd{font-family:inherit;font-size:11.5px;font-weight:600;color:#5E6B63;padding:1px 6px;border-radius:6px;background:rgba(0,0,0,.05)}
.bhas-body{position:relative;flex:1;overflow-y:auto;padding:4px 28px 28px;display:grid;grid-auto-rows:max-content;align-content:start;gap:14px}
.bhas-label{margin:6px 0 -4px 4px;font-size:11.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#5E6B63}
.bhas-card{display:flex;flex-direction:column;border-radius:22px;background:rgba(255,255,255,.62);border:1px solid rgba(255,255,255,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 8px 22px rgba(20,32,27,.06);overflow:hidden}
.bhas-card.pad{padding:16px 18px;gap:12px}
.bhas-row{display:flex;align-items:center;gap:14px;min-height:54px;padding:10px 18px;color:#14201B;width:100%;border:0;background:transparent;text-align:left;font-size:15.5px;cursor:default}
a.bhas-row,button.bhas-row{cursor:pointer}
.bhas-row.click{cursor:pointer}
a.bhas-row:hover,button.bhas-row:hover,.bhas-row.click:hover{background:rgba(255,255,255,.5);color:#14201B}
.bhas-row + .bhas-row,.bhas-row + .bhas-sub,.bhas-sub + .bhas-row{border-top:1px solid rgba(20,32,27,.07)}
.bhas-row .ic{width:22px;height:22px;flex:0 0 22px;color:#2C3A33;display:flex;align-items:center;justify-content:center}
.bhas-row .ic svg{width:20px;height:20px}
.bhas-row .l{flex:1;min-width:0;font-weight:500;display:flex;flex-direction:column;gap:2px}
.bhas-row .l small{font-size:13px;font-weight:400;color:#5E6B63}
.bhas-row .v{font-size:14px;color:#5E6B63;white-space:nowrap;text-align:right}
.bhas-row .v.state{color:#0E3B2E;font-weight:600}
.bhas-row .chev{flex:0 0 auto;color:#5E6B63;opacity:.7}
.bhas-row.indent{padding-left:40px}
.bhas-row.indent .l{font-weight:400;color:#2C3A33}
.bhas-sub{padding:8px 18px 12px;font-size:13px;color:#5E6B63}
.bhas-profile{display:flex;align-items:center;gap:16px;padding:18px;border-radius:22px;background:rgba(255,255,255,.66);border:1px solid rgba(255,255,255,.7);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),0 8px 22px rgba(20,32,27,.08);color:#14201B;cursor:pointer;width:100%;text-align:left}
.bhas-profile:hover{background:rgba(255,255,255,.8)}
.bhas-av{width:52px;height:52px;flex:0 0 52px;border-radius:50%;background:rgba(46,139,98,.13);color:#1F6B4C;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:700;overflow:hidden}
.bhas-av img{width:100%;height:100%;object-fit:contain;background:#fff}
.bhas-av.sm{width:38px;height:38px;flex:0 0 38px;font-size:14px}
.bhas-profile .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.bhas-profile .n{font-size:18.5px;font-weight:600;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bhas-profile .s{font-size:14px;color:#5E6B63}
.bhas-logout{height:54px;border-radius:22px;border:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.62);box-shadow:inset 0 1px 0 rgba(255,255,255,.85);color:#A8452A;font-size:16.5px;font-weight:600;cursor:pointer}
.bhas-logout:hover{background:rgba(255,236,229,.85)}
.bhas-foot{display:flex;justify-content:center;align-items:center;gap:8px;padding-top:4px;font-size:12.5px;color:#5E6B63}
.bhas-foot a{color:#5E6B63}
.bhas-btn{height:46px;padding:0 18px;border:0;border-radius:15px;background:#0E3B2E;color:#fff;font-size:15px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.bhas-btn:hover{background:#174D3D}
.bhas-btn:disabled{opacity:.55;cursor:default}
.bhas-btn.ghost{background:rgba(255,255,255,.7);color:#14201B;border:1px solid rgba(255,255,255,.8)}
.bhas-btn.ghost:hover{background:#fff}
.bhas-btn.danger{background:rgba(255,255,255,.62);color:#A8452A}
.bhas-btn.danger:hover{background:rgba(255,236,229,.9)}
.bhas-btn.sm{height:36px;padding:0 14px;border-radius:12px;font-size:14px}
.bhas-btn.full{width:100%}
.bhas-actions{display:flex;gap:10px;flex-wrap:wrap}
.bhas-field{display:flex;flex-direction:column;gap:6px}
.bhas-field > span{font-size:12.5px;font-weight:600;color:#5E6B63}
.bhas-input,.bhas-select,.bhas-textarea{width:100%;height:44px;padding:0 13px;border-radius:13px;border:1px solid rgba(20,32,27,.1);background:rgba(255,255,255,.78);font:inherit;font-size:15px;color:#14201B;outline:none}
.bhas-textarea{height:auto;min-height:140px;padding:11px 13px;resize:vertical;line-height:1.45}
.bhas-input:focus,.bhas-select:focus,.bhas-textarea:focus{border-color:#2E8B62;box-shadow:0 0 0 3px rgba(46,139,98,.15);background:#fff}
.bhas-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.bhas-seg{display:flex;padding:3px;border-radius:13px;background:rgba(0,0,0,.06);gap:3px}
.bhas-seg button{flex:1;height:36px;border:0;border-radius:10px;background:transparent;color:#2C3A33;font-size:14px;font-weight:500;cursor:pointer}
.bhas-seg button.on{background:#fff;color:#14201B;font-weight:600;box-shadow:0 1px 3px rgba(20,32,27,.12)}
.bhas-switch{position:relative;width:46px;height:28px;flex:0 0 46px;border-radius:14px;border:0;background:rgba(20,32,27,.18);cursor:pointer;transition:background .2s ease;padding:0}
.bhas-switch::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s ease}
.bhas-switch.on{background:#0E3B2E}
.bhas-switch.on::after{transform:translateX(18px)}
.bhas-switch:disabled{opacity:.5;cursor:default}
.bhas-check{display:flex;align-items:center;gap:12px;min-height:46px;padding:8px 18px;cursor:pointer;font-size:15px}
.bhas-check + .bhas-check{border-top:1px solid rgba(20,32,27,.07)}
.bhas-check input{width:18px;height:18px;accent-color:#0E3B2E;flex:0 0 18px}
.bhas-check .l{flex:1}
.bhas-check small{color:#5E6B63;font-size:12.5px}
.bhas-pill{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:9px;font-size:12.5px;font-weight:600;white-space:nowrap}
.bhas-pill.ok{background:rgba(46,139,98,.13);color:#1F6B4C}
.bhas-pill.warn{background:rgba(251,243,226,.95);color:#8A5B14}
.bhas-pill.bad{background:rgba(255,222,210,.9);color:#A8452A}
.bhas-pill.mute{background:rgba(0,0,0,.06);color:#5E6B63}
.bhas-dot{width:8px;height:8px;border-radius:50%;flex:0 0 8px}
.bhas-empty{padding:28px 18px;text-align:center;color:#5E6B63;font-size:14.5px}
.bhas-loading{display:flex;justify-content:center;padding:40px 0}
.bhas-spin{width:24px;height:24px;border-radius:50%;border:2.5px solid rgba(20,32,27,.12);border-top-color:#0E3B2E;animation:bhasSpin .8s linear infinite}
@keyframes bhasSpin{to{transform:rotate(360deg)}}
.bhas-note{font-size:13px;color:#5E6B63;text-wrap:pretty;padding:0 4px}
.bhas-err{font-size:13.5px;color:#A8452A;padding:0 4px}
.bhas-toast{position:absolute;left:50%;bottom:18px;transform:translate(-50%,20px);opacity:0;z-index:5;max-width:calc(100% - 48px);padding:11px 16px;border-radius:14px;background:#14201B;color:#fff;font-size:14px;font-weight:500;box-shadow:0 10px 30px rgba(20,32,27,.3);transition:all .25s ease;pointer-events:none}
.bhas-toast.on{opacity:1;transform:translate(-50%,0)}
.bhas-toast.bad{background:#A8452A}
.bhas-search{display:flex;align-items:center;gap:10px;height:44px;padding:0 14px;border-radius:22px;background:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.8);color:#5E6B63}
.bhas-search input{flex:1;min-width:0;border:0;background:transparent;outline:none;font:inherit;font-size:15px;color:#14201B}
.bhas-faq summary{list-style:none;display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;font-weight:500}
.bhas-faq summary::-webkit-details-marker{display:none}
.bhas-faq summary .chev{margin-left:auto;transition:transform .2s ease;color:#5E6B63}
.bhas-faq[open] summary .chev{transform:rotate(90deg)}
.bhas-faq + .bhas-faq{border-top:1px solid rgba(20,32,27,.07)}
.bhas-faq .a{padding:0 18px 16px;color:#3E4A44;font-size:14.5px;line-height:1.5;white-space:pre-line}
.bhas-videos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.bhas-video{display:flex;flex-direction:column;gap:8px;color:#14201B;font-size:14px;font-weight:500}
.bhas-video .th{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:rgba(0,0,0,.08)}
.bhas-video .th img{width:100%;height:100%;object-fit:cover;display:block}
.bhas-video .th::after{content:'';position:absolute;left:50%;top:50%;width:0;height:0;margin:-9px 0 0 -6px;border-style:solid;border-width:9px 0 9px 15px;border-color:transparent transparent transparent #fff;filter:drop-shadow(0 1px 3px rgba(0,0,0,.4))}
.bhas-chat{flex:1;overflow-y:auto;padding:4px 28px 16px;display:flex;flex-direction:column;gap:8px}
.bhas-msg{max-width:78%;padding:10px 14px;border-radius:18px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}
.bhas-msg.me{align-self:flex-end;background:#0E3B2E;color:#fff;border-bottom-right-radius:6px}
.bhas-msg.them{align-self:flex-start;background:rgba(255,255,255,.85);color:#14201B;border-bottom-left-radius:6px}
.bhas-msg img{display:block;max-width:100%;border-radius:12px;margin-top:4px}
.bhas-msg time{display:block;margin-top:4px;font-size:11.5px;opacity:.7}
.bhas-composer{flex:0 0 auto;display:flex;align-items:flex-end;gap:8px;padding:12px 20px 20px;border-top:1px solid rgba(20,32,27,.07)}
.bhas-composer textarea{flex:1;min-height:44px;max-height:140px;padding:11px 14px;border-radius:22px;border:1px solid rgba(20,32,27,.1);background:#fff;font:inherit;font-size:15px;resize:none;outline:none}
.bhas-iconbtn{width:44px;height:44px;flex:0 0 44px;border-radius:50%;border:0;background:rgba(255,255,255,.75);color:#2C3A33;cursor:pointer;display:flex;align-items:center;justify-content:center}
.bhas-iconbtn.primary{background:#0E3B2E;color:#fff}
.bhas-iconbtn:disabled{opacity:.5}
.bhas-iconbtn svg{width:20px;height:20px}
.bhas-logo-edit{display:flex;align-items:center;gap:14px}
html.bhas-sub .bhas-group{display:none}
@media (max-width:859px){.bhas-sheet,.bhas-sheet.wide{top:8px;right:8px;bottom:8px;width:auto;left:8px;max-width:none}.bhas-head,.bhas-subhead{padding-left:20px;padding-right:20px}.bhas-body,.bhas-chat{padding-left:18px;padding-right:18px}.bhas-grid2{grid-template-columns:1fr}}
`;

  /* ───────────── Icônes ───────────── */
  var P = {
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    team: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    office: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 3v4M17 5h4"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    chevR: '<polyline points="9 18 15 12 9 6"/>',
    chevL: '<polyline points="15 18 9 12 15 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'
  };
  function svg(name, size, sw) {
    var s = size || 20;
    var el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('width', s); el.setAttribute('height', s);
    el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', sw || 1.75); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
    el.innerHTML = P[name] || '';
    return el;
  }
  function chev() { var c = svg('chevR', 13, 2.5); c.classList.add('chev'); return c; }

  /* ───────────── Utilitaires ───────────── */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') { el.value = v; if (tag === 'input') el.setAttribute('value', v); }
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function g(o) { for (var i = 1; i < arguments.length; i++) { var v = o && o[arguments[i]]; if (v !== undefined && v !== null) return v; } return undefined; }
  function camel(s) { return s.replace(/_([a-z0-9])/g, function (m, c) { return c.toUpperCase(); }); }
  function gs(o, snake) { return g(o, camel(snake), snake); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function initials(name) { return (name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?'; }
  function fmtDate(v) {
    if (!v) return '—';
    var d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtTime(v) {
    var d = new Date(v); if (isNaN(d)) return '';
    var today = new Date().toDateString() === d.toDateString();
    var t = d.getHours() + ' h ' + String(d.getMinutes()).padStart(2, '0');
    return today ? t : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ', ' + t;
  }
  function fmtEur(n) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + '\u00a0€'; }
  function isSub() { return ls('lcc_is_sub_account') === 'true' || ls('lcc_account_type') === 'sub'; }

  function api(method, path, body, opts) {
    opts = opts || {};
    var url = path;
    if (opts.agency) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'agency=all';
    var init = { method: method, headers: {} };
    var isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (isForm) init.body = body;
    else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var p;
    if (!isForm && typeof window.authFetch === 'function') p = window.authFetch(url, init);
    else { init.headers.Authorization = 'Bearer ' + (ls('lcc_token') || ''); p = fetch(url, init); }
    return p.then(function (r) {
      return r.text().then(function (t) {
        var d; try { d = t ? JSON.parse(t) : {}; } catch (e) { d = { raw: t }; }
        if (!r.ok) { var e = new Error(d.error || d.message || ('Erreur ' + r.status)); e.status = r.status; e.data = d; throw e; }
        return d;
      });
    });
  }
  var GET = function (p, o) { return api('GET', p, undefined, o); };

  /* ───────────── Composants ───────────── */
  function sw(on, onChange, disabled) {
    var b = h('button', { type: 'button', class: 'bhas-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', disabled: disabled });
    b.addEventListener('click', function () {
      var nv = !b.classList.contains('on');
      b.classList.toggle('on', nv); b.setAttribute('aria-checked', nv);
      onChange && onChange(nv, b);
    });
    b.set = function (v) { b.classList.toggle('on', !!v); b.setAttribute('aria-checked', !!v); };
    return b;
  }
  function row(o) {
    var tag = o.href ? 'a' : (o.onClick ? (o.right ? 'div' : 'button') : 'div');
    var clickDiv = tag === 'div' && o.onClick;
    var el = h(tag, { class: 'bhas-row' + (o.indent ? ' indent' : '') + (clickDiv ? ' click' : ''), href: o.href, type: tag === 'button' ? 'button' : null, onClick: o.onClick, target: o.target, tabindex: clickDiv ? '0' : null, role: clickDiv ? 'button' : null },
      o.icon ? h('span', { class: 'ic' }, typeof o.icon === 'string' ? svg(o.icon) : o.icon) : null,
      o.lead || null,
      h('span', { class: 'l' }, o.label, o.sub ? h('small', null, o.sub) : null),
      o.value != null ? h('span', { class: 'v' + (o.state ? ' state' : ''), id: o.valueId }, o.value) : null,
      o.right || null,
      (o.href || o.onClick) && o.chevron !== false ? chev() : null
    );
    return el;
  }
  function card(kids, cls) { return h('div', { class: 'bhas-card ' + (cls || '') }, kids); }
  function label(t) { return h('div', { class: 'bhas-label' }, t); }
  function field(lbl, input) { return h('label', { class: 'bhas-field' }, h('span', null, lbl), input); }
  function input(val, o) { o = o || {}; return h('input', { class: 'bhas-input', type: o.type || 'text', value: val == null ? '' : val, placeholder: o.placeholder, autocomplete: o.autocomplete || 'off', inputmode: o.inputmode, min: o.min, max: o.max }); }
  function loading() { return h('div', { class: 'bhas-loading' }, h('div', { class: 'bhas-spin' })); }
  function empty(t) { return h('div', { class: 'bhas-empty' }, t); }
  function errorBox(e, retry) {
    return card([h('div', { class: 'bhas-empty' }, (e && e.message) || 'Impossible de charger.', retry ? h('div', { style: 'margin-top:12px' }, h('button', { class: 'bhas-btn ghost sm', type: 'button', onClick: retry }, 'Réessayer')) : null)]);
  }
  function seg(options, value, onChange) {
    var wrap = h('div', { class: 'bhas-seg' });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', class: o.value === value ? 'on' : '' }, o.label);
      b.addEventListener('click', function () { [].forEach.call(wrap.children, function (c) { c.classList.remove('on'); }); b.classList.add('on'); onChange(o.value); });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function busy(btn, on, txt) {
    if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; btn.textContent = txt || 'Enregistrement…'; }
    else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; }
  }

  var toastTimer;
  function toast(msg, bad) {
    var t = $('bhasToast'); if (!t) return;
    t.textContent = msg; t.className = 'bhas-toast on' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'bhas-toast' + (bad ? ' bad' : ''); }, 2800);
  }
  function $(id) { return document.getElementById(id); }

  /* ───────────── Navigation interne ───────────── */
  var stack = [];
  var cleanup = null;
  var cache = {};

  function render(dir) {
    var host = $('bhasViews'); if (!host) return;
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    var top = stack[stack.length - 1];
    var def = VIEWS[top.name];
    var view = h('div', { class: 'bhas-view' + (dir === 'back' ? ' back' : '') });
    host.innerHTML = '';
    host.appendChild(view);
    $('bhasSheet').classList.toggle('wide', !!def.wide);
    var ctx = {
      arg: top.arg,
      view: view,
      setHead: function (title, right, kicker) {
        var hd = h('div', { class: 'bhas-subhead' },
          h('button', { type: 'button', class: 'bhas-back', onClick: pop }, svg('chevL', 18, 2.2), stack.length > 2 ? (stack[stack.length - 2].title || 'Retour') : 'Mon compte'),
          h('div', { class: 'row' }, h('h2', null, title), right || null),
          kicker ? h('div', { class: 'bhas-note', style: 'padding:0' }, kicker) : null);
        top.title = title;
        var old = view.querySelector('.bhas-subhead'); if (old) old.replaceWith(hd); else view.insertBefore(hd, view.firstChild);
      },
      body: function () { var b = h('div', { class: 'bhas-body' }); view.appendChild(b); return b; },
      onLeave: function (fn) { cleanup = fn; },
      refresh: function () { render(); }
    };
    def.render(ctx);
  }
  function push(name, arg) { stack.push({ name: name, arg: arg }); render('in'); }
  function pop() { if (stack.length > 1) { stack.pop(); render('back'); } }

  /* ───────────── Écran principal ───────────── */
  var VIEWS = {};

  VIEWS.root = {
    render: function (ctx) {
      var v = ctx.view;
      v.appendChild(h('header', { class: 'bhas-head' },
        h('h2', { id: 'bhasSheetTitle' }, 'Mon compte'),
        h('button', { class: 'bhas-close', id: 'bhasSheetClose', type: 'button', onClick: close }, 'Fermer', h('kbd', null, 'Échap'))));
      var b = ctx.body();
      var c = cache.root || {};
      var sub = isSub();
      b.appendChild(h('button', { class: 'bhas-profile', type: 'button', onClick: sub ? null : function () { push('profile'); } },
        h('span', { class: 'bhas-av', id: 'bhasProfileAv' }, c.logo ? h('img', { src: c.logo, alt: '' }) : initials(c.name)),
        h('span', { class: 'tx' }, h('span', { class: 'n', id: 'bhasProfileName' }, c.name || 'Mon compte'), h('span', { class: 's', id: 'bhasProfileSub' }, c.planLine || '\u00a0')),
        sub ? null : chev()));
      if (!sub) {
        b.appendChild(card([
          row({ icon: 'card', label: 'Abonnement et factures', value: c.plan || '', valueId: 'bhasvPlan', onClick: function () { push('subscription'); } }),
          row({ icon: 'team', label: 'Mon équipe et accès', value: c.team || '', valueId: 'bhasvTeam', onClick: function () { push('team'); } }),
          row({ icon: 'office', label: 'Comptes gérés', value: c.accounts || '', valueId: 'bhasvAccounts', onClick: openSwitcher }),
          row({ icon: 'cash', label: 'Paiements', value: c.payments || '', valueId: 'bhasvPayments', onClick: function () { push('payments'); } }),
          row({ icon: 'link', label: 'Plateformes connectées', value: c.channels || '', valueId: 'bhasvChannels', state: true, onClick: function () { push('diffusion'); } })
        ], 'bhas-group'));
        b.appendChild(card([
          row({ icon: 'sparkle', label: 'Ménage et prestataires', value: c.cleaners || '', valueId: 'bhasvCleaners', onClick: function () { push('cleaners'); } }),
          row({ icon: 'chat', label: 'Messages automatiques', value: c.templates || '', valueId: 'bhasvTemplates', onClick: function () { push('templates'); } }),
          row({ icon: 'bell', label: 'Notifications', value: c.notifs || '', valueId: 'bhasvNotifs', onClick: function () { push('notifications'); } })
        ], 'bhas-group'));
        b.appendChild(card([
          row({ icon: 'help', label: 'Aide et tutoriels', value: 'FAQ · Guides', onClick: function () { push('help'); } }),
          row({ icon: 'mail', label: 'Nous écrire', value: 'Réponse sous 2 h', onClick: function () { push('support'); } })
        ], 'bhas-group'));
      }
      b.appendChild(h('button', { class: 'bhas-logout', type: 'button', onClick: logout }, 'Se déconnecter'));
      b.appendChild(h('div', { class: 'bhas-foot' }, h('span', null, VERSION), h('span', null, '·'), h('a', { href: '/cgu.html' }, 'CGU'), h('span', null, '·'), h('a', { href: '/confidentialite.html' }, 'Confidentialité')));
    }
  };

  function setVal(id, txt, key) {
    cache.root = cache.root || {}; if (key) cache.root[key] = txt;
    var el = $(id); if (el) el.textContent = txt || '';
  }
  function formattedPlan(t) {
    if (!t) return null;
    switch (String(t).toLowerCase()) {
      case 'agency': case 'agence': case 'agence_monthly': return 'Agence';
      case 'pro': case 'pro_monthly': return 'Pro';
      case 'pro_annual': return 'Pro (annuel)';
      case 'starter': return 'Starter';
      default: var s = String(t); return s.charAt(0).toUpperCase() + s.slice(1);
    }
  }
  function loadRoot() {
    cache.root = cache.root || {};
    var u = {}; try { u = JSON.parse(ls('lcc_user') || '{}') || {}; } catch (e) {}
    var fallbackName = u.company || [u.firstName || u.first_name, u.lastName || u.last_name].filter(Boolean).join(' ') || u.email || '';
    if (fallbackName && !cache.root.name) { cache.root.name = fallbackName; updateProfileCard(); }
    if (isSub()) return;
    var subP = GET('/api/subscription/status').catch(function () { return {}; });
    var propsP = GET('/api/properties', { agency: true }).catch(function () { return null; });
    GET('/api/user/profile').then(function (p) {
      cache.profile = p;
      var name = [gs(p, 'first_name'), gs(p, 'last_name')].filter(Boolean).join(' ') || gs(p, 'company') || p.email;
      cache.root.name = name || cache.root.name; cache.root.logo = gs(p, 'logo_url') || null;
      var useBh = g(p, 'use_bh_stripe', 'useBhStripe');
      setVal('bhasvPayments', useBh ? 'Passerelle Boostinghost' : 'Stripe personnel', 'payments');
      updateProfileCard();
    }).catch(function () {});
    Promise.all([subP, propsP]).then(function (r) {
      var plan = formattedPlan(gs(r[0], 'plan_type'));
      setVal('bhasvPlan', plan || '', 'plan');
      var n = r[1] && r[1].properties ? r[1].properties.length : null;
      cache.root.planLine = [plan ? 'Formule ' + plan : null, n ? plural(n, 'logement') : null].filter(Boolean).join(' · ');
      updateProfileCard();
    });
    GET('/api/sub-accounts/list', { agency: true }).then(function (d) { var n = (gs(d, 'sub_accounts') || []).length; setVal('bhasvTeam', n ? plural(n, 'personne') : '', 'team'); }).catch(function () { setVal('bhasvTeam', '—', 'team'); });
    GET('/api/properties/diffusion', { agency: true }).then(function (d) { var n = +d.diffuses || 0; setVal('bhasvChannels', n ? plural(n, 'diffusé') : 'Aucun', 'channels'); }).catch(function () { setVal('bhasvChannels', '—', 'channels'); });
    GET('/api/cleaners', { agency: true }).then(function (d) { var a = Array.isArray(d) ? d : (d.cleaners || []); setVal('bhasvCleaners', a.length ? plural(a.length, 'intervenant') : '', 'cleaners'); }).catch(function () {});
    GET('/api/message-templates', { agency: true }).then(function (d) { var a = Array.isArray(d) ? d : (d.templates || []); setVal('bhasvTemplates', a.length ? plural(a.length, 'modèle') : '', 'templates'); }).catch(function () {});
    GET('/api/settings/notifications').then(function (d) { cache.notifs = d; updateNotifLabel(); }).catch(function () {});
    GET('/api/agency/delegations').then(function (d) {
      var list = Array.isArray(d) ? d : (d.delegations || d.accounts || []);
      var n = list.length + 1; setVal('bhasvAccounts', plural(n, 'compte'), 'accounts');
    }).catch(function () {});
  }
  function updateProfileCard() {
    var c = cache.root || {};
    var n = $('bhasProfileName'); if (n) n.textContent = c.name || 'Mon compte';
    var s = $('bhasProfileSub'); if (s) s.textContent = c.planLine || '\u00a0';
    var av = $('bhasProfileAv');
    if (av) { av.innerHTML = ''; if (c.logo) av.appendChild(h('img', { src: c.logo, alt: '' })); else av.textContent = initials(c.name); }
  }

  /* ───────────── Profil ───────────── */
  VIEWS.profile = {
    render: function (ctx) {
      ctx.setHead('Profil et entreprise');
      var b = ctx.body();
      b.appendChild(loading());
      GET('/api/user/profile').then(function (p) { cache.profile = p; draw(p); }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e, ctx.refresh)); });
      function draw(p) {
        b.innerHTML = '';
        var st = { accountType: gs(p, 'account_type') || 'individual', logo: null };
        var f = {};
        ['first_name', 'last_name', 'company', 'legal_form', 'siret', 'address', 'postal_code', 'city', 'phone', 'invoice_email', 'website', 'vat_regime', 'vat_number'].forEach(function (k) { f[k] = input(gs(p, k)); });
        f.invoice_email.type = 'email'; f.phone.type = 'tel'; f.website.placeholder = 'https://';
        var logoUrl = gs(p, 'logo_url');
        var av = h('span', { class: 'bhas-av' }, logoUrl ? h('img', { src: logoUrl, alt: '' }) : initials([gs(p, 'first_name'), gs(p, 'last_name')].join(' ')));
        var file = h('input', { type: 'file', accept: 'image/*,application/pdf', style: 'display:none' });
        file.addEventListener('change', function () {
          var fl = file.files && file.files[0]; if (!fl) return;
          if (fl.size > 10 * 1024 * 1024) { toast('Le logo ne doit pas dépasser 10 Mo.', true); return; }
          st.logo = fl;
          if (fl.type.indexOf('image/') === 0) { av.innerHTML = ''; av.appendChild(h('img', { src: URL.createObjectURL(fl), alt: '' })); }
        });
        var bizBox = h('div', { style: 'display:grid;gap:12px' + (st.accountType === 'business' ? '' : ';display:none') },
          h('div', { class: 'bhas-grid2' }, field('Forme juridique', f.legal_form), field('SIRET', f.siret)));
        b.appendChild(card([
          h('div', { class: 'bhas-logo-edit' }, av, h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
            h('button', { type: 'button', class: 'bhas-btn ghost sm', onClick: function () { file.click(); } }, 'Changer le logo'),
            h('span', { class: 'bhas-note', style: 'padding:0' }, 'Affiché sur vos factures et contrats')), file),
          field('Type de compte', seg([{ value: 'individual', label: 'Particulier' }, { value: 'business', label: 'Professionnel' }], st.accountType, function (v) { st.accountType = v; bizBox.style.display = v === 'business' ? 'grid' : 'none'; })),
          h('div', { class: 'bhas-grid2' }, field('Prénom', f.first_name), field('Nom', f.last_name)),
          field('Entreprise', f.company), bizBox
        ], 'pad'));
        b.appendChild(label('Coordonnées'));
        b.appendChild(card([
          field('Adresse', f.address),
          h('div', { class: 'bhas-grid2' }, field('Code postal', f.postal_code), field('Ville', f.city)),
          h('div', { class: 'bhas-grid2' }, field('Téléphone', f.phone), field('E-mail de facturation', f.invoice_email)),
          field('Site web', f.website)
        ], 'pad'));
        b.appendChild(label('TVA'));
        b.appendChild(card([h('div', { class: 'bhas-grid2' }, field('Régime de TVA', f.vat_regime), field('Numéro de TVA', f.vat_number))], 'pad'));
        var save = h('button', { type: 'button', class: 'bhas-btn full' }, 'Enregistrer');
        save.addEventListener('click', function () {
          if (st.accountType === 'business') {
            var digits = f.siret.value.replace(/\D/g, '');
            if (digits && digits.length !== 14) { toast('Le numéro SIRET doit contenir 14 chiffres.', true); return; }
          }
          var fd = new FormData();
          var map = { first_name: 'firstName', last_name: 'lastName', company: 'company', phone: 'phone', invoice_email: 'invoiceEmail', website: 'website', vat_regime: 'vatRegime', vat_number: 'vatNumber', legal_form: 'legalForm', address: 'address', postal_code: 'postalCode', city: 'city', siret: 'siret' };
          Object.keys(map).forEach(function (k) { fd.append(map[k], f[k].value.trim()); });
          fd.append('accountType', st.accountType);
          if (st.logo) fd.append('logo', st.logo);
          busy(save, true);
          api('PUT', '/api/user/profile', fd).then(function (r) {
            var np = r.profile || r;
            cache.profile = Object.assign({}, p, np);
            cache.root = cache.root || {};
            cache.root.name = [f.first_name.value, f.last_name.value].filter(Boolean).join(' ').trim() || f.company.value || cache.root.name;
            cache.root.logo = gs(np, 'logo_url') || cache.root.logo;
            toast('Profil enregistré');
          }).catch(function (e) { toast(e.message, true); }).then(function () { busy(save, false); });
        });
        b.appendChild(save);
      }
    }
  };

  /* ───────────── Abonnement ───────────── */
  VIEWS.subscription = {
    render: function (ctx) {
      ctx.setHead('Abonnement et factures');
      var b = ctx.body();
      b.appendChild(loading());
      Promise.all([GET('/api/subscription/status'), GET('/api/billing/invoices').catch(function () { return null; })]).then(function (r) {
        var s = r[0], inv = r[1];
        b.innerHTML = '';
        var status = gs(s, 'status');
        var trial = status === 'trial' || status === 'trialing';
        var plan = formattedPlan(gs(s, 'plan_type'));
        var used = gs(s, 'properties_used'), limit = gs(s, 'properties_limit');
        var rows = [];
        if (trial) {
          rows.push(row({ label: 'Période', value: 'Essai gratuit' }));
          var end = gs(s, 'trial_end_date'), dr = gs(s, 'days_remaining');
          if (end) rows.push(row({ label: "Fin d'essai", value: (dr != null ? (dr <= 0 ? "Aujourd'hui — " : plural(dr, 'jour') + ' — ') : '') + fmtDate(end) }));
        } else {
          if (plan) rows.push(row({ label: 'Formule', value: plan }));
          var stLabel = { active: 'Actif', expired: 'Expiré', canceled: 'Résilié', cancelled: 'Résilié', past_due: 'Paiement en retard' }[status];
          if (stLabel) rows.push(row({ label: 'Statut', right: h('span', { class: 'bhas-pill ' + (status === 'active' ? 'ok' : 'bad') }, stLabel) }));
          rows.push(row({ label: 'Renouvellement', value: fmtDate(gs(s, 'current_period_end')) }));
        }
        if (used) rows.push(row({ label: 'Logements', value: (limit ? used + ' / ' + limit : used) + ' ' + (used === 1 ? 'logement' : 'logements') }));
        b.appendChild(card(rows));
        var msg = gs(s, 'display_message'); if (msg) b.appendChild(h('div', { class: 'bhas-note' }, msg));
        var portal = h('button', { type: 'button', class: 'bhas-btn' }, "Gérer l'abonnement");
        portal.addEventListener('click', function () {
          busy(portal, true, 'Ouverture…');
          api('POST', '/api/billing/create-portal-session', {}).then(function (d) { if (d.url) location.href = d.url; else throw new Error('Lien indisponible'); })
            .catch(function (e) { toast(e.message, true); busy(portal, false); });
        });
        b.appendChild(h('div', { class: 'bhas-actions' }, portal, h('a', { class: 'bhas-btn ghost', href: '/pricing.html' }, 'Changer de formule')));
        var list = inv && (Array.isArray(inv) ? inv : (inv.invoices || inv.data || []));
        if (list && list.length) {
          b.appendChild(label('Factures'));
          b.appendChild(card(list.slice(0, 24).map(function (i) {
            var a = g(i, 'amount', 'amount_eur', 'total_eur');
            if (a == null) { var cents = g(i, 'amount_paid', 'total', 'amount_due'); if (cents != null) a = cents / 100; }
            var link = g(i, 'hosted_invoice_url', 'hostedInvoiceUrl', 'invoice_pdf', 'invoicePdf', 'pdf_url', 'url');
            var st = g(i, 'status');
            return row({ label: g(i, 'number', 'invoice_number') || 'Facture', sub: fmtDate(g(i, 'created', 'date', 'created_at')),
              right: h('span', { style: 'display:flex;align-items:center;gap:10px' }, st && st !== 'paid' ? h('span', { class: 'bhas-pill warn' }, st === 'open' ? 'À payer' : st) : null, a != null ? h('span', { class: 'v' }, fmtEur(a)) : null),
              href: link || null, target: link ? '_blank' : null });
          })));
        }
      }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e, ctx.refresh)); });
    }
  };

  /* ───────────── Équipe ───────────── */
  var PERMS = [
    { title: 'Calendrier', items: [['can_view_calendar', 'can_view_reservations', 'Voir le calendrier', 0], ['can_edit_reservations', null, 'Modifier les réservations', 1], ['can_create_reservations', null, 'Créer des réservations', 1], ['can_delete_reservations', null, 'Supprimer des réservations', 1]] },
    { title: 'Messages', items: [['can_view_messages', null, 'Voir les messages', 0], ['can_send_messages', null, 'Envoyer des messages', 1], ['can_view_templates', null, 'Voir les modèles automatiques', 0], ['can_manage_templates', null, 'Gérer les modèles automatiques', 1]] },
    { title: 'Ménage', items: [['can_view_cleaning', null, 'Voir les assignations', 0], ['can_assign_cleaning', 'can_manage_cleaning', 'Assigner les ménages', 1], ['can_manage_cleaning_staff', null, 'Gérer les prestataires', 1]] },
    { title: 'Logements', items: [['can_view_properties', null, 'Voir les logements', 0], ['can_view_welcome_book', null, "Voir les livrets d'accueil", 0], ['can_view_smart_locks', null, 'Voir les serrures connectées', 0], ['can_edit_properties', null, 'Modifier les logements', 1], ['can_manage_smart_locks', null, 'Gérer les serrures connectées', 1], ['can_access_settings', null, 'Accéder aux paramètres', 1], ['can_manage_team', null, "Gérer l'équipe", 1]] },
    { title: 'Propriétaires', items: [['can_view_owners', null, 'Voir les propriétaires', 0], ['can_view_contracts', null, 'Voir les contrats', 0]] },
    { title: 'Argent', items: [['can_view_finances', null, 'Voir les finances', 0], ['can_view_deposits', null, 'Voir les cautions', 0], ['can_view_invoices', null, 'Voir les factures', 0], ['can_view_payments', null, 'Voir les paiements', 0], ['can_view_pricing', null, 'Voir les tarifs', 0], ['can_view_debours', null, 'Voir les débours', 0], ['can_view_reporting', null, 'Voir les rapports', 0], ['can_edit_finances', null, 'Modifier les finances', 1], ['can_manage_deposits', null, 'Gérer les cautions', 1], ['can_manage_invoices', null, 'Gérer les factures', 1], ['can_manage_payments', null, 'Gérer les paiements', 1], ['can_manage_pricing', null, 'Gérer les tarifs', 1], ['can_manage_debours', null, 'Gérer les débours', 1]] }
  ];
  var SUB_NOTIFS = [['notif_sub_new_reservation', 'Nouvelle réservation'], ['notif_sub_reservation_cancelled', 'Annulation de réservation'], ['notif_sub_daily_summary', 'Récap quotidien'], ['notif_sub_new_message', 'Nouveau message'], ['notif_sub_cleaning_assigned', 'Ménage assigné'], ['notif_sub_cleaning_completed', 'Ménage terminé'], ['notif_sub_deposit_paid', 'Caution reçue'], ['notif_sub_payment_received', 'Paiement reçu']];
  var ROLE = { owner: 'Propriétaire', manager: 'Manager', cleaner: 'Prestataire ménage', accountant: 'Comptable', custom: 'Personnalisé' };
  function memberName(m) { return [gs(m, 'first_name'), gs(m, 'last_name')].filter(Boolean).join(' ') || m.email || 'Sans nom'; }
  function rightsSummary(m) {
    var d = PERMS.filter(function (gr) { return gr.items.some(function (it) { return !!gs(m, it[0]); }); }).map(function (gr) { return gr.title; });
    return d.length === PERMS.length ? 'Tous les droits' : (d.length ? d.join(', ') : 'Aucun accès');
  }
  function targetAccounts() { return GET('/api/agency/target-accounts').then(function (d) { return d.accounts || []; }).catch(function () { return []; }); }

  VIEWS.team = {
    wide: true,
    render: function (ctx) {
      ctx.setHead('Mon équipe et accès', h('button', { type: 'button', class: 'bhas-btn sm', onClick: function () { push('teamCreate'); } }, svg('plus', 16, 2.2), 'Ajouter'));
      var b = ctx.body();
      b.appendChild(loading());
      GET('/api/sub-accounts/list', { agency: true }).then(function (d) {
        var list = gs(d, 'sub_accounts') || [];
        cache.team = list;
        b.innerHTML = '';
        if (!list.length) { b.appendChild(card([empty("Aucun membre pour l'instant. Ajoutez un collaborateur pour lui donner un accès limité.")])); return; }
        b.appendChild(card(list.map(function (m) {
          var active = gs(m, 'is_active') !== false;
          var parent = gs(m, 'parent_user_name');
          return row({ lead: h('span', { class: 'bhas-av sm' }, initials(memberName(m))), label: memberName(m),
            sub: [ROLE[m.role] || m.role, rightsSummary(m), parent].filter(Boolean).join(' · '),
            right: active ? null : h('span', { class: 'bhas-pill mute' }, 'Désactivé'),
            onClick: function () { push('teamMember', m); } });
        })));
      }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e, ctx.refresh)); });
    }
  };
  VIEWS.teamMember = {
    wide: true,
    render: function (ctx) {
      var m = ctx.arg;
      ctx.setHead(memberName(m), null, [m.email, gs(m, 'last_login') ? 'Dernière connexion : ' + fmtDate(gs(m, 'last_login')) : null].filter(Boolean).join(' · '));
      var b = ctx.body();
      var fn = input(gs(m, 'first_name')), lnI = input(gs(m, 'last_name'));
      b.appendChild(card([h('div', { class: 'bhas-grid2' }, field('Prénom', fn), field('Nom', lnI))], 'pad'));
      var state = {};
      PERMS.forEach(function (gr) {
        b.appendChild(label(gr.title));
        b.appendChild(card(gr.items.map(function (it) {
          state[it[0]] = !!gs(m, it[0]);
          return row({ label: it[2], indent: it[3] === 1, right: sw(state[it[0]], function (v) { state[it[0]] = v; }) });
        })));
      });
      b.appendChild(label('Notifications reçues'));
      b.appendChild(card(SUB_NOTIFS.map(function (n) {
        state[n[0]] = !!gs(m, n[0]);
        return row({ label: n[1], right: sw(state[n[0]], function (v) { state[n[0]] = v; }) });
      })));
      var save = h('button', { type: 'button', class: 'bhas-btn full' }, 'Enregistrer les droits');
      save.addEventListener('click', function () {
        var perms = {};
        PERMS.forEach(function (gr) { gr.items.forEach(function (it) { perms[it[1] || it[0]] = !!state[it[0]]; }); });
        var notifs = {}; SUB_NOTIFS.forEach(function (n) { notifs[n[0]] = !!state[n[0]]; });
        busy(save, true);
        api('PUT', '/api/sub-accounts/' + m.id, { firstName: fn.value.trim(), lastName: lnI.value.trim(), role: 'custom', permissions: perms, notifications: notifs, propertyIds: [] }, { agency: true })
          .then(function () { toast('Droits enregistrés'); }).catch(function (e) { toast(e.message, true); }).then(function () { busy(save, false); });
      });
      b.appendChild(save);
    }
  };
  VIEWS.teamCreate = {
    render: function (ctx) {
      ctx.setHead('Nouveau membre');
      var b = ctx.body();
      var fn = input(''), lnI = input(''), em = input('', { type: 'email', autocomplete: 'off' }), pw = input('', { type: 'password', autocomplete: 'new-password' });
      var target = h('select', { class: 'bhas-select' });
      var targetField = field('Compte', target); targetField.style.display = 'none';
      targetAccounts().then(function (acc) {
        if (acc.length > 1) {
          acc.forEach(function (a) { target.appendChild(h('option', { value: gs(a, 'user_id') }, (a.name || a.email) + (gs(a, 'is_self') ? ' (mon compte)' : ''))); });
          targetField.style.display = '';
        }
      });
      b.appendChild(card([h('div', { class: 'bhas-grid2' }, field('Prénom', fn), field('Nom', lnI)), field('E-mail', em), field('Mot de passe provisoire', pw), targetField], 'pad'));
      b.appendChild(h('div', { class: 'bhas-note' }, 'Le membre est créé sans aucun droit. Ouvrez-le ensuite pour choisir ce qu’il peut voir et faire.'));
      var save = h('button', { type: 'button', class: 'bhas-btn full' }, 'Créer le membre');
      save.addEventListener('click', function () {
        if (!em.value.trim() || pw.value.length < 6) { toast('E-mail et mot de passe (6 caractères min.) requis.', true); return; }
        busy(save, true, 'Création…');
        var body = { email: em.value.trim(), password: pw.value, firstName: fn.value.trim(), lastName: lnI.value.trim(), role: 'custom' };
        if (targetField.style.display !== 'none' && target.value) body.targetUserId = target.value;
        api('POST', '/api/sub-accounts/create', body, { agency: true }).then(function () { toast('Membre créé'); pop(); })
          .catch(function (e) { toast(e.message, true); busy(save, false); });
      });
      b.appendChild(save);
    }
  };

  /* ───────────── Paiements ───────────── */
  VIEWS.payments = {
    render: function (ctx) {
      ctx.setHead('Paiements');
      var b = ctx.body();
      b.appendChild(loading());
      GET('/api/user/profile').then(function (p) {
        b.innerHTML = '';
        var useBh = !!g(p, 'use_bh_stripe', 'useBhStripe');
        var personal = h('div', { style: 'display:grid;gap:14px' });
        var toggle = sw(useBh, function (v, el) {
          el.disabled = true;
          api('PATCH', '/api/user/profile', { use_bh_stripe: v }).then(function (r) {
            useBh = !!g(r, 'use_bh_stripe', 'useBhStripe', 'success') && v; el.set(v);
            setVal('bhasvPayments', v ? 'Passerelle Boostinghost' : 'Stripe personnel', 'payments');
            drawPersonal();
          }).catch(function (e) { el.set(!v); toast(e.message, true); }).then(function () { el.disabled = false; });
        });
        b.appendChild(label('Passerelle intégrée'));
        b.appendChild(card([row({ label: 'Passerelle Boostinghost', sub: 'Utiliser la passerelle de paiement intégrée', right: toggle })]));
        b.appendChild(personal);
        drawPersonal();
        function drawPersonal() {
          personal.innerHTML = '';
          if (toggle.classList.contains('on')) return;
          personal.appendChild(label('Compte Stripe personnel'));
          var c = card([loading()], 'pad'); personal.appendChild(c);
          GET('/api/stripe/status').then(function (s) {
            c.innerHTML = '';
            var connected = !!s.connected, canCharge = !!g(s, 'can_charge', 'canCharge');
            var ok = connected && canCharge;
            c.appendChild(h('div', { style: 'display:flex;align-items:center;gap:10px;font-size:14.5px' }, h('span', { class: 'bhas-dot', style: 'background:' + (ok ? '#2E8B62' : '#A8452A') }),
              ok ? 'Compte Stripe connecté et opérationnel' : connected ? 'Compte connecté — configuration incomplète' : 'Aucun compte Stripe connecté'));
            var btn = h('button', { type: 'button', class: 'bhas-btn full' }, connected ? 'Gérer le compte Stripe' : 'Connecter Stripe');
            btn.addEventListener('click', function () {
              busy(btn, true, 'Ouverture…');
              api('POST', '/api/stripe/create-onboarding-link', {}).then(function (d) { if (d.url) window.open(d.url, '_blank'); else throw new Error('Lien indisponible'); })
                .catch(function (e) { toast(e.message, true); }).then(function () { busy(btn, false); });
            });
            c.appendChild(btn);
          }).catch(function (e) { c.innerHTML = ''; c.appendChild(h('div', { class: 'bhas-err' }, e.message)); });
        }
      }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e, ctx.refresh)); });
    }
  };

  /* ───────────── Plateformes ───────────── */
  VIEWS.diffusion = {
    wide: true,
    render: function (ctx) {
      var resync = h('button', { type: 'button', class: 'bhas-btn ghost sm' }, svg('sync', 16), 'Resynchroniser');
      resync.addEventListener('click', function () {
        busy(resync, true, 'Synchronisation…');
        api('POST', '/api/diffusion/sync-all', {}).then(function (d) { toast(d.message || 'Synchronisation lancée'); }).catch(function (e) { toast(e.message, true); }).then(function () { busy(resync, false); });
      });
      ctx.setHead('Plateformes connectées', resync);
      var b = ctx.body();
      b.appendChild(loading());
      GET('/api/properties/diffusion', { agency: true }).then(function (d) {
        b.innerHTML = '';
        var list = d.logements || [];
        b.appendChild(card([
          row({ label: 'Logements diffusés', value: (+d.diffuses || 0) + ' / ' + (+d.total || list.length), state: true }),
          row({ label: 'Vendables', value: String(+d.vendables || 0) })
        ]));
        if (!list.length) { b.appendChild(card([empty('Aucun logement.')])); return; }
        var issues = list.filter(function (l) { return (+gs(l, 'a_regler') || 0) > 0; });
        var ok = list.filter(function (l) { return !((+gs(l, 'a_regler') || 0) > 0); });
        if (issues.length) {
          b.appendChild(label('À régler'));
          var ic = card([]); b.appendChild(ic);
          issues.forEach(function (l) {
            var pid = gs(l, 'property_id') || l.id;
            var subBox = h('div', { class: 'bhas-sub' }, 'Analyse…');
            ic.appendChild(row({ label: l.nom || 'Logement', right: h('span', { class: 'bhas-pill warn' }, plural(+gs(l, 'a_regler'), 'point')) }));
            ic.appendChild(subBox);
            GET('/api/properties/' + encodeURIComponent(pid) + '/sante', { agency: true }).then(function (s) {
              var bad = (s.points || []).filter(function (pt) { return pt.ok === false; });
              subBox.innerHTML = '';
              if (!bad.length) { subBox.textContent = 'Rien de bloquant détecté.'; return; }
              bad.forEach(function (pt) { subBox.appendChild(h('div', { style: 'padding:3px 0' }, h('strong', { style: 'color:#14201B;font-weight:600' }, pt.titre), pt.details ? ' — ' + pt.details : '')); });
            }).catch(function () { subBox.textContent = 'Détail indisponible.'; });
          });
          b.appendChild(h('a', { class: 'bhas-btn ghost', href: '/settings.html' }, 'Ouvrir la diffusion des logements'));
        }
        b.appendChild(label('Logements'));
        b.appendChild(card(ok.map(function (l) {
          var st = l.vendable ? ['ok', 'Vendable'] : l.diffuse ? ['warn', 'Diffusé'] : ['mute', 'Non diffusé'];
          return row({ label: l.nom || 'Logement', right: h('span', { class: 'bhas-pill ' + st[0] }, st[1]) });
        })));
      }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e, ctx.refresh)); });
    }
  };

  /* ───────────── Ménage et prestataires ───────────── */
  function loadCleaners() {
    return Promise.all([
      GET('/api/cleaners', { agency: true }),
      GET('/api/cleaning/default-cleaners', { agency: true }).catch(function () { return {}; }),
      GET('/api/properties', { agency: true }).catch(function () { return {}; })
    ]).then(function (r) {
      var cl = Array.isArray(r[0]) ? r[0] : (r[0].cleaners || []);
      var props = (r[2].properties || []).map(function (p) { return { id: String(p._id || p.id), name: p.internal_name || p.internalName || p.name }; })
        .filter(function (p) { return p.id; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      cache.cleaners = { list: cl, defaults: r[1].defaults || {}, props: props };
      return cache.cleaners;
    });
  }
  function cid(c) { return String(c._id || c.id || ''); }
  VIEWS.cleaners = {
    wide: true,
    render: function (ctx) {
      ctx.setHead('Ménage et prestataires', h('button', { type: 'button', class: 'bhas-btn sm', onClick: function () { push('cleanerEdit', null); } }, svg('plus', 16, 2.2), 'Ajouter'));
      var b = ctx.body();
      b.appendChild(loading());
      loadCleaners().then(function (d) {
        b.innerHTML = '';
        if (!d.list.length) { b.appendChild(card([empty('Aucun intervenant. Ajoutez une personne pour lui envoyer ses ménages.')])); return; }
        b.appendChild(card(d.list.map(function (c) {
          var n = Object.keys(d.defaults).filter(function (k) { return String(gs(d.defaults[k], 'cleaner_id')) === cid(c); }).length;
          var active = gs(c, 'is_active') !== false;
          return row({ lead: h('span', { class: 'bhas-av sm' }, initials(c.name)), label: c.name || 'Sans nom',
            sub: [c.phone, c.email, gs(c, 'user_name')].filter(Boolean).join(' · ') || null,
            right: h('span', { style: 'display:flex;gap:8px;align-items:center' }, n ? h('span', { class: 'v' }, plural(n, 'logement')) : null, active ? null : h('span', { class: 'bhas-pill mute' }, 'Inactif')),
            onClick: function () { push('cleanerEdit', c); } });
        })));
        b.appendChild(h('a', { class: 'bhas-btn ghost', href: '/cleaning.html' }, 'Ouvrir le planning ménage'));
      }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e, ctx.refresh)); });
    }
  };
  VIEWS.cleanerEdit = {
    wide: true,
    render: function (ctx) {
      var c = ctx.arg, isNew = !c;
      ctx.setHead(isNew ? 'Nouvel intervenant' : (c.name || 'Intervenant'));
      var b = ctx.body();
      var nm = input(c && c.name), em = input(c && c.email, { type: 'email' }), ph = input(c && c.phone, { type: 'tel' });
      var notes = h('textarea', { class: 'bhas-textarea', style: 'min-height:80px' }); notes.value = (c && c.notes) || '';
      var active = c ? gs(c, 'is_active') !== false : true;
      var target = h('select', { class: 'bhas-select' }); var targetField = field('Compte', target); targetField.style.display = 'none';
      if (isNew) targetAccounts().then(function (acc) { if (acc.length > 1) { acc.forEach(function (a) { target.appendChild(h('option', { value: gs(a, 'user_id') }, a.name || a.email)); }); targetField.style.display = ''; } });
      b.appendChild(card([field('Nom', nm), h('div', { class: 'bhas-grid2' }, field('Téléphone', ph), field('E-mail', em)), field('Notes', notes), targetField], 'pad'));
      b.appendChild(card([row({ label: 'Actif', sub: 'Un intervenant inactif ne reçoit plus de ménages', right: sw(active, function (v) { active = v; }) })]));
      var save = h('button', { type: 'button', class: 'bhas-btn full' }, isNew ? 'Créer' : 'Enregistrer');
      save.addEventListener('click', function () {
        if (!nm.value.trim()) { toast('Le nom est obligatoire.', true); return; }
        var body = { name: nm.value.trim(), email: em.value.trim() || null, phone: ph.value.trim() || null, notes: notes.value.trim() || null, isActive: active };
        busy(save, true);
        if (isNew) {
          if (targetField.style.display !== 'none' && target.value) body.targetUserId = target.value;
          api('POST', '/api/cleaners', body, { agency: true }).then(function () { toast('Intervenant créé'); pop(); })
            .catch(function (e) { toast(e.message, true); busy(save, false); });
        } else {
          body.subAccountId = gs(c, 'sub_account_id') || null;
          api('PUT', '/api/cleaners/' + cid(c), body, { agency: true }).then(function () { Object.assign(c, { name: body.name, email: body.email, phone: body.phone, notes: body.notes, is_active: active }); toast('Enregistré'); })
            .catch(function (e) { toast(e.message, true); }).then(function () { busy(save, false); });
        }
      });
      b.appendChild(save);
      if (isNew) return;

      b.appendChild(label('Accès intervenant'));
      var token = gs(c, 'access_token');
      var urlOf = function (t) { return location.origin + '/cleaning-tasks.html' + (t ? '?t=' + t : ''); };
      var linkRow = row({ label: 'Lien personnel', sub: 'Planning, checklists et photos, sans mot de passe',
        right: h('button', { type: 'button', class: 'bhas-btn ghost sm', onClick: function () { copy(urlOf(token)); } }, svg('copy', 15), 'Copier') });
      var regen = h('button', { type: 'button', class: 'bhas-btn ghost sm' }, 'Régénérer');
      regen.addEventListener('click', function () {
        if (!confirm("L'ancien lien ne fonctionnera plus. Continuer ?")) return;
        busy(regen, true, '…');
        api('POST', '/api/cleaners/' + cid(c) + '/regenerate-link', {}, { agency: true }).then(function (r) { token = gs(r.cleaner || r, 'access_token') || token; c.access_token = token; copy(urlOf(token)); })
          .catch(function (e) { toast(e.message, true); }).then(function () { busy(regen, false); });
      });
      var sms = sw(!!gs(c, 'sms_recap_enabled'), function (v, el) {
        el.disabled = true;
        api('PUT', '/api/cleaners/' + cid(c) + '/sms-toggle', { enabled: v }, { agency: true }).then(function () { c.sms_recap_enabled = v; })
          .catch(function (e) { el.set(!v); toast(e.status === 403 ? "L'option SMS doit être activée sur votre abonnement." : e.message, true); }).then(function () { el.disabled = false; });
      });
      b.appendChild(card([linkRow, row({ label: 'Nouveau lien', sub: 'Invalide le lien actuel', right: regen }), row({ label: 'Récap SMS', sub: 'Envoie les ménages du lendemain par SMS', right: sms })]));

      b.appendChild(label('Logements attribués par défaut'));
      var pc = card([loading()]); b.appendChild(pc);
      (cache.cleaners ? Promise.resolve(cache.cleaners) : loadCleaners()).then(function (d) {
        pc.innerHTML = '';
        if (!d.props.length) { pc.appendChild(empty('Aucun logement.')); return; }
        d.props.forEach(function (p) {
          var def = d.defaults[p.id], owner = def ? String(gs(def, 'cleaner_id')) : null;
          var cb = h('input', { type: 'checkbox', checked: owner === cid(c) });
          var other = owner && owner !== cid(c) ? h('small', null, 'Actuellement : ' + (gs(def, 'cleaner_name') || 'autre intervenant')) : null;
          cb.addEventListener('change', function () {
            cb.disabled = true;
            api('PUT', '/api/cleaning/default-cleaner/' + encodeURIComponent(p.id), { cleanerId: cb.checked ? cid(c) : null }, { agency: true }).then(function () {
              if (cb.checked) d.defaults[p.id] = { cleanerId: cid(c), cleanerName: c.name }; else delete d.defaults[p.id];
              if (other) other.remove();
            }).catch(function (e) { cb.checked = !cb.checked; toast(e.message, true); }).then(function () { cb.disabled = false; });
          });
          pc.appendChild(h('label', { class: 'bhas-check' }, cb, h('span', { class: 'l' }, p.name, other ? h('br') : null, other)));
        });
      });

      var del = h('button', { type: 'button', class: 'bhas-btn danger full' }, "Supprimer l'intervenant");
      del.addEventListener('click', function () {
        if (!confirm('Supprimer ' + (c.name || 'cet intervenant') + ' ?')) return;
        busy(del, true, 'Suppression…');
        api('DELETE', '/api/cleaners/' + cid(c), undefined, { agency: true }).then(function () { toast('Intervenant supprimé'); pop(); })
          .catch(function (e) { toast(e.message, true); busy(del, false); });
      });
      b.appendChild(del);
    }
  };
  function copy(t) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Lien copié'); })
      .catch(function () { window.prompt('Copiez le lien :', t); });
  }

  /* ───────────── Messages automatiques ───────────── */
  var TRIGGERS_T = [['on_booking', 'À la réservation', 0], ['before_arrival', "Avant l'arrivée", 1], ['on_arrival', "À l'arrivée", 0], ['after_arrival', "Après l'arrivée", 1], ['before_departure', 'Avant le départ', 1], ['on_departure', 'Au départ', 0], ['after_departure', 'Après le départ', 1]];
  var PLATFORMS_T = [['platform_airbnb', 'Airbnb'], ['platform_booking', 'Booking.com'], ['platform_direct', 'Direct / BHGuest']];
  var CONDS_T = [['deposit_active', 'Caution validée'], ['deposit_pending', 'Caution en attente'], ['police_complete', 'Fiche de police complète']];
  function parseCond(raw) {
    var t = (!raw || raw === 'always') ? [] : String(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var i = t.indexOf('checkin_complete'); if (i >= 0) { t.splice(i, 1); if (t.indexOf('deposit_active') < 0) t.push('deposit_active'); if (t.indexOf('police_complete') < 0) t.push('police_complete'); }
    t = t.map(function (x) { return x === 'deposit_captured' ? 'deposit_active' : x; });
    return { conds: t.filter(function (x) { return CONDS_T.some(function (c) { return c[0] === x; }); }), plats: t.filter(function (x) { return PLATFORMS_T.some(function (c) { return c[0] === x; }); }) };
  }
  function trigLabel(t) {
    var type = gs(t, 'trigger_type'), d = +gs(t, 'trigger_offset_days') || 0, hh = +gs(t, 'trigger_offset_hours') || 0;
    var def = TRIGGERS_T.filter(function (x) { return x[0] === type; })[0];
    if (!def) return type || '';
    if (!def[2]) return def[1];
    var sign = type.indexOf('before') === 0 ? '-' : '+';
    return def[1] + (d ? ' · J' + sign + d : hh ? ' · ' + hh + ' h' : '');
  }
  function tplPropIds(t) { var v = gs(t, 'property_ids'); if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } } return Array.isArray(v) ? v.map(String) : []; }
  VIEWS.templates = {
    wide: true,
    render: function (ctx) {
      ctx.setHead('Messages automatiques');
      var b = ctx.body();
      var filter = h('select', { class: 'bhas-select' }, h('option', { value: '' }, 'Tous les logements'));
      var listBox = h('div', { style: 'display:grid;gap:14px' });
      b.appendChild(field('Logement', filter));
      b.appendChild(listBox);
      GET('/api/properties', { agency: true }).then(function (d) {
        cache.tplProps = (d.properties || []).map(function (p) { return { id: String(p._id || p.id), name: p.internal_name || p.internalName || p.name }; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
        cache.tplProps.forEach(function (p) { filter.appendChild(h('option', { value: p.id, selected: cache.tplFilter === p.id }, p.name)); });
      }).catch(function () {});
      filter.addEventListener('change', function () { cache.tplFilter = filter.value || null; load(); });
      load();
      function load() {
        listBox.innerHTML = ''; listBox.appendChild(loading());
        GET('/api/message-templates' + (cache.tplFilter ? '?property_id=' + encodeURIComponent(cache.tplFilter) : ''), { agency: true }).then(function (d) {
          var list = Array.isArray(d) ? d : (d.templates || []);
          listBox.innerHTML = '';
          if (!list.length) { listBox.appendChild(card([empty('Aucun message automatique.')])); return; }
          listBox.appendChild(card(list.map(function (t) {
            var c = parseCond(gs(t, 'send_condition')); var ids = tplPropIds(t);
            var ctxLine = [trigLabel(t), c.plats.length ? c.plats.map(function (p) { return PLATFORMS_T.filter(function (x) { return x[0] === p; })[0][1]; }).join(', ') : null, ids.length ? plural(ids.length, 'logement') : 'Tous les logements'].filter(Boolean).join(' · ');
            var toggle = sw(t.active !== false, function (v, el) {
              el.disabled = true;
              api('PUT', '/api/message-templates/' + t.id, { active: v }, { agency: true }).then(function () { t.active = v; })
                .catch(function (e) { el.set(!v); toast(e.message, true); }).then(function () { el.disabled = false; });
            });
            toggle.addEventListener('click', function (e) { e.stopPropagation(); });
            var r = row({ label: t.title || 'Sans titre', sub: ctxLine, right: toggle, onClick: function () { push('templateEdit', t); }, chevron: false });
            return r;
          })));
        }).catch(function (e) { listBox.innerHTML = ''; listBox.appendChild(errorBox(e, load)); });
      }
    }
  };
  VIEWS.templateEdit = {
    wide: true,
    render: function (ctx) {
      var t = ctx.arg;
      ctx.setHead(t.title || 'Message');
      var b = ctx.body();
      var title = input(t.title);
      var msg = h('textarea', { class: 'bhas-textarea', style: 'min-height:200px' }); msg.value = t.message || '';
      var trig = h('select', { class: 'bhas-select' }, TRIGGERS_T.map(function (x) { return h('option', { value: x[0], selected: x[0] === gs(t, 'trigger_type') }, x[1]); }));
      var days = input(gs(t, 'trigger_offset_days') || 0, { type: 'number', min: 0 }), hours = input(gs(t, 'trigger_offset_hours') || 0, { type: 'number', min: 0 });
      var offsets = h('div', { class: 'bhas-grid2' }, field('Jours', days), field('Heures', hours));
      function syncOffsets() { var def = TRIGGERS_T.filter(function (x) { return x[0] === trig.value; })[0]; offsets.style.display = def && def[2] ? 'grid' : 'none'; }
      trig.addEventListener('change', syncOffsets); syncOffsets();
      var active = t.active !== false;
      b.appendChild(card([field('Titre', title), field('Message', msg), h('div', { class: 'bhas-note', style: 'padding:0' }, 'Les variables entre accolades (ex. {{guest_name}}) sont remplacées à l’envoi.'), field('Déclencheur', trig), offsets], 'pad'));
      b.appendChild(card([row({ label: 'Actif', right: sw(active, function (v) { active = v; }) })]));
      var c = parseCond(gs(t, 'send_condition'));
      var platBoxes = PLATFORMS_T.map(function (p) { return h('input', { type: 'checkbox', value: p[0], checked: c.plats.indexOf(p[0]) >= 0 }); });
      b.appendChild(label('Plateformes'));
      b.appendChild(card(PLATFORMS_T.map(function (p, i) { return h('label', { class: 'bhas-check' }, platBoxes[i], h('span', { class: 'l' }, p[1])); })));
      b.appendChild(h('div', { class: 'bhas-note' }, 'Aucune case cochée : toutes les plateformes.'));
      var condBoxes = CONDS_T.map(function (p) { return h('input', { type: 'checkbox', value: p[0], checked: c.conds.indexOf(p[0]) >= 0 }); });
      b.appendChild(label('Conditions d’envoi'));
      b.appendChild(card(CONDS_T.map(function (p, i) { return h('label', { class: 'bhas-check' }, condBoxes[i], h('span', { class: 'l' }, p[1])); })));
      var ids = tplPropIds(t);
      var scope = ids.length ? 'some' : 'all';
      var propBox = card([]);
      var propChecks = [];
      b.appendChild(label('Logements'));
      b.appendChild(seg([{ value: 'all', label: 'Tous les logements' }, { value: 'some', label: 'Certains' }], scope, function (v) { scope = v; propBox.style.display = v === 'some' ? '' : 'none'; }));
      propBox.style.display = scope === 'some' ? '' : 'none';
      b.appendChild(propBox);
      var propsP = cache.tplProps ? Promise.resolve(cache.tplProps) : GET('/api/properties', { agency: true }).then(function (d) { return (d.properties || []).map(function (p) { return { id: String(p._id || p.id), name: p.internal_name || p.internalName || p.name }; }); });
      propsP.then(function (props) {
        props.forEach(function (p) { var cb = h('input', { type: 'checkbox', value: p.id, checked: ids.indexOf(p.id) >= 0 }); propChecks.push(cb); propBox.appendChild(h('label', { class: 'bhas-check' }, cb, h('span', { class: 'l' }, p.name))); });
      });
      var save = h('button', { type: 'button', class: 'bhas-btn full' }, 'Enregistrer');
      save.addEventListener('click', function () {
        var cond = condBoxes.filter(function (x) { return x.checked; }).map(function (x) { return x.value; }).sort()
          .concat(platBoxes.filter(function (x) { return x.checked; }).map(function (x) { return x.value; }).sort());
        var pids = scope === 'some' ? propChecks.filter(function (x) { return x.checked; }).map(function (x) { return x.value; }) : [];
        if (scope === 'some' && !pids.length) { toast('Choisissez au moins un logement.', true); return; }
        var def = TRIGGERS_T.filter(function (x) { return x[0] === trig.value; })[0];
        var body = { title: title.value.trim(), message: msg.value, trigger_type: trig.value, trigger_offset_days: def[2] ? (parseInt(days.value, 10) || 0) : 0, trigger_offset_hours: def[2] ? (parseInt(hours.value, 10) || 0) : 0, send_condition: cond.length ? cond.join(',') : 'always', property_ids: pids, active: active };
        busy(save, true);
        api('PUT', '/api/message-templates/' + t.id, body, { agency: true }).then(function (r) { Object.assign(t, r.template || body); toast('Message enregistré'); })
          .catch(function (e) { toast(e.message, true); }).then(function () { busy(save, false); });
      });
      b.appendChild(save);
    }
  };

  /* ───────────── Notifications ───────────── */
  var NOTIFS = [['notif_new_reservation', 'Nouvelle réservation'], ['notif_reservation_cancelled', 'Réservation annulée'], ['notif_new_message', 'Nouveau message voyageur'], ['notif_daily_summary', 'Résumé quotidien (8 h)'], ['notif_reminder_j1', 'Rappel la veille (18 h)'], ['notif_cleaning_alert', 'Ménage non commencé, arrivée proche'], ['notif_checklist_done', 'Checklist ménage validée'], ['notif_new_invoice', 'Nouvelle facture'], ['notif_template_failed', "Échec d'un message automatique"]];
  function updateNotifLabel() {
    var s = cache.notifs; if (!s) return;
    var n = NOTIFS.filter(function (x) { return !!gs(s, x[0]); }).length;
    setVal('bhasvNotifs', n + ' sur ' + NOTIFS.length + ' active' + (n === 1 ? '' : 's'), 'notifs');
  }
  VIEWS.notifications = {
    render: function (ctx) {
      ctx.setHead('Notifications');
      var b = ctx.body();
      b.appendChild(loading());
      GET('/api/settings/notifications').then(function (s) {
        cache.notifs = s;
        b.innerHTML = '';
        b.appendChild(h('div', { class: 'bhas-note' }, 'Notifications envoyées sur votre téléphone et par e-mail.'));
        b.appendChild(card(NOTIFS.map(function (n) {
          return row({ label: n[1], right: sw(!!gs(s, n[0]), function (v, el) {
            s[n[0]] = v; updateNotifLabel();
            var body = {}; body[n[0]] = v;
            api('POST', '/api/settings/notifications', body).catch(function (e) { s[n[0]] = !v; el.set(!v); updateNotifLabel(); toast(e.message, true); });
          }) });
        })));
      }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e.status === 401 || e.status === 403 ? new Error('Réservé au compte principal.') : e, ctx.refresh)); });
    }
  };

  /* ───────────── Aide ───────────── */
  VIEWS.help = {
    wide: true,
    render: function (ctx) {
      ctx.setHead('Aide et tutoriels');
      var b = ctx.body();
      b.appendChild(loading());
      GET('/api/help/content').then(function (d) {
        b.innerHTML = '';
        var ord = function (a, z) { return (gs(a, 'display_order') || 0) - (gs(z, 'display_order') || 0); };
        var faq = (d.faq || []).slice().sort(ord), videos = (d.videos || []).slice().sort(ord), guides = (d.guides || []).slice().sort(ord);
        var q = h('input', { placeholder: 'Rechercher dans l’aide…', type: 'search' });
        b.appendChild(h('label', { class: 'bhas-search' }, svg('search', 18), q));
        if (guides.length) {
          b.appendChild(label('Guides'));
          b.appendChild(card(guides.map(function (gd) {
            return row({ icon: 'book', label: gd.title, sub: [gd.description, gs(gd, 'time_label')].filter(Boolean).join(' · ') || null,
              right: gs(gd, 'badge_label') ? h('span', { class: 'bhas-pill ok' }, gs(gd, 'badge_label')) : null, href: gs(gd, 'page_url') });
          })));
        }
        if (videos.length) {
          b.appendChild(label('Vidéos'));
          b.appendChild(h('div', { class: 'bhas-videos' }, videos.map(function (v) {
            var id = gs(v, 'youtube_id');
            return h('a', { class: 'bhas-video', href: 'https://www.youtube.com/watch?v=' + id, target: '_blank', rel: 'noopener' },
              h('span', { class: 'th' }, h('img', { src: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', alt: '', loading: 'lazy' })), v.title);
          })));
        }
        var faqLabel = label('Questions fréquentes'), faqCard = card([]);
        var items = faq.map(function (f) {
          var el = h('details', { class: 'bhas-faq' }, h('summary', null, f.question, chev()), h('div', { class: 'a' }, gs(f, 'answer_text') || ''));
          el._t = (f.question + ' ' + (gs(f, 'answer_text') || '')).toLowerCase();
          faqCard.appendChild(el); return el;
        });
        var none = empty('Aucun résultat. Écrivez-nous, on répond sous 2 h.'); none.style.display = 'none'; faqCard.appendChild(none);
        if (faq.length) { b.appendChild(faqLabel); b.appendChild(faqCard); }
        q.addEventListener('input', function () {
          var s = q.value.trim().toLowerCase(), any = false;
          items.forEach(function (el) { var m = !s || el._t.indexOf(s) >= 0; el.style.display = m ? '' : 'none'; if (m) any = true; if (s && m) el.open = true; });
          none.style.display = any ? 'none' : '';
        });
        b.appendChild(h('button', { type: 'button', class: 'bhas-btn ghost full', onClick: function () { push('support'); } }, 'Poser une question au support'));
      }).catch(function (e) { b.innerHTML = ''; b.appendChild(errorBox(e, ctx.refresh)); });
    }
  };

  /* ───────────── Nous écrire ───────────── */
  VIEWS.support = {
    wide: true,
    render: function (ctx) {
      ctx.setHead('Nous écrire', null, 'Réponse sous 2 h, du lundi au samedi.');
      var chat = h('div', { class: 'bhas-chat' }, loading());
      var ta = h('textarea', { rows: 1, placeholder: 'Votre message…' });
      var sendBtn = h('button', { type: 'button', class: 'bhas-iconbtn primary', 'aria-label': 'Envoyer' }, svg('send', 18));
      var file = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
      var imgBtn = h('button', { type: 'button', class: 'bhas-iconbtn', 'aria-label': 'Joindre une image', onClick: function () { file.click(); } }, svg('image', 18));
      ctx.view.appendChild(chat);
      ctx.view.appendChild(h('div', { class: 'bhas-composer' }, imgBtn, file, ta, sendBtn));
      var convId = null, msgs = [], timer = null;
      function draw() {
        chat.innerHTML = '';
        if (!msgs.length) chat.appendChild(empty('Posez votre question, un membre de l’équipe vous répond ici.'));
        msgs.forEach(function (m) {
          var me = (gs(m, 'sender_type') || 'user') === 'user';
          var img = gs(m, 'image_url');
          chat.appendChild(h('div', { class: 'bhas-msg ' + (me ? 'me' : 'them') }, m.message || '', img ? h('img', { src: img, alt: '' }) : null, h('time', null, fmtTime(gs(m, 'created_at')))));
        });
        chat.scrollTop = chat.scrollHeight;
      }
      function reload() { if (!convId) return; GET('/api/support/messages/' + convId).then(function (d) { var n = d.messages || []; if (n.length !== msgs.length) { msgs = n; draw(); } }).catch(function () {}); }
      GET('/api/support/conversation').then(function (d) {
        convId = (d.conversation || d).id;
        return GET('/api/support/messages/' + convId);
      }).then(function (d) { msgs = d.messages || []; draw(); timer = setInterval(reload, 10000); })
        .catch(function (e) { chat.innerHTML = ''; chat.appendChild(errorBox(e, ctx.refresh)); });
      ctx.onLeave(function () { clearInterval(timer); });
      function send() {
        var t = ta.value.trim(); if (!t || !convId) return;
        sendBtn.disabled = true; ta.value = '';
        api('POST', '/api/support/messages', { conversationId: convId, message: t }).then(function (m) { if (m && m.id) { msgs.push(m); draw(); } else reload(); })
          .catch(function (e) { ta.value = t; toast(e.message, true); }).then(function () { sendBtn.disabled = false; ta.focus(); });
      }
      sendBtn.addEventListener('click', send);
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
      ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0]; if (!f || !convId) return;
        var fd = new FormData(); fd.append('image', f); fd.append('conversationId', convId);
        imgBtn.disabled = true;
        api('POST', '/api/support/upload', fd).then(function (m) { if (m && m.id) { msgs.push(m); draw(); } else reload(); })
          .catch(function (e) { toast(e.message, true); }).then(function () { imgBtn.disabled = false; file.value = ''; });
      });
    }
  };

  /* ───────────── Montage / ouverture ───────────── */
  function mount() {
    if ($('bhasSheet')) return;
    if (!document.querySelector('link[href*="DM+Sans"]')) {
      document.head.appendChild(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap' }));
    }
    var st = document.createElement('style'); st.id = 'bhasStyle'; st.textContent = CSS; document.head.appendChild(st);
    document.body.appendChild(h('div', { class: 'bhas-scrim', id: 'bhasScrim', onClick: close }));
    document.body.appendChild(h('aside', { class: 'bhas-sheet', id: 'bhasSheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bhasSheetTitle', 'aria-hidden': 'true' },
      h('i', { class: 'bhas-halo a' }), h('i', { class: 'bhas-halo b' }),
      h('div', { id: 'bhasViews', style: 'position:relative;flex:1;min-height:0' }),
      h('div', { class: 'bhas-toast', id: 'bhasToast', role: 'status' })));
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !document.documentElement.classList.contains('bhas-open')) return;
      if (stack.length > 1) pop(); else close();
    });
  }

  var lastFocus = null;
  function open(dest) {
    mount();
    document.documentElement.classList.toggle('bhas-sub', isSub());
    lastFocus = document.activeElement;
    stack = [{ name: 'root' }];
    if (dest && VIEWS[dest]) stack.push({ name: dest });
    render();
    loadRoot();
    document.documentElement.classList.add('bhas-open');
    $('bhasSheet').setAttribute('aria-hidden', 'false');
    setTimeout(function () { var c = $('bhasSheetClose') || $('bhasSheet').querySelector('.bhas-back'); if (c) c.focus(); }, 60);
  }
  function close() {
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    document.documentElement.classList.remove('bhas-open');
    var s = $('bhasSheet'); if (s) s.setAttribute('aria-hidden', 'true');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function logout() {
    if (typeof window.logout === 'function') return window.logout();
    ['lcc_token', 'lcc_user'].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    location.href = '/login.html';
  }

  // « Comptes gérés » ouvre l'ancien sélecteur d'agence ; le rond aux initiales ouvre la feuille.
  var origSwitcher = null;
  function openSwitcher() {
    if (typeof origSwitcher === 'function') { close(); origSwitcher(); }
    else toast('Aucun autre compte géré.', false);
  }
  function hijack() {
    var cur = window.openAgencySwitcherModal;
    if (cur && cur !== openFromLegacy) origSwitcher = cur;
    if (cur !== openFromLegacy) window.openAgencySwitcherModal = openFromLegacy;
  }
  function openFromLegacy() { open(); }
  hijack();
  window.addEventListener('load', hijack);
  setTimeout(hijack, 1500);

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest(TRIGGERS);
    if (!t || t.closest('#bhasSheet')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    open(t.getAttribute('data-account-sheet') || null);
  }, true);

  // Lien profond : /page.html#compte ou #compte/notifications
  function fromHash() { var m = /^#compte(?:\/(\w+))?$/.exec(location.hash); if (m) open(m[1]); }
  window.addEventListener('hashchange', fromHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fromHash); else fromHash();

  window.BHAccountSheet = { open: open, close: close };
})();

/* ══════════════════════════════════════════════════════════════
   BHGuest — Navigation hôte commune
   Injecte une barre d'onglets en bas de chaque page hôte, avec
   l'onglet actif détecté depuis l'URL, et un accès permanent au
   site voyageur. Inclure en fin de <body> :
   <script src="host-nav.js"></script>
   ══════════════════════════════════════════════════════════════ */
(function () {
  var page = (location.pathname.split('/').pop() || '').toLowerCase();

  var TABS = [
    { href: 'host-dashboard.html',    icon: 'fa-house',            label: 'Accueil' },
    { href: 'host-calendar.html',     icon: 'fa-calendar-days',    label: 'Calendrier' },
    { href: 'host-messages.html',     icon: 'fa-comments',         label: 'Messages', big: true, badge: true },
    { href: 'host-stripe.html',       icon: 'fa-building-columns', label: 'Paiements' },
    { href: 'index.html',             icon: 'fa-user',             label: 'Voyageur' }
  ];

  var css = ''
    + '.hnav{position:fixed;bottom:0;left:0;right:0;z-index:900;'
    +   'background:rgba(255,255,255,.96);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);'
    +   'border-top:1px solid #EDE8E1;display:flex;align-items:stretch;justify-content:space-around;'
    +   'padding:6px 8px calc(env(safe-area-inset-bottom) + 6px);}'
    + '.hnav a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;'
    +   'text-decoration:none;color:#A8A29E;font-family:inherit;font-size:10.5px;font-weight:600;padding:4px 0;}'
    + '.hnav a i{font-size:18px;}'
    + '.hnav a.on{color:#C2410C;}'
    + '.hnav a.hnav-big i{width:44px;height:44px;border-radius:50%;background:#C2410C;color:#fff;'
    +   'display:flex;align-items:center;justify-content:center;font-size:17px;margin-top:-16px;'
    +   'box-shadow:0 4px 12px rgba(194,65,12,.32);}'
    + '.hnav a.hnav-big.on i{background:#9A3412;}'
    + '.hnav a{position:relative;}'
    + '.hnav-badge{position:absolute;top:-2px;right:calc(50% - 22px);min-width:17px;height:17px;border-radius:9px;'
    +   'background:#DC2626;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;'
    +   'justify-content:center;padding:0 4px;border:2px solid #fff;}'
    + '.hnav a.hnav-big .hnav-badge{top:-18px;right:calc(50% - 26px);}'
    + 'body{padding-bottom:calc(74px + env(safe-area-inset-bottom)) !important;}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var nav = document.createElement('nav');
  nav.className = 'hnav';
  nav.innerHTML = TABS.map(function (t) {
    var on = page === t.href ? ' on' : '';
    var big = t.big ? ' hnav-big' : '';
    return '<a href="' + t.href + '" class="' + (on + big).trim() + '"'
      + (t.badge ? ' data-badge="1"' : '') + '>'
      + '<i class="fas ' + t.icon + '"></i><span>' + t.label + '</span></a>';
  }).join('');
  document.body.appendChild(nav);

  // Badge messages non lus (silencieux si non connecté ou erreur)
  var token = localStorage.getItem('bhguest_host_token');
  if (token) {
    fetch('/api/host/conversations/unread-count', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.unread) return;
        var a = nav.querySelector('a[data-badge]');
        if (!a) return;
        var b = document.createElement('span');
        b.className = 'hnav-badge';
        b.textContent = d.unread > 9 ? '9+' : d.unread;
        a.appendChild(b);
      })
      .catch(function () {});
  }
})();

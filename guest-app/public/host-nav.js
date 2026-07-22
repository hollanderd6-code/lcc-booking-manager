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
    { href: 'host-add-property.html', icon: 'fa-plus',             label: 'Ajouter', big: true },
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
    + 'body{padding-bottom:calc(74px + env(safe-area-inset-bottom)) !important;}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var nav = document.createElement('nav');
  nav.className = 'hnav';
  nav.innerHTML = TABS.map(function (t) {
    var on = page === t.href ? ' on' : '';
    var big = t.big ? ' hnav-big' : '';
    return '<a href="' + t.href + '" class="' + (on + big).trim() + '">'
      + '<i class="fas ' + t.icon + '"></i><span>' + t.label + '</span></a>';
  }).join('');
  document.body.appendChild(nav);
})();

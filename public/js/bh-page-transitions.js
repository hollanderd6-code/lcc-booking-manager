// ============================================================
// ✦ TRANSITIONS DE PAGE — fondu doux à la navigation (mobile)
// Remplace le "flash blanc" du multi-page par un fondu entrée/sortie.
// Sûr : ignore ancres, target _blank, téléchargements, modificateurs.
// ============================================================
(function () {
  'use strict';
  if (!('ontouchstart' in window)) return;          // apps mobiles surtout
  if (window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;

  var st = document.createElement('style');
  st.textContent =
    // « backwards » et non « both » : avec « both », l'animation reste appliquée après la fin
    // (transform:none figé). Safari traite alors <body> comme conteneur des éléments
    // position:fixed : feuilles et fenêtres se calaient en bas de la page entière, hors écran.
    'body{animation:bhPageIn .26s ease backwards}' +
    'body.bh-in-done{animation:none}' +
    '@keyframes bhPageIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
    'body.bh-leaving{opacity:0;transform:translateY(-5px);transition:opacity .18s ease,transform .18s ease}';
  document.head.appendChild(st);

  function interne(a) {
    if (!a || !a.href) return false;
    if (a.target === '_blank' || a.hasAttribute('download')) return false;
    if (a.getAttribute('href').charAt(0) === '#') return false;
    if (/^(mailto:|tel:|javascript:)/i.test(a.getAttribute('href'))) return false;
    try { return new URL(a.href).origin === location.origin; } catch (e) { return false; }
  }

  document.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    var a = e.target.closest('a');
    if (!interne(a)) return;
    if (a.href === location.href) return;
    e.preventDefault();
    document.body.classList.add('bh-leaving');
    setTimeout(function () { window.location.href = a.href; }, 170);
  }, true);

  document.addEventListener('animationend', function (e) { if (e.target === document.body) document.body.classList.add('bh-in-done'); });
  setTimeout(function () { if (document.body) document.body.classList.add('bh-in-done'); }, 600);

  // Revenir en arrière (bfcache) : retirer l'état sortant
  window.addEventListener('pageshow', function () { document.body.classList.remove('bh-leaving'); });
})();

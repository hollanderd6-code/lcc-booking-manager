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
    'body{animation:bhPageIn .26s ease both}' +
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

  // Revenir en arrière (bfcache) : retirer l'état sortant
  window.addEventListener('pageshow', function () { document.body.classList.remove('bh-leaving'); });
})();

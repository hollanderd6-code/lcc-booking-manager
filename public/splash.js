/* ══════════════════════════════════════════════════════════════
 * splash.js — Écran d'ouverture Boostinghost
 * ------------------------------------------------------------------
 * À charger EN TOUT PREMIER dans le <head> de login.html :
 *   <script src="/splash.js"></script>
 *
 * • Ne joue QU'EN NATIF (Capacitor) — le web n'est pas touché.
 * • Ne joue QU'UNE FOIS par lancement (pas à chaque navigation).
 * • Masque le splash natif dès que l'overlay est en place : c'est ce
 *   qui permet de voir cet écran malgré launchShowDuration: 2000.
 * • Reste ≥ 2 s, puis fondu de sortie vers l'app.
 *
 * Fond : #0E3B2E (vert bouteille) — identique au LaunchScreen natif,
 * pour que la bascule entre les deux écrans soit invisible.
 * ══════════════════════════════════════════════════════════════ */
(function () {
  var LOGO = '/img/brand/web/mono-carre.svg';
  var MIN  = 2000;   // durée minimale d'affichage, en ms

  var isNative = !!(window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform())
    || window.location.protocol === 'capacitor:'
    || window.location.protocol === 'ionic:';
  if (!isNative) return;

  try { if (sessionStorage.getItem('bh_splash_v1')) return; } catch (e) {}
  try { sessionStorage.setItem('bh_splash_v1', '1'); } catch (e) {}

  var CSS = '#bh-splash{position:fixed;inset:0;z-index:2147483647;background:#0E3B2E;'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;'
    + 'transition:opacity .45s ease}'
    + '#bh-splash.bh-hide{opacity:0}'
    + '#bh-splash .bh-mark{width:38vw;max-width:150px;height:auto;opacity:0;'
    /* brightness(0) invert(1) rend le trace blanc quelle que soit sa couleur
       d\'origine : le monogramme reste visible sur le vert dans tous les cas */
    + 'filter:brightness(0) invert(1);'
    + 'animation:bhMark .62s cubic-bezier(.22,1,.36,1) forwards;animation-delay:.12s}'
    + '#bh-splash .bh-b{display:none;font-family:"Cormorant Garamond",Georgia,serif;'
    + 'font-size:104px;line-height:1;color:#F2EADA;opacity:0;'
    + 'animation:bhMark .62s cubic-bezier(.22,1,.36,1) forwards;animation-delay:.12s}'
    + '@keyframes bhMark{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}'
    + '@media(prefers-reduced-motion:reduce){#bh-splash .bh-mark,#bh-splash .bh-b'
    + '{animation:none;opacity:1}#bh-splash{transition:none}}';

  var HTML = '<img class="bh-mark" src="' + LOGO + '" alt="" '
    + 'onerror="this.style.display=\'none\';'
    + 'this.nextElementSibling.style.display=\'block\'">'
    + '<span class="bh-b">B</span>';

  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);

    var ov = document.createElement('div');
    ov.id = 'bh-splash';
    ov.setAttribute('aria-hidden', 'true');
    ov.innerHTML = HTML;
    (document.body || document.documentElement).appendChild(ov);

    // Masque le splash natif une fois l'overlay reellement peint
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          var SP = window.Capacitor && window.Capacitor.Plugins
                   && window.Capacitor.Plugins.SplashScreen;
          if (SP && SP.hide) SP.hide();
        } catch (e) {}
      });
    });

    var start = Date.now(), gone = false;
    function hide() {
      if (gone || !ov) return;
      gone = true;
      ov.classList.add('bh-hide');
      setTimeout(function () {
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        ov = null;
      }, 480);
    }
    function done() { setTimeout(hide, Math.max(0, MIN - (Date.now() - start))); }

    if (document.readyState === 'complete') done();
    else window.addEventListener('load', done);
    setTimeout(hide, 5000); // filet de securite
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();

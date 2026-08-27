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
 * Animation : le cadre arrondi se trace au crayon (stroke-dashoffset),
 * puis le B apparaît en fondu une fois le trait bouclé.
 *
 * Le monogramme est inline plutôt que charge en <img> : c'est la seule
 * facon d'animer le trace, un SVG externe etant opaque au CSS de la page.
 * Fond #0E3B2E, identique au LaunchScreen natif : la bascule entre les
 * deux ecrans est invisible.
 * ══════════════════════════════════════════════════════════════ */
(function () {
  var MIN = 2000;   // durée minimale d'affichage, en ms

  var isNative = !!(window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform())
    || window.location.protocol === 'capacitor:'
    || window.location.protocol === 'ionic:';
  if (!isNative) return;

  try { if (sessionStorage.getItem('bh_splash_v1')) return; } catch (e) {}
  try { sessionStorage.setItem('bh_splash_v1', '1'); } catch (e) {}

  var CSS = [
    '#bh-splash{position:fixed;inset:0;z-index:2147483647;background:#0E3B2E;',
    'display:flex;align-items:center;justify-content:center;',
    'transition:opacity .45s ease}',
    '#bh-splash.bh-hide{opacity:0}',
    '#bh-splash .bh-mark{width:42vw;max-width:168px;height:auto}',

    /* Le cadre se trace : 385 = perimetre approche du rect arrondi */
    '#bh-splash .bh-cadre{stroke-dasharray:385;stroke-dashoffset:385;',
    'animation:bhTrace 1.15s cubic-bezier(.65,0,.35,1) forwards;animation-delay:.1s}',
    '@keyframes bhTrace{to{stroke-dashoffset:0}}',

    /* Le B arrive une fois le trait presque boucle.
       L'animation porte sur le <g>, jamais sur le <path> : une transform CSS
       ecraserait l'attribut transform du path et le B serait dessine a sa
       taille brute, hors cadre. */
    '#bh-splash .bh-b{opacity:0;',
    'animation:bhB .55s cubic-bezier(.22,1,.36,1) forwards;animation-delay:.95s}',
    '@keyframes bhB{from{opacity:0}to{opacity:1}}',

    '@media(prefers-reduced-motion:reduce){',
    '#bh-splash .bh-cadre{animation:none;stroke-dashoffset:0}',
    '#bh-splash .bh-b{animation:none;opacity:1}',
    '#bh-splash{transition:none}}'
  ].join('');

  var HTML = '<svg class="bh-mark" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-label="Boostinghost">'
    + '<rect width="128" height="128" fill="#0E3B2E"/>'
    + '<rect class="bh-cadre" x="12.5" y="12.5" width="103" height="103" rx="16" '
    + 'fill="none" stroke="rgba(242,234,218,0.45)" stroke-width="1" stroke-linecap="round"/>'
    + '<g class="bh-b"><path fill="#F2EADA" transform="translate(43.21 87.40) scale(0.07296 -0.07296)" '
    + 'd="M304 337 315 353Q380 353 428.5 331.0Q477 309 504.0 270.5Q531 232 531 182Q531 130 502.5 87.5Q474 45 424.0 20.5Q374 -4 311 -4Q282 -4 241.0 -1.0Q200 2 166 2Q131 2 99.0 1.0Q67 0 42 0Q39 0 39.0 6.0Q39 12 42 12Q73 12 89.5 17.0Q106 22 112.5 37.0Q119 52 119 81V544Q119 573 113.0 587.5Q107 602 90.5 607.5Q74 613 43 613Q41 613 41.0 619.0Q41 625 43 625Q68 625 99.5 623.5Q131 622 166 622Q194 622 226.0 625.0Q258 628 287 628Q347 628 387.5 612.5Q428 597 449.0 568.0Q470 539 470 498Q470 442 427.0 398.5Q384 355 304 337ZM270 608Q250 608 237.5 603.0Q225 598 220.0 584.0Q215 570 215 542V346L179 353Q212 352 233.0 351.5Q254 351 256 351Q318 351 347.0 391.0Q376 431 376 489Q376 526 364.5 553.0Q353 580 329.5 594.0Q306 608 270 608ZM295 19Q366 19 398.0 55.5Q430 92 430 158Q430 232 391.5 279.0Q353 326 275 326Q260 326 235.0 325.5Q210 325 183 320L215 332V81Q215 60 220.0 46.0Q225 32 242.5 25.5Q260 19 295 19Z"/></g>'
    + '</svg>';

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

/**
 * ios-scroll-fix.js — remplacement propose
 * ============================================================================
 * ── CE QUE FAISAIT L'ANCIENNE VERSION ──────────────────────────────────────
 *
 *   document.documentElement.style.overflow = 'hidden';
 *   document.documentElement.style.position = 'fixed';
 *   document.documentElement.style.height   = '100vh';
 *   document.body.style.overflow = 'hidden';
 *   document.body.style.position = 'fixed';
 *   document.body.style.height   = '100vh';
 *
 * Trois problemes, dans l'ordre de gravite :
 *
 * 1. 100vh est FAUX sur iOS. La hauteur du viewport y varie avec les barres
 *    dynamiques, et 100vh vaut toujours la hauteur MAXIMALE. Le bas de la page
 *    passe donc sous la barre d'onglets : le dernier message du chat et la
 *    zone de saisie se retrouvent coupes des que le clavier apparait.
 *
 * 2. position:fixed sur <html> ET <body>. Un seul des deux suffit ; les deux
 *    creent un contexte de positionnement imbrique, ce qui casse les enfants
 *    en position:fixed — modales, toasts, clavier.
 *
 * 3. Des styles en ligne, impossibles a surcharger depuis une feuille sans
 *    !important, et invisibles pour qui lit le CSS.
 *
 * ── CE QUE FAIT CETTE VERSION ──────────────────────────────────────────────
 * Elle pose une classe sur <html> et laisse le CSS faire le travail, avec
 * 100dvh — la hauteur DYNAMIQUE, qui suit les barres et le clavier — et un
 * repli en -webkit-fill-available pour les iOS anterieurs a 16.4.
 * Le verrouillage ne porte que sur <body>.
 *
 * ── A VERIFIER SUR UN VRAI IPHONE ──────────────────────────────────────────
 * Ce fichier ne peut pas etre valide autrement. Sur chat-owner.html :
 *   1. la liste des messages defile jusqu'au dernier, clavier ferme ;
 *   2. clavier ouvert, la zone de saisie reste visible et collee au clavier ;
 *   3. clavier ferme, la page reprend toute sa hauteur sans espace blanc ;
 *   4. la page entiere ne « rebondit » pas quand on tire vers le bas ;
 *   5. une modale s'ouvre bien centree.
 *
 * Si un point echoue, revenez a l'ancienne version : git checkout HEAD~1 --
 * public/js/ios-scroll-fix.js
 * ============================================================================
 */
(function () {
  'use strict';

  if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;

  var style = document.createElement('style');
  style.id = 'bh-ios-scroll';
  style.textContent = [
    /* Le verrou ne porte que sur body : html garde son comportement normal,
       sinon les enfants en position:fixed perdent leur repere. */
    'html.bh-ios{height:100%;}',
    'html.bh-ios body{',
      'position:fixed;',
      'top:0;left:0;right:0;',
      'width:100%;',
      'overflow:hidden;',
      /* Repli d'abord, valeur moderne ensuite : un navigateur qui ignore dvh
         garde le repli, les autres l'ecrasent. */
      'height:-webkit-fill-available;',
      'height:100dvh;',
      /* Empeche le rebond elastique de la page entiere sans bloquer le
         defilement des zones internes. */
      'overscroll-behavior:none;',
    '}',
    /* Les zones qui doivent defiler le declarent explicitement. */
    'html.bh-ios .bh-scroll,',
    'html.bh-ios .messages-list,',
    'html.bh-ios .chat-messages,',
    'html.bh-ios .modal-body,',
    'html.bh-ios main.main-content{',
      'overflow-y:auto;',
      '-webkit-overflow-scrolling:touch;',
      'overscroll-behavior:contain;',
    '}'
  ].join('');

  (document.head || document.documentElement).appendChild(style);
  document.documentElement.classList.add('bh-ios');
})();

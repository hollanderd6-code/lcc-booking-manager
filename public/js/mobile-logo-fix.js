/* ============================================
   🔧 BOOSTINGHOST - FIX LOGO MOBILE FORCÉ
   
   Ce script force l'affichage du logo après le 
   chargement de la page, même si d'autres CSS 
   tentent de le masquer.
   
   À ajouter JUSTE AVANT </body>
   ============================================ */

(function() {
  'use strict';
  
  function forceLogoDisplay() {
    // Sur desktop (> 1366px), cacher mobile-header et ne rien forcer
    if (window.innerWidth > 1366) {
      const mobileHeader = document.querySelector('.mobile-header');
      if (mobileHeader) mobileHeader.style.display = 'none';
      return;
    }

    const mobileHeader = document.querySelector('.mobile-header');
    const mobileLogo = document.querySelector('.mobile-logo');
    const logoImg = document.querySelector('.mobile-logo img');
    const logoText = document.querySelector('.mobile-logo-text');
    
    if (window.innerWidth <= 768) {
      // Forcer l'affichage du header
      if (mobileHeader) {
        mobileHeader.style.cssText = `
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          padding: 12px 16px !important;
          background: #FFFFFF !important;
          border-bottom: 1px solid #E5E7EB !important;
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          z-index: 1000 !important;
          height: 60px !important;
          box-sizing: border-box !important;
        `;
      }
      
      // Forcer l'affichage du logo
      if (mobileLogo) {
        mobileLogo.style.cssText = `
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
          text-decoration: none !important;
          cursor: pointer !important;
          visibility: visible !important;
          opacity: 1 !important;
        `;
      }
      
      // Forcer l'affichage de l'image
      if (logoImg) {
        logoImg.style.cssText = `
          display: block !important;
          width: 32px !important;
          height: 32px !important;
          border-radius: 50% !important;
          flex-shrink: 0 !important;
          visibility: visible !important;
          opacity: 1 !important;
        `;
      }
      
      // Forcer l'affichage du texte
      if (logoText) {
        logoText.style.cssText = `
          display: inline-flex !important;
          align-items: center !important;
          font-size: 18px !important;
          font-weight: 700 !important;
          line-height: 1 !important;
          visibility: visible !important;
          opacity: 1 !important;
        `;
        
        // Forcer les couleurs sur les spans
        const spans = logoText.querySelectorAll('span');
        if (spans.length >= 2) {
          // "Boosting" en vert
          spans[0].style.cssText = `
            color: #10B981 !important;
            font-weight: 800 !important;
          `;
          // "host" en noir
          spans[1].style.cssText = `
            color: #111827 !important;
            font-weight: 600 !important;
          `;
        }
      }
      
      // Cacher le menu hamburger
      const menuBtn = document.getElementById('mobileMenuBtn');
      if (menuBtn) {
        menuBtn.style.display = 'none';
      }
      
      // Ajouter padding-top au body
      document.body.style.paddingTop = '60px';
    }
  }
  
  // Exécuter immédiatement
  forceLogoDisplay();
  
  // Exécuter après chargement du DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', forceLogoDisplay);
  }
  
  // Exécuter après chargement complet
  window.addEventListener('load', function() {
    forceLogoDisplay();
    // Forcer à nouveau après 100ms au cas où
    setTimeout(forceLogoDisplay, 100);
  });
  
  // Observer les changements de style pour les réappliquer
  const observer = new MutationObserver(function(mutations) {
    if (window.innerWidth <= 768) {
      forceLogoDisplay();
    }
  });
  
  // Observer le document entier
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
    subtree: true
  });
  
  // Réappliquer au redimensionnement
  window.addEventListener('resize', forceLogoDisplay);
  
  console.log('✅ Logo mobile force display activated');
})();

// ============================================
// 🚫 DÉSACTIVER PULL-TO-REFRESH
// À ajouter dans app.html ou index.html
// ============================================

(function() {
  'use strict';
  
  console.log('🚫 Désactivation du pull-to-refresh...');
  
  // Méthode 1 : Empêcher le scroll quand on est en haut
  let lastTouchY = 0;
  let preventPullToRefresh = false;
  
  document.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) return;
    lastTouchY = e.touches[0].clientY;
    
    // Vérifier si on est en haut de la page
    preventPullToRefresh = window.pageYOffset === 0;
  }, { passive: false });
  
  document.addEventListener('touchmove', function(e) {
    const touchY = e.touches[0].clientY;
    const touchYDelta = touchY - lastTouchY;
    lastTouchY = touchY;
    
    // Si on tire vers le bas (scroll up) ET qu'on est en haut de page
    if (preventPullToRefresh && touchYDelta > 0) {
      e.preventDefault();
      return;
    }
  }, { passive: false });
  
  // Méthode 2 : Bloquer l'overscroll
  document.body.addEventListener('touchmove', function(e) {
    if (document.body.scrollTop === 0 && e.touches[0].clientY > lastTouchY) {
      e.preventDefault();
    }
  }, { passive: false });
  
  // Méthode 3 : CSS via JavaScript (au cas où)
  const style = document.createElement('style');
  style.innerHTML = `
    html, body {
      overscroll-behavior-y: contain !important;
      -webkit-overflow-scrolling: touch !important;
    }
  `;
  document.head.appendChild(style);
  
  console.log('✅ Pull-to-refresh désactivé');
  
  // Debug : afficher quand on essaie de tirer
  let pullAttempts = 0;
  document.addEventListener('touchmove', function(e) {
    if (window.pageYOffset === 0) {
      pullAttempts++;
      if (pullAttempts % 10 === 0) {
        console.log('🚫 Tentative de pull-to-refresh bloquée');
      }
    }
  });
})();

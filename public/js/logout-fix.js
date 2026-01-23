/* ============================================
   🔧 FIX BOUTON DÉCONNEXION - Toutes les pages
   
   À ajouter APRÈS bh-layout.js dans toutes les pages
   ============================================ */

(function() {
  // Attendre que le DOM soit prêt ET que bh-layout.js ait injecté la sidebar
  function attachLogoutHandler() {
    const logoutBtn = document.getElementById('logoutBtn');
    
    if (logoutBtn) {
      // Vérifier si l'event listener n'est pas déjà attaché
      if (!logoutBtn.hasAttribute('data-logout-attached')) {
        logoutBtn.setAttribute('data-logout-attached', 'true');
        
        logoutBtn.addEventListener('click', function(e) {
          e.preventDefault();
          console.log('🚪 Déconnexion...');
          
          // Supprimer les tokens
          localStorage.removeItem('lcc_token');
          localStorage.removeItem('lcc_user');
          
          // Rediriger vers la page de login
          window.location.href = '/login.html';
        });
        
        console.log('✅ Bouton déconnexion configuré');
      }
    } else {
      // Si le bouton n'existe pas encore, réessayer dans 100ms
      setTimeout(attachLogoutHandler, 100);
    }
  }
  
  // Attacher l'event listener quand le DOM est prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachLogoutHandler);
  } else {
    // Si le DOM est déjà chargé, attacher immédiatement
    attachLogoutHandler();
  }
})();

(() => {
  const originalFetch = window.fetch;
  
  // URL de l'API en production
  const API_BASE_URL = 'https://lcc-booking-manager.onrender.com';
  
  // Détection de l'environnement mobile (Capacitor)
  const isMobileApp = () => {
    const isMobile = window.Capacitor !== undefined || 
           window.location.protocol === 'capacitor:' ||
           window.location.protocol === 'ionic:';
    
    console.log('🔍 [AUTH-FETCH] Détection mobile:', {
      isMobile,
      hasCapacitor: window.Capacitor !== undefined,
      protocol: window.location.protocol,
      href: window.location.href
    });
    
    return isMobile;
  };
  
  function getToken() {
    return localStorage.getItem('lcc_token');
  }
  
  // Convertir une URL relative en URL absolue si on est sur mobile
  function resolveUrl(url) {
    const mobile = isMobileApp();
    
    if (!mobile) {
      console.log('🌐 [AUTH-FETCH] Environnement WEB - URL conservée:', url);
      return url; // Web : on garde l'URL relative
    }
    
    // Mobile : convertir les URLs relatives en absolues
    if (url.startsWith('/')) {
      const resolvedUrl = API_BASE_URL + url;
      console.log('📱 [AUTH-FETCH] Environnement MOBILE - URL convertie:', url, '→', resolvedUrl);
      return resolvedUrl;
    }
    
    console.log('📱 [AUTH-FETCH] Environnement MOBILE - URL déjà absolue:', url);
    return url;
  }
  
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    
    // On ne touche qu'aux appels API
    const isApi = url.startsWith('/api/') || url.includes('/api/');
    if (!isApi) {
      return originalFetch(input, init);
    }
    
    console.log('🚀 [AUTH-FETCH] Appel API détecté:', url);
    
    // Résoudre l'URL (ajouter le domaine si mobile)
    const resolvedUrl = resolveUrl(url);
    
    // Laisse passer les routes publiques
    const publicPaths = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/verify-email',
      '/api/health',
      '/api/webhooks/stripe'
    ];
    
    const isPublic = publicPaths.some(p => url.includes(p));
    console.log('🔓 [AUTH-FETCH] Route publique?', isPublic);
    
    if (isPublic) {
      console.log('✅ [AUTH-FETCH] Appel sans token vers:', resolvedUrl);
      try {
        const response = await originalFetch(resolvedUrl, init);
        console.log('📥 [AUTH-FETCH] Réponse reçue:', response.status, response.statusText);
        return response;
      } catch (error) {
        console.error('❌ [AUTH-FETCH] Erreur réseau:', error);
        throw error;
      }
    }
    
    const token = getToken();
    const headers = new Headers(init.headers || {});
    
    if (token && !headers.get('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
      console.log('🔑 [AUTH-FETCH] Token ajouté');
    }
    
    try {
      console.log('✅ [AUTH-FETCH] Appel avec token vers:', resolvedUrl);
      const res = await originalFetch(resolvedUrl, { ...init, headers });
      console.log('📥 [AUTH-FETCH] Réponse reçue:', res.status, res.statusText);
      
      if (res.status === 401) {
        console.log('🚫 [AUTH-FETCH] 401 - Déconnexion');
        localStorage.removeItem('lcc_token');
        localStorage.removeItem('lcc_user');
        window.location.href = '/login.html';
      }
      
      return res;
    } catch (error) {
      console.error('❌ [AUTH-FETCH] Erreur réseau:', error);
      throw error;
    }
  };
  
  console.log('✅ [AUTH-FETCH] Système initialisé');
})();

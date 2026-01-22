(() => {
  const originalFetch = window.fetch;
  
  // URL de l'API en production
  const API_BASE_URL = 'https://lcc-booking-manager.onrender.com';
  
  // Détection de l'environnement mobile (Capacitor)
  const isMobileApp = () => {
    return window.Capacitor !== undefined || 
           window.location.protocol === 'capacitor:' ||
           window.location.protocol === 'ionic:';
  };
  
  function getToken() {
    return localStorage.getItem('lcc_token');
  }
  
  // Convertir une URL relative en URL absolue si on est sur mobile
  function resolveUrl(url) {
    if (!isMobileApp()) {
      return url; // Web : on garde l'URL relative
    }
    
    // Mobile : convertir les URLs relatives en absolues
    if (url.startsWith('/')) {
      return API_BASE_URL + url;
    }
    
    return url;
  }
  
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    
    // On ne touche qu'aux appels API
    const isApi = url.startsWith('/api/') || url.includes('/api/');
    if (!isApi) return originalFetch(input, init);
    
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
    
    if (publicPaths.some(p => url.includes(p))) {
      return originalFetch(resolvedUrl, init);
    }
    
    const token = getToken();
    const headers = new Headers(init.headers || {});
    
    if (token && !headers.get('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }
    
    const res = await originalFetch(resolvedUrl, { ...init, headers });
    
    if (res.status === 401) {
      localStorage.removeItem('lcc_token');
      localStorage.removeItem('lcc_user');
      window.location.href = '/login.html';
    }
    
    return res;
  };
})();

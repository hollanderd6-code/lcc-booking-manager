(() => {
  try {
    const originalFetch = window.fetch.bind(window);

    // URL de l'API en production (mobile)
    const API_BASE_URL = 'https://lcc-booking-manager.onrender.com';

    const isNative = () => {
      try {
        return !!window.Capacitor?.isNativePlatform?.() ||
          window.location.protocol === 'capacitor:' ||
          window.location.protocol === 'ionic:';
      } catch {
        return false;
      }
    };

    const getToken = () => {
      try { return localStorage.getItem('lcc_token'); } catch { return null; }
    };

    // Normalise input -> string url (ou null si impossible)
    const getUrlString = (input) => {
      try {
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        if (input && typeof input.url === 'string') return input.url; // Request
        if (input && typeof input.href === 'string') return input.href;
        return null;
      } catch {
        return null;
      }
    };

    const isApiCall = (urlStr) => {
      if (typeof urlStr !== 'string') return false;
      // on cible seulement nos routes API
      return urlStr.startsWith('/api/') || urlStr.includes('/api/');
    };

    // Convertit /api/... -> https://.../api/... en mobile
    const resolveUrl = (urlStr) => {
      if (typeof urlStr !== 'string') return urlStr;
      if (!isNative()) return urlStr;

      // mobile: si relatif racine, on préfixe
      if (urlStr.startsWith('/')) return API_BASE_URL + urlStr;

      // si relatif sans slash (rare), on le rend absolu aussi
      if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://') && !urlStr.startsWith('capacitor://')) {
        return API_BASE_URL + '/' + urlStr.replace(/^\.?\//, '');
      }

      return urlStr;
    };

    const publicPaths = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/verify-email',
      '/api/health',
      '/api/webhooks/stripe'
    ];

    window.fetch = async (input, init = {}) => {
      const urlStr = getUrlString(input);

      // Si on n'arrive pas à déterminer l'URL, on laisse passer
      if (!urlStr) {
        return originalFetch(input, init);
      }

      // On ne touche qu'aux appels API
      if (!isApiCall(urlStr)) {
        return originalFetch(input, init);
      }

      const resolvedUrl = resolveUrl(urlStr);

      // route publique ?
      const isPublic = publicPaths.some(p => urlStr.includes(p));

      if (isPublic) {
        return originalFetch(resolvedUrl, init);
      }

      // ajouter Authorization si token dispo
      const token = getToken();
      const headers = new Headers(init.headers || {});
      if (token && !headers.get('Authorization')) {
        headers.set('Authorization', 'Bearer ' + token);
      }

      const res = await originalFetch(resolvedUrl, { ...init, headers });

      // si 401: logout + redirection adaptée web/app
      if (res.status === 401) {
        try {
          localStorage.removeItem('lcc_token');
          localStorage.removeItem('lcc_user');
        } catch {}

        window.location.href = isNative() ? 'login.html' : '/login.html';
      }

      return res;
    };

    console.log('✅ [AUTH-FETCH] Système initialisé (robuste)');
  } catch (e) {
    // si ce script plante, on veut LE VOIR
    console.error('❌ [AUTH-FETCH] Init failed:', e?.name, e?.message, e?.stack || e);
  }
})();

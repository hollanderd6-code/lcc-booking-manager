(() => {
  const originalFetch = window.fetch;

  async function getToken() {
    // Utilise SecureStorage si disponible, sinon localStorage
    if (window.SecureStorage) {
      return await window.SecureStorage.getItem('lcc_token');
    }
    return localStorage.getItem('lcc_token');
  }

  async function clearAuth() {
    if (window.SecureStorage) {
      await window.SecureStorage.removeItem('lcc_token');
      await window.SecureStorage.removeItem('lcc_user');
    } else {
      localStorage.removeItem('lcc_token');
      localStorage.removeItem('lcc_user');
    }
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;

    // On ne touche qu'aux appels API
    const isApi = url.startsWith('/api/') || url.includes('/api/');
    if (!isApi) return originalFetch(input, init);

    // Laisse passer les routes publiques
    const publicPaths = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/verify-email',
      '/api/health',
      '/api/webhooks/stripe'
    ];
    if (publicPaths.some(p => url.includes(p))) {
      return originalFetch(input, init);
    }

    const token = await getToken();
    const headers = new Headers(init.headers || {});

    if (token && !headers.get('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }

    const res = await originalFetch(input, { ...init, headers });

    if (res.status === 401) {
      await clearAuth();
      window.location.href = '/login.html';
    }

    return res;
  };
})();

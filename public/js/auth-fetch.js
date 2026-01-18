(() => {
  const originalFetch = window.fetch;

  function getToken() {
    return localStorage.getItem('lcc_token');
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

    const token = getToken();
    const headers = new Headers(init.headers || {});

    if (token && !headers.get('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }

    const res = await originalFetch(input, { ...init, headers });

    if (res.status === 401) {
      localStorage.removeItem('lcc_token');
      localStorage.removeItem('lcc_user');
      window.location.href = '/login.html';
    }

    return res;
  };
})();

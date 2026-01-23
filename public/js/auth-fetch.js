// ============================================
// 🔐 AUTH-FETCH - Intercepteur fetch intelligent
// Version 3.0 - Corrigée pour iOS
// ============================================

(() => {
  console.log('🚀 [AUTH-FETCH] Initialisation...');

  try {
    const originalFetch = window.fetch.bind(window);

    // URL de l'API en production (mobile)
    const API_BASE_URL = 'https://lcc-booking-manager.onrender.com';

    // ============================================
    // 🔍 DÉTECTION NATIVE
    // ============================================

    const isNative = () => {
      try {
        return !!(
          window.Capacitor?.isNativePlatform?.() ||
          window.location.protocol === 'capacitor:' ||
          window.location.protocol === 'ionic:'
        );
      } catch {
        return false;
      }
    };

    // ============================================
    // 🔑 GESTION TOKEN
    // ============================================

    const getToken = () => {
      try {
        return localStorage.getItem('lcc_token');
      } catch {
        return null;
      }
    };

    // ============================================
    // 🔗 GESTION DES URLs
    // ============================================

    /**
     * Extrait l'URL sous forme de string
     */
    const getUrlString = (input) => {
      try {
        if (typeof input === 'string') return input;
        if (input instanceof URL) return input.toString();
        if (input instanceof Request) return input.url;
        if (input && typeof input.url === 'string') return input.url;
        if (input && typeof input.href === 'string') return input.href;
        return null;
      } catch {
        return null;
      }
    };

    /**
     * Vérifie si c'est un appel API
     */
    const isApiCall = (urlStr) => {
      if (typeof urlStr !== 'string') return false;
      // On cible uniquement nos routes API
      return urlStr.includes('/api/');
    };

    /**
     * Résout l'URL en fonction du contexte (web vs mobile)
     * ⚠️ IMPORTANT: Cette fonction ne doit PAS transformer une URL déjà absolue
     */
    const resolveUrl = (urlStr) => {
      if (typeof urlStr !== 'string') {
        console.warn('⚠️ [AUTH-FETCH] URL non-string:', typeof urlStr);
        return urlStr;
      }

      const native = isNative();
      console.log(`🔗 [AUTH-FETCH] Résolution URL: "${urlStr}" (native: ${native})`);

      // Si pas en mode natif, on ne touche à rien
      if (!native) {
        console.log('🌐 [AUTH-FETCH] Mode web, URL inchangée:', urlStr);
        return urlStr;
      }

      // ⚠️ CRITIQUE: Si l'URL est déjà absolue (http:// ou https://), 
      // on ne la modifie PAS pour éviter les doublons
      if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
        console.log('✅ [AUTH-FETCH] URL déjà absolue, inchangée:', urlStr);
        return urlStr;
      }

      // Si c'est un protocole Capacitor, on ne touche pas
      if (urlStr.startsWith('capacitor://') || urlStr.startsWith('ionic://')) {
        console.log('📱 [AUTH-FETCH] Protocole natif, inchangé:', urlStr);
        return urlStr;
      }

      // On ne préfixe que les chemins relatifs à la racine
      if (urlStr.startsWith('/')) {
        const resolved = API_BASE_URL + urlStr;
        console.log(`✅ [AUTH-FETCH] URL transformée: "${urlStr}" → "${resolved}"`);
        return resolved;
      }

      // Chemin relatif sans slash (rare)
      if (!urlStr.startsWith('.')) {
        const resolved = API_BASE_URL + '/' + urlStr;
        console.log(`✅ [AUTH-FETCH] URL normalisée: "${urlStr}" → "${resolved}"`);
        return resolved;
      }

      // Autres cas: on retourne tel quel
      console.log('⚠️ [AUTH-FETCH] URL non modifiée (cas edge):', urlStr);
      return urlStr;
    };

    // ============================================
    // 🔓 ROUTES PUBLIQUES
    // ============================================

    const publicPaths = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/verify-email',
      '/api/health',
      '/api/webhooks/stripe'
    ];

    const isPublicRoute = (urlStr) => {
      return publicPaths.some(path => urlStr.includes(path));
    };

    // ============================================
    // 🎯 INTERCEPTEUR FETCH
    // ============================================

    window.fetch = async (input, init = {}) => {
      const urlStr = getUrlString(input);

      // Si on n'arrive pas à déterminer l'URL, on laisse passer
      if (!urlStr) {
        console.warn('⚠️ [AUTH-FETCH] URL indéterminable, passthrough');
        return originalFetch(input, init);
      }

      // On ne touche qu'aux appels API
      if (!isApiCall(urlStr)) {
        return originalFetch(input, init);
      }

      console.log('🎯 [AUTH-FETCH] Interception appel API:', urlStr);

      // Résoudre l'URL (web vs mobile)
      const resolvedUrl = resolveUrl(urlStr);

      // Route publique ?
      const isPublic = isPublicRoute(urlStr);
      console.log(`🔐 [AUTH-FETCH] Route publique: ${isPublic}`);

      // Headers
      const headers = new Headers(init.headers || {});

      // Ajouter Authorization si token dispo et pas déjà présent
      if (!isPublic) {
        const token = getToken();
        if (token && !headers.get('Authorization')) {
          headers.set('Authorization', 'Bearer ' + token);
          console.log('🔑 [AUTH-FETCH] Token ajouté');
        }
      }

      // Log de la requête finale
      console.log('📤 [AUTH-FETCH] Requête finale:', {
        url: resolvedUrl,
        method: init.method || 'GET',
        hasAuth: headers.has('Authorization')
      });

      // Exécuter la requête
      let res;
      try {
        res = await originalFetch(resolvedUrl, { ...init, headers });
        console.log('📥 [AUTH-FETCH] Réponse:', res.status, res.statusText);
      } catch (err) {
        console.error('❌ [AUTH-FETCH] Erreur fetch:', err?.name, err?.message);
        throw err;
      }

      // Si 401: logout + redirection
      if (res.status === 401) {
        console.warn('🚨 [AUTH-FETCH] 401 Unauthorized, déconnexion...');
        try {
          localStorage.removeItem('lcc_token');
          localStorage.removeItem('lcc_user');
        } catch {}

        const redirectUrl = isNative() ? 'login.html' : '/login.html';
        console.log('🔄 [AUTH-FETCH] Redirection vers:', redirectUrl);
        window.location.href = redirectUrl;
      }

      return res;
    };

    console.log('✅ [AUTH-FETCH] Système initialisé avec succès');
    console.log('📱 [AUTH-FETCH] Mode:', isNative() ? 'NATIF' : 'WEB');
    console.log('🌐 [AUTH-FETCH] API Base URL:', API_BASE_URL);

  } catch (e) {
    console.error('❌ [AUTH-FETCH] Échec initialisation:', e?.name, e?.message, e?.stack || e);
  }
})();

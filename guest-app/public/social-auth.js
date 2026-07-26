// social-auth.js — Boutons « Continuer avec Google / Apple »
// Partagé par BHGuest et Boostinghost. Le conteneur porte les attributs :
//   data-social-login="guest" | "bh"   → point d'entrée serveur
//   data-redirect="host-dashboard.html" (optionnel, pour BH)
// Sur iOS natif, on passe par les plugins Capacitor si présents.
(function () {
  'use strict';

  // En natif, l'app tourne sur capacitor://localhost qui n'a pas d'API.
  // BHGuest tape sur www.boostinghost.fr (cf. API_URL dans app-guest.js).
  var API = window.__SOCIAL_API ||
            (isNativeEarly() ? 'https://www.boostinghost.fr' : window.location.origin);

  function isNativeEarly() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  var cfg = null;

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // Le bundle Capacitor core n'enregistre pas les plugins tiers : on enregistre
  // SocialLogin explicitement si absent de Plugins.
  function getSocialLogin() {
    var C = window.Capacitor;
    if (!C) return null;
    if (C.Plugins && C.Plugins.SocialLogin) return C.Plugins.SocialLogin;
    if (typeof C.registerPlugin === 'function') {
      try {
        var pg = C.registerPlugin('SocialLogin');
        if (pg) { C.Plugins = C.Plugins || {}; C.Plugins.SocialLogin = pg; return pg; }
      } catch (e) { console.error('[SOCIAL] registerPlugin:', e && e.message); }
    }
    return null;
  }

  // Init unique des providers natifs (Google + Apple via SocialLogin)
  var nativeInitDone = false;
  async function ensureNativeInit() {
    if (nativeInitDone || !isNative()) return;
    var SL = getSocialLogin();
    if (!SL || !SL.initialize) { console.error('[SOCIAL] SocialLogin indisponible'); return; }
    var iosId = cfg && cfg.googleIOSGuest;   // client iOS propre a BHGuest
    var webId = cfg && cfg.google;
    var opts = {};
    if (iosId) {
      opts.google = { iOSClientId: iosId, iOSServerClientId: webId || iosId, webClientId: webId || iosId, mode: 'online' };
    } else {
      console.warn('[SOCIAL] googleIOSGuest absent : Google natif desactive');
    }
    opts.apple = {};
    console.log('[SOCIAL] initialize providers=', Object.keys(opts).join(','));
    await SL.initialize(opts);
    nativeInitDone = true;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src; s.async = true; s.defer = true;
      s.onload = resolve; s.onerror = function () { reject(new Error('Script indisponible')); };
      document.head.appendChild(s);
    });
  }

  function showError(box, msg) {
    var el = box.querySelector('.social-err');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    else { console.warn('[SOCIAL]', msg); }
  }

  // Envoie le jeton d'identité au serveur et connecte l'utilisateur
  async function finish(box, provider, idToken, name) {
    var mode = box.getAttribute('data-social-login') || 'guest';
    var isBh = (mode === 'bh' || mode === 'host');
    var url = isBh ? '/api/auth/social' : '/api/guest/auth/social';
    var btns = box.querySelectorAll('button');
    btns.forEach(function (b) { b.disabled = true; });
    try {
      var res = await fetch(API + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: provider, idToken: idToken, name: name || null,
          asHost: mode === 'host'
        })
      });
      var d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Connexion refusée');

      if (isBh) {
        localStorage.setItem('lcc_token', d.token);
        if (d.isExternalHost) localStorage.setItem('bhguest_host_token', d.token);
        location.href = box.getAttribute('data-redirect') || (d.isExternalHost ? 'host-dashboard.html' : 'app.html');
      } else {
        // BHGuest : même format de session que la connexion par mot de passe
        localStorage.setItem('guest_session', JSON.stringify({
          token: d.session_token, email: d.email, name: d.name || null
        }));
        if (typeof window.onSocialLoginSuccess === 'function') window.onSocialLoginSuccess(d);
        else location.reload();
      }
    } catch (e) {
      showError(box, e.message);
      btns.forEach(function (b) { b.disabled = false; });
    }
  }

  // ── Google ──────────────────────────────────────────────────
  async function googleSignIn(box) {
    var SLg = isNative() ? getSocialLogin() : null;
    if (SLg) {
      try {
        await ensureNativeInit();
        var r = await SLg.login({ provider: 'google', options: { scopes: ['email', 'profile'] } });
        var t = r && (r.result && (r.result.idToken || r.result.id_token));
        if (t) return finish(box, 'google', t);
        showError(box, 'Connexion Google annulée'); return;
      } catch (e) {
        console.error('[SOCIAL] Google natif:', e);
        showError(box, /cancel|annul/i.test(e && e.message || '') ? 'Connexion Google annulée' : 'Connexion Google indisponible');
        return;
      }
    }
    if (!cfg || !cfg.google) { showError(box, 'Connexion Google non configurée'); return; }
    await loadScript('https://accounts.google.com/gsi/client');
    if (!window.google || !window.google.accounts) { showError(box, 'Google indisponible'); return; }
    window.google.accounts.id.initialize({
      client_id: cfg.google,
      callback: function (resp) {
        if (resp && resp.credential) finish(box, 'google', resp.credential);
        else showError(box, 'Connexion Google annulée');
      }
    });
    // Bouton officiel invisible : on le déclenche pour obtenir la popup
    var holder = box.querySelector('.gsi-holder');
    if (holder && !holder.dataset.rendered) {
      window.google.accounts.id.renderButton(holder, { theme: 'outline', size: 'large', width: 300 });
      holder.dataset.rendered = '1';
    }
    var real = holder && holder.querySelector('div[role="button"]');
    if (real) real.click();
    else window.google.accounts.id.prompt();
  }

  // ── Apple ───────────────────────────────────────────────────
  async function appleSignIn(box) {
    var SLa = isNative() ? getSocialLogin() : null;
    if (SLa) {
      try {
        await ensureNativeInit();
        var r = await SLa.login({ provider: 'apple', options: { scopes: ['name', 'email'] } });
        var res = (r && r.result) || {};
        var tok = res.idToken || res.identityToken || (res.authorization && res.authorization.idToken);
        var prof = res.profile || res;
        var nm = [prof && prof.givenName, prof && prof.familyName].filter(Boolean).join(' ') || (prof && prof.name) || null;
        if (tok) return finish(box, 'apple', tok, nm);
        showError(box, 'Connexion Apple annulée'); return;
      } catch (e) {
        console.error('[SOCIAL] Apple natif:', e);
        showError(box, /cancel|annul|1001/i.test(e && e.message || '') ? 'Connexion Apple annulée' : 'Connexion Apple indisponible');
        return;
      }
    }
    // Boostinghost et BHGuest peuvent avoir chacun leur Services ID
    var mode = box.getAttribute('data-social-login') || 'guest';
    var appleId = (mode === 'bh') ? cfg && cfg.appleBh : cfg && cfg.apple;
    var appleRedir = (mode === 'bh') ? cfg && cfg.appleRedirectBh : cfg && cfg.appleRedirect;
    if (!appleId) { showError(box, 'Connexion Apple non configurée'); return; }
    await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/fr_FR/appleid.auth.js');
    if (!window.AppleID) { showError(box, 'Apple indisponible'); return; }
    window.AppleID.auth.init({
      clientId: appleId,
      scope: 'name email',
      redirectURI: appleRedir,
      usePopup: true
    });
    try {
      var data = await window.AppleID.auth.signIn();
      var tok = data && data.authorization && data.authorization.id_token;
      // Apple ne transmet le nom qu'à la première autorisation
      var nm2 = data && data.user && data.user.name
        ? [data.user.name.firstName, data.user.name.lastName].filter(Boolean).join(' ') : null;
      if (tok) finish(box, 'apple', tok, nm2);
      else showError(box, 'Connexion Apple annulée');
    } catch (e) { showError(box, 'Connexion Apple annulée'); }
  }

  // ── Rendu des boutons ───────────────────────────────────────
  async function init() {
    var boxes = document.querySelectorAll('[data-social-login]');
    if (!boxes.length) return;
    try {
      var r = await fetch(API + '/api/auth/social/config');
      cfg = await r.json();
    } catch (e) { cfg = {}; }

    // Rien de configuré côté serveur : on n'affiche aucun bouton mort
    if (!cfg.google && !cfg.apple && !cfg.appleBh && !isNative()) return;

    var css = document.createElement('style');
    css.textContent =
      '.social-sep{display:flex;align-items:center;gap:12px;margin:18px 0;color:#A8A29E;font-size:12px}' +
      '.social-sep::before,.social-sep::after{content:"";flex:1;height:1px;background:#EDE8E1}' +
      '.social-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;' +
      'border:1px solid #DDD6CE;background:#fff;color:#1C1917;border-radius:12px;padding:13px;' +
      'font-size:14.5px;font-weight:600;font-family:inherit;cursor:pointer;margin-bottom:9px}' +
      '.social-btn:active{transform:scale(.98)}.social-btn:disabled{opacity:.6}' +
      '.social-btn.apple{background:#000;border-color:#000;color:#fff}' +
      '.social-btn svg{width:18px;height:18px;flex-shrink:0}' +
      '.social-err{display:none;color:#DC2626;font-size:13px;margin-top:6px;text-align:center}' +
      '.gsi-holder{position:absolute;left:-9999px;top:-9999px;opacity:0}';
    document.head.appendChild(css);

    var GOOGLE_SVG = '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.5 2.5 30.1 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.8 6.1C12.2 13.2 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v7.4h12.7c-.3 2.1-1.6 5.3-4.7 7.4l7.6 5.9c4.5-4.2 7.1-10.3 7.1-16.6z"/><path fill="#FBBC05" d="M10.3 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2 1.4-4.8 2.4-8.3 2.4-6.4 0-11.8-3.7-13.7-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>';
    var APPLE_SVG = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M17.05 12.54c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.97.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.87 2.3 1.15-.05 1.59-.75 2.98-.75 1.39 0 1.78.75 3 .72 1.24-.02 2.02-1.13 2.78-2.24.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.43-3.67zM14.8 5.4c.63-.77 1.06-1.83.94-2.9-.91.04-2.01.61-2.67 1.37-.59.68-1.1 1.76-.96 2.8 1.01.08 2.05-.51 2.69-1.27z"/></svg>';

    boxes.forEach(function (box) {
      var html = '<div class="social-sep">ou</div>';
      if (cfg.google || isNative())
        html += '<button type="button" class="social-btn" data-p="google">' + GOOGLE_SVG + ' Continuer avec Google</button>';
      if (cfg.apple || cfg.appleBh || isNative())
        html += '<button type="button" class="social-btn apple" data-p="apple">' + APPLE_SVG + ' Continuer avec Apple</button>';
      html += '<div class="social-err"></div><div class="gsi-holder"></div>';
      box.innerHTML = html;
      box.addEventListener('click', function (e) {
        var b = e.target.closest('.social-btn');
        if (!b) return;
        box.querySelector('.social-err').style.display = 'none';
        if (b.dataset.p === 'google') googleSignIn(box);
        else appleSignIn(box);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

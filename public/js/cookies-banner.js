/**
 * 🍪 Boostinghost — Bandeau Cookies RGPD
 * À inclure sur toutes les pages publiques avant </body>
 * Usage : <script src="/js/cookies-banner.js"></script>
 */
(function () {
  'use strict';

  // Ne pas afficher sur app native iOS/Android
  const IS_NATIVE = !!(window.Capacitor?.isNativePlatform?.() || window.location.protocol === 'capacitor:' || window.location.protocol === 'ionic:');
  if (IS_NATIVE) return;

  const COOKIE_KEY = 'bh_cookie_consent';
  const COOKIE_VERSION = '1';

  // Déjà accepté/refusé → on ne montre rien
  const stored = localStorage.getItem(COOKIE_KEY);
  if (stored) {
    try {
      const p = JSON.parse(stored);
      if (p.version === COOKIE_VERSION) return;
    } catch (e) {}
  }

  // ── CSS ──────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #bh-cookie-banner {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(120px);
      z-index: 99999;
      width: calc(100% - 48px);
      max-width: 680px;
      background: #FFFFFF;
      border: 1.5px solid rgba(26,122,94,.18);
      border-radius: 20px;
      box-shadow: 0 8px 40px rgba(26,122,94,.12), 0 2px 8px rgba(0,0,0,.06);
      padding: 20px 24px;
      display: flex;
      align-items: center;
      gap: 20px;
      font-family: 'DM Sans', sans-serif;
      transition: transform .45s cubic-bezier(.34,1.56,.64,1), opacity .35s ease;
      opacity: 0;
    }
    #bh-cookie-banner.bh-visible {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    #bh-cookie-banner.bh-hiding {
      transform: translateX(-50%) translateY(120px);
      opacity: 0;
    }
    .bh-cookie-icon {
      width: 44px;
      height: 44px;
      min-width: 44px;
      background: rgba(26,122,94,.08);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
    }
    .bh-cookie-body {
      flex: 1;
      min-width: 0;
    }
    .bh-cookie-title {
      font-size: 14px;
      font-weight: 700;
      color: #0D1117;
      margin-bottom: 3px;
      letter-spacing: -.01em;
    }
    .bh-cookie-text {
      font-size: 13px;
      color: #6B7280;
      line-height: 1.5;
    }
    .bh-cookie-text a {
      color: #1A7A5E;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .bh-cookie-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }
    .bh-btn {
      font-family: 'DM Sans', sans-serif;
      font-size: 13px;
      font-weight: 600;
      padding: 9px 18px;
      border-radius: 10px;
      cursor: pointer;
      border: none;
      white-space: nowrap;
      transition: all .18s ease;
    }
    .bh-btn-accept {
      background: #1A7A5E;
      color: white;
      box-shadow: 0 2px 8px rgba(26,122,94,.3);
    }
    .bh-btn-accept:hover {
      background: #15624B;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(26,122,94,.35);
    }
    .bh-btn-refuse {
      background: #F3F4F6;
      color: #6B7280;
      border: 1px solid #E5E7EB;
    }
    .bh-btn-refuse:hover {
      background: #E5E7EB;
      color: #374151;
    }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      #bh-cookie-banner {
        background: #1C2333;
        border-color: rgba(26,122,94,.25);
        box-shadow: 0 8px 40px rgba(0,0,0,.4);
      }
      .bh-cookie-title { color: #F9FAFB; }
      .bh-cookie-text { color: #9CA3AF; }
      .bh-btn-refuse {
        background: rgba(255,255,255,.07);
        color: #9CA3AF;
        border-color: rgba(255,255,255,.1);
      }
      .bh-btn-refuse:hover {
        background: rgba(255,255,255,.12);
        color: #F9FAFB;
      }
    }

    /* Mobile */
    @media (max-width: 600px) {
      #bh-cookie-banner {
        bottom: 16px;
        width: calc(100% - 32px);
        padding: 16px;
        flex-direction: column;
        align-items: flex-start;
        gap: 14px;
      }
      .bh-cookie-icon { display: none; }
      .bh-cookie-actions { width: 100%; }
      .bh-btn { flex: 1; text-align: center; padding: 11px 12px; }
    }

    /* Support thème v3 Boostinghost */
    html[data-theme-v3="1"] #bh-cookie-banner {
      background: #FDFCFA;
      border-color: rgba(26,122,94,.15);
    }
    html[data-theme="dark"] #bh-cookie-banner {
      background: #1C2333;
      border-color: rgba(26,122,94,.25);
    }
    html[data-theme="dark"] .bh-cookie-title { color: #F9FAFB; }
    html[data-theme="dark"] .bh-cookie-text { color: #9CA3AF; }
    html[data-theme="dark"] .bh-btn-refuse {
      background: rgba(255,255,255,.07);
      color: #9CA3AF;
      border-color: rgba(255,255,255,.1);
    }
  `;
  document.head.appendChild(style);

  // ── HTML ─────────────────────────────────────────────────
  const banner = document.createElement('div');
  banner.id = 'bh-cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Gestion des cookies');
  banner.innerHTML = `
    <div class="bh-cookie-icon"><img src="/images/logo.png" alt="Boostinghost" style="width:28px;height:28px;border-radius:6px;object-fit:cover;display:block;"></div>
    <div class="bh-cookie-body">
      <div class="bh-cookie-title">Ce site utilise des cookies</div>
      <div class="bh-cookie-text">
        Cookies nécessaires au fonctionnement du service. <a href="/politique-confidentialite.html">En savoir plus</a>
      </div>
    </div>
    <div class="bh-cookie-actions">
      <button class="bh-btn bh-btn-refuse" id="bh-refuse">Refuser</button>
      <button class="bh-btn bh-btn-accept" id="bh-accept">Accepter</button>
    </div>
  `;
  document.body.appendChild(banner);

  // ── Affichage avec délai ──────────────────────────────────
  setTimeout(() => banner.classList.add('bh-visible'), 800);

  // ── Actions ───────────────────────────────────────────────
  function dismiss(accepted) {
    banner.classList.add('bh-hiding');
    localStorage.setItem(COOKIE_KEY, JSON.stringify({
      version: COOKIE_VERSION,
      accepted: accepted,
      date: new Date().toISOString()
    }));
    setTimeout(() => banner.remove(), 450);
  }

  document.getElementById('bh-accept').addEventListener('click', () => dismiss(true));
  document.getElementById('bh-refuse').addEventListener('click', () => dismiss(false));

})();

// ── Intercepteur agency global : ajoute ?agency=all aux requêtes API ──
(function() {
  var _origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && localStorage.getItem('bh_agency_view') === 'all' && url.includes('/api/') && !url.includes('agency=')) {
      // Pas d'agency mode sur settings et support
      var page = window.location.pathname || '';
      if (page.indexOf('settings') === -1 && page.indexOf('support') === -1) {
        url += (url.includes('?') ? '&' : '?') + 'agency=all';
      }
    }
    return _origFetch.call(this, url, opts);
  };
})();

// ── Restaurer l'état agence depuis localStorage ──
window._agencyViewActive = (localStorage.getItem('bh_agency_view') === 'all');
window._agencyAccounts = window._agencyAccounts || null;
window._agencyAllReservations = window._agencyAllReservations || [];
window._agencyAllProperties = window._agencyAllProperties || [];

// ── Fonctions agence globales (disponibles sur toutes les pages) ──
if (typeof window.setAgencyView !== 'function') {
  window.setAgencyView = function(mode) {
    window._agencyViewActive = (mode === 'all');
    localStorage.setItem('bh_agency_view', mode);
    if (typeof updateAgencySwitcherLabel === 'function') updateAgencySwitcherLabel();
    window.location.reload();
  };
}

if (typeof window.loadAgencyAccountsForSwitcher !== 'function') {
  window.loadAgencyAccountsForSwitcher = async function() {
    var token = localStorage.getItem('lcc_token');
    if (!token || localStorage.getItem('lcc_managed_user')) return;
    try {
      var res = await fetch('/api/agency/delegations', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) return;
      var data = await res.json();
      if (!data.iManage || !data.iManage.length) return;
      if (!data.canActAsAgent) return;
      window._agencyAccounts = data.iManage;
      if (typeof window.renderAgencyToggle === 'function') window.renderAgencyToggle(data.iManage);
    } catch(e) {}
  };
}

if (typeof window.renderAgencyToggle !== 'function') {
  window.renderAgencyToggle = function(accounts) {
    if (!accounts || !accounts.length) return;
    var btn = document.getElementById('agencySwitcherBtn');
    if (btn) btn.style.display = 'inline-flex';
  };
}

(function () {
  'use strict';

/* /js/bh-layout.js – injection sidebar + header avec filtrage permissions sous-comptes */
// LOGO_B_SVG retire : remplace par LOGO_SIDEBAR / LOGO_MOBILE / LOGO_MONO.

/* Verrou complet (monogramme + mot-symbole + baseline).

   Rendu via un <span> et une image de fond, PAS un <img> : quatre feuilles
   differentes imposent width/height/object-fit a « toute image du logo »
   (bh-mobile.css, bh-v3-mobile.css, le style injecte plus bas, et
   mobile-logo-fix.js qui l'ecrit en inline). Un verrou 128x30 force dans un
   carre etait recadre en son milieu : on ne lisait plus que « OOST ».
   Un <span> echappe a toutes ces regles par construction. */
/* bhDiagLogo() en console : dit ce que contient l'en-tete, quelles
   dimensions sont reellement appliquees, et quelle regle CSS les impose. */
window.bhDiagLogo = function () {
  ['.mobile-logo', '.sidebar-logo'].forEach(function (sel) {
    var c = document.querySelector(sel);
    if (!c) return console.log('[BH]', sel, ': absent');
    var el = c.querySelector('.bh-verrou, img, svg');
    if (!el) return console.log('[BH]', sel, ': aucun logo');
    var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    console.log('[BH]', sel, '->', el.tagName.toLowerCase(),
      '| classe:', el.className || '(aucune)',
      '| rendu:', Math.round(r.width) + 'x' + Math.round(r.height),
      '| css:', cs.width + ' x ' + cs.height,
      '| object-fit:', cs.objectFit,
      '| fond:', (cs.backgroundImage || '').slice(0, 60));
  });
  console.log('[BH] version bh-layout : verrou-span-v3');
};

function verrouHTML(chemin, largeur, hauteur, texte) {
  // Le chemin est passe EN ENTIER, pas assemble par morceaux : c'est ce qui
  // permet a outils/marque.js d'y accrocher un ?v= calcule sur le contenu du
  // fichier. Sans cela, le navigateur garde le SVG en cache indefiniment et
  // une correction du trace n'arrive jamais chez l'utilisateur.
  return '<span class="bh-verrou" role="img" aria-label="' + texte + '" style="'
    + 'display:inline-block;flex:none;width:' + largeur + 'px;height:' + hauteur + 'px;'
    + 'background:url(' + chemin + ') no-repeat center/contain;'
    + 'border-radius:0;"></span>';
}
const LOGO_SIDEBAR = verrouHTML('/img/brand/verrou/verrou-sidebar.svg?v=f332a05e', 144, 38, 'Boostinghost — Smart Property Manager');
const LOGO_MOBILE  = verrouHTML('/img/brand/verrou/verrou-mobile.svg?v=e25a7b6f',  186, 42, 'Boostinghost — Smart Property Manager');
const LOGO_MONO    = `<img src="/img/brand/web/mono-sidebar.svg?v=43278ecb" alt="Boostinghost" width="34" height="34" style="display:block;flex-shrink:0;">`;

function getSidebarHTML() {
  // ── Détecter le type de compte (nouveau système + ancien système) ──
  const isSubAccountNew = localStorage.getItem('lcc_is_sub_account') === 'true';
  const isSubAccountOld = localStorage.getItem('lcc_account_type') === 'sub';
  const isSubAccount = isSubAccountNew || isSubAccountOld;

  // ── Récupérer le rôle et les permissions ──
  let role = 'custom';
  let permissions = {};

  if (isSubAccount) {
    try {
      // Nouveau système : lcc_sub_account
      const subData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
      if (subData.role) role = subData.role;
      if (subData.permissions) permissions = subData.permissions;
    } catch(e) {}
    try {
      // Ancien système : lcc_permissions
      const permData = localStorage.getItem('lcc_permissions');
      if (permData) {
        const old = JSON.parse(permData);
        permissions = Object.assign(old, permissions); // nouveau système prioritaire
      }
    } catch(e) {}
    try {
      const userData = JSON.parse(localStorage.getItem('lcc_user') || '{}');
      if (userData.role) role = userData.role;
    } catch(e) {}
  }

  // ── Règles d'accès par rôle ──────────────────────────────────────
  // Ménage : calendrier + ménage seulement + 3 KPI
  // Propriétaire : tout sauf Contrats, Pricing, Paramètres
  // Manager/Assistant : tout sauf Revenus
  // Comptable : Factures séjours + Clients + Revenus seulement
  // custom : selon permissions DB

  const ROLE_PAGES = {
    cleaner: ['calendar', 'cleaning'],
    proprietaire: ['dashboard', 'calendar', 'messages', 'settings', 'welcome', 'cleaning', 'deposits', 'factures', 'clients', 'reporting'],
    manager: ['dashboard', 'calendar', 'messages', 'settings', 'welcome', 'contrat', 'cleaning', 'deposits', 'factures', 'clients'],
    comptable: ['factures', 'clients', 'reporting'],
    custom: null // utilise les permissions DB
  };

  const allowedPages = ROLE_PAGES[role] || null;
  const canSeePage = (page) => {
    if (!isSubAccount) return true;
    // Le dashboard est toujours accessible (page d'accueil)
    if (page === 'dashboard') return true;
    if (allowedPages) return allowedPages.includes(page);
    // fallback permissions DB
    const permMap = {
      dashboard: 'can_view_reservations',
      calendar: 'can_view_reservations',
      messages: 'can_view_messages',
      settings: 'can_view_properties',
      welcome: 'can_view_properties',
      contrat: 'can_view_contracts',
      cleaning: 'can_view_cleaning',
      deposits: 'can_view_deposits',
      factures: 'can_view_invoices',
      clients: 'can_view_invoices',
      reporting: 'can_view_reporting',
      pricing: 'can_view_pricing',
      'smart-locks': 'can_view_smart_locks',
    };
    const perm = permMap[page];
    return perm ? permissions[perm] === true : false;
  };

  const hasPermission = (perm) => {
    if (!isSubAccount) return true;
    return permissions[perm] === true;
  };

  return `
<aside class="sidebar">
  <div class="sidebar-header">
    <a class="sidebar-logo" href="/app.html" style="display:flex;align-items:center;gap:11px;padding:22px 18px 18px;text-decoration:none;">
      <img src="/img/brand/web/mono-sidebar.svg?v=43278ecb" alt="Boostinghost"
           style="width:38px;height:38px;min-width:38px;border-radius:9px;flex-shrink:0;object-fit:contain;">
      <div style="display:flex;flex-direction:column;justify-content:center;min-width:0;">
        ${isSubAccount ? `
          <span class="bh-mot" style="font-size:15px;line-height:1.15;color:#20221F;font-weight:600;">Espace</span>
          <span class="bh-baseline">Collaborateur</span>
        ` : `
          <span class="bh-mot">Boostinghost</span>
          <span class="bh-baseline">Smart Property Manager</span>
        `}
      </div>
    </a>
  </div>

  <nav class="sidebar-nav">
    <!-- PRINCIPAL -->
    <div class="nav-section">
      <div class="nav-section-title">Principal</div>
      ${canSeePage('dashboard') ? `
      <a class="nav-item active" data-page="app" href="/app.html">
        <i class="fas fa-th-large"></i><span>Dashboard</span>
      </a>
      ` : ''}
      ${canSeePage('calendar') ? `
      ${canSeePage('reservations') && role !== 'cleaner' ? `
      <a class="nav-item" data-page="reservations" href="/reservations.html" id="navCalendarLink">
        <i class="fas fa-calendar-check"></i><span>Réservations</span>
      </a>` : ''}
      ` : ''}
      ${canSeePage('messages') ? `
      <a class="nav-item" data-page="messages" href="/messages.html">
        <i class="fas fa-comment-dots"></i><span>Messages</span>
      </a>
      ` : ''}
    </div>

    <!-- EXPLOITATION : le quotidien -->
    ${(canSeePage('settings') || canSeePage('cleaning') || canSeePage('contrat')) ? `
    <div class="nav-section">
      <div class="nav-section-title">Exploitation</div>
      ${canSeePage('cleaning') ? `
      <a class="nav-item" data-page="cleaning" href="/cleaning.html">
        <i class="fas fa-broom"></i><span>Gestion du ménage</span>
      </a>
      ` : ''}
      ${canSeePage('settings') ? `
      <a class="nav-item" data-page="settings" href="/settings.html">
        <i class="fas fa-home"></i><span>Mes logements</span>
      </a>
      <a class="nav-item" data-page="welcome" href="/welcome.html">
        <i class="fas fa-book"></i><span>Livrets d'accueil</span>
      </a>
      ` : ''}
      ${canSeePage('contrat') ? `
      <a class="nav-item" data-page="contrat" href="/contrat.html">
        <i class="fas fa-file-contract"></i><span>Contrats</span>
      </a>
      ` : ''}
      ${canSeePage('smart-locks') ? `
      <a class="nav-item" data-page="smart-locks" href="/smart-locks.html">
        <i class="fas fa-lock"></i><span>Serrures connectées</span>
      </a>
      ` : ''}
    </div>
    ` : ''}

    <!-- FINANCES : cautions, factures, clients, revenus, tarification -->
    ${(canSeePage('factures') || canSeePage('reporting') || canSeePage('deposits')) ? `
    <div class="nav-section">
      <div class="nav-section-title">Finances</div>
      ${canSeePage('reporting') ? `
      <a class="nav-item" data-page="reporting" href="/reporting.html">
        <i class="fas fa-chart-line"></i><span>Revenus</span>
      </a>
      ` : ''}
      ${canSeePage('factures') ? `
      <a class="nav-item" data-page="factures" href="/factures.html">
        <i class="fas fa-file-invoice"></i><span>Factures séjours</span>
      </a>
      <a class="nav-item" data-page="clients" href="/clients.html">
        <i class="fas fa-users"></i><span>Mes Clients</span>
      </a>
      ` : ''}
      ${canSeePage('deposits') ? `
      <a class="nav-item" data-page="deposits" href="/deposits.html">
        <i class="fas fa-wallet"></i><span>Cautions</span>
      </a>
      ` : ''}
      ${!isSubAccount ? `
      <a class="nav-item" data-page="pricing" href="/dynamic-pricing.html">
        <i class="fas fa-bolt"></i>
        <span>BoostPrice</span>
        <span class="nav-badge-beta">Bêta</span>
      </a>
      ` : ''}
    </div>
    ` : ''}

    <!-- PIED DE MENU : pas de titre de section, ces deux entrées se suffisent -->
    ${!isSubAccount ? `
    <div class="nav-section nav-section--footer">
      <a class="nav-item" data-page="settings-account" href="/settings-account.html">
        <i class="fas fa-cog"></i><span>Paramètres</span>
      </a>
      <a class="nav-item" data-page="help" href="/help.html">
        <i class="fas fa-headset"></i><span>Support</span>
      </a>
    </div>
    ` : ''}
  </nav>

  <div class="sidebar-footer" style="flex-shrink:0;border-top:1px solid #EAE9E5;padding:12px;background:#F7F7F5;">
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;${isSubAccount ? '' : 'cursor:pointer;'}" ${isSubAccount ? '' : "onclick=\"window.location.href='/settings-account.html'\""} title="${isSubAccount ? '' : 'Paramètres du compte'}">
      <div id="sidebarUserAvatar" style="width:34px;height:34px;min-width:34px;background:linear-gradient(135deg,#0E3B2E,#1E6E52);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div id="sidebarUserName" style="font-size:13px;font-weight:600;color:#0D1117 !important;font-family:DM Sans,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">Utilisateur</div>
        <div id="sidebarUserCompany" style="font-size:11px;color:#5A6A7A;font-family:DM Sans,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${isSubAccount ? 'Sous-compte' : 'Mon espace'}</div>
      </div>
      <button id="logoutBtn" style="background:#FFFFFF;border:1px solid #EAE9E5;color:#5A5A54;border-radius:8px;width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
        <i class="fas fa-sign-out-alt" style="font-size:11px;"></i>
      </button>
    </div>
  </div>
</aside>
`;
}

  // BRAND_TEXT_HTML retire : le mot-symbole fait desormais partie du verrou SVG.


  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  function injectSidebar() {
    const ph = document.getElementById("bhSidebar");
    if (!ph) return;

    ph.innerHTML = getSidebarHTML();

    const page = document.body?.dataset?.page;

    if (page) {
      document.querySelectorAll(".nav-item.active").forEach(a => a.classList.remove("active"));
      const match = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (match) match.classList.add("active");
    }

    const currentPath = (window.location.pathname || "").toLowerCase();
    if (currentPath) {
      const byHref = Array.from(document.querySelectorAll(".nav-item[href]"))
        .find(a => (a.getAttribute("href") || "").toLowerCase() === currentPath);
      if (byHref) {
        document.querySelectorAll(".nav-item.active").forEach(a => a.classList.remove("active"));
        byHref.classList.add("active");
      }
    }

    const sidebar = document.getElementById("sidebar") || document.querySelector("aside.sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const btn = document.getElementById("mobileMenuBtn");

    if (btn && sidebar) {
      btn.addEventListener("click", () => {
        sidebar.classList.toggle("active");
        if (overlay) overlay.classList.toggle("active", sidebar.classList.contains("active"));
      });
    }

    if (overlay && sidebar) {
      overlay.addEventListener("click", () => {
        sidebar.classList.remove("active");
        overlay.classList.remove("active");
      });
    }

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log("🚪 Déconnexion... [BH-VERSION v-LOGOUT-FIX-2]");
        const _keys = ["lcc_token","lcc_user","lcc_account_type","lcc_permissions","lcc_is_sub_account","lcc_sub_account","lcc_faceid_token","lcc_faceid_enabled"];
        _keys.forEach(function(k){ try { localStorage.removeItem(k); } catch(_){} });
        // 📱 Natif (Android/iOS) : vider AUSSI le stockage persistant Capacitor Preferences,
        // sinon login.html restaure le token et reconnecte automatiquement. On attend
        // l'effacement avant de rediriger (sur Android, naviguer trop vite coupe l'écriture).
        try {
          const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
          if (P) { for (const k of _keys) { try { await P.remove({ key: k }); } catch(_){} } }
          // 🤖 ANDROID UNIQUEMENT : drapeau de déconnexion volontaire pour empêcher
          // toute reconnexion auto au retour sur login (anti-course). iOS NON touché.
          const _plat = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform();
          if (_plat === 'android') {
            try { if (P) await P.set({ key: 'lcc_force_logout', value: '1' }); } catch(_){}
            try { localStorage.setItem('lcc_force_logout', '1'); } catch(_){}
          }
        } catch(_){}
        window.location.href = "/login.html";
      });
    }

    const user = JSON.parse(localStorage.getItem('lcc_user') || '{}');
    // Nouveau système sous-compte
    const subAccountData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
    const displayUser = subAccountData.firstName ? subAccountData : user;

    // Toujours appliquer le branding (logo), indépendamment de l'utilisateur
    normalizeBranding();

    if (displayUser.firstName) {
      const nameEl = document.getElementById('sidebarUserName');
      const avatarEl = document.getElementById('sidebarUserAvatar');
      if (nameEl) nameEl.textContent = displayUser.firstName + ' ' + (displayUser.lastName || '');
      if (avatarEl) {
        // Pour les sous-comptes : toujours afficher l'initiale, jamais le logo du parent
        const isSubAcc = localStorage.getItem('lcc_account_type') === 'sub'
                      || localStorage.getItem('lcc_is_sub_account') === 'true';
        const logoUrl = isSubAcc ? null : (user.logoUrl || null);
        if (logoUrl) {
          const logoSrc = logoUrl.includes('cloudinary.com')
            ? logoUrl.replace('/upload/', '/upload/w_80,h_80,c_fit,q_auto,f_png/')
            : logoUrl;
          avatarEl.innerHTML = '';
          avatarEl.textContent = '';
          avatarEl.style.cssText = 'width:34px;height:34px;min-width:34px;border-radius:8px;background:white;border:1px solid rgba(200,184,154,.4);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;color:transparent;font-size:0;';
          avatarEl.style.backgroundImage = `url('${logoSrc}')`;
          avatarEl.style.backgroundSize = '65%';
          avatarEl.style.backgroundRepeat = 'no-repeat';
          avatarEl.style.backgroundPosition = 'center';
        } else {
          // Initiale du sous-compte (ou du user principal)
          const initial = (displayUser.firstName || user.firstName || '?').charAt(0).toUpperCase();
          avatarEl.textContent = initial;
          avatarEl.style.cssText = 'width:34px;height:34px;min-width:34px;border-radius:8px;background:#0E3B2E;color:white;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex-shrink:0;';
        }
      }
    }
    if (user.company) {
      const companyEl = document.getElementById('sidebarUserCompany');
      if (companyEl) companyEl.textContent = user.company;
    }

    document.dispatchEvent(new CustomEvent('sidebarReady'));
    console.log("✅ Sidebar injectée avec filtrage permissions");
  }

  function injectHeader() {
    const host = document.getElementById("bhHeader");
    if (!host) return;

    // Sur desktop (> 1366px sans écran tactile), ne pas injecter le main-header —
    // chaque page gère son propre header statique. Le header injecté n'est utile qu'en mobile.
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (window.innerWidth > 1366 && !isTouch) return;

    const kicker = document.body.getAttribute("data-kicker") || "Gestion";
    const title = document.body.getAttribute("data-title") || document.title || "Page";
    const subtitle = document.body.getAttribute("data-subtitle") || "";
    const backHref = document.body.getAttribute("data-back-href") || "/app.html";
    const backLabel = document.body.getAttribute("data-back-label") || "Retour au dashboard";

    const actionsSrc = document.getElementById("bhHeaderActions");
    const customActions = actionsSrc ? actionsSrc.innerHTML : "";

    host.innerHTML = `
      <header class="main-header">
        <div class="header-left" style="flex:1;min-width:0;overflow:hidden;">
          <div class="page-kicker">${escapeHtml(kicker)}</div>
          <h1 class="page-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        </div>

        <div class="header-actions">
          ${customActions || ""}
          <button class="btn btn-ghost" onclick="window.location.href='${backHref}'">
            <i class="fas fa-arrow-left"></i>
            ${escapeHtml(backLabel)}
          </button>
        </div>
      </header>
    `;
  }

  function normalizeBranding() {
    const mobileLogo = document.querySelector(".mobile-logo");
    if (!mobileLogo) return;

    // S'assurer que .mobile-logo-text existe DANS .mobile-logo
    let mobileLogoText = mobileLogo.querySelector(".mobile-logo-text");
    if (!mobileLogoText) {
      // Chercher hors de mobile-logo (ancienne structure)
      mobileLogoText = document.querySelector(".mobile-logo-text");
    }
    // Créer .mobile-logo-text s'il n'existe nulle part
    if (!mobileLogoText) {
      mobileLogoText = document.createElement('span');
      mobileLogoText.className = 'mobile-logo-text';
      mobileLogo.appendChild(mobileLogoText);
    }

    // Compte delegue : monogramme seul + prenom du collaborateur.
    // Compte principal : verrou complet (le mot-symbole est dans le SVG).
    const isSubAcc = localStorage.getItem('lcc_account_type') === 'sub'
                  || localStorage.getItem('lcc_is_sub_account') === 'true';

    let nomSousCompte = null;
    if (isSubAcc) {
      try {
        const subData = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
        if (subData.firstName) {
          nomSousCompte = subData.firstName + (subData.lastName ? ' ' + subData.lastName : '');
        }
      } catch (e) {}
    }

    const marqueVoulue = nomSousCompte ? LOGO_MONO : LOGO_MOBILE;
    const dejaBon = nomSousCompte
      ? !!mobileLogo.querySelector('img[src="/img/brand/web/mono-sidebar.svg?v=43278ecb"]')
      : !!mobileLogo.querySelector('span.bh-verrou');

    if (!dejaBon) {
      mobileLogo.querySelectorAll('img, svg, span.bh-verrou, i.fas, i.fa').forEach(el => el.remove());
      mobileLogo.insertAdjacentHTML('afterbegin', marqueVoulue);
    }

    // Le texte n'accompagne plus que les comptes delegues : pour le compte
    // principal, le mot-symbole est deja dans le verrou.
    if (nomSousCompte) {
      const attendu = `<span class="mobile-logo-title" style="font-size:15px;font-weight:700;color:#20221F;">${escapeHtml(nomSousCompte)}</span>`
                    + `<span class="mobile-logo-subtitle" style="font-size:8px;color:#8B8B84;font-weight:600;letter-spacing:.08em;text-transform:uppercase;display:block;">Espace collaborateur</span>`;
      if (mobileLogoText.innerHTML.replace(/\s+/g, '') !== attendu.replace(/\s+/g, '')) {
        mobileLogoText.innerHTML = attendu;
      }
    } else if (mobileLogoText.innerHTML !== '') {
      mobileLogoText.innerHTML = '';
    }

    // --- BH FIX HEADER MOBILE ---
    // Les trois zones du header se partageaient la largeur a parts egales
    // (flex:1) sans regarder leur contenu, et le logo etait en position
    // absolute donc hors du flux : sous ~380 px, les boutons s'ecrasaient et
    // le verrou passait par-dessus. Applique en inline : la cascade de
    // bh-brand.css est trop disputee pour qu'un !important suffise.
    const entete = mobileLogo.parentElement;
    // Seuls les headers a trois zones sont concernes (div boutons / logo /
    // div boutons), c.-a-d. app.html. Ailleurs le logo cotoie un bouton en
    // position absolue : l'etirer le ferait passer par-dessus.
    const zonesBoutons = entete ? entete.querySelectorAll(':scope > div') : [];
    if (entete && entete.classList.contains('mobile-header') && zonesBoutons.length >= 2) {
      mobileLogo.style.setProperty('position', 'static', 'important');
      mobileLogo.style.setProperty('transform', 'none', 'important');
      mobileLogo.style.setProperty('flex', '1 1 auto', 'important');
      mobileLogo.style.setProperty('min-width', '0', 'important');
      mobileLogo.style.setProperty('justify-content', 'center', 'important');
      [].forEach.call(entete.children, function (zone) {
        if (zone === mobileLogo || zone.tagName !== 'DIV') return;
        zone.style.setProperty('flex', '0 0 auto', 'important');
        zone.style.setProperty('min-width', '0', 'important');
      });
    }
  }

  function forceUpdateSidebarLogo() {
    const sidebarAnchors = document.querySelectorAll(".sidebar-logo");

    sidebarAnchors.forEach(a => {
      if (a.querySelector("span.bh-verrou")) return;   // deja le bon verrou
      const existing = a.querySelector("img, svg");
      const src = existing ? (existing.getAttribute("src") || "") : "";
      // Un logo est valide s'il vient du dossier de marque, ou s'il s'agit
      // d'un ancien format encore en place sur une page non migree.
      const isOkImg =
        existing &&
        existing.tagName.toLowerCase() === "img" &&
        (src.startsWith("/img/brand/") ||
         src.includes("boostinghost-icon-circle.png") ||
         src.startsWith("data:image"));

      if (!isOkImg) {
        const old = a.querySelector("svg, img");
        if (old) old.remove();
        a.insertAdjacentHTML("afterbegin", LOGO_SIDEBAR);
      }
    });
  }


  function injectMobileTitle() {
    // Considérer iPad et tablettes tactiles comme mobile (pointer:coarse = écran tactile)
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (window.innerWidth > 1400 && !isTouch) return;
    if (document.getElementById('bh-mobile-page-title')) return;

    // Si la page a déjà un .mobile-header natif actif (avec contenu et non caché),
    // on ne crée pas de doublon — on le laisse gérer son propre affichage.
    const existingNative = document.querySelector('.mobile-header');
    if (existingNative && existingNative.innerHTML.trim().length > 0 && existingNative.style.display !== 'none') return;

    // Trouver ou créer la mobile-header.
    // Chercher d'abord le placeholder #bhMobileHeader (div vide sans classe .mobile-header)
    // Ignorer les .mobile-header avec display:none inline (anciens headers désactivés)
    const existingVisible = document.querySelector('.mobile-header:not([style*="display:none"])') || document.getElementById('bhMobileHeader');
    let mobileHeader = existingVisible;
    if (!mobileHeader) {
      // Créer une mobile-header avec logo si elle n'existe pas
      mobileHeader = document.createElement('div');
      const appContainer = document.querySelector('.app-container') || document.querySelector('.main-content') || document.body;
      appContainer.parentNode.insertBefore(mobileHeader, appContainer);
    }
    // S'assurer que le div a bien la classe, l'id et le logo corrects
    if (!mobileHeader.classList.contains('mobile-header')) mobileHeader.classList.add('mobile-header');
    if (!mobileHeader.id) mobileHeader.id = 'bhMobileHeader';
    if (!mobileHeader.querySelector('.mobile-logo')) {
      mobileHeader.innerHTML = '<a class="mobile-logo" href="/app.html" style="min-width:0;display:flex;align-items:center;gap:6px;text-decoration:none;overflow:visible;"><span class="mobile-logo-text"></span></a>';
    }

    // Style : logo centré, rien d'autre (comme messages.html)
    mobileHeader.style.setProperty('display', 'flex', 'important');
    mobileHeader.style.setProperty('position', 'fixed', 'important');
    mobileHeader.style.setProperty('top', '0', 'important');
    mobileHeader.style.setProperty('left', '0', 'important');
    mobileHeader.style.setProperty('right', '0', 'important');
    mobileHeader.style.setProperty('height', 'calc(60px + env(safe-area-inset-top,0px))', 'important');
    mobileHeader.style.setProperty('z-index', '1100', 'important');
    mobileHeader.style.setProperty('align-items', 'center', 'important');
    mobileHeader.style.setProperty('justify-content', 'center', 'important');
    mobileHeader.style.setProperty('padding', 'env(safe-area-inset-top,0px) 10px 0', 'important');
    mobileHeader.style.setProperty('background', 'rgba(245,242,236,0.97)', 'important');
    mobileHeader.style.setProperty('backdrop-filter', 'blur(12px)', 'important');
    mobileHeader.style.setProperty('border-bottom', '1px solid rgba(200,184,154,0.4)', 'important');
    mobileHeader.style.setProperty('box-shadow', '0 1px 8px rgba(13,17,23,0.06)', 'important');

    // Marquer comme traité
    const sentinel = document.createElement('span');
    sentinel.id = 'bh-mobile-page-title';
    sentinel.style.display = 'none';
    mobileHeader.appendChild(sentinel);

    normalizeBranding();
    setTimeout(function(){ normalizeBranding(); forceUpdateSidebarLogo(); }, 100);
    setTimeout(function(){ normalizeBranding(); }, 400);

  }


  // ============================================================
  // DESKTOP LAYOUT — réservé pour futurs ajustements globaux
  // ============================================================
  function applyDesktopLayout() {
    if (document.getElementById('bh-layout-fixes')) return;
    const style = document.createElement('style');
    style.id = 'bh-layout-fixes';
    style.textContent = `
      @media (min-width: 1367px) {
        html[data-theme-v3="1"] .mobile-header { display: none !important; }
        html[data-theme-v3="1"] #bhHeader { display: none !important; }
        html[data-theme-v3="1"] .main-header { display: flex; align-items: center; justify-content: space-between; }
        html[data-theme-v3="1"] .main-header .header-left { flex: 1; min-width: 0; overflow: hidden; }
        html[data-theme-v3="1"] .main-header .header-left .page-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      }
    `;
    document.head.appendChild(style);
  }


  function injectTopBar() {
    if (document.getElementById('bhTopBar')) return;

    var topBar = document.createElement('div');
    topBar.className = 'bh-demo-nav';
    topBar.id = 'bhTopBar';
    topBar.innerHTML = [
      '<button id="agencySwitcherBtn" onclick="window.openAgencySwitcherModal && window.openAgencySwitcherModal()" style="display:none;position:absolute;left:12px;top:50%;transform:translateY(-50%);background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:8px;padding:4px 12px;cursor:pointer;font-family:\'DM Sans\',sans-serif;font-size:11px;font-weight:600;color:#C4B5FD;gap:6px;align-items:center;transition:all .25s cubic-bezier(.4,0,.2,1);white-space:nowrap;" onmouseover="this.style.background=\'rgba(124,58,237,.25)\';this.style.borderColor=\'rgba(124,58,237,.5)\';this.style.color=\'#DDD6FE\'" onmouseout="this.style.background=\'rgba(124,58,237,.15)\';this.style.borderColor=\'rgba(124,58,237,.3)\';this.style.color=\'#C4B5FD\'">',
      '  <i class="fas fa-building" style="font-size:10px;"></i>',
      '  <span id="agencySwitcherLabel">Agence</span>',
      '  <i class="fas fa-chevron-down" style="font-size:8px;opacity:.6;margin-left:1px;"></i>',
      '</button>',
      '<div style="position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;white-space:nowrap;">',
      '  <div style="display:flex;align-items:center;gap:7px;">',
      '    <i class="fas fa-server" style="font-size:11px;color:rgba(255,255,255,.5);"></i>',
      '    <span id="svc-name-render" style="color:rgba(255,255,255,.6);font-size:11px;font-weight:500;">Fonctionnement du site</span>',
      '    <span id="svc-status-render" title="Fonctionnement du site" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(107,114,128,.2);color:#9CA3AF;border:1px solid rgba(107,114,128,.3);">',
      '      <span id="svc-dot-render" style="width:6px;height:6px;border-radius:50%;background:#6B7280;display:inline-block;"></span>',
      '      <span id="svc-label-render">Verification...</span>',
      '    </span>',
      '    <span id="svc-ago-render" style="font-size:9px;color:rgba(255,255,255,.3);"></span>',
      '  </div>',
      '  <div style="width:1px;height:14px;background:rgba(255,255,255,.15);"></div>',
      '  <div style="display:flex;align-items:center;gap:7px;">',
      '    <i class="fas fa-plug" style="font-size:11px;color:rgba(255,255,255,.5);"></i>',
      '    <span id="svc-name-channex" style="color:rgba(255,255,255,.6);font-size:11px;font-weight:500;">Connexion API</span>',
      '    <span id="svc-status-channex" title="Connexion API" style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(107,114,128,.2);color:#9CA3AF;border:1px solid rgba(107,114,128,.3);">',
      '      <span id="svc-dot-channex" style="width:6px;height:6px;border-radius:50%;background:#6B7280;display:inline-block;"></span>',
      '      <span id="svc-label-channex">Verification...</span>',
      '    </span>',
      '    <span id="svc-ago-channex" style="font-size:9px;color:rgba(255,255,255,.3);"></span>',
      '  </div>',
      '</div>',
      '<div class="bh-demo-right">',
      '  <button id="bhAnnouncementsBtn" onclick="window.bhToggleAnnouncements && window.bhToggleAnnouncements()" style="position:relative;background:none;border:none;cursor:pointer;padding:4px 8px;display:flex;align-items:center;gap:5px;color:rgba(255,255,255,.7);font-size:11px;font-weight:500;border-radius:6px;transition:background .15s;" onmouseover="this.style.background=\'rgba(255,255,255,.08)\'" onmouseout="this.style.background=\'none\'"><i class="fas fa-info-circle" style="font-size:12px;"></i><span>Informations</span><span id="bhAnnBadge" style="display:none;position:absolute;top:-2px;right:-2px;background:#EF4444;color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:999px;min-width:14px;text-align:center;line-height:1.4;"></span></button>',
      '  <div style="width:1px;height:14px;background:rgba(255,255,255,.15);margin:0 4px;"></div>',
      '  <span class="bh-demo-mode-label">Mode</span>',
      '  <button class="bh-theme-toggle" id="bhThemeToggleDark" onclick="document.documentElement.getAttribute(\'data-theme\')==\'dark\'?document.documentElement.setAttribute(\'data-theme\',\'light\'):document.documentElement.setAttribute(\'data-theme\',\'dark\')"></button>',
      '</div>'
    ].join('');

    var appContainer = document.querySelector('.app-container');
    if (appContainer) {
      document.body.insertBefore(topBar, appContainer);
    } else {
      document.body.insertBefore(topBar, document.body.firstChild);
    }

    var API_BASE = 'https://lcc-booking-manager.onrender.com';
    var SERVICES = [
      { id: 'render',  url: API_BASE + '/api/service-status/render' },
      { id: 'channex', url: API_BASE + '/api/service-status/channex' }
    ];
    var COLORS = {
      ok:      { bg: 'rgba(34,197,94,.18)',  dot: '#4ADE80', text: '#4ADE80', border: 'rgba(34,197,94,.35)'  },
      warn:    { bg: 'rgba(251,146,60,.18)', dot: '#FB923C', text: '#FB923C', border: 'rgba(251,146,60,.35)' },
      error:   { bg: 'rgba(239,68,68,.18)',  dot: '#F87171', text: '#F87171', border: 'rgba(239,68,68,.35)'  },
      unknown: { bg: 'rgba(107,114,128,.2)', dot: '#9CA3AF', text: '#9CA3AF', border: 'rgba(107,114,128,.3)' }
    };
    var lastCheck = {};

    function timeAgo(ts) {
      var s = Math.floor((Date.now() - ts) / 1000);
      if (s < 10) return "a l'instant";
      if (s < 60) return 'il y a ' + s + 's';
      var m = Math.floor(s / 60);
      if (m < 60) return 'il y a ' + m + 'min';
      return 'il y a ' + Math.floor(m / 60) + 'h';
    }

    function applyStatus(id, level, label) {
      var c = COLORS[level] || COLORS.unknown;
      var badge = document.getElementById('svc-status-' + id);
      var dot   = document.getElementById('svc-dot-'    + id);
      var lbl   = document.getElementById('svc-label-'  + id);
      var name  = document.getElementById('svc-name-'   + id);
      var ago   = document.getElementById('svc-ago-'    + id);
      var compact = (level === 'ok'); // tout va bien → on s'efface
      if (badge) {
        badge.style.background  = compact ? 'transparent' : c.bg;
        badge.style.color       = c.text;
        badge.style.borderColor = compact ? 'transparent' : c.border;
        badge.style.padding     = compact ? '2px' : '2px 8px';
        if (badge.title) badge.title = badge.title.split(' — ')[0] + ' — ' + label;
      }
      if (dot) dot.style.background = c.dot;
      if (lbl) { lbl.textContent = label; lbl.style.display = compact ? 'none' : ''; }
      if (name) name.style.display = compact ? 'none' : '';
      if (ago)  ago.style.display  = compact ? 'none' : '';
      // Sync pastille mobile
      var mdot = document.getElementById('msvc-dot-' + id);
      if (mdot) mdot.style.background = c.dot;
      lastCheck[id] = Date.now();
    }

    function parseLevel(data) {
      var ind = (data.status && data.status.indicator) || 'none';
      if (ind === 'none')  return { level: 'ok',    label: 'Operationnel' };
      if (ind === 'minor') return { level: 'warn',  label: 'Degrade' };
      return                      { level: 'error', label: 'Incident' };
    }

    function checkService(svc) {
      fetch(svc.url, { cache: 'no-store' })
        .then(function(r) { return r.json(); })
        .then(function(data) { var r = parseLevel(data); applyStatus(svc.id, r.level, r.label); })
        .catch(function() { applyStatus(svc.id, 'error', 'Injoignable'); });
    }

    function checkAll() { SERVICES.forEach(checkService); }

    function updateAgo() {
      SERVICES.forEach(function(svc) {
        var el = document.getElementById('svc-ago-' + svc.id);
        if (el && lastCheck[svc.id]) el.textContent = timeAgo(lastCheck[svc.id]);
      });
    }

    checkAll();
    setInterval(checkAll,  5 * 60 * 1000);
    setInterval(updateAgo, 30 * 1000);
    window.updateTopBarStatus = checkAll;
  }


  function init() {
    console.log("🚀 bh-layout.js - Initialisation avec filtrage permissions...");
    
    injectTopBar();
    injectSidebar();
    injectHeader();
    normalizeBranding();
    injectMobileTitle();
    applyDesktopLayout();

    setTimeout(() => {
      normalizeBranding();
      forceUpdateSidebarLogo();
      injectMobileTitle();
      applyDesktopLayout();
    }, 150);

    setTimeout(() => {
      forceUpdateSidebarLogo();
      normalizeBranding();
      applyDesktopLayout();
    }, 500);

    // Réappliquer au resize (changement orientation / fenêtre)
    let _resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(applyDesktopLayout, 100);
    });
    
    console.log("✅ bh-layout.js - Prêt avec filtrage permissions");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.bhLayout = {
    normalizeBranding,
    injectSidebar,
    injectHeader,
    forceUpdateSidebarLogo,
    applyDesktopLayout
  };


  // ── Annonces / Changelog ────────────────────────────────────────
  var BH_API = 'https://lcc-booking-manager.onrender.com';
  var bhAnnPopup = null;

  function bhCreatePopup() {
    if (document.getElementById('bhAnnPopup')) return;
    var popup = document.createElement('div');
    popup.id = 'bhAnnPopup';
    var isMob = window.innerWidth <= 768; popup.style.cssText = 'position:fixed;top:' + (isMob ? 'calc(60px + env(safe-area-inset-top,0px))' : '48px') + ';right:' + (isMob ? '8px' : '16px') + ';width:' + (isMob ? 'calc(100vw - 16px)' : '360px') + ';max-height:480px;background:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,.2);z-index:99999;display:none;flex-direction:column;overflow:hidden;border:1px solid rgba(255,255,255,.5);';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:16px 18px;background:linear-gradient(135deg,#0E3B2E 0%,#0A2C22 100%);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;';
    var ttl = document.createElement('div');
    ttl.style.cssText = 'font-size:15px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;';
    ttl.innerHTML = '<i class="fas fa-info-circle" style="font-size:14px;opacity:.85;"></i> Informations';
    var cls = document.createElement('button');
    cls.style.cssText = 'background:rgba(255,255,255,.18);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);cursor:pointer;font-size:15px;color:#fff;line-height:1;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;transition:transform .18s cubic-bezier(.34,1.4,.5,1),background .2s;';
    cls.textContent = '×';
    cls.onmouseover = function(){ this.style.background = 'rgba(255,255,255,.3)'; };
    cls.onmouseout = function(){ this.style.background = 'rgba(255,255,255,.18)'; };
    cls.onclick = function() { window.bhCloseAnnouncements(); };
    hdr.appendChild(ttl);
    hdr.appendChild(cls);
    var lst = document.createElement('div');
    lst.id = 'bhAnnList';
    lst.style.cssText = 'overflow-y:auto;flex:1;padding:12px 14px;display:flex;flex-direction:column;gap:10px;';
    lst.innerHTML = '<div class="bh-skel bh-skel-card"></div><div class="bh-skel bh-skel-card"></div>';
    popup.appendChild(hdr);
    popup.appendChild(lst);
    document.body.appendChild(popup);
  }

  function bhRenderAnnouncements(list) {
    var container = document.getElementById('bhAnnList');
    if (!container) return;
    var TYPE_CONFIG = {
      feature:     { emoji: '🚀', label: 'Nouveauté',    bg: '#EFF6FF', color: '#1D4ED8' },
      bugfix:      { emoji: '🐛', label: 'Correction',   bg: '#F1F6F3', color: '#0A2C22' },
      maintenance: { emoji: '⚠️', label: 'Maintenance',  bg: '#FFFBEB', color: '#B45309' },
      info:        { emoji: '📢', label: 'Information',  bg: '#F5F3FF', color: '#6D28D9' }
    };
    var STATUS_CONFIG = {
      en_cours: { emoji: '🔄', label: 'En cours', bg: '#EFF6FF', color: '#1D4ED8' },
      resolu:   { emoji: '✅', label: 'Résolu',   bg: '#F1F6F3', color: '#0A2C22' },
      termine:  { emoji: '✔️', label: 'Terminé', bg: '#F3F4F6', color: '#6B7280' }
    };
    if (!list.length) {
      container.innerHTML = (window.bhEmptyState ? window.bhEmptyState('inbox', 'Aucune annonce', 'Les nouveautés et informations apparaîtront ici.') : '<div style="text-align:center;padding:24px;color:#9CA3AF;font-size:13px;">Aucune annonce pour l\u0027instant.</div>');
      return;
    }
    container.innerHTML = list.map(function(a) {
      var cfg = TYPE_CONFIG[a.type] || TYPE_CONFIG.info;
      var scfg = a.status ? (STATUS_CONFIG[a.status] || STATUS_CONFIG.en_cours) : null;
      var date = new Date(a.created_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' });
      return '<div style="background:#FAFAF8;border:1px solid rgba(0,0,0,.07);border-radius:10px;padding:12px 14px;">'
        + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">'
        + '  <span style="background:' + cfg.bg + ';color:' + cfg.color + ';font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">' + cfg.emoji + ' ' + cfg.label + '</span>'
        + (scfg ? '  <span style="background:' + scfg.bg + ';color:' + scfg.color + ';font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">' + scfg.emoji + ' ' + scfg.label + '</span>' : '')
        + '  <span style="font-size:11px;color:#9CA3AF;margin-left:auto;">' + date + '</span>'
        + '</div>'
        + '<div style="font-size:13px;font-weight:700;color:#0D1117;margin-bottom:4px;font-family:sans-serif;">' + a.title + '</div>'
        + '<div style="font-size:12px;color:#6B7280;line-height:1.5;white-space:pre-line;">' + a.body + '</div>'
        + '</div>';
    }).join('');
  }

  async function bhLoadAnnouncements() {
    try {
      var token = localStorage.getItem('lcc_token');
      // Utiliser XMLHttpRequest pour éviter l'interception de auth-fetch.js
      var data = await new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', BH_API + '/api/announcements');
        xhr.setRequestHeader('Authorization', 'Bearer ' + (token || ''));
        xhr.onload = function() {
          try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({}); }
        };
        xhr.onerror = function() { reject(new Error('XHR error')); };
        xhr.send();
      });
      var list = data.announcements || [];

      // Badge non lus
      var lastSeen = parseInt(localStorage.getItem('bh_ann_last_seen') || '0');
      var unread = list.filter(function(a) { return new Date(a.created_at).getTime() > lastSeen; }).length;
      // Badge desktop
      var badge = document.getElementById('bhAnnBadge');
      if (badge) {
        badge.style.display = unread > 0 ? 'block' : 'none';
        badge.textContent = unread > 0 ? unread : '';
      }
      // Badge mobile
      var badgeMobile = document.getElementById('bhAnnBadgeMobile');
      if (badgeMobile) {
        badgeMobile.style.display = unread > 0 ? 'block' : 'none';
        badgeMobile.textContent = unread > 0 ? unread : '';
      }

      bhRenderAnnouncements(list);
    } catch(e) {
      var container = document.getElementById('bhAnnList');
      if (container) container.innerHTML = '<div style="text-align:center;padding:24px;color:#9CA3AF;font-size:13px;">Erreur de chargement.</div>';
    }
  }

  window.bhToggleAnnouncements = function() {
    bhCreatePopup();
    var popup = document.getElementById('bhAnnPopup');
    if (!popup) return;
    var isOpen = popup.style.display === 'flex';
    if (isOpen) {
      popup.style.display = 'none';
    } else {
      popup.style.display = 'flex';
      popup.style.animation = 'bhSheetIn .3s cubic-bezier(.22,1.1,.36,1)';
      // Marquer comme lus
      localStorage.setItem('bh_ann_last_seen', Date.now().toString());
      var badge = document.getElementById('bhAnnBadge');
      if (badge) badge.style.display = 'none';
      bhLoadAnnouncements();
    }
  };

  window.bhCloseAnnouncements = function() {
    var popup = document.getElementById('bhAnnPopup');
    if (popup) popup.style.display = 'none';
  };

  // Fermer en cliquant dehors
  document.addEventListener('click', function(e) {
    var popup = document.getElementById('bhAnnPopup');
    var btn = document.getElementById('bhAnnouncementsBtn');
    if (popup && popup.style.display === 'flex' && !popup.contains(e.target) && btn && !btn.contains(e.target)) {
      popup.style.display = 'none';
    }
  });

  // Charger le badge au démarrage
  setTimeout(function() {
    bhCreatePopup();
    bhLoadAnnouncements();
  }, 1500);

})();
// ============================================================
// Remplacer tous les alert() natifs par showToast
// ============================================================
window.alert = (msg) => window.showToast ? showToast(String(msg)) : console.warn('[alert]', msg);

// ============================================================
// showToast — notification toast globale Boostinghost
// Usage :
//   showToast('Facture envoyée avec succès')
//   showToast('Erreur lors de l\'envoi', 'error')
//   showToast('Brouillon sauvegardé', 'info')
// ============================================================
window.showToast = function(message, type = 'success', duration = 4000) {
  // Supprimer un toast existant
  const existing = document.getElementById('bh-toast');
  if (existing) existing.remove();

  const colors = {
    success: { accent: '#0E3B2E', icon: 'fa-check', pill: 'rgba(14,59,46,.14)' },
    error:   { accent: '#dc2626', icon: 'fa-xmark', pill: 'rgba(220,38,38,.12)' },
    info:    { accent: '#2563eb', icon: 'fa-info',  pill: 'rgba(37,99,235,.12)' },
    warning: { accent: '#d97706', icon: 'fa-exclamation', pill: 'rgba(217,119,6,.14)' }
  };
  const { accent, icon, pill } = colors[type] || colors.success;
  const isMobile = window.innerWidth <= 768;

  const toast = document.createElement('div');
  toast.id = 'bh-toast';
  toast.style.cssText = `
    position: fixed;
    ${isMobile ? 'top: calc(env(safe-area-inset-top,0px) + 12px); left: 12px; right: 12px;' : 'bottom: 24px; right: 24px; max-width: 360px;'}
    background: rgba(255,255,255,.82);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255,255,255,.5);
    border-left: 3px solid ${accent};
    color: #0D1117;
    padding: 13px 16px;
    border-radius: 14px;
    font-size: 13.5px;
    font-weight: 500;
    font-family: "DM Sans", system-ui, sans-serif;
    box-shadow: 0 8px 32px rgba(13,17,23,.16);
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 11px;
    animation: bhToastIn .3s cubic-bezier(.22,1.1,.36,1);
  `;
  toast.innerHTML = `<span style="width:26px;height:26px;border-radius:50%;background:${pill};display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="fas ${icon}" style="font-size:12px;color:${accent};"></i></span><span style="flex:1;line-height:1.35;">${message}</span>`;

  // Inject keyframes once
  if (!document.getElementById('bh-toast-style')) {
    const style = document.createElement('style');
    style.id = 'bh-toast-style';
    style.textContent = `
      @keyframes bhToastIn  { from { opacity:0; transform:translateY(-14px); } to { opacity:1; transform:translateY(0); } }
      @keyframes bhToastOut { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(-14px); } }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'bhToastOut .25s ease forwards';
    setTimeout(() => toast.remove(), 260);
  }, duration);
};

// ============================================================
// bhConfirm — Modale de confirmation custom (remplace confirm())
// Usage :
//   const ok = await bhConfirm('Supprimer cet élément ?')
//   const ok = await bhConfirm('Titre', 'Message détaillé', 'Confirmer', 'Annuler', 'danger')
// ============================================================
window.bhConfirm = function(title, message, confirmLabel, cancelLabel, variant) {
  message = message || '';
  confirmLabel = confirmLabel || 'Confirmer';
  cancelLabel = cancelLabel || 'Annuler';
  variant = variant || 'default';

  return new Promise(function(resolve) {
    var existing = document.getElementById('bh-confirm-overlay');
    if (existing) existing.remove();

    var confirmColor = variant === 'danger' ? '#dc2626' : '#0E3B2E';
    var confirmHover = variant === 'danger' ? '#b91c1c' : '#155f49';
    var iconHtml = variant === 'danger'
      ? '<div style="width:44px;height:44px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;"><i class="fas fa-exclamation-triangle" style="color:#dc2626;font-size:18px;"></i></div>'
      : '<div style="width:44px;height:44px;background:#e8f5f1;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;"><i class="fas fa-question-circle" style="color:#0E3B2E;font-size:18px;"></i></div>';

    if (!document.getElementById('bh-confirm-style')) {
      var s = document.createElement('style');
      s.id = 'bh-confirm-style';
      s.textContent = [
        '#bh-confirm-overlay{position:fixed;inset:0;z-index:999999;background:rgba(13,17,23,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:bhCfIn .15s ease;}',
        '@keyframes bhCfIn{from{opacity:0}to{opacity:1}}',
        '@keyframes bhCfSlide{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}',
        '#bh-confirm-box{background:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border:1px solid rgba(255,255,255,.5);border-radius:22px;padding:28px 24px 24px;max-width:360px;width:100%;box-shadow:0 24px 64px rgba(13,17,23,.24);text-align:center;animation:bhCfSlide .18s cubic-bezier(0.175,0.885,0.32,1.275);}',
        '#bh-confirm-title{font-family:"Instrument Serif",Georgia,serif;font-size:20px;font-weight:400;color:#0D1117;margin-bottom:8px;line-height:1.3;}',
        '#bh-confirm-message{font-family:"DM Sans",sans-serif;font-size:14px;color:#6b7280;line-height:1.6;margin-bottom:24px;}',
        '#bh-confirm-actions{display:flex;gap:10px;}',
        '.bh-confirm-btn{flex:1;height:42px;border-radius:12px;font-family:"DM Sans",sans-serif;font-size:14px;font-weight:600;cursor:pointer;border:none;transition:background .15s,transform .1s;}',
        '.bh-confirm-btn:active{transform:scale(.98);}',
        '#bh-confirm-cancel{background:#F5F2EC;color:#374151;border:1px solid rgba(200,184,154,.5)!important;}',
        '#bh-confirm-cancel:hover{background:#EDE8DF;}'
      ].join('');
      document.head.appendChild(s);
    }

    var overlay = document.createElement('div');
    overlay.id = 'bh-confirm-overlay';
    overlay.innerHTML = '<div id="bh-confirm-box">' + iconHtml +
      '<div id="bh-confirm-title">' + title + '</div>' +
      (message ? '<div id="bh-confirm-message">' + message + '</div>' : '') +
      '<div id="bh-confirm-actions">' +
        '<button class="bh-confirm-btn" id="bh-confirm-cancel">' + cancelLabel + '</button>' +
        '<button class="bh-confirm-btn" id="bh-confirm-ok" style="background:' + confirmColor + ';color:white;">' + confirmLabel + '</button>' +
      '</div></div>';

    document.body.appendChild(overlay);

    var okBtn = document.getElementById('bh-confirm-ok');
    var cancelBtn = document.getElementById('bh-confirm-cancel');

    okBtn.onmouseover = function() { okBtn.style.background = confirmHover; };
    okBtn.onmouseout  = function() { okBtn.style.background = confirmColor; };

    function close(result) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity .15s';
      setTimeout(function() { if (overlay.parentNode) overlay.remove(); }, 150);
      resolve(result);
    }

    okBtn.onclick    = function() { close(true); };
    cancelBtn.onclick = function() { close(false); };
    overlay.onclick  = function(e) { if (e.target === overlay) close(false); };

    function onKey(e) { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); } }
    document.addEventListener('keydown', onKey);
    setTimeout(function() { if (okBtn) okBtn.focus(); }, 50);
  });
};
// Référence stable du bhConfirm global, pour les pages qui surchargent window.bhConfirm
// avec une signature différente mais veulent quand même router vers la modale unifiée.
window.__bhLayoutConfirm = window.bhConfirm;

// window.confirm : on NE patche PAS le confirm natif.
// Raison : confirm() est synchrone et bloquant ; le remplacer par bhConfirm
// (asynchrone) en retournant toujours true ferait exécuter les actions
// (suppressions, etc.) SANS attendre la réponse de l'utilisateur — dangereux.
// Pour une jolie modale, utiliser directement « await bhConfirm(...) » dans le code.
// Les confirm() natifs restants restent fonctionnels (bloquants, sûrs).
var _bhNativeConfirm = window.confirm;

// ── Agency Switcher Modal (bh-layout.js) ─────────────────────
(function() {
  // Inject modal HTML
  function injectAgencyModal() {
    if (document.getElementById('agencySwitcherModal')) return;
    var modal = document.createElement('div');
    modal.id = 'agencySwitcherModal';
    modal.onclick = function(e) { if (e.target === modal) window.closeAgencySwitcherModal(); };
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;align-items:center;justify-content:center;opacity:0;transition:opacity .2s ease;';
    modal.innerHTML = '<div style="background:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border-radius:22px;width:90%;max-width:400px;padding:0;box-shadow:0 24px 64px rgba(13,17,23,.28);max-height:80vh;overflow:hidden;display:flex;flex-direction:column;transform:scale(.95) translateY(8px);transition:transform .25s cubic-bezier(.4,0,.2,1);border:1px solid rgba(255,255,255,.5);" id="agencySwitcherInner">'
      + '<div style="padding:18px 20px;background:linear-gradient(135deg,#7c3aed 0%,#5b21b6 100%);">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;">'
      + '<div style="font-size:15px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px;"><i class="fas fa-building" style="color:rgba(255,255,255,.85);font-size:14px;"></i>Changer de compte</div>'
      + '<button onclick="closeAgencySwitcherModal()" style="background:rgba(255,255,255,.18);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.25);cursor:pointer;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;transition:transform .18s cubic-bezier(.34,1.4,.5,1),background .2s;" onmouseover="this.style.background=\'rgba(255,255,255,.3)\'" onmouseout="this.style.background=\'rgba(255,255,255,.18)\'"><i class="fas fa-times" style="color:#fff;font-size:14px;"></i></button>'
      + '</div>'
      + '</div>'
      + '<div id="agencySwitcherList" style="overflow-y:auto;padding:8px;"></div>'
      + '</div>';
    document.body.appendChild(modal);
  }

  window.openAgencySwitcherModal = function() {
    injectAgencyModal();
    var modal = document.getElementById('agencySwitcherModal');
    if (!modal) return;
    var accounts = window._agencyAccounts || [];
    var managedUser = localStorage.getItem('lcc_managed_user');
    var currentManagedId = managedUser ? JSON.parse(managedUser).id : null;
    var isOwnAccount = !currentManagedId && !window._agencyViewActive;

    var html = '';
    // Mon compte
    html += agencyAccountBtn('exitAgencyModeFromModal()', '#0E3B2E', '<i class="fas fa-user" style="color:white;font-size:12px;"></i>', 'Mon compte', 'Votre espace personnel', isOwnAccount, '#0E3B2E');
    // Tous les comptes  
    html += agencyAccountBtn('setAgencyViewFromModal()', '#7c3aed', '<i class="fas fa-layer-group" style="color:white;font-size:12px;"></i>', 'Tous les comptes', 'Vue globale agence', window._agencyViewActive, '#7c3aed');
    // Separator
    html += '<div style="border-top:1px solid rgba(200,184,154,.15);margin:2px 4px;"></div>';
    // Individual accounts
    accounts.forEach(function(a) {
      var uid = (a.userId || '').replace(/'/g, "\\'");
      var nm = (a.name || a.email || '').replace(/'/g, "\\'");
      var clr = a.color || '#6B7280';
      var isActive = currentManagedId === (a.userId || '');
      var initial = (a.name || a.email || '?').charAt(0).toUpperCase();
      html += agencyAccountBtn("switchAgencyAccountFromModal('" + uid + "','" + nm + "','" + clr + "')", clr, '<span style="font-size:11px;font-weight:700;color:white;">' + initial + '</span>', a.name || a.email, '', isActive, '#0E3B2E');
    });

    document.getElementById('agencySwitcherList').innerHTML = html;
    modal.style.display = 'flex';
    requestAnimationFrame(function() {
      modal.style.opacity = '1';
      document.getElementById('agencySwitcherInner').style.transform = 'scale(1) translateY(0)';
    });
  };

  function agencyAccountBtn(onclick, avatarBg, avatarContent, title, subtitle, isActive, checkColor) {
    return '<button onclick="' + onclick + '" style="display:flex;align-items:center;gap:11px;width:100%;padding:11px 12px;border-radius:13px;border:none;background:' + (isActive ? 'rgba(14,59,46,.08)' : 'transparent') + ';cursor:pointer;text-align:left;transition:all .15s;margin-bottom:2px;" onmouseover="this.style.background=\'' + (isActive ? 'rgba(14,59,46,.08)' : 'rgba(0,0,0,.035)') + '\'" onmouseout="this.style.background=\'' + (isActive ? 'rgba(14,59,46,.08)' : 'transparent') + '\'">'
      + '<span style="width:34px;height:34px;border-radius:50%;background:' + avatarBg + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px ' + avatarBg + '40;">' + avatarContent + '</span>'
      + '<div style="flex:1;min-width:0;"><div style="font-size:13.5px;font-weight:600;color:#1F2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + title + '</div>' + (subtitle ? '<div style="font-size:11px;color:#9CA3AF;margin-top:1px;">' + subtitle + '</div>' : '') + '</div>'
      + (isActive ? '<i class="fas fa-check-circle" style="color:' + (checkColor || '#0E3B2E') + ';font-size:16px;flex-shrink:0;"></i>' : '')
      + '</button>';
  }

  window.closeAgencySwitcherModal = function() {
    var modal = document.getElementById('agencySwitcherModal');
    var inner = document.getElementById('agencySwitcherInner');
    if (!modal) return;
    modal.style.opacity = '0';
    if (inner) inner.style.transform = 'scale(.95) translateY(8px)';
    setTimeout(function() { modal.style.display = 'none'; }, 200);
  };

  window.exitAgencyModeFromModal = function() {
    closeAgencySwitcherModal();
    if (localStorage.getItem('lcc_managed_user')) {
      if (typeof exitAgencyMode === 'function') exitAgencyMode();
    } else if (window._agencyViewActive) {
      if (typeof setAgencyView === 'function') setAgencyView('mine');
      updateAgencySwitcherLabel();
    }
  };

  window.setAgencyViewFromModal = function() {
    closeAgencySwitcherModal();
    if (typeof setAgencyView === 'function') setAgencyView('all');
    updateAgencySwitcherLabel();
  };

  window.switchAgencyAccountFromModal = function(uid, name, color) {
    closeAgencySwitcherModal();
    if (typeof switchAgencyAccount === 'function') switchAgencyAccount(uid, name, color);
  };

  window.updateAgencySwitcherLabel = function() {
    var label = document.getElementById('agencySwitcherLabel');
    var labelMobile = document.getElementById('agencySwitcherLabelMobile');
    var text = 'Agence';
    var managed = localStorage.getItem('lcc_managed_user');
    if (managed) {
      try {
        var u = JSON.parse(managed);
        text = u.name || u.email || 'Compte géré';
      } catch(e) {}
    } else if (window._agencyViewActive) {
      text = 'Tous les comptes';
    }
    if (label) label.textContent = text;
    if (labelMobile) labelMobile.textContent = text;
  };

  // Auto-show button if agency accounts exist or user is in managed mode
  // ── Helper : détecter la page courante pour masquer le bouton agence ──
  function isAgencyBtnHiddenPage() {
    var path = window.location.pathname || '';
    return path.indexOf('settings-account') !== -1 || path.indexOf('help') !== -1 || path.indexOf('support') !== -1;
  }
  function isAppPage() {
    var path = window.location.pathname || '';
    return path === '/' || path.indexOf('app.html') !== -1 || path === '';
  }

  function injectMobileAgencyBtn() {
    // Mobile : bouton agence uniquement sur app.html
    if (!isAppPage()) return;
    if (document.getElementById('agencySwitcherBtnMobile')) return;
    var mh = document.getElementById('bhMobileHeader') || document.querySelector('.mobile-header');
    if (!mh) return;
    // Find the right-side flex container (with sync + notif buttons)
    var rightContainer = mh.querySelector('[style*="justify-content:flex-end"]') || mh.querySelector('[style*="justify-content: flex-end"]');
    var btn = document.createElement('button');
    btn.id = 'agencySwitcherBtnMobile';
    btn.onclick = function() { if (window.openAgencySwitcherModal) window.openAgencySwitcherModal(); };
    btn.style.cssText = 'display:none;background:rgba(124,58,237,.10);border:1px solid rgba(124,58,237,.22);border-radius:10px;cursor:pointer;color:#7c3aed;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;-webkit-backdrop-filter:blur(10px) saturate(160%);backdrop-filter:blur(10px) saturate(160%);transition:transform .18s cubic-bezier(.34,1.4,.5,1),background .2s;width:32px;height:32px;flex-shrink:0;';
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/></svg>';
    // À GAUCHE du logo : dans le bloc statuts/info (équilibre le header,
    // le logo centré en absolu ne chevauche plus les actions de droite)
    var leftContainer = mh.querySelector('[style*="justify-content:flex-start"]') || mh.querySelector('[style*="justify-content: flex-start"]');
    if (leftContainer) {
      leftContainer.appendChild(btn);
    } else if (rightContainer) {
      rightContainer.insertBefore(btn, rightContainer.firstChild);
    } else {
      mh.appendChild(btn);
    }
  }

  function _updateAgencyHeaderClass() {
    var mh = document.getElementById('bhMobileHeader') || document.querySelector('.mobile-header');
    if (!mh) return;
    var btnMobile = document.getElementById('agencySwitcherBtnMobile');
    var visible = btnMobile && btnMobile.style.display !== 'none' && getComputedStyle(btnMobile).display !== 'none';
    mh.classList.toggle('bh-has-agency', !!visible);
    mh.classList.toggle('bh-no-agency', !visible);
  }

  window.initAgencySwitcherBtn = function() {
    // Pas de bouton agence sur settings-account et help
    if (isAgencyBtnHiddenPage()) { _updateAgencyHeaderClass(); return; }
    if (window.innerWidth <= 1366) injectMobileAgencyBtn();
    var btn = document.getElementById('agencySwitcherBtn');
    var btnMobile = document.getElementById('agencySwitcherBtnMobile');
    var hasManagedUser = !!localStorage.getItem('lcc_managed_user');
    var hasAccounts = window._agencyAccounts && window._agencyAccounts.length;
    if (hasManagedUser || hasAccounts) {
      if (btn) btn.style.display = 'inline-flex';
      if (btnMobile) btnMobile.style.display = 'inline-flex';
      updateAgencySwitcherLabel();
    }
    _updateAgencyHeaderClass();
  };

  // Watch for agency accounts to be loaded
  var _origRenderToggle = window.renderAgencyToggle;
  window.renderAgencyToggle = function(accounts) {
    if (isAgencyBtnHiddenPage()) return;
    var btn = document.getElementById('agencySwitcherBtn');
    var btnMobile = document.getElementById('agencySwitcherBtnMobile');
    if (btn) btn.style.display = 'inline-flex';
    if (btnMobile) btnMobile.style.display = 'inline-flex';
    updateAgencySwitcherLabel();
    _updateAgencyHeaderClass();
    // Don't call old bar rendering
  };

  // On page load, check if in managed mode
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initAgencySwitcherBtn, 500);
    setTimeout(function() {
      if (typeof window.loadAgencyAccountsForSwitcher === 'function') {
        window.loadAgencyAccountsForSwitcher();
      }
    }, 600);
  });
})();



// ═══════════════════════════════════════════════════════════════
// 🧊 LIQUID GLASS — Pill position via CSS custom properties
// Ultra-robuste : pas de DOM inject, juste des --pill-x / --pill-w
// ═══════════════════════════════════════════════════════════════
(function() {
  'use strict';

  // ── Mobile pill ──
  function updateMobilePill() {
    var tabs = document.querySelector('.mobile-tabs');
    if (!tabs) return;
    var active = tabs.querySelector('.tab-btn.active');
    if (!active || active.offsetWidth === 0) {
      tabs.style.setProperty('--pill-opacity', '0');
      return;
    }
    var x = active.offsetLeft;
    var w = active.offsetWidth;
    tabs.style.setProperty('--pill-x', x + 'px');
    tabs.style.setProperty('--pill-w', w + 'px');
    tabs.style.setProperty('--pill-opacity', '0'); /* ancienne pill désactivée — remplacée par .lg-capsule */
  }

  // ── Sidebar pill ──
  function updateSidebarPill() {
    if (window.innerWidth <= 1366) return;
    var nav = document.querySelector('.sidebar .sidebar-nav');
    if (!nav) return;
    var active = nav.querySelector('a.nav-item.active');
    if (!active || active.offsetHeight === 0) {
      nav.style.setProperty('--spill-opacity', '0');
      return;
    }
    var y = active.offsetTop;
    var h = active.offsetHeight;
    nav.style.setProperty('--spill-y', y + 'px');
    nav.style.setProperty('--spill-h', h + 'px');
    nav.style.setProperty('--spill-opacity', '1');
  }

  // ── Init : poll jusqu'à ce que les tabs existent ──
  var attempts = 0;
  var poller = setInterval(function() {
    attempts++;
    var tabs = document.querySelector('.mobile-tabs');
    var hasActive = tabs && tabs.querySelector('.tab-btn.active');
    if (hasActive && hasActive.offsetWidth > 0) {
      clearInterval(poller);
      // Position initiale SANS transition
      tabs.style.transition = 'none';
      var before = getComputedStyle(tabs, '::before');
      updateMobilePill();
      // Forcer le reflow puis réactiver la transition
      tabs.offsetHeight;
      setTimeout(function() { tabs.style.transition = ''; }, 50);

      // Écouter les clics
      tabs.addEventListener('click', function() {
        setTimeout(updateMobilePill, 50);
      });

      // Observer les changements de classe
      tabs.querySelectorAll('.tab-btn').forEach(function(btn) {
        new MutationObserver(function() { updateMobilePill(); })
          .observe(btn, { attributes: true, attributeFilter: ['class'] });
      });
    }
    if (attempts > 50) clearInterval(poller); // stop après 5s
  }, 100);

  // Sidebar
  setTimeout(function() {
    updateSidebarPill();
    var nav = document.querySelector('.sidebar .sidebar-nav');
    if (nav) {
      nav.querySelectorAll('a.nav-item').forEach(function(item) {
        item.addEventListener('mouseenter', function() {
          if (item.classList.contains('active')) return;
          nav.style.setProperty('--spill-y', item.offsetTop + 'px');
          nav.style.setProperty('--spill-h', item.offsetHeight + 'px');
          nav.style.setProperty('--spill-opacity', '0.4');
        });
        item.addEventListener('mouseleave', function() {
          updateSidebarPill();
        });
      });
    }
  }, 800);

  window.addEventListener('resize', function() {
    updateMobilePill();
    updateSidebarPill();
  });
})();


// ═══════════════════════════════════════════════════════════════
// 🧊✨ LIQUID GLASS TAB BAR — v5
// • détection par LIBELLÉ visible (settings = page logement → Logements)
// • capsule "Plus" pilotée par le tap (toggle) + détecteur de fermeture
// • touch-action:none → drag fluide ; icônes FontAwesome jamais cassées
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var JADE = '#0E3B2E';

  function injectStyle() {
    if (document.getElementById('lg-tabbar-style')) return;
    var css =
    '@media (max-width:1366px){' +
      '.mobile-tabs::before,.mobile-tabs::after{content:none!important;display:none!important;background:none!important;}' +
      '.mobile-tabs .tab-btn::before,.mobile-tabs .tab-btn::after{content:none!important;display:none!important;}' +
      '.mobile-tabs .glass-pill-mobile,.mobile-tabs .glass-pill{display:none!important;}' +
      '.mobile-tabs .tab-btn:focus,.mobile-tabs .tab-btn:focus-visible,.mobile-tabs .tab-btn:active{outline:none!important;-webkit-tap-highlight-color:transparent!important;}' +
      '.mobile-tabs .tab-btn.active{background:transparent!important;box-shadow:none!important;}' +
      '.mobile-tabs{position:fixed!important;z-index:10001!important;pointer-events:auto!important;touch-action:none!important;}' +
      // la feuille "Plus" passe AU-DESSUS de la barre (sinon la barre masque le bouton Déconnexion)
      '#moreMenuSheet,#moreMenuOverlay{z-index:10060!important;}' +
      // vrai conteneur scrollable : sinon le bouton Déconnexion est coupé et rebondit
      '#moreMenuSheet{overflow-y:auto!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important;max-height:calc(100vh - 48px)!important;max-height:calc(100dvh - 48px)!important;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 28px)!important;}' +

      '.mobile-tabs .lg-capsule{' +
        'position:absolute;top:6px;left:0;' +
        'height:calc(100% - 12px - env(safe-area-inset-bottom,0px));' +
        'width:0;border-radius:18px;box-sizing:border-box;' +
        'background:rgba(14,59,46,0.13);' +
        '-webkit-backdrop-filter:blur(14px) saturate(180%);backdrop-filter:blur(14px) saturate(180%);' +
        'border:1px solid rgba(14,59,46,0.22);' +
        'box-shadow:0 4px 16px rgba(14,59,46,0.16),inset 0 1px 0 rgba(255,255,255,0.65),inset 0 -1px 2px rgba(14,59,46,0.10);' +
        'transform:translateX(0) scaleX(1) translateZ(0);transform-origin:center center;' +
        'backface-visibility:hidden;-webkit-backface-visibility:hidden;' +
        'opacity:0;z-index:0;pointer-events:none;will-change:transform,width;' +
      '}' +
      '.mobile-tabs .lg-capsule.lg-visible{opacity:1;}' +
      '.mobile-tabs .lg-capsule.lg-animate{transition:transform .5s cubic-bezier(.34,1.4,.5,1),width .4s cubic-bezier(.34,1.2,.64,1),opacity .25s ease;}' +
      '.mobile-tabs .lg-capsule.lg-dragging{-webkit-backdrop-filter:none!important;backdrop-filter:none!important;background:rgba(14,59,46,0.20)!important;box-shadow:none!important;border-color:transparent!important;transition:none!important;}' +

      '.mobile-tabs .tab-btn{position:relative!important;z-index:1!important;background:transparent!important;transition:color .2s ease!important;}' +
      '.mobile-tabs .tab-btn,.mobile-tabs .tab-btn i,.mobile-tabs .tab-btn span{color:#98a3b0!important;}' +
      '.mobile-tabs .tab-btn.lg-active,.mobile-tabs .tab-btn.lg-active i,.mobile-tabs .tab-btn.lg-active span,' +
      '.mobile-tabs .tab-btn.lg-hover,.mobile-tabs .tab-btn.lg-hover i,.mobile-tabs .tab-btn.lg-hover span{color:' + JADE + '!important;}' +
      '.mobile-tabs .tab-btn.lg-active span,.mobile-tabs .tab-btn.lg-hover span{font-weight:700!important;}' +
      '.mobile-tabs .tab-btn i{transition:transform .32s cubic-bezier(.34,1.5,.5,1)!important;}' +
      '.mobile-tabs .tab-btn.lg-active i{transform:translateY(-2px) scale(1.08)!important;}' +
      '.mobile-tabs .tab-btn.lg-hover i{transform:none!important;}' +
      '.mobile-tabs .tab-btn .badge{color:#fff!important;background:#DC2626!important;}' +
      '.mobile-tabs .tab-btn.active:not(.lg-active),.mobile-tabs .tab-btn.active:not(.lg-active) i,.mobile-tabs .tab-btn.active:not(.lg-active) span{color:#98a3b0!important;}' +
      '.mobile-tabs .tab-btn.active:not(.lg-active) span{font-weight:500!important;}' +

      '[data-theme="dark"] .mobile-tabs .lg-capsule{background:rgba(30,110,82,0.18);border-color:rgba(30,110,82,0.30);box-shadow:0 4px 18px rgba(0,0,0,0.30),inset 0 1px 0 rgba(255,255,255,0.10);}' +
      '[data-theme="dark"] .mobile-tabs .lg-capsule.lg-dragging{background:rgba(30,110,82,0.28)!important;}' +
      '[data-theme="dark"] .mobile-tabs .tab-btn,[data-theme="dark"] .mobile-tabs .tab-btn i,[data-theme="dark"] .mobile-tabs .tab-btn span{color:#7e8a98!important;}' +
      '[data-theme="dark"] .mobile-tabs .tab-btn.lg-active,[data-theme="dark"] .mobile-tabs .tab-btn.lg-active i,[data-theme="dark"] .mobile-tabs .tab-btn.lg-active span,' +
      '[data-theme="dark"] .mobile-tabs .tab-btn.lg-hover,[data-theme="dark"] .mobile-tabs .tab-btn.lg-hover i,[data-theme="dark"] .mobile-tabs .tab-btn.lg-hover span{color:#1E6E52!important;}' +
      '[data-theme="dark"] .mobile-tabs .tab-btn.active:not(.lg-active),[data-theme="dark"] .mobile-tabs .tab-btn.active:not(.lg-active) i,[data-theme="dark"] .mobile-tabs .tab-btn.active:not(.lg-active) span{color:#7e8a98!important;}' +
      '[data-theme="dark"] .mobile-tabs .tab-btn.active:not(.lg-active) span{font-weight:500!important;}' +

      '@media (prefers-reduced-motion:reduce){.mobile-tabs .lg-capsule.lg-animate{transition:opacity .2s ease!important;}}' +
    '}';
    var s = document.createElement('style');
    s.id = 'lg-tabbar-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function deburr(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
  function tabsOf(bar) { return Array.prototype.slice.call(bar.querySelectorAll('.tab-btn')).filter(function (t) { return t.offsetWidth > 0; }); }
  function labelOf(t) { var sp = t.querySelector('span'); return deburr(sp ? sp.textContent : t.textContent); }

  // Menage a son propre onglet dans la barre : il sort de MORE.
  // Mes logements (settings) prend sa place dans le menu Plus.
  var MORE = { 'settings-account': 1, help: 1, support: 1, factures: 1, clients: 1, deposits: 1, cautions: 1,
    welcome: 1, livrets: 1, contrat: 1, contrats: 1, reporting: 1, revenus: 1,
    pricing: 1, finances: 1, notifications: 1, avis: 1,
    settings: 1, logements: 1, properties: 1, biens: 1,
    'smart-locks': 1, smart_locks: 1, serrures: 1 };
  var TOLABEL = { app: 'accueil', dashboard: 'accueil', accueil: 'accueil', index: 'accueil',
    reservations: 'reservations', messages: 'messages',
    cleaning: 'menage', menage: 'menage', menages: 'menage' };

  function keyForPage(page) { page = deburr(page); if (TOLABEL[page]) return TOLABEL[page]; if (MORE[page]) return 'plus'; return ''; }
  function findByLabel(tabs, key) { if (!key) return -1; for (var i = 0; i < tabs.length; i++) if (labelOf(tabs[i]).indexOf(key) !== -1) return i; return -1; }
  function plusIndex(tabs) { return findByLabel(tabs, 'plus'); }

  // Diagnostic : bhDiagOnglets() en console indique quel onglet la barre
  // considere actif et pourquoi. Utile quand un cache sert une vieille version.
  window.bhDiagOnglets = function () {
    var bar = document.querySelector('.mobile-tabs');
    if (!bar) return console.log('[BH] pas de barre d\'onglets sur cette page');
    var ts = tabsOf(bar);
    var page = document.body && document.body.dataset ? document.body.dataset.page : '(aucun)';
    console.log('[BH] data-page =', page, '| cle =', keyForPage(page));
    console.log('[BH] onglets  =', ts.map(function (t) { return labelOf(t); }));
    console.log('[BH] index attendu =', pageIndex(ts), '| version tables = menage-v2');
    return pageIndex(ts);
  };

  function pageIndex(tabs) {
    var idx = findByLabel(tabs, keyForPage(document.body && document.body.dataset && document.body.dataset.page));
    if (idx >= 0) return idx;
    var file = deburr((location.pathname || '').split('/').pop()).replace('.html', '');
    idx = findByLabel(tabs, keyForPage(file));
    if (idx >= 0) return idx;
    for (var m = 0; m < tabs.length; m++) if (tabs[m].classList.contains('active')) return m;
    return -1;
  }

  function moreOpen() {
    var el = document.getElementById('moreMenuSheet');
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return false;
    var r = el.getBoundingClientRect();
    return r.height > 40 && r.top < (window.innerHeight - 40);
  }

  function setup(bar) {
    if (bar.__lgReady) return;
    bar.__lgReady = true;

    var dupes = bar.querySelectorAll('.lg-capsule');
    for (var d = 1; d < dupes.length; d++) dupes[d].remove();
    var cap = bar.querySelector('.lg-capsule');
    if (!cap) { cap = document.createElement('div'); cap.className = 'lg-capsule'; bar.insertBefore(cap, bar.firstChild); }

    var dragging = false, moved = false, startX = 0, lastX = 0, lastT = 0, vx = 0;
    var startIdx = -1, hoverIdx = -1, suppressClick = false, mc = [], rafId = 0, pendX = 0, curIdx = -1;
    var pinned = false, pinWatch = null, sawOpen = false;
    var navTargetIdx = -1; // onglet cible d'une navigation : la capsule y reste pendant le chargement de la nouvelle page

    function snapshot() { mc = tabsOf(bar).map(function (t) { return { el: t, left: t.offsetLeft, width: t.offsetWidth, center: t.offsetLeft + t.offsetWidth / 2 }; }); }
    function markActive(idx) { var ts = tabsOf(bar); for (var i = 0; i < ts.length; i++) ts[i].classList.toggle('lg-active', i === idx); }
    function paintHover(idx) { for (var i = 0; i < mc.length; i++) mc[i].el.classList.toggle('lg-hover', i === idx && i !== curIdx); }
    function clearHover() { for (var i = 0; i < mc.length; i++) mc[i].el.classList.remove('lg-hover'); }

    function settle(idx, animate) {
      snapshot(); curIdx = idx; markActive(idx);
      if (idx < 0 || idx >= mc.length) { cap.classList.remove('lg-visible'); return; }
      var m = mc[idx];
      cap.classList.remove('lg-dragging');
      cap.classList.toggle('lg-animate', !!animate);
      cap.style.width = m.width + 'px';
      cap.style.transform = 'translateX(' + m.left + 'px) scaleX(1) translateZ(0)';
      cap.classList.add('lg-visible');
    }

    function sync(animate) {
      var ts = tabsOf(bar);
      // Navigation en cours : on garde la capsule sur l'onglet cible. La page
      // courante est encore l'ancienne, donc pageIndex() renverrait l'onglet
      // d'origine → la capsule rebondirait en arrière avant le chargement.
      if (navTargetIdx >= 0 && navTargetIdx < ts.length) { settle(navTargetIdx, animate); return; }
      if (pinned || moreOpen()) { var pi = plusIndex(ts); if (pi >= 0) { settle(pi, animate); return; } }
      settle(pageIndex(ts), animate);
    }
    bar.__lgSync = sync;

    function startPinWatch() {
      sawOpen = false; if (pinWatch) clearInterval(pinWatch);
      var misses = 0;
      pinWatch = setInterval(function () {
        if (!pinned) { clearInterval(pinWatch); return; }
        if (moreOpen()) { sawOpen = true; misses = 0; }
        else if (sawOpen) { misses++; if (misses >= 2) { pinned = false; clearInterval(pinWatch); sync(true); } }
      }, 250);
    }

    function applyFollow() {
      rafId = 0; if (!mc.length) return;
      var x = Math.max(mc[0].center, Math.min(mc[mc.length - 1].center, pendX));
      var w = mc[startIdx] ? mc[startIdx].width : mc[0].width;
      var st = Math.min(0.12, Math.abs(vx) * 0.010);
      cap.style.width = w + 'px';
      cap.style.transform = 'translateX(' + (x - w / 2) + 'px) scaleX(' + (1 + st) + ') translateZ(0)';
      var best = 0, bd = Infinity;
      for (var i = 0; i < mc.length; i++) { var dd = Math.abs(mc[i].center - x); if (dd < bd) { bd = dd; best = i; } }
      if (best !== hoverIdx) { hoverIdx = best; paintHover(best); if (navigator.vibrate) { try { navigator.vibrate(3); } catch (e) {} } }
    }
    function follow(px) { pendX = px; if (!rafId) rafId = requestAnimationFrame(applyFollow); }

    function onDown(e) {
      var p = (e.touches ? e.touches[0] : e); snapshot(); if (!mc.length) return;
      dragging = true; moved = false; startX = lastX = p.clientX; lastT = e.timeStamp || Date.now(); vx = 0; hoverIdx = curIdx;
      startIdx = 0;
      for (var i = 0; i < mc.length; i++) { if (p.clientX >= mc[i].left && p.clientX <= mc[i].left + mc[i].width) { startIdx = i; break; } }
      cap.classList.remove('lg-animate');
      if (bar.setPointerCapture && e.pointerId != null) { try { bar.setPointerCapture(e.pointerId); } catch (er) {} }
    }
    function onMove(e) {
      if (!dragging) return;
      var p = (e.touches ? e.touches[0] : e);
      var dx = p.clientX - lastX, dt = (e.timeStamp || Date.now()) - lastT;
      if (dt > 0) vx = dx / dt * 16; lastX = p.clientX; lastT = e.timeStamp || Date.now();
      if (!moved && Math.abs(p.clientX - startX) > 6) { moved = true; cap.classList.add('lg-dragging'); }
      if (moved) { if (e.cancelable) e.preventDefault(); follow(p.clientX); }
    }
    function onUp() {
      if (!dragging) return; dragging = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } clearHover();
      if (!moved) { return; }
      var target = hoverIdx >= 0 ? hoverIdx : startIdx;
      pinned = (target === plusIndex(tabsOf(bar)));
      if (pinned) startPinWatch();
      // Drag vers un onglet de navigation : verrouiller la cible AVANT settle, sinon
      // le markActive() de settle redéclenche un sync qui repart sur l'ancienne page
      // pendant les ~120ms avant que le clic programmatique ne pose le verrou.
      if (!pinned && target !== startIdx) { navTargetIdx = target; }
      settle(target, true);
      if (target !== startIdx && mc[target]) {
        suppressClick = true; setTimeout(function () { suppressClick = false; }, 450);
        var el = mc[target].el;
        setTimeout(function () { var ev; try { ev = new MouseEvent('click', { bubbles: true, cancelable: true }); } catch (er) { ev = document.createEvent('MouseEvents'); ev.initEvent('click', true, true); } ev.__lgProg = true; el.dispatchEvent(ev); }, 120);
      }
      moved = false;
    }

    function swallowClick(e) { if (e.__lgProg) return; if (suppressClick) { e.preventDefault(); e.stopPropagation(); } }

    function onBarClick(e) {
      var t = e.target.closest ? e.target.closest('.tab-btn') : null;
      if (!t) return;
      var ts = tabsOf(bar); var idx = ts.indexOf(t); var pi = plusIndex(ts);
      if (e.__lgProg) { pinned = (idx === pi); }
      else if (idx === pi) { pinned = !pinned; }
      else { pinned = false; }
      if (pinned) startPinWatch(); else if (pinWatch) { clearInterval(pinWatch); }
      // Onglet de navigation (pas le Plus) : la capsule reste sur l'onglet cliqué
      // jusqu'au chargement de la nouvelle page, au lieu de rebondir vers l'origine.
      if (!pinned && idx >= 0 && idx !== pi) { navTargetIdx = idx; settle(idx, true); }
      else { setTimeout(function () { if (!dragging) sync(true); }, 0); }
    }

    if (window.PointerEvent) {
      bar.addEventListener('pointerdown', onDown, { passive: true });
      bar.addEventListener('pointermove', onMove, { passive: false });
      bar.addEventListener('pointerup', onUp, { passive: true });
      bar.addEventListener('pointercancel', function () { dragging = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } clearHover(); sync(true); }, { passive: true });
    } else {
      bar.addEventListener('touchstart', onDown, { passive: true });
      bar.addEventListener('touchmove', onMove, { passive: false });
      bar.addEventListener('touchend', onUp, { passive: true });
    }
    bar.addEventListener('click', swallowClick, true);
    bar.addEventListener('click', onBarClick, false);

    sync(false);
    requestAnimationFrame(function () { bar.offsetHeight; cap.classList.add('lg-animate'); });

    tabsOf(bar).forEach(function (t) {
      new MutationObserver(function () { if (!dragging) sync(true); }).observe(t, { attributes: true, attributeFilter: ['class'] });
    });
    var sheet = document.getElementById('moreMenuSheet');
    if (sheet) new MutationObserver(function () { if (!dragging) sync(true); }).observe(sheet, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  function boot() {
    injectStyle();
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      var bar = document.querySelector('.mobile-tabs');
      if (bar && tabsOf(bar).length) { clearInterval(poll); setup(bar); }
      if (tries > 60) clearInterval(poll);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener('resize', function () { var b = document.querySelector('.mobile-tabs'); if (b && b.__lgSync) b.__lgSync(false); });
  window.addEventListener('pageshow', function () { var b = document.querySelector('.mobile-tabs'); if (b && b.__lgSync) b.__lgSync(false); });
})();

// ═══════════════════════════════════════════════════════════════
// 🧊 HEADER v4.0 — icônes Lucide + boutons glass (toutes les pages)
// Remplace les <i> FontAwesome du .mobile-header par des SVG Lucide
// et applique le style glass, SANS toucher aux id/badges/handlers
// (le <i> est conservé : la rotation du bouton sync continue de marcher).
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var P = {
    server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>',
    bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8a6 6 0 0 0-12 0c0 4.499-1.411 5.956-2.738 7.326"/>'
  };
  function svg(name, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + P[name] + '</svg>';
  }
  function swap(iEl, name, size) {
    if (!iEl) return;
    iEl.className = 'lg-hicon';
    iEl.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;line-height:0;';
    iEl.innerHTML = svg(name, size);
  }
  // Helper global : état vide illustré (icône + titre + texte), dispo sur toutes les pages.
  // ── bhAnimateValue : anime un nombre de 0 (ou valeur courante) vers une cible ──
  // Gère préfixe/suffixe (%, €), décimales, et respecte prefers-reduced-motion.
  // Usage : bhAnimateValue(el, 375, { suffix:'€' });  bhAnimateValue(el, 8, { suffix:'%' });
  if (!window.bhAnimateValue) {
    window.bhAnimateValue = function(el, target, opts) {
      if (!el) return;
      opts = opts || {};
      var prefix = opts.prefix || '';
      var suffix = opts.suffix || '';
      var decimals = opts.decimals || 0;
      var duration = opts.duration || 900;
      target = Number(target) || 0;
      // Respecte la préférence d'accessibilité : pas d'animation
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.textContent = prefix + target.toFixed(decimals) + suffix;
        return;
      }
      var start = 0;
      var startTime = null;
      function fmt(v){ return prefix + (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('fr-FR')) + suffix; }
      function step(ts) {
        if (!startTime) startTime = ts;
        var p = Math.min((ts - startTime) / duration, 1);
        // easeOutCubic
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(start + (target - start) * eased);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = fmt(target);
      }
      requestAnimationFrame(step);
    };
  }

  // ── bhHaptic : vibration légère sur les actions (iOS Capacitor + fallback web) ──
  // Usage : bhHaptic() pour un tap léger ; bhHaptic('medium') / bhHaptic('heavy')
  if (!window.bhHaptic) {
    window.bhHaptic = function(intensity) {
      try {
        // Capacitor Haptics si dispo (app iOS native)
        var Cap = window.Capacitor;
        if (Cap && Cap.Plugins && Cap.Plugins.Haptics) {
          var style = intensity === 'heavy' ? 'HEAVY' : intensity === 'medium' ? 'MEDIUM' : 'LIGHT';
          Cap.Plugins.Haptics.impact({ style: style });
          return;
        }
        // Fallback web : navigator.vibrate (Android surtout)
        if (navigator.vibrate) {
          navigator.vibrate(intensity === 'heavy' ? 18 : intensity === 'medium' ? 12 : 7);
        }
      } catch(e) { /* silencieux */ }
    };
  }

  if (!window.bhEmptyState) {
    window.bhEmptyState = function(icon, title, text) {
      var icons = {
        note: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
        invoice: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>',
        check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
        inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
        users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
        message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
        broom: '<path d="M19.4 7.34 16.66 4.6A2 2 0 0 0 14 4.53l-9 9a2 2 0 0 0-.57 1.21L4 18l3.27-.43a2 2 0 0 0 1.21-.57l9-9a2 2 0 0 0 .07-2.66Z"/>'
      };
      var path = icons[icon] || icons.inbox;
      return '<div class="bh-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#0E3B2E" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>' +
        '<div class="bh-empty-title">' + title + '</div>' +
        (text ? '<div class="bh-empty-text">' + text + '</div>' : '') +
        '</div>';
    };
  }

  function injectStyleV4() {
    if (document.getElementById('bh-style-v4-css')) return;
    var s = document.createElement('style');
    s.id = 'bh-style-v4-css';
    s.textContent = [
      '@keyframes bhSheetIn{from{transform:translateY(100%);}to{transform:translateY(0);}}',
      '@keyframes bhPanelSlideIn{from{transform:translateX(100%);}to{transform:translateX(0);}}',
      '@keyframes bhOverlayIn{from{opacity:0;}to{opacity:1;}}',
      '[style*="position: fixed"][style*="align-items: flex-end"]{animation:bhOverlayIn .2s ease;}',
      '[style*="position:fixed"][style*="align-items:flex-end"] > div:first-child,',
      '[style*="position: fixed"][style*="align-items: flex-end"] > div:first-child{animation:bhSheetIn .34s cubic-bezier(.22,1.1,.36,1);}',
      '.bh-close-glass,',
      '[id*="Close"][style*="border-radius:50%"],',
      '[id*="closeDetails"],[id*="ModalClose"]{',
        'background:rgba(255,255,255,.55)!important;',
        '-webkit-backdrop-filter:blur(10px) saturate(160%);backdrop-filter:blur(10px) saturate(160%);',
        'border:1px solid rgba(0,0,0,.06)!important;color:#6B7280!important;',
        'box-shadow:0 1px 3px rgba(0,0,0,.06)!important;',
        'transition:transform .18s cubic-bezier(.34,1.4,.5,1),background .2s!important;}',
      '[id*="Close"][style*="border-radius:50%"]:hover,',
      '[id*="closeDetails"]:hover{background:rgba(255,255,255,.85)!important;color:#1A1F2E!important;}',
      '[id*="Close"][style*="border-radius:50%"]:active,',
      '[id*="closeDetails"]:active{transform:scale(.9)!important;}',
      '.kpi-card,[class*="kpi-card"]{transition:transform .2s cubic-bezier(.34,1.2,.5,1),box-shadow .2s!important;}',
      '.kpi-card:hover,[class*="kpi-card"]:hover{transform:translateY(-3px)!important;box-shadow:0 8px 24px rgba(14,59,46,.12)!important;}',
      '.kpi-card:active,[class*="kpi-card"]:active{transform:translateY(-1px) scale(.99)!important;}',
      '.bh-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px 20px;text-align:center;color:#9CA3AF;}',
      '.bh-empty svg,.bh-empty .bh-empty-icon{width:40px;height:40px;opacity:.5;}',
      '.bh-empty-title{font-size:14px;font-weight:600;color:#6B7280;}',
      '.bh-empty-text{font-size:12.5px;color:#9CA3AF;max-width:240px;line-height:1.5;}',
      '@keyframes bhShimmer{0%{background-position:-200% 0;}100%{background-position:200% 0;}}',
      '.bh-skel{background:linear-gradient(90deg,rgba(0,0,0,.04) 25%,rgba(0,0,0,.08) 37%,rgba(0,0,0,.04) 63%);background-size:200% 100%;animation:bhShimmer 1.4s ease-in-out infinite;border-radius:8px;}',
      '.bh-skel-line{height:12px;margin:6px 0;}',
      '.bh-skel-card{height:64px;border-radius:14px;margin-bottom:8px;}'
    ].join('');
    document.head.appendChild(s);
  }
  function injectLogoCSS() {
    if (document.getElementById('bh-logo-size-css')) return;
    var s = document.createElement('style');
    s.id = 'bh-logo-size-css';
    // Tailles du logo/texte appliquées sur TOUTES les pages (pas seulement le dashboard),
    // pour que le logo soit cohérent partout. Cible large : .mobile-header et .mobile-logo.
    s.textContent =
      '.mobile-header .mobile-logo,.mobile-logo{gap:6px!important;min-width:0!important;flex:1 1 auto!important;overflow:hidden!important;}' +
      '.mobile-header .mobile-logo img:not(.bh-verrou),.mobile-logo img:not(.bh-verrou){width:30px!important;height:30px!important;min-width:30px!important;border-radius:8px!important;flex-shrink:0!important;}' +
      // Le verrou n'est pas carre : largeur libre, hauteur imposee, aucun recadrage.
      '.mobile-logo .bh-verrou{max-width:100%!important;min-width:0!important;border-radius:0!important;flex-shrink:1!important;aspect-ratio:187/42;}' +
      // Texte en colonne : titre au-dessus, sous-titre dessous, calés à la même largeur
      '.mobile-header .mobile-logo-text,.mobile-logo-text{display:inline-flex!important;flex-direction:column!important;align-items:stretch!important;min-width:0!important;overflow:hidden!important;}' +
      '.mobile-header .mobile-logo-title,.mobile-logo-title{font-size:15px!important;line-height:1.15!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;}' +
      // Sous-titre réduit + justifié → s'étire EXACTEMENT sur la largeur de "Boostinghost"
      '.mobile-header .mobile-logo-subtitle,.mobile-logo-subtitle{font-size:6.5px!important;letter-spacing:0!important;margin-top:1px!important;display:block!important;width:100%!important;white-space:nowrap!important;overflow:hidden!important;text-align:justify!important;text-align-last:justify!important;-moz-text-align-last:justify!important;}';
    document.head.appendChild(s);
  }
  function injectCSS() {
    injectLogoCSS();
    injectStyleV4();
    if (document.getElementById('bh-header-v4-css')) return;
    var s = document.createElement('style');
    s.id = 'bh-header-v4-css';
    s.textContent =
      '.mobile-header{justify-content:space-between!important;overflow:hidden!important;max-width:100%!important;box-sizing:border-box!important;}' +
      // Le groupe de boutons à droite ne doit jamais se comprimer ni sortir de l'écran
      '.mobile-header>[style*="flex-end"]{flex-shrink:0!important;}' +
      '.mobile-header #bh-mobile-ann-btn{margin-right:6px!important;}' +
      '.mobile-header>[style*="flex-end"]{gap:4px!important;margin:0!important;}' +
      '.mobile-header>[style*="flex-start"]{gap:4px!important;margin:0!important;}' +
      /* Sans bouton agence : le groupe droit (2 boutons) laisse un vide entre le logo
         et les boutons. On décolle le groupe du bord droit pour le ramener vers le
         centre, ce qui rééquilibre comme s'il y avait 3 boutons. */
      
      '.mobile-header #bh-mobile-svc,.mobile-header #bh-mobile-ann-btn,.mobile-header #syncBtnMobile,.mobile-header #bh-mobile-notif-btn{' +
        'background:rgba(255,255,255,.5)!important;-webkit-backdrop-filter:blur(10px) saturate(160%);backdrop-filter:blur(10px) saturate(160%);' +
        'border:1px solid rgba(14,59,46,.16)!important;border-radius:10px!important;height:32px!important;cursor:pointer;' +
        'transition:transform .18s cubic-bezier(.34,1.4,.5,1),background .2s,color .2s,border-color .2s!important;}' +
      /* Un seul gabarit pour TOUS les boutons de l'en-tete, des deux cotes du
         logo. #bh-mobile-svc etait une pilule (border-radius:999px + padding
         lateral) et le bouton agence n'avait pas de largeur : les trois
         boutons de gauche paraissaient donc plus gros et plus espaces que
         ceux de droite. */
      '.mobile-header #bh-mobile-svc,.mobile-header #bh-mobile-ann-btn,.mobile-header #syncBtnMobile,' +
      '.mobile-header #bh-mobile-notif-btn,.mobile-header #agencySwitcherBtnMobile,' +
      '.mobile-header #bh-mobile-search-btn{' +
        'width:32px!important;min-width:32px!important;max-width:32px!important;height:32px!important;' +
        'padding:0!important;border-radius:10px!important;gap:0!important;flex:none!important;' +
        'display:inline-flex!important;align-items:center!important;justify-content:center!important;' +
        'box-sizing:border-box!important;}' +
      /* Les deux pastilles de statut tiennent dans le carre : 6 px chacune,
         4 px d'ecart. */
      '.mobile-header #bh-mobile-svc .lg-hicon{display:none!important;}' +
      '.mobile-header #bh-mobile-svc > *{margin:0!important;}' +
      '.mobile-header #bh-mobile-svc span{gap:4px!important;}' +
      '.mobile-header #syncBtnMobile{color:#0E3B2E!important;}' +
      '.mobile-header #bh-mobile-ann-btn,.mobile-header #bh-mobile-notif-btn{color:#6B7280!important;}' +
      '.mobile-header #bh-mobile-svc .lg-hicon{color:#94a3b8!important;}' +
      '.mobile-header #bh-mobile-svc:hover,.mobile-header #bh-mobile-ann-btn:hover,.mobile-header #syncBtnMobile:hover,.mobile-header #bh-mobile-notif-btn:hover{background:rgba(255,255,255,.82)!important;}' +
      '.mobile-header #bh-mobile-ann-btn:hover,.mobile-header #bh-mobile-notif-btn:hover{color:#0E3B2E!important;}' +
      '.mobile-header #bh-mobile-svc:active,.mobile-header #bh-mobile-ann-btn:active,.mobile-header #syncBtnMobile:active,.mobile-header #bh-mobile-notif-btn:active,.mobile-header #agencySwitcherBtnMobile:active{transform:scale(.92);}' +
      '.mobile-header #agencySwitcherBtnMobile:hover{background:rgba(124,58,237,.18)!important;}' +
      '.mobile-header .lg-hicon svg{display:block;}';
    document.head.appendChild(s);
  }
  function enhance() {
    var mh = document.querySelector('.mobile-header');
    if (!mh || mh.dataset.v4) return;
    injectCSS();
    swap(mh.querySelector('#bh-mobile-svc i.fa-server'), 'server', 13);
    swap(mh.querySelector('#bh-mobile-svc i.fa-plug'), 'plug', 13);
    swap(mh.querySelector('#bh-mobile-ann-btn i.fa-info-circle'), 'info', 16);
    swap(mh.querySelector('#syncBtnMobile i.fa-sync-alt'), 'refresh', 16);
    swap(mh.querySelector('#bh-mobile-notif-btn i.fa-bell'), 'bell', 16);
    mh.dataset.v4 = '1';
  }
  // Haptic global : léger retour tactile au tap sur les éléments interactifs clés.
  function attachHaptics() {
    if (window.__bhHapticsAttached) return;
    window.__bhHapticsAttached = true;
    document.addEventListener('touchstart', function(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      // Boutons, cards KPI, FAB, onglets, liens d'action
      var hit = t.closest('button, .kpi-card, [class*="kpi-card"], .fab, [class*="fab"], .mobile-tabs a, [role="button"], .bh-close-glass');
      if (hit) { try { window.bhHaptic && window.bhHaptic('light'); } catch(_){} }
    }, { passive: true });
  }
  // ── Transitions de page : fondu à l'arrivée + léger fondu sortant à la navigation ──
  // Supprime le "flash blanc" entre les pages. Filets de sécurité inclus.
  function injectPageTransition() {
    if (document.getElementById('bh-page-transition-css')) return;
    var s = document.createElement('style');
    s.id = 'bh-page-transition-css';
    s.textContent = [
      '@keyframes bhPageIn{from{opacity:0;}to{opacity:1;}}',
      'body.bh-page-ready{animation:bhPageIn .28s ease;}',
      'body.bh-page-leaving{opacity:0;transition:opacity .18s ease;}'
    ].join('');
    document.head.appendChild(s);
  }
  function setupPageTransitions() {
    injectPageTransition();
    // Fade-in à l'arrivée
    document.body.classList.add('bh-page-ready');
    // Si la page revient du cache (retour arrière), retirer tout état "leaving"
    window.addEventListener('pageshow', function() {
      document.body.classList.remove('bh-page-leaving');
    });
    // Fade-out sortant sur les liens internes de navigation
    document.addEventListener('click', function(e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
      // Seulement les liens internes .html de l'app
      if (!/\.html(\?|#|$)/.test(href) && href.charAt(0) !== '/') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      // Lance le fondu sortant ; le navigateur enchaîne la navigation
      document.body.classList.add('bh-page-leaving');
      // Filet de sécurité : si la nav est annulée, on rétablit après 1s
      setTimeout(function(){ document.body.classList.remove('bh-page-leaving'); }, 1000);
    }, true);
  }
  function boot() { injectLogoCSS(); injectStyleV4(); enhance(); attachHaptics(); setupPageTransitions(); setTimeout(function(){ injectLogoCSS(); injectStyleV4(); enhance(); }, 600); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

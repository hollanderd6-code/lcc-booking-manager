(function () {
  'use strict';

/* /js/bh-layout.js – injection sidebar + header avec filtrage permissions sous-comptes */
const LOGO_B_SVG = `<img src="data:image/png;base64,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" alt="Boostinghost" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover;">`;

function getSidebarHTML() {
  // Vérifier si sous-compte
  const accountType = localStorage.getItem('lcc_account_type');
  const isSubAccount = (accountType === 'sub'); // ✅ Strict equality
  
  console.log('🔍 [SIDEBAR] Account type:', accountType);
  console.log('🔍 [SIDEBAR] Is sub-account:', isSubAccount);
  
  let permissions = {};
  if (isSubAccount) {
    try {
      const permData = localStorage.getItem('lcc_permissions');
      if (permData) permissions = JSON.parse(permData);
      console.log('🔐 [SIDEBAR] Permissions chargées:', permissions);
    } catch (e) {
      console.error('❌ [SIDEBAR] Erreur chargement permissions:', e);
    }
  } else {
    console.log('✅ [SIDEBAR] Compte principal - Accès total');
  }

  // Fonction helper pour vérifier permission
  // ✅ CORRIGÉ : Si pas sous-compte, toujours true
  const hasPermission = (perm) => {
    if (!isSubAccount) {
      return true; // Compte principal = accès total
    }
    return permissions[perm] === true;
  };

  return `
<aside class="sidebar">
  <div class="sidebar-header">
    <a class="sidebar-logo" href="/" style="display:flex;align-items:center;gap:10px;padding:22px 18px 18px;text-decoration:none;">
      <img src="data:image/png;base64,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" alt="Boostinghost" style="width:36px;height:36px;min-width:36px;border-radius:50%;flex-shrink:0;object-fit:cover;">
      <div style="display:flex;flex-direction:column;justify-content:center;">
        <span style="font-family:'Instrument Serif',Georgia,serif;font-size:18px;line-height:1.15;font-weight:400;letter-spacing:-0.01em;">
          <span style="color:#0D1117;">Boosting</span><em style="color:#1A7A5E;font-style:italic;">host</em>
        </span>
        <span style="font-size:10px;color:#7A8695;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;margin-top:1px;">
          ${isSubAccount ? 'ESPACE COLLABORATEUR' : 'Smart Property Manager'}
        </span>
      </div>
    </a>
  </div>

  <nav class="sidebar-nav">
    <!-- PRINCIPAL -->
    <div class="nav-section">
      <div class="nav-section-title">Principal</div>
      ${hasPermission('can_view_reservations') ? `
      <a class="nav-item active" data-page="app" href="${isSubAccount ? '/sub-account.html' : '/app.html'}">
        <i class="fas fa-th-large"></i><span>Dashboard</span>
      </a>
      <a class="nav-item" href="${isSubAccount ? '/sub-account.html#calendarSection' : '/app.html#calendarSection'}" id="navCalendarLink">
        <i class="fas fa-calendar"></i><span>Calendrier</span>
      </a>
      ` : ''}
      ${hasPermission('can_view_messages') ? `
      <a class="nav-item" data-page="messages" href="/messages.html">
        <i class="fas fa-comment-dots"></i><span>Messages</span>
      </a>
      ` : ''}
    </div>

    <!-- GESTION -->
    ${(!isSubAccount || hasPermission('can_view_properties') || hasPermission('can_view_cleaning')) ? `
    <div class="nav-section">
      <div class="nav-section-title">Gestion</div>
      ${hasPermission('can_view_properties') ? `
      <a class="nav-item" data-page="settings" href="/settings.html">
        <i class="fas fa-home"></i><span>Mes logements</span>
      </a>
      <a class="nav-item" data-page="welcome" href="/welcome.html">
        <i class="fas fa-book"></i><span>Livret d'accueil</span>
      </a>
      ` : ''}
      ${hasPermission('can_view_cleaning') ? `
      <a class="nav-item" data-page="cleaning" href="/cleaning.html">
        <i class="fas fa-broom"></i><span>Gestion du ménage</span>
      </a>
      ` : ''}
    </div>
    ` : ''}

    <!-- FACTURATION -->
    ${(!isSubAccount || hasPermission('can_view_invoices') || hasPermission('can_manage_invoices')) ? `
    <div class="nav-section">
      <div class="nav-section-title">Facturation</div>
      ${hasPermission('can_view_invoices') || hasPermission('can_manage_invoices') ? `
      <a class="nav-item" data-page="factures" href="/factures.html">
        <i class="fas fa-file-invoice"></i><span>Factures clients</span>
      </a>
      <a class="nav-item" data-page="factures-proprietaires" href="/factures-proprietaires.html">
        <i class="fas fa-file-invoice-dollar"></i><span>Factures propriétaires</span>
      </a>
      ` : ''}
    </div>
    ` : ''}

    <!-- AVANCÉ -->
    ${(!isSubAccount || hasPermission('can_view_deposits') || hasPermission('can_manage_deposits') || hasPermission('can_view_smart_locks') || hasPermission('can_manage_smart_locks')) ? `
    <div class="nav-section">
      <div class="nav-section-title">Avancé</div>
      ${hasPermission('can_view_deposits') || hasPermission('can_manage_deposits') ? `
      <a class="nav-item" data-page="deposits" href="/deposits.html">
        <i class="fas fa-shield-alt"></i><span>Cautions</span>
      </a>
      ` : ''}
      ${hasPermission('can_view_smart_locks') || hasPermission('can_manage_smart_locks') ? `
      <a class="nav-item" data-page="smart-locks" href="/smart-locks.html">
        <i class="fas fa-lock"></i><span>Serrures connectées</span>
      </a>
      ` : ''}
    </div>
    ` : ''}

    <!-- PARAMÈTRES (compte principal uniquement) -->
    ${!isSubAccount ? `
    <div class="nav-section">
      <div class="nav-section-title">Paramètres</div>
      <a class="nav-item" data-page="settings-account" href="/settings-account.html">
        <i class="fas fa-cog"></i><span>Paramètres</span>
      </a>
      <a class="nav-item" data-page="help" href="/help.html">
        <i class="fas fa-question-circle"></i><span>Aide</span>
      </a>
    </div>
    ` : ''}
  </nav>

  <div style="flex-shrink:0;border-top:1px solid #E8E0D0;padding:12px;background:#F5F0E8;">
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;">
      <div id="sidebarUserAvatar" style="width:34px;height:34px;min-width:34px;background:linear-gradient(135deg,#1A7A5E,#2AAE86);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;font-family:DM Sans,sans-serif;flex-shrink:0;">C</div>
      <div style="flex:1;min-width:0;">
        <div id="sidebarUserName" style="font-size:13px;font-weight:600;color:#0D1117 !important;font-family:DM Sans,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">Utilisateur</div>
        <div id="sidebarUserCompany" style="font-size:11px;color:#5A6A7A;font-family:DM Sans,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${isSubAccount ? 'Sous-compte' : 'Mon espace'}</div>
      </div>
      <button id="logoutBtn" style="background:#EDE8DF;border:1px solid #D4C9B8;color:#5A6A7A;border-radius:8px;width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
        <i class="fas fa-sign-out-alt" style="font-size:11px;"></i>
      </button>
    </div>
  </div>
</aside>
`;
}

  const BRAND_TEXT_HTML = `<span class="mobile-logo-title">
    <span style="color:#10B981; font-weight:800;">Boosting</span><span style="color:#111827; font-weight:600;">host</span>
  </span>
  <span class="mobile-logo-subtitle" style="font-size: 10px; color: #6B7280; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">Smart Property Manager</span>`;

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
      logoutBtn.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log("🚪 Déconnexion...");
        localStorage.removeItem("lcc_token");
        localStorage.removeItem("lcc_user");
        localStorage.removeItem("lcc_account_type");
        localStorage.removeItem("lcc_permissions");
        window.location.href = "/login.html";
      });
    }

    const user = JSON.parse(localStorage.getItem('lcc_user') || '{}');
    if (user.firstName) {
      const nameEl = document.getElementById('sidebarUserName');
      const avatarEl = document.getElementById('sidebarUserAvatar');
      if (nameEl) nameEl.textContent = user.firstName + ' ' + (user.lastName || '');
      if (avatarEl) avatarEl.textContent = user.firstName.charAt(0).toUpperCase();
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

    const kicker = document.body.getAttribute("data-kicker") || "Gestion";
    const title = document.body.getAttribute("data-title") || document.title || "Page";
    const subtitle = document.body.getAttribute("data-subtitle") || "";
    const backHref = document.body.getAttribute("data-back-href") || "/app.html";
    const backLabel = document.body.getAttribute("data-back-label") || "Retour au dashboard";

    const actionsSrc = document.getElementById("bhHeaderActions");
    const customActions = actionsSrc ? actionsSrc.innerHTML : "";

    host.innerHTML = `
      <header class="main-header">
        <div class="header-left">
          <div class="page-kicker">${escapeHtml(kicker)}</div>
          <h1 class="page-title">${escapeHtml(title)}</h1>
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
    const mobileLogoText = document.querySelector(".mobile-logo-text");

    if (mobileLogoText) {
      const hasCorrectBranding = mobileLogoText.querySelector(".mobile-logo-title");
      if (!hasCorrectBranding) {
        mobileLogoText.innerHTML = BRAND_TEXT_HTML;
      }
    }

    if (mobileLogo) {
      const existingLogo = mobileLogo.querySelector("img, svg");

      const needsUpdate =
        !existingLogo ||
        (existingLogo.tagName.toLowerCase() === "img" &&
          !(existingLogo.getAttribute("src") || "").includes("boostinghost-icon-circle.png") || (existingLogo.getAttribute("src") || "").startsWith("data:image")) ||
        existingLogo.tagName.toLowerCase() === "svg";

      if (needsUpdate) {
        const oldIcon = mobileLogo.querySelector("i.fas, i.fa, i[class*='fa-'], svg, img");
        if (oldIcon) oldIcon.remove();

        mobileLogo.insertAdjacentHTML("afterbegin", LOGO_B_SVG);
      }
    }
  }

  function forceUpdateSidebarLogo() {
    const sidebarAnchors = document.querySelectorAll(".sidebar-logo");

    sidebarAnchors.forEach(a => {
      const existing = a.querySelector("img, svg");
      const isOkImg =
        existing &&
        existing.tagName.toLowerCase() === "img" &&
        ((existing.getAttribute("src") || "").includes("boostinghost-icon-circle.png") || (existing.getAttribute("src") || "").startsWith("data:image") ||
         (existing.src || "").includes("boostinghost-icon-circle.png") || (existing.getAttribute("src") || "").startsWith("data:image"));

      if (!isOkImg) {
        const old = a.querySelector("svg, img");
        if (old) old.remove();
        a.insertAdjacentHTML("afterbegin", LOGO_B_SVG);
      }
    });
  }


  function injectMobileTitle() {
    if (window.innerWidth > 768) return;
    if (document.getElementById('bh-mobile-page-title')) return;

    // Lire le titre depuis data-title ou page
    const page = document.body.getAttribute('data-page');
    let title = document.body.getAttribute('data-title');
    if (!title && page === 'app') title = 'Dashboard';
    if (!title) {
      const h1 = document.querySelector('h1.page-title');
      if (h1) title = h1.textContent.trim();
    }
    if (!title) return;

    // Trouver ou créer la mobile-header
    let mobileHeader = document.querySelector('.mobile-header');
    if (!mobileHeader) {
      // Créer une mobile-header avec logo si elle n'existe pas
      mobileHeader = document.createElement('div');
      mobileHeader.className = 'mobile-header';
      mobileHeader.innerHTML = '<a class="mobile-logo" href="/app.html" style="flex-shrink:0;display:flex;align-items:center;gap:10px;text-decoration:none;"><span class="mobile-logo-text"></span></a>';
      const appContainer = document.querySelector('.app-container') || document.querySelector('.main-content') || document.body;
      appContainer.parentNode.insertBefore(mobileHeader, appContainer);
      // Laisser normalizeBranding injecter le bon logo
      if (window.bhLayout && window.bhLayout.normalizeBranding) {
        setTimeout(function(){ window.bhLayout.normalizeBranding(); }, 50);
      }
    }

    // Forcer l'affichage (certaines pages ont display:none inline)
    mobileHeader.style.setProperty('display', 'flex', 'important');
    mobileHeader.style.setProperty('position', 'fixed', 'important');
    mobileHeader.style.setProperty('top', '0', 'important');
    mobileHeader.style.setProperty('left', '0', 'important');
    mobileHeader.style.setProperty('right', '0', 'important');
    mobileHeader.style.setProperty('height', 'calc(60px + env(safe-area-inset-top,0px))', 'important');
    mobileHeader.style.setProperty('z-index', '1100', 'important');
    mobileHeader.style.setProperty('align-items', 'center', 'important');
    mobileHeader.style.setProperty('justify-content', 'flex-start', 'important');
    mobileHeader.style.setProperty('padding', 'env(safe-area-inset-top,0px) 16px 0', 'important');
    mobileHeader.style.setProperty('gap', '12px', 'important');
    mobileHeader.style.setProperty('background', 'rgba(245,242,236,0.97)', 'important');
    mobileHeader.style.setProperty('backdrop-filter', 'blur(12px)', 'important');
    mobileHeader.style.setProperty('border-bottom', '1px solid rgba(200,184,154,0.4)', 'important');

    // Masquer le sous-titre "Smart Property Manager"
    const logoSubtitle = mobileHeader.querySelector('.mobile-logo-subtitle');
    if (logoSubtitle) logoSubtitle.style.display = 'none';

    // Injecter le titre après le logo
    const titleEl = document.createElement('span');
    titleEl.id = 'bh-mobile-page-title';
    titleEl.textContent = title;
    titleEl.style.cssText = 'font-family:"Instrument Serif",Georgia,serif;font-size:20px;font-weight:400;color:#0D1117;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;';

    const logo = mobileHeader.querySelector('.mobile-logo');
    if (logo) {
      logo.after(titleEl);
    } else {
      mobileHeader.appendChild(titleEl);
    }

    // S'assurer que le contenu principal est décalé vers le bas
    const mainContent = document.querySelector('.main-content');
    if (mainContent && !mainContent.style.paddingTop) {
      mainContent.style.setProperty('padding-top', 'calc(60px + env(safe-area-inset-top,0px))', 'important');
    }
  }

  function init() {
    console.log("🚀 bh-layout.js - Initialisation avec filtrage permissions...");
    
    injectSidebar();
    injectHeader();
    normalizeBranding();
    injectMobileTitle();
    
    setTimeout(() => {
      normalizeBranding();
      forceUpdateSidebarLogo();
      injectMobileTitle();
    }, 100);
    
    setTimeout(() => {
      forceUpdateSidebarLogo();
      normalizeBranding();
    }, 500);
    
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
    forceUpdateSidebarLogo
  };

})();

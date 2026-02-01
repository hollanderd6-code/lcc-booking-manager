(function () {
  'use strict';

/* /js/bh-layout.js – injection sidebar + header avec filtrage permissions sous-comptes */
const LOGO_B_SVG = `<img src="/asset/boostinghost-icon-circle.png" alt="Boostinghost" style="width:40px;height:40px;flex-shrink:0;">`;

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
    <a class="sidebar-logo" href="/">
      <img src="/asset/boostinghost-icon-circle.png"
           alt="Boostinghost"
           style="width:40px;height:40px;flex-shrink:0;" />

      <div class="sidebar-logo-text" style="display:flex;flex-direction:column;justify-content:center;margin-left:10px;">
        <span class="sidebar-logo-title" style="font-family:'Inter',sans-serif;font-size:17px;line-height:1.1;">
          <span style="color:#10B981;font-weight:800;">Boosting</span>
          <span style="color:#111827;font-weight:600;">host</span>
        </span>
        <span class="sidebar-logo-subtitle" style="font-size:10px;color:#6B7280;font-weight:500;letter-spacing:0.5px;">
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

  <div class="sidebar-footer">
    <div class="user-profile">
      <div class="user-avatar" id="sidebarUserAvatar">C</div>
      <div class="user-info">
        <div class="user-name" id="sidebarUserName">Utilisateur</div>
        <div class="user-email" id="sidebarUserCompany">${isSubAccount ? 'Sous-compte' : 'Mon espace'}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-xs" id="logoutBtn">
        <i class="fas fa-sign-out-alt"></i>
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
          !(existingLogo.getAttribute("src") || "").includes("boostinghost-icon-circle.png")) ||
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
        ((existing.getAttribute("src") || "").includes("boostinghost-icon-circle.png") ||
         (existing.src || "").includes("boostinghost-icon-circle.png"));

      if (!isOkImg) {
        const old = a.querySelector("svg, img");
        if (old) old.remove();
        a.insertAdjacentHTML("afterbegin", LOGO_B_SVG);
      }
    });
  }

  function init() {
    console.log("🚀 bh-layout.js - Initialisation avec filtrage permissions...");
    
    injectSidebar();
    injectHeader();
    normalizeBranding();
    
    setTimeout(() => {
      normalizeBranding();
      forceUpdateSidebarLogo();
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

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
          !(existingLogo.getAttribute("src") || "").includes("boostinghost-icon-circle.png") || (existing.getAttribute("src") || "").startsWith("data:image")) ||
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

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

  const BRAND_TEXT_HTML = `<span class="mobile-logo-title" style="font-family:'DM Sans',sans-serif;font-size:17px;font-weight:700;color:#0D1117;display:inline-flex;align-items:baseline;">
    <span class="brand-boosting" style="color:#1A7A5E;font-weight:700;font-family:'DM Sans',sans-serif;">Boosting</span><span style="color:#111827;font-weight:700;font-family:'DM Sans',sans-serif;">host</span>
  </span>
  <span class="mobile-logo-subtitle" style="font-family:'DM Sans',sans-serif;font-size:10px;color:#7A8695;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Smart Property Manager</span>`;

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
        existingLogo.tagName.toLowerCase() === "svg" ||
        (existingLogo.tagName.toLowerCase() === "img" &&
          !(existingLogo.getAttribute("src") || "").includes("boostinghost-icon-circle.png") &&
          !(existingLogo.getAttribute("src") || "").startsWith("data:image"));

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
      mobileHeader.id = 'bhMobileHeader';
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

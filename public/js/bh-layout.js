(function () {
  'use strict';

/* /js/bh-layout.js – injection sidebar + header avec filtrage permissions sous-comptes */
const LOGO_B_SVG = `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAEuklEQVR4nO2dW2gUVxjH/7NsLsV1bcJGs7bRNltq3VDB9MFbBS94KTTUNx+sCbQUrNgq9U1BsMRAaR9a8EHEBIxSW4VSUVCapupTLArWqLSbQE3UTcLaxMRs3M3epg/LmM1m5z5z5pyZ+T1mz8z3nR/fuezZzSwHSlh8qJlX036orZMzKxc1WJKEWllKsUIqsYBmSRODlEzTg5AWV4zZIk27udXiijFLpOE3pU1cMUaLNOxmtIsrxiiRHiNuwpo8wLicdQtkUZ6AEblrLmOWxZVC65DWVIF2kwdo75NqgXaUJ6Clb6oE2lmegNo+KhboBHkCavqqSKCT5Ako7bMh+0AnIyvQidUnoKTvkgKdLE9AzoGoQFfeDFIu3DlQJyUFutU3FzEnbgXqZI5At/rEKeXGSyr45T1HsLIupOqabC6HRDqFF6lpxKcTGBx7ioejI3gw/Ah/9PUiNjluTrIqmHWEY2b1aREoBc/zuPPkX3x/7SK6I3cNu68SCo++mJ0DOY5DY10Inc1foePj/XilrNySPF4KZHnu27a8EWdaDsLDkfmYu9AVsxVYzJo330HLqs3E49pGIAB8tm478ZhegI7h+2T8P6z69uCsv3k4Dov8VQjX1uHAxo/QKLMILa2uwbKFryESi5qZKoC8s6G2To7qCszxPIYnxtAduYsdJ1vR8/Af2WtCNUECmc1AtcBCsrkcOnq6ZNsFfH4C2czAjEAAGJoYlW3DEf7GHlMCg/5q2TZRBZKNxEPDAqIED8ehZbX0NiWTzeL2YD+hjPILCbH3wlrgOA41vgUI19bhiw1NWP3GMsn2v/bexHhiilB2eagR+PqrAUSPndZ8/cjzZ2i9+rOBGSmDGoF66ItF8cnZH/A0PkE8NvMC23u60Hr1J6QyGUviM7UKl+LTNVvQvms/6gO1lsRnXiAAbHp7Ba7sPYr1oQbisW0hEAB8FZU4tetLvEX4rRw1c2CpwwQAqPCWodZfhbX1y/H5+g8QCogL8lVU4lhTM3Z2fGNmqrOgvgKnM2kMjsVw7vYNbD1+BH8ORCTbvx8KoyG4hFB2DAgsJJlO4fClM7LttoffI5BNHqYEAsDfI48Rm5Te7727eCmhbAAPLf/1qIbxRFzy9RrfAiJ5UH+gKkb1vPmSr3OEPlwCGBzCDcElCMyTPjQdjT8nlA1jAivLytHatFu2HckzQWr2gWKUe70I+quwtj4suw8UuN5/n0BmebxAfjK0+mBV73GWwERiCjf67xmQkTTC4svUEFZC228XkEiniMWzlcCLvTfx463rRGO+FMjiflAgx/No7+nCvvMnkOPNn4kKXVG/iEiRzmZwre8evuv+BQ+GH1mSwyyBNCwmxfA8j2QmjalUEvFkAgNjMfTFouiNDuD3yF+YTCaI5lM8UolV4IcnviYViihzFhGW50KzKeXGVquwFZQU6FbhXMScuBWoE1GBbhXOIOVCsgJdifIOZIewkyUq6bs7B+pEkUAnVqHSPiuuQCdJVNNXVUPYCRLV9lH1HGhniVr6pmkRsaNErX3SLYK24y+16C0G3dsYlqvRiNwN2QeyKNGonN2H0OrEfQyyTtwHcevEfRS8TtwfI9AJNasnqz+H8T/uxKqvAzbbVAAAAABJRU5ErkJggg==" alt="Boostinghost" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover;">`;

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
      <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAYAAACOEfKtAAAEuklEQVR4nO2dW2gUVxjH/7NsLsV1bcJGs7bRNltq3VDB9MFbBS94KTTUNx+sCbQUrNgq9U1BsMRAaR9a8EHEBIxSW4VSUVCapupTLArWqLSbQE3UTcLaxMRs3M3epg/LmM1m5z5z5pyZ+T1mz8z3nR/fuezZzSwHSlh8qJlX036orZMzKxc1WJKEWllKsUIqsYBmSRODlEzTg5AWV4zZIk27udXiijFLpOE3pU1cMUaLNOxmtIsrxiiRHiNuwpo8wLicdQtkUZ6AEblrLmOWxZVC65DWVIF2kwdo75NqgXaUJ6Clb6oE2lmegNo+KhboBHkCavqqSKCT5Ako7bMh+0AnIyvQidUnoKTvkgKdLE9AzoGoQFfeDFIu3DlQJyUFutU3FzEnbgXqZI5At/rEKeXGSyr45T1HsLIupOqabC6HRDqFF6lpxKcTGBx7ioejI3gw/Ah/9PUiNjluTrIqmHWEY2b1aREoBc/zuPPkX3x/7SK6I3cNu68SCo++mJ0DOY5DY10Inc1foePj/XilrNySPF4KZHnu27a8EWdaDsLDkfmYu9AVsxVYzJo330HLqs3E49pGIAB8tm478ZhegI7h+2T8P6z69uCsv3k4Dov8VQjX1uHAxo/QKLMILa2uwbKFryESi5qZKoC8s6G2To7qCszxPIYnxtAduYsdJ1vR8/Af2WtCNUECmc1AtcBCsrkcOnq6ZNsFfH4C2czAjEAAGJoYlW3DEf7GHlMCg/5q2TZRBZKNxEPDAqIED8ehZbX0NiWTzeL2YD+hjPILCbH3wlrgOA41vgUI19bhiw1NWP3GMsn2v/bexHhiilB2eagR+PqrAUSPndZ8/cjzZ2i9+rOBGSmDGoF66ItF8cnZH/A0PkE8NvMC23u60Hr1J6QyGUviM7UKl+LTNVvQvms/6gO1lsRnXiAAbHp7Ba7sPYr1oQbisW0hEAB8FZU4tetLvEX4rRw1c2CpwwQAqPCWodZfhbX1y/H5+g8QCogL8lVU4lhTM3Z2fGNmqrOgvgKnM2kMjsVw7vYNbD1+BH8ORCTbvx8KoyG4hFB2DAgsJJlO4fClM7LttoffI5BNHqYEAsDfI48Rm5Te7727eCmhbAAPLf/1qIbxRFzy9RrfAiJ5UH+gKkb1vPmSr3OEPlwCGBzCDcElCMyTPjQdjT8nlA1jAivLytHatFu2HckzQWr2gWKUe70I+quwtj4suw8UuN5/n0BmebxAfjK0+mBV73GWwERiCjf67xmQkTTC4svUEFZC228XkEiniMWzlcCLvTfx463rRGO+FMjiflAgx/No7+nCvvMnkOPNn4kKXVG/iEiRzmZwre8evuv+BQ+GH1mSwyyBNCwmxfA8j2QmjalUEvFkAgNjMfTFouiNDuD3yF+YTCaI5lM8UolV4IcnviYViihzFhGW50KzKeXGVquwFZQU6FbhXMScuBWoE1GBbhXOIOVCsgJdifIOZIewkyUq6bs7B+pEkUAnVqHSPiuuQCdJVNNXVUPYCRLV9lH1HGhniVr6pmkRsaNErX3SLYK24y+16C0G3dsYlqvRiNwN2QeyKNGonN2H0OrEfQyyTtwHcevEfRS8TtwfI9AJNasnqz+H8T/uxKqvAzbbVAAAAABJRU5ErkJggg==" alt="Boostinghost" style="width:36px;height:36px;min-width:36px;border-radius:50%;flex-shrink:0;object-fit:cover;">
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
    <span style="color:#1A7A5E; font-weight:800;">Boosting</span><span style="color:#111827; font-weight:600;">host</span>
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

/* /js/bh-layout.js – injection sidebar + header standard */
(function () {
  const SIDEBAR_HTML = `<aside class="sidebar">
<div class="sidebar-header">
<a class="sidebar-logo" href="/">
<svg fill="none" height="40" style="flex-shrink:0;" viewbox="0 0 40 40" width="40" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="bhg-sidebar" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#7fd3a6"/>
<stop offset="1" stop-color="#58b88c"/>
</linearGradient>
</defs>
<circle cx="20" cy="20" r="20" fill="url(#bhg-sidebar)"/>
<text x="20" y="26" text-anchor="middle" font-family="Inter, system-ui, -apple-system, Segoe UI, Arial" font-size="20" font-weight="800" fill="#ffffff">B</text>
</svg>
<div class="sidebar-logo-text" style="display: flex; flex-direction: column; justify-content: center; margin-left: 10px;">
<span class="sidebar-logo-title" style="font-family: 'Inter', sans-serif; font-size: 17px; line-height: 1.1;">
<span style="color: #10B981; font-weight: 800;">Boosting</span><span style="color: #111827; font-weight: 600;">host</span>
</span>
<span class="sidebar-logo-subtitle" style="font-size: 10px; color: #6B7280; font-weight: 500; letter-spacing: 0.5px;">
      Smart Property Manager
    </span>
</div>
</a>
</div>
<nav class="sidebar-nav">
<!-- PRINCIPAL -->
<div class="nav-section">
<div class="nav-section-title">Principal</div>
<a class="nav-item active" data-page="app" href="/app.html">
<i class="fas fa-th-large"></i>
<span>Dashboard</span>
</a>
<a class="nav-item" href="/app.html#calendarSection" id="navCalendarLink">
<i class="fas fa-calendar"></i>
<span>Calendrier</span>
</a>
<a class="nav-item" data-page="messages" href="/messages.html">
<i class="fas fa-comment-dots"></i>
<span>Messages</span>
</a>
</div>
<!-- GESTION -->
<div class="nav-section">
<div class="nav-section-title">Gestion</div>
<a class="nav-item" data-page="settings" href="/settings.html">
<i class="fas fa-home"></i>
<span>Mes logements</span>
</a>
<a class="nav-item" data-page="welcome" href="/welcome.html">
<i class="fas fa-book-open"></i>
<span>Livret d'accueil</span>
</a>
<a class="nav-item" data-page="cleaning" href="/cleaning.html">
<i class="fas fa-broom"></i>
<span>Gestion du ménage</span>
</a>
<div class="nav-section">
<div class="nav-section-title">Facturation</div>
<a class="nav-item" href="/factures.html">
<i class="fas fa-file-invoice"></i>
<span>Factures clients</span>
</a>
<a class="nav-item" href="/factures-proprietaires.html">
<i class="fas fa-file-invoice-dollar"></i>
<span>Factures propriétaires</span>
</a>
</div>
<a class="nav-item" data-page="deposits" href="/deposits.html">
<i class="fas fa-shield-alt"></i>
<span>Cautions</span>
</a>
<a class="nav-item" data-page="notifications" href="/notifications.html">
<i class="fas fa-bell"></i>
<span>Notifications</span>
</a>
</div>
<!-- PARAMÈTRES -->
<div class="nav-section">
<div class="nav-section-title">Paramètres</div>
<a class="nav-item" data-page="settings-account" href="/settings-account.html">
<i class="fas fa-cog"></i>
<span>Paramètres</span>
</a>
<a class="nav-item" data-page="help" href="/help.html">
<i class="fas fa-question-circle"></i>
<span>Aide</span>
</a>
</div>
</nav>
<div class="sidebar-footer">
<div class="user-profile">
<div class="user-avatar" id="sidebarUserAvatar">C</div>
<div class="user-info">
<div class="user-name" id="sidebarUserName">Utilisateur</div>
<div class="user-email" id="sidebarUserCompany">Mon espace</div>
</div>
<button type="button" class="btn btn-ghost btn-xs" id="logoutBtn">
<i class="fas fa-sign-out-alt"></i>
</button>
</div>
</div>
</aside>`;

  function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  function injectSidebar() {
    const ph = document.getElementById("bhSidebar");
    if (!ph) return;

    ph.innerHTML = SIDEBAR_HTML;
    
    // Active link based on body[data-page]
    const page = document.body?.dataset?.page;

    // 1) Active by data-page (preferred)
    if (page) {
      document.querySelectorAll(".nav-item.active").forEach(a => a.classList.remove("active"));
      const match = document.querySelector(`.nav-item[data-page="${page}"]`);
      if (match) match.classList.add("active");
    }

    // 2) Fallback: active by URL (useful for links without data-page, ex: factures)
    const currentPath = (window.location.pathname || "").toLowerCase();
    if (currentPath) {
      const byHref = Array.from(document.querySelectorAll(".nav-item[href]"))
        .find(a => (a.getAttribute("href") || "").toLowerCase() === currentPath);
      if (byHref) {
        document.querySelectorAll(".nav-item.active").forEach(a => a.classList.remove("active"));
        byHref.classList.add("active");
      }
    }

    // Mobile menu toggle (works if elements exist)
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

    // ✅ BOUTON DÉCONNEXION : Attacher l'event listener après injection
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log("🚪 Déconnexion...");
        localStorage.removeItem("lcc_token");
        localStorage.removeItem("lcc_user");
        window.location.href = "/login.html";
      });
      console.log("✅ Bouton déconnexion configuré dans bh-layout.js");
    }

    // ✅ INFOS UTILISATEUR : Remplir nom, avatar, company
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
  }

  function injectHeader() {
    const host = document.getElementById("bhHeader");
    if (!host) return;

    const kicker = document.body.getAttribute("data-kicker") || "Gestion";
    const title = document.body.getAttribute("data-title") || document.title || "Page";
    const subtitle = document.body.getAttribute("data-subtitle") || "";
    const backHref = document.body.getAttribute("data-back-href") || "/app.html";
    const backLabel = document.body.getAttribute("data-back-label") || "Retour au dashboard";

    // Optional custom actions (provided per-page)
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
    // Logo SVG "B" à réutiliser
    const brandSvg = `
      <svg class="mobile-logo-mark" width="40" height="40" viewBox="0 0 40 40"
           xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
        <defs>
          <linearGradient id="bhg-mobile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#7fd3a6"/>
            <stop offset="1" stop-color="#58b88c"/>
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="20" fill="url(#bhg-mobile)"/>
        <text x="20" y="26" text-anchor="middle"
              font-family="Inter, system-ui, -apple-system, Segoe UI, Arial"
              font-size="20" font-weight="800" fill="#ffffff">B</text>
      </svg>
    `;

    // Mobile header brand
    const mobileLogo = document.querySelector(".mobile-logo");
    const mobileLogoText = document.querySelector(".mobile-logo-text");

    // 1. Remplacer le texte du logo mobile
    if (mobileLogoText) {
      mobileLogoText.innerHTML = `
        <span class="mobile-logo-title">
          <span style="color:#10B981; font-weight:800;">Boosting</span><span style="color:#111827; font-weight:600;">host</span>
        </span>
        <span class="mobile-logo-subtitle">SMART PROPERTY MANAGER</span>
      `;
    }

    // 2. Remplacer l'icône/SVG du logo mobile par le logo "B"
    if (mobileLogo) {
      // Supprimer toutes les icônes Font Awesome existantes
      const oldIcon = mobileLogo.querySelector("i.fas, i.fa");
      if (oldIcon) {
        oldIcon.remove();
      }

      // Supprimer tous les SVG existants sauf celui avec la classe .mobile-logo-mark
      const existingSvgs = mobileLogo.querySelectorAll("svg:not(.mobile-logo-mark)");
      existingSvgs.forEach(svg => svg.remove());

      // Ajouter le nouveau logo "B" s'il n'existe pas déjà
      if (!mobileLogo.querySelector(".mobile-logo-mark")) {
        mobileLogo.insertAdjacentHTML("afterbegin", brandSvg);
      }
    }

    // 3. Sidebar brand title (si nécessaire)
    const sidebarTitle = document.querySelector(".sidebar-logo-title");
    if (sidebarTitle && !sidebarTitle.querySelector('span[style*="color:#10B981"]')) {
      sidebarTitle.innerHTML = '<span style="color:#10B981; font-weight:800;">Boosting</span><span style="color:#111827; font-weight:600;">host</span>';
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    injectSidebar();
    injectHeader();
    normalizeBranding();
  });
})();

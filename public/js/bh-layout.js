/* /js/bh-layout.js — injection sidebar + header standard */

(function () {
    function escapeHtml(str) {
    return (str || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  
async function injectSidebar() {
    const ph = document.getElementById("bhSidebar");
    if (!ph) return;

    try {
      const res = await fetch("/partials/bh-sidebar.html", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ph.innerHTML = await res.text();
    } catch (e) {
      console.error("Erreur chargement sidebar", e);
      return;
    }

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
  // Mobile header brand
  const mobileLogo = document.querySelector(".mobile-logo");
  const mobileLogoText = document.querySelector(".mobile-logo-text");

  // Texte (Boosting/host + sous-titre) — n'écrase pas si déjà en place
  if (mobileLogoText && !mobileLogoText.querySelector(".mobile-logo-subtitle")) {
    mobileLogoText.innerHTML = `
      <span class="mobile-logo-title">
        <span style="color:#10B981; font-weight:800;">Boosting</span><span style="color:#111827; font-weight:600;">host</span>
      </span>
      <span class="mobile-logo-subtitle">SMART PROPERTY MANAGER</span>
    `;
  }

  // Logo (remplace l'icône existante / ancien SVG / injecte si rien)
  if (mobileLogo) {
    const brandSvg = `
      <svg class="mobile-logo-mark" width="40" height="40" viewBox="0 0 40 40"
           xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
        <defs>
          <linearGradient id="bhg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#7fd3a6"/>
            <stop offset="1" stop-color="#58b88c"/>
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="20" fill="url(#bhg)"/>
        <text x="20" y="26" text-anchor="middle"
              font-family="Inter, system-ui, -apple-system, Segoe UI, Arial"
              font-size="20" font-weight="800" fill="#ffffff">B</text>
      </svg>
    `;

    const oldIcon = mobileLogo.querySelector("i.fas, i.fa");
    const anySvg = mobileLogo.querySelector("svg");
    const anyImg = mobileLogo.querySelector("img");

    if (oldIcon) {
      oldIcon.outerHTML = brandSvg;
    } else if (anySvg && !anySvg.classList.contains("mobile-logo-mark")) {
      anySvg.outerHTML = brandSvg;
    } else if (!anyImg && !anySvg) {
      mobileLogo.insertAdjacentHTML("afterbegin", brandSvg);
    }
  }

  // Sidebar brand title if needed
  const sidebarTitle = document.querySelector(".sidebar-logo-title");
  if (sidebarTitle) {
    sidebarTitle.innerHTML = '<span style="color:#10B981; font-weight:800;">Boosting</span><span style="color:#111827; font-weight:600;">host</span>';
  }
}

document.addEventListener("DOMContentLoaded", () => {
    injectSidebar();
    injectHeader();
    normalizeBranding();
  });
})();

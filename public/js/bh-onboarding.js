/* ============================================================
   BOOSTINGHOST — Onboarding Tour v5
   Approche : clone flottant de l'élément ciblé
   <script src="/js/bh-onboarding.js"></script> avant </body>
   ============================================================ */

(function () {
  const STORAGE_KEY = 'bh_onboarding_done_v1';
  const IS_MOBILE   = () => window.innerWidth <= 1366;

  const STEPS = [
    {
      id: 'welcome',
      target: null,
      title: '👋 Bienvenue sur Boostinghost !',
      text: 'Faisons un rapide tour de votre espace de gestion. Cela prend moins de 2 minutes.',
      position: 'center',
    },
    {
      id: 'kpi',
      target: () => document.getElementById('kpiPropertiesCard'),
      mobile_target: () => document.getElementById('kpiPropertiesCard'),
      title: '📊 Tableau de bord',
      text: 'En un coup d\'œil : logements actifs, arrivées/départs du jour, nettoyages à venir et chiffre d\'affaires.',
      position: 'bottom',
      mobile_position: 'bottom',
    },
    {
      id: 'new-reservation',
      target: () => document.getElementById('newReservationBtn'),
      mobile_target: () => document.getElementById('fabAddResa'),
      title: '➕ Nouvelle réservation',
      text: 'Ajoutez manuellement une réservation pour vos clients directs, sans passer par une plateforme.',
      position: 'bottom',
      mobile_position: 'top',
    },
    {
      id: 'calendar',
      target: () => document.getElementById('calendarSection'),
      mobile_target: () => document.querySelector('.tab-btn[data-tab="calendar"]'),
      title: '📅 Calendrier',
      text: 'Visualisez toutes vos réservations par logement. Cliquez sur une réservation pour accéder aux détails, messages et caution.',
      position: 'center',
      mobile_position: 'top',
    },
    {
      id: 'nav-messages',
      target: () => document.querySelector('.nav-item[data-page="messages"]'),
      mobile_target: () => document.querySelector('.tab-btn[data-tab="messages"]'),
      title: '💬 Messagerie',
      text: 'Centralisez tous vos échanges avec les voyageurs. L\'IA rédige des réponses adaptées pour vous faire gagner du temps.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'nav-settings',
      target: () => document.querySelector('.nav-item[data-page="settings"]'),
      mobile_target: () => document.querySelector('.tab-btn[data-tab="properties"]'),
      title: '🏠 Mes logements',
      text: 'Configurez chaque logement : photos, horaires, caution, et connectez vos plateformes Airbnb, Booking.com via Channex.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'nav-welcome',
      target: () => document.querySelector('.nav-item[data-page="welcome"]'),
      mobile_target: () => findSheetBtn('welcome.html'),
      mobile_sheet: true,
      title: '📖 Livrets d\'accueil',
      text: 'Créez et personnalisez vos livrets d\'accueil numériques. Vos voyageurs y retrouvent toutes les informations du logement.',
      position: 'right',
    },
    {
      id: 'nav-contrat',
      target: () => document.querySelector('.nav-item[data-page="contrat"]'),
      mobile_target: () => findSheetBtn('contrat.html'),
      mobile_sheet: true,
      title: '📝 Contrats',
      text: 'Générez et envoyez vos mandats de gestion et contrats de location directement depuis l\'app.',
      position: 'right',
    },
    {
      id: 'nav-cleaning',
      target: () => document.querySelector('.nav-item[data-page="cleaning"]'),
      mobile_target: () => findSheetBtn('cleaning.html'),
      mobile_sheet: true,
      title: '🧹 Gestion du ménage',
      text: 'Planifiez les ménages, assignez vos prestataires et suivez les interventions entre chaque séjour.',
      position: 'right',
    },
    {
      id: 'nav-deposits',
      target: () => document.querySelector('.nav-item[data-page="deposits"]'),
      mobile_target: () => findSheetBtn('deposits.html'),
      mobile_sheet: true,
      title: '💰 Finances',
      text: 'Gérez les cautions et paiements directs de vos voyageurs. Suivez les encaissements et remboursements.',
      position: 'right',
    },
    {
      id: 'nav-factures',
      target: () => document.querySelector('.nav-item[data-page="factures"]'),
      mobile_target: () => findSheetBtn('factures.html'),
      mobile_sheet: true,
      title: '🧾 Factures séjours',
      text: 'Générez automatiquement les factures pour chaque séjour et envoyez-les à vos voyageurs.',
      position: 'right',
    },
    {
      id: 'nav-clients',
      target: () => document.querySelector('.nav-item[data-page="clients"]'),
      mobile_target: () => findSheetBtn('clients.html'),
      mobile_sheet: true,
      title: '👥 Mes Clients',
      text: 'Retrouvez la fiche de chaque voyageur avec son historique de séjours, ses coordonnées et ses préférences.',
      position: 'right',
    },
    {
      id: 'nav-reporting',
      target: () => document.querySelector('.nav-item[data-page="reporting"]'),
      mobile_target: () => findSheetBtn('reporting.html'),
      mobile_sheet: true,
      title: '📈 Revenus',
      text: 'Suivez vos performances par logement, comparez les périodes et exportez vos données comptables.',
      position: 'right',
    },
    {
      id: 'done',
      target: null,
      title: '🎉 Vous êtes prêt !',
      text: 'Commencez par ajouter votre premier logement. Vous pouvez revoir ce tour depuis vos Paramètres.',
      position: 'center',
      isLast: true,
    },
  ];

  /* ── Trouver un bouton dans le sheet ──────────────────── */
  function findSheetBtn(href) {
    const sheet = document.getElementById('moreMenuSheet');
    if (!sheet) return null;
    const btns = sheet.querySelectorAll('button');
    for (const btn of btns) {
      if ((btn.getAttribute('onclick') || '').includes(href)) return btn;
    }
    return null;
  }

  /* ── État ─────────────────────────────────────────────── */
  let currentStep = 0;
  let overlayEl, bubbleEl, cloneEl;
  let sheetOpen = false;

  /* ── Styles ───────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('bh-tour-style')) return;
    const s = document.createElement('style');
    s.id = 'bh-tour-style';
    s.textContent = `
      #bh-tour-overlay {
        position: fixed; inset: 0; z-index: 100000;
        background: rgba(13,17,23,0.75);
        pointer-events: none;
      }
      #bh-tour-clone-wrap {
        position: fixed; z-index: 100002;
        pointer-events: none;
        border-radius: 14px;
        outline: 3px solid #1A7A5E;
        outline-offset: 4px;
        box-shadow: 0 0 0 4px rgba(26,122,94,0.25), 0 8px 32px rgba(0,0,0,0.3);
        overflow: hidden;
        transition: top .3s ease, left .3s ease, width .3s ease, height .3s ease;
      }
      #bh-tour-clone-wrap img { pointer-events: none; }
      #bh-tour-bubble {
        position: fixed; z-index: 100003;
        background: #fff; border-radius: 16px;
        padding: 20px 22px 16px;
        width: min(320px, calc(100vw - 32px));
        box-shadow: 0 8px 40px rgba(0,0,0,.25);
        font-family: 'DM Sans', sans-serif;
        pointer-events: all;
      }
      .t-badge { font-size:11px;font-weight:700;color:#1A7A5E;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;opacity:.7; }
      .t-title { font-size:15px;font-weight:700;color:#111827;margin-bottom:7px;line-height:1.3; }
      .t-text  { font-size:13px;color:#4B5563;line-height:1.55;margin-bottom:16px; }
      .t-footer{ display:flex;align-items:center;justify-content:space-between;gap:8px; }
      .t-dots  { display:flex;gap:4px;align-items:center;flex-wrap:wrap;max-width:110px; }
      .t-dot   { width:5px;height:5px;border-radius:50%;background:#E5E7EB;flex-shrink:0;transition:background .2s,transform .2s; }
      .t-dot.on{ background:#1A7A5E;transform:scale(1.3); }
      .t-actions{ display:flex;gap:8px;align-items:center;flex-shrink:0; }
      .t-skip { background:none;border:none;font-size:12px;color:#9CA3AF;cursor:pointer;font-family:'DM Sans',sans-serif;padding:4px 8px;border-radius:6px; }
      .t-next { background:#1A7A5E;color:#fff;border:none;border-radius:10px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;display:flex;align-items:center;gap:6px;white-space:nowrap;transition:background .15s; }
      .t-next:hover { background:#15624B; }
      .t-finish { background:linear-gradient(135deg,#1A7A5E,#2AAE86) !important; }
      .t-arrow { position:absolute;width:14px;height:14px;background:#fff;pointer-events:none; }

      @media (max-width: 1366px) {
        #bh-tour-bubble {
          left: 16px !important; right: 16px !important;
          width: auto !important; transform: none !important;
        }
        .t-arrow { display: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Créer DOM ────────────────────────────────────────── */
  function createDOM() {
    overlayEl = document.createElement('div');
    overlayEl.id = 'bh-tour-overlay';

    bubbleEl = document.createElement('div');
    bubbleEl.id = 'bh-tour-bubble';

    document.body.appendChild(overlayEl);
    document.body.appendChild(bubbleEl);
  }

  /* ── Clone flottant de l'élément ciblé ───────────────── */
  function showClone(targetEl) {
    removeClone();
    if (!targetEl) return;

    const r = targetEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    cloneEl = document.createElement('div');
    cloneEl.id = 'bh-tour-clone-wrap';
    cloneEl.style.cssText = `
      top: ${r.top}px;
      left: ${r.left}px;
      width: ${r.width}px;
      height: ${r.height}px;
    `;

    // Cloner le contenu visuel
    const inner = targetEl.cloneNode(true);
    inner.style.cssText = `
      width: ${r.width}px;
      height: ${r.height}px;
      pointer-events: none;
      display: block;
    `;
    // Supprimer les onclick du clone pour éviter tout déclenchement
    inner.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));

    cloneEl.appendChild(inner);
    document.body.appendChild(cloneEl);
  }

  function removeClone() {
    const old = document.getElementById('bh-tour-clone-wrap');
    if (old) old.remove();
    cloneEl = null;
  }

  /* ── Positionner la bulle desktop ─────────────────────── */
  function positionDesktop(targetEl, position) {
    const margin = 20, bW = 320;
    const bH = bubbleEl.offsetHeight || 220;
    bubbleEl.querySelectorAll('.t-arrow').forEach(a => a.remove());

    if (!targetEl || position === 'center') {
      bubbleEl.style.cssText += 'top:50%;left:50%;transform:translate(-50%,-50%);right:auto;bottom:auto;';
      return;
    }

    bubbleEl.style.transform = '';
    const r = targetEl.getBoundingClientRect();
    const arrow = document.createElement('div');
    arrow.className = 't-arrow';
    let top, left;

    if (position === 'bottom') {
      top = r.bottom + 16; left = r.left + r.width/2 - bW/2;
      arrow.style.cssText = 'top:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-top:1px solid #f3f4f6;border-left:1px solid #f3f4f6;';
    } else if (position === 'top') {
      top = r.top - bH - 16; left = r.left + r.width/2 - bW/2;
      arrow.style.cssText = 'bottom:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-bottom:1px solid #f3f4f6;border-right:1px solid #f3f4f6;';
    } else if (position === 'right') {
      left = r.right + 16; top = r.top + r.height/2 - bH/2;
      arrow.style.cssText = 'left:-7px;top:50%;transform:translateY(-50%) rotate(45deg);border-left:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;';
    } else {
      top = r.bottom + 16; left = r.left + r.width/2 - bW/2;
    }

    left = Math.max(margin, Math.min(left, window.innerWidth - bW - margin));
    top  = Math.max(margin, Math.min(top, window.innerHeight - bH - margin));
    bubbleEl.style.top = top+'px'; bubbleEl.style.left = left+'px';
    bubbleEl.style.right = 'auto'; bubbleEl.style.bottom = 'auto';
    bubbleEl.appendChild(arrow);
  }

  /* ── Positionner la bulle mobile ──────────────────────── */
  function positionMobile(targetEl) {
    bubbleEl.querySelectorAll('.t-arrow').forEach(a => a.remove());
    if (!targetEl) {
      bubbleEl.style.top = '50%'; bubbleEl.style.bottom = 'auto';
      bubbleEl.style.transform = 'translateY(-50%)';
      return;
    }
    bubbleEl.style.transform = '';
    const r = targetEl.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (mid > window.innerHeight / 2) {
      // Élément en bas → bulle au-dessus de la bottom bar
      bubbleEl.style.bottom = '90px'; bubbleEl.style.top = 'auto';
    } else {
      // Élément en haut → bulle en dessous
      bubbleEl.style.top = '80px'; bubbleEl.style.bottom = 'auto';
    }
  }

  /* ── Scroll sidebar desktop ───────────────────────────── */
  function scrollSidebar(el) {
    if (!el) return;
    const sidebar = document.querySelector('.sidebar-nav, aside nav, #bhSidebar nav, #bhSidebar');
    if (!sidebar) return;
    const sR = sidebar.getBoundingClientRect(), eR = el.getBoundingClientRect();
    sidebar.scrollTo({ top: sidebar.scrollTop + (eR.top - sR.top) - sidebar.clientHeight/2 + eR.height/2, behavior: 'smooth' });
  }

  /* ── Ouvrir le menu Plus ──────────────────────────────── */
  function isSheetVisible() {
    const s = document.getElementById('moreMenuSheet');
    if (!s) return false;
    const t = s.style.transform;
    return t === 'translateY(0)' || t === 'translateY(0px)';
  }

  function ensureSheetOpen() {
    return new Promise(resolve => {
      if (isSheetVisible()) { resolve(); return; }
      const btn = document.querySelector('.tab-btn[data-tab="more"]');
      if (btn) { btn.click(); sheetOpen = true; setTimeout(resolve, 650); }
      else resolve();
    });
  }

  /* ── Contenu HTML de la bulle ─────────────────────────── */
  function renderBubble(step, index) {
    const total = STEPS.length, isLast = step.isLast || index === total-1;
    bubbleEl.innerHTML = `
      <div class="t-badge">Étape ${index+1} sur ${total}</div>
      <div class="t-title">${step.title}</div>
      <div class="t-text">${step.text}</div>
      <div class="t-footer">
        <div class="t-dots">${STEPS.map((_,i)=>`<div class="t-dot ${i===index?'on':''}"></div>`).join('')}</div>
        <div class="t-actions">
          ${!isLast?`<button class="t-skip" onclick="window.__bhTour.skip()">Passer</button>`:''}
          <button class="t-next ${isLast?'t-finish':''}" onclick="window.__bhTour.next()">
            ${isLast?'<i class="fas fa-check"></i> Terminer':'Suivant <i class="fas fa-arrow-right"></i>'}
          </button>
        </div>
      </div>`;
  }

  /* ── Rendre une étape ──────────────────────────────────── */
  async function renderStep(index) {
    const step   = STEPS[index];
    const mobile = IS_MOBILE();
    const isSheet = mobile && step.mobile_sheet;

    removeClone();

    // Gérer le sheet
    if (isSheet) {
      await ensureSheetOpen();
    } else if (sheetOpen) {
      if (window.closeMoreMenu) window.closeMoreMenu();
      sheetOpen = false;
      await new Promise(r => setTimeout(r, 300));
    }

    // Résoudre la cible
    const targetEl = mobile
      ? (step.mobile_target ? step.mobile_target() : null)
      : (step.target ? step.target() : null);

    const position = mobile
      ? (step.mobile_position || step.position || 'top')
      : step.position;

    // Contenu bulle
    renderBubble(step, index);

    // Attendre le paint puis cloner + positionner
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!mobile) {
        scrollSidebar(targetEl);
        setTimeout(() => {
          showClone(targetEl);
          positionDesktop(targetEl, position);
        }, 360);
      } else {
        showClone(targetEl);
        positionMobile(targetEl);
      }
    }));
  }

  /* ── Lifecycle ─────────────────────────────────────────── */
  function start() {
    ['bh-tour-overlay','bh-tour-bubble','bh-tour-clone-wrap'].forEach(id => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    injectStyles();
    createDOM();
    // Cacher FAB
    const fab = document.getElementById('fabAddResa');
    if (fab) fab.style.setProperty('display','none','important');
    currentStep = 0;
    renderStep(0);
  }

  function next() {
    currentStep++;
    if (currentStep >= STEPS.length) finish();
    else renderStep(currentStep);
  }

  function finish() {
    localStorage.setItem(STORAGE_KEY, '1');
    if (sheetOpen && window.closeMoreMenu) window.closeMoreMenu();
    removeClone();
    ['bh-tour-overlay','bh-tour-bubble'].forEach(id => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    // Restaurer FAB
    const fab = document.getElementById('fabAddResa');
    if (fab) fab.style.removeProperty('display');
    overlayEl = bubbleEl = null; sheetOpen = false;
  }

  function skip() { finish(); }

  window.__bhTour = { next, skip, start, finish };

  /* ── Auto-start ────────────────────────────────────────── */
  function maybeStart() {
    if (localStorage.getItem(STORAGE_KEY)) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const ready = IS_MOBILE()
        ? document.querySelector('.tab-btn[data-tab="dashboard"]')
        : document.querySelector('.nav-item[data-page="settings"]');
      if (ready || tries > 30) { clearInterval(t); setTimeout(start, 700); }
    }, 200);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', maybeStart)
    : maybeStart();

})();

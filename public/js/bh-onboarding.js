/* ============================================================
   BOOSTINGHOST — Onboarding Tour v4
   <script src="/js/bh-onboarding.js"></script> avant </body>
   ============================================================ */

(function () {
  const STORAGE_KEY = 'bh_onboarding_done_v1';
  const IS_MOBILE   = () => window.innerWidth <= 1366;

  /* ─────────────────────────────────────────────────────────
     ÉTAPES
     mobile_target : fonction qui retourne l'élément sur mobile
     mobile_sheet  : ouvrir le menu Plus avant de chercher la cible
  ───────────────────────────────────────────────────────── */
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
      position: 'top',
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
      mobile_position: 'top',
    },
    {
      id: 'nav-contrat',
      target: () => document.querySelector('.nav-item[data-page="contrat"]'),
      mobile_target: () => findSheetBtn('contrat.html'),
      mobile_sheet: true,
      title: '📝 Contrats',
      text: 'Générez et envoyez vos mandats de gestion et contrats de location directement depuis l\'app.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'nav-cleaning',
      target: () => document.querySelector('.nav-item[data-page="cleaning"]'),
      mobile_target: () => findSheetBtn('cleaning.html'),
      mobile_sheet: true,
      title: '🧹 Gestion du ménage',
      text: 'Planifiez les ménages, assignez vos prestataires et suivez les interventions entre chaque séjour.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'nav-deposits',
      target: () => document.querySelector('.nav-item[data-page="deposits"]'),
      mobile_target: () => findSheetBtn('deposits.html'),
      mobile_sheet: true,
      title: '💰 Finances',
      text: 'Gérez les cautions et paiements directs de vos voyageurs. Suivez les encaissements et remboursements.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'nav-factures',
      target: () => document.querySelector('.nav-item[data-page="factures"]'),
      mobile_target: () => findSheetBtn('factures.html'),
      mobile_sheet: true,
      title: '🧾 Factures séjours',
      text: 'Générez automatiquement les factures pour chaque séjour et envoyez-les à vos voyageurs.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'nav-clients',
      target: () => document.querySelector('.nav-item[data-page="clients"]'),
      mobile_target: () => findSheetBtn('clients.html'),
      mobile_sheet: true,
      title: '👥 Mes Clients',
      text: 'Retrouvez la fiche de chaque voyageur avec son historique de séjours, ses coordonnées et ses préférences.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'nav-reporting',
      target: () => document.querySelector('.nav-item[data-page="reporting"]'),
      mobile_target: () => findSheetBtn('reporting.html'),
      mobile_sheet: true,
      title: '📈 Revenus',
      text: 'Suivez vos performances par logement, comparez les périodes et exportez vos données comptables.',
      position: 'right',
      mobile_position: 'top',
    },
    {
      id: 'done',
      target: null,
      title: '🎉 Vous êtes prêt !',
      text: 'Commencez par ajouter votre premier logement. Vous pouvez revoir ce tour à tout moment depuis vos Paramètres.',
      position: 'center',
      isLast: true,
    },
  ];

  /* ── Trouver un bouton dans le bottom sheet par href ──── */
  function findSheetBtn(href) {
    const sheet = document.getElementById('moreMenuSheet');
    if (!sheet) return null;
    const btns = sheet.querySelectorAll('button');
    for (const btn of btns) {
      const onclick = btn.getAttribute('onclick') || '';
      if (onclick.includes(href)) return btn;
    }
    return null;
  }

  /* ── État ─────────────────────────────────────────────── */
  let currentStep = 0;
  let overlay, bubble, spotlight;
  let sheetOpenedByTour = false;

  /* ── Styles ───────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('bh-onboarding-style')) return;
    const s = document.createElement('style');
    s.id = 'bh-onboarding-style';
    s.textContent = `
      #bh-tour-overlay {
        position: fixed; inset: 0; z-index: 99990; pointer-events: none;
      }
      #bh-tour-cutout {
        position: fixed; z-index: 99991;
        border-radius: 12px;
        box-shadow: 0 0 0 9999px rgba(13,17,23,0.72);
        pointer-events: none;
        transition: top .3s cubic-bezier(.4,0,.2,1),
                    left .3s, width .3s, height .3s;
      }
      #bh-tour-bubble {
        position: fixed; z-index: 99999;
        background: #fff; border-radius: 16px;
        padding: 20px 22px 16px;
        width: min(320px, calc(100vw - 32px));
        box-shadow: 0 8px 40px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.10);
        font-family: 'DM Sans', sans-serif;
        pointer-events: all;
      }
      .tour-step-badge {
        font-size: 11px; font-weight: 700; color: #1A7A5E;
        letter-spacing: .06em; text-transform: uppercase;
        margin-bottom: 6px; opacity: .7;
      }
      .tour-title {
        font-size: 15px; font-weight: 700; color: #111827;
        margin-bottom: 7px; line-height: 1.3;
      }
      .tour-text {
        font-size: 13px; color: #4B5563;
        line-height: 1.55; margin-bottom: 16px;
      }
      .tour-arrow {
        position: absolute; width: 14px; height: 14px;
        background: #fff; pointer-events: none;
      }
      .tour-footer {
        display: flex; align-items: center;
        justify-content: space-between; gap: 8px;
      }
      .tour-dots {
        display: flex; gap: 4px; align-items: center;
        flex-wrap: wrap; max-width: 100px;
      }
      .tour-dot {
        width: 5px; height: 5px; border-radius: 50%;
        background: #E5E7EB;
        transition: background .2s, transform .2s;
        flex-shrink: 0;
      }
      .tour-dot.active { background: #1A7A5E; transform: scale(1.3); }
      .tour-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
      .tour-btn-skip {
        background: none; border: none; font-size: 12px; color: #9CA3AF;
        cursor: pointer; font-family: 'DM Sans', sans-serif;
        padding: 4px 8px; border-radius: 6px; white-space: nowrap;
      }
      .tour-btn-skip:hover { color: #6B7280; }
      .tour-btn-next {
        background: #1A7A5E; color: #fff; border: none;
        border-radius: 10px; padding: 8px 16px;
        font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: 'DM Sans', sans-serif;
        display: flex; align-items: center; gap: 6px;
        white-space: nowrap;
        transition: background .15s, transform .1s;
      }
      .tour-btn-next:hover { background: #15624B; }
      .tour-btn-next:active { transform: scale(.97); }
      .tour-btn-finish { background: linear-gradient(135deg,#1A7A5E,#2AAE86); }

      /* ── Mobile : bulle positionnée dynamiquement ── */
      @media (max-width: 1366px) {
        #bh-tour-bubble {
          left: 16px !important;
          right: 16px !important;
          width: auto !important;
          transform: none !important;
        }
        .tour-arrow { display: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── DOM ──────────────────────────────────────────────── */
  function createDOM() {
    overlay   = document.createElement('div'); overlay.id   = 'bh-tour-overlay';
    spotlight = document.createElement('div'); spotlight.id = 'bh-tour-cutout';
    bubble    = document.createElement('div'); bubble.id    = 'bh-tour-bubble';
    document.body.appendChild(overlay);
    document.body.appendChild(spotlight);
    document.body.appendChild(bubble);
  }

  /* ── Spotlight ────────────────────────────────────────── */
  function highlightTarget(targetEl) {
    if (!targetEl) {
      spotlight.style.cssText = 'position:fixed;inset:0;z-index:99991;pointer-events:none;box-shadow:0 0 0 9999px rgba(13,17,23,0.72);border-radius:0;';
      return;
    }
    const r = targetEl.getBoundingClientRect();
    const pad = 8;
    spotlight.style.cssText = `
      position:fixed;z-index:99991;pointer-events:none;
      top:${r.top-pad}px;left:${r.left-pad}px;
      width:${r.width+pad*2}px;height:${r.height+pad*2}px;
      border-radius:12px;
      box-shadow:0 0 0 9999px rgba(13,17,23,0.72);
      transition:top .3s cubic-bezier(.4,0,.2,1),left .3s,width .3s,height .3s;
    `;
  }

  /* ── Position bulle desktop ───────────────────────────── */
  function positionBubbleDesktop(targetEl, position) {
    const margin = 20;
    const bW     = 320;
    const bH     = bubble.offsetHeight || 220;

    bubble.querySelectorAll('.tour-arrow').forEach(a => a.remove());

    if (!targetEl || position === 'center') {
      bubble.style.cssText += 'top:50%;left:50%;transform:translate(-50%,-50%);right:auto;bottom:auto;';
      return;
    }

    bubble.style.transform = '';
    const r = targetEl.getBoundingClientRect();
    const arrow = document.createElement('div');
    arrow.className = 'tour-arrow';

    let top, left;

    if (position === 'bottom') {
      top  = r.bottom + 16;
      left = r.left + r.width/2 - bW/2;
      arrow.style.cssText = 'top:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-top:1px solid #f3f4f6;border-left:1px solid #f3f4f6;';
    } else if (position === 'top') {
      top  = r.top - bH - 16;
      left = r.left + r.width/2 - bW/2;
      arrow.style.cssText = 'bottom:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-bottom:1px solid #f3f4f6;border-right:1px solid #f3f4f6;';
    } else if (position === 'right') {
      left = r.right + 16;
      top  = r.top + r.height/2 - bH/2;
      arrow.style.cssText = 'left:-7px;top:50%;transform:translateY(-50%) rotate(45deg);border-left:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;';
    } else {
      top  = r.bottom + 16;
      left = r.left + r.width/2 - bW/2;
    }

    left = Math.max(margin, Math.min(left, window.innerWidth  - bW - margin));
    top  = Math.max(margin, Math.min(top,  window.innerHeight - bH - margin));

    bubble.style.top    = top  + 'px';
    bubble.style.left   = left + 'px';
    bubble.style.right  = 'auto';
    bubble.style.bottom = 'auto';
    bubble.appendChild(arrow);
  }

  /* ── Position bulle mobile ────────────────────────────── */
  function positionBubbleMobile(targetEl, position) {
    // Bottom bar height + safe area
    const bottomBarH = 80;
    const topBarH    = 70;
    const margin     = 16;

    bubble.querySelectorAll('.tour-arrow').forEach(a => a.remove());

    if (!targetEl || position === 'center') {
      // Centré verticalement
      bubble.style.top    = '50%';
      bubble.style.bottom = 'auto';
      bubble.style.transform = 'translateY(-50%)';
      return;
    }

    bubble.style.transform = '';
    const r   = targetEl.getBoundingClientRect();
    const bH  = bubble.offsetHeight || 200;
    const mid = r.top + r.height / 2;

    if (position === 'top' || mid > window.innerHeight / 2) {
      // Élément en bas (bottom bar) → bulle au-dessus de la bottom bar
      bubble.style.bottom = (bottomBarH + 12) + 'px';
      bubble.style.top    = 'auto';
    } else {
      // Élément en haut → bulle en dessous de la top bar
      bubble.style.top    = (topBarH + 12) + 'px';
      bubble.style.bottom = 'auto';
    }
  }

  /* ── Scroll sidebar (desktop) ─────────────────────────── */
  function scrollSidebarTo(targetEl) {
    if (!targetEl) return;
    const sidebar = document.querySelector('.sidebar-nav, aside nav, #bhSidebar nav, #bhSidebar');
    if (!sidebar) return;
    const sRect = sidebar.getBoundingClientRect();
    const eRect = targetEl.getBoundingClientRect();
    const scrollTarget = sidebar.scrollTop + (eRect.top - sRect.top) - sidebar.clientHeight/2 + eRect.height/2;
    sidebar.scrollTo({ top: scrollTarget, behavior: 'smooth' });
  }

  /* ── Ouvrir le menu Plus si nécessaire ───────────────── */
  function ensureSheetOpen() {
    return new Promise(resolve => {
      const sheet = document.getElementById('moreMenuSheet');
      if (sheet && sheet.style.transform !== 'translateY(100%)' && sheet.style.transform !== '') {
        // Déjà ouvert
        resolve();
        return;
      }
      // Ouvrir via le bouton More ou directement
      const moreBtn = document.querySelector('.tab-btn[data-tab="more"]');
      if (moreBtn) {
        moreBtn.click();
        sheetOpenedByTour = true;
        // Attendre l'animation d'ouverture
        setTimeout(resolve, 700);
      } else {
        resolve();
      }
    });
  }

  /* ── Rendre le contenu HTML de la bulle ──────────────── */
  function renderBubbleContent(step, index) {
    const total  = STEPS.length;
    const isLast = step.isLast || index === total - 1;
    bubble.innerHTML = `
      <div class="tour-step-badge">Étape ${index+1} sur ${total}</div>
      <div class="tour-title">${step.title}</div>
      <div class="tour-text">${step.text}</div>
      <div class="tour-footer">
        <div class="tour-dots">
          ${STEPS.map((_, i) => `<div class="tour-dot ${i===index?'active':''}"></div>`).join('')}
        </div>
        <div class="tour-actions">
          ${!isLast ? `<button class="tour-btn-skip" onclick="window.__bhTour.skip()">Passer</button>` : ''}
          <button class="tour-btn-next ${isLast?'tour-btn-finish':''}" onclick="window.__bhTour.next()">
            ${isLast ? '<i class="fas fa-check"></i> Terminer' : 'Suivant <i class="fas fa-arrow-right"></i>'}
          </button>
        </div>
      </div>
    `;
  }

  /* ── Rendre une étape ──────────────────────────────────── */
  async function renderStep(index) {
    const step    = STEPS[index];
    const mobile  = IS_MOBILE();
    const isSheet = mobile && step.mobile_sheet;

    // Ouvrir le menu Plus si nécessaire
    if (isSheet) {
      highlightTarget(null); // overlay vide pendant ouverture
      await ensureSheetOpen();
    } else if (sheetOpenedByTour) {
      if (window.closeMoreMenu) window.closeMoreMenu();
      sheetOpenedByTour = false;
      await new Promise(r => setTimeout(r, 300));
    }

    const position = mobile
      ? (step.mobile_position || step.position)
      : step.position;

    // Contenu bulle d'abord
    renderBubbleContent(step, index);

    // Résoudre la cible APRÈS que le sheet soit ouvert (DOM prêt)
    const targetEl = mobile
      ? (step.mobile_target ? step.mobile_target() : null)
      : (step.target ? step.target() : null);

    // Spotlight sur la vraie cible
    highlightTarget(targetEl);

    // Positionner après peinture
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!mobile) {
          scrollSidebarTo(targetEl);
          setTimeout(() => {
            if (targetEl) highlightTarget(targetEl);
            positionBubbleDesktop(targetEl, position);
          }, 360);
        } else {
          positionBubbleMobile(targetEl, position);
        }
      });
    });
  }

  /* ── Lifecycle ─────────────────────────────────────────── */
  function start() {
    ['bh-tour-overlay','bh-tour-cutout','bh-tour-bubble'].forEach(id => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    injectStyles();
    createDOM();
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
    // Fermer le sheet si ouvert par le tour
    if (sheetOpenedByTour && window.closeMoreMenu) window.closeMoreMenu();
    ['bh-tour-overlay','bh-tour-cutout','bh-tour-bubble'].forEach(id => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    overlay = bubble = spotlight = null;
  }

  function skip() { finish(); }

  /* ── API publique ──────────────────────────────────────── */
  window.__bhTour = { next, skip, start, finish };

  /* ── Auto-start ────────────────────────────────────────── */
  function maybeStart() {
    if (localStorage.getItem(STORAGE_KEY)) return;
    let attempts = 0;
    const wait = setInterval(() => {
      attempts++;
      const ready = IS_MOBILE()
        ? document.querySelector('.tab-btn[data-tab="dashboard"]')
        : document.querySelector('.nav-item[data-page="settings"]');
      if (ready || attempts > 30) {
        clearInterval(wait);
        setTimeout(start, 700);
      }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeStart);
  } else {
    maybeStart();
  }

})();

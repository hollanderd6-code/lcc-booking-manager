/* ============================================================
   BOOSTINGHOST — Onboarding Tour v3
   <script src="/js/bh-onboarding.js"></script> avant </body>
   ============================================================ */

(function () {
  const STORAGE_KEY = 'bh_onboarding_done_v1';

  /* ── Étapes ─────────────────────────────────────────────── */
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
      title: '📊 Tableau de bord',
      text: 'En un coup d\'œil : logements actifs, arrivées/départs du jour, nettoyages à venir et chiffre d\'affaires.',
      position: 'bottom',
    },
    {
      id: 'new-reservation',
      target: () => document.getElementById('newReservationBtn'),
      title: '➕ Nouvelle réservation',
      text: 'Ajoutez manuellement une réservation pour vos clients directs, sans passer par une plateforme.',
      position: 'bottom',
    },
    {
      id: 'calendar',
      target: () => document.getElementById('calendarSection'),
      title: '📅 Calendrier',
      text: 'Visualisez toutes vos réservations par logement. Cliquez sur une réservation pour accéder aux détails, messages et caution.',
      position: 'top',
    },
    {
      id: 'nav-settings',
      target: () => document.querySelector('.nav-item[data-page="settings"]'),
      title: '🏠 Mes logements',
      text: 'Configurez chaque logement : photos, horaires, caution, et connectez vos plateformes Airbnb, Booking.com via Channex.',
      position: 'right',
    },
    {
      id: 'nav-welcome',
      target: () => document.querySelector('.nav-item[data-page="welcome"]'),
      title: '📖 Livrets d\'accueil',
      text: 'Créez et personnalisez vos livrets d\'accueil numériques. Vos voyageurs y retrouvent toutes les informations du logement.',
      position: 'right',
    },
    {
      id: 'nav-contrat',
      target: () => document.querySelector('.nav-item[data-page="contrat"]'),
      title: '📝 Contrats',
      text: 'Générez et envoyez vos mandats de gestion et contrats de location directement depuis l\'app.',
      position: 'right',
    },
    {
      id: 'nav-cleaning',
      target: () => document.querySelector('.nav-item[data-page="cleaning"]'),
      title: '🧹 Gestion du ménage',
      text: 'Planifiez les ménages, assignez vos prestataires et suivez les interventions entre chaque séjour.',
      position: 'right',
    },
    {
      id: 'nav-deposits',
      target: () => document.querySelector('.nav-item[data-page="deposits"]'),
      title: '💰 Finances',
      text: 'Gérez les cautions et paiements directs de vos voyageurs. Suivez les encaissements et remboursements.',
      position: 'right',
    },
    {
      id: 'nav-messages',
      target: () => document.querySelector('.nav-item[data-page="messages"]'),
      title: '💬 Messagerie',
      text: 'Centralisez tous vos échanges avec les voyageurs. L\'IA rédige des réponses adaptées pour vous faire gagner du temps.',
      position: 'right',
    },
    {
      id: 'nav-factures',
      target: () => document.querySelector('.nav-item[data-page="factures"]'),
      title: '🧾 Factures séjours',
      text: 'Générez automatiquement les factures pour chaque séjour et envoyez-les à vos voyageurs.',
      position: 'right',
    },
    {
      id: 'nav-clients',
      target: () => document.querySelector('.nav-item[data-page="clients"]'),
      title: '👥 Mes Clients',
      text: 'Retrouvez la fiche de chaque voyageur avec son historique de séjours, ses coordonnées et ses préférences.',
      position: 'right',
    },
    {
      id: 'nav-reporting',
      target: () => document.querySelector('.nav-item[data-page="reporting"]'),
      title: '📈 Revenus',
      text: 'Suivez vos performances par logement, comparez les périodes et exportez vos données comptables.',
      position: 'right',
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

  /* ── État ─────────────────────────────────────────────── */
  let currentStep = 0;
  let overlay, bubble, spotlight;

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
        position: fixed; z-index: 99991; border-radius: 12px;
        box-shadow: 0 0 0 9999px rgba(13,17,23,0.72);
        pointer-events: none;
        transition: top .3s cubic-bezier(.4,0,.2,1),
                    left .3s cubic-bezier(.4,0,.2,1),
                    width .3s cubic-bezier(.4,0,.2,1),
                    height .3s cubic-bezier(.4,0,.2,1);
      }
      #bh-tour-bubble {
        position: fixed; z-index: 99999;
        background: #fff; border-radius: 16px;
        padding: 22px 24px 18px;
        width: min(340px, calc(100vw - 32px));
        box-shadow: 0 8px 40px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.10);
        font-family: 'DM Sans', sans-serif;
        pointer-events: all;
      }
      .tour-step-badge {
        font-size: 11px; font-weight: 700; color: #1A7A5E;
        letter-spacing: .06em; text-transform: uppercase;
        margin-bottom: 8px; opacity: .7;
      }
      .tour-title {
        font-size: 16px; font-weight: 700; color: #111827;
        margin-bottom: 8px; line-height: 1.3;
      }
      .tour-text {
        font-size: 13.5px; color: #4B5563;
        line-height: 1.55; margin-bottom: 18px;
      }
      .tour-arrow {
        position: absolute; width: 14px; height: 14px;
        background: #fff; pointer-events: none;
      }
      .tour-footer {
        display: flex; align-items: center;
        justify-content: space-between; gap: 10px;
      }
      .tour-dots { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; max-width: 120px; }
      .tour-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: #E5E7EB;
        transition: background .2s, transform .2s;
      }
      .tour-dot.active { background: #1A7A5E; transform: scale(1.3); }
      .tour-actions { display: flex; gap: 8px; align-items: center; }
      .tour-btn-skip {
        background: none; border: none; font-size: 12px; color: #9CA3AF;
        cursor: pointer; font-family: 'DM Sans', sans-serif;
        padding: 4px 8px; border-radius: 6px;
      }
      .tour-btn-skip:hover { color: #6B7280; }
      .tour-btn-next {
        background: #1A7A5E; color: #fff; border: none;
        border-radius: 10px; padding: 9px 20px;
        font-size: 13px; font-weight: 600; cursor: pointer;
        font-family: 'DM Sans', sans-serif;
        display: flex; align-items: center; gap: 6px;
        transition: background .15s, transform .1s;
        white-space: nowrap;
      }
      .tour-btn-next:hover { background: #15624B; }
      .tour-btn-next:active { transform: scale(.97); }
      .tour-btn-finish { background: linear-gradient(135deg,#1A7A5E,#2AAE86); }

      @media (max-width: 700px) {
        #bh-tour-bubble {
          position: fixed !important;
          bottom: 100px !important; left: 16px !important;
          right: 16px !important; top: auto !important;
          width: auto !important; transform: none !important;
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
  function highlightTarget(targetEl, position) {
    if (!targetEl || position === 'center') {
      spotlight.style.cssText = 'position:fixed;inset:0;z-index:99991;pointer-events:none;box-shadow:0 0 0 9999px rgba(13,17,23,0.72);border-radius:0;';
      return;
    }
    const r   = targetEl.getBoundingClientRect();
    const pad = 8;
    spotlight.style.cssText = `
      position:fixed; z-index:99991; pointer-events:none;
      top:${r.top - pad}px; left:${r.left - pad}px;
      width:${r.width + pad*2}px; height:${r.height + pad*2}px;
      border-radius:12px;
      box-shadow:0 0 0 9999px rgba(13,17,23,0.72);
      transition:top .3s cubic-bezier(.4,0,.2,1),left .3s,width .3s,height .3s;
    `;
  }

  /* ── Position bulle ───────────────────────────────────── */
  function positionBubble(targetEl, position) {
    if (window.innerWidth <= 700) return;

    const margin = 20;
    const bW     = 340;
    const bH     = bubble.offsetHeight || 240;

    // Supprimer ancienne flèche
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
      left = r.left + r.width / 2 - bW / 2;
      arrow.style.cssText = 'top:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-top:1px solid #f3f4f6;border-left:1px solid #f3f4f6;';
    } else if (position === 'top') {
      top  = r.top - bH - 16;
      left = r.left + r.width / 2 - bW / 2;
      arrow.style.cssText = 'bottom:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-bottom:1px solid #f3f4f6;border-right:1px solid #f3f4f6;';
    } else if (position === 'right') {
      left = r.right + 16;
      top  = r.top + r.height / 2 - bH / 2;
      arrow.style.cssText = 'left:-7px;top:50%;transform:translateY(-50%) rotate(45deg);border-left:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;';
    } else {
      top  = r.bottom + 16;
      left = r.left + r.width / 2 - bW / 2;
    }

    left = Math.max(margin, Math.min(left, window.innerWidth  - bW - margin));
    top  = Math.max(margin, Math.min(top,  window.innerHeight - bH - margin));

    bubble.style.top    = top  + 'px';
    bubble.style.left   = left + 'px';
    bubble.style.right  = 'auto';
    bubble.style.bottom = 'auto';
    bubble.appendChild(arrow);
  }

  /* ── Scroll sidebar vers l'élément puis recalculer ────── */
  function scrollToAndPosition(targetEl, position) {
    if (!targetEl) {
      positionBubble(null, position);
      return;
    }

    // Trouver la sidebar scrollable
    const sidebar = document.querySelector('.sidebar-nav, .sidebar nav, aside nav, #bhSidebar nav, #bhSidebar');
    if (sidebar) {
      // Calculer l'offset de l'élément dans la sidebar
      const sRect = sidebar.getBoundingClientRect();
      const eRect = targetEl.getBoundingClientRect();
      const scrollTarget = sidebar.scrollTop + (eRect.top - sRect.top) - sidebar.clientHeight / 2 + eRect.height / 2;
      sidebar.scrollTo({ top: scrollTarget, behavior: 'smooth' });
    }

    // Attendre la fin du scroll puis recalculer
    setTimeout(() => {
      highlightTarget(targetEl, position);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => positionBubble(targetEl, position));
      });
    }, 350);
  }

  /* ── Rendre une étape ──────────────────────────────────── */
  function renderStep(index) {
    const step     = STEPS[index];
    const targetEl = step.target ? step.target() : null;
    const total    = STEPS.length;
    const isLast   = step.isLast || index === total - 1;

    // Spotlight immédiat
    highlightTarget(targetEl, step.position);

    bubble.innerHTML = `
      <div class="tour-step-badge">Étape ${index + 1} sur ${total}</div>
      <div class="tour-title">${step.title}</div>
      <div class="tour-text">${step.text}</div>
      <div class="tour-footer">
        <div class="tour-dots">
          ${STEPS.map((_, i) => `<div class="tour-dot ${i === index ? 'active' : ''}"></div>`).join('')}
        </div>
        <div class="tour-actions">
          ${!isLast ? `<button class="tour-btn-skip" onclick="window.__bhTour.skip()">Passer</button>` : ''}
          <button class="tour-btn-next ${isLast ? 'tour-btn-finish' : ''}" onclick="window.__bhTour.next()">
            ${isLast ? '<i class="fas fa-check"></i> Terminer' : 'Suivant <i class="fas fa-arrow-right"></i>'}
          </button>
        </div>
      </div>
    `;

    // Positionner la bulle après scroll sidebar
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToAndPosition(targetEl, step.position);
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
      const ready = document.querySelector('.nav-item[data-page="settings"]');
      if (ready || attempts > 25) {
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

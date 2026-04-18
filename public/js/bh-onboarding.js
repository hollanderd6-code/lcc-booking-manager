/* ============================================================
   BOOSTINGHOST — Onboarding Tour
   Ajouter dans app.html : <script src="/js/bh-onboarding.js"></script>
   (avant la fermeture </body>)
   ============================================================ */

(function () {
  const STORAGE_KEY = 'bh_onboarding_done_v1';

  /* ── Définition des étapes ─────────────────────────────── */
  const STEPS = [
    {
      id: 'welcome',
      target: null, // pas d'élément ciblé → écran de bienvenue centré
      title: '👋 Bienvenue sur Boostinghost !',
      text: 'Faisons un rapide tour de votre espace de gestion. Cela prend moins d\'une minute.',
      position: 'center',
    },
    {
      id: 'kpi',
      target: () => document.getElementById('kpiPropertiesCard'),
      title: '📊 Tableau de bord',
      text: 'Ici vous retrouvez en un coup d\'œil vos logements actifs, les arrivées/départs du jour, les nettoyages à venir et votre chiffre d\'affaires.',
      position: 'bottom',
    },
    {
      id: 'new-reservation',
      target: () => document.getElementById('newReservationBtn'),
      title: '➕ Nouvelle réservation',
      text: 'Ajoutez manuellement une réservation en un clic — pour vos clients directs sans passer par une plateforme.',
      position: 'bottom',
    },
    {
      id: 'calendar',
      target: () => document.getElementById('calendarSection'),
      title: '📅 Calendrier',
      text: 'Visualisez toutes vos réservations par logement. Cliquez sur une réservation pour voir les détails, gérer les messages et la caution.',
      position: 'top',
    },
    {
      id: 'nav-settings',
      target: () => findNavItem(['logement', 'setting', 'paramètre', 'property']),
      title: '🏠 Vos logements',
      text: 'Configurez chaque logement : photos, horaires d\'arrivée/départ, caution, livret d\'accueil, et connectez vos plateformes Airbnb, Booking.com...',
      position: 'right',
    },
    {
      id: 'nav-messages',
      target: () => findNavItem(['message', 'messagerie', 'chat']),
      title: '💬 Messagerie',
      text: 'Centralisez tous vos échanges avec les voyageurs. L\'IA peut rédiger des réponses automatiques pour vous.',
      position: 'right',
    },
    {
      id: 'nav-reporting',
      target: () => findNavItem(['revenu', 'reporting', 'rapport', 'statistique']),
      title: '📈 Revenus & Statistiques',
      text: 'Suivez vos performances par logement, comparez les périodes, et exportez vos données comptables.',
      position: 'right',
    },
    {
      id: 'done',
      target: null,
      title: '🎉 Vous êtes prêt !',
      text: 'Commencez par ajouter votre premier logement dans "Paramètres". En cas de question, retrouvez ce tour à tout moment dans votre profil.',
      position: 'center',
      isLast: true,
    },
  ];

  /* ── Trouver un nav-item par mot-clé dans son texte ───── */
  function findNavItem(keywords) {
    const items = document.querySelectorAll('.nav-item, [class*="nav-item"], aside a, .sidebar a, .sidebar button');
    for (const item of items) {
      const text = (item.textContent || '').toLowerCase();
      if (keywords.some(k => text.includes(k.toLowerCase()))) return item;
    }
    return null;
  }

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
        position: fixed;
        inset: 0;
        z-index: 99990;
        pointer-events: none;
      }
      #bh-tour-cutout {
        position: fixed;
        z-index: 99991;
        border-radius: 12px;
        box-shadow: 0 0 0 9999px rgba(13,17,23,0.72);
        transition: all .35s cubic-bezier(.4,0,.2,1);
        pointer-events: none;
      }
      #bh-tour-cutout.center-mode {
        box-shadow: 0 0 0 9999px rgba(13,17,23,0.72);
        inset: 0 !important;
        border-radius: 0 !important;
        width: 100% !important;
        height: 100% !important;
        top: 0 !important;
        left: 0 !important;
      }
      #bh-tour-bubble {
        position: fixed;
        z-index: 99999;
        background: #fff;
        border-radius: 16px;
        padding: 22px 24px 18px;
        width: min(340px, calc(100vw - 32px));
        box-shadow: 0 8px 40px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.10);
        font-family: 'DM Sans', sans-serif;
        transition: all .3s cubic-bezier(.4,0,.2,1);
        pointer-events: all;
      }
      #bh-tour-bubble .tour-step-badge {
        font-size: 11px;
        font-weight: 700;
        color: #1A7A5E;
        letter-spacing: .06em;
        text-transform: uppercase;
        margin-bottom: 8px;
        opacity: .7;
      }
      #bh-tour-bubble .tour-title {
        font-size: 16px;
        font-weight: 700;
        color: #111827;
        margin-bottom: 8px;
        line-height: 1.3;
      }
      #bh-tour-bubble .tour-text {
        font-size: 13.5px;
        color: #4B5563;
        line-height: 1.55;
        margin-bottom: 18px;
      }
      #bh-tour-bubble .tour-arrow {
        position: absolute;
        width: 14px;
        height: 14px;
        background: #fff;
        transform: rotate(45deg);
        pointer-events: none;
      }
      #bh-tour-bubble .tour-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      #bh-tour-bubble .tour-dots {
        display: flex;
        gap: 5px;
        align-items: center;
      }
      #bh-tour-bubble .tour-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #E5E7EB;
        transition: background .2s, transform .2s;
      }
      #bh-tour-bubble .tour-dot.active {
        background: #1A7A5E;
        transform: scale(1.3);
      }
      #bh-tour-bubble .tour-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .tour-btn-skip {
        background: none;
        border: none;
        font-size: 12px;
        color: #9CA3AF;
        cursor: pointer;
        font-family: 'DM Sans', sans-serif;
        padding: 4px 8px;
        border-radius: 6px;
        transition: color .15s;
      }
      .tour-btn-skip:hover { color: #6B7280; }
      .tour-btn-next {
        background: #1A7A5E;
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 9px 20px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        font-family: 'DM Sans', sans-serif;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: background .15s, transform .1s;
      }
      .tour-btn-next:hover { background: #15624B; }
      .tour-btn-next:active { transform: scale(.97); }
      .tour-btn-finish {
        background: linear-gradient(135deg, #1A7A5E, #2AAE86);
      }

      /* Mobile : bulle toujours en bas */
      @media (max-width: 700px) {
        #bh-tour-bubble {
          position: fixed !important;
          bottom: 90px !important;
          left: 16px !important;
          right: 16px !important;
          top: auto !important;
          width: auto !important;
          transform: none !important;
        }
        #bh-tour-bubble .tour-arrow { display: none !important; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ── Créer les éléments DOM du tour ──────────────────── */
  function createDOM() {
    // Overlay (juste pour bloquer les clics en dehors)
    overlay = document.createElement('div');
    overlay.id = 'bh-tour-overlay';
    overlay.addEventListener('click', () => {}); // absorbe les clics

    // Spotlight (découpe)
    spotlight = document.createElement('div');
    spotlight.id = 'bh-tour-cutout';

    // Bulle
    bubble = document.createElement('div');
    bubble.id = 'bh-tour-bubble';

    document.body.appendChild(overlay);
    document.body.appendChild(spotlight);
    document.body.appendChild(bubble);
  }

  /* ── Positionner la bulle autour de l'élément cible ─── */
  function positionBubble(targetEl, position) {
    const isMobile = window.innerWidth <= 700;
    if (isMobile) return; // géré par CSS

    const bRect = bubble.getBoundingClientRect();
    const bW = bRect.width || 340;
    const bH = bRect.height || 200;
    const margin = 16;

    if (!targetEl || position === 'center') {
      bubble.style.top = '50%';
      bubble.style.left = '50%';
      bubble.style.transform = 'translate(-50%, -50%)';
      return;
    }

    bubble.style.transform = '';
    const r = targetEl.getBoundingClientRect();

    // Flèche
    let arrow = bubble.querySelector('.tour-arrow');
    if (!arrow) {
      arrow = document.createElement('div');
      arrow.className = 'tour-arrow';
      bubble.appendChild(arrow);
    }

    let top, left;

    if (position === 'bottom') {
      top = r.bottom + 14;
      left = r.left + r.width / 2 - bW / 2;
      arrow.style.cssText = 'top:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-top:1px solid #f3f4f6;border-left:1px solid #f3f4f6;';
    } else if (position === 'top') {
      top = r.top - bH - 14;
      left = r.left + r.width / 2 - bW / 2;
      arrow.style.cssText = 'bottom:-7px;left:50%;transform:translateX(-50%) rotate(45deg);border-bottom:1px solid #f3f4f6;border-right:1px solid #f3f4f6;';
    } else if (position === 'right') {
      top = r.top + r.height / 2 - bH / 2;
      left = r.right + 14;
      arrow.style.cssText = 'left:-7px;top:50%;transform:translateY(-50%) rotate(45deg);border-left:1px solid #f3f4f6;border-bottom:1px solid #f3f4f6;';
    } else {
      top = r.bottom + 14;
      left = r.left + r.width / 2 - bW / 2;
      arrow.style.cssText = '';
    }

    // Clamp dans la fenêtre
    left = Math.max(margin, Math.min(left, window.innerWidth - bW - margin));
    top  = Math.max(margin, Math.min(top,  window.innerHeight - bH - margin));

    bubble.style.top  = top + 'px';
    bubble.style.left = left + 'px';
  }

  /* ── Mettre en avant l'élément (spotlight) ─────────── */
  function highlightTarget(targetEl, position) {
    if (!targetEl || position === 'center') {
      spotlight.style.cssText = 'position:fixed;inset:0;z-index:99991;box-shadow:0 0 0 9999px rgba(13,17,23,0.72);pointer-events:none;border-radius:0;width:100%;height:100%;top:0;left:0;';
      return;
    }

    const r = targetEl.getBoundingClientRect();
    const pad = 8;
    spotlight.style.cssText = `
      position: fixed;
      z-index: 99991;
      pointer-events: none;
      top: ${r.top - pad}px;
      left: ${r.left - pad}px;
      width: ${r.width + pad * 2}px;
      height: ${r.height + pad * 2}px;
      border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(13,17,23,0.72);
      transition: all .35s cubic-bezier(.4,0,.2,1);
    `;

    // Scroll vers l'élément si nécessaire
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ── Rendre une étape ──────────────────────────────── */
  function renderStep(index) {
    const step = STEPS[index];
    const targetEl = step.target ? step.target() : null;
    const total = STEPS.length;
    const isLast = step.isLast || index === total - 1;

    highlightTarget(targetEl, step.position);

    // Contenu de la bulle
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

    // Retirer l'ancienne flèche si mode center
    if (!targetEl || step.position === 'center') {
      const arrow = bubble.querySelector('.tour-arrow');
      if (arrow) arrow.remove();
    }

    // Positionner après que le DOM est peint
    requestAnimationFrame(() => positionBubble(targetEl, step.position));
  }

  /* ── Démarrer le tour ──────────────────────────────── */
  function start() {
    injectStyles();
    createDOM();
    currentStep = 0;
    renderStep(currentStep);
  }

  /* ── Étape suivante ────────────────────────────────── */
  function next() {
    currentStep++;
    if (currentStep >= STEPS.length) {
      finish();
    } else {
      renderStep(currentStep);
    }
  }

  /* ── Terminer / Passer ─────────────────────────────── */
  function finish() {
    localStorage.setItem(STORAGE_KEY, '1');
    if (overlay)   overlay.remove();
    if (spotlight) spotlight.remove();
    if (bubble)    bubble.remove();
    overlay = bubble = spotlight = null;
  }

  function skip() {
    finish();
  }

  /* ── API publique ──────────────────────────────────── */
  window.__bhTour = { next, skip, start, finish };

  /* ── Lancement automatique au chargement ──────────── */
  function maybeStart() {
    // Ne pas démarrer si déjà vu
    if (localStorage.getItem(STORAGE_KEY)) return;

    // Attendre que bh-layout.js ait injecté la sidebar
    let attempts = 0;
    const wait = setInterval(() => {
      attempts++;
      const sidebarReady = document.querySelector('.nav-item, .sidebar a, aside a');
      if (sidebarReady || attempts > 20) {
        clearInterval(wait);
        setTimeout(start, 600); // petit délai pour que la page soit visuellement stable
      }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeStart);
  } else {
    maybeStart();
  }

})();

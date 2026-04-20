/* ============================================================
   BOOSTINGHOST — Onboarding Tours par page (v1)
   Moteur partagé + configs déclaratives par page.
   Include : <script src="/js/bh-onboarding-pages.js"></script>
   ============================================================ */

(function () {
  const IS_MOBILE = () => window.innerWidth <= 1366;

  /* ============================================================
     REGISTRE DES TOURS PAR PAGE
     Clé = filename (match sur location.pathname)
     ============================================================ */
  const PAGE_TOURS = {

    /* ── MESSAGES ─────────────────────────────────────────── */
    'messages.html': {
      storageKey: 'bh_ob_messages_v1',
      onStart: null,
      onFinish: () => {
        // Revenir à l'onglet Messages à la fin du tour
        if (typeof window.switchMsgsTab === 'function') {
          try { window.switchMsgsTab('guests'); } catch (e) {}
        }
      },
      steps: [
        {
          id: 'welcome',
          target: null,
          title: '💬 Votre messagerie centralisée',
          text: 'Tous vos échanges avec vos plateformes au même endroit. Petit tour rapide.',
          position: 'center',
        },
        {
          id: 'tab-guests',
          target: () => document.getElementById('tabGuests'),
          mobile_target: () => document.getElementById('tabGuests'),
          before: () => {
            if (typeof window.switchMsgsTab === 'function') {
              try { window.switchMsgsTab('guests'); } catch (e) {}
            }
          },
          title: '📨 Messages',
          text: 'Vos conversations en cours avec les voyageurs. Le badge rouge indique les non-lus.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'conversations',
          target: () => document.getElementById('conversationsList'),
          mobile_target: () => document.getElementById('msgsSearchInput'),
          title: '🔍 Vos conversations',
          text: 'Retrouvez ici toutes vos discussions, triées par date. Recherchez un voyageur par son nom.',
          position: 'right',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-templates',
          target: () => document.getElementById('tabTemplates'),
          mobile_target: () => document.getElementById('tabTemplates'),
          before: () => {
            if (typeof window.switchMsgsTab === 'function') {
              try { window.switchMsgsTab('templates'); } catch (e) {}
            }
          },
          title: '📝 Templates automatiques',
          text: 'Créez des messages pré-écrits déclenchés automatiquement : confirmation, arrivée, départ, avis...',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-logs',
          target: () => document.getElementById('tabLogs'),
          mobile_target: () => document.getElementById('tabLogs'),
          before: () => {
            if (typeof window.switchMsgsTab === 'function') {
              try { window.switchMsgsTab('logs'); } catch (e) {}
            }
          },
          title: '📊 Statut des envois',
          text: 'Vérifiez que vos messages automatiques ont bien été envoyés. En cas d\'échec, vous voyez pourquoi.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'done',
          target: null,
          title: '🎉 C\'est parti !',
          text: 'Astuce : l\'IA peut rédiger des réponses adaptées en un clic. Essayez-la dans une conversation !',
          position: 'center',
          isLast: true,
        },
      ],
    },

    // ── Les autres pages viendront ici (contrat, cleaning, deposits, factures, clients, reporting, welcome)

    /* ── DEPOSITS (Cautions & paiements) ──────────────────── */
    'deposits.html': {
      storageKey: 'bh_ob_deposits_v1',
      onFinish: () => {
        // Revenir à l'onglet Cautions à la fin du tour
        const btn = document.querySelector('.tab-button[data-tab="deposits"]');
        if (btn) try { btn.click(); } catch (e) {}
      },
      steps: [
        {
          id: 'welcome',
          target: null,
          title: '💰 Cautions & paiements',
          text: 'Encaissez vos cautions et paiements voyageurs en toute sécurité via Stripe. Petit tour rapide.',
          position: 'center',
        },
        {
          id: 'tab-deposits',
          target: () => document.querySelector('.tab-button[data-tab="deposits"]'),
          mobile_target: () => document.querySelector('.tab-button[data-tab="deposits"]'),
          before: () => {
            const btn = document.querySelector('.tab-button[data-tab="deposits"]');
            if (btn) try { btn.click(); } catch (e) {}
          },
          title: '🛡️ Cautions actives',
          text: 'Pour chaque réservation, envoyez un lien sécurisé Stripe à votre voyageur. Le montant est pré-autorisé (pas débité) et peut être capturé en cas de dégâts, ou relâché en fin de séjour.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-history',
          target: () => document.querySelector('.tab-button[data-tab="history"]'),
          mobile_target: () => document.querySelector('.tab-button[data-tab="history"]'),
          before: () => {
            const btn = document.querySelector('.tab-button[data-tab="history"]');
            if (btn) try { btn.click(); } catch (e) {}
          },
          title: '📜 Historique cautions',
          text: 'Retrouvez toutes les cautions passées : montants, statuts, dates de capture ou de libération. Parfait pour votre suivi comptable.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-payments',
          target: () => document.querySelector('.tab-button[data-tab="payments"]'),
          mobile_target: () => document.querySelector('.tab-button[data-tab="payments"]'),
          before: () => {
            const btn = document.querySelector('.tab-button[data-tab="payments"]');
            if (btn) try { btn.click(); } catch (e) {}
          },
          title: '💳 Paiements directs',
          text: 'Via Stripe Connect, encaissez directement les paiements sur votre compte (loyer, frais, suppléments). Le widget en haut affiche votre solde disponible et les payouts en cours.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-payments-history',
          target: () => document.querySelector('.tab-button[data-tab="payments-history"]'),
          mobile_target: () => document.querySelector('.tab-button[data-tab="payments-history"]'),
          before: () => {
            const btn = document.querySelector('.tab-button[data-tab="payments-history"]');
            if (btn) try { btn.click(); } catch (e) {}
          },
          title: '📊 Historique paiements',
          text: 'Toutes vos transactions passées, filtrées par logement. Idéal pour votre déclaration annuelle.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'done',
          target: null,
          title: '🎉 Prêt à encaisser !',
          text: 'Astuce : vous pouvez aussi créer des liens "libres" (caution ou paiement) pour des clients directs sans réservation — pratique pour les ventes de chèques-cadeaux ou les arrhes.',
          position: 'center',
          isLast: true,
        },
      ],
    },

    /* ── FACTURES (Factures de séjour) ────────────────────── */
    'factures.html': {
      storageKey: 'bh_ob_factures_v1',
      steps: [
        {
          id: 'welcome',
          target: null,
          title: '🧾 Factures de séjour',
          text: 'Émettez vos factures en quelques secondes, avec aperçu live et envoi par email. Petit tour rapide.',
          position: 'center',
        },
        {
          id: 'form',
          // La première .card dans .invoice-grid = le formulaire (la 2ème .card est plus bas dans l'historique)
          target: () => document.querySelector('.invoice-grid .card'),
          mobile_target: () => document.querySelector('.invoice-grid .card'),
          title: '📋 Informations de facturation',
          text: 'Remplissez les infos client, sélectionnez le logement et les dates, puis indiquez les montants. Si besoin d\'une facture avec TVA, il suffit de cocher la case.',
          position: 'right',
          mobile_position: 'bottom',
        },
        {
          id: 'preview',
          target: () => document.getElementById('invoicePreview'),
          mobile_target: () => document.getElementById('invoicePreview'),
          title: '👁️ Aperçu en temps réel',
          text: 'La facture se met à jour à chaque champ que vous remplissez. Vous voyez exactement ce que recevra votre client avant d\'envoyer.',
          position: 'left',
          mobile_position: 'top',
        },
        {
          id: 'send',
          target: () => document.getElementById('sendBtn'),
          mobile_target: () => document.getElementById('sendBtn'),
          before: () => {
            // S'assurer que le bouton est visible
            const btn = document.getElementById('sendBtn');
            if (btn && btn.scrollIntoView) {
              btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          },
          title: '📧 Envoi en un clic',
          text: 'Quand tout est bon, envoyez la facture par email directement au client. Un PDF est automatiquement généré et attaché.',
          position: 'top',
          mobile_position: 'top',
        },
        {
          id: 'history',
          target: () => document.querySelector('.history-filters'),
          mobile_target: () => document.querySelector('.history-filters'),
          before: () => {
            // Scroller jusqu'à l'historique qui est plus bas
            const hist = document.querySelector('.history-filters');
            if (hist && hist.scrollIntoView) {
              hist.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          },
          title: '📚 Historique & filtres',
          text: 'Retrouvez toutes vos factures émises, filtrez par période pour votre comptabilité. Utile pour votre déclaration annuelle.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'done',
          target: null,
          title: '🎉 C\'est prêt !',
          text: 'Astuce : le numéro de facture est généré automatiquement et chronologique, conforme aux obligations légales françaises.',
          position: 'center',
          isLast: true,
        },
      ],
    },

    /* ── CONTRAT (Contrats & mandats) ─────────────────────── */
    'contrat.html': {
      storageKey: 'bh_ob_contrat_v1',
      onFinish: () => {
        // Revenir à l'onglet "Nouveau contrat" à la fin du tour
        if (typeof window.switchTab === 'function') {
          try { window.switchTab('new'); } catch (e) {}
        }
      },
      steps: [
        {
          id: 'welcome',
          target: null,
          title: '📝 Contrats & mandats',
          text: 'Générez vos contrats de location et mandats de gestion en quelques clics. Petit tour rapide.',
          position: 'center',
        },
        {
          id: 'tab-new',
          target: () => document.getElementById('tabNew'),
          mobile_target: () => document.getElementById('tabNew'),
          before: () => {
            if (typeof window.switchTab === 'function') {
              try { window.switchTab('new'); } catch (e) {}
            }
          },
          title: '📄 Nouveau contrat',
          text: 'Créez un contrat de location en 6 étapes : logement, voyageur, prix, règles, clauses légales, signature. Tout est pré-rempli grâce à vos logements enregistrés.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'stepper',
          target: () => document.getElementById('contratStepper'),
          mobile_target: () => document.getElementById('contratStepper'),
          title: '🧭 Wizard guidé',
          text: 'Le stepper vous accompagne à chaque étape. Vous pouvez revenir en arrière à tout moment. À la fin, vous obtenez un PDF professionnel signable.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-mandat',
          target: () => document.getElementById('tabMandat'),
          mobile_target: () => document.getElementById('tabMandat'),
          before: () => {
            if (typeof window.switchTab === 'function') {
              try { window.switchTab('mandat'); } catch (e) {}
            }
          },
          title: '🤝 Mandat de gestion',
          text: 'Pour les conciergeries : créez le contrat qui vous lie à un propriétaire, avec vos commissions et obligations clairement définies.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-history',
          target: () => document.getElementById('tabHistory'),
          mobile_target: () => document.getElementById('tabHistory'),
          before: () => {
            if (typeof window.switchTab === 'function') {
              try { window.switchTab('history'); } catch (e) {}
            }
          },
          title: '📚 Historique',
          text: 'Retrouvez tous vos contrats et mandats passés. Téléchargez, renvoyez ou dupliquez en un clic.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'done',
          target: null,
          title: '🎉 Prêt à contractualiser !',
          text: 'Astuce : tout contrat généré peut être envoyé par email directement au signataire. Il reçoit un lien pour signer numériquement.',
          position: 'center',
          isLast: true,
        },
      ],
    },

    /* ── CLEANING (Gestion du ménage) ─────────────────────── */
    'cleaning.html': {
      storageKey: 'bh_ob_cleaning_v1',
      onFinish: () => {
        // Revenir à l'onglet Équipe à la fin du tour
        if (typeof window.switchTab === 'function') {
          try { window.switchTab('team'); } catch (e) {}
        }
      },
      steps: [
        {
          id: 'welcome',
          target: null,
          title: '🧹 Gestion du ménage',
          text: 'Planifiez, assignez, vérifiez. Tout le cycle des ménages en un seul endroit. Petit tour rapide.',
          position: 'center',
        },
        {
          id: 'tab-team',
          target: () => document.querySelector('.cleaning-tab[data-tab="team"]'),
          mobile_target: () => document.querySelector('.cleaning-tab[data-tab="team"]'),
          before: () => {
            if (typeof window.switchTab === 'function') {
              try { window.switchTab('team'); } catch (e) {}
            }
          },
          title: '👥 Votre équipe',
          text: 'Ajoutez vos prestataires de ménage ici (nom, email, téléphone). Ils recevront les notifications d\'assignation.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'assign-zone',
          // Sur desktop on surligne toute la zone ; sur mobile on cible juste le header
          // (plus petit) pour que la bulle ait la place de s'afficher
          target: () => document.getElementById('assignContainer'),
          mobile_target: () => {
            const container = document.getElementById('assignContainer');
            if (!container) return null;
            // Remonter jusqu'à la <section class="card"> parente et prendre son card-header
            const section = container.closest('section.card');
            return section ? section.querySelector('.card-header') : container;
          },
          before: () => {
            // S'assurer que la zone est visible (important sur mobile où la grille
            // est empilée verticalement sous l'équipe)
            const container = document.getElementById('assignContainer');
            if (container) {
              const section = container.closest('section.card') || container;
              section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          },
          title: '📅 Assignations',
          text: 'À chaque réservation, associez un prestataire en un clic. Le ménage apparaîtra dans son planning et il sera notifié.',
          position: 'top',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-checklists',
          target: () => document.querySelector('.cleaning-tab[data-tab="checklists"]'),
          mobile_target: () => document.querySelector('.cleaning-tab[data-tab="checklists"]'),
          before: () => {
            if (typeof window.switchTab === 'function') {
              try { window.switchTab('checklists'); } catch (e) {}
            }
          },
          title: '✅ Checklists soumises',
          text: 'Une fois le ménage fait, le prestataire envoie sa checklist avec photos. Validez ou demandez des corrections.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-templates',
          target: () => document.querySelector('.cleaning-tab[data-tab="templates"]'),
          mobile_target: () => document.querySelector('.cleaning-tab[data-tab="templates"]'),
          before: () => {
            if (typeof window.switchTab === 'function') {
              try { window.switchTab('templates'); } catch (e) {}
            }
          },
          title: '📋 Templates de tâches',
          text: 'Créez vos propres listes de tâches par logement (ex: changer les draps, nettoyer le four). Les prestataires cochent au fur et à mesure.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'tab-stats',
          target: () => document.querySelector('.cleaning-tab[data-tab="stats"]'),
          mobile_target: () => document.querySelector('.cleaning-tab[data-tab="stats"]'),
          before: () => {
            if (typeof window.switchTab === 'function') {
              try { window.switchTab('stats'); } catch (e) {}
            }
          },
          title: '📊 Statistiques',
          text: 'Suivez la performance : taux de validation, nombre de ménages par prestataire, temps moyen d\'exécution.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'done',
          target: null,
          title: '🎉 C\'est prêt !',
          text: 'Astuce : un QR code par logement permet aux prestataires de scanner et d\'accéder directement à leur checklist.',
          position: 'center',
          isLast: true,
        },
      ],
    },

    /* ── WELCOME (Livrets d'accueil) ─────────────────────── */
    'welcome.html': {
      storageKey: 'bh_ob_welcome_v1',
      steps: [
        {
          id: 'welcome',
          target: null,
          title: '📖 Livrets d\'accueil numériques',
          text: 'Offrez à vos voyageurs toutes les infos de leur séjour via un simple lien ou QR code. Tour rapide.',
          position: 'center',
        },
        {
          id: 'tip-banner',
          target: () => document.getElementById('welcomeTipBanner'),
          mobile_target: () => document.getElementById('welcomeTipBanner'),
          title: '✨ Le concept',
          text: 'Un livret digital accessible sans application, partageable par lien ou QR code. Lien personnalisé, toujours à jour, et bonus : un code -10% pour inciter à la résa directe.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'create-cta',
          target: () => document.querySelector('.welcome-tip-cta'),
          mobile_target: () => document.querySelector('.welcome-tip-cta'),
          title: '➕ Créer votre premier livret',
          text: 'Lancez le wizard en 5 étapes : infos générales, accès & arrivée, le logement, aspects pratiques, alentours. Comptez 10-15 minutes pour un livret complet.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'done',
          target: null,
          title: '🎉 Votre livret, votre signature',
          text: 'Astuce : une fois créé, vous pouvez modifier le livret à tout moment. Les voyageurs voient toujours la dernière version via le même lien.',
          position: 'center',
          isLast: true,
        },
      ],
    },

    /* ── SETTINGS (Mes logements) ─────────────────────────── */
    'settings.html': {
      storageKey: 'bh_ob_settings_v1',
      steps: [
        {
          id: 'welcome',
          target: null,
          title: '🏠 Vos logements',
          text: 'Configurez chaque bien que vous gérez. Tour rapide.',
          position: 'center',
        },
        {
          id: 'properties-list',
          // Si la grille est vide au premier login, on pointe le header à la place
          target: () => {
            const grid = document.getElementById('propertiesGrid');
            if (grid && grid.children.length > 0) return grid;
            return document.querySelector('.properties-section-header') || grid;
          },
          mobile_target: () => {
            const grid = document.getElementById('propertiesGrid');
            if (grid && grid.children.length > 0) return grid;
            return document.querySelector('.properties-section-header') || grid;
          },
          title: '📋 Votre catalogue',
          text: 'Tous vos logements s\'affichent ici. Touchez une carte pour modifier ses infos : horaires, prix, photos, équipements...',
          position: 'top',
          mobile_position: 'bottom',
        },
        {
          id: 'add-property',
          target: () => document.getElementById('btnAddProperty'),
          mobile_target: () => document.getElementById('btnAddProperty'),
          before: () => {
            // Scroller pour amener le bouton vers le haut du viewport
            // → laisse la place à la bulle en dessous
            const btn = document.getElementById('btnAddProperty');
            if (btn && btn.scrollIntoView) {
              btn.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          },
          title: '➕ Ajouter un logement',
          text: 'Commencez par créer votre premier logement avec le bouton "Ajouter". Vous pourrez ensuite le connecter à Airbnb et Booking.com.',
          position: 'bottom',
          mobile_position: 'bottom',
        },
        {
          id: 'done',
          target: null,
          title: '🎉 C\'est parti !',
          text: 'Astuce : vous pouvez aussi configurer des règles de prix dynamiques (week-end, saison, long séjour) pour chaque logement.',
          position: 'center',
          isLast: true,
        },
      ],
    },

  };

  /* ============================================================
     MOTEUR DE RENDU
     (même mécanique que bh-onboarding-17.js : clone flottant desktop
      + outline direct mobile + gestion overlay/bulle)
     ============================================================ */

  let currentTour = null;   // config de la page en cours
  let currentStep = 0;
  let overlayEl, bubbleEl, cloneEl;
  let _highlightedEl = null;
  let _highlightedStyle = {};

  /* ── Styles ───────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('bh-tour-pages-style')) return;
    const s = document.createElement('style');
    s.id = 'bh-tour-pages-style';
    s.textContent = `
      #bh-tour-overlay {
        position: fixed; inset: 0; z-index: 100000;
        background: rgba(13,17,23,0.75);
        pointer-events: none;
      }
      #bh-tour-clone-wrap {
        position: fixed; z-index: 100002;
        pointer-events: none;
        transition: top .3s ease, left .3s ease, width .3s ease, height .3s ease;
      }
      #bh-tour-clone-wrap img { pointer-events: none; }
      #bh-tour-bubble {
        position: fixed; z-index: 2147483647;
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

  /* ── DOM ──────────────────────────────────────────────── */
  function createDOM() {
    overlayEl = document.createElement('div');
    overlayEl.id = 'bh-tour-overlay';
    bubbleEl = document.createElement('div');
    bubbleEl.id = 'bh-tour-bubble';
    document.body.appendChild(overlayEl);
    document.body.appendChild(bubbleEl);
  }

  /* ── Highlight / Spotlight (unifié desktop + mobile) ──── */
  function showClone(targetEl) {
    removeClone();
    if (!targetEl) return;
    const r = targetEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    // SPOTLIGHT : on découpe un "trou" dans l'overlay autour de la cible
    // → la cible apparaît telle quelle, à sa vraie place, dans ses vraies couleurs
    const padding = 6;
    const radius  = 12;
    const x = Math.max(0, r.left - padding);
    const y = Math.max(0, r.top - padding);
    const w = r.width  + padding * 2;
    const h = r.height + padding * 2;

    // 1) Overlay découpé via clip-path
    const W = window.innerWidth;
    const H = window.innerHeight;
    const clip = `polygon(
      0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0,
      ${x}px ${y}px,
      ${x}px ${y+h}px,
      ${x+w}px ${y+h}px,
      ${x+w}px ${y}px,
      ${x}px ${y}px
    )`;
    if (overlayEl) {
      overlayEl.style.clipPath = clip;
      overlayEl.style.webkitClipPath = clip;
    }

    // 2) Cadre vert par-dessus
    cloneEl = document.createElement('div');
    cloneEl.id = 'bh-tour-clone-wrap';
    cloneEl.style.cssText = `
      top: ${y}px;
      left: ${x}px;
      width: ${w}px;
      height: ${h}px;
      border-radius: ${radius}px;
      outline: 3px solid #1A7A5E;
      outline-offset: 0;
      box-shadow: 0 0 0 4px rgba(26,122,94,0.25);
      background: transparent;
      pointer-events: none;
    `;
    document.body.appendChild(cloneEl);
  }

  function removeClone() {
    const old = document.getElementById('bh-tour-clone-wrap');
    if (old) old.remove();
    cloneEl = null;
    // Reset spotlight (si étape précédente en avait créé un)
    if (overlayEl) {
      overlayEl.style.clipPath = '';
      overlayEl.style.webkitClipPath = '';
    }
    if (_highlightedEl) {
      if (_highlightedStyle._container) {
        _highlightedStyle._container.style.zIndex = _highlightedStyle._containerZ || '';
      }
      ['outline','outlineOffset','boxShadow','borderRadius','position','zIndex','background','backgroundColor'].forEach(k => {
        if (k in _highlightedStyle) {
          _highlightedEl.style[k] = _highlightedStyle[k] || '';
        }
      });
      _highlightedEl = null;
      _highlightedStyle = {};
    }
  }

  /* ── Positionnement bulle desktop ─────────────────────── */
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
    } else if (position === 'left') {
      left = r.left - bW - 16; top = r.top + r.height/2 - bH/2;
      arrow.style.cssText = 'right:-7px;top:50%;transform:translateY(-50%) rotate(45deg);border-top:1px solid #f3f4f6;border-right:1px solid #f3f4f6;';
    } else {
      top = r.bottom + 16; left = r.left + r.width/2 - bW/2;
    }

    left = Math.max(margin, Math.min(left, window.innerWidth - bW - margin));
    top  = Math.max(margin, Math.min(top, window.innerHeight - bH - margin));
    bubbleEl.style.top = top+'px'; bubbleEl.style.left = left+'px';
    bubbleEl.style.right = 'auto'; bubbleEl.style.bottom = 'auto';
    bubbleEl.appendChild(arrow);
  }

  /* ── Positionnement bulle mobile ──────────────────────── */
  function positionMobile(targetEl, forceTop) {
    bubbleEl.querySelectorAll('.t-arrow').forEach(a => a.remove());
    if (!targetEl) {
      bubbleEl.style.top = '50%'; bubbleEl.style.bottom = 'auto';
      bubbleEl.style.transform = 'translateY(-50%)';
      return;
    }
    bubbleEl.style.transform = '';
    const r = targetEl.getBoundingClientRect();
    const bH = bubbleEl.offsetHeight || 200;
    const bottomBarH = 90;
    const topBarH = 70;

    if (forceTop) {
      bubbleEl.style.top = (topBarH + 12) + 'px';
      bubbleEl.style.bottom = 'auto';
      return;
    }

    const spaceBelow = window.innerHeight - r.bottom - bottomBarH;
    const spaceAbove = r.top - topBarH;

    if (spaceBelow >= bH + 16) {
      bubbleEl.style.top = (r.bottom + 12) + 'px';
      bubbleEl.style.bottom = 'auto';
    } else if (spaceAbove >= bH + 16) {
      bubbleEl.style.bottom = (window.innerHeight - r.top + 12) + 'px';
      bubbleEl.style.top = 'auto';
    } else {
      bubbleEl.style.bottom = (bottomBarH + 12) + 'px';
      bubbleEl.style.top = 'auto';
    }
  }

  /* ── Contenu de la bulle ──────────────────────────────── */
  function renderBubble(step, index) {
    const steps = currentTour.steps;
    const total = steps.length;
    const isLast = step.isLast || index === total - 1;
    bubbleEl.innerHTML = `
      <div class="t-badge">Étape ${index+1} sur ${total}</div>
      <div class="t-title">${step.title}</div>
      <div class="t-text">${step.text}</div>
      <div class="t-footer">
        <div class="t-dots">${steps.map((_,i)=>`<div class="t-dot ${i===index?'on':''}"></div>`).join('')}</div>
        <div class="t-actions">
          ${!isLast?`<button class="t-skip" onclick="window.__bhPagesTour.skip()">Passer</button>`:''}
          <button class="t-next ${isLast?'t-finish':''}" onclick="window.__bhPagesTour.next()">
            ${isLast?'<i class="fas fa-check"></i> Terminer':'Suivant <i class="fas fa-arrow-right"></i>'}
          </button>
        </div>
      </div>`;
  }

  /* ── Rendu d'une étape ────────────────────────────────── */
  async function renderStep(index) {
    const step = currentTour.steps[index];
    const mobile = IS_MOBILE();

    removeClone();

    // Hook "before" : permet de switcher de panel/onglet avant le rendu
    if (typeof step.before === 'function') {
      try { step.before(); } catch (e) { console.warn('[bh-tour] step.before failed', e); }
    }

    const position = mobile
      ? (step.mobile_position || step.position || 'top')
      : step.position;

    renderBubble(step, index);

    // Laisser le temps au DOM de refléter le switch de panel
    const extraDelay = step.before ? 200 : 0;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => {
        const resolvedTarget = mobile
          ? (step.mobile_target ? step.mobile_target() : null)
          : (step.target ? step.target() : null);

        if (!mobile) {
          // petit scroll pour mettre la cible en vue si besoin
          if (resolvedTarget && resolvedTarget.scrollIntoView) {
            const r = resolvedTarget.getBoundingClientRect();
            if (r.top < 80 || r.bottom > window.innerHeight - 80) {
              resolvedTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
          setTimeout(() => {
            showClone(resolvedTarget);
            positionDesktop(resolvedTarget, position);
          }, 300);
        } else {
          if (resolvedTarget && resolvedTarget.scrollIntoView) {
            const r = resolvedTarget.getBoundingClientRect();
            if (r.top < 80 || r.bottom > window.innerHeight - 120) {
              resolvedTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
          setTimeout(() => {
            showClone(resolvedTarget);
            positionMobile(resolvedTarget, false);
          }, 300);
        }
      }, extraDelay);
    }));
  }

  /* ── Lifecycle ────────────────────────────────────────── */
  function start(tour) {
    currentTour = tour;
    ['bh-tour-overlay','bh-tour-bubble','bh-tour-clone-wrap'].forEach(id => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    injectStyles();
    createDOM();
    currentStep = 0;
    if (typeof currentTour.onStart === 'function') {
      try { currentTour.onStart(); } catch (e) {}
    }
    renderStep(0);
  }

  function next() {
    currentStep++;
    if (currentStep >= currentTour.steps.length) finish();
    else renderStep(currentStep);
  }

  function finish() {
    if (currentTour && currentTour.storageKey) {
      localStorage.setItem(currentTour.storageKey, '1');
    }
    removeClone();
    ['bh-tour-overlay','bh-tour-bubble'].forEach(id => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    if (currentTour && typeof currentTour.onFinish === 'function') {
      try { currentTour.onFinish(); } catch (e) {}
    }
    overlayEl = bubbleEl = null;
    currentTour = null;
  }

  function skip() { finish(); }

  /* ── API publique (pour relancer manuellement depuis les paramètres) */
  window.__bhPagesTour = {
    next, skip, finish,
    startForPage: (filename) => {
      const tour = PAGE_TOURS[filename];
      if (tour) start(tour);
    },
    resetPage: (filename) => {
      const tour = PAGE_TOURS[filename];
      if (tour && tour.storageKey) localStorage.removeItem(tour.storageKey);
    },
  };

  /* ── Auto-start basé sur la page courante ─────────────── */
  function detectPageFilename() {
    const path = location.pathname || '';
    const match = path.match(/([^\/]+\.html)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function maybeStart() {
    const filename = detectPageFilename();
    const tour = PAGE_TOURS[filename];
    if (!tour) return;
    if (localStorage.getItem(tour.storageKey)) return;

    // Attendre que la page soit prête (éléments clés rendus)
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      // Heuristique : on attend le premier target non-null du tour
      const firstTargetStep = tour.steps.find(s => s.target || s.mobile_target);
      const mobile = IS_MOBILE();
      const ready = firstTargetStep
        ? (mobile
            ? (firstTargetStep.mobile_target && firstTargetStep.mobile_target())
            : (firstTargetStep.target && firstTargetStep.target()))
        : true;
      if (ready || tries > 30) {
        clearInterval(t);
        setTimeout(() => start(tour), 700);
      }
    }, 200);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', maybeStart)
    : maybeStart();

})();

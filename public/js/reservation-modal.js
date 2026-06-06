// reservation-modal.js — Extracted from app.html
// Correction du modal de détails de réservation - Version 2
(function() {
  let currentBookingData = null;
  let cachedCleaners = null; // Cache pour éviter de recharger à chaque fois
  
  // Fonction pour charger les cleaners une seule fois
  async function loadCleaners() {
    if (cachedCleaners !== null) return cachedCleaners; // Déjà chargé
    
    try {
      const token = localStorage.getItem('lcc_token');
      if (token && typeof API_URL !== 'undefined') {
        const response = await fetch(`${API_URL}/api/cleaners`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (response.ok) {
          const data = await response.json();
          cachedCleaners = data.cleaners || [];
          console.log('👷 Cleaners chargés depuis API:', cachedCleaners);
          return cachedCleaners;
        }
      }
    } catch (e) {
      console.log('⚠️ Erreur chargement cleaners depuis API');
    }
    
    // Fallback localStorage
    try {
      cachedCleaners = JSON.parse(localStorage.getItem('lcc_cleaners') || '[]');
    } catch (e) {
      cachedCleaners = [];
    }
    return cachedCleaners;
  }
  
  document.addEventListener('DOMContentLoaded', function() {
  // Intercepter les clics sur les booking-blocks (tous types)
  document.addEventListener('click', function(e) {
    const bookingBlock = e.target.closest('.booking-block, .booking-block-bh');
    if (!bookingBlock) return;

    const found = findReservationForBlock(bookingBlock);

    if (found) {
      currentBookingData = found;
      window.currentBookingData = found;
      console.log('📦 currentBookingData défini via findReservationForBlock :', found.uid, '| notes:', found.notes);
      if (typeof updateInvoiceBtn === 'function') updateInvoiceBtn(found);
    } else {
      // Ne pas écraser window.currentBookingData si openBooking() l'a déjà peuplé
      // (les blocs du nouveau calendrier passent par openBooking(r) directement,
      //  pas par .booking-block, donc findReservationForBlock renvoie null)
      if (window.currentBookingData) {
        currentBookingData = window.currentBookingData;
        console.log('📦 currentBookingData depuis openBooking (fallback) :', currentBookingData.uid, '| notes:', currentBookingData.notes);
      } else {
        currentBookingData = null;
      }
    }

    // On laisse un peu de temps au modal pour se remplir, puis on le corrige
    setTimeout(() => fixModalContent(bookingBlock), 200);
  });
});

function findReservationForBlock(bookingBlock) {
  if (!bookingBlock) return null;

  const bookingIdAttr = bookingBlock.getAttribute('data-booking-id');
  if (!bookingIdAttr) return null;

  // Priorité 1: Chercher dans window.__bhCalendarState.bookings (source de vérité à jour)
  let bookings = [];
  if (window.__bhCalendarState && Array.isArray(window.__bhCalendarState.bookings) && window.__bhCalendarState.bookings.length) {
    bookings = window.__bhCalendarState.bookings;
    console.log('🎯 Utilisation de window.__bhCalendarState.bookings avec', bookings.length, 'réservations');
  }
  // Fallback: réservations brutes si calendarState n\'est pas disponible
  else if (Array.isArray(window.LCC_RESERVATIONS) && window.LCC_RESERVATIONS.length) {
    bookings = window.LCC_RESERVATIONS;
    console.log('⚠️ Fallback sur LCC_RESERVATIONS');
  } else {
    try {
      bookings = JSON.parse(localStorage.getItem('LCC_RESERVATIONS') || '[]');
      console.log('⚠️ Fallback sur localStorage');
    } catch (e) {
      bookings = [];
    }
  }

  const idStr = String(bookingIdAttr);
  let found = null;

  if (Array.isArray(bookings)) {
    // 1) Correspondance par id / uid / reservationKey
    found = bookings.find((r) => {
      if (!r) return false;
      const rid = r.id != null ? String(r.id) : null;
      const uid = r.uid != null ? String(r.uid) : null;
      const rkey = r.reservationKey != null ? String(r.reservationKey) : null;
      return idStr === rid || idStr === uid || idStr === rkey;
    });

    /// Pas de fallback par index — évite de mélanger les résas
  }

  if (!found) {
    console.log('⚠️ Aucune réservation trouvée pour data-booking-id =', bookingIdAttr);
  } else {
    console.log('✅ Réservation trouvée pour data-booking-id =', bookingIdAttr, found);
  }

  return found || null;
}
  window.fixModalContent = async function fixModalContent(bookingBlock) {
  const detailsModal   = document.getElementById('reservationDetailsModal');
  const detailsContent = document.getElementById('reservationDetailsContent');

  if (!detailsModal || !detailsContent) {
    console.log('⚠️ Modal de détails introuvable (#reservationDetailsModal)');
    return;
  }

  // Petit délai pour laisser currentBookingData se mettre à jour par les autres scripts
  setTimeout(async function () {
    const booking =
      window.currentBookingData ||
      window.currentBooking ||
      (typeof currentBookingData !== 'undefined' ? currentBookingData : null);

    if (!booking) {
      console.log('⚠️ Pas de currentBookingData dans fixModalContent, on sort');
      return;
    }

    // 1️⃣ Récupération du propertyId
    function getReservationPropertyId(res) {
      if (!res) return null;
      if (res.propertyId != null) return String(res.propertyId);
      if (res.property && res.property.id != null) return String(res.property.id);
      if (res.property_id != null) return String(res.property_id);
      return null;
    }

    let propertyId = getReservationPropertyId(booking);

    // Fallback : depuis la ligne du calendrier si besoin
    if (!propertyId && bookingBlock) {
      const row = bookingBlock.closest('[data-property-id]');
      if (row) {
        propertyId = row.getAttribute('data-property-id');
      }
    }

    // 2️⃣ Récupération du nom de logement
    let propertyName = null;

    if (booking.propertyName) {
      propertyName = booking.propertyName;
    } else if (booking.property) {
      if (typeof booking.property === 'string') {
        propertyName = booking.property;
      } else {
        propertyName =
          booking.property.internalName ||
          booking.property.internal_name ||
          booking.property.name ||
          booking.property.title ||
          booking.property.label ||
          '';
      }
    }

    // Fallback via LCC_PROPERTIES
    if (!propertyName && propertyId) {
      let properties = [];
      try {
        if (Array.isArray(window.LCC_PROPERTIES) && window.LCC_PROPERTIES.length) {
          properties = window.LCC_PROPERTIES;
        } else {
          properties = JSON.parse(localStorage.getItem('LCC_PROPERTIES') || '[]');
        }
      } catch (e) {
        properties = [];
      }

      if (Array.isArray(properties) && properties.length) {
        const p = properties.find(
          (x) =>
            String(x.id) === String(propertyId) ||
            String(x.propertyId) === String(propertyId) ||
            String(x.property_id) === String(propertyId)
        );
        if (p) {
          propertyName = p.internalName || p.internal_name || p.name || p.title || p.label || '';
        }
      }
    }

    console.log('🏠 propertyName calculé pour le modal :', {
      propertyName,
      propertyId,
      booking,
    });

// ✅ AJOUTE CES LIGNES
console.log('👤 DEBUG GUEST:', {
  guest_display_name: booking.guest_display_name,
  guest_first_name: booking.guest_first_name,
  guest_last_name: booking.guest_last_name,
  guestName: booking.guestName
});
    // 3️⃣ Infos de base
    const rawStart = booking.start || booking.startDate;
    const rawEnd   = booking.end   || booking.endDate;

    const start = rawStart ? new Date(rawStart).toLocaleDateString('fr-FR') : '';
    const end   = rawEnd   ? new Date(rawEnd).toLocaleDateString('fr-FR')   : '';

    // ✅ Utiliser les nouvelles fonctions helpers
    const guest = window.cleanGuestName(booking);
    const guestInitial = window.getGuestInitial(booking);
    const guestPhone = window.getGuestPhone(booking);
    // Numéro nettoyé pour le lien tel: (garde chiffres et +, retire espaces/points/parenthèses)
    const telHref = guestPhone ? String(guestPhone).replace(/[^\d+]/g, '') : '';

    const platformRaw = booking.source || booking.platform || 'Direct';
    // Chercher ota_name sous toutes ses formes possibles
    const otaName = booking.ota_name || booking.otaName || booking.OtaName
      || (booking.channex && booking.channex.ota_name)
      || null;
    const platformKey = (function normPlatformModal(raw, ota) {
      // Priorité 1 : ota_name Channex (le plus fiable)
      if (ota) {
        var o = String(ota).toUpperCase().trim();
        if (o === 'ABB' || o.includes('AIRBNB'))   return 'airbnb';
        if (o === 'BDC' || o.includes('BOOKING'))  return 'booking';
        if (o === 'EXP' || o.includes('EXPEDIA'))  return 'expedia';
        if (o === 'VRBO' || o === 'HOMEAWAY' || o.includes('VRBO')) return 'vrbo';
        if (o.includes('ABRITEL')) return 'abritel';
      }
      // Priorité 2 : champ source/platform
      if (!raw) return 'direct';
      var v = String(raw).toLowerCase().trim();
      if (v === 'channex') return 'direct'; // channex sans ota_name = direct
      if (v.includes('airbnb'))  return 'airbnb';
      if (v.includes('booking')) return 'booking';
      if (v.includes('expedia')) return 'expedia';
      if (v.includes('vrbo') || v.includes('homeaway')) return 'vrbo';
      if (v.includes('abritel')) return 'abritel';
      if (v === 'guest_app' || v.includes('bhguest') || v.includes('boostinghost_guest') || v.includes('boostinghost guest')) return 'bhguest';
      if (v === 'bhguest_hold' || v === 'hold') return 'bhguest-hold';
      return 'direct';
    })(platformRaw, otaName);

    const PLATFORM_CONFIG = {
      airbnb:  { label: 'Airbnb',       bg: 'linear-gradient(135deg,#FF5A5F,#E84C50)', color: '#fff', icon: 'fa-brands fa-airbnb' },
      booking: { label: 'Booking.com',   bg: 'linear-gradient(135deg,#003580,#00224F)', color: '#fff', icon: 'fas fa-bed' },
      expedia: { label: 'Expedia',       bg: 'linear-gradient(135deg,#FFC72C,#FFB000)', color: '#1a1a1a', icon: 'fas fa-plane' },
      vrbo:    { label: 'Vrbo',          bg: 'linear-gradient(135deg,#1569C7,#0E4C99)', color: '#fff', icon: 'fas fa-home' },
      abritel: { label: 'Abritel',       bg: 'linear-gradient(135deg,#0096D6,#0077B3)', color: '#fff', icon: 'fas fa-house' },
      direct:   { label: 'Direct',        bg: 'linear-gradient(135deg,#1A7A5E,#0f5c46)', color: '#fff', icon: 'fas fa-user' },
      bhguest:  { label: 'BHGuest',       bg: 'linear-gradient(135deg,#7C3AED,#5B21B6)', color: '#fff', icon: 'fas fa-globe' },
    };
    const pc = PLATFORM_CONFIG[platformKey] || PLATFORM_CONFIG.direct;

    // Infos voyageur
    const guestEmail = booking.guestEmail || booking.guest_email || booking.email || null;
    const createdAt = booking.createdAt || booking.created_at || booking.booked_at || null;
    const createdAtFmt = createdAt ? new Date(createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : null;

    // Prix
    const price  = booking.amount_total || booking.price || booking.amount || booking.totalPrice || booking.total_price || null;
    const priceFormatted = price != null
      ? Number(price).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
      : null;

    // Nuits
    let nights = booking.nights || booking.nightCount || booking.night_count || null;
    if (!nights && rawStart && rawEnd) {
      const ms = new Date(rawEnd).getTime() - new Date(rawStart).getTime();
      nights = Math.max(1, Math.round(ms / 86400000));
    }

    // Notes
    const notes = booking.notes || booking.note || booking.comment || booking.comments || booking.description || booking.internal_notes || booking.internalNotes || '';

    // Channex OTA reservation ID
    const otaReservationId = booking.ota_reservation_id || booking.otaReservationId || null;

    // ── Données enrichies Channex ─────────────────────────────
    const guestCountryCode = booking.guest_country || null;
    const guestFirstName   = booking.guest_first_name || null;
    const guestLastName    = booking.guest_last_name  || null;
    const occupancyAdults  = booking.occupancy_adults || null;
    const occupancyChildren= booking.occupancy_children || 0;

    // Montants détaillés
    const amountTotal    = booking.amount_total    || booking.amount || booking.price || null;
    const amountRooms    = booking.amount_rooms    || null;
    const amountTaxes    = booking.amount_taxes    || null;
    const amountCleaning = booking.amount_cleaning || null;
    const otaCommission  = booking.ota_commission  || null;
    const hostPayout     = booking.host_payout     || null;
    const currency       = booking.currency        || 'EUR';
    const daysBreakdown  = booking.days_breakdown  || null;
    const airbnbData     = booking.airbnb_data     || null;

    // Nationalité : convertir code ISO → nom pays en français
    const countryNames = {
      FR:'France', GB:'Royaume-Uni', DE:'Allemagne', ES:'Espagne', IT:'Italie',
      US:'États-Unis', NL:'Pays-Bas', BE:'Belgique', CH:'Suisse', PT:'Portugal',
      CA:'Canada', AU:'Australie', JP:'Japon', CN:'Chine', BR:'Brésil',
      MX:'Mexique', RU:'Russie', IN:'Inde', ZA:'Afrique du Sud', MA:'Maroc',
      TN:'Tunisie', DZ:'Algérie', SN:'Sénégal', CI:'Côte d’Ivoire',
      LU:'Luxembourg', IE:'Irlande', SE:'Suède', NO:'Norvège', DK:'Danemark',
      FI:'Finlande', PL:'Pologne', CZ:'Tchéquie', AT:'Autriche', GR:'Grèce',
      TR:'Turquie', AE:'Émirats arabes unis', SG:'Singapour', KR:'Corée du Sud',
    };
    const guestCountryName = guestCountryCode ? (countryNames[guestCountryCode] || guestCountryCode) : null;
    const guestCountryFlag = guestCountryCode
      ? guestCountryCode.toUpperCase().replace(/./g, c => String.fromCodePoint(c.charCodeAt(0) + 127397))
      : null;

    function fmtAmount(val) {
      if (val == null || val === '' || isNaN(Number(val))) return null;
      return Number(val).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    }

    const _canViewFinances = (() => {
      try {
        const isSubAcc = localStorage.getItem('lcc_is_sub_account') === 'true'
                      || localStorage.getItem('lcc_account_type') === 'sub';
        if (!isSubAcc) return true;
        const _sd = JSON.parse(localStorage.getItem('lcc_sub_account') || '{}');
        const perms = JSON.parse(localStorage.getItem('lcc_permissions') || '{}');
        const p = Object.keys(perms).length > 0 ? perms : (_sd.permissions || {});
        return p.can_view_finances === true;
      } catch(e) { return true; }
    })();


    const amountTotalFmt    = fmtAmount(amountTotal);
    const amountRoomsFmt    = fmtAmount(amountRooms);
    const amountTaxesFmt    = fmtAmount(amountTaxes);
    const amountCleaningFmt = fmtAmount(amountCleaning);
    const otaCommissionFmt  = fmtAmount(otaCommission);
    const hostPayoutFmt     = fmtAmount(hostPayout);

    // Prix par nuit depuis days_breakdown
    let nightsBreakdownHTML = '';
    if (daysBreakdown && typeof daysBreakdown === 'object') {
      const entries = Object.entries(daysBreakdown).sort(([a],[b]) => a.localeCompare(b));
      if (entries.length > 0) {
        nightsBreakdownHTML = entries.map(([date, price]) => {
          const d = new Date(date).toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
          return '<div style="display:flex;justify-content:space-between;font-size:12px;color:#6b7280;padding:2px 0;">'
            + '<span>' + d + '</span><span>' + fmtAmount(price) + '</span>'
            + '</div>';
        }).join('');
      }
    }

    // ── Somme réelle des nuits (corrige amount_rooms qui contient parfois le brut total) ──
    let nightsSum = null;
    if (daysBreakdown && typeof daysBreakdown === 'object') {
      const _vals = Object.values(daysBreakdown).map(v => parseFloat(v)).filter(v => !isNaN(v));
      if (_vals.length) nightsSum = +_vals.reduce((a, b) => a + b, 0).toFixed(2);
    }
    // "Nuits" affiché = somme réelle si dispo, sinon amount_rooms
    const roomsDisplay    = (nightsSum != null) ? nightsSum : amountRooms;
    const roomsDisplayFmt = fmtAmount(roomsDisplay);

    // ── Net hôte : vrai payout si fourni par le backend, sinon estimation ──
    let hostNet = null, hostNetIsEstimate = false, hostNetPayFee = 0;
    {
      const _gross = parseFloat(amountTotal);
      const _comm  = parseFloat(otaCommission) || 0;
      const _tax   = parseFloat(amountTaxes)   || 0;
      if (hostPayout != null && !isNaN(parseFloat(hostPayout))) {
        hostNet = +parseFloat(hostPayout).toFixed(2);            // valeur réelle (backend)
      } else if (!isNaN(_gross) && _gross > 0) {
        const _plat = (booking.platform || booking.source || '').toLowerCase();
        if (_plat.includes('booking')) {
          // Frais de paiement Booking ≈ 8,24 % de la commission (déduit du relevé mensuel)
          hostNetPayFee = +(_comm * 0.0824).toFixed(2);
        } else if (_plat.includes('airbnb')) {
          hostNetPayFee = 0;                                     // Airbnb reverse déjà net
        } else {
          hostNetPayFee = +(_gross * 0.015).toFixed(2);         // direct / Stripe ≈ 1,5 %
        }
        hostNet = +(_gross - _comm - _tax - hostNetPayFee).toFixed(2);
        hostNetIsEstimate = true;
      }
    }
    const hostNetFmt = fmtAmount(hostNet);

    // 4️⃣ Contenu "de base" du modal
    detailsContent.innerHTML = `

      <!-- ── HERO : avatar + nom + badge plateforme ── -->
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid rgba(200,184,154,.35);">
        <!-- Avatar -->
        <div style="
          width:52px;height:52px;border-radius:16px;flex-shrink:0;
          background:${pc.bg};color:${pc.color};
          display:flex;align-items:center;justify-content:center;
          font-weight:800;font-size:20px;letter-spacing:-.5px;
          box-shadow:0 4px 12px rgba(0,0,0,.12);
        ">${guestInitial}</div>

        <!-- Nom + meta -->
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:17px;color:#111827;line-height:1.2;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${guest}</div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${occupancyAdults ? `<span style="font-size:12px;color:#6B7280;display:flex;align-items:center;gap:3px;"><i class="fas fa-user" style="font-size:10px;opacity:.7;"></i> ${occupancyAdults}${occupancyChildren ? '+'+occupancyChildren : ''}</span>` : ''}
            ${guestCountryFlag ? `<span style="font-size:13px;">${guestCountryFlag} <span style="font-size:12px;color:#6B7280;">${guestCountryName}</span></span>` : ''}
            ${guestPhone && guestPhone !== 'Non renseigné' ? `<a href="tel:${telHref}" onclick="event.stopPropagation();" style="font-size:12px;color:#1A7A5E;text-decoration:none;display:flex;align-items:center;gap:3px;-webkit-touch-callout:default;"><i class="fas fa-phone" style="font-size:10px;"></i> ${guestPhone}</a>` : ''}
          </div>
        </div>

        <!-- Badge plateforme + prix -->
        <div style="text-align:right;flex-shrink:0;">
          <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;background:${pc.bg};color:${pc.color};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px;">
            <i class="${pc.icon}" style="font-size:11px;"></i> ${pc.label}
          </div>
          ${(priceFormatted && _canViewFinances) ? `<div style="font-size:19px;font-weight:800;color:#1A7A5E;line-height:1;">${priceFormatted}</div>` : ''}
          ${nights ? `<div style="font-size:11px;color:#9CA3AF;margin-top:1px;">${nights} nuit${nights>1?'s':''}</div>` : ''}
        </div>
      </div>

      <!-- ── LOGEMENT + DATES ── -->
      <div data-info-cards="1" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px;">
        <!-- Logement -->
        <div style="background:rgba(255,255,255,.55);border-radius:14px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Logement</div>
          <div style="font-size:14px;font-weight:700;color:#111827;">${propertyName || '—'}</div>
        </div>
        <!-- Arrivée -->
        <div style="background:rgba(255,255,255,.55);border-radius:14px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Arrivée</div>
          <div style="font-size:14px;font-weight:700;color:#111827;">${start}</div>
        </div>
        <!-- Départ -->
        <div style="background:rgba(255,255,255,.55);border-radius:14px;padding:12px 14px;">
          <div style="font-size:10px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Départ</div>
          <div style="font-size:14px;font-weight:700;color:#111827;">${end}</div>
        </div>
      </div>

      <!-- ── EMAIL + DATE RÉSERVATION ── -->
      ${(guestEmail || createdAtFmt) ? `
        <div style="margin-bottom:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          ${guestEmail ? `
            <a href="mailto:${guestEmail}" style="display:inline-flex;align-items:center;gap:7px;padding:8px 13px;background:rgba(255,255,255,.55);border-radius:10px;font-size:12px;color:#1A7A5E;text-decoration:none;font-weight:500;">
              <i class="fas fa-envelope" style="font-size:11px;opacity:.8;"></i> ${guestEmail}
            </a>
          ` : ''}
          ${createdAtFmt ? `
            <div style="display:inline-flex;align-items:center;gap:7px;padding:8px 13px;background:rgba(255,255,255,.55);border-radius:10px;font-size:12px;color:#6B7280;font-weight:500;">
              <i class="fas fa-calendar-plus" style="font-size:11px;opacity:.8;"></i> Réservé le ${createdAtFmt}
            </div>
          ` : ''}
        </div>
      ` : ''}

      <!-- ── PRIX DÉTAILLÉ — masqué pour sous-comptes sans can_view_finances ── -->
      ${(amountTotalFmt && _canViewFinances) ? `
        <div style="background:rgba(255,255,255,.55);border-radius:16px;padding:14px 16px;margin-bottom:18px;">
          <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Prix détaillé</div>

          ${roomsDisplayFmt ? `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.05);">
              <span style="color:#6B7280;display:flex;align-items:center;gap:6px;"><i class="fas fa-moon" style="width:12px;opacity:.5;"></i> Nuits</span>
              <span style="font-weight:600;">${roomsDisplayFmt}</span>
            </div>
          ` : ''}

          ${nightsBreakdownHTML ? `
            <div style="padding:4px 0 4px 18px;border-bottom:1px solid rgba(0,0,0,.05);">${nightsBreakdownHTML}</div>
          ` : ''}

          ${amountCleaningFmt ? `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.05);">
              <span style="color:#6B7280;display:flex;align-items:center;gap:6px;"><i class="fas fa-broom" style="width:12px;opacity:.5;"></i> Ménage</span>
              <span style="font-weight:600;">${amountCleaningFmt}</span>
            </div>
          ` : ''}

          ${amountTaxesFmt ? `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.05);">
              <span style="color:#6B7280;display:flex;align-items:center;gap:6px;"><i class="fas fa-landmark" style="width:12px;opacity:.5;"></i> Taxe séjour</span>
              <span style="font-weight:600;">${amountTaxesFmt}</span>
            </div>
          ` : ''}

          ${otaCommissionFmt ? `
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.05);">
              <span style="color:#6B7280;display:flex;align-items:center;gap:6px;"><i class="fas fa-percent" style="width:12px;opacity:.5;"></i> Commission OTA</span>
              <span style="font-weight:600;color:#EF4444;">${otaCommissionFmt}</span>
            </div>
          ` : ''}

          <div style="display:flex;justify-content:space-between;padding:9px 0 2px;margin-top:2px;">
            <span style="font-size:13px;font-weight:700;color:#111827;">Total</span>
            <span style="font-size:15px;font-weight:800;color:#1A7A5E;">${amountTotalFmt}</span>
          </div>

          ${(() => {
            const payments = booking.payments || [];
            const hasPaid = payments.some(p => p.status === 'paid');
            const hasPending = payments.some(p => p.status === 'pending' || p.status === 'created');
            const isBHGuestPaid = (booking.source === 'guest_app' || (booking.platform || '').toLowerCase().includes('boostinghost')) && hasPaid;
            if (hasPaid || isBHGuestPaid) {
              return '<div style="display:flex;align-items:center;gap:6px;padding:6px 0 2px;font-size:12px;font-weight:600;color:#059669;"><i class=\"fas fa-check-circle\"></i> Paiement reçu</div>';
            } else if (hasPending) {
              return '<div style="display:flex;align-items:center;gap:6px;padding:6px 0 2px;font-size:12px;font-weight:600;color:#D97706;"><i class=\"fas fa-clock\"></i> Paiement en attente</div>';
            }
            return '';
          })()}

          ${hostNetFmt ? `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0 2px;margin-top:6px;border-top:1px solid rgba(0,0,0,.06);">
              <span style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#111827;">
                <i class="fas fa-wallet" style="width:12px;opacity:.5;"></i> Net hôte
                ${hostNetIsEstimate ? '<span style="font-size:10px;font-weight:600;color:#9CA3AF;background:rgba(0,0,0,.04);padding:1px 6px;border-radius:6px;">estimé</span>' : ''}
              </span>
              <span style="font-size:15px;font-weight:800;color:#1A7A5E;">${hostNetFmt}</span>
            </div>
            ${hostNetIsEstimate ? `<div style="font-size:11px;color:#9CA3AF;padding:1px 0 2px;text-align:right;">après commission${amountTaxes ? ', taxe séjour' : ''}${hostNetPayFee ? ' &amp; frais paiement ≈ ' + fmtAmount(hostNetPayFee) : ''}</div>` : ''}
          ` : ''}
        </div>
      ` : ''}

      <!-- ── NOTES ── -->
      <div class="detail-group" style="margin-bottom:6px;">
        <label style="font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;display:block;">Notes</label>
        ${notes
          ? `<div style="background:rgba(255,255,255,.55);border-radius:12px;padding:12px 14px;font-size:13px;color:#374151;white-space:pre-wrap;line-height:1.5;">${notes}</div>`
          : `<div style="background:rgba(255,255,255,.35);border-radius:12px;padding:10px 14px;font-size:13px;color:#9CA3AF;font-style:italic;">Aucune note</div>`
        }
      </div>
    `;
// =========================
// ✅ Injection RISQUE + CHECKLIST
// =========================
try {
  const token = localStorage.getItem('lcc_token');
  const API = (typeof API_URL !== 'undefined') ? API_URL : '';

  // ----- RISQUE
  const riskScore = booking.riskScore;
  const riskLabel = booking.riskLabel || booking.riskLevel || '';
  const riskLevel = booking.riskLevel || '';
  const riskSummary = booking.riskSummary || '';
  const riskTags = Array.isArray(booking.riskTags) ? booking.riskTags : [];
  const riskRecommendations = Array.isArray(booking.riskRecommendations) ? booking.riskRecommendations : [];

  if (riskScore != null) {
    let riskGroup = detailsContent.querySelector('[data-risk-info="1"]');
    if (!riskGroup) {
      riskGroup = document.createElement('div');
      riskGroup.className = 'detail-group';
      riskGroup.setAttribute('data-risk-info', '1');
      riskGroup.style.marginTop = '24px';
      riskGroup.style.paddingTop = '20px';
      riskGroup.style.borderTop = '1.5px solid rgba(0,0,0,.08)';
      detailsContent.appendChild(riskGroup);
    }

    // Couleur adaptée au niveau de risque
    const barColor = window.riskColor ? window.riskColor(riskLevel) : '#10b981';
    
    const tagsHtml = riskTags.length
      ? `<div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:6px;">
          ${riskTags.map(t => `
            <span style="font-size:11px; font-weight:700; padding:4px 10px; border-radius:999px; background:rgba(0,0,0,.06); color:#374151;">
              ${String(t)}
            </span>`).join('')}
        </div>`
      : '';
    
    const recommendationsHtml = riskRecommendations.length
      ? `<div style="margin-top:12px; padding:12px; background:#fef3c7; border-left:3px solid #f59e0b; border-radius:6px;">
          <div style="font-weight:700; font-size:13px; margin-bottom:8px; color:#92400e;">
            <i class="fas fa-lightbulb"></i> Actions recommandées :
          </div>
          ${riskRecommendations.map(r => `
            <div style="font-size:12px; margin:4px 0; color:#78350f;">
              • ${String(r)}
            </div>`).join('')}
        </div>`
      : '';

    riskGroup.innerHTML = `
      <div style="font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;gap:5px;">
        <i class="fas fa-shield-alt" style="font-size:11px;"></i> Analyse de risque
      </div>
      <div style="background:rgba(255,255,255,.55);border-radius:16px;padding:14px 16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">
          <div>
            <div style="font-weight:800;font-size:17px;color:${barColor};line-height:1.1;">${riskLabel}</div>
            <div style="font-size:12px;color:#9CA3AF;margin-top:2px;">${Math.round(riskScore)}/100${riskSummary ? ' · '+riskSummary : ''}</div>
          </div>
          <div style="min-width:100px;">
            <div style="height:8px;background:rgba(0,0,0,.08);border-radius:99px;overflow:hidden;">
              <div style="height:8px;width:${Math.max(0,Math.min(100,riskScore))}%;background:${barColor};border-radius:99px;transition:width .4s ease;"></div>
            </div>
          </div>
        </div>
        ${tagsHtml}
        ${recommendationsHtml}
      </div>
    `;
  }

  // ----- CHECKLIST
  const reservationUid = booking.uid || booking.reservationKey || booking.id || '';

  if (reservationUid) {
    let chkGroup = detailsContent.querySelector('[data-checklist-info="1"]');
    if (!chkGroup) {
      chkGroup = document.createElement('div');
      chkGroup.className = 'detail-group';
      chkGroup.setAttribute('data-checklist-info', '1');
      detailsContent.appendChild(chkGroup);
    }

    // Chercher la checklist dans le tableau cleaningChecklists
    console.log('🔍 Recherche checklist pour reservationUid:', reservationUid);
    console.log('📋 Checklists disponibles:', window.cleaningChecklists);
    console.log('📦 Booking complet:', booking);
    
    const matchingChecklist = window.cleaningChecklists ? 
      window.cleaningChecklists.find(c => {
        // Stratégie 1: Match par reservation_key exact
        if (c.reservation_key === reservationUid) {
          console.log('✅ Match par reservation_key exact:', c.reservation_key);
          return true;
        }
        
        // Stratégie 2: Match par property_id + checkout_date (les deux obligatoires)
        const bookingPropId = booking.propertyId || booking.property_id || (booking.property && booking.property.id);
        const checklistPropId = c.property_id;
        const checkoutDate = booking.checkoutDate || booking.checkout || booking.end || booking.endDate;

        if (bookingPropId && checklistPropId && bookingPropId === checklistPropId && checkoutDate && c.checkout_date) {
          const normalizeDate = (d) => {
            if (!d) return null;
            if (typeof d === 'string') return d.split('T')[0];
            if (d instanceof Date) return d.toISOString().split('T')[0];
            return null;
          };
          const bookingDateNorm = normalizeDate(checkoutDate);
          const checklistDateNorm = normalizeDate(c.checkout_date);
          if (bookingDateNorm === checklistDateNorm) {
            console.log('✅ Match par property_id + checkout_date:', bookingPropId, bookingDateNorm);
            return true;
          }
        }
        
        return false;
      }) : null;

    console.log('✅ Checklist trouvée:', matchingChecklist);

    if (!matchingChecklist) {
      chkGroup.style.display = 'none'; // Masquer si aucune checklist
    } else {
      chkGroup.style.display = '';
      // Afficher les infos de la checklist
      const tasks = typeof matchingChecklist.tasks === 'string' ? 
        JSON.parse(matchingChecklist.tasks) : (matchingChecklist.tasks || []);
      const isCompleted = matchingChecklist.is_validated || matchingChecklist.completed_at;
      const completedTasks = tasks.filter(t => t.checked).length;
      
      chkGroup.innerHTML = `
        <label><i class="fas fa-list-check"></i> Checklist</label>
        <div class="detail-value">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px;">
            <div>
              <div style="font-weight:600; font-size:14px;">
                ${isCompleted ? '✅ Validée' : '⏳ En attente'}
              </div>
              <div style="font-size:13px; opacity:0.7; margin-top:4px;">
                ${completedTasks}/${tasks.length} tâches effectuées
              </div>
            </div>
            <button 
              onclick="openChecklistDetails('${matchingChecklist.id}')" 
              class="btn btn-primary btn-sm"
              style="padding:6px 12px; font-size:13px;">
              <i class="fas fa-eye"></i> Voir détails
            </button>
          </div>
        </div>
      `;
    }
  }
} catch (e) {
  console.warn('Erreur injection risk/checklist modal', e);
}

    // 5️⃣ Gestion du ménage — clé identique à cleaning.html : propertyId_start_end
    try {
      let statusText = 'Pas encore assigné';
      try {
        const token = localStorage.getItem('lcc_token');
        const resp = await fetch(`${API_URL}/api/cleaning/assignments`, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (resp.ok) {
          const data = await resp.json();
          const assignments=Array.isArray(data.assignments)?data.assignments:[];

          const rawStart=booking.start||booking.startDate||booking.checkIn||booking.checkin||"";
          const rawEnd=booking.end||booking.endDate||booking.checkOut||booking.checkout||"";
          const effPropId=propertyId||booking.propertyId||booking.property_id||(booking.property&&booking.property.id)||null;

          function toISO(v){if(!v)return"";const s=String(v).trim();if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s))return s.slice(0,10);const d=new Date(s);if(isNaN(d.getTime()))return s.slice(0,10);const y=d.getFullYear()<100?new Date().getFullYear():d.getFullYear();return y+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}

          function toTextDate(iso){if(!iso)return"";const d=new Date(iso+"T12:00:00");if(isNaN(d.getTime()))return"";const dy=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];const mo=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];return dy[d.getDay()]+" "+mo[d.getMonth()]+" "+String(d.getDate()).padStart(2,"0");}

          const sISO=toISO(rawStart),eISO=toISO(rawEnd);
          const sTxt=toTextDate(sISO),eTxt=toTextDate(eISO);
          const keyISO=effPropId&&sISO&&eISO?effPropId+"_"+sISO+"_"+eISO:null;
          const keyTxt=effPropId&&sTxt&&eTxt?effPropId+"_"+sTxt+"_"+eTxt:null;

          console.log("DEBUG keyISO:",keyISO);
          console.log("DEBUG keyTxt:",keyTxt);
          console.log("DEBUG sample API keys:",assignments.slice(0,5).map(function(a){return a.reservation_key;}));

          const match=assignments.find(function(a){return a.reservation_key===keyISO||a.reservation_key===keyTxt;});
          console.log("DEBUG match:",match);
          if(match){statusText="Assigné à "+(match.cleaner_name||String(match.cleaner_id));}
        }
      } catch(e) { console.warn('⚠️ Assignments API:', e.message); }

      // Injection / mise à jour du bloc "Ménage" — card moderne
      let group = detailsContent.querySelector('[data-cleaning-info="1"]');
      if (!group) {
        group = document.createElement('div');
        group.setAttribute('data-cleaning-info', '1');
        group.style.cssText = 'margin-bottom:18px;';
        detailsContent.appendChild(group);
      }

      // Déplacer le bloc ménage juste après les 3 cards (logement/arrivée/départ)
      const infoCards = detailsContent.querySelector('[data-info-cards="1"]');
      if (infoCards && infoCards.nextSibling) {
        detailsContent.insertBefore(group, infoCards.nextSibling);
      } else if (infoCards) {
        infoCards.parentNode.insertBefore(group, infoCards.nextSibling);
      }

      const isAssigned = statusText !== 'Pas encore assigné';
      const iconColor  = isAssigned ? '#1A7A5E' : '#9CA3AF';
      const bgColor    = isAssigned ? 'rgba(26,122,94,.08)' : 'rgba(255,255,255,.55)';
      const borderStyle = isAssigned ? '1.5px solid rgba(26,122,94,.25)' : '1.5px solid transparent';

      group.innerHTML = `
        <div style="font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;display:flex;align-items:center;gap:5px;">
          <i class="fas fa-broom" style="font-size:11px;"></i> Ménage
        </div>
        <div style="background:${bgColor};border:${borderStyle};border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:10px;">
          <div style="width:32px;height:32px;border-radius:10px;background:${isAssigned ? 'rgba(26,122,94,.15)' : 'rgba(0,0,0,.06)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-broom" style="font-size:13px;color:${iconColor};"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:${isAssigned ? '600' : '400'};color:${isAssigned ? '#111827' : '#9CA3AF'};">${statusText}</div>
            ${isAssigned ? '<div style="font-size:11px;color:#6B7280;margin-top:1px;">Ménage assigné</div>' : ''}
          </div>
          ${isAssigned ? '<div style="margin-left:auto;width:8px;height:8px;border-radius:50%;background:#1A7A5E;flex-shrink:0;"></div>' : ''}
        </div>
      `;
    } catch (e) {
      console.warn("Erreur lors de l\'injection des infos ménage dans le modal", e);
    }

    // 6️⃣ Lien BHGuest (pré-réservation) — retrouver le lien envoyé au voyageur
    try {
      var _bhSrc = String(booking.source || booking.platform || '').toLowerCase();
      var _bhIsHold = _bhSrc === 'bhguest_hold' || booking.type === 'hold' || booking.status === 'hold'
        || (booking.uid && String(booking.uid).indexOf('hold_') === 0);
      var _bhToken = booking.holdToken || booking.hold_token || booking.link_token;
      var _bhStale = detailsContent.querySelector('[data-bhguest-link="1"]');
      if (_bhStale) _bhStale.remove(); // éviter un lien périmé d'une précédente ouverture
      if (_bhIsHold && _bhToken) {
        var _bhCi = String(booking.startDate || booking.start || booking.checkin || '').split('T')[0];
        var _bhCo = String(booking.endDate || booking.end || booking.checkout || '').split('T')[0];
        var _bhParams = new URLSearchParams();
        _bhParams.set('property', booking.propertyId || booking.property_id || '');
        if (_bhCi) _bhParams.set('checkin', _bhCi);
        if (_bhCo) _bhParams.set('checkout', _bhCo);
        var _bhFp = (booking.fixedPrice != null) ? booking.fixedPrice : booking.fixed_price;
        if (_bhFp) _bhParams.set('fixed_price', _bhFp);
        _bhParams.set('hold_token', _bhToken);
        var _bhLink = 'https://www.boostinghost.fr/guest-app/public/index.html?' + _bhParams.toString();

        var linkGroup = detailsContent.querySelector('[data-bhguest-link="1"]');
        if (!linkGroup) {
          linkGroup = document.createElement('div');
          linkGroup.setAttribute('data-bhguest-link', '1');
          linkGroup.style.cssText = 'margin-bottom:18px;';
          var _bhInfoCards = detailsContent.querySelector('[data-info-cards="1"]');
          if (_bhInfoCards && _bhInfoCards.parentNode) _bhInfoCards.parentNode.insertBefore(linkGroup, _bhInfoCards.nextSibling);
          else detailsContent.appendChild(linkGroup);
        }
        linkGroup.innerHTML =
          '<div style="font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;display:flex;align-items:center;gap:5px;">'
          + '<i class="fas fa-link" style="font-size:11px;"></i> Lien BHGuest envoyé</div>'
          + '<div style="background:rgba(124,58,237,.06);border:1.5px solid rgba(124,58,237,.25);border-radius:14px;padding:12px 14px;">'
          + '<div style="font-size:12px;color:#5B21B6;word-break:break-all;line-height:1.5;font-family:monospace;">' + _bhLink + '</div>'
          + '<button type="button" data-bh-copy-link style="margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:9px;background:#7C3AED;color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;">'
          + '<i class="fas fa-copy"></i> Copier le lien</button></div>';

        var _bhCopyBtn = linkGroup.querySelector('[data-bh-copy-link]');
        if (_bhCopyBtn) {
          _bhCopyBtn.addEventListener('click', function() {
            var done = function() {
              _bhCopyBtn.innerHTML = '<i class="fas fa-check"></i> Copié !';
              _bhCopyBtn.style.background = '#059669';
              setTimeout(function(){ _bhCopyBtn.innerHTML = '<i class="fas fa-copy"></i> Copier le lien'; _bhCopyBtn.style.background = '#7C3AED'; }, 2000);
            };
            var fallback = function(){ var ta=document.createElement('textarea');ta.value=_bhLink;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}ta.remove();done(); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(_bhLink).then(done).catch(fallback);
            else fallback();
          });
        }
      }
    } catch(e) { console.warn('Lien BHGuest modal:', e.message); }

    // 7️⃣ Raccourcis rapides : Messages + Caution + Paiement
    try {
      const existingShortcuts = detailsContent.querySelector('[data-shortcuts="1"]');
      if (!existingShortcuts) {
        const shortcutsDiv = document.createElement('div');
        shortcutsDiv.setAttribute('data-shortcuts', '1');
        shortcutsDiv.style.cssText = 'margin-top:16px;display:flex;flex-direction:column;gap:10px;';

        const reservationUidLocal = booking.uid || booking.reservationKey || booking.id || '';
        const guestPhoneLocal = booking.guest_phone || booking.guestPhone || '';
        const isDirectOrManual = ['DIRECT','MANUEL','MANUAL'].includes(String(booking.source || booking.platform || '').toUpperCase());

        // Bouton Messages
        shortcutsDiv.innerHTML += `
          <div style="font-size:11px;font-weight:700;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;">Raccourcis rapides</div>

          ${isDirectOrManual ? `
          <button id="btnQuickDeposit" style="width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--surface-secondary,#F5F0E8);border:1.5px solid var(--border-color,#E8E0D0);border-radius:12px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary,#1A1A1A);">
            <i class="fas fa-shield-alt" style="color:#F59E0B;font-size:16px;width:20px;text-align:center;"></i>
            Envoyer un lien de caution
          </button>
          <button id="btnQuickPayment" style="width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--surface-secondary,#F5F0E8);border:1.5px solid var(--border-color,#E8E0D0);border-radius:12px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary,#1A1A1A);">
            <i class="fas fa-credit-card" style="color:#6366F1;font-size:16px;width:20px;text-align:center;"></i>
            Envoyer un lien de paiement
          </button>
          ` : ''}
        `;

        // Insérer les raccourcis AVANT le bloc risque (data-risk-info) s'il existe,
        // sinon en dernier — ainsi l'analyse de risque reste toujours tout en bas
        const existingRiskBlock = detailsContent.querySelector('[data-risk-info="1"]');
        if (existingRiskBlock) {
          detailsContent.insertBefore(shortcutsDiv, existingRiskBlock);
        } else {
          detailsContent.appendChild(shortcutsDiv);
        }

        // ── Bouton Messages ──────────────────────────────────────
        document.getElementById('btnQuickMessage')?.addEventListener('click', async () => {
          const token = localStorage.getItem('lcc_token');
          // Chercher la conversation liée
          try {
            const r = await fetch(`${API_URL}/api/chat/conversations`, { headers: { 'Authorization': 'Bearer ' + token } });
            const d = await r.json();
            const convs = d.conversations || [];

            // Debug : voir les champs réels des conversations et du booking
            console.log('🔍 [Messages] booking:', {
              uid: booking.uid, id: booking.id, reservationKey: booking.reservationKey,
              guestName: booking.guestName, guest: booking.guest, guest_display_name: booking.guest_display_name,
              propertyId: booking.propertyId, property_id: booking.property_id,
              channexBookingId: booking.channexBookingId, source: booking.source
            });
            console.log('🔍 [Messages] convs sample (3 premières):', convs.slice(0,3).map(c => ({
              id: c.id, uid: c.uid, reservation_uid: c.reservation_uid, reservation_key: c.reservation_key,
              guest_name: c.guest_name, property_id: c.property_id, channex_booking_id: c.channex_booking_id
            })));

            const guestNameLocal = booking.guestName || booking.guest_display_name || booking.guest || '';
            const propertyIdLocal = booking.propertyId || booking.property_id || '';
            // Date d'arrivée normalisée (YYYY-MM-DD) — clé de liaison principale avec conversations
            const bookingStart = booking.startDate || booking.start || booking.checkIn || booking.check_in || '';
            const bookingStartNorm = bookingStart ? bookingStart.toString().split('T')[0] : '';

            // Matching cascade :
            // 1. channex_booking_id (le plus fiable pour réservations OTA)
            // 2. property_id + reservation_start_date (clé de liaison DB)
            // 3. nom voyageur + property_id
            // 4. nom voyageur seul (fallback)
            const conv = convs.find(c =>
              booking.channexBookingId && c.channex_booking_id &&
              String(c.channex_booking_id) === String(booking.channexBookingId)
            ) || convs.find(c =>
              bookingStartNorm && propertyIdLocal &&
              c.property_id === propertyIdLocal &&
              c.reservation_start_date && c.reservation_start_date.toString().split('T')[0] === bookingStartNorm
            ) || convs.find(c =>
              guestNameLocal && c.guest_name &&
              c.guest_name.trim().toLowerCase() === guestNameLocal.trim().toLowerCase() &&
              propertyIdLocal && c.property_id === propertyIdLocal
            ) || convs.find(c =>
              guestNameLocal && c.guest_name &&
              c.guest_name.trim().toLowerCase() === guestNameLocal.trim().toLowerCase()
            );

            console.log('🔍 [Messages] booking start:', bookingStartNorm, '| propertyId:', propertyIdLocal, '| channex:', booking.channexBookingId);
            console.log('🔍 [Messages] conv trouvée:', conv ? {id: conv.id, guest_name: conv.guest_name, start: conv.reservation_start_date} : 'aucune — fallback messages.html');
            if (conv) {
              window.location.href = `/messages.html?conv=${conv.id}`;
            } else {
              window.location.href = '/messages.html';
            }
          } catch(e) {
            window.location.href = '/messages.html';
          }
        });

        // ── Bouton Caution ───────────────────────────────────────
        if (isDirectOrManual) {

          // Helper : mini-modal inline pour saisie de montant
          function showAmountModal({ title, icon, iconColor, defaultAmount, onConfirm }) {
            // Supprimer un éventuel modal précédent
            document.getElementById('_quickAmountModal')?.remove();
            const overlay = document.createElement('div');
            overlay.id = '_quickAmountModal';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = `
              <div style="background:var(--bg-primary,#F5F0E8);border-radius:18px;padding:22px 20px;width:100%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,.25);">
                <div style="font-size:16px;font-weight:700;color:var(--text-primary,#111);margin-bottom:14px;display:flex;align-items:center;gap:8px;">
                  <i class="${icon}" style="color:${iconColor};"></i> ${title}
                </div>
                <label style="display:block;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Montant (€)</label>
                <input id="_quickAmountInput" type="number" min="1" step="0.01" value="${defaultAmount || ''}" placeholder="Ex: 300"
                  style="width:100%;padding:11px 13px;border:1.5px solid var(--border-color,#d1d5db);border-radius:10px;font-size:15px;font-weight:600;background:var(--bg-primary,#fff);color:var(--text-primary,#111);box-sizing:border-box;margin-bottom:14px;"/>
                <div style="display:flex;gap:8px;">
                  <button id="_quickAmountCancel" style="flex:1;padding:10px;border:1.5px solid var(--border-color,#d1d5db);border-radius:10px;background:transparent;font-size:13px;font-weight:600;cursor:pointer;color:var(--text-primary,#111);">Annuler</button>
                  <button id="_quickAmountConfirm" style="flex:2;padding:10px;border:none;border-radius:10px;background:#1A7A5E;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">Générer le lien</button>
                </div>
              </div>`;
            document.body.appendChild(overlay);
            const input = document.getElementById('_quickAmountInput');
            input.focus(); input.select();
            document.getElementById('_quickAmountCancel').onclick = () => overlay.remove();
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
            document.getElementById('_quickAmountConfirm').onclick = () => {
              const val = parseFloat(input.value);
              if (!val || val <= 0) { input.style.borderColor = '#ef4444'; return; }
              overlay.remove();
              onConfirm(val);
            };
            input.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') document.getElementById('_quickAmountConfirm')?.click();
              if (e.key === 'Escape') overlay.remove();
            });
          }

          document.getElementById('btnQuickDeposit')?.addEventListener('click', () => {
            const defaultAmt = booking.amount_total || booking.price || booking.amount || '';
            showAmountModal({
              title: 'Lien de caution',
              icon: 'fas fa-shield-alt',
              iconColor: '#F59E0B',
              defaultAmount: defaultAmt,
              onConfirm: async (amount) => {
                const token = localStorage.getItem('lcc_token');
                const btn = document.getElementById('btnQuickDeposit');
                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...'; }
                try {
                  const r = await fetch(`${API_URL}/api/deposits`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reservationUid: reservationUidLocal, amount })
                  });
                  const d = await r.json();
                  const url = d.checkoutUrl || d.checkout_url;
                  if (url) {
                    await navigator.clipboard.writeText(url).catch(() => {});
                    if (btn) btn.innerHTML = '<i class="fas fa-check"></i> Lien copié !';
                    showToast('✅ Lien de caution copié dans le presse-papier', 'success');
                    setTimeout(() => { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shield-alt" style="color:#F59E0B;font-size:16px;width:20px;text-align:center;"></i> Envoyer un lien de caution'; } }, 3000);
                  } else {
                    showToast('❌ ' + (d.error || 'Erreur création caution'), 'error');
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shield-alt" style="color:#F59E0B;"></i> Envoyer un lien de caution'; }
                  }
                } catch(e) {
                  showToast('❌ Erreur réseau', 'error');
                  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-shield-alt" style="color:#F59E0B;"></i> Envoyer un lien de caution'; }
                }
              }
            });
          });

          // ── Bouton Paiement ──────────────────────────────────────
          document.getElementById('btnQuickPayment')?.addEventListener('click', () => {
            const defaultAmt = booking.amount_total || booking.price || booking.amount || '';
            showAmountModal({
              title: 'Lien de paiement',
              icon: 'fas fa-credit-card',
              iconColor: '#6366F1',
              defaultAmount: defaultAmt,
              onConfirm: async (amount) => {
                const token = localStorage.getItem('lcc_token');
                const btn = document.getElementById('btnQuickPayment');
                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...'; }
                try {
                  const r = await fetch(`${API_URL}/api/payments`, {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reservationUid: reservationUidLocal, amount })
                  });
                  const d = await r.json();
                  const url = d.checkoutUrl || d.checkout_url;
                  if (url) {
                    await navigator.clipboard.writeText(url).catch(() => {});
                    if (btn) btn.innerHTML = '<i class="fas fa-check"></i> Lien copié !';
                    showToast('✅ Lien de paiement copié dans le presse-papier', 'success');
                    setTimeout(() => { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card" style="color:#6366F1;font-size:16px;width:20px;text-align:center;"></i> Envoyer un lien de paiement'; } }, 3000);
                  } else {
                    showToast('❌ ' + (d.error || 'Erreur création paiement'), 'error');
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card" style="color:#6366F1;"></i> Envoyer un lien de paiement'; }
                  }
                } catch(e) {
                  showToast('❌ Erreur réseau', 'error');
                  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-credit-card" style="color:#6366F1;"></i> Envoyer un lien de paiement'; }
                }
              }
            });
          });
        }
      }
    } catch (e) {
      console.warn('Erreur injection raccourcis modal', e);
    }

    // 6️⃣ Ouverture du modal et datasets utiles
    window._currentDetailsBooking = booking; // Mémorisé pour les boutons footer
    window.hideFab();
    window.hideFab();
    detailsModal.style.display = 'flex';

    const reservationUid =
      booking.uid ||
      booking.reservationKey ||
      booking.id ||
      '';

    detailsModal.dataset.propertyId = propertyId || '';
    detailsModal.dataset.reservationUid = reservationUid;
  }, 50);
}





function handleEditBooking() {
  // Toujours prendre window.currentBookingData en priorité — c'est lui qui est
  // peuplé directement depuis openBooking(r) avec les données complètes (notes incluses).
  // Le let local peut être null ou avoir une version sans notes (si findReservationForBlock
  // a raté la correspondance par id).
  if (window.currentBookingData) {
    currentBookingData = window.currentBookingData;
  }
  if (!currentBookingData) {
    alert('Impossible de trouver les données de la réservation');
    return;
  }
  // Log pour debug
  console.log('✏️ handleEditBooking — notes:', currentBookingData.notes, '| uid:', currentBookingData.uid, '| source:', currentBookingData.source, '| platform:', currentBookingData.platform);

  // Fermer le modal de détails
  const detailsModal = document.getElementById('reservationDetailsModal');
  if (detailsModal) {
    detailsModal.style.display = 'none';
    
    window.showFab();
  }

  const editModal = document.getElementById('editBookingModal');
  if (!editModal) {
    console.warn('⚠️ Pas de #editBookingModal dans le DOM');
    return;
  }

  // === Remplir le select des logements ===
  const propertySelect = document.getElementById('editBookingProperty');
  if (propertySelect) {
    let props = [];
    try {
      if (Array.isArray(window.LCC_PROPERTIES)) {
        props = window.LCC_PROPERTIES;
      } else {
        props = JSON.parse(localStorage.getItem('LCC_PROPERTIES') || '[]');
      }
    } catch (e) {
      console.warn('Impossible de lire la liste des logements pour l\'édition', e);
    }

    propertySelect.innerHTML = '';

    if (!props.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Aucun logement disponible';
      propertySelect.appendChild(opt);
      propertySelect.disabled = true;
    } else {
      propertySelect.disabled = false;

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Sélectionner un logement';
      placeholder.disabled = true;
      propertySelect.appendChild(placeholder);

      props.forEach((p, index) => {
        const opt = document.createElement('option');
        opt.value = String(p.id != null ? p.id : index);
        opt.textContent = p.name || ('Logement ' + (index + 1));
        propertySelect.appendChild(opt);
      });

      if (currentBookingData.propertyId) {
        propertySelect.value = String(currentBookingData.propertyId);
        if (propertySelect.selectedIndex === -1) {
          propertySelect.selectedIndex = 0;
        }
      } else {
        propertySelect.selectedIndex = 0;
      }
    }
  }

  // === Afficher le modal d\'édition ===
  editModal.style.display = 'flex';
  setTimeout(() => editModal.classList.add('active'), 10);

  // === Pré-remplir les champs ===
  document.getElementById('editBookingId').value = currentBookingData.uid;

  const sourceInput = document.getElementById('editBookingSource');
  if (sourceInput) {
    sourceInput.value = currentBookingData.source || currentBookingData.platform || '';
  }

  document.getElementById('editCheckIn').value =
    (currentBookingData.start || '').split('T')[0] || '';
  document.getElementById('editCheckOut').value =
    (currentBookingData.end || '').split('T')[0] || '';

  document.getElementById('editGuestName').value = currentBookingData.guestName || '';
  document.getElementById('editGuestPhone').value = currentBookingData.guestPhone || currentBookingData.guest_phone || '';
  document.getElementById('editGuestEmail').value = currentBookingData.guestEmail || currentBookingData.guest_email || '';
  document.getElementById('editPrice').value = currentBookingData.amount_total || currentBookingData.price || currentBookingData.amount || currentBookingData.totalPrice || currentBookingData.total_price || '';
  var editNotesEl = document.getElementById('editNotes');
  var editNotesLabel = document.getElementById('editNotesLabel');
  if (editNotesEl) {
    // Chercher la note dans l'ordre de priorité :
    // 1. currentBookingData.notes (devrait être là après le fix handleEditBooking)
    // 2. LCC_RESERVATIONS par uid (filet de sécurité)
    var _noteVal = currentBookingData.notes || '';
    if (!_noteVal && currentBookingData.uid) {
      var _allResas = window.LCC_RESERVATIONS || [];
      var _found = _allResas.find(function(r) { return r && (r.uid === currentBookingData.uid || r.id === currentBookingData.uid); });
      if (_found && _found.notes) _noteVal = _found.notes;
    }
    editNotesEl.value = _noteVal;
    console.log('📝 editNotes pré-rempli avec:', JSON.stringify(_noteVal));
    var hasNote = !!_noteVal.trim();
    if (editNotesLabel) editNotesLabel.style.color = hasNote ? '#EF4444' : '';
    editNotesEl.style.borderColor = hasNote ? '#EF4444' : '';
    editNotesEl.style.color = hasNote ? '#EF4444' : '';
    editNotesEl.addEventListener('input', function() {
      var h = !!(this.value && this.value.trim());
      if (editNotesLabel) editNotesLabel.style.color = h ? '#EF4444' : '';
      this.style.borderColor = h ? '#EF4444' : '';
      this.style.color = h ? '#EF4444' : '';
    });
  }

  const platformSelect = document.getElementById('editPlatform');
  if (platformSelect) {
    const platform =
      (currentBookingData.platform || currentBookingData.source || 'direct').toLowerCase();
    platformSelect.value = platform;
  }

  // Nouveaux champs enrichis
  const editCountry = document.getElementById('editGuestCountry');
  if (editCountry) editCountry.value = currentBookingData.guest_country || '';
  const editAdults = document.getElementById('editGuestAdults');
  if (editAdults) editAdults.value = currentBookingData.occupancy_adults || '';
  const editPriceRooms = document.getElementById('editPriceRooms');
  if (editPriceRooms) editPriceRooms.value = currentBookingData.amount_rooms || '';
  const editPriceCleaning = document.getElementById('editPriceCleaning');
  if (editPriceCleaning) editPriceCleaning.value = currentBookingData.amount_cleaning || '';
  const editPriceTaxes = document.getElementById('editPriceTaxes');
  if (editPriceTaxes) editPriceTaxes.value = currentBookingData.amount_taxes || '';
  const editCommission = document.getElementById('editCommission');
  if (editCommission) editCommission.value = currentBookingData.ota_commission || '';
}



// Listener global pour les boutons du modal
document.addEventListener('click', function(e) {
  const deleteBtn = e.target.closest('#deleteBookingBtn');
  if (deleteBtn) {
    e.preventDefault();
    e.stopPropagation();
    console.log('🟥 Click sur deleteBookingBtn', e.target);
    handleDeleteBooking();
    return;
  }

  const editBtn = e.target.closest('#editBookingBtn');
  if (editBtn) {
    e.preventDefault();
    e.stopPropagation();
    console.log('🟦 Click sur editBookingBtn', e.target);
    handleEditBooking();
    return;
  }
});
  async function handleDeleteBooking() {
  // Empêcher les doubles clics sur "Supprimer"
  if (window.deletingInProgress) {
    console.log('⚠️ Suppression déjà en cours, ignorée');
    return;
  }
  window.deletingInProgress = true;

  // On récupère les données de la réservation/blocage
  const booking =
    window.currentBookingData ||
    window.currentBooking ||
    (typeof currentBookingData !== 'undefined' ? currentBookingData : null);

  console.log('🧨 handleDeleteBooking avec booking =', booking);

  if (!booking) {
    window.deletingInProgress = false;
    alert('Impossible de trouver les données de la réservation');
    return;
  }

  // Est-ce un blocage manuel ?
  const isBlock =
    booking.type === 'block' ||
    booking.source === 'BLOCK';

  // Réservations OTA via Channex — supprimables localement
  const rawSource = (booking.source || booking.platform || '').toLowerCase();
  // Note : plus de blocage iCal, Channex gère la sync OTA

  const message = isBlock
    ? 'Êtes-vous sûr de vouloir supprimer ce BLOCAGE ?'
    : 'Êtes-vous sûr de vouloir supprimer cette réservation ?';

  const confirmed = await (typeof bhConfirm === 'function' ? bhConfirm(message) : Promise.resolve(confirm(message)));
  if (!confirmed) {
    window.deletingInProgress = false;
    return;
  }

  const token = localStorage.getItem('lcc_token');
  if (!token) {
    window.deletingInProgress = false;
    alert("Impossible de supprimer : jeton d\'authentification introuvable. Reconnecte-toi.");
    return;
  }

  // 🔎 On récupère un propertyId fiable
  let propertyId = null;

  if (booking.propertyId != null) {
    propertyId = String(booking.propertyId);
  } else if (booking.property && booking.property.id != null) {
    propertyId = String(booking.property.id);
  } else if (booking.property_id != null) {
    propertyId = String(booking.property_id);
  }

  // Fallback : dataset du modal (fixModalContent le remplit)
  const detailsModal = document.getElementById('reservationDetailsModal');
  if (!propertyId && detailsModal && detailsModal.dataset.propertyId) {
    propertyId = detailsModal.dataset.propertyId;
  }

  // 🔎 On récupère un identifiant unique pour la résa / le bloc
  let uid = null;

  if (booking.uid != null) {
    uid = String(booking.uid);
  } else if (booking.reservationKey != null) {
    uid = String(booking.reservationKey);
  } else if (booking.id != null) {
    uid = String(booking.id);
  }

  // Fallback : dataset du modal
  if (!uid && detailsModal && detailsModal.dataset.reservationUid) {
    uid = detailsModal.dataset.reservationUid;
  }

  if (!propertyId || !uid) {
    console.error('❌ Impossible de préparer la suppression :', {
      propertyId,
      uid,
      booking
    });
    alert(
      "Impossible de supprimer ce blocage / cette réservation : identifiant manquant.\n" +
      "Regarde la console pour plus de détails."
    );
    window.deletingInProgress = false;
    return;
  }

  const payload = { propertyId, uid };

  console.log('📤 Envoi suppression :', payload);

  // BHGuest : utiliser la route dediee
  const _rawSrc = (booking.source || booking.platform || '').toLowerCase().replace(/[_\-\s]/g, '');
  const _isBHGuest = ['guestapp','bhguest','boostinghostguest','boostinghost'].includes(_rawSrc)
    || (booking.uid && (String(booking.uid).startsWith('GUEST_') || String(booking.uid).startsWith('BHGUEST_')));
  if (_isBHGuest && uid) {
    fetch('/api/guest/cancel-reservation', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid })
    })
    .then(r => r.json())
    .then(() => {
      if (detailsModal) { detailsModal.style.display = 'none'; window.showFab && window.showFab(); }
      window.deletingInProgress = false;
      // Le socket calendar:block_removed gère le refresh — pas de loadCalendarData ici
    })
    .catch(err => { window.deletingInProgress = false; alert('Erreur annulation BHGuest: ' + err.message); });
    return;
  }

  fetch('https://lcc-booking-manager.onrender.com/api/manual-reservations/delete', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
    .then(res => {
      console.log('📥 Réponse /manual-reservations/delete status =', res.status);
      if (!res.ok) {
        throw new Error('Erreur ' + res.status);
      }
      return res.json();
    })
    .then(data => {
      console.log('✅ Suppression backend OK :', data);

      // On ferme le modal
      if (detailsModal) {
        detailsModal.style.display = 'none';
        window.showFab();
      }

      window.deletingInProgress = false;

      // Le socket calendar:block_removed s'occupe du refresh immédiat.
      // On ne fait PAS de loadCalendarData ici pour éviter les race conditions.
      // Le flag _blockRemovedAt est déjà positionné par le socket handler.
    })
    .catch(err => {
      window.deletingInProgress = false;
      console.error('❌ Erreur lors de la suppression :', err);
      alert('Erreur lors de la suppression : ' + err.message);
    });
}

function closeEditBookingModal() {
  const editModal = document.getElementById('editBookingModal');
  if (editModal) {
    editModal.classList.remove('active');
    editModal.style.display = 'none';
  }
}

// Croix en haut à droite
const closeEditModalBtn = document.getElementById('closeEditModal');
if (closeEditModalBtn) {
  closeEditModalBtn.addEventListener('click', function (e) {
    e.preventDefault();
    closeEditBookingModal();
  });
}

// Bouton "Annuler"
const cancelEditBtn = document.getElementById('cancelEditBooking');
if (cancelEditBtn) {
  cancelEditBtn.addEventListener('click', function (e) {
    e.preventDefault();
    closeEditBookingModal();
  });
}

// Clic sur le fond gris
const editModalOverlay = document.getElementById('editModalOverlay');
if (editModalOverlay) {
  editModalOverlay.addEventListener('click', function (e) {
    e.preventDefault();
    closeEditBookingModal();
  });
}
// Soumission du formulaire "Modifier la réservation"
const editBookingForm = document.getElementById('editBookingForm');
if (editBookingForm) {
  editBookingForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    console.log('✏️ Soumission du formulaire d\'édition');

    if (!currentBookingData) {
      alert('Impossible de trouver les données de la réservation');
      return;
    }

    const isBlock =
      currentBookingData.type === 'block' ||
      currentBookingData.source === 'BLOCK';

    // Réservations OTA via Channex — modifiables localement
    // (Channex mettra à jour les OTAs automatiquement)

    const propertyId = document.getElementById('editBookingProperty').value;
    const start = document.getElementById('editCheckIn').value;
    const end = document.getElementById('editCheckOut').value;
    const guestName = document.getElementById('editGuestName').value;
    const notes = document.getElementById('editNotes').value;

    if (!propertyId || !start || !end) {
      alert('Merci de sélectionner un logement et des dates.');
      return;
    }

    const token = localStorage.getItem('lcc_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    try {
      if (isBlock) {
        // ── CAS BLOCAGE : supprimer + recréer (les blocages n'ont pas de PUT) ──
        console.log('🧨 Édition blocage - ancien logement:', currentBookingData.propertyId, 'nouveau:', propertyId);

        const deleteRes = await fetch('https://lcc-booking-manager.onrender.com/api/manual-reservations/delete', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            propertyId: currentBookingData.propertyId,
            uid: currentBookingData.uid
          })
        });
        let deleteBody = {};
        try { deleteBody = await deleteRes.json(); } catch (e) {}
        if (!deleteRes.ok && deleteRes.status !== 404) {
          throw new Error(deleteBody.error || 'Erreur suppression (' + deleteRes.status + ')');
        }

        const createRes = await fetch('https://lcc-booking-manager.onrender.com/api/blocks', {
          method: 'POST',
          headers,
          body: JSON.stringify({ propertyId, start, end, reason: notes || guestName || 'Blocage manuel' })
        });
        let createBody = {};
        try { createBody = await createRes.json(); } catch (e) {}
        if (!createRes.ok) {
          throw new Error(createBody.error || 'Erreur création (' + createRes.status + ')');
        }
        alert('Blocage mis à jour !');

      } else {
        const uid = currentBookingData.uid || currentBookingData.id;
        const selectedPlatform = (document.getElementById('editPlatform')?.value || '').toLowerCase();
        const platform = selectedPlatform || (currentBookingData.source || currentBookingData.platform || '').toLowerCase();
        const BHGUEST_PLATFORMS = ['guest_app', 'bhguest', 'boostinghost_guest', 'boostinghost guest', 'boostinghost'];
        const _srcRaw = platform.replace(/[_\-\s]/g, '');
        const isBHGuest = BHGUEST_PLATFORMS.includes(platform) || BHGUEST_PLATFORMS.includes(currentBookingData.source)
          || _srcRaw === 'guestapp' || _srcRaw === 'bhguest' || _srcRaw === 'boostinghostguest'
          || (currentBookingData.uid && (String(currentBookingData.uid).startsWith('GUEST_') || String(currentBookingData.uid).startsWith('BHGUEST_')));
        const isOTA = !isBHGuest && platform && !['direct','manual',''].includes(platform) && platform !== 'block';
        const isManualRes = isBHGuest || currentBookingData.isManual || currentBookingData.type === 'manual' ||
          platform === 'direct' || platform === 'manual' || !platform;

        if (isOTA && !isManualRes) {
          // ── CAS RÉSERVATION OTA (Airbnb, Booking, etc.) ──
          // Réservation OTA : on ne modifie que la note (dates/propriété gérées par Channex)
          console.log('✏️ PATCH note OTA uid:', uid);
          const noteRes = await fetch('/api/reservations/' + encodeURIComponent(uid) + '/note', {
            method: 'PATCH', headers,
            body: JSON.stringify({ notes })
          });
          let noteBody = {};
          try { noteBody = await noteRes.json(); } catch (e) {}
          if (!noteRes.ok) {
            throw new Error(noteBody.error || 'Erreur sauvegarde note (' + noteRes.status + ')');
          }
          // Patch immédiat des stores + recalcul KPI (pas besoin d'attendre le reload)
          window.bhNotesPatchStore(uid, notes);
          alert('Note sauvegardée !');
        } else if (isBHGuest) {
          // ── CAS RÉSERVATION BHGUEST ──
          console.log('✏️ Modification réservation BHGuest uid:', uid);
          const updateRes = await fetch('/api/guest/modify-reservation', {
            method: 'POST', headers,
            body: JSON.stringify({
              uid,
              propertyId,
              checkin: start,
              checkout: end,
              guests: document.getElementById('editGuestAdults')?.value ? parseInt(document.getElementById('editGuestAdults').value) : null,
              notes: notes || null,
              amount_total: document.getElementById('editPrice')?.value ? parseFloat(document.getElementById('editPrice').value) : null
            })
          });
          let updateBody = {};
          try { updateBody = await updateRes.json(); } catch (e) {}
          if (!updateRes.ok) throw new Error(updateBody.error || 'Erreur mise à jour BHGuest (' + updateRes.status + ')');
          window.bhNotesPatchStore && window.bhNotesPatchStore(uid, notes);
          alert('Réservation BHGuest mise à jour !');
        } else {
          // ── CAS RÉSERVATION MANUELLE ──
          console.log('✏️ Modification réservation manuelle uid:', uid);
          const updateRes = await fetch('https://lcc-booking-manager.onrender.com/api/reservations/manual/' + encodeURIComponent(uid), {
            method: 'PUT', headers,
            body: JSON.stringify({
              propertyId,
              start,
              end,
              guestName:        guestName || currentBookingData.guestName || '',
              phone:            document.getElementById('editGuestPhone')?.value || '',
              email:            document.getElementById('editGuestEmail')?.value || '',
              platform:         isBHGuest ? (currentBookingData.source || currentBookingData.platform || 'guest_app') : (document.getElementById('editPlatform')?.value || 'direct'),
              price:            document.getElementById('editPrice')?.value ? parseFloat(document.getElementById('editPrice').value) : null,
              notes:            notes.trim(),
              guest_country:    document.getElementById('editGuestCountry')?.value || null,
              occupancy_adults: document.getElementById('editGuestAdults')?.value ? parseInt(document.getElementById('editGuestAdults').value) : null,
              amount_rooms:     document.getElementById('editPriceRooms')?.value ? parseFloat(document.getElementById('editPriceRooms').value) : null,
              amount_cleaning:  document.getElementById('editPriceCleaning')?.value ? parseFloat(document.getElementById('editPriceCleaning').value) : null,
              amount_taxes:     document.getElementById('editPriceTaxes')?.value ? parseFloat(document.getElementById('editPriceTaxes').value) : null,
              ota_commission:   document.getElementById('editCommission')?.value ? parseFloat(document.getElementById('editCommission').value) : null,
            })
          });
          let updateBody = {};
          try { updateBody = await updateRes.json(); } catch (e) {}
          if (!updateRes.ok) {
            throw new Error(updateBody.error || 'Erreur mise à jour (' + updateRes.status + ')');
          }
          // Patch immédiat des stores + recalcul KPI
          window.bhNotesPatchStore(uid, notes);
          alert('Réservation mise à jour !');
        }
      }

      const editModal = document.getElementById('editBookingModal');
      if (editModal) {
        editModal.classList.remove('active');
        editModal.style.display = 'none';
      }

      setTimeout(function() {
        if (typeof window.loadCalendarData === 'function') window.loadCalendarData();
        else if (typeof loadCalendarData === 'function') loadCalendarData();
        else if (typeof refreshCalendar === 'function') refreshCalendar();
        else location.reload();
      }, 400);
    } catch (err) {
      console.error('❌ Erreur mise à jour blocage:', err);
      alert('Erreur : ' + err.message);
    }
  });
}

// blockSaveBtn géré par handleBlockModalSave() via onclick

})();

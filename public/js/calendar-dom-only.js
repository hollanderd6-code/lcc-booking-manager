// ============================================
// CALENDRIER - VERSION SANS API
// Lit TOUT depuis le DOM - Zéro appel API
// ============================================

(function() {
  'use strict';

  console.log('🚀 Calendrier interactif (mode DOM-only)...');

  // Cache des données
  let cachedProperties = [];
  let cachedBookings = [];

  function init() {
    if (!document.getElementById('calendarGrid')) {
      setTimeout(init, 100);
      return;
    }

    console.log('✅ Initialisation...');

    // Extraire les logements depuis le DOM
    extractPropertiesFromDOM();

    // Activer les clics sur réservations
    activateBookingClicks();

    // Activer les modals
    activateModals();

    // Activer le bouton +
    activateFAB();

    console.log('🎉 Calendrier actif (mode DOM) !');
  }

  // ============================================
  // EXTRAIRE LES LOGEMENTS DEPUIS LE DOM
  // ============================================
  
  function extractPropertiesFromDOM() {
    const propertyItems = document.querySelectorAll('.property-item');
    
    cachedProperties = Array.from(propertyItems).map(item => {
      const id = item.dataset.propertyId;
      const name = item.querySelector('.property-name')?.textContent || 'Sans nom';
      return { id, name };
    });

    console.log('✅ Logements extraits:', cachedProperties);
  }

  // ============================================
  // ACTIVER LES CLICS
  // ============================================
  
  function activateBookingClicks() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;

    grid.addEventListener('click', function(e) {
      const bookingBlock = e.target.closest('.booking-block');
      
      if (bookingBlock && bookingBlock.dataset.bookingId) {
        console.log('🖱️ Clic sur réservation');
        showBookingDetailsFromDOM(bookingBlock);
      }
    });

    console.log('✅ Clics activés');
  }

  // ============================================
  // AFFICHER LES DÉTAILS (depuis DOM)
  // ============================================
  
  function showBookingDetailsFromDOM(bookingBlock) {
    const modal = document.getElementById('reservationDetailsModal');
    const content = document.getElementById('reservationDetailsContent');
    
    if (!modal || !content) return;

    // Petite fonction utilitaire pour parser "YYYY-MM-DD"
    function parseYMD(str) {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    }

    // Extraire les infos depuis le bloc HTML
    const bookingId = bookingBlock.dataset.bookingId;
    const guestName = bookingBlock.textContent.trim() || 'Client';
    
    // Trouver le logement
    const row = bookingBlock.closest('.calendar-row');
    const propertyId = row?.dataset.propertyId || '';
    const property = cachedProperties.find(p => p.id === propertyId);
    const propertyName = property?.name || 'Logement inconnu';

    // Détecter la plateforme depuis la classe
    let platform = 'direct';
    let platformColor = '#0E3B2E';
    
    if (bookingBlock.classList.contains('airbnb')) {
      platform = 'airbnb';
      platformColor = '#FF5A5F';
    } else if (bookingBlock.classList.contains('booking')) {
      platform = 'booking';
      platformColor = '#003580';
    }

    // Trouver les dates (cases colorées) -> startDate = 1er jour coloré, endDate = dernière nuit
    const allBlocksForBooking = row.querySelectorAll(`[data-booking-id="${bookingId}"]`);
    let startDate = null;
    let endDate = null;
    
    allBlocksForBooking.forEach(block => {
      const cell = block.closest('.calendar-cell');
      const cellDate = cell?.dataset.date;
      
      if (cellDate) {
        if (!startDate || cellDate < startDate) startDate = cellDate;
        if (!endDate || cellDate > endDate) endDate = cellDate;
      }
    });

    // Calcul des vraies dates d'arrivée / départ + nuits
    let nights = 0;
    let checkInDate = null;
    let checkOutDate = null;

    if (startDate && endDate) {
      const start = parseYMD(startDate);
      const lastNight = parseYMD(endDate);

      checkInDate = start;

      const checkout = new Date(lastNight);
      checkout.setDate(checkout.getDate() + 1);
      checkOutDate = checkout;

      const diffMs = checkOutDate - checkInDate;
      nights = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    }

    // Créer un faux booking object
    window.currentBookingDetails = {
      id: bookingId,
      guestName: guestName,
      propertyId: propertyId,
      platform: platform,
      startDate: checkInDate ? checkInDate.toISOString().slice(0, 10) : startDate,
      endDate: checkOutDate ? checkOutDate.toISOString().slice(0, 10) : endDate
    };

    content.innerHTML = `
      <div class="detail-group">
        <label><i class="fas fa-user"></i> Client</label>
        <div class="detail-value">${guestName}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-home"></i> Logement</label>
        <div class="detail-value">${propertyName}</div>
      </div>

      ${checkInDate ? `
      <div class="detail-group">
        <label><i class="fas fa-calendar-check"></i> Arrivée</label>
        <div class="detail-value">${formatDate(checkInDate)}</div>
      </div>` : ''}

      ${checkOutDate ? `
      <div class="detail-group">
        <label><i class="fas fa-calendar-times"></i> Départ</label>
        <div class="detail-value">${formatDate(checkOutDate)}</div>
      </div>` : ''}

      ${nights > 0 ? `
      <div class="detail-group">
        <label><i class="fas fa-moon"></i> Nuitées</label>
        <div class="detail-value">${nights} nuit${nights > 1 ? 's' : ''}</div>
      </div>` : ''}

      <div class="detail-group">
        <label><i class="fas fa-tag"></i> Plateforme</label>
        <div class="detail-value">
          <span style="background:${platformColor}; color:white; padding:4px 12px; border-radius:4px; font-size:12px; font-weight:600;">
            ${platform.toUpperCase()}
          </span>
        </div>
      </div>
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    console.log('✅ Modal ouvert (DOM only)');
  }

  // ============================================
  // ACTIVER LES MODALS
  // ============================================
  
  function activateModals() {
    // Modal Details - Fermeture
    const closeDetailsBtn = document.getElementById('closeDetailsModal');
    const closeDetailsBtn2 = document.getElementById('closeDetailsBtn');
    const detailsOverlay = document.getElementById('detailsModalOverlay');
    
    if (closeDetailsBtn) closeDetailsBtn.onclick = closeDetailsModal;
    if (closeDetailsBtn2) closeDetailsBtn2.onclick = closeDetailsModal;
    if (detailsOverlay) detailsOverlay.onclick = closeDetailsModal;

    // Modal New Booking - Fermeture
    const closeBookingBtn = document.getElementById('closeModal');
    const cancelBookingBtn = document.getElementById('cancelBooking');
    const bookingOverlay = document.getElementById('modalOverlay');
    
    if (closeBookingBtn) closeBookingBtn.onclick = closeBookingModal;
    if (cancelBookingBtn) cancelBookingBtn.onclick = closeBookingModal;
    if (bookingOverlay) bookingOverlay.onclick = closeBookingModal;

    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) bookingForm.onsubmit = handleNewBookingSubmit;

    console.log('✅ Modals configurés');
  }

  // ============================================
  // ACTIVER LE BOUTON +
  // ============================================
  
  function activateFAB() {
    const fab = document.getElementById('addBookingBtn');
    if (!fab) return;

    fab.onclick = openNewBookingModal;
    console.log('✅ Bouton + activé');
  }

  // ============================================
  // FONCTIONS DE MODAL
  // ============================================

  function closeDetailsModal() {
    const modal = document.getElementById('reservationDetailsModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  function openNewBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (!modal) return;

    const form = document.getElementById('bookingForm');
    if (form) form.reset();

    // Remplir le select depuis le cache
    fillPropertySelectFromCache();

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    console.log('✅ Modal nouvelle réservation ouvert');
  }

  function closeBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // ============================================
  // ✅ FONCTION CORRIGÉE - SOUMISSION FORMULAIRE
  // ============================================
  async function handleNewBookingSubmit(e) {
    e.preventDefault();
    console.log('📝 Soumission formulaire nouvelle réservation');

    try {
      // Récupérer les valeurs du formulaire
      const propertyId = document.getElementById('bookingProperty')?.value;
      const startDate = document.getElementById('checkIn')?.value;
      const endDate = document.getElementById('checkOut')?.value;
      const guestName = document.getElementById('guestName')?.value;
      const guestPhone = document.getElementById('guestPhone')?.value;
      const guestEmail = document.getElementById('guestEmail')?.value;
      const platform = document.getElementById('platform')?.value;
      const price = parseFloat(document.getElementById('price')?.value) || 0;
      const notes = document.getElementById('notes')?.value;

      console.log('📦 Données:', { propertyId, startDate, endDate, guestName });

      if (!propertyId || !startDate || !endDate) {
        showNotification('Veuillez remplir tous les champs obligatoires', 'error');
        return;
      }

      // Récupérer le token d'authentification
      const token = localStorage.getItem('lcc_token');
      if (!token) {
        showNotification('Vous n\'êtes pas authentifié', 'error');
        return;
      }

      // Envoyer la requête à l'API
      const response = await fetch('/api/reservations/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          propertyId: propertyId,
          start: startDate,
          end: endDate,
          guestName: guestName || 'Réservation manuelle',
          notes: notes || '',
          platform: platform || 'MANUEL',
          price: price,
          guestPhone: guestPhone,
          guestEmail: guestEmail
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors de la création');
      }

      const data = await response.json();
      console.log('✅ Réservation créée:', data);

      closeBookingModal();
      showNotification('Réservation ajoutée !', 'success');
      
      // Recharger après 1 seconde
      setTimeout(() => window.location.reload(), 1000);

    } catch (error) {
      console.error('❌ Erreur:', error);
      showNotification('Erreur: ' + error.message, 'error');
    }
  }

  function fillPropertySelectFromCache() {
    const select = document.getElementById('bookingProperty');
    if (!select) return;

    // Si le cache est vide, extraire à nouveau
    if (cachedProperties.length === 0) {
      extractPropertiesFromDOM();
    }

    select.innerHTML = '<option value="">Sélectionner un logement</option>';
    
    cachedProperties.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
    
    console.log('✅ Select rempli depuis cache:', cachedProperties.length, 'logements');
  }

  function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.textContent = message;
    notif.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#0E3B2E' : '#ef4444'};
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 10000;
      font-weight: 600;
    `;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
  }

  function formatDate(date) {
    if (!date || isNaN(date.getTime())) return 'Date inconnue';
    return date.toLocaleDateString('fr-FR', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  // Démarrer
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

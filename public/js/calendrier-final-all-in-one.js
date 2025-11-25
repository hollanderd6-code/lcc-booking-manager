// ============================================
// CALENDRIER MODERNE - SCRIPT FINAL TOUT-EN-UN
// Version ultime qui fait TOUT
// ============================================

(function() {
  'use strict';

  console.log('🚀 CALENDRIER MODERNE - Démarrage...');

  // Attendre que TOUT soit prêt
  let attempts = 0;
  const maxAttempts = 50;

  function waitForEverything() {
    attempts++;
    
    if (attempts > maxAttempts) {
      console.error('❌ Timeout - impossible d\'initialiser');
      return;
    }

    // Vérifier que state existe
    if (typeof window.state === 'undefined' || !window.state.properties || !window.state.bookings) {
      console.log(`⏳ Tentative ${attempts}/${maxAttempts} - Attente de state...`);
      setTimeout(waitForEverything, 200);
      return;
    }

    // Vérifier que les éléments DOM existent
    const propertyList = document.getElementById('propertyList');
    const calendarGrid = document.getElementById('calendarGrid');
    
    if (!propertyList || !calendarGrid) {
      console.log(`⏳ Tentative ${attempts}/${maxAttempts} - Attente du DOM...`);
      setTimeout(waitForEverything, 200);
      return;
    }

    console.log('✅ Tout est prêt ! Initialisation...');
    console.log('📊 Données:', window.state.properties.length, 'logements,', window.state.bookings.length, 'réservations');
    
    init();
  }

  function init() {
    // 1. Remplir la liste des logements
    fillPropertyList();
    
    // 2. Activer les clics sur les réservations
    activateBookingClicks();
    
    // 3. Activer les modals
    activateModals();
    
    // 4. Activer le bouton +
    activateFAB();
    
    console.log('🎉 CALENDRIER MODERNE COMPLÈTEMENT ACTIF !');
  }

  // ============================================
  // 1. REMPLIR LA LISTE DES LOGEMENTS
  // ============================================
  
  function fillPropertyList() {
    const container = document.getElementById('propertyList');
    if (!container) {
      console.warn('⚠️ propertyList introuvable');
      return;
    }

    const properties = window.state.properties || [];
    
    if (properties.length === 0) {
      container.innerHTML = '<div style="padding: 16px; text-align: center; color: #6b7280;">Aucun logement</div>';
      return;
    }

    container.innerHTML = '';

    properties.forEach(property => {
      const bookings = window.state.bookings || [];
      const count = bookings.filter(b => String(b.propertyId) === String(property.id)).length;

      const item = document.createElement('div');
      item.className = 'property-item';
      item.dataset.propertyId = property.id;
      
      item.innerHTML = `
        <span class="property-icon">
          <i class="fas fa-home"></i>
        </span>
        <span class="property-name">${property.name}</span>
        ${count > 0 ? `<span class="property-count">${count}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        console.log('🏠 Clic sur logement:', property.name);
        if (typeof selectProperty === 'function') {
          selectProperty(property.id);
        }
      });

      container.appendChild(item);
    });

    console.log('✅ Liste logements remplie:', properties.length, 'logements');
  }

  // ============================================
  // 2. ACTIVER LES CLICS SUR RÉSERVATIONS
  // ============================================
  
  function activateBookingClicks() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) {
      console.warn('⚠️ calendarGrid introuvable');
      return;
    }

    grid.addEventListener('click', function(e) {
      const bookingBlock = e.target.closest('.booking-block');
      
      if (bookingBlock && bookingBlock.dataset.bookingId) {
        const bookingId = bookingBlock.dataset.bookingId;
        const bookings = window.state.bookings || [];
        const booking = bookings.find(b => String(b.id) === String(bookingId));
        
        if (booking) {
          console.log('🖱️ Clic sur réservation:', booking.guestName);
          showBookingDetails(booking);
        } else {
          console.warn('⚠️ Réservation introuvable:', bookingId);
        }
      }
    });

    console.log('✅ Clics sur réservations activés');
  }

  // ============================================
  // 3. ACTIVER LES MODALS
  // ============================================
  
  function activateModals() {
    // Modal Details
    const closeDetailsBtn = document.getElementById('closeDetailsModal');
    const closeDetailsBtn2 = document.getElementById('closeDetailsBtn');
    const detailsOverlay = document.getElementById('detailsModalOverlay');
    
    if (closeDetailsBtn) closeDetailsBtn.onclick = closeDetailsModal;
    if (closeDetailsBtn2) closeDetailsBtn2.onclick = closeDetailsModal;
    if (detailsOverlay) detailsOverlay.onclick = closeDetailsModal;

    // Bouton Edit
    const editBtn = document.getElementById('editBookingBtn');
    if (editBtn) {
      editBtn.onclick = function() {
        if (window.currentBookingDetails) {
          openEditModal(window.currentBookingDetails);
        }
      };
    }

    // Bouton Delete
    const deleteBtn = document.getElementById('deleteBookingBtn');
    if (deleteBtn) {
      deleteBtn.onclick = function() {
        if (window.currentBookingDetails) {
          deleteBooking(window.currentBookingDetails);
        }
      };
    }

    // Modal Edit
    const closeEditBtn = document.getElementById('closeEditModal');
    const cancelEditBtn = document.getElementById('cancelEditBooking');
    const editOverlay = document.getElementById('editModalOverlay');
    
    if (closeEditBtn) closeEditBtn.onclick = closeEditModal;
    if (cancelEditBtn) cancelEditBtn.onclick = closeEditModal;
    if (editOverlay) editOverlay.onclick = closeEditModal;

    const editForm = document.getElementById('editBookingForm');
    if (editForm) editForm.onsubmit = handleEditSubmit;

    // Modal New Booking
    const closeBookingBtn = document.getElementById('closeModal');
    const cancelBookingBtn = document.getElementById('cancelBooking');
    const bookingOverlay = document.getElementById('modalOverlay');
    
    if (closeBookingBtn) closeBookingBtn.onclick = closeBookingModal;
    if (cancelBookingBtn) cancelBookingBtn.onclick = closeBookingModal;
    if (bookingOverlay) bookingOverlay.onclick = closeBookingModal;

    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) bookingForm.onsubmit = handleNewBookingSubmit;

    console.log('✅ Modals activés');
  }

  // ============================================
  // 4. ACTIVER LE BOUTON +
  // ============================================
  
  function activateFAB() {
    const fab = document.getElementById('addBookingBtn');
    if (!fab) {
      console.warn('⚠️ Bouton + introuvable');
      return;
    }

    fab.onclick = openNewBookingModal;
    console.log('✅ Bouton + activé');
  }

  // ============================================
  // FONCTIONS DE MODAL
  // ============================================

  function showBookingDetails(booking) {
    window.currentBookingDetails = booking;
    
    const modal = document.getElementById('reservationDetailsModal');
    const content = document.getElementById('reservationDetailsContent');
    
    if (!modal || !content) return;

    const properties = window.state.properties || [];
    const property = properties.find(p => String(p.id) === String(booking.propertyId));
    const propertyName = property ? property.name : 'Logement inconnu';

    const platformColors = {
      'airbnb': '#FF5A5F',
      'booking': '#003580',
      'direct': '#10B981',
      'expedia': '#FFC72C',
      'vrbo': '#1569C7'
    };

    const platform = (booking.source || booking.platform || 'direct').toLowerCase();
    const platformColor = platformColors[platform] || '#10B981';

    const startDate = new Date(booking.startDate);
    const endDate = new Date(booking.endDate);
    const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

    content.innerHTML = `
      <div class="detail-group">
        <label><i class="fas fa-user"></i> Client</label>
        <div class="detail-value">${booking.guestName || 'Non renseigné'}</div>
      </div>

      ${booking.guestPhone ? `
      <div class="detail-group">
        <label><i class="fas fa-phone"></i> Téléphone</label>
        <div class="detail-value">${booking.guestPhone}</div>
      </div>` : ''}

      ${booking.guestEmail ? `
      <div class="detail-group">
        <label><i class="fas fa-envelope"></i> Email</label>
        <div class="detail-value">${booking.guestEmail}</div>
      </div>` : ''}

      <div class="detail-group">
        <label><i class="fas fa-home"></i> Logement</label>
        <div class="detail-value">${propertyName}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-calendar-check"></i> Arrivée</label>
        <div class="detail-value">${formatDate(startDate)}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-calendar-times"></i> Départ</label>
        <div class="detail-value">${formatDate(endDate)}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-moon"></i> Nuitées</label>
        <div class="detail-value">${nights} nuit${nights > 1 ? 's' : ''}</div>
      </div>

      <div class="detail-group">
        <label><i class="fas fa-tag"></i> Plateforme</label>
        <div class="detail-value">
          <span style="background:${platformColor}; color:white; padding:4px 12px; border-radius:4px; font-size:12px; font-weight:600;">
            ${platform.toUpperCase()}
          </span>
        </div>
      </div>

      ${booking.price ? `
      <div class="detail-group">
        <label><i class="fas fa-euro-sign"></i> Prix</label>
        <div class="detail-value">${booking.price} €</div>
      </div>` : ''}

      ${booking.notes ? `
      <div class="detail-group">
        <label><i class="fas fa-sticky-note"></i> Notes</label>
        <div class="detail-value">${booking.notes}</div>
      </div>` : ''}
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    console.log('✅ Modal détails ouvert pour:', booking.guestName);
  }

  function closeDetailsModal() {
    const modal = document.getElementById('reservationDetailsModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  function openEditModal(booking) {
    closeDetailsModal();
    
    const modal = document.getElementById('editBookingModal');
    if (!modal) return;

    document.getElementById('editBookingId').value = booking.id;
    document.getElementById('editBookingProperty').value = booking.propertyId || '';
    document.getElementById('editCheckIn').value = booking.startDate ? booking.startDate.split('T')[0] : '';
    document.getElementById('editCheckOut').value = booking.endDate ? booking.endDate.split('T')[0] : '';
    document.getElementById('editGuestName').value = booking.guestName || '';
    document.getElementById('editGuestPhone').value = booking.guestPhone || '';
    document.getElementById('editGuestEmail').value = booking.guestEmail || '';
    document.getElementById('editPlatform').value = booking.platform || booking.source || 'direct';
    document.getElementById('editPrice').value = booking.price || '';
    document.getElementById('editNotes').value = booking.notes || '';

    fillPropertySelect('editBookingProperty');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    console.log('✅ Modal édition ouvert');
  }

  function closeEditModal() {
    const modal = document.getElementById('editBookingModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();

    const bookingId = document.getElementById('editBookingId').value;
    const formData = {
      propertyId: parseInt(document.getElementById('editBookingProperty').value),
      startDate: document.getElementById('editCheckIn').value,
      endDate: document.getElementById('editCheckOut').value,
      guestName: document.getElementById('editGuestName').value,
      guestPhone: document.getElementById('editGuestPhone').value,
      guestEmail: document.getElementById('editGuestEmail').value,
      platform: document.getElementById('editPlatform').value,
      price: parseFloat(document.getElementById('editPrice').value) || 0,
      notes: document.getElementById('editNotes').value,
      source: 'manual'
    };

    try {
      const response = await fetch(`/api/reservations/manual/${bookingId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        closeEditModal();
        showNotification('Réservation modifiée !', 'success');
        setTimeout(() => window.location.reload(), 1000);
      } else {
        throw new Error('Erreur');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de la modification', 'error');
    }
  }

  async function deleteBooking(booking) {
    if (!confirm('Supprimer cette réservation ?')) return;

    try {
      const response = await fetch(`/api/reservations/manual/${booking.id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        closeDetailsModal();
        showNotification('Réservation supprimée !', 'success');
        setTimeout(() => window.location.reload(), 1000);
      } else {
        throw new Error('Erreur');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de la suppression', 'error');
    }
  }

  function openNewBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (!modal) return;

    const form = document.getElementById('bookingForm');
    if (form) form.reset();

    fillPropertySelect('bookingProperty');

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

  async function handleNewBookingSubmit(e) {
    e.preventDefault();

    const formData = {
      propertyId: parseInt(document.getElementById('bookingProperty').value),
      startDate: document.getElementById('checkIn').value,
      endDate: document.getElementById('checkOut').value,
      guestName: document.getElementById('guestName').value,
      guestPhone: document.getElementById('guestPhone').value,
      guestEmail: document.getElementById('guestEmail').value,
      platform: document.getElementById('platform').value,
      price: parseFloat(document.getElementById('price').value) || 0,
      notes: document.getElementById('notes').value,
      source: 'manual'
    };

    try {
      const response = await fetch('/api/reservations/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        closeBookingModal();
        showNotification('Réservation ajoutée !', 'success');
        setTimeout(() => window.location.reload(), 1000);
      } else {
        throw new Error('Erreur');
      }
    } catch (error) {
      console.error('Erreur:', error);
      showNotification('Erreur lors de l\'ajout', 'error');
    }
  }

  function fillPropertySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) {
      console.warn('⚠️ Select introuvable:', selectId);
      return;
    }

    const properties = window.state.properties || [];
    
    select.innerHTML = '<option value="">Sélectionner un logement</option>';
    
    properties.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
    
    console.log('✅ Select rempli:', properties.length, 'logements');
  }

  function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.textContent = message;
    notif.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#10B981' : '#ef4444'};
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
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('fr-FR', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }

  // Démarrer
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForEverything);
  } else {
    waitForEverything();
  }

})();

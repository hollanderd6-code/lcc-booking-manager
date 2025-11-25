// ============================================
// CALENDRIER - ACTIVATION CLICS & MODALS
// Fonctionne SANS window.state
// ============================================

(function() {
  'use strict';

  console.log('🚀 Activation du calendrier interactif...');

  // Attendre que tout soit chargé
  function init() {
    if (!document.getElementById('calendarGrid')) {
      setTimeout(init, 100);
      return;
    }

    console.log('✅ DOM prêt, activation...');

    // 1. Activer les clics sur réservations
    activateBookingClicks();

    // 2. Activer les modals
    activateModals();

    // 3. Activer le bouton +
    activateFAB();

    console.log('🎉 Calendrier interactif activé !');
  }

  // ============================================
  // ACTIVER LES CLICS SUR RÉSERVATIONS
  // ============================================
  
  function activateBookingClicks() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;

    grid.addEventListener('click', async function(e) {
      const bookingBlock = e.target.closest('.booking-block');
      
      if (bookingBlock && bookingBlock.dataset.bookingId) {
        const bookingId = bookingBlock.dataset.bookingId;
        console.log('🖱️ Clic sur réservation:', bookingId);
        
        // Charger les détails depuis l'API
        await loadAndShowBooking(bookingId);
      }
    });

    console.log('✅ Clics sur réservations activés');
  }

  // ============================================
  // CHARGER ET AFFICHER UNE RÉSERVATION
  // ============================================
  
  async function loadAndShowBooking(bookingId) {
    try {
      const response = await fetch('/api/reservations', {
        credentials: 'include'
      });

      if (!response.ok) throw new Error('Erreur chargement');

      const data = await response.json();
      const bookings = data.reservations || data || [];
      
      // Trouver la réservation
      const booking = bookings.find(b => 
        String(b.id) === String(bookingId) ||
        b.icalUID === bookingId ||
        `${b.id}@${b.source}` === bookingId
      );

      if (booking) {
        console.log('✅ Réservation trouvée:', booking);
        showBookingDetails(booking);
      } else {
        console.warn('⚠️ Réservation introuvable:', bookingId);
        showNotification('Réservation introuvable', 'error');
      }

    } catch (error) {
      console.error('❌ Erreur:', error);
      showNotification('Erreur de chargement', 'error');
    }
  }

  // ============================================
  // AFFICHER LES DÉTAILS
  // ============================================
  
  async function showBookingDetails(booking) {
    window.currentBookingDetails = booking;
    
    const modal = document.getElementById('reservationDetailsModal');
    const content = document.getElementById('reservationDetailsContent');
    
    if (!modal || !content) return;

    // Charger les logements pour avoir le nom
    let propertyName = 'Logement inconnu';
    try {
      const propsResponse = await fetch('/api/properties', { credentials: 'include' });
      if (propsResponse.ok) {
        const propsData = await propsResponse.json();
        const properties = Array.isArray(propsData) ? propsData : (propsData.properties || propsData.logements || []);
        const property = properties.find(p => String(p.id) === String(booking.propertyId));
        if (property) propertyName = property.name;
      }
    } catch (e) {
      console.warn('Impossible de charger le nom du logement');
    }

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
    
    console.log('✅ Modal ouvert pour:', booking.guestName);
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

    // Modal Edit - Fermeture
    const closeEditBtn = document.getElementById('closeEditModal');
    const cancelEditBtn = document.getElementById('cancelEditBooking');
    const editOverlay = document.getElementById('editModalOverlay');
    
    if (closeEditBtn) closeEditBtn.onclick = closeEditModal;
    if (cancelEditBtn) cancelEditBtn.onclick = closeEditModal;
    if (editOverlay) editOverlay.onclick = closeEditModal;

    const editForm = document.getElementById('editBookingForm');
    if (editForm) editForm.onsubmit = handleEditSubmit;

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

  function closeDetailsModal() {
    const modal = document.getElementById('reservationDetailsModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  async function openEditModal(booking) {
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

    await fillPropertySelect('editBookingProperty');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
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

  async function openNewBookingModal() {
    const modal = document.getElementById('bookingModal');
    if (!modal) return;

    const form = document.getElementById('bookingForm');
    if (form) form.reset();

    await fillPropertySelect('bookingProperty');

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

  async function fillPropertySelect(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;

    try {
      const response = await fetch('/api/properties', { credentials: 'include' });
      if (!response.ok) throw new Error('Erreur');

      const data = await response.json();
      const properties = Array.isArray(data) ? data : (data.properties || data.logements || []);
      
      select.innerHTML = '<option value="">Sélectionner un logement</option>';
      
      properties.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name;
        select.appendChild(option);
      });
      
      console.log('✅ Select rempli:', properties.length, 'logements');
    } catch (error) {
      console.error('Erreur chargement logements:', error);
    }
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
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

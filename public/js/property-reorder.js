// property-reorder.js — Extracted from app.html
  document.addEventListener('DOMContentLoaded', function () {
    console.log('🔁 Correctif bouton + chargé');

    const addBtn        = document.getElementById('addBookingBtn') || document.getElementById('newReservationBtn');
    const modal         = document.getElementById('newReservationModal');
    const form          = document.getElementById('newReservationForm');
    const closeBtn      = document.getElementById('newReservationClose');
    const cancelBtn     = document.getElementById('newReservationCancel');

    const propertySelect = document.getElementById('nrProperty');
    const startInput     = document.getElementById('nrStartDate');
    const endInput       = document.getElementById('nrEndDate');
    const guestInput     = document.getElementById('nrGuestName');
    const notesInput     = document.getElementById('nrNotes');

    // Remplit la liste des logements
    function fillProperties() {
      if (!propertySelect) return;

      let properties = [];

      // 1) D\'abord depuis la variable globale
      if (Array.isArray(window.LCC_PROPERTIES) && window.LCC_PROPERTIES.length) {
        properties = window.LCC_PROPERTIES;
      } else {
        // 2) Sinon depuis le localStorage
        try {
          properties = JSON.parse(localStorage.getItem('LCC_PROPERTIES') || '[]');
        } catch (e) {
          console.error('Erreur parsing LCC_PROPERTIES', e);
          properties = [];
        }
      }

      propertySelect.innerHTML = '<option value="">Sélectionner un logement...</option>';

      if (properties && properties.length) {
        properties.forEach(function (p) {
          const opt = document.createElement('option');
          opt.value = p.id || p._id || p.propertyId || '';
          opt.textContent = p.name || p.title || ('Logement ' + (p.id || '?'));
          propertySelect.appendChild(opt);
        });
      } else {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = "Aucun logement trouvé (vérifiez 'Mes logements')";
        propertySelect.appendChild(opt);
      }
    }

    function openNewReservationModal() {
      if (!modal) return;

      console.log('➕ Clic sur + (correctif)');
      fillProperties();

      // Dates par défaut : aujourd\'hui si vide
      const today = new Date().toISOString().slice(0, 10);
      if (startInput && !startInput.value) startInput.value = today;
      if (endInput && !endInput.value) { var tom = new Date(); tom.setDate(tom.getDate() + 1); endInput.value = tom.toISOString().slice(0, 10); }

      modal.style.display = 'flex';
      modal.classList.add('active');
    }

    function closeNewReservationModal() {
      if (!modal) return;
      modal.style.display = 'none';
      modal.classList.remove('active');
    }

    // Clic sur le bouton +
    if (addBtn) {
      addBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openNewReservationModal();
      });
    }

    // Fermeture (croix + bouton Annuler)
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closeNewReservationModal();
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closeNewReservationModal();
      });
    }

    // Soumission du formulaire "Nouvelle réservation"
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!propertySelect || !startInput || !endInput) return;

        const phoneInput    = document.getElementById('nrPhone');
        const emailInput    = document.getElementById('nrEmail');
        const platformInput = document.getElementById('nrPlatform');
        const priceInput    = document.getElementById('nrPrice');

        const isBHGuest = false; // La nouvelle réservation manuelle n'est jamais BHGuest

        const payload = {
          propertyId:   propertySelect.value,
          start:        startInput.value,
          end:          endInput.value,
          guestName:    guestInput ? guestInput.value : '',
          notes:        notesInput ? notesInput.value : '',
          phone:        phoneInput ? phoneInput.value : '',
          email:        emailInput ? emailInput.value : '',
          platform:     isBHGuest ? (currentBookingData.source || currentBookingData.platform || 'guest_app') : (platformInput ? platformInput.value : 'direct'),
          price:        priceInput && priceInput.value ? parseFloat(priceInput.value) : null,
          guest_country:     document.getElementById('nrCountry')?.value || null,
          occupancy_adults:  document.getElementById('nrAdults')?.value ? parseInt(document.getElementById('nrAdults').value) : null,
          amount_rooms:      document.getElementById('nrPriceRooms')?.value ? parseFloat(document.getElementById('nrPriceRooms').value) : null,
          amount_cleaning:   document.getElementById('nrPriceCleaning')?.value ? parseFloat(document.getElementById('nrPriceCleaning').value) : null,
          amount_taxes:      document.getElementById('nrPriceTaxes')?.value ? parseFloat(document.getElementById('nrPriceTaxes').value) : null,
          ota_commission:    document.getElementById('nrCommission')?.value ? parseFloat(document.getElementById('nrCommission').value) : null,
        };

        // Vérifs basiques
        if (!payload.propertyId) {
          alert("⚠️ Attention : veuillez sélectionner un logement.");
          return;
        }
        if (!payload.start || !payload.end) {
          alert("⚠️ Attention : les dates sont obligatoires.");
          return;
        }

        const token = localStorage.getItem('lcc_token');
        if (!token) {
          alert("⚠️ Impossible d\'enregistrer : vous n\'êtes pas authentifié (token manquant).");
          return;
        }

        console.log('📦 Envoi nouvelle réservation manuelle :', payload);

        try {
          const res = await fetch('https://lcc-booking-manager.onrender.com/api/reservations/manual', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(payload)
          });

          const data = await res.json();
          console.log('📥 Réponse réservation manuelle :', data);

          if (res.ok) {
            alert('✅ Réservation enregistrée avec succès');
            closeNewReservationModal();
            location.reload();
          } else {
            alert("❌ Erreur serveur : " + (data.error || data.message || 'Problème inconnu'));
          }
        } catch (err) {
          console.error('❌ Erreur réseau sur /reservations/manual', err);
          alert("❌ Erreur réseau lors de l\'enregistrement : " + err.message);
        }
      });
    }
  });

// ===== WIDGET CHECKLISTS DE MÉNAGE =====

let cleaningChecklists = [];
    // Créer la modale dynamiquement au chargement
(function() {
  const modalHTML = `
<div class="checklist-modal-overlay" id="checklistModal">
  <div class="checklist-modal" onclick="event.stopPropagation()">
    <div class="checklist-modal-header">
      <div>
        <h2 id="modalChecklistProperty">Logement</h2>
        <div class="checklist-modal-meta">
          <span id="modalChecklistDate"></span>
          <span class="separator">•</span>
          <span id="modalChecklistCleaner"></span>
        </div>
      </div>
      <button class="close-modal-btn" onclick="closeChecklistModal()">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="checklist-modal-status" id="modalChecklistStatus"></div>
    <div class="checklist-modal-body">
      <div class="modal-section">
        <h3 class="modal-section-title"><i class="fas fa-user"></i> Informations voyageur</h3>
        <div class="modal-info-grid">
          <div class="modal-info-item">
            <span class="modal-info-label">Date de départ</span>
            <span class="modal-info-value" id="modalCheckoutDate">-</span>
          </div>
        </div>
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title"><i class="fas fa-check-square"></i> Tâches effectuées</h3>
        <div id="modalTasksList" class="tasks-list"></div>
      </div>
      <div class="modal-section">
        <h3 class="modal-section-title"><i class="fas fa-camera"></i> Photos du logement</h3>
        <div id="modalPhotosList" class="photos-grid"></div>
      </div>
      <div class="modal-section" id="modalNotesSection" style="display: none;">
        <h3 class="modal-section-title"><i class="fas fa-sticky-note"></i> Notes complémentaires</h3>
        <div class="notes-content" id="modalNotes"></div>
      </div>
    </div>
    <div class="checklist-modal-footer" id="modalFooter">
      <button class="btn btn-ghost" onclick="closeChecklistModal()">Fermer</button>
      <button class="btn btn-primary" onclick="downloadChecklistPDF()">
        <i class="fas fa-download"></i> Télécharger PDF
      </button>
    </div>
  </div>
</div>`;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
})();

async function loadCleaningChecklists() {
  const container = document.getElementById('checklistsContainer');
  // Guard supprime : on fetch meme sans container pour mettre a jour le KPI
  
  try {
    const token = localStorage.getItem('lcc_token');
    if (!token) return;
    
    const response = await fetch(`${API_URL}/api/cleaning/checklists`, {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (!response.ok) {
      throw new Error('Erreur lors du chargement des checklists');
    }
    
    const data = await response.json();
    cleaningChecklists = data.checklists || [];
    
    // Mettre à jour le KPI checklists en attente
    (function() {
      const pending = cleaningChecklists.filter(cl => {
        const isCompleted = cl.is_validated || cl.owner_status === 'validated';
        const isRejected = cl.owner_status === 'rejected';
        return !isCompleted && !isRejected && cl.completed_at;
      });
      const val = document.getElementById('kpiChecklistsValue');
      const sub = document.getElementById('kpiChecklistsSub');
      if (val) val.textContent = pending.length;
      if (sub) sub.textContent = pending.length === 0 ? 'tout est validé ✓'
        : pending.length === 1 ? 'checklist en attente' : 'checklists en attente';
    })();
    
    // ✅ Enrichir les checklists avec les données des réservations (nom voyageur, plateforme)
    if (window.RESERVATIONS && window.RESERVATIONS.length > 0) {
      cleaningChecklists.forEach(function(cl) {
        if (cl.guest_name && cl.guest_name.trim() !== '') return; // Déjà rempli

        // Chercher la réservation correspondante
        var match = window.RESERVATIONS.find(function(r) {
          // Stratégie 1 : reservation_key exact (le plus fiable)
          var rKey = r.uid || r.id || r.reservationKey || '';
          if (cl.reservation_key && rKey && cl.reservation_key === rKey) return true;
          // Stratégie 2 : property_id + checkout_date (fallback)
          var rPropertyId = r.propertyId || (r.property && r.property.id) || '';
          var rEnd = String(r.end || '').slice(0, 10);
          var clCheckout = cl.checkout_date ? String(cl.checkout_date).slice(0, 10) : '';
          return rPropertyId === cl.property_id && rEnd === clCheckout;
        });
        
        if (match) {
          cl.guest_name = match.guestName || match.guest_name || match.name || '';
          cl.guest_first_name = match.guest_first_name || '';
          cl.guest_last_name = match.guest_last_name || '';
          cl.guest_display_name = match.guest_display_name || '';
          cl.guest_initial = match.guest_initial || '';
          cl.source = match.source || match.platform || '';
          cl.platform = match.platform || match.source || '';
        }
      });
    }
    
    window.cleaningChecklists = cleaningChecklists;
    
    renderCleaningChecklists();
  } catch (err) {
    console.error('Erreur chargement checklists:', err);
    if (container) container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-exclamation-circle"></i>
        <p>Erreur lors du chargement</p>
      </div>
    `;
  }
}

function renderCleaningChecklists() {
  const container = document.getElementById('checklistsContainer');
  if (!container) return;
  
  if (cleaningChecklists.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-broom"></i>
        <p>Aucune checklist</p>
        <small>Les checklists validées par vos équipes apparaîtront ici</small>
      </div>
    `;
    return;
  }
  
  // ✅ Prioriser : aujourd\'hui, J-1, J-2, puis le reste récent (max 7 jours)
  function localDateStr(d){
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = localDateStr(today);

    const daysAgo = (n) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return localDateStr(d);
    };
  
  const day1Str = daysAgo(1);
  const day2Str = daysAgo(2);
  const day7Str = daysAgo(2); // limite: aujourd\'hui, hier, avant-hierr
  
  // Extraire la date de checkout de chaque checklist
  function getCheckoutStr(checklist) {
    // D\'abord checkout_date brut
    if (checklist.checkout_date) {
      return String(checklist.checkout_date).slice(0, 10);
    }
    // Sinon depuis reservation_key
    const parts = (checklist.reservation_key || '').split('_');
    if (parts.length >= 3) {
      return parts[parts.length - 1];
    }
    // Sinon depuis completed_at
    if (checklist.completed_at) {
      return String(checklist.completed_at).slice(0, 10);
    }
    return '1970-01-01';
  }
  
  // Séparer en catégories avec priorité
  const todayChecklists = [];
  const yesterdayChecklists = [];
  const day2Checklists = [];
  const olderChecklists = [];
  
  cleaningChecklists.forEach(c => {
    const dateStr = getCheckoutStr(c);
    if (dateStr >= todayStr) {
      todayChecklists.push(c);
    } else if (dateStr >= day1Str) {
      yesterdayChecklists.push(c);
    } else if (dateStr >= day2Str) {
      day2Checklists.push(c);
    } else if (dateStr >= day7Str) {
      olderChecklists.push(c);
    }
    // Ignorer > 7 jours
  });
  
  // Construire la liste triée par priorité : en attente d\'abord, puis par date
  const sortByPending = (a, b) => {
    const aPending = (!a.is_validated && !a.owner_status) || a.owner_status === 'pending' ? 0 : 1;
    const bPending = (!b.is_validated && !b.owner_status) || b.owner_status === 'pending' ? 0 : 1;
    return aPending - bPending;
  };
  
  todayChecklists.sort(sortByPending);
  yesterdayChecklists.sort(sortByPending);
  day2Checklists.sort(sortByPending);
  
  // Fusionner : aujourd\'hui d\'abord, puis hier, puis J-2, puis le reste — max 8
  const prioritized = [
    ...todayChecklists,
    ...yesterdayChecklists,
    ...day2Checklists,
    ...olderChecklists
  ].slice(0, 8);
  
  if (prioritized.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-broom"></i>
        <p>Aucune checklist récente</p>
        <small>Les checklists des 2 derniers jours apparaîtront ici</small>
      </div>
    `;
    return;
  }
  
  container.innerHTML = prioritized.map(checklist => {
    const isCompleted = checklist.is_validated || (checklist.owner_status === 'validated');
    const isRejected = checklist.owner_status === 'rejected';
    const isPending = !isCompleted && !isRejected;
    
    let cardClass, badgeClass, badgeIcon, badgeText;
    if (isRejected) {
      cardClass = 'checklist-card-pending';
      badgeClass = 'checklist-badge-pending';
      badgeIcon = 'fa-exclamation-triangle';
      badgeText = 'Rejeté';
    } else if (isCompleted) {
      cardClass = 'checklist-card-completed';
      badgeClass = 'checklist-badge-completed';
      badgeIcon = 'fa-check-circle';
      badgeText = 'Validé';
    } else {
      cardClass = 'checklist-card-pending';
      badgeClass = 'checklist-badge-pending';
      badgeIcon = 'fa-clock';
      badgeText = 'En attente';
    }
    
    // Date
    const checkoutDateStr = getCheckoutStr(checklist);
    const formattedDate = checkoutDateStr ? formatChecklistDate(checkoutDateStr) : 'Date inconnue';
    
    // Label de fraîcheur
    const tomorrowDate = new Date(today);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowStr = localDateStr(tomorrowDate);
    let freshLabel = '';
    if (checkoutDateStr === todayStr) {
      freshLabel = '<span style="font-size:10px; padding:2px 6px; border-radius:8px; background:#fee2e2; color:#dc2626; font-weight:700; margin-left:6px;">Aujourd\'hui</span>';
    } else if (checkoutDateStr === tomorrowStr) {
      freshLabel = '<span style="font-size:10px; padding:2px 6px; border-radius:8px; background:#dcfce7; color:#16a34a; font-weight:700; margin-left:6px;">Demain</span>';
    } else if (checkoutDateStr > tomorrowStr) {
      // date future (après demain) — pas de badge
    } else if (checkoutDateStr >= day1Str) {
      freshLabel = '<span style="font-size:10px; padding:2px 6px; border-radius:8px; background:#fef3c7; color:#b45309; font-weight:700; margin-left:6px;">Hier</span>';
    } else if (checkoutDateStr >= day2Str) {
      freshLabel = '<span style="font-size:10px; padding:2px 6px; border-radius:8px; background:#e0f2fe; color:#0369a1; font-weight:700; margin-left:6px;">Avant-hier</span>';
    }
    
    // Durée
    const durationMin = checklist.duration_seconds ? Math.round(checklist.duration_seconds / 60) : null;
    
    // Nom du logement
    const propertyName = getPropertyNameFromChecklistKey(checklist.reservation_key, checklist.property_id);
    
    return `
      <div class="checklist-card ${cardClass}" onclick="openChecklistDetails('${checklist.id}')">
        <div class="checklist-card-header">
          <div class="checklist-property">${propertyName}${freshLabel}</div>
          <span class="checklist-badge ${badgeClass}">
            <i class="fas ${badgeIcon}"></i>
            ${badgeText}
          </span>
        </div>
        
        <div class="checklist-info">
          <div class="checklist-info-row">
            <i class="fas fa-calendar"></i>
            <span>Départ : ${formattedDate}</span>
          </div>
          <div class="checklist-info-row">
            <i class="fas fa-user"></i>
            <div style="display: inline-flex; align-items: center; gap: 8px;">
              <span style="
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                font-size: 11px;
                font-weight: 600;
              ">${window.getGuestInitial ? window.getGuestInitial(checklist) : 'V'}</span>
              <span>${window.cleanGuestName ? window.cleanGuestName(checklist) : 'Voyageur'}</span>
            </div>
          </div>
          <div class="checklist-info-row">
            <i class="fas fa-user-check"></i>
            <span>${checklist.cleaner_name || 'Non assigné'}${durationMin ? ' · ' + durationMin + ' min' : ''}</span>
          </div>
        </div>
        
        <div class="checklist-footer">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openChecklistDetails('${checklist.id}')">
            <i class="fas fa-eye"></i> Voir les détails
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function getPropertyNameFromChecklistKey(reservationKey, fallbackPropertyId) {
  if (!reservationKey) {
    return fallbackPropertyId || 'Logement';
  }
  
  const parts = reservationKey.split('_');
  if (parts.length < 3) {
    return fallbackPropertyId || 'Logement';
  }
  
  const propertyId = parts.slice(0, parts.length - 2).join('_');
  
  if (window.LCC_PROPERTIES && Array.isArray(window.LCC_PROPERTIES)) {
    const property = window.LCC_PROPERTIES.find(p => 
      p.id === propertyId || 
      p.propertyId === propertyId
    );
    
    if (property) {
      return property.name || property.title || property.label || propertyId;
    }
  }
  
  return propertyId;
}

function formatChecklistDate(dateStr) {
  if (!dateStr) return '';
  
  // Gérer les dates ISO (ex: 2025-12-25T00:00:00.000Z)
  if (dateStr.includes('T')) {
    dateStr = dateStr.split('T')[0];
  }
  
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

async function openChecklistDetails(checklistId) {
  const checklist = cleaningChecklists.find(c => c.id == checklistId);
  if (!checklist) return;
  
  // Récupérer les détails complets depuis l\'API
  try {
    const token = localStorage.getItem('lcc_token');
    const response = await fetch(`${API_URL}/api/cleaning/checklists/${checklistId}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    
    if (!response.ok) {
      throw new Error('Erreur chargement détails');
    }
    
    const data = await response.json();
    const fullChecklist = data.checklist;
    
    // Remplir la modale
    populateChecklistModal(fullChecklist);
    
    // Afficher la modale
    document.getElementById('checklistModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    
  } catch (err) {
    console.error('Erreur chargement checklist:', err);
    alert('Erreur lors du chargement des détails de la checklist');
  }
}

function populateChecklistModal(checklist) {
  const propertyName = getPropertyNameFromChecklistKey(checklist.reservation_key, checklist.property_id);
  
  // Header
  document.getElementById('modalChecklistProperty').textContent = propertyName;
  document.getElementById('modalChecklistDate').textContent = `Départ : ${formatChecklistDate(checklist.checkout_date)}`;
  document.getElementById('modalChecklistCleaner').textContent = `Par ${checklist.cleaner_name || 'N/A'}`;
  
  // Status
  const isCompleted = checklist.is_validated || checklist.owner_status === 'validated';
  const statusEl = document.getElementById('modalChecklistStatus');
  statusEl.className = 'checklist-modal-status ' + (isCompleted ? 'status-completed' : 'status-pending');
  statusEl.innerHTML = `
    <i class="fas ${isCompleted ? 'fa-check-circle' : 'fa-clock'}"></i>
    ${isCompleted ? 'Checklist validée' : 'En attente de validation'}
  `;
  
  // Guest info
  document.getElementById('modalCheckoutDate').textContent = formatChecklistDate(checklist.checkout_date);
  
  // Tasks
  const tasks = typeof checklist.tasks === 'string' ? JSON.parse(checklist.tasks) : (checklist.tasks || []);
  const tasksHTML = tasks.map(task => `
    <div class="task-item-modal ${task.checked ? 'checked' : ''}">
      <div class="task-checkbox">
        ${task.checked ? '<i class="fas fa-check"></i>' : ''}
      </div>
      <span class="task-name">${task.name}</span>
    </div>
  `).join('');
  document.getElementById('modalTasksList').innerHTML = tasksHTML || '<p style="color: var(--text-tertiary); font-style: italic;">Aucune tâche</p>';
  
  // Photos
  const photos = typeof checklist.photos === 'string' ? JSON.parse(checklist.photos) : (checklist.photos || []);
  const photosHTML = photos.map((photo, idx) => `
    <div class="photo-item" onclick="viewPhotoFullscreen('${photo}', ${idx})">
      <img src="${photo}" alt="Photo ${idx + 1}">
      <div class="photo-zoom-icon">
        <i class="fas fa-search-plus"></i>
      </div>
    </div>
  `).join('');
  document.getElementById('modalPhotosList').innerHTML = photosHTML || '<p style="color: var(--text-tertiary); font-style: italic;">Aucune photo</p>';
  
  // Notes
  if (checklist.notes && checklist.notes.trim()) {
    document.getElementById('modalNotesSection').style.display = 'block';
    document.getElementById('modalNotes').textContent = checklist.notes;
  } else {
    document.getElementById('modalNotesSection').style.display = 'none';
  }

  // Bouton valider — visible uniquement si en attente
  const footer = document.getElementById('modalFooter');
  const existingBtn = document.getElementById('btnValidateChecklist');
  if (existingBtn) existingBtn.remove();
  const existingComplementBtn = document.getElementById('btnComplementChecklist');
  if (existingComplementBtn) existingComplementBtn.remove();

  if (!isCompleted) {
    const validateBtn = document.createElement('button');
    validateBtn.id = 'btnValidateChecklist';
    validateBtn.className = 'btn btn-success';
    validateBtn.style.cssText = 'background:#10b981;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;';
    validateBtn.innerHTML = '<i class="fas fa-check"></i> Valider le ménage';
    validateBtn.onclick = () => validateChecklist(checklist.id);
    footer.insertBefore(validateBtn, footer.firstChild);

    const complementBtn = document.createElement('button');
    complementBtn.id = 'btnComplementChecklist';
    complementBtn.className = 'btn';
    complementBtn.style.cssText = 'background:#fff3cd;color:#b45309;border:1.5px solid #f59e0b;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;';
    complementBtn.innerHTML = '<i class="fas fa-undo"></i> Demander un complément';
    complementBtn.onclick = () => openComplementModal(checklist.id);
    footer.insertBefore(complementBtn, validateBtn.nextSibling);
  }

  // Garder une ref à la checklist courante
  window._currentChecklistId = checklist.id;
  window._currentChecklist = checklist;
}

async function validateChecklist(checklistId) {
  const btn = document.getElementById('btnValidateChecklist');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Validation...'; }

  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/cleaning/checklists/${checklistId}/validate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur serveur');
    }

    // Mettre à jour le statut dans le modal
    const statusEl = document.getElementById('modalChecklistStatus');
    if (statusEl) {
      statusEl.className = 'checklist-modal-status status-completed';
      statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Checklist validée';
    }
    if (btn) btn.remove();

    // Rafraîchir la liste
    loadCleaningChecklists();

    showToast('✅ Ménage validé — le cleaner a été notifié', 'success');
  } catch(e) {
    console.error('Erreur validation:', e);
    showToast('Erreur : ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Valider le ménage'; }
  }
}

function openComplementModal(id) {
  let modal = document.getElementById('appComplementModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'appComplementModal';
    modal.innerHTML = `
      <div id="appComplementBackdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);z-index:10000;" onclick="closeComplementModal()"></div>
      <div id="appComplementPanel" style="position:fixed;left:50%;transform:translateX(-50%);z-index:10001;width:100%;max-width:440px;padding:16px;box-sizing:border-box;bottom:0;">
        <div style="background:var(--bg-primary,#fff);border-radius:20px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.22);">
          <div style="padding:20px 20px 14px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(200,184,154,.3);">
            <div style="width:36px;height:36px;border-radius:10px;background:#fff3cd;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-undo" style="color:#b45309;font-size:15px;"></i>
            </div>
            <div>
              <div style="font-weight:700;font-size:15px;color:var(--text-primary);">Demande de complément</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">Le message sera envoyé par notification push</div>
            </div>
            <button onclick="closeComplementModal()" style="margin-left:auto;width:30px;height:30px;border-radius:8px;border:1px solid rgba(200,184,154,.4);background:transparent;cursor:pointer;font-size:16px;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;">&times;</button>
          </div>
          <div style="padding:16px 20px;">
            <label style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-secondary);display:block;margin-bottom:8px;">Message pour la personne de ménage</label>
            <textarea id="appComplementText" rows="3" placeholder="Ex : Merci de repasser sur la salle de bain, quelques points sont à revoir." style="width:100%;box-sizing:border-box;padding:12px;border:1.5px solid rgba(200,184,154,.5);border-radius:12px;font-size:14px;font-family:inherit;resize:none;background:var(--bg-secondary,#f8f6f1);color:var(--text-primary);outline:none;transition:border-color .15s;" onfocus="this.style.borderColor='#1A7A5E'" onblur="this.style.borderColor='rgba(200,184,154,.5)'"></textarea>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button onclick="closeComplementModal()" style="flex:1;padding:12px;border:1.5px solid rgba(200,184,154,.5);border-radius:12px;background:transparent;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;color:var(--text-secondary);">Annuler</button>
              <button onclick="submitComplement()" style="flex:2;padding:12px;border:none;border-radius:12px;background:#b45309;color:white;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                <i class="fas fa-paper-plane"></i> Envoyer la demande
              </button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal._targetId = id;
  modal.style.display = 'block';
  setTimeout(() => { const ta = document.getElementById('appComplementText'); if(ta){ta.value='';ta.focus();} }, 50);
}

function closeComplementModal() {
  const modal = document.getElementById('appComplementModal');
  if (modal) modal.style.display = 'none';
}

async function submitComplement() {
  const modal = document.getElementById('appComplementModal');
  const id = modal._targetId;
  const notes = (document.getElementById('appComplementText').value || '').trim();
  if (!notes) { document.getElementById('appComplementText').focus(); return; }
  closeComplementModal();
  try {
    const token = localStorage.getItem('lcc_token');
    const res = await fetch(`${API_URL}/api/cleaning/checklists/${id}/reject`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ notes })
    });
    if (!res.ok) throw new Error('err');

    // Mettre à jour le statut dans le modal
    const statusEl = document.getElementById('modalChecklistStatus');
    if (statusEl) {
      statusEl.className = 'checklist-modal-status status-pending';
      statusEl.innerHTML = '<i class="fas fa-undo"></i> Complément demandé';
      statusEl.style.background = 'rgba(245,158,11,.1)';
      statusEl.style.color = '#b45309';
    }
    // Retirer les boutons d'action
    const vBtn = document.getElementById('btnValidateChecklist');
    const cBtn = document.getElementById('btnComplementChecklist');
    if (vBtn) vBtn.remove();
    if (cBtn) cBtn.remove();

    loadCleaningChecklists();
    showToast('📨 Complément demandé — le cleaner a été notifié', 'warning');
  } catch(e) {
    console.error(e);
    showToast('Erreur lors de l\'envoi', 'error');
  }
}

function closeChecklistModal(event) {
  if (event && event.target.classList.contains('checklist-modal')) return;
  
  document.getElementById('checklistModal').classList.remove('active');
  document.body.style.overflow = '';
}

function viewPhotoFullscreen(photoSrc, index) {
  var existing = document.getElementById('bhLightbox');
  if (existing) existing.remove();
  var photos = [];
  document.querySelectorAll('#modalPhotosList .photo-item img').forEach(function(img) { photos.push(img.src); });
  var lb = document.createElement('div');
  lb.id = 'bhLightbox';
  lb.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;';
  var currentIdx = index;
  function render() {
    lb.innerHTML = '';
    var closeBtn = document.createElement('button');
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);border:none;color:white;width:40px;height:40px;border-radius:50%;font-size:18px;cursor:pointer;z-index:1;';
    closeBtn.onclick = function() { lb.remove(); };
    lb.appendChild(closeBtn);
    if (photos.length > 1) {
      var counter = document.createElement('div');
      counter.style.cssText = 'position:absolute;top:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.7);font-size:13px;';
      counter.textContent = (currentIdx + 1) + ' / ' + photos.length;
      lb.appendChild(counter);
    }
    var img = document.createElement('img');
    img.src = photos[currentIdx];
    img.style.cssText = 'max-width:92vw;max-height:88vh;border-radius:8px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,0.5);';
    lb.appendChild(img);
    if (photos.length > 1) {
      var prev = document.createElement('button');
      prev.innerHTML = '<i class="fas fa-chevron-left"></i>';
      prev.style.cssText = 'position:absolute;left:16px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;color:white;width:44px;height:44px;border-radius:50%;font-size:18px;cursor:pointer;';
      prev.onclick = function(e) { e.stopPropagation(); currentIdx = (currentIdx - 1 + photos.length) % photos.length; render(); };
      lb.appendChild(prev);
      var next = document.createElement('button');
      next.innerHTML = '<i class="fas fa-chevron-right"></i>';
      next.style.cssText = 'position:absolute;right:70px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;color:white;width:44px;height:44px;border-radius:50%;font-size:18px;cursor:pointer;';
      next.onclick = function(e) { e.stopPropagation(); currentIdx = (currentIdx + 1) % photos.length; render(); };
      lb.appendChild(next);
    }
  }
  render();
  lb.addEventListener('click', function(e) { if (e.target === lb) lb.remove(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', onKey); }
    if (e.key === 'ArrowRight' && photos.length > 1) { currentIdx = (currentIdx + 1) % photos.length; render(); }
    if (e.key === 'ArrowLeft' && photos.length > 1) { currentIdx = (currentIdx - 1 + photos.length) % photos.length; render(); }
  });
  document.body.appendChild(lb);
}

function loadImageAsDataURL(url) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = function() { reject(new Error('img load failed')); };
    img.src = url;
  });
}

async function downloadChecklistPDF() {
  var c = window._currentChecklist;
  if (!c) return;
  var btn = document.querySelector('[onclick="downloadChecklistPDF()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Génération...'; }
  try {
    var { jsPDF } = window.jspdf;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var tasks = typeof c.tasks === 'string' ? JSON.parse(c.tasks) : (c.tasks || []);
    var photos = typeof c.photos === 'string' ? JSON.parse(c.photos) : (c.photos || []);
    var completedAt = c.completed_at ? new Date(c.completed_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    var checkoutDate = c.checkout_date ? c.checkout_date.slice(0,10).split('-').reverse().join('/') : '—';
    var st = c.owner_status === 'validated' ? 'Validé' : c.owner_status === 'rejected' ? 'Rejeté' : 'En attente';
    var margin = 15, y = 20, pageW = 210;
    // Header vert
    doc.setFillColor(26, 122, 94);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text('Rapport de ménage', margin, 14);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text('Boostinghost', margin, 22);
    y = 38;
    // Infos
    doc.setTextColor(50, 50, 50); doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text('Date de départ : ' + checkoutDate, margin, y); y += 6;
    doc.text('Cleaner : ' + (c.cleaner_name || 'N/A'), margin, y); y += 6;
    doc.text('Soumis le : ' + completedAt, margin, y); y += 6;
    // Statut
    var stRgb = c.owner_status === 'validated' ? [16,185,129] : c.owner_status === 'rejected' ? [239,68,68] : [245,158,11];
    doc.setFillColor(stRgb[0], stRgb[1], stRgb[2]);
    doc.roundedRect(margin, y, 32, 7, 2, 2, 'F');
    doc.setTextColor(255,255,255); doc.setFontSize(9); doc.setFont('helvetica','bold');
    doc.text(st, margin + 3, y + 5); y += 14;
    // Tâches
    doc.setTextColor(26,122,94); doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text('Tâches effectuées', margin, y); y += 2;
    doc.setDrawColor(26,122,94); doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y); y += 6;
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    tasks.forEach(function(t) {
      if (y > 272) { doc.addPage(); y = 20; }
      doc.setTextColor(t.checked ? 16 : 239, t.checked ? 185 : 68, t.checked ? 129 : 68);
      doc.text(t.checked ? '✓' : '✗', margin, y);
      doc.setTextColor(50,50,50);
      doc.text((t.name || t.title || ''), margin + 6, y);
      y += 6;
    });
    y += 4;
    // Notes
    if (c.notes && c.notes.trim()) {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setTextColor(26,122,94); doc.setFontSize(12); doc.setFont('helvetica','bold');
      doc.text('Notes', margin, y); y += 2;
      doc.line(margin, y, pageW - margin, y); y += 6;
      doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(50,50,50);
      var lines = doc.splitTextToSize(c.notes, pageW - margin * 2);
      doc.text(lines, margin, y); y += lines.length * 5 + 4;
    }
    // Photos
    if (photos.length > 0) {
      if (y > 240) { doc.addPage(); y = 20; }
      doc.setTextColor(26,122,94); doc.setFontSize(12); doc.setFont('helvetica','bold');
      doc.text('Photos (' + photos.length + ')', margin, y); y += 2;
      doc.line(margin, y, pageW - margin, y); y += 6;
      var photoW = 55, photoH = 42, perRow = 3, col = 0;
      for (var i = 0; i < photos.length; i++) {
        if (y + photoH > 282) { doc.addPage(); y = 20; col = 0; }
        try {
          var imgData = await loadImageAsDataURL(photos[i]);
          doc.addImage(imgData, 'JPEG', margin + col * (photoW + 5), y, photoW, photoH);
        } catch(e) { /* skip */ }
        col++;
        if (col >= perRow) { col = 0; y += photoH + 5; }
      }
      if (col > 0) y += photoH + 5;
    }
    // Bloc certification signature
    if (c.cleaner_certified && c.signature_data) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setFillColor(26,122,94); doc.rect(0,y,pageW,8,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont('helvetica','bold');
      doc.text('Certification du ménage', margin, y+5.5); y += 14;

      doc.setTextColor(50,50,50); doc.setFontSize(9); doc.setFont('helvetica','normal');
      var certDate = c.certified_at ? new Date(c.certified_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
      doc.text('Certifié le : ' + certDate, margin, y); y += 6;
      doc.text('Adresse IP : ' + (c.signature_ip||'—'), margin, y); y += 6;
      doc.text('Cleaner : ' + (c.cleaner_name||'—'), margin, y); y += 6;
      doc.setFontSize(8); doc.setTextColor(100,100,100);
      doc.text('Je certifie avoir effectué toutes les tâches de ménage listées dans cette checklist.', margin, y); y += 8;
      try {
        doc.addImage(c.signature_data, 'PNG', margin, y, 70, 28);
        doc.setDrawColor(200,184,154); doc.setLineWidth(0.3);
        doc.rect(margin, y, 70, 28); y += 32;
      } catch(e) {}
      doc.setFillColor(16,185,129); doc.roundedRect(margin,y,70,8,2,2,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont('helvetica','bold');
      doc.text('Document certifié', margin+3, y+5.5);
    }

    var filename = 'menage-certifie-' + checkoutDate.replace(/\//g,'-') + '-' + (c.cleaner_name||'cleaner').replace(/\s+/g,'-') + '.pdf';
    doc.save(filename);
  } catch(e) {
    console.error('PDF error:', e);
    alert('Erreur lors de la génération du PDF : ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Télécharger PDF'; }
  }
}
// Charger au démarrage
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadCleaningChecklists);
} else {
  loadCleaningChecklists();
}


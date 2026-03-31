// ============================================================
// BOOSTINGHOST GUEST — app-guest.js
// ============================================================

const IS_NATIVE = window.Capacitor?.isNativePlatform?.() || false;
const API_URL = IS_NATIVE
  ? 'https://www.boostinghost.fr'
  : window.location.origin;

<<<<<<< HEAD
=======
// Stripe publishable key
const STRIPE_PK = 'pk_live_51Su7Z1FDAmyxvgFK3uralsUfB7fEX3UfOop2G4krZr6hgMNajjPYYCCJ14Ds7LSK19GT68xfJoftkjFhVBFe4d8100Vv1T8lSz'; // ← remplace par ta clé publishable Stripe live

// Init Stripe Capacitor v8
let StripePlugin = null;
async function initStripe() {
  if (!IS_NATIVE) return;
  
  // Attendre que le plugin soit disponible (max 5 secondes)
  const plugin = await new Promise(resolve => {
    let attempts = 0;
    const check = () => {
      const p = window.Capacitor?.Plugins?.Stripe;
      if (p) { resolve(p); return; }
      attempts++;
      if (attempts < 50) setTimeout(check, 100);
      else resolve(null);
    };
    check();
  });

  if (!plugin) {
    console.warn('⚠️ Stripe plugin non trouvé après 5s');
    return;
  }

  try {
    await plugin.initialize({ publishableKey: STRIPE_PK });
    StripePlugin = plugin;
    console.log('✅ Stripe initialisé');
  } catch(e) {
    console.warn('⚠️ Stripe init error:', e.message);
  }
}

>>>>>>> c7950af934bbf0f94875fbb2bfd5c205d805bc1a
// ── State global ─────────────────────────────────────────────
let state = {
  properties: [],
  currentProperty: null,
  search: { checkin: null, checkout: null, guests: null },
  calendar: { year: new Date().getFullYear(), month: new Date().getMonth() },
  selectedCheckin: null,
  selectedCheckout: null,
  selectingEnd: false,
  account: JSON.parse(localStorage.getItem('guest_account') || '{}')
};

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
<<<<<<< HEAD
=======
  initStripe(); // Lance en parallèle — polling interne jusqu'à 5s
  // Récupérer session existante
  state.session = getSession();
  updateNavAccount();

  // Vérifier si un magic_token est dans l'URL
  const urlParams = new URLSearchParams(window.location.search);
  const magicToken = urlParams.get('magic_token');
  if (magicToken) {
    await verifyMagicToken(magicToken);
  }

  // Charger les champs compte
  if (state.session) {
    state.account = { ...state.account, email: state.session.email, name: state.session.name || state.account.name };
    localStorage.setItem('guest_account', JSON.stringify(state.account));
  }
>>>>>>> c7950af934bbf0f94875fbb2bfd5c205d805bc1a
  loadAccountFields();

  // Détecter le retour depuis Stripe Checkout
  const urlParams2 = new URLSearchParams(window.location.search);
  const paymentStatus = urlParams2.get('payment');
  if (paymentStatus === 'success') {
    await handleStripeReturn(urlParams2);
  } else if (paymentStatus === 'cancel') {
    showToast('Paiement annulé');
    window.history.replaceState({}, '', window.location.pathname);
  }

  await loadProperties();
});

async function handleStripeReturn(params) {
  // Nettoyer l'URL
  window.history.replaceState({}, '', window.location.pathname);

  // Récupérer les infos de la réservation en attente
  const pending = JSON.parse(localStorage.getItem('guest_pending_booking') || 'null');
  if (!pending) { showToast('Paiement reçu !'); return; }

  localStorage.removeItem('guest_pending_booking');

  const btn_pay = document.createElement('div'); // dummy
  showToast('Confirmation de la réservation...');

  try {
    const res = await fetch(`${API_URL}/api/guest/confirm-after-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pending)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Mettre à jour le compte
    state.account = { name: pending.guest_name, email: pending.guest_email, phone: pending.guest_phone };
    localStorage.setItem('guest_account', JSON.stringify(state.account));
    updateNavAccount();

    showConfirmation(data, pending.guest_name, pending.guest_email);
  } catch (e) {
    showToast('Réservation confirmée mais erreur: ' + e.message);
  }
}

// ── Navigation ───────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen-content').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name)?.classList.add('active');

  // Header et nav selon l'écran
  const headerScreens = ['home'];
  const navScreens = ['home', 'bookings', 'account'];
  document.getElementById('appHeader').style.display = headerScreens.includes(name) ? 'block' : 'none';
  document.getElementById('bottomNav').style.display = navScreens.includes(name) ? 'flex' : 'none';

  // Scroll en haut
  document.getElementById('mainScroll').scrollTop = 0;

  if (name === 'bookings') loadMyBookings();
}

function navTo(name) {
  showScreen(name);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('nav-' + name)?.classList.add('active');
}

// ── Recherche ────────────────────────────────────────────────
function openSearch() {
  document.getElementById('searchModal').classList.add('open');
}

function closeSearchOnBg(e) {
  if (e.target === document.getElementById('searchModal')) {
    document.getElementById('searchModal').classList.remove('open');
  }
}

function updateSearchLabel() {
  const ci = document.getElementById('searchCheckin').value;
  const co = document.getElementById('searchCheckout').value;
  const g = document.getElementById('searchGuests').value;
  const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null;
  let label = '';
  if (ci && co) label = `${fmtDate(ci)} → ${fmtDate(co)}`;
  else if (ci) label = `Arrivée ${fmtDate(ci)}`;
  if (g) label += (label ? ' · ' : '') + g + ' voy.';
  document.getElementById('searchLabel').textContent = label || 'Dates, voyageurs...';
}

async function applySearch() {
  state.search.checkin = document.getElementById('searchCheckin').value || null;
  state.search.checkout = document.getElementById('searchCheckout').value || null;
  state.search.guests = document.getElementById('searchGuests').value || null;
  document.getElementById('searchModal').classList.remove('open');
  await loadProperties();
}

// ── Chargement logements ─────────────────────────────────────
async function loadProperties() {
  const grid = document.getElementById('propertiesGrid');
  grid.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    const params = new URLSearchParams();
    if (state.search.checkin) params.set('checkin', state.search.checkin);
    if (state.search.checkout) params.set('checkout', state.search.checkout);
    if (state.search.guests) params.set('guests', state.search.guests);

    const res = await fetch(`${API_URL}/api/guest/properties?${params}`);
    if (!res.ok) throw new Error('Erreur serveur');
    state.properties = await res.json();

    if (!state.properties.length) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-home"></i><p>Aucun logement disponible pour ces critères</p></div>`;
      return;
    }

    grid.innerHTML = state.properties.map(p => `
      <div class="prop-card" onclick="openProperty('${p.id}')">
        <div class="prop-photo">
          ${p.photoUrl
            ? `<img src="${p.photoUrl}" alt="${p.name}" loading="lazy">`
            : '<i class="fas fa-home"></i>'}
        </div>
        <div class="prop-info">
          <div class="prop-name">${p.name}</div>
          <div class="prop-location">
            <i class="fas fa-location-dot"></i>
            ${p.city || p.address || 'France'}
          </div>
          <div class="prop-features">
            ${p.bedrooms ? `<div class="prop-feat"><i class="fas fa-bed"></i> ${p.bedrooms} ch.</div>` : ''}
            ${p.maxGuests ? `<div class="prop-feat"><i class="fas fa-user"></i> ${p.maxGuests} pers.</div>` : ''}
            ${p.bathrooms ? `<div class="prop-feat"><i class="fas fa-bath"></i> ${p.bathrooms} sdb</div>` : ''}
          </div>
          <div class="prop-price-row">
            <div class="prop-price">${p.basePrice}€ <span>/ nuit</span></div>
            <button class="btn-voir">Voir</button>
          </div>
        </div>
      </div>
    `).join('');

  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-wifi"></i><p>Impossible de charger les logements</p></div>`;
  }
}

// ── Ouvrir un logement ───────────────────────────────────────
async function openProperty(id) {
  showScreen('detail');
  document.getElementById('detailBody').innerHTML = '<div class="loading-center" style="padding:60px"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    const res = await fetch(`${API_URL}/api/guest/properties/${id}`);
    if (!res.ok) throw new Error('Logement introuvable');
    state.currentProperty = await res.json();

    // Reset sélection dates
    state.selectedCheckin = state.search.checkin || null;
    state.selectedCheckout = state.search.checkout || null;
    state.selectingEnd = !!state.selectedCheckin;

    document.getElementById('detailHeaderName').textContent = state.currentProperty.name;
    renderDetail();
    updateBookingBar();

  } catch (e) {
    document.getElementById('detailBody').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>${e.message}</p></div>`;
  }
}

function renderDetail() {
  const p = state.currentProperty;
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-photos">
      ${p.photoUrl
        ? `<img src="${p.photoUrl}" alt="${p.name}">`
        : '<div class="no-photo"><i class="fas fa-home"></i></div>'}
    </div>
    <div class="detail-body">
      <div class="detail-name">${p.name}</div>
      <div class="detail-location"><i class="fas fa-location-dot"></i> ${p.city || p.address || 'France'}</div>
      <div class="detail-feats">
        ${p.bedrooms ? `<div class="detail-feat"><i class="fas fa-bed"></i><strong>${p.bedrooms}</strong><span>chambres</span></div>` : ''}
        ${p.maxGuests ? `<div class="detail-feat"><i class="fas fa-users"></i><strong>${p.maxGuests}</strong><span>personnes</span></div>` : ''}
        ${p.bathrooms ? `<div class="detail-feat"><i class="fas fa-bath"></i><strong>${p.bathrooms}</strong><span>sdb</span></div>` : ''}
        ${p.beds ? `<div class="detail-feat"><i class="fas fa-moon"></i><strong>${p.beds}</strong><span>lits</span></div>` : ''}
      </div>

      <div class="section-title">Sélectionner vos dates</div>
      <div id="calendarContainer"></div>

      ${p.arrivalTime || p.departureTime ? `
      <div class="section-title">Horaires</div>
      <div style="display:flex; gap:20px; background:var(--bg); border-radius:14px; padding:14px 16px; margin-bottom:16px;">
        ${p.arrivalTime ? `<div><div style="font-size:12px;color:var(--text-light);">Arrivée</div><div style="font-size:15px;font-weight:700;">${p.arrivalTime}</div></div>` : ''}
        ${p.departureTime ? `<div><div style="font-size:12px;color:var(--text-light);">Départ</div><div style="font-size:15px;font-weight:700;">${p.departureTime}</div></div>` : ''}
      </div>` : ''}

      <div style="height:90px;"></div>
    </div>
  `;
  renderCalendar();
}

// ── Calendrier ───────────────────────────────────────────────
function renderCalendar() {
  const p = state.currentProperty;
  const { year, month } = state.calendar;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Construire un Set des dates bloquées
  const bookedSet = new Set();
  (p.bookedDates || []).forEach(({ start, end }) => {
    const s = new Date(start), e = new Date(end);
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
      bookedSet.add(d.toISOString().split('T')[0]);
    }
  });

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7; // lundi = 0
  const monthName = firstDay.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  let html = `
    <div style="background:white; border-radius:16px; padding:16px; margin-bottom:16px;">
      <div class="calendar-nav">
        <button onclick="calNav(-1)"><i class="fas fa-chevron-left"></i></button>
        <h4>${monthName}</h4>
        <button onclick="calNav(1)"><i class="fas fa-chevron-right"></i></button>
      </div>
      <div class="calendar-grid">
        ${['Lu','Ma','Me','Je','Ve','Sa','Di'].map(d => `<div class="cal-day-header">${d}</div>`).join('')}
        ${Array(startOffset).fill('<div class="cal-day empty"></div>').join('')}
  `;

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateStr = date.toISOString().split('T')[0];
    const isPast = date < today;
    const isBooked = bookedSet.has(dateStr);
    const isToday = date.toDateString() === today.toDateString();
    const isStart = dateStr === state.selectedCheckin;
    const isEnd = dateStr === state.selectedCheckout;
    const isInRange = state.selectedCheckin && state.selectedCheckout
      && dateStr > state.selectedCheckin && dateStr < state.selectedCheckout;

    let cls = 'cal-day';
    if (isPast) cls += ' past';
    else if (isBooked) cls += ' booked';
    else if (isStart || isEnd) cls += isStart ? ' selected-start' : ' selected-end';
    else if (isInRange) cls += ' in-range';
    if (isToday) cls += ' today';

    const clickable = !isPast && !isBooked;
    html += `<div class="${cls}" ${clickable ? `onclick="selectDate('${dateStr}')"` : ''}>${day}</div>`;
  }

  html += `</div></div>`;
  document.getElementById('calendarContainer').innerHTML = html;
}

function calNav(dir) {
  state.calendar.month += dir;
  if (state.calendar.month < 0) { state.calendar.month = 11; state.calendar.year--; }
  if (state.calendar.month > 11) { state.calendar.month = 0; state.calendar.year++; }
  renderCalendar();
}

function selectDate(dateStr) {
  if (!state.selectedCheckin || state.selectingEnd === false) {
    // Premier clic → arrivée
    state.selectedCheckin = dateStr;
    state.selectedCheckout = null;
    state.selectingEnd = true;
  } else {
    // Deuxième clic → départ
    if (dateStr <= state.selectedCheckin) {
      state.selectedCheckin = dateStr;
      state.selectedCheckout = null;
    } else {
      state.selectedCheckout = dateStr;
      state.selectingEnd = false;
    }
  }
  renderCalendar();
  updateBookingBar();
}

function updateBookingBar() {
  const p = state.currentProperty;
  if (!p) return;
  const bar = document.getElementById('barPrice');
  const datesLabel = document.getElementById('barDates');
  const btn = document.getElementById('btnBook');

  if (state.selectedCheckin && state.selectedCheckout) {
    const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
    let total = 0;
    for (let i = 0; i < nights; i++) {
      const d = new Date(state.selectedCheckin);
      d.setDate(d.getDate() + i);
      const dow = d.getDay();
      total += (dow === 5 || dow === 6) && p.weekendPrice ? p.weekendPrice : (p.basePrice || 0);
    }
    const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    bar.innerHTML = `${total}€ <span>· ${nights} nuit${nights > 1 ? 's' : ''}</span>`;
    datesLabel.textContent = `${fmtDate(state.selectedCheckin)} → ${fmtDate(state.selectedCheckout)}`;
    btn.disabled = false;
  } else {
    bar.innerHTML = `${p.basePrice}€ <span>/ nuit</span>`;
    datesLabel.textContent = state.selectedCheckin ? 'Sélectionnez la date de départ' : 'Sélectionnez vos dates';
    btn.disabled = !state.selectedCheckin || !state.selectedCheckout;
  }
}

// ── Checkout ─────────────────────────────────────────────────
function goToCheckout() {
  if (!state.selectedCheckin || !state.selectedCheckout) return;
  const p = state.currentProperty;
  const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const d = new Date(state.selectedCheckin);
    d.setDate(d.getDate() + i);
    const dow = d.getDay();
    total += (dow === 5 || dow === 6) && p.weekendPrice ? p.weekendPrice : (p.basePrice || 0);
  }
  const commission = Math.round(total * 0.03 * 100) / 100;
  const ttc = Math.round((total + commission) * 100) / 100;
  const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  document.getElementById('checkoutBody').innerHTML = `
    <div class="checkout-summary">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;">${p.name}</div>
      <div class="checkout-row"><span>Dates</span><span>${fmtDate(state.selectedCheckin)} → ${fmtDate(state.selectedCheckout)}</span></div>
      <div class="checkout-row"><span>${p.basePrice}€ × ${nights} nuit${nights > 1 ? 's' : ''}</span><span>${total}€</span></div>
      <div class="checkout-row"><span>Frais de service (3%)</span><span>${commission}€</span></div>
      <div class="checkout-row total"><span>Total</span><span>${ttc}€</span></div>
    </div>
    <div class="form-section">
      <label>Prénom et nom *</label>
      <input type="text" id="guestName" placeholder="Votre nom complet" value="${state.account.name || ''}">
    </div>
    <div class="form-section">
      <label>Email *</label>
      <input type="email" id="guestEmail" placeholder="votre@email.com" value="${state.account.email || ''}">
    </div>
    <div class="form-section">
      <label>Téléphone</label>
      <input type="tel" id="guestPhone" placeholder="+33 6 00 00 00 00" value="${state.account.phone || ''}">
    </div>
    <div class="form-section">
      <label>Nombre de voyageurs</label>
      <input type="number" id="guestCount" min="1" max="${p.maxGuests || 10}" value="2">
    </div>
    <div style="background:var(--bg);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--text-light);margin-top:8px;">
      <i class="fas fa-lock" style="color:var(--primary);margin-right:6px;"></i>
      Paiement sécurisé. Votre réservation sera confirmée immédiatement.
    </div>
  `;

  document.getElementById('btnPay').textContent = `Payer ${ttc}€`;
  showScreen('checkout');
}

async function submitBooking() {
  const guestName = document.getElementById('guestName')?.value.trim();
  const guestEmail = document.getElementById('guestEmail')?.value.trim();
  const guestPhone = document.getElementById('guestPhone')?.value.trim();
  const guestCount = document.getElementById('guestCount')?.value;

  if (!guestName || !guestEmail) {
    showToast('Veuillez remplir votre nom et email');
    return;
  }

  const btn = document.getElementById('btnPay');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Traitement...';

  try {
<<<<<<< HEAD
    const res = await fetch(`${API_URL}/api/guest/book`, {
=======
    // Créer la session Stripe Checkout
    const res = await fetch(`${API_URL}/api/guest/create-checkout-session`, {
>>>>>>> c7950af934bbf0f94875fbb2bfd5c205d805bc1a
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: state.currentProperty.id,
        checkin: state.selectedCheckin,
        checkout: state.selectedCheckout,
        guests: guestCount || 2,
        guest_name: guestName,
        guest_email: guestEmail,
<<<<<<< HEAD
        guest_phone: guestPhone
=======
        guest_phone: guestPhone,
        promo_code: promoCode
>>>>>>> c7950af934bbf0f94875fbb2bfd5c205d805bc1a
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

<<<<<<< HEAD
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur lors de la réservation');

    // Sauvegarder le compte
    state.account = { name: guestName, email: guestEmail, phone: guestPhone };
    localStorage.setItem('guest_account', JSON.stringify(state.account));
    loadAccountFields();

    // Afficher confirmation
    showConfirmation(data, guestName, guestEmail);
=======
    // Sauvegarder les infos en attendant le retour de Stripe
    localStorage.setItem('guest_pending_booking', JSON.stringify({
      property_id: state.currentProperty.id,
      checkin: state.selectedCheckin,
      checkout: state.selectedCheckout,
      guests: guestCount || 2,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      promo_code: promoCode,
      session_id: data.sessionId
    }));
    localStorage.setItem('guest_session_email', guestEmail);
    localStorage.setItem('guest_session_name', guestName);

    // Ouvrir Stripe Checkout
    window.location.href = data.checkoutUrl;
>>>>>>> c7950af934bbf0f94875fbb2bfd5c205d805bc1a

  } catch (e) {
    showToast(e.message);
    btn.disabled = false;
    btn.textContent = 'Payer';
  }
}

function showConfirmation(data, guestName, guestEmail) {
  const p = state.currentProperty;
  const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  document.getElementById('confirmBody').innerHTML = `
    <div class="confirm-icon"><i class="fas fa-check"></i></div>
    <div class="confirm-title">Réservation confirmée !</div>
    <div class="confirm-sub">Un email de confirmation a été envoyé à ${guestEmail}</div>
    <div class="confirm-card">
      <div class="confirm-row"><span>Logement</span><span>${p.name}</span></div>
      <div class="confirm-row"><span>Arrivée</span><span>${fmtDate(state.selectedCheckin)}</span></div>
      <div class="confirm-row"><span>Départ</span><span>${fmtDate(state.selectedCheckout)}</span></div>
      <div class="confirm-row"><span>Voyageur</span><span>${guestName}</span></div>
      <div class="confirm-row"><span>Total payé</span><span>${data.total_ttc}€</span></div>
      ${p.arrivalTime ? `<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px;font-size:13px;color:var(--text-light);">
        <i class="fas fa-clock"></i> Arrivée à partir de ${p.arrivalTime}
      </div>` : ''}
    </div>
    <button class="btn-confirm-home" onclick="navTo('home')">Voir d'autres logements</button>
    <div style="height:12px;"></div>
    <button onclick="navTo('bookings')" style="width:100%;padding:14px;background:var(--bg);border:none;border-radius:14px;font-size:15px;font-weight:600;color:var(--text);cursor:pointer;margin-top:8px;">
      Mes réservations
    </button>
  `;
  showScreen('confirm');
}

// ── Mes réservations ─────────────────────────────────────────
async function loadMyBookings() {
  const list = document.getElementById('myBookingsList');
  const email = state.account.email;

  if (!email) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-user"></i><p>Renseignez votre email dans "Compte" pour voir vos réservations</p></div>`;
    return;
  }

  list.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    const res = await fetch(`${API_URL}/api/guest/my-bookings?email=${encodeURIComponent(email)}`);
    const bookings = await res.json();

    if (!bookings.length) {
      list.innerHTML = `<div class="empty-state"><i class="fas fa-calendar"></i><p>Aucune réservation pour le moment</p></div>`;
      return;
    }

    const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

    list.innerHTML = bookings.map(b => `
      <div class="booking-card">
        <div class="booking-card-header">
          <div class="booking-card-name">${b.property.name}</div>
          <span class="booking-badge ${b.status === 'confirmed' ? 'badge-confirmed' : 'badge-cancelled'}">
            ${b.status === 'confirmed' ? 'Confirmé' : 'Annulé'}
          </span>
        </div>
        <div class="booking-dates">
          <i class="fas fa-calendar" style="color:var(--primary);margin-right:4px;"></i>
          ${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}
        </div>
        ${b.property.city ? `<div style="font-size:12px;color:var(--text-light);margin-bottom:6px;"><i class="fas fa-location-dot"></i> ${b.property.city}</div>` : ''}
        <div class="booking-total">${parseFloat(b.total).toFixed(0)}€</div>
      </div>
    `).join('');

  } catch (e) {
    list.innerHTML = `<div class="empty-state"><i class="fas fa-wifi"></i><p>Erreur de chargement</p></div>`;
  }
}

// ── Compte ───────────────────────────────────────────────────
function loadAccountFields() {
  const a = state.account;
  const name = document.getElementById('accountName');
  const email = document.getElementById('accountEmail');
  const phone = document.getElementById('accountPhone');
  if (name) name.value = a.name || '';
  if (email) email.value = a.email || '';
  if (phone) phone.value = a.phone || '';
}

function saveAccount() {
  state.account = {
    name: document.getElementById('accountName')?.value.trim(),
    email: document.getElementById('accountEmail')?.value.trim(),
    phone: document.getElementById('accountPhone')?.value.trim()
  };
  localStorage.setItem('guest_account', JSON.stringify(state.account));
  showToast('Compte sauvegardé ✓');
}

// ── Toast ────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

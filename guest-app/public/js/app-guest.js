// ============================================================
// BOOSTINGHOST GUEST — app-guest.js
// ============================================================

const IS_NATIVE = window.Capacitor?.isNativePlatform?.() || false;
const API_URL = IS_NATIVE
  ? 'https://www.boostinghost.fr'
  : window.location.origin;

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

// ── State global ─────────────────────────────────────────────
let state = {
  properties: [],
  currentProperty: null,
  search: { checkin: null, checkout: null, guests: null },
  calendar: { year: new Date().getFullYear(), month: new Date().getMonth() },
  selectedCheckin: null,
  selectedCheckout: null,
  selectingEnd: false,
  account: JSON.parse(localStorage.getItem('guest_account') || '{}'),
  session: null, // { email, token, name }
  appliedPromo: null // { code, discount_type, discount_value, discount_amount }
};

// ── Auth helpers ─────────────────────────────────────────────
function getSession() {
  const raw = localStorage.getItem('guest_session');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveSession(session) {
  state.session = session;
  localStorage.setItem('guest_session', JSON.stringify(session));
  // Mettre à jour aussi le compte
  if (session.name || session.email) {
    state.account = { ...state.account, email: session.email, name: session.name || state.account.name };
    localStorage.setItem('guest_account', JSON.stringify(state.account));
  }
}

function clearSession() {
  state.session = null;
  localStorage.removeItem('guest_session');
}

function isLoggedIn() {
  return !!getSession()?.token;
}

function updateNavAccount() {
  const label = document.getElementById('navAccountLabel');
  if (!label) return;
  const session = getSession();
  label.textContent = session ? (session.name?.split(' ')[0] || 'Moi') : 'Compte';
}

async function requestMagicLink() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  if (!email || !email.includes('@')) { showToast('Email invalide'); return; }
  const btn = document.getElementById('btnMagicLink');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi...';
  try {
    const res = await fetch(`${API_URL}/api/guest/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('loginSent').style.display = 'block';
  } catch (e) {
    showToast(e.message || 'Erreur envoi email');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Recevoir mon lien';
  }
}

async function verifyMagicToken(token) {
  try {
    const res = await fetch(`${API_URL}/api/guest/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveSession({ token: data.session_token, email: data.email, name: data.name });
    updateNavAccount();
    showToast('Connexion réussie !');
    // Nettoyer l'URL et recharger pour appliquer la session
    setTimeout(() => {
      window.location.replace(window.location.pathname);
    }, 1000);
    return true;
  } catch (e) {
    showToast(e.message || 'Lien invalide ou expiré');
    return false;
  }
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
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
  const navScreens = ['home', 'bookings', 'account', 'login'];
  document.getElementById('appHeader').style.display = headerScreens.includes(name) ? 'block' : 'none';
  document.getElementById('bottomNav').style.display = navScreens.includes(name) ? 'flex' : 'none';

  // Booking bar uniquement sur l'écran détail
  const bookingBar = document.getElementById('bookingBar');
  if (bookingBar) bookingBar.style.display = name === 'detail' ? 'flex' : 'none';

  // Scroll en haut
  document.getElementById('mainScroll').scrollTop = 0;

  if (name === 'bookings') loadMyBookings();
  if (name === 'account') { loadAccountFields(); renderLogoutSection(); }
}

function navTo(name) {
  showScreen(name);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  // Login → active l'onglet Compte visuellement
  const navId = name === 'login' ? 'account' : name;
  document.getElementById('nav-' + navId)?.classList.add('active');
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
  const city = document.getElementById('searchCity')?.value?.trim();
  const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null;
  let parts = [];
  if (city) parts.push(city);
  if (ci && co) parts.push(`${fmtDate(ci)} → ${fmtDate(co)}`);
  else if (ci) parts.push(`Arrivée ${fmtDate(ci)}`);
  if (state.search.guests) parts.push(state.search.guests + ' voy.');
  document.getElementById('searchLabel').textContent = parts.join(' · ') || 'Dates, voyageurs...';
}

function selectGuests(btn, val) {
  document.querySelectorAll('.guest-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.search.guests = val || null;
  updateSearchLabel();
}

async function applySearch() {
  state.search.checkin = document.getElementById('searchCheckin').value || null;
  state.search.checkout = document.getElementById('searchCheckout').value || null;
  state.search.city = document.getElementById('searchCity')?.value?.trim() || null;
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

    // Filtrer par ville côté client
    if (state.search.city) {
      const city = state.search.city.toLowerCase();
      state.properties = state.properties.filter(p =>
        (p.city && p.city.toLowerCase().includes(city)) ||
        (p.address && p.address.toLowerCase().includes(city)) ||
        (p.name && p.name.toLowerCase().includes(city))
      );
    }

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
  const cleaningFee = p.cleaningFee || 0;
  const guestCount = parseInt(document.getElementById('guestCount')?.value) || 2;
  const touristTax = p.touristTaxPerNight
    ? Math.round(p.touristTaxPerNight * nights * guestCount * 100) / 100
    : 0;
  const ttc = Math.round((total + cleaningFee + touristTax + commission) * 100) / 100;
  const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  // Reset promo state
  state.appliedPromo = null;

  document.getElementById('checkoutBody').innerHTML = `
    <div class="checkout-summary" id="priceSummary">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;">${p.name}</div>
      <div class="checkout-row"><span>Dates</span><span>${fmtDate(state.selectedCheckin)} → ${fmtDate(state.selectedCheckout)}</span></div>
      <div class="checkout-row" id="baseRow"><span>${p.basePrice}€ × ${nights} nuit${nights > 1 ? 's' : ''}</span><span>${total}€</span></div>
      <div class="checkout-row" id="promoRow" style="display:none;color:#10b981;"><span>Code promo</span><span id="promoAmount">-0€</span></div>
      ${cleaningFee > 0 ? `<div class="checkout-row" id="cleaningRow"><span>Frais de ménage</span><span>${cleaningFee}€</span></div>` : ''}
      ${touristTax > 0 ? `<div class="checkout-row" id="touristTaxRow"><span>Taxe de séjour</span><span id="touristTaxAmount">${touristTax}€</span></div>` : ''}
      <div class="checkout-row" id="commissionRow"><span>Frais de service (3%)</span><span id="commissionAmount">${commission}€</span></div>
      <div class="checkout-row total"><span>Total</span><span id="totalAmount">${ttc}€</span></div>
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
      <input type="number" id="guestCount" min="1" max="${p.maxGuests || 10}" value="2" onchange="onGuestCountChange()">
    </div>
    <div class="form-section">
      <label>Code promo <span style="font-size:12px;color:var(--text-light);font-weight:400;">(optionnel)</span></label>
      <div style="display:flex;gap:8px;">
        <input type="text" id="promoInput" placeholder="Ex: BEEN10" style="text-transform:uppercase;flex:1;">
        <button onclick="applyPromo()" id="btnApplyPromo" style="padding:13px 16px;background:var(--primary-light);color:var(--primary);border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;">
          Appliquer
        </button>
      </div>
      <div id="promoMsg" style="font-size:12px;margin-top:6px;display:none;"></div>
    </div>
    <div style="background:var(--bg);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--text-light);margin-top:8px;">
      <i class="fas fa-lock" style="color:var(--primary);margin-right:6px;"></i>
      Paiement sécurisé. Votre réservation sera confirmée immédiatement.
    </div>
  `;

  document.getElementById('btnPay').textContent = `Payer ${ttc}€`;
  showScreen('checkout');
}

// Recalcule la taxe de séjour quand le nb de voyageurs change
function onGuestCountChange() {
  const p = state.currentProperty;
  if (!p || !p.touristTaxPerNight) return;
  const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
  const guestCount = parseInt(document.getElementById('guestCount')?.value) || 1;
  const touristTax = Math.round(p.touristTaxPerNight * nights * guestCount * 100) / 100;

  const el = document.getElementById('touristTaxAmount');
  if (el) el.textContent = `${touristTax}€`;

  // Recalcule le total
  _recalcTotal();
}

function _recalcTotal() {
  const p = state.currentProperty;
  if (!p) return;
  const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
  let totalBase = 0;
  for (let i = 0; i < nights; i++) {
    const d = new Date(state.selectedCheckin);
    d.setDate(d.getDate() + i);
    const dow = d.getDay();
    totalBase += (dow === 5 || dow === 6) && p.weekendPrice ? p.weekendPrice : (p.basePrice || 0);
  }
  const discount = state.appliedPromo?.discount_amount || 0;
  const discounted = Math.max(0, totalBase - discount);
  const cleaningFee = p.cleaningFee || 0;
  const guestCount = parseInt(document.getElementById('guestCount')?.value) || 1;
  const touristTax = p.touristTaxPerNight
    ? Math.round(p.touristTaxPerNight * nights * guestCount * 100) / 100
    : 0;
  const commission = Math.round(discounted * 0.03 * 100) / 100;
  const ttc = Math.round((discounted + cleaningFee + touristTax + commission) * 100) / 100;

  const elComm = document.getElementById('commissionAmount');
  const elTotal = document.getElementById('totalAmount');
  const elTax = document.getElementById('touristTaxAmount');
  if (elComm) elComm.textContent = `${commission}€`;
  if (elTotal) elTotal.textContent = `${ttc}€`;
  if (elTax) elTax.textContent = `${touristTax}€`;
  document.getElementById('btnPay').textContent = `Payer ${ttc}€`;
}

async function applyPromo() {
  const code = document.getElementById('promoInput')?.value?.trim();
  if (!code) return;
  const btn = document.getElementById('btnApplyPromo');
  const msg = document.getElementById('promoMsg');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const p = state.currentProperty;
    const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
    let total = 0;
    for (let i = 0; i < nights; i++) {
      const d = new Date(state.selectedCheckin); d.setDate(d.getDate() + i);
      const dow = d.getDay();
      total += (dow === 5 || dow === 6) && p.weekendPrice ? p.weekendPrice : (p.basePrice || 0);
    }

    const res = await fetch(`${API_URL}/api/guest/promo/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, amount: total })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Appliquer la réduction
    state.appliedPromo = data;
    const discount = data.discount_amount;
    const discounted = Math.max(0, total - discount);
    const cleaningFee = p.cleaningFee || 0;
    const guestCount = parseInt(document.getElementById('guestCount')?.value) || 1;
    const touristTax = p.touristTaxPerNight
      ? Math.round(p.touristTaxPerNight * nights * guestCount * 100) / 100
      : 0;
    const commission = Math.round(discounted * 0.03 * 100) / 100;
    const ttc = Math.round((discounted + cleaningFee + touristTax + commission) * 100) / 100;

    document.getElementById('promoRow').style.display = 'flex';
    document.getElementById('promoAmount').textContent = `-${discount}€`;
    document.getElementById('commissionAmount').textContent = `${commission}€`;
    document.getElementById('totalAmount').textContent = `${ttc}€`;
    document.getElementById('btnPay').textContent = `Payer ${ttc}€`;

    msg.style.display = 'block';
    msg.style.color = '#10b981';
    msg.textContent = `✓ ${data.description} appliqué`;

  } catch (e) {
    msg.style.display = 'block';
    msg.style.color = 'var(--error)';
    msg.textContent = e.message;
    state.appliedPromo = null;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Appliquer';
  }
}

async function submitBooking() {
  const guestName = document.getElementById('guestName')?.value.trim();
  const guestEmail = document.getElementById('guestEmail')?.value.trim();
  const guestPhone = document.getElementById('guestPhone')?.value.trim();
  const guestCount = document.getElementById('guestCount')?.value;
  const promoCode = state.appliedPromo?.code || document.getElementById('promoInput')?.value?.trim() || null;

  if (!guestName || !guestEmail) {
    showToast('Veuillez remplir votre nom et email');
    return;
  }

  const btn = document.getElementById('btnPay');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Préparation...';

  try {
    // Créer la session Stripe Checkout
    const res = await fetch(`${API_URL}/api/guest/create-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        property_id: state.currentProperty.id,
        checkin: state.selectedCheckin,
        checkout: state.selectedCheckout,
        guests: guestCount || 2,
        guest_name: guestName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
        promo_code: promoCode
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

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
  const session = getSession();

  // Accepter soit un JWT complet, soit un email local (après réservation sans connexion)
  const localEmail = localStorage.getItem('guest_session_email') || state.account?.email;
  
  if (!session?.token && !localEmail) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-calendar"></i>
        <p style="margin-bottom:20px;">Connectez-vous pour voir vos réservations</p>
        <button onclick="navTo('login')" style="background:var(--primary);color:white;border:none;border-radius:10px;padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer;">
          Se connecter
        </button>
      </div>`;
    return;
  }

  list.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    let bookings = [];
    if (session?.token) {
      // Connecté avec JWT → /api/guest/me
      const res = await fetch(`${API_URL}/api/guest/me`, {
        headers: { 'Authorization': `Bearer ${session.token}` }
      });
      const data = await res.json();
      if (!res.ok) { clearSession(); }
      else bookings = data.bookings || [];
    } else if (localEmail) {
      // Email local → /api/guest/my-bookings
      const res = await fetch(`${API_URL}/api/guest/my-bookings?email=${encodeURIComponent(localEmail)}`);
      if (res.ok) bookings = await res.json();
    }

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

function renderLogoutSection() {
  const section = document.getElementById('logoutSection');
  if (!section) return;
  const session = getSession();
  if (session) {
    section.innerHTML = `
      <div style="background:white;border-radius:14px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
        <div style="font-size:13px;color:var(--text-light);">Connecté en tant que<br><strong style="color:var(--text);">${session.email}</strong></div>
        <button onclick="logout()" style="background:none;border:1px solid var(--error);color:var(--error);border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600;">
          Déconnexion
        </button>
      </div>`;
  } else {
    section.innerHTML = `
      <button onclick="navTo('login')" style="width:100%;padding:14px;background:var(--primary-light);color:var(--primary);border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;">
        <i class="fas fa-sign-in-alt"></i> Se connecter
      </button>`;
  }
}

function logout() {
  clearSession();
  state.account = {};
  localStorage.removeItem('guest_account');
  loadAccountFields();
  updateNavAccount();
  renderLogoutSection();
  showToast('Déconnecté');
  navTo('home');
}

// ── Toast ────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

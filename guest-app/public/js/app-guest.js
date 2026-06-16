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
  selectingEnd: null,
  account: JSON.parse(localStorage.getItem('guest_account') || '{}'),
  session: null, // { email, token, name }
  appliedPromo: null, // { code, discount_type, discount_value, discount_amount }
  _lockedPropertyId: null, // logement verrouillé par un lien personnalisé (prix négocié / hold)
  _pendingFixedPrice: null,
  _fixedPriceActive: null,
  _holdToken: null
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
  const label = document.getElementById('navAccountLabel'); if (!label) return;
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

// Magic link supprimé — auth par mot de passe uniquement

function switchSubMode(mode) {
  const loginForm = document.getElementById('pwdLoginForm');
  const registerForm = document.getElementById('pwdRegisterForm');
  const btnLogin = document.getElementById('subToggleLogin');
  const btnRegister = document.getElementById('subToggleRegister');
  if (mode === 'login') {
    loginForm.style.display = ''; registerForm.style.display = 'none';
    btnLogin.classList.add('active'); btnRegister.classList.remove('active');
  } else {
    loginForm.style.display = 'none'; registerForm.style.display = '';
    btnRegister.classList.add('active'); btnLogin.classList.remove('active');
  }
}

// ── Connexion mot de passe ────────────────────────────────────
async function loginWithPassword() {
  const email = document.getElementById('pwdEmail')?.value?.trim();
  const password = document.getElementById('pwdPassword')?.value;
  const errBox = document.getElementById('pwdLoginError');
  errBox.style.display = 'none';
  if (!email || !password) { errBox.textContent = 'Email et mot de passe requis'; errBox.style.display = 'block'; return; }
  const btn = document.getElementById('btnPwdLogin');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion...';
  try {
    const res = await fetch(`${API_URL}/api/guest/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveSession({ token: data.session_token, email: data.email, name: data.name });
    updateNavAccount();
    showToast('Connexion réussie !');
    setTimeout(() => { window.location.replace(window.location.pathname); }, 800);
  } catch(e) {
    errBox.textContent = e.message || 'Erreur de connexion';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Se connecter';
  }
}

// ── Inscription mot de passe ─────────────────────────────────
function showVerificationPending(email) {
  // Masquer le form auth, afficher un message de vérification
  const authForm = document.querySelector('#screen-login .auth-card') || document.querySelector('#screen-login');
  if (authForm) {
    authForm.innerHTML = `
      <div style="text-align:center;padding:24px 0;">
        <div style="font-size:48px;margin-bottom:16px;">✉️</div>
        <h2 style="font-size:20px;font-weight:700;color:#1F1346;margin:0 0 8px;">Vérifiez votre email</h2>
        <p style="color:#6B7280;font-size:14px;margin:0 0 20px;">Un lien de confirmation a été envoyé à <strong>${email}</strong>. Cliquez dessus pour activer votre compte.</p>
        <p style="color:#9CA3AF;font-size:13px;margin:0 0 20px;">Vérifiez vos spams si vous ne voyez pas l'email.</p>
        <button onclick="resendVerification('${email}')" style="background:none;border:1.5px solid #7c3aed;color:#7c3aed;border-radius:10px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">
          Renvoyer l'email
        </button>
      </div>
    `;
  }
}

async function resendVerification(email) {
  try {
    const res = await fetch(`${API_URL}/api/guest/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) showToast('Email renvoyé !');
    else showToast(data.error || 'Erreur');
  } catch(e) {
    showToast('Erreur réseau');
  }
}

async function registerWithPassword() {
  const name = document.getElementById('regName')?.value?.trim();
  const email = document.getElementById('regEmail')?.value?.trim();
  const password = document.getElementById('regPassword')?.value;
  const confirm = document.getElementById('regPasswordConfirm')?.value;
  const phone = document.getElementById('regPhone')?.value?.trim();
  const errBox = document.getElementById('pwdRegisterError');
  errBox.style.display = 'none';
  if (!email || !password) { errBox.textContent = 'Email et mot de passe requis'; errBox.style.display = 'block'; return; }
  if (!phone) { errBox.textContent = 'Numéro de téléphone requis'; errBox.style.display = 'block'; return; }
  if (password.length < 8) { errBox.textContent = 'Mot de passe trop court (8 caractères minimum)'; errBox.style.display = 'block'; return; }
  if (!/[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?`~]/.test(password)) { errBox.textContent = 'Le mot de passe doit contenir au moins 1 caractère spécial (!@#$%...)'; errBox.style.display = 'block'; return; }
  if (password !== confirm) { errBox.textContent = 'Les mots de passe ne correspondent pas'; errBox.style.display = 'block'; return; }
  const btn = document.getElementById('btnPwdRegister');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Création...';
  try {
    const res = await fetch(`${API_URL}/api/guest/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, phone })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (data.needs_verification) {
      showVerificationPending(email);
    } else {
      saveSession({ token: data.session_token, email: data.email, name: data.name || name });
      updateNavAccount();
      showToast('Compte créé avec succès !');
      setTimeout(() => { window.location.replace(window.location.pathname); }, 800);
    }
  } catch(e) {
    errBox.textContent = e.message || 'Erreur lors de la création du compte';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Créer mon compte';
  }
}

// ── Mot de passe oublié ──────────────────────────────────────
async function forgotPassword() {
  const email = document.getElementById('pwdEmail')?.value?.trim();
  if (!email || !email.includes('@')) { showToast('Entrez votre email d\'abord'); return; }
  try {
    await fetch(`${API_URL}/api/guest/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    showToast('Un lien de réinitialisation vous a été envoyé');
  } catch(e) { showToast('Erreur d\'envoi'); }
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
  // Initialiser le badge messages à 0 dès le démarrage
  updateGuestMsgBadge(0);
  // Récupérer session existante
  state.session = getSession();
  updateNavAccount();

  // Vérification email via lien (verify_token dans URL)
  const urlParamsInit = new URLSearchParams(window.location.search);
  const verifyToken = urlParamsInit.get('verify_token');
  if (verifyToken) {
    try {
      const res = await fetch(`${API_URL}/api/guest/auth/verify?token=${verifyToken}`);
      const data = await res.json();
      if (res.ok && data.success) {
        saveSession({ token: data.session_token, email: data.email, name: data.name });
        state.session = getSession();
        updateNavAccount();
        showToast('✅ Email vérifié ! Bienvenue sur Boostinghost Guest.');
        window.history.replaceState({}, '', window.location.pathname);
      } else {
        showToast(data.error || 'Lien de vérification invalide ou expiré.');
      }
    } catch(e) {
      showToast('Erreur lors de la vérification.');
    }
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
  loadFeaturedProperties();

  // ── Deep link : ?property=ID&checkin=DATE&checkout=DATE&promo=CODE&guests=N&fixed_price=N ──
  await handleDeepLink();

  // Cas ou l'app est deja ouverte en background et recoit un nouveau lien
  if (IS_NATIVE) {
    try {
      const { App } = window.Capacitor.Plugins;
      App.addListener('appUrlOpen', async (data) => {
        if (data && data.url) {
          state._pendingFixedPrice = null;
          state._lockedPropertyId = null;
          state.search = { checkin: null, checkout: null, guests: null };
          await handleDeepLink(data.url);
        }
      });
    } catch(e) { /* non bloquant */ }
  }
});

async function handleDeepLink(overrideUrl) {
  // Sur Capacitor natif, window.location.search est vide -- on lit l'URL via getLaunchUrl()
  let search = window.location.search;
  if (IS_NATIVE && !search && !overrideUrl) {
    try {
      const { App } = window.Capacitor.Plugins;
      const launched = await App.getLaunchUrl();
      if (launched && launched.url) {
        const idx = launched.url.indexOf('?');
        if (idx !== -1) search = launched.url.substring(idx);
      }
    } catch(e) { /* non bloquant */ }
  }
  if (overrideUrl) {
    const idx = overrideUrl.indexOf('?');
    search = idx !== -1 ? overrideUrl.substring(idx) : '';
  }

  const params    = new URLSearchParams(search);
  const propertyId = params.get('property');
  const checkin    = params.get('checkin');
  const checkout   = params.get('checkout');
  const promoCode  = params.get('promo');
  const guests     = params.get('guests');
  const fixedPrice = parseFloat(params.get('fixed_price')) || null;
  const holdToken = params.get('hold_token') || null;

  if (!propertyId) return;

  if (checkin)     state.search.checkin  = checkin;
  if (checkout)    state.search.checkout = checkout;
  if (guests)      state.search.guests   = parseInt(guests) || 2;
  if (fixedPrice)  state._pendingFixedPrice = fixedPrice;
  if (holdToken)   state._holdToken = holdToken;
  if (holdToken)   localStorage.setItem('guest_hold_token', holdToken);

  // 🔒 Lien personnalisé (prix négocié ou hold) → verrouiller sur CE logement.
  // Le client ne pourra pas réserver un autre logement via ce lien.
  if (fixedPrice || holdToken) {
    state._lockedPropertyId = propertyId;
  }

  if (!IS_NATIVE) window.history.replaceState({}, '', window.location.pathname);

  await openProperty(propertyId);

  if (promoCode) state._pendingPromoCode = promoCode.toUpperCase();
}

async function handleStripeReturn(params) {
  // Nettoyer l'URL
  window.history.replaceState({}, '', window.location.pathname);

  // Récupérer les infos de la réservation en attente
  let pending = JSON.parse(localStorage.getItem('guest_pending_booking') || 'null');

  // Fallback : reconstruire depuis les params URL (cas lien libre BH ou perte localStorage natif)
  if (!pending) {
    const pid    = params.get('property_id');
    const ci     = params.get('checkin');
    const co     = params.get('checkout');
    const sid    = params.get('session_id');
    const gName  = params.get('guest_name') || params.get('guest_name') || '';
    const gEmail = params.get('guest_email') || '';
    const gPhone = params.get('guest_phone') || '';
    const fp     = params.get('fixed_price') || null;
    if (pid && ci && co && gEmail) {
      pending = {
        property_id: pid,
        checkin: ci,
        checkout: co,
        guests: parseInt(params.get('guests')) || 1,
        guest_name: decodeURIComponent(gName),
        guest_email: decodeURIComponent(gEmail),
        guest_phone: decodeURIComponent(gPhone),
        promo_code: params.get('promo_code') || '',
        fixed_price_override: fp ? parseFloat(fp) : null,
        session_id: sid
      };
      console.log('[GUEST] Pending reconstruit depuis URL params');
    } else {
      showToast('Paiement reçu !');
      return;
    }
  }

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

    // ✅ Enregistrer le token FCM pour la conversation créée automatiquement
    if (data.conversation_id && typeof window.registerGuestFCMForConv === 'function') {
      window.registerGuestFCMForConv(data.conversation_id).catch(() => {});
    }

    showConfirmation(data, pending.guest_name, pending.guest_email);
  } catch (e) {
    showToast('Réservation confirmée mais erreur: ' + e.message);
  }
}

// ── Navigation ───────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen-content').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name)?.classList.add('active');
  // Scroll en haut
  const ms = document.getElementById('mainScroll');
  if (ms) ms.scrollTop = 0;

  if (name === 'bookings') loadMyBookings();
  if (name === 'account') { loadAccountFields(); renderLogoutSection(); }
}

function navTo(name) {
  // 🔒 Parcours verrouillé (lien personnalisé) : on empêche le retour vers la
  // liste des logements. Le client reste dans le tunnel de SON logement.
  if (state._lockedPropertyId && (name === 'home' || name === 'home-list')) {
    if (state.currentProperty && state.currentProperty.id === state._lockedPropertyId) {
      name = 'detail';
    } else {
      openProperty(state._lockedPropertyId);
      return;
    }
  }

  // Écrans spéciaux sans bottom nav
  const noNavScreens = ['chat']; // Nav visible partout sauf chat plein écran
  const bottomNav = document.getElementById('bottomNav');
  // En parcours verrouillé, on masque la barre d'onglets (tunnel de résa)
  const hideNav = noNavScreens.includes(name) || !!state._lockedPropertyId;
  if (bottomNav) bottomNav.style.display = hideNav ? 'none' : 'flex';
  // Sur detail, bookingBar prend le bas — on masque le bottomNav via classe CSS
  document.body.classList.toggle('screen-detail', name === 'detail');

  // Booking bar uniquement sur detail
  const bookingBar = document.getElementById('bookingBar');
  if (bookingBar) bookingBar.style.display = name === 'detail' ? 'flex' : 'none';

  showScreen(name);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navId = name === 'login' ? 'account' : name === 'chat' ? 'messages' : name === 'home-list' ? 'home' : name;
  document.getElementById('nav-' + navId)?.classList.add('active');
  moveNavPill();

  // Charger les conversations quand on arrive sur l'onglet messages
  if (name === 'messages') loadGuestConversations();
  // Charger les city chips sur home et home-list
  if (name === 'home' || name === 'home-list') loadCityChips();
}

// ══════════════════════════════════════════════════════════════
// 🧊 LIQUID GLASS — Capsule glissante de la bottom nav
// Portée depuis BH : capsule draggable au doigt + spring au snap.
// ══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function tabsOf(bar) {
    return Array.prototype.slice.call(bar.querySelectorAll('.nav-item'))
      .filter(function (t) { return t.offsetWidth > 0; });
  }
  // Onglet actif = celui marqué .active par navTo (sinon -1)
  function activeIndex(tabs) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].classList.contains('active')) return i;
    return -1;
  }
  // La barre est-elle visible ? (masquée sur detail/chat/lock)
  function barVisible(bar) {
    if (!bar) return false;
    if (bar.style.display === 'none') return false;
    var cs = window.getComputedStyle(bar);
    return cs.display !== 'none';
  }

  function setup(bar) {
    if (bar.__lgReady) return;
    bar.__lgReady = true;

    var cap = bar.querySelector('#navPill');
    if (!cap) { cap = document.createElement('span'); cap.id = 'navPill'; bar.insertBefore(cap, bar.firstChild); }

    var dragging = false, moved = false, startX = 0, lastX = 0, lastT = 0, vx = 0;
    var startIdx = -1, hoverIdx = -1, suppressClick = false, mc = [], rafId = 0, pendX = 0, curIdx = -1;

    function snapshot() {
      mc = tabsOf(bar).map(function (t) {
        return { el: t, left: t.offsetLeft, width: t.offsetWidth, center: t.offsetLeft + t.offsetWidth / 2 };
      });
    }
    function markActive(idx) {
      var ts = tabsOf(bar);
      for (var i = 0; i < ts.length; i++) ts[i].classList.toggle('lg-active', i === idx);
    }
    function paintHover(idx) {
      for (var i = 0; i < mc.length; i++) mc[i].el.classList.toggle('lg-hover', i === idx && i !== curIdx);
    }
    function clearHover() {
      for (var i = 0; i < mc.length; i++) mc[i].el.classList.remove('lg-hover');
    }

    function settle(idx, animate) {
      snapshot(); curIdx = idx; markActive(idx);
      if (!barVisible(bar) || idx < 0 || idx >= mc.length) { cap.classList.remove('lg-visible'); return; }
      var m = mc[idx];
      // Léger inset pour que la capsule n'occupe pas toute la largeur de l'item
      var inset = 6;
      cap.classList.remove('lg-dragging');
      cap.classList.toggle('lg-animate', !!animate);
      cap.style.width = (m.width - inset * 2) + 'px';
      cap.style.transform = 'translateX(' + (m.left + inset) + 'px) scaleX(1) translateZ(0)';
      cap.classList.add('lg-visible');
    }

    function sync(animate) {
      settle(activeIndex(tabsOf(bar)), animate);
    }
    bar.__lgSync = sync;

    function applyFollow() {
      rafId = 0; if (!mc.length) return;
      var x = Math.max(mc[0].center, Math.min(mc[mc.length - 1].center, pendX));
      var inset = 6;
      var w = (mc[startIdx] ? mc[startIdx].width : mc[0].width) - inset * 2;
      var st = Math.min(0.10, Math.abs(vx) * 0.008);
      cap.style.width = w + 'px';
      cap.style.transform = 'translateX(' + (x - w / 2 - inset) + 'px) scaleX(' + (1 + st) + ') translateZ(0)';
      var best = 0, bd = Infinity;
      for (var i = 0; i < mc.length; i++) { var dd = Math.abs(mc[i].center - x); if (dd < bd) { bd = dd; best = i; } }
      if (best !== hoverIdx) {
        hoverIdx = best; paintHover(best);
        if (navigator.vibrate) { try { navigator.vibrate(3); } catch (e) {} }
      }
    }
    function follow(px) { pendX = px; if (!rafId) rafId = requestAnimationFrame(applyFollow); }

    function onDown(e) {
      if (!barVisible(bar)) return;
      var p = (e.touches ? e.touches[0] : e); snapshot(); if (!mc.length) return;
      dragging = true; moved = false; startX = lastX = p.clientX; lastT = e.timeStamp || Date.now(); vx = 0; hoverIdx = curIdx;
      startIdx = 0;
      for (var i = 0; i < mc.length; i++) {
        if (p.clientX >= mc[i].left && p.clientX <= mc[i].left + mc[i].width) { startIdx = i; break; }
      }
      cap.classList.remove('lg-animate');
      if (bar.setPointerCapture && e.pointerId != null) { try { bar.setPointerCapture(e.pointerId); } catch (er) {} }
    }
    function onMove(e) {
      if (!dragging) return;
      var p = (e.touches ? e.touches[0] : e);
      var dx = p.clientX - lastX, dt = (e.timeStamp || Date.now()) - lastT;
      if (dt > 0) vx = dx / dt * 16; lastX = p.clientX; lastT = e.timeStamp || Date.now();
      if (!moved && Math.abs(p.clientX - startX) > 6) { moved = true; cap.classList.add('lg-dragging'); }
      if (moved) { if (e.cancelable) e.preventDefault(); follow(p.clientX); }
    }
    function onUp() {
      if (!dragging) return; dragging = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } clearHover();
      if (!moved) { return; }
      var target = hoverIdx >= 0 ? hoverIdx : startIdx;
      settle(target, true);
      if (target !== startIdx && mc[target]) {
        suppressClick = true; setTimeout(function () { suppressClick = false; }, 450);
        var el = mc[target].el;
        // Déclencher la navigation associée à l'onglet cible
        setTimeout(function () {
          var ev;
          try { ev = new MouseEvent('click', { bubbles: true, cancelable: true }); }
          catch (er) { ev = document.createEvent('MouseEvents'); ev.initEvent('click', true, true); }
          ev.__lgProg = true; el.dispatchEvent(ev);
        }, 120);
      }
      moved = false;
    }

    function swallowClick(e) {
      if (e.__lgProg) return;
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
    }

    if (window.PointerEvent) {
      bar.addEventListener('pointerdown', onDown, { passive: true });
      bar.addEventListener('pointermove', onMove, { passive: false });
      bar.addEventListener('pointerup', onUp, { passive: true });
      bar.addEventListener('pointercancel', function () { dragging = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } clearHover(); sync(true); }, { passive: true });
    } else {
      bar.addEventListener('touchstart', onDown, { passive: true });
      bar.addEventListener('touchmove', onMove, { passive: false });
      bar.addEventListener('touchend', onUp, { passive: true });
    }
    bar.addEventListener('click', swallowClick, true);

    sync(false);
    requestAnimationFrame(function () { bar.offsetHeight; cap.classList.add('lg-animate'); });

    // Resync quand la classe .active d'un onglet change (navigation interne)
    tabsOf(bar).forEach(function (t) {
      new MutationObserver(function () { if (!dragging) sync(true); })
        .observe(t, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function boot() {
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      var bar = document.getElementById('bottomNav');
      if (bar && tabsOf(bar).length) { clearInterval(poll); setup(bar); }
      if (tries > 60) clearInterval(poll);
    }, 80);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener('resize', function () { var b = document.getElementById('bottomNav'); if (b && b.__lgSync) b.__lgSync(false); });
  window.addEventListener('orientationchange', function () { setTimeout(function () { var b = document.getElementById('bottomNav'); if (b && b.__lgSync) b.__lgSync(false); }, 200); });
})();

// Repositionner la capsule (appelé par navTo). Délègue au moteur ci-dessus.
function moveNavPill() {
  var bar = document.getElementById('bottomNav');
  if (bar && bar.__lgSync) bar.__lgSync(true);
}

// ══════════════════════════════════════════════════
// MESSAGERIE GUEST — Socket.IO + conversations
// ══════════════════════════════════════════════════

let guestSocket = null;
let currentGuestConvId = null;

function initGuestSocket() {
  if (guestSocket) return;
  try {
    guestSocket = io(API_URL, { transports: ['websocket','polling'] });
    guestSocket.on('connect', () => console.log('✅ [GUEST SOCKET] Connecté'));
    guestSocket.on('new_message', (msg) => {
      if (msg.conversation_id && String(msg.conversation_id) === String(currentGuestConvId)) {
        appendGuestMessage(msg);
        scrollGuestChat();
      }
      // Mettre à jour le badge non-lu si on n'est pas dans ce chat
      if (!currentGuestConvId || String(msg.conversation_id) !== String(currentGuestConvId)) {
        updateGuestMsgBadge(1);
      }
    });
    guestSocket.on('disconnect', () => console.log('❌ [GUEST SOCKET] Déconnecté'));
  } catch(e) {
    console.warn('⚠️ Socket.IO non disponible:', e.message);
  }
}

async function loadGuestConversations() {
  const session = getSession();
  if (!session) {
    document.getElementById('guestConvList').innerHTML = `
      <div style="text-align:center;padding:40px 20px;">
        <div style="font-size:40px;margin-bottom:12px;">💬</div>
        <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:8px;">Connectez-vous</div>
        <div style="font-size:14px;color:#64748b;margin-bottom:20px;">Pour accéder à vos messages</div>
        <button onclick="navTo('login')" style="padding:12px 24px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;">Se connecter</button>
      </div>`;
    return;
  }

  initGuestSocket();

  const list = document.getElementById('guestConvList');
  list.innerHTML = '<div class="loading-center"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    const res = await fetch(`${API_URL}/api/guest/conversations`, {
      headers: { 'Authorization': 'Bearer ' + session.token }
    });
    const data = await res.json();
    const convs = data.conversations || [];

    if (!convs.length) {
      list.innerHTML = `<div style="text-align:center;padding:40px 20px;">
        <div style="font-size:40px;margin-bottom:12px;">💬</div>
        <div style="font-size:16px;font-weight:700;color:#1e293b;margin-bottom:8px;">Aucun message</div>
        <div style="font-size:14px;color:#64748b;">Vos échanges avec les hôtes apparaîtront ici.</div>
      </div>`;
      return;
    }

    let totalUnread = 0;
    list.innerHTML = convs.map(c => {
      const unread = parseInt(c.unread_count || 0);
      totalUnread += unread;
      const propName = c.property_name || c.property_internal_name || 'Logement';
      const lastMsg = c.last_message ? c.last_message.substring(0, 60) + (c.last_message.length > 60 ? '…' : '') : 'Aucun message';
      const dateStr = c.last_message_at ? new Date(c.last_message_at).toLocaleDateString('fr-FR', {day:'numeric',month:'short'}) : '';
      const checkin = c.reservation_start_date ? new Date(c.reservation_start_date).toLocaleDateString('fr-FR', {day:'numeric',month:'short'}) : '';
      const checkout = c.reservation_end_date ? new Date(c.reservation_end_date).toLocaleDateString('fr-FR', {day:'numeric',month:'short'}) : '';
      return `<div onclick="openGuestChat(${c.id},'${propName.replace(/'/g,"\'")}','${checkin}','${checkout}')"
        style="background:white;border-radius:14px;padding:14px 16px;margin-bottom:10px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.06);border-left:3px solid ${unread ? 'var(--primary)' : 'transparent'};display:flex;align-items:center;gap:12px;">
        <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;">
          ${propName.charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
            <span style="font-size:15px;font-weight:${unread?'700':'600'};color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${propName}</span>
            <span style="font-size:11px;color:#94a3b8;flex-shrink:0;">${dateStr}</span>
          </div>
          ${checkin ? `<div style="font-size:11px;color:var(--primary);font-weight:600;margin-bottom:3px;">${checkin} → ${checkout}</div>` : ''}
          <div style="font-size:13px;color:${unread?'#1e293b':'#64748b'};font-weight:${unread?'600':'400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${lastMsg}</div>
        </div>
        ${unread ? `<span style="background:var(--primary);color:white;border-radius:999px;font-size:11px;font-weight:700;padding:2px 7px;min-width:20px;text-align:center;flex-shrink:0;">${unread}</span>` : ''}
      </div>`;
    }).join('');

    updateGuestMsgBadge(totalUnread);
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;color:#ef4444;padding:20px;">Erreur de chargement</div>';
  }
}

function updateGuestMsgBadge(count) {
  const badge = document.getElementById('navMsgsBadge');
  if (!badge) return;
  if (!count || count < 1) {
    badge.style.display = 'none';
    return;
  }
  badge.textContent = count > 9 ? '9+' : count;
  badge.style.display = 'block';
  badge.style.background = '#ef4444';
}

async function openGuestChat(convId, propName, checkin, checkout) {
  currentGuestConvId = convId;
  document.getElementById('chatGuestPropName').textContent = propName;
  document.getElementById('chatGuestDates').textContent = checkin && checkout ? checkin + ' → ' + checkout : '';
  document.getElementById('guestChatMessages').innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;"><i class="fas fa-spinner fa-spin"></i></div>';

  // Rejoindre la room Socket.IO
  if (guestSocket) guestSocket.emit('join_conversation', convId);

  // Masquer bottom nav + afficher écran chat
  navTo('chat');

  // Charger les messages
  const session = getSession();
  try {
    const res = await fetch(`${API_URL}/api/guest/conversations/${convId}/messages`, {
      headers: { 'Authorization': 'Bearer ' + session.token }
    });
    const data = await res.json();
    const msgs = data.messages || [];
    const container = document.getElementById('guestChatMessages');
    container.innerHTML = '';
    if (!msgs.length) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;font-size:14px;">Aucun message pour l\'instant.</div>';
    } else {
      msgs.forEach(m => appendGuestMessage(m));
    }
    scrollGuestChat();
  } catch(e) {
    document.getElementById('guestChatMessages').innerHTML = '<div style="text-align:center;color:#ef4444;padding:20px;">Erreur</div>';
  }
}

function appendGuestMessage(msg) {
  const container = document.getElementById('guestChatMessages');
  if (!container) return;
  const isGuest = msg.sender_type === 'guest';
  const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'}) : '';
  const div = document.createElement('div');
  div.style.cssText = `display:flex;flex-direction:column;align-items:${isGuest?'flex-end':'flex-start'};max-width:80%;${isGuest?'align-self:flex-end':'align-self:flex-start'}`;
  div.innerHTML = `
    <div style="background:${isGuest?'var(--primary)':'white'};color:${isGuest?'white':'#1e293b'};padding:10px 14px;border-radius:${isGuest?'16px 16px 4px 16px':'16px 16px 16px 4px'};font-size:14px;line-height:1.5;box-shadow:0 1px 3px rgba(0,0,0,0.08);word-wrap:break-word;">
      ${msg.message.replace(/\n/g,'<br>')}
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-top:3px;${isGuest?'text-align:right':''}">${time}</div>`;
  container.appendChild(div);
}

function scrollGuestChat() {
  const c = document.getElementById('guestChatMessages');
  if (c) c.scrollTop = c.scrollHeight;
}

async function sendGuestMessage() {
  const input = document.getElementById('guestChatInput');
  const msg = input?.value?.trim();
  if (!msg || !currentGuestConvId) return;
  const session = getSession();
  if (!session) { showToast('Connectez-vous d\'abord'); return; }

  input.value = '';
  input.style.height = 'auto';

  // Afficher immédiatement (optimistic)
  appendGuestMessage({ sender_type: 'guest', message: msg, created_at: new Date().toISOString() });
  scrollGuestChat();

  try {
    await fetch(`${API_URL}/api/guest/conversations/${currentGuestConvId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.token },
      body: JSON.stringify({ message: msg })
    });
  } catch(e) {
    showToast('Erreur d\'envoi');
  }
}

// ── Recherche ────────────────────────────────────────────────
function openSearch() {
  document.getElementById('searchModal')?.classList.add('open');
  loadCityChips();
  updateDateBoxes();
  updateResetBtn();
}

function closeSearchOnBg(e) {
  if (document.getElementById('searchModal') && e.target === document.getElementById('searchModal')) {
    document.getElementById('searchModal')?.classList.remove('open');
  }
}

// Cache des ratings Channex { propertyId: { avg, count } }
const _ratingsCache = {};

// Récupère la note moyenne d'un logement (route publique)
async function fetchPropertyRating(propertyId) {
  if (_ratingsCache[propertyId] !== undefined) return _ratingsCache[propertyId];
  try {
    const res = await fetch(`${API_URL}/api/guest/properties/${propertyId}/rating`);
    if (!res.ok) { _ratingsCache[propertyId] = null; return null; }
    const data = await res.json();
    _ratingsCache[propertyId] = data;
    return data;
  } catch { _ratingsCache[propertyId] = null; return null; }
}

// Génère le HTML des étoiles depuis une note /10 (Channex)
function renderStars(rating) {
  if (!rating) return '<span style="color:#9ca3af;font-size:12px;">Pas encore d\'avis</span>';
  const on5 = Math.round((rating / 2) * 2) / 2; // note /10 → /5, demi-étoiles
  const full = Math.floor(on5);
  const half = on5 % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  const stars = '<i class="fas fa-star" style="color:#f59e0b"></i>'.repeat(full)
    + (half ? '<i class="fas fa-star-half-stroke" style="color:#f59e0b"></i>' : '')
    + '<i class="far fa-star" style="color:#d1d5db"></i>'.repeat(empty);
  return `${stars} <span style="font-weight:600;font-size:12px;color:#374151">${(rating/2).toFixed(1)}</span>`;
}

let _citiesCache = null;

// Charge les villes disponibles — alimente homeCityChips + listCityChips
async function loadCityChips() {
  const containers = [
    document.getElementById('homeCityChips'),
    document.getElementById('listCityChips')
  ].filter(Boolean);
  if (!containers.length) return;

  try {
    if (!_citiesCache) {
      const res = await fetch(`${API_URL}/api/guest/properties`);
      const props = await res.json();
      // Extraire le nom de ville sans code postal (ex: "78350 Jouy-en-Josas" → "Jouy-en-Josas")
      const extractCity = str => str ? str.replace(/^\d{4,6}\s+/,'').trim() : null;
      _citiesCache = [...new Set(
        props.map(p => {
          const raw = p.city || (p.address ? p.address.split(',').slice(-2,-1)[0]?.trim() : null);
          return extractCity(raw);
        }).filter(Boolean)
      )].sort();
    }
    const cities = _citiesCache;
    if (!cities.length) return;

    const currentCity = state.search.city;
    const html = [
      `<button type="button" class="city-chip${!currentCity ? ' active' : ''}" onclick="selectCity(this, null)">Toutes</button>`,
      ...cities.map(city => `<button type="button" class="city-chip${currentCity === city ? ' active' : ''}" onclick="selectCity(this, '${city.replace(/'/g, "\\'")}')">${city}</button>`)
    ].join('');

    containers.forEach(c => { c.innerHTML = html; });
  } catch(e) {
    containers.forEach(c => { c.innerHTML = ''; });
  }
}

function selectCity(btn, city) {
  const chips = document.querySelectorAll('.city-chip');
  if (city !== null && btn.classList.contains('active')) {
    btn.classList.remove('active');
    state.search.city = null;
  } else {
    chips.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    state.search.city = city;
  }
  updateSearchLabel();
  updateResetBtn();
  // Si on est sur home, naviguer vers la liste filtrée ; sinon filtrer sur place
  const currentScreen = document.querySelector('.screen-content.active')?.id;
  if (currentScreen === 'screen-home') {
    navTo('home-list');
  } else {
    filterProperties();
  }
}

function updateDateBoxes() {
  const ci = document.getElementById('searchCheckin')?.value;
  const co = document.getElementById('searchCheckout')?.value;
  document.getElementById('dateBoxCheckin')?.classList.toggle('has-value', !!ci);
  document.getElementById('dateBoxCheckout')?.classList.toggle('has-value', !!co);
  updateResetBtn();
}

function updateResetBtn() {
  const ci = document.getElementById('searchCheckin')?.value;
  const co = document.getElementById('searchCheckout')?.value;
  const hasCity = !!state.search.city;
  const hasGuests = !!state.search.guests;
  const hasFilter = ci || co || hasCity || hasGuests;
  const btn = document.getElementById('btnResetFilters');
  if (btn) btn.classList.toggle('visible', !!hasFilter);
}

// ── Filtres logements ────────────────────────────────────────
let _activeFilter = '';

function filterCat(el, cat) {
  document.querySelectorAll('.home-cat').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _activeFilter = cat;
  navTo('home-list');
}

function setFilter(el, filter) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _activeFilter = filter;
  filterProperties();
}

function filterProperties() {
  const search = (document.getElementById('listSearchInput')?.value || '').toLowerCase();
  const cityFilter = (state.search.city || '').toLowerCase();
  const cards = document.querySelectorAll('.prop-card');
  cards.forEach(card => {
    const name = (card.dataset.name || '').toLowerCase();
    const type = (card.dataset.type || '').toLowerCase();
    const cardCity = (card.dataset.city || '').toLowerCase();
    const matchSearch = !search || name.includes(search);
    const matchFilter = !_activeFilter || _activeFilter.startsWith('prix') || type.includes(_activeFilter);
    const matchCity = !cityFilter || cardCity.includes(cityFilter);
    card.style.display = matchSearch && matchFilter && matchCity ? 'block' : 'none';
  });
}

function resetFilters() {
  document.getElementById('searchCheckin').value = '';
  document.getElementById('searchCheckout').value = '';
  document.querySelectorAll('.city-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.guest-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.guest-btn[data-val=""]')?.classList.add('active');
  state.search = { ...state.search, checkin: null, checkout: null, city: null, guests: null };
  updateDateBoxes();
  updateSearchLabel();
  updateResetBtn();
}

function updateSearchLabel() {
  const ci = document.getElementById('searchCheckin')?.value;
  const co = document.getElementById('searchCheckout')?.value;
  const fmtDate = iso => iso ? new Date(String(iso).substring(0,10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : null;
  let parts = [];
  if (state.search.city) parts.push(state.search.city);
  if (ci && co) parts.push(`${fmtDate(ci)} → ${fmtDate(co)}`);
  else if (ci) parts.push(`Arrivée ${fmtDate(ci)}`);
  if (state.search.guests) parts.push(state.search.guests + ' voy.');
  if (document.getElementById('searchLabel')) document.getElementById('searchLabel').textContent = parts.join(' · ') || 'Dates, voyageurs...';
}

function selectGuests(btn, val) {
  document.querySelectorAll('.guest-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.search.guests = val || null;
  updateSearchLabel();
  updateResetBtn();
}

async function applySearch() {
  state.search.checkin = document.getElementById('searchCheckin').value || null;
  state.search.checkout = document.getElementById('searchCheckout').value || null;
  // city est déjà dans state.search.city via selectCity()
  document.getElementById('searchModal')?.classList.remove('open');
  await loadProperties();
}

// ── Chargement logements ─────────────────────────────────────
// ── Logements en vedette (accueil) ──────────────────────────
async function loadFeaturedProperties() {
  const el = document.getElementById('homeFeatured');
  if (!el) return;
  try {
    const res = await fetch(`${API_URL}/api/guest/properties`);
    if (!res.ok) throw new Error();
    const props = await res.json();
    if (!props.length) { el.innerHTML = '<div style="padding:20px;color:#9ca3af;font-size:13px;">Aucun logement disponible</div>'; return; }
    const featuredProps = props.slice(0,4);
    el.innerHTML = featuredProps.map(p => `
      <div class="home-card" onclick="openProperty('${p.id}')">
        <div class="home-card-img" style="${p.photoUrl ? 'padding:0;background:none;' : ''}">
          ${p.photoUrl ? `<img src="${p.photoUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;">` : '🏠'}
        </div>
        <div class="home-card-body">
          <div class="home-card-stars" id="stars-home-${p.id}" style="color:#d1d5db;font-size:12px;">…</div>
          <div class="home-card-name">${p.name}</div>
          <div class="home-card-loc"><i class="fas fa-location-dot"></i>${p.city || 'France'}</div>
          <div class="home-card-price">${p.basePrice || '—'}€ <span>/ nuit</span></div>
        </div>
      </div>
    `).join('');
    // Charger les vraies notes Channex en arrière-plan
    featuredProps.forEach(async p => {
      const r = await fetchPropertyRating(p.id);
      const el2 = document.getElementById(`stars-home-${p.id}`);
      if (el2) el2.innerHTML = renderStars(r?.avg || null);
    });
  } catch(e) {
    el.innerHTML = '<div style="padding:20px;color:#9ca3af;font-size:13px;">Chargement impossible</div>';
  }
}

async function loadProperties() {
  const grid = document.getElementById('propertiesList');
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
      <div class="prop-card" data-name="${(p.name||'').toLowerCase()}" data-type="${(p.description||'').toLowerCase()}" data-city="${(p.city||p.address||'').toLowerCase()}" onclick="openProperty('${p.id}')">
        <div class="prop-card-img" style="${p.photoUrl ? 'padding:0;background:none;' : ''}">
          ${p.photoUrl
            ? `<img src="${p.photoUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
            : '<i class="fas fa-home"></i>'}
          ${p.basePrice ? `<div class="prop-card-badge">${p.basePrice}€ / nuit</div>` : ''}
        </div>
        <div class="prop-card-body">
          <div class="prop-card-stars" id="stars-list-${p.id}" style="color:#d1d5db;font-size:12px;">…</div>
          <div class="prop-card-name">${p.name}</div>
          <div class="prop-card-loc"><i class="fas fa-location-dot"></i>${p.city || p.address || 'France'}</div>
          <div class="prop-card-features">
            ${p.bedrooms ? `<div class="prop-card-feat"><i class="fas fa-bed"></i>${p.bedrooms} ch.</div>` : ''}
            ${p.maxGuests ? `<div class="prop-card-feat"><i class="fas fa-user"></i>${p.maxGuests} pers.</div>` : ''}
            ${p.bathrooms ? `<div class="prop-card-feat"><i class="fas fa-bath"></i>${p.bathrooms} sdb</div>` : ''}
          </div>
          <div class="prop-card-footer">
            <div>
              <div class="prop-card-price-main">${p.basePrice || '—'}€</div>
              <div class="prop-card-price-night">/ nuit</div>
            </div>
            <button class="prop-card-btn">Réserver</button>
          </div>
        </div>
      </div>
    `).join('');
    // Charger les vraies notes Channex en arrière-plan
    state.properties.forEach(async p => {
      const r = await fetchPropertyRating(p.id);
      const el = document.getElementById(`stars-list-${p.id}`);
      if (el) el.innerHTML = renderStars(r?.avg || null);
    });

  } catch (e) {
    grid.innerHTML = `<div class="empty-state"><i class="fas fa-wifi"></i><p>Impossible de charger les logements</p></div>`;
  }
}

// ── Ouvrir un logement ───────────────────────────────────────
async function openProperty(id) {
  // 🔒 Si le client est arrivé via un lien personnalisé (prix négocié / hold),
  // il est verrouillé sur le logement assigné. Toute tentative d'ouvrir un
  // autre logement le ramène sur le sien.
  if (state._lockedPropertyId && id !== state._lockedPropertyId) {
    showToast("Ce lien est réservé à un logement précis");
    id = state._lockedPropertyId;
  }

  navTo('detail');
  document.getElementById('detailContent').innerHTML = '<div class="loading-center" style="padding:60px"><i class="fas fa-spinner fa-spin"></i></div>';

  try {
    const res = await fetch(`${API_URL}/api/guest/properties/${id}`);
    if (!res.ok) throw new Error('Logement introuvable');
    state.currentProperty = await res.json();

    // Reset sélection dates
    state.selectedCheckin = state.search.checkin || null;
    state.selectedCheckout = state.search.checkout || null;
    state.selectingEnd = state.selectedCheckin ? true : null;

    document.getElementById('detailHeaderName').textContent = state.currentProperty.name;
  // Bouton retour dans le header
  const detailHeader = document.getElementById('detailHeader');
  if (detailHeader) {
    const backBtn = detailHeader.querySelector('.btn-back');
    if (backBtn) {
      // En parcours verrouillé, pas de retour vers la liste : le client
      // n'a qu'un seul logement à réserver.
      if (state._lockedPropertyId) {
        backBtn.style.display = 'none';
      } else {
        backBtn.style.display = '';
        backBtn.onclick = () => navTo('home-list');
      }
    }
  }
    renderDetail();
    updateBookingBar();

  } catch (e) {
    document.getElementById('detailContent').innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>${e.message}</p></div>`;
  }
}

function renderDetail() {
  const p = state.currentProperty;
  document.getElementById('detailContent').innerHTML = `
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
    const s = new Date(String(start).substring(0,10) + 'T12:00:00');
    const e = new Date(String(end).substring(0,10) + 'T12:00:00');
    for (let d = new Date(s); d < e; d.setDate(d.getDate() + 1)) {
      // Utiliser la date locale (pas UTC) pour éviter le décalage
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      bookedSet.add(`${y}-${m}-${day}`);
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
    // Forcer midi pour éviter décalage UTC
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const dateStr = `${year}-${mm}-${dd}`;
    const date = new Date(dateStr + 'T12:00:00');
    const isPast = date < today;
    const isBooked = bookedSet.has(dateStr);
    const isToday = date.toDateString() === today.toDateString();
    const isStart = dateStr === state.selectedCheckin;
    const isEnd = dateStr === state.selectedCheckout;
    const isInRange = state.selectedCheckin && state.selectedCheckout
      && dateStr > state.selectedCheckin && dateStr < state.selectedCheckout;

    let cls = 'cal-day';
    if (isPast || isBooked) cls += ' disabled';
    if (isStart) cls += ' selected range-start';
    else if (isEnd) cls += ' selected range-end';
    else if (isInRange) cls += ' in-range';
    if (isToday && !isStart && !isEnd) cls += ' today';

    const clickable = !isPast && !isBooked;
    html += `<div class="${cls}" ${clickable ? `data-date="${dateStr}"` : ''}>${day}</div>`;
  }

  html += `</div></div>`;
  document.getElementById('calendarContainer').innerHTML = html;

  // Délégation d'événements — plus fiable qu'onclick inline sur iOS
  const calEl = document.getElementById('calendarContainer');
  if (calEl) {
    calEl.onclick = function(e) {
      const dayEl = e.target.closest('[data-date]');
      if (dayEl && dayEl.dataset.date) selectDate(dayEl.dataset.date);
    };
  }
}

function calNav(dir) {
  state.calendar.month += dir;
  if (state.calendar.month < 0) { state.calendar.month = 11; state.calendar.year--; }
  if (state.calendar.month > 11) { state.calendar.month = 0; state.calendar.year++; }
  renderCalendar();
}

function selectDate(dateStr) {
  if (!state.selectedCheckin || state.selectingEnd === null || state.selectingEnd === false) {
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

// ── Prix réel d'une nuit ─────────────────────────────────────
// Priorité : prix du calendrier (override + règles, fourni par
// l'API via calendarPrices) → weekend_price → base_price.
// Garantit que le client voit le même prix que le calendrier de l'hôte.
function _dateKey(d) {
  // Clé YYYY-MM-DD en heure locale (évite le décalage de toISOString)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nightPrice(p, date) {
  if (!p) return 0;
  if (p.calendarPrices) {
    const key = _dateKey(date);
    if (p.calendarPrices[key] != null) return p.calendarPrices[key];
  }
  const dow = date.getDay();
  return (dow === 5 || dow === 6) && p.weekendPrice ? p.weekendPrice : (p.basePrice || 0);
}

// Somme des prix réels nuit par nuit entre checkin et checkout
function sumNights(p, checkin, checkout) {
  const nights = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const d = new Date(checkin);
    d.setDate(d.getDate() + i);
    total += nightPrice(p, d);
  }
  return total;
}

function updateBookingBar() {
  const p = state.currentProperty;
  if (!p) return;
  const bar = document.getElementById('bookingBarPrice');

  if (state.selectedCheckin && state.selectedCheckout) {
    const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
    const total = sumNights(p, state.selectedCheckin, state.selectedCheckout);
    if (bar) bar.innerHTML = `${total}€ <span style="font-size:12px;font-weight:400;color:var(--text2);">· ${nights} nuit${nights > 1 ? 's' : ''}</span>`;
  } else {
    if (bar) bar.innerHTML = `${p.basePrice}€`;
  }
}

// ── Checkout ─────────────────────────────────────────────────
function goToCheckout() {
  if (!state.selectedCheckin || !state.selectedCheckout) return;
  const p = state.currentProperty;
  const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
  const total = sumNights(p, state.selectedCheckin, state.selectedCheckout);
  // Prix fixe depuis deep link — UNIQUEMENT sur le logement verrouillé.
  // (Sécurité : empêche le prix négocié de fuiter sur un autre logement.)
  const fixedPriceOverride = (state._pendingFixedPrice != null
    && (!state._lockedPropertyId || p.id === state._lockedPropertyId))
    ? state._pendingFixedPrice
    : null;
  const displayBase = fixedPriceOverride !== null ? fixedPriceOverride : total;
  const commission = Math.round(displayBase * 0.03 * 100) / 100;
  // Prix fixe = tout inclus : ménage et taxe de séjour non ajoutés
  const cleaningFee = fixedPriceOverride !== null ? 0 : (p.cleaningFee || 0);
  const guestCount = parseInt(document.getElementById('guestCount')?.value) || 2;
  const touristTax = fixedPriceOverride !== null ? 0 : (p.touristTaxPerNight
    ? Math.round(p.touristTaxPerNight * nights * guestCount * 100) / 100
    : 0);
  const ttc = Math.round((displayBase + cleaningFee + touristTax + commission) * 100) / 100;
  const fmtDate = iso => new Date(String(iso).substring(0,10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  // Reset promo state (pas de promo si prix fixe)
  state.appliedPromo = null;
  if (fixedPriceOverride !== null) state._fixedPriceActive = fixedPriceOverride;

  // Bouton retour checkout
  const checkoutHeader = document.querySelector('#screen-checkout .page-header .btn-back');
  if (checkoutHeader) checkoutHeader.onclick = () => navTo('detail');

  document.getElementById('checkoutContent').innerHTML = `
    <div class="checkout-summary" id="priceSummary">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;">${p.name}</div>
      <div class="checkout-row"><span>Dates</span><span>${fmtDate(state.selectedCheckin)} → ${fmtDate(state.selectedCheckout)}</span></div>
      ${fixedPriceOverride !== null
        ? `<div class="checkout-row" id="baseRow"><span>Prix négocié</span><span>${displayBase}€</span></div>
           <div class="checkout-row" style="font-size:11px;color:#9CA3AF;"><span><em>Prix spécial convenu avec l'hôte</em></span></div>`
        : `<div class="checkout-row" id="baseRow"><span>Hébergement · ${nights} nuit${nights > 1 ? 's' : ''}</span><span>${total}€</span></div>`
      }
      <div class="checkout-row" id="promoRow" style="display:${fixedPriceOverride !== null ? 'none' : 'none'};color:#10b981;"><span>Code promo</span><span id="promoAmount">-0€</span></div>
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
    <div style="background:var(--bg);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--text-light);margin-top:8px;margin-bottom:16px;">
      <i class="fas fa-lock" style="color:var(--primary);margin-right:6px;"></i>
      Paiement sécurisé. Votre réservation sera confirmée immédiatement.
    </div>
    <button id="btnPay" onclick="submitBooking()" style="width:100%;padding:16px;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;border:none;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit;">
      Payer ${ttc}€
    </button>
  `;

  navTo('checkout');
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
  const totalBase = sumNights(p, state.selectedCheckin, state.selectedCheckout);
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
    const total = sumNights(p, state.selectedCheckin, state.selectedCheckout);

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
  // Sécurité : le prix négocié n'est transmis que si on est bien sur le
  // logement verrouillé par le lien personnalisé.
  const onLockedProperty = !state._lockedPropertyId
    || (state.currentProperty && state.currentProperty.id === state._lockedPropertyId);
  const fixedPriceOverride = onLockedProperty ? (state._fixedPriceActive || null) : null;

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
        promo_code: promoCode,
        fixed_price_override: fixedPriceOverride,
        hold_token: state._holdToken || localStorage.getItem('guest_hold_token') || null
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
      fixed_price_override: fixedPriceOverride,
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
  const fmtDate = iso => new Date(String(iso).substring(0,10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  // 🔓 La réservation est faite : on lève le verrou du lien personnalisé.
  // Le client est maintenant libre de parcourir les autres logements.
  state._lockedPropertyId = null;
  state._pendingFixedPrice = null;
  state._fixedPriceActive = null;
  state._holdToken = null;
  localStorage.removeItem('guest_hold_token');

  document.getElementById('confirmContent').innerHTML = `
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

    const fmtDate = iso => new Date(String(iso).substring(0,10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const now = new Date();

    list.innerHTML = bookings.map(b => {
      const checkinDate = new Date(String(b.checkin).substring(0,10) + 'T12:00:00');
      const checkoutDate = new Date(String(b.checkout).substring(0,10) + 'T12:00:00');
      const isPast = checkoutDate < now;
      const isCurrent = checkinDate <= now && checkoutDate >= now;
      const isFuture = checkinDate > now;

      // Badge statut réservation
      const statusLabel = b.status === 'confirmed' ? (isCurrent ? '🏠 En cours' : isFuture ? '✅ Confirmé' : '✓ Passé') : '❌ Annulé';
      const statusColor = b.status === 'confirmed' ? (isCurrent ? '#7c3aed' : isFuture ? '#10b981' : '#94a3b8') : '#ef4444';
      const statusBg = b.status === 'confirmed' ? (isCurrent ? '#f5f3ff' : isFuture ? '#d1fae5' : '#f1f5f9') : '#fef2f2';

      // Badge caution
      let depositBadge = '';
      if (b.deposit) {
        const ds = b.deposit.status;
        const dLabel = ds === 'authorized' ? '🔒 Caution autorisée'
          : ds === 'captured' ? '💳 Caution débitée'
          : ds === 'released' ? '✅ Caution libérée'
          : ds === 'pending' ? '⏳ Caution en attente'
          : ds === 'failed' ? '❌ Caution échouée' : '';
        const dColor = ds === 'authorized' ? '#7c3aed' : ds === 'captured' ? '#dc2626' : ds === 'released' ? '#10b981' : ds === 'pending' ? '#f59e0b' : '#ef4444';
        const dBg = ds === 'authorized' ? '#f5f3ff' : ds === 'captured' ? '#fef2f2' : ds === 'released' ? '#d1fae5' : ds === 'pending' ? '#fffbeb' : '#fef2f2';
        if (dLabel) depositBadge = `<span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:${dBg};color:${dColor};">${dLabel}</span>`;
      }

      // Badge paiement
      let paymentBadge = '';
      if (b.payment) {
        const ps = b.payment.status;
        const pLabel = ps === 'paid' ? '💳 Payé' : ps === 'pending' ? '⏳ Paiement en attente' : ps === 'failed' ? '❌ Paiement échoué' : '';
        const pColor = ps === 'paid' ? '#10b981' : ps === 'pending' ? '#f59e0b' : '#ef4444';
        const pBg = ps === 'paid' ? '#d1fae5' : ps === 'pending' ? '#fffbeb' : '#fef2f2';
        if (pLabel) paymentBadge = `<span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:${pBg};color:${pColor};">${pLabel}</span>`;
      }

      // Boutons d'action
      const btnContact = b.conversationId
        ? `<button onclick="openGuestChat(${b.conversationId},'${(b.property.name||'').replace(/'/g,"\'")}','${fmtDate(b.checkin)}','${fmtDate(b.checkout)}')"
            style="flex:1;padding:10px;background:var(--primary);color:white;border:none;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            <i class="fas fa-comment-dots"></i> Contacter
          </button>` : '';

      const btnLivret = b.property.welcomeBookUrl
        ? `<button onclick="window.open('${b.property.welcomeBookUrl}','_blank')"
            style="flex:1;padding:10px;background:#f0fdf4;color:#10b981;border:1px solid #bbf7d0;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            <i class="fas fa-book-open"></i> Livret
          </button>` : '';

      const hasButtons = btnContact || btnLivret;

      return `<div style="background:white;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);border-left:3px solid ${statusColor};">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div style="font-size:16px;font-weight:700;color:#1e293b;flex:1;margin-right:8px;">${b.property.name || 'Logement'}</div>
          <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:${statusBg};color:${statusColor};white-space:nowrap;">${statusLabel}</span>
        </div>

        <!-- Dates -->
        <div style="font-size:13px;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
          <i class="fas fa-calendar" style="color:var(--primary);font-size:12px;"></i>
          <span>${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}</span>
          ${b.property.city ? `<span style="color:#cbd5e1;">·</span><span>${b.property.city}</span>` : ''}
        </div>

        <!-- Horaires arrivée/départ -->
        ${(b.property.arrivalTime || b.property.departureTime) ? `
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;display:flex;gap:12px;">
          ${b.property.arrivalTime ? `<span><i class="fas fa-sign-in-alt" style="color:#10b981;margin-right:3px;"></i>Arrivée dès ${b.property.arrivalTime}</span>` : ''}
          ${b.property.departureTime ? `<span><i class="fas fa-sign-out-alt" style="color:#f59e0b;margin-right:3px;"></i>Départ avant ${b.property.departureTime}</span>` : ''}
        </div>` : ''}

        <!-- Montant -->
        <div style="font-size:18px;font-weight:800;color:#1e293b;margin-bottom:10px;">${parseFloat(b.total).toFixed(0)}€</div>

        <!-- Badges statuts -->
        ${depositBadge || paymentBadge ? `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
          ${depositBadge}${paymentBadge}
        </div>` : ''}

        <!-- Boutons d'action -->
        ${hasButtons ? `
        <div style="display:flex;gap:8px;">
          ${btnContact}${btnLivret}
        </div>` : ''}
      </div>`;
    }).join('');

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
  const t = document.getElementById('toastMsg') || document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.style.display = 'none', 300); }, 3000);
}

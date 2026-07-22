// ============================================================
// BOOSTINGHOST GUEST — app-guest.js
// ============================================================

// ─── Système d'icônes SF (traits fins, cohérent avec la bottom nav) ───
const BH_ICONS = {
  'search':      '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>',
  'location':    '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  'bed':         '<svg viewBox="0 0 24 24"><path d="M3 7v11M3 12h18v6M21 18v-5a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="10.5" r="1.6"/></svg>',
  'bath':        '<svg viewBox="0 0 24 24"><path d="M4 12V6.5A2.5 2.5 0 0 1 6.5 4a2.3 2.3 0 0 1 2.3 2"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M5 12v3a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-3"/><line x1="8" y1="19.5" x2="7" y2="21.5"/><line x1="16" y1="19.5" x2="17" y2="21.5"/></svg>',
  'users':       '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 3-4.6 5.5-4.6S14 16 14.5 19"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1M17 14.6c2 .5 3.6 2 4 4.4"/></svg>',
  'user':        '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M5 20c.7-3.6 3.6-5.5 7-5.5s6.3 1.9 7 5.5"/></svg>',
  'moon':        '<svg viewBox="0 0 24 24"><path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z"/></svg>',
  'wifi':        '<svg viewBox="0 0 24 24"><path d="M5 12.5a10 10 0 0 1 14 0M8 15.8a5.5 5.5 0 0 1 8 0"/><circle cx="12" cy="19" r="1"/></svg>',
  'clock':       '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  'check':       '<svg viewBox="0 0 24 24"><polyline points="4.5 12.5 9.5 17.5 19.5 6.5"/></svg>',
  'calendar':    '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="6.5"/><line x1="16" y1="3" x2="16" y2="6.5"/></svg>',
  'calendar-check':'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="6.5"/><line x1="16" y1="3" x2="16" y2="6.5"/><polyline points="8.5 14.5 11 17 15.5 12.5"/></svg>',
  'home':        '<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h3.5v-5a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v5H18a1 1 0 0 0 1-1v-9"/></svg>',
  'message':     '<svg viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17h-.5A2.5 2.5 0 0 1 3 14.5z"/></svg>',
  'arrow-left':  '<svg viewBox="0 0 24 24"><line x1="20" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/></svg>',
  'arrow-right': '<svg viewBox="0 0 24 24"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>',
  'chevron-left':'<svg viewBox="0 0 24 24"><polyline points="14 6 8 12 14 18"/></svg>',
  'chevron-right':'<svg viewBox="0 0 24 24"><polyline points="10 6 16 12 10 18"/></svg>',
  'lock':        '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.2"/></svg>',
  'key':         '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M18.5 18.5l1.5-1.5"/></svg>',
  'shield':      '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z"/><polyline points="9 11.5 11.2 13.7 15 9.5"/></svg>',
  'headset':     '<svg viewBox="0 0 24 24"><path d="M5 13v-1a7 7 0 0 1 14 0v1"/><rect x="3.5" y="13" width="3.5" height="6" rx="1.5"/><rect x="17" y="13" width="3.5" height="6" rx="1.5"/><path d="M19 19a4 4 0 0 1-4 3.2"/></svg>',
  'star':        '<svg viewBox="0 0 24 24"><polygon points="12 3.5 14.6 9 20.5 9.8 16 14 17.2 20 12 17 6.8 20 8 14 3.5 9.8 9.4 9"/></svg>',
  'bolt':        '<svg viewBox="0 0 24 24"><polygon points="13 2.5 5 13 11 13 10 21.5 19 10 13 10"/></svg>',
  'book':        '<svg viewBox="0 0 24 24"><path d="M4 5.5A2 2 0 0 1 6 4h6v15H6a2 2 0 0 0-2 1.5z"/><path d="M20 5.5A2 2 0 0 0 18 4h-6v15h6a2 2 0 0 1 2 1.5z"/></svg>',
  'send':        '<svg viewBox="0 0 24 24"><path d="M21 3 10.5 13.5M21 3l-7 18-3.5-7.5L3 10z"/></svg>',
  'sign-in':     '<svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><line x1="4" y1="12" x2="15" y2="12"/><polyline points="11 8 15 12 11 16"/></svg>',
  'sign-out':    '<svg viewBox="0 0 24 24"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><line x1="20" y1="12" x2="9" y2="12"/><polyline points="16 8 20 12 16 16"/></svg>',
  'user-plus':   '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.8"/><path d="M3 20c.7-3.4 3.4-5.2 6-5.2"/><line x1="17" y1="9" x2="17" y2="15"/><line x1="14" y1="12" x2="20" y2="12"/></svg>',
  'info':        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="7.8" r="0.6"/></svg>',
  'alert':       '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><line x1="12" y1="7.5" x2="12" y2="13"/><circle cx="12" cy="16.2" r="0.6"/></svg>',
};

// Retourne le markup d'une icône SF. Usage: icon('search') ou icon('star','bhi-star-fill')
function icon(name, extraClass) {
  const svg = BH_ICONS[name];
  if (!svg) return '';
  return `<span class="bhi${extraClass ? ' ' + extraClass : ''}" aria-hidden="true">${svg}</span>`;
}
// Exposé globalement pour les usages dans le HTML/inline
window.icon = icon;

// Remplace les <i class="fas fa-X"> statiques du HTML par les SVG SF,
// en préservant le style inline. Ignore le spinner (animation FA conservée).
const FA_TO_SF = {
  'fa-search':'search','fa-arrow-right':'arrow-right','fa-arrow-left':'arrow-left',
  'fa-shield-halved':'shield','fa-headset':'headset','fa-star':'star','fa-bolt':'bolt',
  'fa-comment-dots':'message','fa-book-open':'book','fa-user-plus':'user-plus',
  'fa-sign-in-alt':'sign-in','fa-lock':'lock','fa-calendar-check':'calendar-check',
  'fa-paper-plane':'send','fa-user':'user','fa-user-circle':'user','fa-key':'key',
  'fa-info-circle':'info','fa-location-dot':'location','fa-home':'home',
  'fa-bed':'bed','fa-bath':'bath','fa-users':'users','fa-moon':'moon','fa-wifi':'wifi',
  'fa-clock':'clock','fa-calendar':'calendar','fa-check':'check','fa-sign-out-alt':'sign-out',
  'fa-chevron-left':'chevron-left','fa-chevron-right':'chevron-right',
  'fa-exclamation-circle':'alert',
};
function bhReplaceIcons(root) {
  (root || document).querySelectorAll('i.fas').forEach(el => {
    if ([...el.classList].some(c => c === 'fa-spin' || c === 'fa-spinner')) return;
    const faCls = [...el.classList].find(c => FA_TO_SF[c]);
    if (!faCls) return;
    const svg = BH_ICONS[FA_TO_SF[faCls]];
    if (!svg) return;
    const span = document.createElement('span');
    span.className = 'bhi';
    span.setAttribute('aria-hidden', 'true');
    if (el.getAttribute('style')) span.setAttribute('style', el.getAttribute('style'));
    span.innerHTML = svg;
    el.replaceWith(span);
  });
}
window.bhReplaceIcons = bhReplaceIcons;

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
  profile: null, // { avatarUrl, birthDate, bio, profileComplete, isHost, ... }
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

// En-têtes autorisés pour les appels protégés
function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  const t = getSession()?.token;
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

// ══════════════════════════════════════════════════════════════
// 👤 PROFIL — photo, date de naissance (18 ans), description
// Obligatoire avant de réserver ou de publier un logement.
// ══════════════════════════════════════════════════════════════
let _pendingAvatarFile = null;
let _afterProfileAction = null; // callback à rejouer une fois le profil complet

async function fetchProfile() {
  if (!isLoggedIn()) return null;
  try {
    const res = await fetch(`${API_URL}/api/guest/profile`, { headers: authHeaders() });
    if (!res.ok) return null;
    state.profile = await res.json();
    renderAuthBar();
    return state.profile;
  } catch { return null; }
}

// Barre du haut : Se connecter / S'inscrire, ou avatar + prénom
function renderAuthBar() {
  const bar = document.getElementById('authBar');
  if (!bar) return;
  const session = getSession();
  if (!session) {
    bar.innerHTML = `
      <button class="authbar-btn ghost" onclick="openAuth('login')">Se connecter</button>
      <button class="authbar-btn solid" onclick="openAuth('register')">S'inscrire</button>`;
    return;
  }
  const p = state.profile || {};
  const initial = (p.name || session.name || session.email || '?').trim().charAt(0).toUpperCase();
  const avatar = p.avatarUrl
    ? `<img src="${p.avatarUrl}" alt="" class="authbar-avatar-img">`
    : `<span class="authbar-avatar-txt">${initial}</span>`;
  const warn = (p.profileComplete === false)
    ? `<span class="authbar-dot" title="Profil incomplet"></span>` : '';
  bar.innerHTML = `
    <button class="authbar-user" onclick="navTo('profile')">
      <span class="authbar-avatar">${avatar}${warn}</span>
      <span class="authbar-name">${(p.name || session.name || 'Mon compte').split(' ')[0]}</span>
    </button>`;
}

// Ouvre l'écran d'authentification sur le bon onglet
function openAuth(mode) {
  navTo('login');
  if (typeof switchSubMode === 'function') switchSubMode(mode === 'register' ? 'register' : 'login');
}

// Garde : exécute `action` seulement si connecté ET profil complet
async function requireProfile(action, reason) {
  if (!isLoggedIn()) {
    _afterProfileAction = action;
    showToast(reason || 'Connectez-vous pour continuer');
    openAuth('login');
    return false;
  }
  const p = state.profile || await fetchProfile();
  if (!p) { openAuth('login'); return false; }
  if (!p.profileComplete) {
    _afterProfileAction = action;
    showToast('Complétez votre profil pour continuer');
    navTo('profile');
    return false;
  }
  if (typeof action === 'function') action();
  return true;
}

// Remplit l'écran profil
async function loadProfileScreen() {
  const p = await fetchProfile();
  if (!p) { openAuth('login'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  set('profName', p.name);
  set('profPhone', p.phone);
  set('profBirth', p.birthDate);
  set('profBio', p.bio);

  const img = document.getElementById('profAvatarImg');
  const ph = document.getElementById('profAvatarPlaceholder');
  if (p.avatarUrl) { img.src = p.avatarUrl; img.style.display = 'block'; ph.style.display = 'none'; }
  else { img.style.display = 'none'; ph.style.display = 'flex'; }

  updateBioCounter();
  document.getElementById('profEmail').textContent = p.email;

  // Bandeau : ce qu'il manque
  const labels = { name: 'votre nom', avatar: 'une photo de profil', birthDate: 'votre date de naissance', age18: 'avoir 18 ans minimum', bio: `une description d'au moins ${p.minBioLength} caractères` };
  const banner = document.getElementById('profBanner');
  if (p.profileComplete) {
    banner.className = 'prof-banner ok';
    banner.innerHTML = `<i class="fas fa-circle-check"></i> Profil complet — vous pouvez réserver et publier.`;
  } else {
    banner.className = 'prof-banner warn';
    banner.innerHTML = `<i class="fas fa-triangle-exclamation"></i> Il manque : ${p.missing.map(m => labels[m] || m).join(', ')}.`;
  }

  // Bouton "devenir hôte"
  const hostBox = document.getElementById('profHostBox');
  if (hostBox) {
    hostBox.innerHTML = p.isHost
      ? `<button class="prof-host-btn" onclick="goHostDashboard()"><i class="fas fa-gauge-high"></i> Mon espace hôte</button>`
      : `<button class="prof-host-btn" onclick="becomeHost()"><i class="fas fa-house-chimney-window"></i> Devenir hôte</button>
         <div class="prof-host-hint">Publiez vos logements et recevez des réservations en direct.</div>`;
  }
}

function onAvatarPick(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) { showToast('Photo trop lourde (8 Mo max)'); e.target.value = ''; return; }
  _pendingAvatarFile = f;
  const img = document.getElementById('profAvatarImg');
  img.src = URL.createObjectURL(f);
  img.style.display = 'block';
  document.getElementById('profAvatarPlaceholder').style.display = 'none';
  e.target.value = '';
}

function updateBioCounter() {
  const ta = document.getElementById('profBio');
  const c = document.getElementById('profBioCounter');
  if (!ta || !c) return;
  const n = ta.value.trim().length;
  const min = state.profile?.minBioLength || 40;
  c.textContent = `${n} / 800 · minimum ${min}`;
  c.style.color = (n > 0 && n < min) ? 'var(--error, #DC2626)' : '';
}

async function saveProfile() {
  const btn = document.getElementById('btnSaveProfile');
  const err = document.getElementById('profError');
  const v = id => (document.getElementById(id)?.value || '').trim();
  err.textContent = '';

  const name = v('profName'), birth = v('profBirth'), bio = v('profBio');
  const min = state.profile?.minBioLength || 40;

  if (!name) { err.textContent = 'Votre nom est requis.'; return; }
  if (!birth) { err.textContent = 'Votre date de naissance est requise.'; return; }
  const age = Math.floor((Date.now() - new Date(birth)) / 31557600000);
  if (isNaN(age) || age < 18) { err.textContent = 'Vous devez avoir au moins 18 ans.'; return; }
  if (bio.length < min) { err.textContent = `La description doit faire au moins ${min} caractères.`; return; }
  if (!_pendingAvatarFile && !state.profile?.avatarUrl) { err.textContent = 'Une photo de profil est obligatoire.'; return; }

  const fd = new FormData();
  fd.append('name', name);
  fd.append('phone', v('profPhone'));
  fd.append('birthDate', birth);
  fd.append('bio', bio);
  if (_pendingAvatarFile) fd.append('avatar', _pendingAvatarFile);

  btn.disabled = true;
  const old = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';
  try {
    const res = await fetch(`${API_URL}/api/guest/profile`, {
      method: 'PUT', headers: authHeaders(), body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    _pendingAvatarFile = null;
    state.profile = data.profile;
    renderAuthBar();
    await loadProfileScreen();
    showToast('Profil enregistré');
    if (state.profile.profileComplete && _afterProfileAction) {
      const act = _afterProfileAction; _afterProfileAction = null;
      setTimeout(act, 400);
    }
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = old;
  }
}

async function becomeHost() {
  const p = state.profile || await fetchProfile();
  if (!p) { openAuth('login'); return; }
  if (!p.profileComplete) { showToast('Complétez votre profil d\'abord'); return; }
  if (!p.emailVerified) { showToast('Vérifiez votre email avant de devenir hôte'); return; }
  try {
    const res = await fetch(`${API_URL}/api/guest/become-host`, { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    localStorage.setItem('bh_host_token', data.token);
    localStorage.setItem('token', data.token); // compat pages hôte
    showToast('Espace hôte activé !');
    setTimeout(() => { location.href = 'host-dashboard.html'; }, 700);
  } catch (e) {
    showToast(e.message);
  }
}

function goHostDashboard() {
  becomeHost(); // idempotent : relie/rafraîchit le token puis redirige
}

// Point d'entrée "Devenir hôte" depuis l'accueil
function hostEntry() {
  if (!isLoggedIn()) {
    showToast('Créez votre compte pour devenir hôte');
    openAuth('register');
    return;
  }
  navTo('profile');
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
    btn.innerHTML = icon('send') + ' Recevoir mon lien';
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
    if (!res.ok) {
      // Email pas encore vérifié → proposer de renvoyer le lien
      if (data.emailNotVerified) {
        errBox.innerHTML = `${data.error}<br>
          <button onclick="resendVerification('${(data.email || email).replace(/'/g, "\\'")}')"
            style="margin-top:8px;background:none;border:1.5px solid currentColor;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;color:inherit;">
            Renvoyer l'email de vérification
          </button>`;
        errBox.style.display = 'block';
        return;
      }
      throw new Error(data.error);
    }
    saveSession({ token: data.session_token, email: data.email, name: data.name });
    updateNavAccount();
    showToast('Connexion réussie !');
    setTimeout(() => { window.location.replace(window.location.pathname); }, 800);
  } catch(e) {
    errBox.textContent = e.message || 'Erreur de connexion';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false; btn.innerHTML = icon('sign-in') + ' Se connecter';
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
    btn.disabled = false; btn.innerHTML = icon('user-plus') + ' Créer mon compte';
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

// ── Formulaire "nouveau mot de passe" (après lien de reset) ──
function showResetForm() {
  const card = document.querySelector('#screen-login .auth-card');
  if (!card) return;
  // Masquer les onglets et formulaires habituels
  card.querySelectorAll(':scope > *').forEach(el => { el.style.display = 'none'; });
  let f = document.getElementById('resetForm');
  if (!f) {
    f = document.createElement('div');
    f.id = 'resetForm';
    f.innerHTML = `
      <div style="font-size:17px;font-weight:700;color:var(--ink);margin-bottom:4px;">Nouveau mot de passe</div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">Choisissez un nouveau mot de passe pour votre compte.</div>
      <div class="auth-field"><input type="password" id="resetPwd1" placeholder="Nouveau mot de passe (6 caractères min.)" autocomplete="new-password"></div>
      <div class="auth-field"><input type="password" id="resetPwd2" placeholder="Confirmez le mot de passe" autocomplete="new-password"></div>
      <div id="resetErr" style="color:#DC2626;font-size:13px;min-height:18px;margin-top:6px;"></div>
      <button class="auth-btn" id="resetBtn" onclick="submitNewPassword()">Enregistrer</button>`;
    card.appendChild(f);
  }
  f.style.display = 'block';
}

async function submitNewPassword() {
  const p1 = document.getElementById('resetPwd1')?.value || '';
  const p2 = document.getElementById('resetPwd2')?.value || '';
  const err = document.getElementById('resetErr');
  err.textContent = '';
  if (p1.length < 6) { err.textContent = 'Au moins 6 caractères.'; return; }
  if (p1 !== p2) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
  const btn = document.getElementById('resetBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/api/guest/auth/reset-password`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password: p1 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    showToast('Mot de passe enregistré !');
    setTimeout(() => { window.location.replace(window.location.pathname); }, 800);
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}

async function verifyMagicToken(token, opts) {
  const noReload = opts && opts.noReload;
  try {
    const res = await fetch(`${API_URL}/api/guest/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    saveSession({ token: data.session_token, email: data.email, name: data.name });
    state.session = getSession();
    updateNavAccount();
    if (!noReload) {
      showToast('Connexion réussie !');
      // Nettoyer l'URL et recharger pour appliquer la session
      setTimeout(() => {
        window.location.replace(window.location.pathname);
      }, 1000);
    }
    return true;
  } catch (e) {
    showToast(e.message || 'Lien invalide ou expiré');
    return false;
  }
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  bhReplaceIcons(); // Remplace les icônes FA statiques par les SVG SF
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

  // ⭐ Lien "laisser un avis" (review_token dans URL)
  const reviewToken = urlParamsInit.get('review_token');
  if (reviewToken) {
    window.history.replaceState({}, '', window.location.pathname);
    openReviewForm(reviewToken);
  }

  // 🔑 Lien magique / réinitialisation de mot de passe (magic_token dans URL)
  const magicToken = urlParamsInit.get('magic_token');
  const isReset = urlParamsInit.get('reset') === '1';
  if (magicToken) {
    const ok = await verifyMagicToken(magicToken, { noReload: isReset });
    window.history.replaceState({}, '', window.location.pathname);
    if (ok && isReset) {
      openAuth('login');
      showResetForm();
    } else if (ok) {
      showToast('Connexion réussie !');
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

  await loadFavorites();
  await loadProperties();
  loadFeaturedProperties();

  // 👤 Profil : charger et inviter à le compléter après connexion.
  // On ne détourne PAS l'utilisateur s'il arrive par un lien personnalisé.
  renderAuthBar();
  {
    const dl = new URLSearchParams(window.location.search);
    const viaLink = dl.has('property') || dl.has('hold_token') || dl.has('fixed_price');
    if (isLoggedIn()) {
      const p = await fetchProfile();
      if (p && !p.profileComplete && !viaLink) {
        showToast('Complétez votre profil pour réserver');
        navTo('profile');
      }
    }
  }

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
  // Barre d'authentification (accueil)
  renderAuthBar();
  if (name === 'profile') loadProfileScreen();
  // 🔧 Arrivée sur la liste : recharger les logements puis appliquer les filtres
  // (catégorie, ville, recherche texte) sélectionnés depuis l'accueil.
  if (name === 'home-list') {
    syncFilterChips();
    renderSearchActive();
    loadFavorites().then(() => loadProperties()).then(() => filterProperties());
  }
}

// Répercute _activeFilter / recherche accueil sur les contrôles de l'écran liste
function syncFilterChips() {
  document.querySelectorAll('.filter-chip').forEach(c => {
    const m = (c.getAttribute('onclick') || '').match(/setFilter\(this,\s*'([^']*)'\)/);
    c.classList.toggle('active', m ? m[1] === _activeFilter : false);
  });
  const li = document.getElementById('listSearchInput');
  if (li && _homeQuery) { li.value = _homeQuery; _homeQuery = ''; }
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
    var navTargetIdx = -1; // onglet cible verrouillé pendant la navigation (évite l'aller-retour)

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
      var ts = tabsOf(bar);
      // Pendant une navigation : on garde la capsule sur l'onglet cible.
      // La classe .active est encore sur l'ancien onglet (le clic de nav
      // n'a pas encore eu lieu) → sans ce verrou, la capsule rebondirait.
      if (navTargetIdx >= 0 && navTargetIdx < ts.length) {
        var act = activeIndex(ts);
        // Une fois que .active a rejoint la cible, on libère le verrou.
        if (act === navTargetIdx) navTargetIdx = -1;
        else { settle(navTargetIdx, animate); return; }
      }
      settle(activeIndex(ts), animate);
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
      // Verrouiller la cible AVANT settle : le markActive() de settle déclenche
      // le MutationObserver → sync ; sans ce verrou il repartirait sur l'ancien
      // onglet (dont .active n'a pas encore bougé) d'où l'aller-retour.
      if (target !== startIdx) navTargetIdx = target;
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
      <div style="text-align:center;padding:60px 24px;">
        <div style="width:60px;height:60px;border-radius:50%;background:var(--primary-tint);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--primary);">${icon('message')}</div>
        <div style="font-family:'Instrument Serif',serif;font-size:22px;color:var(--ink);margin-bottom:6px;">Vos messages</div>
        <div style="font-size:14px;color:var(--text2);margin-bottom:22px;">Connectez-vous pour retrouver vos echanges avec vos hotes.</div>
        <button onclick="navTo('login')" style="padding:14px 28px;background:var(--primary);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Se connecter</button>
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
      list.innerHTML = `<div style="text-align:center;padding:60px 24px;">
        <div style="width:60px;height:60px;border-radius:50%;background:var(--primary-tint);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:var(--primary);">${icon('message')}</div>
        <div style="font-family:'Instrument Serif',serif;font-size:22px;color:var(--ink);margin-bottom:6px;">Aucun message</div>
        <div style="font-size:14px;color:var(--text2);">Vos échanges avec vos hôtes apparaîtront ici.</div>
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
        style="background:#fff;border-radius:16px;padding:14px 16px;margin-bottom:10px;cursor:pointer;border:1px solid var(--line);${unread ? 'border-left:3px solid var(--primary);' : ''}display:flex;align-items:center;gap:13px;">
        <div style="width:46px;height:46px;border-radius:50%;background:var(--primary-tint);color:var(--primary-dark);display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:600;font-family:'Instrument Serif',serif;flex-shrink:0;">
          ${propName.charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
            <span style="font-size:15px;font-weight:${unread?'700':'600'};color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;">${propName}</span>
            <span style="font-size:11px;color:var(--stone-light);flex-shrink:0;">${dateStr}</span>
          </div>
          ${checkin ? `<div style="font-size:11px;color:var(--primary);font-weight:600;margin-bottom:3px;">${checkin} → ${checkout}</div>` : ''}
          <div style="font-size:13.5px;color:${unread?'var(--ink)':'var(--text2)'};font-weight:${unread?'500':'400'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${lastMsg}</div>
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
    <div style="background:${isGuest?'var(--primary)':'#fff'};color:${isGuest?'#fff':'var(--ink)'};padding:11px 15px;border-radius:${isGuest?'18px 18px 5px 18px':'18px 18px 18px 5px'};font-size:14.5px;line-height:1.5;border:${isGuest?'none':'1px solid var(--line)'};word-wrap:break-word;">
      ${msg.message.replace(/\n/g,'<br>')}
    </div>
    <div style="font-size:11px;color:var(--stone-light);margin-top:4px;${isGuest?'text-align:right':''}">${time}</div>`;
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
  if (!rating) return '';
  const on5 = Math.round((rating / 2) * 2) / 2; // note /10 → /5, demi-étoiles
  const full = Math.floor(on5);
  const half = on5 % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  const stars = icon('star','bhi-star-fill').repeat(full)
    + (half ? icon('star') : '')
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

// Échappement pour les attributs HTML (data-*)
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
let _homeQuery = '';

function filterCat(el, cat) {
  document.querySelectorAll('.home-cat').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _activeFilter = cat;
  navTo('home-list'); // navTo recharge la liste puis applique le filtre
}

function setFilter(el, filter) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  _activeFilter = filter;
  filterProperties();
}

// Recherche depuis l'accueil (barre "Destination, dates...")
function homeSearch() {
  _homeQuery = (document.getElementById('homeSearchInput')?.value || '').trim();
  navTo('home-list');
}

function filterProperties() {
  const grid = document.getElementById('propertiesList');
  if (!grid) return;
  const search = (document.getElementById('listSearchInput')?.value || '').trim().toLowerCase();
  const cityFilter = (state.search.city || '').toLowerCase();
  const cards = [...grid.querySelectorAll('.prop-card')];
  let visible = 0;

  cards.forEach(card => {
    const hay = (card.dataset.search || '').toLowerCase();
    const type = (card.dataset.type || '').toLowerCase();
    const cardCity = (card.dataset.city || '').toLowerCase();
    const matchSearch = !search || search.split(/\s+/).every(w => hay.includes(w));
    const matchFilter = !_activeFilter
      || _activeFilter.startsWith('prix')
      || (_activeFilter === '__favs' ? state.favorites.has(card.dataset.id) : type.includes(_activeFilter));
    const matchCity = !cityFilter || cardCity.includes(cityFilter);
    const ok = matchSearch && matchFilter && matchCity;
    card.style.display = ok ? 'block' : 'none';
    if (ok) visible++;
  });

  // Tri par prix
  if (_activeFilter === 'prix-asc' || _activeFilter === 'prix-desc') {
    const dir = _activeFilter === 'prix-asc' ? 1 : -1;
    [...cards]
      .sort((a, b) => (parseFloat(a.dataset.price) - parseFloat(b.dataset.price)) * dir)
      .forEach(c => grid.appendChild(c));
  }

  // Message si aucun résultat
  let empty = document.getElementById('listNoResult');
  if (!visible && cards.length) {
    if (!empty) {
      empty = document.createElement('div');
      empty.id = 'listNoResult';
      empty.className = 'empty-state';
      grid.appendChild(empty);
    }
    empty.innerHTML = _activeFilter === '__favs'
      ? `${icon('home')}<p>Aucun favori pour l'instant.<br>Touchez le ❤ d'un logement pour le retrouver ici.</p>`
      : `${icon('home')}<p>Aucun logement ne correspond à cette recherche</p>`;
    empty.style.display = 'block';
  } else if (empty) {
    empty.style.display = 'none';
  }
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
          <div class="home-card-stars" id="stars-home-${p.id}"></div>
          <div class="home-card-name">${p.name}</div>
          <div class="home-card-loc">${icon('location')}${p.city || 'France'}</div>
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

// ══ 🗓️ Recherche par dates + voyageurs ═══════════════════════
let _spGuests = 2;

function toggleSearchPanel() {
  const p = document.getElementById('searchPanel');
  const open = p.style.display !== 'none';
  p.style.display = open ? 'none' : 'block';
  if (!open) {
    // Pré-remplir avec la recherche active + bornes de dates cohérentes
    const today = new Date().toISOString().slice(0, 10);
    const ci = document.getElementById('spCheckin'), co = document.getElementById('spCheckout');
    ci.min = today;
    ci.value = state.search.checkin || '';
    co.value = state.search.checkout || '';
    co.min = ci.value || today;
    ci.onchange = () => { co.min = ci.value; if (co.value && co.value <= ci.value) co.value = ''; };
    _spGuests = state.search.guests || 2;
    document.getElementById('spGuestsN').textContent = _spGuests;
  }
}

function spGuests(d) {
  _spGuests = Math.max(1, Math.min(16, _spGuests + d));
  document.getElementById('spGuestsN').textContent = _spGuests;
}

async function applySearchPanel() {
  const ci = document.getElementById('spCheckin').value;
  const co = document.getElementById('spCheckout').value;
  if ((ci && !co) || (!ci && co)) { showToast('Choisissez arrivée ET départ'); return; }
  if (ci && co && co <= ci) { showToast('Le départ doit suivre l\'arrivée'); return; }
  state.search.checkin = ci || null;
  state.search.checkout = co || null;
  state.search.guests = _spGuests;
  document.getElementById('searchPanel').style.display = 'none';
  renderSearchActive();
  await loadProperties();
  filterProperties();
}

async function clearSearchPanel() {
  state.search.checkin = null;
  state.search.checkout = null;
  state.search.guests = null;
  document.getElementById('spCheckin').value = '';
  document.getElementById('spCheckout').value = '';
  _spGuests = 2;
  document.getElementById('spGuestsN').textContent = 2;
  document.getElementById('searchPanel').style.display = 'none';
  renderSearchActive();
  await loadProperties();
  filterProperties();
}

// Bandeau "12 août → 15 août · 4 voyageurs ✕" + état du bouton Dates
function renderSearchActive() {
  const el = document.getElementById('searchActive');
  const btn = document.getElementById('datesBtn');
  const lbl = document.getElementById('datesBtnLabel');
  if (!el) return;
  const { checkin, checkout, guests } = state.search;
  const hasDates = checkin && checkout;
  if (!hasDates && !guests) {
    el.style.display = 'none';
    if (btn) btn.classList.remove('on');
    if (lbl) lbl.textContent = 'Dates';
    return;
  }
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const parts = [];
  if (hasDates) parts.push(`${fmt(checkin)} → ${fmt(checkout)}`);
  if (guests) parts.push(`${guests} voyageur${guests > 1 ? 's' : ''}`);
  el.innerHTML = `<i class="fas fa-calendar-check"></i> ${parts.join(' · ')}
    <button onclick="clearSearchPanel()" title="Effacer"><i class="fas fa-xmark"></i></button>`;
  el.style.display = 'flex';
  if (btn) btn.classList.add('on');
  if (lbl) lbl.textContent = hasDates ? fmt(checkin) : 'Dates';
}

// ══ ❤️ Favoris ═══════════════════════════════════════════════
state.favorites = new Set();

async function loadFavorites() {
  if (!isLoggedIn()) { state.favorites = new Set(); return; }
  try {
    const res = await fetch(`${API_URL}/api/guest/favorites`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    state.favorites = new Set(data.ids || []);
  } catch {}
}

async function toggleFavorite(ev, propertyId) {
  ev.stopPropagation(); // ne pas ouvrir la fiche
  if (!isLoggedIn()) {
    showToast('Connectez-vous pour enregistrer vos favoris');
    openAuth('login');
    return;
  }
  // Optimiste : on bascule tout de suite, on annule si le serveur refuse
  const btn = ev.currentTarget;
  const was = state.favorites.has(propertyId);
  if (was) state.favorites.delete(propertyId); else state.favorites.add(propertyId);
  btn.classList.toggle('on', !was);
  try {
    const res = await fetch(`${API_URL}/api/guest/favorites/${propertyId}`, {
      method: 'POST', headers: authHeaders()
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    btn.classList.toggle('on', data.favorited);
    if (data.favorited) state.favorites.add(propertyId); else state.favorites.delete(propertyId);
    // Si le filtre Favoris est actif, retirer la carte décochée
    if (_activeFilter === '__favs') filterProperties();
  } catch {
    if (was) state.favorites.add(propertyId); else state.favorites.delete(propertyId);
    btn.classList.toggle('on', was);
    showToast('Erreur, réessayez');
  }
}

// Libellé lisible d'un type de logement
function typeLabel(t) {
  const M = { appartement: 'Appartement', maison: 'Maison', studio: 'Studio', villa: 'Villa', autre: null };
  return t ? (M[String(t).toLowerCase()] !== undefined ? M[String(t).toLowerCase()] : t) : null;
}

async function loadProperties() {
  const grid = document.getElementById('propertiesList');
  // Squelettes : la page garde sa structure pendant le chargement
  grid.innerHTML = Array.from({length: 4}, () => `
    <div class="prop-skel">
      <div class="prop-skel-img"></div>
      <div class="prop-skel-body">
        <div class="prop-skel-line" style="width:70%"></div>
        <div class="prop-skel-line" style="width:45%"></div>
        <div class="prop-skel-line" style="width:55%;margin-top:10px;"></div>
      </div>
    </div>`).join('');

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
      grid.innerHTML = `<div class="empty-state">${icon('home')}<p>Aucun logement disponible pour ces critères</p></div>`;
      return;
    }

    grid.innerHTML = state.properties.map(p => `
      <div class="prop-card"
           data-name="${esc((p.name||'').toLowerCase())}"
           data-type="${esc(((p.propertyType||'') + ' ' + (p.description||'')).toLowerCase())}"
           data-city="${esc(((p.city||'') + ' ' + (p.address||'') + ' ' + (p.postalCode||'')).toLowerCase())}"
           data-price="${parseFloat(p.basePrice) || 0}"
           data-id="${p.id}"
           data-search="${esc([p.name, p.city, p.address, p.postalCode, p.propertyType].filter(Boolean).join(' ').toLowerCase())}"
           onclick="openProperty('${p.id}')">
        <div class="prop-card-img" style="${p.photoUrl ? 'padding:0;background:none;' : ''}">
          ${p.photoUrl
            ? `<img src="${p.photoUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">`
            : icon('home')}
          <span class="prop-card-badge">Réservation directe</span>
          <button class="prop-card-fav ${state.favorites.has(p.id) ? 'on' : ''}" onclick="toggleFavorite(event, '${p.id}')" title="Favori"><i class="fas fa-heart"></i></button>
        </div>
        <div class="prop-card-body">
          <div class="prop-card-head">
            <div class="prop-card-name">${esc(p.name)}</div>
            ${p.reviewsAvg ? `<div class="prop-card-rating"><i class="fas fa-star"></i>${p.reviewsAvg}${p.reviewsCount > 1 ? ` <span>(${p.reviewsCount})</span>` : ''}</div>` : ''}
          </div>
          <div class="prop-card-loc">${icon('location')}${esc([typeLabel(p.propertyType), p.city || p.address || 'France'].filter(Boolean).join(' · '))}</div>
          <div class="prop-card-features">
            ${p.bedrooms ? `<div class="prop-card-feat">${icon('bed')}${p.bedrooms} ch.</div>` : ''}
            ${p.maxGuests ? `<div class="prop-card-feat">${icon('user')}${p.maxGuests} pers.</div>` : ''}
            ${p.bathrooms ? `<div class="prop-card-feat">${icon('bath')}${p.bathrooms} sdb</div>` : ''}
          </div>
          <div class="prop-card-footer">
            <div>
              ${p.basePrice ? `<span class="prop-card-price-des">dès</span> <span class="prop-card-price-main">${p.basePrice}€</span><span class="prop-card-price-night">/ nuit</span>` : `<span class="prop-card-price-main">—</span>`}
            </div>
            <button class="prop-card-btn">Réserver</button>
          </div>
        </div>
      </div>
    `).join('');
    // Apparition en cascade (fondu + montée décalée)
    requestAnimationFrame(() => {
      grid.querySelectorAll('.prop-card').forEach((card, i) => {
        setTimeout(() => card.classList.add('card-in'), i * 60);
      });
    });
    // Charger les vraies notes Channex en arrière-plan
    state.properties.forEach(async p => {
      const r = await fetchPropertyRating(p.id);
      const el = document.getElementById(`stars-list-${p.id}`);
      if (el) el.innerHTML = renderStars(r?.avg || null);
    });

  } catch (e) {
    grid.innerHTML = `<div class="empty-state">${icon('wifi')}<p>Impossible de charger les logements</p></div>`;
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

    // Reset sélection dates (préremplie depuis la recherche si présente)
    state.selectedCheckin = state.search.checkin || null;
    state.selectedCheckout = state.search.checkout || null;
    // Les deux dates préremplies → un tap recommence une sélection propre
    state.selectingEnd = (state.selectedCheckin && !state.selectedCheckout) ? true : null;

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
    document.getElementById('detailContent').innerHTML = `<div class="empty-state">${icon('alert')}<p>${e.message}</p></div>`;
  }
}

function updateGalleryDot(el) {
  const w = el.clientWidth;
  const idx = Math.round(el.scrollLeft / w) + 1;
  const dot = document.getElementById('galleryIdx');
  if (dot) dot.textContent = idx;
}

// ══ ⭐ Avis : formulaire (via lien email) ══════════════════════
let _reviewToken = null, _reviewRating = 0;

async function openReviewForm(token) {
  _reviewToken = token; _reviewRating = 0;
  let ctx = null;
  try {
    const res = await fetch(`${API_URL}/api/guest/reviews/context/${token}`);
    ctx = await res.json();
    if (!res.ok) throw new Error(ctx.error || 'Lien invalide');
  } catch(e) { showToast(e.message || 'Lien invalide ou expiré'); return; }

  if (ctx.alreadySubmitted) { showToast('Vous avez déjà laissé un avis pour ce séjour. Merci !'); return; }

  const overlay = document.createElement('div');
  overlay.id = 'reviewOverlay';
  overlay.innerHTML = `
    <div class="review-sheet">
      <div class="review-head">
        <div class="review-title">Votre séjour à<br><b>${esc(ctx.propertyName)}</b></div>
        <button class="review-close" onclick="closeReviewForm()"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="review-stars" id="reviewStars">
        ${[1,2,3,4,5].map(n => `<button class="review-star" data-n="${n}" onclick="setReviewRating(${n})"><i class="fas fa-star"></i></button>`).join('')}
      </div>
      <div class="review-stars-label" id="reviewStarsLabel">Touchez une étoile</div>
      <textarea id="reviewComment" class="review-comment" maxlength="1000" placeholder="Racontez votre séjour (optionnel) : accueil, logement, quartier..."></textarea>
      <div class="review-err" id="reviewErr"></div>
      <button class="review-submit" id="reviewSubmitBtn" onclick="submitReview()">Publier mon avis</button>
    </div>`;
  document.body.appendChild(overlay);
}

function setReviewRating(n) {
  _reviewRating = n;
  document.querySelectorAll('#reviewStars .review-star').forEach(b => {
    b.classList.toggle('on', parseInt(b.dataset.n, 10) <= n);
  });
  const labels = ['', 'Décevant', 'Moyen', 'Bien', 'Très bien', 'Excellent !'];
  document.getElementById('reviewStarsLabel').textContent = labels[n];
}

async function submitReview() {
  const err = document.getElementById('reviewErr');
  err.textContent = '';
  if (!_reviewRating) { err.textContent = 'Choisissez une note.'; return; }
  const btn = document.getElementById('reviewSubmitBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/api/guest/reviews/submit/${_reviewToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: _reviewRating, comment: document.getElementById('reviewComment').value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    closeReviewForm();
    showToast('Merci pour votre avis ! ⭐');
  } catch(e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}

function closeReviewForm() {
  document.getElementById('reviewOverlay')?.remove();
  _reviewToken = null;
}

// ── Section avis sur la fiche logement ───────────────────────
function renderReviewsSection(p) {
  if (!Array.isArray(p.reviews) || !p.reviews.length) return '';
  const stars = n => Array.from({length:5}, (_, i) =>
    `<i class="fas fa-star" style="color:${i < n ? 'var(--primary)' : '#E7E1D8'};font-size:12px;"></i>`).join('');
  const fmtM = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { month:'long', year:'numeric' }) : '';
  const items = p.reviews.slice(0, 6).map(r => `
    <div class="review-item">
      <div class="review-item-head">
        <div class="review-item-avatar">${esc((r.guestName || 'V').charAt(0).toUpperCase())}</div>
        <div>
          <div class="review-item-name">${esc(r.guestName)}</div>
          <div class="review-item-date">${fmtM(r.date)}</div>
        </div>
        <div class="review-item-stars">${stars(r.rating)}</div>
      </div>
      ${r.comment ? `<div class="review-item-text">${esc(r.comment)}</div>` : ''}
    </div>`).join('');
  return `
    <div class="detail-sec-t">
      <i class="fas fa-star" style="color:var(--primary);"></i>
      ${p.reviewsAvg} · ${p.reviewsCount} avis
    </div>
    <div class="reviews-list">${items}</div>
    ${p.reviews.length > 6 ? `<div class="reviews-more">${p.reviews.length - 6} autres avis non affichés</div>` : ''}`;
}

// ══ 🖼️ Galerie plein écran ═══════════════════════════════════
let _lbPhotos = [], _lbIdx = 0;

function openLightbox(startIdx) {
  const p = state.currentProperty;
  _lbPhotos = (Array.isArray(p?.photos) && p.photos.length) ? p.photos : (p?.photoUrl ? [p.photoUrl] : []);
  if (!_lbPhotos.length) return;
  _lbIdx = Math.max(0, Math.min(startIdx || 0, _lbPhotos.length - 1));

  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `
    <div class="lb-top">
      <div class="lb-count"><span id="lbIdx">${_lbIdx + 1}</span> / ${_lbPhotos.length}</div>
      <button class="lb-close" onclick="closeLightbox()"><i class="fas fa-xmark"></i></button>
    </div>
    <div class="lb-scroll" id="lbScroll" onscroll="lbOnScroll(this)">
      ${_lbPhotos.map(ph => `<div class="lb-slide"><img src="${ph}" alt="" draggable="false"></div>`).join('')}
    </div>`;
  document.body.appendChild(lb);
  document.body.style.overflow = 'hidden';
  // Positionner sur la photo tapée, sans animation
  const sc = document.getElementById('lbScroll');
  sc.scrollLeft = _lbIdx * sc.clientWidth;
  // Fermer d'un geste vers le bas ou par Échap
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', lbOnKey);
}

function lbOnScroll(el) {
  const i = Math.round(el.scrollLeft / el.clientWidth);
  if (i !== _lbIdx) { _lbIdx = i; const c = document.getElementById('lbIdx'); if (c) c.textContent = i + 1; }
}

function lbOnKey(e) {
  if (e.key === 'Escape') closeLightbox();
  const sc = document.getElementById('lbScroll');
  if (!sc) return;
  if (e.key === 'ArrowRight') sc.scrollBy({ left: sc.clientWidth, behavior: 'smooth' });
  if (e.key === 'ArrowLeft') sc.scrollBy({ left: -sc.clientWidth, behavior: 'smooth' });
}

function closeLightbox() {
  document.getElementById('lightbox')?.remove();
  document.body.style.overflow = '';
  document.removeEventListener('keydown', lbOnKey);
}

// ── Carte "Votre hôte" sur la fiche logement ─────────────────
function renderHostCard(p) {
  const h = p.host;
  if (!h) return '';
  const first = esc(h.firstName || 'Votre hôte');
  const initial = first.trim().charAt(0).toUpperCase() || 'H';

  // Ancienneté : "Hôte depuis 2024" (l'année suffit, un mois précis fait fiche administrative)
  let sinceTxt = '';
  if (h.since) {
    const y = new Date(h.since).getFullYear();
    if (y && !isNaN(y)) sinceTxt = `Hôte depuis ${y}`;
  }

  const meta = [sinceTxt, h.listingsCount > 1 ? `${h.listingsCount} logements` : null]
    .filter(Boolean).join(' · ');

  // Bio tronquée à ~150 caractères, dépliable
  let bioHtml = '';
  if (h.bio) {
    const bio = esc(h.bio);
    if (bio.length > 150) {
      bioHtml = `<div class="host-bio" id="hostBio" data-full="${bio}">${bio.slice(0, 150)}…
        <button class="host-bio-more" onclick="expandHostBio(event)">Lire plus</button></div>`;
    } else {
      bioHtml = `<div class="host-bio">${bio}</div>`;
    }
  }

  const avatar = h.avatarUrl
    ? `<img src="${esc(h.avatarUrl)}" alt="${first}" class="host-avatar-img" loading="lazy">`
    : `<div class="host-avatar-txt">${initial}</div>`;

  return `
    <div class="detail-sec-t">Votre hôte</div>
    <div class="host-card">
      <div class="host-card-top">
        <div class="host-avatar">${avatar}</div>
        <div class="host-id">
          <div class="host-name">${first}</div>
          ${meta ? `<div class="host-meta">${meta}</div>` : ''}
        </div>
        <div class="host-badge"><i class="fas fa-circle-check"></i> Profil vérifié</div>
      </div>
      ${bioHtml}
      <div class="host-note"><i class="fas fa-comments"></i> Vous échangerez directement avec ${first}, sans intermédiaire.</div>
    </div>`;
}

function expandHostBio(e) {
  e.stopPropagation();
  const el = document.getElementById('hostBio');
  if (el) el.innerHTML = el.dataset.full;
}

function renderDetail() {
  const p = state.currentProperty;

  // Helpers tolérants camelCase / snake_case
  const g = (obj, ...keys) => { for (const k of keys) { if (obj && obj[k] != null) return obj[k]; } return null; };
  const photo = g(p, 'photoUrl', 'photo_url');
  const desc = g(p, 'description');
  const amen = g(p, 'amenities') || {};
  const rules = g(p, 'houseRules', 'house_rules') || {};
  const basketOn = g(p, 'welcomeBasketEnabled', 'welcome_basket_enabled');
  const basketPrice = g(p, 'welcomeBasketPrice', 'welcome_basket_price');
  const basketDesc = g(p, 'welcomeBasketDescription', 'welcome_basket_description');
  const city = g(p, 'city') || g(p, 'address') || 'France';
  const photos = (Array.isArray(p.photos) && p.photos.length) ? p.photos : (photo ? [photo] : []);
  const highlights = g(p, 'highlights');
  const goodToKnow = g(p, 'goodToKnow', 'good_to_know');
  const surface = g(p, 'surface');
  const propertyType = g(p, 'propertyType', 'property_type');

  // ── Équipements (uniquement ceux à true) + custom ──
  const AMEN_MAP = {
    cuisine_equipee: { label: 'Cuisine équipée', fa: 'fa-kitchen-set' },
    parking:         { label: 'Parking',          fa: 'fa-car' },
    television:      { label: 'Télévision',        fa: 'fa-tv' },
    climatisation:   { label: 'Climatisation',     fa: 'fa-snowflake' },
    lave_linge:      { label: 'Lave-linge',        fa: 'fa-jug-detergent' },
    lave_vaisselle:  { label: 'Lave-vaisselle',    fa: 'fa-sink' },
    draps:           { label: 'Draps fournis',     fa: 'fa-bed' },
    serviettes:      { label: 'Serviettes',        fa: 'fa-bath' },
  };
  let amenItems = [];
  Object.keys(AMEN_MAP).forEach(k => { if (amen[k] === true) amenItems.push(`<div class="detail-amen-i"><i class="fas ${AMEN_MAP[k].fa}"></i>${AMEN_MAP[k].label}</div>`); });
  if (Array.isArray(amen.custom)) amen.custom.forEach(c => { const t = (typeof c === 'string' ? c : (c && c.label)); if (t) amenItems.push(`<div class="detail-amen-i"><i class="fas fa-check"></i>${t}</div>`); });

  // ── Règles ──
  const RULE_MAP = {
    animaux: 'Animaux acceptés',
    enfants: 'Enfants bienvenus',
    fetes:   'Fêtes autorisées',
    fumeurs: 'Fumeurs autorisés',
  };
  let ruleItems = Object.keys(RULE_MAP).map(k => {
    const yes = rules[k] === true;
    return `<div class="detail-rule ${yes ? 'yes' : 'no'}"><span class="ricon"><i class="fas ${yes ? 'fa-check' : 'fa-xmark'}"></i></span>${RULE_MAP[k]}</div>`;
  }).join('');

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-gallery">
      ${photos.length
        ? `<div class="detail-gallery-scroll" id="galleryScroll" onscroll="updateGalleryDot(this)">${photos.map((ph,i)=>`<img src="${ph}" alt="${esc(p.name)}" loading="lazy" onclick="openLightbox(${i})">`).join('')}</div>
           ${photos.length>1 ? `<div class="detail-gallery-count"><span id="galleryIdx">1</span>/${photos.length}</div>` : ''}`
        : `<div class="no-photo">${icon('home')}</div>`}
      <div class="detail-gtop">
        <button class="detail-gbtn" onclick="navTo('home-list')">${icon('arrow-left')}</button>
      </div>
    </div>

    <div class="detail-body">
      <span class="detail-tag">Réservation directe</span>
      <div class="detail-name">${p.name}</div>
      <div class="detail-loc">${icon('location')} ${city}</div>

      <div class="detail-feats">
        ${p.bedrooms ? `<div class="detail-feat">${icon('bed')}<b>${p.bedrooms}</b><span>chambre${p.bedrooms>1?'s':''}</span></div>` : ''}
        ${p.maxGuests ? `<div class="detail-feat">${icon('users')}<b>${p.maxGuests}</b><span>voyageurs</span></div>` : ''}
        ${p.beds ? `<div class="detail-feat">${icon('moon')}<b>${p.beds}</b><span>lit${p.beds>1?'s':''}</span></div>` : ''}
        ${p.bathrooms ? `<div class="detail-feat">${icon('bath')}<b>${p.bathrooms}</b><span>sdb</span></div>` : ''}
      </div>

      ${desc ? `<div class="detail-sec-t">Le logement</div><div class="detail-desc">${desc}</div>` : ''}

      ${renderHostCard(p)}

      ${highlights ? `<div class="detail-sec-t">Les plus</div><div class="detail-desc">${highlights}</div>` : ''}

      ${goodToKnow ? `<div class="detail-sec-t">À savoir</div><div class="detail-desc">${goodToKnow}</div>` : ''}

      ${amenItems.length ? `<div class="detail-sec-t">Équipements</div><div class="detail-amen">${amenItems.join('')}</div>` : ''}

      ${basketOn ? `
        <div class="detail-basket">
          <div class="bicon"><i class="fas fa-basket-shopping"></i></div>
          <div style="flex:1">
            <div class="bt">Panier d'accueil</div>
            <div class="bd">${basketDesc || 'Un petit plus à votre arrivée pour bien démarrer le séjour.'}</div>
          </div>
          ${basketPrice ? `<div class="bp">+${basketPrice}€</div>` : ''}
        </div>` : ''}

      ${renderReviewsSection(p)}

      <div class="detail-sec-t">Règlement intérieur</div>
      <div class="detail-rules">${ruleItems}</div>

      <div class="detail-sec-t">Vos dates</div>
      <div id="calendarContainer"></div>

      ${p.arrivalTime || p.departureTime ? `
      <div class="detail-sec-t">Horaires</div>
      <div style="display:flex; gap:24px; background:#fff; border:1px solid var(--line); border-radius:14px; padding:14px 16px; margin-bottom:16px;">
        ${p.arrivalTime ? `<div><div style="font-size:12px;color:var(--text2);">Arrivée</div><div style="font-size:15px;font-weight:600;">${p.arrivalTime}</div></div>` : ''}
        ${p.departureTime ? `<div><div style="font-size:12px;color:var(--text2);">Départ</div><div style="font-size:15px;font-weight:600;">${p.departureTime}</div></div>` : ''}
      </div>` : ''}

      <div style="height:20px;"></div>
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
    <div class="detail-cal-card">
      <div class="calendar-nav">
        <button onclick="calNav(-1)">${icon('chevron-left')}</button>
        <h4>${monthName}</h4>
        <button onclick="calNav(1)">${icon('chevron-right')}</button>
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
  const night = document.querySelector('.booking-bar-night');

  if (state.selectedCheckin && state.selectedCheckout) {
    const nights = Math.round((new Date(state.selectedCheckout) - new Date(state.selectedCheckin)) / 86400000);
    const total = sumNights(p, state.selectedCheckin, state.selectedCheckout);
    if (bar) bar.textContent = `${total}€`;
    if (night) night.textContent = `· ${nights} nuit${nights > 1 ? 's' : ''}`;
  } else {
    if (bar) bar.textContent = `${p.basePrice}€`;
    if (night) night.textContent = '/ nuit';
  }
}

// ── Checkout ─────────────────────────────────────────────────
function goToCheckout() {
  if (!state.selectedCheckin || !state.selectedCheckout) return;
  // 👤 Réserver exige un compte connecté avec profil complet — SAUF en parcours
  // personnalisé (lien hold / prix négocié envoyé par l'hôte), qui doit rester
  // accessible sans inscription.
  const personalizedLink = !!(state._holdToken || state._lockedPropertyId || state._fixedPriceActive != null);
  if (!personalizedLink && (!isLoggedIn() || state.profile?.profileComplete !== true)) {
    requireProfile(() => goToCheckout(), 'Connectez-vous pour réserver');
    return;
  }
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
  // 💰 MODÈLE MARKETPLACE (Option 1) — le voyageur paie TOUJOURS le prix affiché, tout compris.
  // Aucun frais ajouté : ni ménage, ni taxe, ni frais de service. La commission plateforme
  // (3%/7%) est prélevée côté hôte au reversement, invisible ici.
  const isFixed = fixedPriceOverride !== null;
  const ttc = Math.round(displayBase * 100) / 100;
  const fmtDate = iso => new Date(String(iso).substring(0,10) + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  // Reset promo state (pas de promo si prix fixe)
  state.appliedPromo = null;
  if (fixedPriceOverride !== null) state._fixedPriceActive = fixedPriceOverride;

  // Bouton retour checkout
  const checkoutHeader = document.querySelector('#screen-checkout .page-header .btn-back');
  if (checkoutHeader) checkoutHeader.onclick = () => navTo('detail');

  document.getElementById('checkoutContent').innerHTML = `
    <div class="checkout-summary" id="priceSummary">
      <div class="checkout-summary-title">${p.name}</div>
      <div class="checkout-row"><span>Dates</span><span>${fmtDate(state.selectedCheckin)} → ${fmtDate(state.selectedCheckout)}</span></div>
      ${fixedPriceOverride !== null
        ? `<div class="checkout-row" id="baseRow"><span>Prix convenu avec l'hôte</span><span>${displayBase}€</span></div>`
        : `<div class="checkout-row" id="baseRow"><span>Séjour · ${nights} nuit${nights > 1 ? 's' : ''}</span><span>${displayBase}€</span></div>`
      }
      <div class="checkout-row total"><span>Total à payer</span><span id="totalAmount">${ttc}€</span></div>
      <div class="checkout-row" style="border:none;padding-top:4px;"><span style="font-size:12px;color:var(--stone-light);">Tout compris · aucun frais de service</span><span></span></div>
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
        <button onclick="applyPromo()" id="btnApplyPromo" style="padding:13px 18px;background:var(--primary-tint);color:var(--primary-dark);border:none;border-radius:12px;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;">
          Appliquer
        </button>
      </div>
      <div id="promoMsg" style="font-size:12px;margin-top:6px;display:none;"></div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;background:var(--primary-tint);border-radius:12px;padding:13px 15px;font-size:13px;color:#8A4A2E;margin-top:8px;margin-bottom:18px;">
      <span style="color:var(--primary);display:flex;">${icon('lock')}</span>
      Paiement sécurisé. Votre réservation est confirmée immédiatement.
    </div>
    <button id="btnPay" onclick="submitBooking()" style="width:100%;padding:17px;background:var(--primary);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit;">
      Payer ${ttc}€
    </button>
  `;

  navTo('checkout');
}

// Recalcule la taxe de séjour quand le nb de voyageurs change
function onGuestCountChange() {
  // Option 1 (prix tout inclus) : le nombre de voyageurs n'affecte pas le prix.
  // Rien à recalculer côté total.
}

function _recalcTotal() {
  const p = state.currentProperty;
  if (!p) return;
  // Option 1 : prix affiché, tout inclus. On soustrait seulement une éventuelle promo.
  const totalBase = sumNights(p, state.selectedCheckin, state.selectedCheckout);
  const discount = state.appliedPromo?.discount_amount || 0;
  const ttc = Math.max(0, Math.round((totalBase - discount) * 100) / 100);

  const elTotal = document.getElementById('totalAmount');
  if (elTotal) elTotal.textContent = `${ttc}€`;
  const btnPay = document.getElementById('btnPay');
  if (btnPay) btnPay.textContent = `Payer ${ttc}€`;
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

    // Appliquer la réduction (Option 1 : prix tout inclus - promo)
    state.appliedPromo = data;
    const discount = data.discount_amount;
    const ttc = Math.max(0, Math.round((total - discount) * 100) / 100);

    const promoRow = document.getElementById('promoRow');
    if (promoRow) { promoRow.style.display = 'flex'; }
    const promoAmt = document.getElementById('promoAmount');
    if (promoAmt) promoAmt.textContent = `-${discount}€`;
    const totalAmt = document.getElementById('totalAmount');
    if (totalAmt) totalAmt.textContent = `${ttc}€`;
    const btnPay = document.getElementById('btnPay');
    if (btnPay) btnPay.textContent = `Payer ${ttc}€`;

    msg.style.display = 'block';
    msg.style.color = 'var(--primary)';
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
      headers: authHeaders({ 'Content-Type': 'application/json' }),
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
        // Token du lien OUVERT uniquement. On ne retombe pas sur un ancien
        // token du localStorage (résidu d'un lien précédent → 410 à tort).
        hold_token: state._holdToken || null
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
    <div class="confirm-icon">${icon('check')}</div>
    <div class="confirm-title">Réservation confirmée !</div>
    <div class="confirm-sub">Un email de confirmation a été envoyé à ${guestEmail}</div>
    <div class="confirm-card">
      <div class="confirm-row"><span>Logement</span><span>${p.name}</span></div>
      <div class="confirm-row"><span>Arrivée</span><span>${fmtDate(state.selectedCheckin)}</span></div>
      <div class="confirm-row"><span>Départ</span><span>${fmtDate(state.selectedCheckout)}</span></div>
      <div class="confirm-row"><span>Voyageur</span><span>${guestName}</span></div>
      <div class="confirm-row"><span>Total payé</span><span>${data.total_ttc}€</span></div>
      ${p.arrivalTime ? `<div style="border-top:1px solid var(--border);margin-top:10px;padding-top:10px;font-size:13px;color:var(--text-light);">
        ${icon('clock')} Arrivée à partir de ${p.arrivalTime}
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
        ${icon('calendar')}
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
      list.innerHTML = `<div class="empty-state">${icon('calendar')}<p>Aucune réservation pour le moment</p></div>`;
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
            ${icon('message')} Contacter
          </button>` : '';

      const btnLivret = b.property.welcomeBookUrl
        ? `<button onclick="window.open('${b.property.welcomeBookUrl}','_blank')"
            style="flex:1;padding:10px;background:#f0fdf4;color:#10b981;border:1px solid #bbf7d0;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
            ${icon('book')} Livret
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
          <span style="color:var(--primary);font-size:12px;">${icon('calendar')}</span>
          <span>${fmtDate(b.checkin)} → ${fmtDate(b.checkout)}</span>
          ${b.property.city ? `<span style="color:#cbd5e1;">·</span><span>${b.property.city}</span>` : ''}
        </div>

        <!-- Horaires arrivée/départ -->
        ${(b.property.arrivalTime || b.property.departureTime) ? `
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;display:flex;gap:12px;">
          ${b.property.arrivalTime ? `<span><span style="color:#10b981;margin-right:3px;">${icon('sign-in')}</span>Arrivée dès ${b.property.arrivalTime}</span>` : ''}
          ${b.property.departureTime ? `<span><span style="color:#f59e0b;margin-right:3px;">${icon('sign-out')}</span>Départ avant ${b.property.departureTime}</span>` : ''}
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
    list.innerHTML = `<div class="empty-state">${icon('wifi')}<p>Erreur de chargement</p></div>`;
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
        ${icon('sign-in')} Se connecter
      </button>`;
  }
}

function logout() {
  clearSession();
  state.account = {};
  state.profile = null;
  localStorage.removeItem('guest_account');
  localStorage.removeItem('bh_host_token');
  renderAuthBar();
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

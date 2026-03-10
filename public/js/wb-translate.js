// ============================================================
// wb-translate.js — Welcome Book Translation Engine
// Serve this file from /public/js/wb-translate.js
// ============================================================

const LANGS = {
  fr: { flag: '🇫🇷', label: 'FR' },
  en: { flag: '🇬🇧', label: 'EN' },
  de: { flag: '🇩🇪', label: 'DE' },
  it: { flag: '🇮🇹', label: 'IT' },
  nl: { flag: '🇳🇱', label: 'NL' },
  zh: { flag: '🇨🇳', label: 'ZH' }
};

const UI = {
  fr: {
    welcome: 'Bienvenue', welcomeTitle: 'Bienvenue<br>chez nous',
    accessLbl: 'Accès & Arrivée', accessTitle: 'Accès au<br>logement', accessNav: 'Accès',
    roomsLbl: 'Le logement', roomsTitle: 'Vos espaces', roomsNav: 'Logement',
    infoLbl: 'Infos pratiques', infoTitle: 'À savoir', infoNav: 'Pratique',
    aroundLbl: 'Alentours', aroundTitle: 'Guide du<br>quartier', aroundNav: 'Alentours',
    checkoutLbl: 'Départ', checkoutTitle: 'Consignes<br>de départ', checkoutNav: 'Départ',
    wifi: 'Réseau WiFi', wifiPw: 'Mot de passe', wifiCopy: 'Copier',
    arrival: 'Arrivée', departure: 'Départ', keybox: 'Boîte à clés', host: 'Votre hôte',
    checkinTime: 'Dès 15h00', limitTime: 'heure limite',
    restos: '🍽 Restaurants', shops: '🛒 Commerces', visit: '🏞 À visiter',
    thanks: 'Merci pour votre séjour ✦',
    rules: 'Règles importantes', equip: 'Équipements',
    accessIns: "Instructions d'accès", parking: 'Parking', transport: 'Transports'
  },
  en: {
    welcome: 'Welcome', welcomeTitle: 'Welcome<br>to our home',
    accessLbl: 'Access & Arrival', accessTitle: 'Access to<br>the property', accessNav: 'Access',
    roomsLbl: 'The property', roomsTitle: 'Your spaces', roomsNav: 'Rooms',
    infoLbl: 'Practical info', infoTitle: 'Good to know', infoNav: 'Info',
    aroundLbl: 'Around', aroundTitle: 'Area<br>guide', aroundNav: 'Around',
    checkoutLbl: 'Checkout', checkoutTitle: 'Checkout<br>instructions', checkoutNav: 'Checkout',
    wifi: 'WiFi Network', wifiPw: 'Password', wifiCopy: 'Copy',
    arrival: 'Check-in', departure: 'Check-out', keybox: 'Key lockbox', host: 'Your host',
    checkinTime: 'From 3:00 PM', limitTime: 'deadline',
    restos: '🍽 Restaurants', shops: '🛒 Shops', visit: '🏞 Places to visit',
    thanks: 'Thank you for your stay ✦',
    rules: 'House rules', equip: 'Equipment',
    accessIns: 'Access instructions', parking: 'Parking', transport: 'Transport'
  },
  de: {
    welcome: 'Willkommen', welcomeTitle: 'Willkommen<br>bei uns',
    accessLbl: 'Zugang & Ankunft', accessTitle: 'Zugang zur<br>Unterkunft', accessNav: 'Zugang',
    roomsLbl: 'Die Unterkunft', roomsTitle: 'Ihre Räume', roomsNav: 'Unterkunft',
    infoLbl: 'Praktische Infos', infoTitle: 'Wissenswert', infoNav: 'Info',
    aroundLbl: 'Umgebung', aroundTitle: 'Stadtteil-<br>führer', aroundNav: 'Umgebung',
    checkoutLbl: 'Abreise', checkoutTitle: 'Abreise-<br>hinweise', checkoutNav: 'Abreise',
    wifi: 'WLAN-Netzwerk', wifiPw: 'Passwort', wifiCopy: 'Kopieren',
    arrival: 'Ankunft', departure: 'Abreise', keybox: 'Schlüsselkasten', host: 'Ihr Gastgeber',
    checkinTime: 'Ab 15:00 Uhr', limitTime: 'Deadline',
    restos: '🍽 Restaurants', shops: '🛒 Geschäfte', visit: '🏞 Sehenswürdigkeiten',
    thanks: 'Vielen Dank für Ihren Aufenthalt ✦',
    rules: 'Wichtige Regeln', equip: 'Ausstattung',
    accessIns: 'Zugangsanweisungen', parking: 'Parken', transport: 'Verkehr'
  },
  it: {
    welcome: 'Benvenuto', welcomeTitle: 'Benvenuto<br>da noi',
    accessLbl: 'Accesso & Arrivo', accessTitle: 'Accesso alla<br>struttura', accessNav: 'Accesso',
    roomsLbl: "L'alloggio", roomsTitle: 'I vostri spazi', roomsNav: 'Alloggio',
    infoLbl: 'Informazioni pratiche', infoTitle: 'Da sapere', infoNav: 'Info',
    aroundLbl: 'Dintorni', aroundTitle: 'Guida del<br>quartiere', aroundNav: 'Dintorni',
    checkoutLbl: 'Partenza', checkoutTitle: 'Istruzioni<br>di partenza', checkoutNav: 'Partenza',
    wifi: 'Rete WiFi', wifiPw: 'Password', wifiCopy: 'Copia',
    arrival: 'Arrivo', departure: 'Partenza', keybox: 'Cassetta chiavi', host: 'Il vostro host',
    checkinTime: 'Dalle 15:00', limitTime: 'orario limite',
    restos: '🍽 Ristoranti', shops: '🛒 Negozi', visit: '🏞 Da visitare',
    thanks: 'Grazie per il vostro soggiorno ✦',
    rules: 'Regole importanti', equip: 'Attrezzature',
    accessIns: "Istruzioni d'accesso", parking: 'Parcheggio', transport: 'Trasporti'
  },
  nl: {
    welcome: 'Welkom', welcomeTitle: 'Welkom<br>bij ons',
    accessLbl: 'Toegang & Aankomst', accessTitle: 'Toegang tot<br>de woning', accessNav: 'Toegang',
    roomsLbl: 'De woning', roomsTitle: 'Uw ruimtes', roomsNav: 'Woning',
    infoLbl: 'Praktische info', infoTitle: 'Handig om te weten', infoNav: 'Info',
    aroundLbl: 'Omgeving', aroundTitle: 'Buurt-<br>gids', aroundNav: 'Omgeving',
    checkoutLbl: 'Vertrek', checkoutTitle: 'Vertrek-<br>instructies', checkoutNav: 'Vertrek',
    wifi: 'WiFi-netwerk', wifiPw: 'Wachtwoord', wifiCopy: 'Kopiëren',
    arrival: 'Aankomst', departure: 'Vertrek', keybox: 'Sleutelkluisje', host: 'Uw gastheer',
    checkinTime: 'Vanaf 15:00', limitTime: 'uiterste tijd',
    restos: '🍽 Restaurants', shops: '🛒 Winkels', visit: '🏞 Bezienswaardigheden',
    thanks: 'Bedankt voor uw verblijf ✦',
    rules: 'Belangrijke regels', equip: 'Uitrusting',
    accessIns: 'Toegangsinstructies', parking: 'Parkeren', transport: 'Vervoer'
  },
  zh: {
    welcome: '欢迎', welcomeTitle: '欢迎<br>来到我们家',
    accessLbl: '入住与抵达', accessTitle: '到达<br>住所', accessNav: '入住',
    roomsLbl: '住所介绍', roomsTitle: '您的空间', roomsNav: '住所',
    infoLbl: '实用信息', infoTitle: '重要信息', infoNav: '须知',
    aroundLbl: '周边', aroundTitle: '周边<br>指南', aroundNav: '周边',
    checkoutLbl: '退房', checkoutTitle: '退房<br>须知', checkoutNav: '退房',
    wifi: 'WiFi网络', wifiPw: '密码', wifiCopy: '复制',
    arrival: '入住时间', departure: '退房时间', keybox: '钥匙箱', host: '您的房东',
    checkinTime: '下午3点起', limitTime: '截止时间',
    restos: '🍽 餐厅', shops: '🛒 商店', visit: '🏞 景点',
    thanks: '感谢您的光临 ✦',
    rules: '重要规定', equip: '设施',
    accessIns: '入住说明', parking: '停车', transport: '交通'
  }
};

const SEL = [
  ['.sect-lbl-welcome', 'welcome'],    ['.sect-title-welcome', 'welcomeTitle'],
  ['.sect-lbl-access',  'accessLbl'],  ['.sect-title-access',  'accessTitle'],
  ['.sect-lbl-rooms',   'roomsLbl'],   ['.sect-title-rooms',   'roomsTitle'],
  ['.sect-lbl-info',    'infoLbl'],    ['.sect-title-info',    'infoTitle'],
  ['.sect-lbl-around',  'aroundLbl'],  ['.sect-title-around',  'aroundTitle'],
  ['.sect-lbl-checkout','checkoutLbl'],['.sect-title-checkout', 'checkoutTitle'],
  ['.wifi-name-lbl',    'wifi'],       ['.wifi-pw-lbl',         'wifiPw'],
  ['.key-lbl-arrival',  'arrival'],    ['.key-val-arrival',     'checkinTime'],
  ['.key-lbl-departure','departure'],
  ['.key-lbl-keybox',   'keybox'],     ['.key-lbl-host',        'host'],
  ['.limit-time-lbl',   'limitTime'],
  ['.subcat-restos',    'restos'],     ['.subcat-shops',        'shops'],
  ['.subcat-visit',     'visit'],      ['.foot-thanks',         'thanks'],
  ['.nav-welcome',      'welcome'],    ['.nav-access',          'accessNav'],
  ['.nav-rooms',        'roomsNav'],   ['.nav-info',            'infoNav'],
  ['.nav-around',       'aroundNav'],  ['.nav-checkout',        'checkoutNav'],
  ['.access-title-ins', 'accessIns'],  ['.access-title-parking','parking'],
  ['.access-title-transport', 'transport']
];

let currentLang = 'fr';
const txCache = {};

function applyUI(lang) {
  const t = UI[lang] || UI.fr;
  SEL.forEach(function(pair) {
    document.querySelectorAll(pair[0]).forEach(function(el) {
      if (t[pair[1]]) el.innerHTML = t[pair[1]];
    });
  });
  const rulesEl = document.querySelector('.info-title-rules');
  if (rulesEl && t.rules) {
    rulesEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> ' + t.rules;
  }
  const equipEl = document.querySelector('.info-title-equip');
  if (equipEl && t.equip) {
    equipEl.innerHTML = '<i class="fas fa-toolbox"></i> ' + t.equip;
  }
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('wb_lang', lang);
  const lm = LANGS[lang] || LANGS.fr;
  const flagEl = document.getElementById('langFlag');
  const labelEl = document.getElementById('langLabel');
  const menuEl = document.getElementById('langMenu');
  if (flagEl) flagEl.textContent = lm.flag;
  if (labelEl) labelEl.textContent = lm.label;
  document.querySelectorAll('.lang-option').forEach(function(el) {
    el.classList.toggle('active', el.dataset.lang === lang);
  });
  if (menuEl) menuEl.classList.remove('open');
  document.documentElement.lang = lang;
  applyUI(lang);
  translateDynamic(lang);
}

async function translateDynamic(lang) {
  const els = document.querySelectorAll('[data-translatable]');
  if (!lang || lang === 'fr') {
    els.forEach(function(el) {
      if (el.dataset.orig) el.innerHTML = el.dataset.orig;
    });
    return;
  }
  const targets = { en: 'en', de: 'de', it: 'it', nl: 'nl', zh: 'zh' };
  const target = targets[lang] || 'en';
  els.forEach(function(el) {
    if (!el.dataset.orig) el.dataset.orig = el.innerHTML;
  });
  for (const el of els) {
    const orig = el.dataset.orig || '';
    if (!orig.trim()) continue;
    const ckey = target + '|' + orig.slice(0, 60);
    if (txCache[ckey]) { el.innerHTML = txCache[ckey]; continue; }
    el.classList.add('translating');
    try {
      const r = await fetch('https://libretranslate.com/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: orig.replace(/<br>/g, '\n'), source: 'fr', target: target, format: 'text', api_key: '' })
      });
      if (r.ok) {
        const d = await r.json();
        if (d.translatedText) {
          const tx = d.translatedText.replace(/\n/g, '<br>');
          txCache[ckey] = tx;
          el.innerHTML = tx;
        }
      }
    } catch (e) { /* silent fail */ }
    el.classList.remove('translating');
  }
}

function toggleLangMenu(e) {
  e.stopPropagation();
  const m = document.getElementById('langMenu');
  if (m) m.classList.toggle('open');
}

document.addEventListener('click', function() {
  const m = document.getElementById('langMenu');
  if (m) m.classList.remove('open');
});

document.addEventListener('DOMContentLoaded', function() {
  const saved = localStorage.getItem('wb_lang') || 'fr';
  if (saved !== 'fr') setLang(saved);
});

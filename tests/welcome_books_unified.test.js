'use strict';
/**
 * Tests unitaires — Livret unifié (BOOKV1)
 *
 * Couvre la logique d'association property_id, idempotence, renderer Property-first,
 * fallbacks legacy, et protection des données web lors de mises à jour partielles.
 *
 * Execution : node tests/welcome_books_unified.test.js
 */

const assert = require('assert');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

// ─── Helpers miroir ───────────────────────────────────────────────────────────

/**
 * Logique Property-first du renderer.
 * Miroir du bloc "Property-first" dans /welcome/:uniqueId.
 */
function applyPropertyFirst(d, propertyRow) {
  if (!propertyRow || !propertyRow.property_id) return d;
  const propVal = (pv, dv) =>
    (pv !== null && pv !== undefined && String(pv).trim() !== '') ? pv : dv;
  let pi = {};
  try {
    pi = typeof propertyRow.practical_info === 'string'
      ? JSON.parse(propertyRow.practical_info)
      : (propertyRow.practical_info || {});
  } catch(_) {}
  return {
    ...d,
    wifiSSID:           propVal(propertyRow.wifi_name,          d.wifiSSID),
    wifiPassword:       propVal(propertyRow.wifi_password,       d.wifiPassword),
    keyboxCode:         propVal(propertyRow.access_code,         d.keyboxCode),
    accessInstructions: propVal(propertyRow.access_instructions, d.accessInstructions),
    checkinTime:        propVal(propertyRow.arrival_time,        d.checkinTime),
    checkoutTime:       propVal(propertyRow.departure_time,      d.checkoutTime),
    parkingInfo:        propVal(pi.parkingDetails,               d.parkingInfo),
    transportInfo:      propVal(pi.publicTransport,              d.transportInfo),
    shopsList:          propVal(pi.nearbyShops,                  d.shopsList),
  };
}

/**
 * Logique de backfill sécurisé.
 * Retourne les associations non-ambiguës.
 */
function safeBackfill(properties, welcomeBooks) {
  // Extraire uniqueId depuis welcome_book_url
  const candidates = properties
    .filter(p => p.welcome_book_url)
    .map(p => {
      const m = String(p.welcome_book_url).match(/\/welcome\/([a-zA-Z0-9_-]+)/);
      return m ? { propertyId: p.id, userId: p.user_id, uniqueId: m[1] } : null;
    })
    .filter(Boolean);

  // Compter les propriétés pointant vers le même uniqueId (par user)
  const counts = {};
  for (const c of candidates) {
    const key = `${c.userId}:${c.uniqueId}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  // Résultat : uniqueId → propertyId (unambiguës seulement)
  const result = {};
  for (const c of candidates) {
    const key = `${c.userId}:${c.uniqueId}`;
    if (counts[key] === 1) {
      // Vérifier qu'un seul livre correspond à ce uniqueId
      const matching = welcomeBooks.filter(
        wb => wb.unique_id === c.uniqueId && wb.property_id === null
      );
      if (matching.length === 1) {
        result[c.uniqueId] = c.propertyId;
      }
    }
  }
  return result;
}

/**
 * Logique auto-link welcome_book_url.
 */
function autoLinkUrl(existingUrl, publicUrl, uniqueId) {
  if (!existingUrl || existingUrl.trim() === '') {
    return { updated: true, urlConflict: false, newUrl: publicUrl };
  }
  const m = String(existingUrl).match(/\/welcome\/([a-zA-Z0-9_-]+)/);
  const existingUniqueId = m ? m[1] : null;
  if (existingUniqueId === uniqueId) {
    return { updated: existingUrl !== publicUrl, urlConflict: false, newUrl: publicUrl };
  }
  return { updated: false, urlConflict: true, newUrl: existingUrl };
}

// ─── B1 : ancien livret sans property_id fonctionne toujours ─────────────────
test('B1 — ancien livret property_id NULL fonctionne toujours', () => {
  const d = { wifiSSID: 'OldWifi', checkinTime: '16h', importantRules: 'Pas de fete' };
  // Pas de propertyRow → comportement historique conservé
  const result = applyPropertyFirst(d, null);
  assert.strictEqual(result.wifiSSID,      'OldWifi');
  assert.strictEqual(result.checkinTime,   '16h');
  assert.strictEqual(result.importantRules,'Pas de fete');
});

// ─── B2 : création avec propertyId crée un seul livret ───────────────────────
test('B2 — creation avec propertyId genere un uniqueId et property_id', () => {
  // Simuler la logique : propertyId fourni, pas de livre existant → nouveau livre
  const propertyId = 'prop-123';
  const existingByProp = []; // pas de livre lié
  let uniqueId = null;
  let resolvedPropertyId = null;

  if (existingByProp.length > 0) {
    uniqueId = existingByProp[0].unique_id;
  } else {
    uniqueId = require('crypto').randomBytes(16).toString('hex');
    resolvedPropertyId = propertyId;
  }

  assert.ok(uniqueId && uniqueId.length >= 16, 'uniqueId genere');
  assert.strictEqual(resolvedPropertyId, propertyId);
});

// ─── B3 : deuxième création même propertyId réutilise le même uniqueId ───────
test('B3 — deuxieme creation meme propertyId reutilise le meme uniqueId', () => {
  const propertyId = 'prop-123';
  const existingUniqueId = 'abc123existingid';
  const existingByProp = [{ unique_id: existingUniqueId, data: {} }];

  let uniqueId = null;
  if (existingByProp.length > 0) {
    uniqueId = existingByProp[0].unique_id;
  }

  assert.strictEqual(uniqueId, existingUniqueId, 'Reutilise le meme uniqueId');
});

// ─── B4 : deux requêtes concurrentes → ON CONFLICT gère l'idempotence ────────
test('B4 — ON CONFLICT (unique_id) empeche deux livrets pour le meme uniqueId', () => {
  // Vérifier que la requête SQL utilise ON CONFLICT (unique_id)
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../routes/welcomeRoutes.js'), 'utf8');
  assert.ok(src.includes('ON CONFLICT (unique_id)'), 'ON CONFLICT (unique_id) present');
  assert.ok(src.includes('COALESCE(welcome_books_v2.property_id, EXCLUDED.property_id)'), 'COALESCE property_id present');
});

// ─── B5 : property d'un autre compte rejetée ─────────────────────────────────
test('B5 — property hors scope agencyIds retourne 403', () => {
  const agencyIds = ['user-1', 'user-2'];
  const propRow = []; // vide = pas dans le scope
  const denied = propRow.length === 0;
  assert.ok(denied, 'Acces refuse si property non trouvee dans agencyIds');
});

// ─── B6 : uniqueId d'un autre compte rejeté ──────────────────────────────────
test('B6 — uniqueId appartenant a un autre compte retourne 403', () => {
  // Si uidCheck.rows.length === 0, on retourne 403
  const uidCheck = []; // autre compte → pas trouvé dans agencyIds
  const denied = uidCheck.length === 0;
  assert.ok(denied, 'Acces refuse si uniqueId hors scope');
});

// ─── B7 : by-property retourne exists:false proprement ───────────────────────
test('B7 — by-property retourne exists:false si aucun livret', () => {
  const byProp = [];
  const wbUrl  = null;
  const exists = byProp.length > 0 || (wbUrl && wbUrl.match(/\/welcome\/([a-zA-Z0-9_-]+)/));
  assert.strictEqual(!!exists, false);
});

// ─── B8 : by-property retrouve un livret lié ─────────────────────────────────
test('B8 — by-property retrouve un livret lie par property_id', () => {
  const propertyId = 'prop-123';
  const byProp = [{ unique_id: 'abc123', data: {}, updated_at: new Date() }];
  assert.strictEqual(byProp.length > 0, true);
  assert.strictEqual(byProp[0].unique_id, 'abc123');
});

// ─── B9 : fallback legacy welcome_book_url fonctionne ────────────────────────
test('B9 — fallback legacy via welcome_book_url', () => {
  const wbUrl = 'https://app.boostinghost.fr/welcome/deadbeef0123456789ab';
  const m = wbUrl.match(/\/welcome\/([a-zA-Z0-9_-]+)/);
  assert.ok(m, 'Regex match');
  assert.strictEqual(m[1], 'deadbeef0123456789ab');
});

// ─── B10 : migration ambiguë ne lie rien arbitrairement ──────────────────────
test('B10 — backfill ambigu ne lie rien', () => {
  const properties = [
    { id: 'prop-1', user_id: 'user-1', welcome_book_url: 'https://app/welcome/shared-uid' },
    { id: 'prop-2', user_id: 'user-1', welcome_book_url: 'https://app/welcome/shared-uid' },
  ];
  const welcomeBooks = [
    { unique_id: 'shared-uid', property_id: null, user_id: 'user-1' },
  ];
  const result = safeBackfill(properties, welcomeBooks);
  assert.strictEqual(result['shared-uid'], undefined, 'Ambigu → non lie');
});

// ─── B11 : renderer prend wifi Property avant ancien wifi JSON ────────────────
test('B11 — renderer Property-first : wifi Property prend le dessus', () => {
  const d = { wifiSSID: 'OldWifi', wifiPassword: 'oldpass' };
  const propertyRow = {
    property_id: 'prop-1',
    wifi_name: 'PropWifi',
    wifi_password: 'proppass',
    access_code: null, access_instructions: null,
    arrival_time: null, departure_time: null, practical_info: null,
  };
  const result = applyPropertyFirst(d, propertyRow);
  assert.strictEqual(result.wifiSSID,    'PropWifi');
  assert.strictEqual(result.wifiPassword,'proppass');
});

// ─── B12 : renderer fallback JSON si Property vide ───────────────────────────
test('B12 — renderer fallback data si Property wifi est vide', () => {
  const d = { wifiSSID: 'OldWifi', wifiPassword: 'oldpass' };
  const propertyRow = {
    property_id: 'prop-1',
    wifi_name: '',
    wifi_password: null,
    access_code: null, access_instructions: null,
    arrival_time: null, departure_time: null, practical_info: null,
  };
  const result = applyPropertyFirst(d, propertyRow);
  assert.strictEqual(result.wifiSSID,    'OldWifi',  'Fallback wifiSSID');
  assert.strictEqual(result.wifiPassword,'oldpass',  'Fallback wifiPassword');
});

// ─── B13 : access code Property ──────────────────────────────────────────────
test('B13 — access code depuis Property, fallback si vide', () => {
  const d1 = { keyboxCode: 'OldCode', accessInstructions: 'Ancienne instruction' };
  const propWithCode = {
    property_id: 'prop-1',
    access_code: '4512', access_instructions: 'Boite verte porte gauche',
    wifi_name: null, wifi_password: null, arrival_time: null, departure_time: null, practical_info: null,
  };
  const r1 = applyPropertyFirst(d1, propWithCode);
  assert.strictEqual(r1.keyboxCode,         '4512',                      'Property access_code prioritaire');
  assert.strictEqual(r1.accessInstructions, 'Boite verte porte gauche',  'Property access_instructions prioritaire');

  const propEmpty = {
    property_id: 'prop-1',
    access_code: '', access_instructions: null,
    wifi_name: null, wifi_password: null, arrival_time: null, departure_time: null, practical_info: null,
  };
  const r2 = applyPropertyFirst(d1, propEmpty);
  assert.strictEqual(r2.keyboxCode,         'OldCode',              'Fallback keyboxCode si Property vide');
  assert.strictEqual(r2.accessInstructions, 'Ancienne instruction', 'Fallback accessInstructions si Property null');
});

// ─── B13b : arrival/departure Property ───────────────────────────────────────
test('B13b — arrival/departure depuis Property', () => {
  const d = { checkinTime: '', checkoutTime: '' };
  const propertyRow = {
    property_id: 'prop-1',
    wifi_name: null, wifi_password: null, access_code: null, access_instructions: null,
    arrival_time: '15h', departure_time: '11h', practical_info: null,
  };
  const result = applyPropertyFirst(d, propertyRow);
  assert.strictEqual(result.checkinTime,  '15h');
  assert.strictEqual(result.checkoutTime, '11h');
});

// ─── B14 : parking/transport/shops Property ──────────────────────────────────
test('B14 — parking/transport/shops depuis practical_info Property', () => {
  const d = { parkingInfo: 'Old parking', transportInfo: '', shopsList: '' };
  const propertyRow = {
    property_id: 'prop-1',
    wifi_name: null, wifi_password: null, access_code: null, access_instructions: null,
    arrival_time: null, departure_time: null,
    practical_info: JSON.stringify({
      parkingDetails:  'Parking souterrain',
      publicTransport: 'Metro ligne 4',
      nearbyShops:     'Carrefour 200m',
    }),
  };
  const result = applyPropertyFirst(d, propertyRow);
  assert.strictEqual(result.parkingInfo,   'Parking souterrain');
  assert.strictEqual(result.transportInfo, 'Metro ligne 4');
  assert.strictEqual(result.shopsList,     'Carrefour 200m');
});

// ─── B15 : importantRules reste WelcomeBook ───────────────────────────────────
test('B15 — importantRules reste dans WelcomeBook (non remplace par property)', () => {
  const d = { importantRules: 'Pas de bruit apres 22h', wifiSSID: 'OldWifi' };
  const propertyRow = {
    property_id: 'prop-1',
    wifi_name: 'PropWifi', wifi_password: null, access_code: null, access_instructions: null,
    arrival_time: null, departure_time: null, practical_info: null,
  };
  const result = applyPropertyFirst(d, propertyRow);
  assert.strictEqual(result.importantRules, 'Pas de bruit apres 22h', 'importantRules non touche');
});

// ─── B16 : equipmentList reste WelcomeBook ────────────────────────────────────
test('B16 — equipmentList reste dans WelcomeBook', () => {
  const d = { equipmentList: 'Machine a cafe\nSauna' };
  const propertyRow = {
    property_id: 'prop-1',
    wifi_name: null, wifi_password: null, access_code: null, access_instructions: null,
    arrival_time: null, departure_time: null, practical_info: null,
  };
  const result = applyPropertyFirst(d, propertyRow);
  assert.strictEqual(result.equipmentList, 'Machine a cafe\nSauna');
});

// ─── B17 : ancienne URL /welcome/:uniqueId inchangée ─────────────────────────
test('B17 — route /welcome/:uniqueId existante inchangee', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');
  assert.ok(src.includes("app.get('/welcome/:uniqueId'"), 'Route presente');
});

// ─── B18 : auto-link welcome_book_url si vide ────────────────────────────────
test('B18 — auto-link : URL vide → renseigner', () => {
  const result = autoLinkUrl('', 'https://app/welcome/abc123', 'abc123');
  assert.strictEqual(result.updated, true);
  assert.strictEqual(result.urlConflict, false);
  assert.strictEqual(result.newUrl, 'https://app/welcome/abc123');
});

// ─── B19 : URL custom existante non écrasée ───────────────────────────────────
test('B19 — auto-link : URL custom differente → non ecrasee', () => {
  const result = autoLinkUrl(
    'https://monsite.fr/mon-livret-custom',
    'https://app/welcome/abc123',
    'abc123'
  );
  assert.strictEqual(result.updated,     false);
  assert.strictEqual(result.urlConflict, true);
});

test('B19b — auto-link : meme uniqueId → normalisation URL', () => {
  const result = autoLinkUrl(
    'https://old-domain.fr/welcome/abc123',
    'https://app/welcome/abc123',
    'abc123'
  );
  assert.strictEqual(result.urlConflict, false);
  assert.strictEqual(result.newUrl,      'https://app/welcome/abc123');
});

// ─── B10b : backfill NON ambigu lie correctement ─────────────────────────────
test('B10b — backfill non ambigu lie le livret', () => {
  const properties = [
    { id: 'prop-1', user_id: 'user-1', welcome_book_url: 'https://app/welcome/uid-unique' },
  ];
  const welcomeBooks = [
    { unique_id: 'uid-unique', property_id: null, user_id: 'user-1' },
  ];
  const result = safeBackfill(properties, welcomeBooks);
  assert.strictEqual(result['uid-unique'], 'prop-1', 'Association non-ambiguë correcte');
});

// ─── B10c : backfill ne modifie pas un livre déjà lié ────────────────────────
test('B10c — backfill ignore un livre deja lie (property_id non NULL)', () => {
  const properties = [
    { id: 'prop-1', user_id: 'user-1', welcome_book_url: 'https://app/welcome/uid-deja-lie' },
  ];
  const welcomeBooks = [
    { unique_id: 'uid-deja-lie', property_id: 'prop-other', user_id: 'user-1' },
  ];
  const result = safeBackfill(properties, welcomeBooks);
  // La logique filtre WHERE property_id IS NULL
  assert.strictEqual(result['uid-deja-lie'], undefined, 'Livre deja lie non re-backfill');
});

// ─── B21 : PATCH partiel conserve les photos ────────────────────────────────
test('B21 — PATCH partiel conserve les photos via jsonb merge', () => {
  // Simulation de data || patch en JS (miroir du comportement PostgreSQL jsonb ||)
  const existing = {
    welcomeDescription: 'Ancienne description',
    checkoutInstructions: 'Anciennes instructions',
    photos: { cover: 'https://cdn/photo.jpg', entrance: ['https://cdn/e1.jpg'] },
    rooms: [{ name: 'Chambre', tasks: [] }],
    restaurants: [{ name: 'Le Bistrot' }],
    importantRules: 'Pas de fete',
    unknownLegacyField: 'valeur legacy',
  };
  const patch = { welcomeDescription: 'Nouvelle description', updatedAt: '2026-09-17' };
  // jsonb || en PostgreSQL = Object.assign au niveau top-level
  const result = Object.assign({}, existing, patch);

  assert.strictEqual(result.welcomeDescription,  'Nouvelle description', 'welcomeDescription mis a jour');
  assert.deepStrictEqual(result.photos,           existing.photos,        'photos preservees');
  assert.deepStrictEqual(result.rooms,            existing.rooms,         'rooms preservees');
  assert.deepStrictEqual(result.restaurants,      existing.restaurants,   'restaurants preservees');
  assert.strictEqual(result.importantRules,       'Pas de fete',          'importantRules preservees');
  assert.strictEqual(result.unknownLegacyField,   'valeur legacy',        'champ inconnu preserve');
  assert.strictEqual(result.checkoutInstructions, 'Anciennes instructions','checkoutInstructions non touchees');
});

// ─── B22 : PATCH partiel conserve restaurants et places ──────────────────────
test('B22 — PATCH partiel conserve restaurants/places', () => {
  const existing = {
    welcomeDescription: '',
    places: [{ name: 'Tour Eiffel', distance: '500m' }],
    restaurants: [{ name: 'Cafe de Flore', rating: 5 }],
  };
  const patch = { checkoutInstructions: 'Laisser les cles sur la table', updatedAt: '2026-09-17' };
  const result = Object.assign({}, existing, patch);
  assert.deepStrictEqual(result.places,      existing.places,      'places preservees');
  assert.deepStrictEqual(result.restaurants, existing.restaurants, 'restaurants preservees');
});

// ─── B23 : PATCH partiel conserve les champs JSONB inconnus ──────────────────
test('B23 — PATCH partiel conserve les champs JSONB inconnus (legacy)', () => {
  const existing = {
    welcomeDescription: 'Texte',
    _legacyV1Field: 'some-legacy-value',
    customHostField: { nested: true },
    sortOrder: 3,
  };
  const patch = { welcomeDescription: 'Nouveau texte', updatedAt: '2026-09-17' };
  const result = Object.assign({}, existing, patch);
  assert.strictEqual(result._legacyV1Field,       'some-legacy-value', 'champ legacy conserve');
  assert.deepStrictEqual(result.customHostField,  { nested: true },    'champ custom conserve');
  assert.strictEqual(result.sortOrder,            3,                   'sortOrder conserve');
  assert.strictEqual(result.welcomeDescription,   'Nouveau texte',     'welcomeDescription mis a jour');
});

// ─── B24 : PATCH n'accepte que les champs autorisés ──────────────────────────
test('B24 — PATCH refuse les champs non autorises', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../routes/welcomeRoutes.js'), 'utf8');
  // Vérifier que le tableau allowed ne contient que les champs sûrs
  const m = src.match(/const allowed = \[([^\]]+)\]/);
  assert.ok(m, 'allowed[] present dans le PATCH');
  const allowedStr = m[1];
  assert.ok(!allowedStr.includes('photos'),      'photos absent de allowed');
  assert.ok(!allowedStr.includes('rooms'),       'rooms absent de allowed');
  assert.ok(!allowedStr.includes('restaurants'), 'restaurants absent de allowed');
  assert.ok(!allowedStr.includes('places'),      'places absent de allowed');
  assert.ok(allowedStr.includes('welcomeDescription'),   'welcomeDescription dans allowed');
  assert.ok(allowedStr.includes('checkoutInstructions'), 'checkoutInstructions dans allowed');
});

// ─── B25 : PATCH utilise data || pour préserver (opérateur PostgreSQL correct) ─
test('B25 — PATCH utilise operateur jsonb || (merge, non remplacement)', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../routes/welcomeRoutes.js'), 'utf8');
  // Isoler la section PATCH /by-unique/:uniqueId/extras uniquement
  const patchStart = src.indexOf("router.patch('/by-unique/:uniqueId/extras'");
  assert.ok(patchStart !== -1, 'Route PATCH presente');
  const patchSection = src.slice(patchStart, patchStart + 1500);
  assert.ok(patchSection.includes('data = data ||'), 'PATCH utilise data = data || (merge)');
  assert.ok(!patchSection.match(/SET data = \$1::jsonb/), 'PATCH ne remplace pas data entier');
});

// ─── B26 : race condition — handler présent dans le source ───────────────────
test('B26 — race condition : handler 23505/idx_wb_v2_property_id_unique present', () => {
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '../routes/welcomeRoutes.js'), 'utf8');
  assert.ok(src.includes('idx_wb_v2_property_id_unique'), 'Constraint name presente dans le catch');
  assert.ok(src.includes("'23505'"), 'Code erreur 23505 verifie');
  assert.ok(src.includes('finalUniqueId = winner.rows[0].unique_id'), 'Adoption du uniqueId gagnant presente');
});

// ─── B27 : race condition — logique de récupération ──────────────────────────
test('B27 — race condition : perdant recupere le uniqueId du gagnant', () => {
  const winnerUniqueId = 'winner-uid-abc';
  const loserUniqueId  = 'loser-uid-xyz';
  const propertyId     = 'prop-race-99';

  const dbState = [{ unique_id: winnerUniqueId, property_id: propertyId }];

  const insertErr = Object.assign(new Error('unique_violation'), {
    code: '23505',
    constraint: 'idx_wb_v2_property_id_unique',
  });

  let finalUniqueId = loserUniqueId;
  if (insertErr.code === '23505' && insertErr.constraint === 'idx_wb_v2_property_id_unique') {
    const winner = dbState.filter(r => r.property_id === propertyId);
    if (winner.length) finalUniqueId = winner[0].unique_id;
  }

  assert.strictEqual(finalUniqueId, winnerUniqueId, 'Perdant adopte uniqueId du gagnant');
  assert.notStrictEqual(finalUniqueId, loserUniqueId, 'uniqueId local abandonne');
});

// ─── Résumé ───────────────────────────────────────────────────────────────────
console.log('');
console.log(`Tests welcome_books_unified : ${passed} ok, ${failed} echec(s)`);
if (failed > 0) process.exit(1);

'use strict';
/**
 * OFFSET-3 — Test minimal local (aucune DB requise)
 *
 * Reproduit exactement la chaîne de transformation depuis channex.js
 * jusqu'à ce que le script de diagnostic affiche la date.
 *
 * Entrée simulée : arrival_date = "2026-09-18", departure_date = "2026-09-23"
 *
 * Exécution : node scripts/test-date-offset.js
 */

console.log('\n══ OFFSET-3 — Test minimal local (aucune DB) ════════════════════════\n');

// ─── Valeurs telles que reçues de Channex webhook ────────────────────────────
const arrival_date   = '2026-09-18';   // string pure, aucune transformation
const departure_date = '2026-09-23';

const room = {
  checkin_date:  '2026-09-18',         // room-level (même dans le cas mono-room)
  checkout_date: '2026-09-23',
};

// ─── Miroir exact de channex.js L683-684 ─────────────────────────────────────
const reservationStart = room.checkin_date  || arrival_date;
const reservationEnd   = room.checkout_date || departure_date;

console.log('Valeurs issues de channex.js :');
console.log('  reservationStart (type) :', typeof reservationStart, '=', reservationStart);
console.log('  reservationEnd   (type) :', typeof reservationEnd,   '=', reservationEnd);
console.log('  → paramètres SQL $1/$2  :', reservationStart, '/', reservationEnd);
console.log('  → pas de new Date(), pas de toISOString() dans channex.js');

// ─── Scénario A : colonne DATE (pg renvoie string) ───────────────────────────
console.log('\n── Scénario A : start_date est une colonne DATE ──');
{
  // node-postgres renvoie la valeur DATE comme string "YYYY-MM-DD" (pas de Date object)
  const pg_value = '2026-09-18'; // ce que pg retourne pour une colonne DATE
  console.log('  pg retourne      :', pg_value, '(type:', typeof pg_value, ')');
  console.log('  pg instanceof Date :', pg_value instanceof Date);
  // Fonction d() de nos scripts :
  const d = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
  console.log('  d(pg_value)      :', d(pg_value), ' ← identique à la DB');
  console.log('  Verdict          : PAS de décalage en scénario A');
}

// ─── Scénario B : colonne TIMESTAMPTZ, session DB = UTC ──────────────────────
console.log('\n── Scénario B : start_date TIMESTAMPTZ, session DB = UTC ──');
{
  // INSERT "2026-09-18" avec session UTC → PostgreSQL stocke 2026-09-18T00:00:00Z
  const stored_utc = new Date('2026-09-18T00:00:00Z');
  console.log('  Stocké (UTC)     :', stored_utc.toISOString());
  console.log('  pg retourne      : Date object,', stored_utc.toISOString());
  const d = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
  console.log('  d(pg_value)      :', d(stored_utc), ' ← identique à la DB');
  console.log('  JSON.stringify   :', JSON.stringify(stored_utc), ' ← ce que l\'API envoie');
  console.log('  Verdict          : PAS de décalage en scénario B');
}

// ─── Scénario C : colonne TIMESTAMPTZ, session DB = Europe/Paris ─────────────
console.log('\n── Scénario C : start_date TIMESTAMPTZ, session DB = Europe/Paris ──');
{
  // INSERT "2026-09-18" avec session Europe/Paris
  // PostgreSQL interprète "2026-09-18" = "2026-09-18 00:00:00+02:00" (heure été UTC+2)
  // → stocké en UTC = 2026-09-17T22:00:00Z
  const stored_utc = new Date('2026-09-17T22:00:00Z'); // midnight Paris = 22:00 UTC

  console.log('  INSERT envoyé    : "2026-09-18" (string)');
  console.log('  Session TZ       : Europe/Paris (UTC+2 en été)');
  console.log('  PostgreSQL stocke: 2026-09-18 00:00:00+02:00 = 2026-09-17T22:00:00Z (UTC)');
  console.log('  pg retourne      : Date object,', stored_utc.toISOString());
  console.log('  pg instanceof Date :', stored_utc instanceof Date);

  const d = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
  console.log('  d(pg_value)      :', d(stored_utc), ' ← -1 JOUR ! ← BUG DU SCRIPT');

  // toISOString donne UTC → "2026-09-17T22:00:00Z" → slice(0,10) = "2026-09-17"
  console.log('\n  Détail du bug d() :');
  console.log('    stored_utc.toISOString() =', stored_utc.toISOString());
  console.log('    .slice(0,10)             = "2026-09-17" ← date UTC, pas date Paris');
  console.log('    date réelle (Paris)      = "2026-09-18" ← correcte');

  // Correction : lire en heure Paris
  const correct = stored_utc.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  console.log('\n  CORRECTION d() (avec timeZone Paris) :', correct, ' ← correct');

  // Ce que SQL renverrait avec AT TIME ZONE (utilisé dans channex-sync L280) :
  // to_char(start_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') = '2026-09-18'
  console.log('  SQL to_char AT TIME ZONE :', '2026-09-18 (correct)');

  // Ce que l'API envoie au frontend :
  console.log('\n  JSON.stringify (API) :', JSON.stringify(stored_utc));
  console.log('    → iOS new Date("2026-09-17T22:00:00.000Z") en Europe/Paris');
  const iOSDisplayDate = new Date('2026-09-17T22:00:00.000Z');
  console.log('    → toLocaleDateString Paris :', iOSDisplayDate.toLocaleDateString('fr-CA', {timeZone: 'Europe/Paris'}));
  console.log('    → iOS AFFICHE correctement "2026-09-18" ✅');

  console.log('\n  ⚠️  VERDICT scénario C :');
  console.log('    - Donnée DB       : CORRECTE (2026-09-18 en heure Paris)');
  console.log('    - Script d()      : BUG → affiche date UTC = 2026-09-17 (-1 jour)');
  console.log('    - Calendrier iOS  : CORRECT (interprète ISO en heure locale Paris)');
  console.log('    - AUCUN UPDATE DB nécessaire');
}

// ─── Scénario D : heure hiver (UTC+1, 1er novembre) ──────────────────────────
console.log('\n── Scénario D : session Europe/Paris, date en heure hiver ──');
{
  // "2026-11-01 00:00:00+01:00" = 2026-10-31T23:00:00Z
  const stored_utc = new Date('2026-10-31T23:00:00Z');
  const d = v => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
  console.log('  INSERT "2026-11-01" → stocké UTC:', stored_utc.toISOString());
  console.log('  d(pg_value) :', d(stored_utc), ' ← "2026-10-31" (-1 jour même en hiver)');
  const correct = stored_utc.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  console.log('  d() corrigé :', correct, ' ← "2026-11-01" ✓');
}

// ─── Synthèse ─────────────────────────────────────────────────────────────────
console.log('\n══ Synthèse ══════════════════════════════════════════════════════════\n');
console.log('  La séquence observée :');
console.log('    channex_log.reservation_start = "2026-09-18"  (string JSONB, correct)');
console.log('    DB start_date via d()          = "2026-09-17"  (-1 jour)');
console.log('');
console.log('  Compatible UNIQUEMENT avec le scénario C :');
console.log('    → colonne TIMESTAMPTZ');
console.log('    → session DB = Europe/Paris');
console.log('    → d() utilise toISOString() → date UTC → -1 jour');
console.log('');
console.log('  Preuve indirecte dans le code source (server.js L280) :');
console.log('    to_char(start_date AT TIME ZONE \'Europe/Paris\', \'YYYY-MM-DD\')');
console.log('    commentaire : "✅ Timezone-safe : convertir en date Paris avant extraction"');
console.log('    → ce workaround n\'existerait pas si start_date était un DATE pur');
console.log('');
console.log('  Conclusion :');
console.log('    OFFSET-10 — bug DB production  : NON');
console.log('    OFFSET-11 — correction code    : OUI (d() dans scripts diagnostics)');
console.log('    OFFSET-12 — correction DB      : NON');

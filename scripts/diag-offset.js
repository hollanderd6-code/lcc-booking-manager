'use strict';
/**
 * CHX-DATE-OFFSET — Diagnostic complet du décalage -1 jour
 *
 * Vérifie si le -1 jour est :
 *  (a) un artefact du script de diagnostic (d() + toISOString())
 *  (b) un vrai bug de données en production
 *
 * STRICTEMENT READ-ONLY — aucun INSERT, UPDATE, DELETE.
 *
 * Usage :
 *   ! DATABASE_URL=<url> node scripts/diag-offset.js
 *
 * Sections :
 *   OFFSET-1  → type SQL réel de start_date / end_date
 *   OFFSET-2  → transformations channex.js → SQL (analyse statique)
 *   OFFSET-4  → bug du script : d() + toISOString() vs valeur brute
 *   OFFSET-5  → DB raw A et B (valeur brute pg, UTC, Paris)
 *   OFFSET-6  → API : ce que GET /api/reservations sérialise pour A et B
 *   OFFSET-7  → échantillon 20 résas Channex CDG5 (EXACT/DB_MINUS_1/DB_PLUS_1/OTHER)
 *   OFFSET-8  → même échantillon sur 3 autres propriétés Channex
 *   OFFSET-9  → origine exacte du -1 jour
 *   OFFSET-10 → bug DB production OUI/NON
 *   OFFSET-11 → correction code nécessaire OUI/NON
 *   OFFSET-12 → correction DB nécessaire OUI/NON
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n❌  DATABASE_URL manquant.\n');
  console.error('  ! DATABASE_URL=<url> node scripts/diag-offset.js\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const UID_A = 'CHX_702f5756-08e5-4846-b137-654b48149f66';
const UID_B = 'CHX_5d61658d-b679-4c93-b17b-299daf200a71';

function banner(code, title) {
  const bar = '─'.repeat(Math.max(0, 72 - code.length - title.length - 3));
  console.log(`\n${code} — ${title} ${bar}`);
}

// ─── d() bugué (miroir des anciens scripts) ───────────────────────────────────
function dBuggy(v) {
  if (!v) return 'null';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.slice(0, 10);
}

// ─── d() corrigé (timezone-safe) ─────────────────────────────────────────────
function dParis(v) {
  if (!v) return 'null';
  if (v instanceof Date) {
    return v.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  }
  return String(v).slice(0, 10);
}

async function run() {

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-1', 'Type SQL réel de start_date / end_date dans reservations');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // Type depuis information_schema
    const r = await pool.query(`
      SELECT column_name, data_type, udt_name,
             character_maximum_length, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'reservations'
        AND column_name  IN ('start_date', 'end_date', 'created_at', 'updated_at')
      ORDER BY ordinal_position
    `);

    console.log('  Colonnes depuis information_schema.columns :');
    r.rows.forEach(c => {
      console.log(`    ${String(c.column_name).padEnd(14)} data_type=${c.data_type.padEnd(30)} udt_name=${c.udt_name}`);
    });

    // Session timezone courante de la DB
    const tzR = await pool.query(`SHOW timezone`);
    console.log(`\n  Session timezone DB (SHOW timezone) : ${tzR.rows[0].timezone}`);

    // Server_version
    const vR = await pool.query(`SELECT version()`);
    console.log(`  PostgreSQL version : ${vR.rows[0].version.split(' ').slice(0,2).join(' ')}`);

    console.log('\n  Interprétation :');
    console.log('  ┌─────────────────────────────────────────────────────────────┐');
    console.log('  │ DATE      → pg retourne string "YYYY-MM-DD"                │');
    console.log('  │            → d() = String(v).slice(0,10) = correct         │');
    console.log('  │ TIMESTAMP → pg retourne Date (midnight UTC si storage UTC) │');
    console.log('  │ TIMESTAMPTZ → pg retourne Date (UTC) → toISOString() -1j  │');
    console.log('  │              si session DB = Europe/Paris lors de l\'INSERT  │');
    console.log('  └─────────────────────────────────────────────────────────────┘');
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-2', 'Transformations channex.js → SQL (analyse statique)');
  // ════════════════════════════════════════════════════════════════════════════
  {
    console.log('  Chaîne complète dans channex.js :');
    console.log('');
    console.log('    1. attrs.arrival_date     = "2026-09-18"  (string, JSON.parse du payload)');
    console.log('    2. room.checkin_date      = "2026-09-18"  (string, même source)');
    console.log('    3. reservationStart       = room.checkin_date || arrival_date');
    console.log('       → "2026-09-18"  (string pure, AUCUNE transformation new Date/toISOString)');
    console.log('    4. INSERT $1 = reservationStart = "2026-09-18"');
    console.log('       → pg envoie ce string littéral à PostgreSQL');
    console.log('    5. PostgreSQL interprète "2026-09-18" avec la session timezone courante');
    console.log('');
    console.log('  Si session = UTC       : stocké 2026-09-18T00:00:00Z → d() = "2026-09-18" ✅');
    console.log('  Si session = Paris UTC+2 : stocké 2026-09-17T22:00:00Z → d() = "2026-09-17" ❌');
    console.log('');
    console.log('  Il n\'existe AUCUN new Date(), toISOString(), setDate() ou UTC dans channex.js');
    console.log('  pour les champs start_date / end_date.');
    console.log('');
    console.log('  channex_log stocke reservationStart dans un JSONB payload :');
    console.log('    → string "2026-09-18" stocké tel quel, sans conversion timezone');
    console.log('    → lecture du log via p.reservation_start = "2026-09-18" (toujours correct)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-4', 'Bug du script : d() toISOString() vs valeur brute pg');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // Récupérer start_date de A avec différentes représentations
    const r = await pool.query(`
      SELECT
        start_date                                                         AS raw_pg,
        start_date::text                                                   AS as_text,
        to_char(start_date, 'YYYY-MM-DD')                                 AS to_char_plain,
        to_char(start_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')    AS to_char_paris,
        to_char(start_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')             AS to_char_utc,
        extract(epoch from start_date)                                    AS epoch
      FROM reservations WHERE uid = $1
    `, [UID_A]);

    if (r.rows.length === 0) {
      console.log('  ⚠️  Réservation A introuvable.');
    } else {
      const row = r.rows[0];
      const rawPg = row.raw_pg;

      console.log('  Réservation A :');
      console.log(`    raw_pg (ce que pg retourne)  : ${rawPg}  (type JS: ${typeof rawPg}, instanceof Date: ${rawPg instanceof Date})`);
      console.log(`    start_date::text             : ${row.as_text}`);
      console.log(`    to_char(plain)               : ${row.to_char_plain}`);
      console.log(`    to_char(AT TIME ZONE Paris)  : ${row.to_char_paris}`);
      console.log(`    to_char(AT TIME ZONE UTC)    : ${row.to_char_utc}`);
      console.log(`    epoch Unix                   : ${row.epoch}`);

      if (rawPg instanceof Date) {
        console.log('');
        console.log('  pg retourne un Date object → colonne TIMESTAMP/TIMESTAMPTZ');
        console.log(`    rawPg.toISOString()              = ${rawPg.toISOString()}`);
        console.log(`    dBuggy(rawPg)                    = ${dBuggy(rawPg)}  ← ce que nos scripts affichaient`);
        console.log(`    dParis(rawPg)                    = ${dParis(rawPg)}  ← date correcte Europe/Paris`);
        console.log('');
        const diff = dBuggy(rawPg) !== row.to_char_paris;
        if (diff) {
          console.log(`  ⚠️  ÉCART CONFIRMÉ : dBuggy=${dBuggy(rawPg)} ≠ to_char_paris=${row.to_char_paris}`);
          console.log(`     → Le -1 jour est un ARTEFACT DU SCRIPT (pas un bug DB)`);
        } else {
          console.log(`  ✅  Pas d'écart : dBuggy=${dBuggy(rawPg)} == to_char_paris=${row.to_char_paris}`);
        }
      } else {
        console.log('');
        console.log('  pg retourne une string → colonne DATE');
        console.log(`    String(rawPg).slice(0,10)        = ${String(rawPg).slice(0,10)}`);
        console.log(`    dBuggy(rawPg)                    = ${dBuggy(rawPg)}`);
        console.log(`    to_char_paris                    = ${row.to_char_paris}`);
        if (dBuggy(rawPg) !== row.to_char_paris) {
          console.log(`  ⚠️  ÉCART inattendu pour une colonne DATE`);
        } else {
          console.log(`  ✅  Pas d'écart — colonne DATE, pas de timezone issue`);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-5', 'DB raw A et B — valeur brute pg / UTC / Paris');
  // ════════════════════════════════════════════════════════════════════════════
  {
    for (const [label, uid] of [['A', UID_A], ['B', UID_B]]) {
      const r = await pool.query(`
        SELECT
          uid,
          start_date                                                         AS raw,
          to_char(start_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')    AS paris_start,
          to_char(end_date   AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD')    AS paris_end,
          to_char(start_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')             AS utc_start,
          to_char(end_date   AT TIME ZONE 'UTC', 'YYYY-MM-DD')             AS utc_end,
          to_char(start_date, 'YYYY-MM-DD HH24:MI:SS TZ')                  AS full_ts_start,
          to_char(end_date,   'YYYY-MM-DD HH24:MI:SS TZ')                  AS full_ts_end
        FROM reservations WHERE uid = $1
      `, [uid]);

      if (r.rows.length === 0) {
        console.log(`  ${label} : introuvable`);
        continue;
      }
      const row = r.rows[0];
      const raw = row.raw;
      console.log(`  ${label} = ${uid}`);
      console.log(`    raw pg value             : ${raw}  (${typeof raw})`);
      console.log(`    full timestamp (DB)      : ${row.full_ts_start} → ${row.full_ts_end}`);
      console.log(`    to_char(UTC)             : ${row.utc_start} → ${row.utc_end}`);
      console.log(`    to_char(Paris) ← RÉEL   : ${row.paris_start} → ${row.paris_end}`);
      if (raw instanceof Date) {
        console.log(`    dBuggy() affichait       : ${dBuggy(raw)} → ${dBuggy(row.raw ? undefined : null)}`);
        // Retrieve end separately
        const r2 = await pool.query(`
          SELECT end_date AS raw_end FROM reservations WHERE uid = $1
        `, [uid]);
        if (r2.rows[0]) {
          const rawEnd = r2.rows[0].raw_end;
          console.log(`    dBuggy(end)              : ${dBuggy(rawEnd)}`);
          console.log(`    dParis(start)            : ${dParis(raw)}`);
          console.log(`    dParis(end)              : ${dParis(rawEnd)}`);
        }
      }
      console.log('');
    }

    // Comparer avec channex_logs
    console.log('  Channex logs pour A et B :');
    for (const uid of [UID_A, UID_B]) {
      const bid_r = await pool.query(
        `SELECT channex_booking_id FROM reservations WHERE uid = $1`, [uid]
      );
      const bid = bid_r.rows[0]?.channex_booking_id;
      if (!bid) { console.log(`  ${uid} : pas de channex_booking_id`); continue; }
      const logs = await pool.query(`
        SELECT payload->>'reservation_start' AS log_start,
               payload->>'reservation_end'   AS log_end,
               payload->>'parent_arrival'    AS parent_start,
               payload->>'parent_departure'  AS parent_end,
               created_at
        FROM channex_logs
        WHERE payload->>'booking_id' = $1
        ORDER BY created_at DESC LIMIT 3
      `, [bid]);
      if (logs.rows.length === 0) {
        console.log(`  bid=${bid} : pas de logs`);
        continue;
      }
      logs.rows.forEach((l, i) => {
        console.log(`  Log[${i}] bid=${bid.slice(0,8)}…`);
        console.log(`    log reservation_start    : ${l.log_start}  (string JSONB — aucune conversion TZ)`);
        console.log(`    log reservation_end      : ${l.log_end}`);
        console.log(`    log parent_arrival       : ${l.parent_start}`);
        console.log(`    log parent_departure     : ${l.parent_end}`);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-6', 'API : sérialisation GET /api/reservations pour A et B');
  // ════════════════════════════════════════════════════════════════════════════
  {
    console.log('  Comportement de res.json() (Express JSON.stringify) :');
    for (const [label, uid] of [['A', UID_A], ['B', UID_B]]) {
      const r = await pool.query(
        `SELECT start_date, end_date FROM reservations WHERE uid = $1`, [uid]
      );
      if (!r.rows[0]) { console.log(`  ${label} : introuvable`); continue; }
      const { start_date, end_date } = r.rows[0];

      const apiStart = JSON.stringify(start_date);
      const apiEnd   = JSON.stringify(end_date);
      console.log(`\n  ${label} :`);
      console.log(`    start_date pg raw            : ${start_date}  (${typeof start_date})`);
      console.log(`    JSON.stringify(start_date)   : ${apiStart}`);
      console.log(`    JSON.stringify(end_date)     : ${apiEnd}`);

      if (start_date instanceof Date) {
        // Ce que iOS/JS reçoit et affiche en timezone locale (Europe/Paris)
        const iosDate = new Date(start_date.toISOString());
        const iosDisplay = iosDate.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
        console.log(`    iOS toLocaleDateString Paris : ${iosDisplay}  ← date affichée par le calendrier`);
      } else {
        console.log(`    iOS reçoit string "${start_date}" directement`);
      }
    }

    console.log('\n  ℹ️  GET /api/reservations route (server.js) :');
    console.log('    startDate: dbData.start_date   ← valeur brute pg (Date ou string)');
    console.log('    start:     dbData.start_date   ← idem');
    console.log('    Si TIMESTAMPTZ → JSON.stringify → ISO string → iOS interprète en Paris → correct');
    console.log('    Si DATE        → JSON.stringify → "YYYY-MM-DD" string → iOS utilise direct');
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-7', 'Échantillon 20 résas Channex CDG5 (EXACT/MINUS1/PLUS1/OTHER)');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // Trouver CDG5
    const cdg5R = await pool.query(`
      SELECT id FROM properties
      WHERE UPPER(COALESCE(internal_name,'')) LIKE '%CDG5%'
         OR UPPER(COALESCE(internal_name,'')) LIKE '%CDG 5%'
         OR UPPER(name) LIKE '%CDG5%'
      LIMIT 1
    `);
    const propId = cdg5R.rows[0]?.id;
    if (!propId) { console.log('  CDG5 introuvable.'); }
    else {
      const r = await pool.query(`
        SELECT
          r.uid,
          r.channex_booking_id,
          to_char(r.start_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS db_paris_start,
          to_char(r.end_date   AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS db_paris_end,
          cl.payload->>'reservation_start'                                  AS log_start,
          cl.payload->>'reservation_end'                                    AS log_end,
          cl.payload->>'parent_arrival'                                     AS parent_start,
          cl.payload->>'parent_departure'                                   AS parent_end
        FROM reservations r
        LEFT JOIN LATERAL (
          SELECT payload FROM channex_logs
          WHERE payload->>'booking_id' = r.channex_booking_id
          ORDER BY created_at DESC LIMIT 1
        ) cl ON true
        WHERE r.property_id = $1
          AND r.source = 'channex'
          AND r.status != 'cancelled'
          AND r.channex_booking_id IS NOT NULL
        ORDER BY r.start_date DESC
        LIMIT 20
      `, [propId]);

      console.log(`  ${r.rows.length} résa(s) Channex CDG5 :\n`);
      const counts = { EXACT: 0, DB_MINUS_1: 0, DB_PLUS_1: 0, OTHER: 0, NO_LOG: 0 };

      r.rows.forEach(row => {
        if (!row.log_start) {
          counts.NO_LOG++;
          console.log(`  uid=${row.uid.slice(0,20)}… db_paris=${row.db_paris_start}→${row.db_paris_end}  log=N/A`);
          return;
        }
        // Comparer db_paris_start avec log_start (string JSONB)
        const dbDate  = new Date(row.db_paris_start + 'T00:00:00');
        const logDate = new Date(row.log_start       + 'T00:00:00');
        const diffDays = Math.round((dbDate - logDate) / 86400000);
        let verdict;
        if (diffDays === 0)  { verdict = 'EXACT      '; counts.EXACT++; }
        else if (diffDays === -1) { verdict = 'DB_MINUS_1 '; counts.DB_MINUS_1++; }
        else if (diffDays === 1)  { verdict = 'DB_PLUS_1  '; counts.DB_PLUS_1++; }
        else                      { verdict = `OTHER(${diffDays})  `; counts.OTHER++; }

        console.log(`  ${verdict} db=${row.db_paris_start}→${row.db_paris_end}  log=${row.log_start}→${row.log_end}`);
      });

      console.log(`\n  Totaux : EXACT=${counts.EXACT}  DB_MINUS_1=${counts.DB_MINUS_1}  DB_PLUS_1=${counts.DB_PLUS_1}  OTHER=${counts.OTHER}  NO_LOG=${counts.NO_LOG}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-8', 'Même échantillon sur 3 autres propriétés Channex');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const propsR = await pool.query(`
      SELECT id, COALESCE(internal_name, name) as label
      FROM properties
      WHERE channex_enabled = true
        AND UPPER(COALESCE(internal_name,'')) NOT LIKE '%CDG5%'
        AND UPPER(COALESCE(internal_name,'')) NOT LIKE '%CDG 5%'
        AND UPPER(name) NOT LIKE '%CDG5%'
        AND id IN (
          SELECT DISTINCT property_id FROM reservations
          WHERE source = 'channex' AND status != 'cancelled'
        )
      ORDER BY id
      LIMIT 3
    `);

    if (propsR.rows.length === 0) {
      console.log('  Aucune autre propriété Channex trouvée.');
    }

    for (const prop of propsR.rows) {
      const r = await pool.query(`
        SELECT
          r.uid,
          to_char(r.start_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS db_paris_start,
          cl.payload->>'reservation_start'                                  AS log_start
        FROM reservations r
        LEFT JOIN LATERAL (
          SELECT payload FROM channex_logs
          WHERE payload->>'booking_id' = r.channex_booking_id
          ORDER BY created_at DESC LIMIT 1
        ) cl ON true
        WHERE r.property_id = $1
          AND r.source = 'channex'
          AND r.status != 'cancelled'
          AND r.channex_booking_id IS NOT NULL
        ORDER BY r.start_date DESC
        LIMIT 10
      `, [prop.id]);

      const counts = { EXACT: 0, MINUS1: 0, PLUS1: 0, OTHER: 0, NOLOG: 0 };
      r.rows.forEach(row => {
        if (!row.log_start) { counts.NOLOG++; return; }
        const diff = Math.round((new Date(row.db_paris_start + 'T00:00:00') - new Date(row.log_start + 'T00:00:00')) / 86400000);
        if (diff === 0) counts.EXACT++;
        else if (diff === -1) counts.MINUS1++;
        else if (diff === 1) counts.PLUS1++;
        else counts.OTHER++;
      });

      console.log(`  ${prop.label} (id=${prop.id}) — ${r.rows.length} résas :`);
      console.log(`    EXACT=${counts.EXACT}  DB_MINUS_1=${counts.MINUS1}  DB_PLUS_1=${counts.PLUS1}  OTHER=${counts.OTHER}  NO_LOG=${counts.NOLOG}`);
    }

    console.log('\n  Interprétation :');
    console.log('  Si DB_MINUS_1 > 0 sur toutes propriétés → problème global pipeline');
    console.log('  Si DB_MINUS_1 = 0 partout (avec to_char Paris) → c\'était le script d()');
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-9', 'Origine exacte du -1 jour');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // Récupérer la session timezone et le type réel
    const [tzR, colR] = await Promise.all([
      pool.query(`SHOW timezone`),
      pool.query(`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='reservations' AND column_name='start_date'
      `)
    ]);

    const sessionTz = tzR.rows[0].timezone;
    const colType = colR.rows[0]?.data_type || 'inconnu';

    console.log(`  Session timezone DB    : ${sessionTz}`);
    console.log(`  Type colonne start_date: ${colType}`);
    console.log('');

    if (colType === 'date') {
      console.log('  → Colonne DATE pure');
      console.log('  → pg retourne string "YYYY-MM-DD"');
      console.log('  → d() utilise String(v).slice(0,10) = correct');
      console.log('  → Le -1 jour dans les anciens scripts est IMPOSSIBLE via timezone');
      console.log('  → Si -1 jour observé : vérifier si le bug venait d\'un autre champ (raw_pg type)');
    } else if (colType.includes('timestamp') || colType.includes('time')) {
      console.log(`  → Colonne ${colType.toUpperCase()} `);
      console.log('  → pg retourne un Date object (UTC)');

      if (sessionTz === 'UTC' || sessionTz === 'Etc/UTC') {
        console.log('  → Session DB = UTC → INSERT "2026-09-18" → stocké 2026-09-18T00:00:00Z');
        console.log('  → d() dBuggy = toISOString().slice(0,10) = "2026-09-18" ← CORRECT');
        console.log('  → Pas de -1 jour depuis la session DB UTC');
        console.log('  → MAIS : si le serveur Node.js a TZ=Europe/Paris,');
        console.log('    l\'interprétation peut différer selon les fonctions Date JS utilisées');
      } else {
        console.log(`  → Session DB = ${sessionTz}`);
        const utcOffsetH = sessionTz === 'Europe/Paris' ? '+2 (été) ou +1 (hiver)' : 'voir DB';
        console.log(`    UTC offset actuel : ${utcOffsetH}`);
        console.log('  → INSERT "2026-09-18" → stocké 2026-09-17T22:00:00Z (midnight Paris)');
        console.log('  → pg retourne Date(2026-09-17T22:00:00Z)');
        console.log('  → dBuggy = toISOString().slice(0,10) = "2026-09-17" ← -1 JOUR = SCRIPT BUG');
        console.log('  → dParis = toLocaleDateString(Paris) = "2026-09-18" ← CORRECT');
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-10', 'Bug DB production OUI/NON');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // On peut trancher en comparant to_char(paris) avec channex_log.reservation_start
    const r = await pool.query(`
      SELECT
        r.uid,
        to_char(r.start_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS db_paris,
        cl.payload->>'reservation_start'                                  AS log_val
      FROM reservations r
      LEFT JOIN LATERAL (
        SELECT payload FROM channex_logs
        WHERE payload->>'booking_id' = r.channex_booking_id
        ORDER BY created_at ASC LIMIT 1   -- premier log = création initiale
      ) cl ON true
      WHERE r.uid IN ($1, $2)
        AND r.channex_booking_id IS NOT NULL
    `, [UID_A, UID_B]);

    let realBugCount = 0;
    r.rows.forEach(row => {
      if (!row.log_val) { console.log(`  ${row.uid} : pas de log Channex pour comparer`); return; }
      const match = row.db_paris === row.log_val;
      console.log(`  ${row.uid.slice(0,12)}…`);
      console.log(`    to_char(Paris) = ${row.db_paris}  log = ${row.log_val}  ${match ? '✅ MATCH' : '⚠️ ECART'}`);
      if (!match) realBugCount++;
    });

    if (realBugCount === 0) {
      console.log('\n  ✅  OFFSET-10 = NON : les dates DB (en timezone Paris) correspondent aux logs.');
      console.log('     → Aucun bug de données en production.');
      console.log('     → Le -1 jour était entièrement un artefact du script d().');
    } else {
      console.log(`\n  ⚠️  OFFSET-10 = OUI : ${realBugCount} résa(s) avec écart DB vs log.`);
      console.log('     → Des données incorrectes existent en production.');
      console.log('     → Voir FORENSIC-11 pour les valeurs exactes avant toute correction.');
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-11', 'Correction code nécessaire OUI/NON');
  // ════════════════════════════════════════════════════════════════════════════
  {
    console.log('  Scripts diagnostics (diag-cdg5-forensic.js, diag-ab-priority.js) :');
    console.log('  → d() utilisait toISOString().slice(0,10) sur Date objects');
    console.log('  → Bug CONFIRMÉ si colonne = TIMESTAMPTZ avec session Paris');
    console.log('  → CORRECTION : remplacer d() par dParis() (toLocaleDateString Paris)');
    console.log('  → OU : utiliser to_char(col AT TIME ZONE \'Europe/Paris\') dans les queries SQL');
    console.log('');
    console.log('  Code production (server.js, channex.js) :');
    console.log('  → channex.js : reservationStart = string pure → PAS de correction nécessaire');
    console.log('  → server.js GET /api/reservations : envoie Date object → JSON.stringify → ISO');
    console.log('     iOS reçoit ISO timezone-aware → affiche correctement en Europe/Paris');
    console.log('  → server.js Channex sync (L280) : utilise AT TIME ZONE → correct');
    console.log('  → Autres lectures server.js sans AT TIME ZONE → vérifier si bug réel');
    console.log('');
    console.log('  OFFSET-11 = OUI (scripts diagnostics) / NON (code production)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('OFFSET-12', 'Correction DB nécessaire OUI/NON');
  // ════════════════════════════════════════════════════════════════════════════
  {
    console.log('  Dépend de OFFSET-10 :');
    console.log('');
    console.log('  Si OFFSET-10 = NON :');
    console.log('    → Données correctes (to_char Paris = log)');
    console.log('    → OFFSET-12 = NON');
    console.log('');
    console.log('  Si OFFSET-10 = OUI :');
    console.log('    → Des dates incorrectes sont en DB');
    console.log('    → Identifier les UIDs concernés et les corrections précises');
    console.log('    → Soumettre à validation avant tout UPDATE');
    console.log('    → OFFSET-12 = À DÉTERMINER selon résultats OFFSET-10');
  }

  await pool.end();
  console.log('\n── OFFSET diagnostic terminé ─────────────────────────────────────────\n');
}

run().catch(err => {
  console.error('Erreur fatale :', err.message);
  pool.end();
  process.exit(1);
});

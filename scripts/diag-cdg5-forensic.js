'use strict';
/**
 * CDG5-FORENSIC — Diagnostic approfondi du bloc calendrier anormal CDG5
 *
 * Objectif : identifier EXACTEMENT la/les lignes DB responsables du bloc Oct10→Oct27
 *            visible dans le calendrier, en simulant le pipeline complet GET /api/reservations.
 *
 * STRICTEMENT READ-ONLY — aucun INSERT, UPDATE, DELETE.
 *
 * Usage :
 *   DATABASE_URL=<url> node scripts/diag-cdg5-forensic.js
 *
 * FORENSIC-1  → propriété CDG5 trouvée
 * FORENSIC-2  → toutes réservations CDG5 sept-nov 2026 (tous statuts)
 * FORENSIC-3  → réservations annulées (exclues du store mais présentes en DB)
 * FORENSIC-4  → paires qui se chevauchent (toutes sources confondues)
 * FORENSIC-5  → simulation reservationsStore (miroir loadReservationsFromDB)
 * FORENSIC-6  → dateDedup collisions dans le store
 * FORENSIC-7  → filtre Airbnb > 60 jours
 * FORENSIC-8  → comportement Channex : store supprimé, version DB ajoutée
 * FORENSIC-9  → filtre final channex absent DB
 * FORENSIC-10 → résultat final simulé (ce que GET /api/reservations retourne)
 * FORENSIC-11 → analyse des résas connus CHX_9afc793d et CHX_285a6ba8
 * FORENSIC-12 → plages contiguës / fusion visuelle potentielle
 * FORENSIC-13 → vérification iCal actifs qui chevauchent les périodes CHX
 * FORENSIC-14 → logs channex_logs pour CDG5 en oct 2026
 * FORENSIC-15 → résas avec start_date entre Oct10 et Oct27 (toutes sources)
 * FORENSIC-16 → doublons uid identiques
 * FORENSIC-17 → enrichissement DB — JOIN conversations (start_date only)
 * FORENSIC-18 → channex_booking_id sur les résas CDG5
 * FORENSIC-19 → synthèse des hypothèses
 * FORENSIC-20 → conclusion et lignes suspects
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('\n❌  DATABASE_URL manquant.\n');
  console.error('  Commande :');
  console.error('  ! DATABASE_URL=<url> node scripts/diag-cdg5-forensic.js\n');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── helpers ────────────────────────────────────────────────────────────────

function d(v) {
  if (!v) return 'null';
  // Si pg retourne un Date object (colonne TIMESTAMPTZ), on lit en heure Paris
  // pour éviter le décalage UTC → -1 jour (server.js L280 applique le même workaround)
  if (v instanceof Date) return v.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  return String(v).slice(0, 10);
}

function banner(code, title) {
  const bar = '─'.repeat(Math.max(0, 70 - code.length - title.length - 3));
  console.log(`\n${code} — ${title} ${bar}`);
}

function days(start, end) {
  const s = start instanceof Date ? start : new Date(start);
  const e = end   instanceof Date ? end   : new Date(end);
  return Math.round((e - s) / 86400000);
}

function overlaps(s1, e1, s2, e2) {
  // Convention calendrier : fin exclusive (checkout day)
  return new Date(s1) < new Date(e2) && new Date(e1) > new Date(s2);
}

// ─── mirror : isIcalCoveredByChannex (server.js) ────────────────────────────
function isIcalCoveredByChannex(icalStart, icalEnd, chxRows) {
  const end = new Date(icalEnd);
  const sorted = [...chxRows].sort((a, b) => new Date(a.sd) - new Date(b.sd));
  let frontier = new Date(icalStart);
  for (const chx of sorted) {
    if (new Date(chx.sd) > frontier) break;
    const ce = new Date(chx.ed);
    if (ce > frontier) frontier = ce;
  }
  return frontier >= end;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function run() {
  let cdg5 = null;

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-1', 'Propriété CDG5');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const r = await pool.query(`
      SELECT id, name, internal_name, channex_property_id
      FROM properties
      WHERE UPPER(COALESCE(internal_name,'')) LIKE '%CDG5%'
         OR UPPER(COALESCE(internal_name,'')) LIKE '%CDG 5%'
         OR UPPER(name) LIKE '%CDG5%'
         OR UPPER(name) LIKE '%CDG 5%'
      LIMIT 5
    `);
    if (r.rows.length === 0) {
      console.log('  ❌  Aucune propriété CDG5 trouvée — vérifier le nom.');
      await pool.end(); return;
    }
    r.rows.forEach(p => {
      console.log(`  property_id=${p.id}  name="${p.name}"  internal_name="${p.internal_name}"  channex_property_id=${p.channex_property_id}`);
    });
    cdg5 = r.rows[0];
    console.log(`  ✅  Propriété retenue : id=${cdg5.id}`);
  }

  const propId = cdg5.id;
  const WINDOW_START = '2026-09-01';
  const WINDOW_END   = '2026-11-30';

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-2', 'Toutes réservations CDG5 sept–nov 2026 (TOUS statuts)');
  // ════════════════════════════════════════════════════════════════════════════
  let allRows = [];
  {
    const r = await pool.query(`
      SELECT
        id, uid, start_date, end_date,
        source, platform, ota_name, status,
        channex_booking_id, ota_reservation_id,
        guest_name,
        days_breakdown,
        created_at, updated_at
      FROM reservations
      WHERE property_id = $1
        AND (
          start_date < $3::date
          AND COALESCE(end_date, start_date + INTERVAL '1 day') > $2::date
        )
      ORDER BY start_date ASC, created_at ASC
    `, [propId, WINDOW_START, WINDOW_END]);

    allRows = r.rows;
    console.log(`  Total : ${allRows.length} ligne(s)`);
    console.log('');
    allRows.forEach((row, i) => {
      const dbCount = row.days_breakdown ? Object.keys(row.days_breakdown).length : 0;
      const span    = row.end_date ? days(row.start_date, row.end_date) : '?';
      console.log(
        `  [${String(i+1).padStart(2)}] uid=${row.uid || 'null'}`
        + `\n       source=${row.source}  platform=${row.platform || '-'}  ota=${row.ota_name || '-'}`
        + `\n       start=${d(row.start_date)}  end=${d(row.end_date)}`
        + `  span=${span}n  breakdown_keys=${dbCount}`
        + `\n       status=${row.status}  channex_booking_id=${row.channex_booking_id || '-'}`
        + `\n       created=${d(row.created_at)}  updated=${d(row.updated_at)}`
      );
    });
  }

  const activeRows    = allRows.filter(r => r.status !== 'cancelled');
  const cancelledRows = allRows.filter(r => r.status === 'cancelled');

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-3', 'Réservations annulées (absentes du store)');
  // ════════════════════════════════════════════════════════════════════════════
  {
    if (cancelledRows.length === 0) {
      console.log('  ✅  Aucune réservation annulée dans la fenêtre.');
    } else {
      cancelledRows.forEach(row => {
        console.log(`  ⚠️  uid=${row.uid}  start=${d(row.start_date)}→${d(row.end_date)}`
          + `  source=${row.source}  cancelled à ${d(row.updated_at)}`);
      });
      console.log(`\n  ℹ️  Les résas annulées NE figurent PAS dans reservationsStore.`);
      console.log(`       Mais si un iCal correspondant existe, il sera traité normalement.`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-4', 'Chevauchements entre toutes paires (tous statuts)');
  // ════════════════════════════════════════════════════════════════════════════
  {
    let found = 0;
    for (let i = 0; i < allRows.length; i++) {
      for (let j = i + 1; j < allRows.length; j++) {
        const a = allRows[i], b = allRows[j];
        if (!a.start_date || !a.end_date || !b.start_date || !b.end_date) continue;
        if (overlaps(a.start_date, a.end_date, b.start_date, b.end_date)) {
          found++;
          console.log(`  ⚠️  CHEVAUCHEMENT [${i+1}]×[${j+1}]`);
          console.log(`       A: ${d(a.start_date)}→${d(a.end_date)}  uid=${a.uid}  source=${a.source}  status=${a.status}`);
          console.log(`       B: ${d(b.start_date)}→${d(b.end_date)}  uid=${b.uid}  source=${b.source}  status=${b.status}`);
        }
      }
    }
    if (found === 0) console.log('  ✅  Aucun chevauchement détecté parmi les paires de lignes DB.');
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-5', 'Simulation reservationsStore (miroir loadReservationsFromDB)');
  // ════════════════════════════════════════════════════════════════════════════
  // loadReservationsFromDB : WHERE status != 'cancelled'
  // Seuls les non-channex y entrent (channex sera surchargé par DB version)
  let storeRows = [];
  {
    const r = await pool.query(`
      SELECT id, uid, start_date, end_date, source, platform, status,
             created_at, updated_at, synced_at
      FROM reservations
      WHERE property_id = $1
        AND status != 'cancelled'
        AND (
          start_date < $3::date
          AND COALESCE(end_date, start_date + INTERVAL '1 day') > $2::date
        )
      ORDER BY start_date ASC
    `, [propId, WINDOW_START, WINDOW_END]);

    storeRows = r.rows;
    console.log(`  Lignes chargées dans le store (non-cancelled) : ${storeRows.length}`);
    storeRows.forEach((row, i) => {
      console.log(`  [${i+1}] uid=${row.uid}  start=${d(row.start_date)}→${d(row.end_date)}`
        + `  source=${row.source}  status=${row.status}`);
    });

    const chxInStore = storeRows.filter(r => r.source === 'channex');
    if (chxInStore.length > 0) {
      console.log(`\n  ℹ️  ${chxInStore.length} résas source=channex dans le store`);
      console.log(`       → seront REMPLACÉES par la version DB dans GET /api/reservations`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-6', 'dateDedup — collisions ${start}_${end}');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // Miroir exact du dateDedup dans GET /api/reservations
    const dateDedup = new Map();
    for (const r of storeRows) {
      const s = r.start_date ? String(r.start_date).slice(0, 10) : '';
      const e = r.end_date   ? String(r.end_date).slice(0, 10)   : '';
      if (!s || !e) { dateDedup.set(Math.random(), { r, ts: '' }); continue; }
      const dk = `${s}_${e}`;
      const rTs = String(r.updated_at || r.created_at || '');
      const existing = dateDedup.get(dk);
      if (!existing || rTs > existing.ts) dateDedup.set(dk, { r, ts: rTs });
    }
    const afterDedup = [...dateDedup.values()].map(v => v.r);
    const dropped = storeRows.length - afterDedup.length;

    if (dropped === 0) {
      console.log(`  ✅  Aucune collision dateDedup. ${afterDedup.length} résas après dédup.`);
    } else {
      console.log(`  ⚠️  ${dropped} résa(s) éliminée(s) par dateDedup !`);
      // Identifier les pertes
      const afterUids = new Set(afterDedup.map(r => r.uid));
      storeRows.filter(r => !afterUids.has(r.uid)).forEach(r => {
        console.log(`       Perdue: uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  source=${r.source}`);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-7', 'Filtre Airbnb > 60 jours');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const airbnbRows = storeRows.filter(r =>
      (r.source || '').toUpperCase().includes('AIRBNB') ||
      (r.platform || '').toLowerCase().includes('airbnb')
    );
    if (airbnbRows.length === 0) {
      console.log('  ✅  Aucune résa Airbnb dans le store pour CDG5 (fenêtre).');
    } else {
      airbnbRows.forEach(r => {
        const dur = r.end_date ? days(r.start_date, r.end_date) : null;
        const filtered = dur !== null && dur > 60;
        console.log(`  Airbnb uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}`
          + `  dur=${dur}j  ${filtered ? '⚠️  FILTRÉ (>60j)' : '✅  conservé'}`);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-8', 'Channex DB override — version store écartée, DB ajoutée');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const dbChannexRows = activeRows.filter(r => r.source === 'channex');
    const storeChannexRows = storeRows.filter(r => r.source === 'channex');

    console.log(`  Channex actifs en DB     : ${dbChannexRows.length}`);
    dbChannexRows.forEach(r => {
      console.log(`    DB  uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  status=${r.status}`);
    });

    console.log(`  Channex dans le store    : ${storeChannexRows.length}`);
    storeChannexRows.forEach(r => {
      console.log(`    STR uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  status=${r.status}`);
    });

    // Résas dans le store avec uid DIFFÉRENT des DB channex actifs → fantôme potentiel
    const dbChxUids = new Set(dbChannexRows.map(r => r.uid));
    const ghosts = storeChannexRows.filter(r => !dbChxUids.has(r.uid));
    if (ghosts.length > 0) {
      console.log(`\n  ⚠️  ${ghosts.length} fantôme(s) — dans le store mais PLUS en DB active :`);
      ghosts.forEach(r => {
        console.log(`    GHOST uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}`);
      });
    } else {
      console.log(`\n  ✅  Aucun fantôme — store et DB cohérents.`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-9', 'Filtre final — channex absent DB');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // GET /api/reservations retire aussi les blocs BLOCK absents de la DB
    // Ici on se concentre sur CDG5 et les résas channex
    const dbChxUids = new Set(activeRows.filter(r => r.source === 'channex').map(r => r.uid));
    const storeChxUids = storeRows.filter(r => r.source === 'channex').map(r => r.uid);
    const wouldFilter = storeChxUids.filter(uid => !dbChxUids.has(uid));

    if (wouldFilter.length === 0) {
      console.log('  ✅  Aucune résa channex store filtrée par le filtre final.');
    } else {
      wouldFilter.forEach(uid => {
        const r = storeRows.find(x => x.uid === uid);
        console.log(`  ⚠️  Serait retirée : uid=${uid}  ${d(r?.start_date)}→${d(r?.end_date)}`);
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-10', 'Résultat final simulé GET /api/reservations');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // Reconstituer le tableau final tel que GET /api/reservations le produirait
    // 1. Store non-channex (après dateDedup)
    const dateDedup = new Map();
    for (const r of storeRows) {
      const s = r.start_date ? String(r.start_date).slice(0, 10) : '';
      const e = r.end_date   ? String(r.end_date).slice(0, 10)   : '';
      if (!s || !e) { dateDedup.set(Math.random(), { r, ts: '' }); continue; }
      const dk = `${s}_${e}`;
      const rTs = String(r.updated_at || r.created_at || '');
      const existing = dateDedup.get(dk);
      if (!existing || rTs > existing.ts) dateDedup.set(dk, { r, ts: rTs });
    }
    let finalSim = [...dateDedup.values()].map(v => v.r);

    // 2. Retirer les Airbnb > 60j
    finalSim = finalSim.filter(r => {
      if ((r.source || '').toUpperCase().includes('AIRBNB') || (r.platform || '').toLowerCase().includes('airbnb')) {
        const dur = r.end_date ? days(r.start_date, r.end_date) : 0;
        if (dur > 60) return false;
      }
      return true;
    });

    // 3. Channex : retirer version store, ajouter version DB
    finalSim = finalSim.filter(r => r.source !== 'channex');
    const dbChannexActive = activeRows.filter(r => r.source === 'channex');
    finalSim.push(...dbChannexActive);

    // 4. Filtre final (channex non en DB = déjà géré, ici pas d'annulés dans activeRows)

    // 5. Trier
    finalSim.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    console.log(`  Résas finales simulées : ${finalSim.length}`);
    finalSim.forEach((r, i) => {
      const dur = r.end_date ? days(r.start_date, r.end_date) : '?';
      console.log(`  [${i+1}] ${d(r.start_date)}→${d(r.end_date)}  (${dur}n)`
        + `  uid=${r.uid}  source=${r.source}  status=${r.status || 'active'}`);
    });

    // Vérifier si deux résas consécutives se touchent ou se chevauchent
    console.log('');
    console.log('  Analyse des adjacences/chevauchements dans le résultat final :');
    let anomalies = 0;
    for (let i = 0; i < finalSim.length - 1; i++) {
      const a = finalSim[i], b = finalSim[i+1];
      if (!a.end_date || !b.start_date) continue;
      const aEnd   = d(a.end_date);
      const bStart = d(b.start_date);
      if (overlaps(a.start_date, a.end_date, b.start_date, b.end_date)) {
        anomalies++;
        console.log(`  ⚠️  CHEVAUCHEMENT [${i+1}]×[${i+2}]`);
        console.log(`       A: ${d(a.start_date)}→${aEnd}  uid=${a.uid}`);
        console.log(`       B: ${bStart}→${d(b.end_date)}  uid=${b.uid}`);
      } else if (aEnd === bStart) {
        console.log(`  ℹ️  CONTIGU [${i+1}]→[${i+2}]  : A.end=${aEnd} = B.start=${bStart}`
          + `  (peut fusionner visuellement sur certains clients)`);
      }
    }
    if (anomalies === 0) console.log('  ✅  Aucun chevauchement dans la sortie finale simulée.');
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-11', 'Analyse des résas connues CHX_9afc793d et CHX_285a6ba8');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const known = ['CHX_9afc793d', 'CHX_285a6ba8'];
    for (const uid of known) {
      const r = await pool.query(
        `SELECT id, uid, start_date, end_date, source, platform, ota_name, status,
                channex_booking_id, ota_reservation_id,
                guest_name, amount_total, days_breakdown,
                created_at, updated_at
         FROM reservations WHERE uid = $1`,
        [uid]
      );
      if (r.rows.length === 0) {
        // Chercher par préfixe (l'uid peut avoir un suffixe)
        const r2 = await pool.query(
          `SELECT id, uid, start_date, end_date, source, status, channex_booking_id,
                  days_breakdown, created_at, updated_at
           FROM reservations WHERE uid LIKE $1 LIMIT 3`,
          [uid.slice(0, 12) + '%']
        );
        if (r2.rows.length === 0) {
          console.log(`  ⚠️  ${uid} introuvable (ni uid exact ni préfixe).`);
        } else {
          r2.rows.forEach(row => {
            console.log(`  Préfixe ${uid.slice(0,12)}…  → uid=${row.uid}  ${d(row.start_date)}→${d(row.end_date)}  status=${row.status}`);
          });
        }
        continue;
      }
      const row = r.rows[0];
      const breakdown = row.days_breakdown ? Object.keys(row.days_breakdown) : [];
      const span = row.end_date ? days(row.start_date, row.end_date) : '?';
      console.log(`  ${uid}`);
      console.log(`    start=${d(row.start_date)}  end=${d(row.end_date)}  span=${span}n  status=${row.status}`);
      console.log(`    source=${row.source}  ota_name=${row.ota_name || '-'}  channex_booking_id=${row.channex_booking_id || '-'}`);
      console.log(`    guest=${row.guest_name || '-'}  amount=${row.amount_total || '-'}`);
      console.log(`    days_breakdown: ${breakdown.length} clés  [${breakdown.slice(0,3).join(', ')}${breakdown.length>3?'…':''}]`);
      console.log(`    created=${d(row.created_at)}  updated=${d(row.updated_at)}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-12', 'Plages contiguës et fusion visuelle potentielle');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // CHX_9afc793d est Oct10→Oct15 et CHX_285a6ba8 est Oct20→Oct27
    // Le bloc anormal est Oct10→Oct27 — y a-t-il une ligne avec ces dates exactes ?
    const suspectFull = allRows.filter(r => {
      const s = d(r.start_date), e = d(r.end_date);
      return s === '2026-10-10' && e === '2026-10-27';
    });
    if (suspectFull.length > 0) {
      console.log(`  ⚠️  Ligne(s) avec start=Oct10 ET end=Oct27 (bloc fusionné) :`);
      suspectFull.forEach(r => console.log(`    uid=${r.uid}  source=${r.source}  status=${r.status}`));
    } else {
      console.log(`  ✅  Aucune ligne avec exactement Oct10→Oct27.`);
    }

    // Y a-t-il une résa qui chevauche à la fois Oct10→Oct15 ET Oct20→Oct27 ?
    const bridgeRows = allRows.filter(r => {
      if (!r.start_date || !r.end_date) return false;
      const inFirst  = overlaps(r.start_date, r.end_date, '2026-10-10', '2026-10-15');
      const inSecond = overlaps(r.start_date, r.end_date, '2026-10-20', '2026-10-27');
      return inFirst && inSecond;
    });
    if (bridgeRows.length > 0) {
      console.log(`\n  ⚠️  Ligne(s) chevauchant SIMULTANÉMENT les deux périodes CHX (Oct10-15 ET Oct20-27) :`);
      bridgeRows.forEach(r => {
        console.log(`    uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  source=${r.source}  status=${r.status}`);
      });
    } else {
      console.log(`\n  ✅  Aucune ligne ne pont-courte les deux blocs CHX simultanément.`);
    }

    // Recherche d'un iCal ou bloc BLOCK couvrant Oct15→Oct20
    const gapFillers = allRows.filter(r => {
      if (!r.start_date || !r.end_date) return false;
      return overlaps(r.start_date, r.end_date, '2026-10-15', '2026-10-20');
    });
    if (gapFillers.length > 0) {
      console.log(`\n  ℹ️  Lignes couvrant le gap Oct15→Oct20 :`);
      gapFillers.forEach(r => {
        console.log(`    uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  source=${r.source}  status=${r.status}`);
      });
    } else {
      console.log(`\n  ✅  Aucune ligne ne couvre le gap Oct15→Oct20.`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-13', 'iCal actifs chevauchant les périodes CHX');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // Les iCal ont source='AIRBNB', 'BOOKING', ou autre avec raw_ical_data
    const icalRows = allRows.filter(r => r.source !== 'channex' && r.source !== 'MANUEL' && r.source !== 'DIRECT');
    console.log(`  iCal non-channex dans la fenêtre : ${icalRows.length}`);
    if (icalRows.length > 0) {
      icalRows.forEach(r => {
        console.log(`    uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  source=${r.source}  status=${r.status}`);
      });

      // Vérifier si ces iCal seraient couverts par les deux CHX
      const chxCoverage = [
        { sd: new Date('2026-10-10'), ed: new Date('2026-10-15') },
        { sd: new Date('2026-10-20'), ed: new Date('2026-10-27') }
      ];
      icalRows.forEach(r => {
        if (!r.start_date || !r.end_date) return;
        const covered = isIcalCoveredByChannex(r.start_date, r.end_date, chxCoverage);
        if (covered) {
          console.log(`    ⚠️  COUVERT par CHX → serait ignoré par isIcalCoveredByChannex : uid=${r.uid}`);
        } else {
          console.log(`    ✅  NON couvert → affiché normalement : uid=${r.uid}`);
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-14', 'Logs channex_logs pour CDG5 en oct–nov 2026');
  // ════════════════════════════════════════════════════════════════════════════
  {
    try {
      const r = await pool.query(`
        SELECT id, event_type, direction, payload, created_at
        FROM channex_logs
        WHERE property_id = $1
          AND created_at >= '2026-09-01'
          AND created_at <  '2026-12-01'
        ORDER BY created_at DESC
        LIMIT 30
      `, [propId]);

      if (r.rows.length === 0) {
        console.log('  (aucun log channex pour CDG5 dans la fenêtre)');
      } else {
        console.log(`  ${r.rows.length} log(s) :`);
        r.rows.forEach(row => {
          const p = row.payload || {};
          const bid = p.booking_id || '-';
          const rs  = p.reservation_start || p.room0_checkin || '-';
          const re  = p.reservation_end   || p.room0_checkout || '-';
          console.log(`  ${d(row.created_at)}  ${row.event_type}  booking_id=${bid}  res=${rs}→${re}`);
        });
      }
    } catch (e) {
      console.log(`  ⚠️  Erreur channex_logs : ${e.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-15', 'Résas avec start_date entre Oct10 et Oct27 (toutes sources)');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const r = await pool.query(`
      SELECT uid, start_date, end_date, source, platform, ota_name, status,
             channex_booking_id, created_at, updated_at
      FROM reservations
      WHERE property_id = $1
        AND start_date >= '2026-10-10'::date
        AND start_date <= '2026-10-27'::date
      ORDER BY start_date ASC
    `, [propId]);

    console.log(`  ${r.rows.length} ligne(s) :`);
    r.rows.forEach(row => {
      const span = row.end_date ? days(row.start_date, row.end_date) : '?';
      console.log(`    ${d(row.start_date)}→${d(row.end_date)}  (${span}n)  uid=${row.uid}`
        + `  source=${row.source}  status=${row.status}  chx_bid=${row.channex_booking_id || '-'}`);
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-16', 'Doublons uid identiques');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const r = await pool.query(`
      SELECT uid, COUNT(*) as cnt
      FROM reservations
      WHERE property_id = $1
        AND start_date >= '2026-09-01'::date
        AND start_date < '2026-12-01'::date
      GROUP BY uid
      HAVING COUNT(*) > 1
    `, [propId]);

    if (r.rows.length === 0) {
      console.log('  ✅  Aucun uid dupliqué pour CDG5 dans la fenêtre.');
    } else {
      console.log(`  ⚠️  ${r.rows.length} uid(s) dupliqué(s) :`);
      r.rows.forEach(row => console.log(`    uid=${row.uid}  cnt=${row.cnt}`));
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-17', 'Enrichissement DB — JOIN conversations (start_date seul)');
  // ════════════════════════════════════════════════════════════════════════════
  {
    // LEFT JOIN conversations ON c.property_id = r.property_id AND c.reservation_start_date = r.start_date
    // Un JOIN sur start_date seul peut lier une conversation à la mauvaise réservation si deux résas
    // ont la même start_date mais des end_dates différentes.
    const r = await pool.query(`
      SELECT r.uid, r.start_date, r.end_date, r.source,
             c.id as conv_id, c.reservation_start_date as conv_start
      FROM reservations r
      LEFT JOIN conversations c
        ON c.property_id = r.property_id
        AND c.reservation_start_date = r.start_date
      WHERE r.property_id = $1
        AND r.start_date >= '2026-09-01'::date
        AND r.start_date <  '2026-12-01'::date
        AND r.status != 'cancelled'
      ORDER BY r.start_date ASC
    `, [propId]);

    const byStart = new Map();
    r.rows.forEach(row => {
      const k = d(row.start_date);
      if (!byStart.has(k)) byStart.set(k, []);
      byStart.get(k).push(row);
    });

    let collisions = 0;
    byStart.forEach((rows, sd) => {
      if (rows.length > 1) {
        collisions++;
        console.log(`  ⚠️  Collision JOIN start_date=${sd} : ${rows.length} résas partagent la même date d'arrivée`);
        rows.forEach(r => console.log(`    uid=${r.uid}  end=${d(r.end_date)}  source=${r.source}  conv_id=${r.conv_id || 'null'}`));
      }
    });

    if (collisions === 0) {
      console.log('  ✅  Aucune collision JOIN conversations (start_dates toutes uniques).');
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-18', 'channex_booking_id sur résas CDG5');
  // ════════════════════════════════════════════════════════════════════════════
  {
    const r = await pool.query(`
      SELECT uid, start_date, end_date, channex_booking_id, ota_reservation_id,
             source, status, created_at, updated_at
      FROM reservations
      WHERE property_id = $1
        AND start_date >= '2026-09-01'::date
        AND start_date <  '2026-12-01'::date
      ORDER BY start_date ASC
    `, [propId]);

    r.rows.forEach(row => {
      console.log(`  uid=${row.uid}`);
      console.log(`    ${d(row.start_date)}→${d(row.end_date)}  status=${row.status}  source=${row.source}`);
      console.log(`    channex_booking_id=${row.channex_booking_id || 'null'}  ota_reservation_id=${row.ota_reservation_id || 'null'}`);
      console.log(`    created=${d(row.created_at)}  updated=${d(row.updated_at)}`);
    });

    // Détecter les channex_booking_id partagés entre plusieurs résas
    const byBid = new Map();
    r.rows.filter(x => x.channex_booking_id).forEach(row => {
      const bid = row.channex_booking_id;
      if (!byBid.has(bid)) byBid.set(bid, []);
      byBid.get(bid).push(row);
    });
    byBid.forEach((rows, bid) => {
      if (rows.length > 1) {
        console.log(`\n  ⚠️  channex_booking_id="${bid}" partagé par ${rows.length} lignes :`);
        rows.forEach(r => console.log(`    uid=${r.uid}  ${d(r.start_date)}→${d(r.end_date)}  status=${r.status}`));
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-19', 'Synthèse des hypothèses');
  // ════════════════════════════════════════════════════════════════════════════
  {
    console.log(`
  Hypothèses initiales et statut après forensic :

  H1 — Multi-room bug (B3) : parent dates utilisées au lieu des room-level dates
       → Hypothèse principale — vérifiée par FORENSIC-11 et FORENSIC-2
       → Si CHX_285a6ba8 a start=Oct10 en DB (au lieu de Oct20) : BUG CONFIRMÉ

  H2 — reservationsStore fantôme : ancienne résa toujours dans le store
       → Vérifiée par FORENSIC-8 (store vs DB channex)

  H3 — dateDedup collision : deux résas différentes mêmes dates → fusion
       → Vérifiée par FORENSIC-6

  H4 — iCal Oct10→Oct27 non filtré par CAS A
       → Vérifiée par FORENSIC-13

  H5 — Ligne DB avec start=Oct10 end=Oct27 (données incorrectes persistées avant CHXROOMFIX)
       → Vérifiée par FORENSIC-12 (pont Oct10→Oct27)

  H6 — channex_booking_id partagé → enrichissement DB croise deux résas
       → Vérifiée par FORENSIC-18
    `);
  }

  // ════════════════════════════════════════════════════════════════════════════
  banner('FORENSIC-20', 'Conclusion et lignes suspects');
  // ════════════════════════════════════════════════════════════════════════════
  {
    console.log(`  Données attendues (d'après contexte) :`);
    console.log(`    CHX_9afc793d : Oct10→Oct15 (5 nuits)`);
    console.log(`    CHX_285a6ba8 : Oct20→Oct27 (7 nuits)`);
    console.log(`\n  Bloc visible dans le calendrier : Oct10→Oct27 (17 nuits)`);
    console.log(`\n  Piste principale :`);
    console.log(`    Si CHX_285a6ba8.start_date = 2026-10-10 en base → H1 confirmée`);
    console.log(`    (booking multi-room Booking.com : arrival_date parent = Oct10,`);
    console.log(`     rooms[0].checkin_date = Oct20 → CHXROOMFIX corrige pour les futurs webhooks`);
    console.log(`     mais la ligne existante en DB a été créée AVANT le fix)`);
    console.log(`\n  Si H1 confirmée → action requise :`);
    console.log(`    UPDATE reservations SET start_date='2026-10-20' WHERE uid='CHX_285a6ba8...'`);
    console.log(`    (à valider avec l'utilisateur avant exécution)`);
  }

  await pool.end();
  console.log('\n── Forensic terminé ─────────────────────────────────────────────────────\n');
}

run().catch(err => {
  console.error('Erreur fatale :', err.message);
  pool.end();
  process.exit(1);
});

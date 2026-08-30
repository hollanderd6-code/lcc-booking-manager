#!/usr/bin/env node
/* ============================================================
   outils/verif-hold-channex.js
   Le logement est-il VRAIMENT bloque chez Channex ?
   ============================================================
   LECTURE SEULE. Ce script n'ecrit rien, ni en base, ni chez Channex.

   ── POURQUOI ─────────────────────────────────────────────────────
   Quand un lien BHGuest est cree, server.js appelle pushAvailability
   puis journalise « 🔒 [HOLD] Channex bloqué … (4h) ». Ce message ne
   prouve rien : il est ecrit apres l'APPEL, pas apres une verification.
   Si Channex refuse la mise a jour, ou l'accepte sans la propager au
   bon plan tarifaire, le log dit « bloqué » et la nuit reste en vente.

   Ce script va donc chercher la reponse chez Channex, et la compare a
   ce que votre base croit.

   ── CE QU'IL AFFICHE ─────────────────────────────────────────────
   1. Ce que la base sait : holds actifs et reservations sur ces dates.
   2. Ce que Channex repond : la disponibilite par date et par plan.
   3. Le verdict : 0 = bloque, >0 = encore vendable.

   Une disponibilite a 0 chez Channex ne garantit pas encore qu'Airbnb
   l'a recu — Channex pousse ensuite vers chaque canal. La preuve finale
   reste le calendrier Airbnb. Mais si Channex dit deja « 1 », le
   probleme est chez nous et le detour par Airbnb est inutile.

   Usage :
     node outils/verif-hold-channex.js M13 2027-01-15 2027-01-16
     node outils/verif-hold-channex.js u_mmj5c6hq-m13 2027-01-15 2027-01-16
   ============================================================ */

'use strict';

require('dotenv').config();

const [, , cible, checkin, checkout] = process.argv;

function usage(msg) {
  if (msg) console.error('\n  \u2717 ' + msg);
  console.error('\n  Usage : node outils/verif-hold-channex.js <logement> <checkin> <checkout>');
  console.error('  Exemple : node outils/verif-hold-channex.js M13 2027-01-15 2027-01-16\n');
  process.exit(1);
}

if (!cible || !checkin || !checkout) usage();
if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
  usage('Les dates doivent s\'ecrire AAAA-MM-JJ.');
}

const { Pool } = require('pg');
const urlBase = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL;
if (!urlBase) usage('Aucune variable DATABASE_URL dans .env — je ne sais pas a quelle base me connecter.');

const pool = new Pool({
  connectionString: urlBase,
  ssl: /localhost|127\.0\.0\.1/.test(urlBase) ? false : { rejectUnauthorized: false }
});

/* Les nuits concernees : du checkin (inclus) au checkout (exclu). */
function nuits(a, b) {
  const out = [];
  const d = new Date(a + 'T00:00:00Z');
  const fin = new Date(b + 'T00:00:00Z');
  while (d < fin) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function titre(t) { console.log('\n\u2500\u2500 ' + t + ' ' + '\u2500'.repeat(Math.max(0, 58 - t.length))); }

(async function () {
  const dates = nuits(checkin, checkout);
  if (!dates.length) usage('checkout doit etre posterieur a checkin.');

  /* ── 1. Le logement ──────────────────────────────────────── */
  const { rows: props } = await pool.query(
    `SELECT id, name, channex_enabled, channex_property_id, channex_room_type_id
       FROM properties WHERE id = $1 OR name = $1 LIMIT 1`,
    [cible]
  );
  const p = props[0];
  if (!p) { console.error('\n  \u2717 Logement introuvable : ' + cible + '\n'); process.exit(1); }

  titre('LE LOGEMENT');
  console.log('  ' + p.name + '  (' + p.id + ')');
  console.log('  Channex actif      : ' + (p.channex_enabled ? 'oui' : 'NON'));
  console.log('  channex_property_id: ' + (p.channex_property_id || 'absent'));
  console.log('  channex_room_type  : ' + (p.channex_room_type_id || 'absent'));
  console.log('  Nuits verifiees    : ' + dates.join(', '));

  if (!p.channex_enabled || !p.channex_property_id) {
    console.log('\n  \u2192 Sans rattachement Channex, aucun blocage ne peut partir.');
    console.log('    Le hold n\'existe que dans votre base : les plateformes vendent toujours.\n');
    await pool.end();
    return;
  }

  /* ── 2. Ce que la base croit ─────────────────────────────── */
  titre('CE QUE VOTRE BASE SAIT');
  const { rows: holds } = await pool.query(
    `SELECT link_token, checkin, checkout, status, created_at, expires_at,
            (status = 'active' AND expires_at > NOW()) AS tient_encore
       FROM bhguest_holds
      WHERE property_id = $1 AND checkout > $2 AND checkin < $3
      ORDER BY created_at DESC LIMIT 5`,
    [p.id, checkin, checkout]
  );
  if (!holds.length) console.log('  Aucun hold sur ces dates.');
  holds.forEach(h => {
    console.log('  hold ' + h.link_token.slice(0, 12) + '\u2026  ' + h.checkin + ' \u2192 ' + h.checkout
      + '  ' + h.status + (h.tient_encore ? '  (actif, expire ' + new Date(h.expires_at).toLocaleString('fr-FR') + ')' : ''));
  });

  const { rows: resas } = await pool.query(
    `SELECT uid, source, ota_name, status,
            to_char(start_date AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') AS s,
            to_char(end_date   AT TIME ZONE 'Europe/Paris','YYYY-MM-DD') AS e,
            created_at
       FROM reservations
      WHERE property_id = $1 AND status NOT IN ('cancelled')
        AND end_date > $2::date AND start_date < $3::date
      ORDER BY created_at DESC LIMIT 5`,
    [p.id, checkin, checkout]
  );
  resas.forEach(r => {
    console.log('  resa ' + r.s + ' \u2192 ' + r.e + '  ' + (r.ota_name || r.source || '?')
      + '  cree le ' + new Date(r.created_at).toLocaleString('fr-FR') + '  (' + r.uid + ')');
  });
  if (!resas.length) console.log('  Aucune reservation sur ces dates.');

  const attendu = holds.some(h => h.tient_encore) || resas.length > 0;
  console.log('  \u2192 La base attend donc : ' + (attendu ? 'BLOQUE (0)' : 'vendable'));

  /* ── 3. Ce que Channex repond ────────────────────────────── */
  titre('CE QUE CHANNEX REPOND');
  if (!process.env.CHANNEX_API_KEY) {
    console.log('  CHANNEX_API_KEY absente de .env : impossible d\'interroger Channex.');
    console.log('  (Le script s\'arrete la, sans conclure.)\n');
    await pool.end();
    return;
  }

  const { channexAPI } = require('../channex');
  let lignes = [];
  try {
    const r = await channexAPI.get('/availability', {
      params: {
        'filter[property_id]': p.channex_property_id,
        'filter[date][gte]': dates[0],
        'filter[date][lte]': dates[dates.length - 1]
      }
    });
    const data = r.data && (r.data.data || r.data);
    lignes = Array.isArray(data) ? data : [];
    if (!lignes.length) {
      console.log('  Reponse recue mais vide ou de forme inattendue. Brut :');
      console.log('  ' + JSON.stringify(r.data).slice(0, 900));
    }
  } catch (e) {
    const st = e.response && e.response.status;
    console.log('  \u2717 Appel refuse' + (st ? ' (HTTP ' + st + ')' : '') + ' : ' + e.message);
    if (e.response && e.response.data) console.log('  ' + JSON.stringify(e.response.data).slice(0, 700));
    console.log('\n  Un refus ici signifie que le blocage envoye a la creation du lien a pu');
    console.log('  echouer de la meme facon, sans que le log le dise.\n');
    await pool.end();
    return;
  }

  /* Channex renvoie une ligne par date et par room_type ; on ne garde que
     le notre quand il est connu, sinon on affiche tout. */
  let vendable = false;
  lignes.forEach(l => {
    const a = l.attributes || l;
    const rt = a.room_type_id || (l.relationships && l.relationships.room_type
      && l.relationships.room_type.data && l.relationships.room_type.data.id);
    if (p.channex_room_type_id && rt && rt !== p.channex_room_type_id) return;
    const dispo = a.availability != null ? a.availability : a.available_rooms;
    const jour = a.date;
    if (!dates.includes(jour)) return;
    const bloque = Number(dispo) === 0;
    if (!bloque) vendable = true;
    console.log('  ' + jour + '  disponibilite = ' + dispo + '   ' + (bloque ? '\u2713 bloque' : '\u2717 ENCORE VENDABLE'));
  });

  /* ── 4. Le verdict ───────────────────────────────────────── */
  titre('VERDICT');
  if (attendu && vendable) {
    console.log('  \u2717 DESACCORD. Votre base tient ces nuits, Channex les vend encore.');
    console.log('    Le message « 🔒 [HOLD] Channex bloqué » est donc trompeur : il est');
    console.log('    ecrit apres l\'appel, sans verifier la reponse. C\'est la cause de');
    console.log('    la reservation Airbnb tombee 20 minutes apres un lien.');
  } else if (attendu && !vendable) {
    console.log('  \u2713 Accord : Channex a bien la disponibilite a 0 sur ces nuits.');
    console.log('    Reste la derniere etape, hors de portee d\'ici : verifier le');
    console.log('    calendrier Airbnb de ce logement sur cette date. Si Airbnb la vend');
    console.log('    encore, le defaut est dans la propagation Channex \u2192 canal.');
  } else if (!attendu && !vendable) {
    console.log('  \u26a0 Channex bloque des nuits que votre base croit libres.');
    console.log('    Blocage fantome : des nuits invendables sans raison.');
  } else {
    console.log('  \u2713 Accord : rien ne bloque, de part et d\'autre.');
  }
  console.log('');

  await pool.end();
})().catch(e => {
  console.error('\n  \u2717 ' + e.message + '\n');
  process.exit(1);
});

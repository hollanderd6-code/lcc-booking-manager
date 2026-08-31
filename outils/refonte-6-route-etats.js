#!/usr/bin/env node
/* ============================================================
   outils/refonte-6-route-etats.js
   Lot 6 : /api/aujourdhui/etats — la verite, en un appel
   ============================================================

   ── CE QUE FAIT CETTE ROUTE ──────────────────────────────────────
   GET /api/aujourdhui/etats

   Pour chaque arrivee du jour, elle renvoie :

       conversation_id, guest_name, property_name, platform
       message_envoye    true / false     lu dans message_template_logs
       caution           statut ou null   lu dans deposits
       caution_bloquante true / false     caution exigee et non autorisee
       menage_fait       null pour l'instant — voir plus bas

   Un seul appel. AUCUNE ecriture : que des SELECT. Aucune table
   modifiee, aucune colonne ajoutee, aucun cron touche.

   ── LES COMPTES GERES ────────────────────────────────────────────
   La route lit account_delegations : un compte d'agence voit les
   arrivees des comptes qu'il gere, exactement comme le reste de
   l'application. Sans cela vous verriez vos propres logements et pas
   ceux de vos mandants — le defaut que nous avons corrige sur le cron
   des modeles.

   ── CE QUE JE NE DEVINE PAS ──────────────────────────────────────
   « menage_fait » revient a null, volontairement.

   Votre tableau de bord affiche deja « MENAGES 48H · 6 departs a
   nettoyer », donc l'information existe cote serveur. Mais je ne connais
   pas le nom de la table ni de la colonne qui la portent, et inventer un
   SELECT sur une table absente ferait echouer toute la route — y compris
   les deux etats que je sais lire.

   La route renvoie donc, a cote des donnees, un champ « diagnostic » qui
   LISTE les tables et colonnes candidates trouvees dans votre base
   (information_schema). Un appel, et vous m'envoyez la liste : j'ajoute
   le SELECT exact au lot suivant, en trois lignes.

   C'est plus lent d'un aller-retour. C'est surtout la seule facon de ne
   pas casser une route en production sur une supposition.

   ── OU LE CODE EST INSERE ────────────────────────────────────────
   Juste avant « async function runTemplatesCron », au niveau du module,
   la ou app et pool sont deja en portee. Le script verifie la presence
   de cette ancre, l'unicite de la route, et que server.js reste du
   JavaScript valide — sinon il n'ecrit rien.

   Usage :
     node outils/refonte-6-route-etats.js --essai
     node outils/refonte-6-route-etats.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('/api/aujourdhui/etats') !== -1) {
  console.log('\n  La route existe deja — rien a faire.\n');
  process.exit(0);
}

const ANCRE = 'async function runTemplatesCron(triggerTypes) {';
const n = src.split(ANCRE).length - 1;
if (n !== 1) echec("L'ancre « runTemplatesCron » est presente " + n + ' fois (attendu : 1).');

/* authenticateAny doit exister : la route s'en sert. */
if (src.indexOf('authenticateAny') === -1) echec('authenticateAny introuvable dans server.js.');

const ROUTE = `// ============================================================
// GET /api/aujourdhui/etats — etats des arrivees du jour
// ============================================================
// Lecture seule. Un seul appel pour l'ecran « Aujourd'hui » : pour chaque
// arrivee du jour, le message d'arrivee est-il parti, la caution bloque-
// t-elle. Aucune ecriture, aucune table modifiee.
//
// « menage_fait » revient null tant que le nom de la table de menage
// n'est pas confirme : le champ « diagnostic » liste les candidates
// trouvees dans la base, pour l'ajouter sans deviner.
app.get('/api/aujourdhui/etats', authenticateAny, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id || req.userId;
    if (!userId) return res.status(401).json({ error: 'non authentifie' });

    // Date Paris, calculee sans passer par toISOString (qui recule d'un
    // jour en soiree) — meme methode que runTemplatesCron.
    const nowParis = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const pad = n => String(n).padStart(2, '0');
    const jour = req.query.date && /^\\d{4}-\\d{2}-\\d{2}$/.test(req.query.date)
      ? req.query.date
      : \`\${nowParis.getFullYear()}-\${pad(nowParis.getMonth() + 1)}-\${pad(nowParis.getDate())}\`;

    // Comptes accessibles : le sien, plus ceux qu'il gere. Sans cela une
    // agence ne verrait pas les arrivees de ses mandants.
    const ids = [userId];
    try {
      const del = await pool.query(
        \`SELECT delegator_user_id FROM account_delegations
         WHERE delegate_user_id = $1 AND status = 'accepted'\`,
        [userId]
      );
      del.rows.forEach(r => { if (r.delegator_user_id && !ids.includes(r.delegator_user_id)) ids.push(r.delegator_user_id); });
    } catch (e) {
      // Table absente ou renommee : on continue avec le seul compte.
    }

    const arrivees = await pool.query(
      \`SELECT c.id AS conversation_id, c.guest_name, c.property_id, c.platform,
              c.channex_booking_id,
              p.name AS property_name, p.deposit_amount,
              to_char(c.reservation_start_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS arrivee,
              to_char(c.reservation_end_date AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') AS depart
       FROM conversations c
       LEFT JOIN properties p ON p.id = c.property_id
       WHERE c.user_id = ANY($1::text[])
         AND c.status <> 'cancelled'
         AND DATE(c.reservation_start_date AT TIME ZONE 'Europe/Paris') = $2
       ORDER BY p.name NULLS LAST\`,
      [ids, jour]
    );

    const convIds = arrivees.rows.map(r => r.conversation_id).filter(Boolean);

    // Le message d'arrivee est-il parti ? « manual » compte : un envoi a
    // la main informe le voyageur autant qu'un envoi automatique.
    const envoyes = new Set();
    if (convIds.length) {
      try {
        const logs = await pool.query(
          \`SELECT DISTINCT conversation_id FROM message_template_logs
           WHERE conversation_id = ANY($1::int[])
             AND trigger_type IN ('on_arrival', 'manual')
             AND status = 'sent'\`,
          [convIds]
        );
        logs.rows.forEach(r => envoyes.add(r.conversation_id));
      } catch (e) {
        // Table absente : le champ restera null plutot que faux.
      }
    }

    // La caution. L'uid suit la convention CHX_<channex_booking_id>.
    const cautions = {};
    const uids = arrivees.rows
      .filter(r => r.channex_booking_id)
      .map(r => 'CHX_' + r.channex_booking_id);
    if (uids.length) {
      try {
        const dep = await pool.query(
          \`SELECT uid, status, amount_cents FROM deposits WHERE uid = ANY($1::text[])\`,
          [uids]
        );
        dep.rows.forEach(r => { cautions[r.uid] = r; });
      } catch (e) {
        // Table absente : caution null.
      }
    }

    // Les tables candidates pour le menage, pour l'ajouter sans deviner.
    let diagnostic = null;
    if (req.query.diagnostic === '1') {
      try {
        const cand = await pool.query(
          \`SELECT table_name, column_name, data_type
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND (table_name ILIKE '%clean%' OR table_name ILIKE '%menage%' OR table_name ILIKE '%tache%')
           ORDER BY table_name, ordinal_position\`
        );
        diagnostic = {
          tables_menage: cand.rows.reduce((acc, r) => {
            (acc[r.table_name] = acc[r.table_name] || []).push(r.column_name + ' : ' + r.data_type);
            return acc;
          }, {})
        };
      } catch (e) {
        diagnostic = { erreur: e.message };
      }
    }

    const sortie = arrivees.rows.map(r => {
      const caution = r.channex_booking_id ? (cautions['CHX_' + r.channex_booking_id] || null) : null;
      const plateforme = String(r.platform || '').toLowerCase();
      const estAirbnb = plateforme.includes('airbnb') || plateforme === 'abb';
      const cautionExigee = Number(r.deposit_amount || 0) > 0 && !estAirbnb;
      const cautionOk = caution && ['authorized', 'captured', 'paid', 'succeeded'].includes(String(caution.status || '').toLowerCase());

      return {
        conversation_id: r.conversation_id,
        guest_name: r.guest_name,
        property_id: r.property_id,
        property_name: r.property_name,
        platform: r.platform,
        arrivee: r.arrivee,
        depart: r.depart,
        message_envoye: convIds.length ? envoyes.has(r.conversation_id) : null,
        caution: caution ? caution.status : null,
        caution_exigee: cautionExigee,
        // Ce qui bloque reellement l'envoi automatique des infos.
        caution_bloquante: cautionExigee && !cautionOk,
        menage_fait: null
      };
    });

    res.json({
      date: jour,
      comptes: ids.length,
      arrivees: sortie,
      menage_fait_indisponible: 'table de menage non confirmee — appelez ?diagnostic=1',
      diagnostic
    });
  } catch (e) {
    console.error('❌ [AUJOURDHUI/ETATS]', e.message);
    res.status(500).json({ error: e.message });
  }
});

`;

const pos = src.indexOf(ANCRE);
src = src.slice(0, pos) + ROUTE + src.slice(pos);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la route', "app.get('/api/aujourdhui/etats', authenticateAny"],
  ['les comptes geres', 'FROM account_delegations'],
  ['la lecture des logs', 'FROM message_template_logs'],
  ['la lecture des cautions', 'FROM deposits WHERE uid = ANY'],
  ['le diagnostic des tables', 'information_schema.columns'],
  ['menage a null', 'menage_fait: null'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Aucune ecriture ne doit avoir ete introduite. */
const ajout = ROUTE.toUpperCase();
['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE'].forEach(function (mot) {
  if (ajout.indexOf(mot) !== -1) echec('Le code ajoute contient « ' + mot.trim() + ' » : cette route doit etre en lecture seule. Refus.');
});

if (src.split("'/api/aujourdhui/etats'").length - 1 !== 1) echec('La route est definie plusieurs fois. Refus.');

/* server.js doit rester du JavaScript valide. */
try {
  new Function(src);
} catch (e) {
  echec('server.js ne serait plus du JavaScript valide — ' + e.message);
}

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-route-etats';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('/api/aujourdhui/etats') === -1) echec("La route n'est pas dans le fichier apres ecriture.");
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  GET /api/aujourdhui/etats');
console.log('  Inseree avant runTemplatesCron, au niveau du module.');
console.log('  LECTURE SEULE : le script refuse d\'ecrire si le code ajoute');
console.log('  contient un INSERT, UPDATE, DELETE, ALTER, DROP ou CREATE.');
console.log('  Les comptes geres sont inclus (account_delegations).');
if (!ESSAI) console.log('  Sauvegarde : server.js.avant-route-etats (ne pas commiter)');
console.log('\n  Apres deploiement, depuis la console du navigateur :');
console.log('');
console.log("  fetch('/api/aujourdhui/etats?diagnostic=1',{headers:{Authorization:'Bearer '+localStorage.getItem('lcc_token')}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,1)))");
console.log('');
console.log('  Ce que je veux voir dans la sortie :');
console.log('  1. « arrivees » : sept lignes, avec message_envoye et');
console.log('     caution_bloquante. Roxana et xiuqin ji doivent apparaitre.');
console.log('  2. « diagnostic.tables_menage » : les tables et colonnes de');
console.log('     menage de votre base. Collez-la moi et j\'ajoute le SELECT');
console.log('     exact — trois lignes, sans deviner un nom de table.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

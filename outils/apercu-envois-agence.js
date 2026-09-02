#!/usr/bin/env node
/* ============================================================
   outils/apercu-envois-agence.js
   L'apercu « prochains envois (J+7) » ignore les logements delegues
   ============================================================
   Cible : server.js — route GET /api/message-template-scheduled (~31233)

   ── LE SYMPTOME ─────────────────────────────────────────────────
   L'ecran qui liste les prochains envois planifies n'affiche rien pour
   les logements qui appartiennent a un compte proprietaire, alors que
   les templates, eux, apparaissent bien.

   ── LA CAUSE ────────────────────────────────────────────────────
   La route calcule pourtant les bons comptes des sa premiere ligne :

       const agencyIds = await getAgencyUserIds(req, userId);

   et s'en sert pour lire les templates :

       SELECT * FROM message_templates WHERE user_id = ANY($1::text[])

   Puis, quelques lignes plus bas, elle revient a l'identifiant seul
   pour chercher les conversations :

       WHERE c.user_id = $1        avec [userId, targetDate]

   Les templates d'agence sont donc listes, mais aucune conversation
   deleguee ne leur est associee : l'apercu est vide ou incomplet.

   ── POURQUOI C'EST SANS RISQUE ──────────────────────────────────
   C'est un GET : la route calcule et renvoie une liste, elle n'envoie
   aucun message. Elargir les comptes lus ne peut donc pas produire de
   doublon d'envoi — la crainte qui justifiait de ne pas y toucher quand
   ce bloc n'etait pas encore identifie.

   Le filtre par logement (propFilter) reste applique tel quel : un
   template qui vise un logement precis ne fera apparaitre que lui.

   ── A NE PAS CONFONDRE ──────────────────────────────────────────
   Le meme WHERE existe dans le CRON (~31550) — celui-la envoie
   vraiment les messages, et se corrige avec
   outils/cron-templates-agence-v2.js. Ce script-ci ne touche que
   l'apercu, identifie par son parametre [userId, targetDate], unique
   dans tout server.js.

   Usage :
     node outils/apercu-envois-agence.js --essai
     node outils/apercu-envois-agence.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

function unique(src, texte, quoi) {
  const n = src.split(texte).length - 1;
  if (n === 0) echec(quoi + ' introuvable. server.js a change depuis la lecture.');
  if (n > 1) echec(quoi + ' present ' + n + ' fois — ancre ambigue, je m\'arrete.');
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('[agencyIds, targetDate]') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── Une seule ancre : le bloc entier, du JOIN jusqu'au parametre ──
   Ancrer sur « WHERE c.user_id = $1 » seul ne marche pas : c'est aussi le
   prefixe de « WHERE c.user_id = $1 AND c.status != 'closed' » (l. 42978).
   Le parametre [userId, targetDate], lui, est unique dans tout server.js —
   on prend donc le bloc complet, ce qui leve toute ambiguite. */
const A_BLOC = `           LEFT JOIN properties p ON p.id = c.property_id
           WHERE c.user_id = $1
           AND DATE(c.\${dateCol} AT TIME ZONE 'Europe/Paris') = $2
           AND c.status != 'cancelled'
           \${propFilter}\`,
          [userId, targetDate]`;

const N_BLOC = `           LEFT JOIN properties p ON p.id = c.property_id
           /* agencyIds est deja calcule en tete de route et sert a lire les
              templates : on l'utilise aussi ici, sinon les templates d'agence
              s'affichent sans jamais trouver les conversations des logements
              delegues. Route en lecture seule : aucun envoi, aucun doublon
              possible. Le filtre par logement ci-dessous reste souverain. */
           WHERE c.user_id = ANY($1::text[])
           AND DATE(c.\${dateCol} AT TIME ZONE 'Europe/Paris') = $2
           AND c.status != 'cancelled'
           \${propFilter}\`,
          [agencyIds, targetDate]`;

unique(src, A_BLOC, "Le bloc de requete de l'apercu");
src = src.split(A_BLOC).join(N_BLOC);

try { new Function(src); }
catch (e) { echec("Le resultat n'est pas du JavaScript valide — " + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('[agencyIds, targetDate]') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log("  L'apercu des prochains envois couvre les comptes delegues.\n");
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

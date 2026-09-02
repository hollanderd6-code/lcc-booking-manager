#!/usr/bin/env node
/* ============================================================
   outils/cron-templates-agence-v2.js
   Le cron des templates cherchait les conversations du mauvais compte
   ============================================================
   Cible : server.js — le bloc du cron, ~ligne 31539

   ── POURQUOI UNE V2 ─────────────────────────────────────────────
   outils/cron-templates-agence.js refusait de s'appliquer : son ancre
   « WHERE c.user_id = $1 / AND DATE(c.${dateCol} ... ) = $2 » existe
   desormais DEUX fois dans server.js, et le script exigeait une
   occurrence unique. Ce refus etait le bon comportement — remplacer les
   deux aveuglement aurait touche un chemin d'envoi non identifie.

   Les deux blocs :

     ~31286   parametre [userId, targetDate]        autre fonction
     ~31539   parametre [tmpl.user_id, targetDate]  LE CRON

   Ce script ne traite que le second. Il s'ancre sur le parametre, pas
   sur le WHERE, ce qui leve toute ambiguite.

   Le premier bloc est laisse tel quel volontairement : sa variable
   `userId` peut venir d'une boucle sur l'ensemble des comptes. Y ajouter
   les comptes delegues ferait alors traiter la meme conversation deux
   fois — une fois pour le proprietaire, une fois pour l'agence — donc
   deux messages au voyageur. A examiner en lisant la fonction qui
   l'entoure, pas par symetrie.

   ── LA CAUSE ────────────────────────────────────────────────────
   Le cron part du TEMPLATE et cherche ses conversations :

       WHERE c.user_id = $1        avec [tmpl.user_id, targetDate]

   Un template pose sur un compte d'agence ne peut donc jamais trouver
   la conversation d'un logement qui appartient au compte proprietaire.
   La requete remonte zero ligne, le cron l'ecrit « 0 conversation
   ciblee », et rien ne distingue ce cas de « aucune arrivee ce jour ».

   ── LE CIBLAGE PAR LOGEMENT RESTE SOUVERAIN ─────────────────────
   On elargit les comptes lus, pas les logements : le filtre
   property_ids du template continue de s'appliquer tel quel. Un
   template qui vise Saint Gratien Etage ne partira que pour lui.

   Usage :
     node outils/cron-templates-agence-v2.js --essai
     node outils/cron-templates-agence-v2.js
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

if (src.indexOf('comptesDuTemplate') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Le WHERE du cron, ancre sur le contexte qui le rend unique ──
   Les deux lignes « guest_language » puis le LEFT JOIN reservations
   n'existent que dans le bloc du cron. */
const A_WHERE = `             AND r.status != 'cancelled'
           )
           WHERE c.user_id = $1`;
const N_WHERE = `             AND r.status != 'cancelled'
           )
           /* Le template peut appartenir a un compte d'AGENCE et la conversation
              au compte proprietaire du logement : comparer les deux identifiants
              ne remontait alors jamais rien. On lit desormais le compte du
              template ET ceux qui l'ont delegue a ce compte.
              Le filtre property_ids ci-dessous reste seul maitre des logements. */
           WHERE c.user_id = ANY($1::text[])`;

unique(src, A_WHERE, 'Le WHERE du cron');
src = src.split(A_WHERE).join(N_WHERE);

/* ── 2. Le parametre ─────────────────────────────────────────────── */
const A_PARAM = `          [tmpl.user_id, targetDate]
        );

        console.log(\`  Template "\${tmpl.title}" → \${convs.rows.length} conversation(s) ciblée(s) pour \${targetDate}\`);`;
const N_PARAM = `          [comptesTmpl, targetDate]
        );

        /* Le nombre de comptes interroges est affiche avec le resultat : sans
           lui, un « 0 conversation » ne distingue pas « aucune arrivee ce
           jour » de « mauvais compte ». C'est ce silence qui a laisse le
           defaut passer inapercu. */
        console.log(\`  Template "\${tmpl.title}" → \${convs.rows.length} conversation(s) ciblée(s) \` +
          \`sur \${comptesTmpl.length} compte(s) pour \${targetDate}\`);`;

unique(src, A_PARAM, 'Le parametre du cron');
src = src.split(A_PARAM).join(N_PARAM);

/* ── 3. Le calcul, pose juste avant la requete ────────────────────── */
const A_AVANT = `        const isDepRelated = tmpl.trigger_type.includes('departure') || tmpl.trigger_type === 'after_departure';`;
const N_AVANT = `        /* Les comptes dont ce template peut servir les conversations : le sien,
           et ceux qui l'ont delegue a ce compte. */
        const comptesTmpl = await comptesDuTemplate(tmpl.user_id);

        const isDepRelated = tmpl.trigger_type.includes('departure') || tmpl.trigger_type === 'after_departure';`;

unique(src, A_AVANT, "Le point d'insertion (isDepRelated)");
src = src.split(A_AVANT).join(N_AVANT);

/* ── 4. Le helper, avec son cache ─────────────────────────────────── */
const A_HELPER = `// ✅ Cron message_templates`;
const N_HELPER = `/* Les comptes dont un template peut servir les conversations : celui qui le
   possede, et ceux qui l'ont delegue a ce compte.

   Le cache evite de relire account_delegations pour chaque template du meme
   compte. Sa duree de vie est courte (5 min) : une delegation acceptee doit
   prendre effet a la prochaine execution, pas au prochain redemarrage. */
const _cacheComptesTmpl = new Map();
async function comptesDuTemplate(userId) {
  if (!userId) return [];
  const cache = _cacheComptesTmpl.get(userId);
  if (cache && Date.now() - cache.t < 300000) return cache.v;
  let v = [userId];
  try {
    const { rows } = await pool.query(
      \`SELECT delegator_user_id FROM account_delegations
        WHERE delegate_user_id = $1 AND status = 'accepted'\`,
      [userId]
    );
    v = [userId, ...rows.map((d) => d.delegator_user_id)];
  } catch (e) {
    console.error('⚠️ [TPL CRON] delegations illisibles pour', userId, ':', e.message);
    /* On n'ouvre rien de plus que son propre compte : mieux vaut un envoi
       manquant qu'un message parti chez le mauvais voyageur. */
  }
  _cacheComptesTmpl.set(userId, { t: Date.now(), v });
  return v;
}

// ✅ Cron message_templates`;

unique(src, A_HELPER, "L'ancre du cron (commentaire « Cron message_templates »)");
src = src.split(A_HELPER).join(N_HELPER);

try { new Function(src); }
catch (e) { echec("Le resultat n'est pas du JavaScript valide — " + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('comptesDuTemplate') === -1
      || relu.indexOf('c.user_id = ANY($1::text[])') === -1
      || relu.indexOf('[comptesTmpl, targetDate]') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Le cron accepte les conversations des comptes delegues.');
console.log('  Son journal indique le nombre de comptes interroges.\n');
console.log('  NON traite volontairement :');
console.log('    server.js ~31286  — parametre [userId, targetDate], autre fonction.');
console.log('      Lire la fonction qui l\'entoure avant d\'y toucher : si `userId`');
console.log('      vient d\'une boucle sur tous les comptes, l\'elargir enverrait');
console.log('      deux fois le meme message.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

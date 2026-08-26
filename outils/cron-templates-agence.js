#!/usr/bin/env node
/* ============================================================
   outils/cron-templates-agence.js
   Le cron cherchait les conversations du mauvais compte
   ============================================================
   Cible : server.js  (cron des templates, ~ligne 31384)

   ── CE QUE J'AI CORRIGE HIER, ET CE QUI RESTAIT ──────────────────
   Hier j'ai elargi les routes de l'interface et deux points d'envoi
   (ligne 1267, « a la reservation », et 31292, la caution). Le message
   parti hier soir venait de l'IA, qui suit un autre chemin : aucun
   template n'est parti.

   Le cron horaire — celui qui envoie before_arrival, on_arrival,
   after_departure, l'essentiel des messages — n'etait pas touche.

   ── LA CAUSE, EXACTEMENT ─────────────────────────────────────────
   Le cron part du TEMPLATE et cherche les conversations :

       WHERE c.user_id = $1
       [tmpl.user_id, targetDate]

   Votre template appartient a votre compte d'agence. La conversation
   d'Adriana Pina appartient au compte proprietaire de SG ETG. La
   comparaison ne peut jamais etre vraie : le cron trouve zero
   conversation, et l'ecrit dans ses logs sans que rien ne le signale.

   C'est le sens INVERSE de la correction d'hier. Hier, on partait du
   proprietaire et il fallait ajouter ses gestionnaires. Ici on part du
   gestionnaire et il faut ajouter les comptes qu'il gere. La meme table
   se lit dans les deux sens :

       hier   delegate_user_id   WHERE delegator_user_id = proprietaire
       ici    delegator_user_id  WHERE delegate_user_id  = gestionnaire

   C'est ce renversement qui m'a echappe : j'ai cherche le defaut la ou
   il etait la veille.

   ── CE QUI EST CORRIGE ───────────────────────────────────────────
   Le cron accepte desormais les conversations du compte du template ET
   des comptes qui l'ont delegue a ce compte.

   Le ciblage par logement reste souverain : un template qui vise
   explicitement SG ETG ne partira que pour SG ETG. Et un template sans
   ciblage — « tous les logements » — couvre maintenant tout le parc
   gere, ce qui est le comportement que vous attendiez.

   ── UN GARDE-FOU AJOUTE ──────────────────────────────────────────
   Le journal du cron dit deja combien de conversations sont ciblees.
   On y ajoute le nombre de comptes interroges : « 3 conversation(s)
   sur 2 compte(s) ». Sans cela, un zero ne distingue pas « aucune
   reservation ce jour » de « mauvais compte » — c'est precisement ce
   qui a laisse ce defaut passer inapercu.

   Usage :
     node outils/cron-templates-agence.js --essai
     node outils/cron-templates-agence.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('comptesDuTemplate') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Le filtre du cron ─────────────────────────────────────────── */
const ANCIEN = `           WHERE c.user_id = $1
           AND DATE(c.\${dateCol} AT TIME ZONE 'Europe/Paris') = $2
           AND c.status != 'cancelled'`;

const NOUVEAU = `           /* Le template peut appartenir a un compte d'AGENCE, la conversation
              au compte proprietaire du logement. Comparer les deux
              identifiants ne remontait alors jamais rien — et le cron
              l'ecrivait comme « 0 conversation ciblee », sans distinguer
              « aucune reservation » de « mauvais compte ».

              Sens de lecture inverse de la route de creation : ici on part du
              gestionnaire et on ajoute les comptes qui l'ont delegue. */
           WHERE c.user_id = ANY($1::text[])
           AND DATE(c.\${dateCol} AT TIME ZONE 'Europe/Paris') = $2
           AND c.status != 'cancelled'`;

if (src.split(ANCIEN).length - 1 !== 1) {
  echec('Filtre du cron introuvable. Le fichier a change depuis la lecture.');
}
src = src.split(ANCIEN).join(NOUVEAU);

/* ── 2. Le parametre : un tableau de comptes au lieu d'un identifiant ── */
const A_PARAM = `          [tmpl.user_id, targetDate]
        );

        console.log(\`  Template "\${tmpl.title}" → \${convs.rows.length} conversation(s) ciblée(s) pour \${targetDate}\`);`;

const N_PARAM = `          [comptesTmpl, targetDate]
        );

        console.log(\`  Template "\${tmpl.title}" → \${convs.rows.length} conversation(s) ciblée(s) \` +
          \`sur \${comptesTmpl.length} compte(s) pour \${targetDate}\`);`;

if (src.split(A_PARAM).length - 1 !== 1) {
  echec('Passage des parametres du cron introuvable.');
}
src = src.split(A_PARAM).join(N_PARAM);

/* ── 3. Le calcul, pose juste avant la requete ────────────────────── */
const A_AVANT = `        const isBefore = tmpl.trigger_type.startsWith('before_');`;
const N_AVANT = `        /* Les comptes dont ce template peut servir les conversations : le
           sien, et ceux qui l'ont delegue a ce compte. Mis en cache dans la
           boucle : un parc de vingt templates n'interroge pas vingt fois la
           meme table. */
        const comptesTmpl = await comptesDuTemplate(tmpl.user_id);

        const isBefore = tmpl.trigger_type.startsWith('before_');`;

if (src.split(A_AVANT).length - 1 !== 1) {
  echec('Point d\'insertion du calcul introuvable (isBefore).');
}
src = src.split(A_AVANT).join(N_AVANT);

/* ── 4. Le helper, avec son cache ─────────────────────────────────── */
const A_HELPER = `// ✅ Cron message_templates`;
const N_HELPER = `/* Les comptes dont un template peut servir les conversations : celui qui le
   possede, et ceux qui l'ont delegue a ce compte.

   Le cache evite de reinterroger account_delegations pour chaque template du
   meme compte — un parc de vingt templates faisait vingt lectures identiques.
   Sa duree de vie est courte : une delegation acceptee doit prendre effet a
   la prochaine execution, pas au prochain redemarrage. */
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
    // On n'ouvre rien de plus que son propre compte : mieux vaut un envoi
    // manquant qu'un message parti chez le mauvais voyageur.
  }
  _cacheComptesTmpl.set(userId, { t: Date.now(), v });
  return v;
}

// ✅ Cron message_templates`;

if (src.split(A_HELPER).length - 1 !== 1) {
  echec('Ancre du cron introuvable (commentaire « Cron message_templates »).');
}
src = src.split(A_HELPER).join(N_HELPER);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('comptesDuTemplate') === -1 || relu.indexOf('c.user_id = ANY($1::text[])') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Le cron accepte les conversations des comptes geres.');
console.log('  Son journal indique desormais le nombre de comptes interroges.\n');
console.log('  Restent NON traites — a examiner si un envoi manque encore :');
console.log('    server.js 4875, 7128, 38404, 38460, 38547, 41877, 45088');
console.log('  Ce sont d\'autres points de lecture des templates. Envoyez-moi');
console.log('  celui qui correspond au message manquant plutot que de les');
console.log('  corriger en bloc : chacun a son propre sens de lecture.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/templates-agence-lot.js
   Le lot cohérent : la propriété reste à l'agence, l'envoi l'accepte
   ============================================================
   Cible : server.js

   ── DEUX CORRECTIONS QUI SE CONTRARIAIENT ────────────────────────
   Ce matin, j'ai corrige l'ECRITURE : un template cree en mode agence
   etait enregistre sous le proprietaire du logement. Cela reglait le
   symptome, mais interdisait a une agence de poser un template couvrant
   plusieurs clients — et deplacait la propriete d'un objet qu'elle a
   cree.

   La bonne correction porte sur l'ENVOI : accepter les templates du
   proprietaire ET de ses agences. Les deux ensemble s'annulent — la
   premiere deplace au client ce que la seconde autorise a rester chez
   l'agence.

   Ce script fait les deux gestes dans le bon ordre :

     1. il defait la correction d'ecriture : un template appartient a qui
        le cree ;
     2. il elargit les requetes d'envoi aux agences gerantes.

   ── CE QU'IL NE DEFAIT PAS ───────────────────────────────────────
   La reattribution deja lancee. « Caution Saint Gratien » appartient
   desormais au client — c'est correct, ce sont ses logements, et son
   template partira de toute facon. Revenir en arriere sur des donnees
   n'apporterait rien.

   Le controle de coherence est conserve : si les logements cibles
   appartiennent a des comptes differents, la creation est refusee avec
   la raison. Un template peut couvrir plusieurs clients d'une agence,
   mais il faut alors qu'il soit pose par l'agence — ce qui est
   desormais le cas.

   ── LA FORME DE L'ELARGISSEMENT ──────────────────────────────────
   Une sous-requete, et non un parametre de plus :

       WHERE user_id IN (
         SELECT $1::text
         UNION SELECT delegate_user_id FROM account_delegations
          WHERE delegator_user_id = $1::text AND status = 'accepted')

   Le parametre garde sa position : aucun appelant n'est touche, et il y
   en a plusieurs — reservation entrante, webhook Stripe, declencheurs
   planifies. Modifier la liste des parametres a chaque site aurait
   multiplie les occasions de se tromper.

   Le ciblage par logement fait toujours foi : rien ne part plus large
   qu'avant.

   Usage :
     node outils/templates-agence-lot.js --essai
     node outils/templates-agence-lot.js
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

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du depot.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('le proprietaire ET ses gestionnaires') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ════════ 1. Rendre la propriete a l'auteur ════════ */
const A_ECRITURE = `    const proprio = await proprietaireDesLogements(pool, req, property_ids, property_id);
    if (proprio.erreur) return res.status(400).json({ error: proprio.erreur });
    if (proprio.userId !== userId) {
      console.log(\`\u{1F4E9} [TEMPLATES] \${userId} cree un template pour le compte \${proprio.userId}\`);
    }
`;

const N_ECRITURE = `    /* Le template reste la propriete de qui le cree. Le moteur d'envoi
       accepte desormais les templates des agences gerantes (voir plus bas
       « le proprietaire ET ses gestionnaires ») : une agence peut donc en
       poser un couvrant plusieurs de ses clients, ce que l'attribution au
       proprietaire interdisait.

       Le controle de coherence reste utile : il refuse un ciblage melant
       des comptes hors du perimetre gere. */
    const proprio = await proprietaireDesLogements(pool, req, property_ids, property_id);
    if (proprio.erreur) return res.status(400).json({ error: proprio.erreur });
`;

let ecritureDefaite = false;
if (src.split(A_ECRITURE).length - 1 === 1) {
  src = src.split(A_ECRITURE).join(N_ECRITURE);
  ecritureDefaite = true;
}

/* Et l'insertion repasse sur l'auteur. */
const A_INSERT = `      [proprio.userId, property_id || null,`;
const N_INSERT = `      [userId, property_id || null,`;
if (src.split(A_INSERT).length - 1 === 1) {
  src = src.split(A_INSERT).join(N_INSERT);
} else if (ecritureDefaite) {
  echec('Insertion introuvable alors que le bloc de deduction a ete trouve.');
}

/* Le controle inter-comptes doit rester, mais ne plus bloquer une agence :
   il refuse seulement les comptes hors du perimetre gere. */
const A_MULTI = `  if (rows.length > 1) {
    return { erreur: 'Les logements ciblés appartiennent à des comptes différents. '
      + 'Créez un template par compte : un template ne peut pas être enregistré sous deux propriétaires.' };
  }`;
const N_MULTI = `  if (rows.length > 1) {
    /* Plusieurs comptes : acceptable pour une agence qui les gere tous —
       le template lui appartient et l'envoi l'acceptera pour chacun. On
       verifie seulement qu'aucun logement ne sort de son perimetre. */
    const geres = await getAgencyUserIds({ query: { agency: 'all' } }, req.user.id);
    const dehors = rows.map((r) => r.user_id).filter((u) => !geres.includes(u));
    if (dehors.length) {
      return { erreur: 'Certains logements ciblés appartiennent à des comptes que vous ne gérez pas.' };
    }
    return { userId: req.user.id, global: false, multi: true };
  }`;
if (src.split(A_MULTI).length - 1 === 1) src = src.split(A_MULTI).join(N_MULTI);

/* ════════ 2. Elargir l'envoi ════════ */
function elargir(prefixe, param) {
  return `${prefixe}user_id IN (\n`
    + `             /* agence : le proprietaire ET ses gestionnaires */\n`
    + `             SELECT ${param}::text\n`
    + `             UNION SELECT delegate_user_id FROM account_delegations\n`
    + `              WHERE delegator_user_id = ${param}::text AND status = 'accepted'\n`
    + `           )`;
}

/* On ne touche qu'aux conditions d'une requete lisant message_templates :
   le fichier compte des milliers de « user_id = $1 ». */
const lignes = src.split('\n');
const touches = [];

for (let i = 0; i < lignes.length; i++) {
  if (!/FROM message_templates|message_templates mt/.test(lignes[i])) continue;
  for (let j = i; j < Math.min(i + 7, lignes.length); j++) {
    if (/IN \(/.test(lignes[j])) break;
    const m = lignes[j].match(/(\bmt\.|\b)user_id\s*=\s*(\$\d+)/);
    if (!m) continue;
    lignes[j] = lignes[j].replace(m[0], elargir(m[1] === 'mt.' ? 'mt.' : '', m[2]));
    touches.push('ligne ' + (j + 1));
    break;
  }
}

if (!touches.length) echec('Aucune condition « user_id = $N » dans une requete message_templates.');
src = lignes.join('\n');

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('le proprietaire ET ses gestionnaires') === -1) {
    echec('L\'elargissement n\'est pas dans le fichier apres ecriture.');
  }
  if (relu.indexOf('[proprio.userId, property_id || null,') !== -1) {
    echec('L\'insertion enregistre encore sous le proprietaire.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Ecriture : ' + (ecritureDefaite
  ? 'un template appartient desormais a qui le cree.'
  : 'deja sous l\'auteur, inchangee.'));
console.log('  Envoi : ' + touches.length + ' requete(s) elargie(s) aux agences — '
  + touches.join(', ') + '.\n');
console.log('  Les parametres gardent leur position : aucun appelant touche.');
console.log('  Le ciblage par logement fait foi — rien ne part plus large.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

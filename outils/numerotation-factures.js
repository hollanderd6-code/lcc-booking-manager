#!/usr/bin/env node
/* ============================================================
   outils/numerotation-factures.js
   Une erreur passagere pouvait reattribuer un numero de facture
   ============================================================
   Cible : server.js — generation du numero de facture (~6325)
           et resolution du proprietaire d'un logement (~4817)

   ── LE DEFAUT PRINCIPAL (ligne 6325) ────────────────────────────
   La fonction qui calcule le prochain numero de facture lit le maximum
   deja attribue, puis ajoute 1 :

       ).catch(() => ({ rows: [{ max_seq: 0 }] }));
       const next = (parseInt(r.rows[0]?.max_seq || 0) + 1);
       return `FACT-${yearStr}-${String(next).padStart(4, '0')}`;

   Le .catch renvoie max_seq = 0 quand la requete echoue. next vaut alors
   1, et la fonction retourne FACT-<annee>-0001 — un numero deja utilise.

   Une coupure reseau d'une seconde, un timeout, un pool sature, et deux
   factures portent le meme numero. La numerotation sequentielle et unique
   des factures est une obligation legale : ce n'est pas un defaut
   d'affichage qu'on corrige quand on a le temps.

   Le repli est d'autant plus trompeur qu'il est INDISTINGUABLE du cas
   normal : une premiere facture de l'annee donne aussi max_seq = 0. Le
   code ne peut pas savoir s'il commence une numerotation ou s'il vient
   d'echouer a la lire.

   ── LE CORRECTIF ────────────────────────────────────────────────
   On ne devine plus. Si la lecture echoue, on leve une erreur explicite
   et AUCUNE facture n'est generee.

   C'est volontairement plus brutal que l'existant. Ne pas produire une
   facture se rattrape : l'hote reessaie, ou un cron repasse. Un doublon
   de numero se rattrape en comptabilite, avec un avoir et une
   explication. Entre les deux, le choix n'est pas technique.

   ⚠️ L'appelant doit donc gerer cette erreur. Verifiez apres application
   que la route qui genere les factures est bien dans un try/catch —
   sinon une erreur de base y produira une promesse rejetee non geree
   plutot qu'un 500 propre. C'est le seul point d'attention de ce script.

   ── LE DEFAUT SECONDAIRE (ligne 4817) ───────────────────────────
   Lors d'un paiement Guest App, le proprietaire du logement est resolu
   ainsi :

       const propOwner = await pool.query('SELECT user_id FROM properties ...')
         .catch(() => ({ rows: [] }));
       ownerId = propOwner.rows[0]?.user_id || null;

   Si la lecture echoue, ownerId reste null, et le garde qui suit
   (« && ownerId ») empeche la creation de la reservation. Le code echoue
   donc du bon cote — mais en silence, alors que la consequence est un
   paiement encaisse sans reservation enregistree.

   On ne change pas la logique : on rend l'echec visible dans les logs,
   pour qu'il soit rattrapable a la main.

   Usage :
     node outils/numerotation-factures.js --essai
     node outils/numerotation-factures.js
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

if (src.indexOf('[FACTURE] numerotation illisible') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La numerotation des factures ─────────────────────────────── */
const A_NUM = `  ).catch(() => ({ rows: [{ max_seq: 0 }] }));
  const next = (parseInt(r.rows[0]?.max_seq || 0) + 1);`;

const N_NUM = `  ).catch((e) => {
    /* Ne PAS renvoyer max_seq = 0 ici.

       Ce repli est indistinguable du cas normal : une premiere facture de
       l'annee donne aussi max_seq = 0. Sur une erreur de lecture, la
       fonction repartait donc a FACT-<annee>-0001 et reattribuait un numero
       deja utilise.

       La numerotation des factures doit etre sequentielle et unique. Mieux
       vaut ne pas produire la facture — l'hote reessaie — que d'en produire
       une avec un numero en doublon, qui se repare en comptabilite. */
    console.error('\u274c [FACTURE] numerotation illisible, aucune facture generee :', e.message);
    throw new Error('Numerotation de facture indisponible — facture non generee');
  });
  const next = (parseInt(r.rows[0]?.max_seq || 0) + 1);`;

unique(src, A_NUM, 'La numerotation des factures');
src = src.split(A_NUM).join(N_NUM);

/* ── 2. La resolution du proprietaire (log seulement) ────────────── */
const A_OWNER = `                const propOwner = await pool.query('SELECT user_id FROM properties WHERE id = $1', [propId]).catch(() => ({ rows: [] }));
                ownerId = propOwner.rows[0]?.user_id || null;`;

const N_OWNER = `                /* L'echec de cette lecture laisse ownerId a null, et le garde
                   « && ownerId » plus bas empeche alors la creation de la
                   reservation : le paiement est encaisse sans reservation
                   enregistree. La logique est prudente, mais l'echec etait
                   muet — on le rend visible pour qu'il soit rattrapable. */
                const propOwner = await pool.query('SELECT user_id FROM properties WHERE id = $1', [propId])
                  .catch((e) => {
                    console.error(\`\u274c [PAIEMENT] proprietaire du logement \${propId} illisible : \${e.message} — reservation NON creee, a reprendre a la main\`);
                    return { rows: [] };
                  });
                ownerId = propOwner.rows[0]?.user_id || null;
                if (!ownerId) {
                  console.warn(\`\u26a0\ufe0f [PAIEMENT] aucun proprietaire trouve pour le logement \${propId} — reservation NON creee\`);
                }`;

unique(src, A_OWNER, 'La resolution du proprietaire');
src = src.split(A_OWNER).join(N_OWNER);

try { new Function(src); }
catch (e) { echec("Le resultat n'est pas du JavaScript valide — " + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('[FACTURE] numerotation illisible') === -1
      || relu.indexOf('rows: [{ max_seq: 0 }]') !== -1) {
    echec("La correction n'est pas complete dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Une numerotation illisible ne produit plus de facture au lieu');
console.log("  d'en produire une avec un numero en doublon.");
console.log('  L\'echec de resolution du proprietaire est desormais visible.\n');
console.log('  \u26a0\ufe0f A VERIFIER : la route qui genere les factures doit etre dans');
console.log('     un try/catch, sinon l\'erreur levee donnera une promesse');
console.log('     rejetee non geree au lieu d\'un 500 propre. Cherchez');
console.log('     l\'appelant de cette fonction et confirmez-le.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

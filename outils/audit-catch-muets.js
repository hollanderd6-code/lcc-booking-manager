#!/usr/bin/env node
/* ============================================================
   outils/audit-catch-muets.js
   Recenser les erreurs avalees en silence
   ============================================================
   Ne modifie RIEN. Lit les fichiers .js du projet et classe les
   `catch` qui font disparaitre une erreur.

   ── POURQUOI ────────────────────────────────────────────────────
   La session du 2 septembre 2026 a corrige onze defauts. Presque aucun
   n'etait difficile a reparer ; tous etaient difficiles a VOIR :

     .catch(() => ({ rows: [] }))   une panne reseau devenait
                                    « logement disparu », et le cron
                                    annulait une caution valide
     console.warn(...)              masquait que le controle d'acces de
                                    /api/chat/send etait entierement saute
     « caution annulee »            annoncait une annulation qui n'avait
                                    pas lieu (mauvaise table)
     « 0 conversation ciblee »      ne distinguait pas « rien a envoyer »
                                    de « mauvais compte »

   Le point commun : le code confond « il n'y a rien » et « je n'ai pas
   reussi a savoir ». Ce script cherche les endroits ou cette confusion
   est encore possible.

   ── LES TROIS NIVEAUX ───────────────────────────────────────────
   GRAVE   Le catch renvoie une valeur qui MENT sur les donnees :
           un resultat vide, un objet vide, zero ligne. L'appelant croit
           avoir la reponse. C'est le motif exact qui a annule une caution.

   MOYEN   Le catch est vide, ou renvoie null/false/undefined sans rien
           dire. L'erreur n'existe plus nulle part. Souvent volontaire et
           acceptable — mais rien ne le distingue d'un oubli.

   FAIBLE  Le catch logue puis continue. Visible dans les logs, donc
           reperable ; a regarder seulement si le message est trompeur
           ou si le flux continue comme si tout allait bien.

   ── COMMENT LIRE LE RESULTAT ────────────────────────────────────
   Ne corrigez pas en bloc. Un catch muet sur une notification push est
   sans consequence ; le meme sur une lecture qui decide d'un statut de
   paiement est un incident en attente. Le tri se fait en regardant CE QUE
   FAIT l'appelant avec la valeur renvoyee — ce qu'aucun script ne peut
   deviner.

   La bonne question, pour chaque ligne GRAVE : « si cette requete echoue
   pour une raison passagere, qu'est-ce que le code decide ? »

   Usage :
     node outils/audit-catch-muets.js
     node outils/audit-catch-muets.js --grave     (seulement le niveau GRAVE)
     node outils/audit-catch-muets.js --fichier server.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const SEUL_GRAVE = process.argv.includes('--grave');
const iFic = process.argv.indexOf('--fichier');
const FICHIER_CIBLE = iFic !== -1 ? process.argv[iFic + 1] : null;

/* Dossiers ignores : dependances, builds natifs, bibliotheques tierces.
   Les corriger n'a pas de sens et leur volume noierait le resultat. */
const IGNORE = new Set([
  'node_modules', '.git', 'ios', 'android', 'vendor', 'dist', 'build',
  '.next', 'coverage', 'screenshots',
]);

const REGLES = [
  {
    niveau: 'GRAVE',
    // .catch(() => ({ rows: [] }))  et variantes avec une ou plusieurs lignes vides
    motif: /\.catch\(\s*\(\s*[a-zA-Z_$]*\s*\)\s*=>\s*\(\s*\{\s*rows\s*:/,
    quoi: 'renvoie des lignes vides — indistinguable de « aucun resultat »',
  },
  {
    niveau: 'GRAVE',
    motif: /\.catch\(\s*\(\s*[a-zA-Z_$]*\s*\)\s*=>\s*\(\s*\{\s*\}\s*\)\s*\)/,
    quoi: 'renvoie un objet vide — l\'appelant croit avoir la reponse',
  },
  {
    niveau: 'GRAVE',
    motif: /\.catch\(\s*\(\s*[a-zA-Z_$]*\s*\)\s*=>\s*\[\s*\]\s*\)/,
    quoi: 'renvoie un tableau vide — indistinguable de « liste vide »',
  },
  {
    niveau: 'MOYEN',
    motif: /\.catch\(\s*\(\s*[a-zA-Z_$]*\s*\)\s*=>\s*\{\s*\}\s*\)/,
    quoi: 'catch vide en fleche — l\'erreur disparait sans trace',
  },
  {
    niveau: 'MOYEN',
    motif: /\.catch\(\s*\(\s*[a-zA-Z_$]*\s*\)\s*=>\s*(null|false|undefined|0)\s*\)/,
    quoi: 'renvoie une valeur neutre sans rien signaler',
  },
  {
    niveau: 'MOYEN',
    // catch {}  ou  catch (e) {}  ou  catch(e) { }
    motif: /catch\s*(\(\s*[a-zA-Z_$]*\s*\))?\s*\{\s*\}/,
    quoi: 'bloc catch entierement vide',
  },
  {
    niveau: 'MOYEN',
    // catch (e) { /* commentaire seul */ }
    motif: /catch\s*\(\s*[a-zA-Z_$]*\s*\)\s*\{\s*\/[/*]/,
    quoi: 'catch ne contenant qu\'un commentaire',
  },
  {
    niveau: 'FAIBLE',
    motif: /catch\s*\(\s*[a-zA-Z_$]*\s*\)\s*\{\s*console\.(warn|log)\(/,
    quoi: 'logue en warn/log puis continue — visible mais non bloquant',
  },
];

function parcourir(dir, sortie = []) {
  let entrees;
  try { entrees = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return sortie; }

  for (const e of entrees) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const complet = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE.has(e.name)) continue;
      parcourir(complet, sortie);
    } else if (e.name.endsWith('.js') && !e.name.endsWith('.min.js')) {
      sortie.push(complet);
    }
  }
  return sortie;
}

let fichiers = FICHIER_CIBLE
  ? [path.join(RACINE, FICHIER_CIBLE)]
  : parcourir(RACINE);

/* Les scripts de outils/ contiennent des chaines qui citent ces motifs dans
   leurs commentaires : les exclure evite de s'auto-signaler. */
fichiers = fichiers.filter(f => !f.includes(path.sep + 'outils' + path.sep) || FICHIER_CIBLE);

const parNiveau = { GRAVE: [], MOYEN: [], FAIBLE: [] };
let nbFichiers = 0;

for (const f of fichiers) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  nbFichiers++;
  const lignes = src.split('\n');
  const rel = path.relative(RACINE, f);

  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i];
    // Une ligne entierement commentee n'est pas du code.
    if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) continue;

    for (const regle of REGLES) {
      if (regle.motif.test(ligne)) {
        parNiveau[regle.niveau].push({
          fichier: rel,
          ligne: i + 1,
          quoi: regle.quoi,
          texte: ligne.trim().slice(0, 110),
        });
        break; // une seule regle par ligne, la plus grave d'abord
      }
    }
  }
}

const COULEUR = { GRAVE: '\x1b[31m', MOYEN: '\x1b[33m', FAIBLE: '\x1b[90m' };
const RESET = '\x1b[0m';

console.log(`\n  ${nbFichiers} fichier(s) .js analyse(s)\n`);

const niveaux = SEUL_GRAVE ? ['GRAVE'] : ['GRAVE', 'MOYEN', 'FAIBLE'];

for (const niveau of niveaux) {
  const trouves = parNiveau[niveau];
  console.log(`${COULEUR[niveau]}  ── ${niveau} — ${trouves.length} occurrence(s) ──${RESET}\n`);
  if (trouves.length === 0) { console.log('     aucune\n'); continue; }

  // Grouper par fichier, les plus charges en premier : c'est la ou commencer.
  const parFichier = {};
  for (const t of trouves) (parFichier[t.fichier] ||= []).push(t);
  const ordre = Object.keys(parFichier).sort((a, b) => parFichier[b].length - parFichier[a].length);

  for (const fic of ordre) {
    console.log(`     ${fic}  (${parFichier[fic].length})`);
    for (const t of parFichier[fic]) {
      console.log(`       ${String(t.ligne).padStart(6)} : ${t.quoi}`);
      console.log(`                ${COULEUR.FAIBLE}${t.texte}${RESET}`);
    }
    console.log('');
  }
}

const total = parNiveau.GRAVE.length + parNiveau.MOYEN.length + parNiveau.FAIBLE.length;
console.log(`  Total : ${total}  (${parNiveau.GRAVE.length} grave, ${parNiveau.MOYEN.length} moyen, ${parNiveau.FAIBLE.length} faible)\n`);

if (parNiveau.GRAVE.length > 0) {
  console.log('  Commencez par les GRAVE, et pour chacune posez la question :');
  console.log('  « si cette requete echoue pour une raison passagere, qu\'est-ce');
  console.log('    que le code decide ensuite ? »');
  console.log('  Si la reponse engage de l\'argent, un statut ou un envoi au');
  console.log('  voyageur, c\'est un incident en attente. Sinon, laissez.\n');
}

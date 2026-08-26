#!/usr/bin/env node
/* ============================================================
   outils/templates-portee-affichage.js
   « Tous les logements » dit enfin combien
   ============================================================
   Cible : public/messages.html  (ligne ~4945)
   Prerequis : outils/templates-portee.js applique et deploye.

   ── CE QU'ON LISAIT ──────────────────────────────────────────────
       Message de Bienvenue   [Actif]
       ⚡ À la réservation · Tous les logements

   « Tous les logements » se lit comme une promesse universelle. Elle est
   vraie dans le parc du compte qui possede le template — et ce compte
   n'apparait nulle part. Deux templates crees en travaillant sur le
   compte d'un tiers affichaient exactement cela, et ne couvraient aucun
   des logements attendus.

   ── CE QU'ON LIRA ────────────────────────────────────────────────
       ⚡ À la réservation · Tous les logements — 14 logements
       ⚡ Avant l'arrivée · Tous les logements — aucun logement    (rouge)
       ⚡ À la réservation · 3 logements

   Le cas rouge est celui qui manquait : un template actif qui n'atteint
   personne. Il ne s'agit pas d'un avertissement ponctuel mais d'un
   compteur relu a chaque affichage — une delegation revoquee ou un
   client ajoute change la reponse sans que personne ait a y penser.

   ── UNE PRECAUTION ───────────────────────────────────────────────
   Le compteur n'apparait que si le serveur l'a renvoye. Tant que la
   correction serveur n'est pas deployee, l'affichage reste celui d'avant
   — plutot qu'un « undefined logement » qui ferait douter du reste.

   Usage :
     node outils/templates-portee-affichage.js --essai
     node outils/templates-portee-affichage.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'messages.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/messages.html introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('porteeTexte') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* On lit la fonction autour de la ligne reperee pour connaitre le nom de la
   variable du template — un remplacement a l'aveugle casserait la portee. */
const ANCIEN = `              if (ids.length === 0) return ' · Tous les logements';`;

if (src.split(ANCIEN).length - 1 !== 1) {
  echec('Ligne « Tous les logements » introuvable (messages.html ~4945).');
}

const NOUVEAU = `              if (ids.length === 0) return ' · Tous les logements' + porteeTexte(t);`;

src = src.split(ANCIEN).join(NOUVEAU);

/* Le helper, pose juste avant la fonction qui l'utilise. On l'accroche a une
   ancre stable du fichier plutot qu'a un numero de ligne. */
const A_HELPER = `    labelEl.textContent = 'Tous les logements';`;
const N_HELPER = `    labelEl.textContent = 'Tous les logements';`;

/* Insertion du helper en tete du script des templates : on cible la premiere
   accolade de la fonction qui construit le libelle. */
const marqueur = `              if (ids.length === 0) return ' · Tous les logements' + porteeTexte(t);`;
const iMarqueur = src.indexOf(marqueur);
if (iMarqueur === -1) echec('Marqueur perdu apres remplacement.');

/* On remonte au debut de la fonction englobante pour y poser le helper juste
   avant — il reste ainsi dans la meme portee, sans dependre d'un ordre de
   declaration. */
const debutFn = src.lastIndexOf('\n', src.lastIndexOf('function', iMarqueur));
if (debutFn === -1) echec('Fonction englobante introuvable.');

const HELPER = `

/* La portee reelle d'un template, renvoyee par le serveur. « Tous les
   logements » est vrai dans le parc du compte qui possede le template : sans
   ce compteur, un template qui n'atteint personne s'affiche comme actif.

   Rien tant que le serveur ne renvoie pas la donnee : mieux vaut l'affichage
   d'avant qu'un « undefined logement ». */
function porteeTexte(t) {
  if (!t || typeof t.logements_couverts !== 'number') return '';
  const n = t.logements_couverts;
  if (n === 0) {
    return ' — <span style="color:#B91C1C;font-weight:600;">aucun logement</span>';
  }
  return ' — ' + n + ' logement' + (n > 1 ? 's' : '');
}
`;

src = src.slice(0, debutFn) + HELPER + src.slice(debutFn);

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('porteeTexte') === -1) echec('La correction n\'est pas dans le fichier apres ecriture.');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  « Tous les logements — 14 logements » sur chaque template global.');
console.log('  « aucun logement » en rouge quand la portee est vide.\n');
console.log('  Le compteur ne s\'affiche que si le serveur le renvoie :');
console.log('  deployez outils/templates-portee.js d\'abord.\n');
console.log('  \u26a0  Le libelle contient desormais du HTML. Si la ligne est');
console.log('     rendue avec textContent plutot qu\'innerHTML, la balise');
console.log('     apparaitra en clair — dites-le-moi et je la retire.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

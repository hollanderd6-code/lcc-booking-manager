#!/usr/bin/env node
/* ============================================================
   outils/photos-lourdes-livret.js
   Une photo de telephone recente etait refusee pour rien
   ============================================================
   Cible : public/welcome.html

   ── CE QUE FAIT LE CODE ACTUEL ───────────────────────────────────
   A la selection d'une photo :

       if (!validateFilesSize(input.files)) { input.value = ''; return; }

   La taille est donc controlee sur le fichier BRUT, tel qu'il sort du
   telephone. Mais le fichier reellement envoye est le fichier COMPRIME,
   produit plus tard par collectFormData — souvent vingt fois plus leger.

   Consequence : une photo de 24 Mo (un telephone recent en 48 Mpx en
   produit couramment) est refusee, alors qu'elle serait partie a 600 Ko.
   Le refus porte sur une taille qui n'aurait jamais ete envoyee.

   Second defaut, plus visible : la selection entiere est videe. Neuf
   photos correctes disparaissent parce que la dixieme etait lourde. Il
   faut tout resaisir, sans savoir laquelle retirer.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   1. La compression a lieu DES LA SELECTION, et le controle de taille
      porte sur le resultat. Ce qui passe est ce qui partira.
   2. Les fichiers comprimes remplacent le contenu du champ : plus de
      seconde compression a l'envoi. L'aperçu s'affiche plus vite, et la
      sauvegarde ne recalcule rien.
   3. Seules les photos encore trop lourdes sont ecartees — les autres
      sont conservees. Le message nomme celles qui n'ont pas passe.
   4. Un compte rendu discret quand la compression a servi :
      « 3 photos préparées · 18,4 Mo → 1,2 Mo ». C'est le seul moment ou
      l'utilisateur voit que le produit travaille pour lui.

   Le cas HEIC des iPhone n'est pas resolu ici : Safari sait le decoder,
   Chrome sur Android non. Il passe alors en l'etat, et sera refuse s'il
   depasse 20 Mo — c'est le comportement actuel, inchange.

   Usage :
     node outils/photos-lourdes-livret.js --essai
     node outils/photos-lourdes-livret.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'welcome.html');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

if (!fs.existsSync(CIBLE)) {
  console.error('\n  \u2717 public/welcome.html introuvable. Lancez depuis la racine.\n');
  process.exit(1);
}

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('bhPreparerFichiers') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Preparer a la selection : comprimer, puis mesurer ─────────── */
edits.push([
  'preparation a la selection',
  `function setupImageUpload(inputId, previewId, multiple = false) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;

  input.addEventListener('change', () => {
    // Validation de taille avant aperçu
    if (!validateFilesSize(input.files)) {
      input.value = ''; // vider la sélection invalide
      return;
    }
    preview.innerHTML = '';
    const files = Array.from(input.files || []);
    if (!files.length) return;`,
  `/* Comprime la selection, puis ne garde que ce qui tient dans la limite.
   Mesurer le fichier brut alors qu'on envoie le fichier comprime refusait des
   photos parfaitement acceptables : une photo de telephone recent depasse
   souvent 20 Mo a la prise, et moins de 1 Mo apres preparation. */
async function bhPreparerFichiers(input) {
  const bruts = Array.from(input.files || []);
  if (!bruts.length) return { gardes: [], refuses: [], avant: 0, apres: 0 };

  const prepares = await compressAll(bruts);
  const gardes = [], refuses = [];
  let avant = 0, apres = 0;

  prepares.forEach((f, i) => {
    avant += bruts[i].size;
    if (f.size > MAX_UPLOAD_BYTES) { refuses.push(f); return; }
    apres += f.size;
    gardes.push(f);
  });

  /* On remplace le contenu du champ par les fichiers prepares : ils partiront
     tels quels, sans seconde compression a l'envoi. Les fichiers ecartes ne
     sont plus dans le champ — le reste de la selection est preserve. */
  try {
    const dt = new DataTransfer();
    gardes.forEach(f => dt.items.add(f));
    input.files = dt.files;
  } catch (e) {
    /* Navigateur qui refuse l'ecriture de input.files : on ne perd rien,
       la compression aura simplement lieu a l'envoi comme avant. */
  }

  return { gardes, refuses, avant, apres };
}

function setupImageUpload(inputId, previewId, multiple = false) {
  const input = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input || !preview) return;

  input.addEventListener('change', async () => {
    if (!input.files || !input.files.length) { preview.innerHTML = ''; return; }

    const boite = input.closest('.wiz-group')?.querySelector('.wiz-upload');
    const texteBoite = boite ? boite.innerHTML : null;
    if (boite) boite.innerHTML = '<i class="fas fa-spinner fa-spin"></i><p>Préparation des photos…</p>';

    const { gardes, refuses, avant, apres } = await bhPreparerFichiers(input);
    if (boite && texteBoite) boite.innerHTML = texteBoite;

    if (refuses.length) {
      const noms = refuses.map(f => \`« \${f.name} » (\${(f.size / 1024 / 1024).toFixed(1)} Mo)\`).join(', ');
      const p = refuses.length > 1 ? 's' : '';
      showDraftToast(\`\${refuses.length} photo\${p} écartée\${p} — trop lourde\${p} même après préparation : \${noms}. Limite \${MAX_UPLOAD_MB} Mo.\`, true);
    }
    if (gardes.length && avant > apres * 1.15) {
      const mo = (o) => (o / 1024 / 1024).toFixed(1).replace('.', ',');
      showDraftToast(\`\${gardes.length} photo\${gardes.length > 1 ? 's' : ''} préparée\${gardes.length > 1 ? 's' : ''} · \${mo(avant)} Mo → \${mo(apres)} Mo\`);
    }

    preview.innerHTML = '';
    const files = Array.from(input.files || []);
    if (!files.length) return;`
]);

/* ── 2. Ne pas re-comprimer ce qui l'est deja ─────────────────────── */
edits.push([
  'note dans compressAll',
  `// Compresse une liste de fichiers en parallèle
async function compressAll(files) {`,
  `/* Compresse une liste de fichiers en parallele. Appelee deux fois dans le
   parcours : a la selection (bhPreparerFichiers) puis a l'envoi. Le second
   passage ne recalcule rien — les fichiers deja prepares font moins de 2 Mo
   ou tiennent dans 1920 px, deux conditions de sortie immediate. */
async function compressAll(files) {`
]);

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) {
    console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
    console.error('    Le fichier a change. Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

if (!ESSAI) fs.writeFileSync(CIBLE, src, 'utf8');

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  La taille est mesuree apres compression, pas avant.');
console.log('  Une photo trop lourde n\'emporte plus toute la selection.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

#!/usr/bin/env node
/* ============================================================
   outils/champs-manquants-livret.js
   Dire QUELS champs manquent, pas seulement qu'il en manque
   ============================================================
   Cible : public/welcome.html

   ── CE QUI EXISTAIT ──────────────────────────────────────────────
   La modale de validation disait :

       « Veuillez remplir tous les champs marques d'un * avant de
         continuer. »

   Alors que le code venait justement de collecter la liste exacte des
   champs vides, dans un tableau. Il posait des bordures rouges, puis
   affichait une modale qui recouvre l'ecran — l'utilisateur voit le
   reproche, pas sa cause, et doit fermer la modale pour chercher.

   Sur l'etape 2, cinq champs sont obligatoires : adresse, code postal,
   ville, plus deux autres. Un champ oublie envoie chercher lequel.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   1. Les intitules manquants sont listes dans la modale, tels qu'ils
      apparaissent dans le formulaire — pas les noms techniques.
   2. Ils sont cliquables : un clic ferme la modale et amene au champ,
      curseur pose dedans.
   3. Le titre compte : « Un champ a completer » ou « 3 champs a
      completer ». Un nombre transforme un reproche vague en tache finie.
   4. La photo de couverture, testee a part dans le code, apparait dans
      la meme liste que les autres.

   L'intitule est lu dans le <label> du champ, debarrasse de l'asterisque
   et de l'exemple qui le suit. C'est le mot que l'utilisateur a sous les
   yeux ; inventer un libelle en parallele creerait deux verites.

   Usage :
     node outils/champs-manquants-livret.js --essai
     node outils/champs-manquants-livret.js
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

if (src.indexOf('bhIntituleChamp') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La modale : liste nommee et cliquable ─────────────────────── */
const A1 = `  if (missing.length > 0) {
    // Modale d'alerte champs manquants
    const existing = document.getElementById('_validModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = '_validModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,17,23,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = \`
      <div style="background:white;border-radius:20px;padding:28px;max-width:360px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.15);">
        <div style="width:52px;height:52px;border-radius:50%;background:#FEF9C3;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;"><i class="fas fa-exclamation-triangle" style="font-size:20px;color:#B45309;"></i></div>
        <h3 style="font-family:'DM Sans',sans-serif;font-size:16px;font-weight:700;color:#0D1117;margin:0 0 8px;">Champs obligatoires manquants</h3>
        <p style="font-size:13px;color:#7A8695;margin:0 0 20px;">Veuillez remplir tous les champs marqués d'un <span style="color:#EF4444;font-weight:700;">*</span> avant de continuer.</p>
        <button onclick="document.getElementById('_validModal').remove()" style="width:100%;height:40px;border-radius:12px;border:none;background:#0E3B2E;color:white;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">OK, je complète</button>
      </div>
    \`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    // Scroll vers le premier champ manquant
    missing[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }`;

const N1 = `  if (missing.length > 0) {
    const existing = document.getElementById('_validModal');
    if (existing) existing.remove();

    /* On identifie chaque champ pour pouvoir y revenir au clic. Les champs du
       formulaire ont un name, pas toujours un id. */
    missing.forEach((f, i) => { if (!f.id) f.id = '_manq' + i; });

    const lignes = missing.map(f => \`
      <li style="margin:0;">
        <button type="button" onclick="bhAllerAuChamp('\${f.id}')"
          style="width:100%;text-align:left;display:flex;align-items:center;gap:9px;
                 background:#FEFCE8;border:1px solid #FDE68A;border-radius:10px;
                 padding:10px 12px;font-family:'DM Sans',sans-serif;font-size:13px;
                 font-weight:600;color:#78350F;cursor:pointer;">
          <i class="fas fa-arrow-right" style="font-size:10px;opacity:.6;"></i>
          <span style="flex:1;">\${bhIntituleChamp(f)}</span>
        </button>
      </li>\`).join('');

    const titre = missing.length === 1
      ? 'Un champ à compléter'
      : missing.length + ' champs à compléter';

    const modal = document.createElement('div');
    modal.id = '_validModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,17,23,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = \`
      <div style="background:white;border-radius:20px;padding:26px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.15);">
        <div style="width:48px;height:48px;border-radius:50%;background:#FEF9C3;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;"><i class="fas fa-exclamation-triangle" style="font-size:19px;color:#B45309;"></i></div>
        <h3 style="font-family:'DM Sans',sans-serif;font-size:16px;font-weight:700;color:#0D1117;margin:0 0 4px;text-align:center;">\${titre}</h3>
        <p style="font-size:12.5px;color:#7A8695;margin:0 0 16px;text-align:center;">Touchez un champ pour y aller directement.</p>
        <ul style="list-style:none;padding:0;margin:0 0 18px;display:flex;flex-direction:column;gap:7px;max-height:46vh;overflow-y:auto;">\${lignes}</ul>
        <button onclick="document.getElementById('_validModal').remove()" style="width:100%;height:40px;border-radius:12px;border:none;background:#0E3B2E;color:white;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;cursor:pointer;">OK, je complète</button>
      </div>
    \`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    return;
  }`;

/* ── 2. Les deux fonctions d'appui ────────────────────────────────── */
const A2 = `function prevSection() {`;

const N2 = `/* L'intitule tel qu'il est affiche a l'utilisateur : on lit le <label> du
   champ, sans l'asterisque ni l'exemple (.wiz-hint) qui le suit. Inventer une
   liste de libelles en parallele creerait deux verites a maintenir. */
function bhIntituleChamp(field) {
  const groupe = field.closest('.wiz-group');
  const label = groupe ? groupe.querySelector('.wiz-label') : null;
  if (label) {
    const copie = label.cloneNode(true);
    copie.querySelectorAll('.wiz-hint, .wiz-required').forEach(n => n.remove());
    const texte = copie.textContent.replace(/\\s+/g, ' ').trim();
    if (texte) return texte;
  }
  // Repli : le champ n'est pas dans un groupe standard (photo de couverture).
  return field.getAttribute('placeholder') || field.name || 'Champ obligatoire';
}

function bhAllerAuChamp(id) {
  const modal = document.getElementById('_validModal');
  if (modal) modal.remove();
  const el = document.getElementById(id);
  if (!el) return;
  const cible = el.type === 'file' ? el.closest('.wiz-group') || el : el;
  const y = cible.getBoundingClientRect().top + window.pageYOffset - 140;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  // Un champ fichier ne prend pas le focus utilement : on ne force que le texte.
  if (el.type !== 'file') setTimeout(() => el.focus({ preventScroll: true }), 350);
}

function prevSection() {`;

const edits = [['modale des champs manquants', A1, N1], ['fonctions d\'appui', A2, N2]];

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
console.log('  La modale nomme les champs manquants et permet d\'y aller au clic.');
console.log('  Les intitules sont lus dans les labels du formulaire.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

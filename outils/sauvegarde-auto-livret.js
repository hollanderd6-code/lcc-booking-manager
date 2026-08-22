#!/usr/bin/env node
/* ============================================================
   outils/sauvegarde-auto-livret.js
   Le livret ne se perd plus en cours de route
   ============================================================
   Cible : public/welcome.html

   ── LE PROBLEME ──────────────────────────────────────────────────
   Le formulaire compte une cinquantaine de champs sur cinq etapes.
   « Enregistrer le brouillon » existe, mais il faut y penser. Vingt
   minutes de saisie disparaissent avec un onglet ferme, une session
   expiree, un telephone qui se verrouille. Ce n'est pas fréquent — mais
   quand ça arrive, la personne ne recommence pas.

   ── CE QUI EST MIS EN PLACE ──────────────────────────────────────

   1. SAUVEGARDE PERIODIQUE, toutes les 60 secondes, uniquement si
      quelque chose a change depuis la derniere ecriture. Un formulaire
      immobile n'ecrit rien.

   2. SANS LES PHOTOS. Le serveur conserve les images deja envoyees
      quand aucun fichier n'accompagne la requete : une sauvegarde
      automatique n'a donc pas besoin de les renvoyer. C'est ce qui rend
      l'operation legere — sinon chaque minute re-comprimerait et
      re-televerserait des dizaines de megaoctets vers Cloudinary, et
      creerait autant de doublons.

      Consequence a connaitre : une photo choisie mais jamais enregistree
      a la main n'est pas sauvegardee. Le texte est protege, la selection
      de fichier ne l'est pas — le navigateur ne le permet pas.

   3. PAS AVANT LE PREMIER ENREGISTREMENT VOLONTAIRE. Sans cela, ouvrir
      le formulaire et taper trois lettres ferait apparaitre un livret
      fantome dans la liste. La sauvegarde automatique ne demarre donc
      qu'une fois qu'un livret existe (brouillon enregistre, ou livret
      en cours de modification).

   4. AVERTISSEMENT A LA FERMETURE des qu'il reste des modifications non
      enregistrees — y compris avant le premier enregistrement, ou c'est
      justement le plus utile.

   5. UN ETAT VISIBLE, discret, a cote des boutons : « Modifications non
      enregistrees » / « Enregistre a 14:32 ». Une sauvegarde silencieuse
      qu'on ne voit pas ne rassure personne.

   Usage :
     node outils/sauvegarde-auto-livret.js --essai
     node outils/sauvegarde-auto-livret.js
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

if (src.indexOf('bhAutoSave') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. collectFormData accepte de laisser les fichiers de cote ───── */
edits.push([
  'collectFormData sans fichiers',
  `async function collectFormData() {
  const formData = new FormData();`,
  `/* avecFichiers = false : sauvegarde automatique. Le serveur garde les photos
   deja envoyees quand la requete n'en porte aucune — inutile de re-comprimer
   et re-televerser des dizaines de Mo toutes les minutes. */
async function collectFormData(avecFichiers = true) {
  const formData = new FormData();`
]);

edits.push([
  'saut des fichiers',
  `  // Fichiers (compressés automatiquement si trop lourds)
  const cover = document.getElementById('coverPhoto')?.files?.[0];`,
  `  // uniqueId si édition — pose avant la sortie anticipee de l'auto-save.
  if (!avecFichiers) {
    if (currentUniqueId) formData.append('uniqueId', currentUniqueId);
    return formData;
  }

  // Fichiers (compressés automatiquement si trop lourds)
  const cover = document.getElementById('coverPhoto')?.files?.[0];`
]);

/* ── 2. Le moteur de sauvegarde automatique ──────────────────────── */
edits.push([
  'moteur de sauvegarde',
  `function showDraftToast(msg, isError = false, persistent = false) {`,
  `/* ── Sauvegarde automatique ─────────────────────────────────────────── */
const bhAutoSave = {
  INTERVALLE: 60000,
  sale: false,          // des modifications attendent d'etre ecrites
  enCours: false,       // une ecriture est en vol : ne pas en lancer deux
  minuteur: null,

  demarrer() {
    if (this.minuteur) return;
    this.minuteur = setInterval(() => this.tenter(), this.INTERVALLE);
  },

  marquerSale() {
    this.sale = true;
    this.afficher('sale');
  },

  async tenter() {
    // Rien a ecrire, ou pas encore de livret : on ne cree rien dans le dos.
    if (!this.sale || this.enCours || !currentUniqueId) return;
    // Le formulaire n'est plus a l'ecran (succes, liste) : plus rien a sauver.
    const form = document.getElementById('welcomeForm');
    if (!form || form.style.display === 'none') return;

    this.enCours = true;
    this.afficher('encours');
    try {
      const formData = await collectFormData(false);
      formData.append('isDraft', 'true');
      formData.append('lastSection', String(currentSectionIndex));

      const r = await fetch(\`\${API_BASE}/api/welcome-books/create\`, { method: 'POST', body: formData });
      if (!r.ok) throw new Error('HTTP ' + r.status);

      this.sale = false;
      this.afficher('ok');
    } catch (e) {
      /* On garde « sale » : la prochaine tentative reessaiera. Un echec
         d'ecriture automatique n'interrompt pas la saisie — mais l'etat
         doit le dire, sinon on croirait etre a l'abri. */
      this.afficher('echec');
    } finally {
      this.enCours = false;
    }
  },

  afficher(etat) {
    document.querySelectorAll('.bh-autosave-etat').forEach(el => {
      if (etat === 'sale')    { el.innerHTML = '<i class="fas fa-circle" style="font-size:6px;color:#D97706;"></i> Modifications non enregistrées'; el.style.color = '#92700F'; }
      if (etat === 'encours') { el.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement…'; el.style.color = '#7A8695'; }
      if (etat === 'echec')   { el.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Enregistrement impossible — réessai en cours'; el.style.color = '#B91C1C'; }
      if (etat === 'ok') {
        const h = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        el.innerHTML = '<i class="fas fa-check"></i> Enregistré à ' + h;
        el.style.color = '#0E3B2E';
      }
    });
  }
};

/* L'indicateur, pose dans chaque barre de navigation d'etape. */
function bhPoserIndicateurs() {
  document.querySelectorAll('.wiz-nav > div:last-child').forEach(zone => {
    if (zone.querySelector('.bh-autosave-etat')) return;
    const s = document.createElement('span');
    s.className = 'bh-autosave-etat';
    s.style.cssText = 'font-size:11.5px;color:#7A8695;display:inline-flex;align-items:center;gap:5px;margin-right:6px;';
    zone.insertBefore(s, zone.firstChild);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('welcomeForm');
  if (!form) return;

  bhPoserIndicateurs();
  form.addEventListener('input',  () => bhAutoSave.marquerSale());
  form.addEventListener('change', () => bhAutoSave.marquerSale());
  bhAutoSave.demarrer();

  /* Un depart avec du travail non ecrit doit etre confirme. Utile surtout
     avant le premier enregistrement, quand rien n'existe encore en base. */
  window.addEventListener('beforeunload', function (e) {
    if (!bhAutoSave.sale) return;
    const f = document.getElementById('welcomeForm');
    if (!f || f.style.display === 'none') return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
});

function showDraftToast(msg, isError = false, persistent = false) {`
]);

/* ── 3. Une ecriture manuelle remet le compteur a zero ────────────── */
edits.push([
  'brouillon manuel',
  `    showDraftToast('✓ Brouillon enregistré !');`,
  `    showDraftToast('✓ Brouillon enregistré !');
    // Le travail est en base : l'auto-save n'a plus rien a rattraper.
    bhAutoSave.sale = false;
    bhAutoSave.afficher('ok');`
]);

edits.push([
  'publication',
  `    // Affichage succès
    hideDraftToast();`,
  `    // Publie : plus rien a sauvegarder, et pas d'alerte au depart.
    bhAutoSave.sale = false;

    // Affichage succès
    hideDraftToast();`
]);

/* ── 4. Charger un livret existant ne compte pas comme une modif ──── */
edits.push([
  'chargement d\'un livret',
  `function fillFormWithData(data) {
  if (!data) return;`,
  `function fillFormWithData(data) {
  if (!data) return;
  /* Le remplissage declenche des evenements « input » : sans cette remise a
     zero differee, ouvrir un livret le marquerait aussitot comme modifie. */
  setTimeout(() => { if (typeof bhAutoSave !== 'undefined') { bhAutoSave.sale = false; bhAutoSave.afficher('ok'); } }, 400);`
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
console.log('  Sauvegarde automatique toutes les 60 s, texte seul, si modifie.');
console.log('  Avertissement a la fermeture si du travail attend.');
console.log('  Etat visible a cote des boutons de navigation.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

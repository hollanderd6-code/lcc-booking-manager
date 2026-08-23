#!/usr/bin/env node
/* ============================================================
   outils/partage-livret.js
   Le lien du livret, enfin visible
   ============================================================
   Cible : public/welcome.html

   ── CE QUI MANQUAIT ──────────────────────────────────────────────
   Le livret n'existe que pour etre envoye aux voyageurs. Or depuis la
   liste, son adresse n'apparait nulle part : une icone de chaine la
   copie dans le presse-papier, sans jamais la montrer. On copie a
   l'aveugle, et rien ne dit ce qu'on vient de copier.

   Le QR code, lui, est encore plus loin. La fonction downloadQRCode
   existe et fonctionne, mais aucun bouton de la liste ne l'appelle —
   elle n'est atteignable que depuis l'ecran de confirmation, celui
   qu'on voit une fois et qu'on ne revoit jamais. Un QR code sert
   pourtant a etre imprime et colle dans le logement, c'est-a-dire
   longtemps apres la creation.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Un panneau « Partager », ouvert depuis la liste, qui montre :

     — l'adresse en clair, selectionnable, dans une police a chasse fixe ;
     — un bouton qui la copie, avec confirmation sur le bouton lui-meme ;
     — le QR code, affiche et telechargeable en PNG ;
     — un lien pour ouvrir le livret tel que le voyageur le verra.

   Le QR est genere a l'ouverture du panneau par la bibliotheque deja
   chargee dans la page, et pose avec l'attribut data-qr que
   downloadQRCode sait retrouver : le telechargement passe par le chemin
   existant, sans code parallele.

   Un brouillon n'a pas d'adresse publique : le bouton reste desactive,
   comme les autres actions de publication.

   Usage :
     node outils/partage-livret.js --essai
     node outils/partage-livret.js
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

if (src.indexOf('ouvrirPartage') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

const edits = [];

/* ── 1. Le panneau ────────────────────────────────────────────────── */
edits.push([
  'panneau de partage',
  `// ── Drag & Drop livrets ──────────────────────────────────────`,
  `/* ── Partage d'un livret ─────────────────────────────────────────────
   Montre l'adresse plutot que de la copier a l'aveugle, et remet le QR code
   a portee : il sert a etre imprime et colle dans le logement, longtemps
   apres la creation. */
function ouvrirPartage(uniqueId, nom) {
  const url = PUBLIC_BASE + '/welcome/' + uniqueId;
  const ancien = document.getElementById('_partageModal');
  if (ancien) ancien.remove();

  const modal = document.createElement('div');
  modal.id = '_partageModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(13,17,23,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = \`
    <div style="background:white;border-radius:20px;padding:24px;max-width:390px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.15);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;">
        <div>
          <h3 style="font-family:'DM Sans',sans-serif;font-size:16px;font-weight:700;color:#0D1117;margin:0 0 2px;">Partager le livret</h3>
          <p style="font-size:12.5px;color:#7A8695;margin:0;">\${(nom || '').replace(/</g, '&lt;') || 'Sans nom'}</p>
        </div>
        <button onclick="document.getElementById('_partageModal').remove()" style="background:none;border:none;font-size:18px;color:#9CA3AF;cursor:pointer;line-height:1;padding:0;">&times;</button>
      </div>

      <label style="font-size:11.5px;font-weight:600;color:#7A8695;display:block;margin-bottom:5px;">Adresse à envoyer à vos voyageurs</label>
      <div style="display:flex;gap:8px;margin-bottom:18px;">
        <input id="_partageUrl" value="\${url}" readonly onclick="this.select()"
          style="flex:1;min-width:0;border:1px solid rgba(32,34,31,.12);border-radius:10px;padding:9px 11px;
                 font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#0D1117;background:#FAFAF7;"/>
        <button id="_partageCopy" onclick="copierDepuisPartage(this)"
          style="border:none;background:#0E3B2E;color:white;font-family:'DM Sans',sans-serif;font-size:12.5px;
                 font-weight:600;padding:0 14px;border-radius:10px;cursor:pointer;white-space:nowrap;">Copier</button>
      </div>

      <div style="text-align:center;padding:16px;background:#FAFAF7;border-radius:14px;margin-bottom:16px;">
        <div id="_partageQr" style="display:inline-block;line-height:0;"></div>
        <p style="font-size:11.5px;color:#7A8695;margin:10px 0 0;">À imprimer et laisser dans le logement</p>
      </div>

      <div style="display:flex;gap:8px;">
        <button onclick="downloadQRCode('\${uniqueId}')"
          style="flex:1;border:1px solid rgba(32,34,31,.12);background:white;color:#0D1117;font-family:'DM Sans',sans-serif;
                 font-size:12.5px;font-weight:600;padding:10px;border-radius:10px;cursor:pointer;">
          <i class="fas fa-download" style="font-size:11px;"></i> QR code
        </button>
        <button onclick="viewLivret('\${uniqueId}')"
          style="flex:1;border:1px solid rgba(32,34,31,.12);background:white;color:#0D1117;font-family:'DM Sans',sans-serif;
                 font-size:12.5px;font-weight:600;padding:10px;border-radius:10px;cursor:pointer;">
          <i class="fas fa-arrow-up-right-from-square" style="font-size:11px;"></i> Ouvrir
        </button>
      </div>
    </div>\`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  /* Le QR est pose avec data-qr : downloadQRCode le retrouve par cet attribut
     et telecharge l'image affichee — pas de seconde generation en parallele. */
  const hote = document.getElementById('_partageQr');
  if (hote && window.QRCode) {
    new QRCode(hote, { text: url, width: 148, height: 148 });
    setTimeout(() => {
      const img = hote.querySelector('img');
      if (img) img.setAttribute('data-qr', uniqueId);
    }, 200);
  } else if (hote) {
    hote.innerHTML = '<p style="font-size:12px;color:#9CA3AF;line-height:1.5;">QR code indisponible sur cette page.</p>';
  }
}

function copierDepuisPartage(btn) {
  const champ = document.getElementById('_partageUrl');
  if (!champ) return;
  navigator.clipboard.writeText(champ.value).then(() => {
    btn.textContent = 'Copié';
    btn.style.background = '#1E6E52';
    setTimeout(() => { btn.textContent = 'Copier'; btn.style.background = '#0E3B2E'; }, 1800);
  }).catch(() => {
    // Presse-papier refuse (contexte non securise) : on selectionne pour un copier manuel.
    champ.select();
  });
}

// ── Drag & Drop livrets ──────────────────────────────────────`
]);

/* ── 2. Le bouton, en vue grille ──────────────────────────────────── */
edits.push([
  'bouton en vue grille',
  `          <button class="btn-lv btn-lv-qr" onclick="copyLivretLink('\${livret.uniqueId}', this)" title="Copier le lien"\${livret.isDraft ? ' style="opacity:.4;cursor:not-allowed;" disabled' : ''}><i class="fas fa-link"></i></button>`,
  `          <button class="btn-lv btn-lv-qr" onclick="ouvrirPartage('\${livret.uniqueId}', '\${(livret.propertyName || '').replace(/'/g, "\\\\'")}')" title="Partager : lien et QR code"\${livret.isDraft ? ' style="opacity:.4;cursor:not-allowed;" disabled' : ''}><i class="fas fa-share-nodes"></i></button>`
]);

/* ── 3. Le bouton, en vue liste ───────────────────────────────────── */
edits.push([
  'bouton en vue liste',
  `        <button class="btn-list-act" title="Copier le lien" onclick="copyLivretLink('\${livret.uniqueId}', this)"\${isDraft ? ' disabled style="opacity:.4;"' : ''}><i class="fas fa-link"></i></button>`,
  `        <button class="btn-list-act" title="Partager : lien et QR code" onclick="ouvrirPartage('\${livret.uniqueId}', '\${(livret.propertyName || '').replace(/'/g, "\\\\'")}')"\${isDraft ? ' disabled style="opacity:.4;"' : ''}><i class="fas fa-share-nodes"></i></button>`
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
console.log('  Panneau « Partager » : adresse visible, copie, QR code, ouverture.');
console.log('  Accessible depuis les deux vues de la liste.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

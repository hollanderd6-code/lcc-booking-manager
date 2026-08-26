#!/usr/bin/env node
/* ============================================================
   outils/verrou-scroll-desktop.js
   La cause reelle : html/body verrouilles en overflow:hidden
   ============================================================
   Cible : public/*.html

   ── CE QU'ON CHERCHAIT DEPUIS LE DEBUT ───────────────────────────
   Ce n'etait ni le meta viewport, ni le fond de la barre, ni la
   capsule, ni env(). C'est cette regle, ecrite dans le CSS des pages
   concernees :

       /* Prevent page scroll - only internal panels scroll *\/
       html[data-theme-v3="1"],
       html[data-theme-v3="1"] body {
         overflow: hidden !important;
         height: 100% !important;
       }

   app.html et reservations.html ne l'ont pas. C'est toute la
   difference, et c'est pourquoi les metas etaient identiques.

   Mesures a l'appui, sur le meme iPhone :

       app.html      html/body overflow auto,   hauteur 2667  -> innerHeight 902
       messages.html html/body overflow hidden, hauteur  860  -> innerHeight 868

   WKWebView n'etend le viewport sous l'indicateur d'accueil que pour
   un document qui defile. Verrouille en overflow:hidden avec une
   hauteur figee, il le laisse a 868 et peint lui-meme les 34 px
   restants — d'ou la bande, hors d'atteinte du CSS. Aucun de mes
   correctifs precedents ne pouvait donc l'atteindre : ils agissaient
   tous a l'interieur du viewport.

   Verifie en console : en relachant html/body, innerHeight passe
   immediatement de 868 a 902 et la bande disparait.

   ── CE QUE FAIT CE SCRIPT ────────────────────────────────────────
   Le verrou reste utile en desktop : sur ces pages, seuls les
   panneaux internes doivent defiler. On ne le supprime pas, on le
   limite a la largeur desktop, la ou la barre d'onglets mobile
   n'existe pas.

   Le seuil retenu est 1367 px, celui deja utilise par ces pages pour
   leurs regles desktop (.bh-desktop-header, .msgs-tabs), plutot qu'une
   valeur nouvelle a maintenir.

   Usage :
     node outils/verrou-scroll-desktop.js --essai
     node outils/verrou-scroll-desktop.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const DOSSIER = path.join(process.cwd(), 'public');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const MARQUE = 'verrou de scroll limite au desktop';

function echec(msg) {
  console.error('\n  \u2717 ' + msg + '\n    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(DOSSIER)) echec('Dossier public/ introuvable. Lancez depuis la racine du projet.');

/* La regle, avec ses variantes d'espacement et de retours a la ligne.
   On capture le bloc complet pour pouvoir l'envelopper tel quel. */
const MOTIF = /(([ \t]*)html\[data-theme-v3="1"\][ \t]*,[ \t]*\r?\n[ \t]*html\[data-theme-v3="1"\][ \t]+body[ \t]*\{[^}]*overflow[ \t]*:[ \t]*hidden[^}]*\})/g;

const fichiers = fs.readdirSync(DOSSIER).filter(f => f.endsWith('.html'));
const touches = [];
const ecritures = [];

for (const nom of fichiers) {
  const chemin = path.join(DOSSIER, nom);
  let src = fs.readFileSync(chemin, 'utf8');

  if (src.indexOf(MARQUE) !== -1) continue;          // deja traite

  let n = 0;
  const sortie = src.replace(MOTIF, function (bloc, _b, indent) {
    n++;
    const dedans = bloc.split('\n').map(l => '  ' + l).join('\n');
    return indent + '/* ' + MARQUE + ' — sur iOS, un document verrouille en\n' +
      indent + '   overflow:hidden empeche WKWebView d\'etendre le viewport sous\n' +
      indent + '   l\'indicateur d\'accueil : innerHeight restait a 868 au lieu de 902,\n' +
      indent + '   et les 34 px restants apparaissaient en bande sous la barre\n' +
      indent + '   d\'onglets, peints par la WebView et hors d\'atteinte du CSS.\n' +
      indent + '   Le verrou garde son sens en desktop, ou seuls les panneaux\n' +
      indent + '   internes doivent defiler. Seuil 1367 px : celui deja utilise par\n' +
      indent + '   ces pages pour leurs regles desktop. */\n' +
      indent + '@media (min-width: 1367px) {\n' + dedans + '\n' + indent + '}';
  });

  if (n > 0) {
    touches.push(nom + ' (' + n + ')');
    ecritures.push([chemin, sortie]);
  }
}

if (!touches.length) {
  echec('Regle introuvable dans public/*.html — elle a peut-etre change de forme.\n      Envoyez : grep -n "Prevent page scroll" public/*.html');
}

if (!ESSAI) {
  for (const [chemin, contenu] of ecritures) fs.writeFileSync(chemin, contenu, 'utf8');
  for (const [chemin] of ecritures) {
    if (fs.readFileSync(chemin, 'utf8').indexOf(MARQUE) === -1) {
      echec('La correction n\'est pas dans ' + path.basename(chemin) + ' apres ecriture.');
    }
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Verrou de scroll limite au desktop dans :');
for (const t of touches) console.log('    ' + t);
console.log('\n  Sur iOS, ces pages retrouvent innerHeight 902 comme app.html,');
console.log('  et la bande sous la barre disparait.\n');
console.log('  npx cap sync ios, puis reconstruire depuis Xcode.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

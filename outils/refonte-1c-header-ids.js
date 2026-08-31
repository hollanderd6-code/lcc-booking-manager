#!/usr/bin/env node
/* ============================================================
   outils/refonte-1c-header-ids.js
   Lot 1c : les vrais id, releves sur le telephone
   ============================================================

   Mes selecteurs du lot 1b etaient des paris sur vos noms de classes.
   Les quatre etaient faux. Voici les vrais, lus dans le header :

       bh-mobile-svc            les deux pastilles d'etat serveur
       bh-mobile-ann-btn        le point d'interrogation (annonces / info)
       agencySwitcherBtnMobile  le bouton violet, mode agence
       syncBtnMobile            actualiser  -> retire
       bh-mobile-notif-btn      la cloche, badge 9
       .bhgs-trigger-mobile     la loupe   -> conservee
       .mobile-logo             le logo    -> conserve

   Ce lot ne fait que remplacer les listes de selecteurs dans
   bh-header-epure.js. Aucune autre ligne ne bouge.

   Usage :
     node outils/refonte-1c-header-ids.js --essai
     node outils/refonte-1c-header-ids.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'public', 'js', 'bh-header-epure.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('public/js/bh-header-epure.js introuvable. Lancez d\'abord refonte-1b-header.js.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('bh-mobile-svc') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois) dans bh-header-epure.js.');
  }
  src = src.split(avant).join(apres);
}

/* ── Les quatre listes, corrigees ────────────────────────────── */

remplacer(
  "      selecteurs: ['#serverStatus', '#statusDots', '.server-status', '[data-server-status]', '#healthDots', '.status-dot'],",
  "      selecteurs: ['#bh-mobile-svc'],",
  'la liste etat serveurs'
);

remplacer(
  "      selecteurs: ['#notifBtn', '#notificationsBtn', '.notif-btn', '[data-notifications]', '#bellBtn', '.notification-bell'],",
  "      selecteurs: ['#bh-mobile-notif-btn'],",
  'la liste notifications'
);

remplacer(
  "      selecteurs: ['#agencyBtn', '#agenceBtn', '[data-agency]', '.agency-btn', '#switchAgency'],",
  "      selecteurs: ['#agencySwitcherBtnMobile'],",
  'la liste mode agence'
);

remplacer(
  "      selecteurs: ['#infoBtn', '#helpBtn', '[data-info]', '.info-btn', '#aideBtn'],",
  "      selecteurs: ['#bh-mobile-ann-btn'],",
  'la liste aide et informations'
);

remplacer(
  "  var ACTUALISER = ['#refreshBtn', '#reloadBtn', '[data-refresh]', '.refresh-btn', '#actualiserBtn', '[onclick*=\"location.reload\"]'];",
  "  var ACTUALISER = ['#syncBtnMobile'];",
  'la liste actualiser'
);

/* ── Le badge de la cloche ───────────────────────────────────── */
/* Le compteur « 9 » est le texte du bouton lui-meme, pas un .badge
   enfant. On lit donc le texte, avec le .badge en repli. */

remplacer(
`        var badge = el.querySelector ? el.querySelector('.badge, .notif-count, sup, [data-count]') : null;
        var n = badge ? parseInt((badge.textContent || '').replace(/\\D/g, ''), 10) : 0;`,
`        var badge = el.querySelector ? el.querySelector('.badge, .notif-count, sup, [data-count]') : null;
        var brut = badge ? badge.textContent : el.textContent;
        var n = parseInt((brut || '').replace(/\\D/g, ''), 10) || 0;`,
  'la lecture du badge'
);

/* ── Les pastilles : deux <span> dans #bh-mobile-svc ─────────── */
/* closest('button') resoudrait au bouton lui-meme, ce qui est bien ici
   puisque l'id EST le bouton. Rien a changer, mais on elargit la
   recherche des pastilles aux pseudo-elements exclus (span vides). */

remplacer(
  "        var dots = el.querySelectorAll ? el.querySelectorAll('span,i,div') : [];",
  "        var dots = el.querySelectorAll ? el.querySelectorAll('span,i,div,em,b') : [];",
  'la recherche des pastilles'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['etat serveurs', "selecteurs: ['#bh-mobile-svc']"],
  ['notifications', "selecteurs: ['#bh-mobile-notif-btn']"],
  ['mode agence', "selecteurs: ['#agencySwitcherBtnMobile']"],
  ['aide', "selecteurs: ['#bh-mobile-ann-btn']"],
  ['actualiser', "ACTUALISER = ['#syncBtnMobile']"],
  ['lecture badge', 'var brut = badge ? badge.textContent : el.textContent;'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* La loupe et le logo ne doivent JAMAIS etre touches. */
['bhgs-trigger-mobile', 'mobile-logo'].forEach(function (garde) {
  if (src.indexOf("'#" + garde + "'") !== -1 || src.indexOf("'." + garde + "'") !== -1) {
    echec('La loupe ou le logo apparaissent dans une liste a masquer. Refus.');
  }
});

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('bh-mobile-svc') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  bh-mobile-svc            -> Etat des serveurs');
console.log('  bh-mobile-notif-btn      -> Notifications (badge lu sur le bouton)');
console.log('  agencySwitcherBtnMobile  -> Mode agence');
console.log('  bh-mobile-ann-btn        -> Aide et informations');
console.log('  syncBtnMobile            -> retire');
console.log('\n  Conserves : .mobile-logo, .bhgs-trigger-mobile (la loupe).');
console.log('\n  A verifier sur telephone, apres vidage du cache : /app.html');
console.log('  Le header ne garde que le logo et la loupe.');
console.log('  bhVerifHeader() doit rendre masques: 5, deplaces_introuvables: [].\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

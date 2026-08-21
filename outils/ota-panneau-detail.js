#!/usr/bin/env node
/* ============================================================
   Panneau des plateformes : nommer les logements, pouvoir modifier
   ============================================================
   Cibles : public/js/bh-ota-status.js et public/js/bh-ota-connect.js

   ── 1. « 2 LOGEMENTS A CONNECTER » SANS DIRE LESQUELS ────────────
   Le compteur ne gardait que le NOMBRE de logements connectes par
   plateforme. Pour savoir de quels logements il s'agit, il fallait
   ouvrir les fiches une par une.

   compter() renvoie desormais la LISTE des identifiants, pas un total.
   Le detail de chaque ligne devient depliable et nomme les logements
   concernes. Un bouton plutot qu'un survol : au doigt, un survol
   n'existe pas.

   ── 2. « 3 SANS ADRESSE » ECRIT DEUX FOIS, ET SANS DIRE QUOI FAIRE ─
   La mention apparaissait dans le sous-titre ET dans le pied du
   panneau. Sur 3 logements sur 3 elle devient un avertissement
   permanent que rien ne resout, puisqu'elle ne dit pas a quoi
   l'adresse sert ni ce qu'il faut faire.

   Elle ne figure plus qu'une fois, en pied, et dit son objet :
   l'adresse sert a reperer deux logements du meme immeuble pour les
   regrouper. Sans elle, chaque logement est traite separement — ce
   qui est correct pour un logement independant.

   ── 3. « pas encore dans Channex » ───────────────────────────────
   Reste de la mention du prestataire dans le sous-titre. Devient
   « a preparer ».

   ── 4. UNE CONNEXION ETABLIE N'ETAIT PLUS MODIFIABLE ─────────────
   Une plateforme connectee affichait « Connecte — rien a faire » et
   une coche, sans aucune action. Or il y a des raisons legitimes d'y
   revenir : corriger un mapping, remapper apres avoir renomme une
   annonce, verifier ce qui est associe.

   La ligne recoit un bouton « Modifier » qui rouvre la fenetre du
   partenaire sur ce canal — la ou le mapping se change. Le libelle
   passe de « Connecte — rien a faire » a « Connecte ».

   Usage :
     node outils/ota-panneau-detail.js --essai
     node outils/ota-panneau-detail.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const F_STATUS = path.join(process.cwd(), 'public', 'js', 'bh-ota-status.js');
const F_CONNECT = path.join(process.cwd(), 'public', 'js', 'bh-ota-connect.js');

for (const f of [F_STATUS, F_CONNECT]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + path.relative(process.cwd(), f) + ' introuvable.');
    console.error('    Lancez depuis la racine du depot.\n');
    process.exit(1);
  }
}

/* ══ bh-ota-status.js ══════════════════════════════════════════ */
const editsStatus = [];

/* 1a. compter() renvoie des listes d'identifiants */
editsStatus.push(['compter() garde les identifiants',
`    var parPlateforme = {};
    PLATEFORMES.forEach(function (pf) {
      parPlateforme[pf.cle] = reponses.filter(function (canaux) {
        return canaux && canaux.some(function (c) {
          return pf.codes.some(function (code) { return c === code || c.indexOf(code) > -1; });
        });
      }).length;
    });`,
`    /* On garde les IDENTIFIANTS des logements connectes, pas seulement leur
       nombre : « 2 logements à connecter » sans dire lesquels oblige à ouvrir
       les fiches une par une pour retrouver l'information. */
    var parPlateforme = {};
    PLATEFORMES.forEach(function (pf) {
      parPlateforme[pf.cle] = [];
      prets.forEach(function (p, n) {
        var canaux = reponses[n];
        if (canaux && canaux.some(function (c) {
          return pf.codes.some(function (code) { return c === code || c.indexOf(code) > -1; });
        })) parPlateforme[pf.cle].push(p.id || p._id);
      });
    });`]);

/* 1b. ligne() nomme les logements et devient depliable */
editsStatus.push(['ligne() depliable et nommee',
`  function ligne(pf, connectes, total) {
    var restants = Math.max(0, total - connectes);
    var jamais = connectes === 0;
    var compteur = jamais ? '—' : connectes + ' / ' + total;
    var detail = jamais ? 'Jamais connectée'
      : (restants ? restants + ' logement' + (restants > 1 ? 's' : '') + ' à connecter' : 'Tous vos logements sont connectés');

    return '<div style="display:grid;grid-template-columns:34px 1fr auto auto;align-items:center;gap:14px;' +
      'padding:13px 20px;border-bottom:1px solid ' + V.ligne2 + ';">' +
      '<span style="width:30px;height:30px;border-radius:8px;background:' + pf.fond + ';border:1px solid ' + pf.filet +
      ';color:' + pf.couleur + ';display:flex;align-items:center;justify-content:center;">' + pf.icone + '</span>' +
      '<span><span style="display:block;font-size:14px;font-weight:600;color:' + V.encre + ';">' + pf.label + '</span>' +
      '<span style="display:block;font-size:12.5px;color:' + (jamais ? V.t4 : V.t3) + ';margin-top:2px;">' + detail + '</span></span>' +
      '<span style="font-size:14px;font-weight:600;color:' + (jamais ? V.t4 : (restants ? V.encre : V.vertClair)) +
      ';font-variant-numeric:tabular-nums;">' + compteur + '</span>' +
      (restants
        ? '<button type="button" onclick="bhOuvrirLotOTA&&bhOuvrirLotOTA()" style="border:1px solid ' + V.vertFilet +
          ';background:' + V.vertPale + ';color:' + V.vert + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
          'padding:7px 13px;border-radius:8px;cursor:pointer;white-space:nowrap;">Connecter</button>'
        : '<span style="font-size:13px;color:' + V.vertClair + ';">✓</span>') +
      '</div>';
  }`,
`  function nomDe(p) {
    return String(p.internalName || p.internal_name || p.name || 'Sans nom');
  }

  function echapper(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ligne(pf, ids, tous) {
    var connectes = ids.length;
    var total = tous.length;
    var manquants = tous.filter(function (p) { return ids.indexOf(p.id || p._id) === -1; });
    var jamais = connectes === 0;
    var compteur = jamais ? '—' : connectes + ' / ' + total;
    var detail = jamais ? 'Jamais connectée'
      : (manquants.length ? manquants.length + ' logement' + (manquants.length > 1 ? 's' : '') + ' à connecter'
                          : 'Tous vos logements sont connectés');

    /* Les logements a nommer : ceux qui manquent, ou tous si la plateforme
       n'a jamais ete essayee. Depliable par un bouton et non par un survol :
       au doigt, un survol n'existe pas. */
    var aNommer = jamais ? tous : manquants;
    var idListe = 'bhOtaListe_' + pf.cle;
    var couleurDetail = jamais ? V.t4 : V.t3;

    var bascule = 'var e=document.getElementById(\\'' + idListe + '\\');' +
      'var o=e.style.display===\\'none\\';e.style.display=o?\\'block\\':\\'none\\';' +
      'this.setAttribute(\\'aria-expanded\\',o);' +
      'this.querySelector(\\'span\\').textContent=o?\\'▴\\':\\'▾\\';';

    var libelle = aNommer.length
      ? '<button type="button" aria-expanded="false" aria-controls="' + idListe + '" onclick="' + bascule + '" ' +
        'style="display:block;margin-top:2px;padding:0;border:0;background:transparent;font-family:inherit;' +
        'font-size:12.5px;color:' + couleurDetail + ';cursor:pointer;text-align:left;">' + detail +
        ' <span aria-hidden="true">▾</span></button>'
      : '<span style="display:block;font-size:12.5px;color:' + couleurDetail + ';margin-top:2px;">' + detail + '</span>';

    var liste = aNommer.length
      ? '<div id="' + idListe + '" style="display:none;grid-column:2 / -1;padding:6px 0 2px;">' +
        aNommer.map(function (p) {
          return '<span style="display:block;font-size:12.5px;color:' + V.t2 + ';padding:3px 0;">' +
            echapper(nomDe(p)) + '</span>';
        }).join('') + '</div>'
      : '';

    return '<div style="display:grid;grid-template-columns:34px 1fr auto auto;align-items:center;gap:14px;' +
      'padding:13px 20px;border-bottom:1px solid ' + V.ligne2 + ';">' +
      '<span style="width:30px;height:30px;border-radius:8px;background:' + pf.fond + ';border:1px solid ' + pf.filet +
      ';color:' + pf.couleur + ';display:flex;align-items:center;justify-content:center;">' + pf.icone + '</span>' +
      '<span><span style="display:block;font-size:14px;font-weight:600;color:' + V.encre + ';">' + pf.label + '</span>' +
      libelle + '</span>' +
      '<span style="font-size:14px;font-weight:600;color:' + (jamais ? V.t4 : (manquants.length ? V.encre : V.vertClair)) +
      ';font-variant-numeric:tabular-nums;">' + compteur + '</span>' +
      (manquants.length
        ? '<button type="button" onclick="bhOuvrirLotOTA&&bhOuvrirLotOTA()" style="border:1px solid ' + V.vertFilet +
          ';background:' + V.vertPale + ';color:' + V.vert + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
          'padding:7px 13px;border-radius:8px;cursor:pointer;white-space:nowrap;">Connecter</button>'
        : '<span style="font-size:13px;color:' + V.vertClair + ';">✓</span>') +
      liste +
      '</div>';
  }`]);

/* 1c. sous-titre : plus de « Channex », plus de doublon « sans adresse » */
editsStatus.push(['sous-titre du panneau',
`      '<div style="font-size:12.5px;color:' + V.t3 + ';margin-top:2px;">' + total + ' logements' +
      (aPreparer ? ' · ' + aPreparer + ' pas encore dans Channex' : '') +
      (sansAdresse ? ' · <span style="color:#916018;">' + sansAdresse + ' sans adresse</span>' : '') + '</div></div>' +`,
`      /* La mention « sans adresse » ne figure plus ici : elle etait ecrite
         deux fois sur le meme ecran, et n'apprend rien a cet endroit. Elle est
         en pied de panneau, ou elle peut expliquer a quoi l'adresse sert. */
      '<div style="font-size:12.5px;color:' + V.t3 + ';margin-top:2px;">' + total + ' logements' +
      (aPreparer ? ' · ' + aPreparer + ' à préparer' : '') + '</div></div>' +`]);

/* 1d. pied de panneau : dire a quoi sert l'adresse */
editsStatus.push(['pied du panneau',
`      'Un tiret signifie que la plateforme n\\'a jamais été essayée, pas qu\\'elle a échoué.' +
      (sansAdresse ? ' — <span style="color:#916018;">' + sansAdresse + ' logement' + (sansAdresse > 1 ? 's' : '') +
        ' sans adresse : le regroupement par immeuble ne peut pas être déduit pour ' +
        (sansAdresse > 1 ? 'ceux-là' : 'celui-là') + '.</span>' : '') + '</div>');`,
`      'Un tiret signifie que la plateforme n\\'a jamais été essayée, pas qu\\'elle a échoué.' +
      (sansAdresse
        ? '<span style="display:block;margin-top:6px;color:#916018;">' + sansAdresse + ' logement' +
          (sansAdresse > 1 ? 's n\\'ont' : ' n\\'a') + ' pas d\\'adresse. L\\'adresse sert à reconnaître deux ' +
          'logements d\\'un même immeuble pour les regrouper sur les plateformes. Sans elle, chacun est traité ' +
          'séparément — ce qui est correct pour un logement indépendant.</span>'
        : '') + '</div>');`]);

/* 1e. appel de ligne() avec la nouvelle signature */
editsStatus.push(['appel de ligne()',
`      PLATEFORMES.map(function (pf) { return ligne(pf, compte[pf.cle] || 0, total); }).join('') +`,
`      PLATEFORMES.map(function (pf) { return ligne(pf, compte[pf.cle] || [], logements()); }).join('') +`]);

/* ══ bh-ota-connect.js ═════════════════════════════════════════ */
const editsConnect = [];

editsConnect.push(['libelle d\'une plateforme connectee',
`      var etat = ok ? 'Connecté — rien à faire' : (attente ? "Une autorisation à donner une fois dans votre extranet" : p.cout);`,
`      var etat = ok ? 'Connecté' : (attente ? "Une autorisation à donner une fois dans votre extranet" : p.cout);`]);

editsConnect.push(['bouton Modifier sur une connexion etablie',
`        (ok ? '<span style="font-size:13px;color:' + V.vertClair + ';font-weight:500;">✓</span>' : action) +`,
`        /* Une connexion etablie doit rester modifiable : corriger un mapping,
           remapper apres avoir renomme une annonce, verifier ce qui est
           associe. « Connecte — rien a faire » fermait la porte. */
        (ok
          ? '<span style="display:flex;align-items:center;gap:10px;">' +
            '<span style="font-size:13px;color:' + V.vertClair + ';font-weight:500;">✓</span>' +
            '<button type="button" onclick="window._bhOta(\\'' + p.code + '\\')" style="border:1px solid ' + V.ligne +
            ';background:#fff;color:' + V.t2 + ';font-family:' + V.sans + ';font-size:12.5px;font-weight:500;' +
            'padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;">Modifier</button></span>'
          : action) +`]);

/* ══ Application ═══════════════════════════════════════════════ */
function appliquer(fichier, edits, nom) {
  let src = fs.readFileSync(fichier, 'utf8');
  let faits = 0, deja = 0;
  console.log('\n  ' + nom);
  for (const [libelle, ancien, nouveau] of edits) {
    if (src.indexOf(nouveau) !== -1) { console.log('    deja fait  ' + libelle); deja++; continue; }
    const n = src.split(ancien).length - 1;
    if (n !== 1) {
      console.error('\n  \u2717 ' + libelle + ' : ' + n + ' occurrence(s), 1 attendue.');
      console.error('    Le fichier a change. AUCUN fichier n\'a ete ecrit.\n');
      process.exit(1);
    }
    src = src.split(ancien).join(nouveau);
    console.log('    applique   ' + libelle);
    faits++;
  }
  try {
    new Function(src);
  } catch (e) {
    console.error('\n  \u2717 ' + nom + ' : resultat invalide — ' + e.message);
    console.error('    AUCUN fichier n\'a ete ecrit.\n');
    process.exit(1);
  }
  return { src: src, faits: faits, deja: deja };
}

// On calcule TOUT avant d'ecrire : si le second fichier echoue, le premier
// n'est pas laisse a moitie modifie.
const rStatus = appliquer(F_STATUS, editsStatus, 'bh-ota-status.js');
const rConnect = appliquer(F_CONNECT, editsConnect, 'bh-ota-connect.js');

if (!rStatus.faits && !rConnect.faits) {
  console.log('\n  Tout etait deja applique — rien a ecrire.\n');
  process.exit(0);
}

if (!ESSAI) {
  fs.writeFileSync(F_STATUS, rStatus.src, 'utf8');
  fs.writeFileSync(F_CONNECT, rConnect.src, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Syntaxe des deux fichiers verifiee.');
console.log('\n  A VOIR A L\'ECRAN');
console.log('    Mes logements, panneau « Vos plateformes » :');
console.log('      - « 2 logements à connecter » est cliquable et deplie les noms ;');
console.log('      - le sous-titre ne dit plus « pas encore dans Channex » ;');
console.log('      - « sans adresse » n\'apparait qu\'une fois, en pied, et');
console.log('        explique a quoi l\'adresse sert.');
console.log('    Un logement connecte \u2192 les lignes Airbnb et Booking ont');
console.log('    desormais un bouton « Modifier » a cote de la coche.');
console.log('');

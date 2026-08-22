#!/usr/bin/env node
/* ============================================================
   Ajouter l'envoi des tarifs a la sequence, et monter la route
   ============================================================
   Deux fichiers touches :
     public/js/bh-ota-connect.js  — une cinquieme etape dans _bhEnvoyer
     server.js                    — la ligne de montage de la route

   ── POURQUOI ────────────────────────────────────────────────────
   La sequence d'envoi poussait les disponibilites mais pas les tarifs.
   Un logement se retrouvait donc visible chez le partenaire, avec ses
   reservations, mais son plan tarifaire vide — et un plan sans prix est
   ferme a la vente. Booking affichait « Tarif fermé » alors que tout
   semblait avoir fonctionne.

   Les tarifs ne partaient que par le moteur de tarification dynamique
   en mode auto. Un logement jamais passe par ce moteur n'avait aucun
   prix chez le partenaire, et rien dans le produit ne permettait de
   l'envoyer.

   Prerequis : routes/push-tarifs-routes.js copie dans routes/.

   Usage :
     node outils/monter-push-tarifs.js --essai
     node outils/monter-push-tarifs.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = process.cwd();
const F_JS = path.join(RACINE, 'public', 'js', 'bh-ota-connect.js');
const F_SRV = path.join(RACINE, 'server.js');
const F_ROUTE = path.join(RACINE, 'routes', 'push-tarifs-routes.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

for (const [f, quoi] of [[F_JS, 'public/js/bh-ota-connect.js'], [F_SRV, 'server.js'], [F_ROUTE, 'routes/push-tarifs-routes.js']]) {
  if (!fs.existsSync(f)) {
    console.error('\n  \u2717 ' + quoi + ' introuvable.');
    if (f === F_ROUTE) console.error('    Copiez-le d\'abord dans routes/.');
    console.error('');
    process.exit(1);
  }
}

/* ══ 1. La cinquieme etape dans la sequence ═══════════════════ */
let js = fs.readFileSync(F_JS, 'utf8');
let jsFait = false;

if (js.indexOf('push-rates') !== -1) {
  console.log('  deja fait  etape des tarifs dans la sequence');
} else {
  if (js.indexOf('window._bhEnvoyer') === -1) {
    console.error('\n  \u2717 _bhEnvoyer introuvable : appliquez d\'abord');
    console.error('    outils/envoyer-disponibilites.js\n');
    process.exit(1);
  }

  const A1 = `        'Envoi des disponibilités et des tarifs…'
      ];`;
  const N1 = `        'Envoi des disponibilités…',
        'Envoi des tarifs…'
      ];`;

  const A2 = `      n = 4; afficher(etapes[3], 'Cinq cents jours de calendrier sont envoyés.');
      var dDispo = await appel('push-availability');`;
  const N2 = `      n = 4; afficher(etapes[3], 'Cinq cents jours de calendrier sont envoyés.');
      var dDispo = await appel('push-availability');

      /* Les tarifs, sans lesquels le plan tarifaire reste vide chez le
         partenaire — donc ferme a la vente, quelles que soient les
         disponibilites envoyees. Cette route est sur /api/properties,
         pas /api/channex : appel direct. */
      n = 5; afficher(etapes[4], 'Le prix du calendrier part vers chaque plateforme.');
      var dTarifs = null;
      try {
        var rT = await fetch(API_URL + '/api/properties/' + pid + '/push-rates', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token() }
        });
        dTarifs = await rT.json().catch(function () { return {}; });
        if (!rT.ok) dTarifs = { erreur: dTarifs.error || 'Envoi des tarifs impossible' };
      } catch (eT) {
        dTarifs = { erreur: 'Envoi des tarifs impossible' };
      }`;

  const A3 = `      var echecDispo = dDispo === null;`;
  const N3 = `      var echecDispo = dDispo === null;
      var echecTarifs = !dTarifs || !!dTarifs.erreur;`;

  const A4 = `        (echecDispo
          ? 'Les réservations ont été relevées, mais l\\'envoi des disponibilités a échoué. ' +
            'Le logement restera fermé à la vente sur les plateformes tant qu\\'il n\\'aura pas abouti — ' +
            'réessayez dans quelques minutes.'
          : 'Le calendrier des 500 prochains jours est parti vers vos plateformes. ' +
            'Comptez quelques minutes avant de voir les dates s\\'ouvrir dans leur extranet.') +`;

  const N4 = `        (echecDispo
          ? 'Les réservations ont été relevées, mais l\\'envoi des disponibilités a échoué. ' +
            'Le logement restera fermé à la vente tant qu\\'il n\\'aura pas abouti — ' +
            'réessayez dans quelques minutes.'
          : echecTarifs
            ? 'Les disponibilités sont parties, mais pas les tarifs : ' + esc(dTarifs && dTarifs.erreur ? dTarifs.erreur : '') +
              ' Sans tarif, les plateformes gardent le logement fermé à la vente.'
            : 'Le calendrier et les tarifs des 500 prochains jours sont partis vers vos plateformes. ' +
              'Comptez quelques minutes avant de voir les dates s\\'ouvrir dans leur extranet.') +`;

  const edits = [
    ['libelle des etapes', A1, N1],
    ['appel d\'envoi des tarifs', A2, N2],
    ['detection d\'echec', A3, N3],
    ['message de fin', A4, N4]
  ];

  for (const [nom, ancien] of edits) {
    const n = js.split(ancien).length - 1;
    if (n !== 1) {
      console.error('\n  \u2717 ' + nom + ' : ' + n + ' occurrence(s), 1 attendue.');
      console.error('    Rien n\'a ete ecrit.\n');
      process.exit(1);
    }
  }
  for (const [, ancien, nouveau] of edits) js = js.split(ancien).join(nouveau);
  js = js.split("'Étape ' + (n) + ' sur ' + etapes.length").join("'Étape ' + n + ' sur ' + etapes.length");

  try {
    new Function(js);
  } catch (e) {
    console.error('\n  \u2717 bh-ota-connect.js serait invalide : ' + e.message);
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
  jsFait = true;
  console.log('  applique   etape des tarifs dans la sequence');
}

/* ══ 2. Le montage dans server.js ═════════════════════════════ */
let srv = fs.readFileSync(F_SRV, 'utf8');
let srvFait = false;

if (srv.indexOf('push-tarifs-routes') !== -1) {
  console.log('  deja fait  montage dans server.js');
} else {
  // Les trois noms sont LUS dans le fichier, jamais supposes.
  const sc = srv.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const mApp = sc.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(\s*\)/);
  const mPool = sc.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Pool\b/);
  const nomApp = mApp ? mApp[1] : null;
  const nomPool = mPool ? mPool[1] : (/(?:const|let|var)\s+pool\b/.test(sc) ? 'pool' : null);

  const cand = {};
  const re = /\.(?:get|post|put|patch|delete)\s*\(\s*['"`]\/api\/properties[^'"`]*['"`]\s*,\s*([A-Za-z_$][\w$.]*)\s*,/g;
  let m;
  while ((m = re.exec(sc)) !== null) {
    if (/^(upload|multer|express|bodyParser)\b/.test(m[1])) continue;
    cand[m[1]] = (cand[m[1]] || 0) + 1;
  }
  const tries = Object.entries(cand).sort((a, b) => b[1] - a[1]);
  const nomAuth = tries.length ? tries[0][0] : null;

  console.log('\n  DETECTE DANS server.js');
  console.log('    application ....... ' + (nomApp || '\u2717'));
  console.log('    pool .............. ' + (nomPool || '\u2717'));
  console.log('    middleware ........ ' + (nomAuth || '\u2717'));

  if (!nomApp || !nomPool || !nomAuth) {
    console.error('\n  \u2717 Detection incomplete. Ajoutez la ligne a la main avant app.listen() :');
    console.error('      require(\'./routes/push-tarifs-routes\')(app, pool, VOTRE_MIDDLEWARE);\n');
    process.exit(1);
  }

  const reL = new RegExp('(^|\\n)([ \\t]*)' + nomApp.replace(/\$/g, '\\$') + '\\.listen\\s*\\(', 'g');
  let dernier = null, mm;
  while ((mm = reL.exec(srv)) !== null) dernier = mm;
  if (!dernier) {
    console.error('\n  \u2717 ' + nomApp + '.listen( introuvable.\n');
    process.exit(1);
  }

  const ind = dernier[2] || '';
  const pos = dernier.index + (dernier[1] ? dernier[1].length : 0);
  srv = srv.slice(0, pos) +
    ind + '// ── Envoi des tarifs du calendrier vers les plateformes ─────\n' +
    ind + '// Sans tarif, un plan tarifaire reste vide chez le partenaire,\n' +
    ind + '// donc ferme a la vente meme si les disponibilites sont parties.\n' +
    ind + 'require(\'./routes/push-tarifs-routes\')(' + nomApp + ', ' + nomPool + ', ' + nomAuth + ');\n\n' +
    srv.slice(pos);

  try {
    new Function(srv);
  } catch (e) {
    console.error('\n  \u2717 server.js serait invalide : ' + e.message);
    console.error('    Rien n\'a ete ecrit.\n');
    process.exit(1);
  }
  srvFait = true;
  console.log('    ligne : require(\'./routes/push-tarifs-routes\')(' + nomApp + ', ' + nomPool + ', ' + nomAuth + ');');
}

if (!jsFait && !srvFait) {
  console.log('\n  Tout etait deja applique.\n');
  process.exit(0);
}

// On n'ecrit qu'apres avoir valide LES DEUX fichiers.
if (!ESSAI) {
  if (jsFait) fs.writeFileSync(F_JS, js, 'utf8');
  if (srvFait) fs.writeFileSync(F_SRV, srv, 'utf8');
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE —'));
console.log('  Syntaxe des fichiers modifies verifiee.');
console.log('\n  REDEMARREZ LE SERVEUR, puis dans les logs :');
console.log('    ✅ [PUSH-RATES] Route d\'envoi des tarifs montée');
console.log('\n  POUR DEBLOQUER SG ETAGE');
console.log('    Mes logements \u2192 SG Etage \u2192 Connecter mes plateformes');
console.log('    \u2192 « Envoyer vers les plateformes ». Cinq etapes maintenant,');
console.log('    la derniere envoie les tarifs.');
console.log('\n    Le prix envoye vient du calendrier s\'il existe, sinon de');
console.log('    base_price / weekend_price de la fiche. Verifiez que SG Etage');
console.log('    a bien un prix de base : sans lui la route refuse, et le dit.');
console.log('\n    Dans Booking, « Standard Rate » doit passer de vide a 75 €,');
console.log('    et le statut de « Tarif fermé » a « Réservable ».');
if (ESSAI) console.log('\n  Relancez sans --essai pour appliquer.');
console.log('');

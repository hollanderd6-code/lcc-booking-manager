#!/usr/bin/env node
/* ============================================================
   outils/audit-envois-agence.js
   Tous les endroits qui ENVOIENT, et le compte qu'ils lisent
   ============================================================
   Lecture seule du code local. N'exécute rien, ne modifie rien.

     node outils/audit-envois-agence.js          rapport
     node outils/audit-envois-agence.js --code   avec les lignes de code

   ── CE QUE CET AUDIT AJOUTE À outils/audit-agence.js ─────────────
   audit-agence.js examine les ROUTES — ce que voit un écran. Mais un
   message automatique ne part jamais depuis une route : il part d'un
   cron, d'un webhook Channex, d'un webhook Stripe, ou d'une relance
   après signature de fiche de police. Ces chemins n'ont ni req.user ni
   getAgencyUserIds : ils partent d'un template ou d'une conversation et
   remontent au compte tout seuls. C'est exactement là que le défaut
   « le modèle d'agence ne trouve aucune conversation » a vécu six
   semaines sans être vu.

   ── LA SIGNATURE CHERCHÉE ────────────────────────────────────────
   Une requête qui filtre des conversations, réservations, logements ou
   modèles par un identifiant de compte UNIQUE :

       WHERE c.user_id = $1          ← suspect
       WHERE user_id = $1

   contre la forme consciente de la délégation :

       WHERE c.user_id = ANY($1::text[])   ← correct
       comptesDuTemplate(...) / getAgencyUserIds(...)

   Pour chaque occurrence, l'outil dit si un élargissement agence est
   présent dans les 40 lignes autour. Il classe :

     ENVOI      le bloc contient un appel d'envoi (sendTemplateMessage,
                sendAutoMessage, sendBookingMessage, sendAutomatedMessage…)
                ET un filtrage par compte unique. À examiner en premier :
                un message qui ne part pas ne laisse aucune trace.
     LECTURE    filtrage par compte unique sans envoi dans le bloc.
     OK         élargissement agence présent.

   ── CE QU'IL NE PEUT PAS FAIRE ───────────────────────────────────
   Dire si c'est fautif. Certains filtrages sur un compte unique sont
   justes : une boucle qui itère déjà sur tous les comptes ne doit
   surtout pas être élargie, sinon le même voyageur reçoit deux fois le
   message. C'est la raison pour laquelle cron-templates-agence-v2.js
   avait volontairement laissé le bloc ~31286 de côté.

   Le rapport est une liste à relire, pas un correctif.
   ============================================================ */

'use strict';
const fs = require('fs');
const path = require('path');

const AVEC_CODE = process.argv.includes('--code');
const RACINE = process.cwd();

const ENVOIS = /sendTemplateMessage|sendAutoMessage|sendAutomatedMessage|sendBookingMessage|sendOnArrivalIdempotently|sendArrivalMessage|transmitToChannex|sendWhatsApp|sendSms/;
const ELARGI = /ANY\s*\(\s*\$\d+(::text\[\])?\s*\)|comptesDuTemplate|comptesDuModele|getAgencyUserIds|agencyIds|delegator_user_id/;
const FILTRE = /\b(?:[a-z]\.)?user_id\s*=\s*\$\d+/;
const TABLES = /\b(conversations|reservations|message_templates|properties|deposits|police_records)\b/;

function fichiers() {
  const liste = [];
  for (const f of fs.readdirSync(RACINE)) {
    if (f.endsWith('.js') && !f.startsWith('.') && f !== 'package-lock.json') liste.push(f);
  }
  for (const d of ['routes', 'services', 'server']) {
    const p = path.join(RACINE, d);
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p)) if (f.endsWith('.js')) liste.push(path.join(d, f));
  }
  return liste.filter(f => fs.statSync(path.join(RACINE, f)).isFile());
}

const envoi = [], lecture = [], corrects = [];

for (const rel of fichiers()) {
  let lignes;
  try { lignes = fs.readFileSync(path.join(RACINE, rel), 'utf8').split('\n'); }
  catch (e) { continue; }

  for (let i = 0; i < lignes.length; i++) {
    if (!FILTRE.test(lignes[i])) continue;

    const debut = Math.max(0, i - 25);
    const fin = Math.min(lignes.length, i + 20);
    const bloc = lignes.slice(debut, fin).join('\n');
    if (!TABLES.test(bloc)) continue;

    const entree = {
      fichier: rel, ligne: i + 1,
      code: lignes[i].trim().slice(0, 100),
      contexte: lignes.slice(Math.max(0, i - 2), i + 3).map((l, k) => `      ${debut + 0 + Math.max(0, i - 2) + k + 1}  ${l.trim().slice(0, 96)}`).join('\n'),
    };

    if (ELARGI.test(bloc)) corrects.push(entree);
    else if (ENVOIS.test(bloc)) envoi.push(entree);
    else lecture.push(entree);
  }
}

const bloc = (titre, liste, note) => {
  console.log(`\n${titre}  (${liste.length})`);
  console.log('\u2500'.repeat(72));
  if (note) console.log('  ' + note);
  if (!liste.length) { console.log('  (aucune) \u2713'); return; }
  let dernier = '';
  for (const e of liste) {
    if (e.fichier !== dernier) { console.log(`\n  ${e.fichier}`); dernier = e.fichier; }
    console.log(`    ligne ${String(e.ligne).padStart(6)}  ${e.code}`);
    if (AVEC_CODE) console.log(e.contexte);
  }
};

console.log('\n\u2550\u2550 AUDIT DES CHEMINS D\'ENVOI \u2014 MODE AGENCE \u2550\u2550');
console.log(`  ${fichiers().length} fichier(s) examiné(s)`);

bloc('ENVOI — filtrage par compte unique DANS un bloc qui envoie', envoi,
  'À relire en premier : un message bloqué ici ne laisse aucune trace.');
bloc('LECTURE — filtrage par compte unique, sans envoi dans le bloc', lecture,
  'Risque : liste vide ou incomplète pour un gestionnaire.');
bloc('OK — élargissement agence présent dans le bloc', corrects, null);

console.log('\n' + '\u2500'.repeat(72));
console.log('  Attention avant de corriger : certains filtrages sur un compte');
console.log('  unique sont JUSTES. Si la boucle englobante itère déjà sur tous');
console.log('  les comptes, élargir ferait partir le message deux fois au même');
console.log('  voyageur. C\'est pour cette raison que le bloc ~31286 avait été');
console.log('  volontairement écarté par cron-templates-agence-v2.js.');
console.log('');
console.log('  Relancez avec --code pour voir les lignes, et envoyez-moi la');
console.log('  sortie : je lis les cas ENVOI un par un.\n');

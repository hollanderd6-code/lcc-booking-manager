#!/usr/bin/env node
/* ============================================================
   outils/logement-vide-envoi-manuel.js
   « Bienvenue à ! » — {logement} vide a l'envoi manuel d'un template
   ============================================================
   Cible : server.js — route POST /api/message-templates/:id/send (~31055)

   ── LE SYMPTOME ─────────────────────────────────────────────────
   Un template envoye a la main depuis le chat sortait avec un trou :

       « Bienvenue à ! »
       « nous sommes heureux de vous accueillir dans notre  »

   alors que l'heure d'arrivee (15:00), l'heure de depart (11:00) et le
   lien du livret etaient corrects dans le meme message.

   ── LA CAUSE ────────────────────────────────────────────────────
   La route lit la conversation seule :

       SELECT * FROM conversations WHERE id = $1 AND user_id = ANY($2)

   puis resout la variable ainsi :

       .replace(/\{logement\}/gi, c.property_name || '')

   Or la colonne conversations.property_name N'EXISTE PAS en base :

       ERROR: 42703: column "property_name" does not exist

   `SELECT *` ne remonte donc aucun champ de ce nom, `c.property_name` vaut
   undefined, et faute de repli la variable tombe sur la chaine vide. Ce
   n'etait donc pas un cas limite lie aux comptes delegues : {logement}
   etait vide a CHAQUE envoi manuel d'un template, pour tous les logements.

   Les autres variables, elles, ne dependent pas de cette colonne : elles
   viennent de la requete propInfo juste au-dessus, qui lit la table
   properties par son id. C'est precisement pour cela qu'elles sortaient
   bien pendant que le nom restait vide — le symptome designait la seule
   variable sans source de secours.

   ── LE CORRECTIF ────────────────────────────────────────────────
   On ajoute `name` a la requete propInfo — deja presente, deja executee,
   aucun aller-retour supplementaire — et on s'en sert comme repli.

   C'est exactement le repli qu'applique deja la ligne 30451 sur le
   chemin du cron :

       .replace(/{logement}/gi, conv.property_name || property?.name || '')

   Cette route etait la seule des deux a ne pas l'avoir.

   ── CE QUE CE SCRIPT NE FAIT PAS ────────────────────────────────
   Il ne cree pas la colonne conversations.property_name et ne touche pas
   aux autres endroits qui la lisent. Il en reste au moins un :

     services/pushNotificationService.js:130
       SELECT property_name FROM conversations WHERE id = $1

   Cette requete echoue donc en permanence — le nom du logement manque
   dans les notifications push, ou l'erreur part dans un catch silencieux.
   Meme repli a appliquer la-bas, separement.

   Usage :
     node outils/logement-vide-envoi-manuel.js --essai
     node outils/logement-vide-envoi-manuel.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

function unique(src, texte, quoi) {
  const n = src.split(texte).length - 1;
  if (n === 0) echec(quoi + ' introuvable. server.js a change depuis la lecture.');
  if (n > 1) echec(quoi + ' present ' + n + ' fois — ancre ambigue, je m\'arrete.');
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('c.property_name || pi.name') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. Ajouter `name` a la requete qui charge deja le logement ───── */
const A_SELECT = `      'SELECT address, arrival_time, departure_time, access_code, wifi_name, wifi_password, practical_info, welcome_book_url FROM properties WHERE id = $1',`;
const N_SELECT = `      /* La colonne name est ajoutee ici : elle sert de repli a {logement} quand
         conversations.property_name est vide — cette colonne n'existe meme pas
         en base. La requete est deja executee, l'ajout ne coute aucun
         aller-retour. */
      'SELECT name, address, arrival_time, departure_time, access_code, wifi_name, wifi_password, practical_info, welcome_book_url FROM properties WHERE id = $1',`;

unique(src, A_SELECT, 'La requete propInfo');
src = src.split(A_SELECT).join(N_SELECT);

/* ── 2. Le repli sur {logement} ───────────────────────────────────── */
const A_REPL = `      .replace(/\\{logement\\}/gi, c.property_name || '')`;
const N_REPL = `      /* conversations.property_name n'existe pas en base : SELECT * ne remonte
         rien sous ce nom, donc c.property_name vaut undefined et le nom du
         logement disparaissait du message (« Bienvenue à ! »).
         Meme ordre de priorite que le chemin du cron (l. ~30451). */
      .replace(/\\{logement\\}/gi, c.property_name || pi.name || '')`;

unique(src, A_REPL, 'La resolution de {logement}');
src = src.split(A_REPL).join(N_REPL);

try { new Function(src); }
catch (e) { echec("Le resultat n'est pas du JavaScript valide — " + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  const relu = fs.readFileSync(CIBLE, 'utf8');
  if (relu.indexOf('c.property_name || pi.name') === -1
      || relu.indexOf("'SELECT name, address, arrival_time") === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  {logement} retombe sur properties.name — la colonne');
console.log('  conversations.property_name n\'existe pas en base.\n');
console.log('  Reste a traiter, meme colonne inexistante :');
console.log('    services/pushNotificationService.js:130\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

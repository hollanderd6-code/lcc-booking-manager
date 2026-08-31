#!/usr/bin/env node
/* ============================================================
   outils/refonte-6b-etats-justes.js
   Lot 6b : le menage lu, et un faux positif corrige
   ============================================================

   ── LE FAUX POSITIF, D'ABORD ─────────────────────────────────────
   Cinq arrivees sur sept ressortent « caution_bloquante: true ». Trois
   d'entre elles sont sur la plateforme « Boostinghost Guest ».

   Or votre propre serveur, dans shouldSkipForDepositCondition, exempte
   explicitement Airbnb ET BHGuest de la verification caution — le
   commentaire du code le dit mot pour mot. J'ai reproduit la moitie de
   la regle : j'exemptais Airbnb, pas BHGuest.

   Consequence : ma route accusait la caution de bloquer M10, M11 et M13,
   alors que le cron ne l'a jamais consideree. Si vous aviez agi sur cette
   base, vous auriez cherche une caution manquante qui n'a jamais ete
   exigee — pendant que la vraie cause restait cachee.

   Un ecran de diagnostic qui se trompe fait perdre plus de temps qu'il
   n'en fait gagner. La regle est desormais celle du serveur, pas la
   mienne.

   ── ET DONC, POURQUOI CES TROIS N'ONT RIEN RECU ? ────────────────
   Avec la caution ecartee, il reste : le modele « Arrivee M10 » /
   « Arrivee M11 » / « Arrivee M13 » existe et est actif, la conversation
   existe, la date est bonne, et message_envoye reste false. La route
   renvoie desormais aussi « send_condition » du modele concerne : c'est
   la condition qui bloque, comme le « police_complete » du modele 18 qui
   avait retenu les messages de Roxana et xiuqin ji.

   Vous verrez donc la CAUSE dans la reponse, pas seulement le symptome.

   ── LE MENAGE ────────────────────────────────────────────────────
   Table confirmee : cleaning_checklists, avec completed_at,
   checkout_date, property_id, is_validated, cleaner_certified.

   Pour une ARRIVEE du jour, le menage qui compte est celui du DEPART qui
   la precede — donc une fiche de la meme propriete dont checkout_date
   vaut aujourd'hui. La route renvoie :

       menage_fait        completed_at renseigne
       menage_valide      is_validated
       menage_attendu     un depart a bien lieu ce jour sur ce logement

   menage_attendu evite le contresens le plus courant : un logement libre
   la veille n'a pas de menage a faire, et « menage_fait: false » y serait
   une fausse alerte.

   Usage :
     node outils/refonte-6b-etats-justes.js --essai
     node outils/refonte-6b-etats-justes.js
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error("    Rien n'a ete ecrit.\n");
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable.');

let src = fs.readFileSync(CIBLE, 'utf8');
if (src.indexOf('/api/aujourdhui/etats') === -1) echec('La route est absente. Lancez d\'abord refonte-6-route-etats.js.');

if (src.indexOf('cleaning_checklists') !== -1 && src.indexOf('menage_attendu') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  const n = src.split(avant).length - 1;
  if (n !== 1) echec('\u00ab ' + quoi + ' \u00bb trouve ' + n + ' fois (attendu : 1).');
  src = src.split(avant).join(apres);
}

/* ── 1. Le menage, les departs du jour, les conditions ───────── */

remplacer(
`    // Les tables candidates pour le menage, pour l'ajouter sans deviner.
    let diagnostic = null;`,
`    // Le menage. Table confirmee : cleaning_checklists.
    // Pour une arrivee du jour, le menage qui compte est celui du DEPART
    // qui la precede : meme propriete, checkout_date = aujourd'hui.
    const menages = {};
    try {
      const men = await pool.query(
        \`SELECT property_id, completed_at, is_validated, cleaner_certified
         FROM cleaning_checklists
         WHERE user_id = ANY($1::text[]) AND checkout_date = $2::date\`,
        [ids, jour]
      );
      men.rows.forEach(r => {
        const p = menages[r.property_id];
        // Si plusieurs fiches, la plus avancee gagne : une fiche terminee
        // ne doit pas etre effacee par un brouillon cree apres.
        if (!p || (!p.completed_at && r.completed_at)) menages[r.property_id] = r;
      });
    } catch (e) {
      // Table absente : menage_fait restera null, jamais false.
    }

    // Un menage n'est attendu que si un depart a lieu ce jour-la sur ce
    // logement. Sans cela « menage_fait: false » serait une fausse alerte
    // sur un logement qui etait vide la veille.
    const departsDuJour = new Set();
    try {
      const dep = await pool.query(
        \`SELECT DISTINCT property_id FROM conversations
         WHERE user_id = ANY($1::text[]) AND status <> 'cancelled'
           AND DATE(reservation_end_date AT TIME ZONE 'Europe/Paris') = $2\`,
        [ids, jour]
      );
      dep.rows.forEach(r => departsDuJour.add(r.property_id));
    } catch (e) {
      // On laissera menage_attendu a null.
    }

    // La condition du modele d'arrivee : c'est elle qui retient les
    // messages, comme « police_complete » l'a fait pour Roxana.
    const conditions = {};
    try {
      const tpl = await pool.query(
        \`SELECT id, title, send_condition, property_id, property_ids
         FROM message_templates
         WHERE user_id = ANY($1::text[]) AND trigger_type = 'on_arrival' AND active = TRUE\`,
        [ids]
      );
      tpl.rows.forEach(t => {
        let liste = [];
        if (Array.isArray(t.property_ids)) liste = t.property_ids;
        else if (t.property_ids) { try { liste = JSON.parse(t.property_ids); } catch (e) { liste = []; } }
        if (!liste.length && t.property_id) liste = [t.property_id];
        liste.forEach(pid => {
          if (!conditions[pid]) conditions[pid] = { titre: t.title, condition: t.send_condition || 'always' };
        });
      });
    } catch (e) {
      // Pas de condition renvoyee, plutot qu'une condition inventee.
    }

    // Les tables candidates pour le menage, pour l'ajouter sans deviner.
    let diagnostic = null;`,
  'le bloc du diagnostic'
);

/* ── 2. BHGuest exempte, comme le fait le serveur ────────────── */

remplacer(
`      const plateforme = String(r.platform || '').toLowerCase();
      const estAirbnb = plateforme.includes('airbnb') || plateforme === 'abb';
      const cautionExigee = Number(r.deposit_amount || 0) > 0 && !estAirbnb;`,
`      const plateforme = String(r.platform || '').toLowerCase();
      const estAirbnb = plateforme.includes('airbnb') || plateforme === 'abb';
      // shouldSkipForDepositCondition exempte Airbnb ET BHGuest de la
      // verification caution. Reproduire la moitie de la regle faisait
      // accuser la caution de bloquer M10, M11 et M13 a tort.
      const estBhGuest = plateforme.includes('boostinghost') || plateforme.includes('bhguest');
      const cautionExigee = Number(r.deposit_amount || 0) > 0 && !estAirbnb && !estBhGuest;`,
  'le calcul de la caution'
);

/* ── 3. La sortie s'enrichit ─────────────────────────────────── */

remplacer(
`        caution_bloquante: cautionExigee && !cautionOk,
        menage_fait: null
      };`,
`        caution_bloquante: cautionExigee && !cautionOk,
        plateforme_exemptee_de_caution: estAirbnb || estBhGuest,
        menage_attendu: departsDuJour.size ? departsDuJour.has(r.property_id) : null,
        menage_fait: menages[r.property_id] ? !!menages[r.property_id].completed_at : null,
        menage_valide: menages[r.property_id] ? !!menages[r.property_id].is_validated : null,
        // Quand message_envoye est false, c'est presque toujours ici que
        // se trouve la reponse.
        modele_arrivee: conditions[r.property_id] ? conditions[r.property_id].titre : null,
        condition_envoi: conditions[r.property_id] ? conditions[r.property_id].condition : null
      };`,
  'la sortie par arrivee'
);

remplacer(
`      menage_fait_indisponible: 'table de menage non confirmee — appelez ?diagnostic=1',
      diagnostic`,
`      diagnostic`,
  'la note du menage'
);

/* ── Verifications ───────────────────────────────────────────── */

[
  ['la lecture du menage', 'FROM cleaning_checklists'],
  ['la fiche la plus avancee', 'if (!p || (!p.completed_at && r.completed_at))'],
  ['les departs du jour', 'const departsDuJour = new Set();'],
  ['menage attendu', 'menage_attendu: departsDuJour.size'],
  ['l\'exemption BHGuest', 'const estBhGuest = plateforme.includes'],
  ['la condition du modele', "trigger_type = 'on_arrival' AND active = TRUE"],
  ['la condition renvoyee', 'condition_envoi:'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});

/* Toujours en lecture seule. */
const zone = src.slice(src.indexOf("app.get('/api/aujourdhui/etats'"), src.indexOf('async function runTemplatesCron'));
['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE'].forEach(function (mot) {
  if (zone.toUpperCase().indexOf(mot) !== -1) echec('La route contiendrait « ' + mot.trim() + ' ». Refus.');
});

try {
  new Function(src);
} catch (e) {
  echec('server.js ne serait plus du JavaScript valide — ' + e.message);
}

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('menage_attendu') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  1. BHGuest exempte de caution, comme le fait votre serveur');
console.log('     -> M10, M11, M13 ne seront plus accuses a tort');
console.log('  2. menage_fait / menage_valide lus dans cleaning_checklists');
console.log('  3. menage_attendu : false si aucun depart ce jour-la');
console.log('  4. modele_arrivee + condition_envoi : la CAUSE, pas le symptome');
console.log('\n  Toujours en lecture seule : le script refuse si un INSERT,');
console.log('  UPDATE, DELETE, ALTER ou DROP apparait dans la route.');
console.log('\n  Apres deploiement :');
console.log('');
console.log("  fetch('/api/aujourdhui/etats',{headers:{Authorization:'Bearer '+localStorage.getItem('lcc_token')}}).then(r=>r.json()).then(d=>console.table(d.arrivees))");
console.log('');
console.log('  Ce qui m\'interesse : les trois lignes a message_envoye false.');
console.log('  Leur « condition_envoi » devrait nommer ce qui les retient.');
console.log('  Si elle vaut « always » et que le message n\'est pas parti,');
console.log('  le probleme est ailleurs et je le cherche avec vous.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

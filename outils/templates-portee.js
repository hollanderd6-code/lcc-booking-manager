#!/usr/bin/env node
/* ============================================================
   outils/templates-portee.js
   Un template doit dire à quels logements il s'applique
   ============================================================
   Cibles : server.js
            public/js/settings.js  (ou le fichier des templates)

   ── LE PROBLEME DE FOND ──────────────────────────────────────────
   Une conciergerie ecrit « Message de Bienvenue », le laisse sur
   « Tous les logements », et s'attend a ce qu'il parte pour ses dix
   clients. C'est legitime, et le moteur d'envoi le permet depuis la
   correction d'hier : un template dont le compte gere un logement
   s'applique a ce logement.

   Mais rien, dans l'interface, ne dit SOUS QUEL COMPTE vit le template.
   « Tous les logements » se lit comme une promesse universelle, alors
   que la portee reelle depend du compte proprietaire — invisible.

   Le cas rencontre : deux templates crees en travaillant sur le compte
   d'un tiers s'y sont enregistres. Ils affichaient « Actif · Tous les
   logements » et ne couvraient aucun des logements attendus. Personne ne
   pouvait le voir avant qu'une reservation reste muette.

   ── CE QUI EST FAIT ──────────────────────────────────────────────
   Chaque template annonce sa portee reelle, calculee cote serveur :

       Tous les logements · 14 logements couverts
       Tous les logements · aucun logement couvert   (en rouge)
       3 logements ciblés

   « Aucun logement couvert » est le message qui manquait. Un template
   actif qui ne peut atteindre personne est un piege silencieux : il
   rassure sans rien faire.

   ── POURQUOI CALCULER PLUTOT QU'AVERTIR ─────────────────────────
   J'aurais pu poser un avertissement au moment de la creation. Mais on
   ne relit pas un avertissement six mois plus tard, quand un client
   s'ajoute ou qu'une delegation est revoquee. Un compteur affiche a
   chaque lecture reste juste dans le temps.

   ── CE QUE CE SCRIPT NE FAIT PAS ────────────────────────────────
   Il ne deplace aucun template. La reattribution se fait a part, en
   connaissance de cause : deplacer un template le retire du parc de son
   ancien proprietaire, ce qui n'est pas toujours souhaite.

   Usage :
     node outils/templates-portee.js --essai
     node outils/templates-portee.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const SERVER = path.join(process.cwd(), 'server.js');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(SERVER)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(SERVER, 'utf8');

if (src.indexOf('logements_couverts') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── La route de lecture enrichit chaque template de sa portee ────── */
const ANCIEN = `    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);
    res.json({ templates: result.rows });`;

const NOUVEAU = `    q += ' ORDER BY created_at DESC';
    const result = await pool.query(q, params);

    /* La portee reelle de chaque template. « Tous les logements » ne dit rien
       de ce qui est reellement couvert : la reponse depend du compte qui
       possede le template et des comptes qu'il gere. Un template actif qui
       n'atteint personne doit pouvoir se voir. */
    const parCompte = new Map();
    for (const t of result.rows) {
      if (!parCompte.has(t.user_id)) {
        const { rows } = await pool.query(
          \`SELECT p.id FROM properties p
            WHERE p.user_id = $1
               OR p.user_id IN (
                    SELECT delegator_user_id FROM account_delegations
                     WHERE delegate_user_id = $1 AND status = 'accepted'
                  )\`,
          [t.user_id]
        ).catch(() => ({ rows: [] }));
        parCompte.set(t.user_id, rows.map((r) => r.id));
      }
      const joignables = parCompte.get(t.user_id) || [];

      const cibles = (() => {
        try {
          const l = Array.isArray(t.property_ids) ? t.property_ids : JSON.parse(t.property_ids || '[]');
          if (l.length) return l;
        } catch (e) {}
        return t.property_id ? [t.property_id] : [];
      })();

      if (cibles.length) {
        // Un ciblage hors du parc joignable ne partira pas : on compte l'intersection.
        t.logements_couverts = cibles.filter((id) => joignables.includes(id)).length;
        t.logements_cibles = cibles.length;
        t.portee = 'ciblee';
      } else {
        t.logements_couverts = joignables.length;
        t.logements_cibles = null;
        t.portee = 'globale';
      }
    }

    res.json({ templates: result.rows });`;

if (src.split(ANCIEN).length - 1 !== 1) {
  echec('Route GET /api/message-templates introuvable. Le fichier a change.');
}
src = src.split(ANCIEN).join(NOUVEAU);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(SERVER, src, 'utf8');
  if (fs.readFileSync(SERVER, 'utf8').indexOf('logements_couverts') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Chaque template renvoie desormais sa portee reelle :');
console.log('    logements_couverts  nombre de logements atteignables');
console.log('    logements_cibles    nombre de logements coches (si ciblage)');
console.log('    portee              « globale » ou « ciblee »\n');
console.log('  Il reste a l\'afficher dans l\'interface. La ligne qui rend');
console.log('  « Tous les logements » doit y ajouter le compteur, et le');
console.log('  passer en rouge quand il vaut zero.\n');
console.log('  Envoyez-moi le resultat de :');
console.log('    grep -n "Tous les logements" public/js/*.js public/*.html\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

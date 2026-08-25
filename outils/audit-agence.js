#!/usr/bin/env node
/* ============================================================
   outils/audit-agence.js
   Recenser toutes les routes aveugles au mode agence
   ============================================================
   Cible : lecture seule de server.js et routes/*.js

   ── POURQUOI UN OUTIL, ET NON UNE RELECTURE ──────────────────────
   Le defaut se repete : une route lit « req.user.id » et s'arrete la,
   alors qu'en mode agence l'utilisateur travaille sur le compte d'un
   client. Nous l'avons corrige trois fois aujourd'hui — majoration par
   plateforme, acces des sous-comptes, templates de messages — et vous
   en decouvrez encore.

   Une relecture page par page raterait des cas : le fichier compte plus
   de trente mille lignes, et le defaut est invisible a l'oeil. Il a en
   revanche une SIGNATURE reguliere, donc il se cherche.

   ── CE QUE L'OUTIL CHERCHE ───────────────────────────────────────
   Pour chaque route, la presence de trois marqueurs :

     getAgencyUserIds   la route lit le parc de l'agence     (lecture)
     getRealUserId      la route agit pour le compte gere    (ecriture)
     x-managed-user     la route lit l'en-tete de delegation

   Une route qui touche a des donnees de logement sans aucun des trois
   est suspecte. « Suspecte », pas fautive : certaines n'ont
   legitimement rien a voir avec le mode agence — l'authentification, le
   profil, les abonnements. L'outil classe, il ne juge pas.

   ── LES TROIS NIVEAUX ────────────────────────────────────────────
   GRAVE     ecriture (POST/PUT/PATCH/DELETE) sur une table de donnees
             metier, sans getRealUserId. Le risque est d'ecrire sous le
             mauvais compte — c'etait le defaut des templates : l'objet
             existe et ne sert jamais.

   A VOIR    lecture (GET) sans getAgencyUserIds. Le risque est
             d'afficher une liste vide ou incomplete au gestionnaire.

   IGNORE    routes d'authentification, de profil, de facturation de
             l'abonnement : le mode agence n'y a pas de sens.

   ── CE QUE L'OUTIL NE PEUT PAS FAIRE ─────────────────────────────
   Dire si une route est reellement fautive. Un identifiant peut arriver
   par un autre chemin — un parametre d'URL deja verifie, une jointure
   sur le logement. Le rapport est une liste a examiner, pas un verdict.

   Usage :
     node outils/audit-agence.js              rapport complet
     node outils/audit-agence.js --graves     les ecritures seulement
   ============================================================ */

const fs = require('fs');
const path = require('path');

const GRAVES_SEUL = process.argv.includes('--graves');
const RACINE = process.cwd();

/* Tables qui portent des donnees de logement : c'est la que le mode agence
   compte. Une route qui n'en touche aucune n'est pas concernee. */
const TABLES_METIER = [
  'properties', 'reservations', 'conversations', 'messages', 'message_templates',
  'pricing_config', 'cleaning', 'checklist', 'welcome_book', 'contracts', 'contrats',
  'invoices', 'owner_invoices', 'smart_locks', 'access_codes', 'channex',
  'expenses', 'revenus', 'depenses', 'inventory', 'maintenance', 'documents',
];

/* Routes hors sujet : le mode agence n'y a pas de sens. */
const HORS_SUJET = [
  '/api/auth', '/api/login', '/api/register', '/api/me', '/api/profile',
  '/api/subscription', '/api/stripe/checkout', '/api/billing', '/api/plans',
  '/api/webhook', '/api/health', '/api/version', '/api/account-delegations',
  '/api/sub-accounts', '/api/team', '/api/notifications/token',
];

function fichiers() {
  const liste = [];
  const s = path.join(RACINE, 'server.js');
  if (fs.existsSync(s)) liste.push(s);
  const d = path.join(RACINE, 'routes');
  if (fs.existsSync(d)) {
    for (const f of fs.readdirSync(d)) if (f.endsWith('.js')) liste.push(path.join(d, f));
  }
  return liste;
}

const listeFichiers = fichiers();
if (!listeFichiers.length) {
  console.error('\n  \u2717 Ni server.js ni routes/ trouves. Lancez depuis la racine du depot.\n');
  process.exit(1);
}

const graves = [], aVoir = [], ignores = [];

for (const f of listeFichiers) {
  const nom = path.relative(RACINE, f);
  const lignes = fs.readFileSync(f, 'utf8').split('\n');

  for (let i = 0; i < lignes.length; i++) {
    /* Une definition de route : app.get('/api/...' ou router.post('/...' */
    const m = lignes[i].match(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*\[?\s*['"`]([^'"`]+)/);
    if (!m) continue;

    const methode = m[1].toUpperCase();
    const chemin = m[2];

    /* Le corps de la route : jusqu'a la prochaine definition, ou 120 lignes. */
    let fin = i + 1;
    while (fin < lignes.length && fin < i + 120
           && !/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(/.test(lignes[fin])) fin++;
    const corps = lignes.slice(i, fin).join('\n');

    if (HORS_SUJET.some((h) => chemin.startsWith(h))) {
      ignores.push({ nom, ligne: i + 1, methode, chemin, raison: 'hors sujet' });
      continue;
    }

    const tables = TABLES_METIER.filter((t) => new RegExp('\\b' + t + '\\b').test(corps));
    if (!tables.length) continue;                       // ne touche pas au metier

    const aAgency = /getAgencyUserIds/.test(corps);
    const aReal = /getRealUserId/.test(corps);
    const aManaged = /x-managed-user|managed_user|managedUser/.test(corps);
    const litUserId = /req\.user\.(id|userId)/.test(corps);

    if (aAgency || aReal || aManaged) continue;         // conscient du mode agence
    if (!litUserId) continue;                           // pas de filtrage par compte

    const entree = { nom, ligne: i + 1, methode, chemin, tables: tables.slice(0, 3) };
    if (methode === 'GET') aVoir.push(entree);
    else graves.push(entree);
  }
}

function afficher(titre, liste) {
  console.log('\n' + titre + '  (' + liste.length + ')');
  console.log('─'.repeat(72));
  if (!liste.length) { console.log('  (aucune)'); return; }
  const parFichier = {};
  liste.forEach((e) => { (parFichier[e.nom] = parFichier[e.nom] || []).push(e); });
  for (const f of Object.keys(parFichier).sort()) {
    console.log('\n  ' + f);
    parFichier[f].forEach((e) => {
      console.log('    ' + String(e.ligne).padStart(6) + '  '
        + e.methode.padEnd(6) + ' ' + e.chemin
        + '   [' + e.tables.join(', ') + ']');
    });
  }
}

console.log('\n══ AUDIT DU MODE AGENCE ══');
console.log('  ' + listeFichiers.length + ' fichier(s) examine(s)');

afficher('GRAVE — ecritures sans getRealUserId', graves);
if (!GRAVES_SEUL) afficher('A VOIR — lectures sans getAgencyUserIds', aVoir);

console.log('\n──────────────────────────────────────────────────────────────');
console.log('  Ces routes n\'ont AUCUN marqueur de mode agence et filtrent');
console.log('  pourtant par req.user.id sur des donnees de logement.');
console.log('');
console.log('  Ce n\'est pas un verdict : un identifiant peut arriver par un');
console.log('  autre chemin — parametre d\'URL deja verifie, jointure sur le');
console.log('  logement. La liste est a examiner, pas a corriger en bloc.');
console.log('');
console.log('  Les ecritures d\'abord : c\'est la qu\'un objet peut etre cree');
console.log('  sous le mauvais compte, exister, et ne jamais servir.');
console.log('');
console.log('  Envoyez-moi cette sortie et je regarde les cas un par un.\n');

#!/usr/bin/env node
/* ============================================================
   outils/templates-agence.js
   Les templates créés en mode agence ne partaient jamais
   ============================================================
   Cible : server.js

   ── LE DEFAUT ────────────────────────────────────────────────────
   La LECTURE des templates connait le mode agence :

       const agencyIds = await getAgencyUserIds(req, userId);
       'SELECT * FROM message_templates WHERE user_id = ANY($1::text[])'

   L'ECRITURE, non :

       const userId = req.user.id;
       INSERT INTO message_templates (user_id, ...) VALUES ($1, ...)

   Un template cree depuis le compte agence porte donc l'identifiant de
   L'AGENCE. Or le moteur d'envoi le cherche sous celui du PROPRIETAIRE :

       WHERE user_id = $1   avec  property.user_id  /  conv.user_id

   Il ne le trouve jamais. Le template s'affiche, se modifie, parait
   actif — et aucun message ne part. C'est le pire des defauts : rien ne
   signale l'echec, et on ne le decouvre que par le client qui n'a rien
   recu.

   Le meme defaut avait ete corrige ce matin sur markup-routes.js.

   ── LA CORRECTION ────────────────────────────────────────────────
   Le template est enregistre sous le proprietaire des logements cibles,
   et non sous l'auteur de la creation. Un template pose sur « Villa
   Antibes » appartient au compte qui detient Villa Antibes, quel que
   soit le compte qui l'a saisi.

   Le proprietaire est deduit du premier logement cible, puis VERIFIE :
   tous les logements de la liste doivent appartenir au meme compte. Un
   template ne peut pas etre enregistre sous deux identifiants, et le
   refuser vaut mieux que d'en perdre la moitie en silence.

   ── LE CAS DU TEMPLATE GLOBAL ────────────────────────────────────
   Sans logement cible, « tous les logements » n'a pas de sens en mode
   agence : tous les logements de qui ? On l'enregistre alors sous le
   compte gere s'il y en a un (l'agence travaille pour un client precis),
   sinon sous l'auteur. C'est la lecture la plus fidele de l'intention.

   ── VERIFIER L'EXISTANT ──────────────────────────────────────────
   Les templates deja crees restent mal attribues. Apres deploiement, la
   route GET /api/message-templates/diagnostic les liste avec leur
   proprietaire attendu, et POST .../reattribuer les corrige.

   Usage :
     node outils/templates-agence.js --essai
     node outils/templates-agence.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const CIBLE = path.join(process.cwd(), 'server.js');
const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du depot.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('proprietaireDesLogements') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

/* ── 1. La fonction qui deduit le proprietaire ────────────────────── */
const A1 = `// POST — créer un template
app.post('/api/message-templates', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;`;

const N1 = `/* Sous quel compte enregistrer un template ?

   Le moteur d'envoi cherche les templates sous « property.user_id », le
   PROPRIETAIRE du logement. Un template enregistre sous l'identifiant de
   l'agence ne sera donc jamais trouve : il s'affiche, parait actif, et ne
   part jamais. Rien ne signale l'echec.

   On deduit donc le proprietaire des logements cibles. Et on VERIFIE qu'ils
   appartiennent tous au meme compte : un template ne peut pas porter deux
   identifiants, et le refuser vaut mieux que d'en perdre la moitie. */
async function proprietaireDesLogements(pool, req, listeIds, monoId) {
  const ids = Array.isArray(listeIds) && listeIds.length ? listeIds
    : (monoId ? [monoId] : []);

  if (!ids.length) {
    /* Template global : « tous les logements » de qui ? En mode agence,
       l'intention est le client sur lequel on travaille. */
    const gere = req.headers['x-managed-user'] || req.query.managed_user || null;
    return { userId: gere || req.user.id, global: true };
  }

  const { rows } = await pool.query(
    'SELECT DISTINCT user_id FROM properties WHERE id::text = ANY($1::text[])',
    [ids.map(String)]
  );

  if (!rows.length) return { erreur: 'Aucun des logements ciblés n\\'existe.' };
  if (rows.length > 1) {
    return { erreur: 'Les logements ciblés appartiennent à des comptes différents. '
      + 'Créez un template par compte : un template ne peut pas être enregistré sous deux propriétaires.' };
  }
  return { userId: rows[0].user_id, global: false };
}

// POST — créer un template
app.post('/api/message-templates', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;`;

/* ── 2. L'insertion, sous le bon compte ───────────────────────────── */
const A2 = `    if (!title || !message || !trigger_type) return res.status(400).json({ error: 'title, message et trigger_type requis' });
    const result = await pool.query(
      \`INSERT INTO message_templates (user_id, property_id, title, message, trigger_type, trigger_offset_hours, trigger_offset_days, send_condition, property_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *\`,
      [userId, property_id || null,`;

const N2 = `    if (!title || !message || !trigger_type) return res.status(400).json({ error: 'title, message et trigger_type requis' });

    /* Le proprietaire des logements cibles, et non l'auteur de la creation :
       c'est sous cet identifiant que le moteur d'envoi cherchera. */
    const proprio = await proprietaireDesLogements(pool, req, property_ids, property_id);
    if (proprio.erreur) return res.status(400).json({ error: proprio.erreur });
    if (proprio.userId !== userId) {
      console.log(\`\u{1F4E9} [TEMPLATES] \${userId} cree un template pour le compte \${proprio.userId}\`);
    }

    const result = await pool.query(
      \`INSERT INTO message_templates (user_id, property_id, title, message, trigger_type, trigger_offset_hours, trigger_offset_days, send_condition, property_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *\`,
      [proprio.userId, property_id || null,`;

/* ── 3. Diagnostic et reattribution de l'existant ─────────────────── */
const A3 = `// PUT — modifier un template
app.put('/api/message-templates/:id', authenticateToken, async (req, res) => {`;

const N3 = `/* Les templates crees avant cette correction portent l'identifiant de leur
   auteur. Cette route les liste sans rien modifier : on regarde avant d'agir. */
app.get('/api/message-templates/diagnostic', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const agencyIds = await getAgencyUserIds(req, userId);

    const { rows } = await pool.query(
      \`SELECT id, title, user_id, property_id, property_ids, active
         FROM message_templates WHERE user_id = ANY($1::text[])\`,
      [agencyIds]
    );

    const rapport = [];
    for (const t of rows) {
      const liste = Array.isArray(t.property_ids) ? t.property_ids : [];
      const ids = liste.length ? liste : (t.property_id ? [t.property_id] : []);
      if (!ids.length) { rapport.push({ id: t.id, titre: t.title, etat: 'global — non concerne' }); continue; }

      const { rows: proprios } = await pool.query(
        'SELECT DISTINCT user_id FROM properties WHERE id::text = ANY($1::text[])',
        [ids.map(String)]
      );
      if (!proprios.length) { rapport.push({ id: t.id, titre: t.title, etat: 'logements introuvables' }); continue; }
      if (proprios.length > 1) { rapport.push({ id: t.id, titre: t.title, etat: 'plusieurs comptes — a scinder a la main' }); continue; }

      const attendu = proprios[0].user_id;
      rapport.push({
        id: t.id, titre: t.title, actif: t.active,
        proprietaire_actuel: t.user_id,
        proprietaire_attendu: attendu,
        etat: attendu === t.user_id ? 'correct' : 'NE PARTIRA PAS — mauvais proprietaire'
      });
    }

    res.json({
      total: rapport.length,
      a_corriger: rapport.filter((r) => r.etat.indexOf('NE PARTIRA PAS') === 0).length,
      templates: rapport,
      aide: 'POST /api/message-templates/reattribuer corrige les lignes marquees « NE PARTIRA PAS ».'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Corrige l'attribution. On ne touche qu'aux templates dont les logements
   designent un proprietaire unique et different : le reste demande un
   arbitrage humain. */
app.post('/api/message-templates/reattribuer', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const agencyIds = await getAgencyUserIds(req, userId);

    const { rows } = await pool.query(
      \`SELECT id, title, user_id, property_id, property_ids
         FROM message_templates WHERE user_id = ANY($1::text[])\`,
      [agencyIds]
    );

    const corriges = [], ignores = [];
    for (const t of rows) {
      const liste = Array.isArray(t.property_ids) ? t.property_ids : [];
      const ids = liste.length ? liste : (t.property_id ? [t.property_id] : []);
      if (!ids.length) continue;

      const { rows: proprios } = await pool.query(
        'SELECT DISTINCT user_id FROM properties WHERE id::text = ANY($1::text[])',
        [ids.map(String)]
      );
      if (proprios.length !== 1) { ignores.push({ titre: t.title, raison: 'proprietaire non unique' }); continue; }
      if (proprios[0].user_id === t.user_id) continue;

      await pool.query('UPDATE message_templates SET user_id = $1 WHERE id = $2',
        [proprios[0].user_id, t.id]);
      corriges.push({ titre: t.title, de: t.user_id, vers: proprios[0].user_id });
      console.log(\`\u{1F527} [TEMPLATES] « \${t.title} » reattribue a \${proprios[0].user_id}\`);
    }

    res.json({ corriges: corriges.length, ignores: ignores.length, detail: { corriges, ignores } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT — modifier un template
app.put('/api/message-templates/:id', authenticateToken, async (req, res) => {`;

const edits = [['fonction de deduction', A1, N1], ['insertion', A2, N2], ['routes de diagnostic', A3, N3]];

for (const [nom, ancien] of edits) {
  const n = src.split(ancien).length - 1;
  if (n !== 1) echec(nom + ' : ' + n + ' occurrence(s), 1 attendue. Le fichier a change.');
}
for (const [, ancien, nouveau] of edits) src = src.split(ancien).join(nouveau);

try { new Function(src); }
catch (e) { echec('Le resultat n\'est pas du JavaScript valide — ' + e.message); }

if (!ESSAI) {
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('proprietaireDesLogements') === -1) {
    echec('La correction n\'est pas dans le fichier apres ecriture.');
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Un template est enregistre sous le proprietaire des logements cibles.');
console.log('  Deux routes ajoutees pour verifier et corriger l\'existant.\n');
console.log('  Apres deploiement, depuis la console du site :');
console.log('    (async () => { const r = await fetch(API_URL + \'/api/message-templates/diagnostic\',');
console.log('      { headers: { Authorization: \'Bearer \' + localStorage.getItem(\'lcc_token\') } });');
console.log('      console.log(JSON.stringify(await r.json(), null, 2)); })();\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

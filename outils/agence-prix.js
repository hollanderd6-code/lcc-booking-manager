#!/usr/bin/env node
/* ============================================================
   outils/agence-prix.js
   Les réglages de prix, posés sur le bon compte
   ============================================================
   Cibles : routes/pricing-calendars.js
            routes/push-tarifs-routes.js
            routes/dynamic-pricing-routes.js

   ── LE DEFAUT, ET SES DEUX VISAGES ───────────────────────────────
   Partout, « req.user.id » sert de user_id. En mode agence, c'est
   l'AGENCE — pas le proprietaire du logement.

   Selon le sens de la requete, l'effet differe :

     ECRITURE (upsert de /config) : la ligne est creee sous le compte de
     l'agence. Le cron hebdomadaire lit sous le compte du proprietaire :
     le reglage existe et ne sert jamais.

     MISE A JOUR (zone, mode) : aucune ligne ne correspond. La route
     repond « ok » sans avoir rien modifie — la zone scolaire disparait
     au rechargement, apres que l'interface a confirme. C'est le plus
     trompeur des deux.

     LECTURE (schedule, calendars) : liste vide. « Activez d'abord le
     pricing dynamique » sur un logement ou il est actif.

   ── LA CORRECTION ────────────────────────────────────────────────
   Un resolveur unique, injecte dans chaque module :

       compteDuLogement(pool, req, propertyId)

   Il lit le proprietaire EN BASE, a partir du logement. C'est plus sur
   que l'en-tete de delegation, qu'une requete peut omettre : le logement
   sait a qui il est.

   Et il VERIFIE l'acces — le logement doit etre a l'utilisateur ou a un
   compte qu'il gere, via account_delegations. Sans ce controle, resoudre
   l'identifiant depuis le logement ouvrirait l'ecriture sur n'importe
   quel logement de la plateforme : la correction serait pire que le
   defaut.

   ── CE QUI N'EST PAS TOUCHE ──────────────────────────────────────
   /api/dynamic-pricing/decision et /recompute : ils lisent une config
   par son identifiant propre, puis agissent. Leur cas demande une
   lecture plus large que ces trois extraits — je les traiterai a part.

   Usage :
     node outils/agence-prix.js --essai
     node outils/agence-prix.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ESSAI = process.argv.includes('--essai') || process.argv.includes('--dry');
const R = (f) => path.join(process.cwd(), 'routes', f);

function echec(msg) {
  console.error('\n  \u2717 ' + msg);
  console.error('    Rien n\'a ete ecrit.\n');
  process.exit(1);
}

const AIDE = `
/* Sous quel compte agir ? En mode agence, req.user.id est l'AGENCE : une
   ecriture posee sous cet identifiant n'est jamais relue par le cron, et une
   mise a jour ne trouve aucune ligne — elle repond « ok » sans rien modifier.

   On lit donc le proprietaire EN BASE, depuis le logement : plus sur qu'un
   en-tete de delegation, qu'une requete peut omettre.

   L'acces est verifie au passage. Sans ce controle, resoudre l'identifiant
   depuis le logement ouvrirait l'ecriture sur n'importe quel logement de la
   plateforme : la correction serait pire que le defaut. */
async function compteDuLogement(pool, req, propertyId) {
  const moi = req.user && (req.user.id || req.user.userId);
  if (!propertyId) return { userId: moi };

  const { rows } = await pool.query('SELECT user_id FROM properties WHERE id = $1', [propertyId]);
  if (!rows.length) return { erreur: 'Logement introuvable', code: 404 };
  const proprio = rows[0].user_id;
  if (proprio === moi) return { userId: proprio };

  const { rows: d } = await pool.query(
    \`SELECT 1 FROM account_delegations
       WHERE delegate_user_id = $1 AND delegator_user_id = $2 AND status = 'accepted'\`,
    [moi, proprio]
  );
  if (!d.length) return { erreur: 'Ce logement ne fait pas partie des comptes que vous gérez', code: 403 };
  return { userId: proprio };
}
`;

/* ════════ Les remplacements, module par module ════════ */
const LOTS = [
  [R('pricing-calendars.js'), [
    ['zone (mise a jour)',
`      const { propertyId, zone } = req.body || {};
      if (!propertyId || !VALID_ZONES.includes(zone)) {
        return res.status(400).json({ error: 'propertyId + zone (A|B|C) requis' });
      }
      await pool.query(
        \`UPDATE pricing_config SET school_zone=$1, updated_at=NOW()
          WHERE user_id=$2 AND property_id=$3\`,
        [zone, req.user.id, propertyId]
      );`,
`      const { propertyId, zone } = req.body || {};
      if (!propertyId || !VALID_ZONES.includes(zone)) {
        return res.status(400).json({ error: 'propertyId + zone (A|B|C) requis' });
      }
      const _c = await compteDuLogement(pool, req, propertyId);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const r = await pool.query(
        \`UPDATE pricing_config SET school_zone=$1, updated_at=NOW()
          WHERE user_id=$2 AND property_id=$3\`,
        [zone, _c.userId, propertyId]
      );
      /* Un « ok » sans ligne modifiee est un mensonge : c'est ainsi que la
         zone choisie disparaissait au rechargement. */
      if (r.rowCount === 0) {
        return res.status(404).json({ error: 'Activez d\\'abord le pricing dynamique sur ce logement.' });
      }`],

    ['calendars (lecture)',
`      const cfg = (await pool.query(
        'SELECT school_zone FROM pricing_config WHERE user_id=$1 AND property_id=$2',
        [req.user.id, req.params.propertyId]
      )).rows[0] || {};
      const cal = await getCalendarsForProperty(pool, {
        userId: req.user.id, propertyId: req.params.propertyId, zone: cfg.school_zone || 'C',
      });`,
`      const _c = await compteDuLogement(pool, req, req.params.propertyId);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const cfg = (await pool.query(
        'SELECT school_zone FROM pricing_config WHERE user_id=$1 AND property_id=$2',
        [_c.userId, req.params.propertyId]
      )).rows[0] || {};
      const cal = await getCalendarsForProperty(pool, {
        userId: _c.userId, propertyId: req.params.propertyId, zone: cfg.school_zone || 'C',
      });`],

    ['schedule (lecture)',
`      const rows = (await pool.query(
        \`SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, price, min_stay, reason, breakdown, status
           FROM pricing_schedule
          WHERE user_id = $1 AND property_id = $2 AND date >= CURRENT_DATE
          ORDER BY date LIMIT $3\`,
        [req.user.id, req.params.propertyId, days]
      )).rows;
      const cfg = (await pool.query(
        \`SELECT mode, is_active FROM pricing_config WHERE user_id = $1 AND property_id = $2\`,
        [req.user.id, req.params.propertyId]
      )).rows[0] || {};`,
`      const _c = await compteDuLogement(pool, req, req.params.propertyId);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const rows = (await pool.query(
        \`SELECT TO_CHAR(date,'YYYY-MM-DD') AS date, price, min_stay, reason, breakdown, status
           FROM pricing_schedule
          WHERE user_id = $1 AND property_id = $2 AND date >= CURRENT_DATE
          ORDER BY date LIMIT $3\`,
        [_c.userId, req.params.propertyId, days]
      )).rows;
      const cfg = (await pool.query(
        \`SELECT mode, is_active FROM pricing_config WHERE user_id = $1 AND property_id = $2\`,
        [_c.userId, req.params.propertyId]
      )).rows[0] || {};`],

    ['mode (mise a jour)',
`      const r = await pool.query(
        \`UPDATE pricing_config SET mode = $1, updated_at = NOW() WHERE user_id = $2 AND property_id = $3\`,
        [mode, req.user.id, req.params.propertyId]
      );`,
`      const _c = await compteDuLogement(pool, req, req.params.propertyId);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const r = await pool.query(
        \`UPDATE pricing_config SET mode = $1, updated_at = NOW() WHERE user_id = $2 AND property_id = $3\`,
        [mode, _c.userId, req.params.propertyId]
      );`],

    ['recompute (lecture de config)',
`      const cfg = (await pool.query(
        \`SELECT pc.*, p.name AS property_name
           FROM pricing_config pc JOIN properties p ON p.id = pc.property_id
          WHERE pc.user_id = $1 AND pc.property_id = $2\`,
        [req.user.id, req.params.propertyId]
      )).rows[0];`,
`      const _c = await compteDuLogement(pool, req, req.params.propertyId);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const cfg = (await pool.query(
        \`SELECT pc.*, p.name AS property_name
           FROM pricing_config pc JOIN properties p ON p.id = pc.property_id
          WHERE pc.user_id = $1 AND pc.property_id = $2\`,
        [_c.userId, req.params.propertyId]
      )).rows[0];`],
  ]],

  [R('push-tarifs-routes.js'), [
    ['push-rates',
`      const { rows } = await pool.query(
        \`SELECT id, name, internal_name, base_price, weekend_price,
                channex_enabled, channex_property_id,
                channex_room_type_id, channex_rate_plan_id, external_pricing
           FROM properties
          WHERE id = $1 AND user_id = $2\`,
        [req.params.id, req.user.id]
      );`,
`      /* Le logement peut appartenir a un compte gere : on resout d'abord,
         on verifie l'acces, puis on lit. Sans cela, un gestionnaire recevait
         « Logement introuvable » sur un logement bien reel. */
      const _c = await compteDuLogement(pool, req, req.params.id);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const { rows } = await pool.query(
        \`SELECT id, name, internal_name, base_price, weekend_price,
                channex_enabled, channex_property_id,
                channex_room_type_id, channex_rate_plan_id, external_pricing
           FROM properties
          WHERE id = $1 AND user_id = $2\`,
        [req.params.id, _c.userId]
      );`],
  ]],

  [R('dynamic-pricing-routes.js'), [
    ['config (upsert)',
`    try {
      const userId = req.user.id;
      const {
        propertyId,`,
`    try {
      const {
        propertyId,`],

    ['config : resolution apres lecture du corps',
`      // colonne stratégie (curseur Occupation↔Revenu) — auto-créée
      await pool.query('ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS strategy INTEGER DEFAULT 50').catch(() => {});`,
`      /* L'identifiant vient du logement, pas du compte connecte : une ligne
         posee sous l'agence n'est jamais relue par le cron. */
      const _c = await compteDuLogement(pool, req, propertyId);
      if (_c.erreur) return res.status(_c.code).json({ error: _c.erreur });
      const userId = _c.userId;

      // colonne stratégie (curseur Occupation↔Revenu) — auto-créée
      await pool.query('ALTER TABLE pricing_config ADD COLUMN IF NOT EXISTS strategy INTEGER DEFAULT 50').catch(() => {});`],
  ]],
];

const rapport = [];

for (const [fichier, edits] of LOTS) {
  const nom = path.basename(fichier);
  if (!fs.existsSync(fichier)) { rapport.push([nom, 'absent', 0]); continue; }

  let s = fs.readFileSync(fichier, 'utf8');
  if (s.indexOf('compteDuLogement') !== -1) { rapport.push([nom, 'deja fait', 0]); continue; }

  /* L'aide, posee dans la fonction exportee pour voir « pool ». */
  const m = s.match(/module\.exports\s*=\s*function[^{]*\{/);
  if (!m) echec(nom + ' : « module.exports = function » introuvable.');

  const faits = [];
  for (const [etiquette, ancien, nouveau] of edits) {
    const n = s.split(ancien).length - 1;
    if (n !== 1) echec(nom + ' \u00b7 ' + etiquette + ' : ' + n + ' occurrence(s), 1 attendue.');
    s = s.split(ancien).join(nouveau);
    faits.push(etiquette);
  }

  s = s.replace(m[0], m[0] + AIDE);

  try { new Function(s); }
  catch (e) { echec(nom + ' : JavaScript invalide — ' + e.message); }

  if (!ESSAI) fs.writeFileSync(fichier, s, 'utf8');
  rapport.push([nom, faits.join(', '), faits.length]);
}

if (!ESSAI) {
  for (const [fichier] of LOTS) {
    if (!fs.existsSync(fichier)) continue;
    if (fs.readFileSync(fichier, 'utf8').indexOf('compteDuLogement') === -1) {
      echec(path.basename(fichier) + ' : la correction n\'est pas dans le fichier apres ecriture.');
    }
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
rapport.forEach(([nom, detail, n]) => console.log('  ' + nom + ' \u00b7 ' + n + ' \u2014 ' + detail));
console.log('\n  L\'identifiant vient du logement, avec verification d\'acces.');
console.log('  Un « ok » sans ligne modifiee devient une erreur explicite.\n');
console.log('  Non traite ici : /dynamic-pricing/decision, qui agit depuis un');
console.log('  identifiant d\'historique — a lire a part.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

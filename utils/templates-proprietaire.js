'use strict';
// À placer dans utils/templates-proprietaire.js
// Règle : un template ciblé appartient au PROPRIÉTAIRE de ses logements.
// Ciblage multi-propriétaires → une copie par propriétaire (chacun ses logements).
// L'historique d'envoi (message_template_logs) est recopié sur chaque copie : sans ça,
// le cron croirait n'avoir jamais envoyé et renverrait aux réservations déjà servies.

let _logCols = null;
async function logColumns(db) {
  if (_logCols) return _logCols;
  const { rows } = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'message_template_logs' AND column_name <> 'id' ORDER BY ordinal_position`);
  _logCols = rows.map(r => r.column_name);
  return _logCols;
}

function ciblesDe(t) {
  let l = t.property_ids;
  if (typeof l === 'string') { try { l = JSON.parse(l || '[]'); } catch (e) { l = []; } }
  if (Array.isArray(l) && l.length) return l.map(String);
  return t.property_id ? [String(t.property_id)] : [];
}

/** Réaligne un template sur le(s) propriétaire(s) de ses logements. Renvoie les lignes résultantes. */
async function repartirTemplateParProprietaire(db, t, { dryRun = false } = {}) {
  const ids = ciblesDe(t);
  if (!ids.length) return { rows: [t], changes: [] };           // global : reste à son auteur

  const { rows } = await db.query(
    'SELECT id::text AS id, user_id FROM properties WHERE id::text = ANY($1::text[])', [ids]);
  const par = new Map();
  for (const r of rows) { if (!par.has(r.user_id)) par.set(r.user_id, []); par.get(r.user_id).push(r.id); }
  if (!par.size) return { rows: [t], changes: [] };

  // L'original reste chez le propriétaire qui a le plus de logements (conserve son id et ses logs)
  const groupes = [...par.entries()].sort((a, b) => b[1].length - a[1].length);
  const changes = [];
  const [u0, ids0] = groupes[0];
  const inchange = groupes.length === 1 && u0 === t.user_id;
  if (inchange) return { rows: [t], changes };

  changes.push({ id: t.id, titre: t.title, de: t.user_id, vers: u0, logements: ids0.length });
  for (const [u, sub] of groupes.slice(1)) changes.push({ id: 'nouveau', titre: t.title, vers: u, logements: sub.length, copie_de: t.id });
  if (dryRun) return { rows: [t], changes };

  const out = [];
  const r0 = await db.query(
    `UPDATE message_templates SET user_id = $1, property_ids = $2::jsonb, property_id = $3, updated_at = NOW()
      WHERE id = $4 RETURNING *`, [u0, JSON.stringify(ids0), ids0[0], t.id]);
  out.push(r0.rows[0]);

  const cols = await logColumns(db);
  for (const [u, sub] of groupes.slice(1)) {
    const r = await db.query(
      `INSERT INTO message_templates (user_id, property_id, title, message, trigger_type, trigger_offset_hours,
                                      trigger_offset_days, send_condition, property_ids, active)
       SELECT $1, $2, title, message, trigger_type, trigger_offset_hours, trigger_offset_days, send_condition, $3::jsonb, active
         FROM message_templates WHERE id = $4 RETURNING *`, [u, sub[0], JSON.stringify(sub), t.id]);
    const nouveau = r.rows[0];
    out.push(nouveau);
    if (cols.includes('template_id')) {
      const sel = cols.map(c => (c === 'template_id' ? '$1' : `"${c}"`)).join(', ');
      await db.query(
        `INSERT INTO message_template_logs (${cols.map(c => `"${c}"`).join(', ')})
         SELECT ${sel} FROM message_template_logs WHERE template_id = $2`, [nouveau.id, t.id]);
    }
  }
  return { rows: out, changes };
}

module.exports = { repartirTemplateParProprietaire, ciblesDe };

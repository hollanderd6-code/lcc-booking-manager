'use strict';
// Patche server.js : POST/PUT /api/message-templates enregistrent au nom du propriétaire des logements.
// Prérequis : utils/templates-proprietaire.js. Idempotent, sauvegarde server.js.bak-tpl
// Usage : node outils/patch-templates-proprietaire.js
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '../server.js');
let s = fs.readFileSync(f, 'utf8');
if (s.includes('repartirTemplateParProprietaire')) { console.log('Déjà appliqué.'); process.exit(0); }

const edits = [
  // POST : répartir après insertion
  [ `      [userId, property_id || null, title, message, trigger_type, trigger_offset_hours || 0, trigger_offset_days || 0, send_condition || 'always',
       JSON.stringify(property_ids && property_ids.length > 0 ? property_ids : [])]
    );
    res.json({ success: true, template: result.rows[0] });`,
    `      [proprio.global ? proprio.userId : userId, property_id || null, title, message, trigger_type, trigger_offset_hours || 0, trigger_offset_days || 0, send_condition || 'always',
       JSON.stringify(property_ids && property_ids.length > 0 ? property_ids : [])]
    );
    // Règle : un template ciblé appartient au propriétaire de ses logements (partagé entre ses agences).
    const { repartirTemplateParProprietaire } = require('./utils/templates-proprietaire');
    const _rep = await repartirTemplateParProprietaire(pool, result.rows[0]);
    res.json({ success: true, template: _rep.rows[0], templates: _rep.rows });` ],
  // PUT : répartir après modification
  [ `    if (!result.rows[0]) return res.status(404).json({ error: 'Template non trouvé' });
    res.json({ success: true, template: result.rows[0] });`,
    `    if (!result.rows[0]) return res.status(404).json({ error: 'Template non trouvé' });
    const { repartirTemplateParProprietaire } = require('./utils/templates-proprietaire');
    const _rep = await repartirTemplateParProprietaire(pool, result.rows[0]);
    res.json({ success: true, template: _rep.rows[0], templates: _rep.rows });` ],
];
for (const [a] of edits) {
  const n = s.split(a).length - 1;
  if (n !== 1) { console.error('❌ Motif trouvé ' + n + ' fois — rien modifié :\n' + a.slice(0, 140)); process.exit(1); }
}
fs.writeFileSync(f + '.bak-tpl', s);
for (const [a, b] of edits) s = s.replace(a, b);
fs.writeFileSync(f, s);
console.log('✅ server.js : templates enregistrés au nom du propriétaire (sauvegarde server.js.bak-tpl)');

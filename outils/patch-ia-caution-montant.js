'use strict';
// IA — caution : transmet le montant réellement retenu (deposits.captured_amount, centimes)
// À lancer APRÈS patch-ia-caution.js. Idempotent. Sauvegardes .bak2
// Usage : node outils/patch-ia-caution-montant.js
const fs = require('fs'), path = require('path');

function patch(rel, edits, marker) {
  const f = path.join(__dirname, '..', rel);
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes(marker)) { console.log('Déjà appliqué :', rel); return; }
  for (const [a] of edits) if (s.split(a).length !== 2) { console.error('❌ ' + rel + ' — motif introuvable :\n' + a); process.exit(1); }
  fs.writeFileSync(f + '.bak2', s);
  for (const [a, b] of edits) s = s.replace(a, b);
  fs.writeFileSync(f, s);
  console.log('✅ ' + rel + ' patché');
}

// ── 1. integrated-chat-handler.js : lire captured_amount / captured_at ──
patch('integrated-chat-handler.js', [
  [ "SELECT d.status, d.amount_cents, p.deposit_amount",
    "SELECT d.status, d.amount_cents, d.captured_amount, d.captured_at, p.deposit_amount" ],
  [ "    let depositAmount = null;\n",
    "    let depositAmount = null;\n    let depositCapturedAmount = null, depositCapturedAt = null;\n" ],
  [ "        depositStatus = depResult.rows[0].status || null;\n",
    "        depositStatus = depResult.rows[0].status || null;\n" +
    "        if (depResult.rows[0].captured_amount != null) depositCapturedAmount = depResult.rows[0].captured_amount / 100;\n" +
    "        depositCapturedAt = depResult.rows[0].captured_at || null;\n" ],
  [ "      depositStatus:      isAirbnbPlatform ? 'not_applicable' : depositStatus,\n",
    "      depositStatus:      isAirbnbPlatform ? 'not_applicable' : depositStatus,\n" +
    "      depositCapturedAmount: isAirbnbPlatform ? null : depositCapturedAmount,\n" +
    "      depositCapturedAt:     isAirbnbPlatform ? null : depositCapturedAt,\n" ],
], 'depositCapturedAmount');

// ── 2. services/groq-ai.js : chiffres exacts dans le prompt ──
patch('services/groq-ai.js', [
  [ "    if (ctx.depositBlocksAccess) {",
    "    if (ctx.depositStatus === 'captured' && ctx.depositCapturedAmount != null) {\n" +
    "      const kept = Number(ctx.depositCapturedAmount);\n" +
    "      const back = Math.max(0, Math.round((amt - kept) * 100) / 100);\n" +
    "      const d = ctx.depositCapturedAt ? new Date(ctx.depositCapturedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : null;\n" +
    "      depositLines.push(`- MONTANT RETENU PAR L'HÔTE : ${kept}€${d ? ' (le ' + d + ')' : ''}`);\n" +
    "      depositLines.push(back > 0\n" +
    "        ? `- Part NON retenue : ${back}€ — jamais encaissée par l'hôte, libérée le même jour. Si la banque l'avait bloquée ou débitée temporairement, elle réapparaît sous 5 à 10 jours ouvrés selon la banque. AUCUN autre versement n'est prévu.`\n" +
    "        : `- La totalité de la caution a été retenue. AUCUN remboursement n'est prévu.`);\n" +
    "      depositLines.push(`- Motif de la retenue : NON CONNU ici.`);\n" +
    "    }\n" +
    "    if (ctx.depositBlocksAccess) {" ],
  [ "• Statut CAUTION ENCAISSÉE + toute question sur l'argent (montant reçu, remboursé, retenu, virement partiel, « il manque », « reste », « solde ») → [ESCALADE].",
    "• Statut CAUTION ENCAISSÉE SANS ligne « MONTANT RETENU PAR L'HÔTE » + toute question sur l'argent → [ESCALADE].\n" +
    "• Ligne « MONTANT RETENU PAR L'HÔTE » présente → répondre avec CES chiffres exactement (montant retenu, part non retenue), sans promettre d'autre versement ni inventer de date. Ne pas donner de motif.\n" +
    "• Demande du motif de la retenue → [ESCALADE]." ],
], "MONTANT RETENU PAR L'HÔTE");

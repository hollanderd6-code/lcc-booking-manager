'use strict';
// Factures : (1) le message de confirmation automatique demande les infos particulières,
// (2) le cron attend 2 h sans modification de la demande avant de générer.
// Idempotent, sauvegardes .bak-infos. Usage : node outils/patch-facture-infos.js
const fs = require('fs'), path = require('path');

function patch(rel, edits, marker) {
  const f = path.join(__dirname, '..', rel);
  let s = fs.readFileSync(f, 'utf8');
  if (s.includes(marker)) { console.log('Déjà appliqué :', rel); return; }
  for (const [a] of edits) {
    const n = s.split(a).length - 1;
    if (n < 1) { console.error('❌ ' + rel + ' — motif introuvable :\n' + a.slice(0, 120)); process.exit(1); }
  }
  fs.writeFileSync(f + '.bak-infos', s);
  for (const [a, b] of edits) s = s.split(a).join(b);
  fs.writeFileSync(f, s);
  console.log('✅ ' + rel + ' patché');
}

patch('integrated-chat-handler.js', [
  [ 'const INVOICE_CONFIRM = {',
    "const INVOICE_ASK = {\n" +
    "  fr: `Souhaitez-vous qu'une information particulière y figure (nom différent, société, SIRET, adresse de facturation, email) ? Répondez simplement ici.`,\n" +
    "  en: `Would you like any specific details on it (different name, company, VAT/registration number, billing address, email)? Just reply here.`,\n" +
    "  es: `¿Desea que figure algún dato concreto (otro nombre, empresa, NIF, dirección de facturación, email)? Responda aquí.`,\n" +
    "  it: `Desidera che vi compaia qualche dato particolare (altro nome, società, P.IVA, indirizzo di fatturazione, email)? Risponda qui.`,\n" +
    "  de: `Sollen bestimmte Angaben darauf stehen (anderer Name, Firma, USt-IdNr., Rechnungsadresse, E-Mail)? Antworten Sie einfach hier.`,\n" +
    "  pt: `Deseja que conste alguma informação específica (outro nome, empresa, NIF, morada de faturação, email)? Responda aqui.`,\n" +
    "  nl: `Wilt u specifieke gegevens vermelden (andere naam, bedrijf, btw-nummer, factuuradres, e-mail)? Antwoord gewoon hier.`,\n" +
    "};\n\nconst INVOICE_CONFIRM = {" ],
  [ "aiResponse = (INVOICE_CONFIRM[lang] || INVOICE_CONFIRM.fr) + '\\n[FACTURE]';",
    "aiResponse = (INVOICE_CONFIRM[lang] || INVOICE_CONFIRM.fr) + '\\n\\n' + (INVOICE_ASK[lang] || INVOICE_ASK.fr) + '\\n[FACTURE]';" ],
  [ "await sendBotMessage(conversation.id, INVOICE_CONFIRM[lang] || INVOICE_CONFIRM.fr, pool, io, channexId);",
    "await sendBotMessage(conversation.id, (INVOICE_CONFIRM[lang] || INVOICE_CONFIRM.fr) + '\\n\\n' + (INVOICE_ASK[lang] || INVOICE_ASK.fr), pool, io, channexId);" ],
], 'INVOICE_ASK');

patch('server.js', [
  [ "       AND DATE(r.end_date) >= ($1::date - INTERVAL '120 days')\n       FOR UPDATE OF ir SKIP LOCKED",
    "       AND DATE(r.end_date) >= ($1::date - INTERVAL '120 days')\n" +
    "       -- Laisse 2 h au voyageur pour donner société / SIRET / adresse avant de générer\n" +
    "       AND ir.updated_at < NOW() - INTERVAL '2 hours'\n" +
    "       FOR UPDATE OF ir SKIP LOCKED" ],
], "Laisse 2 h au voyageur");

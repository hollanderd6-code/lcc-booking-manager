#!/usr/bin/env node
/* ============================================================
   outils/sms-etat-reel.js
   Ne plus dire « envoye » quand la passerelle dit « Pending »
   ============================================================
   Cible : server.js  (sendSmsGateway et la route du lien BHGuest)

   ── LE DEFAUT ────────────────────────────────────────────────────
   Test du 30 aout, lien BHGuest par SMS :

       📱 [SMS] Envoye a +336… id: k2t3R… state: Pending
       📱 [HOLD] SMS envoye a +336…

   La passerelle repond « Pending » — mise en file, en attente de
   l'appareil Android — et la ligne suivante affirme « envoye ». Le SMS
   n'est jamais arrive : l'application du telephone plantait au
   lancement, donc la file n'etait pas prise. Rien ne le disait.

   Pire, la table sms_logs enregistre le statut en dur :

       VALUES ($1,…,'sent',$7)

   Votre historique affirme donc « sent » pour des messages jamais
   partis. C'est la meme faute que le « 🔒 Channex bloque » de ce matin :
   annoncer un succes sans l'avoir verifie.

   ── LA CORRECTION ────────────────────────────────────────────────
   1. Apres l'envoi, UNE relecture de GET /message/{id} — deux secondes,
      seulement si l'etat initial n'est pas deja definitif. C'est ce que
      fait desormais le blocage Channex, pour la meme raison.

   2. sms_logs.status enregistre l'etat REEL (pending, sent, delivered,
      failed) au lieu de 'sent' en dur.

   3. sendSmsGateway renvoie { ok, state, id } au lieu de `true`. Un
      objet est vrai dans un test booleen : vos six autres appels
      (`if (smsSent)`, `const sent = await …`) se comportent exactement
      comme avant. Les echecs renvoient toujours `false`.

   4. La route du lien BHGuest renvoie `sms_state` au navigateur, et
      journalise « SMS Pending » plutot que « SMS envoye ».

   ── CE QUI RESTE A FAIRE, ET QUE CE LOT NE FAIT PAS ──────────────
   L'echec DIFFERE : un message accepte, parti, puis perdu par
   l'operateur trois minutes plus tard. Il faudrait le webhook
   sms:sent / sms:delivered — une route, une colonne, une mise a jour
   asynchrone. Lot distinct, a votre demande.

   L'affichage a l'ecran (public/app.html) n'est pas touche ici : il lit
   desormais `sms_state`, mais c'est un second lot.

   Usage :
     node outils/sms-etat-reel.js --essai
     node outils/sms-etat-reel.js
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

if (!fs.existsSync(CIBLE)) echec('server.js introuvable. Lancez depuis la racine du projet.');

let src = fs.readFileSync(CIBLE, 'utf8');

if (src.indexOf('SMS_ETAT_REEL') !== -1) {
  console.log('\n  Deja applique — rien a faire.\n');
  process.exit(0);
}

function remplacer(avant, apres, quoi) {
  if (src.split(avant).length - 1 !== 1) {
    echec('\u00ab ' + quoi + ' \u00bb introuvable (ou present plusieurs fois) dans server.js.');
  }
  src = src.split(avant).join(apres);
}

/* ── 1. La relecture de l'etat, juste apres l'envoi ──────────────── */

remplacer(
"    console.log(`📱 [SMS] Envoyé à ${phone} (${finalMsg.length} chars) — id: ${data.id} state: ${data.state}`);",
`    console.log(\`📱 [SMS] Remis a la passerelle : \${phone} (\${finalMsg.length} chars) — id: \${data.id} state: \${data.state}\`);

    /* SMS_ETAT_REEL — « Pending » veut dire mis en file, pas envoye : le
       message attend l'appareil Android. Le 30 aout, l'application du
       telephone plantait au lancement et deux SMS sont restes en attente
       pendant que l'ecran affichait « envoye ». Une relecture, deux
       secondes, seulement si l'etat n'est pas deja definitif. */
    const ETATS_FINAUX = ['Sent', 'Delivered', 'Failed'];
    let etatSms = data.state || null;
    if (data.id && (!etatSms || !ETATS_FINAUX.includes(etatSms))) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const relecture = await fetch('https://api.sms-gate.app/3rdparty/v1/message/' + data.id, {
          headers: { 'Authorization': \`Basic \${credentials}\` }
        });
        if (relecture.ok) {
          const apres = await relecture.json();
          if (apres && apres.state) etatSms = apres.state;
        }
      } catch (relErr) {
        /* Passerelle muette : on garde l'etat initial plutot que d'inventer. */
      }
      console.log(\`📱 [SMS] Etat relu — \${data.id} : \${etatSms}\`);
    }`,
  'la ligne de journal de l\'envoi'
);

/* ── 2. Le statut enregistre en base ─────────────────────────────── */

remplacer(
`         VALUES ($1,$2,$3,$4,$5,$6,'sent',$7)
         ON CONFLICT DO NOTHING\`,
        [userId, _logData?.property_id||null, _logData?.guest_name||null, phone, finalMsg, _logData?.trigger_type||null, data.id]`,
`         VALUES ($1,$2,$3,$4,$5,$6,$8,$7)
         ON CONFLICT DO NOTHING\`,
        [userId, _logData?.property_id||null, _logData?.guest_name||null, phone, finalMsg, _logData?.trigger_type||null, data.id,
         String(etatSms || 'pending').toLowerCase()]`,
  'le statut en dur dans sms_logs'
);

/* ── 3. Le retour de la fonction ─────────────────────────────────── */

remplacer(
`    } catch(logErr) { console.warn('⚠️ [SMS] Log error:', logErr.message); }
    return true;`,
`    } catch(logErr) { console.warn('⚠️ [SMS] Log error:', logErr.message); }
    /* Un objet reste vrai dans un test booleen : les appels existants
       (\`if (smsSent)\`) ne changent pas de comportement. */
    return { ok: true, state: etatSms, id: data.id || null };`,
  'le retour de sendSmsGateway'
);

/* ── 4. La route du lien BHGuest ─────────────────────────────────── */

remplacer('    let smsSent = null;', '    let smsSent = null;\n    let smsEtat = null;', 'la declaration de smsSent');

remplacer(
"        if (smsSent) console.log(`📱 [HOLD] SMS envoyé à ${guest_phone}`);",
`        smsEtat = (smsSent && smsSent.state) ? smsSent.state : (smsSent ? 'Sent' : 'Failed');
        console.log(\`📱 [HOLD] SMS \${smsEtat} pour \${guest_phone}\`
          + (smsEtat === 'Pending' ? ' — en attente de l\\'appareil Android, pas encore parti' : ''));`,
  'la ligne « SMS envoyé » du hold'
);

remplacer(
'    res.json({ success: true, token: linkToken, expires_at: expiresAt, sms_sent: smsSent });',
'    res.json({ success: true, token: linkToken, expires_at: expiresAt,\n'
+ '               sms_sent: smsSent ? true : smsSent, sms_state: smsEtat });',
  'la reponse de la route du hold'
);

/* ── 5. Verifications ───────────────────────────────────────────── */

try { new Function(src.replace(/^#![^\n]*\n/, '')); }
catch (e) { echec('server.js ne serait plus du JavaScript valide — ' + e.message); }

[
  ['la relecture de l\'etat', "'/3rdparty/v1/message/' + data.id"],
  ['les etats definitifs', "ETATS_FINAUX = ['Sent', 'Delivered', 'Failed']"],
  ['le statut reel en base', "String(etatSms || 'pending').toLowerCase()"],
  ['le retour detaille', 'return { ok: true, state: etatSms, id: data.id || null };'],
  ['l\'etat renvoye au navigateur', 'sms_state: smsEtat'],
].forEach(function (c) {
  if (src.indexOf(c[1]) === -1) echec('Verification : ' + c[0] + ' est absent apres modification.');
});
if (src.indexOf("VALUES ($1,$2,$3,$4,$5,$6,'sent',$7)") !== -1) {
  echec("Le statut 'sent' en dur subsiste dans sms_logs.");
}

if (!ESSAI) {
  const sauvegarde = CIBLE + '.avant-sms-etat';
  if (!fs.existsSync(sauvegarde)) fs.writeFileSync(sauvegarde, fs.readFileSync(CIBLE));
  fs.writeFileSync(CIBLE, src, 'utf8');
  if (fs.readFileSync(CIBLE, 'utf8').indexOf('SMS_ETAT_REEL') === -1) {
    echec("La correction n'est pas dans le fichier apres ecriture.");
  }
}

console.log('\n' + (ESSAI ? '— ESSAI, aucune ecriture —' : '— APPLIQUE ET VERIFIE —'));
console.log('  Relecture  : GET /message/{id} une fois, si l\'etat n\'est pas definitif');
console.log('  sms_logs   : statut reel (pending / sent / delivered / failed)');
console.log('  Retour     : { ok, state, id } — vos six autres appels inchanges');
console.log('  Route hold : renvoie sms_state au navigateur');
if (!ESSAI) console.log('  Sauvegarde : server.js.avant-sms-etat (ne pas commiter)');
console.log('');
console.log('  A verifier : envoyez un lien par SMS, telephone relais ETEINT.');
console.log('  Les logs doivent dire « SMS Pending … en attente de l\'appareil »,');
console.log('  et sms_logs porter « pending » et non « sent ». Rallumez le');
console.log('  telephone : le message part, et le prochain envoi dira « Sent ».\n');
console.log('  L\'affichage a l\'ecran suit dans un second lot : il lira sms_state.\n');
if (ESSAI) console.log('  Relancez sans --essai pour appliquer.\n');

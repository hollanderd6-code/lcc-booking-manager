'use strict';

// Generates final HTML preview files in tmp/email-previews/ for visual testing.
// Run: node scripts/generate-email-previews.js

const fs   = require('fs');
const path = require('path');

process.env.APP_URL        = process.env.APP_URL || 'http://localhost:3000';
process.env.EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || '';

const bhEmailTemplate = require('../services/email/emailLayout');
const { escapeHtml, emailButton, emailCTABlock, emailCard, emailDivider, emailBookingSummary } = require('../services/email/emailComponents');

const OUT_DIR = path.join(__dirname, '..', 'tmp', 'email-previews');
fs.mkdirSync(OUT_DIR, { recursive: true });

function write(name, html) {
  const filePath = path.join(OUT_DIR, name);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`  ✅  ${name}`);
}

// ── A1/A2 — Verify email ────────────────────────────────────────────────────
const verifyUrl = `${process.env.APP_URL}/verify-email.html?token=abc123`;
write('email-final-verify.html', bhEmailTemplate({
  title: 'Confirmez votre adresse email',
  subtitle: 'Boostinghost',
  footerNote: 'Si vous n\'avez pas créé de compte, ignorez cet email.',
  bodyHtml: `
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Bonjour <strong>${escapeHtml('Marie <Dupont>')}</strong>,</p>
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Merci de vous être inscrit sur Boostinghost. Pour activer votre compte, cliquez sur le bouton ci-dessous :</p>
    ${emailCTABlock(verifyUrl, 'Vérifier mon adresse email', { title: 'Lien valide pendant 24 heures' })}
    ${emailCard('info', 'Une fois vérifié, vous accéderez à : calendrier unifié, messages automatiques IA, gestion du ménage, cautions Stripe, livrets d\'accueil et bien plus.')}
    <p style="font-size:11px;color:#878782;word-break:break-all;overflow-wrap:anywhere;line-height:1.6;margin-top:14px;font-family:Arial,Helvetica,sans-serif;">Le bouton ne fonctionne pas ? Copiez ce lien :<br><a href="${verifyUrl}" style="color:#0E3B2E;word-break:break-all;">${verifyUrl}</a></p>
  `
}));

// ── E1 — Cleaning notification ───────────────────────────────────────────────
write('email-final-cleaning.html', bhEmailTemplate({
  title: 'Nouveau ménage à prévoir',
  tag: 'Villa Les Calanques',
  bodyHtml: `
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">${escapeHtml('Bonjour Sophie & Co,')}</p>
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Un nouveau séjour vient d'être réservé pour le logement <strong>${escapeHtml('Villa Les Calanques')}</strong>.</p>
    ${emailCard('info', `<strong>Voyageur&nbsp;:</strong> ${escapeHtml('Jean <Martin>')}<br><strong>Séjour&nbsp;:</strong> du 12 octobre au 15 octobre<br><strong>Ménage à prévoir&nbsp;:</strong> le 15 octobre après le départ des voyageurs`)}
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Heure exacte de check-out à confirmer avec la conciergerie.</p>
  `
}));

// ── G4 — Invoice send-link ───────────────────────────────────────────────────
write('email-final-invoice.html', bhEmailTemplate({
  title: 'Votre facture est disponible',
  tag: 'Appartement Marais',
  bodyHtml: `
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Bonjour <strong>${escapeHtml('Thomas & Claire Renard')}</strong>,</p>
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Votre facture pour votre séjour à <strong>${escapeHtml('Appartement Marais')}</strong> est disponible en téléchargement :</p>
    ${emailButton('http://localhost:3000/download/abc123', 'Télécharger ma facture')}
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;">Lien valable 1 an</p>
    <p style="font-size:14px;color:#5A5A54;margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;">Cordialement, <strong>${escapeHtml('Dupont & Associés SARL')}</strong></p>
  `
}));

// ── I9 — Payment failed ──────────────────────────────────────────────────────
write('email-final-payment-failed.html', bhEmailTemplate({
  title: 'Paiement refusé',
  subtitle: 'Action requise',
  footerNote: 'BHGuest',
  bodyHtml: `
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Bonjour ${escapeHtml('Pierre <Durand>')},</p>
    <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Le prélèvement de <strong>250,00&nbsp;€</strong> pour votre séjour a été refusé par votre banque.</p>
    ${emailCard('danger', 'Nous réessaierons demain. <strong>Sans paiement sous 2 jour(s), votre réservation sera annulée.</strong><br>Vérifiez votre carte (provision, expiration) ou contactez votre hôte.')}
  `
}));

// ── 2. Réservation confirmée — BHGuest ──────────────────────────────────────
write('email-final-booking-confirmed.html', bhEmailTemplate({
  title: 'Réservation confirmée !',
  tag: 'Appartement Bastille',
  footerNote: 'Boostinghost Guest',
  bodyHtml: `
    ${emailCard('success', `<strong>Paiement reçu ✓</strong><br>Référence : ${escapeHtml('BHGUEST_abc123')}`)}
    ${emailBookingSummary([
      { label: 'Arrivée', value: '15 octobre 2026' },
      { label: 'Départ', value: '18 octobre 2026' },
      { label: 'Total payé', value: '450,00 €' }
    ])}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">À très bientôt,<br>L'équipe Boostinghost</p>
  `
}));

// ── 4. Paiement réussi ───────────────────────────────────────────────────────
write('email-final-payment-success.html', bhEmailTemplate({
  title: 'Paiement effectué',
  subtitle: 'Votre séjour est réglé',
  footerNote: 'BHGuest',
  bodyHtml: `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Bonjour ${escapeHtml('Marie Dupont')},</p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Comme prévu, votre carte vient d'être débitée de <strong>320,00 €</strong> pour votre séjour.</p>
    ${emailCard('success', 'Ce séjour n\'est désormais plus annulable. Bon voyage !')}
  `
}));

// ── 7. Sous-compte / Invitation gestionnaire ─────────────────────────────────
write('email-final-agency-invitation.html', bhEmailTemplate({
  title: 'Invitation gestionnaire',
  subtitle: 'Maison Lecoeur vous donne accès à son espace Boostinghost',
  tag: 'Compte Agence',
  footerNote: "Si vous n'avez pas de compte Boostinghost, créez-en un d'abord puis revenez sur ce lien.",
  bodyHtml: `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;"><strong>${escapeHtml('Maison Lecoeur')}</strong> vous invite à gérer ses logements sur Boostinghost en tant que gestionnaire.</p>
    ${emailCTABlock('http://localhost:3000/app.html?agency_token=tok123', "Accéder à l'espace", { text: "Connectez-vous à votre compte Boostinghost pour accéder à cet espace." })}
  `
}));

// ── 8. Notification opérationnelle équipe (rappel arrivées) ─────────────────
write('email-final-team-reminder.html', bhEmailTemplate({
  title: 'Arrivées demain',
  tag: '2 réservations',
  bodyHtml: [
    emailCard('info',
      emailBookingSummary([
        { label: '🏠 Logement', value: 'Villa Les Calanques' },
        { label: '👤 Voyageur', value: 'Jean Martin' },
        { label: '📅 Arrivée', value: '15/10/2026 à 15:00' },
        { label: '📅 Départ', value: '18/10/2026 à 11:00' },
        { label: '🌙 Nuits', value: '3' },
        { label: '🌐 Plateforme', value: 'Airbnb' }
      ]) + '<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5A5A54;">✅ Actions : vérifier le logement · envoyer les instructions · communiquer le code d\'accès</p>'
    ),
    emailCard('info',
      emailBookingSummary([
        { label: '🏠 Logement', value: 'Studio Marais' },
        { label: '👤 Voyageur', value: 'Sophie Durand' },
        { label: '📅 Arrivée', value: '15/10/2026 à 16:00' },
        { label: '📅 Départ', value: '17/10/2026 à 11:00' },
        { label: '🌙 Nuits', value: '2' },
        { label: '🌐 Plateforme', value: 'Booking.com' }
      ]) + '<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5A5A54;">✅ Actions : vérifier le logement · envoyer les instructions · communiquer le code d\'accès</p>'
    )
  ].join('')
}));

// ── 9. Email avec CTA (signature contrat) ───────────────────────────────────
write('email-final-with-cta.html', bhEmailTemplate({
  title: 'Signature de votre contrat',
  subtitle: `Studio Marais · du 15/10/2026`,
  bodyHtml: `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Bonjour <strong>${escapeHtml('Sophie Durand')}</strong>,</p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Votre contrat de location pour <strong>${escapeHtml('Studio Marais')}</strong> est prêt. Il ne reste plus qu'à le signer électroniquement.</p>
    ${emailCTABlock('http://localhost:3000/signer-contrat.html?token=tok456', 'Signer mon contrat', { title: 'Cliquez sur le bouton ci-dessous pour consulter et signer votre contrat' })}
    ${emailCard('warning', '⏰ Ce lien est valable <strong>7 jours</strong>. Passé ce délai, contactez votre bailleur pour un nouveau lien.')}
  `
}));

// ── 10. Email sans CTA (attestation fiscale) ─────────────────────────────────
write('email-final-no-cta.html', bhEmailTemplate({
  title: 'Attestation fiscale 2025',
  tag: 'Services à la personne',
  bodyHtml: `
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Bonjour,</p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Veuillez trouver en pièce jointe votre <strong>attestation fiscale pour l'année 2025</strong> concernant les services à la personne fournis par <strong>${escapeHtml('Ma Conciergerie SARL')}</strong>.</p>
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Ce document vous permettra de bénéficier du <strong>crédit d'impôt pour l'emploi d'un salarié à domicile</strong> (art. 199 sexdecies du CGI) lors de votre déclaration de revenus.</p>
    ${emailCard('info', '💡 <strong>Conseil :</strong> Conservez ce document pour votre déclaration de revenus 2026.')}
    <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#20221F;line-height:1.6;">Pour toute question, n'hésitez pas à nous contacter.<br>Cordialement, <strong>${escapeHtml('Ma Conciergerie SARL')}</strong></p>
  `
}));

console.log('\n✅  Previews finales écrites dans tmp/email-previews/\n');

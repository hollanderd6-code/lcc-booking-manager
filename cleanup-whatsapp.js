#!/usr/bin/env node

/**
 * Script de nettoyage automatique WhatsApp
 * Supprime toutes les références WhatsApp du projet
 */

const fs = require('fs');
const path = require('path');

console.log('🧹 Démarrage du nettoyage WhatsApp...\n');

// ============================================
// 1. SUPPRIMER whatsappService.js
// ============================================
const whatsappServicePaths = [
  './services/whatsappService.js',
  './whatsappService.js',
  './src/services/whatsappService.js'
];

let whatsappServiceDeleted = false;
for (const servicePath of whatsappServicePaths) {
  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
    console.log('✅ Supprimé:', servicePath);
    whatsappServiceDeleted = true;
  }
}

if (!whatsappServiceDeleted) {
  console.log('ℹ️  whatsappService.js introuvable (peut-être déjà supprimé)');
}

// ============================================
// 2. NETTOYER server.js
// ============================================
const serverPath = './server.js';

if (fs.existsSync(serverPath)) {
  console.log('\n📝 Nettoyage de server.js...');
  let content = fs.readFileSync(serverPath, 'utf8');

  // Supprimer l'import
  content = content.replace(
    /const whatsappService = require\(['"]\.\/services\/whatsappService['"]\);?\n?/g,
    ''
  );

  // Remplacer les conditions avec whatsappService
  content = content.replace(
    /if \(!transporter && !whatsappService\.isConfigured\(\)\)/g,
    'if (!transporter)'
  );

  // Supprimer les blocs WhatsApp complets (méthode sécurisée)
  // On cherche les blocs qui commencent par "// WhatsApp" et se terminent avant le prochain bloc
  const whatsappBlockRegex = /\/\/ WhatsApp[\s\S]*?whatsappService[\s\S]*?\}\s*\}\s*\);?\s*\n\s*\}/g;
  content = content.replace(whatsappBlockRegex, '');

  // Nettoyer les commentaires WhatsApp isolés
  content = content.replace(/\/\/.*WhatsApp.*\n/g, '');
  content = content.replace(/\*.*WhatsApp.*\n/g, '');

  // Nettoyer les messages de log
  content = content.replace(
    /Ni email ni WhatsApp configurés/g,
    'Email non configuré'
  );

  // Supprimer les lignes vides multiples
  content = content.replace(/\n{3,}/g, '\n\n');

  fs.writeFileSync(serverPath, content, 'utf8');
  console.log('✅ server.js nettoyé');
} else {
  console.log('⚠️  server.js introuvable');
}

// ============================================
// 3. NETTOYER notifications.html
// ============================================
const notificationsPath = './notifications.html';

if (fs.existsSync(notificationsPath)) {
  console.log('\n📝 Nettoyage de notifications.html...');
  let content = fs.readFileSync(notificationsPath, 'utf8');

  // Supprimer la section WhatsApp complète
  const whatsappSectionRegex = /<!--.*Bloc.*WhatsApp.*-->[\s\S]*?<section[^>]*id="whatsappBlock"[^>]*>[\s\S]*?<\/section>/gi;
  content = content.replace(whatsappSectionRegex, '');

  fs.writeFileSync(notificationsPath, content, 'utf8');
  console.log('✅ notifications.html nettoyé');
} else {
  console.log('ℹ️  notifications.html introuvable');
}

// ============================================
// 4. NETTOYER deposits.html
// ============================================
const depositsPath = './deposits.html';

if (fs.existsSync(depositsPath)) {
  console.log('\n📝 Nettoyage de deposits.html...');
  let content = fs.readFileSync(depositsPath, 'utf8');

  // Modifier les alertes
  content = content.replace(
    /Airbnb, Booking, WhatsApp, email/g,
    'Airbnb, Booking, email'
  );

  fs.writeFileSync(depositsPath, content, 'utf8');
  console.log('✅ deposits.html nettoyé');
} else {
  console.log('ℹ️  deposits.html introuvable');
}

// ============================================
// 5. NETTOYER app.html
// ============================================
const appPaths = ['./app.html', './app-4.html'];

for (const appPath of appPaths) {
  if (fs.existsSync(appPath)) {
    console.log(`\n📝 Nettoyage de ${path.basename(appPath)}...`);
    let content = fs.readFileSync(appPath, 'utf8');

    // Supprimer les alertes WhatsApp
    const whatsappAlertRegex = /<!--.*Alerte.*WhatsApp.*-->[\s\S]*?<div[^>]*id="whatsappAlert"[^>]*>[\s\S]*?<\/div>/gi;
    content = content.replace(whatsappAlertRegex, '');

    fs.writeFileSync(appPath, content, 'utf8');
    console.log(`✅ ${path.basename(appPath)} nettoyé`);
  }
}

// ============================================
// 6. RÉSUMÉ
// ============================================
console.log('\n' + '='.repeat(50));
console.log('✅ NETTOYAGE WHATSAPP TERMINÉ !');
console.log('='.repeat(50));
console.log('\n📋 Prochaines étapes :');
console.log('1. Vérifiez que le serveur démarre : node server.js');
console.log('2. Si tout fonctionne :');
console.log('   git add .');
console.log('   git commit -m "Remove WhatsApp integration"');
console.log('   git push');
console.log('\n🚀 Bon courage !\n');

#!/bin/bash

echo "🔧 Script de remplacement de login.html"
echo "========================================"
echo ""

# Vérifier que le fichier login-v3-final.html existe
if [ ! -f "login-v3-final.html" ]; then
    echo "❌ Erreur: login-v3-final.html introuvable!"
    echo "   Assurez-vous que le fichier est dans le répertoire actuel"
    exit 1
fi

echo "✅ Fichier login-v3-final.html trouvé"
echo ""

# 1. Sauvegarder l'ancien fichier
echo "📦 Sauvegarde de l'ancien login.html..."
cp public/login.html public/login.html.backup.$(date +%Y%m%d_%H%M%S)
echo "   ✅ Sauvegardé dans public/login.html.backup.*"
echo ""

# 2. Remplacer le fichier source
echo "🔄 Remplacement du fichier source..."
cp login-v3-final.html public/login.html
echo "   ✅ public/login.html mis à jour"
echo ""

# 3. Nettoyer les caches iOS
echo "🧹 Nettoyage des caches iOS..."
if [ -d "ios/App/App/public" ]; then
    rm -rf ios/App/App/public
    echo "   ✅ Cache iOS supprimé"
else
    echo "   ℹ️  Pas de cache iOS à supprimer"
fi
echo ""

# 4. Nettoyer les caches Android (optionnel)
echo "🧹 Nettoyage des caches Android..."
if [ -d "android/app/build" ]; then
    rm -rf android/app/build
    echo "   ✅ Build Android supprimé"
else
    echo "   ℹ️  Pas de build Android à supprimer"
fi
echo ""

# 5. Copier vers iOS
echo "📋 Copie vers iOS..."
npx cap copy ios
echo "   ✅ Fichiers copiés"
echo ""

# 6. Sync iOS
echo "🔄 Synchronisation iOS..."
npx cap sync ios
echo "   ✅ Sync terminée"
echo ""

echo "╔════════════════════════════════════════╗"
echo "║  ✅ MISE À JOUR TERMINÉE !            ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "Prochaines étapes:"
echo "1. Ouvrez Xcode: npx cap open ios"
echo "2. Dans Xcode: Product > Clean Build Folder (Cmd+Shift+K)"
echo "3. Dans Xcode: Product > Build (Cmd+B)"
echo "4. Lancez l'app"
echo ""
echo "Dans Safari Web Inspector, vous devriez voir:"
echo "╔════════════════════════════════════════╗"
echo "║  ✅ LOGIN.HTML VERSION CORRIGÉE V3    ║"
echo "╚════════════════════════════════════════╝"
echo ""

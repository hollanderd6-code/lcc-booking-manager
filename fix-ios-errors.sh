#!/bin/bash

# ============================================
# 🔧 Script de correction automatique iOS
# ============================================

set -e  # Arrêter si une erreur se produit

echo "🔧 Correction automatique des fichiers pour iOS"
echo "=============================================="
echo ""

# Vérifier qu'on est dans le bon dossier
if [ ! -f "package.json" ]; then
    echo "❌ Erreur: package.json non trouvé"
    echo "   Exécutez ce script depuis la racine du projet"
    exit 1
fi

# Vérifier que les fichiers existent
if [ ! -f "public/messages.html" ]; then
    echo "❌ Erreur: public/messages.html non trouvé"
    exit 1
fi

if [ ! -f "public/js/chat-owner.js" ]; then
    echo "❌ Erreur: public/js/chat-owner.js non trouvé"
    exit 1
fi

echo "✅ Fichiers trouvés"
echo ""

# ============================================
# 📦 Sauvegardes
# ============================================

echo "📦 Création des sauvegardes..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

cp public/messages.html "public/messages.html.backup_${TIMESTAMP}"
echo "   ✅ public/messages.html.backup_${TIMESTAMP}"

cp public/js/chat-owner.js "public/js/chat-owner.js.backup_${TIMESTAMP}"
echo "   ✅ public/js/chat-owner.js.backup_${TIMESTAMP}"

echo ""

# ============================================
# 🔧 CORRECTION 1: messages.html ligne 730
# ============================================

echo "🔧 Correction 1: messages.html (vérification abonnement)..."

# Chercher et remplacer
perl -i -pe '
if (/^\s*const data = await res\.json\(\);/ && !$done1) {
    $_ = "      // ⚡ Vérifier que c'\''est du JSON\n" .
         "      const contentType = res.headers.get('\''content-type'\'') || '\'''\'';\n" .
         "      if (!contentType.includes('\''application/json'\'')) {\n" .
         "        console.warn('\''⚠️ Subscription non-JSON'\'');\n" .
         "        return;\n" .
         "      }\n" .
         "\n" .
         "      const data = await res.json();\n";
    $done1 = 1;
}
' public/messages.html

echo "   ✅ messages.html corrigé"
echo ""

# ============================================
# 🔧 CORRECTION 2: chat-owner.js ligne 4
# ============================================

echo "🔧 Correction 2: chat-owner.js (API_URL)..."

# Remplacer window.location.origin par window.API_BASE || window.location.origin
perl -i -pe '
if (/^const API_URL = window\.location\.origin;/ && !$done2) {
    $_ = "// ⚡ iOS Fix: Utiliser l'\''API_BASE défini globalement\n" .
         "const API_URL = window.API_BASE || window.location.origin;\n" .
         "console.log('\''🔧 [CHAT-OWNER] API_URL:'\''", . " API_URL);\n";
    $done2 = 1;
}
' public/js/chat-owner.js

echo "   ✅ API_URL corrigé"
echo ""

# ============================================
# 🔧 CORRECTION 3: chat-owner.js ligne 72
# ============================================

echo "🔧 Correction 3: chat-owner.js (loadProperties ligne 72)..."

# Ajouter vérification avant le premier await response.json()
perl -i -0pe '
s/(if \(!response\.ok\) return;\s*\n\s*)(const data = await response\.json\(\);)/$1\/\/ ⚡ Vérifier que c'\''est du JSON\n    const contentType = response.headers.get('\''content-type'\'') || '\'''\'';\n    if (!contentType.includes('\''application\/json'\'')) {\n      console.warn('\''⚠️ Properties non-JSON'\'');\n      return;\n    }\n    \n    $2/
' public/js/chat-owner.js

echo "   ✅ loadProperties corrigé"
echo ""

# ============================================
# 🔧 CORRECTION 4: chat-owner.js ligne 112
# ============================================

echo "🔧 Correction 4: chat-owner.js (loadConversations ligne 112)..."

# Ajouter vérification avant le deuxième await response.json()
perl -i -0pe '
s/(if \(!response\.ok\) \{\s*throw new Error\([^\)]+\);\s*\}\s*\n\s*)(const data = await response\.json\(\);)/$1\/\/ ⚡ Vérifier que c'\''est du JSON\n    const contentType = response.headers.get('\''content-type'\'') || '\'''\'';\n    if (!contentType.includes('\''application\/json'\'')) {\n      console.error('\''❌ Conversations non-JSON'\'');\n      throw new Error('\''Réponse invalide'\'');\n    }\n    \n    $2/
' public/js/chat-owner.js

echo "   ✅ loadConversations corrigé"
echo ""

# ============================================
# ✅ Vérification
# ============================================

echo "🔍 Vérification des corrections..."
echo ""

# Vérifier messages.html
if grep -q "contentType.*content-type" public/messages.html; then
    echo "   ✅ messages.html: vérification content-type ajoutée"
else
    echo "   ⚠️  messages.html: vérification peut-être pas ajoutée correctement"
fi

# Vérifier chat-owner.js
COUNT=$(grep -c "contentType.*content-type" public/js/chat-owner.js || true)
if [ "$COUNT" -ge 2 ]; then
    echo "   ✅ chat-owner.js: $COUNT vérifications content-type ajoutées"
else
    echo "   ⚠️  chat-owner.js: seulement $COUNT vérification(s) trouvée(s), attendu 2+"
fi

# Vérifier API_URL
if grep -q "window.API_BASE" public/js/chat-owner.js; then
    echo "   ✅ chat-owner.js: API_URL corrigé"
else
    echo "   ⚠️  chat-owner.js: API_URL peut-être pas corrigé"
fi

echo ""

# ============================================
# 🚀 Prochaines étapes
# ============================================

echo "╔════════════════════════════════════════╗"
echo "║  ✅ CORRECTIONS APPLIQUÉES !          ║"
echo "╚════════════════════════════════════════╝"
echo ""
echo "📋 Prochaines étapes:"
echo ""
echo "1. Nettoyez et recopiez les fichiers iOS:"
echo "   rm -rf ios/App/App/public"
echo "   npx cap copy ios"
echo "   npx cap sync ios"
echo ""
echo "2. Ouvrez Xcode:"
echo "   npx cap open ios"
echo ""
echo "3. Dans Xcode:"
echo "   - Product > Clean Build Folder (⇧⌘K)"
echo "   - Supprimez l'app de l'iPhone"
echo "   - Product > Build (⌘B)"
echo "   - Lancez l'app"
echo ""
echo "4. Vérifiez dans Safari Inspector:"
echo "   Vous devriez voir: 🔧 [CHAT-OWNER] API_URL: https://..."
echo "   Et AUCUNE erreur sur les lignes 72, 112, 730"
echo ""
echo "💾 Sauvegardes créées:"
echo "   - public/messages.html.backup_${TIMESTAMP}"
echo "   - public/js/chat-owner.js.backup_${TIMESTAMP}"
echo ""
echo "🔄 Pour annuler les modifications:"
echo "   mv public/messages.html.backup_${TIMESTAMP} public/messages.html"
echo "   mv public/js/chat-owner.js.backup_${TIMESTAMP} public/js/chat-owner.js"
echo ""

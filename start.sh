#!/bin/bash

# Script de démarrage rapide pour LCC Booking Manager
# Usage: ./start.sh

clear
echo "╔════════════════════════════════════════════════════════╗"
echo "║   🏠 LCC Booking Manager - Installation & Démarrage   ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# Vérifier Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé"
    echo "📥 Installez Node.js depuis https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js $(node --version) détecté"
echo ""

# Vérifier si .env existe
if [ ! -f .env ]; then
    echo "⚠️  Fichier .env non trouvé"
    echo "📝 Création depuis .env.example..."
    cp .env.example .env
    echo ""
    echo "⚡ IMPORTANT: Éditez le fichier .env avec vos informations:"
    echo "   - URLs iCal de vos logements"
    echo "   - Configuration email pour les notifications"
    echo ""
    echo "Appuyez sur Entrée quand vous avez terminé..."
    read
fi

# Vérifier si node_modules existe
if [ ! -d node_modules ]; then
    echo "📦 Installation des dépendances..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "❌ Erreur lors de l'installation des dépendances"
        exit 1
    fi
    echo ""
    echo "✅ Dépendances installées avec succès"
    echo ""
fi

# Démarrer le serveur
echo "🚀 Démarrage du serveur..."
echo ""
echo "📍 L'application sera accessible sur: http://localhost:3000"
echo ""
echo "💡 Conseils:"
echo "   • Utilisez Ctrl+C pour arrêter le serveur"
echo "   • Les logs s'afficheront ci-dessous"
echo "   • La synchronisation iCal démarre automatiquement"
echo ""
echo "════════════════════════════════════════════════════════"
echo ""

node server.js

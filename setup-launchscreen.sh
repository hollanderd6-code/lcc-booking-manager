#!/bin/bash

# Script de configuration automatique du LaunchScreen iOS
echo "🚀 Configuration du LaunchScreen iOS..."

# Vérifier qu'on est à la racine du projet
if [ ! -f "package.json" ]; then
    echo "❌ Erreur : Exécute ce script depuis la racine du projet"
    exit 1
fi

# Vérifier que le dossier ios existe
if [ ! -d "ios/App/App" ]; then
    echo "❌ Erreur : Le dossier ios/App/App n'existe pas"
    echo "Lance d'abord : npx cap add ios"
    exit 1
fi

# Créer le dossier Base.lproj s'il n'existe pas
mkdir -p ios/App/App/Base.lproj

echo "📝 Création du LaunchScreen.storyboard..."

# Créer le LaunchScreen.storyboard
cat > ios/App/App/Base.lproj/LaunchScreen.storyboard << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="21701" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina6_1" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="21678"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <layoutGuides>
                        <viewControllerLayoutGuide type="top" id="Llm-lL-Icb"/>
                        <viewControllerLayoutGuide type="bottom" id="xb3-aO-Qok"/>
                    </layoutGuides>
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="414" height="896"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <label opaque="NO" userInteractionEnabled="NO" contentMode="left" horizontalHuggingPriority="251" verticalHuggingPriority="251" text="B" textAlignment="center" lineBreakMode="tailTruncation" baselineAdjustment="alignBaselines" adjustsFontSizeToFit="NO" translatesAutoresizingMaskIntoConstraints="NO" id="kId-c2-rCX">
                                <rect key="frame" x="157" y="348" width="100" height="200"/>
                                <constraints>
                                    <constraint firstAttribute="width" constant="100" id="Sy2-49-cer"/>
                                    <constraint firstAttribute="height" constant="200" id="rEL-Hq-u77"/>
                                </constraints>
                                <fontDescription key="fontDescription" type="boldSystem" pointSize="120"/>
                                <color key="textColor" red="1" green="1" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                                <nil key="highlightedColor"/>
                            </label>
                        </subviews>
                        <color key="backgroundColor" red="0.498" green="0.827" blue="0.651" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                        <constraints>
                            <constraint firstItem="kId-c2-rCX" firstAttribute="centerX" secondItem="Ze5-6b-2t3" secondAttribute="centerX" id="X09-AG-Ra9"/>
                            <constraint firstItem="kId-c2-rCX" firstAttribute="centerY" secondItem="Ze5-6b-2t3" secondAttribute="centerY" id="jzm-7Q-WCe"/>
                        </constraints>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="52" y="375"/>
        </scene>
    </scenes>
</document>
EOF

echo "✅ LaunchScreen.storyboard créé"

echo "📝 Vérification de Info.plist..."

# Vérifier si UILaunchStoryboardName existe dans Info.plist
if grep -q "UILaunchStoryboardName" ios/App/App/Info.plist; then
    echo "✅ UILaunchStoryboardName déjà configuré"
else
    echo "⚙️  Ajout de UILaunchStoryboardName dans Info.plist..."
    
    # Backup Info.plist
    cp ios/App/App/Info.plist ios/App/App/Info.plist.backup
    
    # Ajouter la clé avant le dernier </dict>
    perl -i -pe 's/(<\/dict>\s*<\/plist>)/\t<key>UILaunchStoryboardName<\/key>\n\t<string>LaunchScreen<\/string>\n$1/' ios/App/App/Info.plist
    
    echo "✅ UILaunchStoryboardName ajouté"
fi

echo ""
echo "🎉 Configuration terminée !"
echo ""
echo "📋 Prochaines étapes :"
echo "1. Nettoie le cache : rm -rf ~/Library/Developer/Xcode/DerivedData/*"
echo "2. Supprime l'app de l'iPhone/Simulateur"
echo "3. Ouvre Xcode : npx cap open ios"
echo "4. Product > Clean Build Folder (Cmd+Shift+K)"
echo "5. Product > Run"
echo ""
echo "✨ Ton LaunchScreen vert avec 'B' devrait maintenant s'afficher !"

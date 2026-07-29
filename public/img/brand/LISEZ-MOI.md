# Boostinghost — système de marque « Maison Vert »

Tous les tracés sont **vectorisés** (les lettres sont des chemins, pas du texte) :
les fichiers s'affichent à l'identique partout, sans dépendre d'une police installée.

## Arborescence à créer

```
public/img/brand/     ← ios/ android/ web/ verrou/ social/
public/css/bh-brand.css
```

## iOS

`ios/AppIcon-*.png` — carrés pleins, opaques, **sans coins arrondis et sans
transparence** : c'est la règle d'Apple, le système applique lui-même le masque.
Un coin arrondi dans le fichier produirait un liseré parasite après masquage.

Dans Xcode : glisser `AppIcon-1024.png` dans l'App Icon du catalogue d'assets
(Xcode 14+ ne demande plus que cette taille ; les autres sont fournies pour
Capacitor et les anciens projets).

## Web

```html
<link rel="icon" href="/img/brand/web/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/img/brand/web/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/img/brand/web/apple-touch-icon.png">
<link rel="manifest" href="/img/brand/web/manifest.webmanifest">
<meta name="theme-color" content="#0E3B2E">
<meta property="og:image" content="/img/brand/social/og-image.png">
```

`favicon.ico` est fourni pour les vieux navigateurs, à la racine du domaine.

## Verrous horizontaux (en-têtes)

| Fichier | Usage |
|---|---|
| `verrou-clair.svg` | en-tête sur fond crème, avec cartouche |
| `verrou-clair-simple.svg` | même chose sans cartouche |
| `verrou-fonce.svg` | sur fond vert bouteille |
| `verrou-*-compact.svg` | hauteur réduite, sans baseline — barres mobiles |

## Palette

| Rôle | Valeur | Usage |
|---|---|---|
| Marque | `#0E3B2E` | logo, en-têtes, aplats pleins |
| Interface | `#1E6E52` | boutons, liens, états actifs |
| Ivoire | `#F2EADA` | texte sur fond de marque |
| Fond | `#FBFBFA` | fond de page |
| Encre | `#20221F` | texte principal |
| BHGuest | `#B4470F` | sous-marque, ne change pas |

**Le point important** : l'ancien `#1A7A5E` servait à la fois de couleur de
marque et de couleur d'interface. Les deux sont désormais séparés. Le vert
bouteille est trop sombre pour un bouton de 12px ; le vert d'interface est trop
clair pour porter la marque. `bh-brand.css` fait la bascule automatiquement,
y compris pour les `#1A7A5E` posés en style inline.

## Ordre de chargement

```html
<link rel="stylesheet" href="/css/bh-theme-v3.css">
<link rel="stylesheet" href="/css/bh-brand.css">   <!-- ici -->
<link rel="stylesheet" href="/css/bh-lux.css">
<link rel="stylesheet" href="/css/bh-lux-app.css">
```

## Régénérer

`marque.py` reconstruit tout depuis les polices (Cormorant Garamond pour le B,
Marcellus pour le mot-symbole, Manrope pour la baseline). Modifier une taille ou
une couleur puis relancer `produire.py`.

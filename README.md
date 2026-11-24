# Retouche — toutes tes photos

Appli web installable (PWA), en français, de retouche photo non destructive en pleine résolution. Tout se calcule sur l'appareil (WebGL2) : aucune photo n'est envoyée nulle part.

## Mettre en ligne avec GitHub Pages (compte existant)
1. Crée un dépôt (ou utilise un dépôt existant) et copie-y le contenu de ce dossier à la racine.
2. Dépôt → Settings → Pages → Source : « Deploy from a branch », branche `main`, dossier `/ (root)`.
3. Ouvre `https://<ton-compte>.github.io/<depot>/` sur le téléphone, puis « Ajouter à l'écran d'accueil ».
Tous les chemins sont relatifs, l'appli fonctionne dans un sous-dossier.

## Fonctions
Réglages manuels (lumière, couleur, courbe + histogramme, détail, bruit), zones intelligentes (ciel / sujet / sol, pinceau, dégradés, baguette), sauvetage, scénario nuit (réduction du bruit, empilement de photos), agrandissement, avant/après, annuler/rétablir illimité, analyse automatique avec suggestions, mode apprentissage, journal, préréglages, lot, tri rapide, export PNG/TIFF/JPEG qualité max, formats Instagram/TikTok/YouTube, filigrane.

## Limites connues
- Les masques sont classiques (analyse de couleur et de régions), sans IA : ajuste avec pinceau ou baguette si besoin.
- Le décodage RAW (Canon CR2) n'a pas été testé sur un vrai fichier ; en cas d'échec, l'aperçu JPEG intégré est utilisé.
- L'agrandissement est un Lanczos de qualité, pas une IA : il n'invente aucun détail.
- TIFF en 8 bits ; JPEG/WebP encodés par le navigateur.
- Tout est traité sur l'appareil, pas de serveur : les très grandes photos sont limitées à 64 Mpx en sortie.

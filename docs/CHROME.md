# Publication Chrome (non répertoriée)

Build dédié Chrome, séparé de Firefox. Le code partagé vit à la racine ; seuls `manifest.chrome.json` et le script de build diffèrent.

## Build local

```bash
npm install
npm run build:chrome
```

Le zip est généré dans `web-ext-artifacts/pegass-extractor-chrome-{version}.zip`.

## Test dans Chrome

1. Ouvrir `chrome://extensions`.
2. Activer **Mode développeur**.
3. **Charger l'extension non empaquetée** → sélectionner le dossier `chrome-dist/` (créé par le build, à la racine du dépôt).
4. Se connecter à [Pegass](https://pegass.croix-rouge.fr) et tester le popup.

Pour retester après modification du code : relancer `npm run build:chrome`, puis cliquer sur **Recharger** dans `chrome://extensions`.

## Chrome Web Store (visibilité non répertoriée)

1. Créer un compte développeur (frais unique **5 USD**) : [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Nouvel élément** → téléverser le zip produit par `npm run build:chrome`.
3. Renseigner fiche, captures d'écran, **politique de confidentialité** (URL publique).
4. Onglet **Distribution** → visibilité **Non répertoriée** (*Unlisted*) : l'extension n'apparaît pas dans la recherche du store ; seules les personnes disposant du lien direct peuvent l'installer.
5. Soumettre pour review (délai variable, souvent quelques jours).

Conserver le lien d'installation fourni par le store pour le partage interne (UL, bénévoles).

### Mises à jour

Incrémenter `version` dans `manifest.json` (Firefox) et `manifest.chrome.json` (synchronisée automatiquement au build Chrome depuis `manifest.json`). Reconstruire, téléverser le nouveau zip dans le dashboard, republier.

## Icônes

Chrome affiche une icône générique si seuls des SVG sont déclarés. Le manifest Chrome référence des **PNG** (`icons/icon-16.png` … `icon-128.png`), générés depuis `icon-96.svg` :

```bash
./scripts/generate-icons.sh
```

## Fichiers spécifiques Chrome

| Fichier | Rôle |
|---------|------|
| `manifest.chrome.json` | Manifest MV3 avec `service_worker` et icônes PNG |
| `lib/browser-shim.js` | Shim `browser` pour content scripts et popup |
| `lib/browser-shim.mjs` | Shim `browser` pour le service worker (module) |
| `scripts/build-chrome.mjs` | Assemble `chrome-dist/` et le zip CWS |

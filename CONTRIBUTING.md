# Pegass Extractor - Documentation Développeur

Ce document est destiné aux personnes souhaitant contribuer au projet, comprendre son architecture ou automatiser sa publication.

## Architecture du projet

L'extension est construite en JavaScript pur (Vanilla JS) en utilisant l'API **WebExtensions** (Manifest V3).

```
.
├── manifest.json         # Manifest Firefox (MV3)
├── manifest.chrome.json  # Manifest Chrome (service worker)
├── package.json          # Scripts de build/lint (web-ext)
├── scripts/build-chrome.mjs
├── docs/CHROME.md        # Publication Chrome Web Store (non répertoriée)
├── lib/                  # Shim browser.* pour Chromium
├── popup/
│   ├── popup.html        # Interface utilisateur
│   ├── popup.css         # Styles (thème Croix-Rouge)
│   └── popup.js          # Logique du popup (communication avec le scraper)
├── content/
│   └── scraper.js        # Script d'extraction via API Pegass (exécuté dans l'onglet)
├── background/
│   └── background.js     # Service worker (gestion du cycle de vie)
└── icons/                # Assets graphiques
```

## Installation pour le développement

1. Clonez le dépôt.
2. Installez les outils de développement :
   ```bash
   npm install
   ```
3. Chargez l'extension dans Firefox pour le test :
   - Ouvrez `about:debugging`.
   - Cliquez sur **"Ce Firefox"**.
   - Cliquez sur **"Charger un module temporaire..."** et sélectionnez le fichier `manifest.json`.

### Commandes utiles

| Commande | Description |
|----------|-------------|
| `npm run lint` | Valide le code et le manifest via `web-ext`. |
| `npm run build` | Génère un `.zip` Firefox prêt pour la release. |
| `npm run build:chrome` | Génère `chrome-dist/` et un `.zip` pour le Chrome Web Store. |
| `npm run start` | Lance une instance Firefox isolée avec l'extension chargée. |
| `npm run sign` | Signe l'extension (nécessite les clés AMO). |

## Fonctionnement technique du Scraper

Le fichier `content/scraper.js` interagit directement avec les endpoints REST de Pegass :

- `/crf/rest/utilisateur` : Récupère les infos de l'utilisateur connecté (dont son `structure.id`).
- `/crf/rest/activite` : Liste les activités d'une structure sur une période.
- `/crf/rest/seance/{id}/inscription` : Liste les inscrits à une séance spécifique.
- `/crf/rest/utilisateur/{id}/seance` : Récupère le planning complet d'un utilisateur spécifique.

### Délais et Rate-limit
Pour éviter de surcharger les serveurs de la Croix-Rouge, le scraper applique un délai (`REQUEST_DELAY = 300ms`) entre chaque requête.

## Signature et Publication

### Automatisation GitHub Actions

Le projet utilise GitHub Actions pour automatiser les releases. Le fichier `.github/workflows/release.yml` s'exécute lors de la création d'un tag `v*`.

Si les secrets `AMO_JWT_ISSUER` et `AMO_JWT_SECRET` sont configurés dans les paramètres du dépôt GitHub, l'extension est automatiquement signée (format `.xpi`). Sinon, seul le `.zip` non signé est généré.

### Versions Alpha (CI)

Pour tester les derniers changements sans créer de tag de version, un workflow `.github/workflows/alpha.yml` s'exécute à chaque push sur la branche `main`.

1. Il génère une version dynamique (ex: `1.0.0.42`) pour satisfaire les exigences de version unique de Mozilla.
2. Il tente de signer l'extension.
3. Il publie le résultat dans les **Artifacts** du run GitHub Action (onglet "Actions").

C'est le moyen idéal pour distribuer une version signée "de travail" aux bêta-testeurs.

### Publication manuelle
Pour générer une version signée localement :
```bash
export AMO_JWT_ISSUER="votre_cle"
export AMO_JWT_SECRET="votre_secret"
npm run sign
```

### Chrome (non répertorié)

Voir [docs/CHROME.md](docs/CHROME.md) : build `npm run build:chrome`, test via `chrome-dist/`, publication CWS en visibilité **Non répertoriée** (frais développeur unique 5 USD).

## Permissions utilisées

- `activeTab` : Pour injecter le scraper uniquement quand l'utilisateur clique sur l'icône.
- `storage` : Pour mémoriser les réglages de l'utilisateur.
- `downloads` : Pour générer et proposer le téléchargement du fichier JSON/CSV.
- `host_permissions` : Limité strictement à `https://pegass.croix-rouge.fr/*`.

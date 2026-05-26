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
├── lib/
│   ├── browser-shim.mjs  # Shim browser.* pour Chromium
│   └── extraction-core.mjs  # Agrégation / événements (partagé, testé en Node)
├── test/                 # Tests unitaires (node:test)
├── popup/
│   ├── popup.html        # Interface utilisateur
│   ├── popup.css         # Styles (thème Croix-Rouge)
│   └── popup.js          # Logique du popup (communication avec le scraper)
├── content/
│   └── scraper.js        # Script d'extraction via API Pegass (exécuté dans l'onglet)
├── background/
│   └── background.js     # Service worker (gestion du cycle de vie)
├── exemple_extraction.json  # Exemple de sortie JSON (référence schéma)
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
| `npm test` | Lance les tests unitaires (`node --test`). |
| `npm run lint` | Valide le code et le manifest via `web-ext`. |
| `npm run build` | Génère un `.zip` Firefox prêt pour la release. |
| `npm run build:chrome` | Génère `chrome-dist/` et un `.zip` pour le Chrome Web Store. |
| `npm run start` | Lance une instance Firefox isolée avec l'extension chargée. |
| `npm run sign` | Signe l'extension (nécessite les clés AMO). |

## Fonctionnement technique du Scraper

Le fichier `content/scraper.js` interagit directement avec les endpoints REST de Pegass :

- `/crf/rest/utilisateur` : Récupère les infos de l'utilisateur connecté (dont son `structure.id`).
- `/crf/rest/activite` : Liste les activités d'une structure sur une période (source des **événements** via `seanceList`).
- `/crf/rest/seance/{id}/inscription` : Liste les inscrits à une séance spécifique (source des **missions** bénévoles).
- `/crf/rest/utilisateur/seance` : Récupère le planning complet d'un utilisateur (modes bénévole / hybride).

L'endpoint UI `/donnees-activite/{id}` (indicateurs, validation) **n'est pas utilisé** par l'extracteur.

### Délais et Rate-limit
Pour éviter de surcharger les serveurs de la Croix-Rouge, le scraper applique un délai (`REQUEST_DELAY = 300ms`) entre chaque requête.

### Schéma de sortie JSON

Référence : [`exemple_extraction.json`](exemple_extraction.json).

```
{
  metadata: { date_extraction, unite_locale, structure_id, mode, periode, config_snapshot, version },
  benevoles: [ { id, nom, prenom, heures, missions[], inscriptions_count, renfort? } ],
  evenements: [ { id, activiteId, nom, statut, type, groupeAction, date, debut, fin, heures, ... } ],
  stats: { total_benevoles, total_heures, heures_locales, heures_externes, total_missions, total_evenements, evenements_sans_inscription }
}
```

**Construction des données :**

1. `fetchActivites(debut, fin, structureId)` → liste d'activités.
2. Pour chaque séance dans `activite.seanceList`, `buildEvenementsFromActivites()` produit une entrée `evenements[]` (statut = `activite.statut`, `inscriptions_count` rempli après l'étape suivante).
3. `fetchAllInscriptions()` interroge chaque séance et alimente `benevoles[].missions` via `aggregateDataFromInscriptions()` (ou équivalents selon le mode).
4. Les séances sans inscription REST (`[]`) apparaissent dans `evenements` avec `sans_inscription: true` mais n'ont pas de mission associée.

La fusion incrémentale (`mergeExtractionData` dans `lib/extraction-core.mjs`, appelée par `background/background.js`) dédoublonne les événements par `evenements[].id` (id de séance).

### Tests

```bash
npm test
```

Les tests couvrent notamment `buildEvenementsFromActivites` (gardes annulées sans inscription), `aggregateDataFromInscriptions` et `mergeExtractionData`. Le fichier `test/fixtures/castor-annule.json` reprend le cas Castor.

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

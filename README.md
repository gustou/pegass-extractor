# Pegass Extractor - Extension Firefox

Extension Firefox pour extraire les statistiques des bénévoles depuis Pegass.

## Installation (utilisateurs)

### Méthode recommandée : télécharger le `.zip` depuis les Releases

1. Allez sur la page **[Releases](../../releases)** du dépôt et téléchargez le fichier `pegass-extractor-X.Y.Z.zip` de la dernière version.
2. Ouvrez Firefox et allez à `about:debugging`.
3. Cliquez sur **"Ce Firefox"** dans le menu de gauche.
4. Cliquez sur **"Charger un module temporaire..."** et sélectionnez le `.zip` téléchargé (ou son `manifest.json` une fois le zip extrait).

> Note : un module temporaire est désinstallé à la fermeture de Firefox. Pour une installation persistante non signée, utilisez **Firefox Developer Edition**, **Nightly** ou **ESR** avec `xpinstall.signatures.required` à `false` dans `about:config`. Firefox release refuse les extensions non signées en permanent.

### Méthode développeur : charger directement le dossier source

1. Clonez le dépôt.
2. Ouvrez Firefox et allez à `about:debugging`.
3. Cliquez sur **"Ce Firefox"** puis **"Charger un module temporaire..."**.
4. Sélectionnez le fichier `manifest.json` à la racine du dépôt.

## Utilisation

1. Connectez-vous à [Pegass](https://pegass.croix-rouge.fr)
2. Cliquez sur l'icône de l'extension (croix rouge)
3. Sélectionnez la période d'extraction
4. Cliquez sur **"Lancer l'extraction"**
5. Téléchargez le fichier JSON

### Que faire du JSON

Glissez-le dans [**Pegass Dashboard**](https://github.com/gustou/pegass-dashboard) pour visualiser les statistiques (graphiques, top 10, export Excel/CSV).

## Structure

```
.
├── manifest.json         # Configuration Manifest V3
├── package.json          # Scripts de build/lint (web-ext)
├── popup/
│   ├── popup.html        # Interface utilisateur
│   ├── popup.css         # Styles (thème Croix-Rouge)
│   └── popup.js          # Logique du popup
├── content/
│   └── scraper.js        # Script d'extraction via API Pegass
├── background/
│   └── background.js     # Service worker
├── icons/
│   ├── icon-48.svg
│   └── icon-96.svg
└── .github/workflows/
    └── release.yml       # Build + release du .zip sur tag v*
```

## Développement et packaging

L'extension utilise [`web-ext`](https://github.com/mozilla/web-ext) (outil officiel Mozilla) pour le lint et la création du paquet.

### Pré-requis

- Node.js 20+ et npm
- Installer les dépendances : `npm install`

### Commandes disponibles

| Commande | Description |
|----------|-------------|
| `npm run lint` | Valide `manifest.json` et signale les problèmes courants (permissions inutilisées, etc.) |
| `npm run build` | Crée `web-ext-artifacts/pegass-extractor-<version>.zip` |
| `npm run start` | Lance une instance de Firefox avec l'extension préchargée (rechargement automatique au changement de fichier) |

### Publier une nouvelle version

1. Mettez à jour le champ `version` dans [`manifest.json`](manifest.json) **et** dans [`package.json`](package.json) (utilisez la même valeur).
2. Commitez ces changements.
3. Créez et poussez un tag `v<version>` :

   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

4. Le workflow GitHub Actions [`release.yml`](.github/workflows/release.yml) :
   - vérifie que la version du tag correspond à celle du `manifest.json`,
   - exécute `web-ext lint`,
   - construit le `.zip`,
   - publie une **Release GitHub** avec le `.zip` en pièce jointe et des notes générées automatiquement.

Le workflow peut aussi être lancé manuellement via l'onglet *Actions* (déclencheur `workflow_dispatch`) pour produire un artefact de build sans créer de release.

## API Pegass utilisées

| Endpoint | Usage |
|----------|-------|
| `/crf/rest/utilisateur` | Vérification connexion |
| `/crf/rest/activite` | Liste des activités |
| `/crf/rest/seance/{id}/inscription` | Inscriptions |
| `/crf/rest/utilisateur/{id}` | Détails bénévole |

## Permissions

- `activeTab` : Accès à l'onglet actif
- `storage` : Stockage local des paramètres
- `host_permissions` : Accès à pegass.croix-rouge.fr

## Configuration

Pour changer l'ID de structure par défaut, éditez `content/scraper.js` :

```javascript
const STRUCTURE_ID = '1160'; // Votre ID de structure
```

## Dépannage

### "Non connecté à Pegass"
- Vérifiez que vous êtes sur pegass.croix-rouge.fr
- Vérifiez que vous êtes authentifié
- Rechargez l'extension dans about:debugging

### Extraction lente
- Normal : l'extension respecte un délai entre les requêtes
- Attendez la fin de la progression

### Erreur de téléchargement
- Vérifiez les popups ne sont pas bloqués
- Rechargez l'extension et réessayez

## Licence

[MIT](LICENSE).

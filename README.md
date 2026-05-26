# Pegass Extractor

Extension navigateur (Firefox et Chrome) pour extraire les statistiques des bénévoles depuis Pegass et les visualiser dans votre tableau de bord.

## 🚀 Installation rapide

### 1. Téléchargement
Allez sur la page **[Releases](../../releases)** et téléchargez la dernière version :
- **Firefox** — fichier `.xpi` (signé, installation permanente) ou `.zip` (temporaire).
- **Chrome** — fichier `pegass-extractor-chrome-*.zip` ou lien **non répertorié** du Chrome Web Store (une fois publié).

### 2. Installation dans Firefox
1. Ouvrez Firefox et allez à l'adresse `about:debugging#/runtime/this-firefox`.
2. Cliquez sur **"Charger un module temporaire..."**.
3. Sélectionnez le fichier téléchargé.

*Note : Pour une installation permanente sans passer par le store officiel, consultez la section dédiée dans la documentation développeur.*

### 3. Installation dans Chrome
Installez via le lien fourni par votre UL (extension **non répertoriée** sur le Chrome Web Store), ou en développement : `npm run build:chrome` puis chargez le dossier `chrome-dist/` dans `chrome://extensions` (mode développeur). Détails : [docs/CHROME.md](docs/CHROME.md).

---

## 🛠️ Comment ça marche ?

1. Connectez-vous à votre compte [Pegass](https://pegass.croix-rouge.fr).
2. Cliquez sur l'icône de l'extension (Croix-Rouge) dans votre barre d'outils.
3. Choisissez vos dates et le **mode d'extraction** souhaité.
4. Cliquez sur **Lancer l'extraction**.
5. Une fois terminé, téléchargez le fichier JSON.
6. Glissez ce fichier dans votre [**Pegass Dashboard**](https://github.com/gustou/pegass-dashboard) pour voir vos graphiques et exports Excel.

Un fichier d'exemple complet est disponible : [`exemple_extraction.json`](exemple_extraction.json).

---

## 📦 Format du fichier JSON (v1.3+)

Le export contient trois blocs principaux :

| Bloc | Contenu |
| :--- | :--- |
| `metadata` | Date d'extraction, UL, période, mode, version |
| `benevoles` | Heures et **missions** (présences issues des inscriptions Pegass) |
| `evenements` | **Toutes les séances** de votre UL sur la période, avec ou sans inscrits |
| `stats` | Totaux agrégés (bénévoles, heures, missions, événements) |

### Missions vs événements

- **`benevoles[].missions`** : une ligne par **inscription** (bénévole × séance). Si Pegass ne renvoie plus d'inscrits (ex. garde annulée), il n'y a pas de mission.
- **`evenements`** : une ligne par **séance** listée dans l'API activités (`seanceList`), y compris sans inscription. Le champ `statut` reprend celui de l'activité Pegass (ex. `"Annulée"`, `"Validée"`). `sans_inscription: true` indique qu'aucun inscrit n'a été trouvé sur `/seance/{id}/inscription`.

Exemple d'événement annulé sans inscrits (voir aussi `exemple_extraction.json`) :

```json
{
  "id": "p3235003",
  "activiteId": "p3235167",
  "nom": "02-CASTOR",
  "statut": "Annulée",
  "inscriptions_count": 0,
  "sans_inscription": true
}
```

---

## 📊 Comprendre les modes d'extraction

L'outil propose trois méthodes pour récupérer les données, selon vos besoins :

| Mode | Description | Idéal pour... |
| :--- | :--- | :--- |
| **Par Structure** | Scanne toutes les activités créées par votre UL. | Comptabiliser l'activité réelle de votre structure, y compris les renforts venus d'ailleurs. |
| **Par Bénévole** | Scanne le planning individuel de chacun de vos bénévoles. | Voir l'activité complète de vos membres, même quand ils vont aider dans d'autres UL. |
| **Hybride** | Combine les deux méthodes ci-dessus. | Avoir une vision à 360° : l'activité totale de vos membres + l'aide apportée par les externes. |

> **Attention :** En raison des restrictions de sécurité de Pegass, il est impossible de lire le planning complet d'un bénévole qui n'appartient pas à votre structure. Le mode Hybride gère cela intelligemment en ne scannant le planning que pour vos membres locaux.

---

## ❓ FAQ / Dépannage

### "Ce module n'a pas pu être installé car il n'a pas été vérifié"
C'est une sécurité de Firefox pour les extensions hors store. Utilisez impérativement la page `about:debugging` pour charger le module temporairement. Pour une installation définitive, référez-vous au fichier `CONTRIBUTING.md`.

### Pourquoi l'extraction est-elle un peu lente ?
L'extension imite un comportement humain pour ne pas être bloquée par les serveurs de la Croix-Rouge. Elle attend environ 0.3 seconde entre chaque requête. Pour une UL de 100 bénévoles sur un an, cela peut prendre 1 à 2 minutes.

### Mes renforts externes n'ont pas toutes leurs heures, pourquoi ?
C'est normal. L'API Pegass nous interdit de voir ce qu'un bénévole externe fait en dehors de votre propre structure. Vous ne verrez donc que les heures qu'il a effectuées chez vous.

### Mes données sont-elles sécurisées ?
Oui. L'extraction se fait entièrement localement sur votre ordinateur. Aucune donnée n'est envoyée vers un serveur externe. Le fichier JSON généré reste sur votre machine.

### Puis-je exporter vers Excel ?
L'extension génère un fichier JSON optimisé pour le [Pegass Dashboard](https://github.com/gustou/pegass-dashboard). C'est depuis ce tableau de bord que vous pourrez exporter vos données proprement vers Excel ou CSV.

### Pourquoi une activité annulée n'apparaît pas dans les missions ?
Les **missions** ne reflètent que les inscriptions encore exposées par Pegass. Une garde annulée avec `/seance/.../inscription` vide n'y figure pas. Depuis la v1.3, consultez le tableau **`evenements`** du JSON : toutes les séances de l'UL y sont listées avec le `statut` de l'activité.

### Le CSV contient-il les événements ?
Non. Le téléchargement CSV résume les **bénévoles** (totaux et nombre de missions). Pour les événements, utilisez le format **JSON**.

---

## ✍️ Crédits

Outil développé avec ❤️ par **Augustin** pour l'**Unité Locale de Clamart** (Croix-Rouge française).

## 📄 Licence

Ce projet est sous licence [MIT](LICENSE).
Documentation technique pour les développeurs : [CONTRIBUTING.md](CONTRIBUTING.md) (`npm test` pour les tests unitaires).

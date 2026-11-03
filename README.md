# Assistant 471 – Cabinet DG (Node.js)

Site web interne qui, pour un dossier Pennylane choisi :

1. lit les opérations **non lettrées** des comptes **4716 / 4717**,
2. les présente en **Dépenses / Recettes** (débit du 471 = dépense, crédit = recette),
3. génère le **brouillon de mail (.eml)** avec le tableau Excel à compléter en pièce jointe.

Le .eml s'ouvre dans Outlook comme un nouveau message prêt à envoyer.

---

## 1. Mettre le code sur GitHub

1. Sur github.com, créez un dépôt **privé** (par ex. `assistant-471`).
2. Cliquez sur **uploading an existing file** et glissez-y **le contenu** du dossier décompressé : `src`, `views`, `test`, `package.json`, `package-lock.json`, `render.yaml`, `README.md` et `.gitignore`.
3. Validez avec **Commit changes**.

> Ne déposez jamais le jeton Pennylane ni un mot de passe dans GitHub. Ils se saisissent uniquement dans Render (étape 3).

## 2. Créer le jeton Pennylane

Dans Pennylane, allez dans **Paramètres du cabinet > Jetons du cabinet > Générer un jeton API**.

- Permissions, en **lecture seule** : `companies:readonly`, `ledger_accounts:readonly`, `ledger_entries:readonly`
- Une date d'expiration, par exemple 1 an. Notez-la pour le renouveler à temps.

Le jeton ne s'affiche qu'une fois : copiez-le tout de suite.

## 3. Mettre le site en ligne sur Render

1. Créez un compte sur **render.com**, puis connectez votre compte GitHub.
2. Cliquez sur **New > Blueprint** et choisissez le dépôt `assistant-471`. Render lit le fichier `render.yaml`, qui prévoit un serveur à Francfort, dans l'UE.
3. Render demande deux valeurs secrètes :
   - `PENNYLANE_TOKEN` : le jeton de l'étape 2
   - `APP_PASSWORD` : un mot de passe solide pour accéder au site, à partager avec l'équipe
4. Cliquez sur **Apply**. Après 2 à 3 minutes, le site est disponible à une adresse du type `https://assistant-471.onrender.com`.

Le `render.yaml` prévoit l'offre *Starter*, qui est payante mais reste toujours allumée. Pour un simple essai, vous pouvez remplacer `plan: starter` par `plan: free` : le site se met alors en veille après 15 minutes et met environ 30 secondes à se réveiller.

Variables facultatives, modifiables dans Render > Environment :

| Variable | Rôle |
|---|---|
| `CABINET_SIGNATURE` | Signature du mail (`\n` = retour à la ligne) |
| `CABINET_EXPEDITEUR` | Adresse « De » pré-remplie dans le brouillon |
| `SEUIL` | Ignore les montants inférieurs à cette valeur |
| `DEMO` | `1` = données fictives, sans appel à Pennylane |

## 4. Utilisation

1. Connectez-vous avec le mot de passe.
2. **Choisissez le dossier** : la liste vient de Pennylane. Tapez le nom ou le code client pour filtrer, puis cliquez sur le dossier (ou appuyez sur Entrée).
3. Si besoin, réglez une période, puis vérifiez les opérations affichées.
4. Saisissez le destinataire, ajustez le texte si besoin, puis cliquez sur **Télécharger le mail (.eml)**.
5. Ouvrez le .eml dans Outlook, relisez-le et envoyez-le.

## Essai sur un poste (facultatif)

Il faut Node.js 20 ou plus récent.

```bash
npm install
npm test                                     # tests automatiques
DEMO=1 npm start                             # http://localhost:8000, mot de passe « demo »
# Windows PowerShell : $env:DEMO="1"; npm start
```

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/server.js` | Site web (Express) : connexion, pages, téléchargements |
| `src/pennylane.js` | Appels à l'API Pennylane, et les données de démonstration |
| `src/retraitement.js` | Filtre des lignes non lettrées et sens Dépense / Recette |
| `src/documents.js` | Génération de l'Excel client et du brouillon .eml |
| `views/` | Pages HTML (modèles EJS) |

## Sécurité

- Le jeton Pennylane reste côté serveur. Il n'est jamais envoyé au navigateur ni stocké dans GitHub.
- L'accès au site est protégé par mot de passe, avec des sessions de 8 heures et une protection CSRF sur les téléchargements.
- Rien n'est conservé sur le serveur : les fichiers sont générés à la demande puis oubliés.
- Le jeton est en lecture seule : le site ne peut rien modifier dans Pennylane.

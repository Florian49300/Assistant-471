# Activer la connexion Microsoft 365 – Assistant 471

Une fois la connexion activée, chaque collaborateur se connecte avec **son propre compte Microsoft du cabinet** (adresse @cabinet-dg.fr).
Le mot de passe commun est alors désactivé automatiquement.

**Durée** : environ 15 minutes.
**Prérequis** : un compte **administrateur Microsoft 365** du cabinet. Il faut au minimum le rôle « Administrateur d'applications » ou « Administrateur général ».

---

## Étape 1 – Enregistrer l'application dans Microsoft Entra

1. Ouvrez **https://entra.microsoft.com** et connectez-vous avec le compte administrateur.
2. Dans le menu, allez dans **Identité > Applications > Inscriptions d'applications**, puis cliquez sur **+ Nouvelle inscription**.
3. Remplissez le formulaire :
   - **Nom** : `Assistant 471`
   - **Types de comptes pris en charge** : *Comptes dans cet annuaire d'organisation uniquement (locataire unique)*
   - **URI de redirection** : choisissez **Web**, puis saisissez
     `https://assistant-471.onrender.com/auth/callback`
4. Cliquez sur **S'inscrire**.

Sur la page qui s'affiche (*Vue d'ensemble*), **notez ces deux valeurs** :

| Dans Entra | Variable Render |
|---|---|
| ID d'application (client) | `AZURE_CLIENT_ID` |
| ID de l'annuaire (locataire) | `AZURE_TENANT_ID` |

## Étape 2 – Créer le secret client

1. Dans le menu de l'application, allez dans **Certificats et secrets > Secrets client**, puis cliquez sur **+ Nouveau secret client**.
2. Renseignez le secret :
   - **Description** : `Render`
   - **Expiration** : 24 mois
3. Cliquez sur **Ajouter**, puis **copiez tout de suite la colonne « Valeur »** (et non « ID de secret »). Elle ne sera plus visible ensuite.
   - Cette valeur va dans la variable `AZURE_CLIENT_SECRET`.
4. **Notez la date d'expiration dans votre agenda.** Il faudra recréer un secret avant cette date (voir l'étape 6).

## Étape 3 – Permissions

1. Allez dans **Autorisations de l'API**. L'autorisation *Microsoft Graph > User.Read* est déjà présente.
2. Cliquez sur **+ Ajouter une autorisation**, puis **Microsoft Graph > Autorisations déléguées**. Cochez **openid**, **profile** et **email**, puis cliquez sur **Ajouter des autorisations**.
3. Cliquez sur **Accorder un consentement d'administrateur pour Cabinet-DG**, puis confirmez.

## Étape 4 – Choisir qui a accès

Par défaut, tous les comptes du cabinet pourraient se connecter. Pour limiter l'accès aux personnes choisies :

1. Allez dans **Identité > Applications > Applications d'entreprise**, puis ouvrez **Assistant 471**.
2. Dans **Propriétés**, mettez **Affectation requise ?** sur **Oui**, puis cliquez sur **Enregistrer**.
3. Dans **Utilisateurs et groupes**, cliquez sur **+ Ajouter un utilisateur/groupe** et ajoutez les collaborateurs concernés.
   L'ajout d'un groupe entier nécessite une licence Entra ID P1, incluse par exemple dans Microsoft 365 Business Premium. Sinon, ajoutez les personnes une par une.

Une personne non ajoutée voit le message « Votre compte Microsoft n'est pas autorisé à utiliser l'Assistant 471 ».

## Étape 5 – Configurer Render

Dans Render, ouvrez le service **assistant-471**, allez dans **Environment** et ajoutez ces variables :

| Clé | Valeur |
|---|---|
| `AZURE_TENANT_ID` | ID de l'annuaire (étape 1) |
| `AZURE_CLIENT_ID` | ID d'application (étape 1) |
| `AZURE_CLIENT_SECRET` | valeur du secret (étape 2) |
| `APP_BASE_URL` | `https://assistant-471.onrender.com` |
| `ALLOWED_DOMAINS` | `cabinet-dg.fr` (plusieurs domaines possibles, séparés par des virgules) |

Cliquez ensuite sur **Save, rebuild and deploy**.

Pour vérifier que la configuration est prise en compte, ouvrez les **Logs** : au démarrage, la ligne `Connexion : comptes Microsoft 365` doit apparaître.
Une fois que tout fonctionne, vous pouvez supprimer la variable `APP_PASSWORD`, qui ne sert plus.

## Étape 6 – Au quotidien

- **Ajouter ou retirer quelqu'un** : allez dans Entra > Applications d'entreprise > Assistant 471 > Utilisateurs et groupes.
  Un collaborateur dont le compte Microsoft est désactivé perd aussi l'accès au site.
- **Savoir qui a fait quoi** : dans Render > Logs, cherchez `journal`. Chaque connexion, consultation de dossier et téléchargement de mail ou d'Excel y figure, avec l'adresse de la personne.
  Render ne garde ces logs que quelques jours sur l'offre gratuite.
- **Renouveler le secret** avant son expiration :
  1. Dans Entra > Inscriptions d'applications > Assistant 471 > Certificats et secrets, créez un **nouveau** secret.
  2. Collez sa valeur dans `AZURE_CLIENT_SECRET` sur Render, puis redéployez.
  3. Supprimez l'ancien secret.
  Si le secret expire, la connexion affiche « Le secret client Microsoft est invalide ou expiré ».
- **Si l'adresse du site change** (nom de domaine personnalisé, par exemple) : mettez à jour l'URI de redirection dans Entra **et** la variable `APP_BASE_URL`.

## En cas de problème

| Message | Cause probable |
|---|---|
| « n'est pas autorisé à utiliser l'Assistant 471 » | la personne n'est pas ajoutée à l'étape 4 |
| « n'est pas une adresse autorisée » | le compte n'est pas en @cabinet-dg.fr : vérifiez `ALLOWED_DOMAINS` |
| « pas encore été approuvée par l'administrateur » | le consentement administrateur de l'étape 3 n'a pas été donné |
| Erreur Microsoft AADSTS50011 (redirect URI) | l'URI de redirection dans Entra ne correspond pas exactement à `APP_BASE_URL` + `/auth/callback` |
| « secret client invalide ou expiré » | renouvelez le secret (étape 6) |
| La page de connexion demande encore un mot de passe | une des 4 variables Azure ou `APP_BASE_URL` manque dans Render |

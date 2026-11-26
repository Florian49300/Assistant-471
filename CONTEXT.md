# Contexte du projet – Assistant 471 (Cabinet DG)

> Ce fichier résume le projet pour toute personne (ou assistant IA) qui reprend le travail.
> Il est à tenir à jour à chaque évolution importante.

## 1. Objectif

Le Cabinet DG est un cabinet d'expertise comptable qui tient les dossiers de ses clients dans **Pennylane**.
Les opérations bancaires sans justificatif sont passées sur les comptes d'attente **4716** et **4717**, avec des sous-comptes possibles (47160000, 47160001, 47170000…).

L'**Assistant 471** est un site web interne qui, pour un dossier client :

1. lit dans Pennylane les lignes **non lettrées** des comptes 4716* et 4717* ;
2. les présente au client en **Dépenses / Recettes**, sans vocabulaire comptable (pas de débit ni de crédit) ;
3. génère **deux Excel** à compléter par le client, l'un pour les Dépenses et l'autre pour les Recettes ;
4. prépare un **brouillon de mail .eml en HTML**, avec les deux Excel en pièces jointes, que le collaborateur ouvre dans Outlook, signe et envoie.

Depuis la V5, le site est un **portail multi-outils**, « Mes outils de gestion ».

- Il reprend la charte de l'espace « Pôle social » réalisé par une collaboratrice : logos Durand Godeau / Agora Experts / Cohortis Alliance, vert `#6ebc5a` / `#345829`, polices Sora et DM Sans, accueil en « livret » avec tuiles.
- Briques en service : **Assistant 471** (`/471`), **TVS 2026** (`/tvs`) et **Import caisse** (`/caisse`, ex-Pennylane DG). D'autres suivront.
- Toutes les briques partagent la connexion Microsoft 365, le journal d'activité et l'habillage.

## 2. Règles métier (Assistant 471)

| Règle | Détail |
|---|---|
| Comptes lus | tous les comptes dont le numéro commence par `4716` ou `4717` (filtre `start_with`) |
| Lignes retenues | seulement les lignes **non lettrées**. Une ligne est lettrée si `lettered_ledger_entry_lines.ids` contient un autre id que le sien |
| Dépense / Recette | selon le **sens de l'opération**, pas selon le compte : débit du 471 = **Dépense** (argent sorti de la banque), crédit = **Recette** (argent reçu). Un crédit sur un 4716 va donc en Recettes |
| Consolidation | tous les sous-comptes 4716* et 4717* sont regroupés dans le tableau Dépenses et le tableau Recettes |
| Libellé | souvent vide sur la ligne 471. Il est complété dans cet ordre : libellé de l'écriture (`ledger_entries.label`), puis libellé d'une autre ligne de la même écriture (en général la 512) |
| Seuil | variable `SEUIL` en euros : les montants inférieurs sont ignorés (0 par défaut) |
| Période | facultative, avec les champs Du / Au sur la page du dossier |
| Montants | traités en **centimes entiers** pour éviter les erreurs d'arrondi |

## 2 bis. Brique TVS 2026 (`/tvs`)

Cette brique vérifie le montant des taxes sur l'affectation des véhicules de tourisme dû pour **2026**, c'est-à-dire la taxe CO₂ et la taxe polluants, puis le compare au montant déclaré par le client (3310-A-SD / 3517).
La référence complète est **`docs/TVS_2026_contexte.md`** : barèmes, algorithme, cas de test et hors champ.

**Fonctionnement**

- **Calcul** : il est fait **dans le navigateur** par `public/tvs/calcul.js`. C'est exactement le même fichier qui est testé côté serveur dans `test/tvs.test.js`, avec les 8 cas de référence du contexte.
- **Données** : aucune donnée de parc n'est envoyée ni stockée sur le serveur.
  - Le parc est enregistré et rouvert en **fichier JSON**, au format du contexte §8, avec un champ `client` en plus.
  - Il s'exporte en **CSV** (séparateur `;`, UTF-8 avec BOM).
  - Un **brouillon** est gardé automatiquement dans le navigateur du poste (localStorage).
- **Journal** : le serveur ne reçoit qu'une trace d'activité (consultation, export_csv, enregistrer_json, ouvrir_json), avec le nom du client saisi et le nombre de véhicules.

**Saisie**

- Par véhicule : immatriculation, 1re immatriculation, énergie, barème (automatique ou forcé), CO₂ ou CV, norme Euro, périodes d'affectation, exonérations et montant déclaré.
- Pour tout le parc : le nom du client et le **mode tarif polluants**.
  - `annuel` (par défaut) : tarif 2026 sur toute l'année.
  - `mars` : ancien tarif jusqu'au 28/02, puis tarif 2026. C'est le point ouvert de l'art. 58 de la LF 2026.

**Affichage**

- Par véhicule : le total dû, le détail par tranche, le prorata et l'arrondi, le statut **Conforme / Écart** (tolérance de 1 €) et les alertes (jours avant immatriculation, CO₂ ou CV manquant).
- Lorsque le résultat en dépend, un rappel du point ouvert sur les tarifs polluants au 01/03/2026.
- Un récapitulatif du parc. L'écart du parc n'est calculé que sur les véhicules qui ont un montant déclaré.

**Mise à jour annuelle** (TVS 2027…) : dupliquer la brique, puis adapter `BAREMES`, `POLLUANTS`, `ANNEE` et `NB_JOURS` dans `calcul.js`, ainsi que les cas de test.

## 2 ter. Brique Import caisse (`/caisse`)

C'est l'ancien site **Pennylane DG** (pennylane-dg.onrender.com), intégré au portail le 26/11/2026.
Il transforme les fichiers de ventes des clients (caisses Jalia, exports d'écritures, tableau Excel SOLAU, factures HHM) en écritures, puis les crée dans leur dossier Pennylane.
La référence métier complète est **`docs/Pennylane_DG_contexte.md`** : sociétés, comptes, règles des écarts 658 / 758 / 471, doublons et liste « À faire ».

**Le code**

- Le code métier est **repris sans modification** dans `src/modules/caisse/` (`importeurs/`, `lib/`, `societes/`, `outils/`, `test/`). Ses 62 tests tournent avec `npm test`, dont 4 tests sur vrais fichiers, à activer par variables d'environnement.
- `src/modules/caisse/routeur.js` remplace l'ancien `server.js`. Il garde les mêmes API (`/caisse/api/societes`, `connexion`, `analyser`, `envoyer`) et les mêmes garde-fous :
  - fichiers de 10 Mo maximum ;
  - 200 requêtes par tranche de 10 minutes et par IP ;
  - nouvelle analyse au moment de l'envoi, et envoi des seules pièces « prêtes » ;
  - arrêt sur erreur 401 ou 403.

**Ce qui s'ajoute avec le portail**

- La **connexion Microsoft 365 est obligatoire**. Une session expirée renvoie un 401 en JSON.
- Un **jeton anti-CSRF** (en-tête `X-CSRF`) est exigé sur toutes les requêtes POST.
- Le **journal** note, au nom de la personne : `connexion_pennylane` (avec le dossier ouvert), `analyse` (nombre de pièces prêtes, bloquées, déjà envoyées) et `envoi_pennylane` (pièces créées et montant).

**Clé API Pennylane**

- Il y a toujours **une clé par société**. Elle est collée dans la page et vidée au changement de société.
- Elle n'est jamais stockée ni journalisée : les tests le vérifient.
- La fiche société peut porter `pennylaneCompanyId` si l'on passe un jour à un jeton cabinet, mais ce passage n'a pas été décidé.

**Bascule depuis l'ancien site** : faire un premier envoi réel d'une journée depuis `/caisse`, puis suspendre le service `pennylane-dg` sur Render et archiver son dépôt GitHub.

## 3. Parcours utilisateur (Assistant 471)

1. Connexion individuelle avec le **compte Microsoft 365** du collaborateur (bouton « Se connecter avec Microsoft »). Le nom de la personne s'affiche ensuite en haut à droite. Le mot de passe commun `APP_PASSWORD` ne sert que tant que Microsoft n'est pas configuré.
2. Choix du dossier : la liste vient de Pennylane, avec une recherche par **nom** ou **code client** (accents ignorés, Entrée ouvre le premier résultat).
3. Page du dossier : période, puis tableau Dépenses, tableau Recettes (avec la colonne Compte pour le contrôle), puis la zone mail.
4. Zone mail : destinataire, « texte avant les tableaux », « texte après les tableaux », et aperçu en direct.
5. Téléchargements : **mail .eml**, qui contient les deux Excel, ou chaque Excel seul.
6. Dans Outlook : ouvrir le .eml, ajouter la signature (Insertion > Signature), puis envoyer.

## 4. Architecture technique

- **Node.js ≥ 20**, Express 5, modèles EJS, sessions par cookie signé (cookie-session).
- **exceljs** génère les Excel ; **nodemailer** (MailComposer) génère le .eml (HTML + texte, en-tête `X-Unsent: 1`).
- Aucune base de données : rien n'est stocké, tout est généré à la demande.
- La liste des dossiers est mise en cache 10 minutes en mémoire (lien « Recharger la liste depuis Pennylane »).

```
src/server.js        socle du portail : connexion, sessions, CSRF, journal, sécurité, accueil, montage des briques
src/modules/index.js registre des briques (tuiles) ; routeur: null = « Bientôt disponible »
src/modules/assistant471.js  brique Assistant 471 (routes /471/…)
src/modules/tvs.js   brique TVS 2026 (page /tvs + journal)
public/tvs/          calcul.js (moteur TVS, partagé navigateur/tests) et app.js (interface)
src/modules/caisse/  brique Import caisse : routeur.js + code Pennylane DG inchangé (importeurs, lib, societes, outils, test)
public/caisse/       app.js (page d'import)
docs/                TVS_2026_contexte.md, Pennylane_DG_contexte.md (références métier)
public/img/          logos du cabinet (servis sous /static/img/)
src/auth.js          connexion Microsoft Entra ID (OpenID Connect + PKCE, sans bibliothèque)
src/pennylane.js     client API Pennylane (+ classe Demo : données fictives)
src/retraitement.js  lettrage, Dépense/Recette, centimes, formats français
src/documents.js     Excel Dépenses / Recettes, corps du mail HTML + texte, .eml
views/               portail.ejs (accueil), login.ejs, bientot.ejs, erreur.ejs, partials/ (haut, bas, couverture), 471/ (index, dossier)
test/                tests automatiques (npm test)
render.yaml          configuration Render (Blueprint)
```

### Routes

| Route | Rôle |
|---|---|
| `GET /login`, `POST /login`, `GET /logout` | connexion et déconnexion |
| `GET /auth/microsoft`, `GET /auth/callback` | connexion Microsoft 365 |
| `GET /` | accueil du portail (tuiles) |
| `GET /471` | Assistant 471 : liste et recherche des dossiers (`?rafraichir=1` vide le cache) |
| `GET /471/dossier/:id?depuis=&jusqu=` | aperçu du dossier |
| `POST /471/dossier/:id/eml` | brouillon .eml (champs : destinataire, avant, apres, csrf) |
| `POST /471/dossier/:id/excel/depenses` et `/recettes` | Excel seul |
| `GET /tvs` | TVS 2026 : saisie et vérification du parc |
| `POST /tvs/journal` | trace d'un export / enregistrement TVS (action, client, nb véhicules ; CSRF) |
| `GET /static/tvs/calcul.js`, `app.js` | moteur de calcul et interface TVS |
| `GET /caisse` | Import caisse : page d'import |
| `GET /caisse/api/societes` | sociétés paramétrées |
| `POST /caisse/api/connexion`, `analyser`, `envoyer` | connexion Pennylane (clé en en-tête), analyse, envoi (CSRF en en-tête `X-CSRF`) |
| `GET /dossier/…` | anciennes adresses, redirigées (301) vers `/471/dossier/…` |
| `GET /static/img/…` | logos |
| `GET /sante` | contrôle de santé pour l'hébergeur |

## 5. API Pennylane utilisée

Un **jeton cabinet** (Firm token), en **lecture seule**, est créé dans Pennylane > Paramètres du cabinet > Jetons du cabinet.
Les permissions nécessaires sont `companies:readonly`, `ledger_accounts:readonly` et `ledger_entries:readonly`.

| Appel | Usage |
|---|---|
| `GET /api/external/firm/v1/companies?page=&per_page=` | liste des dossiers du cabinet (id, name, client_code) |
| `GET /api/external/v2/ledger_accounts` + filtre `number start_with 4716 / 4717` | ids des comptes d'attente |
| `GET /api/external/v2/ledger_entry_lines` + filtres `ledger_account_id in`, `date gteq/lteq` | lignes 471 (pagination par curseur, limite 100) |
| `GET /api/external/v2/ledger_entries` + filtre `id in` | libellés des écritures |
| `GET /api/external/v2/ledger_entries/{id}/ledger_entry_lines` | libellé de secours (autre ligne de l'écriture) |

- Avec un jeton cabinet, chaque appel v2 doit porter l'en-tête **`X-Company-Id: <id du dossier>`**.
- En cas de réponse 429 (trop de requêtes), l'appel est relancé avec une attente.
- Les erreurs 401, 403 et 404 sont traduites en messages en français.
- Documentation : https://pennylane.readme.io et https://firm-pennylane.readme.io

## 6. Hébergement et déploiement

- **Code** : dépôt GitHub privé du cabinet. Les mises à jour se font par dépôt de fichiers dans GitHub.
- **Hébergement** : Render (région Francfort), service `assistant-471`, adresse https://assistant-471.onrender.com.
- Offre **gratuite** pour l'instant : mise en veille après inactivité, avec jusqu'à environ 50 s au premier chargement.
- Le service a été créé à la main, pas en Blueprint : les variables se saisissent dans **Render > Environment**.
- Chaque modification poussée sur GitHub déclenche un redéploiement automatique.

### Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `PENNYLANE_TOKEN` | oui | jeton cabinet en lecture seule |
| `AZURE_TENANT_ID` | oui | ID de l'annuaire Microsoft du cabinet |
| `AZURE_CLIENT_ID` | oui | ID de l'application « Assistant 471 » dans Entra |
| `AZURE_CLIENT_SECRET` | oui | secret client (expire : à renouveler, voir GUIDE_MICROSOFT.md) |
| `APP_BASE_URL` | oui | `https://assistant-471.onrender.com` (sert à l'URI de redirection) |
| `ALLOWED_DOMAINS` | non | domaines e-mail autorisés (défaut `cabinet-dg.fr`) |
| `APP_PASSWORD` | non | mot de passe commun de secours, **ignoré** dès que Microsoft est configuré |
| `SECRET_KEY` | oui | signature des sessions ; sans elle, déconnexion à chaque redémarrage |
| `NODE_ENV` | conseillé | `production` (cookies sécurisés) |
| `CABINET_SIGNATURE` | non | signature ajoutée au mail ; vide par défaut, car on utilise la signature Outlook |
| `CABINET_EXPEDITEUR` | non | adresse « De » du brouillon |
| `SEUIL` | non | montant minimum retenu, en euros |
| `DEMO` | non | `1` = données fictives, sans appel à Pennylane |

### Essai en local

```bash
npm install
npm test
DEMO=1 npm start      # http://localhost:8000, mot de passe « demo »
```

## 7. Sécurité et RGPD

- Le jeton Pennylane reste côté serveur. Il n'est jamais dans GitHub ni dans le navigateur.
- Le jeton est en lecture seule : le site ne peut rien modifier dans Pennylane.
- Accès individuel par compte Microsoft 365 :
  - seul le locataire du cabinet est accepté ;
  - les contrôles portent sur l'émetteur, l'audience, le nonce, le state et le PKCE ;
  - seul le domaine @cabinet-dg.fr est accepté ;
  - la liste des personnes autorisées se gère dans Entra (« Affectation requise »).
- Pas de redirection ouverte après connexion.
- **Journal d'activité** dans les logs Render : une ligne JSON `journal` par connexion, consultation de dossier et téléchargement, avec l'adresse de la personne.
- Sessions de 8 h, protection CSRF sur les téléchargements, en-têtes `X-Frame-Options`, `nosniff` et `no-store`.
- Aucune donnée client n'est conservée sur le serveur.
- Les données transitent par Render, un sous-traitant situé dans l'UE : point à valider côté RGPD au cabinet.
- `npm audit` signale encore des alertes moyennes (minimatch, via ejs et exceljs) sans impact ici : aucune donnée utilisateur ne passe par ce module.

## 8. Historique

| Date | Évolution |
|---|---|
| 03/11/2026 | V0 : script Python en ligne de commande (abandonné) |
| 03/11/2026 | V1 : site web Python/Flask (abandonné au profit de Node.js) |
| 03/11/2026 | Site **Node.js** déployé sur Render, puis mise à jour des dépendances (faille nodemailer corrigée) |
| 03/11/2026 | V2 : libellés complétés depuis l'écriture ; consolidation des sous-comptes ; 2 Excel (Dépenses / Recettes) |
| 03/11/2026 | V3 : mail en **HTML** avec tableaux (signature Outlook possible), textes avant/après modifiables, aperçu en direct |
| 24/11/2026 | V4 : **connexion individuelle Microsoft 365** (Entra ID), nom affiché, journal d'activité ; guide `GUIDE_MICROSOFT.md` |
| 24/11/2026 | V5 : **portail multi-outils** aux couleurs du cabinet ; Assistant 471 déplacé sous `/471` ; tuile TVS 2026 « bientôt » |
| 25/11/2026 | V6 : **brique TVS 2026** (calcul CO₂ + polluants, parc, JSON/CSV), validée sur les 8 cas de référence |
| 26/11/2026 | V7 : **brique Import caisse** (ex-Pennylane DG) intégrée sous `/caisse` : connexion Microsoft, CSRF, journal nominatif ; 100 tests |

## 9. Ajouter une brique
1. **Code** : créez `src/modules/mon-outil.js`, qui exporte une fonction `(ctx) => express.Router()`. Prenez `src/modules/assistant471.js` comme modèle.
   `ctx` fournit les outils communs : `connexionRequise`, `verifierCsrf`, `journal`, `HttpError`, `telechargement` et `DEMO`.
2. **Pages** : créez le dossier `views/mon-outil/`. Chaque page commence par `<%- include('../partials/haut', { titre: '…' }) %>` et se termine par `<%- include('../partials/bas') %>`.
   Elle reçoit ainsi l'en-tête, le fil d'Ariane, la connexion et les styles du cabinet. Dans la page, `base` vaut l'adresse de l'outil (ex. `/mon-outil`).
3. **Tuile** : ajoutez une entrée dans `src/modules/index.js` avec : `id`, `titre`, `description`, `tags`, `icone`, `chemin` et `routeur`.
   Avec `routeur: null`, la tuile s'affiche en « Bientôt disponible ».

La connexion Microsoft, le journal d'activité et la sécurité s'appliquent automatiquement au nouvel outil.

Le libellé du pôle sur l'accueil se règle avec la variable `PORTAIL_POLE` (défaut « Pôle comptable »).

## 10. Points ouverts et pistes

- **Import caisse** : premier envoi réel depuis `/caisse`, puis arrêt de l'ancien service `pennylane-dg` et archivage de son dépôt. Les tâches par société restent celles de `docs/Pennylane_DG_contexte.md` §6 (BDP, COTE PISTE, SOLAU, HHM).

- **TVS 2026** : faire valider les résultats par un collaborateur fiscaliste sur quelques vrais dossiers ; trancher le point ouvert du tarif polluants au 01/03/2026 dès que la doctrine est publiée (choisir le mode par défaut).
- TVS : pistes éventuelles, à savoir l'import d'un parc depuis Excel ou CSV et la gestion des indemnités kilométriques, aujourd'hui hors champ.
- Harmoniser éventuellement les Excel et le mail client avec la charte verte (ils sont encore en bleu marine).

- Tester le rendu du .eml dans Outlook sur plusieurs postes.
- Pré-remplir l'e-mail du client : Pennylane ou un fichier `id;email`.
- Créer le brouillon directement dans Outlook (connecteur Microsoft 365 ou Graph API) au lieu du .eml.
- Traiter plusieurs dossiers d'un coup (export en lot).
- Passer à l'offre Render payante si la mise en veille gêne l'équipe.
- Autres tâches répétitives à ajouter à l'assistant (à définir).

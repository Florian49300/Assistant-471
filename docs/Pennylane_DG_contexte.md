# Contexte – Pennylane DG

> **Depuis le 26/11/2026, cet outil est la brique « Import caisse » du portail « Mes outils de gestion »**, à l'adresse `/caisse` sur https://assistant-471.onrender.com.
> L'accès passe désormais par la connexion Microsoft 365 du portail. Les analyses et les envois sont tracés au nom du collaborateur dans le journal Render, sans la clé ni le contenu du fichier.
> Le code métier est inchangé.
>
> | Avant (dépôt `pennylane-dg`) | Maintenant (dépôt du portail) |
> |---|---|
> | `importeurs/`, `lib/`, `societes/`, `outils/`, `test/` | `src/modules/caisse/importeurs/`, `lib/`, `societes/`, `outils/`, `test/` (fichiers inchangés) |
> | `server.js` (serveur HTTP natif) | `src/modules/caisse/routeur.js` (routeur Express, mêmes 4 API sous `/caisse/api/…`) |
> | `public/index.html`, `style.css` | `views/caisse/index.ejs` (même structure, charte du portail) |
> | `public/app.js` | `public/caisse/app.js` (adresses préfixées par `/caisse` et jeton anti-CSRF) |
> | `test/serveur.test.js` | `test/caisse-portail.test.js` (même parcours, en passant par le portail) |
> | `npm run verifier` | `npm run verifier-caisse -- <id-societe> <fichier>` |
>
> **Ajouter une société** : même procédure qu'au §5, avec la fiche dans `src/modules/caisse/societes/`.
> Les sections ci-dessous décrivent les règles métier, qui restent valables. Les chemins de fichiers du §4 s'entendent sous `src/modules/caisse/`.

Dernière mise à jour : 26/11/2026 · Florian, service informatique (informatique@cabinet-dg.fr)

> **Pour reprendre le travail avec Claude** (nouvelle conversation) : joindre le zip du dépôt GitHub `pennylane-dg`, qui contient ce fichier. L'espace de travail de Claude n'est pas conservé d'une conversation à l'autre.
> **Pour une nouvelle société** : joindre aussi un export de caisse sur un mois complet, tel quel, et la référence (fichier retraité, tableau de retraitement ou capture de l'écriture dans Pennylane).

---

## 1. Le projet en bref

**Pennylane DG** est un site web interne du cabinet Durand Godeau & Associés. Il transforme les fichiers de ventes des clients (caisses de restaurants, factures) en écritures comptables, puis les crée dans leur dossier Pennylane par l'API v2.

| Élément | Valeur |
|---|---|
| Adresse | https://pennylane-dg.onrender.com |
| Code | Dépôt GitHub **privé** `pennylane-dg`, branche `main` |
| Hébergement | Render, plan gratuit, `render.yaml`. Redéploiement automatique à chaque push sur `main`. Mise en veille après ~15 min sans visite (réveil jusqu'à 1 min) |
| Technique | Node.js ≥ 18, **aucune dépendance npm** (serveur HTTP natif, `fetch` natif, lecture Excel maison) |
| Clé API | Générée et distribuée par Florian, **une par société** (dossier Pennylane). Saisie dans la page à chaque usage, jamais stockée (ni fichier, ni base, ni log, ni Render). Vidée au changement de société |
| Charte | Couleurs Durand Godeau & Associés (#66a44d, #585b62, #6ebc5a, #345829) et logo en en-tête, en versions claire et sombre |
| Procédure | « Procedure_Pennylane_DG.pdf » (8-9 pages, à jour au 03/11/2026), diffusée aux collaborateurs. Elle n'explique pas comment générer les clés API |

**Parcours utilisateur** :

1. choisir la société dans le menu, coller sa clé, puis se connecter (le nom du dossier Pennylane s'affiche) ;
2. déposer le fichier brut, puis cliquer sur Analyser ;
3. contrôler la case CA et le rapprochement, et lire les statuts ;
4. cocher les pièces, cliquer sur Envoyer, puis confirmer ;
5. vérifier dans Pennylane.

---

## 2. Règles communes (décidées avec le cabinet)

| Sujet | Règle |
|---|---|
| Détail | **Caisses : une écriture par jour.** Factures (HHM PERFORMANCE) : une écriture par facture ou avoir. Un mode mensuel existe (`"regroupement": "mois"`, importeur Jalia), mais il n'est pas utilisé |
| TVA | **TVA de la caisse** (celle des tickets Z), jamais recalculée. Le HT est reconstitué si besoin (HT = TTC − TVA), et l'écriture tombe toujours juste |
| Écarts de caisse (tous les dossiers de caisse, 03/11/2026) | Encaissements ≠ ventes TTC : **moins de 1 €** → **658** si c'est un manque (débit), **758** si c'est un excédent (crédit). **1 € et plus** → **471000000** (compte d'attente, à régulariser). Une alerte orange s'affiche sur la journée. Fonction commune `lib/ecarts.js`, réglages `petitsEcarts` et `compteEcart` dans chaque fiche |
| Arrondis | Les montants sont lus en millièmes, puis arrondis au centime. Pour un export à 3 décimales (COTE PISTE), les 1 à 3 centimes d'arrondi d'une journée vont sur la plus grosse vente du jour (`toleranceArrondiCentimes`, 5 centimes maximum) |
| Ventes par taux | Pour les exports d'écritures (JESSI'FAIM, COTE PISTE), les ventes sont rangées **selon leur taux de TVA**, pas selon le compte 7 de la caisse |
| Contrôle avec les Z | Une case dans la synthèse affiche le **CA HT et la TVA importés en gros**, et le **total TTC en dessous** (« à rapprocher des Z », ou « du journal des ventes du logiciel » pour HHM). Une colonne « CA TTC » par pièce dans le tableau. Calcul : ventes HT + TVA collectée, nettes des remises, hors encaissements, écarts et pourboires (`chiffreAffaires`, dans `lib/controles.js`) |
| Doublons | Avant l'envoi, l'outil lit les écritures du journal sur la période. Même n° de pièce ou même libellé = « déjà envoyée », pièce ignorée. Une écriture mensuelle « CAISSE MM.AAAA » déjà saisie à la main bloque les jours de ce mois (BDP) |
| Envoi | Uniquement après confirmation. Le serveur ré-analyse le fichier et n'envoie que les pièces « prêtes ». Une erreur 401/403 arrête tout. Une erreur 422 laisse la pièce à renvoyer |
| Garde-fous | Nom du dossier Pennylane affiché à la connexion. Contrôle du nom de fichier par société (n° de caisse Jalia, « JESSIFAIM », « HHM PERFORMANCE », « AAAA MM » pour SOLAU). Tout compte ou toute colonne non paramétrés **bloquent** la pièce, jamais de choix au hasard |
| Comptes Pennylane | Un même numéro peut exister en plusieurs exemplaires, un par code TVA (`vat_rate` : FR_100, FR_200, any…). Pour une ligne de vente ou de TVA, l'outil prend l'exemplaire du bon taux, sinon « any ». S'il reste des **doublons parfaits** (même numéro, même taux), il prend le plus ancien (plus petit id). Correctif du 20/11/2026 : 70611 en 8 exemplaires chez BDP, dont 2 à 10 %. Pour les autres lignes (paiements), il ne choisit jamais seul. Recherche du compte : forçage `comptesForces`, puis numéro exact, puis numéro sans les zéros de fin (`531` = `531000000`). Les comptes auxiliaires alphanumériques sont acceptés (`411CB0000`) |

---

## 3. Les sociétés

| Société | Fiche | Importeur | Fichier attendu | Journal | Validé sur |
|---|---|---|---|---|---|
| BDP | `bdp.json` | `jalia-caisse` | Export comptable Jalia CSV `jalia_export_accounting_850_…` | CA | sept. 2026 (= écriture « CAISSE 09.2026 » de Pennylane) |
| COTE PISTE | `cote-piste.json` | `ecritures-caisse` | « Export du JJ-MM-AA au JJ-MM-AA.csv » | C1 | sept. 2026 (= retraité V2 LCH) |
| HHM PERFORMANCE | `hhm-performance.json` | `ecritures-caisse` | « SARL HHM PERFORMANCE-Ventes JJ-MM-AAAA.csv » | VE | sept. 2026 (= « Fichier prêt à l'import ») |
| JESSI'FAIM | `jessifaim.json` | `ecritures-caisse` | « EXPORTCOMPTABLE…-JESSIFAIM.csv » | VE | oct. 2026 (import réel réussi le 03/11/2026) |
| SOLAU | `solau.json` | `tableau-caisse` | « AAAA MM FCAISSECOMPTABLE.xlsx » | C1 | sept. 2026 (= tableau LCH, hors TVA) |

### 3.1 BDP

- **Caisse** : Jalia, n° 850. Une ligne par Z et une ligne « Total » (rapprochement).
- **Écriture** : une par jour, datée du jour d'ouverture de la caisse. Libellé « CAISSE JJ.MM.AAAA », pièce `Z850-AAAAMMJJ`.

| Mode de paiement Jalia | Compte | Libellé |
|---|---|---|
| due clients | 411 | DUE CLIENTS |
| Chèque | 5112 | CHEQUE |
| Titre restaurant | 5114 | TITRE RESTAURANT |
| carte resto | 5114 | CARTE RESTO |
| cheque vacance | 51141 | CHEQUES VACANCES |
| Carte de crédit | 5115 | REMISE CB |
| sumup | 51151 | CB SUMUP |
| Espèces | 531 | CAISSE |
| Pourboires (crédit) | 467 | **à confirmer** |

| TVA | Ventes (depuis le 20/11/2026) | TVA collectée |
|---|---|---|
| 10 % | **706110000** | 44571008 |
| 20 % | **706120000** | 44571009 |
| 5,5 % | **706130000** | 44571006 |

- **Comptes de ventes** : ils s'appelaient avant 70611, 70612 et 70613. Dans Pennylane, le numéro affiché est « 70611 », en plusieurs exemplaires (voir la règle « Comptes Pennylane »).
- **Écarts** : règle commune (658 / 758 / 471000000).
- **Contrôles par jour** : somme des TTC par taux = Total Net ; encaissements = Total Net + pourboires. Un écart d'encaissement suit la règle commune.
- **Septembre 2026** : il a été saisi à la main en une écriture mensuelle, donc ses jours sont bloqués (double emploi).
- **Mise en service en cours** : l'analyse d'octobre avec la clé du 20/11 bloquait sur les doublons du 70611. C'est corrigé dans `lib/sync.js`. Il faut le redéployer, relancer l'analyse, puis envoyer une journée.

### 3.2 JESSI'FAIM (nom affiché en majuscules)

- **Fichier** : export « EXPORTCOMPTABLE », tabulé. Il contient déjà des écritures : Date, JournalCode, CompteNum, CompteLib, Debit, Credit, PieceRef, Poste. La caisse remplace « à » par « ? », et l'outil le rétablit.
- **Écriture** : une par journée de caisse. Pièce = PieceRef (395, 396…), libellé « CAISSE JJ.MM.AAAA ». Une ligne par catégorie de vente. Les lignes à 0,00 sont ignorées.

| Compte caisse | Compte Pennylane | Libellé |
|---|---|---|
| 411CB | 5111 (511100000) | Recette CB |
| 411CBTR | 5114 (511400000) | Recette CB tickets resto |
| 511CARTE KDO | 5113 (511300000) | Recette carte cadeau |
| 411VIR | 5115 | Recette VIR |
| 53100000 | 531 | Recette ESPECES |

| Taux | Ventes | TVA |
|---|---|---|
| 10 % | 7011 | 44571008 |
| 20 % | 707 | 44571009 |
| 5,5 % | 7015 | 44571006 |
| 0 % (cartes cadeaux vendues) | 5113 | — |

- **Ventes rangées par taux** : les « Elixirs » à 10 %, en 707 dans la caisse, vont en 7011. L'« Ardoise » à 20 %, en 7011 dans la caisse, va en 707.
- **Octobre 2026** : 19 journées. Écarts ≥ 1 € en 471000000 : 13,50 €, 76,60 € et 117,00 €. CA HT 23 034,20 €, TVA 2 659,13 €.

### 3.3 COTE PISTE

- **Fichier** : Windows-1252, `;`, montants à **3 décimales**. Colonnes : Journal (vide), Date `01-09-26`, Compte, Libelle Compte, Pièce `01-09`, Libellé Mouvement, Débit, Crédit, Taux.
- **Écriture** : une par jour, journal C1, pièce `9/1` (mois/jour), libellé « CAISSE 01/09/2026 ».
- **Transformations** (reprises du retraité V2 LCH) :
  - TVA 44571301 → 44571008 et 44571201 → 44571009 ;
  - ventes selon la colonne Taux : 10 % → 70110000, 20 % → 70700000 ;
  - montants négatifs (remises « Menus », rendus d'espèces) passés de l'autre côté.

| Code caisse | Compte Pennylane |
|---|---|
| 411CB (VISA) | 411CB0000 |
| 411CBTR | 411CBTR00 |
| 411CHQ | 411CHQ000 |
| 411CV | 411CV0000 |
| 411CVCO | 411CVCO00 |
| COMPTE REGLE411, 411DIFFERES, 411DIFFERE | 411DIFFERE |
| 411TR | 411TR0000 |
| 411VIR | 411VIR000 |
| 53100000 (ESPECES) | 531000000 |

- **Arrondis et écarts** : les centimes d'arrondi (5 au maximum) vont sur la plus grosse vente du jour. Au-delà, la règle commune s'applique (658 / 758 / 471000000).
- **Septembre 2026** : 22 journées identiques au retraité, hors centimes d'arrondi. Encaissements 34 890,35 €.

### 3.4 SOLAU – Bistrot de la Gare

- **Fichier** : classeur Excel tenu à la main, avec un onglet par mois depuis 2019 (« 2026 09 ») et une ligne par jour (colonne JOUR). L'outil importe **l'onglet du mois indiqué au début du nom du fichier**. Les jours vides sont ignorés.
- **Écriture** : une par jour ouvert, journal C1, pièce et libellé « CAISSE JJ/MM/AAAA ».

| Colonne du tableau | Compte |
|---|---|
| HT / TVA 10 % | 70110000 / 44571008 |
| HT / TVA 20 % | 70121000 / 44571009 |
| HT / TVA 5,5 % | 70150000 / 44571006 |
| CB | 511100000 |
| ESPECE | 53100000 |
| CHQ | 511200000 |
| BON CADEAUX | 511300000 |
| NON REGLE | 411DIFFERE |
| CB EN LIGNE | **aucun** : plus de ventes en ligne. Une saisie dans cette colonne bloque la journée |

- **TVA** : le tableau LCH recalcule la TVA (HT × taux), ce qui déséquilibre ses écritures (1,34 € sur septembre). **Décision du 03/11/2026 : on reprend la TVA du tableau de caisse.** L'option `tvaRecalculee: true` reproduirait la méthode LCH.
- **Septembre 2026** : 22 journées, encaissements 39 221,21 €, CA HT 35 267,13 €, TVA 3 954,07 €. Un écart de 0,01 € le 24/09 passe en 758.

### 3.5 HHM PERFORMANCE (factures, pas une caisse)

- **Fichier** : export du logiciel de facturation. CSV `;` en UTF-8, **sans en-tête** : date ; journal ; compte ; libellé ; pièce `26-09-3820` ; montant ; sens D/C.
- **Écriture** : une par facture ou avoir, journal VE. Pièce = n° de facture (`3820`). Libellé = celui de la facture.
- **Comptes** :
  - les clients `411xxxxxx` sont regroupés en **411001** ;
  - 706020 reste 706020 ;
  - 707000 devient **70603** ;
  - la TVA 445720 devient **44571009** ;
  - tout autre compte bloque la facture.
- **Écarts** : pas de règle d'écart (une facture est toujours équilibrée).
- **Septembre 2026** : 61 factures et avoirs identiques au retraité. 18 811,67 € TTC, 15 732,71 € HT, 3 078,96 € de TVA.

---

## 4. Architecture du code

| Emplacement | Rôle |
|---|---|
| `server.js` | Serveur HTTP natif : `/health`, `/api/societes`, `/api/connexion`, `/api/analyser`, `/api/envoyer`. CSP stricte, 10 Mo maximum, 200 requêtes par IP sur 10 min, aucun log de clé |
| `societes/*.json` | Une fiche par société (`_modele.json` = modèle). Chargées au démarrage |
| `importeurs/jalia-caisse.js` | Export Jalia (BDP) |
| `importeurs/ecritures-caisse.js` | Exports qui contiennent déjà des écritures : JESSI'FAIM, COTE PISTE, HHM PERFORMANCE. Réglages : `comptesCaisse`, `ventesParTaux`, `tvaParTaux`, `comptes` / `comptesParPrefixe`, `colonnesFixes`, `formatPiece` / `libellePiece` (`{piece}` `{num}` `{libelle}` `{j}` `{m}` `{jj}` `{mm}` `{aaaa}`), `toleranceArrondiCentimes`, `libellesMasses`, `libelleControle` |
| `importeurs/tableau-caisse.js` | Tableaux Excel « un onglet par mois » (SOLAU). Réglages : `paiements`, `tva`, `tvaRecalculee` |
| `lib/xlsx.js` | Lecteur .xlsx sans dépendance (zip + zlib natif, valeurs calculées des formules) |
| `lib/controles.js` | Contrôles hors ligne et calcul du CA |
| `lib/ecarts.js` | Règle des écarts de caisse (658 / 758 / 471000000) |
| `lib/pennylane.js` | Client API v2 : `/me`, `/journals`, `/ledger_accounts`, `GET` et `POST /ledger_entries`, pagination par curseur, 429 avec Retry-After |
| `lib/sync.js` | Correspondance des comptes (taux, doublons, forçage), journal, doublons d'écritures, envoi |
| `public/` | La page (HTML, CSS, JS, logos clair et sombre, favicon) |
| `outils/verifier-import.js` | `node outils/verifier-import.js <id-societe> <fichier>` : vérification sans Pennylane, avec écriture d'un CSV des écritures |
| `test/` | 69 tests (`npm test`). Tests de référence facultatifs sur les vrais fichiers, à activer avec les variables `FICHIER_REFERENCE`, `FICHIER_COTEPISTE(_RETRAITE)`, `FICHIER_SOLAU(_LCH)` et `FICHIER_HHM(_RETRAITE)` |

**API Pennylane v2** :

- base `https://app.pennylane.com/api/external/v2` ;
- écriture : `date`, `label`, `journal_id`, `piece_number`, `ledger_entry_lines[{debit, credit, ledger_account_id, label}]` ;
- montants envoyés en chaînes à 2 décimales ;
- droits nécessaires : journals, ledger_accounts, ledger_entries.

---

## 5. Ajouter une société

1. Réunir un export brut sur **un mois complet**, la **référence** (retraité, tableau ou capture Pennylane) et une **capture du plan comptable Pennylane** pour les moyens de paiement.
2. **Même format qu'un dossier existant** : copier sa fiche, adapter l'id, le nom, le journal et les comptes, puis faire un commit. Render redéploie seul.
3. **Nouveau format** : Claude écrit l'importeur ou les réglages, puis le valide ligne à ligne contre la référence avec un test automatique.
4. Ajouter la société dans le tableau « Sociétés disponibles » de la procédure PDF et dans ce fichier.
5. Faire un premier envoi d'**une seule** pièce, puis la vérifier dans Pennylane.

---

## 6. À faire

- [ ] **BDP** : redéployer `lib/sync.js` (correctif des doublons du 20/11), relancer l'analyse d'octobre avec la clé, envoyer une journée et la vérifier dans le journal CA.
- [ ] **BDP** : confirmer le compte des pourboires (467 ?) et vérifier que 658, 758 et 471000000 existent dans le dossier.
- [ ] **COTE PISTE** : premier envoi d'une journée (journal C1). Vérifier 658, 758 et 471000000 dans le dossier.
- [ ] **SOLAU** : premier envoi d'une journée (journal C1). Vérifier les comptes 53100000, 411DIFFERE, 701… et 658 / 758 dans le dossier.
- [ ] **HHM PERFORMANCE** : vérifier que 411001, 706020, 70603 et 44571009 existent, puis envoyer une facture.
- [ ] **Facultatif** : renseigner `nomPennylane` dans chaque fiche (alerte si la clé ouvre un autre dossier) et le nom du logiciel de caisse de JESSI'FAIM.
- [ ] Après chaque changement : mettre à jour ce fichier et, si les écrans changent, la procédure PDF.

## 7. Historique

| Date | Étape |
|---|---|
| 26/10/2026 | Projet lancé : BDP (Jalia), site multi-sociétés, dépôt GitHub et Render, charte du cabinet |
| 03/11/2026 | JESSI'FAIM (premier import réel réussi), procédure PDF, COTE PISTE, SOLAU (lecteur Excel), case CA, règle des écarts 658 / 758 / 471, HHM PERFORMANCE |
| 20/11/2026 | BDP : ventes en 706110000 / 706120000 / 706130000. Choix automatique entre exemplaires identiques d'un compte Pennylane |
| 26/11/2026 | Fichier de contexte refondu |

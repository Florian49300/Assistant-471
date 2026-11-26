# Contexte – Application « TVS 2026 – Vérification du calcul »

> Fichier de contexte destiné à être intégré dans un bloc d'application (assistant IA, agent, outil no-code ou module développeur).
> Il décrit l'objectif, les règles fiscales, l'algorithme, le modèle de données et les cas de test de l'application.
> Version : 2026-11 · Année d'imposition couverte : **2026** (déclaration en janvier 2027).

---

## 1. Rôle et objectif

L'application permet de **vérifier le montant des taxes sur l'affectation des véhicules de tourisme à des fins économiques** (ex-TVS) dû au titre de **l'année civile 2026**, pour un ou plusieurs véhicules d'un parc, et de le comparer au montant déclaré.

Le montant total par véhicule est la somme de deux taxes :

1. **Taxe annuelle sur les émissions de CO₂** (CIBS art. L421-119 à L421-132).
2. **Taxe annuelle sur les émissions de polluants atmosphériques** (CIBS art. L421-133 à L421-135, modifié par l'art. 58 de la loi n° 2026-103 du 19 février 2026).

Utilisateurs : cabinet d'expertise comptable (contrôle des déclarations 3310-A-SD / 3517 des clients).
Langue de l'interface et des réponses : **français**.

---

## 2. Données d'entrée par véhicule

| Champ | Type | Obligatoire | Description |
|---|---|---|---|
| `plaque` | texte | non | Immatriculation (ex. AB-123-CD) |
| `dateImmat` | date ISO `AAAA-MM-JJ` | oui | Date de 1re immatriculation (case B du certificat) |
| `methode` | `auto` \| `WLTP` \| `NEDC` \| `PA` | oui | Barème ; `auto` = déterminé par la date |
| `energie` | voir liste §2.1 | oui | Type d'énergie |
| `co2` | entier (g/km) | si WLTP/NEDC | Émissions de CO₂ (case V.7) |
| `cv` | entier (CV) | si PA | Puissance administrative (case P.6) |
| `euro` | `auto` \| `1` \| `2` | non | `1` = Euro 5/6 (Crit'Air 1) ; `2` = antérieure à Euro 5 |
| `days` | 365 booléens ou liste de périodes `[début, fin]` (index de jour 0–364) | oui | Jours d'affectation en 2026 |
| `exFauteuil` | booléen | non | Véhicule accessible en fauteuil roulant |
| `exEI` | booléen | non | Entreprise individuelle (personne physique en nom propre) |
| `exActivite` | booléen | non | Activité exonérée (location, transport public, auto-école, agricole/forestière, compétition, opérations art. 261 CGI) |
| `exLCD` | booléen | non | Location courte durée ≤ 1 mois civil ou 30 jours consécutifs |
| `declare` | nombre (€) | non | Montant déclaré à contrôler |

Paramètre global : `polMode` = `annuel` (défaut) \| `mars` (voir §4.3).

### 2.1 Énergies

| Code | Libellé | Taxe CO₂ | Catégorie polluants |
|---|---|---|---|
| `essence` | Essence | barème | 1 si Euro 5/6, sinon « plus polluants » |
| `diesel` | Gazole | barème | toujours « plus polluants » |
| `hev_ess` | Hybride essence (HEV/MHEV) | barème | 1 si Euro 5/6 |
| `phev_ess` | Hybride rechargeable essence | barème | 1 si Euro 5/6 |
| `hyb_dsl` | Hybride gazole | barème | toujours « plus polluants » |
| `e85` | Superéthanol E85 | barème avec abattement | 1 si Euro 5/6 |
| `gaz` | GPL / GNV | barème | 1 si Euro 5/6 |
| `elec` | Électrique | **exonéré** | E (0 €) |
| `h2` | Hydrogène | **exonéré** | E (0 €) |

> L'exonération des hybrides a pris fin au 31/12/2024 : ils sont taxés normalement depuis 2025.

---

## 3. Détermination du barème CO₂ (`methode = auto`)

| Date de 1re immatriculation | Barème |
|---|---|
| à partir du **01/03/2020** | **WLTP** (g/km) |
| du **01/06/2004** au **29/02/2020** | **NEDC** (g/km) |
| avant le **01/06/2004** | **PA** – puissance administrative (CV) |

Conditions NEDC : réception européenne et véhicule non affecté par l'entreprise avant le 01/01/2006. Sinon → PA.
L'utilisateur peut forcer la méthode (import d'occasion, absence de réception CE, carte grise atypique).

Norme Euro automatique (`euro = auto`) : 1re immatriculation ≥ 01/01/2011 → Euro 5/6 (catégorie 1) ; sinon → antérieure à Euro 5.

---

## 4. Barèmes 2026

### 4.1 Taxe CO₂ – barèmes progressifs par tranches (tarif marginal par unité)

```json
{
  "WLTP": [[0,4,0],[5,45,1],[46,53,2],[54,85,3],[86,105,4],[106,125,10],[126,145,50],[146,165,60],[166,null,65]],
  "NEDC": [[0,3,0],[4,37,1],[38,44,2],[45,70,3],[71,87,4],[88,103,10],[104,120,50],[121,136,60],[137,null,65]],
  "PA":   [[0,3,2000],[4,6,3000],[7,10,4500],[11,15,5250],[16,null,6500]]
}
```
Format : `[borne basse, borne haute incluse (null = sans limite), tarif marginal en €]`.

Calcul du tarif annuel : pour chaque tranche, `unités = min(valeur, haute) − basse + 1` (la 1re tranche compte `min(valeur, haute)` unités), plafonné à 0 ; tarif = Σ unités × tarif marginal.

### 4.2 Abattement superéthanol E85
- WLTP/NEDC : CO₂ retenu = arrondi(CO₂ × 0,60), **sauf si CO₂ > 250 g/km** (pas d'abattement).
- PA : CV retenus = CV − 2, **sauf si CV > 12**.
- Aucun abattement sur la taxe polluants.

### 4.3 Taxe polluants – tarifs annuels

| Catégorie | Avant 01/03/2026 (ancien) | 2026 (LF 2026) | 2027 (pour info) |
|---|---|---|---|
| E – électrique / hydrogène | 0 € | 0 € | 0 € |
| 1 – allumage commandé Euro 5/6 (Crit'Air 1) | 100 € | **130 €** | 160 € |
| Plus polluants (diesels, Crit'Air 2 à 5, non classés) | 500 € | **650 €** | 800 € |

Point ouvert : l'art. 58 LF 2026 entre en vigueur au **01/03/2026**.
- `polMode = annuel` (défaut, lecture usuelle) : tarif 2026 × jours / 365.
- `polMode = mars` : ancien tarif × jours affectés du 01/01 au 28/02 / 365 + tarif 2026 × jours affectés du 01/03 au 31/12 / 365.

---

## 5. Algorithme de calcul (par véhicule)

1. Déterminer `methode` (§3) et la catégorie polluants (§2.1 + norme Euro).
2. `nbJours` = nombre de jours d'affectation en 2026 ; `prorata = nbJours / 365` (2026 non bissextile).
3. Taxe CO₂ : `tarifAnnuelCO2` = barème (§4.1) appliqué à la valeur retenue (après abattement E85) ; 0 si électrique/hydrogène.
4. `taxeCO2 = arrondi(tarifAnnuelCO2 × prorata)`.
5. `taxePolluants = arrondi(tarifPolluants × prorata)` (ou formule `mars`).
6. Si une exonération est cochée → `taxeCO2 = taxePolluants = 0`.
7. `total = taxeCO2 + taxePolluants`.
8. Si `declare` renseigné : `ecart = declare − total` ; conforme si |écart| ≤ 1 €.

Arrondi : à l'euro le plus proche, **chaque taxe séparément**, la fraction 0,5 comptant pour 1 (`floor(x + 0,5)`).

Contrôles à signaler :
- jours d'affectation sélectionnés avant la date de 1re immatriculation ;
- CO₂ ou CV manquant pour un véhicule thermique.

Parc : total du parc = Σ des totaux véhicules ; écart du parc calculé sur les seuls véhicules ayant un montant déclaré.

---

## 6. Hors champ

- Véhicules des salariés/dirigeants remboursés en **indemnités kilométriques** : coefficient pondérateur (0 % ≤ 15 000 km ; 25 % 15 001–25 000 ; 50 % 25 001–35 000 ; 75 % 35 001–45 000 ; 100 % au-delà) et **minoration de 15 000 €** non gérés.
- Véhicules utilitaires (N1 non concernés sauf pick-up ≥ 5 places, camionnettes à 2 rangs affectées au transport de personnes).
- Taxe annuelle incitative sur l'acquisition de véhicules légers à faibles émissions (TAFCO).

---

## 7. Cas de test de référence (année entière sauf mention)

| # | Véhicule | Attendu |
|---|---|---|
| 1 | Essence, 1re immat. 10/05/2021, WLTP 100 g/km, 365 j | CO₂ 213 € + polluants 130 € = **343 €** |
| 2 | Gazole, 10/05/2021, WLTP 180 g/km, 365 j | CO₂ 3 608 € + 650 € = **4 258 €** |
| 3 | Gazole, 10/05/2015, NEDC 120 g/km, 365 j | CO₂ 1 204 € + 650 € = **1 854 €** |
| 4 | Idem #3, du 01/04 au 30/09/2026 (183 j) | CO₂ 604 € + 326 € = **930 €** |
| 5 | E85, 01/01/2022, WLTP 150 g/km (retenu 90), 183 j | tarif 173 € → CO₂ 87 € + 65 € = **152 €** |
| 6 | Idem #5, 365 j, `polMode = mars` | CO₂ 173 € + polluants 125 € = **298 €** |
| 7 | Essence, 01/01/2000, PA 7 CV, 365 j | CO₂ 19 500 € + 650 € = **20 150 €** |
| 8 | Électrique, toute date | **0 €** |

Détail #1 (WLTP 100 g) : 4×0 + 41×1 + 8×2 + 32×3 + 15×4 = 213 €.

---

## 8. Sorties attendues

- Par véhicule : barème retenu, valeur retenue, jours et prorata, tarif annuel CO₂, taxe CO₂ due, catégorie et taxe polluants due, exonération éventuelle, total, écart avec le déclaré, détail par tranche.
- Pour le parc : tableau récapitulatif + totaux ; export CSV (séparateur `;`, UTF-8 avec BOM) ; sauvegarde/chargement JSON :

```json
{
  "version": 1,
  "annee": 2026,
  "polMode": "annuel",
  "vehicles": [
    {"plaque":"AB-123-CD","dateImmat":"2021-05-10","methode":"auto","energie":"essence",
     "co2":"100","cv":"","euro":"auto","declare":"343",
     "exFauteuil":false,"exEI":false,"exActivite":false,"exLCD":false,
     "days":[[0,364]]}
  ]
}
```
(`days` : liste de périodes `[indexDébut, indexFin]`, 0 = 01/01/2026, 364 = 31/12/2026.)

---

## 9. Consignes de comportement (si utilisé par un assistant IA)

- Répondre en français, de façon concise, en montrant le détail du calcul (tranches, prorata, arrondi).
- Demander les données manquantes indispensables (date de 1re immatriculation, énergie, CO₂ ou CV, période d'affectation) plutôt que de les supposer.
- Signaler le point ouvert sur la date d'application des tarifs polluants (01/03/2026) lorsqu'il affecte le résultat.
- Rappeler que l'outil est une aide à la vérification et ne remplace pas l'analyse d'un professionnel.

## 10. Références

- CIBS art. L421-119 à L421-132 (tarifs CO₂, version au 01/01/2026) : https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000044595989/LEGISCTA000044599231/2026-01-01/
- Loi n° 2026-103 du 19/02/2026, art. 58 : https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000053508448
- BOFiP BOI-AIS-MOB-10-30-20 : https://bofip.impots.gouv.fr/bofip/13954-PGP.html/identifiant=BOI-AIS-MOB-10-30-20-20250528

'use strict';
// Importeur des tableaux de caisse Excel tenus à la main : un onglet par mois (« 2026 09 »),
// une ligne par jour (colonne JOUR), des colonnes de moyens de paiement puis HT / TVA par taux.
// Exemple : SOLAU, classeur « 2026 09 FCAISSECOMPTABLE.xlsx ».
//
// - L'onglet importé est celui du mois indiqué au début du nom de fichier (« 2026 09 … »).
// - Une écriture par jour non vide : ventes HT et TVA au crédit, encaissements au débit.
// - TVA reprise du tableau (par défaut) ; option "tvaRecalculee" : TVA = HT × taux arrondi (méthode du tableau LCH).
// - Journée déséquilibrée : petit écart en 658/758 ("petitsEcarts"), sinon "compteEcart" (alerte), sinon journée bloquée.

const { ouvrirClasseur } = require('../lib/xlsx');
const { fmt } = require('./jalia-caisse');
const { compteEcart } = require('../lib/ecarts');

const normaliser = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

// Nombre Excel (texte, éventuellement en notation scientifique ou avec une imprécision binaire) -> centimes
function centimes(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`montant illisible « ${v} »`);
  const [ent, dec = ''] = Math.abs(n).toFixed(4).split('.');       // 4 décimales suffisent à gommer l'imprécision
  let c = parseInt(ent, 10) * 100 + parseInt(dec.slice(0, 2), 10);
  if (parseInt(dec.slice(2), 10) >= 50) c += 1;                    // arrondi au centime, demi vers le haut
  return n < 0 ? -c : c;
}

const MOIS = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];

// « 2026 09 FCAISSE…xlsx » -> { annee: 2026, mois: 9 }
function moisDepuisNom(nom) {
  const m = String(nom).match(/(20\d{2})[ _.-]?(\d{1,2})(?!\d)/);
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  return { annee: +m[1], mois: +m[2] };
}

function remplir(modele, date) {
  const [aaaa, mm, jj] = date.split('-');
  return modele.replace(/\{(date|jj|mm|aaaa|aa|j|m)\}/g, (_, k) => ({
    date: `${jj}.${mm}.${aaaa}`, jj, mm, aaaa, aa: aaaa.slice(2), j: String(+jj), m: String(+mm),
  })[k]);
}

function importer(buffer, config, { nomFichier = '' } = {}) {
  const classeur = ouvrirClasseur(buffer);
  const periode = moisDepuisNom(nomFichier);
  if (!periode) throw new Error('le nom du fichier doit commencer par l\'année et le mois à importer (ex. « 2026 09 FCAISSECOMPTABLE.xlsx »)');
  const nomFeuille = classeur.feuilles.find(n => { const p = moisDepuisNom(n); return p && p.annee === periode.annee && p.mois === periode.mois; });
  if (!nomFeuille) throw new Error(`onglet du mois ${String(periode.mois).padStart(2, '0')}/${periode.annee} introuvable dans le classeur`);
  const f = classeur.lireFeuille(nomFeuille);

  // Ligne d'en-tête : celle dont la colonne A vaut « JOUR »
  let lEntete = 0;
  for (let l = 1; l <= Math.min(f.maxLigne, 20); l++) if (normaliser(f.valeur(1, l)) === 'JOUR') { lEntete = l; break; }
  if (!lEntete) throw new Error(`onglet « ${nomFeuille} » : ligne d'en-tête « JOUR » introuvable`);
  const entetes = [];
  for (let c = 1; c <= f.maxCol; c++) entetes.push({ c, nom: normaliser(f.valeur(c, lEntete)) });
  const col = nom => entetes.find(e => e.nom === normaliser(nom))?.c ?? null;

  // Colonnes de paiement : entre JOUR et le premier TOTAL
  const finPaiements = entetes.find(e => e.nom === 'TOTAL')?.c ?? 0;
  const colsPaiement = entetes.filter(e => e.c > 1 && e.c < finPaiements && e.nom);
  const paiements = Object.fromEntries(Object.entries(config.paiements || {}).map(([k, v]) => [normaliser(k), v]));

  const alertesFichier = [];
  const titreAnnee = f.valeur(1, 1), titreMois = normaliser(f.valeur(2, 1));
  if (titreAnnee && String(titreAnnee) !== String(periode.annee)) alertesFichier.push(`l'onglet porte l'année ${titreAnnee}`);
  if (titreMois && MOIS.includes(titreMois) && MOIS.indexOf(titreMois) + 1 !== periode.mois) alertesFichier.push(`l'onglet porte le mois ${titreMois}`);

  const taux = Object.entries(config.tva || {});
  for (const [t, cfg] of taux) {
    if (!col(cfg.colonneHt)) throw new Error(`colonne « ${cfg.colonneHt} » introuvable dans l'onglet « ${nomFeuille} »`);
    if (!config.tvaRecalculee && !col(cfg.colonneTva)) throw new Error(`colonne « ${cfg.colonneTva} » introuvable dans l'onglet « ${nomFeuille} »`);
  }

  const pieces = [];
  const totaux = { encaisse: 0, ht: 0, tvaFichier: 0, ecart: 0 };
  const dernierJour = new Date(Date.UTC(periode.annee, periode.mois, 0)).getUTCDate();
  for (let l = lEntete + 1; l <= f.maxLigne; l++) {
    const a = f.valeur(1, l);
    if (normaliser(a) === 'TOTAL') break;
    const jour = Number(a);
    if (!Number.isInteger(jour) || jour < 1 || jour > 31) continue;
    const anomalies = [], alertes = [...alertesFichier], lignes = [];
    const ajouter = (compte, libelleCompte, montant, sens, extra = {}) => {
      if (!montant) return;
      if (montant < 0) { montant = -montant; sens = sens === 'D' ? 'C' : 'D'; }
      lignes.push({ compte, libelleCompte, debit: sens === 'D' ? montant : 0, credit: sens === 'C' ? montant : 0, ...extra });
    };

    // Ventes HT et TVA, taux par taux
    let ventes = 0, tvaFichier = 0, ht = 0;
    for (const [t, cfg] of taux) {
      const h = centimes(f.valeur(col(cfg.colonneHt), l));
      const tvaTab = cfg.colonneTva && col(cfg.colonneTva) ? centimes(f.valeur(col(cfg.colonneTva), l)) : 0;
      const tva = config.tvaRecalculee ? Math.round(h * parseFloat(t) / 100) : tvaTab;
      ventes += h + tva; tvaFichier += tvaTab; ht += h;
      ajouter(cfg.compteVente, cfg.libelleVente || `Recettes ${t} %`, h, 'C', { taux: t, masse: 'Ventes HT' });
      ajouter(cfg.compteTva, cfg.libelleTva || `TVA ${t} %`, tva, 'C', { taux: t, masse: 'TVA collectée' });
    }

    // Encaissements, dans l'ordre de la fiche société ; toute autre colonne non vide bloque la journée
    let encaisse = 0;
    const montants = new Map(colsPaiement.map(e => [e.nom, centimes(f.valeur(e.c, l))]));
    for (const m of montants.values()) encaisse += m;
    for (const [nom, p] of Object.entries(paiements)) ajouter(p.compte, p.libelle || nom, montants.get(nom) || 0, 'D', { masse: 'Encaissements' });
    for (const e of colsPaiement) {
      const m = montants.get(e.nom);
      if (m && !paiements[e.nom]) anomalies.push(`colonne de paiement « ${f.valeur(e.c, lEntete)} » non paramétrée (${fmt(m)} €)`);
    }
    if (!lignes.length && !anomalies.length) continue;                    // jour de fermeture : aucune case renseignée

    const date = `${periode.annee}-${String(periode.mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
    if (jour > dernierJour) anomalies.push(`jour ${jour} inexistant dans ce mois`);

    const d = lignes.reduce((s, x) => s + x.debit, 0), c = lignes.reduce((s, x) => s + x.credit, 0);
    const ecart = encaisse - ventes;
    if (d !== c && !anomalies.length) {
      const ce = compteEcart(config, d - c);
      if (ce) {
        ajouter(ce.compte, ce.libelle, d - c, 'C', { masse: 'Écart de caisse' });
        alertes.push(`écart de caisse de ${fmt(ecart)} € (encaissements ${fmt(encaisse)} €, ventes TTC ${fmt(ventes)} €) passé en ${ce.compte}`);
      } else {
        anomalies.push(`journée déséquilibrée : encaissements ${fmt(encaisse)} €, ventes TTC ${fmt(ventes)} € (écart ${fmt(ecart)} €)`);
      }
    }
    totaux.encaisse += encaisse; totaux.ht += ht; totaux.tvaFichier += tvaFichier; totaux.ecart += encaisse - ht - tvaFichier;

    const piece = remplir(config.formatPiece || '{jj}/{mm}/{aaaa}', date);
    pieces.push({
      cle: `${config.journal}|${piece}|${date}`,
      journal: config.journal,
      piece, date,
      libelle: remplir(config.libellePiece || 'CAISSE {jj}/{mm}/{aaaa}', date),
      lignes, anomalies, alertes,
    });
  }

  // Rapprochement : totaux des lignes du tableau vs écritures produites
  const somme = (m, sens) => pieces.flatMap(p => p.lignes).filter(x => x.masse === m).reduce((s, x) => s + (sens === 'D' ? x.debit - x.credit : x.credit - x.debit), 0);
  const rapprochement = [
    { libelle: 'Encaissements', fichier: totaux.encaisse, ecritures: somme('Encaissements', 'D') },
    { libelle: 'Ventes HT', fichier: totaux.ht, ecritures: somme('Ventes HT', 'C') },
    { libelle: config.tvaRecalculee ? 'TVA (tableau / recalculée)' : 'TVA collectée', fichier: totaux.tvaFichier, ecritures: somme('TVA collectée', 'C') },
  ];
  const ecartEcr = somme('Écart de caisse', 'C');
  if (totaux.ecart || ecartEcr) rapprochement.push({ libelle: 'Écart de caisse', fichier: totaux.ecart, ecritures: ecartEcr });

  const dates = pieces.map(p => p.date).sort();
  return {
    pieces,
    resume: { journees: pieces.length, onglet: nomFeuille, periode: dates.length ? [dates[0], dates[dates.length - 1]] : null, rapprochement },
  };
}

module.exports = {
  id: 'tableau-caisse',
  nom: 'Tableau de caisse Excel (un onglet par mois, une ligne par jour)',
  accept: '.xlsx',
  importer, centimes, moisDepuisNom,
};

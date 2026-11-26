'use strict';
// Importeur générique pour les caisses qui exportent DÉJÀ des écritures comptables
// (une ligne par compte : date, compte, libellé, débit, crédit, n° de pièce…), séparateur tabulation ou ";".
// Exemples : export EXPORTCOMPTABLE de Jessi'faim, « Export du … au … » de Côte Piste.
//
// Traduction des comptes de la caisse vers ceux du dossier Pennylane (fiche société) :
//   - comptes 7…    -> "ventesParTaux" selon le taux de la ligne (colonne Taux, ou lu dans le libellé)
//   - comptes 4457… -> "tvaParTaux" selon le taux de la ligne
//   - autres        -> "comptesCaisse" (modes de paiement) ; absent = journée bloquée
// Une pièce par journée de caisse (n° de pièce + date).
//
// Montants lus en millièmes (certaines caisses exportent 3 décimales) puis arrondis au centime.
// Si la journée est équilibrée à l'arrondi près ("toleranceArrondiCentimes"), les centimes d'arrondi
// sont reportés sur la plus grosse ligne de vente de la journée. Au-delà : vrai écart de caisse
// ("compteEcart" s'il est défini, sinon journée bloquée).

const { lireCsv, enMilliemes, versCentimes, fmt } = require('./jalia-caisse');
const { compteEcart } = require('../lib/ecarts');

// Noms de colonnes acceptés (comparés sans accents ni majuscules), par ordre de préférence
const COLONNES = {
  date: ['date', 'ecrituredate'],
  journal: ['journalcode', 'journal'],
  compte: ['comptenum', 'compte'],
  libelle: ['libelle mouvement', 'ecriturelib', 'comptelib', 'libelle compte'],
  debit: ['debit'],
  credit: ['credit'],
  piece: ['pieceref', 'piece'],
  taux: ['taux'],
};
const FACULTATIVES = ['journal', 'taux', 'piece'];
const normaliser = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/�/g, 'e').trim().toLowerCase();

function decoder(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

// "01/09/2026", "01-09-26", "01-09-2026", "2026-09-01" -> "2026-09-01"
function lireDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})\b/);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  const jj = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0');
  if (+mm < 1 || +mm > 12 || +jj < 1 || +jj > 31) return null;
  return `${a}-${mm}-${jj}`;
}

// Taux de la ligne : colonne Taux ("20.000"), sinon libellé ("… 10,00 % …", "Tva 10.00%", "Bières_20.00")
function tauxDepuisLibelle(lib) {
  let m = String(lib).match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!m) m = String(lib).match(/_(\d+(?:[.,]\d+)?)\s*$/);
  return m ? String(parseFloat(m[1].replace(',', '.'))) : null;
}
function tauxLigne(l) {
  const t = String(l.taux || '').trim().replace(',', '.');
  if (t && !isNaN(parseFloat(t))) return String(parseFloat(t));
  return tauxDepuisLibelle(l.libelle);
}
// La caisse Jessi'faim remplace "à" par "?" : on le rétablit pour les libellés de ligne
const nettoyerLibelle = lib => String(lib).replace(/ \? (\d)/g, ' à $1').replace(/\s+/g, ' ').trim();

// Fichier sans ligne d'en-tête, colonnes à position fixe ("colonnesFixes"), montant + sens D/C (ex. HHM PERFORMANCE)
function lireLignesFixes(lignes, pos) {
  const col = (r, k) => (pos[k] !== undefined ? (r[pos[k]] || '') : '').trim();
  return lignes.filter(r => col(r, 'compte')).map((r, n) => {
    let debit = 0, credit = 0;
    if (pos.montant !== undefined) {
      const m = enMilliemes(col(r, 'montant'));
      const sens = col(r, 'sens').toUpperCase();
      if (sens !== 'D' && sens !== 'C') throw new Error(`ligne ${n + 1} : sens « ${col(r, 'sens')} » (attendu D ou C)`);
      if (sens === 'D') debit = m; else credit = m;
    } else { debit = enMilliemes(col(r, 'debit')); credit = enMilliemes(col(r, 'credit')); }
    if (debit < 0) { credit -= debit; debit = 0; }
    if (credit < 0) { debit -= credit; credit = 0; }
    return {
      n: n + 1, dateBrute: col(r, 'date'), date: lireDate(col(r, 'date')),
      journal: col(r, 'journal'), compte: col(r, 'compte'), libelle: col(r, 'libelle'),
      piece: col(r, 'piece'), taux: col(r, 'taux'),
      debitMil: debit, creditMil: credit, debit: versCentimes(debit), credit: versCentimes(credit),
    };
  });
}

function lireLignes(texte, config = {}) {
  const premiere = texte.replace(/^﻿/, '').split(/\r?\n/, 1)[0];
  const sep = premiere.includes('\t') ? '\t' : ';';
  const lignes = lireCsv(texte, sep).filter(l => l.some(c => c.trim() !== ''));
  if (config.colonnesFixes) {
    if (!lignes.length) throw new Error('fichier vide');
    return lireLignesFixes(lignes, config.colonnesFixes);
  }
  if (lignes.length < 2) throw new Error('fichier vide');
  const entete = lignes[0].map(normaliser);
  const idx = {};
  for (const [k, noms] of Object.entries(COLONNES)) {
    idx[k] = -1;
    for (const nom of noms) { const i = entete.indexOf(nom); if (i >= 0) { idx[k] = i; break; } }
    if (idx[k] < 0 && !FACULTATIVES.includes(k))
      throw new Error(`colonne « ${noms[0]} » introuvable : ce fichier ne ressemble pas à un export d'écritures de caisse`);
  }
  const col = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || '') : '').trim();
  return lignes.slice(1).map((r, n) => {
    let debit = enMilliemes(col(r, 'debit')), credit = enMilliemes(col(r, 'credit'));
    // Montant négatif (remise, avoir, rendu de monnaie) : passé de l'autre côté
    if (debit < 0) { credit -= debit; debit = 0; }
    if (credit < 0) { debit -= credit; credit = 0; }
    return {
      n: n + 2, dateBrute: col(r, 'date'), date: lireDate(col(r, 'date')),
      journal: col(r, 'journal'), compte: col(r, 'compte'), libelle: col(r, 'libelle'),
      piece: col(r, 'piece'), taux: col(r, 'taux'),
      debitMil: debit, creditMil: credit, debit: versCentimes(debit), credit: versCentimes(credit),
    };
  });
}

// Modèles de n° de pièce et de libellé : {piece} {num}=dernier nombre de la pièce ({piece}=26-09-3820 -> 3820)
// {libelle}=libellé de la 1re ligne, {date}=jj.mm.aaaa, {j} {m} {jj} {mm} {aa} {aaaa}
function remplir(modele, piece, date, libelle = '') {
  const [aaaa, mm, jj] = (date || '????-??-??').split('-');
  const num = (String(piece).match(/(\d+)\D*$/) || [, piece])[1];
  return modele.replace(/\{(piece|num|libelle|date|jj|mm|aaaa|aa|j|m)\}/g, (_, k) => ({
    piece, num, libelle: nettoyerLibelle(libelle), date: `${jj}.${mm}.${aaaa}`, jj, mm, aaaa, aa: aaaa.slice(2),
    j: String(parseInt(jj, 10)), m: String(parseInt(mm, 10)),
  })[k]);
}

// Traduction directe d'un compte : table exacte "comptes", puis préfixes "comptesParPrefixe" (le plus long gagne)
function traduireCompte(code, config) {
  if (config.comptes?.[code]) return config.comptes[code];
  const prefixes = Object.keys(config.comptesParPrefixe || {}).filter(p => code.startsWith(p)).sort((a, b) => b.length - a.length);
  return prefixes.length ? config.comptesParPrefixe[prefixes[0]] : null;
}
const tableDirecte = config => !!(config.comptes || config.comptesParPrefixe);

function masse(compteCaisse) {
  return compteCaisse.startsWith('7') ? 'Ventes HT' : compteCaisse.startsWith('4457') ? 'TVA collectée' : 'Encaissements';
}

function parser(texte, config, options = {}) {
  const lignes = lireLignes(texte, config);
  const anomalieFichier = (config.motifNomFichier && options.nomFichier &&
    !options.nomFichier.toUpperCase().includes(config.motifNomFichier.toUpperCase()))
    ? `le nom du fichier ne contient pas « ${config.motifNomFichier} » : est-ce bien un export de ${config.nom} ?`
    : null;
  const toleranceMil = (config.toleranceArrondiCentimes || 0) * 10;

  // Regroupement par journée de caisse (n° de pièce + date)
  const groupes = new Map();
  for (const l of lignes) {
    const k = `${l.piece}|${l.date}`;
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(l);
  }

  const pieces = [];
  for (const [, ls] of groupes) {
    const { date } = ls[0];
    const piece = remplir(config.formatPiece || '{piece}', ls[0].piece, date, ls[0].libelle);
    const anomalies = anomalieFichier ? [anomalieFichier] : [];
    const alertes = [];
    if (!date) anomalies.push(`date illisible « ${ls[0].dateBrute} »`);
    if (!piece) anomalies.push('numéro de pièce vide');
    const journaux = [...new Set(ls.map(l => l.journal).filter(Boolean))];
    if (config.journalCaisse && journaux.some(j => j !== config.journalCaisse))
      alertes.push(`journal de la caisse « ${journaux.join(', ')} » (attendu ${config.journalCaisse})`);

    const lignesEcr = [];
    let dMil = 0, cMil = 0, d = 0, c = 0;
    for (const l of ls) {
      dMil += l.debitMil; cMil += l.creditMil; d += l.debit; c += l.credit;
      if (!l.debit && !l.credit) continue;                         // lignes à zéro (ou < 0,005 €) : ignorées
      let compte = null;
      let taux = null;                                             // taux de la ligne : sert à choisir le bon compte Pennylane
      const direct = traduireCompte(l.compte, config);
      if (direct) {
        compte = direct;
        if (l.compte.startsWith('7') || l.compte.startsWith('4457')) taux = tauxLigne(l);
      } else if (tableDirecte(config) && !config.ventesParTaux && !config.comptesCaisse?.[l.compte]) {
        anomalies.push(`compte « ${l.compte} » (${nettoyerLibelle(l.libelle)}) non paramétré (${fmt(l.debit || l.credit)} €)`);
      } else if (l.compte.startsWith('7')) {
        taux = tauxLigne(l);
        compte = taux !== null ? config.ventesParTaux?.[taux] : null;
        if (!compte) anomalies.push(`vente à ${taux ?? '?'} % (« ${nettoyerLibelle(l.libelle)} ») : compte de vente non paramétré pour ce taux`);
      } else if (l.compte.startsWith('4457')) {
        taux = tauxLigne(l);
        compte = taux !== null ? config.tvaParTaux?.[taux] : null;
        if (!compte) anomalies.push(`TVA à ${taux ?? '?'} % : compte de TVA non paramétré pour ce taux`);
      } else {
        compte = config.comptesCaisse?.[l.compte]?.compte;
        if (!compte) anomalies.push(`compte de caisse « ${l.compte} – ${l.libelle} » non paramétré (${fmt(l.debit || l.credit)} €)`);
      }
      if (!compte) continue;
      lignesEcr.push({
        compte,
        libelleCompte: config.comptesCaisse?.[l.compte]?.libelle || nettoyerLibelle(l.libelle),
        debit: l.debit, credit: l.credit,
        masse: masse(l.compte),
        ...(taux !== null ? { taux } : {}),
      });
    }

    let arrondi = 0;
    const ecartMil = dMil - cMil;
    if (Math.abs(ecartMil) <= toleranceMil) {
      // Équilibrée au millième près : les centimes perdus à l'arrondi vont sur la plus grosse vente du jour
      const r = d - c;
      if (r) {
        const ventes = lignesEcr.filter(l => l.masse === 'Ventes HT' && l.credit > 0);
        if (ventes.length) {
          const cible = ventes.reduce((a, b) => (b.credit > a.credit ? b : a));
          cible.credit += r;
          arrondi = r;
        } else {
          anomalies.push(`écart d'arrondi de ${fmt(r)} € sans ligne de vente pour l'absorber`);
        }
      }
    } else {
      const ecart = d - c;    // > 0 : encaissements supérieurs aux ventes
      const ce = compteEcart(config, ecart);
      if (ce) {
        // Écart passé sur le compte prévu par la société (658/758 si petit, sinon ex. 471), au crédit si excédent, au débit si manque
        lignesEcr.push({ compte: ce.compte, libelleCompte: ce.libelle,
          debit: ecart < 0 ? -ecart : 0, credit: ecart > 0 ? ecart : 0, masse: 'Écart de caisse' });
        alertes.push(`écart de caisse de ${fmt(ecart)} € (encaissements ${fmt(d)} €, ventes + TVA ${fmt(c)} €) passé en ${ce.compte}`);
      } else {
        anomalies.push(`journée déséquilibrée dans le fichier de la caisse : encaissements ${fmt(d)} €, ventes + TVA ${fmt(c)} € (écart ${fmt(ecart)} €)`);
      }
    }

    pieces.push({
      cle: `${config.journal}|${piece}|${date}`,
      journal: config.journal,
      piece,
      date,
      libelle: remplir(config.libellePiece || 'CAISSE {date}', ls[0].piece, date, ls[0].libelle),
      lignes: lignesEcr,
      arrondi,
      anomalies: [...new Set(anomalies)],
      alertes,
    });
  }

  return { pieces, lignes };
}

// Rapprochement : total du fichier (lignes arrondies au centime) vs total des écritures, par grande masse
function rapprocher(pieces, lignes, config = {}) {
  const fichier = {}, ecr = {};
  for (const l of lignes) { const m = masse(l.compte); fichier[m] = (fichier[m] || 0) + l.debit - l.credit; }
  for (const p of pieces) for (const l of p.lignes) ecr[l.masse] = (ecr[l.masse] || 0) + l.debit - l.credit;
  const arrondis = pieces.reduce((s, p) => s + (p.arrondi || 0), 0);
  if (arrondis) ecr['Ventes HT'] = (ecr['Ventes HT'] || 0) + arrondis;   // neutralise les arrondis pour comparer
  const res = ['Encaissements', 'Ventes HT', 'TVA collectée'].filter(m => m in fichier)
    .map(m => ({ libelle: config.libellesMasses?.[m] || m, fichier: Math.abs(fichier[m]), ecritures: Math.abs(ecr[m] || 0) }));
  // Écart du fichier = encaissements - (ventes + TVA) hors arrondis ; doit égaler le total passé sur le compte d'écart
  const ecartFichier = Object.values(fichier).reduce((a, b) => a + b, 0) - arrondis;
  if (ecartFichier || ecr['Écart de caisse']) res.push({ libelle: 'Écart de caisse', fichier: ecartFichier, ecritures: -(ecr['Écart de caisse'] || 0) });
  if (arrondis) res.push({ libelle: 'Arrondis au centime reportés sur les ventes', fichier: 0, ecritures: arrondis, info: true });
  return res;
}

module.exports = {
  id: 'ecritures-caisse',
  nom: 'Export d\'écritures de caisse (date, compte, libellé, débit, crédit, pièce)',
  accept: '.csv,.txt,.tsv',
  importer(buffer, config, { nomFichier = '' } = {}) {
    const { pieces, lignes } = parser(decoder(buffer), config, { nomFichier });
    const dates = pieces.map(p => p.date).filter(Boolean).sort();
    return {
      pieces,
      resume: {
        journees: pieces.length,
        periode: dates.length ? [dates[0], dates[dates.length - 1]] : null,
        rapprochement: rapprocher(pieces, lignes, config),
      },
    };
  },
  parser, rapprocher, tauxDepuisLibelle, nettoyerLibelle, lireDate, remplir, traduireCompte,
};

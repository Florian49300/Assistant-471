'use strict';
// Parseur de l'export comptable Jalia (CSV ";", 2 lignes d'en-tête, une ligne par journée de caisse).
// Étape 1 : lecture des journées (montants en millièmes, comme dans le fichier).
// Étape 2 : regroupement en pièces, par mois (défaut, comme la saisie du cabinet) ou par jour.
// Sortie au format commun : { cle, journal, piece, date, libelle, lignes[], anomalies[], alertes[], source }
// Montants des lignes en centimes entiers.

// ---------- Lecture CSV ----------
function lireCsv(texte, sep = ';') {
  texte = texte.replace(/^﻿/, '');
  const lignes = [];
  let ligne = [], champ = '', guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); lignes.push(ligne); ligne = []; champ = '';
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

// "734.200" / "1 225,39" / "0" -> millièmes entiers (sans flottant)
function enMilliemes(v) {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (s === '') return 0;
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const m = s.match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m) throw new Error(`Montant illisible : "${v}"`);
  const signe = m[1] ? -1 : 1;
  const dec = ((m[3] || '') + '000').slice(0, 3);
  return signe * (parseInt(m[2] || '0', 10) * 1000 + parseInt(dec, 10));
}
// millièmes -> centimes, arrondi commercial (demi s'éloigne de zéro)
const versCentimes = mil => Math.sign(mil) * Math.round(Math.abs(mil) / 10);
const enCentimes = v => versCentimes(enMilliemes(v));

function dateIso(v) {
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function finDeMois(iso) {
  const [a, m] = iso.split('-').map(Number);
  const j = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}
// "TVA 5,50 (5,50%) (€)" -> "5.5" ; "Remise TVA ..." / "tax par salle ..." -> null
function tauxDepuis(groupe) {
  const m = groupe.match(/^TVA\b.*\((\d+(?:[.,]\d+)?)\s*%\)/);
  return m ? String(parseFloat(m[1].replace(',', '.'))) : null;
}
function caisseDepuisNomFichier(nom) {
  const m = String(nom).match(/accounting_(\d+)_/);
  return m ? m[1] : '';
}
const fmt = c => (c / 100).toFixed(2).replace('.', ',');
const { compteEcart } = require('../lib/ecarts');

// ---------- Étape 1 : journées ----------
function lireJournees(texte) {
  const lignes = lireCsv(texte).filter(l => l.some(c => c.trim() !== ''));
  if (lignes.length < 3) throw new Error('Fichier vide ou en-têtes absents');
  const cols = [];
  let groupe = '';
  for (let i = 0; i < Math.max(lignes[0].length, lignes[1].length); i++) {
    if ((lignes[0][i] || '').trim() !== '') groupe = lignes[0][i].trim();
    cols.push({ i, groupe, sous: (lignes[1][i] || '').trim() });
  }
  const val = (row, g, s) => { const c = cols.find(c => c.groupe === g && c.sous === s); return c ? row[c.i] : undefined; };
  const colsPaiement = cols.filter(c => c.groupe === 'Modes de paiement');
  const groupesTva = [...new Set(cols.map(c => c.groupe))].filter(tauxDepuis);
  if (!colsPaiement.length || !groupesTva.length) throw new Error('Colonnes "Modes de paiement" ou "TVA" introuvables : ce fichier ne ressemble pas à un export Jalia');

  const lire = row => ({
    debut: val(row, 'Début', 'Date'),
    fin: val(row, 'Fin', 'Date'),
    date: dateIso(val(row, 'Début', 'Date')),
    brut: enMilliemes(val(row, 'Total Brut', 'TTC')),
    reductions: enMilliemes(val(row, 'Total réductions', 'TTC')),
    net: enMilliemes(val(row, 'Total Net', 'TTC')),
    pourboires: enMilliemes(val(row, 'Pourboires', 'Total pourboires')),
    ecart: enMilliemes(val(row, 'Ecart', 'Montant')),
    mouvements: enMilliemes(val(row, 'Mouvements', 'Montant')),
    paiements: Object.fromEntries(colsPaiement.map(c => [c.sous, enMilliemes(row[c.i])])),
    tva: Object.fromEntries(groupesTva.map(g => [tauxDepuis(g), {
      ttc: enMilliemes(val(row, g, 'TTC')), taxe: enMilliemes(val(row, g, 'Taxe')) }])),
  });

  const journees = [];
  let total = null;
  for (const row of lignes.slice(2)) {
    if ((row[0] || '').trim().toLowerCase() === 'total') total = lire(row);
    else journees.push(lire(row));
  }
  return { journees, total };
}

// Contrôles propres à une journée (en centimes, comme le ticket Z)
function controlerJournee(j, config = {}) {
  const anomalies = [], alertes = [];
  if (!j.date) anomalies.push(`date illisible "${j.debut}"`);
  const net = versCentimes(j.net);
  const encaisse = Object.values(j.paiements).reduce((s, m) => s + versCentimes(m), 0);
  const ventile = Object.values(j.tva).reduce((s, t) => s + versCentimes(t.ttc), 0);
  const pb = versCentimes(j.pourboires);
  if (ventile !== net) anomalies.push(`ventilation TVA ${fmt(ventile)} € ≠ Total Net ${fmt(net)} €`);
  // Encaissements ≠ ventes : écart de caisse, passé en 658 / 758 / 471 si la fiche le prévoit (voir construirePiece), sinon bloquant
  if (encaisse !== net + pb && !compteEcart(config, encaisse - net - pb))
    anomalies.push(`encaissements ${fmt(encaisse)} € ≠ Total Net + pourboires ${fmt(net + pb)} €`);
  if (j.ecart) alertes.push(`écart de caisse déclaré ${fmt(versCentimes(j.ecart))} €`);
  if (j.mouvements) alertes.push(`mouvements de caisse ${fmt(versCentimes(j.mouvements))} € (non comptabilisés)`);
  if (pb) alertes.push(`pourboires ${fmt(pb)} €`);
  return { anomalies, alertes };
}

// ---------- Étape 2 : pièces ----------
function construirePiece(journees, config, { cle, piece, date, libelle }) {
  const anomalies = [], alertes = [];
  const multi = journees.length > 1;
  for (const j of journees) {
    const r = controlerJournee(j, config);
    const pref = multi ? `${j.date || j.debut} : ` : '';
    anomalies.push(...r.anomalies.map(a => pref + a));
    alertes.push(...r.alertes.map(a => pref + a));
  }
  const somme = f => journees.reduce((s, j) => s + f(j), 0);
  const lignes = [];
  const ajouter = (compte, libelleCompte, montant, sens, taux) => {
    if (!montant) return;
    if (montant < 0) { montant = -montant; sens = sens === 'D' ? 'C' : 'D'; }
    lignes.push({ compte, libelleCompte, debit: sens === 'D' ? montant : 0, credit: sens === 'C' ? montant : 0, ...(taux ? { taux } : {}) });
  };

  // Encaissements (débit), dans l'ordre de la config
  const modes = Object.keys(journees[0]?.paiements || {});
  for (const mode of modes) if (somme(j => j.paiements[mode]) && !config.paiements[mode])
    anomalies.push(`mode de paiement non paramétré : "${mode}"`);
  for (const [mode, p] of Object.entries(config.paiements))
    ajouter(p.compte, p.libelle, versCentimes(somme(j => j.paiements[mode] || 0)), 'D');

  ajouter(config.pourboires.compte, config.pourboires.libelle, versCentimes(somme(j => j.pourboires)), 'C');

  // TVA puis ventes : TVA = arrondi du cumul de la période, HT = TTC - TVA
  const taux = Object.keys(journees[0]?.tva || {});
  const detailTva = {};
  for (const t of taux) {
    const ttc = versCentimes(somme(j => j.tva[t].ttc));
    const tva = versCentimes(somme(j => j.tva[t].taxe));
    if (!ttc && !tva) continue;
    detailTva[t] = { ttc, tva, ht: ttc - tva };
    if (!config.tva[t]) anomalies.push(`taux de TVA ${t} % non paramétré`);
    const theorique = Math.round((ttc - tva) * parseFloat(t) / 100);
    if (Math.abs(theorique - tva) > (config.toleranceTvaCentimes ?? 2))
      alertes.push(`TVA ${t} % : ${fmt(tva)} € dans le fichier, ${fmt(theorique)} € attendus sur ${fmt(ttc - tva)} € HT`);
  }
  const parCompte = k => Object.entries(detailTva).filter(([t]) => config.tva[t]).sort((a, b) => config.tva[a[0]][k].localeCompare(config.tva[b[0]][k]));
  for (const [t, d] of parCompte('compteTva')) ajouter(config.tva[t].compteTva, `TVA ${config.tva[t].libelle}`, d.tva, 'C', t);
  for (const [t, d] of parCompte('compteVente')) ajouter(config.tva[t].compteVente, `VENTES ${config.tva[t].libelle}`, d.ht, 'C', t);

  // Écart de caisse : la pièce est rééquilibrée sur le compte prévu (658 manque / 758 excédent sous 1 €, sinon 471…)
  const d = lignes.reduce((x, l) => x + l.debit, 0), c = lignes.reduce((x, l) => x + l.credit, 0);
  if (d !== c && !anomalies.length) {
    const ce = compteEcart(config, d - c);
    if (ce) {
      lignes.push({ compte: ce.compte, libelleCompte: ce.libelle, debit: d < c ? c - d : 0, credit: d > c ? d - c : 0, masse: 'Écart de caisse' });
      alertes.push(`écart de caisse de ${fmt(d - c)} € (encaissements ${fmt(d)} €, ventes TTC ${fmt(c)} €) passé en ${ce.compte}`);
    }
  }

  return {
    cle, journal: config.journal, piece, date, libelle, lignes, anomalies, alertes,
    source: {
      journees: journees.length,
      brutTtc: versCentimes(somme(j => j.brut)),
      reductions: versCentimes(somme(j => j.reductions)),
      netTtc: versCentimes(somme(j => j.net)),
      tva: detailTva,
    },
  };
}

function parser(texte, config, options = {}) {
  const { journees, total } = lireJournees(texte);
  const caisseId = config.caisseId || options.caisseId || '';
  const caisse = caisseId ? `${caisseId}-` : '';
  const mode = options.regroupement || config.regroupement || 'mois';
  const pieces = [];
  // Garde-fou multi-sociétés : le n° de caisse du nom de fichier doit être celui de la société choisie
  const anomalieFichier = (config.caisseId && options.caisseId && options.caisseId !== config.caisseId)
    ? `le fichier vient de la caisse ${options.caisseId}, la société choisie attend la caisse ${config.caisseId}`
    : null;

  if (mode === 'jour') {
    for (const j of journees) {
      const d = j.date || 'XXXX-XX-XX';
      const piece = `${config.prefixePiece}${caisse}${d.replace(/-/g, '')}`;
      const p = construirePiece([j], config, {
        cle: `${config.journal}|${piece}|${d}`, piece, date: j.date,
        libelle: `CAISSE ${d.split('-').reverse().join('.')}`,
      });
      // Une écriture mensuelle déjà saisie à la main ("CAISSE 09.2026") ferait double emploi
      p.libellesEnConflit = j.date ? [`CAISSE ${d.slice(5, 7)}.${d.slice(0, 4)}`] : [];
      pieces.push(p);
    }
  } else {
    const parMois = new Map();
    for (const j of journees) {
      const k = j.date ? j.date.slice(0, 7) : 'inconnu';
      if (!parMois.has(k)) parMois.set(k, []);
      parMois.get(k).push(j);
    }
    for (const [mois, js] of parMois) {
      const date = mois === 'inconnu' ? null : finDeMois(`${mois}-01`);
      const [a, m] = mois.split('-');
      const piece = `${config.prefixePiece}${caisse}${a}${m || ''}`;
      pieces.push(construirePiece(js, config, {
        cle: `${config.journal}|${piece}|${date}`, piece, date, libelle: `CAISSE ${m}.${a}`,
      }));
    }
  }

  // Totaux de la ligne "Total" du fichier, en centimes, pour rapprochement
  const totauxFichier = total && {
    netTtc: versCentimes(total.net),
    paiements: Object.fromEntries(Object.entries(total.paiements).map(([k, v]) => [k, versCentimes(v)])),
    tva: Object.fromEntries(Object.entries(total.tva).map(([k, v]) => [k, { ttc: versCentimes(v.ttc), tva: versCentimes(v.taxe) }])),
  };
  if (anomalieFichier) for (const p of pieces) p.anomalies.unshift(anomalieFichier);
  return { pieces, journees, totauxFichier };
}

// Rapprochement avec la ligne "Total" du fichier, affiché dans la page
function rapprocher(pieces, totauxFichier, config) {
  if (!totauxFichier) return [];
  const lignes = pieces.flatMap(p => p.lignes);
  const solde = (compte, libelle) => lignes.filter(l => l.compte === compte && (!libelle || l.libelleCompte === libelle))
    .reduce((s, l) => s + l.debit - l.credit, 0);
  const res = [];
  for (const [mode, m] of Object.entries(totauxFichier.paiements)) {
    const p = config.paiements[mode];
    const c = p ? solde(p.compte, p.libelle) : 0;
    if (m || c) res.push({ libelle: mode, fichier: m, ecritures: c });
  }
  for (const [t, v] of Object.entries(totauxFichier.tva)) {
    const cfg = config.tva[t]; if (!cfg) continue;
    const tva = -solde(cfg.compteTva);
    res.push({ libelle: `TVA ${t} %`, fichier: v.tva, ecritures: tva });
    res.push({ libelle: `Ventes TTC ${t} %`, fichier: v.ttc, ecritures: tva - solde(cfg.compteVente) });
  }
  return res;
}

// Décodage : UTF-8, repli Windows-1252 si le fichier n'est pas de l'UTF-8 valide
function decoder(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

// ---------- Interface commune des importeurs ----------
module.exports = {
  id: 'jalia-caisse',
  nom: 'Export comptable Jalia (CSV, une ligne par Z de caisse)',
  accept: '.csv',
  importer(buffer, config, { nomFichier = '' } = {}) {
    const res = parser(decoder(buffer), config, { caisseId: caisseDepuisNomFichier(nomFichier) });
    return {
      pieces: res.pieces,
      resume: {
        journees: res.journees.length,
        periode: res.journees.length ? [res.journees[0].date, res.journees[res.journees.length - 1].date] : null,
        rapprochement: rapprocher(res.pieces, res.totauxFichier, config),
      },
    };
  },
  // utilitaires exposés pour les tests et l'outil en ligne de commande
  parser, rapprocher, lireCsv, enMilliemes, enCentimes, versCentimes, dateIso, finDeMois, tauxDepuis, caisseDepuisNomFichier, fmt,
};

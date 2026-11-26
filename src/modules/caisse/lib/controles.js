'use strict';
// Contrôles hors ligne (sans Pennylane). Les contrôles journal/comptes/doublons Pennylane viendront dans lib/sync.js.

// Chiffre d'affaires d'une pièce (pour le contrôle avec le ticket Z) : ventes HT + TVA collectée, nets des remises.
// Lignes repérées par leur « masse » quand l'importeur la fournit, sinon par le compte (7… ventes, 4457… TVA).
function chiffreAffaires(lignes) {
  let ht = 0, tva = 0;
  for (const l of lignes) {
    const m = l.masse || (String(l.compte).startsWith('4457') ? 'TVA collectée' : String(l.compte).startsWith('7') ? 'Ventes HT' : null);
    if (m === 'Ventes HT') ht += l.credit - l.debit;
    else if (m === 'TVA collectée') tva += l.credit - l.debit;
  }
  return { ht, tva, ttc: ht + tva };
}

function controler(pieces) {
  const vues = new Set();
  for (const p of pieces) {
    const raisons = [...p.anomalies];
    const d = p.lignes.reduce((s, l) => s + l.debit, 0);
    const c = p.lignes.reduce((s, l) => s + l.credit, 0);
    // Déséquilibre signalé seulement s'il n'est pas déjà expliqué par une anomalie de l'importeur
    if (d !== c && !p.anomalies.length) raisons.push(`déséquilibrée (débit ${d / 100} / crédit ${c / 100})`);
    if (!p.lignes.length) raisons.push('aucune ligne');
    for (const l of p.lignes) {
      // Numéro de compte : commence par un chiffre ; lettres admises (comptes auxiliaires Pennylane du type 411CB0000)
      if (!/^[0-9][0-9A-Z]{2,11}$/i.test(l.compte)) raisons.push(`compte invalide "${l.compte}"`);
      if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0)
        raisons.push(`montant invalide sur ${l.compte}`);
    }
    if (!p.date || isNaN(Date.parse(p.date))) raisons.push('date invalide');
    if (vues.has(p.cle)) raisons.push('pièce en double dans le fichier');
    vues.add(p.cle);
    p.totalDebit = d; p.totalCredit = c;
    p.ca = chiffreAffaires(p.lignes);
    p.statut = raisons.length ? 'bloquée' : 'prête';
    p.raisons = raisons;
  }
  return pieces;
}

module.exports = { controler, chiffreAffaires };

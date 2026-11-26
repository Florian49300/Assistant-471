'use strict';
// Choix du compte pour l'écart d'une journée de caisse (écart = encaissements - ventes TTC, en centimes).
// - "petitsEcarts" : sous le seuil, excédent (écart > 0, ligne au crédit) en 758, manque (écart < 0, ligne au débit) en 658
// - sinon "compteEcart" (ex. 471000000, compte d'attente)
// - sinon null : la journée sera bloquée
function compteEcart(config, ecart) {
  const p = config.petitsEcarts;
  if (p && Math.abs(ecart) < (p.seuilCentimes ?? 100)) {
    const c = ecart > 0 ? p.compteExcedent : p.compteManque;
    if (c?.compte) return { compte: c.compte, libelle: c.libelle || (ecart > 0 ? 'Excédent de caisse' : 'Manque de caisse') };
  }
  if (config.compteEcart?.compte) return { compte: config.compteEcart.compte, libelle: config.compteEcart.libelle || 'Ecart de caisse' };
  return null;
}
module.exports = { compteEcart };

'use strict';
/**
 * Registre des outils (« briques ») du portail.
 *
 * Pour AJOUTER un outil :
 *   1. créer src/modules/mon-outil.js qui exporte  (ctx) => express.Router()
 *      (voir assistant471.js comme modèle ; ctx fournit connexion, CSRF, journal…) ;
 *   2. mettre ses pages dans views/mon-outil/ (elles incluent partials/haut et partials/bas) ;
 *   3. ajouter une entrée ci-dessous.
 * La tuile apparaît alors sur la page d'accueil et l'outil est servi sous `chemin`.
 *
 * Une entrée sans `routeur` s'affiche comme une tuile « Bientôt disponible ».
 */

// Icônes au trait (24×24), dans le style des tuiles du cabinet
const ICONES = {
  balance:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v17M7 20.5h10M5 7.5h14"/><path d="m5 7.5-2.5 6a3 3 0 0 0 5 0z"/><path d="m19 7.5-2.5 6a3 3 0 0 0 5 0z"/></svg>',
  caisse:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h12v6H6z"/><path d="M8.5 6.5h7"/><path d="M4 13.5 5.5 9.5h13l1.5 4v6.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 16.5h16M8 13h.01M12 13h.01M16 13h.01"/></svg>',
  voiture:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16.5V12l2-5h12l2 5v4.5"/><path d="M3.5 12h17M4 16.5h16"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/></svg>',
};

module.exports = [
  {
    id: '471',
    titre: 'Assistant 471',
    description:
      "Comptes d'attente 4716 / 4717 : opérations à justifier par dossier, tableaux Dépenses / Recettes et mail client prêt à envoyer.",
    tags: ['Pennylane', 'Dépenses / Recettes', 'Mail Outlook'],
    icone: ICONES.balance,
    chemin: '/471',
    routeur: require('./assistant471'),
  },
  {
    id: 'tvs',
    titre: 'TVS 2026',
    description:
      'Vérification des taxes sur les véhicules de tourisme 2026 (CO₂ + polluants) : parc, prorata, exonérations et écart avec le déclaré.',
    tags: ['CO₂ + polluants', 'Contrôle 3310-A / 3517', 'Export CSV'],
    icone: ICONES.voiture,
    chemin: '/tvs',
    routeur: require('./tvs'),
  },
  {
    id: 'caisse',
    titre: 'Import caisse',
    description:
      'Fichiers de ventes des clients (caisses, factures) transformés en écritures et créés dans leur dossier Pennylane, après contrôle et confirmation.',
    tags: ['Pennylane', 'Caisses / Z', 'Envoi contrôlé'],
    icone: ICONES.caisse,
    chemin: '/caisse',
    routeur: require('./caisse/routeur'),
  },
];

/**
 * TVS 2026 – moteur de calcul (taxes sur l'affectation des véhicules de tourisme à des fins économiques).
 * Année d'imposition 2026 (déclaration janvier 2027). Voir docs/TVS_2026_contexte.md.
 *
 * Fichier partagé : chargé par le navigateur (window.TVS) ET par Node (require) pour les tests.
 * Aucun accès réseau, aucune dépendance.
 */
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.TVS = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ANNEE = 2026;
  var NB_JOURS = 365; // 2026 non bissextile
  var IDX_1ER_MARS = 59; // 01/03/2026 = 60e jour (index 59)

  // §4.1 – [borne basse, borne haute incluse (null = sans limite), tarif marginal €]
  var BAREMES = {
    WLTP: [[0, 4, 0], [5, 45, 1], [46, 53, 2], [54, 85, 3], [86, 105, 4], [106, 125, 10], [126, 145, 50], [146, 165, 60], [166, null, 65]],
    NEDC: [[0, 3, 0], [4, 37, 1], [38, 44, 2], [45, 70, 3], [71, 87, 4], [88, 103, 10], [104, 120, 50], [121, 136, 60], [137, null, 65]],
    PA: [[0, 3, 2000], [4, 6, 3000], [7, 10, 4500], [11, 15, 5250], [16, null, 6500]],
  };

  // §4.3 – tarifs polluants
  var POLLUANTS = {
    E: { ancien: 0, t2026: 0, libelle: 'E – électrique / hydrogène' },
    1: { ancien: 100, t2026: 130, libelle: "1 – allumage commandé Euro 5/6 (Crit'Air 1)" },
    P: { ancien: 500, t2026: 650, libelle: 'Plus polluants' },
  };

  // §2.1
  var ENERGIES = {
    essence: { libelle: 'Essence', exonere: false, diesel: false },
    diesel: { libelle: 'Gazole', exonere: false, diesel: true },
    hev_ess: { libelle: 'Hybride essence (HEV/MHEV)', exonere: false, diesel: false },
    phev_ess: { libelle: 'Hybride rechargeable essence', exonere: false, diesel: false },
    hyb_dsl: { libelle: 'Hybride gazole', exonere: false, diesel: true },
    e85: { libelle: 'Superéthanol E85', exonere: false, diesel: false },
    gaz: { libelle: 'GPL / GNV', exonere: false, diesel: false },
    elec: { libelle: 'Électrique', exonere: true, diesel: false },
    h2: { libelle: 'Hydrogène', exonere: true, diesel: false },
  };

  var EXONERATIONS = {
    exFauteuil: 'Véhicule accessible en fauteuil roulant',
    exEI: 'Entreprise individuelle',
    exActivite: 'Activité exonérée',
    exLCD: 'Location courte durée',
  };

  /** Arrondi fiscal : euro le plus proche, 0,5 compte pour 1. */
  function arrondi(x) { return Math.floor(x + 0.5 + 1e-9); }

  /** 'AAAA-MM-JJ' -> index de jour en 2026 (0 = 01/01, 364 = 31/12) ; peut être < 0 ou > 364. */
  function indexJour(iso) {
    var p = String(iso || '').split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return null;
    return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(ANNEE, 0, 1)) / 86400000);
  }

  /** Index de jour -> 'AAAA-MM-JJ'. */
  function dateDeIndex(i) {
    return new Date(Date.UTC(ANNEE, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  }

  /** Normalise `days` (365 booléens OU liste de périodes [début, fin]) en tableau de 365 booléens. */
  function joursAffectes(days) {
    var j = new Array(NB_JOURS).fill(false);
    if (!Array.isArray(days)) return j;
    if (days.length === NB_JOURS && days.every(function (d) { return typeof d === 'boolean'; })) return days.slice();
    days.forEach(function (p) {
      if (!Array.isArray(p) || p.length < 2) return;
      var a = Math.max(0, Math.min(p[0], p[1])), b = Math.min(NB_JOURS - 1, Math.max(p[0], p[1]));
      for (var i = a; i <= b; i++) j[i] = true;
    });
    return j;
  }

  /** 365 booléens -> liste de périodes [début, fin]. */
  function periodes(jours) {
    var res = [], debut = null;
    for (var i = 0; i <= NB_JOURS; i++) {
      var on = i < NB_JOURS && jours[i];
      if (on && debut === null) debut = i;
      if (!on && debut !== null) { res.push([debut, i - 1]); debut = null; }
    }
    return res;
  }

  /** §3 – barème selon la date de 1re immatriculation. */
  function methodeAuto(dateImmat) {
    if (!dateImmat) return null;
    if (dateImmat >= '2020-03-01') return 'WLTP';
    if (dateImmat >= '2004-06-01') return 'NEDC';
    return 'PA';
  }

  /** §4.1 – tarif annuel et détail par tranche. */
  function appliquerBareme(methode, valeur) {
    var detail = [], total = 0;
    BAREMES[methode].forEach(function (t, k) {
      var basse = t[0], haute = t[1] === null ? Infinity : t[1];
      var unites = k === 0 ? Math.min(valeur, haute) : Math.min(valeur, haute) - basse + 1;
      unites = Math.max(0, unites);
      var montant = unites * t[2];
      total += montant;
      detail.push({ basse: basse, haute: t[1], tarif: t[2], unites: unites, montant: montant });
    });
    return { tarif: total, detail: detail };
  }

  function nombre(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(String(v).replace(',', '.').replace(/\s/g, ''));
    return isFinite(n) ? n : null;
  }

  /**
   * §5 – calcul pour un véhicule.
   * @param {object} v  données du véhicule (§2)
   * @param {string} polMode  'annuel' (défaut) | 'mars'
   */
  function calculerVehicule(v, polMode) {
    polMode = polMode === 'mars' ? 'mars' : 'annuel';
    var alertes = [];
    var energie = ENERGIES[v.energie] ? v.energie : null;
    if (!energie) alertes.push("Type d'énergie manquant.");
    if (!v.dateImmat) alertes.push('Date de 1re immatriculation manquante.');
    var nrj = ENERGIES[energie] || { exonere: false, diesel: false, libelle: '?' };

    // 1. méthode et catégorie polluants
    var methode = v.methode && v.methode !== 'auto' ? v.methode : methodeAuto(v.dateImmat);
    var euro = v.euro && v.euro !== 'auto' ? String(v.euro) : v.dateImmat && v.dateImmat >= '2011-01-01' ? '1' : '2';
    var categorie = nrj.exonere ? 'E' : nrj.diesel ? 'P' : euro === '1' ? '1' : 'P';

    // 2. jours et prorata
    var jours = joursAffectes(v.days);
    var nbJours = jours.filter(Boolean).length;
    var prorata = nbJours / NB_JOURS;
    var iImmat = indexJour(v.dateImmat);
    if (iImmat !== null && iImmat > 0) {
      var avant = jours.slice(0, Math.min(iImmat, NB_JOURS)).filter(Boolean).length;
      if (avant) alertes.push(avant + " jour(s) d'affectation avant la date de 1re immatriculation.");
    }
    if (!nbJours) alertes.push("Aucun jour d'affectation en 2026.");

    // 3-4. taxe CO2
    var valeur = null, valeurRetenue = null, abattement = false, tarifCO2 = 0, detail = [];
    if (!nrj.exonere && methode) {
      valeur = nombre(methode === 'PA' ? v.cv : v.co2);
      if (valeur === null) {
        alertes.push(methode === 'PA' ? 'Puissance administrative (CV) manquante.' : 'Émissions de CO₂ (g/km) manquantes.');
      } else {
        valeurRetenue = valeur;
        if (energie === 'e85') {
          if (methode === 'PA' && valeur <= 12) { valeurRetenue = Math.max(0, valeur - 2); abattement = true; }
          if (methode !== 'PA' && valeur <= 250) { valeurRetenue = arrondi(valeur * 0.6); abattement = true; }
        }
        var b = appliquerBareme(methode, valeurRetenue);
        tarifCO2 = b.tarif;
        detail = b.detail;
      }
    }
    var taxeCO2 = arrondi(tarifCO2 * prorata);

    // 5. taxe polluants
    var pol = POLLUANTS[categorie];
    var taxePolluantsAnnuel = arrondi(pol.t2026 * prorata);
    var joursAvantMars = jours.slice(0, IDX_1ER_MARS).filter(Boolean).length;
    var joursDepuisMars = nbJours - joursAvantMars;
    var taxePolluantsMars = arrondi((pol.ancien * joursAvantMars + pol.t2026 * joursDepuisMars) / NB_JOURS);
    var taxePolluants = polMode === 'mars' ? taxePolluantsMars : taxePolluantsAnnuel;

    // 6. exonérations
    var exos = Object.keys(EXONERATIONS).filter(function (k) { return v[k]; });
    var exoneration = exos.length ? exos.map(function (k) { return EXONERATIONS[k]; }).join(', ') : null;
    if (exoneration) { taxeCO2 = 0; taxePolluants = 0; }

    // 7-8. total et écart
    var total = taxeCO2 + taxePolluants;
    var declare = nombre(v.declare);
    var ecart = declare === null ? null : Math.round((declare - total) * 100) / 100;

    return {
      methode: nrj.exonere ? null : methode,
      energieLibelle: nrj.libelle,
      valeur: valeur,
      valeurRetenue: valeurRetenue,
      abattementE85: abattement,
      unite: methode === 'PA' ? 'CV' : 'g/km',
      euro: euro,
      nbJours: nbJours,
      prorata: prorata,
      tarifAnnuelCO2: nrj.exonere ? 0 : tarifCO2,
      detailTranches: detail,
      taxeCO2: taxeCO2,
      categoriePolluants: categorie,
      categorieLibelle: pol.libelle,
      tarifPolluants: pol.t2026,
      taxePolluants: taxePolluants,
      // point ouvert §4.3 : différence entre les deux lectures (hors exonération)
      ecartModeMars: exoneration ? 0 : taxePolluantsMars - taxePolluantsAnnuel,
      joursAvantMars: joursAvantMars,
      exoneration: exoneration,
      total: total,
      declare: declare,
      ecart: ecart,
      conforme: ecart === null ? null : Math.abs(ecart) <= 1,
      alertes: alertes,
    };
  }

  /** Calcul du parc : résultats par véhicule + totaux (§5, dernier paragraphe). */
  function calculerParc(parc) {
    var polMode = parc && parc.polMode === 'mars' ? 'mars' : 'annuel';
    var vehicules = (parc && parc.vehicles) || [];
    var resultats = vehicules.map(function (v) { return calculerVehicule(v, polMode); });
    var t = { taxeCO2: 0, taxePolluants: 0, total: 0, declare: 0, totalAvecDeclare: 0, nbDeclares: 0, nbEcarts: 0, nbAlertes: 0 };
    resultats.forEach(function (r) {
      t.taxeCO2 += r.taxeCO2;
      t.taxePolluants += r.taxePolluants;
      t.total += r.total;
      if (r.declare !== null) {
        t.declare += r.declare;
        t.totalAvecDeclare += r.total;
        t.nbDeclares++;
        if (!r.conforme) t.nbEcarts++;
      }
      if (r.alertes.length) t.nbAlertes++;
    });
    t.ecart = t.nbDeclares ? Math.round((t.declare - t.totalAvecDeclare) * 100) / 100 : null;
    return { polMode: polMode, resultats: resultats, totaux: t };
  }

  /** §8 – export CSV (séparateur ;, UTF-8 avec BOM). */
  function exportCSV(parc) {
    var calc = calculerParc(parc);
    var nb = function (x) { return x === null || x === undefined ? '' : String(x).replace('.', ','); };
    var cel = function (x) { x = x === null || x === undefined ? '' : String(x); return /[;"\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var lignes = [[
      'Plaque', '1re immatriculation', 'Énergie', 'Barème', 'Valeur', 'Valeur retenue', 'Jours', 'Prorata',
      'Tarif annuel CO2', 'Taxe CO2', 'Catégorie polluants', 'Taxe polluants', 'Exonération', 'Total',
      'Déclaré', 'Écart', 'Statut', 'Alertes',
    ]];
    parc.vehicles.forEach(function (v, i) {
      var r = calc.resultats[i];
      lignes.push([
        v.plaque || '', v.dateImmat || '', r.energieLibelle, r.methode || '—', nb(r.valeur), nb(r.valeurRetenue),
        r.nbJours, nb(r.prorata.toFixed(4)), r.tarifAnnuelCO2, r.taxeCO2, r.categoriePolluants, r.taxePolluants,
        r.exoneration || '', r.total, nb(r.declare), nb(r.ecart),
        r.conforme === null ? '' : r.conforme ? 'Conforme' : 'Écart', r.alertes.join(' | '),
      ]);
    });
    var t = calc.totaux;
    lignes.push(['TOTAL PARC', '', '', '', '', '', '', '', '', t.taxeCO2, '', t.taxePolluants, '', t.total,
      t.nbDeclares ? nb(t.declare) : '', nb(t.ecart), '', '']);
    lignes.push(['Lecture tarifs polluants', calc.polMode === 'mars' ? 'au prorata 01/01–28/02 ancien tarif, 01/03–31/12 tarif 2026' : 'tarif 2026 sur toute l’année']);
    return '﻿' + lignes.map(function (l) { return l.map(cel).join(';'); }).join('\r\n') + '\r\n';
  }

  return {
    ANNEE: ANNEE, NB_JOURS: NB_JOURS, BAREMES: BAREMES, POLLUANTS: POLLUANTS, ENERGIES: ENERGIES, EXONERATIONS: EXONERATIONS,
    arrondi: arrondi, indexJour: indexJour, dateDeIndex: dateDeIndex, joursAffectes: joursAffectes, periodes: periodes,
    methodeAuto: methodeAuto, appliquerBareme: appliquerBareme, calculerVehicule: calculerVehicule,
    calculerParc: calculerParc, exportCSV: exportCSV,
  };
});

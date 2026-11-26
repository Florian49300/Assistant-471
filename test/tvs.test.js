'use strict';
/** TVS 2026 : cas de test de référence du fichier de contexte (§7) + règles particulières. */
const test = require('node:test');
const assert = require('node:assert');
const TVS = require('../public/tvs/calcul.js');

const ANNEE = [[0, 364]];
const AVRIL_SEPT = [[TVS.indexJour('2026-04-01'), TVS.indexJour('2026-09-30')]]; // 183 j
const v = (o) => ({ methode: 'auto', euro: 'auto', days: ANNEE, ...o });

const CAS = [
  ['#1 essence WLTP 100', v({ energie: 'essence', dateImmat: '2021-05-10', co2: 100 }), 'annuel', [213, 130, 343]],
  ['#2 gazole WLTP 180', v({ energie: 'diesel', dateImmat: '2021-05-10', co2: 180 }), 'annuel', [3608, 650, 4258]],
  ['#3 gazole NEDC 120', v({ energie: 'diesel', dateImmat: '2015-05-10', co2: 120 }), 'annuel', [1204, 650, 1854]],
  ['#4 gazole NEDC 120, 01/04-30/09', v({ energie: 'diesel', dateImmat: '2015-05-10', co2: 120, days: AVRIL_SEPT }), 'annuel', [604, 326, 930]],
  ['#5 E85 WLTP 150, 183 j', v({ energie: 'e85', dateImmat: '2022-01-01', co2: 150, days: AVRIL_SEPT }), 'annuel', [87, 65, 152]],
  ['#6 E85 WLTP 150, 365 j, mode mars', v({ energie: 'e85', dateImmat: '2022-01-01', co2: 150 }), 'mars', [173, 125, 298]],
  ['#7 essence PA 7 CV', v({ energie: 'essence', dateImmat: '2000-01-01', cv: 7 }), 'annuel', [19500, 650, 20150]],
  ['#8 électrique', v({ energie: 'elec', dateImmat: '2023-06-01' }), 'annuel', [0, 0, 0]],
];

for (const [nom, veh, mode, [co2, pol, total]] of CAS) {
  test(`cas de référence ${nom}`, () => {
    const r = TVS.calculerVehicule(veh, mode);
    assert.deepEqual([r.taxeCO2, r.taxePolluants, r.total], [co2, pol, total]);
    assert.deepEqual(r.alertes, []);
  });
}

test('détail des tranches #1 : 4×0 + 41×1 + 8×2 + 32×3 + 15×4 = 213', () => {
  const r = TVS.calculerVehicule(CAS[0][1]);
  const utiles = r.detailTranches.filter((t) => t.unites > 0).map((t) => [t.unites, t.tarif]);
  assert.deepEqual(utiles, [[4, 0], [41, 1], [8, 2], [32, 3], [15, 4]]);
  assert.equal(r.tarifAnnuelCO2, 213);
});

test('E85 : valeur retenue 90 pour 150 g ; pas d\'abattement au-delà de 250 g ; PA −2 CV sauf > 12', () => {
  assert.equal(TVS.calculerVehicule(CAS[4][1]).valeurRetenue, 90);
  assert.equal(TVS.calculerVehicule(v({ energie: 'e85', dateImmat: '2022-01-01', co2: 260 })).valeurRetenue, 260);
  assert.equal(TVS.calculerVehicule(v({ energie: 'e85', dateImmat: '2000-01-01', cv: 7 })).valeurRetenue, 5);
  assert.equal(TVS.calculerVehicule(v({ energie: 'e85', dateImmat: '2000-01-01', cv: 13 })).valeurRetenue, 13);
});

test('méthode et norme Euro automatiques', () => {
  assert.equal(TVS.methodeAuto('2020-03-01'), 'WLTP');
  assert.equal(TVS.methodeAuto('2020-02-29'), 'NEDC');
  assert.equal(TVS.methodeAuto('2004-06-01'), 'NEDC');
  assert.equal(TVS.methodeAuto('2004-05-31'), 'PA');
  assert.equal(TVS.calculerVehicule(v({ energie: 'essence', dateImmat: '2010-12-31', co2: 120 })).categoriePolluants, 'P');
  assert.equal(TVS.calculerVehicule(v({ energie: 'essence', dateImmat: '2011-01-01', co2: 120 })).categoriePolluants, '1');
  assert.equal(TVS.calculerVehicule(v({ energie: 'hyb_dsl', dateImmat: '2022-01-01', co2: 120 })).categoriePolluants, 'P');
});

test('exonération : 0 € ; écart et conformité ±1 €', () => {
  const r = TVS.calculerVehicule(v({ energie: 'diesel', dateImmat: '2021-05-10', co2: 180, exLCD: true, declare: '0' }));
  assert.equal(r.total, 0);
  assert.equal(r.conforme, true);
  assert.match(r.exoneration, /courte durée/);
  const d = TVS.calculerVehicule(v({ ...CAS[0][1], declare: '344' }));
  assert.equal(d.ecart, 1);
  assert.equal(d.conforme, true);
  assert.equal(TVS.calculerVehicule(v({ ...CAS[0][1], declare: '300' })).conforme, false);
});

test('contrôles : jours avant immatriculation, CO2 manquant', () => {
  const r = TVS.calculerVehicule(v({ energie: 'essence', dateImmat: '2026-03-01', co2: 100 }));
  assert.match(r.alertes.join(), /59 jour\(s\) d'affectation avant/);
  const m = TVS.calculerVehicule(v({ energie: 'diesel', dateImmat: '2021-05-10' }));
  assert.match(m.alertes.join(), /CO₂/);
});

test('jours : 365 booléens ou périodes ; parc et CSV', () => {
  const bools = new Array(365).fill(false).map((_, i) => i >= 90 && i <= 272);
  assert.equal(TVS.calculerVehicule(v({ ...CAS[3][1], days: bools })).total, 930);
  assert.deepEqual(TVS.periodes(bools), [[90, 272]]);
  const parc = { polMode: 'annuel', vehicles: [{ ...CAS[0][1], plaque: 'AB-123-CD', declare: '343' }, CAS[1][1]] };
  const p = TVS.calculerParc(parc);
  assert.equal(p.totaux.total, 343 + 4258);
  assert.equal(p.totaux.ecart, 0); // écart sur les seuls véhicules déclarés
  const csv = TVS.exportCSV(parc);
  assert.ok(csv.startsWith('﻿Plaque;'));
  assert.match(csv, /AB-123-CD;2021-05-10;Essence;WLTP;100;100;365;1,0000;213;213;1;130;;343;343;0;Conforme;/);
});

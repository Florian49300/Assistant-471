'use strict';
// Test de non-régression sur un vrai export, comparé à l'écriture saisie dans Pennylane (CAISSE 09.2026).
// Lancé seulement si le fichier est fourni :
//   FICHIER_REFERENCE=chemin/jalia_export_accounting_850_20260901_20260930_xxx.csv npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parser, caisseDepuisNomFichier } = require('../importeurs/jalia-caisse');
const { controler } = require('../lib/controles');
const config = require('../societes/bdp.json');

const fichier = process.env.FICHIER_REFERENCE;

// Écriture CA du 30/09/2026 telle que saisie dans Pennylane (centimes)
const ATTENDU = [
  ['411', 'DUE CLIENTS', 14445, 0], ['5112', 'CHEQUE', 1600, 0],
  ['5114', 'TITRE RESTAURANT', 2000, 0], ['5114', 'CARTE RESTO', 53160, 0],
  ['51141', 'CHEQUES VACANCES', 23890, 0], ['5115', 'REMISE CB', 1721912, 0],
  ['51151', 'CB SUMUP', 4240, 0], ['531', 'CAISSE', 181750, 0],
  ['44571006', 'TVA 5,5 %', 0, 6856], ['44571008', 'TVA 10 %', 0, 166701], ['44571009', 'TVA 20 %', 0, 6297],
  ['706110000', 'VENTES 10 %', 0, 1667009], ['706120000', 'VENTES 20 %', 0, 31483], ['706130000', 'VENTES 5,5 %', 0, 124651],
];

test('septembre 2026 = écriture CAISSE 09.2026 de Pennylane', { skip: !fichier && 'FICHIER_REFERENCE non défini' }, () => {
  const { pieces } = parser(fs.readFileSync(fichier, 'utf8'), config, { caisseId: caisseDepuisNomFichier(path.basename(fichier)), regroupement: 'mois' });
  controler(pieces);
  assert.strictEqual(pieces.length, 1);
  const p = pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join());
  assert.strictEqual(p.date, '2026-09-30');
  assert.strictEqual(p.journal, 'CA');
  assert.strictEqual(p.libelle, 'CAISSE 09.2026');
  assert.deepStrictEqual(p.lignes.map(l => [l.compte, l.libelleCompte, l.debit, l.credit]), ATTENDU);
  assert.strictEqual(p.totalDebit, 2002997);
});

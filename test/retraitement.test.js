'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { enCentimes, retraiter, totaux, euros, dateFr } = require('../src/retraitement');
const { Demo } = require('../src/pennylane');
const { emlBuffer, corpsMail } = require('../src/documents');

test('conversion en centimes', () => {
  assert.equal(enCentimes('84.90'), 8490);
  assert.equal(enCentimes('0.1'), 10);
  assert.equal(enCentimes('1200'), 120000);
  assert.equal(enCentimes('-3.05'), -305);
});

test('débit 471 = dépense, crédit = recette, lettrées exclues', () => {
  const ops = retraiter([
    { id: 1, date: '2026-01-02', label: 'A', debit: '10.00', credit: '0.00', lettered_ledger_entry_lines: { ids: [1] } },
    { id: 2, date: '2026-01-01', label: 'B', debit: '0.00', credit: '5.50', lettered_ledger_entry_lines: { ids: [] } },
    { id: 3, date: '2026-01-03', label: 'C', debit: '7.00', credit: '0.00', lettered_ledger_entry_lines: { ids: [3, 8] } },
  ]);
  assert.deepEqual(ops.map((o) => [o.id, o.depense, o.recette]), [[2, 0, 550], [1, 1000, 0]]);
});

test('seuil', () => {
  const l = (id, d) => ({ id, date: '2026-01-01', label: 'x', debit: d, credit: '0' });
  assert.equal(retraiter([l(1, '4.99'), l(2, '5.00')], {}, 5).length, 1);
});

test('formats français', () => {
  assert.equal(euros(165000), '1 650,00 €');
  assert.equal(euros(8490), '84,90 €');
  assert.equal(dateFr('2026-09-03'), '03/09/2026');
});

test('démo : totaux et brouillon .eml', async () => {
  const d = await new Demo().extraire('12345', 'SARL Exemple Boulangerie');
  assert.equal(d.operations.length, 5);
  assert.deepEqual(totaux(d.operations), { depenses: 34489, recettes: 165000 });
  assert.match(corpsMail(d, 'Sig'), /5 opérations bancaires pour lesquelles/);
  const eml = (await emlBuffer(d, { destinataire: 'client@exemple.fr', signature: 'Sig' })).toString();
  assert.match(eml, /^X-Unsent: 1/m);
  assert.match(eml, /^To: client@exemple\.fr/m);
  assert.match(eml, /SARL_Exemple_Boulangerie_operations_a_justifier\.xlsx/);
});

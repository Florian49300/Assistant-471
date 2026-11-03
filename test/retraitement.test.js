'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { enCentimes, retraiter, totaux, euros, dateFr } = require('../src/retraitement');
const { Demo, Pennylane } = require('../src/pennylane');
const { emlBuffer, tableauxTexte, tableauxHtml, excelBuffer } = require('../src/documents');
const ExcelJS = require('exceljs');

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

test('démo : sous-comptes consolidés, deux Excel joints au .eml', async () => {
  const d = await new Demo().extraire('12345', 'SARL Exemple Boulangerie');
  assert.equal(d.operations.length, 6);
  assert.deepEqual(totaux(d.operations), { depenses: 34489, recettes: 168500 });
  const txt = tableauxTexte(d);
  assert.match(txt, /DÉPENSES À JUSTIFIER \(3 opérations\)/);
  assert.match(txt, /RECETTES À JUSTIFIER \(3 opérations\)/);
  assert.doesNotMatch(txt, /\|/);
  const html = tableauxHtml(d);
  assert.equal((html.match(/<table/g) || []).length, 2);
  assert.match(html, /1&nbsp;685,00 €/);
  const eml = (await emlBuffer(d, { destinataire: 'client@exemple.fr', avant: 'Bonjour <test>' })).toString();
  assert.match(eml, /Content-Type: text\/html/);
  assert.match(eml, /Content-Type: text\/plain/);
  assert.match(eml, /^X-Unsent: 1/m);
  assert.match(eml, /^To: client@exemple\.fr/m);
  assert.match(eml, /SARL_Exemple_Boulangerie_depenses_a_justifier\.xlsx/);
  assert.match(eml, /SARL_Exemple_Boulangerie_recettes_a_justifier\.xlsx/);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await excelBuffer(d, 'recettes'));
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('B5').value, 'VIR SEPA RECU M DUPONT FACT');
  assert.equal(ws.getCell('C5').value, 1200);
  assert.equal(ws.rowCount, 8); // 3 lignes + total
});

test('libellés manquants : écriture puis autre ligne de l\'écriture', async () => {
  const pl = new Pennylane('x');
  const appels = [];
  pl.get = async (url, params) => {
    appels.push(url.split('/v2/')[1]);
    if (url.endsWith('/ledger_entries')) return { items: [{ id: 100, label: 'Facture EDF' }, { id: 200, label: null }], has_more: false };
    if (url.endsWith('/ledger_entries/200/ledger_entry_lines')) return { items: [{ id: 21, label: '' }, { id: 22, label: 'CB CARREFOUR 12/10' }], has_more: false };
    throw new Error('inattendu ' + url);
  };
  const lignes = [
    { id: 1, label: '', ledger_entry: { id: 100 } },
    { id: 2, label: '  ', ledger_entry: { id: 200 } },
    { id: 3, label: 'Déjà là', ledger_entry: { id: 300 } },
  ];
  await pl.completerLibelles('1', lignes);
  assert.deepEqual(lignes.map((l) => l.label), ['Facture EDF', 'CB CARREFOUR 12/10', 'Déjà là']);
  assert.deepEqual(appels, ['ledger_entries', 'ledger_entries/200/ledger_entry_lines']);
});

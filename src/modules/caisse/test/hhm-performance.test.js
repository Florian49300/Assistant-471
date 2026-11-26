'use strict';
// HHM PERFORMANCE : export des factures de vente (sans en-tête, montant + sens D/C), une écriture par facture.
// Référence facultative : FICHIER_HHM=…/SARL HHM PERFORMANCE-Ventes….csv FICHIER_HHM_RETRAITE=…/Fichier prêt à l'import.csv npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const imp = require('../importeurs/ecritures-caisse');
const { enCentimes } = require('../importeurs/jalia-caisse');
const { controler } = require('../lib/controles');
const config = require('../societes/hhm-performance.json');

const NOM = 'SARL HHM PERFORMANCE-Ventes 20-10-2026.csv';
const FICHIER = [
  '2026-09-02;VE;411001740;Facture 26-09-3824  GOURDON Bruno;26-09-3824;533,00;D;',
  '2026-09-02;VE;706020;Facture 26-09-3824  GOURDON Bruno;26-09-3824;408,33;C;',
  '2026-09-02;VE;707000;Facture 26-09-3824  GOURDON Bruno;26-09-3824;43,00;C;',
  '2026-09-02;VE;445720;Facture 26-09-3824  GOURDON Bruno;26-09-3824;81,67;C;',
  '2026-09-08;VE;411001513;Avoir 26-09-3834  CESBRON Thierry;26-09-3834;245,10;C;',
  '2026-09-08;VE;706020;Avoir 26-09-3834  CESBRON Thierry;26-09-3834;204,25;D;',
  '2026-09-08;VE;445720;Avoir 26-09-3834  CESBRON Thierry;26-09-3834;40,85;D;',
].join('\n') + '\n';
const lire = (txt = FICHIER, cfg = config, nom = NOM) => { const r = imp.importer(Buffer.from(txt), cfg, { nomFichier: nom }); controler(r.pieces); return r; };

test('modèles : n° de facture et libellé', () => {
  assert.strictEqual(imp.remplir('{num}', '26-09-3820', '2026-09-01'), '3820');
  assert.strictEqual(imp.remplir('{libelle}', '26-09-3820', '2026-09-01', 'Facture 26-09-3820  MICHENAUD Zoe'), 'Facture 26-09-3820 MICHENAUD Zoe');
  assert.strictEqual(imp.traduireCompte('411001737', config), '411001');
  assert.strictEqual(imp.traduireCompte('707000', config), '70603');
  assert.strictEqual(imp.traduireCompte('606000', config), null);
});

test('facture : clients en 411001, 707000 -> 70603, TVA 445720 -> 44571009, pièce = n° de facture', () => {
  const { pieces } = lire();
  assert.strictEqual(pieces.length, 2);
  const p = pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.deepStrictEqual([p.journal, p.piece, p.date, p.libelle, p.cle], ['VE', '3824', '2026-09-02', 'Facture 26-09-3824 GOURDON Bruno', 'VE|3824|2026-09-02']);
  assert.deepStrictEqual(p.lignes.map(l => [l.compte, l.debit, l.credit]), [
    ['411001', 53300, 0], ['706020', 0, 40833], ['70603', 0, 4300], ['44571009', 0, 8167],
  ]);
  assert.deepStrictEqual(p.ca, { ht: 45133, tva: 8167, ttc: 53300 });
});

test('avoir : sens inversés, CA négatif', () => {
  const p = lire().pieces[1];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.deepStrictEqual(p.lignes.map(l => [l.compte, l.debit, l.credit]), [['411001', 0, 24510], ['706020', 20425, 0], ['44571009', 4085, 0]]);
  assert.deepStrictEqual(p.ca, { ht: -20425, tva: -4085, ttc: -24510 });
});

test('compte inconnu : facture bloquée ; sens illisible : fichier refusé ; mauvais fichier : bloqué', () => {
  const p = lire(FICHIER.replace('VE;707000;', 'VE;708500;')).pieces[0];
  assert.strictEqual(p.statut, 'bloquée');
  assert.match(p.raisons[0], /compte « 708500 ».*non paramétré \(43,00 €\)/);
  assert.throws(() => lire(FICHIER.replace('533,00;D;', '533,00;X;')), /sens « X »/);
  const autre = lire(FICHIER, config, 'Ventes AUTRE SOCIETE.csv').pieces[0];
  assert.strictEqual(autre.statut, 'bloquée');
  assert.match(autre.raisons[0], /HHM PERFORMANCE/);
});

test('rapprochement avec libellé « Clients (TTC facturé) »', () => {
  const { resume } = lire();
  const r = Object.fromEntries(resume.rapprochement.map(x => [x.libelle, [x.fichier, x.ecritures]]));
  assert.deepStrictEqual(r['Clients (TTC facturé)'], [28790, 28790]);
  assert.deepStrictEqual(r['Ventes HT'], [24708, 24708]);
  assert.deepStrictEqual(r['TVA collectée'], [4082, 4082]);
});

// ---------- Référence : fichier brut vs « Fichier prêt à l'import » ----------
const BRUT = process.env.FICHIER_HHM, RETRAITE = process.env.FICHIER_HHM_RETRAITE;
test('septembre 2026 : 61 factures identiques au fichier retraité', { skip: !(BRUT && RETRAITE) && 'fichiers de référence non fournis' }, () => {
  const { pieces } = imp.importer(fs.readFileSync(BRUT), config, { nomFichier: path.basename(BRUT) });
  controler(pieces);
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const att = {};
  for (const r of fs.readFileSync(RETRAITE, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(';')))
    (att[r[4]] ||= []).push(`${r[0]}|${r[1]}|${r[2]}|${norm(r[3])}|${enCentimes(r[5]) - enCentimes(r[6])}`);
  assert.strictEqual(pieces.length, Object.keys(att).length);
  for (const p of pieces) {
    assert.strictEqual(p.statut, 'prête', `${p.piece} ${p.raisons}`);
    const [a, m, j] = p.date.split('-');
    const nous = p.lignes.map(l => `${j}/${m}/${a}|${p.journal}|${l.compte}|${norm(l.libelleCompte)}|${l.debit - l.credit}`).sort();
    assert.deepStrictEqual(nous, att[p.piece].slice().sort(), p.piece);
  }
});

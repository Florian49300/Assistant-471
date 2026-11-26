'use strict';
// Importeur « ecritures-caisse » (Jessi'faim) — données fictives au format de l'export.
const test = require('node:test');
const assert = require('node:assert');
const imp = require('../importeurs/ecritures-caisse');
const { controler } = require('../lib/controles');
const config = require('../societes/jessifaim.json');

const ENTETE = 'Date\tJournalCode\tCompteNum\tCompteLib\tDebit\tCredit\tPieceRef\tPoste\r\n';
const L = (date, compte, lib, d, c, piece) => `${date}\tVE\t${compte}\t${lib}\t${d}\t${c}\t${piece}\tCAISSE\r\n`;
const JOUR = [
  L('01/10/2026', '411CB', 'Recette CB', '100,00', '0,00', '395'),
  L('01/10/2026', '411CBTR', 'Recette CB CRT', '10,00', '0,00', '395'),
  L('01/10/2026', '53100000', 'Recette ESPECES', '0,00', '0,00', '395'),
  L('01/10/2026', '70700000', 'Recette Produit ? 20,00 % Alcool', '0,00', '20,00', '395'),
  L('01/10/2026', '44571201', 'TVA / Recette Produit ? 20,00 %', '0,00', '4,00', '395'),
  L('01/10/2026', '70700000', 'Recette Produit ? 10,00 % Elixirs', '0,00', '50,00', '395'),
  L('01/10/2026', '44571301', 'TVA / Recette Produit ? 10,00 %', '0,00', '5,00', '395'),
  L('01/10/2026', '70110000', 'Recette Produit ? 20,00 % Ardoise', '0,00', '25,00', '395'),
  L('01/10/2026', '44571201', 'TVA / Recette Produit ? 20,00 %', '0,00', '5,00', '395'),
  L('01/10/2026', '70100001', 'Recette Produit ? 5,50 %', '0,00', '1,00', '395'),
].join('');
const NOM = 'EXPORTCOMPTABLE1-20261001-20261101-JESSIFAIM.csv';
const lire = (txt, nom = NOM) => { const r = imp.importer(Buffer.from(txt), config, { nomFichier: nom }); controler(r.pieces); return r; };

test('utilitaires', () => {
  assert.strictEqual(imp.tauxDepuisLibelle('Recette Produit ? 10,00 % Desserts'), '10');
  assert.strictEqual(imp.tauxDepuisLibelle('TVA / Recette Produit ? 5,50 %'), '5.5');
  assert.strictEqual(imp.nettoyerLibelle('Recette Produit ? 10,00 % Plats'), 'Recette Produit à 10,00 % Plats');
});

test('une journée : comptes traduits, ventes rangées par taux, n° de pièce de la caisse', () => {
  // Corrige la ligne à 5,5 % pour équilibrer : 110 = 20+4+50+5+25+5+1 = 110
  const { pieces } = lire(ENTETE + JOUR);
  assert.strictEqual(pieces.length, 1);
  const p = pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.strictEqual(p.piece, '395');
  assert.strictEqual(p.date, '2026-10-01');
  assert.strictEqual(p.cle, 'VE|395|2026-10-01');
  assert.strictEqual(p.libelle, 'CAISSE 01.10.2026');
  const l = p.lignes.map(x => [x.compte, x.libelleCompte, x.debit, x.credit]);
  assert.deepStrictEqual(l, [
    ['5111', 'Recette CB', 10000, 0],
    ['5114', 'Recette CB tickets resto', 1000, 0],
    ['707', 'Recette Produit à 20,00 % Alcool', 0, 2000],
    ['44571009', 'TVA / Recette Produit à 20,00 %', 0, 400],
    ['7011', 'Recette Produit à 10,00 % Elixirs', 0, 5000],      // compte 707 dans la caisse, mais 10 % -> 7011
    ['44571008', 'TVA / Recette Produit à 10,00 %', 0, 500],
    ['707', 'Recette Produit à 20,00 % Ardoise', 0, 2500],        // compte 7011 dans la caisse, mais 20 % -> 707
    ['44571009', 'TVA / Recette Produit à 20,00 %', 0, 500],
    ['7015', 'Recette Produit à 5,50 %', 0, 100],
  ]);                                                             // ligne espèces à 0 ignorée
});

test('plusieurs journées, rapprochement, garde-fou sur le nom du fichier', () => {
  const j2 = JOUR.replace(/01\/10\/2026/g, '02/10/2026').replace(/\t395\t/g, '\t396\t');
  const r = lire(ENTETE + JOUR + j2);
  assert.deepStrictEqual(r.pieces.map(p => p.piece), ['395', '396']);
  assert.deepStrictEqual(r.resume.periode, ['2026-10-01', '2026-10-02']);
  assert.ok(r.resume.rapprochement.every(x => x.fichier === x.ecritures));
  const autre = lire(ENTETE + JOUR, 'EXPORTCOMPTABLE1-AUTRESOCIETE.csv');
  assert.strictEqual(autre.pieces[0].statut, 'bloquée');
  assert.match(autre.pieces[0].raisons[0], /JESSIFAIM/);
});

test('séparateur ";" accepté, colonne manquante refusée', () => {
  const r = lire((ENTETE + JOUR).replace(/\t/g, ';'));
  assert.strictEqual(r.pieces[0].statut, 'prête');
  assert.throws(() => imp.importer(Buffer.from('Date\tCompteNum\n01/10/2026\t411CB\n'), config, {}), /introuvable/);
});

test('journée déséquilibrée dans le fichier : écart passé en 471, pièce prête', () => {
  const { pieces, resume } = lire(ENTETE + JOUR.replace('Recette CB\t100,00', 'Recette CB\t113,50'));
  const p = pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.deepStrictEqual(p.lignes.at(-1), { compte: '471000000', libelleCompte: 'Ecart de caisse', debit: 0, credit: 1350, masse: 'Écart de caisse' });
  assert.match(p.alertes[0], /écart de caisse de 13,50 €.*471000000/);
  const e = resume.rapprochement.find(x => x.libelle === 'Écart de caisse');
  assert.deepStrictEqual([e.fichier, e.ecritures], [1350, 1350]);
});

test('manque en caisse : écart au débit du 471', () => {
  const { pieces } = lire(ENTETE + JOUR.replace('Recette CB\t100,00', 'Recette CB\t95,00'));
  assert.deepStrictEqual([pieces[0].lignes.at(-1).debit, pieces[0].lignes.at(-1).credit], [500, 0]);
  assert.strictEqual(pieces[0].statut, 'prête');
});

test("sans compte d'écart dans la fiche : journée déséquilibrée bloquée", () => {
  const r = imp.importer(Buffer.from(ENTETE + JOUR.replace('Recette CB\t100,00', 'Recette CB\t113,50')), { ...config, compteEcart: null }, { nomFichier: NOM });
  controler(r.pieces);
  assert.strictEqual(r.pieces[0].statut, 'bloquée');
  assert.match(r.pieces[0].raisons[0], /écart 13,50 €/);
});

test('virement 411VIR -> 5115, vente à 0 % (carte cadeau) -> 5113', () => {
  const txt = ENTETE + JOUR.replace('100,00', '140,00').replace('411CBTR\tRecette CB CRT', '411VIR\tRecette VIR')
    + L('01/10/2026', '70100000', 'Recette Produit ? 0,00 %', '0,00', '40,00', '395')
    + L('01/10/2026', '44571000', 'TVA / Recette Produit ? 0,00 %', '0,00', '0,00', '395');
  const p = lire(txt).pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.ok(p.lignes.some(l => l.compte === '5115' && l.libelleCompte === 'Recette VIR' && l.debit === 1000));
  assert.ok(p.lignes.some(l => l.compte === '5113' && l.credit === 4000));
});

test('compte de caisse absent de la fiche : journée bloquée, sans message de déséquilibre en double', () => {
  const p = lire(ENTETE + JOUR.replace('411CBTR\tRecette CB CRT', '411AVOIR\tRecette AVOIR')).pieces[0];
  assert.strictEqual(p.statut, 'bloquée');
  assert.match(p.raisons[0], /411AVOIR – Recette AVOIR.*non paramétré/);
  assert.strictEqual(p.raisons.length, 1);
});

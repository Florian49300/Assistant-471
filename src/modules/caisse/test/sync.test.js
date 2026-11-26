'use strict';
// Contrôles Pennylane et envoi, avec un faux client API (aucun appel réseau).
const test = require('node:test');
const assert = require('node:assert');
const { resoudreCompte, preparer, corpsEcriture, envoyer } = require('../lib/sync');
const { ErreurPennylane } = require('../lib/pennylane');

const comptes = [
  { id: 1, number: '411' }, { id: 2, number: '531' }, { id: 3, number: '707' },
  { id: 4, number: '44571006' }, { id: 5, number: '5114' }, { id: 6, number: '5114' }, { id: 7, number: '706130' },
];
const ref = { journaux: [{ id: 9, code: 'CA', label: 'Caisse' }], comptes };
const societe = { id: 's', journal: 'CA', comptesForces: {} };
const piece = (date, lignes = [['531', 1000, 0], ['707', 0, 1000]]) => ({
  cle: `CA|Z${date}|${date}`, journal: 'CA', piece: `Z${date}`, date, libelle: `CAISSE ${date}`, statut: 'prête', raisons: [],
  libellesEnConflit: [`CAISSE ${date.slice(5, 7)}.${date.slice(0, 4)}`],
  lignes: lignes.map(([compte, debit, credit]) => ({ compte, libelleCompte: compte, debit, credit })),
});
const faux = (existantes = []) => ({ ecrituresJournal: async () => existantes });

test('correspondance des comptes', () => {
  assert.strictEqual(resoudreCompte('411', comptes).compte.id, 1);
  assert.strictEqual(resoudreCompte('70613000', comptes).compte.id, 7);   // sans les zéros de fin : 70613 = 70613
  assert.match(resoudreCompte('5114', comptes).erreur, /plusieurs comptes 5114/);
  assert.strictEqual(resoudreCompte('5114', comptes, { 5114: { id: 6 } }).compte.id, 6);
  assert.strictEqual(resoudreCompte('999', comptes, { 999: '411' }).compte.id, 1);
  assert.match(resoudreCompte('600', comptes).erreur, /absent/);
});

test('préparation : prête, compte absent, journal absent', async () => {
  const ps = [piece('2026-10-01'), piece('2026-10-02', [['531', 500, 0], ['600', 0, 500]])];
  const r = await preparer(ps, societe, ref, faux());
  assert.strictEqual(r.journal.id, 9);
  assert.strictEqual(ps[0].statut, 'prête');
  assert.strictEqual(ps[0].journalId, 9);
  assert.strictEqual(ps[1].statut, 'bloquée');
  assert.match(ps[1].raisons[0], /600 absent/);
  const p3 = [piece('2026-10-01')];
  await preparer(p3, { ...societe, journal: 'VT' }, ref, faux());
  assert.match(p3[0].raisons[0], /journal "VT" introuvable/);
});

test('doublons : même numéro de pièce, ou écriture mensuelle déjà saisie', async () => {
  const ps = [piece('2026-09-01'), piece('2026-10-02')];
  await preparer(ps, societe, ref, faux([
    { id: 77, date: '2026-10-02', label: 'autre', piece_number: 'Z2026-10-02' },
    { id: 78, date: '2026-09-30', label: 'CAISSE 09.2026', piece_number: 'ESW9K9ALQS' },
  ]));
  assert.strictEqual(ps[1].statut, 'déjà envoyée');
  assert.strictEqual(ps[0].statut, 'bloquée');
  assert.match(ps[0].raisons[0], /CAISSE 09\.2026.*existe déjà/);
});

test('corps envoyé à Pennylane : montants en chaînes à 2 décimales', async () => {
  const ps = [piece('2026-10-01', [['531', 123456, 0], ['707', 0, 123456]])];
  await preparer(ps, societe, ref, faux());
  assert.deepStrictEqual(corpsEcriture(ps[0]), {
    date: '2026-10-01', label: 'CAISSE 2026-10-01', journal_id: 9, piece_number: 'Z2026-10-01',
    ledger_entry_lines: [
      { debit: '1234.56', credit: '0.00', ledger_account_id: 2, label: '531' },
      { debit: '0.00', credit: '1234.56', ledger_account_id: 3, label: '707' },
    ],
  });
});

test('envoi : 422 laisse continuer, 401 arrête tout', async () => {
  const ps = [piece('2026-10-01'), piece('2026-10-02'), piece('2026-10-03'), piece('2026-10-04')];
  await preparer(ps, societe, ref, faux());
  let n = 0;
  const api = { creerEcriture: async () => {
    n++;
    if (n === 2) throw new ErreurPennylane(422, 'Pennylane 422 : refusée');
    if (n === 3) throw new ErreurPennylane(401, 'Clé API refusée par Pennylane');
    return { id: 100 + n };
  } };
  const r = await envoyer(ps, api);
  assert.deepStrictEqual(r.map(x => x.ok), [true, false, false, false]);
  assert.strictEqual(n, 3);                         // la 4e n'est pas tentée
  assert.match(r[3].message, /non envoyée : Clé API refusée/);
});

test('comptes Pennylane sur 9 chiffres (dossier Jessi\'faim) : 5111 -> 511100000', () => {
  const c9 = ['511100000', '511200000', '511300000', '511400000', '531000000', '701100000', '701500000', '707000000', '445710060', '44571008']
    .map((number, i) => ({ id: 500 + i, number }));
  assert.strictEqual(resoudreCompte('5111', c9).compte.number, '511100000');
  assert.strictEqual(resoudreCompte('5114', c9).compte.number, '511400000');
  assert.strictEqual(resoudreCompte('7011', c9).compte.number, '701100000');
  assert.strictEqual(resoudreCompte('707', c9).compte.number, '707000000');
  assert.strictEqual(resoudreCompte('531', c9).compte.number, '531000000');
  assert.strictEqual(resoudreCompte('44571006', c9).compte.number, '445710060');
});

test('taux d\'un compte Pennylane (vat_rate)', () => {
  const { tauxCompte } = require('../lib/sync');
  assert.strictEqual(tauxCompte('FR_100'), '10');
  assert.strictEqual(tauxCompte('FR_55'), '5.5');
  assert.strictEqual(tauxCompte('FR_200'), '20');
  assert.strictEqual(tauxCompte('10'), '10');
  assert.strictEqual(tauxCompte('5.5'), '5.5');
  assert.strictEqual(tauxCompte('0.2'), '20');
  assert.strictEqual(tauxCompte('any'), null);
  assert.strictEqual(tauxCompte(null), null);
  assert.strictEqual(tauxCompte('exempt'), '0');
});

test('même numéro en plusieurs exemplaires (un par taux) : choix selon le taux de la ligne', () => {
  const cs = [
    { id: 2756299255, number: '7011', vat_rate: 'FR_200', enabled: true },
    { id: 1956077147, number: '7011', vat_rate: 'FR_100', enabled: true },
    { id: 1608941804, number: '7011', vat_rate: 'any', enabled: true },
    { id: 1956077148, number: '707', vat_rate: 'FR_200', enabled: true },
    { id: 1608941819, number: '707', vat_rate: 'any', enabled: true },
  ];
  assert.strictEqual(resoudreCompte('7011', cs, {}, '10').compte.id, 1956077147);
  assert.strictEqual(resoudreCompte('7011', cs, {}, '20').compte.id, 2756299255);
  assert.strictEqual(resoudreCompte('7011', cs, {}, '5.5').compte.id, 1608941804);   // pas de 5,5 % : compte « tous taux »
  assert.strictEqual(resoudreCompte('707', cs, {}, '20').compte.id, 1956077148);
  assert.strictEqual(resoudreCompte('707', cs, {}, '10').compte.id, 1608941819);
  assert.strictEqual(resoudreCompte('7011', cs, {}).compte.id, 1608941804);         // sans taux : « tous taux »
  // forçage par numéro@taux, prioritaire
  assert.strictEqual(resoudreCompte('7011', cs, { '7011@10': { id: 1608941804 } }, '10').compte.id, 1608941804);
  // comptes désactivés écartés
  const cs2 = [{ id: 1, number: '7015', vat_rate: 'FR_55', enabled: false }, { id: 2, number: '7015', vat_rate: 'FR_55', enabled: true }];
  assert.strictEqual(resoudreCompte('7015', cs2, {}, '5.5').compte.id, 2);
  // indécidable : message détaillé avec les taux
  const cs3 = [{ id: 1, number: '7015', vat_rate: 'FR_100' }, { id: 2, number: '7015', vat_rate: 'FR_200' }];
  assert.match(resoudreCompte('7015', cs3, {}, '5.5').erreur, /id 1 : 7015, TVA FR_100 ; id 2 : 7015, TVA FR_200.*7015@5.5/);
});

test('préparation : la ligne transmet son taux pour choisir le compte', async () => {
  const cs = [{ id: 10, number: '531' }, { id: 11, number: '7011', vat_rate: 'FR_100' }, { id: 12, number: '7011', vat_rate: 'FR_200' }];
  const p = { cle: 'k', journal: 'CA', piece: 'Z1', date: '2026-10-01', libelle: 'x', statut: 'prête', raisons: [],
    lignes: [{ compte: '531', libelleCompte: 'c', debit: 1100, credit: 0 }, { compte: '7011', libelleCompte: 'v', debit: 0, credit: 1100, taux: '20' }] };
  await preparer([p], { id: 's', journal: 'CA', comptesForces: {} }, { journaux: [{ id: 9, code: 'CA' }], comptes: cs }, { ecrituresJournal: async () => [] });
  assert.strictEqual(p.statut, 'prête', (p.raisons || []).join());
  assert.strictEqual(p.lignesPennylane[1].ledger_account_id, 12);
});

test('comptes auxiliaires alphanumériques (COTE PISTE)', () => {
  const cs = [{ id: 1, number: '411CB0000' }, { id: 2, number: '411CBTR00' }, { id: 3, number: '411DIFFERE' }, { id: 4, number: '53100000' }];
  assert.strictEqual(resoudreCompte('411CB0000', cs).compte.id, 1);
  assert.strictEqual(resoudreCompte('411CB', cs).compte.id, 1);        // sans les zéros de fin
  assert.strictEqual(resoudreCompte('411CBTR00', cs).compte.id, 2);
  assert.strictEqual(resoudreCompte('411DIFFERE', cs).compte.id, 3);
  assert.strictEqual(resoudreCompte('531', cs).compte.id, 4);
});

test('chiffre d\'affaires d\'une pièce (contrôle avec le Z)', () => {
  const { chiffreAffaires } = require('../lib/controles');
  // Avec « masse » (importeurs écritures / tableau) : remise au débit déduite, encaissements et écarts exclus
  assert.deepStrictEqual(chiffreAffaires([
    { compte: '5111', debit: 11000, credit: 0, masse: 'Encaissements' },
    { compte: '7011', debit: 0, credit: 10500, masse: 'Ventes HT' },
    { compte: '7011', debit: 500, credit: 0, masse: 'Ventes HT' },
    { compte: '44571008', debit: 0, credit: 1000, masse: 'TVA collectée' },
    { compte: '471000000', debit: 0, credit: 0, masse: 'Écart de caisse' },
  ]), { ht: 10000, tva: 1000, ttc: 11000 });
  // Sans « masse » (Jalia) : repérage par le compte ; pourboires (467) et paiements exclus
  assert.deepStrictEqual(chiffreAffaires([
    { compte: '531', debit: 2400, credit: 0 }, { compte: '467', debit: 0, credit: 200 },
    { compte: '70611', debit: 0, credit: 2000 }, { compte: '44571008', debit: 0, credit: 200 },
  ]), { ht: 2000, tva: 200, ttc: 2200 });
});

test('BDP : 70611 en 8 exemplaires dont 2 à 10 % identiques -> le plus ancien (plus petit id)', () => {
  const cs = [
    ['16070260957184', 'FR_196'], ['16070243049472', 'FR_100'], ['16070242545664', 'FR_200'], ['15991851212800', 'FR_160'],
    ['2599732108', 'exempt'], ['2350201817', 'FR_200'], ['2331504142', 'FR_92'], ['2331504126', 'any'], ['2331504060', 'FR_100'],
  ].map(([id, vat_rate]) => ({ id, number: '70611', label: 'VENTES 10%', vat_rate, enabled: true }));
  assert.strictEqual(resoudreCompte('706110000', cs, {}, '10').compte.id, '2331504060');
  assert.strictEqual(resoudreCompte('706110000', cs, {}, '20').compte.id, '2350201817');
  assert.strictEqual(resoudreCompte('706110000', cs, {}, '5.5').compte.id, '2331504126');   // pas de 5,5 % : « any »
  // forçage toujours prioritaire
  assert.strictEqual(resoudreCompte('706110000', cs, { '706110000@10': { id: '16070243049472' } }, '10').compte.id, '16070243049472');
});

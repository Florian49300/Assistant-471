'use strict';
// node --test test/*.test.js   (données fictives, aucun fichier réel dans le dépôt)
const test = require('node:test');
const assert = require('node:assert');
const { parser, enMilliemes, enCentimes, tauxDepuis, caisseDepuisNomFichier, finDeMois } = require('../importeurs/jalia-caisse');
const { controler } = require('../lib/controles');
const config = require('../societes/bdp.json');

const ENTETE =
  'Début;"";Fin;"";Caisse;Total Brut;"";"";Modes de paiement;"";"";Pourboires;TVA 5,50 (5,50%) (€);"";"";TVA 10.00 (10,00%) (€);"";"";Total réductions;Total Net;"";"";Mouvements;Ecart\n' +
  'Date;Jour;Date;Jour;"";TTC;HT;Taxe;Espèces;Carte de crédit;sumup;Total pourboires;TTC;HT;Taxe;TTC;HT;Taxe;TTC;TTC;HT;Taxe;Montant;Montant\n';
const ligne = (date, esp, cb, sumup, ttc55, tva55, ttc10, tva10, net) =>
  `${date} 12:00;Lundi;${date} 22:00;Lundi;iPad;${net};0;0;${esp};${cb};${sumup};0.000;${ttc55};0;${tva55};${ttc10};0;${tva10};0;${net};0;0;0.000;0.000\n`;
const J1 = ligne('01/09/2026', '20.900', '703.300', '0', '36.400', '1.898', '687.800', '62.527', '724.200');
const J2 = ligne('02/09/2026', '10.000', '52.300', '0', '62.300', '3.248', '0', '0', '62.300');
const compte = (p, c) => p.lignes.filter(l => l.compte === c);

test('montants : millièmes exacts et arrondi au centime', () => {
  assert.strictEqual(enMilliemes('734.200'), 734200);
  assert.strictEqual(enCentimes('1,898'), 190);
  assert.strictEqual(enCentimes('0.145'), 15);
  assert.strictEqual(enCentimes('-0.145'), -15);
  assert.strictEqual(enCentimes(''), 0);
});

test('utilitaires', () => {
  assert.strictEqual(tauxDepuis('TVA 5,50 (5,50%) (€)'), '5.5');
  assert.strictEqual(tauxDepuis('TVA 10.00 (10,00%) (€)'), '10');
  assert.strictEqual(tauxDepuis('Remise TVA 5,50 (5,50%) (€)'), null);
  assert.strictEqual(caisseDepuisNomFichier('jalia_export_accounting_850_20260901_x.csv'), '850');
  assert.strictEqual(finDeMois('2026-09-01'), '2026-09-30');
  assert.strictEqual(finDeMois('2028-02-10'), '2028-02-29');
});

test('regroupement mensuel : une pièce au dernier jour du mois', () => {
  const { pieces } = parser(ENTETE + J1 + J2, config, { caisseId: '850', regroupement: 'mois' });
  controler(pieces);
  assert.strictEqual(pieces.length, 1);
  const p = pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join());
  assert.strictEqual(p.date, '2026-09-30');
  assert.strictEqual(p.libelle, 'CAISSE 09.2026');
  assert.strictEqual(p.piece, 'Z850-202609');
  assert.strictEqual(p.cle, 'CA|Z850-202609|2026-09-30');
  assert.strictEqual(p.totalDebit, 72420 + 6230);
  assert.strictEqual(compte(p, '531')[0].debit, 3090);
});

test('TVA arrondie sur le cumul du mois, pas jour par jour', () => {
  // 1,898 + 3,248 = 5,146 -> 5,15 (jour par jour : 1,90 + 3,25 = 5,15) ; cas discriminant ci-dessous
  const a = ligne('01/09/2026', '10.000', '0', '0', '10.000', '0.524', '0', '0', '10.000');
  const b = ligne('02/09/2026', '10.000', '0', '0', '10.000', '0.524', '0', '0', '10.000');
  const { pieces } = parser(ENTETE + a + b, config, { regroupement: 'mois' });
  controler(pieces);
  const tva = compte(pieces[0], '44571006')[0].credit;
  assert.strictEqual(tva, 105);                       // 1,048 -> 1,05 (et non 0,52 + 0,52 = 1,04)
  assert.strictEqual(compte(pieces[0], '706130000')[0].credit, 2000 - 105);
  assert.strictEqual(pieces[0].statut, 'prête');
});

test('regroupement par jour (défaut de config.json)', () => {
  const { pieces } = parser(ENTETE + J1 + J2, config, { caisseId: '850' });
  controler(pieces);
  assert.deepStrictEqual(pieces.map(p => p.piece), ['Z850-20260901', 'Z850-20260902']);
  assert.ok(pieces.every(p => p.statut === 'prête'));
});

test('deux mois dans le fichier : deux pièces', () => {
  const { pieces } = parser(ENTETE + J1 + ligne('01/10/2026', '5.000', '0', '0', '5.000', '0.261', '0', '0', '5.000'), config, { regroupement: 'mois' });
  assert.deepStrictEqual(pieces.map(p => p.libelle), ['CAISSE 09.2026', 'CAISSE 10.2026']);
});

test('encaissements ≠ ventes un jour donné : écart passé en 658 / 758 / 471000000 ; bloqué sans règle d\'écart', () => {
  const jour = (cb) => ligne('03/09/2026', '10.000', cb, '0', '36.400', '1.898', '687.800', '62.527', '724.200');
  const cas = [['714.700', '758', 0, 50], ['713.700', '658', 50, 0], ['700.000', '471000000', 1420, 0]];
  for (const [cb, compte, debit, credit] of cas) {
    const [p1, p2] = controler(parser(ENTETE + J1 + jour(cb), config).pieces);
    assert.strictEqual(p1.statut, 'prête');
    assert.strictEqual(p2.statut, 'prête', p2.raisons.join(' | '));
    const e = p2.lignes.at(-1);
    assert.deepStrictEqual([e.compte, e.debit, e.credit, e.masse], [compte, debit, credit, 'Écart de caisse'], cb);
    assert.match(p2.alertes.join(' '), new RegExp(`passé en ${compte}`));
    assert.strictEqual(p2.ca.ttc, 72420);                 // l'écart n'entre pas dans le chiffre d'affaires
  }
  // Sans règle d'écart : journée bloquée (par jour), mois bloqué avec la date fautive (par mois)
  const sans = { ...config, petitsEcarts: null, compteEcart: null };
  const pieces = controler(parser(ENTETE + J1 + jour('700.000'), sans).pieces);
  assert.deepStrictEqual(pieces.map(p => p.statut), ['prête', 'bloquée']);
  assert.ok(pieces[1].raisons.some(r => r.includes('encaissements')));
  const mois = controler(parser(ENTETE + J1 + jour('700.000'), sans, { regroupement: 'mois' }).pieces);
  assert.strictEqual(mois[0].statut, 'bloquée');
  assert.ok(mois[0].raisons.some(r => r.startsWith('2026-09-03') && r.includes('encaissements')));
});

test('par jour : libellé, date et clé de la pièce', () => {
  const [p] = controler(parser(ENTETE + J1, config, { caisseId: '850' }).pieces);
  assert.strictEqual(p.date, '2026-09-01');
  assert.strictEqual(p.libelle, 'CAISSE 01.09.2026');
  assert.strictEqual(p.cle, 'CA|Z850-20260901|2026-09-01');
  assert.strictEqual(compte(p, '44571006')[0].credit, 190);   // TVA arrondie sur la journée
  assert.strictEqual(compte(p, '706130000')[0].credit, 3640 - 190);
});

test('remboursement négatif : passe au crédit', () => {
  const r = ligne('04/09/2026', '-5.000', '15.000', '0', '0', '0', '10.000', '0.909', '10.000');
  const { pieces } = parser(ENTETE + r, config);
  controler(pieces);
  const esp = compte(pieces[0], '531')[0];
  assert.deepStrictEqual([esp.debit, esp.credit], [0, 500]);
  assert.strictEqual(pieces[0].statut, 'prête', pieces[0].raisons.join());
});

test('mode de paiement inconnu : pièce bloquée', () => {
  const csv = ENTETE.replace('sumup', 'Bitcoin') + ligne('05/09/2026', '0', '0', '10.000', '0', '0', '10.000', '0.909', '10.000');
  const { pieces } = parser(csv, config);
  controler(pieces);
  assert.strictEqual(pieces[0].statut, 'bloquée');
  assert.ok(pieces[0].raisons.some(r => r.includes('Bitcoin')));
});

test('ligne Total : ignorée comme journée, reprise pour rapprochement', () => {
  const csv = ENTETE + J1 + '\nTotal;;;;;724.2;0;0;20.9;703.3;0;0;36.4;0;1.898;687.8;0;62.527;0;724.2;0;0;0;0\n';
  const { journees, totauxFichier } = parser(csv, config);
  assert.strictEqual(journees.length, 1);
  assert.strictEqual(totauxFichier.netTtc, 72420);
  assert.strictEqual(totauxFichier.tva['5.5'].tva, 190);
});

test('fichier qui n\'est pas un export Jalia : erreur claire', () => {
  assert.throws(() => parser('a;b\nc;d\ne;f\n', config), /export Jalia/);
});

test('multi-sociétés : fichier d\'une autre caisse que celle de la société → bloqué', () => {
  const { pieces } = parser(ENTETE + J1, config, { caisseId: '999' });
  controler(pieces);
  assert.strictEqual(pieces[0].statut, 'bloquée');
  assert.match(pieces[0].raisons[0], /caisse 999.*caisse 850/);
});

test('interface importer : buffer, nom de fichier, résumé', () => {
  const imp = require('../importeurs/jalia-caisse');
  const r = imp.importer(Buffer.from(ENTETE + J1 + J2), config, { nomFichier: 'jalia_export_accounting_850_20260901_x.csv' });
  assert.strictEqual(r.pieces.length, 2);
  assert.deepStrictEqual(r.resume.periode, ['2026-09-01', '2026-09-02']);
  assert.deepStrictEqual(r.pieces[0].libellesEnConflit, ['CAISSE 09.2026']);
});

test('toutes les sociétés de societes/*.json se chargent', () => {
  const s = require('../societes').chargerSocietes();
  assert.ok(Object.keys(s).length >= 1);
});

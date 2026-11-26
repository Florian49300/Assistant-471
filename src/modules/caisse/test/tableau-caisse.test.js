'use strict';
// Importeur « tableau-caisse » (SOLAU) et lecteur .xlsx, sur un classeur fictif (test/fixtures).
// Référence facultative : FICHIER_SOLAU=…/2026 09 FCAISSECOMPTABLE.xlsx FICHIER_SOLAU_LCH=…/TABLEAU CAISSE LCH….xlsx npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const imp = require('../importeurs/tableau-caisse');
const { ouvrirClasseur, adresse, lettre } = require('../lib/xlsx');
const { controler } = require('../lib/controles');
const config = require('../societes/solau.json');

const FIXTURE = path.join(__dirname, 'fixtures', '2026 09 TABLEAU-CAISSE-EXEMPLE.xlsx');
const NOM = path.basename(FIXTURE);
const lire = (cfg = config, nom = NOM) => { const r = imp.importer(fs.readFileSync(FIXTURE), cfg, { nomFichier: nom }); controler(r.pieces); return r; };

test('lecteur xlsx : onglets, textes partagés, nombres', () => {
  const c = ouvrirClasseur(fs.readFileSync(FIXTURE));
  assert.deepStrictEqual(c.feuilles, ['2026 08', '2026 09']);
  const f = c.lireFeuille('2026 09');
  assert.strictEqual(f.valeur('A', 3), 'JOUR');
  assert.strictEqual(f.valeur('B', 1), 'SEPTEMBRE');
  assert.strictEqual(Number(f.valeur('L', 4)), 936.58);
  assert.deepStrictEqual(adresse('AB12'), { col: 28, ligne: 12 });
  assert.strictEqual(lettre(28), 'AB');
  assert.throws(() => ouvrirClasseur(Buffer.from('pas un zip')), /classeur Excel/);
});

test('montants Excel : imprécisions binaires et notation scientifique', () => {
  assert.strictEqual(imp.centimes('16.649999999999999'), 1665);
  assert.strictEqual(imp.centimes('1415.7000000000003'), 141570);
  assert.strictEqual(imp.centimes('9.9999999999909051E-3'), 1);
  assert.strictEqual(imp.centimes('-73.27'), -7327);
  assert.strictEqual(imp.centimes(null), 0);
  assert.deepStrictEqual(imp.moisDepuisNom('2026 09 FCAISSECOMPTABLE.xlsx'), { annee: 2026, mois: 9 });
  assert.deepStrictEqual(imp.moisDepuisNom('2021 5'), { annee: 2021, mois: 5 });
  assert.strictEqual(imp.moisDepuisNom('FCAISSE.xlsx'), null);
});

test('mois choisi d\'après le nom du fichier ; jours fermés ignorés ; ligne TOTAL ignorée', () => {
  const r = lire();
  assert.strictEqual(r.resume.onglet, '2026 09');
  assert.deepStrictEqual(r.pieces.map(p => p.date), ['2026-09-01', '2026-09-03', '2026-09-04', '2026-09-05']);
  const aout = lire(config, '2026 08 TABLEAU.xlsx');
  assert.deepStrictEqual(aout.pieces.map(p => p.date), ['2026-08-01']);
  assert.throws(() => lire(config, 'TABLEAU.xlsx'), /nom du fichier doit commencer/);
  assert.throws(() => lire(config, '2026 11 TABLEAU.xlsx'), /onglet du mois 11\/2026 introuvable/);
});

test('une journée : ventes et TVA par taux (TVA du tableau), encaissements, pièce et libellé', () => {
  const p = lire().pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.deepStrictEqual([p.journal, p.piece, p.libelle, p.cle], ['C1', '01/09/2026', 'CAISSE 01/09/2026', 'C1|01/09/2026|2026-09-01']);
  assert.deepStrictEqual(p.lignes.map(l => [l.compte, l.libelleCompte, l.debit, l.credit]), [
    ['70110000', 'Recettes 10%', 0, 93658], ['44571008', 'TVA 10%', 0, 9372],
    ['70121000', 'Recettes 20%', 0, 8335], ['44571009', 'TVA 20%', 0, 1665],
    ['70150000', 'Recettes 5,5%', 0, 4265], ['44571006', 'TVA 5,5%', 0, 235],
    ['511100000', 'Paiements CB', 76100, 0], ['53100000', 'Paiements Espèces', 6500, 0],
    ['511200000', 'Paiements Chèques', 12700, 0], ['411DIFFERE', 'Paiements différés', 22230, 0],
  ]);
  assert.strictEqual(p.totalDebit, 117530);
});

test('bons cadeaux en 511300000 ; colonne de paiement absente de la fiche : journée bloquée', () => {
  const p = lire().pieces[1];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.ok(p.lignes.some(l => l.compte === '511300000' && l.libelleCompte === 'Paiements bons cadeaux' && l.debit === 2000));
  const { 'BON CADEAUX': _, ...sansBon } = config.paiements;
  const b = lire({ ...config, paiements: sansBon }).pieces[1];
  assert.strictEqual(b.statut, 'bloquée');
  assert.match(b.raisons[0], /BON CADEAUX.*non paramétrée \(20,00 €\)/);
});

test('écart de moins de 1 € : excédent en 758 (crédit) avec alerte ; sans aucun compte d\'écart : bloquée', () => {
  const p = lire().pieces[2];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.deepStrictEqual([p.lignes.at(-1).compte, p.lignes.at(-1).debit, p.lignes.at(-1).credit], ['758', 0, 1]);
  assert.match(p.alertes[0], /écart de caisse de 0,01 €.*passé en 758/);
  const b = lire({ ...config, compteEcart: null, petitsEcarts: null }).pieces[2];
  assert.strictEqual(b.statut, 'bloquée');
  assert.match(b.raisons[0], /déséquilibrée.*écart 0,01 €/);
});

test('règle des écarts : < 1 € en 658 (manque) / 758 (excédent), 1 € et plus en 471000000', () => {
  const { compteEcart } = require('../lib/ecarts');
  assert.strictEqual(compteEcart(config, 1).compte, '758');
  assert.strictEqual(compteEcart(config, 99).compte, '758');
  assert.strictEqual(compteEcart(config, -1).compte, '658');
  assert.strictEqual(compteEcart(config, -99).compte, '658');
  assert.strictEqual(compteEcart(config, 100).compte, '471000000');
  assert.strictEqual(compteEcart(config, -250).compte, '471000000');
  assert.strictEqual(compteEcart({}, 5), null);
});

test('montant négatif (remboursement CB) : passé au crédit', () => {
  const p = lire().pieces[3];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.deepStrictEqual(p.lignes.map(l => [l.compte, l.debit, l.credit]), [['511100000', 0, 1000], ['53100000', 1000, 0]]);
});

test('option tvaRecalculee : TVA = HT × taux arrondi, écart sur le compte d\'écart', () => {
  const p = lire({ ...config, tvaRecalculee: true }).pieces[0];
  const tva = Object.fromEntries(p.lignes.filter(l => l.masse === 'TVA collectée').map(l => [l.compte, l.credit]));
  assert.deepStrictEqual(tva, { 44571008: 9366, 44571009: 1667, 44571006: 235 });   // 936,58×10 % ; 83,35×20 % ; 42,65×5,5 %
  const e = p.lignes.find(l => l.masse === 'Écart de caisse');
  assert.deepStrictEqual([e.compte, e.credit], ['758', 4]);                            // 0,04 € comme la colonne « Ecart » du tableau LCH
  assert.strictEqual(p.statut, 'prête');
});

test('rapprochement', () => {
  const { resume } = lire();
  const r = Object.fromEntries(resume.rapprochement.map(x => [x.libelle, [x.fichier, x.ecritures]]));
  assert.deepStrictEqual(r['Ventes HT'], [r['Ventes HT'][1], r['Ventes HT'][1]]);
  assert.strictEqual(r['TVA collectée'][0], r['TVA collectée'][1]);
});

// ---------- Référence : classeur réel vs tableau LCH ----------
const BRUT = process.env.FICHIER_SOLAU, LCH = process.env.FICHIER_SOLAU_LCH;
test('septembre 2026 : identique au tableau LCH en mode TVA recalculée ; seule la TVA diffère sinon', { skip: !(BRUT && LCH) && 'fichiers de référence non fournis' }, () => {
  const t = ouvrirClasseur(fs.readFileSync(LCH)).lireFeuille('2026 09');
  const serie = n => new Date(Date.UTC(1899, 11, 30) + Number(n) * 86400000).toISOString().slice(0, 10);
  const court = c => String(c).replace(/0+$/, '');      // 51110000 (LCH) = 511100000 (Pennylane)
  const lch = {};
  for (let l = 7; l <= t.maxLigne; l++) {
    if (t.valeur('AB', l) !== 'C1') continue;
    const m = imp.centimes(t.valeur('AH', l)) - imp.centimes(t.valeur('AI', l));
    if (m) (lch[serie(t.valeur('AC', l))] ||= []).push(`${court(t.valeur('AD', l))}|${t.valeur('AG', l).replace('Paiements TR CB', 'Paiements CB internet')}|${m}`);
  }
  for (const recalc of [true, false]) {
    const { pieces } = imp.importer(fs.readFileSync(BRUT), { ...config, tvaRecalculee: recalc }, { nomFichier: path.basename(BRUT) });
    controler(pieces);
    assert.strictEqual(pieces.length, 22);
    for (const p of pieces) {
      assert.strictEqual(p.statut, 'prête', `${p.date} ${p.raisons}`);
      const nous = p.lignes.filter(x => x.masse !== 'Écart de caisse').map(x => `${court(x.compte)}|${x.libelleCompte}|${x.debit - x.credit}`);
      const diff = nous.filter(x => !lch[p.date].includes(x)).concat(lch[p.date].filter(x => !nous.includes(x)));
      if (recalc) assert.deepStrictEqual(diff, [], p.date);
      else assert.ok(diff.every(x => x.startsWith('4457')), `${p.date} : ${diff}`);
    }
  }
});

test('SOLAU : la colonne CB EN LIGNE n\'est plus utilisée, une saisie dedans bloque la journée', () => {
  assert.ok(!('CB EN LIGNE' in config.paiements));
  const { ouvrirClasseur } = require('../lib/xlsx');
  const col = ouvrirClasseur(fs.readFileSync(FIXTURE)).lireFeuille('2026 09');
  assert.strictEqual(col.valeur('G', 3), 'CB EN LIGNE');          // la colonne existe bien dans le tableau
});

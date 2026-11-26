'use strict';
// COTE PISTE : export « Export du … au … » (3 décimales, ";", Windows-1252), données fictives.
// Test de référence facultatif contre le fichier retraité du cabinet :
//   FICHIER_COTEPISTE=…/Export.csv FICHIER_COTEPISTE_RETRAITE=…/Export V2 LCH.csv npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const imp = require('../importeurs/ecritures-caisse');
const { enMilliemes } = require('../importeurs/jalia-caisse');
const { controler } = require('../lib/controles');
const config = require('../societes/cote-piste.json');

// Variante avec des comptes de paiement numériques, pour tester une journée « prête »
const configNum = { ...config, comptesCaisse: {
  '411CB': { compte: '5111' }, '411VIR': { compte: '5115' }, '53100000': { compte: '531' }, 'COMPTE REGLE411': { compte: '4110' },
} };

const ENTETE = 'Journal;Date;Compte;Libelle Compte;Pièce;Libellé Mouvement;Débit;Crédit;Taux;TVA;\r\n';
const JOUR = [
  ';03-09-26;70700000;;03-09;Vins_20.00;;101.000;20.000;;',
  ';03-09-26;70700000;;03-09;Divers_10.00;;0.365;10.000;;',          // compte 707 dans la caisse, mais 10 %
  ';03-09-26;70110000;;03-09;Formules plats_10.00;;469.727;10.000;;',
  ';03-09-26;70110000;;03-09;Menus_10.00;;-73.272;10.000;;',          // crédit négatif = remise
  ';03-09-26;44571301;;03-09;Tva 10.00%;;39.682;;;',
  ';03-09-26;44571201;;03-09;Tva 20.00%;;20.200;;;',
  ';03-09-26;COMPTE REGLE411;;03-09;COMPTE REGLE;;472.100;;',
  ';03-09-26;411VIR;;03-09;VIREMENT;472.100;;;',
  ';03-09-26;53100000;;03-09;ESPECES;;2.999;;',                       // rendu de monnaie
  ';03-09-26;411CB;;03-09;VISA;560.700;;;',
].join('\r\n') + '\r\n';
const enc = s => Buffer.from(new TextEncoder().encode(s));   // UTF-8 ; le Windows-1252 est testé plus bas
const lire = (txt, cfg = configNum) => { const r = imp.importer(enc(txt), cfg, { nomFichier: 'Export du 01-09-26 au 30-09-26.csv' }); controler(r.pieces); return r; };

test('dates et modèles de pièce', () => {
  assert.strictEqual(imp.lireDate('03-09-26'), '2026-09-03');
  assert.strictEqual(imp.lireDate('03/09/2026'), '2026-09-03');
  assert.strictEqual(imp.lireDate('2026-09-03'), '2026-09-03');
  assert.strictEqual(imp.lireDate('32-09-26'), null);
  assert.strictEqual(imp.remplir('{m}/{j}', '03-09', '2026-09-03'), '9/3');
  assert.strictEqual(imp.remplir('CAISSE {jj}/{mm}/{aaaa}', '', '2026-09-03'), 'CAISSE 03/09/2026');
  assert.strictEqual(imp.tauxDepuisLibelle('Bières_20.00'), '20');
  assert.strictEqual(imp.tauxDepuisLibelle('Tva 10.00%'), '10');
});

test('une journée : journal C1, pièce 9/3, ventes par taux, négatifs basculés, arrondi absorbé', () => {
  const { pieces, resume } = lire(ENTETE + JOUR);
  assert.strictEqual(pieces.length, 1);
  const p = pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.deepStrictEqual([p.journal, p.piece, p.date, p.libelle, p.cle], ['C1', '9/3', '2026-09-03', 'CAISSE 03/09/2026', 'C1|9/3|2026-09-03']);
  const l = p.lignes.map(x => [x.compte, x.libelleCompte, x.debit, x.credit]);
  assert.deepStrictEqual(l, [
    ['70700000', 'Vins_20.00', 0, 10100],
    ['70110000', 'Divers_10.00', 0, 37],           // 70700000 -> 70110000 (10 %)
    ['70110000', 'Formules plats_10.00', 0, 46972], // 469,727 -> 469,73, moins 1 centime d'arrondi
    ['70110000', 'Menus_10.00', 7327, 0],           // -73,272 au crédit -> 73,27 au débit
    ['44571008', 'Tva 10.00%', 0, 3968],
    ['44571009', 'Tva 20.00%', 0, 2020],
    ['4110', 'COMPTE REGLE', 0, 47210],
    ['5115', 'VIREMENT', 47210, 0],
    ['531', 'ESPECES', 0, 300],                     // rendu de monnaie : crédit
    ['5111', 'VISA', 56070, 0],
  ]);
  assert.strictEqual(p.arrondi, -1);
  assert.strictEqual(p.totalDebit, p.totalCredit);
  const info = resume.rapprochement.find(x => x.info);
  assert.strictEqual(info.ecritures, -1);
  assert.ok(resume.rapprochement.filter(x => !x.info).every(x => x.fichier === x.ecritures));
});

test('fiche réelle : comptes de paiement alphanumériques du dossier (411CB0000…) acceptés', () => {
  const p = lire(ENTETE + JOUR, config).pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  const c = Object.fromEntries(p.lignes.filter(l => l.masse === 'Encaissements').map(l => [l.libelleCompte, l.compte]));
  assert.deepStrictEqual(c, { 'COMPTE REGLE': '411DIFFERE', VIREMENT: '411VIR000', ESPECES: '531000000', VISA: '411CB0000' });
});

test('paiements différés : 411DIFFERES (et 411DIFFERE, COMPTE REGLE411) -> 411DIFFERE', () => {
  for (const code of ['411DIFFERES', '411DIFFERE', 'COMPTE REGLE411']) {
    const p = lire(ENTETE + JOUR.replace('COMPTE REGLE411;', `${code};`), config).pieces[0];
    assert.strictEqual(p.statut, 'prête', `${code} : ${p.raisons.join(' | ')}`);
    assert.ok(p.lignes.some(l => l.compte === '411DIFFERE' && l.credit === 47210), code);
  }
});

test('écart au-delà de l\'arrondi : moins de 1 € en 758 / 658, 1 € et plus en 471000000, sans fiche d\'écart : bloquée', () => {
  // 0,10 € de VISA en plus, moins 1 centime d'arrondi de la ligne Divers -> excédent de 0,09 €
  const p = lire(ENTETE + JOUR.replace('VISA;560.700', 'VISA;560.800')).pieces[0];
  assert.strictEqual(p.statut, 'prête', p.raisons.join(' | '));
  assert.strictEqual(p.arrondi, 0);
  assert.deepStrictEqual([p.lignes.at(-1).compte, p.lignes.at(-1).debit, p.lignes.at(-1).credit], ['758', 0, 9]);
  assert.match(p.alertes[0], /écart de caisse de 0,09 €.*758/);
  // Manque de 0,50 € -> 658 au débit
  const m = lire(ENTETE + JOUR.replace('VISA;560.700', 'VISA;560.200')).pieces[0];
  assert.deepStrictEqual([m.lignes.at(-1).compte, m.lignes.at(-1).debit], ['658', 51]);
  // Excédent de 2 € -> 471000000
  const g = lire(ENTETE + JOUR.replace('VISA;560.700', 'VISA;562.700')).pieces[0];
  assert.deepStrictEqual([g.lignes.at(-1).compte, g.lignes.at(-1).credit], ['471000000', 199]);
  // Sans règle d'écart dans la fiche : bloquée
  const b = lire(ENTETE + JOUR.replace('VISA;560.700', 'VISA;560.800'), { ...configNum, petitsEcarts: null, compteEcart: null }).pieces[0];
  assert.strictEqual(b.statut, 'bloquée');
  assert.match(b.raisons[0], /écart 0,09 €/);
});

test('fichier en Windows-1252 (comme l\'export réel)', () => {
  const txt = ENTETE + JOUR;
  const octets = Buffer.from(txt.replace(/[èé]/g, c => ({ 'è': 'è', 'é': 'é' })[c]), 'latin1');
  const r = imp.importer(octets, configNum, {});
  controler(r.pieces);
  assert.strictEqual(r.pieces[0].statut, 'prête', r.pieces[0].raisons.join(' | '));
});

// ---------- Référence : fichier brut vs fichier retraité par le cabinet ----------
const BRUT = process.env.FICHIER_COTEPISTE, RETRAITE = process.env.FICHIER_COTEPISTE_RETRAITE;
test('septembre 2026 : identique au fichier retraité V2 LCH (hors centimes d\'arrondi)', { skip: !(BRUT && RETRAITE) && 'fichiers de référence non fournis' }, () => {
  const { pieces } = imp.importer(fs.readFileSync(BRUT), config, { nomFichier: path.basename(BRUT) });
  const ret = new TextDecoder('windows-1252').decode(fs.readFileSync(RETRAITE)).split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split(';'));
  const cent = s => { const m = enMilliemes(s); return Math.sign(m) * Math.round(Math.abs(m) / 10); };
  assert.strictEqual(pieces.length, 22);
  for (const p of pieces) {
    const [a, m, j] = p.date.split('-');
    const attendu = ret.filter(r => r[1] === `${j}/${m}/${a}`);
    assert.ok(attendu.every(r => r[0] === 'C1' && r[4] === p.piece), `journal/pièce ${p.piece}`);
    const nous = p.lignes.map(l => `${l.compte}|${l.libelleCompte}|${l.debit - l.credit}`);
    const traduire = c => Object.values(config.comptesCaisse).some(x => x.compte === c) ? c : (config.comptesCaisse[c]?.compte || c);
    const eux = attendu.map(r => `${traduire(r[2])}|${r[5]}|${cent(r[6]) - cent(r[7])}`);
    // Les codes de paiement sont identiques ; seule la plus grosse vente peut différer des centimes d'arrondi
    const diffNous = nous.filter(x => !eux.includes(x)), diffEux = eux.filter(x => !nous.includes(x));
    assert.ok(diffNous.length <= 1 && diffEux.length <= 1, `${p.date} : ${diffNous} / ${diffEux}`);
    if (diffNous.length) {
      const [c1, l1, v1] = diffNous[0].split('|'), [c2, l2, v2] = diffEux[0].split('|');
      assert.strictEqual(c1, c2); assert.strictEqual(l1, l2);
      assert.ok(Math.abs(Number(v1) - Number(v2)) <= 5, `${p.date} : arrondi ${v1} vs ${v2}`);
    }
    assert.strictEqual(p.lignes.reduce((s, l) => s + l.debit, 0), p.lignes.reduce((s, l) => s + l.credit, 0), `${p.date} équilibrée`);
  }
});

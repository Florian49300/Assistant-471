#!/usr/bin/env node
'use strict';
// Vérifie la transformation d'un fichier SANS appeler Pennylane.
// Usage : node outils/verifier-import.js <id-societe> <fichier> [dossier_sortie]
// Écrit <dossier_sortie>/ecritures.csv (ouvrable dans Excel).
const fs = require('fs');
const path = require('path');
const { chargerSocietes } = require('../societes');
const importeurs = require('../importeurs');
const { controler } = require('../lib/controles');

const [idSociete, fichier, sortie = path.join(process.cwd(), 'sortie')] = process.argv.slice(2);
const societes = chargerSocietes();
if (!idSociete || !fichier || !societes[idSociete]) {
  console.error(`Usage : node outils/verifier-import.js <id-societe> <fichier> [dossier_sortie]\nSociétés : ${Object.keys(societes).join(', ')}`);
  process.exit(1);
}
const societe = societes[idSociete];
const fmt = c => (c / 100).toFixed(2).replace('.', ',');
const { pieces, resume } = importeurs[societe.importeur].importer(fs.readFileSync(fichier), societe, { nomFichier: path.basename(fichier) });
controler(pieces);

const pretes = pieces.filter(p => p.statut === 'prête').length;
const ca = pieces.reduce((s, p) => ({ ht: s.ht + p.ca.ht, tva: s.tva + p.ca.tva, ttc: s.ttc + p.ca.ttc }), { ht: 0, tva: 0, ttc: 0 });
console.log(`\n${societe.nom} — ${pieces.length} pièce(s) : ${pretes} prête(s), ${pieces.length - pretes} bloquée(s)`);
console.log(`CA TTC importé : ${fmt(ca.ttc)} € (HT ${fmt(ca.ht)} € · TVA ${fmt(ca.tva)} €) — à rapprocher des tickets Z\n`);
for (const p of pieces) {
  console.log(`${p.statut === 'prête' ? 'OK' : 'KO'}  ${p.journal}  ${p.date}  ${p.piece.padEnd(16)} ${p.libelle.padEnd(22)} CA TTC ${fmt(p.ca.ttc).padStart(10)} €`);
  for (const r of p.raisons) console.log(`      ✗ ${r}`);
  for (const a of p.alertes) console.log(`      ! ${a}`);
}
if (resume?.rapprochement?.length) {
  console.log('\nRapprochement fichier / écritures :');
  for (const x of resume.rapprochement) {
    const e = x.ecritures - x.fichier;
    console.log(`  ${x.libelle.padEnd(20)} fichier ${fmt(x.fichier).padStart(10)}   écritures ${fmt(x.ecritures).padStart(10)}   ${x.info ? '(information)' : e ? 'écart ' + fmt(e) : 'OK'}`);
  }
}
fs.mkdirSync(sortie, { recursive: true });
const rows = [['Statut', 'Journal', 'Date', 'Pièce', 'Libellé pièce', 'Compte', 'Libellé ligne', 'Débit', 'Crédit']];
for (const p of pieces) for (const l of p.lignes)
  rows.push([p.statut, p.journal, p.date, p.piece, p.libelle, l.compte, l.libelleCompte, l.debit ? fmt(l.debit) : '', l.credit ? fmt(l.credit) : '']);
fs.writeFileSync(path.join(sortie, 'ecritures.csv'), '﻿' + rows.map(r => r.join(';')).join('\r\n') + '\r\n');
console.log(`\nÉcrit : ${path.join(sortie, 'ecritures.csv')}\n`);

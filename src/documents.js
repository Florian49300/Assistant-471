'use strict';
/** Génération du tableau Excel client et du brouillon de mail .eml. */
const ExcelJS = require('exceljs');
const MailComposer = require('nodemailer/lib/mail-composer');
const { totaux, euros, dateFr, nomFichier } = require('./retraitement');

const BLEU = 'FF1F3864';
const GRIS = 'FFF2F2F2';
const JAUNE = 'FFFFF2CC';
const FORMAT_EUR = '#,##0.00 "€"';

const objetMail = (d) => `${d.nom} - Opérations bancaires à justifier`;
const nomExcel = (d) => `${nomFichier(d.nom)}_operations_a_justifier.xlsx`;

function corpsMail(d, signature, maxLignes = 15) {
  const n = d.operations.length;
  const t = totaux(d.operations);
  const lignes = [
    'Bonjour,',
    '',
    'Dans le cadre de la tenue de votre comptabilité, nous avons relevé ' +
      (n > 1 ? `${n} opérations bancaires pour lesquelles` : '1 opération bancaire pour laquelle') +
      " nous n'avons pas de justificatif ou d'explication :",
    '',
    `  • Dépenses à justifier : ${euros(t.depenses)}`,
    `  • Recettes à justifier : ${euros(t.recettes)}`,
    '',
    'Détail :',
  ];
  for (const o of d.operations.slice(0, maxLignes)) {
    const sens = o.depense ? `Dépense ${euros(o.depense)}` : `Recette ${euros(o.recette)}`;
    lignes.push(`  - ${dateFr(o.date)} | ${o.libelle} | ${sens}`);
  }
  if (n > maxLignes) lignes.push(`  ... et ${n - maxLignes} autre(s) opération(s), voir le fichier joint.`);
  lignes.push(
    '',
    "Vous trouverez en pièce jointe un tableau reprenant ces opérations. Pourriez-vous, pour chacune d'elles, " +
      'nous indiquer sa nature dans les colonnes jaunes et nous transmettre les justificatifs correspondants ' +
      '(factures, tickets, contrats...) ?',
    '',
    'Vous pouvez aussi déposer directement les justificatifs dans votre espace Pennylane.',
    '',
    'Nous restons à votre disposition pour toute question.',
    '',
    'Bien cordialement,',
    signature,
  );
  return lignes.join('\n');
}

async function excelBuffer(d) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cabinet DG';
  const ws = wb.addWorksheet('Opérations à justifier', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const fin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const bord = { top: fin, left: fin, bottom: fin, right: fin };
  const fond = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  ws.mergeCells('A1:G1');
  ws.mergeCells('A2:G2');
  ws.getCell('A1').value = `${d.nom} - Opérations bancaires à justifier`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: BLEU } };
  ws.getCell('A2').value =
    `Situation au ${new Date().toLocaleDateString('fr-FR')}. Merci de compléter les colonnes en jaune ` +
    'et de nous joindre les justificatifs (facture, ticket, contrat...).';
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF595959' } };

  const entetes = ['Date', 'Libellé bancaire', 'Dépense', 'Recette', "Nature de l'opération", 'Justificatif joint ?', 'Commentaire'];
  const largeurs = [12, 48, 14, 14, 36, 18, 36];
  entetes.forEach((h, i) => {
    const c = ws.getCell(4, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fond(BLEU);
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = bord;
    ws.getColumn(i + 1).width = largeurs[i];
  });

  let r = 5;
  for (const o of d.operations) {
    const [y, m, j] = o.date.split('-').map(Number);
    const vals = [new Date(Date.UTC(y, m - 1, j)), o.libelle, o.depense ? o.depense / 100 : null, o.recette ? o.recette / 100 : null, null, null, null];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.border = bord;
      c.alignment = { vertical: 'top', wrapText: [1, 4, 6].includes(i) };
      if (i === 0) c.numFmt = 'dd/mm/yyyy';
      if (i === 2 || i === 3) c.numFmt = FORMAT_EUR;
      if (i >= 4) c.fill = fond(JAUNE);
      else if ((r - 5) % 2) c.fill = fond(GRIS);
    });
    ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Oui,Non,À venir"'] };
    r++;
  }

  const der = r - 1;
  const t = totaux(d.operations);
  ws.getCell(r, 2).value = 'TOTAL';
  ws.getCell(r, 2).font = { bold: true };
  [[3, 'C', t.depenses], [4, 'D', t.recettes]].forEach(([col, lettre, tot]) => {
    const c = ws.getCell(r, col);
    c.value = der >= 5 ? { formula: `SUM(${lettre}5:${lettre}${der})`, result: tot / 100 } : 0;
    c.font = { bold: true };
    c.numFmt = FORMAT_EUR;
    c.border = { top: { style: 'medium', color: { argb: BLEU } } };
  });
  ws.autoFilter = `A4:G${Math.max(der, 4)}`;

  const aide = wb.addWorksheet('Comment remplir');
  aide.getColumn(1).width = 110;
  [
    'Comment remplir ce tableau ?', '',
    'Dépense = argent sorti de votre compte bancaire.',
    'Recette = argent reçu sur votre compte bancaire.', '',
    'Pour chaque ligne, indiquez dans les colonnes jaunes :',
    " • Nature de l'opération : de quoi s'agit-il ? (ex. achat de fournitures, loyer, remboursement client, apport personnel...)",
    ' • Justificatif joint ? : Oui / Non / À venir',
    ' • Commentaire : toute précision utile (fournisseur, client, numéro de facture...)', '',
    'Renvoyez-nous ce fichier complété avec les justificatifs, par retour de mail.',
  ].forEach((t, i) => (aide.getCell(i + 1, 1).value = t));
  aide.getCell('A1').font = { bold: true, size: 13, color: { argb: BLEU } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Brouillon .eml marqué « non envoyé » : Outlook l'ouvre comme un nouveau message, Excel joint. */
async function emlBuffer(d, { destinataire = '', expediteur = '', signature = '', corps = null } = {}) {
  const mail = new MailComposer({
    from: expediteur || undefined,
    to: destinataire || undefined,
    subject: objetMail(d),
    text: corps || corpsMail(d, signature),
    headers: { 'X-Unsent': '1' },
    attachments: [{
      filename: nomExcel(d),
      content: await excelBuffer(d),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  });
  return mail.compile().build();
}

module.exports = { objetMail, nomExcel, corpsMail, excelBuffer, emlBuffer };

'use strict';
/**
 * Génération des documents client :
 *  - un Excel « Dépenses à justifier » et un Excel « Recettes à justifier »
 *    (tous les sous-comptes 4716* / 4717* consolidés),
 *  - le brouillon de mail .eml avec ces Excel en pièces jointes.
 */
const ExcelJS = require('exceljs');
const MailComposer = require('nodemailer/lib/mail-composer');
const { totaux, euros, dateFr, nomFichier } = require('./retraitement');

const BLEU = 'FF1F3864';
const GRIS = 'FFF2F2F2';
const JAUNE = 'FFFFF2CC';
const FORMAT_EUR = '#,##0.00 "€"';

const TYPES = {
  depenses: {
    titre: 'Dépenses à justifier',
    fichier: 'depenses_a_justifier',
    champ: 'depense',
    explication: 'Dépense = argent sorti de votre compte bancaire.',
    exemples: 'achat de fournitures, loyer, abonnement, frais de déplacement, prélèvement personnel...',
    justificatifs: 'facture, ticket de caisse, contrat...',
  },
  recettes: {
    titre: 'Recettes à justifier',
    fichier: 'recettes_a_justifier',
    champ: 'recette',
    explication: 'Recette = argent reçu sur votre compte bancaire.',
    exemples: 'paiement client, remboursement, apport personnel, subvention, avoir fournisseur...',
    justificatifs: 'facture émise, avis de remboursement, courrier...',
  },
};

/** Opérations d'un type (dépenses ou recettes). */
const operationsDe = (d, type) => d.operations.filter((o) => o[TYPES[type].champ] > 0);

const objetMail = (d) => `${d.nom} - Opérations bancaires à justifier`;
const nomExcel = (d, type) => `${nomFichier(d.nom)}_${TYPES[type].fichier}.xlsx`;

function corpsMail(d, signature, maxLignes = 15) {
  const dep = operationsDe(d, 'depenses');
  const rec = operationsDe(d, 'recettes');
  const t = totaux(d.operations);
  const n = d.operations.length;
  const pluriel = (k, mot) => `${k} ${mot}${k > 1 ? 's' : ''}`;

  const lignes = [
    'Bonjour,',
    '',
    'Dans le cadre de la tenue de votre comptabilité, nous avons relevé ' +
      (n > 1 ? `${n} opérations bancaires pour lesquelles` : '1 opération bancaire pour laquelle') +
      " nous n'avons pas de justificatif ou d'explication.",
  ];

  const section = (titre, ops, total, champ) => {
    if (!ops.length) return;
    lignes.push('', `${titre} (${pluriel(ops.length, 'opération')}, total ${euros(total)}) :`);
    for (const o of ops.slice(0, maxLignes)) {
      lignes.push(`  - ${dateFr(o.date)} | ${o.libelle || '(sans libellé)'} | ${euros(o[champ])}`);
    }
    if (ops.length > maxLignes) lignes.push(`  ... et ${ops.length - maxLignes} autre(s), voir le fichier joint.`);
  };
  section('DÉPENSES à justifier', dep, t.depenses, 'depense');
  section('RECETTES à justifier', rec, t.recettes, 'recette');

  const fichiers = [dep.length && 'les dépenses', rec.length && 'les recettes'].filter(Boolean);
  lignes.push(
    '',
    (fichiers.length > 1
      ? 'Vous trouverez en pièces jointes deux tableaux, un pour les dépenses et un pour les recettes.'
      : `Vous trouverez en pièce jointe un tableau reprenant ${fichiers[0]}.`) +
      " Pourriez-vous, pour chaque opération, nous indiquer sa nature dans les colonnes jaunes et nous " +
      'transmettre les justificatifs correspondants ?',
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

async function excelBuffer(d, type) {
  const cfg = TYPES[type];
  if (!cfg) throw new Error(`Type de fichier inconnu : ${type}`);
  const ops = operationsDe(d, type);
  const total = ops.reduce((s, o) => s + o[cfg.champ], 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cabinet DG';
  const ws = wb.addWorksheet(cfg.titre, {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const fin = { style: 'thin', color: { argb: 'FFBFBFBF' } };
  const bord = { top: fin, left: fin, bottom: fin, right: fin };
  const fond = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  ws.mergeCells('A1:F1');
  ws.mergeCells('A2:F2');
  ws.getCell('A1').value = `${d.nom} - ${cfg.titre}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: BLEU } };
  ws.getCell('A2').value =
    `Situation au ${new Date().toLocaleDateString('fr-FR')}. Merci de compléter les colonnes en jaune ` +
    `et de nous joindre les justificatifs (${cfg.justificatifs}).`;
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF595959' } };

  const entetes = ['Date', 'Libellé bancaire', 'Montant', "Nature de l'opération", 'Justificatif joint ?', 'Commentaire'];
  const largeurs = [12, 55, 14, 38, 18, 38];
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
  for (const o of ops) {
    const [y, m, j] = o.date.split('-').map(Number);
    const vals = [new Date(Date.UTC(y, m - 1, j)), o.libelle, o[cfg.champ] / 100, null, null, null];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      c.border = bord;
      c.alignment = { vertical: 'top', wrapText: [1, 3, 5].includes(i) };
      if (i === 0) c.numFmt = 'dd/mm/yyyy';
      if (i === 2) c.numFmt = FORMAT_EUR;
      if (i >= 3) c.fill = fond(JAUNE);
      else if ((r - 5) % 2) c.fill = fond(GRIS);
    });
    ws.getCell(r, 5).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Oui,Non,À venir"'] };
    r++;
  }

  const der = r - 1;
  ws.getCell(r, 2).value = 'TOTAL';
  ws.getCell(r, 2).font = { bold: true };
  const c = ws.getCell(r, 3);
  c.value = der >= 5 ? { formula: `SUM(C5:C${der})`, result: total / 100 } : 0;
  c.font = { bold: true };
  c.numFmt = FORMAT_EUR;
  c.border = { top: { style: 'medium', color: { argb: BLEU } } };
  ws.autoFilter = `A4:F${Math.max(der, 4)}`;

  const aide = wb.addWorksheet('Comment remplir');
  aide.getColumn(1).width = 110;
  [
    'Comment remplir ce tableau ?', '',
    cfg.explication, '',
    'Pour chaque ligne, indiquez dans les colonnes jaunes :',
    ` • Nature de l'opération : de quoi s'agit-il ? (ex. ${cfg.exemples})`,
    ' • Justificatif joint ? : Oui / Non / À venir',
    ' • Commentaire : toute précision utile (fournisseur, client, numéro de facture...)', '',
    'Renvoyez-nous ce fichier complété avec les justificatifs, par retour de mail.',
  ].forEach((t, i) => (aide.getCell(i + 1, 1).value = t));
  aide.getCell('A1').font = { bold: true, size: 13, color: { argb: BLEU } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Brouillon .eml marqué « non envoyé » : Outlook l'ouvre comme un nouveau message, Excel joints. */
async function emlBuffer(d, { destinataire = '', expediteur = '', signature = '', corps = null } = {}) {
  const attachments = [];
  for (const type of Object.keys(TYPES)) {
    if (!operationsDe(d, type).length) continue;
    attachments.push({
      filename: nomExcel(d, type),
      content: await excelBuffer(d, type),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
  const mail = new MailComposer({
    from: expediteur || undefined,
    to: destinataire || undefined,
    subject: objetMail(d),
    text: corps || corpsMail(d, signature),
    headers: { 'X-Unsent': '1' },
    attachments,
  });
  return mail.compile().build();
}

module.exports = { TYPES, operationsDe, objetMail, nomExcel, corpsMail, excelBuffer, emlBuffer };

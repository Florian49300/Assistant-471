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

// --------------------------------------------------------------------------
// Corps du mail : texte d'introduction + tableaux + texte de conclusion.
// Le mail est envoyé en HTML (tableaux lisibles, signature Outlook possible)
// avec une version texte de secours pour les messageries qui n'affichent pas le HTML.
// --------------------------------------------------------------------------
const pluriel = (k, mot) => `${k} ${mot}${k > 1 ? 's' : ''}`;

function texteAvant(d) {
  const n = d.operations.length;
  return [
    'Bonjour,',
    '',
    'Dans le cadre de la tenue de votre comptabilité, nous avons relevé ' +
      (n > 1 ? `${n} opérations bancaires pour lesquelles` : '1 opération bancaire pour laquelle') +
      " nous n'avons pas de justificatif ou d'explication.",
  ].join('\n');
}

function texteApres(d) {
  const deux = operationsDe(d, 'depenses').length && operationsDe(d, 'recettes').length;
  return [
    (deux
      ? 'Vous trouverez en pièces jointes deux tableaux, un pour les dépenses et un pour les recettes.'
      : 'Vous trouverez en pièce jointe un tableau reprenant ces opérations.') +
      ' Pourriez-vous, pour chaque opération, nous indiquer sa nature dans les colonnes jaunes et nous ' +
      'transmettre les justificatifs correspondants ?',
    '',
    'Vous pouvez aussi déposer directement les justificatifs dans votre espace Pennylane.',
    '',
    'Nous restons à votre disposition pour toute question.',
    '',
    'Bien cordialement,',
  ].join('\n');
}

const echapper = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Texte saisi -> paragraphes HTML (lignes vides = nouveau paragraphe). */
const texteEnHtml = (t) =>
  String(t || '')
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 12px 0">${echapper(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

const POLICE = "font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1d2330";

/** Tableaux HTML (styles en ligne : seul format fiable dans Outlook). */
function tableauxHtml(d) {
  const blocs = [];
  for (const [type, couleur] of [['depenses', '#b42318'], ['recettes', '#067647']]) {
    const ops = operationsDe(d, type);
    if (!ops.length) continue;
    const { titre, champ } = TYPES[type];
    const total = ops.reduce((s, o) => s + o[champ], 0);
    const th = (t, largeur, align = 'left') =>
      `<th width="${largeur}" style="${POLICE};width:${largeur}px;background:#1f3864;color:#ffffff;font-weight:bold;text-align:${align};padding:6px 10px;border:1px solid #1f3864">${t}</th>`;
    const td = (t, extra = '') => `<td style="${POLICE};padding:5px 10px;border:1px solid #d0d5dd;${extra}">${t}</td>`;
    const lignes = ops
      .map((o, i) => {
        const fond = i % 2 ? 'background:#f2f4f7;' : '';
        return `<tr>${td(dateFr(o.date), fond + 'white-space:nowrap')}${td(echapper(o.libelle || '(sans libellé)'), fond)}${td(
          euros(o[champ]).replace(/ /g, '&nbsp;'),
          fond + 'text-align:right;white-space:nowrap',
        )}</tr>`;
      })
      .join('\n');
    blocs.push(
      `<p style="${POLICE};font-weight:bold;color:${couleur};margin:18px 0 6px 0">${titre} (${pluriel(ops.length, 'opération')})</p>\n` +
        `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">\n` +
        `<tr>${th('Date', 95)}${th('Libellé bancaire', 340)}${th('Montant', 110, 'right')}</tr>\n${lignes}\n` +
        `<tr>${td('', 'border:0')}${td('<b>Total</b>', 'border:0;text-align:right')}${td(
          `<b>${euros(total).replace(/ /g, '&nbsp;')}</b>`,
          `border:0;border-top:2px solid #1f3864;text-align:right;white-space:nowrap;color:${couleur}`,
        )}</tr>\n</table>`,
    );
  }
  return blocs.join('\n');
}

/** Version texte (secours) : tableaux alignés en colonnes. */
function tableauxTexte(d) {
  const out = [];
  for (const type of ['depenses', 'recettes']) {
    const ops = operationsDe(d, type);
    if (!ops.length) continue;
    const { titre, champ } = TYPES[type];
    const lib = (o) => (o.libelle || '(sans libellé)').slice(0, 45);
    const larg = Math.max(16, ...ops.map((o) => lib(o).length));
    const total = ops.reduce((s, o) => s + o[champ], 0);
    out.push('', `${titre.toUpperCase()} (${pluriel(ops.length, 'opération')})`, '');
    out.push(`Date        ${'Libellé'.padEnd(larg)}  ${'Montant'.padStart(13)}`);
    out.push('-'.repeat(12 + larg + 15));
    for (const o of ops) out.push(`${dateFr(o.date)}  ${lib(o).padEnd(larg)}  ${euros(o[champ]).padStart(13)}`);
    out.push('-'.repeat(12 + larg + 15));
    out.push(`${''.padEnd(12)}${'Total'.padStart(larg)}  ${euros(total).padStart(13)}`);
  }
  return out.join('\n');
}

function mailHtml(d, { avant, apres, signature = '' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="${POLICE}">
<div style="${POLICE}">
${texteEnHtml(avant)}
${tableauxHtml(d)}
<p style="margin:18px 0 0 0"></p>
${texteEnHtml(apres)}
${signature ? texteEnHtml(signature) : ''}
</div>
</body></html>`;
}

function mailTexte(d, { avant, apres, signature = '' }) {
  return [String(avant).trim(), tableauxTexte(d), '', String(apres).trim(), signature ? `\n${signature}` : '']
    .join('\n')
    .trim();
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

/** Brouillon .eml (HTML + texte) marqué « non envoyé » : Outlook l'ouvre comme un nouveau message, Excel joints. */
async function emlBuffer(d, { destinataire = '', expediteur = '', signature = '', avant = null, apres = null } = {}) {
  const textes = { avant: avant || texteAvant(d), apres: apres || texteApres(d), signature };
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
    text: mailTexte(d, textes),
    html: mailHtml(d, textes),
    headers: { 'X-Unsent': '1' },
    attachments,
  });
  return mail.compile().build();
}

module.exports = {
  TYPES, operationsDe, objetMail, nomExcel, texteAvant, texteApres, tableauxHtml, tableauxTexte,
  mailHtml, mailTexte, excelBuffer, emlBuffer,
};

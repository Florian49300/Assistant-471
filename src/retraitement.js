'use strict';
/**
 * Retraitement des lignes 4716 / 4717 :
 *  - on écarte les lignes lettrées (déjà rapprochées),
 *  - débit du 471 = DÉPENSE (argent sorti de la banque), crédit = RECETTE (argent reçu).
 * Les montants sont manipulés en centimes (entiers) pour éviter les erreurs d'arrondi.
 */

/** "1234.5" -> 123450 */
function enCentimes(v) {
  const s = String(v ?? '0').trim().replace(',', '.');
  const neg = s.startsWith('-');
  const [ent, dec = ''] = s.replace(/^[-+]/, '').split('.');
  const c = Number(ent || 0) * 100 + Number((dec + '00').slice(0, 2));
  return neg ? -c : c;
}

function estLettree(ligne) {
  const ids = (ligne.lettered_ledger_entry_lines && ligne.lettered_ledger_entry_lines.ids) || [];
  return ids.some((id) => id !== ligne.id);
}

function retraiter(lignes, comptes = {}, seuilEuros = 0) {
  const seuil = Math.round(Number(seuilEuros || 0) * 100);
  const ops = [];
  for (const l of lignes) {
    if (estLettree(l)) continue;
    const net = enCentimes(l.debit) - enCentimes(l.credit);
    if (net === 0 || Math.abs(net) < seuil) continue;
    const acc = l.ledger_account || {};
    ops.push({
      id: l.id,
      date: String(l.date).slice(0, 10),
      libelle: String(l.label || '').replace(/\s+/g, ' ').trim(),
      compte: acc.number || comptes[acc.id] || '',
      depense: net > 0 ? net : 0, // centimes
      recette: net < 0 ? -net : 0, // centimes
    });
  }
  return ops.sort((a, b) => a.date.localeCompare(b.date) || a.libelle.localeCompare(b.libelle));
}

const totaux = (ops) => ({
  depenses: ops.reduce((s, o) => s + o.depense, 0),
  recettes: ops.reduce((s, o) => s + o.recette, 0),
});

/** 123450 -> "1 234,50 €" */
function euros(centimes) {
  const neg = centimes < 0;
  const a = Math.abs(centimes);
  const ent = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '-' : ''}${ent},${String(a % 100).padStart(2, '0')} €`;
}

/** "2026-09-03" -> "03/09/2026" */
const dateFr = (iso) => iso.slice(0, 10).split('-').reverse().join('/');

const nomFichier = (txt) =>
  String(txt).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'dossier';

module.exports = { enCentimes, estLettree, retraiter, totaux, euros, dateFr, nomFichier };

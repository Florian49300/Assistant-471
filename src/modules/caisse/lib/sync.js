'use strict';
// Préparation (contrôles Pennylane) et envoi des pièces. Ne dépend pas du format d'entrée.
const crypto = require('crypto');
const { montant, ErreurPennylane } = require('./pennylane');

// ---------- Référentiel (journaux + comptes), en mémoire, rattaché à une empreinte de la clé ----------
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();
const empreinte = (cle, societeId) => crypto.createHash('sha256').update(`${societeId}|${cle}`).digest('hex');

async function referentiel(api, cle, societe, { forcer = false } = {}) {
  const k = empreinte(cle, societe.id);
  const c = cache.get(k);
  if (c && !forcer && Date.now() - c.t < CACHE_MS) return c.ref;
  const [journaux, comptes] = await Promise.all([api.journaux(), api.comptes()]);
  const ref = { journaux, comptes };
  cache.set(k, { t: Date.now(), ref });
  for (const [kk, v] of cache) if (Date.now() - v.t > CACHE_MS) cache.delete(kk);
  return ref;
}

// ---------- Correspondance des comptes ----------
// Taux d'un compte Pennylane (champ vat_rate, format non documenté précisément) -> "10", "5.5", "20", "0" ou null (any)
function tauxCompte(vat) {
  if (vat === null || vat === undefined) return null;
  const s = String(vat).trim().toLowerCase();
  if (!s || s === 'any' || s === 'mixed') return null;
  if (/exempt|exon|^none$|^zero$/.test(s)) return '0';
  let m = s.match(/^[a-z]{2}_(\d+)$/);                 // "FR_100" -> 10 ; "FR_55" -> 5.5 ; "FR_200" -> 20
  if (m) return String(parseInt(m[1], 10) / 10);
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*%?$/);              // "10", "5.5", "0.1"
  if (m) {
    const v = parseFloat(m[1].replace(',', '.'));
    return String(v > 0 && v < 1 ? Math.round(v * 1000) / 10 : v);
  }
  return s;                                             // valeur inconnue : gardée telle quelle (n'égalera aucun taux)
}

// Plusieurs comptes Pennylane pour un même numéro (un par taux de TVA) : on départage
// 1) comptes actifs ; 2) taux du compte = taux de la ligne ; 3) sinon compte « tous taux » (any)
function departager(candidats, taux) {
  let c = candidats.filter(x => x.enabled !== false);
  if (c.length === 1) return c[0];
  if (!c.length) c = candidats;
  if (taux !== undefined && taux !== null) {
    const memeTaux = c.filter(x => tauxCompte(x.vat_rate) === String(taux));
    if (memeTaux.length === 1) return memeTaux[0];
    if (memeTaux.length > 1) return jumeaux(memeTaux);
  }
  const tousTaux = c.filter(x => tauxCompte(x.vat_rate) === null);
  if (tousTaux.length === 1) return tousTaux[0];
  if (tousTaux.length > 1 && taux !== undefined && taux !== null) return jumeaux(tousTaux);   // lignes sans taux : pas de choix automatique
  return null;
}

// Doublons parfaits (même numéro, même taux) sur une ligne de vente ou de TVA : comptes équivalents, on garde le plus ancien (plus petit id).
// S'ils diffèrent par le numéro, on ne choisit pas : la pièce sera bloquée avec la liste des candidats.
function jumeaux(cs) {
  const numeros = new Set(cs.map(x => String(x.number)));
  const taux = new Set(cs.map(x => tauxCompte(x.vat_rate)));
  if (numeros.size !== 1 || taux.size !== 1) return null;
  const id = x => String(x.id).padStart(25, '0');          // ids pouvant dépasser la précision des nombres JS
  return cs.slice().sort((a, b) => (id(a) < id(b) ? -1 : 1))[0];
}
const decrire = cs => cs.map(c => `id ${c.id} : ${c.number}${c.label ? ' ' + c.label : ''}, TVA ${c.vat_rate ?? '?'}${c.enabled === false ? ', désactivé' : ''}`).join(' ; ');

// 1) table forcée de la société ; 2) numéro exact ; 3) numéro sans les zéros de fin.
// En cas de doublons, choix automatique selon le taux de TVA de la ligne (voir departager).
function resoudreCompte(numero, comptes, forces = {}, taux) {
  const f = forces[taux !== undefined && taux !== null ? `${numero}@${taux}` : ''] ?? forces[numero];
  if (f && typeof f === 'object' && f.id) {
    const c = comptes.find(c => String(c.id) === String(f.id));
    return c ? { compte: c } : { erreur: `compte forcé id ${f.id} introuvable` };
  }
  const cible = typeof f === 'string' ? f : numero;
  const aide = `préciser l'id à utiliser dans "comptesForces" (ex. "${cible}${taux != null ? '@' + taux : ''}": { "id": … })`;
  const exacts = comptes.filter(c => String(c.number) === cible);
  if (exacts.length === 1) return { compte: exacts[0] };
  if (exacts.length > 1) {
    const choisi = departager(exacts, taux);
    return choisi ? { compte: choisi }
      : { erreur: `plusieurs comptes ${cible} dans Pennylane pour le taux ${taux ?? '?'} % (${decrire(exacts)}) : ${aide}` };
  }
  const court = cible.replace(/0+$/, '');
  const proches = court.length >= 3 ? comptes.filter(c => String(c.number).replace(/0+$/, '') === court) : [];
  if (proches.length === 1) return { compte: proches[0] };
  if (proches.length > 1) {
    const choisi = departager(proches, taux);
    return choisi ? { compte: choisi }
      : { erreur: `plusieurs comptes possibles pour ${cible} (${decrire(proches)}) : ${aide}` };
  }
  return { erreur: `compte ${cible} absent de Pennylane` };
}

// ---------- Contrôles avec Pennylane ----------
async function preparer(pieces, societe, ref, api) {
  const alertesGlobales = [];
  const journal = ref.journaux.find(j => String(j.code).toUpperCase() === String(societe.journal).toUpperCase());

  // Écritures déjà présentes dans le journal sur la période (doublons)
  let existantes = [];
  const dates = pieces.map(p => p.date).filter(Boolean).sort();
  if (journal && dates.length) {
    const du = dates[0].slice(0, 8) + '01';                 // début du premier mois (écritures mensuelles)
    const au = dates[dates.length - 1];
    const fin = new Date(Date.UTC(+au.slice(0, 4), +au.slice(5, 7), 0)).toISOString().slice(0, 10);
    existantes = await api.ecrituresJournal(journal.id, du, fin);
    if (existantes.length && !existantes.some(e => 'piece_number' in e || 'label' in e))
      alertesGlobales.push('Contrôle des doublons incomplet : Pennylane ne renvoie ni numéro de pièce ni libellé. Vérifiez le journal avant d\'envoyer.');
  }
  const parPiece = new Map(existantes.filter(e => e.piece_number).map(e => [String(e.piece_number), e]));
  const parLibelle = new Map(existantes.filter(e => e.label).map(e => [String(e.label).trim().toUpperCase(), e]));

  for (const p of pieces) {
    if (p.statut === 'bloquée') continue;                  // déjà bloquée par les contrôles hors ligne
    const raisons = [];
    if (!journal) raisons.push(`journal "${societe.journal}" introuvable dans Pennylane`);
    p.lignesPennylane = [];
    for (const l of p.lignes) {
      const r = resoudreCompte(l.compte, ref.comptes, societe.comptesForces, l.taux);
      if (r.erreur) { if (!raisons.includes(r.erreur)) raisons.push(r.erreur); continue; }
      p.lignesPennylane.push({ ...l, ledger_account_id: r.compte.id, numeroPennylane: r.compte.number });
    }
    for (const lib of p.libellesEnConflit || []) {
      if (parLibelle.has(lib.toUpperCase())) raisons.push(`une écriture « ${lib} » existe déjà dans le journal (double emploi)`);
    }
    const dejaLa = parPiece.get(p.piece) || parLibelle.get(String(p.libelle).toUpperCase());
    if (dejaLa) { p.statut = 'déjà envoyée'; p.raisons = [`déjà dans Pennylane (écriture ${dejaLa.id ?? ''} du ${dejaLa.date ?? '?'})`]; continue; }
    if (raisons.length) { p.statut = 'bloquée'; p.raisons = raisons; continue; }
    p.journalId = journal.id;
    p.statut = 'prête';
  }
  return { journal: journal ? { id: journal.id, code: journal.code, label: journal.label } : null, alertesGlobales };
}

function corpsEcriture(p) {
  return {
    date: p.date,
    label: p.libelle,
    journal_id: p.journalId,
    piece_number: p.piece,
    ledger_entry_lines: p.lignesPennylane.map(l => ({
      debit: montant(l.debit), credit: montant(l.credit), ledger_account_id: l.ledger_account_id, label: l.libelleCompte,
    })),
  };
}

// Envoi séquentiel. Une 401 arrête tout ; une 422 laisse la pièce à renvoyer.
async function envoyer(pieces, api) {
  const resultats = [];
  let arret = null;
  for (const p of pieces) {
    if (arret) { resultats.push({ cle: p.cle, piece: p.piece, ok: false, message: `non envoyée : ${arret}` }); continue; }
    try {
      const r = await api.creerEcriture(corpsEcriture(p));
      resultats.push({ cle: p.cle, piece: p.piece, ok: true, id: r?.id ?? null, message: 'créée' });
    } catch (e) {
      const msg = e instanceof ErreurPennylane ? e.message : 'erreur inattendue';
      resultats.push({ cle: p.cle, piece: p.piece, ok: false, message: msg, details: e.details || null });
      if (e.statut === 401 || e.statut === 403) arret = msg;
    }
  }
  return resultats;
}

module.exports = { referentiel, resoudreCompte, tauxCompte, departager, preparer, corpsEcriture, envoyer, empreinte };

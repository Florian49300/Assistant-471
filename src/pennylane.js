'use strict';
/**
 * Accès à l'API Pennylane avec un jeton cabinet (Firm token).
 * - Liste des dossiers : Firm API v1  GET /api/external/firm/v1/companies
 * - Données d'un dossier : Company API v2 + en-tête X-Company-Id
 */
const { retraiter, estLettree } = require('./retraitement');

const BASE = 'https://app.pennylane.com/api/external';
const COMPTES = ['4716', '4717'];

class PennylaneError extends Error {}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

class Pennylane {
  constructor(token) {
    this.token = token;
  }

  async get(url, params = {}, companyId = null) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    if (companyId) headers['X-Company-Id'] = String(companyId);

    for (let essai = 0; essai < 5; essai++) {
      const r = await fetch(u, { headers, signal: AbortSignal.timeout(60_000) });
      if (r.status === 429) {
        await pause(1000 * Number(r.headers.get('retry-after') || 2 + essai * 2));
        continue;
      }
      if (r.status === 401) throw new PennylaneError('Jeton Pennylane refusé (expiré ou invalide).');
      if (r.status === 403) throw new PennylaneError('Accès refusé par Pennylane : vérifiez les permissions du jeton.');
      if (r.status === 404) throw new PennylaneError('Dossier introuvable ou non géré par le cabinet.');
      if (!r.ok) throw new PennylaneError(`Erreur Pennylane ${r.status} : ${(await r.text()).slice(0, 200)}`);
      return r.json();
    }
    throw new PennylaneError('Pennylane limite les requêtes : réessayez dans une minute.');
  }

  async toutesLesPages(chemin, params, companyId) {
    const items = [];
    let cursor = null;
    for (;;) {
      const data = await this.get(`${BASE}/v2/${chemin}`, { ...params, cursor }, companyId);
      items.push(...(data.items || []));
      cursor = data.next_cursor;
      if (!data.has_more || !cursor) return items;
    }
  }

  /** Dossiers gérés par le cabinet : [{ id, nom, code }] triés par nom. */
  async dossiers() {
    const out = [];
    for (let page = 1; ; page++) {
      const data = await this.get(`${BASE}/firm/v1/companies`, { page, per_page: 100 });
      const items = Array.isArray(data) ? data : data.items || data.companies || [];
      for (const c of items) {
        out.push({
          id: String(c.id),
          nom: c.name || c.company_name || `Dossier ${c.id}`,
          code: c.client_code || c.external_id || '',
        });
      }
      const totalPages = Array.isArray(data) ? null : data.total_pages;
      if (!items.length || (totalPages && page >= totalPages) || items.length < 100) break;
    }
    return out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  /** { ledger_account_id: numéro } pour les comptes 4716* et 4717*. */
  async comptesAttente(companyId) {
    const res = {};
    for (const prefixe of COMPTES) {
      const filter = JSON.stringify([{ field: 'number', operator: 'start_with', value: prefixe }]);
      for (const a of await this.toutesLesPages('ledger_accounts', { filter, limit: 1000 }, companyId)) {
        res[a.id] = a.number;
      }
    }
    return res;
  }

  async lignes(companyId, compteIds, depuis, jusqu) {
    if (!compteIds.length) return [];
    const filtres = [{ field: 'ledger_account_id', operator: 'in', value: compteIds.join(',') }];
    if (depuis) filtres.push({ field: 'date', operator: 'gteq', value: depuis });
    if (jusqu) filtres.push({ field: 'date', operator: 'lteq', value: jusqu });
    return this.toutesLesPages(
      'ledger_entry_lines',
      { filter: JSON.stringify(filtres), limit: 100, sort: 'date' },
      companyId,
    );
  }

  /**
   * Les lignes 471 n'ont souvent pas de libellé dans Pennylane.
   * On complète, dans l'ordre :
   *   1. avec le libellé de l'écriture (ledger_entries.label),
   *   2. sinon avec le libellé d'une autre ligne de la même écriture (ex. la ligne banque 512).
   */
  async completerLibelles(companyId, lignes) {
    const vide = (l) => !String(l.label || '').trim();
    const aCompleter = lignes.filter((l) => vide(l) && l.ledger_entry && l.ledger_entry.id);
    if (!aCompleter.length) return lignes;

    // 1. Libellé de l'écriture (100 écritures par appel)
    const ids = [...new Set(aCompleter.map((l) => l.ledger_entry.id))];
    const libEcriture = {};
    for (let i = 0; i < ids.length; i += 100) {
      const filter = JSON.stringify([{ field: 'id', operator: 'in', value: ids.slice(i, i + 100).join(',') }]);
      for (const e of await this.toutesLesPages('ledger_entries', { filter, limit: 100 }, companyId)) {
        if (String(e.label || '').trim()) libEcriture[e.id] = e.label;
      }
    }
    for (const l of aCompleter) if (libEcriture[l.ledger_entry.id]) l.label = libEcriture[l.ledger_entry.id];

    // 2. Libellé d'une autre ligne de la même écriture
    const restantes = aCompleter.filter(vide);
    const libLignes = {};
    for (const id of [...new Set(restantes.map((l) => l.ledger_entry.id))].slice(0, 300)) {
      try {
        const autres = await this.toutesLesPages(`ledger_entries/${id}/ledger_entry_lines`, { limit: 100 }, companyId);
        const trouvee = autres.find((x) => String(x.label || '').trim());
        if (trouvee) libLignes[id] = trouvee.label;
      } catch (e) {
        if (!(e instanceof PennylaneError)) throw e; // on garde un libellé vide plutôt que de bloquer
      }
    }
    for (const l of restantes) if (libLignes[l.ledger_entry.id]) l.label = libLignes[l.ledger_entry.id];
    return lignes;
  }

  async extraire(companyId, nom, { depuis, jusqu, seuil = 0 } = {}) {
    const comptes = await this.comptesAttente(companyId);
    const lignes = await this.lignes(companyId, Object.keys(comptes), depuis, jusqu);
    // on ne cherche les libellés que pour les lignes non lettrées (celles qui seront affichées)
    await this.completerLibelles(companyId, lignes.filter((l) => !estLettree(l)));
    return { companyId, nom, operations: retraiter(lignes, comptes, seuil) };
  }
}

/** Données fictives : aucun appel à Pennylane. */
class Demo {
  async dossiers() {
    return [
      { id: '12345', nom: 'SARL Exemple Boulangerie', code: 'BOUL01' },
      { id: '23456', nom: 'SAS Exemple Transports', code: 'TRAN02' },
      { id: '67890', nom: 'SCI Exemple', code: 'SCI03' },
    ];
  }

  async extraire(companyId, nom, { depuis, jusqu, seuil = 0 } = {}) {
    const l = (id, date, label, debit, credit, number, lettre) => ({
      id, date, label, debit, credit,
      ledger_account: { id: 1, number },
      lettered_ledger_entry_lines: { ids: lettre || [id] },
    });
    const jeux = {
      12345: [
        l(1, '2026-09-03', 'CB AMAZON MKTP FR 02/09', '84.90', '0.00', '47160000'),
        l(2, '2026-09-12', 'PRLV SEPA ORANGE SA', '59.99', '0.00', '47160001'),
        l(3, '2026-09-15', 'VIR SEPA RECU M DUPONT FACT', '0.00', '1200.00', '47170000'),
        l(4, '2026-10-01', 'CB LEROY MERLIN 30/09', '312.45', '0.00', '47160000', [4, 99]), // lettrée
        l(5, '2026-10-08', 'RETRAIT DAB 07/10', '200.00', '0.00', '47160001'),
        l(6, '2026-10-20', 'REMISE CHEQUE 4521', '0.00', '450.00', '47170001'),
        l(7, '2026-10-22', 'AVOIR FOURNISSEUR BOULANGER', '0.00', '35.00', '47160000'), // crédit sur un 4716 = recette
      ],
      23456: [
        l(10, '2026-08-28', 'CB TOTALENERGIES 27/08', '95.20', '0.00', '4716'),
        l(11, '2026-10-02', 'VIR SEPA RECU LOGISTIQUE OUEST', '0.00', '3480.00', '4717'),
      ],
    };
    const lignes = (jeux[companyId] || []).filter(
      (x) => (!depuis || x.date >= depuis) && (!jusqu || x.date <= jusqu),
    );
    return { companyId, nom, operations: retraiter(lignes, {}, seuil) };
  }
}

module.exports = { Pennylane, Demo, PennylaneError };

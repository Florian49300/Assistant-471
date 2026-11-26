'use strict';
// Client minimal de l'API Pennylane v2 (entreprise). Tous les appels passent par ici.
// Doc : https://pennylane.readme.io/  — base https://app.pennylane.com/api/external/v2
// La clé n'est jamais journalisée ni renvoyée dans un message d'erreur.

const BASE = process.env.PENNYLANE_BASE_URL || 'https://app.pennylane.com/api/external/v2';
const MAX_ESSAIS_429 = 6;

class ErreurPennylane extends Error {
  constructor(statut, message, details) {
    super(message);
    this.statut = statut;
    this.details = details;
  }
}

const pause = ms => new Promise(r => setTimeout(r, ms));

function client(cle, { companyId, fetchImpl = fetch } = {}) {
  if (!cle || typeof cle !== 'string' || cle.length < 10) throw new ErreurPennylane(400, 'Clé API manquante ou invalide');

  async function appel(methode, chemin, { query, corps } = {}) {
    const url = new URL(BASE + chemin);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const entetes = { Authorization: `Bearer ${cle}`, Accept: 'application/json' };
    if (corps) entetes['Content-Type'] = 'application/json';
    if (companyId) entetes['X-Company-Id'] = String(companyId);   // jeton cabinet uniquement

    for (let essai = 0; ; essai++) {
      let rep;
      try {
        rep = await fetchImpl(url, { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined });
      } catch (e) {
        throw new ErreurPennylane(502, `Pennylane injoignable (${e.cause?.code || e.message})`);
      }
      if (rep.status === 429 && essai < MAX_ESSAIS_429) {
        const attente = Math.min(60, Number(rep.headers.get('retry-after')) || 2 ** essai);
        await pause(attente * 1000);
        continue;
      }
      const texte = await rep.text();
      let json = null;
      try { json = texte ? JSON.parse(texte) : null; } catch { /* réponse non JSON */ }
      if (rep.ok) return json;
      if (rep.status === 401) throw new ErreurPennylane(401, 'Clé API refusée par Pennylane');
      if (rep.status === 403) throw new ErreurPennylane(403, 'Droits insuffisants : la clé doit avoir les scopes journals, ledger_accounts et ledger_entries', json);
      if (rep.status === 429) throw new ErreurPennylane(429, 'Trop de requêtes vers Pennylane, réessayez dans une minute');
      const msg = json?.message || json?.error || (Array.isArray(json?.errors) ? json.errors.join(', ') : '') || texte.slice(0, 300);
      throw new ErreurPennylane(rep.status, `Pennylane ${rep.status} : ${msg}`, json);
    }
  }

  // Parcourt toutes les pages (curseur) d'une liste
  async function tout(chemin, query = {}) {
    const items = [];
    let cursor;
    for (let page = 0; page < 500; page++) {
      const r = await appel('GET', chemin, { query: { ...query, limit: 100, cursor } });
      items.push(...(r?.items || []));
      if (!r?.has_more || !r?.next_cursor) break;
      cursor = r.next_cursor;
    }
    return items;
  }

  const filtre = conditions => JSON.stringify(conditions);

  return {
    moi: () => appel('GET', '/me'),
    journaux: () => tout('/journals'),
    comptes: () => tout('/ledger_accounts'),
    ecrituresJournal: (journalId, du, au) => tout('/ledger_entries', {
      filter: filtre([
        { field: 'journal_id', operator: 'eq', value: String(journalId) },
        { field: 'date', operator: 'gteq', value: du },
        { field: 'date', operator: 'lteq', value: au },
      ]),
    }),
    creerEcriture: corps => appel('POST', '/ledger_entries', { corps }),
  };
}

// Montant en centimes -> "123.45"
const montant = c => (c / 100).toFixed(2);

// Nom de la société renvoyé par GET /me (structure non documentée précisément : on tente plusieurs champs)
function nomSociete(me) {
  return me?.company?.name || me?.company_name || me?.name || me?.user?.company?.name || '';
}

module.exports = { client, montant, nomSociete, ErreurPennylane };

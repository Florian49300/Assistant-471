'use strict';
/**
 * Brique Import caisse dans le portail : parcours complet contre un faux Pennylane local.
 * Reprend le test d'origine de pennylane-dg (test/serveur.test.js) en passant par le portail :
 * connexion au portail, CSRF, puis connexion Pennylane, analyse, envoi, doublon, 413, clé absente des journaux.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const CLE = 'cle-de-test-1234567890';
const recus = [];
const ecritures = [];
const comptes = ['411', '5112', '5114', '51141', '5115', '51151', '531', '467', '44571006', '44571008', '44571009', '706110000', '706120000', '706130000']
  .map((number, i) => ({ id: 100 + i, number, label: number }));

const faux = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    recus.push({ methode: req.method, chemin: url.pathname, auth: req.headers.authorization, corps });
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== `Bearer ${CLE}`) return json(401, { error: 'unauthorized' });
    const p = url.pathname.replace('/api/external/v2', '');
    if (p === '/me') return json(200, { user: { first_name: 'Test' }, company: { id: 1, name: 'PIZZERIA TEST' } });
    if (p === '/journals') return json(200, { items: [{ id: 9, code: 'CA', label: 'Caisse' }], has_more: false, next_cursor: null });
    if (p === '/ledger_accounts') {
      const page2 = url.searchParams.get('cursor') === 'p2';
      return json(200, { items: page2 ? comptes.slice(7) : comptes.slice(0, 7), has_more: !page2, next_cursor: page2 ? null : 'p2' });
    }
    if (p === '/ledger_entries' && req.method === 'GET') return json(200, { items: ecritures, has_more: false, next_cursor: null });
    if (p === '/ledger_entries' && req.method === 'POST') {
      const e = JSON.parse(corps);
      const d = e.ledger_entry_lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
      if (Math.abs(d) > 0.001) return json(422, { message: 'unbalanced' });
      const cree = { id: 1000 + ecritures.length, date: e.date, label: e.label, piece_number: e.piece_number, journal_id: e.journal_id };
      ecritures.push(cree);
      return json(201, cree);
    }
    json(404, {});
  });
});

const ENTETE =
  'Début;"";Fin;"";Caisse;Total Brut;"";"";Modes de paiement;"";"";Pourboires;TVA 5,50 (5,50%) (€);"";"";TVA 10.00 (10,00%) (€);"";"";Total réductions;Total Net;"";"";Mouvements;Ecart\n' +
  'Date;Jour;Date;Jour;"";TTC;HT;Taxe;Espèces;Carte de crédit;sumup;Total pourboires;TTC;HT;Taxe;TTC;HT;Taxe;TTC;TTC;HT;Taxe;Montant;Montant\n';
const FICHIER = ENTETE +
  '01/10/2026 12:00;Jeudi;01/10/2026 22:00;Jeudi;iPad;724.200;0;0;20.900;703.300;0;0.000;36.400;0;1.898;687.800;0;62.527;0;724.200;0;0;0.000;0.000\n' +
  '02/10/2026 12:00;Vendredi;02/10/2026 22:00;Vendredi;iPad;100.000;0;0;100.000;0;0;0.000;0;0;0;100.000;0;9.091;0;100.000;0;0;0.000;0.000\n';
const NOM = 'jalia_export_accounting_850_20261001_20261002_abc.csv';

let base, srv, cookie = '', csrf = '';
const journal = [];
const logOrigine = console.log, errOrigine = console.error, warnOrigine = console.warn;

test.before(async () => {
  console.log = (...a) => { journal.push(a.join(' ')); };
  console.error = (...a) => { journal.push(a.join(' ')); };
  console.warn = (...a) => { journal.push(a.join(' ')); };
  await new Promise((r) => faux.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DEMO: '1', APP_PASSWORD: 'mot-de-passe-test',
    PENNYLANE_BASE_URL: `http://127.0.0.1:${faux.address().port}/api/external/v2`,
  });
  for (const k of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'APP_BASE_URL']) delete process.env[k];
  const app = require('../src/server');
  srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { console.log = logOrigine; console.error = errOrigine; console.warn = warnOrigine; srv.close(); faux.close(); });

function garderCookie(r) {
  for (const c of r.headers.getSetCookie()) {
    const [kv] = c.split(';');
    const [k, ...v] = kv.split('=');
    const reste = cookie.split('; ').filter((x) => x && !x.startsWith(k + '='));
    cookie = [...reste, `${k}=${v.join('=')}`].join('; ');
  }
}

const appel = async (chemin, { methode = 'GET', cle, corps, entetes = {}, sansCsrf = false } = {}) => {
  const r = await fetch(base + chemin, {
    method: methode, body: corps, redirect: 'manual',
    headers: { Cookie: cookie, ...(sansCsrf ? {} : { 'X-CSRF': csrf }), ...(cle ? { 'X-Pennylane-Key': cle } : {}), ...entetes },
  });
  garderCookie(r);
  return { statut: r.status, json: await r.json().catch(() => null), entetes: r.headers };
};

test('sans connexion au portail : page redirigée, API refusée', async () => {
  const page = await fetch(base + '/caisse', { redirect: 'manual' });
  assert.strictEqual(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login\?next=%2Fcaisse/);
  assert.strictEqual((await appel('/caisse/api/societes')).statut, 401);
});

test('connexion au portail, page, sociétés, jeton CSRF exigé', async () => {
  const l = await fetch(base + '/login?next=/caisse', {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=mot-de-passe-test',
  });
  garderCookie(l);
  assert.strictEqual(l.headers.get('location'), '/caisse');
  const page = await fetch(base + '/caisse', { headers: { Cookie: cookie } });
  garderCookie(page);
  const html = await page.text();
  csrf = html.match(/CAISSE_CSRF = "([^"]+)"/)[1];
  assert.match(html, /CAISSE_BASE = "\/caisse"/);
  assert.match(html, /id="btn-envoyer"/);
  const s = await appel('/caisse/api/societes');
  assert.ok(s.json.some((x) => x.id === 'bdp'));
  assert.strictEqual((await appel('/caisse/api/connexion?societe=bdp', { methode: 'POST', cle: CLE, sansCsrf: true })).statut, 403);
});

test('connexion Pennylane : clé refusée puis acceptée', async () => {
  const ko = await appel('/caisse/api/connexion?societe=bdp', { methode: 'POST', cle: 'mauvaise-cle-123456' });
  assert.strictEqual(ko.statut, 401);
  const ok = await appel('/caisse/api/connexion?societe=bdp', { methode: 'POST', cle: CLE });
  assert.strictEqual(ok.statut, 200);
  assert.strictEqual(ok.json.societePennylane, 'PIZZERIA TEST');
  assert.strictEqual(ok.json.nbComptes, comptes.length);
  assert.match(ok.json.journal, /^CA/);
});

test('société inconnue refusée', async () => {
  assert.strictEqual((await appel('/caisse/api/analyser?societe=xxx', { methode: 'POST', corps: FICHIER })).statut, 400);
});

const entetesFichier = { 'X-Nom-Fichier': encodeURIComponent(NOM), 'Content-Type': 'application/octet-stream' };

test('analyse hors ligne puis avec Pennylane', async () => {
  const h = await appel('/caisse/api/analyser?societe=bdp', { methode: 'POST', corps: FICHIER, entetes: entetesFichier });
  assert.strictEqual(h.json.mode, 'hors-ligne');
  assert.deepStrictEqual(h.json.pieces.map((p) => p.statut), ['prête', 'prête']);
  const p = await appel('/caisse/api/analyser?societe=bdp', { methode: 'POST', cle: CLE, corps: FICHIER, entetes: entetesFichier });
  assert.strictEqual(p.json.mode, 'pennylane');
  assert.deepStrictEqual(p.json.pieces.map((x) => x.piece), ['Z850-20261001', 'Z850-20261002']);
  assert.ok(p.json.pieces.every((x) => x.statut === 'prête'), JSON.stringify(p.json.pieces.map((x) => x.raisons)));
});

test("envoi d'une seule pièce, puis doublon détecté", async () => {
  const sel = encodeURIComponent(JSON.stringify(['CA|Z850-20261001|2026-10-01']));
  const r = await appel('/caisse/api/envoyer?societe=bdp', { methode: 'POST', cle: CLE, corps: FICHIER, entetes: { ...entetesFichier, 'X-Selection': sel } });
  assert.strictEqual(r.statut, 200);
  assert.deepStrictEqual(r.json.resultats.map((x) => [x.piece, x.ok]), [['Z850-20261001', true]]);
  const post = recus.filter((x) => x.methode === 'POST' && x.chemin.endsWith('/ledger_entries'));
  assert.strictEqual(post.length, 1);
  const corps = JSON.parse(post[0].corps);
  assert.strictEqual(corps.journal_id, 9);
  assert.strictEqual(corps.label, 'CAISSE 01.10.2026');
  assert.ok(corps.ledger_entry_lines.every((l) => /^\d+\.\d{2}$/.test(l.debit) && /^\d+\.\d{2}$/.test(l.credit)));
  const r2 = await appel('/caisse/api/envoyer?societe=bdp', { methode: 'POST', cle: CLE, corps: FICHIER, entetes: { ...entetesFichier, 'X-Selection': sel } });
  assert.strictEqual(r2.json.resultats[0].ok, false);
  assert.match(r2.json.resultats[0].message, /déjà envoyée/);
  assert.strictEqual(recus.filter((x) => x.methode === 'POST' && x.chemin.endsWith('/ledger_entries')).length, 1);
});

test('fichier trop gros refusé', async () => {
  const r = await appel('/caisse/api/analyser?societe=bdp', { methode: 'POST', corps: Buffer.alloc(11 * 1024 * 1024, 65), entetes: entetesFichier })
    .catch(() => ({ statut: 413 }));
  assert.strictEqual(r.statut, 413);
});

test('journal : actions tracées au nom de la personne, jamais la clé', () => {
  const lignes = journal.filter((l) => l.startsWith('{"journal"')).map((l) => JSON.parse(l));
  const envoi = lignes.find((l) => l.journal === 'envoi_pennylane' && l.envoyees === 1);
  assert.ok(envoi, 'envoi tracé');
  assert.strictEqual(envoi.utilisateur, 'Accès commun');
  assert.strictEqual(envoi.societe, 'bdp');
  assert.deepStrictEqual(envoi.pieces, ['Z850-20261001']);
  assert.ok(lignes.some((l) => l.journal === 'connexion_pennylane' && l.dossier_pennylane === 'PIZZERIA TEST'));
  assert.ok(lignes.some((l) => l.journal === 'analyse' && l.mode === 'pennylane' && l.pretes === 2));
  assert.ok(!journal.some((l) => l.includes(CLE)), 'la clé ne doit jamais apparaître');
  assert.ok(!journal.some((l) => l.includes('724.200')), 'le contenu du fichier ne doit pas apparaître');
});

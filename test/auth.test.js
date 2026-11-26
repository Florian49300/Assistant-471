'use strict';
/**
 * Parcours complet de la connexion Microsoft avec un faux serveur d'identité local
 * (simule login.microsoftonline.com : point de terminaison de jeton + PKCE).
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// --- faux Microsoft -------------------------------------------------------
const codes = new Map(); // code -> { challenge, claims }
let idp;
let HOTE;
function demarrerIdp() {
  idp = http.createServer((req, res) => {
    let corps = '';
    req.on('data', (c) => (corps += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === `/${TENANT}/oauth2/v2.0/token`) {
        const p = new URLSearchParams(corps);
        const entree = codes.get(p.get('code'));
        const pkceOk = entree && crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === entree.challenge;
        if (!entree || !pkceOk || p.get('client_secret') !== 'secret-test' || p.get('client_id') !== CLIENT) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid_grant' }));
        }
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id_token: `${b64({ alg: 'RS256' })}.${b64(entree.claims)}.sig` }));
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((r) => idp.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${idp.address().port}`)));
}

// --- application -----------------------------------------------------------
let srv;
let BASE;
test.before(async () => {
  HOTE = await demarrerIdp();
  Object.assign(process.env, {
    DEMO: '1', AZURE_AUTHORITY_HOST: HOTE, AZURE_TENANT_ID: TENANT, AZURE_CLIENT_ID: CLIENT,
    AZURE_CLIENT_SECRET: 'secret-test', APP_BASE_URL: 'http://localhost', ALLOWED_DOMAINS: 'cabinet-dg.fr',
    APP_PASSWORD: 'ancien-mot-de-passe',
  });
  const app = require('../src/server');
  srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  BASE = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv.close(); idp.close(); });

/** Petit navigateur : garde les cookies, ne suit pas les redirections. */
function navigateur() {
  const jar = {};
  const f = async (chemin, opts = {}) => {
    const r = await fetch(chemin.startsWith('http') ? chemin : BASE + chemin, {
      redirect: 'manual', ...opts,
      headers: { ...(opts.headers || {}), Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      jar[k.trim()] = v.join('=');
    }
    return r;
  };
  return f;
}

/** Va jusqu'à Microsoft, puis « revient » avec un code portant les claims voulues. */
async function connexion(nav, claimsFn, { next = '/', alterState = false } = {}) {
  const r1 = await nav(`/auth/microsoft?next=${encodeURIComponent(next)}`);
  assert.equal(r1.status, 302);
  const u = new URL(r1.headers.get('location'));
  assert.equal(u.origin + u.pathname, `${HOTE}/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(u.searchParams.get('client_id'), CLIENT);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost/auth/callback');
  const code = crypto.randomBytes(8).toString('hex');
  const nonce = u.searchParams.get('nonce');
  codes.set(code, { challenge: u.searchParams.get('code_challenge'), claims: claimsFn(nonce) });
  const state = alterState ? 'falsifie' : u.searchParams.get('state');
  return nav(`/auth/callback?code=${code}&state=${encodeURIComponent(state)}`);
}

const claims = (extra = {}) => (nonce) => ({
  iss: `${HOTE}/${TENANT}/v2.0`, aud: CLIENT, tid: TENANT, nonce, exp: Math.floor(Date.now() / 1000) + 3600,
  name: 'Florian Test', preferred_username: 'Florian@Cabinet-DG.fr', oid: 'oid-1', ...extra,
});

test('page de connexion : bouton Microsoft, pas de mot de passe', async () => {
  const t = await (await navigateur()('/login')).text();
  assert.match(t, /Se connecter avec Microsoft/);
  assert.doesNotMatch(t, /type="password"/);
});

test('connexion réussie : nom affiché, accès aux dossiers, retour à la page demandée', async () => {
  const nav = navigateur();
  const r = await connexion(nav, claims(), { next: '/dossier/12345' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/dossier/12345');
  const page = await nav('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Florian Test/);
  assert.match(html, /data-prenom="Florian"/);
  assert.match(html, /href="\/471"/); // tuile Assistant 471
  const p471 = await (await nav('/471')).text();
  assert.match(p471, /SARL Exemple Boulangerie/);
  assert.match(p471, /href="\/471\/dossier\/12345"/);
  const out = await nav('/logout');
  assert.equal(out.status, 302);
  assert.equal((await nav('/')).status, 302); // déconnecté
});

test('refus : adresse hors du cabinet', async () => {
  const r = await connexion(navigateur(), claims({ preferred_username: 'pirate@gmail.com' }));
  assert.equal(r.status, 403);
  assert.match(await r.text(), /pas une adresse autorisée/);
});

test('refus : autre locataire Microsoft', async () => {
  const r = await connexion(navigateur(), claims({ tid: '99999999-9999-9999-9999-999999999999' }));
  assert.equal(r.status, 403);
});

test('refus : nonce incorrect', async () => {
  const r = await connexion(navigateur(), () => claims()('mauvais-nonce'));
  assert.equal(r.status, 403);
  assert.match(await r.text(), /contrôle de sécurité/);
});

test('refus : state falsifié', async () => {
  const nav = navigateur();
  const r = await connexion(nav, claims(), { alterState: true });
  assert.equal(r.status, 403);
  assert.equal((await nav('/')).status, 302);
});

test('refus Microsoft : utilisateur non autorisé (AADSTS50105)', async () => {
  const r = await navigateur()('/auth/callback?error=access_denied&error_description=AADSTS50105%3A+not+assigned');
  assert.equal(r.status, 403);
  assert.match(await r.text(), /pas autorisé à utiliser l&#39;Assistant 471|pas autorisé à utiliser l'Assistant 471/);
});

test('le mot de passe commun est désactivé quand Microsoft est configuré', async () => {
  const r = await navigateur()('/login', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=ancien-mot-de-passe',
  });
  assert.equal(r.status, 401);
});

test('pas de redirection ouverte vers un autre site', async () => {
  const r = await connexion(navigateur(), claims(), { next: '//site-pirate.com' });
  assert.equal(r.headers.get('location'), '/');
});

test('portail : outil TVS, journal, ancienne adresse redirigée, logos servis', async () => {
  const nav = navigateur();
  await connexion(nav, claims());
  const tvs = await nav('/tvs');
  assert.equal(tvs.status, 200);
  assert.match(await tvs.text(), /TVS 2026 · Vérification du calcul/);
  assert.equal((await nav('/static/tvs/calcul.js')).status, 200);
  const page = await (await nav('/')).text();
  const csrf = (await (await nav('/tvs')).text()).match(/TVS_CSRF = "([^"]+)"/)[1];
  const j = await nav('/tvs/journal', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, action: 'export_csv', client: 'Test', vehicules: '2' }).toString() });
  assert.equal(j.status, 200);
  const jko = await nav('/tvs/journal', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: 'faux', action: 'export_csv' }).toString() });
  assert.equal(jko.status, 400);
  assert.match(page, /href="\/tvs"/);
  const ancien = await nav('/dossier/12345?depuis=2026-01-01');
  assert.equal(ancien.status, 301);
  assert.equal(ancien.headers.get('location'), '/471/dossier/12345?depuis=2026-01-01');
  const logo = await nav('/static/img/logo-dg.jpg');
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/jpeg');
  assert.equal((await navigateur()('/471')).status, 302); // non connecté -> connexion
});

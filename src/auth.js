'use strict';
/**
 * Connexion avec les comptes Microsoft 365 du cabinet (Microsoft Entra ID).
 * Protocole OpenID Connect, « code d'autorisation » + PKCE, sans bibliothèque externe.
 *
 * Variables d'environnement :
 *   AZURE_TENANT_ID      ID de l'annuaire (locataire) Microsoft du cabinet
 *   AZURE_CLIENT_ID      ID de l'application enregistrée dans Entra
 *   AZURE_CLIENT_SECRET  secret client de cette application
 *   APP_BASE_URL         adresse publique du site, ex. https://assistant-471.onrender.com
 *   ALLOWED_DOMAINS      domaines e-mail autorisés, séparés par des virgules (défaut : cabinet-dg.fr)
 *
 * Le jeton d'identité est reçu directement du point de terminaison de jeton de Microsoft
 * (canal serveur à serveur en HTTPS, authentifié par le secret client). Conformément à
 * OpenID Connect (§3.1.3.7), sa signature n'a donc pas à être revérifiée. On contrôle
 * néanmoins l'émetteur, l'audience, le locataire, le nonce et l'expiration.
 */
const crypto = require('node:crypto');

const HOTE = (process.env.AZURE_AUTHORITY_HOST || 'https://login.microsoftonline.com').replace(/\/$/, '');

class AuthError extends Error {}

function config() {
  const c = {
    tenant: process.env.AZURE_TENANT_ID || '',
    clientId: process.env.AZURE_CLIENT_ID || '',
    secret: process.env.AZURE_CLIENT_SECRET || '',
    baseUrl: (process.env.APP_BASE_URL || '').replace(/\/$/, ''),
    domaines: (process.env.ALLOWED_DOMAINS || 'cabinet-dg.fr')
      .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
  };
  c.actif = Boolean(c.tenant && c.clientId && c.secret && c.baseUrl);
  c.redirectUri = `${c.baseUrl}/auth/callback`;
  return c;
}

const aleatoire = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('base64url');

/** Prépare la redirection vers Microsoft. `etat` est à conserver en session. */
function urlConnexion(suite = '/') {
  const c = config();
  const etat = { state: aleatoire(), nonce: aleatoire(), verifier: aleatoire(), suite, t: Date.now() };
  const u = new URL(`${HOTE}/${encodeURIComponent(c.tenant)}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: c.redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state: etat.state,
    nonce: etat.nonce,
    code_challenge: sha256(etat.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url: u.toString(), etat };
}

function decoderJwt(jwt) {
  const parties = String(jwt || '').split('.');
  if (parties.length !== 3) throw new AuthError('Jeton Microsoft illisible.');
  return JSON.parse(Buffer.from(parties[1], 'base64url').toString('utf8'));
}

/** Messages clairs pour les erreurs Microsoft les plus courantes. */
function messageErreurMicrosoft(code, description = '') {
  if (/AADSTS50105/.test(description)) {
    return "Votre compte Microsoft n'est pas autorisé à utiliser l'Assistant 471. Demandez à l'administrateur de vous ajouter.";
  }
  if (code === 'access_denied') return 'Connexion annulée.';
  if (code === 'consent_required' || /AADSTS65001/.test(description)) {
    return "L'application n'a pas encore été approuvée par l'administrateur Microsoft 365 du cabinet.";
  }
  return `Connexion Microsoft refusée (${code}).`;
}

/**
 * Traite le retour de Microsoft : vérifie state, échange le code, contrôle le jeton.
 * Retourne { nom, email, oid }.
 */
async function traiterRetour(query, etat) {
  const c = config();
  if (query.error) throw new AuthError(messageErreurMicrosoft(String(query.error), String(query.error_description || '')));
  if (!etat || !etat.state || Date.now() - etat.t > 10 * 60 * 1000) {
    throw new AuthError('La demande de connexion a expiré, recommencez.');
  }
  if (!query.state || String(query.state) !== etat.state) throw new AuthError('Demande de connexion invalide, recommencez.');
  if (!query.code) throw new AuthError('Réponse Microsoft incomplète.');

  const r = await fetch(`${HOTE}/${encodeURIComponent(c.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.secret,
      grant_type: 'authorization_code',
      code: String(query.code),
      redirect_uri: c.redirectUri,
      code_verifier: etat.verifier,
      scope: 'openid profile email',
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.id_token) {
    const desc = String(data.error_description || '');
    if (/AADSTS7000215|AADSTS7000222/.test(desc)) {
      throw new AuthError('Le secret client Microsoft est invalide ou expiré : à renouveler dans Entra ID.');
    }
    throw new AuthError(`Échec de la connexion Microsoft (${data.error || r.status}).`);
  }

  const j = decoderJwt(data.id_token);
  const maintenant = Math.floor(Date.now() / 1000);
  if (j.iss !== `${HOTE}/${c.tenant}/v2.0`) throw new AuthError('Jeton Microsoft : émetteur inattendu.');
  if (j.aud !== c.clientId) throw new AuthError('Jeton Microsoft : application inattendue.');
  if (j.tid !== c.tenant) throw new AuthError("Ce compte n'appartient pas au cabinet.");
  if (j.nonce !== etat.nonce) throw new AuthError('Jeton Microsoft : contrôle de sécurité échoué, recommencez.');
  if (!j.exp || j.exp < maintenant - 60) throw new AuthError('Jeton Microsoft expiré, recommencez.');

  const email = String(j.preferred_username || j.email || j.upn || '').toLowerCase();
  const domaine = email.split('@')[1] || '';
  if (c.domaines.length && !c.domaines.includes(domaine)) {
    throw new AuthError(`Le compte ${email || 'utilisé'} n'est pas une adresse autorisée (${c.domaines.join(', ')}).`);
  }
  return { nom: j.name || email, email, oid: j.oid || j.sub };
}

module.exports = { config, urlConnexion, traiterRetour, AuthError, decoderJwt };

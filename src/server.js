'use strict';
/**
 * Portail « Assistant comptable DG » - Cabinet Durand Godeau & Associés (Node.js / Express).
 *
 * Le portail fournit le socle commun (connexion Microsoft 365, sessions, sécurité, journal,
 * habillage) et héberge des briques indépendantes déclarées dans src/modules/index.js :
 *   /471  Assistant 471 (comptes d'attente Pennylane)
 *   /tvs  TVS 2026 (à venir)
 *
 * Variables d'environnement communes :
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, APP_BASE_URL, ALLOWED_DOMAINS
 *                       connexion individuelle avec les comptes Microsoft 365 (voir src/auth.js)
 *   APP_PASSWORD        mot de passe commun : utilisé seulement si Microsoft n'est pas configuré
 *   SECRET_KEY          clé de signature des sessions - obligatoire (longue chaîne aléatoire)
 *   PORTAIL_POLE        libellé du pôle affiché sur l'accueil (défaut « Pôle comptable »)
 *   DEMO=1              données fictives, aucun appel externe
 *   PORT                port d'écoute (défaut 8000)
 * Variables propres à chaque brique : voir l'en-tête de son fichier dans src/modules/.
 */
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');

const { PennylaneError } = require('./pennylane');
const auth = require('./auth');
const { euros, dateFr } = require('./retraitement');
const MODULES = require('./modules');

const DEMO = process.env.DEMO === '1';
const SECRET = process.env.SECRET_KEY || crypto.randomBytes(32).toString('hex');
const POLE = process.env.PORTAIL_POLE || 'Pôle comptable';
const MICROSOFT = auth.config().actif;
// Le mot de passe commun ne sert que tant que la connexion Microsoft n'est pas configurée.
const PASSWORD = MICROSOFT ? '' : process.env.APP_PASSWORD || (DEMO ? 'demo' : '');

console.log(MICROSOFT ? 'Connexion : comptes Microsoft 365' : 'Connexion : mot de passe commun (Microsoft non configuré)');
if (!MICROSOFT && !PASSWORD) console.warn('⚠ Ni Microsoft ni APP_PASSWORD configurés : personne ne pourra se connecter');

/** Journal d'activité : visible dans Render > Logs (une ligne JSON par action). */
const journal = (req, action, details = {}) =>
  console.log(JSON.stringify({
    journal: action, date: new Date().toISOString(), utilisateur: req.session?.user?.email || req.session?.user?.nom || null, ...details,
  }));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1); // derrière le proxy HTTPS de l'hébergeur
app.disable('x-powered-by');

// Logos et images (mis en cache par le navigateur une journée)
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d', index: false }));

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieSession({
  name: 'a471',
  keys: [SECRET],
  maxAge: 8 * 3600 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: !DEMO && process.env.NODE_ENV === 'production',
}));

app.use((req, res, next) => {
  res.set({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  if (req.session.user && !req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  Object.assign(res.locals, {
    DEMO, MICROSOFT, POLE, motDePasse: Boolean(PASSWORD), utilisateur: req.session.user || null,
    connecte: Boolean(req.session.user), csrf: req.session.csrf || '', euros, dateFr, flash: null,
    module: null, base: '',
  });
  next();
});

// --------------------------------------------------------------------------
// Outils communs, transmis aux briques
// --------------------------------------------------------------------------
function egal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const connexionRequise = (req, res, next) =>
  req.session.user ? next() : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

const suiteSure = (v) => {
  const s = String(v || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : '/';
};

const verifierCsrf = (req, res, next) =>
  req.session.csrf && egal(req.body?.csrf || '', req.session.csrf)
    ? next()
    : next(new HttpError(400, 'Formulaire expiré, rechargez la page.'));

const telechargement = (res, nom, type, buf) =>
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${nom}"` }).send(buf);

const ctx = { DEMO, connexionRequise, verifierCsrf, journal, HttpError, telechargement };

// --------------------------------------------------------------------------
// Connexion
// --------------------------------------------------------------------------
app.get('/sante', (req, res) => res.json({ ok: true }));

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { suite: suiteSure(req.query.next) });
});

app.get('/auth/microsoft', (req, res) => {
  if (!MICROSOFT) return res.redirect('/login');
  const { url, etat } = auth.urlConnexion(suiteSure(req.query.next));
  req.session = { auth: etat };
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  if (!MICROSOFT) return res.redirect('/login');
  const etat = req.session.auth;
  try {
    const user = await auth.traiterRetour(req.query, etat);
    req.session = { user };
    journal(req, 'connexion', { methode: 'microsoft' });
    res.redirect(suiteSure(etat && etat.suite));
  } catch (e) {
    if (!(e instanceof auth.AuthError)) throw e;
    req.session = null;
    console.warn(JSON.stringify({ journal: 'connexion_refusee', date: new Date().toISOString(), motif: e.message }));
    res.status(403).render('login', { flash: e.message, suite: '/' });
  }
});

// Mot de passe commun (secours, uniquement si Microsoft n'est pas configuré)
app.post('/login', async (req, res) => {
  if (PASSWORD && egal(req.body.password || '', PASSWORD)) {
    req.session = { user: { nom: 'Accès commun', email: '' } };
    journal(req, 'connexion', { methode: 'mot_de_passe' });
    return res.redirect(suiteSure(req.query.next));
  }
  await new Promise((r) => setTimeout(r, 1500)); // ralentit les essais de mot de passe
  res.status(401).render('login', { flash: PASSWORD ? 'Mot de passe incorrect.' : 'Connexion par mot de passe désactivée.', suite: '/' });
});

app.get('/logout', (req, res) => {
  journal(req, 'deconnexion');
  req.session = null;
  res.redirect('/login?deconnecte=1');
});

// --------------------------------------------------------------------------
// Accueil du portail + briques
// --------------------------------------------------------------------------
app.get('/', connexionRequise, (req, res) => res.render('portail', { modules: MODULES }));

for (const m of MODULES) {
  if (m.routeur) {
    app.use(
      m.chemin,
      (req, res, next) => { res.locals.module = m; res.locals.base = req.baseUrl; next(); },
      m.routeur(ctx),
    );
  } else {
    app.get(m.chemin, connexionRequise, (req, res) => {
      res.locals.module = m;
      res.render('bientot', { m });
    });
  }
}

// Anciennes adresses de l'Assistant 471 (avant le portail) : redirection permanente
app.get(/^\/dossier\/.+/, (req, res) => res.redirect(301, `/471${req.originalUrl}`));

// --------------------------------------------------------------------------
// Erreurs
// --------------------------------------------------------------------------
app.use((req, res) => res.status(404).render('erreur', { message: 'Page introuvable.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof PennylaneError ? 502 : err.status || 500;
  if (status >= 500) console.error(err);
  const message = err instanceof PennylaneError || err instanceof HttpError ? err.message : 'Erreur interne du serveur.';
  res.status(status).render('erreur', { message });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 8000;
  app.listen(port, () => console.log(`Portail sur http://localhost:${port}${DEMO && PASSWORD ? ' (démo, mot de passe « demo »)' : ''}`));
}

module.exports = app;

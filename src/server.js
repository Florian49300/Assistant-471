'use strict';
/**
 * Assistant 471 - application web du Cabinet DG (Node.js / Express).
 *
 * Variables d'environnement :
 *   PENNYLANE_TOKEN     jeton API cabinet (lecture seule)   - obligatoire hors démo
 *   APP_PASSWORD        mot de passe d'accès au site        - obligatoire
 *   SECRET_KEY          clé de signature des sessions       - obligatoire (longue chaîne aléatoire)
 *   CABINET_SIGNATURE   signature du mail (\n = retour à la ligne)
 *   CABINET_EXPEDITEUR  adresse « De » du brouillon (facultatif)
 *   SEUIL               montant minimum retenu, en euros (défaut 0)
 *   DEMO=1              données fictives, aucun appel à Pennylane
 *   PORT                port d'écoute (défaut 8000)
 */
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const cookieSession = require('cookie-session');

const { Pennylane, Demo, PennylaneError } = require('./pennylane');
const { totaux, euros, dateFr, nomFichier } = require('./retraitement');
const {
  TYPES, operationsDe, objetMail, nomExcel, texteAvant, texteApres, tableauxHtml, excelBuffer, emlBuffer,
} = require('./documents');

const DEMO = process.env.DEMO === '1';
const SECRET = process.env.SECRET_KEY || crypto.randomBytes(32).toString('hex');
// Vide par défaut : on insère la signature Outlook dans le brouillon (Insertion > Signature)
const SIGNATURE = (process.env.CABINET_SIGNATURE || '').replace(/\\n/g, '\n');
const EXPEDITEUR = process.env.CABINET_EXPEDITEUR || '';
const SEUIL = Number(String(process.env.SEUIL || '0').replace(',', '.')) || 0;
const PASSWORD = process.env.APP_PASSWORD || (DEMO ? 'demo' : '');

if (!DEMO && !process.env.PENNYLANE_TOKEN) console.warn('⚠ PENNYLANE_TOKEN non défini');
if (!PASSWORD) console.warn('⚠ APP_PASSWORD non défini : personne ne pourra se connecter');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1); // derrière le proxy HTTPS de l'hébergeur
app.disable('x-powered-by');

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
  if (req.session.ok && !req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  Object.assign(res.locals, { DEMO, connecte: !!req.session.ok, csrf: req.session.csrf || '', euros, dateFr, flash: null });
  next();
});

// --------------------------------------------------------------------------
// Utilitaires
// --------------------------------------------------------------------------
function client() {
  if (DEMO) return new Demo();
  if (!process.env.PENNYLANE_TOKEN) throw new PennylaneError("PENNYLANE_TOKEN n'est pas configuré sur le serveur.");
  return new Pennylane(process.env.PENNYLANE_TOKEN);
}

const cache = { t: 0, dossiers: [] };
async function listeDossiers(force = false) {
  if (force || !cache.dossiers.length || Date.now() - cache.t > 10 * 60 * 1000) {
    cache.dossiers = await client().dossiers();
    cache.t = Date.now();
  }
  return cache.dossiers;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function dossierParId(id) {
  const d = (await listeDossiers()).find((x) => x.id === id);
  if (!d) throw new HttpError(404, 'Dossier inconnu.');
  return d;
}

function periode(req) {
  const src = { ...req.query, ...(req.body || {}) };
  const ok = (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
  const depuis = String(src.depuis || '');
  const jusqu = String(src.jusqu || '');
  if (!ok(depuis) || !ok(jusqu)) throw new HttpError(400, 'Date invalide.');
  return { depuis: depuis || null, jusqu: jusqu || null };
}

async function extraire(req) {
  const info = await dossierParId(req.params.id);
  return client().extraire(info.id, info.nom, { ...periode(req), seuil: SEUIL });
}

function egal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const connexionRequise = (req, res, next) =>
  req.session.ok ? next() : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);

const verifierCsrf = (req, res, next) =>
  req.session.csrf && egal(req.body?.csrf || '', req.session.csrf)
    ? next()
    : next(new HttpError(400, 'Formulaire expiré, rechargez la page.'));

const telechargement = (res, nom, type, buf) =>
  res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${nom}"` }).send(buf);

// --------------------------------------------------------------------------
// Routes
// --------------------------------------------------------------------------
app.get('/sante', (req, res) => res.json({ ok: true }));

app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
  if (PASSWORD && egal(req.body.password || '', PASSWORD)) {
    req.session = { ok: true };
    const next = String(req.query.next || '');
    return res.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  }
  await new Promise((r) => setTimeout(r, 1500)); // ralentit les essais de mot de passe
  res.status(401).render('login', { flash: 'Mot de passe incorrect.' });
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

app.get('/', connexionRequise, async (req, res) => {
  const dossiers = await listeDossiers(req.query.rafraichir === '1');
  res.render('index', { dossiers });
});

app.get('/dossier/:id', connexionRequise, async (req, res) => {
  const d = await extraire(req);
  const { depuis, jusqu } = periode(req);
  res.render('dossier', {
    d,
    info: await dossierParId(req.params.id),
    t: totaux(d.operations),
    depenses: operationsDe(d, 'depenses'),
    recettes: operationsDe(d, 'recettes'),
    depuis: depuis || '',
    jusqu: jusqu || '',
    objet: objetMail(d),
    avant: texteAvant(d),
    apres: texteApres(d),
    tableaux: d.operations.length ? tableauxHtml(d) : '',
    signature: SIGNATURE,
  });
});

app.post('/dossier/:id/eml', connexionRequise, verifierCsrf, async (req, res) => {
  const d = await extraire(req);
  if (!d.operations.length) throw new HttpError(400, 'Aucune opération à justifier pour ce dossier.');
  const destinataire = String(req.body.destinataire || '').replace(/[\r\n]/g, '').trim();
  const texte = (champ) => String(req.body[champ] || '').replace(/\r\n/g, '\n').trim() || null;
  const buf = await emlBuffer(d, {
    destinataire, expediteur: EXPEDITEUR, signature: SIGNATURE, avant: texte('avant'), apres: texte('apres'),
  });
  const jour = new Date().toISOString().slice(0, 10);
  telechargement(res, `${nomFichier(d.nom)}_mail_${jour}.eml`, 'message/rfc822', buf);
});

app.post('/dossier/:id/excel/:type', connexionRequise, verifierCsrf, async (req, res) => {
  const type = req.params.type;
  if (!TYPES[type]) throw new HttpError(404, 'Fichier inconnu.');
  const d = await extraire(req);
  telechargement(res, nomExcel(d, type), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await excelBuffer(d, type));
});

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
  app.listen(port, () => console.log(`Assistant 471 sur http://localhost:${port}${DEMO ? ' (démo, mot de passe « demo »)' : ''}`));
}

module.exports = app;

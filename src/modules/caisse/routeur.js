'use strict';
/**
 * Brique « Import caisse » (ex-site Pennylane DG) : transforme les fichiers de ventes des clients
 * (caisses, factures) en écritures et les crée dans leur dossier Pennylane (API v2).
 * Montée sous /caisse. Contexte métier complet : docs/Pennylane_DG_contexte.md.
 *
 * Le code métier est repris tel quel de pennylane-dg (importeurs/, lib/, societes/, outils/, test/).
 * Seul l'ancien server.js est remplacé par ce routeur, qui ajoute la connexion Microsoft obligatoire,
 * la protection CSRF et le journal d'activité nominatif du portail.
 *
 * Règles conservées : clé API par société saisie dans la page à chaque usage, jamais stockée ni
 * journalisée ; fichiers traités en mémoire (10 Mo max) ; 200 requêtes / 10 min par IP ;
 * le fichier est ré-analysé au moment de l'envoi et seules les pièces « prêtes » partent.
 */
const crypto = require('node:crypto');
const express = require('express');

const { chargerSocietes } = require('./societes');
const importeurs = require('./importeurs');
const { controler } = require('./lib/controles');
const { client, nomSociete, ErreurPennylane } = require('./lib/pennylane');
const { referentiel, preparer, envoyer } = require('./lib/sync');

const TAILLE_MAX = '10mb';

class ErreurHttp extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}

// ---------- Limite de requêtes par IP (fenêtre glissante, en mémoire) ----------
const LIMITE = { fenetreMs: 10 * 60 * 1000, max: 200 };
const compteurs = new Map();
function limiter(ip) {
  const now = Date.now();
  const t = (compteurs.get(ip) || []).filter((x) => now - x < LIMITE.fenetreMs);
  t.push(now);
  compteurs.set(ip, t);
  if (compteurs.size > 5000) for (const [k, v] of compteurs) if (!v.some((x) => now - x < LIMITE.fenetreMs)) compteurs.delete(k);
  return t.length <= LIMITE.max;
}

const cleDepuis = (req) => (req.headers['x-pennylane-key'] || '').toString().trim();
const nomFichierDepuis = (req) => { try { return decodeURIComponent(req.headers['x-nom-fichier'] || ''); } catch { return ''; } };

// Ce qui part vers le navigateur (pas de données internes inutiles) — repris de server.js
const publier = (p) => ({
  cle: p.cle, journal: p.journal, piece: p.piece, date: p.date, libelle: p.libelle,
  statut: p.statut, raisons: p.raisons || [], alertes: p.alertes || [],
  totalDebit: p.totalDebit, totalCredit: p.totalCredit, ca: p.ca || { ht: 0, tva: 0, ttc: 0 },
  lignes: (p.lignesPennylane || p.lignes).map((l) => ({
    compte: l.numeroPennylane || l.compte, libelle: l.libelleCompte, debit: l.debit, credit: l.credit,
  })),
});

/**
 * @param {object} ctx  outils communs du portail : { journal }
 * @param {object} [options]  { societes } pour les tests
 */
module.exports = function creerRouteur(ctx, options = {}) {
  const { journal } = ctx;
  const societes = options.societes || chargerSocietes();
  const r = express.Router();

  // Connexion obligatoire : page -> redirection vers la connexion ; API -> 401 JSON
  r.use((req, res, next) => {
    if (req.session.user) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ erreur: 'Session expirée : rechargez la page pour vous reconnecter.' });
    return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  });

  // API : limite de requêtes + jeton anti-CSRF (en-tête X-CSRF) sur les POST
  r.use('/api', (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress;
    if (!limiter(ip)) return res.status(429).json({ erreur: 'Trop de requêtes, réessayez dans quelques minutes' });
    if (req.method === 'POST') {
      const a = Buffer.from(String(req.headers['x-csrf'] || '')), b = Buffer.from(String(req.session.csrf || ''));
      if (!b.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(403).json({ erreur: 'Page expirée : rechargez la page.' });
      }
    }
    next();
  });

  const corpsBrut = express.raw({ type: () => true, limit: TAILLE_MAX });

  function societeDepuis(req) {
    const s = societes[String(req.query.societe || '')];
    if (!s) throw new ErreurHttp(400, 'Société inconnue');
    return s;
  }

  // Analyse d'un fichier : transformation + contrôles hors ligne, puis contrôles Pennylane si une clé est fournie
  async function analyser(societe, buffer, nomFichier, cle) {
    if (!buffer || !buffer.length) throw new ErreurHttp(400, 'Fichier vide');
    const imp = importeurs[societe.importeur];
    let res;
    try { res = imp.importer(buffer, societe, { nomFichier }); }
    catch (e) { throw new ErreurHttp(422, `Fichier illisible pour le format « ${imp.nom} » : ${e.message}`); }
    controler(res.pieces);
    let pennylane = null;
    if (cle) {
      const api = client(cle, { companyId: societe.pennylaneCompanyId });
      const ref = await referentiel(api, cle, societe);
      pennylane = await preparer(res.pieces, societe, ref, api);
      pennylane.api = api;
    }
    return { ...res, pennylane };
  }

  // ---------- Page ----------
  r.get('/', (req, res) => {
    journal(req, 'consultation', { outil: 'caisse' });
    res.render('caisse/index');
  });

  // ---------- API (reprise de server.js) ----------
  r.get('/api/societes', (req, res) => {
    res.json(Object.values(societes).map((s) => ({
      id: s.id, nom: s.nom, journal: s.journal, format: importeurs[s.importeur].nom, accept: importeurs[s.importeur].accept,
      controle: s.libelleControle || 'à rapprocher des Z',
    })));
  });

  r.post('/api/connexion', async (req, res) => {
    const societe = societeDepuis(req);
    const cle = cleDepuis(req);
    if (!cle) throw new ErreurHttp(400, 'Clé API manquante');
    const api = client(cle, { companyId: societe.pennylaneCompanyId });
    const me = await api.moi();
    const ref = await referentiel(api, cle, societe, { forcer: true });
    const nom = nomSociete(me);
    const alertes = [];
    if (societe.nomPennylane && nom && nom.trim().toUpperCase() !== societe.nomPennylane.trim().toUpperCase()) {
      alertes.push(`Cette clé ouvre le dossier « ${nom} », alors que « ${societe.nom} » attend « ${societe.nomPennylane} ». Vérifiez la clé avant d'aller plus loin.`);
    }
    const jnl = ref.journaux.find((j) => String(j.code).toUpperCase() === societe.journal.toUpperCase());
    if (!jnl) alertes.push(`Le journal « ${societe.journal} » n'existe pas dans ce dossier Pennylane.`);
    journal(req, 'connexion_pennylane', { outil: 'caisse', societe: societe.id, dossier_pennylane: nom || null, alertes: alertes.length });
    res.json({
      societePennylane: nom || '(nom non communiqué par Pennylane)',
      journal: jnl ? `${jnl.code} – ${jnl.label || ''}` : null,
      nbJournaux: ref.journaux.length, nbComptes: ref.comptes.length, alertes,
    });
  });

  r.post('/api/analyser', corpsBrut, async (req, res) => {
    const societe = societeDepuis(req);
    const nomFichier = nomFichierDepuis(req);
    const a = await analyser(societe, req.body, nomFichier, cleDepuis(req));
    const compte = (st) => a.pieces.filter((p) => p.statut === st).length;
    journal(req, 'analyse', {
      outil: 'caisse', societe: societe.id, fichier: nomFichier.slice(0, 150) || null, mode: a.pennylane ? 'pennylane' : 'hors-ligne',
      pieces: a.pieces.length, pretes: compte('prête'), bloquees: compte('bloquée'), deja_envoyees: compte('déjà envoyée'),
    });
    res.json({
      mode: a.pennylane ? 'pennylane' : 'hors-ligne',
      resume: a.resume,
      alertesGlobales: (a.pennylane && a.pennylane.alertesGlobales) || [],
      pieces: a.pieces.map(publier),
    });
  });

  r.post('/api/envoyer', corpsBrut, async (req, res) => {
    const societe = societeDepuis(req);
    const cle = cleDepuis(req);
    if (!cle) throw new ErreurHttp(400, 'Clé API manquante');
    let selection;
    try { selection = new Set(JSON.parse(decodeURIComponent(req.headers['x-selection'] || '[]'))); }
    catch { throw new ErreurHttp(400, 'Sélection illisible'); }
    if (!selection.size) throw new ErreurHttp(400, 'Aucune pièce sélectionnée');
    const nomFichier = nomFichierDepuis(req);
    // Le fichier est ré-analysé et re-contrôlé côté serveur : on n'envoie que des pièces « prêtes » à cet instant
    const a = await analyser(societe, req.body, nomFichier, cle);
    const aEnvoyer = a.pieces.filter((p) => selection.has(p.cle) && p.statut === 'prête');
    const ignorees = a.pieces.filter((p) => selection.has(p.cle) && p.statut !== 'prête')
      .map((p) => ({ cle: p.cle, piece: p.piece, ok: false, message: `non envoyée : ${p.statut}${p.raisons && p.raisons.length ? ' – ' + p.raisons.join(' ; ') : ''}` }));
    let resultats;
    try {
      resultats = await envoyer(aEnvoyer, a.pennylane.api);
    } finally {
      const ok = (resultats || []).filter((x) => x.ok);
      const montant = aEnvoyer.filter((p) => ok.some((x) => x.cle === p.cle)).reduce((s, p) => s + (p.totalDebit || 0), 0);
      journal(req, 'envoi_pennylane', {
        outil: 'caisse', societe: societe.id, fichier: nomFichier.slice(0, 150) || null,
        demandees: selection.size, envoyees: ok.length, echecs: (resultats ? resultats.length - ok.length : aEnvoyer.length) + ignorees.length,
        pieces: ok.map((x) => x.piece).slice(0, 60), montant_euros: Math.round(montant) / 100,
        interrompu: !resultats,
      });
    }
    res.json({ resultats: [...resultats, ...ignorees] });
  });

  r.use('/api', (req, res) => res.status(404).json({ erreur: 'Introuvable' }));

  // Erreurs de l'API : toujours en JSON, jamais la clé ni le contenu du fichier
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (!req.path.startsWith('/api/')) return next(err);
    let statut = err.statut || err.status || (err instanceof ErreurPennylane ? err.statut : 500);
    if (err.type === 'entity.too.large') statut = 413;
    if (!(statut >= 400 && statut < 600)) statut = 500;
    const message = statut === 413 ? 'Fichier trop volumineux (10 Mo maximum)' : statut === 500 ? 'Erreur interne' : err.message;
    if (statut === 500) console.error('[caisse] Erreur interne :', String(err.stack || err).split('\n').slice(0, 3).join(' | '));
    res.status(statut).json({ erreur: message });
  });

  return r;
};

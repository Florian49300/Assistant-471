'use strict';
/**
 * Brique « Assistant 471 » : comptes d'attente 4716 / 4717 Pennylane.
 * Montée sous /471 par le portail (voir src/modules/index.js).
 *
 * Variables d'environnement propres à cette brique :
 *   PENNYLANE_TOKEN     jeton API cabinet (lecture seule) - obligatoire hors démo
 *   CABINET_SIGNATURE   signature ajoutée au mail (\n = retour à la ligne) - vide par défaut
 *   CABINET_EXPEDITEUR  adresse « De » du brouillon (facultatif)
 *   SEUIL               montant minimum retenu, en euros (défaut 0)
 */
const express = require('express');

const { Pennylane, Demo, PennylaneError } = require('../pennylane');
const { totaux, nomFichier } = require('../retraitement');
const {
  TYPES, operationsDe, objetMail, nomExcel, texteAvant, texteApres, tableauxHtml, excelBuffer, emlBuffer,
} = require('../documents');

const SIGNATURE = (process.env.CABINET_SIGNATURE || '').replace(/\\n/g, '\n');
const EXPEDITEUR = process.env.CABINET_EXPEDITEUR || '';
const SEUIL = Number(String(process.env.SEUIL || '0').replace(',', '.')) || 0;

/**
 * @param {object} ctx  outils communs fournis par le portail :
 *   { DEMO, connexionRequise, verifierCsrf, journal, HttpError, telechargement }
 */
module.exports = function creerRouteur(ctx) {
  const { DEMO, connexionRequise, verifierCsrf, journal, HttpError, telechargement } = ctx;
  if (!DEMO && !process.env.PENNYLANE_TOKEN) console.warn('⚠ [471] PENNYLANE_TOKEN non défini');

  const r = express.Router();
  r.use(connexionRequise);

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

  r.get('/', async (req, res) => {
    const dossiers = await listeDossiers(req.query.rafraichir === '1');
    res.render('471/index', { dossiers });
  });

  r.get('/dossier/:id', async (req, res) => {
    const d = await extraire(req);
    const { depuis, jusqu } = periode(req);
    journal(req, 'consultation', { outil: '471', dossier: d.nom, dossier_id: d.companyId, operations: d.operations.length });
    res.render('471/dossier', {
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

  r.post('/dossier/:id/eml', verifierCsrf, async (req, res) => {
    const d = await extraire(req);
    if (!d.operations.length) throw new HttpError(400, 'Aucune opération à justifier pour ce dossier.');
    const destinataire = String(req.body.destinataire || '').replace(/[\r\n]/g, '').trim();
    const texte = (champ) => String(req.body[champ] || '').replace(/\r\n/g, '\n').trim() || null;
    const buf = await emlBuffer(d, {
      destinataire, expediteur: EXPEDITEUR, signature: SIGNATURE, avant: texte('avant'), apres: texte('apres'),
    });
    const jour = new Date().toISOString().slice(0, 10);
    journal(req, 'mail_eml', {
      outil: '471', dossier: d.nom, dossier_id: d.companyId, operations: d.operations.length, destinataire: destinataire || null,
    });
    telechargement(res, `${nomFichier(d.nom)}_mail_${jour}.eml`, 'message/rfc822', buf);
  });

  r.post('/dossier/:id/excel/:type', verifierCsrf, async (req, res) => {
    const type = req.params.type;
    if (!TYPES[type]) throw new HttpError(404, 'Fichier inconnu.');
    const d = await extraire(req);
    journal(req, 'excel', { outil: '471', type, dossier: d.nom, dossier_id: d.companyId });
    telechargement(res, nomExcel(d, type), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', await excelBuffer(d, type));
  });

  return r;
};

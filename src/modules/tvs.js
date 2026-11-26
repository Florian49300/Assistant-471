'use strict';
/**
 * Brique « TVS 2026 » : vérification des taxes sur l'affectation des véhicules de tourisme
 * (taxe CO₂ + taxe polluants), année d'imposition 2026. Montée sous /tvs.
 *
 * Le calcul est fait dans le navigateur par public/tvs/calcul.js (le même fichier est testé
 * côté serveur : test/tvs.test.js). Aucune donnée de parc n'est envoyée ni stockée sur le serveur :
 * l'utilisateur enregistre/ouvre ses parcs en fichiers JSON et exporte en CSV.
 * Le serveur ne reçoit qu'une trace d'activité (action, nombre de véhicules, nom du client saisi).
 */
const express = require('express');

module.exports = function creerRouteur(ctx) {
  const { connexionRequise, verifierCsrf, journal } = ctx;
  const r = express.Router();
  r.use(connexionRequise);

  r.get('/', (req, res) => {
    journal(req, 'consultation', { outil: 'tvs' });
    res.render('tvs/index');
  });

  // Trace des exports / enregistrements (appelée par la page, sans données de parc)
  const ACTIONS = new Set(['export_csv', 'enregistrer_json', 'ouvrir_json']);
  r.post('/journal', verifierCsrf, (req, res) => {
    const action = String(req.body.action || '');
    if (!ACTIONS.has(action)) return res.status(400).json({ ok: false });
    journal(req, action, {
      outil: 'tvs',
      client: String(req.body.client || '').slice(0, 120) || null,
      vehicules: Number(req.body.vehicules) || 0,
    });
    res.json({ ok: true });
  });

  return r;
};

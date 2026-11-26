'use strict';
// Charge toutes les sociétés décrites dans societes/*.json (hors fichiers commençant par "_").
const fs = require('fs');
const path = require('path');
const importeurs = require('../importeurs');

function chargerSocietes(dossier = __dirname) {
  const societes = {};
  for (const f of fs.readdirSync(dossier).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort()) {
    const s = JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));
    if (!s.id || !s.nom || !s.importeur) throw new Error(`${f} : champs "id", "nom" et "importeur" obligatoires`);
    if (!importeurs[s.importeur]) throw new Error(`${f} : importeur "${s.importeur}" inconnu`);
    if (societes[s.id]) throw new Error(`${f} : id "${s.id}" déjà utilisé`);
    if (!s.journal) throw new Error(`${f} : "journal" obligatoire`);
    societes[s.id] = s;
  }
  return societes;
}
module.exports = { chargerSocietes };

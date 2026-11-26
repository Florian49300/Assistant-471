'use strict';
// Registre des formats d'entrée. Pour un nouveau format : créer importeurs/<id>.js
// exposant { id, nom, accept, importer(buffer, config, { nomFichier }) -> { pieces, resume } } puis l'ajouter ici.
const liste = [
  require('./jalia-caisse'),
  require('./ecritures-caisse'),
  require('./tableau-caisse'),
];
module.exports = Object.fromEntries(liste.map(i => [i.id, i]));

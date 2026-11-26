'use strict';
// Lecteur minimal de classeurs Excel .xlsx, sans dépendance (zip + zlib natif + XML simple).
// Lit les valeurs (y compris le dernier résultat calculé des formules), les textes partagés et les noms d'onglets.
// Suffisant pour des tableaux de caisse ; ne gère ni les styles ni les dates typées (rendues en nombre de série).
const zlib = require('zlib');

// ---------- ZIP ----------
function lireZip(buf) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('ce fichier n\'est pas un classeur Excel .xlsx');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('archive .xlsx illisible');
  const nb = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entrees = new Map();
  for (let k = 0; k < nb; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('archive .xlsx endommagée');
    const methode = buf.readUInt16LE(p + 10);
    const taille = buf.readUInt32LE(p + 20);
    const lnom = buf.readUInt16LE(p + 28), lextra = buf.readUInt16LE(p + 30), lcomm = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + lnom);
    entrees.set(nom, { methode, taille, local });
    p += 46 + lnom + lextra + lcomm;
  }
  return {
    noms: [...entrees.keys()],
    lire(nom) {
      const e = entrees.get(nom);
      if (!e) return null;
      const debut = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
      const donnees = buf.subarray(debut, debut + e.taille);
      if (e.methode === 0) return donnees.toString('utf8');
      if (e.methode === 8) return zlib.inflateRawSync(donnees).toString('utf8');
      throw new Error(`compression ${e.methode} non gérée`);
    },
  };
}

// ---------- XML ----------
const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decoderXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITES[e] ?? m));
const attr = (balise, nom) => { const m = balise.match(new RegExp(`\\b${nom}="([^"]*)"`)); return m ? decoderXml(m[1]) : null; };
const textes = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decoderXml(m[1])).join('');

// "AB12" -> { col: 28, ligne: 12 }
function adresse(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, ligne: parseInt(m[2], 10) };
}
const lettre = col => { let s = ''; while (col > 0) { const r = (col - 1) % 26; s = String.fromCharCode(65 + r) + s; col = Math.floor((col - 1) / 26); } return s; };

function ouvrirClasseur(buffer) {
  const zip = lireZip(buffer);
  const wb = zip.lire('xl/workbook.xml');
  if (!wb) throw new Error('classeur Excel sans feuille');
  const rels = zip.lire('xl/_rels/workbook.xml.rels') || '';
  const cibles = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const feuilles = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => {
    let cible = cibles.get(attr(m[0], 'r:id')) || '';
    cible = cible.startsWith('/') ? cible.slice(1) : `xl/${cible}`;
    return { nom: attr(m[0], 'name'), chemin: cible.replace(/\/\.\//g, '/') };
  });
  const sst = zip.lire('xl/sharedStrings.xml');
  const partages = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textes(m[1])) : [];

  function lireFeuille(nom) {
    const f = feuilles.find(x => x.nom === nom);
    if (!f) return null;
    const xml = zip.lire(f.chemin) || '';
    const cellules = new Map();
    for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(m[1], 'r'); if (!ref) continue;
      const type = attr(m[1], 't'), corps = m[2] || '';
      const v = corps.match(/<v>([\s\S]*?)<\/v>/);
      let valeur = null;
      if (type === 's') valeur = v ? partages[parseInt(v[1], 10)] ?? '' : '';
      else if (type === 'inlineStr') valeur = textes(corps);
      else if (type === 'str' || type === 'e') valeur = v ? decoderXml(v[1]) : '';
      else if (type === 'b') valeur = v ? v[1] === '1' : null;
      else if (v) valeur = v[1];                       // nombre : gardé en texte, converti par l'appelant (sans flottant)
      if (valeur !== null && valeur !== '') cellules.set(ref, valeur);
    }
    return {
      nom,
      cellules,
      valeur: (col, ligne) => cellules.get(`${typeof col === 'number' ? lettre(col) : col}${ligne}`) ?? null,
      maxLigne: Math.max(0, ...[...cellules.keys()].map(r => adresse(r).ligne)),
      maxCol: Math.max(0, ...[...cellules.keys()].map(r => adresse(r).col)),
    };
  }
  return { feuilles: feuilles.map(f => f.nom), lireFeuille };
}

module.exports = { ouvrirClasseur, adresse, lettre };

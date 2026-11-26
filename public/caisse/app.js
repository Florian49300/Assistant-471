'use strict';
// Import caisse (ex-Pennylane DG) — page d'import intégrée au portail.
// La clé reste dans une variable de l'onglet (jamais localStorage, jamais l'URL).
// Seules différences avec la version d'origine : adresses préfixées par la brique (/caisse) et jeton anti-CSRF du portail.
(() => {
  const $ = id => document.getElementById(id);
  const etat = { societes: [], cle: '', connecte: false, fichier: null, pieces: [], envoyees: new Set() };

  const euros = c => (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const dateFr = d => (d ? d.split('-').reverse().join('/') : '?');
  const echapper = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const societe = () => etat.societes.find(s => s.id === $('societe').value);

  const BASE = window.CAISSE_BASE || '/caisse';
  async function api(chemin, { methode = 'GET', corps, entetes = {} } = {}) {
    const h = { ...entetes, 'X-CSRF': window.CAISSE_CSRF || '' };
    if (etat.cle) h['X-Pennylane-Key'] = etat.cle;
    const rep = await fetch(BASE + chemin, { method: methode, headers: h, body: corps, credentials: 'same-origin' });
    let json = null;
    try { json = await rep.json(); } catch { /* vide */ }
    if (!rep.ok) throw new Error(json?.erreur || `Erreur ${rep.status}`);
    return json;
  }

  function message(el, type, html) {
    el.className = `etat ${type}`;
    el.innerHTML = html;
    el.hidden = false;
  }

  // ---------- 1. Sociétés ----------
  async function chargerSocietes() {
    try {
      etat.societes = await api('/api/societes');
      $('societe').innerHTML = '<option value="">— Choisir une société —</option>' +
        etat.societes.map(s => `<option value="${echapper(s.id)}">${echapper(s.nom)}</option>`).join('');
    } catch (e) {
      $('societe').innerHTML = '<option value="">Erreur de chargement</option>';
    }
    majInterface();
  }

  function oublierCle() {
    etat.cle = ''; etat.connecte = false;
    $('cle').value = '';
    $('etat-connexion').hidden = true;
    $('btn-deconnexion').hidden = true;
  }

  $('societe').addEventListener('change', () => {
    oublierCle();                      // une clé = un dossier Pennylane : on la vide à chaque changement
    reinitialiserResultat();
    const s = societe();
    $('info-societe').textContent = s ? `Format attendu : ${s.format}. Journal : ${s.journal}.` : '';
    $('fichier').accept = s?.accept || '';
    majInterface();
  });

  $('btn-connexion').addEventListener('click', async () => {
    const s = societe();
    const cle = $('cle').value.trim();
    if (!s || !cle) return message($('etat-connexion'), 'ko', 'Choisissez une société et collez sa clé API.');
    etat.cle = cle;
    $('btn-connexion').disabled = true;
    message($('etat-connexion'), 'info', 'Connexion à Pennylane… (le premier accès peut prendre jusqu\'à une minute si le service était en veille)');
    try {
      const r = await api(`/api/connexion?societe=${encodeURIComponent(s.id)}`, { methode: 'POST' });
      etat.connecte = true;
      $('cle').value = '••••••••••••';
      $('btn-deconnexion').hidden = false;
      const alertes = r.alertes.length ? `<ul class="alertes">${r.alertes.map(a => `<li>${echapper(a)}</li>`).join('')}</ul>` : '';
      message($('etat-connexion'), r.alertes.length ? 'info' : 'ok',
        `Connecté au dossier Pennylane <b>${echapper(r.societePennylane)}</b> — journal ${echapper(r.journal || 'introuvable')}, ${r.nbComptes} comptes.${alertes}`);
      reinitialiserResultat();
    } catch (e) {
      etat.cle = ''; etat.connecte = false;
      message($('etat-connexion'), 'ko', echapper(e.message));
    } finally {
      majInterface();
    }
  });

  $('btn-deconnexion').addEventListener('click', () => { oublierCle(); reinitialiserResultat(); majInterface(); });

  // ---------- 2. Fichier ----------
  function choisirFichier(f) {
    etat.fichier = f || null;
    $('nom-fichier').textContent = f ? `${f.name} — ${(f.size / 1024).toFixed(0)} Ko` : 'Déposez le fichier ici ou cliquez pour le choisir';
    reinitialiserResultat();
    majInterface();
  }
  $('fichier').addEventListener('change', e => choisirFichier(e.target.files[0]));
  const depot = $('depot');
  ['dragenter', 'dragover'].forEach(t => depot.addEventListener(t, e => { e.preventDefault(); depot.classList.add('survol'); }));
  ['dragleave', 'drop'].forEach(t => depot.addEventListener(t, e => { e.preventDefault(); depot.classList.remove('survol'); }));
  depot.addEventListener('drop', e => choisirFichier(e.dataTransfer.files[0]));

  $('btn-analyser').addEventListener('click', analyser);

  async function analyser() {
    const s = societe();
    if (!s || !etat.fichier) return;
    $('btn-analyser').disabled = true;
    $('btn-analyser').textContent = 'Analyse…';
    try {
      const r = await api(`/api/analyser?societe=${encodeURIComponent(s.id)}`, {
        methode: 'POST', corps: etat.fichier,
        entetes: { 'Content-Type': 'application/octet-stream', 'X-Nom-Fichier': encodeURIComponent(etat.fichier.name) },
      });
      afficherResultat(r);
    } catch (e) {
      $('etape-resultat').hidden = false;
      $('alertes-globales').innerHTML = `<div class="etat ko">${echapper(e.message)}</div>`;
      $('chiffres').innerHTML = ''; $('pieces').innerHTML = ''; $('rapprochement').innerHTML = '';
    } finally {
      $('btn-analyser').textContent = 'Analyser';
      majInterface();
    }
  }

  // ---------- 3. Résultat ----------
  function reinitialiserResultat() {
    etat.pieces = []; etat.envoyees = new Set();
    $('etape-resultat').hidden = true;
    $('resultats-envoi').innerHTML = '';
  }

  const BADGES = { 'prête': 'prete', 'bloquée': 'bloquee', 'déjà envoyée': 'deja', 'envoyée': 'envoyee' };

  function afficherResultat(r) {
    etat.pieces = r.pieces;
    $('etape-resultat').hidden = false;
    $('resultats-envoi').innerHTML = '';
    const g = [];
    if (r.mode === 'hors-ligne') g.push('<div class="etat info">Analyse hors ligne : connectez-vous à Pennylane pour contrôler le journal, les comptes et les doublons, puis relancez l\'analyse.</div>');
    for (const a of r.alertesGlobales) g.push(`<div class="etat ko">${echapper(a)}</div>`);
    $('alertes-globales').innerHTML = g.join('');

    const n = st => r.pieces.filter(p => p.statut === st).length;
    const periode = (r.resume?.periode ? `${dateFr(r.resume.periode[0])} → ${dateFr(r.resume.periode[1])}` : '') +
      (r.resume?.onglet ? ` (onglet « ${r.resume.onglet} »)` : '');
    // Chiffre d'affaires importé : total à rapprocher des tickets Z reçus
    const ca = r.pieces.reduce((s, p) => ({ ht: s.ht + (p.ca?.ht || 0), tva: s.tva + (p.ca?.tva || 0), ttc: s.ttc + (p.ca?.ttc || 0) }), { ht: 0, tva: 0, ttc: 0 });
    $('chiffres').innerHTML = `<div class="chiffre ca">
        <div class="ca-montants"><div><b>${euros(ca.ht)}</b><span>CA HT importé</span></div><div><b>${euros(ca.tva)}</b><span>TVA importée</span></div></div>
        <span class="ca-ttc">Total TTC importé : ${euros(ca.ttc)} · ${echapper(societe()?.controle || 'à rapprocher des Z')}</span></div>` + [
      [r.pieces.length, `pièces ${periode ? '· ' + periode : ''}`],
      [n('prête'), 'prêtes'], [n('bloquée'), 'bloquées'], [n('déjà envoyée'), 'déjà dans Pennylane'],
    ].map(([v, l]) => `<div class="chiffre"><b>${v}</b><span>${echapper(l)}</span></div>`).join('');

    const rap = r.resume?.rapprochement || [];
    $('bloc-rapprochement').hidden = !rap.length;
    $('rapprochement').innerHTML = rap.map(x => {
      const ecart = x.ecritures - x.fichier;
      return `<tr><td>${echapper(x.libelle)}</td><td class="n">${x.info ? '—' : euros(x.fichier)}</td><td class="n">${euros(x.ecritures)}</td>
        <td class="n ${ecart && !x.info ? 'ecart' : ''}">${x.info ? 'info' : ecart ? euros(ecart) : 'OK'}</td></tr>`;
    }).join('');

    $('pieces').innerHTML = r.pieces.map((p, i) => {
      const cochable = p.statut === 'prête' && r.mode === 'pennylane';
      const notes = (p.raisons.length ? `<ul class="${p.statut === 'déjà envoyée' ? 'infos' : 'raisons'}">${p.raisons.map(x => `<li>${echapper(x)}</li>`).join('')}</ul>` : '') +
        (p.alertes.length ? `<ul class="alertes">${p.alertes.map(x => `<li>${echapper(x)}</li>`).join('')}</ul>` : '');
      const lignes = p.lignes.map(l => `<tr><td>${echapper(l.compte)}</td><td>${echapper(l.libelle)}</td>
        <td class="n">${l.debit ? euros(l.debit) : ''}</td><td class="n">${l.credit ? euros(l.credit) : ''}</td></tr>`).join('');
      return `<tr class="piece" data-i="${i}">
          <td><input type="checkbox" class="sel" data-cle="${echapper(p.cle)}" ${cochable ? '' : 'disabled'}></td>
          <td>${dateFr(p.date)}</td><td>${echapper(p.piece)}</td><td>${echapper(p.libelle)}${notes}</td>
          <td class="n">${euros(p.ca?.ttc || 0)}</td>
          <td class="n">${euros(p.totalDebit || 0)}</td>
          <td><span class="badge ${BADGES[p.statut] || ''}" id="statut-${i}">${echapper(p.statut)}</span></td></tr>
        <tr class="detail" id="detail-${i}" hidden><td colspan="7"><table>
          <thead><tr><th>Compte</th><th>Libellé</th><th class="n">Débit</th><th class="n">Crédit</th></tr></thead>
          <tbody>${lignes}<tr><td></td><td><b>Total</b></td><td class="n"><b>${euros(p.totalDebit || 0)}</b></td><td class="n"><b>${euros(p.totalCredit || 0)}</b></td></tr></tbody>
        </table></td></tr>`;
    }).join('');
    $('tout-cocher').checked = false;
    $('tout-cocher').disabled = r.mode !== 'pennylane';
    majSelection();
  }

  // Clic sur une ligne : déplie le détail (sauf sur la case à cocher)
  $('pieces').addEventListener('click', e => {
    if (e.target.classList.contains('sel')) return majSelection();
    const tr = e.target.closest('tr.piece');
    if (tr) $(`detail-${tr.dataset.i}`).hidden = !$(`detail-${tr.dataset.i}`).hidden;
  });
  $('tout-cocher').addEventListener('change', e => {
    document.querySelectorAll('.sel:not(:disabled)').forEach(c => { c.checked = e.target.checked; });
    majSelection();
  });

  const selection = () => [...document.querySelectorAll('.sel:checked:not(:disabled)')].map(c => c.dataset.cle);

  function majSelection() {
    const sel = selection();
    const total = etat.pieces.filter(p => sel.includes(p.cle)).reduce((s, p) => s + p.totalDebit, 0);
    $('resume-selection').textContent = sel.length ? `${sel.length} pièce(s) sélectionnée(s) — ${euros(total)}` :
      (etat.connecte ? 'Cochez les pièces à envoyer.' : 'Connectez-vous à Pennylane pour pouvoir envoyer.');
    $('btn-envoyer').disabled = !sel.length || !etat.connecte;
  }

  // ---------- Export CSV (contrôle dans Excel) ----------
  $('btn-export').addEventListener('click', () => {
    const lignes = [['Statut', 'Journal', 'Date', 'Pièce', 'Libellé pièce', 'Compte', 'Libellé ligne', 'Débit', 'Crédit']];
    const m = c => (c ? (c / 100).toFixed(2).replace('.', ',') : '');
    for (const p of etat.pieces) for (const l of p.lignes)
      lignes.push([p.statut, p.journal, p.date, p.piece, p.libelle, l.compte, l.libelle, m(l.debit), m(l.credit)]);
    const csv = '﻿' + lignes.map(r => r.map(v => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ecritures_${societe()?.id || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ---------- 4. Envoi ----------
  $('btn-envoyer').addEventListener('click', () => {
    const sel = selection();
    const total = etat.pieces.filter(p => sel.includes(p.cle)).reduce((s, p) => s + p.totalDebit, 0);
    $('texte-confirmation').innerHTML = `Créer <b>${sel.length} écriture(s)</b> pour <b>${euros(total)}</b> dans le journal
      <b>${echapper(societe().journal)}</b> du dossier <b>${echapper(societe().nom)}</b> ?<br><br>Cette action écrit dans Pennylane.`;
    $('confirmation').showModal();
  });
  $('btn-annuler').addEventListener('click', () => $('confirmation').close());
  $('btn-confirmer').addEventListener('click', async () => {
    $('confirmation').close();
    const sel = selection();
    $('btn-envoyer').disabled = true;
    $('btn-envoyer').textContent = 'Envoi en cours…';
    try {
      const r = await api(`/api/envoyer?societe=${encodeURIComponent(societe().id)}`, {
        methode: 'POST', corps: etat.fichier,
        entetes: { 'Content-Type': 'application/octet-stream', 'X-Nom-Fichier': encodeURIComponent(etat.fichier.name),
          'X-Selection': encodeURIComponent(JSON.stringify(sel)) },
      });
      const ok = r.resultats.filter(x => x.ok);
      for (const x of r.resultats) {
        const i = etat.pieces.findIndex(p => p.cle === x.cle);
        if (i < 0) continue;
        if (x.ok) {
          etat.pieces[i].statut = 'envoyée';
          $(`statut-${i}`).textContent = 'envoyée';
          $(`statut-${i}`).className = 'badge envoyee';
          const c = document.querySelector(`.sel[data-cle="${CSS.escape(x.cle)}"]`);
          if (c) { c.checked = false; c.disabled = true; }
        }
      }
      const ko = r.resultats.filter(x => !x.ok);
      $('resultats-envoi').innerHTML =
        `<div class="etat ${ko.length ? 'ko' : 'ok'}">${ok.length} écriture(s) créée(s)${ko.length ? `, ${ko.length} en échec :` : '.'}
        ${ko.length ? `<ul>${ko.map(x => `<li><b>${echapper(x.piece)}</b> — ${echapper(x.message)}</li>`).join('')}</ul>` : ''}</div>`;
    } catch (e) {
      $('resultats-envoi').innerHTML = `<div class="etat ko">${echapper(e.message)}</div>`;
    } finally {
      $('btn-envoyer').textContent = 'Envoyer dans Pennylane';
      majSelection();
    }
  });

  function majInterface() {
    const s = societe();
    $('btn-connexion').disabled = !s || etat.connecte;
    $('cle').disabled = !s || etat.connecte;
    $('btn-analyser').disabled = !s || !etat.fichier;
    majSelection();
  }

  chargerSocietes();
})();

/* TVS 2026 – interface de saisie du parc (navigateur). Calculs : window.TVS (calcul.js). */
(function () {
  'use strict';
  var TVS = window.TVS;
  var CLE = 'tvs2026-brouillon';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var eur = function (n) {
    if (n === null || n === undefined) return '—';
    var neg = n < 0, a = Math.abs(n), ent = Math.floor(a), dec = Math.round((a - ent) * 100);
    var s = String(ent).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (neg ? '−' : '') + s + (dec ? ',' + String(dec).padStart(2, '0') : '') + ' €';
  };
  var dateFr = function (iso) { return iso ? iso.split('-').reverse().join('/') : ''; };

  function vehiculeVide() {
    return {
      plaque: '', dateImmat: '', methode: 'auto', energie: 'essence', co2: '', cv: '', euro: 'auto', declare: '',
      exFauteuil: false, exEI: false, exActivite: false, exLCD: false, days: [[0, 364]],
    };
  }

  // ------------------------------------------------------------------ état
  var parc = { version: 1, annee: 2026, client: '', polMode: 'annuel', vehicles: [vehiculeVide()] };
  try {
    var b = JSON.parse(localStorage.getItem(CLE) || 'null');
    if (b && Array.isArray(b.vehicles)) parc = normaliser(b);
  } catch (e) { /* stockage indisponible : on part d'un parc vide */ }

  function normaliser(p) {
    var out = { version: 1, annee: 2026, client: String(p.client || ''), polMode: p.polMode === 'mars' ? 'mars' : 'annuel', vehicles: [] };
    (p.vehicles || []).forEach(function (v) {
      var n = vehiculeVide();
      Object.keys(n).forEach(function (k) { if (v[k] !== undefined && v[k] !== null) n[k] = v[k]; });
      ['co2', 'cv', 'declare'].forEach(function (k) { n[k] = String(n[k]); });
      ['exFauteuil', 'exEI', 'exActivite', 'exLCD'].forEach(function (k) { n[k] = Boolean(n[k]); });
      // `days` : 365 booléens ou périodes -> périodes
      n.days = TVS.periodes(TVS.joursAffectes(v.days));
      out.vehicles.push(n);
    });
    return out;
  }

  function sauver() {
    try { localStorage.setItem(CLE, JSON.stringify(parc)); } catch (e) { /* ignoré */ }
  }

  function tracer(action) {
    try {
      fetch(location.pathname.replace(/\/$/, '') + '/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrf: window.TVS_CSRF, action: action, client: parc.client, vehicules: parc.vehicles.length }),
        credentials: 'same-origin',
      });
    } catch (e) { /* trace facultative */ }
  }

  // ------------------------------------------------------------------ rendu d'un véhicule
  var OPTIONS_ENERGIE = Object.keys(TVS.ENERGIES).map(function (k) {
    return '<option value="' + k + '">' + esc(TVS.ENERGIES[k].libelle) + '</option>';
  }).join('');

  function carteVehicule(v, i) {
    var per = (v.days.length ? v.days : []).map(function (p, k) {
      return '<div class="per" data-k="' + k + '">'
        + '<span class="muted">Du</span><input type="date" data-per="0" min="2026-01-01" max="2026-12-31" value="' + TVS.dateDeIndex(p[0]) + '" aria-label="Début de la période">'
        + '<span class="muted">au</span><input type="date" data-per="1" min="2026-01-01" max="2026-12-31" value="' + TVS.dateDeIndex(p[1]) + '" aria-label="Fin de la période">'
        + '<button type="button" class="mini suppr" data-act="per-suppr" title="Retirer cette période">✕</button></div>';
    }).join('');
    var exos = Object.keys(TVS.EXONERATIONS).map(function (k) {
      return '<label><input type="checkbox" data-f="' + k + '"' + (v[k] ? ' checked' : '') + '>' + esc(TVS.EXONERATIONS[k]) + '</label>';
    }).join('');

    return '<div class="carte" data-i="' + i + '"><div class="veh"><div>'
      + '<div class="veh-tete"><span class="num">' + String(i + 1).padStart(2, '0') + '</span><h2 class="titre-veh"></h2>'
      + '<button type="button" class="mini" data-act="dupliquer">Dupliquer</button>'
      + '<button type="button" class="mini suppr" data-act="supprimer">Supprimer</button></div>'
      + '<div class="champs">'
      + champ('Immatriculation', '<input type="text" data-f="plaque" placeholder="AB-123-CD" value="' + esc(v.plaque) + '">')
      + champ('1re immatriculation', '<input type="date" data-f="dateImmat" value="' + esc(v.dateImmat) + '">', 'Case B du certificat')
      + champ('Énergie', '<select data-f="energie">' + OPTIONS_ENERGIE + '</select>')
      + champ('Barème CO₂', '<select data-f="methode"><option value="auto">Automatique</option><option value="WLTP">WLTP (g/km)</option><option value="NEDC">NEDC (g/km)</option><option value="PA">Puissance administrative</option></select>', '', 'methode')
      + champ('CO₂ (g/km)', '<input type="number" min="0" step="1" inputmode="numeric" data-f="co2" value="' + esc(v.co2) + '">', 'Case V.7', 'co2')
      + champ('Puissance (CV)', '<input type="number" min="0" step="1" inputmode="numeric" data-f="cv" value="' + esc(v.cv) + '">', 'Case P.6', 'cv')
      + champ('Norme Euro', '<select data-f="euro"><option value="auto">Automatique</option><option value="1">Euro 5/6 (Crit\'Air 1)</option><option value="2">Antérieure à Euro 5</option></select>', '', 'euro')
      + champ('Montant déclaré (€)', '<input type="number" min="0" step="0.01" inputmode="decimal" data-f="declare" value="' + esc(v.declare) + '">', 'Facultatif, à contrôler')
      + '</div>'
      + '<div class="bloc"><h3>Affectation en 2026</h3>' + per
      + '<button type="button" class="mini" data-act="per-ajout">+ Ajouter une période</button> '
      + '<button type="button" class="mini" data-act="per-annee">Toute l\'année</button></div>'
      + '<div class="bloc"><h3>Exonérations</h3><div class="exos">' + exos + '</div></div>'
      + '</div><div class="res" aria-live="polite"></div></div></div>';
  }

  function champ(libelle, controle, aide, nom) {
    return '<div class="champ"' + (nom ? ' data-champ="' + nom + '"' : '') + '><label>' + esc(libelle) + '</label>' + controle
      + (aide ? '<div class="aide">' + esc(aide) + '</div>' : '') + '</div>';
  }

  function dessinerTout() {
    $('#client').value = parc.client;
    $('#polMode').value = parc.polMode;
    var zone = $('#vehicules');
    zone.innerHTML = parc.vehicles.map(carteVehicule).join('');
    parc.vehicles.forEach(function (v, i) {
      var c = zone.querySelector('[data-i="' + i + '"]');
      c.querySelector('[data-f="energie"]').value = v.energie;
      c.querySelector('[data-f="methode"]').value = v.methode;
      c.querySelector('[data-f="euro"]').value = v.euro;
    });
    recalculer();
  }

  // ------------------------------------------------------------------ résultats
  function recalculer() {
    var calc = TVS.calculerParc(parc);
    parc.vehicles.forEach(function (v, i) {
      var c = document.querySelector('#vehicules [data-i="' + i + '"]');
      if (c) majCarte(c, v, calc.resultats[i], calc.polMode);
    });
    majRecap(calc);
    sauver();
  }

  function majCarte(c, v, r, polMode) {
    c.querySelector('.titre-veh').textContent = v.plaque || 'Véhicule ' + (Number(c.dataset.i) + 1);
    var methode = v.methode !== 'auto' ? v.methode : TVS.methodeAuto(v.dateImmat);
    var elec = TVS.ENERGIES[v.energie] && TVS.ENERGIES[v.energie].exonere;
    c.querySelector('[data-champ="co2"]').classList.toggle('cache', Boolean(elec || methode === 'PA'));
    c.querySelector('[data-champ="cv"]').classList.toggle('cache', Boolean(elec || methode !== 'PA'));
    c.querySelector('[data-champ="methode"]').classList.toggle('cache', Boolean(elec));
    var aideMethode = c.querySelector('[data-champ="methode"] .aide') || (function () {
      var d = document.createElement('div'); d.className = 'aide'; c.querySelector('[data-champ="methode"]').appendChild(d); return d;
    })();
    aideMethode.textContent = v.methode === 'auto' && methode ? 'Retenu : ' + methode : '';

    var h = '<div class="tot"><small>Total dû 2026</small>' + eur(r.total) + '</div><dl>';
    h += '<dt>Taxe CO₂</dt><dd>' + eur(r.taxeCO2) + '</dd>';
    h += '<dt>Taxe polluants</dt><dd>' + eur(r.taxePolluants) + '</dd>';
    h += '<dt>Jours d\'affectation</dt><dd>' + r.nbJours + ' / 365</dd>';
    if (r.declare !== null) h += '<dt>Déclaré</dt><dd>' + eur(r.declare) + '</dd><dt>Écart (déclaré − dû)</dt><dd>' + eur(r.ecart) + '</dd>';
    h += '</dl>';
    if (r.conforme === true) h += '<span class="statut ok">✓ Conforme (écart ≤ 1 €)</span>';
    else if (r.conforme === false) h += '<span class="statut ko">⚠ Écart de ' + eur(Math.abs(r.ecart)) + (r.ecart > 0 ? ' (sur-déclaré)' : ' (sous-déclaré)') + '</span>';
    else h += '<span class="statut na">Pas de montant déclaré</span>';
    r.alertes.forEach(function (a) { h += '<div class="alerte">' + esc(a) + '</div>'; });
    if (r.exoneration) h += '<div class="info">Exonération : ' + esc(r.exoneration) + ' → 0 €.</div>';
    if (r.ecartModeMars && polMode === 'annuel') {
      h += '<div class="info">Point ouvert (tarif polluants au 01/03/2026) : avec l\'ancien tarif jusqu\'au 28/02, la taxe polluants serait de '
        + eur(r.taxePolluants + r.ecartModeMars) + ' (' + eur(r.ecartModeMars) + ').</div>';
    }
    h += detailCalcul(r, polMode) + '';
    c.querySelector('.res').innerHTML = h;
  }

  function detailCalcul(r, polMode) {
    var lignes = [];
    var pr = r.prorata.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
    if (r.methode && r.valeurRetenue !== null) {
      lignes.push('Barème <b>' + r.methode + '</b> · valeur ' + r.valeur + ' ' + r.unite
        + (r.abattementE85 ? ' → retenue ' + r.valeurRetenue + ' ' + r.unite + ' (abattement E85)' : ''));
      var t = '<table><thead><tr><th>Tranche</th><th class="m">Unités</th><th class="m">Tarif</th><th class="m">Montant</th></tr></thead><tbody>';
      r.detailTranches.filter(function (x) { return x.unites > 0; }).forEach(function (x) {
        t += '<tr><td>' + x.basse + ' – ' + (x.haute === null ? '∞' : x.haute) + '</td><td class="m">' + x.unites + '</td><td class="m">'
          + eur(x.tarif) + '</td><td class="m">' + eur(x.montant) + '</td></tr>';
      });
      t += '</tbody><tfoot><tr><td colspan="3">Tarif annuel CO₂</td><td class="m">' + eur(r.tarifAnnuelCO2) + '</td></tr></tfoot></table>';
      lignes.push(t);
      lignes.push('Taxe CO₂ = ' + eur(r.tarifAnnuelCO2) + ' × ' + r.nbJours + '/365 (' + pr + ') = ' + (r.tarifAnnuelCO2 * r.prorata).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' € → arrondi <b>' + eur(r.exoneration ? 0 : r.taxeCO2) + '</b>');
    } else if (r.methode === null) {
      lignes.push('Énergie exonérée de taxe CO₂ (électrique / hydrogène).');
    }
    var cat = 'Catégorie polluants <b>' + esc(r.categorieLibelle) + '</b> · norme ' + (r.euro === '1' ? 'Euro 5/6' : 'antérieure à Euro 5');
    lignes.push(cat);
    if (polMode === 'mars') {
      var anc = TVS.POLLUANTS[r.categoriePolluants].ancien;
      lignes.push('Taxe polluants = (' + anc + ' € × ' + r.joursAvantMars + ' j + ' + r.tarifPolluants + ' € × ' + (r.nbJours - r.joursAvantMars) + ' j) / 365 → <b>' + eur(r.taxePolluants) + '</b>');
    } else {
      lignes.push('Taxe polluants = ' + eur(r.tarifPolluants) + ' × ' + r.nbJours + '/365 → <b>' + eur(r.taxePolluants) + '</b>');
    }
    lignes.push('<span class="muted">Arrondi à l\'euro le plus proche, chaque taxe séparément (0,5 compte pour 1).</span>');
    return '<details><summary>Détail du calcul</summary>' + lignes.map(function (l) { return '<div style="margin-top:6px">' + l + '</div>'; }).join('') + '</details>';
  }

  function majRecap(calc) {
    var t = calc.totaux;
    var h = '<h2>Récapitulatif du parc · ' + parc.vehicles.length + ' véhicule' + (parc.vehicles.length > 1 ? 's' : '') + '</h2>';
    h += '<div style="overflow-x:auto"><table class="recap"><thead><tr><th>Véhicule</th><th>Énergie</th><th>Barème</th><th class="m">Jours</th>'
      + '<th class="m">CO₂</th><th class="m">Polluants</th><th class="m">Total dû</th><th class="m">Déclaré</th><th class="m">Écart</th><th>Statut</th></tr></thead><tbody>';
    calc.resultats.forEach(function (r, i) {
      var v = parc.vehicles[i];
      var statut = r.alertes.length ? '<span class="dep">À compléter</span>' : r.conforme === true ? '<span class="rec">Conforme</span>' : r.conforme === false ? '<span class="dep">Écart</span>' : '<span class="muted">—</span>';
      h += '<tr><td class="nom">' + esc(v.plaque || 'Véhicule ' + (i + 1)) + (v.dateImmat ? '<div class="muted">' + dateFr(v.dateImmat) + '</div>' : '') + '</td>'
        + '<td>' + esc(r.energieLibelle) + '</td><td>' + (r.methode || '—') + '</td><td class="m">' + r.nbJours + '</td>'
        + '<td class="m">' + eur(r.taxeCO2) + '</td><td class="m">' + eur(r.taxePolluants) + '</td><td class="m"><b>' + eur(r.total) + '</b></td>'
        + '<td class="m">' + (r.declare === null ? '—' : eur(r.declare)) + '</td><td class="m">' + (r.ecart === null ? '—' : eur(r.ecart)) + '</td><td>' + statut + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="4">Total du parc</td><td class="m">' + eur(t.taxeCO2) + '</td><td class="m">' + eur(t.taxePolluants)
      + '</td><td class="m">' + eur(t.total) + '</td><td class="m">' + (t.nbDeclares ? eur(t.declare) : '—') + '</td><td class="m">'
      + (t.ecart === null ? '—' : eur(t.ecart)) + '</td><td></td></tr></tfoot></table></div>';
    if (t.nbDeclares) {
      h += '<p class="muted" style="margin:10px 0 0">Écart du parc calculé sur les ' + t.nbDeclares + ' véhicule(s) ayant un montant déclaré'
        + (t.nbEcarts ? ' · <b class="dep">' + t.nbEcarts + ' en écart</b>' : ' · tous conformes') + '.</p>';
    }
    $('#recap').innerHTML = h;
  }

  // ------------------------------------------------------------------ événements
  var zone = $('#vehicules');

  zone.addEventListener('input', function (e) {
    var c = e.target.closest('[data-i]');
    if (!c) return;
    var v = parc.vehicles[Number(c.dataset.i)];
    var f = e.target.dataset.f;
    if (f) v[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.dataset.per !== undefined) {
      var ligne = e.target.closest('.per'), k = Number(ligne.dataset.k);
      var i0 = TVS.indexJour(ligne.querySelector('[data-per="0"]').value);
      var i1 = TVS.indexJour(ligne.querySelector('[data-per="1"]').value);
      if (i0 !== null && i1 !== null) v.days[k] = [Math.max(0, Math.min(364, i0)), Math.max(0, Math.min(364, i1))];
    }
    recalculer();
  });

  zone.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var c = b.closest('[data-i]'), i = Number(c.dataset.i), v = parc.vehicles[i];
    switch (b.dataset.act) {
      case 'supprimer':
        if (!confirmer('Supprimer ce véhicule ?')) return;
        parc.vehicles.splice(i, 1);
        if (!parc.vehicles.length) parc.vehicles.push(vehiculeVide());
        break;
      case 'dupliquer': parc.vehicles.splice(i + 1, 0, JSON.parse(JSON.stringify(Object.assign({}, v, { plaque: '' })))); break;
      case 'per-ajout': v.days.push([0, 364]); break;
      case 'per-annee': v.days = [[0, 364]]; break;
      case 'per-suppr': v.days.splice(Number(b.closest('.per').dataset.k), 1); break;
      default: return;
    }
    dessinerTout();
  });

  function confirmer(msg) { try { return window.confirm(msg); } catch (e) { return true; } }

  $('#client').addEventListener('input', function (e) { parc.client = e.target.value; sauver(); });
  $('#polMode').addEventListener('change', function (e) { parc.polMode = e.target.value; recalculer(); });
  $('#ajouter').addEventListener('click', function () {
    parc.vehicles.push(vehiculeVide());
    dessinerTout();
    var cartes = zone.querySelectorAll('[data-i]');
    cartes[cartes.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#vider').addEventListener('click', function () {
    if (!confirmer('Commencer un nouveau parc ? Le parc actuel sera effacé de ce poste (pensez à l\'enregistrer en .json).')) return;
    parc = { version: 1, annee: 2026, client: '', polMode: 'annuel', vehicles: [vehiculeVide()] };
    dessinerTout();
  });

  function nomFichier(ext) {
    var c = (parc.client || 'parc').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'parc';
    return 'TVS2026_' + c + '.' + ext;
  }
  function telecharger(nom, contenu, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type: type }));
    a.download = nom;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('#csv').addEventListener('click', function () {
    telecharger(nomFichier('csv'), TVS.exportCSV(parc), 'text/csv;charset=utf-8');
    tracer('export_csv');
  });
  $('#enregistrer').addEventListener('click', function () {
    telecharger(nomFichier('json'), JSON.stringify(parc, null, 2), 'application/json');
    tracer('enregistrer_json');
  });
  $('#fichier').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    f.text().then(function (txt) {
      var p = JSON.parse(txt);
      if (!p || !Array.isArray(p.vehicles)) throw new Error('format');
      parc = normaliser(p);
      dessinerTout();
      tracer('ouvrir_json');
    }).catch(function () {
      window.alert('Ce fichier n\'est pas un parc TVS 2026 valide (.json).');
    }).finally(function () { e.target.value = ''; });
  });

  dessinerTout();
})();

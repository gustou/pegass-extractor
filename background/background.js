/**
 * Pegass Extractor - Background Script (Service Worker)
 * Gère l'extraction de manière asynchrone et persiste les données
 */

// État de l'extraction (en mémoire pour la session)
const extractionState = {
  isExtracting: false,
  progress: 0,
  detail: '',
  tabId: null,
  lastError: null
};

// Données persistées (chargées depuis storage)
let lastExtraction = null;

// Charger les données au démarrage
loadLastExtraction();

/**
 * Charge la dernière extraction depuis le storage
 */
async function loadLastExtraction() {
  try {
    const result = await browser.storage.local.get('lastExtraction');
    if (result.lastExtraction) {
      lastExtraction = result.lastExtraction;
      console.log('Dernière extraction chargée:', lastExtraction.metadata?.date_extraction);
    }
  } catch (error) {
    console.error('Erreur chargement extraction:', error);
  }
}

/**
 * Sauvegarde l'extraction dans le storage
 */
async function saveLastExtraction(data) {
  try {
    lastExtraction = data;
    await browser.storage.local.set({ lastExtraction: data });
    console.log('Extraction sauvegardée');
  } catch (error) {
    console.error('Erreur sauvegarde extraction:', error);
  }
}

// Écoute les messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'startExtraction':
      startExtraction(message.config, message.tabId).then(sendResponse);
      return true;

    case 'getExtractionState':
      sendResponse({
        ...extractionState,
        data: lastExtraction,
        hasData: !!lastExtraction
      });
      return false;

    case 'cancelExtraction':
      extractionState.isExtracting = false;
      extractionState.lastError = null;
      sendResponse({ cancelled: true });
      return false;

    case 'clearExtraction':
      resetState();
      sendResponse({ success: true });
      return false;

    case 'downloadData':
      downloadData(message.format).then(sendResponse);
      return true;

    case 'progress':
      updateProgress(message.percent, message.detail);
      return false;

    case 'getLastExtraction':
      sendResponse({
        hasData: !!lastExtraction,
        data: lastExtraction
      });
      return false;

    case 'deleteLastExtraction':
      deleteLastExtraction().then(sendResponse);
      return true;

    case 'updateLastExtraction':
      updateLastExtraction(message.tabId).then(sendResponse);
      return true;
  }
});

/**
 * Formate une date en YYYY-MM-DD (fuseau local du worker)
 */
function formatLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localYmdFromIso(isoString) {
  if (!isoString) return null;
  return formatLocalYMD(new Date(isoString));
}

function minYmd(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return a < b ? a : b;
}

function maxYmd(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return a > b ? a : b;
}

/**
 * Recalcule heures / par_mois / par_type à partir des missions fusionnées
 */
function recomputeHeuresFromMissions(b) {
  const missions = [...(b.missions || [])];
  const heures = {
    total: 0,
    locales: 0,
    externes: 0,
    par_mois: {},
    par_type: {}
  };

  for (const m of missions) {
    if (!m) continue;
    const h = Number(m.heures) || 0;
    if (h <= 0) continue;

    heures.total += h;
    if (m.externe) {
      heures.externes += h;
    } else {
      heures.locales += h;
    }

    const mois = (m.date || (typeof m.debut === 'string' ? m.debut : '') || '').substring(0, 7);
    if (mois.length === 7) {
      heures.par_mois[mois] = (heures.par_mois[mois] || 0) + h;
    }

    const type = m.groupeAction || 'Autre';
    heures.par_type[type] = (heures.par_type[type] || 0) + h;
  }

  heures.total = Math.round(heures.total * 100) / 100;
  heures.locales = Math.round(heures.locales * 100) / 100;
  heures.externes = Math.round(heures.externes * 100) / 100;

  for (const key of Object.keys(heures.par_mois)) {
    heures.par_mois[key] = Math.round(heures.par_mois[key] * 100) / 100;
  }
  for (const key of Object.keys(heures.par_type)) {
    heures.par_type[key] = Math.round(heures.par_type[key] * 100) / 100;
  }

  missions.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return {
    ...b,
    heures,
    missions,
    inscriptions_count: missions.length
  };
}

/**
 * Fusionne une extraction complète avec un delta (même mode / même UL attendus)
 */
function mergeExtractionData(previous, delta) {
  const oldMeta = previous.metadata || {};
  const deltaMeta = delta.metadata || {};
  const periodeOld = oldMeta.periode || {};
  const periodeDelta = deltaMeta.periode || {};

  const map = new Map();
  for (const b of previous.benevoles || []) {
    map.set(String(b.id), {
      ...b,
      missions: [...(b.missions || [])]
    });
  }

  for (const newB of delta.benevoles || []) {
    const id = String(newB.id);
    const newMissions = [...(newB.missions || [])];

    if (!map.has(id)) {
      map.set(id, recomputeHeuresFromMissions({ ...newB, missions: newMissions }));
      continue;
    }

    const oldB = map.get(id);
    const missionById = new Map();
    for (const m of oldB.missions) {
      if (m && m.id != null && m.id !== '') {
        missionById.set(String(m.id), m);
      }
    }
    for (const m of newMissions) {
      if (m && m.id != null && m.id !== '') {
        missionById.set(String(m.id), m);
      }
    }

    const merged = {
      ...oldB,
      missions: Array.from(missionById.values())
    };
    map.set(id, recomputeHeuresFromMissions(merged));
  }

  const benevoles = Array.from(map.values());
  benevoles.sort((a, b) => (b.heures?.total || 0) - (a.heures?.total || 0));

  let heuresLocales = 0;
  let heuresExternes = 0;
  let totalMissions = 0;

  for (const b of benevoles) {
    totalMissions += b.missions?.length || 0;
    for (const m of b.missions || []) {
      if (!m) continue;
      const h = Number(m.heures) || 0;
      if (m.externe) {
        heuresExternes += h;
      } else {
        heuresLocales += h;
      }
    }
  }

  heuresLocales = Math.round(heuresLocales * 100) / 100;
  heuresExternes = Math.round(heuresExternes * 100) / 100;

  return {
    metadata: {
      ...oldMeta,
      date_extraction: new Date().toISOString(),
      periode: {
        debut: minYmd(periodeOld.debut, periodeDelta.debut),
        fin: maxYmd(periodeOld.fin, periodeDelta.fin)
      },
      config_snapshot: oldMeta.config_snapshot || deltaMeta.config_snapshot
    },
    benevoles,
    stats: {
      total_benevoles: benevoles.length,
      total_heures: Math.round((heuresLocales + heuresExternes) * 100) / 100,
      heures_locales: heuresLocales,
      heures_externes: heuresExternes,
      total_missions: totalMissions
    }
  };
}

/**
 * Re-extrait une fenêtre depuis la date de dernière extraction et fusionne avec le fichier stocké
 */
async function updateLastExtraction(tabId) {
  if (extractionState.isExtracting) {
    return { success: false, error: 'Extraction déjà en cours' };
  }

  if (!lastExtraction) {
    const msg = 'Aucune extraction enregistrée';
    extractionState.lastError = msg;
    return { success: false, error: msg };
  }

  const snap = lastExtraction.metadata?.config_snapshot;
  if (!snap) {
    const msg =
      'Cette extraction ne permet pas la mise à jour. Lancez une extraction complète avec la version actuelle de l’extension.';
    extractionState.lastError = msg;
    return { success: false, error: msg };
  }

  const isoEx = lastExtraction.metadata?.date_extraction;
  if (!isoEx) {
    const msg = 'Date de dernière extraction introuvable';
    extractionState.lastError = msg;
    return { success: false, error: msg };
  }

  let dateDebut = localYmdFromIso(isoEx);
  const dateFin = formatLocalYMD(new Date());
  if (!dateDebut) {
    const msg = 'Date de dernière extraction invalide';
    extractionState.lastError = msg;
    return { success: false, error: msg };
  }
  if (dateDebut > dateFin) {
    dateDebut = dateFin;
  }

  extractionState.isExtracting = true;
  extractionState.lastError = null;
  extractionState.progress = 0;
  extractionState.detail = 'Mise à jour...';
  extractionState.tabId = tabId;

  const config = {
    mode: snap.mode,
    dateDebut,
    dateFin,
    extractHeures: snap.extractHeures,
    extractMissions: snap.extractMissions,
    extractFormations: snap.extractFormations,
    format: snap.format || 'json'
  };

  try {
    const response = await browser.tabs.sendMessage(tabId, {
      action: 'startExtraction',
      config
    });

    if (response && response.success) {
      const merged = mergeExtractionData(lastExtraction, response.data);
      await saveLastExtraction(merged);

      extractionState.progress = 100;
      extractionState.detail = 'Mise à jour terminée';

      showNotification(
        'Mise à jour terminée',
        `${merged.benevoles.length} bénévoles dans le fichier`
      );

      return { success: true };
    }

    throw new Error(response?.error || 'Erreur inconnue');
  } catch (error) {
    extractionState.lastError = error.message;
    showNotification('Erreur de mise à jour', error.message);
    return { success: false, error: error.message };
  } finally {
    extractionState.isExtracting = false;
  }
}

/**
 * Démarre l'extraction dans le background
 */
async function startExtraction(config, tabId) {
  if (extractionState.isExtracting) {
    return { success: false, error: 'Extraction déjà en cours' };
  }

  // Réinitialiser l'état (mais garder lastExtraction)
  extractionState.isExtracting = true;
  extractionState.lastError = null;
  extractionState.progress = 0;
  extractionState.detail = '';
  extractionState.tabId = tabId;

  try {
    // Envoie la commande d'extraction au content script
    const response = await browser.tabs.sendMessage(tabId, {
      action: 'startExtraction',
      config: config
    });

    if (response && response.success) {
      // Sauvegarder les données
      await saveLastExtraction(response.data);

      extractionState.progress = 100;
      extractionState.detail = 'Extraction terminée';

      // Notification de fin
      showNotification('Extraction terminée',
        `${response.data.benevoles.length} bénévoles extraits`);

      return { success: true };
    } else {
      throw new Error(response?.error || 'Erreur inconnue');
    }
  } catch (error) {
    extractionState.lastError = error.message;
    showNotification('Erreur d\'extraction', error.message);
    return { success: false, error: error.message };
  } finally {
    extractionState.isExtracting = false;
  }
}

/**
 * Met à jour la progression
 */
function updateProgress(percent, detail) {
  extractionState.progress = percent;
  extractionState.detail = detail;
}

/**
 * Réinitialise l'état de progression (sans effacer les données)
 */
function resetState() {
  extractionState.isExtracting = false;
  extractionState.progress = 0;
  extractionState.detail = '';
  extractionState.tabId = null;
  extractionState.lastError = null;
  // Note: on ne supprime PAS lastExtraction ici
}

/**
 * Supprime la dernière extraction
 */
async function deleteLastExtraction() {
  try {
    lastExtraction = null;
    await browser.storage.local.remove('lastExtraction');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Télécharge les données extraites
 */
async function downloadData(format) {
  if (!lastExtraction) {
    return { success: false, error: 'Pas de données' };
  }

  let content, filename, type;
  const date = lastExtraction.metadata?.date_extraction?.split('T')[0] ||
               new Date().toISOString().split('T')[0];

  if (format === 'json') {
    content = JSON.stringify(lastExtraction, null, 2);
    filename = `pegass_export_${date}.json`;
    type = 'application/json';
  } else {
    content = convertToCSV(lastExtraction);
    filename = `pegass_export_${date}.csv`;
    type = 'text/csv';
  }

  // Créer un blob URL et télécharger
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);

  try {
    await browser.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/**
 * Convertit les données en CSV
 */
function convertToCSV(data) {
  const headers = ['ID', 'Nom', 'Prénom', 'Structure', 'Heures Total', 'Nb Missions', 'Actif'];
  const rows = data.benevoles.map(b => [
    b.id,
    b.nom,
    b.prenom,
    b.structure || '',
    b.heures?.total || 0,
    b.missions?.length || 0,
    b.actif ? 'Oui' : 'Non'
  ]);

  const csvContent = [
    headers.join(';'),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
  ].join('\n');

  return '\ufeff' + csvContent;
}

/**
 * Affiche une notification
 */
function showNotification(title, message) {
  browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('icons/icon-96.svg'),
    title: title,
    message: message
  });
}

console.log('Pegass Extractor: Background script chargé (persistant)');

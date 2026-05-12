/**
 * Pegass Extractor - Background Script (Service Worker)
 * Gère l'extraction de manière asynchrone et persiste les données
 */

// État de l'extraction (en mémoire pour la session)
const extractionState = {
  isExtracting: false,
  progress: 0,
  detail: '',
  tabId: null
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
  }
});

/**
 * Démarre l'extraction dans le background
 */
async function startExtraction(config, tabId) {
  if (extractionState.isExtracting) {
    return { success: false, error: 'Extraction déjà en cours' };
  }

  // Réinitialiser l'état (mais garder lastExtraction)
  extractionState.isExtracting = true;
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

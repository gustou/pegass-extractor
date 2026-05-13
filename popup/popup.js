/**
 * Pegass Extractor - Popup Script
 * Interface utilisateur - communique avec le background script
 */

// État local
let currentTabId = null;
let progressInterval = null;

// Éléments du DOM
const elements = {
  connectionStatus: document.getElementById('connection-status'),
  statusText: document.querySelector('.status-text'),
  uniteInfo: document.getElementById('unite-info'),
  dateDebut: document.getElementById('date-debut'),
  dateFin: document.getElementById('date-fin'),
  extractHeures: document.getElementById('extract-heures'),
  extractMissions: document.getElementById('extract-missions'),
  extractFormations: document.getElementById('extract-formations'),
  btnExtract: document.getElementById('btn-extract'),
  btnCancel: document.getElementById('btn-cancel'),
  btnDownload: document.getElementById('btn-download'),
  btnReset: document.getElementById('btn-reset'),
  btnRetry: document.getElementById('btn-retry'),
  configSection: document.getElementById('config-section'),
  actionSection: document.getElementById('action-section'),
  progressSection: document.getElementById('progress-section'),
  resultSection: document.getElementById('result-section'),
  errorSection: document.getElementById('error-section'),
  progressFill: document.getElementById('progress-fill'),
  progressPercent: document.getElementById('progress-percent'),
  progressDetail: document.getElementById('progress-detail'),
  resultMessage: document.getElementById('result-message'),
  errorText: document.getElementById('error-text'),
  versionDisplay: document.getElementById('version-display'),
  // Nouvelle section dernière extraction
  lastExtractionSection: document.getElementById('last-extraction-section'),
  lastDate: document.getElementById('last-date'),
  lastBenevoles: document.getElementById('last-benevoles'),
  lastPeriode: document.getElementById('last-periode'),
  btnDownloadLast: document.getElementById('btn-download-last'),
  btnDownloadLastCsv: document.getElementById('btn-download-last-csv'),
  btnDeleteLast: document.getElementById('btn-delete-last')
};

// Initialisation
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setVersion();
  setDefaultDates();
  await getCurrentTab();
  await checkConnection();
  await checkLastExtraction();
  await checkExtractionState();
  setupEventListeners();
}

/**
 * Affiche la version de l'extension
 */
function setVersion() {
  const manifest = browser.runtime.getManifest();
  elements.versionDisplay.textContent = `v${manifest.version}`;
}

/**
 * Récupère l'onglet courant
 */
async function getCurrentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
}

/**
 * Définit les dates par défaut (année en cours)
 */
function setDefaultDates() {
  const now = new Date();
  const year = now.getFullYear();
  elements.dateDebut.value = `${year}-01-01`;
  elements.dateFin.value = now.toISOString().split('T')[0];
}

/**
 * Configure les écouteurs d'événements
 */
function setupEventListeners() {
  elements.btnExtract.addEventListener('click', startExtraction);
  elements.btnCancel.addEventListener('click', cancelExtraction);
  elements.btnDownload.addEventListener('click', () => downloadData('json'));
  elements.btnReset.addEventListener('click', resetUI);
  elements.btnRetry.addEventListener('click', startExtraction);
  // Boutons dernière extraction
  elements.btnDownloadLast.addEventListener('click', () => downloadData('json'));
  elements.btnDownloadLastCsv.addEventListener('click', () => downloadData('csv'));
  elements.btnDeleteLast.addEventListener('click', deleteLastExtraction);
}

/**
 * Vérifie si l'utilisateur est connecté à Pegass
 */
async function checkConnection() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('pegass.croix-rouge.fr')) {
      updateConnectionStatus('disconnected', 'Ouvrez Pegass pour commencer');
      return;
    }

    const response = await browser.tabs.sendMessage(tab.id, { action: 'checkConnection' });

    if (response && response.connected) {
      updateConnectionStatus('connected', 'Connecté à Pegass');

      if (response.uniteLocale) {
        elements.uniteInfo.textContent = `Unité: ${response.uniteLocale}`;
        elements.uniteInfo.classList.remove('hidden');
      }

      elements.btnExtract.disabled = false;
    } else {
      updateConnectionStatus('disconnected', 'Connectez-vous à Pegass');
    }
  } catch (error) {
    console.error('Erreur de vérification:', error);
    updateConnectionStatus('error', 'Erreur de communication');
  }
}

/**
 * Vérifie s'il y a une dernière extraction sauvegardée
 */
async function checkLastExtraction() {
  try {
    const state = await browser.runtime.sendMessage({ action: 'getExtractionState' });

    if (state.hasData && state.data) {
      displayLastExtraction(state.data);
    }
  } catch (error) {
    console.error('Erreur vérification dernière extraction:', error);
  }
}

/**
 * Affiche les informations de la dernière extraction
 */
function displayLastExtraction(data) {
  const metadata = data.metadata || {};

  // Date d'extraction
  if (metadata.date_extraction) {
    const date = new Date(metadata.date_extraction);
    elements.lastDate.textContent = date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Nombre de bénévoles
  elements.lastBenevoles.textContent = `${data.benevoles?.length || 0} bénévoles`;

  // Période
  if (metadata.periode) {
    const debut = metadata.periode.debut || '';
    const fin = metadata.periode.fin || '';
    elements.lastPeriode.textContent = `${debut} au ${fin}`;
  }

  elements.lastExtractionSection.classList.remove('hidden');
}

/**
 * Supprime la dernière extraction
 */
async function deleteLastExtraction() {
  if (!confirm('Supprimer la dernière extraction ?')) return;

  try {
    await browser.runtime.sendMessage({ action: 'deleteLastExtraction' });
    elements.lastExtractionSection.classList.add('hidden');
  } catch (error) {
    console.error('Erreur suppression:', error);
  }
}

/**
 * Vérifie l'état de l'extraction (pour restaurer l'UI si popup rouvert)
 */
async function checkExtractionState() {
  try {
    const state = await browser.runtime.sendMessage({ action: 'getExtractionState' });

    if (state.isExtracting) {
      showSection('progress');
      updateProgress(state.progress, state.detail);
      startProgressPolling();
    }
  } catch (error) {
    console.error('Erreur état extraction:', error);
  }
}

/**
 * Met à jour l'affichage du statut de connexion
 */
function updateConnectionStatus(status, message) {
  elements.connectionStatus.className = `status ${status}`;
  elements.statusText.textContent = message;
}

/**
 * Démarre l'extraction via le background script
 */
async function startExtraction() {
  const config = {
    mode: document.querySelector('input[name="mode"]:checked').value,
    dateDebut: elements.dateDebut.value,
    dateFin: elements.dateFin.value,
    extractHeures: elements.extractHeures.checked,
    extractMissions: elements.extractMissions.checked,
    extractFormations: elements.extractFormations.checked,
    format: document.querySelector('input[name="format"]:checked').value
  };

  showSection('progress');
  updateProgress(0, 'Démarrage...');
  startProgressPolling();

  browser.runtime.sendMessage({
    action: 'startExtraction',
    config: config,
    tabId: currentTabId
  });
}

/**
 * Démarre le polling de l'état de progression
 */
function startProgressPolling() {
  if (progressInterval) {
    clearInterval(progressInterval);
  }

  progressInterval = setInterval(async () => {
    try {
      const state = await browser.runtime.sendMessage({ action: 'getExtractionState' });

      updateProgress(state.progress, state.detail);

      if (!state.isExtracting) {
        clearInterval(progressInterval);
        progressInterval = null;

        if (state.hasData) {
          elements.resultMessage.textContent =
            `Extraction terminée: ${state.data.benevoles.length} bénévoles`;
          showSection('result');
          // Mettre à jour la section "dernière extraction"
          displayLastExtraction(state.data);
        } else if (state.error) {
          elements.errorText.textContent = state.error;
          showSection('error');
        }
      }
    } catch (error) {
      console.error('Erreur polling:', error);
    }
  }, 500);
}

/**
 * Met à jour la barre de progression
 */
function updateProgress(percent, detail) {
  elements.progressFill.style.width = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressDetail.textContent = detail || 'En cours...';
}

/**
 * Annule l'extraction en cours
 */
async function cancelExtraction() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  try {
    await browser.tabs.sendMessage(currentTabId, { action: 'cancelExtraction' });
    await browser.runtime.sendMessage({ action: 'cancelExtraction' });
  } catch (error) {
    console.error('Erreur d\'annulation:', error);
  }

  resetUI();
}

/**
 * Télécharge les données via le background script
 */
async function downloadData(format) {
  try {
    const response = await browser.runtime.sendMessage({
      action: 'downloadData',
      format: format
    });

    if (!response.success) {
      console.error('Erreur téléchargement:', response.error);
      alert('Erreur: ' + response.error);
    }
  } catch (error) {
    console.error('Erreur téléchargement:', error);
  }
}

/**
 * Affiche une section et cache les autres
 */
function showSection(section) {
  // Garder la section "dernière extraction" toujours visible si elle a des données
  elements.configSection.classList.toggle('hidden', section !== 'config');
  elements.actionSection.classList.toggle('hidden', section !== 'config');
  elements.progressSection.classList.toggle('hidden', section !== 'progress');
  elements.resultSection.classList.toggle('hidden', section !== 'result');
  elements.errorSection.classList.toggle('hidden', section !== 'error');
}

/**
 * Réinitialise l'interface
 */
async function resetUI() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }

  await browser.runtime.sendMessage({ action: 'clearExtraction' });

  updateProgress(0, 'Initialisation...');
  showSection('config');
}

window.addEventListener('unload', () => {
  if (progressInterval) {
    clearInterval(progressInterval);
  }
});

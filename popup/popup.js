/**
 * Pegass Extractor - Popup Script
 * Interface utilisateur - communique avec le background script
 */

// État local
let currentTabId = null;
let progressInterval = null;
/** @type {string|null} id du bouton preset actif (data-preset) */
let activePresetId = null;

/**
 * Formate une date en YYYY-MM-DD (fuseau local)
 */
function formatLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfCalendarMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfCalendarMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function syncPresetButtons() {
  document.querySelectorAll('.period-preset').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === activePresetId);
  });
}

function clearActivePreset() {
  activePresetId = null;
  syncPresetButtons();
}

/**
 * Applique une période prédéfinie et met à jour les champs date
 */
function applyPreset(presetId) {
  const now = new Date();
  let start;
  let end;

  switch (presetId) {
    case 'month-this': {
      const endMonth = formatLocalYMD(endOfCalendarMonth(now));
      const today = formatLocalYMD(now);
      start = formatLocalYMD(startOfCalendarMonth(now));
      end = today < endMonth ? today : endMonth;
      break;
    }
    case 'month-prev': {
      const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastPrev = new Date(now.getFullYear(), now.getMonth(), 0);
      start = formatLocalYMD(firstPrev);
      end = formatLocalYMD(lastPrev);
      break;
    }
    case 'year-this':
      start = `${now.getFullYear()}-01-01`;
      end = formatLocalYMD(now);
      break;
    case 'year-prev': {
      const y = now.getFullYear() - 1;
      start = `${y}-01-01`;
      end = `${y}-12-31`;
      break;
    }
    default:
      return;
  }

  elements.dateDebut.value = start;
  elements.dateFin.value = end;
  activePresetId = presetId;
  syncPresetButtons();
}

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
  btnDeleteLast: document.getElementById('btn-delete-last'),
  btnUpdateLast: document.getElementById('btn-update-last')
};

// Initialisation
document.addEventListener('DOMContentLoaded', init);

async function init() {
  setVersion();
  applyPreset('year-this');
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
 * Configure les écouteurs d'événements
 */
function setupEventListeners() {
  document.querySelectorAll('.period-preset').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });
  elements.dateDebut.addEventListener('input', clearActivePreset);
  elements.dateFin.addEventListener('input', clearActivePreset);
  elements.dateDebut.addEventListener('change', clearActivePreset);
  elements.dateFin.addEventListener('change', clearActivePreset);

  elements.btnExtract.addEventListener('click', startExtraction);
  elements.btnCancel.addEventListener('click', cancelExtraction);
  elements.btnDownload.addEventListener('click', () => downloadData('json'));
  elements.btnReset.addEventListener('click', resetUI);
  elements.btnRetry.addEventListener('click', startExtraction);
  // Boutons dernière extraction
  elements.btnDownloadLast.addEventListener('click', () => downloadData('json'));
  elements.btnDownloadLastCsv.addEventListener('click', () => downloadData('csv'));
  elements.btnDeleteLast.addEventListener('click', deleteLastExtraction);
  elements.btnUpdateLast.addEventListener('click', startUpdateLastExtraction);
}

/**
 * Active ou désactive le bouton de mise à jour selon les données et Pegass
 */
async function refreshUpdateLastButton() {
  const btn = elements.btnUpdateLast;
  if (!btn) return;

  if (elements.lastExtractionSection.classList.contains('hidden')) {
    btn.disabled = true;
    return;
  }

  let hasSnap = false;
  try {
    const state = await browser.runtime.sendMessage({ action: 'getExtractionState' });
    hasSnap = !!(state.data?.metadata?.config_snapshot);
  } catch (error) {
    console.error('Erreur état mise à jour:', error);
  }

  btn.disabled = elements.btnExtract.disabled || !hasSnap;
  btn.title = hasSnap
    ? 'Re-extraire depuis la date de la dernière extraction jusqu’à aujourd’hui, puis fusionner (missions déjà présentes conservées une fois).'
    : 'Lancez d’abord une extraction complète avec cette version de l’extension pour activer la mise à jour.';
}

/**
 * Met à jour la dernière extraction (delta + fusion côté arrière-plan)
 */
async function startUpdateLastExtraction() {
  showSection('progress');
  updateProgress(0, 'Mise à jour...');
  startProgressPolling();

  browser.runtime.sendMessage({
    action: 'updateLastExtraction',
    tabId: currentTabId
  });
}

/**
 * Vérifie si l'utilisateur est connecté à Pegass
 */
async function checkConnection() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('pegass.croix-rouge.fr')) {
      updateConnectionStatus('disconnected', 'Ouvrez Pegass pour commencer');
      elements.btnExtract.disabled = true;
      await refreshUpdateLastButton();
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
      elements.btnExtract.disabled = true;
    }
  } catch (error) {
    console.error('Erreur de vérification:', error);
    updateConnectionStatus('error', 'Erreur de communication');
    elements.btnExtract.disabled = true;
  }

  await refreshUpdateLastButton();
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
  void refreshUpdateLastButton();
}

/**
 * Supprime la dernière extraction
 */
async function deleteLastExtraction() {
  if (!confirm('Supprimer la dernière extraction ?')) return;

  try {
    await browser.runtime.sendMessage({ action: 'deleteLastExtraction' });
    elements.lastExtractionSection.classList.add('hidden');
    void refreshUpdateLastButton();
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

        if (state.lastError) {
          elements.errorText.textContent = state.lastError;
          showSection('error');
        } else if (state.hasData) {
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
 * Télécharge les données (blob URL créé dans le popup : requis pour Chrome MV3).
 */
async function downloadData(format) {
  try {
    const response = await browser.runtime.sendMessage({
      action: 'prepareDownload',
      format
    });

    if (!response?.success) {
      const msg = response?.error || 'Téléchargement impossible';
      console.error('Erreur téléchargement:', msg);
      alert('Erreur : ' + msg);
      return;
    }

    const blob = new Blob([response.content], { type: response.mimeType });
    const url = URL.createObjectURL(blob);

    try {
      await browser.downloads.download({
        url,
        filename: response.filename,
        saveAs: true
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  } catch (error) {
    console.error('Erreur téléchargement:', error);
    alert('Erreur téléchargement : ' + error.message);
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

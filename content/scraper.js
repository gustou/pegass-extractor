/**
 * Pegass Extractor - Content Script (Scraper)
 * Extrait les données des bénévoles depuis l'API Pegass
 * Supporte deux modes : par structure et par bénévole
 * v1.2 - Ajout différenciation activités locales/externes
 */

import '../lib/browser-shim.mjs';
import {
  aggregateDataFromInscriptions,
  buildEvenementsFromActivites
} from '../lib/extraction-core.mjs';

// État du scraper
let isExtracting = false;
let shouldCancel = false;

// Configuration de l'API Pegass
const PEGASS_API_BASE = 'https://pegass.croix-rouge.fr/crf/rest';
const REQUEST_DELAY = 300;

// Cache des structures (pour éviter les requêtes en double)
const structuresCache = {};

/**
 * Déduit l'UL (id + libellé) depuis un objet utilisateur Pegass (champs variables selon versions / endpoints).
 */
function pickStructureFromProfile(user) {
  if (!user || typeof user !== 'object') {
    return { id: null, libelle: null };
  }

  const blocks = [
    user.structure,
    user.structurePrincipale,
    user.uniteLocale,
    user.ul,
    user.utilisateur?.structure
  ];

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const rawId = block.id ?? block.structureId ?? block.ulId;
    const libelle = block.libelle ?? block.nom ?? block.label;
    if (rawId != null && rawId !== '') {
      return { id: String(rawId), libelle: libelle || null };
    }
  }

  const rootId =
    user.structureId ??
    user.uniteLocaleId ??
    user.ulId ??
    user.defaultStructureId;
  if (rootId != null && rootId !== '') {
    const libelle =
      user.structureLibelle ??
      user.uniteLocaleLibelle ??
      user.libelleStructure ??
      null;
    return { id: String(rootId), libelle: libelle || null };
  }

  return { id: null, libelle: null };
}

/**
 * Extrait un objet « utilisateur » depuis les réponses API Pegass (profil, gestion des droits, page Spring).
 */
function unwrapUserPayload(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const isSpringPage =
    Array.isArray(body.content) &&
    (Object.prototype.hasOwnProperty.call(body, 'totalElements') ||
      Object.prototype.hasOwnProperty.call(body, 'totalPages') ||
      Object.prototype.hasOwnProperty.call(body, 'numberOfElements'));

  if (isSpringPage) {
    if (body.content.length === 0) {
      return null;
    }
    return body.content[0];
  }

  if (body.utilisateur && typeof body.utilisateur === 'object') {
    return body.utilisateur;
  }

  return body;
}

/**
 * Écoute les messages du popup/background
 */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'checkConnection':
      checkConnection().then(sendResponse);
      return true;

    case 'startExtraction':
      startExtraction(message.config).then(sendResponse);
      return true;

    case 'cancelExtraction':
      shouldCancel = true;
      sendResponse({ cancelled: true });
      break;
  }
});

/**
 * Vérifie si l'utilisateur est connecté à Pegass
 */
async function checkConnection() {
  try {
    const urls = [
      `${PEGASS_API_BASE}/gestiondesdroits`,
      `${PEGASS_API_BASE}/utilisateur`
    ];

    let user = null;

    for (const url of urls) {
      const response = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        continue;
      }
      const body = await response.json();
      const candidate = unwrapUserPayload(body);
      if (candidate && candidate.id != null && candidate.id !== '') {
        user = candidate;
        break;
      }
    }

    if (!user) {
      return { connected: false };
    }

    let picked = pickStructureFromProfile(user);

    if (!picked.id && user.id) {
      try {
        const fullUser = await fetchUtilisateur(user.id);
        picked = pickStructureFromProfile({ ...user, ...fullUser });
      } catch (e) {
        console.warn('Pegass Extractor: profil utilisateur détaillé indisponible', e);
      }
    }

    const uniteLocale =
      picked.libelle || user.structure?.libelle || 'Connecté';

    return {
      connected: true,
      uniteLocale,
      userId: user.id,
      structureId: picked.id
    };
  } catch (error) {
    console.error('Erreur vérification connexion:', error);
    return { connected: false };
  }
}

/**
 * Démarre l'extraction des données
 */
async function startExtraction(config) {
  if (isExtracting) {
    return { success: false, error: 'Extraction déjà en cours' };
  }

  isExtracting = true;
  shouldCancel = false;

  try {
    sendProgress(0, 'Vérification de la connexion...');
    const connectionInfo = await checkConnection();

    if (!connectionInfo.connected) {
      throw new Error('Non connecté à Pegass');
    }

    const structureId = connectionInfo.structureId;
    if (!structureId) {
      throw new Error('Impossible de déterminer votre Unité Locale depuis Pegass');
    }
    const structureName = connectionInfo.uniteLocale;

    // Mettre en cache la structure locale
    structuresCache[structureId] = structureName;

    let benevoles;
    let evenements;

    if (config.mode === 'benevole') {
      ({ benevoles, evenements } = await extractionParBenevole(config, structureId, structureName));
    } else if (config.mode === 'hybride') {
      ({ benevoles, evenements } = await extractionHybride(config, structureId, structureName));
    } else {
      ({ benevoles, evenements } = await extractionParStructure(config, structureId, structureName));
    }

    if (shouldCancel) return { success: false, error: 'Extraction annulée' };

    sendProgress(95, 'Finalisation...');

    // Calculer les stats locales vs externes
    let heuresLocales = 0;
    let heuresExternes = 0;
    for (const b of benevoles) {
      for (const m of b.missions) {
        if (m.externe) {
          heuresExternes += m.heures;
        } else {
          heuresLocales += m.heures;
        }
      }
    }

    const data = {
      metadata: {
        date_extraction: new Date().toISOString(),
        unite_locale: structureName,
        structure_id: structureId,
        mode: config.mode || 'structure',
        periode: {
          debut: config.dateDebut,
          fin: config.dateFin
        },
        config_snapshot: {
          mode: config.mode || 'structure',
          extractHeures: !!config.extractHeures,
          extractMissions: !!config.extractMissions,
          extractFormations: !!config.extractFormations,
          format: config.format || 'json'
        },
        version: '1.3.0'
      },
      benevoles: benevoles,
      evenements: evenements,
      stats: {
        total_benevoles: benevoles.length,
        total_heures: Math.round((heuresLocales + heuresExternes) * 100) / 100,
        heures_locales: Math.round(heuresLocales * 100) / 100,
        heures_externes: Math.round(heuresExternes * 100) / 100,
        total_missions: benevoles.reduce((sum, b) => sum + b.missions.length, 0),
        total_evenements: evenements.length,
        evenements_sans_inscription: evenements.filter(e => (e.inscriptions_count || 0) === 0).length
      }
    };

    sendProgress(100, 'Extraction terminée');

    return { success: true, data: data };

  } catch (error) {
    console.error('Erreur d\'extraction:', error);
    return { success: false, error: error.message };
  } finally {
    isExtracting = false;
  }
}

function emptyExtractionResult() {
  return { benevoles: [], evenements: [] };
}

/**
 * Extraction par structure (mode actuel)
 */
async function extractionParStructure(config, structureId, structureName) {
  sendProgress(5, 'Récupération des activités de la structure...');
  const activites = await fetchActivites(config.dateDebut, config.dateFin, structureId);

  if (shouldCancel) return emptyExtractionResult();

  sendProgress(10, `${activites.length} activités trouvées`);

  sendProgress(15, 'Récupération des inscriptions...');
  const { inscriptions, inscriptionCountsBySeanceId } = await fetchAllInscriptions(activites, structureId);

  if (shouldCancel) return emptyExtractionResult();

  const evenements = buildEvenementsFromActivites(
    activites,
    structureId,
    structureName,
    inscriptionCountsBySeanceId,
    structuresCache
  );

  sendProgress(50, `${inscriptions.length} inscriptions, ${evenements.length} événements`);

  const userIds = [...new Set(inscriptions.map(i => i.utilisateur?.id).filter(Boolean))];
  sendProgress(55, `${userIds.length} bénévoles identifiés`);

  sendProgress(60, 'Récupération des détails des bénévoles...');
  const utilisateurs = await fetchAllUtilisateurs(userIds);

  if (shouldCancel) return emptyExtractionResult();

  sendProgress(90, 'Agrégation des données...');
  const benevoles = aggregateDataFromInscriptions(utilisateurs, inscriptions, structureId, structureName);
  return { benevoles, evenements };
}

/**
 * Extraction hybride - Membres locaux complet + renforts externes
 * Combine les deux modes : stats complètes pour les membres locaux,
 * stats locales uniquement pour les renforts d'autres UL.
 */
async function extractionHybride(config, structureId, structureName) {
  // Étape 1: Récupérer les activités locales (comme mode Structure)
  sendProgress(5, 'Récupération des activités de la structure...');
  const activites = await fetchActivites(config.dateDebut, config.dateFin, structureId);

  if (shouldCancel) return emptyExtractionResult();

  sendProgress(10, `${activites.length} activités trouvées`);

  // Étape 2: Récupérer toutes les inscriptions aux activités locales
  sendProgress(15, 'Récupération des inscriptions...');
  const { inscriptions, inscriptionCountsBySeanceId } = await fetchAllInscriptions(activites, structureId);

  if (shouldCancel) return emptyExtractionResult();

  const evenements = buildEvenementsFromActivites(
    activites,
    structureId,
    structureName,
    inscriptionCountsBySeanceId,
    structuresCache
  );

  sendProgress(40, `${inscriptions.length} inscriptions, ${evenements.length} événements`);

  // Étape 3: Récupérer les détails de tous les utilisateurs
  const userIds = [...new Set(inscriptions.map(i => i.utilisateur?.id).filter(Boolean))];
  sendProgress(42, `${userIds.length} bénévoles identifiés`);

  sendProgress(45, 'Récupération des détails des bénévoles...');
  const utilisateurs = await fetchAllUtilisateurs(userIds);

  if (shouldCancel) return emptyExtractionResult();

  // Étape 4: Séparer les membres locaux des renforts externes
  const membresLocaux = {};
  const renforts = {};

  for (const [userId, user] of Object.entries(utilisateurs)) {
    // Vérifier si la structure de l'utilisateur correspond à la locale
    const userStructureId = user.structure?.id;
    if (userStructureId == structureId) {
      membresLocaux[userId] = user;
    } else {
      renforts[userId] = user;
    }
  }

  sendProgress(50, `${Object.keys(membresLocaux).length} membres locaux, ${Object.keys(renforts).length} renforts`);

  // Étape 5: Pour les membres locaux, récupérer TOUTES leurs activités (locales + externes)
  const benevoles = [];
  const membresIds = Object.keys(membresLocaux);

  const toutesLesSeances = {};
  const activitesARecuperer = new Set();

  for (let i = 0; i < membresIds.length; i++) {
    if (shouldCancel) break;

    const userId = membresIds[i];
    const percent = 50 + Math.round((i / membresIds.length) * 20);
    sendProgress(percent, `Séances membre ${i + 1}/${membresIds.length}`);

    try {
      const seances = await fetchSeancesUtilisateur(userId, config.dateDebut, config.dateFin);
      toutesLesSeances[userId] = seances;

      // Collecter les IDs d'activités pour récupérer leurs structures
      for (const seance of seances) {
        if (seance.activite?.id) {
          activitesARecuperer.add(seance.activite.id);
        }
      }
    } catch (error) {
      console.warn(`Erreur séances ${userId}:`, error);
      toutesLesSeances[userId] = [];
    }

    await delay(REQUEST_DELAY);
  }

  if (shouldCancel) return emptyExtractionResult();

  // Étape 6: Récupérer les infos de structure pour chaque activité unique
  sendProgress(72, 'Récupération des structures des activités...');
  const activiteIds = [...activitesARecuperer];
  const activitesInfos = {};

  for (let i = 0; i < activiteIds.length; i++) {
    if (shouldCancel) break;

    const activiteId = activiteIds[i];

    if (i % 10 === 0) {
      const percent = 72 + Math.round((i / activiteIds.length) * 10);
      sendProgress(percent, `Activité ${i + 1}/${activiteIds.length}`);
    }

    try {
      const activiteInfo = await fetchActiviteDetails(activiteId);
      activitesInfos[activiteId] = activiteInfo;

      // Récupérer le nom de la structure si pas en cache
      const structOrgId = activiteInfo.structureOrganisatrice?.id;
      if (structOrgId && !structuresCache[structOrgId]) {
        try {
          const structInfo = await fetchStructure(structOrgId);
          structuresCache[structOrgId] = structInfo.libelle || `Structure ${structOrgId}`;
        } catch (e) {
          structuresCache[structOrgId] = `Structure ${structOrgId}`;
        }
      }
    } catch (error) {
      console.warn(`Erreur activité ${activiteId}:`, error);
    }

    await delay(REQUEST_DELAY / 2);
  }

  if (shouldCancel) return emptyExtractionResult();

  // Étape 7: Agréger les données des membres locaux (avec toutes leurs activités)
  sendProgress(85, 'Agrégation membres locaux...');

  for (let i = 0; i < membresIds.length; i++) {
    const userId = membresIds[i];
    const user = membresLocaux[userId];
    const seances = toutesLesSeances[userId] || [];

    const benevole = aggregateBenevoleData(user, seances, activitesInfos, structureId, structureName);
    benevole.renfort = false; // Membre local
    benevoles.push(benevole);
  }

  // Étape 8: Agréger les renforts (seulement leurs activités locales depuis inscriptions)
  sendProgress(90, 'Agrégation renforts...');

  const renfortsAggregated = aggregateRenforts(renforts, inscriptions, structureId, structureName);
  for (const renfort of renfortsAggregated) {
    renfort.renfort = true; // Renfort externe
    benevoles.push(renfort);
  }

  // Trier par heures totales
  benevoles.sort((a, b) => b.heures.total - a.heures.total);

  sendProgress(95, `${benevoles.length} bénévoles traités`);

  return { benevoles, evenements };
}

/**
 * Agrège les données des renforts (bénévoles externes) à partir des inscriptions locales
 */
function aggregateRenforts(utilisateurs, inscriptions, localStructureId, localStructureName) {
  const renfortsMap = {};

  for (const [userId, user] of Object.entries(utilisateurs)) {
    renfortsMap[userId] = {
      id: userId,
      nivol: userId,
      nom: user.nom || 'Inconnu',
      prenom: user.prenom || '',
      email: '',
      structure: user.structure?.libelle || 'Externe',
      actif: user.actif,
      heures: { total: 0, locales: 0, externes: 0, par_mois: {}, par_type: {} },
      missions: [],
      inscriptions_count: 0
    };
  }

  for (const inscription of inscriptions) {
    const userId = inscription.utilisateur?.id;
    if (!userId || !renfortsMap[userId]) continue;

    const benevole = renfortsMap[userId];

    const debut = new Date(inscription.debut);
    const fin = new Date(inscription.fin);
    const heures = (fin - debut) / (1000 * 60 * 60);

    if (heures > 0 && heures < 24) {
      benevole.heures.total += heures;
      // Pour les renforts, les heures dans cette UL comptent comme "locales" (de leur point de vue, c'est externe, mais pour nous c'est local)
      benevole.heures.locales += heures;

      const mois = inscription.debut.substring(0, 7);
      benevole.heures.par_mois[mois] = (benevole.heures.par_mois[mois] || 0) + heures;

      const type = inscription.groupeAction || 'Autre';
      benevole.heures.par_type[type] = (benevole.heures.par_type[type] || 0) + heures;

      benevole.missions.push({
        id: inscription.id,
        activiteId: inscription.activiteId,
        nom: inscription.activiteLibelle,
        type: inscription.typeActivite,
        groupeAction: inscription.groupeAction,
        date: inscription.debut.substring(0, 10),
        debut: inscription.debut,
        fin: inscription.fin,
        heures: Math.round(heures * 100) / 100,
        statut: inscription.statut,
        role: inscription.role,
        externe: false, // Pour eux c'est externe, mais pour nous c'est local (activité de l'UL)
        structure: localStructureName,
        structureId: localStructureId
      });

      benevole.inscriptions_count++;
    }
  }

  // Arrondir et retourner seulement ceux avec des heures
  return Object.values(renfortsMap)
    .filter(b => b.heures.total > 0)
    .map(b => ({
      ...b,
      heures: {
        total: Math.round(b.heures.total * 100) / 100,
        locales: Math.round(b.heures.locales * 100) / 100,
        externes: Math.round(b.heures.externes * 100) / 100,
        par_mois: Object.fromEntries(
          Object.entries(b.heures.par_mois).map(([k, v]) => [k, Math.round(v * 100) / 100])
        ),
        par_type: Object.fromEntries(
          Object.entries(b.heures.par_type).map(([k, v]) => [k, Math.round(v * 100) / 100])
        )
      }
    }));
}

/**
 * Extraction par bénévole - récupère TOUTES les activités (y compris externes)
 */
async function extractionParBenevole(config, structureId, structureName) {
  // Étape 1: Récupérer les bénévoles de la structure via les activités
  sendProgress(5, 'Identification des bénévoles de la structure...');
  const activites = await fetchActivites(config.dateDebut, config.dateFin, structureId);

  if (shouldCancel) return emptyExtractionResult();

  sendProgress(15, 'Récupération des inscriptions locales...');
  const { inscriptions: inscriptionsLocales, inscriptionCountsBySeanceId } =
    await fetchAllInscriptions(activites, structureId);

  if (shouldCancel) return emptyExtractionResult();

  const evenements = buildEvenementsFromActivites(
    activites,
    structureId,
    structureName,
    inscriptionCountsBySeanceId,
    structuresCache
  );

  const userIds = [...new Set(inscriptionsLocales.map(i => i.utilisateur?.id).filter(Boolean))];
  sendProgress(25, `${userIds.length} bénévoles identifiés`);

  // Étape 2: Pour chaque bénévole, récupérer TOUTES ses séances
  sendProgress(30, 'Récupération de toutes les activités des bénévoles...');

  const benevoles = [];
  const activitesARecuperer = new Set();

  // Collecter toutes les séances de tous les bénévoles
  const toutesLesSeances = {};

  for (let i = 0; i < userIds.length; i++) {
    if (shouldCancel) break;

    const userId = userIds[i];
    const percent = 30 + Math.round((i / userIds.length) * 30);
    sendProgress(percent, `Séances bénévole ${i + 1}/${userIds.length}`);

    try {
      const seances = await fetchSeancesUtilisateur(userId, config.dateDebut, config.dateFin);
      toutesLesSeances[userId] = seances;

      // Collecter les IDs d'activités pour récupérer leurs structures
      for (const seance of seances) {
        if (seance.activite?.id) {
          activitesARecuperer.add(seance.activite.id);
        }
      }
    } catch (error) {
      console.warn(`Erreur séances ${userId}:`, error);
      toutesLesSeances[userId] = [];
    }

    await delay(REQUEST_DELAY);
  }

  if (shouldCancel) return emptyExtractionResult();

  // Étape 3: Récupérer les infos de structure pour chaque activité unique
  sendProgress(65, 'Récupération des structures des activités...');
  const activiteIds = [...activitesARecuperer];
  const activitesInfos = {};

  for (let i = 0; i < activiteIds.length; i++) {
    if (shouldCancel) break;

    const activiteId = activiteIds[i];
    const percent = 65 + Math.round((i / activiteIds.length) * 15);

    if (i % 10 === 0) {
      sendProgress(percent, `Activité ${i + 1}/${activiteIds.length}`);
    }

    try {
      const activiteInfo = await fetchActiviteDetails(activiteId);
      activitesInfos[activiteId] = activiteInfo;

      // Récupérer le nom de la structure si pas en cache
      const structOrgId = activiteInfo.structureOrganisatrice?.id;
      if (structOrgId && !structuresCache[structOrgId]) {
        try {
          const structInfo = await fetchStructure(structOrgId);
          structuresCache[structOrgId] = structInfo.libelle || `Structure ${structOrgId}`;
        } catch (e) {
          structuresCache[structOrgId] = `Structure ${structOrgId}`;
        }
      }
    } catch (error) {
      console.warn(`Erreur activité ${activiteId}:`, error);
    }

    await delay(REQUEST_DELAY / 2); // Plus rapide car moins de données
  }

  if (shouldCancel) return emptyExtractionResult();

  // Étape 4: Récupérer les détails de chaque bénévole et agréger
  sendProgress(82, 'Agrégation des données...');

  for (let i = 0; i < userIds.length; i++) {
    if (shouldCancel) break;

    const userId = userIds[i];
    const percent = 82 + Math.round((i / userIds.length) * 10);
    sendProgress(percent, `Finalisation ${i + 1}/${userIds.length}`);

    try {
      const user = await fetchUtilisateur(userId);
      const seances = toutesLesSeances[userId] || [];

      const benevole = aggregateBenevoleData(user, seances, activitesInfos, structureId, structureName);
      benevoles.push(benevole);
    } catch (error) {
      console.warn(`Erreur bénévole ${userId}:`, error);
    }

    await delay(REQUEST_DELAY / 2);
  }

  benevoles.sort((a, b) => b.heures.total - a.heures.total);

  return { benevoles, evenements };
}

/**
 * Récupère les détails d'une activité (pour la structure)
 */
async function fetchActiviteDetails(activiteId) {
  const url = `${PEGASS_API_BASE}/activite/${activiteId}`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Erreur activité: ${response.status}`);
  }

  return await response.json();
}

/**
 * Récupère les infos d'une structure
 */
async function fetchStructure(structureId) {
  const url = `${PEGASS_API_BASE}/structure/${structureId}`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Erreur structure: ${response.status}`);
  }

  return await response.json();
}

/**
 * Récupère les séances d'un utilisateur
 */
async function fetchSeancesUtilisateur(userId, dateDebut, dateFin) {
  const url = `${PEGASS_API_BASE}/utilisateur/seance?utilisateurId=${userId}&debut=${dateDebut}&fin=${dateFin}&page=0&pageInfo=true&size=2147483647`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Erreur séances: ${response.status}`);
  }

  const data = await response.json();
  return data.content || data || [];
}

/**
 * Agrège les données d'un bénévole avec distinction locale/externe
 */
function aggregateBenevoleData(user, seances, activitesInfos, localStructureId, localStructureName) {
  const heures = {
    total: 0,
    locales: 0,
    externes: 0,
    par_mois: {},
    par_type: {}
  };

  const missions = [];

  for (const seance of seances) {
    const debut = new Date(seance.debut);
    const fin = new Date(seance.fin);
    const duree = (fin - debut) / (1000 * 60 * 60);

    if (duree > 0 && duree < 24) {
      // Déterminer si l'activité est locale ou externe
      const activiteId = seance.activite?.id;
      const activiteInfo = activitesInfos[activiteId];
      const structOrgId = activiteInfo?.structureOrganisatrice?.id;
      const isExterne = structOrgId && structOrgId != localStructureId;
      const structureName = structOrgId ? (structuresCache[structOrgId] || `Structure ${structOrgId}`) : localStructureName;

      heures.total += duree;
      if (isExterne) {
        heures.externes += duree;
      } else {
        heures.locales += duree;
      }

      // Par mois
      const mois = seance.debut.substring(0, 7);
      heures.par_mois[mois] = (heures.par_mois[mois] || 0) + duree;

      // Par type
      const type = seance.groupeAction?.libelle || 'Autre';
      heures.par_type[type] = (heures.par_type[type] || 0) + duree;

      missions.push({
        id: seance.id,
        activiteId: activiteId || '',
        nom: seance.activite?.libelle || 'Activité',
        type: seance.activite?.type || '',
        groupeAction: type,
        date: seance.debut.substring(0, 10),
        debut: seance.debut,
        fin: seance.fin,
        heures: Math.round(duree * 100) / 100,
        adresse: seance.adresse || '',
        externe: isExterne,
        structure: structureName,
        structureId: structOrgId || localStructureId
      });
    }
  }

  // Arrondir
  heures.total = Math.round(heures.total * 100) / 100;
  heures.locales = Math.round(heures.locales * 100) / 100;
  heures.externes = Math.round(heures.externes * 100) / 100;

  for (const key in heures.par_mois) {
    heures.par_mois[key] = Math.round(heures.par_mois[key] * 100) / 100;
  }
  for (const key in heures.par_type) {
    heures.par_type[key] = Math.round(heures.par_type[key] * 100) / 100;
  }

  // Trier missions par date
  missions.sort((a, b) => b.date.localeCompare(a.date));

  return {
    id: user.id,
    nivol: user.id,
    nom: user.nom || 'Inconnu',
    prenom: user.prenom || '',
    structure: user.structure?.libelle || '',
    actif: user.actif,
    heures: heures,
    missions: missions,
    inscriptions_count: missions.length
  };
}

// ============================================
// Fonctions existantes (mode par structure)
// ============================================

async function fetchActivites(dateDebut, dateFin, structureId) {
  const url = `${PEGASS_API_BASE}/activite?debut=${dateDebut}&fin=${dateFin}&structure=${structureId}`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Erreur activités: ${response.status}`);
  }

  return await response.json();
}

async function fetchAllInscriptions(activites, structureId) {
  const allInscriptions = [];
  const inscriptionCountsBySeanceId = {};

  const seances = [];
  for (const activite of activites) {
    if (activite.seanceList) {
      for (const seance of activite.seanceList) {
        seances.push({
          seanceId: seance.id,
          activiteId: activite.id,
          activiteLibelle: activite.libelle,
          typeActivite: activite.typeActivite?.libelle,
          groupeAction: activite.typeActivite?.groupeAction?.libelle,
          debut: seance.debut,
          fin: seance.fin
        });
      }
    }
  }

  sendProgress(20, `${seances.length} séances à traiter...`);

  for (let i = 0; i < seances.length; i++) {
    if (shouldCancel) break;

    const seance = seances[i];
    const percent = 20 + Math.round((i / seances.length) * 25);
    sendProgress(percent, `Séance ${i + 1}/${seances.length}`);

    try {
      const inscriptions = await fetchInscriptions(seance.seanceId, structureId);
      inscriptionCountsBySeanceId[String(seance.seanceId)] = inscriptions.length;

      for (const inscription of inscriptions) {
        allInscriptions.push({
          ...inscription,
          activiteId: seance.activiteId,
          activiteLibelle: seance.activiteLibelle,
          typeActivite: seance.typeActivite,
          groupeAction: seance.groupeAction
        });
      }
    } catch (error) {
      console.warn(`Erreur séance ${seance.seanceId}:`, error);
      inscriptionCountsBySeanceId[String(seance.seanceId)] = 0;
    }

    await delay(REQUEST_DELAY);
  }

  return { inscriptions: allInscriptions, inscriptionCountsBySeanceId };
}

async function fetchInscriptions(seanceId, structureId) {
  const url = `${PEGASS_API_BASE}/seance/${seanceId}/inscription?structure=${structureId}`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Erreur inscriptions: ${response.status}`);
  }

  return await response.json();
}

async function fetchAllUtilisateurs(userIds) {
  const utilisateurs = {};

  for (let i = 0; i < userIds.length; i++) {
    if (shouldCancel) break;

    const userId = userIds[i];
    const percent = 60 + Math.round((i / userIds.length) * 25);
    sendProgress(percent, `Bénévole ${i + 1}/${userIds.length}`);

    try {
      const user = await fetchUtilisateur(userId);
      if (user) {
        utilisateurs[userId] = user;
      }
    } catch (error) {
      console.warn(`Erreur utilisateur ${userId}:`, error);
      utilisateurs[userId] = { id: userId, nom: 'Inconnu', prenom: '' };
    }

    await delay(REQUEST_DELAY);
  }

  return utilisateurs;
}

async function fetchUtilisateur(userId) {
  const url = `${PEGASS_API_BASE}/utilisateur/${userId}`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Erreur utilisateur: ${response.status}`);
  }

  return await response.json();
}

function sendProgress(percent, detail) {
  browser.runtime.sendMessage({
    action: 'progress',
    percent: percent,
    detail: detail
  }).catch(() => { });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('Pegass Extractor: Content script v1.3.0 (événements + mode hybride)');

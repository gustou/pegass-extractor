/**
 * Logique pure d'agrégation / export (testable en Node, partagée extension).
 */

export function computeSeanceHours(debut, fin) {
  if (!debut || !fin) return 0;
  const heures = (new Date(fin) - new Date(debut)) / (1000 * 60 * 60);
  if (heures <= 0 || heures >= 24) return 0;
  return Math.round(heures * 100) / 100;
}

export function resolveStructureLabel(structureId, localStructureId, localStructureName, structuresCache = {}) {
  if (structureId == null || structureId === '') {
    return localStructureName;
  }
  const id = String(structureId);
  if (id === String(localStructureId)) {
    return localStructureName;
  }
  return structuresCache[id] || `Structure ${id}`;
}

export function buildEvenementFromSeance(
  activite,
  seance,
  localStructureId,
  localStructureName,
  inscriptionsCount,
  structuresCache = {}
) {
  const orgId = activite.structureOrganisatrice?.id ?? localStructureId;
  const orgName = resolveStructureLabel(orgId, localStructureId, localStructureName, structuresCache);
  const debut = seance.debut || '';
  const fin = seance.fin || '';
  const count = inscriptionsCount ?? 0;

  return {
    id: seance.id,
    activiteId: activite.id,
    nom: activite.libelle || seance.activite?.libelle || 'Activité',
    statut: activite.statut || null,
    type: activite.typeActivite?.libelle || seance.typeActivite || '',
    groupeAction:
      activite.typeActivite?.groupeAction?.libelle ||
      seance.groupeAction?.libelle ||
      '',
    date: debut ? debut.substring(0, 10) : '',
    debut,
    fin,
    heures: computeSeanceHours(debut, fin),
    adresse: seance.adresse || '',
    structure: orgName,
    structureId: orgId != null ? String(orgId) : String(localStructureId),
    inscriptions_count: count,
    sans_inscription: count === 0
  };
}

export function buildEvenementsFromActivites(
  activites,
  localStructureId,
  localStructureName,
  inscriptionCountsBySeanceId,
  structuresCache = {}
) {
  const evenements = [];
  const counts = inscriptionCountsBySeanceId || {};

  for (const activite of activites) {
    const seanceList = activite.seanceList;
    if (!seanceList || seanceList.length === 0) {
      continue;
    }

    for (const seance of seanceList) {
      const seanceKey = String(seance.id);
      const inscriptionsCount = counts[seanceKey] ?? counts[seance.id] ?? 0;
      evenements.push(
        buildEvenementFromSeance(
          activite,
          seance,
          localStructureId,
          localStructureName,
          inscriptionsCount,
          structuresCache
        )
      );
    }
  }

  evenements.sort(
    (a, b) =>
      (b.date || '').localeCompare(a.date || '') || (b.debut || '').localeCompare(a.debut || '')
  );
  return evenements;
}

export function minYmd(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return a < b ? a : b;
}

export function maxYmd(a, b) {
  if (!a) return b || '';
  if (!b) return a || '';
  return a > b ? a : b;
}

export function recomputeHeuresFromMissions(b) {
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

export function aggregateDataFromInscriptions(utilisateurs, inscriptions, localStructureId, localStructureName) {
  const benevolesMap = {};

  for (const [userId, user] of Object.entries(utilisateurs)) {
    benevolesMap[userId] = {
      id: userId,
      nivol: userId,
      nom: user.nom || 'Inconnu',
      prenom: user.prenom || '',
      email: '',
      structure: user.structure?.libelle || '',
      actif: user.actif,
      heures: { total: 0, locales: 0, externes: 0, par_mois: {}, par_type: {} },
      missions: [],
      inscriptions_count: 0
    };
  }

  for (const inscription of inscriptions) {
    const userId = inscription.utilisateur?.id;
    if (!userId || !benevolesMap[userId]) continue;

    const benevole = benevolesMap[userId];
    const heures = computeSeanceHours(inscription.debut, inscription.fin);

    if (heures > 0) {
      benevole.heures.total += heures;
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
        heures,
        statut: inscription.statut,
        role: inscription.role,
        externe: false,
        structure: localStructureName,
        structureId: localStructureId
      });

      benevole.inscriptions_count++;
    }
  }

  const benevoles = Object.values(benevolesMap).map(b => ({
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

  benevoles.sort((a, b) => b.heures.total - a.heures.total);

  return benevoles;
}

export function mergeExtractionData(previous, delta) {
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

  const eventMap = new Map();
  for (const e of previous.evenements || []) {
    if (e && e.id != null && e.id !== '') {
      eventMap.set(String(e.id), e);
    }
  }
  for (const e of delta.evenements || []) {
    if (e && e.id != null && e.id !== '') {
      eventMap.set(String(e.id), e);
    }
  }
  const evenements = Array.from(eventMap.values());
  evenements.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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
    evenements,
    stats: {
      total_benevoles: benevoles.length,
      total_heures: Math.round((heuresLocales + heuresExternes) * 100) / 100,
      heures_locales: heuresLocales,
      heures_externes: heuresExternes,
      total_missions: totalMissions,
      total_evenements: evenements.length,
      evenements_sans_inscription: evenements.filter(ev => (ev.inscriptions_count || 0) === 0).length
    }
  };
}

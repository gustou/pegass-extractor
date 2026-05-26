import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateDataFromInscriptions,
  buildEvenementsFromActivites,
  computeSeanceHours,
  mergeExtractionData,
  minYmd,
  maxYmd,
  resolveStructureLabel
} from '../lib/extraction-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const castorActivites = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/castor-annule.json'), 'utf8')
);

describe('computeSeanceHours', () => {
  it('calcule la durée d\'une garde de 5 h', () => {
    assert.equal(
      computeSeanceHours('2026-04-30T18:00:00', '2026-04-30T23:00:00'),
      5
    );
  });

  it('retourne 0 si début et fin identiques', () => {
    assert.equal(computeSeanceHours('2026-04-30T18:00:00', '2026-04-30T18:00:00'), 0);
  });

  it('retourne 0 si durée >= 24 h', () => {
    assert.equal(
      computeSeanceHours('2026-04-30T00:00:00', '2026-05-01T00:00:00'),
      0
    );
  });
});

describe('buildEvenementsFromActivites', () => {
  it('exporte une garde annulée sans inscription', () => {
    const evenements = buildEvenementsFromActivites(
      castorActivites,
      '1160',
      'UL Exemple',
      { p3235003: 0 }
    );

    assert.equal(evenements.length, 1);
    assert.equal(evenements[0].nom, '02-CASTOR');
    assert.equal(evenements[0].statut, 'Annulée');
    assert.equal(evenements[0].inscriptions_count, 0);
    assert.equal(evenements[0].sans_inscription, true);
    assert.equal(evenements[0].heures, 5);
    assert.equal(evenements[0].id, 'p3235003');
  });

  it('ignore les activités sans seanceList', () => {
    const evenements = buildEvenementsFromActivites(
      [{ id: 'a1', libelle: 'Vide', seanceList: [] }],
      '1',
      'UL'
    );
    assert.equal(evenements.length, 0);
  });

  it('remplit inscriptions_count depuis la map', () => {
    const evenements = buildEvenementsFromActivites(
      castorActivites,
      '1160',
      'UL Exemple',
      { p3235003: 4 }
    );
    assert.equal(evenements[0].inscriptions_count, 4);
    assert.equal(evenements[0].sans_inscription, false);
  });
});

describe('resolveStructureLabel', () => {
  it('utilise le libellé local pour la structure connectée', () => {
    assert.equal(resolveStructureLabel(1160, '1160', 'UL Paris'), 'UL Paris');
  });

  it('utilise le cache pour une autre structure', () => {
    assert.equal(
      resolveStructureLabel(999, '1160', 'UL Paris', { 999: 'UL Voisine' }),
      'UL Voisine'
    );
  });
});

describe('aggregateDataFromInscriptions', () => {
  it('ne crée pas de mission sans inscription', () => {
    const benevoles = aggregateDataFromInscriptions(
      { u1: { id: 'u1', nom: 'DUPONT', prenom: 'Jean', actif: true } },
      [],
      '1160',
      'UL Exemple'
    );
    assert.equal(benevoles[0].missions.length, 0);
    assert.equal(benevoles[0].heures.total, 0);
  });

  it('agrège une inscription valide', () => {
    const benevoles = aggregateDataFromInscriptions(
      { u1: { id: 'u1', nom: 'DUPONT', prenom: 'Jean', actif: true } },
      [
        {
          id: 'ins1',
          utilisateur: { id: 'u1' },
          activiteId: 'a1',
          activiteLibelle: 'DPS',
          typeActivite: 'Secours',
          groupeAction: 'Secours',
          debut: '2026-02-15T14:00:00',
          fin: '2026-02-15T22:00:00',
          statut: 'Validée',
          role: 'PSE2'
        }
      ],
      '1160',
      'UL Exemple'
    );
    assert.equal(benevoles[0].missions.length, 1);
    assert.equal(benevoles[0].heures.total, 8);
    assert.equal(benevoles[0].missions[0].heures, 8);
  });
});

describe('mergeExtractionData', () => {
  it('fusionne les événements par id de séance', () => {
    const previous = {
      metadata: { periode: { debut: '2026-01-01', fin: '2026-03-31' } },
      benevoles: [],
      evenements: [
        {
          id: 'p1',
          nom: 'Ancien',
          inscriptions_count: 0,
          sans_inscription: true,
          date: '2026-02-01'
        }
      ],
      stats: {}
    };
    const delta = {
      metadata: { periode: { debut: '2026-04-01', fin: '2026-06-30' } },
      benevoles: [],
      evenements: [
        {
          id: 'p1',
          nom: 'Mis à jour',
          inscriptions_count: 2,
          sans_inscription: false,
          date: '2026-02-01'
        },
        {
          id: 'p3235003',
          nom: '02-CASTOR',
          statut: 'Annulée',
          inscriptions_count: 0,
          sans_inscription: true,
          date: '2026-04-30'
        }
      ],
      stats: {}
    };

    const merged = mergeExtractionData(previous, delta);

    assert.equal(merged.evenements.length, 2);
    assert.equal(merged.evenements.find(e => e.id === 'p1').nom, 'Mis à jour');
    assert.equal(merged.evenements.find(e => e.id === 'p3235003').statut, 'Annulée');
    assert.equal(merged.stats.total_evenements, 2);
    assert.equal(merged.stats.evenements_sans_inscription, 1);
    assert.equal(merged.metadata.periode.debut, '2026-01-01');
    assert.equal(merged.metadata.periode.fin, '2026-06-30');
  });
});

describe('minYmd / maxYmd', () => {
  it('minYmd et maxYmd étendent la période', () => {
    assert.equal(minYmd('2026-04-01', '2026-01-01'), '2026-01-01');
    assert.equal(maxYmd('2026-04-01', '2026-06-30'), '2026-06-30');
  });
});

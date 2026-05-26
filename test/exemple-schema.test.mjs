import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exemple = JSON.parse(
  readFileSync(join(__dirname, '..', 'exemple_extraction.json'), 'utf8')
);

describe('exemple_extraction.json', () => {
  it('contient evenements et stats associées', () => {
    assert.ok(Array.isArray(exemple.evenements));
    assert.ok(exemple.evenements.length > 0);
    assert.equal(typeof exemple.stats.total_evenements, 'number');
    assert.equal(
      exemple.stats.total_evenements,
      exemple.evenements.length
    );
    assert.equal(
      exemple.stats.evenements_sans_inscription,
      exemple.evenements.filter(e => e.sans_inscription).length
    );
  });

  it('inclut un exemple de garde annulée sans inscription', () => {
    const castor = exemple.evenements.find(e => e.nom === '02-CASTOR');
    assert.ok(castor);
    assert.equal(castor.statut, 'Annulée');
    assert.equal(castor.sans_inscription, true);
    assert.equal(castor.inscriptions_count, 0);
  });
});

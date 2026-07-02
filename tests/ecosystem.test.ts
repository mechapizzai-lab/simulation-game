/**
 * Étape 6 — l'écosystème vit sans intervention : naissances et germinations
 * compensent les morts, la mer s'étend. Le scénario complet (sans rendu)
 * tourne ici sur des dizaines de milliers de ticks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from '../src/scenario.js';
import { OnPlanet, Size, Species } from '../src/simulation/components.js';

function countKind(scenario: ReturnType<typeof buildScenario>, kind: string): number {
  let n = 0;
  for (const [entity, species] of scenario.world.query(Species)) {
    if (species.kind === kind && scenario.world.get(entity, OnPlanet)?.planet === scenario.gaia) n++;
  }
  return n;
}

test('sur 30 000 ticks, la vie persiste au-delà des espérances de vie initiales', () => {
  const scenario = buildScenario(7);
  // Les personnes initiales vivent au plus 4 000 ticks : à 30 000, toute
  // personne vivante descend forcément du cycle de naissances.
  for (let i = 0; i < 30_000; i++) scenario.world.step();
  assert.ok(countKind(scenario, 'person') > 0, 'des personnes vivent encore');
  assert.ok(countKind(scenario, 'tree') > 0, 'des arbres vivent encore');
});

test('les populations restent sous leurs plafonds écologiques', () => {
  const scenario = buildScenario(11);
  for (let i = 0; i < 20_000; i++) scenario.world.step();
  assert.ok(countKind(scenario, 'tree') <= 70);
  assert.ok(countKind(scenario, 'person') <= 30);
});

test('la mer intérieure grandit continûment jusqu\'à sa taille maximale', () => {
  const scenario = buildScenario(3);
  const lake = [...scenario.world.query(Species)].find(([, s]) => s.kind === 'lake')?.[0];
  assert.ok(lake !== undefined);
  const sizeAt = (): number => scenario.world.getRequired(lake, Size).size;
  const s0 = sizeAt();
  for (let i = 0; i < 5000; i++) scenario.world.step();
  const s1 = sizeAt();
  assert.ok(s1 > s0, 'la mer s\'étend');
  for (let i = 0; i < 15_000; i++) scenario.world.step();
  assert.equal(sizeAt(), 250, 'plafonnée à maxSize');
});

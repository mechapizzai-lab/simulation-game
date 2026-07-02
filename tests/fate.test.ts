/**
 * Étape 2 — Fate Queue : une Personne naît, son destin est pré-calculé,
 * la boucle continue le rencontre au bon tick, et le joueur peut le réécrire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/simulation/ecs.js';
import { FateQueue, createFateSystem } from '../src/simulation/fate.js';
import { Age, Lifespan } from '../src/simulation/components.js';
import { AgingSystem, GrowthSystem } from '../src/simulation/systems.js';
import {
  FATE_DEATH,
  applyLifespanEdit,
  registerStandardFates,
  spawnPerson,
} from '../src/simulation/archetypes.js';
import { Rng } from '../src/simulation/rng.js';

function makeSim(): { world: World; fate: FateQueue; rng: Rng } {
  const world = new World();
  const fate = new FateQueue();
  registerStandardFates(fate);
  world.addSystem(createFateSystem(fate)); // le destin se réalise avant tout le reste
  world.addSystem(AgingSystem);
  world.addSystem(GrowthSystem);
  return { world, fate, rng: new Rng(42) };
}

test('une Personne naît et meurt exactement au tick prévu par son destin', () => {
  const { world, fate, rng } = makeSim();
  const deaths: number[] = [];
  world.onEvent((ev) => {
    if (ev.kind === 'death') deaths.push(ev.tick);
  });

  const alice = spawnPerson(world, fate, { x: 0, y: 0, lifespan: 100, rng });
  assert.equal(fate.eventsFor(alice).some((e) => e.kind === FATE_DEATH && e.tick === 100), true);

  for (let i = 0; i < 99; i++) world.step();
  assert.equal(world.isAlive(alice), true, 'vivante au tick 99');
  assert.equal(world.getRequired(alice, Age).ticks, 99, 'a vieilli continûment');

  world.step(); // tick 100 : la boucle rencontre l'événement de mort
  assert.equal(world.isAlive(alice), false, 'morte au tick 100');
  assert.deepEqual(deaths, [100]);
  assert.equal(fate.eventsFor(alice).length, 0, 'destin consommé');
});

test('le joueur peut lire la timeline du destin (triée par tick)', () => {
  const { world, fate, rng } = makeSim();
  const bob = spawnPerson(world, fate, { x: 0, y: 0, lifespan: 200, rng });
  const timeline = fate.eventsFor(bob);
  assert.deepEqual(
    timeline.map((e) => [e.kind, e.tick]),
    [['maturity', 40], ['death', 200]],
  );
});

test('réécrire le destin : allonger la vie repousse la mort', () => {
  const { world, fate, rng } = makeSim();
  const carol = spawnPerson(world, fate, { x: 0, y: 0, lifespan: 50, rng });
  for (let i = 0; i < 30; i++) world.step();

  applyLifespanEdit(world, fate, carol, 500); // intervention divine au tick 30
  assert.equal(world.getRequired(carol, Lifespan).max, 500);
  const death = fate.eventsFor(carol).find((e) => e.kind === FATE_DEATH);
  assert.equal(death?.tick, 500); // 30 + (500 - 30 d'âge)

  for (let i = 0; i < 100; i++) world.step(); // tick 130, bien après l'ancienne mort (50)
  assert.equal(world.isAlive(carol), true, 'sauvée de son destin initial');
});

test('réécrire le destin : raccourcir la vie sous l\'âge actuel tue au tick suivant', () => {
  const { world, fate, rng } = makeSim();
  const dave = spawnPerson(world, fate, { x: 0, y: 0, lifespan: 1000, rng });
  for (let i = 0; i < 300; i++) world.step();

  applyLifespanEdit(world, fate, dave, 100); // 100 < 300 ticks déjà vécus
  world.step();
  assert.equal(world.isAlive(dave), false);
});

test('les événements annulés ne se réalisent jamais', () => {
  const { world, fate, rng } = makeSim();
  const eve = spawnPerson(world, fate, { x: 0, y: 0, lifespan: 10, rng });
  const death = fate.eventsFor(eve).find((e) => e.kind === FATE_DEATH);
  assert.ok(death);
  fate.cancel(death.id); // immortalité accordée
  for (let i = 0; i < 50; i++) world.step();
  assert.equal(world.isAlive(eve), true);
});

test('plusieurs événements le même tick se réalisent tous, en ordre d\'insertion', () => {
  const { world, fate } = makeSim();
  const order: string[] = [];
  fate.onKind('a', () => order.push('a'));
  fate.onKind('b', () => order.push('b'));
  const e = world.createEntity();
  fate.schedule(5, e, 'a');
  fate.schedule(5, e, 'b');
  fate.schedule(3, e, 'b');
  for (let i = 0; i < 6; i++) world.step();
  assert.deepEqual(order, ['b', 'a', 'b']);
});

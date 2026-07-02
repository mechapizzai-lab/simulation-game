/**
 * Étape 1 — le moteur ECS tourne en console, sans rendu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/simulation/ecs.js';
import { Age, GrowthRate, Position, Size, Velocity } from '../src/simulation/components.js';
import { AgingSystem, GrowthSystem, MovementSystem } from '../src/simulation/systems.js';

function makeWorld(): World {
  const world = new World();
  world.addSystem(AgingSystem);
  world.addSystem(GrowthSystem);
  world.addSystem(MovementSystem);
  return world;
}

test('les components évoluent de façon continue à chaque tick', () => {
  const world = makeWorld();
  const tree = world.createEntity();
  world.add(tree, Age, { ticks: 0 });
  world.add(tree, Size, { size: 1 });
  world.add(tree, GrowthRate, { perTick: 0.5, maxSize: 10 });
  world.add(tree, Position, { x: 0, y: 0 });
  world.add(tree, Velocity, { vx: 2, vy: -1 });

  for (let i = 0; i < 5; i++) world.step();

  assert.equal(world.tick, 5);
  assert.equal(world.getRequired(tree, Age).ticks, 5);
  assert.equal(world.getRequired(tree, Size).size, 3.5); // 1 + 5 × 0.5
  assert.deepEqual(world.getRequired(tree, Position), { x: 10, y: -5 });
});

test('la croissance plafonne à maxSize', () => {
  const world = makeWorld();
  const tree = world.createEntity();
  world.add(tree, Size, { size: 9.9 });
  world.add(tree, GrowthRate, { perTick: 0.5, maxSize: 10 });
  for (let i = 0; i < 3; i++) world.step();
  assert.equal(world.getRequired(tree, Size).size, 10);
});

test('détruire une entité retire tous ses components', () => {
  const world = makeWorld();
  const e = world.createEntity();
  world.add(e, Age, { ticks: 0 });
  world.destroyEntity(e);
  assert.equal(world.isAlive(e), false);
  assert.equal(world.get(e, Age), undefined);
  world.step(); // ne doit pas planter sur une entité morte
});

test('100 ticks à la suite == même état que 100 ticks espacés (vitesse = fréquence, pas logique)', () => {
  const build = (): World => {
    const w = makeWorld();
    const e = w.createEntity();
    w.add(e, Size, { size: 0 });
    w.add(e, GrowthRate, { perTick: 0.1, maxSize: 100 });
    return w;
  };
  const fast = build();
  for (let i = 0; i < 100; i++) fast.step(); // "x100" : rafale
  const slow = build();
  for (let i = 0; i < 100; i++) slow.step(); // "x1" : la boucle appelle step 100 fois aussi, juste étalées

  const sizeOf = (w: World): number => [...w.query(Size)].map(([, s]) => s.size)[0] ?? -1;
  assert.equal(sizeOf(fast), sizeOf(slow));
});

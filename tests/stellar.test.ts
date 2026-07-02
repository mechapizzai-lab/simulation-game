/**
 * Phase A — l'univers instable : classes stellaires, mort écrite à
 * l'allumage, supernova (stérilise près, ensemence loin, laisse un vestige),
 * trous noirs accréteurs, nature des planètes, bouclier jovien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoidScenario } from '../src/scenario.js';
import {
  BLACK_HOLE_DECAY,
  FATE_IMPACT,
  FATE_STAR_DEATH,
  FATE_SUPERNOVA,
  countKind,
  RULE_AGGREGATION,
  RULE_FUSION,
  RULE_GRAVITY,
  RULE_MATTER,
  RULE_SPACE,
  RULE_TIME,
} from '../src/simulation/cosmos.js';
import {
  Chemistry,
  Habitable,
  Hazard,
  Mass,
  OnPlanet,
  Orbit,
  PlanetKind,
  Position,
  Size,
  Species,
  StellarClass,
  Temperature,
} from '../src/simulation/components.js';
import type { EntityId, World } from '../src/simulation/ecs.js';

function makeSim(seed = 7): ReturnType<typeof buildVoidScenario> {
  const s = buildVoidScenario(seed, { hazards: false, temperamentId: 'calm' });
  s.engine.capacity = 100;
  for (const id of [RULE_TIME, RULE_SPACE, RULE_MATTER, RULE_GRAVITY, RULE_AGGREGATION, RULE_FUSION]) {
    s.engine.activate(id, s.world);
  }
  return s;
}

function craftClump(world: World, mass: number, x = 0, y = 0): EntityId {
  const e = world.createEntity();
  world.add(e, Species, { kind: 'clump', label: 'Amas' });
  world.add(e, Position, { x, y });
  world.add(e, Mass, { mass });
  world.add(e, Size, { size: 4 });
  return e;
}

function craftWorldAround(
  world: World,
  center: EntityId,
  radius: number,
  opts: { life?: boolean } = {},
): EntityId {
  const planet = world.createEntity();
  world.add(planet, Species, { kind: 'planet', label: 'Monde' });
  const cpos = world.getRequired(center, Position);
  world.add(planet, Position, { x: cpos.x + radius, y: cpos.y });
  world.add(planet, Size, { size: 3 });
  world.add(planet, Mass, { mass: 10 });
  world.add(planet, PlanetKind, { kind: 'rocky' });
  world.add(planet, Orbit, { center, radius, angularSpeed: 0.9 / radius, phase: 0 });
  world.add(planet, Temperature, { current: 100, coolingPerTick: 0 });
  if (opts.life) {
    world.add(planet, Habitable, { sinceTick: 0 });
    for (let i = 0; i < 4; i++) {
      const p = world.createEntity();
      world.add(p, Species, { kind: 'person', label: 'Personne' });
      world.add(p, Position, { x: i * 10, y: 0 });
      world.add(p, OnPlanet, { planet });
    }
  }
  return planet;
}

test('la classe et la MORT d\'une étoile s\'écrivent à son allumage', () => {
  const s = makeSim();
  const { world, fate } = s;
  const giant = craftClump(world, 300, -200, 0);
  const dwarf = craftClump(world, 30, 200, 0);
  // Franchir le seuil → allumage écrit (+250 ticks), puis réalisation.
  for (let i = 0; i < 300; i++) world.step();

  assert.equal(world.get(giant, Species)?.label, 'Géante bleue');
  assert.equal(world.get(giant, StellarClass)?.className, 'giant');
  const doom = fate.eventsFor(giant).find((e) => e.kind === FATE_SUPERNOVA);
  assert.ok(doom, 'la supernova de la géante est écrite dans sa timeline dès sa naissance');
  assert.ok(doom.tick <= world.tick + 14_000, 'et elle est proche');

  assert.equal(world.get(dwarf, Species)?.label, 'Naine rouge');
  const quiet = fate.eventsFor(dwarf).find((e) => e.kind === FATE_STAR_DEATH);
  assert.ok(quiet, 'la naine mourra tranquillement...');
  assert.ok(quiet.tick >= world.tick + 79_000, '...dans très longtemps');
});

test('supernova : stérilise près, ENSEMENCE loin, et laisse un trou noir si massive', () => {
  const s = makeSim();
  const { world, fate } = s;
  const star = craftClump(world, 300, 0, 0);
  for (let i = 0; i < 300; i++) world.step(); // allumage
  const near = craftWorldAround(world, star, 100, { life: true });
  const far = craftWorldAround(world, star, 300);
  assert.equal(countKind(world, 'person'), 4);

  // On avance le destin : la supernova éclate dans 100 ticks.
  const doom = fate.eventsFor(star).find((e) => e.kind === FATE_SUPERNOVA);
  assert.ok(doom);
  fate.reschedule(doom.id, world.tick + 100);
  for (let i = 0; i < 150; i++) world.step();

  assert.equal(countKind(world, 'person'), 0, 'le monde proche est soufflé');
  assert.equal(world.has(near, Habitable), false);
  assert.ok((world.get(far, Chemistry)?.richness ?? 0) >= 0.8, 'le monde lointain est ensemencé');
  assert.equal(world.get(star, Species)?.kind, 'blackhole', 'masse 300 ≥ 220 : trou noir');
  assert.equal(world.getRequired(near, Orbit).center, star, 'les mondes orbitent le vestige');
});

test('le trou noir accrète : les orbites décroissent et le monde englouti le nourrit', () => {
  const s = makeSim();
  const { world, fate } = s;
  const star = craftClump(world, 300, 0, 0);
  for (let i = 0; i < 300; i++) world.step();
  const victim = craftWorldAround(world, star, 40);
  const doom = fate.eventsFor(star).find((e) => e.kind === FATE_SUPERNOVA);
  assert.ok(doom);
  fate.reschedule(doom.id, world.tick + 10);
  for (let i = 0; i < 20; i++) world.step();
  assert.equal(world.get(star, Species)?.kind, 'blackhole');

  const massBefore = world.getRequired(star, Mass).mass;
  const r0 = world.getRequired(victim, Orbit).radius;
  for (let i = 0; i < 1000; i++) world.step();
  assert.ok(world.getRequired(victim, Orbit).radius < r0 - BLACK_HOLE_DECAY * 900, 'l\'orbite décroît');
  // 40 → ~taille du TN (+3) à 0.004/tick : englouti en < 9000 ticks.
  for (let i = 0; i < 9000; i++) world.step();
  assert.equal(world.isAlive(victim), false, 'le monde est tombé dedans');
  assert.ok(world.getRequired(star, Mass).mass > massBefore, 'et le trou noir a grossi');
});

test('la nature des planètes se décide à la capture : géante gazeuse, rocheuse, glace', () => {
  const s = makeSim();
  const { world } = s;
  const star = craftClump(world, 100, 0, 0); // jaune (60 ≤ 100 < 140), luminosité 1
  for (let i = 0; i < 300; i++) world.step();
  assert.equal(world.get(star, StellarClass)?.className, 'yellow');
  // Amas candidats : massif (gas), léger proche (rocky), léger très loin (ice).
  const heavy = craftClump(world, 20, 150, 0);
  const light = craftClump(world, 10, -160, 0);
  const cold = craftClump(world, 10, 0, 400);
  for (let i = 0; i < 5; i++) world.step(); // la Fusion capture

  assert.equal(world.get(heavy, PlanetKind)?.kind, 'gas');
  assert.match(world.get(heavy, Species)?.label ?? '', /Géante-/);
  assert.equal(world.get(light, PlanetKind)?.kind, 'rocky');
  assert.equal(world.get(cold, PlanetKind)?.kind, 'ice', 'au-delà de 220 × 1.4 : monde gelé');
});

test('bouclier jovien : une géante gazeuse du système peut dévier les astéroïdes', () => {
  // 20 astéroïdes sur un système AVEC géante : au moins un doit être dévié
  // (35 % de chance chacun, RNG seedé → résultat déterministe).
  const s = makeSim(11);
  const { world, fate } = s;
  const star = craftClump(world, 100, 0, 0);
  for (let i = 0; i < 300; i++) world.step();
  const target = craftWorldAround(world, star, 150);
  const giant = craftClump(world, 20, 200, 0);
  for (let i = 0; i < 5; i++) world.step();
  assert.equal(world.get(giant, PlanetKind)?.kind, 'gas');

  let shielded = 0;
  let impacts = 0;
  world.onEvent((e) => {
    if (e.kind === 'hazard-shielded') shielded++;
    if (e.kind === 'hazard-impact') impacts++;
  });
  for (let round = 0; round < 20; round++) {
    const impactTick = world.tick + 200;
    const eventId = fate.schedule(impactTick, target, FATE_IMPACT);
    const asteroid = world.createEntity();
    world.add(asteroid, Species, { kind: 'asteroid', label: 'Astéroïde' });
    world.add(asteroid, Position, { x: 500, y: 500 });
    world.add(asteroid, Size, { size: 2 });
    world.add(asteroid, Hazard, {
      eventId,
      target,
      bornTick: world.tick,
      fromX: 500,
      fromY: 500,
      impactTick,
      shieldChecked: false,
    });
    for (let i = 0; i < 220; i++) world.step();
  }
  assert.ok(shielded >= 2, `la géante a dévié des astéroïdes (${shielded}/20)`);
  assert.ok(impacts >= 2, `mais pas tous (${impacts}/20 impacts) — pas de réussite forcée`);
  assert.equal(shielded + impacts, 20, 'chaque astéroïde a un sort');
});

test('zone habitable × luminosité : la naine rouge resserre la zone', () => {
  const s = makeSim();
  const { world, engine } = s;
  engine.activate('chemistry', world);
  const dwarf = craftClump(world, 30, 0, 0); // naine : luminosité 0.6 → zone 60–132
  for (let i = 0; i < 300; i++) world.step();
  assert.equal(world.get(dwarf, StellarClass)?.className, 'dwarf');
  const inOld = craftWorldAround(world, dwarf, 150); // dans la zone "standard", HORS zone naine
  const inNew = craftWorldAround(world, dwarf, 110); // dans la zone naine
  world.add(inOld, Chemistry, { richness: 2 });
  world.add(inNew, Chemistry, { richness: 2 });
  engine.activate('life-conditions', world);
  for (let i = 0; i < 4000; i++) world.step();
  assert.equal(world.has(inOld, Habitable), false, '150 > 132 : trop loin pour une naine');
  assert.equal(world.has(inNew, Habitable), true, '110 : dans la zone resserrée');
});

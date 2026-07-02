/**
 * Phase 2 (2.1 + 2.2) — la donne de l'univers et la terraformation :
 * chaque seed tire un tempérament qui change le problème posé, et déplacer
 * un monde est un acte payant, progressif et salvateur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoidScenario } from '../src/scenario.js';
import { TEMPERAMENTS, temperamentFor } from '../src/simulation/temperament.js';
import {
  RULE_CHEMISTRY,
  RULE_CONDITIONS,
  RULE_MATTER,
  RULE_SPACE,
  RULE_TIME,
  TERRAFORM_ORBIT_COST,
  countKind,
} from '../src/simulation/cosmos.js';
import {
  Chemistry,
  Habitable,
  Mass,
  OnPlanet,
  Orbit,
  OrbitMigration,
  Position,
  Size,
  Species,
  Temperature,
} from '../src/simulation/components.js';
import type { EntityId, World } from '../src/simulation/ecs.js';

function craftPlanet(world: World, radius: number): EntityId {
  const star = world.createEntity();
  world.add(star, Species, { kind: 'star', label: 'Étoile' });
  world.add(star, Position, { x: 0, y: 0 });
  world.add(star, Size, { size: 8 });
  world.add(star, Mass, { mass: 140 });
  const planet = world.createEntity();
  world.add(planet, Species, { kind: 'planet', label: 'Monde-Test' });
  world.add(planet, Position, { x: radius, y: 0 });
  world.add(planet, Size, { size: 3 });
  world.add(planet, Mass, { mass: 12 });
  world.add(planet, Orbit, { center: star, radius, angularSpeed: 0.9 / radius, phase: 0 });
  world.add(planet, Temperature, { current: 100, coolingPerTick: 0 });
  world.add(planet, Chemistry, { richness: 2 });
  return planet;
}

test('la seed tire un tempérament déterministe, et les seeds couvrent la variété', () => {
  const a = temperamentFor(12345);
  const b = temperamentFor(12345);
  assert.equal(a.id, b.id, 'même seed, même donne');
  const seen = new Set<string>();
  for (let seed = 1; seed <= 200; seed++) seen.add(temperamentFor(seed).id);
  assert.equal(seen.size, TEMPERAMENTS.length, 'tous les tempéraments sortent sur 200 seeds');
});

test('le tempérament change la DONNE : défauts de Matière et zone habitable', () => {
  const scarce = buildVoidScenario(1, { temperamentId: 'scarce' });
  assert.equal(scarce.engine.param(RULE_MATTER, 'massBudget'), 420);
  assert.equal(scarce.engine.param(RULE_MATTER, 'rate'), 5);
  const calm = buildVoidScenario(1, { temperamentId: 'calm' });
  assert.equal(calm.engine.param(RULE_MATTER, 'massBudget'), 900);
  const shifted = buildVoidScenario(1, { temperamentId: 'shifted' });
  assert.match(
    shifted.engine.get(RULE_CONDITIONS).description,
    /240–380/,
    'la promesse faite au joueur reflète la vraie zone',
  );
});

test('étoile vorace : les orbites décroissent et le monde finit avalé, avec ses vies', () => {
  const s = buildVoidScenario(3, { hazards: false, temperamentId: 'voracious' });
  const { world } = s;
  const planet = craftPlanet(world, 40);
  const p = world.createEntity();
  world.add(p, Species, { kind: 'person', label: 'Personne' });
  world.add(p, Position, { x: 0, y: 0 });
  world.add(p, OnPlanet, { planet });
  let consumed: { souls: number } | null = null;
  world.onEvent((e) => {
    if (e.kind === 'planet-consumed') consumed = e.data as { souls: number };
  });

  const r0 = world.getRequired(planet, Orbit).radius;
  for (let i = 0; i < 2000; i++) world.step();
  assert.ok(world.getRequired(planet, Orbit).radius < r0, 'l\'orbite décroît');
  // 40 → 11 (taille étoile 8 + 3) à 0.0025/tick ≈ 11 600 ticks.
  for (let i = 0; i < 14000; i++) world.step();
  assert.equal(world.isAlive(planet), false, 'le monde est tombé dans l\'étoile');
  assert.equal(world.isAlive(p), false, 'ses habitants avec lui');
  // (assertion de type : TS ne suit pas les affectations faites dans l'écouteur)
  assert.equal((consumed as { souls: number } | null)?.souls, 1, 'le journal connaît le bilan');
});

test('la migration d\'orbite est progressive et CONTINUE (le monde spirale, il ne saute pas)', () => {
  const s = buildVoidScenario(3, { hazards: false, temperamentId: 'calm' });
  const { world } = s;
  const planet = craftPlanet(world, 300);
  world.add(planet, OrbitMigration, { targetRadius: 180 });

  let maxJump = 0;
  let prev = { ...world.getRequired(planet, Position) };
  let completed = false;
  world.onEvent((e) => {
    if (e.kind === 'terraform-complete' && e.entity === planet) completed = true;
  });
  for (let i = 0; i < 3000 && !completed; i++) {
    world.step();
    const pos = world.getRequired(planet, Position);
    maxJump = Math.max(maxJump, Math.hypot(pos.x - prev.x, pos.y - prev.y));
    prev = { ...pos };
  }
  assert.equal(completed, true, 'migration terminée (120 unités à 0.06/tick)');
  const orbit = world.getRequired(planet, Orbit);
  assert.equal(orbit.radius, 180);
  assert.ok(Math.abs(orbit.angularSpeed - 0.9 / 180) < 1e-9, 'la vitesse angulaire suit la loi de capture');
  assert.ok(maxJump < 2, `jamais de téléportation (saut max par tick : ${maxJump.toFixed(3)} unités)`);
  assert.equal(world.has(planet, OrbitMigration), false, 'le chantier est refermé');
});

test('sauver un run par terraformation : hors zone, un monde migré devient habitable', () => {
  const s = buildVoidScenario(3, { hazards: false, temperamentId: 'calm' });
  const { world, engine } = s;
  engine.capacity = 100;
  for (const id of [RULE_TIME, RULE_SPACE, RULE_MATTER, 'gravity', 'aggregation', 'fusion', RULE_CHEMISTRY]) {
    engine.activate(id, world);
  }
  const planet = craftPlanet(world, 300); // hors zone (100–220 en clément)
  engine.activate(RULE_CONDITIONS, world); // le monde est refroidi : activable

  for (let i = 0; i < 3000; i++) world.step();
  assert.equal(world.has(planet, Habitable), false, 'hors zone : l\'eau ne vient pas');
  assert.equal(countKind(world, 'lake'), 0);

  // L'acte divin : payer la migration vers la zone tempérée.
  assert.equal(engine.spend(TERRAFORM_ORBIT_COST, 'terraform-orbit'), true);
  world.add(planet, OrbitMigration, { targetRadius: 180 });
  // 120 unités à 0.06/tick = 2000 ticks de voyage, puis l'eau doit monter (~2200).
  for (let i = 0; i < 8000; i++) world.step();
  assert.equal(world.has(planet, Habitable), true, 'le monde migré est devenu habitable');
});

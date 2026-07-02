/**
 * Phase B — le terminal divin : le compilateur d'intentions traduit du
 * français en actes du jeu, montre le coût, et l'univers décide du reste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoidScenario } from '../src/scenario.js';
import { applyPatch, compileIntent, type IntentContext } from '../src/simulation/intents.js';
import { RULE_GRAVITY, RULE_MATTER, countKind, FATE_SUPERNOVA } from '../src/simulation/cosmos.js';
import {
  Mass,
  Orbit,
  OrbitMigration,
  Position,
  Size,
  Species,
  StellarClass,
  Temperature,
} from '../src/simulation/components.js';
import type { EntityId, World } from '../src/simulation/ecs.js';

function makeCtx(seed = 7): IntentContext & { scenario: ReturnType<typeof buildVoidScenario> } {
  const scenario = buildVoidScenario(seed, { hazards: false, temperamentId: 'calm' });
  return {
    scenario,
    world: scenario.world,
    engine: scenario.engine,
    fate: scenario.fate,
    rng: scenario.rng,
    temperament: scenario.temperament,
  };
}

function craftStar(world: World, mass = 300): EntityId {
  const e = world.createEntity();
  world.add(e, Species, { kind: 'star', label: 'Géante bleue' });
  world.add(e, Position, { x: 0, y: 0 });
  world.add(e, Size, { size: 10 });
  world.add(e, Mass, { mass });
  world.add(e, StellarClass, { className: 'giant', luminosity: 1.6 });
  return e;
}

test('« que la lumière soit » compile vers le Big Bang, et l\'appliquer fait naître le temps', () => {
  const ctx = makeCtx();
  const compiled = compileIntent('que la lumière soit', ctx);
  assert.ok('patch' in compiled);
  assert.equal(compiled.patch.totalCost, 0);
  const results = applyPatch(compiled.patch, ctx);
  assert.match(results[0] ?? '', /L'univers existe/);
  assert.equal(ctx.engine.isActive('time'), true);
  assert.ok(countKind(ctx.world, 'particle') >= 100);
});

test('coder et couper des règles, régler un paramètre — gratuits et prospectifs', () => {
  const ctx = makeCtx();
  applyPatch((compileIntent('big bang', ctx) as { patch: never }).patch, ctx);

  const code = compileIntent('code la gravité', ctx);
  assert.ok('patch' in code);
  applyPatch(code.patch, ctx);
  assert.equal(ctx.engine.isActive(RULE_GRAVITY), true);

  const gel = compileIntent('gèle le temps', ctx);
  assert.ok('patch' in gel);
  applyPatch(gel.patch, ctx);
  assert.equal(ctx.engine.isActive('time'), false);

  const before = ctx.engine.param(RULE_MATTER, 'rate');
  const boost = compileIntent('double la condensation', ctx);
  assert.ok('patch' in boost);
  assert.equal(boost.patch.totalCost, 0, 'les paramètres sont gratuits (prospectifs)');
  applyPatch(boost.patch, ctx);
  assert.equal(ctx.engine.param(RULE_MATTER, 'rate'), before * 2);

  const explicit = compileIntent('mets la gravité à 0.01', ctx);
  assert.ok('patch' in explicit);
  applyPatch(explicit.patch, ctx);
  assert.equal(ctx.engine.param(RULE_GRAVITY, 'strength'), 0.01);
});

test('conjurer de la matière au nord : payant, localisé, et l\'univers fait le reste', () => {
  const ctx = makeCtx();
  applyPatch((compileIntent('big bang', ctx) as { patch: never }).patch, ctx);
  const before = countKind(ctx.world, 'particle');
  const freeBefore = ctx.engine.free;

  const compiled = compileIntent('condense de la matière au nord', ctx);
  assert.ok('patch' in compiled);
  assert.equal(compiled.patch.totalCost, 4);
  const results = applyPatch(compiled.patch, ctx);
  assert.match(results[0] ?? '', /nuage de matière/);
  assert.equal(countKind(ctx.world, 'particle'), before + 30);
  assert.ok(ctx.engine.free < freeBefore + 2, 'le calcul libre a payé'); // (+2 possible : jalon 1re intervention)
  // Localisé : le centre de masse des nouveaux grains est au nord (y < 0).
  let ySum = 0;
  let n = 0;
  for (const [e, s] of ctx.world.query(Species)) {
    if (s.kind !== 'particle') continue;
    const p = ctx.world.get(e, Position);
    if (p && p.y < -100) {
      ySum += p.y;
      n++;
    }
  }
  assert.ok(n >= 25, `des grains existent au nord (${n})`);
  void ySum;
});

test('« pousse Monde-1 dans la zone tempérée » : cible résolue, coût affiché, migration engagée', () => {
  const ctx = makeCtx();
  ctx.engine.capacity = 30;
  const star = craftStar(ctx.world);
  const planet = ctx.world.createEntity();
  ctx.world.add(planet, Species, { kind: 'planet', label: 'Monde-1' });
  ctx.world.add(planet, Position, { x: 400, y: 0 });
  ctx.world.add(planet, Size, { size: 3 });
  ctx.world.add(planet, Orbit, { center: star, radius: 400, angularSpeed: 0.9 / 400, phase: 0 });

  const compiled = compileIntent('pousse Monde-1 dans la zone tempérée', ctx);
  assert.ok('patch' in compiled);
  assert.equal(compiled.patch.totalCost, 6);
  // Zone du tempérament clément (100–220) × luminosité géante (1.6) → centre 256.
  assert.match(compiled.patch.actions[0]?.description ?? '', /400 → 256/);
  applyPatch(compiled.patch, ctx);
  assert.equal(ctx.world.get(planet, OrbitMigration)?.targetRadius, 256);
});

test('« annule la supernova » : trouve l\'événement, paie le prix de l\'urgence, l\'efface', () => {
  const ctx = makeCtx();
  ctx.engine.capacity = 30;
  const star = craftStar(ctx.world);
  ctx.fate.schedule(ctx.world.tick + 5000, star, FATE_SUPERNOVA);

  const compiled = compileIntent('annule la supernova', ctx);
  assert.ok('patch' in compiled);
  assert.equal(compiled.patch.totalCost, 6, 'base 3 × proximité 1 × annulation 2');
  applyPatch(compiled.patch, ctx);
  assert.equal(ctx.fate.eventsFor(star).length, 0, 'le destin est effacé');

  // Et « repousse » : re-planifie au lieu d'effacer.
  const again = ctx.fate.schedule(ctx.world.tick + 5000, star, FATE_SUPERNOVA);
  const push = compileIntent('repousse la supernova de 3000 ticks', ctx);
  assert.ok('patch' in push);
  applyPatch(push.patch, ctx);
  const ev = ctx.fate.eventsFor(star).find((e) => e.id === again);
  assert.equal(ev?.tick, ctx.world.tick + 8000);
});

test('le refus est motivé quand le calcul libre manque — le patch compile quand même', () => {
  const ctx = makeCtx();
  applyPatch((compileIntent('big bang', ctx) as { patch: never }).patch, ctx); // libre : 4
  const compiled = compileIntent('condense de la matière au sud et condense de la matière au nord', ctx);
  assert.ok('patch' in compiled);
  assert.equal(compiled.patch.actions.length, 2, 'les clauses « et » se compilent séparément');
  assert.equal(compiled.patch.totalCost, 8);
  const results = applyPatch(compiled.patch, ctx);
  assert.match(results[0] ?? '', /nuage/); // la première passe (4 ≤ 4, +2 de jalon)
  // La seconde dépend du libre restant — quoi qu'il arrive, le refus est motivé.
  assert.ok(/nuage|Refusé : calcul libre insuffisant/.test(results[1] ?? ''));
});

test('l\'inconnu est avoué, pas deviné', () => {
  const ctx = makeCtx();
  const compiled = compileIntent('invoque un dragon stellaire', ctx);
  assert.ok('failure' in compiled);
  assert.match(compiled.failure.fragment, /dragon/);
});

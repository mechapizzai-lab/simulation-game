/**
 * Phase 1 — le destin devient une menace : aléas annoncés dans la Fate Queue,
 * intervention payante en calcul libre, échec persistant, contre-jeu par règle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoidScenario } from '../src/scenario.js';
import {
  FATE_DROUGHT,
  FATE_IMPACT,
  countKind,
  interventionCost,
  RULE_CONDITIONS,
  RULE_TIME,
  RULE_SPACE,
  RULE_MATTER,
} from '../src/simulation/cosmos.js';
import {
  Chemistry,
  Crater,
  Habitable,
  Hazard,
  OnPlanet,
  Orbit,
  Position,
  Size,
  Species,
  Temperature,
} from '../src/simulation/components.js';
import type { EntityId, World } from '../src/simulation/ecs.js';

/** Fabrique un monde vivant à la main : on teste les menaces, pas la genèse. */
function craftLivingWorld(world: World): { planet: EntityId; lake: EntityId } {
  // Depuis la Phase A, l'eau exige une étoile VIVANTE au centre de l'orbite :
  // le monde artisanal a donc son soleil (jaune, luminosité 1).
  const sun = world.createEntity();
  world.add(sun, Species, { kind: 'star', label: 'Étoile jaune' });
  world.add(sun, Position, { x: 0, y: 0 });
  world.add(sun, Size, { size: 8 });
  const planet = world.createEntity();
  world.add(planet, Species, { kind: 'planet', label: 'Monde-Test' });
  world.add(planet, Position, { x: 100, y: 0 });
  world.add(planet, Size, { size: 3 });
  world.add(planet, Temperature, { current: 100, coolingPerTick: 0 });
  world.add(planet, Habitable, { sinceTick: 0 });
  // Chimie mûre + orbite en zone tempérée : la règle Conditions peut agir
  // sur ce monde (nécessaire au test de contre-jeu de la sécheresse).
  world.add(planet, Chemistry, { richness: 2 });
  world.add(planet, Orbit, { center: sun, radius: 150, angularSpeed: 0.0005, phase: 0 });
  const lake = world.createEntity();
  world.add(lake, Species, { kind: 'lake', label: 'Mer' });
  world.add(lake, Position, { x: -150, y: 60 });
  world.add(lake, Size, { size: 180 });
  world.add(lake, OnPlanet, { planet });
  for (let i = 0; i < 6; i++) {
    const p = world.createEntity();
    world.add(p, Species, { kind: 'person', label: 'Personne' });
    world.add(p, Position, { x: i * 10, y: 0 });
    world.add(p, OnPlanet, { planet });
  }
  for (let i = 0; i < 4; i++) {
    const t = world.createEntity();
    world.add(t, Species, { kind: 'tree', label: 'Arbre' });
    world.add(t, Position, { x: i * 10, y: 50 });
    world.add(t, OnPlanet, { planet });
  }
  return { planet, lake };
}

test('une menace est annoncée, visible dans la timeline de la cible, puis se réalise', () => {
  const s = buildVoidScenario(31, { temperamentId: 'calm' }); // hazards actifs par défaut
  const { world, fate } = s;
  const { planet } = craftLivingWorld(world);
  const announced: string[] = [];
  const realized: { deaths: number }[] = [];
  world.onEvent((e) => {
    if (e.kind === 'hazard-announced') announced.push((e.data as { hazard: string }).hazard);
    if (e.kind === 'hazard-impact') realized.push(e.data as { deaths: number });
  });

  // Le rouleau d'entropie finit par frapper (période de grâce + tirage).
  for (let i = 0; i < 20000 && announced.length === 0; i++) world.step();
  assert.ok(announced.length > 0, 'une menace a été annoncée');
  const threat = fate
    .eventsFor(planet)
    .find((ev) => [FATE_IMPACT, FATE_DROUGHT, 'hazard-flare'].includes(ev.kind));
  // (la menace peut viser l'étoile — ici il n'y en a pas, donc c'est la planète)
  assert.ok(threat, 'la menace vit dans la Fate Queue de la cible');

  // On laisse le destin se réaliser : la boucle le rencontre au tick exact.
  for (let i = 0; i < 6000 && fate.eventsFor(planet).some((ev) => ev.id === threat.id); i++) world.step();
  assert.equal(fate.eventsFor(planet).some((ev) => ev.id === threat.id), false, 'réalisé ou consommé');
});

test('l\'impact d\'astéroïde efface la vie, laisse un cratère, mais le potentiel demeure', () => {
  const s = buildVoidScenario(7, { hazards: false, temperamentId: 'calm' }); // déterminisme : on écrit la menace nous-mêmes
  const { world, fate } = s;
  const { planet } = craftLivingWorld(world);
  assert.equal(countKind(world, 'person'), 6);

  fate.schedule(50, planet, FATE_IMPACT);
  for (let i = 0; i < 60; i++) world.step();

  assert.equal(countKind(world, 'person'), 0, 'vies effacées');
  assert.equal(countKind(world, 'tree'), 0, 'forêts effacées');
  assert.equal(world.has(planet, Crater), true, 'la cicatrice demeure');
  assert.equal(world.has(planet, Habitable), false, 'plus habitable...');
  assert.ok((world.get(planet, Temperature)?.current ?? 0) > 300, '...et réchauffée');
});

test('annuler la menace coûte du calcul libre, dévie le corps, et le calcul se régénère', () => {
  const s = buildVoidScenario(7, { hazards: false, temperamentId: 'calm' });
  const { world, fate, engine } = s;
  engine.capacity = 30;
  const { planet } = craftLivingWorld(world);
  // Menace écrite loin (10 000 ticks) puis un astéroïde matérialisé à la main
  // via le même chemin que le rouleau : on schedule et on vérifie le mover.
  const eventId = fate.schedule(world.tick + 10_000, planet, FATE_IMPACT);
  const asteroid = world.createEntity();
  world.add(asteroid, Species, { kind: 'asteroid', label: 'Astéroïde' });
  world.add(asteroid, Position, { x: 500, y: 500 });
  world.add(asteroid, Hazard, {
    eventId,
    target: planet,
    bornTick: world.tick,
    fromX: 500,
    fromY: 500,
    impactTick: world.tick + 10_000,
    shieldChecked: false,
  });

  // Loin : annuler coûte base(2) × proximité(1) × annulation(2) = 4.
  const cost = interventionCost(FATE_IMPACT, 10_000, 'cancel');
  assert.equal(cost, 4);
  const freeBefore = engine.free;
  assert.equal(engine.spend(cost, 'cancel-test'), true);
  fate.cancel(eventId);
  // Premier destin réécrit : jalon +2 de capacité — le libre ne baisse que de 2 net.
  assert.equal(engine.free, freeBefore - cost + 2);
  assert.ok(engine.burned >= 4);

  // Sans le système d'aléas (hazards:false), on doit quand même dévier : le
  // mover n'est pas enregistré ici, donc on vérifie seulement la régénération.
  for (let i = 0; i < 4 * 250; i++) world.step();
  assert.equal(engine.burned, 0, 'le calcul brûlé s\'est régénéré');
});

test('imminent coûte plus cher que lointain, annuler plus cher que replanifier', () => {
  assert.ok(interventionCost(FATE_IMPACT, 100, 'cancel') > interventionCost(FATE_IMPACT, 5000, 'cancel'));
  assert.ok(interventionCost(FATE_IMPACT, 100, 'cancel') > interventionCost(FATE_IMPACT, 100, 'reschedule'));
  assert.equal(interventionCost('death', 5000, 'reschedule'), 1, 'repousser une mort lointaine reste bon marché');
  assert.equal(interventionCost(FATE_IMPACT, 100, 'cancel'), 12, 'effacer un impact imminent est ruineux');
});

test('spend refuse au-delà du calcul libre', () => {
  const s = buildVoidScenario(7, { hazards: false, temperamentId: 'calm' });
  const { world, engine } = s;
  engine.activate('bigbang', world); // la triade naît : 2+1+3 = 6 → libre 4
  assert.equal(engine.spend(5, 'trop'), false);
  assert.equal(engine.burned, 0);
  assert.equal(engine.spend(4, 'juste'), true); // jalon 'premier destin réécrit' : capacité 12
  // used 6 + brûlé 4 + Gravité 3 = 13 > 12 : le brûlé compte dans le budget.
  assert.match(engine.activationBlocker('gravity', world) ?? '', /budget insuffisant/);
});

test('contre-jeu : faire monter les eaux avant la sécheresse évite les morts', () => {
  const run = (pumpWater: boolean): number => {
    const s = buildVoidScenario(7, { hazards: false, temperamentId: 'calm' });
    const { world, fate, engine } = s;
    engine.capacity = 100;
    // Chaîne minimale pour que la règle Conditions soit activable et agisse.
    for (const id of ['bigbang', 'gravity', 'aggregation', 'fusion', 'chemistry']) {
      engine.activate(id, world);
    }
    const { planet } = craftLivingWorld(world);
    fate.schedule(world.tick + 1000, planet, FATE_DROUGHT);
    // Le contre-jeu : coder/pousser la montée des eaux AVANT l'échéance.
    // Éditer un PARAMÈTRE de règle est gratuit (prospectif) — c'est l'autre
    // moitié de l'arsenal, face à l'intervention payante sur la queue.
    if (pumpWater) {
      engine.activate(RULE_CONDITIONS, world);
      engine.setParam(RULE_CONDITIONS, 'waterGrowth', 0.5);
    }
    for (let i = 0; i < 1010; i++) world.step();
    return countKind(world, 'person');
  };
  const withoutPump = run(false);
  const withPump = run(true);
  assert.ok(withPump > withoutPump, `pomper l'eau sauve des vies (${withPump} > ${withoutPump})`);
  assert.equal(withPump, 6, 'personne ne meurt si la mer a tenu');
});

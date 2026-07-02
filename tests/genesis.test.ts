/**
 * La genèse complète en console : du Vide à la vie, en codant les règles une
 * par une, avec les deux dilemmes de budget et les contrats de rétroactivité.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVoidScenario } from '../src/scenario.js';
import {
  RULE_AGGREGATION,
  RULE_CHEMISTRY,
  RULE_CONDITIONS,
  RULE_FUSION,
  RULE_GRAVITY,
  RULE_LIFE,
  RULE_MATTER,
  RULE_SPACE,
  RULE_TIME,
  FATE_IGNITION,
  countKind,
} from '../src/simulation/cosmos.js';
import { Igniting, Mass, Position, Size, Species, Temperature } from '../src/simulation/components.js';

/** Avance jusqu'à ce que la condition soit vraie (ou échoue après maxTicks). */
function runUntil(
  scenario: ReturnType<typeof buildVoidScenario>,
  label: string,
  maxTicks: number,
  condition: () => boolean,
): void {
  for (let i = 0; i < maxTicks; i++) {
    if (condition()) return;
    scenario.world.step();
  }
  assert.ok(condition(), `${label} (après ${maxTicks} ticks)`);
}

test('le Vide est vide, et rien n\'émerge tant qu\'aucune règle n\'est codée', () => {
  const s = buildVoidScenario(1);
  assert.equal(s.world.entityCount, 0);
  for (let i = 0; i < 200; i++) s.world.step();
  assert.equal(s.world.entityCount, 0, 'aucune règle : rien, jamais');
  assert.equal(s.engine.used, 0);
});

test('la grande échelle : du néant à la vie, avec deux dilemmes de budget', () => {
  const s = buildVoidScenario(20260702);
  const { world, engine } = s;

  // --- Coder les fondations : Temps, Espace, Matière (6/10) ---
  assert.equal(engine.activate(RULE_TIME, world), true);
  assert.equal(engine.activate(RULE_SPACE, world), true);
  assert.equal(engine.activate(RULE_MATTER, world), true);
  runUntil(s, 'des particules condensent', 2000, () => countKind(world, 'particle') > 20);

  // --- Gravité (9/10) puis jalon "la matière existe" (+2 → 12) ---
  assert.equal(engine.activate(RULE_GRAVITY, world), true);
  runUntil(s, 'jalon matière franchi', 2000, () => engine.hasReached('m-matter'));
  assert.equal(engine.capacity, 12);

  // --- Agrégation (12/12 : budget saturé) ---
  assert.equal(engine.activate(RULE_AGGREGATION, world), true);
  assert.equal(engine.used, 12);
  runUntil(s, 'des amas denses se forment', 8000, () => engine.hasReached('m-clump'));
  assert.equal(engine.capacity, 15);

  // On laisse un amas dépasser la masse d'allumage AVANT de couper l'agrégation.
  runUntil(s, 'un amas atteint la masse d\'allumage', 15000, () => {
    for (const [, m] of world.query(Mass)) if (m.mass >= 24) return true;
    return false;
  });

  // --- DILEMME 1 : Fusion coûte 4, capacité 15, utilisé 12 → refus motivé ---
  assert.match(engine.activationBlocker(RULE_FUSION, world) ?? '', /budget insuffisant \(16\/15\)/);
  // Choix stratégique : couper l'Agrégation (les amas persistent, figés).
  assert.equal(engine.deactivate(RULE_AGGREGATION), true);
  assert.equal(engine.activate(RULE_FUSION, world), true);

  // --- L'allumage est un DESTIN : écrit d'abord, réalisé ensuite ---
  runUntil(s, 'un allumage est planifié', 500, () => {
    for (const [e] of world.query(Igniting)) return world.isAlive(e);
    return false;
  });
  assert.equal(countKind(world, 'star'), 0, 'pas encore allumée : le destin attend son tick');
  runUntil(s, 'la première étoile s\'allume', 3000, () => engine.hasReached('m-star'));
  assert.equal(engine.capacity, 19);

  // Ré-activer l'Agrégation maintenant qu'on a les moyens (16/19), puis Chimie (19/19).
  assert.equal(engine.activate(RULE_AGGREGATION, world), true);
  assert.equal(engine.activate(RULE_CHEMISTRY, world), true);

  // --- Capture planétaire puis refroidissement (~4000 ticks à 0.15/tick) ---
  runUntil(s, 'des planètes sont capturées', 4000, () => countKind(world, 'planet') > 0);
  assert.match(
    engine.activationBlocker(RULE_CONDITIONS, world) ?? '',
    /requiert une planète refroidie/,
    'les Conditions de Vie attendent un état du MONDE, pas seulement des règles',
  );
  runUntil(s, 'une planète refroidit', 8000, () => engine.hasReached('m-cooled'));
  assert.equal(engine.capacity, 22);

  // --- Conditions de Vie (21/22) : l'eau monte, le monde devient habitable ---
  assert.equal(engine.activate(RULE_CONDITIONS, world), true);
  runUntil(s, 'un monde devient habitable', 8000, () => engine.hasReached('m-habitable'));
  assert.equal(engine.capacity, 24);

  // --- DILEMME 2 : Vie coûte 4, utilisé 21, capacité 24 → refus motivé ---
  assert.match(engine.activationBlocker(RULE_LIFE, world) ?? '', /budget insuffisant \(25\/24\)/);
  assert.equal(engine.deactivate(RULE_AGGREGATION), true);
  assert.equal(engine.activate(RULE_LIFE, world), true);

  // --- Abiogenèse (destin à +400 ticks) puis générations ---
  runUntil(s, 'la vie éclot', 3000, () => engine.hasReached('m-life'));
  assert.equal(engine.capacity, 28);
  assert.ok(countKind(world, 'person') >= 2);
  assert.ok(countKind(world, 'tree') >= 3);

  // La boucle continue : les cycles écologiques enchaînent les générations.
  const tick0 = world.tick;
  runUntil(s, 'une naissance issue du cycle', 2000, () => countKind(world, 'person') > 2);
  assert.ok(world.tick > tick0);
});

test('rétroactivité : paramètres en direct, destins écrits figés', () => {
  const s = buildVoidScenario(5);
  const { world, engine, fate } = s;
  engine.capacity = 100; // hors gameplay : on teste les contrats, pas le budget
  for (const id of [RULE_TIME, RULE_SPACE, RULE_MATTER, RULE_GRAVITY, RULE_AGGREGATION, RULE_FUSION]) {
    assert.equal(engine.activate(id, world), true);
  }

  // Un amas fabriqué à la main, déjà au-dessus de la masse d'allumage.
  const clump = world.createEntity();
  world.add(clump, Species, { kind: 'clump', label: 'Amas' });
  world.add(clump, Position, { x: 0, y: 0 });
  world.add(clump, Mass, { mass: 30 });
  world.add(clump, Size, { size: 4 });

  world.step(); // la Fusion écrit le destin avec le délai COURANT (250)
  const scheduled = fate.eventsFor(clump).find((e) => e.kind === FATE_IGNITION);
  assert.ok(scheduled);
  const writtenTick = scheduled.tick;

  // (b) Changer le paramètre APRÈS coup ne réécrit pas le destin déjà écrit.
  engine.setParam(RULE_FUSION, 'ignitionDelay', 2000);
  world.step();
  assert.equal(
    fate.eventsFor(clump).find((e) => e.kind === FATE_IGNITION)?.tick,
    writtenTick,
    'le destin écrit est figé (contrat b)',
  );

  // (a) Les paramètres des processus continus agissent dès le tick suivant.
  const before = countKind(world, 'particle');
  engine.setParam(RULE_MATTER, 'rate', 40);
  for (let i = 0; i < 50; i++) world.step();
  const fast = countKind(world, 'particle') - before;
  engine.setParam(RULE_MATTER, 'rate', 1);
  const mid = countKind(world, 'particle');
  for (let i = 0; i < 50; i++) world.step();
  const slow = countKind(world, 'particle') - mid;
  assert.ok(fast > slow, `le taux agit en direct (rapide=${fast}, lent=${slow})`);
});

test('couper une règle arrête le processus, jamais les produits', () => {
  const s = buildVoidScenario(9);
  const { world, engine } = s;
  engine.capacity = 100;
  for (const id of [RULE_TIME, RULE_SPACE, RULE_MATTER, RULE_GRAVITY, RULE_AGGREGATION]) {
    engine.activate(id, world);
  }
  for (let i = 0; i < 4000; i++) world.step();
  assert.ok(countKind(world, 'clump') > 0, 'des amas existent');

  engine.deactivate(RULE_AGGREGATION);
  const massesBefore = [...world.query(Mass)]
    .filter(([e]) => world.get(e, Species)?.kind === 'clump')
    .map(([, m]) => m.mass)
    .sort((a, b) => a - b);
  const particlesBefore = countKind(world, 'particle');
  for (let i = 0; i < 500; i++) world.step();
  const massesAfter = [...world.query(Mass)]
    .filter(([e]) => world.get(e, Species)?.kind === 'clump')
    .map(([, m]) => m.mass)
    .sort((a, b) => a - b);
  assert.deepEqual(massesAfter, massesBefore, 'les amas persistent, figés (produits)');
  assert.ok(countKind(world, 'particle') >= particlesBefore, 'la Matière, elle, condense toujours');
});

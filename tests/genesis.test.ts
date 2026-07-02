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
import {
  Chemistry,
  Igniting,
  Mass,
  Orbit,
  OrbitMigration,
  Position,
  Size,
  Species,
  StellarClass,
  Temperature,
} from '../src/simulation/components.js';
import { TERRAFORM_ORBIT_COST } from '../src/simulation/cosmos.js';

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
  const s = buildVoidScenario(1, { temperamentId: 'calm' });
  assert.equal(s.world.entityCount, 0);
  for (let i = 0; i < 200; i++) s.world.step();
  assert.equal(s.world.entityCount, 0, 'aucune règle : rien, jamais');
  assert.equal(s.engine.used, 0);
});

test('la grande échelle : du néant à la vie, avec deux dilemmes de budget', () => {
  const s = buildVoidScenario(20260702, { temperamentId: 'calm' });
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

  // --- Conditions de Vie (21/22) : l'eau monte... mais depuis la Phase A,
  // la première étoile est une GÉANTE BLEUE condamnée : sa supernova peut
  // éclater pendant la course à l'habitabilité. Le test traverse l'acte 1
  // et, s'il le faut, l'acte 2 (étoiles de seconde génération, plus calmes).
  assert.equal(engine.activate(RULE_CONDITIONS, world), true);
  // On attend l'eau ; si l'univers ne l'offre pas (ex. : toutes les planètes
  // hors de la zone resserrée d'une naine rouge — vécu sur cette seed), on
  // fait ce qu'un joueur ferait : PAYER une terraformation et migrer un monde
  // riche en chimie vers la zone tempérée de son étoile. Pas de réussite
  // forcée — une intervention délibérée.
  for (let i = 0; i < 20_000 && !engine.hasReached('m-habitable'); i++) world.step();
  if (!engine.hasReached('m-habitable')) {
    let terraformed = false;
    for (const [planet, sp] of world.query(Species)) {
      if (sp.kind !== 'planet') continue;
      const orbit = world.get(planet, Orbit);
      const chem = world.get(planet, Chemistry);
      if (!orbit || !chem || chem.richness < 1) continue;
      if (world.get(orbit.center, Species)?.kind !== 'star') continue;
      const lum = world.get(orbit.center, StellarClass)?.luminosity ?? 1;
      // Financer le geste : couper les règles de cosmogonie devenues inutiles
      // (leurs produits persistent) — LE réflexe stratégique de fin de partie.
      if (engine.free < TERRAFORM_ORBIT_COST) engine.deactivate(RULE_AGGREGATION);
      if (engine.free < TERRAFORM_ORBIT_COST) engine.deactivate(RULE_MATTER);
      if (engine.free < TERRAFORM_ORBIT_COST) engine.deactivate(RULE_GRAVITY);
      assert.equal(engine.spend(TERRAFORM_ORBIT_COST, 'terraform-orbit'), true, 'le calcul libre paie la migration');
      world.add(planet, OrbitMigration, { targetRadius: Math.round(160 * lum) });
      terraformed = true;
      break;
    }
    assert.equal(terraformed, true, 'au moins un monde candidat à terraformer');
  }
  runUntil(
    s,
    'un monde devient habitable (offert par l\'univers, ou arraché par terraformation)',
    40_000,
    () => engine.hasReached('m-habitable'),
  );

  // --- Vie : selon que la supernova a déjà payé son jalon (+3), le budget
  // force ou non de couper l'Agrégation — on décide comme un joueur. ---
  const blocker = engine.activationBlocker(RULE_LIFE, world);
  if (blocker !== null) {
    assert.match(blocker, /budget insuffisant/);
    assert.equal(engine.deactivate(RULE_AGGREGATION), true);
  }
  assert.equal(engine.activate(RULE_LIFE, world), true);

  // --- Abiogenèse (destin à +400 ticks) puis générations ---
  runUntil(s, 'la vie éclot', 20_000, () => engine.hasReached('m-life'));
  assert.ok(countKind(world, 'person') >= 1);
  assert.ok(countKind(world, 'tree') >= 1);

  // La boucle continue : les cycles écologiques enchaînent les générations.
  const tick0 = world.tick;
  runUntil(s, 'une naissance issue du cycle', 6000, () => countKind(world, 'person') > 2);
  assert.ok(world.tick > tick0);
});

test('rétroactivité : paramètres en direct, destins écrits figés', () => {
  const s = buildVoidScenario(5, { temperamentId: 'calm' });
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
  // (On traverse d'abord le Big Bang : rien ne condense avant lui.)
  for (let i = 0; i < 300; i++) world.step();
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
  const s = buildVoidScenario(9, { temperamentId: 'calm' });
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

/**
 * Le Vide : l'état initial du jeu n'est plus un univers peuplé mais un monde
 * sans entités, sans règles actives, sans temps qui passe. Tout ce qui
 * existera devra être codé par le joueur, règle par règle (voir cosmos.ts).
 */
import { World } from './simulation/ecs.js';
import { FateQueue, createFateSystem } from './simulation/fate.js';
import { Rng } from './simulation/rng.js';
import { RuleEngine } from './simulation/rules.js';
import { defineCosmos, type CosmosOptions } from './simulation/cosmos.js';
import { registerStandardFates } from './simulation/archetypes.js';
import {
  AgingSystem,
  GrowthSystem,
  MovementSystem,
  OrbitSystem,
  createWandererSystem,
} from './simulation/systems.js';

// Ré-export : l'étendue des cartes de surface vit désormais dans cosmos.ts.
export { SURFACE_HALF_WIDTH, SURFACE_HALF_HEIGHT, UNIVERSE_RADIUS } from './simulation/cosmos.js';

/** Capacité de calcul initiale : de quoi coder Temps + Espace + Matière +
 *  Gravité (10) et pas un bit de plus — la suite se finance en observant. */
export const INITIAL_CAPACITY = 10;

export interface VoidScenario {
  world: World;
  fate: FateQueue;
  engine: RuleEngine;
  rng: Rng;
}

export function buildVoidScenario(seed = 20260702, options: CosmosOptions = {}): VoidScenario {
  const world = new World();
  const fate = new FateQueue();
  const rng = new Rng(seed);
  const engine = new RuleEngine(INITIAL_CAPACITY);
  registerStandardFates(fate);

  const cosmos = defineCosmos(engine, world, fate, rng, options);

  // Ordre d'exécution : destins d'abord (les morts de ce tick ne bougent plus),
  // puis les processus des règles, puis les évolutions continues des produits.
  // Les systems "cœur" (âge, croissance, mouvement...) ne sont PAS gated : ils
  // font vivre des PRODUITS ; ils ne font simplement rien tant qu'aucune règle
  // n'a créé d'entité porteuse de leurs components.
  world.addSystem(createFateSystem(fate));
  for (const system of cosmos.systems) world.addSystem(system);
  world.addSystem(AgingSystem);
  world.addSystem(GrowthSystem);
  world.addSystem(OrbitSystem);
  world.addSystem(MovementSystem);
  world.addSystem(createWandererSystem(rng));
  // Jalons en fin de tick : l'émergence est constatée sur l'état final.
  // (Tous les 5 ticks : les conditions sont des scans, inutile à chaque tick.)
  world.addSystem({
    name: 'milestones',
    update(w, tick): void {
      if (tick % 5 === 0) engine.checkMilestones(w);
    },
  });
  // Le calcul brûlé par les interventions se régénère au fil des ticks.
  world.addSystem({
    name: 'calc-regen',
    update(): void {
      engine.regen(1);
    },
  });

  return { world, fate, engine, rng };
}

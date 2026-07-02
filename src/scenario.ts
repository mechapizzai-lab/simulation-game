/**
 * Scénario de démonstration : construit l'univers initial.
 * C'est du CONTENU (données + fabriques), pas du moteur : sous Godot ce
 * fichier deviendra une scène ou un fichier de données, sans logique à porter.
 */
import { World, type EntityId } from './simulation/ecs.js';
import { FateQueue, createFateSystem } from './simulation/fate.js';
import { Rng } from './simulation/rng.js';
import {
  registerStandardFates,
  spawnPerson,
  spawnPlanet,
  spawnStar,
  spawnTree,
} from './simulation/archetypes.js';
import { OnPlanet } from './simulation/components.js';
import {
  AgingSystem,
  GrowthSystem,
  MovementSystem,
  OrbitSystem,
  createWandererSystem,
} from './simulation/systems.js';

export interface Scenario {
  world: World;
  fate: FateQueue;
  rng: Rng;
  star: EntityId;
  /** Planète habitée sur laquelle la vue surface est disponible. */
  gaia: EntityId;
  planets: EntityId[];
}

/** Étendue de la carte de surface en unités de surface (centrée sur 0,0). */
export const SURFACE_HALF_WIDTH = 600;
export const SURFACE_HALF_HEIGHT = 400;

export function buildScenario(seed = 20260702): Scenario {
  const world = new World();
  const fate = new FateQueue();
  const rng = new Rng(seed);
  registerStandardFates(fate);

  // Ordre des systems = ordre d'exécution : le destin d'abord (les morts de ce
  // tick ne bougent plus), puis les évolutions continues.
  world.addSystem(createFateSystem(fate));
  world.addSystem(AgingSystem);
  world.addSystem(GrowthSystem);
  world.addSystem(OrbitSystem);
  world.addSystem(MovementSystem);
  world.addSystem(createWandererSystem(rng));

  // --- Système stellaire ---
  const star = spawnStar(world, { x: 0, y: 0, size: 30 });
  const aria = spawnPlanet(world, {
    center: star, radius: 170, angularSpeed: 0.0011, phase: 2.1, size: 5, label: 'Aria',
  });
  const gaia = spawnPlanet(world, {
    center: star, radius: 300, angularSpeed: 0.0006, phase: 0.4, size: 8, label: 'Gaïa',
  });
  const thao = spawnPlanet(world, {
    center: star, radius: 450, angularSpeed: 0.00035, phase: 4.4, size: 6, label: 'Thao',
  });

  // --- Vie à la surface de Gaïa ---
  // Positions en coordonnées locales de surface ; OnPlanet les rattache à Gaïa.
  const onGaia = (e: EntityId): EntityId => {
    world.add(e, OnPlanet, { planet: gaia });
    return e;
  };

  for (let i = 0; i < 14; i++) {
    onGaia(
      spawnTree(world, fate, {
        x: rng.range(-SURFACE_HALF_WIDTH * 0.9, SURFACE_HALF_WIDTH * 0.9),
        y: rng.range(-SURFACE_HALF_HEIGHT * 0.9, SURFACE_HALF_HEIGHT * 0.9),
        lifespan: rng.int(3000, 9000),
        maxSize: rng.range(2, 4),
      }),
    );
  }

  for (let i = 0; i < 8; i++) {
    onGaia(
      spawnPerson(world, fate, {
        x: rng.range(-250, 250),
        y: rng.range(-180, 180),
        lifespan: rng.int(1500, 4000),
        rng,
      }),
    );
  }

  return { world, fate, rng, star, gaia, planets: [aria, gaia, thao] };
}

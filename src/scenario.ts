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
  spawnLake,
  spawnPerson,
  spawnPlanet,
  spawnStar,
  spawnTree,
} from './simulation/archetypes.js';
import { OnPlanet, Position, Size, Species } from './simulation/components.js';
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

  // Une mer intérieure se forme : de l'étang (40 su) à la mer (250 su) en
  // ~10 000 ticks — visible à x100, imperceptible à x1. Le joueur peut
  // l'accélérer en éditant GrowthRate depuis le panneau.
  onGaia(spawnLake(world, { x: -280, y: 120, size: 40, maxSize: 250, growthPerTick: 0.02 }));

  installEcosystem(world, fate, rng, gaia);

  return { world, fate, rng, star, gaia, planets: [aria, gaia, thao] };
}

export const FATE_FOREST_SEED = 'forest-seed';
export const FATE_VILLAGE_BIRTH = 'village-birth';

const MAX_TREES = 70;
const MAX_PEOPLE = 30;

/**
 * Cycles écologiques de Gaïa : germination d'arbres et naissances, sous forme
 * d'événements de destin AUTO-RECONDUCTIBLES portés par la planète elle-même.
 * Conséquence ludique : sélectionner Gaïa montre ces cycles dans sa timeline,
 * et le joueur peut les replanifier ou les ANNULER (stériliser la planète).
 */
function installEcosystem(world: World, fate: FateQueue, rng: Rng, gaia: EntityId): void {
  /** Tire une entité vivante d'un kind donné sur la planète (parent potentiel). */
  const pickOnPlanet = (kind: string): EntityId | null => {
    const candidates: EntityId[] = [];
    for (const [entity, species] of world.query(Species)) {
      if (species.kind === kind && world.get(entity, OnPlanet)?.planet === gaia) candidates.push(entity);
    }
    if (candidates.length === 0) return null;
    return candidates[rng.int(0, candidates.length - 1)] ?? null;
  };

  const countOnPlanet = (kind: string): number => {
    let n = 0;
    for (const [entity, species] of world.query(Species)) {
      if (species.kind === kind && world.get(entity, OnPlanet)?.planet === gaia) n++;
    }
    return n;
  };

  const clampX = (x: number): number => Math.max(-SURFACE_HALF_WIDTH * 0.95, Math.min(SURFACE_HALF_WIDTH * 0.95, x));
  const clampY = (y: number): number => Math.max(-SURFACE_HALF_HEIGHT * 0.95, Math.min(SURFACE_HALF_HEIGHT * 0.95, y));

  /** Une graine ne germe pas sous l'eau — et comme la mer S'ÉTEND, elle
   *  repousse naturellement la forêt au fil des ticks. */
  const isUnderwater = (x: number, y: number): boolean => {
    for (const [entity, species] of world.query(Species)) {
      if (species.kind !== 'lake' || world.get(entity, OnPlanet)?.planet !== gaia) continue;
      const pos = world.get(entity, Position);
      const size = world.get(entity, Size);
      if (!pos || !size) continue;
      if ((x - pos.x) ** 2 + (y - pos.y) ** 2 < size.size ** 2) return true;
    }
    return false;
  };

  fate.onKind(FATE_FOREST_SEED, (w, event) => {
    if (countOnPlanet('tree') < MAX_TREES) {
      const parent = pickOnPlanet('tree');
      const pos = parent !== null ? w.get(parent, Position) : null;
      // Une graine tombe près d'un arbre existant ; sans forêt, le vent la porte n'importe où.
      const x = clampX((pos?.x ?? rng.range(-500, 500)) + rng.range(-80, 80));
      const y = clampY((pos?.y ?? rng.range(-350, 350)) + rng.range(-80, 80));
      if (!isUnderwater(x, y)) {
        const tree = spawnTree(w, fate, { x, y, lifespan: rng.int(3000, 9000), maxSize: rng.range(2, 4) });
        w.add(tree, OnPlanet, { planet: gaia });
      }
    }
    // Auto-reconduction : le cycle se replanifie lui-même sur la planète.
    fate.schedule(w.tick + rng.int(60, 180), event.entity, FATE_FOREST_SEED);
  });

  fate.onKind(FATE_VILLAGE_BIRTH, (w, event) => {
    if (countOnPlanet('person') < MAX_PEOPLE) {
      const parent = pickOnPlanet('person');
      const pos = parent !== null ? w.get(parent, Position) : null;
      if (pos) {
        const person = spawnPerson(w, fate, {
          x: clampX(pos.x + rng.range(-30, 30)),
          y: clampY(pos.y + rng.range(-30, 30)),
          lifespan: rng.int(1500, 4000),
          rng,
        });
        w.add(person, OnPlanet, { planet: gaia });
        w.emit({ kind: 'birth', entity: person, tick: w.tick });
      }
      // Sans parent vivant, pas de naissance : l'extinction est définitive
      // (sauf intervention divine) — mais le cycle continue d'attendre.
    }
    fate.schedule(w.tick + rng.int(120, 300), event.entity, FATE_VILLAGE_BIRTH);
  });

  fate.schedule(world.tick + rng.int(60, 180), gaia, FATE_FOREST_SEED);
  fate.schedule(world.tick + rng.int(120, 300), gaia, FATE_VILLAGE_BIRTH);
}

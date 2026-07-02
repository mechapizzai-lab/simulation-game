/**
 * Archétypes : fonctions de fabrique qui assemblent entité + components +
 * destin initial. C'est ici (et nulle part ailleurs) que naissance et destin
 * sont couplés : à la création, la date de mort est calculée et poussée dans
 * la Fate Queue. Sous Godot, ces fabriques deviendront des PackedScene +
 * un script d'initialisation du destin.
 */
import { World, type EntityId } from './ecs.js';
import { FateQueue } from './fate.js';
import {
  Age,
  GrowthRate,
  Health,
  Lifespan,
  Orbit,
  Position,
  Size,
  Species,
  Wanderer,
} from './components.js';
import type { Rng } from './rng.js';

export const FATE_DEATH = 'death';
export const FATE_MATURITY = 'maturity';

/** Branche les handlers des destins standards. À appeler une fois au boot. */
export function registerStandardFates(fate: FateQueue): void {
  fate.onKind(FATE_DEATH, (world, event) => {
    // La mort EST la réalisation du destin : l'entité disparaît du monde.
    world.emit({ kind: 'death', entity: event.entity, tick: world.tick });
    world.destroyEntity(event.entity);
  });
  fate.onKind(FATE_MATURITY, (world, event) => {
    // Maturité : la croissance s'arrête (l'arbre adulte cesse de pousser).
    world.remove(event.entity, GrowthRate);
    world.emit({ kind: 'maturity', entity: event.entity, tick: world.tick });
  });
}

/** Naissance d'une personne : mort planifiée dès maintenant, destin lisible. */
export function spawnPerson(
  world: World,
  fate: FateQueue,
  opts: { x: number; y: number; lifespan: number; speed?: number; range?: number; rng: Rng },
): EntityId {
  const e = world.createEntity();
  world.add(e, Species, { kind: 'person', label: 'Personne' });
  world.add(e, Position, { x: opts.x, y: opts.y });
  world.add(e, Age, { ticks: 0 });
  world.add(e, Lifespan, { max: opts.lifespan });
  world.add(e, Health, { current: 100, max: 100 });
  world.add(e, Size, { size: 0.5 });
  world.add(e, GrowthRate, { perTick: 0.5 / (opts.lifespan * 0.2), maxSize: 1 });
  world.add(e, Wanderer, {
    heading: opts.rng.range(0, Math.PI * 2),
    ticksUntilTurn: opts.rng.int(20, 80),
    speed: opts.speed ?? 0.35,
    homeX: opts.x,
    homeY: opts.y,
    range: opts.range ?? 60,
  });
  fate.schedule(world.tick + opts.lifespan, e, FATE_DEATH);
  // Fin de croissance à ~20% de la vie : un 2e événement pour peupler la timeline.
  fate.schedule(world.tick + Math.round(opts.lifespan * 0.2), e, FATE_MATURITY);
  return e;
}

export function spawnTree(
  world: World,
  fate: FateQueue,
  opts: { x: number; y: number; lifespan: number; maxSize?: number },
): EntityId {
  const e = world.createEntity();
  const maxSize = opts.maxSize ?? 3;
  world.add(e, Species, { kind: 'tree', label: 'Arbre' });
  world.add(e, Position, { x: opts.x, y: opts.y });
  world.add(e, Age, { ticks: 0 });
  world.add(e, Lifespan, { max: opts.lifespan });
  world.add(e, Size, { size: 0.1 });
  // Un arbre atteint sa taille adulte à mi-vie environ.
  world.add(e, GrowthRate, { perTick: maxSize / (opts.lifespan * 0.5), maxSize });
  fate.schedule(world.tick + opts.lifespan, e, FATE_DEATH);
  return e;
}

export function spawnStar(world: World, opts: { x: number; y: number; size: number }): EntityId {
  const e = world.createEntity();
  world.add(e, Species, { kind: 'star', label: 'Étoile' });
  world.add(e, Position, { x: opts.x, y: opts.y });
  world.add(e, Size, { size: opts.size });
  return e;
}

export function spawnPlanet(
  world: World,
  opts: { center: EntityId; radius: number; angularSpeed: number; phase: number; size: number; label?: string },
): EntityId {
  const e = world.createEntity();
  world.add(e, Species, { kind: 'planet', label: opts.label ?? 'Planète' });
  world.add(e, Position, { x: 0, y: 0 }); // écrasée par OrbitSystem dès le 1er tick
  world.add(e, Size, { size: opts.size });
  world.add(e, Orbit, {
    center: opts.center,
    radius: opts.radius,
    angularSpeed: opts.angularSpeed,
    phase: opts.phase,
  });
  return e;
}

/**
 * Édition divine de l'espérance de vie : change la règle (Lifespan.max) ET
 * replanifie la mort en conséquence. La nouvelle date est calculée depuis
 * l'âge déjà vécu — allonger la vie d'un mourant le sauve, la raccourcir sous
 * son âge actuel le condamne au prochain tick (jamais dans le passé).
 */
export function applyLifespanEdit(
  world: World,
  fate: FateQueue,
  entity: EntityId,
  newMax: number,
): void {
  const lifespan = world.get(entity, Lifespan);
  const age = world.get(entity, Age);
  if (!lifespan || !age) return;
  lifespan.max = newMax;
  const deathTick = Math.max(world.tick + 1, world.tick + (newMax - age.ticks));
  const death = fate.eventsFor(entity).find((ev) => ev.kind === FATE_DEATH);
  if (death) fate.reschedule(death.id, Math.round(deathTick));
  else fate.schedule(Math.round(deathTick), entity, FATE_DEATH);
}

/**
 * Systems de base : chacun fait progresser UN aspect continu du monde à chaque
 * tick. Les événements ponctuels (mort, métamorphose) ne vivent pas ici mais
 * dans la Fate Queue — les systems ne gèrent que l'évolution fluide.
 */
import { World, type System } from './ecs.js';
import { Age, GrowthRate, Orbit, Position, Size, Velocity, Wanderer } from './components.js';
import type { Rng } from './rng.js';

/** Vieillissement continu : rend l'âge observable tick par tick (le rendu peut
 *  p.ex. grisonner un sprite), indépendamment de la date de mort planifiée. */
export const AgingSystem: System = {
  name: 'aging',
  update(world: World): void {
    for (const [, age] of world.query(Age)) {
      age.ticks += 1;
    }
  },
};

/** Croissance continue vers un plafond (arbres, créatures juvéniles...). */
export const GrowthSystem: System = {
  name: 'growth',
  update(world: World): void {
    for (const [entity, rate] of world.query(GrowthRate)) {
      const size = world.get(entity, Size);
      if (!size) continue;
      size.size = Math.min(rate.maxSize, size.size + rate.perTick);
    }
  },
};

/** Intégration de vitesse basique. */
export const MovementSystem: System = {
  name: 'movement',
  update(world: World): void {
    for (const [entity, vel] of world.query(Velocity)) {
      const pos = world.get(entity, Position);
      if (!pos) continue;
      pos.x += vel.vx;
      pos.y += vel.vy;
    }
  },
};

/**
 * Orbites paramétriques : la position est une fonction pure du tick absolu.
 * Avantage décisif pour la vitesse variable : à x100 on peut sauter des rendus
 * sans accumuler d'erreur d'intégration.
 */
export const OrbitSystem: System = {
  name: 'orbit',
  update(world: World, tick: number): void {
    for (const [entity, orbit] of world.query(Orbit)) {
      const pos = world.get(entity, Position);
      if (!pos) continue;
      const centerPos = orbit.center !== 0 ? world.get(orbit.center, Position) : undefined;
      const cx = centerPos?.x ?? 0;
      const cy = centerPos?.y ?? 0;
      const angle = orbit.phase + orbit.angularSpeed * tick;
      pos.x = cx + Math.cos(angle) * orbit.radius;
      pos.y = cy + Math.sin(angle) * orbit.radius;
    }
  },
};

/** Errance : cap conservé quelques ticks puis re-tiré au hasard (RNG seedé),
 *  avec rappel doux vers le point d'attache pour rester dans sa zone. */
export function createWandererSystem(rng: Rng): System {
  return {
    name: 'wanderer',
    update(world: World): void {
      for (const [entity, w] of world.query(Wanderer)) {
        const pos = world.get(entity, Position);
        if (!pos) continue;
        w.ticksUntilTurn -= 1;
        if (w.ticksUntilTurn <= 0) {
          w.heading = rng.range(0, Math.PI * 2);
          w.ticksUntilTurn = rng.int(20, 80);
        }
        // Trop loin de chez soi : on vise la maison au lieu du cap aléatoire.
        const dx = pos.x - w.homeX;
        const dy = pos.y - w.homeY;
        if (dx * dx + dy * dy > w.range * w.range) {
          w.heading = Math.atan2(-dy, -dx);
        }
        pos.x += Math.cos(w.heading) * w.speed;
        pos.y += Math.sin(w.heading) * w.speed;
      }
    },
  };
}

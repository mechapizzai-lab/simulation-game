/**
 * Horloge de simulation : convertit le temps réel en ticks.
 *
 * Le tick est l'unité de temps CANONIQUE : toute la logique (systems, Fate
 * Queue) ne connaît que lui. Changer la vitesse == changer combien de ticks
 * on exécute par seconde réelle ; on n'altère jamais la logique d'un tick.
 * Sous Godot, cette classe deviendra le _process(delta) d'un noeud
 * SimulationDriver appelant world.step() en rafale.
 */
import type { World } from './ecs.js';

/** Ticks simulés par seconde réelle à vitesse x1. 20 t/s rend le mouvement
 *  fluide à l'œil sans exiger d'interpolation dans le rendu du prototype. */
export const BASE_TICKS_PER_SECOND = 20;

/** Garde-fou anti "spirale de la mort" : si un cadre est en retard de plus de
 *  N ticks (onglet en arrière-plan, x100 sur machine lente), on écrête. */
const MAX_TICKS_PER_FRAME = 400;

export type SpeedMultiplier = 0 | 1 | 10 | 100;

export class SimulationClock {
  speed: SpeedMultiplier = 1;
  private accumulator = 0;

  constructor(private readonly world: World) {}

  /** À appeler chaque frame avec le delta réel en secondes.
   *  Renvoie le nombre de ticks exécutés (utile au debug/HUD). */
  advance(dtSeconds: number): number {
    if (this.speed === 0) {
      this.accumulator = 0; // en pause on ne "doit" rien au temps qui passe
      return 0;
    }
    this.accumulator += dtSeconds * BASE_TICKS_PER_SECOND * this.speed;
    let ticks = Math.floor(this.accumulator);
    this.accumulator -= ticks;
    if (ticks > MAX_TICKS_PER_FRAME) {
      ticks = MAX_TICKS_PER_FRAME;
      this.accumulator = 0; // on abandonne le retard plutôt que de geler l'UI
    }
    for (let i = 0; i < ticks; i++) this.world.step();
    return ticks;
  }
}

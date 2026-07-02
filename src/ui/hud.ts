/**
 * HUD : contrôles de vitesse + compteurs. La vitesse ne touche qu'à la
 * SimulationClock — preuve vivante que vitesse == fréquence de ticks.
 */
import type { World } from '../simulation/ecs.js';
import type { SimulationClock, SpeedMultiplier } from '../simulation/loop.js';

const SPEEDS: { value: SpeedMultiplier; label: string }[] = [
  { value: 0, label: '⏸' },
  { value: 1, label: 'x1' },
  { value: 10, label: 'x10' },
  { value: 100, label: 'x100' },
];

export class Hud {
  private readonly tickStat: HTMLElement;
  private readonly popStat: HTMLElement;
  private readonly buttons = new Map<SpeedMultiplier, HTMLButtonElement>();

  constructor(
    container: HTMLElement,
    private readonly clock: SimulationClock,
    private readonly world: World,
    /** Tant que la règle Temps n'est pas codée, la vitesse n'a pas de sens. */
    private readonly timeExists: () => boolean = () => true,
  ) {
    for (const { value, label } of SPEEDS) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        this.clock.speed = value;
        this.refreshButtons();
      });
      this.buttons.set(value, btn);
      container.appendChild(btn);
    }
    this.tickStat = document.createElement('span');
    this.tickStat.className = 'stat';
    this.popStat = document.createElement('span');
    this.popStat.className = 'stat';
    container.append(this.tickStat, this.popStat);
    this.refreshButtons();
  }

  private refreshButtons(): void {
    for (const [value, btn] of this.buttons) {
      btn.classList.toggle('active', this.clock.speed === value);
    }
  }

  update(): void {
    const frozen = !this.timeExists();
    this.tickStat.innerHTML = frozen ? 'le temps n\'existe pas' : `tick <b>${this.world.tick}</b>`;
    this.popStat.innerHTML = `entités <b>${this.world.entityCount}</b>`;
    for (const btn of this.buttons.values()) btn.disabled = frozen;
  }
}

/**
 * L'éditeur de règles : LE point d'entrée du jeu. C'est ici que le joueur
 * code l'univers — active des règles selon l'arbre de dépendances, arbitre le
 * budget, ajuste les paramètres (lus en direct par la simulation), et lit le
 * journal des jalons d'émergence qui financent sa progression.
 *
 * Même contrat que le panneau divin : AUCUNE logique de jeu ici, uniquement
 * des appels au RuleEngine — l'habillage sera réécrit en Control nodes Godot.
 */
import type { World } from '../simulation/ecs.js';
import { RuleEngine, type RuleDef } from '../simulation/rules.js';

interface RuleCard {
  def: RuleDef;
  root: HTMLElement;
  status: HTMLElement;
  button: HTMLButtonElement;
  paramsBox: HTMLElement;
  paramInputs: { input: HTMLInputElement; key: string }[];
}

export class RulesPanel {
  private readonly cards: RuleCard[] = [];
  private readonly budgetFill: HTMLElement;
  private readonly budgetText: HTMLElement;
  private readonly log: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly engine: RuleEngine,
    private readonly world: World,
  ) {
    const title = document.createElement('h2');
    title.textContent = 'Code de l\'univers';
    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'chaque règle coûte du calcul — l\'émergence en rapporte';
    root.append(title, subtitle);

    const budget = document.createElement('div');
    budget.className = 'budget';
    this.budgetText = document.createElement('div');
    this.budgetText.className = 'budget-text';
    const bar = document.createElement('div');
    bar.className = 'budget-bar';
    this.budgetFill = document.createElement('div');
    this.budgetFill.className = 'budget-fill';
    bar.appendChild(this.budgetFill);
    budget.append(this.budgetText, bar);
    root.appendChild(budget);

    for (const def of engine.all) root.appendChild(this.buildCard(def));

    const logTitle = document.createElement('h3');
    logTitle.textContent = 'Journal de l\'émergence';
    this.log = document.createElement('div');
    this.log.className = 'log';
    root.append(logTitle, this.log);

    engine.onEvent((e) => {
      if (e.kind === 'milestone') this.addLogEntry(`✦ ${e.detail ?? e.id}`, true);
      else if (e.kind === 'activated') this.addLogEntry(`+ ${engine.get(e.id).label} codée`);
      else if (e.kind === 'deactivated') this.addLogEntry(`− ${engine.get(e.id).label} coupée`);
    });
    this.addLogEntry('Le Vide. Rien n\'existe. À vous d\'écrire la première règle.');
  }

  private buildCard(def: RuleDef): HTMLElement {
    const root = document.createElement('div');
    root.className = 'rule';
    // Indentation par profondeur : l'arbre se lit dans la mise en page.
    root.style.marginLeft = `${this.depthOf(def) * 12}px`;

    const head = document.createElement('div');
    head.className = 'rule-head';
    const name = document.createElement('span');
    name.className = 'rule-name';
    name.textContent = def.label;
    const cost = document.createElement('span');
    cost.className = 'rule-cost';
    cost.textContent = `${def.cost} ⚙`;
    head.append(name, cost);

    const desc = document.createElement('div');
    desc.className = 'rule-desc';
    desc.textContent = def.description;

    const status = document.createElement('div');
    status.className = 'rule-status';

    const paramsBox = document.createElement('div');
    paramsBox.className = 'rule-params';
    const paramInputs: RuleCard['paramInputs'] = [];
    for (const p of def.params) {
      const row = document.createElement('div');
      row.className = 'field';
      const label = document.createElement('label');
      label.textContent = p.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(p.step);
      input.min = String(p.min);
      input.max = String(p.max);
      input.value = String(p.default);
      input.addEventListener('change', () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) this.engine.setParam(def.id, p.key, v);
      });
      row.append(label, input);
      paramsBox.appendChild(row);
      paramInputs.push({ input, key: p.key });
    }

    const button = document.createElement('button');
    button.className = 'rule-action';
    button.addEventListener('click', () => {
      if (this.engine.isActive(def.id)) this.engine.deactivate(def.id);
      else this.engine.activate(def.id, this.world);
    });

    root.append(head, desc, status, paramsBox, button);
    this.cards.push({ def, root, status, button, paramsBox, paramInputs });
    return root;
  }

  private depthOf(def: RuleDef): number {
    let depth = 0;
    let current = def;
    while (current.requires.length > 0) {
      current = this.engine.get(current.requires[0] as string);
      depth++;
    }
    return depth;
  }

  private addLogEntry(text: string, highlight = false): void {
    const entry = document.createElement('div');
    entry.className = highlight ? 'log-entry highlight' : 'log-entry';
    entry.textContent = `[${this.world.tick}] ${text}`;
    this.log.prepend(entry);
    while (this.log.children.length > 30) this.log.lastChild?.remove();
  }

  /** À appeler chaque frame : états, budget, blocages — sans casser la saisie. */
  update(): void {
    this.budgetText.textContent = `calcul : ${this.engine.used} / ${this.engine.capacity}`;
    const ratio = this.engine.capacity > 0 ? this.engine.used / this.engine.capacity : 0;
    this.budgetFill.style.width = `${Math.min(100, ratio * 100)}%`;
    this.budgetFill.classList.toggle('full', ratio >= 0.999);

    for (const card of this.cards) {
      const active = this.engine.isActive(card.def.id);
      const blocker = this.engine.activationBlocker(card.def.id, this.world);
      card.root.classList.toggle('active', active);
      card.root.classList.toggle('locked', !active && blocker !== null);
      card.paramsBox.style.display = active && card.def.params.length > 0 ? 'block' : 'none';
      if (active) {
        card.status.textContent = 'active';
        card.button.textContent = 'Couper';
        card.button.disabled = false;
      } else if (blocker === null) {
        card.status.textContent = 'prête à être codée';
        card.button.textContent = 'Coder';
        card.button.disabled = false;
      } else {
        card.status.textContent = blocker;
        card.button.textContent = 'Coder';
        card.button.disabled = true;
      }
      for (const { input, key } of card.paramInputs) {
        if (document.activeElement === input) continue;
        input.value = String(this.engine.param(card.def.id, key));
      }
    }
  }
}

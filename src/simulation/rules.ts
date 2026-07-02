/**
 * Moteur de règles : l'arbre de dépendances, le budget de calcul et les
 * paramètres éditables. C'est le "compilateur" du code divin — générique et
 * pur (aucune connaissance des règles concrètes, définies dans cosmos.ts).
 *
 * ── Principes de conception (à maintenir dans tout le développement) ──
 *
 * 1. RÈGLE = PROCESSUS, ENTITÉ = PRODUIT. Désactiver une règle arrête son
 *    processus (plus de nouvelle matière, plus de fusion...) mais ne détruit
 *    JAMAIS ses produits : les amas restent amassés, les étoiles restent
 *    allumées. C'est ce qui rend la désactivation stratégique et non punitive.
 *
 * 2. RÉTROACTIVITÉ À DEUX NIVEAUX (comportement contractuel, testé) :
 *    a) Les processus continus (systems) lisent les paramètres EN DIRECT à
 *       chaque tick : éditer `gravity.strength` change le monde dès le tick
 *       suivant, pour toutes les entités, anciennes comme nouvelles.
 *    b) Les événements déjà écrits dans la Fate Queue sont FIGÉS : ils ont été
 *       calculés avec les paramètres du moment de leur création et ne sont pas
 *       recalculés quand une règle change. Modifier une règle n'affecte que
 *       les destins écrits APRÈS la modification.
 *    Le scalpel rétroactif existe déjà : sélectionner UNE entité et replanifier
 *    ses événements à la main (panneau divin). Règle générale douce, outil
 *    chirurgical précis.
 *
 * 3. BUDGET PAR JALONS D'ÉMERGENCE : la capacité de calcul augmente quand
 *    l'univers franchit un seuil observable (première étoile...). Le joueur
 *    finance la règle suivante en OBSERVANT le résultat de la précédente —
 *    la boucle coder → observer → intervenir est aussi la boucle d'économie.
 *
 * 4. INTERVENIR BRÛLE DU CALCUL : réécrire un destin déjà écrit (annuler un
 *    impact, repousser une mort) consomme du calcul LIBRE (capacité − règles
 *    actives). Le calcul brûlé se régénère lentement — chaque intervention
 *    est donc un arbitrage : sauver ce monde maintenant, c'est ne pas pouvoir
 *    coder ou sauver autre chose tout de suite. En fin de partie, couper les
 *    règles de cosmogonie devenues inutiles (Matière, Agrégation...) est LE
 *    moyen de libérer du calcul d'intervention : les produits persistent.
 */
import type { World } from './ecs.js';

export interface RuleParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface RuleDef {
  id: string;
  label: string;
  /** Ce que la règle FAIT — affiché au joueur avant activation. */
  description: string;
  requires: string[];
  /** Coût en ressources de simulation tant que la règle est active. */
  cost: number;
  params: RuleParamSpec[];
  /** Prérequis d'état du monde (ex: "une planète refroidie existe"), en plus
   *  des dépendances de règles. Réévalué à chaque tentative d'activation. */
  worldRequirement?: {
    label: string;
    check: (world: World) => boolean;
  };
}

export interface Milestone {
  id: string;
  label: string;
  /** Capacité de calcul gagnée quand le jalon est franchi. */
  reward: number;
  check: (world: World) => boolean;
}

export type RuleEventListener = (event: {
  kind: 'activated' | 'deactivated' | 'milestone' | 'param-changed' | 'spent';
  id: string;
  detail?: string;
}) => void;

/** Ticks pour régénérer 1 point de calcul brûlé par une intervention. */
const BURN_REGEN_TICKS = 250;

export class RuleEngine {
  private readonly defs = new Map<string, RuleDef>();
  private readonly active = new Set<string>();
  /** Règles codées au moins une fois. Les DÉPENDANCES se testent ici, pas sur
   *  `active` : une dépendance est un savoir déjà écrit, pas un processus en
   *  marche. C'est ce qui permet le dilemme central du budget — couper
   *  l'Agrégation pour financer la Fusion, qui en descend pourtant. */
  private readonly everCoded = new Set<string>();
  /** Valeurs courantes des paramètres — lues EN DIRECT par les systems. */
  private readonly params = new Map<string, Record<string, number>>();
  private readonly milestones: Milestone[] = [];
  private readonly reached = new Set<string>();
  private readonly listeners: RuleEventListener[] = [];
  /** Calcul brûlé par les interventions, en cours de régénération (flottant
   *  interne, arrondi vers le haut à l'affichage et dans les vérifications). */
  private burnedValue = 0;
  private everIntervened = false;

  capacity: number;

  constructor(initialCapacity: number) {
    this.capacity = initialCapacity;
  }

  define(def: RuleDef): void {
    this.defs.set(def.id, def);
    const values: Record<string, number> = {};
    for (const p of def.params) values[p.key] = p.default;
    this.params.set(def.id, values);
  }

  defineMilestone(m: Milestone): void {
    this.milestones.push(m);
  }

  onEvent(l: RuleEventListener): void {
    this.listeners.push(l);
  }

  private emit(event: Parameters<RuleEventListener>[0]): void {
    for (const l of this.listeners) l(event);
  }

  get all(): RuleDef[] {
    return [...this.defs.values()];
  }

  get(id: string): RuleDef {
    const def = this.defs.get(id);
    if (!def) throw new Error(`Unknown rule "${id}"`);
    return def;
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  get used(): number {
    let sum = 0;
    for (const id of this.active) sum += this.get(id).cost;
    return sum;
  }

  get burned(): number {
    return Math.ceil(this.burnedValue);
  }

  /** Calcul immédiatement disponible pour coder une règle ou intervenir. */
  get free(): number {
    return this.capacity - this.used - this.burned;
  }

  /**
   * Brûle du calcul libre pour une intervention (réécriture de destin).
   * Refuse si le libre ne suffit pas — l'appelant affiche la raison.
   * La toute première intervention paie un jalon : apprendre à réécrire le
   * destin EST une émergence (celle du joueur).
   */
  spend(amount: number, reason: string): boolean {
    if (amount > this.free) return false;
    this.burnedValue += amount;
    this.emit({ kind: 'spent', id: reason, detail: `−${amount} calcul` });
    if (!this.everIntervened) {
      this.everIntervened = true;
      this.capacity += 2;
      this.emit({ kind: 'milestone', id: 'm-rewrite', detail: 'Premier destin réécrit : capacité +2' });
    }
    return true;
  }

  /** À appeler chaque tick : le calcul brûlé se régénère lentement. */
  regen(dtTicks: number): void {
    this.burnedValue = Math.max(0, this.burnedValue - dtTicks / BURN_REGEN_TICKS);
  }

  /** Paramètre courant d'une règle — LE point d'accès des systems (lecture
   *  en direct : c'est le niveau (a) de la rétroactivité). */
  param(ruleId: string, key: string): number {
    const values = this.params.get(ruleId);
    const v = values?.[key];
    if (v === undefined) throw new Error(`Unknown param ${ruleId}.${key}`);
    return v;
  }

  setParam(ruleId: string, key: string, value: number): void {
    const def = this.get(ruleId);
    const spec = def.params.find((p) => p.key === key);
    const values = this.params.get(ruleId);
    if (!spec || !values) throw new Error(`Unknown param ${ruleId}.${key}`);
    values[key] = Math.min(spec.max, Math.max(spec.min, value));
    this.emit({ kind: 'param-changed', id: ruleId, detail: key });
  }

  /** Pourquoi la règle n'est pas activable — ou null si elle l'est.
   *  Renvoyer la RAISON (pas juste false) : l'UI doit l'afficher, le joueur
   *  doit toujours comprendre ce qui le bloque. */
  activationBlocker(id: string, world: World): string | null {
    const def = this.get(id);
    if (this.active.has(id)) return 'déjà active';
    for (const dep of def.requires) {
      if (!this.everCoded.has(dep)) return `requiert ${this.get(dep).label}`;
    }
    if (def.worldRequirement && !def.worldRequirement.check(world)) {
      return `requiert ${def.worldRequirement.label}`;
    }
    if (this.used + this.burned + def.cost > this.capacity) {
      return `budget insuffisant (${this.used + this.burned + def.cost}/${this.capacity})`;
    }
    return null;
  }

  activate(id: string, world: World): boolean {
    if (this.activationBlocker(id, world) !== null) return false;
    this.active.add(id);
    this.everCoded.add(id);
    this.emit({ kind: 'activated', id });
    return true;
  }

  wasEverCoded(id: string): boolean {
    return this.everCoded.has(id);
  }

  /** Toute règle active peut être coupée : ses dépendantes restent actives
   *  (le savoir acquis ne s'oublie pas), seul SON processus s'arrête. */
  deactivationBlocker(id: string): string | null {
    if (!this.active.has(id)) return 'inactive';
    return null;
  }

  deactivate(id: string): boolean {
    if (this.deactivationBlocker(id) !== null) return false;
    this.active.delete(id);
    this.emit({ kind: 'deactivated', id });
    return true;
  }

  /** À appeler périodiquement : franchit les jalons dont la condition est
   *  remplie et crédite la capacité. Idempotent (un jalon ne paie qu'une fois). */
  checkMilestones(world: World): void {
    for (const m of this.milestones) {
      if (this.reached.has(m.id)) continue;
      if (!m.check(world)) continue;
      this.reached.add(m.id);
      this.capacity += m.reward;
      this.emit({ kind: 'milestone', id: m.id, detail: `${m.label} : capacité +${m.reward}` });
    }
  }

  hasReached(milestoneId: string): boolean {
    return this.reached.has(milestoneId);
  }

  get reachedMilestones(): Milestone[] {
    return this.milestones.filter((m) => this.reached.has(m.id));
  }
}

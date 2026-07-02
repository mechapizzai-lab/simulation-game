/**
 * Moteur ECS minimal, sans aucune dépendance de rendu.
 *
 * Choix pour le portage Godot :
 * - Les entités sont de simples entiers ; les components des objets de données purs.
 *   En Godot, chaque ComponentStore deviendra un Dictionary (GDScript) ou un
 *   Dictionary<int, T> (C#) — aucune classe ici ne dépend du DOM ou de Canvas.
 * - Les Systems reçoivent le World et le tick courant : la même signature se
 *   traduira en une méthode `_physics_process`-indépendante appelée par un
 *   noeud "SimulationDriver" côté Godot.
 */

export type EntityId = number;

/**
 * Jeton typé identifiant un type de component. On passe par un objet (et non
 * une string nue) pour que TypeScript relie le jeton au type de données T :
 * `world.get(e, Lifespan)` renvoie un `LifespanData`, jamais un `unknown`.
 */
export interface ComponentType<T> {
  readonly name: string;
  /** Fantôme de typage : jamais assigné à l'exécution. */
  readonly _phantom?: T;
}

export function defineComponent<T>(name: string): ComponentType<T> {
  return { name };
}

export interface System {
  readonly name: string;
  /** Appelé une fois par tick. dtTicks vaut toujours 1 pour l'instant, mais on
   *  le passe explicitement pour pouvoir plus tard "batcher" des ticks à très
   *  haute vitesse sans réécrire les systems. */
  update(world: World, tick: number, dtTicks: number): void;
}

/** Écouteur générique d'événements du monde (mort d'une entité, etc.).
 *  Le rendu et l'UI s'abonnent ici au lieu que la simulation les connaisse. */
export type WorldEventListener = (event: WorldEvent) => void;

export interface WorldEvent {
  readonly kind: string;
  readonly entity: EntityId;
  readonly tick: number;
  readonly data?: unknown;
}

export class World {
  private nextEntityId: EntityId = 1;
  private readonly alive = new Set<EntityId>();
  /** Un Map par type de component ; la clé externe est le nom du jeton. */
  private readonly stores = new Map<string, Map<EntityId, unknown>>();
  private readonly systems: System[] = [];
  private readonly listeners: WorldEventListener[] = [];

  /** Tick courant de la simulation. Ne progresse que via step(). */
  tick = 0;

  createEntity(): EntityId {
    const id = this.nextEntityId++;
    this.alive.add(id);
    return id;
  }

  destroyEntity(id: EntityId): void {
    if (!this.alive.delete(id)) return;
    for (const store of this.stores.values()) store.delete(id);
    this.emit({ kind: 'entity-destroyed', entity: id, tick: this.tick });
  }

  isAlive(id: EntityId): boolean {
    return this.alive.has(id);
  }

  get entityCount(): number {
    return this.alive.size;
  }

  private store<T>(type: ComponentType<T>): Map<EntityId, T> {
    let s = this.stores.get(type.name);
    if (!s) {
      s = new Map();
      this.stores.set(type.name, s);
    }
    return s as Map<EntityId, T>;
  }

  add<T>(entity: EntityId, type: ComponentType<T>, value: T): void {
    if (!this.alive.has(entity)) throw new Error(`Entity ${entity} is not alive`);
    this.store(type).set(entity, value);
  }

  get<T>(entity: EntityId, type: ComponentType<T>): T | undefined {
    return this.store(type).get(entity);
  }

  /** Variante stricte pour les systems qui viennent de vérifier la présence. */
  getRequired<T>(entity: EntityId, type: ComponentType<T>): T {
    const v = this.store(type).get(entity);
    if (v === undefined) throw new Error(`Entity ${entity} lacks component ${type.name}`);
    return v;
  }

  has<T>(entity: EntityId, type: ComponentType<T>): boolean {
    return this.store(type).has(entity);
  }

  remove<T>(entity: EntityId, type: ComponentType<T>): void {
    this.store(type).delete(entity);
  }

  /**
   * Itère sur toutes les entités possédant le component donné.
   * On itère sur une copie des clés pour autoriser création/destruction
   * d'entités pendant l'itération (naissances, morts en plein tick).
   */
  *query<T>(type: ComponentType<T>): IterableIterator<[EntityId, T]> {
    const s = this.store(type);
    for (const id of [...s.keys()]) {
      if (!this.alive.has(id)) continue;
      const v = s.get(id);
      if (v !== undefined) yield [id, v];
    }
  }

  addSystem(system: System): void {
    this.systems.push(system);
  }

  onEvent(listener: WorldEventListener): void {
    this.listeners.push(listener);
  }

  emit(event: WorldEvent): void {
    for (const l of this.listeners) l(event);
  }

  /**
   * Fait avancer la simulation d'exactement un tick.
   * La vitesse (x1/x10/x100) se règle en appelant step() plus ou moins souvent
   * — jamais en changeant la logique interne. C'est ce qui garantit qu'une
   * simulation à x100 donne un état identique à la même simulation à x1.
   */
  step(): void {
    this.tick++;
    for (const system of this.systems) system.update(this, this.tick, 1);
  }
}

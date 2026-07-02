/**
 * Fate Queue : le "destin" pré-calculé des entités.
 *
 * Principe central du game design : quand une entité naît, ses événements
 * futurs (mort, métamorphose...) sont calculés immédiatement et placés dans
 * une min-heap indexée par tick. La boucle de simulation, qui avance tick par
 * tick SANS jamais sauter, "rencontre" naturellement ces événements quand leur
 * tick arrive. Le joueur peut lire et réécrire ce destin tant qu'il n'est pas
 * réalisé — c'est le cœur du fantasme "coder l'univers".
 *
 * Portage Godot : structure de données pure (tableau-heap + Maps), traduction
 * directe en GDScript/C#. Aucune dépendance extérieure.
 */
import type { EntityId, World } from './ecs.js';

export type FateEventId = number;

export interface FateEvent {
  readonly id: FateEventId;
  readonly entity: EntityId;
  readonly kind: string;
  /** Tick auquel l'événement doit se réaliser. Muté uniquement via reschedule(). */
  tick: number;
  data?: unknown;
}

/** La logique déclenchée par un kind d'événement (ex: 'death' → destroyEntity).
 *  Enregistrée à part pour que la queue reste de la donnée sérialisable. */
export type FateHandler = (world: World, event: FateEvent) => void;

interface HeapNode {
  event: FateEvent;
  /** Ordre d'insertion : départage les événements du même tick de façon stable. */
  seq: number;
  cancelled: boolean;
}

export class FateQueue {
  private heap: HeapNode[] = [];
  private seqCounter = 0;
  private nextId: FateEventId = 1;
  /** Index par id pour cancel/reschedule en O(1) (l'annulation est paresseuse :
   *  le nœud reste dans la heap, marqué, et sera ignoré au pop). */
  private readonly byId = new Map<FateEventId, HeapNode>();
  /** Index par entité pour afficher la timeline d'une entité sélectionnée. */
  private readonly byEntity = new Map<EntityId, Set<HeapNode>>();
  private readonly handlers = new Map<string, FateHandler>();

  onKind(kind: string, handler: FateHandler): void {
    this.handlers.set(kind, handler);
  }

  schedule(tick: number, entity: EntityId, kind: string, data?: unknown): FateEventId {
    const event: FateEvent = { id: this.nextId++, entity, kind, tick, data };
    const node: HeapNode = { event, seq: this.seqCounter++, cancelled: false };
    this.byId.set(event.id, node);
    let set = this.byEntity.get(entity);
    if (!set) {
      set = new Set();
      this.byEntity.set(entity, set);
    }
    set.add(node);
    this.push(node);
    return event.id;
  }

  cancel(id: FateEventId): boolean {
    const node = this.byId.get(id);
    if (!node || node.cancelled) return false;
    this.forget(node);
    return true;
  }

  /**
   * Déplace un événement à un autre tick — l'outil principal du joueur pour
   * réécrire un destin. On annule le nœud heap existant et on en re-pousse un
   * neuf portant le MÊME FateEvent (l'id survit, l'UI garde ses références).
   */
  reschedule(id: FateEventId, newTick: number): boolean {
    const node = this.byId.get(id);
    if (!node || node.cancelled) return false;
    node.cancelled = true; // l'ancien placement dans la heap devient un fantôme
    node.event.tick = newTick;
    const fresh: HeapNode = { event: node.event, seq: this.seqCounter++, cancelled: false };
    this.byId.set(node.event.id, fresh);
    const set = this.byEntity.get(node.event.entity);
    set?.delete(node);
    set?.add(fresh);
    this.push(fresh);
    return true;
  }

  /** Timeline des événements à venir d'une entité, triée par tick (pour l'UI). */
  eventsFor(entity: EntityId): FateEvent[] {
    const set = this.byEntity.get(entity);
    if (!set) return [];
    return [...set]
      .filter((n) => !n.cancelled)
      .map((n) => n.event)
      .sort((a, b) => a.tick - b.tick);
  }

  /** Prochain événement toutes entités confondues (debug / affichage global). */
  peek(): FateEvent | undefined {
    this.dropCancelledTop();
    return this.heap[0]?.event;
  }

  get pendingCount(): number {
    return this.byId.size;
  }

  /**
   * Réalise tous les événements dont le tick est atteint. Appelé une fois par
   * tick par le FateSystem : comme la boucle ne saute jamais de tick, chaque
   * événement est traité exactement à son tick prévu.
   */
  processDue(world: World): void {
    for (;;) {
      this.dropCancelledTop();
      const top = this.heap[0];
      if (!top || top.event.tick > world.tick) return;
      this.pop();
      this.forget(top);
      const handler = this.handlers.get(top.event.kind);
      if (!handler) throw new Error(`No fate handler for kind "${top.event.kind}"`);
      handler(world, top.event);
    }
  }

  /** Retire un nœud des index (réalisé ou annulé). */
  private forget(node: HeapNode): void {
    node.cancelled = true;
    this.byId.delete(node.event.id);
    const set = this.byEntity.get(node.event.entity);
    if (set) {
      set.delete(node);
      if (set.size === 0) this.byEntity.delete(node.event.entity);
    }
  }

  private dropCancelledTop(): void {
    while (this.heap.length > 0 && (this.heap[0] as HeapNode).cancelled) this.pop();
  }

  // --- Min-heap classique sur (tick, seq) ---

  private less(a: HeapNode, b: HeapNode): boolean {
    if (a.event.tick !== b.event.tick) return a.event.tick < b.event.tick;
    return a.seq < b.seq;
  }

  private push(node: HeapNode): void {
    this.heap.push(node);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.heap[i] as HeapNode, this.heap[parent] as HeapNode)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private pop(): HeapNode | undefined {
    const n = this.heap.length;
    if (n === 0) return undefined;
    this.swap(0, n - 1);
    const top = this.heap.pop() as HeapNode;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < this.heap.length && this.less(this.heap[l] as HeapNode, this.heap[smallest] as HeapNode)) smallest = l;
      if (r < this.heap.length && this.less(this.heap[r] as HeapNode, this.heap[smallest] as HeapNode)) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }

  private swap(i: number, j: number): void {
    const tmp = this.heap[i] as HeapNode;
    this.heap[i] = this.heap[j] as HeapNode;
    this.heap[j] = tmp;
  }
}

/** System branchant la Fate Queue sur la boucle : tourne AVANT les systems
 *  continus pour qu'une entité morte à ce tick ne bouge/grandisse plus. */
export function createFateSystem(fate: FateQueue): { name: string; update(world: World): void } {
  return {
    name: 'fate',
    update(world: World): void {
      fate.processDue(world);
    },
  };
}

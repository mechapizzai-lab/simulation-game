/**
 * Panneau de "code divin" : inspecter et éditer EN DIRECT les components de
 * l'entité sélectionnée, et lire/réécrire sa Fate Queue.
 *
 * Le panneau ne touche jamais aux données directement : chaque champ passe par
 * un setter déclaré dans EDITABLE_COMPONENTS. C'est ce qui permet aux édits
 * qui ont des conséquences de destin (Lifespan.max) de replanifier la mort via
 * applyLifespanEdit au lieu de muter bêtement une valeur.
 *
 * Portage Godot : ce fichier est le plus "web" du projet (DOM), mais il ne
 * contient AUCUNE logique de jeu — tout passe par world/fate. En Godot, seul
 * l'habillage (Control nodes) sera à réécrire.
 */
import type { EntityId, World } from '../simulation/ecs.js';
import type { ComponentType } from '../simulation/ecs.js';
import { FateQueue } from '../simulation/fate.js';
import {
  Age,
  Chemistry,
  GrowthRate,
  Health,
  Lifespan,
  Mass,
  Orbit,
  Position,
  Size,
  Species,
  StellarClass,
  Temperature,
  Wanderer,
} from '../simulation/components.js';
import { FATE_DEATH, FATE_MATURITY, applyLifespanEdit } from '../simulation/archetypes.js';
import {
  interventionCost,
  TERRAFORM_ORBIT_COST,
  TERRAFORM_TEMP_COST,
  TERRAFORM_TEMP_STEP,
} from '../simulation/cosmos.js';
import { OrbitMigration } from '../simulation/components.js';
import { RuleEngine } from '../simulation/rules.js';

interface FieldSpec {
  key: string;
  label: string;
  /** Absent = lecture seule. Renvoie false si l'édit est REFUSÉ (calcul
   *  insuffisant pour une intervention payante). */
  set?: (world: World, fate: FateQueue, engine: RuleEngine, entity: EntityId, value: number) => boolean;
  step?: number;
}

interface ComponentSpec {
  type: ComponentType<Record<string, number>>;
  fields: FieldSpec[];
}

/** Efface le typage précis d'un component pour l'édition générique par clé.
 *  Sûr ici : tous les components listés n'ont que des champs numériques. */
function erase<T>(type: ComponentType<T>): ComponentType<Record<string, number>> {
  return type as unknown as ComponentType<Record<string, number>>;
}

/** Un setter générique : écrit la clé telle quelle dans le component.
 *  GRATUIT : muter l'état présent n'est pas réécrire un destin déjà écrit. */
function direct(type: ComponentType<Record<string, number>>, key: string) {
  return (world: World, _fate: FateQueue, _engine: RuleEngine, entity: EntityId, value: number): boolean => {
    const comp = world.get(entity, type);
    if (comp) comp[key] = value;
    return true;
  };
}

function spec<T>(type: ComponentType<T>, fields: FieldSpec[]): ComponentSpec {
  return { type: erase(type), fields };
}

const EDITABLE_COMPONENTS: ComponentSpec[] = [
  spec(Age, [{ key: 'ticks', label: 'âge (ticks)' }]), // lecture seule : l'âge, c'est le temps vécu
  spec(Lifespan, [
    {
      key: 'max',
      label: 'espérance de vie',
      // Cet édit REPLANIFIE la mort : c'est une intervention, elle se paie.
      set: (world, fate, engine, entity, value) => {
        const death = fate.eventsFor(entity).find((ev) => ev.kind === FATE_DEATH);
        const cost = death ? interventionCost(FATE_DEATH, death.tick - world.tick, 'reschedule') : 0;
        if (cost > 0 && !engine.spend(cost, 'lifespan-edit')) return false;
        applyLifespanEdit(world, fate, entity, value);
        return true;
      },
    },
  ]),
  spec(Health, [
    { key: 'current', label: 'santé', set: direct(erase(Health), 'current') },
    { key: 'max', label: 'santé max', set: direct(erase(Health), 'max') },
  ]),
  spec(Size, [{ key: 'size', label: 'taille', set: direct(erase(Size), 'size'), step: 0.1 }]),
  spec(GrowthRate, [
    { key: 'perTick', label: 'croissance/tick', set: direct(erase(GrowthRate), 'perTick'), step: 0.001 },
    { key: 'maxSize', label: 'taille max', set: direct(erase(GrowthRate), 'maxSize'), step: 0.1 },
  ]),
  spec(Position, [
    { key: 'x', label: 'x', set: direct(erase(Position), 'x') },
    { key: 'y', label: 'y', set: direct(erase(Position), 'y') },
  ]),
  spec(Wanderer, [
    { key: 'speed', label: 'vitesse', set: direct(erase(Wanderer), 'speed'), step: 0.05 },
    { key: 'range', label: 'territoire', set: direct(erase(Wanderer), 'range') },
  ]),
  // Orbite et température d'une planète : LECTURE SEULE ici — les modifier
  // est un acte de terraformation, payant et progressif (section dédiée).
  spec(Orbit, [
    { key: 'radius', label: 'rayon d\'orbite' },
    { key: 'angularSpeed', label: 'vitesse angulaire' },
  ]),
  spec(Mass, [{ key: 'mass', label: 'masse' }]), // lecture seule : la masse s'amasse, elle ne se décrète pas
  spec(Temperature, [
    { key: 'current', label: 'température' },
    { key: 'coolingPerTick', label: 'refroidissement/tick' },
  ]),
  spec(Chemistry, [{ key: 'richness', label: 'richesse chimique', set: direct(erase(Chemistry), 'richness'), step: 0.05 }]),
  // Lecture seule : la classe d'une étoile est scellée à son allumage.
  spec(StellarClass, [{ key: 'luminosity', label: 'luminosité (échelle de zone)' }]),
];

const FATE_LABELS: Record<string, string> = {
  [FATE_DEATH]: 'Mort',
  [FATE_MATURITY]: 'Maturité',
  'forest-seed': 'Germination',
  'village-birth': 'Naissance',
  ignition: 'Allumage',
  abiogenesis: 'Abiogenèse',
  'hazard-impact': '☄ IMPACT',
  'hazard-drought': '☀ Sécheresse',
  'hazard-flare': '☀ Éruption',
  supernova: '★ SUPERNOVA',
  'star-death': 'Extinction',
};

/** Une ligne champ éditable : synchronisée chaque frame SAUF pendant la saisie. */
interface BoundInput {
  input: HTMLInputElement;
  read: () => number | undefined;
}

export class GodPanel {
  private entity: EntityId | null = null;
  private boundInputs: BoundInput[] = [];
  private readonlyFields: { el: HTMLElement; read: () => string }[] = [];
  private fateContainer: HTMLElement | null = null;
  /** Empreinte de la timeline affichée : on ne reconstruit le DOM que si elle change. */
  private fateSignature = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly world: World,
    private readonly fate: FateQueue,
    private readonly engine: RuleEngine,
  ) {}

  /** Message d'économie du destin (coût payé / refus), affiché sous le titre
   *  de la section Destin jusqu'à la prochaine action. */
  private fateMsg: HTMLElement | null = null;

  private sayFate(text: string, isError: boolean): void {
    if (!this.fateMsg) return;
    this.fateMsg.textContent = text;
    this.fateMsg.style.color = isError ? '#e06c6c' : '#8fd49a';
  }

  select(entity: EntityId | null): void {
    this.entity = entity;
    this.rebuild();
  }

  get selected(): EntityId | null {
    return this.entity;
  }

  /** À appeler chaque frame : rafraîchit les valeurs sans casser la saisie. */
  update(): void {
    if (this.entity === null) return;
    if (!this.world.isAlive(this.entity)) {
      // Le destin s'est accompli pendant qu'on regardait.
      this.entity = null;
      this.rebuild();
      return;
    }
    for (const f of this.readonlyFields) f.el.textContent = f.read();
    for (const b of this.boundInputs) {
      if (document.activeElement === b.input) continue; // le joueur tape : on ne l'écrase pas
      const v = b.read();
      if (v !== undefined) b.input.value = formatNumber(v);
    }
    const signature = this.fate
      .eventsFor(this.entity)
      .map((e) => `${e.id}:${e.tick}`)
      .join('|');
    if (signature !== this.fateSignature) this.rebuildFate();
  }

  private rebuild(): void {
    this.root.innerHTML = '';
    this.boundInputs = [];
    this.readonlyFields = [];
    this.fateContainer = null;
    this.fateMsg = null;
    this.fateSignature = '';
    if (this.entity === null) {
      this.root.classList.remove('open');
      return;
    }
    this.root.classList.add('open');
    const entity = this.entity;

    const species = this.world.get(entity, Species);
    const title = document.createElement('h2');
    title.textContent = species ? species.label : `Entité ${entity}`;
    const subtitle = document.createElement('div');
    subtitle.className = 'subtitle';
    subtitle.textContent = `entité #${entity} — éditez ses lois, le monde obéit`;
    this.root.append(title, subtitle);

    const compTitle = document.createElement('h3');
    compTitle.textContent = 'Components';
    this.root.appendChild(compTitle);

    for (const cspec of EDITABLE_COMPONENTS) {
      const comp = this.world.get(entity, cspec.type);
      if (!comp) continue;
      const box = document.createElement('div');
      box.className = 'comp';
      const name = document.createElement('div');
      name.className = 'comp-name';
      name.textContent = cspec.type.name;
      box.appendChild(name);

      for (const field of cspec.fields) {
        const row = document.createElement('div');
        row.className = 'field';
        const label = document.createElement('label');
        label.textContent = field.label;
        row.appendChild(label);

        if (field.set) {
          const input = document.createElement('input');
          input.type = 'number';
          if (field.step !== undefined) input.step = String(field.step);
          input.value = formatNumber(comp[field.key] ?? 0);
          const apply = (): void => {
            const v = Number(input.value);
            if (!Number.isFinite(v)) return;
            const ok = field.set?.(this.world, this.fate, this.engine, entity, v) ?? true;
            if (!ok) this.sayFate(`calcul libre insuffisant (libre : ${this.engine.free})`, true);
          };
          input.addEventListener('change', apply);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              apply();
              input.blur();
            }
          });
          row.appendChild(input);
          this.boundInputs.push({
            input,
            read: () => (this.world.get(entity, cspec.type) ?? {})[field.key],
          });
        } else {
          const span = document.createElement('span');
          span.className = 'ro';
          row.appendChild(span);
          this.readonlyFields.push({
            el: span,
            read: () => formatNumber((this.world.get(entity, cspec.type) ?? {})[field.key] ?? 0),
          });
        }
        box.appendChild(row);
      }
      this.root.appendChild(box);
    }

    this.buildTerraformSection(entity);

    const fateTitle = document.createElement('h3');
    fateTitle.textContent = 'Destin (Fate Queue)';
    this.root.appendChild(fateTitle);
    this.fateMsg = document.createElement('div');
    this.fateMsg.className = 'hint';
    this.fateMsg.textContent = 'réécrire un destin brûle du calcul libre';
    this.root.appendChild(this.fateMsg);
    this.fateContainer = document.createElement('div');
    this.root.appendChild(this.fateContainer);
    this.rebuildFate();
  }

  /** Terraformation : les actes lourds sur un MONDE — payants, progressifs.
   *  L'orbite migre (elle ne saute pas) ; la température se pousse par crans. */
  private buildTerraformSection(entity: EntityId): void {
    if (this.world.get(entity, Species)?.kind !== 'planet') return;
    const title = document.createElement('h3');
    title.textContent = 'Terraformation';
    this.root.appendChild(title);
    const msg = document.createElement('div');
    msg.className = 'hint';
    msg.textContent = 'déplacer un monde se paie — et se regarde';
    this.root.appendChild(msg);
    const say = (text: string, isError: boolean): void => {
      msg.textContent = text;
      msg.style.color = isError ? '#e06c6c' : '#8fd49a';
    };

    const box = document.createElement('div');
    box.className = 'comp';

    const orbit = this.world.get(entity, Orbit);
    if (orbit) {
      const row = document.createElement('div');
      row.className = 'field';
      const label = document.createElement('label');
      label.textContent = 'migrer l\'orbite vers';
      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(Math.round(this.world.get(entity, OrbitMigration)?.targetRadius ?? orbit.radius));
      const btn = document.createElement('button');
      btn.className = 'rule-action';
      btn.textContent = `Migrer (${TERRAFORM_ORBIT_COST} ⚙)`;
      btn.addEventListener('click', () => {
        const target = Math.max(20, Math.round(Number(input.value)));
        if (!Number.isFinite(target)) return;
        if (!this.engine.spend(TERRAFORM_ORBIT_COST, 'terraform-orbit')) {
          say(`migrer coûte ${TERRAFORM_ORBIT_COST} ⚙ (libre : ${this.engine.free})`, true);
          return;
        }
        // Remplace toute migration en cours : la nouvelle cible fait foi.
        this.world.remove(entity, OrbitMigration);
        this.world.add(entity, OrbitMigration, { targetRadius: target });
        this.world.emit({ kind: 'terraform-started', entity, tick: this.world.tick, data: { target } });
        say(`−${TERRAFORM_ORBIT_COST} ⚙ : migration vers ${target} engagée`, false);
      });
      row.append(label, input);
      box.appendChild(row);
      box.appendChild(btn);
      // Statut vivant : rayon actuel → cible pendant la migration.
      const status = document.createElement('div');
      status.className = 'hint';
      box.appendChild(status);
      this.readonlyFields.push({
        el: status,
        read: () => {
          const m = this.world.get(entity, OrbitMigration);
          const o = this.world.get(entity, Orbit);
          if (!o) return '';
          return m
            ? `en migration : ${o.radius.toFixed(1)} → ${m.targetRadius}`
            : `orbite stable à ${o.radius.toFixed(1)}`;
        },
      });
    }

    const temp = this.world.get(entity, Temperature);
    if (temp) {
      const row = document.createElement('div');
      row.className = 'field';
      const label = document.createElement('label');
      label.textContent = 'température';
      const mk = (text: string, delta: number): HTMLButtonElement => {
        const b = document.createElement('button');
        b.className = 'rule-action';
        b.textContent = text;
        b.addEventListener('click', () => {
          if (!this.engine.spend(TERRAFORM_TEMP_COST, 'terraform-temp')) {
            say(`ce geste coûte ${TERRAFORM_TEMP_COST} ⚙ (libre : ${this.engine.free})`, true);
            return;
          }
          const t = this.world.get(entity, Temperature);
          if (t) t.current = Math.max(0, t.current + delta);
          say(`−${TERRAFORM_TEMP_COST} ⚙ : température ${delta > 0 ? 'poussée' : 'abaissée'}`, false);
        });
        return b;
      };
      row.append(
        label,
        mk(`+${TERRAFORM_TEMP_STEP}° (${TERRAFORM_TEMP_COST} ⚙)`, TERRAFORM_TEMP_STEP),
        mk(`−${TERRAFORM_TEMP_STEP}° (${TERRAFORM_TEMP_COST} ⚙)`, -TERRAFORM_TEMP_STEP),
      );
      box.appendChild(row);
    }

    this.root.appendChild(box);
  }

  private rebuildFate(): void {
    if (!this.fateContainer || this.entity === null) return;
    const entity = this.entity;
    const events = this.fate.eventsFor(entity);
    this.fateSignature = events.map((e) => `${e.id}:${e.tick}`).join('|');
    this.fateContainer.innerHTML = '';

    if (events.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Aucun destin en attente : cette entité est hors du temps.';
      this.fateContainer.appendChild(hint);
      return;
    }

    for (const event of events) {
      const row = document.createElement('div');
      row.className = 'fate-event';
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = FATE_LABELS[event.kind] ?? event.kind;
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = `tick ${event.tick} (dans ${event.tick - this.world.tick})`;

      // Éditer le tick == replanifier l'événement (jamais dans le passé).
      // Chaque réécriture BRÛLE du calcul libre : ampleur × urgence.
      const rescheduleCost = (): number =>
        interventionCost(event.kind, event.tick - this.world.tick, 'reschedule');
      const cancelCost = (): number =>
        interventionCost(event.kind, event.tick - this.world.tick, 'cancel');

      const input = document.createElement('input');
      input.type = 'number';
      input.value = String(event.tick);
      input.title = `Replanifier ce destin (coût : ${rescheduleCost()} ⚙)`;
      input.addEventListener('change', () => {
        const v = Math.max(this.world.tick + 1, Math.round(Number(input.value)));
        if (!Number.isFinite(v) || v === event.tick) return;
        const cost = rescheduleCost();
        if (!this.engine.spend(cost, `reschedule-${event.kind}`)) {
          input.value = String(event.tick);
          this.sayFate(`replanifier coûte ${cost} ⚙ (libre : ${this.engine.free})`, true);
          return;
        }
        this.fate.reschedule(event.id, v);
        this.sayFate(`−${cost} ⚙ : destin replanifié au tick ${v}`, false);
      });

      const cancel = document.createElement('button');
      cancel.textContent = `✕ ${cancelCost()}⚙`;
      cancel.title = 'Annuler ce destin (il ne se réalisera jamais)';
      cancel.addEventListener('click', () => {
        const cost = cancelCost();
        if (!this.engine.spend(cost, `cancel-${event.kind}`)) {
          this.sayFate(`annuler coûte ${cost} ⚙ (libre : ${this.engine.free})`, true);
          return;
        }
        this.fate.cancel(event.id);
        this.sayFate(`−${cost} ⚙ : destin effacé`, false);
      });

      row.append(kind, when, input, cancel);
      this.fateContainer.appendChild(row);
    }
  }
}

function formatNumber(v: number): string {
  // Assez de précision pour les petits taux (croissance/tick) sans afficher
  // 15 décimales de bruit flottant sur les positions.
  return String(Math.round(v * 10000) / 10000);
}

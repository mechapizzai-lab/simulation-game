/**
 * Le compilateur d'intentions : la moitié PURE du terminal divin.
 *
 * Contrat fondamental (celui qui empêche le jeu de devenir un théâtre) :
 *   L'INTENTION EST COMPILÉE EN ACTES DU JEU. LA SIMULATION SEULE DÉCIDE.
 * Le compilateur ne promet jamais un résultat — il traduit une phrase en
 * actions de l'espace existant (règles, paramètres, terraformation, édition
 * de destins, conjuration de matière), affiche le patch et son coût AVANT
 * application, et l'univers fait ce qu'il fait. « Condense un nuage au
 * nord » peut donner une étoile, une géante condamnée, ou rien du tout si
 * la Gravité est coupée.
 *
 * v1 hors-ligne : un interpréteur de français à vocabulaire fini. Quand il
 * ne comprend pas, il le dit et montre ce qu'il sait faire — un dieu au
 * langage encore pauvre. (v2 : une vraie IA compilera vers LE MÊME espace
 * d'actions ; ce fichier est ce contrat.)
 */
import type { EntityId, World } from './ecs.js';
import { FateQueue, type FateEvent } from './fate.js';
import { RuleEngine } from './rules.js';
import { Rng } from './rng.js';
import {
  Chemistry,
  Orbit,
  OrbitMigration,
  Position,
  Species,
  StellarClass,
  Temperature,
} from './components.js';
import {
  CONJURE_MATTER_COST,
  CONJURE_MATTER_COUNT,
  RULE_AGGREGATION,
  RULE_BIGBANG,
  RULE_CHEMISTRY,
  RULE_CONDITIONS,
  RULE_FUSION,
  RULE_GRAVITY,
  RULE_LIFE,
  RULE_MATTER,
  RULE_SPACE,
  RULE_TIME,
  TERRAFORM_ORBIT_COST,
  TERRAFORM_TEMP_COST,
  TERRAFORM_TEMP_STEP,
  UNIVERSE_RADIUS,
  conjureMatter,
  interventionCost,
} from './cosmos.js';
import type { UniverseTemperament } from './temperament.js';

export interface IntentContext {
  world: World;
  engine: RuleEngine;
  fate: FateQueue;
  rng: Rng;
  temperament: UniverseTemperament;
  /** Optionnel : contrôle de la vitesse du pilote (UI). */
  setSpeed?: (speed: 0 | 1 | 10 | 100) => void;
}

/** Une action compilée : sa description, son coût, et son exécution.
 *  execute() renvoie un compte-rendu FACTUEL (jamais une promesse). */
export interface CompiledAction {
  description: string;
  cost: number;
  execute(ctx: IntentContext): string;
}

export interface CompiledPatch {
  actions: CompiledAction[];
  totalCost: number;
}

export interface CompileFailure {
  /** Le fragment incompris, pour le montrer au joueur. */
  fragment: string;
}

// ---------------------------------------------------------------------------
// Normalisation et lexiques
// ---------------------------------------------------------------------------

function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/['']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULE_LEXICON: [string, string][] = [
  ['big bang', RULE_BIGBANG],
  ['bigbang', RULE_BIGBANG],
  ['temps', RULE_TIME],
  ['espace', RULE_SPACE],
  ['matiere', RULE_MATTER],
  ['gravite', RULE_GRAVITY],
  ['agregation', RULE_AGGREGATION],
  ['fusion', RULE_FUSION],
  ['chimie', RULE_CHEMISTRY],
  ['conditions de vie', RULE_CONDITIONS],
  ['conditions', RULE_CONDITIONS],
  ['vie', RULE_LIFE],
];

/** Paramètres nommables : mots-clés → (règle, paramètre, libellé). */
const PARAM_LEXICON: [string, { rule: string; key: string; label: string }][] = [
  ['condensation', { rule: RULE_MATTER, key: 'rate', label: 'taux de condensation' }],
  ['masse de l univers', { rule: RULE_MATTER, key: 'massBudget', label: 'masse totale de l\'univers' }],
  ['masse totale', { rule: RULE_MATTER, key: 'massBudget', label: 'masse totale de l\'univers' }],
  ['masse d allumage', { rule: RULE_FUSION, key: 'ignitionMass', label: 'masse d\'allumage' }],
  ['delai d allumage', { rule: RULE_FUSION, key: 'ignitionDelay', label: 'délai d\'allumage' }],
  ['gravite', { rule: RULE_GRAVITY, key: 'strength', label: 'intensité de la gravité' }],
  ['rayon de fusion', { rule: RULE_AGGREGATION, key: 'mergeRadius', label: 'rayon de fusion' }],
  ['eaux', { rule: RULE_CONDITIONS, key: 'waterGrowth', label: 'montée des eaux' }],
  ['enrichissement', { rule: RULE_CHEMISTRY, key: 'enrichRate', label: 'enrichissement chimique' }],
  ['esperance de vie', { rule: RULE_LIFE, key: 'lifespan', label: 'espérance de vie de base' }],
];

const DIRECTIONS: [string, { x: number; y: number }][] = [
  ['nord', { x: 0, y: -UNIVERSE_RADIUS * 0.6 }],
  ['sud', { x: 0, y: UNIVERSE_RADIUS * 0.6 }],
  ['est', { x: UNIVERSE_RADIUS * 0.6, y: 0 }],
  ['ouest', { x: -UNIVERSE_RADIUS * 0.6, y: 0 }],
  ['haut', { x: 0, y: -UNIVERSE_RADIUS * 0.6 }],
  ['bas', { x: 0, y: UNIVERSE_RADIUS * 0.6 }],
  ['gauche', { x: -UNIVERSE_RADIUS * 0.6, y: 0 }],
  ['droite', { x: UNIVERSE_RADIUS * 0.6, y: 0 }],
  ['centre', { x: 0, y: 0 }],
];

const THREAT_KINDS = ['hazard-impact', 'hazard-drought', 'hazard-flare', 'supernova'];

export const INTENT_HELP = [
  'Vocabulaire du compilateur (v1) — l\'univers décide toujours du résultat :',
  '• « big bang » / « que la lumière soit »',
  '• « code la gravité », « coupe l\'agrégation », « gèle le temps »',
  '• « accélère la condensation », « double la montée des eaux », « mets la gravité à 0.01 »',
  '• « condense de la matière au nord / au centre / près de l\'étoile » (4 ⚙)',
  '• « migre Monde-2 vers 180 », « pousse Monde-3 dans la zone tempérée » (6 ⚙)',
  '• « réchauffe / refroidis Monde-1 » (3 ⚙)',
  '• « annule la supernova », « repousse l\'impact de 2000 ticks », « sauve Monde-2 » (⚙ selon urgence)',
  '• « pause », « x1 », « x10 », « x100 »',
].join('\n');

// ---------------------------------------------------------------------------
// Résolution de cibles
// ---------------------------------------------------------------------------

function findByLabel(world: World, text: string): EntityId | null {
  for (const [e, s] of world.query(Species)) {
    if (text.includes(norm(s.label))) return e;
  }
  return null;
}

function firstOf(world: World, kind: string): EntityId | null {
  for (const [e, s] of world.query(Species)) if (s.kind === kind) return e;
  return null;
}

/** « près de l'étoile », « Monde-3 », « le trou noir »... */
function resolveTarget(world: World, text: string): EntityId | null {
  const byLabel = findByLabel(world, text);
  if (byLabel !== null) return byLabel;
  if (text.includes('trou noir')) return firstOf(world, 'blackhole');
  if (text.includes('etoile')) return firstOf(world, 'star');
  if (text.includes('singularite')) return firstOf(world, 'singularity');
  if (text.includes('planete') || text.includes('monde')) return firstOf(world, 'planet');
  return null;
}

function labelOf(world: World, e: EntityId): string {
  return world.get(e, Species)?.label ?? `entité #${e}`;
}

/** Cherche un événement par nature dans tout l'univers (le plus proche). */
function findEvent(ctx: IntentContext, kinds: string[], target: EntityId | null): FateEvent | null {
  let best: FateEvent | null = null;
  const scan = (entity: EntityId): void => {
    for (const ev of ctx.fate.eventsFor(entity)) {
      if (!kinds.includes(ev.kind)) continue;
      if (best === null || ev.tick < best.tick) best = ev;
    }
  };
  if (target !== null) scan(target);
  else for (const [e] of ctx.world.query(Species)) scan(e);
  return best;
}

// ---------------------------------------------------------------------------
// Compilation d'une clause
// ---------------------------------------------------------------------------

function compileClause(raw: string, ctx: IntentContext): CompiledAction | null {
  const text = norm(raw);
  if (text.length === 0) return null;
  const { world, engine, fate } = ctx;

  // --- Vitesse du pilote ---
  const speedMatch = text.match(/^(pause|x1|x10|x100)$/);
  if (speedMatch || text.includes('mets en pause')) {
    const speed = text.includes('pause') ? 0 : (Number(text.replace('x', '')) as 1 | 10 | 100);
    return {
      description: speed === 0 ? 'Suspendre le pilote (pause)' : `Vitesse du pilote : x${speed}`,
      cost: 0,
      execute: (c) => {
        c.setSpeed?.(speed as 0 | 1 | 10 | 100);
        return speed === 0 ? 'Pilote en pause.' : `Pilote à x${speed}.`;
      },
    };
  }

  // --- Aide ---
  if (/^(aide|help|\?|que peux-tu faire)/.test(text)) {
    return { description: 'Afficher le vocabulaire', cost: 0, execute: () => INTENT_HELP };
  }

  // --- Big Bang ---
  if (text.includes('big bang') || text.includes('que la lumiere soit')) {
    return {
      description: 'Coder la règle Big Bang (déclenche la naissance)',
      cost: 0,
      execute: (c) => {
        const blocker = c.engine.activationBlocker(RULE_BIGBANG, c.world);
        if (blocker) return `Refusé : ${blocker}.`;
        c.engine.activate(RULE_BIGBANG, c.world);
        return 'La singularité a cédé. L\'univers existe — à lui de décider quoi en faire.';
      },
    };
  }

  // --- Conjurer de la matière (AVANT les règles : « crée de la matière au nord ») ---
  if (/(condense|cree|conjure|fais apparaitre|materialise)/.test(text) && text.includes('matiere')) {
    let pos: { x: number; y: number } | null = null;
    let where = 'au centre';
    for (const [word, p] of DIRECTIONS) {
      if (text.includes(word)) {
        pos = { ...p };
        where = word;
        break;
      }
    }
    if (pos === null && /pres (de|du|des)/.test(text)) {
      const target = resolveTarget(world, text);
      if (target !== null) {
        const tp = world.get(target, Position);
        if (tp) {
          pos = { x: tp.x + 60, y: tp.y };
          where = `près de ${labelOf(world, target)}`;
        }
      }
    }
    if (pos === null) pos = { x: 0, y: 0 };
    const at = pos;
    return {
      description: `Condenser un nuage de ${CONJURE_MATTER_COUNT} grains de matière (${where})`,
      cost: CONJURE_MATTER_COST,
      execute: (c) => {
        if (!c.engine.spend(CONJURE_MATTER_COST, 'conjure-matter')) {
          return `Refusé : calcul libre insuffisant (${c.engine.free}/${CONJURE_MATTER_COST}).`;
        }
        conjureMatter(c.world, c.rng, at.x, at.y);
        return `Un nuage de matière condense ${where}. Ce qu'il deviendra dépend des lois actives.`;
      },
    };
  }

  // --- Activer / couper une règle ---
  const ruleHit = RULE_LEXICON.find(([name]) => text.includes(name));
  if (ruleHit && /(code|active|ecris|lance|allume|cree|retablis)/.test(text)) {
    const [, ruleId] = ruleHit;
    const label = engine.get(ruleId).label;
    return {
      description: `Coder la règle ${label} (${engine.get(ruleId).cost} ⚙ d'entretien)`,
      cost: 0,
      execute: (c) => {
        const blocker = c.engine.activationBlocker(ruleId, c.world);
        if (blocker) return `Refusé : ${blocker}.`;
        c.engine.activate(ruleId, c.world);
        return `${label} est codée. Le processus tourne.`;
      },
    };
  }
  if (ruleHit && /(coupe|desactive|arrete|stoppe|gele|suspends)/.test(text)) {
    const [, ruleId] = ruleHit;
    const label = engine.get(ruleId).label;
    return {
      description: `Couper la règle ${label} (ses produits persistent)`,
      cost: 0,
      execute: (c) => {
        if (!c.engine.isActive(ruleId)) return `${label} est déjà inactive.`;
        c.engine.deactivate(ruleId);
        return `${label} est coupée. Le processus s'arrête, ses produits demeurent.`;
      },
    };
  }

  // --- Paramètres : « accélère X », « double X », « mets X à N » ---
  const paramHit = PARAM_LEXICON.find(([name]) => text.includes(name));
  if (paramHit) {
    const [, spec] = paramHit;
    const explicit = text.match(/(?:a|sur) ([0-9]+(?:[.,][0-9]+)?)\s*$/);
    let factor = 0;
    if (/(double)/.test(text)) factor = 2;
    else if (/(accelere|augmente|monte|booste|intensifie)/.test(text)) factor = 1.5;
    else if (/(ralentis|reduis|diminue|baisse|divise)/.test(text)) factor = 1 / 1.5;
    if (explicit || factor !== 0) {
      const current = engine.param(spec.rule, spec.key);
      const target = explicit ? Number(explicit[1]?.replace(',', '.')) : current * factor;
      return {
        description: `Régler « ${spec.label} » : ${round4(current)} → ${round4(target)} (gratuit — prospectif)`,
        cost: 0,
        execute: (c) => {
          c.engine.setParam(spec.rule, spec.key, target);
          return `« ${spec.label} » vaut désormais ${round4(c.engine.param(spec.rule, spec.key))}. Effet dès le prochain tick.`;
        },
      };
    }
  }

  // --- Terraformation : orbite ---
  if (/(migre|rapproche|eloigne|pousse|deplace)/.test(text)) {
    const target = resolveTarget(world, text);
    const orbit = target !== null ? world.get(target, Orbit) : undefined;
    if (target !== null && orbit) {
      let newRadius: number | null = null;
      const explicit = text.match(/vers ([0-9]+)/);
      if (explicit) newRadius = Number(explicit[1]);
      else if (text.includes('zone')) {
        const lum = world.get(orbit.center, StellarClass)?.luminosity ?? 1;
        newRadius = Math.round(((ctx.temperament.habitableOrbitMin + ctx.temperament.habitableOrbitMax) / 2) * lum);
      } else if (/rapproche/.test(text)) newRadius = Math.max(20, Math.round(orbit.radius * 0.7));
      else if (/eloigne/.test(text)) newRadius = Math.round(orbit.radius * 1.4);
      if (newRadius !== null) {
        const r = newRadius;
        const name = labelOf(world, target);
        return {
          description: `Migrer l'orbite de ${name} : ${orbit.radius.toFixed(0)} → ${r}`,
          cost: TERRAFORM_ORBIT_COST,
          execute: (c) => {
            if (!c.engine.spend(TERRAFORM_ORBIT_COST, 'terraform-orbit')) {
              return `Refusé : calcul libre insuffisant (${c.engine.free}/${TERRAFORM_ORBIT_COST}).`;
            }
            c.world.remove(target, OrbitMigration);
            c.world.add(target, OrbitMigration, { targetRadius: r });
            c.world.emit({ kind: 'terraform-started', entity: target, tick: c.world.tick, data: { target: r } });
            return `${name} spirale vers l'orbite ${r}. Le voyage prendra ce qu'il prendra.`;
          },
        };
      }
    }
  }

  // --- Terraformation : température ---
  if (/(rechauffe|refroidis)/.test(text)) {
    const target = resolveTarget(world, text);
    if (target !== null && world.has(target, Temperature)) {
      const delta = text.includes('rechauffe') ? TERRAFORM_TEMP_STEP : -TERRAFORM_TEMP_STEP;
      const name = labelOf(world, target);
      return {
        description: `${delta > 0 ? 'Réchauffer' : 'Refroidir'} ${name} de ${Math.abs(delta)}°`,
        cost: TERRAFORM_TEMP_COST,
        execute: (c) => {
          if (!c.engine.spend(TERRAFORM_TEMP_COST, 'terraform-temp')) {
            return `Refusé : calcul libre insuffisant (${c.engine.free}/${TERRAFORM_TEMP_COST}).`;
          }
          const t = c.world.get(target, Temperature);
          if (!t) return `${name} n'a plus de température à pousser.`;
          t.current = Math.max(0, t.current + delta);
          return `${name} est à ${Math.round(t.current)}°.`;
        },
      };
    }
  }

  // --- Destins : annuler / repousser / sauver ---
  if (/(annule|efface|empeche|sauve|protege|repousse|retarde)/.test(text)) {
    const isReschedule = /(repousse|retarde)/.test(text);
    const explicitTarget = findByLabel(world, text);
    let kinds: string[] = THREAT_KINDS;
    if (text.includes('supernova')) kinds = ['supernova'];
    else if (text.includes('impact') || text.includes('asteroide')) kinds = ['hazard-impact'];
    else if (text.includes('secheresse')) kinds = ['hazard-drought'];
    else if (text.includes('eruption')) kinds = ['hazard-flare'];
    else if (text.includes('extinction')) kinds = ['star-death'];
    else if (text.includes('mort')) kinds = ['death'];
    else if (text.includes('allumage')) kinds = ['ignition'];
    const event = findEvent(ctx, kinds, explicitTarget);
    if (event) {
      const delayMatch = text.match(/de ([0-9]+) ticks?/);
      const delay = delayMatch ? Number(delayMatch[1]) : 2000;
      const action: 'cancel' | 'reschedule' = isReschedule ? 'reschedule' : 'cancel';
      const cost = interventionCost(event.kind, event.tick - world.tick, action);
      const who = labelOf(world, event.entity);
      const desc = isReschedule
        ? `Repousser « ${event.kind} » de ${who} de ${delay} ticks (tick ${event.tick} → ${event.tick + delay})`
        : `Effacer « ${event.kind} » de ${who} (tick ${event.tick})`;
      const eventId = event.id;
      const newTick = event.tick + delay;
      return {
        description: desc,
        cost,
        execute: (c) => {
          if (!c.engine.spend(cost, `${action}-${event.kind}`)) {
            return `Refusé : calcul libre insuffisant (${c.engine.free}/${cost}).`;
          }
          if (isReschedule) {
            c.fate.reschedule(eventId, newTick);
            return `Le destin de ${who} est repoussé au tick ${newTick}.`;
          }
          fate.cancel(eventId);
          return `Le destin est effacé. ${who} continue comme si de rien n'était.`;
        },
      };
    }
  }

  return null;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// API publique : compile un prompt (clauses séparées par « et » / « puis » / « , »)
// ---------------------------------------------------------------------------

export function compileIntent(
  raw: string,
  ctx: IntentContext,
): { patch: CompiledPatch } | { failure: CompileFailure } {
  const clauses = raw
    .split(/(?:\bpuis\b|\bet\b|,|;)/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const actions: CompiledAction[] = [];
  for (const clause of clauses) {
    const action = compileClause(clause, ctx);
    if (!action) return { failure: { fragment: clause } };
    actions.push(action);
  }
  if (actions.length === 0) return { failure: { fragment: raw } };
  return { patch: { actions, totalCost: actions.reduce((s, a) => s + a.cost, 0) } };
}

/** Applique un patch compilé : exécute chaque action, renvoie les comptes-rendus. */
export function applyPatch(patch: CompiledPatch, ctx: IntentContext): string[] {
  return patch.actions.map((a) => a.execute(ctx));
}

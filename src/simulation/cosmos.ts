/**
 * La cosmogonie : les neuf règles que le joueur peut coder, leurs effets
 * simulés, et les jalons d'émergence qui financent la suite.
 *
 * Chaîne causale (chaque règle a un effet VISIBLE, pas juste un déblocage) :
 *   Temps      → les ticks avancent (sans lui, l'univers est figé)
 *   Espace     → l'étendue existe (fond stellaire, navigation)
 *   Matière    → des particules condensent progressivement du vide
 *   Gravité    → les particules dérivent vers les masses
 *   Agrégation → les particules proches fusionnent en amas qui grossissent
 *   Fusion     → les amas assez massifs s'allument (étoiles) — via la Fate
 *                Queue : l'allumage est un DESTIN écrit ~250 ticks à l'avance,
 *                visible et annulable dans le panneau de l'amas
 *   Chimie     → les planètes refroidies s'enrichissent (couleurs)
 *   Conditions → l'eau se forme sur les planètes riches en chimie
 *   Vie        → abiogenèse sur les mondes habitables, puis cycles écologiques
 *
 * Rappel des contrats (voir rules.ts) : désactiver = arrêter le processus,
 * jamais détruire les produits ; les paramètres sont lus en direct par les
 * systems ; les événements déjà en Fate Queue ne sont pas recalculés.
 */
import { World, type EntityId, type System } from './ecs.js';
import { FateQueue } from './fate.js';
import { RuleEngine } from './rules.js';
import { Rng } from './rng.js';
import {
  Age,
  Chemistry,
  Crater,
  GrowthRate,
  Habitable,
  Hazard,
  Igniting,
  Lifespan,
  Mass,
  OnPlanet,
  Orbit,
  Position,
  Size,
  Species,
  Temperature,
  Velocity,
  Wanderer,
} from './components.js';
import { OrbitMigration, PlanetKind, Shockwave, StellarClass } from './components.js';
import { spawnPerson, spawnTree } from './archetypes.js';
import type { UniverseTemperament } from './temperament.js';

/** Rayon du disque où la matière condense (unités univers). */
export const UNIVERSE_RADIUS = 550;
/** Étendue de la carte de surface d'une planète (unités de surface). */
export const SURFACE_HALF_WIDTH = 600;
export const SURFACE_HALF_HEIGHT = 400;

export const RULE_TIME = 'time';
export const RULE_SPACE = 'space';
export const RULE_MATTER = 'matter';
export const RULE_GRAVITY = 'gravity';
export const RULE_AGGREGATION = 'aggregation';
export const RULE_FUSION = 'fusion';
export const RULE_CHEMISTRY = 'chemistry';
export const RULE_CONDITIONS = 'life-conditions';
export const RULE_LIFE = 'life';

export const FATE_IGNITION = 'ignition';
export const FATE_ABIOGENESIS = 'abiogenesis';
export const FATE_FOREST_SEED = 'forest-seed';
export const FATE_VILLAGE_BIRTH = 'village-birth';
export const FATE_IMPACT = 'hazard-impact';
export const FATE_DROUGHT = 'hazard-drought';
export const FATE_FLARE = 'hazard-flare';
export const FATE_SUPERNOVA = 'supernova';
export const FATE_STAR_DEATH = 'star-death';
export const RULE_BIGBANG = 'bigbang';

/** Acte divin : condenser un nuage de matière à un endroit précis. Payant —
 *  contrairement à la règle Matière (un processus), c'est un GESTE ponctuel.
 *  La masse offerte compte dans le budget de masse : le robinet naturel se
 *  freinera d'autant — l'univers reste fini. */
export const CONJURE_MATTER_COST = 4;
export const CONJURE_MATTER_COUNT = 30;
/** Au-delà de cette distance, l'expansion emporte la matière hors de
 *  l'existence (et libère son budget de masse) : sans Gravité codée, un
 *  Big Bang se disperse — l'univers rate son départ, sans réussite forcée. */
export const EXPANSION_BOUNDARY = UNIVERSE_RADIUS * 1.6;

/**
 * Classes stellaires — figées à l'allumage d'après la masse. La première
 * étoile d'un run naît de l'effondrement total (masse ~300-500) : c'est une
 * GÉANTE BLEUE condamnée, sa supernova est écrite dès sa naissance et lisible
 * dans sa timeline. Les étoiles de seconde génération (nées du disque
 * résiduel) sont des naines et des jaunes, plus calmes : la cosmologie du jeu
 * a naturellement deux actes. La stabilité n'est pas un état, c'est une lutte.
 */
export const STELLAR_CLASSES = {
  dwarf: { maxMass: 60, luminosity: 0.6, lifeMin: 80_000, lifeMax: 150_000, death: FATE_STAR_DEATH },
  yellow: { maxMass: 140, luminosity: 1.0, lifeMin: 30_000, lifeMax: 60_000, death: FATE_STAR_DEATH },
  giant: { maxMass: Infinity, luminosity: 1.6, lifeMin: 8_000, lifeMax: 14_000, death: FATE_SUPERNOVA },
} as const;

/** Rayons de l'onde de choc d'une supernova : stérilisation puis
 *  ENSEMENCEMENT — les éléments lourds qui rendront la chimie possible
 *  viennent de là. La mort d'une étoile est aussi un engrais. */
export const SHOCK_STERILIZE_RADIUS = 160;
export const SHOCK_ENRICH_RADIUS = 450;
/** Au-delà de cette masse, le vestige d'une supernova est un trou noir. */
export const BLACK_HOLE_MASS = 220;
/** Décroissance d'orbite autour d'un trou noir (unités/tick). */
export const BLACK_HOLE_DECAY = 0.004;
/** Rayon d'influence gravitationnelle d'un trou noir sur la matière libre.
 *  Sans cette borne, le premier trou noir aspire TOUTE la condensation
 *  future et l'univers meurt définitivement (vécu : 2 entités au tick
 *  68 000). Au-delà, la matière s'organise entre elle : le second acte
 *  (étoiles de nouvelle génération) reste possible — pas garanti. */
export const BLACK_HOLE_PULL_RADIUS = 170;

/** Seuils de nature planétaire à la capture (masse d'allumage par défaut : 24). */
export const GAS_GIANT_MIN_MASS = 16;
/** Chance qu'une géante gazeuse du système dévie un astéroïde en approche. */
export const JOVIAN_SHIELD_CHANCE = 0.35;

/**
 * Coût d'une intervention divine sur un destin déjà écrit.
 * Deux axes, tous deux lisibles par le joueur :
 * - l'AMPLEUR (base par type d'événement : dévier un astéroïde coûte plus
 *   que repousser la maturité d'un arbre) ;
 * - l'URGENCE (multiplicateur de proximité : réécrire à la dernière minute
 *   coûte jusqu'à 3×) ;
 * et annuler coûte le double de replanifier — effacer est plus violent que
 * repousser. Les édits de RÈGLES restent gratuits : ils sont prospectifs.
 */
const INTERVENTION_BASE: Record<string, number> = {
  [FATE_IMPACT]: 2,
  [FATE_DROUGHT]: 2,
  [FATE_FLARE]: 2,
  [FATE_ABIOGENESIS]: 2,
  [FATE_IGNITION]: 1,
  // Annuler une supernova est le plus grand miracle du jeu : 6 de loin,
  // 18 à la dernière minute — l'étoile graciée devient éternelle.
  [FATE_SUPERNOVA]: 3,
  [FATE_STAR_DEATH]: 1,
  death: 1,
  maturity: 1,
  [FATE_FOREST_SEED]: 1,
  [FATE_VILLAGE_BIRTH]: 1,
};

export function conjureMatter(world: World, rng: Rng, x: number, y: number, count = CONJURE_MATTER_COUNT): void {
  for (let i = 0; i < count; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 35);
    const e = world.createEntity();
    world.add(e, Species, { kind: 'particle', label: 'Particule' });
    world.add(e, Position, { x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r });
    world.add(e, Velocity, { vx: rng.range(-0.1, 0.1), vy: rng.range(-0.1, 0.1) });
    world.add(e, Mass, { mass: 1 });
    world.add(e, Size, { size: 1 });
  }
}

export function interventionCost(
  kind: string,
  ticksUntil: number,
  action: 'cancel' | 'reschedule',
): number {
  const base = INTERVENTION_BASE[kind] ?? 1;
  const proximity = ticksUntil < 500 ? 3 : ticksUntil < 2000 ? 2 : 1;
  return base * proximity * (action === 'cancel' ? 2 : 1);
}

/** Température sous laquelle une planète compte comme "refroidie". */
const COOLED_TEMP = 300;
const MAX_TREES_PER_PLANET = 60;
const MAX_PEOPLE_PER_PLANET = 24;

/**
 * Terraformation : les actes divins LOURDS sur l'état présent d'un monde.
 * Contrairement aux petits édits (position d'une personne), déplacer une
 * orbite ou changer la température d'une planète se PAIE — et l'orbite ne se
 * téléporte pas : elle migre (voir orbitMigration), le geste se regarde.
 * La zone habitable dépendant du tempérament, la terraformation est LE
 * levier pour amener un monde là où l'eau peut naître.
 */
export const TERRAFORM_ORBIT_COST = 6;
export const TERRAFORM_TEMP_COST = 3;
export const TERRAFORM_TEMP_STEP = 200;
/** Vitesse de migration d'orbite (unités de rayon par tick). */
export const ORBIT_MIGRATION_RATE = 0.06;

// --- Petites requêtes réutilisées par les règles, jalons et tests ---

export function countKind(world: World, kind: string): number {
  let n = 0;
  for (const [, s] of world.query(Species)) if (s.kind === kind) n++;
  return n;
}

export function firstOfKind(world: World, kind: string): EntityId | null {
  for (const [e, s] of world.query(Species)) if (s.kind === kind) return e;
  return null;
}

function totalMass(world: World): number {
  let sum = 0;
  for (const [, m] of world.query(Mass)) sum += m.mass;
  return sum;
}

function hasCooledPlanet(world: World): boolean {
  for (const [e, s] of world.query(Species)) {
    if (s.kind !== 'planet') continue;
    const t = world.get(e, Temperature);
    if (t && t.current < COOLED_TEMP) return true;
  }
  return false;
}

function hasHabitablePlanet(world: World): boolean {
  for (const [e] of world.query(Habitable)) return e !== 0;
  return false;
}

/** Taille visuelle d'un corps en fonction de sa masse (∛ pour rester sage). */
function sizeFromMass(mass: number): number {
  return 1.3 * Math.cbrt(mass);
}

/** Enveloppe un system pour qu'il ne tourne que si sa règle est codée.
 *  C'est TOUTE l'intégration règles ↔ ECS : le World n'a pas changé. */
function gated(engine: RuleEngine, ruleId: string, system: System): System {
  return {
    name: system.name,
    update(world, tick, dtTicks): void {
      if (engine.isActive(ruleId)) system.update(world, tick, dtTicks);
    },
  };
}

export interface Cosmos {
  /** Systems (déjà gated) à enregistrer dans le World, dans cet ordre. */
  systems: System[];
}

export interface CosmosOptions {
  /** Les aléas cosmiques (astéroïdes, sécheresses, éruptions). Désactivable
   *  pour les tests déterministes du cœur de progression. */
  hazards?: boolean;
}

export function defineCosmos(
  engine: RuleEngine,
  world: World,
  fate: FateQueue,
  rng: Rng,
  temperament: UniverseTemperament,
  options: CosmosOptions = {},
): Cosmos {
  const hazardsEnabled = options.hazards ?? true;
  defineRules(engine, temperament);
  defineMilestones(engine);

  // ================================================================
  // BIG BANG — la singularité PRÉCÈDE tout : elle est là dès le Vide, seule
  // chose qui existe avant l'existence. Il n'y a pas de compte à rebours —
  // avant le bang, le temps n'existe pas pour le compter. Coder la règle
  // « Big Bang » EST la déflagration : le tick 0 est le Big Bang, et le
  // Temps, l'Espace et la Matière NAISSENT de l'événement (activés par lui,
  // coupables ensuite : on peut geler le temps de son univers, pas le coder
  // avant qu'il existe). Sans Gravité codée ensuite, l'expansion disperse
  // tout : un univers peut rater son départ. Pas de réussite forcée.
  // ================================================================
  let bangOccurred = false;
  {
    const e = world.createEntity();
    world.add(e, Species, { kind: 'singularity', label: 'Singularité' });
    world.add(e, Position, { x: 0, y: 0 });
    world.add(e, Size, { size: 1.5 });
  }

  const doBang = (w: World): void => {
    if (bangOccurred) return;
    bangOccurred = true;
    const sing = firstOfKind(w, 'singularity');
    const origin = (sing !== null ? w.get(sing, Position) : undefined) ?? { x: 0, y: 0 };
    // Le temps, l'espace et la matière naissent DE la déflagration.
    engine.activate(RULE_TIME, w);
    engine.activate(RULE_SPACE, w);
    engine.activate(RULE_MATTER, w);
    const burst = Math.min(Math.round(engine.param(RULE_MATTER, 'max')), 140);
    for (let i = 0; i < burst; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const speed = rng.range(0.5, 1.3);
      const swirl = rng.range(0.08, 0.22);
      const e = w.createEntity();
      w.add(e, Species, { kind: 'particle', label: 'Particule' });
      w.add(e, Position, { x: origin.x + Math.cos(angle) * rng.range(0, 6), y: origin.y + Math.sin(angle) * rng.range(0, 6) });
      w.add(e, Velocity, {
        vx: Math.cos(angle) * speed - Math.sin(angle) * swirl,
        vy: Math.sin(angle) * speed + Math.cos(angle) * swirl,
      });
      w.add(e, Mass, { mass: 1 });
      w.add(e, Size, { size: 1 });
    }
    const wave = w.createEntity();
    w.add(wave, Species, { kind: 'shockwave', label: 'Déflagration' });
    w.add(wave, Position, { x: origin.x, y: origin.y });
    w.add(wave, Size, { size: 1 });
    w.add(wave, Shockwave, { bornTick: w.tick, maxRadius: 650, flash: true });
    if (sing !== null) w.destroyEntity(sing);
    w.emit({ kind: 'big-bang', entity: sing ?? 0, tick: w.tick, data: { particles: burst } });
  };
  engine.onEvent((e) => {
    if (e.kind === 'activated' && e.id === RULE_BIGBANG) doBang(world);
  });

  /** L'expansion emporte hors de l'existence la matière qui s'échappe trop
   *  loin — et libère son budget de masse. Intrinsèque : l'espace n'attend
   *  la permission de personne pour être vaste. */
  const expansion: System = {
    name: 'expansion',
    update(w): void {
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'particle') continue;
        const pos = w.get(e, Position);
        if (pos && pos.x * pos.x + pos.y * pos.y > EXPANSION_BOUNDARY * EXPANSION_BOUNDARY) {
          w.destroyEntity(e);
        }
      }
    },
  };

  // ================================================================
  // MATIÈRE — des particules condensent du vide, à taux paramétrable.
  // (Rien ne condense AVANT le Big Bang : la bruine est son résidu.)
  // ================================================================
  // Le plafond porte sur les particules LIBRES simultanées : le vide condense
  // en continu tant que la règle tourne (l'agrégation qui en consomme laisse
  // la place à de nouvelles). Crucial pour la progression : même si le joueur
  // code Fusion très tard, il reste toujours de la poussière pour former des
  // planètes autour de l'étoile. Couper Matière arrête le robinet — c'est le
  // levier stratégique pour figer la masse de l'univers.
  let condensationAccumulator = 0;
  const condensation: System = {
    name: 'condensation',
    update(w): void {
      if (!bangOccurred) return;
      const max = engine.param(RULE_MATTER, 'max');
      let free = countKind(w, 'particle');
      if (free >= max) {
        condensationAccumulator = 0;
        return;
      }
      // Le vide n'est pas un puits sans fond : la condensation ralentit à
      // mesure que la masse totale approche le budget de masse, et s'arrête
      // à saturation. Sans ce frein, les planètes prolifèrent sans fin (testé
      // à 200 mondes au tick 53 000 — l'univers doit être FINI pour être lu).
      const massBudget = engine.param(RULE_MATTER, 'massBudget');
      const starvation = Math.max(0, 1 - totalMass(w) / massBudget);
      condensationAccumulator += (engine.param(RULE_MATTER, 'rate') * starvation) / 100;
      while (condensationAccumulator >= 1 && free < max) {
        condensationAccumulator -= 1;
        free++;
        const angle = rng.range(0, Math.PI * 2);
        const r = UNIVERSE_RADIUS * Math.sqrt(rng.next());
        const e = w.createEntity();
        w.add(e, Species, { kind: 'particle', label: 'Particule' });
        w.add(e, Position, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
        // Légère vitesse tangentielle : le futur effondrement TOURNE au lieu
        // de tomber tout droit — plus lisible et plus cosmique.
        const vt = rng.range(0.02, 0.08);
        w.add(e, Velocity, { vx: -Math.sin(angle) * vt, vy: Math.cos(angle) * vt });
        w.add(e, Mass, { mass: 1 });
        w.add(e, Size, { size: 1 });
      }
    },
  };

  // ================================================================
  // GRAVITÉ — les particules dérivent vers l'amas le plus proche, ou vers le
  // centre de masse global tant qu'aucun amas n'existe. O(n·amas), pas de
  // n-corps : la lisibilité de l'émergence prime sur le réalisme.
  // ================================================================
  const gravityDrift: System = {
    name: 'gravity',
    update(w): void {
      const strength = engine.param(RULE_GRAVITY, 'strength');
      const attractors: { x: number; y: number; mass: number; isBlackHole: boolean }[] = [];
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'clump' && s.kind !== 'star' && s.kind !== 'blackhole') continue;
        const pos = w.get(e, Position);
        const mass = w.get(e, Mass);
        if (pos && mass) attractors.push({ x: pos.x, y: pos.y, mass: mass.mass, isBlackHole: s.kind === 'blackhole' });
      }
      // Centre de masse des particules : l'attracteur de secours du début.
      let cx = 0;
      let cy = 0;
      let count = 0;
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'particle') continue;
        const pos = w.get(e, Position);
        if (!pos) continue;
        cx += pos.x;
        cy += pos.y;
        count++;
      }
      if (count > 0) {
        cx /= count;
        cy /= count;
      }
      for (const [e, s] of w.query(Species)) {
        const isParticle = s.kind === 'particle';
        const isClump = s.kind === 'clump';
        if (!isParticle && !isClump) continue;
        const pos = w.get(e, Position);
        const vel = w.get(e, Velocity);
        if (!pos || !vel) continue;
        const ownMass = w.get(e, Mass)?.mass ?? 1;
        // Les particules tombent vers l'attracteur le plus proche ; les amas
        // tombent vers le plus proche PLUS MASSIF qu'eux : c'est la fusion
        // hiérarchique qui concentre la masse jusqu'au seuil d'allumage.
        let tx = isParticle ? cx : Number.NaN;
        let ty = isParticle ? cy : Number.NaN;
        let bestD = Infinity;
        for (const a of attractors) {
          if (isClump && a.mass <= ownMass) continue;
          const d = (a.x - pos.x) ** 2 + (a.y - pos.y) ** 2;
          // L'emprise d'un trou noir est LOCALE : au-delà de son rayon
          // d'influence, la matière libre s'organise entre elle.
          if (a.isBlackHole && d > BLACK_HOLE_PULL_RADIUS * BLACK_HOLE_PULL_RADIUS) continue;
          if (d > 0 && d < bestD) {
            bestD = d;
            tx = a.x;
            ty = a.y;
          }
        }
        if (Number.isNaN(tx)) continue; // amas dominant : rien ne l'attire
        const dx = tx - pos.x;
        const dy = ty - pos.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          vel.vx += (dx / dist) * strength;
          vel.vy += (dy / dist) * strength;
        }
        // Amortissement : sans lui les corps oscillent au lieu de tomber.
        vel.vx *= 0.985;
        vel.vy *= 0.985;
      }
    },
  };

  // ================================================================
  // AGRÉGATION — proche + proche = amas ; l'amas absorbe et grossit.
  // ================================================================
  const aggregation: System = {
    name: 'aggregation',
    update(w): void {
      const radius = engine.param(RULE_AGGREGATION, 'mergeRadius');
      const particles: [EntityId, { x: number; y: number }][] = [];
      const clumps: [EntityId, { x: number; y: number }][] = [];
      for (const [e, s] of w.query(Species)) {
        const pos = w.get(e, Position);
        if (!pos) continue;
        if (s.kind === 'particle') particles.push([e, pos]);
        else if (s.kind === 'clump') clumps.push([e, pos]);
      }
      // Particule absorbée par un amas proche.
      for (const [pe, ppos] of particles) {
        if (!w.isAlive(pe)) continue;
        for (const [ce, cpos] of clumps) {
          if (!w.isAlive(ce)) continue;
          const cSize = w.get(ce, Size)?.size ?? 1;
          const reach = (cSize + radius) ** 2;
          if ((ppos.x - cpos.x) ** 2 + (ppos.y - cpos.y) ** 2 < reach) {
            const cm = w.get(ce, Mass);
            const cs = w.get(ce, Size);
            if (cm && cs) {
              cm.mass += 1;
              cs.size = sizeFromMass(cm.mass);
            }
            w.destroyEntity(pe);
            break;
          }
        }
      }
      // Deux particules libres se rencontrent : naissance d'un amas.
      for (let i = 0; i < particles.length; i++) {
        const [ae, apos] = particles[i] as (typeof particles)[number];
        if (!w.isAlive(ae)) continue;
        for (let j = i + 1; j < particles.length; j++) {
          const [be, bpos] = particles[j] as (typeof particles)[number];
          if (!w.isAlive(be)) continue;
          if ((apos.x - bpos.x) ** 2 + (apos.y - bpos.y) ** 2 < radius * radius) {
            const e = w.createEntity();
            w.add(e, Species, { kind: 'clump', label: 'Amas' });
            w.add(e, Position, { x: (apos.x + bpos.x) / 2, y: (apos.y + bpos.y) / 2 });
            w.add(e, Velocity, { vx: 0, vy: 0 }); // mobile : la gravité l'attirera vers plus massif
            w.add(e, Mass, { mass: 2 });
            w.add(e, Size, { size: sizeFromMass(2) });
            w.destroyEntity(ae);
            w.destroyEntity(be);
            break;
          }
        }
      }
      // Les étoiles ET les trous noirs absorbent ce qui les touche : particules
      // et amas tombés dedans les nourrissent au lieu de s'empiler dessus.
      const stars: [EntityId, { x: number; y: number }][] = [];
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'star' && s.kind !== 'blackhole') continue;
        const pos = w.get(e, Position);
        if (pos) stars.push([e, pos]);
      }
      for (const [se, spos] of stars) {
        const starSize = w.get(se, Size)?.size ?? 6;
        const sm = w.get(se, Mass);
        if (!sm) continue;
        for (const [pe, ppos] of [...particles, ...clumps]) {
          if (!w.isAlive(pe)) continue;
          const pSize = w.get(pe, Size)?.size ?? 1;
          if ((ppos.x - spos.x) ** 2 + (ppos.y - spos.y) ** 2 < (starSize + pSize * 0.5) ** 2) {
            sm.mass += w.get(pe, Mass)?.mass ?? 1;
            w.destroyEntity(pe);
          }
        }
      }
      // Amas qui se chevauchent : le plus massif absorbe l'autre.
      for (let i = 0; i < clumps.length; i++) {
        const [ae, apos] = clumps[i] as (typeof clumps)[number];
        if (!w.isAlive(ae)) continue;
        for (let j = i + 1; j < clumps.length; j++) {
          const [be, bpos] = clumps[j] as (typeof clumps)[number];
          if (!w.isAlive(be)) continue;
          const sa = w.get(ae, Size)?.size ?? 1;
          const sb = w.get(be, Size)?.size ?? 1;
          if ((apos.x - bpos.x) ** 2 + (apos.y - bpos.y) ** 2 < (sa + sb) ** 2) {
            const [big, small] = (w.get(ae, Mass)?.mass ?? 0) >= (w.get(be, Mass)?.mass ?? 0) ? [ae, be] : [be, ae];
            const bm = w.get(big, Mass);
            const bs = w.get(big, Size);
            const sm = w.get(small, Mass);
            if (bm && bs && sm) {
              bm.mass += sm.mass;
              bs.size = sizeFromMass(bm.mass);
            }
            w.destroyEntity(small);
          }
        }
      }
    },
  };

  // ================================================================
  // FUSION — le destin des amas massifs est écrit (allumage différé, visible
  // dans la Fate Queue de l'amas), et les amas légers proches d'une étoile
  // sont capturés en orbite comme planètes, SANS téléportation (la phase
  // d'orbite est calée sur leur position actuelle).
  // ================================================================
  let planetCounter = 0;
  const fusion: System = {
    name: 'fusion',
    update(w, tick): void {
      const ignitionMass = engine.param(RULE_FUSION, 'ignitionMass');
      const delay = engine.param(RULE_FUSION, 'ignitionDelay');
      const stars: [EntityId, { x: number; y: number }][] = [];
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'star') continue;
        const pos = w.get(e, Position);
        if (pos) stars.push([e, pos]);
      }
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'clump') continue;
        const mass = w.get(e, Mass)?.mass ?? 0;
        const pos = w.get(e, Position);
        if (!pos) continue;
        if (mass >= ignitionMass) {
          if (!w.has(e, Igniting)) {
            // Le destin s'écrit AU FRANCHISSEMENT du seuil, avec le délai du
            // moment — changer ignitionDelay ensuite n'y touche plus (contrat b).
            const atTick = tick + Math.round(delay);
            fate.schedule(atTick, e, FATE_IGNITION);
            w.add(e, Igniting, { atTick });
          }
        } else if (mass >= 9 && stars.length > 0 && !w.has(e, Orbit)) {
          // Seuls les amas déjà consistants deviennent des planètes : les
          // poussières continuent de grossir (ou finissent dans l'étoile).
          let nearest: EntityId | null = null;
          let bestD = 420 * 420;
          let sx = 0;
          let sy = 0;
          for (const [se, spos] of stars) {
            const d = (spos.x - pos.x) ** 2 + (spos.y - pos.y) ** 2;
            if (d < bestD) {
              bestD = d;
              nearest = se;
              sx = spos.x;
              sy = spos.y;
            }
          }
          if (nearest !== null) {
            planetCounter++;
            const radius = Math.max(40, Math.sqrt(bestD));
            const angularSpeed = 0.9 / radius;
            const currentAngle = Math.atan2(pos.y - sy, pos.x - sx);
            const species = w.getRequired(e, Species);
            species.kind = 'planet';
            // La nature du monde se décide ici : massif → géante gazeuse ;
            // sinon rocheux près de l'étoile, gelé au-delà de la zone tiède.
            const luminosity = w.get(nearest, StellarClass)?.luminosity ?? 1;
            const kind =
              mass >= GAS_GIANT_MIN_MASS
                ? 'gas'
                : radius > temperament.habitableOrbitMax * luminosity * 1.4
                  ? 'ice'
                  : 'rocky';
            w.add(e, PlanetKind, { kind });
            species.label =
              kind === 'gas' ? `Géante-${planetCounter}` : kind === 'ice' ? `Glace-${planetCounter}` : `Monde-${planetCounter}`;
            const size = w.get(e, Size);
            if (size) size.size = Math.max(2.5, size.size * (kind === 'gas' ? 2.1 : 1.6));
            w.add(e, Orbit, {
              center: nearest,
              radius,
              angularSpeed,
              // phase telle que phase + speed·tick == angle actuel : capture continue.
              phase: currentAngle - angularSpeed * tick,
            });
            // Née incandescente : le refroidissement prendra des milliers de ticks.
            w.add(e, Temperature, { current: 900, coolingPerTick: 0.15 });
            w.remove(e, Velocity);
          }
        }
      }
    },
  };

  fate.onKind(FATE_IGNITION, (w, event) => {
    if (!w.isAlive(event.entity)) return; // l'amas a pu être absorbé entre-temps
    const species = w.get(event.entity, Species);
    const size = w.get(event.entity, Size);
    if (!species || species.kind !== 'clump') return;
    species.kind = 'star';
    if (size) size.size = Math.max(6, size.size * 1.4);
    w.remove(event.entity, Igniting);
    w.remove(event.entity, Velocity);

    // La classe est figée MAINTENANT, d'après la masse accumulée — et le
    // destin de l'étoile s'écrit à sa naissance, comme celui des vivants.
    const mass = w.get(event.entity, Mass)?.mass ?? 24;
    const cls =
      mass < STELLAR_CLASSES.dwarf.maxMass
        ? { name: 'dwarf', label: 'Naine rouge', ...STELLAR_CLASSES.dwarf }
        : mass < STELLAR_CLASSES.yellow.maxMass
          ? { name: 'yellow', label: 'Étoile jaune', ...STELLAR_CLASSES.yellow }
          : { name: 'giant', label: 'Géante bleue', ...STELLAR_CLASSES.giant };
    species.label = cls.label;
    w.add(event.entity, StellarClass, { className: cls.name, luminosity: cls.luminosity });
    fate.schedule(w.tick + rng.int(cls.lifeMin, cls.lifeMax), event.entity, cls.death);
    w.emit({ kind: 'star-born', entity: event.entity, tick: w.tick, data: { className: cls.name } });
  });

  // --- Extinction tranquille (naines, jaunes) : l'étoile devient un vestige
  // froid ; ses mondes gardent leur orbite mais perdent leur soleil. ---
  fate.onKind(FATE_STAR_DEATH, (w, event) => {
    const species = w.get(event.entity, Species);
    if (!species || species.kind !== 'star') return;
    species.kind = 'remnant';
    species.label = 'Naine blanche';
    const size = w.get(event.entity, Size);
    if (size) size.size = Math.max(2, size.size * 0.35);
    w.remove(event.entity, StellarClass);
    w.emit({ kind: 'star-died', entity: event.entity, tick: w.tick });
  });

  // --- Supernova : stérilise près, ensemence loin, laisse un vestige — trou
  // noir si l'étoile était assez massive. La mort est aussi un engrais. ---
  fate.onKind(FATE_SUPERNOVA, (w, event) => {
    const star = event.entity;
    const species = w.get(star, Species);
    const starPos = w.get(star, Position);
    if (!species || species.kind !== 'star' || !starPos) return;
    let casualties = 0;
    let enriched = 0;
    for (const [planet, s] of w.query(Species)) {
      if (s.kind !== 'planet') continue;
      const pos = w.get(planet, Position);
      if (!pos) continue;
      const d = Math.hypot(pos.x - starPos.x, pos.y - starPos.y);
      if (d <= SHOCK_STERILIZE_RADIUS) {
        for (const [e, es] of w.query(Species)) {
          if (w.get(e, OnPlanet)?.planet !== planet) continue;
          if (es.kind === 'person' || es.kind === 'tree') {
            casualties++;
            w.destroyEntity(e);
          } else if (es.kind === 'lake') {
            const ls = w.get(e, Size);
            if (ls) ls.size = Math.max(10, ls.size * 0.2);
          }
        }
        w.remove(planet, Habitable);
        abiogenesisScheduled.delete(planet);
        const t = w.get(planet, Temperature);
        if (t) t.current += 600;
      } else if (d <= SHOCK_ENRICH_RADIUS) {
        // Les éléments lourds pleuvent : la chimie est OFFERTE par la mort
        // de l'étoile (produit d'événement — pas besoin de la règle Chimie).
        const chem = w.get(planet, Chemistry);
        if (chem) chem.richness = Math.min(2, chem.richness + 0.8);
        else w.add(planet, Chemistry, { richness: 0.8 });
        enriched++;
      }
    }
    const mass = w.get(star, Mass)?.mass ?? 0;
    if (mass >= BLACK_HOLE_MASS) {
      species.kind = 'blackhole';
      species.label = 'Trou noir';
      const size = w.get(star, Size);
      if (size) size.size = Math.max(3, Math.cbrt(mass) * 0.8);
    } else {
      species.kind = 'remnant';
      species.label = 'Étoile à neutrons';
      const size = w.get(star, Size);
      if (size) size.size = 2;
    }
    w.remove(star, StellarClass);
    // L'anneau d'onde de choc, purement visuel, se dissipe tout seul.
    const wave = w.createEntity();
    w.add(wave, Species, { kind: 'shockwave', label: 'Onde de choc' });
    w.add(wave, Position, { x: starPos.x, y: starPos.y });
    w.add(wave, Size, { size: 1 }); // requis par le rendu ; le rayon vient de Shockwave
    w.add(wave, Shockwave, { bornTick: w.tick, maxRadius: SHOCK_ENRICH_RADIUS, flash: false });
    w.emit({ kind: 'supernova', entity: star, tick: w.tick, data: { casualties, enriched, blackHole: mass >= BLACK_HOLE_MASS } });
  });

  /** Dissipation des ondes de choc + accrétion des trous noirs : les orbites
   *  de leurs mondes décroissent, et ce qui tombe dedans les nourrit. */
  const blackHoles: System = {
    name: 'black-holes',
    update(w, tick): void {
      for (const [wave, sw] of w.query(Shockwave)) {
        if (tick - sw.bornTick > 400) w.destroyEntity(wave);
      }
      for (const [planet, s] of w.query(Species)) {
        if (s.kind !== 'planet') continue;
        const orbit = w.get(planet, Orbit);
        if (!orbit || orbit.center === 0) continue;
        if (w.get(orbit.center, Species)?.kind !== 'blackhole') continue;
        orbit.radius -= BLACK_HOLE_DECAY;
        const bhSize = w.get(orbit.center, Size)?.size ?? 4;
        if (orbit.radius <= bhSize + 3) {
          let souls = 0;
          for (const [e, es] of w.query(OnPlanet)) {
            if (es.planet !== planet) continue;
            const kind = w.get(e, Species)?.kind;
            if (kind === 'person' || kind === 'tree') souls++;
            w.destroyEntity(e);
          }
          const bm = w.get(orbit.center, Mass);
          if (bm) bm.mass += w.get(planet, Mass)?.mass ?? 0;
          w.emit({ kind: 'planet-consumed', entity: planet, tick, data: { souls } });
          w.destroyEntity(planet);
        }
      }
    },
  };

  // ================================================================
  // REFROIDISSEMENT — intrinsèque aux corps chauds, PAS une règle : une
  // braise refroidit même si le joueur ne code plus rien. (Seul le temps
  // global le suspend, puisqu'il gate l'avancée des ticks.)
  // ================================================================
  const cooling: System = {
    name: 'cooling',
    update(w): void {
      for (const [, t] of w.query(Temperature)) {
        t.current = Math.max(0, t.current - t.coolingPerTick);
      }
    },
  };

  // ================================================================
  // CHIMIE — les planètes refroidies s'enrichissent, à taux paramétrable.
  // ================================================================
  const chemistry: System = {
    name: 'chemistry',
    update(w): void {
      const rate = engine.param(RULE_CHEMISTRY, 'enrichRate');
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'planet') continue;
        const t = w.get(e, Temperature);
        if (!t || t.current >= COOLED_TEMP) continue;
        const chem = w.get(e, Chemistry);
        if (!chem) w.add(e, Chemistry, { richness: 0 });
        else chem.richness = Math.min(2, chem.richness + rate);
      }
    },
  };

  // ================================================================
  // CONDITIONS DE VIE — l'eau se forme sur les planètes riches en chimie.
  // Le lac est géré ici (pas via GrowthRate) pour que waterGrowth soit lu en
  // direct : accélérer l'eau depuis l'éditeur agit dès le tick suivant.
  // ================================================================
  const lifeConditions: System = {
    name: 'life-conditions',
    update(w, tick): void {
      const waterGrowth = engine.param(RULE_CONDITIONS, 'waterGrowth');
      for (const [planet, s] of w.query(Species)) {
        if (s.kind !== 'planet') continue;
        // Une géante gazeuse ne porte pas d'eau ; un monde de glace, si — sa
        // glace fond s'il migre en zone tempérée (terraformation narrative).
        if (w.get(planet, PlanetKind)?.kind === 'gas') continue;
        const chem = w.get(planet, Chemistry);
        if (!chem || chem.richness < 1) continue;
        const orbit = w.get(planet, Orbit);
        if (!orbit) continue;
        // La zone tempérée dépend de l'ÉTOILE : une naine rouge la resserre,
        // une géante bleue la repousse — et une étoile morte n'en a plus.
        const centerSpecies = orbit.center !== 0 ? w.get(orbit.center, Species) : undefined;
        if (centerSpecies?.kind !== 'star') continue;
        const luminosity = w.get(orbit.center, StellarClass)?.luminosity ?? 1;
        if (
          orbit.radius < temperament.habitableOrbitMin * luminosity ||
          orbit.radius > temperament.habitableOrbitMax * luminosity
        )
          continue;
        let lake: EntityId | null = null;
        for (const [le, ls] of w.query(Species)) {
          if (ls.kind === 'lake' && w.get(le, OnPlanet)?.planet === planet) {
            lake = le;
            break;
          }
        }
        if (lake === null) {
          lake = w.createEntity();
          w.add(lake, Species, { kind: 'lake', label: 'Mer primordiale' });
          w.add(lake, Position, { x: -150, y: 60 });
          w.add(lake, Size, { size: 15 });
          w.add(lake, OnPlanet, { planet });
        } else {
          const size = w.getRequired(lake, Size);
          size.size = Math.min(240, size.size + waterGrowth);
          if (size.size >= 120 && !w.has(planet, Habitable)) {
            w.add(planet, Habitable, { sinceTick: tick });
            w.emit({ kind: 'planet-habitable', entity: planet, tick });
          }
        }
      }
    },
  };

  // ================================================================
  // VIE — abiogenèse (destin planifié, visible sur la planète) puis cycles
  // écologiques auto-reconductibles. Les cycles se replanifient TOUJOURS,
  // mais ne créent de la vie que si la règle est active : couper Vie stoppe
  // les naissances, jamais les vivants (produits).
  // ================================================================
  const abiogenesisScheduled = new Set<EntityId>();
  const life: System = {
    name: 'life',
    update(w, tick): void {
      for (const [planet] of w.query(Habitable)) {
        if (abiogenesisScheduled.has(planet)) continue;
        abiogenesisScheduled.add(planet);
        fate.schedule(tick + 400, planet, FATE_ABIOGENESIS);
      }
    },
  };

  const onPlanetOfKind = (w: World, planet: EntityId, kind: string): EntityId[] => {
    const out: EntityId[] = [];
    for (const [e, s] of w.query(Species)) {
      if (s.kind === kind && w.get(e, OnPlanet)?.planet === planet) out.push(e);
    }
    return out;
  };

  const clampX = (x: number): number =>
    Math.max(-SURFACE_HALF_WIDTH * 0.95, Math.min(SURFACE_HALF_WIDTH * 0.95, x));
  const clampY = (y: number): number =>
    Math.max(-SURFACE_HALF_HEIGHT * 0.95, Math.min(SURFACE_HALF_HEIGHT * 0.95, y));

  const isUnderwater = (w: World, planet: EntityId, x: number, y: number): boolean => {
    for (const [le, ls] of w.query(Species)) {
      if (ls.kind !== 'lake' || w.get(le, OnPlanet)?.planet !== planet) continue;
      const pos = w.get(le, Position);
      const size = w.get(le, Size);
      if (pos && size && (x - pos.x) ** 2 + (y - pos.y) ** 2 < size.size ** 2) return true;
    }
    return false;
  };

  const personLifespan = (): number => {
    const base = engine.param(RULE_LIFE, 'lifespan');
    return rng.int(Math.round(base * 0.6), Math.round(base * 1.6));
  };

  fate.onKind(FATE_ABIOGENESIS, (w, event) => {
    const planet = event.entity;
    if (!w.isAlive(planet) || !engine.isActive(RULE_LIFE)) {
      // Règle coupée avant l'éclosion : le monde reste stérile, mais le
      // potentiel demeure — on ré-armera si la règle revient.
      abiogenesisScheduled.delete(planet);
      return;
    }
    // La vie naît sur le rivage de la mer primordiale.
    for (let i = 0; i < 3; i++) {
      const tree = spawnTree(w, fate, {
        x: clampX(-150 + rng.range(-140, 220)),
        y: clampY(60 + rng.range(-160, 160)),
        lifespan: rng.int(2000, 6000),
        maxSize: rng.range(2, 4),
      });
      w.add(tree, OnPlanet, { planet });
    }
    for (let i = 0; i < 2; i++) {
      const person = spawnPerson(w, fate, {
        x: clampX(30 + rng.range(-60, 60)),
        y: clampY(90 + rng.range(-60, 60)),
        lifespan: personLifespan(),
        rng,
      });
      w.add(person, OnPlanet, { planet });
    }
    w.emit({ kind: 'life-born', entity: planet, tick: w.tick });
    fate.schedule(w.tick + rng.int(60, 180), planet, FATE_FOREST_SEED);
    fate.schedule(w.tick + rng.int(120, 300), planet, FATE_VILLAGE_BIRTH);
  });

  fate.onKind(FATE_FOREST_SEED, (w, event) => {
    const planet = event.entity;
    if (!w.isAlive(planet)) return;
    if (engine.isActive(RULE_LIFE)) {
      const trees = onPlanetOfKind(w, planet, 'tree');
      if (trees.length > 0 && trees.length < MAX_TREES_PER_PLANET) {
        const parentPos = w.get(trees[rng.int(0, trees.length - 1)] as EntityId, Position);
        if (parentPos) {
          const x = clampX(parentPos.x + rng.range(-80, 80));
          const y = clampY(parentPos.y + rng.range(-80, 80));
          if (!isUnderwater(w, planet, x, y)) {
            const tree = spawnTree(w, fate, { x, y, lifespan: rng.int(2000, 6000), maxSize: rng.range(2, 4) });
            w.add(tree, OnPlanet, { planet });
          }
        }
      }
    }
    fate.schedule(w.tick + rng.int(60, 180), planet, FATE_FOREST_SEED);
  });

  fate.onKind(FATE_VILLAGE_BIRTH, (w, event) => {
    const planet = event.entity;
    if (!w.isAlive(planet)) return;
    if (engine.isActive(RULE_LIFE)) {
      const people = onPlanetOfKind(w, planet, 'person');
      if (people.length > 0 && people.length < MAX_PEOPLE_PER_PLANET) {
        const parentPos = w.get(people[rng.int(0, people.length - 1)] as EntityId, Position);
        if (parentPos) {
          const person = spawnPerson(w, fate, {
            x: clampX(parentPos.x + rng.range(-30, 30)),
            y: clampY(parentPos.y + rng.range(-30, 30)),
            lifespan: personLifespan(),
            rng,
          });
          w.add(person, OnPlanet, { planet });
          w.emit({ kind: 'birth', entity: person, tick: w.tick });
        }
      }
    }
    fate.schedule(w.tick + rng.int(120, 300), planet, FATE_VILLAGE_BIRTH);
  });

  // ================================================================
  // ALÉAS COSMIQUES — l'univers écrit ses propres destins hostiles dans la
  // Fate Queue. Ils sont ANNONCÉS longtemps à l'avance (l'événement est
  // porté par la cible : la sélectionner montre la menace dans sa timeline),
  // et le joueur arbitre : payer pour réécrire, contrer par une règle, ou
  // laisser faire. PAS une règle codable : l'entropie ne se désactive pas.
  // ================================================================
  const livingPlanets = (w: World): EntityId[] => {
    const out = new Set<EntityId>();
    for (const [e, s] of w.query(Species)) {
      if (s.kind !== 'person' && s.kind !== 'tree') continue;
      const planet = w.get(e, OnPlanet)?.planet;
      if (planet !== undefined && w.isAlive(planet)) out.add(planet);
    }
    return [...out];
  };

  const allPlanets = (w: World): EntityId[] => {
    const out: EntityId[] = [];
    for (const [e, s] of w.query(Species)) if (s.kind === 'planet') out.push(e);
    return out;
  };

  const pick = <T>(arr: T[]): T | null => (arr.length === 0 ? null : arr[rng.int(0, arr.length - 1)] ?? null);

  let nextHazardRoll = -1;
  const hazardRoller: System = {
    name: 'hazards',
    update(w, tick): void {
      const planets = allPlanets(w);
      if (planets.length === 0) return; // rien à menacer, l'entropie attend
      if (nextHazardRoll < 0) {
        nextHazardRoll = tick + rng.int(3000, 5000); // période de grâce
        return;
      }
      if (tick < nextHazardRoll) return;
      // La cadence est un trait du TEMPÉRAMENT : un Essaim hostile frappe
      // deux fois plus souvent qu'un Univers clément.
      nextHazardRoll = tick + rng.int(temperament.hazardIntervalMin, temperament.hazardIntervalMax);

      // Le drame vise la vie : un monde vivant en priorité, sinon au hasard.
      const living = livingPlanets(w);
      const roll = rng.next();
      if (roll < temperament.asteroidWeight) {
        // --- Astéroïde ---
        const target = pick(living) ?? pick(planets);
        if (target === null) return;
        const impactTick = tick + rng.int(1500, 3500);
        const eventId = fate.schedule(impactTick, target, FATE_IMPACT);
        const angle = rng.range(0, Math.PI * 2);
        const asteroid = w.createEntity();
        w.add(asteroid, Species, { kind: 'asteroid', label: 'Astéroïde' });
        const targetPos = w.get(target, Position);
        w.add(asteroid, Position, {
          x: (targetPos?.x ?? 0) + Math.cos(angle) * UNIVERSE_RADIUS * 0.9,
          y: (targetPos?.y ?? 0) + Math.sin(angle) * UNIVERSE_RADIUS * 0.9,
        });
        w.add(asteroid, Size, { size: 2 });
        const pos = w.getRequired(asteroid, Position);
        w.add(asteroid, Hazard, {
          eventId,
          target,
          bornTick: tick,
          fromX: pos.x,
          fromY: pos.y,
          impactTick,
          shieldChecked: false,
        });
        w.emit({ kind: 'hazard-announced', entity: target, tick, data: { hazard: FATE_IMPACT, atTick: impactTick } });
      } else if (roll < temperament.asteroidWeight + temperament.droughtWeight) {
        // --- Sécheresse : vise un monde qui a une mer ---
        const withLake = planets.filter((p) => findLakeOf(w, p) !== null);
        const target = pick(withLake.filter((p) => living.includes(p))) ?? pick(withLake);
        if (target === null) return;
        const atTick = tick + rng.int(2000, 4000);
        fate.schedule(atTick, target, FATE_DROUGHT);
        w.emit({ kind: 'hazard-announced', entity: target, tick, data: { hazard: FATE_DROUGHT, atTick } });
      } else {
        // --- Éruption stellaire : vise une étoile qui a des planètes proches ---
        const stars: EntityId[] = [];
        for (const [e, s] of w.query(Species)) if (s.kind === 'star') stars.push(e);
        const target = pick(stars);
        if (target === null) return;
        const atTick = tick + rng.int(1500, 3000);
        fate.schedule(atTick, target, FATE_FLARE);
        w.emit({ kind: 'hazard-announced', entity: target, tick, data: { hazard: FATE_FLARE, atTick } });
      }
    },
  };

  /** Les astéroïdes volent vers leur cible MOUVANTE, calés sur le tick
   *  d'impact (replanifier l'événement ralentit/accélère le corps). Si
   *  l'événement a disparu de la queue (annulé), le corps est dévié. */
  const hazardMover: System = {
    name: 'hazard-mover',
    update(w, tick): void {
      for (const [asteroid, hz] of w.query(Hazard)) {
        const event = fate.eventsFor(hz.target).find((ev) => ev.id === hz.eventId);
        if (!event || !w.isAlive(hz.target)) {
          w.destroyEntity(asteroid);
          w.emit({ kind: 'hazard-deflected', entity: hz.target, tick });
          continue;
        }
        hz.impactTick = event.tick;
        const pos = w.get(asteroid, Position);
        const targetPos = w.get(hz.target, Position);
        if (!pos || !targetPos) continue;
        const progress = Math.min(1, Math.max(0, (tick - hz.bornTick) / (event.tick - hz.bornTick)));
        // Bouclier jovien : à mi-course, UNE chance qu'une géante gazeuse du
        // même système dévie l'astéroïde. Cultiver une géante est donc un
        // choix défensif — la variété planétaire JOUE, elle ne décore pas.
        if (!hz.shieldChecked && progress > 0.5) {
          hz.shieldChecked = true;
          const targetOrbit = w.get(hz.target, Orbit);
          if (targetOrbit) {
            let hasGiant = false;
            for (const [g, gs] of w.query(PlanetKind)) {
              if (gs.kind !== 'gas') continue;
              if (w.get(g, Orbit)?.center === targetOrbit.center) {
                hasGiant = true;
                break;
              }
            }
            if (hasGiant && rng.next() < JOVIAN_SHIELD_CHANCE) {
              fate.cancel(hz.eventId);
              w.emit({ kind: 'hazard-shielded', entity: hz.target, tick });
              // le mover détruira le corps au prochain passage (événement disparu)
            }
          }
        }
        pos.x = hz.fromX + (targetPos.x - hz.fromX) * progress;
        pos.y = hz.fromY + (targetPos.y - hz.fromY) * progress;
      }
    },
  };

  fate.onKind(FATE_IMPACT, (w, event) => {
    for (const [asteroid, hz] of w.query(Hazard)) {
      if (hz.eventId === event.id) w.destroyEntity(asteroid);
    }
    const planet = event.entity;
    if (!w.isAlive(planet)) return;
    let deaths = 0;
    for (const [e, s] of w.query(Species)) {
      if (w.get(e, OnPlanet)?.planet !== planet) continue;
      if (s.kind === 'person' || s.kind === 'tree') {
        deaths++;
        w.destroyEntity(e);
      } else if (s.kind === 'lake') {
        const size = w.get(e, Size);
        if (size) size.size = Math.max(10, size.size * 0.35);
      }
    }
    // L'échec laisse une trace : cicatrice permanente, monde réchauffé et
    // stérilisé. Mais le POTENTIEL demeure : si l'eau remonte, l'abiogenèse
    // pourra se reproduire — les mondes renaissent, plus lentement que prévu.
    w.remove(planet, Habitable);
    abiogenesisScheduled.delete(planet);
    w.add(planet, Crater, { sinceTick: w.tick });
    const temp = w.get(planet, Temperature);
    if (temp) temp.current += 350;
    w.emit({ kind: 'hazard-impact', entity: planet, tick: w.tick, data: { deaths } });
  });

  fate.onKind(FATE_DROUGHT, (w, event) => {
    const planet = event.entity;
    if (!w.isAlive(planet)) return;
    const lake = findLakeOf(w, planet);
    if (lake === null) return;
    const size = w.getRequired(lake, Size);
    // Baisse FIXE : le contre-jeu est de faire monter les eaux (règle
    // Conditions, paramètre en direct) au-dessus du seuil avant l'échéance.
    size.size = Math.max(10, size.size - 120);
    let deaths = 0;
    if (size.size < 100) {
      const people: EntityId[] = [];
      for (const [e, s] of w.query(Species)) {
        if (s.kind === 'person' && w.get(e, OnPlanet)?.planet === planet) people.push(e);
      }
      for (let i = 0; i < Math.ceil(people.length / 2); i++) {
        const victim = pick(people.filter((p) => w.isAlive(p)));
        if (victim !== null) {
          deaths++;
          w.destroyEntity(victim);
        }
      }
    }
    w.emit({ kind: 'hazard-drought', entity: planet, tick: w.tick, data: { deaths } });
  });

  fate.onKind(FATE_FLARE, (w, event) => {
    const star = event.entity;
    if (!w.isAlive(star)) return;
    let burned = 0;
    for (const [planet, s] of w.query(Species)) {
      if (s.kind !== 'planet') continue;
      const orbit = w.get(planet, Orbit);
      if (!orbit || orbit.center !== star || orbit.radius > 300) continue;
      const temp = w.get(planet, Temperature);
      if (temp) temp.current += 500;
      for (const [e, es] of w.query(Species)) {
        if (es.kind === 'tree' && w.get(e, OnPlanet)?.planet === planet) {
          burned++;
          w.destroyEntity(e);
        }
      }
    }
    // Contre-jeu original : ÉLOIGNER une planète (édition d'orbite) la sort
    // du rayon de l'éruption — la terraformation défensive.
    w.emit({ kind: 'hazard-flare', entity: star, tick: w.tick, data: { burned } });
  });

  function findLakeOf(w: World, planet: EntityId): EntityId | null {
    for (const [e, s] of w.query(Species)) {
      if (s.kind === 'lake' && w.get(e, OnPlanet)?.planet === planet) return e;
    }
    return null;
  }

  // ================================================================
  // TERRAFORMATION — migration d'orbite. Le rayon glisse vers sa cible tick
  // par tick ; la vitesse angulaire suit la loi de capture (0.9/r) et la
  // phase est recalée à chaque pas pour que la position reste CONTINUE :
  // le monde spirale, il ne saute jamais.
  // ================================================================
  const orbitMigration: System = {
    name: 'orbit-migration',
    update(w, tick): void {
      for (const [planet, migration] of w.query(OrbitMigration)) {
        const orbit = w.get(planet, Orbit);
        if (!orbit) {
          w.remove(planet, OrbitMigration);
          continue;
        }
        const delta = migration.targetRadius - orbit.radius;
        const step = Math.sign(delta) * Math.min(Math.abs(delta), ORBIT_MIGRATION_RATE);
        const currentAngle = orbit.phase + orbit.angularSpeed * tick;
        orbit.radius += step;
        orbit.angularSpeed = 0.9 / orbit.radius;
        orbit.phase = currentAngle - orbit.angularSpeed * tick;
        if (Math.abs(migration.targetRadius - orbit.radius) < 0.01) {
          orbit.radius = migration.targetRadius;
          w.remove(planet, OrbitMigration);
          w.emit({ kind: 'terraform-complete', entity: planet, tick });
        }
      }
    },
  };

  // ================================================================
  // ÉTOILE VORACE — trait de tempérament : les orbites décroissent, tout
  // finit par tomber dans l'étoile. La migration (payante) lutte contre la
  // décroissance (gratuite et inexorable) : c'est le bras de fer du run.
  // ================================================================
  const orbitDecay: System = {
    name: 'orbit-decay',
    update(w, tick): void {
      for (const [planet, s] of w.query(Species)) {
        if (s.kind !== 'planet') continue;
        const orbit = w.get(planet, Orbit);
        if (!orbit) continue;
        orbit.radius -= temperament.orbitDecayPerTick;
        const starSize = orbit.center !== 0 ? (w.get(orbit.center, Size)?.size ?? 6) : 6;
        if (orbit.radius <= starSize + 3) {
          // Le monde est avalé — avec tout ce qui vivait dessus.
          let souls = 0;
          for (const [e, es] of w.query(OnPlanet)) {
            if (es.planet !== planet) continue;
            const kind = w.get(e, Species)?.kind;
            if (kind === 'person' || kind === 'tree') souls++;
            w.destroyEntity(e);
          }
          const sm = orbit.center !== 0 ? w.get(orbit.center, Mass) : undefined;
          if (sm) sm.mass += w.get(planet, Mass)?.mass ?? 0;
          w.emit({ kind: 'planet-consumed', entity: planet, tick, data: { souls } });
          w.destroyEntity(planet);
        }
      }
    },
  };

  const systems: System[] = [
    expansion,
    gated(engine, RULE_MATTER, condensation),
    gated(engine, RULE_GRAVITY, gravityDrift),
    gated(engine, RULE_AGGREGATION, aggregation),
    gated(engine, RULE_FUSION, fusion),
    cooling, // intrinsèque : pas de règle
    gated(engine, RULE_CHEMISTRY, chemistry),
    gated(engine, RULE_CONDITIONS, lifeConditions),
    gated(engine, RULE_LIFE, life),
  ];
  systems.push(orbitMigration, blackHoles);
  if (temperament.orbitDecayPerTick > 0) systems.push(orbitDecay);
  // Le TIRAGE d'aléas est optionnel (tests déterministes) ; le mover, lui,
  // tourne toujours : un corps en vol vole, quelle que soit son origine.
  if (hazardsEnabled) systems.push(hazardRoller);
  systems.push(hazardMover);
  return { systems };
}

function defineRules(engine: RuleEngine, temperament: UniverseTemperament): void {
  engine.define({
    id: RULE_BIGBANG,
    label: 'Big Bang',
    description:
      'Déclenche la naissance de l\'univers : le Temps, l\'Espace et la Matière naissent de la singularité. Il n\'y a pas d\'avant.',
    requires: [],
    cost: 0, // un déclencheur, pas un processus : rien à entretenir
    params: [],
  });
  engine.define({
    id: RULE_TIME,
    label: 'Temps',
    description: 'Les ticks avancent. Né du Big Bang — coupable ensuite : un univers gelé.',
    requires: [RULE_BIGBANG],
    cost: 2,
    params: [],
  });
  engine.define({
    id: RULE_SPACE,
    label: 'Espace',
    description: "L'étendue existe : un fond, des distances, une caméra qui a un sens. Né du Big Bang.",
    requires: [RULE_BIGBANG],
    cost: 1,
    params: [],
  });
  engine.define({
    id: RULE_MATTER,
    label: 'Matière',
    description: 'Des particules condensent du vide, peu à peu. Née du Big Bang.',
    requires: [RULE_BIGBANG],
    cost: 3,
    params: [
      // Les défauts viennent du TEMPÉRAMENT : un univers "Matière rare" naît
      // avec un budget de masse famélique — c'est sa donne, pas une règle à part.
      { key: 'rate', label: 'condensation /100 ticks', default: temperament.matterRate, min: 1, max: 40, step: 1 },
      { key: 'max', label: 'particules simultanées', default: 160, min: 20, max: 400, step: 10 },
      { key: 'massBudget', label: 'masse totale de l\'univers', default: temperament.matterMassBudget, min: 200, max: 2500, step: 50 },
    ],
  });
  engine.define({
    id: RULE_GRAVITY,
    label: 'Gravité',
    description: 'La matière dérive vers la matière.',
    requires: [RULE_MATTER, RULE_TIME],
    cost: 3,
    params: [{ key: 'strength', label: 'intensité', default: 0.004, min: 0.001, max: 0.02, step: 0.001 }],
  });
  engine.define({
    id: RULE_AGGREGATION,
    label: 'Agrégation',
    description: 'Les particules proches fusionnent en amas qui grossissent.',
    requires: [RULE_GRAVITY],
    cost: 3,
    params: [{ key: 'mergeRadius', label: 'rayon de fusion', default: 10, min: 3, max: 30, step: 1 }],
  });
  engine.define({
    id: RULE_FUSION,
    label: 'Fusion',
    description:
      "Les amas assez denses s'allument (leur allumage est un destin écrit à l'avance) ; les amas légers sont capturés en orbite.",
    requires: [RULE_AGGREGATION],
    cost: 4,
    params: [
      { key: 'ignitionMass', label: "masse d'allumage", default: 24, min: 8, max: 80, step: 1 },
      { key: 'ignitionDelay', label: "délai d'allumage (ticks)", default: 250, min: 20, max: 2000, step: 10 },
    ],
  });
  engine.define({
    id: RULE_CHEMISTRY,
    label: 'Chimie',
    description: 'Les planètes refroidies (< 300°) s\'enrichissent en éléments complexes.',
    requires: [RULE_FUSION],
    cost: 3,
    params: [{ key: 'enrichRate', label: 'enrichissement /tick', default: 0.0015, min: 0.0001, max: 0.01, step: 0.0001 }],
  });
  engine.define({
    id: RULE_CONDITIONS,
    label: 'Conditions de Vie',
    description: `L'eau se forme sur les planètes riches en chimie de la zone tempérée (orbite ${temperament.habitableOrbitMin}–${temperament.habitableOrbitMax}).`,
    requires: [RULE_CHEMISTRY],
    cost: 2,
    params: [{ key: 'waterGrowth', label: 'montée des eaux /tick', default: 0.06, min: 0.01, max: 0.5, step: 0.01 }],
    worldRequirement: { label: 'une planète refroidie', check: hasCooledPlanet },
  });
  engine.define({
    id: RULE_LIFE,
    label: 'Vie',
    description: 'Abiogenèse sur les mondes habitables : arbres, personnes, générations.',
    requires: [RULE_CONDITIONS],
    cost: 4,
    params: [{ key: 'lifespan', label: 'espérance de vie de base', default: 2500, min: 200, max: 10000, step: 100 }],
    worldRequirement: { label: 'un monde habitable (eau formée)', check: hasHabitablePlanet },
  });
}

/** Les jalons : chaque étage d'émergence OBSERVÉ finance le suivant. Les
 *  récompenses sont calibrées pour forcer deux vrais dilemmes (voir tests) :
 *  à Fusion et à Vie, il faut couper un processus pour financer le suivant. */
function defineMilestones(engine: RuleEngine): void {
  engine.defineMilestone({
    id: 'm-matter',
    label: 'La matière existe (masse ≥ 40)',
    reward: 2,
    check: (w) => totalMass(w) >= 40,
  });
  engine.defineMilestone({
    id: 'm-clump',
    label: 'Premier amas dense (masse ≥ 8)',
    reward: 3,
    check: (w) => {
      for (const [, m] of w.query(Mass)) if (m.mass >= 8) return true;
      return false;
    },
  });
  engine.defineMilestone({
    id: 'm-star',
    label: 'Première étoile',
    reward: 4,
    check: (w) => countKind(w, 'star') > 0,
  });
  engine.defineMilestone({
    id: 'm-cooled',
    label: 'Première planète refroidie',
    reward: 3,
    check: hasCooledPlanet,
  });
  engine.defineMilestone({
    id: 'm-habitable',
    label: 'Premier monde habitable',
    reward: 2,
    check: hasHabitablePlanet,
  });
  engine.defineMilestone({
    id: 'm-life',
    label: 'Première vie',
    reward: 4,
    check: (w) => countKind(w, 'person') + countKind(w, 'tree') > 0,
  });
  engine.defineMilestone({
    id: 'm-supernova',
    label: 'Première supernova — l\'univers apprend la mort des étoiles',
    reward: 3,
    check: (w) => countKind(w, 'remnant') + countKind(w, 'blackhole') > 0,
  });
}

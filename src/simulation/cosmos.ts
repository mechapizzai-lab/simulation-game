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
  GrowthRate,
  Habitable,
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
import { spawnPerson, spawnTree } from './archetypes.js';

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

/** Température sous laquelle une planète compte comme "refroidie". */
const COOLED_TEMP = 300;
const MAX_TREES_PER_PLANET = 60;
const MAX_PEOPLE_PER_PLANET = 24;

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

export function defineCosmos(engine: RuleEngine, world: World, fate: FateQueue, rng: Rng): Cosmos {
  defineRules(engine);
  defineMilestones(engine);

  // ================================================================
  // MATIÈRE — des particules condensent du vide, à taux paramétrable.
  // ================================================================
  // Compteur de particules jamais créées (les fusionnées comptent) : borne la
  // masse totale de l'univers, sinon l'agrégation viderait un puits sans fond.
  let particlesCreated = 0;
  let condensationAccumulator = 0;
  const condensation: System = {
    name: 'condensation',
    update(w): void {
      const max = engine.param(RULE_MATTER, 'max');
      if (particlesCreated >= max) return;
      condensationAccumulator += engine.param(RULE_MATTER, 'rate') / 100;
      while (condensationAccumulator >= 1 && particlesCreated < max) {
        condensationAccumulator -= 1;
        particlesCreated++;
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
      const attractors: { x: number; y: number; mass: number }[] = [];
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'clump' && s.kind !== 'star') continue;
        const pos = w.get(e, Position);
        const mass = w.get(e, Mass);
        if (pos && mass) attractors.push({ x: pos.x, y: pos.y, mass: mass.mass });
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
      // Les étoiles absorbent ce qui les touche : particules et amas tombés
      // dedans nourrissent l'étoile au lieu de s'empiler dessus.
      const stars: [EntityId, { x: number; y: number }][] = [];
      for (const [e, s] of w.query(Species)) {
        if (s.kind !== 'star') continue;
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
        } else if (mass >= 5 && stars.length > 0 && !w.has(e, Orbit)) {
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
            species.label = `Monde-${planetCounter}`;
            const size = w.get(e, Size);
            if (size) size.size = Math.max(2.5, size.size * 1.6);
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
    species.label = 'Étoile';
    if (size) size.size = Math.max(6, size.size * 1.4);
    w.remove(event.entity, Igniting);
    w.remove(event.entity, Velocity);
    w.emit({ kind: 'star-born', entity: event.entity, tick: w.tick });
  });

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
        const chem = w.get(planet, Chemistry);
        if (!chem || chem.richness < 1) continue;
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

  return {
    systems: [
      gated(engine, RULE_MATTER, condensation),
      gated(engine, RULE_GRAVITY, gravityDrift),
      gated(engine, RULE_AGGREGATION, aggregation),
      gated(engine, RULE_FUSION, fusion),
      cooling, // intrinsèque : pas de règle
      gated(engine, RULE_CHEMISTRY, chemistry),
      gated(engine, RULE_CONDITIONS, lifeConditions),
      gated(engine, RULE_LIFE, life),
    ],
  };
}

function defineRules(engine: RuleEngine): void {
  engine.define({
    id: RULE_TIME,
    label: 'Temps',
    description: 'Les ticks avancent. Sans le Temps, rien ne se passe — jamais.',
    requires: [],
    cost: 2,
    params: [],
  });
  engine.define({
    id: RULE_SPACE,
    label: 'Espace',
    description: "L'étendue existe : un fond, des distances, une caméra qui a un sens.",
    requires: [],
    cost: 1,
    params: [],
  });
  engine.define({
    id: RULE_MATTER,
    label: 'Matière',
    description: 'Des particules condensent du vide, peu à peu.',
    requires: [RULE_SPACE],
    cost: 3,
    params: [
      // Le max dépasse largement la masse de la première étoile (~140) : la
      // matière qui condense APRÈS l'allumage forme le disque protoplanétaire.
      { key: 'rate', label: 'condensation /100 ticks', default: 8, min: 1, max: 40, step: 1 },
      { key: 'max', label: 'particules totales', default: 260, min: 20, max: 500, step: 10 },
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
    description: "L'eau se forme sur les planètes riches en chimie.",
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
}

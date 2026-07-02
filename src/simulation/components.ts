/**
 * Définitions des components : données pures, aucune logique.
 * Chaque interface se traduira en Resource (GDScript) ou struct (C#) sous Godot.
 */
import { defineComponent } from './ecs.js';

/** Position dans le référentiel LOCAL de la scène courante (surface de planète,
 *  système solaire...). Les unités sont abstraites ; le rendu décide de l'échelle. */
export interface PositionData {
  x: number;
  y: number;
}
export const Position = defineComponent<PositionData>('Position');

export interface VelocityData {
  vx: number;
  vy: number;
}
export const Velocity = defineComponent<VelocityData>('Velocity');

/** Âge en ticks, incrémenté chaque tick : c'est l'attribut "continu" qui rend le
 *  vieillissement visible, tandis que la mort est un événement de la Fate Queue. */
export interface AgeData {
  ticks: number;
}
export const Age = defineComponent<AgeData>('Age');

/** Espérance de vie. `max` est éditable par le joueur : la Fate Queue recalcule
 *  alors la date de mort (voir fate.ts). */
export interface LifespanData {
  max: number;
}
export const Lifespan = defineComponent<LifespanData>('Lifespan');

export interface GrowthRateData {
  /** Gain de `size` par tick. */
  perTick: number;
  /** Taille plafond : un arbre ne grandit pas à l'infini. */
  maxSize: number;
}
export const GrowthRate = defineComponent<GrowthRateData>('GrowthRate');

/** Taille courante, animée par GrowthSystem — donnée séparée de GrowthRate pour
 *  que le joueur puisse éditer la règle (rate) sans téléporter l'état (size). */
export interface SizeData {
  size: number;
}
export const Size = defineComponent<SizeData>('Size');

export interface HealthData {
  current: number;
  max: number;
}
export const Health = defineComponent<HealthData>('Health');

/** Mouvement orbital simple (vue univers/système). Paramétrique plutôt que
 *  newtonien : un prototype de god game n'a pas besoin d'intégration gravitationnelle,
 *  et une orbite paramétrique est déterministe quelle que soit la vitesse de sim. */
export interface OrbitData {
  /** Entité autour de laquelle on orbite (0 = centre de la scène). */
  center: number;
  radius: number;
  /** Radians par tick. */
  angularSpeed: number;
  /** Phase à tick 0 — permet de calculer l'angle depuis le tick absolu, sans état accumulé. */
  phase: number;
}
export const Orbit = defineComponent<OrbitData>('Orbit');

/** Étiquette d'espèce/type pour le rendu et l'UI ("person", "tree", "star"...).
 *  Une string plutôt qu'un enum : le contenu du jeu doit rester données, pas code. */
export interface SpeciesData {
  kind: string;
  label: string;
}
export const Species = defineComponent<SpeciesData>('Species');

/** Errance simple au sol : l'entité choisit un cap et le garde quelques ticks.
 *  L'état du "cerveau" vit dans le component (pas dans le system) pour rester
 *  sérialisable — indispensable pour sauvegarder/charger, et pour Godot. */
export interface WandererData {
  /** Cap courant en radians. */
  heading: number;
  /** Ticks restants avant de choisir un nouveau cap. */
  ticksUntilTurn: number;
  speed: number;
  /** Rayon de la zone d'errance autour du point d'attache. */
  homeX: number;
  homeY: number;
  range: number;
}
export const Wanderer = defineComponent<WandererData>('Wanderer');

/**
 * Tempéraments d'univers : la seed tire une "donne" qui change le problème
 * posé au joueur — pas les règles du jeu, leurs CONSTANTES. Annoncé dès le
 * Vide, comme une main de poker : deux parties consécutives ne se jouent pas
 * dans le même ordre ni avec les mêmes urgences.
 *
 * Un tempérament reste des DONNÉES pures : le contenu (cosmos.ts) les lit,
 * rien d'autre ne change. Sous Godot : une Resource de configuration.
 */
import { Rng } from './rng.js';

export interface UniverseTemperament {
  id: string;
  label: string;
  /** La promesse faite au joueur dès le Vide — elle doit se vérifier. */
  description: string;
  /** Zone habitable : bande d'orbites où l'eau peut se former. */
  habitableOrbitMin: number;
  habitableOrbitMax: number;
  /** Valeurs par défaut de la règle Matière. */
  matterMassBudget: number;
  matterRate: number;
  /** Cadence des aléas (intervalle entre tirages, en ticks). */
  hazardIntervalMin: number;
  hazardIntervalMax: number;
  /** Poids des types d'aléas (astéroïde, puis sécheresse ; le reste : éruption). */
  asteroidWeight: number;
  droughtWeight: number;
  /** Décroissance des orbites planétaires par tick (étoile vorace). */
  orbitDecayPerTick: number;
}

export const TEMPERAMENTS: readonly UniverseTemperament[] = [
  {
    id: 'calm',
    label: 'Univers clément',
    description: 'Un univers patient. Les menaces sont rares — idéal pour apprendre à coder.',
    habitableOrbitMin: 100,
    habitableOrbitMax: 220,
    matterMassBudget: 900,
    matterRate: 8,
    hazardIntervalMin: 5000,
    hazardIntervalMax: 9000,
    asteroidWeight: 0.5,
    droughtWeight: 0.3,
    orbitDecayPerTick: 0,
  },
  {
    id: 'voracious',
    label: 'Étoile vorace',
    description:
      'Les orbites décroissent lentement : tout finit par tomber dans l\'étoile. Repousser les mondes est une lutte permanente.',
    habitableOrbitMin: 100,
    habitableOrbitMax: 220,
    matterMassBudget: 900,
    matterRate: 8,
    hazardIntervalMin: 5000,
    hazardIntervalMax: 9000,
    asteroidWeight: 0.4,
    droughtWeight: 0.3,
    orbitDecayPerTick: 0.0025,
  },
  {
    id: 'shifted',
    label: 'Zone glacée',
    description:
      'La zone tempérée est lointaine (orbites 240–380) : presque aucun monde n\'y naît. Il faudra terraformer.',
    habitableOrbitMin: 240,
    habitableOrbitMax: 380,
    matterMassBudget: 900,
    matterRate: 8,
    hazardIntervalMin: 4500,
    hazardIntervalMax: 8500,
    asteroidWeight: 0.5,
    droughtWeight: 0.3,
    orbitDecayPerTick: 0,
  },
  {
    id: 'scarce',
    label: 'Matière rare',
    description:
      'Le vide est presque stérile : peu de matière, peu de planètes. Chaque monde est irremplaçable.',
    habitableOrbitMin: 100,
    habitableOrbitMax: 220,
    matterMassBudget: 420,
    matterRate: 5,
    hazardIntervalMin: 5000,
    hazardIntervalMax: 9000,
    asteroidWeight: 0.5,
    droughtWeight: 0.3,
    orbitDecayPerTick: 0,
  },
  {
    id: 'swarm',
    label: 'Essaim hostile',
    description:
      'Les astéroïdes pleuvent. Gardez toujours du calcul libre — vous en aurez besoin.',
    habitableOrbitMin: 100,
    habitableOrbitMax: 220,
    matterMassBudget: 900,
    matterRate: 8,
    hazardIntervalMin: 2500,
    hazardIntervalMax: 5000,
    asteroidWeight: 0.75,
    droughtWeight: 0.15,
    orbitDecayPerTick: 0,
  },
];

/** Tirage déterministe : la même seed donne toujours le même univers. Le
 *  brassage passe par le RNG maison pour éviter tout biais de modulo. */
export function temperamentFor(seed: number): UniverseTemperament {
  const rng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  return TEMPERAMENTS[rng.int(0, TEMPERAMENTS.length - 1)] as UniverseTemperament;
}

export function temperamentById(id: string): UniverseTemperament {
  const t = TEMPERAMENTS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown temperament "${id}"`);
  return t;
}

/**
 * Rendu de la surface d'une planète, style "HD-2D du pauvre" en Canvas2D :
 * terrain peint en couches, sprites verticaux avec ombre portée, tri par Y
 * pour la profondeur. Sous Godot, chaque draw* deviendra un Sprite3D
 * billboard sur un sol 3D — la logique de tri/ombre est offerte par le moteur.
 *
 * Ce module ne connaît PAS la caméra : il reçoit une transform surface→écran,
 * ce qui permet de le réutiliser aussi bien en vue fixe (étape 3) qu'ancré sur
 * une planète en orbite pendant le zoom continu (étape 4).
 */
import type { EntityId, World } from '../simulation/ecs.js';
import { Age, Lifespan, OnPlanet, Position, Size, Species } from '../simulation/components.js';
import { Rng } from '../simulation/rng.js';
import { SURFACE_HALF_HEIGHT, SURFACE_HALF_WIDTH } from '../scenario.js';

export interface SurfaceTransform {
  toX(sx: number): number;
  toY(sy: number): number;
  /** Pixels par unité de surface : dimensionne les sprites. */
  scale: number;
}

interface TerrainBlotch {
  x: number;
  y: number;
  r: number;
  color: string;
}

/** Taches de terrain pré-calculées par planète (déterministes via seed = id
 *  de la planète) : le sol est varié mais identique d'une frame à l'autre. */
const terrainCache = new Map<EntityId, TerrainBlotch[]>();

function terrainFor(planet: EntityId): TerrainBlotch[] {
  let blotches = terrainCache.get(planet);
  if (blotches) return blotches;
  const rng = new Rng(planet * 7919 + 13);
  blotches = [];
  const palette = ['#6da55c', '#79b065', '#639a54', '#86b877', '#5d9150'];
  for (let i = 0; i < 90; i++) {
    blotches.push({
      x: rng.range(-SURFACE_HALF_WIDTH, SURFACE_HALF_WIDTH),
      y: rng.range(-SURFACE_HALF_HEIGHT, SURFACE_HALF_HEIGHT),
      r: rng.range(15, 70),
      color: palette[rng.int(0, palette.length - 1)] as string,
    });
  }
  return terrainCache.set(planet, blotches), blotches;
}

export function drawSurface(
  ctx: CanvasRenderingContext2D,
  world: World,
  planet: EntityId,
  t: SurfaceTransform,
  selected: EntityId | null,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;

  // --- Sol ---
  const left = t.toX(-SURFACE_HALF_WIDTH);
  const top = t.toY(-SURFACE_HALF_HEIGHT);
  const w = SURFACE_HALF_WIDTH * 2 * t.scale;
  const h = SURFACE_HALF_HEIGHT * 2 * t.scale;
  ctx.fillStyle = '#71aa60';
  ctx.fillRect(left, top, w, h);
  for (const b of terrainFor(planet)) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.ellipse(t.toX(b.x), t.toY(b.y), b.r * t.scale, b.r * t.scale * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Eau (lacs) : sous les sprites, au-dessus du sol ---
  for (const [entity, species] of world.query(Species)) {
    if (species.kind !== 'lake') continue;
    if (world.get(entity, OnPlanet)?.planet !== planet) continue;
    const pos = world.get(entity, Position);
    const size = world.get(entity, Size);
    if (!pos || !size) continue;
    const r = size.size * t.scale;
    const g = ctx.createRadialGradient(t.toX(pos.x), t.toY(pos.y), r * 0.2, t.toX(pos.x), t.toY(pos.y), r);
    g.addColorStop(0, '#3d7fc4');
    g.addColorStop(0.85, '#4b90d6');
    g.addColorStop(1, '#71aa6000');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(t.toX(pos.x), t.toY(pos.y), r, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Sprites, triés par Y : plus bas à l'écran == plus proche == dessiné après ---
  const sprites: { y: number; draw: () => void }[] = [];
  for (const [entity, species] of world.query(Species)) {
    if (world.get(entity, OnPlanet)?.planet !== planet) continue;
    const pos = world.get(entity, Position);
    if (!pos) continue;
    if (species.kind === 'tree') {
      sprites.push({ y: pos.y, draw: () => drawTree(ctx, world, entity, pos.x, pos.y, t, entity === selected) });
    } else if (species.kind === 'person') {
      sprites.push({ y: pos.y, draw: () => drawPerson(ctx, world, entity, pos.x, pos.y, t, entity === selected) });
    }
  }
  sprites.sort((a, b) => a.y - b.y);
  for (const s of sprites) s.draw();

  ctx.restore();
}

function drawShadow(ctx: CanvasRenderingContext2D, px: number, py: number, r: number): void {
  ctx.fillStyle = 'rgba(20, 40, 20, 0.30)';
  ctx.beginPath();
  ctx.ellipse(px, py, r, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSelectionRing(ctx: CanvasRenderingContext2D, px: number, py: number, r: number): void {
  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.beginPath();
  ctx.ellipse(px, py, r, r * 0.38, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  world: World,
  entity: EntityId,
  sx: number,
  sy: number,
  t: SurfaceTransform,
  isSelected: boolean,
): void {
  const size = world.get(entity, Size)?.size ?? 1;
  const px = t.toX(sx);
  const py = t.toY(sy);
  const height = size * 28 * t.scale; // Size (0.1 → 4) pilote la hauteur : la pousse est VISIBLE
  const canopy = height * 0.42;
  drawShadow(ctx, px, py, canopy * 0.9 + 1);
  if (isSelected) drawSelectionRing(ctx, px, py, canopy * 0.9 + 3);
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(px - height * 0.05, py - height * 0.55, height * 0.1, height * 0.55);
  ctx.fillStyle = '#3e7d3a';
  ctx.beginPath();
  ctx.arc(px, py - height * 0.72, canopy, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4f9448';
  ctx.beginPath();
  ctx.arc(px - canopy * 0.35, py - height * 0.62, canopy * 0.72, 0, Math.PI * 2);
  ctx.fill();
}

function drawPerson(
  ctx: CanvasRenderingContext2D,
  world: World,
  entity: EntityId,
  sx: number,
  sy: number,
  t: SurfaceTransform,
  isSelected: boolean,
): void {
  const size = world.get(entity, Size)?.size ?? 1;
  const px = t.toX(sx);
  const py = t.toY(sy);
  const height = size * 20 * t.scale;
  // Le vieillissement se VOIT : les cheveux blanchissent avec le ratio âge/vie.
  const age = world.get(entity, Age)?.ticks ?? 0;
  const lifespan = world.get(entity, Lifespan)?.max ?? 1;
  const oldness = Math.min(1, age / lifespan);
  drawShadow(ctx, px, py, height * 0.35 + 1);
  if (isSelected) drawSelectionRing(ctx, px, py, height * 0.35 + 3);
  ctx.fillStyle = '#b5651d';
  const bw = height * 0.42;
  ctx.beginPath();
  ctx.roundRect(px - bw / 2, py - height * 0.75, bw, height * 0.75, bw / 2);
  ctx.fill();
  const grey = Math.round(120 + oldness * 135);
  ctx.fillStyle = oldness > 0.6 ? `rgb(${grey},${grey},${grey})` : '#2e2118';
  ctx.beginPath();
  ctx.arc(px, py - height * 0.85, height * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c39e';
  ctx.beginPath();
  ctx.arc(px, py - height * 0.8, height * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

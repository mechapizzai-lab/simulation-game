/**
 * Rendu multi-échelle : espace, système stellaire et surfaces de planètes
 * dans un MÊME espace de coordonnées (unités univers). Le zoom continu marche
 * parce que la surface d'une planète est littéralement dessinée SUR la planète,
 * à une échelle telle qu'elle ne devient lisible qu'en zoomant.
 *
 * LOD par fondu : entre SURFACE_FADE_START et SURFACE_FADE_END, le disque
 * planétaire s'estompe pendant que la surface apparaît — pas d'écran de
 * chargement, juste deux couches en cross-fade. Sous Godot : deux scènes
 * superposées dont on anime l'alpha selon la distance caméra, même logique.
 */
import type { EntityId, World } from '../simulation/ecs.js';
import {
  Chemistry,
  Crater,
  Habitable,
  Hazard,
  Igniting,
  OnPlanet,
  Orbit,
  Position,
  Size,
  Species,
  Temperature,
} from '../simulation/components.js';
import { Rng } from '../simulation/rng.js';
import { Camera } from './camera.js';
import { drawSurface, type SurfaceTransform } from './surface.js';

/** 1 unité de surface == 0.02 unité univers : la carte de 1200×800 su couvre
 *  24×16 u, un peu plus large que le disque de Gaïa (rayon 8 u). */
export const SURFACE_TO_UNIVERSE = 0.02;
const SURFACE_FADE_START = 8;
const SURFACE_FADE_END = 30;

/** La couleur d'une planète RACONTE son état : incandescente → refroidie →
 *  enrichie par la chimie → habitable. Le joueur lit l'émergence sans HUD. */
function planetColor(world: World, e: EntityId): string {
  if (world.has(e, Habitable)) return '#4a9d6f';
  const chem = world.get(e, Chemistry);
  if (chem && chem.richness > 0.05) return '#a1793f';
  const t = world.get(e, Temperature)?.current ?? 0;
  if (t > 600) return '#e2603a';
  if (t > 300) return '#9a6f52';
  return '#7d8896';
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}

export class Renderer {
  /** Étoiles de fond en espace écran (déco pure, pas des entités). */
  private stars: Star[] = [];

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly canvas: HTMLCanvasElement,
  ) {
    const rng = new Rng(7);
    for (let i = 0; i < 220; i++) {
      this.stars.push({ x: rng.next(), y: rng.next(), r: rng.range(0.4, 1.6), a: rng.range(0.2, 0.9) });
    }
  }

  /** Alpha de la couche surface pour le zoom courant (0 = invisible). */
  surfaceAlpha(zoom: number): number {
    return Math.min(1, Math.max(0, (zoom - SURFACE_FADE_START) / (SURFACE_FADE_END - SURFACE_FADE_START)));
  }

  render(
    world: World,
    camera: Camera,
    surfacePlanets: EntityId[],
    selected: EntityId | null,
    spaceExists: boolean,
  ): void {
    const { ctx, canvas } = this;
    const sAlpha = this.surfaceAlpha(camera.zoom);
    const universeAlpha = 1 - sAlpha;

    // --- Fond ---
    ctx.fillStyle = spaceExists ? '#05070d' : '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!spaceExists) {
      // Le Vide absolu : pas d'étendue, pas de fond stellaire — rien.
      ctx.fillStyle = 'rgba(140, 150, 173, 0.45)';
      ctx.font = `${16 * devicePixelRatio}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('LE VIDE', canvas.width / 2, canvas.height / 2 - 12 * devicePixelRatio);
      ctx.fillStyle = 'rgba(140, 150, 173, 0.28)';
      ctx.font = `${12 * devicePixelRatio}px system-ui`;
      ctx.fillText(
        'rien n\'existe encore — codez une règle dans le panneau de gauche',
        canvas.width / 2,
        canvas.height / 2 + 12 * devicePixelRatio,
      );
      return;
    }
    // Les étoiles restent visibles à tout zoom : la surface les recouvre de
    // toute façon, et autour du disque on voit l'espace — on est sur une planète.
    ctx.save();
    for (const s of this.stars) {
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#cfd8ea';
      ctx.beginPath();
      ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (universeAlpha > 0) this.renderUniverse(world, camera, universeAlpha, selected);

    // --- Surfaces : dessinées sur leur planète, clippées à un disque qui
    // déborde du disque planétaire (l'"atmosphère" qu'on traverse en zoomant).
    if (sAlpha > 0) {
      for (const planet of surfacePlanets) {
        const pos = world.get(planet, Position);
        const size = world.get(planet, Size);
        if (!pos || !size) continue;
        const px = camera.screenX(pos.x);
        const py = camera.screenY(pos.y);
        // Clip au disque (léger débord) : pendant la transition, le sol
        // apparaît À TRAVERS le globe, pas comme un rectangle posé dessus.
        const clipR = size.size * 1.05 * camera.zoom;
        // Hors champ (avec marge) : inutile de dessiner la surface.
        const margin = clipR + 50;
        if (px < -margin || px > canvas.width + margin || py < -margin || py > canvas.height + margin) continue;

        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, clipR, 0, Math.PI * 2);
        ctx.clip();
        const t: SurfaceTransform = {
          toX: (sx) => camera.screenX(pos.x + sx * SURFACE_TO_UNIVERSE),
          toY: (sy) => camera.screenY(pos.y + sy * SURFACE_TO_UNIVERSE),
          scale: camera.zoom * SURFACE_TO_UNIVERSE,
        };
        drawSurface(ctx, world, planet, t, selected, sAlpha);
        ctx.restore();
      }
    }
  }

  private renderUniverse(world: World, camera: Camera, alpha: number, selected: EntityId | null): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;

    // Anneaux d'orbite : repères de lecture de la vue système.
    for (const [, orbit] of world.query(Orbit)) {
      const centerPos = orbit.center !== 0 ? world.get(orbit.center, Position) : undefined;
      ctx.strokeStyle = 'rgba(140, 160, 200, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(
        camera.screenX(centerPos?.x ?? 0),
        camera.screenY(centerPos?.y ?? 0),
        orbit.radius * camera.zoom,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }

    for (const [entity, species] of world.query(Species)) {
      const pos = world.get(entity, Position);
      const size = world.get(entity, Size);
      if (!pos || !size) continue;
      const px = camera.screenX(pos.x);
      const py = camera.screenY(pos.y);
      const r = size.size * camera.zoom;

      if (species.kind === 'asteroid') {
        // La menace se VOIT venir : trajectoire pointillée vers la cible et
        // compte à rebours — le joueur doit sentir l'échéance, pas la subir.
        const hz = world.get(entity, Hazard);
        const targetPos = hz ? world.get(hz.target, Position) : undefined;
        if (targetPos) {
          ctx.strokeStyle = 'rgba(255, 120, 70, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([7, 7]);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(camera.screenX(targetPos.x), camera.screenY(targetPos.y));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = '#c9b8a6';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2.5, r), 0, Math.PI * 2);
        ctx.fill();
        if (hz) {
          ctx.fillStyle = 'rgba(255, 150, 90, 0.9)';
          ctx.font = `${11 * devicePixelRatio}px system-ui`;
          ctx.textAlign = 'left';
          ctx.fillText(`☄ −${Math.max(0, hz.impactTick - world.tick)}`, px + 8, py - 8);
        }
        if (entity === selected) {
          ctx.strokeStyle = '#ffd75e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(4, r) + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (species.kind === 'particle') {
        // Poussière primordiale : de simples points, mais on les VOIT condenser.
        ctx.fillStyle = 'rgba(190, 205, 235, 0.85)';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1, r * 0.6), 0, Math.PI * 2);
        ctx.fill();
      } else if (species.kind === 'clump') {
        ctx.fillStyle = '#6b6257';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.5, r), 0, Math.PI * 2);
        ctx.fill();
        // Destin d'allumage écrit : l'amas rougeoie de plus en plus fort à
        // l'approche de son tick — le futur est visible avant d'arriver.
        const igniting = world.get(entity, Igniting);
        if (igniting && world.tick < igniting.atTick) {
          const pulse = 0.35 + 0.3 * Math.sin(performance.now() / 120);
          ctx.strokeStyle = `rgba(255, 150, 60, ${pulse})`;
          ctx.lineWidth = Math.max(1.5, r * 0.25);
          ctx.beginPath();
          ctx.arc(px, py, Math.max(3, r * 1.3), 0, Math.PI * 2);
          ctx.stroke();
        }
        if (entity === selected) {
          ctx.strokeStyle = '#ffd75e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(4, r) + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (species.kind === 'star') {
        const glow = ctx.createRadialGradient(px, py, r * 0.3, px, py, r * 3);
        glow.addColorStop(0, 'rgba(255, 220, 130, 0.9)');
        glow.addColorStop(1, 'rgba(255, 220, 130, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (species.kind === 'planet') {
        ctx.fillStyle = planetColor(world, entity);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        // L'échec laisse une trace : la cicatrice d'impact reste visible.
        if (world.has(entity, Crater)) {
          ctx.fillStyle = 'rgba(30, 22, 18, 0.55)';
          ctx.beginPath();
          ctx.arc(px - r * 0.3, py - r * 0.25, r * 0.38, 0, Math.PI * 2);
          ctx.fill();
        }
        // Terminateur jour/nuit sommaire : vend l'idée "corps 3D éclairé".
        ctx.fillStyle = 'rgba(5, 7, 13, 0.35)';
        ctx.beginPath();
        ctx.arc(px + r * 0.35, py + r * 0.2, r, 0, Math.PI * 2);
        ctx.save();
        ctx.clip();
        ctx.fill();
        ctx.restore();
        if (entity === selected) {
          ctx.strokeStyle = '#ffd75e';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Étiquette lisible seulement en vue système (disparaît en zoomant).
        if (camera.zoom < 4) {
          ctx.fillStyle = 'rgba(220, 227, 240, 0.75)';
          ctx.font = '12px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(species.label, px, py - r - 8);
        }
      }
    }
    ctx.restore();
  }

  /**
   * Sélection au clic : entités de surface d'abord (si la surface est
   * visible), sinon corps célestes. Rayon de tolérance en PIXELS constant,
   * donc convivial à tous les niveaux de zoom.
   */
  pick(world: World, camera: Camera, px: number, py: number, surfacePlanets: EntityId[]): EntityId | null {
    const tolerance = 18;
    if (this.surfaceAlpha(camera.zoom) > 0.5) {
      let best: EntityId | null = null;
      let bestDist = tolerance * tolerance;
      for (const planet of surfacePlanets) {
        const planetPos = world.get(planet, Position);
        if (!planetPos) continue;
        for (const [entity] of world.query(OnPlanet)) {
          if (world.get(entity, OnPlanet)?.planet !== planet) continue;
          const pos = world.get(entity, Position);
          if (!pos) continue;
          const ex = camera.screenX(planetPos.x + pos.x * SURFACE_TO_UNIVERSE);
          const ey = camera.screenY(planetPos.y + pos.y * SURFACE_TO_UNIVERSE);
          const d = (ex - px) ** 2 + (ey - py) ** 2;
          if (d < bestDist) {
            bestDist = d;
            best = entity;
          }
        }
      }
      return best;
    }
    let best: EntityId | null = null;
    let bestDist = Infinity;
    for (const [entity, species] of world.query(Species)) {
      // Tout corps céleste est inspectable — y compris un amas, dont la
      // timeline montre l'allumage à venir.
      if (!['planet', 'star', 'clump', 'particle', 'asteroid'].includes(species.kind)) continue;
      const pos = world.get(entity, Position);
      const size = world.get(entity, Size);
      if (!pos || !size) continue;
      const d = Math.hypot(camera.screenX(pos.x) - px, camera.screenY(pos.y) - py);
      if (d < Math.max(tolerance, size.size * camera.zoom) && d < bestDist) {
        bestDist = d;
        best = entity;
      }
    }
    // Cliquer l'astéroïde sélectionne sa CIBLE : c'est là que vit l'événement
    // d'impact qu'on veut lire/réécrire.
    if (best !== null) {
      const hz = world.get(best, Hazard);
      if (hz) return hz.target;
    }
    return best;
  }
}

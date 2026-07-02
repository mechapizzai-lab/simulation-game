/**
 * Caméra 2D multi-échelle : un centre en coordonnées UNIVERS et un zoom en
 * pixels par unité univers. Le zoom couvre ~3 ordres de grandeur (vue système
 * → sol d'une planète) de façon continue — pas de changement de scène.
 *
 * Deux idées clés :
 * 1. Zoom "vers le curseur" : le point du monde sous la souris reste fixe à
 *    l'écran pendant le zoom, ce qui permet de "plonger" vers une planète.
 * 2. Ancrage : au-delà d'un seuil de zoom, la caméra s'accroche à la planète
 *    la plus proche et suit son mouvement orbital — sinon, à fort zoom, la
 *    surface défilerait à toute vitesse sous la caméra.
 *
 * Portage Godot : Camera2D fournit pan/zoom natifs ; l'ancrage se fera en
 * re-parentant la caméra au noeud de la planète. La logique de seuils LOD
 * (voir renderer.ts) reste identique.
 */
import type { EntityId, World } from '../simulation/ecs.js';
import { Position } from '../simulation/components.js';

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 400;
/** Au-delà : la caméra s'ancre à une planète proche ; en deçà : elle se libère. */
export const ANCHOR_ZOOM = 4;
/** Fin de la bande d'assistance : au-delà, la caméra est libre sur la surface. */
const DIVE_ASSIST_END = 60;

export class Camera {
  x = 0;
  y = 0;
  zoom = 0.8;
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 0.8;

  anchor: EntityId | null = null;
  private lastAnchorX = 0;
  private lastAnchorY = 0;

  constructor(
    private readonly viewport: { width: number; height: number },
  ) {}

  screenX(wx: number): number {
    return this.viewport.width / 2 + (wx - this.x) * this.zoom;
  }

  screenY(wy: number): number {
    return this.viewport.height / 2 + (wy - this.y) * this.zoom;
  }

  worldX(px: number): number {
    return this.x + (px - this.viewport.width / 2) / this.zoom;
  }

  worldY(py: number): number {
    return this.y + (py - this.viewport.height / 2) / this.zoom;
  }

  panBy(dxPx: number, dyPx: number): void {
    this.targetX -= dxPx / this.zoom;
    this.targetY -= dyPx / this.zoom;
    // Pan direct (sans lissage) : une caméra qui "glisse" sous le doigt
    // pendant un drag donne une sensation de flottement désagréable.
    this.x = this.targetX;
    this.y = this.targetY;
  }

  /** Zoom multiplicatif centré sur un point écran (le point monde sous le
   *  curseur reste immobile à l'écran). */
  zoomAt(px: number, py: number, factor: number): void {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.targetZoom * factor));
    // Pendant la traversée ancrée (atmosphère), la molette ne fait QUE zoomer :
    // laisser le curseur dévier la visée ferait rater le corps sur lequel on
    // plonge — la molette et le suivi orbital se battraient pour la cible.
    if (this.anchor !== null && this.zoom < DIVE_ASSIST_END) {
      this.targetZoom = newZoom;
      return;
    }
    const wx = this.worldX(px);
    const wy = this.worldY(py);
    // Résout : screen(w, newZoom, newCenter) == (px, py)
    this.targetZoom = newZoom;
    this.targetX = wx - (px - this.viewport.width / 2) / newZoom;
    this.targetY = wy - (py - this.viewport.height / 2) / newZoom;
  }

  /**
   * À appeler chaque frame. Lisse le zoom (exponentiel vers la cible) et
   * applique le suivi d'ancrage : si la planète ancrée a bougé sur son orbite,
   * la caméra bouge d'autant — le sol paraît immobile.
   */
  update(dtSeconds: number, world: World, anchorCandidates: EntityId[]): void {
    // Suivi d'ancrage AVANT le lissage : le delta orbital est un déplacement
    // du référentiel, pas un mouvement de caméra à lisser.
    if (this.anchor !== null) {
      const pos = world.get(this.anchor, Position);
      if (pos) {
        const dx = pos.x - this.lastAnchorX;
        const dy = pos.y - this.lastAnchorY;
        this.x += dx;
        this.y += dy;
        this.targetX += dx;
        this.targetY += dy;
        this.lastAnchorX = pos.x;
        this.lastAnchorY = pos.y;
      }
    }

    // Assistance de plongée : pendant la traversée de l'atmosphère (bande de
    // zoom entre l'ancrage et la vue sol), la cible est attirée vers le centre
    // de la planète. Sans ça, viser un disque de 8 unités depuis la vue système
    // demanderait une précision au pixel — on veut un geste, pas un concours.
    if (this.anchor !== null && this.zoom < DIVE_ASSIST_END) {
      const pos = world.get(this.anchor, Position);
      if (pos) {
        const pull = 1 - Math.exp(-dtSeconds * 4);
        this.targetX += (pos.x - this.targetX) * pull;
        this.targetY += (pos.y - this.targetY) * pull;
      }
    }

    const k = 1 - Math.exp(-dtSeconds * 8); // lissage indépendant du framerate
    this.zoom += (this.targetZoom - this.zoom) * k;
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;

    // Gestion de l'ancrage selon le niveau de zoom.
    if (this.zoom >= ANCHOR_ZOOM && this.anchor === null) {
      let best: EntityId | null = null;
      // Ne s'ancrer qu'à un corps raisonnablement proche du centre de visée :
      // au-delà, le joueur zoome sur du vide et c'est son droit.
      let bestDist = 300 * 300;
      for (const candidate of anchorCandidates) {
        const pos = world.get(candidate, Position);
        if (!pos) continue;
        const d = (pos.x - this.x) ** 2 + (pos.y - this.y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = candidate;
        }
      }
      if (best !== null) {
        const pos = world.get(best, Position);
        if (pos) {
          this.anchor = best;
          this.lastAnchorX = pos.x;
          this.lastAnchorY = pos.y;
          // Plongée cinématique : la CIBLE saute sur le corps ancré (le lissage
          // fait glisser la caméra). Sans ce recalage, zoomer plus vite que
          // l'assistance laisse un décalage résiduel : à zoom 177, 30 unités
          // d'écart == 5 000 px hors-champ, écran vide (vécu).
          this.targetX = pos.x;
          this.targetY = pos.y;
        }
      }
    } else if (this.zoom < ANCHOR_ZOOM && this.anchor !== null) {
      this.anchor = null;
    }
  }
}

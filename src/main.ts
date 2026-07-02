/**
 * Point d'entrée : câble simulation ↔ rendu ↔ UI.
 * Étape 3 : vue fixe sur la surface de Gaïa — les entités bougent, grandissent
 * et vieillissent visiblement au rythme des ticks.
 */
import { buildScenario, SURFACE_HALF_HEIGHT, SURFACE_HALF_WIDTH } from './scenario.js';
import { SimulationClock } from './simulation/loop.js';
import { drawSurface, type SurfaceTransform } from './rendering/surface.js';
import { Hud } from './ui/hud.js';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

const scenario = buildScenario();
const clock = new SimulationClock(scenario.world);
const hud = new Hud(document.getElementById('hud') as HTMLElement, clock, scenario.world);

function resize(): void {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
}
window.addEventListener('resize', resize);
resize();

/** Vue fixe : la carte de surface remplit l'écran (remplacée par la caméra
 *  multi-échelle à l'étape 4). */
function fixedTransform(): SurfaceTransform {
  const scale =
    Math.min(canvas.width / (SURFACE_HALF_WIDTH * 2), canvas.height / (SURFACE_HALF_HEIGHT * 2)) * 0.92;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return { toX: (sx) => cx + sx * scale, toY: (sy) => cy + sy * scale, scale };
}

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastTime) / 1000); // clamp : onglet inactif
  lastTime = now;
  clock.advance(dt);

  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawSurface(ctx, scenario.world, scenario.gaia, fixedTransform(), null);
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

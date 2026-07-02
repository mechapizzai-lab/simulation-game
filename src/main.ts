/**
 * Point d'entrée : câble simulation ↔ rendu ↔ UI.
 * Étape 4 : caméra multi-échelle — de la vue système au sol de Gaïa, au zoom
 * molette, sans changement de scène.
 */
import { buildScenario } from './scenario.js';
import { SimulationClock } from './simulation/loop.js';
import { Camera } from './rendering/camera.js';
import { Renderer } from './rendering/renderer.js';
import { bindInput } from './rendering/input.js';
import { Hud } from './ui/hud.js';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

const scenario = buildScenario();
const clock = new SimulationClock(scenario.world);
const hud = new Hud(document.getElementById('hud') as HTMLElement, clock, scenario.world);

const viewport = { width: 0, height: 0 };
function resize(): void {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  viewport.width = canvas.width;
  viewport.height = canvas.height;
}
window.addEventListener('resize', resize);
resize();

const camera = new Camera(viewport);
const renderer = new Renderer(ctx, canvas);
/** Seule Gaïa porte de la vie pour l'instant ; la liste est prête pour plus. */
const surfacePlanets = [scenario.gaia];

bindInput(canvas, camera, (px, py) => {
  const hit = renderer.pick(scenario.world, camera, px, py, surfacePlanets);
  // La sélection alimente le panneau divin (étape 5).
  selected = hit;
});
let selected: number | null = null;

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastTime) / 1000); // clamp : onglet inactif
  lastTime = now;
  clock.advance(dt);
  camera.update(dt, scenario.world, surfacePlanets);

  renderer.render(scenario.world, camera, surfacePlanets, selected);
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

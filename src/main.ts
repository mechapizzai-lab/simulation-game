/**
 * Point d'entrée : câble simulation ↔ règles ↔ rendu ↔ UI.
 * Le jeu démarre sur le VIDE : aucune entité, aucune règle active, temps
 * figé. Tout ce qui apparaîtra à l'écran aura été codé par le joueur.
 */
import { buildVoidScenario } from './scenario.js';
import { SimulationClock } from './simulation/loop.js';
import { RULE_SPACE, RULE_TIME } from './simulation/cosmos.js';
import { Habitable, Species } from './simulation/components.js';
import { Camera } from './rendering/camera.js';
import { Renderer } from './rendering/renderer.js';
import { bindInput } from './rendering/input.js';
import { Hud } from './ui/hud.js';
import { GodPanel } from './ui/panel.js';
import { RulesPanel } from './ui/rulesPanel.js';
import { Terminal } from './ui/terminal.js';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

// La seed vient de l'URL (?seed=N) pour être partageable ; sinon on en tire
// une au hasard — chaque partie est une donne différente.
const urlSeed = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isFinite(urlSeed) && urlSeed > 0 ? Math.floor(urlSeed) : Math.floor(Math.random() * 1_000_000);

const scenario = buildVoidScenario(seed);
const { world, fate, engine } = scenario;
const clock = new SimulationClock(world);
const hud = new Hud(
  document.getElementById('hud') as HTMLElement,
  clock,
  world,
  () => engine.isActive(RULE_TIME),
);
const rulesPanel = new RulesPanel(
  document.getElementById('rules') as HTMLElement,
  engine,
  world,
  seed,
  scenario.temperament,
  () => {
    location.search = `?seed=${Math.floor(Math.random() * 1_000_000)}`;
  },
);
const godPanel = new GodPanel(document.getElementById('panel') as HTMLElement, world, fate, engine);
// Le terminal divin : le joueur ÉCRIT ce qui doit arriver ; le compilateur
// traduit en actes payants ; la simulation décide des conséquences.
new Terminal(document.getElementById('terminal') as HTMLElement, {
  world,
  engine,
  fate,
  rng: scenario.rng,
  temperament: scenario.temperament,
  setSpeed: (s) => {
    clock.speed = s;
  },
});

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

/** Les surfaces n'existent que sur les mondes habitables — recalculé chaque
 *  frame car l'habitabilité ÉMERGE en cours de partie. */
function habitablePlanets(): number[] {
  return [...world.query(Habitable)].map(([e]) => e);
}

/** Corps auxquels la caméra peut s'ancrer à fort zoom. */
function anchorCandidates(): number[] {
  const out: number[] = [];
  for (const [e, s] of world.query(Species)) {
    if (s.kind === 'planet' || s.kind === 'star') out.push(e);
  }
  return out;
}

bindInput(canvas, camera, (px, py) => {
  godPanel.select(renderer.pick(world, camera, px, py, habitablePlanets()));
});

// Hook d'inspection pour les tests pilotés (Playwright) : lire l'état de la
// caméra et du moteur sans passer par les pixels. Aucune logique n'en dépend.
Object.assign(window as unknown as Record<string, unknown>, {
  __sim: { camera, world, engine, fate, seed, temperament: scenario.temperament },
});

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.25, (now - lastTime) / 1000); // clamp : onglet inactif
  lastTime = now;
  // La règle Temps gate le PILOTE, pas World.step : la logique d'un tick reste
  // pure et testable ; simplement, personne ne demande de tick sans Temps.
  if (engine.isActive(RULE_TIME)) clock.advance(dt);
  camera.update(dt, world, anchorCandidates());

  renderer.render(world, camera, habitablePlanets(), godPanel.selected, engine.isActive(RULE_SPACE));
  hud.update();
  rulesPanel.update();
  godPanel.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

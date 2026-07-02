/**
 * Entrées souris/trackpad : drag = pan, molette = zoom vers le curseur,
 * clic (sans drag) = sélection. Séparé du renderer pour que ni l'un ni
 * l'autre ne connaisse l'existence de l'autre.
 */
import { Camera } from './camera.js';

const ZOOM_SENSITIVITY = 0.0015;
/** En deçà de ce déplacement cumulé (px), un press-release compte comme un clic. */
const CLICK_SLOP = 5;

export function bindInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  onClick: (px: number, py: number) => void,
): void {
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;

  // Les coordonnées pointeur sont en pixels CSS ; le canvas est en pixels
  // physiques (devicePixelRatio) — on convertit à l'entrée, une seule fois.
  const scale = (): number => devicePixelRatio;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    camera.panBy(dx * scale(), dy * scale());
    lastX = e.clientX;
    lastY = e.clientY;
  });

  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    canvas.classList.remove('dragging');
    if (moved < CLICK_SLOP) onClick(e.clientX * scale(), e.clientY * scale());
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
      camera.zoomAt(e.clientX * scale(), e.clientY * scale(), factor);
    },
    { passive: false },
  );
}

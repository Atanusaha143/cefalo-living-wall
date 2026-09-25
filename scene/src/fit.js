import { WALL_W, WALL_H } from './wall.js';

// Which part of the wall a viewport shows. Like CSS object-fit: cover, except that a
// wide screen crops mostly from the bottom (anchorY), so the ceiling downlights stay
// clear of the menu bar on 16:9 displays.
export function coverFit(viewW, viewH, anchorY = 0.1) {
  const aspect = viewW / viewH;
  let w = WALL_W, h = WALL_H;
  if (aspect > WALL_W / WALL_H) h = WALL_W / aspect;
  else w = WALL_H * aspect;
  return { x0: (WALL_W - w) / 2, y0: (WALL_H - h) * anchorY, w, h };
}

/** A viewport point (CSS px from the top-left) in wall units. */
export function toWall(fit, px, py, viewW, viewH) {
  return { x: fit.x0 + (px / viewW) * fit.w, y: fit.y0 + (py / viewH) * fit.h };
}

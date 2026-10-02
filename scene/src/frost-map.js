import { WALL_W, WALL_H, WALL_TOP, WALL_BOTTOM } from './wall.js';
import { LOGO_AREA, FREEDOM, smoothstep } from './logo-mask.js';

// Where snow settles on the photo's leaves, worked out once from the photo: most on a leaf's
// upper edge (a lit leaf just below a dark gap) and some on its lit face; none in the gaps,
// less under the canopy's edge, and none close to the letters, so CEFALO keeps its dark
// surround. Pure; photo-layer.js draws the frost from it.
export const FROST = {
  above: [1, 3],         // px above (2–6 wall units at 800 px wide) that must be darker for an edge
  face: 0.35,            // how much a lit face catches, next to an edge's 1
  gain: 2.7,             // the blurred edges peak near 0.37 on the photo: this brings them to 1
  shelter: [WALL_TOP + 20, WALL_TOP + 160],   // wall y where the canopy's shelter ends
};

/** How much of a pixel is leaf, green or yellow-green (0..1): foliage has little blue, the
 *  letters, the pebbles and the ceiling have much more. */
export function leafiness(r, g, b) {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return smoothstep(0.9, 1.0, g / Math.max(1, r)) * smoothstep(1.15, 1.4, g / Math.max(1, b)) * smoothstep(30, 70, luma);
}

/**
 * How well each pixel catches snow (0..1). rgba: the photo drawn small (ImageData-like, over the
 * whole wall); letters: the letter distances over LOGO_AREA, one per wall unit ({ data, width,
 * height }, logo-mask.js's letterDistance), or null for none. Returns { data, width, height }.
 */
export function frostMap(rgba, width, height, letters = null) {
  const n = width * height, leaf = new Float32Array(n), raw = new Float32Array(n), across = new Float32Array(n);
  for (let i = 0; i < n; i++) leaf[i] = leafiness(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  for (let i = 0; i < n; i++) {
    const y = Math.floor(i / width);
    let above = 0;
    for (let d = FROST.above[0]; d <= Math.min(FROST.above[1], y); d++) above = Math.max(above, leaf[i - d * width]);
    const bright = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    raw[i] = Math.max(leaf[i] - above, FROST.face * leaf[i] * bright);
  }
  // A 3×3 box blur, in two passes (along rows, then columns).
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, l = x > 0 ? raw[i - 1] : raw[i], r = x < width - 1 ? raw[i + 1] : raw[i];
    across[i] = (l + raw[i] + r) / 3;
  }
  const data = new Float32Array(n), unitsPerRow = WALL_H / height, unitsPerCol = WALL_W / width;
  for (let y = 0; y < height; y++) {
    const wy = (y + 0.5) * unitsPerRow;
    const row = wy >= WALL_TOP && wy <= WALL_BOTTOM ? FROST.gain * smoothstep(FROST.shelter[0], FROST.shelter[1], wy) : 0;
    if (row === 0) continue;
    const up = y > 0 ? -width : 0, down = y < height - 1 ? width : 0;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      data[i] = Math.min(1, row * ((across[i + up] + across[i] + across[i + down]) / 3));
    }
  }
  if (letters) {
    // Close to the letters, eased in as the wind is (logo-mask.js's FREEDOM).
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const lx = Math.floor((x + 0.5) * unitsPerCol - LOGO_AREA.x0), ly = Math.floor((y + 0.5) * unitsPerRow - LOGO_AREA.y0);
      if (lx < 0 || ly < 0 || lx >= letters.width || ly >= letters.height) continue;
      data[y * width + x] *= smoothstep(FREEDOM.from, FREEDOM.to, letters.data[ly * letters.width + lx]);
    }
  }
  return { data, width, height };
}

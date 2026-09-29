import * as THREE from '../vendor/three.module.js';
import { LOGO_BOX } from './wall.js';

// Near the letters, the logo's glow and the wind both follow the letters as the photo has them,
// read once at load into textures over this area: the logo box and 50 units round it.
export const LOGO_AREA = {
  x0: LOGO_BOX.x0 - 50, y0: LOGO_BOX.y0 - 50, width: LOGO_BOX.x1 - LOGO_BOX.x0 + 100, height: LOGO_BOX.y1 - LOGO_BOX.y0 + 100,
};
/** Near the letters the wind eases in: none this close (units), full from `to` on. */
export const FREEDOM = { from: 6, to: 30 };

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const smoothstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/** How much of each pixel is letter, as the shaders' letterAt reads the photo (linear blue from
 *  0.70 to 0.80). rgba: the photo over an area, one pixel per wall unit. */
export function letterMask(rgba, width, height) {
  const mask = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = smoothstep(0.7, 0.8, linear(rgba[i * 4 + 2] / 255));
  return mask;
}

/** Wall units from each pixel to the nearest letter pixel (more than half letter), measured
 *  in steps to the 8 neighbours (1 and √2). */
export function letterDistance(mask, width, height) {
  const d = new Float32Array(width * height).map((_, i) => (mask[i] > 0.5 ? 0 : 1e9));
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 1e9 : d[y * width + x]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + Math.SQRT2, at(x + 1, y - 1) + Math.SQRT2);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + Math.SQRT2, at(x - 1, y + 1) + Math.SQRT2);
  }
  return d;
}

/**
 * How freely the wind may move the photo at each pixel: still on the letters and just round
 * them, easing in to full from FREEDOM.from to FREEDOM.to units away, so no seam runs round
 * the letters and a moved pixel never reaches into one (it used to switch from still to full
 * within a unit, 7 units out, and the wind could carry the letters' white out past that).
 */
export function swayFreedom(rgba, width, height) {
  return letterDistance(letterMask(rgba, width, height), width, height).map((d) => smoothstep(FREEDOM.from, FREEDOM.to, d));
}

/** Values 0..1 over an area as a texture (red channel); `empty` everywhere without them. */
export function areaTexture(values, empty) {
  const { data, width, height } = values ?? { data: [empty], width: 1, height: 1 };
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) bytes[i * 4] = Math.round(Math.min(1, Math.max(0, data[i])) * 255);
  const tex = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

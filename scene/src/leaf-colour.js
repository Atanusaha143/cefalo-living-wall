// A front leaf's colour, taken from the photo around its midpoint so it blends in.
// `pixels` is ImageData-like ({ data, width, height }) of the photo scaled down;
// (x, y) are wall units. Returns sRGB bytes [r, g, b].
export const FALLBACK = [0x34, 0x5c, 0x24];

export function leafColour(pixels, x, y, wallW, wallH, random, dim = 1) {
  const sx = Math.round((x / wallW) * pixels.width), sy = Math.round((y / wallH) * pixels.height);
  const patch = [];
  for (let j = -3; j <= 3; j++) {
    for (let i = -3; i <= 3; i++) {
      const px = Math.min(pixels.width - 1, Math.max(0, sx + i));
      const py = Math.min(pixels.height - 1, Math.max(0, sy + j));
      const o = (py * pixels.width + px) * 4;
      patch.push([pixels.data[o], pixels.data[o + 1], pixels.data[o + 2]]);
    }
  }
  const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
  patch.sort((a, b) => lum(a) - lum(b));
  let rgb = patch[Math.floor(patch.length * 0.68)];
  if (rgb[2] > 150 || lum(rgb) < 38) rgb = FALLBACK; // logo/pebble white, or a dark gap
  const k = random.range(0.9, 1.1) * dim;
  return rgb.map((c) => Math.min(255, Math.round(c * k)));
}

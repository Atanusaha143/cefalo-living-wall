import test from 'node:test';
import assert from 'node:assert/strict';
import { frostMap, leafiness, FROST } from '../scene/src/frost-map.js';
import { LOGO_AREA } from '../scene/src/logo-mask.js';
import { WALL_TOP, WALL_BOTTOM } from '../scene/src/wall.js';

// The photo as main.js draws it for the map: 800 px wide, two wall units per pixel.
const W = 800, H = 534, GAP = [10, 14, 8], LEAF = [70, 140, 40];
/** An image painted per wall point: paint(x, y) → [r, g, b]. */
function image(paint) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...paint(x * 2 + 1, y * 2 + 1), 255], (y * W + x) * 4);
  return data;
}
/** A lit leaf over wall x 200–400 and the given y span, in a dark gap everywhere else. */
const leafAt = (y0, y1, x0 = 200, x1 = 400) => (x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? LEAF : GAP);
const at = (map, x, y) => map.data[Math.floor(y / 2) * W + Math.floor(x / 2)];

test('foliage is leaf, green or yellow-green; the letters, the pebbles and the dark gaps are not', () => {
  assert.ok(leafiness(...LEAF) > 0.99, 'a green leaf');
  assert.ok(leafiness(190, 200, 80) > 0.99, 'a yellow-green leaf');
  assert.equal(leafiness(240, 240, 238), 0, 'a white letter');
  assert.equal(leafiness(120, 120, 115), 0, 'a grey pebble');
  assert.equal(leafiness(...GAP), 0, 'a dark gap');
});

test('a lit leaf below a dark gap catches the most snow along its upper edge', () => {
  const map = frostMap(image(leafAt(500, 560)), W, H);
  const top = at(map, 300, 501), inside = at(map, 300, 530), bottom = at(map, 300, 557);
  assert.ok(top > 0.8, `upper edge ${top}`);
  assert.ok(top > 2 * inside && top > 2 * bottom, `edge ${top}, face ${inside}, lower edge ${bottom}`);
  assert.ok(inside > 0.1, `its lit face catches a little: ${inside}`);
  assert.equal(at(map, 300, 700), 0, 'the dark gaps catch nothing');
  assert.ok(map.data.every((v) => v >= 0 && v <= 1), 'every value is 0..1');
});

test("less settles just under the canopy's edge, and none off the wall", () => {
  // Rows of leaves 30 units tall, their upper edges at y = 100 (the shelter's start), 160, … 580, …
  const map = frostMap(image((x, y) => ((y - FROST.shelter[0] + 600) % 60 < 30 ? LEAF : GAP)), W, H);
  const edgeAt = (wy) => Math.max(...[0, 2, 4].map((d) => at(map, 300, wy + d)));
  assert.ok(edgeAt(580) > 0.8, `an edge in the open: ${edgeAt(580)}`);
  assert.ok(edgeAt(FROST.shelter[0]) < 0.05 && edgeAt(FROST.shelter[0] + 60) < 0.7 * edgeAt(580),
    `sheltered: ${edgeAt(FROST.shelter[0])}, ${edgeAt(FROST.shelter[0] + 60)}`);
  assert.equal(at(map, 300, WALL_TOP - 20), 0, 'the ceiling');
  assert.equal(at(map, 300, WALL_BOTTOM + 20), 0, 'the pebbles (the photo shader snows on them itself)');
});

test('nothing settles close to the letters; from 30 units away, as much as anywhere', () => {
  const size = LOGO_AREA.width * LOGO_AREA.height, cx = LOGO_AREA.x0 + 100, cy = LOGO_AREA.y0 + 20;
  const pixels = image(leafAt(cy, cy + 40, cx - 60, cx + 60));
  const near = frostMap(pixels, W, H, { data: new Float32Array(size).fill(3), width: LOGO_AREA.width, height: LOGO_AREA.height });
  const far = frostMap(pixels, W, H, { data: new Float32Array(size).fill(40), width: LOGO_AREA.width, height: LOGO_AREA.height });
  const none = frostMap(pixels, W, H);
  assert.equal(at(near, cx, cy + 1), 0, '3 units from a letter');
  assert.ok(at(far, cx, cy + 1) > 0.8 && at(far, cx, cy + 1) === at(none, cx, cy + 1), '40 units away');
});

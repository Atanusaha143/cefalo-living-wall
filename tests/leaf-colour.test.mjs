import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { leafColour, FALLBACK } from '../scene/src/leaf-colour.js';

const image = (rgb, width = 40, height = 27) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { data, width, height };
};

test('takes the colour of the photo around the leaf', () => {
  const [r, g, b] = leafColour(image([60, 110, 40]), 800, 500, 1600, 1067, createRandom(1));
  assert.ok(g > r && g > b && Math.abs(g - 110) <= 12);
});

test('white (logo) and near-black samples fall back to leaf green', () => {
  for (const rgb of [[250, 250, 250], [5, 8, 4]]) {
    const out = leafColour(image(rgb), 800, 500, 1600, 1067, createRandom(1));
    out.forEach((c, i) => assert.ok(Math.abs(c - FALLBACK[i]) <= FALLBACK[i] * 0.11 + 1));
  }
});

test('works at the photo edges', () => {
  assert.equal(leafColour(image([60, 110, 40]), 0, 0, 1600, 1067, createRandom(1)).length, 3);
  assert.equal(leafColour(image([60, 110, 40]), 1600, 1067, 1600, 1067, createRandom(1)).length, 3);
});

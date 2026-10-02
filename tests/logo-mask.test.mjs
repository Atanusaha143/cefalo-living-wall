import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGO_AREA, letterMask, letterDistance, swayFreedom, freedomOf, FREEDOM } from '../scene/src/logo-mask.js';
import { SWAY_REACH } from '../scene/src/photo-layer.js';
import { LOGO_BOX } from '../scene/src/wall.js';

// A letter's stroke, 20 units wide, white on dark foliage, one pixel per wall unit.
function strokeImage(width = 200, height = 60, from = 90, to = 110, blue = 245) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    rgba.set(x >= from && x < to ? [245, 245, blue, 255] : [30, 60, 25, 255], (y * width + x) * 4);
  }
  return rgba;
}
const row = (values, width, y) => Array.from(values.slice(y * width, (y + 1) * width));
const toStroke = (x) => (x < 90 ? 90 - x : x >= 110 ? x - 109 : 0);   // units to the nearest stroke pixel

test('the area round the logo reaches 50 units past the logo box on every side', () => {
  assert.deepEqual(LOGO_AREA, { x0: LOGO_BOX.x0 - 50, y0: LOGO_BOX.y0 - 50,
    width: LOGO_BOX.x1 - LOGO_BOX.x0 + 100, height: LOGO_BOX.y1 - LOGO_BOX.y0 + 100 });
});

test('letters are read as the shaders read them: linear blue above 0.7', () => {
  const white = row(letterMask(strokeImage(), 200, 60), 200, 30);
  assert.equal(white[100], 1);
  assert.equal(white[50], 0);
  const pale = letterMask(strokeImage(200, 60, 90, 110, 200), 200, 60);   // light grey: linear blue 0.58
  assert.equal(Math.max(...pale), 0);
});

test('the distance to the nearest letter, in wall units', () => {
  const d = letterDistance(letterMask(strokeImage(), 200, 60), 200, 60);
  const line = row(d, 200, 30);
  assert.equal(line[100], 0);
  for (const x of [80, 60, 120, 150]) assert.ok(Math.abs(line[x] - toStroke(x)) < 0.01, `x=${x}: ${line[x]}`);
});

test('the wind leaves the letters and their surroundings still, easing in from 6 to 30 units away', () => {
  const line = row(swayFreedom(strokeImage(), 200, 60), 200, 30);
  for (let x = 84; x <= 115; x++) assert.equal(line[x], 0, `x=${x} is within ${FREEDOM.from} units`);
  for (const x of [0, 59, 140, 199]) assert.equal(line[x], 1, `x=${x} is past ${FREEDOM.to} units`);
});

test('no seam round the letters: the freedom changes gently, never in a step', () => {
  const line = row(swayFreedom(strokeImage(), 200, 60), 200, 30);
  for (let x = 0; x < 199; x++) assert.ok(Math.abs(line[x + 1] - line[x]) < 0.1, `a step at ${x}: ${line[x]} -> ${line[x + 1]}`);
});

test('a moved pixel never reaches a letter, however hard the wind and the cursor push', () => {
  const line = row(swayFreedom(strokeImage(), 200, 60), 200, 30);
  for (let x = 0; x < 200; x++) {
    if (toStroke(x) === 0) continue;
    // It stays at least a unit clear of the letter, where the photo's filtering could still blend in its white.
    assert.ok(SWAY_REACH * line[x] <= Math.max(0, toStroke(x) - 1), `x=${x}: moves up to ${(SWAY_REACH * line[x]).toFixed(1)} units, ${toStroke(x)} from the letter`);
  }
});

test('the freedom from letter distances already worked out (which the frost shares) is the same', () => {
  const image = strokeImage();
  assert.deepEqual(freedomOf(letterDistance(letterMask(image, 200, 60), 200, 60)), swayFreedom(image, 200, 60));
});

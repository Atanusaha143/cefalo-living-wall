import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createGaze, lookAt, blinkLid, GAZE } from '../scene/src/gaze.js';
import { EYES } from '../scene/src/wall.js';

const run = (gaze, seconds, pointer = () => null, from = 0) => {
  for (let t = from + 1 / 30; t <= from + seconds; t += 1 / 30) gaze.step(1 / 30, t, pointer(t));
};

test('HR looks at the cursor: right of him, the irises go right; below him, down', () => {
  const gaze = createGaze(createRandom(1));
  run(gaze, 1, () => ({ x: 1400, y: 255 }));
  for (const e of gaze.eyes) assert.ok(e.x > 0.9 && Math.abs(e.y) < 0.1, JSON.stringify(e));
  run(gaze, 1, () => ({ x: 800, y: 900 }), 1);
  for (const e of gaze.eyes) assert.ok(e.y > 0.9, JSON.stringify(e));
});

test('the eyes converge on a cursor between them, and never look past their reach', () => {
  const between = { x: (EYES[0].x + EYES[1].x) / 2, y: 300 };
  const [left, right] = EYES.map((eye) => lookAt(eye, between));
  assert.ok(left.x > 0 && right.x < 0);
  for (let i = 0; i < 200; i++) {
    const g = lookAt(EYES[0], { x: i * 40 - 2000, y: (i % 13) * 300 - 1500 });
    assert.ok(Math.hypot(g.x, g.y) <= 1 + 1e-9);
  }
});

test('with no one about he still glances around, and blinks every few seconds', () => {
  const gaze = createGaze(createRandom(3));
  const seen = new Set();
  let blinks = 0, shut = false;
  for (let t = 1 / 30; t <= 60; t += 1 / 30) {
    gaze.step(1 / 30, t, null);
    seen.add(Math.round(gaze.eyes[0].x * 4));
    if (gaze.lid > 0.6 && !shut) blinks++;
    shut = gaze.lid > 0.6;
  }
  assert.ok(seen.size >= 4, `looked in ${seen.size} directions`);
  assert.ok(blinks >= 60 / GAZE.blink[1] && blinks <= 60 / GAZE.blink[0] * 1.5 + 2, `${blinks} blinks a minute`);
});

test('a blink shuts and opens again', () => {
  assert.equal(blinkLid(0), 0);
  assert.equal(blinkLid(1), 0);
  assert.ok(Math.abs(blinkLid(0.4) - 1) < 1e-9);
});

test('a cursor that sits still gets him squinting; moving it again opens his eyes', () => {
  const gaze = createGaze(createRandom(5));
  run(gaze, GAZE.squintAfter + 4, () => ({ x: 500, y: 600 }));
  assert.ok(gaze.squint > GAZE.squint * 0.9, `squint ${gaze.squint}`);
  run(gaze, 3, (t) => ({ x: 500 + t * 50, y: 600 }), GAZE.squintAfter + 4);
  assert.ok(gaze.squint < 0.05, `squint ${gaze.squint}`);
});

test('the same seed watches the same way', () => {
  const a = createGaze(createRandom(9)), b = createGaze(createRandom(9));
  run(a, 30); run(b, 30);
  assert.deepEqual(a.eyes, b.eyes);
  assert.equal(a.lid, b.lid);
});

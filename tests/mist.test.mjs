import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createMist, wetness, MIST } from '../scene/src/mist.js';

test('leaves get wet over 2 s and dry over the next minute', () => {
  assert.equal(wetness(null), 0);
  assert.equal(wetness(-1), 0);
  assert.equal(wetness(1), 0.5);
  assert.equal(wetness(MIST.falling), 1);
  assert.ok(Math.abs(wetness(MIST.falling + 30) - 0.5) < 1e-9);
  assert.equal(wetness(MIST.falling + MIST.dryOver + 1), 0);
  for (let e = -5; e < 100; e += 0.1) assert.ok(wetness(e) >= 0 && wetness(e) <= 1);
});

test('the lift happens once per watering, and watering again restarts it', () => {
  const mist = createMist(createRandom(1));
  const lifts = (from, to) => { let n = 0; for (let t = from; t < to; t += 1 / 30) if (mist.update(t, 1).lift) n++; return n; };
  assert.equal(lifts(0, 5), 0, 'no lift before watering');
  mist.water(5);
  assert.equal(lifts(5, 20), 1);
  mist.water(20);
  assert.equal(lifts(20, 25), 1);
  assert.equal(mist.points.visible, true);
  assert.equal(lifts(25, 60), 0);
  assert.equal(mist.points.visible, false, 'mist hides once it has fallen');
});

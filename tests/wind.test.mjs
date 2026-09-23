import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createWind, gustAt, gustProfile, swayAt, shaderTime, GUST_LENGTH, GUST_GAP, GUST_CROSSING, SHADER_TIME_WRAP } from '../scene/src/wind.js';

test('a gust front reaches the right edge after the left edge', () => {
  const peak = (x) => {
    let best = -1, at = 0;
    for (let t = 0; t < 10; t += 0.01) {
      const v = gustAt(x, t, 1, 1);
      if (v > best) { best = v; at = t; }
    }
    return at;
  };
  assert.ok(peak(1600) - peak(0) > 2, 'gust should take ~2.4 s to cross');
});

test('gust profile is zero outside its window and peaks at 1', () => {
  assert.equal(gustProfile(-1), 0);
  assert.equal(gustProfile(GUST_LENGTH + 0.1), 0);
  assert.ok(Math.abs(gustProfile(1) - 1) < 1e-9);
});

test('wind stays within [-1.5, 1.5] everywhere', () => {
  const wind = createWind(createRandom(5));
  for (let t = 0; t < 600; t += 0.37) {
    for (let x = 0; x <= 1600; x += 200) {
      const { sway, gust } = wind.sample(x, t, 0.3, 0.2);
      assert.ok(Math.abs(sway) <= 1.5 && Math.abs(gust) <= 1.5, `t=${t} x=${x}`);
    }
  }
});

test('gusts start 7-14 s apart (lively, user choice)', () => {
  const starts = createWind(createRandom(9)).startsUntil(4 * 3600).map((g) => g.start);
  assert.ok(starts[0] >= 7 && starts[0] <= 14);
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= 7 && gap <= 14, `gap ${gap}`);
  }
});

test('a gust is over everywhere before the next one starts (the shaders only know the latest)', () => {
  const maxLeafDelay = (980 / 1067) * 0.35 + 0.2;          // gustDelay in leaf-layout.js
  assert.ok(GUST_GAP[0] > GUST_CROSSING + GUST_LENGTH + maxLeafDelay);
});

test('same seed, same weather', () => {
  const a = createWind(createRandom(4)), b = createWind(createRandom(4));
  for (let t = 0; t < 200; t += 1.3) assert.deepEqual(a.sample(800, t), b.sample(800, t));
});

test('shader time wraps without changing the breeze or the gust', () => {
  for (const t of [9999.9, 10000.1, 30 * 86400 + 1.234]) {
    const { time, gustStart } = shaderTime(t, { start: t - 1.5, strength: 1 });
    assert.ok(time >= 0 && time < SHADER_TIME_WRAP);
    assert.ok(Math.abs(swayAt(700, time, 0.3) - swayAt(700, t, 0.3)) < 1e-6);
    assert.ok(Math.abs(time - gustStart - 1.5) < 1e-6);
  }
});

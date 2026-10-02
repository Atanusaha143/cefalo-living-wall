import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRandom } from '../scene/src/random.js';
import { createSwells } from '../scene/src/weather-swells.js';
import { createRainWeather } from '../scene/src/rain-weather.js';

const STEPS = { swellStep: [15, 25], burstEvery: [180, 480], burstLength: [15, 40] };

test('swells stay within -1..1 and bursts rise from 0 to 1 and back', () => {
  const swells = createSwells(createRandom(1), STEPS);
  let peak = 0;
  for (let t = 0; t < 3600; t += 0.5) {
    const s = swells.swellAt(t), b = swells.burstAt(t);
    assert.ok(s >= -1 && s <= 1, `swell ${s} at ${t}`);
    assert.ok(b >= 0 && b <= 1, `burst ${b} at ${t}`);
    peak = Math.max(peak, b);
  }
  assert.ok(peak > 0.99, `a burst reaches its peak within an hour: ${peak}`);
});

test('the same seed gives the same schedule', () => {
  const sample = (seed) => {
    const swells = createSwells(createRandom(seed), STEPS);
    return Array.from({ length: 400 }, (_, i) => [swells.swellAt(i * 3), swells.burstAt(i * 3)]);
  };
  assert.deepEqual(sample(4), sample(4));
  assert.notDeepEqual(sample(4), sample(5));
});

test('hours of swells keep only a few scheduled in memory', () => {
  const swells = createSwells(createRandom(1), STEPS);
  for (let t = 0; t < 6 * 3600; t += 1) { swells.swellAt(t); swells.burstAt(t); }
  assert.ok(swells.scheduled <= 6, `scheduled ${swells.scheduled}`);
});

test("the rain is exactly what it was before its swells moved here: every mode, every 7 s for an hour", () => {
  // Recorded from rain-weather.js before the move (seed 9, the scene's rain seed).
  const weather = createRainWeather(createRandom(9));
  const plan = [[0, 2], [1200, 3], [2400, 1], [3600, 0]];   // Steady, Monsoon, Drizzle, Off
  const out = [];
  for (let t = 0; t <= 3700; t += 7) {
    for (const [at, mode] of plan) if (at <= t && at > t - 7) weather.setMode(mode, at);
    const w = weather.at(t);
    out.push([w.level, w.wet, w.overcast, w.size].map((v) => v.toFixed(12)).join(' '));
  }
  assert.equal(out.length, 529);
  assert.equal(out[100], '0.628544060545 1.000000000000 0.800000000000 0.500000000000');
  assert.equal(createHash('sha256').update(out.join('\n')).digest('hex'), 'b58a633837bee081e2ac1c7fd3a6ca6097e404ba862c0ba5cb4d6362293d393b');
});

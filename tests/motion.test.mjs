import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createWind } from '../scene/src/wind.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createSprings } from '../scene/src/leaf-springs.js';
import { createLeaves } from '../scene/src/leaves.js';
import { MOTION_LEVELS, DEFAULT_MOTION, motionLevel, createMotionClock } from '../scene/src/motion.js';

test('three levels, Gentle to Wild, Lively by default', () => {
  assert.deepEqual(MOTION_LEVELS.map((l) => l.name), ['Gentle', 'Lively', 'Wild']);
  assert.equal(motionLevel(DEFAULT_MOTION).name, 'Lively');
});

test('each level moves the leaves clearly further than the one below (the user wanted every option to look different)', () => {
  const green = { data: new Uint8ClampedArray(40 * 27 * 4).fill(90), width: 40, height: 27 };
  const data = generateLeaves(createRandom(7));
  const leaves = createLeaves(data, green, createRandom(2), createSprings(data));
  const sample = data.map((_, i) => i).filter((i) => i % 7 === 0);
  // How far a leaf's midpoint travels in half a second, averaged over two minutes of wind.
  const movement = (level) => {
    const clock = createMotionClock(level), wind = createWind(createRandom(3)), frames = [];
    for (let f = 0; f < 3600; f++) {
      const t = clock.advance(1 / 30);
      leaves.update(t, wind.current(t), 0, clock.strength);
      frames.push(sample.map((i) => leaves.midpoint(i)));
    }
    let sum = 0, n = 0;
    for (let f = 0; f + 15 < frames.length; f += 3) {
      frames[f].forEach((a, k) => { const b = frames[f + 15][k]; sum += Math.hypot(b.x - a.x, b.y - a.y); n++; });
    }
    return sum / n;
  };
  const moved = MOTION_LEVELS.map((l) => movement(l.level));
  for (let i = 1; i < moved.length; i++) {
    const step = moved[i] / moved[i - 1];
    assert.ok(step >= 1.55, `${MOTION_LEVELS[i].name} moves only ${step.toFixed(2)}x as far as ${MOTION_LEVELS[i - 1].name}`);
  }
});

test('saved levels keep their numbers (3 Gentle, 4 Lively, 5 Wild); the old Calm and Gentle, 1 and 2, become Gentle', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((stored) => motionLevel(stored).name), ['Gentle', 'Gentle', 'Gentle', 'Lively', 'Wild']);
  assert.deepEqual([1, 2, 3, 4, 5].map((stored) => motionLevel(stored).level), [3, 3, 3, 4, 5]);
});

test('odd levels round and clamp to a real one; nonsense falls back to the default', () => {
  assert.equal(motionLevel(0).level, 3);
  assert.equal(motionLevel(9).level, 5);
  assert.equal(motionLevel(3.6).level, 4);
  assert.equal(motionLevel('5').level, 5);
  for (const bad of [NaN, undefined, null, '', 'x']) assert.equal(motionLevel(bad).level, DEFAULT_MOTION);
});

test('the wind clock runs at the chosen speed and can change level mid-run', () => {
  const clock = createMotionClock(5);
  for (let i = 0; i < 100; i++) clock.advance(0.1);
  assert.ok(Math.abs(clock.time - 18) < 1e-9, `Wild: ${clock.time}`);
  clock.set(3);
  for (let i = 0; i < 100; i++) clock.advance(0.1);
  assert.ok(Math.abs(clock.time - 28) < 1e-9, `then Gentle: ${clock.time}`);
});

test('switching level eases how far the leaves swing over about a second, instead of jumping', () => {
  const wild = motionLevel(5).strength, gentle = motionLevel(3).strength, gap = wild - gentle;
  const clock = createMotionClock(5);
  assert.equal(clock.strength, wild, 'a new clock swings at its level straight away');
  clock.set(3);
  clock.advance(1 / 30);
  assert.ok(clock.strength - gentle > 0.85 * gap, `one frame later it has hardly changed: ${clock.strength}`);
  for (let i = 0; i < 15; i++) clock.advance(1 / 30);
  assert.ok(clock.strength - gentle > 0 && clock.strength - gentle < 0.35 * gap, `half a second in, most of the way: ${clock.strength}`);
  for (let i = 0; i < 45; i++) clock.advance(1 / 30);
  assert.ok(Math.abs(clock.strength - gentle) < 0.01 * gap, `two seconds on it swings like Gentle: ${clock.strength}`);
});

test('faster motion brings gusts proportionally more often', () => {
  const gustsIn = (level, seconds) => {
    const clock = createMotionClock(level);
    for (let t = 0; t < seconds; t += 0.5) clock.advance(0.5);
    return createWind(createRandom(3)).startsUntil(clock.time).length;
  };
  const gentle = gustsIn(3, 3600), wild = gustsIn(5, 3600);
  assert.ok(wild / gentle > 1.6 && wild / gentle < 2, `wild ${wild} vs gentle ${gentle}`);
});

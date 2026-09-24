import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createWind } from '../scene/src/wind.js';
import { MOTION_LEVELS, DEFAULT_MOTION, motionLevel, createMotionClock } from '../scene/src/motion.js';

test('five levels from Calm to Wild, Energetic by default', () => {
  assert.deepEqual(MOTION_LEVELS.map((l) => l.name), ['Calm', 'Gentle', 'Lively', 'Energetic', 'Wild']);
  assert.equal(motionLevel(DEFAULT_MOTION).name, 'Energetic');
  for (let i = 1; i < MOTION_LEVELS.length; i++) {
    assert.ok(MOTION_LEVELS[i].speed > MOTION_LEVELS[i - 1].speed && MOTION_LEVELS[i].strength > MOTION_LEVELS[i - 1].strength);
  }
});

test('odd levels clamp to the nearest real one; nonsense falls back to the default', () => {
  assert.equal(motionLevel(0).level, 1);
  assert.equal(motionLevel(9).level, 5);
  assert.equal(motionLevel(2.6).level, 3);
  assert.equal(motionLevel('4').level, 4);
  for (const bad of [NaN, undefined, null, 'x']) assert.equal(motionLevel(bad).level, DEFAULT_MOTION);
});

test('the wind clock runs at the chosen speed and can change level mid-run', () => {
  const clock = createMotionClock(5);
  for (let i = 0; i < 100; i++) clock.advance(0.1);
  assert.ok(Math.abs(clock.time - 16) < 1e-9, `Wild: ${clock.time}`);
  clock.set(1);
  for (let i = 0; i < 100; i++) clock.advance(0.1);
  assert.ok(Math.abs(clock.time - 23) < 1e-9, `then Calm: ${clock.time}`);
});

test('faster motion brings gusts proportionally more often', () => {
  const gustsIn = (level, seconds) => {
    const clock = createMotionClock(level);
    for (let t = 0; t < seconds; t += 0.5) clock.advance(0.5);
    return createWind(createRandom(3)).startsUntil(clock.time).length;
  };
  const calm = gustsIn(1, 3600), wild = gustsIn(5, 3600);
  assert.ok(wild / calm > 2 && wild / calm < 2.6, `wild ${wild} vs calm ${calm}`);
});

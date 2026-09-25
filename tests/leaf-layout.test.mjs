import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { inLogo, WALL_TOP, WALL_BOTTOM } from '../scene/src/wall.js';

test('same seed gives the same wall', () => {
  assert.deepEqual(generateLeaves(createRandom(7)), generateLeaves(createRandom(7)));
});

for (const seed of [1, 7, 42, 2026]) {
  test(`seed ${seed}: 500-700 leaves, none in the logo, ceiling or pebbles`, () => {
    const leaves = generateLeaves(createRandom(seed));
    assert.ok(leaves.length >= 500 && leaves.length <= 700, `count ${leaves.length}`);
    for (const l of leaves) {
      for (const [x, y] of [[l.x, l.y], [l.midX, l.midY], [l.tipX, l.tipY]]) {
        assert.ok(!inLogo(x, y), `leaf point in logo at ${x},${y}`);
        assert.ok(y > WALL_TOP, `leaf point in ceiling at ${x},${y}`);
        assert.ok(y < WALL_BOTTOM + 8, `leaf point in pebbles at ${x},${y}`);
      }
    }
  });
}

test('the ceiling is level, so the top row of leaves reaches both ends of the wall', () => {
  // The top row sits at y 119-137 and the next one below 165: a sloping ceiling line
  // would drop the top row at one end.
  for (const seed of [1, 7, 42, 2026]) {
    const leaves = generateLeaves(createRandom(seed));
    const highest = (from, to) => Math.min(...leaves.filter((l) => l.pocketX >= from && l.pocketX < to).map((l) => l.pocketY));
    const left = highest(0, 200), right = highest(1400, 1600);
    assert.ok(left < 150 && right < 150, `seed ${seed}: highest leaves at y=${left.toFixed(0)} left, y=${right.toFixed(0)} right`);
  }
});

test('leaves sway 6.6-14.4 degrees and gusts push them up to ~30 (lively, user choice)', () => {
  const leaves = generateLeaves(createRandom(7));
  for (const l of leaves) assert.ok(Math.abs(l.swayAmp) >= 6.6 && Math.abs(l.swayAmp) <= 14.4, `sway ${l.swayAmp}`);
  const strongest = Math.max(...leaves.map((l) => Math.abs(l.gustAmp)));
  assert.ok(strongest > 25 && strongest <= 36, `strongest gust ${strongest}`);
});

test('deep leaves come first, then top-to-bottom', () => {
  const leaves = generateLeaves(createRandom(7));
  const firstFront = leaves.findIndex((l) => !l.deep);
  assert.ok(leaves.slice(firstFront).every((l) => !l.deep));
  for (let i = firstFront + 1; i < leaves.length; i++) assert.ok(leaves[i].y >= leaves[i - 1].y);
});

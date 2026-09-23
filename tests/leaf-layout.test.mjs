import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { inLogo, wallTop, WALL_BOTTOM } from '../scene/src/wall.js';

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
        assert.ok(y > wallTop(x), `leaf point in ceiling at ${x},${y}`);
        assert.ok(y < WALL_BOTTOM + 8, `leaf point in pebbles at ${x},${y}`);
      }
    }
  });
}

test('deep leaves come first, then top-to-bottom', () => {
  const leaves = generateLeaves(createRandom(7));
  const firstFront = leaves.findIndex((l) => !l.deep);
  assert.ok(leaves.slice(firstFront).every((l) => !l.deep));
  for (let i = firstFront + 1; i < leaves.length; i++) assert.ok(leaves[i].y >= leaves[i - 1].y);
});

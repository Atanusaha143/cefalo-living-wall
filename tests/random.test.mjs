import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';

test('same seed gives the same sequence', () => {
  const a = createRandom(7), b = createRandom(7);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different seeds differ', () => {
  assert.notEqual(createRandom(1).next(), createRandom(2).next());
});

test('range and int stay in bounds', () => {
  const r = createRandom(3);
  for (let i = 0; i < 10000; i++) {
    const v = r.range(15, 40);
    assert.ok(v >= 15 && v < 40);
    const n = r.int(1, 3);
    assert.ok([1, 2, 3].includes(n));
  }
});

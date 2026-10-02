import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createSprings } from '../scene/src/leaf-springs.js';
import { createSnowLoads, holdOf, droopOf, LOADS } from '../scene/src/snow-loads.js';

const DT = 1 / 30;
const leaves = generateLeaves(createRandom(7));
const still = { angularSpeed: new Float32Array(leaves.length), gustAt: () => 0, sway: 1 };
const snowy = (cover = 1) => ({ cover, snowing: true });
/** Loads after `seconds` of the given weather, with nothing moving and puffs to spare. */
function settle(loads, seconds, weather = snowy(), motion = still) {
  let sheds = [];
  for (let t = 0; t < seconds; t += DT) sheds = sheds.concat(loads.update(DT, weather, motion, 30));
  return sheds;
}

test('a leaf lying across holds the most snow, one pointing up or down little', () => {
  assert.equal(holdOf(90), 1);
  assert.equal(holdOf(-90), 1);
  assert.ok(Math.abs(holdOf(0) - 0.25) < 1e-9 && Math.abs(holdOf(180) - 0.25) < 1e-9);
  assert.ok(holdOf(45) > holdOf(20) && holdOf(45) < holdOf(80));
});

test('a loaded leaf droops towards the ground, a leaf pointing straight up not at all', () => {
  assert.equal(droopOf(90), 1, 'pointing right: clockwise, down');
  assert.equal(droopOf(-90), -1, 'pointing left: anticlockwise, down');
  assert.equal(droopOf(0), 0);
});

test('while it snows the leaves fill towards the cover, each as much as it can hold, in about 40 s', () => {
  const loads = createSnowLoads(leaves, createRandom(1));
  settle(loads, LOADS.refill / 2, snowy(0.75));
  const half = leaves.map((l, i) => loads.load[i] / (0.75 * holdOf(l.angle)));
  assert.ok(half.every((f) => f > 0.3 && f < 0.7), 'half-way after 20 s');
  settle(loads, LOADS.refill, snowy(0.75));
  leaves.forEach((l, i) => assert.ok(Math.abs(loads.load[i] - 0.75 * holdOf(l.angle)) < 1e-6, `leaf ${i}: ${loads.load[i]}`));
});

test('the loads follow the cover down as it melts, and nothing refills once the snow stops', () => {
  const loads = createSnowLoads(leaves, createRandom(1));
  settle(loads, 120, snowy(1));
  settle(loads, 1, { cover: 0.4, snowing: false });
  leaves.forEach((l, i) => assert.ok(loads.load[i] <= 0.4 * holdOf(l.angle) + 1e-6, `leaf ${i}`));
  settle(loads, 1, { cover: 0, snowing: false });
  assert.ok(loads.load.every((v) => v === 0), 'bare once the cover has gone');
});

test('a leaf turning fast (the cursor brushing it) sheds its snow, keeping a tenth, and rests a moment', () => {
  const loads = createSnowLoads(leaves, createRandom(1));
  settle(loads, 120);
  const before = loads.load[42], angularSpeed = new Float32Array(leaves.length);
  angularSpeed[42] = LOADS.shedSpeed * 0.9;
  assert.deepEqual(loads.update(DT, snowy(), { ...still, angularSpeed }, 30), [], 'slower than that sheds nothing');
  angularSpeed[42] = LOADS.shedSpeed * 1.5;
  const sheds = loads.update(DT, snowy(), { ...still, angularSpeed }, 30);
  assert.deepEqual(sheds.map((s) => s.leaf), [42]);
  assert.ok(Math.abs(sheds[0].amount - 0.9 * before) < 0.01 && Math.abs(loads.load[42] - 0.1 * before) < 0.01, JSON.stringify(sheds[0]));
  assert.equal(sheds[0].flick, angularSpeed[42]);
  assert.deepEqual(loads.update(DT, snowy(), { ...still, angularSpeed }, 30), [], 'still springing: its trace stays for now');
});

test('a butterfly taking off shakes its leaf: it sheds on the next update', () => {
  const loads = createSnowLoads(leaves, createRandom(1));
  settle(loads, 120);
  loads.shake(7);
  assert.deepEqual(loads.update(DT, snowy(), still, 30).map((s) => s.leaf), [7]);
});

test('a strong gust blows half the snow off loaded leaves; a light one none', () => {
  const shedIn = (gust) => {
    const loads = createSnowLoads(leaves, createRandom(1));
    settle(loads, 120);
    let count = 0;
    for (let t = 0; t < 1; t += DT) {
      const before = Float32Array.from(loads.load);
      const sheds = loads.update(DT, snowy(), { ...still, gustAt: () => gust }, 30);
      for (const s of sheds) assert.ok(Math.abs(loads.load[s.leaf] - 0.5 * before[s.leaf]) < 1e-6, `leaf ${s.leaf} keeps half`);
      count += sheds.length;
    }
    return count;
  };
  assert.equal(shedIn(0.9), 0, 'below the threshold');
  assert.ok(shedIn(1.4) > 20, `a strong gust across the wall: ${shedIn(1.4)} leaves in a second`);
});

test('never more sheds than free puffs: a leaf that should shed waits for one', () => {
  const loads = createSnowLoads(leaves, createRandom(1));
  settle(loads, 120);
  const angularSpeed = new Float32Array(leaves.length).fill(5);
  assert.equal(loads.update(DT, snowy(), { ...still, angularSpeed }, 3).length, 3);
  assert.equal(loads.update(DT, snowy(), { ...still, angularSpeed }, 0).length, 0, 'none free');
  assert.equal(loads.update(DT, snowy(), { ...still, angularSpeed }, 5).length, 5, 'the waiting leaves shed once puffs are free');
});

test('only leaves whose snow changed are reported', () => {
  const loads = createSnowLoads(leaves, createRandom(1));
  loads.update(DT, snowy(), still, 30);
  assert.equal(loads.takeDirty().length, leaves.length, 'the first snow reaches every leaf');
  settle(loads, 120);
  loads.takeDirty();
  loads.update(DT, snowy(), still, 30);
  assert.deepEqual(loads.takeDirty(), [], 'full and still: nothing to upload');
});

test('the springs report how fast each leaf turns', () => {
  const springs = createSprings(leaves);
  springs.knock(5, 2);
  springs.step(1 / 60);
  assert.ok(Math.abs(springs.vel[5]) > 1, `leaf 5 turns at ${springs.vel[5]}`);
  assert.equal(springs.vel[6], 0);
});

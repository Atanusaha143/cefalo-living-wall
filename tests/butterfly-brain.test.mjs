import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createButterflyBrain, BUTTERFLY } from '../scene/src/butterfly-brain.js';
import { inLogo } from '../scene/src/wall.js';

const DT = 1 / 30;
const perchesFor = (seed) => generateLeaves(createRandom(seed)).map((l, index) => ({ index, x: l.midX, y: l.midY }));
const brainFor = (seed) => createButterflyBrain({ random: createRandom(seed), perches: perchesFor(seed) });

// One shared 8-hour run: the invariants below are all checked against it.
const eight = (() => {
  const brain = brainFor(7);
  let maxActive = 0;
  for (let t = 0; t < 8 * 3600; t += DT) {
    brain.tick(DT);
    maxActive = Math.max(maxActive, brain.flyers.length);
  }
  return { brain, maxActive };
})();

test('never more than two butterflies at once', () => {
  assert.ok(eight.maxActive <= 2 && eight.maxActive >= 1, `max ${eight.maxActive}`);
});

test('no landing in the logo zone', () => {
  assert.ok(eight.brain.log.landings.length > 100);
  for (const l of eight.brain.log.landings) assert.ok(!inLogo(l.x, l.y, BUTTERFLY.logoMargin), `landed at ${l.x},${l.y}`);
});

test('about one visit in four is a pair', () => {
  // Pooled over three 8-hour runs: one run alone (~290 visits) is too noisy to pin 0.25.
  const visits = [eight.brain, ...[3, 42].map((seed) => {
    const brain = brainFor(seed);
    for (let t = 0; t < 8 * 3600; t += DT) brain.tick(DT);
    return brain;
  })].flatMap((b) => b.log.visits);
  const share = visits.filter((v) => v.pair).length / visits.length;
  assert.ok(visits.length > 600, `visits ${visits.length}`);
  assert.ok(share >= 0.18 && share <= 0.32, `pair share ${share}`);
});

test('20-90 s between one visit leaving and the next arriving', () => {
  const { visits } = eight.brain.log;
  for (let i = 1; i < visits.length; i++) {
    const gap = visits[i].start - visits[i - 1].end;
    assert.ok(gap >= 20 - DT && gap <= 90 + DT, `gap ${gap}`);
  }
});

test('every visit ends', () => {
  for (const v of eight.brain.log.visits) assert.ok(v.end - v.start <= BUTTERFLY.maxVisit + 30, `visit ${v.end - v.start}s`);
});

test('a resting butterfly takes off within one tick of the cursor coming near', () => {
  const brain = brainFor(3);
  let resting = null;
  for (let t = 0; t < 600 && !resting; t += DT) {
    brain.tick(DT);
    resting = brain.flyers.find((b) => b.state === 'resting');
  }
  assert.ok(resting, 'no butterfly ever rested');
  brain.tick(DT, { x: resting.x + 60, y: resting.y, inside: true });
  assert.notEqual(resting.state, 'resting');
});

test('never lands within reach of a cursor that lingers', () => {
  const brain = brainFor(5), pointer = { x: 800, y: 300, inside: true };
  for (let t = 0; t < 3600; t += DT) brain.tick(DT, pointer);
  assert.ok(brain.log.landings.length > 20);
  for (const l of brain.log.landings) {
    assert.ok(Math.hypot(l.x - pointer.x, l.y - pointer.y) >= BUTTERFLY.fleeRadius, `landed ${Math.hypot(l.x - pointer.x, l.y - pointer.y)} from the cursor`);
  }
});

test('same seed, same butterflies', () => {
  const a = brainFor(11), b = brainFor(11);
  for (let t = 0; t < 300; t += DT) { a.tick(DT); b.tick(DT); }
  assert.deepEqual(a.log, b.log);
});

test('with nowhere to land, visitors fly through and leave', () => {
  const brain = createButterflyBrain({ random: createRandom(1), perches: [] });
  for (let t = 0; t < 400; t += DT) brain.tick(DT);
  assert.ok(brain.log.visits.length >= 1 && brain.log.landings.length === 0);
});

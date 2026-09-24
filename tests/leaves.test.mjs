import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createSprings } from '../scene/src/leaf-springs.js';
import { createLeaves } from '../scene/src/leaves.js';

const green = () => {
  const width = 40, height = 27, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([60, 110, 40, 255], i * 4);
  return { data, width, height };
};
const noGust = { start: -1e4, strength: 0 };
const setup = () => {
  const data = generateLeaves(createRandom(7));
  const springs = createSprings(data);
  return { data, springs, leaves: createLeaves(data, green(), createRandom(2), springs) };
};

test('one instanced draw for all leaves, with shadows under and stems between', () => {
  const { data, leaves } = setup();
  const [shadow, stems, blades] = leaves.group.children;
  assert.equal(blades.geometry.instanceCount, data.length);
  assert.deepEqual([shadow.renderOrder, stems.renderOrder, blades.renderOrder], [1, 2, 3]);
  assert.equal(shadow.geometry, blades.geometry, 'shadows share the leaves geometry');
});

test('a leaf midpoint sways near where it grows', () => {
  const { data, leaves } = setup();
  for (let t = 0; t < 30; t += 0.7) {
    leaves.update(t, noGust);
    for (const i of [0, 100, 300]) {
      const m = leaves.midpoint(i);
      assert.ok(Math.hypot(m.x - data[i].midX, m.y - data[i].midY) < 8, `leaf ${i} at t=${t}`);
    }
  }
});

test('the motion strength scales how far leaves sway, on the GPU and in midpoint()', () => {
  const { data, leaves } = setup();
  const swing = (strength) => {
    let max = 0;
    for (let t = 0; t < 10; t += 0.25) {
      leaves.update(t, noGust, 0, strength);
      const m = leaves.midpoint(5);
      max = Math.max(max, Math.hypot(m.x - data[5].midX, m.y - data[5].midY));
    }
    return max;
  };
  const calm = swing(0.35), wild = swing(1.6);
  assert.ok(wild > calm * 3, `calm ${calm} wild ${wild}`);
  assert.equal(leaves.group.children[2].material.uniforms.uStrength.value, 1.6);
});

test('bends reach the GPU buffer, uploading only the changed span', () => {
  const { springs, leaves } = setup();
  springs.setHold(42, 20);
  for (let i = 0; i < 120; i++) springs.step(1 / 60);
  leaves.applyBends();
  const bend = leaves.group.children[2].geometry.getAttribute('iBend');
  assert.ok(Math.abs(bend.array[42] - springs.angle[42]) < 1e-6 && bend.array[42] > 15);
  assert.deepEqual(bend.updateRanges, [{ start: 42, count: 1 }]);
});

test('a positive bend moves the midpoint the way the layout says', () => {
  const { data, springs, leaves } = setup();
  leaves.update(0, noGust);
  const before = leaves.midpoint(7);
  springs.setHold(7, 10);
  for (let i = 0; i < 180; i++) springs.step(1 / 60);
  const after = leaves.midpoint(7);
  const moved = (after.x - before.x) * data[7].ux + (after.y - before.y) * data[7].uy;
  assert.ok(moved > 2, `moved ${moved} along u`);
});

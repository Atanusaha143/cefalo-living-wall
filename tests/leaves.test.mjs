import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createSprings } from '../scene/src/leaf-springs.js';
import { createLeaves } from '../scene/src/leaves.js';
import { createSnowLoads, droopOf, LOADS } from '../scene/src/snow-loads.js';

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
      leaves.update(t, noGust, strength);
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

test('rain wets and darkens the leaves, snow chills them: the sky reaches every leaf layer', () => {
  const { leaves } = setup();
  leaves.update(0, noGust, 1, { wet: 0.7, overcast: 0.4, chill: 0.6 });
  const [shadow, , blades] = leaves.group.children;
  for (const mesh of [shadow, blades]) {
    assert.equal(mesh.material.uniforms.uWet.value, 0.7);
    assert.equal(mesh.material.uniforms.uOvercast.value, 0.4);
    assert.equal(mesh.material.uniforms.uChill.value, 0.6);
  }
  leaves.update(1, noGust);
  const u = blades.material.uniforms;
  assert.deepEqual([u.uWet.value, u.uOvercast.value, u.uChill.value], [0, 0, 0], 'dry, clear and mild by default');
});

test('rain pelts the leaves: how hard it rains reaches every leaf layer, and nothing trembles when dry', () => {
  const { leaves } = setup();
  leaves.update(0, noGust, 1, { wet: 1, overcast: 1, pelt: 0.8 });
  const [shadow, , blades] = leaves.group.children;
  for (const mesh of [shadow, blades]) assert.equal(mesh.material.uniforms.uPelt.value, 0.8);
  leaves.update(1, noGust);
  assert.equal(blades.material.uniforms.uPelt.value, 0, 'dry by default');
});

test('snow on the leaves reaches the GPU buffer, uploading only the changed span', () => {
  const { data, leaves } = setup();
  const loads = createSnowLoads(data, createRandom(1));
  const still = { angularSpeed: new Float32Array(data.length), gustAt: () => 0, sway: 1 };
  for (let t = 0; t < 90; t += 1 / 30) loads.update(1 / 30, { cover: 1, snowing: true }, still, 30);
  leaves.applySnow(loads);
  const snow = leaves.group.children[2].geometry.getAttribute('iSnow');
  assert.ok(Math.abs(snow.array[9] - loads.load[9]) < 1e-6 && snow.array[9] > 0.2, `leaf 9 holds ${snow.array[9]}`);
  loads.load[9] = 0.05;
  loads.update(1 / 30, { cover: 1, snowing: true }, { ...still, angularSpeed: Object.assign(new Float32Array(data.length), { 12: 5 }) }, 30);
  leaves.applySnow(loads);
  assert.deepEqual(snow.updateRanges, [{ start: 9, count: 4 }], 'leaves 9 (refilling) and 12 (shed)');
});

test('a leaf weighed down by snow droops towards the ground', () => {
  const { data, leaves } = setup();
  const i = data.findIndex((l) => Math.abs(Math.abs(l.angle) - 90) < 20);
  const loads = { load: new Float32Array(data.length), takeDirty: () => [] };
  leaves.update(0, noGust);
  leaves.applySnow(loads);
  const bare = leaves.midpoint(i);
  loads.load[i] = 1;
  const laden = leaves.midpoint(i);
  assert.ok(laden.y - bare.y > 0.5, `leaf ${i} at ${data[i].angle.toFixed(0)} degrees dropped ${laden.y - bare.y}`);
  assert.equal(LOADS.droop, 5);
  assert.notEqual(droopOf(data[i].angle), 0);
});

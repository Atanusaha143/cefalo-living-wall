import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createLights } from '../scene/src/lights.js';
import { SHADER_TIME_WRAP } from '../scene/src/wind.js';

test('a cone and a glow for each of the six downlights, with dust drawn over them', () => {
  const [beams, dust] = createLights(createRandom(1)).group.children;
  assert.equal(beams.geometry.getAttribute('position').count, 6 * 2 * 6);
  assert.equal(dust.geometry.getAttribute('aMote').count, 18);
  assert.deepEqual([beams.renderOrder, dust.renderOrder], [7, 8]);
});

test('dust gets wrapped time and the screen scale', () => {
  const lights = createLights(createRandom(1));
  lights.update(SHADER_TIME_WRAP + 3, 1.9);
  const { uTime, uPxPerUnit } = lights.group.children[1].material.uniforms;
  assert.ok(Math.abs(uTime.value - 3) < 1e-9);
  assert.equal(uPxPerUnit.value, 1.9);
});

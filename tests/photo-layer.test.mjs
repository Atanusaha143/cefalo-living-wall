import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../scene/vendor/three.module.js';
import { createRandom } from '../scene/src/random.js';
import { SHADER_TIME_WRAP } from '../scene/src/wind.js';
import { createPhotoLayer, DRIFT_SPEEDS } from '../scene/src/photo-layer.js';

test('every noise drift completes whole turns per shader-time wrap', () => {
  for (const speed of Object.values(DRIFT_SPEEDS)) {
    const turns = speed * SHADER_TIME_WRAP;
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `speed ${speed}`);
  }
});

test('the photo is drawn first and gets wrapped time', () => {
  const layer = createPhotoLayer(new THREE.Texture(), createRandom(1));
  assert.equal(layer.mesh.renderOrder, 0);
  layer.update(SHADER_TIME_WRAP + 2, { start: SHADER_TIME_WRAP + 1, strength: 1 });
  const u = layer.mesh.material.uniforms;
  assert.ok(Math.abs(u.uTime.value - 2) < 1e-9);
  assert.ok(Math.abs(u.uTime.value - u.uGustStart.value - 1) < 1e-9);
});

test('the cursor ripple fades within a second or two', () => {
  const layer = createPhotoLayer(new THREE.Texture(), createRandom(1));
  const noGust = { start: -1e4, strength: 0 };
  layer.poke(400, 300, 5);
  layer.update(5, noGust);
  assert.ok(layer.mesh.material.uniforms.uRipple.value > 0.99);
  layer.update(7, noGust);
  assert.ok(layer.mesh.material.uniforms.uRipple.value < 0.1);
});

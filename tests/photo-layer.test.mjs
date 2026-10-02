import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../scene/vendor/three.module.js';
import { createRandom } from '../scene/src/random.js';
import { SHADER_TIME_WRAP } from '../scene/src/wind.js';
import { createPhotoLayer, DRIFT_SPEEDS, SWAY_REACH } from '../scene/src/photo-layer.js';
import { LOGO_AREA } from '../scene/src/logo-mask.js';

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

test('rain turns the photo overcast; snow chills it and settles on it', () => {
  const layer = createPhotoLayer(new THREE.Texture(), createRandom(1));
  const noGust = { start: -1e4, strength: 0 }, u = layer.mesh.material.uniforms;
  layer.update(1, noGust, 1, { overcast: 0.6, chill: 0.5, cover: 0.4 });
  assert.deepEqual([u.uOvercast.value, u.uChill.value, u.uCover.value], [0.6, 0.5, 0.4]);
  layer.update(2, noGust);
  assert.deepEqual([u.uOvercast.value, u.uChill.value, u.uCover.value], [0, 0, 0], 'clear and bare by default');
});

test('until the frost map arrives nothing frosts; then it reaches the shader as a texture over the whole wall', () => {
  const layer = createPhotoLayer(new THREE.Texture(), createRandom(1)), u = layer.mesh.material.uniforms;
  assert.deepEqual([u.uFrost.value.image.width, u.uFrost.value.image.data[0]], [1, 0]);
  layer.setFrost({ data: new Float32Array(800 * 534).fill(1), width: 800, height: 534 });
  assert.deepEqual([u.uFrost.value.image.width, u.uFrost.value.image.height, u.uFrost.value.image.data[0]], [800, 534, 255]);
});

test('near the logo the wind reads how free the photo is from a texture over the logo area', () => {
  const freedom = { data: new Float32Array(LOGO_AREA.width * LOGO_AREA.height).fill(0.5), width: LOGO_AREA.width, height: LOGO_AREA.height };
  const u = createPhotoLayer(new THREE.Texture(), createRandom(1), freedom).mesh.material.uniforms;
  assert.equal(u.uFreedom.value.image.width, LOGO_AREA.width);
  assert.equal(u.uFreedom.value.image.data[0], 128);
  assert.deepEqual(u.uArea.value.toArray(), [LOGO_AREA.x0, LOGO_AREA.y0, LOGO_AREA.width, LOGO_AREA.height]);
});

test('the farthest the wind and the cursor can move the photo, for the logo to stay clear of', () => {
  // noise up to 1.5 per axis, at full sway and the strongest gust (1.2), at Wild (capped at 1.3), plus the ripple
  assert.ok(Math.abs(SWAY_REACH - (1.5 * Math.SQRT2 * (3 + 1.5 + 2.5 * 1.2) * 1.3 + 3)) < 1e-9);
});

test("the frost's grain is read at the swayed point, as the frost map and the photo are, so frost never slides off its leaf", () => {
  // GLSL does not run in Node: this checks the shader reads it there (the smoke test draws it).
  const shader = createPhotoLayer(new THREE.Texture(), createRandom(1)).mesh.material.fragmentShader;
  const leaves = shader.slice(shader.indexOf('vec3 settled('), shader.indexOf('// The pebbles'));
  assert.match(leaves, /texture2D\(uNoise, swayed \/ 384\.0\)/);
  assert.doesNotMatch(leaves, /texture2D\(uNoise, p \/ 384\.0\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../scene/vendor/three.module.js';
import { createLogoGlow, haloMask, GLOW, GLOW_BOX } from '../scene/src/logo-glow.js';

test('the glow shows only during the last 3.3 s of every 11 s, moving left to right', () => {
  const glow = createLogoGlow(new THREE.Texture());
  let last = -Infinity;
  for (let t = 0; t < 33; t += 0.05) {
    glow.update(t);
    const inSweep = t % GLOW.every >= GLOW.every - GLOW.sweep;
    assert.equal(glow.mesh.visible, inSweep, `t=${t.toFixed(2)}`);
    const band = glow.mesh.material.uniforms.uBand.value;
    if (inSweep && t % GLOW.every > GLOW.every - GLOW.sweep + 0.1) assert.ok(band > last);
    last = inSweep ? band : -Infinity;
  }
});

// A letter's stroke, 20 units wide, white on dark foliage, in an image one pixel per wall unit.
function strokeImage(width = 200, height = 60, from = 90, to = 110, blue = 245) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, on = x >= from && x < to;
    rgba.set(on ? [245, 245, blue, 255] : [30, 60, 25, 255], i);
  }
  return rgba;
}
const row = (halo, width, y) => Array.from(halo.slice(y * width, (y + 1) * width));

test('the halo fades smoothly away from the letters: no ghost copies of their outline', () => {
  const halo = haloMask(strokeImage(), 200, 60), line = row(halo, 200, 30);
  for (let x = 110; x < 199; x++) {
    assert.ok(line[x + 1] <= line[x] + 1e-6, `rises again at ${x + 1}: ${line[x]} -> ${line[x + 1]}`);
    assert.ok(line[x] - line[x + 1] < 0.1, `a sharp edge (an outline) at ${x}: ${line[x]} -> ${line[x + 1]}`);
  }
  for (let x = 90; x > 0; x--) assert.ok(line[x - 1] <= line[x] + 1e-6, `rises again at ${x - 1}`);
});

test('the halo reaches about 15 units out, as the glow was designed', () => {
  const line = row(haloMask(strokeImage(), 200, 60), 200, 30);
  assert.ok(line[112] > 0.3, `just outside the letter: ${line[112]}`);
  assert.ok(line[118] > 0.05, `8 units out: ${line[118]}`);
  assert.ok(line[128] < 0.02, `18 units out: ${line[128]}`);
  assert.ok(line[60] === 0 && line[150] === 0, 'nothing far away');
});

test('only the white letters glow, read as the shader reads them (blue above 0.7, linear)', () => {
  const pale = haloMask(strokeImage(200, 60, 90, 110, 200), 200, 60);   // light grey: linear blue 0.58
  assert.ok(Math.max(...pale) < 0.01, 'a pale grey stroke is no letter');
});

test('the glow draws its halo from the texture made at load, over the glow box', () => {
  const halo = haloMask(strokeImage(), 200, 60);
  const glow = createLogoGlow(new THREE.Texture(), { data: halo, width: 200, height: 60 });
  const { uHalo, uHaloBox } = glow.mesh.material.uniforms;
  assert.equal(uHalo.value.image.width, 200);
  assert.deepEqual(uHaloBox.value.toArray(), [GLOW_BOX.x0, GLOW_BOX.y0, GLOW_BOX.width, GLOW_BOX.height]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../scene/vendor/three.module.js';
import { createLogoGlow, GLOW } from '../scene/src/logo-glow.js';

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

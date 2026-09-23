import * as THREE from '../vendor/three.module.js';
import { LIGHTS } from './wall.js';
import { SHADER_TIME_WRAP } from './wind.js';

const additive = (uniforms, vertexShader, fragmentShader) => new THREE.ShaderMaterial({
  uniforms, vertexShader, fragmentShader,
  transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
});

// Warm light from the six downlights: a soft cone washing down the wall under each,
// a glow at each fixture, and a few dust motes drifting through the cones.
export function createLights(random) {
  const group = new THREE.Group();

  // Cones and glows: one quad each; the fragment shader shapes the light.
  const pos = [], centre = [], kind = [];
  const quad = (x0, y0, x1, y1, lx, ly, k) => {
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) {
      pos.push(x, -y, 0); centre.push(lx, ly); kind.push(k);
    }
  };
  for (const [lx, ly] of LIGHTS) {
    quad(lx - 190, ly, lx + 190, ly + 480, lx, ly, 0);
    quad(lx - 40, ly - 40, lx + 40, ly + 40, lx, ly, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCentre', new THREE.Float32BufferAttribute(centre, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const beams = new THREE.Mesh(g, additive({}, /* glsl */ `
    attribute vec2 aCentre; attribute float aKind;
    varying vec2 vWall, vCentre; varying float vKind;
    void main() {
      vWall = vec2(position.x, -position.y); vCentre = aCentre; vKind = aKind;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    }`, /* glsl */ `
    varying vec2 vWall, vCentre; varying float vKind;
    void main() {
      vec2 d = vWall - vCentre;
      float i;
      if (vKind < 0.5) {
        float width = 24.0 + d.y * 0.3;
        i = exp(-1.6 * (d.x / width) * (d.x / width)) * exp(-d.y / 240.0) * smoothstep(0.0, 30.0, d.y) * 0.2;
      } else {
        float r = length(d);
        i = exp(-(r / 8.0) * (r / 8.0)) * 0.8 + exp(-(r / 26.0) * (r / 26.0)) * 0.22;
      }
      gl_FragColor = vec4(vec3(1.0, 0.84, 0.6) * i, 1.0);
      #include <colorspace_fragment>
    }`));
  beams.renderOrder = 7;
  group.add(beams);

  // Dust: positions are a pure function of time, computed in the vertex shader.
  const motes = [];
  for (const [lx, ly] of LIGHTS) {
    for (let k = 0; k < 3; k++) {
      motes.push(lx + random.range(-60, 60), ly + random.range(30, 60), random.range(9, 16), random.range(0, 16), random.range(-25, 25), random.range(0.9, 1.9));
    }
  }
  const mg = new THREE.BufferGeometry();
  const m = new Float32Array(motes);
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((m.length / 6) * 3), 3));
  const mb = new THREE.InterleavedBuffer(m, 6);
  mg.setAttribute('aMote', new THREE.InterleavedBufferAttribute(mb, 4, 0));
  mg.setAttribute('aMote2', new THREE.InterleavedBufferAttribute(mb, 2, 4));
  const moteUniforms = { uTime: { value: 0 }, uPxPerUnit: { value: 1 } };
  const dust = new THREE.Points(mg, additive(moteUniforms, /* glsl */ `
    uniform float uTime, uPxPerUnit;
    attribute vec4 aMote;    // x, y, period (s), phase (s)
    attribute vec2 aMote2;   // sideways drift, size
    varying float vAlpha;
    void main() {
      float u = fract((uTime + aMote.w) / aMote.z);
      vec2 p = vec2(aMote.x + aMote2.x * u, aMote.y + u * 110.0);
      vAlpha = sin(3.14159 * u) * 0.7;
      gl_PointSize = aMote2.y * 2.0 * uPxPerUnit;
      gl_Position = projectionMatrix * viewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
    }`, /* glsl */ `
    varying float vAlpha;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      gl_FragColor = vec4(vec3(1.0, 0.94, 0.84) * (1.0 - smoothstep(0.3, 1.0, r)) * vAlpha, 1.0);
      #include <colorspace_fragment>
    }`));
  dust.frustumCulled = false;
  dust.renderOrder = 8;
  group.add(dust);

  return {
    group,
    /** pxPerUnit: device pixels per wall unit, so motes keep their size on every screen. */
    update(t, pxPerUnit) { moteUniforms.uTime.value = t % SHADER_TIME_WRAP; moteUniforms.uPxPerUnit.value = pxPerUnit; },
  };
}

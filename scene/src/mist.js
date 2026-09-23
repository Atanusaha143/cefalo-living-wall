import * as THREE from '../vendor/three.module.js';
import { WALL_W, wallTop } from './wall.js';

export const MIST = { falling: 6, dryOver: 60, liftAt: 1.5 };

/** How wet the leaves look, `e` seconds after watering: up over 2 s, dry over 60 s. */
export function wetness(e) {
  if (e === null || e < 0) return 0;
  if (e < MIST.falling) return Math.min(1, e / 2);
  return Math.max(0, 1 - (e - MIST.falling) / MIST.dryOver);
}

// Fine mist released along the ceiling line for 6 s; it falls and fades before the pebbles.
export function createMist(random, count = 900) {
  const data = [];
  for (let i = 0; i < count; i++) {
    const x = random.range(0, WALL_W);
    data.push(x, wallTop(x), random.range(0, MIST.falling), random.range(110, 200), random.range(-10, 10), random.range(860, 975), random.range(2.5, 5), 0);
  }
  const g = new THREE.BufferGeometry();
  const buf = new THREE.InterleavedBuffer(new Float32Array(data), 8);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aStart', new THREE.InterleavedBufferAttribute(buf, 4, 0));   // x, y, delay, speed
  g.setAttribute('aPath', new THREE.InterleavedBufferAttribute(buf, 4, 4));    // drift, end y, size, -
  const uniforms = { uAge: { value: -1 }, uPxPerUnit: { value: 1 } };
  const points = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uAge, uPxPerUnit;
      attribute vec4 aStart, aPath;
      varying float vAlpha;
      void main() {
        float age = uAge - aStart.z;
        float y = aStart.y + age * aStart.w;
        vAlpha = age < 0.0 || y > aPath.y ? 0.0 : smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(aPath.y - 80.0, aPath.y, y)) * 0.45;
        gl_PointSize = aPath.z * uPxPerUnit;
        gl_Position = projectionMatrix * viewMatrix * vec4(aStart.x + aPath.x * age * 0.3, -y, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        if (vAlpha <= 0.0) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vec3(0.85, 0.93, 1.0) * (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.visible = false;
  let startedAt = null, lifted = false;
  return {
    points,
    water(t) { startedAt = t; lifted = false; },
    /** Returns this frame's wetness, and whether the leaves should get their lift now. */
    update(t, pxPerUnit) {
      const e = startedAt === null ? null : t - startedAt;
      points.visible = e !== null && e < MIST.falling + 7;
      uniforms.uAge.value = e ?? -1;
      uniforms.uPxPerUnit.value = pxPerUnit;
      const lift = e !== null && !lifted && e >= MIST.liftAt;
      if (lift) lifted = true;
      return { wet: wetness(e), lift };
    },
  };
}

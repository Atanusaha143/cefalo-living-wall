import * as THREE from '../vendor/three.module.js';
import { LOGO_BOX } from './wall.js';
import { LOGO_GLSL } from './photo-layer.js';

export const GLOW = { every: 11, sweep: 3.3 };   // s between sweeps; s a sweep takes

// Every 11 s a band of warm light travels along the letters, lighting a soft halo on
// the leaves around them. The letters themselves stay as the photo has them.
export function createLogoGlow(photo) {
  const pad = 50, { x0, y0, x1, y1 } = LOGO_BOX;
  const uniforms = { uPhoto: { value: photo }, uBand: { value: -1e4 } };
  const geometry = new THREE.PlaneGeometry(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vWall;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWall = vec2(w.x, -w.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${LOGO_GLSL}
      uniform float uBand;
      varying vec2 vWall;
      void main() {
        vec2 p = vWall;
        float band = exp(-pow((p.x - (p.y - 500.0) * 0.4 - uBand) / 70.0, 2.0));
        if (band < 0.01) discard;
        float halo = 0.0;
        for (int r = 1; r <= 3; r++) {
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.7853982 + float(r) * 0.4;
            halo += letterAt(p + float(r) * 5.0 * vec2(cos(a), sin(a)));
          }
        }
        halo = halo / 24.0 * (1.0 - letterAt(p));
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * band * halo * 0.6, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  mesh.position.set((x0 + x1) / 2, -(y0 + y1) / 2, 0);
  mesh.renderOrder = 9;
  return {
    mesh,
    update(t) {
      const u = ((t % GLOW.every) - (GLOW.every - GLOW.sweep)) / GLOW.sweep;
      mesh.visible = u >= 0 && u <= 1;
      uniforms.uBand.value = x0 - 330 + u * (x1 - x0 + 640);
    },
  };
}

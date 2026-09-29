import * as THREE from '../vendor/three.module.js';
import { LOGO_BOX } from './wall.js';
import { LOGO_GLSL } from './photo-layer.js';
import { LOGO_AREA, letterMask, areaTexture } from './logo-mask.js';

export const GLOW = { every: 11, sweep: 3.3 };   // s between sweeps; s a sweep takes
/** Where the glow draws, in wall units: the logo area (the logo box and 50 around it). */
export const GLOW_BOX = LOGO_AREA;
/** The halo's blur: three box blurs of this radius, near a Gaussian (sigma 5.5 units) gone by 15. */
export const HALO_BLUR = 5;

/** One box blur along rows (step 1) or columns (step width); outside the image is dark. */
function boxBlur(src, dst, width, height, radius, step) {
  const along = step === 1 ? width : height, lines = step === 1 ? height : width, stride = step === 1 ? width : 1;
  for (let l = 0; l < lines; l++) {
    for (let k = 0; k < along; k++) {
      let sum = 0;
      for (let j = Math.max(0, k - radius); j <= Math.min(along - 1, k + radius); j++) sum += src[l * stride + j * step];
      dst[l * stride + k * step] = sum / (2 * radius + 1);
    }
  }
}

/**
 * The halo's shape, made once at load: the letters as the shader reads them (letterAt: linear
 * blue from 0.70 to 0.80) blurred into a soft glow. `rgba`: the photo's pixels over GLOW_BOX,
 * one per wall unit. (It used to be sampled in the shader at 24 points 5, 10 and 15 units round
 * each pixel, which drew copies of the letters' outline: they seemed to shift as the band passed.)
 */
export function haloMask(rgba, width, height, radius = HALO_BLUR) {
  const a = letterMask(rgba, width, height), b = new Float32Array(width * height);
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(a, b, width, height, radius, 1);
    boxBlur(b, a, width, height, radius, width);
  }
  return a;
}


// Every 11 s a band of warm light travels along the letters, lighting a soft halo on
// the leaves around them. The letters themselves stay as the photo has them.
// halo: haloMask's result over GLOW_BOX, {data, width, height}; without it, no halo.
export function createLogoGlow(photo, halo = null) {
  const { x0, x1 } = LOGO_BOX, box = GLOW_BOX;
  const uniforms = {
    uPhoto: { value: photo }, uBand: { value: -1e4 }, uHalo: { value: areaTexture(halo, 0) },
    uHaloBox: { value: new THREE.Vector4(box.x0, box.y0, box.width, box.height) },
  };
  const geometry = new THREE.PlaneGeometry(box.width, box.height);
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
      uniform sampler2D uHalo;
      uniform vec4 uHaloBox;   // x0, y0, width, height (wall units)
      varying vec2 vWall;
      void main() {
        vec2 p = vWall;
        float band = exp(-pow((p.x - (p.y - 500.0) * 0.4 - uBand) / 70.0, 2.0));
        if (band < 0.01) discard;
        float halo = texture2D(uHalo, (p - uHaloBox.xy) / uHaloBox.zw).r * (1.0 - letterAt(p));
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * band * halo * 0.6, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  mesh.position.set(box.x0 + box.width / 2, -(box.y0 + box.height / 2), 0);
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

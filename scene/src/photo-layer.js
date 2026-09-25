import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H, WALL_TOP, WALL_BOTTOM, LOGO_BOX } from './wall.js';
import { shaderTime } from './wind.js';

// How fast the two noise octaves drift (texture turns per second). Each must complete
// a whole number of turns in SHADER_TIME_WRAP seconds (tested).
export const DRIFT_SPEEDS = { coarse: 0.0015, fine: 0.003, fineVertical: 0.0008 };
const D = DRIFT_SPEEDS;

// GLSL copy of wind.js (gustProfile/swayAt/gustAt). Keep in step with wind.js.
export const WIND_GLSL = /* glsl */ `
  uniform float uTime, uGustStart, uGustStrength;
  float smoothTo(float a, float b, float u) { return a + (b - a) * u * u * (3.0 - 2.0 * u); }
  float gustProfile(float tau) {
    if (tau <= 0.0 || tau >= 4.0) return 0.0;
    if (tau < 1.0) return smoothTo(0.0, 1.0, tau);
    if (tau < 2.0) return smoothTo(1.0, -0.45, tau - 1.0);
    if (tau < 3.0) return smoothTo(-0.45, 0.2, tau - 2.0);
    return smoothTo(0.2, 0.0, tau - 3.0);
  }
  float swayAt(float x, float phase) { return sin(6.2831853 * (uTime + phase - x / 1600.0 * 2.6) / 5.0); }
  float gustAt(float x, float delay) { return uGustStrength * gustProfile(uTime - uGustStart - x / 1600.0 * 2.4 - delay); }
`;

// Blue channel (linear) that marks the white logo letters; foliage has little blue.
export const LOGO_GLSL = /* glsl */ `
  uniform sampler2D uPhoto;
  vec2 uvOf(vec2 wall) { return vec2(wall.x / ${WALL_W.toFixed(1)}, 1.0 - wall.y / ${WALL_H.toFixed(1)}); }
  float letterAt(vec2 p) { return smoothstep(0.70, 0.80, texture2D(uPhoto, uvOf(p)).b); }
  bool nearLogo(vec2 p, float pad) {
    return p.x > ${LOGO_BOX.x0.toFixed(1)} - pad && p.x < ${LOGO_BOX.x1.toFixed(1)} + pad && p.y > ${LOGO_BOX.y0.toFixed(1)} - pad && p.y < ${LOGO_BOX.y1.toFixed(1)} + pad;
  }
`;

function noiseTexture(random, size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random.next() * 256);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// The photo as the backdrop. Inside the wall (not the ceiling, pebbles or logo) its
// texture lookup is nudged by a drifting noise field whose strength follows the wind,
// plus a small ripple around the cursor.
export function createPhotoLayer(photo, random) {
  const uniforms = {
    uPhoto: { value: photo }, uNoise: { value: noiseTexture(random) },
    uTime: { value: 0 }, uGustStart: { value: -1e4 }, uGustStrength: { value: 0 },
    uPointer: { value: new THREE.Vector2(-1e4, -1e4) }, uRipple: { value: 0 }, uStrength: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vWall;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWall = vec2(w.x, -w.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${WIND_GLSL}
      ${LOGO_GLSL}
      uniform sampler2D uNoise;
      uniform vec2 uPointer;
      uniform float uRipple, uStrength;
      varying vec2 vWall;
      float logoMask(vec2 p) {
        if (!nearLogo(p, 20.0)) return 0.0;
        float m = letterAt(p);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853982;
          m = max(m, letterAt(p + 7.0 * vec2(cos(a), sin(a))));
        }
        return m;
      }
      void main() {
        vec2 p = vWall;
        float wall = smoothstep(${WALL_TOP.toFixed(1)}, ${(WALL_TOP + 10).toFixed(1)}, p.y) * (1.0 - smoothstep(${(WALL_BOTTOM - 10).toFixed(1)}, ${WALL_BOTTOM.toFixed(1)}, p.y));
        float free = wall * (1.0 - logoMask(p));
        vec2 offset = vec2(0.0);
        if (free > 0.001) {
          float gust = gustAt(p.x, 0.0);
          float drift = uTime * ${D.coarse} + gust * 0.004;
          vec2 n = texture2D(uNoise, p / 3840.0 + vec2(drift, 0.0)).rg * 2.0 - 1.0;
          n += 0.5 * (texture2D(uNoise, p / 1280.0 + vec2(uTime * ${D.fine} + gust * 0.007, uTime * ${D.fineVertical})).rg * 2.0 - 1.0);
          offset = n * (3.0 + 1.5 * abs(swayAt(p.x, 0.0)) + 2.5 * abs(gust)) * uStrength;   // short of smearing at 1
          float d = distance(p, uPointer);
          if (uRipple > 0.001 && d < 60.0) {
            offset += (p - uPointer) / max(d, 1.0) * 3.0 * uRipple * (1.0 - d / 60.0) * sin(d * 0.3 - uTime * 9.0);
          }
          offset *= free;
        }
        gl_FragColor = texture2D(uPhoto, uvOf(p + offset));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), material);
  mesh.position.set(WALL_W / 2, -WALL_H / 2, 0);
  mesh.renderOrder = 0;
  let pokedAt = -1e4;
  return {
    mesh,
    /** The cursor moved over the wall at (x, y), time t. */
    poke(x, y, t) { uniforms.uPointer.value.set(x, y); pokedAt = t; },
    /** t: wind time; strength: the Motion setting's (the shimmer is capped near Energetic so the photo never smears). */
    update(t, gust, strength = 1) {
      uniforms.uStrength.value = Math.min(strength, 1.3);
      const { time, gustStart } = shaderTime(t, gust);
      uniforms.uTime.value = time;
      uniforms.uGustStart.value = gustStart;
      uniforms.uGustStrength.value = gust.strength;
      uniforms.uRipple.value = Math.exp(-Math.max(0, t - pokedAt) / 0.8);
    },
  };
}

import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H, WALL_TOP, WALL_BOTTOM, LOGO_BOX } from './wall.js';
import { shaderTime, GUST_STRENGTH } from './wind.js';
import { LOGO_AREA, areaTexture } from './logo-mask.js';

// How fast the two noise octaves drift (texture turns per second). Each must complete
// a whole number of turns in SHADER_TIME_WRAP seconds (tested).
export const DRIFT_SPEEDS = { coarse: 0.0015, fine: 0.003, fineVertical: 0.0008 };
const D = DRIFT_SPEEDS;
// How far the wind moves the photo (units): always, with the sway, with a gust; and the Motion
// setting's cap and the cursor's ripple.
const SWAY = { base: 3, sway: 1.5, gust: 2.5 }, MAX_STRENGTH = 1.3, RIPPLE = 3;
/** The farthest the photo can move: noise up to 1.5 on each axis, at full sway and the strongest
 *  gust, at the capped strength, plus the ripple. The logo's surroundings stay clear of it. */
export const SWAY_REACH = 1.5 * Math.SQRT2 * (SWAY.base + SWAY.sway + SWAY.gust * GUST_STRENGTH[1]) * MAX_STRENGTH + RIPPLE;

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

// Rain's overcast: up to 12 % darker and a little cooler; and snow's chill: cold, flat light,
// a little darker, bluer and less saturated. Shared with leaves.js.
export const OVERCAST_GLSL = /* glsl */ `
  uniform float uOvercast, uChill;
  vec3 overcast(vec3 colour) {
    colour *= mix(vec3(1.0), vec3(0.86, 0.88, 0.94), uOvercast);
    vec3 grey = vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722)));
    return mix(colour, grey, 0.15 * uChill) * mix(vec3(1.0), vec3(0.88, 0.92, 1.0), uChill);
  }
`;

// Snow settled on the photo: frost on the leaves where the frost map (frost-map.js) says snow
// catches, spreading as the cover deepens, and snow on the pebbles and the curb. Colours are
// linear, duller than the letters: frost sRGB (0.68, 0.71, 0.76), the pebbles' (0.74, 0.77, 0.81).
const SNOW_GLSL = /* glsl */ `
  uniform sampler2D uFrost;
  uniform float uCover;
  vec3 settled(vec3 c, vec2 p, vec2 swayed) {
    // The frost's grain moves with the photo, as the map does (the pebbles below never sway).
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722)), n = texture2D(uNoise, swayed / 384.0).b;
    float catches = texture2D(uFrost, swayed / vec2(${WALL_W.toFixed(1)}, ${WALL_H.toFixed(1)})).r;
    float frost = smoothstep(1.0 - uCover, 1.25 - uCover, catches * (0.8 + 0.4 * n)) * min(1.0, uCover / 0.05);
    c = mix(c, vec3(0.42, 0.46, 0.54) * (0.9 + 0.3 * sqrt(luma)), 0.92 * frost);
    // The pebbles: the gaps between the stones first, their tops last; an uneven top edge.
    float top = 988.0 + 12.0 * (texture2D(uNoise, vec2(p.x / 3000.0, 0.37)).r - 0.5);
    float band = smoothstep(top - 3.0, top + 3.0, p.y) * (1.0 - smoothstep(1022.0, 1026.0, p.y));
    float gaps = 1.0 - sqrt(luma), grain = texture2D(uNoise, p / 1000.0).a;   // pebble-sized patches
    float pebbles = band * smoothstep(1.0 - uCover, 1.3 - uCover, 0.6 * gaps + 0.4 * grain) * min(1.0, uCover / 0.05);
    float curb = smoothstep(1024.0, 1026.0, p.y) * (1.0 - smoothstep(1032.0, 1034.0, p.y)) * smoothstep(0.0, 0.2, uCover);
    return mix(c, vec3(0.51, 0.55, 0.62) * (0.9 + 0.2 * luma), 0.95 * max(pebbles, curb));
  }
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
// freedom: swayFreedom over LOGO_AREA, {data, width, height}: how freely the wind may move the
// photo near the letters (without it, as in tests, freely).
export function createPhotoLayer(photo, random, freedom = null) {
  const uniforms = {
    uPhoto: { value: photo }, uNoise: { value: noiseTexture(random) },
    uTime: { value: 0 }, uGustStart: { value: -1e4 }, uGustStrength: { value: 0 },
    uPointer: { value: new THREE.Vector2(-1e4, -1e4) }, uRipple: { value: 0 }, uStrength: { value: 1 },
    uOvercast: { value: 0 }, uChill: { value: 0 }, uCover: { value: 0 },
    uFreedom: { value: areaTexture(freedom, 1) }, uFrost: { value: areaTexture(null, 0) },
    uArea: { value: new THREE.Vector4(LOGO_AREA.x0, LOGO_AREA.y0, LOGO_AREA.width, LOGO_AREA.height) },
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
      ${OVERCAST_GLSL}
      uniform sampler2D uNoise, uFreedom;
      ${SNOW_GLSL}
      uniform vec2 uPointer;
      uniform float uRipple, uStrength;
      uniform vec4 uArea;   // the logo area: x0, y0, width, height (wall units)
      varying vec2 vWall;
      // How freely the wind may move the photo here: eased in round the letters (logo-mask.js).
      float freedomAt(vec2 p) {
        vec2 uv = (p - uArea.xy) / uArea.zw;
        return uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ? 1.0 : texture2D(uFreedom, uv).r;
      }
      void main() {
        vec2 p = vWall;
        float wall = smoothstep(${WALL_TOP.toFixed(1)}, ${(WALL_TOP + 10).toFixed(1)}, p.y) * (1.0 - smoothstep(${(WALL_BOTTOM - 10).toFixed(1)}, ${WALL_BOTTOM.toFixed(1)}, p.y));
        float free = wall * freedomAt(p);
        vec2 offset = vec2(0.0);
        if (free > 0.001) {
          float gust = gustAt(p.x, 0.0);
          float drift = uTime * ${D.coarse} + gust * 0.004;
          vec2 n = texture2D(uNoise, p / 3840.0 + vec2(drift, 0.0)).rg * 2.0 - 1.0;
          n += 0.5 * (texture2D(uNoise, p / 1280.0 + vec2(uTime * ${D.fine} + gust * 0.007, uTime * ${D.fineVertical})).rg * 2.0 - 1.0);
          offset = n * (${SWAY.base.toFixed(1)} + ${SWAY.sway.toFixed(1)} * abs(swayAt(p.x, 0.0)) + ${SWAY.gust.toFixed(1)} * abs(gust)) * uStrength;   // short of smearing at 1
          float d = distance(p, uPointer);
          if (uRipple > 0.001 && d < 60.0) {
            offset += (p - uPointer) / max(d, 1.0) * ${RIPPLE.toFixed(1)} * uRipple * (1.0 - d / 60.0) * sin(d * 0.3 - uTime * 9.0);
          }
          offset *= free;
        }
        gl_FragColor = texture2D(uPhoto, uvOf(p + offset));
        if (uCover > 0.0) gl_FragColor.rgb = settled(gl_FragColor.rgb, p, p + offset);
        gl_FragColor.rgb = overcast(gl_FragColor.rgb);
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
    /** Where snow settles on the leaves: frost-map.js's frostMap over the whole wall (until
     *  then, as in tests, no frost). */
    setFrost(frost) {
      uniforms.uFrost.value.dispose();
      uniforms.uFrost.value = areaTexture(frost, 0);
    },
    /** t: wind time; strength: the Motion setting's (the shimmer is capped at Lively's so the photo never smears);
     *  the sky: rain's overcast, snow's chill and how much snow has settled (cover); each 0..1. */
    update(t, gust, strength = 1, { overcast = 0, chill = 0, cover = 0 } = {}) {
      uniforms.uOvercast.value = overcast;
      uniforms.uChill.value = chill;
      uniforms.uCover.value = cover;
      uniforms.uStrength.value = Math.min(strength, MAX_STRENGTH);
      const { time, gustStart } = shaderTime(t, gust);
      uniforms.uTime.value = time;
      uniforms.uGustStart.value = gustStart;
      uniforms.uGustStrength.value = gust.strength;
      uniforms.uRipple.value = Math.exp(-Math.max(0, t - pokedAt) / 0.8);
    },
  };
}

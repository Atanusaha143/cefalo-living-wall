import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H, LIGHTS } from './wall.js';
import { SHADER_TIME_WRAP, gustAt, swayAt } from './wind.js';
import { impact, veil } from './rain-weather.js';

// Rain in front of the wall: streaks in three depths, water pouring off the roof's edge and
// splashes on the pebbles. Each drop's path is a function of time, worked out on the GPU;
// a drop shows while rain-weather.js's level is above its own threshold.
// Speeds are real rain's: the wall is about 3 m tall (1,067 units), a drop falls about 9 m/s,
// so it crosses in about a third of a second (far drops look slower). A streak is as long
// as its drop falls in one frame, like motion blur, so rain pours at 30 fps and at 15.
// Widths are wall units (about a point), so a streak looks the same on Retina and 1x.
export const DEPTHS = [   // share of the streaks, speed (units/s), opacity, width (wall units)
  { share: 0.50, speed: [1900, 2300], opacity: [0.02, 0.035], width: [0.7, 0.9] },
  { share: 0.32, speed: [2300, 2800], opacity: [0.03, 0.05], width: [0.9, 1.1] },
  { share: 0.18, speed: [2800, 3400], opacity: [0.045, 0.07], width: [1.1, 1.4] },
];
/** How a mode's drops fall (size: 0 drizzle, 0.5 steady, 1 monsoon). A drizzle is a veil of
 *  many fine drops (count: times the level's share) at a quarter of the speed, 1.3–2.4 m/s;
 *  light, they lean further in the same wind (lean: on its tangent) and drift with the air
 *  (drift: units). A monsoon's big drops are thicker and a little faster. */
export function dropScale(size) {
  const light = Math.min(1, size / 0.5), heavy = Math.max(0, (size - 0.5) / 0.5), fine = 1 - light;
  return {
    speed: 0.25 + 0.75 * light + 0.12 * heavy, width: 0.5 + 0.5 * light + 0.3 * heavy, alpha: 1 + 0.5 * fine,
    count: 1 + 1.4 * fine, lean: 1 + 0.6 * fine, drift: 8 * fine,
  };
}

// drips: drops a second from each point of the roof's edge once it is wet, however light the rain.
export const COUNTS = { streaks: 4500, streams: 22, beads: 28, rate: 36, drips: 0.2, splashes: 120, droplets: 3 };
const TOP = -60, BOTTOM = WALL_H + 60;     // streaks fall from above the view to below it
const LONGEST = 400;                        // units: a streak at 15 fps is at most this long
const BEAM = 31, PEBBLES = [985, 1025];    // the ceiling beam's lower edge; the pebble band
const FALL = PEBBLES[0] + 10 - BEAM;        // units the roof water falls
const f = (v) => v.toFixed(1);
const rad = (degrees) => (degrees * Math.PI) / 180;

// The rain's lean, one for the whole curtain: a little always, more as a gust passes. A gust
// front crosses the wall in 2.4 s (the leaves show it travel) but is far wider than the wall,
// so the rain leans as the gust blows on average across it: all at once, easing in and out.
const LEAN = { breeze: 6, sway: 3, gust: 20, most: 25 };   // degrees
const ACROSS = Array.from({ length: 9 }, (_, i) => (i * WALL_W) / 8);
/** Degrees, for the whole curtain; strength: the Motion level's (with the rain's boost). */
export function rainLean(t, gust, strength) {
  const g = ACROSS.reduce((sum, x) => sum + gustAt(x, t, gust.start, gust.strength), 0) / ACROSS.length;
  return Math.min(LEAN.most, Math.max(0, LEAN.breeze + strength * (LEAN.sway * swayAt(WALL_W / 2, t) + LEAN.gust * g)));
}

/** How far the roof water has blown sideways (units) once it has fallen `fallen` units in a
 *  wind that leans the rain `lean` degrees: slow near the edge, it bends out at once, then
 *  falls steeper as it speeds up, landing where a straight line would. GLSL copy: roofPath. */
export function roofPath(fallen, lean) {
  const d = Math.max(0, fallen);
  return Math.tan(rad(lean)) * (0.5 * d + 0.5 * Math.sqrt(d * FALL));
}
/** How widely its drops scatter (units per second of fall): the harder it blows, the more
 *  the water breaks up. GLSL copy: roofSpread. */
export function roofSpread(lean) {
  return 16 + 200 * Math.tan(rad(lean));
}

// The downlights' cones, the shape lights.js draws: a streak inside one is brighter and warmer.
const LIGHT_GLSL = /* glsl */ `
  uniform vec2 uLights[${LIGHTS.length}];
  float lightAt(vec2 p) {
    float sum = 0.0;
    for (int i = 0; i < ${LIGHTS.length}; i++) {
      vec2 d = p - uLights[i];
      if (d.y <= 0.0) continue;
      float width = 24.0 + d.y * 0.3;
      sum += exp(-1.6 * (d.x / width) * (d.x / width)) * exp(-d.y / 240.0) * smoothstep(0.0, 30.0, d.y);
    }
    return min(sum, 1.0);
  }
`;

const COMMON = /* glsl */ `
  ${LIGHT_GLSL}
  varying float vLight;
  uniform float uFall, uFallClock, uLevel, uPxPerUnit, uFrameDt, uDropSpeed, uDropWidth, uDropAlpha;
  // How much of the rain shows, how hard it hits (rain-weather.js's impact), the roof's drips
  // (chance per release), the leans (radians, the wind blows left to right) and a drizzle's drift.
  uniform float uShow, uImpact, uDrip, uLean, uRoofLean, uDrift;
  // Hash of two numbers in [0, 1); arguments kept small so 32-bit sin stays accurate.
  float hash2(float a, float b) { return fract(sin(mod(a, 289.0) * 12.9898 + mod(b, 289.0) * 78.233) * 43758.5453); }
  vec4 place(vec2 wall) { return projectionMatrix * viewMatrix * vec4(wall.x, -wall.y, 0.0, 1.0); }
  const vec4 HIDDEN = vec4(2.0, 2.0, 2.0, 1.0);   // outside the view: nothing is rasterised
`;

// Fragment side: the light is worked out per corner (lightAt, in the vertex shaders) and
// blended across each quad, which is the same to the eye and far cheaper than per pixel.
const COLOUR_GLSL = /* glsl */ `
  varying float vLight;
  vec3 rainColour(float alpha) {
    return mix(vec3(0.80, 0.86, 0.92), vec3(1.0, 0.92, 0.78), vLight) * alpha * (1.0 + 1.5 * vLight);
  }
`;

const STREAK_VERTEX = /* glsl */ `
  ${COMMON}
  attribute vec2 aCorner;   // across (-0.5..0.5), along (0 tail .. 1 head)
  attribute vec4 iDrop;     // seed, phase (0..1), speed, streak length per frame (about 1)
  attribute vec3 iLook;     // opacity, width (wall units), threshold
  varying float vAlpha, vAlong, vAcross;
  varying vec2 vWall;
  void main() {
    vAlpha = iLook.x * uDropAlpha * smoothstep(iLook.z, iLook.z + 0.04, uShow);
    if (vAlpha <= 0.0) { gl_Position = HIDDEN; return; }
    // The path's length is fixed, so a change of frame rate never moves the drops.
    // The streaks' own clock runs slower in a drizzle, so a mode change never moves them.
    float span = ${f(BOTTOM - TOP + LONGEST)}, len = clamp(iDrop.z * uDropSpeed * uFrameDt * iDrop.w, 6.0, ${f(LONGEST)});
    float cycles = uFallClock * iDrop.z / span + iDrop.y;
    float n = floor(cycles);
    float x0 = 2100.0 * hash2(iDrop.x, n);   // a new place on every fall
    float y = ${f(TOP)} + fract(cycles) * span;
    // A drizzle drifts with the air: neighbouring drops sway together, slowly (0 otherwise).
    float w1 = 0.011 * y + 0.7 * uFall + 0.004 * x0, w2 = 0.023 * y - 1.3 * uFall + 0.009 * x0 + 1.7;
    float drift = uDrift * (0.6 * sin(w1) + 0.4 * sin(w2));
    float bend = uDrift * (0.0066 * cos(w1) + 0.0092 * cos(w2));   // its slope along the fall
    vec2 dir = normalize(vec2(tan(uLean) + bend, 1.0));
    // Blown past one side it comes back in at the other, off screen, so any lean stays full.
    vec2 head = vec2(mod(x0 + (y - ${f(TOP)}) * tan(uLean) + drift, 2100.0) - 250.0, y);
    vec2 p = head - dir * len * (1.0 - aCorner.y) + vec2(dir.y, -dir.x) * aCorner.x * iLook.y * 2.0 * uDropWidth;
    vAlong = aCorner.y;
    vAcross = aCorner.x;
    vWall = p;
    vLight = lightAt(p);
    gl_Position = place(p);
  }`;

const STREAK_FRAGMENT = /* glsl */ `
  ${COLOUR_GLSL}
  varying float vAlpha, vAlong, vAcross;
  varying vec2 vWall;
  void main() {
    // Soft all round, like rain a little out of focus.
    float fade = smoothstep(0.0, 0.5, vAlong) * (1.0 - smoothstep(0.8, 1.0, vAlong)) * (1.0 - smoothstep(0.1, 0.5, abs(vAcross)));
    gl_FragColor = vec4(rainColour(vAlpha * fade), 1.0);
    #include <colorspace_fragment>
  }`;

// Water running off the roof's edge. Each stream hangs from the edge as a thin, faint
// ribbon with a shimmer running down it (longer, and breathing, the heavier the rain), then
// breaks into drops: released at a steady rate, gravity spreads them apart, and like the
// rain they reach the eye as blurred streaks. Streams sit unevenly along the edge and flow
// unevenly: in light rain only a few drip; in heavy rain most of them pour.
const STREAM_VERTEX = /* glsl */ `
  ${COMMON}
  attribute vec2 aCorner;
  attribute vec4 iBead;     // stream x, stream seed, drop k (0 = the newest; -1 = the ribbon), stream threshold
  varying float vAlpha, vRibbon, vSeed;
  varying vec2 vCorner;
  const float G = 3500.0, RATE = ${f(COUNTS.rate)}, FALL = ${f(FALL)};
  // Copies of rain.js's roofPath and roofSpread (lean in radians here).
  float roofPath(float fallen, float lean) { float d = max(fallen, 0.0); return tan(lean) * (0.5 * d + 0.5 * sqrt(d * FALL)); }
  float roofSpread(float lean) { return 16.0 + 200.0 * tan(lean); }
  void main() {
    float flow = smoothstep(iBead.w, iBead.w + 0.3, uImpact);
    float breathe = 0.5 + 0.5 * sin(uFall * (0.9 + 0.6 * fract(iBead.y)) + iBead.y);
    float breakAt = mix(10.0, 110.0, flow) * (0.75 + 0.5 * breathe);
    float a = uRoofLean, sway = 1.0 * sin(uFall * 2.3 + iBead.y);
    vRibbon = iBead.z < 0.0 ? 1.0 : 0.0;
    vSeed = iBead.y;
    if (iBead.z < 0.0) {
      vAlpha = 0.22 * smoothstep(0.15, 0.45, flow);
      if (vAlpha <= 0.0) { gl_Position = HIDDEN; return; }
      float y = ${f(BEAM)} + aCorner.y * breakAt;
      float w = mix(1.6, 0.7, aCorner.y) * (0.7 + 0.5 * flow);   // tapers as it stretches
      vec2 p = vec2(iBead.x + aCorner.y * sway + roofPath(y - ${f(BEAM)}, a) + aCorner.x * w, y);
      vCorner = aCorner;
      vLight = lightAt(p);
      gl_Position = place(p);
      return;
    }
    float fall = sqrt(2.0 * (${f(PEBBLES[0] + 10)} - ${f(BEAM)}) / G);
    float released = floor(uFall * RATE) - iBead.z;                     // which release this drop is
    float tau = uFall - released / RATE + (hash2(iBead.y, released + 9.0) - 0.5) * 0.8 / RATE;
    // A flowing stream keeps most of its releases; everywhere else the wet edge only drips.
    float keep = step(hash2(iBead.y, released), max(mix(0.15, 0.95, flow) * step(0.02, flow), uDrip));
    float y = ${f(BEAM)} + 0.5 * G * tau * tau, v = G * tau;
    vAlpha = tau > 0.0 && tau < fall && y > ${f(BEAM)} + breakAt * 0.9 ? 0.34 * keep * (1.0 - smoothstep(fall * 0.8, fall, tau)) : 0.0;
    if (vAlpha <= 0.0) { gl_Position = HIDDEN; return; }
    float spread = (hash2(iBead.y, released + 3.0) - 0.5) * roofSpread(a) * tau;
    float x = iBead.x + sway + spread + roofPath(y - ${f(BEAM)}, a);
    float width = mix(1.0, 2.2, hash2(iBead.y, released + 5.0));        // wall units
    float len = clamp(v * uFrameDt * 0.9, 6.0, ${f(LONGEST)});           // blurred like the rain
    vec2 dir = normalize(vec2(tan(a) * (0.5 + 0.25 * sqrt(FALL / max(y - ${f(BEAM)}, 4.0))), 1.0));   // along its bent path
    vec2 p = vec2(x, y) - dir * len * (1.0 - aCorner.y) + vec2(dir.y, -dir.x) * aCorner.x * width;
    vCorner = aCorner;
    vLight = lightAt(p);
    gl_Position = place(p);
  }`;

// Soft all round like the rain; the ribbon shimmers as water runs down it.
const STREAM_FRAGMENT = /* glsl */ `
  ${COLOUR_GLSL}
  uniform float uFall;
  varying float vAlpha, vRibbon, vSeed;
  varying vec2 vCorner;
  void main() {
    float across = 1.0 - smoothstep(0.15, 0.5, abs(vCorner.x));
    if (vRibbon > 0.5) {
      float shimmer = 0.65 + 0.35 * sin(vCorner.y * 22.0 - uFall * 38.0 + vSeed * 7.0);
      float along = 1.0 - smoothstep(0.6, 1.0, vCorner.y);
      gl_FragColor = vec4(rainColour(vAlpha * across * along * shimmer), 1.0);
    } else {
      float along = smoothstep(0.0, 0.6, vCorner.y) * (1.0 - smoothstep(0.85, 1.0, vCorner.y));
      gl_FragColor = vec4(rainColour(vAlpha * across * along), 1.0);
    }
    #include <colorspace_fragment>
  }`;

// A light grey mist drifting over the wall, a little thicker near the pebbles and under the
// ceiling. Drift speeds make whole turns per shader-time wrap, so the wrap is seamless.
const MIST_VERTEX = /* glsl */ `
  varying vec2 vWall;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWall = vec2(w.x, -w.y);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const MIST_FRAGMENT = /* glsl */ `
  uniform sampler2D uNoise;
  uniform float uFall, uOvercast, uVeil;
  varying vec2 vWall;
  void main() {
    vec2 p = vWall;
    float n = 0.6 * texture2D(uNoise, p / 900.0 + vec2(uFall * 0.004, uFall * 0.001)).r
            + 0.4 * texture2D(uNoise, p / 380.0 + vec2(uFall * 0.011, -uFall * 0.002)).g;
    float band = 0.6 + 0.5 * smoothstep(700.0, 1050.0, p.y) + 0.4 * (1.0 - smoothstep(60.0, 220.0, p.y));
    // A downpour's veil greys the whole view, a little unevenly (rain-weather.js's veil).
    gl_FragColor = vec4(vec3(0.72, 0.78, 0.82), uOvercast * (0.04 + 0.07 * n) * band + uVeil * (0.75 + 0.5 * n));
    #include <colorspace_fragment>
  }`;

const SPLASH_VERTEX = /* glsl */ `
  ${COMMON}
  attribute vec2 aCorner;
  attribute vec4 iSplash;   // seed, period (s), phase (0..1), threshold
  attribute vec3 iHop;      // sideways (-1..1), height (units), size (wall units)
  varying float vAlpha;
  varying vec2 vCorner, vWall;
  const float LIFE = 0.25, G = 600.0;
  void main() {
    float cycles = uFall / iSplash.y + iSplash.z, n = floor(cycles), tau = fract(cycles) * iSplash.y;
    float due = iSplash.w * (0.4 + 0.6 * hash2(iSplash.x, n));
    vAlpha = tau < LIFE ? 0.35 * (1.0 - tau / LIFE) * smoothstep(due, due + 0.04, uImpact) : 0.0;
    if (vAlpha <= 0.0) { gl_Position = HIDDEN; return; }
    vec2 base = vec2(1600.0 * hash2(iSplash.x, n + 3.0), mix(${f(PEBBLES[0])}, ${f(PEBBLES[1])}, hash2(iSplash.x, n + 5.0)));
    float up = sqrt(2.0 * G * iHop.y) * tau - 0.5 * G * tau * tau;
    vec2 p = base + vec2(iHop.x * 8.0 * tau / LIFE, -up) + vec2(aCorner.x, aCorner.y - 0.5) * iHop.z;
    vCorner = vec2(aCorner.x, aCorner.y - 0.5);
    vWall = p;
    vLight = lightAt(p);
    gl_Position = place(p);
  }`;

const SPLASH_FRAGMENT = /* glsl */ `
  ${COLOUR_GLSL}
  varying float vAlpha;
  varying vec2 vCorner, vWall;
  void main() {
    float round = 1.0 - smoothstep(0.3, 0.5, length(vCorner));
    gl_FragColor = vec4(rainColour(vAlpha * round), 1.0);
    #include <colorspace_fragment>
  }`;

function noiseTexture(random, size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random.next() * 256);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** A quad as instanced geometry: aCorner x across (-0.5..0.5), y along (0..1). */
function quads(count, attributes) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1], 2));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, size, values] of attributes) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(values), size));
  g.instanceCount = count;
  return g;
}

export function createRain(random) {
  const C = COUNTS;
  const drop = [], look = [];
  for (const d of DEPTHS) {
    for (let i = 0; i < Math.round(C.streaks * d.share); i++) {
      drop.push(random.range(0, 289), random.next(), random.range(...d.speed), random.range(0.8, 1.1));
      look.push(random.range(...d.opacity), random.range(...d.width), random.next());
    }
  }
  const bead = [];
  for (let i = 0; i < C.streams; i++) {
    // Uneven along the edge, and uneven in flow: a few pour early, most only in heavy rain.
    const x = ((i + random.range(0.02, 0.98)) / C.streams) * 1600, seed = random.range(0, 289), threshold = random.range(0, 0.8);
    bead.push(x, seed, -1, threshold);   // the ribbon
    for (let k = 0; k < C.beads; k++) bead.push(x, seed, k, threshold);
  }
  const splash = [], hop = [];
  for (let i = 0; i < C.splashes; i++) {
    const s = [random.range(0, 289), random.range(0.6, 1.6), random.next(), random.next()];
    for (let k = 0; k < C.droplets; k++) {
      splash.push(...s);
      hop.push(random.range(-1, 1), random.range(6, 14), random.range(1.2, 2.0));
    }
  }

  const uniforms = {
    uFall: { value: 0 }, uLevel: { value: 0 }, uPxPerUnit: { value: 1 }, uFrameDt: { value: 1 / 30 },
    uShow: { value: 0 }, uImpact: { value: 0 }, uDrip: { value: 0 }, uLean: { value: rad(6) }, uRoofLean: { value: rad(3.6) },
    uDrift: { value: 0 }, uVeil: { value: 0 },
    uFallClock: { value: 0 }, uSize: { value: 0.5 }, uDropSpeed: { value: 1 }, uDropWidth: { value: 1 }, uDropAlpha: { value: 1 },
    uLights: { value: LIGHTS.map(([x, y]) => new THREE.Vector2(x, y)) },
    uOvercast: { value: 0 }, uNoise: { value: noiseTexture(random) },
  };
  const layer = (geometry, vertexShader, fragmentShader, order, blending = THREE.AdditiveBlending) => {
    const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader, blending,
      // Wall y runs down and world y up, so the quads' winding flips: draw both sides.
      side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  };
  const group = new THREE.Group();
  group.add(
    layer(quads(drop.length / 4, [['iDrop', 4, drop], ['iLook', 3, look]]), STREAK_VERTEX, STREAK_FRAGMENT, 102),
    layer(quads(bead.length / 4, [['iBead', 4, bead]]), STREAM_VERTEX, STREAM_FRAGMENT, 101),
    layer(quads(C.splashes * C.droplets, [['iSplash', 4, splash], ['iHop', 3, hop]]), SPLASH_VERTEX, SPLASH_FRAGMENT, 100),
    layer(new THREE.PlaneGeometry(WALL_W, WALL_H), MIST_VERTEX, MIST_FRAGMENT, 99, THREE.NormalBlending),
  );
  group.children[3].position.set(WALL_W / 2, -WALL_H / 2, 0);
  group.visible = false;

  return {
    group,
    /** t: simulation time (drops fall at their own speed); windTime and gust: the wind's
     *  (for the lean); weather: rain-weather.js's at(t); strength: the Motion setting's;
     *  dt: this frame's length (0 for a frozen frame), which sets how long the streaks are. */
    update(t, windTime, gust, weather, strength, pxPerUnit, dt = 0) {
      if (dt > 0) uniforms.uFrameDt.value += (Math.min(dt, 0.1) - uniforms.uFrameDt.value) * 0.2;
      const drops = dropScale(weather.size ?? 0.5);
      uniforms.uSize.value = weather.size ?? 0.5;
      uniforms.uDropSpeed.value = drops.speed;
      uniforms.uDropWidth.value = drops.width;
      uniforms.uDropAlpha.value = drops.alpha;
      uniforms.uFallClock.value = (uniforms.uFallClock.value + dt * drops.speed) % SHADER_TIME_WRAP;
      group.visible = weather.level > 0;
      if (!group.visible) return;
      const lean = rainLean(windTime, gust, strength);
      uniforms.uFall.value = t % SHADER_TIME_WRAP;
      uniforms.uLevel.value = weather.level;
      uniforms.uShow.value = Math.min(1, weather.level * drops.count);
      uniforms.uImpact.value = impact(weather);
      uniforms.uDrip.value = (COUNTS.drips / COUNTS.rate) * (weather.wet ?? 1);
      uniforms.uLean.value = Math.min(rad(33), Math.atan(Math.tan(rad(lean)) * drops.lean));
      uniforms.uRoofLean.value = rad(0.6 * lean);
      uniforms.uDrift.value = drops.drift;
      uniforms.uVeil.value = veil(weather.level);
      uniforms.uOvercast.value = weather.overcast;
      uniforms.uPxPerUnit.value = pxPerUnit;
    },
  };
}

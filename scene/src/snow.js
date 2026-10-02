import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H, LIGHTS } from './wall.js';
import { SHADER_TIME_WRAP, GUST_CROSSING, shaderTime } from './wind.js';
import { LIGHT_GLSL, quads, noiseTexture } from './rain.js';
import { whiteout } from './snow-weather.js';

// Snow in front of the wall: flakes in three depths and a few close to the eye, the puffs of
// snow the leaves shed, and a faint haze (a white-out in a blizzard). Each flake's path is a
// function of time, worked out on the GPU; a flake shows while snow-weather.js's level is above
// its own threshold. Real snow falls about 1 m/s: the wall is about 3 m (1,067 units), so a
// flake takes 3–6 s to cross it (far ones look slower).
export const DEPTHS = [   // share of the flakes, size (wall units), fall speed (units/s), opacity
  { share: 0.50, size: [1.8, 2.8], speed: [110, 170], opacity: [0.45, 0.6] },
  { share: 0.35, size: [2.8, 4.5], speed: [170, 250], opacity: [0.6, 0.8] },
  { share: 0.15, size: [4.5, 7.5], speed: [250, 340], opacity: [0.7, 0.9] },
];
/** Close to the eye: large, faint, out-of-focus discs. */
export const CLOSE = { count: 200, size: [12, 24], speed: [380, 480], opacity: [0.12, 0.2] };
export const COUNTS = { flakes: 9800, puffs: 30, clumps: 14, powder: 4 };
/** How far each depth is carried by the wind, next to the middle depth: as far as it falls, so
 *  every depth leans at the same angle (the depths' mean speeds, over the middle's). */
export const CARRIED = [140 / 210, 1, 295 / 210, 430 / 210];
const TOP = -40, BOTTOM = WALL_H + 40;   // flakes fall from above the view to below it
export const SPAN = 2100;                 // flakes wrap across -250..1850, off screen either side
const PUFF_LIFE = 0.9, POWDER_LIFE = 0.5; // s
const BLUR = 0.33;                        // of a frame's travel: flakes stay dots, only a blizzard's streak
/** A blizzard's veil blows with the middle depth's carry (drift × carry), over noise this many
 *  units a period: exactly 7 periods each time the carry wraps (SPAN), so it never jumps. */
export const BLOWN = { drift: 1.6, scale: 480 };
const f = (v) => v.toFixed(1);

/** How a mode's flakes look (size: 0 Flurries, 0.5 Steady, 1 Blizzard): Flurries' are big,
 *  lazy and slow, a blizzard's small and fast, fluttering less. count: how many of the flakes
 *  show for the level, so how much snow there is follows the mode and not the flakes' size
 *  (Flurries cover a third to a half as much of the view as steady snow, a blizzard about
 *  three times as much: how far you can see through light, moderate and heavy snow). */
export function flakeScale(size) {
  const light = Math.min(1, size / 0.5), heavy = Math.max(0, (size - 0.5) / 0.5);
  return {
    size: 1.4 - 0.4 * light - 0.3 * heavy, speed: 0.7 + 0.3 * light + 0.5 * heavy, flutter: 1.3 - 0.3 * light - 0.5 * heavy,
    count: 0.18 + 0.23 * light + 0.64 * heavy,
  };
}

// The wind carries the snow. The breeze drifts the whole field sideways. A gust is air rushing
// past: its front crosses the wall as it does for the leaves, carries each flake downwind as it
// reaches it and eases off, never blowing it back (the leaves' gust springs back; air does not),
// and while it blows the snow swirls. motion: the Motion level's strength; storm: the mode's wind
// (snow-weather.js). Speeds are at the middle depth: the breeze's units/s, a gust's units per
// second of wind time (the wind's clock runs at the Motion level's speed); swirl in units.
export const WIND = { breeze: 20, breezeStorm: 140, gust: 40, gustStorm: 200, swirl: 10, swirlStorm: 30 };

/** The breeze's sideways speed (units/s). */
export function breezeSpeed(motion, storm) {
  return motion * (WIND.breeze + WIND.breezeStorm * storm);
}
/** A gust's sideways speed at its peak, for a gust of strength 1 (units per wind-second). */
export function gustSpeed(motion, storm) {
  return motion * (WIND.gust + WIND.gustStorm * storm);
}

const smooth = (u) => u * u * (3 - 2 * u);
/** How hard a gust's air blows (0..1 of its peak), tau wind-seconds after its front reached a
 *  point: it rises over a second and eases off over three. GLSL copy: gustAir. */
export function gustAir(tau) {
  if (tau <= 0 || tau >= 4) return 0;
  return tau < 1 ? smooth(tau) : 1 - smooth((tau - 1) / 3);
}
/** How far that air has carried a flake by then, in seconds at its peak speed (gustAir's
 *  integral): from 0 to GUST_DRIFT, only ever forward. GLSL copy: gustDrift. */
export function gustDrift(tau) {
  if (tau <= 0) return 0;
  if (tau < 1) return tau ** 3 - tau ** 4 / 2;
  if (tau < 4) { const u = (tau - 1) / 3; return 0.5 + 3 * (u - u ** 3 + u ** 4 / 2); }
  return 2;
}
export const GUST_DRIFT = gustDrift(4);

// GLSL copies of gustAir and gustDrift; keep in step. gustTau: the gust time at wall x, as wind.js's gustAt reads it.
const AIR_GLSL = /* glsl */ `
  uniform float uGustSpeed;   // the latest gust's peak speed × its strength (units per wind-second, middle depth)
  float smoothU(float u) { return u * u * (3.0 - 2.0 * u); }
  float gustAir(float tau) { if (tau <= 0.0 || tau >= 4.0) return 0.0; return tau < 1.0 ? smoothU(tau) : 1.0 - smoothU((tau - 1.0) / 3.0); }
  float gustDrift(float tau) {
    if (tau <= 0.0) return 0.0;
    if (tau < 1.0) return tau * tau * tau - 0.5 * tau * tau * tau * tau;
    if (tau < 4.0) { float u = (tau - 1.0) / 3.0; return 0.5 + 3.0 * (u - u * u * u + 0.5 * u * u * u * u); }
    return 2.0;
  }
  float gustTau(float x) { return uTime - uGustStart - x / ${WALL_W.toFixed(1)} * ${GUST_CROSSING.toFixed(1)}; }
`;

const COMMON = /* glsl */ `
  ${LIGHT_GLSL}
  uniform float uTime, uGustStart;   // the wind's time and its latest gust's start (wrapped: wind.js's shaderTime)
  ${AIR_GLSL}
  varying float vLight;
  // uWindRate: wind seconds per second (the Motion level's speed, the storm's too), for speeds on screen.
  uniform float uFall, uFallClock, uFallSpeed, uFrameDt, uShow, uSize, uFlutter, uSwirl, uWindRate;
  uniform vec4 uCarry, uCarrySpeed;   // per depth (far, middle, near, close): offset (units) and speed (units/s)
  float hash2(float a, float b) { return fract(sin(mod(a, 289.0) * 12.9898 + mod(b, 289.0) * 78.233) * 43758.5453); }
  vec4 place(vec2 wall) { return projectionMatrix * viewMatrix * vec4(wall.x, -wall.y, 0.0, 1.0); }
  const vec4 HIDDEN = vec4(2.0, 2.0, 2.0, 1.0);   // outside the view: nothing is rasterised
  float pick(vec4 v, float i) { return i < 0.5 ? v.x : i < 1.5 ? v.y : i < 2.5 ? v.z : v.w; }
`;

// Cool white, warmer and up to twice as bright in a downlight's cone (lightAt, per corner).
const COLOUR_GLSL = /* glsl */ `
  varying float vLight;
  vec3 snowColour() { return mix(vec3(0.92, 0.95, 1.0), vec3(1.0, 0.92, 0.78), vLight) * (1.0 + vLight); }
`;

const FLAKE_VERTEX = /* glsl */ `
  ${COMMON}
  attribute vec2 aCorner;   // across (-0.5..0.5), along (0..1)
  attribute vec4 iFall;     // seed, phase (0..1), speed (units/s), depth (0 far .. 3 close)
  attribute vec4 iLook;     // size (wall units), opacity, threshold, flutter (units)
  varying float vAlpha, vHalf;
  varying vec2 vLocal;
  void main() {
    vAlpha = iLook.y * smoothstep(iLook.z, iLook.z + 0.04, uShow);
    if (vAlpha <= 0.0) { gl_Position = HIDDEN; return; }
    float span = ${f(BOTTOM - TOP)};
    float cycles = uFallClock * iFall.z / span + iFall.y, n = floor(cycles);
    float y = ${f(TOP)} + fract(cycles) * span;
    float x0 = ${f(SPAN)} * hash2(iFall.x, n);   // a new place on every fall
    // It swings side to side as it tumbles, and drifts with its neighbours on the air.
    float period = 1.5 + 2.5 * hash2(iFall.x, 7.0);
    float swing = iLook.w * uFlutter * sin(6.2831853 * uFall / period + 6.2831853 * hash2(iFall.x, 3.0));
    float w1 = 0.006 * y + 0.35 * uFall + 0.003 * x0, w2 = 0.011 * y - 0.6 * uFall + 0.005 * x0 + 1.7;
    float drift = 20.0 * (0.6 * sin(w1) + 0.4 * sin(w2));
    float carried = pick(uCarry, iFall.w), k = pick(vec4(${CARRIED.map((c) => c.toFixed(4)).join(', ')}), iFall.w);
    float base = x0 + swing + drift + carried, sx = mod(base, ${f(SPAN)}) - 250.0;
    // A gust reaches the flake as its front crosses the wall and carries it downwind, easing off,
    // never back; while it blows, the snow swirls in eddies (neighbours together).
    float tau = gustTau(sx), air = gustAir(tau);
    vec2 swirl = uSwirl * air * vec2(sin(0.013 * sx + 0.009 * y + 1.7 * uTime), cos(0.011 * sx - 0.014 * y + 1.3 * uTime));
    vec2 centre = vec2(mod(base + k * (uGustSpeed * gustDrift(tau) + swirl.x), ${f(SPAN)}) - 250.0, y + k * swirl.y);
    // Motion blur, as a camera's shutter open a third of each frame: a flake that moves further
    // than its own size in that time (a blizzard's fastest) is drawn out into a short streak.
    vec2 velocity = vec2(pick(uCarrySpeed, iFall.w) + k * uGustSpeed * air * uWindRate, iFall.z * uFallSpeed);
    float size = iLook.x * uSize, len = max(size, length(velocity) * uFrameDt * ${BLUR.toFixed(2)});
    vec2 dir = normalize(velocity), across = vec2(dir.y, -dir.x);
    vec2 p = centre + dir * (aCorner.y - 0.5) * len + across * aCorner.x * size;
    vHalf = (len - size) / len * 0.5;   // the streak's straight part, as a share of its length
    vLocal = vec2(aCorner.x, aCorner.y - 0.5);
    // A streak spreads the flake's light along its length; it flickers faintly as it tumbles.
    vAlpha *= size / len * (0.8 + 0.2 * sin(6.2831853 * (0.5 + 1.5 * hash2(iFall.x, 5.0)) * uFall + iFall.x));
    vLight = lightAt(p);
    gl_Position = place(p);
  }`;

const FLAKE_FRAGMENT = /* glsl */ `
  ${COLOUR_GLSL}
  varying float vAlpha, vHalf;
  varying vec2 vLocal;
  void main() {
    // A soft capsule: round for a flake, drawn out along a streak; brighter at its core.
    float along = max(abs(vLocal.y) - vHalf, 0.0) / max(0.5 - vHalf, 1e-3);
    float d = length(vec2(along, vLocal.x * 2.0));
    float alpha = vAlpha * (1.0 - smoothstep(0.3, 1.0, d));
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(snowColour(), alpha);
    #include <colorspace_fragment>
  }`;

// A leaf's snow falling as it sheds it: clumps that fall and spread as they fade, and a faint
// powder that swells and fades. Each puff's origin, start and flick are written when it sheds.
const PUFF_VERTEX = /* glsl */ `
  ${COMMON}
  attribute vec2 aCorner;
  attribute vec4 iPuff;     // x, y (wall units), start (wrapped simulation time), amount (0..1)
  attribute vec2 iFlick;    // sideways push (units/s), which bit (0..13 clumps, 14.. powder)
  attribute vec3 iBit;      // spread (-1..1), size (wall units), rise (units/s)
  varying float vAlpha;
  varying vec2 vLocal;
  void main() {
    float tau = mod(uFall - iPuff.z, ${f(SHADER_TIME_WRAP)});
    bool powder = iFlick.y >= ${f(COUNTS.clumps)};
    float life = powder ? ${f(POWDER_LIFE)} : ${f(PUFF_LIFE)};
    // More snow, more clumps: 8 for a trace, all 14 for a full load.
    bool shown = powder || iFlick.y < 8.0 + 6.0 * iPuff.w;
    vAlpha = tau < life && shown ? (powder ? 0.15 : 0.8) * (1.0 - tau / life) : 0.0;
    if (vAlpha <= 0.0) { gl_Position = HIDDEN; return; }
    vec2 p = iPuff.xy;
    // The wind carries it off as it does the flakes (the middle depth): the breeze, and a gust's air.
    p.x += (uCarrySpeed.y + uGustSpeed * gustAir(gustTau(iPuff.x)) * uWindRate) * tau;
    float size = iBit.y;
    if (powder) {
      p += vec2(iBit.x * 8.0 + iFlick.x * 0.3 * tau, 40.0 * tau);
      size *= 0.6 + 1.6 * tau / life;
    } else {
      p += vec2((iBit.x * 22.0 + iFlick.x) * tau, iBit.z * tau + 450.0 * tau * tau);   // g = 900
    }
    vLocal = vec2(aCorner.x, aCorner.y - 0.5);
    p += vLocal * size;
    vLight = lightAt(p);
    gl_Position = place(p);
  }`;

const PUFF_FRAGMENT = /* glsl */ `
  ${COLOUR_GLSL}
  varying float vAlpha;
  varying vec2 vLocal;
  void main() {
    float alpha = vAlpha * (1.0 - smoothstep(0.2, 0.5, length(vLocal)));
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(snowColour(), alpha);
    #include <colorspace_fragment>
  }`;

// A faint cold haze, a little thicker near the pebbles, and a blizzard's white-out, patchy and
// blowing with the middle depth's snow (the carry and a gust's air), so gusts show in it as blowing snow.
const HAZE_VERTEX = /* glsl */ `
  varying vec2 vWall;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWall = vec2(w.x, -w.y);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const HAZE_FRAGMENT = /* glsl */ `
  uniform sampler2D uNoise;
  uniform float uFall, uHaze, uWhiteout, uTime, uGustStart;
  uniform vec4 uCarry;
  ${AIR_GLSL}
  varying vec2 vWall;
  void main() {
    vec2 p = vWall;
    float n = 0.6 * texture2D(uNoise, p / 900.0 + vec2(uFall * 0.003, uFall * 0.001)).r
            + 0.4 * texture2D(uNoise, p / 380.0 + vec2(uFall * 0.008, -uFall * 0.002)).g;
    float blowing = uCarry.y + uGustSpeed * gustDrift(gustTau(p.x));   // as far as the middle depth's snow has blown
    float blown = texture2D(uNoise, (p - vec2(blowing * ${BLOWN.drift.toFixed(1)}, 0.0)) / ${BLOWN.scale.toFixed(1)} + vec2(0.0, uFall * 0.004)).b;
    float haze = uHaze * (0.6 + 0.4 * n) * (0.7 + 0.6 * smoothstep(700.0, 1050.0, p.y));
    float veil = uWhiteout * (0.55 + 0.9 * blown * n);
    float alpha = min(0.4, haze + veil);
    gl_FragColor = vec4(mix(vec3(0.72, 0.78, 0.84), vec3(0.85, 0.88, 0.92), veil / max(haze + veil, 1e-4)), alpha);
    #include <colorspace_fragment>
  }`;

export function createSnow(random) {
  const C = COUNTS;
  const fall = [], look = [];
  DEPTHS.forEach((d, depth) => {
    for (let i = 0; i < Math.round(C.flakes * d.share); i++) {
      fall.push(random.range(0, 289), random.next(), random.range(...d.speed), depth);
      look.push(random.range(...d.size), random.range(...d.opacity), random.next(), random.range(3, 12));
    }
  });
  for (let i = 0; i < CLOSE.count; i++) {
    fall.push(random.range(0, 289), random.next(), random.range(...CLOSE.speed), 3);
    look.push(random.range(...CLOSE.size), random.range(...CLOSE.opacity), random.next(), random.range(3, 12));
  }
  const bits = C.clumps + C.powder, flick = [], bit = [];
  for (let p = 0; p < C.puffs; p++) {
    for (let k = 0; k < bits; k++) {
      flick.push(0, k);
      bit.push(random.range(-1, 1), k < C.clumps ? random.range(2, 4) : random.range(10, 18), random.range(-40, 10));
    }
  }

  const uniforms = {
    uTime: { value: 0 }, uGustStart: { value: -1e4 }, uGustStrength: { value: 0 },
    uFall: { value: 0 }, uFallClock: { value: 0 }, uFallSpeed: { value: 1 }, uFrameDt: { value: 1 / 30 }, uShow: { value: 0 },
    uSize: { value: 1 }, uFlutter: { value: 1 }, uGustSpeed: { value: 0 }, uSwirl: { value: 0 }, uWindRate: { value: 1 },
    uCarry: { value: new THREE.Vector4() }, uCarrySpeed: { value: new THREE.Vector4() },
    uHaze: { value: 0 }, uWhiteout: { value: 0 },
    uLights: { value: LIGHTS.map(([x, y]) => new THREE.Vector2(x, y)) },
    uNoise: { value: noiseTexture(random) },
  };
  const layer = (geometry, vertexShader, fragmentShader, order) => {
    const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      uniforms, vertexShader, fragmentShader, blending: THREE.NormalBlending,
      // Wall y runs down and world y up, so the quads' winding flips: draw both sides.
      side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false,
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  };
  const puffGeometry = quads(C.puffs * bits, [['iPuff', 4, new Float32Array(C.puffs * bits * 4).fill(-1e4)], ['iFlick', 2, flick], ['iBit', 3, bit]]);
  const puffAttr = puffGeometry.getAttribute('iPuff'), flickAttr = puffGeometry.getAttribute('iFlick');
  puffAttr.setUsage(THREE.DynamicDrawUsage);
  flickAttr.setUsage(THREE.DynamicDrawUsage);
  const group = new THREE.Group();
  group.add(
    layer(quads(fall.length / 4, [['iFall', 4, fall], ['iLook', 4, look]]), FLAKE_VERTEX, FLAKE_FRAGMENT, 105),
    layer(puffGeometry, PUFF_VERTEX, PUFF_FRAGMENT, 104),
    layer(new THREE.PlaneGeometry(WALL_W, WALL_H), HAZE_VERTEX, HAZE_FRAGMENT, 103),
  );
  group.children[2].position.set(WALL_W / 2, -WALL_H / 2, 0);
  group.visible = false;

  const started = new Float64Array(C.puffs).fill(-1e9);   // simulation time each puff started
  let now = 0, next = 0, lastGust = { start: -1e4, strength: 0 }, lastWindTime = null;
  const airborne = () => started.some((s) => now - s < PUFF_LIFE);

  return {
    group,
    /** How many puffs can start now (the others are still falling). */
    get freePuffs() { return started.filter((s) => now - s >= PUFF_LIFE).length; },
    /** Snow shed by leaves at simulation time t: [{ x, y, amount (0..1), flick (units/s sideways) }]. */
    shed(sheds, t) {
      now = t;
      for (const s of sheds) {
        let slot = -1;
        for (let k = 0; k < C.puffs && slot < 0; k++) {
          const i = (next + k) % C.puffs;
          if (now - started[i] >= PUFF_LIFE) slot = i;
        }
        if (slot < 0) return;
        next = (slot + 1) % C.puffs;
        started[slot] = t;
        for (let k = 0; k < bits; k++) {
          const i = slot * bits + k;
          puffAttr.array.set([s.x, s.y, t % SHADER_TIME_WRAP, s.amount], i * 4);
          flickAttr.array[i * 2] = s.flick;
        }
        puffAttr.addUpdateRange(slot * bits * 4, bits * 4);
        flickAttr.addUpdateRange(slot * bits * 2, bits * 2);
        puffAttr.needsUpdate = flickAttr.needsUpdate = true;
      }
      group.visible = group.visible || sheds.length > 0;
    },
    /** t: simulation time (flakes fall at their own speed); windTime and gust: the wind's
     *  (for the breeze and the gusts); weather: snow-weather.js's at(t); strength: the Motion
     *  level's; dt: this frame's length (0 for a frozen frame). */
    update(t, windTime, gust, weather, strength, pxPerUnit, dt = 0) {
      now = t;
      if (dt > 0) uniforms.uFrameDt.value += (Math.min(dt, 0.1) - uniforms.uFrameDt.value) * 0.2;
      const scale = flakeScale(weather.size ?? 0.5), storm = weather.storm ?? 0;
      uniforms.uFallClock.value = (uniforms.uFallClock.value + dt * scale.speed) % SHADER_TIME_WRAP;
      uniforms.uFallSpeed.value = scale.speed;
      // The carry: the breeze, and each gust once it has passed everywhere (it has by the time the
      // next one starts: gusts are at least 7 s apart, a front crosses in 2.4 s and blows for 4),
      // when its whole drift joins the carry as the shaders stop drawing it, so nothing jumps.
      // Each depth's offset wraps with the flakes' span.
      const breeze = breezeSpeed(strength, storm), push = gustSpeed(strength, storm);
      const passed = gust.start !== lastGust.start ? push * lastGust.strength * GUST_DRIFT : 0;
      if (gust.start !== lastGust.start) lastGust = gust;
      const carry = uniforms.uCarry.value, velocity = uniforms.uCarrySpeed.value;
      carry.fromArray(carry.toArray().map((c, d) => (c + (breeze * dt + passed) * CARRIED[d]) % SPAN));
      velocity.fromArray(CARRIED.map((k) => breeze * k));
      if (dt > 0 && lastWindTime !== null) uniforms.uWindRate.value += ((windTime - lastWindTime) / dt - uniforms.uWindRate.value) * 0.2;
      if (dt > 0) lastWindTime = windTime;
      group.visible = weather.level > 0 || airborne();
      if (!group.visible) return;
      const wrapped = shaderTime(windTime, gust);
      uniforms.uTime.value = wrapped.time;
      uniforms.uGustStart.value = wrapped.gustStart;
      uniforms.uGustStrength.value = gust.strength;
      uniforms.uFall.value = t % SHADER_TIME_WRAP;
      uniforms.uShow.value = Math.min(1, weather.level * scale.count);
      uniforms.uSize.value = scale.size;
      uniforms.uFlutter.value = scale.flutter;
      uniforms.uGustSpeed.value = push * gust.strength;
      uniforms.uSwirl.value = strength * (WIND.swirl + WIND.swirlStorm * storm);
      uniforms.uHaze.value = 0.05 * Math.min(1, (weather.size ?? 0.5) / 0.5) * Math.min(1, weather.level / 0.3);
      uniforms.uWhiteout.value = whiteout(weather);
    },
  };
}

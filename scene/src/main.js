import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H } from './wall.js';
import { coverFit, toWall } from './fit.js';
import { createRandom } from './random.js';
import { createWind, gustAt } from './wind.js';
import { createFrameLoop } from './frame-loop.js';
import { generateLeaves } from './leaf-layout.js';
import { createSprings } from './leaf-springs.js';
import { createButterflyBrain } from './butterfly-brain.js';
import { createPhotoLayer } from './photo-layer.js';
import { createLeaves } from './leaves.js';
import { createLights } from './lights.js';
import { createLogoGlow, haloMask } from './logo-glow.js';
import { LOGO_AREA, freedomOf, letterMask, letterDistance } from './logo-mask.js';
import { createButterflies } from './butterflies.js';
import { createRainWeather, stormBoost, knockCount, impact } from './rain-weather.js';
import { createRain } from './rain.js';
import { createSnowWeather, snowStorm } from './snow-weather.js';
import { createSnow } from './snow.js';
import { createSnowLoads, droopOf, LOADS } from './snow-loads.js';
import { frostMap } from './frost-map.js';
import { createMotionClock, DEFAULT_MOTION, MOTION_LEVELS } from './motion.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 7);
const FREEZE = params.has('t') ? Number(params.get('t')) : null;
const DEBUG = params.has('debug'), SMOKE = params.has('smoke');
const host = window.webkit?.messageHandlers?.wall;
const post = (message) => host?.postMessage(message);
const DIP = 4;          // degrees a leaf dips under a resting butterfly

// The bridge. The host (or browser input) may call these before the scene is ready;
// until then the latest values wait in `pending`.
let live = null;
// Rain modes: 0 Off, 1 Drizzle, 2 Steady, 3 Monsoon (true and false, from older hosts, mean Steady and Off).
// Snow modes: 0 Off, 1 Flurries, 2 Steady, 3 Blizzard.
const rainMode = (v) => (v === true ? 2 : Math.min(3, Math.max(0, Math.round(Number(v) || 0))));
const snowMode = (v) => Math.min(3, Math.max(0, Math.round(Number(v) || 0)));
// One weather at a time: a mode turns every other weather off; Off turns off only its own.
// A page asked for two at once (?rain=2&snow=1) is malformed and starts dry.
const only = (name, mode) => (mode ? { rain: 0, snow: 0, [name]: mode } : { [name]: 0 });
const asked = { rain: rainMode(params.get('rain')), snow: snowMode(params.get('snow')) };
const pending = {
  pointer: null, paused: false, maxFps: 30, motion: params.get('motion') ?? DEFAULT_MOTION,
  ...(asked.rain && asked.snow ? { rain: 0, snow: 0 } : asked),
};
function setWeather(name, mode) {
  Object.assign(pending, only(name, mode));
  live?.setWeather(pending.rain, pending.snow);
}
Object.assign(window, {
  wallSetPointer: (x, y) => (live ? live.pointer(x, y) : (pending.pointer = [x, y])),
  wallPointerOut: () => (live ? live.pointerOut() : (pending.pointer = null)),
  wallSetPaused: (paused) => (live ? live.setPaused(paused) : (pending.paused = Boolean(paused))),
  wallSetMaxFps: (fps) => (live ? live.setMaxFps(fps) : (pending.maxFps = fps)),
  wallSetMotion: (level) => (live ? live.setMotion(level) : (pending.motion = level)),
  wallSetRain: (mode) => setWeather('rain', rainMode(mode)),
  wallSetSnow: (mode) => setWeather('snow', snowMode(mode)),
});

/** The photo drawn small, for sampling leaf colours. */
function photoPixels(image, width = 400) {
  const height = Math.round((width * image.height) / image.width);
  const ctx = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** The photo's pixels over the logo area, one per wall unit (for the glow's halo and the wind's
 *  freedom round the letters). */
function logoPixels(image) {
  const { x0, y0, width, height } = LOGO_AREA, sx = image.width / WALL_W, sy = image.height / WALL_H;
  const ctx = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, x0 * sx, y0 * sy, width * sx, height * sy, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

// Smoke runs exercise the queue: these calls arrive before the scene exists.
if (SMOKE) {
  window.wallSetMaxFps(15); window.wallSetPaused(false);
  window.wallSetPointer(100, 100); window.wallPointerOut(); window.wallSetMotion(DEFAULT_MOTION);
  window.wallSetRain(pending.rain); window.wallSetSnow(pending.snow);
}

const loadTexture = (url) => new Promise((resolve, reject) => {
  new THREE.TextureLoader().load(url, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); },
    undefined, () => reject(new Error(`could not load ${url}`)));
});

async function boot() {
  const canvas = document.getElementById('wall');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const camera = new THREE.OrthographicCamera(0, WALL_W, 0, -WALL_H, -100, 100);
  const world = new THREE.Scene();
  const photo = await loadTexture('assets/wall.jpg');

  const random = createRandom(SEED);
  const wind = createWind(random);
  const clock = createMotionClock(pending.motion);   // the wind runs on the Motion setting's clock
  const logo = logoPixels(photo.image), area = (data) => ({ data, width: LOGO_AREA.width, height: LOGO_AREA.height });
  // How far each point round the logo is from the letters: the wind eases in there, snow never settles close.
  const letters = letterDistance(letterMask(logo, LOGO_AREA.width, LOGO_AREA.height), LOGO_AREA.width, LOGO_AREA.height);
  const photoLayer = createPhotoLayer(photo, random, area(freedomOf(letters)));
  const leafData = generateLeaves(random);
  const springs = createSprings(leafData);
  const leaves = createLeaves(leafData, photoPixels(photo.image), random, springs);
  const lights = createLights(random);
  const glow = createLogoGlow(photo, area(haloMask(logo, LOGO_AREA.width, LOGO_AREA.height)));
  const butterflies = createButterflies();
  const weather = createRainWeather(createRandom(SEED + 2));
  const rain = createRain(createRandom(SEED + 3));
  const drops = createRandom(SEED + 4);   // which leaves the raindrops knock
  const snowWeather = createSnowWeather(createRandom(SEED + 5));
  const snow = createSnow(createRandom(SEED + 6));
  const loads = createSnowLoads(leafData, createRandom(SEED + 7));   // the snow on each front leaf
  const brain = createButterflyBrain({
    random: createRandom(SEED + 1),
    perches: leafData.map((l, index) => ({ index, x: l.midX, y: l.midY })),
    perchPosition: (i) => leaves.midpoint(i),
  });
  world.add(photoLayer.mesh, leaves.group, butterflies.group, lights.group, glow.mesh, rain.group, snow.group);

  let fit = coverFit(innerWidth, innerHeight), pxPerUnit = 1;
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    fit = coverFit(innerWidth, innerHeight);
    pxPerUnit = (innerHeight * renderer.getPixelRatio()) / fit.h;
    Object.assign(camera, { left: fit.x0, right: fit.x0 + fit.w, top: -fit.y0, bottom: -(fit.y0 + fit.h) });
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  let now = { level: 0, wet: 0, overcast: 0 };   // this frame's rain
  let snowNow = snowWeather.at(0);                // and snow
  let frostMs = null;                             // how long the frost map took (made when snow first settles)
  let simTime = 0, cpuMs = 0, frameMs = 0, measure = false, drawn = 0, pointer = null, pointerCalls = 0;
  const onePixel = new Uint8Array(4);
  const held = new Map();                          // leaf index -> resting butterfly id
  function holdPerches() {
    const now = new Map(brain.flyers.filter((b) => b.state === 'resting').map((b) => [b.perch, b.id]));
    for (const i of held.keys()) if (!now.has(i)) { springs.setHold(i, 0); loads.shake(i); }   // taking off shakes the snow off
    for (const i of now.keys()) if (!held.has(i)) springs.setHold(i, DIP * Math.sign(leafData[i].angle || 1));
    held.clear();
    for (const [i, id] of now) held.set(i, id);
  }
  function simulate(dt, t) {
    simTime = t;
    now = weather.at(t);
    snowNow = snowWeather.at(t);
    if (frostMs === null && snowNow.cover > 0) {
      // Where snow settles on the photo's leaves, worked out once, the first time any settles.
      const start = performance.now(), small = photoPixels(photo.image, 800);
      photoLayer.setFrost(frostMap(small.data, small.width, small.height, area(letters)));
      frostMs = performance.now() - start;
      if (DEBUG) console.log(`DEBUG frost map ${frostMs.toFixed(1)} ms`);
    }
    // Rain and a blizzard bring wind: the wind's clock runs faster and the leaves sway harder.
    const rainWind = stormBoost(now.level), snowWind = snowStorm(snowNow);
    const storm = { speed: Math.max(rainWind.speed, snowWind.speed), strength: Math.max(rainWind.strength, snowWind.strength) };
    const windTime = clock.advance(dt * storm.speed), { strength } = clock;   // eased after a switch
    const sway = Math.min(2.2, strength * storm.strength);
    const gust = wind.current(windTime);
    springs.setStrength(strength);   // the cursor's pull stays the Motion level's
    // Raindrops knock leaves down and make them tremble, more the harder they hit (a drizzle's
    // fine drops not at all); the springs bring them back.
    const hit = impact(now);
    for (let k = knockCount(hit, dt, drops); k > 0; k--) {
      const i = drops.int(0, leafData.length - 1);
      springs.knock(i, drops.range(0.6, 1.8) * Math.sign(leafData[i].angle || 1));
    }
    springs.step(dt);
    // Snow on the leaves fills and melts; a leaf turning fast, a strong gust or a butterfly taking
    // off shakes it off in a puff, and the leaf springs up, lighter.
    const sheds = loads.update(dt, { cover: snowNow.cover, snowing: snowNow.level > 0 }, {
      angularSpeed: springs.vel, sway,
      gustAt: (i) => gustAt(leafData[i].x, windTime, gust.start, gust.strength, leafData[i].gustDelay),
    }, snow.freePuffs);
    leaves.update(windTime, gust, sway, { wet: Math.max(now.wet, snowNow.wet), overcast: now.overcast, pelt: hit, chill: snowNow.chill });
    snow.shed(sheds.map(({ leaf, amount, flick }) => {
      springs.knock(leaf, -LOADS.lift * droopOf(leafData[leaf].angle));
      const m = leaves.midpoint(leaf);
      return { x: m.x, y: m.y - 4, amount, flick: flick * 20 };
    }), t);
    brain.setSheltering(now.level > 0 || snowNow.level > 0);
    brain.tick(dt, pointer);
    holdPerches();
    photoLayer.update(windTime, gust, sway, { overcast: now.overcast, chill: snowNow.chill, cover: snowNow.cover });
    rain.update(t, windTime, gust, now, sway, pxPerUnit, dt);
    snow.update(t, windTime, gust, snowNow, strength, pxPerUnit, dt);
    lights.update(t, pxPerUnit);
    glow.update(t);
  }
  function draw(dt, t) {
    const start = performance.now();
    simulate(dt, t);
    leaves.applyBends();
    leaves.applySnow(loads);
    butterflies.update(brain.flyers);
    renderer.render(world, camera);
    cpuMs = performance.now() - start;
    if (measure) {
      // Reading one pixel back waits for the GPU, so this is the whole frame's cost.
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, onePixel);
      frameMs = performance.now() - start;
      measure = false;
    }
    drawn++;
  }
  const loop = createFrameLoop(draw);

  live = {
    pointer(px, py) {
      pointerCalls++;
      const p = toWall(fit, px, py, innerWidth, innerHeight);
      pointer = { x: p.x, y: p.y, inside: true };
      photoLayer.poke(p.x, p.y, clock.time);
      springs.setPointer(p.x, p.y, simTime);
    },
    pointerOut() { pointer = null; springs.pointerOut(); },
    setPaused: (paused) => loop.setPaused(paused),
    setMaxFps: (fps) => loop.setMaxFps(fps),
    setMotion: (level) => clock.set(level),
    /** The one weather (main.js's setWeather keeps the other at 0); rain melts snow faster. */
    setWeather(rainMode, snowMode) {
      weather.setMode(rainMode, simTime);
      snowWeather.setMode(snowMode, simTime);
      snowWeather.setRaining(rainMode > 0, simTime);
    },
  };
  // What the scene is doing, for the host's diagnostics dump (kill -USR1) and the smoke test.
  window.wallState = () => ({
    drawn, running: loop.running, maxFps: loop.maxFps, simTime: +simTime.toFixed(2), cpuMs: +cpuMs.toFixed(2),
    pointerCalls, pointer, bentLeaves: springs.activeCount, butterflies: brain.flyers.length,
    motion: clock.level.level, rain: { mode: weather.mode, level: +now.level.toFixed(2) },
    snow: { mode: snowWeather.mode, level: +snowNow.level.toFixed(2), cover: +snowNow.cover.toFixed(2) },
    view: [innerWidth, innerHeight, devicePixelRatio], fit,
  });
  /** Run the simulation from 0 to t without drawing, so a frozen frame shows what t would. */
  function fastForward(t) {
    for (let s = 1 / 30; s <= t; s += 1 / 30) simulate(1 / 30, s);
  }
  /** CEFALO's legibility in the frame just drawn: the median brightness (0–255) of the letters
   *  and of the ring of wall 6–30 units round them. Settled snow must not pale that ring. */
  function legibility() {
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const { x0, y0, width, height } = LOGO_AREA;
    const toPixel = (x, y) => [Math.floor(((x - fit.x0) / fit.w) * w), Math.floor(h - ((y - fit.y0) / fit.h) * h)];
    const [left, bottom] = toPixel(x0, y0 + height), [right, top] = toPixel(x0 + width, y0);
    const pw = right - left, ph = top - bottom, rgba = new Uint8Array(pw * ph * 4);
    gl.readPixels(left, bottom, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const onLetters = [], ring = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const d = letters[y * width + x];
      if (d > 0 && (d < 6 || d > 30)) continue;
      const [px, py] = toPixel(x0 + x + 0.5, y0 + y + 0.5);
      if (px < left || py < bottom || px >= right || py >= top) continue;
      const i = ((py - bottom) * pw + (px - left)) * 4;
      (d === 0 ? onLetters : ring).push(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]);
    }
    const median = (v) => Math.round(v.sort((a, b) => a - b)[v.length >> 1] ?? 0);
    return { letters: median(onLetters), ring: median(ring) };
  }
  return {
    renderer, loop, fastForward, legibility,
    get cpuMs() { return cpuMs; }, get frameMs() { return frameMs; }, get drawn() { return drawn; },
    measureNextFrame() { measure = true; },
  };
}

function smokeReport(renderer, legibility) {
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4), lum = [];
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
    gl.readPixels(Math.floor((w * i) / 8), Math.floor((h * j) / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    lum.push((0.3 * px[0] + 0.59 * px[1] + 0.11 * px[2]) / 255);
  }
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
  const logo = legibility();
  const bridge = ['wallSetPointer', 'wallPointerOut', 'wallSetPaused', 'wallSetMaxFps', 'wallSetMotion', 'wallSetRain', 'wallSetSnow'].every((f) => typeof window[f] === 'function');
  const diagnostics = typeof window.wallState === 'function' && window.wallState().drawn >= 1;
  const { motion = null, rain = null, snow = null } = diagnostics ? window.wallState() : {};
  console.log(`SMOKE ${JSON.stringify({ webgl2: gl instanceof WebGL2RenderingContext, bridge, diagnostics, motion, rain, snow, logo, mean, sd, nonBlank: mean > 0.03 && mean < 0.95 && sd > 0.02 })}`);
}

boot().then((stats) => {
  // Keep `stats` whole: its drawn/cpuMs are live getters (spreading would copy them once).
  const { renderer, loop, fastForward, legibility } = stats;
  if (!host) {
    addEventListener('pointermove', (e) => window.wallSetPointer(e.clientX, e.clientY));
    document.documentElement.addEventListener('pointerleave', () => window.wallPointerOut());
    addEventListener('keydown', (e) => {
      if (/^[1-3]$/.test(e.key)) { window.wallSetMotion(MOTION_LEVELS[e.key - 1].level); return; }   // Motion level, in menu order
      if (e.key === 'r' || e.key === 'R') { window.wallSetRain((pending.rain + 1) % 4); return; }   // Off → Drizzle → Steady → Monsoon
      if (e.key === 's' || e.key === 'S') { window.wallSetSnow((pending.snow + 1) % 4); return; }   // Off → Flurries → Steady → Blizzard
      if (e.code !== 'Space') return;
      e.preventDefault();
      pending.paused = !pending.paused;
      window.wallSetPaused(pending.paused);
    });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) pending.paused = true;
  }
  document.addEventListener('visibilitychange', () => loop.setHidden(document.hidden));
  live.setWeather(pending.rain, pending.snow);   // before a frozen frame fast-forwards
  if (FREEZE !== null) {
    // Frozen at one instant (?t=): keep redrawing it, so screenshots always have a frame.
    loop.setPaused(true);
    fastForward(FREEZE);
    loop.renderAt(FREEZE);
    if (SMOKE) smokeReport(renderer, legibility);
    const hold = () => { loop.renderAt(FREEZE); requestAnimationFrame(hold); };
    requestAnimationFrame(hold);
  } else {
    loop.setMaxFps(pending.maxFps);
    loop.setPaused(pending.paused);
    if (pending.pointer) window.wallSetPointer(...pending.pointer);
    loop.start();
  }
  if (DEBUG) {
    const panel = Object.assign(document.createElement('div'), { id: 'debug' });
    document.body.append(panel);
    let before = stats.drawn;
    setInterval(() => {
      stats.measureNextFrame();
      panel.textContent = `${stats.drawn - before} fps · ${stats.cpuMs.toFixed(1)} ms cpu · ${stats.frameMs.toFixed(1)} ms frame`;
      console.log(`DEBUG ${panel.textContent}`);
      before = stats.drawn;
    }, 1000);
  }
  post({ type: 'ready' });
}).catch((error) => {
  console.error(error);
  post({ type: 'failed', reason: String(error?.message ?? error) });
});

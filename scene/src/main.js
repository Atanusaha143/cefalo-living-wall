import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H } from './wall.js';
import { coverFit, toWall } from './fit.js';
import { createRandom } from './random.js';
import { createWind } from './wind.js';
import { createFrameLoop } from './frame-loop.js';
import { generateLeaves } from './leaf-layout.js';
import { createSprings } from './leaf-springs.js';
import { createButterflyBrain } from './butterfly-brain.js';
import { createPhotoLayer } from './photo-layer.js';
import { createLeaves } from './leaves.js';
import { createLights } from './lights.js';
import { createLogoGlow, haloMask } from './logo-glow.js';
import { LOGO_AREA, swayFreedom } from './logo-mask.js';
import { createButterflies } from './butterflies.js';
import { createRainWeather, stormBoost, knockCount, impact } from './rain-weather.js';
import { createRain } from './rain.js';
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
const rainMode = (v) => (v === true ? 2 : Math.min(3, Math.max(0, Math.round(Number(v) || 0))));
const pending = { pointer: null, paused: false, maxFps: 30, motion: params.get('motion') ?? DEFAULT_MOTION, rain: rainMode(params.get('rain')) };
Object.assign(window, {
  wallSetPointer: (x, y) => (live ? live.pointer(x, y) : (pending.pointer = [x, y])),
  wallPointerOut: () => (live ? live.pointerOut() : (pending.pointer = null)),
  wallSetPaused: (paused) => (live ? live.setPaused(paused) : (pending.paused = Boolean(paused))),
  wallSetMaxFps: (fps) => (live ? live.setMaxFps(fps) : (pending.maxFps = fps)),
  wallSetMotion: (level) => (live ? live.setMotion(level) : (pending.motion = level)),
  wallSetRain: (mode) => (live ? live.setRain(rainMode(mode)) : (pending.rain = rainMode(mode))),
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
  window.wallSetRain(pending.rain);
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
  const photoLayer = createPhotoLayer(photo, random, area(swayFreedom(logo, LOGO_AREA.width, LOGO_AREA.height)));
  const leafData = generateLeaves(random);
  const springs = createSprings(leafData);
  const leaves = createLeaves(leafData, photoPixels(photo.image), random, springs);
  const lights = createLights(random);
  const glow = createLogoGlow(photo, area(haloMask(logo, LOGO_AREA.width, LOGO_AREA.height)));
  const butterflies = createButterflies();
  const weather = createRainWeather(createRandom(SEED + 2));
  const rain = createRain(createRandom(SEED + 3));
  const drops = createRandom(SEED + 4);   // which leaves the raindrops knock
  const brain = createButterflyBrain({
    random: createRandom(SEED + 1),
    perches: leafData.map((l, index) => ({ index, x: l.midX, y: l.midY })),
    perchPosition: (i) => leaves.midpoint(i),
  });
  world.add(photoLayer.mesh, leaves.group, butterflies.group, lights.group, glow.mesh, rain.group);

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

  let now = { level: 0, wet: 0, overcast: 0 };   // this frame's weather
  let simTime = 0, cpuMs = 0, frameMs = 0, measure = false, drawn = 0, pointer = null, pointerCalls = 0;
  const onePixel = new Uint8Array(4);
  const held = new Map();                          // leaf index -> resting butterfly id
  function holdPerches() {
    const now = new Map(brain.flyers.filter((b) => b.state === 'resting').map((b) => [b.perch, b.id]));
    for (const i of held.keys()) if (!now.has(i)) springs.setHold(i, 0);
    for (const i of now.keys()) if (!held.has(i)) springs.setHold(i, DIP * Math.sign(leafData[i].angle || 1));
    held.clear();
    for (const [i, id] of now) held.set(i, id);
  }
  function simulate(dt, t) {
    simTime = t;
    now = weather.at(t);
    // The rain brings wind: it runs the wind's clock faster and sways the leaves harder.
    const storm = stormBoost(now.level);
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
    leaves.update(windTime, gust, now.wet, sway, now.overcast, hit);
    brain.setRaining(now.level > 0);
    brain.tick(dt, pointer);
    holdPerches();
    photoLayer.update(windTime, gust, sway, now.overcast);
    rain.update(t, windTime, gust, now, sway, pxPerUnit, dt);
    lights.update(t, pxPerUnit);
    glow.update(t);
  }
  function draw(dt, t) {
    const start = performance.now();
    simulate(dt, t);
    leaves.applyBends();
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
    setRain: (mode) => weather.setMode(mode, simTime),
  };
  // What the scene is doing, for the host's diagnostics dump (kill -USR1) and the smoke test.
  window.wallState = () => ({
    drawn, running: loop.running, maxFps: loop.maxFps, simTime: +simTime.toFixed(2), cpuMs: +cpuMs.toFixed(2),
    pointerCalls, pointer, bentLeaves: springs.activeCount, butterflies: brain.flyers.length,
    motion: clock.level.level, rain: { mode: weather.mode, level: +now.level.toFixed(2) },
    view: [innerWidth, innerHeight, devicePixelRatio], fit,
  });
  /** Run the simulation from 0 to t without drawing, so a frozen frame shows what t would. */
  function fastForward(t) {
    for (let s = 1 / 30; s <= t; s += 1 / 30) simulate(1 / 30, s);
  }
  return {
    renderer, loop, fastForward,
    get cpuMs() { return cpuMs; }, get frameMs() { return frameMs; }, get drawn() { return drawn; },
    measureNextFrame() { measure = true; },
  };
}

function smokeReport(renderer) {
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4), lum = [];
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
    gl.readPixels(Math.floor((w * i) / 8), Math.floor((h * j) / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    lum.push((0.3 * px[0] + 0.59 * px[1] + 0.11 * px[2]) / 255);
  }
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
  const bridge = ['wallSetPointer', 'wallPointerOut', 'wallSetPaused', 'wallSetMaxFps', 'wallSetMotion', 'wallSetRain'].every((f) => typeof window[f] === 'function');
  const diagnostics = typeof window.wallState === 'function' && window.wallState().drawn >= 1;
  const motion = diagnostics ? window.wallState().motion : null, rain = diagnostics ? window.wallState().rain : null;
  console.log(`SMOKE ${JSON.stringify({ webgl2: gl instanceof WebGL2RenderingContext, bridge, diagnostics, motion, rain, mean, sd, nonBlank: mean > 0.03 && mean < 0.95 && sd > 0.02 })}`);
}

boot().then((stats) => {
  // Keep `stats` whole: its drawn/cpuMs are live getters (spreading would copy them once).
  const { renderer, loop, fastForward } = stats;
  if (!host) {
    addEventListener('pointermove', (e) => window.wallSetPointer(e.clientX, e.clientY));
    document.documentElement.addEventListener('pointerleave', () => window.wallPointerOut());
    addEventListener('keydown', (e) => {
      if (/^[1-3]$/.test(e.key)) { window.wallSetMotion(MOTION_LEVELS[e.key - 1].level); return; }   // Motion level, in menu order
      if (e.key === 'r' || e.key === 'R') { pending.rain = (pending.rain + 1) % 4; window.wallSetRain(pending.rain); return; }   // Off → Drizzle → Steady → Monsoon
      if (e.code !== 'Space') return;
      e.preventDefault();
      pending.paused = !pending.paused;
      window.wallSetPaused(pending.paused);
    });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) pending.paused = true;
  }
  document.addEventListener('visibilitychange', () => loop.setHidden(document.hidden));
  if (pending.rain) window.wallSetRain(pending.rain);   // before a frozen frame fast-forwards
  if (FREEZE !== null) {
    // Frozen at one instant (?t=): keep redrawing it, so screenshots always have a frame.
    loop.setPaused(true);
    fastForward(FREEZE);
    loop.renderAt(FREEZE);
    if (SMOKE) smokeReport(renderer);
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

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
import { createLogoGlow } from './logo-glow.js';
import { createButterflies } from './butterflies.js';
import { createMist } from './mist.js';
import { createMotionClock, DEFAULT_MOTION } from './motion.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 7);
const FREEZE = params.has('t') ? Number(params.get('t')) : null;
const DEBUG = params.has('debug'), SMOKE = params.has('smoke');
const WATER_AT = params.has('water') ? Number(params.get('water')) : null;   // with ?t=, for checking the mist
const host = window.webkit?.messageHandlers?.wall;
const post = (message) => host?.postMessage(message);
const DIP = 4;          // degrees a leaf dips under a resting butterfly
const LIFT = 1.2;       // degrees per substep the mist lifts every leaf, once

// The bridge. The host (or browser input) may call these before the scene is ready;
// until then the latest values wait in `pending`.
let live = null;
const pending = { pointer: null, paused: false, maxFps: 30, water: false, motion: params.get('motion') ?? DEFAULT_MOTION };
Object.assign(window, {
  wallSetPointer: (x, y) => (live ? live.pointer(x, y) : (pending.pointer = [x, y])),
  wallPointerOut: () => (live ? live.pointerOut() : (pending.pointer = null)),
  wallWater: () => (live ? live.water() : (pending.water = true)),
  wallSetPaused: (paused) => (live ? live.setPaused(paused) : (pending.paused = Boolean(paused))),
  wallSetMaxFps: (fps) => (live ? live.setMaxFps(fps) : (pending.maxFps = fps)),
  wallSetMotion: (level) => (live ? live.setMotion(level) : (pending.motion = level)),
});

/** The photo drawn small, for sampling leaf colours. */
function photoPixels(image, width = 400) {
  const height = Math.round((width * image.height) / image.width);
  const ctx = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

// Smoke runs exercise the queue: these calls arrive before the scene exists.
if (SMOKE) {
  window.wallSetMaxFps(15); window.wallSetPaused(false);
  window.wallSetPointer(100, 100); window.wallPointerOut(); window.wallWater(); window.wallSetMotion(DEFAULT_MOTION);
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
  const photoLayer = createPhotoLayer(photo, random);
  const leafData = generateLeaves(random);
  const springs = createSprings(leafData);
  const leaves = createLeaves(leafData, photoPixels(photo.image), random, springs);
  const lights = createLights(random);
  const glow = createLogoGlow(photo);
  const mist = createMist(random);
  const butterflies = createButterflies();
  const brain = createButterflyBrain({
    random: createRandom(SEED + 1),
    perches: leafData.map((l, index) => ({ index, x: l.midX, y: l.midY })),
    perchPosition: (i) => leaves.midpoint(i),
  });
  world.add(photoLayer.mesh, leaves.group, butterflies.group, mist.points, lights.group, glow.mesh);

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
    const windTime = clock.advance(dt), { strength } = clock.level;
    const gust = wind.current(windTime);
    const { wet, lift } = mist.update(t, pxPerUnit);
    if (lift) leafData.forEach((l, i) => springs.impulse(i, -LIFT * Math.sign(l.angle || 1)));
    springs.setStrength(strength);
    springs.step(dt);
    leaves.update(windTime, gust, wet, strength);
    brain.tick(dt, pointer);
    holdPerches();
    photoLayer.update(windTime, gust, strength);
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
    water() { if (loop.running) mist.water(simTime); },
    setPaused: (paused) => loop.setPaused(paused),
    setMaxFps: (fps) => loop.setMaxFps(fps),
    setMotion: (level) => clock.set(level),
  };
  // What the scene is doing, for the host's diagnostics dump (kill -USR1) and the smoke test.
  window.wallState = () => ({
    drawn, running: loop.running, simTime: +simTime.toFixed(2), cpuMs: +cpuMs.toFixed(2),
    pointerCalls, pointer, bentLeaves: springs.activeCount, butterflies: brain.flyers.length,
    motion: clock.level.level,
    view: [innerWidth, innerHeight, devicePixelRatio], fit,
  });
  /** Run the simulation from 0 to t without drawing, so a frozen frame shows what t would. */
  function fastForward(t) {
    for (let s = 1 / 30; s <= t; s += 1 / 30) {
      if (WATER_AT !== null && s - 1 / 30 < WATER_AT && s >= WATER_AT) mist.water(s);
      simulate(1 / 30, s);
    }
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
  const bridge = ['wallSetPointer', 'wallPointerOut', 'wallWater', 'wallSetPaused', 'wallSetMaxFps', 'wallSetMotion'].every((f) => typeof window[f] === 'function');
  const diagnostics = typeof window.wallState === 'function' && window.wallState().drawn >= 1;
  const motion = diagnostics ? window.wallState().motion : null;
  console.log(`SMOKE ${JSON.stringify({ webgl2: gl instanceof WebGL2RenderingContext, bridge, diagnostics, motion, mean, sd, nonBlank: mean > 0.03 && mean < 0.95 && sd > 0.02 })}`);
}

boot().then((stats) => {
  // Keep `stats` whole: its drawn/cpuMs are live getters (spreading would copy them once).
  const { renderer, loop, fastForward } = stats;
  if (!host) {
    addEventListener('pointermove', (e) => window.wallSetPointer(e.clientX, e.clientY));
    document.documentElement.addEventListener('pointerleave', () => window.wallPointerOut());
    addEventListener('click', () => window.wallWater());
    addEventListener('keydown', (e) => {
      if (/^[1-5]$/.test(e.key)) { window.wallSetMotion(Number(e.key)); return; }   // Motion level
      if (e.code !== 'Space') return;
      e.preventDefault();
      pending.paused = !pending.paused;
      window.wallSetPaused(pending.paused);
    });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) pending.paused = true;
  }
  document.addEventListener('visibilitychange', () => loop.setHidden(document.hidden));
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
    if (pending.water) window.wallWater();
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

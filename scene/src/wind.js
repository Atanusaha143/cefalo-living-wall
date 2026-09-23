import { WALL_W } from './wall.js';

// The one wind that moves both the photographed leaves and the 3D leaves. photo-layer.js
// and leaves.js carry a GLSL copy of swayAt/gustAt; keep the three in step.
export const SWAY_PERIOD = 5;        // s
export const SWAY_CROSSING = 2.6;    // s for the breeze's phase to cross the wall
export const GUST_CROSSING = 2.4;    // s for a gust front to cross the wall
export const GUST_GAP = [7, 14];     // s between gust starts (lively; the user chose "much livelier")
export const GUST_STRENGTH = [0.6, 1.2];
// A gust at one point: rise, overshoot back, small rebound, settle. [time s, value]
const GUST_SHAPE = [[0, 0], [1, 1], [2, -0.45], [3, 0.2], [4, 0]];
export const GUST_LENGTH = GUST_SHAPE[GUST_SHAPE.length - 1][0];

// Shaders get time as 32-bit floats, which after days of uptime are too coarse for a
// smooth sway. They get time modulo this instead: a whole number of sway periods and
// of every noise-drift period in photo-layer.js (DRIFT_SPEEDS), so the wrap is seamless.
export const SHADER_TIME_WRAP = 10000;

/** Wrapped time for the shaders, and the gust start shifted by the same amount. */
export function shaderTime(t, gust) {
  const time = t % SHADER_TIME_WRAP;
  return { time, gustStart: gust.start - (t - time) };
}

const smooth = (a, b, u) => a + (b - a) * u * u * (3 - 2 * u);

/** Gust profile at `tau` seconds after the front reached a point; 0 outside [0, 4]. */
export function gustProfile(tau) {
  if (tau <= 0 || tau >= GUST_LENGTH) return 0;
  for (let i = 1; i < GUST_SHAPE.length; i++) {
    const [t1, v1] = GUST_SHAPE[i];
    if (tau <= t1) {
      const [t0, v0] = GUST_SHAPE[i - 1];
      return smooth(v0, v1, (tau - t0) / (t1 - t0));
    }
  }
  return 0;
}

/** Base breeze at wall x, time t (s), plus a per-leaf phase offset (s). In [-1, 1]. */
export function swayAt(x, t, phase = 0) {
  return Math.sin((2 * Math.PI * (t + phase - (x / WALL_W) * SWAY_CROSSING)) / SWAY_PERIOD);
}

/** Gust at wall x for a gust that started at `start` with `strength`; `delay` is per-leaf. */
export function gustAt(x, t, start, strength, delay = 0) {
  return strength * gustProfile(t - start - (x / WALL_W) * GUST_CROSSING - delay);
}

// Gust starts are drawn lazily from the seeded random, so the same seed gives the same
// weather. Gaps (>= 7 s) outlast a gust anywhere on the wall (at most ~6.95 s with leaf delays),
// so at most one gust is ever active and the shaders need only the latest one.
export function createWind(random, { firstGust = random.range(...GUST_GAP) } = {}) {
  const starts = [{ start: firstGust, strength: random.range(...GUST_STRENGTH) }];
  const ensure = (t) => {
    while (starts[starts.length - 1].start <= t) {
      const last = starts[starts.length - 1].start;
      starts.push({ start: last + random.range(...GUST_GAP), strength: random.range(...GUST_STRENGTH) });
    }
  };
  /** The latest gust that has started by time t, or a far-past dummy. */
  function current(t) {
    ensure(t);
    for (let i = starts.length - 1; i >= 0; i--) if (starts[i].start <= t) return starts[i];
    return { start: -1e4, strength: 0 };
  }
  return {
    current,
    sample(x, t, phase = 0, delay = 0) {
      const g = current(t);
      return { sway: swayAt(x, t, phase), gust: gustAt(x, t, g.start, g.strength, delay) };
    },
    /** Gust starts up to time t, for tests. */
    startsUntil(t) { ensure(t); return starts.filter((g) => g.start <= t); },
  };
}

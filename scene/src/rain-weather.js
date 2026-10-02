import { createSwells } from './weather-swells.js';

// How hard it rains, how wet the leaves are and how overcast the scene is, over time.
// Pure and seeded: rain.js, leaves.js and photo-layer.js only draw what this decides.
// Times are simulation seconds; at(t) must be called with non-decreasing t.
export const RAIN = {
  buildUp: 6,            // s from dry to rain
  taper: 8,              // s from rain to dry
  ease: 3,               // s (time constant) for a change of mode to settle
  wetUp: 10,             // s for the leaves to get soaked
  dryOver: 60,           // s for them to dry once the rain has stopped
  swellStep: [15, 25],   // s between the swells' control values
  burstEvery: [180, 480],
  burstLength: [15, 40],
};

// The menu's modes (index = mode; 0 is Off). Each rains around its own base, with slow
// swells (±swell) and bursts (adding burst at their peak), never lighter than floor; size
// is its drops' (0 a drizzle's fine, slow specks, 1 a monsoon's big drops).
export const MODES = [
  null,
  { name: 'Drizzle', base: 0.3, swell: 0.08, burst: 0.15, floor: 0.18, overcast: 0.5, size: 0 },
  { name: 'Steady', base: 0.55, swell: 0.2, burst: 0.45, floor: 0.3, overcast: 0.8, size: 0.5 },
  { name: 'Monsoon', base: 0.85, swell: 0.1, burst: 0.3, floor: 0.7, overcast: 1, size: 1 },
];

// The rain brings wind: from a light rain up, the wind runs faster (more frequent gusts)
// and sways the leaves harder, on top of the Motion level.
export const STORM = { from: 0.2, speed: 0.6, strength: 1.0, knocks: 75 };

/** How much the rain livens the wind at this level: 1 when dry, up to 1.6× speed and 2× sway. */
export function stormBoost(level) {
  const s = Math.min(1, Math.max(0, (level - STORM.from) / (1 - STORM.from)));
  return { speed: 1 + STORM.speed * s, strength: 1 + STORM.strength * s };
}

/** How hard the drops hit (0..1): a drizzle's fine drops neither knock nor shake the leaves,
 *  splash nor run off the roof; from steady rain up, they hit as hard as it rains. */
export function impact({ level, size = 0.5 }) {
  return level * Math.min(1, Math.max(0, size / 0.5));
}

/** How thick the grey veil a downpour draws over the view is: none up to steady rain's
 *  heaviest, thickest (never opaque) at full. */
export function veil(level) {
  const u = Math.min(1, Math.max(0, (level - 0.6) / 0.4));
  return 0.22 * u * u * (3 - 2 * u);
}

/** How many leaves the drops knock in the next dt seconds, from how hard they hit (see
 *  impact): grows with its square, a few a second in light rain, dozens in a monsoon. */
export function knockCount(level, dt, random) {
  const expected = STORM.knocks * level * level * dt;
  return Math.floor(expected) + (random.next() < expected % 1 ? 1 : 0);
}

const STEP = 0.1;        // s; at(t) integrates in steps no longer than this

export function createRainWeather(random) {
  const R = RAIN;
  let now = 0, mode = 0, last = 2, ramp = 0, wet = 0, steady = 0, dim = 0, size = 0.5;
  const swells = createSwells(random, R);

  /** How hard the current (or, while it thins out, the last) mode rains at t. */
  function target(t) {
    const m = MODES[mode || last];
    return Math.min(1, Math.max(m.floor, m.base + m.swell * swells.swellAt(t) + m.burst * swells.burstAt(t)));
  }

  function advance(t) {
    while (now < t) {
      const dt = Math.min(STEP, t - now);
      ramp = mode ? Math.min(1, ramp + dt / R.buildUp) : Math.max(0, ramp - dt / R.taper);
      wet = ramp > 0 ? Math.min(1, wet + dt / R.wetUp) : Math.max(0, wet - dt / R.dryOver);
      const k = Math.min(1, dt / R.ease);
      steady += (target(now + dt) - steady) * k;
      dim += (MODES[mode || last].overcast - dim) * k;
      size += (MODES[mode || last].size - size) * k;
      now += dt;
    }
  }

  return {
    /** Rain mode from simulation time t: 0 Off, 1 Drizzle, 2 Steady, 3 Monsoon (clamped).
     *  It builds up, eases to the new mode or thins out from where it is. */
    setMode(next, t) {
      advance(t);
      const m = Math.min(MODES.length - 1, Math.max(0, Math.round(Number(next) || 0)));
      if (m && ramp === 0) { last = m; steady = target(t); dim = MODES[m].overcast; size = MODES[m].size; }   // starting dry
      if (m) last = m;
      mode = m;
    },
    get mode() { return mode; },
    /** This moment's weather: level (how hard it rains), wet, overcast and the drops' size; each 0..1. */
    at(t) {
      advance(t);
      return { level: ramp * Math.min(1, Math.max(0, steady)), wet, overcast: ramp * dim, size };
    },
    /** Swells and bursts held in memory (stays small over hours of rain). */
    get scheduled() { return swells.scheduled; },
  };
}

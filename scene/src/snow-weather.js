import { createSwells } from './weather-swells.js';
import { stormBoost, veil } from './rain-weather.js';

// How hard it snows, how much has settled, how cold the light is, and how wet the leaves are
// as it melts, over time. Pure and seeded: snow.js, snow-loads.js, leaves.js and
// photo-layer.js only draw what this decides. Times are simulation seconds; at(t) must be
// called with non-decreasing t.
export const SNOW = {
  buildUp: 8,            // s from none to snowing
  taper: 10,             // s from snowing to none
  ease: 3,               // s (time constant) for a change of mode to settle
  settle: 70,            // s (time constant) for the snow to settle to the mode's cover
  meltOver: 180,         // s for a full cover to melt once the snow has stopped
  rainMelt: 3,           // rain melts it this many times as fast
  wetUp: 10,             // s for melting snow to soak the leaves
  dryOver: 60,           // s for them to dry once it has gone
  swellStep: [15, 25],   // s between the swells' control values
  burstEvery: [180, 480],
  burstLength: [15, 40],
};

// The menu's modes (index = mode; 0 is Off). Each snows around its own base, with slow swells
// (±swell) and bursts (adding burst at their peak), never lighter than floor. cover: how much
// settles; chill: how cold the light turns; size: its flakes (0 Flurries' big, lazy ones, 1 a
// blizzard's small, fast ones); storm: how much wind it brings (1 a monsoon's).
export const SNOW_MODES = [
  null,
  { name: 'Flurries', base: 0.22, swell: 0.18, burst: 0.15, floor: 0.03, cover: 0.3, chill: 0.6, size: 0, storm: 0 },
  { name: 'Steady', base: 0.55, swell: 0.15, burst: 0.3, floor: 0.3, cover: 0.75, chill: 0.85, size: 0.5, storm: 0.2 },
  { name: 'Blizzard', base: 0.9, swell: 0.1, burst: 0.15, floor: 0.75, cover: 1, chill: 1, size: 1, storm: 1 },
];

/** The wind the snow brings, as rain-weather.js's stormBoost, scaled by the mode's storm:
 *  none in flurries, a monsoon's in a blizzard. */
export function snowStorm({ level, storm }) {
  const b = stormBoost(level);
  return { speed: 1 + (b.speed - 1) * storm, strength: 1 + (b.strength - 1) * storm };
}

/** How thick a blizzard's white-out is: a monsoon's veil, only for a blizzard's flakes. */
export function whiteout({ level, size }) {
  return veil(level) * Math.max(0, (size - 0.5) / 0.5);
}

const STEP = 0.1;        // s; at(t) integrates in steps no longer than this

export function createSnowWeather(random) {
  const S = SNOW;
  let now = 0, mode = 0, last = 2, ramp = 0, steady = 0, dim = 0, size = 0.5, storm = 0;
  let cover = 0, wet = 0, raining = false;
  const swells = createSwells(random, S);

  /** How hard the current (or, while it thins out, the last) mode snows at t. */
  function target(t) {
    const m = SNOW_MODES[mode || last];
    return Math.min(1, Math.max(m.floor, m.base + m.swell * swells.swellAt(t) + m.burst * swells.burstAt(t)));
  }

  function advance(t) {
    while (now < t) {
      const dt = Math.min(STEP, t - now), m = SNOW_MODES[mode || last];
      ramp = mode ? Math.min(1, ramp + dt / S.buildUp) : Math.max(0, ramp - dt / S.taper);
      // Settling follows the build-up, not the swells; lighter snow never takes any away.
      if (mode) cover = Math.max(cover, cover + (m.cover - cover) * ramp * (dt / S.settle));
      else cover = Math.max(0, cover - (dt / S.meltOver) * (raining ? S.rainMelt : 1));
      wet = !mode && cover > 0 ? Math.min(1, wet + dt / S.wetUp) : Math.max(0, wet - dt / S.dryOver);
      const k = Math.min(1, dt / S.ease);
      steady += (target(now + dt) - steady) * k;
      dim += (m.chill - dim) * k;
      size += (m.size - size) * k;
      storm += (m.storm - storm) * k;
      now += dt;
    }
  }

  return {
    /** Snow mode from simulation time t: 0 Off, 1 Flurries, 2 Steady, 3 Blizzard (clamped).
     *  It builds up, eases to the new mode or thins out from where it is. */
    setMode(next, t) {
      advance(t);
      const n = Math.min(SNOW_MODES.length - 1, Math.max(0, Math.round(Number(next) || 0)));
      if (n && ramp === 0) {   // starting from none: the new mode's own flakes and light
        last = n; steady = target(t);
        ({ chill: dim, size, storm } = SNOW_MODES[n]);
      }
      if (n) last = n;
      mode = n;
    },
    get mode() { return mode; },
    /** Whether it rains (from simulation time t): rain melts the snow faster. */
    setRaining(on, t) { advance(t); raining = Boolean(on); },
    /** This moment's snow: level (how hard it snows), cover (how much has settled), chill,
     *  the flakes' size, the wind it brings (storm) and how wet the melt leaves the leaves; each 0..1. */
    at(t) {
      advance(t);
      return { level: ramp * Math.min(1, Math.max(0, steady)), cover, chill: ramp * dim, size, storm, wet };
    },
    /** Swells and bursts held in memory (stays small over hours of snow). */
    get scheduled() { return swells.scheduled; },
  };
}

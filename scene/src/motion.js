// The Motion setting from the menu: how fast (speed) and how far (strength) the wall
// moves. Speed runs the wind on its own clock; strength scales leaf sway and gusts,
// the photo shimmer and the cursor's bend. Butterflies keep their own pace.
export const MOTION_LEVELS = [
  { name: 'Calm', speed: 0.7, strength: 0.35 },
  { name: 'Gentle', speed: 0.85, strength: 0.6 },
  { name: 'Lively', speed: 1, strength: 1 },
  { name: 'Energetic', speed: 1.3, strength: 1.3 },
  { name: 'Wild', speed: 1.6, strength: 1.6 },
];
export const DEFAULT_MOTION = 4;   // Energetic: the user found Lively slow

/** Level 1–5 (rounded, clamped; anything unreadable gives the default) and its values. */
export function motionLevel(level) {
  const n = level === null || level === undefined || level === '' ? NaN : Math.round(Number(level));
  const clamped = Number.isFinite(n) ? Math.min(MOTION_LEVELS.length, Math.max(1, n)) : DEFAULT_MOTION;
  return { level: clamped, ...MOTION_LEVELS[clamped - 1] };
}

/** The wind's clock: advances by real time × the current level's speed. */
export function createMotionClock(level = DEFAULT_MOTION) {
  let current = motionLevel(level), time = 0;
  return {
    set(next) { current = motionLevel(next); },
    advance(dt) { time += dt * current.speed; return time; },
    get time() { return time; },
    get level() { return current; },
  };
}

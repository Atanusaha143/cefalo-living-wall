// The Motion setting from the menu: how fast (speed) and how far (strength) the wall
// moves. Speed runs the wind on its own clock; strength scales leaf sway and gusts,
// the photo shimmer and the cursor's bend. Butterflies keep their own pace.
// Levels keep the numbers the five-level versions saved (Calm 1 … Wild 5): the hosts store
// them, and a saved 1 or 2 (Calm, Gentle) reads as Gentle.
export const MOTION_LEVELS = [
  { level: 3, name: 'Gentle', speed: 1, strength: 1 },
  { level: 4, name: 'Lively', speed: 1.3, strength: 1.3 },
  { level: 5, name: 'Wild', speed: 1.8, strength: 1.7 },   // a step up as clear as Gentle's to Lively
];
export const DEFAULT_MOTION = 4;   // Lively: the user found Gentle's pace slow as a default
const EASE = 0.3;                  // s: a new level's strength is ~95% there within a second

/** Level 3–5 (rounded, clamped; anything unreadable gives the default) and its values. */
export function motionLevel(level) {
  const n = level === null || level === undefined || level === '' ? NaN : Math.round(Number(level));
  const [first, last] = [MOTION_LEVELS[0].level, MOTION_LEVELS[MOTION_LEVELS.length - 1].level];
  const clamped = Number.isFinite(n) ? Math.min(last, Math.max(first, n)) : DEFAULT_MOTION;
  return MOTION_LEVELS.find((l) => l.level === clamped);
}

/** The wind's clock: advances by real time × the current level's speed. After a switch its
 *  strength eases to the new level's, so the leaves never jump to a new pose. */
export function createMotionClock(level = DEFAULT_MOTION) {
  let current = motionLevel(level), time = 0, strength = current.strength;
  return {
    set(next) { current = motionLevel(next); },
    advance(dt) {
      time += dt * current.speed;
      strength += (current.strength - strength) * (1 - Math.exp(-dt / EASE));
      return time;
    },
    get time() { return time; },
    get level() { return current; },
    get strength() { return strength; },
  };
}

// How hard a weather falls, around its base: slow swells and an occasional burst, so it
// never looks like a loop. Pure and seeded; rain-weather.js and snow-weather.js each keep
// their own. Times are simulation seconds; call with non-decreasing t.
const smooth = (u) => u * u * (3 - 2 * u);

/** steps: { swellStep, burstEvery, burstLength }, each [min, max] seconds. */
export function createSwells(random, { swellStep, burstEvery, burstLength }) {
  // Swells: control values in [-1, 1], eased between; bursts: start and length.
  const swells = [{ t: 0, v: random.range(-1, 1) }];
  const bursts = [];
  let nextBurst = random.range(...burstEvery);

  return {
    /** -1..1, easing from one control value to the next. */
    swellAt(t) {
      while (swells[swells.length - 1].t <= t) {
        const tail = swells[swells.length - 1];
        swells.push({ t: tail.t + random.range(...swellStep), v: random.range(-1, 1) });
      }
      while (swells.length > 2 && swells[1].t <= t) swells.shift();
      const [a, b] = swells;
      return a.v + (b.v - a.v) * smooth((t - a.t) / (b.t - a.t));
    },
    /** 0 → 1 → 0 over each burst, 0 between them. */
    burstAt(t) {
      while (nextBurst <= t) {
        bursts.push({ start: nextBurst, length: random.range(...burstLength) });
        nextBurst += random.range(...burstEvery);
      }
      while (bursts.length && bursts[0].start + bursts[0].length < t) bursts.shift();
      const b = bursts[0];
      if (!b || t < b.start) return 0;
      return 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - b.start)) / b.length);
    },
    /** Swells and bursts held in memory (stays small over hours). */
    get scheduled() { return swells.length + bursts.length; },
  };
}

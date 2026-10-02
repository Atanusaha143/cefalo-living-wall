// The snow on each front leaf: how much it holds, filling as it snows and melting with the
// cover, and when it sheds it (turning fast under the cursor, a strong gust, a butterfly
// taking off). Pure and seeded: leaves.js draws the loads, snow.js the puffs that fall.
// Angles are degrees clockwise from straight up, as in leaf-layout.js.
export const LOADS = {
  refill: 40,        // s for a bare leaf to fill up while it snows
  shedSpeed: 1.2,    // degrees per spring substep: turning faster than this shakes the snow off
  rest: 1,           // s after shedding before a leaf can shed again (it is still springing back)
  keep: 0.1,         // how much of its load a leaf keeps when it is shaken (the cursor, a butterfly)
  gustKeep: 0.5,     // and when a gust blows some off
  least: 0.05,       // less than this is too little to shed
  gustLoad: 0.3,     // only a leaf holding this much sheds in a gust
  gustFrom: 1.0,     // a gust sheds snow once gust × sway passes this...
  gustChance: 1.5,   // ...with this chance per second for each unit past it
  lift: 1.5,         // degrees per substep a leaf springs up by, rid of its load
  droop: 5,          // degrees a full load bends a leaf lying across towards the ground
};

const rad = (degrees) => (degrees * Math.PI) / 180;

/** How much snow a leaf can hold, 0.25 (pointing straight up or down) to 1 (lying across). */
export function holdOf(angle) {
  return 0.25 + 0.75 * Math.abs(Math.sin(rad(angle)));
}

/** Which way a load bends a leaf, as a bend sign: towards the ground (0 pointing up or down). */
export function droopOf(angle) {
  return Math.sign(Math.round(Math.sin(rad(angle)) * 1e6));
}

/** leaves: generateLeaves()'s; random: for the gusts' chances. */
export function createSnowLoads(leaves, random) {
  const n = leaves.length, load = new Float32Array(n), restUntil = new Float32Array(n);
  const hold = leaves.map((l) => holdOf(l.angle)), shaken = new Set(), dirty = new Set();
  let clock = 0;
  return {
    load,
    /**
     * Advance dt seconds. weather: { cover, snowing }; motion: { angularSpeed (the springs' vel),
     * gustAt(i) (the gust at leaf i), sway (the wind's strength) }; freePuffs: how many sheds
     * snow.js can show now. Returns the sheds: [{ leaf, amount, flick }].
     */
    update(dt, { cover, snowing }, { angularSpeed, gustAt, sway }, freePuffs) {
      clock += dt;
      const sheds = [];
      for (let i = 0; i < n; i++) {
        const most = cover * hold[i];
        // As stored (32-bit), so a full or bare leaf is not re-uploaded every frame.
        const next = Math.fround(snowing ? Math.min(most, load[i] + (most * dt) / LOADS.refill) : Math.min(load[i], most));
        if (next !== load[i]) { load[i] = next; dirty.add(i); }
        if (next < LOADS.least || clock < restUntil[i] || sheds.length >= freePuffs) continue;
        const gust = next >= LOADS.gustLoad
          && random.next() < LOADS.gustChance * Math.max(0, Math.abs(gustAt(i)) * sway - LOADS.gustFrom) * dt;
        const shake = shaken.has(i) || Math.abs(angularSpeed[i]) > LOADS.shedSpeed;
        if (!shake && !gust) continue;
        const keep = shake ? LOADS.keep : LOADS.gustKeep;
        sheds.push({ leaf: i, amount: next * (1 - keep), flick: angularSpeed[i] });
        load[i] = Math.fround(next * keep);
        restUntil[i] = clock + LOADS.rest;
        shaken.delete(i);
        dirty.add(i);
      }
      return sheds;
    },
    /** A butterfly took off from leaf i: it sheds its snow on the next update (once a puff is free). */
    shake(i) { if (load[i] >= LOADS.least) shaken.add(i); },
    /** Indices whose load changed since the last call. */
    takeDirty() { const out = [...dirty]; dirty.clear(); return out; },
  };
}

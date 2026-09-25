// Cursor physics for the front leaves: a leaf bends away from a nearby cursor, gets a
// flick when the cursor brushes past, and springs back with a little overshoot.
// Integrated in fixed 60 Hz substeps so it feels the same at any frame-rate cap.
// Strong and wide (the user chose "much livelier").
export const SPRING = { reach: 140, maxBend: 55, k: 0.08, damping: 0.87, clamp: 70, flick: 0.35, step: 1 / 60 };
const REST = 0.04;

export function createSprings(leaves, options = {}) {
  const P = { ...SPRING, ...options };
  const n = leaves.length;
  const angle = new Float32Array(n), vel = new Float32Array(n), hold = new Float32Array(n);
  const active = new Set(), dirty = new Set();
  const pointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, t: null };
  let carry = 0, strength = 1;   // the Motion setting's strength scales bend and flick

  // Spatial grid of leaf midpoints; cells as big as the reach, so 3x3 cells cover it.
  const grid = new Map();
  const key = (cx, cy) => cx * 100003 + cy;
  leaves.forEach((l, i) => {
    const k = key(Math.floor(l.midX / P.reach), Math.floor(l.midY / P.reach));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  function nearPointer() {
    const cx = Math.floor(pointer.x / P.reach), cy = Math.floor(pointer.y / P.reach);
    const found = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) found.push(...(grid.get(key(cx + i, cy + j)) ?? []));
    return found;
  }

  function substep() {
    if (pointer.inside) for (const i of nearPointer()) active.add(i);
    for (const i of active) {
      const l = leaves[i];
      let target = hold[i];
      if (pointer.inside) {
        const dx = l.midX - pointer.x, dy = l.midY - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < P.reach * P.reach) {
          const f = 1 - Math.sqrt(d2) / P.reach;
          const side = (pointer.x - l.x) * l.ux + (pointer.y - l.y) * l.uy;
          target += (side > 0 ? -1 : 1) * P.maxBend * strength * f * f;
          vel[i] += ((pointer.vx * l.ux + pointer.vy * l.uy) / 60) * P.flick * strength * f;
        }
      }
      vel[i] = (vel[i] + (target - angle[i]) * P.k) * P.damping;
      angle[i] = Math.max(-P.clamp, Math.min(P.clamp, angle[i] + vel[i]));
      dirty.add(i);
      if (target === 0 && Math.abs(angle[i]) < REST && Math.abs(vel[i]) < REST) {
        angle[i] = 0; vel[i] = 0; active.delete(i);
      }
    }
    pointer.vx *= 0.6; pointer.vy *= 0.6;
  }

  return {
    angle,
    /** Cursor at wall (x, y) at time t seconds. */
    setPointer(x, y, t) {
      if (pointer.inside && pointer.t !== null && t > pointer.t) {
        const dt = t - pointer.t;
        pointer.vx = 0.5 * pointer.vx + 0.5 * ((x - pointer.x) / dt);
        pointer.vy = 0.5 * pointer.vy + 0.5 * ((y - pointer.y) / dt);
      } else if (!pointer.inside) {
        pointer.vx = pointer.vy = 0;
      }
      Object.assign(pointer, { x, y, t, inside: true });
    },
    pointerOut() { Object.assign(pointer, { inside: false, vx: 0, vy: 0, t: null }); },
    /** Scale the cursor's bend and flick (the Motion setting's strength). */
    setStrength(s) { strength = s; },
    /** Keep a leaf bent by `degrees` (e.g. under a resting butterfly); 0 releases it. */
    setHold(i, degrees) { hold[i] = degrees; active.add(i); },
    step(dt) {
      carry += Math.min(dt, 0.25);
      while (carry >= P.step) { carry -= P.step; substep(); }
    },
    /** Indices whose angle changed since the last call. */
    takeDirty() { const out = [...dirty]; dirty.clear(); return out; },
    get activeCount() { return active.size; },
  };
}

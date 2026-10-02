import { EYES } from './wall.js';

// Where HR is looking. Pure and seeded: watcher.js only draws what this decides.
// Gaze is per eye, -1..1 on each axis (1 = as far right or down as the iris goes); lid is how
// closed the eyes are, 0 open to 1 shut. Positions are wall units (y down), times seconds.
export const GAZE = {
  reach: { x: 340, y: 220 },   // units from an eye at which it looks all the way round
  follow: 16,                  // 1/s: how fast the eyes catch up (a saccade, nearly)
  glance: [1.2, 3.8],          // s between glances when no one is about
  stare: 0.4,                  // chance a glance is straight at you
  blink: [2.5, 6.5],           // s between blinks
  doubleBlink: 0.2,
  blinkTime: 0.2,              // s, shut and open again
  squintAfter: 8,              // s the cursor sits still before HR gets suspicious
  squint: 0.42, squintRate: 1.6,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** One eye's gaze towards a point: the direction, easing to full a reach away. */
export function lookAt(eye, point, G = GAZE) {
  const dx = (point.x - eye.x) / G.reach.x, dy = (point.y - eye.y) / G.reach.y;
  const len = Math.hypot(dx, dy);
  return len > 1 ? { x: dx / len, y: dy / len } : { x: dx, y: dy };
}

/** A blink's lid, u from 0 to 1 over its time: shuts fast, opens a little slower. */
export function blinkLid(u) {
  if (u <= 0 || u >= 1) return 0;
  const v = u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6;
  return v * v * (3 - 2 * v);
}

export function createGaze(random, G = GAZE) {
  const eyes = EYES.map(() => ({ x: 0, y: 0, tx: 0, ty: 0 }));
  let nextGlance = random.range(...G.glance), nextBlink = random.range(...G.blink), blinkAt = -1e4;
  let last = null, stillSince = 0, squint = 0, lid = 0;

  function glance() {
    const stare = random.chance(G.stare);
    const x = stare ? 0 : random.range(-1, 1), y = stare ? 0.1 : random.range(-0.6, 0.8);
    for (const e of eyes) Object.assign(e, { tx: x, ty: y });
  }

  return {
    eyes,
    get lid() { return lid; },
    get squint() { return squint; },
    /** dt, t: seconds; pointer: {x, y} in wall units, or null when the cursor is off the wall. */
    step(dt, t, pointer) {
      if (pointer) {
        if (!last || Math.hypot(pointer.x - last.x, pointer.y - last.y) > 0.5) stillSince = t;
        last = { x: pointer.x, y: pointer.y };
        EYES.forEach((eye, i) => { const g = lookAt(eye, pointer, G); eyes[i].tx = g.x; eyes[i].ty = g.y; });
        nextGlance = t + random.range(...G.glance);
      } else {
        last = null;
        if (t >= nextGlance) { glance(); nextGlance = t + random.range(...G.glance); }
      }
      const k = 1 - Math.exp(-G.follow * dt);
      for (const e of eyes) { e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; }

      if (t >= nextBlink) {
        blinkAt = t;
        nextBlink = t + (random.chance(G.doubleBlink) ? G.blinkTime * 1.6 : random.range(...G.blink));
      }
      const suspicious = pointer && t - stillSince > G.squintAfter ? G.squint : 0;
      squint += (suspicious - squint) * (1 - Math.exp(-G.squintRate * dt));
      lid = clamp(Math.max(blinkLid((t - blinkAt) / G.blinkTime), squint), 0, 1);
    },
  };
}

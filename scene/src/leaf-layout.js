import { WALL_W, WALL_TOP, WALL_BOTTOM, inLogo, inFace } from './wall.js';

// Where the front leaves grow. Pure: the same random sequence gives the same wall.
// Angles are degrees clockwise from straight up, in wall units (y down).
export const LEAF_LENGTH = 44;       // stem base to tip, at scale 1
export const SHAPES = ['heart', 'lance', 'ovate'];
export const LAYOUT = {
  firstRow: 128, rowGap: [46, 58],
  pocketGap: [52, 96], occupancy: 0.9, perPocket: [1, 2, 2, 3],
  stem: [5, 16], scale: [0.55, 1.05], foreshorten: [0.5, 1.0],
  spread: 34, droop: 0.15, deep: 0.3,
};

const rad = (deg) => (deg * Math.PI) / 180;
const along = (x, y, angle, length) => ({ x: x + Math.sin(rad(angle)) * length, y: y - Math.cos(rad(angle)) * length });

export function generateLeaves(random, P = LAYOUT) {
  const leaves = [];
  for (let row = P.firstRow; row < WALL_BOTTOM - 12; row += random.range(...P.rowGap)) {
    for (let x = random.range(-30, 20); x < WALL_W + 30;) {
      x += random.range(...P.pocketGap);
      const px = x + random.range(-10, 10), py = row + random.range(-9, 9);
      if (!random.chance(P.occupancy) || inLogo(px, py, 30) || inFace(px, py, 10) || py < WALL_TOP + 30) continue;
      const count = random.pick(P.perPocket);
      for (let k = 0; k < count; k++) {
        let angle = random.gauss(0, P.spread);
        if (random.chance(P.droop)) angle = (random.chance(0.5) ? -1 : 1) * random.range(95, 140);
        if (py < WALL_TOP + 70) angle = Math.sign(angle || 1) * random.range(75, 140);
        const base = along(px, py, angle, random.range(...P.stem));
        const deep = random.chance(P.deep);
        const scale = random.range(...P.scale) * (deep ? 0.8 : 1);
        const mid = along(base.x, base.y, angle, LEAF_LENGTH * scale * 0.55);
        const tip = along(base.x, base.y, angle, LEAF_LENGTH * scale);
        if (inLogo(mid.x, mid.y, 12) || inLogo(tip.x, tip.y, 12)) continue;
        if (inFace(mid.x, mid.y) || inFace(tip.x, tip.y)) continue;   // nothing grows over HR's face
        if (tip.y < WALL_TOP + 6 || tip.y > WALL_BOTTOM + 6) continue;
        leaves.push({
          x: base.x, y: base.y, pocketX: px, pocketY: py,
          angle, scale, foreshorten: random.range(...P.foreshorten),
          shape: random.int(0, SHAPES.length - 1), deep,
          midX: mid.x, midY: mid.y, tipX: tip.x, tipY: tip.y,
          // Direction a positive (clockwise) bend moves the tip.
          ux: Math.cos(rad(angle)), uy: Math.sin(rad(angle)),
          swayAmp: random.range(6.6, 14.4) * (random.chance(0.5) ? 1 : -1),   // lively (user choice)
          swayPhase: random.range(0, 0.7),
          // Wind always pushes tips downwind: strongest for leaves pointing up or down.
          gustAmp: 30 * Math.cos(rad(angle)) * random.range(0.85, 1.2),
          gustDelay: (py / 1067) * 0.35 + random.range(0, 0.2),
        });
      }
    }
  }
  // Painter's order: deep leaves first, then row by row so lower rows overlap upper ones.
  return leaves.sort((a, b) => (a.deep === b.deep ? a.y - b.y : a.deep ? -1 : 1));
}

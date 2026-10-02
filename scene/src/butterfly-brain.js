import { WALL_W, WALL_TOP, WALL_BOTTOM, inLogo, LOGO_BOX } from './wall.js';

// Where the butterflies are and what they are doing. Pure and seeded: butterflies.js
// only draws what this decides. Positions are wall units (y down), headings radians.
export const BUTTERFLY = {
  firstVisit: [6, 12],     // s after start
  gap: [20, 90],           // s from one visit's exit to the next visit's entry
  pairChance: 0.25,
  rest: [6, 20],           // s on a leaf
  restsPerVisit: [1, 3],
  spiral: [3, 8],          // s a pair's follower circles the leader
  fleeRadius: 110,
  followChance: 0.5,
  logoMargin: 40,
  maxVisit: 150,           // s; a visit that runs longer is sent home
  speed: 150,              // units/s cruising
  species: ['orange', 'cream'],
};

const LOGO_CENTRE = { x: (LOGO_BOX.x0 + LOGO_BOX.x1) / 2, y: (LOGO_BOX.y0 + LOGO_BOX.y1) / 2 };

/** Whether a leaf midpoint is somewhere a butterfly may land. */
export function isPerch(x, y) {
  return x > 80 && x < WALL_W - 80 && y > WALL_TOP + 40 && y < WALL_BOTTOM - 40 && !inLogo(x, y, BUTTERFLY.logoMargin);
}

export function createButterflyBrain({ random, perches, perchPosition = (i) => perches.find((p) => p.index === i) }) {
  const B = BUTTERFLY;
  let clock = 0, nextId = 1;
  let nextVisit = random.range(...B.firstVisit);
  let visit = null, sheltering = false;
  const flyers = [];
  const log = { visits: [], landings: [] };
  const usable = perches.filter((p) => isPerch(p.x, p.y));

  // A point to fly through: clear of the logo, and within `reach` of `from` when given,
  // so flights stay short and most of a visit is spent resting.
  function waypoint(from = null, reach = 450) {
    for (let tries = 0; ; tries++) {
      const x = random.range(120, WALL_W - 120);
      const y = random.range(WALL_TOP + 60, 900);
      if (inLogo(x, y, B.logoMargin + 20)) continue;
      if (from && tries < 20 && Math.hypot(x - from.x, y - from.y) > reach) continue;
      return { x, y };
    }
  }

  function choosePerch(b, pointer) {
    const taken = new Set(flyers.filter((f) => f !== b && f.perch !== null).map((f) => f.perch));
    const ok = usable.filter((p) => !taken.has(p.index) &&
      !(pointer?.inside && Math.hypot(p.x - pointer.x, p.y - pointer.y) < B.fleeRadius + 30));
    const near = ok.filter((p) => Math.hypot(p.x - b.x, p.y - b.y) < 500);
    const pool = near.length ? near : ok;
    return pool.length ? random.pick(pool) : null;
  }

  function spawn(species, side, y, leader = null) {
    const b = {
      id: nextId++, species, side, leader,
      state: leader ? 'following' : 'wandering',
      x: side < 0 ? -40 : WALL_W + 40, y, vx: 0, vy: 0, heading: side < 0 ? 0 : Math.PI,
      flap: 1, flapPhase: random.range(0, 6.28), flutter: random.range(0, 6.28),
      waypoints: [waypoint({ x: side < 0 ? 0 : WALL_W, y })], perch: null, restUntil: 0,
      restsLeft: random.int(...B.restsPerVisit),
      spiralUntil: leader ? clock + random.range(...B.spiral) : 0, spiralAngle: 0,
    };
    flyers.push(b);
    return b;
  }

  function startVisit() {
    const pair = random.chance(B.pairChance);
    const side = random.chance(0.5) ? -1 : 1, y = random.range(150, 650);
    const first = random.pick(B.species);
    const leader = spawn(first, side, y);
    if (pair) spawn(B.species.find((s) => s !== first), side, y + 20, leader.id);
    visit = { start: clock, end: null, pair, ids: flyers.map((f) => f.id) };
  }

  function takeOff(b, away) {
    b.state = 'wandering';
    b.perch = null;
    b.restsLeft -= 1;
    const first = away
      ? { x: Math.min(WALL_W - 120, Math.max(120, b.x + away.x * 220)), y: Math.min(900, Math.max(WALL_TOP + 60, b.y + away.y * 220)) }
      : waypoint(b);
    b.waypoints = [first, ...(random.chance(0.25) ? [waypoint(first)] : [])];
  }

  function steer(b, target, dt, speed, turn) {
    const dx = target.x - b.x, dy = target.y - b.y, d = Math.hypot(dx, dy) || 1;
    const want = Math.max(25, speed * Math.min(1, d / 60));
    b.vx += ((dx / d) * want - b.vx) * Math.min(1, turn * dt);
    b.vy += ((dy / d) * want - b.vy) * Math.min(1, turn * dt);
    // Keep clear of the logo: push outwards while inside its margin.
    if (inLogo(b.x, b.y, B.logoMargin) && b.state !== 'exiting') {
      const ox = b.x - LOGO_CENTRE.x, oy = b.y - LOGO_CENTRE.y, o = Math.hypot(ox, oy) || 1;
      b.vx += (ox / o) * 400 * dt; b.vy += (oy / o) * 400 * dt;
    }
    // Butterflies zig-zag: a sideways flutter on top of the steering.
    b.flutter += dt * 2 * Math.PI * 2.2;
    const s = Math.hypot(b.vx, b.vy) || 1, wobble = Math.sin(b.flutter) * 55 * Math.min(1, d / 40);
    const mx = b.vx - (b.vy / s) * wobble, my = b.vy + (b.vx / s) * wobble;
    b.x += mx * dt; b.y += my * dt;
    b.heading = Math.atan2(my, mx);
    return d;
  }

  function update(b, dt, pointer) {
    if (b.state === 'resting') {
      const p = perchPosition(b.perch);
      b.x = p.x; b.y = p.y;
      b.flapPhase += (dt * 2 * Math.PI) / 2.1;
      b.flap = 1 - 0.55 * Math.max(0, Math.sin(b.flapPhase)) ** 6;
      if (clock >= b.restUntil) takeOff(b, null);
      return;
    }
    b.flapPhase += dt * 2 * Math.PI * 9;
    b.flap = 0.5 + 0.5 * Math.cos(b.flapPhase);
    if (b.state === 'following') {
      const leader = flyers.find((f) => f.id === b.leader);
      if (!leader || clock >= b.spiralUntil) { b.state = 'wandering'; return; }
      b.spiralAngle += dt * 2 * Math.PI * 0.9;
      steer(b, { x: leader.x + 28 * Math.cos(b.spiralAngle), y: leader.y + 28 * Math.sin(b.spiralAngle) }, dt, B.speed * 1.3, 6);
    } else if (b.state === 'wandering') {
      if (!b.waypoints.length) {
        const perch = b.restsLeft > 0 ? choosePerch(b, pointer) : null;
        if (perch) { b.state = 'approaching'; b.perch = perch.index; } else b.state = 'exiting';
        return;
      }
      if (steer(b, b.waypoints[0], dt, B.speed, 3) < 30) b.waypoints.shift();
    } else if (b.state === 'approaching') {
      const p = perchPosition(b.perch);
      if (steer(b, p, dt, B.speed, 4) < 4) {
        b.state = 'resting';
        b.restUntil = clock + random.range(...B.rest);
        b.vx = b.vy = 0;
        log.landings.push({ t: clock, x: p.x, y: p.y, perch: b.perch });
      }
    } else if (b.state === 'exiting') {
      steer(b, { x: b.x < WALL_W / 2 ? -80 : WALL_W + 80, y: b.y }, dt, B.speed, 3);
    }
  }

  function flee(pointer) {
    for (const b of flyers) {
      if (b.state !== 'resting' || Math.hypot(b.x - pointer.x, b.y - pointer.y) >= B.fleeRadius) continue;
      const d = Math.hypot(b.x - pointer.x, b.y - pointer.y) || 1;
      const away = { x: (b.x - pointer.x) / d, y: (b.y - pointer.y) / d };
      takeOff(b, away);
      const partner = flyers.find((f) => f !== b && f.state === 'resting');
      if (partner && random.chance(B.followChance)) takeOff(partner, away);
    }
  }

  return {
    flyers,
    log,
    get time() { return clock; },
    /** Rain or snow sends every butterfly home and keeps new ones away; after it, the next
     *  visit comes after the usual gap. */
    setSheltering(on) {
      if (Boolean(on) === sheltering) return;
      sheltering = Boolean(on);
      if (sheltering) for (const b of flyers) { b.state = 'exiting'; b.perch = null; }
      else nextVisit = Math.max(nextVisit, clock + random.range(...B.gap));
    },
    /** Advance by dt seconds. pointer: { x, y, inside } in wall units, or null. */
    tick(dt, pointer = null) {
      clock += dt;
      if (!visit && !sheltering && clock >= nextVisit) startVisit();
      if (pointer?.inside) flee(pointer);
      if (visit && clock - visit.start > B.maxVisit) {
        for (const b of flyers) if (b.state !== 'exiting') { b.state = 'exiting'; b.perch = null; }
      }
      for (const b of flyers) update(b, dt, pointer);
      for (let i = flyers.length - 1; i >= 0; i--) {
        const b = flyers[i];
        if (b.state === 'exiting' && (b.x < -60 || b.x > WALL_W + 60)) flyers.splice(i, 1);
      }
      if (visit && !flyers.length) {
        visit.end = clock;
        log.visits.push(visit);
        visit = null;
        nextVisit = clock + random.range(...B.gap);
      }
    },
  };
}

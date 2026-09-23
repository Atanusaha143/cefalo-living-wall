import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameLoop } from '../scene/src/frame-loop.js';

// A fake display: refreshes at `hz`, with timers, all on a virtual clock.
function display(hz = 120) {
  let clock = 0, nextId = 1;
  const frames = new Map(), timers = new Map();
  return {
    now: () => clock,
    requestFrame: (fn) => { const id = nextId++; frames.set(id, fn); return id; },
    cancelFrame: (id) => frames.delete(id),
    delay: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: clock + ms }); return id; },
    cancelDelay: (id) => timers.delete(id),
    /** Run the display for `ms` milliseconds. */
    run(ms) {
      const end = clock + ms, period = 1000 / hz;
      // Count refreshes as integers: stepping a float clock can stall on rounding.
      for (let n = Math.floor(clock / period) + 1; clock < end; n++) {
        clock = Math.min(end, n * period);
        for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); }
        const due = [...frames];
        frames.clear();
        for (const [, fn] of due) fn(clock);
      }
    },
    get waiting() { return frames.size + timers.size; },
  };
}

const counter = () => { const c = { frames: 0, dts: [] }; c.draw = (dt) => { c.frames++; c.dts.push(dt); }; return c; };

test('holds a 30 fps cap on a 120 Hz display', () => {
  const d = display(120), c = counter();
  const loop = createFrameLoop(c.draw, d);
  loop.setMaxFps(30);
  loop.start();
  d.run(10000);
  assert.ok(c.frames >= 290 && c.frames <= 301, `frames ${c.frames}`);
});

test('holds a 15 fps cap', () => {
  const d = display(120), c = counter();
  const loop = createFrameLoop(c.draw, d);
  loop.setMaxFps(15);
  loop.start();
  d.run(10000);
  assert.ok(c.frames >= 145 && c.frames <= 151, `frames ${c.frames}`);
});

test('paused or capped at 0 schedules nothing', () => {
  for (const stop of [(l) => l.setPaused(true), (l) => l.setMaxFps(0), (l) => l.setHidden(true)]) {
    const d = display(), c = counter();
    const loop = createFrameLoop(c.draw, d);
    loop.start();
    d.run(500);
    stop(loop);
    const before = c.frames;
    d.run(5000);
    assert.equal(c.frames, before);
    assert.equal(loop.pending, false);
    assert.equal(d.waiting, 0);
  }
});

test('simulation time does not jump on resume', () => {
  const d = display(), c = counter();
  const loop = createFrameLoop(c.draw, d);
  loop.start();
  d.run(1000);
  const t = loop.simTime;
  loop.setPaused(true);
  d.run(60000);
  loop.setPaused(false);
  d.run(40);
  assert.ok(loop.simTime - t < 0.1, `jumped ${loop.simTime - t}`);
  assert.ok(Math.max(...c.dts) <= 0.1);
});

test('renderAt draws once at the given time', () => {
  const d = display(), c = counter();
  const loop = createFrameLoop(c.draw, d);
  loop.setPaused(true);
  loop.renderAt(10);
  assert.equal(c.frames, 1);
  assert.equal(loop.simTime, 10);
});

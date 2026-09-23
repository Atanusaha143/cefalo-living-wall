// Drives drawing. Stopped (paused, capped at 0 fps, or hidden) means nothing is
// scheduled at all. Below the display's refresh rate it sleeps with a timer until
// just before the next frame is due, instead of waking on every refresh (the XDR
// display refreshes at 120 Hz). Simulation time only advances while running, so a
// resume never jumps.
export function createFrameLoop(draw, {
  now = () => performance.now(),
  requestFrame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (id) => cancelAnimationFrame(id),
  delay = (fn, ms) => setTimeout(fn, ms),
  cancelDelay = (id) => clearTimeout(id),
} = {}) {
  let maxFps = 30, paused = false, hidden = false;
  let raf = null, timer = null, last = null, due = 0, simTime = 0;
  const running = () => !paused && !hidden && maxFps > 0;

  function cancel() {
    if (raf !== null) cancelFrame(raf);
    if (timer !== null) cancelDelay(timer);
    raf = timer = null;
  }
  function schedule() {
    if (!running() || raf !== null || timer !== null) return;
    const wait = due - now() - 3;
    if (wait > 4) timer = delay(() => { timer = null; raf = requestFrame(frame); }, wait);
    else raf = requestFrame(frame);
  }
  function frame(ts) {
    raf = null;
    if (!running()) return;
    if (ts + 0.5 < due) { schedule(); return; }
    const dt = last === null ? 0 : Math.min(0.1, (ts - last) / 1000);
    last = ts;
    simTime += dt;
    const period = 1000 / maxFps;
    due = (due === 0 ? ts : due) + period; // a steady cadence...
    if (due <= ts) due = ts + period;      // ...that never catches up after a stall
    draw(dt, simTime);
    schedule();
  }
  function changed() { cancel(); last = null; due = 0; schedule(); }

  return {
    setMaxFps(n) { const v = Number.isFinite(n) && n > 0 ? Math.min(120, n) : 0; if (v !== maxFps) { maxFps = v; changed(); } },
    setPaused(v) { if (paused !== Boolean(v)) { paused = Boolean(v); changed(); } },
    setHidden(v) { if (hidden !== Boolean(v)) { hidden = Boolean(v); changed(); } },
    /** Draw one frame at a fixed simulation time, e.g. for ?t= and while stopped. */
    renderAt(t) { simTime = t; draw(0, t); },
    start() { schedule(); },
    get running() { return running(); },
    get pending() { return raf !== null || timer !== null; },
    get simTime() { return simTime; },
  };
}

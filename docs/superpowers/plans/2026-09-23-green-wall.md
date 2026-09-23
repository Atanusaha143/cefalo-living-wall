# Green Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live macOS desktop wallpaper of the Cefalo green wall: the photo with a subtle wind sway, 3D front leaves that sway, gust and bend away from the cursor, occasional butterflies, downlight glow, a logo light sweep, and a Water mist — idling the GPU when covered, locked or in Low Power Mode.

**Architecture:** A Three.js scene (`scene/`) that runs in any browser and knows nothing about macOS, plus a thin Swift host (`mac/`) that puts one click-through web view per display at the desktop window level, feeds it the cursor, and decides the frame-rate cap. They meet only at five `wall*` bridge functions. All behaviour worth testing (layout, wind, springs, butterflies, frame loop, fit, coverage) lives in pure modules tested without a GPU.

**Tech Stack:** Three.js 0.186.0 (vendored, WebGL2, GLSL `ShaderMaterial`s), plain ES modules, Node ≥ 20 built-in test runner (no npm dependencies), Swift 5 mode via `swiftc` from the Xcode command line tools (AppKit + WebKit), headless Google Chrome for smoke tests, shell scripts + a LaunchAgent for install.

**Spec:** `docs/superpowers/specs/2026-09-23-green-wall-design.md` — read it first, including **§9 Amendments** (private URL scheme, occlusion detection off, 30 %-from-top fit anchor, shader time wrap, `--check`).

**Status of the code below:** every file in this plan was written and run before the plan was saved: 59 unit tests pass, the smoke test passes at 1512×982 and 1920×1080, the Swift coverage test passes, and `Green Wall --check` passes in WebKit. The live wallpaper install (Task 16) has not been run — it changes the user's desktop picture and login items.

## Global Constraints

- **Git:** never run `git add`, `git commit`, `git push`, or anything that changes the index, branches or remotes. Each task ends by handing the user the exact commands to run (prefixed with `!`). No AI attribution anywhere (no Co-Authored-By, no "Generated with" lines).
- **Private:** the repo contains Cefalo's photo and logo. Never add a public remote, publish, or upload any of it.
- **Do not run** `mac/install.sh` or `mac/uninstall.sh` without the user's explicit go-ahead in that moment — they change the desktop picture and login items.
- **Location:** `~/CEFALO/cefalo-living-wall`. All paths below are relative to it.
- **Platforms:** macOS 13+; Swift via `swiftc -parse-as-library -swift-version 5` from the command line tools only (no Xcode, no XCTest); Node ≥ 20 (developed on 24); Google Chrome at `/Applications/Google Chrome.app` for smoke tests.
- **No dependencies:** no `npm install`, no packages. Three.js **0.186.0** is vendored as `scene/vendor/three.module.js` + `three.core.js` + `LICENSE` + `VERSION`.
- **Tests:** `npm test` = `node --test "tests/*.test.mjs"` (a directory argument does not work on Node 24).
- **Wall units:** 1600×1067, origin top-left, y down; angles in degrees clockwise from straight up. World (Three.js) coordinates are `(x, -y)`.
- **Constants (verbatim from spec §4.1):** logo box x 450–1145, y 425–578; downlights (255,57) (527,59) (795,64) (1066,73) (1330,82) (1590,87); ceiling edge y = 82 at x = 0 to y = 108 at x = 1600; wall bottom y = 980.
- **Bridge names (exact):** `wallSetPointer(x, y)`, `wallPointerOut()`, `wallWater()`, `wallSetPaused(paused)`, `wallSetMaxFps(n)`; page → host messages `{type: "ready"}`, `{type: "failed", reason}`, `{type: "log", level, message}` on `window.webkit.messageHandlers.wall`.
- **No network:** CSP `default-src 'self'`; the host serves the scene over `green-wall://local/`.
- **Names:** app **Green Wall**, bundle id and LaunchAgent label `local.green-wall`, menu icon SF Symbol `leaf.fill`.
- **Power policy:** visible ≥ 0.40 → 30 fps; 0.05–0.40 → 15 fps; < 0.05 → 0; Low Power Mode, lock, sleep → 0.
- **Frame budget:** under 8 ms per frame at 30 fps on the built-in XDR display (3024×1964).

## Review Focus

1. **Days or weeks of uptime without a restart** — the sway must stay smooth; 32-bit shader time would stutter. Pinned by Task 3 (`shader time wraps…`), Task 8 (`every noise drift completes whole turns…`) and Task 10 (`dust gets wrapped time…`).
2. **The user's 16:9 external display, and resolution/display changes** — downlights stay in view and resizing throws nothing. Pinned by Task 2 (`a 16:9 screen… keeps the downlights in view`) and Task 13 (smoke at 1920×1080).
3. **Host calls that arrive before the scene has loaded** (cursor, pause, fps, water right after launch) — queued, no errors. Pinned by Task 13 (smoke mode calls every bridge function before boot).
4. **Pressing Water again while mist is falling, or while stopped** — restarts cleanly; does nothing while halted. Pinned by Task 12 (`…watering again restarts it`) plus the `loop.running` guard in Task 13 and the host guard in Task 15.
5. **A cursor left parked over the wall** — butterflies must not keep landing under it and fleeing. Pinned by Task 6 (`never lands within reach of a cursor that lingers`).

## File Structure

```
package.json · .gitignore · serve.mjs · README.md
scene/index.html                     page + CSP
scene/vendor/                        Three.js 0.186.0 (vendored)
scene/assets/wall.jpg                3840×2560 photo (derived with sips)
scene/src/random.js                  seeded PRNG                         (pure)
scene/src/wall.js                    photo constants                     (pure)
scene/src/fit.js                     cover fit, viewport → wall          (pure)
scene/src/wind.js                    shared wind + shader time wrap      (pure)
scene/src/leaf-layout.js             where leaves grow                   (pure)
scene/src/leaf-colour.js             leaf colour from the photo          (pure)
scene/src/leaf-springs.js            cursor spring physics               (pure)
scene/src/butterfly-brain.js         butterfly states + scheduler        (pure)
scene/src/frame-loop.js              fps cap, pause, halt, sim clock     (pure)
scene/src/photo-layer.js             backdrop + sway/ripple shader; shared GLSL
scene/src/leaves.js                  instanced 3D leaves, stems, shadows
scene/src/lights.js                  downlight cones, glows, dust
scene/src/logo-glow.js               travelling light along the letters
scene/src/butterflies.js             butterfly meshes
scene/src/mist.js                    Water effect
scene/src/main.js                    boot, bridge, input, debug/smoke hooks
mac/Coverage.swift                   visible fraction + frame cap        (pure)
mac/GreenWall.swift                  the host app (+ --check, --restore-desktop-picture)
mac/Info.plist · mac/build.sh · mac/install.sh · mac/uninstall.sh
mac/tests/coverage-test.swift · mac/tests/run.sh
tests/*.test.mjs · tests/smoke.sh
```

Each render module (`photo-layer`, `leaves`, `lights`, `logo-glow`, `butterflies`, `mist`) exports one `create…()` returning `{ mesh | group | points, update(...) }`, and is unit-tested in Node (Three.js objects build without a GPU); their shaders are exercised by the smoke test in Task 13.

---

### Task 1: Repository, dev server, bundled Three.js and photo

**Files:**
- Create: `package.json`, `.gitignore`, `serve.mjs`, `tests/serve.test.mjs`
- Create (downloaded/derived): `scene/vendor/three.module.js`, `scene/vendor/three.core.js`, `scene/vendor/LICENSE`, `scene/vendor/VERSION`, `scene/assets/wall.jpg`

**Interfaces:**
- Produces: `createStaticServer(root: string) → http.Server` (serves files under `root`, `/` → 302 `/scene/`, 403 outside root, 404 otherwise); npm scripts `start`, `test`, `smoke`, `test:mac`.

- [ ] **Step 1: Make sure the repository exists**

Run: `git -C ~/CEFALO/cefalo-living-wall status`
If it prints `fatal: not a git repository`, ask the user to run this and wait:

```
! cd ~/CEFALO/cefalo-living-wall && git init && git add docs assets-src && git commit -m "Add green wall wallpaper design spec, prototype and source photo"
```

- [ ] **Step 2: Add `package.json` and `.gitignore`**

`package.json`:

```json
{
  "name": "green-wall",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node serve.mjs",
    "test": "node --test \"tests/*.test.mjs\"",
    "smoke": "sh tests/smoke.sh",
    "test:mac": "sh mac/tests/run.sh"
  }
}
```

`.gitignore`:

```text
tests/out/
.DS_Store
```

- [ ] **Step 3: Write the failing test** — `tests/serve.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../serve.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A raw GET, so the path reaches the server exactly as written (no URL normalising).
const get = (port, path) => new Promise((done, fail) => {
  request({ host: '127.0.0.1', port, path }, (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => done({ status: res.statusCode, type: res.headers['content-type'], body }));
  }).on('error', fail).end();
});

test('serves files with their type, 404s the rest, and refuses to leave the root', async () => {
  const server = createStaticServer(root);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const ok = await get(port, '/package.json');
    assert.equal(ok.status, 200);
    assert.equal(ok.type, 'application/json');
    assert.equal((await get(port, '/nope.txt')).status, 404);
    assert.equal((await get(port, '/..%2f..%2f..%2fetc%2fpasswd')).status, 403);
    assert.equal((await get(port, '/%E0%A4%A')).status, 404);
    assert.equal((await get(port, '/')).status, 302);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 4: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … serve.mjs`.

- [ ] **Step 5: Write `serve.mjs`**

```js
// Serves the repository for browser development: npm start, then open /scene/.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};

export function createStaticServer(root) {
  const base = resolve(root);
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://local');
      if (pathname === '/') { res.writeHead(302, { Location: '/scene/' }); res.end(); return; }
      let path = decodeURIComponent(pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(base, `.${path}`);
      if (!file.startsWith(base + sep)) { res.writeHead(403); res.end('forbidden'); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080);
  createStaticServer(dirname(fileURLToPath(import.meta.url))).listen(port, '127.0.0.1', () => {
    console.log(`Green Wall: http://127.0.0.1:${port}/scene/  (Ctrl+C to stop)`);
  });
}
```

- [ ] **Step 6: Run the test**

Run: `npm test`
Expected: `ℹ pass 1`, `ℹ fail 0`.

- [ ] **Step 7: Vendor Three.js 0.186.0**

```sh
mkdir -p scene/vendor
for f in three.module.js three.core.js; do
  curl -sfL -o "scene/vendor/$f" "https://cdn.jsdelivr.net/npm/three@0.186.0/build/$f"
done
curl -sfL -o scene/vendor/LICENSE https://cdn.jsdelivr.net/npm/three@0.186.0/LICENSE
echo 0.186.0 > scene/vendor/VERSION
grep -m1 "REVISION = " scene/vendor/three.core.js
grep -c "from './three.core.js'" scene/vendor/three.module.js
```

Expected: `const REVISION = '186';` and a count of `2` (the module re-exports from `three.core.js`, so both files are required).

- [ ] **Step 8: Derive the shipped photo**

```sh
mkdir -p scene/assets
sips -Z 3840 -s format jpeg -s formatOptions 80 assets-src/green-wall.jpg --out scene/assets/wall.jpg
sips -g pixelWidth -g pixelHeight scene/assets/wall.jpg
```

Expected: `pixelWidth: 3840`, `pixelHeight: 2560` (about 2.4 MB).

- [ ] **Step 9: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add package.json .gitignore serve.mjs tests/serve.test.mjs scene/vendor scene/assets/wall.jpg && git commit -m "Add dev server, vendored Three.js 0.186.0 and the shipped photo"
```

---

### Task 2: Seeded random, wall constants and cover fit

**Files:**
- Create: `scene/src/random.js`, `scene/src/wall.js`, `scene/src/fit.js`
- Test: `tests/random.test.mjs`, `tests/fit.test.mjs`

**Interfaces:**
- Produces:
  - `createRandom(seed = 1) → { next() → [0,1), range(min, max), int(min, max) (inclusive), pick(items), chance(p) → bool, gauss(mean = 0, sd = 1) }`
  - `WALL_W = 1600`, `WALL_H = 1067`, `LOGO_BOX = { x0: 450, y0: 425, x1: 1145, y1: 578 }`, `LIGHTS: [x, y][6]`, `WALL_BOTTOM = 980`, `wallTop(x) → y`, `inLogo(x, y, pad = 0) → bool`
  - `coverFit(viewW, viewH, anchorY = 0.3) → { x0, y0, w, h }` (visible wall rectangle), `toWall(fit, px, py, viewW, viewH) → { x, y }`

- [ ] **Step 1: Write the failing tests**

`tests/random.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';

test('same seed gives the same sequence', () => {
  const a = createRandom(7), b = createRandom(7);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different seeds differ', () => {
  assert.notEqual(createRandom(1).next(), createRandom(2).next());
});

test('range and int stay in bounds', () => {
  const r = createRandom(3);
  for (let i = 0; i < 10000; i++) {
    const v = r.range(15, 40);
    assert.ok(v >= 15 && v < 40);
    const n = r.int(1, 3);
    assert.ok([1, 2, 3].includes(n));
  }
});
```

`tests/fit.test.mjs` (the 16:9 case is Review Focus 2):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFit, toWall } from '../scene/src/fit.js';
import { WALL_W, WALL_H, LIGHTS } from '../scene/src/wall.js';

test('a 16:9 screen shows the full width and keeps the downlights in view', () => {
  const fit = coverFit(1920, 1080);
  assert.equal(fit.w, WALL_W);
  assert.ok(Math.abs(fit.h - 900) < 0.01);
  for (const [, y] of LIGHTS) assert.ok(y > fit.y0 && y < fit.y0 + fit.h, `light at y=${y} cropped`);
});

test('a screen narrower than 3:2 shows the full height', () => {
  const fit = coverFit(1200, 1000);
  assert.equal(fit.h, WALL_H);
  assert.equal(fit.y0, 0);
  assert.ok(Math.abs(fit.x0 - (WALL_W - fit.w) / 2) < 1e-9);
});

test('viewport corners map to the visible rectangle', () => {
  const fit = coverFit(1512, 982);
  const tl = toWall(fit, 0, 0, 1512, 982), br = toWall(fit, 1512, 982, 1512, 982);
  assert.deepEqual(tl, { x: fit.x0, y: fit.y0 });
  assert.ok(Math.abs(br.x - (fit.x0 + fit.w)) < 1e-9 && Math.abs(br.y - (fit.y0 + fit.h)) < 1e-9);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … scene/src/random.js` (and `fit.js`).

- [ ] **Step 3: Implement**

`scene/src/random.js`:

```js
// Seeded PRNG (mulberry32): the same seed always grows the same wall.
export function createRandom(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
    gauss(mean = 0, sd = 1) {
      const u = 1 - next(), v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
```

`scene/src/wall.js`:

```js
// Everything the scene knows about the photo, in wall units: pixels of the photo
// scaled to 1600 wide, origin top-left, y pointing down.
export const WALL_W = 1600;
export const WALL_H = 1067;
export const LOGO_BOX = { x0: 450, y0: 425, x1: 1145, y1: 578 };
export const LIGHTS = [[255, 57], [527, 59], [795, 64], [1066, 73], [1330, 82], [1590, 87]];
export const WALL_BOTTOM = 980;

/** The ceiling's lower edge, which slopes from y=82 on the left to y=108 on the right. */
export const wallTop = (x) => 82 + (108 - 82) * (x / WALL_W);

export function inLogo(x, y, pad = 0) {
  return x > LOGO_BOX.x0 - pad && x < LOGO_BOX.x1 + pad && y > LOGO_BOX.y0 - pad && y < LOGO_BOX.y1 + pad;
}
```

`scene/src/fit.js`:

```js
import { WALL_W, WALL_H } from './wall.js';

// Which part of the wall a viewport shows. Like CSS object-fit: cover, except that a
// wide screen crops less from the top than the bottom (anchorY), so the ceiling
// downlights stay in view on 16:9 displays.
export function coverFit(viewW, viewH, anchorY = 0.3) {
  const aspect = viewW / viewH;
  let w = WALL_W, h = WALL_H;
  if (aspect > WALL_W / WALL_H) h = WALL_W / aspect;
  else w = WALL_H * aspect;
  return { x0: (WALL_W - w) / 2, y0: (WALL_H - h) * anchorY, w, h };
}

/** A viewport point (CSS px from the top-left) in wall units. */
export function toWall(fit, px, py, viewW, viewH) {
  return { x: fit.x0 + (px / viewW) * fit.w, y: fit.y0 + (py / viewH) * fit.h };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 7`, `ℹ fail 0` (serve 1 + random 3 + fit 3).

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/random.js scene/src/wall.js scene/src/fit.js tests/random.test.mjs tests/fit.test.mjs && git commit -m "Add seeded random, wall constants and cover fit"
```

---

### Task 3: Wind

**Files:**
- Create: `scene/src/wind.js`
- Test: `tests/wind.test.mjs`

**Interfaces:**
- Consumes: `WALL_W` (Task 2), `createRandom` (tests).
- Produces:
  - `SWAY_PERIOD = 5`, `SWAY_CROSSING = 2.6`, `GUST_CROSSING = 2.4`, `GUST_GAP = [15, 40]`, `GUST_STRENGTH = [0.6, 1.2]`, `GUST_LENGTH = 4`
  - `gustProfile(tau) → number`, `swayAt(x, t, phase = 0) → [-1, 1]`, `gustAt(x, t, start, strength, delay = 0) → number`
  - `createWind(random) → { current(t) → { start, strength }, sample(x, t, phase, delay) → { sway, gust }, startsUntil(t) → { start, strength }[] }`
  - `SHADER_TIME_WRAP = 10000`, `shaderTime(t, gust) → { time, gustStart }` — every shader gets wrapped time (Review Focus 1)
- Note: `photo-layer.js` (Task 8) carries a GLSL copy of `gustProfile`/`swayAt`/`gustAt`; the two must stay in step.

- [ ] **Step 1: Write the failing test** — `tests/wind.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createWind, gustAt, gustProfile, swayAt, shaderTime, GUST_LENGTH, SHADER_TIME_WRAP } from '../scene/src/wind.js';

test('a gust front reaches the right edge after the left edge', () => {
  const peak = (x) => {
    let best = -1, at = 0;
    for (let t = 0; t < 10; t += 0.01) {
      const v = gustAt(x, t, 1, 1);
      if (v > best) { best = v; at = t; }
    }
    return at;
  };
  assert.ok(peak(1600) - peak(0) > 2, 'gust should take ~2.4 s to cross');
});

test('gust profile is zero outside its window and peaks at 1', () => {
  assert.equal(gustProfile(-1), 0);
  assert.equal(gustProfile(GUST_LENGTH + 0.1), 0);
  assert.ok(Math.abs(gustProfile(1) - 1) < 1e-9);
});

test('wind stays within [-1.5, 1.5] everywhere', () => {
  const wind = createWind(createRandom(5));
  for (let t = 0; t < 600; t += 0.37) {
    for (let x = 0; x <= 1600; x += 200) {
      const { sway, gust } = wind.sample(x, t, 0.3, 0.2);
      assert.ok(Math.abs(sway) <= 1.5 && Math.abs(gust) <= 1.5, `t=${t} x=${x}`);
    }
  }
});

test('gusts start 15-40 s apart', () => {
  const starts = createWind(createRandom(9)).startsUntil(4 * 3600).map((g) => g.start);
  assert.ok(starts[0] >= 15 && starts[0] <= 40);
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= 15 && gap <= 40, `gap ${gap}`);
  }
});

test('same seed, same weather', () => {
  const a = createWind(createRandom(4)), b = createWind(createRandom(4));
  for (let t = 0; t < 200; t += 1.3) assert.deepEqual(a.sample(800, t), b.sample(800, t));
});

test('shader time wraps without changing the breeze or the gust', () => {
  for (const t of [9999.9, 10000.1, 30 * 86400 + 1.234]) {
    const { time, gustStart } = shaderTime(t, { start: t - 1.5, strength: 1 });
    assert.ok(time >= 0 && time < SHADER_TIME_WRAP);
    assert.ok(Math.abs(swayAt(700, time, 0.3) - swayAt(700, t, 0.3)) < 1e-6);
    assert.ok(Math.abs(time - gustStart - 1.5) < 1e-6);
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … scene/src/wind.js`.

- [ ] **Step 3: Implement** — `scene/src/wind.js`:

```js
import { WALL_W } from './wall.js';

// The one wind that moves both the photographed leaves and the 3D leaves. photo-layer.js
// and leaves.js carry a GLSL copy of swayAt/gustAt; keep the three in step.
export const SWAY_PERIOD = 5;        // s
export const SWAY_CROSSING = 2.6;    // s for the breeze's phase to cross the wall
export const GUST_CROSSING = 2.4;    // s for a gust front to cross the wall
export const GUST_GAP = [15, 40];    // s between gust starts
export const GUST_STRENGTH = [0.6, 1.2];
// A gust at one point: rise, overshoot back, small rebound, settle. [time s, value]
const GUST_SHAPE = [[0, 0], [1, 1], [2, -0.45], [3, 0.2], [4, 0]];
export const GUST_LENGTH = GUST_SHAPE[GUST_SHAPE.length - 1][0];

// Shaders get time as 32-bit floats, which after days of uptime are too coarse for a
// smooth sway. They get time modulo this instead: a whole number of sway periods and
// of every noise-drift period in photo-layer.js (DRIFT_SPEEDS), so the wrap is seamless.
export const SHADER_TIME_WRAP = 10000;

/** Wrapped time for the shaders, and the gust start shifted by the same amount. */
export function shaderTime(t, gust) {
  const time = t % SHADER_TIME_WRAP;
  return { time, gustStart: gust.start - (t - time) };
}

const smooth = (a, b, u) => a + (b - a) * u * u * (3 - 2 * u);

/** Gust profile at `tau` seconds after the front reached a point; 0 outside [0, 4]. */
export function gustProfile(tau) {
  if (tau <= 0 || tau >= GUST_LENGTH) return 0;
  for (let i = 1; i < GUST_SHAPE.length; i++) {
    const [t1, v1] = GUST_SHAPE[i];
    if (tau <= t1) {
      const [t0, v0] = GUST_SHAPE[i - 1];
      return smooth(v0, v1, (tau - t0) / (t1 - t0));
    }
  }
  return 0;
}

/** Base breeze at wall x, time t (s), plus a per-leaf phase offset (s). In [-1, 1]. */
export function swayAt(x, t, phase = 0) {
  return Math.sin((2 * Math.PI * (t + phase - (x / WALL_W) * SWAY_CROSSING)) / SWAY_PERIOD);
}

/** Gust at wall x for a gust that started at `start` with `strength`; `delay` is per-leaf. */
export function gustAt(x, t, start, strength, delay = 0) {
  return strength * gustProfile(t - start - (x / WALL_W) * GUST_CROSSING - delay);
}

// Gust starts are drawn lazily from the seeded random, so the same seed gives the same
// weather. Gaps (>= 15 s) are longer than a gust lasts anywhere on the wall (~6.4 s),
// so at most one gust is ever active and the shaders need only the latest one.
export function createWind(random, { firstGust = random.range(...GUST_GAP) } = {}) {
  const starts = [{ start: firstGust, strength: random.range(...GUST_STRENGTH) }];
  const ensure = (t) => {
    while (starts[starts.length - 1].start <= t) {
      const last = starts[starts.length - 1].start;
      starts.push({ start: last + random.range(...GUST_GAP), strength: random.range(...GUST_STRENGTH) });
    }
  };
  /** The latest gust that has started by time t, or a far-past dummy. */
  function current(t) {
    ensure(t);
    for (let i = starts.length - 1; i >= 0; i--) if (starts[i].start <= t) return starts[i];
    return { start: -1e4, strength: 0 };
  }
  return {
    current,
    sample(x, t, phase = 0, delay = 0) {
      const g = current(t);
      return { sway: swayAt(x, t, phase), gust: gustAt(x, t, g.start, g.strength, delay) };
    },
    /** Gust starts up to time t, for tests. */
    startsUntil(t) { ensure(t); return starts.filter((g) => g.start <= t); },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 13`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/wind.js tests/wind.test.mjs && git commit -m "Add shared wind with seeded gusts and wrapped shader time"
```

---

### Task 4: Leaf layout and leaf colours

**Files:**
- Create: `scene/src/leaf-layout.js`, `scene/src/leaf-colour.js`
- Test: `tests/leaf-layout.test.mjs`, `tests/leaf-colour.test.mjs`

**Interfaces:**
- Consumes: `WALL_W`, `WALL_BOTTOM`, `wallTop`, `inLogo` (Task 2).
- Produces:
  - `LEAF_LENGTH = 44`, `SHAPES = ['heart', 'lance', 'ovate']`, `LAYOUT` (tunable parameters; `occupancy` is the density knob)
  - `generateLeaves(random, P = LAYOUT) → Leaf[]`, sorted deep leaves first then by `y`, where `Leaf = { x, y (stem base), pocketX, pocketY, angle, scale, foreshorten, shape (0|1|2), deep, midX, midY, tipX, tipY, ux, uy (direction a positive bend moves the tip), swayAmp, swayPhase, gustAmp, gustDelay }`
  - `FALLBACK = [0x34, 0x5c, 0x24]`, `leafColour(pixels, x, y, wallW, wallH, random, dim = 1) → [r, g, b]` (sRGB bytes; `pixels` is ImageData-like)

- [ ] **Step 1: Write the failing tests**

`tests/leaf-layout.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { inLogo, wallTop, WALL_BOTTOM } from '../scene/src/wall.js';

test('same seed gives the same wall', () => {
  assert.deepEqual(generateLeaves(createRandom(7)), generateLeaves(createRandom(7)));
});

for (const seed of [1, 7, 42, 2026]) {
  test(`seed ${seed}: 500-700 leaves, none in the logo, ceiling or pebbles`, () => {
    const leaves = generateLeaves(createRandom(seed));
    assert.ok(leaves.length >= 500 && leaves.length <= 700, `count ${leaves.length}`);
    for (const l of leaves) {
      for (const [x, y] of [[l.x, l.y], [l.midX, l.midY], [l.tipX, l.tipY]]) {
        assert.ok(!inLogo(x, y), `leaf point in logo at ${x},${y}`);
        assert.ok(y > wallTop(x), `leaf point in ceiling at ${x},${y}`);
        assert.ok(y < WALL_BOTTOM + 8, `leaf point in pebbles at ${x},${y}`);
      }
    }
  });
}

test('deep leaves come first, then top-to-bottom', () => {
  const leaves = generateLeaves(createRandom(7));
  const firstFront = leaves.findIndex((l) => !l.deep);
  assert.ok(leaves.slice(firstFront).every((l) => !l.deep));
  for (let i = firstFront + 1; i < leaves.length; i++) assert.ok(leaves[i].y >= leaves[i - 1].y);
});
```

`tests/leaf-colour.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { leafColour, FALLBACK } from '../scene/src/leaf-colour.js';

const image = (rgb, width = 40, height = 27) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4);
  return { data, width, height };
};

test('takes the colour of the photo around the leaf', () => {
  const [r, g, b] = leafColour(image([60, 110, 40]), 800, 500, 1600, 1067, createRandom(1));
  assert.ok(g > r && g > b && Math.abs(g - 110) <= 12);
});

test('white (logo) and near-black samples fall back to leaf green', () => {
  for (const rgb of [[250, 250, 250], [5, 8, 4]]) {
    const out = leafColour(image(rgb), 800, 500, 1600, 1067, createRandom(1));
    out.forEach((c, i) => assert.ok(Math.abs(c - FALLBACK[i]) <= FALLBACK[i] * 0.11 + 1));
  }
});

test('works at the photo edges', () => {
  assert.equal(leafColour(image([60, 110, 40]), 0, 0, 1600, 1067, createRandom(1)).length, 3);
  assert.equal(leafColour(image([60, 110, 40]), 1600, 1067, 1600, 1067, createRandom(1)).length, 3);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … leaf-layout.js` (and `leaf-colour.js`).

- [ ] **Step 3: Implement**

`scene/src/leaf-layout.js`:

```js
import { WALL_W, WALL_BOTTOM, wallTop, inLogo } from './wall.js';

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
      if (!random.chance(P.occupancy) || inLogo(px, py, 30) || py < wallTop(px) + 30) continue;
      const count = random.pick(P.perPocket);
      for (let k = 0; k < count; k++) {
        let angle = random.gauss(0, P.spread);
        if (random.chance(P.droop)) angle = (random.chance(0.5) ? -1 : 1) * random.range(95, 140);
        if (py < wallTop(px) + 70) angle = Math.sign(angle || 1) * random.range(75, 140);
        const base = along(px, py, angle, random.range(...P.stem));
        const deep = random.chance(P.deep);
        const scale = random.range(...P.scale) * (deep ? 0.8 : 1);
        const mid = along(base.x, base.y, angle, LEAF_LENGTH * scale * 0.55);
        const tip = along(base.x, base.y, angle, LEAF_LENGTH * scale);
        if (inLogo(mid.x, mid.y, 12) || inLogo(tip.x, tip.y, 12)) continue;
        if (tip.y < wallTop(tip.x) + 6 || tip.y > WALL_BOTTOM + 6) continue;
        leaves.push({
          x: base.x, y: base.y, pocketX: px, pocketY: py,
          angle, scale, foreshorten: random.range(...P.foreshorten),
          shape: random.int(0, SHAPES.length - 1), deep,
          midX: mid.x, midY: mid.y, tipX: tip.x, tipY: tip.y,
          // Direction a positive (clockwise) bend moves the tip.
          ux: Math.cos(rad(angle)), uy: Math.sin(rad(angle)),
          swayAmp: random.range(2.2, 4.8) * (random.chance(0.5) ? 1 : -1),
          swayPhase: random.range(0, 0.7),
          // Wind always pushes tips downwind: strongest for leaves pointing up or down.
          gustAmp: 13 * Math.cos(rad(angle)) * random.range(0.7, 1.2),
          gustDelay: (py / 1067) * 0.35 + random.range(0, 0.2),
        });
      }
    }
  }
  // Painter's order: deep leaves first, then row by row so lower rows overlap upper ones.
  return leaves.sort((a, b) => (a.deep === b.deep ? a.y - b.y : a.deep ? -1 : 1));
}
```

`scene/src/leaf-colour.js`:

```js
// A front leaf's colour, taken from the photo around its midpoint so it blends in.
// `pixels` is ImageData-like ({ data, width, height }) of the photo scaled down;
// (x, y) are wall units. Returns sRGB bytes [r, g, b].
export const FALLBACK = [0x34, 0x5c, 0x24];

export function leafColour(pixels, x, y, wallW, wallH, random, dim = 1) {
  const sx = Math.round((x / wallW) * pixels.width), sy = Math.round((y / wallH) * pixels.height);
  const patch = [];
  for (let j = -3; j <= 3; j++) {
    for (let i = -3; i <= 3; i++) {
      const px = Math.min(pixels.width - 1, Math.max(0, sx + i));
      const py = Math.min(pixels.height - 1, Math.max(0, sy + j));
      const o = (py * pixels.width + px) * 4;
      patch.push([pixels.data[o], pixels.data[o + 1], pixels.data[o + 2]]);
    }
  }
  const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;
  patch.sort((a, b) => lum(a) - lum(b));
  let rgb = patch[Math.floor(patch.length * 0.68)];
  if (rgb[2] > 150 || lum(rgb) < 38) rgb = FALLBACK; // logo/pebble white, or a dark gap
  const k = random.range(0.9, 1.1) * dim;
  return rgb.map((c) => Math.min(255, Math.round(c * k)));
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 22`, `ℹ fail 0`. For reference, seeds 1, 7, 42, 2026 give 581, 586, 556, 598 leaves.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/leaf-layout.js scene/src/leaf-colour.js tests/leaf-layout.test.mjs tests/leaf-colour.test.mjs && git commit -m "Add front-leaf layout and photo-sampled leaf colours"
```

---

### Task 5: Cursor springs

**Files:**
- Create: `scene/src/leaf-springs.js`
- Test: `tests/leaf-springs.test.mjs`

**Interfaces:**
- Consumes: leaves with `{ x, y, midX, midY, ux, uy }` (Task 4).
- Produces: `SPRING` constants; `createSprings(leaves, options) → { angle: Float32Array, setPointer(x, y, t), pointerOut(), impulse(i, degrees), setHold(i, degrees), step(dt), takeDirty() → number[], activeCount }`. `step` integrates in fixed 60 Hz substeps and caps one call at 0.25 s.

- [ ] **Step 1: Write the failing test** — `tests/leaf-springs.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSprings } from '../scene/src/leaf-springs.js';

// One upright leaf: stem base at (100, 100), midpoint 24 units above it.
const upright = () => [{ x: 100, y: 100, midX: 100, midY: 76, ux: 1, uy: 0 }];
// step() caps one call at 0.25 s (a stall must not become a burst), so simulate frame by frame.
const run = (s, seconds, fps = 60) => { for (let i = 0; i < seconds * fps; i++) s.step(1 / fps); };

test('bends away from a cursor on its right', () => {
  const s = createSprings(upright());
  s.setPointer(115, 76, 0);
  run(s, 0.5);
  assert.ok(s.angle[0] < -5, `angle ${s.angle[0]}`);
});

test('bends away from a cursor on its left', () => {
  const s = createSprings(upright());
  s.setPointer(85, 76, 0);
  run(s, 0.5);
  assert.ok(s.angle[0] > 5, `angle ${s.angle[0]}`);
});

test('ignores a cursor out of reach', () => {
  const s = createSprings(upright());
  s.setPointer(400, 400, 0);
  run(s, 0.5);
  assert.equal(s.angle[0], 0);
});

test('returns to rest within 2 s after the cursor leaves', () => {
  const s = createSprings(upright());
  s.setPointer(110, 76, 0);
  run(s, 0.5);
  s.pointerOut();
  run(s, 2);
  assert.ok(Math.abs(s.angle[0]) < 0.05);
  assert.equal(s.activeCount, 0);
});

test('never exceeds 55 degrees, even when flicked hard', () => {
  const s = createSprings(upright());
  let max = 0;
  for (let i = 0; i < 200; i++) {
    s.setPointer(60 + (i % 2) * 80, 76, i / 60);
    s.step(1 / 60);
    max = Math.max(max, Math.abs(s.angle[0]));
  }
  assert.ok(max <= 55, `max ${max}`);
});

test('same result at 15, 30 and 60 fps', () => {
  const at = (fps) => {
    const s = createSprings(upright());
    s.setPointer(112, 80, 0);
    run(s, 1, fps);
    return s.angle[0];
  };
  const a60 = at(60);
  assert.ok(Math.abs(at(30) - a60) < 1e-4 && Math.abs(at(15) - a60) < 1e-4);
});

test('a held leaf stays bent until released', () => {
  const s = createSprings(upright());
  s.setHold(0, 4);
  run(s, 3);
  assert.ok(Math.abs(s.angle[0] - 4) < 0.1);
  s.setHold(0, 0);
  run(s, 3);
  assert.ok(Math.abs(s.angle[0]) < 0.05);
});

test('one long step is capped at 0.25 s', () => {
  const a = createSprings(upright()), b = createSprings(upright());
  a.setPointer(110, 76, 0); b.setPointer(110, 76, 0);
  a.step(5); run(b, 0.25);
  assert.equal(a.angle[0], b.angle[0]);
});

test('reports which leaves changed', () => {
  const s = createSprings(upright());
  assert.deepEqual(s.takeDirty(), []);
  s.setPointer(110, 76, 0);
  s.step(1 / 60);
  assert.deepEqual(s.takeDirty(), [0]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … leaf-springs.js`.

- [ ] **Step 3: Implement** — `scene/src/leaf-springs.js`:

```js
// Cursor physics for the front leaves: a leaf bends away from a nearby cursor, gets a
// flick when the cursor brushes past, and springs back with a little overshoot.
// Integrated in fixed 60 Hz substeps so it feels the same at any frame-rate cap.
export const SPRING = { reach: 90, maxBend: 38, k: 0.08, damping: 0.87, clamp: 55, flick: 0.22, step: 1 / 60 };
const REST = 0.04;

export function createSprings(leaves, options = {}) {
  const P = { ...SPRING, ...options };
  const n = leaves.length;
  const angle = new Float32Array(n), vel = new Float32Array(n), hold = new Float32Array(n);
  const active = new Set(), dirty = new Set();
  const pointer = { x: 0, y: 0, vx: 0, vy: 0, inside: false, t: null };
  let carry = 0;

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
          target += (side > 0 ? -1 : 1) * P.maxBend * f * f;
          vel[i] += ((pointer.vx * l.ux + pointer.vy * l.uy) / 60) * P.flick * f;
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
    /** Add angular velocity (degrees per substep) to one leaf, e.g. the mist's lift. */
    impulse(i, degrees) { vel[i] += degrees; active.add(i); },
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 31`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/leaf-springs.js tests/leaf-springs.test.mjs && git commit -m "Add cursor spring physics for the leaves"
```

---

### Task 6: Butterfly brain

**Files:**
- Create: `scene/src/butterfly-brain.js`
- Test: `tests/butterfly-brain.test.mjs`

**Interfaces:**
- Consumes: `WALL_W`, `WALL_BOTTOM`, `wallTop`, `inLogo`, `LOGO_BOX` (Task 2); leaves for perches (Task 4, tests).
- Produces:
  - `BUTTERFLY` constants (first visit 6–12 s, gaps 20–90 s, pair chance 0.25, rests 6–20 s, flee radius 110, logo margin 40, max visit 150 s)
  - `isPerch(x, y) → bool`
  - `createButterflyBrain({ random, perches: { index, x, y }[], perchPosition(index) → { x, y } }) → { flyers: Flyer[], log: { visits: { start, end, pair }[], landings: { t, x, y, perch }[] }, time, tick(dt, pointer | null) }`
  - `Flyer = { id, species: 'orange' | 'cream', state: 'wandering' | 'following' | 'approaching' | 'resting' | 'exiting', x, y, heading (radians, wall coords), flap (0 closed … 1 open), perch (leaf index | null), … }`

- [ ] **Step 1: Write the failing test** — `tests/butterfly-brain.test.mjs` (includes Review Focus 5):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createButterflyBrain, BUTTERFLY } from '../scene/src/butterfly-brain.js';
import { inLogo } from '../scene/src/wall.js';

const DT = 1 / 30;
const perchesFor = (seed) => generateLeaves(createRandom(seed)).map((l, index) => ({ index, x: l.midX, y: l.midY }));
const brainFor = (seed) => createButterflyBrain({ random: createRandom(seed), perches: perchesFor(seed) });

// One shared 8-hour run: the invariants below are all checked against it.
const eight = (() => {
  const brain = brainFor(7);
  let maxActive = 0;
  for (let t = 0; t < 8 * 3600; t += DT) {
    brain.tick(DT);
    maxActive = Math.max(maxActive, brain.flyers.length);
  }
  return { brain, maxActive };
})();

test('never more than two butterflies at once', () => {
  assert.ok(eight.maxActive <= 2 && eight.maxActive >= 1, `max ${eight.maxActive}`);
});

test('no landing in the logo zone', () => {
  assert.ok(eight.brain.log.landings.length > 100);
  for (const l of eight.brain.log.landings) assert.ok(!inLogo(l.x, l.y, BUTTERFLY.logoMargin), `landed at ${l.x},${l.y}`);
});

test('about one visit in four is a pair', () => {
  // Pooled over three 8-hour runs: one run alone (~290 visits) is too noisy to pin 0.25.
  const visits = [eight.brain, ...[3, 42].map((seed) => {
    const brain = brainFor(seed);
    for (let t = 0; t < 8 * 3600; t += DT) brain.tick(DT);
    return brain;
  })].flatMap((b) => b.log.visits);
  const share = visits.filter((v) => v.pair).length / visits.length;
  assert.ok(visits.length > 600, `visits ${visits.length}`);
  assert.ok(share >= 0.18 && share <= 0.32, `pair share ${share}`);
});

test('20-90 s between one visit leaving and the next arriving', () => {
  const { visits } = eight.brain.log;
  for (let i = 1; i < visits.length; i++) {
    const gap = visits[i].start - visits[i - 1].end;
    assert.ok(gap >= 20 - DT && gap <= 90 + DT, `gap ${gap}`);
  }
});

test('every visit ends', () => {
  for (const v of eight.brain.log.visits) assert.ok(v.end - v.start <= BUTTERFLY.maxVisit + 30, `visit ${v.end - v.start}s`);
});

test('a resting butterfly takes off within one tick of the cursor coming near', () => {
  const brain = brainFor(3);
  let resting = null;
  for (let t = 0; t < 600 && !resting; t += DT) {
    brain.tick(DT);
    resting = brain.flyers.find((b) => b.state === 'resting');
  }
  assert.ok(resting, 'no butterfly ever rested');
  brain.tick(DT, { x: resting.x + 60, y: resting.y, inside: true });
  assert.notEqual(resting.state, 'resting');
});

test('never lands within reach of a cursor that lingers', () => {
  const brain = brainFor(5), pointer = { x: 800, y: 300, inside: true };
  for (let t = 0; t < 3600; t += DT) brain.tick(DT, pointer);
  assert.ok(brain.log.landings.length > 20);
  for (const l of brain.log.landings) {
    assert.ok(Math.hypot(l.x - pointer.x, l.y - pointer.y) >= BUTTERFLY.fleeRadius, `landed ${Math.hypot(l.x - pointer.x, l.y - pointer.y)} from the cursor`);
  }
});

test('same seed, same butterflies', () => {
  const a = brainFor(11), b = brainFor(11);
  for (let t = 0; t < 300; t += DT) { a.tick(DT); b.tick(DT); }
  assert.deepEqual(a.log, b.log);
});

test('with nowhere to land, visitors fly through and leave', () => {
  const brain = createButterflyBrain({ random: createRandom(1), perches: [] });
  for (let t = 0; t < 400; t += DT) brain.tick(DT);
  assert.ok(brain.log.visits.length >= 1 && brain.log.landings.length === 0);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … butterfly-brain.js`.

- [ ] **Step 3: Implement** — `scene/src/butterfly-brain.js`:

```js
import { WALL_W, WALL_BOTTOM, wallTop, inLogo, LOGO_BOX } from './wall.js';

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
  return x > 80 && x < WALL_W - 80 && y > wallTop(x) + 40 && y < WALL_BOTTOM - 40 && !inLogo(x, y, BUTTERFLY.logoMargin);
}

export function createButterflyBrain({ random, perches, perchPosition = (i) => perches.find((p) => p.index === i) }) {
  const B = BUTTERFLY;
  let clock = 0, nextId = 1;
  let nextVisit = random.range(...B.firstVisit);
  let visit = null;
  const flyers = [];
  const log = { visits: [], landings: [] };
  const usable = perches.filter((p) => isPerch(p.x, p.y));

  // A point to fly through: clear of the logo, and within `reach` of `from` when given,
  // so flights stay short and most of a visit is spent resting.
  function waypoint(from = null, reach = 450) {
    for (let tries = 0; ; tries++) {
      const x = random.range(120, WALL_W - 120);
      const y = random.range(wallTop(x) + 60, 900);
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
      ? { x: Math.min(WALL_W - 120, Math.max(120, b.x + away.x * 220)), y: Math.min(900, Math.max(wallTop(b.x) + 60, b.y + away.y * 220)) }
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
    /** Advance by dt seconds. pointer: { x, y, inside } in wall units, or null. */
    tick(dt, pointer = null) {
      clock += dt;
      if (!visit && clock >= nextVisit) startVisit();
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 40`, `ℹ fail 0` in about 2 s (the shared 8-hour simulation runs once). For reference, seed 7 over 8 hours: ~290 visits, butterflies resting ~2.5 h and flying ~1.6 h; pooled over many seeds the pair share is 0.25.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/butterfly-brain.js tests/butterfly-brain.test.mjs && git commit -m "Add butterfly behaviour and visit scheduler"
```

---

### Task 7: Frame loop

**Files:**
- Create: `scene/src/frame-loop.js`
- Test: `tests/frame-loop.test.mjs`

**Interfaces:**
- Produces: `createFrameLoop(draw(dt, simTime), { now, requestFrame, cancelFrame, delay, cancelDelay }) → { setMaxFps(n), setPaused(bool), setHidden(bool), renderAt(t), start(), running, pending, simTime }`. Defaults to 30 fps; `n = 0`, paused or hidden schedule nothing; resume never jumps simulation time; below the display rate it sleeps on a timer (the XDR refreshes at 120 Hz).

- [ ] **Step 1: Write the failing test** — `tests/frame-loop.test.mjs`. The fake display counts refreshes as integers: stepping a float clock can stall forever on rounding.

```js
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … frame-loop.js`.

- [ ] **Step 3: Implement** — `scene/src/frame-loop.js`:

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 45`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/frame-loop.js tests/frame-loop.test.mjs && git commit -m "Add capped, haltable frame loop"
```

---

### Task 8: Photo layer

**Files:**
- Create: `scene/src/photo-layer.js`
- Test: `tests/photo-layer.test.mjs`

**Interfaces:**
- Consumes: `WALL_W`, `WALL_H` (Task 2); `shaderTime` (Task 3); Three.js.
- Produces:
  - `WIND_GLSL` — GLSL declaring `uTime`, `uGustStart`, `uGustStrength` and `gustProfile`, `swayAt(x, phase)`, `gustAt(x, delay)`; reused by `leaves.js`
  - `LOGO_GLSL` — GLSL declaring `uPhoto`, `uvOf(wall)`, `letterAt(p)` (white letter mask from the blue channel), `nearLogo(p, pad)`; reused by `logo-glow.js`
  - `DRIFT_SPEEDS = { coarse, fine, fineVertical }`
  - `createPhotoLayer(photoTexture, random) → { mesh (renderOrder 0), poke(x, y, t), update(t, gust) }`

- [ ] **Step 1: Write the failing test** — `tests/photo-layer.test.mjs` (Review Focus 1):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../scene/vendor/three.module.js';
import { createRandom } from '../scene/src/random.js';
import { SHADER_TIME_WRAP } from '../scene/src/wind.js';
import { createPhotoLayer, DRIFT_SPEEDS } from '../scene/src/photo-layer.js';

test('every noise drift completes whole turns per shader-time wrap', () => {
  for (const speed of Object.values(DRIFT_SPEEDS)) {
    const turns = speed * SHADER_TIME_WRAP;
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `speed ${speed}`);
  }
});

test('the photo is drawn first and gets wrapped time', () => {
  const layer = createPhotoLayer(new THREE.Texture(), createRandom(1));
  assert.equal(layer.mesh.renderOrder, 0);
  layer.update(SHADER_TIME_WRAP + 2, { start: SHADER_TIME_WRAP + 1, strength: 1 });
  const u = layer.mesh.material.uniforms;
  assert.ok(Math.abs(u.uTime.value - 2) < 1e-9);
  assert.ok(Math.abs(u.uTime.value - u.uGustStart.value - 1) < 1e-9);
});

test('the cursor ripple fades within a second or two', () => {
  const layer = createPhotoLayer(new THREE.Texture(), createRandom(1));
  const noGust = { start: -1e4, strength: 0 };
  layer.poke(400, 300, 5);
  layer.update(5, noGust);
  assert.ok(layer.mesh.material.uniforms.uRipple.value > 0.99);
  layer.update(7, noGust);
  assert.ok(layer.mesh.material.uniforms.uRipple.value < 0.1);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … photo-layer.js`.

- [ ] **Step 3: Implement** — `scene/src/photo-layer.js`:

```js
import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H } from './wall.js';
import { shaderTime } from './wind.js';

// How fast the two noise octaves drift (texture turns per second). Each must complete
// a whole number of turns in SHADER_TIME_WRAP seconds (tested).
export const DRIFT_SPEEDS = { coarse: 0.0015, fine: 0.003, fineVertical: 0.0008 };
const D = DRIFT_SPEEDS;

// GLSL copy of wind.js (gustProfile/swayAt/gustAt). Keep in step with wind.js.
export const WIND_GLSL = /* glsl */ `
  uniform float uTime, uGustStart, uGustStrength;
  float smoothTo(float a, float b, float u) { return a + (b - a) * u * u * (3.0 - 2.0 * u); }
  float gustProfile(float tau) {
    if (tau <= 0.0 || tau >= 4.0) return 0.0;
    if (tau < 1.0) return smoothTo(0.0, 1.0, tau);
    if (tau < 2.0) return smoothTo(1.0, -0.45, tau - 1.0);
    if (tau < 3.0) return smoothTo(-0.45, 0.2, tau - 2.0);
    return smoothTo(0.2, 0.0, tau - 3.0);
  }
  float swayAt(float x, float phase) { return sin(6.2831853 * (uTime + phase - x / 1600.0 * 2.6) / 5.0); }
  float gustAt(float x, float delay) { return uGustStrength * gustProfile(uTime - uGustStart - x / 1600.0 * 2.4 - delay); }
`;

// Blue channel (linear) that marks the white logo letters; foliage has little blue.
export const LOGO_GLSL = /* glsl */ `
  uniform sampler2D uPhoto;
  vec2 uvOf(vec2 wall) { return vec2(wall.x / ${WALL_W.toFixed(1)}, 1.0 - wall.y / ${WALL_H.toFixed(1)}); }
  float letterAt(vec2 p) { return smoothstep(0.70, 0.80, texture2D(uPhoto, uvOf(p)).b); }
  bool nearLogo(vec2 p, float pad) { return p.x > 450.0 - pad && p.x < 1145.0 + pad && p.y > 425.0 - pad && p.y < 578.0 + pad; }
`;

function noiseTexture(random, size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(random.next() * 256);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// The photo as the backdrop. Inside the wall (not the ceiling, pebbles or logo) its
// texture lookup is nudged by a drifting noise field whose strength follows the wind,
// plus a small ripple around the cursor.
export function createPhotoLayer(photo, random) {
  const uniforms = {
    uPhoto: { value: photo }, uNoise: { value: noiseTexture(random) },
    uTime: { value: 0 }, uGustStart: { value: -1e4 }, uGustStrength: { value: 0 },
    uPointer: { value: new THREE.Vector2(-1e4, -1e4) }, uRipple: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vWall;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWall = vec2(w.x, -w.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${WIND_GLSL}
      ${LOGO_GLSL}
      uniform sampler2D uNoise;
      uniform vec2 uPointer;
      uniform float uRipple;
      varying vec2 vWall;
      float logoMask(vec2 p) {
        if (!nearLogo(p, 20.0)) return 0.0;
        float m = letterAt(p);
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853982;
          m = max(m, letterAt(p + 7.0 * vec2(cos(a), sin(a))));
        }
        return m;
      }
      void main() {
        vec2 p = vWall;
        float top = 82.0 + 26.0 * p.x / 1600.0;
        float wall = smoothstep(top, top + 10.0, p.y) * (1.0 - smoothstep(970.0, 980.0, p.y));
        float free = wall * (1.0 - logoMask(p));
        vec2 offset = vec2(0.0);
        if (free > 0.001) {
          float gust = gustAt(p.x, 0.0);
          float drift = uTime * ${D.coarse} + gust * 0.004;
          vec2 n = texture2D(uNoise, p / 3840.0 + vec2(drift, 0.0)).rg * 2.0 - 1.0;
          n += 0.5 * (texture2D(uNoise, p / 1280.0 + vec2(uTime * ${D.fine} + gust * 0.007, uTime * ${D.fineVertical})).rg * 2.0 - 1.0);
          offset = n * (2.0 + 1.0 * abs(swayAt(p.x, 0.0)) + 2.5 * abs(gust));
          float d = distance(p, uPointer);
          if (uRipple > 0.001 && d < 60.0) {
            offset += (p - uPointer) / max(d, 1.0) * 3.0 * uRipple * (1.0 - d / 60.0) * sin(d * 0.3 - uTime * 9.0);
          }
          offset *= free;
        }
        gl_FragColor = texture2D(uPhoto, uvOf(p + offset));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), material);
  mesh.position.set(WALL_W / 2, -WALL_H / 2, 0);
  mesh.renderOrder = 0;
  let pokedAt = -1e4;
  return {
    mesh,
    /** The cursor moved over the wall at (x, y), time t. */
    poke(x, y, t) { uniforms.uPointer.value.set(x, y); pokedAt = t; },
    update(t, gust) {
      const { time, gustStart } = shaderTime(t, gust);
      uniforms.uTime.value = time;
      uniforms.uGustStart.value = gustStart;
      uniforms.uGustStrength.value = gust.strength;
      uniforms.uRipple.value = Math.exp(-Math.max(0, t - pokedAt) / 0.8);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 48`, `ℹ fail 0`. (The shader itself is compiled and drawn by the smoke test in Task 13.)

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/photo-layer.js tests/photo-layer.test.mjs && git commit -m "Add photo layer with wind sway and cursor ripple"
```

---

### Task 9: Front leaves

**Files:**
- Create: `scene/src/leaves.js`
- Test: `tests/leaves.test.mjs`

**Interfaces:**
- Consumes: `LIGHTS`, `WALL_W`, `WALL_H` (Task 2); `swayAt`, `gustAt`, `shaderTime` (Task 3); `leafColour` (Task 4); springs (Task 5); `WIND_GLSL` (Task 8).
- Produces: `createLeaves(leaves, pixels, random, springs) → { group (children in order: shadow renderOrder 1, stems 2, blades 3), update(t, gust, wet = 0), applyBends(), midpoint(i) → { x, y } }`. One `InstancedBufferGeometry` shared by the shadow and blade meshes; `iBend` is the only dynamic attribute; `midpoint` mirrors the vertex shader on the CPU (butterflies perch on it).

- [ ] **Step 1: Write the failing test** — `tests/leaves.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { generateLeaves } from '../scene/src/leaf-layout.js';
import { createSprings } from '../scene/src/leaf-springs.js';
import { createLeaves } from '../scene/src/leaves.js';

const green = () => {
  const width = 40, height = 27, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([60, 110, 40, 255], i * 4);
  return { data, width, height };
};
const noGust = { start: -1e4, strength: 0 };
const setup = () => {
  const data = generateLeaves(createRandom(7));
  const springs = createSprings(data);
  return { data, springs, leaves: createLeaves(data, green(), createRandom(2), springs) };
};

test('one instanced draw for all leaves, with shadows under and stems between', () => {
  const { data, leaves } = setup();
  const [shadow, stems, blades] = leaves.group.children;
  assert.equal(blades.geometry.instanceCount, data.length);
  assert.deepEqual([shadow.renderOrder, stems.renderOrder, blades.renderOrder], [1, 2, 3]);
  assert.equal(shadow.geometry, blades.geometry, 'shadows share the leaves geometry');
});

test('a leaf midpoint sways near where it grows', () => {
  const { data, leaves } = setup();
  for (let t = 0; t < 30; t += 0.7) {
    leaves.update(t, noGust);
    for (const i of [0, 100, 300]) {
      const m = leaves.midpoint(i);
      assert.ok(Math.hypot(m.x - data[i].midX, m.y - data[i].midY) < 8, `leaf ${i} at t=${t}`);
    }
  }
});

test('bends reach the GPU buffer, uploading only the changed span', () => {
  const { springs, leaves } = setup();
  springs.setHold(42, 20);
  for (let i = 0; i < 120; i++) springs.step(1 / 60);
  leaves.applyBends();
  const bend = leaves.group.children[2].geometry.getAttribute('iBend');
  assert.ok(Math.abs(bend.array[42] - springs.angle[42]) < 1e-6 && bend.array[42] > 15);
  assert.deepEqual(bend.updateRanges, [{ start: 42, count: 1 }]);
});

test('a positive bend moves the midpoint the way the layout says', () => {
  const { data, springs, leaves } = setup();
  leaves.update(0, noGust);
  const before = leaves.midpoint(7);
  springs.setHold(7, 10);
  for (let i = 0; i < 180; i++) springs.step(1 / 60);
  const after = leaves.midpoint(7);
  const moved = (after.x - before.x) * data[7].ux + (after.y - before.y) * data[7].uy;
  assert.ok(moved > 2, `moved ${moved} along u`);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … leaves.js`.

- [ ] **Step 3: Implement** — `scene/src/leaves.js`:

```js
import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H, LIGHTS } from './wall.js';
import { swayAt, gustAt, shaderTime } from './wind.js';
import { leafColour } from './leaf-colour.js';
import { WIND_GLSL } from './photo-layer.js';

const PETIOLE = 6, BLADE = 38;   // matches LEAF_LENGTH (44) in leaf-layout.js
const SEGMENTS = 10;

// One blade template: SEGMENTS rows along the midrib, three columns (left edge,
// midrib, right edge). The vertex shader gives it each leaf's shape, size and pose.
function bladeGeometry(count) {
  const blade = [], index = [];
  for (let i = 0; i <= SEGMENTS; i++) for (const side of [-1, 0, 1]) blade.push(side, i / SEGMENTS);
  for (let i = 0; i < SEGMENTS; i++) {
    for (let c = 0; c < 2; c++) {
      const a = i * 3 + c, b = a + 1, d = a + 3, e = a + 4;
      index.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aBlade', new THREE.Float32BufferAttribute(blade, 2));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((blade.length / 2) * 3), 3));
  g.setIndex(index);
  g.instanceCount = count;
  return g;
}

const VERTEX = /* glsl */ `
  ${WIND_GLSL}
  attribute vec2 aBlade;                 // side (-1 left edge .. 1 right edge), s (0 base .. 1 tip)
  attribute vec2 iBase;                  // stem base, wall units
  attribute float iAngle, iBend, iDeep;  // degrees clockwise from up; cursor bend; deep leaf
  attribute vec3 iSize;                  // scale, foreshortening, shape (0 heart, 1 lance, 2 ovate)
  attribute vec3 iColour;
  attribute vec4 iWind;                  // sway amplitude (deg), sway phase (s), gust amplitude (deg), gust delay (s)
  uniform vec2 uOffset;                  // shadow offset, world units
  varying vec3 vColour, vNormal;
  varying vec2 vWall;
  varying float vSide, vDeep;
  float halfWidth(float shape, float s) {
    if (shape < 0.5) return 11.5 * pow(max(sin(3.14159 * pow(s, 0.7)), 0.0), 0.9);
    if (shape < 1.5) return 7.0 * pow(max(sin(3.14159 * s), 0.0), 0.8);
    return 12.5 * pow(max(sin(3.14159 * pow(s, 0.85)), 0.0), 0.8);
  }
  void main() {
    float side = aBlade.x, s = aBlade.y;
    vec2 local = vec2(side * halfWidth(iSize.z, s) * iSize.y, ${PETIOLE.toFixed(1)} + s * ${BLADE.toFixed(1)}) * iSize.x;
    vec3 n = normalize(vec3(-side * 0.45 * iSize.y, -0.3 * (s - 0.5), 1.0));   // midrib fold + curl
    float deg = iAngle + iWind.x * swayAt(iBase.x, iWind.y) + iWind.z * gustAt(iBase.x, iWind.w) + iBend;
    float c = cos(radians(deg)), k = sin(radians(deg));
    // Clockwise on screen, world y up: local (0, 1) -> (sin, cos).
    vec2 r = vec2(local.x * c + local.y * k, -local.x * k + local.y * c);
    vNormal = normalize(vec3(n.x * c + n.y * k, -n.x * k + n.y * c, n.z));
    vec3 world = vec3(iBase.x + r.x + uOffset.x, -iBase.y + r.y + uOffset.y, 0.0);
    vWall = vec2(world.x, -world.y);
    vColour = iColour; vSide = side; vDeep = iDeep;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uLights[${LIGHTS.length}];
  uniform float uWet, uShadow;
  varying vec3 vColour, vNormal;
  varying vec2 vWall;
  varying float vSide, vDeep;
  void main() {
    if (uShadow > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.28); return; }
    vec3 n = normalize(vNormal), p = vec3(vWall.x, -vWall.y, 0.0);
    vec3 light = vec3(0.92), spec = vec3(0.0);
    for (int i = 0; i < ${LIGHTS.length}; i++) {
      vec3 L = uLights[i] - p;
      float d = length(L);
      L /= d;
      float fall = 1.0 / (1.0 + (d / 260.0) * (d / 260.0));
      light += vec3(1.0, 0.86, 0.64) * max(dot(n, L), 0.0) * fall * 0.18;
      vec3 h = normalize(L + vec3(0.0, 0.0, 1.0));
      spec += vec3(1.0, 0.92, 0.78) * pow(max(dot(n, h), 0.0), mix(28.0, 70.0, uWet)) * fall * mix(0.25, 0.7, uWet);
    }
    float edge = smoothstep(0.6, 1.0, abs(vSide)), rib = 1.0 - smoothstep(0.0, 0.07, abs(vSide));
    vec3 albedo = vColour * mix(1.0, 0.85, uWet) * (1.0 - 0.22 * edge) + vec3(0.05, 0.07, 0.03) * rib;
    gl_FragColor = vec4(albedo * light + spec * (1.0 - 0.6 * vDeep), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Thin static stems from each planter pocket to its leaf's base.
function stemGeometry(leaves, random) {
  const pos = [], width = 0.65;
  for (const l of leaves) {
    const cx = (l.pocketX + l.x) / 2 + random.range(-3, 3), cy = (l.pocketY + l.y) / 2 + random.range(-3, 3);
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
      pts.push([a * l.pocketX + b * cx + c * l.x, a * l.pocketY + b * cy + c * l.y]);
    }
    for (let i = 0; i < 5; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1, nx = (-(y1 - y0) / len) * width, ny = ((x1 - x0) / len) * width;
      const q = [[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny]].map(([x, y]) => [x, -y, 0]);
      pos.push(...q[0], ...q[1], ...q[2], ...q[1], ...q[3], ...q[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/**
 * The front leaves. `leaves` comes from generateLeaves(); `pixels` is the photo
 * scaled down (ImageData) for colours; `springs` from createSprings().
 */
export function createLeaves(leaves, pixels, random, springs) {
  const n = leaves.length;
  const g = bladeGeometry(n);
  const attr = (name, size, fill, usage) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
    leaves.forEach((l, i) => a.array.set(fill(l, i), i * size));
    if (usage) a.setUsage(usage);
    g.setAttribute(name, a);
    return a;
  };
  const colour = new THREE.Color();
  attr('iBase', 2, (l) => [l.x, l.y]);
  attr('iAngle', 1, (l) => [l.angle]);
  attr('iDeep', 1, (l) => [l.deep ? 1 : 0]);
  attr('iSize', 3, (l) => [l.scale, l.foreshorten, l.shape]);
  attr('iWind', 4, (l) => [l.swayAmp, l.swayPhase, l.gustAmp, l.gustDelay]);
  attr('iColour', 3, (l) => {
    const [r, gr, b] = leafColour(pixels, l.midX, l.midY, WALL_W, WALL_H, random, l.deep ? 0.78 : 1);
    return colour.setRGB(r / 255, gr / 255, b / 255, THREE.SRGBColorSpace).toArray();
  });
  const bend = attr('iBend', 1, () => [0], THREE.DynamicDrawUsage);

  const uniforms = {
    uTime: { value: 0 }, uGustStart: { value: -1e4 }, uGustStrength: { value: 0 },
    uLights: { value: LIGHTS.map(([x, y]) => new THREE.Vector3(x, -y, 60)) },
    uWet: { value: 0 }, uShadow: { value: 0 }, uOffset: { value: new THREE.Vector2(0, 0) },
  };
  const make = (shadow, order) => {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uShadow: { value: shadow ? 1 : 0 }, uOffset: { value: new THREE.Vector2(shadow ? 2 : 0, shadow ? -3 : 0) } },
      vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide,
      transparent: shadow, depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    return mesh;
  };
  const stems = new THREE.Mesh(stemGeometry(leaves, random), new THREE.MeshBasicMaterial({ color: '#2a4a1c', depthTest: false, depthWrite: false }));
  stems.renderOrder = 2;
  const group = new THREE.Group();
  group.add(make(true, 1), stems, make(false, 3));

  let time = 0, gust = { start: -1e4, strength: 0 };
  return {
    group,
    /** Wind time and gust for this frame, plus how wet the leaves look (0..1). */
    update(t, currentGust, wet = 0) {
      time = t; gust = currentGust;
      const wrapped = shaderTime(t, gust);
      uniforms.uTime.value = wrapped.time;
      uniforms.uGustStart.value = wrapped.gustStart;
      uniforms.uGustStrength.value = gust.strength;
      uniforms.uWet.value = wet;
    },
    /** Copy the springs' bends into the GPU buffer, uploading only the changed span. */
    applyBends() {
      const dirty = springs.takeDirty();
      if (!dirty.length) return;
      let lo = n, hi = -1;
      for (const i of dirty) { bend.array[i] = springs.angle[i]; lo = Math.min(lo, i); hi = Math.max(hi, i); }
      bend.clearUpdateRanges();
      bend.addUpdateRange(lo, hi - lo + 1);
      bend.needsUpdate = true;
    },
    /** Where leaf i's midpoint is right now (wall units), matching the shader. */
    midpoint(i) {
      const l = leaves[i];
      const deg = l.angle + l.swayAmp * swayAt(l.x, time, l.swayPhase)
        + l.gustAmp * gustAt(l.x, time, gust.start, gust.strength, l.gustDelay) + springs.angle[i];
      const len = (PETIOLE + 0.5 * BLADE) * l.scale, a = (deg * Math.PI) / 180;
      return { x: l.x + Math.sin(a) * len, y: l.y - Math.cos(a) * len };
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 52`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/leaves.js tests/leaves.test.mjs && git commit -m "Add instanced 3D front leaves with stems and shadows"
```

---

### Task 10: Downlights and logo glow

**Files:**
- Create: `scene/src/lights.js`, `scene/src/logo-glow.js`
- Test: `tests/lights.test.mjs`, `tests/logo-glow.test.mjs`

**Interfaces:**
- Consumes: `LIGHTS`, `LOGO_BOX` (Task 2); `SHADER_TIME_WRAP` (Task 3); `LOGO_GLSL` (Task 8).
- Produces: `createLights(random) → { group (beams renderOrder 7, dust 8), update(t, pxPerUnit) }`; `GLOW = { every: 11, sweep: 3.3 }`; `createLogoGlow(photoTexture) → { mesh (renderOrder 9, visible only while sweeping), update(t) }`.

- [ ] **Step 1: Write the failing tests**

`tests/lights.test.mjs` (Review Focus 1):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createLights } from '../scene/src/lights.js';
import { SHADER_TIME_WRAP } from '../scene/src/wind.js';

test('a cone and a glow for each of the six downlights, with dust drawn over them', () => {
  const [beams, dust] = createLights(createRandom(1)).group.children;
  assert.equal(beams.geometry.getAttribute('position').count, 6 * 2 * 6);
  assert.equal(dust.geometry.getAttribute('aMote').count, 18);
  assert.deepEqual([beams.renderOrder, dust.renderOrder], [7, 8]);
});

test('dust gets wrapped time and the screen scale', () => {
  const lights = createLights(createRandom(1));
  lights.update(SHADER_TIME_WRAP + 3, 1.9);
  const { uTime, uPxPerUnit } = lights.group.children[1].material.uniforms;
  assert.ok(Math.abs(uTime.value - 3) < 1e-9);
  assert.equal(uPxPerUnit.value, 1.9);
});
```

`tests/logo-glow.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../scene/vendor/three.module.js';
import { createLogoGlow, GLOW } from '../scene/src/logo-glow.js';

test('the glow shows only during the last 3.3 s of every 11 s, moving left to right', () => {
  const glow = createLogoGlow(new THREE.Texture());
  let last = -Infinity;
  for (let t = 0; t < 33; t += 0.05) {
    glow.update(t);
    const inSweep = t % GLOW.every >= GLOW.every - GLOW.sweep;
    assert.equal(glow.mesh.visible, inSweep, `t=${t.toFixed(2)}`);
    const band = glow.mesh.material.uniforms.uBand.value;
    if (inSweep && t % GLOW.every > GLOW.every - GLOW.sweep + 0.1) assert.ok(band > last);
    last = inSweep ? band : -Infinity;
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … lights.js` (and `logo-glow.js`).

- [ ] **Step 3: Implement**

`scene/src/lights.js`:

```js
import * as THREE from '../vendor/three.module.js';
import { LIGHTS } from './wall.js';
import { SHADER_TIME_WRAP } from './wind.js';

const additive = (uniforms, vertexShader, fragmentShader) => new THREE.ShaderMaterial({
  uniforms, vertexShader, fragmentShader,
  transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
});

// Warm light from the six downlights: a soft cone washing down the wall under each,
// a glow at each fixture, and a few dust motes drifting through the cones.
export function createLights(random) {
  const group = new THREE.Group();

  // Cones and glows: one quad each; the fragment shader shapes the light.
  const pos = [], centre = [], kind = [];
  const quad = (x0, y0, x1, y1, lx, ly, k) => {
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) {
      pos.push(x, -y, 0); centre.push(lx, ly); kind.push(k);
    }
  };
  for (const [lx, ly] of LIGHTS) {
    quad(lx - 190, ly, lx + 190, ly + 480, lx, ly, 0);
    quad(lx - 40, ly - 40, lx + 40, ly + 40, lx, ly, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCentre', new THREE.Float32BufferAttribute(centre, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  const beams = new THREE.Mesh(g, additive({}, /* glsl */ `
    attribute vec2 aCentre; attribute float aKind;
    varying vec2 vWall, vCentre; varying float vKind;
    void main() {
      vWall = vec2(position.x, -position.y); vCentre = aCentre; vKind = aKind;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    }`, /* glsl */ `
    varying vec2 vWall, vCentre; varying float vKind;
    void main() {
      vec2 d = vWall - vCentre;
      float i;
      if (vKind < 0.5) {
        float width = 24.0 + d.y * 0.3;
        i = exp(-1.6 * (d.x / width) * (d.x / width)) * exp(-d.y / 240.0) * smoothstep(0.0, 30.0, d.y) * 0.2;
      } else {
        float r = length(d);
        i = exp(-(r / 8.0) * (r / 8.0)) * 0.8 + exp(-(r / 26.0) * (r / 26.0)) * 0.22;
      }
      gl_FragColor = vec4(vec3(1.0, 0.84, 0.6) * i, 1.0);
      #include <colorspace_fragment>
    }`));
  beams.renderOrder = 7;
  group.add(beams);

  // Dust: positions are a pure function of time, computed in the vertex shader.
  const motes = [];
  for (const [lx, ly] of LIGHTS) {
    for (let k = 0; k < 3; k++) {
      motes.push(lx + random.range(-60, 60), ly + random.range(30, 60), random.range(9, 16), random.range(0, 16), random.range(-25, 25), random.range(0.9, 1.9));
    }
  }
  const mg = new THREE.BufferGeometry();
  const m = new Float32Array(motes);
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((m.length / 6) * 3), 3));
  const mb = new THREE.InterleavedBuffer(m, 6);
  mg.setAttribute('aMote', new THREE.InterleavedBufferAttribute(mb, 4, 0));
  mg.setAttribute('aMote2', new THREE.InterleavedBufferAttribute(mb, 2, 4));
  const moteUniforms = { uTime: { value: 0 }, uPxPerUnit: { value: 1 } };
  const dust = new THREE.Points(mg, additive(moteUniforms, /* glsl */ `
    uniform float uTime, uPxPerUnit;
    attribute vec4 aMote;    // x, y, period (s), phase (s)
    attribute vec2 aMote2;   // sideways drift, size
    varying float vAlpha;
    void main() {
      float u = fract((uTime + aMote.w) / aMote.z);
      vec2 p = vec2(aMote.x + aMote2.x * u, aMote.y + u * 110.0);
      vAlpha = sin(3.14159 * u) * 0.7;
      gl_PointSize = aMote2.y * 2.0 * uPxPerUnit;
      gl_Position = projectionMatrix * viewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
    }`, /* glsl */ `
    varying float vAlpha;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      gl_FragColor = vec4(vec3(1.0, 0.94, 0.84) * (1.0 - smoothstep(0.3, 1.0, r)) * vAlpha, 1.0);
      #include <colorspace_fragment>
    }`));
  dust.frustumCulled = false;
  dust.renderOrder = 8;
  group.add(dust);

  return {
    group,
    /** pxPerUnit: device pixels per wall unit, so motes keep their size on every screen. */
    update(t, pxPerUnit) { moteUniforms.uTime.value = t % SHADER_TIME_WRAP; moteUniforms.uPxPerUnit.value = pxPerUnit; },
  };
}
```

`scene/src/logo-glow.js`:

```js
import * as THREE from '../vendor/three.module.js';
import { LOGO_BOX } from './wall.js';
import { LOGO_GLSL } from './photo-layer.js';

export const GLOW = { every: 11, sweep: 3.3 };   // s between sweeps; s a sweep takes

// Every 11 s a band of warm light travels along the letters, lighting a soft halo on
// the leaves around them. The letters themselves stay as the photo has them.
export function createLogoGlow(photo) {
  const pad = 50, { x0, y0, x1, y1 } = LOGO_BOX;
  const uniforms = { uPhoto: { value: photo }, uBand: { value: -1e4 } };
  const geometry = new THREE.PlaneGeometry(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vWall;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWall = vec2(w.x, -w.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${LOGO_GLSL}
      uniform float uBand;
      varying vec2 vWall;
      void main() {
        vec2 p = vWall;
        float band = exp(-pow((p.x - (p.y - 500.0) * 0.4 - uBand) / 70.0, 2.0));
        if (band < 0.01) discard;
        float halo = 0.0;
        for (int r = 1; r <= 3; r++) {
          for (int i = 0; i < 8; i++) {
            float a = float(i) * 0.7853982 + float(r) * 0.4;
            halo += letterAt(p + float(r) * 5.0 * vec2(cos(a), sin(a)));
          }
        }
        halo = halo / 24.0 * (1.0 - letterAt(p));
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * band * halo * 0.6, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  mesh.position.set((x0 + x1) / 2, -(y0 + y1) / 2, 0);
  mesh.renderOrder = 9;
  return {
    mesh,
    update(t) {
      const u = ((t % GLOW.every) - (GLOW.every - GLOW.sweep)) / GLOW.sweep;
      mesh.visible = u >= 0 && u <= 1;
      uniforms.uBand.value = x0 - 330 + u * (x1 - x0 + 640);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 55`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/lights.js scene/src/logo-glow.js tests/lights.test.mjs tests/logo-glow.test.mjs && git commit -m "Add downlight cones, dust and the logo light sweep"
```

---

### Task 11: Butterflies (drawing)

**Files:**
- Create: `scene/src/butterflies.js`
- Test: `tests/butterflies.test.mjs`

**Interfaces:**
- Consumes: `Flyer` objects from the brain (Task 6).
- Produces: `createButterflies() → { group, update(flyers) }`. Each flyer gets a rig (two mirrored wing sides that rotate about the body axis by `(1 − flap) × 1.35` rad, a body, a spot) and a shadow rig; rigs are pooled per species.

- [ ] **Step 1: Write the failing test** — `tests/butterflies.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createButterflies } from '../scene/src/butterflies.js';

const flyer = (id, species, flap = 1) => ({ id, species, x: 500, y: 400, heading: 0.5, flap, state: 'wandering' });
const visible = (group) => group.children.filter((c) => c.visible).length;

test('each flyer gets a butterfly and a shadow; leavers are hidden and reused', () => {
  const b = createButterflies();
  b.update([flyer(1, 'orange'), flyer(2, 'cream')]);
  assert.equal(visible(b.group), 4);
  b.update([flyer(2, 'cream')]);
  assert.equal(visible(b.group), 2);
  const built = b.group.children.length;
  b.update([flyer(2, 'cream'), flyer(3, 'orange')]);
  assert.equal(b.group.children.length, built, 'the orange rig was reused');
  b.update([]);
  assert.equal(visible(b.group), 0);
});

test('wings fold toward the viewer as they close', () => {
  const b = createButterflies();
  b.update([flyer(1, 'orange', 1)]);
  const main = b.group.children.find((c) => c.visible && c.children.length === 3);
  assert.ok(Math.abs(main.children[0].rotation.x) < 1e-9, "open wings lie flat");
  b.update([flyer(1, 'orange', 0)]);
  assert.ok(Math.abs(main.children[0].rotation.x + 1.35) < 1e-9 && Math.abs(main.children[1].rotation.x - 1.35) < 1e-9);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … butterflies.js`.

- [ ] **Step 3: Implement** — `scene/src/butterflies.js`:

```js
import * as THREE from '../vendor/three.module.js';

// Draws what butterfly-brain.js decides: up to two butterflies, each a body and two
// hinged wing pairs that fold toward the viewer to flap, plus a soft shadow.
const PALETTES = {
  orange: { inner: '#ffb347', outer: '#e06a12', edge: '#241208', spot: '#ffffff', body: '#241208' },
  cream: { inner: '#fffaf0', outer: '#eadba6', edge: '#5a4a2a', spot: '#3a3020', body: '#3a3020' },
};
const MAX_FOLD = 1.35;   // radians of wing fold when fully closed

// One side's wings, head toward +x, wings toward +y (world, y up).
function wingShapes() {
  const fore = new THREE.Shape();
  fore.moveTo(1, 1);
  fore.bezierCurveTo(3, 9, 7, 15, 7.5, 18.5);
  fore.bezierCurveTo(3, 19.5, -3.5, 15.5, -4.5, 10.5);
  fore.bezierCurveTo(-4.5, 6, -2.5, 3, 1, 1);
  const hind = new THREE.Shape();
  hind.moveTo(-1, 1);
  hind.bezierCurveTo(-3, 6, -6, 11, -9.5, 11.5);
  hind.bezierCurveTo(-12.5, 11, -11.5, 5.5, -7.5, 2.5);
  hind.bezierCurveTo(-5, 1, -3, 0.6, -1, 1);
  return [fore, hind];
}

function wingMesh(shape, palette, shadow, order) {
  const g = new THREE.ShapeGeometry(shape, 8);
  const inner = new THREE.Color(palette.inner), outer = new THREE.Color(palette.outer), c = new THREE.Color();
  const p = g.getAttribute('position'), colours = [];
  for (let i = 0; i < p.count; i++) {
    c.copy(inner).lerp(outer, Math.min(1, Math.hypot(p.getX(i), p.getY(i)) / 17));
    colours.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const fill = new THREE.Mesh(g, shadow
    ? new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: false, depthWrite: false })
    : new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  fill.renderOrder = order + 1;
  if (shadow) return [fill];
  const edge = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: palette.edge, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
  edge.scale.setScalar(1.1);
  edge.renderOrder = order;
  return [edge, fill];
}

function makeRig(species, shadow) {
  const palette = PALETTES[species], order = shadow ? 4 : 5;
  const root = new THREE.Group(), sides = [];
  for (const sign of [1, -1]) {
    const side = new THREE.Group();
    for (const shape of wingShapes()) for (const mesh of wingMesh(shape, palette, shadow, order * 10)) side.add(mesh);
    if (!shadow) {
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.8, 8), new THREE.MeshBasicMaterial({ color: palette.spot, depthTest: false, depthWrite: false }));
      spot.position.set(5.8, 16.6, 0);
      spot.renderOrder = order * 10 + 2;
      side.add(spot);
    }
    side.scale.y = sign;          // the -y side is a mirror image
    sides.push(side);
    root.add(side);
  }
  if (!shadow) {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 11, 4, 8), new THREE.MeshBasicMaterial({ color: palette.body, depthTest: false, depthWrite: false }));
    body.rotation.z = Math.PI / 2;
    body.renderOrder = order * 10 + 3;
    root.add(body);
  }
  return { root, sides };
}

export function createButterflies() {
  const group = new THREE.Group();
  const rigs = new Map();                       // flyer id -> { main, shadow }
  const pool = { orange: [], cream: [] };
  const take = (species) => pool[species].pop() ?? (() => {
    const pair = { species, main: makeRig(species, false), shadow: makeRig(species, true) };
    group.add(pair.shadow.root, pair.main.root);
    return pair;
  })();
  const pose = (rig, b, dx, dy) => {
    rig.root.visible = true;
    rig.root.position.set(b.x + dx, -b.y + dy, 0);
    rig.root.rotation.z = -b.heading;
    const fold = (1 - b.flap) * MAX_FOLD;
    rig.sides[0].rotation.x = -fold;
    rig.sides[1].rotation.x = fold;
  };
  return {
    group,
    /** flyers: butterfly-brain's list. */
    update(flyers) {
      const seen = new Set();
      for (const b of flyers) {
        seen.add(b.id);
        if (!rigs.has(b.id)) rigs.set(b.id, take(b.species));
        const pair = rigs.get(b.id);
        const lift = b.state === 'resting' ? 1.5 : 4;   // the shadow falls further while flying
        pose(pair.main, b, 0, 0);
        pose(pair.shadow, b, lift, -lift * 1.6);
      }
      for (const [id, pair] of rigs) {
        if (seen.has(id)) continue;
        pair.main.root.visible = pair.shadow.root.visible = false;
        pool[pair.species].push(pair);
        rigs.delete(id);
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 57`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/butterflies.js tests/butterflies.test.mjs && git commit -m "Draw the butterflies"
```

---

### Task 12: Mist (Water)

**Files:**
- Create: `scene/src/mist.js`
- Test: `tests/mist.test.mjs`

**Interfaces:**
- Consumes: `WALL_W`, `wallTop` (Task 2).
- Produces: `MIST = { falling: 6, dryOver: 60, liftAt: 1.5 }`; `wetness(secondsSinceWatering | null) → [0, 1]`; `createMist(random, count = 900) → { points (renderOrder 6), water(t), update(t, pxPerUnit) → { wet, lift } }` — `lift` is true on exactly one frame per watering.

- [ ] **Step 1: Write the failing test** — `tests/mist.test.mjs` (Review Focus 4):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom } from '../scene/src/random.js';
import { createMist, wetness, MIST } from '../scene/src/mist.js';

test('leaves get wet over 2 s and dry over the next minute', () => {
  assert.equal(wetness(null), 0);
  assert.equal(wetness(-1), 0);
  assert.equal(wetness(1), 0.5);
  assert.equal(wetness(MIST.falling), 1);
  assert.ok(Math.abs(wetness(MIST.falling + 30) - 0.5) < 1e-9);
  assert.equal(wetness(MIST.falling + MIST.dryOver + 1), 0);
  for (let e = -5; e < 100; e += 0.1) assert.ok(wetness(e) >= 0 && wetness(e) <= 1);
});

test('the lift happens once per watering, and watering again restarts it', () => {
  const mist = createMist(createRandom(1));
  const lifts = (from, to) => { let n = 0; for (let t = from; t < to; t += 1 / 30) if (mist.update(t, 1).lift) n++; return n; };
  assert.equal(lifts(0, 5), 0, 'no lift before watering');
  mist.water(5);
  assert.equal(lifts(5, 20), 1);
  mist.water(20);
  assert.equal(lifts(20, 25), 1);
  assert.equal(mist.points.visible, true);
  assert.equal(lifts(25, 60), 0);
  assert.equal(mist.points.visible, false, 'mist hides once it has fallen');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND … mist.js`.

- [ ] **Step 3: Implement** — `scene/src/mist.js`:

```js
import * as THREE from '../vendor/three.module.js';
import { WALL_W, wallTop } from './wall.js';

export const MIST = { falling: 6, dryOver: 60, liftAt: 1.5 };

/** How wet the leaves look, `e` seconds after watering: up over 2 s, dry over 60 s. */
export function wetness(e) {
  if (e === null || e < 0) return 0;
  if (e < MIST.falling) return Math.min(1, e / 2);
  return Math.max(0, 1 - (e - MIST.falling) / MIST.dryOver);
}

// Fine mist released along the ceiling line for 6 s; it falls and fades before the pebbles.
export function createMist(random, count = 900) {
  const data = [];
  for (let i = 0; i < count; i++) {
    const x = random.range(0, WALL_W);
    data.push(x, wallTop(x), random.range(0, MIST.falling), random.range(110, 200), random.range(-10, 10), random.range(860, 975), random.range(2.5, 5), 0);
  }
  const g = new THREE.BufferGeometry();
  const buf = new THREE.InterleavedBuffer(new Float32Array(data), 8);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aStart', new THREE.InterleavedBufferAttribute(buf, 4, 0));   // x, y, delay, speed
  g.setAttribute('aPath', new THREE.InterleavedBufferAttribute(buf, 4, 4));    // drift, end y, size, -
  const uniforms = { uAge: { value: -1 }, uPxPerUnit: { value: 1 } };
  const points = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uAge, uPxPerUnit;
      attribute vec4 aStart, aPath;
      varying float vAlpha;
      void main() {
        float age = uAge - aStart.z;
        float y = aStart.y + age * aStart.w;
        vAlpha = age < 0.0 || y > aPath.y ? 0.0 : smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(aPath.y - 80.0, aPath.y, y)) * 0.45;
        gl_PointSize = aPath.z * uPxPerUnit;
        gl_Position = projectionMatrix * viewMatrix * vec4(aStart.x + aPath.x * age * 0.3, -y, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        if (vAlpha <= 0.0) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(vec3(0.85, 0.93, 1.0) * (1.0 - smoothstep(0.2, 1.0, r)) * vAlpha, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  points.frustumCulled = false;
  points.renderOrder = 6;
  points.visible = false;
  let startedAt = null, lifted = false;
  return {
    points,
    water(t) { startedAt = t; lifted = false; },
    /** Returns this frame's wetness, and whether the leaves should get their lift now. */
    update(t, pxPerUnit) {
      const e = startedAt === null ? null : t - startedAt;
      points.visible = e !== null && e < MIST.falling + 7;
      uniforms.uAge.value = e ?? -1;
      uniforms.uPxPerUnit.value = pxPerUnit;
      const lift = e !== null && !lifted && e >= MIST.liftAt;
      if (lift) lifted = true;
      return { wet: wetness(e), lift };
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: `ℹ pass 59`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/src/mist.js tests/mist.test.mjs && git commit -m "Add the Water mist and wet-leaf effect"
```

---

### Task 13: The page — boot, bridge, input and smoke test

**Files:**
- Create: `scene/index.html`, `scene/src/main.js`, `tests/smoke.sh`

**Interfaces:**
- Consumes: everything from Tasks 2–12.
- Produces: the five `window.wall*` bridge functions (queued until the scene is ready); `postMessage` `ready` / `failed` to the host; browser input (pointer, click → water, Space → pause); query parameters `?seed`, `?t`, `?water`, `?debug`, `?smoke`; the `SMOKE {json}` console line `{ webgl2, bridge, mean, sd, nonBlank }` that `tests/smoke.sh` and the host's `--check` read.

- [ ] **Step 1: Write the failing smoke test** — `tests/smoke.sh` (Review Focus 2: it also runs at 1920×1080):

```sh
#!/bin/sh
# Loads the scene in headless Chrome at a frozen time and checks that it draws.
# Needs Google Chrome. Writes tests/out/smoke-<size>.png for a look.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
port=${SMOKE_PORT:-8765}
out="$root/tests/out"
mkdir -p "$out"

PORT=$port node "$root/serve.mjs" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
sleep 1

status=0
# The built-in XDR display's size, then a 16:9 external display.
for size in 1512,982 1920,1080; do
	log="$out/chrome-$size.log"
	"$chrome" --headless=new --hide-scrollbars --enable-logging=stderr --v=0 \
		--window-size=$size --virtual-time-budget=20000 --screenshot="$out/smoke-$size.png" \
		"http://127.0.0.1:$port/scene/?t=${SMOKE_T:-10}&smoke" 2>"$log" >/dev/null || true
	if grep -E 'CONSOLE.*(Uncaught|Error)' "$log"; then
		echo "FAIL $size: console errors (see $log)"
		status=1
		continue
	fi
	line=$(grep -o 'SMOKE {.*}' "$log" | head -1 | sed 's/^SMOKE //') || true
	if [ -z "$line" ]; then
		echo "FAIL $size: the scene never reported (see $log)"
		status=1
		continue
	fi
	node -e '
	  const r = JSON.parse(process.argv[1]);
	  const bad = ["webgl2", "bridge", "nonBlank"].filter((k) => r[k] !== true);
	  if (bad.length) { console.log(`FAIL ${process.argv[2]}:`, bad.join(", "), JSON.stringify(r)); process.exit(1); }
	  console.log(`PASS ${process.argv[2]}`, JSON.stringify(r));
	' "$line" "$size" || status=1
done
exit $status
```

- [ ] **Step 2: Run it and see it fail**

Run: `chmod +x tests/smoke.sh && npm run smoke`
Expected: `FAIL 1512,982: the scene never reported` (there is no page yet; the server answers 404).

- [ ] **Step 3: Write the page** — `scene/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <!-- No network access of any kind: everything the scene needs is bundled. -->
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Green Wall</title>
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #070b06; }
    canvas { display: block; width: 100vw; height: 100vh; }
    #debug { position: fixed; left: 8px; top: 8px; padding: 4px 6px; border-radius: 4px;
             font: 12px ui-monospace, monospace; color: #dfe; background: #000a; }
  </style>
</head>
<body>
  <canvas id="wall"></canvas>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write the boot code** — `scene/src/main.js`. Note the `if (SMOKE)` block (Review Focus 3) and that `stats` must not be destructured with `...` (its `drawn`/`cpuMs` are live getters):

```js
import * as THREE from '../vendor/three.module.js';
import { WALL_W, WALL_H } from './wall.js';
import { coverFit, toWall } from './fit.js';
import { createRandom } from './random.js';
import { createWind } from './wind.js';
import { createFrameLoop } from './frame-loop.js';
import { generateLeaves } from './leaf-layout.js';
import { createSprings } from './leaf-springs.js';
import { createButterflyBrain } from './butterfly-brain.js';
import { createPhotoLayer } from './photo-layer.js';
import { createLeaves } from './leaves.js';
import { createLights } from './lights.js';
import { createLogoGlow } from './logo-glow.js';
import { createButterflies } from './butterflies.js';
import { createMist } from './mist.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 7);
const FREEZE = params.has('t') ? Number(params.get('t')) : null;
const DEBUG = params.has('debug'), SMOKE = params.has('smoke');
const WATER_AT = params.has('water') ? Number(params.get('water')) : null;   // with ?t=, for checking the mist
const host = window.webkit?.messageHandlers?.wall;
const post = (message) => host?.postMessage(message);
const DIP = 4;          // degrees a leaf dips under a resting butterfly
const LIFT = 1.2;       // degrees per substep the mist lifts every leaf, once

// The bridge. The host (or browser input) may call these before the scene is ready;
// until then the latest values wait in `pending`.
let live = null;
const pending = { pointer: null, paused: false, maxFps: 30, water: false };
Object.assign(window, {
  wallSetPointer: (x, y) => (live ? live.pointer(x, y) : (pending.pointer = [x, y])),
  wallPointerOut: () => (live ? live.pointerOut() : (pending.pointer = null)),
  wallWater: () => (live ? live.water() : (pending.water = true)),
  wallSetPaused: (paused) => (live ? live.setPaused(paused) : (pending.paused = Boolean(paused))),
  wallSetMaxFps: (fps) => (live ? live.setMaxFps(fps) : (pending.maxFps = fps)),
});

/** The photo drawn small, for sampling leaf colours. */
function photoPixels(image, width = 400) {
  const height = Math.round((width * image.height) / image.width);
  const ctx = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

// Smoke runs exercise the queue: these calls arrive before the scene exists.
if (SMOKE) {
  window.wallSetMaxFps(15); window.wallSetPaused(false);
  window.wallSetPointer(100, 100); window.wallPointerOut(); window.wallWater();
}

const loadTexture = (url) => new Promise((resolve, reject) => {
  new THREE.TextureLoader().load(url, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex); },
    undefined, () => reject(new Error(`could not load ${url}`)));
});

async function boot() {
  const canvas = document.getElementById('wall');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const camera = new THREE.OrthographicCamera(0, WALL_W, 0, -WALL_H, -100, 100);
  const world = new THREE.Scene();
  const photo = await loadTexture('assets/wall.jpg');

  const random = createRandom(SEED);
  const wind = createWind(random);
  const photoLayer = createPhotoLayer(photo, random);
  const leafData = generateLeaves(random);
  const springs = createSprings(leafData);
  const leaves = createLeaves(leafData, photoPixels(photo.image), random, springs);
  const lights = createLights(random);
  const glow = createLogoGlow(photo);
  const mist = createMist(random);
  const butterflies = createButterflies();
  const brain = createButterflyBrain({
    random: createRandom(SEED + 1),
    perches: leafData.map((l, index) => ({ index, x: l.midX, y: l.midY })),
    perchPosition: (i) => leaves.midpoint(i),
  });
  world.add(photoLayer.mesh, leaves.group, butterflies.group, mist.points, lights.group, glow.mesh);

  let fit = coverFit(innerWidth, innerHeight), pxPerUnit = 1;
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    fit = coverFit(innerWidth, innerHeight);
    pxPerUnit = (innerHeight * renderer.getPixelRatio()) / fit.h;
    Object.assign(camera, { left: fit.x0, right: fit.x0 + fit.w, top: -fit.y0, bottom: -(fit.y0 + fit.h) });
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  let simTime = 0, cpuMs = 0, frameMs = 0, measure = false, drawn = 0, pointer = null;
  const onePixel = new Uint8Array(4);
  const held = new Map();                          // leaf index -> resting butterfly id
  function holdPerches() {
    const now = new Map(brain.flyers.filter((b) => b.state === 'resting').map((b) => [b.perch, b.id]));
    for (const i of held.keys()) if (!now.has(i)) springs.setHold(i, 0);
    for (const i of now.keys()) if (!held.has(i)) springs.setHold(i, DIP * Math.sign(leafData[i].angle || 1));
    held.clear();
    for (const [i, id] of now) held.set(i, id);
  }
  function simulate(dt, t) {
    simTime = t;
    const gust = wind.current(t);
    const { wet, lift } = mist.update(t, pxPerUnit);
    if (lift) leafData.forEach((l, i) => springs.impulse(i, -LIFT * Math.sign(l.angle || 1)));
    springs.step(dt);
    leaves.update(t, gust, wet);
    brain.tick(dt, pointer);
    holdPerches();
    photoLayer.update(t, gust);
    lights.update(t, pxPerUnit);
    glow.update(t);
  }
  function draw(dt, t) {
    const start = performance.now();
    simulate(dt, t);
    leaves.applyBends();
    butterflies.update(brain.flyers);
    renderer.render(world, camera);
    cpuMs = performance.now() - start;
    if (measure) {
      // Reading one pixel back waits for the GPU, so this is the whole frame's cost.
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, onePixel);
      frameMs = performance.now() - start;
      measure = false;
    }
    drawn++;
  }
  const loop = createFrameLoop(draw);

  live = {
    pointer(px, py) {
      const p = toWall(fit, px, py, innerWidth, innerHeight);
      pointer = { x: p.x, y: p.y, inside: true };
      photoLayer.poke(p.x, p.y, simTime);
      springs.setPointer(p.x, p.y, simTime);
    },
    pointerOut() { pointer = null; springs.pointerOut(); },
    water() { if (loop.running) mist.water(simTime); },
    setPaused: (paused) => loop.setPaused(paused),
    setMaxFps: (fps) => loop.setMaxFps(fps),
  };
  /** Run the simulation from 0 to t without drawing, so a frozen frame shows what t would. */
  function fastForward(t) {
    for (let s = 1 / 30; s <= t; s += 1 / 30) {
      if (WATER_AT !== null && s - 1 / 30 < WATER_AT && s >= WATER_AT) mist.water(s);
      simulate(1 / 30, s);
    }
  }
  return {
    renderer, loop, fastForward,
    get cpuMs() { return cpuMs; }, get frameMs() { return frameMs; }, get drawn() { return drawn; },
    measureNextFrame() { measure = true; },
  };
}

function smokeReport(renderer) {
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(4), lum = [];
  for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
    gl.readPixels(Math.floor((w * i) / 8), Math.floor((h * j) / 8), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    lum.push((0.3 * px[0] + 0.59 * px[1] + 0.11 * px[2]) / 255);
  }
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
  const bridge = ['wallSetPointer', 'wallPointerOut', 'wallWater', 'wallSetPaused', 'wallSetMaxFps'].every((f) => typeof window[f] === 'function');
  console.log(`SMOKE ${JSON.stringify({ webgl2: gl instanceof WebGL2RenderingContext, bridge, mean, sd, nonBlank: mean > 0.03 && mean < 0.95 && sd > 0.02 })}`);
}

boot().then((stats) => {
  // Keep `stats` whole: its drawn/cpuMs are live getters (spreading would copy them once).
  const { renderer, loop, fastForward } = stats;
  if (!host) {
    addEventListener('pointermove', (e) => window.wallSetPointer(e.clientX, e.clientY));
    document.documentElement.addEventListener('pointerleave', () => window.wallPointerOut());
    addEventListener('click', () => window.wallWater());
    addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      pending.paused = !pending.paused;
      window.wallSetPaused(pending.paused);
    });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) pending.paused = true;
  }
  document.addEventListener('visibilitychange', () => loop.setHidden(document.hidden));
  if (FREEZE !== null) {
    // Frozen at one instant (?t=): keep redrawing it, so screenshots always have a frame.
    loop.setPaused(true);
    fastForward(FREEZE);
    loop.renderAt(FREEZE);
    if (SMOKE) smokeReport(renderer);
    const hold = () => { loop.renderAt(FREEZE); requestAnimationFrame(hold); };
    requestAnimationFrame(hold);
  } else {
    loop.setMaxFps(pending.maxFps);
    loop.setPaused(pending.paused);
    if (pending.pointer) window.wallSetPointer(...pending.pointer);
    loop.start();
    if (pending.water) window.wallWater();
  }
  if (DEBUG) {
    const panel = Object.assign(document.createElement('div'), { id: 'debug' });
    document.body.append(panel);
    let before = stats.drawn;
    setInterval(() => {
      stats.measureNextFrame();
      panel.textContent = `${stats.drawn - before} fps · ${stats.cpuMs.toFixed(1)} ms cpu · ${stats.frameMs.toFixed(1)} ms frame`;
      console.log(`DEBUG ${panel.textContent}`);
      before = stats.drawn;
    }, 1000);
  }
  post({ type: 'ready' });
}).catch((error) => {
  console.error(error);
  post({ type: 'failed', reason: String(error?.message ?? error) });
});
```

- [ ] **Step 5: Run the smoke test**

Run: `npm run smoke`
Expected, two lines:
```
PASS 1512,982 {"webgl2":true,"bridge":true,"mean":0.11…,"sd":0.12…,"nonBlank":true}
PASS 1920,1080 {"webgl2":true,"bridge":true,"mean":0.12…,"sd":0.15…,"nonBlank":true}
```

- [ ] **Step 6: Look at the frames**

Open `tests/out/smoke-1512,982.png` and `tests/out/smoke-1920,1080.png`. Expect: the photo edge to edge with ceiling and downlights at the top (also at 16:9); 3D leaves in the photo's colours with soft shadows, indistinguishable at a glance from the photo's own; the logo crisp white with a warm halo around its right-hand letters (the sweep at t = 10 s); a cream butterfly in flight left of the logo; soft warm cones under the lights with a few dust specks. For the mist: `npm start`, then open `http://127.0.0.1:8080/scene/?t=25&water=21` — fine white specks across the wall.

- [ ] **Step 7: Try it live in a browser**

Run: `npm start`, open `http://127.0.0.1:8080/scene/?debug`. Check: leaves sway; a gust rolls left→right roughly every 15–40 s through both the photo and the 3D leaves; leaves bend away from the pointer and spring back; click → mist; Space → pause/resume; a butterfly arrives within ~12 s. The overlay should read `30 fps · <1 ms cpu · <8 ms frame` on the XDR display at full screen. Stop the server with Ctrl+C.

- [ ] **Step 8: Run all tests**

Run: `npm test && npm run smoke`
Expected: `ℹ pass 59`, then two `PASS` lines.

- [ ] **Step 9: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add scene/index.html scene/src/main.js tests/smoke.sh && git commit -m "Boot the scene with the host bridge and a smoke test"
```

---

### Task 14: Coverage maths (Swift)

**Files:**
- Create: `mac/Coverage.swift`
- Test: `mac/tests/coverage-test.swift`

**Interfaces:**
- Produces: `visibleFraction(of screen: CGRect, blockers: [CGRect], columns: Int = 32, rows: Int = 20) -> Double` (global CoreGraphics coordinates, top-left origin; overlaps counted once) and `frameCap(visible: Double) -> Int` (30 / 15 / 0 at 0.40 and 0.05).

- [ ] **Step 1: Write the failing test** — `mac/tests/coverage-test.swift`:

```swift
// Checks the coverage maths. XCTest needs full Xcode, so this is a plain program:
// swiftc -parse-as-library mac/Coverage.swift mac/tests/coverage-test.swift
import CoreGraphics
import Foundation

@main
enum CoverageTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  static func main() {
    let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
    let left = CGRect(x: 0, y: 0, width: 756, height: 982)
    let middle = CGRect(x: 378, y: 0, width: 756, height: 982)

    check(visibleFraction(of: screen, blockers: []) == 1, "no windows: all visible")
    check(visibleFraction(of: screen, blockers: [screen]) == 0, "one full-screen window: none visible")
    check(abs(visibleFraction(of: screen, blockers: [left]) - 0.5) < 0.01, "half covered: half visible")
    check(
      abs(visibleFraction(of: screen, blockers: [left, middle]) - 0.25) < 0.01,
      "two overlapping half windows: overlap counted once")
    let other = CGRect(x: 1512, y: 0, width: 1920, height: 1080)
    check(visibleFraction(of: screen, blockers: [other]) == 1, "a window on another screen does not count")
    check(frameCap(visible: 1) == 30 && frameCap(visible: 0.40) == 30, "mostly visible: 30 fps")
    check(frameCap(visible: 0.39) == 15 && frameCap(visible: 0.05) == 15, "mostly covered: 15 fps")
    check(frameCap(visible: 0.049) == 0 && frameCap(visible: 0) == 0, "almost fully covered: stopped")
    exit(failures == 0 ? 0 : 1)
  }
}
```

- [ ] **Step 2: Compile it and see it fail**

Run: `mkdir -p build && swiftc -parse-as-library -swift-version 5 -o build/coverage-test mac/tests/coverage-test.swift`
Expected: `error: cannot find 'visibleFraction' in scope` (and `frameCap`).

- [ ] **Step 3: Implement** — `mac/Coverage.swift`:

```swift
import CoreGraphics

/// How much of a screen no app window covers, from 0 (none of it) to 1 (all of it).
/// `screen` and `blockers` are in global CoreGraphics coordinates (top-left origin).
/// The screen is sampled on a grid, so overlapping windows are counted once.
func visibleFraction(of screen: CGRect, blockers: [CGRect], columns: Int = 32, rows: Int = 20) -> Double {
  let relevant = blockers.filter { $0.intersects(screen) }
  guard !relevant.isEmpty else { return 1 }
  var free = 0
  for column in 0..<columns {
    for row in 0..<rows {
      let point = CGPoint(
        x: screen.minX + screen.width * (Double(column) + 0.5) / Double(columns),
        y: screen.minY + screen.height * (Double(row) + 0.5) / Double(rows))
      if !relevant.contains(where: { $0.contains(point) }) { free += 1 }
    }
  }
  return Double(free) / Double(columns * rows)
}

/// The frame-rate cap for a screen whose desktop is this visible.
func frameCap(visible: Double) -> Int {
  visible >= 0.40 ? 30 : visible >= 0.05 ? 15 : 0
}
```

- [ ] **Step 4: Compile and run**

Run: `swiftc -parse-as-library -swift-version 5 -o build/coverage-test mac/Coverage.swift mac/tests/coverage-test.swift && build/coverage-test`
Expected: eight `ok` lines, exit status 0. Add `build/` to `.gitignore`: `printf 'build/\n' >> .gitignore`.

- [ ] **Step 5: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add mac/Coverage.swift mac/tests/coverage-test.swift .gitignore && git commit -m "Add desktop coverage maths for the power policy"
```

---

### Task 15: The macOS host

**Files:**
- Create: `mac/GreenWall.swift`, `mac/Info.plist`, `mac/build.sh`, `mac/tests/run.sh`

**Interfaces:**
- Consumes: `visibleFraction`, `frameCap` (Task 14); the scene and its bridge (Task 13).
- Produces: `Green Wall.app`. Modes: no arguments → the wallpaper; `--check` → loads `green-wall://local/index.html?t=10&smoke` in a hidden web view and exits 0 only on a non-blank WebGL2 frame; `--restore-desktop-picture` → restores the pictures saved at first launch and exits. `mac/build.sh [app path]` assembles and ad-hoc signs the bundle.

- [ ] **Step 1: Write the failing test runner** — `mac/tests/run.sh`:

```sh
#!/bin/sh
# The macOS host's tests: the coverage maths, then the real scene loading in WebKit
# through the app's own --check mode. Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -parse-as-library -swift-version 5 -o "$build/coverage-test" "$here/Coverage.swift" "$here/tests/coverage-test.swift"
"$build/coverage-test"

sh "$here/build.sh" "$build/Green Wall.app"
"$build/Green Wall.app/Contents/MacOS/Green Wall" --check
```

- [ ] **Step 2: Run it and see it fail**

Run: `chmod +x mac/tests/run.sh && npm run test:mac`
Expected: the eight coverage `ok` lines, then `sh: …/mac/build.sh: No such file or directory` and a non-zero exit.

- [ ] **Step 3: Write `mac/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>Green Wall</string>
	<key>CFBundleIdentifier</key>
	<string>local.green-wall</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Green Wall</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
	<key>NSSupportsAutomaticTermination</key>
	<false/>
</dict>
</plist>
```

- [ ] **Step 4: Write `mac/build.sh`**

```sh
#!/bin/sh
# Assemble "Green Wall.app" at the path given (default: build/Green Wall.app):
# compile the host, add the scene, sign it ad hoc. Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
app=${1:-"$project/build/Green Wall.app"}

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
# Built for this Mac's own architecture; the binary never leaves it.
swiftc -O -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
	-o "$app/Contents/MacOS/Green Wall" "$here/GreenWall.swift" "$here/Coverage.swift" \
	-framework Cocoa -framework WebKit
cp "$here/Info.plist" "$app/Contents/Info.plist"
# No trailing slash on the source: with one, cp copies the folder's contents instead.
cp -R "$project/scene" "$app/Contents/Resources/"
codesign --force --sign - "$app" >/dev/null 2>&1 || echo "note: ad-hoc signing failed; the app still runs locally" >&2
echo "Built $app"
```

- [ ] **Step 5: Write `mac/GreenWall.swift`**

Key points, all from spec §5 and §9: desktop-level, click-through window per screen; the private `green-wall://` scheme; WebKit occlusion detection off; cursor forwarded only over visible desktop; coverage every 1.5 s; status line explains every stillness; `DesktopPicture` saves the user's picture once and never its own; content-process crashes reload with 2 s → 60 s backoff.

```swift
// Green Wall: the Cefalo green wall, alive, as the desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// desktop picture, below the icons, and it never takes a mouse event, so the desktop
// works as usual. Each window shows the bundled scene in a web view. The scene is
// served over a private URL scheme because file:// allows neither ES module imports
// nor reading the photo's pixels. The cursor position is read on a timer and handed to
// the scene; nothing else about the user's session is read except window positions.

import Cocoa
import WebKit

let scheme = "green-wall"
let sceneURL = URL(string: "\(scheme)://local/index.html")!

func log(_ message: String) { NSLog("green-wall: \(message)") }

/// Serves the scene folder inside the app bundle to the web views.
final class SceneHandler: NSObject, WKURLSchemeHandler {
  private let root: URL
  private static let types = [
    "html": "text/html", "js": "text/javascript", "css": "text/css",
    "json": "application/json", "jpg": "image/jpeg", "png": "image/png",
  ]

  init(root: URL) { self.root = root.standardizedFileURL }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let path = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
    let file = root.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
      return
    }
    let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil))
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Relays the page's messages ({type: "ready" | "failed" | "log", ...}) to a closure.
final class PageMessages: NSObject, WKScriptMessageHandler {
  var handler: ([String: Any]) -> Void = { _ in }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    handler(message.body as? [String: Any] ?? ["type": "log", "message": "\(message.body)"])
  }
}

/// Forwards console errors and warnings (and the smoke report) to the host's log.
let consoleScript = """
  (() => {
    const post = (level, parts) => window.webkit?.messageHandlers?.wall?.postMessage({
      type: 'log', level, message: parts.map((p) => (p && p.stack) || String(p)).join(' ') });
    for (const level of ['error', 'warn']) {
      const original = console[level];
      console[level] = (...parts) => { post(level, parts); original.apply(console, parts); };
    }
    const log = console.log;
    console.log = (...parts) => { if (String(parts[0]).startsWith('SMOKE ')) post('smoke', parts); log.apply(console, parts); };
    addEventListener('error', (e) => post('error', [`${e.message} at ${e.filename}:${e.lineno}`]));
    addEventListener('unhandledrejection', (e) => post('error', [e.reason]));
  })();
  """

func makeWebView(frame: NSRect, root: URL, messages: PageMessages) -> WKWebView {
  let settings = WKWebViewConfiguration()
  settings.setURLSchemeHandler(SceneHandler(root: root), forURLScheme: scheme)
  settings.suppressesIncrementalRendering = true
  settings.websiteDataStore = .nonPersistent()
  settings.userContentController.addUserScript(
    WKUserScript(source: consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  settings.userContentController.add(messages, name: "wall")
  let view = WKWebView(frame: frame, configuration: settings)
  // WebKit stops drawing a page whose window it thinks is covered, and AppKit never
  // reports a desktop-level agent window as visible, so the scene would never start.
  // The host works out what is covered itself (Coverage.swift).
  if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
    || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
  {
    view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
  }
  view.autoresizingMask = [.width, .height]
  return view
}

/// A window that keeps the exact frame it is given (AppKit insets ordinary windows).
final class DesktopWindow: NSWindow {
  override func constrainFrameRect(_ rect: NSRect, to screen: NSScreen?) -> NSRect { rect }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

let wallBackground = NSColor(calibratedRed: 0.027, green: 0.043, blue: 0.024, alpha: 1)

/// One screen's wall.
final class Wallpaper: NSObject, WKNavigationDelegate {
  let window: DesktopWindow
  let view: WKWebView
  private let messages = PageMessages()
  private(set) var failed = false
  private var loaded = false
  private var rate = -1
  private var paused = false
  private var inside = false
  private var crashes = 0
  private var stableSince = Date()

  init(screen: NSScreen, root: URL) {
    view = makeWebView(frame: screen.frame, root: root, messages: messages)
    window = DesktopWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false, screen: screen)
    super.init()
    messages.handler = { [weak self] message in self?.received(message) }
    view.navigationDelegate = self
    view.underPageBackgroundColor = wallBackground
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.ignoresMouseEvents = true
    window.isOpaque = true
    window.hasShadow = false
    window.backgroundColor = wallBackground
    window.isReleasedWhenClosed = false
    window.canHide = false
    window.contentView = view
    window.setFrame(screen.frame, display: true)
    window.orderFrontRegardless()
    view.load(URLRequest(url: sceneURL))
  }

  func close() {
    view.navigationDelegate = nil
    view.configuration.userContentController.removeScriptMessageHandler(forName: "wall")
    view.removeFromSuperview()
    window.contentView = nil
    window.orderOut(nil)
    window.close()
  }

  private func received(_ message: [String: Any]) {
    switch message["type"] as? String {
    case "ready":
      failed = false
    case "failed":
      failed = true
      log("the scene failed: \(message["reason"] ?? "unknown")")
      window.orderOut(nil)   // the still desktop picture shows instead
    default:
      log("page \(message["level"] ?? "log"): \(message["message"] ?? "")")
    }
  }

  /// Frame-rate cap for this screen; 0 halts it. Sent only on change.
  func setRate(_ wanted: Int) {
    guard wanted != rate else { return }
    rate = wanted
    if rate == 0 { setPointer(nil) }
    send()
  }

  func setPaused(_ wanted: Bool) {
    guard wanted != paused else { return }
    paused = wanted
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript("wallSetMaxFps(\(max(rate, 0))); wallSetPaused(\(paused))")
  }

  func water() {
    guard loaded, rate > 0, !paused else { return }
    view.evaluateJavaScript("wallWater()")
  }

  /// Cursor position in this window's top-left coordinates, or nil when it is not over
  /// this screen's visible desktop.
  func setPointer(_ point: NSPoint?) {
    guard loaded else { return }
    guard let point, rate > 0 else {
      if inside { view.evaluateJavaScript("wallPointerOut()") }
      inside = false
      return
    }
    inside = true
    view.evaluateJavaScript(String(format: "wallSetPointer(%.1f,%.1f)", point.x, point.y))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    send()
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    log("the scene did not load: \(error.localizedDescription)")
  }

  /// WebKit's content process died: reload after 2 s, doubling up to 60 s; the backoff
  /// resets after five minutes of stable running.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loaded = false
    if Date().timeIntervalSince(stableSince) > 300 { crashes = 0 }
    let wait = min(60, 2 * pow(2, Double(crashes)))
    crashes += 1
    log("the web content process ended; reloading in \(Int(wait)) s")
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
      guard let self else { return }
      self.stableSince = Date()
      self.view.load(URLRequest(url: sceneURL))
    }
  }
}

/// The still photo behind the live layer, and the user's own picture to restore later.
enum DesktopPicture {
  static let savedKey = "previousDesktopPictures"
  static var folder: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Green Wall")
  }
  static var still: URL { folder.appendingPathComponent("still.jpg") }

  static func id(_ screen: NSScreen) -> String {
    "\((screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0)"
  }

  /// Copy the photo out of the bundle, remember each screen's current picture (once,
  /// and never our own), then show the photo as the desktop picture.
  static func install(photo: URL) {
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: still)
    do { try FileManager.default.copyItem(at: photo, to: still) } catch {
      log("could not copy the still picture: \(error.localizedDescription)")
      return
    }
    var saved = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    for screen in NSScreen.screens {
      let key = id(screen)
      if saved[key] == nil, let current = NSWorkspace.shared.desktopImageURL(for: screen),
        current.standardizedFileURL.path != still.standardizedFileURL.path
      {
        saved[key] = current.absoluteString
      }
      do {
        try NSWorkspace.shared.setDesktopImageURL(
          still, for: screen,
          options: [.imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true])
      } catch {
        log("could not set the desktop picture: \(error.localizedDescription)")
      }
    }
    UserDefaults.standard.set(saved, forKey: savedKey)
  }

  /// Put back the pictures saved by install(), where those files still exist.
  static func restore() {
    let saved = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    for screen in NSScreen.screens {
      guard let text = saved[id(screen)], let url = URL(string: text),
        FileManager.default.fileExists(atPath: url.path)
      else { continue }
      try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
    }
    UserDefaults.standard.removeObject(forKey: savedKey)
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var screens: [Wallpaper] = []
  private var layout: [CGRect] = []
  private var awake = true
  private var blockers: [CGRect] = []
  private var applied = 0
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var coverageTimer: Timer?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let waterItem = NSMenuItem(title: "Water", action: #selector(water), keyEquivalent: "")
  private let pauseItem = NSMenuItem(title: "Pause", action: #selector(togglePause), keyEquivalent: "")
  /// Remembered across restarts. With no choice stored yet, Reduce Motion starts it paused.
  private var paused =
    UserDefaults.standard.object(forKey: "paused") as? Bool
    ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  private var lowPower: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }

  func applicationDidFinishLaunching(_ note: Notification) {
    DesktopPicture.install(photo: root.appendingPathComponent("assets/wall.jpg"))
    build()
    addMenu()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    let workspace = NSWorkspace.shared.notificationCenter
    for (name, value) in [
      (NSWorkspace.screensDidSleepNotification, false), (NSWorkspace.screensDidWakeNotification, true),
      (NSWorkspace.sessionDidResignActiveNotification, false), (NSWorkspace.sessionDidBecomeActiveNotification, true),
    ] {
      workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    for (name, value) in [("com.apple.screenIsLocked", false), ("com.apple.screenIsUnlocked", true)] {
      DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) {
      [weak self] _ in self?.applyRate()
    }
  }

  // Showing a full-screen window is itself a screen-parameter change, so compare first.
  @objc private func screensChanged() {
    guard NSScreen.screens.map(\.frame) != layout else { return }
    build()
  }

  private func build() {
    layout = NSScreen.screens.map(\.frame)
    for screen in screens { screen.close() }
    screens = NSScreen.screens.map { Wallpaper(screen: $0, root: root) }
    applyRate()
  }

  /// Screen frames in CoreGraphics global coordinates (top-left origin), like window bounds.
  private func cgFrame(_ frame: CGRect) -> CGRect {
    let primary = NSScreen.screens.first?.frame.height ?? frame.maxY
    return CGRect(x: frame.minX, y: primary - frame.maxY, width: frame.width, height: frame.height)
  }

  /// Ordinary app windows on screen, excluding ours. Only bounds are read, never contents.
  private func windowBlockers() -> [CGRect] {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else {
      return []
    }
    let me = ProcessInfo.processInfo.processIdentifier
    return list.compactMap { info -> CGRect? in
      guard info[kCGWindowLayer as String] as? Int == 0,
        info[kCGWindowOwnerPID as String] as? Int32 != me,
        info[kCGWindowAlpha as String] as? Double ?? 0 > 0.95,
        let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
      else { return nil }
      return CGRect(dictionaryRepresentation: bounds as CFDictionary)
    }
  }

  func applyRate() {
    let still = lowPower || !awake
    blockers = still || paused ? [] : windowBlockers()
    applied = 0
    for (index, screen) in screens.enumerated() {
      let frame = index < layout.count ? cgFrame(layout[index]) : .zero
      let rate = still ? 0 : frameCap(visible: visibleFraction(of: frame, blockers: blockers))
      screen.setPaused(paused)
      screen.setRate(rate)
      applied = max(applied, paused ? 0 : rate)
    }
    updateTimers(pollCoverage: !still && !paused)
  }

  private func updateTimers(pollCoverage: Bool) {
    let wanted = min(30, applied)
    if wanted != pointerRate {
      pointerTimer?.invalidate()
      pointerTimer = nil
      pointerRate = wanted
      if wanted > 0 {
        pointerTimer = Timer.scheduledTimer(withTimeInterval: 1 / Double(wanted), repeats: true) { [weak self] _ in
          self?.trackPointer()
        }
      }
    }
    if !pollCoverage {
      coverageTimer?.invalidate()
      coverageTimer = nil
    } else if coverageTimer == nil {
      coverageTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.applyRate() }
    }
  }

  private func trackPointer() {
    let point = NSEvent.mouseLocation
    guard abs(point.x - lastPoint.x) > 0.2 || abs(point.y - lastPoint.y) > 0.2 else { return }
    lastPoint = point
    let primary = NSScreen.screens.first?.frame.height ?? 0
    let overWindow = blockers.contains { $0.contains(CGPoint(x: point.x, y: primary - point.y)) }
    for (index, screen) in NSScreen.screens.enumerated() where index < screens.count {
      let frame = screen.frame
      screens[index].setPointer(
        !overWindow && frame.contains(point) ? NSPoint(x: point.x - frame.minX, y: frame.maxY - point.y) : nil)
    }
  }

  // MARK: - Menu bar

  private func addMenu() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    let symbol = NSImage(systemSymbolName: "leaf.fill", accessibilityDescription: "Green Wall")
    symbol?.isTemplate = true
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Green Wall" }
    item.button?.toolTip = "Green Wall"
    let menu = NSMenu()
    menu.delegate = self
    menu.autoenablesItems = false
    state.isEnabled = false
    menu.addItem(state)
    menu.addItem(.separator())
    for entry in [waterItem, pauseItem] {
      entry.target = self
      menu.addItem(entry)
    }
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    item.menu = menu
    status = item
  }

  /// The status line says why the wall is still: unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    state.title =
      screens.contains(where: \.failed) ? "Scene failed to load"
      : lowPower ? "Stopped — Low Power Mode"
      : paused ? "Paused"
      : !awake ? "Stopped — screen asleep"
      : applied == 0 ? "Stopped — covered by windows"
      : "Running · \(applied) fps"
    pauseItem.title = paused ? "Resume" : "Pause"
    pauseItem.isEnabled = !lowPower
    waterItem.isEnabled = !paused && applied > 0
  }

  @objc private func water() { for screen in screens { screen.water() } }

  @objc private func togglePause() {
    paused.toggle()
    UserDefaults.standard.set(paused, forKey: "paused")
    applyRate()
  }

  @objc private func quit() { NSApp.terminate(nil) }
}

/// `Green Wall --check`: load the scene in a hidden web view, frozen at 10 s, and exit 0
/// if it reports that it drew a real frame. Used by the installer and mac/tests/run.sh.
final class SceneCheck: NSObject, NSApplicationDelegate {
  private let messages = PageMessages()
  private var window: NSWindow?

  func applicationDidFinishLaunching(_ note: Notification) {
    let root = Bundle.main.resourceURL!.appendingPathComponent("scene")
    let frame = NSRect(x: 0, y: 0, width: 800, height: 520)
    let view = makeWebView(frame: frame, root: root, messages: messages)
    let window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
    window.alphaValue = 0
    window.ignoresMouseEvents = true
    window.contentView = view
    window.orderFrontRegardless()
    self.window = window
    messages.handler = { message in
      let type = message["type"] as? String, level = message["level"] as? String
      if type == "failed" { Self.finish(false, "scene failed: \(message["reason"] ?? "")") }
      if type == "log", level == "error" { Self.finish(false, "page error: \(message["message"] ?? "")") }
      if type == "log", level == "smoke", let text = message["message"] as? String {
        Self.finish(text.contains("\"nonBlank\":true") && text.contains("\"webgl2\":true"), text)
      }
    }
    view.load(URLRequest(url: URL(string: "\(scheme)://local/index.html?t=10&smoke")!))
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { Self.finish(false, "timed out waiting for the scene") }
  }

  static func finish(_ ok: Bool, _ detail: String) {
    print(ok ? "Scene check passed: \(detail)" : "Scene check FAILED: \(detail)")
    exit(ok ? 0 : 1)
  }
}

@main
enum GreenWall {
  static func main() {
    let app = NSApplication.shared
    let arguments = CommandLine.arguments
    if arguments.contains("--restore-desktop-picture") {
      DesktopPicture.restore()
      return
    }
    let delegate: NSApplicationDelegate = arguments.contains("--check") ? SceneCheck() : Controller()
    app.setActivationPolicy(.accessory)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
  }
}
```

- [ ] **Step 6: Typecheck for warnings**

Run: `swiftc -typecheck -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos13.0" mac/GreenWall.swift mac/Coverage.swift`
Expected: no output (no warnings, no errors).

- [ ] **Step 7: Run the host tests**

Run: `chmod +x mac/build.sh && plutil -lint mac/Info.plist && npm run test:mac`
Expected: `mac/Info.plist: OK`, eight `ok` lines, `Built …/Green Wall.app`, then `Scene check passed: SMOKE {"webgl2":true,…,"nonBlank":true}`.

- [ ] **Step 8: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add mac/GreenWall.swift mac/Info.plist mac/build.sh mac/tests/run.sh && git commit -m "Add the macOS wallpaper host"
```

---

### Task 16: Install, uninstall, README and acceptance on the user's Mac

**Files:**
- Create: `mac/install.sh`, `mac/uninstall.sh`, `README.md`

**Interfaces:**
- Consumes: `mac/build.sh` and `--check` (Task 15).
- Produces: `~/Applications/Green Wall.app`, `~/Library/LaunchAgents/local.green-wall.plist` (restart after a crash only), `~/Library/Logs/Green Wall.log`.

- [ ] **Step 1: Write `mac/install.sh`**

```sh
#!/bin/sh
# Build Green Wall, check that its scene loads in WebKit, install it in ~/Applications,
# and start it now and at every login. Rerun to update.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
label=local.green-wall
app="$HOME/Applications/Green Wall.app"
agent="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
sh "$here/build.sh" "$build/Green Wall.app"
echo "Checking the scene loads..."
"$build/Green Wall.app/Contents/MacOS/Green Wall" --check

launchctl bootout "$domain/$label" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build/Green Wall.app" "$app"

mkdir -p "$(dirname "$agent")" "$HOME/Library/Logs"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$app/Contents/MacOS/Green Wall</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<!-- Restart after a crash, but not after Quit (a clean exit). -->
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardErrorPath</key>
	<string>$HOME/Library/Logs/Green Wall.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "$domain" "$agent"
launchctl kickstart -k "$domain/$label"
echo "Green Wall installed: $app"
echo "Look for the leaf in the menu bar. Log: ~/Library/Logs/Green Wall.log"
```

- [ ] **Step 2: Write `mac/uninstall.sh`**

```sh
#!/bin/sh
# Stop Green Wall, remove it and its login item, and put back the previous desktop picture.
set -eu
label=local.green-wall
app="$HOME/Applications/Green Wall.app"
agent="$HOME/Library/LaunchAgents/$label.plist"

if [ -x "$app/Contents/MacOS/Green Wall" ]; then
	"$app/Contents/MacOS/Green Wall" --restore-desktop-picture || echo "Could not restore the desktop picture; choose one in System Settings." >&2
fi
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$agent"
rm -rf "$app" "$HOME/Library/Application Support/Green Wall"
echo "Green Wall removed. Your pause preference is kept; clear it with: defaults delete $label"
```

- [ ] **Step 3: Check the scripts**

Run: `chmod +x mac/install.sh mac/uninstall.sh && sh -n mac/install.sh && sh -n mac/uninstall.sh && echo ok`
Expected: `ok`.

- [ ] **Step 4: Write `README.md`**

````markdown
# Green Wall

The Cefalo green wall as a live macOS desktop wallpaper. The leaves sway in a slow
breeze, gusts roll across the wall, leaves bend away from your cursor, butterflies drop
by now and then, and **Water** mists the whole wall.

It is the real photo with a layer of 3D leaves in front, rendered with Three.js in a
web view that sits behind your desktop icons. Everything runs locally and offline.

> This repository contains Cefalo's photo and logo. Keep it private.

## Install

You need macOS 13 or newer and the Xcode command line tools (`xcode-select --install`).
From the project folder:

```sh
sh mac/install.sh
```

The script builds the app, checks that the scene loads, installs it at
`~/Applications/Green Wall.app`, sets the photo as your desktop picture (your current
one is remembered), and starts it now and at every login. macOS may show a
"background item added" notification. Rerun the same command to update.

## Use

Click the leaf in the menu bar:

- **Water** mists the wall on every display; the leaves stay glossy for about a minute.
- **Pause / Resume** stops or starts the animation, and is remembered.
- **Quit** closes it until you next log in.

Move the cursor over the wall to brush the leaves. A resting butterfly takes off if the
cursor comes close. Icons, clicks and dragging on the desktop work as usual.

## Uninstall

```sh
sh mac/uninstall.sh
```

This stops the app, removes it and its login item, and puts back your previous desktop
picture.

## FAQ

**Will it drain my battery?** It uses more power than a still picture. It draws at most
30 frames a second, 15 when windows cover most of the desktop, and stops completely when
the desktop is almost fully covered, in Low Power Mode, and while the screen is locked
or asleep.

**What does it read?** The cursor position (so the leaves can react) and the positions
of windows (to know how much of the desktop is visible). Never window contents, never
keystrokes. It needs no Accessibility, Input Monitoring or Screen Recording permission,
and makes no network requests.

**Multiple displays?** Each display gets its own wall; Water mists all of them.

**Why is it not moving?** Open the menu: the first line says why (paused, covered by
windows, Low Power Mode). If Reduce Motion is on, it starts paused until you choose Resume.

## Develop

Node.js 20 or newer; there is nothing to install.

```sh
npm start            # browser preview at http://127.0.0.1:8080/scene/
npm test             # unit tests
npm run smoke        # headless Chrome loads the scene and checks it draws
npm run test:mac     # coverage maths + the scene loading in WebKit
```

In the browser: move the pointer over the leaves, click to water, Space to pause.
Add `?debug` for frame rate and frame time, `?t=12` to freeze at 12 s, `?seed=3` for a
different wall, and `?t=25&water=21` to see the mist.

Three.js 0.186.0 is bundled under its MIT license (`scene/vendor/LICENSE`).
````

- [ ] **Step 5: Ask the user, then install**

Stop and ask the user whether to install now (it sets the desktop picture and adds a login item). On a yes, have them run it so the output lands in the session:

```
! cd ~/CEFALO/cefalo-living-wall && sh mac/install.sh
```

Expected: `Built …`, `Checking the scene loads...`, `Scene check passed: …`, `Green Wall installed: …/Green Wall.app`. The wall appears behind the icons on both displays within a few seconds; a leaf icon appears in the menu bar.

- [ ] **Step 6: Acceptance checklist (with the user, on the M2 Pro with both displays)**

Walk through each; record pass/fail in the task report:

1. Desktop icons open on double-click; drag a file to and from the desktop; right-click the desktop shows the Finder menu.
2. Both displays show the wall; switching Spaces keeps it; Mission Control and ⌘-Tab behave normally.
3. Menu status shows `Running · 30 fps`; cover most of the desktop with windows → `Running · 15 fps` within ~2 s; maximise a window over everything → `Stopped — covered by windows`.
4. Lock the screen (⌃⌘Q) and unlock → it resumes; turn on Low Power Mode → `Stopped — Low Power Mode` and Pause is disabled.
5. Moving the cursor over the wall bends the leaves; over an app window it does not.
6. **Water** mists both displays; pressing it again during the mist restarts it (Review Focus 4); Water is disabled while paused.
7. **Pause**, then quit and relaunch (`launchctl kickstart -k gui/$(id -u)/local.green-wall`) → still paused; Resume.
8. Unplug and replug the external display → its wall comes back; change its resolution → the wall refits with the downlights still visible (Review Focus 2).
9. **Quit** → the app stays gone (no relaunch) until the next login or kickstart.
10. Performance: in Activity Monitor → Window → GPU History, the GPU load is modest with the wall visible and drops to idle when covered. For the frame budget, run `npm start`, open `http://127.0.0.1:8080/scene/?debug` in Safari full screen on the XDR display: `ms frame` stays under 8 (spec §7). If over budget, in order: lower `LAYOUT.occupancy` toward 0.75, then cap `devicePixelRatio` at 1.5 in `main.js`.
11. Check `~/Library/Logs/Green Wall.log` has no `page error` lines.

- [ ] **Step 7: Uninstall and reinstall once**

With the user's go-ahead: `! sh mac/uninstall.sh` → the previous desktop picture returns, the menu icon disappears. Then `! sh mac/install.sh` again → running, and a later uninstall still restores the user's original picture (not the green wall still).

- [ ] **Step 8: Commit**

Hand these to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add mac/install.sh mac/uninstall.sh README.md && git commit -m "Add install and uninstall scripts and the README"
```

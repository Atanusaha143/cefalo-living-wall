# Green Wall — live desktop wallpaper

Design spec · 2026-09-23 · Status: approved; amended during planning (§9)

## 1. Intent

**What was asked.** A live macOS desktop wallpaper in the spirit of
[desktop-habitats](https://github.com/chaseleantj/desktop-habitats), but themed on one specific photo:
the Cefalo green wall (`assets-src/green-wall.jpg`, 5866×3911) — rows of pothos-style plants in
modular planters, a wooden ceiling with six downlights, the white `:CEFALO` logo in the middle,
and a pebble strip at the bottom.

**Decisions made during brainstorming**

| Topic | Decision |
|---|---|
| Platform | macOS desktop wallpaper (the scene also runs in a browser for development) |
| Approach | **C — hybrid**: the photo is the backdrop; real 3D leaves in front move and react |
| Photo layer | Gets a subtle wind sway, driven by the same wind as the 3D leaves |
| Logo, ceiling, pebbles | Taken **from the photo** (masked, never moving) — not rebuilt in 3D |
| Visitors | Butterflies, **option 2**: usually one, occasionally a pair; max 2; orange + cream species |
| Butterfly on the logo | **No** — the logo area is never a landing spot (default chosen; easy to flip later) |
| Time-of-day lighting | **Out** of the first version ("keep it lean") |
| Menu action | **Water** (mist) kept as the one interactive action |
| Location | `~/CEFALO/cefalo-living-wall`, a private git repository |

**Assumptions (not stated by the user; correct if wrong)**
- Built as new code, not a fork; desktop-habitats is only a reference for proven macOS techniques.
- Personal/internal use on the user's own Mac. The repo contains Cefalo's photo and logo, so it stays
  **private** and nothing is published or hosted.

**Success looks like**
1. After `sh mac/install.sh`, the wall appears behind the desktop icons on both displays within a few seconds.
2. Leaves visibly sway, gusts roll across photo and front leaves together, and leaves near the cursor bend
   away and spring back.
3. Butterflies visit occasionally, rest on leaves, and take off when the cursor comes near.
4. Desktop icons, clicks and drag-and-drop behave exactly as without the wallpaper.
5. It idles the GPU when covered, locked, asleep or in Low Power Mode, and stays within the frame budget (§7).

**Reference prototype.** `docs/prototype/green-wall-preview.svg` (open in Chrome) is the throwaway SVG
preview approved in brainstorming; `docs/prototype/build.py` generated it. It is a visual reference and a
source of tuned constants only — no code from it is reused, and it is not maintained.

## 2. Non-goals (first version)

Windows/Linux wallpaper · time-of-day or weather lighting · multiple environments · quality profiles in
the menu · sound · watering by clicking the desktop · butterflies landing on the logo · App Store,
notarisation or auto-update · analytics or any network access.

## 3. Architecture

Two parts that meet only at a small JavaScript bridge:

```
macOS host (Swift, one file)                      Scene (Three.js, also runs in a browser)
─────────────────────────────                     ─────────────────────────────────────────
one click-through window per display   ──JS──▶    photo layer  → backdrop + sway/ripple shader
at desktop level, WKWebView inside      bridge    leaves       → instanced 3D leaves, wind + springs
menu-bar icon: Water · Pause · Quit               lights       → downlight shading, cones, dust
power policy → frame-rate cap / stop              logo glow    → travelling light along the letters
cursor position → scene                           butterflies  → state machine + scheduler
                                                  mist         → the Water effect
                                                  frame loop   → fps cap, pause, stop
```

The scene knows nothing about macOS. The host is thin: it places windows, forwards the cursor, decides
the frame-rate cap, and relays menu actions.

### 3.1 Bridge (host → scene)

All functions are globals on `window`, callable before the scene has finished loading (calls made
before ready are queued).

| Function | Meaning |
|---|---|
| `wallSetPointer(x, y)` | Cursor position in CSS pixels relative to the window's top-left |
| `wallPointerOut()` | Cursor left the visible desktop of this window |
| `wallWater()` | Start the mist effect |
| `wallSetPaused(paused)` | User pause (menu). `true` halts rendering |
| `wallSetMaxFps(n)` | Power cap from the host. `n = 0` halts rendering |
| `wallSetMotion(level)` | Motion level 1 Calm … 5 Wild (§10); out-of-range values clamp, unreadable ones give the default |

The scene renders if and only if `!paused && maxFps > 0` and the page is visible. Halting means no
`requestAnimationFrame` is scheduled at all.

Scene → host messages go through `window.webkit.messageHandlers.wall.postMessage({...})` when present:
`{type: "ready"}`, `{type: "failed", reason}`, `{type: "log", level, message}` (console errors and
warnings forwarded for debugging).

### 3.2 Browser mode

`npm start` serves the repo at `http://127.0.0.1:8080/scene/`. In a browser the page drives the same
bridge itself: pointer events → `wallSetPointer`/`wallPointerOut`, **click → `wallWater()`**,
**Space → pause/resume**, **keys 1–5 → `wallSetMotion`**. `?motion=<1–5>` sets the starting level. Query parameters, used for development and tests:
`?t=<seconds>` freeze all animation at that time · `?seed=<n>` layout seed · `?debug` overlay with drawn fps,
CPU ms and a GPU-synced frame ms · `?t=<s>&water=<s>` show the mist (water at the second time) ·
`?smoke` print a one-line report for the smoke tests.

## 4. Scene

### 4.1 Coordinates and camera

- **Scene units are photo pixels of a 1600×1067 reference** (the photo scaled to 1600 wide). Every layout
  constant below uses these units; the shipped texture is higher resolution but maps onto the same space.
- One fixed **orthographic camera** looking straight at the wall.
- The wall fills each display like CSS `object-fit: cover`, but anchored **30 % from the top**: a wide
  screen crops 30 % of the excess height from the top and 70 % from the bottom, so the downlights stay
  in view on a 16:9 display (§9).
- Renderer: WebGL2, `devicePixelRatio` capped at 2, antialiasing on.

Tuned constants (from the prototype):

| Constant | Value |
|---|---|
| Logo box (letters) | x 450–1145, y 425–578 |
| Downlights | (255,57) (527,59) (795,64) (1066,73) (1330,82) (1590,87) |
| Ceiling edge (wall top) | straight line from y=82 at x=0 to y=108 at x=1600 |
| Wall bottom (pebbles start) | y = 980 |

### 4.2 Photo layer

- A full-screen plane textured with `scene/assets/wall.jpg` (3840×2560, JPEG, derived from
  `assets-src/green-wall.jpg` with `sips`).
- **Masks are computed in the shader, not pre-baked:**
  - *Wall mask* — the region between the ceiling edge and wall bottom, feathered by ~5 units.
  - *Logo mask* — inside the logo box (+20 margin), pixels whose blue channel exceeds ~0.72 (the
    white letters; foliage has low blue). Grown by ~7 units so no white smears into the leaves.
- **Sway:** inside the wall mask and outside the logo mask, the texture lookup is offset by a scrolling
  noise field. Offset magnitude is `2–5 units × wind(x, t)` so gusts visibly travel across the photo.
- **Cursor ripple:** within 60 units of the cursor, a small additional radial offset (≤3 units) that
  decays over ~0.8 s after the cursor moves.
- Ceiling, pebbles and logo are sampled without offset — they never move.

### 4.3 Wind (shared)

One pure function, used by both the photo shader and the leaf shader (uniforms mirror its state):

- **Base sway:** a gentle oscillation, period ~5 s, with a phase that advances left→right across the
  wall (~2.6 s end to end) so it reads as a travelling breeze.
- **Gusts:** start at random intervals of **15–40 s**, strength random in [0.6, 1.2]. A gust front
  crosses the wall left→right in ~2.4 s; each point rises to peak, overshoots back ~45 %, and settles
  over ~4 s.
- Output is bounded to [−1.5, 1.5] and deterministic for a given seed and time.

### 4.4 Front leaves

- **Layout** (pure function of the seed): planter rows every 46–58 units from y≈128 down to the wall
  bottom; pockets every 52–96 units along each row, ~90 % occupied; each pocket grows 1–3 leaves on
  short curved stems (5–16 units). Leaves point mostly upward/outward (σ≈34°), ~15 % droop; top-row
  leaves never point into the ceiling. No leaf's base, midpoint or tip enters the logo box (+12 margin),
  the ceiling, or the pebbles.
- **Target count: 500–700 leaves.** (The prototype used ~55 % occupancy and got ~310; the 3D version is
  denser because lit, glossy leaves blend with the photo better than flat SVG. Occupancy is the tuning
  knob if it looks busy.) ~30 % are "deep" leaves: 20 % smaller and ~22 % darker, drawn first.
- **Look:** three blade shapes (heart, lance, ovate) as slightly curved, double-sided meshes with a
  midrib fold, foreshortened by a random horizontal scale (0.5–1.0). Glossy material so blades catch the
  downlights as they turn.
- **Colour:** sampled at startup from a 400-px copy of the photo drawn to a canvas — the 68th-percentile
  luminance pixel of a 7×7 patch around each leaf's midpoint, ×0.9–1.1; fallback `#345c24` for
  near-white or near-black samples.
- **Rendering:** a single `InstancedMesh` per blade shape. Per-instance attributes: pivot, base angle,
  scale, colour, wind phase, **bend angle**.
- **Wind** is applied in the vertex shader (rotation about the stem base): base-sway amplitude 2.2–4.8°
  per leaf; gust amplitude `13° × cos(leaf angle)` so wind always pushes tips downwind.
- **Cursor springs** (CPU, only leaves within reach, found via a spatial grid):
  - reach 90 units from the leaf midpoint; target bend `±38° × (1 − d/90)²`, away from the cursor side;
  - brushing past adds a flick proportional to cursor velocity across the leaf;
  - spring constant 0.08, damping 0.87, **integrated in fixed 60 Hz substeps** so behaviour does not
    change with the frame-rate cap; bend clamped to ±55°;
  - only changed instances are uploaded (`updateRange`).

### 4.5 Lights

- The six downlights shade the leaves (point/spot lights, **no real-time shadows**).
- Additive warm cones (soft radial falloff, ~130×215 units, reaching ~400 units down) and fixture glows,
  as in the prototype.
- ~18 dust motes drifting slowly through the cones.

### 4.6 Logo glow

Every **11 s** a soft warm light band travels left→right along the letters over ~3.3 s, lighting a halo
on the leaves around them (logo mask dilated and blurred). The letters themselves stay crisp and white.

### 4.7 Butterflies

- **Species:** *orange* (as in the prototype) and *cream* (pale, echoing the logo). Wingspan ~34 units.
- **Model:** a body plus two hinged wing pairs that flap in 3D (fast in flight, slow open/close at rest).
- **States:** `offscreen → entering → wandering → approaching → landing → resting → taking-off →
  wandering | exiting`. Flight is steering toward waypoints plus a perpendicular flutter.
- **Resting:** 6–20 s on a leaf. The butterfly is attached to that leaf's transform, so it moves with
  the leaf, and the leaf dips ~4° under its weight.
- **Scheduler:** the gap from one visit's exit to the next visit's entry is **20–90 s**. Each visit is a
  **pair with probability 0.25**, otherwise a single butterfly (species chosen at random).
- **Pair behaviour:** they enter together; the follower spirals around the leader for 3–8 s; they
  separate and land on different leaves; they leave independently.
- **Rules:**
  - never more than 2 on screen;
  - a resting butterfly takes off when the cursor comes within **110 units**; if it is part of a pair,
    the other follows with probability 0.5;
  - the logo box (+40 margin) repels flight paths and is never a landing target;
  - landing targets are front leaves only, outside the logo box and away from the display edges.

### 4.8 Mist (Water)

- `wallWater()` releases fine mist particles from the ceiling line across the full width for ~6 s;
  they fall and fade before the pebbles.
- Afterwards the leaves look wet (higher gloss, slightly darker), fading linearly over **60 s**, and
  every leaf gets a small upward lift (a one-off impulse into its spring).
- Calling it again while active restarts the effect; it has no effect while halted.

### 4.9 Frame loop

- `requestAnimationFrame`-driven with a cap from `wallSetMaxFps` (frames skipped to honour the cap).
- Halts completely when paused, capped at 0, or the page is hidden; resumes without a time jump
  (simulation time advances only while running).
- `prefers-reduced-motion`: starts paused in browser mode (the host handles it for the wallpaper, §5.5).

## 5. macOS host

`mac/GreenWall.swift` plus `mac/Coverage.swift` (the pure coverage maths, so it can be tested) and
`Info.plist`. Menu-bar-only agent (`LSUIElement`), macOS 13+,
bundle id `local.green-wall`, app name **Green Wall**.

### 5.1 Windows

- One borderless window per `NSScreen`, frame = screen frame, level = desktop window level
  (above the still desktop picture, below the icons).
- `collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]`, `ignoresMouseEvents = true`.
- Each window hosts a `WKWebView` loading the bundled `Contents/Resources/scene/` over a **private URL
  scheme** (`green-wall://local/index.html`) served by a `WKURLSchemeHandler`. `file://` would block the
  ES module imports and the pixel reads used for leaf colours (§9).
- WebKit's own window-occlusion detection is switched off: it never considers a desktop-level agent
  window visible and would stop the scene. The host measures coverage itself (§5.3).
- On `NSApplication.didChangeScreenParametersNotification`, windows are rebuilt to match the screens.

### 5.2 Cursor

- Polled with `NSEvent.mouseLocation` at the current frame-rate cap; converted to each window's
  top-left CSS-pixel coordinates; sent only when changed.
- Forwarded only when the point is on that screen **and not inside an on-screen app window** (using the
  window list from §5.3); otherwise `wallPointerOut()` once.
- Needs no Accessibility, Input Monitoring or Screen Recording permission. No keyboard access.

### 5.3 Power policy

Every **1.5 s** the host reads `CGWindowListCopyWindowInfo(.optionOnScreenOnly)` — window bounds and
layer only, never contents — and computes, per screen, the **visible fraction** of the desktop by sampling
a 32×20 grid against layer-0 windows that are not its own (overlaps counted once).

| Condition | Cap sent to that screen |
|---|---|
| Visible fraction ≥ 0.40 | 30 fps |
| 0.05 ≤ visible fraction < 0.40 | 15 fps |
| Visible fraction < 0.05 | 0 (halted) |
| ~~Low Power Mode on~~ | ~~0 on all screens~~ — **no effect** (user decision, §10) |
| Screen locked, screens asleep, or session inactive | 0 on all screens |

Sources: `NSProcessInfoPowerStateDidChange`, `NSWorkspace.screensDidSleep/Wake`,
`com.apple.screenIsLocked/Unlocked` distributed notifications, `NSWorkspace.sessionDidResignActive/BecomeActive`.

### 5.4 Menu

Status item with SF Symbol `leaf.fill`:

- **Status line** (disabled): `Running · 30 fps` · `Running · 15 fps` · `Paused` ·
  `Stopped — covered by windows` · `Stopped — Low Power Mode` · `Stopped — screen asleep` ·
  `Scene failed to load`
  (with more than one display, the line shows the highest current rate).
- **Water** — calls `wallWater()` on every screen; disabled while paused or halted everywhere.
- **Pause / Resume** — `wallSetPaused` on every screen; persisted in `UserDefaults`.
- **Motion ▸ Calm / Gentle / Lively / Energetic / Wild** — `wallSetMotion` on every screen; the
  current level is checked; persisted in `UserDefaults` (`motion`); Energetic until chosen (§10).
- **Quit**.

### 5.5 Preferences and Reduce Motion

The paused state is stored in `UserDefaults`. On first run with no stored value, the app starts paused if
the system's Reduce Motion setting is on.

### 5.6 Desktop picture

- On launch the app copies the still photo to `~/Library/Application Support/Green Wall/still.jpg`
  and sets it as the desktop picture using `NSWorkspace.setDesktopImageURL` — no System Events or
  AppleScript permission.
- Before the first change, it **saves each screen's current desktop picture URL** — only if no saved
  record exists yet, and never a URL pointing at its own still — so reinstalling cannot overwrite your
  real previous wallpaper.
- Limitation: macOS applies this to the current Space only; other Spaces keep their picture underneath,
  which the live layer covers anyway.
- `Green Wall --restore-desktop-picture` restores the saved pictures (if those files still exist) and exits.

### 5.7 Failure handling

- `{type: "failed"}` from the scene (e.g. no WebGL2) → that window is hidden so the still photo shows;
  status line reads `Scene failed to load`.
- Web content process terminated → reload after 2 s, doubling up to 60 s; the backoff resets after
  5 minutes of stable running.
- The page's Content-Security-Policy is `default-src 'self'` (plus `blob:`/`data:` where Three.js needs
  them): no network access of any kind.
- Log lines use the prefix `green-wall:` via `NSLog`.
- `Green Wall --check` loads the scene in a hidden web view at `?t=10&smoke` and exits 0 only if it
  reports WebGL2 and a non-blank frame. The installer and `mac/tests/run.sh` use it (§9).

### 5.8 Install / uninstall

`mac/install.sh`:
1. Runs `mac/build.sh`, which checks for `swiftc` (suggesting `xcode-select --install` if missing),
   compiles both Swift files with `-O` for the host architecture and a macOS 13 target, assembles
   `Green Wall.app` (binary, `Info.plist`, `Resources/scene/`) and ad-hoc code-signs it.
2. Runs the new app's `--check`; **stops without installing** if the scene does not load in WebKit.
3. Stops any running copy and moves the app to `~/Applications/Green Wall.app`.
4. Writes `~/Library/LaunchAgents/local.green-wall.plist` (`RunAtLoad` true; `KeepAlive` restarts it
   only after a crash — `SuccessfulExit` false — so **Quit** stays quit until the next login) and loads
   it, which starts the app. Standard error goes to `~/Library/Logs/Green Wall.log`.
   A LaunchAgent is used rather than `SMAppService` because it works reliably without a paid developer
   signature. macOS may show a "background item added" notification.

`mac/uninstall.sh`: runs `--restore-desktop-picture`, unloads and deletes the LaunchAgent, quits the app,
deletes the app and `~/Library/Application Support/Green Wall/`. Preferences are left in place.

## 6. Project layout

```
~/CEFALO/cefalo-living-wall/
├── README.md                install · use · uninstall · FAQ
├── package.json             scripts only (start, test); no npm dependencies
├── serve.mjs                local static server for browser mode
├── assets-src/green-wall.jpg   original photo (not shipped)
├── scene/
│   ├── index.html           page, CSP, loads src/main.js
│   ├── vendor/three.module.js + three.core.js + LICENSE + VERSION   (Three.js 0.186.0)
│   ├── assets/wall.jpg      3840×2560 derived photo
│   └── src/
│       ├── main.js          boot, renderer, bridge, messages to host
│       ├── frame-loop.js    cap, pause, halt, simulation clock
│       ├── random.js        seeded PRNG
│       ├── wall.js          photo constants: logo box, lights, ceiling and pebble lines
│       ├── fit.js           cover fit and viewport → wall mapping (pure)
│       ├── wind.js          shared wind function (pure)
│       ├── photo-layer.js   backdrop plane, masks, sway and ripple shader
│       ├── leaf-layout.js   leaf placement (pure)
│       ├── leaf-colour.js   leaf colour from the photo (pure)
│       ├── leaf-springs.js  cursor spring physics (pure)
│       ├── leaves.js        instanced meshes, colours, shader wiring
│       ├── lights.js        downlights, cones, dust
│       ├── logo-glow.js
│       ├── butterfly-brain.js  states, scheduler, rules (pure)
│       ├── butterflies.js   meshes, animation
│       └── mist.js
├── mac/
│   ├── GreenWall.swift
│   ├── Coverage.swift       visible fraction + frame cap (pure)
│   ├── Info.plist
│   ├── build.sh             assembles and signs the .app
│   ├── install.sh
│   ├── uninstall.sh
│   └── tests/coverage-test.swift, tests/run.sh
├── tests/                   node --test suites + smoke.sh
└── docs/
    ├── prototype/           approved SVG preview (reference only)
    └── superpowers/specs/   this document
```

Pure modules (`wind`, `leaf-layout`, `leaf-springs`, `butterfly-brain`, `frame-loop`'s timing, `random`)
import nothing from Three.js, so they are testable in Node without a GPU.

## 7. Testing and acceptance

**Unit tests — `node --test`, no dependencies**
- *leaf-layout:* same seed → identical layout; no leaf base/midpoint/tip in the logo box, ceiling or
  pebbles; count within 500–700.
- *leaf-springs:* bends away from the cursor's side; returns to rest (|bend| < 0.05°) within 2 s after the
  cursor leaves; never exceeds ±55°; identical result at 15, 30 and 60 fps (fixed substeps).
- *wind:* a gust front reaches x=1600 after x=0; output stays within [−1.5, 1.5]; gust intervals within
  15–40 s over a long run.
- *butterfly-brain* (simulated 8 hours): never more than 2 active; no landing target in the logo zone;
  resting butterfly takes off within one tick of the cursor entering 110 units; pair share of visits in
  0.18–0.32; gaps between visits within 20–90 s.
- *frame-loop:* the cap holds (no more than n frames per second); paused or cap 0 schedules no frames;
  simulation time does not jump on resume.

**Swift test** — `mac/tests/coverage-test.swift`, compiled with `swiftc` together with the coverage
function (XCTest is unavailable without full Xcode): no windows → 1.0; one window covering the screen
→ 0.0; two overlapping half-screen windows → overlap counted once; own windows ignored.

**Smoke test** — `tests/smoke.sh` runs headless Chrome against the local server: no console errors,
WebGL2 context created, a non-blank frame at `?t=10`, and all five bridge functions defined.

**Manual checklist (user's Mac: M2 Pro, built-in XDR + 1080p external)**
- Icons clickable, drag-and-drop to and from the desktop works, right-click menu works.
- Wall shows on both displays and all Spaces; Mission Control and ⌘-Tab unaffected.
- Status line shows 30 → 15 → stopped as windows cover the desktop.
- Lock, display sleep and Low Power Mode stop it; unlocking resumes it.
- Water works on both displays; Pause persists across restart.
- Unplugging/replugging the external display rebuilds its window.
- Uninstall restores the previous desktop picture.

**Performance budget** — at 30 fps on the built-in XDR display, **scene frame time under 8 ms**, read from
the `?debug` overlay in browser mode and checked in the wallpaper via Activity Monitor's GPU history.
If over budget, in order: reduce leaf count toward 500, render the photo sway pass at half resolution,
cap `devicePixelRatio` at 1.5.

## 8. Risks

| Risk | Mitigation |
|---|---|
| 3D leaves look pasted on over the photo | Colours sampled from the photo, deep-leaf layer, tuning against the prototype look |
| GPU cost at XDR resolution | Budget and fallback order in §7; halting when covered |
| Desktop-level window behaviour changes in a future macOS | Same technique as desktop-habitats; failure leaves the still photo visible |
| Cefalo trademark and photo in the repo | Private repo, local use only, nothing published |

## 9. Amendments made during planning (2026-09-23)

Found while writing and running the implementation plan's code; the plan implements these.

| Change | Why |
|---|---|
| Scene served over a private `green-wall://` URL scheme instead of `loadFileURL` | WebKit blocks ES module imports and canvas pixel reads from `file://`; the leaf colours need the pixels |
| WebKit window-occlusion detection switched off | Otherwise WebKit never starts the scene in a desktop-level agent window |
| Cover fit anchored 30 % from the top instead of centred | Centred, a 16:9 display (the user's external monitor) crops the downlights off |
| Shader time wraps every 10 000 s (a whole number of every animation period) | 32-bit shader floats lose precision after days of uptime and the sway would start to stutter |
| `mac/Coverage.swift` split out; `mac/build.sh` shared by install and tests | The coverage maths needs its own file to be compiled into the Swift test |
| `Green Wall --check`, run by the installer before installing | Proves the scene loads in WebKit (the wallpaper's engine), not just in Chrome |
| LaunchAgent restarts after a crash (not after Quit) | Crash recovery for free; Quit still stays quit |
| Status line gains `Stopped — screen asleep` | Every reason for stillness is explained |
| All three blade shapes in **one** instanced draw (shape picked in the vertex shader), not one mesh per shape | One draw call, and instance order gives correct painter's order for overlapping leaves |
| `?water=`, GPU-synced frame time in `?debug`, `?smoke` report | Needed to test and measure the mist and the frame budget |

Measured while planning: a full frame at the XDR display's 3024×1964 takes ≈3–5 ms including a GPU sync
(headless Chrome on the M2 Pro's Metal GPU), within the 8 ms budget; CPU time ≈0.7–0.9 ms per frame.

## 10. User decisions during acceptance (2026-09-24)

| Decision | Change |
|---|---|
| **Ignore Low Power Mode** (the user's Mac runs in it) | The wall keeps its normal rate and cursor in Low Power Mode; status line no longer has a Low Power entry; Pause stays enabled |
| **Much livelier motion** | Sway 6.6–14.4° (was 2.2–4.8°); gusts every 7–14 s (was 15–40 s), up to ~30° (was 13°); cursor reach 140 units (was 90), bend up to 55° (was 38°), clamp 70°, stronger flick; photo shimmer 3–7 units (was 2–5) |
| Host↔page handshake | The host treats the page as reachable only after its `ready` message (WebKit reports navigation finished before the scene's module runs); `--check` now also drives a hidden wall end to end |
| **Adjustable Motion** (user asked for motion "according to person's need") | Menu levels Calm (speed 0.7×, strength 0.35×), Gentle (0.85×, 0.6×), Lively (1×, 1× — the "much livelier" values above), Energetic (1.3×, 1.3×, **default**), Wild (1.6×, 1.6×). Speed runs the wind on its own clock (sway rhythm and gust frequency); strength scales leaf sway and gusts, the cursor's bend and flick, and the photo shimmer (capped at 1.3× so the photo never smears). Butterflies keep their pace. Code: `scene/src/motion.js` |

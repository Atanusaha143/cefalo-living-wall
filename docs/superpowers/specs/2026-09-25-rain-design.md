# Cefalo Living Wall — Rain

Builds on `2026-09-23-green-wall-design.md` (the scene; Water removed in its §13) and
`2026-09-24-screen-saver-and-rename-design.md` (the screen saver and its Options).

## 1. Intent

Rain falling in front of the wall, switched on and off from the menu. The user chose each of these:

- **A toggle.** A **Rain** menu item turns rain on or off on every display and is remembered across restarts,
  like Pause. Default off.
- **In front of the wall.** Like watching the wall through rain: fine streaks across the whole screen that catch
  the downlights, glossy wet leaves, drops falling from the ceiling edge, splashes on the pebbles.
- **It varies by itself.** A steady rain that swells and eases, with an occasional heavier burst, so it never
  looks like a loop. The existing wind slants it.
- **The screen saver has its own Rain option**, a checkbox in its Options sheet next to Motion.
- **The cursor does nothing new**; the leaves keep bending away from it.

Assumptions the user accepted: rain builds up and tapers off rather than switching; the leaves dry over about a
minute afterwards; butterflies stay away while it rains; the scene turns slightly darker and cooler; no sound;
the existing power policy applies.

Success: it reads as real rain in front of the wall on both of the user's screens (the built-in XDR display and
a 1080p monitor), never visibly repeats, and a frame stays within the 8 ms budget.

## 2. Non-goals

Sound, lightning or thunder, real weather or location, cursor effects in the rain, rain intensity chosen in the
menu, rain on the lock screen (macOS 26 shows only still frames of screen savers there).

## 3. What you see

All sizes are wall units (the 1600×1067 photo space, y down); speeds are wall units per second. The values
below are starting points, tuned on screen during acceptance and recorded as amendments.

### 3.1 Streaks

- Up to **1,800 drops**, drawn in front of everything else, in three depths:

| Depth | Share | Length | Speed | Opacity | Width |
|---|---|---|---|---|---|
| far | 45 % | 14–22 | 700–850 | 0.10–0.16 | 1 device px |
| middle | 35 % | 22–32 | 850–1,050 | 0.16–0.24 | 1 device px |
| near | 20 % | 32–48 | 1,050–1,300 | 0.22–0.32 | 1.5 device px |

- Colour: cool white (0.80, 0.86, 0.92), fading towards both ends of a streak.
- **Catching the downlights:** inside a downlight's cone a streak is up to 2.5× brighter and tinted warm
  (1.0, 0.92, 0.78). The cone has the shape `lights.js` already draws: width `24 + 0.3·dy`, intensity
  `exp(-1.6·(dx/width)²) · exp(-dy/240) · smoothstep(0, 30, dy)` below each light in `LIGHTS`.
- **Slant:** the wind blows left to right, as the gust fronts already do, so the bottom of each streak sits
  further right. Angle at wall x = 6° + 14° · `gustAt(x)` · strength + 3° · `swayAt(x)` · strength, clamped to
  0–25°, where strength is the Motion setting's (§10 of the scene spec). A gust therefore sweeps across the rain
  exactly as it sweeps across the leaves.
- Each drop falls from above the top of the view to below the bottom, then starts again with a new x (hashed
  from the drop and its fall count), so no pattern repeats.

### 3.2 Drips from the ceiling

- **40 drip points** along the wooden beam's lower edge (y ≈ 31, x spread across the width with jitter).
- Each releases a drop every 1.5–4 s, sooner when the rain is heavier; the drop is a short bright streak
  (length 8–12, width 2 device px) that accelerates from rest (2,500 units/s²) down to the pebbles (y ≈ 1,000).

### 3.3 Splashes on the pebbles

- A pool of **120 splashes** at random x, on the pebble band (y 985–1,025). Each shows three droplets that hop
  6–14 units up and ±8 sideways and fade within 0.25 s; they recur at random moments.
- Visible mostly at the sides of the built-in screen (the Dock covers the middle); the 1080p screen's crop cuts
  the pebbles off (§12 of the scene spec), so splashes do not show there.

### 3.4 Wet leaves and overcast

- **Wet:** the 3D leaves' existing wet look (higher gloss, slightly darker, `uWet` in `leaves.js`) rises to full
  over about **10 s** of rain, holds while it rains, and dries over **60 s** once the rain has stopped.
- **Overcast:** the photo and the leaves turn up to 12 % darker and slightly cooler: colour × mix(1, (0.86, 0.88,
  0.94), overcast). The downlights, cones and logo glow are unchanged, so they stand out more.

### 3.5 How hard it rains

- While Rain is on, `level` (0–1) is a steady medium rain with slow swells and occasional bursts:
  - base 0.55;
  - swells: smooth seeded noise of ±0.2, with a new control value every 15–25 s;
  - bursts: every 3–8 min (seeded), lasting 15–40 s, adding 0.45 at their peak with a smooth rise and fall
    (so a burst peak is at least 0.8);
  - clamped to 0.3–1 (never lighter than a light rain).
- **On:** `level` builds up from where it is to the value above over **6 s**. **Off:** it thins to 0 over **8 s**.
  Toggling again mid-way continues from the current value, so it never jumps.
- `overcast` follows the on/off build-up only (not the swells), so the scene does not flicker brighter and darker.
- Drops show by threshold: each drop has a random threshold in 0–1 and is drawn while `level` exceeds it, so
  the rain thickens and thins smoothly. Drips and splashes use the same rule.

### 3.6 Butterflies

While `level` > 0 no visit starts, and flyers already out switch to leaving (the existing `exiting` state).
When the rain has stopped, the next visit comes after the usual gap (20–90 s).

## 4. Scene architecture

Two new modules, split as the scene already is: decisions in a pure module, drawing in a Three.js one.

### 4.1 `scene/src/rain-weather.js` (pure, seeded, no Three.js)

```js
export const RAIN = { buildUp: 6, taper: 8, wetUp: 10, dryOver: 60, floor: 0.3, base: 0.55 };
export function createRainWeather(random) → {
  setRaining(on, t),      // on/off at simulation time t
  at(t) → { level, wet, overcast },   // each 0–1
}
```

Everything is a function of simulation time plus a seeded swell and burst schedule, generated lazily as time
advances, so a run never repeats and a test can fast-forward through hours.

### 4.2 `scene/src/rain.js` (drawing)

`createRain(random) → { group, update(t, weather, gust, strength, pxPerUnit) }`: three instanced meshes (streaks,
drips, splashes), one draw call each, render order **100, 101, 102** (after the leaves, butterflies, lights and
logo glow). Per-instance attributes hold each drop's fixed random values (x seed, start phase, speed, length,
depth, threshold); the vertex shader computes positions from wrapped time (`shaderTime`, wind.js) and reuses
`WIND_GLSL` from `photo-layer.js` for the slant. The light positions come from `LIGHTS` in `wall.js`. When
`level` and `wet` are both 0 the group is hidden.

### 4.3 Changes to existing modules

- `leaves.js`: `update(windTime, gust, wet, strength, overcast)`; `wet` now comes from the weather (today a fixed
  0), and `overcast` tints the leaf colour.
- `photo-layer.js`: `update(t, gust, strength, overcast)`; the photo is tinted by `overcast`.
- `butterfly-brain.js`: `setRaining(on)` holds new visits and sends flyers home (§3.6).
- `main.js`:
  - bridge `wallSetRain(on)`, queued in `pending` like the others until the scene is ready;
  - `simulate` feeds `weather.at(t)` to the rain, leaves and photo layer, and calls
    `brain.setRaining(level > 0)`;
  - `wallState()` adds `rain: { on, level }`;
  - browser: the **R** key toggles rain; `?rain=1` starts it raining (also for `?t=` frozen screenshots).

## 5. Wallpaper app (`mac/LivingWall.swift`)

- Menu: **Rain** between Pause and Motion, with a checkmark while on. Choosing it toggles rain on every screen.
- Stored in the app's preferences under `rain` (Bool, default false), read at launch.
- Each screen's `Wallpaper` sends it with the rest of its state once the page is `ready`:
  `wallSetMaxFps(…); wallSetPaused(…); wallSetMotion(…); wallSetRain(…)`. A screen added later gets it too.
- Toggling while paused is allowed; the scene shows it when it runs again.

## 6. Screen saver (`mac/Saver.swift`, `mac/SaverSettings.swift`)

- Options sheet: a **Rain** checkbox under the Motion pop-up; Done saves both, Cancel neither.
- `SaverSettings` gains `rain: Bool` (default false), saved and synchronised on one `ScreenSaverDefaults`
  instance like `motion` (see §11 of the screen-saver spec for why).
- Done announces both values to every screen-saver process in one distributed notification,
  `local.cefalo-living-wall.saver.options`, replacing `…saver.motion`, with the object `"<motion>,<rain 0|1>"`.
  A pure function in `mac/HostLogic.swift`, `optionsFromBroadcast(_:) -> (motion: Int, rain: Bool)?`, parses it:
  the level is clamped like `motionLevel(stored:)`; anything malformed returns nil and is ignored.
- Each view loads `…?motion=<n>&rain=<0|1>` and sends `wallSetRain` again on `ready`; a broadcast updates it.

## 7. Built-in checks (run by `mac/install.sh`)

- `--check`: the bridge test also turns rain on and expects `"rain":{"on":true` in `wallState()`.
- `--check-saver`: the Options phase posts motion 1 with rain on and expects both views to report motion 1 and
  rain on.

## 8. Testing

- **Node unit tests:**
  - `rain-weather`: level is 0 before rain starts and inside 0.3–1 from 6 s after it; never outside 0–1; level reaches
    0.8 (a burst) within the first 9 minutes; two 5-minute stretches of rain differ; after Rain goes off level
    is 0 within 8 s and wet reaches 0 within 60 s of that; overcast follows the build-up only; the same seed gives
    the same weather; toggling mid-way continues from the current level.
  - `rain`: instance counts per layer; render order after every other layer; wrapped shader time; hidden when dry.
  - `butterfly-brain`: no visit starts while raining; flyers out when rain starts leave; visits return after.
  - `render-order`: rain draws last.
- **Smoke test** (`tests/smoke.sh`): `wallSetRain` joins the bridge check; a second frozen run with `?rain=1`
  must report `rain.level > 0`; its screenshots at both sizes are looked at.
- **Mac tests**: `optionsFromBroadcast` in `host-logic-test.swift`; the rain setting read back from a separate
  process in `saver-settings-test.swift`; the extended `--check` and `--check-saver`.
- **Acceptance** (with the user, both screens): Rain from the menu builds up and thins out; streaks light up in
  the downlight cones; gusts slant them; drips and (built-in) splashes show; the leaves gloss and dry; butterflies
  leave; the choice survives a restart; the screen saver's Rain checkbox works and survives a host restart.

## 9. Performance

About 1,960 extra thin quads in three draw calls, positions computed on the GPU; no per-frame CPU work beyond
setting uniforms. A full frame at the built-in display's 3024×1964 stays under **8 ms** with rain at full level
(measured with `?debug`; today 3–5 ms). The power policy is unchanged: at most 30 fps, 15 when mostly covered,
none when covered, locked or asleep.

## 10. Edge cases

- Rapid toggling: each toggle continues from the current level (§3.5).
- Paused, screen locked or asleep: the rain freezes with the rest of the scene.
- Reduce Motion: the wall starts paused, as today.
- A rain shader that fails to compile reports through the existing console path to the app's log, like any scene
  error.

## 11. Docs

README: Rain in the introduction and the menu list; the screen saver's Rain option; the browser's **R** key and
`?rain=1`. Spec amendments for tuned values go in a section at the end of this document.

## 12. Risks

- 1 device px streaks may shimmer at some scales; the width may need tuning.
- Too much rain can hide the wall; the counts and opacities above are starting points for tuning with the user.

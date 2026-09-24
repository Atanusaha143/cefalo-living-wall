# Cefalo Living Wall — screen saver and rename

Design spec · 2026-09-24 · Status: approved
Builds on: `2026-09-23-green-wall-design.md` (the live wallpaper, including its §9–§10 amendments)

## 1. Intent

**What was asked**
- The wall's liveliness while the user is away. The macOS lock screen cannot show app content (only the
  desktop picture, or Apple's own Aerials), so the user chose a **screen-saver version** of the living wall.
- The screen saver's Motion level is set in **its own Options** sheet.
- **One name everywhere: "Cefalo Living Wall"**, for the wallpaper app and the screen saver alike.
- `install.sh` **installs** the screen saver but does not select it. A **one-time prompt** from the app
  offers to open Screen Saver settings so the user selects it with one click.

**Assumptions (not stated by the user)**
- The screen saver shows the same scene as the wallpaper (photo, 3D leaves, butterflies, lights,
  logo glow) with no cursor and no Water, since input ends a screen saver.
- The System Settings thumbnail runs at a reduced frame rate.
- The rename covers every user-visible and system-level name. Existing settings carry over.

**Success looks like**
1. After `sh mac/install.sh`, the old "Green Wall" app and login item are gone, and "Cefalo Living Wall"
   runs as the wallpaper with the user's pause state, Motion level and remembered original wallpaper intact.
2. About 3 s after the first launch, the app asks once whether to use it as the screen saver.
   **Open Screen Saver Settings** shows the Screen Saver page.
3. "Cefalo Living Wall" is listed in System Settings → Screen Saver, its thumbnail animates, and
   **Options…** changes its Motion level.
4. It plays full screen when the Mac is idle, and after dismissal **no screen-saver host process is left**.
5. `sh mac/uninstall.sh` removes the app, the screen saver and both old and new login items, and restores
   the original desktop picture.

**Evidence from the spike (throwaway, deleted)**
- On macOS 26.5 a WKWebView loading the scene over the private scheme works inside `legacyScreenSaver`,
  both in the thumbnail and full screen, at ~30 fps.
- `stopAnimation` is never called. Without exiting on `com.apple.screensaver.willstop`, the host process
  stays alive at ~10 % CPU with six web-content processes.
- Preview instances accumulate inside System Settings' host while the pane is open (page IDs > 120).
- `NSLog` from the host is redacted; `Logger` with `.public` privacy is readable.

## 2. Non-goals

Animating the lock screen itself (impossible for third-party apps) · selecting the screen saver
automatically · a shared Motion setting between wallpaper and screen saver · cursor or Water in the
screen saver · renaming the repository (already `cefalo-living-wall`), the source photo
(`assets-src/green-wall.jpg` describes the physical wall), the scene's `wall*` bridge functions, or the
dated filenames of earlier specs and plans.

## 3. Names

The display name is **Cefalo Living Wall**. It appears in the app bundle name, the menu-bar tooltip and
accessibility label, dialogs, the screen-saver list and Options sheet, the page `<title>`, the README
and the spec titles.

| Thing | Before | After |
|---|---|---|
| App | `~/Applications/Green Wall.app` (binary `Green Wall`) | `~/Applications/Cefalo Living Wall.app` (binary `Cefalo Living Wall`) |
| App bundle id, LaunchAgent label, preferences domain | `local.green-wall` | `local.cefalo-living-wall` |
| LaunchAgent plist | `~/Library/LaunchAgents/local.green-wall.plist` | `~/Library/LaunchAgents/local.cefalo-living-wall.plist` |
| Log | `~/Library/Logs/Green Wall.log` | `~/Library/Logs/Cefalo Living Wall.log` |
| Support folder / still | `~/Library/Application Support/Green Wall/still.jpg` | `~/Library/Application Support/Cefalo Living Wall/still.jpg` |
| Screen saver | none | `~/Library/Screen Savers/Cefalo Living Wall.saver`, bundle id `local.cefalo-living-wall.saver`, principal class `LivingWallSaverView` |
| URL scheme | `green-wall://local/` | `living-wall://local/` |
| Log prefix / subsystem | `green-wall:` | app `living-wall:`; saver `Logger(subsystem: "local.cefalo-living-wall.saver")` |
| Swift sources | `mac/GreenWall.swift` | `mac/LivingWall.swift`, plus new `mac/SceneWebView.swift`, `mac/Saver.swift`, `mac/Saver-Info.plist` |
| `package.json` name | `green-wall` | `cefalo-living-wall` |

## 4. Migration from "Green Wall"

1. **Installer:** boots out `gui/<uid>/local.green-wall`, deletes its plist and `~/Applications/Green Wall.app`,
   then installs and loads the new app.
2. **App, first launch:** a pure decision `settingsToImport(old:new:)` copies `paused`, `motion` and
   `previousDesktopPictures` from the `local.green-wall` domain into `local.cefalo-living-wall`, each key
   **only if the new domain lacks it**. It records `migratedFromGreenWall = true` so this runs once.
3. **Ours is never the user's:** when remembering the user's picture, the new still **and** the old
   `…/Green Wall/still.jpg` both count as ours (`picturesToSave(current:saved:ours:)`). A desktop still
   showing the old still is therefore never recorded as the user's original.
4. After the new still is set as the desktop picture, the app deletes `~/Library/Application Support/Green Wall/`
   and `~/Library/Logs/Green Wall.log` if present.
5. **Uninstaller:** removes both old and new login items, apps and support folders. Restore runs with the
   new app, falling back to the old one if only it exists.

## 5. The screen saver

### 5.1 Bundle and shared code

- `Cefalo Living Wall.saver`: a `BNDL` loadable bundle (`swiftc -emit-executable -Xlinker -bundle`),
  principal class `LivingWallSaverView: ScreenSaverView`, `Contents/Resources/scene/` (its own copy of the
  scene), and the still used as a fallback (`scene/assets/wall.jpg`).
- `mac/SceneWebView.swift` holds what the app and the saver share: the `living-wall://` scheme handler,
  the console-forwarding script, `PageMessages`, and `makeWebView(frame:root:messages:)` (occlusion detection
  off). The app and the saver each compile it.

### 5.2 One view per display

macOS creates one `LivingWallSaverView` per screen, plus one per System Settings thumbnail. Each view:
1. loads `living-wall://local/index.html?motion=<level>` with the level from the saver's Options (§6);
2. waits for the page's `{type: "ready"}`, then sends `wallSetMaxFps(isPreview ? 15 : 30)` and `wallSetPaused(false)`;
3. never sends a cursor or Water. The scene's own mouse and keyboard handlers stay off because a host message
   handler is present.

### 5.3 Lifecycle

A pure function `saverActions(for event: SaverEvent, isPreview: Bool, inHost: Bool) -> [SaverAction]` decides; the view
performs the actions.

| Event | Full-screen view | Preview view |
|---|---|---|
| `com.apple.screensaver.willstop` (distributed notification) | pause scene, then **exit the host process after 0.5 s** (inside `legacyScreenSaver` only) | pause scene |
| view removed from its window (`viewDidMoveToWindow` with no window) | tear down web view | tear down web view |
| `startAnimation` | resume | resume |
| `stopAnimation` | pause | pause |

- **Exit only inside the real host:** the process exits only when `ProcessInfo.processInfo.processName`
  is `legacyScreenSaver`. Elsewhere (e.g. `--check-saver`, which loads the saver in the app's own process)
  `willstop` only pauses, so a screen saver stopping during an install check cannot end the checker.
- **Tear down** means: stop loading, remove the message handler, remove the web view, release it.
- **Fallback:** if the page reports `failed`, or is not `ready` within 15 s, the view hides the web view and
  draws the bundled still photo (aspect-fill) instead of a black screen.
- **Logging:** `Logger(subsystem: "local.cefalo-living-wall.saver", category: "saver")`, all messages `.public`.

## 6. Options sheet (screen saver)

- `hasConfigureSheet = true`. `configureSheet` returns a small window titled **Cefalo Living Wall** with:
  - a **Motion** pop-up (Calm, Gentle, Lively, Energetic, Wild);
  - the line "How fast and how far the leaves move.";
  - **Cancel** and **Done** buttons.
- Storage: `ScreenSaverDefaults(forModuleWithName: "local.cefalo-living-wall.saver")`, key `motion`
  (Int, 1–5). Missing or out-of-range values resolve through the existing `motionLevel(stored:)`
  (default 4, Energetic).
- **Done** saves, synchronises, and sends `wallSetMotion(level)` to every live view of this module in the process.
- Independent of the wallpaper's Motion menu.

## 7. The prompt and the menu item (wallpaper app)

- Pure decision `shouldOfferScreenSaver(alreadyShown:saverInstalled:)`: true only if the prompt has not been
  shown and `~/Library/Screen Savers/Cefalo Living Wall.saver` exists.
- Shown about **3 s after launch** as an `NSAlert`, with the app activated for it:
  - title **"Use Cefalo Living Wall as your screen saver?"**
  - text "It can play the living wall while your Mac is idle. Choose Cefalo Living Wall in Screen Saver settings."
  - buttons **Open Screen Saver Settings** and **Not Now**.
- Either button sets `screenSaverPromptShown = true`.
- **Open Screen Saver Settings** opens `x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension`,
  falling back to opening System Settings if that URL fails.
- New leaf-menu item **Screen Saver Settings…** (below Motion) does the same at any time.
- Never shown in `--check`, `--check-saver` or `--restore-desktop-picture` modes.

## 8. Build, install, uninstall

- `mac/build.sh <folder>` builds `Cefalo Living Wall.app` and `Cefalo Living Wall.saver` into `<folder>`,
  each with its own `scene/`, both ad-hoc signed. Its default folder is `build/`.
- `mac/install.sh`:
  1. builds into a temporary folder;
  2. runs `--check` (frame and bridge checks) and `--check-saver <saver>`, **stopping without installing** if either fails;
  3. removes the old "Green Wall" app and login item (§4);
  4. installs the app to `~/Applications` and the saver to `~/Library/Screen Savers`, replacing earlier copies,
     then ends any running `legacyScreenSaver` so macOS loads the new saver next time;
  5. writes and loads `local.cefalo-living-wall`, which starts the app (RunAtLoad; KeepAlive restarts only after a crash).
- `mac/uninstall.sh`: restores the desktop picture (keeping the still and saying so if it cannot), boots out both
  labels, and removes both apps, the saver, both support folders and both logs. Preferences are kept, and it prints
  `defaults delete local.cefalo-living-wall` (plus the old domain) to clear them.

## 9. Testing and acceptance

**Swift host-logic tests (new cases)**
- `settingsToImport`: copies absent keys only; never overwrites; ignores unrelated keys.
- `picturesToSave(… ours:)`: neither the old nor the new still is ever recorded.
- `shouldOfferScreenSaver`: only when not shown before and the saver is installed.
- `saverActions`: exit only for full-screen `willstop` inside `legacyScreenSaver`; tear down on removal for both kinds; pause and resume.
- Saver Motion: stored values go through `motionLevel(stored:)` (missing → 4, 0 → 1, 9 → 5).

**WebKit checks (run by `install.sh` and `npm run test:mac`)**
- `--check`: unchanged (frame check, then bridge: stop, start, cursor, motion).
- `--check-saver <path>`: loads the built `.saver` with `Bundle(url:)`, instantiates its principal class
  full-screen and as a preview in a hidden window, and passes only if each reaches `ready` and runs at
  30 / 15 fps with the default Motion level.

**Node tests and smoke:** unchanged except the page title; all must stay green.

**Acceptance on the user's Mac**
- the old app and login item are gone, and the pause, Motion and original-wallpaper settings are intact;
- the prompt appears once and opens the Screen Saver page;
- the saver is listed, its thumbnail animates, and Options changes Motion;
- it plays when idle, and no `legacyScreenSaver` process is left after dismissal;
- uninstall removes everything and restores the original wallpaper.

## 10. Risks

| Risk | Mitigation |
|---|---|
| A macOS update changes how `legacyScreenSaver` hosts or stops savers | Exit on `willstop`, teardown on removal, and the still-photo fallback; `--check-saver` catches load failures at install |
| Exiting the host could someday end a preview too | Exit only for non-preview views (the spike showed previews live in System Settings' host) |
| The Screen Saver settings URL changes | Fall back to opening System Settings |
| Migration imports stale settings | Only three known keys, only when absent, once |
| Two copies of the scene (~4 MB each) drift apart | `build.sh` copies `scene/` into both at every build; one source folder |

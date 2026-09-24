# Screen Saver and Cefalo Living Wall Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product to **Cefalo Living Wall** everywhere (with a migration from "Green Wall") and add a **screen-saver version** with its own Motion Options and a one-time "use as screen saver" prompt.

**Architecture:** The web-view plumbing (private `living-wall://` scheme, console forwarding, message relay, web-view factory) moves into a shared `mac/SceneWebView.swift` compiled into both the app (`mac/LivingWall.swift`, formerly `GreenWall.swift`) and a new loadable screen-saver bundle (`mac/Saver.swift`). All new behaviour decisions — settings import, "ours" stills, when to prompt, what the saver does on each lifecycle event — are pure functions in `mac/HostLogic.swift`, tested by a plain Swift program. The app's `--check-saver` loads the built `.saver` in-process and proves it animates at 30 fps (full screen) and 15 fps (preview).

**Tech Stack:** Swift 5 mode via `swiftc` (AppKit, WebKit, ScreenSaver framework, `os.Logger`), the existing Three.js scene (unchanged except a reported fps cap and the page title), Node's test runner, headless Chrome smoke tests, shell scripts + LaunchAgent.

**Spec:** `docs/superpowers/specs/2026-09-24-screen-saver-and-rename-design.md` (builds on `2026-09-23-green-wall-design.md`).

**Status of the code below:** every file was written and run before this plan was saved, in a scratch copy of the repo: after all tasks, `npm test` 72/72, `npm run smoke` 2/2, `npm run test:mac` 40 `ok` + frame check + bridge check + **saver check** (17 frames at 30 fps full screen, 15 fps preview). The state after Task 3 was also rebuilt and tested on its own (40 `ok` + both checks). The generator verified that Task 3's `LivingWall.swift` plus the Task 4 and Task 5 edits equals the validated final file byte for byte. The installed screen saver and the prompt have not been run on the user's Mac (Task 6 acceptance).

## Global Constraints

- **Git:** never run `git add`, `git commit`, `git mv`, `git push` or anything that changes the index, branches or remotes. Each task ends by handing the user the exact command (prefixed `!`). No AI attribution anywhere. Delete/rename files with plain `rm`/new files; the user's `git add -A <paths>` records the rename.
- **Docs travel with changes:** README and spec updates ship in the same task as the behaviour they describe (user instruction).
- **Do not run** `mac/install.sh` or `mac/uninstall.sh` without the user's explicit go-ahead in that moment.
- **Location:** `~/CEFALO/cefalo-living-wall`; paths below are relative to it.
- **Display name (verbatim):** **Cefalo Living Wall** — app bundle, binary, menu tooltip/accessibility label, dialogs, screen-saver list and Options sheet, page `<title>`, README and spec titles.
- **Identifiers:** app bundle id, LaunchAgent label and preferences domain `local.cefalo-living-wall`; saver bundle id `local.cefalo-living-wall.saver`; saver principal class `LivingWallSaverView`; URL scheme `living-wall://local/`; app log prefix `living-wall:`; saver log `Logger(subsystem: "local.cefalo-living-wall.saver")` with `.public` messages.
- **Paths:** `~/Applications/Cefalo Living Wall.app`, `~/Library/Screen Savers/Cefalo Living Wall.saver`, `~/Library/LaunchAgents/local.cefalo-living-wall.plist`, `~/Library/Logs/Cefalo Living Wall.log`, `~/Library/Application Support/Cefalo Living Wall/still.jpg`.
- **Unchanged on purpose:** `assets-src/green-wall.jpg`, the scene's `wall*` bridge names, the dated spec/plan filenames.
- **Migration keys (only these, only when absent):** `paused`, `motion`, `previousDesktopPictures` from domain `local.green-wall`; marker `migratedFromGreenWall`.
- **Saver:** 30 fps full screen, 15 fps preview; exit the host 0.5 s after `com.apple.screensaver.willstop` **only** for non-preview views inside `legacyScreenSaver`; tear down a view's web view when it leaves its window; still photo if not `ready` within 15 s or on `failed`; Options key `motion` in `ScreenSaverDefaults(forModuleWithName: "local.cefalo-living-wall.saver")`, default 4.
- **Prompt:** once (`screenSaverPromptShown`), ~3 s after launch, only if the saver is installed; buttons **Open Screen Saver Settings** / **Not Now**; URL `x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension`, falling back to opening System Settings.
- **Build:** `swiftc -parse-as-library -swift-version 5`, macOS 13 target, distinct `-module-name` for app (`LivingWall`) and saver (`LivingWallSaver`) so their Swift classes never collide when `--check-saver` loads the saver into the app.

## Review Focus

1. **Upgrading over the old "Green Wall" install** — the user's pause choice, Motion level and *original* wallpaper must survive, and uninstall must still restore the original, never the old green-wall still. Pinned by Task 1 (`settingsToImport` cases; `nor is the old Green Wall still`).
2. **A screen saver stopping somewhere on the Mac while `install.sh` runs `--check-saver`** — the check must not be ended by the saver's exit rule (a false pass). Pinned by Task 1 (`outside the screen-saver host (a check) nothing exits`).
3. **System Settings left open on the Screen Saver pane** — previews must not pile up web views. Pinned by Task 1 (`a removed preview is torn down`) and checked by process list in Task 6 acceptance.
4. **Saver Options never set, or set to a stale value** — Energetic, clamped. Pinned by existing `motionLevel(stored:)` cases (Task 1 keeps them) and `--check-saver` comparing against the stored option (Task 4).
5. **The System Settings thumbnail costing as much as full screen** — preview must run at 15 fps. Pinned by `--check-saver` requiring `"maxFps":15` for the preview (Task 4).

## File Structure

```
mac/SceneWebView.swift      NEW  shared: living-wall:// scheme handler, console script, PageMessages, makeWebView, sceneURL()
mac/LivingWall.swift        NEW  the app (was GreenWall.swift): Migration, DesktopPicture(ours), Controller (+prompt, menu item), SceneCheck, SaverCheck
mac/GreenWall.swift         DELETE
mac/Saver.swift             NEW  LivingWallSaverView: lifecycle, fallback still, Options sheet; SaverSettings
mac/Saver-Info.plist        NEW
mac/HostLogic.swift         + settingsToImport, picturesToSave(ours:), shouldOfferScreenSaver, SaverEvent/SaverAction/saverActions
mac/tests/host-logic-test.swift   + the cases above
mac/Info.plist · mac/build.sh · mac/tests/run.sh · mac/install.sh · mac/uninstall.sh   renamed, then saver added
scene/src/frame-loop.js (maxFps getter) · scene/src/main.js (wallState.maxFps) · scene/index.html · package.json · serve.mjs
README.md · docs/superpowers/specs/*.md
```

---

### Task 1: Host decisions for migration, prompt and the saver lifecycle

**Files:**
- Modify: `mac/HostLogic.swift` (full replacement below)
- Test: `mac/tests/host-logic-test.swift` (full replacement below)

**Interfaces:**
- Produces (Swift, pure):
  - `picturesToSave(current: [String: URL?], saved: [String: String], ours: [URL]) -> [String: String]` (replaces the `still:` variant)
  - `let importedSettingKeys: [String]`; `settingsToImport(old: [String: Any], new: [String: Any]) -> [String: Any]`
  - `shouldOfferScreenSaver(alreadyShown: Bool, saverInstalled: Bool) -> Bool`
  - `enum SaverEvent { case willStop, removedFromWindow, start, stop }`; `enum SaverAction: Equatable { case pause, resume, tearDown, exitProcess }`; `saverActions(for: SaverEvent, isPreview: Bool, inHost: Bool) -> [SaverAction]`
  - unchanged: `PowerState`, `statusLine`, `picturesToRestore`, `motionNames`, `motionLevel(stored:)`

- [ ] **Step 1: Write the failing test** — replace `mac/tests/host-logic-test.swift` with:

```swift
// Checks the host's pure decisions: power state, status line, and which desktop
// pictures to save and restore. A plain program (XCTest needs full Xcode):
// swiftc -parse-as-library mac/HostLogic.swift mac/tests/host-logic-test.swift
import Foundation

@main
enum HostLogicTest {
  static var failures = 0

  static func check(_ ok: Bool, _ what: String) {
    print(ok ? "ok   \(what)" : "FAIL \(what)")
    if !ok { failures += 1 }
  }

  static func main() {
    // Lock, then the display sleeps, then the user wakes the display: still locked.
    var power = PowerState()
    power.locked = true
    power.screensAsleep = true
    power.screensAsleep = false
    check(power.still, "waking the display behind the lock screen keeps the wall still")
    check(statusLine(failed: false, power: power, paused: false, rate: 30) == "Stopped — screen locked",
      "the status line says the screen is locked")
    power.locked = false
    check(!power.still, "unlocking lets it run again")
    check(statusLine(failed: false, power: power, paused: false, rate: 30) == "Running · 30 fps", "running status")
    power.lowPower = true
    check(!power.still, "Low Power Mode does not stop the wall (user choice)")
    check(statusLine(failed: false, power: power, paused: false, rate: 30) == "Running · 30 fps", "and it says it is running")
    check(statusLine(failed: false, power: power, paused: true, rate: 0) == "Paused", "pausing still works in Low Power Mode")

    check(motionNames == ["Calm", "Gentle", "Lively", "Energetic", "Wild"], "five motion levels, Calm to Wild")
    check(motionLevel(stored: nil) == 4, "Energetic until the user picks another level")
    check(motionLevel(stored: 2) == 2, "a stored level is used")
    check(motionLevel(stored: 0) == 1 && motionLevel(stored: 9) == 5, "a stored level out of range is clamped")

    let still = URL(fileURLWithPath: "/Users/me/Library/Application Support/Cefalo Living Wall/still.jpg")
    let oldStill = URL(fileURLWithPath: "/Users/me/Library/Application Support/Green Wall/still.jpg")
    let mine = URL(fileURLWithPath: "/Users/me/Pictures/beach.jpg")
    let other = URL(fileURLWithPath: "/Users/me/Pictures/mountain.jpg")
    let saved = picturesToSave(
      current: ["1": mine, "2": still, "3": nil, "4": other, "5": oldStill], saved: ["4": mine.absoluteString], ours: [still, oldStill])
    check(saved["1"] == mine.absoluteString, "a screen's own picture is remembered")
    check(saved["2"] == nil, "our own still is never remembered as the user's picture")
    check(saved["5"] == nil, "nor is the old Green Wall still")
    check(saved["3"] == nil, "a screen with no readable picture is skipped")
    check(saved["4"] == mine.absoluteString, "a picture remembered earlier is never overwritten")

    let exists: (URL) -> Bool = { $0 != other }
    let restore = picturesToRestore(screens: ["1", "9"], saved: ["1": mine.absoluteString], exists: exists)
    check(restore["1"] == mine, "each screen gets its own picture back")
    check(restore["9"] == mine, "a screen whose ID changed falls back to a saved picture that still exists")
    check(picturesToRestore(screens: ["1"], saved: ["1": other.absoluteString], exists: exists).isEmpty,
      "a saved picture whose file is gone is not restored")
    // Migration from Green Wall: absent keys only, never overwriting, nothing unrelated.
    let imported = settingsToImport(
      old: ["paused": true, "motion": 2, "previousDesktopPictures": ["1": mine.absoluteString], "AppleLanguages": ["en"]],
      new: ["motion": 5])
    check(imported["paused"] as? Bool == true, "the pause choice carries over")
    check(imported["motion"] == nil, "a setting the new app already has is not overwritten")
    check((imported["previousDesktopPictures"] as? [String: String])?["1"] == mine.absoluteString, "the original wallpaper carries over")
    check(imported["AppleLanguages"] == nil, "unrelated preferences are ignored")

    check(shouldOfferScreenSaver(alreadyShown: false, saverInstalled: true), "the prompt is offered once the saver is installed")
    check(!shouldOfferScreenSaver(alreadyShown: true, saverInstalled: true), "never twice")
    check(!shouldOfferScreenSaver(alreadyShown: false, saverInstalled: false), "never without the saver")

    check(saverActions(for: .willStop, isPreview: false, inHost: true) == [.pause, .exitProcess], "a finished screen saver leaves nothing running")
    check(saverActions(for: .willStop, isPreview: true, inHost: true) == [.pause], "a preview in System Settings is only paused")
    check(saverActions(for: .willStop, isPreview: false, inHost: false) == [.pause], "outside the screen-saver host (a check) nothing exits")
    check(saverActions(for: .removedFromWindow, isPreview: true, inHost: true) == [.tearDown], "a removed preview is torn down")
    check(saverActions(for: .removedFromWindow, isPreview: false, inHost: true) == [.tearDown], "so is a removed full-screen view")
    check(saverActions(for: .start, isPreview: false, inHost: true) == [.resume] && saverActions(for: .stop, isPreview: false, inHost: true) == [.pause],
      "start and stop resume and pause")
    exit(failures == 0 ? 0 : 1)
  }
}
```

- [ ] **Step 2: Compile it and see it fail**

Run: `mkdir -p build && swiftc -parse-as-library -swift-version 5 -o build/host-logic-test mac/HostLogic.swift mac/tests/host-logic-test.swift`
Expected: errors `cannot find 'saverActions' in scope`, `cannot find 'settingsToImport' in scope`, `cannot find 'shouldOfferScreenSaver' in scope`, and `incorrect argument label in call (have 'current:saved:ours:', expected 'current:saved:still:')`.

- [ ] **Step 3: Implement** — replace `mac/HostLogic.swift` with:

```swift
import Foundation

/// Every reason the wall may not draw, kept apart: waking the display behind the lock
/// screen must not start the wall while the screen is still locked. Low Power Mode is
/// tracked for diagnostics but does not stop the wall (the user's choice).
struct PowerState: Equatable {
  var lowPower = false
  var locked = false
  var screensAsleep = false
  var sessionInactive = false
  var still: Bool { locked || screensAsleep || sessionInactive }
}

/// The menu's first line: why the wall is doing what it does.
func statusLine(failed: Bool, power: PowerState, paused: Bool, rate: Int) -> String {
  failed ? "Scene failed to load"
    : paused ? "Paused"
    : power.locked ? "Stopped — screen locked"
    : power.screensAsleep || power.sessionInactive ? "Stopped — screen asleep"
    : rate == 0 ? "Stopped — covered by windows"
    : "Running · \(rate) fps"
}

/// The desktop pictures to remember (screen ID → URL string) before showing the still:
/// what was saved before stays, none of our own stills (current or from the Green Wall
/// days) is ever recorded, and a screen whose picture cannot be read is skipped.
func picturesToSave(current: [String: URL?], saved: [String: String], ours: [URL]) -> [String: String] {
  let ourPaths = Set(ours.map { $0.standardizedFileURL.path })
  var out = saved
  for (id, url) in current {
    guard out[id] == nil, let url, !ourPaths.contains(url.standardizedFileURL.path) else { continue }
    out[id] = url.absoluteString
  }
  return out
}

/// What to put back on each screen: its own saved picture, or, when its ID has changed
/// since install (external displays can), the first saved picture whose file still exists.
func picturesToRestore(screens: [String], saved: [String: String], exists: (URL) -> Bool) -> [String: URL] {
  let usable = saved.compactMapValues { URL(string: $0) }.filter { exists($0.value) }
  let fallback = usable.sorted { $0.key < $1.key }.first?.value
  var out: [String: URL] = [:]
  for id in screens { if let url = usable[id] ?? fallback { out[id] = url } }
  return out
}

/// The Motion menu's levels, in the same order as scene/src/motion.js.
let motionNames = ["Calm", "Gentle", "Lively", "Energetic", "Wild"]

/// The Motion level to use: the stored choice clamped to 1…5, or Energetic (4) until the
/// user picks one.
func motionLevel(stored: Int?) -> Int {
  guard let stored else { return 4 }
  return min(motionNames.count, max(1, stored))
}

/// The preferences carried over from the old "Green Wall" app: only these keys, and only
/// those the new app does not have yet.
let importedSettingKeys = ["paused", "motion", "previousDesktopPictures"]

func settingsToImport(old: [String: Any], new: [String: Any]) -> [String: Any] {
  var out: [String: Any] = [:]
  for key in importedSettingKeys where new[key] == nil {
    if let value = old[key] { out[key] = value }
  }
  return out
}

/// Whether to offer, once, to open Screen Saver settings.
func shouldOfferScreenSaver(alreadyShown: Bool, saverInstalled: Bool) -> Bool {
  !alreadyShown && saverInstalled
}

/// What happens to the screen saver's view, and why (see the spec's lifecycle table).
enum SaverEvent { case willStop, removedFromWindow, start, stop }
enum SaverAction: Equatable { case pause, resume, tearDown, exitProcess }

/// `inHost`: running inside macOS's legacyScreenSaver, the only process that may be exited.
/// It never tears finished savers down, so a real run ends by leaving the process; previews
/// live in System Settings' host and are only paused.
func saverActions(for event: SaverEvent, isPreview: Bool, inHost: Bool) -> [SaverAction] {
  switch event {
  case .willStop: return !isPreview && inHost ? [.pause, .exitProcess] : [.pause]
  case .removedFromWindow: return [.tearDown]
  case .start: return [.resume]
  case .stop: return [.pause]
  }
}
```

- [ ] **Step 4: Run the test**

Run: `swiftc -parse-as-library -swift-version 5 -o build/host-logic-test mac/HostLogic.swift mac/tests/host-logic-test.swift && build/host-logic-test`
Expected: 32 `ok` lines, no `FAIL`, exit 0. (The app itself does not compile until Task 3 — that is expected; do not run `npm run test:mac` yet.)

- [ ] **Step 5: Commit**

Hand this to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add -A mac/HostLogic.swift mac/tests/host-logic-test.swift && git commit -m "Add host decisions for migration, the screen-saver prompt and the saver lifecycle"
```

---

### Task 2: The scene reports its frame-rate cap; page and package names

**Files:**
- Modify: `scene/src/frame-loop.js`, `scene/src/main.js`, `scene/index.html`, `package.json`, `serve.mjs`
- Test: `tests/frame-loop.test.mjs` (append)

**Interfaces:**
- Produces: frame loop getter `maxFps` (number, 0 when halted); `window.wallState().maxFps` — Task 4's `--check-saver` reads it.

- [ ] **Step 1: Write the failing test** — append to `tests/frame-loop.test.mjs`:

```js
test('reports its frame-rate cap', () => {
  const loop = createFrameLoop(() => {}, display());
  assert.equal(loop.maxFps, 30);
  loop.setMaxFps(15);
  assert.equal(loop.maxFps, 15);
  loop.setMaxFps(-3);
  assert.equal(loop.maxFps, 0);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/frame-loop.test.mjs`
Expected: `✖ reports its frame-rate cap`, `ℹ pass 5`, `ℹ fail 1`.

- [ ] **Step 3: Implement** — five one-line edits:

`scene/src/frame-loop.js` — Replace:

```js
    get running() { return running(); },
```

with:

```js
    get running() { return running(); },
    get maxFps() { return maxFps; },
```

`scene/src/main.js` — Replace:

```js
    drawn, running: loop.running, simTime: +simTime.toFixed(2), cpuMs: +cpuMs.toFixed(2),
```

with:

```js
    drawn, running: loop.running, maxFps: loop.maxFps, simTime: +simTime.toFixed(2), cpuMs: +cpuMs.toFixed(2),
```

`scene/index.html` — Replace:

```html
  <title>Green Wall</title>
```

with:

```html
  <title>Cefalo Living Wall</title>
```

`package.json` — Replace:

```json
  "name": "green-wall",
```

with:

```json
  "name": "cefalo-living-wall",
```

`serve.mjs` — Replace:

```js
    console.log(`Green Wall: http://127.0.0.1:${port}/scene/  (Ctrl+C to stop)`);
```

with:

```js
    console.log(`Cefalo Living Wall: http://127.0.0.1:${port}/scene/  (Ctrl+C to stop)`);
```

- [ ] **Step 4: Run the tests**

Run: `npm test && npm run smoke`
Expected: `ℹ pass 72`, `ℹ fail 0`, then `PASS 1512,982 …` and `PASS 1920,1080 …`.

- [ ] **Step 5: Commit**

Hand this to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add -A scene/src/frame-loop.js scene/src/main.js scene/index.html package.json serve.mjs tests/frame-loop.test.mjs && git commit -m "Report the frame-rate cap to the host; name the page and package Cefalo Living Wall"
```

---

### Task 3: Rename the app to Cefalo Living Wall, share the web-view code, migrate from Green Wall

**Files:**
- Create: `mac/SceneWebView.swift`, `mac/LivingWall.swift`
- Delete: `mac/GreenWall.swift`
- Modify (full replacements): `mac/Info.plist`, `mac/build.sh`, `mac/tests/run.sh`, `mac/install.sh`, `mac/uninstall.sh`, `README.md`
- Modify: `docs/superpowers/specs/2026-09-23-green-wall-design.md` (title), `docs/superpowers/specs/2026-09-24-screen-saver-and-rename-design.md` (status)

**Interfaces:**
- Consumes: Task 1's `picturesToSave(… ours:)`, `settingsToImport`.
- Produces:
  - `SceneWebView.swift`: `let sceneScheme = "living-wall"`, `sceneURL(_ query: String = "") -> URL`, `final class SceneHandler: WKURLSchemeHandler`, `final class PageMessages` (`handler: ([String: Any]) -> Void`), `let consoleScript: String`, `makeWebView(frame: NSRect, root: URL, messages: PageMessages) -> WKWebView`.
  - `LivingWall.swift`: `enum Migration` (`importSettings()`, `removeOldFiles()`, `oldStill`), `supportFolder(_:) -> URL`, `DesktopPicture.ours`, app entry `@main enum LivingWall` (runs `Migration.importSettings()` before the Controller reads preferences, except with `--check`).
  - `mac/build.sh <folder>` builds `<folder>/Cefalo Living Wall.app` (default folder `build/`).

- [ ] **Step 1: Write the failing test** — replace `mac/tests/run.sh` with the renamed runner:

```sh
#!/bin/sh
# The macOS host's tests: the coverage maths and host decisions, then the real scene
# loading in WebKit through the app's own --check mode. Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -parse-as-library -swift-version 5 -o "$build/coverage-test" "$here/Coverage.swift" "$here/tests/coverage-test.swift"
"$build/coverage-test"
swiftc -parse-as-library -swift-version 5 -o "$build/host-logic-test" "$here/HostLogic.swift" "$here/tests/host-logic-test.swift"
"$build/host-logic-test"

sh "$here/build.sh" "$build"
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm run test:mac`
Expected: the coverage and host-logic `ok` lines, then a compile failure in `mac/GreenWall.swift`: `cannot convert value of type 'URL' to expected argument type '[URL]'` (the old app against Task 1's `picturesToSave(… ours:)`).

- [ ] **Step 3: Create `mac/SceneWebView.swift`**

```swift
// Shared by the wallpaper app and the screen saver: the bundled scene served over a
// private URL scheme (file:// allows neither ES module imports nor reading the photo's
// pixels), the page's messages, and a web view set up to show it.

import Cocoa
import WebKit

let sceneScheme = "living-wall"

/// The scene's page, with an optional query such as "t=10&smoke".
func sceneURL(_ query: String = "") -> URL {
  URL(string: "\(sceneScheme)://local/index.html" + (query.isEmpty ? "" : "?\(query)"))!
}

/// Serves the scene folder inside the bundle to the web views.
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
    // WebKit reports uncaught errors from this private-scheme page only as "Script error.",
    // so errors inside frame and timer callbacks are caught here with their details first.
    for (const name of ['requestAnimationFrame', 'setTimeout', 'setInterval']) {
      const original = window[name];
      window[name] = (fn, ...rest) => original((...args) => {
        try { return fn(...args); } catch (e) { post('error', [`${name}: ${e && e.name}: ${e && e.message}\n${e && e.stack}`]); throw e; }
      }, ...rest);
    }
    addEventListener('error', (e) => post('error', [`${e.message} at ${e.filename}:${e.lineno}`]));
    addEventListener('unhandledrejection', (e) => post('error', [e.reason]));
  })();
  """

func makeWebView(frame: NSRect, root: URL, messages: PageMessages) -> WKWebView {
  let settings = WKWebViewConfiguration()
  settings.setURLSchemeHandler(SceneHandler(root: root), forURLScheme: sceneScheme)
  settings.suppressesIncrementalRendering = true
  settings.websiteDataStore = .nonPersistent()
  settings.userContentController.addUserScript(
    WKUserScript(source: consoleScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  settings.userContentController.add(messages, name: "wall")
  let view = WKWebView(frame: frame, configuration: settings)
  // WebKit stops drawing a page whose window it thinks is covered, and AppKit never
  // reports a desktop-level agent window (or a screen saver's) as visible, so the scene
  // would never start. The wallpaper works out what is covered itself (Coverage.swift).
  if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
    || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
  {
    view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
  }
  view.autoresizingMask = [.width, .height]
  return view
}
```

- [ ] **Step 4: Create `mac/LivingWall.swift`, then delete `mac/GreenWall.swift`**

```swift
// Cefalo Living Wall: the Cefalo green wall, alive, as the desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// desktop picture, below the icons, and it never takes a mouse event, so the desktop
// works as usual. Each window shows the bundled scene in a web view (SceneWebView.swift).
// The cursor position is read on a timer and handed to the scene; nothing else about the
// user's session is read except window positions.

import Cocoa
import WebKit

func log(_ message: String) { NSLog("living-wall: \(message)") }

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
  /// The page said `ready`: its bridge functions exist.
  private(set) var ready = false
  private var loaded = false
  private var rate = -1
  private var paused = false
  private var motion = 4
  private var inside = false
  private var crashes = 0
  private var stableSince = Date()
  private var pointerSends = 0
  private var lastSent = NSPoint(x: -1, y: -1)

  /// `visible: false` keeps the window transparent (used by `--check`).
  init(screen: NSScreen, root: URL, visible: Bool = true) {
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
    if !visible { window.alphaValue = 0 }
    window.orderFrontRegardless()
    view.load(URLRequest(url: sceneURL()))
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
      // Only now do the page's wall* functions exist: WebKit reports the navigation
      // finished while the scene's module has not run yet, and calls made then are lost.
      failed = false
      ready = true
      loaded = true
      send()
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

  /// The Motion level (1 Calm … 5 Wild).
  func setMotion(_ level: Int) {
    guard level != motion else { return }
    motion = level
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript("wallSetMaxFps(\(max(rate, 0))); wallSetPaused(\(paused)); wallSetMotion(\(motion))")
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
    pointerSends += 1
    lastSent = point
    view.evaluateJavaScript(String(format: "wallSetPointer(%.1f,%.1f)", point.x, point.y))
  }

  /// The page's wallState() as JSON, or nil before it can answer.
  func pageState(_ done: @escaping (String?) -> Void) {
    view.evaluateJavaScript("JSON.stringify(wallState())") { value, _ in done(value as? String) }
  }

  /// Log what this screen's host side and page are doing (see Controller's SIGUSR1 dump).
  func report(_ index: Int) {
    log("screen \(index): loaded \(loaded) rate \(rate) paused \(paused) failed \(failed) inside \(inside) pointerSends \(pointerSends) lastSent \(lastSent) window \(window.frame)")
    guard loaded else { return }
    view.evaluateJavaScript("JSON.stringify(wallState())") { value, error in
      log("screen \(index) page: \(value ?? error?.localizedDescription ?? "no answer")")
    }
  }


  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    log("the scene did not load: \(error.localizedDescription)")
  }

  /// WebKit's content process died: reload after 2 s, doubling up to 60 s; the backoff
  /// resets after five minutes of stable running.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    loaded = false
    ready = false
    inside = false
    if Date().timeIntervalSince(stableSince) > 300 { crashes = 0 }
    let wait = min(60, 2 * pow(2, Double(crashes)))
    crashes += 1
    log("the web content process ended; reloading in \(Int(wait)) s")
    DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
      guard let self else { return }
      self.stableSince = Date()
      self.view.load(URLRequest(url: sceneURL()))
    }
  }
}

/// Carrying the user's settings and files over from the app's old name, "Green Wall".
enum Migration {
  static let oldDomain = "local.green-wall"
  static let doneKey = "migratedFromGreenWall"
  static var oldFolder: URL { supportFolder("Green Wall") }
  static var oldStill: URL { oldFolder.appendingPathComponent("still.jpg") }

  /// Once: copy the pause choice, Motion level and remembered original wallpaper from the
  /// old preferences, never overwriting what the new app already has.
  static func importSettings() {
    let defaults = UserDefaults.standard
    guard !defaults.bool(forKey: doneKey) else { return }
    let old = defaults.persistentDomain(forName: oldDomain) ?? [:]
    let new = defaults.persistentDomain(forName: Bundle.main.bundleIdentifier ?? "local.cefalo-living-wall") ?? [:]
    let imported = settingsToImport(old: old, new: new)
    for (key, value) in imported { defaults.set(value, forKey: key) }
    defaults.set(true, forKey: doneKey)
    if !imported.isEmpty { log("carried over from Green Wall: \(imported.keys.sorted())") }
  }

  /// The old support folder and log, once the new still is on the desktop.
  static func removeOldFiles() {
    let logs = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs")
    for url in [oldFolder, logs.appendingPathComponent("Green Wall.log")] where FileManager.default.fileExists(atPath: url.path) {
      try? FileManager.default.removeItem(at: url)
    }
  }
}

func supportFolder(_ name: String) -> URL {
  FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(name)
}

/// The still photo behind the live layer, and the user's own picture to restore later.
enum DesktopPicture {
  static let savedKey = "previousDesktopPictures"
  static var folder: URL { supportFolder("Cefalo Living Wall") }
  static var still: URL { folder.appendingPathComponent("still.jpg") }
  /// Every still this app has ever shown: never the user's own picture.
  static var ours: [URL] { [still, Migration.oldStill] }

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
    // Remember the user's pictures, and persist that, before changing anything: if the
    // process died in between, the next launch would only see our own still.
    let previous = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    let current = Dictionary(NSScreen.screens.map { (id($0), NSWorkspace.shared.desktopImageURL(for: $0)) }) { a, _ in a }
    UserDefaults.standard.set(picturesToSave(current: current, saved: previous, ours: ours), forKey: savedKey)
    for screen in NSScreen.screens {
      do {
        try NSWorkspace.shared.setDesktopImageURL(
          still, for: screen,
          options: [.imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue, .allowClipping: true])
      } catch {
        log("could not set the desktop picture: \(error.localizedDescription)")
      }
    }
    Migration.removeOldFiles()
  }

  /// Put back the pictures saved by install(). Returns false, keeping the record, if any
  /// screen still shows our still afterwards (uninstall then keeps the still's file).
  static func restore() -> Bool {
    let saved = UserDefaults.standard.dictionary(forKey: savedKey) as? [String: String] ?? [:]
    let targets = picturesToRestore(
      screens: NSScreen.screens.map(id), saved: saved, exists: { FileManager.default.fileExists(atPath: $0.path) })
    for screen in NSScreen.screens {
      guard let url = targets[id(screen)] else { continue }
      try? NSWorkspace.shared.setDesktopImageURL(url, for: screen, options: [:])
    }
    let ourPaths = Set(ours.map { $0.standardizedFileURL.path })
    let stuck = NSScreen.screens.filter {
      NSWorkspace.shared.desktopImageURL(for: $0).map { ourPaths.contains($0.standardizedFileURL.path) } ?? false
    }
    if !stuck.isEmpty {
      log("could not restore the desktop picture on \(stuck.count) screen(s)")
      return false
    }
    UserDefaults.standard.removeObject(forKey: savedKey)
    return true
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var screens: [Wallpaper] = []
  private var layout: [CGRect] = []
  private var power = PowerState()
  private var blockers: [CGRect] = []
  private var diagnostics: DispatchSourceSignal?
  private var applied = 0
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var coverageTimer: Timer?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let waterItem = NSMenuItem(title: "Water", action: #selector(water), keyEquivalent: "")
  private let pauseItem = NSMenuItem(title: "Pause", action: #selector(togglePause), keyEquivalent: "")
  private var motionItems: [NSMenuItem] = []
  /// How fast and how far the leaves move; remembered across restarts.
  private var motion = motionLevel(stored: UserDefaults.standard.object(forKey: "motion") as? Int)
  /// Remembered across restarts. With no choice stored yet, Reduce Motion starts it paused.
  private var paused =
    UserDefaults.standard.object(forKey: "paused") as? Bool
    ?? NSWorkspace.shared.accessibilityDisplayShouldReduceMotion

  func applicationDidFinishLaunching(_ note: Notification) {
    DesktopPicture.install(photo: root.appendingPathComponent("assets/wall.jpg"))
    build()
    addMenu()
    NotificationCenter.default.addObserver(
      self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
    // Each reason to stay still is tracked on its own (see PowerState).
    let workspace = NSWorkspace.shared.notificationCenter
    let events: [(NSNotification.Name, (inout PowerState) -> Void)] = [
      (NSWorkspace.screensDidSleepNotification, { $0.screensAsleep = true }),
      (NSWorkspace.screensDidWakeNotification, { $0.screensAsleep = false }),
      (NSWorkspace.sessionDidResignActiveNotification, { $0.sessionInactive = true }),
      (NSWorkspace.sessionDidBecomeActiveNotification, { $0.sessionInactive = false }),
    ]
    for (name, change) in events {
      _ = workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        guard let self else { return }
        change(&self.power)
        self.applyRate()
      }
    }
    for (name, locked) in [("com.apple.screenIsLocked", true), ("com.apple.screenIsUnlocked", false)] {
      _ = DistributedNotificationCenter.default().addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.power.locked = locked
        self?.applyRate()
      }
    }
    // `kill -USR1 <pid>` logs what the host and each page are doing.
    signal(SIGUSR1, SIG_IGN)
    diagnostics = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    diagnostics?.setEventHandler { [weak self] in self?.report() }
    diagnostics?.resume()
    _ = NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) {
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
    for screen in screens { screen.setMotion(motion) }
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

  private func report() {
    let point = NSEvent.mouseLocation
    let primary = NSScreen.screens.first?.frame.height ?? 0
    let visible = layout.map { visibleFraction(of: cgFrame($0), blockers: blockers) }
    log("host: power \(power) paused \(paused) applied \(applied) pointerRate \(pointerRate) blockers \(blockers.count) visible \(visible) cursor \(point) overWindow \(blockers.contains { $0.contains(CGPoint(x: point.x, y: primary - point.y)) })")
    for (index, screen) in screens.enumerated() { screen.report(index) }
  }

  func applyRate() {
    power.lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    let still = power.still
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
    let symbol = NSImage(systemSymbolName: "leaf.fill", accessibilityDescription: "Cefalo Living Wall")
    symbol?.isTemplate = true
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Cefalo Living Wall" }
    item.button?.toolTip = "Cefalo Living Wall"
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
    let levels = NSMenu(title: "Motion")
    levels.autoenablesItems = false
    for (index, name) in motionNames.enumerated() {
      let item = NSMenuItem(title: name, action: #selector(chooseMotion), keyEquivalent: "")
      item.target = self
      item.tag = index + 1
      levels.addItem(item)
      motionItems.append(item)
    }
    let motionMenu = NSMenuItem(title: "Motion", action: nil, keyEquivalent: "")
    motionMenu.submenu = levels
    menu.addItem(motionMenu)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)
    item.menu = menu
    status = item
  }

  /// The status line says why the wall is still: unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    state.title = statusLine(failed: screens.contains(where: \.failed), power: power, paused: paused, rate: applied)
    for item in motionItems { item.state = item.tag == motion ? .on : .off }
    pauseItem.title = paused ? "Resume" : "Pause"
    pauseItem.isEnabled = true
    waterItem.isEnabled = !paused && applied > 0
  }

  @objc private func water() { for screen in screens { screen.water() } }

  @objc private func chooseMotion(_ sender: NSMenuItem) {
    motion = sender.tag
    UserDefaults.standard.set(motion, forKey: "motion")
    for screen in screens { screen.setMotion(motion) }
  }

  @objc private func togglePause() {
    paused.toggle()
    UserDefaults.standard.set(paused, forKey: "paused")
    applyRate()
  }

  @objc private func quit() { NSApp.terminate(nil) }
}

/// `Cefalo Living Wall --check`: load the scene in a hidden web view, frozen at 10 s, and exit 0
/// if it reports that it drew a real frame. Used by the installer and mac/tests/run.sh.
final class SceneCheck: NSObject, NSApplicationDelegate {
  private let messages = PageMessages()
  private var window: NSWindow?
  private var wall: Wallpaper?

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
        guard text.contains("\"nonBlank\":true") && text.contains("\"webgl2\":true") else { Self.finish(false, text) }
        print("Frame check passed: \(text)")
        self.checkBridge(root: root)
      }
    }
    view.load(URLRequest(url: sceneURL("t=10&smoke")))
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { Self.finish(false, "timed out waiting for the scene") }
  }

  /// A hidden live wall driven exactly as the host drives one: the rate is set before the
  /// page has loaded, then the scene must really stop, restart and receive the cursor.
  private func checkBridge(root: URL) {
    let wall = Wallpaper(screen: NSScreen.main ?? NSScreen.screens[0], root: root, visible: false)
    self.wall = wall
    wall.setPaused(false)
    wall.setMotion(2)
    wall.setRate(0)
    func expect(_ what: String, after delay: Double, _ test: @escaping (String) -> Bool, then next: @escaping () -> Void) {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
        wall.pageState { state in
          guard let state, test(state) else { Self.finish(false, "\(what): \(state ?? "no answer")") }
          next()
        }
      }
    }
    func whenReady(_ next: @escaping () -> Void) {
      if wall.ready { next() } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { whenReady(next) } }
    }
    whenReady {
      expect("the scene kept running after the host asked for 0 fps", after: 1,
        { $0.contains("\"running\":false") && $0.contains("\"motion\":2") }) {
        wall.setRate(30)
        expect("the scene did not restart at 30 fps", after: 1, { $0.contains("\"running\":true") }) {
          wall.setPointer(NSPoint(x: 300, y: 300))
          expect("the cursor did not reach the scene", after: 0.5, { !$0.contains("\"pointerCalls\":0") }) {
            Self.finish(true, "the host can stop, start and steer the scene")
          }
        }
      }
    }
  }

  static func finish(_ ok: Bool, _ detail: String) -> Never {
    print(ok ? "Scene check passed: \(detail)" : "Scene check FAILED: \(detail)")
    exit(ok ? 0 : 1)
  }
}

@main
enum LivingWall {
  static func main() {
    let app = NSApplication.shared
    let arguments = CommandLine.arguments
    // Before anything reads preferences: the Controller's paused/motion start from them.
    if !arguments.contains("--check") { Migration.importSettings() }
    if arguments.contains("--restore-desktop-picture") {
      exit(DesktopPicture.restore() ? 0 : 1)
    }
    let delegate: NSApplicationDelegate = arguments.contains("--check") ? SceneCheck() : Controller()
    app.setActivationPolicy(.accessory)
    app.delegate = delegate
    withExtendedLifetime(delegate) { app.run() }
  }
}
```

Then: `rm mac/GreenWall.swift`

- [ ] **Step 5: Replace `mac/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>Cefalo Living Wall</string>
	<key>CFBundleIdentifier</key>
	<string>local.cefalo-living-wall</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Cefalo Living Wall</string>
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

- [ ] **Step 6: Replace `mac/build.sh`**

```sh
#!/bin/sh
# Build "Cefalo Living Wall.app" into the folder given (default: build/): compile the host,
# add the scene, sign it ad hoc. Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
out=${1:-"$project/build"}
app="$out/Cefalo Living Wall.app"
target="$(uname -m)-apple-macos13.0"

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
# Built for this Mac's own architecture; the binary never leaves it.
swiftc -O -parse-as-library -swift-version 5 -module-name LivingWall -target "$target" \
	-o "$app/Contents/MacOS/Cefalo Living Wall" "$here/LivingWall.swift" "$here/SceneWebView.swift" \
	"$here/Coverage.swift" "$here/HostLogic.swift" -framework Cocoa -framework WebKit
cp "$here/Info.plist" "$app/Contents/Info.plist"
# No trailing slash on the source: with one, cp copies the folder's contents instead.
cp -R "$project/scene" "$app/Contents/Resources/"
codesign --force --sign - "$app" >/dev/null 2>&1 || echo "note: ad-hoc signing failed; the app still runs locally" >&2
echo "Built $app"
```

- [ ] **Step 7: Replace `mac/install.sh` and `mac/uninstall.sh`** (new names; the installer removes the old "Green Wall" app and login item, the uninstaller removes both names)

`mac/install.sh`:

```sh
#!/bin/sh
# Build Cefalo Living Wall, check that its scene loads in WebKit, install it in
# ~/Applications, and start it now and at every login. Rerun to update. Replaces an
# install from when it was called "Green Wall" (its settings carry over on first launch).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
label=local.cefalo-living-wall
app="$HOME/Applications/Cefalo Living Wall.app"
agent="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/Cefalo Living Wall.log"
domain="gui/$(id -u)"

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
sh "$here/build.sh" "$build"
echo "Checking the scene loads..."
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check

# The old name: stop it and remove its app and login item.
launchctl bootout "$domain/local.green-wall" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/local.green-wall.plist"
rm -rf "$HOME/Applications/Green Wall.app"

launchctl bootout "$domain/$label" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build/Cefalo Living Wall.app" "$app"

mkdir -p "$(dirname "$agent")" "$(dirname "$log")"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$app/Contents/MacOS/Cefalo Living Wall</string>
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
	<string>$log</string>
</dict>
</plist>
PLIST

# Loading the agent starts the app (RunAtLoad). No kickstart -k: restarting it moments
# after launch could interrupt its first run while it saves the previous desktop picture.
launchctl bootstrap "$domain" "$agent"
echo "Cefalo Living Wall installed: $app"
echo "Look for the leaf in the menu bar. Log: ~/Library/Logs/Cefalo Living Wall.log"
```

`mac/uninstall.sh`:

```sh
#!/bin/sh
# Stop Cefalo Living Wall, remove it and its login item, and put back the previous desktop
# picture. Also removes anything left from when it was called "Green Wall".
set -eu
label=local.cefalo-living-wall
app="$HOME/Applications/Cefalo Living Wall.app"
old_app="$HOME/Applications/Green Wall.app"
support="$HOME/Library/Application Support/Cefalo Living Wall"
old_support="$HOME/Library/Application Support/Green Wall"
domain="gui/$(id -u)"

restored=yes
if [ -x "$app/Contents/MacOS/Cefalo Living Wall" ]; then
	"$app/Contents/MacOS/Cefalo Living Wall" --restore-desktop-picture || restored=no
elif [ -x "$old_app/Contents/MacOS/Green Wall" ]; then
	"$old_app/Contents/MacOS/Green Wall" --restore-desktop-picture || restored=no
fi
for name in "$label" local.green-wall; do
	launchctl bootout "$domain/$name" 2>/dev/null || true
	rm -f "$HOME/Library/LaunchAgents/$name.plist"
done
rm -rf "$app" "$old_app"
rm -f "$HOME/Library/Logs/Cefalo Living Wall.log" "$HOME/Library/Logs/Green Wall.log"
if [ "$restored" = yes ]; then
	rm -rf "$support" "$old_support"
	echo "Cefalo Living Wall removed and your previous desktop picture is back."
else
	# The desktop still points at a still picture, so its file stays.
	echo "Cefalo Living Wall removed, but the previous desktop picture could not be restored." >&2
	echo "Choose one in System Settings > Wallpaper, then delete: $support" >&2
fi
echo "Your preferences are kept; clear them with: defaults delete $label (and defaults delete local.green-wall)"
```

- [ ] **Step 8: Typecheck and run the host tests**

Run: `swiftc -typecheck -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos13.0" mac/LivingWall.swift mac/SceneWebView.swift mac/Coverage.swift mac/HostLogic.swift && sh -n mac/install.sh && sh -n mac/uninstall.sh && npm run test:mac`
Expected: no typecheck output; 40 `ok` lines (8 coverage + 32 host logic); `Built …/Cefalo Living Wall.app`; `Frame check passed: …`; `Scene check passed: the host can stop, start and steer the scene`.

- [ ] **Step 9: Docs for the rename** (the user's rule: docs ship with the change)

Replace `README.md` with:

````markdown
# Cefalo Living Wall

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
`~/Applications/Cefalo Living Wall.app`, sets the photo as your desktop picture (your
current one is remembered), and starts it now and at every login. macOS may show a
"background item added" notification. Rerun the same command to update.

Coming from the earlier "Green Wall" version? The installer removes it, and your pause
choice, Motion level and remembered original wallpaper carry over.

## Use

Click the leaf in the menu bar:

- **Water** mists the wall on every display; the leaves stay glossy for about a minute.
- **Pause / Resume** stops or starts the animation, and is remembered.
- **Motion** sets how fast and how far the leaves move: Calm, Gentle, Lively, Energetic
  (the default) or Wild. It applies to every display and is remembered.
- **Quit** closes it until you next log in.

Move the cursor over the wall to brush the leaves. A resting butterfly takes off if the
cursor comes close. Icons, clicks and dragging on the desktop work as usual.

## Uninstall

```sh
sh mac/uninstall.sh
```

This stops the app, removes it and its login item (including any left from
"Green Wall"), and puts back your previous desktop picture.

## FAQ

**Will it drain my battery?** It uses more power than a still picture. It draws at most
30 frames a second, 15 when windows cover most of the desktop, and stops completely when
the desktop is almost fully covered and while the screen is locked or asleep. It keeps
running in Low Power Mode; pause it from the menu if you want to save more.

**What does it read?** The cursor position (so the leaves can react) and the positions
of windows (to know how much of the desktop is visible). Never window contents, never
keystrokes. It needs no Accessibility, Input Monitoring or Screen Recording permission,
and makes no network requests.

**Multiple displays?** Each display gets its own wall; Water mists all of them.

**Why is it not moving?** Open the menu: the first line says why (paused, covered by
windows, screen locked). If Reduce Motion is on, it starts paused until
you choose Resume.

**Where is the leaf icon?** On a MacBook with a notch, macOS hides menu-bar icons that do
not fit beside it. Quit or ⌘-drag away another icon to make room.

**Something looks wrong?** `pkill -USR1 -f "Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall"`
writes what the app and each display's scene are doing to `~/Library/Logs/Cefalo Living Wall.log`.

## Develop

Node.js 20 or newer; there is nothing to install.

```sh
npm start            # browser preview at http://127.0.0.1:8080/scene/
npm test             # unit tests
npm run smoke        # headless Chrome loads the scene and checks it draws
npm run test:mac     # coverage maths + the scene loading in WebKit
```

In the browser: move the pointer over the leaves, click to water, Space to pause, keys
1–5 to pick the Motion level. Add `?debug` for frame rate and frame time, `?t=12` to
freeze at 12 s, `?seed=3` for a different wall, `?motion=1`…`5` to start at a Motion
level, and `?t=25&water=21` to see the mist.

Three.js 0.186.0 is bundled under its MIT license (`scene/vendor/LICENSE`).
````

`docs/superpowers/specs/2026-09-23-green-wall-design.md` — Replace:

```markdown
# Green Wall — live desktop wallpaper
```

with:

```markdown
# Cefalo Living Wall (formerly Green Wall) — live desktop wallpaper
```

`docs/superpowers/specs/2026-09-24-screen-saver-and-rename-design.md` — Replace:

```markdown
Design spec · 2026-09-24 · Status: awaiting review
```

with:

```markdown
Design spec · 2026-09-24 · Status: approved
```

- [ ] **Step 10: Check nothing still says Green Wall by accident**

Run: `grep -rnI --exclude-dir=.git --exclude-dir=vendor --exclude-dir=docs -E "Green Wall|green-wall|GreenWall" . | grep -v assets-src`
Expected: only the deliberate migration references — `local.green-wall`, `Green Wall.app`, `Green Wall.log`, `Support/Green Wall`, `migratedFromGreenWall`, the `carried over from Green Wall` log line, comments about the old name, the test's old-still case, and the README's "Coming from the earlier "Green Wall" version?" / "left from "Green Wall"" lines.

- [ ] **Step 11: Commit**

Hand this to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add -A mac README.md docs/superpowers/specs && git commit -m "Rename the app to Cefalo Living Wall, share the web-view code, migrate from Green Wall"
```

---

### Task 4: The screen saver and its check

**Files:**
- Create: `mac/Saver.swift`, `mac/Saver-Info.plist`
- Modify: `mac/LivingWall.swift` (four edits), `mac/build.sh` (full replacement), `mac/tests/run.sh` (full replacement)

**Interfaces:**
- Consumes: `SceneWebView.swift` (Task 3); `saverActions`, `motionLevel(stored:)`, `motionNames` (Task 1); `wallState().maxFps` (Task 2).
- Produces: `Cefalo Living Wall.saver` (principal class `LivingWallSaverView`, `enum SaverSettings { motion }`), `Cefalo Living Wall --check-saver <path to .saver>` (exit 0 only if full screen reaches 30 fps and preview 15 fps, both with the stored Motion, both having drawn > 10 frames); `build.sh` also builds `<folder>/Cefalo Living Wall.saver`.

- [ ] **Step 1: Write the failing test** — replace `mac/tests/run.sh` with:

```sh
#!/bin/sh
# The macOS host's tests: the coverage maths and host decisions, then the real scene
# and the screen saver loading in WebKit (the app's --check and --check-saver). Needs the
# Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -parse-as-library -swift-version 5 -o "$build/coverage-test" "$here/Coverage.swift" "$here/tests/coverage-test.swift"
"$build/coverage-test"
swiftc -parse-as-library -swift-version 5 -o "$build/host-logic-test" "$here/HostLogic.swift" "$here/tests/host-logic-test.swift"
"$build/host-logic-test"

sh "$here/build.sh" "$build"
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check
saver="$build/Cefalo Living Wall.saver"
if [ ! -x "$saver/Contents/MacOS/Cefalo Living Wall" ]; then
	echo "FAIL: build.sh did not build the screen saver" >&2
	exit 1
fi
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check-saver "$saver"
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm run test:mac`
Expected: everything up to `Scene check passed: …`, then `FAIL: build.sh did not build the screen saver` and a non-zero exit. (The guard matters: an app that did not know `--check-saver` would otherwise start as a real wallpaper.)

- [ ] **Step 3: Create `mac/Saver.swift`**

```swift
// Cefalo Living Wall as a screen saver: the wallpaper's scene, one view per display and
// per System Settings thumbnail. macOS 26 hosts third-party savers in legacyScreenSaver,
// which never calls stopAnimation and never tears finished savers down; what to do about
// that is decided by saverActions (HostLogic.swift).

import ScreenSaver
import WebKit
import os

let saverLog = Logger(subsystem: "local.cefalo-living-wall.saver", category: "saver")
/// Public, or the unified log redacts it.
func slog(_ message: String) { saverLog.log("\(message, privacy: .public)") }

/// The saver's own settings, edited in its Options sheet.
enum SaverSettings {
  static let module = "local.cefalo-living-wall.saver"
  static var defaults: UserDefaults? { ScreenSaverDefaults(forModuleWithName: module) }
  static var motion: Int {
    get { motionLevel(stored: defaults?.object(forKey: "motion") as? Int) }
    set {
      defaults?.set(newValue, forKey: "motion")
      defaults?.synchronize()
    }
  }
}

@objc(LivingWallSaverView)
final class LivingWallSaverView: ScreenSaverView {
  /// Every live view in this process, so Options can update the running preview.
  private static let live = NSHashTable<LivingWallSaverView>.weakObjects()
  private let messages = PageMessages()
  private var web: WKWebView?
  private var ready = false
  private var fallback = false
  private var readyTimer: Timer?
  private var sheet: NSWindow?
  private var motionPopup: NSPopUpButton?
  private var inHost: Bool { ProcessInfo.processInfo.processName == "legacyScreenSaver" }
  private var resources: URL { Bundle(for: LivingWallSaverView.self).resourceURL! }

  override init?(frame: NSRect, isPreview: Bool) {
    super.init(frame: frame, isPreview: isPreview)
    setUp()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setUp()
  }

  deinit { DistributedNotificationCenter.default().removeObserver(self) }

  private func setUp() {
    animationTimeInterval = 1   // the page animates itself; animateOneFrame stays empty
    Self.live.add(self)
    DistributedNotificationCenter.default().addObserver(
      self, selector: #selector(willStop), name: .init("com.apple.screensaver.willstop"), object: nil)
    slog("started preview \(isPreview) frame \(frame) host \(ProcessInfo.processInfo.processName)")
    load()
  }

  private func load() {
    let view = makeWebView(frame: bounds, root: resources.appendingPathComponent("scene"), messages: messages)
    messages.handler = { [weak self] message in self?.received(message) }
    addSubview(view)
    web = view
    view.load(URLRequest(url: sceneURL("motion=\(SaverSettings.motion)")))
    readyTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
      guard let self, !self.ready else { return }
      slog("the scene was not ready within 15 s; showing the still photo")
      self.showStill()
    }
  }

  private func received(_ message: [String: Any]) {
    switch message["type"] as? String {
    case "ready":
      ready = true
      readyTimer?.invalidate()
      send("wallSetMaxFps(\(isPreview ? 15 : 30)); wallSetPaused(false); wallSetMotion(\(SaverSettings.motion))")
    case "failed":
      slog("the scene failed: \(message["reason"] ?? "unknown")")
      showStill()
    default:
      slog("page \(message["level"] ?? "log"): \(message["message"] ?? "")")
    }
  }

  private func send(_ script: String) {
    guard ready else { return }
    web?.evaluateJavaScript(script)
  }

  private func perform(_ actions: [SaverAction]) {
    for action in actions {
      switch action {
      case .pause: send("wallSetPaused(true)")
      case .resume: send("wallSetPaused(false)")
      case .tearDown: tearDown()
      case .exitProcess:
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          slog("leaving the screen-saver host so nothing keeps running")
          exit(0)
        }
      }
    }
  }

  @objc private func willStop() { perform(saverActions(for: .willStop, isPreview: isPreview, inHost: inHost)) }

  override func startAnimation() {
    super.startAnimation()
    perform(saverActions(for: .start, isPreview: isPreview, inHost: inHost))
  }

  override func stopAnimation() {
    super.stopAnimation()
    perform(saverActions(for: .stop, isPreview: isPreview, inHost: inHost))
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      perform(saverActions(for: .removedFromWindow, isPreview: isPreview, inHost: inHost))
    } else if web == nil && !fallback {
      load()   // shown again after being removed
    }
  }

  private func tearDown() {
    readyTimer?.invalidate()
    guard let view = web else { return }
    view.stopLoading()
    view.configuration.userContentController.removeScriptMessageHandler(forName: "wall")
    view.removeFromSuperview()
    web = nil
    ready = false
    slog("torn down (preview \(isPreview))")
  }

  // MARK: - Still photo when the scene cannot run

  private func showStill() {
    tearDown()
    fallback = true
    needsDisplay = true
  }

  override func draw(_ rect: NSRect) {
    NSColor(calibratedRed: 0.027, green: 0.043, blue: 0.024, alpha: 1).setFill()
    bounds.fill()
    guard fallback, let still = NSImage(contentsOf: resources.appendingPathComponent("scene/assets/wall.jpg")) else { return }
    let scale = max(bounds.width / still.size.width, bounds.height / still.size.height)
    let size = NSSize(width: still.size.width * scale, height: still.size.height * scale)
    still.draw(in: NSRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width, height: size.height))
  }

  override func animateOneFrame() {}

  // MARK: - Options sheet

  override var hasConfigureSheet: Bool { true }

  override var configureSheet: NSWindow? {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 360, height: 150), styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Cefalo Living Wall"
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: 150))
    let label = NSTextField(labelWithString: "Motion:")
    label.frame = NSRect(x: 20, y: 102, width: 70, height: 20)
    let popup = NSPopUpButton(frame: NSRect(x: 90, y: 97, width: 190, height: 28), pullsDown: false)
    popup.addItems(withTitles: motionNames)
    popup.selectItem(at: SaverSettings.motion - 1)
    let hint = NSTextField(labelWithString: "How fast and how far the leaves move.")
    hint.frame = NSRect(x: 20, y: 66, width: 320, height: 20)
    hint.textColor = .secondaryLabelColor
    let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelOptions))
    cancel.frame = NSRect(x: 168, y: 16, width: 84, height: 30)
    cancel.keyEquivalent = "\u{1b}"
    let done = NSButton(title: "Done", target: self, action: #selector(saveOptions))
    done.frame = NSRect(x: 256, y: 16, width: 84, height: 30)
    done.keyEquivalent = "\r"
    for view in [label, popup, hint, cancel, done] { content.addSubview(view) }
    window.contentView = content
    motionPopup = popup
    sheet = window
    return window
  }

  @objc private func saveOptions() {
    let level = (motionPopup?.indexOfSelectedItem ?? 3) + 1
    SaverSettings.motion = level
    for view in Self.live.allObjects { view.send("wallSetMotion(\(level))") }
    closeSheet()
  }

  @objc private func cancelOptions() { closeSheet() }

  private func closeSheet() {
    guard let sheet else { return }
    if let parent = sheet.sheetParent { parent.endSheet(sheet) } else { sheet.close() }
    self.sheet = nil
  }
}
```

- [ ] **Step 4: Create `mac/Saver-Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>Cefalo Living Wall</string>
	<key>CFBundleIdentifier</key>
	<string>local.cefalo-living-wall.saver</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Cefalo Living Wall</string>
	<key>CFBundlePackageType</key>
	<string>BNDL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>NSPrincipalClass</key>
	<string>LivingWallSaverView</string>
</dict>
</plist>
```

- [ ] **Step 5: Replace `mac/build.sh`** (adds the saver bundle and links the app against ScreenSaver for `--check-saver`)

```sh
#!/bin/sh
# Build "Cefalo Living Wall.app" and "Cefalo Living Wall.saver" into the folder given
# (default: build/): compile each, add its own copy of the scene, sign ad hoc. Needs the
# Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
out=${1:-"$project/build"}
app="$out/Cefalo Living Wall.app"
saver="$out/Cefalo Living Wall.saver"
target="$(uname -m)-apple-macos13.0"

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
# Built for this Mac's own architecture; the binary never leaves it.
swiftc -O -parse-as-library -swift-version 5 -module-name LivingWall -target "$target" \
	-o "$app/Contents/MacOS/Cefalo Living Wall" "$here/LivingWall.swift" "$here/SceneWebView.swift" \
	"$here/Coverage.swift" "$here/HostLogic.swift" -framework Cocoa -framework WebKit -framework ScreenSaver
cp "$here/Info.plist" "$app/Contents/Info.plist"
# No trailing slash on the source: with one, cp copies the folder's contents instead.
cp -R "$project/scene" "$app/Contents/Resources/"
codesign --force --sign - "$app" >/dev/null 2>&1 || echo "note: ad-hoc signing failed; the app still runs locally" >&2
echo "Built $app"

# The screen saver: a loadable bundle (MH_BUNDLE) whose principal class macOS instantiates.
rm -rf "$saver"
mkdir -p "$saver/Contents/MacOS" "$saver/Contents/Resources"
swiftc -O -parse-as-library -swift-version 5 -module-name LivingWallSaver -target "$target" \
	-emit-executable -Xlinker -bundle -o "$saver/Contents/MacOS/Cefalo Living Wall" \
	"$here/Saver.swift" "$here/SceneWebView.swift" "$here/HostLogic.swift" \
	-framework Cocoa -framework WebKit -framework ScreenSaver
cp "$here/Saver-Info.plist" "$saver/Contents/Info.plist"
cp -R "$project/scene" "$saver/Contents/Resources/"
codesign --force --sign - "$saver" >/dev/null 2>&1 || echo "note: ad-hoc signing failed for the screen saver" >&2
echo "Built $saver"
```

- [ ] **Step 6: Add `--check-saver` to `mac/LivingWall.swift`** — four edits:

**Edit 1.** Replace:

```swift
import Cocoa
import WebKit
```

with:

```swift
import Cocoa
import ScreenSaver
import WebKit
```

**Edit 2.** Replace:

```swift
@main
enum LivingWall {
```

with:

```swift
/// `Cefalo Living Wall --check-saver <path>`: load the built screen saver into this process,
/// show a full-screen view and a thumbnail preview in hidden windows, and exit 0 only if both
/// reach `ready` and run at 30 and 15 fps with the saver's Motion option. Used by the
/// installer and mac/tests/run.sh.
final class SaverCheck: NSObject, NSApplicationDelegate {
  private var windows: [NSWindow] = []
  private var pending = 2

  func applicationDidFinishLaunching(_ note: Notification) {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--check-saver"), index + 1 < arguments.count,
      let bundle = Bundle(path: arguments[index + 1]), bundle.load(),
      let saverClass = bundle.principalClass as? ScreenSaverView.Type
    else { Self.finish(false, "could not load the screen saver bundle") }
    let motion = motionLevel(
      stored: ScreenSaverDefaults(forModuleWithName: "local.cefalo-living-wall.saver")?.object(forKey: "motion") as? Int)
    for isPreview in [false, true] {
      let frame = NSRect(x: 0, y: 0, width: isPreview ? 320 : 1200, height: isPreview ? 200 : 750)
      guard let view = saverClass.init(frame: frame, isPreview: isPreview) else { Self.finish(false, "the saver view did not initialise") }
      let window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
      window.alphaValue = 0
      window.ignoresMouseEvents = true
      window.contentView = view
      window.orderFrontRegardless()
      view.startAnimation()
      windows.append(window)
      let fps = isPreview ? 15 : 30
      poll(view, name: isPreview ? "preview" : "full screen", tries: 60) {
        $0.contains("\"running\":true") && $0.contains("\"maxFps\":\(fps)") && $0.contains("\"motion\":\(motion)")
          && Self.drawn($0) > 10   // really animating, not just ready
      }
    }
  }

  private func poll(_ view: NSView, name: String, tries: Int, until test: @escaping (String) -> Bool) {
    guard tries > 0 else { Self.finish(false, "the \(name) saver never ran as expected") }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      guard let web = view.subviews.compactMap({ $0 as? WKWebView }).first else {
        Self.finish(false, "the \(name) saver shows no scene")
      }
      web.evaluateJavaScript("typeof wallState === 'function' ? JSON.stringify(wallState()) : ''") { value, _ in
        guard let state = value as? String, test(state) else {
          return self.poll(view, name: name, tries: tries - 1, until: test)
        }
        print("Saver \(name) runs: \(state.prefix(90))…")
        self.pending -= 1
        if self.pending == 0 { Self.finish(true, "the screen saver runs full screen and as a preview") }
      }
    }
  }

  static func drawn(_ state: String) -> Int {
    guard let range = state.range(of: #""drawn":(\d+)"#, options: .regularExpression) else { return 0 }
    return Int(state[range].dropFirst(8)) ?? 0
  }

  static func finish(_ ok: Bool, _ detail: String) -> Never {
    print(ok ? "Saver check passed: \(detail)" : "Saver check FAILED: \(detail)")
    exit(ok ? 0 : 1)
  }
}

@main
enum LivingWall {
```

**Edit 3.** Replace:

```swift
    if !arguments.contains("--check") { Migration.importSettings() }
```

with:

```swift
    let checking = arguments.contains("--check") || arguments.contains("--check-saver")
    if !checking { Migration.importSettings() }
```

**Edit 4.** Replace:

```swift
    let delegate: NSApplicationDelegate = arguments.contains("--check") ? SceneCheck() : Controller()
```

with:

```swift
    let delegate: NSApplicationDelegate =
      arguments.contains("--check-saver") ? SaverCheck() : arguments.contains("--check") ? SceneCheck() : Controller()
```

- [ ] **Step 7: Typecheck both targets and run the host tests**

Run: `plutil -lint mac/Saver-Info.plist && swiftc -typecheck -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos13.0" mac/Saver.swift mac/SceneWebView.swift mac/HostLogic.swift && swiftc -typecheck -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos13.0" mac/LivingWall.swift mac/SceneWebView.swift mac/Coverage.swift mac/HostLogic.swift && npm run test:mac`
Expected: `mac/Saver-Info.plist: OK`; no typecheck output; 40 `ok`; `Built …/Cefalo Living Wall.app`; `Built …/Cefalo Living Wall.saver`; frame and scene checks passed; `Saver full screen runs: {"drawn":1x,"running":true,"maxFps":30,…`; `Saver preview runs: {…"maxFps":15,…`; `Saver check passed: the screen saver runs full screen and as a preview`.

- [ ] **Step 8: Commit**

Hand this to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add -A mac && git commit -m "Add the Cefalo Living Wall screen saver and its WebKit check"
```

---

### Task 5: The one-time prompt and the Screen Saver Settings… menu item

**Files:**
- Modify: `mac/LivingWall.swift` (three edits)

**Interfaces:**
- Consumes: `shouldOfferScreenSaver` (Task 1).
- Produces: `Controller.offerScreenSaver()` (3 s after launch, once), `@objc openScreenSaverSettings()`, menu item **Screen Saver Settings…** below Motion.

The decision itself was test-driven in Task 1 (`shouldOfferScreenSaver` cases); this task wires it to AppKit. Its behaviour on screen is checked in Task 6 acceptance.

- [ ] **Step 1: Apply the edits**

**Edit 1.** Replace:

```swift
  private var motionItems: [NSMenuItem] = []
```

with:

```swift
  private var motionItems: [NSMenuItem] = []
  private let screenSaverItem = NSMenuItem(
    title: "Screen Saver Settings…", action: #selector(openScreenSaverSettings), keyEquivalent: "")
```

**Edit 2.** Replace:

```swift
    _ = NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) {
      [weak self] _ in self?.applyRate()
    }
  }
```

with:

```swift
    _ = NotificationCenter.default.addObserver(forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main) {
      [weak self] _ in self?.applyRate()
    }
    // Once the wall is up, offer (once) to use the screen saver too.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.offerScreenSaver() }
  }

  private func offerScreenSaver() {
    let key = "screenSaverPromptShown"
    let saver = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("Screen Savers/Cefalo Living Wall.saver")
    guard shouldOfferScreenSaver(
      alreadyShown: UserDefaults.standard.bool(forKey: key), saverInstalled: FileManager.default.fileExists(atPath: saver.path))
    else { return }
    UserDefaults.standard.set(true, forKey: key)
    let alert = NSAlert()
    alert.messageText = "Use Cefalo Living Wall as your screen saver?"
    alert.informativeText = "It can play the living wall while your Mac is idle. Choose Cefalo Living Wall in Screen Saver settings."
    alert.addButton(withTitle: "Open Screen Saver Settings")
    alert.addButton(withTitle: "Not Now")
    NSApp.activate(ignoringOtherApps: true)
    if alert.runModal() == .alertFirstButtonReturn { openScreenSaverSettings() }
  }

  /// System Settings on the Screen Saver page (Apple's supported link), or System Settings itself.
  @objc private func openScreenSaverSettings() {
    if let page = URL(string: "x-apple.systempreferences:com.apple.ScreenSaver-Settings.extension"),
      NSWorkspace.shared.open(page)
    {
      return
    }
    NSWorkspace.shared.open(URL(fileURLWithPath: "/System/Applications/System Settings.app"))
  }
```

**Edit 3.** Replace:

```swift
    menu.addItem(motionMenu)
```

with:

```swift
    menu.addItem(motionMenu)
    screenSaverItem.target = self
    menu.addItem(screenSaverItem)
```

- [ ] **Step 2: Typecheck and run the host tests**

Run: `swiftc -typecheck -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos13.0" mac/LivingWall.swift mac/SceneWebView.swift mac/Coverage.swift mac/HostLogic.swift && npm run test:mac`
Expected: no typecheck output; same passing output as Task 4 Step 7 (the checks never show the prompt: `--check`/`--check-saver` use their own delegates).

- [ ] **Step 3: Commit**

Hand this to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add -A mac/LivingWall.swift && git commit -m "Offer once to use the screen saver, and add Screen Saver Settings to the menu"
```

---

### Task 6: Install the screen saver, update the docs, accept on the user's Mac

**Files:**
- Modify (full replacements): `mac/install.sh`, `mac/uninstall.sh`, `README.md` (adds the screen-saver sections to Task 3's version)

**Interfaces:**
- Consumes: `build.sh` (both bundles), `--check`, `--check-saver`.
- Produces: installer that also runs `--check-saver`, installs to `~/Library/Screen Savers`, and ends any running `legacyScreenSaver`; uninstaller that also removes the saver.

- [ ] **Step 1: Replace `mac/install.sh`**

```sh
#!/bin/sh
# Build Cefalo Living Wall and its screen saver, check that both run in WebKit, install the
# app in ~/Applications and the screen saver in ~/Library/Screen Savers, and start the app
# now and at every login. Rerun to update. Replaces an install from when it was called
# "Green Wall" (its settings carry over on first launch).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
label=local.cefalo-living-wall
app="$HOME/Applications/Cefalo Living Wall.app"
saver="$HOME/Library/Screen Savers/Cefalo Living Wall.saver"
agent="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/Cefalo Living Wall.log"
domain="gui/$(id -u)"

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
sh "$here/build.sh" "$build"
echo "Checking the scene loads..."
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check
echo "Checking the screen saver runs..."
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check-saver "$build/Cefalo Living Wall.saver"

# The old name: stop it and remove its app and login item.
launchctl bootout "$domain/local.green-wall" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/local.green-wall.plist"
rm -rf "$HOME/Applications/Green Wall.app"

launchctl bootout "$domain/$label" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build/Cefalo Living Wall.app" "$app"
mkdir -p "$(dirname "$saver")"
rm -rf "$saver"
mv "$build/Cefalo Living Wall.saver" "$saver"
# A running screen-saver host keeps the old code loaded; macOS starts a fresh one when needed.
pkill -f "legacyScreenSaver.appex/Contents/MacOS/legacyScreenSaver" 2>/dev/null || true

mkdir -p "$(dirname "$agent")" "$(dirname "$log")"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$app/Contents/MacOS/Cefalo Living Wall</string>
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
	<string>$log</string>
</dict>
</plist>
PLIST

# Loading the agent starts the app (RunAtLoad). No kickstart -k: restarting it moments
# after launch could interrupt its first run while it saves the previous desktop picture.
launchctl bootstrap "$domain" "$agent"
echo "Cefalo Living Wall installed: $app"
echo "Screen saver installed: $saver (choose it in System Settings > Screen Saver)"
echo "Look for the leaf in the menu bar. Log: ~/Library/Logs/Cefalo Living Wall.log"
```

- [ ] **Step 2: Replace `mac/uninstall.sh`**

```sh
#!/bin/sh
# Stop Cefalo Living Wall, remove it, its screen saver and its login item, and put back the
# previous desktop picture. Also removes anything left from when it was called "Green Wall".
set -eu
label=local.cefalo-living-wall
app="$HOME/Applications/Cefalo Living Wall.app"
old_app="$HOME/Applications/Green Wall.app"
support="$HOME/Library/Application Support/Cefalo Living Wall"
old_support="$HOME/Library/Application Support/Green Wall"
domain="gui/$(id -u)"

restored=yes
if [ -x "$app/Contents/MacOS/Cefalo Living Wall" ]; then
	"$app/Contents/MacOS/Cefalo Living Wall" --restore-desktop-picture || restored=no
elif [ -x "$old_app/Contents/MacOS/Green Wall" ]; then
	"$old_app/Contents/MacOS/Green Wall" --restore-desktop-picture || restored=no
fi
for name in "$label" local.green-wall; do
	launchctl bootout "$domain/$name" 2>/dev/null || true
	rm -f "$HOME/Library/LaunchAgents/$name.plist"
done
rm -rf "$app" "$old_app" "$HOME/Library/Screen Savers/Cefalo Living Wall.saver"
rm -f "$HOME/Library/Logs/Cefalo Living Wall.log" "$HOME/Library/Logs/Green Wall.log"
if [ "$restored" = yes ]; then
	rm -rf "$support" "$old_support"
	echo "Cefalo Living Wall removed and your previous desktop picture is back."
else
	# The desktop still points at a still picture, so its file stays.
	echo "Cefalo Living Wall removed, but the previous desktop picture could not be restored." >&2
	echo "Choose one in System Settings > Wallpaper, then delete: $support" >&2
fi
echo "Your preferences are kept; clear them with: defaults delete $label (and defaults delete local.green-wall)"
```

- [ ] **Step 3: Check the scripts**

Run: `sh -n mac/install.sh && sh -n mac/uninstall.sh && echo ok`
Expected: `ok`.

- [ ] **Step 4: Replace `README.md`**

````markdown
# Cefalo Living Wall

The Cefalo green wall as a live macOS desktop wallpaper and screen saver. The leaves
sway in the breeze, gusts roll across the wall, leaves bend away from your cursor,
butterflies drop by now and then, and **Water** mists the whole wall.

It is the real photo with a layer of 3D leaves in front, rendered with Three.js in a
web view that sits behind your desktop icons. Everything runs locally and offline.

> This repository contains Cefalo's photo and logo. Keep it private.

## Install

You need macOS 13 or newer and the Xcode command line tools (`xcode-select --install`).
From the project folder:

```sh
sh mac/install.sh
```

The script builds the app and the screen saver, checks that both run, installs the app
at `~/Applications/Cefalo Living Wall.app` and the screen saver in
`~/Library/Screen Savers`, sets the photo as your desktop picture (your current one is
remembered), and starts the app now and at every login. macOS may show a "background
item added" notification. Rerun the same command to update.

Coming from the earlier "Green Wall" version? The installer removes it, and your pause
choice, Motion level and remembered original wallpaper carry over.

## Use

Click the leaf in the menu bar:

- **Water** mists the wall on every display; the leaves stay glossy for about a minute.
- **Pause / Resume** stops or starts the animation, and is remembered.
- **Motion** sets how fast and how far the leaves move: Calm, Gentle, Lively, Energetic
  (the default) or Wild. It applies to every display and is remembered.
- **Screen Saver Settings…** opens System Settings on the Screen Saver page.
- **Quit** closes it until you next log in.

Move the cursor over the wall to brush the leaves. A resting butterfly takes off if the
cursor comes close. Icons, clicks and dragging on the desktop work as usual.

## Screen saver

The first time the app starts it offers to open Screen Saver settings: choose
**Cefalo Living Wall** there (System Settings → Screen Saver, under *Other*). It plays the
living wall while your Mac is idle, on every display, and keeps playing after the Mac
locks until you touch it. **Options…** next to it sets its own Motion level (Energetic
by default). Nothing keeps running after it stops.

## Uninstall

```sh
sh mac/uninstall.sh
```

This stops the app, removes it, the screen saver and the login item (including any left
from "Green Wall"), and puts back your previous desktop picture.

## FAQ

**Will it drain my battery?** It uses more power than a still picture. It draws at most
30 frames a second, 15 when windows cover most of the desktop, and stops completely when
the desktop is almost fully covered and while the screen is locked or asleep. It keeps
running in Low Power Mode; pause it from the menu if you want to save more.

**What does it read?** The cursor position (so the leaves can react) and the positions
of windows (to know how much of the desktop is visible). Never window contents, never
keystrokes. It needs no Accessibility, Input Monitoring or Screen Recording permission,
and makes no network requests.

**Multiple displays?** Each display gets its own wall; Water mists all of them.

**Why is it not moving?** Open the menu: the first line says why (paused, covered by
windows, screen locked). If Reduce Motion is on, it starts paused until
you choose Resume.

**Where is the leaf icon?** On a MacBook with a notch, macOS hides menu-bar icons that do
not fit beside it. Quit or ⌘-drag away another icon to make room.

**Can the lock screen itself move?** No app can draw on the macOS lock screen; it shows
your desktop picture. Use the screen saver: it keeps playing after the Mac locks.

**Something looks wrong?** `pkill -USR1 -f "Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall"`
writes what the app and each display's scene are doing to `~/Library/Logs/Cefalo Living Wall.log`.
The screen saver logs to the system log: `log show --last 10m --predicate 'subsystem == "local.cefalo-living-wall.saver"'`.

## Develop

Node.js 20 or newer; there is nothing to install.

```sh
npm start            # browser preview at http://127.0.0.1:8080/scene/
npm test             # unit tests
npm run smoke        # headless Chrome loads the scene and checks it draws
npm run test:mac     # host logic + the app and screen saver running in WebKit
```

In the browser: move the pointer over the leaves, click to water, Space to pause, keys
1–5 to pick the Motion level. Add `?debug` for frame rate and frame time, `?t=12` to
freeze at 12 s, `?seed=3` for a different wall, `?motion=1`…`5` to start at a Motion
level, and `?t=25&water=21` to see the mist.

Three.js 0.186.0 is bundled under its MIT license (`scene/vendor/LICENSE`).
````

- [ ] **Step 5: Run everything**

Run: `npm test && npm run smoke && npm run test:mac`
Expected: `ℹ pass 72`; two smoke `PASS` lines; 40 `ok`; frame, scene and saver checks passed.

- [ ] **Step 6: Commit**

Hand this to the user to run (the executor never commits; no AI attribution):

```
! cd ~/CEFALO/cefalo-living-wall && git add -A mac/install.sh mac/uninstall.sh README.md && git commit -m "Install the screen saver alongside the app and document it"
```

- [ ] **Step 7: Ask the user, then install**

Stop and ask for the go-ahead (it replaces the "Green Wall" install and adds the screen saver). On a yes:

```
! cd ~/CEFALO/cefalo-living-wall && sh mac/install.sh
```

Expected: `Built …app`, `Built …saver`, `Checking the scene loads...`, frame and scene checks passed, `Checking the screen saver runs...`, saver check passed, `Cefalo Living Wall installed: …`, `Screen saver installed: …`.

- [ ] **Step 8: Acceptance checklist (with the user)**

1. `ls ~/Applications | grep -i wall` shows only `Cefalo Living Wall.app`; `launchctl print gui/$(id -u)/local.green-wall` fails; the leaf menu tooltip reads *Cefalo Living Wall*.
2. `defaults read local.cefalo-living-wall` shows `migratedFromGreenWall = 1`, and the user's earlier `motion`/`paused` values and `previousDesktopPictures` (a real file URL, **not** a `…/Green Wall/still.jpg`).
3. ~3 s after launch the prompt appears once; **Open Screen Saver Settings** opens the Screen Saver page (if it opens System Settings' main page instead, note it — the fallback worked).
4. "Cefalo Living Wall" is listed under *Other*; its thumbnail animates; **Options…** shows the Motion pop-up; choosing Calm and pressing Done visibly calms the thumbnail.
5. Start it (`! open -a ScreenSaverEngine`), let it play ~15 s, dismiss; then `ps -axo comm | grep -c "[l]egacyScreenSaver"` prints `0` once System Settings is closed. `log show --last 5m --predicate 'subsystem == "local.cefalo-living-wall.saver"'` shows `leaving the screen-saver host…`.
6. Leave System Settings open on the Screen Saver pane for a minute, switch saver selections a few times, then close it: no `legacyScreenSaver` remains.
7. With the user's go-ahead: `! sh mac/uninstall.sh` → original wallpaper back, app and saver gone; then `! sh mac/install.sh` to reinstall.

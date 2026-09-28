# Settings window — design

Date: 2026-09-28 · Status: approved in conversation, awaiting review of this written spec

## 1. Goal

The menu bar menu has grown to Pause, Rain, Motion, Live Lock Screen and Screen Saver
Options…. The user asked to gather the settings under **Settings**. The things changed often
stay one click away in the menu; the ones set once move into a small **Settings window**,
each with a line explaining it.

## 2. Decisions (the user's)

| Question | Choice |
|---|---|
| Shape | Quick controls in the menu (Pause, Rain, Motion), the rest in a Settings… window |
| What the window holds | Live Lock Screen and the Screen Saver section only — nothing else (not the screen saver's own Motion/Rain, not a password status, not start-at-login) |
| How it is built | AppKit in code, like the rest of the app (not SwiftUI, not a sheet) |

## 3. The menu

```
  <status line>
  ────────────────
  Pause
  Rain         ▸
  Motion       ▸
  Settings…   ⌘,
  ────────────────
  Quit        ⌘Q
```

The Live Lock Screen submenu and the Screen Saver Options… item leave the menu.

## 4. The window

Title **Cefalo Living Wall Settings**; fixed size, not resizable; closes with ⌘W or its close
button. Settings… opens it, or brings it to the front if it is already open; it comes to the
front although the app has no Dock icon (the app activates).

```
  Live Lock Screen   [ Top-Right Corner      ▾ ]
     Move the pointer into that corner to start the screen saver: with Cefalo Living
     Wall chosen below for each display, your Mac locks behind the moving wall. The
     power button shows a still photo.

  Screen Saver       [ Screen Saver Options… ]
     Choose Cefalo Living Wall for each display. Its Options… set its own Motion
     and Rain.
```

- **Live Lock Screen pop-up:** Off, Top-Left Corner, Top-Right Corner, Bottom-Left Corner,
  Bottom-Right Corner. It shows the corner that starts the screen saver now, whoever set it,
  read from the Dock's settings each time the window becomes key (so a change made in System
  Settings shows). Choosing keeps today's rules (`hotCornerPlan`): one corner only; a corner
  used for something else asks first — "The <corner> is set to <action>. Replace it?" — as a
  sheet on the window, Replace or Cancel; Cancel puts the pop-up back; the Dock restarts to
  take a change; a corner the app set is remembered (`liveLockCorner`) so uninstalling clears
  it; the log records the choice.
- **Screen Saver Options… button:** opens System Settings where the screen saver is chosen
  (`openScreenSaverSettings`): the Wallpaper page on macOS 26, which holds the screen savers,
  the Screen Saver page up to macOS 15 (`screenSaverSettingsPage(macOSMajor:)`). Found at the
  first try: the old link opened General on macOS 26, which has no Screen Saver page.
- The explanations are secondary (grey, small) text under each row. The corner starts whichever
  screen saver is chosen for each display, so the Live Lock Screen line points at the Screen
  Saver row below (2026-09-28, the user's point); the app does not read that choice (macOS keeps
  it in a private format).

Unchanged: the first-run "Use Cefalo Living Wall as your screen saver?" prompt; uninstall
clearing an app-set corner; Rain and Motion.

## 5. How it is built

| File | Change |
|---|---|
| `mac/HotCorner.swift` | Pop-up mapping (pure): the titles in order (`"Off"`, then each corner's title) and index ↔ corner (0 = Off) |
| `mac/SettingsWindow.swift` (new) | The window, built in code: a grid of two rows (label, control, explanation). Rereads the Dock's corners when it becomes key. Hands a chosen corner to the shared choose function; shows the replace question as a sheet |
| `mac/LivingWall.swift` | Menu: remove the Live Lock Screen submenu and Screen Saver Options…; add Settings… (⌘,). The corner-choosing flow (today's `chooseCorner`: plan, ask, write, remember, log) becomes one function the window calls. `--check-settings` (below) |
| `mac/build.sh` | Compile `SettingsWindow.swift` into the app |
| `mac/tests/hot-corner-test.swift` | Tests for the mapping |
| `mac/tests/run.sh`, `mac/install.sh` | Run `--check-settings` next to `--check` and `--check-saver` |

## 6. Testing

- **Unit (test first):** the pop-up mapping — five titles in order; index 0 is Off; each corner
  maps to its index and back; the index shown for the Dock's actions (via `liveLockCorner`).
  The existing corner-decision tests stay.
- **`--check-settings`:** the app opens the window off screen and checks its title, the
  pop-up's five items, that its selection matches the Dock's current corner, and that the
  Screen Saver Options… button is there; then closes it. It changes nothing (no Dock write).
  Run in `mac/tests/run.sh` and before installing in `install.sh`.
- **By hand (the user):** open Settings…, change the corner, see the replace question,
  press the button.

## 7. Documentation

README: the menu list becomes Pause, Rain, Motion, Settings… with the window's two items
explained; the lock-screen FAQ points to Settings ▸ Live Lock Screen. The uncommitted rename of
the menu item to "Screen Saver Options…" (2026-09-28) folds into this change: the name moves to
the window's button. The screen-saver spec's note on that menu item records the move.

## 8. Out of scope

The screen saver's own Motion and Rain in this window; a "Require password" status; a
start-at-login switch; SwiftUI.

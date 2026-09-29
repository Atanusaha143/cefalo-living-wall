# Cefalo Living Wall

The Cefalo green wall as a live macOS desktop wallpaper and screen saver. The leaves
sway in the breeze, gusts roll across the wall, leaves bend away from your cursor,
butterflies drop by now and then, a light sweeps along the logo, and it can rain.

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
item added" notification. Rerun the same command to update: it quits any copy that is
still running, including one you opened by hand.

Coming from the earlier "Green Wall" version? The installer removes it, and your pause
choice, Motion level and remembered original wallpaper carry over.

## Use

Click the icon in the menu bar, Cefalo's three dots with two leaves opening from them:

- **Pause / Resume** stops or starts the animation, and is remembered.
- **Rain** makes it rain in front of the wall on every display: **Drizzle**, **Steady** or
  **Monsoon**, or **Off**. It builds up and swells and eases on its own. A drizzle is a fine
  veil drifting in the air, and the roof's edge only drips; steady rain and a monsoon pour off
  the roof, knock and shake the leaves and lean together in the gusts, and a monsoon greys the
  view behind a veil. The leaves turn glossy and a mist dims the scene; they dry about a minute
  after it stops. Butterflies stay away while it rains. Remembered, and Off until you choose
  a mode.
- **Motion** sets how fast and how far the leaves move: Gentle, Lively (the default) or
  Wild. Switching eases into the new level over about a second. It applies to every display
  and is remembered.
- **Settings…** (⌘,) opens a window for the settings you set once:
  - **Live Lock Screen** picks a hot corner, or **Off**: moving the pointer into that corner
    starts the screen saver, and your Mac locks behind it. It is the living wall only where
    Cefalo Living Wall is the chosen screen saver (Screen Saver Options…, for each display);
    elsewhere the corner starts whichever screen saver is chosen. Only one corner starts the
    screen saver: the pop-up shows it, even one set in System Settings, and **Off** clears it.
    A corner already used for something else (Quick Note, say) asks before it is replaced. The
    Dock restarts to take the change (a brief flicker). Uninstalling clears a corner set here.
  - **Screen Saver Options…** opens System Settings where the screen saver is chosen: choose
    Cefalo Living Wall there for each display, and its **Options…** set the screen saver's own
    Motion and Rain.
- **Quit** closes it until you next log in.

Move the cursor over the wall to brush the leaves. A resting butterfly takes off if the
cursor comes close. Icons, clicks and dragging on the desktop work as usual.

## Screen saver

The first time the app starts it offers to open Screen Saver settings: choose
**Cefalo Living Wall** there (System Settings → Wallpaper on macOS 26, which holds the screen
savers; System Settings → Screen Saver, under *Other*, on macOS 13–15). With more
than one display, macOS keeps a choice per display: pick the display at the top of that
page and choose it for each one. It plays the living wall while the screen saver runs,
and the wallpaper underneath rests meanwhile. **Options…** next to it sets its own Motion
level (Lively by default) and its own Rain mode (Off by default). Between runs nothing draws.

It keeps playing on the lock screen: when the screen saver starts (after inactivity, from a
hot corner or with `open -a ScreenSaverEngine`), macOS 26 locks the Mac behind it and the wall
goes on moving until you wake it; it rests as soon as the displays sleep. Locking straight
away (the power button, ⌃⌘Q) shows the still photo instead: macOS starts no screen saver then.

## Uninstall

```sh
sh mac/uninstall.sh
```

This stops the app (every running copy, including one you opened by hand), removes it, the
screen saver and the login item (including any left from "Green Wall"), and puts back your
previous desktop picture. Your settings are kept; `defaults delete local.cefalo-living-wall`
clears them.

## FAQ

**Will it drain my battery?** It uses more power than a still picture. It draws at most
30 frames a second, 15 when windows cover most of the desktop, and stops completely when
the desktop is almost fully covered and while the screen is locked or asleep. It keeps
running in Low Power Mode; pause it from the menu if you want to save more.

**What does it read?** The cursor position (so the leaves can react) and the positions
of windows (to know how much of the desktop is visible). Never window contents, never
keystrokes. It needs no Accessibility, Input Monitoring or Screen Recording permission,
and makes no network requests.

**Multiple displays?** Each display gets its own wall. A screen wider than the photo, such
as a 16:9 monitor, shows its full width and crops mostly from the bottom, so the ceiling
and its downlights stay clear of the menu bar.

**Why is it not moving?** Open the menu: the first line says why (paused, covered by
windows, screen locked or asleep, screen saver running, scene failed to load). If Reduce
Motion is on, it starts paused until you choose Resume.

**Where is the menu bar icon?** On a MacBook with a notch, macOS hides menu-bar icons that do
not fit beside it. Quit or ⌘-drag away another icon to make room.

**Can the lock screen move?** Yes, when the screen saver starts first: macOS locks behind
it and the wall keeps moving. Locking with the power button or ⌃⌘Q shows the still photo,
because macOS starts no screen saver then. To lock with the live wall, choose a corner in
**Settings… ▸ Live Lock Screen** and move the pointer there, and set System Settings ▸ Lock
Screen ▸ Require password after screen saver begins to Immediately.

**Something looks wrong?** `pkill -USR1 -f "Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall"`
writes what the app and each display's scene are doing to `~/Library/Logs/Cefalo Living Wall.log`.
The screen saver logs to the system log: `log show --last 10m --predicate 'subsystem == "local.cefalo-living-wall.saver"'`.

## Develop

Node.js 22 or newer; there is nothing to install.

```sh
npm start            # browser preview at http://127.0.0.1:8080/scene/
npm test             # unit tests
npm run smoke        # headless Chrome loads the scene and checks it draws
npm run test:mac     # host logic + the app and screen saver running in WebKit
npm run test:photo   # the maths that prepares the photo
```

In the browser: move the pointer over the leaves, Space to pause, keys 1–3 to pick the
Motion level, R to step through the rain modes. Add `?debug` for frame rate and frame time,
`?t=12` to freeze at 12 s, `?seed=3` for a different wall, `?motion=3`…`5` to start at a
Motion level (Gentle, Lively, Wild), and `?rain=1`…`3` to start it raining (Drizzle,
Steady, Monsoon).

The photo the scene uses, `scene/assets/wall.jpg`, is made from the original
`assets-src/green-wall.jpg` by `npm run photo`: it scales it to 3840×2560, levels the
ceiling (the camera caught it sloping down to the right) and lifts the dark corners part
of the way. The command prints where the downlights ended up; copy that line into
`LIGHTS` in `scene/src/wall.js`.

Three.js 0.186.0 is bundled under its MIT license (`scene/vendor/LICENSE`).

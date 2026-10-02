# Cefalo Living Wall

The Cefalo green wall as a live macOS desktop wallpaper and screen saver. The leaves
sway in the breeze, gusts roll across the wall, leaves bend away from your cursor,
butterflies drop by now and then, a light sweeps along the logo, and it can rain or snow.

It is the real photo with a layer of 3D leaves in front, rendered with Three.js in a
web view that sits behind your desktop icons. Everything runs locally and offline.

> The photo of the green wall, with the Cefalo logo on it, belongs to
> [Cefalo](https://www.cefalo.com) and is used with their permission.

## Install

You need macOS 13 or newer and the Xcode command line tools (`xcode-select --install`).
From the project folder:

```sh
sh mac/install.sh
```

The script builds the app and the screen saver, renders a still of the wall's first
frame (the photo with the leaves the scene adds), checks that both run, installs the app
at `~/Applications/Cefalo Living Wall.app` and the screen saver in
`~/Library/Screen Savers`, sets that still as your desktop picture (your current one is
remembered), and starts the app now and at every login. macOS may show a "background
item added" notification. Rerun the same command to update: it quits any copy that is
still running, including one you opened by hand.

## Use

Click the icon in the menu bar, Cefalo's three dots with two leaves opening from them (the
app's own icon, in Finder and Login Items, is the same mark in Cefalo's colours):

- **Pause / Resume** stops or starts the animation, and is remembered.
- **Rain** makes it rain in front of the wall on every display: **Drizzle**, **Steady** or
  **Monsoon**, or **Off**. It builds up and swells and eases on its own. A drizzle is a fine
  veil drifting in the air, and the roof's edge only drips; steady rain and a monsoon pour off
  the roof, knock and shake the leaves and lean together in the gusts, and a monsoon greys the
  view behind a veil. The leaves turn glossy and a mist dims the scene; they dry about a minute
  after it stops. Butterflies stay away while it rains. Remembered, and Off until you choose
  a mode.
- **Snow** makes it snow in front of the wall on every display: **Flurries**, **Steady** or
  **Blizzard**, or **Off**. One weather at a time: choosing a snow mode stops the rain, and a
  rain mode stops the snow. Flakes drift and tumble, glow in the downlights and swirl in the
  gusts; flurries come and go in still air, and a blizzard drives small flakes sideways and
  whites out the view. The light turns cold. The snow settles on the leaves and the pebbles over
  a few minutes, always starting from a bare wall, and CEFALO keeps a dark margin round its
  letters. A leaf shakes its snow off when your cursor brushes it, a strong gust hits it or a
  butterfly takes off from it. It melts over about three minutes after the snow stops (sooner
  in rain), leaving the leaves wet. Butterflies stay away while it snows. Remembered, and Off
  until you choose a mode.
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
    Motion, Rain and Snow.
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
level (Lively by default) and its own Rain or Snow (Off by default; one at a time). Between
runs nothing draws.
When it starts, the still of the wall shows at once and comes alive about two seconds
later, fading into the moving wall: macOS starts a fresh copy of the screen saver for each
display, and the scene takes that long to load. The still is the wall's own first frame,
so only the motion changes.

It keeps playing on the lock screen: when the screen saver starts (after inactivity, from a
hot corner or with `open -a ScreenSaverEngine`), macOS 26 locks the Mac behind it and the wall
goes on moving until you wake it; it rests as soon as the displays sleep. Locking straight
away (the power button, ⌃⌘Q) shows the still instead: macOS starts no screen saver then.

## Uninstall

```sh
sh mac/uninstall.sh
```

This stops the app (every running copy, including one you opened by hand), removes it, the
screen saver and the login item, and puts back your previous desktop picture. Your settings
are kept; `defaults delete local.cefalo-living-wall` clears them.

## Power and memory

The moving wall costs about 5.5 W while you can see it, and nothing measurable once it stops.
Measured on 2 October 2026 on a 14-inch MacBook Pro (M2 Pro, 16 GB, macOS 26.7) on battery,
with its built-in display and a 1080p monitor, Low Power Mode off, Motion at Lively and the
cursor still. Each case ran for 1.5 to 3 minutes and is compared with the app quit, when the
whole Mac drew about 8.2 W:

| The wall | Frame rate | Extra power | Battery an hour | CPU | GPU busy | Memory |
| --- | --- | --- | --- | --- | --- | --- |
| In view: dry, Monsoon or Blizzard | 30 fps | 5–6 W | about 8 % | 0.8 of a core | 30–36 % | 690 MB |
| Mostly covered by windows | 15 fps | 2 W | about 3 % | 0.4 of a core | 13 % | 670 MB |
| Covered, paused, locked or asleep | none | none measurable | none | none | idle | 570 MB |

- **Extra power** is for the whole Mac, read from the battery's own gauge (±0.5 W). The CPU
  and GPU account for 1.5 W of it (`powermetrics`); the rest is spent elsewhere in the Mac
  while it draws.
- **Battery an hour** is that power as a share of the 70 Wh battery in a new 14-inch MacBook Pro.
- **CPU** counts one core as 1: the app and its WebKit processes take about 0.37 of a core, and
  WindowServer, which puts the wall on the screen, about 0.42 more. Together that is under a
  tenth of the M2 Pro's ten cores.
- **Memory** is Activity Monitor's figure for the app and its WebKit processes: about 390 MB for
  the built-in display's scene, 210 MB for the 1080p one and 90 MB for the rest. It stays loaded
  while the wall rests. A 4K display would need roughly 500 MB on its own (estimated from these
  two).

Rain and snow cost no more than a dry wall. Not measured: other Macs, 4K and 5K displays, the
screen saver, and Low Power Mode.

## FAQ

**Will it drain my battery?** Only while you can see it move. It draws at most 30 frames a
second, 15 when windows cover most of the desktop, and stops completely when the desktop is
almost fully covered and while the screen is locked or asleep. On a 14-inch MacBook Pro that is
about 5.5 W (8 % of the battery an hour) with the desktop in view, 2 W at 15 frames a second and
nothing measurable once it stops; see [Power and memory](#power-and-memory). It keeps running
in Low Power Mode; pause it from the menu if you want to save more.

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
it and the wall keeps moving. Locking with the power button or ⌃⌘Q shows the still,
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
Motion level, R to step through the rain modes and S through the snow modes. Add `?debug`
for frame rate and frame time, `?t=12` to freeze at 12 s, `?seed=3` for a different wall,
`?motion=3`…`5` to start at a Motion level (Gentle, Lively, Wild), `?rain=1`…`3` to start it
raining (Drizzle, Steady, Monsoon) and `?snow=1`…`3` to start it snowing (Flurries, Steady,
Blizzard); `?t=200&snow=3` shows a wall snowed in.

The photo the scene uses, `scene/assets/wall.jpg`, is made from the original
`assets-src/green-wall.jpg` by `npm run photo`: it scales it to 3840×2560, levels the
ceiling (the camera caught it sloping down to the right) and lifts the dark corners part
of the way. The command prints where the downlights ended up; copy that line into
`LIGHTS` in `scene/src/wall.js`.

## License

The code is under the MIT License ([LICENSE](LICENSE)). The photo of the green wall
(`assets-src/green-wall.jpg`, `scene/assets/wall.jpg` and the stills made from it) and
Cefalo's name, logo and three-dot mark belong to Cefalo and are not covered by that license;
they are used here with Cefalo's permission. Three.js 0.186.0 is bundled under its own MIT
license (`scene/vendor/LICENSE`). The leaves in the menu bar icon and the app's icon are Apple's
`leaf.fill` symbol, drawn from the Mac's own symbols (they are not in this repository). Apple's
terms do not allow its symbols in app icons, so the app icon's leaves must be replaced before
the app is shared publicly.

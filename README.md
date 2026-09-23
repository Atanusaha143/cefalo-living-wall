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
windows, screen locked, Low Power Mode). If Reduce Motion is on, it starts paused until
you choose Resume.

**Where is the leaf icon?** On a MacBook with a notch, macOS hides menu-bar icons that do
not fit beside it. Quit or ⌘-drag away another icon to make room.

**Something looks wrong?** `pkill -USR1 -f "Green Wall.app/Contents/MacOS/Green Wall"`
writes what the app and each display's scene are doing to `~/Library/Logs/Green Wall.log`.

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

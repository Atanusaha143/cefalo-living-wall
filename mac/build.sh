#!/bin/sh
# Build "HR Is Watching.app" and "HR Is Watching.saver" into the folder given
# (default: build/): compile each, add its own copy of the scene and the still of its first
# frame, give the app its icon, sign ad hoc. Needs the Xcode command line tools, and a
# logged-in session: the app renders the still through WebKit.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
out=${1:-"$project/build"}
app="$out/HR Is Watching.app"
saver="$out/HR Is Watching.saver"
target="$(uname -m)-apple-macos13.0"

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

# Each bundle's own copy of the scene, without Finder's .DS_Store files. No trailing slash on
# the source: with one, cp copies the folder's contents instead.
copy_scene() {
	cp -R "$project/scene" "$1/Contents/Resources/"
	find "$1/Contents/Resources/scene" -name .DS_Store -delete
}

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
# Built for this Mac's own architecture; the binary never leaves it.
swiftc -O -parse-as-library -swift-version 5 -module-name LivingWall -target "$target" \
	-o "$app/Contents/MacOS/HR Is Watching" "$here/LivingWall.swift" "$here/SceneWebView.swift" \
	"$here/Coverage.swift" "$here/HostLogic.swift" "$here/MenuIcon.swift" "$here/HotCorner.swift" "$here/SettingsWindow.swift" "$here/SceneStill.swift" "$here/AppIcon.swift" -framework Cocoa -framework WebKit -framework ScreenSaver
cp "$here/Info.plist" "$app/Contents/Info.plist"
copy_scene "$app"
# The scene's first frame, with the leaves it adds to the photo: the desktop picture, and the
# screen saver's still while the scene loads. Rendered before signing, which seals the bundle.
"$app/Contents/MacOS/HR Is Watching" --render-still "$app/Contents/Resources/still.jpg"
# Its icon: the menu bar icon's mark in Cefalo's colours on a white tile, every size.
iconset="$out/AppIcon.iconset"
rm -rf "$iconset"
"$app/Contents/MacOS/HR Is Watching" --render-icon "$iconset"
iconutil -c icns -o "$app/Contents/Resources/AppIcon.icns" "$iconset"
rm -rf "$iconset"
codesign --force --sign - "$app" >/dev/null 2>&1 || echo "note: ad-hoc signing failed; the app still runs locally" >&2
echo "Built $app"

# The screen saver: a loadable bundle (MH_BUNDLE) whose principal class macOS instantiates.
rm -rf "$saver"
mkdir -p "$saver/Contents/MacOS" "$saver/Contents/Resources"
swiftc -O -parse-as-library -swift-version 5 -module-name LivingWallSaver -target "$target" \
	-emit-executable -Xlinker -bundle -o "$saver/Contents/MacOS/HR Is Watching" \
	"$here/Saver.swift" "$here/SaverSettings.swift" "$here/SceneWebView.swift" "$here/HostLogic.swift" \
	-framework Cocoa -framework WebKit -framework ScreenSaver
cp "$here/Saver-Info.plist" "$saver/Contents/Info.plist"
copy_scene "$saver"
cp "$app/Contents/Resources/still.jpg" "$saver/Contents/Resources/"
codesign --force --sign - "$saver" >/dev/null 2>&1 || echo "note: ad-hoc signing failed for the screen saver" >&2
echo "Built $saver"

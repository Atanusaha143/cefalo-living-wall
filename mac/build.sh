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
	"$here/Coverage.swift" "$here/HostLogic.swift" "$here/MenuIcon.swift" -framework Cocoa -framework WebKit -framework ScreenSaver
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
	"$here/Saver.swift" "$here/SaverSettings.swift" "$here/SceneWebView.swift" "$here/HostLogic.swift" \
	-framework Cocoa -framework WebKit -framework ScreenSaver
cp "$here/Saver-Info.plist" "$saver/Contents/Info.plist"
cp -R "$project/scene" "$saver/Contents/Resources/"
codesign --force --sign - "$saver" >/dev/null 2>&1 || echo "note: ad-hoc signing failed for the screen saver" >&2
echo "Built $saver"

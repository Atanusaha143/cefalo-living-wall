#!/bin/sh
# Assemble "Green Wall.app" at the path given (default: build/Green Wall.app):
# compile the host, add the scene, sign it ad hoc. Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
project=$(dirname "$here")
app=${1:-"$project/build/Green Wall.app"}

if ! command -v swiftc >/dev/null; then
	echo "swiftc is missing. Install the Xcode command line tools: xcode-select --install" >&2
	exit 1
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
# Built for this Mac's own architecture; the binary never leaves it.
swiftc -O -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
	-o "$app/Contents/MacOS/Green Wall" "$here/GreenWall.swift" "$here/Coverage.swift" \
	-framework Cocoa -framework WebKit
cp "$here/Info.plist" "$app/Contents/Info.plist"
# No trailing slash on the source: with one, cp copies the folder's contents instead.
cp -R "$project/scene" "$app/Contents/Resources/"
codesign --force --sign - "$app" >/dev/null 2>&1 || echo "note: ad-hoc signing failed; the app still runs locally" >&2
echo "Built $app"

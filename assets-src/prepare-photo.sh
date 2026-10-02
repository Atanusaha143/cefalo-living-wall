#!/bin/sh
# Rebuild scene/assets/wall.jpg from assets-src/green-wall.jpg (ceiling levelled, corners
# lifted; see PhotoFix.swift), then make it HR's wall (hr/compose.py), and print where the
# downlights ended up, for LIGHTS in scene/src/wall.js. Needs the Xcode command line tools,
# and Python 3 with Pillow and NumPy.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -O -parse-as-library -swift-version 5 -o "$build/prepare-photo" "$here/PhotoFix.swift" "$here/prepare-photo.swift"
"$build/prepare-photo" "$here/green-wall.jpg" "$build/levelled.jpg"
python3 "$here/hr/compose.py" "$build/levelled.jpg" "$(dirname "$here")/scene/assets/wall.jpg"

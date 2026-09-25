#!/bin/sh
# Rebuild scene/assets/wall.jpg from assets-src/green-wall.jpg (ceiling levelled, corners
# lifted; see PhotoFix.swift) and print where the downlights ended up, for LIGHTS in
# scene/src/wall.js. Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -O -parse-as-library -swift-version 5 -o "$build/prepare-photo" "$here/PhotoFix.swift" "$here/prepare-photo.swift"
"$build/prepare-photo" "$here/green-wall.jpg" "$(dirname "$here")/scene/assets/wall.jpg"

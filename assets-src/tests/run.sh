#!/bin/sh
# The photo preparation's maths (PhotoFix.swift). Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -parse-as-library -swift-version 5 -o "$build/photo-fix-test" "$here/PhotoFix.swift" "$here/tests/photo-fix-test.swift"
"$build/photo-fix-test"

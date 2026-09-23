#!/bin/sh
# The macOS host's tests: the coverage maths and host decisions, then the real scene loading in WebKit
# through the app's own --check mode. Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -parse-as-library -swift-version 5 -o "$build/coverage-test" "$here/Coverage.swift" "$here/tests/coverage-test.swift"
"$build/coverage-test"
swiftc -parse-as-library -swift-version 5 -o "$build/host-logic-test" "$here/HostLogic.swift" "$here/tests/host-logic-test.swift"
"$build/host-logic-test"

sh "$here/build.sh" "$build/Green Wall.app"
"$build/Green Wall.app/Contents/MacOS/Green Wall" --check

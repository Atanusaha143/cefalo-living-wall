#!/bin/sh
# The macOS host's tests: the coverage maths, host decisions, the screen saver's stored
# settings, the menu bar icon, the app's icon and the live lock screen's hot corner, then
# the real scene and the screen saver loading in WebKit and the Settings window building
# (the app's --check, --check-saver and --check-settings). Needs the Xcode command line tools.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT

swiftc -parse-as-library -swift-version 5 -o "$build/coverage-test" "$here/Coverage.swift" "$here/tests/coverage-test.swift"
"$build/coverage-test"
swiftc -parse-as-library -swift-version 5 -o "$build/host-logic-test" "$here/HostLogic.swift" "$here/tests/host-logic-test.swift"
"$build/host-logic-test"
swiftc -parse-as-library -swift-version 5 -o "$build/saver-settings-test" "$here/HostLogic.swift" "$here/SaverSettings.swift" \
	"$here/tests/saver-settings-test.swift" -framework ScreenSaver
"$build/saver-settings-test"
swiftc -parse-as-library -swift-version 5 -o "$build/menu-icon-test" "$here/MenuIcon.swift" "$here/tests/menu-icon-test.swift"
"$build/menu-icon-test"
swiftc -parse-as-library -swift-version 5 -o "$build/app-icon-test" "$here/MenuIcon.swift" "$here/AppIcon.swift" "$here/tests/app-icon-test.swift"
"$build/app-icon-test"
swiftc -parse-as-library -swift-version 5 -o "$build/hot-corner-test" "$here/HotCorner.swift" "$here/tests/hot-corner-test.swift"
"$build/hot-corner-test"

sh "$here/build.sh" "$build"
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check
saver="$build/Cefalo Living Wall.saver"
if [ ! -x "$saver/Contents/MacOS/Cefalo Living Wall" ]; then
	echo "FAIL: build.sh did not build the screen saver" >&2
	exit 1
fi
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check-saver "$saver"
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check-settings

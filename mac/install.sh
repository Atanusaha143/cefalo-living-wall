#!/bin/sh
# Build Green Wall, check that its scene loads in WebKit, install it in ~/Applications,
# and start it now and at every login. Rerun to update.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
label=local.green-wall
app="$HOME/Applications/Green Wall.app"
agent="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
sh "$here/build.sh" "$build/Green Wall.app"
echo "Checking the scene loads..."
"$build/Green Wall.app/Contents/MacOS/Green Wall" --check

launchctl bootout "$domain/$label" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build/Green Wall.app" "$app"

mkdir -p "$(dirname "$agent")" "$HOME/Library/Logs"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$app/Contents/MacOS/Green Wall</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<!-- Restart after a crash, but not after Quit (a clean exit). -->
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>StandardErrorPath</key>
	<string>$HOME/Library/Logs/Green Wall.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "$domain" "$agent"
launchctl kickstart -k "$domain/$label"
echo "Green Wall installed: $app"
echo "Look for the leaf in the menu bar. Log: ~/Library/Logs/Green Wall.log"

#!/bin/sh
# Build Cefalo Living Wall and its screen saver, check that both run in WebKit, install the
# app in ~/Applications and the screen saver in ~/Library/Screen Savers, and start the app
# now and at every login. Rerun to update. Replaces an install from when it was called
# "Green Wall" (its settings carry over on first launch).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
label=local.cefalo-living-wall
app="$HOME/Applications/Cefalo Living Wall.app"
saver="$HOME/Library/Screen Savers/Cefalo Living Wall.saver"
agent="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/Cefalo Living Wall.log"
domain="gui/$(id -u)"

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
sh "$here/build.sh" "$build"
echo "Checking the scene loads..."
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check
echo "Checking the screen saver runs..."
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check-saver "$build/Cefalo Living Wall.saver"
echo "Checking the Settings window..."
"$build/Cefalo Living Wall.app/Contents/MacOS/Cefalo Living Wall" --check-settings

# The old name: stop it and remove its app and login item.
launchctl bootout "$domain/local.green-wall" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/local.green-wall.plist"
rm -rf "$HOME/Applications/Green Wall.app"

launchctl bootout "$domain/$label" 2>/dev/null || true
# A copy opened by hand rather than by the login item keeps drawing the old code over the
# new one: quit every copy (quitting never changes the desktop picture).
pkill -x "Cefalo Living Wall" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build/Cefalo Living Wall.app" "$app"
mkdir -p "$(dirname "$saver")"
rm -rf "$saver"
mv "$build/Cefalo Living Wall.saver" "$saver"
# A running screen-saver host keeps the old code loaded; macOS starts a fresh one when needed.
pkill -f "legacyScreenSaver.appex/Contents/MacOS/legacyScreenSaver" 2>/dev/null || true

mkdir -p "$(dirname "$agent")" "$(dirname "$log")"
cat >"$agent" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>ProgramArguments</key>
	<array>
		<string>$app/Contents/MacOS/Cefalo Living Wall</string>
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
	<string>$log</string>
</dict>
</plist>
PLIST

# Loading the agent starts the app (RunAtLoad). No kickstart -k: restarting it moments
# after launch could interrupt its first run while it saves the previous desktop picture.
launchctl bootstrap "$domain" "$agent"
echo "Cefalo Living Wall installed: $app"
echo "Screen saver installed: $saver (choose it in System Settings > Wallpaper; on macOS 15 and earlier, Screen Saver)"
echo "Look for the three dots and two leaves in the menu bar. Log: ~/Library/Logs/Cefalo Living Wall.log"

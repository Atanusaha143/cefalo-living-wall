#!/bin/sh
# Build HR Is Watching and its screen saver, check that both run in WebKit, install the
# app in ~/Applications and the screen saver in ~/Library/Screen Savers, and start the app
# now and at every login. Rerun to update.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
label=local.hr-is-watching
app="$HOME/Applications/HR Is Watching.app"
saver="$HOME/Library/Screen Savers/HR Is Watching.saver"
agent="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/HR Is Watching.log"
domain="gui/$(id -u)"

build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
sh "$here/build.sh" "$build"
echo "Checking the scene loads..."
"$build/HR Is Watching.app/Contents/MacOS/HR Is Watching" --check
echo "Checking the screen saver runs..."
"$build/HR Is Watching.app/Contents/MacOS/HR Is Watching" --check-saver "$build/HR Is Watching.saver"
echo "Checking the Settings window..."
"$build/HR Is Watching.app/Contents/MacOS/HR Is Watching" --check-settings

launchctl bootout "$domain/$label" 2>/dev/null || true
# A copy opened by hand rather than by the login item keeps drawing the old code over the
# new one: quit every copy (quitting never changes the desktop picture).
pkill -x "HR Is Watching" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$app"
mv "$build/HR Is Watching.app" "$app"
mkdir -p "$(dirname "$saver")"
rm -rf "$saver"
mv "$build/HR Is Watching.saver" "$saver"
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
		<string>$app/Contents/MacOS/HR Is Watching</string>
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
echo "HR Is Watching installed: $app"
echo "Screen saver installed: $saver (choose it in System Settings > Wallpaper; on macOS 15 and earlier, Screen Saver)"
echo "Look for the three dots and two leaves in the menu bar. Log: ~/Library/Logs/HR Is Watching.log"

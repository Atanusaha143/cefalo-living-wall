#!/bin/sh
# Stop Green Wall, remove it and its login item, and put back the previous desktop picture.
set -eu
label=local.green-wall
app="$HOME/Applications/Green Wall.app"
agent="$HOME/Library/LaunchAgents/$label.plist"

if [ -x "$app/Contents/MacOS/Green Wall" ]; then
	"$app/Contents/MacOS/Green Wall" --restore-desktop-picture || echo "Could not restore the desktop picture; choose one in System Settings." >&2
fi
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$agent"
rm -rf "$app" "$HOME/Library/Application Support/Green Wall"
echo "Green Wall removed. Your pause preference is kept; clear it with: defaults delete $label"

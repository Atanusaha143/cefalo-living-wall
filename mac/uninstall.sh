#!/bin/sh
# Stop Green Wall, remove it and its login item, and put back the previous desktop picture.
set -eu
label=local.green-wall
app="$HOME/Applications/Green Wall.app"
agent="$HOME/Library/LaunchAgents/$label.plist"

support="$HOME/Library/Application Support/Green Wall"

restored=yes
if [ -x "$app/Contents/MacOS/Green Wall" ]; then
	"$app/Contents/MacOS/Green Wall" --restore-desktop-picture || restored=no
fi
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$agent"
rm -rf "$app"
if [ "$restored" = yes ]; then
	rm -rf "$support"
	echo "Green Wall removed and your previous desktop picture is back."
else
	# The desktop still points at the still picture, so its file stays.
	echo "Green Wall removed, but the previous desktop picture could not be restored." >&2
	echo "Choose one in System Settings > Wallpaper, then delete: $support" >&2
fi
echo "Your pause preference is kept; clear it with: defaults delete $label"

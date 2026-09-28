#!/bin/sh
# Stop Cefalo Living Wall, remove it, its screen saver and its login item, and put back the
# previous desktop picture. Also removes anything left from when it was called "Green Wall".
set -eu
label=local.cefalo-living-wall
app="$HOME/Applications/Cefalo Living Wall.app"
old_app="$HOME/Applications/Green Wall.app"
support="$HOME/Library/Application Support/Cefalo Living Wall"
old_support="$HOME/Library/Application Support/Green Wall"
domain="gui/$(id -u)"

restored=yes
if [ -x "$app/Contents/MacOS/Cefalo Living Wall" ]; then
	"$app/Contents/MacOS/Cefalo Living Wall" --restore-desktop-picture || restored=no
elif [ -x "$old_app/Contents/MacOS/Green Wall" ]; then
	"$old_app/Contents/MacOS/Green Wall" --restore-desktop-picture || restored=no
fi
for name in "$label" local.green-wall; do
	launchctl bootout "$domain/$name" 2>/dev/null || true
	rm -f "$HOME/Library/LaunchAgents/$name.plist"
done
# A copy opened by hand rather than by the login item would keep running: quit every copy
# (the app sets its photo only at launch, so the picture restored above stays).
pkill -x "Cefalo Living Wall" 2>/dev/null || true
pkill -x "Green Wall" 2>/dev/null || true
# The live lock screen's hot corner, if this app set it and it still starts the screen saver:
# with the screen saver gone it would start another one.
corner=$(defaults read "$label" liveLockCorner 2>/dev/null || true)
case "$corner" in tl | tr | bl | br)
	if [ "$(defaults read com.apple.dock "wvous-$corner-corner" 2>/dev/null || true)" = 5 ]; then
		defaults write com.apple.dock "wvous-$corner-corner" -int 1
		killall Dock 2>/dev/null || true
	fi
	;;
esac
rm -rf "$app" "$old_app" "$HOME/Library/Screen Savers/Cefalo Living Wall.saver"
rm -f "$HOME/Library/Logs/Cefalo Living Wall.log" "$HOME/Library/Logs/Green Wall.log"
if [ "$restored" = yes ]; then
	rm -rf "$support" "$old_support"
	echo "Cefalo Living Wall removed and your previous desktop picture is back."
else
	# The desktop still points at a still picture, so its file stays.
	echo "Cefalo Living Wall removed, but the previous desktop picture could not be restored." >&2
	echo "Choose one in System Settings > Wallpaper, then delete: $support" >&2
fi
echo "Your preferences are kept; clear them with: defaults delete $label (and defaults delete local.green-wall)"

#!/bin/sh
# Stop HR Is Watching, remove it, its screen saver and its login item, and put back the
# previous desktop picture.
set -eu
label=local.hr-is-watching
app="$HOME/Applications/HR Is Watching.app"
support="$HOME/Library/Application Support/HR Is Watching"
domain="gui/$(id -u)"

restored=yes
if [ -x "$app/Contents/MacOS/HR Is Watching" ]; then
	"$app/Contents/MacOS/HR Is Watching" --restore-desktop-picture || restored=no
fi
launchctl bootout "$domain/$label" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$label.plist"
# A copy opened by hand rather than by the login item would keep running: quit every copy
# (the app sets its photo only at launch, so the picture restored above stays).
pkill -x "HR Is Watching" 2>/dev/null || true
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
rm -rf "$app" "$HOME/Library/Screen Savers/HR Is Watching.saver"
rm -f "$HOME/Library/Logs/HR Is Watching.log"
if [ "$restored" = yes ]; then
	rm -rf "$support"
	echo "HR Is Watching removed and your previous desktop picture is back."
else
	# The desktop still points at a still picture, so its file stays.
	echo "HR Is Watching removed, but the previous desktop picture could not be restored." >&2
	echo "Choose one in System Settings > Wallpaper, then delete: $support" >&2
fi
echo "Your preferences are kept; clear them with: defaults delete $label"

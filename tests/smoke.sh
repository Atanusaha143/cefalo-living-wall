#!/bin/sh
# Loads the scene in headless Chrome at a frozen time and checks that it draws.
# Needs Google Chrome. Writes tests/out/smoke-<size>.png, smoke-rain-<size>.png and
# smoke-snow-<size>.png for a look.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
port=${SMOKE_PORT:-8765}
out="$root/tests/out"
mkdir -p "$out"

PORT=$port node "$root/serve.mjs" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
sleep 1

status=0
# Dry, raining, a blizzard 200 s in (snowed in), and a page asked for two weathers at once (it
# must start dry); each at the built-in XDR display's size, then a 16:9 external display.
for weather in dry rain snow both; do
for size in 1512,982 1920,1080; do
	name=$size query="t=${SMOKE_T:-10}&smoke"
	if [ "$weather" = rain ]; then name="rain-$size" query="$query&rain=2"; fi
	if [ "$weather" = snow ]; then name="snow-$size" query="t=200&smoke&snow=3"; fi
	if [ "$weather" = both ]; then name="both-$size" query="$query&rain=2&snow=2"; fi
	log="$out/chrome-$name.log"
	"$chrome" --headless=new --hide-scrollbars --enable-logging=stderr --v=0 \
		--window-size=$size --virtual-time-budget=20000 --screenshot="$out/smoke-$name.png" \
		"http://127.0.0.1:$port/scene/?$query" 2>"$log" >/dev/null || true
	if grep -E 'CONSOLE.*(Uncaught|Error)' "$log"; then
		echo "FAIL $name: console errors (see $log)"
		status=1
		continue
	fi
	line=$(grep -o 'SMOKE {.*}' "$log" | head -1 | sed 's/^SMOKE //') || true
	if [ -z "$line" ]; then
		echo "FAIL $name: the scene never reported (see $log)"
		status=1
		continue
	fi
	node -e '
	  const r = JSON.parse(process.argv[1]);
	  const bad = ["webgl2", "bridge", "nonBlank", "diagnostics"].filter((k) => r[k] !== true);
	  if (r.motion !== 4) bad.push(`motion ${r.motion} (expected the Lively default, 4)`);
	  const weather = process.argv[3];
	  if (weather === "rain" && !(r.rain?.mode === 2 && r.rain.level > 0)) bad.push(`rain ${JSON.stringify(r.rain)} (expected Steady rain)`);
	  if (weather !== "rain" && r.rain?.mode !== 0) bad.push(`rain ${JSON.stringify(r.rain)} (expected no rain)`);
	  if (weather === "snow" && !(r.snow?.mode === 3 && r.snow.level > 0 && r.snow.cover > 0.5)) bad.push(`snow ${JSON.stringify(r.snow)} (expected a blizzard, snowed in)`);
	  if (weather !== "snow" && r.snow?.mode !== 0) bad.push(`snow ${JSON.stringify(r.snow)} (expected no snow)`);
	  // CEFALO stays legible: its letters well above the wall round them, however much snow has settled.
	  if (!(r.logo?.letters - r.logo?.ring >= 100)) bad.push(`logo ${JSON.stringify(r.logo)} (expected the letters at least 100 brighter than the ring round them)`);
	  if (bad.length) { console.log(`FAIL ${process.argv[2]}:`, bad.join(", "), JSON.stringify(r)); process.exit(1); }
	  console.log(`PASS ${process.argv[2]}`, JSON.stringify(r));
	' "$line" "$name" "$weather" || status=1
done
done
exit $status

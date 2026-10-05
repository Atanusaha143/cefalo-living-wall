// Checks the Windows host's pure decisions: power state, status line, the pictures to save and
// restore, weather and Motion, framing, how Windows started it, the cursor, the screen saver's
// dismissal and the coverage maths. The shared ones are mac/tests/host-logic-test.swift's.
using System.Drawing;
using LivingWall;

var failures = 0;
void Check(bool ok, string what)
{
    Console.WriteLine(ok ? $"ok   {what}" : $"FAIL {what}");
    if (!ok) failures++;
}

// Lock, then the displays sleep, then the user wakes them: still locked.
var power = new PowerState { Locked = true, ScreensAsleep = true };
power.ScreensAsleep = false;
Check(power.Still, "waking the displays behind the lock screen keeps the wall still");
Check(HostLogic.StatusLine(false, power, false, 30) == "Stopped — screen locked", "the status line says the screen is locked");
power.Locked = false;
Check(!power.Still, "unlocking lets it run again");
Check(HostLogic.StatusLine(false, power, false, 30) == "Running · 30 fps", "running status");
power.EnergySaver = true;
Check(!power.Still, "energy saver does not stop the wall (the user's choice)");
Check(HostLogic.StatusLine(false, power, true, 0) == "Paused", "pausing still works with energy saver on");
Check(HostLogic.StatusLine(false, new PowerState(), false, 0) == "Stopped — covered by windows", "covered by windows");
Check(HostLogic.StatusLine(true, new PowerState(), false, 30) == "Scene failed to load", "a failed scene says so first");
Check(new PowerState { SessionInactive = true }.Still && HostLogic.StatusLine(false, new PowerState { SessionInactive = true }, false, 30) == "Stopped — screen asleep",
    "another user's session on the console stops it");
// Off displays and a sleeping PC are two reasons: a timer waking the PC leaves the displays off.
var night = new PowerState { ScreensAsleep = true, Sleeping = true };
night.Sleeping = false;
Check(night.Still && HostLogic.StatusLine(false, night, false, 30) == "Stopped — screen asleep",
    "a timer waking the PC while its displays are off keeps the wall still");
var covered = new PowerState { SaverRunning = true };
Check(covered.Still, "the wallpaper rests while the screen saver plays over it");
Check(HostLogic.StatusLine(false, covered, false, 30) == "Stopped — screen saver", "and says so");

Check(HostLogic.MotionLevels.Select(l => l.Name).SequenceEqual(["Gentle", "Lively", "Wild"]), "three motion levels, Gentle to Wild");
Check(HostLogic.MotionLevel(null) == 4, "Lively until the user picks another level");
Check(HostLogic.MotionLevel(3) == 3 && HostLogic.MotionLevel(5) == 5, "a stored level is used");
Check(HostLogic.MotionLevel(0) == 3 && HostLogic.MotionLevel(9) == 5, "a stored level out of range is clamped");

const string still = @"C:\Users\me\AppData\Local\Cefalo Living Wall\Stills\1920x1200-still-a.jpg";
const string mine = @"C:\Users\me\Pictures\beach.jpg", other = @"C:\Users\me\Pictures\mountain.jpg";
var saved = HostLogic.PicturesToSave(
    new Dictionary<string, string?> { ["1"] = mine, ["2"] = still.ToUpperInvariant(), ["3"] = null, ["4"] = other, ["5"] = "" },
    new Dictionary<string, string> { ["4"] = mine }, [still]);
Check(saved.GetValueOrDefault("1") == mine, "a monitor's own picture is remembered");
Check(!saved.ContainsKey("2"), "our own still is never remembered as the user's picture (paths ignore case)");
Check(!saved.ContainsKey("3"), "a monitor whose picture cannot be read is skipped");
Check(saved.GetValueOrDefault("4") == mine, "a picture remembered earlier is never overwritten");
Check(saved.GetValueOrDefault("5") == "", "no picture (a solid colour) is remembered as none");

bool Exists(string path) => path != other;
var restore = HostLogic.PicturesToRestore(["1", "9"], new Dictionary<string, string> { ["1"] = mine }, Exists);
Check(restore.GetValueOrDefault("1") == mine, "each monitor gets its own picture back");
Check(restore.GetValueOrDefault("9") == mine, "a monitor whose ID changed falls back to a saved picture that still exists");
Check(HostLogic.PicturesToRestore(["1"], new Dictionary<string, string> { ["1"] = other }, Exists).Count == 0,
    "a saved picture whose file is gone is not restored");
Check(HostLogic.PicturesToRestore(["1"], new Dictionary<string, string> { ["1"] = "" }, _ => false).GetValueOrDefault("1") == "",
    "a solid colour comes back as none");

Check(HostLogic.ShouldOfferScreenSaver(false, true), "the screen saver is offered once it is installed");
Check(!HostLogic.ShouldOfferScreenSaver(true, true), "never twice");
Check(!HostLogic.ShouldOfferScreenSaver(false, false), "never without it");

// One weather at a time: Rain or Snow, each with three modes, lightest first.
Check(HostLogic.Weathers.Select(w => w.Name).SequenceEqual(["Rain", "Snow"]), "two weathers, Rain then Snow");
Check(HostLogic.Weathers[0].Modes.SequenceEqual(["Drizzle", "Steady", "Monsoon"]) && HostLogic.Weathers[1].Modes.SequenceEqual(["Flurries", "Steady", "Blizzard"]),
    "each with three modes, lightest first");
WeatherChoice Rain(int mode) => new(0, mode);
WeatherChoice Snow(int mode) => new(1, mode);
Check(HostLogic.Choosing(1, 2, Rain(3)) == Snow(2), "choosing a snow mode while it rains stops the rain");
Check(HostLogic.Choosing(0, 1, Snow(3)) == Rain(1), "and a rain mode stops the snow");
Check(HostLogic.Choosing(0, 0, Rain(2)) == WeatherChoice.Off, "a weather's Off turns it off");
Check(HostLogic.Choosing(0, 0, Snow(2)) == Snow(2), "and changes nothing while the other weather is on");
Check(HostLogic.Choosing(1, 9, WeatherChoice.Off) == Snow(3), "a mode out of range is clamped");
Check(Snow(2).Modes.SequenceEqual([0, 2]) && WeatherChoice.Off.Modes.SequenceEqual([0, 0]), "the scene gets every weather's mode, at most one on");
Check(HostLogic.WeatherQuery(Snow(2)) == "rain=0&snow=2" && HostLogic.WeatherScript(Rain(3)) == "wallSetRain(3); wallSetSnow(0)",
    "as the page's query and as calls to it");
Check(HostLogic.BridgeScript(15, true, 5, Snow(1)) == "wallSetMaxFps(15); wallSetPaused(true); wallSetMotion(5); wallSetRain(0); wallSetSnow(1)"
    && HostLogic.BridgeScript(-1, false, 4, WeatherChoice.Off).StartsWith("wallSetMaxFps(0); wallSetPaused(false);"),
    "the scene is told its frame cap (never below 0), pause, Motion and weather in one script");
Check(Rain(3).Stored == "rain:3" && Snow(1).Stored == "snow:1" && WeatherChoice.Off.Stored == "off", "stored as one value");
Check(HostLogic.ParseWeather("snow:2") == Snow(2), "the stored weather is used");
Check(HostLogic.ParseWeather("rain:7") == Rain(3) && HostLogic.ParseWeather("snow:-1") == WeatherChoice.Off, "its mode clamped");
Check(new string?[] { null, "off", "", "fog:1", "snow", "snow:two", "rain:1:1", "Rain:1" }.All(s => HostLogic.ParseWeather(s) == WeatherChoice.Off),
    "anything unreadable, or nothing yet, is Off");

// The still sits exactly where the scene draws the wall (scene/src/fit.js coverFit), y down.
bool Near(RectangleF a, RectangleF b) =>
    Math.Abs(a.X - b.X) < 0.01 && Math.Abs(a.Y - b.Y) < 0.01 && Math.Abs(a.Width - b.Width) < 0.01 && Math.Abs(a.Height - b.Height) < 0.01;
Check(Near(HostLogic.WallPhotoFrame(new SizeF(1920, 1080)), new RectangleF(0, -20.04f, 1920, 1280.4f)),
    "a wide display shows the wall's full width, cropped mostly from the bottom, like the scene");
Check(Near(HostLogic.WallPhotoFrame(new SizeF(1920, 1200)), new RectangleF(0, -8.04f, 1920, 1280.4f)), "a 16:10 display too");
Check(Near(HostLogic.WallPhotoFrame(new SizeF(1000, 1000)), new RectangleF(-249.7657f, 0, 1499.5314f, 1000)),
    "a narrow view shows the wall's full height, cropped evenly left and right");
Check(new[] { new SizeF(1920, 1080), new SizeF(320, 200), new SizeF(800, 1200) }.All(size =>
{
    var frame = HostLogic.WallPhotoFrame(size);
    return frame.Left <= 0.001 && frame.Top <= 0.001 && frame.Right >= size.Width - 0.001 && frame.Bottom >= size.Height - 0.001;
}), "the still always covers the whole view");

// Windows keeps showing its copy of a picture set again under the same path.
Check(HostLogic.StillName(null, new HashSet<string>()) == "still-a.jpg", "the first still, over the user's own picture");
Check(HostLogic.StillName("still-a.jpg", new HashSet<string> { "still-a.jpg" }) == "still-a.jpg", "the same still again keeps its name");
Check(HostLogic.StillName(null, new HashSet<string> { "still-a.jpg" }) == "still-b.jpg", "a changed still goes under the other name");
Check(HostLogic.StillName(null, new HashSet<string> { "still-b.jpg" }) == "still-a.jpg", "and back, the next time it changes");
Check(HostLogic.StillName(null, new HashSet<string> { "still-a.jpg", "still-b.jpg" }) == "still-a.jpg", "both shown and neither holds it: the first name");

// How Windows starts a screen saver; the same program is the wallpaper app.
Check(HostLogic.ParseLaunch([], false) == (LaunchKind.App, 0), "the .exe with no arguments is the wallpaper app");
Check(HostLogic.ParseLaunch([], true) == (LaunchKind.SaverConfigure, 0), "the .scr with none shows its settings (double-clicked, or Configure in Explorer)");
Check(HostLogic.ParseLaunch(["/s"], true).Kind == LaunchKind.SaverRun && HostLogic.ParseLaunch(["/S"], true).Kind == LaunchKind.SaverRun
    && HostLogic.ParseLaunch(["-s"], true).Kind == LaunchKind.SaverRun, "/s runs it, in either case or with a dash");
Check(HostLogic.ParseLaunch(["/p", "4242"], true) == (LaunchKind.SaverPreview, 4242) && HostLogic.ParseLaunch(["/p:4242"], true) == (LaunchKind.SaverPreview, 4242),
    "/p shows the preview in the window given, after a space or a colon");
Check(HostLogic.ParseLaunch(["/p"], true).Kind == LaunchKind.App, "a preview with no window is not one");
Check(HostLogic.ParseLaunch(["/c:777"], true) == (LaunchKind.SaverConfigure, 777) && HostLogic.ParseLaunch(["/c"], true) == (LaunchKind.SaverConfigure, 0),
    "/c shows the settings, owned by the window given");
Check(HostLogic.ParseLaunch(["/a", "12"], true).Kind == LaunchKind.SaverIgnored, "/a (a Windows 9x password change) does nothing");
Check(HostLogic.ParseLaunch(["--check"], false).Kind == LaunchKind.App && HostLogic.ParseLaunch(["/save"], true).Kind == LaunchKind.App,
    "the app's own options are not screen-saver switches");

// The cursor reaches each display's scene in its CSS pixels.
var monitor = new Rectangle(1920, -300, 2560, 1440);
Check(HostLogic.CssPoint(new Point(2020, -100), monitor, 1.25) == new PointF(80, 160), "a cursor on a scaled display, in its CSS pixels");
Check(HostLogic.CssPoint(new Point(100, 100), monitor, 1) is null, "a cursor on another display is not over this one");
Check(HostLogic.CssPoint(new Point(1920 + 2560, 0), monitor, 1) is null, "the right edge belongs to the next display");

// The screen saver ends on real input, not on a jiggle of the mouse.
var start = new Point(500, 500);
Check(!HostLogic.SaverDismissed(start, start, false), "nothing happened, or a touch of the mouse under a pixel: it keeps playing");
Check(!HostLogic.SaverDismissed(start, new Point(504, 497), false), "a jiggle of a few pixels does not end it");
Check(HostLogic.SaverDismissed(start, new Point(540, 500), false), "a real move does");
Check(HostLogic.SaverDismissed(start, start, true), "a key, a click or the wheel does, the cursor still");
Check(HostLogic.IsPress(true, 0) && !HostLogic.IsPress(true, 1) && HostLogic.IsPress(true, 2),
    "a key going down is a press (an extended one too); one let go of is not");
Check(HostLogic.IsPress(false, 0x1) && HostLogic.IsPress(false, 0x4) && HostLogic.IsPress(false, 0x10) && HostLogic.IsPress(false, 0x400),
    "a mouse button going down, or the wheel, is a press");
Check(!HostLogic.IsPress(false, 0) && !HostLogic.IsPress(false, 0x2) && !HostLogic.IsPress(false, 0x8),
    "mouse motion, and a button let go of, are not");

Check(HostLogic.IsOurScreenSaver(@"C:\Users\me\AppData\Local\Programs\Cefalo Living Wall\Cefalo Living Wall.scr",
    @"c:\users\me\appdata\local\programs\cefalo living wall\cefalo living wall.scr"), "our screen saver is recognised, whatever the case");
Check(HostLogic.IsOurScreenSaver("\"C:\\Programs\\Wall\\Cefalo Living Wall.scr\"", @"C:\Programs\Wall\Cefalo Living Wall.scr"), "in quotes too");
Check(!HostLogic.IsOurScreenSaver(@"C:\Windows\System32\Mystify.scr", @"C:\Programs\Wall\Cefalo Living Wall.scr")
    && !HostLogic.IsOurScreenSaver(null, "x") && !HostLogic.IsOurScreenSaver(" ", "x"), "another, or none, is not");

// The coverage maths (mac/tests/coverage-test.swift).
var screen = new RectangleF(0, 0, 1512, 982);
var left = new RectangleF(0, 0, 756, 982);
var middle = new RectangleF(378, 0, 756, 982);
Check(Coverage.VisibleFraction(screen, []) == 1, "no windows: all visible");
Check(Coverage.VisibleFraction(screen, [screen]) == 0, "one full-screen window: none visible");
Check(Math.Abs(Coverage.VisibleFraction(screen, [left]) - 0.5) < 0.01, "half covered: half visible");
Check(Math.Abs(Coverage.VisibleFraction(screen, [left, middle]) - 0.25) < 0.01, "two overlapping half windows: overlap counted once");
Check(Coverage.VisibleFraction(screen, [new RectangleF(1512, 0, 1920, 1080)]) == 1, "a window on another screen does not count");
Check(Coverage.VisibleFraction(new RectangleF(0, -1080, 1920, 1080), [new RectangleF(0, -1080, 1920, 540)]) == 0.5,
    "a display above the main one (negative coordinates) too");
Check(Coverage.FrameCap(1) == 30 && Coverage.FrameCap(0.40) == 30, "mostly visible: 30 fps");
Check(Coverage.FrameCap(0.39) == 15 && Coverage.FrameCap(0.05) == 15, "mostly covered: 15 fps");
Check(Coverage.FrameCap(0.049) == 0 && Coverage.FrameCap(0) == 0, "almost fully covered: stopped");

var app = new WindowInfo("Chrome_WidgetWin_1", new Rectangle(0, 0, 800, 600), true, false, false, false, false, null);
Check(Coverage.CountsAsBlocker(app), "an app's window covers the desktop");
Check(!Coverage.CountsAsBlocker(app with { Visible = false }) && !Coverage.CountsAsBlocker(app with { Minimised = true }), "a hidden or minimised one does not");
Check(!Coverage.CountsAsBlocker(app with { Cloaked = true }), "nor one on another virtual desktop (cloaked)");
Check(!Coverage.CountsAsBlocker(app with { Ours = true }), "nor our own");
Check(!Coverage.CountsAsBlocker(app with { ClickThrough = true }) && !Coverage.CountsAsBlocker(app with { Alpha = 128 }),
    "nor an overlay or a see-through window");
Check(Coverage.CountsAsBlocker(app with { Alpha = 255 }), "a layered window drawn solid does");
Check(new[] { "Progman", "WorkerW" }.All(c => !Coverage.CountsAsBlocker(app with { ClassName = c })), "nor the desktop itself");
Check(new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" }.All(c => Coverage.CountsAsBlocker(app with { ClassName = c })), "but the taskbars do");
var maximised = new RectangleF(0, 0, 1920, 1140);
var taskbar = new RectangleF(0, 1140, 1920, 60);
Check(Coverage.FrameCap(Coverage.VisibleFraction(new RectangleF(0, 0, 1920, 1200), [maximised, taskbar])) == 0,
    "a maximised window and the taskbar under it stop the wall");
Check(!Coverage.CountsAsBlocker(app with { Bounds = new Rectangle(10, 10, 0, 40) }), "nor an empty one");

return failures == 0 ? 0 : 1;

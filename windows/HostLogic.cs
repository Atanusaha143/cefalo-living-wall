// The Windows host's decisions, kept apart from Windows itself so windows/tests can check them.
// Ported from mac/HostLogic.swift: keep the two in step where they share a decision.
using System.Drawing;

namespace LivingWall;

/// Every reason the wall may not draw, kept apart: unlocking must not start a wall whose
/// displays are still off. Energy saver is tracked for diagnostics but does not stop the wall
/// (the user's choice).
public struct PowerState
{
    public bool EnergySaver;
    public bool Locked;
    /// The displays are off.
    public bool ScreensAsleep;
    /// The PC is asleep: kept apart from the displays, since a timer can wake the PC with them still off.
    public bool Sleeping;
    /// Another user's session is on the console, or this one is disconnected (Remote Desktop).
    public bool SessionInactive;
    /// The screen saver is playing over the wall: rendering underneath would only cost power.
    public bool SaverRunning;

    public readonly bool Still => Locked || ScreensAsleep || Sleeping || SessionInactive || SaverRunning;

    public override readonly string ToString() =>
        $"energySaver {EnergySaver} locked {Locked} screensAsleep {ScreensAsleep} sleeping {Sleeping} sessionInactive {SessionInactive} saverRunning {SaverRunning}";
}

/// Off, or the one weather that is on (a `HostLogic.Weathers` index) and its mode (1…).
public readonly record struct WeatherChoice(int? Weather, int Mode)
{
    public static readonly WeatherChoice Off = new(null, 0);

    /// That weather's mode: 0 unless it is the one on.
    public int ModeOf(int weather) => Weather == weather ? Mode : 0;
    /// Every weather's mode, in `Weathers` order: at most one is not 0.
    public int[] Modes => Enumerable.Range(0, HostLogic.Weathers.Length).Select(ModeOf).ToArray();
    /// As stored: "off", or the weather's name in lower case and its mode, e.g. "snow:3".
    public string Stored => Weather is int w ? $"{HostLogic.Weathers[w].Name.ToLowerInvariant()}:{Mode}" : "off";
}

/// How the program was started (Program.cs): as the wallpaper app, or by Windows as a screen saver.
public enum LaunchKind { App, SaverRun, SaverPreview, SaverConfigure, SaverIgnored }

public static class HostLogic
{
    /// The menu's first line, and the tray icon's tooltip: why the wall is doing what it does.
    public static string StatusLine(bool failed, PowerState power, bool paused, int rate) =>
        failed ? "Scene failed to load"
        : paused ? "Paused"
        : power.Locked ? "Stopped — screen locked"
        : power.SaverRunning ? "Stopped — screen saver"
        : power.ScreensAsleep || power.Sleeping || power.SessionInactive ? "Stopped — screen asleep"
        : rate == 0 ? "Stopped — covered by windows"
        : $"Running · {rate} fps";

    static readonly StringComparer Paths = StringComparer.OrdinalIgnoreCase;

    /// The desktop pictures to remember (monitor ID → path, "" for none, a solid colour) before
    /// showing the still: what was saved before stays, none of our own stills is ever recorded,
    /// and a monitor whose picture cannot be read (null) is skipped.
    public static Dictionary<string, string> PicturesToSave(
        IReadOnlyDictionary<string, string?> current, IReadOnlyDictionary<string, string> saved, IEnumerable<string> ours)
    {
        var ourPaths = new HashSet<string>(ours.Select(Normalize), Paths);
        var result = new Dictionary<string, string>(saved);
        foreach (var (id, path) in current)
        {
            if (result.ContainsKey(id) || path is null || (path != "" && ourPaths.Contains(Normalize(path)))) continue;
            result[id] = path;
        }
        return result;
    }

    /// What to put back on each monitor: its own saved picture, or, when its ID has changed
    /// since install, the first saved picture whose file still exists. "" (no picture) always can be.
    public static Dictionary<string, string> PicturesToRestore(
        IEnumerable<string> monitors, IReadOnlyDictionary<string, string> saved, Func<string, bool> exists)
    {
        var usable = saved.Where(p => p.Value == "" || exists(p.Value)).ToDictionary(p => p.Key, p => p.Value);
        var fallback = usable.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Value).FirstOrDefault();
        var result = new Dictionary<string, string>();
        foreach (var id in monitors)
            if ((usable.TryGetValue(id, out var path) ? path : fallback) is string picture) result[id] = picture;
        return result;
    }

    static string Normalize(string path)
    {
        try { return Path.GetFullPath(path); } catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException) { return path; }
    }

    /// The Motion menu's levels, as in scene/src/motion.js (3 Gentle, 4 Lively, 5 Wild).
    public static readonly (int Level, string Name)[] MotionLevels = [(3, "Gentle"), (4, "Lively"), (5, "Wild")];

    /// The Motion level to use: the stored choice clamped to 3…5, or Lively (4) until the user picks one.
    public static int MotionLevel(int? stored) =>
        stored is int level ? Math.Clamp(level, MotionLevels[0].Level, MotionLevels[^1].Level) : 4;

    /// Whether to offer, once, to use the screen saver.
    public static bool ShouldOfferScreenSaver(bool alreadyShown, bool saverInstalled) => !alreadyShown && saverInstalled;

    /// The weathers, in menu order, each with its modes, lightest first (mode 0 is Off), and the hint
    /// under its list in the screen saver's Options. One at a time: as in scene/src/main.js.
    public static readonly (string Name, string[] Modes, string Hint)[] Weathers =
    [
        ("Rain", ["Drizzle", "Steady", "Monsoon"], "Rain falling in front of the wall."),
        ("Snow", ["Flurries", "Steady", "Blizzard"], "Snow falling in front of the wall."),
    ];

    /// The weather after choosing `mode` in `weather`'s submenu or list: a mode makes it the one
    /// weather (every other goes off); its Off (0) turns only it off, so nothing changes while
    /// another weather is on.
    public static WeatherChoice Choosing(int weather, int mode, WeatherChoice current)
    {
        if (mode > 0) return new WeatherChoice(weather, Math.Min(mode, Weathers[weather].Modes.Length));
        return current.Weather == weather ? WeatherChoice.Off : current;
    }

    /// The weather stored as `WeatherChoice.Stored` ("snow:3"), its mode clamped; anything unreadable is Off.
    public static WeatherChoice ParseWeather(string? stored)
    {
        var parts = stored?.Split(':') ?? [];
        if (parts.Length != 2 || !int.TryParse(parts[1], out var mode)) return WeatherChoice.Off;
        var weather = Array.FindIndex(Weathers, w => w.Name.ToLowerInvariant() == parts[0]);
        return weather < 0 ? WeatherChoice.Off : Choosing(weather, Math.Max(0, mode), WeatherChoice.Off);
    }

    /// The scene's page asked for this weather: "rain=0&snow=2" (scene/src/main.js reads them).
    public static string WeatherQuery(WeatherChoice choice) =>
        string.Join("&", Weathers.Select((w, i) => $"{w.Name.ToLowerInvariant()}={choice.ModeOf(i)}"));

    /// The scene told this weather: "wallSetRain(0); wallSetSnow(2)".
    public static string WeatherScript(WeatherChoice choice) =>
        string.Join("; ", Weathers.Select((w, i) => $"wallSet{w.Name}({choice.ModeOf(i)})"));

    /// Everything the scene is told when it is ready, and again on any change: its frame cap (0
    /// stops it), whether it is paused, its Motion level and its weather (scene/src/main.js's bridge).
    public static string BridgeScript(int maxFps, bool paused, int motion, WeatherChoice weather) =>
        $"wallSetMaxFps({Math.Max(maxFps, 0)}); wallSetPaused({(paused ? "true" : "false")}); wallSetMotion({motion}); {WeatherScript(weather)}";

    /// Where the whole wall sits in a view (y down) when framed as the scene frames it:
    /// scene/src/fit.js coverFit, a cover fit that crops a wide view mostly from the bottom. The
    /// desktop picture and the screen saver's still are drawn there, so the moving wall takes
    /// over without a jump. Keep in step with fit.js and scene/src/wall.js.
    public static RectangleF WallPhotoFrame(SizeF view)
    {
        const float wallW = 1600, wallH = 1067, anchorY = 0.1f;
        var scale = Math.Max(view.Width / wallW, view.Height / wallH);
        var size = new SizeF(wallW * scale, wallH * scale);
        var top = (size.Height - view.Height) * anchorY;   // cropped above the view
        return new RectangleF((view.Width - size.Width) / 2, -top, size.Width, size.Height);
    }

    /// The desktop still's names, used in turn. Windows keeps showing its copy of a picture set
    /// again under the same path, so a changed still goes under a name no monitor shows.
    public static readonly string[] StillNames = ["still-a.jpg", "still-b.jpg"];

    /// The name to show the still under: the one whose file already holds exactly this still, else
    /// the first that no monitor shows now (the first name if both are).
    public static string StillName(string? holding, IReadOnlySet<string> shown) =>
        holding ?? StillNames.FirstOrDefault(n => !shown.Contains(n)) ?? StillNames[0];

    /// How Windows started the program. A screen saver is started with /s (run), /p <window>
    /// (the preview in Screen Saver Settings) or /c[:<window>] (its settings); started with
    /// none, a .scr shows its settings and the .exe is the wallpaper app. Windows writes the
    /// switches with / or -, in either case, and the window after a colon or a space.
    public static (LaunchKind Kind, IntPtr Window) ParseLaunch(string[] args, bool isScr)
    {
        if (args.Length == 0) return (isScr ? LaunchKind.SaverConfigure : LaunchKind.App, 0);
        var first = args[0].Trim();
        if (first.Length < 2 || (first[0] != '/' && first[0] != '-')) return (LaunchKind.App, 0);
        var rest = first.Length > 2 && first[2] == ':' ? first[3..] : args.Length > 1 ? args[1] : "";
        IntPtr window = long.TryParse(rest, out var handle) ? new IntPtr(handle) : 0;
        return char.ToLowerInvariant(first[1]) switch
        {
            's' when first.Length == 2 => (LaunchKind.SaverRun, 0),
            'p' when window != 0 => (LaunchKind.SaverPreview, window),
            'c' => (LaunchKind.SaverConfigure, window),
            'a' => (LaunchKind.SaverIgnored, 0),   // the Windows 9x password change: nothing to do
            _ => (LaunchKind.App, 0),
        };
    }

    /// The cursor (physical pixels, like the monitor's bounds) in a web view's CSS pixels, or
    /// null when it is not over that monitor. `scale` is the view's rasterization scale.
    public static PointF? CssPoint(Point cursor, Rectangle monitor, double scale)
    {
        if (!monitor.Contains(cursor) || scale <= 0) return null;
        return new PointF((float)((cursor.X - monitor.X) / scale), (float)((cursor.Y - monitor.Y) / scale));
    }

    /// Whether the user is back, ending the screen saver: a key, a button or the wheel
    /// (`pressed`, from raw input), or the cursor really moved. Like Windows' own savers, a jiggle
    /// of the mouse does not, nor does a touch that moves it less than a pixel (which Windows
    /// still counts as input, so the session's last-input time cannot tell).
    public static bool SaverDismissed(Point start, Point now, bool pressed, int moveThreshold = 8) =>
        pressed || Math.Max(Math.Abs(now.X - start.X), Math.Abs(now.Y - start.Y)) > moveThreshold;

    /// Whether a raw input event is a press that ends the screen saver: a key going down
    /// (RAWKEYBOARD.Flags without RI_KEY_BREAK), or a mouse button going down or the wheel
    /// turning (RAWMOUSE.usButtonFlags). Keys and buttons let go of are not, nor is motion.
    public static bool IsPress(bool keyboard, ushort flags) =>
        keyboard ? (flags & 0x1) == 0 : (flags & (0x1 | 0x4 | 0x10 | 0x40 | 0x100 | 0x400 | 0x800)) != 0;

    /// Whether Windows' chosen screen saver (HKCU\Control Panel\Desktop\SCRNSAVE.EXE) is ours.
    public static bool IsOurScreenSaver(string? chosen, string ours) =>
        !string.IsNullOrWhiteSpace(chosen) && Paths.Equals(Normalize(chosen.Trim().Trim('"')), Normalize(ours));
}

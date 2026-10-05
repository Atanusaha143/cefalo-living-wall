// Cefalo Living Wall: the Cefalo green wall, alive, as the desktop wallpaper.
//
// One window per display sits in the desktop's own wallpaper layer, under the icons, and never
// takes a mouse event, so the desktop works as usual (Desktop.cs). Each shows the bundled scene
// in a web view (SceneView.cs). The cursor position is read on a timer and handed to the scene;
// nothing else about the user's session is read except window positions. The Windows
// counterpart of the Controller in mac/LivingWall.swift.
using System.Diagnostics;
using System.Drawing;
using System.Reflection;
using Microsoft.Win32;
using static LivingWall.Native;
using Timer = System.Windows.Forms.Timer;

namespace LivingWall;

sealed class Controller : ApplicationContext
{
    /// `Cefalo Living Wall.exe --report` sets this event; the running app then logs a full dump.
    public const string ReportEvent = @"Local\CefaloLivingWall.Report";
    /// `--quit` sets this one (install.ps1 and uninstall.ps1): the app quits as from its menu.
    public const string QuitEvent = @"Local\CefaloLivingWall.Quit";
    /// A second copy started (from the Start menu, say) sets this one and leaves: this one says where it is.
    public const string HelloEvent = @"Local\CefaloLivingWall.Hello";
    /// The still of the scene's first frame, rendered by build.ps1 (SceneStill.cs).
    public static string StillPath => Path.Combine(AppContext.BaseDirectory, "still.jpg");

    readonly List<Wallpaper> walls = [];
    Rectangle[] layout = [];
    IntPtr layer;
    PowerState power;
    List<WindowInfo> blockers = [];
    int applied;
    Point lastPoint = new(int.MinValue, int.MinValue);
    readonly Timer pointerTimer = new(), coverageTimer = new() { Interval = 1500 }, rebuildTimer = new() { Interval = 700 };
    int pointerRate;
    readonly NotifyIcon tray = new();
    readonly ContextMenuStrip menu = new();
    readonly ToolStripMenuItem state = new() { Enabled = false };
    readonly ToolStripMenuItem pauseItem = new("Pause");
    /// Each weather's submenu items (`Weathers` order), Off then its modes; each item's tag is its mode.
    readonly List<ToolStripMenuItem[]> weatherItems = [];
    readonly List<ToolStripMenuItem> motionItems = [];
    readonly SystemWatch events = new();
    readonly SynchronizationContext ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
    RegisteredWaitHandle? reportWait, quitWait, helloWait;
    Icon? trayIcon;
    bool rebuildPictures;
    /// Walls are about to be built (BuildAfterNewPicture): a rebuild meanwhile would only build them twice.
    bool building;
    /// How fast and how far the leaves move; remembered across restarts.
    int motion = HostLogic.MotionLevel(Settings.Int("motion"));
    /// The one weather on every display, or none; remembered, Off until chosen.
    WeatherChoice weather = HostLogic.ParseWeather(Settings.String("weather"));
    /// Remembered across restarts; moving until paused. Unlike on the Mac, where Reduce Motion starts it
    /// paused, Windows' Animation effects setting is left alone: company PCs and remote desktops often
    /// turn it off for speed, not for the user's sake.
    bool paused = Settings.Bool("paused") ?? false;

    public Controller()
    {
        Log.Write($"started (WebView2 {Scene.RuntimeVersion() ?? "missing"}, {Environment.OSVersion.VersionString})");
        if (DesktopPicture.Install(StillPath)) BuildAfterNewPicture().Forget("building the walls");
        else Build();
        AddMenu();
        // Each reason to stay still is tracked on its own (see PowerState).
        events.LockChanged += locked => { power.Locked = locked; Log.Write(locked ? "screen locked" : "screen unlocked"); ApplyRate(); };
        events.SessionInactiveChanged += inactive => { power.SessionInactive = inactive; ApplyRate(); };
        events.DisplaysOffChanged += off => { power.ScreensAsleep = off; ApplyRate(); };
        events.SleepChanged += asleep => { power.Sleeping = asleep; ApplyRate(); };
        events.DisplaysChanged += () => { rebuildPictures = true; ScheduleRebuild(); };
        events.ExplorerRestarted += () => { Log.Write("Explorer restarted"); ScheduleRebuild(); UpdateTrayIcon(); };
        events.SettingChanged += area => { if (area == "ImmersiveColorSet") UpdateTrayIcon(); };
        rebuildTimer.Tick += (_, _) => { rebuildTimer.Stop(); Rebuild(); };
        coverageTimer.Tick += (_, _) => ApplyRate();
        pointerTimer.Tick += (_, _) => TrackPointer();
        var report = new EventWaitHandle(false, EventResetMode.AutoReset, ReportEvent);
        reportWait = ThreadPool.RegisterWaitForSingleObject(report, (_, _) => ui.Post(_ => Report().Forget("the report"), null), null, -1, false);
        var quit = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEvent);
        quitWait = ThreadPool.RegisterWaitForSingleObject(quit, (_, _) => ui.Post(_ => ExitThread(), null), null, -1, true);
        var hello = new EventWaitHandle(false, EventResetMode.AutoReset, HelloEvent);
        helloWait = ThreadPool.RegisterWaitForSingleObject(hello, (_, _) => ui.Post(_ =>
            tray.ShowBalloonTip(6000, "Cefalo Living Wall is running", "Its menu is under the three dots and two leaves in the taskbar's corner.", ToolTipIcon.None), null),
            null, -1, false);
        // Windows starts it again after a crash or a hang (once it has run a minute); the Run key starts it at sign-in.
        RegisterApplicationRestart(null, 4 | 8);   // RESTART_NO_PATCH | RESTART_NO_REBOOT
        // Once the wall is up, offer (once) to use the screen saver too.
        OfferScreenSaverSoon().Forget("offering the screen saver");
    }

    async Task OfferScreenSaverSoon()
    {
        await Task.Delay(3000);
        if (!HostLogic.ShouldOfferScreenSaver(Settings.Bool("screenSaverPromptShown") ?? false, File.Exists(Saver.ScrPath))) return;
        Settings.Set("screenSaverPromptShown", true);
        if (!ScreenSaverChoice.IsOurs()) ScreenSaverChoice.Offer(firstRun: true);
    }

    // Display changes come in bursts (and a new Explorer takes a moment to make its desktop):
    // act once things settle.
    void ScheduleRebuild()
    {
        rebuildTimer.Stop();
        rebuildTimer.Start();
    }

    void Rebuild()
    {
        if (building) return;
        var displays = Displays.All();
        var moved = !displays.Select(d => d.Bounds).SequenceEqual(layout);
        var newPicture = (moved || rebuildPictures) && DesktopPicture.Install(StillPath);
        rebuildPictures = false;
        if (newPicture) BuildAfterNewPicture().Forget("building the walls");
        else if (moved || layer == 0 || !IsWindow(layer) || walls.Any(w => w.Parent != layer)) Build();
    }

    /// A new desktop picture makes Explorer replace its desktop's layer a moment later, and with
    /// it any wall already there: build once it has (ApplyRate rebuilds if it is later still).
    async Task BuildAfterNewPicture()
    {
        building = true;
        await Task.Delay(1500);
        Build();
    }

    void Build()
    {
        building = false;
        var displays = Displays.All();
        layout = [.. displays.Select(d => d.Bounds)];
        foreach (var wall in walls) wall.Dispose();
        walls.Clear();
        layer = DesktopLayer.FindOrMake();
        Log.Write($"{displays.Length} display(s): {string.Join(", ", displays.Select(d => $"{d.Name} {d.Bounds}"))}; {DesktopLayer.Describe(layer)}");
        if (layer == 0)
        {
            ScheduleRebuild();   // Explorer is not up yet: try again shortly
            return;
        }
        foreach (var display in displays)
        {
            var wall = new Wallpaper(display.Name, display.Bounds, layer, HostWindow.InParent(layer, display.Bounds));
            wall.SetMotion(motion);
            wall.SetWeather(weather);
            walls.Add(wall);
        }
        ApplyRate();
    }

    /// Ordinary app windows over the desktop, excluding ours. Only bounds are read, never contents.
    static List<WindowInfo> WindowBlockers()
    {
        var me = (uint)Environment.ProcessId;
        var found = new List<WindowInfo>();
        EnumWindows((window, _) =>
        {
            if (!IsWindowVisible(window)) return true;
            GetWindowThreadProcessId(window, out var process);
            var ex = (long)GetWindowLongPtr(window, GWL_EXSTYLE);
            DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloaked, sizeof(int));
            // The visible frame, without the invisible borders Windows adds for resizing.
            if (DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, out RECT frame, System.Runtime.InteropServices.Marshal.SizeOf<RECT>()) != 0)
                GetWindowRect(window, out frame);
            byte? alpha = null;
            if ((ex & WS_EX_LAYERED) != 0 && GetLayeredWindowAttributes(window, out uint _, out var a, out var flags) && (flags & LWA_ALPHA) != 0) alpha = a;
            var info = new WindowInfo(ClassName(window), frame.ToRectangle(), true, IsIconic(window), cloaked != 0, process == me,
                (ex & WS_EX_TRANSPARENT) != 0, alpha);
            if (Coverage.CountsAsBlocker(info)) found.Add(info);
            return true;
        }, 0);
        return found;
    }

    async Task Report()
    {
        var point = CursorPosition();
        var rects = blockers.Select(b => (RectangleF)b.Bounds).ToList();
        var visible = walls.Select(w => Coverage.VisibleFraction(w.Bounds, rects).ToString("F2"));
        Log.Write($"host: power {power} paused {paused} applied {applied} pointerRate {pointerRate} motion {motion} weather {weather.Stored} visible [{string.Join(", ", visible)}] cursor {point} overWindow {blockers.Any(b => b.Bounds.Contains(point))} {DesktopLayer.Describe(layer)}");
        Log.Write($"host: {blockers.Count} window(s) over the desktop: {string.Join("; ", blockers.Select(b => $"{b.ClassName} {b.Bounds}"))}");
        for (var i = 0; i < walls.Count; i++) await walls[i].Report(i);
    }

    void ApplyRate()
    {
        power.EnergySaver = EnergySaverOn();
        power.SaverRunning = ScreenSaverRunning();
        var still = power.Still;
        blockers = still || paused ? [] : WindowBlockers();
        var rects = blockers.Select(b => (RectangleF)b.Bounds).ToList();
        applied = 0;
        foreach (var wall in walls)
        {
            var rate = still ? 0 : Coverage.FrameCap(Coverage.VisibleFraction(wall.Bounds, rects));
            wall.SetPaused(paused);
            wall.SetRate(rate);
            applied = Math.Max(applied, paused ? 0 : rate);
        }
        // Windows says nothing when its screen saver stops, so the poll keeps checking while one runs.
        UpdateTimers(pollCoverage: !paused && !(power.Locked || power.ScreensAsleep || power.Sleeping || power.SessionInactive));
        tray.Text = Truncate($"Cefalo Living Wall\n{Status}", 127);
        // Explorer replaced its desktop's layer (it restarted, or another app asked for a new one).
        if (walls.Count > 0 && (!IsWindow(layer) || walls.Any(w => w.Parent != layer))) ScheduleRebuild();
    }

    string Status => HostLogic.StatusLine(walls.Any(w => w.Failed), power, paused, applied);

    static string Truncate(string text, int length) => text.Length <= length ? text : text[..length];

    void UpdateTimers(bool pollCoverage)
    {
        var wanted = Math.Min(30, applied);
        if (wanted != pointerRate)
        {
            pointerTimer.Stop();
            pointerRate = wanted;
            if (wanted > 0)
            {
                pointerTimer.Interval = 1000 / wanted;
                pointerTimer.Start();
            }
        }
        if (!pollCoverage) coverageTimer.Stop();
        else if (!coverageTimer.Enabled) coverageTimer.Start();
    }

    void TrackPointer()
    {
        var point = CursorPosition();
        if (point == lastPoint) return;
        lastPoint = point;
        var overWindow = blockers.Any(b => b.Bounds.Contains(point));
        foreach (var wall in walls) wall.SetPointer(overWindow ? null : HostLogic.CssPoint(point, wall.Bounds, wall.Scale));
    }

    // MARK: - The tray icon and its menu

    void AddMenu()
    {
        menu.ShowCheckMargin = true;
        menu.ShowImageMargin = false;
        menu.Items.Add(state);
        menu.Items.Add(new ToolStripSeparator());
        pauseItem.Click += (_, _) => TogglePause();
        menu.Items.Add(pauseItem);
        for (var index = 0; index < HostLogic.Weathers.Length; index++)
        {
            var (name, modes, _) = HostLogic.Weathers[index];
            var weatherIndex = index;
            var items = new[] { "Off" }.Concat(modes).Select((title, mode) =>
                new ToolStripMenuItem(title, null, (_, _) => ChooseWeather(weatherIndex, mode)) { Tag = mode }).ToArray();
            weatherItems.Add(items);
            var submenu = new ToolStripMenuItem(name);
            submenu.DropDownItems.AddRange(items);
            menu.Items.Add(submenu);
        }
        var levels = new ToolStripMenuItem("Motion");
        foreach (var (level, name) in HostLogic.MotionLevels)
        {
            var item = new ToolStripMenuItem(name, null, (_, _) => ChooseMotion(level)) { Tag = level };
            motionItems.Add(item);
            levels.DropDownItems.Add(item);
        }
        menu.Items.Add(levels);
        menu.Items.Add(new ToolStripMenuItem("Screen Saver…", null, (_, _) => ScreenSaverChoice.OpenSettings()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Quit", null, (_, _) => ExitThread()));
        menu.Opening += (_, _) => MenuNeedsUpdate();
        tray.ContextMenuStrip = menu;
        // A click opens the menu, as the right-click does (and as on the Mac's menu bar).
        tray.MouseUp += (_, e) =>
        {
            if (e.Button == MouseButtons.Left)
                typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(tray, null);
        };
        UpdateTrayIcon();
        tray.Visible = true;
    }

    void UpdateTrayIcon()
    {
        var previous = trayIcon;
        trayIcon = Icons.Tray(Icons.TraySize(), Icons.LightTaskbar());
        tray.Icon = trayIcon;
        previous?.Dispose();
    }

    /// The status line says why the wall is still: unexplained stillness reads as a fault.
    void MenuNeedsUpdate()
    {
        state.Text = Status;
        foreach (var item in motionItems) item.Checked = (int)item.Tag! == motion;
        pauseItem.Text = paused ? "Resume" : "Pause";
        for (var index = 0; index < weatherItems.Count; index++)
            foreach (var item in weatherItems[index]) item.Checked = (int)item.Tag! == weather.ModeOf(index);
    }

    void ChooseMotion(int level)
    {
        motion = level;
        Settings.Set("motion", motion);
        foreach (var wall in walls) wall.SetMotion(motion);
    }

    /// One weather at a time: a mode turns every other weather off; a weather's Off turns only it off.
    void ChooseWeather(int index, int mode)
    {
        weather = HostLogic.Choosing(index, mode, weather);
        Settings.Set("weather", weather.Stored);
        foreach (var wall in walls) wall.SetWeather(weather);
    }

    void TogglePause()
    {
        paused = !paused;
        Settings.Set("paused", paused);
        ApplyRate();
    }

    protected override void ExitThreadCore()
    {
        Log.Write("quit");
        pointerTimer.Stop();
        coverageTimer.Stop();
        rebuildTimer.Stop();
        reportWait?.Unregister(null);
        quitWait?.Unregister(null);
        helloWait?.Unregister(null);
        foreach (var wall in walls) wall.Dispose();
        walls.Clear();
        tray.Visible = false;
        tray.Dispose();
        events.Dispose();
        base.ExitThreadCore();
    }
}

/// Windows' choice of screen saver (HKCU\Control Panel\Desktop\SCRNSAVE.EXE): offering ours,
/// remembering the one it replaced, and putting that back on uninstall.
static class ScreenSaverChoice
{
    const string DesktopKey = @"Control Panel\Desktop", PreviousKey = "previousScreenSaver";

    static string? Current()
    {
        using var key = Registry.CurrentUser.OpenSubKey(DesktopKey);
        return key?.GetValue("SCRNSAVE.EXE") is string path && path.Trim() != "" ? LongPath(path.Trim().Trim('"')) : null;
    }

    public static bool IsOurs() => HostLogic.IsOurScreenSaver(Current(), Saver.ScrPath);

    /// Windows' Screen Saver Settings, where the wait and the lock on resume are set.
    static void OpenDialog() => Process.Start(new ProcessStartInfo("control.exe", "desk.cpl,,@screensaver") { UseShellExecute = true });

    /// Menu ▸ Screen Saver…: Screen Saver Settings, after offering to choose ours there.
    public static void OpenSettings()
    {
        if (!File.Exists(Saver.ScrPath) || IsOurs()) OpenDialog();
        else Offer(firstRun: false);
    }

    /// Asks whether to use the living wall as the screen saver; if so, chooses it, as Install
    /// does on a .scr in Explorer, which opens Screen Saver Settings with it chosen.
    public static void Offer(bool firstRun)
    {
        var answer = MessageBox.Show(
            "Use Cefalo Living Wall as your screen saver?\n\nIt can play the living wall while your PC is idle. Screen Saver Settings open next, "
                + "with it chosen: set how long it waits there, and tick \"On resume, display logon screen\" to lock behind the moving wall.",
            "Cefalo Living Wall", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer != DialogResult.Yes)
        {
            if (!firstRun) OpenDialog();
            return;
        }
        if (Settings.String(PreviousKey) is null) Settings.Set(PreviousKey, Current() ?? "");
        Log.Write("chose the living wall as the screen saver");
        Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "rundll32.exe"), $"desk.cpl,InstallScreenSaver {Saver.ScrPath}") { UseShellExecute = false });
    }

    /// `--restore-screen-saver` (uninstall): if ours is still chosen, put back the one it replaced,
    /// or none. Returns false only if that could not be written.
    public static bool Restore()
    {
        try
        {
            if (IsOurs())
            {
                using var key = Registry.CurrentUser.CreateSubKey(DesktopKey);
                var previous = Settings.String(PreviousKey);
                if (string.IsNullOrEmpty(previous) || !File.Exists(previous)) key.DeleteValue("SCRNSAVE.EXE", false);
                else key.SetValue("SCRNSAVE.EXE", previous);
                // Tell Windows the screen-saver settings changed, as Screen Saver Settings does.
                SystemParametersInfo(SPI_GETSCREENSAVEACTIVE, 0, out var active, 0);
                SystemParametersInfo(SPI_SETSCREENSAVEACTIVE, active, IntPtr.Zero, SPIF_SENDCHANGE);
                Log.Write(string.IsNullOrEmpty(previous) ? "removed the living wall as the screen saver" : $"put back the screen saver {previous}");
            }
            Settings.Remove(PreviousKey);
            return true;
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException or System.Security.SecurityException)
        {
            Log.Write($"could not restore the screen saver: {e.Message}");
            return false;
        }
    }
}

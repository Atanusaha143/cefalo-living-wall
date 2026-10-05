// Cefalo Living Wall as a screen saver: the same program, copied as "Cefalo Living Wall.scr".
// Windows starts it with /s to run it, /p <window> for the preview in Screen Saver Settings,
// and /c for its Options, which set its own Motion, Rain and Snow. The Windows counterpart of
// mac/Saver.swift.
using System.Drawing;
using System.Globalization;
using static LivingWall.Native;
using Timer = System.Windows.Forms.Timer;

namespace LivingWall;

static class Saver
{
    public static string ScrPath => Path.Combine(AppContext.BaseDirectory, "Cefalo Living Wall.scr");

    /// The still of the scene's first frame (Controller.StillPath), or null without one: then
    /// the page's own background shows while the scene loads.
    public static Bitmap? LoadStill()
    {
        try
        {
            using var file = Image.FromFile(Controller.StillPath);
            return new Bitmap(file);
        }
        catch (Exception e) when (e is FileNotFoundException or OutOfMemoryException or ArgumentException)
        {
            Log.Write("the still is missing; the scene loads on its background");
            return null;
        }
    }

    /// /s: the moving wall on every display until the user comes back. Windows locks behind it
    /// when "On resume, display logon screen" is ticked in Screen Saver Settings.
    public static int Run()
    {
        Log.Start("Screen Saver");
        var displays = Displays.All();
        int motion = Settings.SaverMotion;
        var weather = Settings.SaverWeather;
        Log.Write($"started on {displays.Length} display(s): motion {motion}, weather {weather.Stored}");
        var views = new List<SaverView>();
        using (var still = LoadStill())
            foreach (var display in displays)
                views.Add(new SaverView(HostWindow.Popup(display.Bounds, still, topMost: true), 30, motion, weather, "saver"));
        // Keys go to the screen saver, never to the window it covers. Windows lets a screen saver
        // it starts take the foreground; started otherwise (by hand), it may not get it.
        var active = false;
        foreach (var view in views)
            view.Window.Messages = m =>
            {
                if (m.Msg == WM_CLOSE) End("Windows closed it");
                if (m.Msg != WM_ACTIVATEAPP) return false;
                // Another program taking over once the screen saver had the foreground ends it, as
                // Windows' own screen savers do; without the foreground, only the user ends it.
                if (m.WParam != 0) active = true;
                else if (active) End($"another program's window was activated ({ProgramOfThread((uint)m.LParam)})");
                return false;
            };
        Log.Write(SetForegroundWindow(views[0].Window.Handle) ? "in the foreground" : "not given the foreground: only the user ends it");
        using var events = new SystemWatch();
        events.DisplaysOffChanged += off => views.ForEach(v => v.SetPaused(off));
        // The user coming back ends it (HostLogic.SaverDismissed): a key, a button or the wheel,
        // read raw (the web views' windows, not ours, get them), or a real move of the mouse. The
        // first half second settles: Windows may still be moving the cursor as it starts the saver.
        var started = Environment.TickCount64;
        bool Settling() => Environment.TickCount64 - started < 500;
        using var presses = new RawPresses();
        presses.Pressed += what => { if (!Settling()) End(what); };
        var start = CursorPosition();
        using var watch = new Timer { Interval = 100 };
        watch.Tick += (_, _) =>
        {
            var now = CursorPosition();
            if (Settling()) start = now;
            else if (HostLogic.SaverDismissed(start, now, pressed: false)) End($"the mouse moved from {start} to {now}");
        };
        watch.Start();
        Application.Run();
        foreach (var view in views) view.Dispose();
        return 0;
    }

    /// The program a thread belongs to, for the log.
    static string ProgramOfThread(uint thread)
    {
        try
        {
            foreach (var process in System.Diagnostics.Process.GetProcesses())
                using (process)
                    if (process.Threads.Cast<System.Diagnostics.ProcessThread>().Any(t => t.Id == thread)) return process.ProcessName;
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
        return $"thread {thread}";
    }

    static void End(string why)
    {
        Log.Write($"ended: {why}");
        Application.Exit();
    }

    /// /p: the preview in Screen Saver Settings, in the window Windows gives, at 15 fps, until
    /// Windows closes that window.
    public static int Preview(IntPtr parent)
    {
        Log.Start("Screen Saver");
        // A child window must be as DPI-aware as the window it goes in.
        SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(parent));
        GetClientRect(parent, out var box);
        SaverView view;
        using (var still = LoadStill())
            view = new SaverView(HostWindow.Child(parent, box.ToRectangle(), still, clipChildren: false), 15, Settings.SaverMotion, Settings.SaverWeather, "saver");
        using var watch = new Timer { Interval = 500 };
        watch.Tick += (_, _) => { if (!IsWindow(parent) || !view.Window.Alive) Application.Exit(); };
        watch.Start();
        Application.Run();
        view.Dispose();
        return 0;
    }

    /// /c: the Options, owned by the window Windows gives (Screen Saver Settings).
    public static int Configure(IntPtr owner)
    {
        using var dialog = new OptionsDialog();
        dialog.ShowDialog(owner == 0 ? null : new Owner(owner));
        return 0;
    }

    sealed class Owner(IntPtr handle) : IWin32Window
    {
        public IntPtr Handle => handle;
    }
}

/// Keys, mouse buttons and the wheel, wherever they go, from Windows' raw input (to a hidden window
/// of ours, even when it is not in front): what ends the screen saver besides a real move.
sealed class RawPresses : NativeWindow, IDisposable
{
    public event Action<string>? Pressed;
    readonly int header = System.Runtime.InteropServices.Marshal.SizeOf<RAWINPUTHEADER>();
    bool heard;

    public RawPresses()
    {
        CreateHandle(new CreateParams { ExStyle = WS_EX_TOOLWINDOW });
        if (!RegisterRawInputDevices(Devices(RIDEV_INPUTSINK, Handle), 2, System.Runtime.InteropServices.Marshal.SizeOf<RAWINPUTDEVICE>()))
            Log.Write("could not read raw input: only a real move of the mouse ends the screen saver");
    }

    /// The mouse and the keyboard (HID usage page 1, usages 2 and 6).
    static RAWINPUTDEVICE[] Devices(uint flags, IntPtr target) =>
    [
        new() { UsagePage = 1, Usage = 2, Flags = flags, Target = target },
        new() { UsagePage = 1, Usage = 6, Flags = flags, Target = target },
    ];

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_INPUT)
        {
            uint size = 0;
            GetRawInputData(m.LParam, RID_INPUT, 0, ref size, (uint)header);
            var data = System.Runtime.InteropServices.Marshal.AllocHGlobal((int)size);
            try
            {
                // RAWINPUT: its header, then a RAWMOUSE (usButtonFlags 4 bytes in) or a RAWKEYBOARD (Flags 2 bytes in).
                if (size > 0 && GetRawInputData(m.LParam, RID_INPUT, data, ref size, (uint)header) == size)
                {
                    var type = System.Runtime.InteropServices.Marshal.ReadInt32(data);
                    if (!heard)
                    {
                        heard = true;
                        Log.Write("raw input arrives");
                    }
                    if (type is RIM_TYPEMOUSE or RIM_TYPEKEYBOARD)
                    {
                        var keyboard = type == RIM_TYPEKEYBOARD;
                        var flags = (ushort)System.Runtime.InteropServices.Marshal.ReadInt16(data, header + (keyboard ? 2 : 4));
                        if (HostLogic.IsPress(keyboard, flags)) Pressed?.Invoke(keyboard ? "a key" : "a mouse button or the wheel");
                    }
                }
            }
            finally
            {
                System.Runtime.InteropServices.Marshal.FreeHGlobal(data);
            }
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Handle == 0) return;
        RegisterRawInputDevices(Devices(RIDEV_REMOVE, 0), 2, System.Runtime.InteropServices.Marshal.SizeOf<RAWINPUTDEVICE>());
        DestroyHandle();
    }
}

/// One display's screen saver, or its preview: the still at once, painted by its window, and the
/// moving wall fading in over it once the scene is ready (about two seconds), so only the motion
/// changes. If the scene fails, or is not ready in 15 s, the still stays.
sealed class SaverView : IDisposable
{
    /// How long the moving wall takes to fade in over the still.
    public const double FadeIn = 1.5;
    /// The page see-through until the reveal, so the window's still shows under it, and no cursor.
    /// Numbers as CSS writes them (1.5s), whatever the PC's language (1,5 in German or French).
    static readonly string PageStyle = string.Create(CultureInfo.InvariantCulture, $$"""
        (() => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync('html, body { background: transparent !important } #wall { opacity: 0; transition: opacity {{FadeIn}}s ease-in-out } * { cursor: none !important }');
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        })();
        """);

    public HostWindow Window { get; }
    /// The checks hold the reveal to look at the still first.
    public bool HoldReveal { get; set; }
    public bool Ready { get; private set; }
    public SceneView? Scene { get; private set; }
    readonly int fps, motion;
    readonly WeatherChoice weather;
    readonly string role;
    readonly Timer readyTimer = new() { Interval = 15_000 };
    bool paused, disposed;

    public SaverView(HostWindow window, int fps, int motion, WeatherChoice weather, string role)
    {
        Window = window;
        this.fps = fps;
        this.motion = motion;
        this.weather = weather;
        this.role = role;
        readyTimer.Tick += (_, _) =>
        {
            readyTimer.Stop();
            if (Ready) return;
            Log.Write("the scene was not ready within 15 s; showing the still");
            ShowStill();
        };
        readyTimer.Start();
        Start().Forget("starting the scene");
    }

    async Task Start()
    {
        try
        {
            var scene = await LivingWall.Scene.Show(role, Window.Handle, Window.Size);
            if (disposed) { scene.Dispose(); return; }
            Scene = scene;
            scene.Controller.DefaultBackgroundColor = Color.Transparent;
            await scene.AddStartScript(PageStyle);
            scene.Message += Received;
            scene.Load($"motion={motion}&{HostLogic.WeatherQuery(weather)}");
        }
        catch (Exception e)
        {
            // Nothing awaits this start: say why here, and leave the still showing.
            Log.Write($"the web view could not start: {e}");
            ShowStill();
        }
    }

    void Received(PageMessage message)
    {
        switch (message.Type)
        {
            case "ready":
                Ready = true;
                readyTimer.Stop();
                Scene?.Run(HostLogic.BridgeScript(fps, paused, motion, weather));
                if (!HoldReveal) Reveal();
                break;
            case "failed":
                Log.Write($"the scene failed: {message.Reason ?? "unknown"}");
                ShowStill();
                break;
            default:
                Log.Write($"page {message.Level ?? "log"}: {message.Text}");
                break;
        }
    }

    /// The moving wall takes over from the still of its own first frame.
    public void Reveal() => Scene?.Run("document.getElementById('wall').style.opacity = '1'");

    /// The displays went off (true) or came back.
    public void SetPaused(bool wanted)
    {
        paused = wanted;
        if (Ready) Scene?.Run($"wallSetPaused({(paused ? "true" : "false")})");
    }

    void ShowStill()
    {
        Scene?.Dispose();
        Scene = null;
        InvalidateRect(Window.Handle, 0, true);
    }

    public void Dispose()
    {
        disposed = true;
        readyTimer.Dispose();
        Scene?.Dispose();
        Scene = null;
        Window.Dispose();
    }
}

/// The screen saver's Options: its own Motion, and Rain or Snow, one at a time (Saver.Configure).
sealed class OptionsDialog : Form
{
    readonly ComboBox motion = List(HostLogic.MotionLevels.Select(l => l.Name));
    readonly ComboBox[] weathers = [.. HostLogic.Weathers.Select(w => List(new[] { "Off" }.Concat(w.Modes)))];

    public OptionsDialog()
    {
        Text = "Cefalo Living Wall";
        Font = SystemFonts.MessageBoxFont;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        // Laid out at 96 dpi; Windows scales it to the display's.
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(0, 0, 12, 12);

        // One grid sizing itself to what it holds, and the window to it: each setting's label and
        // list, the hint under the list, and the buttons in the last row.
        var grid = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Location = new Point(12, 12) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        void Row(string title, ComboBox control, string hint)
        {
            grid.Controls.Add(new Label { Text = title, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 3, 8, 0) });
            grid.Controls.Add(control);
            grid.Controls.Add(new Label { AutoSize = true });
            grid.Controls.Add(new Label { Text = hint, AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(3, 2, 3, 12) });
        }
        motion.SelectedIndex = Array.FindIndex(HostLogic.MotionLevels, l => l.Level == Settings.SaverMotion);
        Row("Motion:", motion, "How fast and how far the leaves move.");
        var chosen = Settings.SaverWeather;
        for (var i = 0; i < weathers.Length; i++)
        {
            var list = weathers[i];
            list.SelectedIndex = chosen.ModeOf(i);
            // One weather at a time: a mode chosen in one list turns every other to Off at once.
            list.SelectedIndexChanged += (_, _) =>
            {
                if (list.SelectedIndex <= 0) return;
                foreach (var other in weathers) if (other != list) other.SelectedIndex = 0;
            };
            Row($"{HostLogic.Weathers[i].Name}:", list, HostLogic.Weathers[i].Hint);
        }

        var ok = new Button { Text = "OK", DialogResult = DialogResult.OK, AutoSize = true };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        ok.Click += (_, _) => Save();
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Anchor = AnchorStyles.Right, Margin = new Padding(0, 4, 0, 0) };
        buttons.Controls.AddRange([cancel, ok]);
        grid.Controls.Add(buttons);
        grid.SetColumnSpan(buttons, 2);
        AcceptButton = ok;
        CancelButton = cancel;
        Controls.Add(grid);
    }

    static ComboBox List(IEnumerable<string> items)
    {
        var list = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 200, Margin = new Padding(3, 0, 3, 0) };
        list.Items.AddRange([.. items]);
        return list;
    }

    /// The weather the lists show (at most one is not Off).
    WeatherChoice Chosen => weathers.Select((list, i) => (list, i))
        .Aggregate(WeatherChoice.Off, (choice, w) => HostLogic.Choosing(w.i, Math.Max(0, w.list.SelectedIndex), choice));

    void Save()
    {
        Settings.SaverMotion = HostLogic.MotionLevels[Math.Max(0, motion.SelectedIndex)].Level;
        Settings.SaverWeather = Chosen;
        Log.Write($"options saved: motion {Settings.SaverMotion}, weather {Chosen.Stored}");
    }
}

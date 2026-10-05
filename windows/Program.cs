// Cefalo Living Wall for Windows: one program, three uses. As "Cefalo Living Wall.exe" it is the
// wallpaper app (Controller.cs), and the build's and installer's tools (the switches below); as
// "Cefalo Living Wall.scr" Windows starts it as the screen saver (Saver.cs).
using static LivingWall.Native;

namespace LivingWall;

static class Program
{
    const string SingleInstance = @"Local\CefaloLivingWall.App";

    [STAThread]
    static int Main(string[] args)
    {
        // Physical pixels everywhere, as Explorer's desktop uses: each display's wall is sized and
        // placed in them, and the cursor read in them. Before any window exists.
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        // An error in an event is logged and the wall carries on (before any control exists, as WinForms asks).
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Log.Write($"error: {e.Exception}");
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Log.Write($"fatal: {e.ExceptionObject}");
        // WebView2 answers only on this thread: every await must come back to it, even those begun
        // before the message loop runs or any WinForms control exists (the screen saver has none).
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        string? After(string option) => Array.IndexOf(args, option) is var i and >= 0 && i + 1 < args.Length ? args[i + 1] : null;

        // `--render-icon <file.ico>`: the app's icon at every size, for build.ps1.
        if (args.Contains("--render-icon"))
        {
            var ok = After("--render-icon") is string file && Icons.WriteIco(file);
            Console.WriteLine(ok ? "Rendered the icon" : "Could not render the icon");
            return ok ? 0 : 1;
        }
        if (args.Contains("--render-still"))
            return After("--render-still") is string file ? OnUiThread(() => SceneStill.RenderTo(file)) : 1;
        if (args.Contains("--check")) return OnUiThread(Checks.Scene);
        if (args.Contains("--check-saver")) return OnUiThread(Checks.Saver);
        // For uninstall.ps1: put back what the app replaced.
        if (args.Contains("--restore-desktop-picture")) return DesktopPicture.Restore() ? 0 : 1;
        if (args.Contains("--restore-screen-saver")) return ScreenSaverChoice.Restore() ? 0 : 1;
        // `--report`: the running app logs what it and each display's scene are doing.
        // `--quit`: it quits, as from its menu (the installer's, before replacing it).
        foreach (var (option, name) in new[] { ("--report", Controller.ReportEvent), ("--quit", Controller.QuitEvent) })
        {
            if (!args.Contains(option)) continue;
            if (!EventWaitHandle.TryOpenExisting(name, out var signal))
            {
                Console.WriteLine("Cefalo Living Wall is not running");
                return option == "--quit" ? 0 : 1;
            }
            signal.Set();
            if (option == "--report") Console.WriteLine($"Logged to {Path.Combine(Folders.Data, "Cefalo Living Wall.log")}");
            return 0;
        }

        var isScr = string.Equals(Path.GetExtension(Environment.ProcessPath), ".scr", StringComparison.OrdinalIgnoreCase);
        var (kind, window) = HostLogic.ParseLaunch(args, isScr);
        switch (kind)
        {
            case LaunchKind.SaverRun: return Saver.Run();
            case LaunchKind.SaverPreview: return Saver.Preview(window);
            case LaunchKind.SaverConfigure: return Saver.Configure(window);
            case LaunchKind.SaverIgnored: return 0;
        }

        // The wallpaper app, once per session.
        using var instance = new Mutex(true, SingleInstance, out var first);
        if (!first)
        {
            // Started again (from the Start menu, say): the running copy says where it is.
            if (EventWaitHandle.TryOpenExisting(Controller.HelloEvent, out var hello)) hello.Set();
            return 0;
        }
        Log.Start("Cefalo Living Wall");
        if (Scene.RuntimeVersion() is null)
        {
            Log.Write("the WebView2 runtime is missing");
            MessageBox.Show("Cefalo Living Wall needs the Microsoft Edge WebView2 Runtime, which Windows 11 includes. Install it from Microsoft, then start Cefalo Living Wall again.",
                "Cefalo Living Wall", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
        Application.Run(new Controller());
        return 0;
    }

    /// Runs `work` on this thread with a message loop, as WebView2 needs, and returns its exit code.
    static int OnUiThread(Func<Task<int>> work)
    {
        var code = 1;
        var context = new ApplicationContext();
        using var start = new System.Windows.Forms.Timer { Interval = 1 };
        start.Tick += async (_, _) =>
        {
            start.Stop();
            try { code = await work(); }
            catch (Exception e) { Console.WriteLine($"FAILED: {e}"); }
            context.ExitThread();
        };
        start.Start();
        Application.Run(context);
        return code;
    }
}

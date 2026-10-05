// Shared by the wallpaper app, the screen saver and the checks: the bundled scene served from a
// private host name (a file:// page could neither import ES modules nor read the photo's
// pixels), the page's messages, and a web view set up to show it. The Windows counterpart of
// mac/SceneWebView.swift.
using System.Drawing;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace LivingWall;

/// A message from the page: {type: "ready" | "failed" | "log", level, message, reason}.
sealed record PageMessage(string Type, string? Level, string? Text, string? Reason);

static class Scene
{
    /// The scene's origin. WebView2 answers it from the scene folder itself, never the network,
    /// and the page's Content Security Policy allows no origin but this one.
    public const string Host = "living-wall.local";
    public static string Url(string query = "") => $"https://{Host}/index.html" + (query == "" ? "" : "?" + query);
    public static string Folder => Path.Combine(AppContext.BaseDirectory, "scene");
    /// The page's own background (scene/index.html), shown until it paints.
    public static readonly Color Background = Color.FromArgb(7, 11, 6);

    static readonly Dictionary<string, Task<CoreWebView2Environment>> environments = [];

    /// One browser per role ("app", "saver", "check"), each with its own data folder, so a crash
    /// in one never takes another's walls with it. The views are InPrivate: nothing is kept.
    /// The host decides when the wall draws (Coverage.cs), so Chromium's own guess at whether a
    /// window under others is hidden is off, and so is its background networking.
    public static Task<CoreWebView2Environment> Environment(string role)
    {
        // A start that failed (its data folder still held by a browser that is ending, say) is tried
        // again next time, not kept.
        if (!environments.TryGetValue(role, out var environment) || environment.IsFaulted || environment.IsCanceled)
        {
            var options = new CoreWebView2EnvironmentOptions(
                "--disable-features=CalculateNativeWinOcclusion --disable-background-networking --disable-component-update");
            // The checks' and the still's browser keeps its data in the temp folder: a build or an
            // install that fails leaves nothing of the app's own behind.
            var data = role == "check" ? Path.Combine(Path.GetTempPath(), "Cefalo Living Wall checks") : Path.Combine(Folders.Data, "WebView2", role);
            environment = CoreWebView2Environment.CreateAsync(null, Folders.Make(data), options);
            environments[role] = environment;
        }
        return environment;
    }

    /// After the role's browser ended: the next view starts a new one.
    public static void DropBrowser(string role) => environments.Remove(role);

    /// The installed WebView2 runtime, or null when there is none (Windows 11 always has one).
    public static string? RuntimeVersion()
    {
        try { return CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (WebView2RuntimeNotFoundException) { return null; }
    }

    /// Forwards console errors and warnings (and the smoke report) to the host's log.
    const string ConsoleScript = """
        (() => {
          const post = (level, parts) => window.chrome?.webview?.postMessage({
            type: 'log', level, message: parts.map((p) => (p && p.stack) || String(p)).join(' ') });
          for (const level of ['error', 'warn']) {
            const original = console[level];
            console[level] = (...parts) => { post(level, parts); original.apply(console, parts); };
          }
          const log = console.log;
          console.log = (...parts) => { if (String(parts[0]).startsWith('SMOKE ')) post('smoke', parts); log.apply(console, parts); };
          addEventListener('error', (e) => post('error', [`${e.message} at ${e.filename}:${e.lineno}`]));
          addEventListener('unhandledrejection', (e) => post('error', [e.reason]));
        })();
        """;

    /// The scene in a web view filling `parent`, a window of ours, `size` physical pixels. A fixed
    /// `scale` (CSS pixels to physical) holds whatever display the window is on; without one the
    /// view follows its window's display.
    public static async Task<SceneView> Show(string role, IntPtr parent, Size size, double? scale = null)
    {
        var environment = await Environment(role);
        var options = environment.CreateCoreWebView2ControllerOptions();
        options.IsInPrivateModeEnabled = true;
        var controller = await environment.CreateCoreWebView2ControllerAsync(parent, options);
        controller.DefaultBackgroundColor = Background;
        if (scale is double fixedScale)
        {
            controller.ShouldDetectMonitorScaleChanges = false;
            controller.RasterizationScale = fixedScale;
        }
        controller.Bounds = new Rectangle(Point.Empty, size);
        var web = controller.CoreWebView2;
        var settings = web.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDefaultScriptDialogsEnabled = false;
        settings.AreDevToolsEnabled = System.Environment.GetEnvironmentVariable("LIVING_WALL_DEVTOOLS") == "1";
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsBuiltInErrorPageEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsReputationCheckingRequired = false;   // SmartScreen would look the page up online
        web.SetVirtualHostNameToFolderMapping(Host, Folder, CoreWebView2HostResourceAccessKind.Deny);
        await web.AddScriptToExecuteOnDocumentCreatedAsync(ConsoleScript);
        return new SceneView(controller);
    }
}

/// One web view showing the scene: what the Mac host does with a WKWebView.
sealed class SceneView : IDisposable
{
    public CoreWebView2Controller Controller { get; }
    CoreWebView2 Web => Controller.CoreWebView2;
    public event Action<PageMessage>? Message;
    /// The page's process (Render) or the whole browser (Browser) ended; see the wallpaper's backoff.
    public event Action<CoreWebView2ProcessFailedKind>? Crashed;
    bool closed;

    public SceneView(CoreWebView2Controller controller)
    {
        Controller = controller;
        Web.WebMessageReceived += (_, e) => Message?.Invoke(Parse(e.WebMessageAsJson));
        // Nothing but the scene, ever: no other page, no pop-up.
        Web.NavigationStarting += (_, e) =>
        {
            if (!e.Uri.StartsWith($"https://{Scene.Host}/", StringComparison.OrdinalIgnoreCase)) e.Cancel = true;
        };
        Web.NewWindowRequested += (_, e) => e.Handled = true;
        Web.NavigationCompleted += (_, e) =>
        {
            if (!e.IsSuccess) Log.Write($"the scene did not load: {e.WebErrorStatus}");
        };
        Web.ProcessFailed += (_, e) =>
        {
            Log.Write($"the web content process ended: {e.ProcessFailedKind} ({e.Reason}, exit {e.ExitCode})");
            Crashed?.Invoke(e.ProcessFailedKind);
        };
    }

    static PageMessage Parse(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            string? Field(string name) => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var value)
                ? value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText()
                : null;
            return new PageMessage(Field("type") ?? "log", Field("level"), Field("message"), Field("reason"));
        }
        catch (JsonException)
        {
            return new PageMessage("log", null, json, null);
        }
    }

    public void Load(string query = "") { if (!closed) Web.Navigate(Scene.Url(query)); }

    public void Reload() { if (!closed) Web.Reload(); }

    /// Runs a script in the page without waiting for it, as the Mac host's evaluateJavaScript.
    public void Run(string script)
    {
        if (closed) return;
        try { _ = Web.ExecuteScriptAsync(script).ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted); }
        catch (InvalidOperationException) { }
    }

    /// A script for every page this view loads, run before the page's own.
    public Task AddStartScript(string script) => Web.AddScriptToExecuteOnDocumentCreatedAsync(script);

    /// A script's result, as JSON, or null if the page cannot answer.
    public async Task<string?> Evaluate(string script)
    {
        if (closed) return null;
        try { return await Web.ExecuteScriptAsync(script); }
        catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException) { return null; }
    }

    /// The page's wallState() as JSON, or null before it can answer.
    public async Task<string?> State()
    {
        var result = await Evaluate("typeof wallState === 'function' ? JSON.stringify(wallState()) : null");
        try { return result is null ? null : JsonSerializer.Deserialize<string?>(result); }
        catch (JsonException) { return null; }
    }

    /// CSS pixels to physical, as the page sees it (devicePixelRatio).
    public double Scale => closed ? 1 : Controller.RasterizationScale;

    public bool Visible
    {
        get => !closed && Controller.IsVisible;
        set
        {
            if (closed) return;
            // After its browser ended, the controller is gone; there is nothing left to hide.
            try { Controller.IsVisible = value; }
            catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException) { }
        }
    }

    public void Resize(Size size) { if (!closed) Controller.Bounds = new Rectangle(Point.Empty, size); }

    /// The page as drawn now, `Controller.Bounds` big, or null if it cannot be captured.
    public async Task<Bitmap?> Capture()
    {
        if (closed) return null;
        try
        {
            using var png = new MemoryStream();
            await Web.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, png);
            png.Position = 0;
            using var image = Image.FromStream(png);
            return new Bitmap(image);
        }
        catch (Exception e) when (e is InvalidOperationException or ArgumentException or System.Runtime.InteropServices.COMException)
        {
            Log.Write($"could not capture the scene: {e.Message}");
            return null;
        }
    }

    public void Dispose()
    {
        if (closed) return;
        closed = true;
        try { Controller.Close(); } catch (InvalidOperationException) { }
    }
}

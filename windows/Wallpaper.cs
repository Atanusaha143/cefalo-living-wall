// One display's wall. The Windows counterpart of the Wallpaper class in mac/LivingWall.swift.
using System.Drawing;
using System.Globalization;
using Microsoft.Web.WebView2.Core;

namespace LivingWall;

/// One display's wall: a window of ours in the desktop's wallpaper layer (DesktopLayer), filled
/// by the scene. It stays hidden until the scene is ready, so the still desktop picture (the
/// scene's own first frame) shows until then, and again if the scene fails.
sealed class Wallpaper : IDisposable
{
    /// The display, on the screen, in physical pixels.
    public Rectangle Bounds { get; }
    public string Name { get; }
    public bool Failed { get; private set; }
    /// The page said `ready`: its bridge functions exist.
    public bool Ready { get; private set; }
    /// The window it lives in: the layer it was put in, until Explorer replaces that layer.
    public IntPtr Parent => window.Parent;
    public double Scale => view?.Scale ?? 1;

    readonly HostWindow window;
    readonly string role;
    SceneView? view;
    bool disposed;
    int rate = -1;
    bool paused;
    int motion = 4;
    WeatherChoice weather = WeatherChoice.Off;
    bool inside;
    int crashes;
    DateTime stableSince = DateTime.Now;
    int pointerSends;
    PointF lastSent = new(-1, -1);

    /// A wall for the display `bounds` (on the screen) in `parent`, at `inParent` in its client area.
    public Wallpaper(string name, Rectangle bounds, IntPtr parent, Rectangle inParent, string role = "app")
    {
        Name = name;
        Bounds = bounds;
        this.role = role;
        window = HostWindow.Child(parent, inParent);
        Start().Forget("starting the scene");
    }

    async Task Start()
    {
        try
        {
            var shown = await Scene.Show(role, window.Handle, Bounds.Size);
            if (disposed) { shown.Dispose(); return; }
            view = shown;
            // WebView2 does not see its window shown later on its own: it is told (ShowSoon), and
            // until then it is hidden, as its window is.
            view.Visible = false;
            view.Message += Received;
            view.Crashed += Crashed;
            view.Load();
        }
        catch (Exception e)
        {
            // Nothing awaits this start: say why here, and leave the still desktop picture showing.
            Failed = true;
            Log.Write($"{Name}: the web view could not start: {e}");
        }
    }

    public void Dispose()
    {
        disposed = true;
        view?.Dispose();
        view = null;
        window.Dispose();
    }

    void Received(PageMessage message)
    {
        switch (message.Type)
        {
            case "ready":
                // Only now do the page's wall* functions exist: calls made earlier would be lost.
                Failed = false;
                Ready = true;
                Send();
                // The page has drawn its first frame; a moment more and it is on screen.
                ShowSoon().Forget("showing the wall");
                break;
            case "failed":
                Failed = true;
                Log.Write($"{Name}: the scene failed: {message.Reason ?? "unknown"}");
                Hide();
                break;
            default:
                Log.Write($"{Name}: page {message.Level ?? "log"}: {message.Text}");
                break;
        }
    }

    /// The still desktop picture shows instead of the wall.
    void Hide()
    {
        window.Hide();
        if (view is not null) view.Visible = false;
    }

    async Task ShowSoon()
    {
        await Task.Delay(150);
        if (disposed || !Ready || Failed || view is null) return;
        window.Show();
        view.Visible = true;
    }

    /// Frame-rate cap for this display; 0 halts it. Sent only on change.
    public void SetRate(int wanted)
    {
        if (wanted == rate) return;
        rate = wanted;
        if (rate == 0) SetPointer(null);
        Send();
    }

    public void SetPaused(bool wanted)
    {
        if (wanted == paused) return;
        paused = wanted;
        Send();
    }

    /// The Motion level (3 Gentle, 4 Lively, 5 Wild).
    public void SetMotion(int level)
    {
        if (level == motion) return;
        motion = level;
        Send();
    }

    /// The one weather (Rain or Snow, and its mode), or none.
    public void SetWeather(WeatherChoice choice)
    {
        if (choice == weather) return;
        weather = choice;
        Send();
    }

    void Send()
    {
        if (Ready) view?.Run(HostLogic.BridgeScript(rate, paused, motion, weather));
    }

    /// The cursor in this display's CSS pixels, or null when it is not over its visible desktop.
    public void SetPointer(PointF? point)
    {
        if (!Ready) return;
        if (point is not PointF p || rate <= 0)
        {
            if (inside) view?.Run("wallPointerOut()");
            inside = false;
            return;
        }
        inside = true;
        pointerSends++;
        lastSent = p;
        view?.Run(string.Create(CultureInfo.InvariantCulture, $"wallSetPointer({p.X:F1},{p.Y:F1})"));
    }

    /// The page's wallState() as JSON, or null before it can answer.
    public Task<string?> PageState() => view?.State() ?? Task.FromResult<string?>(null);

    /// Logs what this display's host side and page are doing (Controller's --report dump).
    public async Task Report(int index)
    {
        Log.Write($"screen {index} {Name}: ready {Ready} rate {rate} paused {paused} failed {Failed} inside {inside} pointerSends {pointerSends} lastSent {lastSent} bounds {Bounds} scale {Scale} window 0x{window.Handle:X} in 0x{Parent:X}");
        if (Ready) Log.Write($"screen {index} page: {await PageState() ?? "no answer"}");
    }

    /// The page's process ended or hung: the still desktop picture shows while it reloads after 2 s,
    /// doubling up to 60 s; the backoff resets after five minutes of stable running. If the whole
    /// browser ended, a new one starts. Chromium brings its other processes (the GPU's, say) back
    /// by itself, and the page runs on meanwhile.
    void Crashed(CoreWebView2ProcessFailedKind kind)
    {
        if (kind is not (CoreWebView2ProcessFailedKind.BrowserProcessExited or CoreWebView2ProcessFailedKind.RenderProcessExited
            or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)) return;
        Ready = false;
        inside = false;
        Hide();
        if (DateTime.Now - stableSince > TimeSpan.FromMinutes(5)) crashes = 0;
        var wait = Math.Min(60, 2 * Math.Pow(2, crashes));
        crashes++;
        Log.Write($"{Name}: reloading in {wait:F0} s");
        Recover(kind, TimeSpan.FromSeconds(wait)).Forget("reloading the scene");
    }

    async Task Recover(CoreWebView2ProcessFailedKind kind, TimeSpan wait)
    {
        await Task.Delay(wait);
        if (disposed) return;
        stableSince = DateTime.Now;
        if (kind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
        {
            view?.Dispose();
            view = null;
            Scene.DropBrowser(role);
            await Start();
        }
        else
        {
            view?.Reload();
        }
    }
}

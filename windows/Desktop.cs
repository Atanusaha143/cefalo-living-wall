// Where the wall lives: in the desktop's own wallpaper layer, under the icons, so they, clicks
// and dragging on the desktop work as usual and every window covers the wall.
using System.Drawing;
using static LivingWall.Native;

namespace LivingWall;

/// A display as Windows has it now, physical pixels on the virtual screen.
readonly record struct Display(string Name, Rectangle Bounds, bool Primary);

static class Displays
{
    /// Every display, the main one first. Asked of Windows each time: WinForms' Screen.AllScreens
    /// is cached until WinForms itself hears of a change, which may come after ours.
    public static Display[] All()
    {
        var found = new List<Display>();
        EnumDisplayMonitors(0, 0, (monitor, _, _, _) =>
        {
            var info = new MONITORINFOEX { Size = System.Runtime.InteropServices.Marshal.SizeOf<MONITORINFOEX>() };
            if (GetMonitorInfo(monitor, ref info))
                found.Add(new Display(info.Device, info.Monitor.ToRectangle(), (info.Flags & 1) != 0));
            return true;
        }, 0);
        return [.. found.OrderByDescending(d => d.Primary).ThenBy(d => d.Name, StringComparer.Ordinal)];
    }
}

/// The layer Explorer draws the desktop picture in. Since Windows 11 24H2 it is a WorkerW inside
/// Progman (the desktop), below Progman's SHELLDLL_DefView (the icons); before, a top-level
/// WorkerW just behind the one holding the icons. Message 0x052C asks Progman to make it (as
/// for a slideshow's cross-fade); it is sent only when the layer is missing, since it can make
/// Explorer replace the layer, and with it every wall.
static class DesktopLayer
{
    const uint MakeWallpaperLayer = 0x052C;

    public static IntPtr Find()
    {
        var progman = FindWindow("Progman", null);
        if (progman == 0) return 0;
        var inside = FindWindowEx(progman, 0, "WorkerW", null);
        if (inside != 0 && FindWindowEx(progman, 0, "SHELLDLL_DefView", null) != 0) return inside;
        // Before 24H2 the icons move into a top-level WorkerW once the layer exists. Explorer keeps
        // many hidden WorkerWs too, so the layer must be the visible one right behind the icons'.
        IntPtr behind = 0;
        EnumWindows((top, _) =>
        {
            if (ClassName(top) != "WorkerW" || FindWindowEx(top, 0, "SHELLDLL_DefView", null) == 0) return true;
            behind = FindWindowEx(0, top, "WorkerW", null);
            return false;
        }, 0);
        return behind != 0 && IsWindowVisible(behind) ? behind : 0;
    }

    /// The layer, made if Explorer has none yet; 0 if there is no desktop (Explorer not running).
    public static IntPtr FindOrMake()
    {
        var layer = Find();
        if (layer != 0) return layer;
        var progman = FindWindow("Progman", null);
        if (progman == 0) return 0;
        SendMessageTimeout(progman, MakeWallpaperLayer, 0xD, 1, 0, 1000, out _);
        SendMessageTimeout(progman, MakeWallpaperLayer, 0, 0, 0, 1000, out _);
        layer = Find();
        Log.Write(layer != 0 ? "made the desktop's wallpaper layer" : "the desktop has no wallpaper layer");
        return layer;
    }

    /// For the log: the layer, its parent and its place under the icons.
    public static string Describe(IntPtr layer)
    {
        if (layer == 0) return "no wallpaper layer";
        GetWindowRect(layer, out var r);
        var parent = GetParent(layer);
        return $"layer 0x{layer:X} in {(parent == 0 ? "the desktop (top level)" : $"{ClassName(parent)} 0x{parent:X}")} at {r.ToRectangle()}";
    }
}

/// A plain window of ours that a web view fills: a child inside another window (a display's
/// wall in the desktop's layer, the screen saver's preview box), a popup covering a display
/// (the screen saver), or a window off every screen (the still, the checks: WebView2 draws only
/// in a shown window, and not in a see-through one). It can paint a still under the web view,
/// framed as the scene frames the wall, to show while the scene loads.
sealed class HostWindow : NativeWindow, IDisposable
{
    readonly Brush background = new SolidBrush(Scene.Background);
    Bitmap? backdrop;
    /// Called for each message first; returns true when it handled it.
    public Func<Message, bool>? Messages;

    HostWindow(CreateParams parameters, Image? still)
    {
        if (still is not null) backdrop = DesktopPicture.Framed(still, new Size(parameters.Width, parameters.Height));
        CreateHandle(parameters);
    }

    /// Hidden until `Show`; it never takes the focus or a click: the icons above it get them.
    /// `bounds` in the parent's client coordinates, physical pixels. A child with a still under a
    /// see-through web view must not clip it out (`clipChildren: false`).
    public static HostWindow Child(IntPtr parent, Rectangle bounds, Image? still = null, bool clipChildren = true) => new(new CreateParams
    {
        Parent = parent,
        X = bounds.X, Y = bounds.Y, Width = bounds.Width, Height = bounds.Height,
        Style = WS_CHILD | WS_CLIPSIBLINGS | WS_DISABLED | (clipChildren ? WS_CLIPCHILDREN : 0) | (still is null ? 0 : WS_VISIBLE),
        ExStyle = WS_EX_NOACTIVATE,
    }, still);

    /// Covering `bounds` on the screen, over every window (the screen saver), shown at once.
    public static HostWindow Popup(Rectangle bounds, Image? still, bool topMost) => new(new CreateParams
    {
        X = bounds.X, Y = bounds.Y, Width = bounds.Width, Height = bounds.Height,
        Style = WS_POPUP | WS_VISIBLE,
        ExStyle = WS_EX_TOOLWINDOW | (topMost ? WS_EX_TOPMOST : 0),
    }, still);

    /// Off every screen, `size` big, shown (so its web view draws) but never seen.
    public static HostWindow Offscreen(Size size, Image? still = null)
    {
        var all = SystemInformation.VirtualScreen;
        return new(new CreateParams
        {
            X = all.Right + 400, Y = all.Bottom + 400, Width = size.Width, Height = size.Height,
            Style = WS_POPUP | WS_VISIBLE,
            ExStyle = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        }, still);
    }

    /// Where a rectangle on the screen falls in `parent`'s client area.
    public static Rectangle InParent(IntPtr parent, Rectangle onScreen)
    {
        var origin = new POINT { X = onScreen.X, Y = onScreen.Y };
        ScreenToClient(parent, ref origin);
        return new Rectangle(origin.X, origin.Y, onScreen.Width, onScreen.Height);
    }

    public bool Alive => Handle != 0 && IsWindow(Handle);
    public IntPtr Parent => Alive ? GetParent(Handle) : 0;
    public Size Size => GetWindowRect(Handle, out var r) ? r.ToRectangle().Size : Size.Empty;

    public void Show() => ShowWindow(Handle, SW_SHOWNA);
    public void Hide() => ShowWindow(Handle, SW_HIDE);

    /// What the window paints under its web view: the still, framed, on the page's background.
    public void PaintBackdrop(Graphics g, RectangleF clip)
    {
        g.FillRectangle(background, clip);
        if (backdrop is not null) g.DrawImageUnscaled(backdrop, 0, 0);
    }

    protected override void WndProc(ref Message m)
    {
        if (Messages?.Invoke(m) == true) return;
        if (m.Msg == WM_GETMINMAXINFO)
        {
            // As big as asked, even beyond the screen: the still renders 3840 x 2560 off screen.
            var limits = System.Runtime.InteropServices.Marshal.PtrToStructure<MINMAXINFO>(m.LParam);
            limits.MaxTrackSize = new POINT { X = 16384, Y = 16384 };
            System.Runtime.InteropServices.Marshal.StructureToPtr(limits, m.LParam, false);
            m.Result = 0;
            return;
        }
        if (m.Msg == WM_ERASEBKGND)
        {
            // The still, or the page's own background, never the white of a new window.
            using var g = Graphics.FromHdc(m.WParam);
            PaintBackdrop(g, g.VisibleClipBounds);
            m.Result = 1;
            return;
        }
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Handle != 0) DestroyHandle();
        background.Dispose();
        backdrop?.Dispose();
    }
}

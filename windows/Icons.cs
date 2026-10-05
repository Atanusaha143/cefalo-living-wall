// The tray icon and the app's icon: Cefalo's three dots with two leaves opening from the bottom
// dot, like a seedling, as the Mac's (mac/MenuIcon.swift, mac/AppIcon.swift) on the same grid.
// The leaves are drawn here from curves of their own, not Apple's leaf.fill symbol, whose terms
// keep it to Apple's platforms.
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using Microsoft.Win32;
using static LivingWall.Native;

namespace LivingWall;

static class Mark
{
    /// The grid it is designed in (y down), and the part of it the icon draws: the dots and
    /// leaves with about 1 unit round them (mac/MenuIcon.swift's viewport).
    public static readonly RectangleF Viewport = new(0.225f, 3.45f, 27.55f, 17.1f);
    static readonly PointF[] Dots = [new(14, 6.4f), new(14, 12), new(14, 17.6f)];
    const float DotRadius = 2.0f;

    /// The left leaf: its stalk rises from the bottom dot to the blade, which runs up and out to
    /// its tip, beside the top dot, never above it. The right leaf is its mirror image about the
    /// dots' line.
    static readonly PointF StalkEnd = new(14, 17.6f), Base = new(11.0f, 14.7f), Tip = new(1.5f, 6.3f);

    /// Cubic curves in the blade's own frame: u along it (0 base, 1 tip), v across it, in blade
    /// lengths, positive on its outer, lower edge, which swells more, so the blade curves up like
    /// a seedling's.
    static readonly PointF[] Outline =
    [
        new(0, 0), new(0.06f, 0.44f), new(0.60f, 0.50f), new(1, 0),        // the outer edge, out to the tip
        new(0.80f, -0.30f), new(0.28f, -0.40f), new(0, 0),                  // the inner edge, back to the base
    ];
    /// The vein down the blade's middle, bowed with it, to just short of the tip.
    static readonly PointF[] Vein = [new(0.02f, 0.01f), new(0.30f, 0.11f), new(0.56f, 0.09f), new(0.78f, 0.04f)];

    /// A point of the left blade's frame on the grid, or its mirror image for the right one.
    static PointF OnGrid(PointF p, bool right)
    {
        var axis = new PointF(Tip.X - Base.X, Tip.Y - Base.Y);
        var across = new PointF(axis.Y, -axis.X);   // a quarter turn: towards the outside, down
        if (across.X > 0) across = new PointF(-across.X, -across.Y);
        var x = Base.X + p.X * axis.X + p.Y * across.X;
        var y = Base.Y + p.X * axis.Y + p.Y * across.Y;
        return new PointF(right ? 28 - x : x, y);
    }

    static GraphicsPath Blade(bool right)
    {
        var path = new GraphicsPath();
        path.AddBeziers([.. Outline.Select(p => OnGrid(p, right))]);
        path.CloseFigure();
        return path;
    }

    /// Draws the mark's viewport into `bounds`, centred and as large as fits: the leaves, with
    /// their veins cut out of them (on a layer of their own, so the veins show what is under the
    /// mark), then the dots over their stalks.
    public static void Draw(Graphics g, RectangleF bounds, Color[] dots, Color leaves)
    {
        var scale = Math.Min(bounds.Width / Viewport.Width, bounds.Height / Viewport.Height);
        var origin = new PointF(bounds.X + (bounds.Width - Viewport.Width * scale) / 2, bounds.Y + (bounds.Height - Viewport.Height * scale) / 2);
        void OnMark(Graphics into, PointF at)
        {
            into.SmoothingMode = SmoothingMode.AntiAlias;
            into.PixelOffsetMode = PixelOffsetMode.HighQuality;
            into.TranslateTransform(at.X, at.Y);
            into.ScaleTransform(scale, scale);
            into.TranslateTransform(-Viewport.X, -Viewport.Y);
        }
        var size = new Size((int)Math.Ceiling(Viewport.Width * scale) + 2, (int)Math.Ceiling(Viewport.Height * scale) + 2);
        using (var layer = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb))
        {
            using (var l = Graphics.FromImage(layer))
            {
                OnMark(l, new PointF(1, 1));
                using var fill = new SolidBrush(leaves);
                using var stalk = new Pen(leaves, 0.95f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
                using var vein = new Pen(Color.Transparent, 0.55f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
                foreach (var right in new[] { false, true })
                {
                    using var blade = Blade(right);
                    l.FillPath(fill, blade);
                    var start = right ? new PointF(28 - StalkEnd.X, StalkEnd.Y) : StalkEnd;
                    var end = OnGrid(new PointF(0.03f, 0.01f), right);
                    l.DrawBezier(stalk, start, new PointF(start.X + (right ? 0.4f : -0.4f), start.Y - 1.6f), new PointF(end.X + (right ? -0.6f : 0.6f), end.Y + 0.6f), end);
                    l.CompositingMode = CompositingMode.SourceCopy;
                    var v = Vein.Select(p => OnGrid(p, right)).ToArray();
                    l.DrawBezier(vein, v[0], v[1], v[2], v[3]);
                    l.CompositingMode = CompositingMode.SourceOver;
                }
            }
            g.DrawImageUnscaled(layer, (int)Math.Round(origin.X) - 1, (int)Math.Round(origin.Y) - 1);
        }
        var state = g.Save();
        OnMark(g, new PointF((float)Math.Round(origin.X), (float)Math.Round(origin.Y)));
        for (var i = 0; i < Dots.Length; i++)
        {
            using var fill = new SolidBrush(dots[i]);
            g.FillEllipse(fill, Dots[i].X - DotRadius, Dots[i].Y - DotRadius, 2 * DotRadius, 2 * DotRadius);
        }
        g.Restore(state);
    }
}

static class Icons
{
    /// Cefalo's colours, as its logo on cefalo.com has them (mac/AppIcon.swift).
    public static readonly Color Green = Color.FromArgb(0x57, 0xA1, 0x1F), LightBlue = Color.FromArgb(0x00, 0xA9, 0xDC), Navy = Color.FromArgb(0x00, 0x40, 0x81);

    /// The taskbar is light (Settings ▸ Personalization ▸ Colors ▸ Windows mode).
    public static bool LightTaskbar()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("SystemUsesLightTheme") is int light && light != 0;
    }

    /// The tray icon's size in pixels, at the taskbar's scale.
    public static int TraySize()
    {
        var taskbar = FindWindow("Shell_TrayWnd", null);
        var dpi = taskbar != 0 ? GetDpiForWindow(taskbar) : GetDpiForSystem();
        return GetSystemMetricsForDpi(SM_CXSMICON, dpi == 0 ? 96 : dpi);
    }

    /// The tray icon: the mark in one colour, like the taskbar's own icons, dark on a light
    /// taskbar and light on a dark one.
    public static Icon Tray(int pixels, bool lightTaskbar)
    {
        var ink = lightTaskbar ? Color.FromArgb(28, 28, 28) : Color.White;
        using var image = new Bitmap(pixels, pixels, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(image))
            Mark.Draw(g, new RectangleF(0, 0, pixels, pixels), [ink, ink, ink], ink);
        var handle = image.GetHicon();
        using var borrowed = Icon.FromHandle(handle);
        var icon = (Icon)borrowed.Clone();
        DestroyIcon(handle);
        return icon;
    }

    /// The app's icon, `pixels` square: the mark in Cefalo's colours (the dots green, light blue
    /// and navy, top to bottom, as in its logo, and the leaves its green) on a white rounded tile.
    public static Bitmap App(int pixels)
    {
        var image = new Bitmap(pixels, pixels, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(image);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        var k = pixels / 256f;
        var tile = new RectangleF(10 * k, 8 * k, 236 * k, 236 * k);
        using var shape = RoundedSquare(tile, 52 * k);
        if (pixels >= 48)
            using (var shadow = RoundedSquare(new RectangleF(tile.X, tile.Y + 4 * k, tile.Width, tile.Height), 52 * k))
            using (var soft = new SolidBrush(Color.FromArgb(46, 0, 0, 0)))
                g.FillPath(soft, shadow);
        using (var fade = new LinearGradientBrush(tile, Color.White, Color.FromArgb(237, 241, 236), LinearGradientMode.Vertical))
            g.FillPath(fade, shape);
        if (pixels < 48)
            using (var edge = new Pen(Color.FromArgb(40, 0, 0, 0), Math.Max(1, k)))
                g.DrawPath(edge, shape);   // small sizes: an edge instead of the shadow, so it reads on white
        var mark = tile.Width * 0.72f;
        Mark.Draw(g, new RectangleF(tile.X + (tile.Width - mark) / 2, tile.Y, mark, tile.Height), [Green, LightBlue, Navy], Green);
        return image;
    }

    static GraphicsPath RoundedSquare(RectangleF r, float radius)
    {
        var d = 2 * radius;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    /// `Cefalo Living Wall.exe --render-icon <file.ico>`: the app's icon at every size Windows asks
    /// for, 16 to 256 px, each a PNG inside the .ico. build.ps1 builds it into the program.
    public static bool WriteIco(string file)
    {
        int[] sizes = [16, 20, 24, 32, 40, 48, 64, 256];
        var images = sizes.Select(size =>
        {
            using var bitmap = App(size);
            using var png = new MemoryStream();
            bitmap.Save(png, ImageFormat.Png);
            return png.ToArray();
        }).ToArray();
        using var output = new BinaryWriter(File.Create(file));
        output.Write((short)0);
        output.Write((short)1);   // an icon
        output.Write((short)sizes.Length);
        var offset = 6 + 16 * sizes.Length;
        for (var i = 0; i < sizes.Length; i++)
        {
            output.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
            output.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
            output.Write((byte)0);
            output.Write((byte)0);
            output.Write((short)1);
            output.Write((short)32);
            output.Write(images[i].Length);
            output.Write(offset);
            offset += images[i].Length;
        }
        foreach (var image in images) output.Write(image);
        return true;
    }
}

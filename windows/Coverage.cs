// How much of each display's desktop the windows over it leave in view. Ported from
// mac/Coverage.swift; which windows count is Windows' own (CountsAsBlocker).
using System.Drawing;

namespace LivingWall;

/// A top-level window as EnumWindows finds it (Controller.WindowBlockers): only its bounds and
/// a few flags, never its contents.
public readonly record struct WindowInfo(
    string ClassName, Rectangle Bounds, bool Visible, bool Minimised, bool Cloaked, bool Ours,
    bool ClickThrough, byte? Alpha);

public static class Coverage
{
    /// How much of a screen no app window covers, from 0 (none of it) to 1 (all of it). The
    /// screen is sampled on a grid, so overlapping windows are counted once.
    public static double VisibleFraction(RectangleF screen, IReadOnlyList<RectangleF> blockers, int columns = 32, int rows = 20)
    {
        var relevant = blockers.Where(b => b.IntersectsWith(screen)).ToArray();
        if (relevant.Length == 0) return 1;
        var free = 0;
        for (var column = 0; column < columns; column++)
            for (var row = 0; row < rows; row++)
            {
                var x = screen.X + screen.Width * (column + 0.5f) / columns;
                var y = screen.Y + screen.Height * (row + 0.5f) / rows;
                if (!relevant.Any(b => b.Contains(x, y))) free++;
            }
        return (double)free / (columns * rows);
    }

    /// The frame-rate cap for a screen whose desktop is this visible.
    public static int FrameCap(double visible) => visible >= 0.40 ? 30 : visible >= 0.05 ? 15 : 0;

    /// The desktop's own windows, which the wall is part of. The taskbar is not one of them: it
    /// hides the wall under it, and with a window maximised above it, the 5 % of the screen it
    /// takes would otherwise keep a wall nobody sees drawing at 15 fps.
    static readonly HashSet<string> Shell = ["Progman", "WorkerW"];

    /// Whether a window hides the desktop under it: shown on this virtual desktop (Windows
    /// cloaks the others' windows, and suspended Store apps), not ours, not the desktop's, and
    /// solid: a click-through or see-through window (an overlay, a fading toast) hides nothing.
    public static bool CountsAsBlocker(WindowInfo w) =>
        w.Visible && !w.Minimised && !w.Cloaked && !w.Ours && !w.ClickThrough
        && (w.Alpha is null || w.Alpha >= 243)   // 95 % opaque, as on the Mac
        && w.Bounds.Width > 0 && w.Bounds.Height > 0
        && !Shell.Contains(w.ClassName);
}
